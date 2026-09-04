import { prisma } from '../lib/prisma'
import { chatJSON } from '../ai/client'
import { discoverRelationsSystem } from '../ai/prompts'

interface RelationSuggestion {
  toTitle: string
  type: string
  reason?: string
  confidence?: number
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

已有知识列表：
${others.map((o) => `- [${o.title}] ${o.coreConclusion}`).join('\n')}

请判断新知识与已有知识之间的关系。`

  const suggestions = await chatJSON<RelationSuggestion[]>([
    { role: 'system', content: discoverRelationsSystem() },
    { role: 'user', content: userPrompt },
  ])

  const created: unknown[] = []
  for (const s of suggestions) {
    const target = others.find((o) => o.title === s.toTitle)
    if (!target) continue
    try {
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
    } catch {
      // 忽略重复等异常
    }
  }
  return created
}

// 知识图谱：节点 + 边
export async function getGraph(userId: string) {
  const knowledges = await prisma.knowledge.findMany({
    where: { userId, status: 'active' },
    select: { id: true, title: true, type: true, coreConclusion: true },
  })
  const relations = await prisma.knowledgeRelation.findMany({ where: { userId } })
  return {
    nodes: knowledges.map((k) => ({
      id: k.id,
      label: k.title,
      type: k.type,
      summary: k.coreConclusion,
    })),
    edges: relations.map((r) => ({
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
