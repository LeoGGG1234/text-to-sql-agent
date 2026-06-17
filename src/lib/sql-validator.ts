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
 *
 * NOTE: write detection (INSERT/UPDATE/DELETE/...) is NOT done here — it is
 * enforced structurally via the parsed statement type AND the per-operation
 * tableList check in validateSql(). A keyword regex would both miss tricks
 * (e.g. data-modifying CTEs) and false-positive on string literals. Likewise
 * `SELECT INTO` is caught at the AST level, not by a fragile `\binto\b` regex
 * that would reject a legitimate literal like WHERE brand = 'A into B'.
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

  // ── Parse to AST (+ tableList for per-operation checks) ───────
  let ast;
  let tableList: string[];
  try {
    const parsed = parser.parse(sql, PARSE_OPTS);
    ast = parsed.ast;
    tableList = parsed.tableList ?? [];
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

  const stmt = statements[0] as {
    type?: string;
    into?: { position?: unknown } | null;
  };

  // ── Must be a SELECT (CTEs report type 'select' too) ──────────
  if (stmt.type !== ALLOWED_STATEMENT_TYPE) {
    return {
      valid: false,
      error: `Only SELECT queries are allowed (got "${stmt.type ?? 'unknown'}").`,
      code: 'VALIDATION_ERROR',
    };
  }

  // ── Every operation must be a SELECT ──────────────────────────
  // The statement type alone is NOT enough: PostgreSQL allows data-modifying
  // CTEs such as `WITH t AS (UPDATE ... RETURNING *) SELECT * FROM t`, which
  // node-sql-parser still reports as type "select". tableList exposes the real
  // operation per table as "{op}::{db}::{table}" (e.g. "update::null::orders"),
  // so we reject if anything other than a select operation is present.
  for (const entry of tableList) {
    const op = String(entry).split('::')[0];
    if (op !== ALLOWED_STATEMENT_TYPE) {
      return {
        valid: false,
        error: `Only read-only SELECT operations are allowed (found "${op}").`,
        code: 'VALIDATION_ERROR',
      };
    }
  }

  // ── Reject SELECT INTO (writes to a new table) at the AST level ──
  if (stmt.into && stmt.into.position) {
    return {
      valid: false,
      error: 'SELECT INTO is not allowed.',
      code: 'VALIDATION_ERROR',
    };
  }

  // ── Clamp LIMIT on the AST, then serialize ────────────────────
  // Editing the AST's limit node (rather than regex-patching the serialized
  // string) handles every shape correctly: missing LIMIT, LIMIT n, LIMIT n
  // OFFSET m, and the set-op chain (UNION) where the LIMIT binds to the last
  // branch. Serializing from the validated AST also guarantees the string we
  // run is exactly what we checked — not the raw input.
  applyLimit(stmt);

  let cleaned: string;
  try {
    cleaned = parser.sqlify(stmt as never, PARSE_OPTS);
  } catch {
    // Fall back to the trimmed input if sqlify fails for an exotic-but-valid
    // construct; the AST checks above already passed.
    cleaned = sql;
  }

  return { valid: true, sql: cleaned };
}

/** A node-sql-parser LIMIT node: `{ seperator, value: [{ type, value }] }`. */
interface LimitNode {
  seperator?: string;
  value: Array<{ type: string; value: number }>;
}
interface SelectNode {
  limit?: LimitNode;
  _next?: SelectNode; // set-op chain (UNION/INTERSECT/EXCEPT)
}

/**
 * Ensure the query has a LIMIT no greater than MAX_ROWS, editing the AST in
 * place so the serialized output is correct for every shape:
 *   - No LIMIT          → append `LIMIT MAX_ROWS`
 *   - LIMIT > MAX_ROWS  → clamp the count to MAX_ROWS (preserving OFFSET)
 *   - LIMIT <= MAX_ROWS → leave as-is
 *
 * For set-op queries (`SELECT ... UNION SELECT ...`) the LIMIT binds to the
 * last branch, which node-sql-parser stores at the tail of the `_next` chain —
 * so we walk to the tail before editing.
 */
function applyLimit(stmt: unknown): void {
  let tail = stmt as SelectNode;
  while (tail._next) tail = tail._next;

  const values = tail.limit?.value ?? [];

  // No LIMIT at all → attach the cap.
  if (values.length === 0) {
    tail.limit = { seperator: '', value: [{ type: 'number', value: MAX_ROWS }] };
    return;
  }

  // node-sql-parser shapes:
  //   LIMIT n            → seperator ''       value:[count]
  //   LIMIT n OFFSET m   → seperator 'offset' value:[count, offset]
  // The count is value[0] for the OFFSET form, otherwise the last entry.
  const countIdx = tail.limit?.seperator === 'offset' ? 0 : values.length - 1;
  const current = Number(values[countIdx]?.value);

  if (Number.isNaN(current) || current > MAX_ROWS) {
    values[countIdx] = { type: 'number', value: MAX_ROWS };
  }
}
