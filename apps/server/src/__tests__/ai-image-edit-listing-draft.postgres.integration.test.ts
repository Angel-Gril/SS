import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const databaseUrl = process.env.AI_MEDIA_TEST_DATABASE_URL || '';
const enabled = process.env.RUN_AI_MEDIA_POSTGRES_TESTS === '1' && Boolean(databaseUrl);
const describePostgres = enabled ? describe : describe.skip;
const client = enabled ? new PrismaClient({ datasources: { db: { url: databaseUrl } } }) : null;

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

function assertIsolatedSchema() {
  const schema = databaseUrl ? new URL(databaseUrl).searchParams.get('schema') || '' : '';
  if (!/^ai_media_test_[a-z0-9_]+$/u.test(schema)) {
    throw new Error('AI_MEDIA_TEST_DATABASE_URL must target an isolated ai_media_test_* schema');
  }
}

async function createListingDraftFixture(database: PrismaClient, suffix: string) {
  const ownerUserId = `draft_chain_owner_${suffix}`;
  const goodsId = `draft_chain_goods_${suffix}`;
  const subjectId = `draft_chain_subject_${suffix}`;
  const snapshotId = `draft_chain_snapshot_${suffix}`;
  const shopId = `draft_chain_shop_${suffix}`;
  const listingWorkflowId = `draft_chain_listing_${suffix}`;
  const draftId = `draft_chain_version_${suffix}`;
  const sourceAssetId = `draft_chain_source_${suffix}`;
  const originWorkflowId = `draft_chain_origin_workflow_${suffix}`;
  const originJobId = `draft_chain_origin_job_${suffix}`;
  const rawAssetId = `draft_chain_raw_${suffix}`;
  const candidateAssetId = `draft_chain_candidate_${suffix}`;
  const selectedSkuKeys = ['sku-1'];
  const captureHash = '1'.repeat(64);
  const sourceSha256 = '2'.repeat(64);
  const rawSha256 = '3'.repeat(64);
  const candidateSha256 = '4'.repeat(64);
  const now = new Date();
  const completedAt = new Date(now.getTime() - 5_000);
  const payload = {
    id: listingWorkflowId,
    ownerUserId,
    shopId,
    supplyGoodsId: goodsId,
    sourceCaptureSnapshotId: snapshotId,
    sourceCaptureHash: captureHash,
    revision: 1,
    draftVersion: 1,
    selectedSkuKeys,
    stage: 'DRAFT',
    runState: 'ACTIVE',
  };
  const payloadHash = hash(JSON.stringify(payload));

  await database.user.create({ data: {
    id: ownerUserId,
    phone: `draft_chain_${suffix}`,
    passwordHash: 'integration-test',
  } });
  await database.supplyGoods.create({ data: {
    id: goodsId,
    userId: ownerUserId,
    title: 'Listing draft candidate chain fixture',
    sourcePlatform: '1688',
    sourceProductId: `draft_chain_product_${suffix}`,
  } });
  await database.sourceCaptureSubject.create({ data: {
    id: subjectId,
    ownerUserId,
    sourcePlatform: '1688',
    sourceProductId: `draft_chain_product_${suffix}`,
    legacySupplyGoodsId: goodsId,
  } });
  await database.sourceCaptureSnapshot.create({ data: {
    id: snapshotId,
    subjectId,
    version: 1,
    schemaVersion: 'source-product-capture-v2',
    captureHash,
    payloadBytes: 2,
    payload: {},
    stageCounts: {},
    provenance: {},
    provenanceComplete: true,
    parserVersion: 'integration',
    completeness: {},
    truncations: [],
    hasEstimatedValues: false,
    profile: {},
    profileHash: '5'.repeat(64),
    actorUserId: ownerUserId,
    ingestChannel: 'WEB_ACCOUNT',
    rolloutRevision: 'integration',
    rolloutStage: 'v2_only',
    capturedAt: now,
  } });
  await database.shop.create({ data: {
    id: shopId,
    userId: ownerUserId,
    platform: 'OZON',
    name: 'Draft chain shop',
    apiKeyEncrypted: 'integration-test',
  } });
  await database.mediaAsset.create({ data: {
    id: sourceAssetId,
    ownerUserId,
    kind: 'SOURCE_ORIGINAL',
    sourceCaptureSnapshotId: snapshotId,
    sourceMediaKey: 'main-1',
    sourceUrl: 'https://source.example/draft-chain.png',
    url: `/uploads/${sourceAssetId}.png`,
    storageBackend: 'local',
    storageKey: `${sourceAssetId}.png`,
    mimeType: 'image/png',
    sizeBytes: 68,
    width: 2,
    height: 2,
    sha256: sourceSha256,
    metadata: { pixelOrientationNormalized: true },
  } });

  await database.$transaction(async (tx: any) => {
    await tx.$executeRawUnsafe(
      `INSERT INTO "source_listing_workflows"
        ("id", "owner_user_id", "shop_id", "source_subject_id",
         "current_source_capture_snapshot_id", "legacy_supply_goods_id", "supply_goods_id",
         "selected_sku_keys", "selected_sku_hash", "current_revision", "current_draft_version",
         "stage", "status", "created_at", "updated_at")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, 1, 1, 'DRAFT', 'ACTIVE', $10, $10)`,
      listingWorkflowId, ownerUserId, shopId, subjectId, snapshotId, goodsId, goodsId,
      JSON.stringify(selectedSkuKeys), '6'.repeat(64), now,
    );
    await tx.$executeRawUnsafe(
      `INSERT INTO "source_listing_draft_versions"
        ("id", "workflow_id", "owner_user_id", "revision", "draft_version", "shop_id",
         "source_capture_snapshot_id", "legacy_supply_goods_id", "supply_goods_id",
         "selected_sku_keys", "selected_sku_hash", "stage", "status", "payload", "payload_hash",
         "parent_revision", "invalidation_reasons", "actor_user_id", "created_at")
       VALUES ($1, $2, $3, 1, 1, $4, $5, $6, $7, $8::jsonb, $9, 'DRAFT', 'ACTIVE', $10::jsonb, $11,
               NULL, '[]'::jsonb, $3, $12)`,
      draftId, listingWorkflowId, ownerUserId, shopId, snapshotId, goodsId, goodsId,
      JSON.stringify(selectedSkuKeys), '6'.repeat(64), JSON.stringify(payload), payloadHash, now,
    );
  });

  await database.$transaction(async (tx: any) => {
    await tx.aiMediaWorkflow.create({ data: {
      id: originWorkflowId,
      ownerUserId,
      actorUserId: ownerUserId,
      operation: 'FULL_EDIT',
      status: 'SUCCEEDED',
      reviewStatus: 'PENDING',
      currentAttempt: 1,
      contextType: 'listing-draft',
      contextId: listingWorkflowId,
      contextSkuKey: 'sku-1',
      contextSlotKey: 'hero',
      contextDraftRevision: 1,
      contextDraftVersion: 1,
      requestFingerprint: '7'.repeat(64),
      createdAt: new Date(now.getTime() - 10_000),
      completedAt,
    } });
    await tx.aiMediaWorkflowInput.create({ data: {
      workflowId: originWorkflowId,
      ownerUserId,
      assetId: sourceAssetId,
      role: 'REFERENCE',
      ordinal: 0,
      assetSha256: sourceSha256,
      assetUrl: `/uploads/${sourceAssetId}.png`,
      mimeType: 'image/png',
      width: 2,
      height: 2,
    } });
    await tx.aiImageJob.create({ data: {
      id: originJobId,
      ownerUserId,
      actorUserId: ownerUserId,
      status: 'SUCCEEDED',
      operation: 'FULL_EDIT',
      workflowId: originWorkflowId,
      workflowAttempt: 1,
      provider: 'fake',
      model: 'fake-edit-v1',
      prompt: 'origin',
      resolvedPrompt: 'origin',
      requestFingerprint: '7'.repeat(64),
      inputAssets: [{ assetId: sourceAssetId, role: 'REFERENCE', ordinal: 0, sha256: sourceSha256 }],
      requestedImageCount: 1,
      width: 2,
      height: 2,
      maxAttempts: 1,
      idempotencyKey: `${originJobId}:attempt:1`,
      progress: 100,
      completedAt,
      billedUnits: 1,
    } });
    await tx.mediaAsset.create({ data: {
      id: rawAssetId,
      ownerUserId,
      aiImageJobId: originJobId,
      kind: 'AI_PROVIDER_OUTPUT',
      url: `/uploads/${rawAssetId}.png`,
      storageBackend: 'local',
      storageKey: `${rawAssetId}.png`,
      mimeType: 'image/png',
      sizeBytes: 68,
      width: 2,
      height: 2,
      sha256: rawSha256,
      metadata: { outputRole: 'PROVIDER_RAW', operation: 'FULL_EDIT' },
    } });
    await tx.mediaAsset.create({ data: {
      id: candidateAssetId,
      ownerUserId,
      aiImageJobId: originJobId,
      kind: 'AI_GENERATED',
      sourceCaptureSnapshotId: snapshotId,
      url: `/uploads/${candidateAssetId}.png`,
      storageBackend: 'local',
      storageKey: `${candidateAssetId}.png`,
      mimeType: 'image/png',
      sizeBytes: 68,
      width: 2,
      height: 2,
      sha256: candidateSha256,
      metadata: {
        outputRole: 'FINAL_CANDIDATE',
        operation: 'FULL_EDIT',
        providerOutputAssetId: rawAssetId,
        pixelOrientationNormalized: true,
        editSourceContractVersion: 'ai-media-edit-source/v1',
      },
    } });
  });

  return {
    ownerUserId,
    listingWorkflowId,
    candidateAssetId,
    draftId,
    shopId,
    subjectId,
    snapshotId,
    goodsId,
    selectedSkuKeys,
    now,
  };
}

