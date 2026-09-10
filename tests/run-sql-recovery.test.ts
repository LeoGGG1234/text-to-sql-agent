import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  validateAndExecute: vi.fn(),
}));

vi.mock('@/lib/sql-executor', () => ({
  validateAndExecute: mocks.validateAndExecute,
}));

import { makeRunSql } from '../src/tools/run-sql';
import { createQueryResultStore } from '../src/tools/query-result-store';

async function executeSql(
  runSql: ReturnType<typeof makeRunSql>,
  sql: string,
) {
  const execute = runSql.execute as (
    input: { sql: string },
  ) => Promise<unknown>;
  return execute({ sql });
}

describe('runSql recovery feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tells the model to retry immediately when an attempt remains', async () => {
    mocks.validateAndExecute.mockResolvedValue({
      success: false,
      code: 'SYNTAX_ERROR',
      error: 'reserved alias',
    });
    const runSql = makeRunSql();

    await expect(
      executeSql(runSql, 'SELECT COUNT(*) AS nulls FROM example'),
    ).resolves.toEqual({
      success: false,
      code: 'SYNTAX_ERROR',
      error: 'reserved alias',
      attempt: 1,
      attemptsRemaining: 2,
      nextAction:
        'Call runSql again now with corrected SQL; do not only describe a future retry.',
      sql: 'SELECT COUNT(*) AS nulls FROM example',
    });
  });

  it('tells the model to stop after the final executable attempt fails', async () => {
    mocks.validateAndExecute.mockResolvedValue({
      success: false,
      code: 'SYNTAX_ERROR',
      error: 'still invalid',
    });
    const runSql = makeRunSql();

    await executeSql(runSql, 'SELECT 1');
    await executeSql(runSql, 'SELECT 1');

    await expect(executeSql(runSql, 'SELECT 1')).resolves.toEqual(
      expect.objectContaining({
        success: false,
        attempt: 3,
        attemptsRemaining: 0,
        nextAction: 'Stop retrying and explain the failure to the user.',
      }),
    );
  });

  it('resets the retry budget after a successful analytical query', async () => {
    mocks.validateAndExecute
      .mockResolvedValueOnce({
        success: false,
        code: 'SYNTAX_ERROR',
        error: 'first query failed',
      })
      .mockResolvedValueOnce({
        success: true,
        rowCount: 1,
        columns: ['row_count'],
        truncated: false,
        durationMs: 1,
        rows: [{ row_count: 5 }],
      })
      .mockResolvedValueOnce({
        success: false,
        code: 'SYNTAX_ERROR',
        error: 'new query failed',
      });
    const runSql = makeRunSql();

    await executeSql(runSql, 'SELECT broken');
    await executeSql(runSql, 'SELECT COUNT(*) AS row_count FROM example');

    await expect(executeSql(runSql, 'SELECT another_broken')).resolves.toEqual(
      expect.objectContaining({
        success: false,
        attempt: 1,
        attemptsRemaining: 2,
      }),
    );
  });

  it('registers successful visible rows under the returned result id', async () => {
    mocks.validateAndExecute.mockResolvedValue({
      success: true,
      rowCount: 2,
      columns: ['region', 'revenue'],
      truncated: false,
      durationMs: 1,
      rows: [
        { region: 'East', revenue: '12.50' },
        { region: 'West', revenue: '9.25' },
      ],
    });
    const store = createQueryResultStore();
    const runSql = makeRunSql(undefined, store);

    const result = await executeSql(runSql, 'SELECT region, revenue FROM example');

    expect(result).toEqual(expect.objectContaining({ resultId: 'query_1' }));
    expect(store.get('query_1')).toEqual(
      expect.objectContaining({
        rowCount: 2,
        columns: ['region', 'revenue'],
        rows: [
          { region: 'East', revenue: '12.50' },
          { region: 'West', revenue: '9.25' },
        ],
      }),
    );
  });
});
