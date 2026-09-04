import { prisma } from '../lib/prisma'
import { chatJSON } from '../ai/client'
import { discoverRelationsSystem } from '../ai/prompts'

interface RelationSuggestion {
  toId?: string
  toTitle?: string
  type: string
  reason?: string
  confidence?: number
  gapDescription?: string
}

// 新知识入库后，AI 自动发现与已有知识的关系
export async function discoverRelations(userId: string, knowledgeId: string) {
  const knowledge = await prisma.knowledge.findUnique({ where: { id: knowledgeId } })
  if (!knowledge) return []

  const others = await prisma.knowledge.findMany({
    where: { userId, status: 'active', id: { not: knowledgeId } },
    orderBy: { updatedAt: 'desc' },
    take: 50,
    select: { id: true, title: true, coreConclusion: true },
  })
  if (others.length === 0) return []

  const userPrompt = `新知识：
标题：${knowledge.title}
核心结论：${knowledge.coreConclusion}

已有知识列表（格式：id | 标题 | 核心结论）：
${others.map((o) => `- ${o.id} | ${o.title} | ${o.coreConclusion}`).join('\n')}

请判断新知识与已有知识之间的关系，返回目标知识的 id。`

  const suggestions = await chatJSON<RelationSuggestion[]>([
    { role: 'system', content: discoverRelationsSystem() },
    { role: 'user', content: userPrompt },
  ])

  const created: unknown[] = []
  for (const s of suggestions) {
    // 优先用 id 匹配，退回到标题精确匹配，再退回到标题包含匹配
    const target =
      (s.toId ? others.find((o) => o.id === s.toId) : undefined) ??
      (s.toTitle ? others.find((o) => o.title === s.toTitle) : undefined) ??
      (s.toTitle ? others.find((o) => o.title.includes(s.toTitle as string)) : undefined)
    if (!target) continue
    try {
      // 知识桥梁：A 与 B 之间缺失中间知识 C，C 本身不存在，不能作为关系边，
      // 转存为「断层」记录，gapDescription 描述缺失的 C。
      if (s.type === 'bridge') {
        const gap = await prisma.knowledgeGap.create({
          data: {
            userId,
            gapDescription:
              s.gapDescription ||
              `「${knowledge.title}」与「${target.title}」之间缺少关键的中间知识`,
            recommended: false, // 是否值得学习，由后续断层分析结合画像判断
            reason: s.reason,
            fromKnowledgeId: knowledgeId,
            toKnowledgeId: target.id,
          },
        })
        created.push({ kind: 'gap', ...gap })
        continue
      }
      const rel = await prisma.knowledgeRelation.upsert({
        where: { fromId_toId_type: { fromId: knowledgeId, toId: target.id, type: s.type } },
        update: { reason: s.reason, confidence: s.confidence },
        create: {
          fromId: knowledgeId,
          toId: target.id,
          type: s.type,
          reason: s.reason,
          confidence: s.confidence,
          userId,
        },
      })
      created.push(rel)
    } catch (e) {
      // 重复关系等异常属正常情况，仅记日志不中断
      console.error('[关系发现] 建立关系失败', e)
    }
  }
  return created
}

// 知识图谱：节点 + 边（过滤掉指向已归档/删除知识的悬空边）
export async function getGraph(userId: string) {
  const knowledges = await prisma.knowledge.findMany({
    where: { userId, status: 'active' },
    select: { id: true, title: true, type: true, coreConclusion: true },
  })
  const relations = await prisma.knowledgeRelation.findMany({ where: { userId } })
  const activeIds = new Set(knowledges.map((k) => k.id))
  const validRelations = relations.filter((r) => activeIds.has(r.fromId) && activeIds.has(r.toId))
  return {
    nodes: knowledges.map((k) => ({
      id: k.id,
      label: k.title,
      type: k.type,
      summary: k.coreConclusion,
    })),
    edges: validRelations.map((r) => ({
      from: r.fromId,
      to: r.toId,
      type: r.type,
      reason: r.reason,
    })),
  }
}

// 单条知识的全部关系（合并出/入方向）
export async function getKnowledgeRelations(userId: string, knowledgeId: string) {
  const relations = await prisma.knowledgeRelation.findMany({
    where: { userId, OR: [{ fromId: knowledgeId }, { toId: knowledgeId }] },
    include: {
      from: { select: { id: true, title: true, coreConclusion: true } },
      to: { select: { id: true, title: true, coreConclusion: true } },
    },
  })
  return relations.map((r) => ({
    id: r.id,
    type: r.type,
    reason: r.reason,
    confidence: r.confidence,
    other: r.fromId === knowledgeId ? r.to : r.from,
    direction: r.fromId === knowledgeId ? 'out' : 'in',
  }))
}
