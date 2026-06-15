/**
 * Guest login endpoint — provides demo access without email/password.
 *
 * POST /api/guest-login
 *
 * Requires ALLOW_GUEST=true in environment variables.
 * When called, the frontend navigates to / where the auth guard
 * detects guestMode and auto-creates the bypass session.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  if (process.env.ALLOW_GUEST !== 'true') {
    return Response.json(
      { error: 'Guest mode is not enabled' },
      { status: 403 },
    );
  }

  return Response.json({ ok: true });
}
