'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { apiGet } from '@/lib/api'

export default function KnowledgeListPage() {
  const [items, setItems] = useState<any[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load(q?: string) {
    setLoading(true)
    setError('')
    try {
      const url = q ? `/api/knowledge?search=${encodeURIComponent(q)}` : '/api/knowledge'
      setItems(await apiGet<any[]>(url))
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="h-serif text-xl font-semibold">知识库</h1>
          <p className="mt-1 text-sm text-muted">你的结构化知识积累。</p>
        </div>
        <Link href="/record" className="btn btn-primary">
          记录
        </Link>
      </header>

      <div className="flex gap-2">
        <input
          className="input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load(search)}
          placeholder="搜索标题、结论…"
        />
        <button className="btn btn-ghost shrink-0" onClick={() => load(search)}>
          搜索
        </button>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
      {loading && <p className="text-sm text-muted">加载中…</p>}

      <div className="space-y-3">
        {!loading &&
          items.map((k) => (
            <Link key={k.id} href={`/knowledge/${k.id}`} className="card block transition hover:border-gold/40">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[15px] font-medium">{k.title}</p>
                  <p className="mt-1 line-clamp-2 text-[13px] text-muted">{k.coreConclusion}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                    <span className="rounded-full bg-gold/15 px-2 py-0.5">{k.type}</span>
                    {k.category && <span>{k.category}</span>}
                    {k.tags?.slice(0, 3).map((t: string) => (
                      <span key={t}>#{t}</span>
                    ))}
                  </div>
                </div>
                <span className="shrink-0 text-[12px] text-muted">
                  {new Date(k.updatedAt).toLocaleDateString('zh-CN')}
                </span>
              </div>
            </Link>
          ))}
        {!loading && items.length === 0 && !error && (
          <div className="card py-10 text-center text-sm text-muted">
            还没有知识，去「记录」一点新东西吧。
          </div>
        )}
      </div>
    </div>
  )
}
