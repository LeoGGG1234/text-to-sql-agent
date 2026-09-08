import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readSheet: vi.fn(),
}));

vi.mock('read-excel-file/node', () => ({
  readSheet: mocks.readSheet,
}));

import { parseXlsxTable } from '../src/lib/data-sources/excel-parser';

describe('parseXlsxTable', () => {
  beforeEach(() => vi.clearAllMocks());

  it('preserves text, decimals and boolean values and normalizes dates', async () => {
    mocks.readSheet.mockResolvedValue([
      [' Name ', 'Amount', 'Active', 'Date'],
      [' Alice ', '123.4500', true, new Date('2026-09-08T00:00:00.000Z')],
      [null, null, null, null],
    ]);

    await expect(parseXlsxTable(Buffer.from('xlsx'))).resolves.toEqual({
      ok: true,
      headers: [' Name ', 'Amount', 'Active', 'Date'],
      rows: [[' Alice ', '123.4500', 'true', '2026-09-08']],
    });

    const options = mocks.readSheet.mock.calls[0][1];
    expect(options.trim).toBe(false);
    expect(options.parseNumber('123.4500')).toBe('123.4500');
  });

  it('returns a controlled error for malformed workbooks', async () => {
    mocks.readSheet.mockRejectedValue(new Error('INVALID_ZIP'));

    await expect(parseXlsxTable(Buffer.from('invalid'))).resolves.toEqual({
      ok: false,
      error: 'INVALID_ZIP',
    });
  });
});
