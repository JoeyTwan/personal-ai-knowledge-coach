import { prisma } from '../lib/prisma'
import { chatJSON } from '../ai/client'
import { detectSplitsSystem } from '../ai/prompts'
import { createKnowledge, type MasteryPreset } from './knowledge.service'
import { discoverRelations } from './relation.service'

// AI 给出的拆分片段（结构与 Knowledge 对齐，方便直接落库）
export interface SplitPart {
  title: string
  coreConclusion: string
  briefExplanation?: string
  detailExplanation?: string
  example?: string
  type?: string
  tags?: string[]
}

export interface SplitSuggestion {
  knowledgeId: string
  title: string
  reason: string
  parts: SplitPart[]
}

// 启发式预筛：只把「看起来塞了多件事」的知识送去让 AI 判断，省调用
// 判断信号：分点符号多、核心结论里有并列连接词、正文特别长
function looksLikeMultiTopic(k: { coreConclusion: string; detailExplanation: string | null }): boolean {
  const text = `${k.coreConclusion}\n${k.detailExplanation ?? ''}`
  if (text.length < 140) return false

  const bulletMarks = (
    text.match(/(^|\n)\s*(?:[一二三四五六七八九十]+[、.．]|\(?\d+[)）.．、]|[①②③④⑤⑥⑦⑧⑨⑩]|[-*•·])/g) ?? []
  ).length
  const conjunctions = (k.coreConclusion.match(/、|和|与|以及|同时|另外|还有/g) ?? []).length

  return bulletMarks >= 3 || (bulletMarks >= 2 && conjunctions >= 2) || text.length >= 700
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

// 发现「一条知识里混了多个主题、建议拆开」的情况
export async function suggestSplits(userId: string): Promise<SplitSuggestion[]> {
  const knowledges = await prisma.knowledge.findMany({
    where: { userId, status: 'active' },
    select: { id: true, title: true, coreConclusion: true, detailExplanation: true },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  })

  const candidates = knowledges.filter((k) => looksLikeMultiTopic(k))
  if (candidates.length === 0) return []

  const raw = await chatJSON<Array<{ knowledgeId: string; reason?: string; parts?: SplitPart[] }>>(
    [
      { role: 'system', content: detectSplitsSystem() },
      {
        role: 'user',
        content: candidates
          .map(
            (k) =>
              `[${k.id}] ${k.title}\n核心结论：${k.coreConclusion}\n详细：${(k.detailExplanation ?? '').slice(0, 1200)}`,
          )
          .join('\n\n'),
      },
    ],
    // 拆分方案要把每条新知识的正文都写出来，加上模型自己的思考开销，
    // 4096 只够拆一条，给足余量避免正文被截空
    { maxTokens: 8192 },
  )

  return raw
    .filter(
      (s) =>
        typeof s.knowledgeId === 'string' &&
        Array.isArray(s.parts) &&
        s.parts.length >= 2 &&
        s.parts.every((p) => p?.title && p?.coreConclusion),
    )
    .map((s) => {
      const origin = candidates.find((c) => c.id === s.knowledgeId)!
      return {
        knowledgeId: s.knowledgeId,
        title: origin.title,
        reason: s.reason ?? '',
        parts: s.parts!.map((p) => ({
          title: p.title,
          coreConclusion: p.coreConclusion,
          briefExplanation: p.briefExplanation,
          detailExplanation: p.detailExplanation,
          example: p.example,
          type: p.type,
          tags: p.tags,
        })),
      }
    })
}

// 按用户确认的方案落库：原知识归档，拆出的新知识继承分类、来源与掌握度
export async function splitKnowledge(userId: string, knowledgeId: string, parts: SplitPart[]) {
  const origin = await prisma.knowledge.findFirst({
    where: { id: knowledgeId, userId },
    include: { sources: true, tags: true },
  })
  if (!origin || parts.length < 2) return null

  const sources = origin.sources.map((s) => ({
    type: s.type,
    detail: s.detail ?? undefined,
    note: s.note ?? undefined,
    occurredAt: s.occurredAt?.toISOString() ?? undefined,
  }))
  const originTags = origin.tags.map((t) => t.name)

  // 拆分不改变「用户学过这件事」，掌握度按原状态略降继承，稳定维度掉得更多
  const originState = await prisma.userKnowledgeState.findUnique({
    where: { userId_knowledgeId: { userId, knowledgeId } },
  })
  const mastery: MasteryPreset | undefined = originState
    ? {
        awareness: clamp01(originState.awareness * 0.95),
        recall: clamp01(originState.recall * 0.9),
        understanding: clamp01(originState.understanding * 0.9),
        association: clamp01(originState.association * 0.85),
        application: clamp01(originState.application * 0.9),
        stability: clamp01(originState.stability * 0.75),
      }
    : undefined

  const created = []
  for (const p of parts) {
    const k = await createKnowledge(userId, {
      title: p.title,
      coreConclusion: p.coreConclusion,
      briefExplanation: p.briefExplanation ?? null,
      detailExplanation: p.detailExplanation ?? null,
      example: p.example ?? null,
      type: p.type ?? origin.type,
      categoryPath: undefined,
      tags: Array.from(new Set([...(p.tags ?? []), ...originTags])),
      sources,
      mastery,
    })
    // 拆出来的知识留在原知识的分类下，不因为拆分就从目录里掉队
    if (origin.categoryId) {
      await prisma.knowledge.update({ where: { id: k.id }, data: { categoryId: origin.categoryId } })
    }
    created.push(k)
  }

  await prisma.knowledge.update({ where: { id: origin.id }, data: { status: 'archived' } })

  for (const k of created) {
    try {
      await prisma.knowledgeRelation.create({
        data: {
          fromId: origin.id,
          toId: k.id,
          type: 'evolution',
          reason: `拆分为 ${created.length} 条知识`,
          userId,
        },
      })
    } catch (e) {
      console.error('[知识拆分] 建立演化关系失败', e)
    }
    try {
      await discoverRelations(userId, k.id)
    } catch (e) {
      console.error('[知识拆分] 关系重建失败', e)
    }
  }

  return created
}
