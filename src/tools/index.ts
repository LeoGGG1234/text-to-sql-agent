/**
 * Agent tool registry.
 *
 * runSql and getSchema are built per-request so they reflect the active
 * data source's schema and connection target. renderChart is stateless.
 *
 * The chat route assembles the tool set via buildTools(options).
 */

import type { ExecOptions } from '@/lib/sql-executor';
import type { TableDef } from '@/lib/schema-description';
import { makeRunSql } from './run-sql';
import { makeGetSchema } from './get-schema';
import { renderChart } from './render-chart';

export interface ToolOptions {
  /** Override exec targets (connection string, search path). */
  execOptions?: ExecOptions;
  /** Dynamic schema tables (user-uploaded data). Falls back to retail demo. */
  schemaTables?: TableDef[];
  /** Dynamic schema relationships. Falls back to retail demo. */
  schemaRelationships?: string[];
}

export function buildTools(options?: ToolOptions) {
  return {
    runSql: makeRunSql(options?.execOptions),
    getSchema: makeGetSchema({
      tables: options?.schemaTables,
      relationships: options?.schemaRelationships,
    }),
    renderChart,
  };
}
