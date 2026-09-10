'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { apiGet } from '@/lib/api'
import Danmaku from '@/components/Danmaku'

export default function HomePage() {
  const [knowledges, setKnowledges] = useState<any[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiGet<any[]>('/api/knowledge?status=active')
      .then(setKnowledges)
      .catch(() => setError('后端服务未启动，请先在项目根目录运行 npm run dev:backend'))
      .finally(() => setLoading(false))
  }, [])

  const recent = knowledges.slice(0, 3)

  const stats = useMemo(() => {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    return {
      total: knowledges.length,
      thisWeek: knowledges.filter((k) => new Date(k.createdAt).getTime() >= weekAgo).length,
      tested: knowledges.filter((k) => (k.state?.reviewCount ?? 0) > 0).length,
    }
  }, [knowledges])

  return (
    <div className="space-y-7">
      <section className="pt-2">
        <h1 className="h-serif mb-4 text-xl font-semibold sm:text-2xl">你学过的，正在飘着</h1>
        <Danmaku />
      </section>

      {error && (
        <div className="card border-gold/40">
          <p className="text-sm text-muted">{error}</p>
        </div>
      )}

      {!loading && !error && (
        <>
          <section className="flex flex-col gap-3 sm:flex-row">
            <Link href="/ask" className="btn btn-primary sm:flex-1">
              问 AI
            </Link>
            <Link href="/record" className="btn btn-ghost sm:flex-1">
              记录新知识
            </Link>
          </section>

          <section>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="h-serif text-[15px] font-semibold">最近新增</h2>
              <Link href="/knowledge" className="text-[13px] text-muted transition-colors hover:text-ink">
                全部知识
              </Link>
            </div>
            {recent.length > 0 ? (
              <div className="space-y-2">
                {recent.map((k) => (
                  <Link
                    key={k.id}
                    href={`/knowledge/${k.id}`}
                    className="card block transition hover:border-gold/40"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[15px] font-medium">{k.title}</p>
                        <p className="mt-1 line-clamp-2 text-[13px] text-muted">{k.coreConclusion}</p>
                      </div>
                      <span className="shrink-0 rounded-full bg-gold/15 px-2 py-0.5 text-[11px] text-gold">
                        {k.type}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="card text-center">
                <p className="text-[14px] text-muted">还没有知识，先去记录第一条吧</p>
              </div>
            )}
          </section>

          <section>
            <div className="grid grid-cols-3 gap-3">
              <Stat label="累计知识" value={stats.total} />
              <Stat label="本周新增" value={stats.thisWeek} />
              <Stat label="自测过" value={stats.tested} />
            </div>
            <p className="mt-3 text-center text-[12px] text-faint">
              想检验掌握程度时，可以去
              <Link href="/review" className="ml-1 text-muted underline underline-offset-2 hover:text-ink">
                自测一下
              </Link>
            </p>
          </section>
        </>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="card text-center">
      <p className="text-xl font-medium">{value}</p>
      <p className="mt-1 text-[12px] text-muted">{label}</p>
    </div>
  )
}
