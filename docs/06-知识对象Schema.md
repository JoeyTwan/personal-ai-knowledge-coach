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
  type: string          // 自己思考的 | 听别人说的 | 社交媒体博客等
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
  "title": "检索增强为什么能压制幻觉",
  "coreConclusion": "把相关资料先检索出来作为作答依据，模型不必依赖参数里的模糊记忆，编造的空间被大幅压缩。",
  "detailExplanation": "模型本身不区分「记得」和「编得像」，检索增强把事实来源外置，让回答有据可查。",
  "type": "概念",
  "status": "active",
  "confidence": 0.9,
  "tags": ["检索增强", "幻觉"],
  "sources": [
    { "type": "社交媒体博客等", "occurredAt": "2026-08-15" },
    { "type": "自己思考的", "occurredAt": "2026-09-01" }
  ]
}
```

## 4. 导出结构（Markdown / Obsidian 兼容）

```markdown
---
id: xxx
title: 检索增强为什么能压制幻觉
type: 概念
tags: [检索增强, 幻觉]
status: active
---

# 检索增强为什么能压制幻觉

核心结论...
详细解释...

## 相关知识
- [[注意力机制]]
- [[上下文窗口直接决定调用成本]]
```

知识之间用 wikilink `[[标题]]` 表达关系，兼容 Obsidian。
