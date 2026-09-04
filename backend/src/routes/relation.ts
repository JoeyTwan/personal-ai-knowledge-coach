import { FastifyInstance } from 'fastify'
import { getDefaultUserId } from '../services/user.service'
import { discoverRelations, getGraph, getKnowledgeRelations } from '../services/relation.service'

export async function relationRoutes(app: FastifyInstance) {
  app.get('/api/graph', async () => {
    const userId = await getDefaultUserId()
    return getGraph(userId)
  })

  app.get('/api/knowledge/:id/relations', async (req) => {
    const userId = await getDefaultUserId()
    const { id } = req.params as { id: string }
    return getKnowledgeRelations(userId, id)
  })

  app.post('/api/knowledge/:id/discover-relations', async (req) => {
    const userId = await getDefaultUserId()
    const { id } = req.params as { id: string }
    return discoverRelations(userId, id)
  })
}
