import Fastify from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import { knowledgeRoutes } from './routes/knowledge'
import { cocreationRoutes } from './routes/cocreation'
import { relationRoutes } from './routes/relation'
import { askRoutes } from './routes/ask'
import { reviewRoutes } from './routes/review'
import { profileRoutes } from './routes/profile'
import { mergeRoutes } from './routes/merge'
import { exportRoutes } from './routes/export'
import { danmakuRoutes } from './routes/danmaku'
import { cognitionRoutes } from './routes/cognition'
import { materialRoutes } from './routes/material'

export function buildServer() {
  const app = Fastify({ logger: true })

  app.register(cors, { origin: true })
  // 材料上传：单文件，最大 12MB（手机照片与文档都够）
  app.register(multipart, { limits: { fileSize: 12 * 1024 * 1024, files: 1 } })

  app.get('/api/health', async () => ({
    ok: true,
    service: 'personal-ai-knowledge-coach',
    time: new Date().toISOString(),
  }))

  app.register(knowledgeRoutes)
  app.register(cocreationRoutes)
  app.register(relationRoutes)
  app.register(askRoutes)
  app.register(reviewRoutes)
  app.register(profileRoutes)
  app.register(mergeRoutes)
  app.register(exportRoutes)
  app.register(danmakuRoutes)
  app.register(cognitionRoutes)
  app.register(materialRoutes)

  return app
}
