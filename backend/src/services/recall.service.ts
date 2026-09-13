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

  // 拉取所有命中任意分词的知识作为候选（标题、结论、解释、示例、标签、分类名都参与匹配）
  const candidates = await prisma.knowledge.findMany({
    where: {
      userId,
      status: 'active',
      OR: tokens.map((t) => ({
        OR: [
          { title: { contains: t } },
          { coreConclusion: { contains: t } },
          { briefExplanation: { contains: t } },
          { detailExplanation: { contains: t } },
          { example: { contains: t } },
          // 要点清单是原料知识的完整落地，检索必须带上它，
          // 否则收录时补上的细节在问答里仍然搜不到
          { keyPoints: { contains: t } },
          { tags: { some: { name: { contains: t } } } },
          { category: { name: { contains: t } } },
        ],
      })),
    },
    orderBy: { updatedAt: 'desc' },
    take: 50,
    include: { tags: true, sources: true, category: true },
  })

  // 按命中词数降序排序，命中越多越相关；过滤掉零命中，取前 10
  const scored = candidates
    .map((k) => {
      const tagNames = k.tags.map((t) => t.name).join(' ')
      // 一律转小写再比：技术词大小写混着写是常态（自己敲 nvme，笔记里写 NVMe），
      // 之前这里大小写敏感，小写提问会把明明命中的知识当成零命中丢掉
      const haystack = `${k.title} ${k.coreConclusion} ${k.briefExplanation ?? ''} ${k.detailExplanation ?? ''} ${k.example ?? ''} ${k.keyPoints ?? ''} ${tagNames} ${k.category?.name ?? ''}`.toLowerCase()
      const hitCount = tokens.filter((t) => haystack.includes(t.toLowerCase())).length
      return { k, hitCount }
    })
    .filter((s) => s.hitCount > 0)
    .sort((a, b) => b.hitCount - a.hitCount)
    .slice(0, 10)

  return scored.map((s) => s.k)
}

interface BlindSpots {
  gaps: string[]
  weakDirections: string[]
  weakKnowledges: string[]
}

// 汇总用户的「盲区材料」：知识断层 + 画像里的薄弱方向 + 掌握较弱的知识
// 这三份材料让 AI 在回答末尾能说出「你哪里不足」，而不是只做知识检索
async function getBlindSpots(userId: string): Promise<BlindSpots> {
  const [gaps, states, profile] = await Promise.all([
    prisma.knowledgeGap.findMany({
      where: { userId, status: 'open' },
      orderBy: { createdAt: 'desc' },
      take: 6,
      select: { gapDescription: true, reason: true },
    }),
    prisma.userKnowledgeState.findMany({
      where: { userId, knowledge: { status: 'active' } },
      include: { knowledge: { select: { title: true } } },
    }),
    prisma.userProfile.findUnique({ where: { userId }, select: { weakDirections: true } }),
  ])

  const weakKnowledges = states
    .map((s) => {
      const avg =
        (s.awareness + s.recall + s.understanding + s.association + s.application + s.stability) / 6
      return { title: s.knowledge.title, avg, forgetRisk: s.forgetRisk ?? 0, reviewCount: s.reviewCount }
    })
    .filter((s) => s.avg < 0.5 || s.forgetRisk >= 0.4)
    .sort((a, b) => a.avg - b.avg)
    .slice(0, 6)
    .map((s) => `${s.title}（掌握度约 ${Math.round(s.avg * 100)}%，自测 ${s.reviewCount} 次）`)

  let weakDirections: string[] = []
  if (profile?.weakDirections) {
    try {
      const parsed = JSON.parse(profile.weakDirections)
      if (Array.isArray(parsed)) weakDirections = parsed.filter((x) => typeof x === 'string').slice(0, 6)
    } catch {
      weakDirections = []
    }
  }

  return {
    gaps: gaps.map((g) => (g.reason ? `${g.gapDescription}（${g.reason}）` : g.gapDescription)),
    weakDirections,
    weakKnowledges,
  }
}

// 要点清单以 JSON 字符串存在库里，读的时候容错解析
function parseKeyPoints(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function renderBlindSpots(bs: BlindSpots): string {
  const lines: string[] = []
  lines.push(`知识断层：${bs.gaps.length ? bs.gaps.map((g) => `- ${g}`).join('\n') : '（暂无）'}`)
  lines.push(
    `长期薄弱方向：${bs.weakDirections.length ? bs.weakDirections.join('、') : '（暂无）'}`,
  )
  lines.push(
    `掌握较弱的知识：${bs.weakKnowledges.length ? bs.weakKnowledges.join('、') : '（暂无）'}`,
  )
  return lines.join('\n')
}

export interface AskRelated {
  id: string
  title: string
  coreConclusion: string
  createdAt: string
}

export interface AskMessage {
  role: 'user' | 'assistant'
  content: string
  related?: AskRelated[]
}

// 解析会话里存成 JSON 字符串的消息流，容错
function parseMessages(raw: string): AskMessage[] {
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter((m) => m && typeof m.content === 'string')
  } catch {
    return []
  }
}

