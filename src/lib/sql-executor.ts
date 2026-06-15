/**
 * SQL executor — runs a validated query against the read-only retail database.
 *
 * Defense in depth:
 *   Layer 1: connects via RETAIL_DATABASE_URL, whose role (retail_readonly) has
 *            SELECT-only grants — the database itself rejects any write.
 *   Layer 2: validateSql() (sql-validator.ts) runs first; only single SELECTs
 *            with a capped LIMIT reach this module.
 *   Layer 3: the read-only role has `statement_timeout = 5s` set at the role
 *            level (see scripts/seed-retail-db.ts), and we add a JS-side
 *            timeout as a backstop in case the role setting is missing.
 *
 * Returns a structured result so the agent can self-correct on errors
 * (see src/tools/run-sql.ts).
 */

import { neon } from '@neondatabase/serverless';
import { validateSql } from './sql-validator';

export type ExecErrorCode =
  | 'VALIDATION_ERROR'
  | 'SYNTAX_ERROR'
  | 'UNKNOWN_COLUMN'
  | 'TIMEOUT'
  | 'OTHER';

export interface ExecSuccess {
  success: true;
  rows: Record<string, unknown>[];
  rowCount: number;
  columns: string[];
  truncated: boolean;
  durationMs: number;
}

export interface ExecFailure {
  success: false;
  error: string;
  code: ExecErrorCode;
}

export type ExecResult = ExecSuccess | ExecFailure;

const JS_TIMEOUT_MS = 8000; // backstop > DB's 5s so the DB error wins when possible
const MAX_ROWS = 1000;

let _sql: ReturnType<typeof neon> | null = null;

function getReadonlySql() {
  if (_sql) return _sql;
  const url = process.env.RETAIL_DATABASE_URL;
  if (!url) {
    throw new Error(
      'RETAIL_DATABASE_URL is not configured. Set it to the retail_readonly connection string.',
    );
  }
  _sql = neon(url);
  return _sql;
}

/** Map a raw Postgres/driver error to a structured code the agent can act on. */
function classifyDbError(err: unknown): { code: ExecErrorCode; message: string } {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  if (lower.includes('statement timeout') || lower.includes('canceling statement')) {
    return { code: 'TIMEOUT', message: 'Query timed out (exceeded 5s).' };
  }
  if (lower.includes('column') && lower.includes('does not exist')) {
    return { code: 'UNKNOWN_COLUMN', message };
  }
  if (lower.includes('syntax error')) {
    return { code: 'SYNTAX_ERROR', message };
  }
  if (
    lower.includes('permission denied') ||
    lower.includes('must be owner') ||
    lower.includes('read-only')
  ) {
    // Layer 1 fired — a write slipped past validation somehow.
    return { code: 'VALIDATION_ERROR', message: 'Only read-only queries are permitted.' };
  }
  return { code: 'OTHER', message };
}

/**
 * Validate + execute a SQL query against the read-only retail DB.
 * This is the single entry point used by the runSql tool and the eval harness.
 */
export async function validateAndExecute(rawSql: string): Promise<ExecResult> {
  // Layer 2 — validation.
  const validation = validateSql(rawSql);
  if (!validation.valid) {
    return { success: false, error: validation.error, code: validation.code };
  }

  const sql = getReadonlySql();
  const started = Date.now();

  try {
    // JS-side timeout backstop (Layer 3b).
    const queryPromise = sql.query(validation.sql);
    const rows = (await withTimeout(queryPromise, JS_TIMEOUT_MS)) as Record<
      string,
      unknown
    >[];

    const durationMs = Date.now() - started;
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

    return {
      success: true,
      rows,
      rowCount: rows.length,
      columns,
      truncated: rows.length >= MAX_ROWS,
      durationMs,
    };
  } catch (err) {
    const { code, message } = classifyDbError(err);
    return { success: false, error: message, code };
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('canceling statement due to statement timeout')),
      ms,
    );
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
