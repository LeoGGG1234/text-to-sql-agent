/**
 * Runtime schema resolution for data sources.
 *
 * No in-memory caching — schema is read from data_sources.schema_json
 * on every request, avoiding multi-instance staleness.
 */

import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import * as schema from '@/db/schema';
import type { SchemaJson } from './types';

/**
 * Get the SchemaJson for a data source by ID.
 * Verifies ownership by userId.
 */
export async function getSchemaForDataSource(
  dataSourceId: string,
  userId: string,
): Promise<SchemaJson | null> {
  const db = getDb();
  const [row] = await db
    .select({ schemaJson: schema.dataSources.schemaJson })
    .from(schema.dataSources)
    .where(eq(schema.dataSources.id, dataSourceId));

  if (!row?.schemaJson) return null;

  // Verify ownership separately (used in API routes — this is a defense-in-depth check)
  const [owner] = await db
    .select({ userId: schema.dataSources.userId })
    .from(schema.dataSources)
    .where(eq(schema.dataSources.id, dataSourceId));

  if (!owner || owner.userId !== userId) return null;

  return row.schemaJson as unknown as SchemaJson;
}
