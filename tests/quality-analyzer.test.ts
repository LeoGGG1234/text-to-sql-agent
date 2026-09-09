/**
 * Unit tests for the data quality analyzer.
 *
 * Covers: NULL-like detection, non-matching type values, duplicate rows,
 * whitespace tracking, length stats, buildQualityNote semantics, and edge cases.
 */

import { describe, it, expect } from 'vitest';
import { analyzeQuality, buildQualityNote, buildTableQualityNote, rowKey } from '../src/lib/data-sources/quality-analyzer';
import { detectColumns, normalizeFullWidth } from '../src/lib/data-sources/type-detector';
import type { DiscoveredColumn, ColumnProfile } from '../src/lib/data-sources/types';

// Helper: create a simple DiscoveredColumn for testing.
function makeCol(name: string, st: DiscoveredColumn['semanticType']): DiscoveredColumn {
  return {
    name,
    displayName: name,
    type: 'TEXT',
    semanticType: st,
    nullable: true,
    hint: null,
  };
}

describe('detectColumns — semantic inference inputs', () => {
  it('excludes NULL-like markers from type confidence', () => {
    const [column] = detectColumns(
      ['amount'],
      [['100'], ['200'], ['N/A'], ['无'], ['NULL']],
    );

    expect(column).toMatchObject({ semanticType: 'NUMERIC', nullable: true });
  });
});

describe('analyzeQuality — Q1 NULL-like detection', () => {
  it('detects empty strings as NULL-like', () => {
    const rows = [[''], [''], ['']];
    const cols = [makeCol('col1', 'TEXT')];
    const result = analyzeQuality(['col1'], rows, cols, [0]);
    expect(result.columns.col1.nullMarkerCount).toBe(3);
    expect(result.columns.col1.nullMarkerSamples?.['(empty)']).toBe(3);
  });

  it('detects "N/A" and "n/a" as NULL-like', () => {
    const rows = [['N/A'], ['n/a'], ['valid']];
    const cols = [makeCol('col1', 'TEXT')];
    const result = analyzeQuality(['col1'], rows, cols, [0]);
    expect(result.columns.col1.nullMarkerCount).toBe(2);
    expect(result.columns.col1.nullMarkerSamples?.['N/A']).toBe(1);
    expect(result.columns.col1.nullMarkerSamples?.['n/a']).toBe(1);
  });

  it('detects Chinese NULL indicators', () => {
    const rows = [['无'], ['暂无'], ['data']];
    const cols = [makeCol('col1', 'TEXT')];
    const result = analyzeQuality(['col1'], rows, cols, [0]);
    expect(result.columns.col1.nullMarkerCount).toBe(2);
  });

  it('detects "null"/"NULL"/"Null" variants', () => {
    const rows = [['null'], ['NULL'], ['Null'], ['real']];
    const cols = [makeCol('col1', 'TEXT')];
    const result = analyzeQuality(['col1'], rows, cols, [0]);
    expect(result.columns.col1.nullMarkerCount).toBe(3);
  });

  it('detects nil/None', () => {
    const rows = [['nil'], ['NONE']];
    const cols = [makeCol('col1', 'TEXT')];
    const result = analyzeQuality(['col1'], rows, cols, [0]);
    expect(result.columns.col1.nullMarkerCount).toBe(2);
  });

  it('returns 0 nullMarkerCount for clean data', () => {
    const rows = [['hello'], ['world']];
    const cols = [makeCol('col1', 'TEXT')];
    const result = analyzeQuality(['col1'], rows, cols, [0]);
    expect(result.columns.col1.nullMarkerCount).toBe(0);
  });

  it('distinguishes database NULL from an empty text marker', () => {
    const result = analyzeQuality(
      ['col1'],
      [[null], ['']],
      [makeCol('col1', 'TEXT')],
      [0],
    );

    expect(result.columns.col1.databaseNullCount).toBe(1);
    expect(result.columns.col1.nullMarkerCount).toBe(1);
  });
});

