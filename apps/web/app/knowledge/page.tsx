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
  tone?: 'danger' | 'primary'
  onConfirm: () => Promise<void> | void
}

interface MergeGroup {
  knowledgeIds: string[]
  reason: string
  items: Array<{ id: string; title: string; coreConclusion: string }>
}

interface SplitPart {
  title: string
  coreConclusion: string
  briefExplanation?: string
  detailExplanation?: string
  example?: string
  type?: string
  tags?: string[]
}

interface SplitSuggestion {
  knowledgeId: string
  title: string
  reason: string
  parts: SplitPart[]
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
  const [catOpen, setCatOpen] = useState(false)
  const [sug, setSug] = useState<{ merges: MergeGroup[]; splits: SplitSuggestion[] } | null>(null)
  const [orgOpen, setOrgOpen] = useState(false)
  const [orgError, setOrgError] = useState('')

  // 整理建议：合并与拆分都由 AI 先看出来，用户点头才动手
  async function loadSuggestions(refresh = false) {
    setOrgError('')
    try {
      const data = await apiGet<{ merges: MergeGroup[]; splits: SplitSuggestion[] }>(
        `/api/organize/suggestions${refresh ? '?refresh=1' : ''}`,
      )
      setSug(data)
    } catch (e: any) {
      setOrgError(e?.message ?? '整理建议没取到')
    }
  }

  useEffect(() => {
    loadSuggestions()
  }, [])

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

  // 合并：确认后由 AI 融合成一条，原知识归档保留
  function askMerge(group: MergeGroup) {
    setConfirm({
      title: `把这 ${group.items.length} 条合并成一条？`,
      desc: `${group.items.map((i) => `· ${i.title}`).join('\n')}\n\nAI 会把它们融合成一条更完整的知识。原来几条会归档保留，不会丢，只是不再出现在列表里。`,
      confirmText: '合并',
      tone: 'primary',
      onConfirm: async () => {
        setBusy(true)
        try {
          await apiPost('/api/merge', { knowledgeIds: group.knowledgeIds })
          setConfirm(null)
          setTick((t) => t + 1)
          await loadSuggestions(true)
        } finally {
          setBusy(false)
        }
      },
    })
  }

  // 拆分：按用户看过的那份方案落库，原知识归档保留
  function askSplit(s: SplitSuggestion) {
    setConfirm({
      title: `把《${s.title}》拆成 ${s.parts.length} 条？`,
      desc: `拆成：\n${s.parts.map((p) => `· ${p.title}`).join('\n')}\n\n原知识会归档保留，拆出来的每条都继承原来的分类、来源和掌握程度。`,
      confirmText: '拆分',
      tone: 'primary',
      onConfirm: async () => {
        setBusy(true)
        try {
          await apiPost('/api/organize/split', { knowledgeId: s.knowledgeId, parts: s.parts })
          setConfirm(null)
          setTick((t) => t + 1)
          await loadSuggestions(true)
        } finally {
          setBusy(false)
        }
      },
    })
  }

