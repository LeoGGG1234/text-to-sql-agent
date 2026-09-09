import {
  analyzeQuality,
  countStoredWhitespaceByColumn,
} from './quality-analyzer';
import type { DiscoveredTable, QualityProfile } from './types';

/** Convert database rows into the analyzer's stable column-ordered matrix. */
export function rowsToProfileMatrix(
  rows: Array<Record<string, unknown>>,
  table: DiscoveredTable,
): Array<Array<string | null>> {
  return rows.map((row) =>
    table.columns.map((column) => {
      const value = row[column.name];
      return value == null ? null : String(value);
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
    countStoredWhitespaceByColumn(matrix, table.columns.length),
  );
}
