import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveExtensionDeviceAuthConfig } from '../lib/extension-device-auth.js';
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

async function seedOwnerAndShop(client: PrismaClient, label: string) {
  const prefix = `device_${label}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const ownerUserId = `${prefix}_owner`;
  const shopId = `${prefix}_shop`;
  await client.$executeRawUnsafe(
    'INSERT INTO "users" ("id", "phone", "password_hash", "updated_at") VALUES ($1, $2, $3, CURRENT_TIMESTAMP)',
    ownerUserId, `${prefix}_phone`, 'test-password-hash',
  );
  await client.$executeRawUnsafe(
    'INSERT INTO "shops" ("id", "user_id", "platform", "name", "api_key_encrypted", "updated_at") VALUES ($1, $2, \'OZON\', $3, $4, CURRENT_TIMESTAMP)',
    shopId, ownerUserId, `${prefix} shop`, 'encrypted-test-key',
  );
  return { prefix, ownerUserId, shopId };
}

function serviceFor(client: PrismaClient) {
  const repository = createPrismaExtensionDeviceSessionRepository({
    client,
    consumePairingClaimAttemptBudget: async () => true,
  });
  return {
    repository,
    service: createExtensionDeviceSessionService({ repository, authConfig }),
  };
}

describePostgres('extension device PostgreSQL integration', () => {
  let first: PrismaClient;
  let second: PrismaClient;

  beforeAll(async () => {
    const expectedSchema = assertIsolatedSchema(testDatabaseUrl);
    first = new PrismaClient({ datasourceUrl: testDatabaseUrl });
    second = new PrismaClient({ datasourceUrl: testDatabaseUrl });
    const schemaRows = await first.$queryRawUnsafe<Array<{ schema: string }>>('SELECT current_schema() AS schema');
    expect(schemaRows[0]?.schema).toBe(expectedSchema);
    const migrations = await first.$queryRawUnsafe<Array<{ migration_name: string }>>(
      `SELECT "migration_name" FROM "_prisma_migrations"
       WHERE "migration_name" = '20260712170500_add_extension_device_sessions' AND "finished_at" IS NOT NULL`,
    );
    expect(migrations).toHaveLength(1);
  }, 30_000);

  afterAll(async () => {
    await Promise.all([first?.$disconnect(), second?.$disconnect()]);
  });

  it('allows exactly one of two concurrent claims for one pairing code', async () => {
    const seed = await seedOwnerAndShop(first, 'claim');
    const firstClient = serviceFor(first);
    const secondClient = serviceFor(second);
    const pairing = await firstClient.service.createPairingCode({
      actorUserId: seed.ownerUserId,
      ownerUserId: seed.ownerUserId,
      actorParentId: null,
      shopIds: [seed.shopId],
    });

    const claim = {
      code: pairing.code,
      deviceId: `${seed.prefix}_device`,
      deploymentId: authConfig.deploymentId,
    };
    const results = await Promise.allSettled([
      firstClient.service.claimPairingCode(claim),
      secondClient.service.claimPairingCode(claim),
    ]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    const rows = await first.$queryRawUnsafe<Array<{ count: bigint }>>(
      'SELECT COUNT(*) AS count FROM "extension_device_sessions" WHERE "owner_user_id" = $1',
      seed.ownerUserId,
    );
    expect(Number(rows[0]?.count || 0)).toBe(1);
  });

  it('revokes a refresh family and records one sanitized event after old-token reuse', async () => {
    const seed = await seedOwnerAndShop(first, 'reuse');
    const { repository, service } = serviceFor(first);
    const pairing = await service.createPairingCode({
      actorUserId: seed.ownerUserId,
      ownerUserId: seed.ownerUserId,
      actorParentId: null,
      shopIds: [seed.shopId],
    });
    const claimed = await service.claimPairingCode({
      code: pairing.code,
      deviceId: `${seed.prefix}_device`,
      deploymentId: authConfig.deploymentId,
    });
    await service.refresh({ refreshToken: claimed.refreshToken });

    await expect(service.refresh({ refreshToken: claimed.refreshToken }))
      .rejects.toMatchObject({ code: 'refresh_reuse_detected', statusCode: 401 });
    const live = await repository.loadAuthorization(claimed.session.id);
    expect(live?.status).toBe('REVOKED');
    const events = await first.$queryRawUnsafe<Array<{ type: string; reasonCode: string }>>(
      `SELECT "type"::text AS "type", "reason_code"::text AS "reasonCode"
       FROM "extension_device_security_events" WHERE "session_id" = $1 ORDER BY "type" ASC`,
      claimed.session.id,
    );
    expect(events).toEqual([
      { type: 'PAIRING_CLAIMED', reasonCode: 'PAIRING_APPROVED' },
      { type: 'REFRESH_REUSE_DETECTED', reasonCode: 'REFRESH_REUSE_DETECTED' },
      { type: 'SESSION_REVOKED', reasonCode: 'REFRESH_REUSE_DETECTED' },
    ]);
  });

  it('atomically replaces the active session when the same device updates its authorization', async () => {
    const seed = await seedOwnerAndShop(first, 'reauthorize');
    const { repository, service } = serviceFor(first);
    const firstPairing = await service.createPairingCode({
      actorUserId: seed.ownerUserId,
      ownerUserId: seed.ownerUserId,
      actorParentId: null,
      shopIds: [seed.shopId],
      scopes: ['byok:media:ingest'],
    });
    const deviceId = `${seed.prefix}_device`;
    const original = await service.claimPairingCode({
      code: firstPairing.code,
      deviceId,
      deploymentId: authConfig.deploymentId,
    });
    const replacementPairing = await service.createPairingCode({
      actorUserId: seed.ownerUserId,
      ownerUserId: seed.ownerUserId,
      actorParentId: null,
      shopIds: [seed.shopId],
      scopes: ['byok:media:ingest', 'listing:publish'],
    });
    const replacement = await service.claimPairingCode({
      code: replacementPairing.code,
      deviceId,
      deploymentId: authConfig.deploymentId,
    });

    expect(replacement.session.id).not.toBe(original.session.id);
    expect(replacement.session.scopes).toEqual(['byok:media:ingest', 'listing:publish']);
    expect((await repository.loadAuthorization(original.session.id))?.status).toBe('REVOKED');
    expect((await repository.loadAuthorization(replacement.session.id))?.status).toBe('ACTIVE');
    const lineage = await first.$queryRawUnsafe<Array<{ replacesSessionId: string | null }>>(
      `SELECT "replaces_session_id" AS "replacesSessionId"
       FROM "extension_device_sessions" WHERE "id" = $1`,
      replacement.session.id,
    );
    expect(lineage).toEqual([{ replacesSessionId: original.session.id }]);
    await expect(first.$executeRawUnsafe(
      `UPDATE "extension_device_sessions" SET "replaces_session_id" = NULL WHERE "id" = $1`,
      replacement.session.id,
    )).rejects.toThrow(/replacement lineage is immutable/u);
    const active = await first.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*) AS "count" FROM "extension_device_sessions"
       WHERE "owner_user_id" = $1 AND "device_id" = $2 AND "status" = 'ACTIVE'`,
      seed.ownerUserId, deviceId,
    );
    expect(Number(active[0]?.count || 0)).toBe(1);
    const matchBeforeRevocation = await first.$queryRawUnsafe<Array<{ matches: boolean }>>(
      `SELECT "extension_byok_publish_session_matches"($1, $2, $3, $3, $4) AS "matches"`,
      original.session.id,
      replacement.session.id,
      seed.ownerUserId,
      seed.shopId,
    );
    expect(matchBeforeRevocation).toEqual([{ matches: true }]);
    expect(await repository.revokeSession({
      sessionId: replacement.session.id,
      ownerUserId: seed.ownerUserId,
      actorUserId: seed.ownerUserId,
      reason: 'OWNER_REVOKED',
    })).toBe(true);
    const matchAfterRevocation = await first.$queryRawUnsafe<Array<{ matches: boolean }>>(
      `SELECT "extension_byok_publish_session_matches"($1, $2, $3, $3, $4) AS "matches"`,
      original.session.id,
      replacement.session.id,
      seed.ownerUserId,
      seed.shopId,
    );
    expect(matchAfterRevocation).toEqual([{ matches: true }]);
  });

  it('matches only an acyclic, fully validated replacement lineage of at most sixteen hops', async () => {
    const seed = await seedOwnerAndShop(first, 'bounded_lineage');
    const { service } = serviceFor(first);
    const deviceId = `${seed.prefix}_device`;
    const sessions: Array<{ id: string }> = [];
    for (let index = 0; index < 18; index += 1) {
      const pairing = await service.createPairingCode({
        actorUserId: seed.ownerUserId,
        ownerUserId: seed.ownerUserId,
        actorParentId: null,
        shopIds: [seed.shopId],
        scopes: ['byok:media:ingest', 'listing:publish'],
      });
      const claimed = await service.claimPairingCode({
        code: pairing.code,
        deviceId,
        deploymentId: authConfig.deploymentId,
      });
      sessions.push({ id: claimed.session.id });
    }
    const commandSessionId = sessions.at(-1)!.id;
    const match = async (provenanceSessionId: string) => {
      const rows = await first.$queryRawUnsafe<Array<{ matches: boolean }>>(
        `SELECT "extension_byok_publish_session_matches"($1, $2, $3, $3, $4) AS "matches"`,
        provenanceSessionId,
        commandSessionId,
        seed.ownerUserId,
        seed.shopId,
      );
      return rows[0]?.matches === true;
    };

    expect(await match(commandSessionId)).toBe(true);
    expect(await match(sessions[1]!.id)).toBe(true);
    expect(await match(sessions[0]!.id)).toBe(false);

    const unrelatedPairing = await service.createPairingCode({
      actorUserId: seed.ownerUserId,
      ownerUserId: seed.ownerUserId,
      actorParentId: null,
      shopIds: [seed.shopId],
      scopes: ['byok:media:ingest', 'listing:publish'],
    });
    const unrelated = await service.claimPairingCode({
      code: unrelatedPairing.code,
      deviceId: `${seed.prefix}_other_device`,
      deploymentId: authConfig.deploymentId,
    });
    expect(await match(unrelated.session.id)).toBe(false);

    await first.$executeRawUnsafe(
      `UPDATE "extension_device_sessions" SET "scopes" = ARRAY['byok:media:ingest']::TEXT[]
       WHERE "id" = $1`,
      commandSessionId,
    );
    try {
      expect(await match(sessions[1]!.id)).toBe(false);
    } finally {
      await first.$executeRawUnsafe(
        `UPDATE "extension_device_sessions"
         SET "scopes" = ARRAY['byok:media:ingest', 'listing:publish']::TEXT[]
         WHERE "id" = $1`,
        commandSessionId,
      );
    }

    const intermediateSessionId = sessions[8]!.id;
    await first.$executeRawUnsafe(
      `UPDATE "extension_device_sessions" SET "device_id" = $1 WHERE "id" = $2`,
      `${deviceId}_mismatch`, intermediateSessionId,
    );
    try {
      expect(await match(sessions[1]!.id)).toBe(false);
    } finally {
      await first.$executeRawUnsafe(
        `UPDATE "extension_device_sessions" SET "device_id" = $1 WHERE "id" = $2`,
        deviceId, intermediateSessionId,
      );
    }

    await first.$executeRawUnsafe(
      `UPDATE "extension_device_sessions" SET "revoked_reason" = 'OWNER_REVOKED' WHERE "id" = $1`,
      intermediateSessionId,
    );
    try {
      expect(await match(sessions[1]!.id)).toBe(false);
    } finally {
      await first.$executeRawUnsafe(
        `UPDATE "extension_device_sessions" SET "revoked_reason" = 'PAIRING_APPROVED' WHERE "id" = $1`,
        intermediateSessionId,
      );
    }

    await first.$executeRawUnsafe(
      `UPDATE "extension_device_sessions" SET "revoked_at" = '2099-01-01T00:00:00.000Z'
       WHERE "id" = $1`,
      intermediateSessionId,
    );
    try {
      expect(await match(sessions[1]!.id)).toBe(false);
    } finally {
      await first.$executeRawUnsafe(
        `UPDATE "extension_device_sessions" SET "revoked_at" = CURRENT_TIMESTAMP WHERE "id" = $1`,
        intermediateSessionId,
      );
    }

    await first.$executeRawUnsafe(
      `UPDATE "extension_device_sessions" SET "scopes" = ARRAY['listing:publish']::TEXT[] WHERE "id" = $1`,
      intermediateSessionId,
    );
    try {
      expect(await match(sessions[1]!.id)).toBe(false);
    } finally {
      await first.$executeRawUnsafe(
        `UPDATE "extension_device_sessions"
         SET "scopes" = ARRAY['byok:media:ingest', 'listing:publish']::TEXT[]
         WHERE "id" = $1`,
        intermediateSessionId,
      );
    }

    await first.$executeRawUnsafe(
      `ALTER TABLE "extension_device_shop_grants"
       DISABLE TRIGGER "extension_device_shop_grants_tombstone"`,
    );
    try {
      await first.$executeRawUnsafe(
        `UPDATE "extension_device_shop_grants" SET "status" = 'ACTIVE',
           "revoked_at" = NULL, "revoked_reason" = NULL
         WHERE "session_id" = $1 AND "shop_id" = $2`,
        intermediateSessionId, seed.shopId,
      );
      expect(await match(sessions[1]!.id)).toBe(false);
      await first.$executeRawUnsafe(
        `UPDATE "extension_device_shop_grants" SET "status" = 'REVOKED',
           "revoked_at" = '2099-01-01T00:00:00.000Z', "revoked_reason" = 'PAIRING_APPROVED'
         WHERE "session_id" = $1 AND "shop_id" = $2`,
        intermediateSessionId, seed.shopId,
      );
      expect(await match(sessions[1]!.id)).toBe(false);
    } finally {
      await first.$executeRawUnsafe(
        `UPDATE "extension_device_shop_grants" SET "status" = 'REVOKED',
           "revoked_at" = CURRENT_TIMESTAMP, "revoked_reason" = 'PAIRING_APPROVED'
         WHERE "session_id" = $1 AND "shop_id" = $2`,
        intermediateSessionId, seed.shopId,
      );
      await first.$executeRawUnsafe(
        `ALTER TABLE "extension_device_shop_grants"
         ENABLE TRIGGER "extension_device_shop_grants_tombstone"`,
      );
    }

    await first.$executeRawUnsafe(
      `ALTER TABLE "extension_device_sessions"
       DISABLE TRIGGER "prevent_extension_device_session_replacement_rewrite"`,
    );
    try {
      await first.$executeRawUnsafe(
        `UPDATE "extension_device_sessions" SET "replaces_session_id" = $1 WHERE "id" = $2`,
        commandSessionId, sessions[1]!.id,
      );
      expect(await match(sessions[1]!.id)).toBe(false);
    } finally {
      await first.$executeRawUnsafe(
        `UPDATE "extension_device_sessions" SET "replaces_session_id" = $1 WHERE "id" = $2`,
        sessions[0]!.id, sessions[1]!.id,
      );
      await first.$executeRawUnsafe(
        `ALTER TABLE "extension_device_sessions"
         ENABLE TRIGGER "prevent_extension_device_session_replacement_rewrite"`,
      );
    }
  }, 30_000);

  it('serializes two concurrent authorization replacements for the same device', async () => {
    const seed = await seedOwnerAndShop(first, 'concurrent_reauthorize');
    const firstClient = serviceFor(first);
    const secondClient = serviceFor(second);
    const pairings = await Promise.all([
      firstClient.service.createPairingCode({
        actorUserId: seed.ownerUserId,
        ownerUserId: seed.ownerUserId,
        actorParentId: null,
        shopIds: [seed.shopId],
        scopes: ['capture:write'],
      }),
      secondClient.service.createPairingCode({
        actorUserId: seed.ownerUserId,
        ownerUserId: seed.ownerUserId,
        actorParentId: null,
        shopIds: [seed.shopId],
        scopes: ['media:execute'],
      }),
    ]);
    const deviceId = `${seed.prefix}_device`;

    await Promise.all(pairings.map((pairing, index) => (
      (index === 0 ? firstClient : secondClient).service.claimPairingCode({
        code: pairing.code,
        deviceId,
        deploymentId: authConfig.deploymentId,
      })
    )));

    const active = await first.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*) AS "count" FROM "extension_device_sessions"
       WHERE "owner_user_id" = $1 AND "device_id" = $2 AND "status" = 'ACTIVE'`,
      seed.ownerUserId, deviceId,
    );
    expect(Number(active[0]?.count || 0)).toBe(1);
  });

  it('treats a transferred shop as a revoked known grant during live authorization', async () => {
    const seed = await seedOwnerAndShop(first, 'transfer');
    const { repository, service } = serviceFor(first);
    const pairing = await service.createPairingCode({
      actorUserId: seed.ownerUserId,
      ownerUserId: seed.ownerUserId,
      actorParentId: null,
      shopIds: [seed.shopId],
    });
    const claimed = await service.claimPairingCode({
      code: pairing.code,
      deviceId: `${seed.prefix}_device`,
      deploymentId: authConfig.deploymentId,
    });
    const newOwnerId = `${seed.prefix}_new_owner`;
    await first.$executeRawUnsafe(
      'INSERT INTO "users" ("id", "phone", "password_hash", "updated_at") VALUES ($1, $2, $3, CURRENT_TIMESTAMP)',
      newOwnerId, `${seed.prefix}_new_phone`, 'test-password-hash',
    );
    await first.$executeRawUnsafe('UPDATE "shops" SET "user_id" = $1 WHERE "id" = $2', newOwnerId, seed.shopId);

    const live = await repository.loadAuthorization(claimed.session.id);
    expect(live?.shopGrants).toEqual([{ shopId: seed.shopId, status: 'REVOKED' }]);
  });
});
