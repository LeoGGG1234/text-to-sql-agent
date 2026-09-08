import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSession, getOwnedDataSource, neon } = vi.hoisted(() => ({
  getSession: vi.fn(),
  getOwnedDataSource: vi.fn(),
  neon: vi.fn(),
}));

vi.mock('@/lib/auth-helpers', () => ({ getSession }));
vi.mock('@/lib/data-sources/schema-manager', () => ({ getOwnedDataSource }));
vi.mock('@neondatabase/serverless', () => ({ neon, Client: vi.fn() }));

import { GET, PUT } from '../src/app/api/data-sources/[id]/rows/route';

const source = {
  type: 'upload',
  config: {},
  dataRevision: 0,
  schemaJson: {
    tables: [{
      name: 'ds_12345678_1234_1234_1234_123456789abc',
      displayName: 'data.csv',
      rowCount: 1,
      columns: [{
        name: 'amount',
        displayName: 'Amount',
        type: 'TEXT',
        semanticType: 'NUMERIC',
        nullable: true,
        hint: null,
      }],
    }],
    relationships: [],
  },
};

const params = { params: Promise.resolve({ id: 'source-a' }) };

describe('rows route validation errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({ user: { id: 'user-a' } });
    getOwnedDataSource.mockResolvedValue(source);
  });

  it('returns 400 for a table outside the data-source schema', async () => {
    const response = await GET(
      new Request('http://localhost/api/data-sources/source-a/rows?table=other'),
      params,
    );

    expect(response.status).toBe(400);
    expect(neon).not.toHaveBeenCalled();
  });

  it('returns 400 for a column outside the table schema', async () => {
    const response = await PUT(
      new Request('http://localhost/api/data-sources/source-a/rows', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table: source.schemaJson.tables[0].name,
          rowId: 1,
          column: 'other',
          value: '10',
        }),
      }),
      params,
    );

    expect(response.status).toBe(400);
    expect(neon).not.toHaveBeenCalled();
  });
});