describe('analyzeQuality — Q2 non-matching type values', () => {
  it('flags non-numeric values in NUMERIC column', () => {
    const rows = [['100'], ['200'], ['N/A'], ['300'], ['bad']];
    const cols = [makeCol('amount', 'NUMERIC')];
    const result = analyzeQuality(['amount'], rows, cols, [0]);
    // 'N/A' is null-like → excluded. Non-null: 100, 200, 300, bad = 4 values.
    // Non-matching: 'bad' = 1. Ratio = 1/4 = 0.25.
    expect(result.columns.amount.nonMatchingCount).toBe(1);
    expect(result.columns.amount.nonMatchingRatio).toBeCloseTo(0.25, 2);
  });

  it('collects up to 3 non-matching samples', () => {
    const rows = Array.from({ length: 20 }, (_, i) => [
      i < 5 ? `bad_${i}` : String(i * 10),
    ]);
    const cols = [makeCol('amount', 'NUMERIC')];
    const result = analyzeQuality(['amount'], rows, cols, [0]);
    expect(result.columns.amount.nonMatchingCount).toBe(5);
    expect(result.columns.amount.nonMatchingSamples.length).toBeLessThanOrEqual(3);
  });

  it('does not flag non-matching for TEXT columns', () => {
    const rows = [['hello'], ['123'], ['!@#']];
    const cols = [makeCol('col1', 'TEXT')];
    const result = analyzeQuality(['col1'], rows, cols, [0]);
    expect(result.columns.col1.nonMatchingCount).toBe(0);
    expect(result.columns.col1.nonMatchingRatio).toBe(0);
  });

  it('flags non-date values in DATE column', () => {
    const rows = [['2026-01-15'], ['not a date'], ['2026/05/20']];
    const cols = [makeCol('date_col', 'DATE')];
    const result = analyzeQuality(['date_col'], rows, cols, [0]);
    // '2026-01-15' matches, 'not a date' doesn't, '2026/05/20' matches pattern 4.
    expect(result.columns.date_col.nonMatchingCount).toBe(1);
  });

  it('separates invalid calendar dates from ambiguous date values', () => {
    const result = analyzeQuality(
      ['date_col'],
      [['2026-02-31'], ['09/08/2026'], ['2026-09-08']],
      [makeCol('date_col', 'DATE')],
      [0],
    );

    expect(result.columns.date_col).toMatchObject({
      nonMatchingCount: 2,
      invalidCount: 1,
      ambiguousCount: 1,
    });
    expect(result.table.columnsWithIssues).toBe(1);
  });

  it('flags non-boolean values in BOOLEAN column', () => {
    const rows = [['true'], ['maybe'], ['false'], ['yes']];
    const cols = [makeCol('flag', 'BOOLEAN')];
    const result = analyzeQuality(['flag'], rows, cols, [0]);
    expect(result.columns.flag.nonMatchingCount).toBe(1); // 'maybe'
  });

  it('returns ratio 0 when all non-null values are null-like', () => {
    const rows = [['N/A'], ['n/a'], ['']];
    const cols = [makeCol('amount', 'NUMERIC')];
    const result = analyzeQuality(['amount'], rows, cols, [0]);
    // All are null-like → 0 non-null → nonMatchingRatio should be 0.
    expect(result.columns.amount.nonMatchingRatio).toBe(0);
  });
});

describe('analyzeQuality — Q3 duplicate rows', () => {
  it('detects exact duplicate rows', () => {
    const rows = [
      ['A', '100'],
      ['B', '200'],
      ['A', '100'], // duplicate of row 0
      ['C', '300'],
      ['A', '100'], // duplicate again
    ];
    const cols = [makeCol('name', 'TEXT'), makeCol('val', 'NUMERIC')];
    const result = analyzeQuality(['name', 'val'], rows, cols, [0, 0]);
    // 5 rows, 'A-100' appears 3 times → 2 dups (3 - 1).
    expect(result.table.duplicateRowCount).toBe(2);
    expect(result.table.duplicateRatio).toBeCloseTo(2 / 5);
  });

  it('returns 0 for no duplicates', () => {
    const rows = [['A'], ['B'], ['C']];
    const cols = [makeCol('col1', 'TEXT')];
    const result = analyzeQuality(['col1'], rows, cols, [0]);
    expect(result.table.duplicateRowCount).toBe(0);
    expect(result.table.duplicateRatio).toBe(0);
  });

  it('handles empty table gracefully', () => {
    const rows: string[][] = [];
    const cols: DiscoveredColumn[] = [];
    const result = analyzeQuality([], rows, cols, []);
    expect(result.table.duplicateRowCount).toBe(0);
    expect(result.table.duplicateRatio).toBe(0);
  });
});

