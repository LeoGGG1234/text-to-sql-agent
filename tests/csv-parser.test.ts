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
});
