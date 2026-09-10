import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma'
import { getDefaultUserId } from '../services/user.service'
import {
  clearCorrection,
  correctInsight,
  getCognition,
  refreshCognition,
} from '../services/cognition.service'

export async function cognitionRoutes(app: FastifyInstance) {
  app.get('/api/cognition', async () => {
    const userId = await getDefaultUserId()
    return getCognition(userId)
  })

  // 重新生成 AI 判断（前端在缓存过期时后台调用）
  app.post('/api/cognition/refresh', async () => {
    const userId = await getDefaultUserId()
    await refreshCognition(userId)
    return getCognition(userId)
  })

  // 用户纠正某条 AI 判断
  app.post('/api/cognition/correct', async (req) => {
    const userId = await getDefaultUserId()
    const { type, corrected } = req.body as { type?: string; corrected?: string }
    if (!type || !corrected?.trim()) return { ok: false, error: '缺少 type 或 corrected' }
    await correctInsight(userId, type, corrected.trim())
    return getCognition(userId)
  })

  // 撤销纠正
  app.post('/api/cognition/correct/clear', async (req) => {
    const userId = await getDefaultUserId()
    const { type } = req.body as { type?: string }
    if (!type) return { ok: false, error: '缺少 type' }
    await clearCorrection(userId, type)
    return getCognition(userId)
  })

  // 成长目标由用户自己修改，AI 只做推断作为补充
  app.patch('/api/cognition/goals', async (req) => {
    const userId = await getDefaultUserId()
    const body = req.body as {
      growthGoals?: string[]
      longTermGoals?: string[]
      desiredAbilities?: string[]
    }
    const data: Record<string, unknown> = {}
    if (Array.isArray(body.growthGoals)) data.growthGoals = JSON.stringify(body.growthGoals)
    if (Array.isArray(body.longTermGoals)) data.longTermGoals = JSON.stringify(body.longTermGoals)
    if (Array.isArray(body.desiredAbilities)) data.desiredAbilities = JSON.stringify(body.desiredAbilities)
    if (Object.keys(data).length === 0) return getCognition(userId)

    const existing = await prisma.userProfile.findUnique({ where: { userId } })
    if (existing) {
      await prisma.userProfile.update({ where: { userId }, data: data as never })
    } else {
      await prisma.userProfile.create({ data: { userId, ...data } as never })
    }
    return getCognition(userId)
  })
}
