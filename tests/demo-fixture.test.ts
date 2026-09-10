import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { executeCleaningRecipe, buildPresetRecipe } from '@/lib/data-sources/cleaning-engine';
import { parseCsvTable } from '@/lib/data-sources/csv-parser';
import {
  analyzeQuality,
  countStoredWhitespaceByColumn,
} from '@/lib/data-sources/quality-analyzer';
import { detectColumns, normalizeFullWidth } from '@/lib/data-sources/type-detector';
import type { CleaningRow } from '@/lib/data-sources/cleaning-types';
import type { DiscoveredTable } from '@/lib/data-sources/types';

const fixtureUrl = new URL('../docs/demo-data/dirty-sales-orders.csv', import.meta.url);

describe('reproducible cleaning demo fixture', () => {
  it('keeps the documented upload, cleaning, and analysis oracle executable', () => {
    const parsed = parseCsvTable(readFileSync(fixtureUrl, 'utf8'));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const inferenceRows = parsed.rows.map((row) =>
      parsed.headers.map((_header, index) =>
        normalizeFullWidth(row[index] ?? '').trim(),
      ),
    );
    const columns = detectColumns(parsed.headers, inferenceRows);
    const table: DiscoveredTable = {
      name: 'demo_dirty_sales_orders',
      displayName: 'dirty-sales-orders.csv',
      rowCount: parsed.rows.length,
      columns,
    };
    const rows: CleaningRow[] = parsed.rows.map((row, index) => ({
      _row_id: index + 1,
      ...Object.fromEntries(
        columns.map((column, columnIndex) => [column.name, row[columnIndex] ?? '']),
      ),
    }));

    expect(parsed.rows).toHaveLength(16);
    expect(columns).toHaveLength(10);
    expect(Object.fromEntries(columns.map((column) => [column.name, column.semanticType])))
      .toEqual(expect.objectContaining({
        amount: 'NUMERIC',
        discount_rate: 'NUMERIC',
        order_date: 'DATE',
        is_priority: 'BOOLEAN',
      }));

    const rawProfile = analyzeQuality(
      parsed.headers,
      parsed.rows,
      columns,
      countStoredWhitespaceByColumn(parsed.rows, parsed.headers.length),
    );
    expect(rawProfile.table.duplicateRowCount).toBe(0);
    expect(rawProfile.columns.amount.nonMatchingCount).toBe(2);
    expect(rawProfile.columns.discount_rate.nonMatchingCount).toBe(3);
    expect(rawProfile.columns.order_date).toEqual(expect.objectContaining({
      invalidCount: 1,
      ambiguousCount: 1,
      nonMatchingCount: 2,
    }));
    expect(rawProfile.columns.is_priority).toEqual(expect.objectContaining({
      invalidCount: 1,
      nullMarkerCount: 1,
    }));

    const result = executeCleaningRecipe(rows, table, buildPresetRecipe(table, 'standard'));
    expect(result.summary).toEqual(expect.objectContaining({
      inputRows: 16,
      outputRows: 15,
      affectedRows: 12,
      affectedCells: 20,
      removedRows: 1,
      generatedNulls: 2,
      parseFailures: 5,
    }));
    expect(result.summary.removedRowSamples).toEqual([
      expect.objectContaining({ rowId: 2, keptRowId: 1, reason: 'duplicate' }),
    ]);

    const sigma = result.rows.find((row) => row.order_id === 'ORD-012');
    expect(sigma).toEqual(expect.objectContaining({
      amount: 'not-a-number',
      discount_rate: 'bad%',
      is_priority: 'UNKNOWN',
    }));
    expect(result.rows.find((row) => row.order_id === 'ORD-007')?.order_date)
      .toBe('09/07/2026');
    expect(result.rows.find((row) => row.order_id === 'ORD-011')?.order_date)
      .toBe('2026-13-01');

    const statusCounts = Object.fromEntries(
      ['Won', 'Open', 'In Progress', 'Lost'].map((status) => [
        status,
        result.rows.filter((row) => row.status === status).length,
      ]),
    );
    expect(statusCounts).toEqual({
      Won: 5,
      Open: 5,
      'In Progress': 4,
      Lost: 1,
    });
  });
});
