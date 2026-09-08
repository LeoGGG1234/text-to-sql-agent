'use client';

import { useEffect, useState } from 'react';
import type { CleaningRecipe } from '@/lib/data-sources/cleaning-types';
import type { ColumnMeta } from './data-table';

type CleaningStep = CleaningRecipe['steps'][number];
type PolicyOperation =
  | 'trim_whitespace'
  | 'normalize_whitespace'
  | 'fullwidth_to_halfwidth'
  | 'normalize_null'
  | 'normalize_numeric'
  | 'normalize_boolean'
  | 'normalize_date'
  | 'fill_fixed'
  | 'fill_mean'
  | 'fill_median'
  | 'remove_missing_rows'
  | 'drop_duplicates_keys'
  | 'drop_duplicates_exact';

interface Props {
  columns: ColumnMeta[];
  disabled: boolean;
  onPreview: (recipe: CleaningRecipe) => void;
}

const OPERATIONS: Array<{ value: PolicyOperation; label: string }> = [
  { value: 'normalize_whitespace', label: 'Normalize whitespace' },
  { value: 'trim_whitespace', label: 'Trim edge whitespace' },
  { value: 'fullwidth_to_halfwidth', label: 'Full-width to half-width' },
  { value: 'normalize_null', label: 'Normalize NULL markers' },
  { value: 'normalize_numeric', label: 'Normalize numeric values' },
  { value: 'normalize_date', label: 'Normalize dates' },
  { value: 'normalize_boolean', label: 'Normalize booleans' },
  { value: 'fill_fixed', label: 'Fill missing with fixed value' },
  { value: 'fill_mean', label: 'Fill missing with mean' },
  { value: 'fill_median', label: 'Fill missing with median' },
  { value: 'remove_missing_rows', label: 'Remove rows with missing values' },
  { value: 'drop_duplicates_keys', label: 'Deduplicate by selected keys' },
  { value: 'drop_duplicates_exact', label: 'Drop exact duplicate rows' },
];

const SINGLE_COLUMN_OPERATIONS = new Set<PolicyOperation>(['fill_fixed', 'fill_mean', 'fill_median']);

function operationNeedsColumns(operation: PolicyOperation): boolean {
  return operation !== 'drop_duplicates_exact';
}

function recommendedSemanticType(operation: PolicyOperation): string | null {
  if (operation === 'normalize_numeric' || operation === 'fill_mean' || operation === 'fill_median') return 'NUMERIC';
  if (operation === 'normalize_date') return 'DATE';
  if (operation === 'normalize_boolean') return 'BOOLEAN';
  return null;
}

function defaultColumns(operation: PolicyOperation, columns: ColumnMeta[]): string[] {
  if (!operationNeedsColumns(operation)) return [];
  const semanticType = recommendedSemanticType(operation);
  const recommended = semanticType ? columns.find((column) => column.semanticType === semanticType) : null;
  return recommended ? [recommended.name] : columns[0] ? [columns[0].name] : [];
}

function ruleDescription(step: CleaningStep): string {
  if (step.type === 'drop_duplicates') {
    return step.keys?.length ? `deduplicate by ${step.keys.join(', ')}` : 'drop exact duplicate rows';
  }
  if (step.type === 'fill_missing') return `${step.strategy} fill on ${step.column}${step.value !== undefined ? ` with ${JSON.stringify(step.value)}` : ''}`;
  const columnList = step.columns.join(', ');
  if (step.type === 'normalize_numeric') return `normalize numeric on ${columnList}; percent ${step.percentageMode}; failures ${step.onError}`;
  if (step.type === 'normalize_boolean') return `normalize boolean on ${columnList}; failures ${step.onError}`;
  if (step.type === 'normalize_null') return `normalize NULL markers on ${columnList}`;
  if (step.type === 'normalize_date') return `normalize unambiguous dates on ${columnList}`;
  if (step.type === 'remove_missing_rows') return `remove rows missing ${columnList}`;
  return `${step.type} on ${columnList}`;
}

