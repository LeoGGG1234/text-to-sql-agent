import { describe, expect, it } from 'vitest';
import { matchesTextMarker, parseDateValue } from '../src/lib/data-sources/value-parsers';

describe('matchesTextMarker', () => {
  it('matches configured markers case-insensitively after trimming', () => {
    expect(matchesTextMarker('  NONE ', ['none', 'n/a'])).toBe(true);
    expect(matchesTextMarker('value', ['none', 'n/a'])).toBe(false);
  });
});

describe('parseDateValue', () => {
  it('normalizes calendar-valid year-first dates', () => {
    expect(parseDateValue('2026/9/8')).toEqual({
      status: 'valid',
      normalized: '2026-09-08',
    });
  });

  it('rejects calendar-invalid year-first dates', () => {
    expect(parseDateValue('2026-02-31')).toEqual({ status: 'invalid' });
    expect(parseDateValue('2026-13-01')).toEqual({ status: 'invalid' });
  });

  it('does not guess an ambiguous day/month order or two-digit year', () => {
    expect(parseDateValue('09/08/2026')).toEqual({ status: 'ambiguous' });
    expect(parseDateValue('01/02/26')).toEqual({ status: 'ambiguous' });
  });

  it('normalizes a year-last date only when one ordering is possible', () => {
    expect(parseDateValue('13/04/2026')).toEqual({
      status: 'valid',
      normalized: '2026-04-13',
    });
    expect(parseDateValue('04/13/2026')).toEqual({
      status: 'valid',
      normalized: '2026-04-13',
    });
  });

  it('distinguishes unrelated text from malformed date-shaped values', () => {
    expect(parseDateValue('not a date')).toEqual({ status: 'not_date' });
  });
});
