import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import type { SourceProductCaptureV2 } from 'shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { BrowserOneClickListingJobReceipt } from '../routes/listing.js';
import type { createSourceListingWorkflowService } from '../services/source-listing-workflow.js';
import type { createPrismaSourceListingWorkflowContextResolver } from '../services/source-listing-workflow-context.js';
import type { SourceWorkflowFeatureFlagEvaluator } from '../services/source-workflow-feature-flags.js';

const boundaries = vi.hoisted(() => ({
  authenticate: vi.fn(async (request: FastifyRequest) => {
    const ownerUserId = String(request.headers['x-test-owner-id'] || '');
    Object.assign(request, {
      user: { userId: ownerUserId, actorUserId: ownerUserId, role: 'USER' },
    });
  }),
  ozonClient: vi.fn(function () { throw new Error('TEST ONLY: Ozon calls are forbidden'); }),
  enqueue: vi.fn(() => { throw new Error('TEST ONLY: queueing is forbidden'); }),
  appendRows: vi.fn(() => { throw new Error('TEST ONLY: queue appends are forbidden'); }),
  postPublishSync: vi.fn(() => { throw new Error('TEST ONLY: publish sync is forbidden'); }),
  fetch: vi.fn(async () => { throw new Error('TEST ONLY: external fetch is forbidden'); }),
}));

// Only authentication and outbound boundaries are replaced. Prisma, configuration,
// capture, context resolution, and the default workflow adapter remain production code.
vi.mock('../lib/auth.js', () => ({ authenticate: boundaries.authenticate }));
vi.mock('../services/ozon-client.js', () => ({ OzonClient: boundaries.ozonClient }));
vi.mock('../workers/browser-one-click-listing.js', () => ({
  addBrowserOneClickListingJob: boundaries.enqueue,
  appendBrowserOneClickListingRows: boundaries.appendRows,
}));
vi.mock('../services/post-publish-sync.js', () => ({
  enqueueProductSyncAfterPublish: boundaries.postPublishSync,
}));

const testDatabaseUrl = process.env.LOGISTICS_TEST_DATABASE_URL || '';
const runRequested = process.env.RUN_LOGISTICS_POSTGRES_TESTS === '1';
const explicitRunner = process.env.npm_lifecycle_event === 'test:logistics:postgres';
if ((explicitRunner || runRequested) && (!runRequested || !testDatabaseUrl)) {
  throw new Error(
    'test:logistics:postgres requires RUN_LOGISTICS_POSTGRES_TESTS=1 and LOGISTICS_TEST_DATABASE_URL',
  );
}
const describePostgres = runRequested && testDatabaseUrl ? describe : describe.skip;
const CONFIG_KEYS = [
  'feature_source_capture_v2',
  'feature_source_listing_workflow',
  'feature_source_ozon_publisher_v2',
  'source_workflow_rollout_policy',
];

function assertIsolatedSchema(urlText: string): string {
  let schema = '';
  try { schema = new URL(urlText).searchParams.get('schema') || ''; } catch { /* Do not echo credentials. */ }
  if (!/^logistics_test_[a-z0-9_]+$/u.test(schema)) {
    throw new Error('LOGISTICS_TEST_DATABASE_URL must target an isolated logistics_test_* schema');
  }
  return schema;
}

