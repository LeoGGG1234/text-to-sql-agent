'use client';

interface Props {
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export function DeleteConfirmDialog({ count, onConfirm, onCancel, loading }: Props) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      {/* Dialog */}
      <div className="relative bg-zinc-900 border border-zinc-700 rounded-xl px-6 py-5 max-w-sm w-full mx-4 shadow-2xl">
        <h3 className="text-sm font-medium text-zinc-100 mb-2">Delete {count} row{count > 1 ? 's' : ''}?</h3>
        <p className="text-xs text-zinc-400 mb-4">
          This action cannot be undone. The data will be permanently removed.
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-3 py-1.5 text-xs text-zinc-300 hover:text-zinc-100 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="px-3 py-1.5 text-xs text-white bg-red-600 hover:bg-red-500 rounded-lg transition disabled:opacity-50"
          >
            {loading ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
