'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiPost } from '@/lib/api'

interface Msg {
  role: 'user' | 'assistant'
  content: string
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

export default function RecordPage() {
  const router = useRouter()
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')

  async function send() {
    if (!input.trim() || loading) return
    const text = input.trim()
    setInput('')
    setMessages((m) => [...m, { role: 'user', content: text }])
    setLoading(true)
    setError('')
    try {
      const res = await apiPost<{
        sessionId: string
        reply: string
        consensusReached: boolean
        draft: Draft | null
      }>('/api/cocreation/discuss', { sessionId, message: text })
      setSessionId(res.sessionId)
      setMessages((m) => [...m, { role: 'assistant', content: res.reply }])
      if (res.consensusReached) setDraft(res.draft)
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
      const knowledge = await apiPost<any>('/api/cocreation/confirm', { sessionId, draft: d })
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
                m.role === 'user' ? 'bg-ink text-paper' : 'bg-mist text-ink'
              }`}
            >
              {m.content.replace(/<CONSENSUS>[\s\S]*?<\/CONSENSUS>/g, '').trim()}
            </div>
          </div>
        ))}
        {loading && <div className="text-sm text-muted">思考中…</div>}
      </div>

      {/* 共识草稿 + 操作 */}
      {draft && !editing && (
        <div className="card border-gold/50">
          <p className="text-[13px] font-medium text-gold">已形成共识，请确认是否收录</p>
          <div className="mt-3 space-y-2">
            <p className="text-[15px] font-semibold">{draft.title}</p>
            <p className="text-[14px] leading-relaxed">{draft.coreConclusion}</p>
            {draft.tags && draft.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {draft.tags.map((t) => (
                  <span key={t} className="rounded-full bg-gold/15 px-2 py-0.5 text-[11px]">
                    {t}
                  </span>
                ))}
              </div>
            )}
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
          <p className="mt-2 text-[12px] text-muted">「继续讨论」可在下方输入框继续追问。</p>
        </div>
      )}

      {/* 编辑模式 */}
      {draft && editing && (
        <div className="card border-gold/50">
          <p className="mb-3 text-[13px] font-medium text-gold">修改后再收录</p>
          <div className="space-y-3">
            <input
              className="input"
              value={draft.title ?? ''}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="标题"
            />
            <textarea
              className="input min-h-[80px]"
              value={draft.coreConclusion ?? ''}
              onChange={(e) => setDraft({ ...draft, coreConclusion: e.target.value })}
              placeholder="核心结论"
            />
            <textarea
              className="input min-h-[60px]"
              value={draft.detailExplanation ?? ''}
              onChange={(e) => setDraft({ ...draft, detailExplanation: e.target.value })}
              placeholder="详细解释（可选）"
            />
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

      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* 输入区 */}
      <div className="sticky bottom-0 bg-paper pt-2">
        <div className="flex items-end gap-2">
          <textarea
            className="input min-h-[48px] resize-none"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            placeholder="说说你学到了什么…"
            rows={1}
          />
          <button className="btn btn-primary shrink-0" onClick={send} disabled={loading}>
            发送
          </button>
        </div>
      </div>
    </div>
  )
}
