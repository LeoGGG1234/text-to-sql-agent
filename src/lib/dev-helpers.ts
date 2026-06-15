/**
 * Auth bypass helpers — dev mode (local) and guest mode (production demo).
 *
 * DEV_MODE=true (set in .env.local only, never in Vercel production):
 *   - API routes skip Better Auth session checks and use a hardcoded dev user
 *   - Frontend skips the login page and renders with a mock session
 *
 * ALLOW_GUEST=true (set in Vercel production env):
 *   - API routes accept guest user sessions (no email/password required)
 *   - Frontend shows "Try Demo" button on login page
 *   - Guest conversations use a shared guest user
 */

import { db, schema } from '@/db';
import { eq } from 'drizzle-orm';

// ─── Dev mode ─────────────────────────────────────────────────

export const DEV_USER_ID = 'dev-00000000-0000-4000-a000-000000000001';
export const DEV_USER_EMAIL = 'dev@localhost';

export function isDevMode(): boolean {
  return process.env.DEV_MODE === 'true';
}

// ─── Guest mode (production demo) ─────────────────────────────

const GUEST_USER_ID = 'guest-00000000-0000-4000-a000-000000000001';
const GUEST_USER_EMAIL = 'guest@balatro-agent.demo';

export function isGuestMode(): boolean {
  return process.env.ALLOW_GUEST === 'true';
}

/**
 * Any auth-bypass mode active? (dev or guest)
 */
export function isBypassMode(): boolean {
  return isDevMode() || isGuestMode();
}

// ─── User creation ────────────────────────────────────────────

async function ensureUser(id: string, email: string, name: string): Promise<void> {
  const [existing] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.id, id))
    .limit(1);

  if (!existing) {
    const now = new Date();
    await db.insert(schema.user).values({
      id,
      email,
      name,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
  }
}

function makeMockSession(
  userId: string,
  email: string,
  name: string,
  agent: string,
) {
  return {
    user: {
      id: userId,
      email,
      name,
      emailVerified: true,
      image: null as string | null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    session: {
      id: `${userId}-session`,
      userId,
      token: `${userId}-token`,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      ipAddress: '127.0.0.1',
      userAgent: agent,
    },
  };
}

export async function ensureDevUser() {
  if (!isDevMode()) {
    throw new Error('ensureDevUser called outside dev mode');
  }
  await ensureUser(DEV_USER_ID, DEV_USER_EMAIL, 'Developer');
  return makeMockSession(DEV_USER_ID, DEV_USER_EMAIL, 'Developer', 'Dev Mode');
}

export async function ensureGuestUser() {
  if (!isGuestMode()) {
    throw new Error('ensureGuestUser called without ALLOW_GUEST');
  }
  await ensureUser(GUEST_USER_ID, GUEST_USER_EMAIL, 'Guest');
  return makeMockSession(GUEST_USER_ID, GUEST_USER_EMAIL, 'Guest', 'Guest Mode');
}