function generateTitle(q: string): string {
  const t = q.replace(/\s+/g, ' ').trim()
  return t.length > 20 ? `${t.slice(0, 20)}…` : t
}

export async function ask(
  userId: string,
  question: string,
  history: AskMessage[] = [],
  sessionId?: string,
) {
  const [related, blindSpots] = await Promise.all([
    searchKnowledge(userId, question),
    getBlindSpots(userId),
  ])
  const profile = await getProfileText(userId)

  const knowledgeContext = related.length
    ? related
        .map((k, i) => {
          const parts = [
            `[知识${i + 1}] 标题：${k.title}`,
            `核心结论：${k.coreConclusion}`,
          ]
          if (k.detailExplanation) parts.push(`详细解释：${k.detailExplanation}`)
          // 要点清单里放着最细的事实和对比，回答具体问题全靠它，
          // 没有这一段，收录时补上的细节在问答里就白存了
          const kps = parseKeyPoints(k.keyPoints)
          if (kps.length) parts.push(`要点：\n${kps.map((p) => `- ${p}`).join('\n')}`)
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

以下是用户的掌握情况材料（用于判断他哪里不足，第三段「你的盲区」要基于这些材料，不要自己编）：
${renderBlindSpots(blindSpots)}

请按系统提示的三段式结构回答。`

  // 带上最近对话历史，形成多轮上下文；最多保留最近 10 条，避免 token 过长
  const recentHistory = history.slice(-10)
  const chatMessages = [
    { role: 'system' as const, content: askSystem(profile) },
    ...recentHistory.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: userPrompt },
  ]

  // 不设输出上限，让服务端给足。三段式回答本来就长，模型又是推理模型，
  // 预算写小了会出现「正文为空」，用户看到的就是一片空白
  let answer = ((await chat(chatMessages)) ?? '').trim()
  if (!answer) {
    console.warn('[问答] 模型返回空正文，重试一次')
    answer = ((await chat(chatMessages)) ?? '').trim()
  }
  // 兜底：连续两次都空，也要给一句人话，不许把空白丢给用户
  if (!answer) answer = '这次我没答上来。换个说法再问一次，或者去知识库看看相关的那条。'

  const relatedOut = related.map((k) => ({
    id: k.id,
    title: k.title,
    coreConclusion: k.coreConclusion,
    createdAt: k.createdAt.toISOString(),
  }))

  // 持久化到会话，返回会话 id 和标题
  const session = await persistAskSession(userId, sessionId, question, answer, relatedOut)

  return {
    answer,
    related: relatedOut,
    sessionId: session.id,
    title: session.title,
  }
}

// 把本次问答追加进会话（有 sessionId 则更新，否则新建）
async function persistAskSession(
  userId: string,
  sessionId: string | undefined,
  question: string,
  answer: string,
  related: AskRelated[],
) {
  const pair: AskMessage[] = [
    { role: 'user', content: question },
    { role: 'assistant', content: answer, related },
  ]

  if (sessionId) {
    const existing = await prisma.conversationSession.findFirst({ where: { id: sessionId, userId } })
    if (existing) {
      const messages = [...parseMessages(existing.messages), ...pair]
      const title = existing.title || generateTitle(question)
      await prisma.conversationSession.update({
        where: { id: sessionId },
        data: { messages: JSON.stringify(messages), title, updatedAt: new Date() },
      })
      return { id: sessionId, title }
    }
  }

  const title = generateTitle(question)
  const created = await prisma.conversationSession.create({
    data: { userId, mode: 'ask', title, messages: JSON.stringify(pair) },
  })
  return { id: created.id, title }
}

// 列出问 AI 的历史会话（不含消息详情，只返回摘要）
export async function listAskSessions(userId: string) {
  const sessions = await prisma.conversationSession.findMany({
    where: { userId, mode: 'ask' },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, title: true, updatedAt: true, messages: true },
  })
  return sessions.map((s) => ({
    id: s.id,
    title: s.title || '新对话',
    updatedAt: s.updatedAt,
    count: parseMessages(s.messages).length,
  }))
}

// 读取单个会话的完整消息
export async function getAskSession(userId: string, id: string) {
  const s = await prisma.conversationSession.findFirst({ where: { id, userId, mode: 'ask' } })
  if (!s) return null
  return { id: s.id, title: s.title || '新对话', messages: parseMessages(s.messages) }
}

// 删除一个会话
export async function deleteAskSession(userId: string, id: string) {
  const s = await prisma.conversationSession.findFirst({ where: { id, userId, mode: 'ask' } })
  if (!s) return null
  await prisma.conversationSession.delete({ where: { id } })
  return { ok: true }
}
