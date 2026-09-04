'use client'

import { useEffect, useState } from 'react'
import { apiGet, apiPost } from '@/lib/api'

function parseList(v?: string | null): string[] {
  if (!v) return []
  try {
    const arr = JSON.parse(v)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<any>(null)
  const [recs, setRecs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setError('')
    try {
      const [p, r] = await Promise.all([apiGet<any>('/api/profile'), apiGet<any[]>('/api/recommendations')])
      setProfile(p)
      setRecs(r)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    load()
  }, [])

  async function refresh() {
    setBusy(true)
    setError('')
    try {
      setProfile(await apiPost<any>('/api/profile/refresh', {}))
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function generateRecs() {
    setBusy(true)
    setError('')
    try {
      setRecs(await apiPost<any[]>('/api/recommendations/generate', {}))
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <p className="text-sm text-muted">加载中…</p>

  const rows: { label: string; value?: string | null }[] = [
    { label: '职业', value: profile?.occupation },
    { label: '工作领域', value: profile?.workDomain },
    { label: '当前关注', value: profile?.currentFocus },
    { label: '技术深度', value: profile?.technicalDepth },
    { label: '商业水平', value: profile?.businessLevel },
  ]
  const lists: { label: string; items: string[] }[] = [
    { label: '主要知识领域', items: parseList(profile?.primaryKnowledgeAreas) },
    { label: '兴趣方向', items: parseList(profile?.interests) },
    { label: '学习目标', items: parseList(profile?.learningGoals) },
    { label: '倾向深入的领域', items: parseList(profile?.deepDiveAreas) },
    { label: '只需了解的领域', items: parseList(profile?.shallowAreas) },
  ]

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="h-serif text-xl font-semibold">我的画像</h1>
          <p className="mt-1 text-sm text-muted">随着使用，它会越来越懂你。</p>
        </div>
        <button className="btn btn-ghost" onClick={refresh} disabled={busy}>
          {busy ? '分析中' : '重新推断'}
        </button>
      </header>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {!profile && (
        <div className="card py-10 text-center text-sm text-muted">
          还没有画像。记录一些知识后，点击「重新推断」让我了解你。
        </div>
      )}

      {profile && (
        <>
          <section className="card">
            <h2 className="mb-3 text-[13px] font-medium text-gold">基本情况</h2>
            <div className="space-y-2">
              {rows.map((r) => (
                <div key={r.label} className="flex justify-between gap-4 text-[14px]">
                  <span className="text-muted">{r.label}</span>
                  <span className="text-right">{r.value || '—'}</span>
                </div>
              ))}
            </div>
          </section>

          {lists.some((l) => l.items.length > 0) && (
            <section className="card">
              <h2 className="mb-3 text-[13px] font-medium text-gold">认知偏好</h2>
              <div className="space-y-3">
                {lists.map(
                  (l) =>
                    l.items.length > 0 && (
                      <div key={l.label}>
                        <p className="mb-1 text-[13px] text-muted">{l.label}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {l.items.map((it) => (
                            <span key={it} className="rounded-full bg-mist px-2.5 py-0.5 text-[12px]">
                              {it}
                            </span>
                          ))}
                        </div>
                      </div>
                    ),
                )}
              </div>
            </section>
          )}
        </>
      )}

      {/* 学习推荐 */}
      <section>
        <div className="flex items-center justify-between">
          <h2 className="h-serif text-lg font-semibold">接下来学什么</h2>
          <button className="btn btn-gold" onClick={generateRecs} disabled={busy}>
            {busy ? '生成中' : '生成建议'}
          </button>
        </div>
        <div className="mt-3 space-y-2">
          {recs.map((r) => (
            <div key={r.id} className="card">
              <p className="text-[14px] font-medium">{r.title}</p>
              {r.detail && <p className="mt-1 text-[13px] leading-relaxed text-muted">{r.detail}</p>}
            </div>
          ))}
          {recs.length === 0 && (
            <p className="text-[13px] text-muted">点击「生成建议」，我会基于你的知识和目标给出方向。</p>
          )}
        </div>
      </section>
    </div>
  )
}
