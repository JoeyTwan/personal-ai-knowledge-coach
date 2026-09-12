'use client'

import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { apiGet, apiPost, apiUpload } from '@/lib/api'
import Markdown from '@/components/Markdown'
import AutoTextarea from '@/components/AutoTextarea'
import Composer from '@/components/Composer'

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

// 还没走完的材料
interface PendingMaterial {
  id: string
  title: string
  kind: string
  total: number
  passed: number
}

const KIND_LABEL: Record<string, string> = {
  image: '图片',
  pdf: 'PDF',
  docx: '文档',
  text: '文本',
}

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
  const [uploading, setUploading] = useState(false)
  const [pending, setPending] = useState<PendingMaterial[]>([])

  const bottomRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // 未走完的材料，进来就放在最上面
  useEffect(() => {
    apiGet<PendingMaterial[]>('/api/material/list')
      .then(setPending)
      .catch(() => undefined)
  }, [])

  // 上传一份材料：读懂之后拆成清单，然后跳过去逐条过
  async function uploadFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || uploading) return
    setUploading(true)
    setError('')
    try {
      const material = await apiUpload<{ id: string }>('/api/material/import', file)
      router.push(`/material/${material.id}`)
    } catch (err: any) {
      setError(err.message)
      setUploading(false)
    }
  }

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
          说一段话，或者丢一份笔记、一张截图进来。我会和你讨论，直到你把它讲清楚。
        </p>
      </header>

      {/* 没走完的材料 */}
      {pending.length > 0 && (
        <div className="space-y-2">
          <p className="text-[12px] text-muted">还有 {pending.length} 份材料没走完</p>
          {pending.map((m) => (
            <Link
              key={m.id}
              href={`/material/${m.id}`}
              className="flex items-center justify-between gap-3 rounded-2xl border border-gold/25 bg-gold/6 px-4 py-3 transition hover:border-gold/45"
            >
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-medium">{m.title}</span>
                <span className="mt-0.5 block text-[12px] text-muted">
                  {KIND_LABEL[m.kind] ?? '材料'} · 已收录 {m.passed} / {m.total} 条
                </span>
              </span>
              <span className="shrink-0 text-[13px] text-gold">接着过</span>
            </Link>
          ))}
        </div>
      )}

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
      <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+64px)] z-20 bg-canvas py-2 sm:bottom-0">
        {uploading && (
          <p className="mb-2 text-center text-[12px] text-gold">
            正在读这份材料，读完会列出里面的知识点…
          </p>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*,.pdf,.docx,.txt,.md"
          className="hidden"
          onChange={uploadFile}
        />
        <Composer
          value={input}
          onChange={setInput}
          onSubmit={send}
          placeholder="说说你学到了什么…"
          loading={loading}
          onAttach={() => fileRef.current?.click()}
          attachDisabled={uploading || loading}
          hint="点左边的加号可以传笔记或截图"
        />
      </div>
      <div ref={bottomRef} />
    </div>
  )
}
