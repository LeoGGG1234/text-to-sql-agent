/**
 * Better Auth configuration — email/password authentication.
 *
 * Uses the Drizzle adapter to store users/sessions/accounts in Neon Postgres.
 */

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { anonymous } from 'better-auth/plugins';
import { getDb } from '@/db';
import { transferAnonymousUserResources } from './guest-ownership';

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
    plugins:
      process.env.ALLOW_GUEST === 'true'
        ? [
            anonymous({
              onLinkAccount: async ({ anonymousUser, newUser }) => {
                await transferAnonymousUserResources(
                  anonymousUser.user.id,
                  newUser.user.id,
                );
              },
            }),
          ]
        : [],
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
