import { FastifyInstance } from 'fastify'
import { getDefaultUserId } from '../services/user.service'
import { detectDuplicates } from '../services/merge.service'
import { suggestSplits, splitKnowledge, type SplitPart } from '../services/split.service'
import { prisma } from '../lib/prisma'

interface SuggestionPayload {
  merges: Array<{
    knowledgeIds: string[]
    reason: string
    items: Array<{ id: string; title: string; coreConclusion: string }>
  }>
  splits: Array<unknown>
}

// 建议结果缓存：进页面就要跑两次模型判断，不缓存的话每次刷知识库都在烧钱
const CACHE_MS = 10 * 60 * 1000
let cache: { userId: string; at: number; data: SuggestionPayload } | null = null

export function clearOrganizeCache() {
  cache = null
}

export async function organizeRoutes(app: FastifyInstance) {
  // 整理建议：一次算清「哪几条能合并」和「哪条该拆开」，交给用户定夺
  app.get('/api/organize/suggestions', async (req) => {
    const userId = await getDefaultUserId()
    const { refresh } = req.query as { refresh?: string }

    if (!refresh && cache && cache.userId === userId && Date.now() - cache.at < CACHE_MS) {
      return cache.data
    }

    // 两次模型调用串行跑：并发发出容易撞上限流，结果是两个都拿不到
    const mergeGroups = await detectDuplicates(userId).catch((e) => {
      console.error('[整理建议] 合并检测失败', e)
      return [] as Array<{ knowledgeIds: string[]; reason?: string }>
    })
    const splits = await suggestSplits(userId).catch((e) => {
      console.error('[整理建议] 拆分检测失败', e)
      return []
    })

    // 补上标题与结论，用户不用点进去就知道建议动的是哪几条
    const ids = Array.from(new Set(mergeGroups.flatMap((g) => g.knowledgeIds)))
    const briefs = await prisma.knowledge.findMany({
      where: { id: { in: ids } },
      select: { id: true, title: true, coreConclusion: true },
    })
    const briefOf = new Map(briefs.map((b) => [b.id, b]))

    const data: SuggestionPayload = {
      merges: mergeGroups
        .map((g) => ({
          knowledgeIds: g.knowledgeIds,
          reason: g.reason ?? '',
          items: g.knowledgeIds.map((id) => briefOf.get(id)).filter(Boolean) as SuggestionPayload['merges'][number]['items'],
        }))
        .filter((g) => g.items.length >= 2),
      splits: splits as unknown[],
    }

    cache = { userId, at: Date.now(), data }
    return data
  })

  // 执行拆分：用的是用户在建议里点头的那份方案，不重新问模型
  app.post('/api/organize/split', async (req, reply) => {
    const userId = await getDefaultUserId()
    const { knowledgeId, parts } = req.body as { knowledgeId?: string; parts?: SplitPart[] }
    if (!knowledgeId || !Array.isArray(parts) || parts.length < 2) {
      return reply.code(400).send({ error: '拆分至少要两条，且要指明原知识' })
    }
    for (const p of parts) {
      if (!p?.title || !p?.coreConclusion) {
        return reply.code(400).send({ error: '拆分出来的每条都要有标题和核心结论' })
      }
    }

    const created = await splitKnowledge(userId, knowledgeId, parts)
    if (!created) {
      return reply.code(404).send({ error: '这条知识不存在，或已经不在知识库里了' })
    }
    clearOrganizeCache()
    return { ok: true, created: created.map((k) => ({ id: k.id, title: k.title })) }
  })
}
