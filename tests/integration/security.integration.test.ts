import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { neon } from '@neondatabase/serverless';

const integrationUrl = process.env.INTEGRATION_DATABASE_URL;
const destructiveAcknowledged =
  process.env.ALLOW_DESTRUCTIVE_INTEGRATION === 'true';

type Auth = {
  handler: (request: Request) => Promise<Response>;
};

let auth: Auth;
let setupCompleted = false;
let readonlyDatabaseUrl: string;
const cleanupUserIds = new Set<string>();
const INTEGRATION_MARKER = 'codex_integration.security_suite_marker';
const INTEGRATION_READONLY_PASSWORD = 'integration-readonly-password-1234';

function requireIntegrationTarget(): string {
  if (!integrationUrl || !destructiveAcknowledged) {
    throw new Error(
      'Integration tests require a disposable INTEGRATION_DATABASE_URL and ALLOW_DESTRUCTIVE_INTEGRATION=true. Never use production.',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(integrationUrl);
  } catch {
    throw new Error(
      'INTEGRATION_DATABASE_URL is not a valid PostgreSQL URL. Replace the example placeholder with the connection string copied from a disposable Neon database.',
    );
  }
  if (
    !['postgresql:', 'postgres:'].includes(parsed.protocol) ||
    !parsed.username ||
    !parsed.password ||
    !parsed.hostname ||
    parsed.pathname.length <= 1
  ) {
    throw new Error(
      'INTEGRATION_DATABASE_URL must include a PostgreSQL username, password, host, and database name. Do not use the example placeholder.',
    );
  }
  return integrationUrl;
}

function getCookieHeader(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';', 1)[0])
    .join('; ');
}