describe('analyzeQuality — Q4 whitespace tracking', () => {
  it('records trimmed counts per column', () => {
    const rows = [['hello'], ['world']];
    const cols = [makeCol('col1', 'TEXT')];
    const result = analyzeQuality(['col1'], rows, cols, [5]);
    expect(result.columns.col1.trimmedCount).toBe(5);
  });

  it('defaults to 0 when no whitespace counts provided', () => {
    const rows = [['hello']];
    const cols = [makeCol('col1', 'TEXT')];
    const result = analyzeQuality(['col1'], rows, cols, [0]);
    expect(result.columns.col1.trimmedCount).toBe(0);
  });
});

describe('analyzeQuality — Q5 length stats', () => {
  it('computes min and max lengths', () => {
    const rows = [['hi'], ['hello'], ['greetings!'], ['']];
    const cols = [makeCol('col1', 'TEXT')];
    const result = analyzeQuality(['col1'], rows, cols, [0]);
    // '' is null-like (excluded from Q5 since we skip null-like),
    // so min = 2 ('hi'), max = 10 ('greetings!').
    expect(result.columns.col1.minLength).toBe(2);
    expect(result.columns.col1.maxLength).toBe(10);
  });

  it('returns min=0 max=0 when all values are null-like', () => {
    const rows = [['N/A'], ['']];
    const cols = [makeCol('col1', 'TEXT')];
    const result = analyzeQuality(['col1'], rows, cols, [0]);
    expect(result.columns.col1.minLength).toBe(0);
    expect(result.columns.col1.maxLength).toBe(0);
  });
});

describe('analyzeQuality — table-level stats', () => {
  it('counts columns with issues', () => {
    const rows = [
      ['100', 'good'],
      ['N/A', 'fine'],
      ['200', 'ok'],
    ];
    const cols = [
      makeCol('amount', 'NUMERIC'), // has a NULL-like text marker
      makeCol('name', 'TEXT'),      // clean
    ];
    const result = analyzeQuality(['amount', 'name'], rows, cols, [0, 0]);
    expect(result.table.columnsWithIssues).toBe(1);
    expect(result.table.totalColumns).toBe(2);
  });

  it('counts nonMatching as issue when > 5%', () => {
    const rows = [
      ['100'],
      ['bad'],
      ['200'],
    ];
    const cols = [makeCol('amount', 'NUMERIC')];
    const result = analyzeQuality(['amount'], rows, cols, [0]);
    // 1 non-matching out of 3 → 33% > 5%.
    expect(result.table.columnsWithIssues).toBe(1);
  });

  it('still counts a low-frequency invalid value as an observed issue', () => {
    const rows = Array.from({ length: 100 }, () => ['100']);
    rows.push(['bad']); // 1 out of 101 non-null → ~1%
    const cols = [makeCol('amount', 'NUMERIC')];
    const result = analyzeQuality(['amount'], rows, cols, [0]);
    // The ratio remains useful for severity, but one invalid value means the
    // column must not be labelled clean.
    expect(result.columns.amount.nonMatchingRatio).toBeLessThan(0.05);
    expect(result.table.columnsWithIssues).toBe(1);
  });
});

