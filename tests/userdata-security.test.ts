import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureUserdataReadonlyRole } from '../src/lib/data-sources/userdata-security';

const mocks = {
  query: vi.fn(),
};

describe('userdata read-only role hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue([]);
  });

  it('creates a missing role with a parameterized password and hardens it', async () => {
    mocks.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          ddl: "CREATE ROLE userdata_readonly WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD 'strong''password'",
        },
      ]);

    await ensureUserdataReadonlyRole(
      { query: mocks.query } as Parameters<typeof ensureUserdataReadonlyRole>[0],
      { password: "strong'password", production: true },
    );

    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining(
        "'CREATE ROLE userdata_readonly WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD %L'",
      ),
      ["strong'password"],
    );
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('$1::text'),
      ["strong'password"],
    );
    expect(mocks.query).toHaveBeenCalledWith(
      "CREATE ROLE userdata_readonly WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD 'strong''password'",
    );
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining(
        'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER',
      ),
    );
  });

  it('reapplies object grants without altering an already-safe role', async () => {
    mocks.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          rolcanlogin: true,
          rolinherit: false,
          rolsuper: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolreplication: false,
          rolbypassrls: false,
          has_memberships: false,
        },
      ]);

    await ensureUserdataReadonlyRole(
      { query: mocks.query } as Parameters<typeof ensureUserdataReadonlyRole>[0],
      { production: true },
    );

    expect(mocks.query).not.toHaveBeenCalledWith(
      expect.stringContaining('CREATE ROLE'),
      expect.anything(),
    );
    expect(mocks.query).not.toHaveBeenCalledWith(
      expect.stringContaining('ALTER ROLE'),
    );
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('GRANT SELECT ON ALL TABLES'),
    );
  });

  it('repairs unsafe role attributes and removes inherited memberships', async () => {
    mocks.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          rolcanlogin: true,
          rolinherit: true,
          rolsuper: false,
          rolcreatedb: true,
          rolcreaterole: false,
          rolreplication: false,
          rolbypassrls: false,
          has_memberships: true,
        },
      ]);

    await ensureUserdataReadonlyRole(
      { query: mocks.query } as Parameters<typeof ensureUserdataReadonlyRole>[0],
      { production: true },
    );

    expect(mocks.query).toHaveBeenCalledWith(
      'ALTER ROLE userdata_readonly WITH NOINHERIT NOCREATEDB',
    );
    expect(mocks.query).not.toHaveBeenCalledWith(
      expect.stringContaining('NOSUPERUSER'),
    );
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('REVOKE %I FROM userdata_readonly'),
    );
  });

  it('repairs NOINHERIT without mentioning superuser-only attributes', async () => {
    mocks.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          rolcanlogin: true,
          rolinherit: true,
          rolsuper: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolreplication: false,
          rolbypassrls: false,
          has_memberships: false,
        },
      ]);

    await ensureUserdataReadonlyRole(
      { query: mocks.query } as Parameters<typeof ensureUserdataReadonlyRole>[0],
      { production: true },
    );

    expect(mocks.query).toHaveBeenCalledWith(
      'ALTER ROLE userdata_readonly WITH NOINHERIT',
    );
  });

  it('fails closed when privileged attributes require a platform administrator', async () => {
    mocks.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          rolcanlogin: true,
          rolinherit: false,
          rolsuper: true,
          rolcreatedb: false,
          rolcreaterole: false,
          rolreplication: false,
          rolbypassrls: false,
          has_memberships: false,
        },
      ]);

    await expect(
      ensureUserdataReadonlyRole(
        { query: mocks.query } as Parameters<typeof ensureUserdataReadonlyRole>[0],
        { production: true },
      ),
    ).rejects.toThrow('platform administrator');

    expect(mocks.query).not.toHaveBeenCalledWith(
      expect.stringContaining('ALTER ROLE'),
    );
  });

  it('rotates an existing role password through PostgreSQL literal quoting', async () => {
    mocks.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          rolcanlogin: true,
          rolinherit: false,
          rolsuper: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolreplication: false,
          rolbypassrls: false,
          has_memberships: false,
        },
      ])
      .mockResolvedValueOnce([
        { ddl: "ALTER ROLE userdata_readonly WITH PASSWORD 'new''password'" },
      ]);

    await ensureUserdataReadonlyRole(
      { query: mocks.query } as Parameters<typeof ensureUserdataReadonlyRole>[0],
      {
        password: "new'password",
        production: true,
        rotatePassword: true,
      },
    );

    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('ALTER ROLE userdata_readonly WITH PASSWORD %L'),
      ["new'password"],
    );
    expect(mocks.query).toHaveBeenCalledWith(
      "ALTER ROLE userdata_readonly WITH PASSWORD 'new''password'",
    );
  });

  it('fails closed when production must create a role without a password', async () => {
    mocks.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await expect(
      ensureUserdataReadonlyRole(
        { query: mocks.query } as Parameters<typeof ensureUserdataReadonlyRole>[0],
        { production: true },
      ),
    ).rejects.toThrow('USERDATA_READONLY_PASSWORD is required');

    expect(mocks.query).not.toHaveBeenCalledWith(
      expect.stringContaining('CREATE ROLE'),
      expect.anything(),
    );
  });
});
