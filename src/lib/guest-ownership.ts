/**
 * Preserve application-owned resources when an anonymous Better Auth user
 * signs in or registers as a permanent user.
 */

import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';

export async function transferAnonymousUserResources(
  anonymousUserId: string,
  newUserId: string,
): Promise<void> {
  if (anonymousUserId === newUserId) return;

  const db = getDb();

  // Neon HTTP has no callback transactions; batch() executes these updates
  // atomically through the Neon transaction API.
  await db.batch([
    db
      .update(schema.chatConversations)
      .set({ userId: newUserId })
      .where(eq(schema.chatConversations.userId, anonymousUserId)),
    db
      .update(schema.dataSources)
      .set({ userId: newUserId })
      .where(eq(schema.dataSources.userId, anonymousUserId)),
    db
      .update(schema.usageRecords)
      .set({ userId: newUserId })
      .where(eq(schema.usageRecords.userId, anonymousUserId)),
  ]);
}
