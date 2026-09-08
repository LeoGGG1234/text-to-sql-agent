import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import * as schema from '@/db/schema';
import { getSession } from '@/lib/auth-helpers';
import { executeCleaningRecipe } from '@/lib/data-sources/cleaning-engine';
import { cleaningRecipeSchema, type CleaningRow } from '@/lib/data-sources/cleaning-types';
import { cleaningSelectList, MAX_CLEANING_ROWS, resolveCleaningTable, updateRowCountMetadata } from '@/lib/data-sources/cleaning-service';
import { profileTableRows } from '@/lib/data-sources/profile-service';
import { quoteIdent } from '@/lib/data-sources/row-utils';
import { getOwnedDataSource } from '@/lib/data-sources/schema-manager';
import type { SchemaJson } from '@/lib/data-sources/types';
import { withDatabaseTransaction, type TransactionClient } from '@/lib/database-transaction';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function resultRows<T>(result: unknown): T[] {
  return (result as { rows?: T[] }).rows ?? [];
}

async function replaceRows(client: TransactionClient, tableName: string, columns: string[], rows: CleaningRow[]) {
  await client.query(`TRUNCATE TABLE userdata.${quoteIdent(tableName)}`);
  const names = ['_row_id', ...columns];
  const quoted = names.map(quoteIdent).join(', ');
  const batchSize = Math.max(1, Math.floor(60_000 / names.length));
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const values: unknown[] = [];
    const tuples = batch.map((row) => {
      const placeholders = names.map((name) => {
        values.push(row[name] ?? null);
        return `$${values.length}`;
      });
      return `(${placeholders.join(', ')})`;
    });
    await client.query(
      `INSERT INTO userdata.${quoteIdent(tableName)} (${quoted}) VALUES ${tuples.join(', ')}`,
      values,
    );
  }
  await client.query(
    `SELECT setval(
       pg_get_serial_sequence($1::text, '_row_id'),
       COALESCE(MAX(_row_id), 1),
       COUNT(*) > 0
     ) FROM userdata.${quoteIdent(tableName)}`,
    [`userdata."${tableName}"`],
  );
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const source = await getOwnedDataSource(id, session.user.id);
  if (!source || source.type !== 'upload') return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let body: { runId?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 }); }
  if (typeof body.runId !== 'string') return NextResponse.json({ error: 'runId is required.' }, { status: 400 });

  const db = getDb();
  const [run] = await db.select().from(schema.cleaningRuns).where(and(
    eq(schema.cleaningRuns.id, body.runId),
    eq(schema.cleaningRuns.dataSourceId, id),
    eq(schema.cleaningRuns.userId, session.user.id),
  )).limit(1);
  if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (run.status !== 'previewed') return NextResponse.json({ error: 'Cleaning run has already been applied.' }, { status: 409 });
  const parsed = cleaningRecipeSchema.safeParse(run.recipe);
  if (!parsed.success) return NextResponse.json({ error: 'Stored cleaning recipe is invalid.' }, { status: 409 });
  const adminUrl = process.env.DATABASE_URL;
  if (!adminUrl) return NextResponse.json({ error: 'DATABASE_URL not configured.' }, { status: 503 });

  const schemaJson = source.schemaJson as unknown as SchemaJson;
  const table = resolveCleaningTable(schemaJson);
  try {
    const response = await withDatabaseTransaction(adminUrl, async (client) => {
      const locked = resultRows<{ data_revision: number }>(await client.query(
        'SELECT data_revision FROM data_sources WHERE id = $1 AND user_id = $2 FOR UPDATE',
        [id, session.user.id],
      ))[0];
      if (!locked) throw new Error('NOT_FOUND');
      if (locked.data_revision !== run.baseRevision) throw new Error('REVISION_CONFLICT');

      const count = resultRows<{ count: number }>(await client.query(
        `SELECT COUNT(*)::int AS count FROM userdata.${quoteIdent(table.name)}`,
      ))[0];
      if (Number(count?.count ?? 0) > MAX_CLEANING_ROWS) throw new Error('ROW_LIMIT');
      const rows = resultRows<CleaningRow>(await client.query(
        `SELECT ${cleaningSelectList(table)} FROM userdata.${quoteIdent(table.name)} ORDER BY _row_id`,
      ));
      const beforeProfile = profileTableRows(rows, table);
      const result = executeCleaningRecipe(rows, table, parsed.data);
      const afterProfile = profileTableRows(result.rows, table);
      const changed = result.summary.affectedRows > 0;
      if (changed) await replaceRows(client, table.name, table.columns.map((column) => column.name), result.rows);

      const resultRevision = run.baseRevision + (changed ? 1 : 0);
      const metadata = updateRowCountMetadata(schemaJson, source.config as Record<string, unknown>, table.name, result.rows.length);
      const nextSchema = { ...metadata.schemaJson, qualityProfile: afterProfile };
      await client.query(
        `UPDATE data_sources
         SET config = $3::jsonb, schema_json = $4::jsonb,
             data_revision = $5, profile_revision = $5,
             profile_status = 'fresh', profiled_at = now(), updated_at = now()
         WHERE id = $1 AND user_id = $2`,
        [id, session.user.id, JSON.stringify(metadata.config), JSON.stringify(nextSchema), resultRevision],
      );
      await client.query(
        `UPDATE cleaning_runs
         SET status = 'applied', result_revision = $4,
             preview_summary = $5::jsonb, before_profile = $6::jsonb,
             after_profile = $7::jsonb, applied_at = now()
         WHERE id = $1 AND data_source_id = $2 AND user_id = $3 AND status = 'previewed'`,
        [body.runId, id, session.user.id, resultRevision, JSON.stringify(result.summary), JSON.stringify(beforeProfile), JSON.stringify(afterProfile)],
      );
      return { summary: result.summary, beforeProfile, afterProfile, resultRevision };
    });
    return NextResponse.json({ success: true, ...response });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '';
    if (message === 'NOT_FOUND') return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (message === 'REVISION_CONFLICT') return NextResponse.json({ error: 'Data changed after preview. Create a new preview before applying.' }, { status: 409 });
    if (message === 'ROW_LIMIT') return NextResponse.json({ error: `Cleaning is limited to ${MAX_CLEANING_ROWS.toLocaleString()} rows per run.` }, { status: 413 });
    return NextResponse.json({ error: 'Cleaning apply failed.' }, { status: 500 });
  }
}
