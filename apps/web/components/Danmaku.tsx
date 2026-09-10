'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { apiGet } from '@/lib/api'

interface DanmakuItem {
  id: string
  knowledgeId: string
  text: string
  weak: boolean
}

interface Flying extends DanmakuItem {
  key: string
  track: number
  duration: number
}

// 弹幕基础速度：每秒移动多少像素。正常速度下约 75px/s，读中文刚好不赶。
const BASE_SPEED = 75
const TRACK_HEIGHT = 34
const MAX_TRACKS = 6
const MAX_ON_SCREEN = 16
// 估算一条弹幕的渲染宽度，用于控制同轨道前后两条的间距
const CHAR_WIDTH = 13
const ITEM_PADDING = 26
const TRACK_GAP = 34

function speedLabel(v: number) {
  if (v < 0.85) return '慢'
  if (v <= 1.3) return '正常'
  return '快'
}

export default function Danmaku() {
  const router = useRouter()
  const [items, setItems] = useState<DanmakuItem[]>([])
  const [flying, setFlying] = useState<Flying[]>([])
  const [loading, setLoading] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [paused, setPaused] = useState(false)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [reduceMotion, setReduceMotion] = useState(false)
  const [size, setSize] = useState({ w: 0, h: 0 })

  const boxRef = useRef<HTMLDivElement>(null)
  const queueRef = useRef<DanmakuItem[]>([])
  const cursorRef = useRef(0)
  const trackFreeRef = useRef<number[]>([])
  const seqRef = useRef(0)
  const flyingRef = useRef<Flying[]>([])
  const pausedRef = useRef(false)

  const tracks = Math.min(MAX_TRACKS, Math.max(3, Math.floor((size.h - 10) / TRACK_HEIGHT)))

  // 读取速度偏好与「减少动态效果」设置
  useEffect(() => {
    try {
      const v = Number(localStorage.getItem('danmaku-speed'))
      if (v >= 0.5 && v <= 2.5) setSpeed(v)
    } catch {
      // 隐私模式忽略
    }
    setReduceMotion(window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  }, [])

  useEffect(() => {
    flyingRef.current = flying
  }, [flying])

  useEffect(() => {
    pausedRef.current = paused
  }, [paused])

  // 拉取弹幕池
  useEffect(() => {
    apiGet<{ items: DanmakuItem[] }>('/api/danmaku')
      .then((r) => {
        setItems(r.items ?? [])
        queueRef.current = r.items ?? []
        cursorRef.current = 0
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [])

  // 测量弹幕区尺寸（决定轨道数与飞行距离）
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [loading])

  const changeSpeed = (v: number) => {
    setSpeed(v)
    try {
      localStorage.setItem('danmaku-speed', String(v))
    } catch {
      // 隐私模式忽略
    }
  }

  // 发一条弹幕：挑一条当前空出来的轨道，算好飞行时长
  const emit = useCallback(() => {
    const queue = queueRef.current
    if (queue.length === 0 || size.w === 0) return

    const now = Date.now()
    const free = trackFreeRef.current
    let track = -1
    for (let i = 0; i < tracks; i++) {
      if ((free[i] ?? 0) <= now) {
        track = i
        break
      }
    }
    if (track < 0) return

    const item = queue[cursorRef.current % queue.length]
    cursorRef.current += 1

    const estWidth = item.text.length * CHAR_WIDTH + ITEM_PADDING
    const speedPx = BASE_SPEED * speed
    const duration = (size.w + estWidth) / speedPx
    // 等这一条的尾巴完全进入屏幕，这条轨道才能放下一条
    free[track] = now + ((estWidth + TRACK_GAP) / speedPx) * 1000

    seqRef.current += 1
    const key = `${item.id}#${seqRef.current}`
    setFlying((prev) => [...prev, { ...item, key, track, duration }])
  }, [speed, size.w, tracks])

  const emitRef = useRef(emit)
  useEffect(() => {
    emitRef.current = emit
  }, [emit])

  // 首屏先铺几条，避免打开时空荡
  useEffect(() => {
    if (loading || reduceMotion || size.w === 0 || items.length === 0) return
    let n = 0
    const prefill = Math.min(tracks, 6)
    const id = setInterval(() => {
      emitRef.current()
      n += 1
      if (n >= prefill) clearInterval(id)
    }, 140)
    return () => clearInterval(id)
  }, [loading, reduceMotion, size.w, items.length, tracks])

  // 持续发射
  useEffect(() => {
    if (loading || reduceMotion || items.length === 0) return
    const tick = Math.max(280, 900 / speed)
    const id = setInterval(() => {
      if (pausedRef.current) return
      if (flyingRef.current.length >= MAX_ON_SCREEN) return
      emitRef.current()
    }, tick)
    return () => clearInterval(id)
  }, [loading, reduceMotion, items.length, speed])

  const remove = (key: string) => setFlying((prev) => prev.filter((f) => f.key !== key))

  // 加载中：保持版面高度，避免页面跳动
  if (loading) {
    return (
      <div className="h-[220px] rounded-2xl border border-ink/8 bg-surface sm:h-[248px]">
        <div className="flex h-full items-center justify-center text-[13px] text-faint">正在整理知识流…</div>
      </div>
    )
  }

  // 还没有知识：给一个明确的去处
  if (items.length === 0) {
    return (
      <div className="flex h-[220px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-ink/15 px-6 text-center sm:h-[248px]">
        <p className="text-[15px] text-muted">知识流还空着</p>
        <p className="text-[13px] text-faint">收录第一条知识后，你学过的要点会在这里飘起来</p>
        <Link href="/record" className="btn btn-primary mt-1">
          去记录一条
        </Link>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-[12px] text-faint">
          {reduceMotion ? '你开启了减少动态效果，这里改为静态展示' : '碰到会停下，点开就能回到那条知识'}
        </p>
        <div className="flex shrink-0 items-center gap-3">
          <label className="flex items-center gap-2">
            <span className="text-[12px] text-faint">{speedLabel(speed)}</span>
            <input
              type="range"
              min={0.5}
              max={2.5}
              step={0.25}
              value={speed}
              onChange={(e) => changeSpeed(Number(e.target.value))}
              aria-label="弹幕速度"
              className="h-1 w-20 cursor-pointer appearance-none rounded-full bg-ink/15 accent-gold"
            />
          </label>
          {!reduceMotion && (
            <button
              onClick={() => setPaused((p) => !p)}
              className="rounded-full border border-ink/12 px-2.5 py-1 text-[12px] text-muted transition-colors hover:border-ink/25 hover:text-ink"
            >
              {paused ? '继续' : '暂停'}
            </button>
          )}
        </div>
      </div>

      {reduceMotion ? (
        <div className="flex flex-wrap gap-2 rounded-2xl border border-ink/8 bg-surface p-4">
          {items.slice(0, 12).map((it) => (
            <Link
              key={it.id}
              href={`/knowledge/${it.knowledgeId}`}
              className={`rounded-full border px-3 py-1.5 text-[13px] transition-colors ${
                it.weak ? 'border-gold/40 bg-gold/12 text-gold' : 'border-ink/10 text-muted hover:text-ink'
              }`}
            >
              {it.text}
            </Link>
          ))}
        </div>
      ) : (
        <div
          ref={boxRef}
          className="relative h-[220px] overflow-hidden rounded-2xl border border-ink/8 bg-surface sm:h-[248px]"
        >
          {flying.map((f) => {
            const active = activeKey === f.key
            return (
              <button
                key={f.key}
                onMouseEnter={() => setActiveKey(f.key)}
                onMouseLeave={() => setActiveKey((k) => (k === f.key ? null : k))}
                onTouchStart={() => setActiveKey(f.key)}
                onTouchEnd={() => setActiveKey((k) => (k === f.key ? null : k))}
                onClick={() => router.push(`/knowledge/${f.knowledgeId}`)}
                onAnimationEnd={() => remove(f.key)}
                title="点开这条知识"
                className={`absolute left-full whitespace-nowrap rounded-full border px-3 py-1 text-[13px] transition-colors ${
                  active
                    ? 'border-gold/70 bg-surface2 text-ink'
                    : f.weak
                      ? 'border-gold/30 bg-gold/10 text-gold'
                      : 'border-ink/8 text-muted hover:text-ink'
                }`}
                style={
                  {
                    top: f.track * TRACK_HEIGHT + 9,
                    animationName: 'danmaku-fly',
                    animationDuration: `${f.duration}s`,
                    animationTimingFunction: 'linear',
                    animationFillMode: 'forwards',
                    animationPlayState: paused || active ? 'paused' : 'running',
                    '--travel': `${size.w}px`,
                  } as React.CSSProperties
                }
              >
                {f.text}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
