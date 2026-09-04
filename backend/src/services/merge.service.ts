import { prisma } from '../lib/prisma'
import { chatJSON } from '../ai/client'
import { detectDuplicatesSystem, mergeKnowledgeSystem } from '../ai/prompts'
import { createKnowledge } from './knowledge.service'

// 发现重复 / 高度相似知识
export async function detectDuplicates(userId: string) {
  const knowledges = await prisma.knowledge.findMany({
    where: { userId, status: 'active' },
    select: { id: true, title: true, coreConclusion: true },
    orderBy: { updatedAt: 'desc' },
    take: 60,
  })
  if (knowledges.length < 2) return []

  const suggestions = await chatJSON<Array<{ knowledgeIds: string[]; reason?: string }>>([
    { role: 'system', content: detectDuplicatesSystem() },
    {
      role: 'user',
      content: knowledges.map((k) => `[${k.id}] ${k.title}：${k.coreConclusion}`).join('\n'),
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

  return newKnowledge
}
