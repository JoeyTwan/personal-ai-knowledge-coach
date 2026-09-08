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

  async function load(q?: string, catId?: string | null) {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (q) params.set('search', q)
      if (catId) params.set('categoryId', catId)
      const qs = params.toString()
      setItems(await apiGet<any[]>(qs ? `/api/knowledge?${qs}` : '/api/knowledge'))
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    apiGet<CategoryNode[]>('/api/categories').then(setCategories).catch(() => {})
  }, [])

  function selectCat(id: string | null) {
    setActiveCat(id)
    load(search, id)
  }

  function doSearch() {
    load(search, activeCat)
  }

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

      {/* 搜索 */}
      <div className="flex gap-2">
        <input
          className="input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && doSearch()}
          placeholder="搜索标题、结论、标签…"
        />
        <button className="btn btn-ghost shrink-0" onClick={doSearch}>
          搜索
        </button>
      </div>

      <div className="md:grid md:grid-cols-[200px_1fr] md:gap-6">
        {/* 分类树侧边栏 */}
        <aside className="md:sticky md:top-20 md:self-start">
          <div className="card p-3">
            <button
              onClick={() => selectCat(null)}
              className={`block w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] transition ${
                activeCat === null ? 'bg-gold/15 font-medium text-gold' : 'text-muted hover:text-ink'
              }`}
            >
              全部知识
            </button>
            {categories.map((c) => (
              <CategoryBranch key={c.id} node={c} active={activeCat} onSelect={selectCat} depth={0} />
            ))}
            {categories.length === 0 && (
              <p className="px-2.5 py-2 text-[12px] text-muted">暂无分类</p>
            )}
          </div>
        </aside>

        {/* 知识列表 */}
        <div className="space-y-3">
          {error && <p className="text-sm text-danger">{error}</p>}
          {loading && <p className="text-sm text-muted">加载中…</p>}

          {!loading &&
            items.map((k) => (
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
          {!loading && items.length === 0 && !error && (
            <div className="card py-10 text-center text-sm text-muted">
              还没有知识，去「记录」一点新东西吧。
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
      <div className="flex items-center" style={{ paddingLeft: depth * 12 }}>
        {hasChildren ? (
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex h-6 w-4 items-center justify-center text-[10px] text-muted hover:text-ink"
            aria-label={open ? '收起' : '展开'}
          >
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="w-4" />
        )}
        <button
          onClick={() => onSelect(node.id)}
          className={`flex flex-1 items-center justify-between rounded-lg px-2 py-1.5 text-left text-[13px] transition ${
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
