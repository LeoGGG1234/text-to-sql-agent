import { neon } from '@neondatabase/serverless';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import * as schema from '@/db/schema';
import { getSession } from '@/lib/auth-helpers';
import { profileTableRows } from '@/lib/data-sources/profile-service';
import { quoteIdent, validateTableName } from '@/lib/data-sources/row-utils';
import { getOwnedDataSource } from '@/lib/data-sources/schema-manager';
import type { SchemaJson } from '@/lib/data-sources/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const source = await getOwnedDataSource(id, session.user.id);
  if (!source || source.type !== 'upload') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const readUrl = process.env.USERDATA_DATABASE_URL;
  if (!readUrl) {
    return NextResponse.json(
      { error: 'USERDATA_DATABASE_URL not configured.' },
      { status: 503 },
    );
  }

  const schemaJson = source.schemaJson as unknown as SchemaJson | null;
  const table = schemaJson?.tables?.[0];
  if (!table) {
    return NextResponse.json({ error: 'Data source schema is missing.' }, { status: 409 });
  }
  validateTableName(schemaJson, table.name);

  const columnList = table.columns.map((column) => quoteIdent(column.name)).join(', ');
  const sql = neon(readUrl);
  const rows = (await sql.query(
    `SELECT ${columnList} FROM userdata.${quoteIdent(table.name)} ORDER BY _row_id`,
  )) as Array<Record<string, unknown>>;
  const qualityProfile = profileTableRows(rows, table);
  const rowCount = rows.length;
  const nextSchema: SchemaJson = {
    ...schemaJson,
    tables: schemaJson.tables.map((item) =>
      item.name === table.name ? { ...item, rowCount } : item,
    ),
    qualityProfile,
  };
  const config = source.config as Record<string, unknown>;
  const nextConfig = {
    ...config,
    tables: Array.isArray(config.tables)
      ? config.tables.map((item) =>
          item && typeof item === 'object' && (item as { name?: unknown }).name === table.name
            ? { ...item, rowCount }
            : item,
        )
      : config.tables,
  };

  const db = getDb();
  const [updated] = await db
    .update(schema.dataSources)
    .set({
      config: nextConfig,
      schemaJson: nextSchema as unknown as Record<string, unknown>,
      profileRevision: source.dataRevision,
      profileStatus: 'fresh',
      profiledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.dataSources.id, id),
        eq(schema.dataSources.userId, session.user.id),
        eq(schema.dataSources.dataRevision, source.dataRevision),
      ),
    )
    .returning({ profiledAt: schema.dataSources.profiledAt });

  if (!updated) {
    return NextResponse.json(
      { error: 'Data changed while profiling. Please run the profile again.' },
      { status: 409 },
    );
  }

  return NextResponse.json({
    qualityProfile,
    rowCount,
    profileStatus: 'fresh',
    profileRevision: source.dataRevision,
    profiledAt: updated.profiledAt,
  });
}
