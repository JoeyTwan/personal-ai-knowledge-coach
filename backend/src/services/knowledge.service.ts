import { prisma } from '../lib/prisma'
import { tokenize } from '../lib/jieba'

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

// 虚拟分类 id：把没有归类的知识兜在一起，保证目录能覆盖全部知识
export const UNCATEGORIZED_ID = '__uncategorized__'

export interface ListKnowledgeFilters {
  search?: string
  categoryId?: string
  status?: string
  type?: string
}

// 收集某分类及其所有子孙分类的 id（点大标题时展示全部下级知识）
async function collectCategoryIds(rootId: string): Promise<string[]> {
  const all = await prisma.category.findMany({ select: { id: true, parentId: true } })
  const childrenOf = new Map<string, string[]>()
  for (const c of all) {
    if (!c.parentId) continue
    const list = childrenOf.get(c.parentId) ?? []
    list.push(c.id)
    childrenOf.set(c.parentId, list)
  }
  const ids: string[] = []
  const stack = [rootId]
  while (stack.length > 0) {
    const id = stack.pop()!
    ids.push(id)
    for (const child of childrenOf.get(id) ?? []) stack.push(child)
  }
  return ids
}

export async function listKnowledge(userId: string, filters: ListKnowledgeFilters = {}) {
  const where: Record<string, unknown> = { userId, status: filters.status ?? 'active' }
  if (filters.categoryId === UNCATEGORIZED_ID) {
    // 未分类：收纳所有没有归类的知识
    where.categoryId = null
  } else if (filters.categoryId) {
    // 包含该分类下所有子孙分类的知识（点击父分类标题能看到下级全部内容）
    where.categoryId = { in: await collectCategoryIds(filters.categoryId) }
  }
  if (filters.type) where.type = filters.type
  if (filters.search) {
    const tokens = tokenize(filters.search)
    if (tokens.length > 0) {
      // 中文分词模糊匹配：任一关键词命中标题/结论/解释/示例/标签即召回
      where.OR = tokens.map((t) => ({
        OR: [
          { title: { contains: t } },
          { coreConclusion: { contains: t } },
          { briefExplanation: { contains: t } },
          { detailExplanation: { contains: t } },
          { example: { contains: t } },
          { tags: { some: { name: { contains: t } } } },
        ],
      }))
    } else {
      where.OR = [
        { title: { contains: filters.search } },
        { coreConclusion: { contains: filters.search } },
      ]
    }
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
  // 先删知识（级联清理来源/版本/掌握状态/关系），再清理引用它的知识断层
  await prisma.$transaction([
    prisma.knowledge.delete({ where: { id } }),
    prisma.knowledgeGap.deleteMany({
      where: { userId, OR: [{ fromKnowledgeId: id }, { toKnowledgeId: id }] },
    }),
  ])
  return existing
}

// 批量删除（多选删除）
export async function deleteKnowledgeBatch(userId: string, ids: string[]) {
  if (!ids || ids.length === 0) return { count: 0 }
  const owned = await prisma.knowledge.findMany({
    where: { id: { in: ids }, userId },
    select: { id: true },
  })
  const ownedIds = owned.map((k) => k.id)
  if (ownedIds.length === 0) return { count: 0 }
  await prisma.$transaction([
    prisma.knowledge.deleteMany({ where: { id: { in: ownedIds }, userId } }),
    prisma.knowledgeGap.deleteMany({
      where: {
        userId,
        OR: [{ fromKnowledgeId: { in: ownedIds } }, { toKnowledgeId: { in: ownedIds } }],
      },
    }),
  ])
  return { count: ownedIds.length }
}

// 删除分类：连同其下所有子孙分类的知识一起永久删除
export async function deleteCategory(userId: string, categoryId: string) {
  const cat = await prisma.category.findUnique({ where: { id: categoryId } })
  if (!cat) return null

  const ids = await collectCategoryIds(categoryId)
  const knowledges = await prisma.knowledge.findMany({
    where: { userId, categoryId: { in: ids } },
    select: { id: true },
  })
  const knowledgeIds = knowledges.map((k) => k.id)

  await prisma.$transaction([
    // 1. 删掉该分类及子孙分类下的全部知识（关联数据由外键级联清理）
    prisma.knowledge.deleteMany({ where: { id: { in: knowledgeIds } } }),
    // 2. 清理引用这些知识的知识断层
    prisma.knowledgeGap.deleteMany({
      where: {
        userId,
        OR: [{ fromKnowledgeId: { in: knowledgeIds } }, { toKnowledgeId: { in: knowledgeIds } }],
      },
    }),
    // 3. 解除父子引用，避免批量删除分类时撞上自引用约束
    prisma.category.updateMany({ where: { parentId: { in: ids } }, data: { parentId: null } }),
    // 4. 删掉该分类及其全部子孙分类
    prisma.category.deleteMany({ where: { id: { in: ids } } }),
  ])

  return { deletedKnowledges: knowledgeIds.length, deletedCategories: ids.length }
}

export interface CategoryNode {
  id: string
  name: string
  count: number
  children: CategoryNode[]
}

// 分类树：每个节点带「该分类及子分类下的活跃知识总数」，用于知识库侧边栏
export async function listCategories(userId: string): Promise<CategoryNode[]> {
  const cats = await prisma.category.findMany({
    include: {
      knowledges: { where: { userId, status: 'active' }, select: { id: true } },
    },
  })

  const nodes = new Map<string, CategoryNode>()
  for (const c of cats) {
    nodes.set(c.id, { id: c.id, name: c.name, count: c.knowledges.length, children: [] })
  }

  const roots: CategoryNode[] = []
  for (const c of cats) {
    const node = nodes.get(c.id)!
    if (c.parentId && nodes.has(c.parentId)) {
      nodes.get(c.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  const accumulate = (node: CategoryNode): number => {
    let total = node.count
    for (const child of node.children) total += accumulate(child)
    node.count = total
    return total
  }
  roots.forEach(accumulate)

  // 未分类节点：把没有归类的知识兜住，保证目录数字与「全部知识」一致
  const uncategorized = await prisma.knowledge.count({
    where: { userId, status: 'active', categoryId: null },
  })
  if (uncategorized > 0) {
    roots.push({ id: UNCATEGORIZED_ID, name: '未分类', count: uncategorized, children: [] })
  }

  return roots
}
