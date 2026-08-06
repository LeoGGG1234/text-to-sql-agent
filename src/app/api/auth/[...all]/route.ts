/**
 * Better Auth catch-all API route.
 *
 * Handles: POST /api/auth/sign-in/email, /api/auth/sign-up/email,
 *          GET /api/auth/session, /api/auth/sign-out, etc.
 */

import { getAuth } from '@/lib/auth';
import { toNextJsHandler } from 'better-auth/next-js';

const handler = (request: Request) => getAuth().handler(request);

export const { POST, GET } = toNextJsHandler(handler);
