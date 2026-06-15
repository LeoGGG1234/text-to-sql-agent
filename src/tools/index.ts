/**
 * Agent tool registry.
 *
 * runSql is built per-request (makeRunSql) so each conversation turn gets its
 * own retry counter. getSchema and renderChart are stateless singletons.
 *
 * The chat route assembles the tool set via buildTools().
 */

import { makeRunSql } from './run-sql';
import { getSchema } from './get-schema';
import { renderChart } from './render-chart';

export function buildTools() {
  return {
    runSql: makeRunSql(),
    getSchema,
    renderChart,
  };
}
