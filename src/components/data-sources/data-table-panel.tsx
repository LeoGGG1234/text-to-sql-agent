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
import type { ColumnMeta } from './data-table';

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
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [currentTable, setCurrentTable] = useState<string>('');
  const [schemaLoading, setSchemaLoading] = useState(true);

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
    setSchemaLoading(true);
    fetch(`/api/data-sources/${dataSourceId}`)
      .then((r) => r.json())
      .then((ds) => {
        const schemaJson = ds.schemaJson;
        const tbls: TableInfo[] = schemaJson?.tables ?? [];
        setTables(tbls);
        if (tbls.length > 0) {
          setCurrentTable(tbls[0].name);
        }
      })
      .catch(() => setError('Failed to load schema.'))
      .finally(() => setSchemaLoading(false));
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
  const fetchRows = useCallback(() => {
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
    fetch(`/api/data-sources/${dataSourceId}/rows?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          setError(d.error);
        } else {
          setData(d);
          setError(null);
          setSelectedRows(new Set());
        }
      })
      .catch(() => setError('Failed to fetch rows.'))
      .finally(() => setLoading(false));
  }, [currentTable, page, pageSize, sort, order, search, dataSourceId]);

  useEffect(() => {
    fetchRows();
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
    setSelectedRows(new Set());
    fetchRows();
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
    </div>
  );
}
