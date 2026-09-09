'use client';

/**
 * Schema preview — compact table/column display for a data source.
 * Now includes data quality badges for uploaded data sources.
 */

import type { ColumnProfile, ProfileStatus, QualityProfile } from '@/lib/data-sources/types';

export interface ColumnInfo {
  name: string;
  displayName?: string;
  type?: string;
  semanticType?: string;
  nullable?: boolean;
  hint?: string;
}

export interface TableInfo {
  name: string;
  displayName?: string;
  rowCount?: number;
  columns?: ColumnInfo[];
}

interface Props {
  tables?: TableInfo[] | null | undefined;
  qualityProfile?: QualityProfile | null;
  profileStatus?: ProfileStatus;
  profiledAt?: string | null;
}

export function SchemaPreview({ tables, qualityProfile, profileStatus, profiledAt }: Props) {
  if (!tables?.length) {
    return (
      <div className="px-3 py-2 text-xs text-zinc-600">
        No schema info available.
      </div>
    );
  }

  return (
    <div className="space-y-2 px-1">
      {profileStatus === 'stale' && (
        <div className="rounded-lg border border-amber-800/40 bg-amber-950/30 px-3 py-2 text-[11px] text-amber-300">
          Quality profile is stale because the data changed. Re-profile before relying on these counts.
        </div>
      )}
      {profiledAt && profileStatus !== 'stale' && (
        <div className="px-1 text-[10px] text-zinc-600">
          Profiled {new Date(profiledAt).toLocaleString()}
        </div>
      )}
      {tables.map((t, ti) => (
        <div key={ti} className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
          <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-200">
              {t.displayName ?? t.name}
            </span>
            {t.rowCount != null && (
              <span className="text-[10px] text-zinc-500">{t.rowCount} rows</span>
            )}
          </div>
          <div className="px-3 py-1.5">
            {t.columns?.map((c, ci) => {
              const cp: ColumnProfile | undefined =
                qualityProfile?.columns?.[c.name];
              const currentProfile =
                cp?.databaseNullCount !== undefined ||
                cp?.nullMarkerCount !== undefined;
              const databaseNullCount = cp
                ? currentProfile
                  ? cp.databaseNullCount ?? 0
                  : cp.nullConvertedCount ?? 0
                : 0;
              const nullMarkerCount = cp?.nullMarkerCount ?? 0;
              const nullMarkerSamples = cp?.nullMarkerSamples ?? {};
              const invalidCount = cp?.invalidCount ?? cp?.nonMatchingCount ?? 0;
              const ambiguousCount = cp?.ambiguousCount ?? 0;
              const isClean =
                cp != null &&
                databaseNullCount === 0 &&
                nullMarkerCount === 0 &&
                cp.nonMatchingCount === 0 &&
                cp.trimmedCount === 0 &&
                cp.fuzzyDuplicateClusters === 0;
              return (
                <div key={ci} className="flex items-center gap-2 py-1 text-xs flex-wrap">
                  <span className="text-zinc-200 font-mono">{c.name}</span>
                  {c.semanticType && c.semanticType !== 'TEXT' && (
                    <span className={`text-[10px] px-1 py-0.1 rounded ${
                      c.semanticType === 'NUMERIC'
                        ? 'bg-green-900/40 text-green-400'
                        : c.semanticType === 'DATE'
                          ? 'bg-blue-900/40 text-blue-400'
                          : 'bg-amber-900/40 text-amber-400'
                    }`}>
                      {c.semanticType}
                    </span>
                  )}
                  {c.nullable && (
                    <span className="text-[10px] text-zinc-600">nullable</span>
                  )}
                  {/* Quality badges */}
                  {cp && databaseNullCount > 0 && (
                    <span
                      className="text-[10px] px-1 py-0.1 rounded bg-amber-900/40 text-amber-400"
                      title={`${databaseNullCount} database NULL values`}
                    >
                      {databaseNullCount} DB NULL
                    </span>
                  )}
                  {cp && nullMarkerCount > 0 && (
                    <span
                      className="text-[10px] px-1 py-0.1 rounded bg-amber-900/40 text-amber-300"
                      title={`${nullMarkerCount} NULL-like text markers (${Object.entries(nullMarkerSamples)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 3)
                        .map(([key, count]) => `${key}×${count}`)
                        .join(', ')}) remain stored as text`}
                    >
                      {nullMarkerCount} markers
                    </span>
                  )}
                  {cp && cp.nonMatchingCount > 0 && (
                    <span
                      className="text-[10px] px-1 py-0.1 rounded bg-red-900/40 text-red-400"
                      title={`${invalidCount} invalid and ${ambiguousCount} ambiguous ${c.semanticType} values (e.g. ${cp.nonMatchingSamples.join(', ')})`}
                    >
                      {cp.nonMatchingCount} invalid/ambiguous
                    </span>
                  )}
                  {cp && cp.trimmedCount > 0 && (
                    <span
                      className="text-[10px] px-1 py-0.1 rounded bg-orange-900/40 text-orange-300"
                      title={`${cp.trimmedCount} values contain leading or trailing whitespace`}
                    >
                      {cp.trimmedCount} whitespace
                    </span>
                  )}
                  {cp && cp.fuzzyDuplicateClusters > 0 && (
                    <span
                      className="text-[10px] px-1 py-0.1 rounded bg-purple-900/40 text-purple-400"
                      title={`${cp.fuzzyDuplicateClusters} near-duplicate values (e.g. ${cp.fuzzyDuplicateSamples.slice(0, 2).map((s) => `"${s.a}" ≈ "${s.b}"`).join(', ')})`}
                    >
                      {cp.fuzzyDuplicateClusters} fuzzy
                    </span>
                  )}
                  {isClean && (
                      <span className="text-[10px] px-1 py-0.1 rounded bg-emerald-900/40 text-emerald-400">
                        clean
                      </span>
                    )}
                  {c.displayName && c.displayName !== c.name && (
                    <span className="text-zinc-600">({c.displayName})</span>
                  )}
                </div>
              );
            })}
            {(!t.columns || t.columns.length === 0) && (
              <p className="text-xs text-zinc-600 py-1">No column info</p>
            )}
          </div>
          {/* Table-level quality warnings */}
          {qualityProfile?.table && qualityProfile.table.duplicateRatio > 0.10 && (
            <div className="px-3 py-1.5 border-t border-zinc-800 bg-red-900/20">
              <span className="text-[10px] text-red-400">
                ⚠ {Math.round(qualityProfile.table.duplicateRatio * 100)}% duplicate rows ({qualityProfile.table.duplicateRowCount} rows)
              </span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
