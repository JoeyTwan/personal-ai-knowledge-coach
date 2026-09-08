'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { apiGet, apiPost, apiDelete } from '@/lib/api'
import Markdown from '@/components/Markdown'
import AutoTextarea from '@/components/AutoTextarea'

interface Related {
  id: string
  title: string
  coreConclusion: string
  createdAt: string
}

interface Msg {
  id: string
  role: 'user' | 'assistant'
  content: string
  related?: Related[]
}

interface Session {
  id: string
  title: string
  updatedAt: string
  count: number
}

let uid = 0
const nextId = () => `m${Date.now().toString(36)}${(uid++).toString(36)}`

const SAMPLES = [
  '帮我梳理一下最近记录的 Transformer 相关知识',
  '客户需要一个 AI 服务器整机集成方案，我以前记录过合适的公司吗？',
]

function formatTime(d: string) {
  const date = new Date(d)
  const diff = Date.now() - date.getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} 小时前`
  const days = Math.floor(h / 24)
  if (days < 7) return `${days} 天前`
  return date.toLocaleDateString('zh-CN')
}

export default function AskPage() {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copiedId, setCopiedId] = useState('')
  const [sessionId, setSessionId] = useState<string | undefined>(undefined)
  const [sessions, setSessions] = useState<Session[]>([])
  const [showHistory, setShowHistory] = useState(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('history')) {
      return true
    }
    return false
  })
  const bottomRef = useRef<HTMLDivElement>(null)

  // 加载历史会话列表
  async function loadSessions() {
    try {
      const list = await apiGet<Session[]>('/api/ask/sessions')
      setSessions(list)
    } catch {
      // 忽略，历史列表加载失败不影响对话
    }
  }

  useEffect(() => {
    loadSessions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 有新消息或进入思考态时，自动滚到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  async function send() {
    const q = input.trim()
    if (!q || loading) return
    setInput('')
    setError('')

    // 带上当前会话历史，形成多轮上下文
    const history = messages.map((m) => ({ role: m.role, content: m.content }))
    setMessages((prev) => [...prev, { id: nextId(), role: 'user', content: q }])
    setLoading(true)

    try {
      const res = await apiPost<{
        answer: string
        related: Related[]
        sessionId: string
        title: string
      }>('/api/ask', {
        question: q,
        history,
        sessionId,
      })
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: 'assistant', content: res.answer, related: res.related ?? [] },
      ])
      if (res.sessionId && res.sessionId !== sessionId) {
        setSessionId(res.sessionId)
      }
      loadSessions()
    } catch (e: any) {
      setError(e.message ?? '回答出错，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  async function loadSession(id: string) {
    try {
      const s = await apiGet<{
        id: string
        title: string
        messages: { role: 'user' | 'assistant'; content: string; related?: Related[] }[]
      }>(`/api/ask/sessions/${id}`)
      if (s && Array.isArray(s.messages)) {
        setMessages(s.messages.map((m) => ({ ...m, id: nextId() })))
        setSessionId(s.id)
      }
      setShowHistory(false)
    } catch (e: any) {
      setError(e.message ?? '加载会话失败')
    }
  }

  async function deleteSession(id: string) {
    try {
      await apiDelete(`/api/ask/sessions/${id}`)
      setSessions((prev) => prev.filter((s) => s.id !== id))
      if (sessionId === id) {
        setMessages([])
        setSessionId(undefined)
      }
    } catch (e: any) {
      setError(e.message ?? '删除会话失败')
    }
  }

  function newChat() {
    setMessages([])
    setSessionId(undefined)
    setInput('')
    setError('')
    setShowHistory(false)
  }

  async function copy(m: Msg) {
    try {
      await navigator.clipboard.writeText(m.content)
      setCopiedId(m.id)
      setTimeout(() => setCopiedId(''), 1500)
    } catch {
      setCopiedId('')
    }
  }

  function remove(id: string) {
    setMessages((prev) => prev.filter((m) => m.id !== id))
  }

  return (
    <div className="flex h-[calc(100dvh-9rem)] min-h-[520px] flex-col">
      <header className="mb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="h-serif text-xl font-semibold">问 AI</h1>
            <p className="mt-1 text-sm text-muted">过去的你，帮助现在的你解决问题。</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              className="btn btn-ghost !px-3 !py-1.5 text-[13px]"
              onClick={() => setShowHistory((v) => !v)}
            >
              历史记录
            </button>
            <button
              className="btn btn-gold !px-3 !py-1.5 text-[13px]"
              onClick={newChat}
            >
              新对话
            </button>
          </div>
        </div>

        {/* 历史会话面板 */}
        {showHistory && (
          <div className="mt-3 max-h-64 overflow-y-auto rounded-2xl border border-ink/8 bg-surface p-2">
            {sessions.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">还没有历史对话</p>
            ) : (
              sessions.map((s) => (
                <div
                  key={s.id}
                  onClick={() => loadSession(s.id)}
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2.5 transition hover:bg-ink/5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] text-ink">{s.title}</p>
                    <p className="mt-0.5 text-[11px] text-faint">
                      {formatTime(s.updatedAt)} · {s.count} 条消息
                    </p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteSession(s.id)
                    }}
                    className="shrink-0 rounded-md px-2 py-1 text-[11px] text-muted transition hover:text-danger"
                  >
                    删除
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </header>

      {/* 消息区 */}
      <div className="flex-1 space-y-5 overflow-y-auto pr-1">
        {messages.length === 0 && !loading && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <p className="text-[15px] text-muted">把问题交给你的私人知识教练</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {SAMPLES.map((s) => (
                <button
                  key={s}
                  onClick={() => setInput(s)}
                  className="rounded-full border border-ink/12 px-4 py-2 text-[13px] text-muted transition hover:border-gold/40 hover:text-gold"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <MessageRow
            key={m.id}
            msg={m}
            copied={copiedId === m.id}
            onCopy={() => copy(m)}
            onRemove={() => remove(m.id)}
          />
        ))}

        {loading && (
          <div className="flex items-end gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gold/12 text-[13px]">
              ✦
            </div>
            <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md border border-ink/8 bg-surface px-4 py-3">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold" />
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold [animation-delay:300ms]" />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* 输入区 */}
      <div className="mt-4">
        {error && <p className="mb-2 text-sm text-danger">{error}</p>}
        <div className="flex items-end gap-2 rounded-2xl border border-ink/12 bg-surface p-2">
          <AutoTextarea
            className="min-h-[44px] flex-1 resize-none bg-transparent px-3 py-2 text-[15px] text-ink outline-none placeholder:text-faint"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            placeholder="问一个和你知识库相关的问题…"
            maxRows={6}
          />
          <button
            className="btn btn-primary shrink-0 !px-4 !py-2.5"
            onClick={send}
            disabled={loading || !input.trim()}
          >
            {loading ? '思考中' : '发送'}
          </button>
        </div>
        <p className="mt-2 text-center text-[11px] text-faint">Enter 发送 · Shift+Enter 换行</p>
      </div>
    </div>
  )
}

function MessageRow({
  msg,
  copied,
  onCopy,
  onRemove,
}: {
  msg: Msg
  copied: boolean
  onCopy: () => void
  onRemove: () => void
}) {
  const isUser = msg.role === 'user'
  return (
    <div className={`group flex items-start gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] ${
          isUser ? 'bg-gold/15 text-gold' : 'bg-gold/12 text-gold'
        }`}
      >
        {isUser ? '我' : '✦'}
      </div>

      <div className={`flex max-w-[85%] flex-col ${isUser ? 'items-end' : 'items-start'}`}>
        <div
          className={`relative rounded-2xl px-4 py-3 ${
            isUser
              ? 'rounded-br-md bg-gold/15 text-ink'
              : 'rounded-bl-md border border-ink/8 bg-surface'
          }`}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{msg.content}</p>
          ) : (
            <Markdown content={msg.content} />
          )}
        </div>

        {/* 涉及的知识 */}
        {!isUser && msg.related && msg.related.length > 0 && (
          <div className="mt-2 w-full space-y-1.5">
            {msg.related.map((k) => (
              <Link
                key={k.id}
                href={`/knowledge/${k.id}`}
                className="block rounded-xl border border-ink/8 bg-surface/60 px-3 py-2 transition hover:border-gold/40"
              >
                <p className="truncate text-[13px] font-medium text-gold">{k.title}</p>
                <p className="mt-0.5 line-clamp-1 text-[12px] text-muted">{k.coreConclusion}</p>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* 操作按钮：hover 显示 */}
      <div
        className={`flex shrink-0 gap-1 self-center opacity-0 transition group-hover:opacity-100 ${
          isUser ? 'order-first' : ''
        }`}
      >
        <button
          onClick={onCopy}
          className="rounded-md px-1.5 py-0.5 text-[11px] text-muted transition hover:text-gold"
        >
          {copied ? '已复制' : '复制'}
        </button>
        <button
          onClick={onRemove}
          className="rounded-md px-1.5 py-0.5 text-[11px] text-muted transition hover:text-danger"
        >
          删除
        </button>
      </div>
    </div>
  )
}
