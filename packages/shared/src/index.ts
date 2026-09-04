// 前后端共享的常量与类型

// ===== 知识状态 =====
export const KNOWLEDGE_STATUS = ['active', 'outdated', 'archived', 'deleted'] as const
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUS)[number]

// ===== 知识类型（AI 自动识别，可扩展）=====
export const KNOWLEDGE_TYPES = [
  '概念',
  '事实',
  '思考',
  '观点',
  '方法',
  '技能',
  '经验',
  '工作信息',
  '公司信息',
  '人物信息',
  '产品信息',
  '判断',
  '假设',
  '决策',
  '学习结论',
] as const
export type KnowledgeType = (typeof KNOWLEDGE_TYPES)[number]

// ===== 知识关系类型 =====
export const RELATION_TYPES = [
  'related',
  'prerequisite',
  'hyponym',
  'hypernym',
  'causal',
  'contrast',
  'application',
  'conflict',
  'evolution',
  'bridge',
] as const
export type RelationType = (typeof RELATION_TYPES)[number]

export const RELATION_LABELS: Record<RelationType, string> = {
  related: '相关',
  prerequisite: '前置',
  hyponym: '下位',
  hypernym: '上位',
  causal: '因果',
  contrast: '对比',
  application: '应用',
  conflict: '冲突',
  evolution: '演化',
  bridge: '知识桥梁',
}

// ===== 来源类型 =====
export const SOURCE_TYPES = [
  '抖音',
  '微信聊天',
  '客户酒席交流',
  '客户正式沟通',
  '自己总结',
  '书籍',
  '文章',
  '网络资料',
  'AI 讨论',
  '实际项目经验',
] as const

// ===== 题型 =====
export const QUESTION_TYPES = [
  'choice',
  'recall',
  'understanding',
  'comparison',
  'counterexample',
  'application',
  'association',
  'open',
] as const
export type QuestionType = (typeof QUESTION_TYPES)[number]

export const QUESTION_LABELS: Record<QuestionType, string> = {
  choice: '选择题',
  recall: '回忆题',
  understanding: '理解题',
  comparison: '对比题',
  counterexample: '辨析题',
  application: '应用题',
  association: '关联题',
  open: '开放题',
}

// ===== 错题归因 =====
export const ERROR_TYPES = [
  'forget',
  'confusion',
  'missing_relation',
  'missing_prerequisite',
  'misunderstand',
  'misapply',
] as const
export type ErrorType = (typeof ERROR_TYPES)[number]

// ===== 掌握深度 =====
export const RECOMMENDED_DEPTHS = ['understand', 'apply', 'master', 'skip'] as const
export type RecommendedDepth = (typeof RECOMMENDED_DEPTHS)[number]

// ===== 对话模式 =====
export const CONVERSATION_MODES = ['cocreate', 'ask', 'review'] as const
export type ConversationMode = (typeof CONVERSATION_MODES)[number]

// ===== 复习会话类型 =====
export const REVIEW_TYPES = ['mixed', 'category', 'weak', 'recent', 'weekly'] as const
export type ReviewType = (typeof REVIEW_TYPES)[number]

// ===== 推荐类型 =====
export const RECOMMENDATION_TYPES = ['gap', 'review', 'study', 'bridge'] as const
