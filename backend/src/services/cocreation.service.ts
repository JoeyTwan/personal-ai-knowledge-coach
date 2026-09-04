import { prisma } from '../lib/prisma'
import { chat } from '../ai/client'
import { cocreateSystem } from '../ai/prompts'
import { getProfileText } from './user.service'
import { createKnowledge } from './knowledge.service'
import { discoverRelations } from './relation.service'

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
  const consensus = parseConsensus(reply)

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

export interface ConfirmInput {
  draft: KnowledgeDraft
  categoryPath?: string[]
  sourceType?: string
  sourceDetail?: string
}

export async function confirmKnowledge(userId: string, sessionId: string | null, input: ConfirmInput) {
  const knowledge = await createKnowledge(userId, {
    title: input.draft.title ?? '未命名知识',
    coreConclusion: input.draft.coreConclusion ?? input.draft.title ?? '',
    briefExplanation: input.draft.briefExplanation,
    detailExplanation: input.draft.detailExplanation,
    example: input.draft.example,
    type: input.draft.type,
    tags: input.draft.tags,
    categoryPath: input.categoryPath,
    sources: [
      { type: input.sourceType ?? 'AI 讨论', detail: input.sourceDetail, occurredAt: new Date().toISOString() },
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
  } catch {
    // 关系发现失败静默处理
  }

  return knowledge
}