async function createAnonymousSession(): Promise<{
  userId: string;
  cookie: string;
}> {
  const response = await auth.handler(
    new Request('http://localhost:3000/api/auth/sign-in/anonymous', {
      method: 'POST',
      headers: { origin: 'http://localhost:3000' },
    }),
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as { user?: { id?: string } };
  const userId = body.user?.id;
  if (!userId) throw new Error('Anonymous sign-in did not return a user id.');
  cleanupUserIds.add(userId);
  return { userId, cookie: getCookieHeader(response) };
}

async function assertDisposableDatabase(sql: ReturnType<typeof neon>) {
  const [state] = await sql.query(
    `SELECT
       COUNT(*)::int AS app_table_count,
       to_regclass($1) IS NOT NULL AS has_integration_marker
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name IN (
         'account', 'chat_conversations', 'chat_messages', 'data_sources',
         'session', 'usage_records', 'user', 'verification'
       )`,
    [INTEGRATION_MARKER],
  );
  const targetState = state as {
    app_table_count: number;
    has_integration_marker: boolean;
  };
  if (targetState.app_table_count > 0 && !targetState.has_integration_marker) {
    throw new Error(
      'INTEGRATION_DATABASE_URL already contains application tables but was not initialized by this integration suite. Create a truly empty disposable database; existing tables will never be dropped or baselined automatically.',
    );
  }
}

describe('security integration against disposable Neon database', () => {
  beforeAll(async () => {
    const databaseUrl = requireIntegrationTarget();
    const adminSql = neon(databaseUrl);
    await assertDisposableDatabase(adminSql);
    process.env.DATABASE_URL = databaseUrl;
    process.env.BETTER_AUTH_SECRET =
      'integration-only-secret-at-least-thirty-two-characters';
    process.env.BETTER_AUTH_URL = 'http://localhost:3000';
    process.env.ALLOW_GUEST = 'true';
    process.env.DEV_MODE = 'false';

    const [{ getDb }, { migrate }, { getAuth }, userdataSecurity] =
      await Promise.all([
        import('../../src/db'),
        import('drizzle-orm/neon-http/migrator'),
        import('../../src/lib/auth'),
        import('../../src/lib/data-sources/userdata-security'),
      ]);
    await migrate(getDb(), { migrationsFolder: 'drizzle' });
    await adminSql.query('CREATE SCHEMA IF NOT EXISTS codex_integration');
    await adminSql.query(
      'CREATE TABLE IF NOT EXISTS codex_integration.security_suite_marker (created_at timestamptz NOT NULL DEFAULT now())',
    );
    await userdataSecurity.ensureUserdataReadonlyRole(neon(databaseUrl), {
      password: INTEGRATION_READONLY_PASSWORD,
      production: true,
    });
    const readonlyUrl = new URL(databaseUrl);
    readonlyUrl.username = userdataSecurity.USERDATA_READONLY_ROLE;
    readonlyUrl.password = INTEGRATION_READONLY_PASSWORD;
    readonlyDatabaseUrl = readonlyUrl.toString();
    process.env.USERDATA_DATABASE_URL = readonlyDatabaseUrl;
    auth = getAuth();
    setupCompleted = true;
  });

  afterAll(async () => {
    if (!integrationUrl || !setupCompleted) return;
    const sql = neon(integrationUrl);
    for (const userId of cleanupUserIds) {
      await sql.query('DELETE FROM "user" WHERE id = $1', [userId]);
    }
  });

  it('isolates two anonymous users and transfers ownership on registration', async () => {
    const guestA = await createAnonymousSession();
    const guestB = await createAnonymousSession();
    expect(guestA.userId).not.toBe(guestB.userId);
    expect(guestA.cookie).not.toBe(guestB.cookie);

    const [{ getDb }, schema, conversationManager, dataSourceManager] =
      await Promise.all([
        import('../../src/db'),
        import('../../src/db/schema'),
        import('../../src/lib/conversation-manager'),
        import('../../src/lib/data-sources/schema-manager'),
      ]);
    const db = getDb();
    const conversationId = crypto.randomUUID();
    const dataSourceId = crypto.randomUUID();
    await db.insert(schema.dataSources).values({
      id: dataSourceId,
      userId: guestA.userId,
      name: 'Integration source',
      type: 'upload',
      config: {},
      schemaJson: { tables: [], relationships: [] },
    });
    await db.insert(schema.chatConversations).values({
      id: conversationId,
      userId: guestA.userId,
      dataSourceId,
      title: 'Integration conversation',
    });

    await expect(
      conversationManager.getOwnedConversation(conversationId, guestA.userId),
    ).resolves.not.toBeNull();
    await expect(
      conversationManager.getOwnedConversation(conversationId, guestB.userId),
    ).resolves.toBeNull();
    await expect(
      dataSourceManager.getOwnedDataSource(dataSourceId, guestB.userId),
    ).resolves.toBeNull();

    const [conversationRoute, dataSourceRoute] = await Promise.all([
      import('../../src/app/api/conversations/[id]/route'),
      import('../../src/app/api/data-sources/[id]/route'),
    ]);
    const guestBRequest = new Request(
      `http://localhost:3000/api/conversations/${conversationId}`,
      { headers: { cookie: guestB.cookie } },
    );
    const deniedConversation = await conversationRoute.GET(guestBRequest, {
      params: Promise.resolve({ id: conversationId }),
    });
    expect(deniedConversation.status).toBe(404);
    const deniedDataSource = await dataSourceRoute.GET(
      new Request(`http://localhost:3000/api/data-sources/${dataSourceId}`, {
        headers: { cookie: guestB.cookie },
      }),
      { params: Promise.resolve({ id: dataSourceId }) },
    );
    expect(deniedDataSource.status).toBe(404);

    const ownedConversation = await conversationRoute.GET(
      new Request(
        `http://localhost:3000/api/conversations/${conversationId}`,
        { headers: { cookie: guestA.cookie } },
      ),
      { params: Promise.resolve({ id: conversationId }) },
    );
    expect(ownedConversation.status).toBe(200);
    await expect(ownedConversation.json()).resolves.toEqual(
      expect.objectContaining({
        id: conversationId,
        dataSourceId,
        dataSourceName: 'Integration source',
      }),
    );

    const email = `integration-${crypto.randomUUID()}@example.test`;
    const signUpResponse = await auth.handler(
      new Request('http://localhost:3000/api/auth/sign-up/email', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: guestA.cookie,
          origin: 'http://localhost:3000',
        },
        body: JSON.stringify({
          email,
          password: 'integration-password-1234',
          name: 'Integration User',
        }),
      }),
    );
    expect(signUpResponse.status).toBe(200);
    const signUpBody = (await signUpResponse.json()) as {
      user?: { id?: string };
    };
    const permanentUserId = signUpBody.user?.id;
    if (!permanentUserId) throw new Error('Sign-up did not return a user id.');
    cleanupUserIds.add(permanentUserId);

    await expect(
      conversationManager.getOwnedConversation(
        conversationId,
        permanentUserId,
      ),
    ).resolves.not.toBeNull();
    await expect(
      dataSourceManager.getOwnedDataSource(dataSourceId, permanentUserId),
    ).resolves.not.toBeNull();

    const { eq } = await import('drizzle-orm');
    const [oldAnonymousUser] = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.id, guestA.userId))
      .limit(1);
    expect(oldAnonymousUser).toBeUndefined();
  });

  it('executes an allowlisted physical table and rejects a neighboring table', async () => {
    const databaseUrl = requireIntegrationTarget();
    const suffix = crypto.randomUUID().replaceAll('-', '_');
    const allowedTable = `ds_${suffix}`;
    const deniedTable = `ds_${crypto.randomUUID().replaceAll('-', '_')}`;
    const sql = neon(databaseUrl);

    await sql.query('CREATE SCHEMA IF NOT EXISTS userdata');
    await sql.query(
      `CREATE TABLE userdata."${allowedTable}" (value integer NOT NULL)`,
    );
    await sql.query(
      `CREATE TABLE userdata."${deniedTable}" (value integer NOT NULL)`,
    );
    await sql.query(
      `INSERT INTO userdata."${allowedTable}" (value) VALUES (42)`,
    );

    try {
      const { validateAndExecute } = await import('../../src/lib/sql-executor');
      const options = {
        connectionString: readonlyDatabaseUrl,
        searchPath: 'userdata',
        accessScope: { schema: 'userdata', tables: [allowedTable] },
      } as const;
      const allowed = await validateAndExecute(
        `SELECT value FROM userdata."${allowedTable}"`,
        options,
      );
      expect(allowed.success).toBe(true);
      if (allowed.success) expect(allowed.rows).toEqual([{ value: 42 }]);

      const denied = await validateAndExecute(
        `SELECT value FROM userdata."${deniedTable}"`,
        options,
      );
      expect(denied).toMatchObject({
        success: false,
        code: 'VALIDATION_ERROR',
      });

      const readonlySql = neon(readonlyDatabaseUrl);
      await expect(
        readonlySql.query(
          `INSERT INTO userdata."${allowedTable}" (value) VALUES (99)`,
        ),
      ).rejects.toThrow(/permission denied|read-only/i);
    } finally {
      await sql.query(`DROP TABLE IF EXISTS userdata."${allowedTable}"`);
      await sql.query(`DROP TABLE IF EXISTS userdata."${deniedTable}"`);
    }
  });

  it('previews and atomically applies an owned cleaning recipe', async () => {
    const databaseUrl = requireIntegrationTarget();
    const guest = await createAnonymousSession();
    const dataSourceId = crypto.randomUUID();
    const tableName = `ds_${dataSourceId.replaceAll('-', '_')}`;
    const sql = neon(databaseUrl);
    const [{ getDb }, schema] = await Promise.all([
      import('../../src/db'),
      import('../../src/db/schema'),
    ]);
    const db = getDb();
    const table = {
      name: tableName,
      displayName: 'dirty.csv',
      rowCount: 2,
      columns: [
        { name: 'customer', displayName: 'Customer', type: 'TEXT', semanticType: 'TEXT' as const, nullable: false, hint: null },
        { name: 'amount', displayName: 'Amount', type: 'TEXT', semanticType: 'NUMERIC' as const, nullable: false, hint: null },
        { name: 'order_date', displayName: 'Order Date', type: 'TEXT', semanticType: 'DATE' as const, nullable: false, hint: null },
      ],
    };

    await sql.query(`CREATE TABLE userdata."${tableName}" (
      _row_id SERIAL PRIMARY KEY, customer TEXT, amount TEXT, order_date TEXT
    )`);
    await sql.query(
      `INSERT INTO userdata."${tableName}" (customer, amount, order_date)
       VALUES (' A ', '￥1,000', '2026/9/8'), ('A', '1000', '2026-09-08')`,
    );
    await db.insert(schema.dataSources).values({
      id: dataSourceId,
      userId: guest.userId,
      name: 'Dirty integration data',
      type: 'upload',
      config: { schemaName: 'userdata', tables: [{ name: tableName, displayName: 'dirty.csv', rowCount: 2 }] },
      schemaJson: { tables: [table], relationships: [] },
    });

    try {
      const [previewRoute, applyRoute] = await Promise.all([
        import('../../src/app/api/data-sources/[id]/cleaning/preview/route'),
        import('../../src/app/api/data-sources/[id]/cleaning/apply/route'),
      ]);
      const previewResponse = await previewRoute.POST(
        new Request(`http://localhost:3000/api/data-sources/${dataSourceId}/cleaning/preview`, {
          method: 'POST',
          headers: { cookie: guest.cookie, 'content-type': 'application/json' },
          body: JSON.stringify({ preset: 'standard' }),
        }),
        { params: Promise.resolve({ id: dataSourceId }) },
      );
      expect(previewResponse.status).toBe(200);
      const preview = await previewResponse.json() as { runId: string; summary: { affectedRows: number; removedRows: number } };
      expect(preview.summary).toMatchObject({ affectedRows: 2, removedRows: 1 });

      const applyResponse = await applyRoute.POST(
        new Request(`http://localhost:3000/api/data-sources/${dataSourceId}/cleaning/apply`, {
          method: 'POST',
          headers: { cookie: guest.cookie, 'content-type': 'application/json' },
          body: JSON.stringify({ runId: preview.runId }),
        }),
        { params: Promise.resolve({ id: dataSourceId }) },
      );
      expect(applyResponse.status).toBe(200);

      const cleaned = await sql.query(
        `SELECT customer, amount, order_date FROM userdata."${tableName}" ORDER BY _row_id`,
      );
      expect(cleaned).toEqual([{ customer: 'A', amount: '1000', order_date: '2026-09-08' }]);
      const [metadata] = await db.select({
        dataRevision: schema.dataSources.dataRevision,
        profileRevision: schema.dataSources.profileRevision,
        profileStatus: schema.dataSources.profileStatus,
      }).from(schema.dataSources).where(
        (await import('drizzle-orm')).eq(schema.dataSources.id, dataSourceId),
      );
      expect(metadata).toEqual({ dataRevision: 1, profileRevision: 1, profileStatus: 'fresh' });
    } finally {
      await sql.query(`DROP TABLE IF EXISTS userdata."${tableName}"`);
    }
  });
});
