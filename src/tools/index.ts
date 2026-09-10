/**
 * Agent tool registry.
 *
 * runSql and getSchema are built per-request so they reflect the active
 * data source's schema and connection target. A per-request result registry
 * binds renderChart to rows actually returned by runSql.
 *
 * The chat route assembles the tool set via buildTools(options).
 */

import type { ExecOptions } from '@/lib/sql-executor';
import type { TableDef } from '@/lib/schema-description';
import { makeRunSql } from './run-sql';
import { makeGetSchema } from './get-schema';
import { makeRenderChart } from './render-chart';
import { createQueryResultStore } from './query-result-store';

export interface ToolOptions {
  /** Override exec targets (connection string, search path). */
  execOptions?: ExecOptions;
  /** Dynamic schema tables (user-uploaded data). Falls back to retail demo. */
  schemaTables?: TableDef[];
  /** Dynamic schema relationships. Falls back to retail demo. */
  schemaRelationships?: string[];
}

export function buildTools(options?: ToolOptions) {
  const queryResults = createQueryResultStore();

  return {
    runSql: makeRunSql(options?.execOptions, queryResults),
    getSchema: makeGetSchema({
      tables: options?.schemaTables,
      relationships: options?.schemaRelationships,
    }),
    renderChart: makeRenderChart(queryResults),
  };
}
