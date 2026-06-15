/**
 * Seed the retail_sales demo database.
 *
 * Usage:
 *   RETAIL_ADMIN_DATABASE_URL=postgresql://...  npx tsx scripts/seed-retail-db.ts
 *
 * What it does (idempotent — safe to re-run):
 *   1. DROP + CREATE the 6 tables (DDL).
 *   2. Insert ~500 customers, 10 categories, 10 regions, 200 products,
 *      ~5,000 orders, ~20,000 order_items using deterministic faker data.
 *   3. Create (or update) the `retail_readonly` role with SELECT-only grants,
 *      so the app runtime can never write to this database.
 *
 * The admin connection (RETAIL_ADMIN_DATABASE_URL) is only used here.
 * At runtime the app connects with RETAIL_DATABASE_URL (read-only role).
 *
 * Keep the column set in sync with src/lib/schema-description.ts.
 */

import { neon } from '@neondatabase/serverless';
import { faker } from '@faker-js/faker';

// Deterministic data across runs.
faker.seed(20260615);

const ADMIN_URL = process.env.RETAIL_ADMIN_DATABASE_URL;
if (!ADMIN_URL) {
  console.error(
    '❌ RETAIL_ADMIN_DATABASE_URL is required (admin connection used for seeding).',
  );
  process.exit(1);
}

// Read-only role credentials (the password is set/reset here).
const READONLY_USER = 'retail_readonly';
const READONLY_PASSWORD =
  process.env.RETAIL_READONLY_PASSWORD ?? 'readonly_demo_pw_change_me';

const sql = neon(ADMIN_URL);

// ─── Reference data ────────────────────────────────────────────

const CATEGORIES = [
  { id: 1, name: 'Electronics', parent: null },
  { id: 2, name: 'Clothing', parent: null },
  { id: 3, name: 'Home & Kitchen', parent: null },
  { id: 4, name: 'Books', parent: null },
  { id: 5, name: 'Sports & Outdoors', parent: null },
  { id: 6, name: 'Smartphones', parent: 1 },
  { id: 7, name: 'Laptops', parent: 1 },
  { id: 8, name: "Men's Clothing", parent: 2 },
  { id: 9, name: "Women's Clothing", parent: 2 },
  { id: 10, name: 'Cookware', parent: 3 },
];

const REGIONS = [
  { id: 1, name: 'East China', country: 'China' },
  { id: 2, name: 'North China', country: 'China' },
  { id: 3, name: 'South China', country: 'China' },
  { id: 4, name: 'West China', country: 'China' },
  { id: 5, name: 'North America', country: 'USA' },
  { id: 6, name: 'Western Europe', country: 'Germany' },
  { id: 7, name: 'Northern Europe', country: 'UK' },
  { id: 8, name: 'Southeast Asia', country: 'Singapore' },
  { id: 9, name: 'Japan', country: 'Japan' },
  { id: 10, name: 'Oceania', country: 'Australia' },
];

const LOYALTY_TIERS = ['Bronze', 'Silver', 'Gold', 'Platinum'];
const ORDER_STATUSES = ['completed', 'completed', 'completed', 'completed', 'cancelled', 'returned'];

// Price ranges per top-level category (id → [min, max]).
const PRICE_RANGES: Record<number, [number, number]> = {
  1: [100, 2000], // Electronics
  2: [20, 200], // Clothing
  3: [10, 500], // Home & Kitchen
  4: [8, 60], // Books
  5: [15, 400], // Sports
  6: [300, 1500], // Smartphones
  7: [500, 2500], // Laptops
  8: [20, 180], // Men's
  9: [20, 220], // Women's
  10: [25, 300], // Cookware
};

// ─── Helpers ───────────────────────────────────────────────────

function money(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Insert rows in batches to keep each SQL statement a reasonable size. */
async function insertBatched<T>(
  label: string,
  rows: T[],
  batchSize: number,
  buildValues: (batch: T[]) => { text: string; params: unknown[] },
) {
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { text, params } = buildValues(batch);
    await sql.query(text, params);
  }
  console.log(`  ✓ ${label}: ${rows.length} rows`);
}

