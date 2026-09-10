import { prisma } from '../lib/prisma'
import { chatJSON } from '../ai/client'
import { cognitionSystem } from '../ai/prompts'
import { getProfileText } from './user.service'
import { enrichGaps } from './profile.service'

// ===== 「我的认知」页面数据中枢 =====
// 原则：能从数据库直接算出来的，绝不调用 AI；只有需要「判断」的部分才交给 AI。
// AI 一次调用产出全部推断，结果缓存，过期后由前端在后台静默刷新。

const STALE_MS = 24 * 60 * 60 * 1000

// ---------- 类型 ----------

interface LearningStyle {
  strengths?: string
  forgetting?: string
  frequentErrors?: string
  goodQuestionTypes?: string[]
  goodReviewMethods?: string[]
  easyRelations?: string
}

interface DepthPreference {
  area: string
  depth: string
  reason?: string
}

interface GrowthEvent {
  period: string
  event: string
}

interface MapVerdict {
  area: string
  verdict: string
  why?: string
}

interface CognitionDraft {
  aiSummary?: string
  cognitiveTraits?: string
  aiGrowthDirection?: string
  identity?: string
  currentStage?: string
  learningStyle?: LearningStyle
  depthPreferences?: DepthPreference[]
  growthHistory?: GrowthEvent[]
  growthSummary?: string
  mapVerdicts?: MapVerdict[]
}

interface AreaStat {
  name: string
  parent?: string
  knowledgeCount: number
  relationCount: number
  density: number
  recentAdded: number
  gapCount: number
  knowledgeIds: string[]
  verdict: string
  verdictWhy?: string
}

// ---------- 小工具 ----------

function parseJSON<T>(v: string | null | undefined, fallback: T): T {
  if (!v) return fallback
  try {
    const parsed = JSON.parse(v)
    return (parsed ?? fallback) as T
  } catch {
    return fallback
  }
}

// 掌握度 → 高 / 中 / 低
function level(v: number): '高' | '中' | '低' {
  if (v >= 0.7) return '高'
  if (v >= 0.35) return '中'
  return '低'
}

const ERROR_TYPE_NAMES: Record<string, string> = {
  forget: '遗忘',
  confusion: '概念混淆',
  missing_relation: '关系没建立',
  missing_prerequisite: '前置知识不足',
  misunderstand: '理解错误',
  misapply: '应用错误',
}

// ---------- 领域统计（本地计算，不花钱）----------

function buildAreas(
  knowledges: {
    id: string
    createdAt: Date
    category: { name: string; parentId: string | null; parent: { name: string } | null } | null
  }[],
  relations: { fromId: string; toId: string }[],
  gaps: { area: string | null }[],
): AreaStat[] {
  const areas = new Map<string, AreaStat>()
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000

  for (const k of knowledges) {
    // 领域取二级分类；没有二级分类的归到一级分类；都没有则归入「待归类」
    const name = k.category?.name ?? '待归类'
    const parent = k.category?.parent?.name
    if (!areas.has(name)) {
      areas.set(name, {
        name,
        parent,
        knowledgeCount: 0,
        relationCount: 0,
        density: 0,
        recentAdded: 0,
        gapCount: 0,
        knowledgeIds: [],
        verdict: '知识比较零散',
      })
    }
    const a = areas.get(name)!
    a.knowledgeCount++
    a.knowledgeIds.push(k.id)
    if (k.createdAt.getTime() >= thirtyDaysAgo) a.recentAdded++
  }

  // 关系密度：两端都落在同一领域内的关系数 / 该领域知识数
  for (const a of areas.values()) {
    const idSet = new Set(a.knowledgeIds)
    a.relationCount = relations.filter((r) => idSet.has(r.fromId) && idSet.has(r.toId)).length
    a.density = a.knowledgeCount > 0 ? Number((a.relationCount / a.knowledgeCount).toFixed(2)) : 0
    a.gapCount = gaps.filter((g) => g.area === a.name).length
    a.verdict = localVerdict(a)
  }

  return Array.from(areas.values()).sort((x, y) => y.knowledgeCount - x.knowledgeCount)
}

