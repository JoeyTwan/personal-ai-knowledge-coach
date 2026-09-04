import { prisma } from '../lib/prisma'
import { chatJSON } from '../ai/client'
import { generateQuestionSystem, evaluateAnswerSystem } from '../ai/prompts'
import { getProfileText } from './user.service'

// ===== 复习计划 =====
export async function createReviewPlan(userId: string, limit = 10) {
  const now = new Date()
  const states = await prisma.userKnowledgeState.findMany({
    where: { userId },
    include: {
      knowledge: { select: { id: true, title: true, coreConclusion: true, status: true } },
    },
  })
  const active = states.filter((c) => c.knowledge.status === 'active')
  // 到期优先，其次遗忘风险高，其次薄弱
  const sorted = active.sort((a, b) => {
    const an = a.nextReviewAt?.getTime() ?? 0
    const bn = b.nextReviewAt?.getTime() ?? 0
    if (an !== bn) return an - bn
    return (b.forgetRisk ?? 0) - (a.forgetRisk ?? 0)
  })
  return sorted.slice(0, limit).map((c) => ({
    knowledgeId: c.knowledgeId,
    title: c.knowledge.title,
    coreConclusion: c.knowledge.coreConclusion,
    nextReviewAt: c.nextReviewAt,
    forgetRisk: c.forgetRisk,
    reviewCount: c.reviewCount,
  }))
}

// ===== 开始复习会话 =====
export async function startReviewSession(userId: string, knowledgeIds?: string[], type = 'mixed') {
  let ids = knowledgeIds
  if (!ids || ids.length === 0) {
    const plan = await createReviewPlan(userId)
    ids = plan.map((p) => p.knowledgeId)
  }
  if (ids.length === 0) return { empty: true }

  const session = await prisma.reviewSession.create({
    data: { userId, type, knowledgeIds: JSON.stringify(ids) },
  })
  return { sessionId: session.id, total: ids.length }
}

// ===== 根据掌握状态选择题型与难度 =====
function chooseQuestionType(reviewCount: number, state: any) {
  if (reviewCount === 0) return { type: 'recall', difficulty: 1 }
  if (reviewCount === 1) return { type: 'understanding', difficulty: 2 }
  if (reviewCount === 2) return { type: 'comparison', difficulty: 3 }
  if (reviewCount === 3) return { type: 'association', difficulty: 3 }
  return { type: 'application', difficulty: 4 }
}

// ===== 生成下一题 =====
export async function getNextQuestion(userId: string, sessionId: string) {
  const session = await prisma.reviewSession.findUnique({ where: { id: sessionId } })
  if (!session) return null

  const knowledgeIds = JSON.parse(session.knowledgeIds) as string[]
  const answeredCount = await prisma.question.count({
    where: { sessionId, attempts: { some: {} } },
  })
  if (answeredCount >= knowledgeIds.length) {
    await prisma.reviewSession.update({
      where: { id: sessionId },
      data: { status: 'completed', completedAt: new Date() },
    })
    return { done: true }
  }

  const knowledgeId = knowledgeIds[answeredCount]
  const knowledge = await prisma.knowledge.findUnique({ where: { id: knowledgeId } })
  if (!knowledge) return { done: true }

  const state = await prisma.userKnowledgeState.findUnique({
    where: { userId_knowledgeId: { userId, knowledgeId } },
  })
  const { type, difficulty } = chooseQuestionType(state?.reviewCount ?? 0, state)

  const profile = await getProfileText(userId)
  const prompt = [
    { role: 'system' as const, content: generateQuestionSystem() },
    {
      role: 'user' as const,
      content: `知识标题：${knowledge.title}
核心结论：${knowledge.coreConclusion}
${knowledge.detailExplanation ? '详细解释：' + knowledge.detailExplanation : ''}

请出一道「${type}」题，难度 ${difficulty}。

用户画像（用于让题目贴合用户场景）：
${profile || '无'}`,
    },
  ]

  interface QuestionDraft {
    type: string
    prompt: string
    options?: { label: string; text: string }[]
    answer?: string
    difficulty?: number
  }
  const q = await chatJSON<QuestionDraft>(prompt)

  const question = await prisma.question.create({
    data: {
      sessionId,
      knowledgeId,
      type: q.type || type,
      prompt: q.prompt,
      options: q.options ? JSON.stringify(q.options) : null,
      answer: q.answer ?? null,
      difficulty: q.difficulty ?? difficulty,
    },
  })

  return {
    questionId: question.id,
    type: question.type,
    prompt: question.prompt,
    options: q.options ?? null,
    difficulty: question.difficulty,
    knowledgeId,
  }
}

