import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
}));

vi.mock('@/lib/auth-helpers', () => ({
  getSession: mocks.getSession,
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true })),
}));

import { POST } from '../src/app/api/data-sources/upload/route';

function uploadRequest(file: File) {
  const form = new FormData();
  form.set('file', file);
  return new Request('http://localhost/api/data-sources/upload', {
    method: 'POST',
    body: form,
  });
}

describe('POST /api/data-sources/upload safety gates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: 'user-a' } });
  });

  afterEach(() => vi.unstubAllEnvs());

  it('fails before parsing when the userdata runtime connection is absent', async () => {
    vi.stubEnv('USERDATA_DATABASE_URL', '');

    const response = await POST(
      uploadRequest(new File(['a,b\n1,2'], 'data.csv', { type: 'text/csv' })),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'User-data querying is not configured.',
    });
  });

  it('rejects legacy binary .xls files with migration guidance', async () => {
    vi.stubEnv(
      'USERDATA_DATABASE_URL',
      'postgresql://userdata-readonly.example/test',
    );

    const response = await POST(
      uploadRequest(
        new File(['legacy'], 'legacy.xls', {
          type: 'application/vnd.ms-excel',
        }),
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error:
        'Legacy .xls files are not supported. Save the file as .xlsx or CSV and try again.',
    });
  });
});
