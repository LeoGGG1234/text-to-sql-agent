#!/usr/bin/env npx tsx

import { neon } from '@neondatabase/serverless';
import { ensureUserdataReadonlyRole } from '../src/lib/data-sources/userdata-security';

const databaseUrl = process.env.HARDEN_DATABASE_URL;
if (!databaseUrl) {
  console.error(
    'HARDEN_DATABASE_URL is required. DATABASE_URL is intentionally ignored.',
  );
  process.exit(1);
}

const password = process.env.USERDATA_READONLY_PASSWORD;
if (!password) {
  console.error('USERDATA_READONLY_PASSWORD is required.');
  process.exit(1);
}

await ensureUserdataReadonlyRole(neon(databaseUrl), {
  password,
  production: true,
});

console.log('userdata_readonly role created or restored to least privilege.');
