import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getOwnedConversation: vi.fn(),
  getOwnedDataSource: vi.fn(),
  getModel: vi.fn(),
  streamText: vi.fn(),
  buildTools: vi.fn(),
  dbInsert: vi.fn(),
  dbInsertValues: vi.fn(),
  dbUpdate: vi.fn(),
  dbUpdateSet: vi.fn(),
  dbUpdateWhere: vi.fn(),
  eq: vi.fn((column: unknown, value: unknown) => ({ column, value })),
  and: vi.fn((...conditions: unknown[]) => ({ conditions })),
}));

vi.mock('ai', () => ({
  streamText: mocks.streamText,
}));

vi.mock('@/lib/auth-helpers', () => ({
  getSession: mocks.getSession,
}));

vi.mock('@/lib/conversation-manager', () => ({
  getOwnedConversation: mocks.getOwnedConversation,
}));

vi.mock('@/lib/data-sources/schema-manager', () => ({
  getOwnedDataSource: mocks.getOwnedDataSource,
}));

vi.mock('@/lib/providers', () => ({
  DEFAULT_PROVIDER: 'deepseek',
  getModel: mocks.getModel,
  isValidProvider: vi.fn(() => true),
}));

vi.mock('@/lib/prompts', () => ({
  getSystemPrompt: vi.fn(() => 'system prompt'),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({
    allowed: true,
    remaining: 29,
    resetAt: Date.now() + 60_000,
  })),
  rateLimitHeaders: vi.fn(() => ({})),
}));

vi.mock('@/tools', () => ({
  buildTools: mocks.buildTools,
}));

vi.mock('@/lib/schema-description', () => ({
  SCHEMA_TABLES: [],
  RELATIONSHIPS: [],
  buildSchemaPromptText: vi.fn(() => 'schema'),
}));

vi.mock('@/lib/data-sources/quality-analyzer', () => ({
  buildQualityNote: vi.fn(() => ''),
  buildTableQualityNote: vi.fn(() => ''),
}));

vi.mock('drizzle-orm', () => ({
  eq: mocks.eq,
  and: mocks.and,
}));

vi.mock('@/db', () => ({
  db: {
    insert: mocks.dbInsert,
    update: mocks.dbUpdate,
  },
  schema: {
    chatConversations: {
      id: 'conversation.id',
      userId: 'conversation.userId',
      title: 'conversation.title',
    },
    chatMessages: 'chatMessages',
    usageRecords: 'usageRecords',
  },
}));

import { POST } from '../src/app/api/chat/route';

const USER_A = 'user-a';
const CONVERSATION_A = 'conversation-a';
const CONVERSATION_B = 'conversation-b';
const DATA_SOURCE_A = 'data-source-a';
const DATA_SOURCE_B = 'data-source-b';

function chatRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'show me the data' }],
      ...body,
    }),
  });
}

function expectNoModelOrPersistence() {
  expect(mocks.getModel).not.toHaveBeenCalled();
  expect(mocks.streamText).not.toHaveBeenCalled();
  expect(mocks.dbInsert).not.toHaveBeenCalled();
  expect(mocks.dbUpdate).not.toHaveBeenCalled();
}

describe('POST /api/chat ownership boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: USER_A } });
    mocks.getOwnedConversation.mockResolvedValue(null);
    mocks.getOwnedDataSource.mockResolvedValue(null);
    mocks.getModel.mockReturnValue({ modelId: 'test-model' });
    mocks.buildTools.mockReturnValue({});
    mocks.dbInsert.mockImplementation(() => ({
      values: mocks.dbInsertValues,
    }));
    mocks.dbInsertValues.mockResolvedValue(undefined);
    mocks.dbUpdate.mockImplementation(() => ({
      set: mocks.dbUpdateSet,
    }));
    mocks.dbUpdateSet.mockImplementation(() => ({
      where: mocks.dbUpdateWhere,
    }));
    mocks.dbUpdateWhere.mockResolvedValue(undefined);
    mocks.streamText.mockReturnValue({
      toDataStreamResponse: () => new Response('stream'),
    });
  });

  it('returns the same 404 for a missing or cross-owner conversation', async () => {
    mocks.getOwnedConversation.mockResolvedValue(null);

    const response = await POST(chatRequest({ conversationId: CONVERSATION_B }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: 'Conversation not found',
    });
    expect(mocks.getOwnedConversation).toHaveBeenCalledWith(
      CONVERSATION_B,
      USER_A,
    );
    expect(mocks.getOwnedDataSource).not.toHaveBeenCalled();
    expectNoModelOrPersistence();
  });

  it('does not create a conversation bound to another user data source', async () => {
    const response = await POST(
      chatRequest({
        dataSourceId: DATA_SOURCE_B,
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: 'Data source not found',
    });
    expect(mocks.getOwnedDataSource).toHaveBeenCalledWith(
      DATA_SOURCE_B,
      USER_A,
    );
    expect(mocks.getOwnedConversation).not.toHaveBeenCalled();
    expectNoModelOrPersistence();
  });

  it('rejects a historical cross-owner data source binding', async () => {
    mocks.getOwnedConversation.mockResolvedValue({
      id: CONVERSATION_A,
      userId: USER_A,
      dataSourceId: DATA_SOURCE_B,
    });
    mocks.getOwnedDataSource.mockResolvedValue(null);

    const response = await POST(
      chatRequest({ conversationId: CONVERSATION_A }),
    );

    expect(response.status).toBe(404);
    expect(mocks.getOwnedDataSource).toHaveBeenCalledWith(
      DATA_SOURCE_B,
      USER_A,
    );
    expectNoModelOrPersistence();
  });

  it('continues an owned conversation with an owned data source', async () => {
    mocks.getOwnedConversation.mockResolvedValue({
      id: CONVERSATION_A,
      userId: USER_A,
      dataSourceId: null,
    });
    mocks.getOwnedDataSource.mockResolvedValue({
      id: DATA_SOURCE_A,
      userId: USER_A,
      type: 'upload',
      config: {},
      schemaJson: {
        tables: [
          {
            name: 'ds_owned',
            displayName: 'Owned data',
            rowCount: 1,
            columns: [],
          },
        ],
        relationships: [],
      },
    });

    const response = await POST(
      chatRequest({
        conversationId: CONVERSATION_A,
        dataSourceId: DATA_SOURCE_A,
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.getOwnedConversation).toHaveBeenCalledWith(
      CONVERSATION_A,
      USER_A,
    );
    expect(mocks.getOwnedDataSource).toHaveBeenCalledWith(
      DATA_SOURCE_A,
      USER_A,
    );
    expect(mocks.dbUpdateSet).toHaveBeenCalledWith({
      updatedAt: expect.any(Date),
      dataSourceId: DATA_SOURCE_A,
    });
    expect(mocks.eq).toHaveBeenCalledWith('conversation.id', CONVERSATION_A);
    expect(mocks.eq).toHaveBeenCalledWith('conversation.userId', USER_A);
    expect(mocks.dbInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: CONVERSATION_A,
        role: 'user',
      }),
    );
    expect(mocks.getModel).toHaveBeenCalledOnce();
    expect(mocks.streamText).toHaveBeenCalledOnce();
  });
});
