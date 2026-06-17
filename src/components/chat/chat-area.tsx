'use client';

import { useChat } from 'ai/react';
import { useRef, useEffect, useState, type FormEvent } from 'react';
import { ToolResultCard } from '@/components/chat/tool-result-card';
import type { Message } from 'ai';

const EXAMPLE_QUESTIONS = [
  { zh: '营收最高的 5 个产品是哪些？', en: 'What are the top 5 products by revenue?' },
  { zh: '2025 年每月的销售趋势如何？', en: 'Show the monthly sales trend for 2025.' },
  { zh: '各个地区的销售额占比是多少？', en: 'What is the sales breakdown by region?' },
  { zh: '哪个产品类别的退货率最高？', en: 'Which product category has the highest return rate?' },
];

interface ProviderOption {
  id: string;
  label: string;
  defaultModel: string;
}

const DEFAULT_PROVIDER = 'deepseek';

interface ChatAreaProps {
  /** Conversation ID — null for new (not yet created) conversation */
  conversationId: string | null;
  /** Callback when the first message is sent (conversation needs creation) */
  onConversationCreated?: (id: string) => void;
}

export function ChatArea({ conversationId }: ChatAreaProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [initialMessages, setInitialMessages] = useState<Message[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // ─── Provider switching ────────────────────────────────────
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [provider, setProvider] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('tts-provider') ?? DEFAULT_PROVIDER;
    }
    return DEFAULT_PROVIDER;
  });

  // Fetch available providers on mount
  useEffect(() => {
    fetch('/api/providers')
      .then((r) => r.json())
      .then((data) => {
        if (data.providers?.length > 0) {
          setProviders(data.providers);
        }
      })
      .catch(() => {}); // silent — selector just won't show
  }, []);

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value;
    setProvider(next);
    localStorage.setItem('tts-provider', next);
  };

  // Load messages when conversationId changes
  useEffect(() => {
    if (!conversationId) {
      setInitialMessages([]);
      return;
    }

    let cancelled = false;
    setLoadingHistory(true);

    fetch(`/api/conversations/${conversationId}`)
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load');
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        // Reconstruct messages from stored parts
        const msgs: Message[] = (data.messages ?? []).map(
          (m: { id: string; role: string; parts: any[] }) => {
            const part = m.parts?.[0] ?? {};
            return {
              id: m.id,
              role: m.role as Message['role'],
              content: part.content ?? '',
              toolInvocations: part.toolInvocations,
            };
          },
        );
        setInitialMessages(msgs);
        setLoadingHistory(false);
      })
      .catch(() => {
        if (!cancelled) setLoadingHistory(false);
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  const { messages, input, handleInputChange, handleSubmit, isLoading, error } =
    useChat({
      api: '/api/chat',
      initialMessages,
      id: conversationId ?? undefined,
      body: {
        conversationId,
        provider,
      },
    });

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    handleSubmit(e);
  };

  const fillExample = (text: string) => {
    handleInputChange({ target: { value: text } } as any);
  };

  return (
    <div className="flex flex-col h-screen max-w-2xl mx-auto px-4 py-6">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-1">
        {loadingHistory && (
          <div className="text-center mt-16">
            <div className="flex gap-1 justify-center">
              <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" />
              <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}

        {!loadingHistory && messages.length === 0 && !isLoading && (
          <div className="text-center mt-16">
            <p className="text-3xl mb-3">📊</p>
            <p className="text-zinc-400 text-sm mb-6">
              用自然语言查询零售销售数据库。
              <br />
              我会自动生成 SQL、安全执行、并把结果画成图表。
            </p>
            <div className="space-y-2 max-w-sm mx-auto">
              {EXAMPLE_QUESTIONS.map((q, i) => (
                <button
                  key={i}
                  onClick={() => fillExample(q.zh)}
                  className="w-full text-left px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-400 hover:border-zinc-700 hover:text-zinc-300 transition"
                >
                  {q.zh}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            className={`p-3 rounded-lg ${
              m.role === 'user'
                ? 'bg-zinc-800 ml-8'
                : 'bg-zinc-900 mr-8 border border-zinc-800'
            }`}
          >
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-xs text-zinc-500">
                {m.role === 'user' ? 'You' : 'Agent'}
              </span>
              {m.toolInvocations?.map((t) => (
                <span
                  key={t.toolCallId}
                  className={`px-1.5 py-0.5 rounded text-xs ${
                    t.state === 'result'
                      ? 'bg-emerald-900/40 text-emerald-400'
                      : 'bg-indigo-900/40 text-indigo-400 animate-pulse'
                  }`}
                >
                  {t.state === 'result' ? '✓' : '⚙'} {t.toolName}
                </span>
              ))}
            </div>

            {/* Tool result cards */}
            {m.toolInvocations?.map((t) => {
              if (t.state === 'result') {
                return (
                  <ToolResultCard
                    key={t.toolCallId}
                    toolName={t.toolName}
                    result={(t as { result: unknown }).result}
                  />
                );
              }
              return null;
            })}

            {/* Message text */}
            {m.content && (
              <div className="text-sm whitespace-pre-wrap text-zinc-200">
                {m.content}
              </div>
            )}
          </div>
        ))}

        {/* Loading indicator */}
        {isLoading && (
          <div className="p-3 rounded-lg bg-zinc-900 border border-zinc-800 mr-8">
            <div className="flex items-center gap-2">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
              <span className="text-xs text-zinc-500">查询中...</span>
            </div>
          </div>
        )}

        {/* Error display */}
        {error && (
          <div className="p-3 rounded-lg bg-red-900/20 border border-red-800/30 mr-8">
            <div className="text-xs text-red-400">
              出错了：{error.message ?? 'Something went wrong'}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={onSubmit} className="shrink-0 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={handleInputChange}
          placeholder="问一个关于销售数据的问题..."
          className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition"
          disabled={isLoading}
        />
        {providers.length > 1 && (
          <select
            value={provider}
            onChange={handleProviderChange}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-2.5 text-xs text-zinc-300 focus:outline-none focus:border-indigo-500 transition cursor-pointer"
            title="切换 AI 供应商"
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        )}
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition"
        >
          发送
        </button>
      </form>

      {/* Footer status */}
      <div className="mt-3 text-center text-xs text-zinc-600 shrink-0">
        {isLoading
          ? 'streaming...'
          : `${messages.length} messages · ready`}
      </div>
    </div>
  );
}
