'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiGet, apiPost, apiPatch } from '@/lib/api'

// ===== 类型 =====

interface LearningStyle {
  strengths?: string
  forgetting?: string
  frequentErrors?: string
  goodQuestionTypes?: string[]
  goodReviewMethods?: string[]
  easyRelations?: string
}

interface Cognition {
  header?: { title: string; subtitle: string }
  aiSummary: { text: string | null; evidence: string | null; updatedAt: string | null }
  identity: {
    occupation: string | null
    workDomain: string | null
    scenario: string[]
    stage: string | null
    focus: string | null
    cognitiveTraits: string | null
  }
  aspiration: {
    growthGoals: string[]
    longTermGoals: string[]
    desiredAbilities: string[]
    aiGrowthDirection: string | null
  }
  map: {
    areas: {
      name: string
      parent: string | null
      knowledgeCount: number
      relationCount: number
      density: number
      recentAdded: number
      gapCount: number
      verdict: string
      verdictWhy: string | null
    }[]
    knowledgeTotal: number
    relationTotal: number
  }
  mastery: {
    knowledgeId: string
    title: string
    area: string | null
    understanding: string
    recall: string
    association: string
    application: string
    understandingValue: number
    recallValue: number
    associationValue: number
    applicationValue: number
    forgetRisk: number
    reviewCount: number
    average: number
  }[]
  blindspots: {
    id: string
    what: string
    whyWorth: string | null
    targetDepth: string | null
    area: string | null
    recommended: boolean
    from: string | null
    to: string | null
  }[]
  learningStyle: LearningStyle | null
  depthPreferences: { area: string; depth: string; reason?: string; corrected?: boolean }[]
  growth: { events: { period: string; event: string }[]; summary: string | null }
  meta: { insightUpdatedAt: string | null; stale: boolean; refreshing: boolean }
}

// ===== 小组件 =====

function Section({ index, title, hint, children }: { index: string; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-2.5">
        <span className="text-[11px] tabular-nums text-faint">{index}</span>
        <h2 className="h-serif text-[17px] font-semibold tracking-tight">{title}</h2>
      </div>
      {hint && <p className="-mt-1 text-[12px] leading-relaxed text-faint">{hint}</p>}
      {children}
    </section>
  )
}

