import { describe, expect, it } from 'vitest';

import {
  buildGuestCleanupBlock,
  LEGACY_SHARED_GUEST_ID,
  planGuestCleanup,
  type GuestCleanupCandidate,
} from '../src/lib/guest-cleanup';

function candidate(overrides?: Partial<GuestCleanupCandidate>): GuestCleanupCandidate {
  return {
    userId: 'anonymous-user-a',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    isLegacySharedGuest: false,
    dataSources: [],
    ...overrides,
  };
}

describe('guest cleanup safety', () => {
  it('collects generated upload table names from trusted metadata shapes', () => {
    const tableName = 'ds_12345678_1234_4234_8234_123456789abc';
    const plan = planGuestCleanup(
      candidate({
        dataSources: [
          {
            id: 'source-a',
            type: 'upload',
            config: { tables: [{ name: tableName }] },
            schemaJson: { tables: [{ name: tableName }] },
          },
        ],
      }),
    );

    expect(plan).toMatchObject({
      safeToExecute: true,
      tableNames: [tableName],
      errors: [],
    });
  });

  it('fails closed instead of interpolating malformed physical table metadata', () => {
    const plan = planGuestCleanup(
      candidate({
        dataSources: [
          {
            id: 'source-a',
            type: 'upload',
            config: { tables: [{ name: 'ds_safe"; DROP TABLE "user"' }] },
            schemaJson: null,
          },
        ],
      }),
    );

    expect(plan.safeToExecute).toBe(false);
    expect(() =>
      buildGuestCleanupBlock(plan, new Date(), false),
    ).toThrow('invalid physical table metadata');
  });

  it('rechecks inactivity under a row lock before dropping tables or deleting', () => {
    const tableName = 'ds_12345678_1234_4234_8234_123456789abc';
    const plan = planGuestCleanup(
      candidate({
        dataSources: [
          {
            id: 'source-a',
            type: 'upload',
            config: { tables: [{ name: tableName }] },
            schemaJson: null,
          },
        ],
      }),
    );
    const block = buildGuestCleanupBlock(
      plan,
      new Date('2026-02-01T00:00:00Z'),
      false,
    );

    expect(block).toContain('u.is_anonymous = true');
    expect(block).toContain('FOR UPDATE');
    expect(block).toContain('s.expires_at > now()');
    expect(block).toContain(`userdata."${tableName}"`);
    expect(block).not.toContain(LEGACY_SHARED_GUEST_ID);
  });

  it('requires an explicit option before legacy shared Guest is eligible', () => {
    const plan = planGuestCleanup(
      candidate({
        userId: LEGACY_SHARED_GUEST_ID,
        isLegacySharedGuest: true,
      }),
    );

    expect(
      buildGuestCleanupBlock(plan, new Date('2026-02-01T00:00:00Z'), false),
    ).not.toContain(`OR u.id = '${LEGACY_SHARED_GUEST_ID}'`);
    expect(
      buildGuestCleanupBlock(plan, new Date('2026-02-01T00:00:00Z'), true),
    ).toContain(`OR u.id = '${LEGACY_SHARED_GUEST_ID}'`);
  });
});
