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
