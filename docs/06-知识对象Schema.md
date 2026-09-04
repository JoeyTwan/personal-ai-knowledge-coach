# 06 · 知识对象 Schema

知识对象（Knowledge）是产品的核心数据模型，不围绕「笔记」设计。

## 1. TypeScript 类型定义

```ts
interface Knowledge {
  id: string
  title: string              // 标题
  coreConclusion: string     // 核心结论（易懂语言）
  briefExplanation?: string  // 简洁解释
  detailExplanation?: string // 详细解释
  example?: string           // 示例
  type: KnowledgeType        // 知识类型
  status: KnowledgeStatus    // active | outdated | archived | deleted
  confidence?: number        // 可信度 0-1
  isOutdated: boolean
  categoryId?: string
  tags: string[]
  sources: KnowledgeSource[]
  createdAt: string
  updatedAt: string
}

type KnowledgeStatus = 'active' | 'outdated' | 'archived' | 'deleted'

interface KnowledgeSource {
  type: string          // 抖音/微信/客户交流/书籍/文章/网络/AI讨论/自己总结/项目经验
  detail?: string
  occurredAt?: string   // 来源时间
  note?: string
}
```

## 2. 知识类型（AI 自动识别）

概念、事实、思考、观点、方法、技能、经验、工作信息、公司信息、人物信息、产品信息、判断、假设、决策、学习结论。

不把分类体系做死，允许 AI 随长期使用逐步长出。

## 3. 示例

```json
{
  "title": "XXX 公司的液冷能力",
  "coreConclusion": "XXX 公司具备服务器液冷交付能力，已通过实际项目验证。",
  "detailExplanation": "2026-07 听闻具备能力，2026-08 获得客户反馈，2026-09 项目验证落地。",
  "type": "公司信息",
  "status": "active",
  "confidence": 0.9,
  "tags": ["液冷", "XXX公司", "服务器"],
  "sources": [
    { "type": "客户交流", "occurredAt": "2026-08-15" },
    { "type": "项目经验", "occurredAt": "2026-09-01" }
  ]
}
```

## 4. 导出结构（Markdown / Obsidian 兼容）

```markdown
---
id: xxx
title: XXX 公司的液冷能力
type: 公司信息
tags: [液冷, XXX公司, 服务器]
status: active
---

# XXX 公司的液冷能力

核心结论...
详细解释...

## 相关知识
- [[Attention]]
- [[液冷]]
```

知识之间用 wikilink `[[标题]]` 表达关系，兼容 Obsidian。
