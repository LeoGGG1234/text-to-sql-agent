/**
 * Idempotent provisioning for the shared userdata read-only database role.
 *
 * Table-level tenant isolation is enforced by the SQL AST allowlist. This role
 * is the independent database-level read-only boundary underneath it.
 */

import type { NeonQueryFunction } from '@neondatabase/serverless';

export const USERDATA_SCHEMA = 'userdata';
export const USERDATA_READONLY_ROLE = 'userdata_readonly';

type NeonSql = NeonQueryFunction<false, false>;

export interface UserdataRoleOptions {
  password?: string;
  production: boolean;
}

export async function ensureUserdataReadonlyRole(
  sql: NeonSql,
  options: UserdataRoleOptions,
): Promise<void> {
  await sql.query(`CREATE SCHEMA IF NOT EXISTS ${USERDATA_SCHEMA}`);

  const [roleRow] = await sql.query(
    `SELECT EXISTS (
       SELECT FROM pg_roles WHERE rolname = '${USERDATA_READONLY_ROLE}'
     ) AS exists`,
  );
  const roleExists = Boolean((roleRow as { exists?: boolean } | undefined)?.exists);

  if (!roleExists) {
    if (!options.password && options.production) {
      throw new Error(
        'USERDATA_READONLY_PASSWORD is required in production. ' +
          'Set it to the password used by USERDATA_DATABASE_URL.',
      );
    }

    const password = options.password || 'userdata_demo_pw';
    if (!options.password) {
      console.warn(
        '[upload] USERDATA_READONLY_PASSWORD not set — using the local development default.',
      );
    }
    // PostgreSQL utility statements do not accept bind parameters in PASSWORD.
    // Ask PostgreSQL itself to quote the secret with format(%L), then execute
    // the resulting fixed DDL instead of interpolating application input.
    const [ddlRow] = await sql.query(
      `SELECT format(
         'CREATE ROLE ${USERDATA_READONLY_ROLE} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD %L',
         $1::text
       ) AS ddl`,
      [password],
    );
    const ddl = (ddlRow as { ddl?: unknown } | undefined)?.ddl;
    if (typeof ddl !== 'string') {
      throw new Error('Failed to safely construct userdata read-only role DDL.');
    }
    await sql.query(ddl);
  }

  // PostgreSQL/Neon safe defaults cover privileged role attributes. Enforce
  // object privileges idempotently; connection-level read-only settings and
  // timeout are injected by sql-executor for every userdata query.
  const hardeningQueries = [
    `GRANT USAGE ON SCHEMA ${USERDATA_SCHEMA} TO ${USERDATA_READONLY_ROLE}`,
    `REVOKE CREATE ON SCHEMA ${USERDATA_SCHEMA} FROM ${USERDATA_READONLY_ROLE}`,
    `GRANT SELECT ON ALL TABLES IN SCHEMA ${USERDATA_SCHEMA} TO ${USERDATA_READONLY_ROLE}`,
    `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA ${USERDATA_SCHEMA} FROM ${USERDATA_READONLY_ROLE}`,
    `REVOKE USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA ${USERDATA_SCHEMA} FROM ${USERDATA_READONLY_ROLE}`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA ${USERDATA_SCHEMA} GRANT SELECT ON TABLES TO ${USERDATA_READONLY_ROLE}`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA ${USERDATA_SCHEMA} REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM ${USERDATA_READONLY_ROLE}`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA ${USERDATA_SCHEMA} REVOKE USAGE, SELECT, UPDATE ON SEQUENCES FROM ${USERDATA_READONLY_ROLE}`,
  ];

  for (const query of hardeningQueries) {
    await sql.query(query);
  }
}
