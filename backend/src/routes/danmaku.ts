import { FastifyInstance } from 'fastify'
import { getDefaultUserId } from '../services/user.service'
import { getDanmakuPool, backfillBullets } from '../services/bullets.service'

export async function danmakuRoutes(app: FastifyInstance) {
  // 弹幕池：把已收录知识的核心要点展开成一条条弹幕
  app.get('/api/danmaku', async () => {
    const userId = await getDefaultUserId()
    const items = await getDanmakuPool(userId)
    return { items, total: items.length }
  })

  // 回填：给还没有弹幕要点的历史知识补生成
  app.post('/api/danmaku/backfill', async () => {
    const userId = await getDefaultUserId()
    return backfillBullets(userId)
  })
}
