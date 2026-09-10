import { prisma } from '../lib/prisma'
import { chatJSON } from '../ai/client'
import { inferProfileSystem, recommendSystem, gapSystem, gapEnrichSystem } from '../ai/prompts'
import { getProfileText } from './user.service'

interface ProfilePatch {
  occupation?: string
  workDomain?: string
  currentFocus?: string
  primaryKnowledgeAreas?: string[]
  commonScenarios?: string[]
  technicalDepth?: string
  businessLevel?: string
  interests?: string[]
  learningGoals?: string[]
  deepDiveAreas?: string[]
  shallowAreas?: string[]
  commonMistakes?: string[]
  weakDirections?: string[]
}

const JSON_FIELDS = [
  'primaryKnowledgeAreas',
  'commonScenarios',
  'interests',
  'learningGoals',
  'deepDiveAreas',
  'shallowAreas',
  'commonMistakes',
  'weakDirections',
]

export async function getProfile(userId: string) {
  return prisma.userProfile.findUnique({ where: { userId } })
}

// 节流刷新：距上次画像刷新超过 1 小时才真正执行，避免每条知识入库都触发一次 LLM 推断
export async function maybeRefreshProfile(userId: string) {
  const existing = await prisma.userProfile.findUnique({ where: { userId } })
  const oneHour = 60 * 60 * 1000
  if (existing && existing.updatedAt && Date.now() - existing.updatedAt.getTime() < oneHour) {
    return existing
  }
  return refreshProfile(userId)
}

// 从知识库内容 + 学习行为推断用户画像
export async function refreshProfile(userId: string) {
  const knowledges = await prisma.knowledge.findMany({
    where: { userId },
    select: { title: true, coreConclusion: true, type: true, tags: { select: { name: true } } },
    orderBy: { updatedAt: 'desc' },
    take: 60,
  })
  const summary = knowledges
    .map((k) => `[${k.type}] ${k.title}：${k.coreConclusion}（标签：${k.tags.map((t) => t.name).join('、')}）`)
    .join('\n')

  // 学习行为数据：答题记录 + 错误类型分布（帮助推断职业、常犯错误、薄弱方向）
  const attempts = await prisma.questionAttempt.findMany({
    where: { question: { session: { userId } } },
    select: { isCorrect: true, errorType: true },
  })
  const errorTypeCount: Record<string, number> = {}
  let correctCount = 0
  for (const a of attempts) {
    if (a.isCorrect) correctCount++
    if (a.errorType) errorTypeCount[a.errorType] = (errorTypeCount[a.errorType] ?? 0) + 1
  }
  const errorTypeNames: Record<string, string> = {
    forget: '遗忘',
    confusion: '概念混淆',
    missing_relation: '关系没建立',
    missing_prerequisite: '前置知识不足',
    misunderstand: '理解错误',
    misapply: '应用错误',
  }
  const errorSummary =
    Object.entries(errorTypeCount)
      .map(([k, v]) => `${errorTypeNames[k] ?? k} ${v} 次`)
      .join('、') || '无'

  const behaviorSummary = [
    `总作答次数：${attempts.length}`,
    `答对次数：${correctCount}`,
    `错误类型分布：${errorSummary}`,
  ].join('\n')

  const profile = await chatJSON<ProfilePatch>([
    { role: 'system', content: inferProfileSystem() },
    {
      role: 'user',
      content: `以下是用户积累的知识：\n${summary || '（暂无知识）'}\n\n用户学习行为数据：\n${behaviorSummary}\n\n请结合知识内容和行为数据推断用户画像（尤其关注：职业身份、常犯错误、薄弱方向）。`,
    },
  ])

  const data: Record<string, unknown> = { ...profile }
  for (const f of JSON_FIELDS) {
    const v = (profile as Record<string, unknown>)[f]
    if (Array.isArray(v)) data[f] = JSON.stringify(v)
    else if (v !== undefined) data[f] = v
  }

  const existing = await prisma.userProfile.findUnique({ where: { userId } })
  if (existing) {
    return prisma.userProfile.update({ where: { userId }, data: data as any })
  }
  return prisma.userProfile.create({ data: { userId, ...data } } as any)
}

// 个性化学习推荐
export async function recommendLearning(userId: string) {
  const knowledges = await prisma.knowledge.findMany({
    where: { userId, status: 'active' },
    select: { id: true, title: true, coreConclusion: true, type: true },
    orderBy: { updatedAt: 'desc' },
    take: 40,
  })
  const states = await prisma.userKnowledgeState.findMany({
    where: { userId },
    include: { knowledge: { select: { title: true } } },
  })
  const profile = await getProfileText(userId)

  interface RecDraft {
    type: string
    title: string
    detail?: string
    knowledgeIds?: string[]
  }
  const recs = await chatJSON<RecDraft[]>([
    { role: 'system', content: recommendSystem() },
    {
      role: 'user',
      content: `用户画像：\n${profile || '无'}

用户知识列表：
${knowledges.map((k) => `[${k.id}] ${k.title}：${k.coreConclusion}`).join('\n')}

掌握状态：
${states.map((s) => `${s.knowledge.title}：理解 ${s.understanding.toFixed(1)} / 应用 ${s.application.toFixed(1)}`).join('\n')}

请给出「接下来应该学什么」的个性化建议。`,
    },
  ])

  const created = []
  for (const r of recs) {
    const rec = await prisma.learningRecommendation.create({
      data: {
        userId,
        type: r.type,
        title: r.title,
        detail: r.detail,
        knowledgeIds: r.knowledgeIds ? JSON.stringify(r.knowledgeIds) : null,
      },
    })
    created.push(rec)
  }
  return created
}

