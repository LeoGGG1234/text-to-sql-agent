/**
 * Better Auth configuration — email/password authentication.
 *
 * Uses the Drizzle adapter to store users/sessions/accounts in Neon Postgres.
 */

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { getDb } from '@/db';

function createAuth() {
  return betterAuth({
    database: drizzleAdapter(getDb(), {
      provider: 'pg',
    }),
    emailAndPassword: {
      enabled: true,
      autoSignIn: true, // Sign in automatically after registration
    },
    session: {
      expiresIn: 30 * 24 * 60 * 60, // 30 days
      updateAge: 24 * 60 * 60, // Renew every 24 hours of activity
    },
    // Trust the proxy (Vercel) for IP/User-Agent in session
    trustedOrigins: [
      process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
    ],
  });
}

let auth: ReturnType<typeof createAuth> | null = null;

export function getAuth() {
  if (!auth) {
    auth = createAuth();
  }
  return auth;
}
