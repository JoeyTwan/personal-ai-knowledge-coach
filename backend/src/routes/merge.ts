import { FastifyInstance } from 'fastify'
import { getDefaultUserId } from '../services/user.service'
import { detectDuplicates, mergeKnowledge } from '../services/merge.service'
import { clearOrganizeCache } from './organize'

export async function mergeRoutes(app: FastifyInstance) {
  app.post('/api/merge/detect', async () => {
    const userId = await getDefaultUserId()
    return detectDuplicates(userId)
  })

  app.post('/api/merge', async (req) => {
    const userId = await getDefaultUserId()
    const { knowledgeIds } = req.body as { knowledgeIds: string[] }
    const result = await mergeKnowledge(userId, knowledgeIds)
    // 合并改变了知识库结构，整理建议要重新算
    clearOrganizeCache()
    return result
  })
}