// ─── DDL ───────────────────────────────────────────────────────

async function createTables() {
  console.log('▸ Dropping and recreating tables...');
  // Drop in dependency order.
  await sql.query('DROP TABLE IF EXISTS order_items CASCADE');
  await sql.query('DROP TABLE IF EXISTS orders CASCADE');
  await sql.query('DROP TABLE IF EXISTS products CASCADE');
  await sql.query('DROP TABLE IF EXISTS categories CASCADE');
  await sql.query('DROP TABLE IF EXISTS regions CASCADE');
  await sql.query('DROP TABLE IF EXISTS customers CASCADE');

  await sql.query(`
    CREATE TABLE customers (
      customer_id   UUID PRIMARY KEY,
      email         VARCHAR(255) UNIQUE NOT NULL,
      first_name    VARCHAR(100) NOT NULL,
      last_name     VARCHAR(100) NOT NULL,
      city          VARCHAR(100) NOT NULL,
      state         VARCHAR(100),
      country       VARCHAR(100) NOT NULL,
      signup_date   DATE NOT NULL,
      loyalty_tier  VARCHAR(20) NOT NULL
    )`);

  await sql.query(`
    CREATE TABLE categories (
      category_id        INT PRIMARY KEY,
      category_name      VARCHAR(100) NOT NULL,
      parent_category_id INT REFERENCES categories(category_id)
    )`);

  await sql.query(`
    CREATE TABLE regions (
      region_id   INT PRIMARY KEY,
      region_name VARCHAR(100) NOT NULL,
      country     VARCHAR(100) NOT NULL
    )`);

  await sql.query(`
    CREATE TABLE products (
      product_id   UUID PRIMARY KEY,
      product_name VARCHAR(200) NOT NULL,
      category_id  INT NOT NULL REFERENCES categories(category_id),
      base_price   NUMERIC(10,2) NOT NULL,
      cost         NUMERIC(10,2) NOT NULL,
      brand        VARCHAR(100) NOT NULL,
      rating       NUMERIC(3,2)
    )`);

  await sql.query(`
    CREATE TABLE orders (
      order_id     UUID PRIMARY KEY,
      customer_id  UUID NOT NULL REFERENCES customers(customer_id),
      region_id    INT NOT NULL REFERENCES regions(region_id),
      order_date   TIMESTAMP NOT NULL,
      status       VARCHAR(20) NOT NULL,
      total_amount NUMERIC(12,2) NOT NULL
    )`);

  await sql.query(`
    CREATE TABLE order_items (
      item_id      UUID PRIMARY KEY,
      order_id     UUID NOT NULL REFERENCES orders(order_id),
      product_id   UUID NOT NULL REFERENCES products(product_id),
      quantity     INT NOT NULL,
      unit_price   NUMERIC(10,2) NOT NULL,
      discount_pct NUMERIC(5,2) NOT NULL,
      line_total   NUMERIC(12,2) NOT NULL
    )`);

  // Helpful indexes for the analytical queries the agent will run.
  await sql.query('CREATE INDEX idx_orders_date ON orders(order_date)');
  await sql.query('CREATE INDEX idx_orders_customer ON orders(customer_id)');
  await sql.query('CREATE INDEX idx_orders_region ON orders(region_id)');
  await sql.query('CREATE INDEX idx_items_order ON order_items(order_id)');
  await sql.query('CREATE INDEX idx_items_product ON order_items(product_id)');
  await sql.query('CREATE INDEX idx_products_category ON products(category_id)');

  console.log('  ✓ 6 tables + indexes created');
}

// ─── Data generation ───────────────────────────────────────────

interface Customer {
  id: string;
  email: string;
  first: string;
  last: string;
  city: string;
  state: string;
  country: string;
  signup: string;
  tier: string;
}
interface Product {
  id: string;
  name: string;
  categoryId: number;
  basePrice: number;
  cost: number;
  brand: string;
  rating: number | null;
}

