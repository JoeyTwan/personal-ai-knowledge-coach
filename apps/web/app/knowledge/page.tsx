'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { apiGet, apiPost, apiDelete } from '@/lib/api'

interface CategoryNode {
  id: string
  name: string
  count: number
  children: CategoryNode[]
}

interface ConfirmState {
  title: string
  desc: string
  confirmText?: string
  onConfirm: () => Promise<void> | void
}

export default function KnowledgeListPage() {
  const [items, setItems] = useState<any[]>([])
  const [categories, setCategories] = useState<CategoryNode[]>([])
  const [search, setSearch] = useState('')
  const [activeCat, setActiveCat] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)

  async function loadCategories() {
    try {
      setCategories(await apiGet<CategoryNode[]>('/api/categories'))
    } catch {
      // 分类树加载失败不阻塞列表
    }
  }

  useEffect(() => {
    loadCategories()
  }, [tick])

  // 实时搜索：输入停顿 250ms 自动查询；切换分类立即生效
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
        if (!cancelled) {
          setItems(data)
          // 清掉已不存在的选中项
          setSelected((prev) => new Set([...prev].filter((id) => data.some((k: any) => k.id === id))))
        }
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
  }, [search, activeCat, tick])

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allSelected = items.length > 0 && items.every((k) => selected.has(k.id))
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(items.map((k) => k.id)))
  }

  // 删除单条
  function askDeleteOne(k: any) {
    setConfirm({
      title: `删除《${k.title}》？`,
      desc: '这条知识及其掌握记录、版本、关联都会被永久删除，无法恢复。',
      onConfirm: async () => {
        setBusy(true)
        try {
          await apiDelete(`/api/knowledge/${k.id}`)
          setConfirm(null)
          setTick((t) => t + 1)
        } finally {
          setBusy(false)
        }
      },
    })
  }

  // 批量删除
  function askDeleteSelected() {
    const chosen = items.filter((k) => selected.has(k.id))
    if (chosen.length === 0) return
    setConfirm({
      title: `删除选中的 ${chosen.length} 条知识？`,
      desc: `以下知识会被永久删除，无法恢复：\n${chosen.map((k) => `· ${k.title}`).join('\n')}`,
      onConfirm: async () => {
        setBusy(true)
        try {
          await apiPost('/api/knowledge/batch-delete', { ids: chosen.map((k) => k.id) })
          setSelected(new Set())
          setConfirm(null)
          setTick((t) => t + 1)
        } finally {
          setBusy(false)
        }
      },
    })
  }

  // 删除整个分类（连同其下全部子孙分类的知识）
  function askDeleteCategory(node: CategoryNode) {
    setConfirm({
      title: `删除分类「${node.name}」？`,
      desc: `该分类及其所有子分类下的知识会被一并永久删除，共 ${node.count} 条，无法恢复。`,
      onConfirm: async () => {
        setBusy(true)
        try {
          await apiDelete(`/api/categories/${node.id}`)
          if (activeCat === node.id) setActiveCat(null)
          setSelected(new Set())
          setConfirm(null)
          setTick((t) => t + 1)
        } finally {
          setBusy(false)
        }
      },
    })
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
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        ) : (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted opacity-40">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
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
              <CategoryBranch
                key={c.id}
                node={c}
                active={activeCat}
                onSelect={setActiveCat}
                onDelete={askDeleteCategory}
                depth={0}
              />
            ))}
            {categories.length === 0 && <p className="px-2.5 py-2 text-[12px] text-muted">暂无分类</p>}
          </div>
        </aside>

        {/* 知识列表 */}
        <div className="space-y-3">
          {error && <p className="text-sm text-danger">{error}</p>}

          {/* 多选操作条 */}
          {selected.size > 0 && (
            <div className="sticky top-16 z-10 flex items-center justify-between gap-2 rounded-xl border border-gold/30 bg-surface/95 px-3.5 py-2.5 backdrop-blur">
              <span className="text-[13px]">
                已选 <span className="font-medium text-gold">{selected.size}</span> 条
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={toggleAll}
                  className="rounded-lg px-2.5 py-1.5 text-[12px] text-muted transition hover:bg-gold/10 hover:text-gold"
                >
                  {allSelected ? '取消全选' : '全选'}
                </button>
                <button
                  onClick={() => setSelected(new Set())}
                  className="rounded-lg px-2.5 py-1.5 text-[12px] text-muted transition hover:bg-gold/10 hover:text-gold"
                >
                  取消
                </button>
                <button
                  onClick={askDeleteSelected}
                  className="rounded-lg bg-danger/15 px-3 py-1.5 text-[12px] font-medium text-danger transition hover:bg-danger/25"
                >
                  删除选中
                </button>
              </div>
            </div>
          )}

          {items.map((k) => (
            <div key={k.id} className="card group flex items-start gap-3 transition hover:border-gold/40">
              <input
                type="checkbox"
                checked={selected.has(k.id)}
                onChange={() => toggleOne(k.id)}
                className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-gold"
                aria-label={`选择《${k.title}》`}
              />
              <Link href={`/knowledge/${k.id}`} className="min-w-0 flex-1">
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
              <button
                onClick={() => askDeleteOne(k)}
                className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted opacity-0 transition group-hover:opacity-100 hover:bg-danger/15 hover:text-danger focus:opacity-100"
                aria-label={`删除《${k.title}》`}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18" />
                  <path d="M8 6V4h8v2" />
                  <path d="M19 6l-1 14H6L5 6" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
              </button>
            </div>
          ))}

          {loading && items.length === 0 && <p className="text-sm text-muted">加载中…</p>}

          {!loading && items.length === 0 && !error && (
            <div className="card py-10 text-center text-sm text-muted">
              {search.trim() ? `没有找到与「${search.trim()}」相关的知识。` : '这个分类下还没有知识。'}
            </div>
          )}
        </div>
      </div>

      {confirm && (
        <ConfirmModal
          title={confirm.title}
          desc={confirm.desc}
          busy={busy}
          onCancel={() => !busy && setConfirm(null)}
          onConfirm={confirm.onConfirm}
        />
      )}
    </div>
  )
}

