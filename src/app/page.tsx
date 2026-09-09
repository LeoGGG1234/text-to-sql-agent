'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useSession, signOut } from '@/lib/auth-client';
import { Sidebar } from '@/components/chat/sidebar';
import { ChatArea } from '@/components/chat/chat-area';
import { DataSourceManager } from '@/components/data-sources/data-source-manager';
import { DataTablePanel } from '@/components/data-sources/data-table-panel';
import { DataSourceIndicator } from '@/components/chat/data-source-indicator';

export interface ConversationSummary {
  id: string;
  title: string | null;
  updatedAt: string;
  createdAt: string;
  messageCount: number;
}

const DEV_USER = {
  id: 'dev-00000000-0000-4000-a000-000000000001' as string,
  email: 'dev@localhost',
  name: 'Developer',
  emailVerified: true,
  image: null as string | null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

export default function Home() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [loggingOut, setLoggingOut] = useState(false);

  // Local dev bypass state
  const [bypassSession, setBypassSession] = useState<{
    user: typeof DEV_USER;
  } | null>(null);
  const [bypassCheckDone, setBypassCheckDone] = useState(false);

  // Conversation state
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newChatKey, setNewChatKey] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Data source state
  const [dsPanelOpen, setDsPanelOpen] = useState(false);
  // undefined means the selected conversation's persisted binding is loading.
  // Omitting it from the chat body prevents a temporary null from overwriting
  // the server-side binding.
  const [activeDataSourceId, setActiveDataSourceId] = useState<string | null | undefined>(null);
  const [activeDataSourceName, setActiveDataSourceName] = useState<string | null>(null);
  const [conversationContextLoading, setConversationContextLoading] = useState(false);
  const conversationContextRequestRef = useRef<AbortController | null>(null);

  // Data table panel state
  const [dtPanelOpen, setDtPanelOpen] = useState(false);
  const [dtDataSourceId, setDtDataSourceId] = useState<string>('');

  // ─── Auth guard (local dev mode or real auth) ──────────
  useEffect(() => {
    if (!isPending && !session) {
      fetch('/api/dev-check')
        .then((r) => r.json())
        .then((data) => {
          if (data.devMode) {
            setBypassSession({ user: DEV_USER });
          } else {
            router.replace('/login');
          }
        })
        .catch(() => router.replace('/login'))
        .finally(() => setBypassCheckDone(true));
    }
  }, [session, isPending, router]);

  // Effective session (real auth, anonymous auth, or local dev)
  const effectiveSession = session ?? bypassSession;
  const isGuest = Boolean(
    session && (session.user as typeof session.user & { isAnonymous?: boolean }).isAnonymous,
  );

  // ─── Load conversation list ─────────────────────────────
  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch('/api/conversations');
      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations ?? []);
      }
    } catch (err) {
      console.error('Failed to load conversations:', err);
    }
  }, []);

  useEffect(() => {
    if (effectiveSession) {
      loadConversations();
    }
  }, [effectiveSession, loadConversations]);

  // ─── Load active conversation's data source on switch ─────
  useEffect(() => {
    conversationContextRequestRef.current?.abort();

    if (!activeId) {
      setConversationContextLoading(false);
      return;
    }

    const controller = new AbortController();
    conversationContextRequestRef.current = controller;
    setConversationContextLoading(true);
    setActiveDataSourceId(undefined);
    setActiveDataSourceName(null);

    fetch(`/api/conversations/${activeId}`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load conversation context');
        return r.json();
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        setActiveDataSourceId(data.dataSourceId ?? null);
        setActiveDataSourceName(data.dataSourceName ?? null);
      })
      .catch((error) => {
        if (error instanceof Error && error.name === 'AbortError') return;
        console.error('Failed to load conversation context:', error);
      })
      .finally(() => {
        if (conversationContextRequestRef.current === controller) {
          conversationContextRequestRef.current = null;
          setConversationContextLoading(false);
        }
      });

    return () => controller.abort();
  }, [activeId]);

  // ─── Handlers ───────────────────────────────────────────

  const handleNew = () => {
    conversationContextRequestRef.current?.abort();
    conversationContextRequestRef.current = null;
    setActiveId(null);
    setNewChatKey((key) => key + 1);
    setSidebarOpen(false);
    setActiveDataSourceId(null);
    setActiveDataSourceName(null);
    setConversationContextLoading(false);
  };

  const handleSelect = (id: string) => {
    if (id === activeId) {
      setSidebarOpen(false);
      return;
    }
    conversationContextRequestRef.current?.abort();
    setActiveDataSourceId(undefined);
    setActiveDataSourceName(null);
    setConversationContextLoading(true);
    setActiveId(id);
    setSidebarOpen(false);
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
      if (res.ok) {
        if (activeId === id) handleNew();
        setConversations((prev) => prev.filter((c) => c.id !== id));
      }
    } catch (err) {
      console.error('Failed to delete conversation:', err);
    }
  };

  const handleConversationCreated = (id: string) => {
    setActiveDataSourceId(undefined);
    setActiveDataSourceName(null);
    setConversationContextLoading(true);
    setActiveId(id);
    loadConversations();
  };

  const handleDataSourceSelect = async (dsId: string, name: string) => {
    // dsId === '' means "use retail demo" (no data source)
    const newId = dsId || null;
    conversationContextRequestRef.current?.abort();
    setConversationContextLoading(false);

    // Persist to conversation if one is active
    if (activeId) {
      const res = await fetch(`/api/conversations/${activeId}/data-source`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataSourceId: newId }),
      });
      if (!res.ok) {
        console.error('Failed to update conversation data source');
        return;
      }
    }

    setActiveDataSourceId(newId);
    setActiveDataSourceName(newId ? name : null);
  };

  const handleAnalyzeDataSource = (dsId: string, name: string) => {
    // Start from a clean conversation so messages and tool results from a
    // previously selected data source cannot influence this analysis.
    conversationContextRequestRef.current?.abort();
    conversationContextRequestRef.current = null;
    setActiveId(null);
    setNewChatKey((key) => key + 1);
    setActiveDataSourceId(dsId);
    setActiveDataSourceName(name);
    setConversationContextLoading(false);
    setSidebarOpen(false);
    setDsPanelOpen(false);
    setDtPanelOpen(false);
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    await signOut();
    if (bypassSession) {
      setBypassSession(null);
      setBypassCheckDone(false);
    } else {
      router.replace('/login');
    }
  };

  // ─── Loading state ──────────────────────────────────────
  if (isPending || (!session && !bypassCheckDone)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950">
        <div className="flex gap-1">
          <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" />
          <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    );
  }

  if (!effectiveSession) return null;

  // ─── Render ─────────────────────────────────────────────
  return (
    <div className="flex h-screen bg-zinc-950">
      {/* Data Source Manager (slide-over panel) */}
      <DataSourceManager
        open={dsPanelOpen}
        onClose={() => setDsPanelOpen(false)}
        onSelect={handleDataSourceSelect}
        selectedId={activeDataSourceId ?? null}
        onViewData={(dsId) => {
          setDtDataSourceId(dsId);
          setDtPanelOpen(true);
        }}
      />

      {/* Data Table Panel (wide slide-over) */}
      <DataTablePanel
        open={dtPanelOpen}
        onClose={() => setDtPanelOpen(false)}
        dataSourceId={dtDataSourceId}
        onAnalyze={handleAnalyzeDataSource}
      />

      {/* Desktop sidebar */}
      <div className="hidden md:block">
        <Sidebar
          conversations={conversations}
          activeId={activeId}
          onSelect={handleSelect}
          onNew={handleNew}
          onDelete={handleDelete}
          onDataSourcesClick={() => setDsPanelOpen(true)}
        />
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="absolute left-0 top-0 bottom-0">
            <Sidebar
              conversations={conversations}
              activeId={activeId}
              onSelect={handleSelect}
              onNew={handleNew}
              onDelete={handleDelete}
              onDataSourcesClick={() => setDsPanelOpen(true)}
            />
          </div>
        </div>
      )}

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="md:hidden text-zinc-400 hover:text-white transition"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 12h18M3 6h18M3 18h18" />
              </svg>
            </button>
            <h1 className="text-lg font-bold text-white">📊 数据问答 Agent</h1>
            <DataSourceIndicator
              name={activeDataSourceName}
              onClick={() => setDsPanelOpen(true)}
            />
          </div>
          <div className="flex items-center gap-3">
            {isGuest && (
              <button
                onClick={() => router.push('/login?upgrade=1')}
                className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500"
              >
                Save demo data
              </button>
            )}
            <span className="text-xs text-zinc-500 hidden sm:inline">
              {isGuest ? 'Temporary guest' : effectiveSession.user.email}
            </span>
            <button
              onClick={handleLogout}
              disabled={loggingOut}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition disabled:opacity-50"
            >
              {loggingOut ? '...' : '退出'}
            </button>
          </div>
        </header>

        {/* Chat area */}
        <div className="flex-1 overflow-hidden">
          <ChatArea
            key={activeId ?? `new-${newChatKey}`}
            conversationId={activeId}
            dataSourceId={activeDataSourceId}
            dataSourceName={activeDataSourceName}
            conversationContextLoading={conversationContextLoading}
            onConversationCreated={handleConversationCreated}
          />
        </div>
      </div>
    </div>
  );
}
