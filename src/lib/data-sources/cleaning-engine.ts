import { normalizeFullWidth } from './type-detector';
import type {
  CleaningRecipe,
  CleaningRow,
  CleaningSummary,
} from './cleaning-types';
import type { DiscoveredTable } from './types';

const SAMPLE_LIMIT = 20;

function asText(value: string | number | null | undefined): string | null {
  return value == null ? null : String(value);
}

function validDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function normalizeDate(value: string): string | null {
  const match = value.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!match) return null;
  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (!validDate(year, month, day)) return null;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
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
  text = text.replace(/^[¥￥$€£]\s*/, '').replace(/,/g, '');
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)) return null;
  let number = Number(text);
  if (!Number.isFinite(number)) return null;
  if (negative) number = -Math.abs(number);
  if (percentage && percentageMode === 'decimal') number /= 100;
  return String(number);
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

function computeFill(rows: CleaningRow[], column: string, strategy: 'mean' | 'median'): string | null {
  const values = rows
    .map((row) => asText(row[column]))
    .filter((value): value is string => value != null && value.trim() !== '')
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (values.length === 0) return null;
  if (strategy === 'mean') return String(values.reduce((sum, value) => sum + value, 0) / values.length);
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return String(values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2);
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
      const seen = new Set<string>();
      rows = rows.filter((row) => {
        const key = JSON.stringify(keys.map((column) => asText(row[column])));
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      continue;
    }

    if (step.type === 'remove_missing_rows') {
      rows = rows.filter((row) => !step.columns.some((column) => asText(row[column]) == null));
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
          if (step.markers.some((marker) => current.trim().toLowerCase() === marker.trim().toLowerCase())) row[column] = null;
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
  for (const row of rows) {
    const before = original.get(row._row_id)!;
    for (const column of table.columns) {
      const oldValue = asText(before[column.name]);
      const newValue = asText(row[column.name]);
      if (oldValue !== newValue) {
        affectedCells++;
        affectedRowIds.add(row._row_id);
        if (oldValue != null && newValue == null) generatedNulls++;
        if (samples.length < SAMPLE_LIMIT) samples.push({ rowId: row._row_id, column: column.name, before: oldValue, after: newValue });
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
