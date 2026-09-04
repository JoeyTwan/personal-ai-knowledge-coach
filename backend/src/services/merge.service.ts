import { prisma } from '../lib/prisma'
import { chatJSON } from '../ai/client'
import { detectDuplicatesSystem, mergeKnowledgeSystem } from '../ai/prompts'
import { createKnowledge } from './knowledge.service'
import { discoverRelations } from './relation.service'

// 归一化标题：去空格/标点，统一小写，用于相似度预筛
function normalizeTitle(s: string): string {
  return s.replace(/[\s，。、；：""''（）()\[\]【】,.!?;:]/g, '').toLowerCase()
}

// 发现重复 / 高度相似知识（启发式预筛缩小候选集，再让 LLM 精确判断，降低不确定性）
export async function detectDuplicates(userId: string) {
  const knowledges = await prisma.knowledge.findMany({
    where: { userId, status: 'active' },
    select: { id: true, title: true, coreConclusion: true, tags: { select: { name: true } } },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  })
  if (knowledges.length < 2) return []

  // 启发式预筛：标题归一化后相似（相同/包含）或共享 tag，找出「可能重复」的候选对
  const candidatePairs: Array<{ a: string; b: string }> = []
  const seenPair = new Set<string>()
  for (let i = 0; i < knowledges.length; i++) {
    for (let j = i + 1; j < knowledges.length; j++) {
      const a = knowledges[i]
      const b = knowledges[j]
      const pairKey = [a.id, b.id].sort().join('|')
      if (seenPair.has(pairKey)) continue

      const aTitle = normalizeTitle(a.title)
      const bTitle = normalizeTitle(b.title)
      const aTags = new Set(a.tags.map((t) => t.name))
      const sharedTags = [...aTags].filter((t) => b.tags.some((bt) => bt.name === t))

      const titleSimilar = aTitle === bTitle || aTitle.includes(bTitle) || bTitle.includes(aTitle)
      if (titleSimilar || sharedTags.length >= 1) {
        candidatePairs.push({ a: a.id, b: b.id })
        seenPair.add(pairKey)
      }
    }
  }

  if (candidatePairs.length === 0) return []

  // 让 LLM 只在预筛出的候选中精确判断
  const suggestions = await chatJSON<Array<{ knowledgeIds: string[]; reason?: string }>>([
    { role: 'system', content: detectDuplicatesSystem() },
    {
      role: 'user',
      content:
        `以下是「可能重复」的候选知识对（已预筛），请判断哪些是真正重复/高度相似、建议合并的：\n\n` +
        candidatePairs
          .map((p, idx) => {
            const k1 = knowledges.find((k) => k.id === p.a)!
            const k2 = knowledges.find((k) => k.id === p.b)!
            return `[候选${idx + 1}] ${k1.id} | ${k1.title}：${k1.coreConclusion}\n         vs ${k2.id} | ${k2.title}：${k2.coreConclusion}`
          })
          .join('\n\n'),
    },
  ])

  return suggestions.filter((s) => Array.isArray(s.knowledgeIds) && s.knowledgeIds.length >= 2)
}

// 合并多条知识
export async function mergeKnowledge(userId: string, knowledgeIds: string[]) {
  const items = await prisma.knowledge.findMany({
    where: { id: { in: knowledgeIds }, userId },
    include: { sources: true, tags: true },
  })
  if (items.length < 2) return null

  interface MergeResult {
    title: string
    coreConclusion: string
    briefExplanation?: string
    detailExplanation?: string
    example?: string
    type?: string
    tags?: string[]
  }
  const merged = await chatJSON<MergeResult>([
    { role: 'system', content: mergeKnowledgeSystem() },
    {
      role: 'user',
      content: items
        .map((k) => `标题：${k.title}\n核心结论：${k.coreConclusion}\n详细：${k.detailExplanation ?? ''}\n示例：${k.example ?? ''}`)
        .join('\n\n'),
    },
  ])

  // 合并来源与标签
  const sources = items.flatMap((k) =>
    k.sources.map((s) => ({
      type: s.type,
      detail: s.detail ?? undefined,
      note: s.note ?? undefined,
      occurredAt: s.occurredAt?.toISOString() ?? undefined,
    })),
  )
  const tags = Array.from(new Set([...(merged.tags ?? []), ...items.flatMap((k) => k.tags.map((t) => t.name))]))

  const newKnowledge = await createKnowledge(userId, {
    title: merged.title,
    coreConclusion: merged.coreConclusion,
    briefExplanation: merged.briefExplanation,
    detailExplanation: merged.detailExplanation,
    example: merged.example,
    type: merged.type ?? items[0].type,
    tags,
    sources,
  })

  // 归档旧知识（保留历史，不删除），建立演化关系
  for (const item of items) {
    await prisma.knowledge.update({ where: { id: item.id }, data: { status: 'archived' } })
    try {
      await prisma.knowledgeRelation.create({
        data: {
          fromId: item.id,
          toId: newKnowledge.id,
          type: 'evolution',
          reason: `合并自 ${items.length} 条相似知识`,
          userId,
        },
      })
    } catch {
      // 忽略重复关系
    }
  }

  // 合并后重建新知识与其它知识的关系（P1-6，失败不影响合并结果）
  try {
    await discoverRelations(userId, newKnowledge.id)
  } catch {
    // 关系重建失败静默
  }

  return newKnowledge
}
