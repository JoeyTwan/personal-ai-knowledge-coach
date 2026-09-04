'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { apiGet } from '@/lib/api'

interface Node {
  id: string
  label: string
  type: string
  summary: string
}
interface Edge {
  from: string
  to: string
  type: string
  reason?: string
}

const W = 760
const H = 560

export default function GraphPage() {
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiGet<{ nodes: Node[]; edges: Edge[] }>('/api/graph')
      .then((g) => {
        setNodes(g.nodes)
        setEdges(g.edges)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  // 圆形布局
  const cx = W / 2
  const cy = H / 2
  const R = Math.min(cx, cy) - 90
  const pos = new Map<string, { x: number; y: number }>()
  nodes.forEach((n, i) => {
    const angle = (i / Math.max(nodes.length, 1)) * 2 * Math.PI - Math.PI / 2
    pos.set(n.id, { x: cx + R * Math.cos(angle), y: cy + R * Math.sin(angle) })
  })

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
    <div className="space-y-4">
      <header>
        <h1 className="h-serif text-xl font-semibold">知识网络</h1>
        <p className="mt-1 text-sm text-muted">你的知识正在形成体系。</p>
      </header>

      {error && <p className="text-sm text-red-500">{error}</p>}
      {loading && <p className="text-sm text-muted">加载中…</p>}

      {!loading && nodes.length === 0 && !error && (
        <div className="card py-10 text-center text-sm text-muted">
          还没有知识，先去「记录」一点，网络会慢慢长出来。
        </div>
      )}

      {nodes.length > 0 && (
        <div className="card overflow-x-auto p-2">
          <svg viewBox={`0 0 ${W} ${H}`} className="min-w-[600px]">
            {/* 边 */}
            {edges.map((e, i) => {
              const a = pos.get(e.from)
              const b = pos.get(e.to)
              if (!a || !b) return null
              const mx = (a.x + b.x) / 2
              const my = (a.y + b.y) / 2
              return (
                <g key={i}>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#c2a36a" strokeOpacity={0.5} strokeWidth={1} />
                  <text x={mx} y={my} fontSize={10} fill="#8a8578" textAnchor="middle">
                    {typeLabels[e.type] ?? e.type}
                  </text>
                </g>
              )
            })}
            {/* 节点 */}
            {nodes.map((n) => {
              const p = pos.get(n.id)!
              return (
                <Link key={n.id} href={`/knowledge/${n.id}`} legacyBehavior>
                  <a>
                    <circle cx={p.x} cy={p.y} r={5} fill="#1b1a18" />
                    <text x={p.x} y={p.y - 12} fontSize={12} fill="#1b1a18" textAnchor="middle">
                      {n.label.length > 10 ? n.label.slice(0, 10) + '…' : n.label}
                    </text>
                  </a>
                </Link>
              )
            })}
          </svg>
        </div>
      )}

      {/* 节点列表（移动端易读） */}
      {nodes.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-[13px] text-muted">全部知识（{nodes.length}）</h2>
          {nodes.map((n) => (
            <Link key={n.id} href={`/knowledge/${n.id}`} className="card block py-3 transition hover:border-gold/40">
              <div className="flex items-center justify-between">
                <span className="text-[14px] font-medium">{n.label}</span>
                <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[11px]">{n.type}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
