'use client';

import { useState, useRef, useEffect, type KeyboardEvent } from 'react';

interface Props {
  value: string | null;
  column: string;
  rowId: number;
  onSave: (rowId: number, column: string, value: string) => Promise<void>;
}

export function DataTableCell({ value, column, rowId, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(value ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  function handleStartEdit() {
    if (saving) return;
    setEditValue(value ?? '');
    setError(null);
    setEditing(true);
  }

  async function handleSave() {
    if (editValue === (value ?? '')) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(rowId, column, editValue);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
    setSaving(false);
  }

  function handleCancel() {
    setEditValue(value ?? '');
    setError(null);
    setEditing(false);
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  }

  if (editing) {
    return (
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleCancel}
          className={`w-full px-1.5 py-0.5 text-xs bg-zinc-800 border rounded outline-none transition ${
            saving ? 'border-amber-500/50 opacity-50' :
            error ? 'border-red-500' :
            'border-indigo-500'
          } text-zinc-100`}
          disabled={saving}
        />
        {saving && (
          <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] text-amber-400">
            …
          </span>
        )}
        {error && (
          <span className="absolute -bottom-4 left-0 text-[10px] text-red-400 whitespace-nowrap">
            {error}
          </span>
        )}
      </div>
    );
  }

  const display = value === null || value === ''
    ? <span className="text-zinc-600 italic">NULL</span>
    : <span className="block truncate">{value}</span>;

  return (
    <div
      onClick={handleStartEdit}
      className="px-1.5 py-0.5 text-xs cursor-text hover:bg-zinc-800/50 rounded min-h-[24px] flex items-center transition max-w-[300px]"
      title={value ?? 'NULL'}
    >
      {display}
    </div>
  );
}
