// 一次性重建：归档早期无「学到什么程度 / 所属领域」的旧断层，按新提示词重新生成一套
import '../backend/src/config/env'
import { prisma } from '../backend/src/lib/prisma'
import { getDefaultUserId } from '../backend/src/services/user.service'
import { discoverGaps, enrichGaps } from '../backend/src/services/profile.service'

async function main() {
  const userId = await getDefaultUserId()

  const before = await prisma.knowledgeGap.findMany({
    where: { userId, status: 'open' },
    select: { id: true, targetDepth: true, area: true },
  })
  console.log(`当前未处理断层 ${before.length} 条`)

  const archived = await prisma.knowledgeGap.updateMany({
    where: { userId, status: 'open' },
    data: { status: 'archived' },
  })
  console.log(`已归档 ${archived.count} 条旧记录`)

  const created = await discoverGaps(userId)
  console.log(`重新生成 ${created.length} 条`)
  for (const g of created) {
    console.log(`  · ${g.gapDescription}`)
    console.log(`    深度 ${g.targetDepth ?? '（待补）'}｜领域 ${g.area ?? '（待补）'}`)
  }

  const filled = await enrichGaps(userId)
  console.log(`补全字段 ${filled} 条`)

  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error('执行失败', e)
  await prisma.$disconnect()
  process.exit(1)
})
