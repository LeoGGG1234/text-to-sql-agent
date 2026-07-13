#!/usr/bin/env npx tsx
/**
 * migrate-add-row-id.ts
 *
 * One-time migration: adds `_row_id SERIAL PRIMARY KEY` to any existing
 * userdata tables that don't have it yet.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... npx tsx scripts/migrate-add-row-id.ts
 */

import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set. Check your .env.local file.');
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function main() {
  // Find all userdata tables.
  const tables = await sql.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'userdata'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);

  if (tables.length === 0) {
    console.log('No tables found in userdata schema. Nothing to migrate.');
    return;
  }

  console.log(`Found ${tables.length} table(s) in userdata schema.\n`);

  for (const row of tables) {
    const tableName = (row as { table_name: string }).table_name;
    const fullName = `userdata."${tableName}"`;

    // Check if _row_id column already exists.
    const cols = await sql.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'userdata'
        AND table_name = '${tableName}'
        AND column_name = '_row_id'
    `);

    if (cols.length > 0) {
      console.log(`  ✓ ${tableName} — _row_id already exists, skipping`);
      continue;
    }

    // Check if table already has data.
    const [countRow] = await sql.query(`SELECT COUNT(*) AS cnt FROM ${fullName}`);
    const rowCount = Number((countRow as { cnt: string }).cnt);

    try {
      if (rowCount === 0) {
        // Empty table — add SERIAL PK in one step.
        await sql.query(
          `ALTER TABLE ${fullName} ADD COLUMN _row_id SERIAL PRIMARY KEY`,
        );
        console.log(`  ✓ ${tableName} — added _row_id SERIAL PRIMARY KEY (empty, ${rowCount} rows)`);
      } else {
        // Non-empty table — add column first, then backfill, then add PK.
        await sql.query(`ALTER TABLE ${fullName} ADD COLUMN _row_id INTEGER`);
        await sql.query(
          `CREATE SEQUENCE IF NOT EXISTS userdata.${tableName}_row_id_seq OWNED BY ${fullName}._row_id`,
        );
        await sql.query(
          `UPDATE ${fullName} SET _row_id = nextval('userdata.${tableName}_row_id_seq')`,
        );
        await sql.query(
          `ALTER TABLE ${fullName} ALTER COLUMN _row_id SET NOT NULL`,
        );
        await sql.query(
          `ALTER TABLE ${fullName} ADD PRIMARY KEY (_row_id)`,
        );
        await sql.query(
          `ALTER TABLE ${fullName} ALTER COLUMN _row_id SET DEFAULT nextval('userdata.${tableName}_row_id_seq')`,
        );
        console.log(`  ✓ ${tableName} — added _row_id SERIAL PRIMARY KEY (${rowCount} rows backfilled)`);
      }
    } catch (err) {
      console.error(`  ✗ ${tableName} — failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log('\nMigration complete.');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
