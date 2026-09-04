import { prisma } from '../lib/prisma'
import { chat, chatJSON } from '../ai/client'
import { cocreateSystem, classifySystem, detectEvolutionSystem, extractKnowledgeSystem } from '../ai/prompts'
import { getProfileText } from './user.service'
import { createKnowledge } from './knowledge.service'
import { discoverRelations } from './relation.service'
import { maybeRefreshProfile } from './profile.service'

interface StoredMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface KnowledgeDraft {
  title?: string
  coreConclusion?: string
  briefExplanation?: string
  detailExplanation?: string
  example?: string
  type?: string
  tags?: string[]
}

// 从 AI 回复中解析共识标记
function parseConsensus(reply: string): { reached: boolean; draft: KnowledgeDraft | null } {
  const m = reply.match(/<CONSENSUS>([\s\S]*?)<\/CONSENSUS>/)
  if (!m) return { reached: false, draft: null }
  try {
    const draft = JSON.parse(m[1]) as KnowledgeDraft
    return { reached: true, draft }
  } catch {
    return { reached: true, draft: null }
  }
}

export async function discuss(userId: string, sessionId: string | null, userMessage: string) {
  let session = sessionId
    ? await prisma.conversationSession.findUnique({ where: { id: sessionId } })
    : null

  const history: StoredMessage[] = session ? (JSON.parse(session.messages) as StoredMessage[]) : []
  const profile = await getProfileText(userId)

  const messages: StoredMessage[] = [
    { role: 'system', content: cocreateSystem(profile) },
    ...history,
    { role: 'user', content: userMessage },
  ]

  const reply = await chat(messages)

  // P2-6：首轮讨论强制至少追问一轮。即使 AI 首轮就输出共识标记，也忽略，避免未澄清就直接入库。
  const isFirstTurn = history.length === 0
  let consensus = parseConsensus(reply)
  if (isFirstTurn && consensus.reached) {
    consensus = { reached: false, draft: null }
  }

  const newHistory: StoredMessage[] = [
    ...history,
    { role: 'user', content: userMessage },
    { role: 'assistant', content: reply },
  ]

  if (!session) {
    session = await prisma.conversationSession.create({
      data: {
        userId,
        mode: 'cocreate',
        title: userMessage.slice(0, 60),
        rawContent: userMessage,
        messages: JSON.stringify(newHistory),
      },
    })
  } else {
    session = await prisma.conversationSession.update({
      where: { id: session.id },
      data: { messages: JSON.stringify(newHistory) },
    })
  }

  return {
    sessionId: session.id,
    reply,
    consensusReached: consensus.reached,
    draft: consensus.draft,
  }
}

// P2-1：AI 未自动输出共识标记时的兜底。用户点击「生成草稿」，基于整段对话历史强制总结出一条知识草稿。
export async function summarizeConsensus(userId: string, sessionId: string) {
  const session = await prisma.conversationSession.findUnique({ where: { id: sessionId } })
  if (!session) return null

  const history = JSON.parse(session.messages) as StoredMessage[]
  if (history.length === 0) return null

  const profile = await getProfileText(userId)

  const draft = await chatJSON<KnowledgeDraft>([
    { role: 'system', content: extractKnowledgeSystem() },
    {
      role: 'user',
      content: `以下是用户与知识教练的讨论记录，请把它们整理成一条结构化知识（若信息不足以形成结论，用已有信息合理归纳，不要在字段里留「待补充」）。\n\n${history
        .map(
          (m) =>
            `${m.role === 'user' ? '用户' : '教练'}：${m.content
              .replace(/<CONSENSUS>[\s\S]*?<\/CONSENSUS>/g, '')
              .trim()}`,
        )
        .join('\n')}`,
    },
  ])

  return { draft }
}

export interface ConfirmInput {
  draft: KnowledgeDraft
  categoryPath?: string[]
  sourceType?: string
  sourceDetail?: string
}

