'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { apiGet } from '@/lib/api'

export default function HomePage() {
  const [knowledges, setKnowledges] = useState<any[]>([])
  const [plan, setPlan] = useState<any[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([apiGet<any[]>('/api/knowledge?status=active'), apiGet<any[]>('/api/review/plan')])
      .then(([k, p]) => {
        setKnowledges(k)
        setPlan(p)
      })
      .catch(() => setError('后端服务未启动，请先在项目根目录运行 npm run dev:backend'))
      .finally(() => setLoading(false))
  }, [])

  const recent = knowledges.slice(0, 5)

  return (
    <div className="space-y-8">
      {/* 顶部：自然语言入口 */}
      <section className="pt-6">
        <h1 className="h-serif text-2xl font-semibold leading-snug sm:text-3xl">
          今天想学什么，
          <br />
          或者有什么问题？
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">
          这是你的私人 AI 知识教练。它记录你学到的东西，帮你建立关联，检测你是否真的掌握，并在未来调用过去的知识。
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Link href="/record" className="btn btn-primary">
            记录新知识
          </Link>
          <Link href="/ask" className="btn btn-ghost">
            问 AI
          </Link>
          <Link href="/review" className="btn btn-gold">
            开始复习
          </Link>
        </div>
      </section>

      {error && (
        <div className="card border-gold/40">
          <p className="text-sm text-muted">{error}</p>
        </div>
      )}

      {!loading && !error && (
        <>
          {/* 今日知识状态 */}
          <section>
            <h2 className="h-serif mb-4 text-lg font-semibold">知识状态</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Stat label="累计知识" value={String(knowledges.length)} />
              <Stat label="待巩固" value={String(plan.length)} />
              <Stat label="本周复习" value={String(plan.filter((p) => p.reviewCount === 0).length)} />
            </div>

            {recent.length > 0 && (
              <div className="mt-5">
                <h3 className="mb-2 text-[13px] text-muted">最近新增</h3>
                <div className="space-y-2">
                  {recent.map((k) => (
                    <Link
                      key={k.id}
                      href={`/knowledge/${k.id}`}
                      className="card block transition hover:border-gold/40"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[15px] font-medium">{k.title}</p>
                          <p className="mt-1 line-clamp-2 text-[13px] text-muted">{k.coreConclusion}</p>
                        </div>
                        <span className="shrink-0 rounded-full bg-gold/15 px-2 py-0.5 text-[11px]">{k.type}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* 复习卡片 */}
          <section>
            <Link href="/review" className="card block transition hover:border-gold/40">
              <h2 className="h-serif text-lg font-semibold">今日 / 本周复习</h2>
              <p className="mt-2 text-sm text-muted">
                {plan.length > 0
                  ? `为你准备了 ${plan.length} 个待巩固的知识，预计 10 分钟。`
                  : '暂时没有待复习的知识，先去记录一点新东西吧。'}
              </p>
              <span className="mt-3 inline-block rounded-full bg-ink px-4 py-1.5 text-[13px] text-paper">
                开始复习 →
              </span>
            </Link>
          </section>
        </>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <p className="text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-[13px] text-muted">{label}</p>
    </div>
  )
}
