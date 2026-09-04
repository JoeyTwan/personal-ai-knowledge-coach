import { FastifyInstance } from 'fastify'
import { getDefaultUserId } from '../services/user.service'
import { discuss, confirmKnowledge, summarizeConsensus } from '../services/cocreation.service'

export async function cocreationRoutes(app: FastifyInstance) {
  app.post('/api/cocreation/discuss', async (req) => {
    const userId = await getDefaultUserId()
    const { sessionId, message } = req.body as { sessionId?: string; message: string }
    return discuss(userId, sessionId ?? null, message)
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
