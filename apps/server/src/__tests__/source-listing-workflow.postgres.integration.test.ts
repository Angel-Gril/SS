import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { OzonListingDraft } from 'shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaSourceListingWorkflowRepository } from '../services/source-listing-workflow-prisma.js';
import {
  createSourceListingWorkflowService,
  type SourceListingWorkflowError,
} from '../services/source-listing-workflow.js';

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

function assertIsolatedSchema(urlText: string): string {
  if (!urlText) throw new Error('LOGISTICS_TEST_DATABASE_URL is required');
  const schema = new URL(urlText).searchParams.get('schema') || '';
  if (!/^logistics_test_[a-z0-9_]+$/.test(schema)) {
    throw new Error('LOGISTICS_TEST_DATABASE_URL must target an isolated logistics_test_* schema');
  }
  return schema;
}

async function seedWorkflowOwner(client: PrismaClient) {
  const prefix = `listing_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const ownerUserId = `${prefix}_owner`;
  const shopId = `${prefix}_shop`;
  const otherShopId = `${prefix}_shop_other`;
  const supplyGoodsId = `${prefix}_goods`;
  const subjectId = `${prefix}_subject`;
  const snapshotId = `${prefix}_snapshot`;
  const captureHash = randomUUID().replaceAll('-', '').padEnd(64, 'a').slice(0, 64);
  const now = new Date();
  await client.$executeRawUnsafe(
    'INSERT INTO "users" ("id", "phone", "password_hash", "updated_at") VALUES ($1, $2, $3, $4)',
    ownerUserId, `${prefix}_phone`, 'test-password-hash', now,
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "shops"
      ("id", "user_id", "platform", "name", "api_key_encrypted", "status", "updated_at")
     VALUES ($1, $3, 'OZON', $4, $5, 'ACTIVE', $6),
            ($2, $3, 'OZON', $7, $5, 'ACTIVE', $6)`,
    shopId, otherShopId, ownerUserId, `${prefix} shop`, 'encrypted-test-key', now,
    `${prefix} other shop`,
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
    subjectId, ownerUserId, `${prefix}_product`, supplyGoodsId, now,
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "source_capture_snapshots"
      ("id", "subject_id", "version", "schema_version", "capture_hash", "payload_bytes", "payload",
       "stage_counts", "provenance", "provenance_complete", "parser_version", "extension_version",
       "completeness", "truncations", "has_estimated_values", "profile_json", "profile_hash",
       "actor_user_id", "device_session_id", "ingest_channel", "rollout_revision", "rollout_stage",
       "captured_at", "created_at")
     VALUES ($1, $2, 1, 'source-product-capture-v2', $3, 2, '{}'::jsonb, '{}'::jsonb,
             '{}'::jsonb, TRUE, 'unit5-postgres', NULL, '{}'::jsonb, '[]'::jsonb, FALSE,
             '{}'::jsonb, $4, $5, NULL, 'WEB_ACCOUNT', 'unit5-postgres', 'v2_only', $6, $6)`,
    snapshotId, subjectId, captureHash, 'b'.repeat(64), ownerUserId, now,
  );
  return {
    prefix, ownerUserId, shopId, otherShopId, supplyGoodsId, subjectId, snapshotId, captureHash, now,
  };
}

function workflowService(client: PrismaClient, seed: Awaited<ReturnType<typeof seedWorkflowOwner>>, label: string) {
  let sequence = 0;
  return createSourceListingWorkflowService({
    repository: createPrismaSourceListingWorkflowRepository({ client: client as never }),
    now: () => seed.now,
    idFactory: (kind) => `${seed.prefix}_${label}_${kind}_${++sequence}`,
  });
}

async function makePublishReady(
  service: ReturnType<typeof workflowService>,
  seed: Awaited<ReturnType<typeof seedWorkflowOwner>>,
  draft: OzonListingDraft,
): Promise<OzonListingDraft> {
  return service.recordValidationResult({
    draftId: draft.id,
    ownerUserId: seed.ownerUserId,
    actorUserId: seed.ownerUserId,
    expectedRevision: draft.revision,
    status: 'VALID',
    report: { fixture: 'unit5-postgres' },
    blockers: [],
    warnings: [],
  });
}

async function seedDeviceAndGrants(
  client: PrismaClient,
  seed: Awaited<ReturnType<typeof seedWorkflowOwner>>,
  workflowId: string,
) {
  const pairingId = `${seed.prefix}_pairing`;
  const sessionId = `${seed.prefix}_session`;
  const tokenId = `${seed.prefix}_jti`;
  const pairingDigest = createHash('sha256').update(`${seed.prefix}:pairing`).digest('hex');
  await client.$executeRawUnsafe(
    `INSERT INTO "extension_device_pairing_codes"
      ("id", "deployment_id", "actor_user_id", "owner_user_id", "code_digest", "shop_ids",
       "scopes", "status", "expires_at", "claimed_at", "created_at", "updated_at")
     VALUES ($1, 'unit5-postgres', $2, $2, $3, ARRAY[$4]::text[], ARRAY['listing:write']::text[],
             'CLAIMED', $5, $6, $6, $6)`,
    pairingId, seed.ownerUserId, pairingDigest, seed.shopId,
    new Date(seed.now.getTime() + 86_400_000), seed.now,
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "extension_device_sessions"
      ("id", "pairing_code_id", "deployment_id", "device_id", "actor_user_id", "owner_user_id",
       "status", "scopes", "current_jti", "expires_at", "created_at", "updated_at")
     VALUES ($1, $2, 'unit5-postgres', $3, $4, $4, 'ACTIVE', ARRAY['listing:write']::text[],
             $5, $6, $7, $7)`,
    sessionId, pairingId, `${seed.prefix}_device`, seed.ownerUserId, tokenId,
    new Date(seed.now.getTime() + 86_400_000), seed.now,
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "extension_device_shop_grants"
      ("id", "session_id", "shop_id", "status", "granted_at")
     VALUES ($1, $2, $3, 'ACTIVE', $4)`,
    `${seed.prefix}_shop_grant`, sessionId, seed.shopId, seed.now,
  );

  const issuedAt = new Date(seed.now.getTime() - 30_000);
  const expiresAt = new Date(seed.now.getTime() + 180_000);
  const consumedAt = new Date(seed.now.getTime() - 10_000);
  const grants = [
    { suffix: 'old_open', boundWorkflowId: workflowId, draftVersion: 1, consumedAt: null },
    { suffix: 'old_consumed', boundWorkflowId: workflowId, draftVersion: 1, consumedAt },
    { suffix: 'future_open', boundWorkflowId: workflowId, draftVersion: 2, consumedAt: null },
    { suffix: 'other_open', boundWorkflowId: `${seed.prefix}_other_workflow`, draftVersion: 1, consumedAt: null },
  ];
  for (const [index, grant] of grants.entries()) {
    const grantDigest = createHash('sha256')
      .update(`${seed.prefix}:grant:${grant.suffix}`)
      .digest('hex');
    await client.$executeRawUnsafe(
      `INSERT INTO "extension_command_grants"
        ("id", "session_id", "token_id", "owner_user_id", "shop_id", "operation", "workflow_id",
         "draft_version", "idempotency_key", "request_hash", "token_digest", "issued_at", "expires_at",
         "consumed_at")
       VALUES ($1, $2, $3, $4, $5, 'OZON_PUBLISH', $6, $7, $8, $9, $10, $11, $12, $13)`,
      `${seed.prefix}_grant_${grant.suffix}`, sessionId, tokenId, seed.ownerUserId, seed.shopId,
      grant.boundWorkflowId, grant.draftVersion, `${seed.prefix}_${grant.suffix}_idempotency`,
      String(index + 1).repeat(64), grantDigest, issuedAt, expiresAt, grant.consumedAt,
    );
  }
  return grants.map((grant) => `${seed.prefix}_grant_${grant.suffix}`);
}

describePostgres('source listing workflow PostgreSQL integration', () => {
  let first: PrismaClient;
  let second: PrismaClient;

  beforeAll(async () => {
    const expectedSchema = assertIsolatedSchema(testDatabaseUrl);
    first = new PrismaClient({ datasourceUrl: testDatabaseUrl });
    second = new PrismaClient({ datasourceUrl: testDatabaseUrl });
    const schemas = await first.$queryRawUnsafe<Array<{ schema: string }>>(
      'SELECT current_schema() AS schema',
    );
    expect(schemas[0]?.schema).toBe(expectedSchema);
    const migrations = await first.$queryRawUnsafe<Array<{ migrationName: string }>>(
      `SELECT "migration_name" AS "migrationName" FROM "_prisma_migrations"
       WHERE "migration_name" IN (
         '20260715160000_add_source_listing_workflows',
          '20260715170000_harden_source_listing_workflow_consistency',
          '20260715180000_align_source_listing_workflow_limits'
       )
         AND "finished_at" IS NOT NULL`,
    );
    expect(migrations.map(({ migrationName }) => migrationName).sort()).toEqual([
      '20260715160000_add_source_listing_workflows',
      '20260715170000_harden_source_listing_workflow_consistency',
      '20260715180000_align_source_listing_workflow_limits',
    ]);
  }, 30_000);

  afterAll(async () => {
    await Promise.all([first?.$disconnect(), second?.$disconnect()]);
  });

  it('converges exact create, permits one stale CAS winner, and revokes only eligible grants', async () => {
    const seed = await seedWorkflowOwner(first);
    const createInput = {
      ownerUserId: seed.ownerUserId,
      actorUserId: seed.ownerUserId,
      shopId: seed.shopId,
      supplyGoodsId: seed.supplyGoodsId,
      sourceCaptureSnapshotId: seed.snapshotId,
      sourceCaptureHash: seed.captureHash,
      selectedSkuKeys: ['sku-b', 'sku-a', 'sku-a'],
    };
    const [createdByFirst, createdBySecond] = await Promise.all([
      workflowService(first, seed, 'first').createDraft(createInput),
      workflowService(second, seed, 'second').createDraft(createInput),
    ]);
    expect(createdBySecond.id).toBe(createdByFirst.id);
    expect(createdByFirst.selectedSkuKeys).toEqual(['sku-a', 'sku-b']);
    const countsAfterCreate = await first.$queryRawUnsafe<Array<{ workflows: bigint; revisions: bigint }>>(
      `SELECT
        (SELECT COUNT(*) FROM "source_listing_workflows"
         WHERE "owner_user_id" = $1 AND "supply_goods_id" = $2) AS workflows,
        (SELECT COUNT(*) FROM "source_listing_draft_versions"
         WHERE "workflow_id" = $3) AS revisions`,
      seed.ownerUserId, seed.supplyGoodsId, createdByFirst.id,
    );
    expect(Number(countsAfterCreate[0]?.workflows)).toBe(1);
    expect(Number(countsAfterCreate[0]?.revisions)).toBe(1);

    await expect(first.$executeRawUnsafe(
      `INSERT INTO "source_listing_workflows"
        ("id", "owner_user_id", "shop_id", "source_subject_id",
         "current_source_capture_snapshot_id", "legacy_supply_goods_id", "supply_goods_id",
         "selected_sku_keys", "selected_sku_hash", "current_revision", "current_draft_version",
         "stage", "status", "created_at", "updated_at")
       SELECT $1, "owner_user_id", "shop_id", "source_subject_id",
              "current_source_capture_snapshot_id", "legacy_supply_goods_id", "supply_goods_id",
              "selected_sku_keys", "selected_sku_hash", "current_revision", "current_draft_version",
              "stage", "status", "created_at", "updated_at"
       FROM "source_listing_workflows" WHERE "id" = $2`,
      `${seed.prefix}_duplicate_workflow`, createdByFirst.id,
    )).rejects.toThrow(/23505|already exists/i);

    const grantIds = await seedDeviceAndGrants(first, seed, createdByFirst.id);
    const categoryInput = {
      draftId: createdByFirst.id,
      ownerUserId: seed.ownerUserId,
      actorUserId: seed.ownerUserId,
      expectedRevision: 1,
      category: { categoryId: 170001, typeId: 91001, catalogRevision: 'catalog-v1' },
    };
    const casResults = await Promise.allSettled([
      workflowService(first, seed, 'cas-first').setCategory(categoryInput),
      workflowService(second, seed, 'cas-second').setCategory(categoryInput),
    ]);
    expect(casResults.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejected = casResults.find(({ status }) => status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({
      code: 'OZON_LISTING_DRAFT_VERSION_CONFLICT', statusCode: 409,
    } satisfies Partial<SourceListingWorkflowError>);

    const grantRows = await first.$queryRawUnsafe<Array<{
      id: string; consumedAt: Date | null; revokedAt: Date | null; revokedReason: string | null;
    }>>(
      `SELECT "id", "consumed_at" AS "consumedAt", "revoked_at" AS "revokedAt",
              "revoked_reason"::text AS "revokedReason"
       FROM "extension_command_grants" WHERE "id" = ANY($1::text[]) ORDER BY "id"`,
      grantIds,
    );
    const grants = Object.fromEntries(grantRows.map((row) => [row.id, row]));
    expect(grants[`${seed.prefix}_grant_old_open`]).toMatchObject({
      consumedAt: null, revokedAt: expect.any(Date), revokedReason: 'WORKFLOW_VERSION_CHANGED',
    });
    expect(grants[`${seed.prefix}_grant_old_consumed`]).toMatchObject({
      consumedAt: expect.any(Date), revokedAt: null, revokedReason: null,
    });
    expect(grants[`${seed.prefix}_grant_future_open`]).toMatchObject({
      consumedAt: null, revokedAt: null, revokedReason: null,
    });
    expect(grants[`${seed.prefix}_grant_other_open`]).toMatchObject({
      consumedAt: null, revokedAt: null, revokedReason: null,
    });
  }, 45_000);

  it('accepts 500-character SKU keys and maps identity convergence to a typed conflict', async () => {
    const seed = await seedWorkflowOwner(first);
    const service = workflowService(first, seed, 'identity-boundary');
    const boundarySku = '商'.repeat(500);
    const boundary = await service.createDraft({
      ownerUserId: seed.ownerUserId, actorUserId: seed.ownerUserId, shopId: seed.shopId,
      supplyGoodsId: seed.supplyGoodsId, sourceCaptureSnapshotId: seed.snapshotId,
      sourceCaptureHash: seed.captureHash, selectedSkuKeys: [boundarySku],
    });
    expect(boundary.selectedSkuKeys).toEqual([boundarySku]);

    const other = await service.createDraft({
      ownerUserId: seed.ownerUserId, actorUserId: seed.ownerUserId, shopId: seed.shopId,
      supplyGoodsId: seed.supplyGoodsId, sourceCaptureSnapshotId: seed.snapshotId,
      sourceCaptureHash: seed.captureHash, selectedSkuKeys: ['other-sku'],
    });
    await expect(service.changeSkuSelection({
      draftId: other.id, ownerUserId: seed.ownerUserId, actorUserId: seed.ownerUserId,
      expectedRevision: other.revision, selectedSkuKeys: [boundarySku],
    })).rejects.toMatchObject({
      code: 'OZON_LISTING_DRAFT_VERSION_CONFLICT', statusCode: 409,
    } satisfies Partial<SourceListingWorkflowError>);
    await expect(service.getDraft({ draftId: other.id, ownerUserId: seed.ownerUserId }))
      .resolves.toMatchObject({ revision: 1, selectedSkuKeys: ['other-sku'] });
  }, 30_000);

  it('records publish intent atomically, replays exactly, conflicts after state change, and protects ledgers', async () => {
    const seed = await seedWorkflowOwner(first);
    const service = workflowService(first, seed, 'publish');
    const draft = await service.createDraft({
      ownerUserId: seed.ownerUserId, actorUserId: seed.ownerUserId, shopId: seed.shopId,
      supplyGoodsId: seed.supplyGoodsId, sourceCaptureSnapshotId: seed.snapshotId,
      sourceCaptureHash: seed.captureHash, selectedSkuKeys: ['sku-a'],
    });
    const ready = await makePublishReady(service, seed, draft);
    const publishInput = {
      draftId: draft.id, ownerUserId: seed.ownerUserId, actorUserId: seed.ownerUserId,
      expectedRevision: ready.revision, idempotencyKey: `${seed.prefix}_publish_once`,
    };
    const [firstIntent, replayedIntent] = await Promise.all([
      service.recordPublishIntent(publishInput),
      workflowService(second, seed, 'publish-replay').recordPublishIntent(publishInput),
    ]);
    expect([firstIntent.idempotent, replayedIntent.idempotent].sort()).toEqual([false, true]);
    expect(replayedIntent.intent.id).toBe(firstIntent.intent.id);

    const current = await service.getDraft({ draftId: draft.id, ownerUserId: seed.ownerUserId });
    const changed = await service.setCategory({
      draftId: draft.id, ownerUserId: seed.ownerUserId, actorUserId: seed.ownerUserId,
      expectedRevision: current.revision,
      category: { categoryId: 170002, typeId: 91002, catalogRevision: 'catalog-v2' },
    });
    await expect(service.recordPublishIntent({
      ...publishInput, expectedRevision: changed.revision,
    })).rejects.toMatchObject({
      code: 'OZON_LISTING_PUBLISH_INTENT_CONFLICT', statusCode: 409,
    } satisfies Partial<SourceListingWorkflowError>);

    const durable = await first.$queryRawUnsafe<Array<{
      revisions: bigint; intents: bigint; currentRevision: number;
    }>>(
      `SELECT
        (SELECT COUNT(*) FROM "source_listing_draft_versions" WHERE "workflow_id" = $1) AS revisions,
        (SELECT COUNT(*) FROM "source_listing_publish_intents" WHERE "workflow_id" = $1) AS intents,
        "current_revision" AS "currentRevision"
       FROM "source_listing_workflows" WHERE "id" = $1`,
      draft.id,
    );
    expect(Number(durable[0]?.revisions)).toBe(4);
    expect(Number(durable[0]?.intents)).toBe(1);
    expect(durable[0]?.currentRevision).toBe(changed.revision);

    await expect(first.$executeRawUnsafe(
      `UPDATE "source_listing_draft_versions" SET "stage" = 'MEDIA_REVIEW'
       WHERE "workflow_id" = $1 AND "revision" = 1`,
      draft.id,
    )).rejects.toThrow(/draft versions are immutable/i);
    await expect(first.$executeRawUnsafe(
      `UPDATE "source_listing_workflow_events" SET "event_type" = 'TAMPERED'
       WHERE "workflow_id" = $1`,
      draft.id,
    )).rejects.toThrow(/workflow events are immutable/i);
    await expect(first.$executeRawUnsafe(
      `UPDATE "source_listing_publish_intents" SET "payload_hash" = $1
       WHERE "workflow_id" = $2`,
      'f'.repeat(64), draft.id,
    )).rejects.toThrow(/publish intents are immutable/i);
  }, 45_000);

  it('serializes one owner idempotency key across different drafts', async () => {
    const seed = await seedWorkflowOwner(first);
    const firstService = workflowService(first, seed, 'intent-race-first');
    const secondService = workflowService(second, seed, 'intent-race-second');
    const firstDraft = await firstService.createDraft({
      ownerUserId: seed.ownerUserId, actorUserId: seed.ownerUserId, shopId: seed.shopId,
      supplyGoodsId: seed.supplyGoodsId, sourceCaptureSnapshotId: seed.snapshotId,
      sourceCaptureHash: seed.captureHash, selectedSkuKeys: ['race-sku-a'],
    });
    const secondDraft = await secondService.createDraft({
      ownerUserId: seed.ownerUserId, actorUserId: seed.ownerUserId, shopId: seed.shopId,
      supplyGoodsId: seed.supplyGoodsId, sourceCaptureSnapshotId: seed.snapshotId,
      sourceCaptureHash: seed.captureHash, selectedSkuKeys: ['race-sku-b'],
    });
    const [firstReady, secondReady] = await Promise.all([
      makePublishReady(firstService, seed, firstDraft),
      makePublishReady(secondService, seed, secondDraft),
    ]);
    const idempotencyKey = `${seed.prefix}_cross_draft_publish`;
    const results = await Promise.allSettled([
      firstService.recordPublishIntent({
        draftId: firstReady.id, ownerUserId: seed.ownerUserId, actorUserId: seed.ownerUserId,
        expectedRevision: firstReady.revision, idempotencyKey,
      }),
      secondService.recordPublishIntent({
        draftId: secondReady.id, ownerUserId: seed.ownerUserId, actorUserId: seed.ownerUserId,
        expectedRevision: secondReady.revision, idempotencyKey,
      }),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(({ status }) => status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({
      code: 'OZON_LISTING_PUBLISH_INTENT_CONFLICT', statusCode: 409,
    } satisfies Partial<SourceListingWorkflowError>);
    const intents = await first.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*) AS count FROM "source_listing_publish_intents"
       WHERE "owner_user_id" = $1 AND "idempotency_key" = $2`,
      seed.ownerUserId,
      idempotencyKey,
    );
    expect(intents[0]?.count).toBe(1n);
  }, 30_000);

  it('rejects a current-shop intent that points at a historical revision from another shop', async () => {
    const seed = await seedWorkflowOwner(first);
    const service = workflowService(first, seed, 'intent-scope');
    const draft = await service.createDraft({
      ownerUserId: seed.ownerUserId, actorUserId: seed.ownerUserId, shopId: seed.shopId,
      supplyGoodsId: seed.supplyGoodsId, sourceCaptureSnapshotId: seed.snapshotId,
      sourceCaptureHash: seed.captureHash, selectedSkuKeys: ['sku-a'],
    });
    const switched = await service.changeShop({
      draftId: draft.id, ownerUserId: seed.ownerUserId, actorUserId: seed.ownerUserId,
      expectedRevision: draft.revision, shopId: seed.otherShopId,
    });
    expect(switched).toMatchObject({ shopId: seed.otherShopId, revision: 2, draftVersion: 2 });

    await expect(first.$executeRawUnsafe(
      `INSERT INTO "source_listing_publish_intents"
        ("id", "workflow_id", "owner_user_id", "shop_id", "draft_version", "revision",
         "idempotency_key", "payload_hash", "actor_user_id", "created_at")
       VALUES ($1, $2, $3, $4, 1, 1, $5, $6, $3, $7)`,
      `${seed.prefix}_historical_intent`, draft.id, seed.ownerUserId, seed.otherShopId,
      `${seed.prefix}_historical_publish`, 'd'.repeat(64), seed.now,
    )).rejects.toThrow(/must reference the current owned draft revision/i);

    const intents = await first.$queryRawUnsafe<Array<{ count: bigint }>>(
      'SELECT COUNT(*) AS count FROM "source_listing_publish_intents" WHERE "workflow_id" = $1',
      draft.id,
    );
    expect(Number(intents[0]?.count)).toBe(0);
  }, 30_000);

  it('rejects a direct current-pointer projection mismatch at deferred constraint time', async () => {
    const seed = await seedWorkflowOwner(first);
    const service = workflowService(first, seed, 'projection');
    const draft = await service.createDraft({
      ownerUserId: seed.ownerUserId, actorUserId: seed.ownerUserId, shopId: seed.shopId,
      supplyGoodsId: seed.supplyGoodsId, sourceCaptureSnapshotId: seed.snapshotId,
      sourceCaptureHash: seed.captureHash, selectedSkuKeys: ['sku-a'],
    });

    await expect(first.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO "source_listing_draft_versions"
          ("id", "workflow_id", "owner_user_id", "revision", "draft_version", "shop_id",
           "source_capture_snapshot_id", "legacy_supply_goods_id", "supply_goods_id",
           "selected_sku_keys", "selected_sku_hash", "stage", "status", "payload", "payload_hash",
           "parent_revision", "invalidation_reasons", "actor_user_id", "created_at")
         SELECT $1, "workflow_id", "owner_user_id", 2, 1, "shop_id",
                "source_capture_snapshot_id", "legacy_supply_goods_id", "supply_goods_id",
                "selected_sku_keys", "selected_sku_hash", "stage", "status",
                jsonb_set("payload", '{revision}', '2'::jsonb), "payload_hash",
                1, '[]'::jsonb, $2, $3
         FROM "source_listing_draft_versions"
         WHERE "workflow_id" = $4 AND "revision" = 1`,
        `${seed.prefix}_tampered_revision`, seed.ownerUserId, seed.now, draft.id,
      );
      await tx.$executeRawUnsafe(
        `UPDATE "source_listing_workflows"
         SET "current_revision" = 2, "current_draft_version" = 2,
             "selected_sku_hash" = $1, "updated_at" = $2
         WHERE "id" = $3`,
        'f'.repeat(64), seed.now, draft.id,
      );
    })).rejects.toThrow(/current projection does not match current draft/i);

    const durable = await first.$queryRawUnsafe<Array<{ currentRevision: number; revisions: bigint }>>(
      `SELECT workflow."current_revision" AS "currentRevision",
              (SELECT COUNT(*) FROM "source_listing_draft_versions" draft
               WHERE draft."workflow_id" = workflow."id") AS revisions
       FROM "source_listing_workflows" workflow WHERE workflow."id" = $1`,
      draft.id,
    );
    expect(durable[0]).toMatchObject({ currentRevision: 1, revisions: 1n });
  }, 30_000);
});
