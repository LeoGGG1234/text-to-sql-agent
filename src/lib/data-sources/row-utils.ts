/**
 * row-utils.ts — Shared validation and SQL-escaping utilities for the rows API.
 *
 * These follow the same patterns as the upload route:
 *   - Column names: double-quoted identifiers
 *   - String values: single-quote escaped via `replace(/'/g, "''")`
 *   - Table/column validation: whitelist against schemaJson
 */

import type { DiscoveredColumn, DiscoveredTable, SchemaJson } from './types';
import { NULL_LIKE_VALUES } from './type-detector';

/** Escape a string value for safe SQL embedding (PostgreSQL single-quote style). */
export function escapeSqlValue(value: string): string {
  return value.replace(/'/g, "''");
}

/** Wrap an identifier in double quotes for safe SQL embedding. */
export function quoteIdent(name: string): string {
  return `"${name}"`;
}

/** Validate that a table name exists in the data source's schemaJson. Returns the table info. */
export function validateTableName(schemaJson: SchemaJson, tableName: string): DiscoveredTable {
  const table = schemaJson.tables.find((t) => t.name === tableName);
  if (!table) {
    throw new TableNotFoundError(tableName);
  }
  return table;
}

/** Validate that a column name exists in the discovered table. */
export function validateColumnName(table: DiscoveredTable, columnName: string): void {
  const col = table.columns.find((c) => c.name === columnName);
  if (!col) {
    throw new ColumnNotFoundError(columnName, table.name);
  }
}

/** Build a WHERE clause for ILIKE search across all user columns. Returns empty string if no search. */
export function buildSearchClause(columns: DiscoveredColumn[], search: string): string {
  if (!search || search.trim().length === 0) return '';
  const term = escapeSqlValue(search.trim());
  const conditions = columns
    .map((c) => `${quoteIdent(c.name)} ILIKE '%${term}%'`)
    .join(' OR ');
  return `WHERE (${conditions})`;
}

/** Serialize a database row to safe JSON, converting NULL to null. */
export function serializeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = value === null ? null : String(value);
  }
  return out;
}

/** Convert a value that looks null-like (N/A, 无, etc.) to a real SQL NULL. */
export function isNullLike(v: string): boolean {
  return NULL_LIKE_VALUES.has(v);
}

// ─── Custom error classes ──────────────────────────────────────

export class TableNotFoundError extends Error {
  constructor(table: string) {
    super(`Table "${table}" not found in data source schema.`);
    this.name = 'TableNotFoundError';
  }
}

export class ColumnNotFoundError extends Error {
  constructor(column: string, table: string) {
    super(`Column "${column}" not found in table "${table}".`);
    this.name = 'ColumnNotFoundError';
  }
}
