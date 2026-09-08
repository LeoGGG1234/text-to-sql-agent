'use client';

/**
 * Data Source Manager — slide-over panel for managing uploaded data sources.
 */

import { useState, useEffect, useCallback } from 'react';
import { UploadForm } from './upload-form';
import { SchemaPreview, type TableInfo } from './schema-preview';
import type { ProfileStatus, QualityProfile } from '@/lib/data-sources/types';

interface DataSource {
  id: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  schemaJson?: Record<string, unknown> | null;
  profileStatus: ProfileStatus;
  profiledAt?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (id: string, name: string) => void;
  selectedId: string | null;
  onViewData: (dsId: string) => void;
}

export function DataSourceManager({ open, onClose, onSelect, selectedId, onViewData }: Props) {
  const [dataSources, setDataSources] = useState<DataSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [profiling, setProfiling] = useState<string | null>(null);

  const fetchSources = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/data-sources');
    if (res.ok) {
      const { dataSources: ds } = await res.json();
      setDataSources(ds ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (open) fetchSources();
  }, [open, fetchSources]);

  async function handleDelete(id: string) {
    setDeleting(id);
    const res = await fetch(`/api/data-sources/${id}`, { method: 'DELETE' });
    if (res.ok) {
      if (selectedId === id) onSelect('', 'Retail Demo');
      setDataSources((prev) => prev.filter((d) => d.id !== id));
      if (previewId === id) setPreviewId(null);
    }
    setDeleting(null);
  }

  async function handleProfile(id: string) {
    setProfiling(id);
    const res = await fetch(`/api/data-sources/${id}/profile`, { method: 'POST' });
    if (res.ok) await fetchSources();
    setProfiling(null);
  }

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/60"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 z-50 w-96 max-w-[90vw] bg-zinc-950 border-l border-zinc-800 overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-zinc-950 border-b border-zinc-800 px-4 py-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-100">Data Sources</h2>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 transition text-lg leading-none"
          >
            ✕
          </button>
        </div>

        <div className="px-4 py-3 space-y-3">
          {/* Built-in retail demo */}
          <button
            onClick={() => { onSelect('', 'Retail Demo'); onClose(); }}
            className={`w-full text-left px-4 py-3 rounded-lg border transition ${
              !selectedId
                ? 'border-indigo-500 bg-indigo-900/20'
                : 'border-zinc-800 bg-zinc-900 hover:border-zinc-700'
            }`}
          >
            <div className="text-sm font-medium text-zinc-100">🏪 Retail Demo Database</div>
            <div className="text-xs text-zinc-500 mt-0.5">
              6 tables · customers, orders, products...
            </div>
          </button>

          {/* User data sources */}
          {loading && (
            <div className="flex items-center justify-center py-8">
              <div className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </div>
            </div>
          )}

          {!loading &&
            dataSources.map((ds) => (
              <div key={ds.id} className="space-y-1">
                <button
                  onClick={() => onSelect(ds.id, ds.name)}
                  className={`w-full text-left px-4 py-3 rounded-lg border transition ${
                    selectedId === ds.id
                      ? 'border-indigo-500 bg-indigo-900/20'
                      : 'border-zinc-800 bg-zinc-900 hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-zinc-100">
                      📄 {ds.name}
                    </span>
                    <span className="text-[10px] text-zinc-600 uppercase bg-zinc-800 px-1.5 py-0.5 rounded">
                      {ds.type}
                    </span>
                  </div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    {new Date(ds.createdAt).toLocaleDateString()}
                  </div>
                </button>

                {/* Actions row */}
                <div className="flex gap-2 px-1">
                  <button
                    onClick={() => setPreviewId(previewId === ds.id ? null : ds.id)}
                    className="text-[11px] text-zinc-500 hover:text-zinc-300 transition"
                  >
                    {previewId === ds.id ? 'Hide schema' : 'Schema'}
                  </button>
                  <button
                    onClick={() => { onViewData(ds.id); onClose(); }}
                    className="text-[11px] text-indigo-500 hover:text-indigo-400 transition"
                  >
                    View Data
                  </button>
                  <button
                    onClick={() => handleProfile(ds.id)}
                    disabled={profiling === ds.id}
                    className={`text-[11px] transition disabled:opacity-50 ${
                      ds.profileStatus === 'stale'
                        ? 'text-amber-400 hover:text-amber-300'
                        : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    {profiling === ds.id ? 'Profiling...' : ds.profileStatus === 'stale' ? 'Re-profile' : 'Profile'}
                  </button>
                  <button
                    onClick={() => handleDelete(ds.id)}
                    disabled={deleting === ds.id}
                    className="text-[11px] text-zinc-600 hover:text-red-400 transition disabled:opacity-50"
                  >
                    {deleting === ds.id ? 'Deleting...' : 'Delete'}
                  </button>
                </div>

                {/* Schema preview */}
                {previewId === ds.id && ds.schemaJson && (
                  <SchemaPreview
                    tables={(ds.schemaJson as unknown as { tables?: TableInfo[] }).tables}
                    qualityProfile={
                      (ds.schemaJson as unknown as { qualityProfile?: QualityProfile }).qualityProfile ?? null
                    }
                    profileStatus={ds.profileStatus}
                    profiledAt={ds.profiledAt}
                  />
                )}
              </div>
            ))}

          {!loading && dataSources.length === 0 && (
            <p className="text-xs text-zinc-500 text-center py-4">
              No uploaded data sources yet.
            </p>
          )}

          {/* Add new */}
          <div className="pt-2 border-t border-zinc-800">
            {!showUpload ? (
              <button
                onClick={() => setShowUpload(true)}
                className="w-full px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition"
              >
                + Upload CSV / Excel
              </button>
            ) : (
              <div className="space-y-3">
                <UploadForm
                  onSuccess={() => {
                    fetchSources();
                    setShowUpload(false);
                  }}
                  onCancel={() => setShowUpload(false)}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
