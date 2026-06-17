/**
 * Unit tests for the SQL safety validator.
 *
 * These are the heart of the read-only guarantee: every category of unsafe
 * input must be rejected, and every legitimate analytical SELECT must pass.
 */

import { describe, it, expect } from 'vitest';
import { validateSql, MAX_ROWS } from '../src/lib/sql-validator';

describe('validateSql — accepts legitimate SELECTs', () => {
  const valid = [
    'SELECT COUNT(*) AS customer_count FROM customers',
    'SELECT * FROM orders WHERE status = \'completed\'',
    "SELECT DATE_TRUNC('month', order_date) AS m, SUM(total_amount) AS s FROM orders GROUP BY m ORDER BY m",
    "SELECT category_name, COUNT(*) FILTER (WHERE status = 'returned') AS returns FROM orders o JOIN order_items oi ON o.order_id = oi.order_id JOIN products p ON oi.product_id = p.product_id JOIN categories c ON p.category_id = c.category_id GROUP BY category_name",
    'SELECT p.product_name, SUM(oi.line_total) AS rev FROM products p JOIN order_items oi ON p.product_id = oi.product_id GROUP BY p.product_name ORDER BY rev DESC LIMIT 5',
    'WITH monthly AS (SELECT 1 AS n) SELECT * FROM monthly',
    'SELECT COUNT(DISTINCT customer_id) FROM orders',
  ];

  for (const sql of valid) {
    it(`accepts: ${sql.slice(0, 50)}`, () => {
      const result = validateSql(sql);
      expect(result.valid).toBe(true);
    });
  }
});

describe('validateSql — rejects write / DDL statements', () => {
  const dangerous = [
    'INSERT INTO customers (email) VALUES (\'x@y.com\')',
    'UPDATE products SET base_price = 0',
    'DELETE FROM orders',
    'DROP TABLE customers',
    'ALTER TABLE orders ADD COLUMN x INT',
    'TRUNCATE order_items',
    'CREATE TABLE evil (id INT)',
    'GRANT SELECT ON customers TO public',
  ];

  for (const sql of dangerous) {
    it(`rejects: ${sql.slice(0, 40)}`, () => {
      const result = validateSql(sql);
      expect(result.valid).toBe(false);
    });
  }
});

describe('validateSql — rejects injection tricks', () => {
  it('rejects stacked statements', () => {
    expect(validateSql('SELECT 1; DROP TABLE customers').valid).toBe(false);
  });

  it('rejects stacked statements even with a write second', () => {
    expect(
      validateSql('SELECT * FROM orders; DELETE FROM orders').valid,
    ).toBe(false);
  });

  it('rejects line comments', () => {
    expect(validateSql('SELECT * FROM orders -- WHERE 1=1').valid).toBe(false);
  });

  it('rejects block comments', () => {
    expect(validateSql('SELECT /* x */ * FROM orders').valid).toBe(false);
  });

  it('rejects SELECT INTO', () => {
    expect(
      validateSql('SELECT * INTO evil FROM customers').valid,
    ).toBe(false);
  });

  it('rejects pg_sleep', () => {
    expect(validateSql('SELECT pg_sleep(10)').valid).toBe(false);
  });

  it('rejects COPY', () => {
    expect(validateSql('COPY customers TO \'/tmp/x\'').valid).toBe(false);
  });

  it('rejects information_schema access', () => {
    expect(
      validateSql('SELECT * FROM information_schema.tables').valid,
    ).toBe(false);
  });

  it('rejects pg_catalog access', () => {
    expect(
      validateSql('SELECT * FROM pg_catalog.pg_roles').valid,
    ).toBe(false);
  });

  it('rejects empty input', () => {
    expect(validateSql('').valid).toBe(false);
    expect(validateSql('   ').valid).toBe(false);
  });
});

describe('validateSql — LIMIT capping', () => {
  it('appends LIMIT when missing', () => {
    const result = validateSql('SELECT * FROM customers');
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.sql).toMatch(new RegExp(`LIMIT ${MAX_ROWS}`, 'i'));
    }
  });

  it('clamps a LIMIT above the cap', () => {
    const result = validateSql('SELECT * FROM customers LIMIT 99999');
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.sql).toMatch(new RegExp(`LIMIT ${MAX_ROWS}`, 'i'));
      expect(result.sql).not.toMatch(/99999/);
    }
  });

  it('leaves a small LIMIT untouched', () => {
    const result = validateSql('SELECT * FROM customers LIMIT 5');
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.sql).toMatch(/LIMIT 5\b/i);
    }
  });

  it('strips a single trailing semicolon and still validates', () => {
    const result = validateSql('SELECT 1 AS n;');
    expect(result.valid).toBe(true);
  });
});

