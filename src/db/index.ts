/**
 * Drizzle + Neon Serverless Postgres client.
 *
 * Uses the HTTP driver (@neondatabase/serverless) — no TCP connection pool,
 * ideal for Vercel serverless functions.
 */

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

function createDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is not configured. Set it in .env.local or Vercel environment variables.',
    );
  }
  const sql = neon(databaseUrl);
  return drizzle(sql, { schema });
}

// Singleton — reused across requests within the same Lambda invocation.
let _db: ReturnType<typeof createDb> | null = null;

export function getDb() {
  if (!_db) {
    _db = createDb();
  }
  return _db;
}

// Convenience export for direct use in API routes.
// Proxy ensures the database connection is only created at request time,
// not during module initialization (which would fail at Next.js build time).
export const db = new Proxy({} as ReturnType<typeof createDb>, {
  get(_, prop) {
    return getDb()[prop as keyof ReturnType<typeof createDb>];
  },
});

export * as schema from './schema';
