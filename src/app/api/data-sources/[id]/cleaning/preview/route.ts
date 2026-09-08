import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import * as schema from '@/db/schema';
import { getSession } from '@/lib/auth-helpers';
import { buildPresetRecipe, executeCleaningRecipe } from '@/lib/data-sources/cleaning-engine';
import { cleaningRecipeSchema } from '@/lib/data-sources/cleaning-types';
import { loadCleaningRows, resolveCleaningTable } from '@/lib/data-sources/cleaning-service';
import { profileTableRows } from '@/lib/data-sources/profile-service';
import { getOwnedDataSource } from '@/lib/data-sources/schema-manager';
import type { SchemaJson } from '@/lib/data-sources/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const source = await getOwnedDataSource(id, session.user.id);
  if (!source || source.type !== 'upload') return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const readUrl = process.env.USERDATA_DATABASE_URL;
  if (!readUrl) return NextResponse.json({ error: 'USERDATA_DATABASE_URL not configured.' }, { status: 503 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 }); }
  const schemaJson = source.schemaJson as unknown as SchemaJson;
  const table = resolveCleaningTable(schemaJson);
  const requestedPreset = body && typeof body === 'object' && 'preset' in body
    ? (body as { preset: unknown }).preset
    : undefined;
  if (
    requestedPreset !== undefined &&
    requestedPreset !== 'conservative' &&
    requestedPreset !== 'standard' &&
    requestedPreset !== 'aggressive'
  ) {
    return NextResponse.json({ error: 'Unknown cleaning preset.' }, { status: 400 });
  }
  const candidate = requestedPreset
    ? buildPresetRecipe(table, requestedPreset)
    : body && typeof body === 'object' && 'recipe' in body
      ? (body as { recipe: unknown }).recipe
      : undefined;
  const parsed = cleaningRecipeSchema.safeParse(candidate);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid cleaning recipe.', details: parsed.error.flatten() }, { status: 400 });

  try {
    const rows = await loadCleaningRows(readUrl, table);
    const beforeProfile = profileTableRows(rows, table);
    const result = executeCleaningRecipe(rows, table, parsed.data);
    const afterProfile = profileTableRows(result.rows, table);
    const runId = crypto.randomUUID();
    await getDb().insert(schema.cleaningRuns).values({
      id: runId,
      dataSourceId: id,
      userId: session.user.id,
      recipe: parsed.data as unknown as Record<string, unknown>,
      baseRevision: source.dataRevision,
      previewSummary: result.summary as unknown as Record<string, unknown>,
      beforeProfile: beforeProfile as unknown as Record<string, unknown>,
      afterProfile: afterProfile as unknown as Record<string, unknown>,
      status: 'previewed',
    });
    return NextResponse.json({ runId, recipe: parsed.data, summary: result.summary, beforeProfile, afterProfile });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Cleaning preview failed.';
    const status = message.startsWith('Cleaning is limited') ? 413 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
