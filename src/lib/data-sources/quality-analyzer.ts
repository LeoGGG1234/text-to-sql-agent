/**
 * Data quality analyzer — full-scan profiling of uploaded CSV/Excel data.
 *
 * Runs after pre-cleaning (trim) and semantic type detection, before INSERT.
 * All analysis is 100% full-scan — no sampling (max 10k rows, < 10ms in Node).
 *
 * Key outputs:
 *   Q1 — NULL-like values identified (converted to real NULL at INSERT).
 *   Q2 — Non-matching values vs detected semanticType.
 *   Q3 — Duplicate rows.
 *   Q4 — Whitespace trimmed (stats only, already cleaned).
 *   Q5 — Column length stats (min/max).
 */

import type {
  DiscoveredColumn,
  ColumnProfile,
  TableProfile,
  QualityProfile,
} from './types';
import { NULL_LIKE_VALUES } from './type-detector';

/** Max number of non-matching sample values to collect per column. */
const MAX_SAMPLES = 3;

/** Max distinct values to track for uniqueCount (caps memory on high-cardinality columns). */
const MAX_UNIQUE_SET = 100_000;

/** Fuzzy duplicate detection: top-N frequent values to compare per column. */
const FUZZY_TOP_N = 50;
/** Levenshtein similarity threshold for near-duplicate detection (0–1). */
const FUZZY_SIMILARITY_THRESHOLD = 0.88;
/** Maximum number of fuzzy duplicate example pairs to store. */
const FUZZY_MAX_SAMPLES = 3;
/** Length ratio filter: skip pairs where shorter/longer < this value. */
const FUZZY_LENGTH_RATIO = 0.8;
/** Max distinct values in the frequency map (caps memory for high-cardinality TEXT columns). */
const MAX_FREQ_MAP_SIZE = 10_000;

// ─── Semantic type pattern matching (mirrors type-detector.ts) ───

function matchesSemanticType(
  v: string,
  semanticType: DiscoveredColumn['semanticType'],
): boolean {
  const t = v.trim();
  switch (semanticType) {
    case 'NUMERIC':
      return /^-?\d+(\.\d+)?$/.test(t);
    case 'DATE':
      return [
        /^\d{4}-\d{2}-\d{2}$/,
        /^\d{1,2}\/\d{1,2}\/\d{4}$/,
        /^\d{1,2}\/\d{1,2}\/\d{2}$/,
        /^\d{4}\/\d{1,2}\/\d{1,2}$/,
        /^\d{1,2}-\d{1,2}-\d{4}$/,
      ].some((p) => p.test(t));
    case 'BOOLEAN':
      return ['true', 'false', 'yes', 'no', '0', '1', 'y', 'n'].includes(
        t.toLowerCase(),
      );
    default:
      return true; // TEXT — no type mismatch possible
  }
}

// ─── NULL-like detection ──────────────────────────────────────

function isNullLike(v: string): boolean {
  return NULL_LIKE_VALUES.has(v.trim());
}

// ─── Duplicate row detection ──────────────────────────────────

export function rowKey(row: string[]): string {
  // Join with U+0000 (null character) as delimiter.
  // Null bytes cannot appear in CSV/Excel data — Papa Parse strips them
  // from CSV, and XLSX stores cell values as XML where null is invalid.
  // This is ~20% smaller and faster than JSON.stringify for large datasets.
  return row.join('\x00');
}

// ─── Fuzzy duplicate detection ────────────────────────────────

/**
 * Compute Levenshtein similarity ratio (0–1) between two strings.
 * Uses single-row DP (O(min(m,n)) space).
 *
 * Returns 1.0 for identical strings, 0.0 when one string is empty.
 */
function levenshteinRatio(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;

  // a = shorter, b = longer.
  if (a.length > b.length) [a, b] = [b, a];

  const m = a.length;
  const n = b.length;

  let prev = Array.from({ length: m + 1 }, (_, i) => i);
  let curr = new Array<number>(m + 1);

  for (let j = 1; j <= n; j++) {
    curr[0] = j;
    for (let i = 1; i <= m; i++) {
      curr[i] =
        a[i - 1] === b[j - 1]
          ? prev[i - 1]
          : 1 + Math.min(prev[i], curr[i - 1], prev[i - 1]);
    }
    [prev, curr] = [curr, prev];
  }

  return 1 - prev[m] / Math.max(m, n);
}

/**
 * Detect near-duplicate value clusters in a TEXT column.
 *
 * Strategy: take top-N most frequent distinct values, compare pairs
 * with a quick length pre-filter before full Levenshtein. Returns
 * cluster count + up to 3 example pairs.
 */
