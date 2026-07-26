import { describe, expect, it } from 'vitest';
import type {
  ExtensionCommandBinding,
  ExtensionCommandGrantRecord,
} from '../services/extension-command-grants.js';
import {
  createPrismaExtensionCommandGrantStore,
  inspectExtensionCommandGrant,
} from '../services/extension-command-grants-prisma.js';

const NOW = new Date('2026-07-14T08:00:00.000Z');
const LATER = new Date('2026-07-14T08:02:00.000Z');

function binding(overrides: Partial<ExtensionCommandBinding> = {}): ExtensionCommandBinding {
  return {
    sessionId: 'session-1',
    tokenId: 'jti-1',
    ownerUserId: 'owner-1',
    shopId: 'shop-1',
    operation: 'OZON_PUBLISH',
    workflowId: 'workflow-1',
    draftVersion: 7,
    idempotencyKey: 'publish-workflow-1-v7',
    requestHash: 'a'.repeat(64),
    ...overrides,
  };
}

function grant(overrides: Partial<ExtensionCommandGrantRecord> = {}): ExtensionCommandGrantRecord {
  return {
    id: 'grant-1',
    ...binding(),
    tokenDigest: 'b'.repeat(64),
    issuedAt: NOW,
    expiresAt: new Date(NOW.getTime() + 60_000),
    consumedAt: null,
    revokedAt: null,
    revokedReason: null,
    ...overrides,
  };
}

function grantRow(overrides: Record<string, unknown> = {}) {
  return {
    ...grant(),
    sessionStatus: 'ACTIVE',
    sessionExpiresAt: new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000),
    currentJti: 'jti-1',
    sessionOwnerUserId: 'owner-1',
    actorUserId: 'owner-1',
    scopes: ['capture:write', 'listing:write', 'listing:review', 'media:execute', 'listing:publish'],
    ownerStatus: 'ACTIVE',
    actorStatus: 'ACTIVE',
    ownerRole: 'USER',
    actorRole: 'USER',
    actorParentId: null,
    ...overrides,
  };
}

function pendingReceipt() {
  return {
    id: 'receipt-1',
    grantId: 'grant-1',
    status: 'PENDING',
    result: null,
    failureCode: null,
    createdAt: NOW,
    completedAt: null,
  };
}

type QueryHandler = (sql: string, params: unknown[]) => unknown[] | Promise<unknown[]>;

class ScriptedClient {
  readonly calls: Array<{ sql: string; params: unknown[] }> = [];
  readonly transactionOptions: Array<{ isolationLevel?: 'Serializable' } | undefined> = [];

  constructor(private readonly handler: QueryHandler) {}

  async $queryRawUnsafe<T>(sql: string, ...params: unknown[]): Promise<T> {
    this.calls.push({ sql, params });
    return await this.handler(sql, params) as T;
  }

  async $transaction<T>(
    action: (tx: ScriptedClient) => Promise<T>,
    options?: { isolationLevel?: 'Serializable' },
  ): Promise<T> {
    this.transactionOptions.push(options);
    return action(this);
  }
}

