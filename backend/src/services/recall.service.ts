import { prisma } from '../lib/prisma'
import { chat } from '../ai/client'
import { askSystem } from '../ai/prompts'
import { getProfileText } from './user.service'

// 简单分词：按标点/空白分割，取长度 >= 2 的片段
function tokenize(text: string): string[] {
  return text
    .split(/[\s，。？！、；：""''（）()\[\]【】,.!?;:]+/)
    .filter((t) => t.length >= 2)
    .slice(0, 10)
}

// 检索相关知识：关键词匹配，匹配不足时退回最近知识
export async function searchKnowledge(userId: string, question: string) {
  const tokens = tokenize(question)
  const orConditions = tokens.map((t) => ({
    OR: [
      { title: { contains: t } },
      { coreConclusion: { contains: t } },
      { detailExplanation: { contains: t } },
    ],
  }))

  let results = await prisma.knowledge.findMany({
    where: orConditions.length
      ? { userId, status: 'active', OR: orConditions }
      : { userId, status: 'active' },
    orderBy: { updatedAt: 'desc' },
    take: 10,
    include: { tags: true, sources: true },
  })

  if (results.length === 0) {
    results = await prisma.knowledge.findMany({
      where: { userId, status: 'active' },
      orderBy: { updatedAt: 'desc' },
      take: 10,
      include: { tags: true, sources: true },
    })
  }
  return results
}

export async function ask(userId: string, question: string) {
  const related = await searchKnowledge(userId, question)
  const profile = await getProfileText(userId)

  const knowledgeContext = related.length
    ? related
        .map((k, i) => {
          const parts = [
            `[知识${i + 1}] 标题：${k.title}`,
            `核心结论：${k.coreConclusion}`,
          ]
          if (k.detailExplanation) parts.push(`详细解释：${k.detailExplanation}`)
          parts.push(`记录时间：${k.createdAt.toISOString().slice(0, 10)}`)
          const src = k.sources.map((s) => s.type).filter(Boolean)
          if (src.length) parts.push(`来源：${src.join('、')}`)
          return parts.join('\n')
        })
        .join('\n\n')
    : '（知识库中暂无相关信息）'

  const userPrompt = `用户问题：${question}

以下是用户知识库中可能相关的知识：
${knowledgeContext}

请回答用户问题。优先引用知识库内容，并明确区分「知识库已有的信息」和「AI 当前补充的信息」。`

  const answer = await chat([
    { role: 'system', content: askSystem(profile) },
    { role: 'user', content: userPrompt },
  ])

  return {
    answer,
    related: related.map((k) => ({
      id: k.id,
      title: k.title,
      coreConclusion: k.coreConclusion,
      createdAt: k.createdAt,
    })),
  }
}