function CategoryBranch({
  node,
  active,
  onSelect,
  onDelete,
  depth,
}: {
  node: CategoryNode
  active: string | null
  onSelect: (id: string) => void
  onDelete: (node: CategoryNode) => void
  depth: number
}) {
  const [open, setOpen] = useState(true)
  const hasChildren = node.children.length > 0
  const isActive = active === node.id

  return (
    <div>
      <div className="group/cat flex items-center gap-0.5" style={{ paddingLeft: depth * 14 }}>
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
        <button
          onClick={() => onDelete(node)}
          className="mr-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted opacity-0 transition group-hover/cat:opacity-100 hover:bg-danger/15 hover:text-danger focus:opacity-100"
          aria-label={`删除分类「${node.name}」`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18" />
            <path d="M8 6V4h8v2" />
            <path d="M19 6l-1 14H6L5 6" />
          </svg>
        </button>
      </div>
      {hasChildren &&
        open &&
        node.children.map((c) => (
          <CategoryBranch key={c.id} node={c} active={active} onSelect={onSelect} onDelete={onDelete} depth={depth + 1} />
        ))}
    </div>
  )
}

function ConfirmModal({
  title,
  desc,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string
  desc: string
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-ink/10 bg-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[15px] font-semibold">{title}</h3>
        <p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-line text-[13px] leading-relaxed text-muted">
          {desc}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} disabled={busy} className="btn btn-ghost disabled:opacity-50">
            取消
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="rounded-lg bg-danger px-4 py-2 text-[13px] font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {busy ? '删除中…' : '确认删除'}
          </button>
        </div>
      </div>
    </div>
  )
}
