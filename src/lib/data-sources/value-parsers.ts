export type DateValueResult =
  | { status: 'valid'; normalized: string }
  | { status: 'ambiguous' | 'invalid' | 'not_date' };

export function matchesTextMarker(
  value: string,
  markers: Iterable<string>,
): boolean {
  const normalized = value.trim().toLowerCase();
  for (const marker of markers) {
    if (normalized === marker.trim().toLowerCase()) return true;
  }
  return false;
}

function validDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function normalizedDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Parse only calendar dates whose interpretation is deterministic.
 *
 * Year-first dates are unambiguous. Four-digit year-last dates are accepted
 * only when exactly one of day-first or month-first is calendar-valid; values
 * such as 09/08/2026 remain ambiguous. Two-digit years are never guessed.
 */
export function parseDateValue(value: string): DateValueResult {
  const text = value.trim();
  const yearFirst = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (yearFirst) {
    const year = Number(yearFirst[1]);
    const month = Number(yearFirst[2]);
    const day = Number(yearFirst[3]);
    return validDate(year, month, day)
      ? { status: 'valid', normalized: normalizedDate(year, month, day) }
      : { status: 'invalid' };
  }

  const yearLast = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (yearLast) {
    const first = Number(yearLast[1]);
    const second = Number(yearLast[2]);
    const year = Number(yearLast[3]);
    const monthFirstValid = validDate(year, first, second);
    const dayFirstValid = validDate(year, second, first);
    if (monthFirstValid && dayFirstValid) return { status: 'ambiguous' };
    if (monthFirstValid) {
      return { status: 'valid', normalized: normalizedDate(year, first, second) };
    }
    if (dayFirstValid) {
      return { status: 'valid', normalized: normalizedDate(year, second, first) };
    }
    return { status: 'invalid' };
  }

  if (/^\d{1,2}[-/]\d{1,2}[-/]\d{2}$/.test(text)) {
    return { status: 'ambiguous' };
  }

  return { status: 'not_date' };
}
