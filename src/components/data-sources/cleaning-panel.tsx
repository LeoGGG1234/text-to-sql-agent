'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CleaningRecipe, CleaningSummary } from '@/lib/data-sources/cleaning-types';
import type { QualityProfile } from '@/lib/data-sources/types';
import type { ColumnMeta } from './data-table';
import { CleaningPolicyBuilder } from './cleaning-policy-builder';

interface CleaningRun {
  id: string;
  recipe: CleaningRecipe;
  previewSummary: CleaningSummary | null;
  status: string;
  createdAt: string;
  appliedAt: string | null;
}

interface Preview {
  runId: string;
  recipe: CleaningRecipe;
  summary: CleaningSummary;
}

interface Props {
  dataSourceId: string;
  columns: ColumnMeta[];
  exporting: boolean;
  onClose: () => void;
  onApplied: () => void;
  onExport: () => void;
}

type CleaningStep = CleaningRecipe['steps'][number];

const FAILURE_LABELS: Record<CleaningSummary['parseFailureSamples'][number]['reason'], string> = {
  invalid_numeric: 'Invalid numeric value',
  invalid_or_ambiguous_date: 'Invalid or ambiguous date',
  invalid_boolean: 'Invalid boolean value',
};

function previewValue(value: string | null): string {
  return value == null ? 'NULL' : JSON.stringify(value);
}

function stepPolicy(step: CleaningStep): string | null {
  if (step.type === 'normalize_numeric') {
    const percentage = step.percentageMode === 'decimal' ? 'percent → decimal' : 'percent sign removed';
    const failure = step.onError === 'set_null' ? 'failures → NULL' : 'failures kept';
    return `${percentage}; ${failure}`;
  }
  if (step.type === 'normalize_boolean') {
    const failure = step.onError === 'set_null' ? 'unknown values → NULL' : 'unknown values kept';
    return `true/yes/y/1 → true; false/no/n/0 → false; ${failure}`;
  }
  if (step.type === 'normalize_date') return 'ambiguous or invalid dates kept';
  if (step.type === 'drop_duplicates') return step.keys?.length ? 'selected keys' : 'exact full-row matches';
  return null;
}