function detectFuzzyDuplicates(
  values: string[],
): {
  clusters: number;
  samples: Array<{ a: string; b: string; similarity: number }>;
} {
  // Count frequencies, skip null-like and very short values.
  // Capped to prevent OOM on extremely high-cardinality TEXT columns
  // (UUIDs, free-text notes). Top-50 only needs the high-frequency
  // values, so 10k entries is 200x the needed coverage.
  const freq = new Map<string, number>();
  for (const v of values) {
    if (isNullLike(v) || v.length < 2) continue;
    freq.set(v, (freq.get(v) ?? 0) + 1);
    if (freq.size >= MAX_FREQ_MAP_SIZE) break;
  }

  if (freq.size < 2) return { clusters: 0, samples: [] };

  // Take top-N by frequency.
  const topValues = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, FUZZY_TOP_N)
    .map(([v]) => v);

  if (topValues.length < 2) return { clusters: 0, samples: [] };

  const samples: Array<{ a: string; b: string; similarity: number }> = [];
  const clustered = new Set<string>();

  for (let i = 0; i < topValues.length; i++) {
    const a = topValues[i];
    for (let j = i + 1; j < topValues.length; j++) {
      const b = topValues[j];

      // Quick length pre-filter: skip if lengths differ by > 20%.
      if (
        Math.min(a.length, b.length) / Math.max(a.length, b.length) <
        FUZZY_LENGTH_RATIO
      ) {
        continue;
      }

      const sim = levenshteinRatio(a, b);
      if (sim >= FUZZY_SIMILARITY_THRESHOLD) {
        clustered.add(a);
        clustered.add(b);
        if (samples.length < FUZZY_MAX_SAMPLES) {
          // Truncate long values in samples.
          const trunc = (s: string) =>
            s.length > 40 ? s.slice(0, 37) + '...' : s;
          samples.push({ a: trunc(a), b: trunc(b), similarity: Math.round(sim * 100) });
        }
      }

      // Early exit: enough samples collected.
      if (samples.length >= FUZZY_MAX_SAMPLES && clustered.size >= 2) break;
    }
    if (samples.length >= FUZZY_MAX_SAMPLES && clustered.size >= 2) break;
  }

  return { clusters: clustered.size, samples };
}

// ─── Main entry ───────────────────────────────────────────────

/**
 * Run full-scan quality analysis on uploaded data.
 *
 * @param headers           — Original (sanitised) column headers.
 * @param rows              — Already-trimmed row data (string[][]).
 * @param columns           — Discovered columns from type-detector.
 * @param whitespaceCounts  — Per-column count of values that had
 *                            leading/trailing whitespace before trim.
 */
export function analyzeQuality(
  headers: string[],
  rows: string[][],
  columns: DiscoveredColumn[],
  whitespaceCounts: number[],
): QualityProfile {
  const colProfiles: Record<string, ColumnProfile> = {};

  // ── Per-column analysis ───────────────────────────────────
  for (let ci = 0; ci < columns.length; ci++) {
    const col = columns[ci];
    const values = rows.map((r) => String(r[ci] ?? ''));

    // Q1: NULL-like detection.
    const nullConvertedSamples: Record<string, number> = {};
    let nullConvertedCount = 0;
    for (const v of values) {
      if (isNullLike(v)) {
        nullConvertedCount++;
        const key = v === '' ? '(empty)' : v;
        nullConvertedSamples[key] = (nullConvertedSamples[key] ?? 0) + 1;
      }
    }

    // Q2: Non-matching type values (only for non-TEXT semantic types).
    let nonMatchingCount = 0;
    const nonMatchingSamples: string[] = [];
    // Track uniqueness for non-TEXT columns (capped at MAX_UNIQUE_SET to
    // prevent memory blow-up on high-cardinality NUMERIC/DATE columns).
    let uniqueSet: Set<string> | undefined;
    if (col.semanticType !== 'TEXT') {
      uniqueSet = new Set();
    }
    let minLen = Infinity;
    let maxLen = 0;

    for (const v of values) {
      // Skip NULL-like values from Q2 (they don't "mismatch" the type;
      // they're already handled as NULLs).
      if (isNullLike(v)) continue;

      const len = v.length;
      if (len < minLen) minLen = len;
      if (len > maxLen) maxLen = len;

      // Track uniqueness (capped to prevent OOM on high-cardinality columns).
      if (uniqueSet && uniqueSet.size < MAX_UNIQUE_SET) uniqueSet.add(v);

      // Check type match.
      if (col.semanticType !== 'TEXT' && !matchesSemanticType(v, col.semanticType)) {
        nonMatchingCount++;
        if (nonMatchingSamples.length < MAX_SAMPLES) {
          // Truncate long samples.
          nonMatchingSamples.push(v.length > 40 ? v.slice(0, 37) + '...' : v);
        }
      }
    }

    const nonNullCount = values.length - nullConvertedCount;
    const nonMatchingRatio =
      nonNullCount > 0 ? nonMatchingCount / nonNullCount : 0;

    if (minLen === Infinity) minLen = 0; // All values were null-like.

    // Fuzzy duplicate detection (TEXT columns only — non-TEXT has
    // type constraints that already catch structural issues).
    const fuzzy =
      col.semanticType === 'TEXT'
        ? detectFuzzyDuplicates(values)
        : { clusters: 0, samples: [] };

    colProfiles[col.name] = {
      nullConvertedCount,
      nullConvertedSamples,
      nonMatchingCount,
      nonMatchingRatio,
      nonMatchingSamples,
      uniqueCount: uniqueSet?.size ?? 0,
      trimmedCount: whitespaceCounts[ci] ?? 0,
      minLength: minLen,
      maxLength: maxLen,
      fuzzyDuplicateClusters: fuzzy.clusters,
      fuzzyDuplicateSamples: fuzzy.samples,
    };
  }

  // ── Table-level analysis ──────────────────────────────────

  // Q3: Duplicate rows.
  const keyCounts = new Map<string, number>();
  for (const row of rows) {
    const key = rowKey(row);
    keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
  }
  let duplicateRowCount = 0;
  for (const count of keyCounts.values()) {
    if (count > 1) duplicateRowCount += count - 1;
  }
  const duplicateRatio = rows.length > 0 ? duplicateRowCount / rows.length : 0;

  // Count columns with issues.
  let columnsWithIssues = 0;
  for (const cp of Object.values(colProfiles)) {
    if (
      cp.nullConvertedCount > 0 ||
      cp.nonMatchingRatio > 0.05 ||
      cp.fuzzyDuplicateClusters > 0
    ) {
      columnsWithIssues++;
    }
  }

  const tableProfile: TableProfile = {
    duplicateRowCount,
    duplicateRatio,
    totalColumns: columns.length,
    columnsWithIssues,
  };

  return { columns: colProfiles, table: tableProfile };
}

