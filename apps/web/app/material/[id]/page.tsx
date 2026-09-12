'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { apiGet, apiPost } from '@/lib/api'
import Markdown from '@/components/Markdown'
import AutoTextarea from '@/components/AutoTextarea'
import AskCards, {
  type AskCard,
  type CardAnswer,
  type GroupState,
} from '@/components/AskCards'

interface Item {
  id: string
  order: number
  title: string
  gist: string
  keyFacts: string[]
  status: 'todo' | 'discussing' | 'passed' | 'review'
  wrong: number
  maxWrong: number
  knowledgeId: string | null
  sessionId: string | null
  cards: AskCard[]
  draft: Draft | null
}

interface Material {
  id: string
  title: string
  kind: string
  status: string
  overflow: number
  items: Item[]
}

interface Draft {
  title?: string
  coreConclusion?: string
  briefExplanation?: string
  detailExplanation?: string
  example?: string
  type?: string
  tags?: string[]
}

// 对话流里的一项：AI 说的话，或者一批要答的卡
type ThreadItem =
  | { kind: 'text'; key: string; role: 'user' | 'assistant'; content: string }
  | {
      kind: 'cards'
      key: string
      cards: AskCard[]
      answers: Record<string, CardAnswer>
      state: GroupState
      verdict?: string
      wrongCards?: string[]
      progress?: string
    }

interface StartRes {
  sessionId: string
  reply: string
  cards: AskCard[]
  wrong: number
}

interface AnswerRes {
  reply: string
  verdict: 'next' | 'retry' | 'pass' | 'giveup'
  comment?: string
  draft?: Draft
  cards: AskCard[]
  wrong: number
  wrongCards: string[]
}

interface ThreadRes {
  messages: { role: 'user' | 'assistant'; content: string }[]
  cards: AskCard[]
  wrong: number
  draft: Draft | null
}

const SOURCE_TYPES = ['自己思考的', '听别人说的', '社交媒体/博客等']

// 过关阶梯的四个档位，和进度点一一对应
const STEP_LABEL = ['讲清楚', '认出来', '用得上', '说一句']

const KIND_LABEL: Record<string, string> = {
  image: '图片',
  pdf: 'PDF',
  docx: '文档',
  text: '文本',
}

// 进度提示写成「还要做什么」，不写「第几步 / 共几步」，后者像考试进度条，有压力
function progressOf(cards: AskCard[]): string {
  if (cards.length === 0) return ''
  return cards.every((c) => c.type === 'say')
    ? '最后一步：用一句话说说这条解决什么问题'
    : '选一个就行，拿不准就点说不好'
}

let seq = 0
const nextKey = () => `k${++seq}`

