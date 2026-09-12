// ===== 卡片协议 =====
// 一份「卡」就是一个具体的小问题，用户点一下就能答完。
// 核心设计原则：一次只问一件事，能点选解决的绝不让用户打字。
// 记录页的追问和材料逐条过关共用同一套卡片，保证两处交互完全一致。

export type AskType = 'judge' | 'scenario' | 'choose' | 'contrast' | 'fill' | 'say'

export interface AskOption {
  label: string
  text: string
}

export interface AskCard {
  id: string
  type: AskType
  question?: string
  statement?: string
  options?: AskOption[]
  unsure?: boolean
  scaffold?: string
  placeholder?: string
}

// 用户对一张卡的作答：点选题给 choice（选项 label），打字题给 text
export interface ItemAnswer {
  cardId: string
  choice?: string
  text?: string
}

export const ASK_TYPES: AskType[] = ['judge', 'scenario', 'choose', 'contrast', 'fill', 'say']
export const CHOICE_TYPES: AskType[] = ['judge', 'scenario', 'choose', 'contrast']
// 每个点选题都带这个出口，用户永远可以说「说不好」，不会被卡死
export const UNSURE = '__unsure__'
export const ASK_LABEL: Record<AskType, string> = {
  judge: '判断',
  scenario: '选场景',
  choose: '选择',
  contrast: '辨析',
  fill: '填空',
  say: '说一句',
}

// 一张卡至少要能被答出来，字段不全就丢掉，不要让前端拿到半张卡
export function normalizeCard(input: unknown, index: number): AskCard | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>
  const type = String(raw.type ?? '') as AskType
  if (!ASK_TYPES.includes(type)) return null

  const question = typeof raw.question === 'string' ? raw.question.trim() : ''
  const statement = typeof raw.statement === 'string' ? raw.statement.trim() : ''
  if (!question && !statement) return null

  const options: AskOption[] = Array.isArray(raw.options)
    ? (raw.options as unknown[])
        .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object')
        .map((o, i) => ({
          label:
            typeof o.label === 'string' && o.label.trim()
              ? o.label.trim().slice(0, 2)
              : String.fromCharCode(65 + i),
          text: String(o.text ?? '').trim().slice(0, 40),
        }))
        .filter((o) => o.text)
        .slice(0, 3)
    : []

  if (CHOICE_TYPES.includes(type) && options.length < 2) return null

  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `c${index + 1}`,
    type,
    question: question || undefined,
    statement: statement || undefined,
    options: options.length ? options : undefined,
    unsure: type === 'judge' && raw.unsure !== false,
    scaffold: typeof raw.scaffold === 'string' ? raw.scaffold.trim() : undefined,
    placeholder: typeof raw.placeholder === 'string' ? raw.placeholder.trim() : undefined,
  }
}

export function normalizeCards(input: unknown): AskCard[] {
  if (!Array.isArray(input)) return []
  return input
    .map((c, i) => normalizeCard(c, i))
    .filter((c): c is AskCard => c !== null)
    .slice(0, 3)
}

// max 用来卡住「一轮最多几张」。材料逐条过关一次只准出一张，记录页追问最多两张。
// 模型经常多给，这里兜住，超过的直接丢掉，保证界面上一次只有一个动作。
export function parseAsk(reply: string, max = 2): AskCard[] {
  const m = reply.match(/<ASK>([\s\S]*?)<\/ASK>/)
  if (!m) return []
  try {
    const obj = JSON.parse(m[1]) as { cards?: unknown }
    return normalizeCards(obj?.cards).slice(0, max)
  } catch {
    return []
  }
}

// 前端提交上来的作答先过一遍，脏数据一律丢掉
export function sanitizeAnswers(input: unknown): ItemAnswer[] {
  if (!Array.isArray(input)) return []
  return input
    .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
    .filter((a) => typeof a.cardId === 'string')
    .map((a) => ({
      cardId: String(a.cardId),
      choice: typeof a.choice === 'string' && a.choice ? a.choice : undefined,
      text: typeof a.text === 'string' && a.text.trim() ? a.text.trim() : undefined,
    }))
}

// 把点选和打字攒成一句人话喂回模型，模型才能判对错
export function describeAnswers(cards: AskCard[], answers: ItemAnswer[]): string {
  const lines: string[] = []
  for (const card of cards) {
    const hit = answers.find((a) => a.cardId === card.id)
    if (!hit) continue
    const label = ASK_LABEL[card.type] ?? '作答'
    if (hit.choice === UNSURE) {
      lines.push(`- ${label}：说不好，我不确定`)
      continue
    }
    if (hit.choice) {
      const opt = card.options?.find((o) => o.label === hit.choice)
      lines.push(`- ${label}：${opt ? `${opt.label}. ${opt.text}` : hit.choice}`)
    } else if (hit.text && hit.text.trim()) {
      lines.push(`- ${label}：${hit.text.trim()}`)
    }
  }
  return lines.length ? `我的作答：\n${lines.join('\n')}` : ''
}

// 用户可见的部分：去掉卡片标记
export function stripAsk(reply: string): string {
  return reply.replace(/<ASK>[\s\S]*?<\/ASK>/g, '').trim()
}
