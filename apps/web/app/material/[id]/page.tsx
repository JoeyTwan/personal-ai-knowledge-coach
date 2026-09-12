'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { apiGet, apiPost } from '@/lib/api'
import Markdown from '@/components/Markdown'
import Composer from '@/components/Composer'

interface Item {
  id: string
  order: number
  title: string
  gist: string
  keyFacts: string[]
  status: 'todo' | 'discussing' | 'passed' | 'review'
  attempts: number
  knowledgeId: string | null
  sessionId: string | null
}

interface Material {
  id: string
  title: string
  kind: string
  status: string
  overflow: number
  items: Item[]
}

interface Check {
  verdict: 'pass' | 'retry' | 'giveup'
  comment?: string
  draft?: Draft
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

interface Msg {
  role: 'user' | 'assistant'
  content: string
}

const SOURCE_TYPES = ['自己思考的', '听别人说的', '社交媒体/博客等']

const KIND_LABEL: Record<string, string> = {
  image: '图片',
  pdf: 'PDF',
  docx: '文档',
  text: '文本',
}

export default function MaterialPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const materialId = params.id

  const [material, setMaterial] = useState<Material | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // 正在过的那一条
  const [activeItem, setActiveItem] = useState<Item | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [verdict, setVerdict] = useState<Check | null>(null)
  const [sourceType, setSourceType] = useState(SOURCE_TYPES[0])

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
  }, [messages, thinking, draft])

  // 开始过一条：AI 先讲，再问
  async function startItem(item: Item) {
    if (thinking) return
    setThinking(true)
    setError('')
    setDraft(null)
    setVerdict(null)
    setInput('')
    try {
      const res = await apiPost<{ reply: string; check: Check | null }>(
        `/api/material/${materialId}/items/${item.id}/start`,
      )
      setActiveItem({ ...item, status: 'discussing' })
      setMessages([{ role: 'assistant', content: res.reply }])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setThinking(false)
    }
  }

  // 答一轮
  async function answer() {
    if (!activeItem || !input.trim() || thinking) return
    const text = input.trim()
    setInput('')
    setMessages((m) => [...m, { role: 'user', content: text }])
    setThinking(true)
    setError('')
    try {
      const res = await apiPost<{ reply: string; check: Check; attempts: number }>(
        `/api/material/items/${activeItem.id}/answer`,
        { answer: text },
      )
      setMessages((m) => [...m, { role: 'assistant', content: res.reply }])
      setVerdict(res.check)
      if (res.check.verdict === 'pass' && res.check.draft) {
        setDraft(res.check.draft)
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setThinking(false)
    }
  }

  // 收录这条
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

  // 先搁置这一条
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
    setMessages([])
    setDraft(null)
    setVerdict(null)
    setInput('')
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
            return (
              <button
                key={item.id}
                onClick={() => !done && startItem(item)}
                disabled={done}
                className={`flex w-full items-start gap-3 rounded-2xl border px-4 py-3.5 text-left transition ${
                  done
                    ? 'border-ink/8 bg-surface opacity-60'
                    : 'border-ink/10 bg-surface hover:border-ink/25'
                }`}
              >
                <span
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] ${
                    done ? 'bg-gold/20 text-gold' : held ? 'bg-ink/10 text-muted' : 'bg-ink/8 text-muted'
                  }`}
                >
                  {done ? '✓' : item.order}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-[15px] font-medium">{item.title}</span>
                    {held && <span className="text-[11px] text-muted">待复习</span>}
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
          <div className="card border-gold/30">
            <p className="text-[12px] text-gold">
              第 {activeItem.order} 条 · 已答 {activeItem.attempts} / 3 轮
            </p>
            <p className="mt-1.5 text-[15px] font-medium">{activeItem.title}</p>
          </div>

          <div className="space-y-4">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[88%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed ${
                    m.role === 'user' ? 'bg-gold/18 text-ink' : 'bg-surface2 text-ink'
                  }`}
                >
                  {m.role === 'user' ? (
                    <span className="whitespace-pre-wrap">{m.content}</span>
                  ) : (
                    <Markdown content={m.content} />
                  )}
                </div>
              </div>
            ))}
            {thinking && <div className="text-sm text-muted">思考中…</div>}
          </div>

          {/* 答对了：给出草稿，确认后收录 */}
          {draft && (
            <div className="card border-gold/40">
              <p className="text-[13px] font-medium text-gold">
                这条你拿下了。下面是整理好的知识，确认后收录
              </p>
              <div className="mt-4 space-y-4">
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
                    <p className="text-[12px] text-muted">示例</p>
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
                  收录
                </button>
                <button className="btn btn-ghost" onClick={skip} disabled={thinking}>
                  先放着，过下一条
                </button>
              </div>
            </div>
          )}

          {/* 三轮到顶：如实记为待复习 */}
          {verdict?.verdict === 'giveup' && !draft && (
            <div className="card">
              <p className="text-[14px]">这条今天没拿下，我记进待复习了，以后复习时会再遇到。</p>
              <div className="mt-3 flex gap-2">
                <button className="btn btn-ghost" onClick={skip} disabled={thinking}>
                  过下一条
                </button>
                <button className="btn btn-ghost" onClick={() => startItem(activeItem)} disabled={thinking}>
                  再试一次
                </button>
              </div>
            </div>
          )}

          {/* 输入区 */}
          {!draft && verdict?.verdict !== 'giveup' && (
            <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+64px)] z-20 bg-canvas py-2 sm:bottom-0">
              <Composer
                value={input}
                onChange={setInput}
                onSubmit={answer}
                placeholder="用你自己的话讲一遍，再举个例子…"
                loading={thinking}
              />
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
