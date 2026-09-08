'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CleaningRecipe, CleaningSummary } from '@/lib/data-sources/cleaning-types';
import type { QualityProfile } from '@/lib/data-sources/types';

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
  onClose: () => void;
  onApplied: () => void;
}

export function CleaningPanel({ dataSourceId, onClose, onApplied }: Props) {
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

  async function createPreview(preset: 'conservative' | 'standard' | 'aggressive') {
    setLoading(true);
    setError(null);
    setValidation(null);
    const res = await fetch(`/api/data-sources/${dataSourceId}/cleaning/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset }),
    });
    const body = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(body.error ?? 'Cleaning preview failed.');
      return;
    }
    setPreview(body);
    await loadHistory();
  }

  async function applyPreview() {
    if (!preview || !window.confirm(`Apply this recipe to ${preview.summary.affectedRows} affected rows?`)) return;
    setApplying(true);
    setError(null);
    const res = await fetch(`/api/data-sources/${dataSourceId}/cleaning/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: preview.runId }),
    });
    const body = await res.json();
    setApplying(false);
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
            Aggressive may convert numeric parse failures to NULL. The exact recipe is shown before apply.
          </p>
        </section>

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
                </li>
              ))}
            </ol>
            <div className="grid grid-cols-2 gap-2 text-zinc-400">
              <span>Affected rows: <b className="text-zinc-100">{preview.summary.affectedRows}</b></span>
              <span>Affected cells: <b className="text-zinc-100">{preview.summary.affectedCells}</b></span>
              <span>Removed rows: <b className="text-zinc-100">{preview.summary.removedRows}</b></span>
              <span>Parse failures: <b className="text-zinc-100">{preview.summary.parseFailures}</b></span>
            </div>
            {preview.summary.samples.length > 0 && (
              <div className="max-h-40 overflow-auto rounded border border-zinc-800">
                {preview.summary.samples.map((sample, index) => (
                  <div key={`${sample.rowId}-${sample.column}-${index}`} className="border-b border-zinc-800 px-2 py-1 last:border-0">
                    <span className="text-zinc-600">#{sample.rowId} {sample.column}: </span>
                    <span className="text-red-300">{sample.before ?? 'NULL'}</span>
                    <span className="text-zinc-600"> → </span>
                    <span className="text-emerald-300">{sample.after ?? 'NULL'}</span>
                  </div>
                ))}
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
