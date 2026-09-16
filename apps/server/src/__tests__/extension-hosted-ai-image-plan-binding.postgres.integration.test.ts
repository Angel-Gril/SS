import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPrismaExtensionHostedAiImagePlanBindingStore,
  type ExtensionHostedAiImagePlanBindingPrismaClient,
} from '../services/extension-hosted-ai-image-plan-binding-prisma.js';
import { createExtensionHostedAiImagePlanBindingRecord } from '../services/extension-hosted-ai-image-plan.js';
import { createPrismaSourceListingWorkflowRepository } from '../services/source-listing-workflow-prisma.js';
import { createSourceListingWorkflowService } from '../services/source-listing-workflow.js';

const databaseUrl = process.env.AI_MEDIA_TEST_DATABASE_URL || '';
const enabled = process.env.RUN_AI_MEDIA_POSTGRES_TESTS === '1' && Boolean(databaseUrl);
const describePostgres = enabled ? describe : describe.skip;

function assertIsolatedSchema(urlText: string): string {
  if (!urlText) throw new Error('AI_MEDIA_TEST_DATABASE_URL is required');
  const schema = new URL(urlText).searchParams.get('schema') || '';
  if (!/^ai_media_test_[a-z0-9_]+$/u.test(schema)) {
    throw new Error('AI_MEDIA_TEST_DATABASE_URL must target an isolated ai_media_test_* schema');
  }
  return schema;
}

async function seedAuthority(client: PrismaClient, label: string) {
  const prefix = `hosted_binding_${label}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const ownerUserId = `${prefix}_owner`;
  const shopId = `${prefix}_shop`;
  const supplyGoodsId = `${prefix}_goods`;
  const sourceSubjectId = `${prefix}_subject`;
  const snapshotId = `${prefix}_snapshot`;
  const captureHash = createHash('sha256').update(`${prefix}:capture`).digest('hex');
  const now = new Date();

  await client.$executeRawUnsafe(
    'INSERT INTO "users" ("id", "phone", "password_hash", "updated_at") VALUES ($1, $2, $3, $4)',
    ownerUserId, `${prefix}_phone`, 'integration-test', now,
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "shops"
      ("id", "user_id", "platform", "name", "api_key_encrypted", "status", "updated_at")
     VALUES ($1, $2, 'OZON', $3, $4, 'ACTIVE', $5)`,
    shopId, ownerUserId, `${prefix} shop`, 'encrypted-test-key', now,
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "supply_goods" ("id", "user_id", "title", "updated_at")
     VALUES ($1, $2, $3, $4)`,
    supplyGoodsId, ownerUserId, `${prefix} goods`, now,
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "source_capture_subjects"
      ("id", "owner_user_id", "source_platform", "source_product_id",
       "legacy_supply_goods_id", "created_at", "updated_at")
     VALUES ($1, $2, '1688', $3, $4, $5, $5)`,
    sourceSubjectId, ownerUserId, `${prefix}_product`, supplyGoodsId, now,
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "source_capture_snapshots"
      ("id", "subject_id", "version", "schema_version", "capture_hash", "payload_bytes",
       "payload", "stage_counts", "provenance", "provenance_complete", "parser_version",
       "extension_version", "completeness", "truncations", "has_estimated_values",
       "profile_json", "profile_hash", "actor_user_id", "device_session_id", "ingest_channel",
       "rollout_revision", "rollout_stage", "captured_at", "created_at")
     VALUES ($1, $2, 1, 'source-product-capture-v2', $3, 2, '{}'::jsonb, '{}'::jsonb,
             '{}'::jsonb, TRUE, 'hosted-binding-integration', NULL, '{}'::jsonb, '[]'::jsonb,
             FALSE, '{}'::jsonb, $4, $5, NULL, 'WEB_ACCOUNT',
             'hosted-binding-integration', 'v2_only', $6, $6)`,
    snapshotId, sourceSubjectId, captureHash, 'b'.repeat(64), ownerUserId, now,
  );

  let sequence = 0;
  const workflow = createSourceListingWorkflowService({
    repository: createPrismaSourceListingWorkflowRepository({ client: client as never }),
    now: () => now,
    idFactory: (kind) => `${prefix}_${kind}_${++sequence}`,
  });
  const draft = await workflow.createDraft({
    ownerUserId,
    actorUserId: ownerUserId,
    shopId,
    supplyGoodsId,
    sourceCaptureSnapshotId: snapshotId,
    sourceCaptureHash: captureHash,
    selectedSkuKeys: ['sku-1'],
  });

  const planIds = [`${prefix}_plan_1`, `${prefix}_plan_2`, `${prefix}_plan_3`];
  for (const [index, planId] of planIds.entries()) {
    await client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO "ai_media_plans"
          ("id", "owner_user_id", "actor_user_id", "source_subject_id", "context_type",
           "context_id", "idempotency_key", "request_fingerprint", "created_at", "updated_at")
         VALUES ($1, $2, $2, $3, 'collect', $4, $5, $6, $7, $7)`,
        planId,
        ownerUserId,
        sourceSubjectId,
        supplyGoodsId,
        `${prefix}_plan_key_${index + 1}`,
        createHash('sha256').update(`${prefix}:plan:${index + 1}`).digest('hex'),
        now,
      );
      const payload = { fixture: 'hosted-binding-integration' };
      await tx.aiMediaPlanEvent.create({ data: {
        planId, ownerUserId, actorUserId: ownerUserId, revision: 1,
        eventKey: `${planId}:created`, eventType: 'PLAN_CREATED', payload,
        payloadHash: createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
      } });
    });
  }

  return {
    ownerUserId,
    shopId,
    supplyGoodsId,
    snapshotId,
    listingWorkflowId: draft.id,
    draftRevision: draft.revision,
    draftVersion: draft.draftVersion,
    planIds,
  };
}

