import { buildServer } from './server'
import { env } from './config/env'
import { getDefaultUserId } from './services/user.service'
import { startScheduler } from './services/scheduler.service'

const app = buildServer()

app.listen({ port: env.backendPort, host: '0.0.0.0' }, async (err) => {
  if (err) {
    app.log.error(err)
    process.exit(1)
  }
  // 启动时确保默认用户存在
  try {
    await getDefaultUserId()
  } catch (e) {
    app.log.error(`初始化默认用户失败（请确认已执行 npm run db:push）：${e instanceof Error ? e.message : String(e)}`)
  }
  // 启动每周主动复习的定时调度
  startScheduler()
  app.log.info(`后端已启动: http://localhost:${env.backendPort}`)
})
