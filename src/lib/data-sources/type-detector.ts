/**
 * Column type detection and identifier sanitization for CSV uploads.
 *
 * Strategy (v4 final):
 *   Physical DDL: ALL columns are TEXT (zero type errors, crash-proof).
 *   Semantic hint: sample rows to infer NUMERIC/DATE/BOOLEAN/TEXT,
 *                   stored in schema_json.semanticType for LLM CAST hints.
 */

import type { DiscoveredColumn } from './types';

const SAMPLE_SIZE = 100;

/**
 * Confidence threshold for semantic type assignment.
 * At least 80% of non-empty values must match a type pattern before
 * we assign that label. Prevents false positives like order-IDs
 * that are 50% numeric / 50% alphanumeric from being labelled NUMERIC.
 */
const CONFIDENCE_THRESHOLD = 0.8;

/**
 * Sanitize a user-supplied identifier (file name or column header)
 * into a safe PostgreSQL identifier.
 *
 * Rules:
 *  - Lowercase
 *  - Replace non-alphanumeric chars (except underscore) with underscore
 *  - Collapse consecutive underscores
 *  - Strip leading/trailing underscores
 *  - Prefix with 'c_' if it starts with a digit
 *  - Clamp to 60 chars (safe margin under PG 63-byte limit)
 */
export function sanitizeIdentifier(raw: string): string {
  let s = raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

  if (!s) s = 'unnamed';
  if (/^\d/.test(s)) s = 'c_' + s;
  if (s.length > 60) s = s.slice(0, 60);

  return s;
}

/**
 * Detect the semantic type of a column from a sample of string values.
 * Returns the strongest type that the column could be.
 */
function detectSemanticType(values: string[]): DiscoveredColumn['semanticType'] {
  const nonEmpty = values.filter((v) => v !== '' && v != null);
  if (nonEmpty.length === 0) return 'TEXT';

  const total = nonEmpty.length;

  // Try NUMERIC: >= 80% of non-empty values match number pattern.
  const numericCount = nonEmpty.filter((v) => /^-?\d+(\.\d+)?$/.test(v.trim())).length;
  if (numericCount / total >= CONFIDENCE_THRESHOLD) return 'NUMERIC';

  // Try DATE: common date patterns, >= 80%.
  const datePatterns = [
    /^\d{4}-\d{2}-\d{2}$/,              // 2026-01-15
    /^\d{1,2}\/\d{1,2}\/\d{4}$/,        // 1/15/2026
    /^\d{1,2}\/\d{1,2}\/\d{2}$/,        // 1/15/26
    /^\d{4}\/\d{1,2}\/\d{1,2}$/,        // 2026/1/15
    /^\d{1,2}-\d{1,2}-\d{4}$/,          // 01-15-2026
  ];
  const dateCount = nonEmpty.filter((v) =>
    datePatterns.some((p) => p.test(v.trim())),
  ).length;
  if (dateCount / total >= CONFIDENCE_THRESHOLD) return 'DATE';

  // Try BOOLEAN, >= 80%.
  const boolValues = ['true', 'false', 'yes', 'no', '0', '1', 'y', 'n'];
  const boolCount = nonEmpty.filter((v) =>
    boolValues.includes(v.trim().toLowerCase()),
  ).length;
  if (boolCount / total >= CONFIDENCE_THRESHOLD) return 'BOOLEAN';

  return 'TEXT';
}

/**
 * Generate a CAST hint for the LLM based on semantic type.
 */
function makeHint(
  colName: string,
  semanticType: DiscoveredColumn['semanticType'],
): string | null {
  switch (semanticType) {
    case 'NUMERIC':
      return `Stored as TEXT. For math: CAST(${colName} AS NUMERIC)`;
    case 'DATE':
      return `Stored as TEXT. For time: CAST(${colName} AS DATE)`;
    default:
      return null;
  }
}

/**
 * Detect column types from CSV headers and sample rows.
 *
 * @param headers  - Original column headers (un-sanitized)
 * @param rows     - Raw row data (string[][]), up to SAMPLE_SIZE rows
 * @returns DiscoveredColumn[] with sanitized names, semantic types, and hints
 */
/**
 * Check whether a string value should be treated as NULL.
 * Must match the same list in quality-analyzer.ts.
 */
export const NULL_LIKE_VALUES = new Set([
  '', 'null', 'NULL', 'Null',
  'N/A', 'n/a', 'NA',
  'nil', 'None',
  '—', '–',
  '无', '暂无',
]);

function isNullish(v: string): boolean {
  return NULL_LIKE_VALUES.has(v.trim());
}

export function detectColumns(
  headers: string[],
  rows: string[][],
): DiscoveredColumn[] {
  const seen = new Map<string, number>(); // sanitized name → next suffix

  return headers.map((header, colIdx) => {
    let name = sanitizeIdentifier(header);
    const count = seen.get(name);
    if (count !== undefined) {
      // Duplicate sanitized name — append _2, _3, etc.
      seen.set(name, count + 1);
      name = `${name}_${count + 1}`;
    } else {
      seen.set(name, 1);
    }
    const displayName = header.trim();
    const values = rows.slice(0, SAMPLE_SIZE).map((r) => String(r[colIdx] ?? ''));
    const nonNull = values.filter((v) => !isNullish(v));
    const nullable = nonNull.length < values.length * 0.5;
    const semanticType = detectSemanticType(values);
    const nonMatching = nonNull.filter((v) => !matchesSemanticType(v, semanticType));

    return {
      name,
      displayName,
      type: 'TEXT',
      semanticType,
      nullable,
      hint: makeHint(name, semanticType),
    };
  });
}

// ─── Full-width → Half-width normalization ──────────────────────

/**
 * Convert full-width characters to half-width for consistent parsing.
 *
 * Handles:
 *   - Full-width digits ０１２３４５６７８９ → 0123456789
 *   - Full-width letters Ａ-Ｚ ａ-ｚ → A-Z a-z
 *   - Full-width period ．→ .
 *   - Full-width space 　→ (half-width space)
 *   - Other full-width punctuation in U+FF01–U+FF5E range
 *
 * This runs BEFORE trim so the half-width space produced from U+3000
 * is caught by the subsequent .trim() call.
 */
export function normalizeFullWidth(s: string): string {
  let result = '';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code === 0x3000) {
      // Full-width space → half-width space (trimmed later).
      result += ' ';
    } else if (code >= 0xff01 && code <= 0xff5e) {
      // Full-width punctuation/letters/digits → half-width.
      result += String.fromCharCode(code - 0xfee0);
    } else {
      result += s[i];
    }
  }
  return result;
}

/** Check whether a single value matches a semantic type pattern (used for quality analysis). */
function matchesSemanticType(
  v: string,
  semanticType: DiscoveredColumn['semanticType'],
): boolean {
  switch (semanticType) {
    case 'NUMERIC':
      return /^-?\d+(\.\d+)?$/.test(v.trim());
    case 'DATE':
      return [
        /^\d{4}-\d{2}-\d{2}$/,
        /^\d{1,2}\/\d{1,2}\/\d{4}$/,
        /^\d{1,2}\/\d{1,2}\/\d{2}$/,
        /^\d{4}\/\d{1,2}\/\d{1,2}$/,
        /^\d{1,2}-\d{1,2}-\d{4}$/,
      ].some((p) => p.test(v.trim()));
    case 'BOOLEAN':
      return ['true', 'false', 'yes', 'no', '0', '1', 'y', 'n'].includes(
        v.trim().toLowerCase(),
      );
    default:
      return true; // TEXT matches everything
  }
}
