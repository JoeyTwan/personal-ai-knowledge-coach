// 一次性回填：把历史来源「AI 讨论」改为「自己思考的」（来源固定三类后）
import '../backend/src/config/env'
import { prisma } from '../backend/src/lib/prisma'

async function main() {
  const all = await prisma.knowledgeSource.findMany({ select: { type: true } })
  const dist: Record<string, number> = {}
  for (const s of all) dist[s.type] = (dist[s.type] ?? 0) + 1
  console.log('回填前来源类型分布：', dist)

  // 统一归一到固定三类：社交媒体/博客等、听别人说的、自己思考的
  const mapping: Record<string, string> = {
    'AI 讨论': '自己思考的',
    自己总结: '自己思考的',
    客户交流: '听别人说的',
  }
  for (const [from, to] of Object.entries(mapping)) {
    const r = await prisma.knowledgeSource.updateMany({ where: { type: from }, data: { type: to } })
    console.log(`「${from}」→「${to}」：${r.count} 条`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
