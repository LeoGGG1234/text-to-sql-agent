# Text-to-SQL Agent Eval Report

**Provider**: deepseek　**Model**: deepseek-v4-flash　**Prompt**: v4　**Date**: 2026-09-09T08:20:42.956Z
**Commit**: 6982ee6725bd7605e53a58c31ff55429acb4d476　**Dataset**: retail-v1 (848f171e9e5b)
**Source snapshot**: 5a3e3a2bd8e6　**Working tree dirty**: yes
**Run mode**: offline-rescore　**Source result**: eval/results-deepseek-v4-2026-09-09T08-00-40-981Z.json
**Evidence status**: post-run adjudication; this is not a prospective frozen-contract baseline.

## Overall

| Metric | Value |
|--------|-------|
| Tests | 50 |
| Scored tests | 48 |
| Diagnostic / excluded tests | 2 |
| SQL validity (all tests) | 100.0% |
| Replay execution success (all tests) | 100.0% |
| SQL result accuracy | 97.9% |
| Schema adherence (all tests) | 100.0% |
| Application tool success (all tests) | 100.0% |
| Answer completeness (all tests) | 100.0% |
| End-to-end task success | 97.9% |

## By category

| Category | Scored tests | SQL result accuracy | Task success |
|----------|-------|---------------------|--------------|
| simple | 8 | 100% | 100% |
| aggregation | 8 | 100% | 100% |
| join | 10 | 100% | 100% |
| time_series | 9 | 100% | 100% |
| multi_step | 8 | 88% | 88% |
| null_semantics | 2 | 100% | 100% |
| edge_case | 3 | 100% | 100% |

## Diagnostic / excluded cases

- **multi_01**: Return rate is ambiguous without specifying orders, line items, or units. Retained as a diagnostic case only.
- **multi_03**: Items is ambiguous between line-item rows and summed unit quantity. Retained as a diagnostic case only.

## Failed / incomplete scored cases

### multi_02 — multi_step
- **Q**: 哪个品牌的利润率最高？利润 = 售价 - 成本。
- **Failure category**: RESULT_VALUE_OR_SHAPE_MISMATCH
- **Generated SQL**: `SELECT p.brand,
       SUM(oi.line_total) AS total_revenue,
       SUM(oi.quantity * p.cost) AS total_cost,
       (SUM(oi.line_total) - SUM(oi.quantity * p.cost)) / SUM(oi.line_total) AS profit_margin
FROM order_items oi
JOIN products p ON oi.product_id = p.product_id
GROUP BY p.brand
ORDER BY profit_margin DESC
LIMIT 1;`
- **rows**: gen=1 ref=1
- **application tool / answer / finish**: 1 / 1 / stop
