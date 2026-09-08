import { analyzeQuality } from './quality-analyzer';
import type { DiscoveredTable, QualityProfile } from './types';

/** Convert database rows into the analyzer's stable column-ordered matrix. */
export function rowsToProfileMatrix(
  rows: Array<Record<string, unknown>>,
  table: DiscoveredTable,
): string[][] {
  return rows.map((row) =>
    table.columns.map((column) => {
      const value = row[column.name];
      return value == null ? '' : String(value);
    }),
  );
}

export function profileTableRows(
  rows: Array<Record<string, unknown>>,
  table: DiscoveredTable,
): QualityProfile {
  const matrix = rowsToProfileMatrix(rows, table);
  return analyzeQuality(
    table.columns.map((column) => column.name),
    matrix,
    table.columns,
    table.columns.map(() => 0),
  );
}
