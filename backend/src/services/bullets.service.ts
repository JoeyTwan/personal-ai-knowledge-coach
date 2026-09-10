import { prisma } from '../lib/prisma'
import { chatJSON } from '../ai/client'
import { bulletsSystem } from '../ai/prompts'

// 一条知识会被 AI 拆成多条「弹幕要点」，在首页滚动展示。
// 拆解结果存进 Knowledge.bullets（JSON 字符串数组），读取时不再调用 LLM。

export interface BulletSourceInput {
  title: string
  coreConclusion: string
  briefExplanation?: string | null
  detailExplanation?: string | null
  example?: string | null
}

const MAX_BULLET_CHARS = 40
const MAX_BULLETS = 5
const MIN_BULLETS = 2

// 清洗 AI 返回的要点：去空、去重、限长、限制条数。空结果用核心结论兜底，保证一定有弹幕可放。
export function normalizeBullets(raw: unknown, fallback: string): string[] {
  const arr = Array.isArray(raw) ? raw : []
  const seen = new Set<string>()
  const out: string[] = []

  for (const item of arr) {
    if (typeof item !== 'string') continue
    const text = item
      .replace(/^[\s\-•·\d.、）)]+/, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!text) continue
    if (text.length > MAX_BULLET_CHARS) continue
    if (seen.has(text)) continue
    seen.add(text)
    out.push(text)
    if (out.length >= MAX_BULLETS) break
  }

  if (out.length < MIN_BULLETS) {
    const fb = fallback.replace(/\s+/g, ' ').trim()
    if (fb && !seen.has(fb)) {
      out.push(fb.length > MAX_BULLET_CHARS ? `${fb.slice(0, MAX_BULLET_CHARS - 1)}…` : fb)
    }
  }

  return out.slice(0, MAX_BULLETS)
}

export function parseBullets(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
  } catch {
    return []
  }
}

// 调用 LLM 把一条知识拆成弹幕要点（失败不抛错，退回核心结论）
export async function generateBullets(input: BulletSourceInput): Promise<string[]> {
  const parts = [`标题：${input.title}`, `核心结论：${input.coreConclusion}`]
  if (input.briefExplanation) parts.push(`简洁解释：${input.briefExplanation}`)
  if (input.detailExplanation) parts.push(`详细解释：${input.detailExplanation}`)
  if (input.example) parts.push(`示例：${input.example}`)

  try {
    const raw = await chatJSON<unknown>([
      { role: 'system', content: bulletsSystem() },
      { role: 'user', content: parts.join('\n') },
    ])
    return normalizeBullets(raw, input.coreConclusion)
  } catch (e) {
    console.error('[弹幕要点] AI 拆解失败，退回核心结论', e)
    return normalizeBullets([], input.coreConclusion)
  }
}

// 生成后写回数据库
export async function attachBullets(knowledgeId: string, input: BulletSourceInput): Promise<string[]> {
  const bullets = await generateBullets(input)
  await prisma.knowledge.update({
    where: { id: knowledgeId },
    data: { bullets: JSON.stringify(bullets) },
  })
  return bullets
}

export interface DanmakuItem {
  id: string
  knowledgeId: string
  text: string
  weak: boolean
}

// 弱项权重大（随机键更小 → 更靠前），保证弹幕里既优先出现该回看的内容，也不会全是弱项
function biasedShuffle(items: DanmakuItem[]): DanmakuItem[] {
  return items
    .map((it) => ({ it, key: Math.random() * (it.weak ? 1 : 2.6) }))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.it)
}

// 组装弹幕池：把每条知识的要点展开成一条条弹幕，并标记「值得优先看到」的弱项
export async function getDanmakuPool(userId: string, limit = 300): Promise<DanmakuItem[]> {
  const knowledges = await prisma.knowledge.findMany({
    where: { userId, status: 'active' },
    orderBy: { updatedAt: 'desc' },
    take: 80,
    select: {
      id: true,
      coreConclusion: true,
      bullets: true,
      states: { where: { userId } },
    },
  })

  const now = Date.now()

  // 先给每条知识算一个「薄弱分」，再取相对最薄弱的一批标为 weak。
  // 用相对排名而不是绝对阈值，避免用户刚起步、所有知识都没自测过时全部变成金色。
  const scored = knowledges.map((k) => {
    const st = k.states[0]
    if (!st) return { k, score: 0.52 }
    const avg =
      (st.awareness +
        st.recall +
        st.understanding +
        st.association +
        st.application +
        st.stability) /
      6
    const forget = st.forgetRisk ?? 0
    const due = st.nextReviewAt ? st.nextReviewAt.getTime() <= now : false
    let score = (1 - avg) * 0.6 + forget * 0.4
    if (due && st.reviewCount > 0) score += 0.08
    return { k, score }
  })

  const ranked = [...scored].sort((a, b) => b.score - a.score)
  const cut = Math.max(1, Math.ceil(ranked.length * 0.35))
  const weakIds = new Set(
    ranked
      .slice(0, cut)
      .filter((s) => s.score >= 0.45)
      .map((s) => s.k.id),
  )

  const items: DanmakuItem[] = []
  for (const { k } of scored) {
    const bullets = parseBullets(k.bullets)
    const texts = bullets.length > 0 ? bullets : [k.coreConclusion]
    texts.forEach((text, i) => {
      items.push({ id: `${k.id}-${i}`, knowledgeId: k.id, text, weak: weakIds.has(k.id) })
    })
  }

  return biasedShuffle(items).slice(0, limit)
}

// 回填：给还没有弹幕要点的知识补生成（用于脚本或按需触发）
export async function backfillBullets(userId: string): Promise<{ total: number; filled: number }> {
  const knowledges = await prisma.knowledge.findMany({
    where: { userId, status: 'active' },
    select: {
      id: true,
      title: true,
      coreConclusion: true,
      briefExplanation: true,
      detailExplanation: true,
      example: true,
      bullets: true,
    },
  })

  let filled = 0
  for (const k of knowledges) {
    if (parseBullets(k.bullets).length >= MIN_BULLETS) continue
    await attachBullets(k.id, k)
    filled += 1
  }

  return { total: knowledges.length, filled }
}
