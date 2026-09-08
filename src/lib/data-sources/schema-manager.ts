/**
 * Runtime schema resolution for data sources.
 *
 * No in-memory caching — schema is read from data_sources.schema_json
 * on every request, avoiding multi-instance staleness.
 */

import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import * as schema from '@/db/schema';
import type { SchemaJson } from './types';

/**
 * Get data source metadata by ID while enforcing ownership in the query.
 */
export async function getOwnedDataSource(
  dataSourceId: string,
  userId: string,
) {
  const db = getDb();
  const [row] = await db
    .select({
      id: schema.dataSources.id,
      userId: schema.dataSources.userId,
      name: schema.dataSources.name,
      type: schema.dataSources.type,
      config: schema.dataSources.config,
      schemaJson: schema.dataSources.schemaJson,
      dataRevision: schema.dataSources.dataRevision,
      profileRevision: schema.dataSources.profileRevision,
      profileStatus: schema.dataSources.profileStatus,
      profiledAt: schema.dataSources.profiledAt,
    })
    .from(schema.dataSources)
    .where(
      and(
        eq(schema.dataSources.id, dataSourceId),
        eq(schema.dataSources.userId, userId),
      ),
    )
    .limit(1);

  return row ?? null;
}

/**
 * Get the SchemaJson for a data source by ID.
 * Verifies ownership by userId.
 */
export async function getSchemaForDataSource(
  dataSourceId: string,
  userId: string,
): Promise<SchemaJson | null> {
  const row = await getOwnedDataSource(dataSourceId, userId);

  if (!row?.schemaJson) return null;

  return row.schemaJson as unknown as SchemaJson;
}
