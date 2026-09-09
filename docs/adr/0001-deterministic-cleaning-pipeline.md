# ADR 0001: Deterministic cleaning pipeline

Status: Accepted (2026-09-08)

## Context

Uploaded data can contain whitespace, NULL markers, currency strings, percentages, ambiguous dates, and duplicate rows. Letting an LLM freely generate and execute mutation SQL would combine probabilistic planning with destructive data access and make preview, testing, replay, and authorization difficult to defend.

## Decision

The product stores an explicit, versionable cleaning recipe. A pure TypeScript executor applies only allowlisted operations to ownership-validated columns. Preview loads the current bounded dataset, computes an impact summary and representative cell diffs, and records the recipe against the current `dataRevision`. Apply re-locks the owned data source, rejects a stale revision, recomputes the recipe, replaces rows and updates metadata in one transaction, then stores before/after quality profiles.

Presets are recipe generators, not hidden execution modes. Ambiguous dates are preserved. Aggressive numeric parse-to-NULL behavior is visible in the generated recipe. The Agent may recommend a recipe in a future slice, but it does not own the mutation executor.

## Alternatives considered

- LLM-generated SQL mutations: lower initial code volume, but unsafe, difficult to replay, and hard to test.
- Per-cell updates: simple but slow and likely to exceed serverless limits for large cleanups.
- Event sourcing and perfect undo: powerful, but disproportionate for the current portfolio-scale product.
- Copy-on-write snapshots: a credible next step for undo, but increases storage and lifecycle complexity.

## Consequences

- Destructive changes require preview and explicit confirmation.
- Recipes and the executor can be unit-tested without a model or database.
- Revision checks prevent applying a preview to changed data.
- The recent-run dashboard reports only applied-run totals and keeps each stored recipe, impact summary, revision transition, and validation result inspectable.
- Apply is atomic, but currently bounded to 50,000 rows and has history without one-click undo.
- The deployment migration must precede the application build; `db:check` now verifies the required table and columns.

## Interview defense

Key discussion points are the probabilistic/deterministic boundary, optimistic concurrency, transactional replacement, why stale profiling is unsafe context for an Agent, and why bounded full-table processing was selected before introducing background jobs.
