import { describe, expect, it } from 'vitest';
import { profileTableRows, rowsToProfileMatrix } from '../src/lib/data-sources/profile-service';
import type { DiscoveredTable } from '../src/lib/data-sources/types';

const table: DiscoveredTable = {
  name: 'ds_12345678_1234_1234_1234_123456789abc',
  displayName: 'sample.csv',
  rowCount: 2,
  columns: [
    { name: 'name', displayName: 'Name', type: 'TEXT', semanticType: 'TEXT', nullable: false, hint: null },
    { name: 'amount', displayName: 'Amount', type: 'TEXT', semanticType: 'NUMERIC', nullable: true, hint: null },
  ],
};

describe('profile service', () => {
  it('keeps schema column order and preserves SQL NULL separately from empty text', () => {
    expect(rowsToProfileMatrix([{ amount: null, name: 'A' }], table)).toEqual([['A', null]]);
  });

  it('profiles current rows rather than the upload snapshot', () => {
    const result = profileTableRows([
      { name: 'A', amount: '10' },
      { name: 'A', amount: 'bad' },
    ], table);
    expect(result.columns.amount.nonMatchingCount).toBe(1);
    expect(result.table.duplicateRowCount).toBe(0);
  });
});
