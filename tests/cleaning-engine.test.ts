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
    { name: 'priority', displayName: 'Priority', type: 'TEXT', semanticType: 'BOOLEAN', nullable: true, hint: null },
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
    expect(result.summary).toMatchObject({
      affectedRows: 2,
      affectedCells: 4,
      parseFailures: 1,
      parseFailureSamples: [{
        rowId: 2,
        column: 'date',
        value: '09/08/2026',
        reason: 'invalid_or_ambiguous_date',
      }],
    });
  });

  it('drops exact duplicates while preserving the first physical row', () => {
    const result = executeCleaningRecipe([
      { _row_id: 1, name: 'A', amount: null, date: null },
      { _row_id: 2, name: 'A', amount: null, date: null },
    ], table, { name: 'dedupe', steps: [{ type: 'drop_duplicates' }] });
    expect(result.rows.map((row) => row._row_id)).toEqual([1]);
    expect(result.summary).toMatchObject({
      removedRows: 1,
      affectedRows: 1,
      removedRowSamples: [{
        rowId: 2,
        reason: 'duplicate',
        keptRowId: 1,
        columns: ['name', 'amount', 'date', 'priority'],
        match: 'all_columns',
      }],
    });
  });

  it('preserves distinct integers beyond JavaScript safe integer range', () => {
    const result = executeCleaningRecipe([
      { _row_id: 1, name: 'A', amount: '9007199254740992', date: null, priority: null },
      { _row_id: 2, name: 'A', amount: '9007199254740993', date: null, priority: null },
    ], table, buildPresetRecipe(table, 'standard'));

    expect(result.rows.map((row) => row.amount)).toEqual([
      '9007199254740992',
      '9007199254740993',
    ]);
    expect(result.summary).toMatchObject({
      outputRows: 2,
      removedRows: 0,
      affectedCells: 0,
      parseFailures: 0,
    });
  });

  it('preserves formatting of already-valid plain numeric text', () => {
    const result = executeCleaningRecipe([
      { _row_id: 1, name: 'A', amount: '00123', date: null, priority: null },
      { _row_id: 2, name: 'B', amount: '1.2300', date: null, priority: null },
    ], table, {
      name: 'numeric format preservation',
      steps: [{
        type: 'normalize_numeric',
        columns: ['amount'],
        percentageMode: 'decimal',
        onError: 'keep_original',
      }],
    });

    expect(result.rows.map((row) => row.amount)).toEqual(['00123', '1.2300']);
    expect(result.summary.affectedCells).toBe(0);
  });

  it('normalizes grouped and percentage decimals without losing precision', () => {
    const result = executeCleaningRecipe([
      {
        _row_id: 1,
        name: 'A',
        amount: '9,007,199,254,740,993',
        date: null,
        priority: null,
      },
      {
        _row_id: 2,
        name: 'B',
        amount: '12.34567890123456789%',
        date: null,
        priority: null,
      },
      { _row_id: 3, name: 'C', amount: '12,34', date: null, priority: null },
    ], table, {
      name: 'precise numeric',
      steps: [{
        type: 'normalize_numeric',
        columns: ['amount'],
        percentageMode: 'decimal',
        onError: 'keep_original',
      }],
    });

    expect(result.rows.map((row) => row.amount)).toEqual([
      '9007199254740993',
      '0.1234567890123456789',
      '12,34',
    ]);
    expect(result.summary.parseFailureSamples).toEqual([{
      rowId: 3,
      column: 'amount',
      value: '12,34',
      reason: 'invalid_numeric',
    }]);
  });

  it('reports transformations on rows later removed as duplicates', () => {
    const result = executeCleaningRecipe([
      { _row_id: 1, name: 'A', amount: '9,007', date: null, priority: null },
      { _row_id: 2, name: 'A', amount: '9007', date: null, priority: null },
    ], table, buildPresetRecipe(table, 'standard'));

    expect(result.rows.map((row) => row._row_id)).toEqual([1]);
    expect(result.summary).toMatchObject({
      outputRows: 1,
      affectedRows: 2,
      affectedCells: 1,
      removedRows: 1,
      samples: [{ rowId: 1, column: 'amount', before: '9,007', after: '9007' }],
      removedRowSamples: [{
        rowId: 2,
        reason: 'duplicate',
        keptRowId: 1,
        match: 'all_columns',
      }],
    });
  });

  it('makes aggressive parse-null behavior explicit in the recipe', () => {
    const recipe = buildPresetRecipe(table, 'aggressive');
    expect(recipe.steps).toContainEqual(expect.objectContaining({
      type: 'normalize_numeric', percentageMode: 'decimal', onError: 'set_null',
    }));
    expect(recipe.steps).toContainEqual(expect.objectContaining({
      type: 'normalize_boolean', onError: 'set_null',
    }));
  });

  it('normalizes percentage and boolean variants before exact deduplication', () => {
    const result = executeCleaningRecipe([
      { _row_id: 1, name: 'Acme', amount: '15%', date: '2026/9/8', priority: 'Y' },
      { _row_id: 2, name: 'Acme', amount: '0.15', date: '2026-09-08', priority: 'true' },
    ], table, buildPresetRecipe(table, 'standard'));

    expect(result.rows).toEqual([
      { _row_id: 1, name: 'Acme', amount: '0.15', date: '2026-09-08', priority: 'true' },
    ]);
    expect(result.summary).toMatchObject({ outputRows: 1, removedRows: 1, parseFailures: 0 });
  });

  it('keeps standard parse failures, exposes samples, and lets aggressive null numeric and boolean failures', () => {
    const input = [
      { _row_id: 1, name: 'Acme', amount: 'bad%', date: '09/08/2026', priority: 'UNKNOWN' },
    ];
    const standard = executeCleaningRecipe(input, table, buildPresetRecipe(table, 'standard'));
    expect(standard.rows[0]).toMatchObject({ amount: 'bad%', date: '09/08/2026', priority: 'UNKNOWN' });
    expect(standard.summary).toMatchObject({
      parseFailures: 3,
      generatedNulls: 0,
      parseFailureSamples: [
        { rowId: 1, column: 'amount', value: 'bad%', reason: 'invalid_numeric' },
        { rowId: 1, column: 'date', value: '09/08/2026', reason: 'invalid_or_ambiguous_date' },
        { rowId: 1, column: 'priority', value: 'UNKNOWN', reason: 'invalid_boolean' },
      ],
    });

    const aggressive = executeCleaningRecipe(input, table, buildPresetRecipe(table, 'aggressive'));
    expect(aggressive.rows[0]).toMatchObject({ amount: null, date: '09/08/2026', priority: null });
    expect(aggressive.summary).toMatchObject({ parseFailures: 3, generatedNulls: 2 });
  });

  it('rejects overlapping boolean mappings', () => {
    const recipe: CleaningRecipe = {
      name: 'invalid boolean map',
      steps: [{
        type: 'normalize_boolean',
        columns: ['priority'],
        trueValues: ['yes'],
        falseValues: ['YES'],
        onError: 'keep_original',
      }],
    };
    expect(() => executeCleaningRecipe([], table, recipe)).toThrow(
      'Boolean trueValues and falseValues must not overlap.',
    );
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

  it('computes mean and median fills without floating-point precision loss', () => {
    const input = [
      { _row_id: 1, name: 'A', amount: '9007199254740992', date: null },
      { _row_id: 2, name: 'B', amount: null, date: null },
      { _row_id: 3, name: 'C', amount: '9007199254740993', date: null },
    ];

    const mean = executeCleaningRecipe(input, table, {
      name: 'mean', steps: [{ type: 'fill_missing', column: 'amount', strategy: 'mean' }],
    });
    const median = executeCleaningRecipe(input, table, {
      name: 'median', steps: [{ type: 'fill_missing', column: 'amount', strategy: 'median' }],
    });

    expect(mean.rows[1].amount).toBe('9007199254740992.5');
    expect(median.rows[1].amount).toBe('9007199254740992.5');
  });

  it('requires an explicit policy instead of rounding a repeating mean', () => {
    expect(() => executeCleaningRecipe([
      { _row_id: 1, name: 'A', amount: '1', date: null },
      { _row_id: 2, name: 'B', amount: '2', date: null },
      { _row_id: 3, name: 'C', amount: '2', date: null },
      { _row_id: 4, name: 'D', amount: null, date: null },
    ], table, {
      name: 'mean', steps: [{ type: 'fill_missing', column: 'amount', strategy: 'mean' }],
    })).toThrow('Mean fill would require implicit rounding');
  });

  it('rejects columns outside the physical table allowlist', () => {
    expect(() => executeCleaningRecipe([{ _row_id: 1, name: 'A' }], table, {
      name: 'bad', steps: [{ type: 'trim_whitespace', columns: ['secret'] }],
    })).toThrow('Unknown cleaning column');
  });
});