async function seedReference() {
  console.log('▸ Seeding reference data...');
  // Categories must be inserted parents-first (FK self-reference).
  for (const c of CATEGORIES) {
    await sql.query(
      'INSERT INTO categories (category_id, category_name, parent_category_id) VALUES ($1, $2, $3)',
      [c.id, c.name, c.parent],
    );
  }
  console.log(`  ✓ categories: ${CATEGORIES.length} rows`);

  for (const r of REGIONS) {
    await sql.query(
      'INSERT INTO regions (region_id, region_name, country) VALUES ($1, $2, $3)',
      [r.id, r.name, r.country],
    );
  }
  console.log(`  ✓ regions: ${REGIONS.length} rows`);
}

function genCustomers(n: number): Customer[] {
  const out: Customer[] = [];
  for (let i = 0; i < n; i++) {
    const first = faker.person.firstName();
    const last = faker.person.lastName();
    out.push({
      id: faker.string.uuid(),
      email: faker.internet.email({ firstName: first, lastName: last + i }).toLowerCase(),
      first,
      last,
      city: faker.location.city(),
      state: faker.location.state(),
      country: faker.location.country(),
      signup: faker.date
        .between({ from: '2024-06-01', to: '2026-05-01' })
        .toISOString()
        .slice(0, 10),
      tier: faker.helpers.arrayElement(LOYALTY_TIERS),
    });
  }
  return out;
}

function genProducts(n: number): Product[] {
  const out: Product[] = [];
  for (let i = 0; i < n; i++) {
    const categoryId = faker.helpers.arrayElement(CATEGORIES).id;
    const [min, max] = PRICE_RANGES[categoryId] ?? [10, 500];
    const basePrice = money(faker.number.float({ min, max }));
    const cost = money(basePrice * faker.number.float({ min: 0.4, max: 0.75 }));
    out.push({
      id: faker.string.uuid(),
      name: faker.commerce.productName(),
      categoryId,
      basePrice,
      cost,
      brand: faker.company.name(),
      rating: faker.datatype.boolean(0.85)
        ? money(faker.number.float({ min: 2.5, max: 5 }))
        : null,
    });
  }
  return out;
}

async function seedCustomers(customers: Customer[]) {
  await insertBatched('customers', customers, 100, (batch) => {
    const params: unknown[] = [];
    const tuples = batch.map((c, i) => {
      const b = i * 9;
      params.push(c.id, c.email, c.first, c.last, c.city, c.state, c.country, c.signup, c.tier);
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9})`;
    });
    return {
      text: `INSERT INTO customers (customer_id,email,first_name,last_name,city,state,country,signup_date,loyalty_tier) VALUES ${tuples.join(',')}`,
      params,
    };
  });
}

async function seedProducts(products: Product[]) {
  await insertBatched('products', products, 100, (batch) => {
    const params: unknown[] = [];
    const tuples = batch.map((p, i) => {
      const b = i * 7;
      params.push(p.id, p.name, p.categoryId, p.basePrice, p.cost, p.brand, p.rating);
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`;
    });
    return {
      text: `INSERT INTO products (product_id,product_name,category_id,base_price,cost,brand,rating) VALUES ${tuples.join(',')}`,
      params,
    };
  });
}

