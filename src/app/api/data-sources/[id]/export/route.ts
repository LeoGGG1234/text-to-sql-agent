import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth-helpers';
import {
  createCsvExport,
  createCsvFileName,
  csvContentDisposition,
} from '@/lib/data-sources/csv-export';
import { loadCleaningRows, resolveCleaningTable } from '@/lib/data-sources/cleaning-service';
import { getOwnedDataSource } from '@/lib/data-sources/schema-manager';
import type { SchemaJson } from '@/lib/data-sources/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const source = await getOwnedDataSource(id, session.user.id);
  if (!source || source.type !== 'upload') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const readUrl = process.env.USERDATA_DATABASE_URL;
  if (!readUrl) {
    return NextResponse.json({ error: 'USERDATA_DATABASE_URL not configured.' }, { status: 503 });
  }

  try {
    const table = resolveCleaningTable(source.schemaJson as unknown as SchemaJson);
    const rows = await loadCleaningRows(readUrl, table, 'Export');
    const fileName = createCsvFileName(table.displayName);
    return new Response(createCsvExport(table, rows), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': csvContentDisposition(fileName),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Export failed.';
    const status = message.startsWith('Export is limited') ? 413 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
