'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { apiGet, apiPost, apiDelete, API_BASE } from '@/lib/api'

export default function KnowledgeDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string
  const [k, setK] = useState<any>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiGet<any>(`/api/knowledge/${id}`)
      .then(setK)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  async function setStatus(status: string) {
    try {
      await apiPost(`/api/knowledge/${id}/status`, { status })
      const updated = await apiGet<any>(`/api/knowledge/${id}`)
      setK(updated)
    } catch (e: any) {
      alert(e.message)
    }
  }

  async function remove() {
    if (!confirm('确定删除这条知识？此操作不可撤销。')) return
    try {
      await apiDelete(`/api/knowledge/${id}`)
      router.push('/knowledge')
    } catch (e: any) {
      alert(e.message)
    }
  }

  async function exportMd() {
    try {
      const res = await fetch(`${API_BASE}/api/knowledge/${id}/export`)
      const text = await res.text()
      const blob = new Blob([text], { type: 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${k.title}.md`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      alert(e.message)
    }
  }

  if (loading) return <p className="text-sm text-muted">加载中…</p>
  if (error) return <p className="text-sm text-red-500">{error}</p>
  if (!k) return <p className="text-sm text-muted">知识不存在</p>

  const relations = [
    ...(k.relationsFrom ?? []).map((r: any) => ({ type: r.type, other: r.to, dir: 'out' })),
    ...(k.relationsTo ?? []).map((r: any) => ({ type: r.type, other: r.from, dir: 'in' })),
  ]
  const state = k.states?.[0]

  const typeLabels: Record<string, string> = {
    related: '相关',
    prerequisite: '前置',
    hyponym: '下位',
    hypernym: '上位',
    causal: '因果',
    contrast: '对比',
    application: '应用',
    conflict: '冲突',
    evolution: '演化',
    bridge: '桥梁',
  }

  return (
    <div className="space-y-6">
      <header>
        <div className="flex items-center gap-2 text-[12px] text-muted">
          <Link href="/knowledge">知识库</Link>
          <span>/</span>
          <span>{k.type}</span>
        </div>
        <h1 className="h-serif mt-2 text-2xl font-semibold leading-snug">{k.title}</h1>
        <p className="mt-1 text-[13px] text-muted">
          首次记录 {new Date(k.createdAt).toLocaleDateString('zh-CN')} · 最近更新{' '}
          {new Date(k.updatedAt).toLocaleDateString('zh-CN')}
          {k.isOutdated ? ' · 已过时' : ''}
        </p>
      </header>

      {/* 核心结论 */}
      <section className="card">
        <h2 className="text-[13px] font-medium text-gold">核心结论</h2>
        <p className="mt-2 text-[16px] leading-relaxed">{k.coreConclusion}</p>
        {k.briefExplanation && <p className="mt-2 text-[14px] text-muted">{k.briefExplanation}</p>}
      </section>

      {/* 详细解释 */}
      {k.detailExplanation && (
        <section>
          <h2 className="mb-2 text-[15px] font-semibold">详细解释</h2>
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink/85">{k.detailExplanation}</p>
        </section>
      )}

      {k.example && (
        <section>
          <h2 className="mb-2 text-[15px] font-semibold">示例</h2>
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink/85">{k.example}</p>
        </section>
      )}

      {/* 来源 */}
      {k.sources?.length > 0 && (
        <section>
          <h2 className="mb-2 text-[15px] font-semibold">来源</h2>
          <div className="flex flex-wrap gap-2">
            {k.sources.map((s: any, i: number) => (
              <span key={i} className="rounded-full bg-mist px-3 py-1 text-[12px]">
                {s.type}
                {s.occurredAt ? ` · ${new Date(s.occurredAt).toLocaleDateString('zh-CN')}` : ''}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* 标签 */}
      {k.tags?.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {k.tags.map((t: any) => (
            <span key={t.id ?? t.name} className="rounded-full bg-gold/15 px-2.5 py-0.5 text-[12px]">
              #{t.name}
            </span>
          ))}
        </div>
      )}

      {/* 相关知识 */}
      {relations.length > 0 && (
        <section>
          <h2 className="mb-2 text-[15px] font-semibold">相关知识</h2>
          <div className="space-y-2">
            {relations.map((r: any, i: number) => (
              <Link
                key={i}
                href={`/knowledge/${r.other.id}`}
                className="card flex items-center justify-between gap-3 py-3 transition hover:border-gold/40"
              >
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-medium">{r.other.title}</p>
                  <p className="mt-0.5 line-clamp-1 text-[12px] text-muted">{r.other.coreConclusion}</p>
                </div>
                <span className="shrink-0 rounded-full bg-gold/15 px-2 py-0.5 text-[11px]">
                  {typeLabels[r.type] ?? r.type}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 当前掌握 */}
      {state && (
        <section>
          <h2 className="mb-2 text-[15px] font-semibold">当前掌握</h2>
          <div className="grid grid-cols-3 gap-2">
            <Meter label="回忆" value={state.recall} />
            <Meter label="理解" value={state.understanding} />
            <Meter label="应用" value={state.application} />
            <Meter label="关联" value={state.association} />
            <Meter label="稳定" value={state.stability} />
            <Meter label="认知" value={state.awareness} />
          </div>
        </section>
      )}

      {/* 操作 */}
      <section className="flex flex-wrap gap-2 border-t border-ink/10 pt-4">
        <Link href={`/review?knowledgeId=${k.id}`} className="btn btn-gold">
          开始复习
        </Link>
        <button className="btn btn-ghost" onClick={exportMd}>
          导出 Markdown
        </button>
        {k.status === 'active' ? (
          <>
            <button className="btn btn-ghost" onClick={() => setStatus('outdated')}>
              标记过时
            </button>
            <button className="btn btn-ghost" onClick={() => setStatus('archived')}>
              归档
            </button>
          </>
        ) : (
          <button className="btn btn-ghost" onClick={() => setStatus('active')}>
            恢复
          </button>
        )}
        <button className="btn btn-ghost text-red-500" onClick={remove}>
          删除
        </button>
      </section>
    </div>
  )
}

function Meter({ label, value }: { label: string; value: number }) {
  const pct = Math.round((value ?? 0) * 100)
  return (
    <div className="card py-3">
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-muted">{label}</span>
        <span className="text-[13px] font-medium">{pct}%</span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-mist">
        <div className="h-full rounded-full bg-gold" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
