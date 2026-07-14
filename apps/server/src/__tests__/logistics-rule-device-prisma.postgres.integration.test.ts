import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import Fastify, { type FastifyRequest } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { logisticsRuleRoutes } from '../routes/logistics-rules.js';
import { createPrismaLogisticsRuleAdminRepository } from '../services/logistics-rule-admin-prisma.js';
import { createPrismaLogisticsRuleDeviceRepository } from '../services/logistics-rule-device-prisma.js';

const testDatabaseUrl = process.env.LOGISTICS_TEST_DATABASE_URL || '';
const runRequested = process.env.RUN_LOGISTICS_POSTGRES_TESTS === '1';
const enabled = runRequested && Boolean(testDatabaseUrl);
const describePostgres = enabled ? describe : describe.skip;

function assertIsolatedSchema(urlText: string): string {
  if (!urlText) throw new Error('LOGISTICS_TEST_DATABASE_URL is required');
  const schema = new URL(urlText).searchParams.get('schema') || '';
  if (!/^logistics_test_[a-z0-9_]+$/.test(schema)) {
    throw new Error('LOGISTICS_TEST_DATABASE_URL must target an isolated logistics_test_* schema');
  }
  return schema;
}

interface Seed {
  prefix: string;
  ownerUserId: string;
  shopId: string;
  warehouseId: string;
  deliveryMethodId: string;
  methodBindingId: string;
  channelId: string;
  revisionId: string;
  assignmentId: string;
  releaseId: string;
  contentChecksum: string;
  effectiveChecksum: string;
  scopeKey: string;
  sessionId: string;
}

