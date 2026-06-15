/**
 * Unified session retrieval — dev/guest bypass or real Better Auth.
 *
 * All API routes should use `getSession(req)` instead of calling
 * `auth.api.getSession()` directly. This centralizes the bypass logic:
 *
 *   1. DEV_MODE=true   → dev user (local development)
 *   2. ALLOW_GUEST=true → guest user if no real session (production demo)
 *   3. Otherwise → Better Auth session
 */

import { auth } from './auth';
import { isDevMode, ensureDevUser, isGuestMode, ensureGuestUser } from './dev-helpers';

export async function getSession(req: Request) {
  // Dev mode always wins — no real auth needed
  if (isDevMode()) {
    return ensureDevUser();
  }

  // Guest mode: try real auth first, fall back to guest
  if (isGuestMode()) {
    const session = await auth.api.getSession({ headers: req.headers });
    if (session) return session;
    return ensureGuestUser();
  }

  // Normal auth
  return auth.api.getSession({ headers: req.headers });
}
