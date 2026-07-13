import { describe, it, expect } from 'vitest';
import {
  escapeSqlValue,
  quoteIdent,
  validateTableName,
  validateColumnName,
  buildSearchClause,
  serializeRow,
  isNullLike,
  TableNotFoundError,
  ColumnNotFoundError,
} from '@/lib/data-sources/row-utils';
import type { DiscoveredColumn, DiscoveredTable, SchemaJson } from '@/lib/data-sources/types';

// ─── Helpers ──────────────────────────────────────────────────────

function makeTable(overrides: Partial<DiscoveredTable> = {}): DiscoveredTable {
  return {
    name: 'orders',
    displayName: 'orders.csv',
    rowCount: 100,
    columns: [
      {
        name: 'customer_name',
        displayName: 'Customer Name',
        type: 'TEXT',
        semanticType: 'TEXT',
        nullable: true,
        hint: null,
      },
      {
        name: 'amount',
        displayName: 'Amount',
        type: 'TEXT',
        semanticType: 'NUMERIC',
        nullable: true,
        hint: 'CAST(amount AS NUMERIC)',
      },
      {
        name: 'order_date',
        displayName: 'Order Date',
        type: 'TEXT',
        semanticType: 'DATE',
        nullable: true,
        hint: 'CAST(order_date AS DATE)',
      },
    ],
    ...overrides,
  };
}

function makeSchema(tables: DiscoveredTable[] = [makeTable()]): SchemaJson {
  return { tables, relationships: [] };
}

// ─── escapeSqlValue ───────────────────────────────────────────────

describe('escapeSqlValue', () => {
  it('returns the same string when no single quotes', () => {
    expect(escapeSqlValue('hello')).toBe('hello');
  });

  it('escapes single quotes by doubling them', () => {
    expect(escapeSqlValue("it's")).toBe("it''s");
  });

  it('escapes multiple single quotes', () => {
    expect(escapeSqlValue("it''s")).toBe("it''''s");
  });

  it('returns empty string unchanged', () => {
    expect(escapeSqlValue('')).toBe('');
  });

  it('handles strings with only quotes', () => {
    expect(escapeSqlValue("'")).toBe("''");
  });
});

// ─── quoteIdent ───────────────────────────────────────────────────

describe('quoteIdent', () => {
  it('wraps a plain name in double quotes', () => {
    expect(quoteIdent('orders')).toBe('"orders"');
  });

  it('handles names with underscores', () => {
    expect(quoteIdent('customer_name')).toBe('"customer_name"');
  });

  it('handles names with digits', () => {
    expect(quoteIdent('col2')).toBe('"col2"');
  });
});

// ─── validateTableName ────────────────────────────────────────────

describe('validateTableName', () => {
  const schema = makeSchema();

  it('returns the table when found', () => {
    const table = validateTableName(schema, 'orders');
    expect(table.name).toBe('orders');
    expect(table.columns).toHaveLength(3);
  });

  it('throws TableNotFoundError when table not in schema', () => {
    expect(() => validateTableName(schema, 'nonexistent')).toThrow(TableNotFoundError);
  });

  it('throws with descriptive message for missing table', () => {
    expect(() => validateTableName(schema, 'ghost')).toThrow(
      'Table "ghost" not found in data source schema.',
    );
  });

  it('works with multiple tables in schema', () => {
    const multiSchema = makeSchema([
      makeTable({ name: 'orders' }),
      makeTable({ name: 'products', displayName: 'products.csv' }),
    ]);
    expect(validateTableName(multiSchema, 'products').displayName).toBe('products.csv');
  });
});

// ─── validateColumnName ───────────────────────────────────────────

describe('validateColumnName', () => {
  const table = makeTable();

  it('does not throw when column exists', () => {
    expect(() => validateColumnName(table, 'amount')).not.toThrow();
  });

  it('throws ColumnNotFoundError when column missing', () => {
    expect(() => validateColumnName(table, 'missing_col')).toThrow(ColumnNotFoundError);
  });

  it('throws with descriptive message including column and table name', () => {
    expect(() => validateColumnName(table, 'price')).toThrow(
      'Column "price" not found in table "orders".',
    );
  });
});

// ─── buildSearchClause ────────────────────────────────────────────

