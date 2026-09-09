import { describe, expect, it } from 'vitest';
import { parseCsvTable } from '../src/lib/data-sources/csv-parser';

describe('parseCsvTable', () => {
  it('accepts a valid two-column CSV when delimiter detection falls back to comma', () => {
    expect(parseCsvTable('name,amount\nalpha,10\nbeta,20\n')).toEqual({
      ok: true,
      headers: ['name', 'amount'],
      rows: [
        ['alpha', '10'],
        ['beta', '20'],
      ],
    });
  });

  it('still rejects fatal CSV parse errors', () => {
    const result = parseCsvTable('name,amount\n"unterminated,10');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/quote/i);
  });

  it('rejects a row with extra fields instead of silently truncating it', () => {
    const result = parseCsvTable(
      'name,amount\nalpha,10,valuable_extra\nbeta,20,different_extra\n',
    );

    expect(result).toEqual({
      ok: false,
      error: 'Row 2 has 3 fields; expected 2 based on the header.',
    });
  });

  it('rejects a row with missing fields and reports its record number', () => {
    const result = parseCsvTable('name,amount\nalpha,10\nbeta\n');

    expect(result).toEqual({
      ok: false,
      error: 'Row 3 has 1 fields; expected 2 based on the header.',
    });
  });

  it('ignores fully blank records when validating row width', () => {
    expect(parseCsvTable('name,amount\n\nalpha,10\n')).toEqual({
      ok: true,
      headers: ['name', 'amount'],
      rows: [['alpha', '10']],
    });
  });
});
