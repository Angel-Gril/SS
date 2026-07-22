import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveExtensionDeviceAuthConfig } from '../lib/extension-device-auth.js';
import type { ExtensionCommandGrantRecord } from '../services/extension-command-grants.js';
import { createPrismaExtensionCommandGrantStore } from '../services/extension-command-grants-prisma.js';
import { createExtensionDeviceSessionService } from '../services/extension-device-session.js';
import { createPrismaExtensionDeviceSessionRepository } from '../services/extension-device-session-prisma.js';

const testDatabaseUrl = process.env.LOGISTICS_TEST_DATABASE_URL || '';
const runRequested = process.env.RUN_LOGISTICS_POSTGRES_TESTS === '1';
const explicitRunner = process.env.npm_lifecycle_event === 'test:logistics:postgres';
if (explicitRunner && (!runRequested || !testDatabaseUrl)) {
  throw new Error(
    'test:logistics:postgres requires RUN_LOGISTICS_POSTGRES_TESTS=1 and LOGISTICS_TEST_DATABASE_URL',
  );
}
const enabled = runRequested && Boolean(testDatabaseUrl);
const describePostgres = enabled ? describe : describe.skip;

const authConfig = resolveExtensionDeviceAuthConfig({
  NODE_ENV: 'test',
  SS_ERP_DEPLOYMENT_ID: 'postgres-test-deployment',
  AUTH_JWT_ISSUER: 'ss-erp-postgres-test',
  EXTENSION_DEVICE_JWT_SECRET: 'postgres-device-secret-0123456789012345',
});

function assertIsolatedSchema(urlText: string): string {
  if (!urlText) throw new Error('LOGISTICS_TEST_DATABASE_URL is required');
  const schema = new URL(urlText).searchParams.get('schema') || '';
  if (!/^logistics_test_[a-z0-9_]+$/.test(schema)) {
    throw new Error('LOGISTICS_TEST_DATABASE_URL must target an isolated logistics_test_* schema');
  }
  return schema;
}