describe('buildSearchClause', () => {
  const columns: DiscoveredColumn[] = [
    { name: 'name', displayName: 'Name', type: 'TEXT', semanticType: 'TEXT', nullable: true, hint: null },
    { name: 'city', displayName: 'City', type: 'TEXT', semanticType: 'TEXT', nullable: true, hint: null },
  ];

  it('returns empty string when search is empty', () => {
    expect(buildSearchClause(columns, '')).toBe('');
  });

  it('returns empty string when search is only whitespace', () => {
    expect(buildSearchClause(columns, '   ')).toBe('');
  });

  it('builds an ILIKE clause across all columns', () => {
    const clause = buildSearchClause(columns, 'Beijing');
    expect(clause).toContain('WHERE');
    expect(clause).toContain('"name" ILIKE');
    expect(clause).toContain('"city" ILIKE');
    expect(clause).toContain('%Beijing%');
    expect(clause).toContain(' OR ');
  });

  it('escapes single quotes in search term', () => {
    const clause = buildSearchClause(columns, "it's");
    expect(clause).toContain("%it''s%");
  });

  it('trims whitespace from search', () => {
    const clause = buildSearchClause(columns, '  Tokyo  ');
    expect(clause).toContain('%Tokyo%');
    expect(clause).not.toContain('  ');
  });
});

// ─── serializeRow ─────────────────────────────────────────────────

describe('serializeRow', () => {
  it('converts null to null (JS null)', () => {
    const row = { name: null, city: 'Paris' };
    const result = serializeRow(row as Record<string, unknown>);
    expect(result.name).toBeNull();
    expect(result.city).toBe('Paris');
  });

  it('converts non-string values to strings', () => {
    const row = { count: 42, flag: true, price: 3.14 };
    const result = serializeRow(row as Record<string, unknown>);
    expect(result.count).toBe('42');
    expect(result.flag).toBe('true');
    expect(result.price).toBe('3.14');
  });

  it('preserves string values as-is', () => {
    const row = { name: 'Alice', city: 'Paris' };
    const result = serializeRow(row as Record<string, unknown>);
    expect(result.name).toBe('Alice');
    expect(result.city).toBe('Paris');
  });

  it('preserves empty string values', () => {
    const row = { name: '' };
    const result = serializeRow(row as Record<string, unknown>);
    expect(result.name).toBe('');
  });
});

// ─── isNullLike ───────────────────────────────────────────────────

describe('isNullLike', () => {
  it('returns true for "null" and "NULL"', () => {
    expect(isNullLike('null')).toBe(true);
    expect(isNullLike('NULL')).toBe(true);
    expect(isNullLike('Null')).toBe(true);
  });

  it('returns true for "N/A" and variants', () => {
    expect(isNullLike('N/A')).toBe(true);
    expect(isNullLike('n/a')).toBe(true);
    expect(isNullLike('NA')).toBe(true);
  });

  it('returns true for "nil" and "None"', () => {
    expect(isNullLike('nil')).toBe(true);
    expect(isNullLike('None')).toBe(true);
  });

  it('returns true for dash characters', () => {
    expect(isNullLike('—')).toBe(true);
    expect(isNullLike('–')).toBe(true);
  });

  it('returns true for Chinese null markers', () => {
    expect(isNullLike('无')).toBe(true);
    expect(isNullLike('暂无')).toBe(true);
  });

  it('returns false for meaningful values', () => {
    expect(isNullLike('hello')).toBe(false);
    expect(isNullLike('0')).toBe(false);
    expect(isNullLike('false')).toBe(false);
  });

  it('returns false for empty string (it is in the set)', () => {
    // Empty string IS in NULL_LIKE_VALUES, so it returns true.
    expect(isNullLike('')).toBe(true);
  });
});

// ─── Error classes ────────────────────────────────────────────────

describe('TableNotFoundError', () => {
  it('is an instance of Error', () => {
    expect(new TableNotFoundError('foo')).toBeInstanceOf(Error);
  });

  it('has correct name', () => {
    const e = new TableNotFoundError('foo');
    expect(e.name).toBe('TableNotFoundError');
  });

  it('includes table name in message', () => {
    const e = new TableNotFoundError('ghost_table');
    expect(e.message).toContain('ghost_table');
  });
});

describe('ColumnNotFoundError', () => {
  it('is an instance of Error', () => {
    expect(new ColumnNotFoundError('col', 'tbl')).toBeInstanceOf(Error);
  });

  it('has correct name', () => {
    const e = new ColumnNotFoundError('col', 'tbl');
    expect(e.name).toBe('ColumnNotFoundError');
  });

  it('includes column and table in message', () => {
    const e = new ColumnNotFoundError('price', 'orders');
    expect(e.message).toContain('price');
    expect(e.message).toContain('orders');
  });
});
