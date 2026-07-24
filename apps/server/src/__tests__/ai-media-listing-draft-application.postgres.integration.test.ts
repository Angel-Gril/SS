import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaAiImageJobRepository } from '../repositories/ai-image-job-repository.js';
import { PrismaAiMediaWorkflowRepository } from '../repositories/ai-media-workflow-repository.js';
import {
  applyAiMediaListingDraftApplication,
  listAiMediaListingDraftApplications,
  rollbackAiMediaListingDraftApplication,
} from '../services/ai-media-listing-draft-application-mutations.js';
import { applyAiMediaWorkflowApplication } from '../services/ai-media-application-mutations.js';
import { createFakeAiImageProvider, runAiImageJob } from '../services/ai-image-jobs.js';
import { createAiMediaWorkflowService } from '../services/ai-media-workflows.js';
import { createPrismaSourceListingWorkflowRepository } from '../services/source-listing-workflow-prisma.js';
import { createSourceListingWorkflowService } from '../services/source-listing-workflow.js';
import { lockAiMediaApplicationOperation } from '../lib/ai-media-transaction.js';

const databaseUrl = process.env.AI_MEDIA_TEST_DATABASE_URL || '';
const enabled = process.env.RUN_AI_MEDIA_POSTGRES_TESTS === '1' && Boolean(databaseUrl);
const describePostgres = enabled ? describe : describe.skip;
const client = enabled ? new PrismaClient({ datasources: { db: { url: databaseUrl } } }) : null;
const SOURCE_PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2S8AAAAASUVORK5CYII=',
  'base64',
);
const SOURCE_PNG_SHA256 = createHash('sha256').update(SOURCE_PNG_BYTES).digest('hex');

function assertIsolatedSchema() {
  const schema = databaseUrl ? new URL(databaseUrl).searchParams.get('schema') || '' : '';
  if (!/^ai_media_test_[a-z0-9_]+$/u.test(schema)) {
    throw new Error('AI_MEDIA_TEST_DATABASE_URL must target an isolated ai_media_test_* schema');
  }
}

const capturePayload = {
  captureVersion: 'source-product-capture-v2',
  facts: { title: 'H3b listing fixture' },
  skus: [{ key: 'sku-red', sourceSkuId: 'red-source' }],
  media: [
    { key: 'sku-red-a', ordinal: 0, kind: 'image', disposition: 'accepted', role: 'sku', skuKeys: ['red-source'], url: 'https://source.example/sku-red-a.png' },
    { key: 'sku-red-b', ordinal: 1, kind: 'image', disposition: 'accepted', role: 'sku', skuKeys: ['red-source'], url: 'https://source.example/sku-red-b.png' },
  ],
};