async function insertConsumer(database: PrismaClient, fixture: Awaited<ReturnType<typeof createListingDraftFixture>>, suffix: string, input: {
  workflowId: string;
  revision: number;
  draftVersion: number;
}) {
  const jobId = `${input.workflowId}-job`;
  await database.$transaction(async (tx: any) => {
    await tx.aiMediaWorkflow.create({ data: {
      id: input.workflowId,
      ownerUserId: fixture.ownerUserId,
      actorUserId: fixture.ownerUserId,
      operation: 'FULL_EDIT',
      status: 'QUEUED',
      reviewStatus: 'NOT_READY',
      currentAttempt: 1,
      contextType: 'listing-draft',
      contextId: fixture.listingWorkflowId,
      contextSkuKey: 'sku-1',
      contextSlotKey: 'hero',
      contextDraftRevision: input.revision,
      contextDraftVersion: input.draftVersion,
      idempotencyKey: `${suffix}-${input.workflowId}`,
      requestFingerprint: hash(input.workflowId),
    } });
    await tx.aiImageJob.create({ data: {
      id: jobId,
      ownerUserId: fixture.ownerUserId,
      actorUserId: fixture.ownerUserId,
      status: 'QUEUED',
      operation: 'FULL_EDIT',
      workflowId: input.workflowId,
      workflowAttempt: 1,
      provider: 'fake',
      model: 'fake-edit-v1',
      prompt: 'consumer',
      resolvedPrompt: 'consumer',
      requestFingerprint: hash(jobId),
      inputAssets: [{ assetId: fixture.candidateAssetId, role: 'REFERENCE', ordinal: 0, sha256: '4'.repeat(64) }],
      requestedImageCount: 1,
      width: 2,
      height: 2,
      maxAttempts: 1,
      idempotencyKey: `${jobId}:attempt:1`,
    } });
    await tx.aiMediaWorkflowInput.create({ data: {
      workflowId: input.workflowId,
      ownerUserId: fixture.ownerUserId,
      assetId: fixture.candidateAssetId,
      role: 'REFERENCE',
      ordinal: 0,
      assetSha256: '4'.repeat(64),
      assetUrl: `/uploads/${fixture.candidateAssetId}.png`,
      mimeType: 'image/png',
      width: 2,
      height: 2,
    } });
  });
}