function VerdictBadge({ verdict }: { verdict: string }) {
  const tone =
    verdict.includes('体系')
      ? 'bg-success/12 text-success'
      : verdict.includes('成长')
        ? 'bg-gold/12 text-gold'
        : 'bg-ink/6 text-muted'
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${tone}`}>{verdict}</span>
}

function LevelDot({ level, value }: { level: string; value: number }) {
  const color = level === '高' ? 'bg-success' : level === '中' ? 'bg-gold' : 'bg-danger'
  return (
    <span className="flex w-full items-center gap-2.5">
      <span className="relative h-[4px] flex-1 overflow-hidden rounded-full bg-ink/15">
        <span className={`absolute inset-y-0 left-0 rounded-full ${color}`} style={{ width: `${Math.max(6, value)}%` }} />
      </span>
      <span className="w-4 shrink-0 text-right text-[11px] text-muted">{level}</span>
    </span>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-ink/12 px-5 py-6 text-center text-[13px] leading-relaxed text-muted">
      {children}
    </div>
  )
}

// AI 判断 + 纠正入口
function Judgment({
  text,
  type,
  evidence,
  onCorrected,
  size = 'sm',
}: {
  text: string | null
  type: string
  evidence?: string | null
  onCorrected: (c: Cognition) => void
  size?: 'sm' | 'lg'
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  if (!text) return null

  async function submit() {
    if (!draft.trim()) return
    setBusy(true)
    try {
      const next = await apiPost<Cognition>('/api/cognition/correct', { type, corrected: draft.trim() })
      onCorrected(next)
      setOpen(false)
      setDraft('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <p className={size === 'lg' ? 'text-[15px] leading-[1.9]' : 'text-[13.5px] leading-relaxed'}>{text}</p>
      {evidence && <p className="mt-1.5 text-[11.5px] text-faint">依据：{evidence}</p>}
      {!open ? (
        <button className="mt-2 text-[11.5px] text-faint transition-colors hover:text-gold" onClick={() => setOpen(true)}>
          这不准确
        </button>
      ) : (
        <div className="mt-2 space-y-2">
          <textarea
            className="input min-h-[64px] resize-y text-[13px]"
            placeholder="写下正确的说法，AI 下次会照着改"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="flex gap-2">
            <button className="btn btn-gold !px-3 !py-1.5 !text-[12px]" onClick={submit} disabled={busy}>
              {busy ? '提交中' : '提交'}
            </button>
            <button className="btn btn-ghost !px-3 !py-1.5 !text-[12px]" onClick={() => setOpen(false)}>
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ===== 页面 =====

export default function CognitionPage() {
  const [data, setData] = useState<Cognition | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [rebuild, setRebuild] = useState<{ running: boolean; done: number; total: number } | null>(null)
  const pollRef = useRef<number | null>(null)

  const load = useCallback(async () => {
    try {
      const c = await apiGet<Cognition>('/api/cognition')
      setData(c)
      setLoading(false)
      // 缓存优先渲染，数据过期时在后台静默重算
      if (c.meta.stale && !c.meta.refreshing) {
        setRefreshing(true)
        try {
          setData(await apiPost<Cognition>('/api/cognition/refresh'))
        } catch {
          /* 后台刷新失败不影响已渲染内容 */
        } finally {
          setRefreshing(false)
        }
      }
    } catch (e: any) {
      setError(e.message)
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current)
    }
  }, [load])

  async function reunderstand() {
    setRefreshing(true)
    setError('')
    try {
      setData(await apiPost<Cognition>('/api/cognition/refresh'))
    } catch (e: any) {
      setError(e.message)
    } finally {
      setRefreshing(false)
    }
  }

  async function discoverGaps() {
    setRefreshing(true)
    setError('')
    try {
      await apiPost('/api/gaps/discover')
      setData(await apiGet<Cognition>('/api/cognition'))
    } catch (e: any) {
      setError(e.message)
    } finally {
      setRefreshing(false)
    }
  }

  function watchRebuild() {
    if (pollRef.current) window.clearInterval(pollRef.current)
    pollRef.current = window.setInterval(async () => {
      try {
        const s = await apiGet<{ running: boolean; done: number; total: number } | null>('/api/relations/rebuild/status')
        setRebuild(s)
        if (!s?.running) {
          if (pollRef.current) window.clearInterval(pollRef.current)
          pollRef.current = null
          setData(await apiGet<Cognition>('/api/cognition'))
        }
      } catch {
        /* 轮询失败忽略 */
      }
    }, 1500)
  }

  async function rebuildRelations() {
    setError('')
    try {
      const s = await apiPost<{ running: boolean; done: number; total: number }>('/api/relations/rebuild')
      setRebuild(s)
      watchRebuild()
    } catch (e: any) {
      setError(e.message)
    }
  }

  async function saveGoals(field: 'growthGoals' | 'longTermGoals' | 'desiredAbilities', value: string) {
    const items = value
      .split(/[\n,，、]/)
      .map((s) => s.trim())
      .filter(Boolean)
    const next = await apiPatch<Cognition>('/api/cognition/goals', { [field]: items })
    setData(next)
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-7 w-32" />
        <div className="skeleton h-28 w-full" />
        <div className="skeleton h-40 w-full" />
      </div>
    )
  }

  if (error && !data) return <p className="text-sm text-danger">{error}</p>
  if (!data) return null

  const { identity, aspiration, map, mastery, blindspots, learningStyle, depthPreferences, growth, meta } = data
  const hasAnything = data.aiSummary.text || map.knowledgeTotal > 0
  const firstRun = refreshing && !data.aiSummary.text

  const identityRows: { label: string; value: string | null }[] = [
    { label: '职业', value: identity.occupation },
    { label: '工作领域', value: identity.workDomain },
    { label: '当前场景', value: identity.scenario.join('、') || null },
    { label: '当前阶段', value: identity.stage },
    { label: '主要关注', value: identity.focus },
  ]

  const lastUnderstood = meta.insightUpdatedAt
    ? new Date(meta.insightUpdatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div className="space-y-10 pb-4">
      {/* 页头 */}
      <header>
        <h1 className="h-serif text-[26px] font-semibold tracking-tight">我的认知</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">{data.header?.subtitle ?? 'AI 正在逐渐理解你是怎样的人、怎样学习，以及下一步什么最值得你成长。'}</p>
        <div className="mt-3 flex items-center gap-3 text-[11.5px] text-faint">
          {refreshing ? (
            <span className="flex items-center gap-1.5 text-gold">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold" />
              AI 正在重新理解你
            </span>
          ) : (
            lastUnderstood && <span>上次理解：{lastUnderstood}</span>
          )}
          <button className="transition-colors hover:text-gold" onClick={reunderstand} disabled={refreshing}>
            重新理解我
          </button>
        </div>
      </header>

      {error && <p className="text-[13px] text-danger">{error}</p>}

      {firstRun && (
        <div className="rounded-2xl border border-ink/8 bg-surface px-5 py-6">
          <p className="text-[13.5px] text-muted">AI 正在读你的知识和学习记录，第一次需要十几秒。</p>
          <div className="mt-4 space-y-2">
            <div className="skeleton h-4 w-4/5" />
            <div className="skeleton h-4 w-3/5" />
          </div>
        </div>
      )}

      {/* ===== 一、我是谁 ===== */}
      <Section index="01" title="AI 眼中的我" hint="基于你的知识、提问、答题与学习记录生成，会随使用不断更新。">
        {data.aiSummary.text ? (
          <div className="card">
            <Judgment
              text={data.aiSummary.text}
              type="ai_summary"
              evidence={data.aiSummary.evidence}
              onCorrected={setData}
              size="lg"
            />
          </div>
        ) : (
          !firstRun && (
            <Empty>
              还没有足够的数据让我说出点什么。
              <br />
              先去记录几条知识，或者点上面的「重新理解我」。
            </Empty>
          )
        )}
      </Section>

      <Section index="02" title="我是谁">
        <div className="card">
          <div className="space-y-2.5">
            {identityRows.map((r) => (
              <div key={r.label} className="flex justify-between gap-4 text-[13.5px]">
                <span className="shrink-0 text-muted">{r.label}</span>
                <span className="text-right">{r.value || <span className="text-faint">还不清楚</span>}</span>
              </div>
            ))}
          </div>
          {identity.cognitiveTraits && (
            <>
              <div className="hairline my-4" />
              <p className="mb-1.5 text-[11.5px] text-faint">认知特点</p>
              <Judgment text={identity.cognitiveTraits} type="cognitive_trait" onCorrected={setData} />
            </>
          )}
        </div>
      </Section>

      <Section index="03" title="我想成为怎样的人" hint="目标写在这里，AI 会照着它判断什么值得你学。点任意一项可以直接改。">
        <div className="card space-y-4">
          <GoalField
            label="当前成长目标"
            items={aspiration.growthGoals}
            onSave={(v) => saveGoals('growthGoals', v)}
          />
          <GoalField
            label="长期成长方向"
            items={aspiration.longTermGoals}
            onSave={(v) => saveGoals('longTermGoals', v)}
          />
          <GoalField
            label="希望获得的能力"
            items={aspiration.desiredAbilities}
            onSave={(v) => saveGoals('desiredAbilities', v)}
          />
          {aspiration.aiGrowthDirection && (
            <>
              <div className="hairline" />
              <div>
                <p className="mb-1.5 text-[11.5px] text-faint">AI 理解的成长方向</p>
                <Judgment text={aspiration.aiGrowthDirection} type="growth_direction" onCorrected={setData} />
              </div>
            </>
          )}
        </div>
      </Section>

      {/* ===== 二、我现在在哪 ===== */}
      <Section
        index="04"
        title="我的知识版图"
        hint="按领域看你的知识分布：有多少条、彼此连得紧不紧、最近在不在长。"
      >
        {map.areas.length === 0 ? (
          <Empty>知识库还是空的。记录几条知识，版图才会长出来。</Empty>
        ) : (
          <div className="space-y-2.5">
            <div className="flex gap-3 px-1 text-[11.5px] text-faint">
              <span>共 {map.knowledgeTotal} 条知识</span>
              <span>·</span>
              <span>{map.relationTotal} 条关联</span>
            </div>
            {map.areas.map((a) => (
              <div key={a.name} className="card !p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-medium">{a.name}</p>
                    {a.parent && <p className="mt-0.5 text-[11.5px] text-faint">属{a.parent}</p>}
                  </div>
                  <VerdictBadge verdict={a.verdict} />
                </div>
                {a.verdictWhy && <p className="mt-2 text-[12.5px] leading-relaxed text-muted">{a.verdictWhy}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted">
                  <span>知识 {a.knowledgeCount}</span>
                  <span>关联 {a.relationCount}</span>
                  <span>近 30 天 +{a.recentAdded}</span>
                  {a.gapCount > 0 && <span className="text-gold">断层 {a.gapCount}</span>}
                </div>
                <div className="mt-2.5 h-[3px] w-full overflow-hidden rounded-full bg-ink/8">
                  <div
                    className="h-full rounded-full bg-gold/70"
                    style={{ width: `${Math.min(100, Math.max(3, a.density * 50))}%` }}
                  />
                </div>
              </div>
            ))}
            <div className="pt-1">
              {rebuild?.running ? (
                <p className="text-[12px] text-gold">
                  AI 正在梳理知识之间的关系 {rebuild.done} / {rebuild.total}
                </p>
              ) : (
                <button className="text-[12px] text-faint transition-colors hover:text-gold" onClick={rebuildRelations}>
                  让 AI 重新梳理知识之间的关系
                </button>
              )}
              {rebuild && !rebuild.running && rebuild.total > 0 && (
                <p className="mt-1 text-[11.5px] text-faint">上次梳理完成，共处理 {rebuild.total} 条。</p>
              )}
            </div>
          </div>
        )}
      </Section>

      <Section
        index="05"
        title="我的掌握状态"
        hint="来自你的自测和问答行为。理解、回忆、关联、应用分别代表不同的深度。"
      >
        {mastery.length === 0 ? (
          <Empty>还没有自测记录。去「自测一下」答几题，这里才会反映真实掌握情况。</Empty>
        ) : (
          <div className="space-y-2.5">
            {mastery.map((m) => (
              <div key={m.knowledgeId} className="card !p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[14px] font-medium leading-snug">{m.title}</p>
                  <span className="shrink-0 text-[11.5px] tabular-nums text-muted">{Math.round(m.average * 100)}%</span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2.5">
                  <MasterRow label="理解" level={m.understanding} value={m.understandingValue} />
                  <MasterRow label="回忆" level={m.recall} value={m.recallValue} />
                  <MasterRow label="关联" level={m.association} value={m.associationValue} />
                  <MasterRow label="应用" level={m.application} value={m.applicationValue} />
                </div>
                {(m.reviewCount > 0 || m.forgetRisk >= 0.4) && (
                  <p className="mt-3 text-[11.5px] text-faint">
                    自测 {m.reviewCount} 次
                    {m.forgetRisk >= 0.4 && <span className="ml-2 text-danger">遗忘风险偏高</span>}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section index="06" title="AI 发现的知识盲区" hint="AI 认为值得你关注的缺口，以及每个缺口你应该学到什么程度。">
        {blindspots.length === 0 ? (
          <Empty>
            暂时没有发现断层。
            <br />
            等知识多一些，或者点下面的按钮让我重新找一遍。
          </Empty>
        ) : (
          <div className="space-y-2.5">
            {blindspots.map((b) => (
              <div key={b.id} className="card !p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[14px] font-medium leading-snug">{b.what}</p>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${
                      b.recommended ? 'bg-gold/12 text-gold' : 'bg-ink/6 text-muted'
                    }`}
                  >
                    {b.recommended ? '值得学' : '可不学'}
                  </span>
                </div>
                {b.whyWorth && (
                  <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
                    <span className="text-faint">为什么值得学　</span>
                    {b.whyWorth}
                  </p>
                )}
                <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
                  {b.area && <span className="text-faint">领域 {b.area}</span>}
                  {b.targetDepth && <span className="text-gold">学到 {b.targetDepth} 即可</span>}
                  {b.from && b.to && <span className="text-faint">连接「{b.from}」与「{b.to}」</span>}
                </div>
              </div>
            ))}
          </div>
        )}
        <button className="text-[12px] text-faint transition-colors hover:text-gold" onClick={discoverGaps} disabled={refreshing}>
          {refreshing ? '正在重新寻找' : '让 AI 重新找我缺什么'}
        </button>
      </Section>

      {/* ===== 三、我怎么学 ===== */}
      <Section index="07" title="我的学习方式" hint="AI 从你的作答行为里推断出来的，会用于决定怎么给你出题和安排复习。">
        {learningStyle ? (
          <div className="card space-y-3.5">
            <StyleRow label="擅长怎样学习" value={learningStyle.strengths} />
            <StyleRow label="容易忘记" value={learningStyle.forgetting} />
            <StyleRow label="经常出错在" value={learningStyle.frequentErrors} />
            <StyleRow label="更适合的题型" value={learningStyle.goodQuestionTypes?.join('、')} />
            <StyleRow label="更适合的复习方式" value={learningStyle.goodReviewMethods?.join('、')} />
            <StyleRow label="容易形成的关系" value={learningStyle.easyRelations} />
          </div>
        ) : (
          <Empty>多做几次自测，我才能看出你是怎么学的。</Empty>
        )}
      </Section>

      <Section index="08" title="我的知识深度偏好" hint="知识体系完整，不等于你必须掌握所有知识。这里说明每个领域你该学到什么程度。">
        {depthPreferences.length === 0 ? (
          <Empty>还没有判断出来。等知识和目标记录多一些。</Empty>
        ) : (
          <div className="card divide-y divide-ink/8">
            {depthPreferences.map((d) => (
              <div key={d.area} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[13.5px] font-medium">{d.area}</span>
                  <span className="shrink-0 rounded-full bg-gold/12 px-2 py-0.5 text-[11px] text-gold">{d.depth}</span>
                </div>
                {d.reason && <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{d.reason}</p>}
                <div className="mt-1">
                  <JudgmentCell type={`depth_preference:${d.area}`} onCorrected={setData} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section index="09" title="我的成长轨迹">
        {growth.events.length === 0 ? (
          <Empty>用得还不够久，轨迹还只有个开头。三个月后再来看这一段。</Empty>
        ) : (
          <div className="card">
            {growth.summary && (
              <p className="mb-4 text-[13.5px] leading-relaxed">{growth.summary}</p>
            )}
            <div className="space-y-0">
              {growth.events.map((e, i) => (
                <div key={`${e.period}-${i}`} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${i === 0 ? 'bg-gold' : 'bg-ink/25'}`} />
                    {i < growth.events.length - 1 && <span className="w-px flex-1 bg-ink/12" />}
                  </div>
                  <div className="pb-5">
                    <p className="text-[11.5px] tabular-nums text-faint">{e.period}</p>
                    <p className="mt-1 text-[13.5px] leading-relaxed">{e.event}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>

      {!hasAnything && !firstRun && (
        <p className="pt-2 text-center text-[12.5px] leading-relaxed text-faint">
          这个页面会随着你的使用慢慢变厚。现在它还很薄，是正常的。
        </p>
      )}
    </div>
  )
}

// ===== 局部组件 =====

function MasterRow({ label, level, value }: { label: string; level: string; value: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-8 shrink-0 text-[12px] text-muted">{label}</span>
      <LevelDot level={level} value={value} />
    </div>
  )
}

function StyleRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div>
      <p className="mb-1 text-[11.5px] text-faint">{label}</p>
      <p className="text-[13.5px] leading-relaxed">{value}</p>
    </div>
  )
}

function JudgmentCell({ type, onCorrected }: { type: string; onCorrected: (c: Cognition) => void }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  if (done) return <p className="text-[11.5px] text-gold">已按你的说法更新</p>

  if (!open)
    return (
      <button className="text-[11.5px] text-faint transition-colors hover:text-gold" onClick={() => setOpen(true)}>
        这个深度不对
      </button>
    )

  return (
    <div className="mt-2 space-y-2">
      <input
        className="input !py-2 text-[13px]"
        placeholder="你希望学到什么程度？"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="flex gap-2">
        <button
          className="btn btn-gold !px-3 !py-1.5 !text-[12px]"
          disabled={busy}
          onClick={async () => {
            if (!draft.trim()) return
            setBusy(true)
            try {
              onCorrected(await apiPost<Cognition>('/api/cognition/correct', { type, corrected: draft.trim() }))
              setDone(true)
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? '提交中' : '提交'}
        </button>
        <button className="btn btn-ghost !px-3 !py-1.5 !text-[12px]" onClick={() => setOpen(false)}>
          取消
        </button>
      </div>
    </div>
  )
}

function GoalField({ label, items, onSave }: { label: string; items: string[]; onSave: (v: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(items.join('\n'))
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      await onSave(draft)
      setEditing(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-[11.5px] text-faint">{label}</p>
        {!editing && (
          <button
            className="text-[11.5px] text-faint transition-colors hover:text-gold"
            onClick={() => {
              setDraft(items.join('\n'))
              setEditing(true)
            }}
          >
            修改
          </button>
        )}
      </div>
      {editing ? (
        <div className="mt-2 space-y-2">
          <textarea
            className="input min-h-[72px] resize-y text-[13px]"
            placeholder="一行写一条"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="flex gap-2">
            <button className="btn btn-gold !px-3 !py-1.5 !text-[12px]" onClick={save} disabled={busy}>
              {busy ? '保存中' : '保存'}
            </button>
            <button className="btn btn-ghost !px-3 !py-1.5 !text-[12px]" onClick={() => setEditing(false)}>
              取消
            </button>
          </div>
        </div>
      ) : items.length > 0 ? (
        <ul className="mt-1.5 space-y-1">
          {items.map((it) => (
            <li key={it} className="flex gap-2 text-[13.5px] leading-relaxed">
              <span className="text-gold">·</span>
              <span>{it}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1.5 text-[13px] text-faint">还没写。点「修改」写一句，AI 会照着它判断。</p>
      )}
    </div>
  )
}
