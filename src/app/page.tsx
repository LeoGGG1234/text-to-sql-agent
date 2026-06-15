'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useSession, signOut } from '@/lib/auth-client';
import { Sidebar } from '@/components/chat/sidebar';
import { ChatArea } from '@/components/chat/chat-area';

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

const GUEST_USER = {
  id: 'guest-00000000-0000-4000-a000-000000000001' as string,
  email: 'guest@text-to-sql.demo',
  name: 'Guest',
  emailVerified: true,
  image: null as string | null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

export default function Home() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [loggingOut, setLoggingOut] = useState(false);

  // Dev / Guest bypass state
  const [bypassSession, setBypassSession] = useState<{
    user: typeof DEV_USER;
  } | null>(null);
  const [bypassCheckDone, setBypassCheckDone] = useState(false);

  // Conversation state
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // ─── Auth guard (dev mode > guest mode > login) ────────
  useEffect(() => {
    if (!isPending && !session) {
      fetch('/api/dev-check')
        .then((r) => r.json())
        .then((data) => {
          if (data.devMode) {
            setBypassSession({ user: DEV_USER });
          } else if (data.guestMode) {
            setBypassSession({ user: GUEST_USER });
          } else {
            router.replace('/login');
          }
        })
        .catch(() => router.replace('/login'))
        .finally(() => setBypassCheckDone(true));
    }
  }, [session, isPending, router]);

  // Effective session (real, dev, or guest)
  const effectiveSession = session ?? bypassSession;

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

  // ─── Handlers ───────────────────────────────────────────

  const handleNew = () => {
    setActiveId(null);
    setSidebarOpen(false); // close mobile sidebar
  };

  const handleSelect = (id: string) => {
    setActiveId(id);
    setSidebarOpen(false);
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
      if (res.ok) {
        if (activeId === id) setActiveId(null);
        setConversations((prev) => prev.filter((c) => c.id !== id));
      }
    } catch (err) {
      console.error('Failed to delete conversation:', err);
    }
  };

  const handleConversationCreated = (id: string) => {
    setActiveId(id);
    loadConversations();
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    await signOut();
    if (bypassSession) {
      // In dev/guest mode just reload — the bypass session kicks back in
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

  if (!effectiveSession) return null; // Will redirect

  // ─── Render ─────────────────────────────────────────────
  return (
    <div className="flex h-screen bg-zinc-950">
      {/* Desktop sidebar */}
      <div className="hidden md:block">
        <Sidebar
          conversations={conversations}
          activeId={activeId}
          onSelect={handleSelect}
          onNew={handleNew}
          onDelete={handleDelete}
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
            />
          </div>
        </div>
      )}

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            {/* Mobile hamburger */}
            <button
              onClick={() => setSidebarOpen(true)}
              className="md:hidden text-zinc-400 hover:text-white transition"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 12h18M3 6h18M3 18h18" />
              </svg>
            </button>
            <h1 className="text-lg font-bold text-white">📊 数据问答 Agent</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-500 hidden sm:inline">
              {effectiveSession.user.email}
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
            key={activeId ?? 'new'}
            conversationId={activeId}
            onConversationCreated={handleConversationCreated}
          />
        </div>
      </div>
    </div>
  );
}
