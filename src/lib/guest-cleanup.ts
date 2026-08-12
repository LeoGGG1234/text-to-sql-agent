/** Safe planning and execution primitives for expired anonymous-user cleanup. */

export const LEGACY_SHARED_GUEST_ID =
  'guest-00000000-0000-4000-a000-000000000001';

const UPLOAD_TABLE_NAME =
  /^ds_[0-9a-f]{8}_[0-9a-f]{4}_[0-9a-f]{4}_[0-9a-f]{4}_[0-9a-f]{12}$/i;

export interface GuestDataSourceRecord {
  id: string;
  type: string;
  config: unknown;
  schemaJson: unknown;
}

export interface GuestCleanupCandidate {
  userId: string;
  createdAt: Date;
  isLegacySharedGuest: boolean;
  dataSources: GuestDataSourceRecord[];
}

export interface GuestCleanupPlan extends GuestCleanupCandidate {
  tableNames: string[];
  safeToExecute: boolean;
  errors: string[];
}

function tableNamesFrom(value: unknown): unknown[] {
  if (!value || typeof value !== 'object') return [];
  const tables = (value as { tables?: unknown }).tables;
  if (!Array.isArray(tables)) return [];
  return tables.map((table) =>
    table && typeof table === 'object'
      ? (table as { name?: unknown }).name
      : undefined,
  );
}

export function planGuestCleanup(
  candidate: GuestCleanupCandidate,
): GuestCleanupPlan {
  const names = new Set<string>();
  const errors: string[] = [];

  for (const source of candidate.dataSources) {
    if (source.type !== 'upload') continue;
    const rawNames = [
      ...tableNamesFrom(source.config),
      ...tableNamesFrom(source.schemaJson),
    ];
    const validNames = rawNames.filter(
      (name): name is string =>
        typeof name === 'string' && UPLOAD_TABLE_NAME.test(name),
    );
    for (const name of validNames) names.add(name);

    if (rawNames.length === 0 || validNames.length !== rawNames.length) {
      errors.push(
        `Upload data source ${source.id} has missing or invalid physical table metadata.`,
      );
    }
  }

  return {
    ...candidate,
    tableNames: [...names].sort(),
    safeToExecute: errors.length === 0,
    errors,
  };
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function buildGuestCleanupBlock(
  plan: GuestCleanupPlan,
  cutoff: Date,
  includeLegacy: boolean,
): string {
  if (!plan.safeToExecute) {
    throw new Error(plan.errors.join(' '));
  }
  if (!Number.isFinite(cutoff.getTime())) {
    throw new Error('Guest cleanup cutoff is invalid.');
  }

  const userId = quoteLiteral(plan.userId);
  const cutoffLiteral = quoteLiteral(cutoff.toISOString());
  const eligibleIdentity = includeLegacy
    ? `(u.is_anonymous = true OR u.id = ${quoteLiteral(LEGACY_SHARED_GUEST_ID)})`
    : 'u.is_anonymous = true';
  const dropTables = plan.tableNames
    .map(
      (tableName) =>
        `    DROP TABLE IF EXISTS userdata.${quoteIdentifier(tableName)};`,
    )
    .join('\n');

  return `DO $guest_cleanup$
DECLARE
  eligible boolean := false;
BEGIN
  SELECT true INTO eligible
  FROM "user" u
  WHERE u.id = ${userId}
    AND ${eligibleIdentity}
    AND u.created_at < ${cutoffLiteral}::timestamptz
  FOR UPDATE;

  IF eligible AND NOT EXISTS (
    SELECT 1 FROM "session" s
    WHERE s.user_id = ${userId} AND s.expires_at > now()
  ) THEN
${dropTables ? `${dropTables}\n` : ''}    DELETE FROM "user" WHERE id = ${userId};
  END IF;
END
$guest_cleanup$;`;
}