describe('validateSql — syntax errors', () => {
  it('flags invalid SQL with SYNTAX_ERROR code', () => {
    const result = validateSql('SELECT FROM WHERE');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe('SYNTAX_ERROR');
    }
  });
});

describe('validateSql — AST-level defense (not just regex)', () => {
  it('rejects UPDATE that contains no forbidden keyword pattern', () => {
    // "UPDATE ... SET x = x" trips no FORBIDDEN_PATTERN regex; only the AST
    // statement-type check (type !== "select") can catch it.
    const result = validateSql('UPDATE products SET base_price = base_price');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe('VALIDATION_ERROR');
  });

  it('accepts lowercase select', () => {
    expect(validateSql('select * from orders').valid).toBe(true);
  });

  it('accepts UNION of two selects', () => {
    expect(validateSql('SELECT 1 AS n UNION SELECT 2').valid).toBe(true);
  });

  it('accepts a LIMIT exactly at the cap', () => {
    const result = validateSql(`SELECT * FROM orders LIMIT ${MAX_ROWS}`);
    expect(result.valid).toBe(true);
  });
});

describe('validateSql — data-modifying CTE bypass (regression)', () => {
  // PostgreSQL allows writes inside a CTE; node-sql-parser still reports the
  // top-level statement as type "select", so the statement-type check alone
  // passes. These MUST be rejected — the core read-only guarantee.
  const writeCtes = [
    "WITH t AS (UPDATE orders SET status = 'x' RETURNING *) SELECT * FROM t",
    'WITH t AS (DELETE FROM orders RETURNING *) SELECT * FROM t',
    "WITH t AS (INSERT INTO orders (status) VALUES ('x') RETURNING *) SELECT * FROM t",
  ];

  for (const sql of writeCtes) {
    it(`rejects write CTE: ${sql.slice(0, 45)}`, () => {
      // The security contract is simply: this never reaches the database.
      // (UPDATE/INSERT are caught by the tableList operation check;
      // DELETE-in-CTE happens to be unparseable and is caught as a syntax
      // error. Both paths reject — that is what matters.)
      expect(validateSql(sql).valid).toBe(false);
    });
  }

  it('rejects an UPDATE CTE specifically via the operation check', () => {
    // Locks in the tableList fix: this query parses cleanly as a "select",
    // so only the per-operation check can reject it (VALIDATION_ERROR, not a
    // parser SYNTAX_ERROR).
    const result = validateSql(
      "WITH t AS (UPDATE orders SET status = 'x' RETURNING *) SELECT * FROM t",
    );
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe('VALIDATION_ERROR');
  });

  it('still accepts a legitimate read-only CTE', () => {
    const result = validateSql(
      'WITH monthly AS (SELECT 1 AS n) SELECT * FROM monthly',
    );
    expect(result.valid).toBe(true);
  });
});

describe('validateSql — string literals are not false-positives', () => {
  // The old `\binto\b` regex rejected any query whose text contained "into",
  // even inside a string literal. Write detection is now structural, so these
  // legitimate analytical queries must pass.
  it("accepts a literal containing the word 'into'", () => {
    expect(
      validateSql("SELECT * FROM products WHERE brand = 'A into B'").valid,
    ).toBe(true);
  });

  it('still rejects an actual SELECT INTO', () => {
    const result = validateSql('SELECT * INTO evil FROM customers');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe('VALIDATION_ERROR');
  });
});

describe('validateSql — LIMIT capping across shapes', () => {
  it('clamps LIMIT while preserving OFFSET', () => {
    const result = validateSql('SELECT * FROM customers LIMIT 99999 OFFSET 10');
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.sql).toMatch(new RegExp(`LIMIT ${MAX_ROWS}`, 'i'));
      expect(result.sql).toMatch(/OFFSET 10/i);
      expect(result.sql).not.toMatch(/99999/);
    }
  });

  it('leaves a small LIMIT with OFFSET untouched', () => {
    const result = validateSql('SELECT * FROM customers LIMIT 50 OFFSET 10');
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.sql).toMatch(/LIMIT 50/i);
      expect(result.sql).toMatch(/OFFSET 10/i);
    }
  });

  it('clamps the LIMIT on a UNION query', () => {
    const result = validateSql('SELECT 1 AS n UNION SELECT 2 LIMIT 99999');
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.sql).toMatch(new RegExp(`LIMIT ${MAX_ROWS}`, 'i'));
      expect(result.sql).not.toMatch(/99999/);
    }
  });

  it('appends a LIMIT to a UNION query that has none', () => {
    const result = validateSql('SELECT 1 AS n UNION SELECT 2');
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.sql).toMatch(new RegExp(`LIMIT ${MAX_ROWS}`, 'i'));
    }
  });
});
