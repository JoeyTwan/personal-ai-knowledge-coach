import { prisma } from '../lib/prisma'
import { chat, chatJSON, imageDataUrl, isSupportedImage, type ChatMessage } from '../ai/client'
import { materialDigestSystem, materialCoachSystem } from '../ai/prompts'
import { parseAsk, describeAnswers, stripAsk, type AskCard, type ItemAnswer } from '../ai/cards'
import { getProfileText } from './user.service'

// ===== 材料导入与逐条过关 =====
// 设计要点：
// 1. 原文不入库。解析出的正文只用于拆解，拆完即丢，库里留下的是一条条自带信息量的知识要点。
// 2. 讨论用的是要点，不是原文。所以一条要点的 gist 必须写足信息量。
// 3. 过关一律走卡片：用户点一下就往前挪一步，正文里不出现问句。
//    能用点选解决的绝不让用户打字，需要打字时也必须给句式脚手架。
// 4. 答错退一级：换更简单的题型重讲，而不是把同一段话重复一遍。
//    退到上限就如实记为待复习，不硬撑。
// 5. 步进状态存在服务端，刷新页面能接着答，「退到第几级」也不靠模型自觉。

export type MaterialKind = 'image' | 'pdf' | 'docx' | 'text'

export class MaterialError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MaterialError'
  }
}

// 一份材料最多拆出的条数。超过了 AI 只挑最重要的，其余计数丢弃。
const MAX_ITEMS = 8
// 单条最多答错几次，到顶就如实记为待复习
const MAX_WRONG = 3
// 开场的这句是给模型的指令，不是用户说的话，界面上不要露出来
const OPENER = '（我开始过这一条。请先讲给我听，再出卡。）'
// 正文截断长度，防止超长文档把 prompt 撑爆
const MAX_TEXT_CHARS = 24_000

