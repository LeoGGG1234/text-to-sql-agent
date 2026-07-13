'use client';

import { DataTableCell } from './data-table-cell';

export interface ColumnMeta {
  name: string;
  displayName: string;
  semanticType: string;
}

interface Props {
  columns: ColumnMeta[];
  rows: Array<Record<string, unknown>>;
  sort: string | null;
  order: 'asc' | 'desc';
  onSort: (column: string) => void;
  selectedRows: Set<number>;
  onSelectionChange: (ids: Set<number>) => void;
  onCellSave: (rowId: number, column: string, value: string) => Promise<void>;
  loading?: boolean;
}

export function DataTable({
  columns,
  rows,
  sort,
  order,
  onSort,
  selectedRows,
  onSelectionChange,
  onCellSave,
  loading,
}: Props) {
  function toggleSelectAll() {
    if (selectedRows.size === rows.length) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(rows.map((r) => Number(r._row_id))));
    }
  }

  function toggleRow(rowId: number) {
    const next = new Set(selectedRows);
    if (next.has(rowId)) {
      next.delete(rowId);
    } else {
      next.add(rowId);
    }
    onSelectionChange(next);
  }

  return (
    <div className="overflow-auto flex-1">
      <table className="border-collapse table-auto">
        <thead>
          <tr className="border-b border-zinc-700 bg-zinc-950 sticky top-0 z-10">
            {/* Checkbox column */}
            <th className="w-8 px-1 py-1.5">
              <input
                type="checkbox"
                checked={rows.length > 0 && selectedRows.size === rows.length}
                onChange={toggleSelectAll}
                className="w-3 h-3 rounded border-zinc-600 bg-zinc-800 accent-indigo-500 cursor-pointer"
              />
            </th>
            {columns.map((col) => {
              const isSorted = sort === col.name;
              return (
                <th
                  key={col.name}
                  onClick={() => onSort(col.name)}
                  className="px-2 py-1.5 text-left text-[11px] font-medium text-zinc-400 cursor-pointer hover:text-zinc-200 hover:bg-zinc-800/50 transition select-none whitespace-nowrap min-w-[100px]"
                  title={col.displayName !== col.name ? col.displayName : undefined}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.displayName}
                    {isSorted && (
                      <span className="text-indigo-400">{order === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading && rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length + 1} className="px-4 py-12 text-center text-xs text-zinc-500">
                Loading...
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length + 1} className="px-4 py-12 text-center text-xs text-zinc-500">
                No rows found.
              </td>
            </tr>
          ) : (
            rows.map((row, ri) => {
              const rowId = Number(row._row_id);
              return (
                <tr
                  key={rowId}
                  className={`border-b border-zinc-800/50 transition ${
                    selectedRows.has(rowId)
                      ? 'bg-indigo-900/20'
                      : ri % 2 === 0
                        ? 'bg-transparent'
                        : 'bg-zinc-900/30'
                  } hover:bg-zinc-800/30`}
                >
                  <td className="w-8 px-1 py-0.5">
                    <input
                      type="checkbox"
                      checked={selectedRows.has(rowId)}
                      onChange={() => toggleRow(rowId)}
                      className="w-3 h-3 rounded border-zinc-600 bg-zinc-800 accent-indigo-500 cursor-pointer"
                    />
                  </td>
                  {columns.map((col) => (
                    <td key={col.name} className="px-2 py-0.5">
                      <DataTableCell
                        value={(row[col.name] as string | null) ?? null}
                        column={col.name}
                        rowId={rowId}
                        onSave={onCellSave}
                      />
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
