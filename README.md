# Personal AI Knowledge Coach · 个人 AI 知识教练

> 一个长期理解用户、组织用户知识、检测真实掌握程度并帮助用户持续成长的私人 AI 知识教练。

它不是笔记软件，不是 RAG 问答工具，也不是刷题 App。它是一个「知识版 Jarvis」：你把日常学习、思考、工作经验和真实世界的信息告诉它，它负责理解、整理、建立关联、判断认知缺口、主动复习、并在未来调用过去知识，最终目标是让「人」真正掌握知识，AI 只是手段。

---

## 核心理念

1. **人是目的，AI 是手段**：知识库是为了让用户更懂，AI 只是手段。
2. **知识共创**：AI 与用户讨论、追问、纠正、澄清，达成共识后经用户确认才入库。
3. **最终知识优先**：用户主要看到结构化知识，原始输入和讨论过程内部保留。
4. **知识网络**：知识之间自动建立前置、因果、对比、应用、冲突、演化等关系。
5. **个性化断层判断**：结合用户职业、目标、使用场景，判断知识断层是否值得学习。
6. **掌握有证据**：通过回忆、理解、对比、反例、应用、开放题等逐步验证掌握度。
7. **知识会演化**：同一知识随时间增强可信度，更新、合并、过时、归档，不覆盖历史。

---

## 核心能力

- **AI 知识共创**：语音 / 文字输入，AI 讨论追问，共识后结构化入库。
- **知识网络与图谱**：自动发现相关知识、上下级、前置、因果、对比、应用、冲突、演化关系。
- **知识演化**：新信息更新旧知识，保留历史版本与可信度变化。
- **知识合并**：发现重复 / 高度相似知识，建议合并。
- **AI 问答（知识调用）**：优先调用用户知识库，区分「已有知识」与「AI 补充」。
- **AI 出题**：8 类题型动态生成，难度随掌握度变化。
- **掌握度分析**：认知 / 回忆 / 理解 / 关联 / 应用 / 稳定性多维评估。
- **间隔复习**：新知识 → 初次检测 → 巩固 → 长间隔复习。
- **错题归因**：区分遗忘、概念混淆、关系未建立、前置不足、理解错误、应用错误。
- **知识断层发现**：结合用户角色判断缺口是否值得补齐。
- **个性化学习推荐**：基于用户画像、知识网络、目标给出「接下来学什么」。
- **Obsidian 兼容**：知识底层 Markdown 结构，支持导出与 wikilink 关系表达。

---

## 技术架构

```
Web / Mobile（未来）
      ↓  HTTP API
Backend（Fastify + TypeScript）
      ↓
   Service 层（Knowledge / Relation / Coach / Recall / Profile / AI / Scheduler）
      ↓
   Database（Prisma + SQLite，可换 Postgres）
      ↓
   LLM Provider（DeepSeek，可配置替换）
```

**技术栈**

| 层 | 技术 |
| --- | --- |
| Web 前端 | Next.js 15 + React 19 + Tailwind CSS |
| 后端 | Node.js + TypeScript + Fastify |
| 数据库 | Prisma ORM + SQLite（可切换 Postgres） |
| AI | DeepSeek API（OpenAI 兼容协议，`openai` SDK，可替换） |
| 工程 | npm workspaces monorepo |

---

## 项目结构

```
personal-ai-knowledge-coach/
├── apps/
│   └── web/              # Next.js 前端
├── backend/              # Fastify 后端 API
│   ├── src/
│   │   ├── ai/           # DeepSeek 统一封装 + prompt
│   │   ├── services/     # Knowledge / Relation / Coach / Recall / Profile
│   │   ├── routes/       # HTTP 路由
│   │   └── ...
│   └── prisma/           # 数据库 Schema
├── packages/
│   └── shared/           # 前后端共享类型与常量
├── docs/                 # 产品规划文档
├── scripts/              # 辅助脚本
├── .env.example
└── README.md
```

---

## 本地开发

前置要求：Node.js >= 18（推荐 20+）。

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，填入 DEEPSEEK_API_KEY 等

# 3. 初始化数据库
npm run db:generate
npm run db:push

# 4. 启动后端（默认端口 8787）
npm run dev:backend

# 5. 另开一个终端，启动 Web（默认端口 3000）
npm run dev:web
```

浏览器打开 http://localhost:3000 即可使用。

---

## 环境变量

见 `.env.example`，核心变量：

| 变量 | 说明 |
| --- | --- |
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥（必填，绝不提交 Git） |
| `DEEPSEEK_BASE_URL` | DeepSeek 接口地址，默认 `https://api.deepseek.com` |
| `DEEPSEEK_MODEL` | 模型名，默认 `deepseek-chat` |
| `DATABASE_URL` | 数据库连接，SQLite 默认 `file:./dev.db` |
| `JWT_SECRET` | 登录令牌签名密钥 |
| `BACKEND_PORT` / `WEB_PORT` | 后端 / 前端端口 |

---

## 数据库

默认 SQLite（零配置、单文件、本地即可运行）。生产环境可切换 Postgres，只需修改 `DATABASE_URL` 并调整 Prisma datasource provider。

---

## Deployment

后端与 Web 可分别部署，均通过环境变量注入配置。数据库建议使用持久化卷或托管 Postgres。部署细节见后续 Roadmap。

---

## Roadmap

- [x] 产品规划与架构设计
- [x] Monorepo 工程骨架 + 数据库 Schema
- [x] 后端基础 + DeepSeek AI 封装
- [x] 知识共创闭环（讨论 → 共识 → 入库）
- [x] 知识关系与图谱
- [x] AI 问答与知识调用
- [x] 复习、出题与掌握度模型
- [x] 知识演化、合并、画像与推荐
- [x] Web 前端界面
- [ ] 语音输入（移动端优先）
- [ ] Markdown 导出与 Obsidian 双向同步
- [ ] 移动端 App
- [ ] 正式产品命名与品牌