// AI 未给出判断时的兜底口径，保证页面永远有东西可看
function localVerdict(a: AreaStat): string {
  if (a.knowledgeCount >= 3 && a.density >= 1) return '已形成体系'
  if (a.recentAdded >= 1 && a.knowledgeCount >= 2) return '正在成长'
  return '知识比较零散'
}

// ---------- 掌握状态 ----------

async function buildMastery(userId: string) {
  const states = await prisma.userKnowledgeState.findMany({
    where: { userId, knowledge: { status: 'active' } },
    include: {
      knowledge: {
        select: { title: true, coreConclusion: true, category: { select: { name: true } } },
      },
    },
  })

  return states
    .map((s) => {
      const avg = (s.understanding + s.recall + s.association + s.application) / 4
      return {
        knowledgeId: s.knowledgeId,
        title: s.knowledge.title,
        conclusion: s.knowledge.coreConclusion,
        area: s.knowledge.category?.name ?? null,
        understanding: level(s.understanding),
        recall: level(s.recall),
        association: level(s.association),
        application: level(s.application),
        understandingValue: Math.round(s.understanding * 100),
        recallValue: Math.round(s.recall * 100),
        associationValue: Math.round(s.association * 100),
        applicationValue: Math.round(s.application * 100),
        forgetRisk: s.forgetRisk ?? 0,
        reviewCount: s.reviewCount,
        lastReviewedAt: s.lastReviewedAt,
        nextReviewAt: s.nextReviewAt,
        average: Number(avg.toFixed(2)),
      }
    })
    .sort((a, b) => a.average - b.average)
}

// ---------- 知识盲区 ----------

async function buildBlindspots(userId: string) {
  const gaps = await prisma.knowledgeGap.findMany({
    where: { userId, status: 'open' },
    orderBy: [{ recommended: 'desc' }, { createdAt: 'desc' }],
    take: 8,
  })
  const titles = await prisma.knowledge.findMany({
    where: { id: { in: gaps.flatMap((g) => [g.fromKnowledgeId, g.toKnowledgeId].filter(Boolean) as string[]) } },
    select: { id: true, title: true },
  })
  const titleMap = new Map(titles.map((t) => [t.id, t.title]))

  return gaps.map((g) => ({
    id: g.id,
    what: g.gapDescription,
    whyWorth: g.reason,
    targetDepth: g.targetDepth,
    area: g.area,
    recommended: g.recommended,
    from: g.fromKnowledgeId ? titleMap.get(g.fromKnowledgeId) ?? null : null,
    to: g.toKnowledgeId ? titleMap.get(g.toKnowledgeId) ?? null : null,
  }))
}

// ---------- AI 判断与用户纠正 ----------

async function upsertInsight(
  userId: string,
  type: string,
  content: string,
  evidence?: string,
  confidence?: number,
) {
  const existing = await prisma.aiInsight.findFirst({ where: { userId, type } })
  if (existing) {
    // 用户已纠正过：保留纠正内容，只记录 AI 的新版本，不覆盖用户的说法
    return prisma.aiInsight.update({
      where: { id: existing.id },
      data: existing.corrected ? { content } : { content, evidence, confidence },
    })
  }
  return prisma.aiInsight.create({ data: { userId, type, content, evidence, confidence } })
}

// 用户纠正 AI 判断
export async function correctInsight(userId: string, type: string, corrected: string) {
  const existing = await prisma.aiInsight.findFirst({ where: { userId, type } })
  if (existing) {
    return prisma.aiInsight.update({
      where: { id: existing.id },
      data: { corrected, correctedAt: new Date(), confirmed: false },
    })
  }
  // 尚无该判断时也允许先记下用户说法，下次生成会遵循
  return prisma.aiInsight.create({
    data: { userId, type, content: '', corrected, correctedAt: new Date() },
  })
}

export async function clearCorrection(userId: string, type: string) {
  const existing = await prisma.aiInsight.findFirst({ where: { userId, type } })
  if (!existing) return null
  return prisma.aiInsight.update({
    where: { id: existing.id },
    data: { corrected: null, correctedAt: null, confirmed: true },
  })
}