describe('analyzeQuality — real-world integration', () => {
  it('handles mixed clean/dirty columns with detectColumns', () => {
    const headers = ['amount($)', 'order_date', 'category', 'note'];
    const rows = [
      ['  100 ', '2026-01-15', 'Electronics', 'N/A'],
      ['200', '2026-02-20', 'Clothing', 'some note'],
      ['  N/A  ', '2026-03-10', 'Electronics', ''],
      ['350', 'bad-date', '  Clothing ', 'another'],
      ['42', '2026-05-01', 'Food', 'nil'],
    ];
    // Pre-trim whitespace counts.
    const whitespaceCounts = [2, 0, 1, 0]; // amount has spaces, category has spaces.
    const trimmedRows = rows.map((r) => r.map((c) => c.trim()));
    const columns = detectColumns(headers, trimmedRows);

    const result = analyzeQuality(headers, trimmedRows, columns, whitespaceCounts);

    // Q1: amount → "N/A" + empty(?) — wait, "  N/A  " after trim is "N/A" → null-like.
    //     note → "N/A", "", "nil" → 3 null-like.
    expect(result.columns.amount.nullMarkerCount).toBe(1); // "N/A"
    expect(result.columns.note.nullMarkerCount).toBe(3); // "N/A", "", "nil"

    // Q2: amount is NUMERIC (100, 200, N/A→null, 350, 42 → 4 numeric, 1 null-like = 4/4 non-null are numeric → 100%).
    //     But wait: "bad-date" in date column after trim... detectColumns would infer DATE type
    //     if >= 80% match. 4 out of 5 match 2026-XX-XX → 80% → exactly at threshold → DATE.
    //     So "bad-date" should be non-matching.
    // Actually 4/5 = 0.80 → >= CONFIDENCE_THRESHOLD (0.8) → DATE. So order_date is DATE.
    // non-null count: 5 (none are null-like). nonMatching: 1 ("bad-date"). ratio: 0.2.

    // Q4: whitespace tracking.
    expect(result.columns.amount.trimmedCount).toBe(2);
    expect(result.columns.category.trimmedCount).toBe(1);

    // Table level.
    expect(result.table.totalColumns).toBe(4);

    // No duplicates — all rows are different.
    expect(result.table.duplicateRowCount).toBe(0);
  });
});

describe('buildQualityNote — semantics, no regex', () => {
  it('generates non-matching warning with descriptive language', () => {
    const col = makeCol('amount', 'NUMERIC');
    const profile: ColumnProfile = {
      nullConvertedCount: 0,
      nullConvertedSamples: {},
      nonMatchingCount: 10,
      nonMatchingRatio: 0.12,
      nonMatchingSamples: ['N/A', '缺'],
      uniqueCount: 80,
      trimmedCount: 0,
      minLength: 1,
      maxLength: 10,
      fuzzyDuplicateClusters: 0,
      fuzzyDuplicateSamples: [],
    };
    const note = buildQualityNote(col, profile);
    expect(note).toContain('12%');
    expect(note).toContain('NUMERIC');
    expect(note).toContain('N/A');
    expect(note).toContain('NOT IN or a LIKE pattern');
    // Must NOT contain raw regex patterns.
    expect(note).not.toContain('~');
    expect(note).not.toContain('^[0-9]');
  });

  it('generates a legacy NULL conversion note with descriptive language', () => {
    const col = makeCol('amount', 'NUMERIC');
    const profile: ColumnProfile = {
      nullConvertedCount: 5,
      nullConvertedSamples: { 'N/A': 3, '无': 2 },
      nonMatchingCount: 0,
      nonMatchingRatio: 0,
      nonMatchingSamples: [],
      uniqueCount: 95,
      trimmedCount: 0,
      minLength: 1,
      maxLength: 10,
      fuzzyDuplicateClusters: 0,
      fuzzyDuplicateSamples: [],
    };
    const note = buildQualityNote(col, profile);
    expect(note).toContain('5 rows');
    expect(note).toContain('N/A');
    expect(note).toContain('无');
    expect(note).toContain('IS NOT NULL');
    // Must NOT contain raw regex.
    expect(note).not.toContain('~');
  });

  it('returns empty string for clean column', () => {
    const col = makeCol('name', 'TEXT');
    const profile: ColumnProfile = {
      nullConvertedCount: 0,
      nullConvertedSamples: {},
      nonMatchingCount: 0,
      nonMatchingRatio: 0,
      nonMatchingSamples: [],
      uniqueCount: 50,
      trimmedCount: 0,
      minLength: 2,
      maxLength: 20,
      fuzzyDuplicateClusters: 0,
      fuzzyDuplicateSamples: [],
    };
    const note = buildQualityNote(col, profile);
    expect(note).toBe('');
  });

  it('warns even when invalid values are below the old 5% threshold', () => {
    const col = makeCol('amount', 'NUMERIC');
    const profile: ColumnProfile = {
      nullConvertedCount: 0,
      nullConvertedSamples: {},
      nonMatchingCount: 2,
      nonMatchingRatio: 0.04,
      nonMatchingSamples: ['x'],
      uniqueCount: 100,
      trimmedCount: 0,
      minLength: 1,
      maxLength: 10,
      fuzzyDuplicateClusters: 0,
      fuzzyDuplicateSamples: [],
    };
    const note = buildQualityNote(col, profile);
    expect(note).toContain('2 values (4%)');
    expect(note).toContain('invalid or ambiguous NUMERIC');
  });

  it('distinguishes current text markers from database NULL in the Agent note', () => {
    const col = makeCol('amount', 'NUMERIC');
    const profile: ColumnProfile = {
      databaseNullCount: 1,
      nullMarkerCount: 2,
      nullMarkerSamples: { 'N/A': 2 },
      invalidCount: 0,
      ambiguousCount: 0,
      nonMatchingCount: 0,
      nonMatchingRatio: 0,
      nonMatchingSamples: [],
      uniqueCount: 2,
      trimmedCount: 0,
      minLength: 1,
      maxLength: 3,
      fuzzyDuplicateClusters: 0,
      fuzzyDuplicateSamples: [],
    };

    const note = buildQualityNote(col, profile);
    expect(note).toContain('1 rows contain database NULL');
    expect(note).toContain('2 rows contain NULL-like text markers');
    expect(note).toContain('still stored as text');
  });

  it('returns empty string when profile is undefined', () => {
    const col = makeCol('amount', 'NUMERIC');
    expect(buildQualityNote(col, undefined)).toBe('');
  });
});

