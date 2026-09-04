import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma'
import { getDefaultUserId } from '../services/user.service'
import { getProfile, refreshProfile, recommendLearning, discoverGaps, listGaps } from '../services/profile.service'

export async function profileRoutes(app: FastifyInstance) {
  app.get('/api/profile', async () => {
    const userId = await getDefaultUserId()
    return getProfile(userId)
  })

  app.post('/api/profile/refresh', async () => {
    const userId = await getDefaultUserId()
    return refreshProfile(userId)
  })

  app.get('/api/recommendations', async () => {
    const userId = await getDefaultUserId()
    return prisma.learningRecommendation.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    })
  })

  app.post('/api/recommendations/generate', async () => {
    const userId = await getDefaultUserId()
    return recommendLearning(userId)
  })

  app.get('/api/gaps', async () => {
    const userId = await getDefaultUserId()
    return listGaps(userId)
  })

  app.post('/api/gaps/discover', async () => {
    const userId = await getDefaultUserId()
    return discoverGaps(userId)
  })
}