describe('Prisma extension command grant store', () => {
  it('shares live grant checks in a read-only inspection without acquiring mutation locks', async () => {
    const client = new ScriptedClient((sql) => {
      if (sql.includes('FROM "extension_command_grants" g')) {
        return [grantRow({ expiresAt: new Date(NOW.getTime() - 1) })];
      }
      if (sql.includes('FROM "extension_command_receipts"')) return [];
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(inspectExtensionCommandGrant(client, {
      tokenDigest: 'b'.repeat(64),
      binding: binding(),
      now: NOW,
    })).resolves.toEqual({ kind: 'expired' });
    expect(client.calls.every(({ sql }) => !sql.includes('FOR UPDATE'))).toBe(true);
    expect(client.calls.every(({ sql }) => !/^\s*(UPDATE|INSERT)/u.test(sql))).toBe(true);
  });

  it('locks the session and caps outstanding grants before inserting', async () => {
    const client = new ScriptedClient((sql) => {
      if (sql.includes('FROM "extension_device_sessions"') && sql.includes('FOR UPDATE')) {
        return [{ id: 'session-1' }];
      }
      if (sql.includes('FROM "extension_command_grants"') && sql.includes('"idempotency_key"')) {
        return [];
      }
      if (sql.includes('COUNT(*)') && sql.includes('"consumed_at" IS NULL')) {
        return [{ count: 50n }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const store = createPrismaExtensionCommandGrantStore({ client: client as never });

    expect(await store.issueGrant(grant())).toEqual({ kind: 'limit' });
    expect(client.calls.some(({ sql }) => sql.includes('INSERT INTO "extension_command_grants"')))
      .toBe(false);
  });

  it('retries a serializable transaction conflict before exposing failure', async () => {
    let attempts = 0;
    const tx = new ScriptedClient((sql) => {
      if (sql.includes('FROM "extension_device_sessions"')) return [{ id: 'session-1' }];
      if (sql.includes('FROM "extension_command_grants"') && sql.includes('"idempotency_key"')) return [];
      if (sql.includes('COUNT(*)')) return [{ count: 0n }];
      if (sql.includes('INSERT INTO "extension_command_grants"')) return [grant()];
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const client = {
      $queryRawUnsafe: tx.$queryRawUnsafe.bind(tx),
      async $transaction<T>(action: (client: ScriptedClient) => Promise<T>, options: unknown) {
        attempts += 1;
        if (attempts === 1) throw Object.assign(new Error('serialization conflict'), { code: 'P2034' });
        expect(options).toEqual({ isolationLevel: 'Serializable' });
        return action(tx);
      },
    };
    const store = createPrismaExtensionCommandGrantStore({ client: client as never });

    expect(await store.issueGrant(grant())).toMatchObject({ kind: 'issued' });
    expect(attempts).toBe(2);
  });

  it('recognizes PostgreSQL SQLSTATE nested inside a Prisma raw-query error', async () => {
    let attempts = 0;
    const tx = new ScriptedClient((sql) => {
      if (sql.includes('FROM "extension_device_sessions"')) return [{ id: 'session-1' }];
      if (sql.includes('FROM "extension_command_grants"') && sql.includes('"idempotency_key"')) return [];
      if (sql.includes('COUNT(*)')) return [{ count: 0n }];
      if (sql.includes('INSERT INTO "extension_command_grants"')) return [grant()];
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const client = {
      $queryRawUnsafe: tx.$queryRawUnsafe.bind(tx),
      async $transaction<T>(action: (client: ScriptedClient) => Promise<T>) {
        attempts += 1;
        if (attempts === 1) {
          throw Object.assign(new Error('raw query serialization conflict'), {
            code: 'P2010',
            meta: { code: '40001' },
          });
        }
        return action(tx);
      },
    };
    const store = createPrismaExtensionCommandGrantStore({ client: client as never });

    expect(await store.issueGrant(grant())).toMatchObject({ kind: 'issued' });
    expect(attempts).toBe(2);
  });

  it('issues once and uses the persisted binding for an exact issuance retry', async () => {
    let insertReturnsRow = true;
    const client = new ScriptedClient((sql) => {
      if (sql.includes('FROM "extension_device_sessions"')) return [{ id: 'session-1' }];
      if (sql.includes('FROM "extension_command_grants"') && sql.includes('"idempotency_key"')) {
        return insertReturnsRow ? [] : [grant()];
      }
      if (sql.includes('COUNT(*)')) return [{ count: 0n }];
      if (sql.includes('INSERT INTO "extension_command_grants"')) {
        if (insertReturnsRow) {
          insertReturnsRow = false;
          return [grant()];
        }
        return [];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const store = createPrismaExtensionCommandGrantStore({ client: client as never });

    expect(await store.issueGrant(grant())).toMatchObject({ kind: 'issued', grant: { id: 'grant-1' } });
    expect(await store.issueGrant(grant({ id: 'grant-retry' })))
      .toMatchObject({ kind: 'replay', grant: { id: 'grant-1' } });

    expect(client.transactionOptions).toEqual([
      { isolationLevel: 'Serializable' },
      { isolationLevel: 'Serializable' },
    ]);
    expect(client.calls.find(({ sql }) => sql.includes('INSERT INTO "extension_command_grants"'))?.sql)
      .toContain('ON CONFLICT ("session_id", "idempotency_key") DO NOTHING');
    expect(client.calls[0]?.sql).toContain('FOR UPDATE');
  });

  it('conflicts when the same session idempotency key is bound to another payload', async () => {
    const client = new ScriptedClient((sql) => {
      if (sql.includes('FROM "extension_device_sessions"')) return [{ id: 'session-1' }];
      if (sql.includes('FROM "extension_command_grants"')) return [grant()];
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const store = createPrismaExtensionCommandGrantStore({ client: client as never });

    expect(await store.issueGrant(grant({ requestHash: 'c'.repeat(64) }))).toEqual({ kind: 'conflict' });
  });

  it('atomically renews an exact unconsumed grant for the current token', async () => {
    const expired = grant({
      tokenId: 'jti-old',
      issuedAt: new Date(NOW.getTime() - 120_000),
      expiresAt: new Date(NOW.getTime() - 60_000),
    });
    const renewed = {
      ...expired,
      tokenId: 'jti-2',
      issuedAt: LATER,
      expiresAt: new Date(LATER.getTime() + 60_000),
    };
    const client = new ScriptedClient((sql) => {
      if (sql.includes('FROM "extension_device_sessions"') && sql.includes('FOR UPDATE')) {
        return [{ id: 'session-1' }];
      }
      if (sql.includes('FROM "extension_command_grants"') && sql.includes('"idempotency_key"')) {
        return [expired];
      }
      if (sql.includes('UPDATE "extension_command_grants"')
        && sql.includes('SET "token_id"')) return [renewed];
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const store = createPrismaExtensionCommandGrantStore({ client: client as never });

    await expect(store.issueGrant(grant({
      tokenId: 'jti-2',
      issuedAt: LATER,
      expiresAt: new Date(LATER.getTime() + 60_000),
    }))).resolves.toEqual({ kind: 'renewed', grant: renewed });
    expect(client.calls.find(({ sql }) => sql.includes('SET "token_id"'))?.sql)
      .toContain('"consumed_at" IS NULL');
  });

  it('locks live authorization and atomically creates one pending receipt', async () => {
    const client = new ScriptedClient((sql) => {
      if (sql.includes('FROM "extension_command_grants" g')) return [grantRow()];
      if (sql.includes('FROM "extension_command_receipts"')) return [];
      if (sql.includes('FROM "extension_device_shop_grants"')) {
        return [{ shopGrantStatus: 'ACTIVE', shopOwnerUserId: 'owner-1', shopStatus: 'ACTIVE', platform: 'OZON' }];
      }
      if (sql.includes('UPDATE "extension_command_grants"')) return [{ id: 'grant-1' }];
      if (sql.includes('INSERT INTO "extension_command_receipts"')) return [pendingReceipt()];
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const store = createPrismaExtensionCommandGrantStore({ client: client as never });

    const result = await store.consumeOrReplay({
      tokenDigest: 'b'.repeat(64),
      binding: binding(),
      receiptId: 'receipt-1',
      now: NOW,
    });

    expect(result).toEqual({ kind: 'execute', receipt: pendingReceipt() });
    expect(client.transactionOptions).toEqual([{ isolationLevel: 'Serializable' }]);
    expect(client.calls[0]?.sql).toContain('FOR UPDATE OF g, s, owner_account, actor_account');
    expect(client.calls[2]?.sql).toContain('FOR UPDATE OF sg, sh');
    expect(client.calls.map(({ sql }) => sql)).toEqual(expect.arrayContaining([
      expect.stringContaining('UPDATE "extension_command_grants"'),
      expect.stringContaining('INSERT INTO "extension_command_receipts"'),
    ]));
    expect(client.calls.find(({ sql }) => sql.includes('INSERT INTO "extension_command_receipts"'))?.sql)
      .toContain('"recovery_not_before"');
  });

  it('atomically leases one PENDING receipt recovery attempt', async () => {
    let acquired = true;
    const client = new ScriptedClient((sql) => {
      if (sql.includes('UPDATE "extension_command_receipts"')
        && sql.includes('"recovery_not_before"')) {
        if (acquired) {
          acquired = false;
          return [pendingReceipt()];
        }
        return [];
      }
      if (sql.includes('FROM "extension_command_receipts"')) return [pendingReceipt()];
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const store = createPrismaExtensionCommandGrantStore({ client: client as never });
    const recoveryNotBefore = new Date(LATER.getTime() + 60_000);

    await expect(store.claimPendingRecovery({
      receiptId: 'receipt-1', now: LATER, recoveryNotBefore,
    })).resolves.toMatchObject({ kind: 'acquired', receipt: { id: 'receipt-1' } });
    await expect(store.claimPendingRecovery({
      receiptId: 'receipt-1', now: LATER, recoveryNotBefore,
    })).resolves.toMatchObject({ kind: 'not_ready', receipt: { id: 'receipt-1' } });
    expect(client.calls[0]?.sql).toContain('"recovery_not_before" <= $3');
  });

  it('fails closed on a live scope change without consuming the grant', async () => {
    const client = new ScriptedClient((sql) => {
      if (sql.includes('FROM "extension_command_grants" g')) {
        return [grantRow({ scopes: ['listing:review'] })];
      }
      if (sql.includes('FROM "extension_command_receipts"')) return [];
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const store = createPrismaExtensionCommandGrantStore({ client: client as never });

    expect(await store.consumeOrReplay({
      tokenDigest: 'b'.repeat(64),
      binding: binding(),
      receiptId: 'receipt-1',
      now: NOW,
    })).toEqual({ kind: 'scope_denied' });
    expect(client.calls.some(({ sql }) => sql.includes('UPDATE "extension_command_grants"'))).toBe(false);
  });

  it.each([
    [{ currentJti: 'rotated-jti' }, 'session_invalid'],
    [{ ownerRole: 'STAFF' }, 'session_invalid'],
    [{ actorRole: 'STAFF' }, 'session_invalid'],
  ] as const)('fails closed on live identity drift %j', async (changed, expectedKind) => {
    const client = new ScriptedClient((sql) => {
      if (sql.includes('FROM "extension_command_grants" g')) return [grantRow(changed)];
      if (sql.includes('FROM "extension_command_receipts"')) return [];
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const store = createPrismaExtensionCommandGrantStore({ client: client as never });

    expect(await store.consumeOrReplay({
      tokenDigest: 'b'.repeat(64),
      binding: binding(),
      receiptId: 'receipt-1',
      now: NOW,
    })).toEqual({ kind: expectedKind });
  });

  it('replays a persisted receipt before rechecking an expired grant', async () => {
    const receipt = { ...pendingReceipt(), status: 'SUCCEEDED', result: { attemptId: 'attempt-1' }, completedAt: NOW };
    const client = new ScriptedClient((sql) => {
      if (sql.includes('FROM "extension_command_grants" g')) return [grantRow()];
      if (sql.includes('FROM "extension_command_receipts"')) return [receipt];
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const store = createPrismaExtensionCommandGrantStore({ client: client as never });

    expect(await store.consumeOrReplay({
      tokenDigest: 'b'.repeat(64),
      binding: binding(),
      receiptId: 'unused-receipt',
      now: LATER,
    })).toEqual({ kind: 'replay', receipt });
    expect(client.calls).toHaveLength(2);
  });

  it('replays a persisted receipt after the device access token rotates', async () => {
    const receipt = {
      ...pendingReceipt(), status: 'SUCCEEDED', result: { action: 'REVIEW' }, completedAt: NOW,
    };
    const client = new ScriptedClient((sql) => {
      if (sql.includes('FROM "extension_command_grants" g')) {
        return [grantRow({ tokenId: 'jti-1', currentJti: 'jti-2' })];
      }
      if (sql.includes('FROM "extension_command_receipts"')) return [receipt];
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const store = createPrismaExtensionCommandGrantStore({ client: client as never });

    await expect(store.consumeOrReplay({
      tokenDigest: 'b'.repeat(64),
      binding: binding({ tokenId: 'jti-2' }),
      receiptId: 'unused-receipt',
      now: LATER,
    })).resolves.toEqual({ kind: 'replay', receipt });
  });

  it.each([
    ['SUCCEEDED', null, { attemptId: 'attempt-1' }],
    ['FAILED', 'OZON_SUBMIT_TIMEOUT', { state: 'UNKNOWN' }],
  ] as const)('finalizes a pending receipt as %s exactly once', async (status, failureCode, result) => {
    const completed = { ...pendingReceipt(), status, failureCode, result, completedAt: LATER };
    const client = new ScriptedClient((sql) => {
      if (sql.includes('FROM "extension_command_receipts"') && sql.includes('FOR UPDATE')) {
        return [pendingReceipt()];
      }
      if (sql.includes('UPDATE "extension_command_receipts"')) return [completed];
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const store = createPrismaExtensionCommandGrantStore({ client: client as never });

    expect(await store.completeReceipt({
      receiptId: 'receipt-1',
      status,
      result,
      failureCode,
      now: LATER,
    })).toEqual({ kind: 'completed', receipt: completed });
    expect(client.transactionOptions).toEqual([{ isolationLevel: 'Serializable' }]);
  });
});
