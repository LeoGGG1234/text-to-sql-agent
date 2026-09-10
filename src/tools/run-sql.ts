/**
 * Tool: runSql
 *
 * The agent's primary tool. Takes a SQL string the model wrote, validates it
 * (single read-only SELECT only), executes it against the read-only retail
 * database, and returns the rows — or a structured error the model can read
 * and recover from.
 *
 * Self-correction: on failure the result carries a `code` field
 * (UNKNOWN_COLUMN / SYNTAX_ERROR / TIMEOUT / VALIDATION_ERROR) so the model
 * knows how to fix its next attempt. A consecutive-failure counter caps the
 * loop at MAX_ATTEMPTS so a model that cannot fix its query stops instead of
 * burning every step. Successful queries reset that counter because they are
 * useful analysis, not failed retries.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { validateAndExecute, type ExecOptions } from '@/lib/sql-executor';
import {
  createQueryResultStore,
  type QueryResultStore,
} from './query-result-store';

const MAX_ATTEMPTS = 3;

/**
 * Factory so each chat request gets its own attempt counter. The route builds
 * the tool per-request via makeRunSql(options); the counter is closed over and
 * reset naturally for the next request.
 *
 * @param execOptions — Optional connection string / search path for user-uploaded data sources.
 */
export function makeRunSql(
  execOptions?: ExecOptions,
  resultStore: QueryResultStore = createQueryResultStore(),
) {
  let consecutiveFailures = 0;

  return tool({
    description:
      'Execute a single read-only SQL SELECT query against the database ' +
      'and return the resulting rows. Use standard PostgreSQL syntax ' +
      'and the exact table/column names from the schema. The query is validated ' +
      'for safety (SELECT only) and capped at 1000 rows. If it fails, read the ' +
      'returned error and code, fix your SQL, and try again. A successful result ' +
      'includes a resultId that renderChart can reference within this request.',

    parameters: z.object({
      sql: z
        .string()
        .describe(
          'A single PostgreSQL SELECT statement. Alias aggregates clearly ' +
            '(e.g. SUM(line_total) AS total_revenue). Avoid reserved aliases ' +
            'such as nulls; use descriptive names such as null_count. For dates use ISO format ' +
            "(e.g. order_date >= '2025-01-01'). Do NOT write anything other than SELECT.",
        ),
    }),

    execute: async ({ sql }) => {
      if (consecutiveFailures >= MAX_ATTEMPTS) {
        return {
          success: false,
          code: 'MAX_RETRIES',
          error:
            `Maximum retry attempts (${MAX_ATTEMPTS}) reached. Stop retrying — ` +
            'explain to the user what went wrong and suggest they rephrase the question.',
        };
      }

      const result = await validateAndExecute(sql, execOptions);

      if (!result.success) {
        consecutiveFailures += 1;
        const attemptsRemaining = Math.max(
          0,
          MAX_ATTEMPTS - consecutiveFailures,
        );
        return {
          success: false,
          code: result.code,
          error: result.error,
          attempt: consecutiveFailures,
          attemptsRemaining,
          nextAction:
            attemptsRemaining > 0
              ? 'Call runSql again now with corrected SQL; do not only describe a future retry.'
              : 'Stop retrying and explain the failure to the user.',
          sql,
        };
      }

      consecutiveFailures = 0;
      const visibleRows = result.rows.slice(0, 100);
      const snapshot = resultStore.save({
        rowCount: result.rowCount,
        columns: result.columns,
        rows: visibleRows,
        truncated: result.truncated,
      });

      return {
        success: true,
        resultId: snapshot.resultId,
        sql,
        rowCount: result.rowCount,
        columns: result.columns,
        truncated: result.truncated,
        durationMs: result.durationMs,
        rows: visibleRows,
        rowsOmitted: Math.max(0, result.rowCount - 100),
      };
    },
  });
}