export function detectKind(filename: string, mime: string): MaterialKind {
  const m = (mime || '').toLowerCase()
  const ext = (filename.split('.').pop() || '').toLowerCase()
  if (m.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'].includes(ext)) return 'image'
  if (m === 'application/pdf' || ext === 'pdf') return 'pdf'
  if (ext === 'docx') return 'docx'
  if (ext === 'doc') throw new MaterialError('旧版 .doc 读不了，请另存为 .docx 或 PDF 再传')
  return 'text'
}

async function extractText(buffer: Buffer, kind: MaterialKind): Promise<string> {
  if (kind === 'pdf') {
    // 直接引 lib 里的实现：pdf-parse 的入口文件在充当主模块时会去读它自带的测试样本。
    // 用 1.x 而不是 2.x，是因为 2.x 依赖的 pdfjs-dist 要求 Node 20 以上。
    const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (
      b: Buffer,
    ) => Promise<{ text: string }>
    const out = await pdfParse(buffer)
    const text = (out.text || '').trim()
    // 扫描件没有文字层，这里如实说明，不硬编内容
    if (text.length < 40) {
      throw new MaterialError('这份 PDF 里没有可选中的文字，应该是扫描件或图片版。把它截图发过来就能读。')
    }
    return text
  }
  if (kind === 'docx') {
    const mammoth = require('mammoth') as {
      extractRawText: (o: { buffer: Buffer }) => Promise<{ value: string }>
    }
    const out = await mammoth.extractRawText({ buffer })
    return (out.value || '').trim()
  }
  return buffer.toString('utf8').trim()
}

interface DigestItem {
  title?: string
  gist?: string
  keyFacts?: string[]
}

interface DigestResult {
  title?: string
  items?: DigestItem[]
  overflow?: number
}

// 材料 → 知识清单。图片走多模态，文档走正文。
async function digest(input: {
  filename: string
  kind: MaterialKind
  buffer: Buffer
  mime: string
}): Promise<{ title: string; items: { title: string; gist: string; keyFacts: string[] }[]; overflow: number }> {
  let messages: ChatMessage[]

  if (input.kind === 'image') {
    if (!isSupportedImage(input.mime)) {
      throw new MaterialError('这种图片格式读不了，支持 JPG、PNG、GIF、WebP。')
    }
    const intro =
      '这是一张用户拍下来或截图的材料图片。请先读懂图里的全部内容（含图中的文字），再按下面的要求把它拆成知识清单。\n\n'
    messages = [
      { role: 'system', content: materialDigestSystem() },
      {
        role: 'user',
        content: [
          { type: 'text', text: intro },
          { type: 'image_url', image_url: { url: imageDataUrl(input.buffer, input.mime) } },
        ],
      },
    ]
  } else {
    const text = await extractText(input.buffer, input.kind)
    if (!text) throw new MaterialError('这个文件里没有读到内容。')
    const clipped = text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text
    const note = text.length > MAX_TEXT_CHARS ? '\n\n（材料较长，上面是前一部分。）' : ''
    messages = [
      { role: 'system', content: materialDigestSystem() },
      { role: 'user', content: `材料文件名：${input.filename}\n\n材料正文：\n${clipped}${note}` },
    ]
  }

  const result = await chatJSON<DigestResult>(messages, { temperature: 0.3, maxTokens: 3000 })

  const raw = Array.isArray(result.items) ? result.items : []
  const items = raw
    .filter((it) => it && typeof it.gist === 'string' && it.gist.trim())
    .slice(0, MAX_ITEMS)
    .map((it, i) => ({
      title: (it.title || '').trim() || `第 ${i + 1} 条`,
      gist: (it.gist || '').trim(),
      keyFacts: Array.isArray(it.keyFacts) ? it.keyFacts.filter((f) => typeof f === 'string') : [],
    }))

  if (items.length === 0) {
    throw new MaterialError('这份材料里没有读出可以单独学的知识点，换一份试试。')
  }

  // overflow 取 AI 自报与条数裁剪两者的较大值，避免少报
  const dropped = Math.max(raw.length - items.length, Number(result.overflow) || 0)
  const title = (result.title || '').trim() || input.filename.replace(/\.[^.]+$/, '')

  return { title, items, overflow: dropped > 0 ? dropped : 0 }
}

export async function importMaterial(
  userId: string,
  file: { filename: string; mime: string; buffer: Buffer },
) {
  const filename = file.filename || '材料'
  const kind = detectKind(filename, file.mime)
  const digested = await digest({ filename, kind, buffer: file.buffer, mime: file.mime })

  const material = await prisma.material.create({
    data: {
      userId,
      title: digested.title,
      kind,
      itemCount: digested.items.length,
      overflow: digested.overflow,
      items: {
        create: digested.items.map((it, i) => ({
          order: i + 1,
          title: it.title,
          gist: it.gist,
          keyFacts: it.keyFacts.length ? JSON.stringify(it.keyFacts) : null,
        })),
      },
    },
    include: { items: { orderBy: { order: 'asc' } } },
  })

  return material
}

// 未走完的材料（记录页顶部提示用）
export async function listMaterials(userId: string) {
  const materials = await prisma.material.findMany({
    where: { userId, status: 'active' },
    orderBy: { updatedAt: 'desc' },
    include: { items: { select: { status: true }, orderBy: { order: 'asc' } } },
  })
  return materials.map((m) => ({
    id: m.id,
    title: m.title,
    kind: m.kind,
    createdAt: m.createdAt,
    total: m.items.length,
    passed: m.items.filter((i) => i.status === 'passed').length,
    current: m.items.some((i) => i.status === 'discussing'),
  }))
}

export async function getMaterial(userId: string, materialId: string) {
  const material = await prisma.material.findFirst({
    where: { id: materialId, userId },
    include: { items: { orderBy: { order: 'asc' } } },
  })
  if (!material) return null
  return {
    id: material.id,
    title: material.title,
    kind: material.kind,
    status: material.status,
    overflow: material.overflow,
    createdAt: material.createdAt,
    items: material.items.map((it) => {
      const state = readState(it.askState)
      return {
        id: it.id,
        order: it.order,
        title: it.title,
        gist: it.gist,
        keyFacts: it.keyFacts ? (JSON.parse(it.keyFacts) as string[]) : [],
        status: it.status,
        wrong: state.wrong,
        maxWrong: MAX_WRONG,
        knowledgeId: it.knowledgeId,
        sessionId: it.sessionId,
        // 还没答完的卡：刷新页面后接着答
        cards: state.cards,
        draft: state.draft ?? null,
      }
    }),
  }
}

// ===== 判定协议 =====
// <CHECK> 是对上一次作答的判定：next 继续、retry 答错了、pass 拿下、giveup 到顶。
// 步进状态存在服务端：还没答的卡、答错次数、作答流水。

// 步进状态：还没答的卡、答错次数、作答流水
interface AskState {
  cards: AskCard[]
  wrong: number
  log: { type: string; answer: string }[]
  draft?: Record<string, unknown>
}

interface StoredMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

function emptyState(): AskState {
  return { cards: [], wrong: 0, log: [] }
}

function readState(raw: string | null | undefined): AskState {
  if (!raw) return emptyState()
  try {
    const parsed = JSON.parse(raw) as AskState
    return {
      cards: Array.isArray(parsed.cards) ? parsed.cards : [],
      wrong: Number(parsed.wrong) || 0,
      log: Array.isArray(parsed.log) ? parsed.log : [],
      draft: parsed.draft,
    }
  } catch {
    return emptyState()
  }
}

interface CheckResult {
  verdict: 'next' | 'retry' | 'pass' | 'giveup'
  comment?: string
  draft?: Record<string, unknown>
  // 答错的是哪几张卡，用于前端精确标出错在哪
  wrong?: string[]
}

function parseCheck(reply: string): CheckResult | null {
  const m = reply.match(/<CHECK>([\s\S]*?)<\/CHECK>/)
  if (!m) return null
  try {
    const obj = JSON.parse(m[1]) as CheckResult
    if (!['next', 'retry', 'pass', 'giveup'].includes(obj.verdict)) return null
    return {
      verdict: obj.verdict,
      comment: typeof obj.comment === 'string' ? obj.comment : undefined,
      draft: obj.draft as Record<string, unknown> | undefined,
      wrong: Array.isArray(obj.wrong)
        ? (obj.wrong as unknown[]).filter((w): w is string => typeof w === 'string')
        : undefined,
    }
  } catch {
    return null
  }
}

// 用户可见的部分：去掉卡片与判定标记
export function stripMarkers(reply: string): string {
  return stripAsk(reply.replace(/<CHECK>[\s\S]*?<\/CHECK>/g, '')).trim()
}

// 待答的卡全是「说一句」时，就是收口那一步
function stageOf(state: AskState): 'cards' | 'say' {
  if (state.cards.length === 0) return 'cards'
  return state.cards.every((c) => c.type === 'say') ? 'say' : 'cards'
}

// 模型漏标记时的保底卡，保证流程不会卡死
function fallbackCard(question: string): AskCard {
  return {
    id: 'fallback',
    type: 'say',
    question,
    scaffold: '这条知识解决的是……的问题',
    placeholder: '一句话就行',
  }
}

// 一遍对话调模型：漏了标记就补一次，仍然漏就走兜底
async function callCoach(
  messages: ChatMessage[],
  needsCards: boolean,
): Promise<{ reply: string; check: CheckResult | null; cards: AskCard[] }> {
  let reply = await chat(messages, { temperature: 0.5, maxTokens: 1800 })
  let check = parseCheck(reply)
  let cards = parseAsk(reply, 1)

  const missingCheck = !check
  const missingCards = needsCards && (!check || check.verdict === 'next' || check.verdict === 'retry') && cards.length === 0
  if (!missingCheck && !missingCards) return { reply, check, cards }

  const nudge = missingCheck
    ? '（你上一条回复漏了 <CHECK> 判定标记。请重新输出正文，并在末尾补上合法的 <CHECK>。）'
    : '（你上一条回复说还要继续，但没有给出 <ASK> 卡片。请重新输出正文，并补上 <ASK> 卡片。）'
  reply = await chat(
    [...messages, { role: 'assistant', content: reply }, { role: 'user', content: nudge }],
    { temperature: 0.4, maxTokens: 1800 },
  )
  check = parseCheck(reply)
  cards = parseAsk(reply, 1)
  return { reply, check, cards }
}

// 开始过一条：AI 先讲，再给第一批卡
export async function startItem(userId: string, materialId: string, itemId: string) {
  const item = await prisma.materialItem.findFirst({
    where: { id: itemId, materialId, material: { userId } },
    include: { material: true },
  })
  if (!item) throw new MaterialError('这条要点不存在')

  // 已经收录过的不重复开始
  if (item.status === 'passed') throw new MaterialError('这条已经收录过了')

  const profile = await getProfileText(userId)
  const keyFacts = item.keyFacts ? (JSON.parse(item.keyFacts) as string[]) : []
  const opener = OPENER
  const system = materialCoachSystem(
    { title: item.title, gist: item.gist, keyFacts },
    item.material.title,
    profile,
    'open',
    0,
    MAX_WRONG,
  )

  const reply = await chat(
    [
      { role: 'system', content: system },
      { role: 'user', content: opener },
    ],
    { temperature: 0.6, maxTokens: 1600 },
  )
  const cards = parseAsk(reply, 1)
  if (cards.length === 0) throw new MaterialError('教练这回没出题，稍等一下再试一次')

  const state: AskState = { cards, wrong: 0, log: [] }

  // 每次开始都开一条新会话，避免和上一次的遗留上下文串味
  const session = await prisma.conversationSession.create({
    data: {
      userId,
      mode: 'material',
      title: item.title.slice(0, 60),
      rawContent: item.gist,
      messages: JSON.stringify([
        { role: 'user', content: opener },
        { role: 'assistant', content: reply },
      ] satisfies StoredMessage[]),
    },
  })

  await prisma.materialItem.update({
    where: { id: item.id },
    data: {
      status: 'discussing',
      sessionId: session.id,
      attempts: 0,
      askState: JSON.stringify(state),
    },
  })

  return {
    sessionId: session.id,
    reply: stripMarkers(reply),
    cards,
    wrong: 0,
    maxWrong: MAX_WRONG,
    verdict: 'open' as const,
  }
}

// 交一批作答：AI 判定 + 给出下一步
export async function answerItem(userId: string, itemId: string, answers: ItemAnswer[]) {
  const item = await prisma.materialItem.findFirst({
    where: { id: itemId, material: { userId } },
    include: { material: true },
  })
  if (!item) throw new MaterialError('这条要点不存在')
  if (!item.sessionId) throw new MaterialError('这条还没开始，先点开始')

  const session = await prisma.conversationSession.findUnique({ where: { id: item.sessionId } })
  if (!session) throw new MaterialError('讨论记录已失效，请重新开始这一条')

  const state = readState(item.askState)
  if (state.cards.length === 0) throw new MaterialError('这条已经有结论了')

  const submission = describeAnswers(state.cards, answers)
  // 卡片对不上（例如另一个标签页已经答过了），说清楚怎么办，别只说「还没作答」
  if (!submission) {
    throw new MaterialError('这几张卡已经变了，刷新一下页面就能接着答')
  }

  const stage = stageOf(state)
  const profile = await getProfileText(userId)
  const keyFacts = item.keyFacts ? (JSON.parse(item.keyFacts) as string[]) : []
  const system = materialCoachSystem(
    { title: item.title, gist: item.gist, keyFacts },
    item.material.title,
    profile,
    stage,
    state.wrong,
    MAX_WRONG,
  )

  const history = JSON.parse(session.messages) as StoredMessage[]
  const base: ChatMessage[] = [
    { role: 'system', content: system },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: submission },
  ]

  const { reply, check, cards: asked } = await callCoach(base, true)

  let verdict: CheckResult['verdict'] = check?.verdict ?? 'retry'
  let comment = check?.comment
  let draft = check?.draft
  let cards = asked
  let wrong = state.wrong

  if (verdict === 'retry' || verdict === 'giveup') {
    // 模型可能自己就判到顶了，这里也要把次数记满，否则界面上少算一次
    wrong += 1
    if (verdict === 'retry') {
      // 到上限一律收口，避免同一条无限来回
      if (wrong >= MAX_WRONG) {
        verdict = 'giveup'
        cards = []
      } else if (cards.length === 0) {
        cards = [fallbackCard('换个说法，这条知识解决的是什么问题？')]
      }
    } else {
      cards = []
    }
  } else if (verdict === 'next' && cards.length === 0) {
    cards = [fallbackCard('再用一句话说说，这条知识解决的是什么问题？')]
  } else if (verdict === 'pass' && !draft) {
    // 说了过却没给草稿，退回一步重来，避免前端拿到空的收录卡
    verdict = 'retry'
    wrong += 1
    cards = wrong >= MAX_WRONG ? [] : [fallbackCard('这条知识解决的是什么问题？')]
    if (wrong >= MAX_WRONG) verdict = 'giveup'
  }

  const nextState: AskState = {
    cards: verdict === 'pass' || verdict === 'giveup' ? [] : cards,
    wrong,
    log: [...state.log, { type: stage, answer: submission }],
    draft: verdict === 'pass' ? (draft ?? state.draft) : state.draft,
  }

  const newHistory: StoredMessage[] = [
    ...history,
    { role: 'user', content: submission },
    { role: 'assistant', content: reply },
  ]

  await prisma.$transaction([
    prisma.conversationSession.update({
      where: { id: session.id },
      data: {
        messages: JSON.stringify(newHistory),
        status: verdict === 'giveup' ? 'completed' : 'active',
      },
    }),
    prisma.materialItem.update({
      where: { id: item.id },
      data: {
        attempts: wrong,
        askState: JSON.stringify(nextState),
        status: verdict === 'giveup' ? 'review' : 'discussing',
      },
    }),
  ])

  return {
    reply: stripMarkers(reply),
    verdict,
    comment,
    draft: verdict === 'pass' ? draft : undefined,
    cards: nextState.cards,
    wrong,
    maxWrong: MAX_WRONG,
    // 答错的是哪几张卡，前端据此精确标注
    wrongCards: verdict === 'retry' ? (check?.wrong ?? []) : [],
  }
}

