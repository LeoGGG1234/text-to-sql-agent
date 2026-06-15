/**
 * Unit tests for eval result-set comparison.
 *
 * These guard the heart of the execution-accuracy metric: two result sets
 * should compare equal when they carry the same data, regardless of row order,
 * column aliasing, or numeric formatting (string vs number, trailing zeros).
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

  it('matches regardless of row order', () => {
    const a = [{ tier: 'Gold', n: 10 }, { tier: 'Silver', n: 20 }];
    const b = [{ tier: 'Silver', n: 20 }, { tier: 'Gold', n: 10 }];
    expect(resultSetsMatch(a, b)).toBe(true);
  });

  it('tolerates small floating point differences', () => {
    expect(resultSetsMatch([{ v: 99.99 }], [{ v: 100.0 }], 0.01)).toBe(true);
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
});
