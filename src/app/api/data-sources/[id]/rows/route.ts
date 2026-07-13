/**
 * GET    /api/data-sources/[id]/rows  — paginated row listing with sort & search
 * PUT    /api/data-sources/[id]/rows  — update a single cell
 * DELETE /api/data-sources/[id]/rows  — delete rows by _row_id
 * POST   /api/data-sources/[id]/rows  — insert a new row
 */

import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getDb } from '@/db';
import * as schema from '@/db/schema';
import { getSession } from '@/lib/auth-helpers';
import { eq, and } from 'drizzle-orm';
import {
  validateTableName,
  validateColumnName,
  buildSearchClause,
  escapeSqlValue,
  quoteIdent,
  serializeRow,
} from '@/lib/data-sources/row-utils';
import type { SchemaJson, DiscoveredTable, DiscoveredColumn } from '@/lib/data-sources/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_PAGE_SIZE = 200;
const MAX_DELETE_IDS = 200;

// ─── Helpers ───────────────────────────────────────────────────

/** Fetch data source metadata + verify ownership. Returns { row, schemaJson }. */
async function fetchAndVerify(
  req: Request,
  dsId: string,
): Promise<{
  type: string;
  config: Record<string, unknown>;
  schemaJson: SchemaJson;
  userId: string;
}> {
  const session = await getSession(req);
  if (!session) {
    throw new AuthError();
  }

  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.dataSources)
    .where(
      and(
        eq(schema.dataSources.id, dsId),
        eq(schema.dataSources.userId, session.user.id),
      ),
    )
    .limit(1);

  if (!row) {
    throw new NotFoundError();
  }

  const rawSchema = row.schemaJson as { tables?: unknown; relationships?: unknown } | null | undefined;
  const schemaJson: SchemaJson = (rawSchema?.tables && Array.isArray(rawSchema.tables))
    ? rawSchema as unknown as SchemaJson
    : { tables: [], relationships: [] };

  return {
    type: row.type as string,
    config: row.config as Record<string, unknown>,
    schemaJson,
    userId: session.user.id,
  };
}

// ─── GET: Paginated rows ───────────────────────────────────────

async function handleGet(
  req: Request,
  dsId: string,
  tableName: string,
  page: number,
  pageSize: number,
  sort: string | null,
  order: string,
  q: string | null,
) {
  const { schemaJson } = await fetchAndVerify(req, dsId);
  const table = validateTableName(schemaJson, tableName);

  // Validate sort column.
  if (sort && sort !== '_row_id') {
    validateColumnName(table, sort);
  }
  // Only allow _row_id as a valid internal column for sorting.
  const validSorts = new Set(table.columns.map((c) => c.name));
  validSorts.add('_row_id');
  if (sort && !validSorts.has(sort)) {
    return NextResponse.json(
      { error: `Invalid sort column: "${sort}".` },
      { status: 400 },
    );
  }

  if (order !== 'asc' && order !== 'desc') {
    return NextResponse.json(
      { error: `Invalid order "${order}". Must be "asc" or "desc".` },
      { status: 400 },
    );
  }

  const readUrl = process.env.USERDATA_DATABASE_URL;
  if (!readUrl) {
    return NextResponse.json(
      { error: 'USERDATA_DATABASE_URL not configured.' },
      { status: 500 },
    );
  }
  const sql = neon(readUrl);

  const offset = (page - 1) * pageSize;
  const searchClause = q ? buildSearchClause(table.columns, q) : '';
  const orderBy = sort
    ? `ORDER BY ${quoteIdent(sort)} ${order} NULLS LAST`
    : 'ORDER BY _row_id ASC';

  // Column list: _row_id + all user columns.
  const colList = ['_row_id', ...table.columns.map((c) => quoteIdent(c.name))].join(', ');

  // Count query.
  const [countRow] = await sql.query(
    `SELECT COUNT(*) AS cnt FROM userdata.${quoteIdent(tableName)} ${searchClause}`,
  );
  const total = Number((countRow as { cnt: string }).cnt);

  // Data query.
  const rows = await sql.query(
    `SELECT ${colList} FROM userdata.${quoteIdent(tableName)} ${searchClause} ${orderBy} LIMIT ${pageSize} OFFSET ${offset}`,
  );

  return NextResponse.json({
    rows: (rows as Record<string, unknown>[]).map(serializeRow),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    columns: table.columns.map((c) => ({
      name: c.name,
      displayName: c.displayName,
      semanticType: c.semanticType,
    })),
    tableName: table.name,
    tableDisplayName: table.displayName,
  });
}

// ─── PUT: Update a single cell ──────────────────────────────────

async function handlePut(
  req: Request,
  dsId: string,
  tableName: string,
  rowId: number,
  column: string,
  value: string,
) {
  const { schemaJson } = await fetchAndVerify(req, dsId);
  const table = validateTableName(schemaJson, tableName);
  validateColumnName(table, column);

  const adminUrl = process.env.DATABASE_URL;
  if (!adminUrl) {
    return NextResponse.json(
      { error: 'DATABASE_URL not configured.' },
      { status: 500 },
    );
  }
  const sql = neon(adminUrl);

  await sql.query(
    `UPDATE userdata.${quoteIdent(tableName)} SET ${quoteIdent(column)} = '${escapeSqlValue(value)}' WHERE _row_id = ${rowId}`,
  );

  return NextResponse.json({ success: true });
}

// ─── DELETE: Delete rows by _row_id ────────────────────────────

