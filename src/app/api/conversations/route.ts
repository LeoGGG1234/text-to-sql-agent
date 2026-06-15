/**
 * Conversations API — list + create
 *
 * GET  /api/conversations       — list user's conversations
 * POST /api/conversations       — create new conversation
 */

import { getSession } from '@/lib/auth-helpers';
import { db, schema } from '@/db';
import { eq, desc, sql } from 'drizzle-orm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ─── GET: List conversations ──────────────────────────────────

export async function GET(req: Request) {
  const session = await getSession(req);
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const conversations = await db
    .select({
      id: schema.chatConversations.id,
      title: schema.chatConversations.title,
      updatedAt: schema.chatConversations.updatedAt,
      createdAt: schema.chatConversations.createdAt,
      messageCount: sql<number>`(
        SELECT COUNT(*) FROM ${schema.chatMessages}
        WHERE ${schema.chatMessages.conversationId} = ${schema.chatConversations.id}
      )::int`.mapWith(Number),
    })
    .from(schema.chatConversations)
    .where(eq(schema.chatConversations.userId, session.user.id))
    .orderBy(desc(schema.chatConversations.updatedAt))
    .limit(50);

  return Response.json({ conversations });
}

// ─── POST: Create conversation ────────────────────────────────

export async function POST(req: Request) {
  const session = await getSession(req);
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const title = typeof body.title === 'string' ? body.title : null;

  const id = crypto.randomUUID();
  const now = new Date();

  await db.insert(schema.chatConversations).values({
    id,
    userId: session.user.id,
    title,
    createdAt: now,
    updatedAt: now,
  });

  return Response.json({ id, title, createdAt: now.toISOString() });
}
