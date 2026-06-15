'use client';

/**
 * Tool Result Card — renders structured tool results as visual cards.
 *
 * Dispatches on toolName:
 * - runSql      → data table (or a friendly error card)
 * - renderChart → Recharts chart (ChartCard)
 * - getSchema   → collapsed schema summary
 */

import { ChartCard } from '@/components/chat/chart-card';

interface ToolResultCardProps {
  toolName: string;
  result: unknown;
}

export function ToolResultCard({ toolName, result }: ToolResultCardProps) {
  if (!result) return null;

  switch (toolName) {
    case 'runSql':
      return <SqlResultCard result={result} />;
    case 'renderChart':
      return <ChartCard result={result} />;
    case 'getSchema':
      return <SchemaCard result={result} />;
    default:
      return <GenericResultCard toolName={toolName} result={result} />;
  }
}

// ─── runSql ────────────────────────────────────────────────────

interface SqlSuccess {
  success: true;
  sql: string;
  rowCount: number;
  columns: string[];
  rows: Record<string, unknown>[];
  truncated?: boolean;
  rowsOmitted?: number;
  durationMs?: number;
}
interface SqlFailure {
  success: false;
  code: string;
  error: string;
  sql?: string;
}

function SqlResultCard({ result }: { result: unknown }) {
  const r = result as SqlSuccess | SqlFailure;

  if (!r.success) {
    return (
      <div className="mt-2 rounded-lg bg-red-950/30 border border-red-900/40 overflow-hidden">
        <div className="px-3 py-1.5 bg-red-950/40 text-xs text-red-400 font-mono">
          {r.code}
        </div>
        {r.sql && (
          <pre className="px-3 py-2 text-xs text-zinc-500 overflow-x-auto border-b border-red-900/30">
            {r.sql}
          </pre>
        )}
        <div className="px-3 py-2 text-xs text-red-300">{r.error}</div>
      </div>
    );
  }

  const rows = r.rows ?? [];
  const columns = r.columns ?? (rows[0] ? Object.keys(rows[0]) : []);
  const preview = rows.slice(0, 20);

  return (
    <div className="mt-2 rounded-lg bg-zinc-950 border border-zinc-800 overflow-hidden">
      {/* SQL */}
      <pre className="px-3 py-2 text-xs text-indigo-300/80 overflow-x-auto border-b border-zinc-800 bg-zinc-900/40">
        {r.sql}
      </pre>

      {/* Result table */}
      {columns.length > 0 ? (
        <div className="overflow-x-auto max-h-72">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-zinc-900">
              <tr>
                {columns.map((c) => (
                  <th
                    key={c}
                    className="text-left px-3 py-1.5 text-zinc-400 font-medium border-b border-zinc-800 whitespace-nowrap"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.map((row, i) => (
                <tr key={i} className="border-b border-zinc-800/50">
                  {columns.map((c) => (
                    <td key={c} className="px-3 py-1.5 text-zinc-300 whitespace-nowrap">
                      {formatCell(row[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-3 py-2 text-xs text-zinc-500">查询无返回结果</div>
      )}

      {/* Footer */}
      <div className="px-3 py-1.5 text-xs text-zinc-600 border-t border-zinc-800 flex gap-3">
        <span>{r.rowCount} 行</span>
        {r.rowCount > preview.length && <span>（预览前 {preview.length} 行）</span>}
        {r.truncated && <span className="text-amber-500/70">已截断至 1000 行</span>}
        {typeof r.durationMs === 'number' && <span>{r.durationMs}ms</span>}
      </div>
    </div>
  );
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') {
    // Keep money/decimals readable.
    return Number.isInteger(v) ? String(v) : v.toFixed(2);
  }
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return s.length > 60 ? s.slice(0, 60) + '…' : s;
}

// ─── getSchema ─────────────────────────────────────────────────

function SchemaCard({ result }: { result: unknown }) {
  const r = result as { tables?: { name: string; columns: { name: string }[] }[] };
  const tables = r.tables ?? [];
  return (
    <div className="mt-2 p-3 rounded-lg bg-zinc-950 border border-zinc-800">
      <div className="text-xs text-zinc-500 mb-2">数据库结构</div>
      <div className="space-y-1.5">
        {tables.map((t) => (
          <div key={t.name} className="text-xs">
            <span className="text-indigo-300">{t.name}</span>
            <span className="text-zinc-600">
              {' '}
              ({t.columns.map((c) => c.name).join(', ')})
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── fallback ──────────────────────────────────────────────────

function GenericResultCard({ toolName, result }: { toolName: string; result: unknown }) {
  return (
    <div className="mt-2 p-2.5 rounded-lg bg-zinc-950 border border-zinc-800">
      <div className="text-xs text-zinc-500 mb-1">{toolName}</div>
      <pre className="text-xs text-zinc-400 overflow-x-auto whitespace-pre-wrap">
        {JSON.stringify(result, null, 2)}
      </pre>
    </div>
  );
}