function binding(
  seed: Awaited<ReturnType<typeof seedAuthority>>,
  planId: string,
  deviceSessionId: string,
  candidateMediaKeys = ['media-1'],
) {
  return createExtensionHostedAiImagePlanBindingRecord({
    planId,
    identity: {
      ownerUserId: seed.ownerUserId,
      actorUserId: seed.ownerUserId,
      deviceSessionId,
    },
    binding: {
      snapshotId: seed.snapshotId,
      supplyGoodsId: seed.supplyGoodsId,
      shopId: seed.shopId,
      listingWorkflowId: seed.listingWorkflowId,
      draftRevision: seed.draftRevision,
      draftVersion: seed.draftVersion,
    },
    selectedSkuKeys: ['sku-1'],
    candidateMediaKeys,
  });
}

describePostgres('extension hosted plan binding PostgreSQL concurrency', () => {
  let first: PrismaClient;
  let second: PrismaClient;

  beforeAll(async () => {
    const expectedSchema = assertIsolatedSchema(databaseUrl);
    first = new PrismaClient({ datasourceUrl: databaseUrl });
    second = new PrismaClient({ datasourceUrl: databaseUrl });
    const schemas = await first.$queryRawUnsafe<Array<{ schema: string }>>(
      'SELECT current_schema() AS schema',
    );
    expect(schemas[0]?.schema).toBe(expectedSchema);
    const migration = await first.$queryRawUnsafe<Array<{ migrationName: string }>>(
      `SELECT "migration_name" AS "migrationName" FROM "_prisma_migrations"
       WHERE "migration_name" = '20260727100000_add_extension_hosted_ai_image_plan_bindings'
         AND "finished_at" IS NOT NULL`,
    );
    expect(migration).toHaveLength(1);
  }, 30_000);

  afterAll(async () => {
    await Promise.all([first?.$disconnect(), second?.$disconnect()]);
  });

  it('allows only one device and plan to bind the same frozen authority', async () => {
    const seed = await seedAuthority(first, 'device_race');
    const firstRecord = binding(seed, seed.planIds[0]!, 'device-session-1');
    const secondRecord = binding(seed, seed.planIds[1]!, 'device-session-2');
    expect(secondRecord.authorityHash).toBe(firstRecord.authorityHash);

    const firstStore = createPrismaExtensionHostedAiImagePlanBindingStore(
      first as unknown as ExtensionHostedAiImagePlanBindingPrismaClient,
    );
    const secondStore = createPrismaExtensionHostedAiImagePlanBindingStore(
      second as unknown as ExtensionHostedAiImagePlanBindingPrismaClient,
    );
    const results = await Promise.all([
      firstStore.bind(firstRecord),
      secondStore.bind(secondRecord),
    ]);

    expect(results.filter((result) => result.kind === 'bound')).toHaveLength(1);
    expect(results.filter((result) => result.kind === 'conflict')).toHaveLength(1);
    const rows = await first.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*) AS "count" FROM "extension_hosted_ai_image_plan_bindings"
       WHERE "owner_user_id" = $1 AND "authority_hash" = $2`,
      seed.ownerUserId,
      firstRecord.authorityHash,
    );
    expect(Number(rows[0]?.count)).toBe(1);
  }, 30_000);

  it('classifies an exact concurrent retry as one bound result and one replay', async () => {
    const seed = await seedAuthority(first, 'replay_race');
    const record = binding(seed, seed.planIds[2]!, 'device-session-1', ['media-replay']);
    const firstStore = createPrismaExtensionHostedAiImagePlanBindingStore(
      first as unknown as ExtensionHostedAiImagePlanBindingPrismaClient,
    );
    const secondStore = createPrismaExtensionHostedAiImagePlanBindingStore(
      second as unknown as ExtensionHostedAiImagePlanBindingPrismaClient,
    );

    const results = await Promise.all([firstStore.bind(record), secondStore.bind(record)]);

    expect(results.map((result) => result.kind).sort()).toEqual(['bound', 'replayed']);
    const rows = await first.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*) AS "count" FROM "extension_hosted_ai_image_plan_bindings"
       WHERE "owner_user_id" = $1 AND "authority_hash" = $2`,
      seed.ownerUserId,
      record.authorityHash,
    );
    expect(Number(rows[0]?.count)).toBe(1);
  }, 30_000);
});
