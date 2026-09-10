import { prisma } from '../lib/prisma'
import { chatJSON } from '../ai/client'
import { discoverRelationsSystem } from '../ai/prompts'
import { tokenize } from '../lib/jieba'

interface RelationSuggestion {
  toId?: string
  toTitle?: string
  type: string
  reason?: string
  confidence?: number
  gapDescription?: string
}

// ===== 本地召回：用中文分词从全部已有知识中筛出值得让 AI 判断的候选 =====
// 设计目的：关系发现的成本与知识总量无关。
// 全部已有知识先在本地用分词打分（不联网、不花钱），只把分数最高的若干条交给 AI 判断。

export interface RelationCandidate {
  id: string
  title: string
  coreConclusion: string
  score: number
}

// 字段权重：标签和标题最能说明主题，正文解释只作微弱加权
const FIELD_WEIGHT = { tag: 4, title: 3, category: 2, conclusion: 2, body: 1 } as const

type TermSource = {
  title: string
  coreConclusion: string
  briefExplanation?: string | null
  detailExplanation?: string | null
  example?: string | null
  tags?: { name: string }[]
  category?: { name: string; parent?: { name: string } | null } | null
}

// 把一条知识切成「词 → 权重」的映射
function knowledgeTerms(k: TermSource): Map<string, number> {
  const terms = new Map<string, number>()
  const add = (text: string | null | undefined, weight: number) => {
    if (!text) return
    for (const t of tokenize(text)) terms.set(t, Math.max(terms.get(t) ?? 0, weight))
  }
  add(k.title, FIELD_WEIGHT.title)
  add(k.coreConclusion, FIELD_WEIGHT.conclusion)
  add(k.briefExplanation, FIELD_WEIGHT.body)
  add(k.detailExplanation, FIELD_WEIGHT.body)
  add(k.example, FIELD_WEIGHT.body)
  for (const t of k.tags ?? []) add(t.name, FIELD_WEIGHT.tag)
  add(k.category?.name, FIELD_WEIGHT.category)
  add(k.category?.parent?.name, FIELD_WEIGHT.category)
  return terms
}

// 两个词集的重合度：取两边权重的较小值累加，避免长文本靠词多刷分
function overlapScore(a: Map<string, number>, b: Map<string, number>): number {
  let score = 0
  for (const [term, weight] of a) {
    const other = b.get(term)
    if (other !== undefined) score += Math.min(weight, other)
  }
  return score
}

const CANDIDATE_LIMIT = 10