// ===== 题型 → 掌握维度映射 =====
function dimensionForType(type: string): 'recall' | 'understanding' | 'association' | 'application' {
  switch (type) {
    case 'recall':
      return 'recall'
    case 'comparison':
    case 'association':
      return 'association'
    case 'application':
      return 'application'
    default:
      return 'understanding'
  }
}

function clamp(v: number) {
  return Math.max(0, Math.min(1, v))
}

function nextInterval(reviewCount: number, good: boolean): number {
  if (!good) return 24 * 60 * 60 * 1000 // 1 天
  const days = [1, 3, 7, 14, 30, 60]
  const d = days[Math.min(reviewCount, days.length - 1)]
  return d * 24 * 60 * 60 * 1000
}

// ===== 提交答案并评估 =====
export async function submitAnswer(userId: string, questionId: string, answer: string) {
  const question = await prisma.question.findUnique({
    where: { id: questionId },
    include: { session: true },
  })
  if (!question || question.session.userId !== userId) return null

  interface Evaluation {
    isCorrect: boolean
    score: number
    feedback: string
    errorType?: string
  }
  const evalResult = await chatJSON<Evaluation>([
    { role: 'system', content: evaluateAnswerSystem() },
    {
      role: 'user',
      content: `题目类型：${question.type}
题目：${question.prompt}
${question.options ? '选项：' + question.options : ''}
${question.answer ? '参考答案：' + question.answer : ''}

用户作答：
${answer}

请评估用户作答。`,
    },
  ])

  const attempt = await prisma.questionAttempt.create({
    data: {
      questionId,
      answer,
      isCorrect: evalResult.isCorrect,
      score: evalResult.score,
      feedback: evalResult.feedback,
      errorType: evalResult.errorType ?? null,
    },
  })

  // 更新掌握状态
  if (question.knowledgeId) {
    await updateStateAfterAnswer(userId, question.knowledgeId, question.type, evalResult)
  }

  return { ...evalResult, attemptId: attempt.id }
}

async function updateStateAfterAnswer(
  userId: string,
  knowledgeId: string,
  questionType: string,
  evalResult: { isCorrect: boolean; score: number; errorType?: string },
) {
  const state = await prisma.userKnowledgeState.findUnique({
    where: { userId_knowledgeId: { userId, knowledgeId } },
  })
  if (!state) return

  const score = evalResult.score ?? (evalResult.isCorrect ? 1 : 0)
  const dim = dimensionForType(questionType)
  const good = score >= 0.7
  const delta = (score - 0.5) * 0.4

  const data: Record<string, unknown> = {
    [dim]: clamp(state[dim] + delta),
    stability: clamp(state.stability + (score - 0.5) * 0.3),
    reviewCount: state.reviewCount + 1,
    lastReviewedAt: new Date(),
    nextReviewAt: new Date(Date.now() + nextInterval(state.reviewCount + 1, good)),
    forgetRisk: good ? Math.max(0, (state.forgetRisk ?? 0) - 0.1) : clamp((state.forgetRisk ?? 0.3) + 0.15),
  }
  // 答对时顺带小幅提升 recall 与 understanding（回忆本身就是强化）
  if (good) {
    data.recall = clamp(state.recall + 0.1)
  }

  await prisma.userKnowledgeState.update({ where: { id: state.id }, data: data as any })
}

// ===== 获取复习会话进度 =====
export async function getSessionProgress(userId: string, sessionId: string) {
  const session = await prisma.reviewSession.findUnique({
    where: { id: sessionId },
    include: { questions: { include: { attempts: true } } },
  })
  if (!session || session.userId !== userId) return null
  const total = session.questions.length
  const answered = session.questions.filter((q) => q.attempts.length > 0).length
  return { sessionId, status: session.status, total, answered }
}
