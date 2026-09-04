import { prisma } from '../lib/prisma'

// 文件名非法字符清理
function sanitize(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)
}

// 单条知识导出为 Markdown（Obsidian 兼容，wikilink 表达关系）
export async function exportKnowledgeMarkdown(userId: string, id: string): Promise<string | null> {
  const k = await prisma.knowledge.findFirst({
    where: { id, userId },
    include: {
      tags: true,
      sources: true,
      category: true,
      relationsFrom: { include: { to: { select: { title: true } } } },
      relationsTo: { include: { from: { select: { title: true } } } },
    },
  })
  if (!k) return null

  const lines: string[] = []
  lines.push('---')
  lines.push(`title: ${k.title}`)
  lines.push(`type: ${k.type}`)
  lines.push(`tags: [${k.tags.map((t) => t.name).join(', ')}]`)
  lines.push(`status: ${k.status}`)
  lines.push(`created: ${k.createdAt.toISOString().slice(0, 10)}`)
  if (k.category) lines.push(`category: ${k.category.name}`)
  lines.push('---')
  lines.push('')
  lines.push(`# ${k.title}`)
  lines.push('')
  lines.push('## 核心结论')
  lines.push('')
  lines.push(k.coreConclusion)
  if (k.briefExplanation) {
    lines.push('')
    lines.push('## 简洁解释')
    lines.push('')
    lines.push(k.briefExplanation)
  }
  if (k.detailExplanation) {
    lines.push('')
    lines.push('## 详细解释')
    lines.push('')
    lines.push(k.detailExplanation)
  }
  if (k.example) {
    lines.push('')
    lines.push('## 示例')
    lines.push('')
    lines.push(k.example)
  }
  if (k.sources.length) {
    lines.push('')
    lines.push('## 来源')
    lines.push('')
    for (const s of k.sources) {
      const when = s.occurredAt ? ` · ${s.occurredAt.toISOString().slice(0, 10)}` : ''
      lines.push(`- ${s.type}${when}`)
    }
  }
  const related = new Set<string>()
  for (const r of k.relationsFrom) related.add(r.to.title)
  for (const r of k.relationsTo) related.add(r.from.title)
  if (related.size) {
    lines.push('')
    lines.push('## 相关知识')
    lines.push('')
    for (const t of related) lines.push(`- [[${t}]]`)
  }
  return lines.join('\n')
}

// 全部知识导出为 Markdown（文件名 → 内容）
export async function exportAllMarkdown(userId: string) {
  const knowledges = await prisma.knowledge.findMany({
    where: { userId, status: 'active' },
    select: { id: true, title: true },
    orderBy: { updatedAt: 'desc' },
  })
  const result: Record<string, string> = {}
  for (const k of knowledges) {
    const md = await exportKnowledgeMarkdown(userId, k.id)
    if (md) result[`${sanitize(k.title)}.md`] = md
  }
  return result
}

// 全部数据导出为 JSON（数据可迁移，不锁死在任何服务）
export async function exportAllJSON(userId: string) {
  const [knowledges, relations, categories, profile, states] = await Promise.all([
    prisma.knowledge.findMany({
      where: { userId },
      include: { tags: true, sources: true, category: true, versions: true },
    }),
    prisma.knowledgeRelation.findMany({ where: { userId } }),
    prisma.category.findMany(),
    prisma.userProfile.findUnique({ where: { userId } }),
    prisma.userKnowledgeState.findMany({ where: { userId } }),
  ])
  return {
    exportedAt: new Date().toISOString(),
    knowledges,
    relations,
    categories,
    profile,
    states,
  }
}
