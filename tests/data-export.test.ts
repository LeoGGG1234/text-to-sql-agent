import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCsvExport,
  createCsvFileName,
  csvContentDisposition,
} from '../src/lib/data-sources/csv-export';
import type { DiscoveredTable } from '../src/lib/data-sources/types';

const { getSession, getOwnedDataSource, neon } = vi.hoisted(() => ({
  getSession: vi.fn(),
  getOwnedDataSource: vi.fn(),
  neon: vi.fn(),
}));

vi.mock('@/lib/auth-helpers', () => ({ getSession }));
vi.mock('@/lib/data-sources/schema-manager', () => ({ getOwnedDataSource }));
vi.mock('@neondatabase/serverless', () => ({ neon }));

import { GET } from '../src/app/api/data-sources/[id]/export/route';

const table: DiscoveredTable = {
  name: 'ds_12345678_1234_1234_1234_123456789abc',
  displayName: '销售/orders.xlsx',
  rowCount: 2,
  columns: [
    { name: 'customer', displayName: '客户', type: 'TEXT', semanticType: 'TEXT', nullable: false, hint: null },
    { name: 'amount', displayName: '金额', type: 'TEXT', semanticType: 'NUMERIC', nullable: true, hint: null },
  ],
};

const priorReadUrl = process.env.USERDATA_DATABASE_URL;

describe('CSV data export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.USERDATA_DATABASE_URL = 'postgresql://readonly@example.test/db';
    getSession.mockResolvedValue({ user: { id: 'user-a' } });
    getOwnedDataSource.mockResolvedValue({
      type: 'upload',
      schemaJson: { tables: [table], relationships: [] },
    });
  });

  afterEach(() => {
    if (priorReadUrl === undefined) delete process.env.USERDATA_DATABASE_URL;
    else process.env.USERDATA_DATABASE_URL = priorReadUrl;
  });

  it('exports display headers, preserves Unicode, and escapes formula-like cells', () => {
    const csv = createCsvExport(table, [
      { _row_id: 1, customer: '上海客户', amount: '=2+3' },
      { _row_id: 2, customer: 'A, B', amount: '  =2+3' },
    ]);

    expect(csv.startsWith('\uFEFF客户,金额\r\n')).toBe(true);
    expect(csv).toContain("上海客户,\"'=2+3\"");
    expect(csv).toContain('"A, B",\"\'  =2+3\"');
    expect(csv).not.toContain('_row_id');
  });

  it('sanitizes the download name and emits an RFC 5987 filename', () => {
    const fileName = createCsvFileName(table.displayName);
    expect(fileName).toBe('销售-orders-export.csv');
    expect(csvContentDisposition(fileName)).toContain(
      `filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
    expect(csvContentDisposition("client's-data.csv")).toContain('client%27s-data.csv');
  });

  it('exports an owned upload through the read-only connection', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([{ _row_id: 7, customer: 'Alpha', amount: '10' }]);
    neon.mockReturnValue({ query });

    const response = await GET(
      new Request('http://localhost/api/data-sources/source-a/export'),
      { params: Promise.resolve({ id: 'source-a' }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.text()).toContain('Alpha,10');
    expect(neon).toHaveBeenCalledWith(process.env.USERDATA_DATABASE_URL);
  });

  it('returns the same 404 for a non-owned source without reading rows', async () => {
    getOwnedDataSource.mockResolvedValue(null);

    const response = await GET(
      new Request('http://localhost/api/data-sources/source-b/export'),
      { params: Promise.resolve({ id: 'source-b' }) },
    );

    expect(response.status).toBe(404);
    expect(neon).not.toHaveBeenCalled();
  });
});
