/**
 * Unit tests for eval result-set comparison.
 *
 * These guard the heart of the execution-accuracy metric: two result sets
 * should compare equal when they carry the same data under an explicit case
 * policy, regardless of column aliases or equivalent numeric formatting.
 */

import { describe, it, expect } from 'vitest';
import { resultSetsMatch } from '../eval/metrics';

describe('resultSetsMatch', () => {
  it('matches identical single-value results', () => {
    expect(
      resultSetsMatch([{ customer_count: 500 }], [{ customer_count: 500 }]),
    ).toBe(true);
  });

  it('matches despite different column aliases', () => {
    expect(resultSetsMatch([{ n: 500 }], [{ customer_count: 500 }])).toBe(true);
  });

  it('matches numeric-as-string (HTTP driver) vs number', () => {
    expect(resultSetsMatch([{ total: '1234.50' }], [{ total: 1234.5 }])).toBe(
      true,
    );
  });

  it('normalizes database date objects and midnight ISO strings', () => {
    expect(resultSetsMatch(
      [{ day: new Date('2026-09-08T00:00:00.000Z') }],
      [{ day: '2026-09-08T00:00:00.000Z' }],
    )).toBe(true);
  });

  it('matches regardless of row order', () => {
    const a = [{ tier: 'Gold', n: 10 }, { tier: 'Silver', n: 20 }];
    const b = [{ tier: 'Silver', n: 20 }, { tier: 'Gold', n: 10 }];
    expect(resultSetsMatch(a, b)).toBe(true);
  });

  it('enforces row order only when the case contract requires it', () => {
    const a = [{ status: 'closed' }, { status: 'open' }];
    const b = [{ status: 'open' }, { status: 'closed' }];
    expect(resultSetsMatch(a, b)).toBe(true);
    expect(resultSetsMatch(a, b, { orderMatters: true })).toBe(false);
  });

  it('requires exact numeric results by default', () => {
    expect(resultSetsMatch([{ v: 500 }], [{ v: 505 }])).toBe(false);
    expect(resultSetsMatch([{ v: 99.99 }], [{ v: 100 }])).toBe(false);
  });

  it('supports an explicit absolute numeric tolerance', () => {
    expect(resultSetsMatch(
      [{ v: 99.99 }],
      [{ v: 100 }],
      { numericTolerance: 0.01 },
    )).toBe(true);
    expect(resultSetsMatch(
      [{ v: 99 }],
      [{ v: 100 }],
      { numericTolerance: 0.01 },
    )).toBe(false);
  });

  it('compares large integers without converting them to Number', () => {
    expect(resultSetsMatch(
      [{ v: '9007199254740992' }],
      [{ v: '9007199254740993' }],
    )).toBe(false);
  });

  it('rejects different row counts', () => {
    expect(resultSetsMatch([{ v: 1 }], [{ v: 1 }, { v: 2 }])).toBe(false);
  });

  it('rejects genuinely different values', () => {
    expect(resultSetsMatch([{ v: 100 }], [{ v: 200 }])).toBe(false);
  });

  it('treats two empty sets as equal', () => {
    expect(resultSetsMatch([], [])).toBe(true);
  });

  it('matches multi-column rows', () => {
    const a = [{ name: 'Widget', rev: 5000 }];
    const b = [{ product_name: 'Widget', total_revenue: '5000.00' }];
    expect(resultSetsMatch(a, b)).toBe(true);
  });

  it('allows case-approved explanatory columns and joined text', () => {
    expect(resultSetsMatch(
      [{ customer_name: 'Nichole Hahn', email: 'n@example.com', spent: '100.00' }],
      [{ first_name: 'Nichole', last_name: 'Hahn', spent: '100' }],
      { allowCandidateExtraColumns: true, textContainment: true },
    )).toBe(true);
    expect(resultSetsMatch(
      [{ product_name: 'Widget', price: '8.07' }],
      [{ lowest_price: '8.07' }],
      { allowCandidateExtraColumns: true },
    )).toBe(true);
  });

  it('does not match text fragments inside a different word', () => {
    expect(resultSetsMatch(
      [{ customer_name: 'Joanne Smith', spent: '100.00' }],
      [{ first_name: 'Ann', last_name: 'Smith', spent: '100' }],
      { allowCandidateExtraColumns: true, textContainment: true },
    )).toBe(false);
  });

  it('does not ignore explanatory columns without an explicit case contract', () => {
    expect(resultSetsMatch(
      [{ product_name: 'Widget', price: '8.07' }],
      [{ lowest_price: '8.07' }],
    )).toBe(false);
  });

  it('normalizes month labels in the case timezone', () => {
    expect(resultSetsMatch(
      [{ month: '2025-01', sales: '100' }],
      [{ month: new Date('2024-12-31T16:00:00.000Z'), sales: '100' }],
      {
        period: { columnIndex: 0, granularity: 'month', timeZone: 'Asia/Shanghai' },
        orderMatters: true,
      },
    )).toBe(true);
  });

  it('normalizes quarter numbers using the case year', () => {
    expect(resultSetsMatch(
      [{ quarter: '1', orders: '838' }],
      [{ quarter: new Date('2025-12-31T16:00:00.000Z'), orders: '838' }],
      {
        period: {
          columnIndex: 0,
          granularity: 'quarter',
          timeZone: 'Asia/Shanghai',
          year: 2026,
        },
      },
    )).toBe(true);
  });

  it('fails closed for an invalid comparison timezone', () => {
    expect(resultSetsMatch(
      [{ month: '2025-01-01T00:00:00.000Z' }],
      [{ month: '2025-01' }],
      {
        period: { columnIndex: 0, granularity: 'month', timeZone: 'Not/AZone' },
      },
    )).toBe(false);
  });

  it('rejects swapped projected values instead of treating rows as value bags', () => {
    expect(resultSetsMatch([{ first: 10, second: 20 }], [{ a: 20, b: 10 }])).toBe(false);
  });
});
