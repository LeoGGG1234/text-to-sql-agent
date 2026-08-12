import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  neon: vi.fn(),
  query: vi.fn(),
}));

vi.mock('@neondatabase/serverless', () => ({
  neon: mocks.neon,
}));

import { validateAndExecute } from '../src/lib/sql-executor';

describe('validateAndExecute — custom target access scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.neon.mockReturnValue({ query: mocks.query });
    mocks.query.mockResolvedValue([{ value: 42 }]);
  });

  it('fails closed before execution when a custom target has no access scope', async () => {
    const result = await validateAndExecute('SELECT * FROM ds_owned', {
      connectionString: 'postgresql://unused',
      searchPath: 'userdata',
    });

    expect(result).toEqual({
      success: false,
      error: 'Custom database targets require a matching table access scope.',
      code: 'VALIDATION_ERROR',
    });
  });

  it('fails closed when the access scope schema does not match search_path', async () => {
    const result = await validateAndExecute('SELECT * FROM ds_owned', {
      connectionString: 'postgresql://unused',
      searchPath: 'userdata',
      accessScope: {
        schema: 'other_schema',
        tables: ['ds_owned'],
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe('VALIDATION_ERROR');
  });

  it('forces read-only and timeout settings into every custom connection', async () => {
    const result = await validateAndExecute('SELECT * FROM ds_owned', {
      connectionString:
        'postgresql://userdata_readonly:password@example.test/app?sslmode=require',
      searchPath: 'userdata',
      accessScope: {
        schema: 'userdata',
        tables: ['ds_owned'],
      },
    });

    expect(result.success).toBe(true);
    expect(mocks.neon).toHaveBeenCalledOnce();
    const connectionUrl = new URL(mocks.neon.mock.calls[0]?.[0] as string);
    expect(connectionUrl.searchParams.get('sslmode')).toBe('require');
    expect(connectionUrl.searchParams.get('options')).toContain(
      '-c search_path=userdata',
    );
    expect(connectionUrl.searchParams.get('options')).toContain(
      '-c statement_timeout=5000',
    );
    expect(connectionUrl.searchParams.get('options')).toContain(
      '-c default_transaction_read_only=on',
    );
  });
});