describe('buildTableQualityNote', () => {
  it('warns about high duplicate ratio', () => {
    const profile = {
      duplicateRowCount: 300,
      duplicateRatio: 0.15,
      totalColumns: 5,
      columnsWithIssues: 2,
    };
    const note = buildTableQualityNote(profile);
    expect(note).toContain('15%');
    expect(note).toContain('300');
    expect(note).toContain('DISTINCT');
  });

  it('returns empty for low duplicate ratio', () => {
    const profile = {
      duplicateRowCount: 5,
      duplicateRatio: 0.02,
      totalColumns: 5,
      columnsWithIssues: 2,
    };
    const note = buildTableQualityNote(profile);
    // <= 10% → no note.
    expect(note).toBe('');
  });
});

describe('analyzeQuality — fuzzy duplicate detection', () => {
  it('detects near-duplicate values in TEXT column', () => {
    const rows = [
      ['Beijing Technology Co.'],
      ['Beijing Technology Co'],       // missing dot
      ['Shanghai Tech Ltd'],
      ['Shanghai Tech Ltd.'],          // extra dot
      ['Unique Corp'],
    ];
    const cols = [makeCol('company', 'TEXT')];
    const result = analyzeQuality(['company'], rows, cols, [0]);
    // "Beijing Technology Co." vs "Beijing Technology Co" — sim ~97%
    // "Shanghai Tech Ltd" vs "Shanghai Tech Ltd." — sim ~97%
    expect(result.columns.company.fuzzyDuplicateClusters).toBeGreaterThan(0);
    expect(result.columns.company.fuzzyDuplicateSamples.length).toBeGreaterThan(0);
    // All samples should have similarity >= 88.
    for (const s of result.columns.company.fuzzyDuplicateSamples) {
      expect(s.similarity).toBeGreaterThanOrEqual(88);
    }
  });

  it('skips fuzzy detection for non-TEXT columns', () => {
    const rows = [['100'], ['200'], ['300']];
    const cols = [makeCol('amount', 'NUMERIC')];
    const result = analyzeQuality(['amount'], rows, cols, [0]);
    expect(result.columns.amount.fuzzyDuplicateClusters).toBe(0);
    expect(result.columns.amount.fuzzyDuplicateSamples).toEqual([]);
  });

  it('returns 0 clusters and empty samples for clean data', () => {
    const rows = [
      ['Apple Inc.'],
      ['Microsoft Corporation'],
      ['Google LLC'],
      ['Amazon.com Inc.'],
    ];
    const cols = [makeCol('company', 'TEXT')];
    const result = analyzeQuality(['company'], rows, cols, [0]);
    expect(result.columns.company.fuzzyDuplicateClusters).toBe(0);
    expect(result.columns.company.fuzzyDuplicateSamples).toEqual([]);
  });

  it('handles column with very few distinct values', () => {
    const rows = [['A'], ['A'], ['A'], ['A']];
    const cols = [makeCol('single', 'TEXT')];
    const result = analyzeQuality(['single'], rows, cols, [0]);
    // Only 1 distinct value — no pairs to compare.
    expect(result.columns.single.fuzzyDuplicateClusters).toBe(0);
    expect(result.columns.single.fuzzyDuplicateSamples).toEqual([]);
  });

  it('counts fuzzy duplicates as a column issue', () => {
    const rows = [
      ['Beijing Tech Co.'],
      ['Beijing Tech Co'],
      ['unique'],
    ];
    const cols = [makeCol('company', 'TEXT')];
    const result = analyzeQuality(['company'], rows, cols, [0]);
    expect(result.table.columnsWithIssues).toBe(1);
  });
});

