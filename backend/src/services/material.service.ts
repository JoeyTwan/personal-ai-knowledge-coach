import { prisma } from '../lib/prisma'
import { chat, chatJSON, imageDataUrl, isSupportedImage, type ChatMessage } from '../ai/client'
import { materialDigestSystem, materialCoachSystem } from '../ai/prompts'
import { getProfileText } from './user.service'

// ===== 材料导入与逐条过关 =====
// 设计要点：
// 1. 原文不入库。解析出的正文只用于拆解，拆完即丢，库里留下的是一条条自带信息量的知识要点。
// 2. 讨论用的是要点，不是原文。所以一条要点的 gist 必须写足信息量。
// 3. 过关判定由 AI 做，但依据必须是能观察到的东西（复述、举例、追问）。

export type MaterialKind = 'image' | 'pdf' | 'docx' | 'text'

export class MaterialError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MaterialError'
  }
}

// 一份材料最多拆出的条数。超过了 AI 只挑最重要的，其余计数丢弃。
const MAX_ITEMS = 8
// 单条最多答几轮，到顶就如实记为待复习
const MAX_ATTEMPTS = 3
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
    current: m.items.find((i) => i.status === 'discussing') ? true : false,
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
    items: material.items.map((it) => ({
      id: it.id,
      order: it.order,
      title: it.title,
      gist: it.gist,
      keyFacts: it.keyFacts ? (JSON.parse(it.keyFacts) as string[]) : [],
      status: it.status,
      attempts: it.attempts,
      knowledgeId: it.knowledgeId,
      sessionId: it.sessionId,
    })),
  }
}

// 从 AI 回复里取出判定标记
interface CheckResult {
  verdict: 'pass' | 'retry' | 'giveup'
  comment?: string
  draft?: Record<string, unknown>
}

function parseCheck(reply: string): CheckResult | null {
  const m = reply.match(/<CHECK>([\s\S]*?)<\/CHECK>/)
  if (!m) return null
  try {
    const obj = JSON.parse(m[1]) as CheckResult
    if (!['pass', 'retry', 'giveup'].includes(obj.verdict)) return null
    return obj
  } catch {
    return null
  }
}

// 用户可见的部分：去掉判定标记
export function stripCheck(reply: string): string {
  return reply.replace(/<CHECK>[\s\S]*?<\/CHECK>/g, '').trim()
}

interface StoredMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

// 开始过一条：AI 先讲解，再抛第一个问题
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
  const system = materialCoachSystem(
    { title: item.title, gist: item.gist, keyFacts },
    item.material.title,
    profile,
  )

  const reply = await chat(
    [
      { role: 'system', content: system },
      { role: 'user', content: '（我开始过这一条，请先讲给我听，再问我问题。）' },
    ],
    { temperature: 0.6, maxTokens: 1600 },
  )

  // 每次开始都开一条新会话，避免和上一次的遗留上下文串味
  const session = await prisma.conversationSession.create({
    data: {
      userId,
      mode: 'material',
      title: item.title.slice(0, 60),
      rawContent: item.gist,
      messages: JSON.stringify([
        { role: 'user', content: '（我开始过这一条，请先讲给我听，再问我问题。）' },
        { role: 'assistant', content: reply },
      ] satisfies StoredMessage[]),
    },
  })

  await prisma.materialItem.update({
    where: { id: item.id },
    data: { status: 'discussing', sessionId: session.id, attempts: 0 },
  })

  return {
    sessionId: session.id,
    reply: stripCheck(reply),
    check: parseCheck(reply),
    attempts: 0,
  }
}

// 回答一轮：AI 判定 过 / 重讲 / 放弃
export async function answerItem(userId: string, itemId: string, answer: string) {
  const item = await prisma.materialItem.findFirst({
    where: { id: itemId, material: { userId } },
    include: { material: true },
  })
  if (!item) throw new MaterialError('这条要点不存在')
  if (!item.sessionId) throw new MaterialError('这条还没开始，先点开始')

  const session = await prisma.conversationSession.findUnique({ where: { id: item.sessionId } })
  if (!session) throw new MaterialError('讨论记录已失效，请重新开始这一条')

  const history = JSON.parse(session.messages) as StoredMessage[]
  const attempts = item.attempts + 1

  const profile = await getProfileText(userId)
  const keyFacts = item.keyFacts ? (JSON.parse(item.keyFacts) as string[]) : []
  const system = materialCoachSystem(
    { title: item.title, gist: item.gist, keyFacts },
    item.material.title,
    profile,
  )

  // 到轮次上限时提前告诉模型：这一轮必须收口
  const wrapUp =
    attempts >= MAX_ATTEMPTS
      ? '\n\n（这是这一条的最后一轮，如果他还是没讲清楚，判定为 giveup。）'
      : ''

  const messages: ChatMessage[] = [
    { role: 'system', content: system + wrapUp },
    ...history,
    { role: 'user', content: answer },
  ]

  const reply = await chat(messages, { temperature: 0.5, maxTokens: 1800 })
  let check = parseCheck(reply)

  // 模型漏了标记时的兜底：还没到上限就按重讲处理，到顶了按放弃处理
  if (!check) {
    check = { verdict: attempts >= MAX_ATTEMPTS ? 'giveup' : 'retry' }
  }
  // 到轮次上限一律收口，避免同一条无限来回
  if (attempts >= MAX_ATTEMPTS && check.verdict === 'retry') {
    check = { ...check, verdict: 'giveup' }
  }

  const newHistory: StoredMessage[] = [
    ...history,
    { role: 'user', content: answer },
    { role: 'assistant', content: reply },
  ]

  await prisma.$transaction([
    prisma.conversationSession.update({
      where: { id: session.id },
      data: { messages: JSON.stringify(newHistory), status: check.verdict === 'giveup' ? 'completed' : 'active' },
    }),
    prisma.materialItem.update({
      where: { id: item.id },
      data: {
        attempts,
        status: check.verdict === 'pass' ? 'discussing' : check.verdict === 'giveup' ? 'review' : 'discussing',
      },
    }),
  ])

  return {
    reply: stripCheck(reply),
    check,
    attempts,
    maxAttempts: MAX_ATTEMPTS,
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
    data: { status: 'passed', knowledgeId },
  })

  // 全部有结论（过了或记为待复习）时，材料自动归档
  const remaining = item.material.items.filter((i) => i.id !== item.id && i.status !== 'passed' && i.status !== 'review')
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
  await prisma.materialItem.update({ where: { id: item.id }, data: { status: 'review' } })
  return { ok: true }
}

// 丢掉整份材料（已收录的知识不受影响）
export async function dismissMaterial(userId: string, materialId: string) {
  const material = await prisma.material.findFirst({ where: { id: materialId, userId } })
  if (!material) throw new MaterialError('材料不存在')
  await prisma.material.update({ where: { id: materialId }, data: { status: 'dismissed' } })
  return { ok: true }
}
