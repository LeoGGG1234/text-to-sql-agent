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
        {
          rolcanlogin: true,
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

    expect(results).toHaveLength(4);
    expect(results.every((result) => result.ok)).toBe(true);
  });

  it('fails when the guest migration has not been applied', async () => {
    query.mockResolvedValueOnce([]);

    await expect(
      checkDeploymentReadiness(sql, { checkUserdataSecurity: false }),
    ).resolves.toEqual([
      expect.objectContaining({ name: 'guest migration', ok: false }),
    ]);
  });

  it('reports missing role checks without issuing invalid privilege queries', async () => {
    query
      .mockResolvedValueOnce([
        { is_nullable: 'NO', column_default: 'false' },
      ])
      .mockResolvedValueOnce([]);

    const results = await checkDeploymentReadiness(sql, {
      checkUserdataSecurity: true,
    });

    expect(results).toHaveLength(4);
    expect(results.slice(1).every((result) => !result.ok)).toBe(true);
    expect(query).toHaveBeenCalledTimes(2);
  });
});
