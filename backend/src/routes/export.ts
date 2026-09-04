import { FastifyInstance } from 'fastify'
import { getDefaultUserId } from '../services/user.service'
import { exportKnowledgeMarkdown, exportAllMarkdown, exportAllJSON } from '../services/export.service'

export async function exportRoutes(app: FastifyInstance) {
  // 单条知识导出为 Markdown（Obsidian 兼容）
  app.get('/api/knowledge/:id/export', async (req, reply) => {
    const userId = await getDefaultUserId()
    const { id } = req.params as { id: string }
    const md = await exportKnowledgeMarkdown(userId, id)
    if (!md) return reply.code(404).send({ error: '知识不存在' })
    reply.header('Content-Type', 'text/markdown; charset=utf-8')
    return md
  })

  // 全部知识导出为 Markdown（文件名 → 内容）
  app.get('/api/export/markdown', async () => {
    const userId = await getDefaultUserId()
    return exportAllMarkdown(userId)
  })

  // 全部数据导出为 JSON（可迁移）
  app.get('/api/export/json', async () => {
    const userId = await getDefaultUserId()
    return exportAllJSON(userId)
  })
}
