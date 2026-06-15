/**
 * Drizzle Kit configuration.
 *
 * Generates SQL migrations from the TypeScript schema.
 * Run: npx drizzle-kit generate
 * Migrate: npx drizzle-kit migrate
 */

import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
} satisfies Config;
