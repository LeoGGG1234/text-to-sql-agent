import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkDeploymentReadiness } from '../src/lib/deployment-readiness';

const query = vi.fn();
const sql = { query } as Parameters<typeof checkDeploymentReadiness>[0];

describe('deployment readiness gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes a migrated schema and hardened userdata role', async () => {
    query
      .mockResolvedValueOnce([
        { is_nullable: 'NO', column_default: 'false' },
      ])
      .mockResolvedValueOnce([
        { cleaning_runs_exists: true, revision_columns: 4 },
      ])
      .mockResolvedValueOnce([
        {
          rolcanlogin: true,
          rolinherit: false,
          rolsuper: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolreplication: false,
          rolbypassrls: false,
          has_memberships: false,
        },
      ])
      .mockResolvedValueOnce([
        { schema_exists: true, has_usage: true, has_create: false },
      ])
      .mockResolvedValueOnce([{ total: 2, selectable: 2, writable: 0 }]);

    const results = await checkDeploymentReadiness(sql, {
      checkUserdataSecurity: true,
    });

    expect(results).toHaveLength(5);
    expect(results.every((result) => result.ok)).toBe(true);
  });

  it('fails when the guest migration has not been applied', async () => {
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await expect(
      checkDeploymentReadiness(sql, { checkUserdataSecurity: false }),
    ).resolves.toEqual([
      expect.objectContaining({ name: 'guest migration', ok: false }),
      expect.objectContaining({ name: 'data quality migration', ok: false }),
    ]);
  });

  it('reports missing role checks without issuing invalid privilege queries', async () => {
    query
      .mockResolvedValueOnce([
        { is_nullable: 'NO', column_default: 'false' },
      ])
      .mockResolvedValueOnce([
        { cleaning_runs_exists: true, revision_columns: 4 },
      ])
      .mockResolvedValueOnce([]);

    const results = await checkDeploymentReadiness(sql, {
      checkUserdataSecurity: true,
    });

    expect(results).toHaveLength(5);
    expect(results.slice(2).every((result) => !result.ok)).toBe(true);
    expect(query).toHaveBeenCalledTimes(3);
  });
});
