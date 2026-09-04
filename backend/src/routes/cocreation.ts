import { FastifyInstance } from 'fastify'
import { getDefaultUserId } from '../services/user.service'
import { discuss, confirmKnowledge } from '../services/cocreation.service'

export async function cocreationRoutes(app: FastifyInstance) {
  app.post('/api/cocreation/discuss', async (req) => {
    const userId = await getDefaultUserId()
    const { sessionId, message } = req.body as { sessionId?: string; message: string }
    return discuss(userId, sessionId ?? null, message)
  })

  app.post('/api/cocreation/confirm', async (req, reply) => {
    const userId = await getDefaultUserId()
    const body = req.body as any
    const knowledge = await confirmKnowledge(userId, body.sessionId ?? null, body)
    return reply.code(201).send(knowledge)
  })
}
