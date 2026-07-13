/**
 * Detect and decode a CSV/Excel file buffer to text.
 *
 * Many Chinese CSV files are exported from Windows Excel in GBK (CP936), but
 * `file.text()` always decodes as UTF-8, producing garbled characters.
 * This helper tries UTF-8 first; if the result contains replacement characters
 * (U+FFFD) or throws a fatal decode error, it falls back to GBK.
 */
function decodeBuffer(buf: ArrayBuffer, encoding?: string): string {
  const uint8 = new Uint8Array(buf);

  // If the browser / caller explicitly provided an encoding hint, use it.
  if (encoding) {
    try {
      return new TextDecoder(encoding).decode(uint8);
    } catch {
      // fall through to detection
    }
  }

  // Try UTF-8 with fatal mode — throws on invalid UTF-8 sequences.
  try {
    const utf8 = new TextDecoder('utf-8', { fatal: true }).decode(uint8);
    // UTF-8 decode succeeded without errors — but check for BOM or
    // replacement chars that slipped through.
    if (!utf8.includes('�')) {
      return utf8;
    }
  } catch {
    // Not valid UTF-8 — likely GBK.
  }

  // Fallback: try common Chinese encodings.
  for (const enc of ['gbk', 'gb2312', 'gb18030']) {
    try {
      const text = new TextDecoder(enc).decode(uint8);
      // A successful GBK decode should not have any replacement chars.
      if (!text.includes('�')) {
        return text;
      }
    } catch {
      // try next
    }
  }

  // Last resort: return UTF-8 as-is (best-effort).
  return new TextDecoder('utf-8').decode(uint8);
}
/**
 * POST /api/data-sources/upload — CSV/Excel upload
 *
 * Multipart form: file (required), name (optional — defaults to filename)
 *
 * Flow (all in one DB transaction):
 *   parse → sanitize → CREATE TABLE (all TEXT) → batch INSERT
 *   → assemble schema_json in memory → INSERT INTO data_sources → COMMIT
 *
 * Limits: 50 MB, 200k rows, 5 req/min per user (configurable via env vars).
 */

