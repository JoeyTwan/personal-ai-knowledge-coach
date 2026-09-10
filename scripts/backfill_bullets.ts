// 一次性回填：给还没有「弹幕要点」的历史知识补生成
import '../backend/src/config/env'
import { prisma } from '../backend/src/lib/prisma'
import { getDefaultUserId } from '../backend/src/services/user.service'
import { backfillBullets, parseBullets } from '../backend/src/services/bullets.service'

async function main() {
  const userId = await getDefaultUserId()
  const before = await prisma.knowledge.findMany({
    where: { userId, status: 'active' },
    select: { id: true, title: true, bullets: true },
  })

  console.log(`活跃知识共 ${before.length} 条`)
  for (const k of before) {
    const n = parseBullets(k.bullets).length
    console.log(`  ${n >= 2 ? '已有' : '待补'} · ${k.title}（${n} 条要点）`)
  }

  const result = await backfillBullets(userId)
  console.log(`\n回填完成：共 ${result.total} 条，本次补生成 ${result.filled} 条`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
