/**
 * PUT /api/conversations/[id]/data-source — set active data source for a conversation
 *
 * Body: { dataSourceId: string | null }
 *   - string: use this data source
 *   - null:   reset to built-in retail demo
 */

import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import * as schema from '@/db/schema';
import { getSession } from '@/lib/auth-helpers';
import { eq, and } from 'drizzle-orm';
import { getOwnedConversation } from '@/lib/conversation-manager';
import { getOwnedDataSource } from '@/lib/data-sources/schema-manager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: conversationId } = await params;
  const db = getDb();

  // Verify conversation belongs to user.
  const conv = await getOwnedConversation(conversationId, session.user.id);

  if (!conv) {
    return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });
  }

  let body: { dataSourceId?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const dsId = body.dataSourceId ?? null;

  if (dsId) {
    const ds = await getOwnedDataSource(dsId, session.user.id);

    if (!ds) {
      return NextResponse.json(
        { error: 'Data source not found.' },
        { status: 404 },
      );
    }
  }

  await db
    .update(schema.chatConversations)
    .set({ dataSourceId: dsId, updatedAt: new Date() })
    .where(
      and(
        eq(schema.chatConversations.id, conversationId),
        eq(schema.chatConversations.userId, session.user.id),
      ),
    );

  return NextResponse.json({ success: true, dataSourceId: dsId });
}