async function fixture(database: PrismaClient, suffix: string) {
  const ownerUserId = `h3b_owner_${suffix}`;
  const goodsId = `h3b_goods_${suffix}`;
  const subjectId = `h3b_subject_${suffix}`;
  const snapshotId = `h3b_snapshot_${suffix}`;
  const shopId = `h3b_shop_${suffix}`;
  const sourceA = `h3b_source_a_${suffix}`;
  const sourceB = `h3b_source_b_${suffix}`;
  const now = new Date();
  await database.user.create({ data: { id: ownerUserId, phone: `h3b_${suffix}`, passwordHash: 'integration-test' } });
  await database.supplyGoods.create({ data: {
    id: goodsId, userId: ownerUserId, title: 'H3b listing fixture', sourcePlatform: '1688',
    sourceProductId: `h3b_product_${suffix}`,
  } });
  await database.sourceCaptureSubject.create({ data: {
    id: subjectId, ownerUserId, sourcePlatform: '1688', sourceProductId: `h3b_product_${suffix}`,
    legacySupplyGoodsId: goodsId,
  } });
  await database.sourceCaptureSnapshot.create({ data: {
    id: snapshotId, subjectId, version: 1, schemaVersion: 'source-product-capture-v2',
    captureHash: 'a'.repeat(64), payloadBytes: JSON.stringify(capturePayload).length,
    payload: capturePayload, stageCounts: {}, provenance: {}, provenanceComplete: true,
    parserVersion: 'integration', completeness: {}, truncations: [], hasEstimatedValues: false,
    profile: {}, profileHash: 'b'.repeat(64), actorUserId: ownerUserId,
    ingestChannel: 'WEB_ACCOUNT', rolloutRevision: 'integration', rolloutStage: 'v2_only', capturedAt: now,
  } });
  await database.shop.create({ data: {
    id: shopId, userId: ownerUserId, platform: 'OZON', name: 'H3b shop', apiKeyEncrypted: 'integration-test',
  } });
  for (const [id, key] of [[sourceA, 'sku-red-a'], [sourceB, 'sku-red-b']] as const) {
    await database.mediaAsset.create({ data: {
      id, ownerUserId, kind: 'SOURCE_ORIGINAL', sourceCaptureSnapshotId: snapshotId,
      sourceMediaKey: key, sourceUrl: `https://source.example/${key}.png`, url: `/uploads/${id}.png`,
      storageBackend: 'local', storageKey: `${id}.png`, mimeType: 'image/png',
      sizeBytes: SOURCE_PNG_BYTES.length, width: 1, height: 1, sha256: SOURCE_PNG_SHA256,
      metadata: { pixelOrientationNormalized: true },
    } });
  }
  const listingService = createSourceListingWorkflowService({
    repository: createPrismaSourceListingWorkflowRepository({ client: database as any }),
  });
  const draft = await listingService.createDraft({
    ownerUserId, actorUserId: ownerUserId, shopId, supplyGoodsId: goodsId,
    sourceCaptureSnapshotId: snapshotId, sourceCaptureHash: 'a'.repeat(64), selectedSkuKeys: ['sku-red'],
  });
  return { ownerUserId, goodsId, subjectId, snapshotId, shopId, sourceA, sourceB, draft };
}

async function reviewedWorkflow(
  database: PrismaClient,
  data: Awaited<ReturnType<typeof fixture>>,
  label: string,
  sourceAssetId: string,
  slotKey: string,
  revision: number,
  draftVersion: number,
) {
  const workflowService = createAiMediaWorkflowService(new PrismaAiMediaWorkflowRepository(database));
  const repository = new PrismaAiImageJobRepository(database);
  const created = await workflowService.createImageToImage({
    ownerUserId: data.ownerUserId, actorUserId: data.ownerUserId, sourceAssetId,
    prompt: `H3b ${label}`, negativePrompt: null, count: 1, width: 2, height: 2,
    dailyLimit: 0,
    idempotencyKey: `h3b-create-${label}-${data.draft.id}`,
    context: {
      type: 'listing-draft', id: data.draft.id, revision, draftVersion,
      skuKey: 'sku-red', slotKey,
    },
  });
  await runAiImageJob(created.jobId, 1, {
    repository,
    provider: createFakeAiImageProvider({
      images: [{ buffer: Buffer.from(`h3b-generated-${label}`), mimeType: 'image/png' }],
    }),
    uploadBuffer: async () => ({ url: `/uploads/h3b-${label}.png`, backend: 'local', key: `h3b-${label}.png` }),
    loadInputBuffer: async () => SOURCE_PNG_BYTES,
    maxAttempts: 1,
  });
  const succeeded = await workflowService.get(created.workflow.id, data.ownerUserId);
  const output = (succeeded.jobs?.[0] as any)?.assets?.find((asset: any) => asset.kind === 'AI_GENERATED');
  await workflowService.review({
    id: succeeded.id, ownerUserId: data.ownerUserId, actorUserId: data.ownerUserId,
    expectedRevision: succeeded.revision, outputAssetId: output.id, decision: 'APPROVE', note: null,
  });
  return {
    workflow: await workflowService.get(succeeded.id, data.ownerUserId),
    jobId: created.jobId,
    output,
  };
}

