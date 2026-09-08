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
});