async function handleDelete(
  req: Request,
  dsId: string,
  tableName: string,
  rowIds: number[],
) {
  const { schemaJson } = await fetchAndVerify(req, dsId);
  validateTableName(schemaJson, tableName);

  if (rowIds.length > MAX_DELETE_IDS) {
    return NextResponse.json(
      { error: `Too many rows (${rowIds.length}). Max: ${MAX_DELETE_IDS}.` },
      { status: 400 },
    );
  }

  const adminUrl = process.env.DATABASE_URL;
  if (!adminUrl) {
    return NextResponse.json(
      { error: 'DATABASE_URL not configured.' },
      { status: 500 },
    );
  }
  const sql = neon(adminUrl);

  const idList = rowIds.map(Number).join(', ');
  const result = await sql.query(
    `DELETE FROM userdata.${quoteIdent(tableName)} WHERE _row_id IN (${idList})`,
  );
  // Neon HTTP driver returns the result; extract affected row count.
  const deleted = (result as { rowCount?: number }).rowCount ?? rowIds.length;

  return NextResponse.json({ success: true, deleted });
}

// ─── POST: Insert a new row ────────────────────────────────────

async function handlePost(
  req: Request,
  dsId: string,
  tableName: string,
  values: Record<string, string> | undefined,
) {
  const { schemaJson } = await fetchAndVerify(req, dsId);
  const table = validateTableName(schemaJson, tableName);

  // Validate all provided column names.
  if (values) {
    for (const colName of Object.keys(values)) {
      validateColumnName(table, colName);
    }
  }

  const adminUrl = process.env.DATABASE_URL;
  if (!adminUrl) {
    return NextResponse.json(
      { error: 'DATABASE_URL not configured.' },
      { status: 500 },
    );
  }
  const sql = neon(adminUrl);

  let insertSql: string;
  if (values && Object.keys(values).length > 0) {
    const cols = Object.keys(values).map((c) => quoteIdent(c)).join(', ');
    const vals = Object.values(values)
      .map((v) => `'${escapeSqlValue(v)}'`)
      .join(', ');
    insertSql = `INSERT INTO userdata.${quoteIdent(tableName)} (${cols}) VALUES (${vals}) RETURNING _row_id`;
  } else {
    // Insert a blank row (all NULLs except _row_id).
    insertSql = `INSERT INTO userdata.${quoteIdent(tableName)} DEFAULT VALUES RETURNING _row_id`;
  }

  const [result] = await sql.query(insertSql);
  const newRowId = (result as { _row_id: number })._row_id;

  // Fetch the full row.
  const colList = ['_row_id', ...table.columns.map((c) => quoteIdent(c.name))].join(', ');
  const [row] = await sql.query(
    `SELECT ${colList} FROM userdata.${quoteIdent(tableName)} WHERE _row_id = ${newRowId}`,
  );

  return NextResponse.json({
    success: true,
    rowId: newRowId,
    row: serializeRow(row as Record<string, unknown>),
  });
}

// ─── Route handler ─────────────────────────────────────────────

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(req.url);
  const tableName = url.searchParams.get('table');
  if (!tableName) {
    return NextResponse.json(
      { error: 'Missing "table" query parameter.' },
      { status: 400 },
    );
  }
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, parseInt(url.searchParams.get('pageSize') ?? '50', 10) || 50),
  );
  const sort = url.searchParams.get('sort') || null;
  const order = url.searchParams.get('order') === 'desc' ? 'desc' : 'asc';
  const q = url.searchParams.get('q') || null;

  try {
    return await handleGet(req, id, tableName, page, pageSize, sort, order, q);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (err instanceof TableNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Failed to fetch rows: ${message}` }, { status: 500 });
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body.' },
      { status: 400 },
    );
  }

  const tableName = body.table as string | undefined;
  const rowId = Number(body.rowId);
  const column = body.column as string | undefined;
  const value = body.value as string | undefined;

  if (!tableName || !column || value === undefined || isNaN(rowId)) {
    return NextResponse.json(
      { error: 'Missing required fields: table, rowId (number), column, value.' },
      { status: 400 },
    );
  }

  try {
    return await handlePut(req, id, tableName, rowId, column, value);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (err instanceof TableNotFoundError || err instanceof ColumnNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Failed to update cell: ${message}` }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body.' },
      { status: 400 },
    );
  }

  const tableName = body.table as string | undefined;
  const rowIds = body.rowIds as number[] | undefined;

  if (!tableName || !rowIds || !Array.isArray(rowIds) || rowIds.length === 0) {
    return NextResponse.json(
      { error: 'Missing required fields: table, rowIds (number[], min 1).' },
      { status: 400 },
    );
  }

  try {
    return await handleDelete(req, id, tableName, rowIds);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (err instanceof TableNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Failed to delete rows: ${message}` }, { status: 500 });
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body.' },
      { status: 400 },
    );
  }

  const tableName = body.table as string | undefined;
  const values = body.values as Record<string, string> | undefined;

  if (!tableName) {
    return NextResponse.json(
      { error: 'Missing required field: table.' },
      { status: 400 },
    );
  }

  try {
    return await handlePost(req, id, tableName, values);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (err instanceof TableNotFoundError || err instanceof ColumnNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Failed to insert row: ${message}` }, { status: 500 });
  }
}

// ─── Error classes ─────────────────────────────────────────────

class AuthError extends Error {
  constructor() { super('Unauthorized'); this.name = 'AuthError'; }
}
class NotFoundError extends Error {
  constructor() { super('Not found'); this.name = 'NotFoundError'; }
}
class TableNotFoundError extends Error {
  constructor(table: string) {
    super(`Table "${table}" not found in data source schema.`);
    this.name = 'TableNotFoundError';
  }
}
class ColumnNotFoundError extends Error {
  constructor(column: string, table: string) {
    super(`Column "${column}" not found in table "${table}".`);
    this.name = 'ColumnNotFoundError';
  }
}