async function seedAuthorizedDevice(client: PrismaClient, label: string) {
  const prefix = `command_${label}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const ownerUserId = `${prefix}_owner`;
  const shopId = `${prefix}_shop`;
  await client.$executeRawUnsafe(
    'INSERT INTO "users" ("id", "phone", "password_hash", "updated_at") VALUES ($1, $2, $3, CURRENT_TIMESTAMP)',
    ownerUserId,
    `${prefix}_phone`,
    'test-password-hash',
  );
  await client.$executeRawUnsafe(
    'INSERT INTO "shops" ("id", "user_id", "platform", "name", "api_key_encrypted", "updated_at") VALUES ($1, $2, \'OZON\', $3, $4, CURRENT_TIMESTAMP)',
    shopId,
    ownerUserId,
    `${prefix} shop`,
    'encrypted-test-key',
  );

  const repository = createPrismaExtensionDeviceSessionRepository({
    client,
    consumePairingClaimAttemptBudget: async () => true,
  });
  const service = createExtensionDeviceSessionService({ repository, authConfig });
  const pairing = await service.createPairingCode({
    actorUserId: ownerUserId,
    ownerUserId,
    actorParentId: null,
    shopIds: [shopId],
  });
  const claimed = await service.claimPairingCode({
    code: pairing.code,
    deviceId: `${prefix}_device`,
    deploymentId: authConfig.deploymentId,
  });
  await client.$executeRawUnsafe(
    'UPDATE "extension_device_sessions" SET "scopes" = $1::text[], "updated_at" = CURRENT_TIMESTAMP WHERE "id" = $2',
    ['listing:publish'],
    claimed.session.id,
  );
  return {
    prefix,
    ownerUserId,
    shopId,
    sessionId: claimed.session.id,
    tokenId: claimed.session.currentJti,
  };
}

function commandGrant(
  seed: Awaited<ReturnType<typeof seedAuthorizedDevice>>,
  overrides: Partial<ExtensionCommandGrantRecord> = {},
): ExtensionCommandGrantRecord {
  const now = new Date();
  return {
    id: randomUUID(),
    sessionId: seed.sessionId,
    tokenId: seed.tokenId,
    ownerUserId: seed.ownerUserId,
    shopId: seed.shopId,
    operation: 'OZON_PUBLISH',
    workflowId: `${seed.prefix}_workflow`,
    draftVersion: 1,
    idempotencyKey: `${seed.prefix}_publish_v1`,
    requestHash: 'a'.repeat(64),
    tokenDigest: randomUUID().replaceAll('-', '').padEnd(64, '0').slice(0, 64),
    issuedAt: now,
    expiresAt: new Date(now.getTime() + 5 * 60_000),
    consumedAt: null,
    revokedAt: null,
    revokedReason: null,
    ...overrides,
  };
}

function commandBinding(grant: ExtensionCommandGrantRecord) {
  return {
    sessionId: grant.sessionId,
    tokenId: grant.tokenId,
    ownerUserId: grant.ownerUserId,
    shopId: grant.shopId,
    operation: grant.operation,
    workflowId: grant.workflowId,
    draftVersion: grant.draftVersion,
    idempotencyKey: grant.idempotencyKey,
    requestHash: grant.requestHash,
  };
}

describePostgres('extension command grant PostgreSQL integration', () => {
  let first: PrismaClient;
  let second: PrismaClient;

  beforeAll(async () => {
    const expectedSchema = assertIsolatedSchema(testDatabaseUrl);
    first = new PrismaClient({ datasourceUrl: testDatabaseUrl });
    second = new PrismaClient({ datasourceUrl: testDatabaseUrl });
    const schemaRows = await first.$queryRawUnsafe<Array<{ schema: string }>>(
      'SELECT current_schema() AS schema',
    );
    expect(schemaRows[0]?.schema).toBe(expectedSchema);
    const migrations = await first.$queryRawUnsafe<Array<{ migration_name: string }>>(
      `SELECT "migration_name" FROM "_prisma_migrations"
       WHERE "migration_name" = '20260714190000_add_extension_command_grants'
         AND "finished_at" IS NOT NULL`,
    );
    expect(migrations).toHaveLength(1);
  }, 30_000);

  afterAll(async () => {
    await Promise.all([first?.$disconnect(), second?.$disconnect()]);
  });

  it('converges concurrent exact issuance and rejects a changed-payload retry', async () => {
    const seed = await seedAuthorizedDevice(first, 'issue');
    const firstStore = createPrismaExtensionCommandGrantStore({ client: first });
    const secondStore = createPrismaExtensionCommandGrantStore({ client: second });
    const firstGrant = commandGrant(seed);
    const secondGrant = commandGrant(seed);

    const results = await Promise.all([
      firstStore.issueGrant(firstGrant),
      secondStore.issueGrant(secondGrant),
    ]);

    expect(results.map(({ kind }) => kind).sort()).toEqual(['issued', 'replay']);
    expect(new Set(results.flatMap((result) => ('grant' in result ? [result.grant.id] : []))).size).toBe(1);
    expect(await secondStore.issueGrant(commandGrant(seed, { requestHash: 'c'.repeat(64) })))
      .toEqual({ kind: 'conflict' });
    const rows = await first.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*) AS count FROM "extension_command_grants"
       WHERE "session_id" = $1 AND "idempotency_key" = $2`,
      seed.sessionId,
      firstGrant.idempotencyKey,
    );
    expect(Number(rows[0]?.count || 0)).toBe(1);
  });

  it('renews only unconsumed exact grants and replays receipts across token rotation', async () => {
    const seed = await seedAuthorizedDevice(first, 'renew');
    const store = createPrismaExtensionCommandGrantStore({ client: first });
    const issuedAt = new Date(Date.now() - 120_000);
    const original = commandGrant(seed, {
      issuedAt,
      expiresAt: new Date(issuedAt.getTime() + 60_000),
    });
    const issued = await store.issueGrant(original);
    if (!('grant' in issued)) throw new Error('expected initial command grant');
    const currentTokenId = `${seed.prefix}_rotated_jti`;
    await first.$executeRawUnsafe(
      'UPDATE "extension_device_sessions" SET "current_jti" = $1, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = $2',
      currentTokenId,
      seed.sessionId,
    );
    const renewalTime = new Date();
    const renewed = await store.issueGrant(commandGrant(seed, {
      tokenId: currentTokenId,
      issuedAt: renewalTime,
      expiresAt: new Date(renewalTime.getTime() + 60_000),
    }));
    expect(renewed).toMatchObject({
      kind: 'renewed',
      grant: { id: issued.grant.id, tokenId: currentTokenId, consumedAt: null },
    });
    if (!('grant' in renewed)) throw new Error('expected renewed command grant');

    const consumed = await store.consumeOrReplay({
      tokenDigest: renewed.grant.tokenDigest,
      binding: commandBinding(renewed.grant),
      receiptId: randomUUID(),
      now: new Date(),
    });
    if (consumed.kind !== 'execute') throw new Error('expected executable renewed grant');
    const completed = await store.completeReceipt({
      receiptId: consumed.receipt.id,
      status: 'SUCCEEDED',
      result: { action: 'REVIEW' },
      failureCode: null,
      now: new Date(),
    });
    expect(completed).toMatchObject({ kind: 'completed' });

    const nextTokenId = `${seed.prefix}_next_jti`;
    await first.$executeRawUnsafe(
      'UPDATE "extension_device_sessions" SET "current_jti" = $1, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = $2',
      nextTokenId,
      seed.sessionId,
    );
    const replayGrant = await store.issueGrant(commandGrant(seed, { tokenId: nextTokenId }));
    expect(replayGrant).toMatchObject({ kind: 'replay', grant: { id: issued.grant.id } });
    await expect(store.consumeOrReplay({
      tokenDigest: renewed.grant.tokenDigest,
      binding: { ...commandBinding(renewed.grant), tokenId: nextTokenId },
      receiptId: randomUUID(),
      now: new Date(),
    })).resolves.toMatchObject({ kind: 'replay', receipt: { status: 'SUCCEEDED' } });
  }, 30_000);

  it('keeps the durable command binding immutable', async () => {
    const seed = await seedAuthorizedDevice(first, 'immutable_binding');
    const store = createPrismaExtensionCommandGrantStore({ client: first });
    const issued = await store.issueGrant(commandGrant(seed));
    if (!('grant' in issued)) throw new Error('expected issued immutable-binding grant');

    const mutations = [
      () => first.$executeRawUnsafe(
        'UPDATE "extension_command_grants" SET "request_hash" = $2 WHERE "id" = $1',
        issued.grant.id,
        'f'.repeat(64),
      ),
      () => first.$executeRawUnsafe(
        'UPDATE "extension_command_grants" SET "workflow_id" = $2 WHERE "id" = $1',
        issued.grant.id,
        `${seed.prefix}_other_workflow`,
      ),
      () => first.$executeRawUnsafe(
        'UPDATE "extension_command_grants" SET "idempotency_key" = $2 WHERE "id" = $1',
        issued.grant.id,
        `${seed.prefix}_other_operation_key`,
      ),
    ];
    for (const mutation of mutations) {
      await expect(mutation()).rejects.toThrow(/extension command grant binding is immutable/iu);
    }

    const rows = await first.$queryRawUnsafe<Array<{
      workflowId: string | null;
      idempotencyKey: string;
      requestHash: string;
    }>>(
      `SELECT "workflow_id" AS "workflowId",
              "idempotency_key" AS "idempotencyKey",
              "request_hash" AS "requestHash"
       FROM "extension_command_grants"
       WHERE "id" = $1`,
      issued.grant.id,
    );
    expect(rows[0]).toEqual({
      workflowId: issued.grant.workflowId,
      idempotencyKey: issued.grant.idempotencyKey,
      requestHash: issued.grant.requestHash,
    });
  });

  it('rejects renewal of consumed, revoked, or receipt-bound grants', async () => {
    type RenewalFixture = {
      grant: ExtensionCommandGrantRecord;
      nextTokenId: string;
      renewalTime: Date;
    };
    const fixtures: RenewalFixture[] = [];

    async function renewableGrant(label: string): Promise<RenewalFixture> {
      const seed = await seedAuthorizedDevice(first, label);
      const store = createPrismaExtensionCommandGrantStore({ client: first });
      const result = await store.issueGrant(commandGrant(seed));
      if (!('grant' in result)) throw new Error(`expected issued ${label} grant`);
      const nextTokenId = `${seed.prefix}_renewal_jti`;
      await first.$executeRawUnsafe(
        'UPDATE "extension_device_sessions" SET "current_jti" = $1, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = $2',
        nextTokenId,
        seed.sessionId,
      );
      return {
        grant: result.grant,
        nextTokenId,
        renewalTime: new Date(Math.max(Date.now(), result.grant.issuedAt.getTime() + 1)),
      };
    }

    const consumed = await renewableGrant('renew_consumed');
    await first.$executeRawUnsafe(
      'UPDATE "extension_command_grants" SET "consumed_at" = $2 WHERE "id" = $1',
      consumed.grant.id,
      consumed.renewalTime,
    );
    fixtures.push(consumed);

    const revoked = await renewableGrant('renew_revoked');
    const revokedStore = createPrismaExtensionCommandGrantStore({ client: first });
    await expect(revokedStore.revokeGrant({
      grantId: revoked.grant.id,
      ownerUserId: revoked.grant.ownerUserId,
      reason: 'OWNER_REVOKED',
      now: revoked.renewalTime,
    })).resolves.toMatchObject({ kind: 'revoked' });
    fixtures.push(revoked);

    const receiptBound = await renewableGrant('renew_receipt');
    const receiptCreatedAt = receiptBound.renewalTime;
    await first.$executeRawUnsafe(
      'UPDATE "extension_command_grants" SET "consumed_at" = $2 WHERE "id" = $1',
      receiptBound.grant.id,
      receiptCreatedAt,
    );
    await first.$executeRawUnsafe(
      `INSERT INTO "extension_command_receipts"
         ("id", "grant_id", "status", "result", "failure_code",
          "recovery_not_before", "created_at", "completed_at")
       VALUES ($1, $2, 'PENDING', NULL, NULL, $4, $3, NULL)`,
      randomUUID(),
      receiptBound.grant.id,
      receiptCreatedAt,
      new Date(receiptCreatedAt.getTime() + 60_000),
    );
    fixtures.push(receiptBound);

    for (const fixture of fixtures) {
      await expect(first.$executeRawUnsafe(
        `UPDATE "extension_command_grants"
         SET "token_id" = $2, "issued_at" = $3, "expires_at" = $4
         WHERE "id" = $1`,
        fixture.grant.id,
        fixture.nextTokenId,
        fixture.renewalTime,
        new Date(fixture.renewalTime.getTime() + 60_000),
      )).rejects.toThrow(/extension command grant renewal is invalid/iu);
    }

    const persisted = await first.$queryRawUnsafe<Array<{ id: string; tokenId: string }>>(
      `SELECT "id", "token_id" AS "tokenId"
       FROM "extension_command_grants"
       WHERE "id" = ANY($1::text[])
       ORDER BY "id"`,
      fixtures.map(({ grant }) => grant.id),
    );
    expect(persisted).toHaveLength(3);
    const expectedTokenIds = new Map(fixtures.map(({ grant }) => [grant.id, grant.tokenId]));
    expect(persisted.every(({ id, tokenId }) => expectedTokenIds.get(id) === tokenId)).toBe(true);
  }, 30_000);

  it('allows one concurrent consumer and replays the single durable receipt', async () => {
    const seed = await seedAuthorizedDevice(first, 'consume');
    const firstStore = createPrismaExtensionCommandGrantStore({ client: first });
    const secondStore = createPrismaExtensionCommandGrantStore({ client: second });
    const pending = commandGrant(seed);
    const issued = await firstStore.issueGrant(pending);
    if (!('grant' in issued)) throw new Error('expected issued command grant');
    const persisted = issued.grant;
    const binding = commandBinding(persisted);

    const results = await Promise.all([
      firstStore.consumeOrReplay({
        tokenDigest: persisted.tokenDigest,
        binding,
        receiptId: randomUUID(),
        now: new Date(),
      }),
      secondStore.consumeOrReplay({
        tokenDigest: persisted.tokenDigest,
        binding,
        receiptId: randomUUID(),
        now: new Date(),
      }),
    ]);

    expect(results.map(({ kind }) => kind).sort()).toEqual(['execute', 'replay']);
    const receiptIds = results.flatMap((result) => (
      result.kind === 'execute' || result.kind === 'replay' ? [result.receipt.id] : []
    ));
    expect(new Set(receiptIds).size).toBe(1);
    const rows = await first.$queryRawUnsafe<Array<{ count: bigint }>>(
      'SELECT COUNT(*) AS count FROM "extension_command_receipts" WHERE "grant_id" = $1',
      persisted.id,
    );
    expect(Number(rows[0]?.count || 0)).toBe(1);
  });

  it('leases one pending recovery across connections and keeps the lease monotonic', async () => {
    const seed = await seedAuthorizedDevice(first, 'recovery_lease');
    const firstStore = createPrismaExtensionCommandGrantStore({ client: first });
    const secondStore = createPrismaExtensionCommandGrantStore({ client: second });
    const issued = await firstStore.issueGrant(commandGrant(seed));
    if (!('grant' in issued)) throw new Error('expected issued recovery grant');
    const consumedAt = new Date();
    const consumed = await firstStore.consumeOrReplay({
      tokenDigest: issued.grant.tokenDigest,
      binding: commandBinding(issued.grant),
      receiptId: randomUUID(),
      now: consumedAt,
    });
    if (consumed.kind !== 'execute') throw new Error('expected pending recovery receipt');

    const initialRows = await first.$queryRawUnsafe<Array<{ recoveryNotBefore: Date }>>(
      `SELECT "recovery_not_before" AS "recoveryNotBefore"
       FROM "extension_command_receipts"
       WHERE "id" = $1`,
      consumed.receipt.id,
    );
    const initialLease = initialRows[0]?.recoveryNotBefore;
    if (!initialLease) throw new Error('expected initial recovery lease');
    const claimTime = new Date(initialLease.getTime() + 1);
    const nextLease = new Date(claimTime.getTime() + 60_000);

    const claims = await Promise.all([
      firstStore.claimPendingRecovery({
        receiptId: consumed.receipt.id,
        now: claimTime,
        recoveryNotBefore: nextLease,
      }),
      secondStore.claimPendingRecovery({
        receiptId: consumed.receipt.id,
        now: claimTime,
        recoveryNotBefore: nextLease,
      }),
    ]);
    expect(claims.map(({ kind }) => kind).sort()).toEqual(['acquired', 'not_ready']);

    const acquiredRows = await first.$queryRawUnsafe<Array<{ recoveryNotBefore: Date }>>(
      `SELECT "recovery_not_before" AS "recoveryNotBefore"
       FROM "extension_command_receipts"
       WHERE "id" = $1`,
      consumed.receipt.id,
    );
    expect(acquiredRows[0]?.recoveryNotBefore).toEqual(nextLease);

    for (const invalidLease of [nextLease, new Date(nextLease.getTime() - 1)]) {
      await expect(firstStore.claimPendingRecovery({
        receiptId: consumed.receipt.id,
        now: new Date(nextLease.getTime() + 1),
        recoveryNotBefore: invalidLease,
      })).rejects.toThrow(/pending extension command receipt recovery lease is invalid/iu);
    }
    const finalRows = await first.$queryRawUnsafe<Array<{ recoveryNotBefore: Date }>>(
      `SELECT "recovery_not_before" AS "recoveryNotBefore"
       FROM "extension_command_receipts"
       WHERE "id" = $1`,
      consumed.receipt.id,
    );
    expect(finalRows[0]?.recoveryNotBefore).toEqual(nextLease);
  }, 30_000);

  it('rechecks grant, session, current JTI, and scope immediately before consumption', async () => {
    const store = createPrismaExtensionCommandGrantStore({ client: first });
    type Seed = Awaited<ReturnType<typeof seedAuthorizedDevice>>;
    type Invalidate = (
      seed: Seed,
      grant: ExtensionCommandGrantRecord,
      target: ReturnType<typeof createPrismaExtensionCommandGrantStore>,
    ) => Promise<void>;

    async function expectRejected(
      label: string,
      expectedKind: 'expired' | 'revoked' | 'session_invalid' | 'scope_denied',
      invalidate: Invalidate | null,
      grantOverrides: Partial<ExtensionCommandGrantRecord> = {},
    ) {
      const seed = await seedAuthorizedDevice(first, label);
      const pending = commandGrant(seed, {
        ...grantOverrides,
        idempotencyKey: `${seed.prefix}_${label}_before_consume`,
      });
      const issued = await store.issueGrant(pending);
      if (!('grant' in issued)) throw new Error(`expected issued ${label} command grant`);
      const grant = issued.grant;

      if (invalidate) await invalidate(seed, grant, store);
      await expect(store.consumeOrReplay({
        tokenDigest: grant.tokenDigest,
        binding: commandBinding(grant),
        receiptId: randomUUID(),
        now: new Date(),
      })).resolves.toEqual({ kind: expectedKind });

      const rows = await first.$queryRawUnsafe<Array<{
        consumedAt: Date | null;
        receiptCount: bigint;
      }>>(
        `SELECT g."consumed_at" AS "consumedAt",
                (SELECT COUNT(*) FROM "extension_command_receipts" r
                 WHERE r."grant_id" = g."id") AS "receiptCount"
         FROM "extension_command_grants" g
         WHERE g."id" = $1`,
        grant.id,
      );
      expect(rows[0]?.consumedAt).toBeNull();
      expect(Number(rows[0]?.receiptCount || 0)).toBe(0);
    }

    const expiredIssuedAt = new Date(Date.now() - 120_000);
    await expectRejected('grant_expired', 'expired', null, {
      issuedAt: expiredIssuedAt,
      expiresAt: new Date(expiredIssuedAt.getTime() + 60_000),
    });

    await expectRejected('grant_revoked', 'revoked', async (seed, grant, target) => {
      await expect(target.revokeGrant({
        grantId: grant.id,
        ownerUserId: seed.ownerUserId,
        reason: 'OWNER_REVOKED',
        now: new Date(),
      })).resolves.toMatchObject({ kind: 'revoked' });
    });

    await expectRejected('session_revoked', 'session_invalid', async (seed) => {
      await first.$executeRawUnsafe(
        `UPDATE "extension_device_sessions"
         SET "status" = 'REVOKED', "revoked_at" = CURRENT_TIMESTAMP,
             "revoked_reason" = 'OWNER_REVOKED', "updated_at" = CURRENT_TIMESTAMP
         WHERE "id" = $1`,
        seed.sessionId,
      );
    });

    await expectRejected('session_expired', 'session_invalid', async (seed) => {
      await first.$executeRawUnsafe(
        `UPDATE "extension_device_sessions"
         SET "expires_at" = "created_at" + INTERVAL '1 millisecond',
             "updated_at" = CURRENT_TIMESTAMP
         WHERE "id" = $1`,
        seed.sessionId,
      );
    });

    await expectRejected('jti_rotated', 'session_invalid', async (seed) => {
      await first.$executeRawUnsafe(
        `UPDATE "extension_device_sessions"
         SET "current_jti" = $1, "updated_at" = CURRENT_TIMESTAMP
         WHERE "id" = $2`,
        `${seed.prefix}_rotated_jti`,
        seed.sessionId,
      );
    });

    await expectRejected('scope_revoked', 'scope_denied', async (seed) => {
      await first.$executeRawUnsafe(
        `UPDATE "extension_device_sessions"
         SET "scopes" = ARRAY['capture:write']::text[], "updated_at" = CURRENT_TIMESTAMP
         WHERE "id" = $1`,
        seed.sessionId,
      );
    });
  }, 30_000);
});