async function seedOrders(customers: Customer[], products: Product[], orderCount: number) {
  interface Order {
    id: string;
    customerId: string;
    regionId: number;
    date: string;
    status: string;
    total: number;
  }
  interface Item {
    id: string;
    orderId: string;
    productId: string;
    qty: number;
    unitPrice: number;
    discount: number;
    lineTotal: number;
  }

  const orders: Order[] = [];
  const items: Item[] = [];

  for (let i = 0; i < orderCount; i++) {
    const orderId = faker.string.uuid();
    const customer = faker.helpers.arrayElement(customers);
    const regionId = faker.helpers.arrayElement(REGIONS).id;
    const date = faker.date.between({ from: '2025-01-01', to: '2026-06-15' });
    const status = faker.helpers.arrayElement(ORDER_STATUSES);

    // 1-5 line items per order.
    const lineCount = faker.number.int({ min: 1, max: 5 });
    let orderTotal = 0;
    for (let j = 0; j < lineCount; j++) {
      const product = faker.helpers.arrayElement(products);
      const qty = faker.number.int({ min: 1, max: 10 });
      const unitPrice = product.basePrice;
      const discount = faker.datatype.boolean(0.25)
        ? money(faker.number.float({ min: 5, max: 30 }))
        : 0;
      const lineTotal = money(qty * unitPrice * (1 - discount / 100));
      orderTotal += lineTotal;
      items.push({
        id: faker.string.uuid(),
        orderId,
        productId: product.id,
        qty,
        unitPrice,
        discount,
        lineTotal,
      });
    }

    orders.push({
      id: orderId,
      customerId: customer.id,
      regionId,
      date: date.toISOString(),
      status,
      total: money(orderTotal),
    });
  }

  await insertBatched('orders', orders, 200, (batch) => {
    const params: unknown[] = [];
    const tuples = batch.map((o, i) => {
      const b = i * 6;
      params.push(o.id, o.customerId, o.regionId, o.date, o.status, o.total);
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6})`;
    });
    return {
      text: `INSERT INTO orders (order_id,customer_id,region_id,order_date,status,total_amount) VALUES ${tuples.join(',')}`,
      params,
    };
  });

  await insertBatched('order_items', items, 200, (batch) => {
    const params: unknown[] = [];
    const tuples = batch.map((it, i) => {
      const b = i * 7;
      params.push(it.id, it.orderId, it.productId, it.qty, it.unitPrice, it.discount, it.lineTotal);
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`;
    });
    return {
      text: `INSERT INTO order_items (item_id,order_id,product_id,quantity,unit_price,discount_pct,line_total) VALUES ${tuples.join(',')}`,
      params,
    };
  });
}

// ─── Read-only role ────────────────────────────────────────────

async function createReadonlyRole() {
  console.log('▸ Creating read-only role...');
  // Create the role if it does not exist, then (re)set its password.
  await sql.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${READONLY_USER}') THEN
        CREATE ROLE ${READONLY_USER} LOGIN PASSWORD '${READONLY_PASSWORD}';
      END IF;
    END
    $$;`);
  await sql.query(`ALTER ROLE ${READONLY_USER} WITH LOGIN PASSWORD '${READONLY_PASSWORD}'`);

  await sql.query(`GRANT USAGE ON SCHEMA public TO ${READONLY_USER}`);
  await sql.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${READONLY_USER}`);
  await sql.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ${READONLY_USER}`,
  );
  // Make sure the role can never create objects or write.
  await sql.query(`REVOKE CREATE ON SCHEMA public FROM ${READONLY_USER}`);
  await sql.query(`REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM ${READONLY_USER}`);

  // Layer 3 (defense in depth): every connection by this role gets a hard
  // 5s statement timeout, so a runaway query is killed at the database.
  await sql.query(`ALTER ROLE ${READONLY_USER} SET statement_timeout = '5s'`);

  console.log(`  ✓ role "${READONLY_USER}" has SELECT-only access + 5s timeout`);
}

// ─── Main ──────────────────────────────────────────────────────

async function main() {
  const start = Date.now();
  console.log('🌱 Seeding retail_sales demo database\n');

  await createTables();
  await seedReference();

  console.log('▸ Generating + inserting data...');
  const customers = genCustomers(500);
  await seedCustomers(customers);

  const products = genProducts(200);
  await seedProducts(products);

  await seedOrders(customers, products, 5000);

  await createReadonlyRole();

  // Sanity counts.
  const [counts] = await sql.query(`
    SELECT
      (SELECT COUNT(*) FROM customers)   AS customers,
      (SELECT COUNT(*) FROM products)    AS products,
      (SELECT COUNT(*) FROM orders)      AS orders,
      (SELECT COUNT(*) FROM order_items) AS order_items
  `);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log('\n✅ Seed complete in ' + elapsed + 's');
  console.log('   counts:', counts);
  console.log(
    `\n   Set RETAIL_DATABASE_URL to connect as ${READONLY_USER} (read-only).`,
  );
}

main().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
