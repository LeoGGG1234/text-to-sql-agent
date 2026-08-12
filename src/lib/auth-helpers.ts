/**
 * Unified session retrieval — local dev bypass or real Better Auth.
 *
 * All API routes should use `getSession(req)` instead of calling
 * `auth.api.getSession()` directly. This centralizes the session logic:
 *
 *   1. DEV_MODE=true → dev user (local development)
 *   2. Otherwise → Better Auth session (including anonymous demo sessions)
 */

import { getAuth } from './auth';
import { isDevMode, ensureDevUser } from './dev-helpers';

export async function getSession(req: Request) {
  // Dev mode always wins — no real auth needed
  if (isDevMode()) {
    return ensureDevUser();
  }

  // Real auth, including per-browser anonymous demo sessions
  return getAuth().api.getSession({ headers: req.headers });
}
