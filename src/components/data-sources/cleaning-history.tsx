import type { CleaningRecipe, CleaningSummary } from '@/lib/data-sources/cleaning-types';
import type { TableProfile } from '@/lib/data-sources/types';

type CleaningStep = CleaningRecipe['steps'][number];

export interface CleaningRun {
  id: string;
  recipe: CleaningRecipe;
  previewSummary: CleaningSummary | null;
  beforeValidation: TableProfile | null;
  afterValidation: TableProfile | null;
  status: string;
  baseRevision: number;
  resultRevision: number | null;
  createdAt: string;
  appliedAt: string | null;
}

function stepTarget(step: CleaningStep): string {
  if ('columns' in step) return step.columns.join(', ');
  if (step.type === 'fill_missing') return step.column;
  return step.keys?.join(', ') ?? 'all columns';
}

function stepPolicy(step: CleaningStep): string | null {
  if (step.type === 'normalize_numeric') {
    const percentage = step.percentageMode === 'decimal' ? 'percent → decimal' : 'percent sign removed';
    const failure = step.onError === 'set_null' ? 'failures → NULL' : 'failures kept';
    return `${percentage}; ${failure}`;
  }
  if (step.type === 'normalize_boolean') {
    const failure = step.onError === 'set_null' ? 'unknown values → NULL' : 'unknown values kept';
    return `configured values → boolean; ${failure}`;
  }
  if (step.type === 'normalize_date') return 'ambiguous or invalid dates kept';
  if (step.type === 'drop_duplicates') return step.keys?.length ? 'selected keys' : 'exact full-row matches';
  return null;
}

export function CleaningRecipeSteps({ recipe }: { recipe: CleaningRecipe }) {
  return (
    <ol className="list-decimal space-y-1 pl-4 text-zinc-400">
      {recipe.steps.map((step, index) => (
        <li key={`${step.type}-${index}`}>
          <code>{step.type}</code>{' '}
          {stepTarget(step)}
          {stepPolicy(step) ? <span className="block text-[10px] text-zinc-600">{stepPolicy(step)}</span> : null}
        </li>
      ))}
    </ol>
  );
}

function RunImpact({ summary }: { summary: CleaningSummary }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-zinc-400">
      <span>Affected rows</span><span className="text-right text-zinc-200">{summary.affectedRows}</span>
      <span>Affected cells</span><span className="text-right text-zinc-200">{summary.affectedCells}</span>
      <span>Removed rows</span><span className="text-right text-zinc-200">{summary.removedRows}</span>
      <span>Parse failures</span><span className="text-right text-zinc-200">{summary.parseFailures}</span>
      <span>Generated NULLs</span><span className="text-right text-zinc-200">{summary.generatedNulls}</span>
      <span>Output rows</span><span className="text-right text-zinc-200">{summary.outputRows}</span>
    </div>
  );
}

export function RemovedRowEvidence({ summary }: { summary: CleaningSummary }) {
  const samples = summary.removedRowSamples ?? [];
  if (samples.length === 0) return null;

  return (
    <div className="rounded border border-rose-900/40 bg-rose-950/20 p-2">
      <div className="mb-1 font-medium text-rose-300">Removed row evidence</div>
      <div className="space-y-1 text-zinc-400">
        {samples.map((sample) => (
          <div key={`${sample.reason}-${sample.rowId}`}>
            <span className="text-zinc-500">#{sample.rowId}: </span>
            {sample.reason === 'duplicate' ? (
              <span>
                duplicate of #{sample.keptRowId} by{' '}
                {sample.match === 'all_columns'
                  ? 'all columns'
                  : sample.columns.join(', ')}
              </span>
            ) : (
              <span>missing {sample.columns.join(', ')}</span>
            )}
          </div>
        ))}
      </div>
      {summary.removedRows > samples.length ? (
        <p className="mt-1 text-[10px] text-zinc-600">
          Showing {samples.length} of {summary.removedRows} removed rows.
        </p>
      ) : null}
    </div>
  );
}

