/**
 * Single conversation API — get, update, delete
 *
 * GET    /api/conversations/[id]  — get conversation with messages
 * PATCH  /api/conversations/[id]  — update title
 * DELETE /api/conversations/[id]  — delete conversation
 */

import { getSession } from '@/lib/auth-helpers';
import { db, schema } from '@/db';
import { eq, and } from 'drizzle-orm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Helper: verify user owns the conversation
async function getOwnedConversation(userId: string, conversationId: string) {
  const [conv] = await db
    .select()
    .from(schema.chatConversations)
    .where(
      and(
        eq(schema.chatConversations.id, conversationId),
        eq(schema.chatConversations.userId, userId),
      ),
    )
    .limit(1);
  return conv ?? null;
}

// ─── GET: Conversation with messages ──────────────────────────

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession(req);
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const conv = await getOwnedConversation(session.user.id, id);
  if (!conv) {
    return Response.json({ error: 'Conversation not found' }, { status: 404 });
  }

  const messages = await db
    .select()
    .from(schema.chatMessages)
    .where(eq(schema.chatMessages.conversationId, id))
    .orderBy(schema.chatMessages.createdAt)
    .limit(500);

  return Response.json({
    id: conv.id,
    title: conv.title,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      parts: m.parts,
      tokens: m.tokens,
      createdAt: m.createdAt,
    })),
  });
}

// ─── PATCH: Update title ──────────────────────────────────────

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession(req);
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const conv = await getOwnedConversation(session.user.id, id);
  if (!conv) {
    return Response.json({ error: 'Conversation not found' }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const title =
    typeof body.title === 'string' ? body.title.slice(0, 200) : null;

  await db
    .update(schema.chatConversations)
    .set({ title, updatedAt: new Date() })
    .where(eq(schema.chatConversations.id, id));

  return Response.json({ ok: true, title });
}

// ─── DELETE: Delete conversation ──────────────────────────────

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession(req);
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const conv = await getOwnedConversation(session.user.id, id);
  if (!conv) {
    return Response.json({ error: 'Conversation not found' }, { status: 404 });
  }

  await db
    .delete(schema.chatConversations)
    .where(eq(schema.chatConversations.id, id));

  return Response.json({ ok: true });
}
