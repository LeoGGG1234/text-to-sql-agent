/**
 * GET    /api/data-sources/[id]  — get data source detail + schema preview
 * DELETE /api/data-sources/[id]  — delete data source (DROP TABLE + metadata)
 */

import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import * as schema from '@/db/schema';
import { getSession } from '@/lib/auth-helpers';
import { eq, and } from 'drizzle-orm';
import { getOwnedDataSource } from '@/lib/data-sources/schema-manager';
import { withDatabaseTransaction } from '@/lib/database-transaction';

const UPLOAD_TABLE_NAME =
  /^ds_[0-9a-f]{8}_[0-9a-f]{4}_[0-9a-f]{4}_[0-9a-f]{4}_[0-9a-f]{12}$/i;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const db = getDb();

  const [row] = await db
    .select()
    .from(schema.dataSources)
    .where(
      and(
        eq(schema.dataSources.id, id),
        eq(schema.dataSources.userId, session.user.id),
      ),
    )
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({
    id: row.id,
    name: row.name,
    type: row.type,
    config: row.config,
    schemaJson: row.schemaJson,
    dataRevision: row.dataRevision,
    profileRevision: row.profileRevision,
    profileStatus: row.profileStatus,
    profiledAt: row.profiledAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const db = getDb();

  const row = await getOwnedDataSource(id, session.user.id);

  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Drop physical tables for upload-type data sources.
  if (row.type === 'upload') {
    const config = row.config as Record<string, unknown>;
    const tables = config.tables as { name: string }[] | undefined;
    if (tables?.length) {
      if (tables.some((table) => !UPLOAD_TABLE_NAME.test(table.name))) {
        return NextResponse.json(
          { error: 'Data source contains invalid physical table metadata.' },
          { status: 409 },
        );
      }
      const adminUrl = process.env.DATABASE_URL;
      if (!adminUrl) {
        return NextResponse.json(
          { error: 'DATABASE_URL not configured — cannot drop tables.' },
          { status: 500 },
        );
      }
      await withDatabaseTransaction(adminUrl, async (client) => {
        for (const t of tables) {
          await client.query(`DROP TABLE IF EXISTS userdata."${t.name}"`);
        }
        await client.query(
          'DELETE FROM data_sources WHERE id = $1 AND user_id = $2',
          [id, session.user.id],
        );
      });
      return NextResponse.json({ success: true });
    }
  }

  // External type: just delete metadata.
  await db
    .delete(schema.dataSources)
    .where(
      and(
        eq(schema.dataSources.id, id),
        eq(schema.dataSources.userId, session.user.id),
      ),
    );

  return NextResponse.json({ success: true });
}