const uniquePrefix = (label: string) =>
  `device_dist_${label}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

async function seedDeviceScope(
  client: PrismaClient,
  label: string,
  options: { publishRelease?: boolean } = {},
): Promise<Seed> {
  const prefix = uniquePrefix(label);
  const ownerUserId = `${prefix}_owner`;
  const shopId = `${prefix}_shop`;
  const warehouseId = `${prefix}_warehouse`;
  const deliveryMethodId = `${prefix}_delivery_method`;
  const methodBindingId = `${prefix}_method_binding`;
  const stableServiceKey = `${prefix}_service`;
  const companyBindingId = `${prefix}_company_binding`;
  const originBindingId = `${prefix}_origin_binding`;
  const channelId = `${prefix}_channel`;
  const revisionId = `${prefix}_revision`;
  const assignmentId = `${prefix}_assignment`;
  const releaseId = `${prefix}_release`;
  const sessionId = `${prefix}_session`;
  const contentChecksum = digest(`${prefix}:content`);
  const effectiveChecksum = digest(`${prefix}:effective`);
  const scopeKey = `${prefix}/scope/v1`;
  const frozenPayload = {
    scope: { tenantId: ownerUserId, shopId, warehouseId },
    manifest: { minimumExtensionVersion: '1.2.0' },
    revisionPayload: { formulas: [{ stableServiceKey }] },
    deliveryMethodBindings: [{
      id: methodBindingId,
      deliveryMethodId,
      stableServiceKey,
      sourceRevisionId: revisionId,
      confirmedById: ownerUserId,
      confirmedAt: '2026-07-12T10:00:00.000Z',
    }],
  };

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
  await client.$executeRawUnsafe(
    'INSERT INTO "warehouses" ("id", "shop_id", "name", "status", "updated_at") VALUES ($1, $2, $3, \'active\', CURRENT_TIMESTAMP)',
    warehouseId,
    shopId,
    `${prefix} warehouse`,
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "shop_ozon_company_bindings"
      ("id", "tenant_id", "shop_id", "ozon_company_id", "status", "open_api_verified_at",
       "seller_probe_verified_at", "open_api_intersection_verified_at", "verified_by_id", "verified_at", "updated_at")
     VALUES ($1, $2, $3, $4, 'VERIFIED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
       $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    companyBindingId,
    ownerUserId,
    shopId,
    `${prefix}_company`,
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "warehouse_ozon_origin_bindings"
      ("id", "tenant_id", "shop_id", "warehouse_id", "origin_country_uid", "origin_city_uid",
       "origin_country_code", "origin_label", "status", "open_api_address_verified_at",
       "official_location_verified_at", "verified_by_id", "verified_at", "updated_at")
     VALUES ($1, $2, $3, $4, 'china', 'xiamen', 'CN', 'China / Xiamen', 'VERIFIED',
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    originBindingId,
    ownerUserId,
    shopId,
    warehouseId,
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "logistics_rule_channels"
      ("id", "channel_type", "deployment_id", "schema_major",
       "tenant_id", "shop_id", "warehouse_id", "ozon_company_id",
       "origin_country_uid", "origin_city_uid", "origin_country_code", "origin_label",
       "company_binding_id", "origin_binding_id", "scope_key", "updated_at")
     VALUES ($1, 'TENANT', 'postgres-test-deployment', 1,
       $2, $3, $4, $5, 'china', 'xiamen', 'CN', 'China / Xiamen',
       $6, $7, $8, CURRENT_TIMESTAMP)`,
    channelId,
    ownerUserId,
    shopId,
    warehouseId,
    `${prefix}_company`,
    companyBindingId,
    originBindingId,
    scopeKey,
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "logistics_rule_revisions"
      ("id", "revision_key", "source_owner_type", "source_tenant_id", "confidentiality",
       "content_checksum", "payload", "schema_version", "validation_status", "validation_report",
       "validated_at", "validation_valid_until")
     VALUES ($1, $2, 'TENANT', $3, 'TENANT_PRIVATE', $4, '{}'::jsonb, '1', 'PASSED', '{}'::jsonb,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '7 days')`,
    revisionId,
    `${prefix}_revision_key`,
    ownerUserId,
    contentChecksum,
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "shop_delivery_methods"
      ("id", "warehouse_id", "platform_method_id", "name", "status", "provider_id", "updated_at")
     VALUES ($1, $2, 32673795, $3, 'active', 1280, CURRENT_TIMESTAMP)`,
    deliveryMethodId,
    warehouseId,
    `${prefix} delivery method`,
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "shop_delivery_method_rule_bindings"
      ("id", "tenant_id", "shop_id", "warehouse_id", "delivery_method_id",
       "stable_service_key", "source_revision_id", "status", "evidence",
       "confirmed_by_id", "confirmed_at", "updated_at")
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'CONFIRMED', '{}'::jsonb,
       $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    methodBindingId,
    ownerUserId,
    shopId,
    warehouseId,
    deliveryMethodId,
    stableServiceKey,
    revisionId,
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "logistics_rule_assignments"
      ("id", "tenant_id", "shop_id", "warehouse_id", "channel_id", "destination_country_uid",
       "destination_location_uid", "destination_country_code", "destination_label", "updated_at")
     VALUES ($1, $2, $3, $4, $5, 'russia', 'moscow', 'RU', 'Russia / Moscow', CURRENT_TIMESTAMP)`,
    assignmentId,
    ownerUserId,
    shopId,
    warehouseId,
    channelId,
  );
  if (options.publishRelease !== false) {
  await client.$executeRawUnsafe(
    `INSERT INTO "logistics_rule_releases"
      ("id", "channel_id", "sequence", "revision_id", "release_kind", "content_checksum",
       "effective_checksum", "frozen_payload", "validated_at", "validation_valid_until", "published_by_id")
     VALUES ($1, $2, 1, $3, 'PUBLISH', $4, $5, $6::jsonb, CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP + INTERVAL '7 days', $7)`,
    releaseId,
    channelId,
    revisionId,
    contentChecksum,
    effectiveChecksum,
    JSON.stringify(frozenPayload),
    ownerUserId,
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "logistics_rule_events"
      ("id", "tenant_id", "channel_id", "release_id", "subject_type", "subject_id", "actor_user_id",
       "type", "scope_snapshot", "facts")
     VALUES ($1, $2, $3, $4, 'RELEASE', $4, $2, 'PUBLISHED', '{}'::jsonb, '{}'::jsonb)`,
    `${prefix}_release_event`,
    ownerUserId,
    channelId,
    releaseId,
  );
  await client.$executeRawUnsafe(
    `UPDATE "logistics_rule_channels"
     SET "current_sequence" = 1, "current_release_id" = $1, "updated_at" = CURRENT_TIMESTAMP
     WHERE "id" = $2`,
    releaseId,
    channelId,
  );
  }
  await client.$executeRawUnsafe(
    `INSERT INTO "extension_device_pairing_codes"
      ("id", "deployment_id", "actor_user_id", "owner_user_id", "code_digest", "shop_ids", "scopes",
       "status", "expires_at", "claimed_at", "updated_at")
     VALUES ($1, 'postgres-test-deployment', $2, $2, $3, ARRAY[$4]::text[],
       ARRAY['logistics:discover','logistics:read','logistics:receipt']::text[], 'CLAIMED',
       CURRENT_TIMESTAMP + INTERVAL '7 days', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    `${prefix}_pairing`,
    ownerUserId,
    digest(`${prefix}:pairing`),
    shopId,
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "extension_device_sessions"
      ("id", "pairing_code_id", "deployment_id", "device_id", "actor_user_id", "owner_user_id",
       "status", "scopes", "current_jti", "expires_at", "updated_at")
     VALUES ($1, $2, 'postgres-test-deployment', $3, $4, $4, 'ACTIVE',
       ARRAY['logistics:discover','logistics:read','logistics:receipt']::text[], $5,
       CURRENT_TIMESTAMP + INTERVAL '7 days', CURRENT_TIMESTAMP)`,
    sessionId,
    `${prefix}_pairing`,
    `${prefix}_device`,
    ownerUserId,
    `${prefix}_jti`,
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "extension_device_shop_grants"
      ("id", "session_id", "shop_id", "status", "granted_at")
     VALUES ($1, $2, $3, 'ACTIVE', CURRENT_TIMESTAMP)`,
    `${prefix}_shop_grant`,
    sessionId,
    shopId,
  );

  return {
    prefix,
    ownerUserId,
    shopId,
    warehouseId,
    deliveryMethodId,
    methodBindingId,
    channelId,
    revisionId,
    assignmentId,
    releaseId,
    contentChecksum,
    effectiveChecksum,
    scopeKey,
    sessionId,
  };
}

const effectiveInput = (seed: Seed, now = new Date()) => ({
  sessionId: seed.sessionId,
  ownerUserId: seed.ownerUserId,
  allowedShopIds: [seed.shopId],
  assignmentId: seed.assignmentId,
  now,
});

const deliveryInput = (seed: Seed, now = new Date()) => ({
  sessionId: seed.sessionId,
  ownerUserId: seed.ownerUserId,
  allowedShopIds: [seed.shopId],
  assignmentId: seed.assignmentId,
  releaseId: seed.releaseId,
  effectiveChecksum: seed.effectiveChecksum,
  scopeKey: seed.scopeKey,
  now,
});

const receiptInput = (seed: Seed, idempotencyKey: string, now = new Date()) => ({
  sessionId: seed.sessionId,
  ownerUserId: seed.ownerUserId,
  allowedShopIds: [seed.shopId],
  assignmentId: seed.assignmentId,
  releaseId: seed.releaseId,
  idempotencyKey,
  effectiveChecksum: seed.effectiveChecksum,
  status: 'APPLIED' as const,
  failureCode: null,
  extensionVersion: '1.2.0',
  appliedAt: now,
  now,
});

describePostgres('logistics device repository PostgreSQL integration', () => {
  let first: PrismaClient;
  let second: PrismaClient;

  beforeAll(async () => {
    const expectedSchema = assertIsolatedSchema(testDatabaseUrl);
    first = new PrismaClient({ datasourceUrl: testDatabaseUrl });
    second = new PrismaClient({ datasourceUrl: testDatabaseUrl });
    const rows = await first.$queryRawUnsafe<Array<{ schema: string }>>(
      'SELECT current_schema() AS schema',
    );
    expect(rows[0]?.schema).toBe(expectedSchema);
  }, 30_000);

  afterAll(async () => {
    await Promise.all([first?.$disconnect(), second?.$disconnect()]);
  });

  it('lists and reads only the live owner/shop scope even with forged allowedShopIds', async () => {
    const own = await seedDeviceScope(first, 'scope_a');
    const foreign = await seedDeviceScope(first, 'scope_b');
    const repository = createPrismaLogisticsRuleDeviceRepository({ client: first });

    await expect(
      repository.listAssignmentsForDevice({
        sessionId: own.sessionId,
        ownerUserId: own.ownerUserId,
        allowedShopIds: [own.shopId, foreign.shopId],
      }),
    ).resolves.toEqual([
      expect.objectContaining({ assignmentId: own.assignmentId, shopId: own.shopId }),
    ]);
    await expect(
      repository.getEffectiveReleaseForDevice({
        sessionId: own.sessionId,
        ownerUserId: own.ownerUserId,
        allowedShopIds: [own.shopId, foreign.shopId],
        assignmentId: foreign.assignmentId,
        now: new Date(),
      }),
    ).resolves.toEqual({ state: 'not_found' });
  });

  it('discovers a verified assignment before its first release is published', async () => {
    const seed = await seedDeviceScope(first, 'before_first_release', {
      publishRelease: false,
    });
    const repository = createPrismaLogisticsRuleDeviceRepository({ client: first });

    await expect(repository.listAssignmentsForDevice({
      sessionId: seed.sessionId,
      ownerUserId: seed.ownerUserId,
      allowedShopIds: [seed.shopId],
    })).resolves.toEqual([
      expect.objectContaining({
        assignmentId: seed.assignmentId,
        releaseSequence: 0,
        effectiveReleaseAvailable: false,
      }),
    ]);
  });

  it.each([
    [
      'shop ERROR',
      'shop_error',
      'SCOPE_REVOKED',
      'scope_revoked',
      async (client: PrismaClient, seed: Seed) => {
        await client.$executeRawUnsafe(
          `UPDATE "shops" SET "status" = 'ERROR', "updated_at" = CURRENT_TIMESTAMP WHERE "id" = $1`,
          seed.shopId,
        );
      },
    ],
    [
      'inactive warehouse',
      'warehouse_inactive',
      'WAREHOUSE_RETIRED',
      'warehouse_retired',
      async (client: PrismaClient, seed: Seed) => {
        await client.$executeRawUnsafe(
          `UPDATE "warehouses" SET "status" = 'disabled', "updated_at" = CURRENT_TIMESTAMP WHERE "id" = $1`,
          seed.warehouseId,
        );
      },
    ],
    [
      'inactive delivery method',
      'method_inactive',
      'SCOPE_REVOKED',
      'scope_revoked',
      async (client: PrismaClient, seed: Seed) => {
        await client.$executeRawUnsafe(
          `UPDATE "shop_delivery_methods" SET "status" = 'inactive', "updated_at" = CURRENT_TIMESTAMP WHERE "id" = $1`,
          seed.deliveryMethodId,
        );
      },
    ],
    [
      'deleted delivery method binding',
      'method_deleted',
      'SCOPE_REVOKED',
      'scope_revoked',
      async (client: PrismaClient, seed: Seed) => {
        await client.$executeRawUnsafe(
          'DELETE FROM "shop_delivery_method_rule_bindings" WHERE "id" = $1',
          seed.methodBindingId,
        );
        await client.$executeRawUnsafe(
          'DELETE FROM "shop_delivery_methods" WHERE "id" = $1',
          seed.deliveryMethodId,
        );
      },
    ],
  ] as const)(
    'stops discovery and revokes a delivered release after %s',
    async (_label, seedLabel, storedReason, publicReason, mutateScope) => {
      const seed = await seedDeviceScope(first, seedLabel);
      const repository = createPrismaLogisticsRuleDeviceRepository({ client: first });
      await expect(
        repository.authorizeEffectiveReleaseDelivery(deliveryInput(seed)),
      ).resolves.toMatchObject({ state: 'allowed' });

      await mutateScope(first, seed);

      await expect(
        repository.listAssignmentsForDevice({
          sessionId: seed.sessionId,
          ownerUserId: seed.ownerUserId,
          allowedShopIds: [seed.shopId],
        }),
      ).resolves.toEqual([]);
      await expect(
        repository.getEffectiveReleaseForDevice(effectiveInput(seed)),
      ).resolves.toEqual({
        state: 'gone',
        assignmentId: seed.assignmentId,
        reasonCode: publicReason,
      });
      const grants = await first.$queryRawUnsafe<
        Array<{ status: string; revokedReason: string | null }>
      >(
        `SELECT "status"::text AS "status", "revoked_reason"::text AS "revokedReason"
         FROM "extension_device_assignment_grants"
         WHERE "session_id" = $1 AND "assignment_id" = $2`,
        seed.sessionId,
        seed.assignmentId,
      );
      expect(grants).toEqual([{ status: 'REVOKED', revokedReason: storedReason }]);
    },
  );

  it('returns 410 state only to the exact session holding a delivered revoked tombstone', async () => {
    const seed = await seedDeviceScope(first, 'known_gone');
    const repository = createPrismaLogisticsRuleDeviceRepository({ client: first });
    await expect(
      repository.getEffectiveReleaseForDevice(effectiveInput(seed)),
    ).resolves.toMatchObject({ state: 'allowed' });
    await expect(
      repository.authorizeEffectiveReleaseDelivery(deliveryInput(seed)),
    ).resolves.toMatchObject({ state: 'allowed' });
    await first.$executeRawUnsafe(
      `UPDATE "extension_device_assignment_grants"
       SET "status" = 'REVOKED', "revoked_at" = CURRENT_TIMESTAMP,
           "revoked_reason" = 'SHOP_TRANSFERRED', "updated_at" = CURRENT_TIMESTAMP
       WHERE "session_id" = $1 AND "assignment_id" = $2`,
      seed.sessionId,
      seed.assignmentId,
    );

    await expect(
      repository.authorizeEffectiveReleaseDelivery(deliveryInput(seed)),
    ).resolves.toEqual({
      state: 'gone',
      assignmentId: seed.assignmentId,
      reasonCode: 'shop_transferred',
    });
    await expect(
      repository.authorizeEffectiveReleaseDelivery({
        ...deliveryInput(seed),
        sessionId: `${seed.prefix}_unknown_session`,
      }),
    ).resolves.toEqual({ state: 'not_found' });
  });

  it.each([
    ['assignment retirement', 'ASSIGNMENT_RETIRED', 'assignment_retired'],
    ['shop unlink', 'SHOP_UNLINKED', 'shop_unlinked'],
    ['scope invalidation', 'SCOPE_REVOKED', 'scope_revoked'],
  ] as const)(
    'persists a delivered grant tombstone after %s',
    async (_label, storedReason, publicReason) => {
      const seed = await seedDeviceScope(first, storedReason.toLowerCase());
      const repository = createPrismaLogisticsRuleDeviceRepository({ client: first });
      await expect(
        repository.authorizeEffectiveReleaseDelivery(deliveryInput(seed)),
      ).resolves.toMatchObject({ state: 'allowed' });

      if (storedReason === 'ASSIGNMENT_RETIRED') {
        await first.$executeRawUnsafe(
          `UPDATE "logistics_rule_assignments"
           SET "retired_at" = CURRENT_TIMESTAMP, "updated_at" = CURRENT_TIMESTAMP
           WHERE "id" = $1`,
          seed.assignmentId,
        );
      } else if (storedReason === 'SHOP_UNLINKED') {
        await first.$executeRawUnsafe(
          `UPDATE "extension_device_shop_grants"
           SET "status" = 'REVOKED', "revoked_at" = CURRENT_TIMESTAMP,
               "revoked_reason" = 'SHOP_UNLINKED'
           WHERE "session_id" = $1 AND "shop_id" = $2`,
          seed.sessionId,
          seed.shopId,
        );
      } else {
        await first.$executeRawUnsafe(
          `UPDATE "shop_ozon_company_bindings"
           SET "status" = 'INVALIDATED', "invalidated_at" = CURRENT_TIMESTAMP,
               "updated_at" = CURRENT_TIMESTAMP
           WHERE "id" = $1`,
          `${seed.prefix}_company_binding`,
        );
      }

      await expect(
        repository.authorizeEffectiveReleaseDelivery(deliveryInput(seed)),
      ).resolves.toEqual({
        state: 'gone',
        assignmentId: seed.assignmentId,
        reasonCode: publicReason,
      });
      const grants = await first.$queryRawUnsafe<
        Array<{
          status: string;
          revokedReason: string | null;
        }>
      >(
        `SELECT "status"::text AS "status", "revoked_reason"::text AS "revokedReason"
         FROM "extension_device_assignment_grants"
         WHERE "session_id" = $1 AND "assignment_id" = $2`,
        seed.sessionId,
        seed.assignmentId,
      );
      expect(grants).toEqual([{ status: 'REVOKED', revokedReason: storedReason }]);
    },
  );

  it('keeps unknown and undelivered grants hidden after shop unlink', async () => {
    const seed = await seedDeviceScope(first, 'undelivered_hidden');
    const repository = createPrismaLogisticsRuleDeviceRepository({ client: first });
    await first.$executeRawUnsafe(
      `INSERT INTO "extension_device_assignment_grants"
        ("id", "session_id", "assignment_id", "shop_id", "scope_key_hash", "status",
         "created_at", "updated_at")
       VALUES ($1, $2, $3, $4, $5, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      `${seed.prefix}_undelivered_grant`,
      seed.sessionId,
      seed.assignmentId,
      seed.shopId,
      digest(seed.scopeKey),
    );
    await first.$executeRawUnsafe(
      `UPDATE "extension_device_shop_grants"
       SET "status" = 'REVOKED', "revoked_at" = CURRENT_TIMESTAMP,
           "revoked_reason" = 'SHOP_UNLINKED'
       WHERE "session_id" = $1 AND "shop_id" = $2`,
      seed.sessionId,
      seed.shopId,
    );

    await expect(repository.getEffectiveReleaseForDevice(effectiveInput(seed))).resolves.toEqual({
      state: 'not_found',
    });
    await expect(
      repository.getEffectiveReleaseForDevice({
        ...effectiveInput(seed),
        assignmentId: `${seed.prefix}_unknown_assignment`,
      }),
    ).resolves.toEqual({ state: 'not_found' });

    const grants = await first.$queryRawUnsafe<
      Array<{
        status: string;
        firstDeliveredAt: Date | null;
        revokedReason: string | null;
      }>
    >(
      `SELECT "status"::text AS "status", "first_delivered_at" AS "firstDeliveredAt",
              "revoked_reason"::text AS "revokedReason"
       FROM "extension_device_assignment_grants"
       WHERE "session_id" = $1 AND "assignment_id" = $2`,
      seed.sessionId,
      seed.assignmentId,
    );
    expect(grants).toEqual([
      {
        status: 'ACTIVE',
        firstDeliveredAt: null,
        revokedReason: null,
      },
    ]);
  });

  it('keeps preflight read-only and rejects authorization after the current release changes', async () => {
    const seed = await seedDeviceScope(first, 'preflight_toctou');
    const repository = createPrismaLogisticsRuleDeviceRepository({ client: first });
    await expect(
      repository.getEffectiveReleaseForDevice(effectiveInput(seed)),
    ).resolves.toMatchObject({ state: 'allowed', releaseId: seed.releaseId });

    const before = await first.$queryRawUnsafe<Array<{ count: bigint }>>(
      'SELECT COUNT(*) AS count FROM "extension_device_assignment_grants" WHERE "session_id" = $1',
      seed.sessionId,
    );
    expect(Number(before[0]?.count || 0)).toBe(0);

    const nextReleaseId = `${seed.prefix}_release_2`;
    const nextEffectiveChecksum = digest(`${seed.prefix}:effective:2`);
    await first.$executeRawUnsafe(
      `INSERT INTO "logistics_rule_releases"
        ("id", "channel_id", "sequence", "revision_id", "release_kind", "content_checksum",
         "effective_checksum", "frozen_payload", "validated_at", "validation_valid_until", "published_by_id")
       SELECT $1, "channel_id", 2, "revision_id", 'PUBLISH', "content_checksum", $2,
              "frozen_payload", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '7 days', $3
       FROM "logistics_rule_releases" WHERE "id" = $4`,
      nextReleaseId,
      nextEffectiveChecksum,
      seed.ownerUserId,
      seed.releaseId,
    );
    await first.$executeRawUnsafe(
      `UPDATE "logistics_rule_channels"
       SET "current_sequence" = 2, "current_release_id" = $1, "updated_at" = CURRENT_TIMESTAMP
       WHERE "id" = $2`,
      nextReleaseId,
      seed.channelId,
    );

    await expect(
      repository.authorizeEffectiveReleaseDelivery(deliveryInput(seed)),
    ).resolves.toEqual({ state: 'not_found' });
    const after = await first.$queryRawUnsafe<Array<{ count: bigint }>>(
      'SELECT COUNT(*) AS count FROM "extension_device_assignment_grants" WHERE "session_id" = $1',
      seed.sessionId,
    );
    expect(Number(after[0]?.count || 0)).toBe(0);
  });

  it('records exact receipts idempotently and rejects conflicting or foreign payloads', async () => {
    const seed = await seedDeviceScope(first, 'receipt');
    const foreign = await seedDeviceScope(first, 'receipt_foreign');
    const repository = createPrismaLogisticsRuleDeviceRepository({ client: first });
    await repository.getEffectiveReleaseForDevice(effectiveInput(seed));
    await repository.authorizeEffectiveReleaseDelivery(deliveryInput(seed));
    const input = receiptInput(seed, `${seed.prefix}_idempotency_key`);

    await expect(repository.recordApplyReceipt(input)).resolves.toMatchObject({
      state: 'accepted',
      duplicate: false,
    });
    await expect(repository.recordApplyReceipt(input)).resolves.toMatchObject({
      state: 'accepted',
      duplicate: true,
    });
    await expect(
      repository.recordApplyReceipt({
        ...input,
        status: 'FAILED',
        failureCode: 'apply_failed',
        appliedAt: null,
      }),
    ).rejects.toMatchObject({ code: 'RECEIPT_CONFLICT', statusCode: 409 });
    await expect(
      repository.recordApplyReceipt({
        ...input,
        idempotencyKey: `${seed.prefix}_wrong_checksum`,
        effectiveChecksum: 'f'.repeat(64),
      }),
    ).rejects.toMatchObject({ code: 'RECEIPT_NOT_AUTHORIZED', statusCode: 404 });
    await expect(
      repository.recordApplyReceipt({
        ...input,
        idempotencyKey: `${seed.prefix}_wrong_release`,
        releaseId: foreign.releaseId,
        effectiveChecksum: foreign.effectiveChecksum,
      }),
    ).rejects.toMatchObject({ code: 'RECEIPT_NOT_AUTHORIZED', statusCode: 404 });
  });

  it('does not renew last authorization after a failed receipt', async () => {
    const seed = await seedDeviceScope(first, 'failed_lease');
    const repository = createPrismaLogisticsRuleDeviceRepository({ client: first });
    const deliveredAt = new Date('2026-07-12T10:00:00.000Z');
    await repository.getEffectiveReleaseForDevice(effectiveInput(seed, deliveredAt));
    await repository.authorizeEffectiveReleaseDelivery(deliveryInput(seed, deliveredAt));
    await repository.recordApplyReceipt({
      ...receiptInput(seed, `${seed.prefix}_failed_key`, new Date('2026-07-12T11:00:00.000Z')),
      status: 'FAILED',
      failureCode: 'apply_failed',
      appliedAt: null,
    });
    const rows = await first.$queryRawUnsafe<Array<{ lastAuthorizedAt: Date }>>(
      `SELECT "last_authorized_at" AS "lastAuthorizedAt"
       FROM "extension_device_assignment_grants" WHERE "session_id" = $1 AND "assignment_id" = $2`,
      seed.sessionId,
      seed.assignmentId,
    );
    expect(rows[0]?.lastAuthorizedAt.toISOString()).toBe(deliveredAt.toISOString());
  });

  it('atomically deduplicates concurrent identical receipts', async () => {
    const seed = await seedDeviceScope(first, 'concurrent_ack');
    const firstRepository = createPrismaLogisticsRuleDeviceRepository({ client: first });
    const secondRepository = createPrismaLogisticsRuleDeviceRepository({ client: second });
    await firstRepository.getEffectiveReleaseForDevice(effectiveInput(seed));
    await firstRepository.authorizeEffectiveReleaseDelivery(deliveryInput(seed));
    const input = receiptInput(seed, `${seed.prefix}_concurrent_key`);

    const results = await Promise.all([
      firstRepository.recordApplyReceipt(input),
      secondRepository.recordApplyReceipt(input),
    ]);

    expect(results.map((result) => result.duplicate).sort()).toEqual([false, true]);
    const rows = await first.$queryRawUnsafe<Array<{ count: bigint }>>(
      'SELECT COUNT(*) AS count FROM "logistics_rule_release_acks" WHERE "idempotency_key" = $1',
      input.idempotencyKey,
    );
    expect(Number(rows[0]?.count || 0)).toBe(1);
  });

  it('atomically deduplicates repeated and concurrent delivery authorization', async () => {
    const seed = await seedDeviceScope(first, 'concurrent_delivery');
    const firstRepository = createPrismaLogisticsRuleDeviceRepository({ client: first });
    const secondRepository = createPrismaLogisticsRuleDeviceRepository({ client: second });
    const input = deliveryInput(seed, new Date('2026-07-12T10:00:00.000Z'));

    await expect(firstRepository.authorizeEffectiveReleaseDelivery(input)).resolves.toMatchObject({
      state: 'allowed',
    });
    await expect(firstRepository.authorizeEffectiveReleaseDelivery(input)).resolves.toMatchObject({
      state: 'allowed',
    });
    const concurrentResults = await Promise.all([
      firstRepository.authorizeEffectiveReleaseDelivery(input),
      secondRepository.authorizeEffectiveReleaseDelivery(input),
    ]);
    expect(concurrentResults).toEqual([
      expect.objectContaining({ state: 'allowed' }),
      expect.objectContaining({ state: 'allowed' }),
    ]);

    const rows = await first.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*) AS count FROM "extension_device_assignment_grants"
       WHERE "session_id" = $1 AND "assignment_id" = $2`,
      seed.sessionId,
      seed.assignmentId,
    );
    expect(Number(rows[0]?.count || 0)).toBe(1);
  });

  it('atomically retires a channel and returns 410 to a device that received its assignment', async () => {
    const seed = await seedDeviceScope(first, 'admin_retire');
    const deviceRepository = createPrismaLogisticsRuleDeviceRepository({ client: first });
    await deviceRepository.authorizeEffectiveReleaseDelivery(deliveryInput(seed));
    await deviceRepository.recordApplyReceipt(receiptInput(seed, `${seed.prefix}_retire_receipt`));
    const retiredAt = new Date('2026-07-13T12:00:00.000Z');
    const adminRepository = createPrismaLogisticsRuleAdminRepository({
      prisma: first as any,
      deploymentId: 'postgres-test-deployment',
      apiOrigin: 'http://localhost:3001',
      now: () => retiredAt,
    });

    await expect(adminRepository.retireChannel({
      actorUserId: seed.ownerUserId,
      channelId: seed.channelId,
      expectedSequence: 1,
      reason: 'stop the PostgreSQL pilot',
    })).resolves.toMatchObject({
      channelId: seed.channelId,
      currentSequence: 1,
      retiredAssignmentCount: 1,
      revokedGrantCount: 1,
    });

    const state = await first.$queryRawUnsafe<Array<{
      channelRetiredAt: Date | null;
      assignmentRetiredAt: Date | null;
      grantStatus: string;
      revokedReason: string | null;
      subjectType: string;
      eventType: string;
    }>>(
      `SELECT c."retired_at" AS "channelRetiredAt", a."retired_at" AS "assignmentRetiredAt",
              g."status"::text AS "grantStatus", g."revoked_reason"::text AS "revokedReason",
              e."subject_type" AS "subjectType", e."type"::text AS "eventType"
       FROM "logistics_rule_channels" c
       JOIN "logistics_rule_assignments" a ON a."channel_id" = c."id"
       JOIN "extension_device_assignment_grants" g ON g."assignment_id" = a."id"
       JOIN "logistics_rule_events" e ON e."channel_id" = c."id" AND e."type" = 'INVALIDATED'
       WHERE c."id" = $1`,
      seed.channelId,
    );
    expect(state).toEqual([expect.objectContaining({
      channelRetiredAt: retiredAt,
      assignmentRetiredAt: retiredAt,
      grantStatus: 'REVOKED',
      revokedReason: 'ASSIGNMENT_RETIRED',
      subjectType: 'CHANNEL',
      eventType: 'INVALIDATED',
    })]);
    const receipts = await adminRepository.readChannelReceipts({
      channelId: seed.channelId,
      limit: 10,
    });
    expect(receipts).toMatchObject({
      channelId: seed.channelId,
      retiredAt: retiredAt.toISOString(),
      summary: { total: 1, byStatus: { APPLIED: 1, FAILED: 0 } },
      records: [expect.objectContaining({
        assignmentId: seed.assignmentId, releaseId: seed.releaseId, status: 'APPLIED',
      })],
    });
    expect(JSON.stringify(receipts)).not.toMatch(/sessionId|deviceId|token|cookie|localFee/i);

    const app = Fastify();
    const authenticateRead = async (request: FastifyRequest) => {
      (request as any).device = {
        sessionId: seed.sessionId,
        ownerUserId: seed.ownerUserId,
        allowedShopIds: [seed.shopId],
      };
    };
    await app.register(logisticsRuleRoutes, {
      repository: deviceRepository,
      authenticateDiscover: authenticateRead,
      authenticateRead,
      authenticateReceipt: authenticateRead,
      deploymentId: 'postgres-test-deployment',
    });
    const response = await app.inject({
      method: 'GET',
      url: `/assignments/${seed.assignmentId}/effective`,
      headers: { 'x-ss-erp-extension-version': '1.2.0' },
    });
    expect(response.statusCode).toBe(410);
    expect(response.json()).toMatchObject({
      errorCode: 'assignment_revoked',
      reasonCode: 'assignment_retired',
    });
  });
});