  // 当前选中的分类名（手机端抽屉入口要显示出来）
  const activeCatName = activeCat ? (findCatName(categories, activeCat) ?? '全部知识') : '全部知识'
  // 有建议时在入口上挂一个角标，不点开也知道 AI 有话要说
  const sugTotal = (sug?.merges.length ?? 0) + (sug?.splits.length ?? 0)

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="h-serif text-xl font-semibold">知识库</h1>
          <p className="mt-1 text-sm text-muted">你的结构化知识积累。</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => {
              setOrgOpen(true)
              if (!sug) loadSuggestions()
            }}
            className="btn btn-ghost relative"
          >
            整理
            {sugTotal > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[10px] font-medium text-canvas">
                {sugTotal}
              </span>
            )}
          </button>
          <Link href="/record" className="btn btn-primary">
            记录
          </Link>
        </div>
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

      {/* 手机端：分类改用抽屉，名字再长也看得全 */}
      <button
        onClick={() => setCatOpen(true)}
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-ink/8 bg-surface px-3.5 py-2.5 transition hover:border-ink/20 md:hidden"
      >
        <span className="flex min-w-0 items-center gap-2 text-[13px]">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted">
            <path d="M3.5 7.2A1.7 1.7 0 0 1 5.2 5.5h4l1.8 2.2h7.8a1.7 1.7 0 0 1 1.7 1.7v7.9a1.7 1.7 0 0 1-1.7 1.7H5.2a1.7 1.7 0 0 1-1.7-1.7z" />
          </svg>
          <span className="truncate">{activeCatName}</span>
        </span>
        <span className="shrink-0 text-[12px] text-faint">切换</span>
      </button>

      <div className="md:grid md:grid-cols-[240px_1fr] md:gap-6">
        {/* 桌面端：分类树常驻侧栏 */}
        <aside className="hidden md:sticky md:top-20 md:block md:self-start">
          <div className="card p-2.5">
            <CategoryTree
              categories={categories}
              active={activeCat}
              onSelect={setActiveCat}
              onDelete={askDeleteCategory}
            />
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
                className={`mt-1 h-4 w-4 shrink-0 cursor-pointer accent-gold transition-opacity duration-200 ${
                  selected.has(k.id) ? 'opacity-100' : 'opacity-25 group-hover:opacity-90 hover:opacity-100 focus:opacity-100'
                }`}
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

      {/* 整理建议面板：合并与拆分都等用户点头 */}
      {orgOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 px-4 py-10 backdrop-blur-sm"
          onClick={() => setOrgOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-ink/10 bg-surface p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-[15px] font-semibold">整理建议</h3>
                <p className="mt-1 text-[12px] text-muted">AI 把你的知识过了一遍，下面是它觉得该动的地方。你点了才会改。</p>
              </div>
              <button
                onClick={() => setOrgOpen(false)}
                className="shrink-0 rounded-full px-3 py-1 text-[13px] text-muted transition hover:bg-ink/5 hover:text-ink"
              >
                收起
              </button>
            </div>

            {orgError && <p className="mt-4 text-[13px] text-danger">{orgError}</p>}

            {!sug && !orgError && (
              <div className="mt-6 flex items-center gap-2.5 text-[13px] text-muted">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border border-ink/20 border-t-gold" />
                正在把你的知识过一遍，这一步要花点时间…
              </div>
            )}

            {sug && sugTotal === 0 && (
              <div className="mt-6 space-y-3">
                <p className="text-[13px] text-muted">现在没有要整理的地方。</p>
                <button
                  onClick={() => {
                    setSug(null)
                    loadSuggestions(true)
                  }}
                  className="rounded-lg border border-ink/12 px-3 py-1.5 text-[12px] text-muted transition hover:border-ink/25 hover:text-ink"
                >
                  重新检查一遍
                </button>
              </div>
            )}

            {sug && sug.merges.length > 0 && (
              <section className="mt-5">
                <h4 className="text-[11px] tracking-wide text-faint">可以合并</h4>
                <div className="mt-2 space-y-2">
                  {sug.merges.map((g, i) => (
                    <div key={i} className="rounded-xl border border-ink/8 bg-surface2/50 p-3">
                      <p className="text-[13px] font-medium leading-snug">
                        {g.items.map((it) => `《${it.title}》`).join('  +  ')}
                      </p>
                      {g.reason && <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{g.reason}</p>}
                      <button
                        onClick={() => askMerge(g)}
                        className="mt-2.5 rounded-lg bg-gold/15 px-3 py-1.5 text-[12px] font-medium text-gold transition hover:bg-gold/25"
                      >
                        合并成一条
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {sug && sug.splits.length > 0 && (
              <section className="mt-5">
                <h4 className="text-[11px] tracking-wide text-faint">建议拆开</h4>
                <div className="mt-2 space-y-2">
                  {sug.splits.map((s) => (
                    <div key={s.knowledgeId} className="rounded-xl border border-ink/8 bg-surface2/50 p-3">
                      <p className="text-[13px] font-medium leading-snug">《{s.title}》</p>
                      {s.reason && <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{s.reason}</p>}
                      <ul className="mt-2 space-y-1">
                        {s.parts.map((p, j) => (
                          <li key={j} className="text-[12px] text-muted">
                            · {p.title}
                          </li>
                        ))}
                      </ul>
                      <button
                        onClick={() => askSplit(s)}
                        className="mt-2.5 rounded-lg bg-gold/15 px-3 py-1.5 text-[12px] font-medium text-gold transition hover:bg-gold/25"
                      >
                        拆成 {s.parts.length} 条
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      )}

      {/* 手机端分类抽屉：选定后自动收起 */}
      {catOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/55 backdrop-blur-sm md:hidden"
          onClick={() => setCatOpen(false)}
        >
          <div
            className="max-h-[74vh] w-full overflow-y-auto rounded-t-2xl border-t border-ink/10 bg-surface p-4 pb-[calc(1.1rem+env(safe-area-inset-bottom))] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-[15px] font-semibold">按分类浏览</h3>
              <button
                onClick={() => setCatOpen(false)}
                className="rounded-full px-3 py-1 text-[13px] text-muted transition hover:bg-ink/5 hover:text-ink"
              >
                收起
              </button>
            </div>
            <CategoryTree
              categories={categories}
              active={activeCat}
              onSelect={(id) => {
                setActiveCat(id)
                setCatOpen(false)
              }}
              onDelete={askDeleteCategory}
            />
          </div>
        </div>
      )}

      {confirm && (
        <ConfirmModal
          title={confirm.title}
          desc={confirm.desc}
          busy={busy}
          confirmText={confirm.confirmText}
          tone={confirm.tone}
          onCancel={() => !busy && setConfirm(null)}
          onConfirm={confirm.onConfirm}
        />
      )}
    </div>
  )
}

// 在分类树里按 id 找名字
function findCatName(nodes: CategoryNode[], id: string): string | null {
  for (const n of nodes) {
    if (n.id === id) return n.name
    const hit = findCatName(n.children, id)
    if (hit) return hit
  }
  return null
}

// 分类树本体：桌面侧栏与手机抽屉共用同一个，改一处两边都生效
function CategoryTree({
  categories,
  active,
  onSelect,
  onDelete,
}: {
  categories: CategoryNode[]
  active: string | null
  onSelect: (id: string | null) => void
  onDelete: (node: CategoryNode) => void
}) {
  return (
    <>
      <button
        onClick={() => onSelect(null)}
        className={`block w-full rounded-lg px-2.5 py-2 text-left text-[13px] transition ${
          active === null ? 'bg-gold/15 font-medium text-gold' : 'text-muted hover:text-ink'
        }`}
      >
        全部知识
      </button>
      {categories.map((c) => (
        <CategoryBranch key={c.id} node={c} active={active} onSelect={onSelect} onDelete={onDelete} depth={0} />
      ))}
      {categories.length === 0 && <p className="px-2.5 py-2 text-[12px] text-muted">暂无分类</p>}
    </>
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
  onSelect: (id: string | null) => void
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
          <span className="min-w-0 break-all leading-snug">{node.name}</span>
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
  confirmText = '确认删除',
  tone = 'danger',
  onCancel,
  onConfirm,
}: {
  title: string
  desc: string
  busy: boolean
  confirmText?: string
  tone?: 'danger' | 'primary'
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
            className={`rounded-lg px-4 py-2 text-[13px] font-medium transition hover:opacity-90 disabled:opacity-50 ${
              tone === 'danger' ? 'bg-danger text-white' : 'bg-gold text-canvas'
            }`}
          >
            {busy ? '处理中…' : confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
