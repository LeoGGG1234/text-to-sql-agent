import { neon } from '@neondatabase/serverless';
import { quoteIdent, validateTableName } from './row-utils';
import type { CleaningRow } from './cleaning-types';
import type { DiscoveredTable, SchemaJson } from './types';
import { MAX_INTERACTIVE_DATA_ROWS } from './upload-limits';

export const MAX_CLEANING_ROWS = MAX_INTERACTIVE_DATA_ROWS;

export function resolveCleaningTable(schemaJson: SchemaJson): DiscoveredTable {
  const table = schemaJson.tables[0];
  if (!table) throw new Error('Data source schema is missing.');
  validateTableName(schemaJson, table.name);
  return table;
}

export function cleaningSelectList(table: DiscoveredTable): string {
  return ['_row_id', ...table.columns.map((column) => quoteIdent(column.name))].join(', ');
}

export async function loadCleaningRows(
  connectionString: string,
  table: DiscoveredTable,
  operationLabel = 'Cleaning',
): Promise<CleaningRow[]> {
  const sql = neon(connectionString);
  const [count] = (await sql.query(
    `SELECT COUNT(*)::int AS count FROM userdata.${quoteIdent(table.name)}`,
  )) as Array<{ count: number }>;
  if (Number(count?.count ?? 0) > MAX_CLEANING_ROWS) {
    throw new Error(`${operationLabel} is limited to ${MAX_CLEANING_ROWS.toLocaleString()} rows per run.`);
  }
  return (await sql.query(
    `SELECT ${cleaningSelectList(table)} FROM userdata.${quoteIdent(table.name)} ORDER BY _row_id`,
  )) as CleaningRow[];
}

export function updateRowCountMetadata(
  schemaJson: SchemaJson,
  config: Record<string, unknown>,
  tableName: string,
  rowCount: number,
) {
  return {
    schemaJson: {
      ...schemaJson,
      tables: schemaJson.tables.map((table) =>
        table.name === tableName ? { ...table, rowCount } : table,
      ),
    },
    config: {
      ...config,
      tables: Array.isArray(config.tables)
        ? config.tables.map((table) =>
            table && typeof table === 'object' && (table as { name?: unknown }).name === tableName
              ? { ...table, rowCount }
              : table,
          )
        : config.tables,
    },
  };
}
