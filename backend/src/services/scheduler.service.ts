import { prisma } from '../lib/prisma'
import { getDefaultUserId } from './user.service'
import { refreshProfile, discoverGaps, recommendLearning } from './profile.service'

let timer: NodeJS.Timeout | null = null
let lastMaintenanceDate: string | null = null

// 统计到期待复习的知识数量
export async function runDailyReviewCheck(): Promise<number> {
  const now = new Date()
  const due = await prisma.userKnowledgeState.findMany({
    where: { nextReviewAt: { lte: now } },
    include: { knowledge: { select: { status: true } } },
  })
  return due.filter((d) => d.knowledge.status === 'active').length
}

// 每日维护：刷新画像 + 发现断层 + 生成推荐（每天只执行一次，避免重复消耗 LLM）
export async function runDailyMaintenance(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10)
  if (lastMaintenanceDate === today) return
  lastMaintenanceDate = today

  const userId = await getDefaultUserId()
  const count = await prisma.knowledge.count({ where: { userId, status: 'active' } })
  if (count === 0) return // 无知识，无需维护

  try {
    await refreshProfile(userId)
  } catch (e) {
    console.error('[每日维护] 画像刷新失败', e)
  }

  if (count >= 3) {
    try {
      await discoverGaps(userId)
    } catch (e) {
      console.error('[每日维护] 断层发现失败', e)
    }
    try {
      await recommendLearning(userId)
    } catch (e) {
      console.error('[每日维护] 学习推荐失败', e)
    }
  }
}

// 启动定时调度：每小时检查一次到期知识 + 每日维护
// 未来可在此接入推送 / 邮件等主动提醒渠道
export function startScheduler() {
  if (timer) return
  const CHECK_INTERVAL = 60 * 60 * 1000
  timer = setInterval(async () => {
    try {
      await runDailyReviewCheck()
    } catch (e) {
      console.error('[定时任务] 复习检查失败', e)
    }
    try {
      await runDailyMaintenance()
    } catch (e) {
      console.error('[定时任务] 每日维护失败', e)
    }
  }, CHECK_INTERVAL)
  runDailyReviewCheck().catch((e) => console.error('[定时任务] 初始复习检查失败', e))
  runDailyMaintenance().catch((e) => console.error('[定时任务] 初始每日维护失败', e))
}

export function stopScheduler() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
