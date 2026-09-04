# 05 · LLM 调用架构

## 1. 统一封装原则

- LLM 层做统一封装，业务代码不直接写死模型调用。
- 第一版优先支持 DeepSeek（OpenAI 兼容协议，用 `openai` SDK 指向 DeepSeek baseURL）。
- provider、baseURL、model 全部通过环境变量配置，未来可替换模型。

## 2. 模块职责

| LLM 任务 | 对应 Service | 说明 |
| --- | --- | --- |
| 对话（共创/问答） | AI Service | 多轮讨论、知识调用 |
| 知识抽取 | Knowledge Agent | 从讨论中抽取结构化知识 |
| 知识分类 | Knowledge Agent | 自动归类、生成标签 |
| 关系发现 | Relation Agent | 找相关/前置/因果/对比/冲突/桥梁 |
| 知识合并 | Relation Agent | 发现重复、生成合并结果 |
| 题目生成 | Coach Agent | 8 类题型动态出题 |
| 答案评估 | Coach Agent | 判断对错、错题归因 |
| 用户画像 | Profile Agent | 从长期使用推断画像 |
| 学习建议 | Coach Agent | 个性化学习推荐 |
| 知识推荐 | Coach Agent | 判断断层是否值得学 |

## 3. 统一封装接口（AI Service）

```ts
// 核心调用
chat(messages, options): Promise<string>
chatJSON<T>(messages, options): Promise<T>   // 要求模型输出 JSON，安全解析

// 高层任务
extractKnowledge(discussion): Promise<KnowledgeDraft>
classifyKnowledge(text): Promise<{ category, tags, type }>
discoverRelations(knowledge, all): Promise<RelationSuggestion[]>
detectDuplicates(all): Promise<MergeSuggestion[]>
generateQuestion(knowledge, state, type, difficulty): Promise<Question>
evaluateAnswer(question, answer): Promise<Evaluation>
inferProfile(events): Promise<ProfilePatch>
recommendLearning(state): Promise<Recommendation[]>
```

## 4. Prompt 策略

- **JSON 输出**：对结构化任务（抽取、分类、关系、评估、出题）要求模型返回 JSON，后端做 schema 校验与安全解析，失败自动重试。
- **角色注入**：所有任务注入用户画像（职业、目标、技术深度），保证个性化。
- **区分来源**：问答时明确要求区分「知识库已有」与「AI 补充」。
- **共识确认**：共创讨论中，AI 在判断共识达成后，输出最终知识 JSON 供用户确认。

## 5. 降级与容错

- 模型调用失败重试（指数退避）。
- JSON 解析失败时提取代码块再解析，仍失败则返回保守默认值。
- 无 API Key 时，后端可启动但 AI 相关接口返回明确错误提示（便于本地调试非 AI 功能）。

## 6. 检索与调用顺序（问 AI 时）

```
1. 找用户已有知识（关键词 + 语义）
2. 找相关关系
3. 考虑时间与有效性
4. 考虑用户角色
5. 考虑掌握程度
6. 决定如何回答
```

多种检索结合：结构化知识 + 关系 + 关键词 + 时间 + 用户认知模型，不做单一相似度检索。