describePostgres('AI image edit listing-draft candidate scope PostgreSQL workflow', () => {
  beforeAll(async () => {
    assertIsolatedSchema();
    await client!.$connect();
  });
  afterAll(async () => client?.$disconnect());

  it('accepts same revision/version and rejects a cross-revision candidate chain', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const fixture = await createListingDraftFixture(client!, suffix);

    await insertConsumer(client!, fixture, suffix, {
      workflowId: `draft_chain_same_${suffix}`,
      revision: 1,
      draftVersion: 1,
    });

    const revisionTwoDraftId = `draft_chain_version_two_${suffix}`;
    const revisionTwoPayload = {
      id: fixture.listingWorkflowId,
      ownerUserId: fixture.ownerUserId,
      shopId: fixture.shopId,
      supplyGoodsId: fixture.goodsId,
      sourceCaptureSnapshotId: fixture.snapshotId,
      sourceCaptureHash: '1'.repeat(64),
      revision: 2,
      draftVersion: 2,
      selectedSkuKeys: fixture.selectedSkuKeys,
      stage: 'DRAFT',
      runState: 'ACTIVE',
    };
    await client!.$transaction(async (tx: any) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO "source_listing_draft_versions"
          ("id", "workflow_id", "owner_user_id", "revision", "draft_version", "shop_id",
           "source_capture_snapshot_id", "legacy_supply_goods_id", "supply_goods_id",
           "selected_sku_keys", "selected_sku_hash", "stage", "status", "payload", "payload_hash",
           "parent_revision", "invalidation_reasons", "actor_user_id", "created_at")
         VALUES ($1, $2, $3, 2, 2, $4, $5, $6, $7, $8::jsonb, $9, 'DRAFT', 'ACTIVE', $10::jsonb, $11,
                 1, '[]'::jsonb, $3, $12)`,
        revisionTwoDraftId, fixture.listingWorkflowId, fixture.ownerUserId, fixture.shopId,
        fixture.snapshotId, fixture.goodsId, fixture.goodsId, JSON.stringify(fixture.selectedSkuKeys),
        '6'.repeat(64), JSON.stringify(revisionTwoPayload), hash(JSON.stringify(revisionTwoPayload)), fixture.now,
      );
      await tx.$executeRawUnsafe(
        `UPDATE "source_listing_workflows"
         SET "current_revision" = 2, "current_draft_version" = 2
         WHERE "id" = $1 AND "owner_user_id" = $2`,
        fixture.listingWorkflowId,
        fixture.ownerUserId,
      );
    });

    await expect(insertConsumer(client!, fixture, suffix, {
      workflowId: `draft_chain_cross_revision_${suffix}`,
      revision: 2,
      draftVersion: 2,
    })).rejects.toThrow(/generated source authority is invalid|candidate SKU or slot scope is invalid/i);
  });
});
