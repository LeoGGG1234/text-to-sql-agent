import { describe, expect, it, vi } from 'vitest';
import { withDatabaseTransaction } from '../src/lib/database-transaction';

function mockClient() {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue({ rows: [] }),
    end: vi.fn().mockResolvedValue(undefined),
  };
}

describe('withDatabaseTransaction', () => {
  it('uses one connected client and commits successful work', async () => {
    const client = mockClient();

    await expect(
      withDatabaseTransaction(
        'postgresql://example.test/db',
        async (transaction) => {
          await transaction.query('INSERT INTO example VALUES ($1)', ['ok']);
          return 42;
        },
        () => client,
      ),
    ).resolves.toBe(42);

    expect(client.connect).toHaveBeenCalledOnce();
    expect(client.query.mock.calls).toEqual([
      ['BEGIN'],
      ['INSERT INTO example VALUES ($1)', ['ok']],
      ['COMMIT'],
    ]);
    expect(client.end).toHaveBeenCalledOnce();
  });

  it('rolls back failed work and still closes the client', async () => {
    const client = mockClient();
    const failure = new Error('insert failed');

    await expect(
      withDatabaseTransaction(
        'postgresql://example.test/db',
        async (transaction) => {
          await transaction.query('INSERT INTO example VALUES ($1)', ['bad']);
          throw failure;
        },
        () => client,
      ),
    ).rejects.toBe(failure);

    expect(client.query.mock.calls).toEqual([
      ['BEGIN'],
      ['INSERT INTO example VALUES ($1)', ['bad']],
      ['ROLLBACK'],
    ]);
    expect(client.end).toHaveBeenCalledOnce();
  });
});
