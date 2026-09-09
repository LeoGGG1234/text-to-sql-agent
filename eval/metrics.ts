/**
 * Eval metrics for the Text-to-SQL agent.
 *
 * Unlike a keyword-match eval, correctness here means the generated SQL
 * returns the SAME result set as the reference query. We therefore execute
 * both and compare.
 *
 * SQL correctness and product completion are deliberately separate. A query
 * may replay to the right result even when the application tool failed or the
 * user never received a final explanation.
 */

export interface CaseScore {
  validity: number;
  replayExecutionSuccess: number;
  execAccuracy: number;
  schemaAdherence: number;
  applicationExecutionSuccess: number;
  answerCompleteness: number;
  taskSuccess: number;
}

export interface ResultSetComparisonOptions {
  /** Compare rows in returned order. Defaults to false. */
  orderMatters?: boolean;
  /** Absolute numeric tolerance. Defaults to exact numeric equality. */
  numericTolerance?: number;
  /** Allow the candidate query to return additional explanatory columns. */
  allowCandidateExtraColumns?: boolean;
  /** Allow expected text fragments to appear inside a candidate text value. */
  textContainment?: boolean;
  /** Normalize one result column to a calendar month or quarter. */
  period?: {
    columnIndex: number;
    granularity: 'month' | 'quarter';
    timeZone?: string;
    /** Required when a candidate represents a quarter as only 1-4. */
    year?: number;
  };
}

type NormalizedValue =
  | { kind: 'null'; value: '' }
  | { kind: 'number'; value: string; coefficient: bigint; scale: number }
  | { kind: 'date' | 'text'; value: string };

const MAX_DECIMAL_EXPANSION = 10_000;

/**
 * Compare two result sets using an explicit case-level policy.
 *
 * Column aliases do not matter, but column position does. Numeric values are
 * exact by default; a case must opt in to an absolute tolerance. Row order is
 * ignored unless the question contract says it is meaningful.
 */
export function resultSetsMatch(
  candidateRows: Record<string, unknown>[],
  expectedRows: Record<string, unknown>[],
  options: ResultSetComparisonOptions = {},
): boolean {
  if (candidateRows.length !== expectedRows.length) return false;
  if (candidateRows.length === 0) return true;

  const tolerance = options.numericTolerance ?? 0;
  if (!Number.isFinite(tolerance) || tolerance < 0) return false;
  const rowsA = candidateRows.map((row) => rowTuple(row, options));
  const rowsB = expectedRows.map((row) => rowTuple(row, options));
  if (!options.allowCandidateExtraColumns && (
    rowsA.some((row) => row.length !== rowsB[0].length) ||
    rowsB.some((row) => row.length !== rowsA[0].length)
  )) return false;

  if (options.orderMatters) {
    return rowsA.every((row, index) =>
      tuplesClose(row, rowsB[index], tolerance, options),
    );
  }

  const matched = new Set<number>();
  for (const rowA of rowsA) {
    const index = rowsB.findIndex((rowB, candidate) =>
      !matched.has(candidate) && tuplesClose(rowA, rowB, tolerance, options),
    );
    if (index < 0) return false;
    matched.add(index);
  }
  return true;
}

function rowTuple(
  row: Record<string, unknown>,
  options: ResultSetComparisonOptions,
): NormalizedValue[] {
  return Object.values(row).map((value, index) => {
    if (options.period?.columnIndex === index) {
      return normPeriod(value, options.period) ?? normValue(value);
    }
    return normValue(value);
  });
}

function normPeriod(
  value: unknown,
  period: NonNullable<ResultSetComparisonOptions['period']>,
): NormalizedValue | null {
  const text = value instanceof Date ? value.toISOString() : String(value).trim();

  if (period.granularity === 'month') {
    const month = text.match(/^(\d{4})-(\d{1,2})$/);
    if (month) {
      return { kind: 'text', value: `period:${month[1]}-${month[2].padStart(2, '0')}` };
    }
  } else {
    const fullQuarter = text.match(/^(\d{4})-?[Qq]([1-4])$/);
    if (fullQuarter) {
      return { kind: 'text', value: `period:${fullQuarter[1]}-Q${fullQuarter[2]}` };
    }
    const quarterOnly = text.match(/^(?:[Qq])?([1-4])(?:\.0+)?$/);
    if (quarterOnly && period.year) {
      return { kind: 'text', value: `period:${period.year}-Q${quarterOnly[1]}` };
    }
  }

  const date = value instanceof Date ? value : new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  let parts: Intl.DateTimeFormatPart[];
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: period.timeZone ?? 'UTC',
      year: 'numeric',
      month: '2-digit',
    });
    parts = formatter.formatToParts(date);
  } catch {
    return null;
  }
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  if (!year || !month) return null;
  if (period.granularity === 'month') {
    return { kind: 'text', value: `period:${year}-${month}` };
  }
  const quarter = Math.floor((Number(month) - 1) / 3) + 1;
  return { kind: 'text', value: `period:${year}-Q${quarter}` };
}

