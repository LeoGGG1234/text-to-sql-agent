/**
 * Static schema description for the retail_sales demo database.
 *
 * This is the single source of truth for the database structure, used in
 * three places:
 *   1. Injected into the system prompt (SCHEMA_PROMPT_TEXT) so the LLM writes
 *      correct SQL without a runtime introspection round-trip.
 *   2. Returned by the getSchema tool (SCHEMA_TABLES) when the LLM needs to
 *      double-check a name mid-conversation.
 *   3. Used by the seed script as the authoritative column reference.
 *
 * Keep this in sync with scripts/seed-retail-db.ts DDL.
 */

export interface ColumnDef {
  name: string;
  type: string;
  nullable: boolean;
  description: string;
}

export interface TableDef {
  name: string;
  description: string;
  columns: ColumnDef[];
  foreignKeys: { column: string; references: string }[];
}

export const SCHEMA_TABLES: TableDef[] = [
  {
    name: 'customers',
    description: 'Registered customers. ~500 rows.',
    columns: [
      { name: 'customer_id', type: 'uuid', nullable: false, description: 'Primary key' },
      { name: 'email', type: 'varchar(255)', nullable: false, description: 'Unique email' },
      { name: 'first_name', type: 'varchar(100)', nullable: false, description: 'Given name' },
      { name: 'last_name', type: 'varchar(100)', nullable: false, description: 'Family name' },
      { name: 'city', type: 'varchar(100)', nullable: false, description: 'City' },
      { name: 'state', type: 'varchar(100)', nullable: true, description: 'State / province' },
      { name: 'country', type: 'varchar(100)', nullable: false, description: 'Country' },
      { name: 'signup_date', type: 'date', nullable: false, description: 'Date the customer registered' },
      {
        name: 'loyalty_tier',
        type: 'varchar(20)',
        nullable: false,
        description: "Loyalty level: 'Bronze' | 'Silver' | 'Gold' | 'Platinum'",
      },
    ],
    foreignKeys: [],
  },
  {
    name: 'categories',
    description: 'Product categories, with optional parent for subcategories. ~10 rows.',
    columns: [
      { name: 'category_id', type: 'int', nullable: false, description: 'Primary key' },
      { name: 'category_name', type: 'varchar(100)', nullable: false, description: "e.g. 'Electronics', 'Clothing'" },
      {
        name: 'parent_category_id',
        type: 'int',
        nullable: true,
        description: 'Self-reference to a parent category (NULL = top-level)',
      },
    ],
    foreignKeys: [{ column: 'parent_category_id', references: 'categories.category_id' }],
  },
  {
    name: 'regions',
    description: 'Sales regions. ~10 rows.',
    columns: [
      { name: 'region_id', type: 'int', nullable: false, description: 'Primary key' },
      { name: 'region_name', type: 'varchar(100)', nullable: false, description: "e.g. 'East China', 'Europe'" },
      { name: 'country', type: 'varchar(100)', nullable: false, description: 'Country the region belongs to' },
    ],
    foreignKeys: [],
  },
  {
    name: 'products',
    description: 'Products available for sale. ~200 rows.',
    columns: [
      { name: 'product_id', type: 'uuid', nullable: false, description: 'Primary key' },
      { name: 'product_name', type: 'varchar(200)', nullable: false, description: 'Display name' },
      { name: 'category_id', type: 'int', nullable: false, description: 'FK to categories' },
      { name: 'base_price', type: 'numeric(10,2)', nullable: false, description: 'List price' },
      { name: 'cost', type: 'numeric(10,2)', nullable: false, description: 'Unit cost (for profit = price - cost)' },
      { name: 'brand', type: 'varchar(100)', nullable: false, description: 'Brand name' },
      { name: 'rating', type: 'numeric(3,2)', nullable: true, description: 'Average rating 0-5 (NULL if unrated)' },
    ],
    foreignKeys: [{ column: 'category_id', references: 'categories.category_id' }],
  },
  {
    name: 'orders',
    description: 'Customer orders. ~5,000 rows, spanning 2025-01 through 2026-06.',
    columns: [
      { name: 'order_id', type: 'uuid', nullable: false, description: 'Primary key' },
      { name: 'customer_id', type: 'uuid', nullable: false, description: 'FK to customers' },
      { name: 'region_id', type: 'int', nullable: false, description: 'FK to regions' },
      { name: 'order_date', type: 'timestamp', nullable: false, description: 'When the order was placed' },
      {
        name: 'status',
        type: 'varchar(20)',
        nullable: false,
        description: "Order status: 'completed' | 'cancelled' | 'returned'",
      },
      {
        name: 'total_amount',
        type: 'numeric(12,2)',
        nullable: false,
        description: 'Order total (sum of its line items). Use for order-level revenue.',
      },
    ],
    foreignKeys: [
      { column: 'customer_id', references: 'customers.customer_id' },
      { column: 'region_id', references: 'regions.region_id' },
    ],
  },
  {
    name: 'order_items',
    description: 'Line items within each order. The main fact table. ~20,000 rows.',
    columns: [
      { name: 'item_id', type: 'uuid', nullable: false, description: 'Primary key' },
      { name: 'order_id', type: 'uuid', nullable: false, description: 'FK to orders' },
      { name: 'product_id', type: 'uuid', nullable: false, description: 'FK to products' },
      { name: 'quantity', type: 'int', nullable: false, description: 'Units purchased (1-10)' },
      { name: 'unit_price', type: 'numeric(10,2)', nullable: false, description: 'Price per unit at purchase time' },
      { name: 'discount_pct', type: 'numeric(5,2)', nullable: false, description: 'Discount percent applied (0-100)' },
      {
        name: 'line_total',
        type: 'numeric(12,2)',
        nullable: false,
        description: 'quantity * unit_price * (1 - discount_pct/100). Use for product-level revenue.',
      },
    ],
    foreignKeys: [
      { column: 'order_id', references: 'orders.order_id' },
      { column: 'product_id', references: 'products.product_id' },
    ],
  },
];

/** Human-readable join hints surfaced to the LLM. */
export const RELATIONSHIPS: string[] = [
  'orders.customer_id → customers.customer_id (who placed the order)',
  'orders.region_id → regions.region_id (where the order shipped)',
  'order_items.order_id → orders.order_id (line items of an order)',
  'order_items.product_id → products.product_id (what was bought)',
  'products.category_id → categories.category_id (product category)',
  'categories.parent_category_id → categories.category_id (subcategory tree)',
];

/** Compact text rendering of the schema for system-prompt injection. */
export const SCHEMA_PROMPT_TEXT: string = (() => {
  const lines: string[] = [];
  for (const t of SCHEMA_TABLES) {
    lines.push(`### ${t.name} — ${t.description}`);
    for (const c of t.columns) {
      const nul = c.nullable ? '' : ' NOT NULL';
      lines.push(`  - ${c.name} ${c.type}${nul} — ${c.description}`);
    }
  }
  lines.push('');
  lines.push('Relationships (join paths):');
  for (const r of RELATIONSHIPS) lines.push(`  - ${r}`);
  return lines.join('\n');
})();