// P0-4 修复：知识演化 —— 更新旧知识而非新建（保留历史版本 + 提升可信度 + 追加来源）
async function evolveKnowledge(
  userId: string,
  targetId: string,
  input: ConfirmInput,
  sourceType: string,
  sourceDetail?: string,
) {
  const existing = await prisma.knowledge.findFirst({ where: { id: targetId, userId } })
  if (!existing) return null

  const newCore = input.draft.coreConclusion ?? existing.coreConclusion

  // 1. 核心结论变化时记录历史版本
  if (newCore && newCore !== existing.coreConclusion) {
    const lastVersion = await prisma.knowledgeVersion.findFirst({
      where: { knowledgeId: targetId },
      orderBy: { version: 'desc' },
    })
    await prisma.knowledgeVersion.create({
      data: {
        knowledgeId: targetId,
        version: (lastVersion?.version ?? 1) + 1,
        title: existing.title,
        coreConclusion: existing.coreConclusion,
        detailExplanation: existing.detailExplanation ?? undefined,
        changeReason: '知识演化：同一主题信息更新',
      },
    })
  }

  // 2. 更新知识（合并新信息 + 可信度提升）
  const data: Record<string, unknown> = {
    coreConclusion: newCore,
    detailExplanation: input.draft.detailExplanation ?? existing.detailExplanation,
    confidence: Math.min(1, (existing.confidence ?? 0.5) + 0.15),
  }
  if (input.draft.title && input.draft.title !== existing.title) data.title = input.draft.title
  if (input.draft.example !== undefined) data.example = input.draft.example

  const updated = await prisma.knowledge.update({ where: { id: targetId }, data })

  // 3. 追加来源（演化保留多来源，用于追溯可信度变化）
  await prisma.knowledgeSource.create({
    data: {
      knowledgeId: targetId,
      type: sourceType,
      detail: sourceDetail,
      occurredAt: new Date(),
    },
  })

  return updated
}

export async function confirmKnowledge(userId: string, sessionId: string | null, input: ConfirmInput) {
  const title = input.draft.title ?? '未命名知识'
  const coreConclusion = input.draft.coreConclusion ?? input.draft.title ?? ''
  const sourceType = input.sourceType ?? 'AI 讨论'

  // P0-1 修复：AI 自动分类（未手动指定分类时调用）
  let categoryPath = input.categoryPath
  let tags = input.draft.tags ?? []
  if (!categoryPath || categoryPath.length === 0) {
    try {
      const cls = await chatJSON<{ categoryPath: string[]; tags?: string[] }>([
        { role: 'system', content: classifySystem() },
        { role: 'user', content: `知识标题：${title}\n核心结论：${coreConclusion}\n请为这条知识自动归类。` },
      ])
      if (cls.categoryPath && cls.categoryPath.length > 0) categoryPath = cls.categoryPath
      if (cls.tags && cls.tags.length > 0) tags = Array.from(new Set([...tags, ...cls.tags]))
    } catch (e) {
      console.error('[自动分类] 失败，跳过分类', e)
    }
  }

  // P0-4 修复：演化检测 —— 判断是否是对已有知识的更新/增强
  const existing = await prisma.knowledge.findMany({
    where: { userId, status: 'active' },
    select: { id: true, title: true, coreConclusion: true },
    orderBy: { updatedAt: 'desc' },
    take: 30,
  })
  if (existing.length > 0) {
    try {
      const evo = await chatJSON<{ isEvolution: boolean; targetKnowledgeId?: string; reason?: string }>([
        { role: 'system', content: detectEvolutionSystem() },
        {
          role: 'user',
          content: `新知识：\n标题：${title}\n核心结论：${coreConclusion}\n\n已有知识列表：\n${existing
            .map((k) => `[${k.id}] ${k.title}：${k.coreConclusion}`)
            .join('\n')}`,
        },
      ])
      if (evo.isEvolution && evo.targetKnowledgeId) {
        const target = existing.find((k) => k.id === evo.targetKnowledgeId)
        if (target) {
          const evolved = await evolveKnowledge(userId, target.id, input, sourceType, input.sourceDetail)
          if (evolved) {
            if (sessionId) {
              await prisma.conversationSession.update({
                where: { id: sessionId },
                data: { status: 'completed' },
              })
            }
            try {
              await discoverRelations(userId, target.id)
            } catch (e) {
              console.error('[关系发现] 演化后重建关系失败', e)
            }
            maybeRefreshProfile(userId).catch((e) => console.error('[画像刷新] 演化后自动刷新失败', e))
            return evolved
          }
        }
      }
    } catch (e) {
      console.error('[演化检测] 失败，走新建', e)
    }
  }

  // 新建知识
  const knowledge = await createKnowledge(userId, {
    title,
    coreConclusion,
    briefExplanation: input.draft.briefExplanation,
    detailExplanation: input.draft.detailExplanation,
    example: input.draft.example,
    type: input.draft.type,
    tags,
    categoryPath,
    sources: [
      { type: sourceType, detail: input.sourceDetail, occurredAt: new Date().toISOString() },
    ],
  })

  if (sessionId) {
    await prisma.conversationSession.update({
      where: { id: sessionId },
      data: { status: 'completed' },
    })
  }

  // 入库后自动发现与已有知识的关系（失败不影响入库结果）
  try {
    await discoverRelations(userId, knowledge.id)
  } catch (e) {
    console.error('[关系发现] 入库后自动发现失败', e)
  }

  // 入库后节流刷新画像（P2-5，失败不影响入库结果）
  maybeRefreshProfile(userId).catch((e) => console.error('[画像刷新] 入库后自动刷新失败', e))

  return knowledge
}