// ─── Helper for chat/route.ts: build quality note ─────────────

/**
 * Build a human-readable, semantic quality note for LLM prompt injection.
 *
 * Follows the "give semantics, not code" principle:
 *   - Describes what's wrong in plain language
 *   - Suggests SQL patterns descriptively (NOT IN, LIKE), not hardcoded regex
 *   - No raw `~ '^[0-9.]+$'` patterns
 */
export function buildQualityNote(
  col: DiscoveredColumn,
  profile: ColumnProfile | undefined,
): string {
  if (!profile) return '';

  const warnings: string[] = [];

  if (profile.nonMatchingRatio > 0.05) {
    const pct = Math.round(profile.nonMatchingRatio * 100);
    const samples = profile.nonMatchingSamples.join(', ');
    warnings.push(
      `About ${pct}% of values are not valid ${col.semanticType} literals` +
        (samples ? ` (e.g. "${samples}").` : '.') +
        ` Filter these out before CASTing (use NOT IN or a LIKE pattern).`,
    );
  }

  if (profile.nullConvertedCount > 0) {
    const topSamples = Object.entries(profile.nullConvertedSamples)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k]) => (k === '(empty)' ? 'empty strings' : `"${k}"`))
      .join(', ');
    warnings.push(
      `${profile.nullConvertedCount} rows have NULL-like values` +
        (topSamples ? ` (${topSamples}) converted to database NULL.` : '.') +
        ` Use IS NOT NULL to exclude them.`,
    );
  }

  // Fuzzy duplicate warnings (descriptive, no regex).
  if (profile.fuzzyDuplicateClusters > 0 && profile.fuzzyDuplicateSamples.length > 0) {
    const examples = profile.fuzzyDuplicateSamples
      .map((s) => `"${s.a}" ≈ "${s.b}" (${s.similarity}%)`)
      .join('; ');
    warnings.push(
      `Near-duplicate values detected (${profile.fuzzyDuplicateClusters} affected values, ` +
        `e.g. ${examples}). Consider standardising this column before GROUP BY.`,
    );
  }

  return warnings.length > 0 ? ` ⚠️ ${warnings.join(' ')}` : '';
}

/**
 * Build table-level quality notes for LLM prompt injection.
 */
export function buildTableQualityNote(profile: TableProfile): string {
  const notes: string[] = [];

  if (profile.duplicateRatio > 0.10) {
    notes.push(
      `Table has ${Math.round(profile.duplicateRatio * 100)}% duplicate rows ` +
        `(${profile.duplicateRowCount} rows). Consider DISTINCT or GROUP BY when aggregating.`,
    );
  }

  return notes.join(' ');
}