export function CleaningPolicyBuilder({ columns, disabled, onPreview }: Props) {
  const [operation, setOperation] = useState<PolicyOperation>('normalize_whitespace');
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [rules, setRules] = useState<CleaningStep[]>([]);
  const [percentageMode, setPercentageMode] = useState<'keep_number' | 'decimal'>('decimal');
  const [onError, setOnError] = useState<'keep_original' | 'set_null'>('keep_original');
  const [nullMarkers, setNullMarkers] = useState('null, n/a, na, nil, none, -, —, 无, 暂无');
  const [fixedValue, setFixedValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedColumns((current) => {
      const valid = current.filter((name) => columns.some((column) => column.name === name));
      return valid.length ? valid : defaultColumns(operation, columns);
    });
  }, [columns, operation]);

  function changeOperation(next: PolicyOperation) {
    setOperation(next);
    setSelectedColumns(defaultColumns(next, columns));
    setError(null);
  }

  function toggleColumn(columnName: string) {
    setSelectedColumns((current) => {
      if (SINGLE_COLUMN_OPERATIONS.has(operation)) return [columnName];
      return current.includes(columnName)
        ? current.filter((name) => name !== columnName)
        : [...current, columnName];
    });
  }

  function buildStep(): CleaningStep | null {
    if (operationNeedsColumns(operation) && selectedColumns.length === 0) {
      setError('Select at least one column.');
      return null;
    }
    if (operation === 'normalize_numeric') {
      return { type: operation, columns: selectedColumns, percentageMode, onError };
    }
    if (operation === 'normalize_boolean') {
      return {
        type: operation,
        columns: selectedColumns,
        trueValues: ['true', 'yes', 'y', '1'],
        falseValues: ['false', 'no', 'n', '0'],
        onError,
      };
    }
    if (operation === 'normalize_date') {
      return { type: operation, columns: selectedColumns, onAmbiguous: 'keep_original' };
    }
    if (operation === 'normalize_null') {
      const markers = ['', ...nullMarkers.split(/[,\n]/).map((marker) => marker.trim()).filter(Boolean)];
      return { type: operation, columns: selectedColumns, markers: [...new Set(markers)] };
    }
    if (operation === 'fill_fixed') {
      if (fixedValue.length === 0) {
        setError('Enter a fixed replacement value.');
        return null;
      }
      return { type: 'fill_missing', column: selectedColumns[0], strategy: 'fixed', value: fixedValue };
    }
    if (operation === 'fill_mean' || operation === 'fill_median') {
      return {
        type: 'fill_missing',
        column: selectedColumns[0],
        strategy: operation === 'fill_mean' ? 'mean' : 'median',
      };
    }
    if (operation === 'drop_duplicates_keys') {
      return { type: 'drop_duplicates', keys: selectedColumns };
    }
    if (operation === 'drop_duplicates_exact') return { type: 'drop_duplicates' };
    return { type: operation, columns: selectedColumns };
  }

  function addRule() {
    if (rules.length >= 30) {
      setError('A recipe can contain at most 30 rules.');
      return;
    }
    const step = buildStep();
    if (!step) return;
    setRules((current) => [...current, step]);
    setError(null);
  }

  function previewRecipe() {
    if (rules.length === 0) {
      setError('Add at least one rule before previewing.');
      return;
    }
    onPreview({ name: 'Custom policy', steps: rules });
  }

  const needsColumns = operationNeedsColumns(operation);
  const singleColumn = SINGLE_COLUMN_OPERATIONS.has(operation);

  return (
    <section className="space-y-3 border-t border-zinc-800 pt-4">
      <div>
        <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Build custom recipe</div>
        <p className="mt-1 text-[10px] text-zinc-600">Add ordered, column-level rules. Nothing is written until preview and confirmation.</p>
      </div>

      <label className="block text-zinc-400">
        Operation
        <select
          aria-label="Cleaning operation"
          value={operation}
          onChange={(event) => changeOperation(event.target.value as PolicyOperation)}
          className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-zinc-200"
        >
          {OPERATIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>

      {needsColumns && (
        <fieldset>
          <legend className="mb-1 w-full">
            <span className="flex items-center justify-between">
              <span className="text-zinc-400">{singleColumn ? 'Column' : 'Columns'}</span>
              {!singleColumn && (
                <span className="space-x-2 text-[10px]">
                  <button type="button" onClick={() => setSelectedColumns(columns.map((column) => column.name))} className="text-indigo-400 hover:text-indigo-300">All</button>
                  <button type="button" onClick={() => setSelectedColumns([])} className="text-zinc-500 hover:text-zinc-300">Clear</button>
                </span>
              )}
            </span>
          </legend>
          <div className="max-h-32 space-y-1 overflow-y-auto rounded border border-zinc-800 bg-zinc-900/60 p-2">
            {columns.map((column) => (
              <label key={column.name} className="flex cursor-pointer items-center gap-2 text-zinc-300">
                <input
                  type={singleColumn ? 'radio' : 'checkbox'}
                  name={singleColumn ? 'cleaning-column' : undefined}
                  checked={selectedColumns.includes(column.name)}
                  onChange={() => toggleColumn(column.name)}
                  className="accent-indigo-500"
                />
                <span className="truncate">{column.displayName}</span>
                <code className="ml-auto text-[9px] text-zinc-600">{column.semanticType}</code>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {operation === 'normalize_null' && (
        <label className="block text-zinc-400">
          NULL markers (comma or newline separated)
          <textarea
            aria-label="NULL markers"
            value={nullMarkers}
            onChange={(event) => setNullMarkers(event.target.value)}
            rows={2}
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-zinc-200"
          />
          <span className="mt-1 block text-[10px] text-zinc-600">Empty strings are always included.</span>
        </label>
      )}

      {operation === 'normalize_numeric' && (
        <label className="block text-zinc-400">
          Percentage handling
          <select
            aria-label="Percentage handling"
            value={percentageMode}
            onChange={(event) => setPercentageMode(event.target.value as typeof percentageMode)}
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-zinc-200"
          >
            <option value="decimal">15% → 0.15</option>
            <option value="keep_number">15% → 15</option>
          </select>
        </label>
      )}

      {(operation === 'normalize_numeric' || operation === 'normalize_boolean') && (
        <label className="block text-zinc-400">
          Parse failure handling
          <select
            aria-label="Parse failure handling"
            value={onError}
            onChange={(event) => setOnError(event.target.value as typeof onError)}
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-zinc-200"
          >
            <option value="keep_original">Keep original value</option>
            <option value="set_null">Set to NULL</option>
          </select>
        </label>
      )}

      {operation === 'normalize_boolean' && (
        <p className="text-[10px] text-zinc-600">true/yes/y/1 → true; false/no/n/0 → false.</p>
      )}
      {operation === 'normalize_numeric' && (
        <p className="text-[10px] text-zinc-600">Removes common currency symbols and thousands separators before parsing.</p>
      )}
      {operation === 'normalize_date' && (
        <p className="text-[10px] text-zinc-600">Only year-first dates are normalized. Ambiguous or invalid values remain unchanged.</p>
      )}
      {(operation === 'fill_fixed' || operation === 'fill_mean' || operation === 'fill_median' || operation === 'remove_missing_rows') && (
        <p className="text-[10px] text-zinc-600">This rule targets SQL NULL values. Add a NULL-marker rule first to include blanks or placeholders.</p>
      )}
      {(operation === 'drop_duplicates_keys' || operation === 'drop_duplicates_exact') && (
        <p className="text-[10px] text-zinc-600">Deduplication runs after earlier rules and keeps the first physical row.</p>
      )}
      {operation === 'fill_fixed' && (
        <label className="block text-zinc-400">
          Replacement value
          <input
            aria-label="Replacement value"
            value={fixedValue}
            onChange={(event) => setFixedValue(event.target.value)}
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-zinc-200"
          />
        </label>
      )}

      <button
        type="button"
        onClick={addRule}
        disabled={disabled || (needsColumns && columns.length === 0)}
        className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-200 hover:border-indigo-500 disabled:opacity-50"
      >
        Add rule
      </button>

      {error && <div className="rounded border border-red-800/40 bg-red-950/30 p-2 text-red-300">{error}</div>}

      {rules.length > 0 && (
        <div className="space-y-2">
          <div className="text-zinc-400">Ordered rules ({rules.length}/30)</div>
          <ol className="space-y-1">
            {rules.map((rule, index) => (
              <li key={`${rule.type}-${index}`} className="flex items-start gap-2 rounded border border-zinc-800 bg-zinc-900 p-2">
                <span className="text-zinc-600">{index + 1}.</span>
                <span className="min-w-0 flex-1 break-words text-zinc-300">{ruleDescription(rule)}</span>
                <button
                  type="button"
                  aria-label={`Remove rule ${index + 1}`}
                  onClick={() => setRules((current) => current.filter((_, ruleIndex) => ruleIndex !== index))}
                  className="text-zinc-600 hover:text-red-300"
                >
                  Remove
                </button>
              </li>
            ))}
          </ol>
          <button
            type="button"
            onClick={previewRecipe}
            disabled={disabled}
            className="w-full rounded-lg bg-purple-700 px-3 py-2 font-medium text-white hover:bg-purple-600 disabled:opacity-50"
          >
            Preview custom recipe
          </button>
        </div>
      )}
    </section>
  );
}
