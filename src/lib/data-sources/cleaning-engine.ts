import { normalizeFullWidth } from './type-detector';
import type {
  CleaningRecipe,
  CleaningRow,
  CleaningSummary,
} from './cleaning-types';
import type { DiscoveredTable } from './types';
import { matchesTextMarker, parseDateValue } from './value-parsers';

const SAMPLE_LIMIT = 20;

function asText(value: string | number | null | undefined): string | null {
  return value == null ? null : String(value);
}

function normalizeDate(value: string): string | null {
  const result = parseDateValue(value);
  return result.status === 'valid' ? result.normalized : null;
}

function normalizeNumber(
  value: string,
  percentageMode: 'keep_number' | 'decimal',
): string | null {
  let text = normalizeFullWidth(value).trim();
  const negative = /^\(.*\)$/.test(text);
  if (negative) text = text.slice(1, -1).trim();
  const percentage = text.endsWith('%');
  if (percentage) text = text.slice(0, -1).trim();
  const currency = /^[¥￥$€£]\s*/.test(text);
  text = text.replace(/^[¥￥$€£]\s*/, '');

  // Normalize decimal text directly instead of round-tripping through a
  // JavaScript double. This preserves integers above Number.MAX_SAFE_INTEGER
  // and arbitrary decimal digits, while rejecting malformed grouping such as
  // "12,34" rather than silently interpreting it as 1234.
  const match = text.match(
    /^([+-]?)(?:(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?|\.(\d+))$/,
  );
  if (!match) return null;

  const sign = match[1];
  const integer = (match[2] ?? '0').replace(/,/g, '');
  const fraction = match[3] ?? match[4] ?? '';
  const magnitude = fraction ? `${integer}.${fraction}` : integer;
  let normalized =
    sign === '-' || negative
      ? `-${magnitude.replace(/^-/, '')}`
      : magnitude;

  if (percentage && percentageMode === 'decimal') {
    const isNegative = normalized.startsWith('-');
    const unsigned = isNegative ? normalized.slice(1) : normalized;
    const [whole, decimal = ''] = unsigned.split('.');
    const digits = `${whole}${decimal}`;
    const point = whole.length - 2;
    const shifted =
      point <= 0
        ? `0.${'0'.repeat(-point)}${digits}`
        : `${digits.slice(0, point)}.${digits.slice(point)}`;
    const [shiftedWhole, shiftedFraction = ''] = shifted.split('.');
    const canonicalWhole = shiftedWhole.replace(/^0+(?=\d)/, '');
    const canonicalFraction = shiftedFraction;
    const canonicalMagnitude = canonicalFraction
      ? `${canonicalWhole}.${canonicalFraction}`
      : canonicalWhole;
    normalized =
      isNegative && canonicalMagnitude !== '0'
        ? `-${canonicalMagnitude}`
        : canonicalMagnitude;
  }

  // A plain valid numeric literal needs no normalization. Preserve its
  // formatting so identifier-like values (00123) and declared decimal scale
  // (1.2300) are not changed merely because inference labelled the column
  // NUMERIC. Explicit wrappers and separators still produce a visible diff.
  if (!negative && !percentage && !currency && !text.includes(',')) {
    return normalizeFullWidth(value).trim();
  }

  return normalized;
}

function normalizeBoolean(
  value: string,
  trueValues: ReadonlySet<string>,
  falseValues: ReadonlySet<string>,
): string | null {
  const normalized = normalizeFullWidth(value).trim().toLowerCase();
  if (trueValues.has(normalized)) return 'true';
  if (falseValues.has(normalized)) return 'false';
  return null;
}

function validateColumns(recipe: CleaningRecipe, table: DiscoveredTable) {
  const allowed = new Set(table.columns.map((column) => column.name));
  const assert = (names: string[]) => {
    for (const name of names) {
      if (!allowed.has(name)) throw new Error(`Unknown cleaning column: ${name}`);
    }
  };
  for (const step of recipe.steps) {
    if ('columns' in step) assert(step.columns);
    if (step.type === 'fill_missing') assert([step.column]);
    if (step.type === 'drop_duplicates' && step.keys) assert(step.keys);
    if (step.type === 'fill_missing' && step.strategy === 'fixed' && step.value === undefined) {
      throw new Error('fill_missing with fixed strategy requires a value.');
    }
    if (step.type === 'normalize_boolean') {
      const truthy = new Set(step.trueValues.map((value) => normalizeFullWidth(value).trim().toLowerCase()));
      const overlapping = step.falseValues.some((value) => truthy.has(normalizeFullWidth(value).trim().toLowerCase()));
      if (overlapping) throw new Error('Boolean trueValues and falseValues must not overlap.');
    }
  }
}

interface ExactDecimal {
  coefficient: bigint;
  scale: number;
}

function parseExactDecimal(value: string): ExactDecimal | null {
  const match = value.trim().match(/^([+-]?)(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  const sign = match[1] === '-' ? -1n : 1n;
  const fraction = match[3] ?? '';
  return { coefficient: sign * BigInt(`${match[2]}${fraction}`), scale: fraction.length };
}

function greatestCommonDivisor(a: bigint, b: bigint): bigint {
  let left = a < 0n ? -a : a;
  let right = b < 0n ? -b : b;
  while (right !== 0n) {
    const remainder = left % right;
    left = right;
    right = remainder;
  }
  return left;
}

function formatExactDecimal(value: ExactDecimal): string {
  let coefficient = value.coefficient;
  let scale = value.scale;
  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale--;
  }
  const negative = coefficient < 0n;
  const digits = (negative ? -coefficient : coefficient).toString().padStart(scale + 1, '0');
  const result = scale === 0
    ? digits
    : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return negative && coefficient !== 0n ? `-${result}` : result;
}

function exactAverage(coefficients: bigint[], scale: number): string {
  let numerator = coefficients.reduce((sum, value) => sum + value, 0n);
  let denominator = BigInt(coefficients.length);
  const divisor = greatestCommonDivisor(numerator, denominator);
  numerator /= divisor;
  denominator /= divisor;

  let twos = 0;
  let fives = 0;
  while (denominator % 2n === 0n) {
    denominator /= 2n;
    twos++;
  }
  while (denominator % 5n === 0n) {
    denominator /= 5n;
    fives++;
  }
  if (denominator !== 1n) {
    throw new Error(
      'Mean fill would require implicit rounding. Use a fixed fill value instead.',
    );
  }

  const extraScale = Math.max(twos, fives);
  const multiplier = (2n ** BigInt(extraScale - twos)) *
    (5n ** BigInt(extraScale - fives));
  return formatExactDecimal({
    coefficient: numerator * multiplier,
    scale: scale + extraScale,
  });
}

function computeFill(rows: CleaningRow[], column: string, strategy: 'mean' | 'median'): string | null {
  const sourceValues = rows
    .map((row) => asText(row[column]))
    .filter((value): value is string => value != null && value.trim() !== '');
  const values = sourceValues.map(parseExactDecimal);
  if (values.some((value) => value == null)) {
    throw new Error(
      `${strategy === 'mean' ? 'Mean' : 'Median'} fill requires every non-missing value in ${column} to be a plain decimal.`,
    );
  }
  if (values.length === 0) return null;
  const decimals = values as ExactDecimal[];
  const scale = Math.max(...decimals.map((value) => value.scale));
  const coefficients = decimals.map(
    (value) => value.coefficient * (10n ** BigInt(scale - value.scale)),
  );
  if (strategy === 'mean') return exactAverage(coefficients, scale);
  coefficients.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const middle = Math.floor(values.length / 2);
  return values.length % 2
    ? formatExactDecimal({ coefficient: coefficients[middle], scale })
    : exactAverage([coefficients[middle - 1], coefficients[middle]], scale);
}

/** Execute a structured recipe without evaluating generated SQL or code. */
export function executeCleaningRecipe(
  input: CleaningRow[],
  table: DiscoveredTable,
  recipe: CleaningRecipe,
): { rows: CleaningRow[]; summary: CleaningSummary } {
  validateColumns(recipe, table);
  const original = new Map(input.map((row) => [row._row_id, { ...row }]));
  let rows = input.map((row) => ({ ...row }));
  const removedRowsById = new Map<number, CleaningRow>();
  const removedRowSamples: NonNullable<CleaningSummary['removedRowSamples']> = [];
  let parseFailures = 0;
  const parseFailureSamples: CleaningSummary['parseFailureSamples'] = [];
  const recordParseFailure = (
    rowId: number,
    column: string,
    value: string,
    reason: CleaningSummary['parseFailureSamples'][number]['reason'],
  ) => {
    parseFailures++;
    if (parseFailureSamples.length < SAMPLE_LIMIT) {
      parseFailureSamples.push({ rowId, column, value, reason });
    }
  };

  for (const step of recipe.steps) {
    if (step.type === 'drop_duplicates') {
      const keys = step.keys?.length ? step.keys : table.columns.map((column) => column.name);
      const seen = new Map<string, number>();
      rows = rows.filter((row) => {
        const key = JSON.stringify(keys.map((column) => asText(row[column])));
        const keptRowId = seen.get(key);
        if (keptRowId !== undefined) {
          removedRowsById.set(row._row_id, { ...row });
          if (removedRowSamples.length < SAMPLE_LIMIT) {
            removedRowSamples.push({
              rowId: row._row_id,
              reason: 'duplicate',
              keptRowId,
              columns: [...keys],
              match: step.keys?.length ? 'selected_columns' : 'all_columns',
            });
          }
          return false;
        }
        seen.set(key, row._row_id);
        return true;
      });
      continue;
    }

    if (step.type === 'remove_missing_rows') {
      rows = rows.filter((row) => {
        const missingColumns = step.columns.filter(
          (column) => asText(row[column]) == null,
        );
        if (missingColumns.length === 0) return true;
        removedRowsById.set(row._row_id, { ...row });
        if (removedRowSamples.length < SAMPLE_LIMIT) {
          removedRowSamples.push({
            rowId: row._row_id,
            reason: 'missing_value',
            columns: missingColumns,
          });
        }
        return false;
      });
      continue;
    }

    if (step.type === 'fill_missing') {
      const replacement = step.strategy === 'fixed'
        ? step.value ?? ''
        : computeFill(rows, step.column, step.strategy);
      if (replacement != null) {
        for (const row of rows) if (asText(row[step.column]) == null) row[step.column] = replacement;
      }
      continue;
    }

    const booleanValues = step.type === 'normalize_boolean'
      ? {
          trueValues: new Set(step.trueValues.map((value) => normalizeFullWidth(value).trim().toLowerCase())),
          falseValues: new Set(step.falseValues.map((value) => normalizeFullWidth(value).trim().toLowerCase())),
        }
      : null;

    for (const row of rows) {
      for (const column of step.columns) {
        const current = asText(row[column]);
        if (current == null) continue;
        if (step.type === 'trim_whitespace') row[column] = current.trim();
        else if (step.type === 'normalize_whitespace') row[column] = current.replace(/\s+/g, ' ').trim();
        else if (step.type === 'fullwidth_to_halfwidth') row[column] = normalizeFullWidth(current);
        else if (step.type === 'normalize_null') {
          if (matchesTextMarker(current, step.markers)) row[column] = null;
        } else if (step.type === 'normalize_numeric') {
          const normalized = normalizeNumber(current, step.percentageMode);
          if (normalized == null) {
            recordParseFailure(row._row_id, column, current, 'invalid_numeric');
            if (step.onError === 'set_null') row[column] = null;
          } else row[column] = normalized;
        } else if (step.type === 'normalize_boolean') {
          const normalized = normalizeBoolean(
            current,
            booleanValues!.trueValues,
            booleanValues!.falseValues,
          );
          if (normalized == null) {
            recordParseFailure(row._row_id, column, current, 'invalid_boolean');
            if (step.onError === 'set_null') row[column] = null;
          } else row[column] = normalized;
        } else if (step.type === 'normalize_date') {
          const normalized = normalizeDate(current);
          if (normalized) row[column] = normalized;
          else recordParseFailure(row._row_id, column, current, 'invalid_or_ambiguous_date');
        }
      }
    }
  }

  const surviving = new Set(rows.map((row) => row._row_id));
  const affectedRowIds = new Set<number>();
  let affectedCells = 0;
  let generatedNulls = 0;
  const samples: CleaningSummary['samples'] = [];
  const finalRowsById = new Map(
    [...rows, ...removedRowsById.values()].map((row) => [row._row_id, row]),
  );
  for (const [rowId, before] of original) {
    const row = finalRowsById.get(rowId);
    if (!row) continue;
    for (const column of table.columns) {
      const oldValue = asText(before[column.name]);
      const newValue = asText(row[column.name]);
      if (oldValue !== newValue) {
        affectedCells++;
        affectedRowIds.add(rowId);
        if (oldValue != null && newValue == null) generatedNulls++;
        if (samples.length < SAMPLE_LIMIT) samples.push({ rowId, column: column.name, before: oldValue, after: newValue });
      }
    }
  }
  for (const id of original.keys()) if (!surviving.has(id)) affectedRowIds.add(id);

  return {
    rows,
    summary: {
      inputRows: input.length,
      outputRows: rows.length,
      affectedRows: affectedRowIds.size,
      affectedCells,
      removedRows: input.length - rows.length,
      generatedNulls,
      parseFailures,
      parseFailureSamples,
      samples,
      removedRowSamples,
    },
  };
}

export function buildPresetRecipe(
  table: DiscoveredTable,
  preset: 'conservative' | 'standard' | 'aggressive',
): CleaningRecipe {
  const all = table.columns.map((column) => column.name);
  const numeric = table.columns.filter((column) => column.semanticType === 'NUMERIC').map((column) => column.name);
  const dates = table.columns.filter((column) => column.semanticType === 'DATE').map((column) => column.name);
  const booleans = table.columns.filter((column) => column.semanticType === 'BOOLEAN').map((column) => column.name);
  const steps: CleaningRecipe['steps'] = [
    { type: 'fullwidth_to_halfwidth', columns: all },
    { type: 'normalize_whitespace', columns: all },
    { type: 'normalize_null', columns: all, markers: ['', 'null', 'n/a', 'na', 'nil', 'none', '-', '—', '无', '暂无'] },
  ];
  if (preset !== 'conservative' && numeric.length) {
    steps.push({ type: 'normalize_numeric', columns: numeric, percentageMode: 'decimal', onError: preset === 'aggressive' ? 'set_null' : 'keep_original' });
  }
  if (preset !== 'conservative' && dates.length) {
    steps.push({ type: 'normalize_date', columns: dates, onAmbiguous: 'keep_original' });
  }
  if (preset !== 'conservative' && booleans.length) {
    steps.push({
      type: 'normalize_boolean',
      columns: booleans,
      trueValues: ['true', 'yes', 'y', '1'],
      falseValues: ['false', 'no', 'n', '0'],
      onError: preset === 'aggressive' ? 'set_null' : 'keep_original',
    });
  }
  if (preset !== 'conservative') steps.push({ type: 'drop_duplicates' });
  return { name: `${preset[0].toUpperCase()}${preset.slice(1)} preset`, steps };
}
