import { FastifyInstance } from 'fastify'
import { getDefaultUserId } from '../services/user.service'
import { discuss, confirmKnowledge, summarizeConsensus } from '../services/cocreation.service'
import { describeAnswers, normalizeCards, sanitizeAnswers } from '../ai/cards'

export async function cocreationRoutes(app: FastifyInstance) {
  // 两种提交方式：直接说话（message），或者答完卡片（answers + cards）
  app.post('/api/cocreation/discuss', async (req, reply) => {
    const userId = await getDefaultUserId()
    const { sessionId, message, answers, cards } = req.body as {
      sessionId?: string
      message?: string
      answers?: unknown
      cards?: unknown
    }

    const list = sanitizeAnswers(answers)
    const cardList = normalizeCards(cards)
    const composed =
      list.length > 0 && cardList.length > 0
        ? describeAnswers(cardList, list)
        : (message ?? '').trim()

    if (!composed) return reply.code(400).send({ error: '还没作答' })
    return discuss(userId, sessionId ?? null, composed)
  })

  // P2-1：AI 未自动出共识标记时，用户主动触发总结
  app.post('/api/cocreation/summarize', async (req, reply) => {
    const userId = await getDefaultUserId()
    const { sessionId } = req.body as { sessionId: string }
    if (!sessionId) return reply.code(400).send({ error: '缺少 sessionId' })
    const result = await summarizeConsensus(userId, sessionId)
    if (!result) return reply.code(404).send({ error: '会话不存在或尚无内容' })
    return result
  })

  app.post('/api/cocreation/confirm', async (req, reply) => {
    const userId = await getDefaultUserId()
    const body = req.body as any
    const knowledge = await confirmKnowledge(userId, body.sessionId ?? null, body)
    return reply.code(201).send(knowledge)
  })
}
