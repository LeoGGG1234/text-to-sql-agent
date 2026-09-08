import * as Papa from 'papaparse';
import type { CleaningRow } from './cleaning-types';
import type { DiscoveredTable } from './types';

const UTF8_BOM = '\uFEFF';
const FORMULA_LIKE_VALUE = /^(?:[\t\r]|[\u0000-\u0020]*[=+\-@])/;

/** Serialize user columns only. Formula-like values are escaped for spreadsheet safety. */
export function createCsvExport(table: DiscoveredTable, rows: CleaningRow[]): string {
  const fields = table.columns.map((column) => column.displayName || column.name);
  const data = rows.map((row) => table.columns.map((column) => row[column.name] ?? null));
  return UTF8_BOM + Papa.unparse(
    { fields, data },
    { header: true, newline: '\r\n', escapeFormulae: FORMULA_LIKE_VALUE },
  );
}

export function createCsvFileName(displayName: string): string {
  const base = displayName
    .replace(/\.(?:csv|xlsx?|xls)$/i, '')
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, '-')
    .replace(/^\.+|\.+$/g, '')
    .trim()
    .slice(0, 100);
  return `${base || 'data'}-export.csv`;
}

export function csvContentDisposition(fileName: string): string {
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="data-export.csv"; filename*=UTF-8''${encoded}`;
}
