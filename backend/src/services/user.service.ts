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

// 解析 JSON 数组字段（画像里多个字段以 JSON 字符串存储）
function parseArrayField(v: string | null): string[] {
  if (!v) return []
  try {
    const parsed = JSON.parse(v)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

// 将用户画像格式化为可注入 prompt 的文本（包含全部关键字段）
export async function getProfileText(userId: string): Promise<string> {
  const profile = await prisma.userProfile.findUnique({ where: { userId } })
  if (!profile) return ''
  const parts: string[] = []
  if (profile.occupation) parts.push(`职业：${profile.occupation}`)
  if (profile.workDomain) parts.push(`工作领域：${profile.workDomain}`)
  if (profile.currentFocus) parts.push(`当前关注：${profile.currentFocus}`)
  if (profile.technicalDepth) parts.push(`技术深度：${profile.technicalDepth}`)
  if (profile.businessLevel) parts.push(`商业水平：${profile.businessLevel}`)
  const areas = parseArrayField(profile.primaryKnowledgeAreas)
  if (areas.length) parts.push(`主要知识领域：${areas.join('、')}`)
  const scenarios = parseArrayField(profile.commonScenarios)
  if (scenarios.length) parts.push(`常见使用场景：${scenarios.join('、')}`)
  const goals = parseArrayField(profile.learningGoals)
  if (goals.length) parts.push(`学习目标：${goals.join('、')}`)
  const interests = parseArrayField(profile.interests)
  if (interests.length) parts.push(`兴趣：${interests.join('、')}`)
  const deepDive = parseArrayField(profile.deepDiveAreas)
  if (deepDive.length) parts.push(`倾向深入的领域：${deepDive.join('、')}`)
  const shallow = parseArrayField(profile.shallowAreas)
  if (shallow.length) parts.push(`只需了解的领域（不必深入）：${shallow.join('、')}`)
  const mistakes = parseArrayField(profile.commonMistakes)
  if (mistakes.length) parts.push(`常犯错误：${mistakes.join('、')}`)
  const weak = parseArrayField(profile.weakDirections)
  if (weak.length) parts.push(`薄弱方向：${weak.join('、')}`)
  return parts.join('\n')
}
