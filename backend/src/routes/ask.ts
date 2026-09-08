import { FastifyInstance } from 'fastify'
import { getDefaultUserId } from '../services/user.service'
import {
  ask,
  listAskSessions,
  getAskSession,
  deleteAskSession,
} from '../services/recall.service'

export async function askRoutes(app: FastifyInstance) {
  app.post('/api/ask', async (req) => {
    const userId = await getDefaultUserId()
    const { question, history, sessionId } = req.body as {
      question: string
      history?: { role: 'user' | 'assistant'; content: string }[]
      sessionId?: string
    }
    return ask(userId, question, history ?? [], sessionId)
  })

  // 历史会话列表
  app.get('/api/ask/sessions', async () => {
    const userId = await getDefaultUserId()
    return listAskSessions(userId)
  })

  // 单个会话的完整消息
  app.get('/api/ask/sessions/:id', async (req, reply) => {
    const userId = await getDefaultUserId()
    const { id } = req.params as { id: string }
    const session = await getAskSession(userId, id)
    if (!session) {
      return reply.code(404).send({ error: '会话不存在' })
    }
    return session
  })

  // 删除会话
  app.delete('/api/ask/sessions/:id', async (req, reply) => {
    const userId = await getDefaultUserId()
    const { id } = req.params as { id: string }
    const result = await deleteAskSession(userId, id)
    if (!result) {
      return reply.code(404).send({ error: '会话不存在' })
    }
    return result
  })
}
