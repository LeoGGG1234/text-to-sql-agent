# Reproducible cleaning demo

Use [`dirty-sales-orders.csv`](dirty-sales-orders.csv) to exercise the real upload → profile → clean → validate → analyze flow. The file is intentionally small enough to inspect manually and contains only synthetic data.

## Frozen oracle

The repository test suite verifies these expectations against the production parser, profiler, type detector, and cleaning engine:

| Stage | Expected result |
|---|---|
| Upload | 16 rows, 10 business columns |
| Semantic types | `amount` and `discount_rate` are numeric; `order_date` is date; `is_priority` is boolean |
| Raw profile | 0 exact duplicate rows; 2 non-matching amount values; 3 non-matching discount values; 1 invalid and 1 ambiguous date; 1 invalid boolean plus 1 NULL-like boolean marker |
| Standard preview | 12 affected rows, 20 affected cells, 1 removed duplicate, 2 generated database NULLs, 5 unresolved parse failures |
| Standard apply | 15 rows remain |
| Deliberately unresolved | `not-a-number`, `bad%`, `09/07/2026`, `2026-13-01`, and `UNKNOWN` remain unchanged for human review |
| Analysis query | Grouping by `status` returns `Won = 5`, `Open = 5`, `In Progress = 4`, `Lost = 1` |

The expected duplicate is not exact in the raw file: the first two `ORD-001` rows become equal only after whitespace, numeric, date, and boolean normalization. This makes the demo exercise rule composition and deletion evidence rather than a trivial pre-existing duplicate.

Suggested final question:

> Group orders by status, generate a bar chart, and explain the chart's data source. Run only the SQL needed for this task.

The chart should cite `query_1`, map `status` to the label axis and `order_count` (or the model's equivalent alias) to the value axis, and show 15 rows reconciled across the four groups.
