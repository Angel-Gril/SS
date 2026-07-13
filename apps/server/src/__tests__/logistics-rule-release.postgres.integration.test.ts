import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type LogisticsReleaseManifest,
  publishLogisticsRuleRevision,
  rollbackLogisticsRuleRelease,
} from '../services/logistics-rule-release.js';
import { createPrismaLogisticsRuleAdminRepository } from '../services/logistics-rule-admin-prisma.js';

const testDatabaseUrl = process.env.LOGISTICS_TEST_DATABASE_URL || '';
const runRequested = process.env.RUN_LOGISTICS_POSTGRES_TESTS === '1';
const explicitRunner = process.env.npm_lifecycle_event === 'test:logistics:postgres';
// 1. Deploy migrations with DATABASE_URL pointing at an isolated logistics_test_* schema.
// 2. Set that URL as LOGISTICS_TEST_DATABASE_URL, set RUN_LOGISTICS_POSTGRES_TESTS=1, then run the package script.
if (explicitRunner && (!runRequested || !testDatabaseUrl)) {
  throw new Error(
    'test:logistics:postgres requires RUN_LOGISTICS_POSTGRES_TESTS=1 and LOGISTICS_TEST_DATABASE_URL',
  );
}
const enabled = runRequested && Boolean(testDatabaseUrl);
const describePostgres = enabled ? describe : describe.skip;

interface Seed {
  prefix: string;
  tenantId: string;
  shopId: string;
  warehouseId: string;
  companyBindingId: string;
  originBindingId: string;
  channelId: string;
  revisionId: string;
  bindingId: string;
  methodId: string;
}

const uniquePrefix = (label: string) =>
  `lg_${label}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;

function managementRevisionPayload() {
  return {
    officialPolicy: {
      activeSourceRevision: 'official-r1',
      activeBatchChecksum: 'b'.repeat(64),
      freshnessCutoff: '2026-07-12T00:00:00.000Z',
    },
    services: [
      {
        stableServiceKey: 'service-key',
        providerId: '1778',
        normalizedDescription: 'atc pickup',
        templateType: 'door_to_door',
        weightType: 'actual',
        batteryMode: 'no-battery',
        deliveryVariant: 'pickup',
      },
    ],
    formulas: [{ stableServiceKey: 'service-key' }],
    officialSamples: [
      {
        fingerprintKey: 'fingerprint-1',
        sourceRevision: 'official-r1',
        batchChecksum: 'b'.repeat(64),
        sampleChecksum: 'c'.repeat(64),
        fingerprint: {
          origin: { countryUid: 'china', cityUid: 'xiamen' },
          destination: { countryUid: 'russia', locationUid: 'moscow' },
          currency: 'CNY',
        },
        tariffs: [
          {
            stableServiceKey: 'official-service-key',
            providerId: '1778',
            normalizedDescription: 'atc pickup',
            templateType: 'door_to_door',
            weightType: 'actual',
            batteryMode: 'no-battery',
            deliveryVariant: 'pickup',
          },
        ],
      },
    ],
    validationMatrix: {
      requirements: [
        {
          requirementKey: 'requirement-1',
          stableServiceKey: 'service-key',
          expectedDeliveryVariant: 'pickup',
          fingerprintKey: 'fingerprint-1',
        },
      ],
    },
  };
}

function assertIsolatedSchema(urlText: string): string {
  if (!urlText) throw new Error('LOGISTICS_TEST_DATABASE_URL is required');
  const schema = new URL(urlText).searchParams.get('schema') || '';
  if (!/^logistics_test_[a-z0-9_]+$/.test(schema)) {
    throw new Error('LOGISTICS_TEST_DATABASE_URL must target an isolated logistics_test_* schema');
  }
  return schema;
}

async function count(
  client: PrismaClient,
  table: string,
  column: string,
  value: string,
): Promise<number> {
  if (!/^[a-z_]+$/.test(table) || !/^[a-z_]+$/.test(column))
    throw new Error('unsafe test identifier');
  const rows = await client.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*) AS count FROM "${table}" WHERE "${column}" = $1`,
    value,
  );
  return Number(rows[0]?.count || 0);
}

