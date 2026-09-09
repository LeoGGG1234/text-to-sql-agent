import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSession, getOwnedDataSource, getDb, neon } = vi.hoisted(() => ({
  getSession: vi.fn(),
  getOwnedDataSource: vi.fn(),
  getDb: vi.fn(),
  neon: vi.fn(),
}));

vi.mock('@/lib/auth-helpers', () => ({ getSession }));
vi.mock('@/lib/data-sources/schema-manager', () => ({ getOwnedDataSource }));
vi.mock('@/db', () => ({ getDb }));
vi.mock('@neondatabase/serverless', () => ({ neon }));

import { POST as profile } from '../src/app/api/data-sources/[id]/profile/route';
import { POST as preview } from '../src/app/api/data-sources/[id]/cleaning/preview/route';
import { POST as apply } from '../src/app/api/data-sources/[id]/cleaning/apply/route';
import { GET as history } from '../src/app/api/data-sources/[id]/cleaning-runs/route';

const request = (url: string, body?: unknown) => new Request(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const params = { params: Promise.resolve({ id: 'source-b' }) };

describe('data-quality and cleaning ownership gates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({ user: { id: 'user-a' } });
    getOwnedDataSource.mockResolvedValue(null);
  });

  it('returns the same 404 for a non-owned re-profile target without querying data', async () => {
    const response = await profile(request('http://localhost/api/data-sources/source-b/profile'), params);
    expect(response.status).toBe(404);
    expect(neon).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
  });

  it('returns the same 404 for a non-owned cleaning preview without reading rows', async () => {
    const response = await preview(request(
      'http://localhost/api/data-sources/source-b/cleaning/preview',
      { preset: 'standard' },
    ), params);
    expect(response.status).toBe(404);
    expect(neon).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
  });

  it('returns the same 404 for a non-owned cleaning apply without loading a run', async () => {
    const response = await apply(request(
      'http://localhost/api/data-sources/source-b/cleaning/apply',
      { runId: 'run-b' },
    ), params);
    expect(response.status).toBe(404);
    expect(getDb).not.toHaveBeenCalled();
  });

  it('returns the same 404 for non-owned cleaning history without loading runs', async () => {
    const response = await history(new Request(
      'http://localhost/api/data-sources/source-b/cleaning-runs',
    ), params);
    expect(response.status).toBe(404);
    expect(getDb).not.toHaveBeenCalled();
  });

  it('returns stored validation evidence for owned cleaning history', async () => {
    getOwnedDataSource.mockResolvedValue({ id: 'source-b', userId: 'user-a', type: 'upload' });
    const profile = {
      columns: {},
      table: { duplicateRowCount: 1, duplicateRatio: 0.5, totalColumns: 2, columnsWithIssues: 1 },
    };
    const run = {
      id: 'run-a',
      recipe: { name: 'Standard preset', steps: [] },
      previewSummary: { affectedRows: 1 },
      beforeValidation: profile.table,
      afterValidation: { ...profile.table, duplicateRowCount: 0 },
      status: 'applied',
      baseRevision: 2,
      resultRevision: 3,
      createdAt: new Date('2026-09-08T00:00:00.000Z'),
      appliedAt: new Date('2026-09-08T00:01:00.000Z'),
    };
    const limit = vi.fn().mockResolvedValue([run]);
    const orderBy = vi.fn().mockReturnValue({ limit });
    const where = vi.fn().mockReturnValue({ orderBy });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    getDb.mockReturnValue({ select });

    const response = await history(new Request(
      'http://localhost/api/data-sources/source-b/cleaning-runs',
    ), params);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      runs: [expect.objectContaining({
        id: 'run-a',
        beforeValidation: profile.table,
        afterValidation: expect.objectContaining({ duplicateRowCount: 0 }),
      })],
    });
  });
});