// 给已有断层补齐「学到什么程度」和「所属领域」。
// 只在确实缺字段时才调用 AI，补齐过就不再重复花钱。
export async function enrichGaps(userId: string) {
  const areaRows = await prisma.knowledge.findMany({
    where: { userId, status: 'active' },
    select: { category: { select: { name: true } } },
  })
  const areaNames = Array.from(
    new Set(areaRows.map((k) => k.category?.name).filter((x): x is string => Boolean(x))),
  )

  const gaps = await prisma.knowledgeGap.findMany({
    where: { userId, status: 'open' },
    select: { id: true, gapDescription: true, reason: true, targetDepth: true, area: true },
  })
  const need = gaps.filter((g) => !g.targetDepth || (!g.area && areaNames.length > 0))
  if (need.length === 0) return 0

  const profileText = await getProfileText(userId)

  interface EnrichDraft {
    id: string
    targetDepth?: string
    area?: string
  }
  const result = await chatJSON<EnrichDraft[]>([
    { role: 'system', content: gapEnrichSystem() },
    {
      role: 'user',
      content: `用户画像：\n${profileText || '无'}

可选领域名（area 必须从这里选）：${areaNames.join('、') || '无'}

待补全的断层：
${need.map((g) => `[${g.id}] ${g.gapDescription}（已知理由：${g.reason || '无'}）`).join('\n')}`,
    },
  ])

  let n = 0
  for (const r of result) {
    const target = need.find((g) => g.id === r.id)
    if (!target) continue
    await prisma.knowledgeGap.update({
      where: { id: target.id },
      data: {
        targetDepth: r.targetDepth ?? target.targetDepth,
        area: r.area && areaNames.includes(r.area) ? r.area : target.area,
      },
    })
    n++
  }
  return n
}

// 知识断层发现
export async function discoverGaps(userId: string) {
  const knowledges = await prisma.knowledge.findMany({
    where: { userId, status: 'active' },
    select: {
      id: true,
      title: true,
      coreConclusion: true,
      type: true,
      category: { select: { name: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: 60,
  })
  if (knowledges.length < 2) return []
  const profile = await getProfileText(userId)

  const areaNames = Array.from(
    new Set(knowledges.map((k) => k.category?.name).filter((x): x is string => Boolean(x))),
  )

  interface GapDraft {
    gapDescription: string
    recommended: boolean
    reason?: string
    targetDepth?: string
    area?: string
    fromKnowledgeId?: string
    toKnowledgeId?: string
  }
  const gaps = await chatJSON<GapDraft[]>([
    { role: 'system', content: gapSystem() },
    {
      role: 'user',
      content: `用户画像：\n${profile || '无'}

用户知识列表：
${knowledges
  .map((k) => `[${k.id}] ${k.category?.name ? `（${k.category.name}）` : ''}${k.title}：${k.coreConclusion}`)
  .join('\n')}

可选的领域名（area 必须从这里选）：${areaNames.join('、') || '无'}

请发现用户知识体系中的断层。`,
    },
  ])

  // 已有的未处理断层不重复创建，避免反复发现堆出一堆重复项
  const existing = await prisma.knowledgeGap.findMany({
    where: { userId, status: 'open' },
    select: { gapDescription: true },
  })
  const existingSet = new Set(existing.map((g) => g.gapDescription.trim()))

  const created = []
  for (const g of gaps) {
    if (!g.gapDescription || existingSet.has(g.gapDescription.trim())) continue
    const gap = await prisma.knowledgeGap.create({
      data: {
        userId,
        gapDescription: g.gapDescription,
        recommended: g.recommended,
        reason: g.reason,
        targetDepth: g.targetDepth ?? null,
        area: g.area && areaNames.includes(g.area) ? g.area : null,
        fromKnowledgeId: knowledges.some((k) => k.id === g.fromKnowledgeId) ? g.fromKnowledgeId : null,
        toKnowledgeId: knowledges.some((k) => k.id === g.toKnowledgeId) ? g.toKnowledgeId : null,
      },
    })
    created.push(gap)
  }
  return created
}

export async function listGaps(userId: string) {
  return prisma.knowledgeGap.findMany({
    where: { userId, status: 'open' },
    orderBy: { createdAt: 'desc' },
  })
}
