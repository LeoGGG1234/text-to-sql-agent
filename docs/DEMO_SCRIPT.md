# 90-second demo script

Use one intentionally dirty CSV/XLSX with whitespace, `N/A`, currency-formatted numerics, one year-first date, one ambiguous date, and an exact duplicate.

1. **0–15s — Upload:** enter as an isolated Guest, upload the file, and open its schema/quality profile.
2. **15–30s — Inspect:** show semantic types, missing/type-mismatch badges, duplicate count, and paginated rows.
3. **30–50s — Staleness:** edit one cell, point out the stale badge, run Re-profile, and show that current data—not the upload snapshot—is measured.
4. **50–70s — Clean safely:** open Cleaning Policy, select Standard, show the structured steps, affected rows/cells, parse failures, and before/after samples. Apply only after the confirmation prompt.
5. **70–90s — Analyze:** bind the cleaned source to the conversation and ask one aggregation question. Show the generated SQL, tool result, explanation, and the chart footer that identifies its source result and columns.

Narration anchor: “The LLM can recommend and query, but it cannot freely mutate data. Cleaning is deterministic, previewed, revision-checked, and committed transactionally.”
