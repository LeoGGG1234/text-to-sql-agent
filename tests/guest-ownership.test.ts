import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  batch: vi.fn(),
  update: vi.fn(),
  getDb: vi.fn(),
  eq: vi.fn((column: unknown, value: unknown) => ({ column, value })),
}));

vi.mock('drizzle-orm', () => ({
  eq: mocks.eq,
}));

vi.mock('@/db', () => ({
  getDb: mocks.getDb,
  schema: {
    chatConversations: { userId: 'chatConversations.userId' },
    dataSources: { userId: 'dataSources.userId' },
    usageRecords: { userId: 'usageRecords.userId' },
  },
}));

import { transferAnonymousUserResources } from '../src/lib/guest-ownership';

describe('anonymous user ownership transfer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockReturnValue({
      batch: mocks.batch,
      update: mocks.update,
    });
    mocks.update.mockImplementation((table) => ({
      set: (values: unknown) => ({
        where: (condition: unknown) => ({ table, values, condition }),
      }),
    }));
    mocks.batch.mockResolvedValue([]);
  });

  it('atomically moves conversations, data sources, and usage to the linked user', async () => {
    await transferAnonymousUserResources('anonymous-user', 'permanent-user');

    expect(mocks.batch).toHaveBeenCalledOnce();
    expect(mocks.batch).toHaveBeenCalledWith([
      {
        table: { userId: 'chatConversations.userId' },
        values: { userId: 'permanent-user' },
        condition: {
          column: 'chatConversations.userId',
          value: 'anonymous-user',
        },
      },
      {
        table: { userId: 'dataSources.userId' },
        values: { userId: 'permanent-user' },
        condition: {
          column: 'dataSources.userId',
          value: 'anonymous-user',
        },
      },
      {
        table: { userId: 'usageRecords.userId' },
        values: { userId: 'permanent-user' },
        condition: {
          column: 'usageRecords.userId',
          value: 'anonymous-user',
        },
      },
    ]);
  });

  it('does nothing when Better Auth links to the same user record', async () => {
    await transferAnonymousUserResources('same-user', 'same-user');

    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.batch).not.toHaveBeenCalled();
  });
});
