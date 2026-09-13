import { prisma } from '../lib/prisma'
import { chat, chatJSON } from '../ai/client'
import {
  cocreateSystem,
  classifySystem,
  detectEvolutionBatchSystem,
  extractKnowledgeSystem,
} from '../ai/prompts'
import { parseAsk, stripAsk } from '../ai/cards'
import { getProfileText } from './user.service'
import { createKnowledge, MASTERY_DISCUSS, MASTERY_PASSED } from './knowledge.service'
import { generateBullets } from './bullets.service'
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
  // 这条知识认领的原料要点。模型被要求逐字复制，方便服务端精确核对有没有漏收
  keyPoints?: string[]
}

// 一次整理的结果：原料拆出的全部要点 + 按主题分好的知识草稿
export interface ExtractResult {
  points: string[]
  items: KnowledgeDraft[]
  // 一条知识都没认领的要点。正常情况下为空，非空说明兜底也失败了
  uncovered: string[]
}

// 要点比对用的归一化：忽略空白、标点和大小写差异。
// 模型被要求逐字复制要点，所以这里用字符串比对就能精确判断漏没漏
function normPoint(s: string): string {
  return (s ?? '')
    .replace(/[\s\u3000]/g, '')
    .replace(/[，。、；：！？""''（）《》【】,.!?;:"'()[\]<>—–-]/g, '')
    .toLowerCase()
}

// 从库里存的 JSON 字符串还原要点数组，坏数据一律当空处理
function parsePoints(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

// 从 AI 回复中解析「用户想整理了」的标记。
// 整理的发起权永远在用户：只有用户明确说了要收录，AI 才会输出这个标记。
function parseReady(reply: string): boolean {
  return /<READY>/.test(reply)
}

// 从 AI 回复中解析追问卡片（parseAsk 在 ai/cards.ts，与材料过关共用同一套）

// 用户可见的部分：所有协议标记都要剥掉，包括回复被截断时留下的未闭合残段
function cleanVisible(reply: string): string {
  return stripAsk(reply)
    .replace(/<CONSENSUS>[\s\S]*?<\/CONSENSUS>/g, '')
    .replace(/<CONSENSUS>(?![\s\S]*<\/CONSENSUS>)[\s\S]*$/g, '')
    .replace(/<READY>/g, '')
    .trim()
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

  // 不设输出上限：这条回复里装着正文和卡片标记，被截断会把标记切坏，
  // 而且这是推理模型，写死上限容易被思考过程吃光
  const reply = await chat(messages)

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
    reply: cleanVisible(reply),
    cards: parseAsk(reply),
    ready: parseReady(reply),
  }
}

// 逐条核对：每条要点是不是被某条知识认领了。认领靠 keyPoints 的逐字复制来判定
function findUncovered(points: string[], items: KnowledgeDraft[]): string[] {
  if (points.length === 0) return []
  const claimed = new Set<string>()
  for (const it of items) {
    for (const kp of it.keyPoints ?? []) {
      if (typeof kp === 'string') claimed.add(normPoint(kp))
    }
  }
  return points.filter((p) => !claimed.has(normPoint(p)))
}

// 用户主动发起「整理成知识」。先把原料拆成要点，再按主题收成多条知识，
// 最后逐条核对要点有没有全部落地。丢知识这件事就靠这一步兜住。
// 草稿对不对由用户判断：可以改、可以取消某条、也可以继续聊。
export async function summarizeConsensus(
  userId: string,
  sessionId: string,
): Promise<ExtractResult | null> {
  const session = await prisma.conversationSession.findUnique({ where: { id: sessionId } })
  if (!session) return null

  const history = JSON.parse(session.messages) as StoredMessage[]
  if (history.length === 0) return null

  const raw = await chatJSON<{ points?: string[]; items?: KnowledgeDraft[] }>(
    [
      { role: 'system', content: extractKnowledgeSystem() },
      {
        role: 'user',
        content: `以下是用户与知识教练的讨论记录。第一段是用户自己写的原料，后面是讨论过程，讨论里他亲口说的修正和补充同样算原料。请按提示词的要求整理成知识。核心结论尽量沿用用户自己说过的话和用词，不要换成书面语。\n\n${history
          .map(
            (m) =>
              `${m.role === 'user' ? '用户' : '教练'}：${stripAsk(
                m.content
                  .replace(/<CONSENSUS>[\s\S]*?<\/CONSENSUS>/g, '')
                  .replace(/<READY>/g, ''),
              ).trim()}`,
          )
          .join('\n')}`,
      },
    ],
    // 不设输出上限：这类任务的思考量实测在 7000 到 13000 之间波动，
    // 写死一个值很容易在「想完了但还没开始写」的时候被截断，交给服务端给足
  )

  const points = (Array.isArray(raw?.points) ? raw.points : []).filter(
    (p): p is string => typeof p === 'string' && p.trim().length > 0,
  )
  const items = (Array.isArray(raw?.items) ? raw.items : []).filter(
    (it) => it && typeof it === 'object' && Boolean(it.coreConclusion || it.title),
  )

  if (items.length === 0) return null

  let uncovered = findUncovered(points, items)

  // 漏收兜底：宁可多出一条知识，也不许把要点丢掉
  if (uncovered.length > 0) {
    console.warn('[整理] 有要点没被认领，补一条兜住：', uncovered)
    const patch = await chatJSON<KnowledgeDraft>(
      [
        { role: 'system', content: extractKnowledgeSystem() },
        {
          role: 'user',
          content: `已经整理出的知识覆盖了原料大部分内容，但下面这些要点还没有落地。请单独整理成一条知识，让它们不要丢掉。\n\n没落地的要点：\n${uncovered
            .map((p, i) => `${i + 1}. ${p}`)
            .join('\n')}\n\n已有知识的标题（避免重复）：\n${items
            .map((it) => `- ${it.title ?? ''}`)
            .join('\n')}`,
        },
      ],
    ).catch((e) => {
      console.error('[整理] 兜底补条失败', e)
      return null
    })

    if (patch && typeof patch === 'object' && (patch.coreConclusion || patch.title)) {
      patch.keyPoints = uncovered
      items.push(patch)
      uncovered = []
    }
  }

  return { points, items, uncovered }
}

export interface ConfirmInput {
  draft: KnowledgeDraft
  categoryPath?: string[]
  sourceType?: string
  sourceDetail?: string
  // 这条知识是怎么学来的：材料过关比纯讨论多一层验证，初始掌握度略高
  learnedVia?: 'discuss' | 'material'
}

// 批量收录：一份笔记可能拆出好几条知识，一次提交
export interface ConfirmBatchInput {
  drafts: KnowledgeDraft[]
  categoryPath?: string[]
  sourceType?: string
  sourceDetail?: string
  learnedVia?: 'discuss' | 'material'
}

// P0-4 修复：知识演化 —— 更新旧知识而非新建（保留历史版本 + 提升可信度 + 追加来源）
async function evolveKnowledge(
  userId: string,
  targetId: string,
  input: ConfirmInput,
  sourceType: string,
  sourceDetail?: string,
  keyPoints?: string[],
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
  // 演化时要点取并集：新版本带来的要点追加进去，旧要点不允许被冲掉
  if (keyPoints?.length) {
    const merged = Array.from(new Set([...parsePoints(existing.keyPoints), ...keyPoints]))
    data.keyPoints = JSON.stringify(merged)
  }

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

// 分类兜底：AI 分类失败时按知识类型落到「工作」或「思考」，保证每条知识都有分类
function fallbackCategoryPath(type?: string): string[] {
  const workTypes = ['工作信息', '公司信息', '人物信息', '产品信息', '经验', '方法', '技能', '决策']
  return workTypes.includes(type ?? '') ? ['工作'] : ['思考']
}

// 批量演化检测：一次判断这批知识里哪些是对已有知识的更新。
// 一份笔记拆出的多条知识逐条调用模型太慢，合起来一次问完
async function detectEvolutionBatch(
  userId: string,
  items: { title: string; coreConclusion: string }[],
): Promise<Map<number, string>> {
  const map = new Map<number, string>()
  if (items.length === 0) return map

  const existing = await prisma.knowledge.findMany({
    where: { userId, status: 'active' },
    select: { id: true, title: true, coreConclusion: true },
    orderBy: { updatedAt: 'desc' },
    take: 30,
  })
  if (existing.length === 0) return map

  try {
    const res = await chatJSON<{
      results?: { index: number; isEvolution: boolean; targetKnowledgeId?: string }[]
    }>([
      { role: 'system', content: detectEvolutionBatchSystem() },
      {
        role: 'user',
        content: `新整理出的知识：\n${items
          .map((it, i) => `[${i}] ${it.title}：${it.coreConclusion}`)
          .join('\n')}\n\n已有知识列表：\n${existing
          .map((k) => `[${k.id}] ${k.title}：${k.coreConclusion}`)
          .join('\n')}`,
      },
    ])

    for (const r of res?.results ?? []) {
      if (
        r?.isEvolution &&
        typeof r.index === 'number' &&
        r.targetKnowledgeId &&
        existing.some((k) => k.id === r.targetKnowledgeId)
      ) {
        map.set(r.index, r.targetKnowledgeId)
      }
    }
  } catch (e) {
    console.error('[演化检测] 失败，全部按新建处理', e)
  }

  return map
}

// 收录：把整理出的多条草稿落成知识。
// 分类共用一次判断，演化检测合并成一次调用，弹幕并行生成，
// 避免逐条跑模型把等待时间拖长。
export async function confirmKnowledges(
  userId: string,
  sessionId: string | null,
  input: ConfirmBatchInput,
) {
  const sourceType = input.sourceType ?? '自己思考的'

  const drafts = (Array.isArray(input.drafts) ? input.drafts : []).filter(
    (d) => d && typeof d === 'object' && (d.coreConclusion || d.title),
  )
  if (drafts.length === 0) return []

  const norm = drafts.map((d) => ({
    draft: d,
    title: d.title ?? '未命名知识',
    coreConclusion: d.coreConclusion ?? d.title ?? '',
  }))

  // 自动分类：同一份原料拆出的知识主题接近，用一次判断定共同分类
  let categoryPath = input.categoryPath
  let clsTags: string[] = []
  if (!categoryPath || categoryPath.length === 0) {
    try {
      const cls = await chatJSON<{ categoryPath: string[]; tags?: string[] }>([
        { role: 'system', content: classifySystem() },
        {
          role: 'user',
          content: `这批知识来自同一份笔记，请为它们定一个共同的分类。\n\n${norm
            .map((n, i) => `${i + 1}. ${n.title}\n   核心结论：${n.coreConclusion}`)
            .join('\n')}`,
        },
      ])
      if (cls?.categoryPath?.length) categoryPath = cls.categoryPath
      if (cls?.tags?.length) clsTags = cls.tags
    } catch (e) {
      console.error('[自动分类] 失败，改用类型兜底', e)
    }
  }
  // 兜底：分类仍为空时按类型落到「工作」或「思考」，确保不会出现没有分类的知识
  if (!categoryPath || categoryPath.length === 0) {
    categoryPath = fallbackCategoryPath(norm[0].draft.type)
  }

  const [evolutionMap, bulletsList] = await Promise.all([
    detectEvolutionBatch(userId, norm),
    Promise.all(
      norm.map((n) =>
        generateBullets({
          title: n.title,
          coreConclusion: n.coreConclusion,
          briefExplanation: n.draft.briefExplanation,
          detailExplanation: n.draft.detailExplanation,
          example: n.draft.example,
        }).catch((e) => {
          console.error('[弹幕] 生成失败', e)
          return [] as string[]
        }),
      ),
    ),
  ])

  const mastery = input.learnedVia === 'material' ? MASTERY_PASSED : MASTERY_DISCUSS
  const results: unknown[] = []

  for (let i = 0; i < norm.length; i++) {
    const { draft, title, coreConclusion } = norm[i]
    const bullets = bulletsList[i] ?? []
    const tags = Array.from(new Set([...(draft.tags ?? []), ...clsTags]))
    const keyPoints = (draft.keyPoints ?? []).filter(
      (p): p is string => typeof p === 'string' && p.trim().length > 0,
    )

    // 命中已有知识就走演化，否则新建
    const targetId = evolutionMap.get(i)
    if (targetId) {
      const evolved = await evolveKnowledge(
        userId,
        targetId,
        { draft, learnedVia: input.learnedVia },
        sourceType,
        input.sourceDetail,
        keyPoints,
      )
      if (evolved) {
        // 内容演化后同步刷新弹幕要点
        await prisma.knowledge.update({
          where: { id: targetId },
          data: { bullets: JSON.stringify(bullets) },
        })
        try {
          await discoverRelations(userId, targetId)
        } catch (e) {
          console.error('[关系发现] 演化后重建关系失败', e)
        }
        results.push(evolved)
        continue
      }
    }

    const knowledge = await createKnowledge(userId, {
      title,
      coreConclusion,
      briefExplanation: draft.briefExplanation,
      detailExplanation: draft.detailExplanation,
      example: draft.example,
      type: draft.type,
      tags,
      categoryPath,
      bullets,
      keyPoints,
      mastery,
      sources: [
        { type: sourceType, detail: input.sourceDetail, occurredAt: new Date().toISOString() },
      ],
    })

    // 入库后自动发现与已有知识的关系（失败不影响入库结果）
    try {
      await discoverRelations(userId, knowledge.id)
    } catch (e) {
      console.error('[关系发现] 入库后自动发现失败', e)
    }
    results.push(knowledge)
  }

  if (sessionId) {
    await prisma.conversationSession.update({
      where: { id: sessionId },
      data: { status: 'completed' },
    })
  }

  // 入库后节流刷新画像（失败不影响入库结果）
  maybeRefreshProfile(userId).catch((e) => console.error('[画像刷新] 入库后自动刷新失败', e))

  return results
}