// 召回候选：零重合的直接淘汰；一条都没命中时返回空数组，调用方据此跳过 AI
export async function recallCandidates(
  userId: string,
  knowledgeId: string,
  limit = CANDIDATE_LIMIT,
): Promise<RelationCandidate[]> {
  const [source, others] = await Promise.all([
    prisma.knowledge.findUnique({
      where: { id: knowledgeId },
      include: { tags: { select: { name: true } }, category: { include: { parent: true } } },
    }),
    prisma.knowledge.findMany({
      where: { userId, status: 'active', id: { not: knowledgeId } },
      select: {
        id: true,
        title: true,
        coreConclusion: true,
        briefExplanation: true,
        detailExplanation: true,
        example: true,
        tags: { select: { name: true } },
        category: { select: { name: true, parent: { select: { name: true } } } },
      },
    }),
  ])
  if (!source) return []

  const srcTerms = knowledgeTerms(source)
  return others
    .map((o) => ({
      id: o.id,
      title: o.title,
      coreConclusion: o.coreConclusion,
      score: overlapScore(srcTerms, knowledgeTerms(o)),
    }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

// 新知识入库后，AI 自动发现与已有知识的关系。
// 只把本地召回出的少量候选发给 AI，成本恒定。
export async function discoverRelations(
  userId: string,
  knowledgeId: string,
  options: { candidates?: RelationCandidate[] } = {},
) {
  const knowledge = await prisma.knowledge.findUnique({ where: { id: knowledgeId } })
  if (!knowledge) return []

  const candidates = options.candidates ?? (await recallCandidates(userId, knowledgeId))
  // 本地零重合：没有任何值得判断的候选，直接跳过 AI 调用
  if (candidates.length === 0) return []

  const userPrompt = `新知识：
标题：${knowledge.title}
核心结论：${knowledge.coreConclusion}

以下是从用户已有知识中筛选出的相关候选（格式：id | 标题 | 核心结论）：
${candidates.map((o) => `- ${o.id} | ${o.title} | ${o.coreConclusion}`).join('\n')}

请判断新知识与这些候选之间的关系，返回目标知识的 id。若与候选中任意一条都无实质关系，返回空数组。`

  const suggestions = await chatJSON<RelationSuggestion[]>([
    { role: 'system', content: discoverRelationsSystem() },
    { role: 'user', content: userPrompt },
  ])

  const created: unknown[] = []
  for (const s of suggestions) {
    // 只在候选集合内匹配：AI 无法凭空指向未提供给它的知识
    const target =
      (s.toId ? candidates.find((o) => o.id === s.toId) : undefined) ??
      (s.toTitle ? candidates.find((o) => o.title === s.toTitle) : undefined) ??
      (s.toTitle ? candidates.find((o) => o.title.includes(s.toTitle as string)) : undefined)
    if (!target) continue
    try {
      // 知识桥梁：A 与 B 之间缺失中间知识 C，C 本身不存在，不能作为关系边，
      // 转存为「断层」记录，gapDescription 描述缺失的 C。
      if (s.type === 'bridge') {
        const gap = await prisma.knowledgeGap.create({
          data: {
            userId,
            gapDescription:
              s.gapDescription ||
              `「${knowledge.title}」与「${target.title}」之间缺少关键的中间知识`,
            recommended: false, // 是否值得学习，由后续断层分析结合画像判断
            reason: s.reason,
            fromKnowledgeId: knowledgeId,
            toKnowledgeId: target.id,
          },
        })
        created.push({ kind: 'gap', ...gap })
        continue
      }
      const rel = await prisma.knowledgeRelation.upsert({
        where: { fromId_toId_type: { fromId: knowledgeId, toId: target.id, type: s.type } },
        update: { reason: s.reason, confidence: s.confidence },
        create: {
          fromId: knowledgeId,
          toId: target.id,
          type: s.type,
          reason: s.reason,
          confidence: s.confidence,
          userId,
        },
      })
      created.push(rel)
    } catch (e) {
      // 重复关系等异常属正常情况，仅记日志不中断
      console.error('[关系发现] 建立关系失败', e)
    }
  }
  return created
}

// ===== 存量知识一次性补齐关系 =====
// 后台顺序执行，避免并发打爆接口；已有关系的知识对直接跳过，不重复花钱。

export interface RebuildJob {
  running: boolean
  total: number
  done: number
  relations: number
  gaps: number
  skipped: number
  startedAt: number
  finishedAt?: number
  error?: string
}

const rebuildJobs = new Map<string, RebuildJob>()

export function getRebuildStatus(userId: string): RebuildJob | null {
  return rebuildJobs.get(userId) ?? null
}

export async function startRebuildRelations(userId: string): Promise<RebuildJob> {
  const running = rebuildJobs.get(userId)
  if (running?.running) return running

  const knowledges = await prisma.knowledge.findMany({
    where: { userId, status: 'active' },
    select: { id: true },
    orderBy: { updatedAt: 'asc' },
  })

  const job: RebuildJob = {
    running: true,
    total: knowledges.length,
    done: 0,
    relations: 0,
    gaps: 0,
    skipped: 0,
    startedAt: Date.now(),
  }
  rebuildJobs.set(userId, job)

  void (async () => {
    try {
      for (const k of knowledges) {
        const candidates = await recallCandidates(userId, k.id)
        if (candidates.length === 0) {
          job.skipped++
          job.done++
          continue
        }
        const existing = await prisma.knowledgeRelation.findMany({
          where: { userId, OR: [{ fromId: k.id }, { toId: k.id }] },
          select: { fromId: true, toId: true },
        })
        const linked = new Set<string>()
        for (const r of existing) linked.add(r.fromId === k.id ? r.toId : r.fromId)

        const fresh = candidates.filter((c) => !linked.has(c.id))
        if (fresh.length === 0) {
          job.skipped++
          job.done++
          continue
        }
        const created = await discoverRelations(userId, k.id, { candidates: fresh })
        for (const c of created) {
          if ((c as { kind?: string }).kind === 'gap') job.gaps++
          else job.relations++
        }
        job.done++
      }
    } catch (e) {
      job.error = e instanceof Error ? e.message : String(e)
    } finally {
      job.running = false
      job.finishedAt = Date.now()
    }
  })()

  return job
}

// 知识图谱：节点 + 边（过滤掉指向已归档/删除知识的悬空边）
export async function getGraph(userId: string) {
  const knowledges = await prisma.knowledge.findMany({
    where: { userId, status: 'active' },
    select: { id: true, title: true, type: true, coreConclusion: true },
  })
  const relations = await prisma.knowledgeRelation.findMany({ where: { userId } })
  const activeIds = new Set(knowledges.map((k) => k.id))
  const validRelations = relations.filter((r) => activeIds.has(r.fromId) && activeIds.has(r.toId))
  return {
    nodes: knowledges.map((k) => ({
      id: k.id,
      label: k.title,
      type: k.type,
      summary: k.coreConclusion,
    })),
    edges: validRelations.map((r) => ({
      from: r.fromId,
      to: r.toId,
      type: r.type,
      reason: r.reason,
    })),
  }
}

// 单条知识的全部关系（合并出/入方向）
export async function getKnowledgeRelations(userId: string, knowledgeId: string) {
  const relations = await prisma.knowledgeRelation.findMany({
    where: { userId, OR: [{ fromId: knowledgeId }, { toId: knowledgeId }] },
    include: {
      from: { select: { id: true, title: true, coreConclusion: true } },
      to: { select: { id: true, title: true, coreConclusion: true } },
    },
  })
  return relations.map((r) => ({
    id: r.id,
    type: r.type,
    reason: r.reason,
    confidence: r.confidence,
    other: r.fromId === knowledgeId ? r.to : r.from,
    direction: r.fromId === knowledgeId ? 'out' : 'in',
  }))
}
