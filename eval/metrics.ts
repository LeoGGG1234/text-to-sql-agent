/**
 * Eval metrics for the Text-to-SQL agent.
 *
 * Unlike a keyword-match eval, correctness here means the generated SQL
 * returns the SAME result set as the reference query. We therefore execute
 * both and compare.
 *
 * Three metrics per test case:
 *   - validity:   did the agent produce SQL that parses + executes? (0/1)
 *   - execAccuracy: does the agent's result set match the reference? (0/1)
 *   - schemaAdherence: do all referenced tables/columns exist? (0/1)
 *                      (approximated as "executed without UNKNOWN_COLUMN")
 */

export interface CaseScore {
  validity: number;
  execAccuracy: number;
  schemaAdherence: number;
}

/**
 * Compare two result sets for equality, order-insensitively, with a numeric
 * tolerance for floating-point money columns.
 *
 * Rows are normalized to sorted key/value strings and multiset-compared, so
 * row order and column order do not matter — only the data does.
 */
export function resultSetsMatch(
  a: Record<string, unknown>[],
  b: Record<string, unknown>[],
  tolerance = 0.01,
): boolean {
  if (a.length !== b.length) return false;
  if (a.length === 0) return true;

  // Build multisets of normalized VALUE bags (ignore column names, since the
  // agent may alias differently than the reference).
  const bagA = a.map((r) => valueBag(r)).sort();
  const bagB = b.map((r) => valueBag(r)).sort();

  for (let i = 0; i < bagA.length; i++) {
    if (!bagsClose(bagA[i], bagB[i], tolerance)) return false;
  }
  return true;
}

function valueBag(row: Record<string, unknown>): string[] {
  return Object.values(row)
    .map((v) => normValue(v))
    .sort();
}

function normValue(v: unknown): string {
  if (v === null || v === undefined) return '∅';
  if (typeof v === 'number') return roundForCompare(v);
  // Postgres returns numerics as strings via the HTTP driver.
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) {
    return roundForCompare(Number(v));
  }
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim().toLowerCase();
}

function roundForCompare(n: number): string {
  // Round to 2 decimals so 1234.5 and 1234.50 and 1234.499 compare equal.
  return (Math.round(n * 100) / 100).toFixed(2);
}

function bagsClose(a: string[], b: string[], tolerance: number): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const na = Number(a[i]);
    const nb = Number(b[i]);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) {
      const denom = Math.max(Math.abs(na), Math.abs(nb), 1);
      if (Math.abs(na - nb) / denom > tolerance) return false;
    } else if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

export function aggregate(scores: CaseScore[]) {
  const n = scores.length || 1;
  const sum = (sel: (s: CaseScore) => number) =>
    scores.reduce((acc, s) => acc + sel(s), 0);
  return {
    validityRate: sum((s) => s.validity) / n,
    execAccuracy: sum((s) => s.execAccuracy) / n,
    schemaAdherence: sum((s) => s.schemaAdherence) / n,
  };
}
