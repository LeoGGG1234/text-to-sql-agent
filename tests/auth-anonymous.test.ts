import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  betterAuth: vi.fn(),
  drizzleAdapter: vi.fn(),
  anonymous: vi.fn(),
  getDb: vi.fn(),
  transferAnonymousUserResources: vi.fn(),
}));

vi.mock('better-auth', () => ({
  betterAuth: mocks.betterAuth,
}));

vi.mock('better-auth/adapters/drizzle', () => ({
  drizzleAdapter: mocks.drizzleAdapter,
}));

vi.mock('better-auth/plugins', () => ({
  anonymous: mocks.anonymous,
}));

vi.mock('@/db', () => ({
  getDb: mocks.getDb,
}));

vi.mock('@/lib/guest-ownership', () => ({
  transferAnonymousUserResources: mocks.transferAnonymousUserResources,
}));

interface AnonymousPluginOptions {
  onLinkAccount: (data: {
    anonymousUser: { user: { id: string } };
    newUser: { user: { id: string } };
  }) => Promise<void>;
}

describe('Better Auth anonymous plugin configuration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.getDb.mockReturnValue({});
    mocks.drizzleAdapter.mockReturnValue({ adapter: 'drizzle' });
    mocks.anonymous.mockImplementation((options) => ({
      id: 'anonymous',
      options,
    }));
    mocks.betterAuth.mockImplementation((options) => ({ options }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('enables isolated anonymous sessions and migrates resources on linking', async () => {
    vi.stubEnv('ALLOW_GUEST', 'true');
    const { getAuth } = await import('../src/lib/auth');

    getAuth();

    expect(mocks.anonymous).toHaveBeenCalledOnce();
    const options = mocks.anonymous.mock.calls[0]?.[0] as AnonymousPluginOptions;
    await options.onLinkAccount({
      anonymousUser: { user: { id: 'anonymous-user' } },
      newUser: { user: { id: 'permanent-user' } },
    });
    expect(mocks.transferAnonymousUserResources).toHaveBeenCalledWith(
      'anonymous-user',
      'permanent-user',
    );
  });

  it('does not expose the anonymous endpoint when guest mode is disabled', async () => {
    vi.stubEnv('ALLOW_GUEST', 'false');
    const { getAuth } = await import('../src/lib/auth');

    getAuth();

    expect(mocks.anonymous).not.toHaveBeenCalled();
    expect(mocks.betterAuth).toHaveBeenCalledWith(
      expect.objectContaining({ plugins: [] }),
    );
  });
});
