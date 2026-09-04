import Fastify from 'fastify'
import cors from '@fastify/cors'
import { knowledgeRoutes } from './routes/knowledge'
import { cocreationRoutes } from './routes/cocreation'
import { relationRoutes } from './routes/relation'
import { askRoutes } from './routes/ask'
import { reviewRoutes } from './routes/review'
import { profileRoutes } from './routes/profile'
import { mergeRoutes } from './routes/merge'

export function buildServer() {
  const app = Fastify({ logger: true })

  app.register(cors, { origin: true })

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

  return app
}
