/**
 * Guest login endpoint — provides demo access without email/password.
 *
 * POST /api/guest-login
 *
 * Requires ALLOW_GUEST=true in environment variables.
 * Creates a unique Better Auth anonymous session for this browser.
 */

import { getAuth } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (process.env.ALLOW_GUEST !== 'true') {
    return Response.json(
      { error: 'Guest mode is not enabled' },
      { status: 403 },
    );
  }

  const authUrl = new URL('/api/auth/sign-in/anonymous', req.url);
  return getAuth().handler(
    new Request(authUrl, {
      method: 'POST',
      headers: req.headers,
    }),
  );
}
