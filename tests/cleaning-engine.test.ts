import { describe, expect, it } from 'vitest';
import { buildPresetRecipe, executeCleaningRecipe } from '../src/lib/data-sources/cleaning-engine';
import type { CleaningRecipe } from '../src/lib/data-sources/cleaning-types';
import type { DiscoveredTable } from '../src/lib/data-sources/types';

const table: DiscoveredTable = {
  name: 'ds_12345678_1234_1234_1234_123456789abc', displayName: 'sample.csv', rowCount: 3,
  columns: [
    { name: 'name', displayName: 'Name', type: 'TEXT', semanticType: 'TEXT', nullable: false, hint: null },
    { name: 'amount', displayName: 'Amount', type: 'TEXT', semanticType: 'NUMERIC', nullable: true, hint: null },
    { name: 'date', displayName: 'Date', type: 'TEXT', semanticType: 'DATE', nullable: true, hint: null },
  ],
};

describe('deterministic cleaning engine', () => {
  it('normalizes text, numbers and unambiguous dates and reports the diff', () => {
    const recipe: CleaningRecipe = { name: 'test', steps: [
      { type: 'normalize_whitespace', columns: ['name'] },
      { type: 'normalize_numeric', columns: ['amount'], percentageMode: 'decimal', onError: 'keep_original' },
      { type: 'normalize_date', columns: ['date'], onAmbiguous: 'keep_original' },
    ] };
    const result = executeCleaningRecipe([
      { _row_id: 1, name: '  Apple   Inc ', amount: '￥1,230', date: '2026/9/8' },
      { _row_id: 2, name: 'Beta', amount: '12.5%', date: '09/08/2026' },
    ], table, recipe);
    expect(result.rows[0]).toMatchObject({ name: 'Apple Inc', amount: '1230', date: '2026-09-08' });
    expect(result.rows[1]).toMatchObject({ amount: '0.125', date: '09/08/2026' });
    expect(result.summary).toMatchObject({ affectedRows: 2, affectedCells: 4, parseFailures: 1 });
  });

  it('drops exact duplicates while preserving the first physical row', () => {
    const result = executeCleaningRecipe([
      { _row_id: 1, name: 'A', amount: null, date: null },
      { _row_id: 2, name: 'A', amount: null, date: null },
    ], table, { name: 'dedupe', steps: [{ type: 'drop_duplicates' }] });
    expect(result.rows.map((row) => row._row_id)).toEqual([1]);
    expect(result.summary).toMatchObject({ removedRows: 1, affectedRows: 1 });
  });

  it('makes aggressive parse-null behavior explicit in the recipe', () => {
    const recipe = buildPresetRecipe(table, 'aggressive');
    expect(recipe.steps).toContainEqual(expect.objectContaining({ type: 'normalize_numeric', onError: 'set_null' }));
  });

  it('excludes missing values from mean and median fill calculations', () => {
    const input = [
      { _row_id: 1, name: 'A', amount: '10', date: null },
      { _row_id: 2, name: 'B', amount: null, date: null },
      { _row_id: 3, name: 'C', amount: '20', date: null },
    ];

    const mean = executeCleaningRecipe(input, table, {
      name: 'mean', steps: [{ type: 'fill_missing', column: 'amount', strategy: 'mean' }],
    });
    const median = executeCleaningRecipe(input, table, {
      name: 'median', steps: [{ type: 'fill_missing', column: 'amount', strategy: 'median' }],
    });

    expect(mean.rows[1].amount).toBe('15');
    expect(median.rows[1].amount).toBe('15');
  });

  it('rejects columns outside the physical table allowlist', () => {
    expect(() => executeCleaningRecipe([{ _row_id: 1, name: 'A' }], table, {
      name: 'bad', steps: [{ type: 'trim_whitespace', columns: ['secret'] }],
    })).toThrow('Unknown cleaning column');
  });
});
