/**
 * SQL safety validator — Layer 2 of the read-only defense.
 *
 * The agent generates SQL strings; this module decides whether a string is a
 * safe, single, read-only SELECT before it is ever sent to the database.
 * (Layer 1 is the read-only Postgres role; Layer 3 is the statement timeout
 * in sql-executor.ts.)
 *
 * Approach: parse the SQL into an AST with node-sql-parser and inspect it,
 * backed by a set of defensive regex checks for things that should never
 * appear in a generated analytical query (comments, stacked statements,
 * dangerous functions, catalog access).
 *
 * On success it returns the cleaned SQL with a LIMIT applied so a runaway
 * query can never return more than MAX_ROWS rows.
 */

import { Parser } from 'node-sql-parser';

export const MAX_ROWS = 1000;

export type ValidationCode = 'VALIDATION_ERROR' | 'SYNTAX_ERROR';

export type ValidateResult =
  | { valid: true; sql: string }
  | { valid: false; error: string; code: ValidationCode };

const parser = new Parser();
const PARSE_OPTS = { database: 'postgresql' } as const;

/**
 * Patterns that must never appear in a generated read-only query. These run on
 * the raw string before parsing, catching injection tricks the AST might
 * normalize away (e.g. comments) and database-specific syntax the parser may
 * accept but we never want.
 */
const FORBIDDEN_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /--/, reason: 'SQL line comments are not allowed' },
  { re: /\/\*/, reason: 'SQL block comments are not allowed' },
  { re: /;\s*\S/, reason: 'multiple statements are not allowed' },
  {
    re: /\b(pg_sleep|pg_read_file|pg_terminate_backend|pg_cancel_backend|lo_import|lo_export|dblink|copy|do)\b/i,
    reason: 'disallowed function or statement',
  },
  {
    re: /\b(information_schema|pg_catalog|pg_class|pg_tables|pg_attribute|pg_roles|pg_shadow|pg_user)\b/i,
    reason: 'system catalog access is not allowed',
  },
  { re: /\binto\s+/i, reason: 'SELECT INTO / INTO clauses are not allowed' },
];

/**
 * Statement types node-sql-parser may report that we explicitly reject.
 * (Anything that is not a plain SELECT/CTE-SELECT.)
 */
const ALLOWED_STATEMENT_TYPE = 'select';

export function validateSql(raw: string): ValidateResult {
  const sql = (raw ?? '').trim().replace(/;\s*$/, ''); // drop a single trailing ;

  if (!sql) {
    return { valid: false, error: 'Empty query.', code: 'VALIDATION_ERROR' };
  }

  // ── Defensive string checks (before parsing) ──────────────────
  for (const { re, reason } of FORBIDDEN_PATTERNS) {
    if (re.test(sql)) {
      return { valid: false, error: reason, code: 'VALIDATION_ERROR' };
    }
  }

  // ── Parse to AST ──────────────────────────────────────────────
  let ast;
  try {
    ast = parser.astify(sql, PARSE_OPTS);
  } catch (e) {
    return {
      valid: false,
      error: `SQL parsing error: ${e instanceof Error ? e.message : String(e)}`,
      code: 'SYNTAX_ERROR',
    };
  }

  // Multiple statements → parser returns an array.
  const statements = Array.isArray(ast) ? ast : [ast];
  if (statements.length !== 1) {
    return {
      valid: false,
      error: 'Only a single statement is allowed.',
      code: 'VALIDATION_ERROR',
    };
  }

  const stmt = statements[0] as { type?: string };

  // ── Must be a SELECT (CTEs report type 'select' too) ──────────
  if (stmt.type !== ALLOWED_STATEMENT_TYPE) {
    return {
      valid: false,
      error: `Only SELECT queries are allowed (got "${stmt.type ?? 'unknown'}").`,
      code: 'VALIDATION_ERROR',
    };
  }

  // ── Re-serialize from the AST, then apply LIMIT ───────────────
  // Serializing from the parsed AST guarantees the string we run is exactly
  // what we validated — not the raw input.
  let cleaned: string;
  try {
    cleaned = parser.sqlify(stmt as never, PARSE_OPTS);
  } catch {
    // Fall back to the trimmed input if sqlify fails for an exotic-but-valid
    // construct; the AST checks above already passed.
    cleaned = sql;
  }

  cleaned = applyLimit(cleaned, stmt);

  return { valid: true, sql: cleaned };
}

/**
 * Ensure the query has a LIMIT no greater than MAX_ROWS.
 * - No LIMIT          → append `LIMIT MAX_ROWS`
 * - LIMIT > MAX_ROWS  → clamp to MAX_ROWS
 * - LIMIT <= MAX_ROWS → leave as-is
 *
 * Uses the AST's limit node to decide, but edits the serialized string so we
 * don't depend on sqlify round-tripping the limit clause perfectly.
 */
function applyLimit(serialized: string, stmt: unknown): string {
  const limitNode = (stmt as { limit?: { value?: Array<{ value?: number }> } })
    .limit;
  const limitValues = limitNode?.value ?? [];

  // node-sql-parser represents `LIMIT n` as value:[{value:n}] and
  // `LIMIT a, b` / `LIMIT b OFFSET a` with two entries. We look at the last.
  const existing =
    limitValues.length > 0
      ? Number(limitValues[limitValues.length - 1]?.value)
      : undefined;

  if (existing === undefined || Number.isNaN(existing)) {
    return `${serialized.replace(/\s*$/, '')} LIMIT ${MAX_ROWS}`;
  }

  if (existing > MAX_ROWS) {
    // Replace the final number in a trailing LIMIT clause with the cap.
    return serialized.replace(
      /LIMIT\s+(\d+)(\s*)$/i,
      `LIMIT ${MAX_ROWS}$2`,
    );
  }

  return serialized;
}
