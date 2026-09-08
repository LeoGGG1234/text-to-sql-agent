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
  /** Rotate the login password. Intended for the explicit deployment script. */
  rotatePassword?: boolean;
}

export async function ensureUserdataReadonlyRole(
  sql: NeonSql,
  options: UserdataRoleOptions,
): Promise<void> {
  await sql.query(`CREATE SCHEMA IF NOT EXISTS ${USERDATA_SCHEMA}`);

  const [roleRow] = await sql.query(
    `SELECT rolcanlogin, rolinherit, rolsuper, rolcreatedb, rolcreaterole,
            rolreplication, rolbypassrls,
            EXISTS (
              SELECT 1 FROM pg_auth_members membership
              WHERE membership.member = role.oid
            ) AS has_memberships
     FROM pg_roles role
     WHERE rolname = $1`,
    [USERDATA_READONLY_ROLE],
  );
  const roleState = roleRow as
    | {
        rolcanlogin?: boolean;
        rolinherit?: boolean;
        rolsuper?: boolean;
        rolcreatedb?: boolean;
        rolcreaterole?: boolean;
        rolreplication?: boolean;
        rolbypassrls?: boolean;
        has_memberships?: boolean;
      }
    | undefined;
  const roleExists = roleState !== undefined;

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
  } else {
    // Neon project owners can manage ordinary roles, but PostgreSQL rejects an
    // ALTER ROLE statement that mentions SUPERUSER even when it only requests
    // NOSUPERUSER. Fail closed for attributes that require a platform admin,
    // and repair the ordinary role attributes without privileged clauses.
    const privilegedAttributes = [
      roleState.rolsuper !== false ? 'SUPERUSER' : null,
      roleState.rolreplication !== false ? 'REPLICATION' : null,
      roleState.rolbypassrls !== false ? 'BYPASSRLS' : null,
    ].filter((attribute): attribute is string => attribute !== null);
    if (privilegedAttributes.length > 0) {
      throw new Error(
        `userdata_readonly has unsafe privileged attributes (${privilegedAttributes.join(', ')}). ` +
          'A PostgreSQL platform administrator must remove them before deployment.',
      );
    }

    const repairClauses = [
      roleState.rolcanlogin === true ? null : 'LOGIN',
      roleState.rolinherit === false ? null : 'NOINHERIT',
      roleState.rolcreatedb === false ? null : 'NOCREATEDB',
      roleState.rolcreaterole === false ? null : 'NOCREATEROLE',
    ].filter((clause): clause is string => clause !== null);
    if (repairClauses.length > 0) {
      await sql.query(
        `ALTER ROLE ${USERDATA_READONLY_ROLE} WITH ${repairClauses.join(' ')}`,
      );
    }

    if (roleState.has_memberships) {
      await sql.query(`DO $userdata_memberships$
DECLARE
  parent_role text;
BEGIN
  FOR parent_role IN
    SELECT parent.rolname
    FROM pg_auth_members membership
    JOIN pg_roles parent ON parent.oid = membership.roleid
    JOIN pg_roles member ON member.oid = membership.member
    WHERE member.rolname = '${USERDATA_READONLY_ROLE}'
  LOOP
    EXECUTE format('REVOKE %I FROM ${USERDATA_READONLY_ROLE}', parent_role);
  END LOOP;
END
$userdata_memberships$;`);
    }

    if (options.rotatePassword) {
      if (!options.password) {
        throw new Error(
          'USERDATA_READONLY_PASSWORD is required when rotating the role password.',
        );
      }
      const [ddlRow] = await sql.query(
        `SELECT format(
           'ALTER ROLE ${USERDATA_READONLY_ROLE} WITH PASSWORD %L',
           $1::text
         ) AS ddl`,
        [options.password],
      );
      const ddl = (ddlRow as { ddl?: unknown } | undefined)?.ddl;
      if (typeof ddl !== 'string') {
        throw new Error('Failed to safely construct userdata password DDL.');
      }
      await sql.query(ddl);
    }
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
