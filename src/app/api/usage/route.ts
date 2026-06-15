/**
 * Usage API — token consumption statistics
 *
 * GET /api/usage  — current user's token usage (today, month, total)
 */

import { getSession } from '@/lib/auth-helpers';
import { db, schema } from '@/db';
import { sql, eq, and, gte } from 'drizzle-orm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const session = await getSession(req);
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;
  const now = new Date();

  // Start of today (UTC)
  const todayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );

  // Start of this month (UTC)
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );

  // ─── Today ────────────────────────────────────────────
  const [today] = await db
    .select({
      promptTokens: sql<number>`COALESCE(SUM(${schema.usageRecords.promptTokens}), 0)::int`.mapWith(
        Number,
      ),
      completionTokens: sql<number>`COALESCE(SUM(${schema.usageRecords.completionTokens}), 0)::int`.mapWith(
        Number,
      ),
    })
    .from(schema.usageRecords)
    .where(
      and(
        eq(schema.usageRecords.userId, userId),
        gte(schema.usageRecords.createdAt, todayStart),
      ),
    );

  // ─── This month ───────────────────────────────────────
  const [month] = await db
    .select({
      promptTokens: sql<number>`COALESCE(SUM(${schema.usageRecords.promptTokens}), 0)::int`.mapWith(
        Number,
      ),
      completionTokens: sql<number>`COALESCE(SUM(${schema.usageRecords.completionTokens}), 0)::int`.mapWith(
        Number,
      ),
    })
    .from(schema.usageRecords)
    .where(
      and(
        eq(schema.usageRecords.userId, userId),
        gte(schema.usageRecords.createdAt, monthStart),
      ),
    );

  // ─── All time ─────────────────────────────────────────
  const [total] = await db
    .select({
      promptTokens: sql<number>`COALESCE(SUM(${schema.usageRecords.promptTokens}), 0)::int`.mapWith(
        Number,
      ),
      completionTokens: sql<number>`COALESCE(SUM(${schema.usageRecords.completionTokens}), 0)::int`.mapWith(
        Number,
      ),
    })
    .from(schema.usageRecords)
    .where(eq(schema.usageRecords.userId, userId));

  return Response.json({
    today: {
      promptTokens: today?.promptTokens ?? 0,
      completionTokens: today?.completionTokens ?? 0,
    },
    thisMonth: {
      promptTokens: month?.promptTokens ?? 0,
      completionTokens: month?.completionTokens ?? 0,
    },
    total: {
      promptTokens: total?.promptTokens ?? 0,
      completionTokens: total?.completionTokens ?? 0,
    },
  });
}
