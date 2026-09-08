'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { apiGet } from '@/lib/api'

// 力导向图：依赖 canvas/window，禁用 SSR
const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false })

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

export default function GraphPage() {
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [highlightNodes, setHighlightNodes] = useState<Set<string>>(new Set())
  const [highlightLinkKeys, setHighlightLinkKeys] = useState<Set<string>>(new Set())
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [colors, setColors] = useState({
    text: 'rgb(236 230 218)',
    accent: 'rgb(200 163 95)',
    faint: 'rgb(111 104 90)',
  })
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    apiGet<{ nodes: Node[]; edges: Edge[] }>('/api/graph')
      .then((g) => {
        setNodes(g.nodes)
        setEdges(g.edges)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  // 读取主题色，并监听明暗切换
  useEffect(() => {
    const read = () => {
      const cs = getComputedStyle(document.documentElement)
      const rgb = (name: string) => {
        const v = cs.getPropertyValue(name).trim()
        return v ? `rgb(${v})` : ''
      }
      setColors({ text: rgb('--text'), accent: rgb('--accent'), faint: rgb('--text3') })
    }
    read()
    const obs = new MutationObserver(read)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])

  // 测量容器尺寸：依赖 nodes.length，确保容器挂载后再测量；用 ResizeObserver 持续监听
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [nodes.length])

  const graphData = useMemo(
    () => ({ nodes, links: edges.map((e) => ({ ...e })) }),
    [nodes, edges],
  )

  const handleNodeClick = useCallback(
    (node: any) => {
      // 已高亮则取消，否则高亮该节点及其相邻节点
      if (highlightNodes.has(node.id)) {
        setHighlightNodes(new Set())
        setHighlightLinkKeys(new Set())
        setSelectedNode(null)
        return
      }
      const neighbors = new Set<string>([node.id])
      const keys = new Set<string>()
      edges.forEach((e) => {
        if (e.from === node.id || e.to === node.id) {
          neighbors.add(e.from)
          neighbors.add(e.to)
          keys.add(`${e.from}|${e.to}`)
        }
      })
      setHighlightNodes(neighbors)
      setHighlightLinkKeys(keys)
      setSelectedNode(node)
    },
    [highlightNodes, edges],
  )

  const drawNode = useCallback(
    (node: any, ctx: any, globalScale: number) => {
      const isHi = highlightNodes.size === 0 || highlightNodes.has(node.id)
      const r = isHi ? 5 : 3
      ctx.beginPath()
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI)
      ctx.fillStyle = isHi ? colors.accent : colors.faint
      ctx.fill()
      if (isHi) {
        const fontSize = 12 / globalScale
        ctx.font = `${fontSize}px -apple-system, 'PingFang SC', sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillStyle = colors.text
        const label = node.label.length > 12 ? node.label.slice(0, 12) + '…' : node.label
        ctx.fillText(label, node.x, node.y + r + 3)
      }
    },
    [highlightNodes, colors],
  )

  return (
    <div className="space-y-4">
      <header>
        <h1 className="h-serif text-xl font-semibold">知识网络</h1>
        <p className="mt-1 text-sm text-muted">
          点击一个知识点，看它和哪些知识相连；拖拽节点、滚轮缩放。
        </p>
      </header>

      {error && <p className="text-sm text-danger">{error}</p>}
      {loading && <p className="text-sm text-muted">加载中…</p>}

      {!loading && nodes.length === 0 && !error && (
        <div className="card py-10 text-center text-sm text-muted">
          还没有知识，先去「记录」一点，网络会慢慢长出来。
        </div>
      )}

      {nodes.length > 0 && (
        <div ref={containerRef} className="card overflow-hidden p-0" style={{ height: '520px' }}>
          {size.width > 0 && (
            <ForceGraph2D
              graphData={graphData}
              width={size.width}
              height={size.height}
              nodeId="id"
              nodeLabel={(n: any) => `${n.label}${n.summary ? `\n${n.summary}` : ''}`}
              nodeCanvasObject={drawNode}
              nodePointerAreaPaint={(node: any, color: string, ctx: any) => {
                ctx.fillStyle = color
                ctx.beginPath()
                ctx.arc(node.x, node.y, 8, 0, 2 * Math.PI)
                ctx.fill()
              }}
              onNodeClick={handleNodeClick}
              onBackgroundClick={() => {
                setHighlightNodes(new Set())
                setHighlightLinkKeys(new Set())
                setSelectedNode(null)
              }}
              linkSource="from"
              linkTarget="to"
              linkColor={(l: any) => {
                const key = `${l.source?.id}|${l.target?.id}`
                if (highlightLinkKeys.size === 0) return colors.accent
                return highlightLinkKeys.has(key) ? colors.accent : 'rgba(0,0,0,0.06)'
              }}
              linkWidth={(l: any) => {
                const key = `${l.source?.id}|${l.target?.id}`
                return highlightLinkKeys.size === 0 || highlightLinkKeys.has(key) ? 1.3 : 0.5
              }}
              linkLabel={(l: any) => `${typeLabels[l.type] ?? l.type}${l.reason ? `：${l.reason}` : ''}`}
              backgroundColor="rgba(0,0,0,0)"
              cooldownTicks={150}
              enableNodeDrag
              enableZoomInteraction
              enablePanInteraction
            />
          )}
        </div>
      )}

      {/* 选中节点详情 */}
      {selectedNode && (
        <div className="card border-gold/40">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[15px] font-medium">{selectedNode.label}</p>
              {selectedNode.summary && (
                <p className="mt-1 line-clamp-2 text-[13px] text-muted">{selectedNode.summary}</p>
              )}
            </div>
            <Link href={`/knowledge/${selectedNode.id}`} className="btn btn-ghost shrink-0">
              查看详情
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
