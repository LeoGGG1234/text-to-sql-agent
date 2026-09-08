/**
 * GET  /api/data-sources  — list user's data sources
 */

import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import * as schema from '@/db/schema';
import { getSession } from '@/lib/auth-helpers';
import { eq } from 'drizzle-orm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDb();
  const rows = await db
    .select({
      id: schema.dataSources.id,
      name: schema.dataSources.name,
      type: schema.dataSources.type,
      config: schema.dataSources.config,
      schemaJson: schema.dataSources.schemaJson,
      dataRevision: schema.dataSources.dataRevision,
      profileRevision: schema.dataSources.profileRevision,
      profileStatus: schema.dataSources.profileStatus,
      profiledAt: schema.dataSources.profiledAt,
      createdAt: schema.dataSources.createdAt,
      updatedAt: schema.dataSources.updatedAt,
    })
    .from(schema.dataSources)
    .where(eq(schema.dataSources.userId, session.user.id))
    .orderBy(schema.dataSources.updatedAt);

  return NextResponse.json({ dataSources: rows });
}
