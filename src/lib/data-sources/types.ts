/**
 * Shared types for data source configuration.
 */

export type DataSourceType = 'retail' | 'upload' | 'external';

// ─── Schema Discovery ────────────────────────────────────────

export interface DiscoveredColumn {
  name: string; // sanitized identifier (safe for SQL)
  displayName: string; // original column name from CSV header
  type: string; // always 'TEXT' in Phase 1
  semanticType: 'NUMERIC' | 'DATE' | 'BOOLEAN' | 'TEXT';
  nullable: boolean;
  hint: string | null; // inline CAST hint for LLM, e.g. "Stored as TEXT. For math: CAST(col AS NUMERIC)"
}

export interface DiscoveredTable {
  name: string; // physical table name: ds_{id}
  displayName: string; // original file name (user-facing)
  rowCount: number;
  columns: DiscoveredColumn[];
}

// ─── Config (stored in data_sources.config JSONB) ─────────────

export interface UploadConfig {
  schemaName: string; // 'userdata'
  tables: { name: string; displayName: string; rowCount: number }[];
  originalFileName: string;
  fileSizeBytes: number;
}

export interface ExternalConfig {
  encryptedConnectionString: string;
  host: string;
  port: number;
  database: string;
  tables: DiscoveredTable[];
  lastConnectedAt: string;
}

export type DataSourceConfig = UploadConfig | ExternalConfig;

// ─── Quality Profile ──────────────────────────────────────────

export interface ColumnProfile {
  /** Values converted to real NULL by the Q1 NULL-like detector. */
  nullConvertedCount: number;
  /** Distribution of original strings that were converted, e.g. {"N/A": 8, "无": 4}. */
  nullConvertedSamples: Record<string, number>;
  /** Values that don't match the detected semanticType (Q2). */
  nonMatchingCount: number;
  nonMatchingRatio: number; // 0.0–1.0
  /** Up to 3 examples of non-matching values. */
  nonMatchingSamples: string[];
  /** Distinct value count in the column. */
  uniqueCount: number;
  /** How many values had leading/trailing spaces before .trim() (Q4 — already cleaned). */
  trimmedCount: number;
  /** Min character length of values in this column. */
  minLength: number;
  /** Max character length of values in this column. */
  maxLength: number;
  /** Number of near-duplicate clusters found in this column (fuzzy text matching). */
  fuzzyDuplicateClusters: number;
  /** Up to 3 example near-duplicate pairs with similarity scores. */
  fuzzyDuplicateSamples: Array<{ a: string; b: string; similarity: number }>;
}

export interface TableProfile {
  /** Number of exact-duplicate rows (Q3). */
  duplicateRowCount: number;
  duplicateRatio: number; // 0.0–1.0
  /** Total columns in this table. */
  totalColumns: number;
  /** Columns with any quality issue (nullConverted > 0 or nonMatchingRatio > 0.05). */
  columnsWithIssues: number;
}

export interface QualityProfile {
  columns: Record<string, ColumnProfile>; // keyed by sanitized column name
  table: TableProfile;
}

// ─── Schema JSON (stored in data_sources.schema_json) ─────────

export interface SchemaJson {
  tables: DiscoveredTable[];
  relationships: string[]; // always empty for uploaded data
  qualityProfile?: QualityProfile; // set during upload
}
