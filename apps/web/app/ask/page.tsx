'use client'

import { useState } from 'react'
import Link from 'next/link'
import { apiPost } from '@/lib/api'

export default function AskPage() {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [related, setRelated] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function ask() {
    if (!question.trim() || loading) return
    setLoading(true)
    setError('')
    setAnswer('')
    setRelated([])
    try {
      const res = await apiPost<{ answer: string; related: any[] }>('/api/ask', { question })
      setAnswer(res.answer)
      setRelated(res.related ?? [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="h-serif text-xl font-semibold">问 AI</h1>
        <p className="mt-1 text-sm text-muted">过去的知识，帮助你解决现在的问题。</p>
      </header>

      <div className="flex items-end gap-2">
        <textarea
          className="input min-h-[52px] resize-none"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              ask()
            }
          }}
          placeholder="例如：客户需要一个 AI 服务器整机集成方案，我以前记录过合适的公司吗？"
          rows={2}
        />
        <button className="btn btn-primary shrink-0" onClick={ask} disabled={loading}>
          {loading ? '思考中' : '提问'}
        </button>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {answer && (
        <section className="card">
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{answer}</p>
        </section>
      )}

      {related.length > 0 && (
        <section>
          <h2 className="mb-2 text-[13px] text-muted">涉及的知识</h2>
          <div className="space-y-2">
            {related.map((k) => (
              <Link key={k.id} href={`/knowledge/${k.id}`} className="card block py-3 transition hover:border-gold/40">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-medium">{k.title}</p>
                    <p className="mt-0.5 line-clamp-1 text-[12px] text-muted">{k.coreConclusion}</p>
                  </div>
                  <span className="shrink-0 text-[12px] text-muted">
                    {new Date(k.createdAt).toLocaleDateString('zh-CN')}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
