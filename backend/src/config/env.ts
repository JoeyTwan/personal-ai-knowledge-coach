import path from 'path'
import { config as loadEnv } from 'dotenv'

// 从 backend/src/config 向上三级定位到项目根目录，加载根目录的 .env
loadEnv({ path: path.resolve(__dirname, '../../../.env') })

export const env = {
  deepseekApiKey: process.env.DEEPSEEK_API_KEY ?? '',
  deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
  deepseekModel: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
  databaseUrl: process.env.DATABASE_URL ?? 'file:./dev.db',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  backendPort: Number(process.env.BACKEND_PORT ?? 8787),
  // 生产部署时设为 127.0.0.1，只允许前端转发访问，不对公网暴露
  backendHost: process.env.BACKEND_HOST ?? '0.0.0.0',
}

export const hasAIKey = () => env.deepseekApiKey.length > 0
