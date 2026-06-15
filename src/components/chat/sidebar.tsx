'use client';

import { useState, useCallback } from 'react';
import type { ConversationSummary } from '@/app/page';

interface SidebarProps {
  conversations: ConversationSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

export function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
}: SidebarProps) {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const handleDelete = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      if (confirmDelete === id) {
        onDelete(id);
        setConfirmDelete(null);
      } else {
        setConfirmDelete(id);
      }
    },
    [confirmDelete, onDelete],
  );

  return (
    <aside className="w-64 shrink-0 border-r border-zinc-800 flex flex-col h-screen bg-zinc-950">
      {/* New Chat button */}
      <div className="p-3">
        <button
          onClick={onNew}
          className="w-full text-left px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm text-zinc-300 hover:border-zinc-700 hover:text-white transition"
        >
          + New Chat
        </button>
      </div>

      {/* Conversation list */}
      <nav className="flex-1 overflow-y-auto px-2 pb-2">
        {conversations.length === 0 && (
          <p className="text-xs text-zinc-600 text-center mt-8">
            No conversations yet
          </p>
        )}
        {conversations.map((conv) => (
          <button
            key={conv.id}
            onClick={() => onSelect(conv.id)}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm mb-0.5 group transition ${
              activeId === conv.id
                ? 'bg-zinc-800 text-white'
                : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
            }`}
          >
            <div className="truncate text-xs">
              {conv.title || 'New conversation'}
            </div>
            <div className="flex items-center justify-between mt-0.5">
              <span className="text-xs text-zinc-600">
                {fmtDate(conv.updatedAt)}
              </span>
              {conv.messageCount > 0 && (
                <span className="text-xs text-zinc-600">
                  {conv.messageCount}
                </span>
              )}
              {/* Delete button — visible on hover */}
              <button
                onClick={(e) => handleDelete(e, conv.id)}
                className={`text-xs transition ${
                  confirmDelete === conv.id
                    ? 'text-red-400 font-medium'
                    : 'text-zinc-700 opacity-0 group-hover:opacity-100 hover:text-red-400'
                }`}
                title={
                  confirmDelete === conv.id ? 'Click again to confirm' : 'Delete'
                }
              >
                {confirmDelete === conv.id ? 'Sure?' : '×'}
              </button>
            </div>
          </button>
        ))}
      </nav>
    </aside>
  );
}

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffH = diffMs / (1000 * 60 * 60);

  if (diffH < 24) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (diffH < 24 * 7) {
    return d.toLocaleDateString([], { weekday: 'short' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
