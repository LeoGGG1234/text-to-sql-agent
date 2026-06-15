# 数据问答 Agent · Text-to-SQL Data Q&A Agent

> 用自然语言查询企业数据库 —— Agent 自动生成 PostgreSQL、在**只读沙箱**中安全执行、自我纠错，并把结果可视化。

一个面向企业数据分析场景的 AI Agent：业务人员用中文/英文提问（"上季度营收最高的 5 个产品？"），Agent 生成 SQL、安全执行、画成图表，并给出自然语言结论。

**核心看点是工程安全性**：LLM 生成的 SQL 经过三层纵深防御，保证永远只能读、不能写、不能拖垮数据库。

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
只读零售数据库 (Neon Postgres · retail_readonly 角色)
```

## 🛡️ SQL 安全层（项目核心）

LLM 生成的 SQL 默认不可信。本项目用**三层纵深防御**确保它永远只能安全地读：

| 层 | 机制 | 防住什么 |
|----|------|----------|
| **1. 数据库角色** | `retail_readonly` 角色只有 `SELECT` 授权，`REVOKE` 掉所有写权限 | 即使前两层全部失效，数据库本身拒绝任何写操作 |
| **2. AST 校验** | `node-sql-parser` 解析成 AST：必须是单条 `SELECT`，拒绝多语句/注释/`INTO`/系统表/危险函数，并强制注入 `LIMIT 1000` | 注入、写操作、数据泄露、拖库 |
| **3. 语句超时** | 角色级 `statement_timeout = 5s` + JS 侧超时兜底 | 笛卡尔积、慢查询拖垮数据库 |

校验逻辑在 [`src/lib/sql-validator.ts`](src/lib/sql-validator.ts)，执行在 [`src/lib/sql-executor.ts`](src/lib/sql-executor.ts)，覆盖 **34 个单元测试**（写操作/DDL/注入/超长 LIMIT 全部验证被拒）。

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

# 3. 初始化 app 库（auth/chat 表）
npx drizzle-kit push

# 4. 种子零售演示库（建表 + 数据 + 只读角色）
RETAIL_ADMIN_DATABASE_URL=postgresql://... npm run seed
#    完成后把输出的 retail_readonly 连接串填入 RETAIL_DATABASE_URL

# 5. 启动
npm run dev          # → http://localhost:3000
```

## 🧪 测试与评测

```bash
npm test             # 43 个单元测试（SQL 安全层 + Eval 指标）
npm run typecheck    # tsc --noEmit
npm run eval         # 端到端：20 个 NL→SQL 用例，输出执行准确率报告
```

Eval 用例覆盖 5 个类别（simple / aggregation / join / time_series / multi_step），中英双语。指标：**执行准确率**（生成 SQL 的结果集与参考答案比对）、**有效率**、**Schema 遵循度**。

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