async function seedTestOwners(client: PrismaClient) {
  const prefix = `test_only_browser_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const ownerUserId = `${prefix}_owner`;
  const otherOwnerUserId = `${prefix}_other_owner`;
  const shopId = `${prefix}_shop`;
  const otherShopId = `${prefix}_other_shop`;
  await client.user.createMany({ data: [ownerUserId, otherOwnerUserId].map((id) => ({
    id, phone: `${id}_not_a_phone`, passwordHash: 'TEST ONLY not a password hash',
  })) });
  await client.shop.createMany({ data: [
    { id: shopId, userId: ownerUserId },
    { id: otherShopId, userId: otherOwnerUserId },
  ].map((owner) => ({
    ...owner, platform: 'OZON' as const, status: 'ACTIVE' as const,
    name: `TEST ONLY ${owner.id}`, apiKeyEncrypted: 'TEST ONLY no credential',
  })) });
  return { prefix, ownerUserId, otherOwnerUserId, shopId, otherShopId };
}

describePostgres('browser one-click isolated PostgreSQL review flow', () => {
  let client: PrismaClient;
  let observer: PrismaClient;
  let app: FastifyInstance;
  let featureFlags: SourceWorkflowFeatureFlagEvaluator;
  let workflowReader: ReturnType<typeof createSourceListingWorkflowService>;
  let ownership: ReturnType<typeof createPrismaSourceListingWorkflowContextResolver>;
  let previousConfig: Array<{ key: string; value: string; updatedAt: Date }> | undefined;

  beforeAll(async () => {
    const expectedSchema = assertIsolatedSchema(testDatabaseUrl);
    // Load the real singleton only after setting its explicitly isolated datasource.
    // A normal test run skips this hook and never imports the route's dependency tree.
    vi.stubEnv('DATABASE_URL', testDatabaseUrl);
    vi.stubGlobal('fetch', boundaries.fetch);
    ({ prisma: client } = await import('../lib/prisma.js'));
    observer = new PrismaClient({ datasourceUrl: testDatabaseUrl });
    for (const connection of [client, observer]) {
      const rows = await connection.$queryRawUnsafe<Array<{ schema: string }>>(
        'SELECT current_schema() AS schema',
      );
      expect(rows).toEqual([{ schema: expectedSchema }]);
    }
    const migrations = await observer.$queryRawUnsafe<Array<{ migrationName: string }>>(
      `SELECT "migration_name" AS "migrationName" FROM "_prisma_migrations"
       WHERE "migration_name" IN (
         '20260714210000_add_source_capture_snapshots',
         '20260715160000_add_source_listing_workflows',
         '20260715170000_harden_source_listing_workflow_consistency',
         '20260715180000_align_source_listing_workflow_limits'
       ) AND "finished_at" IS NOT NULL`,
    );
    expect(migrations).toHaveLength(4);
    previousConfig = await client.systemConfig.findMany({
      where: { key: { in: CONFIG_KEYS } }, select: { key: true, value: true, updatedAt: true },
    });

    const [captureModule, captureRepository, listingModule, flagsModule, rolloutModule,
      workflowModule, workflowRepository, contextModule] = await Promise.all([
      import('../services/source-capture.js'),
      import('../services/source-capture-prisma.js'),
      import('../routes/listing.js'),
      import('../services/source-workflow-feature-flags.js'),
      import('../services/ozon-publisher-entrypoint-rollout.js'),
      import('../services/source-listing-workflow.js'),
      import('../services/source-listing-workflow-prisma.js'),
      import('../services/source-listing-workflow-context.js'),
    ]);
    featureFlags = flagsModule.createSourceWorkflowFeatureFlagEvaluator();
    workflowReader = workflowModule.createSourceListingWorkflowService({
      repository: workflowRepository.createPrismaSourceListingWorkflowRepository({
        client: observer as never,
      }),
    });
    ownership = contextModule.createPrismaSourceListingWorkflowContextResolver({ client: observer });
    app = Fastify();
    // Match index.ts: listingRoutes supplies its own real legacy workflow adapter.
    await app.register(listingModule.listingRoutes, {
      prefix: '/api/listing',
      featureFlags,
      sourceCaptureService: captureModule.createSourceCaptureService({
        repository: captureRepository.createPrismaSourceCaptureRepository({
          client, commandGrantSecret: 'TEST-ONLY-browser-capture-command-secret-0123456789',
        }),
      }),
      publisherRollout: rolloutModule.createOzonPublisherEntrypointRolloutService({ featureFlags }),
    });
    await app.ready();
  }, 30_000);

  afterAll(async () => {
    try {
      await app?.close();
      if (previousConfig) {
        for (const key of CONFIG_KEYS) {
          const previous = previousConfig.find((row) => row.key === key);
          if (previous) {
            await client.systemConfig.update({
              where: { key }, data: { value: previous.value, updatedAt: previous.updatedAt },
            });
          } else {
            await client.systemConfig.deleteMany({ where: { key } });
          }
        }
      }
    } finally {
      await Promise.all([client?.$disconnect(), observer?.$disconnect()]);
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it.each(['dual_read', 'v2_only'] as const)('keeps %s review drafts isolated and unpublished', async (listingStage) => {
    const seed = await seedTestOwners(client);
    const sourceSku = `TEST_ONLY_SKU_${seed.prefix}`;
    const sourceUrl = `https://example.invalid/test-only/ozon/${sourceSku}/`;
    const imageUrl = 'https://example.invalid/test-only/product.png';
    const title = 'TEST ONLY synthetic product - not for sale';
    const rolloutRevision = `${seed.prefix}_policy`;
    const pilot = {
      mode: 'pilot', ownerUserIds: [seed.ownerUserId, seed.otherOwnerUserId],
      shopIds: [seed.shopId, seed.otherShopId], platforms: ['OZON'],
    };
    const config = {
      feature_source_capture_v2: 'true',
      feature_source_listing_workflow: 'true',
      feature_source_ozon_publisher_v2: 'false',
      source_workflow_rollout_policy: JSON.stringify({
        revision: rolloutRevision,
        features: {
          SOURCE_CAPTURE_V2: { ...pilot, stage: 'shadow_write' },
          SOURCE_LISTING_WORKFLOW: { ...pilot, listingStage },
          SOURCE_OZON_PUBLISHER_V2: { mode: 'off' },
        },
      }),
    };
    for (const [key, value] of Object.entries(config)) {
      await client.systemConfig.upsert({ where: { key }, create: { key, value }, update: { value } });
    }
    const featureContext = { ownerUserId: seed.ownerUserId, shopId: seed.shopId, platform: 'OZON' };
    expect(await featureFlags.evaluate('SOURCE_CAPTURE_V2', featureContext)).toMatchObject({
      enabled: true, captureStage: 'shadow_write', reason: 'pilot_match', revision: rolloutRevision,
    });
    expect(await featureFlags.evaluate('SOURCE_LISTING_WORKFLOW', featureContext)).toMatchObject({
      enabled: true, listingStage, legacyAllowed: listingStage === 'dual_read', revision: rolloutRevision,
    });
    expect(await featureFlags.evaluate('SOURCE_OZON_PUBLISHER_V2', featureContext)).toMatchObject({
      enabled: false, reason: 'master_off',
    });

    const headers = { 'x-test-owner-id': seed.ownerUserId };
    const otherHeaders = { 'x-test-owner-id': seed.otherOwnerUserId };
    const createPayload = {
      shopId: seed.shopId, clientRequestId: `${seed.prefix}_request`,
      sourceSkus: [sourceSku], productUrls: [sourceUrl], itemCount: 1,
    };
    const create = () => app.inject({
      method: 'POST', url: '/api/listing/browser-one-click-jobs', headers, payload: createPayload,
    });
    // Both requests execute the actual PostgreSQL advisory lock and sync_jobs writes.
    const concurrent = await Promise.all([create(), create()]);
    const created = concurrent.map((response) => {
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ code: 1, data: { queued: false, deferred: true } });
      return response.json<{ data: { jobId: string; idempotent: boolean } }>().data;
    });
    expect(created.map(({ idempotent }) => idempotent).sort()).toEqual([false, true]);
    expect(new Set(created.map(({ jobId }) => jobId)).size).toBe(1);
    const jobId = created[0]!.jobId;
    const initialJob = await observer.syncJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(initialJob.payload).toMatchObject({
      stage: 'preparing_browser_data', browserPayloadRevision: 0,
      browserOneClickWorkflow: {
        publisherObservation: { authority: 'BLOCKED', effectiveStage: 'off' },
      },
    });
    expect(await observer.syncJob.count({ where: { shopId: seed.shopId } })).toBe(1);
    expect(await observer.sourceCaptureSubject.count({ where: { ownerUserId: seed.ownerUserId } })).toBe(0);
    expect(await observer.sourceListingWorkflow.count({ where: { ownerUserId: seed.ownerUserId } })).toBe(0);

    const evidence = {
      status: 'RUNNING',
      payload: {
        stage: 'submitted', browserPayloadReady: true, browserPayloadComplete: true,
        rows: [{
          sku: sourceSku, sourceUrl, title, images: [imageUrl], priceCny: 12.34, stock: 0,
          description: 'TEST ONLY offline fixture; no real goods or customer data.',
          weightG: 100, lengthMm: 100, widthMm: 80, heightMm: 60,
        }],
      },
    };
    const deniedCreate = await app.inject({
      method: 'POST', url: '/api/listing/browser-one-click-jobs',
      headers: otherHeaders, payload: createPayload,
    });
    const deniedPatch = await app.inject({
      method: 'PATCH', url: `/api/listing/browser-one-click-jobs/${jobId}`,
      headers: otherHeaders, payload: evidence,
    });
    expect(deniedCreate.statusCode).toBe(404);
    expect(deniedPatch.statusCode).toBe(404);
    expect(await observer.syncJob.findUniqueOrThrow({ where: { id: jobId } })).toEqual(initialJob);

    const reviewed = await app.inject({
      method: 'PATCH', url: `/api/listing/browser-one-click-jobs/${jobId}`, headers, payload: evidence,
    });
    expect(reviewed.statusCode).toBe(200);
    const receipt = reviewed.json<{ data: BrowserOneClickListingJobReceipt }>().data;
    expect(receipt).toMatchObject({
      jobId, status: 'RUNNING', stage: 'review_required', browserPayloadRevision: 1,
      acceptedSkus: [sourceSku],
      handoff: {
        contractVersion: 'browser-one-click-v2-handoff/v1', state: 'REVIEW_REQUIRED',
        failures: [], rollout: { authority: 'BLOCKED', effectiveStage: 'off' },
      },
    });
    expect(receipt.handoff?.drafts).toHaveLength(1);
    const pointer = receipt.handoff!.drafts[0]!;
    expect(pointer).toMatchObject({
      sourceSku, skuKey: `legacy-${sourceSku}`, draftVersion: 1, revision: 1,
    });
    const persistedJob = await observer.syncJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(persistedJob).toMatchObject({ status: 'RUNNING', result: null, finishedAt: null, errorMessage: null });
    expect(persistedJob.payload).toMatchObject({
      stage: 'review_required', browserOneClickPublishHandoff: receipt.handoff,
      sourceListingDraftRefs: [pointer], supplyGoodsIds: [pointer.supplyGoodsId],
    });
    expect(persistedJob.payload).not.toHaveProperty('taskId');
    expect(persistedJob.payload).not.toHaveProperty('browserQueueStartedAt');

    const subject = await observer.sourceCaptureSubject.findFirstOrThrow({
      where: { ownerUserId: seed.ownerUserId, sourcePlatform: 'ozon', sourceProductId: sourceSku },
    });
    expect(subject.legacySupplyGoodsId).toBe(pointer.supplyGoodsId);
    const goods = await observer.supplyGoods.findUniqueOrThrow({ where: { id: pointer.supplyGoodsId } });
    expect(goods).toMatchObject({ userId: seed.ownerUserId, sourceProductId: sourceSku, sourceUrl, title });
    const snapshot = await observer.sourceCaptureSnapshot.findUniqueOrThrow({ where: { id: pointer.snapshotId } });
    expect(snapshot).toMatchObject({
      subjectId: subject.id, version: 1, ingestChannel: 'LEGACY_ADAPTER',
      actorUserId: seed.ownerUserId, rolloutRevision, rolloutStage: 'shadow_write',
      provenanceComplete: false,
    });
    const capture = snapshot.payload as unknown as SourceProductCaptureV2;
    expect(capture).toMatchObject({
      provenanceMode: 'legacy_adapted', sourceIdentity: { productId: sourceSku, canonicalUrl: sourceUrl },
      facts: { title },
    });
    expect(capture.skus).toMatchObject([{
      key: pointer.skuKey, sourceSkuId: sourceSku, priceCny: 12.34, stock: 0,
    }]);
    expect(capture.media).toMatchObject([{ url: imageUrl }]);
    const draft = await workflowReader.getDraft({ draftId: pointer.draftId, ownerUserId: seed.ownerUserId });
    expect(draft).toMatchObject({
      id: pointer.draftId, ownerUserId: seed.ownerUserId, shopId: seed.shopId,
      supplyGoodsId: pointer.supplyGoodsId, sourceCaptureSnapshotId: pointer.snapshotId,
      sourceCaptureHash: snapshot.captureHash, selectedSkuKeys: [pointer.skuKey],
      revision: 1, draftVersion: 1, stage: 'CATEGORY_REVIEW', category: null,
      validation: { status: 'NOT_RUN' }, publishTaskIds: [],
    });
    const storedWorkflow = await observer.sourceListingWorkflow.findUniqueOrThrow({
      where: { id: pointer.draftId }, include: { currentDraft: true },
    });
    expect(storedWorkflow).toMatchObject({
      ownerUserId: seed.ownerUserId, shopId: seed.shopId, sourceSubjectId: subject.id,
      currentSourceCaptureSnapshotId: snapshot.id, currentRevision: 1, currentDraftVersion: 1,
      currentDraft: { payload: draft, sourceCaptureSnapshotId: snapshot.id },
    });

    await expect(ownership.assertOwnedTarget({
      ownerUserId: seed.otherOwnerUserId, shopId: seed.otherShopId,
      supplyGoodsId: pointer.supplyGoodsId, selectedSkuKeys: [pointer.skuKey],
    })).rejects.toMatchObject({ code: 'SOURCE_LISTING_SOURCE_NOT_FOUND', statusCode: 404 });
    await expect(workflowReader.setCategory({
      draftId: pointer.draftId, ownerUserId: seed.otherOwnerUserId,
      actorUserId: seed.otherOwnerUserId, expectedRevision: 1,
      category: { categoryId: 1, typeId: 1, catalogRevision: 'TEST-ONLY-forbidden-category' },
    })).rejects.toMatchObject({ code: 'OZON_LISTING_DRAFT_NOT_FOUND', statusCode: 404 });
    const replayedCreate = await create();
    expect(replayedCreate.statusCode).toBe(200);
    expect(replayedCreate.json()).toMatchObject({ data: { jobId, idempotent: true } });
    const replayedPatch = await app.inject({
      method: 'PATCH', url: `/api/listing/browser-one-click-jobs/${jobId}`, headers, payload: evidence,
    });
    expect(replayedPatch.statusCode).toBe(200);
    expect(replayedPatch.json()).toMatchObject({ data: receipt });
    expect(await observer.syncJob.findUniqueOrThrow({ where: { id: jobId } })).toEqual(persistedJob);

    expect(await observer.syncJob.count({ where: { shopId: seed.shopId } })).toBe(1);
    expect(await observer.supplyGoods.count({ where: { userId: seed.ownerUserId } })).toBe(1);
    expect(await observer.sourceCaptureSubject.count({ where: { ownerUserId: seed.ownerUserId } })).toBe(1);
    expect(await observer.sourceCaptureSnapshot.count({ where: { subjectId: subject.id } })).toBe(1);
    expect(await observer.sourceListingWorkflow.count({ where: { ownerUserId: seed.ownerUserId } })).toBe(1);
    expect(await observer.sourceListingDraftVersion.count({ where: { workflowId: pointer.draftId } })).toBe(1);
    expect(await observer.sourceListingWorkflowEvent.findMany({
      where: { workflowId: pointer.draftId }, select: { eventType: true, actorUserId: true },
    })).toEqual([{ eventType: 'DRAFT_CREATED', actorUserId: seed.ownerUserId }]);
    expect(await observer.sourceListingPublishIntent.count({ where: { ownerUserId: seed.ownerUserId } })).toBe(0);
    expect(await observer.ozonPublishAttempt.count({ where: { ownerUserId: seed.ownerUserId } })).toBe(0);
    expect(await observer.sourceListingWorkflow.count({ where: { ownerUserId: seed.otherOwnerUserId } })).toBe(0);
    expect(boundaries.ozonClient).not.toHaveBeenCalled();
    expect(boundaries.enqueue).not.toHaveBeenCalled();
    expect(boundaries.appendRows).not.toHaveBeenCalled();
    expect(boundaries.postPublishSync).not.toHaveBeenCalled();
    expect(boundaries.fetch).not.toHaveBeenCalled();
  }, 45_000);
});