async function reviewedCollectWorkflow(
  database: PrismaClient,
  data: Awaited<ReturnType<typeof fixture>>,
  label: string,
) {
  const workflowService = createAiMediaWorkflowService(new PrismaAiMediaWorkflowRepository(database));
  const repository = new PrismaAiImageJobRepository(database);
  const created = await workflowService.createImageToImage({
    ownerUserId: data.ownerUserId, actorUserId: data.ownerUserId, sourceAssetId: data.sourceA,
    prompt: `H3b collect ${label}`, negativePrompt: null, count: 1, width: 2, height: 2,
    dailyLimit: 0,
    idempotencyKey: `h3b-collect-create-${label}-${data.draft.id}`,
    context: { type: 'collect', id: data.goodsId },
  });
  await runAiImageJob(created.jobId, 1, {
    repository,
    provider: createFakeAiImageProvider({
      images: [{ buffer: Buffer.from(`h3b-collect-generated-${label}`), mimeType: 'image/png' }],
    }),
    uploadBuffer: async () => ({
      url: `/uploads/h3b-collect-${label}.png`, backend: 'local', key: `h3b-collect-${label}.png`,
    }),
    loadInputBuffer: async () => SOURCE_PNG_BYTES,
    maxAttempts: 1,
  });
  const succeeded = await workflowService.get(created.workflow.id, data.ownerUserId);
  const output = (succeeded.jobs?.[0] as any)?.assets?.find((asset: any) => asset.kind === 'AI_GENERATED');
  await workflowService.review({
    id: succeeded.id, ownerUserId: data.ownerUserId, actorUserId: data.ownerUserId,
    expectedRevision: succeeded.revision, outputAssetId: output.id, decision: 'APPROVE', note: null,
  });
  return { workflow: await workflowService.get(succeeded.id, data.ownerUserId) };
}

