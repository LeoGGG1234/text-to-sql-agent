# 90-second demo script

Use the frozen synthetic fixture [`demo-data/dirty-sales-orders.csv`](demo-data/dirty-sales-orders.csv). Its executable oracle is documented in [`demo-data/README.md`](demo-data/README.md); do not substitute a hand-edited copy when recording evidence.

1. **0–15s — Upload:** enter as an isolated Guest, upload the file, and open its schema/quality profile.
2. **15–30s — Inspect:** show semantic types, missing/type-mismatch badges, duplicate count, and paginated rows.
3. **30–50s — Staleness:** edit one cell, point out the stale badge, run Re-profile, and show that current data—not the upload snapshot—is measured.
4. **50–70s — Clean safely:** open Cleaning Policy, select Standard, show the structured steps, affected rows/cells, parse failures, and before/after samples. Apply only after the confirmation prompt.
5. **70–90s — Analyze:** click **Analyze cleaned data** and ask: “Group orders by status, generate a bar chart, and explain the chart's data source. Run only the SQL needed for this task.” Show the generated SQL, the expected `5 / 5 / 4 / 1` result, the explanation, and the chart footer that identifies its source result and columns.

Narration anchor: “The LLM can recommend and query, but it cannot freely mutate data. Cleaning is deterministic, previewed, revision-checked, and committed transactionally.”

Acceptance anchor: Standard cleaning must leave 15 rows and report five unresolved parse failures. The final status counts must reconcile to 15; a polished but different answer is a failed demo, not an alternative interpretation.