// 用户点「举个我自己的例子」：只接例子，不重开流程
export async function addExample(userId: string, itemId: string, text: string) {
  const item = await prisma.materialItem.findFirst({
    where: { id: itemId, material: { userId } },
    include: { material: true },
  })
  if (!item) throw new MaterialError('这条要点不存在')
  if (!item.sessionId) throw new MaterialError('这条还没开始')

  const session = await prisma.conversationSession.findUnique({ where: { id: item.sessionId } })
  if (!session) throw new MaterialError('讨论记录已失效，请重新开始这一条')

  const state = readState(item.askState)
  const profile = await getProfileText(userId)
  const keyFacts = item.keyFacts ? (JSON.parse(item.keyFacts) as string[]) : []
  const system = materialCoachSystem(
    { title: item.title, gist: item.gist, keyFacts },
    item.material.title,
    profile,
    'example',
    state.wrong,
    MAX_WRONG,
  )

  const history = JSON.parse(session.messages) as StoredMessage[]
  const message = `（我补一个自己工作里的例子）${text.trim()}`
  const { reply, check } = await callCoach(
    [
      { role: 'system', content: system },
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: message },
    ],
    false,
  )

  const draft = check?.draft ?? state.draft
  const newHistory: StoredMessage[] = [
    ...history,
    { role: 'user', content: message },
    { role: 'assistant', content: reply },
  ]

  await prisma.$transaction([
    prisma.conversationSession.update({
      where: { id: session.id },
      data: { messages: JSON.stringify(newHistory) },
    }),
    prisma.materialItem.update({
      where: { id: item.id },
      data: { askState: JSON.stringify({ ...state, draft }) },
    }),
  ])

  return { reply: stripMarkers(reply), draft }
}

