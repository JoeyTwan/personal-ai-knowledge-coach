import { FastifyInstance } from 'fastify'
import { getDefaultUserId } from '../services/user.service'
import { detectDuplicates, mergeKnowledge } from '../services/merge.service'

export async function mergeRoutes(app: FastifyInstance) {
  app.post('/api/merge/detect', async () => {
    const userId = await getDefaultUserId()
    return detectDuplicates(userId)
  })

  app.post('/api/merge', async (req) => {
    const userId = await getDefaultUserId()
    const { knowledgeIds } = req.body as { knowledgeIds: string[] }
    return mergeKnowledge(userId, knowledgeIds)
  })
}
