/**
 * Auth bypass check — exposes DEV_MODE and ALLOW_GUEST status to the frontend.
 *
 * GET /api/dev-check → { devMode: boolean, guestMode: boolean }
 *
 * DEV_MODE is only set in .env.local (development).
 * ALLOW_GUEST is set in Vercel production for demo access.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({
    devMode: process.env.DEV_MODE === 'true',
    guestMode: process.env.ALLOW_GUEST === 'true',
  });
}
