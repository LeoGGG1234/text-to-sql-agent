# 数据问答 Agent · Text-to-SQL Data Q&A Agent

**简体中文** · [English](README.en.md)

[![CI](https://github.com/LeoGGG1234/text-to-sql-agent/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/LeoGGG1234/text-to-sql-agent/actions/workflows/ci.yml)
[![Live Demo](https://img.shields.io/badge/Live_Demo-Vercel-000000?logo=vercel)](https://text-to-sql-agent-staging.vercel.app)
[![Next.js 15](https://img.shields.io/badge/Next.js-15-000000?logo=nextdotjs)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

> 用自然语言查询企业数据库 —— Agent 自动生成 PostgreSQL、在**只读沙箱**中安全执行、自我纠错，并把结果可视化。

一个面向企业数据分析场景的 AI Agent：业务人员用中文/英文提问（"上季度营收最高的 5 个产品？"），Agent 生成 SQL、安全执行、画成图表，并给出自然语言结论。

**核心看点是工程安全性**：LLM 生成的 SQL 默认不可信；应用用三层纵深防御把执行约束为只读，并限制慢查询与跨数据源访问。

**[在线体验](https://text-to-sql-agent-staging.vercel.app)** · **[查看 CI](https://github.com/LeoGGG1234/text-to-sql-agent/actions/workflows/ci.yml)** · **[工程案例](docs/PORTFOLIO_CASE_STUDY.md)**

![Text-to-SQL Agent 在线 Demo](docs/assets/demo-home.jpg)

## 🎯 30 秒体验

打开在线 Demo 后，无需注册即可使用隔离的匿名会话。可以直接尝试：

- `营收最高的 5 个产品是哪些？`
- `2025 年每月的销售趋势如何？`
- `各个地区的销售额占比是多少？`

Agent 会展示实际执行的 SQL、查询结果和图表；每个匿名访客、会话和上传数据源都经过 ownership 校验与租户隔离。

---

## ✨ 功能

- 🗣️ **自然语言 → SQL**：中英双语提问，自动生成 PostgreSQL 查询
- 🛡️ **三层 SQL 安全防御**：只读角色 + AST 校验 + 语句超时（详见下）
- 🔁 **自我纠错**：SQL 出错时，Agent 读取结构化错误码、查 schema、自动重写重试
- 📊 **自动可视化**：Agent 根据数据自动选择柱状图 / 折线图 / 饼图（Recharts）
- 🔀 **多模型路由**：DeepSeek / OpenAI / Anthropic / Gemini / OpenRouter 运行时切换
- 📈 **Eval 评测体系**：以"执行准确率"（结果集比对）衡量 SQL 正确性，而非关键词匹配

---

## 🏗️ 架构

```
用户提问（中/英）
    ↓
Next.js Chat UI (streaming + 工具卡片)
    ↓
/api/chat  ── Auth (Better Auth + Guest) · Rate Limit · Provider 路由
    ↓
streamText (maxSteps: 5)  +  3 Tools
    ├── runSql      → 校验 + 只读执行 SELECT，返回结构化结果/错误
    ├── getSchema   → 返回库结构（供 LLM 自查/纠错）
    └── renderChart → 输出图表 spec（前端 Recharts 渲染）
    ↓
已授权数据源
    ├── 零售 Demo (Neon Postgres · retail_readonly)
    └── 用户上传表 (userdata schema · userdata_readonly + table allowlist)
```

## 🛡️ SQL 安全层（项目核心）

LLM 生成的 SQL 默认不可信。本项目用**三层纵深防御**约束其只读执行，并让数据库权限成为最终防线：

| 层 | 机制 | 防住什么 |
|----|------|----------|
| **1. 数据库角色** | `retail_readonly` / `userdata_readonly` 角色只有目标表的 `SELECT` 授权，并撤销高权限与 schema 创建权限 | 即使应用校验失效，数据库仍拒绝未授权写操作 |
| **2. AST 校验** | `node-sql-parser` 解析成 AST：必须是单条 `SELECT`，且**逐操作校验 `tableList`**（防数据修改 CTE 绕过），拒绝多语句/注释/`SELECT INTO`/系统表/危险函数，并强制注入 `LIMIT 1000` | 注入、写操作（含 CTE 内写）、数据泄露、拖库 |
| **3. 语句超时** | 角色级 `statement_timeout = 5s` + JS 侧超时兜底 | 笛卡尔积、慢查询拖垮数据库 |

校验逻辑在 [`src/lib/sql-validator.ts`](src/lib/sql-validator.ts)，执行在 [`src/lib/sql-executor.ts`](src/lib/sql-executor.ts)。仓库当前共有 **202 个单元/回归测试**，其中 **61 个**聚焦 SQL validator（写操作/DDL/注入/多语句/数据修改 CTE 绕过/LIMIT 边界等）。另有 2 个连接一次性 Postgres 的安全集成测试，验证 Guest/ownership transfer 和物理表 allowlist。

> **一个真实的对抗性发现**：最初的校验只判断 `stmt.type === 'select'`，但 PostgreSQL 的数据修改 CTE（`WITH t AS (UPDATE ... RETURNING *) SELECT * FROM t`）顶层仍报告为 `select`，可绕过该检查。修复方式是逐一校验 `tableList` 中每个操作都是 `select`，并补上回归测试锁死。这也印证了第 1 层只读角色作为纵深防御的价值——校验层被绕过时数据库本身仍会拒绝写入。

## 🔁 自我纠错

`runSql` 失败时返回结构化错误码，Agent 在同一 `maxSteps` 预算内自动恢复：

| 错误码 | Agent 的恢复动作 |
|--------|------------------|
| `UNKNOWN_COLUMN` | 调 `getSchema` 查正确列名 → 重写 |
| `SYNTAX_ERROR` | 简化查询 → 重试 |
| `TIMEOUT` | 加 `WHERE` / `LIMIT` 缩小范围 → 重试 |
| `VALIDATION_ERROR` | 改写为单条 SELECT |

重试上限 3 次，避免无限循环。

---

## 🗃️ 演示数据库

零售销售场景，6 张表约 2.5 万行，覆盖 join / 聚合 / 时间序列 / 过滤四类分析查询：

`customers` · `categories` · `regions` · `products` · `orders` · `order_items`

由 [`scripts/seed-retail-db.ts`](scripts/seed-retail-db.ts) 用 faker 生成（确定性种子），并自动创建只读角色。

---

## 🚀 本地运行

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env.local
#    填入 DEEPSEEK_API_KEY、DATABASE_URL（app 库）、
#    RETAIL_ADMIN_DATABASE_URL（种子用）、BETTER_AUTH_SECRET

# 3. 初始化或迁移 app 库（auth/chat 表）
npx drizzle-kit migrate

# 4. 种子零售演示库（建表 + 数据 + 只读角色）
RETAIL_ADMIN_DATABASE_URL=postgresql://... npm run seed
#    完成后把输出的 retail_readonly 连接串填入 RETAIL_DATABASE_URL

# 5. 启动
npm run dev          # → http://localhost:3000
```

## 🧪 测试与评测

```bash
npm test             # 单元/回归测试（不连接外部数据库）
npm run typecheck    # tsc --noEmit
npm run eval         # 端到端：20 个 NL→SQL 用例，输出执行准确率报告
```

Eval 用例覆盖 5 个类别（simple / aggregation / join / time_series / multi_step），中英双语。指标：**执行准确率**（生成 SQL 的结果集与参考答案比对）、**有效率**、**Schema 遵循度**。

一次 20-case、同模型的 prompt A/B snapshot（2026-08-15）中，精确结果集执行准确率从默认 v2 的 **40%** 提升到 v4 的 **60%**，Validity 和 Schema adherence 都保持 **100%**。v4 因此成为当前默认 prompt；原始结果与失败用例均保留，便于复核，而不是只展示汇总数字：

- [v2 报告](eval/report-deepseek-2026-08-15T11-35-33-177Z.md) / [原始 JSON](eval/results-deepseek-2026-08-15T11-35-33-177Z.json)
- [v4 报告](eval/report-deepseek-v4-2026-08-15T11-40-50-855Z.md) / [原始 JSON](eval/results-deepseek-v4-2026-08-15T11-40-50-855Z.json)

> 这是一次小样本工程回归，不是统计显著性结论。当前严格评分会把“正确答案 + 额外上下文字段”判为不完全匹配，因此 60% 不等同于人工语义正确率；项目刻意保留这一保守口径。

### 当前验证证据

| 验证项 | 当前状态 | 说明 |
|--------|----------|------|
| Unit / regression tests | 202 passed | 不连接外部数据库 |
| TypeScript | passed | `tsc --noEmit` |
| ESLint | passed | `eslint . --max-warnings=0`，可在 CI 非交互运行 |
| Production build | passed | Next.js production build |
| Security integration | [2 passed（GitHub Actions）](https://github.com/LeoGGG1234/text-to-sql-agent/actions/runs/31883750479) | 使用独立 disposable Neon 数据库；验证 Guest/ownership transfer 与物理表 allowlist |
| Deployment readiness | passed（staging） | 检查 Guest migration、只读角色属性及 userdata schema/table 权限 |

> `eval/` 中保留的 2026-06 报告是早期基线，不代表当前 hardened 版本。运行 `npm run eval` 会生成带时间戳的 JSON 与 Markdown 报告，避免用旧指标包装新实现。可用 `--prompt-variant v2` 或 `--prompt-variant v4` 做显式 A/B。

### 安全部署验证

迁移后先配置/加固 userdata 只读角色，再执行 readiness gate。这两个命令都要求显式目标，不会回退读取 `DATABASE_URL`：

```bash
HARDEN_DATABASE_URL=postgresql://... \
USERDATA_READONLY_PASSWORD=replace-with-a-strong-random-password \
npm run db:harden-userdata

CHECK_DATABASE_URL=postgresql://... npm run db:check
```

真实认证、Guest 隔离、ownership transfer 和 SQL allowlist 集成测试只能指向一次性测试数据库：

```bash
INTEGRATION_DATABASE_URL=postgresql://... \
ALLOW_DESTRUCTIVE_INTEGRATION=true \
npm run test:integration
```

匿名数据清理默认为 dry-run，并要求显式数据库目标。实际删除还需要 `--execute` 和确认口令；旧共享 Guest 只有加 `--include-legacy` 才会进入候选：

```bash
CLEANUP_DATABASE_URL=postgresql://... npm run guest:cleanup

CLEANUP_DATABASE_URL=postgresql://... \
CONFIRM_GUEST_CLEANUP=DELETE_EXPIRED_GUEST_DATA \
npm run guest:cleanup -- --execute
```

---

## 🛠️ 技术栈

**前端**：Next.js 15 (App Router) · React 19 · Tailwind v4 · Recharts
**Agent**：Vercel AI SDK v4 (`streamText` + `maxSteps` 多轮工具调用)
**安全**：node-sql-parser (AST 校验) · Postgres 只读角色 · 语句超时
**数据**：Neon Serverless Postgres · Drizzle ORM
**认证**：Better Auth (email/password + Dev/Guest 模式)
**质量**：Vitest · 多供应商 Eval 框架

---

*作者：Leo · AI 应用工程师*
