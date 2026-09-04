import { prisma } from '../lib/prisma'

let timer: NodeJS.Timeout | null = null

// 统计到期待复习的知识数量
export async function runDailyReviewCheck(): Promise<number> {
  const now = new Date()
  const due = await prisma.userKnowledgeState.findMany({
    where: { nextReviewAt: { lte: now } },
    include: { knowledge: { select: { status: true } } },
  })
  return due.filter((d) => d.knowledge.status === 'active').length
}

// 启动定时调度：每小时检查一次到期知识
// 未来可在此接入推送 / 邮件等主动提醒渠道
export function startScheduler() {
  if (timer) return
  const CHECK_INTERVAL = 60 * 60 * 1000
  timer = setInterval(async () => {
    try {
      await runDailyReviewCheck()
    } catch {
      // 定时任务错误静默，不影响主流程
    }
  }, CHECK_INTERVAL)
  runDailyReviewCheck().catch(() => {})
}

export function stopScheduler() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
