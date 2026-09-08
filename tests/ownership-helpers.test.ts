import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
  eq: vi.fn((column: unknown, value: unknown) => ({ column, value })),
  and: vi.fn((...conditions: unknown[]) => ({ conditions })),
}));

vi.mock('drizzle-orm', () => ({
  eq: mocks.eq,
  and: mocks.and,
}));

vi.mock('@/db', () => ({
  getDb: vi.fn(() => ({ select: mocks.select })),
}));

vi.mock('@/db/schema', () => ({
  chatConversations: {
    id: 'conversation.id',
    userId: 'conversation.userId',
  },
  dataSources: {
    id: 'dataSource.id',
    userId: 'dataSource.userId',
    name: 'dataSource.name',
    type: 'dataSource.type',
    config: 'dataSource.config',
    schemaJson: 'dataSource.schemaJson',
  },
}));

import { getOwnedConversation } from '../src/lib/conversation-manager';
import { getOwnedDataSource } from '../src/lib/data-sources/schema-manager';

describe('ownership-aware resource helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.select.mockReturnValue({ from: mocks.from });
    mocks.from.mockReturnValue({ where: mocks.where });
    mocks.where.mockReturnValue({ limit: mocks.limit });
  });

  it('queries a conversation by both id and userId', async () => {
    const conversation = {
      id: 'conversation-a',
      userId: 'user-a',
      dataSourceId: null,
    };
    mocks.limit.mockResolvedValue([conversation]);

    await expect(
      getOwnedConversation(conversation.id, conversation.userId),
    ).resolves.toEqual(conversation);

    expect(mocks.eq).toHaveBeenNthCalledWith(
      1,
      'conversation.id',
      conversation.id,
    );
    expect(mocks.eq).toHaveBeenNthCalledWith(
      2,
      'conversation.userId',
      conversation.userId,
    );
    expect(mocks.and).toHaveBeenCalledWith(
      { column: 'conversation.id', value: conversation.id },
      { column: 'conversation.userId', value: conversation.userId },
    );
  });

  it('queries a data source by both id and userId', async () => {
    const dataSource = {
      id: 'data-source-a',
      userId: 'user-a',
      name: 'Owned source',
      type: 'upload',
      config: {},
      schemaJson: null,
    };
    mocks.limit.mockResolvedValue([dataSource]);

    await expect(
      getOwnedDataSource(dataSource.id, dataSource.userId),
    ).resolves.toEqual(dataSource);

    expect(mocks.eq).toHaveBeenNthCalledWith(
      1,
      'dataSource.id',
      dataSource.id,
    );
    expect(mocks.eq).toHaveBeenNthCalledWith(
      2,
      'dataSource.userId',
      dataSource.userId,
    );
    expect(mocks.and).toHaveBeenCalledWith(
      { column: 'dataSource.id', value: dataSource.id },
      { column: 'dataSource.userId', value: dataSource.userId },
    );
  });
});
