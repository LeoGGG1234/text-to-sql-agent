'use client';

/**
 * Upload form for CSV/Excel files.
 *
 * Drag-and-drop or file picker. Validates type and size client-side,
 * then POSTs multipart to /api/data-sources/upload.
 */

import { useState, useRef, type DragEvent, type ChangeEvent } from 'react';

const MAX_FILE_MB = 80;

interface Props {
  onSuccess: (result: { id: string; name: string; rowCount: number; columns: Array<{ name: string; semanticType: string }> }) => void;
  onCancel: () => void;
}

export function UploadForm({ onSuccess, onCancel }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function validateAndSet(f: File | null) {
    setError(null);
    if (!f) return;
    const ext = f.name.split('.').pop()?.toLowerCase();
    if (!ext || !['csv', 'xlsx', 'xls'].includes(ext)) {
      setError('Only .csv, .xlsx, .xls files are supported.');
      return;
    }
    if (f.size > MAX_FILE_MB * 1024 * 1024) {
      setError(`File too large (${(f.size / 1024 / 1024).toFixed(1)} MB). Limit: ${MAX_FILE_MB} MB.`);
      return;
    }
    setFile(f);
    if (!name) {
      setName(f.name.replace(/\.[^.]+$/, ''));
    }
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    validateAndSet(e.dataTransfer.files[0] ?? null);
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    validateAndSet(e.target.files?.[0] ?? null);
  }

  async function handleSubmit() {
    if (!file) return;
    setUploading(true);
    setError(null);

    const fd = new FormData();
    fd.append('file', file);
    if (name.trim()) fd.append('name', name.trim());

    try {
      const res = await fetch('/api/data-sources/upload', {
        method: 'POST',
        body: fd,
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? 'Upload failed.');
      } else {
        onSuccess(body);
      }
    } catch {
      setError('Network error during upload.');
    }
    setUploading(false);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-400">Upload CSV / Excel</span>
        <button onClick={onCancel} className="text-xs text-zinc-500 hover:text-zinc-300">
          Cancel
        </button>
      </div>

      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg px-4 py-6 text-center cursor-pointer transition ${
          dragOver
            ? 'border-indigo-400 bg-indigo-900/20'
            : 'border-zinc-700 hover:border-zinc-500'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={handleChange}
          className="hidden"
        />
        {file ? (
          <div className="text-sm text-zinc-200">
            📄 {file.name} <span className="text-zinc-500 text-xs">({(file.size / 1024).toFixed(1)} KB)</span>
          </div>
        ) : (
          <p className="text-xs text-zinc-500">
            Drop a file here or click to browse.<br />
            <span className="text-zinc-600">.csv, .xlsx, .xls · max {MAX_FILE_MB} MB · 200k rows</span>
          </p>
        )}
      </div>

      {/* Name input */}
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Data source name (optional)"
        className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition"
      />

      {/* Error */}
      {error && (
        <div className="px-3 py-2 bg-red-900/20 border border-red-800/30 rounded-lg text-xs text-red-400">
          {error}
        </div>
      )}

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={!file || uploading}
        className="w-full px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg text-sm font-medium transition"
      >
        {uploading ? (
          <span className="flex items-center justify-center gap-2">
            <span className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="w-1 h-1 bg-white rounded-full animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </span>
            Uploading...
          </span>
        ) : (
          'Upload'
        )}
      </button>
    </div>
  );
}
