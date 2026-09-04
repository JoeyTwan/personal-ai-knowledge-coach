import { prisma } from '../lib/prisma'

// MVP：单用户私有产品，用默认用户。未来多用户时在此扩展认证。

let cachedUserId: string | null = null

export async function getDefaultUserId(): Promise<string> {
  if (cachedUserId) return cachedUserId
  const existing = await prisma.user.findFirst()
  if (existing) {
    cachedUserId = existing.id
    return existing.id
  }
  const created = await prisma.user.create({ data: { username: 'default' } })
  cachedUserId = created.id
  return created.id
}

// 将用户画像格式化为可注入 prompt 的文本
export async function getProfileText(userId: string): Promise<string> {
  const profile = await prisma.userProfile.findUnique({ where: { userId } })
  if (!profile) return ''
  const parts: string[] = []
  if (profile.occupation) parts.push(`职业：${profile.occupation}`)
  if (profile.workDomain) parts.push(`工作领域：${profile.workDomain}`)
  if (profile.currentFocus) parts.push(`当前关注：${profile.currentFocus}`)
  if (profile.technicalDepth) parts.push(`技术深度：${profile.technicalDepth}`)
  if (profile.businessLevel) parts.push(`商业水平：${profile.businessLevel}`)
  if (profile.primaryKnowledgeAreas) parts.push(`主要知识领域：${profile.primaryKnowledgeAreas}`)
  if (profile.learningGoals) parts.push(`学习目标：${profile.learningGoals}`)
  return parts.join('\n')
}
