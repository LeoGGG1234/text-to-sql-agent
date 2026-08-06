/**
 * Ownership-aware conversation lookup shared by API routes.
 */

import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import * as schema from '@/db/schema';

export async function getOwnedConversation(
  conversationId: string,
  userId: string,
) {
  const db = getDb();
  const [conversation] = await db
    .select()
    .from(schema.chatConversations)
    .where(
      and(
        eq(schema.chatConversations.id, conversationId),
        eq(schema.chatConversations.userId, userId),
      ),
    )
    .limit(1);

  return conversation ?? null;
}