// 生成时把用户纠正过的判断回灌进 prompt，避免 AI 重复说错
async function buildCorrectionContext(userId: string): Promise<string> {
  const corrected = await prisma.aiInsight.findMany({
    where: { userId, corrected: { not: null } },
    select: { type: true, corrected: true },
  })
  if (corrected.length === 0) return ''
  return corrected.map((c) => `- ${c.type}：用户纠正为「${c.corrected}」`).join('\n')
}

function correctionOf(insights: { type: string; corrected: string | null }[], type: string): string | null {
  return insights.find((i) => i.type === type)?.corrected ?? null
}

// ---------- 生成认知总览 ----------

const refreshing = new Set<string>()

export function isRefreshing(userId: string) {
  return refreshing.has(userId)
}

export async function refreshCognition(userId: string) {
  if (refreshing.has(userId)) return { skipped: true }
  refreshing.add(userId)
  try {
    const [knowledges, relations, gaps, states, attempts, profileText, correctionContext] = await Promise.all([
      prisma.knowledge.findMany({
        where: { userId, status: 'active' },
        select: {
          id: true,
          title: true,
          coreConclusion: true,
          type: true,
          createdAt: true,
          category: { select: { name: true, parentId: true, parent: { select: { name: true } } } },
          tags: { select: { name: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 200,
      }),
      prisma.knowledgeRelation.findMany({ where: { userId }, select: { fromId: true, toId: true } }),
      prisma.knowledgeGap.findMany({ where: { userId, status: 'open' }, select: { area: true } }),
      prisma.userKnowledgeState.findMany({
        where: { userId, knowledge: { status: 'active' } },
        include: { knowledge: { select: { title: true } } },
      }),
      prisma.questionAttempt.findMany({
        where: { question: { session: { userId } } },
        select: { isCorrect: true, errorType: true, createdAt: true },
      }),
      getProfileText(userId),
      buildCorrectionContext(userId),
    ])

    const areas = buildAreas(knowledges, relations, gaps)

    const knowledgeList =
      knowledges
        .map((k) => {
          const path = k.category ? [k.category.parent?.name, k.category.name].filter(Boolean).join(' > ') : '待归类'
          return `- [${path}] ${k.title}：${k.coreConclusion}（标签：${k.tags.map((t) => t.name).join('、') || '无'}）`
        })
        .join('\n') || '（暂无知识）'

    const areaStats =
      areas
        .map(
          (a) =>
            `- ${a.name}${a.parent ? `（属${a.parent}）` : ''}：知识 ${a.knowledgeCount} 条，领域内关系 ${a.relationCount} 条，关系密度 ${a.density}，近 30 天新增 ${a.recentAdded} 条，断层 ${a.gapCount} 条`,
        )
        .join('\n') || '（暂无领域）'

    const errorCount: Record<string, number> = {}
    let correctCount = 0
    for (const a of attempts) {
      if (a.isCorrect) correctCount++
      if (a.errorType) errorCount[a.errorType] = (errorCount[a.errorType] ?? 0) + 1
    }
    const errorSummary =
      Object.entries(errorCount)
        .map(([k, v]) => `${ERROR_TYPE_NAMES[k] ?? k} ${v} 次`)
        .join('、') || '无'

    const avgOf = (key: 'understanding' | 'recall' | 'association' | 'application') => {
      if (states.length === 0) return 0
      return Number((states.reduce((s, x) => s + x[key], 0) / states.length).toFixed(2))
    }
    const weakList =
      states
        .map((s) => ({
          title: s.knowledge.title,
          avg: (s.understanding + s.recall + s.association + s.application) / 4,
        }))
        .sort((a, b) => a.avg - b.avg)
        .slice(0, 5)
        .map((s) => `${s.title}（${Math.round(s.avg * 100)}%）`)
        .join('、')

    const behaviorSummary = [
      `知识总数：${knowledges.length} 条，覆盖领域：${areas.map((a) => a.name).join('、') || '无'}`,
      `总作答次数：${attempts.length}，答对：${correctCount}`,
      `错误类型分布：${errorSummary}`,
      `各维度平均（0 到 1）：理解 ${avgOf('understanding')}、回忆 ${avgOf('recall')}、关联 ${avgOf('association')}、应用 ${avgOf('application')}`,
      `掌握最弱的几条：${weakList || '暂无'}`,
    ].join('\n')

    // 存量断层缺「学到什么程度 / 所属领域」时顺带补齐，只在缺字段时才真正调用 AI
    await enrichGaps(userId).catch(() => 0)

    const draft = await chatJSON<CognitionDraft>([
      { role: 'system', content: cognitionSystem() },
      {
        role: 'user',
        content: `【用户已有画像】
${profileText || '（暂无）'}

【知识列表】共 ${knowledges.length} 条
${knowledgeList}

【领域统计】
${areaStats}

【学习行为】
${behaviorSummary}
${correctionContext ? `\n【用户纠正过的判断，必须遵循】\n${correctionContext}\n` : ''}
请生成这个用户的认知总览。领域名只能从「${areas.map((a) => a.name).join('、') || '无'}」里选。`,
      },
    ])

    // 持久化：画像主表存 AI 原始产出，AiInsight 表存逐条判断供纠正
    const data: Record<string, unknown> = {
      aiSummary: draft.aiSummary ?? null,
      aiSummaryAt: new Date(),
      insightUpdatedAt: new Date(),
      identity: draft.identity ?? null,
      currentStage: draft.currentStage ?? null,
      aiGrowthDirection: draft.aiGrowthDirection ?? null,
      cognitiveTraits: draft.cognitiveTraits ?? null,
      learningStyle: draft.learningStyle ? JSON.stringify(draft.learningStyle) : null,
      depthPreferences: draft.depthPreferences ? JSON.stringify(draft.depthPreferences) : null,
      growthHistory: draft.growthHistory ? JSON.stringify(draft.growthHistory) : null,
      growthSummary: draft.growthSummary ?? null,
    }

    const existingProfile = await prisma.userProfile.findUnique({ where: { userId } })
    if (existingProfile) {
      await prisma.userProfile.update({ where: { userId }, data: data as never })
    } else {
      await prisma.userProfile.create({ data: { userId, ...data } as never })
    }

    const evidence = `基于 ${knowledges.length} 条知识、${relations.length} 条关系、${attempts.length} 次作答`
    if (draft.aiSummary) await upsertInsight(userId, 'ai_summary', draft.aiSummary, evidence)
    if (draft.cognitiveTraits) await upsertInsight(userId, 'cognitive_trait', draft.cognitiveTraits, evidence)
    if (draft.aiGrowthDirection) await upsertInsight(userId, 'growth_direction', draft.aiGrowthDirection, evidence)
    if (draft.learningStyle) {
      await upsertInsight(userId, 'learning_style', JSON.stringify(draft.learningStyle), evidence)
    }
    for (const v of draft.mapVerdicts ?? []) {
      await upsertInsight(userId, `map_verdict:${v.area}`, v.verdict, v.why)
    }
    for (const d of draft.depthPreferences ?? []) {
      await upsertInsight(userId, `depth_preference:${d.area}`, d.depth, d.reason)
    }

    return { skipped: false, generated: true }
  } finally {
    refreshing.delete(userId)
  }
}

// ---------- 组装页面数据 ----------

export async function getCognition(userId: string) {
  const [profile, knowledges, relations, gaps, insights, mastery, blindspots] = await Promise.all([
    prisma.userProfile.findUnique({ where: { userId } }),
    prisma.knowledge.findMany({
      where: { userId, status: 'active' },
      select: {
        id: true,
        createdAt: true,
        category: { select: { name: true, parentId: true, parent: { select: { name: true } } } },
      },
    }),
    prisma.knowledgeRelation.findMany({ where: { userId }, select: { fromId: true, toId: true } }),
    prisma.knowledgeGap.findMany({ where: { userId, status: 'open' }, select: { area: true } }),
    prisma.aiInsight.findMany({ where: { userId } }),
    buildMastery(userId),
    buildBlindspots(userId),
  ])

  const areas = buildAreas(knowledges, relations, gaps)

  // 用 AI 判断覆盖本地兜底口径；用户纠正过的说法优先于 AI 原话
  const mapAreas = areas.map((a) => {
    const insight = insights.find((i) => i.type === `map_verdict:${a.name}`)
    const corrected = insight?.corrected ?? null
    return {
      name: a.name,
      parent: a.parent ?? null,
      knowledgeCount: a.knowledgeCount,
      relationCount: a.relationCount,
      density: a.density,
      recentAdded: a.recentAdded,
      gapCount: a.gapCount,
      verdict: corrected ?? insight?.content ?? a.verdict,
      verdictWhy: corrected ? null : insight?.evidence ?? null,
    }
  })

  const depthRows: DepthPreference[] = parseJSON<DepthPreference[]>(profile?.depthPreferences, [])
  const depthPreferences = depthRows.map((d) => {
    const corrected = correctionOf(insights, `depth_preference:${d.area}`)
    return { ...d, depth: corrected ?? d.depth, corrected: Boolean(corrected) }
  })

  const learningStyleRaw = parseJSON<LearningStyle | null>(profile?.learningStyle, null)
  const learningStyleCorrected = correctionOf(insights, 'learning_style')
  const learningStyle = learningStyleCorrected
    ? { ...(learningStyleRaw ?? {}), strengths: learningStyleCorrected }
    : learningStyleRaw

  const insightUpdatedAt = profile?.insightUpdatedAt ?? null
  const stale = !insightUpdatedAt || Date.now() - insightUpdatedAt.getTime() > STALE_MS

  return {
    header: {
      title: '我的认知',
      subtitle: 'AI 正在逐渐理解你是怎样的人、怎样学习，以及下一步什么最值得你成长。',
    },
    // 1. AI 眼中的我
    aiSummary: {
      text: correctionOf(insights, 'ai_summary') ?? profile?.aiSummary ?? null,
      evidence: insights.find((i) => i.type === 'ai_summary')?.evidence ?? null,
      updatedAt: profile?.aiSummaryAt ?? null,
    },
    // 2. 我是谁
    identity: {
      occupation: profile?.occupation ?? null,
      workDomain: profile?.workDomain ?? null,
      scenario: parseJSON<string[]>(profile?.commonScenarios, []),
      stage: profile?.currentStage ?? null,
      focus: profile?.currentFocus ?? null,
      cognitiveTraits:
        correctionOf(insights, 'cognitive_trait') ?? profile?.cognitiveTraits ?? null,
    },
    // 3. 我想成为怎样的人
    aspiration: {
      growthGoals: parseJSON<string[]>(profile?.growthGoals, parseJSON<string[]>(profile?.learningGoals, [])),
      longTermGoals: parseJSON<string[]>(profile?.longTermGoals, []),
      desiredAbilities: parseJSON<string[]>(profile?.desiredAbilities, []),
      aiGrowthDirection:
        correctionOf(insights, 'growth_direction') ?? profile?.aiGrowthDirection ?? null,
    },
    // 4. 我的知识版图
    map: {
      areas: mapAreas,
      knowledgeTotal: knowledges.length,
      relationTotal: relations.filter((r) =>
        knowledges.some((k) => k.id === r.fromId) && knowledges.some((k) => k.id === r.toId),
      ).length,
    },
    // 5. 我的掌握状态
    mastery,
    // 6. AI 发现的知识盲区
    blindspots,
    // 7. 我的学习方式
    learningStyle,
    // 8. 我的知识深度偏好
    depthPreferences,
    // 9. 我的成长轨迹
    growth: {
      events: parseJSON<GrowthEvent[]>(profile?.growthHistory, []),
      summary: profile?.growthSummary ?? null,
    },
    meta: {
      insightUpdatedAt,
      stale,
      refreshing: isRefreshing(userId),
      corrections: insights
        .filter((i) => i.corrected)
        .map((i) => ({ type: i.type, corrected: i.corrected, correctedAt: i.correctedAt })),
    },
  }
}
