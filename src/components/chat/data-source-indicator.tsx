'use client';

/**
 * Small badge in the chat header showing the active data source.
 */

interface Props {
  name: string | null;
  onClick: () => void;
}

export function DataSourceIndicator({ name, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-full text-xs text-zinc-300 transition"
      title="Click to change data source"
    >
      <span className="text-[11px]">
        {name ? '📄' : '🏪'}
      </span>
      <span className="max-w-[120px] truncate">
        {name ?? 'Retail Demo'}
      </span>
      <svg className="w-3 h-3 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  );
}