describe('buildQualityNote — fuzzy duplicate warnings', () => {
  it('includes fuzzy dup info in quality note', () => {
    const col = makeCol('company', 'TEXT');
    const profile: ColumnProfile = {
      nullConvertedCount: 0,
      nullConvertedSamples: {},
      nonMatchingCount: 0,
      nonMatchingRatio: 0,
      nonMatchingSamples: [],
      uniqueCount: 90,
      trimmedCount: 0,
      minLength: 2,
      maxLength: 30,
      fuzzyDuplicateClusters: 4,
      fuzzyDuplicateSamples: [
        { a: 'Beijing Tech Co.', b: 'Beijing Tech Co', similarity: 97 },
      ],
    };
    const note = buildQualityNote(col, profile);
    expect(note).toContain('Near-duplicate');
    expect(note).toContain('Beijing Tech Co.');
    expect(note).toContain('97%');
    expect(note).toContain('standardising');
    expect(note).toContain('GROUP BY');
    // Must NOT contain raw regex.
    expect(note).not.toContain('~');
  });

  it('omits fuzzy dup when clusters is 0', () => {
    const col = makeCol('company', 'TEXT');
    const profile: ColumnProfile = {
      nullConvertedCount: 0,
      nullConvertedSamples: {},
      nonMatchingCount: 0,
      nonMatchingRatio: 0,
      nonMatchingSamples: [],
      uniqueCount: 50,
      trimmedCount: 0,
      minLength: 2,
      maxLength: 30,
      fuzzyDuplicateClusters: 0,
      fuzzyDuplicateSamples: [],
    };
    const note = buildQualityNote(col, profile);
    expect(note).toBe('');
  });
});

describe('normalizeFullWidth', () => {
  it('converts full-width digits to half-width', () => {
    expect(normalizeFullWidth('１２３４５')).toBe('12345');
  });

  it('converts full-width uppercase letters', () => {
    expect(normalizeFullWidth('ＡＢＣ')).toBe('ABC');
  });

  it('converts full-width lowercase letters', () => {
    expect(normalizeFullWidth('ａｂｃ')).toBe('abc');
  });

  it('converts full-width period to half-width', () => {
    expect(normalizeFullWidth('１２３．４５')).toBe('123.45');
  });

  it('converts full-width space to half-width space', () => {
    const result = normalizeFullWidth('１００　元');
    expect(result).toBe('100 元');
  });

  it('preserves half-width alphanumeric characters', () => {
    expect(normalizeFullWidth('Hello123')).toBe('Hello123');
  });

  it('handles mixed full-width and half-width', () => {
    expect(normalizeFullWidth('ＡＢＣ１２３')).toBe('ABC123');
  });

  it('handles empty string', () => {
    expect(normalizeFullWidth('')).toBe('');
  });

  it('preserves Chinese characters', () => {
    expect(normalizeFullWidth('北京科技有限公司')).toBe('北京科技有限公司');
  });
});

