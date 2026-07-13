/**
 * SQL executor — runs a validated query against a target database.
 *
 * Defense in depth:
 *   Layer 1: connects via a read-only or limited-privilege connection URL.
 *   Layer 2: validateSql() (sql-validator.ts) runs first; only single SELECTs
 *            with a capped LIMIT reach this module.
 *   Layer 3: statement_timeout set at the DB role level + JS-side timeout backstop.
 *
 * The default target is RETAIL_DATABASE_URL (retail demo). When a user-uploaded
 * data source is active, USERDATA_DATABASE_URL is used instead.
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

export interface ExecOptions {
  /** Override the database connection string (e.g. for user-uploaded data sources). */
  connectionString?: string;
  /** Postgres schema to target (defaults to public). */
  searchPath?: string;
}

const JS_TIMEOUT_MS = 8000;
const MAX_ROWS = 1000;

/** Build a connection URL with an optional `options=-c search_path=...` parameter. */
function buildConnectionUrl(base: string, searchPath?: string): string {
  if (!searchPath) return base;
  // Append PostgreSQL connection option so every query on this connection sees the schema.
  const opt = `options=-c%20search_path%3D${encodeURIComponent(searchPath)}`;
  if (base.includes('?')) {
    return `${base}&${opt}`;
  }
  return `${base}?${opt}`;
}

// Cache per connection string to avoid re-creating neon clients.
const _clients = new Map<string, ReturnType<typeof neon>>();

function getClient(connectionString?: string): ReturnType<typeof neon> {
  const key = connectionString ?? (process.env.RETAIL_DATABASE_URL || '');
  if (!key) {
    throw new Error(
      'Database URL is not configured. Set RETAIL_DATABASE_URL or provide a connection string.',
    );
  }
  let client = _clients.get(key);
  if (!client) {
    client = neon(key);
    _clients.set(key, client);
  }
  return client;
}

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
    return { code: 'VALIDATION_ERROR', message: 'Only read-only queries are permitted.' };
  }
  return { code: 'OTHER', message };
}

/**
 * Validate + execute a SQL query.
 *
 * @param rawSql  — The LLM-generated SQL to execute.
 * @param options — Optional connection string override + schema search path.
 */
export async function validateAndExecute(
  rawSql: string,
  options?: ExecOptions,
): Promise<ExecResult> {
  const validation = validateSql(rawSql);
  if (!validation.valid) {
    return { success: false, error: validation.error, code: validation.code };
  }

  // When targeting a specific schema, inject search_path into the connection URL
  // rather than via SET LOCAL. Neon's HTTP driver makes a separate HTTP request per
  // query(), so SET LOCAL would be lost immediately. Connection-option search_path
  // applies to every query on that connection.
  const connStr = buildConnectionUrl(
    options?.connectionString ?? process.env.RETAIL_DATABASE_URL ?? '',
    options?.searchPath,
  );
  const client = getClient(connStr);
  const started = Date.now();

  try {
    const queryPromise = client.query(validation.sql);
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
