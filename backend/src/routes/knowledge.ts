import { FastifyInstance } from 'fastify'
import { getDefaultUserId } from '../services/user.service'
import {
  createKnowledge,
  listKnowledge,
  getKnowledge,
  updateKnowledge,
  setKnowledgeStatus,
  deleteKnowledge,
} from '../services/knowledge.service'

export async function knowledgeRoutes(app: FastifyInstance) {
  app.post('/api/knowledge', async (req, reply) => {
    const userId = await getDefaultUserId()
    const knowledge = await createKnowledge(userId, req.body as any)
    return reply.code(201).send(knowledge)
  })

  app.get('/api/knowledge', async (req) => {
    const userId = await getDefaultUserId()
    const q = req.query as Record<string, string | undefined>
    return listKnowledge(userId, {
      search: q.search,
      categoryId: q.categoryId,
      status: q.status,
      type: q.type,
    })
  })

  app.get('/api/knowledge/:id', async (req, reply) => {
    const userId = await getDefaultUserId()
    const { id } = req.params as { id: string }
    const k = await getKnowledge(userId, id)
    if (!k) return reply.code(404).send({ error: '知识不存在' })
    return k
  })

  app.patch('/api/knowledge/:id', async (req, reply) => {
    const userId = await getDefaultUserId()
    const { id } = req.params as { id: string }
    const k = await updateKnowledge(userId, id, req.body as any)
    if (!k) return reply.code(404).send({ error: '知识不存在' })
    return k
  })

  app.post('/api/knowledge/:id/status', async (req, reply) => {
    const userId = await getDefaultUserId()
    const { id } = req.params as { id: string }
    const { status } = req.body as { status: string }
    const k = await setKnowledgeStatus(userId, id, status)
    if (!k) return reply.code(404).send({ error: '知识不存在' })
    return k
  })

  app.delete('/api/knowledge/:id', async (req, reply) => {
    const userId = await getDefaultUserId()
    const { id } = req.params as { id: string }
    const k = await deleteKnowledge(userId, id)
    if (!k) return reply.code(404).send({ error: '知识不存在' })
    return { ok: true }
  })
}