export default function MaterialPage() {
  const params = useParams<{ id: string }>()
  const materialId = params.id

  const [material, setMaterial] = useState<Material | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [activeItem, setActiveItem] = useState<Item | null>(null)
  const [thread, setThread] = useState<ThreadItem[]>([])
  const [thinking, setThinking] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [sourceType, setSourceType] = useState(SOURCE_TYPES[0])
  const [finished, setFinished] = useState<'none' | 'giveup' | 'pass'>('none')

  const [exampleOpen, setExampleOpen] = useState(false)
  const [exampleText, setExampleText] = useState('')
  const [editing, setEditing] = useState(false)

  const bottomRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const m = await apiGet<Material>(`/api/material/${materialId}`)
      setMaterial(m)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [materialId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [thread, thinking, draft, exampleOpen])

  // 打开一条：没答完的接着答，没开始的从头讲
  async function openItem(item: Item) {
    if (thinking) return
    setThinking(true)
    setError('')
    setDraft(item.draft ?? null)
    setFinished('none')
    setExampleOpen(false)
    setExampleText('')
    setEditing(false)
    setActiveItem(item)
    setThread([])

    try {
      if (item.status === 'discussing' && item.sessionId) {
        const res = await apiGet<ThreadRes>(`/api/material/items/${item.id}/thread`)
        const items: ThreadItem[] = res.messages.map((m) => ({
          kind: 'text',
          key: nextKey(),
          role: m.role,
          content: m.content,
        }))
        if (res.cards.length > 0) {
          items.push({
            kind: 'cards',
            key: nextKey(),
            cards: res.cards,
            answers: {},
            state: 'answering',
            progress: progressOf(res.cards),
          })
        } else if (res.draft) {
          setDraft(res.draft)
        }
        setThread(items)
      } else {
        const res = await apiPost<StartRes>(`/api/material/${materialId}/items/${item.id}/start`)
        setThread([
          { kind: 'text', key: nextKey(), role: 'assistant', content: res.reply },
          {
            kind: 'cards',
            key: nextKey(),
            cards: res.cards,
            answers: {},
            state: 'answering',
            progress: progressOf(res.cards),
          },
        ])
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setThinking(false)
    }
  }

  function patchLastCards(fn: (item: Extract<ThreadItem, { kind: 'cards' }>) => ThreadItem) {
    setThread((t) => {
      const idx = [...t].reverse().findIndex((x) => x.kind === 'cards')
      if (idx < 0) return t
      const real = t.length - 1 - idx
      const copy = [...t]
      copy[real] = fn(copy[real] as Extract<ThreadItem, { kind: 'cards' }>)
      return copy
    })
  }

  function changeAnswer(cardId: string, patch: Partial<CardAnswer>) {
    patchLastCards((item) => ({
      ...item,
      answers: { ...item.answers, [cardId]: { ...item.answers[cardId], ...patch, cardId } },
    }))
  }

  // 交一批作答
  async function submitCards() {
    if (!activeItem || thinking) return
    const last = [...thread].reverse().find((x) => x.kind === 'cards') as
      | Extract<ThreadItem, { kind: 'cards' }>
      | undefined
    const payload = last
      ? Object.values(last.answers).filter((a) => a.choice || (a.text ?? '').trim())
      : []
    if (payload.length === 0) return

    patchLastCards((item) => ({ ...item, state: 'grading' }))
    setThinking(true)
    setError('')
    try {
      const res = await apiPost<AnswerRes>(`/api/material/items/${activeItem.id}/answer`, {
        answers: payload,
      })
      patchLastCards((item) => ({
        ...item,
        state: 'graded',
        verdict: res.verdict,
        wrongCards: res.wrongCards,
        progress: undefined,
      }))

      const added: ThreadItem[] = []
      if (res.reply) {
        added.push({ kind: 'text', key: nextKey(), role: 'assistant', content: res.reply })
      }
      if (res.verdict === 'pass' && res.draft) {
        setDraft(res.draft)
        setFinished('pass')
      } else if (res.verdict === 'giveup') {
        setFinished('giveup')
      } else if (res.cards.length > 0) {
        added.push({
          kind: 'cards',
          key: nextKey(),
          cards: res.cards,
          answers: {},
          state: 'answering',
          progress: progressOf(res.cards),
        })
      }
      if (added.length) setThread((t) => [...t, ...added])
      setActiveItem((it) => (it ? { ...it, wrong: res.wrong, cards: res.cards, status: 'discussing' } : it))
    } catch (e: any) {
      setError(e.message)
      patchLastCards((item) => ({ ...item, state: 'answering' }))
    } finally {
      setThinking(false)
    }
  }

  // 补一个自己的例子（可选，不影响过关）
  async function submitExample() {
    if (!activeItem || !exampleText.trim() || thinking) return
    const text = exampleText.trim()
    setExampleText('')
    setExampleOpen(false)
    setThinking(true)
    setError('')
    setThread((t) => [...t, { kind: 'text', key: nextKey(), role: 'user', content: text }])
    try {
      const res = await apiPost<{ reply: string; draft: Draft }>(
        `/api/material/items/${activeItem.id}/example`,
        { text },
      )
      if (res.reply) {
        setThread((t) => [...t, { kind: 'text', key: nextKey(), role: 'assistant', content: res.reply }])
      }
      if (res.draft) setDraft(res.draft)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setThinking(false)
    }
  }

  async function confirm() {
    if (!draft || !activeItem) return
    setThinking(true)
    setError('')
    try {
      const knowledge = await apiPost<{ id: string }>('/api/cocreation/confirm', {
        sessionId: activeItem.sessionId,
        draft,
        sourceType,
        sourceDetail: material ? `材料《${material.title}》` : undefined,
      })
      await apiPost(`/api/material/items/${activeItem.id}/complete`, { knowledgeId: knowledge.id })
      closeItem()
      await load()
    } catch (e: any) {
      setError(e.message)
      setThinking(false)
    }
  }

  async function skip() {
    if (!activeItem) return
    setThinking(true)
    try {
      await apiPost(`/api/material/items/${activeItem.id}/skip`)
      closeItem()
      await load()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setThinking(false)
    }
  }

  function closeItem() {
    setActiveItem(null)
    setThread([])
    setDraft(null)
    setFinished('none')
    setExampleOpen(false)
    setExampleText('')
    setEditing(false)
  }

  if (loading) return <div className="card text-sm text-muted">正在加载材料…</div>
  if (!material) return <div className="card text-sm text-danger">{error || '材料不存在'}</div>

  const passed = material.items.filter((i) => i.status === 'passed').length
  const review = material.items.filter((i) => i.status === 'review').length
  const allSettled = material.items.every((i) => i.status === 'passed' || i.status === 'review')

  return (
    <div className="space-y-5">
      <header>
        {activeItem ? (
          <button className="text-[13px] text-muted transition-colors hover:text-ink" onClick={closeItem}>
            ← 回到清单
          </button>
        ) : (
          <Link href="/record" className="text-[13px] text-muted transition-colors hover:text-ink">
            ← 记录
          </Link>
        )}
        <h1 className="h-serif mt-2 text-xl font-semibold">{material.title}</h1>
        <p className="mt-1 text-[13px] text-muted">
          {KIND_LABEL[material.kind] ?? '材料'} · 共 {material.items.length} 条 · 已收录 {passed} 条
          {review > 0 && ` · 待复习 ${review} 条`}
        </p>
      </header>

      {material.overflow > 0 && !activeItem && (
        <p className="rounded-2xl border border-ink/10 bg-surface2 px-4 py-3 text-[13px] text-muted">
          这份材料偏大，先挑了最值得学的 {material.items.length} 条，另有 {material.overflow} 条没有展开。
        </p>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}

      {/* ===== 清单视图 ===== */}
      {!activeItem && (
        <div className="space-y-2.5">
          {material.items.map((item) => {
            const done = item.status === 'passed'
            const held = item.status === 'review'
            const ongoing = item.status === 'discussing'
            return (
              <button
                key={item.id}
                onClick={() => !done && openItem(item)}
                disabled={done}
                className={`flex w-full items-start gap-3 rounded-2xl border px-4 py-3.5 text-left transition ${
                  done
                    ? 'border-ink/8 bg-surface opacity-60'
                    : 'border-ink/10 bg-surface hover:border-ink/25'
                }`}
              >
                <span
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] ${
                    done ? 'bg-gold/20 text-gold' : 'bg-ink/8 text-muted'
                  }`}
                >
                  {done ? '✓' : item.order}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-[15px] font-medium">{item.title}</span>
                    {held && <span className="text-[11px] text-muted">待复习</span>}
                    {ongoing && (
                      <span className="text-[11px] text-gold">
                        {item.cards.length > 0 ? '接着答' : '待收录'}
                      </span>
                    )}
                  </span>
                  <span className="mt-1 block text-[13px] leading-relaxed text-muted">
                    {item.gist.length > 72 ? `${item.gist.slice(0, 72)}…` : item.gist}
                  </span>
                </span>
              </button>
            )
          })}

          {allSettled && (
            <div className="card mt-4 text-center">
              <p className="text-[15px] font-medium">这份材料过完了</p>
              <p className="mt-1 text-[13px] text-muted">
                收录了 {passed} 条
                {review > 0 && `，另有 ${review} 条记进了待复习`}。原文已经丢掉，留下来的只有这些知识。
              </p>
              <Link href="/knowledge" className="btn btn-primary mt-4 inline-flex">
                去知识库看看
              </Link>
            </div>
          )}
        </div>
      )}

      {/* ===== 逐条过关视图 ===== */}
      {activeItem && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-ink/10 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 flex-1 truncate text-[15px] font-medium">{activeItem.title}</p>
              {(() => {
                // 四步阶梯：讲清楚 → 认出来 → 用得上 → 说一句
                const done = thread.filter(
                  (t) =>
                    t.kind === 'cards' &&
                    t.state === 'graded' &&
                    (t.verdict === 'next' || t.verdict === 'pass'),
                ).length
                const step = Math.min(3, done)
                return (
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="flex items-center gap-1">
                      {[0, 1, 2, 3].map((i) => (
                        <span
                          key={i}
                          className={`h-1.5 w-1.5 rounded-full ${i <= step ? 'bg-gold' : 'bg-ink/15'}`}
                        />
                      ))}
                    </span>
                    <span className="text-[12px] text-muted">{STEP_LABEL[step]}</span>
                  </span>
                )
              })()}
            </div>
            {activeItem.wrong > 0 && (
              <p className="mt-1 text-[12px] text-muted">这条重讲了 {activeItem.wrong} 次</p>
            )}
          </div>

          <div className="space-y-4">
            {thread.map((item) =>
              item.kind === 'text' ? (
                <div
                  key={item.key}
                  className={`flex ${item.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[88%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed ${
                      item.role === 'user' ? 'bg-gold/18 text-ink' : 'bg-surface2 text-ink'
                    }`}
                  >
                    {item.role === 'user' ? (
                      <span className="whitespace-pre-wrap">{item.content}</span>
                    ) : (
                      <Markdown content={item.content} />
                    )}
                  </div>
                </div>
              ) : (
                <AskCards
                  key={item.key}
                  cards={item.cards}
                  state={item.state}
                  answers={item.answers}
                  verdict={item.verdict}
                  wrongCards={item.wrongCards}
                  progress={item.progress}
                  onChange={changeAnswer}
                  onSubmit={submitCards}
                />
              ),
            )}
            {thinking && <div className="text-sm text-muted">思考中…</div>}
          </div>

          {/* 收录草稿：点选过关后补一句话，确认无误再收录 */}
          {draft && (
            <div className="card border-gold/40">
              <p className="text-[13px] font-medium text-gold">
                {editing ? '改成你自己的说法，再收录' : '这条你拿下了。下面是整理好的知识，确认后收录'}
              </p>

              {/* 草稿允许直接改：AI 讲错的地方，用户说了算 */}
              {editing && (
                <div className="mt-4 space-y-3">
                  <AutoTextarea
                    className="input"
                    value={draft.title ?? ''}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    placeholder="标题"
                  />
                  <AutoTextarea
                    className="input"
                    maxRows={5}
                    value={draft.coreConclusion ?? ''}
                    onChange={(e) => setDraft({ ...draft, coreConclusion: e.target.value })}
                    placeholder="核心结论"
                  />
                  <AutoTextarea
                    className="input"
                    maxRows={4}
                    value={draft.briefExplanation ?? ''}
                    onChange={(e) => setDraft({ ...draft, briefExplanation: e.target.value })}
                    placeholder="简要解释（可选）"
                  />
                  <AutoTextarea
                    className="input"
                    maxRows={8}
                    value={draft.detailExplanation ?? ''}
                    onChange={(e) => setDraft({ ...draft, detailExplanation: e.target.value })}
                    placeholder="详细解释（可选）"
                  />
                  <AutoTextarea
                    className="input"
                    maxRows={5}
                    value={draft.example ?? ''}
                    onChange={(e) => setDraft({ ...draft, example: e.target.value })}
                    placeholder="例子（可选）"
                  />
                </div>
              )}

              <div className={`mt-4 space-y-4 ${editing ? 'hidden' : ''}`}>
                {draft.title && (
                  <div>
                    <p className="text-[12px] text-muted">标题</p>
                    <p className="mt-1 text-[16px] font-semibold">{draft.title}</p>
                  </div>
                )}
                {draft.coreConclusion && (
                  <div>
                    <p className="text-[12px] text-muted">核心结论</p>
                    <p className="mt-1 text-[15px] leading-relaxed">{draft.coreConclusion}</p>
                  </div>
                )}
                {draft.briefExplanation && (
                  <div>
                    <p className="text-[12px] text-muted">简要解释</p>
                    <p className="mt-1 text-[14px] leading-relaxed text-ink/85">{draft.briefExplanation}</p>
                  </div>
                )}
                {draft.detailExplanation && (
                  <div>
                    <p className="text-[12px] text-muted">详细解释</p>
                    <div className="mt-1">
                      <Markdown content={draft.detailExplanation} />
                    </div>
                  </div>
                )}
                {draft.example && (
                  <div>
                    <p className="text-[12px] text-muted">例子</p>
                    <div className="mt-1">
                      <Markdown content={draft.example} />
                    </div>
                  </div>
                )}
                {draft.tags && draft.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {draft.tags.map((t) => (
                      <span key={t} className="rounded-full bg-gold/15 px-2 py-0.5 text-[11px]">
                        #{t}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* 举例是可选的加分项，不是门槛 */}
              {!editing && !exampleOpen ? (
                <button
                  className="mt-4 text-[13px] text-muted transition-colors hover:text-ink"
                  onClick={() => setExampleOpen(true)}
                  disabled={thinking}
                >
                  {draft.example ? '换个我自己的例子' : '举个我自己工作里的例子（可选）'}
                </button>
              ) : !editing ? (
                <div className="mt-4">
                  <textarea
                    className="input"
                    rows={2}
                    value={exampleText}
                    onChange={(e) => setExampleText(e.target.value)}
                    placeholder="一句话就行，比如上次给客户做方案时遇到的那件事…"
                  />
                  <div className="mt-2 flex gap-2">
                    <button
                      className="btn btn-ghost"
                      onClick={submitExample}
                      disabled={thinking || !exampleText.trim()}
                    >
                      加上
                    </button>
                    <button className="btn btn-ghost" onClick={() => setExampleOpen(false)}>
                      算了
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="mt-5 border-t border-ink/10 pt-4">
                <p className="mb-2 text-[12px] text-muted">这条来自哪里？</p>
                <div className="flex flex-wrap gap-2">
                  {SOURCE_TYPES.map((s) => (
                    <button
                      key={s}
                      onClick={() => setSourceType(s)}
                      className={`rounded-full px-3 py-1.5 text-[13px] transition ${
                        sourceType === s
                          ? 'bg-gold text-canvas'
                          : 'border border-ink/15 text-muted hover:border-ink/30'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button className="btn btn-primary" onClick={confirm} disabled={thinking}>
                  {editing ? '确认收录' : '收录'}
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    setExampleOpen(false)
                    setEditing((v) => !v)
                  }}
                  disabled={thinking}
                >
                  {editing ? '返回' : '改一下'}
                </button>
                <button className="btn btn-ghost" onClick={skip} disabled={thinking}>
                  先放着，过下一条
                </button>
              </div>
            </div>
          )}

          {/* 到顶了：如实记为待复习 */}
          {finished === 'giveup' && !draft && (
            <div className="card">
              <p className="text-[14px]">这条今天没拿下，我记进待复习了，以后复习时会再遇到。</p>
              <div className="mt-3 flex gap-2">
                <button className="btn btn-ghost" onClick={skip} disabled={thinking}>
                  过下一条
                </button>
                <button className="btn btn-ghost" onClick={() => openItem(activeItem)} disabled={thinking}>
                  再试一次
                </button>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      )}

      {/* 清单视图底部：整份材料的处理 */}
      {!activeItem && !allSettled && (
        <p className="pt-2 text-center text-[12px] text-faint">
          走不完也没关系，清单留着，下次接着过。
        </p>
      )}
    </div>
  )
}