describe('rowKey — memory-efficient duplicate detection', () => {
  it('produces deterministic keys for identical rows', () => {
    const k1 = rowKey(['a', 'b', 'c']);
    const k2 = rowKey(['a', 'b', 'c']);
    expect(k1).toBe(k2);
  });

  it('distinguishes rows with different values', () => {
    const k1 = rowKey(['a', 'b', 'c']);
    const k2 = rowKey(['a', 'b', 'd']);
    expect(k1).not.toBe(k2);
  });

  it('handles special characters including commas and quotes', () => {
    const k = rowKey(['hello, world', "it's fine", '"quoted"']);
    expect(k).toBe('12:hello, world|9:it\'s fine|8:"quoted"');
  });

  it('distinguishes database NULL, empty text, and delimiter-like values', () => {
    expect(rowKey([null])).not.toBe(rowKey(['']));
    expect(rowKey(['a|1:b'])).not.toBe(rowKey(['a', 'b']));
  });

  it('duplicate detection uses rowKey correctly', () => {
    // Integration: verify that rowKey-based duplicate detection works.
    const rows = [
      ['A', 'B', 'C'],
      ['D', 'E', 'F'],
      ['A', 'B', 'C'], // duplicate
    ];
    const cols = [makeCol('x', 'TEXT'), makeCol('y', 'TEXT'), makeCol('z', 'TEXT')];
    const result = analyzeQuality(['x', 'y', 'z'], rows, cols, [0, 0, 0]);
    expect(result.table.duplicateRowCount).toBe(1);
    expect(result.table.duplicateRatio).toBeCloseTo(1 / 3);
  });
});

describe('analyzeQuality — uniqueCount fix', () => {
  it('tracks uniqueCount for non-TEXT columns', () => {
    // 3 distinct values out of 5 non-null rows.
    const rows = [['100'], ['200'], ['100'], ['300'], ['200']];
    const cols = [makeCol('amount', 'NUMERIC')];
    const result = analyzeQuality(['amount'], rows, cols, [0]);
    // 5 non-null, 3 unique: 100, 200, 300.
    expect(result.columns.amount.uniqueCount).toBe(3);
  });

  it('does not track uniqueCount for TEXT columns', () => {
    const rows = [['hello'], ['world'], ['hello']];
    const cols = [makeCol('name', 'TEXT')];
    const result = analyzeQuality(['name'], rows, cols, [0]);
    // TEXT columns skip uniqueSet initialisation → uniqueCount stays 0.
    expect(result.columns.name.uniqueCount).toBe(0);
  });
});

describe('analyzeQuality — freq Map cardinality cap', () => {
  it('caps freq Map memory at MAX_FREQ_MAP_SIZE entries', () => {
    // Generate 15k rows with all unique values (simulating UUID column).
    const rows = Array.from({ length: 15_000 }, (_, i) => [`id_${i}`]);
    const cols = [makeCol('uuid_col', 'TEXT')];
    const result = analyzeQuality(['uuid_col'], rows, cols, [0]);
    // Should complete without OOM. Fuzzy dup should be 0 (all unique).
    expect(result.columns.uuid_col.fuzzyDuplicateClusters).toBe(0);
    expect(result.table.totalColumns).toBe(1);
  });
});

describe('benchmark — large dataset', () => {
  it('completes quality analysis for 100k rows under 3 seconds', () => {
    const headers = ['name', 'amount', 'date', 'category', 'note'];
    const rows = Array.from({ length: 100_000 }, (_, i) => [
      `User${i % 5000}`,
      String(Math.floor(Math.random() * 10000)),
      `2024-${String((i % 12) + 1).padStart(2, '0')}-01`,
      ['A', 'B', 'C', 'D'][i % 4],
      i % 50 === 0 ? 'N/A' : `note_${i}`,
    ]);
    const columns = detectColumns(headers, rows);
    const start = performance.now();
    const result = analyzeQuality(headers, rows, columns, [0, 0, 0, 0, 0]);
    const elapsed = performance.now() - start;
    // Quality analysis should complete well under 3s for 100k rows.
    expect(elapsed).toBeLessThan(3000);
    expect(result.table.totalColumns).toBe(5);
    // Row contents are mostly unique (unique note_${i}), so no full-row
    // duplicates beyond random collisions. Column-level stats should work.
    expect(result.table.duplicateRowCount).toBeGreaterThanOrEqual(0);
    // note column (index 4) has N/A every 50 rows → 2000 null-like values.
    expect(result.columns.note.nullMarkerCount).toBe(2_000);
  });
});
