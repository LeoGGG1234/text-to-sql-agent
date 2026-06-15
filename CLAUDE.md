# Text-to-SQL Data Q&A Agent

自然语言查询零售数据库的 AI Agent。用户提问 → Agent 生成 PostgreSQL → 只读安全执行 → 自动可视化 + 自然语言结论。

派生自 `balatro-agent`（复用其 auth / db / providers / rate-limit / chat UI 基础设施）。

## Commands

```bash
npm run dev          # 启动 dev server (localhost:3000)
npm run build        # 生产构建
npm test             # Vitest 单元测试（SQL 安全层 + Eval 指标）
npm run typecheck    # tsc --noEmit
npm run seed         # 种子零售演示库（需 RETAIL_ADMIN_DATABASE_URL）
npm run eval         # 端到端 SQL 准确率评测（需 dev server + RETAIL_DATABASE_URL）
```

## Architecture

- `src/app/api/chat/route.ts` — 主 Agent 端点：auth → 限流 → streamText(maxSteps:5) + 3 工具
- `src/tools/` — runSql（核心，带 retry 计数）/ getSchema / renderChart
- `src/lib/sql-validator.ts` — **AST 校验层**（node-sql-parser），项目安全核心
- `src/lib/sql-executor.ts` — 只读执行 + 错误分类（结构化 code 供自我纠错）
- `src/lib/schema-description.ts` — 静态 schema（单一事实源：prompt 注入 + getSchema + 种子参考）
- `src/lib/prompts.ts` — 3 个 prompt 变体，运行时注入 schema
- `src/components/chat/chart-card.tsx` — Recharts 可视化
- `scripts/seed-retail-db.ts` — faker 生成 6 表数据 + 创建只读角色
- `eval/` — test-cases.json（20 例）+ metrics.ts（结果集比对）+ run-eval.ts

## 三层 SQL 安全防御（不可破坏）

1. **DB 角色** `retail_readonly`：仅 SELECT 授权 + `statement_timeout=5s`
2. **AST 校验**：单条 SELECT、拒绝写/DDL/注释/多语句/系统表、强制 LIMIT 1000
3. **JS 超时兜底**

修改 SQL 相关代码后必须 `npm test` 确保 34 个安全测试全绿。

## Key Conventions

- TypeScript strict，禁止 `any`（route.ts 持久化层除外，已有注释说明）
- `schema-description.ts` 与 `scripts/seed-retail-db.ts` 的列定义必须保持同步
- 环境变量：`DATABASE_URL`（app 库）与 `RETAIL_DATABASE_URL`（只读演示库）严格分开
- 默认 provider 是 DeepSeek；Eval 跑 `--provider deepseek`
