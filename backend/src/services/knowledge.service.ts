import { prisma } from '../lib/prisma'

export interface KnowledgeSourceInput {
  type: string
  detail?: string
  occurredAt?: string | null
  note?: string
}

export interface CreateKnowledgeInput {
  title: string
  coreConclusion: string
  briefExplanation?: string | null
  detailExplanation?: string | null
  example?: string | null
  type?: string
  categoryPath?: string[]
  tags?: string[]
  sources?: KnowledgeSourceInput[]
  confidence?: number
}

// 根据分类路径找到或创建分类（树形）
async function resolveCategory(categoryPath?: string[]): Promise<{ id: string } | null> {
  if (!categoryPath || categoryPath.length === 0) return null
  let parentId: string | null = null
  let last: { id: string } | null = null
  for (const name of categoryPath) {
    if (!name) continue
    const existing: { id: string } | null = await prisma.category.findFirst({
      where: { name, parentId },
      select: { id: true },
    })
    if (existing) {
      last = existing
    } else {
      const created: { id: string } = await prisma.category.create({
        data: { name, parentId },
        select: { id: true },
      })
      last = created
    }
    parentId = last.id
  }
  return last
}

export async function createKnowledge(userId: string, input: CreateKnowledgeInput) {
  const category = await resolveCategory(input.categoryPath)
  const knowledge = await prisma.knowledge.create({
    data: {
      title: input.title,
      coreConclusion: input.coreConclusion,
      briefExplanation: input.briefExplanation ?? null,
      detailExplanation: input.detailExplanation ?? null,
      example: input.example ?? null,
      type: input.type ?? '概念',
      confidence: input.confidence ?? null,
      categoryId: category?.id ?? null,
      userId,
      tags: input.tags?.length
        ? { connectOrCreate: input.tags.map((name) => ({ where: { name }, create: { name } })) }
        : undefined,
      sources: input.sources?.length
        ? {
            create: input.sources.map((s) => ({
              type: s.type,
              detail: s.detail,
              note: s.note,
              occurredAt: s.occurredAt ? new Date(s.occurredAt) : null,
            })),
          }
        : undefined,
    },
  })

  // 初始化掌握状态（新知识未掌握，安排初次检测）
  await prisma.userKnowledgeState.create({
    data: {
      userId,
      knowledgeId: knowledge.id,
      awareness: 0.3,
      recall: 0.1,
      understanding: 0.1,
      association: 0.1,
      application: 0.1,
      stability: 0.1,
      nextReviewAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  })

  // 初始版本
  await prisma.knowledgeVersion.create({
    data: {
      knowledgeId: knowledge.id,
      version: 1,
      title: knowledge.title,
      coreConclusion: knowledge.coreConclusion,
      detailExplanation: knowledge.detailExplanation ?? undefined,
      changeReason: '首次收录',
    },
  })

  return knowledge
}

export interface ListKnowledgeFilters {
  search?: string
  categoryId?: string
  status?: string
  type?: string
}

export async function listKnowledge(userId: string, filters: ListKnowledgeFilters = {}) {
  const where: Record<string, unknown> = { userId, status: filters.status ?? 'active' }
  if (filters.categoryId) where.categoryId = filters.categoryId
  if (filters.type) where.type = filters.type
  if (filters.search) {
    where.OR = [
      { title: { contains: filters.search } },
      { coreConclusion: { contains: filters.search } },
      { detailExplanation: { contains: filters.search } },
    ]
  }
  const items = await prisma.knowledge.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    include: { category: true, tags: true, states: { where: { userId } } },
  })
  return items.map((k) => ({
    id: k.id,
    title: k.title,
    coreConclusion: k.coreConclusion,
    type: k.type,
    status: k.status,
    confidence: k.confidence,
    isOutdated: k.isOutdated,
    createdAt: k.createdAt,
    updatedAt: k.updatedAt,
    category: k.category?.name ?? null,
    tags: k.tags.map((t) => t.name),
    state: k.states[0] ?? null,
  }))
}

export async function getKnowledge(userId: string, id: string) {
  const k = await prisma.knowledge.findFirst({
    where: { id, userId },
    include: {
      category: true,
      tags: true,
      sources: { orderBy: { occurredAt: 'desc' } },
      versions: { orderBy: { version: 'desc' } },
      states: { where: { userId } },
      relationsFrom: { include: { to: { select: { id: true, title: true, coreConclusion: true, type: true } } } },
      relationsTo: { include: { from: { select: { id: true, title: true, coreConclusion: true, type: true } } } },
    },
  })
  return k
}

export async function updateKnowledge(userId: string, id: string, input: Partial<CreateKnowledgeInput>) {
  const existing = await prisma.knowledge.findFirst({ where: { id, userId } })
  if (!existing) return null

  // 核心内容变化时保存历史版本
  if (input.coreConclusion && input.coreConclusion !== existing.coreConclusion) {
    const lastVersion = await prisma.knowledgeVersion.findFirst({
      where: { knowledgeId: id },
      orderBy: { version: 'desc' },
    })
    await prisma.knowledgeVersion.create({
      data: {
        knowledgeId: id,
        version: (lastVersion?.version ?? 1) + 1,
        title: existing.title,
        coreConclusion: existing.coreConclusion,
        detailExplanation: existing.detailExplanation ?? undefined,
        changeReason: '内容更新',
      },
    })
  }

  const category = input.categoryPath ? await resolveCategory(input.categoryPath) : undefined

  const data: Record<string, unknown> = {}
  if (input.title !== undefined) data.title = input.title
  if (input.coreConclusion !== undefined) data.coreConclusion = input.coreConclusion
  if (input.briefExplanation !== undefined) data.briefExplanation = input.briefExplanation
  if (input.detailExplanation !== undefined) data.detailExplanation = input.detailExplanation
  if (input.example !== undefined) data.example = input.example
  if (input.type !== undefined) data.type = input.type
  if (input.confidence !== undefined) data.confidence = input.confidence
  if (category !== undefined) data.categoryId = category?.id ?? null
  if (input.tags) {
    data.tags = {
      connectOrCreate: input.tags.map((name) => ({ where: { name }, create: { name } })),
    }
  }

  return prisma.knowledge.update({ where: { id }, data })
}

export async function setKnowledgeStatus(userId: string, id: string, status: string) {
  const existing = await prisma.knowledge.findFirst({ where: { id, userId } })
  if (!existing) return null
  const data: Record<string, unknown> = { status }
  if (status === 'outdated') data.isOutdated = true
  if (status === 'active') data.isOutdated = false
  return prisma.knowledge.update({ where: { id }, data })
}

export async function deleteKnowledge(userId: string, id: string) {
  const existing = await prisma.knowledge.findFirst({ where: { id, userId } })
  if (!existing) return null
  return prisma.knowledge.delete({ where: { id } })
}
