/**
 * Shared types for data source configuration.
 */

export type DataSourceType = 'retail' | 'upload' | 'external';
export type ProfileStatus = 'fresh' | 'stale' | 'running' | 'failed';

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
  /** Actual SQL NULL values in the profiled table. */
  databaseNullCount?: number;
  /** NULL-like strings that remain stored as text until a recipe changes them. */
  nullMarkerCount?: number;
  nullMarkerSamples?: Record<string, number>;
  /** Calendar-invalid or otherwise invalid values for the semantic type. */
  invalidCount?: number;
  /** Date-like values whose day/month or two-digit-year meaning is ambiguous. */
  ambiguousCount?: number;
  /** Legacy pre-v2 profile fields, retained so existing history remains readable. */
  nullConvertedCount?: number;
  nullConvertedSamples?: Record<string, number>;
  /** Values that don't match the detected semanticType (Q2). */
  nonMatchingCount: number;
  nonMatchingRatio: number; // 0.0–1.0
  /** Up to 3 examples of non-matching values. */
  nonMatchingSamples: string[];
  /** Distinct value count in the column. */
  uniqueCount: number;
  /** How many stored values have leading/trailing whitespace. */
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
  /** Columns with any observed quality issue. */
  columnsWithIssues: number;
}

export interface QualityProfile {
  columns: Record<string, ColumnProfile>; // keyed by sanitized column name
  table: TableProfile;
  /** Version 2 distinguishes database NULLs from text markers and invalid values. */
  version?: 2;
}

// ─── Schema JSON (stored in data_sources.schema_json) ─────────

export interface SchemaJson {
  tables: DiscoveredTable[];
  relationships: string[]; // always empty for uploaded data
  qualityProfile?: QualityProfile; // set during upload
}
