'use client';

/**
 * DataTablePanel — Full-screen data grid for viewing/editing uploaded data.
 *
 * Opens as a wide slide-over panel. Fetches schemaJson on mount,
 * then loads paginated rows from GET /api/data-sources/[id]/rows.
 * Supports: sorting, text search, inline cell editing, row deletion, add row.
 */

import { useState, useEffect, useCallback } from 'react';
import { DataTable } from './data-table';
import { DataTablePagination } from './data-table-pagination';
import { DeleteConfirmDialog } from './delete-confirm-dialog';
import { CleaningPanel } from './cleaning-panel';
import type { ColumnMeta } from './data-table';
import type { ProfileStatus } from '@/lib/data-sources/types';

interface Props {
  open: boolean;
  onClose: () => void;
  dataSourceId: string;
}

interface TableInfo {
  name: string;
  displayName: string;
  rowCount: number;
}

interface RowResponse {
  rows: Array<Record<string, unknown>>;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  columns: ColumnMeta[];
  tableName: string;
  tableDisplayName: string;
}

export function DataTablePanel({ open, onClose, dataSourceId }: Props) {
  // Schema
  const [currentTable, setCurrentTable] = useState<string>('');
  const [schemaLoading, setSchemaLoading] = useState(true);
  const [profileStatus, setProfileStatus] = useState<ProfileStatus>('fresh');
  const [profiling, setProfiling] = useState(false);
  const [showCleaning, setShowCleaning] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Data
  const [data, setData] = useState<RowResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sort, setSort] = useState<string | null>(null);
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Selection & deletion
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Load schema on open.
  useEffect(() => {
    if (!open || !dataSourceId) return;
    const controller = new AbortController();
    setCurrentTable('');
    setData(null);
    setPage(1);
    setSort(null);
    setOrder('asc');
    setSearch('');
    setSearchInput('');
    setSelectedRows(new Set());
    setShowCleaning(false);
    setExporting(false);
    setError(null);
    setSchemaLoading(true);
    fetch(`/api/data-sources/${dataSourceId}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((ds) => {
        if (controller.signal.aborted) return;
        const schemaJson = ds.schemaJson;
        const tbls: TableInfo[] = schemaJson?.tables ?? [];
        setProfileStatus(ds.profileStatus ?? 'fresh');
        if (tbls.length > 0) {
          setCurrentTable(tbls[0].name);
        }
      })
      .catch((cause: unknown) => {
        if ((cause as { name?: string }).name !== 'AbortError') setError('Failed to load schema.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setSchemaLoading(false);
      });
    return () => controller.abort();
  }, [open, dataSourceId]);

  // Debounced search.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Fetch rows.
  const fetchRows = useCallback((signal?: AbortSignal) => {
    if (!currentTable) return;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      table: currentTable,
      page: String(page),
      pageSize: String(pageSize),
      order,
    });
    if (sort) params.set('sort', sort);
    if (search) params.set('q', search);
    fetch(`/api/data-sources/${dataSourceId}/rows?${params}`, { signal })
      .then((r) => r.json())
      .then((d) => {
        if (signal?.aborted) return;
        if (d.error) {
          setError(d.error);
        } else {
          setData(d);
          setError(null);
          setSelectedRows(new Set());
        }
      })
      .catch((cause: unknown) => {
        if ((cause as { name?: string }).name !== 'AbortError') setError('Failed to fetch rows.');
      })
      .finally(() => {
        if (!signal?.aborted) setLoading(false);
      });
  }, [currentTable, page, pageSize, sort, order, search, dataSourceId]);

  useEffect(() => {
    const controller = new AbortController();
    fetchRows(controller.signal);
    return () => controller.abort();
  }, [fetchRows]);

  function handleSort(col: string) {
    if (sort === col) {
      if (order === 'asc') {
        setOrder('desc');
      } else {
        setSort(null);
        setOrder('asc');
      }
    } else {
      setSort(col);
      setOrder('asc');
    }
    setPage(1);
  }

  async function handleCellSave(rowId: number, column: string, value: string) {
    const res = await fetch(`/api/data-sources/${dataSourceId}/rows`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table: currentTable, rowId, column, value }),
    });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error ?? 'Save failed');
    }
    setProfileStatus('stale');
    // Update local row state so the display reflects the change.
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        rows: prev.rows.map((r) =>
          Number(r._row_id) === rowId ? { ...r, [column]: value } : r,
        ),
      };
    });
  }

  async function handleAddRow() {
    const res = await fetch(`/api/data-sources/${dataSourceId}/rows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table: currentTable }),
    });
    const body = await res.json();
    if (!res.ok) {
      setError(body.error ?? 'Failed to add row.');
      return;
    }
    setProfileStatus('stale');
    // Refresh data to include the new row.
    fetchRows();
  }

  async function handleDeleteSelected() {
    setDeleting(true);
    const res = await fetch(`/api/data-sources/${dataSourceId}/rows`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        table: currentTable,
        rowIds: Array.from(selectedRows),
      }),
    });
    const body = await res.json();
    setDeleting(false);
    setShowDeleteConfirm(false);
    if (!res.ok) {
      setError(body.error ?? 'Failed to delete rows.');
      return;
    }
    setProfileStatus('stale');
    setSelectedRows(new Set());
    fetchRows();
  }

  async function handleProfile() {
    setProfiling(true);
    setError(null);
    const res = await fetch(`/api/data-sources/${dataSourceId}/profile`, { method: 'POST' });
    const body = await res.json();
    setProfiling(false);
    if (!res.ok) {
      setError(body.error ?? 'Profiling failed.');
      return;
    }
    setProfileStatus('fresh');
    fetchRows();
  }

  async function handleExport() {
    setExporting(true);
    setError(null);
    try {
      const res = await fetch(`/api/data-sources/${dataSourceId}/export`);
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null;
        setError(body?.error ?? 'Export failed.');
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const encodedName = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
      let fileName = 'data-export.csv';
      if (encodedName) {
        try { fileName = decodeURIComponent(encodedName); } catch { /* keep safe fallback */ }
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError('Export failed.');
    } finally {
      setExporting(false);
    }
  }

  function handlePageChange(p: number) {
    setPage(p);
  }

  function handlePageSizeChange(ps: number) {
    setPageSize(ps);
    setPage(1);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Panel */}
      <div className="relative ml-auto w-full max-w-6xl bg-zinc-950 border-l border-zinc-800 flex flex-col h-full shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="text-sm font-semibold text-zinc-100 truncate">
              {data?.tableDisplayName ?? 'Data Preview'}
            </h2>
            {data && (
              <span className="text-[11px] text-zinc-500 tabular-nums">
                {data.total.toLocaleString()} rows
              </span>
            )}
            <span className={`rounded px-1.5 py-0.5 text-[10px] ${
              profileStatus === 'stale'
                ? 'bg-amber-950/50 text-amber-300'
                : 'bg-emerald-950/40 text-emerald-400'
            }`}>
              profile {profileStatus}
            </span>
          </div>
          <button
            onClick={onClose}
            className="px-2 py-1 text-zinc-500 hover:text-zinc-300 text-lg leading-none transition"
          >
            ✕
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-800 shrink-0 flex-wrap">
          {/* Search */}
          <div className="flex-1 min-w-[200px] max-w-md">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search all columns..."
              className="w-full px-2.5 py-1 text-xs bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition"
            />
          </div>

          {/* Add row button */}
          <button
            onClick={() => setShowCleaning(true)}
            disabled={schemaLoading || !data?.columns.length}
            className="px-3 py-1 text-[11px] font-medium text-purple-300 bg-purple-950/30 border border-purple-800/30 rounded-lg transition disabled:opacity-50"
          >
            Clean Data
          </button>

          <button
            onClick={handleExport}
            disabled={exporting || schemaLoading || !data}
            className="px-3 py-1 text-[11px] font-medium text-emerald-300 bg-emerald-950/30 border border-emerald-800/30 rounded-lg transition disabled:opacity-50"
          >
            {exporting ? 'Exporting...' : 'Export CSV'}
          </button>

          {/* Add row button */}
          <button
            onClick={handleProfile}
            disabled={profiling || schemaLoading}
            className="px-3 py-1 text-[11px] font-medium text-amber-300 bg-amber-950/30 border border-amber-800/30 rounded-lg transition disabled:opacity-50"
          >
            {profiling ? 'Profiling...' : profileStatus === 'stale' ? 'Re-profile' : 'Refresh profile'}
          </button>

          {/* Add row button */}
          <button
            onClick={handleAddRow}
            disabled={schemaLoading}
            className="px-3 py-1 text-[11px] font-medium text-indigo-400 hover:text-indigo-300 bg-indigo-950/30 hover:bg-indigo-900/30 border border-indigo-800/30 rounded-lg transition disabled:opacity-50"
          >
            + Row
          </button>

          {/* Delete selected */}
          {selectedRows.size > 0 && (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="px-3 py-1 text-[11px] font-medium text-red-400 hover:text-red-300 bg-red-950/30 hover:bg-red-900/30 border border-red-800/30 rounded-lg transition"
            >
              Delete {selectedRows.size}
            </button>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="mx-4 mt-2 px-3 py-1.5 bg-red-900/20 border border-red-800/30 rounded-lg text-[11px] text-red-400 shrink-0">
            {error}
          </div>
        )}

        {/* Table */}
        {schemaLoading ? (
          <div className="flex-1 flex items-center justify-center text-xs text-zinc-500">
            Loading schema...
          </div>
        ) : (
          <DataTable
            columns={data?.columns ?? []}
            rows={data?.rows ?? []}
            sort={sort}
            order={order}
            onSort={handleSort}
            selectedRows={selectedRows}
            onSelectionChange={setSelectedRows}
            onCellSave={handleCellSave}
            loading={loading}
          />
        )}

        {/* Pagination */}
        {data && data.total > 0 && (
          <DataTablePagination
            page={data.page}
            totalPages={data.totalPages}
            pageSize={data.pageSize}
            total={data.total}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
          />
        )}
      </div>

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <DeleteConfirmDialog
          count={selectedRows.size}
          onConfirm={handleDeleteSelected}
          onCancel={() => setShowDeleteConfirm(false)}
          loading={deleting}
        />
      )}
      {showCleaning && (
        <CleaningPanel
          dataSourceId={dataSourceId}
          columns={data?.columns ?? []}
          exporting={exporting}
          onClose={() => setShowCleaning(false)}
          onExport={() => void handleExport()}
          onApplied={() => {
            setProfileStatus('fresh');
            fetchRows();
          }}
        />
      )}
    </div>
  );
}
