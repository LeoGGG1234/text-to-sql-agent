import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authGetSession: vi.fn(),
  getAuth: vi.fn(),
  isDevMode: vi.fn(),
  ensureDevUser: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  getAuth: mocks.getAuth,
}));

vi.mock('@/lib/dev-helpers', () => ({
  isDevMode: mocks.isDevMode,
  ensureDevUser: mocks.ensureDevUser,
}));

import { getSession } from '../src/lib/auth-helpers';

describe('getSession guest isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isDevMode.mockReturnValue(false);
    mocks.getAuth.mockReturnValue({
      api: { getSession: mocks.authGetSession },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does not create or return a shared guest when no auth session exists', async () => {
    vi.stubEnv('ALLOW_GUEST', 'true');
    mocks.authGetSession.mockResolvedValue(null);
    const request = new Request('http://localhost/api/conversations');

    await expect(getSession(request)).resolves.toBeNull();

    expect(mocks.authGetSession).toHaveBeenCalledWith({
      headers: request.headers,
    });
    expect(mocks.ensureDevUser).not.toHaveBeenCalled();
  });

  it('returns the distinct Better Auth session presented by the caller', async () => {
    const anonymousSession = {
      user: { id: 'anonymous-user-a', isAnonymous: true },
      session: { id: 'anonymous-session-a' },
    };
    mocks.authGetSession.mockResolvedValue(anonymousSession);

    await expect(
      getSession(new Request('http://localhost/api/conversations')),
    ).resolves.toBe(anonymousSession);
  });

  it('preserves the local development bypass', async () => {
    const devSession = { user: { id: 'dev-user' } };
    mocks.isDevMode.mockReturnValue(true);
    mocks.ensureDevUser.mockResolvedValue(devSession);

    await expect(
      getSession(new Request('http://localhost/api/conversations')),
    ).resolves.toBe(devSession);

    expect(mocks.getAuth).not.toHaveBeenCalled();
  });
});
