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
