import { prisma } from '../lib/prisma'
import { chat } from '../ai/client'
import { askSystem } from '../ai/prompts'
import { getProfileText } from './user.service'
import { tokenize } from '../lib/jieba'

// 检索相关知识：jieba 中文分词 + 多词 OR 匹配 + 按命中词数排序。
// 不再退回「最近知识」做假召回，避免把不相关知识喂给 AI 污染回答。
export async function searchKnowledge(userId: string, question: string) {
  const tokens = tokenize(question)
  if (tokens.length === 0) {
    return []
  }

  // 拉取所有命中任意分词的知识作为候选
  const candidates = await prisma.knowledge.findMany({
    where: {
      userId,
      status: 'active',
      OR: tokens.map((t) => ({
        OR: [
          { title: { contains: t } },
          { coreConclusion: { contains: t } },
          { detailExplanation: { contains: t } },
        ],
      })),
    },
    orderBy: { updatedAt: 'desc' },
    take: 50,
    include: { tags: true, sources: true },
  })

  // 按命中词数降序排序，命中越多越相关；过滤掉零命中，取前 10
  const scored = candidates
    .map((k) => {
      const haystack = `${k.title} ${k.coreConclusion} ${k.detailExplanation ?? ''}`
      const hitCount = tokens.filter((t) => haystack.includes(t)).length
      return { k, hitCount }
    })
    .filter((s) => s.hitCount > 0)
    .sort((a, b) => b.hitCount - a.hitCount)
    .slice(0, 10)

  return scored.map((s) => s.k)
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
