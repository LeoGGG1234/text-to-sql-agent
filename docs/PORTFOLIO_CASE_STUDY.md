# Text-to-SQL Agent — Engineering Case Study

## 1. Problem

Business users should be able to query relational data in Chinese or English without writing SQL. The difficult part is not generating plausible SQL; it is executing model-generated code without crossing tenant boundaries, mutating data, or hiding failures behind a polished chat response.

This project therefore treats every generated query as untrusted input and optimizes for three properties:

1. safe execution;
2. traceable agent behavior;
3. measurable answer quality.

## 2. User flow

1. A registered or isolated guest user starts a conversation.
2. The user selects the built-in retail demo or an owned CSV/XLSX data source, inspects its quality profile, previews a deterministic cleaning recipe before applying it, and can audit recent runs with recipe, impact, revision, and before/after validation details.
3. The chat route revalidates conversation and data-source ownership.
4. The model receives only the selected schema and calls `runSql`.
5. The SQL is parsed, allowlisted, limited, and executed with a read-only role and timeout.
6. Structured errors are returned to the model for bounded self-correction.
7. For an optional chart, the model selects a `runSql` result id and columns; the server resolves the real rows and constructs the chart spec before the UI renders it.

## 3. Security design

| Boundary | Control | Failure contained |
|----------|---------|-------------------|
| Authentication | Better Auth plus per-browser guest identity | Shared anonymous identity and cross-guest visibility |
| Conversation access | Every read and update is scoped by `id + userId` | Known-ID conversation takeover |
| Data-source access | Ownership-aware lookup before binding and reuse | Binding another user's uploaded table |
| Tenant SQL | Physical-table allowlist derived from the owned data source | Reading neighboring userdata tables |
| SQL execution | AST validation, one `SELECT`, row limit, dangerous-function/system-table rejection | Prompt injection and write/query abuse |
| Database | Hardened non-privileged login role with SELECT-only table grants | Validator bypass becoming a write primitive |
| Operations | Explicit target variables for migration, hardening, readiness, and cleanup | Accidentally running destructive scripts against the default database |

The key design choice is defense in depth: application ownership checks decide *whose* resource may be selected, the SQL allowlist decides *which physical table* may be queried, and PostgreSQL privileges remain the final write-enforcement layer. The uploaded-data runtime role is shared, so tenant read isolation deliberately depends on the physical-table allowlist rather than being attributed to the database role.

## 4. Agent reliability

`runSql` returns structured error codes such as `UNKNOWN_COLUMN`, `SYNTAX_ERROR`, `TIMEOUT`, and `VALIDATION_ERROR`. The system prompt maps each code to a bounded recovery action, while successful calls reset the consecutive-failure budget. This prevents both premature termination and infinite retry loops.

Successful SQL calls are also registered under request-local result ids. `renderChart` accepts only a result id and existing label/value columns; it cannot accept model-authored chart points. Oversized, truncated, missing-column, and non-numeric inputs fail explicitly instead of producing a plausible-looking partial chart.

A real uploaded-table incident exposed a second reliability issue: overlapping dirty-data categories were added together, producing an impossible headline total. The prompt now requires a deduplicated affected-row count and reconciliation of `dirty + clean = total` before answering.

## 5. Eval-driven iteration

The current eval runner sends 50 bilingual questions through the real `/api/chat` route, validates the SQL actually issued by the agent, and replays generated and reference SQL against the same read-only database. It separates SQL result correctness, successful in-application tool execution, final-answer completion, and end-to-end task success. Numeric comparison is exact by default; case-level contracts must explicitly permit tolerance, additional explanatory columns, joined text, or equivalent calendar-period representations. Ambiguous metrics remain diagnostic cases and are excluded from the primary score rather than being silently assigned one interpretation.

A controlled 2026-09-09 run with DeepSeek `deepseek-v4-flash` and prompt v4 completed all 50 cases with 100% SQL validity, replay execution, application tool success, and answer completion. Its pre-adjudication raw structural result/task score was 74.0%. Reviewing the 13 mismatches found nine representation differences, one reference-query entity-granularity error, two ambiguous metrics, and one clear model calculation error. The resulting v2 contract produced a 47/48 (97.9%) offline rescore with two diagnostic exclusions. Because that contract was written after inspecting the run, the rescore is labelled post-run adjudication and is not presented as a prospective independent baseline.

| Prompt | Validity | Historical execution accuracy | Schema-adherence proxy |
|--------|----------|--------------------------|------------------|
| v2 | 100% | 40% | 100% |
| v4 | 100% | 60% | 100% |

The v4 prompt was introduced after failure analysis showed repeated result-shape errors: singular questions returning Top-N rows, scalar questions adding breakdowns, and unrequested status filters. It improved the previous runner's execution-accuracy score by 20 percentage points in one same-model 20-case snapshot.

This result is intentionally reported with two caveats:

- 20 cases and one run are useful regression evidence, not statistical significance;
- the historical comparator used an approximately 1% global relative numeric tolerance, so the 40%/60% figures are not current strict-comparator scores;
- the current comparator is exact by default, so a correct value accompanied by an extra projected column still fails unless that individual case explicitly permits explanatory columns.

Raw reports, failed SQL, the post-run adjudication label, and the source-snapshot hash are retained under `eval/` for independent review. The next model run should use the frozen v2 contract without further case changes before its score is known.

## 6. Verification and deployment

The local/CI quality gate runs unit and regression tests, Playwright browser flows, TypeScript, ESLint, and a production build. Security integration tests use a disposable Postgres target because they apply migrations, create roles/tables, transfer ownership, exercise transactional cleaning, and clean up fixtures. Deployment readiness separately verifies the guest migration, data-quality migration, role attributes, schema privileges, and SELECT-only table grants against an explicit target.

The public staging deployment is available at <https://text-to-sql-agent-staging.vercel.app>.

## 7. Current limitations

- Security integration runs against a dedicated disposable Neon project in GitHub Actions; staging is deliberately not reused for destructive CI. The CI database remains an operational credential that must be rotated if exposed and reset if its schema drifts.
- The current 50-case run has a 74% raw structural score and a 97.9% post-run adjudicated score; neither should be substituted for a future prospective score under the now-frozen v2 contract.
- Cleaning is bounded to 50,000 rows per run and records history, but one-click undo is not implemented yet.
- Eval runs create application conversations; a future harness should use a clearly labelled eval identity and deterministic cleanup policy.
- Rate limiting is process-local and is not a substitute for a distributed production limiter.

## 8. Resume-ready summary

- Built and deployed a multi-provider Text-to-SQL agent with streaming tool calls, uploaded CSV/XLSX data sources, automated charts, and bounded SQL self-correction.
- Designed defense-in-depth execution with AST validation, per-resource physical-table allowlists, tenant ownership checks, hardened PostgreSQL read-only roles, timeouts, and explicit deployment readiness gates.
- Built an execution-based bilingual eval harness that separates SQL correctness from application completion, records reproducible source/dataset fingerprints, preserves a 74% raw 50-case run, and explicitly labels its 97.9% contract-aware rescore as post-run adjudication rather than inflating it into an independent baseline.
