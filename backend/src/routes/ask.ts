import { FastifyInstance } from 'fastify'
import { getDefaultUserId } from '../services/user.service'
import { ask } from '../services/recall.service'

export async function askRoutes(app: FastifyInstance) {
  app.post('/api/ask', async (req) => {
    const userId = await getDefaultUserId()
    const { question, history } = req.body as {
      question: string
      history?: { role: 'user' | 'assistant'; content: string }[]
    }
    return ask(userId, question, history ?? [])
  })
}
