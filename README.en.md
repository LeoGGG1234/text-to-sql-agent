# Secure Multi-Tenant Text-to-SQL Agent

[简体中文](README.md) · **English**

[![CI](https://github.com/LeoGGG1234/text-to-sql-agent/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/LeoGGG1234/text-to-sql-agent/actions/workflows/ci.yml)
[![Live Demo](https://img.shields.io/badge/Live_Demo-Vercel-000000?logo=vercel)](https://text-to-sql-agent-staging.vercel.app)
[![Next.js 15](https://img.shields.io/badge/Next.js-15-000000?logo=nextdotjs)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

> Ask business questions in natural language. The agent generates PostgreSQL, executes it through a read-only security boundary, self-corrects bounded failures, and visualizes the result.

This is an end-to-end AI application for querying relational data in English or Chinese. Its main engineering focus is not merely producing plausible SQL: it treats model-generated SQL as untrusted code and enforces resource ownership, tenant-scoped table access, read-only execution, query limits, and measurable answer quality.

**[Live Demo](https://text-to-sql-agent-staging.vercel.app)** · **[GitHub Actions](https://github.com/LeoGGG1234/text-to-sql-agent/actions/workflows/ci.yml)** · **[Engineering Case Study](docs/PORTFOLIO_CASE_STUDY.md)**

![Text-to-SQL Agent live demo](docs/assets/demo-home.jpg)

## Try it in 30 seconds

The live demo supports isolated guest sessions with no sign-up required. Try:

- `Which five products generated the most revenue?`
- `Show the monthly sales trend for 2025.`
- `What share of sales came from each region?`

The UI exposes the SQL tool trace, result table, explanation, and chart. Guests, conversations, and uploaded data sources are isolated by ownership checks.

## Highlights

- **Natural language to PostgreSQL** — bilingual business questions, schema-aware SQL generation, execution, and explanation.
- **Defense-in-depth SQL execution** — ownership checks, a physical-table allowlist, AST validation, hardened read-only roles, a 1,000-row cap, and a 5-second timeout.
- **Bounded self-correction** — structured error codes guide schema lookup and SQL rewriting without infinite retry loops.
- **User-owned data** — CSV/XLSX upload, type inference, data-quality analysis, paginated preview, and conversation-level data-source binding.
- **Automatic visualization** — bar, line, and pie charts rendered from tool results with Recharts.
- **Multi-provider routing** — DeepSeek, OpenAI, Anthropic, Gemini, and OpenRouter through the Vercel AI SDK.
- **Execution-based evals** — generated and reference SQL are executed against the same database and their result sets are compared.

## System flow

```text
User question (English / Chinese)
    ↓
Next.js chat UI (streaming responses + tool traces)
    ↓
/api/chat
    ├── Better Auth / isolated Guest identity
    ├── conversation ownership check
    ├── data-source ownership check
    ├── provider selection and rate limit
    └── schema resolved from the authorized data source
    ↓
streamText (maxSteps: 5)
    ├── runSql      → validate and execute one read-only SELECT
    ├── getSchema   → reload tables, columns, and relationships
    └── renderChart → return a bar / line / pie chart specification
    ↓
Authorized data source
    ├── Retail demo database (retail_readonly)
    └── Uploaded table (userdata_readonly + physical-table allowlist)
```

## Security model

Model-generated SQL is untrusted. The project applies separate controls at the resource, query, and database boundaries.

| Boundary | Control | Risk contained |
|----------|---------|----------------|
| Conversation | Every read and update is scoped by `id + userId` | Access through a known conversation ID |
| Data source | Ownership-aware lookup before binding and every later reuse | Binding or querying another user's upload |
| Tenant SQL | The authorized data source produces a physical-table allowlist | Reading a neighboring table in the shared `userdata` schema |
| SQL AST | Exactly one `SELECT`; per-operation `tableList` validation; system tables, dangerous functions, comments, multiple statements, and `SELECT INTO` are rejected | Injection and write-capable SQL, including data-modifying CTEs |
| Resource usage | AST-injected 1,000-row limit plus a 5-second statement timeout | Unbounded result sets and expensive queries |
| PostgreSQL | Hardened `retail_readonly` / `userdata_readonly` roles with target-table `SELECT` only | An application-validator bypass becoming a write primitive |

The validator is implemented in [`src/lib/sql-validator.ts`](src/lib/sql-validator.ts), and execution is implemented in [`src/lib/sql-executor.ts`](src/lib/sql-executor.ts).

### Adversarial bug found during development

The first validator checked only `stmt.type === 'select'`. PostgreSQL data-modifying CTEs such as `WITH t AS (UPDATE ... RETURNING *) SELECT * FROM t` still present a top-level `SELECT`, so that check was insufficient. The fix validates every operation reported in `tableList`, while the database role remains the final enforcement layer. Regression tests preserve the finding.

## Bounded self-correction

`runSql` returns structured failures that map to explicit recovery actions inside the same tool-call budget:

| Error | Recovery action |
|-------|-----------------|
| `UNKNOWN_COLUMN` | Call `getSchema`, then rewrite with the real column name |
| `SYNTAX_ERROR` | Simplify and correct the query |
| `TIMEOUT` | Narrow the query with filters or limits |
| `VALIDATION_ERROR` | Rewrite the request as one allowed `SELECT` |

The agent stops after three consecutive SQL failures. A successful query resets the failure budget.

## Data sources

The built-in retail demo contains six related tables and roughly 25,000 deterministic synthetic rows:

`customers` · `categories` · `regions` · `products` · `orders` · `order_items`

Users can also upload CSV or Excel files. The upload path:

1. parses and normalizes column names;
2. infers useful numeric/date cast hints while storing raw cells as text;
3. computes data-quality signals;
4. creates an isolated physical table;
5. grants the runtime role `SELECT` on that table only;
6. binds the owned data source to a conversation after authorization.

Default upload limits are 80 MB and 200,000 rows and can be configured through environment variables.

## Eval-driven iteration

The eval runner sends 20 bilingual questions through the real `/api/chat` route, extracts the SQL actually issued by `runSql`, executes generated and reference SQL against the same read-only retail database, and compares result sets.

| Prompt | Validity | Exact execution accuracy | Schema adherence |
|--------|----------|--------------------------|------------------|
| v2 | 100% | 40% | 100% |
| v4 (current default) | 100% | 60% | 100% |

Failure analysis found repeated result-shape errors: singular questions returning Top-N rows, scalar questions adding breakdowns, and unrequested filters. The v4 prompt improved exact execution accuracy by 20 percentage points in one same-model 20-case snapshot without reducing validity or schema adherence.

- [v2 report](eval/report-deepseek-2026-08-15T11-35-33-177Z.md) / [raw JSON](eval/results-deepseek-2026-08-15T11-35-33-177Z.json)
- [v4 report](eval/report-deepseek-v4-2026-08-15T11-40-50-855Z.md) / [raw JSON](eval/results-deepseek-v4-2026-08-15T11-40-50-855Z.json)

> This is a small engineering regression snapshot, not a statistical-significance claim. The comparator is deliberately strict: a correct answer accompanied by extra contextual columns can still fail exact result-set matching.

Run an explicit prompt comparison with:

```bash
npm run eval -- --provider deepseek --prompt-variant v2
npm run eval -- --provider deepseek --prompt-variant v4
```

## Verification evidence

| Gate | Current evidence |
|------|------------------|
| Unit and regression tests | 202 passing tests across 18 files; 61 focus on the SQL validator |
| TypeScript | `tsc --noEmit` passes |
| ESLint | Non-interactive `eslint . --max-warnings=0` passes |
| Production build | Next.js production build passes |
| Security integration | [2/2 passing in GitHub Actions](https://github.com/LeoGGG1234/text-to-sql-agent/actions/runs/31883750479) against a dedicated disposable Neon database |
| Deployment readiness | Guest migration, role attributes, schema privileges, and SELECT-only table grants pass against staging |

## Run locally

Requirements: Node.js 22+, npm, Neon Postgres, and at least one supported model-provider API key.

```bash
npm install
cp .env.example .env.local
```

Configure the required values documented in [`.env.example`](.env.example):

- `DEEPSEEK_API_KEY` or another supported provider key;
- `DATABASE_URL` for authentication, conversations, and application metadata;
- `RETAIL_DATABASE_URL` using the generated `retail_readonly` role;
- `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`;
- `USERDATA_DATABASE_URL` and `USERDATA_READONLY_PASSWORD` when uploads are enabled.

Initialize the application database and seed the retail demo with an admin-only connection:

```bash
npx drizzle-kit migrate
RETAIL_ADMIN_DATABASE_URL=postgresql://... npm run seed
npm run dev
```

Quality commands:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

## Deployment and database checks

Operational scripts require explicit target variables and intentionally ignore the generic application database variable:

```bash
HARDEN_DATABASE_URL=postgresql://... \
USERDATA_READONLY_PASSWORD=replace-with-a-strong-random-password \
npm run db:harden-userdata

CHECK_DATABASE_URL=postgresql://... npm run db:check
```

Security integration tests must use a dedicated disposable database:

```bash
INTEGRATION_DATABASE_URL=postgresql://... \
ALLOW_DESTRUCTIVE_INTEGRATION=true \
npm run test:integration
```

Guest cleanup is dry-run by default and requires both an explicit target and a confirmation token before deletion:

```bash
CLEANUP_DATABASE_URL=postgresql://... npm run guest:cleanup

CLEANUP_DATABASE_URL=postgresql://... \
CONFIRM_GUEST_CLEANUP=DELETE_EXPIRED_GUEST_DATA \
npm run guest:cleanup -- --execute
```

## Technology

- **Frontend:** Next.js 15 App Router, React 19, Tailwind CSS 4, Recharts
- **Agent:** Vercel AI SDK 4, streaming `streamText`, bounded multi-step tool use
- **Security:** Better Auth, `node-sql-parser`, ownership helpers, physical-table allowlists, PostgreSQL read-only roles and timeouts
- **Data:** Neon Serverless Postgres, Drizzle ORM, CSV/XLSX ingestion
- **Quality:** Vitest, TypeScript strict mode, ESLint, execution-based evals, GitHub Actions

## Current limitations

- Exact execution accuracy is 60% in the current 20-case snapshot; time-series representation and multi-step semantics remain the largest eval gaps.
- The eval harness creates application conversations and does not yet provide deterministic cleanup for a dedicated eval identity.
- Rate limiting is process-local rather than distributed.
- The repository currently has no explicit open-source license; all rights remain with the author unless a license is added.

---

Built independently by Leo as an AI application engineering portfolio project.