describePostgres('AI media listing-draft application PostgreSQL ledger', () => {
  beforeAll(async () => {
    assertIsolatedSchema();
    await client!.$connect();
  });
  afterAll(async () => client?.$disconnect());

  it('applies two slots, compensates them in strict LIFO while always advancing the draft pointer', async () => {
    const data = await fixture(client!, randomUUID().replaceAll('-', '').slice(0, 10));
    const first = await reviewedWorkflow(client!, data, 'first', data.sourceA, 'slot-a', 1, 1);
    const firstApplied = await applyAiMediaListingDraftApplication(client!, {
      workflowId: first.workflow.id, ownerUserId: data.ownerUserId, actorUserId: data.ownerUserId,
      mode: 'append', operationKey: `h3b-apply-first-${data.draft.id}`,
      expectedWorkflowRevision: first.workflow.revision,
      expectedTargetRevision: 1, expectedTargetDraftVersion: 1,
    });
    expect(firstApplied.replayed).toBe(false);
    const afterFirst = await client!.sourceListingWorkflow.findUniqueOrThrow({
      where: { id: data.draft.id }, select: { currentRevision: true, currentDraftVersion: true },
    });
    expect(afterFirst).toMatchObject({ currentRevision: 2, currentDraftVersion: 2 });

    const second = await reviewedWorkflow(client!, data, 'second', data.sourceB, 'slot-b', 2, 2);
    const secondApplied = await applyAiMediaListingDraftApplication(client!, {
      workflowId: second.workflow.id, ownerUserId: data.ownerUserId, actorUserId: data.ownerUserId,
      mode: 'append', operationKey: `h3b-apply-second-${data.draft.id}`,
      expectedWorkflowRevision: second.workflow.revision,
      expectedTargetRevision: 2, expectedTargetDraftVersion: 2,
    });
    expect(secondApplied.target).toMatchObject({ revision: 3, draftVersion: 3 });

    const secondAfter = await client!.aiMediaWorkflow.findUniqueOrThrow({ where: { id: second.workflow.id }, select: { revision: true } });
    const rollbackSecondInput = {
      applicationId: secondApplied.application.id, ownerUserId: data.ownerUserId, actorUserId: data.ownerUserId,
      operationKey: `h3b-rollback-second-${data.draft.id}`, expectedApplicationRevision: 1,
      expectedWorkflowRevision: secondAfter.revision, expectedTargetRevision: 3, expectedTargetDraftVersion: 3,
    };
    const rollbackSecond = await rollbackAiMediaListingDraftApplication(client!, rollbackSecondInput);
    expect(rollbackSecond.target).toMatchObject({ revision: 4, draftVersion: 4 });

    const firstAfter = await client!.aiMediaWorkflow.findUniqueOrThrow({ where: { id: first.workflow.id }, select: { revision: true } });
    const rollbackFirst = await rollbackAiMediaListingDraftApplication(client!, {
      applicationId: firstApplied.application.id, ownerUserId: data.ownerUserId, actorUserId: data.ownerUserId,
      operationKey: `h3b-rollback-first-${data.draft.id}`, expectedApplicationRevision: 1,
      expectedWorkflowRevision: firstAfter.revision, expectedTargetRevision: 4, expectedTargetDraftVersion: 4,
    });
    expect(rollbackFirst.target).toMatchObject({ revision: 5, draftVersion: 5 });

    const firstAfterRollback = await client!.aiMediaWorkflow.findUniqueOrThrow({
      where: { id: first.workflow.id }, select: { revision: true },
    });
    await expect(applyAiMediaListingDraftApplication(client!, {
      workflowId: first.workflow.id,
      ownerUserId: data.ownerUserId,
      actorUserId: data.ownerUserId,
      mode: 'append',
      operationKey: `h3b-reapply-first-${data.draft.id}`,
      expectedWorkflowRevision: firstAfterRollback.revision,
      expectedTargetRevision: 5,
      expectedTargetDraftVersion: 5,
    })).rejects.toMatchObject({ code: 'APPLICATION_CONFLICT' });
    const afterRejectedReapply = await client!.sourceListingWorkflow.findUniqueOrThrow({
      where: { id: data.draft.id }, select: { currentRevision: true, currentDraftVersion: true },
    });
    expect(afterRejectedReapply).toMatchObject({ currentRevision: 5, currentDraftVersion: 5 });

    const history = await listAiMediaListingDraftApplications(client!, {
      targetId: data.draft.id, ownerUserId: data.ownerUserId, limit: 10,
    });
    expect(history.items.map((item: any) => item.targetSequence)).toEqual([4, 3, 2, 1]);
    expect(history.frontier).toBeNull();
    expect(await client!.aiMediaListingDraftApplicationMutation.count({ where: { ownerUserId: data.ownerUserId } })).toBe(4);
    await expect(client!.aiMediaListingDraftApplicationMutation.update({
      where: { id: firstApplied.application.id }, data: { operationKey: 'tampered-h3b' },
    })).rejects.toThrow(/listing-draft application mutations are immutable/i);
  });

  it('requires explicit replace confirmation and blocks wrong-owner history', async () => {
    const data = await fixture(client!, randomUUID().replaceAll('-', '').slice(0, 10));
    const first = await reviewedWorkflow(client!, data, 'replace', data.sourceA, 'slot-replace', 1, 1);
    await expect(applyAiMediaListingDraftApplication(client!, {
      workflowId: first.workflow.id, ownerUserId: data.ownerUserId, actorUserId: data.ownerUserId,
      mode: 'replace', operationKey: `h3b-replace-no-confirm-${data.draft.id}`,
      expectedWorkflowRevision: first.workflow.revision, expectedTargetRevision: 1, expectedTargetDraftVersion: 1,
    })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(listAiMediaListingDraftApplications(client!, {
      targetId: data.draft.id, ownerUserId: `other-${data.ownerUserId}`,
    })).rejects.toMatchObject({ code: 'TARGET_NOT_FOUND' });
  });

  it('rejects forged owner, actor, snapshot, operation and frozen-slot authority rows', async () => {
    const data = await fixture(client!, randomUUID().replaceAll('-', '').slice(0, 10));
    const other = await fixture(client!, randomUUID().replaceAll('-', '').slice(0, 10));
    const reviewed = await reviewedWorkflow(client!, data, 'tamper', data.sourceA, 'slot-tamper', 1, 1);
    const applied = await applyAiMediaListingDraftApplication(client!, {
      workflowId: reviewed.workflow.id,
      ownerUserId: data.ownerUserId,
      actorUserId: data.ownerUserId,
      mode: 'append',
      operationKey: `h3b-tamper-base-${data.draft.id}`,
      expectedWorkflowRevision: reviewed.workflow.revision,
      expectedTargetRevision: 1,
      expectedTargetDraftVersion: 1,
    });
    const base = await client!.aiMediaListingDraftApplicationMutation.findUniqueOrThrow({
      where: { id: applied.application.id },
    });
    const currentWorkflow = await client!.aiMediaWorkflow.findUniqueOrThrow({
      where: { id: reviewed.workflow.id },
      select: { revision: true },
    });
    let cloneSequence = 0;
    const clone = (overrides: Record<string, unknown>) => {
      cloneSequence += 1;
      const payload = {
        id: `h3b-tamper-${data.draft.id}-${cloneSequence}`,
        operation_key: `h3b-tamper-operation-${data.draft.id}-${cloneSequence}`,
        request_fingerprint: `${cloneSequence}`.padStart(64, '0'),
        ...overrides,
      };
      return client!.$executeRawUnsafe(`
        INSERT INTO "ai_media_listing_draft_application_mutations"
        SELECT (jsonb_populate_record(
          NULL::"ai_media_listing_draft_application_mutations",
          to_jsonb(base) || $2::jsonb
        )).*
        FROM "ai_media_listing_draft_application_mutations" base
        WHERE base."id" = $1
      `, base.id, JSON.stringify(payload));
    };

    await expect(clone({
      owner_user_id: other.ownerUserId,
      actor_user_id: other.ownerUserId,
    })).rejects.toThrow(/authority graph is missing/i);
    await expect(clone({ actor_user_id: other.ownerUserId }))
      .rejects.toThrow(/actor does not belong to owner/i);
    await expect(clone({ source_capture_snapshot_id: other.snapshotId }))
      .rejects.toThrow(/assignment asset authority is invalid/i);
    await expect(clone({ operation: 'IMAGE_TRANSLATE' }))
      .rejects.toThrow(/operation is not frozen/i);
    await expect(clone({
      after_state_json: {
        ...(base.afterState as Record<string, unknown>),
        assignment: {
          ...((base.afterState as Record<string, any>).assignment),
          source: 'EDITED',
        },
      },
    })).rejects.toThrow(/output source is invalid/i);
    await expect(clone({ context_slot_key: 'slot-tampered' }))
      .rejects.toThrow(/target does not match frozen workflow context/i);
    await expect(clone({
      workflow_revision_before: currentWorkflow.revision,
      workflow_revision_after: currentWorkflow.revision + 1,
      after_state_json: {
        ...(base.afterState as Record<string, unknown>),
        assignment: {
          ...((base.afterState as Record<string, any>).assignment),
          skuKey: 'sku-other',
        },
      },
    })).rejects.toThrow(/assignment projection does not match draft payload/i);

    expect(await client!.aiMediaListingDraftApplicationMutation.count({
      where: { ownerUserId: data.ownerUserId },
    })).toBe(1);
  });

  it('serializes one owner operation key across collect and listing-draft ledgers', async () => {
    const data = await fixture(client!, randomUUID().replaceAll('-', '').slice(0, 10));
    const listing = await reviewedWorkflow(
      client!, data, 'cross-ledger-listing', data.sourceA, 'slot-cross-ledger', 1, 1,
    );
    const collect = await reviewedCollectWorkflow(client!, data, 'cross-ledger-collect');
    const collectTarget = await client!.supplyGoods.findUniqueOrThrow({
      where: { id: data.goodsId }, select: { updatedAt: true },
    });
    const operationKey = `h3b-cross-ledger-${data.draft.id}`;

    const connectionUrl = (label: string) => {
      const url = new URL(databaseUrl);
      url.searchParams.set('connection_limit', '1');
      url.searchParams.set('application_name', `h3b_${label}_${data.draft.id}`.slice(0, 63));
      return url.toString();
    };
    const gateClient = new PrismaClient({ datasources: { db: { url: connectionUrl('gate') } } });
    const listingClient = new PrismaClient({ datasources: { db: { url: connectionUrl('listing') } } });
    const collectClient = new PrismaClient({ datasources: { db: { url: connectionUrl('collect') } } });
    await Promise.all([gateClient.$connect(), listingClient.$connect(), collectClient.$connect()]);
    let releaseGate = () => {};
    let signalGateReady = () => {};
    const gateReady = new Promise<void>((resolve) => { signalGateReady = resolve; });
    const gateRelease = new Promise<void>((resolve) => { releaseGate = resolve; });
    let pendingResults: Promise<PromiseSettledResult<unknown>[]> | null = null;
    const gateTransaction = gateClient.$transaction(async (tx) => {
      await lockAiMediaApplicationOperation(tx, data.ownerUserId, operationKey);
      signalGateReady();
      await gateRelease;
    }, { timeout: 15_000 });
    let results: PromiseSettledResult<unknown>[];
    try {
      await gateReady;
      const [[listingBackend], [collectBackend]] = await Promise.all([
        listingClient.$queryRawUnsafe<Array<{ pid: number }>>('SELECT pg_backend_pid()::int AS pid'),
        collectClient.$queryRawUnsafe<Array<{ pid: number }>>('SELECT pg_backend_pid()::int AS pid'),
      ]);
      if (!listingBackend || !collectBackend) {
        throw new Error('Dedicated PostgreSQL concurrency connections were not established');
      }
      pendingResults = Promise.allSettled([
        applyAiMediaListingDraftApplication(listingClient, {
          workflowId: listing.workflow.id,
          ownerUserId: data.ownerUserId,
          actorUserId: data.ownerUserId,
          mode: 'append',
          operationKey,
          expectedWorkflowRevision: listing.workflow.revision,
          expectedTargetRevision: 1,
          expectedTargetDraftVersion: 1,
        }),
        applyAiMediaWorkflowApplication(collectClient, {
          workflowId: collect.workflow.id,
          ownerUserId: data.ownerUserId,
          actorUserId: data.ownerUserId,
          mode: 'append',
          operationKey,
          expectedWorkflowRevision: collect.workflow.revision,
          expectedTargetUpdatedAt: collectTarget.updatedAt.toISOString(),
        }),
      ]);
      let waitingCount = 0;
      for (let attempt = 0; attempt < 100 && waitingCount !== 2; attempt += 1) {
        const rows = await client!.$queryRawUnsafe<Array<{ count: number }>>(
          `SELECT count(*)::int AS count
             FROM pg_locks
            WHERE locktype = 'advisory' AND granted = FALSE AND pid IN ($1, $2)`,
          listingBackend.pid,
          collectBackend.pid,
        );
        waitingCount = Number(rows[0]?.count || 0);
        if (waitingCount !== 2) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waitingCount).toBe(2);
      releaseGate();
      await gateTransaction;
      results = await pendingResults;
    } finally {
      releaseGate();
      await gateTransaction.catch(() => undefined);
      await pendingResults?.catch(() => undefined);
      await Promise.all([
        gateClient.$disconnect(), listingClient.$disconnect(), collectClient.$disconnect(),
      ]);
    }

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: { code: 'IDEMPOTENCY_KEY_CONFLICT' },
    });
    const [collectCount, listingCount] = await Promise.all([
      client!.aiMediaApplicationMutation.count({ where: { ownerUserId: data.ownerUserId, operationKey } }),
      client!.aiMediaListingDraftApplicationMutation.count({ where: { ownerUserId: data.ownerUserId, operationKey } }),
    ]);
    expect(collectCount + listingCount).toBe(1);
  });
});