function normValue(v: unknown): NormalizedValue {
  if (v === null || v === undefined) return { kind: 'null', value: '' };
  if (typeof v === 'number' && Number.isFinite(v)) {
    const decimal = parseDecimal(String(v));
    if (decimal) return { kind: 'number', value: decimalKey(decimal), ...decimal };
  }
  // Postgres returns numerics as strings via the HTTP driver.
  if (typeof v === 'string') {
    const text = v.trim();
    const decimal = parseDecimal(text);
    if (decimal) return { kind: 'number', value: decimalKey(decimal), ...decimal };
    const date = text.match(/^(\d{4}-\d{2}-\d{2})(?:[T ]00:00:00(?:\.0+)?Z?)?$/);
    if (date) return { kind: 'date', value: date[1] };
    return { kind: 'text', value: text.toLowerCase() };
  }
  if (v instanceof Date) return { kind: 'date', value: v.toISOString().slice(0, 10) };
  return { kind: 'text', value: String(v).trim().toLowerCase() };
}

function parseDecimal(value: string): { coefficient: bigint; scale: number } | null {
  const match = value.match(/^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/);
  if (!match) return null;

  const sign = match[1] === '-' ? -1n : 1n;
  const integer = match[2] ?? '0';
  const fraction = match[3] ?? match[4] ?? '';
  const exponent = Number(match[5] ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > MAX_DECIMAL_EXPANSION) {
    return null;
  }

  let digits = `${integer}${fraction}`.replace(/^0+(?=\d)/, '');
  let scale = fraction.length - exponent;
  if (scale < 0) {
    digits += '0'.repeat(-scale);
    scale = 0;
  } else if (digits.length <= scale) {
    digits = digits.padStart(scale + 1, '0');
  }

  let coefficient = BigInt(digits) * sign;
  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale--;
  }
  return { coefficient, scale };
}

function decimalKey(decimal: { coefficient: bigint; scale: number }): string {
  return `${decimal.coefficient.toString()}e-${decimal.scale}`;
}

function decimalsWithinTolerance(
  a: Extract<NormalizedValue, { kind: 'number' }>,
  b: Extract<NormalizedValue, { kind: 'number' }>,
  tolerance: number,
): boolean {
  if (a.value === b.value) return true;
  if (tolerance === 0) return false;
  const parsedTolerance = parseDecimal(String(tolerance));
  if (!parsedTolerance || parsedTolerance.coefficient < 0n) return false;

  const scale = Math.max(a.scale, b.scale, parsedTolerance.scale);
  const expand = (coefficient: bigint, currentScale: number) =>
    coefficient * (10n ** BigInt(scale - currentScale));
  const difference = expand(a.coefficient, a.scale) - expand(b.coefficient, b.scale);
  const absoluteDifference = difference < 0n ? -difference : difference;
  return absoluteDifference <= expand(parsedTolerance.coefficient, parsedTolerance.scale);
}

function valuesClose(
  left: NormalizedValue,
  right: NormalizedValue,
  tolerance: number,
  textContainment: boolean,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'number' && right.kind === 'number') {
    return decimalsWithinTolerance(left, right, tolerance);
  }
  if (left.value === right.value) return true;
  return textContainment &&
    left.kind === 'text' &&
    right.kind === 'text' &&
    containsWholeTextValue(left.value, right.value);
}

function containsWholeTextValue(candidate: string, expected: string): boolean {
  if (!expected) return false;
  let start = candidate.indexOf(expected);
  while (start >= 0) {
    const before = start > 0 ? candidate[start - 1] : '';
    const after = candidate[start + expected.length] ?? '';
    const isWordCharacter = (character: string) => /[\p{L}\p{N}]/u.test(character);
    if (!isWordCharacter(before) && !isWordCharacter(after)) return true;
    start = candidate.indexOf(expected, start + 1);
  }
  return false;
}

function tuplesClose(
  a: NormalizedValue[],
  b: NormalizedValue[],
  tolerance: number,
  options: ResultSetComparisonOptions,
): boolean {
  if (options.allowCandidateExtraColumns) {
    return b.every((expected) =>
      a.some((candidate) =>
        valuesClose(candidate, expected, tolerance, options.textContainment ?? false),
      ),
    );
  }
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!valuesClose(a[i], b[i], tolerance, false)) return false;
  }
  return true;
}

export function aggregate(scores: CaseScore[]) {
  const n = scores.length || 1;
  const sum = (sel: (s: CaseScore) => number) =>
    scores.reduce((acc, s) => acc + sel(s), 0);
  return {
    validityRate: sum((s) => s.validity) / n,
    replayExecutionSuccess: sum((s) => s.replayExecutionSuccess) / n,
    execAccuracy: sum((s) => s.execAccuracy) / n,
    schemaAdherence: sum((s) => s.schemaAdherence) / n,
    applicationExecutionSuccess: sum((s) => s.applicationExecutionSuccess) / n,
    answerCompleteness: sum((s) => s.answerCompleteness) / n,
    taskSuccess: sum((s) => s.taskSuccess) / n,
  };
}
