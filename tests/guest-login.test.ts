import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handler: vi.fn(),
  getAuth: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  getAuth: mocks.getAuth,
}));

import { POST } from '../src/app/api/guest-login/route';

describe('POST /api/guest-login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuth.mockReturnValue({ handler: mocks.handler });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 403 without invoking Better Auth when guest mode is disabled', async () => {
    vi.stubEnv('ALLOW_GUEST', 'false');

    const response = await POST(
      new Request('https://demo.example/api/guest-login', { method: 'POST' }),
    );

    expect(response.status).toBe(403);
    expect(mocks.getAuth).not.toHaveBeenCalled();
    expect(mocks.handler).not.toHaveBeenCalled();
  });

  it('forwards to anonymous sign-in and preserves the session cookie', async () => {
    vi.stubEnv('ALLOW_GUEST', 'true');
    const authResponse = new Response(JSON.stringify({ user: { id: 'anon-a' } }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'set-cookie': 'better-auth.session_token=unique-token; Path=/; HttpOnly',
      },
    });
    mocks.handler.mockResolvedValue(authResponse);
    const request = new Request('https://demo.example/api/guest-login', {
      method: 'POST',
      headers: { 'user-agent': 'test-browser' },
    });

    const response = await POST(request);

    expect(response).toBe(authResponse);
    expect(response.headers.get('set-cookie')).toContain('unique-token');
    const forwarded = mocks.handler.mock.calls[0]?.[0] as Request;
    expect(forwarded.method).toBe('POST');
    expect(new URL(forwarded.url).pathname).toBe('/api/auth/sign-in/anonymous');
    expect(forwarded.headers.get('user-agent')).toBe('test-browser');
  });
});
