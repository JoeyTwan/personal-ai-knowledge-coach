import { FastifyInstance } from 'fastify'
import { getDefaultUserId } from '../services/user.service'
import {
  createReviewPlan,
  startReviewSession,
  getNextQuestion,
  submitAnswer,
  getSessionProgress,
} from '../services/coach.service'

export async function reviewRoutes(app: FastifyInstance) {
  app.get('/api/review/plan', async () => {
    const userId = await getDefaultUserId()
    return createReviewPlan(userId)
  })

  app.post('/api/review/session', async (req) => {
    const userId = await getDefaultUserId()
    const { knowledgeIds, type } = req.body as { knowledgeIds?: string[]; type?: string }
    return startReviewSession(userId, knowledgeIds, type)
  })

  app.get('/api/review/session/:id/next', async (req, reply) => {
    const userId = await getDefaultUserId()
    const { id } = req.params as { id: string }
    const q = await getNextQuestion(userId, id)
    if (!q) return reply.code(404).send({ error: '会话不存在' })
    return q
  })

  app.post('/api/review/question/:id/answer', async (req, reply) => {
    const userId = await getDefaultUserId()
    const { id } = req.params as { id: string }
    const { answer } = req.body as { answer: string }
    const result = await submitAnswer(userId, id, answer)
    if (!result) return reply.code(404).send({ error: '题目不存在' })
    return result
  })

  app.get('/api/review/session/:id/progress', async (req, reply) => {
    const userId = await getDefaultUserId()
    const { id } = req.params as { id: string }
    const p = await getSessionProgress(userId, id)
    if (!p) return reply.code(404).send({ error: '会话不存在' })
    return p
  })
}
