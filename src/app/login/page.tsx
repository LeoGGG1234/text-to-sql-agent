'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { signIn, signUp, useSession } from '@/lib/auth-client';
import { useEffect } from 'react';

export default function LoginPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [guestMode, setGuestMode] = useState(false);
  const [enteringGuest, setEnteringGuest] = useState(false);

  // Redirect if already logged in, or if in dev/guest bypass mode
  useEffect(() => {
    if (session && !isPending) {
      router.replace('/');
      return;
    }
    fetch('/api/dev-check')
      .then((r) => r.json())
      .then((data) => {
        if (data.devMode) router.replace('/');
        if (data.guestMode) setGuestMode(true);
      })
      .catch(() => {});
  }, [session, isPending, router]);

  const enterGuestMode = async () => {
    setEnteringGuest(true);
    setError('');
    try {
      const res = await fetch('/api/guest-login', { method: 'POST' });
      if (res.ok) {
        router.replace('/');
      } else {
        setError('Demo unavailable. Please sign in or create an account.');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setEnteringGuest(false);
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isRegister) {
        const res = await signUp.email({
          email,
          password,
          name: name || email.split('@')[0],
        });
        if (res.error) {
          setError(res.error.message ?? 'Registration failed');
        } else {
          router.replace('/');
        }
      } else {
        const res = await signIn.email({
          email,
          password,
        });
        if (res.error) {
          setError(res.error.message ?? 'Login failed');
        } else {
          router.replace('/');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  if (isPending) {
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

  if (session) return null; // will redirect

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-3xl mb-2">📊</h1>
          <h2 className="text-xl font-bold text-white">数据问答 Agent</h2>
          <p className="text-sm text-zinc-500 mt-1">
            {isRegister ? '创建账号' : '用自然语言查询数据库'}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={onSubmit} className="space-y-4">
          {isRegister && (
            <div>
              <label htmlFor="name" className="block text-xs text-zinc-400 mb-1">
                Name
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name (optional)"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition"
              />
            </div>
          )}

          <div>
            <label htmlFor="email" className="block text-xs text-zinc-400 mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-xs text-zinc-400 mb-1">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isRegister ? '8+ characters' : 'Your password'}
              required
              minLength={8}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition"
            />
          </div>

          {error && (
            <div className="p-2.5 rounded-lg bg-red-900/20 border border-red-800/30 text-xs text-red-400">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !email.trim() || !password}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white py-2.5 rounded-lg text-sm font-medium transition"
          >
            {loading
              ? 'Please wait...'
              : isRegister
                ? 'Create Account'
                : 'Sign In'}
          </button>
        </form>

        {/* Guest mode — "Try Demo" button */}
        {guestMode && (
          <>
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-zinc-800" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-zinc-950 px-3 text-xs text-zinc-600">or</span>
              </div>
            </div>
            <button
              onClick={enterGuestMode}
              disabled={enteringGuest}
              className="w-full bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-300 py-2.5 rounded-lg text-sm font-medium transition border border-zinc-700"
            >
              {enteringGuest ? '进入中...' : '🎮 体验 Demo'}
            </button>
            <p className="mt-2 text-center text-xs text-zinc-600">
              无需注册 — 直接体验 AI 数据分析
            </p>
          </>
        )}

        {/* Toggle */}
        <p className="mt-6 text-center text-xs text-zinc-500">
          {isRegister ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button
            onClick={() => {
              setIsRegister(!isRegister);
              setError('');
            }}
            className="text-indigo-400 hover:text-indigo-300 transition"
          >
            {isRegister ? 'Sign in' : 'Create one'}
          </button>
        </p>
      </div>
    </div>
  );
}
