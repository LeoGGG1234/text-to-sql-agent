#!/usr/bin/env npx tsx

import { neon } from '@neondatabase/serverless';
import {
  buildGuestCleanupBlock,
  LEGACY_SHARED_GUEST_ID,
  planGuestCleanup,
  type GuestCleanupCandidate,
  type GuestDataSourceRecord,
} from '../src/lib/guest-cleanup';

const databaseUrl = process.env.CLEANUP_DATABASE_URL;
if (!databaseUrl) {
  console.error(
    'CLEANUP_DATABASE_URL is required. DATABASE_URL is intentionally ignored.',
  );
  process.exit(1);
}

const retentionDays = Number.parseInt(
  process.env.GUEST_RETENTION_DAYS ?? '30',
  10,
);
if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
  console.error('GUEST_RETENTION_DAYS must be an integer between 1 and 3650.');
  process.exit(1);
}

const execute = process.argv.includes('--execute');
const includeLegacy = process.argv.includes('--include-legacy');
if (
  execute &&
  process.env.CONFIRM_GUEST_CLEANUP !== 'DELETE_EXPIRED_GUEST_DATA'
) {
  console.error(
    'Execution requires CONFIRM_GUEST_CLEANUP=DELETE_EXPIRED_GUEST_DATA.',
  );
  process.exit(1);
}

const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
const sql = neon(databaseUrl);
const rows = await sql.query(
  `SELECT
     u.id,
     u.created_at,
     COALESCE(
       jsonb_agg(
         jsonb_build_object(
           'id', ds.id,
           'type', ds.type,
           'config', ds.config,
           'schemaJson', ds.schema_json
         )
       ) FILTER (WHERE ds.id IS NOT NULL),
       '[]'::jsonb
     ) AS data_sources
   FROM "user" u
   LEFT JOIN data_sources ds ON ds.user_id = u.id
   WHERE (u.is_anonymous = true OR ($2::boolean AND u.id = $3))
     AND u.created_at < $1
     AND NOT EXISTS (
       SELECT 1 FROM "session" s
       WHERE s.user_id = u.id AND s.expires_at > now()
     )
   GROUP BY u.id, u.created_at
   ORDER BY u.created_at`,
  [cutoff, includeLegacy, LEGACY_SHARED_GUEST_ID],
);

const plans = rows.map((row) => {
  const record = row as {
    id: string;
    created_at: Date | string;
    data_sources: GuestDataSourceRecord[];
  };
  const candidate: GuestCleanupCandidate = {
    userId: record.id,
    createdAt: new Date(record.created_at),
    isLegacySharedGuest: record.id === LEGACY_SHARED_GUEST_ID,
    dataSources: record.data_sources,
  };
  return planGuestCleanup(candidate);
});

console.log(
  `${execute ? 'EXECUTE' : 'DRY RUN'}: ${plans.length} candidate(s), cutoff ${cutoff.toISOString()}`,
);
for (const plan of plans) {
  console.log(
    `${plan.safeToExecute ? 'READY' : 'BLOCKED'} ${plan.userId}: ${plan.dataSources.length} data source(s), ${plan.tableNames.length} physical table(s)${plan.isLegacySharedGuest ? ' [legacy shared guest]' : ''}`,
  );
  for (const error of plan.errors) console.log(`  ${error}`);
}

if (!execute) {
  console.log('No data changed. Add --execute and the confirmation variable to apply.');
  process.exit(0);
}

let cleaned = 0;
for (const plan of plans) {
  if (!plan.safeToExecute) continue;
  await sql.query(buildGuestCleanupBlock(plan, cutoff, includeLegacy));
  const [remaining] = await sql.query(
    'SELECT EXISTS (SELECT 1 FROM "user" WHERE id = $1) AS exists',
    [plan.userId],
  );
  if (!(remaining as { exists: boolean }).exists) cleaned++;
}

console.log(
  `Cleanup complete: ${cleaned} deleted, ${plans.length - cleaned} retained or blocked.`,
);