export function CleaningHistory({ history, loading }: { history: CleaningRun[]; loading: boolean }) {
  const appliedRuns = history.filter((run) => run.status === 'applied');
  const totals = appliedRuns.reduce((result, run) => {
    const summary = run.previewSummary;
    if (!summary) return result;
    result.affectedRows += summary.affectedRows;
    result.affectedCells += summary.affectedCells;
    result.removedRows += summary.removedRows;
    result.parseFailures += summary.parseFailures;
    return result;
  }, { affectedRows: 0, affectedCells: 0, removedRows: 0, parseFailures: 0 });

  return (
    <section className="space-y-3" aria-labelledby="cleaning-history-heading">
      <div>
        <div id="cleaning-history-heading" className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          Cleaning dashboard
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded border border-zinc-800 bg-zinc-900 p-2">
            <div className="text-[10px] text-zinc-500">Applied runs</div>
            <div className="mt-1 text-lg font-semibold text-zinc-100">{appliedRuns.length}</div>
          </div>
          <div className="rounded border border-zinc-800 bg-zinc-900 p-2">
            <div className="text-[10px] text-zinc-500">Rows affected</div>
            <div className="mt-1 text-lg font-semibold text-zinc-100">{totals.affectedRows}</div>
          </div>
          <div className="rounded border border-zinc-800 bg-zinc-900 p-2">
            <div className="text-[10px] text-zinc-500">Cells changed</div>
            <div className="mt-1 text-lg font-semibold text-zinc-100">{totals.affectedCells}</div>
          </div>
          <div className="rounded border border-zinc-800 bg-zinc-900 p-2">
            <div className="text-[10px] text-zinc-500">Rows removed</div>
            <div className="mt-1 text-lg font-semibold text-zinc-100">{totals.removedRows}</div>
          </div>
        </div>
        <p className="mt-2 text-[10px] text-zinc-600">
          Totals include applied runs among the latest 20 history entries. A row may be counted again if later recipes change it.
        </p>
        {totals.parseFailures > 0 ? (
          <p className="mt-1 text-[10px] text-amber-400">{totals.parseFailures} parse failures encountered across applied runs.</p>
        ) : null}
      </div>

      <div>
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500">Run history</div>
        {loading ? <p className="text-zinc-600">Loading cleaning history...</p> : history.length === 0 ? <p className="text-zinc-600">No cleaning runs yet.</p> : (
          <div className="space-y-2">
            {history.map((run) => {
              const before = run.beforeValidation;
              const after = run.afterValidation;
              return (
                <details key={run.id} className="group rounded border border-zinc-800 bg-zinc-900">
                  <summary className="cursor-pointer list-none p-2 marker:hidden">
                    <div className="flex items-center justify-between gap-3 text-zinc-300">
                      <span className="truncate">{run.recipe.name}</span>
                      <span className={run.status === 'applied' ? 'text-emerald-400' : 'text-indigo-300'}>{run.status}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[10px] text-zinc-600">
                      <span>{new Date(run.appliedAt ?? run.createdAt).toLocaleString()}</span>
                      <span>{run.previewSummary ? `${run.previewSummary.affectedRows} affected rows` : 'Summary unavailable'}</span>
                    </div>
                  </summary>
                  <div className="space-y-3 border-t border-zinc-800 p-3">
                    <div>
                      <div className="mb-1 font-medium text-zinc-300">Recipe</div>
                      <CleaningRecipeSteps recipe={run.recipe} />
                    </div>
                    <div>
                      <div className="mb-1 font-medium text-zinc-300">Run impact</div>
                      {run.previewSummary ? (
                        <div className="space-y-2">
                          <RunImpact summary={run.previewSummary} />
                          <RemovedRowEvidence summary={run.previewSummary} />
                        </div>
                      ) : <p className="text-zinc-600">Impact summary unavailable.</p>}
                    </div>
                    <div className="flex justify-between text-zinc-400">
                      <span>Data revision</span>
                      <span className="text-zinc-200">
                        {run.baseRevision} → {run.resultRevision ?? (run.status === 'previewed' ? 'preview only' : 'unknown')}
                      </span>
                    </div>
                    {before && after ? (
                      <div>
                        <div className="mb-1 font-medium text-zinc-300">Validation</div>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-zinc-400">
                          <span>Duplicate rows</span><span className="text-right text-zinc-200">{before.duplicateRowCount} → {after.duplicateRowCount}</span>
                          <span>Columns with issues</span><span className="text-right text-zinc-200">{before.columnsWithIssues} → {after.columnsWithIssues}</span>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
