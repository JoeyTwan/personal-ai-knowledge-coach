'use client'

import { useEffect, useState } from 'react'
import { apiGet, apiPost } from '@/lib/api'

type Step = 'idle' | 'question' | 'feedback' | 'done'

export default function ReviewPage() {
  const [plan, setPlan] = useState<any[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [question, setQuestion] = useState<any>(null)
  const [feedback, setFeedback] = useState<any>(null)
  const [answer, setAnswer] = useState('')
  const [step, setStep] = useState<Step>('idle')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function loadPlan() {
    setLoading(true)
    setError('')
    try {
      setPlan(await apiGet<any[]>('/api/review/plan'))
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    loadPlan()
  }, [])

  async function start() {
    setLoading(true)
    setError('')
    try {
      const res = await apiPost<{ sessionId: string }>('/api/review/session', {})
      setSessionId(res.sessionId)
      await next(res.sessionId)
    } catch (e: any) {
      setError(e.message)
      setLoading(false)
    }
  }

  async function next(sid?: string) {
    const s = sid ?? sessionId
    if (!s) return
    setLoading(true)
    try {
      const q = await apiGet<any>(`/api/review/session/${s}/next`)
      if (q.done) {
        setStep('done')
      } else {
        setQuestion(q)
        setFeedback(null)
        setAnswer('')
        setStep('question')
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function submit() {
    if (!answer.trim() || !question) return
    setLoading(true)
    setError('')
    try {
      const f = await apiPost<any>(`/api/review/question/${question.questionId}/answer`, { answer })
      setFeedback(f)
      setStep('feedback')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="h-serif text-xl font-semibold">复习</h1>
        <p className="mt-1 text-sm text-muted">检测你真正掌握了什么。</p>
      </header>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* 计划 */}
      {step === 'idle' && (
        <div className="space-y-4">
          <div className="card">
            <p className="text-[15px] font-medium">
              {plan.length > 0 ? `为你准备了 ${plan.length} 个待巩固的知识` : '暂无待复习的知识'}
            </p>
            <p className="mt-1 text-[13px] text-muted">
              {plan.length > 0 ? '预计 10 分钟。答题后我会更新你的掌握状态。' : '先去记录一点新东西吧。'}
            </p>
          </div>
          {plan.length > 0 && (
            <>
              <div className="space-y-2">
                {plan.slice(0, 8).map((p) => (
                  <div key={p.knowledgeId} className="card flex items-center justify-between py-3">
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-medium">{p.title}</p>
                      <p className="mt-0.5 text-[12px] text-muted">
                        {p.reviewCount === 0 ? '新收录' : `已复习 ${p.reviewCount} 次`}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <button className="btn btn-primary w-full" onClick={start} disabled={loading}>
                开始复习
              </button>
            </>
          )}
        </div>
      )}

      {/* 题目 */}
      {step === 'question' && question && (
        <div className="card space-y-4">
          <p className="text-[12px] text-muted">
            题型：{question.type} · 难度 {question.difficulty}
          </p>
          <p className="text-[16px] leading-relaxed">{question.prompt}</p>

          {question.options && question.options.length > 0 ? (
            <div className="space-y-2">
              {question.options.map((o: any) => (
                <button
                  key={o.label}
                  className={`w-full rounded-xl border px-4 py-3 text-left text-[14px] transition ${
                    answer === o.text
                      ? 'border-ink bg-ink text-paper'
                      : 'border-ink/15 hover:border-gold/60'
                  }`}
                  onClick={() => setAnswer(o.text)}
                >
                  <span className="mr-2 font-medium">{o.label}.</span>
                  {o.text}
                </button>
              ))}
            </div>
          ) : (
            <textarea
              className="input min-h-[100px]"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="写下你的回答…"
            />
          )}

          <button className="btn btn-primary w-full" onClick={submit} disabled={loading || !answer.trim()}>
            提交答案
          </button>
        </div>
      )}

      {/* 反馈 */}
      {step === 'feedback' && feedback && (
        <div className="card space-y-4">
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full px-3 py-1 text-[13px] font-medium ${
                feedback.isCorrect ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
              }`}
            >
              {feedback.isCorrect ? '回答正确' : '回答有误'}
            </span>
            <span className="text-[13px] text-muted">掌握度 {Math.round((feedback.score ?? 0) * 100)}%</span>
          </div>
          <p className="text-[15px] leading-relaxed">{feedback.feedback}</p>
          <button className="btn btn-primary w-full" onClick={() => next()} disabled={loading}>
            下一题
          </button>
        </div>
      )}

      {/* 完成 */}
      {step === 'done' && (
        <div className="card py-10 text-center">
          <p className="text-lg font-semibold">本轮复习完成</p>
          <p className="mt-2 text-sm text-muted">我已经更新了你的掌握状态，下次复习会自动调整。</p>
          <button className="btn btn-ghost mt-4" onClick={() => setStep('idle')}>
            返回
          </button>
        </div>
      )}
    </div>
  )
}