async function seedTenantScope(
  client: PrismaClient,
  label: string,
  revisionPayload: unknown = {},
): Promise<Seed> {
  const prefix = uniquePrefix(label);
  const tenantId = `${prefix}_tenant`;
  const shopId = `${prefix}_shop`;
  const warehouseId = `${prefix}_warehouse`;
  const methodId = `${prefix}_method`;
  const companyBindingId = `${prefix}_company`;
  const originBindingId = `${prefix}_origin`;
  const channelId = `${prefix}_channel`;
  const revisionId = `${prefix}_revision`;

  await client.$executeRawUnsafe(
    'INSERT INTO "users" ("id", "phone", "password_hash", "updated_at") VALUES ($1, $2, $3, CURRENT_TIMESTAMP)',
    tenantId,
    `${prefix}_phone`,
    'test-password-hash',
  );
  await client.$executeRawUnsafe(
    'INSERT INTO "shops" ("id", "user_id", "platform", "name", "api_key_encrypted", "updated_at") VALUES ($1, $2, \'OZON\', $3, $4, CURRENT_TIMESTAMP)',
    shopId,
    tenantId,
    `${prefix} shop`,
    'encrypted-test-key',
  );
  await client.$executeRawUnsafe(
    'INSERT INTO "warehouses" ("id", "shop_id", "name", "updated_at") VALUES ($1, $2, $3, CURRENT_TIMESTAMP)',
    warehouseId,
    shopId,
    `${prefix} warehouse`,
  );
  await client.$executeRawUnsafe(
    'INSERT INTO "shop_delivery_methods" ("id", "warehouse_id", "platform_method_id", "name", "updated_at") VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)',
    methodId,
    warehouseId,
    Math.floor(Math.random() * 1_000_000_000),
    `${prefix} method`,
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "shop_ozon_company_bindings"
      ("id", "tenant_id", "shop_id", "ozon_company_id", "status", "open_api_verified_at",
       "seller_probe_verified_at", "open_api_intersection_verified_at", "verified_by_id", "verified_at", "updated_at")
     VALUES ($1, $2, $3, $4, 'VERIFIED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    companyBindingId,
    tenantId,
    shopId,
    `${prefix}_ozon_company`,
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "warehouse_ozon_origin_bindings"
      ("id", "tenant_id", "shop_id", "warehouse_id", "origin_country_uid", "origin_city_uid", "origin_country_code",
       "origin_label", "status", "open_api_address_verified_at", "official_location_verified_at", "verified_by_id",
       "verified_at", "updated_at")
     VALUES ($1, $2, $3, $4, $5, $6, 'CN', $7, 'VERIFIED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    originBindingId,
    tenantId,
    shopId,
    warehouseId,
    `${prefix}_china`,
    `${prefix}_xiamen`,
    `${prefix} Xiamen`,
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "logistics_rule_channels"
      ("id", "channel_type", "tenant_id", "shop_id", "warehouse_id", "ozon_company_id", "origin_country_uid",
       "origin_city_uid", "origin_country_code", "origin_label", "company_binding_id", "origin_binding_id",
       "scope_key", "updated_at")
     VALUES ($1, 'TENANT', $2, $3, $4, $5, $6, $7, 'CN', $8, $9, $10, $11, CURRENT_TIMESTAMP)`,
    channelId,
    tenantId,
    shopId,
    warehouseId,
    `${prefix}_ozon_company`,
    `${prefix}_china`,
    `${prefix}_xiamen`,
    `${prefix} Xiamen`,
    companyBindingId,
    originBindingId,
    `${prefix}_scope`,
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "logistics_rule_revisions"
      ("id", "revision_key", "source_owner_type", "source_tenant_id", "confidentiality", "content_checksum",
       "payload", "schema_version", "validation_status", "validation_report", "validated_at", "validation_valid_until")
     VALUES ($1, $2, 'TENANT', $3, 'TENANT_PRIVATE', $4, $5::jsonb, '1', 'PASSED', '{}'::jsonb,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '7 days')`,
    revisionId,
    `${prefix}_revision_key`,
    tenantId,
    `${prefix}_checksum`,
    JSON.stringify(revisionPayload),
  );

  const bindingId = `${prefix}_method_binding`;
  await client.$executeRawUnsafe(
    `INSERT INTO "logistics_rule_assignments"
      ("id", "tenant_id", "shop_id", "warehouse_id", "channel_id", "destination_country_uid",
       "destination_location_uid", "destination_country_code", "destination_label", "updated_at")
     VALUES ($1, $2, $3, $4, $5, 'russia-uid', 'moscow-uid', 'RU', 'Moscow', CURRENT_TIMESTAMP)`,
    `${prefix}_assignment`,
    tenantId,
    shopId,
    warehouseId,
    channelId,
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "shop_delivery_method_rule_bindings"
      ("id", "tenant_id", "shop_id", "warehouse_id", "delivery_method_id", "stable_service_key",
       "source_revision_id", "status", "evidence", "confirmed_by_id", "confirmed_at", "updated_at")
     VALUES ($1, $2, $3, $4, $5, 'service-key', $6, 'CONFIRMED', '{}'::jsonb, $2,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    bindingId,
    tenantId,
    shopId,
    warehouseId,
    methodId,
    revisionId,
  );

  return {
    prefix,
    tenantId,
    shopId,
    warehouseId,
    companyBindingId,
    originBindingId,
    channelId,
    revisionId,
    bindingId,
    methodId,
  };
}

function manifestFor(seed: Seed): LogisticsReleaseManifest {
  return {
    schemaVersion: '1',
    minimumExtensionVersion: '0.1.0',
    destination: {
      destinationCountryUid: 'russia-uid',
      destinationLocationUid: 'moscow-uid',
      destinationLabel: 'Moscow',
      destinationCountryCode: 'RU',
    },
    selectedServiceKeys: ['service-key'],
    defaultServiceKeys: ['service-key'],
    deliveryMethodBindingIds: [seed.bindingId],
    officialResolutions: [],
    routeClassifications: { 'service-key': 'RU' },
    validationReport: { status: 'PASSED' },
    revisionId: seed.revisionId,
  };
}

const publishThroughService = (client: PrismaClient, seed: Seed, expectedSequence: number) =>
  publishLogisticsRuleRevision(client as any, {
    channelId: seed.channelId,
    revisionId: seed.revisionId,
    expectedSequence,
    actorUserId: seed.tenantId,
    manifest: manifestFor(seed),
    now: new Date(),
  });

async function publishRaw(
  client: PrismaClient,
  seed: Seed,
  expectedSequence: number,
  releaseId = `${seed.prefix}_release_${expectedSequence + 1}`,
): Promise<string> {
  return client.$transaction(
    async (tx) => {
      const sequence = expectedSequence + 1;
      await tx.$executeRawUnsafe(
        `INSERT INTO "logistics_rule_releases"
        ("id", "channel_id", "sequence", "revision_id", "release_kind", "content_checksum", "effective_checksum",
         "frozen_payload", "validated_at", "validation_valid_until", "published_by_id")
       VALUES ($1, $2, $3, $4, 'PUBLISH', $5, $6, '{}'::jsonb, CURRENT_TIMESTAMP,
         CURRENT_TIMESTAMP + INTERVAL '7 days', $7)`,
        releaseId,
        seed.channelId,
        sequence,
        seed.revisionId,
        `${seed.prefix}_checksum`,
        `${seed.prefix}_effective_${sequence}`,
        seed.tenantId,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO "logistics_rule_events"
        ("id", "tenant_id", "channel_id", "release_id", "subject_type", "subject_id", "actor_user_id",
         "type", "scope_snapshot", "facts")
       VALUES ($1, $2, $3, $4, 'RELEASE', $4, $2, 'PUBLISHED', '{}'::jsonb, '{}'::jsonb)`,
        `${releaseId}_event`,
        seed.tenantId,
        seed.channelId,
        releaseId,
      );
      const moved = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `UPDATE "logistics_rule_channels"
       SET "current_sequence" = $1, "current_release_id" = $2, "updated_at" = CURRENT_TIMESTAMP
       WHERE "id" = $3 AND "current_sequence" = $4
       RETURNING "id"`,
        sequence,
        releaseId,
        seed.channelId,
        expectedSequence,
      );
      if (moved.length !== 1) throw new Error('RELEASE_CONFLICT');
      return releaseId;
    },
    { isolationLevel: 'Serializable' },
  );
}

describePostgres('logistics rule PostgreSQL integration', () => {
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
       WHERE "migration_name" = '20260712150000_add_ozon_logistics_rule_distribution' AND "finished_at" IS NOT NULL`,
    );
    expect(migrations).toHaveLength(1);
  }, 30_000);

  afterAll(async () => {
    await Promise.all([first?.$disconnect(), second?.$disconnect()]);
  });

  it('stores revision events without a release while requiring a stable subject', async () => {
    const seed = await seedTenantScope(first, 'event');
    const eventId = `${seed.prefix}_revision_event`;
    await first.$executeRawUnsafe(
      `INSERT INTO "logistics_rule_events"
        ("id", "tenant_id", "channel_id", "release_id", "subject_type", "subject_id", "actor_user_id",
         "type", "scope_snapshot", "facts")
       VALUES ($1, $2, $3, NULL, 'REVISION', $4, $2, 'REVISION_CREATED', '{}'::jsonb, '{}'::jsonb)`,
      eventId,
      seed.tenantId,
      seed.channelId,
      seed.revisionId,
    );
    expect(await count(first, 'logistics_rule_events', 'id', eventId)).toBe(1);
  });

  it('persists method binding and Official resolution lifecycle events through the repository', async () => {
    const seed = await seedTenantScope(first, 'binding_events', managementRevisionPayload());
    await first.shopDeliveryMethodRuleBinding.delete({
      where: { id: seed.bindingId },
    });
    const repository = createPrismaLogisticsRuleAdminRepository({
      prisma: first as any,
      deploymentId: 'legacy',
      apiOrigin: 'http://localhost:3001',
      now: () => new Date('2026-07-13T04:00:00.000Z'),
    });

    const suggestedBinding = await repository.suggestMethodBinding({
      actorUserId: seed.tenantId,
      channelId: seed.channelId,
      revisionId: seed.revisionId,
      deliveryMethodId: seed.methodId,
      stableServiceKey: 'service-key',
      note: 'suggest method binding',
    });
    const confirmedBinding = await repository.reviewMethodBinding({
      actorUserId: seed.tenantId,
      channelId: seed.channelId,
      revisionId: seed.revisionId,
      bindingId: (suggestedBinding as { id: string }).id,
      decision: 'CONFIRMED',
      note: 'confirm method binding',
      expectedUpdatedAt: (suggestedBinding as { updatedAt: Date }).updatedAt.toISOString(),
    });
    await repository.reviewMethodBinding({
      actorUserId: seed.tenantId,
      channelId: seed.channelId,
      revisionId: seed.revisionId,
      bindingId: (suggestedBinding as { id: string }).id,
      decision: 'REJECTED',
      note: 'reject method binding',
      expectedUpdatedAt: (confirmedBinding as { updatedAt: Date }).updatedAt.toISOString(),
    });

    const suggestedResolution = await repository.suggestOfficialResolution({
      actorUserId: seed.tenantId,
      channelId: seed.channelId,
      revisionId: seed.revisionId,
      requirementKey: 'requirement-1',
      note: 'suggest Official resolution',
    });
    const confirmedResolution = await repository.reviewOfficialResolution({
      actorUserId: seed.tenantId,
      channelId: seed.channelId,
      revisionId: seed.revisionId,
      resolutionId: (suggestedResolution as { id: string }).id,
      decision: 'CONFIRMED',
      selectedServiceKey: 'service-key',
      note: 'confirm Official resolution',
      expectedUpdatedAt: (suggestedResolution as { updatedAt: Date }).updatedAt.toISOString(),
    });
    await repository.reviewOfficialResolution({
      actorUserId: seed.tenantId,
      channelId: seed.channelId,
      revisionId: seed.revisionId,
      resolutionId: (suggestedResolution as { id: string }).id,
      decision: 'REJECTED',
      note: 'reject Official resolution',
      expectedUpdatedAt: (confirmedResolution as { updatedAt: Date }).updatedAt.toISOString(),
    });

    const events = await first.$queryRawUnsafe<Array<{ subjectType: string; action: string }>>(
      `SELECT "subject_type" AS "subjectType", "facts"->>'action' AS "action"
       FROM "logistics_rule_events"
       WHERE "channel_id" = $1 AND "type" = 'BINDING_CHANGED'`,
      seed.channelId,
    );
    expect(events).toHaveLength(6);
    expect(events.map((event) => `${event.subjectType}:${event.action}`).sort()).toEqual([
      'METHOD_BINDING:CONFIRMED',
      'METHOD_BINDING:REJECTED',
      'METHOD_BINDING:SUGGESTED',
      'OFFICIAL_RESOLUTION:CONFIRMED',
      'OFFICIAL_RESOLUTION:REJECTED',
      'OFFICIAL_RESOLUTION:SUGGESTED',
    ]);
  });

  it('deduplicates identical concurrent method and Official suggestions across two clients', async () => {
    const seed = await seedTenantScope(
      first,
      'suggestion_idempotency',
      managementRevisionPayload(),
    );
    await first.shopDeliveryMethodRuleBinding.delete({ where: { id: seed.bindingId } });
    const firstRepository = createPrismaLogisticsRuleAdminRepository({
      prisma: first as any,
      deploymentId: 'legacy',
      apiOrigin: 'http://localhost:3001',
      now: () => new Date('2026-07-13T04:30:00.000Z'),
    });
    const secondRepository = createPrismaLogisticsRuleAdminRepository({
      prisma: second as any,
      deploymentId: 'legacy',
      apiOrigin: 'http://localhost:3001',
      now: () => new Date('2026-07-13T04:30:00.000Z'),
    });
    const methodInput = {
      actorUserId: seed.tenantId,
      channelId: seed.channelId,
      revisionId: seed.revisionId,
      deliveryMethodId: seed.methodId,
      stableServiceKey: 'service-key',
    };

    const methodSuggestions = (await Promise.all([
      firstRepository.suggestMethodBinding({
        ...methodInput,
        note: 'first identical method suggestion',
      }),
      secondRepository.suggestMethodBinding({
        ...methodInput,
        note: 'second identical method suggestion',
      }),
    ])) as Array<{ id: string }>;
    expect(new Set(methodSuggestions.map((suggestion) => suggestion.id)).size).toBe(1);
    expect(
      await count(
        first,
        'shop_delivery_method_rule_bindings',
        'source_revision_id',
        seed.revisionId,
      ),
    ).toBe(1);

    const officialInput = {
      actorUserId: seed.tenantId,
      channelId: seed.channelId,
      revisionId: seed.revisionId,
      requirementKey: 'requirement-1',
    };
    const officialSuggestions = (await Promise.all([
      firstRepository.suggestOfficialResolution({
        ...officialInput,
        note: 'first identical Official suggestion',
      }),
      secondRepository.suggestOfficialResolution({
        ...officialInput,
        note: 'second identical Official suggestion',
      }),
    ])) as Array<{ id: string }>;
    expect(new Set(officialSuggestions.map((suggestion) => suggestion.id)).size).toBe(1);
    expect(
      await count(
        first,
        'official_seller_formula_resolutions',
        'seller_source_revision_id',
        seed.revisionId,
      ),
    ).toBe(1);

    const events = await first.$queryRawUnsafe<Array<{ subjectType: string }>>(
      `SELECT "subject_type" AS "subjectType"
       FROM "logistics_rule_events"
       WHERE "channel_id" = $1
         AND "type" = 'BINDING_CHANGED'
         AND "facts"->>'action' = 'SUGGESTED'
       ORDER BY "subject_type"`,
      seed.channelId,
    );
    expect(events.map((event) => event.subjectType)).toEqual([
      'METHOD_BINDING',
      'OFFICIAL_RESOLUTION',
    ]);
  });

  it('allows only one conflicting method suggestion for the same revision across two clients', async () => {
    const payload = managementRevisionPayload();
    payload.services.push({
      ...payload.services[0]!,
      stableServiceKey: 'service-key-2',
      normalizedDescription: 'alternate atc pickup',
    });
    payload.formulas.push({ stableServiceKey: 'service-key-2' });
    const seed = await seedTenantScope(first, 'suggestion_conflict', payload);
    await first.shopDeliveryMethodRuleBinding.delete({ where: { id: seed.bindingId } });
    const firstRepository = createPrismaLogisticsRuleAdminRepository({
      prisma: first as any,
      deploymentId: 'legacy',
      apiOrigin: 'http://localhost:3001',
      now: () => new Date('2026-07-13T04:45:00.000Z'),
    });
    const secondRepository = createPrismaLogisticsRuleAdminRepository({
      prisma: second as any,
      deploymentId: 'legacy',
      apiOrigin: 'http://localhost:3001',
      now: () => new Date('2026-07-13T04:45:00.000Z'),
    });
    const input = {
      actorUserId: seed.tenantId,
      channelId: seed.channelId,
      revisionId: seed.revisionId,
      deliveryMethodId: seed.methodId,
      note: 'conflicting concurrent method suggestion',
    };

    const results = await Promise.allSettled([
      firstRepository.suggestMethodBinding({ ...input, stableServiceKey: 'service-key' }),
      secondRepository.suggestMethodBinding({ ...input, stableServiceKey: 'service-key-2' }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(rejected?.reason).toMatchObject({ code: 'SUGGESTION_CONFLICT', statusCode: 409 });

    const rows = await first.$queryRawUnsafe<Array<{ stableServiceKey: string }>>(
      `SELECT "stable_service_key" AS "stableServiceKey"
       FROM "shop_delivery_method_rule_bindings"
       WHERE "source_revision_id" = $1
         AND "delivery_method_id" = $2
         AND "retired_at" IS NULL`,
      seed.revisionId,
      seed.methodId,
    );
    expect(rows).toHaveLength(1);
    expect(['service-key', 'service-key-2']).toContain(rows[0]?.stableServiceKey);
    const events = await first.$queryRawUnsafe<Array<{ action: string }>>(
      `SELECT "facts"->>'action' AS "action"
       FROM "logistics_rule_events"
       WHERE "channel_id" = $1
         AND "subject_type" = 'METHOD_BINDING'
         AND "type" = 'BINDING_CHANGED'
         AND "facts"->>'action' = 'SUGGESTED'`,
      seed.channelId,
    );
    expect(events).toEqual([{ action: 'SUGGESTED' }]);
  });
  it('allows only one opposite method binding review for the same version across two clients', async () => {
    const seed = await seedTenantScope(first, 'method_review_cas', managementRevisionPayload());
    const deliveryMethodId = `${seed.prefix}_review_method`;
    await first.$executeRawUnsafe(
      `INSERT INTO "shop_delivery_methods"
        ("id", "warehouse_id", "platform_method_id", "name", "updated_at")
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
      deliveryMethodId,
      seed.warehouseId,
      Math.floor(Math.random() * 1_000_000_000),
      `${seed.prefix} review method`,
    );

    const firstRepository = createPrismaLogisticsRuleAdminRepository({
      prisma: first as any,
      deploymentId: 'legacy',
      apiOrigin: 'http://localhost:3001',
      now: () => new Date('2026-07-13T05:00:00.000Z'),
    });
    const secondRepository = createPrismaLogisticsRuleAdminRepository({
      prisma: second as any,
      deploymentId: 'legacy',
      apiOrigin: 'http://localhost:3001',
      now: () => new Date('2026-07-13T05:00:00.000Z'),
    });
    const suggested = (await firstRepository.suggestMethodBinding({
      actorUserId: seed.tenantId,
      channelId: seed.channelId,
      revisionId: seed.revisionId,
      deliveryMethodId,
      stableServiceKey: 'service-key',
      note: 'suggest concurrent method review',
    })) as { id: string; updatedAt: Date };
    const review = {
      actorUserId: seed.tenantId,
      channelId: seed.channelId,
      revisionId: seed.revisionId,
      bindingId: suggested.id,
      expectedUpdatedAt: suggested.updatedAt.toISOString(),
      note: 'concurrent method review',
    };

    const results = await Promise.allSettled([
      firstRepository.reviewMethodBinding({ ...review, decision: 'CONFIRMED' }),
      secondRepository.reviewMethodBinding({ ...review, decision: 'REJECTED' }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(rejected?.reason).toMatchObject({ code: 'REVIEW_CONFLICT', statusCode: 409 });

    const rows = await first.$queryRawUnsafe<Array<{ status: string }>>(
      `SELECT "status"::text AS "status"
       FROM "shop_delivery_method_rule_bindings"
       WHERE "id" = $1`,
      suggested.id,
    );
    const reviewEvents = await first.$queryRawUnsafe<Array<{ action: string }>>(
      `SELECT "facts"->>'action' AS "action"
       FROM "logistics_rule_events"
       WHERE "channel_id" = $1
         AND "subject_type" = 'METHOD_BINDING'
         AND "subject_id" = $2
         AND "type" = 'BINDING_CHANGED'
         AND "facts"->>'action' IN ('CONFIRMED', 'REJECTED')`,
      seed.channelId,
      suggested.id,
    );
    expect(reviewEvents).toHaveLength(1);
    expect(reviewEvents[0]?.action).toBe(rows[0]?.status);
  });

  it('allows only one opposite Official resolution review for the same version across two clients', async () => {
    const seed = await seedTenantScope(first, 'official_review_cas', managementRevisionPayload());
    const firstRepository = createPrismaLogisticsRuleAdminRepository({
      prisma: first as any,
      deploymentId: 'legacy',
      apiOrigin: 'http://localhost:3001',
      now: () => new Date('2026-07-13T06:00:00.000Z'),
    });
    const secondRepository = createPrismaLogisticsRuleAdminRepository({
      prisma: second as any,
      deploymentId: 'legacy',
      apiOrigin: 'http://localhost:3001',
      now: () => new Date('2026-07-13T06:00:00.000Z'),
    });
    const suggested = (await firstRepository.suggestOfficialResolution({
      actorUserId: seed.tenantId,
      channelId: seed.channelId,
      revisionId: seed.revisionId,
      requirementKey: 'requirement-1',
      note: 'suggest concurrent Official review',
    })) as { id: string; updatedAt: Date };
    const review = {
      actorUserId: seed.tenantId,
      channelId: seed.channelId,
      revisionId: seed.revisionId,
      resolutionId: suggested.id,
      expectedUpdatedAt: suggested.updatedAt.toISOString(),
      note: 'concurrent Official review',
    };

    const results = await Promise.allSettled([
      firstRepository.reviewOfficialResolution({
        ...review,
        decision: 'CONFIRMED',
        selectedServiceKey: 'service-key',
      }),
      secondRepository.reviewOfficialResolution({ ...review, decision: 'REJECTED' }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(rejected?.reason).toMatchObject({ code: 'REVIEW_CONFLICT', statusCode: 409 });

    const rows = await first.$queryRawUnsafe<Array<{ status: string }>>(
      `SELECT "status"::text AS "status"
       FROM "official_seller_formula_resolutions"
       WHERE "id" = $1`,
      suggested.id,
    );
    const reviewEvents = await first.$queryRawUnsafe<Array<{ action: string }>>(
      `SELECT "facts"->>'action' AS "action"
       FROM "logistics_rule_events"
       WHERE "channel_id" = $1
         AND "subject_type" = 'OFFICIAL_RESOLUTION'
         AND "subject_id" = $2
         AND "type" = 'BINDING_CHANGED'
         AND "facts"->>'action' IN ('CONFIRMED', 'REJECTED')`,
      seed.channelId,
      suggested.id,
    );
    expect(reviewEvents).toHaveLength(1);
    expect(reviewEvents[0]?.action).toBe(rows[0]?.status);
  });

  it('rolls back release creation and pointer movement when mandatory event persistence fails', async () => {
    const seed = await seedTenantScope(first, 'event_failure');
    const functionName = `${seed.prefix}_fail_event_fn`;
    const triggerName = `${seed.prefix}_fail_event_trigger`;
    await first.$executeRawUnsafe(
      `CREATE FUNCTION "${functionName}"() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'forced event failure'; END; $$ LANGUAGE plpgsql`,
    );
    await first.$executeRawUnsafe(
      `CREATE TRIGGER "${triggerName}" BEFORE INSERT ON "logistics_rule_events"
       FOR EACH ROW EXECUTE FUNCTION "${functionName}"()`,
    );
    try {
      await expect(publishThroughService(first, seed, 0)).rejects.toBeTruthy();
      expect(await count(first, 'logistics_rule_releases', 'channel_id', seed.channelId)).toBe(0);
      const rows = await first.$queryRawUnsafe<
        Array<{ current_sequence: number; current_release_id: string | null }>
      >(
        'SELECT "current_sequence", "current_release_id" FROM "logistics_rule_channels" WHERE "id" = $1',
        seed.channelId,
      );
      expect(rows[0]).toEqual({ current_sequence: 0, current_release_id: null });
    } finally {
      await first.$executeRawUnsafe(`DROP TRIGGER "${triggerName}" ON "logistics_rule_events"`);
      await first.$executeRawUnsafe(`DROP FUNCTION "${functionName}"()`);
    }
  });

  it('allows only one of two concurrent publishers with the same expected sequence', async () => {
    const seed = await seedTenantScope(first, 'concurrency');
    const results = await Promise.allSettled([
      publishThroughService(first, seed, 0),
      publishThroughService(second, seed, 0),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(rejected?.reason).toMatchObject({
      code: 'RELEASE_CONFLICT',
      statusCode: 409,
    });
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await count(first, 'logistics_rule_releases', 'channel_id', seed.channelId)).toBe(1);
    expect(await count(first, 'logistics_rule_events', 'channel_id', seed.channelId)).toBe(1);
    const rows = await first.$queryRawUnsafe<Array<{ current_sequence: number }>>(
      'SELECT "current_sequence" FROM "logistics_rule_channels" WHERE "id" = $1',
      seed.channelId,
    );
    expect(rows[0]?.current_sequence).toBe(1);
  });

  it('keeps method bindings per revision when publishing rev2 and rolling back to rev1', async () => {
    const rev1 = await seedTenantScope(first, 'binding_revision');
    const firstRelease = await publishThroughService(first, rev1, 0);
    const rev2: Seed = {
      ...rev1,
      revisionId: `${rev1.prefix}_revision_2`,
      bindingId: `${rev1.prefix}_method_binding_2`,
    };

    await first.$executeRawUnsafe(
      `INSERT INTO "logistics_rule_revisions"
        ("id", "revision_key", "source_owner_type", "source_tenant_id", "confidentiality", "content_checksum",
         "payload", "schema_version", "validation_status", "validation_report", "validated_at", "validation_valid_until")
       VALUES ($1, $2, 'TENANT', $3, 'TENANT_PRIVATE', $4, '{}'::jsonb, '1', 'PASSED', '{}'::jsonb,
         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '7 days')`,
      rev2.revisionId,
      `${rev1.prefix}_revision_key_2`,
      rev1.tenantId,
      `${rev1.prefix}_checksum_2`,
    );
    await first.$executeRawUnsafe(
      `INSERT INTO "shop_delivery_method_rule_bindings"
        ("id", "tenant_id", "shop_id", "warehouse_id", "delivery_method_id", "stable_service_key",
         "source_revision_id", "status", "evidence", "confirmed_by_id", "confirmed_at", "updated_at")
       VALUES ($1, $2, $3, $4, $5, 'service-key', $6, 'CONFIRMED', '{}'::jsonb, $2,
         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      rev2.bindingId,
      rev1.tenantId,
      rev1.shopId,
      rev1.warehouseId,
      rev1.methodId,
      rev2.revisionId,
    );

    await publishThroughService(first, rev2, 1);
    const rolledBack = await rollbackLogisticsRuleRelease(first as any, {
      channelId: rev1.channelId,
      targetReleaseId: firstRelease.id,
      expectedSequence: 2,
      actorUserId: rev1.tenantId,
      now: new Date(),
    });

    expect(rolledBack).toMatchObject({
      sequence: 3,
      revisionId: rev1.revisionId,
      rollbackTargetReleaseId: firstRelease.id,
    });
    const bindings = await first.$queryRawUnsafe<
      Array<{ id: string; sourceRevisionId: string; retiredAt: Date | null }>
    >(
      `SELECT "id", "source_revision_id" AS "sourceRevisionId", "retired_at" AS "retiredAt"
       FROM "shop_delivery_method_rule_bindings"
       WHERE "delivery_method_id" = $1
       ORDER BY "source_revision_id"`,
      rev1.methodId,
    );
    expect(bindings).toEqual([
      { id: rev1.bindingId, sourceRevisionId: rev1.revisionId, retiredAt: null },
      { id: rev2.bindingId, sourceRevisionId: rev2.revisionId, retiredAt: null },
    ]);
  });

  it('rejects a direct cross-tenant release revision insert', async () => {
    const channelScope = await seedTenantScope(first, 'tenant_a');
    const foreignScope = await seedTenantScope(first, 'tenant_b');
    await expect(
      first.$executeRawUnsafe(
        `INSERT INTO "logistics_rule_releases"
        ("id", "channel_id", "sequence", "revision_id", "release_kind", "content_checksum", "effective_checksum",
         "frozen_payload", "validated_at", "validation_valid_until")
       VALUES ($1, $2, 1, $3, 'PUBLISH', 'bad', 'bad', '{}'::jsonb, CURRENT_TIMESTAMP,
         CURRENT_TIMESTAMP + INTERVAL '7 days')`,
        `${channelScope.prefix}_cross_tenant_release`,
        channelScope.channelId,
        foreignScope.revisionId,
      ),
    ).rejects.toBeTruthy();
    expect(
      await count(first, 'logistics_rule_releases', 'channel_id', channelScope.channelId),
    ).toBe(0);
  });

  it('rejects a rollback target from another channel', async () => {
    const firstScope = await seedTenantScope(first, 'rollback_a');
    const secondScope = await seedTenantScope(first, 'rollback_b');
    const firstRelease = await publishRaw(first, firstScope, 0);
    await expect(
      first.$executeRawUnsafe(
        `INSERT INTO "logistics_rule_releases"
        ("id", "channel_id", "sequence", "revision_id", "release_kind", "rollback_target_release_id",
         "content_checksum", "effective_checksum", "frozen_payload", "validated_at", "validation_valid_until")
       VALUES ($1, $2, 1, $3, 'ROLLBACK', $4, $5, $6, '{}'::jsonb, CURRENT_TIMESTAMP,
         CURRENT_TIMESTAMP + INTERVAL '7 days')`,
        `${secondScope.prefix}_cross_channel_rollback`,
        secondScope.channelId,
        secondScope.revisionId,
        firstRelease,
        `${secondScope.prefix}_checksum`,
        `${secondScope.prefix}_effective`,
      ),
    ).rejects.toBeTruthy();
  });

  it('enforces release kind shape and exact earlier rollback snapshots', async () => {
    const seed = await seedTenantScope(first, 'rollback_state');
    const targetReleaseId = await publishRaw(first, seed, 0);

    await expect(
      first.$executeRawUnsafe(
        `INSERT INTO "logistics_rule_releases"
        ("id", "channel_id", "sequence", "revision_id", "release_kind", "rollback_target_release_id",
         "content_checksum", "effective_checksum", "frozen_payload", "validated_at", "validation_valid_until")
       SELECT $1, "channel_id", 2, "revision_id", 'PUBLISH', "id", "content_checksum", $2,
         "frozen_payload", "validated_at", "validation_valid_until"
       FROM "logistics_rule_releases" WHERE "id" = $3`,
        `${seed.prefix}_publish_with_target`,
        `${seed.prefix}_effective_publish_target`,
        targetReleaseId,
      ),
    ).rejects.toBeTruthy();

    await expect(
      first.$executeRawUnsafe(
        `INSERT INTO "logistics_rule_releases"
        ("id", "channel_id", "sequence", "revision_id", "release_kind", "rollback_target_release_id",
         "content_checksum", "effective_checksum", "frozen_payload", "validated_at", "validation_valid_until")
       SELECT $1, "channel_id", 2, "revision_id", 'ROLLBACK', NULL, "content_checksum", $2,
         "frozen_payload", "validated_at", "validation_valid_until"
       FROM "logistics_rule_releases" WHERE "id" = $3`,
        `${seed.prefix}_rollback_without_target`,
        `${seed.prefix}_effective_no_target`,
        targetReleaseId,
      ),
    ).rejects.toBeTruthy();

    const selfReleaseId = `${seed.prefix}_self_rollback`;
    await expect(
      first.$executeRawUnsafe(
        `INSERT INTO "logistics_rule_releases"
        ("id", "channel_id", "sequence", "revision_id", "release_kind", "rollback_target_release_id",
         "content_checksum", "effective_checksum", "frozen_payload", "validated_at", "validation_valid_until")
       VALUES ($1, $2, 2, $3, 'ROLLBACK', $1, $4, $5, '{}'::jsonb, CURRENT_TIMESTAMP,
         CURRENT_TIMESTAMP + INTERVAL '7 days')`,
        selfReleaseId,
        seed.channelId,
        seed.revisionId,
        `${seed.prefix}_checksum`,
        `${seed.prefix}_effective_self`,
      ),
    ).rejects.toBeTruthy();

    const futureReleaseId = `${seed.prefix}_future_release`;
    await first.$executeRawUnsafe(
      `INSERT INTO "logistics_rule_releases"
        ("id", "channel_id", "sequence", "revision_id", "release_kind", "content_checksum", "effective_checksum",
         "frozen_payload", "validated_at", "validation_valid_until")
       VALUES ($1, $2, 5, $3, 'PUBLISH', $4, $5, '{}'::jsonb, CURRENT_TIMESTAMP,
         CURRENT_TIMESTAMP + INTERVAL '7 days')`,
      futureReleaseId,
      seed.channelId,
      seed.revisionId,
      `${seed.prefix}_checksum`,
      `${seed.prefix}_effective_future`,
    );
    await expect(
      first.$executeRawUnsafe(
        `INSERT INTO "logistics_rule_releases"
        ("id", "channel_id", "sequence", "revision_id", "release_kind", "rollback_target_release_id",
         "content_checksum", "effective_checksum", "frozen_payload", "validated_at", "validation_valid_until")
       SELECT $1, "channel_id", 4, "revision_id", 'ROLLBACK', "id", "content_checksum", $2,
         "frozen_payload", "validated_at", "validation_valid_until"
       FROM "logistics_rule_releases" WHERE "id" = $3`,
        `${seed.prefix}_future_rollback`,
        `${seed.prefix}_effective_future_rollback`,
        futureReleaseId,
      ),
    ).rejects.toBeTruthy();

    await expect(
      first.$executeRawUnsafe(
        `INSERT INTO "logistics_rule_releases"
        ("id", "channel_id", "sequence", "revision_id", "release_kind", "rollback_target_release_id",
         "content_checksum", "effective_checksum", "frozen_payload", "validated_at", "validation_valid_until")
       SELECT $1, "channel_id", 2, "revision_id", 'ROLLBACK', "id", 'tampered', $2,
         "frozen_payload", "validated_at", "validation_valid_until"
       FROM "logistics_rule_releases" WHERE "id" = $3`,
        `${seed.prefix}_mismatched_rollback`,
        `${seed.prefix}_effective_mismatch`,
        targetReleaseId,
      ),
    ).rejects.toBeTruthy();
  });

  it('rejects direct mutation of channel identity after publication', async () => {
    const seed = await seedTenantScope(first, 'channel_identity');
    await publishRaw(first, seed, 0);
    await expect(
      first.$executeRawUnsafe(
        'UPDATE "logistics_rule_channels" SET "scope_key" = $1, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = $2',
        `${seed.prefix}_changed_scope`,
        seed.channelId,
      ),
    ).rejects.toBeTruthy();
  });

  it('validates event kind, tenant, subject and transition uniqueness', async () => {
    const seed = await seedTenantScope(first, 'event_state');
    const foreign = await seedTenantScope(first, 'event_foreign');
    const releaseId = `${seed.prefix}_event_release`;
    await first.$executeRawUnsafe(
      `INSERT INTO "logistics_rule_releases"
        ("id", "channel_id", "sequence", "revision_id", "release_kind", "content_checksum", "effective_checksum",
         "frozen_payload", "validated_at", "validation_valid_until")
       VALUES ($1, $2, 1, $3, 'PUBLISH', $4, $5, '{}'::jsonb, CURRENT_TIMESTAMP,
         CURRENT_TIMESTAMP + INTERVAL '7 days')`,
      releaseId,
      seed.channelId,
      seed.revisionId,
      `${seed.prefix}_checksum`,
      `${seed.prefix}_event_effective`,
    );

    const insertTransition = (
      id: string,
      tenantId: string,
      type: 'PUBLISHED' | 'ROLLED_BACK',
      subjectId = releaseId,
    ) =>
      first.$executeRawUnsafe(
        `INSERT INTO "logistics_rule_events"
          ("id", "tenant_id", "channel_id", "release_id", "subject_type", "subject_id", "actor_user_id",
           "type", "scope_snapshot", "facts")
         VALUES ($1, $2, $3, $4, 'RELEASE', $5, $2, $6::"LogisticsRuleEventType", '{}'::jsonb, '{}'::jsonb)`,
        id,
        tenantId,
        seed.channelId,
        releaseId,
        subjectId,
        type,
      );

    await expect(
      insertTransition(`${seed.prefix}_wrong_kind`, seed.tenantId, 'ROLLED_BACK'),
    ).rejects.toBeTruthy();
    await expect(
      insertTransition(`${seed.prefix}_wrong_tenant`, foreign.tenantId, 'PUBLISHED'),
    ).rejects.toBeTruthy();
    await expect(
      insertTransition(`${seed.prefix}_wrong_subject`, seed.tenantId, 'PUBLISHED', seed.revisionId),
    ).rejects.toBeTruthy();
    await expect(
      first.$executeRawUnsafe(
        `INSERT INTO "logistics_rule_events"
        ("id", "tenant_id", "channel_id", "release_id", "subject_type", "subject_id", "actor_user_id",
         "type", "scope_snapshot", "facts")
       VALUES ($1, $2, $3, NULL, 'CHANNEL', $3, $2, 'REVISION_CREATED', '{}'::jsonb, '{}'::jsonb)`,
        `${seed.prefix}_invalid_non_transition`,
        seed.tenantId,
        seed.channelId,
      ),
    ).rejects.toBeTruthy();

    await insertTransition(`${seed.prefix}_published`, seed.tenantId, 'PUBLISHED');
    await expect(
      insertTransition(`${seed.prefix}_duplicate`, seed.tenantId, 'PUBLISHED'),
    ).rejects.toBeTruthy();
  });

  it('enforces immutable revisions, releases and events', async () => {
    const seed = await seedTenantScope(first, 'immutable');
    const releaseId = await publishRaw(first, seed, 0);
    await expect(
      first.$executeRawUnsafe(
        'UPDATE "logistics_rule_revisions" SET "payload" = \'{"changed":true}\'::jsonb WHERE "id" = $1',
        seed.revisionId,
      ),
    ).rejects.toBeTruthy();
    await expect(
      first.$executeRawUnsafe(
        'UPDATE "logistics_rule_releases" SET "content_checksum" = \'changed\' WHERE "id" = $1',
        releaseId,
      ),
    ).rejects.toBeTruthy();
    await expect(
      first.$executeRawUnsafe(
        'UPDATE "logistics_rule_events" SET "facts" = \'{"changed":true}\'::jsonb WHERE "release_id" = $1',
        releaseId,
      ),
    ).rejects.toBeTruthy();
  });

  it('deduplicates public revision checksums when source tenant is NULL', async () => {
    const prefix = uniquePrefix('public');
    const insert = (id: string, revisionKey: string) =>
      first.$executeRawUnsafe(
        `INSERT INTO "logistics_rule_revisions"
        ("id", "revision_key", "source_owner_type", "source_tenant_id", "confidentiality", "content_checksum",
         "payload", "schema_version", "validation_status")
       VALUES ($1, $2, 'PUBLIC', NULL, 'PUBLIC', $3, '{}'::jsonb, '1', 'DRAFT')`,
        id,
        revisionKey,
        `${prefix}_checksum`,
      );
    await insert(`${prefix}_revision_a`, `${prefix}_key_a`);
    await expect(insert(`${prefix}_revision_b`, `${prefix}_key_b`)).rejects.toBeTruthy();
  });
});