import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import * as Papa from 'papaparse';
import { neon } from '@neondatabase/serverless';
import { getDb } from '@/db';
import * as schema from '@/db/schema';
import { getSession } from '@/lib/auth-helpers';
import { detectColumns, NULL_LIKE_VALUES, normalizeFullWidth } from '@/lib/data-sources/type-detector';
import type { DiscoveredTable, SchemaJson, UploadConfig, QualityProfile } from '@/lib/data-sources/types';
import { analyzeQuality } from '@/lib/data-sources/quality-analyzer';
import { checkRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120; // 2 min — Vercel Pro supports up to 300s

const UPLOAD_SCHEMA = 'userdata';

// Upload limits — configurable via env vars with sensible defaults.
const MAX_FILE_BYTES = parseInt(process.env.UPLOAD_MAX_FILE_MB ?? '80', 10) * 1024 * 1024;
const MAX_ROWS = parseInt(process.env.UPLOAD_MAX_ROWS ?? '200000', 10);
const BATCH_SIZE = parseInt(process.env.UPLOAD_BATCH_SIZE ?? '2000', 10);

export async function POST(req: Request) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Rate limit: 5 uploads/minute per user.
  const rl = checkRateLimit(`upload:${session.user.id}`, 5, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many uploads. Please wait a minute.' },
      { status: 429 },
    );
  }

  // Parse multipart form.
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: 'Invalid form data. Send multipart/form-data with a "file" field.' },
      { status: 400 },
    );
  }

  const file = formData.get('file');
  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { error: 'Missing "file" field in form data.' },
      { status: 400 },
    );
  }

  const customName = formData.get('name');
  const displayName =
    typeof customName === 'string' && customName.trim()
      ? customName.trim()
      : file.name.replace(/\.[^.]+$/, '');

  // Validate size.
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Limit: ${(MAX_FILE_BYTES / 1024 / 1024).toFixed(0)} MB.` },
      { status: 400 },
    );
  }

  // Validate type.
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (!ext || !['csv', 'xlsx', 'xls'].includes(ext)) {
    return NextResponse.json(
      { error: 'Unsupported file type. Upload .csv, .xlsx, or .xls.' },
      { status: 400 },
    );
  }

  // Parse file into { headers: string[], rows: string[][] }.
  let headers: string[];
  let rows: string[][];

  try {
    if (ext === 'csv') {
      const buf = await file.arrayBuffer();
      const text = decodeBuffer(buf);
      const parsed = Papa.parse<string[]>(text, { header: false });
      if (parsed.data.length === 0 || parsed.errors.length > 0) {
        const errMsg = parsed.errors[0]?.message ?? 'Empty CSV';
        return NextResponse.json({ error: `CSV parse error: ${errMsg}` }, { status: 400 });
      }
      headers = parsed.data[0] as string[];
      rows = parsed.data.slice(1) as string[][];
      // Filter out completely empty trailing rows.
      rows = rows.filter((r) => r.some((c) => c !== ''));
    } else {
      // Excel: read first sheet.
      const buf = await file.arrayBuffer();
      const workbook = XLSX.read(new Uint8Array(buf), { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) {
        return NextResponse.json({ error: 'Excel file has no sheets.' }, { status: 400 });
      }
      const sheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
      if (data.length === 0) {
        return NextResponse.json({ error: 'Empty Excel sheet.' }, { status: 400 });
      }
      // First row as headers, ensure all are strings.
      headers = (data[0] as unknown[]).map((h) => String(h ?? ''));
      rows = data.slice(1).map((r) =>
        (r as unknown[]).map((c) => String(c ?? '')),
      );
      rows = rows.filter((r) => r.some((c) => c !== ''));
    }
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to parse file: ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 },
    );
  }

  if (headers.length === 0) {
    return NextResponse.json({ error: 'No columns found in file.' }, { status: 400 });
  }
  if (rows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `Too many rows (${rows.length.toLocaleString()}). Limit: ${MAX_ROWS.toLocaleString()}.` },
      { status: 400 },
    );
  }

  // ── Step 0: Normalize full-width characters to half-width ──
  // Converts full-width digits/letters/punctuation to half-width.
  // This ensures semantic type detection correctly identifies
  // numbers/dates written with full-width characters.
  for (let ri = 0; ri < rows.length; ri++) {
    for (let ci = 0; ci < headers.length; ci++) {
      rows[ri][ci] = normalizeFullWidth(rows[ri][ci] ?? '');
    }
  }

  // ── Step 1: Pre-clean — count whitespace then trim every cell ──
  const whitespaceCounts: number[] = new Array(headers.length).fill(0);
  for (let ci = 0; ci < headers.length; ci++) {
    let count = 0;
    for (let ri = 0; ri < rows.length; ri++) {
      const raw = rows[ri][ci] ?? '';
      if (raw !== raw.trim()) count++;
      rows[ri][ci] = raw.trim();
    }
    whitespaceCounts[ci] = count;
  }

  // ── Step 2: Semantic type detection (on trimmed data) ──
  const columns = detectColumns(headers, rows);

  // Check for duplicate sanitized column names.
  const seen = new Set<string>();
  for (const col of columns) {
    if (seen.has(col.name)) {
      return NextResponse.json(
        { error: `Duplicate column "${col.displayName}" (sanitized: "${col.name}").` },
        { status: 400 },
      );
    }
    seen.add(col.name);
  }

  // ── Step 3: Full-scan quality analysis ──
  const qualityProfile: QualityProfile = analyzeQuality(
    headers,
    rows,
    columns,
    whitespaceCounts,
  );

  // Generate data source ID and table name.
  const dsId = crypto.randomUUID();
  const tableName = `ds_${dsId.replace(/-/g, '_')}`;

  // Build DDL: _row_id SERIAL PRIMARY KEY + all columns TEXT, double-quoted identifiers.
  // _row_id is an internal row identifier for UPDATE/DELETE targeting — it is NOT
  // exposed to the AI agent (not in schemaJson.columns).
  const colDefs = columns
    .map((c) => `"${c.name}" TEXT`)
    .join(', ');
  const createDdl = `CREATE TABLE ${UPLOAD_SCHEMA}."${tableName}" (_row_id SERIAL PRIMARY KEY, ${colDefs})`;

  // Build INSERT column list.
  const colNames = columns.map((c) => `"${c.name}"`).join(', ');

  // --- Transaction: CREATE TABLE + INSERT + metadata ---
  const adminUrl = process.env.DATABASE_URL;
  if (!adminUrl) {
    return NextResponse.json(
      { error: 'DATABASE_URL not configured.' },
      { status: 500 },
    );
  }
  const sql = neon(adminUrl);

  let rowCount = 0;

  // ── One-time setup (outside the data transaction) ──────────
  // Ensure userdata schema and read-only role exist.
  // These run before BEGIN so role DDL doesn't bloat the data transaction.
  await sql.query(`CREATE SCHEMA IF NOT EXISTS ${UPLOAD_SCHEMA}`);

  const [roleExists] = await sql.query(
    `SELECT EXISTS (SELECT FROM pg_roles WHERE rolname = 'userdata_readonly') AS exists`,
  );
  if (!(roleExists as { exists: boolean }).exists) {
    await sql.query(
      `CREATE ROLE userdata_readonly WITH LOGIN PASSWORD '${process.env.USERDATA_READONLY_PASSWORD ?? 'userdata_demo_pw'}'`,
    );
    await sql.query(`GRANT USAGE ON SCHEMA ${UPLOAD_SCHEMA} TO userdata_readonly`);
    await sql.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA ${UPLOAD_SCHEMA} GRANT SELECT ON TABLES TO userdata_readonly`,
    );
    await sql.query(`ALTER ROLE userdata_readonly SET statement_timeout = '5s'`);
  }

  try {
    await sql.query('BEGIN');

    await sql.query(createDdl);

    // Batch insert with NULL-like → real NULL conversion.
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const placeholders = batch.map((_r, bi) =>
        `(${columns.map((_c, ci) => {
          const v = (batch[bi][ci] ?? '').trim();
          if (NULL_LIKE_VALUES.has(v)) return 'NULL';
          return `'${v.replace(/'/g, "''")}'`;
        }).join(', ')})`,
      ).join(', ');

      await sql.query(
        `INSERT INTO ${UPLOAD_SCHEMA}."${tableName}" (${colNames}) VALUES ${placeholders}`,
      );
      rowCount += batch.length;
    }

    // Assemble schema_json from in-memory data (no information_schema round-trip).
    const discoveredTable: DiscoveredTable = {
      name: tableName,
      displayName,
      rowCount,
      columns,
    };
    const schemaJson: SchemaJson = {
      tables: [discoveredTable],
      relationships: [],
      qualityProfile,
    };

    const config: UploadConfig = {
      schemaName: UPLOAD_SCHEMA,
      tables: [{ name: tableName, displayName, rowCount }],
      originalFileName: file.name,
      fileSizeBytes: file.size,
    };

    // Insert metadata into data_sources.
    const db = getDb();
    await db.insert(schema.dataSources).values({
      id: dsId,
      userId: session.user.id,
      name: displayName,
      type: 'upload',
      config: config as unknown as Record<string, unknown>,
      schemaJson: schemaJson as unknown as Record<string, unknown>,
    });

    await sql.query('COMMIT');
  } catch (err) {
    await sql.query('ROLLBACK');
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Upload failed: ${message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    id: dsId,
    name: displayName,
    type: 'upload',
    tableName,
    rowCount,
    columns: columns.map((c) => ({
      name: c.name,
      displayName: c.displayName,
      semanticType: c.semanticType,
    })),
    quality: {
      nullConverted: Object.entries(qualityProfile.columns).reduce(
        (sum, [, cp]) => sum + cp.nullConvertedCount, 0,
      ),
      columnsWithIssues: qualityProfile.table.columnsWithIssues,
      duplicateRows: qualityProfile.table.duplicateRowCount,
    },
  });
}
