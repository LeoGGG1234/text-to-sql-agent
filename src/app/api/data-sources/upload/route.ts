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
 * Limits: 80 MB, 50k rows, 5 req/min per user. The file limit is configurable;
 * the row limit can be configured downward from the interactive hard cap.
 */

import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth-helpers';
import { detectColumns, normalizeFullWidth } from '@/lib/data-sources/type-detector';
import type { DiscoveredTable, SchemaJson, UploadConfig, QualityProfile } from '@/lib/data-sources/types';
import {
  analyzeQuality,
  countStoredWhitespaceByColumn,
} from '@/lib/data-sources/quality-analyzer';
import { USERDATA_SCHEMA } from '@/lib/data-sources/userdata-security';
import { checkRateLimit } from '@/lib/rate-limit';
import { parseCsvTable } from '@/lib/data-sources/csv-parser';
import { parseXlsxTable } from '@/lib/data-sources/excel-parser';
import { withDatabaseTransaction } from '@/lib/database-transaction';
import { getUploadLimits } from '@/lib/data-sources/upload-limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120; // 2 min — Vercel Pro supports up to 300s

const UPLOAD_SCHEMA = USERDATA_SCHEMA;

export async function POST(req: Request) {
  const { maxFileBytes, maxRows, batchSize } = getUploadLimits();
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.USERDATA_DATABASE_URL) {
    return NextResponse.json(
      { error: 'User-data querying is not configured.' },
      { status: 503 },
    );
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
  if (file.size > maxFileBytes) {
    return NextResponse.json(
      { error: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Limit: ${(maxFileBytes / 1024 / 1024).toFixed(0)} MB.` },
      { status: 400 },
    );
  }

  // Validate type.
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'xls') {
    return NextResponse.json(
      { error: 'Legacy .xls files are not supported. Save the file as .xlsx or CSV and try again.' },
      { status: 400 },
    );
  }
  if (!ext || !['csv', 'xlsx'].includes(ext)) {
    return NextResponse.json(
      { error: 'Unsupported file type. Upload .csv or .xlsx.' },
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
      const parsed = parseCsvTable(text);
      if (!parsed.ok) {
        return NextResponse.json(
          { error: `CSV parse error: ${parsed.error}` },
          { status: 400 },
        );
      }
      headers = parsed.headers;
      rows = parsed.rows;
    } else {
      const buf = await file.arrayBuffer();
      const parsed = await parseXlsxTable(Buffer.from(buf));
      if (!parsed.ok) {
        return NextResponse.json(
          { error: `Excel parse error: ${parsed.error}` },
          { status: 400 },
        );
      }
      headers = parsed.headers;
      rows = parsed.rows;
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
  if (rows.length > maxRows) {
    return NextResponse.json(
      { error: `Too many rows (${rows.length.toLocaleString()}). Limit: ${maxRows.toLocaleString()}.` },
      { status: 400 },
    );
  }

  // Preserve parsed cell text exactly for storage and profiling. A normalized
  // copy is used only to infer semantic intent; user-visible transformations
  // belong to an explicit cleaning recipe and preview.
  const whitespaceCounts = countStoredWhitespaceByColumn(rows, headers.length);
  const inferenceRows = rows.map((row) =>
    headers.map((_header, columnIndex) =>
      normalizeFullWidth(row[columnIndex] ?? '').trim(),
    ),
  );

  // ── Step 1: Semantic type detection (non-persistent normalized view) ──
  const columns = detectColumns(headers, inferenceRows);

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

  // ── Step 2: Full-scan quality analysis of the stored values ──
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
  let rowCount = 0;

  try {
    await withDatabaseTransaction(adminUrl, async (client) => {
      await client.query(createDdl);

      // Keep each statement below PostgreSQL's 65,535 parameter limit.
      const effectiveBatchSize = Math.max(
        1,
        Math.min(batchSize, Math.floor(60_000 / columns.length)),
      );

      for (let i = 0; i < rows.length; i += effectiveBatchSize) {
        const batch = rows.slice(i, i + effectiveBatchSize);
        const values: Array<string | null> = [];
        const placeholders = batch.map((row) => {
          const tuple = columns.map((_column, columnIndex) => {
            values.push(row[columnIndex] ?? '');
            return `$${values.length}`;
          });
          return `(${tuple.join(', ')})`;
        });

        await client.query(
          `INSERT INTO ${UPLOAD_SCHEMA}."${tableName}" (${colNames}) VALUES ${placeholders.join(', ')}`,
          values,
        );
        rowCount += batch.length;
      }

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

      await client.query(
        `INSERT INTO data_sources (id, user_id, name, type, config, schema_json)
         VALUES ($1, $2, $3, 'upload', $4::jsonb, $5::jsonb)`,
        [
          dsId,
          session.user.id,
          displayName,
          JSON.stringify(config),
          JSON.stringify(schemaJson),
        ],
      );
    });
  } catch (err) {
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
      databaseNulls: Object.values(qualityProfile.columns).reduce(
        (sum, profile) => sum + (profile.databaseNullCount ?? 0), 0,
      ),
      nullMarkers: Object.values(qualityProfile.columns).reduce(
        (sum, profile) => sum + (profile.nullMarkerCount ?? 0), 0,
      ),
      columnsWithIssues: qualityProfile.table.columnsWithIssues,
      duplicateRows: qualityProfile.table.duplicateRowCount,
    },
  });
}
