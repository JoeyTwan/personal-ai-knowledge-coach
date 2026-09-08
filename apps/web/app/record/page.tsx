'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiPost } from '@/lib/api'
import Markdown from '@/components/Markdown'
import AutoTextarea from '@/components/AutoTextarea'

interface Msg {
  role: 'user' | 'assistant'
  content: string
}

interface Question {
  id: string
  text: string
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

interface DiscussRes {
  sessionId: string
  reply: string
  questions?: Question[]
  consensusReached: boolean
  draft: Draft | null
}

// 来源固定三类
const SOURCE_TYPES = ['自己思考的', '听别人说的', '社交媒体/博客等']

function cleanReply(reply: string) {
  return reply
    .replace(/<CONSENSUS>[\s\S]*?<\/CONSENSUS>/g, '')
    .replace(/<QUESTIONS>[\s\S]*?<\/QUESTIONS>/g, '')
    .trim()
}

export default function RecordPage() {
  const router = useRouter()
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const [summarizing, setSummarizing] = useState(false)
  const [questions, setQuestions] = useState<Question[]>([])
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [sourceType, setSourceType] = useState('自己思考的')

  const bottomRef = useRef<HTMLDivElement>(null)

  // 微信式：新消息自动滚到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, loading, questions, draft])

  function applyReply(res: DiscussRes) {
    setSessionId(res.sessionId)
    setMessages((m) => [...m, { role: 'assistant', content: cleanReply(res.reply) }])
    if (res.consensusReached) {
      setDraft(res.draft)
      setQuestions([])
    } else {
      setQuestions(res.questions ?? [])
      if (res.questions?.length) setAnswers({})
    }
  }

  async function send() {
    if (!input.trim() || loading) return
    const text = input.trim()
    setInput('')
    setMessages((m) => [...m, { role: 'user', content: text }])
    setLoading(true)
    setError('')
    try {
      const res = await apiPost<DiscussRes>('/api/cocreation/discuss', { sessionId, message: text })
      applyReply(res)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // 表单式追问：把每个追问的答案打包成一条消息提交
  async function submitAnswers() {
    if (loading) return
    const filled = questions
      .map((q) => `- ${q.text}\n  我的回答：${answers[q.id]?.trim() || '（暂未回答）'}`)
      .join('\n')
    setMessages((m) => [...m, { role: 'user', content: `关于你的追问，我的回答：\n${filled}` }])
    setQuestions([])
    setAnswers({})
    setLoading(true)
    setError('')
    try {
      const res = await apiPost<DiscussRes>('/api/cocreation/discuss', {
        sessionId,
        message: `关于你的追问，我的回答：\n${filled}`,
      })
      applyReply(res)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function confirm(payload?: Draft) {
    const d = payload ?? draft
    if (!d) return
    setLoading(true)
    setError('')
    try {
      const knowledge = await apiPost<any>('/api/cocreation/confirm', {
        sessionId,
        draft: d,
        sourceType,
      })
      router.push(`/knowledge/${knowledge.id}`)
    } catch (e: any) {
      setError(e.message)
      setLoading(false)
    }
  }

  function discard() {
    setDraft(null)
    setMessages((m) => [...m, { role: 'assistant', content: '好的，已放弃这条，我们继续。' }])
  }

  // 兜底：AI 未自动出共识标记时，用户主动触发总结生成草稿
  async function summarize() {
    if (!sessionId || summarizing) return
    setSummarizing(true)
    setError('')
    try {
      const res = await apiPost<{ draft: Draft }>('/api/cocreation/summarize', { sessionId })
      if (res.draft) setDraft(res.draft)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSummarizing(false)
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="h-serif text-xl font-semibold">记录新知识</h1>
        <p className="mt-1 text-sm text-muted">
          用一句话告诉我你最近学到了什么，我会和你讨论，直到形成共识。
        </p>
      </header>

      {/* 对话区 */}
      <div className="space-y-4">
        {messages.length === 0 && (
          <div className="card py-8 text-center text-sm text-muted">
            试着说：「我今天研究了一个计算机视觉问题，我发现视觉 Transformer 的优势是它可以一次看到整张图像……」
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed ${
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
        {loading && <div className="text-sm text-muted">思考中…</div>}
      </div>

      {/* 结构化追问表单 */}
      {questions.length > 0 && !draft && (
        <div className="card border-gold/40">
          <p className="text-[13px] font-medium text-gold">我还想了解几点，请在下面回答</p>
          <div className="mt-3 space-y-4">
            {questions.map((q) => (
              <div key={q.id}>
                <p className="text-[14px] font-medium">{q.text}</p>
                <AutoTextarea
                  className="input mt-2"
                  value={answers[q.id] ?? ''}
                  onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                  placeholder="在这里输入你的回答…"
                />
              </div>
            ))}
          </div>
          <button className="btn btn-primary mt-4" onClick={submitAnswers} disabled={loading}>
            提交答案
          </button>
        </div>
      )}

      {/* 共识草稿：完整展示待收录知识 */}
      {draft && !editing && (
        <div className="card border-gold/40">
          <p className="text-[13px] font-medium text-gold">已形成共识，请检查下面的知识，确认无误后收录</p>
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
            {draft.type && (
              <div>
                <p className="text-[12px] text-muted">类型</p>
                <p className="mt-1 text-[14px]">{draft.type}</p>
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

          {/* 来源选择 */}
          <div className="mt-5 border-t border-ink/10 pt-4">
            <p className="mb-2 text-[12px] text-muted">这条知识来自哪里？</p>
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
            <button className="btn btn-primary" onClick={() => confirm()} disabled={loading}>
              收录
            </button>
            <button className="btn btn-ghost" onClick={() => setEditing(true)}>
              修改后收录
            </button>
            <button className="btn btn-ghost" onClick={discard}>
              放弃
            </button>
          </div>
        </div>
      )}

      {/* 编辑模式 */}
      {draft && editing && (
        <div className="card border-gold/40">
          <p className="mb-3 text-[13px] font-medium text-gold">修改后再收录</p>
          <div className="space-y-3">
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
              placeholder="示例（可选）"
            />
          </div>
          <div className="mt-3">
            <p className="mb-2 text-[12px] text-muted">来源</p>
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
          <div className="mt-4 flex gap-2">
            <button className="btn btn-primary" onClick={() => confirm()} disabled={loading}>
              确认收录
            </button>
            <button className="btn btn-ghost" onClick={() => setEditing(false)}>
              返回
            </button>
          </div>
        </div>
      )}

      {/* 兜底：AI 未出草稿时提供手动总结入口 */}
      {!draft && questions.length === 0 && messages.length > 0 && !loading && (
        <div className="card border-gold/30">
          <p className="text-[13px] text-muted">
            如果教练还没有给出结论，你可以直接让教练基于上面的讨论总结出一条知识草稿。
          </p>
          <button className="btn btn-ghost mt-2" onClick={summarize} disabled={summarizing}>
            {summarizing ? '正在总结…' : '生成知识草稿'}
          </button>
        </div>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}

      {/* 输入区 */}
      <div className="sticky bottom-0 bg-canvas pt-2">
        <div className="flex items-end gap-2">
          <AutoTextarea
            className="input resize-none"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            placeholder="说说你学到了什么…"
          />
          <button className="btn btn-primary shrink-0" onClick={send} disabled={loading}>
            发送
          </button>
        </div>
      </div>
      <div ref={bottomRef} />
    </div>
  )
}
