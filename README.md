# Self-Service AI Data Workspace · Text-to-SQL Agent

**简体中文** · [English](README.en.md)

[![CI](https://github.com/LeoGGG1234/text-to-sql-agent/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/LeoGGG1234/text-to-sql-agent/actions/workflows/ci.yml)
[![Live Demo](https://img.shields.io/badge/Live_Demo-Vercel-000000?logo=vercel)](https://text-to-sql-agent-staging.vercel.app)
[![Next.js 15](https://img.shields.io/badge/Next.js-15-000000?logo=nextdotjs)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

> 上传、画像、清洗并用自然语言分析数据 —— Agent 在**只读安全边界**内生成和执行 PostgreSQL，并把结果解释和可视化。

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
- 📈 **Eval 评测体系**：分别衡量 SQL 结果正确性、应用内工具成功、最终回答完整性与端到端任务成功，而非关键词匹配
- 🧹 **确定性数据清洗**：结构化 Recipe、三档透明预设、Dry Run Diff、显式确认、并发 revision 防护、清洗后验证与历史记录

---

## 🏗️ 架构

```
CSV / XLSX 上传
    ↓
Schema 推断 → 质量画像 → 预览 / 编辑
    ↓
Cleaning Recipe → Dry Run Diff → 显式 Apply → Validation
    ↓
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
| **1. 数据库角色** | `retail_readonly` / `userdata_readonly` 仅有业务表 `SELECT`，并撤销写入、高权限与 schema 创建权限；共享 `userdata_readonly` 不承担租户读隔离 | 即使应用校验失效，数据库仍拒绝写操作；跨租户读隔离由第 2 层物理表 allowlist 承担 |
| **2. AST 校验** | `node-sql-parser` 解析成 AST：必须是单条 `SELECT`，且**逐操作校验 `tableList`**（防数据修改 CTE 绕过），拒绝多语句/注释/`SELECT INTO`/系统表/危险函数，并强制注入 `LIMIT 1000` | 注入、写操作（含 CTE 内写）、数据泄露、拖库 |
| **3. 语句超时** | 角色级 `statement_timeout = 5s` + JS 侧超时兜底 | 笛卡尔积、慢查询拖垮数据库 |

校验逻辑在 [`src/lib/sql-validator.ts`](src/lib/sql-validator.ts)，执行在 [`src/lib/sql-executor.ts`](src/lib/sql-executor.ts)。仓库当前共有 **294 个单元/回归测试**，其中 **75 个**聚焦 SQL validator（写操作/DDL/注入/多语句/数据修改 CTE、XML 映射函数绕过与 LIMIT 边界等）。另有 3 个连接一次性 Postgres 的安全集成测试，验证 Guest/ownership transfer、物理表 allowlist 与清洗事务。

> **真实的对抗性发现**：最初的校验只判断 `stmt.type === 'select'`，但 PostgreSQL 的数据修改 CTE（`WITH t AS (UPDATE ... RETURNING *) SELECT * FROM t`）顶层仍报告为 `select`，可绕过该检查；修复方式是逐一校验 `tableList` 中每个操作。后续审查又发现 `query_to_xml_and_xmlschema` 等 XML 映射函数可把查询藏入字符串参数，使 AST 看不到被访问表；当前已拒绝完整 XML 映射函数族并加入嵌套/限定名回归。数据库只读角色仍是写操作的最终防线，但共享角色不能替代租户物理表 allowlist。

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

## 🧹 数据质量与清洗

上传数据源带有独立的 `dataRevision` 和画像状态。单元格编辑、增行和删行会在同一数据库事务中修改物理表与 metadata，同时把画像标记为 stale；重新画像通过 revision 乐观并发校验，避免把并发修改前算出的统计发布成最新结果。过期画像不会注入 Agent 提示词。

清洗执行边界为：

```text
Preset / Structured Recipe
    → 确定性 TypeScript Executor
    → 全表 Preview Diff
    → 用户显式确认
    → 事务 Apply
    → Before / After Validation + History
```

当前支持空白/全角字符规范化、可配置 NULL 标记、金额/千分位/百分比规范化、无歧义日期规范化、缺失值处理、精确或基于 Key 的去重。上传、清洗和导出统一限制为每个数据源 50,000 行，以控制当前 Serverless 实现的时间和内存边界。Cleaning Dashboard 汇总最近 20 次运行，并可展开检查 recipe、影响范围、数据 revision 与清洗前后验证；尚未实现一键 Undo。旧 `.xls` 因原解析依赖存在未修复安全公告而不再接受，请先另存为 `.xlsx` 或 CSV。

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
npm run eval -- --validate-only # 仅验证 Eval CLI 与 50 题契约，不连接数据库/模型
npm run typecheck    # tsc --noEmit
npm run eval         # 端到端：50 个 NL→SQL 用例，输出可追溯执行准确率报告
npm run eval -- --rescore eval/results-....json # 不调用模型；按当前契约重放已保存 SQL
npm run test:e2e     # Playwright：Guest 与画像/清洗 UI 闭环
```

Eval 扩展为 50 个中英双语用例，覆盖 simple / aggregation / join / time series / multi-step / NULL / edge case。生成 SQL 先经过生产 SQL validator，再与 reference SQL 在同一只读数据库执行。比较器默认要求数值精确相等、保留列位置；只有逐题契约明确声明时，才允许绝对数值容差、额外解释列、文本组合或月/季度等价表示。无法唯一确定业务口径的题目保留为 diagnostic case，但不进入主分数。报告分别记录 SQL 重放结果、应用内 `runSql` 结果、正常流结束后的最终解释及端到端任务成功，并保留 provider/model、prompt、commit SHA、源码快照 hash、dataset hash、延迟、tool steps、真实失败后重试数、token usage 与 failure category。

2026-09-09 的一次 DeepSeek `deepseek-v4-flash`、prompt v4、50-case 真实运行，在修订评测契约前得到 **74.0% raw strict result match / 74.0% task success**，SQL validity、replay execution、应用工具成功和最终回答完整性均为 **100%**。13 个 raw mismatch 的后续审查识别出 9 个表示层差异、1 个 reference SQL 的实体粒度错误、2 个指标歧义和 1 个明确模型错误。基于该审查形成的 v2 契约离线重评分为 **47/48（97.9%）**，另有 2 个 diagnostic case；因为契约是在查看本次输出后形成，该数字明确标记为 post-run adjudication，不能冒充预先冻结的独立基线：

- [50-case raw 报告](eval/report-deepseek-v4-2026-09-09T08-00-40-981Z.md) / [原始 JSON](eval/results-deepseek-v4-2026-09-09T08-00-40-981Z.json)
- [v2 post-run 重评分报告](eval/report-deepseek-v4-rescore-2026-09-09T08-20-43-025Z.md) / [重评分 JSON](eval/results-deepseek-v4-rescore-2026-09-09T08-20-43-025Z.json)

一次 20-case、同模型的 prompt A/B snapshot（2026-08-15）中，旧版比较器记录的结果集执行准确率从默认 v2 的 **40%** 提升到 v4 的 **60%**，Validity 和当时的 Schema-adherence proxy 都为 **100%**。旧版比较器使用约 1% 的全局相对数值容差，因此这组结果只作为 prompt 迭代的历史方向性证据；原始结果与失败用例均保留：

- [v2 报告](eval/report-deepseek-2026-08-15T11-35-33-177Z.md) / [原始 JSON](eval/results-deepseek-2026-08-15T11-35-33-177Z.json)
- [v4 报告](eval/report-deepseek-v4-2026-08-15T11-40-50-855Z.md) / [原始 JSON](eval/results-deepseek-v4-2026-08-15T11-40-50-855Z.json)

> 40% / 60% 是历史 20-case、旧比较器口径的 snapshot；74% 是 50-case 原始严格结构分数；97.9% 是看过失败后形成契约的离线重评分。下一次冻结契约后的独立运行，才适合作为新的 prospective baseline。

### 当前验证证据

| 验证项 | 当前状态 | 说明 |
|--------|----------|------|
| Unit / regression tests | 294 passed | 不连接外部数据库 |
| Browser E2E | 3 passed | Guest 入口、匿名升级入口与画像 → 清洗预览 → 显式 Apply |
| TypeScript | passed | `tsc --noEmit` |
| ESLint | passed | `eslint . --max-warnings=0`，可在 CI 非交互运行 |
| Production build | passed | Next.js production build |
| Security integration | 上次发布证据为 [2/2 passed（GitHub Actions）](https://github.com/LeoGGG1234/text-to-sql-agent/actions/runs/31883750479) | 扩展后的 3-case suite 加入真实清洗事务，将以下一次 CI 为准 |
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
