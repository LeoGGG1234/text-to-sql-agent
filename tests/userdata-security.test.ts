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
      .mockResolvedValueOnce([{ exists: false }])
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

  it('reapplies hardening without recreating an existing role', async () => {
    mocks.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ exists: true }]);

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

  it('fails closed when production must create a role without a password', async () => {
    mocks.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ exists: false }]);

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
