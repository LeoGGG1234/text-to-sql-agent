/** Deployment-time checks for required schema and userdata role hardening. */

import type { NeonQueryFunction } from '@neondatabase/serverless';
import {
  USERDATA_READONLY_ROLE,
  USERDATA_SCHEMA,
} from './data-sources/userdata-security';

type NeonSql = NeonQueryFunction<false, false>;

export interface ReadinessResult {
  name: string;
  ok: boolean;
  detail: string;
}

export async function checkDeploymentReadiness(
  sql: NeonSql,
  options: { checkUserdataSecurity: boolean },
): Promise<ReadinessResult[]> {
  const results: ReadinessResult[] = [];

  const [column] = await sql.query(
    `SELECT is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'user'
       AND column_name = 'is_anonymous'`,
  );
  const columnState = column as
    | { is_nullable?: string; column_default?: string | null }
    | undefined;
  const columnReady =
    columnState?.is_nullable === 'NO' &&
    columnState.column_default?.toLowerCase().includes('false') === true;
  results.push({
    name: 'guest migration',
    ok: columnReady,
    detail: columnReady
      ? 'public.user.is_anonymous is NOT NULL with a false default'
      : 'public.user.is_anonymous is missing or has the wrong constraints',
  });

  if (!options.checkUserdataSecurity) return results;

  const [role] = await sql.query(
    `SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
            rolreplication, rolbypassrls,
            EXISTS (
              SELECT 1 FROM pg_auth_members membership
              WHERE membership.member = role.oid
            ) AS has_memberships
     FROM pg_roles role
     WHERE rolname = $1`,
    [USERDATA_READONLY_ROLE],
  );
  const roleState = role as
    | {
        rolcanlogin?: boolean;
        rolsuper?: boolean;
        rolcreatedb?: boolean;
        rolcreaterole?: boolean;
        rolreplication?: boolean;
        rolbypassrls?: boolean;
        has_memberships?: boolean;
      }
    | undefined;
  const roleReady =
    roleState?.rolcanlogin === true &&
    roleState.rolsuper === false &&
    roleState.rolcreatedb === false &&
    roleState.rolcreaterole === false &&
    roleState.rolreplication === false &&
    roleState.rolbypassrls === false &&
    roleState.has_memberships === false;
  results.push({
    name: 'userdata role attributes',
    ok: roleReady,
    detail: roleReady
      ? `${USERDATA_READONLY_ROLE} is login-only, non-privileged, and has no inherited memberships`
      : `${USERDATA_READONLY_ROLE} is missing or does not match the hardened role settings`,
  });

  if (!roleState) {
    results.push(
      {
        name: 'userdata schema privileges',
        ok: false,
        detail: `cannot inspect schema privileges because ${USERDATA_READONLY_ROLE} is missing`,
      },
      {
        name: 'userdata table privileges',
        ok: false,
        detail: `cannot inspect table privileges because ${USERDATA_READONLY_ROLE} is missing`,
      },
    );
    return results;
  }

  const [schemaPrivileges] = await sql.query(
    `SELECT
       to_regnamespace($2) IS NOT NULL AS schema_exists,
       COALESCE(
         has_schema_privilege($1, to_regnamespace($2), 'USAGE'),
         false
       ) AS has_usage,
       COALESCE(
         has_schema_privilege($1, to_regnamespace($2), 'CREATE'),
         false
       ) AS has_create`,
    [USERDATA_READONLY_ROLE, USERDATA_SCHEMA],
  );
  const schemaState = schemaPrivileges as
    | { schema_exists?: boolean; has_usage?: boolean; has_create?: boolean }
    | undefined;
  const schemaReady =
    schemaState?.schema_exists === true &&
    schemaState.has_usage === true &&
    schemaState.has_create === false;
  results.push({
    name: 'userdata schema privileges',
    ok: schemaReady,
    detail: schemaReady
      ? 'role can use userdata but cannot create objects'
      : 'role must have USAGE without CREATE on userdata',
  });

  const [tablePrivileges] = await sql.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (
         WHERE has_table_privilege(
           $1,
           format('%I.%I', table_schema, table_name),
           'SELECT'
         )
       )::int AS selectable,
       COUNT(*) FILTER (
         WHERE has_table_privilege(
           $1,
           format('%I.%I', table_schema, table_name),
           'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
         )
       )::int AS writable
     FROM information_schema.tables
     WHERE table_schema = $2 AND table_type = 'BASE TABLE'`,
    [USERDATA_READONLY_ROLE, USERDATA_SCHEMA],
  );
  const tableState = tablePrivileges as
    | { total?: number; selectable?: number; writable?: number }
    | undefined;
  const tableReady =
    tableState != null &&
    tableState.total === tableState.selectable &&
    tableState.writable === 0;
  results.push({
    name: 'userdata table privileges',
    ok: tableReady,
    detail: tableReady
      ? `${tableState.total ?? 0} tables are SELECT-only for the runtime role`
      : 'one or more userdata tables are missing SELECT or expose write privileges',
  });

  return results;
}