// 刷新页面后接着答：把这条的对话和还没答的卡都还给前端
export async function getItemThread(userId: string, itemId: string) {
  const item = await prisma.materialItem.findFirst({
    where: { id: itemId, material: { userId } },
  })
  if (!item) throw new MaterialError('这条要点不存在')

  const state = readState(item.askState)
  if (!item.sessionId) return { messages: [], cards: [], wrong: 0, draft: null, maxWrong: MAX_WRONG }

  const session = await prisma.conversationSession.findUnique({ where: { id: item.sessionId } })
  if (!session) return { messages: [], cards: state.cards, wrong: state.wrong, draft: state.draft ?? null, maxWrong: MAX_WRONG }

  const history = (JSON.parse(session.messages) as StoredMessage[])
    .filter((m) => m.role !== 'system')
    .filter((m) => m.content.trim() !== OPENER)
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.role === 'assistant' ? stripMarkers(m.content) : m.content,
    }))
    .filter((m) => m.content)

  return {
    messages: history,
    cards: state.cards,
    wrong: state.wrong,
    draft: state.draft ?? null,
    maxWrong: MAX_WRONG,
  }
}

// 收录完成：把这条标记为已过，并挂上知识 id
export async function completeItem(userId: string, itemId: string, knowledgeId: string) {
  const item = await prisma.materialItem.findFirst({
    where: { id: itemId, material: { userId } },
    include: { material: { include: { items: { select: { id: true, status: true } } } } },
  })
  if (!item) throw new MaterialError('这条要点不存在')

  await prisma.materialItem.update({
    where: { id: item.id },
    data: { status: 'passed', knowledgeId, askState: null },
  })

  // 全部有结论（过了或记为待复习）时，材料自动归档
  const remaining = item.material.items.filter(
    (i) => i.id !== item.id && i.status !== 'passed' && i.status !== 'review',
  )
  if (remaining.length === 0) {
    await prisma.material.update({ where: { id: item.materialId }, data: { status: 'done' } })
  }

  return { ok: true }
}

// 搁置：这一条先跳过，材料留着以后接着过
export async function skipItem(userId: string, itemId: string) {
  const item = await prisma.materialItem.findFirst({
    where: { id: itemId, material: { userId } },
  })
  if (!item) throw new MaterialError('这条要点不存在')
  await prisma.materialItem.update({
    where: { id: item.id },
    data: { status: 'review', askState: null },
  })
  return { ok: true }
}

// 丢掉整份材料（已收录的知识不受影响）
export async function dismissMaterial(userId: string, materialId: string) {
  const material = await prisma.material.findFirst({ where: { id: materialId, userId } })
  if (!material) throw new MaterialError('材料不存在')
  await prisma.material.update({ where: { id: materialId }, data: { status: 'dismissed' } })
  return { ok: true }
}
