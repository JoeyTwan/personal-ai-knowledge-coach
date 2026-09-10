'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { apiGet } from '@/lib/api'

interface CategoryNode {
  id: string
  name: string
  count: number
  children: CategoryNode[]
}

export default function KnowledgeListPage() {
  const [items, setItems] = useState<any[]>([])
  const [categories, setCategories] = useState<CategoryNode[]>([])
  const [search, setSearch] = useState('')
  const [activeCat, setActiveCat] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // 分类树只加载一次
  useEffect(() => {
    apiGet<CategoryNode[]>('/api/categories').then(setCategories).catch(() => {})
  }, [])

  // 实时搜索：输入停顿 250ms 自动查询；切换分类也走这里
  useEffect(() => {
    let cancelled = false
    const keyword = search.trim()
    const timer = setTimeout(async () => {
      setLoading(true)
      setError('')
      try {
        const params = new URLSearchParams()
        if (keyword) params.set('search', keyword)
        if (activeCat) params.set('categoryId', activeCat)
        const qs = params.toString()
        const data = await apiGet<any[]>(qs ? `/api/knowledge?${qs}` : '/api/knowledge')
        if (!cancelled) setItems(data)
      } catch (e: any) {
        if (!cancelled) setError(e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [search, activeCat])

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

      {/* 搜索：边打字边出结果 */}
      <div className="relative">
        <input
          className="input pr-10"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索标题、结论、解释、示例、标签…"
        />
        {search ? (
          <button
            onClick={() => setSearch('')}
            className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted transition hover:bg-gold/15 hover:text-gold"
            aria-label="清空搜索"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        ) : (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted opacity-40">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </span>
        )}
      </div>

      <div className="md:grid md:grid-cols-[220px_1fr] md:gap-6">
        {/* 分类树侧边栏 */}
        <aside className="md:sticky md:top-20 md:self-start">
          <div className="card p-2.5">
            <button
              onClick={() => setActiveCat(null)}
              className={`block w-full rounded-lg px-2.5 py-2 text-left text-[13px] transition ${
                activeCat === null ? 'bg-gold/15 font-medium text-gold' : 'text-muted hover:text-ink'
              }`}
            >
              全部知识
            </button>
            {categories.map((c) => (
              <CategoryBranch key={c.id} node={c} active={activeCat} onSelect={setActiveCat} depth={0} />
            ))}
            {categories.length === 0 && (
              <p className="px-2.5 py-2 text-[12px] text-muted">暂无分类</p>
            )}
          </div>
        </aside>

        {/* 知识列表 */}
        <div className="space-y-3">
          {error && <p className="text-sm text-danger">{error}</p>}

          {items.map((k) => (
            <Link
              key={k.id}
              href={`/knowledge/${k.id}`}
              className="card block transition hover:border-gold/40"
            >
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

          {loading && items.length === 0 && <p className="text-sm text-muted">加载中…</p>}

          {!loading && items.length === 0 && !error && (
            <div className="card py-10 text-center text-sm text-muted">
              {search.trim() ? `没有找到与「${search.trim()}」相关的知识。` : '这个分类下还没有知识。'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function CategoryBranch({
  node,
  active,
  onSelect,
  depth,
}: {
  node: CategoryNode
  active: string | null
  onSelect: (id: string) => void
  depth: number
}) {
  const [open, setOpen] = useState(true)
  const hasChildren = node.children.length > 0
  const isActive = active === node.id

  return (
    <div>
      <div className="flex items-center gap-0.5" style={{ paddingLeft: depth * 14 }}>
        {hasChildren ? (
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-gold/15 hover:text-gold"
            aria-label={open ? '收起' : '展开'}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        ) : (
          <span className="w-8 shrink-0" />
        )}
        <button
          onClick={() => onSelect(node.id)}
          className={`flex min-w-0 flex-1 items-center justify-between rounded-lg px-2.5 py-2 text-left text-[13px] transition ${
            isActive ? 'bg-gold/15 font-medium text-gold' : 'text-muted hover:text-ink'
          }`}
        >
          <span className="truncate">{node.name}</span>
          <span className="ml-2 shrink-0 text-[11px] opacity-60">{node.count}</span>
        </button>
      </div>
      {hasChildren &&
        open &&
        node.children.map((c) => (
          <CategoryBranch key={c.id} node={c} active={active} onSelect={onSelect} depth={depth + 1} />
        ))}
    </div>
  )
}