export function CleaningPanel({ dataSourceId, columns, exporting, onClose, onApplied, onExport }: Props) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [history, setHistory] = useState<CleaningRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<{
    before: QualityProfile;
    after: QualityProfile;
  } | null>(null);

  const loadHistory = useCallback(async (signal?: AbortSignal) => {
    const res = await fetch(`/api/data-sources/${dataSourceId}/cleaning-runs`, { signal });
    if (res.ok) setHistory((await res.json()).runs ?? []);
  }, [dataSourceId]);

  useEffect(() => {
    const controller = new AbortController();
    loadHistory(controller.signal).catch((cause: unknown) => {
      if ((cause as { name?: string }).name !== 'AbortError') setError('Could not load cleaning history.');
    });
    return () => controller.abort();
  }, [loadHistory]);

  async function requestPreview(payload: { preset: 'conservative' | 'standard' | 'aggressive' } | { recipe: CleaningRecipe }) {
    setLoading(true);
    setError(null);
    setValidation(null);
    setPreview(null);
    try {
      const res = await fetch(`/api/data-sources/${dataSourceId}/cleaning/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? 'Cleaning preview failed.');
        return;
      }
      setPreview(body);
      await loadHistory();
    } catch {
      setError('Cleaning preview failed.');
    } finally {
      setLoading(false);
    }
  }

  const createPreview = (preset: 'conservative' | 'standard' | 'aggressive') =>
    requestPreview({ preset });

  async function applyPreview() {
    if (!preview || !window.confirm(`Apply this recipe to ${preview.summary.affectedRows} affected rows?`)) return;
    setApplying(true);
    setError(null);
    try {
      const res = await fetch(`/api/data-sources/${dataSourceId}/cleaning/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: preview.runId }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? 'Cleaning apply failed.');
        return;
      }
      setPreview(null);
      if (body.beforeProfile?.table && body.afterProfile?.table) {
        setValidation({ before: body.beforeProfile, after: body.afterProfile });
      }
      await loadHistory();
      onApplied();
    } catch {
      setError('Cleaning apply failed.');
    } finally {
      setApplying(false);
    }
  }

  return (
    <aside className="absolute inset-y-0 right-0 z-20 flex w-full max-w-md flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl">
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">Cleaning policy</h3>
          <p className="text-[10px] text-zinc-500">Preview first; deterministic operations only.</p>
        </div>
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">✕</button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-4 text-xs">
        <section>
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500">Generate recipe</div>
          <div className="grid grid-cols-3 gap-2">
            {(['conservative', 'standard', 'aggressive'] as const).map((preset) => (
              <button
                key={preset}
                onClick={() => createPreview(preset)}
                disabled={loading}
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-2 capitalize text-zinc-200 hover:border-indigo-500 disabled:opacity-50"
              >
                {preset}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-zinc-600">
            Standard and Aggressive convert percentages to decimals. Standard keeps unresolved values; Aggressive converts numeric and boolean failures to NULL. Dates are never guessed.
          </p>
        </section>

        <CleaningPolicyBuilder
          columns={columns}
          disabled={loading || applying}
          onPreview={(recipe) => void requestPreview({ recipe })}
        />

        {error && <div className="rounded border border-red-800/40 bg-red-950/30 p-2 text-red-300">{error}</div>}
        {loading && <div className="text-zinc-500">Computing full-table preview...</div>}

        {preview && (
          <section className="space-y-3 rounded-lg border border-indigo-800/40 bg-indigo-950/20 p-3">
            <div className="flex items-center justify-between">
              <strong className="text-zinc-100">{preview.recipe.name}</strong>
              <span className="text-indigo-300">dry run</span>
            </div>
            <ol className="list-decimal space-y-1 pl-4 text-zinc-400">
              {preview.recipe.steps.map((step, index) => (
                <li key={`${step.type}-${index}`}>
                  <code>{step.type}</code>{' '}
                  {'columns' in step ? step.columns.join(', ') : step.type === 'fill_missing' ? step.column : step.keys?.join(', ') ?? 'all columns'}
                  {stepPolicy(step) ? <span className="block text-[10px] text-zinc-600">{stepPolicy(step)}</span> : null}
                </li>
              ))}
            </ol>
            <div className="grid grid-cols-2 gap-2 text-zinc-400">
              <span>Affected rows: <b className="text-zinc-100">{preview.summary.affectedRows}</b></span>
              <span>Affected cells: <b className="text-zinc-100">{preview.summary.affectedCells}</b></span>
              <span>Removed rows: <b className="text-zinc-100">{preview.summary.removedRows}</b></span>
              <span>Parse failures: <b className="text-zinc-100">{preview.summary.parseFailures}</b></span>
              <span>Generated NULLs: <b className="text-zinc-100">{preview.summary.generatedNulls}</b></span>
              <span>Output rows: <b className="text-zinc-100">{preview.summary.outputRows}</b></span>
            </div>
            {preview.summary.samples.length > 0 && (
              <div className="max-h-40 overflow-auto rounded border border-zinc-800">
                {preview.summary.samples.map((sample, index) => (
                  <div key={`${sample.rowId}-${sample.column}-${index}`} className="border-b border-zinc-800 px-2 py-1 last:border-0">
                    <span className="text-zinc-600">#{sample.rowId} {sample.column}: </span>
                    <code className="whitespace-pre-wrap break-all text-red-300">{previewValue(sample.before)}</code>
                    <span className="text-zinc-600"> → </span>
                    <code className="whitespace-pre-wrap break-all text-emerald-300">{previewValue(sample.after)}</code>
                  </div>
                ))}
              </div>
            )}
            {preview.summary.parseFailures > 0 && (
              <div className="rounded border border-amber-800/50 bg-amber-950/20 p-2">
                <div className="mb-1 font-medium text-amber-300">Unresolved parse failures</div>
                {(preview.summary.parseFailureSamples ?? []).length > 0 ? (
                  <div className="space-y-1">
                    {(preview.summary.parseFailureSamples ?? []).map((failure, index) => (
                      <div key={`${failure.rowId}-${failure.column}-${index}`}>
                        <span className="text-zinc-500">#{failure.rowId} {failure.column}: </span>
                        <code className="whitespace-pre-wrap break-all text-amber-200">{previewValue(failure.value)}</code>
                        <span className="text-zinc-600"> · {FAILURE_LABELS[failure.reason]}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-zinc-500">Failure details are unavailable for this older preview.</p>
                )}
              </div>
            )}
            <button
              onClick={applyPreview}
              disabled={applying}
              className="w-full rounded-lg bg-indigo-600 px-3 py-2 font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {applying ? 'Applying...' : 'Apply reviewed recipe'}
            </button>
          </section>
        )}

        {validation && (
          <section className="rounded-lg border border-emerald-800/40 bg-emerald-950/20 p-3">
            <div className="mb-2 font-medium text-emerald-300">Post-clean validation</div>
            <div className="grid grid-cols-2 gap-2 text-zinc-400">
              <span>Duplicate rows</span>
              <span className="text-right text-zinc-100">
                {validation.before.table.duplicateRowCount} → {validation.after.table.duplicateRowCount}
              </span>
              <span>Columns with issues</span>
              <span className="text-right text-zinc-100">
                {validation.before.table.columnsWithIssues} → {validation.after.table.columnsWithIssues}
              </span>
            </div>
            <button
              type="button"
              onClick={onExport}
              disabled={exporting}
              className="mt-3 w-full rounded border border-emerald-800/50 bg-emerald-950/30 px-3 py-2 font-medium text-emerald-300 hover:bg-emerald-900/30 disabled:opacity-50"
            >
              {exporting ? 'Exporting...' : 'Export applied CSV'}
            </button>
          </section>
        )}

        <section>
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500">Recent runs</div>
          {history.length === 0 ? <p className="text-zinc-600">No cleaning runs yet.</p> : (
            <div className="space-y-2">
              {history.map((run) => (
                <div key={run.id} className="rounded border border-zinc-800 bg-zinc-900 p-2">
                  <div className="flex justify-between text-zinc-300">
                    <span>{run.recipe.name}</span><span>{run.status}</span>
                  </div>
                  <div className="mt-1 text-[10px] text-zinc-600">
                    {new Date(run.appliedAt ?? run.createdAt).toLocaleString()}
                    {run.previewSummary ? ` · ${run.previewSummary.affectedRows} affected rows` : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}
