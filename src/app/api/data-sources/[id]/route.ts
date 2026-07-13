/**
 * GET    /api/data-sources/[id]  — get data source detail + schema preview
 * DELETE /api/data-sources/[id]  — delete data source (DROP TABLE + metadata)
 */

import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getDb } from '@/db';
import * as schema from '@/db/schema';
import { getSession } from '@/lib/auth-helpers';
import { eq, and } from 'drizzle-orm';

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

  // Verify ownership.
  const [row] = await db
    .select({ type: schema.dataSources.type, config: schema.dataSources.config })
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

  // Drop physical tables for upload-type data sources.
  if (row.type === 'upload') {
    const config = row.config as Record<string, unknown>;
    const tables = config.tables as { name: string }[] | undefined;
    if (tables?.length) {
      const adminUrl = process.env.DATABASE_URL;
      if (!adminUrl) {
        return NextResponse.json(
          { error: 'DATABASE_URL not configured — cannot drop tables.' },
          { status: 500 },
        );
      }
      const sql = neon(adminUrl);
      await sql.query('BEGIN');
      try {
        for (const t of tables) {
          await sql.query(`DROP TABLE IF EXISTS userdata."${t.name}"`);
        }
        await db
          .delete(schema.dataSources)
          .where(
            and(
              eq(schema.dataSources.id, id),
              eq(schema.dataSources.userId, session.user.id),
            ),
          );
        await sql.query('COMMIT');
      } catch (err) {
        await sql.query('ROLLBACK');
        throw err;
      }
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
