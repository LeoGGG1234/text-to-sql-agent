import { and, desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import * as schema from '@/db/schema';
import { getSession } from '@/lib/auth-helpers';
import { getOwnedDataSource } from '@/lib/data-sources/schema-manager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!await getOwnedDataSource(id, session.user.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const runs = await getDb().select({
    id: schema.cleaningRuns.id,
    recipe: schema.cleaningRuns.recipe,
    previewSummary: schema.cleaningRuns.previewSummary,
    status: schema.cleaningRuns.status,
    baseRevision: schema.cleaningRuns.baseRevision,
    resultRevision: schema.cleaningRuns.resultRevision,
    createdAt: schema.cleaningRuns.createdAt,
    appliedAt: schema.cleaningRuns.appliedAt,
  }).from(schema.cleaningRuns).where(and(
    eq(schema.cleaningRuns.dataSourceId, id),
    eq(schema.cleaningRuns.userId, session.user.id),
  )).orderBy(desc(schema.cleaningRuns.createdAt)).limit(20);
  return NextResponse.json({ runs });
}
