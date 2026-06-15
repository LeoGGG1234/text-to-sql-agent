/**
 * Better Auth catch-all API route.
 *
 * Handles: POST /api/auth/sign-in/email, /api/auth/sign-up/email,
 *          GET /api/auth/session, /api/auth/sign-out, etc.
 */

import { auth } from '@/lib/auth';
import { toNextJsHandler } from 'better-auth/next-js';

export const { POST, GET } = toNextJsHandler(auth);
