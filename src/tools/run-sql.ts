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
 * knows how to fix its next attempt. A per-call retry counter caps the loop
 * at MAX_ATTEMPTS so a model that cannot fix its query stops instead of
 * burning every step.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { validateAndExecute } from '@/lib/sql-executor';

const MAX_ATTEMPTS = 3;

/**
 * Factory so each chat request gets its own attempt counter. The route builds
 * the tool per-request via makeRunSql(); the counter is closed over and reset
 * naturally for the next request.
 */
export function makeRunSql() {
  let attempts = 0;

  return tool({
    description:
      'Execute a single read-only SQL SELECT query against the retail sales ' +
      'database and return the resulting rows. Use standard PostgreSQL syntax ' +
      'and the exact table/column names from the schema. The query is validated ' +
      'for safety (SELECT only) and capped at 1000 rows. If it fails, read the ' +
      'returned error and code, fix your SQL, and try again.',

    parameters: z.object({
      sql: z
        .string()
        .describe(
          'A single PostgreSQL SELECT statement. Alias aggregates clearly ' +
            '(e.g. SUM(line_total) AS total_revenue). For dates use ISO format ' +
            "(e.g. order_date >= '2025-01-01'). Do NOT write anything other than SELECT.",
        ),
    }),

    execute: async ({ sql }) => {
      attempts += 1;

      if (attempts > MAX_ATTEMPTS) {
        return {
          success: false,
          code: 'MAX_RETRIES',
          error:
            `Maximum retry attempts (${MAX_ATTEMPTS}) reached. Stop retrying — ` +
            'explain to the user what went wrong and suggest they rephrase the question.',
        };
      }

      const result = await validateAndExecute(sql);

      if (!result.success) {
        // Return the structured error so the model can self-correct.
        return {
          success: false,
          code: result.code,
          error: result.error,
          attempt: attempts,
          attemptsRemaining: Math.max(0, MAX_ATTEMPTS - attempts),
          sql,
        };
      }

      return {
        success: true,
        sql,
        rowCount: result.rowCount,
        columns: result.columns,
        truncated: result.truncated,
        durationMs: result.durationMs,
        // Cap rows sent back to the model to keep the context small; the full
        // set (up to 1000) is still rendered in the UI from the same payload.
        rows: result.rows.slice(0, 100),
        rowsOmitted: Math.max(0, result.rowCount - 100),
      };
    },
  });
}
