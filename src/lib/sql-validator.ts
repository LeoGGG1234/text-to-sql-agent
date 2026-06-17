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
    // Fail closed: the LIMIT cap lives only on the AST we just edited, so we
    // cannot fall back to the raw input (it has no cap) without dropping the
    // row-limit guarantee. If we can't serialize the validated+capped AST,
    // reject rather than run an uncapped query.
    return {
      valid: false,
      error: 'Could not safely process this query. Please simplify it.',
      code: 'VALIDATION_ERROR',
    };
  }

  return { valid: true, sql: cleaned };
}

/** A node-sql-parser LIMIT value entry: `{ type, value }`. */
interface LimitValue {
  type: string;
  value: number;
}
/** A node-sql-parser LIMIT node: `{ seperator, value: [...] }`. */
interface LimitNode {
  seperator?: string;
  value: LimitValue[];
}
interface SelectNode {
  limit?: LimitNode;
  _next?: SelectNode; // set-op chain (UNION/INTERSECT/EXCEPT)
}

/**
 * Rewrite the query's LIMIT so it always has a positive count no greater than
 * MAX_ROWS, editing the AST in place. The output is correct for every shape:
 *   - No LIMIT            → `LIMIT MAX_ROWS`
 *   - OFFSET but no LIMIT → `LIMIT MAX_ROWS OFFSET m`  (preserve the offset)
 *   - LIMIT > MAX_ROWS    → clamp the count to MAX_ROWS (preserve offset)
 *   - LIMIT < 0 / non-num → clamp the count to MAX_ROWS
 *   - 0 <= LIMIT <= cap   → leave as-is
 *
 * Why this is fiddly: node-sql-parser packs LIMIT and OFFSET into one node and
 * the value array is positional. The critical trap is `OFFSET m` with NO LIMIT,
 * which parses as `{ seperator: 'offset', value: [m] }` — that lone entry is the
 * OFFSET, not a count, so treating it as the count silently drops the row cap.
 * We therefore separate the count node from the offset node by shape, rather
 * than indexing.
 *
 * For set-op queries (`SELECT ... UNION SELECT ...`) the LIMIT binds to the
 * last branch, which the parser stores at the tail of the `_next` chain — so we
 * walk to the tail before editing.
 */
function applyLimit(stmt: unknown): void {
  let tail = stmt as SelectNode;
  while (tail._next) tail = tail._next;

  const limit = tail.limit;
  const hasOffsetSep = limit?.seperator === 'offset';
  const values = limit?.value ?? [];

  // Separate count from offset by the node's documented shapes:
  //   ''      []              → no limit, no offset
  //   ''      [count]         → LIMIT count
  //   'offset'[offset]        → OFFSET offset (NO count present)  ← the trap
  //   'offset'[count, offset] → LIMIT count OFFSET offset
  let countNode: LimitValue | undefined;
  let offsetNode: LimitValue | undefined;
  if (hasOffsetSep) {
    if (values.length >= 2) {
      countNode = values[0];
      offsetNode = values[1];
    } else {
      offsetNode = values[0]; // lone entry is the OFFSET, not a count
    }
  } else {
    countNode = values.length > 0 ? values[values.length - 1] : undefined;
  }

  const current = countNode ? Number(countNode.value) : NaN;
  const needsCap = Number.isNaN(current) || current < 0 || current > MAX_ROWS;
  const cappedCount: LimitValue = {
    type: 'number',
    value: needsCap ? MAX_ROWS : current,
  };

  tail.limit = offsetNode
    ? { seperator: 'offset', value: [cappedCount, offsetNode] }
    : { seperator: '', value: [cappedCount] };
}
