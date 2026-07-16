import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaAiImageJobRepository } from '../repositories/ai-image-job-repository.js';
import { PrismaAiMediaWorkflowRepository } from '../repositories/ai-media-workflow-repository.js';
import { applyAiImageAssets } from '../services/ai-image-application.js';
import { createFakeAiImageProvider, runAiImageJob } from '../services/ai-image-jobs.js';
import { createAiMediaWorkflowService } from '../services/ai-media-workflows.js';

const databaseUrl = process.env.AI_MEDIA_TEST_DATABASE_URL || '';
const enabled = process.env.RUN_AI_MEDIA_POSTGRES_TESTS === '1' && Boolean(databaseUrl);
const describePostgres = enabled ? describe : describe.skip;
const client = enabled ? new PrismaClient({ datasources: { db: { url: databaseUrl } } }) : null;

function assertIsolatedSchema() {
  const schema = databaseUrl ? new URL(databaseUrl).searchParams.get('schema') || '' : '';
  if (!/^ai_media_test_[a-z0-9_]+$/u.test(schema)) {
    throw new Error('AI_MEDIA_TEST_DATABASE_URL must target an isolated ai_media_test_* schema');
  }
}

describePostgres('AI media workflow PostgreSQL graph', () => {
  beforeAll(async () => {
    assertIsolatedSchema();
    await client!.$connect();
  });
  afterAll(async () => client!.$disconnect());

  it('persists lineage/review and fences cancellation against late completion', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const ownerUserId = `ai_owner_${suffix}`;
    const goodsId = `ai_goods_${suffix}`;
    const subjectId = `ai_subject_${suffix}`;
    const snapshotId = `ai_snapshot_${suffix}`;
    const sourceAssetId = `ai_asset_${suffix}`;
    await client!.user.create({ data: {
      id: ownerUserId, phone: `ai_${suffix}`, passwordHash: 'integration-test',
    } });
    await client!.supplyGoods.create({ data: {
      id: goodsId, userId: ownerUserId, title: 'AI media integration fixture',
      sourcePlatform: '1688', sourceProductId: `product_${suffix}`,
    } });
    await client!.sourceCaptureSubject.create({ data: {
      id: subjectId, ownerUserId, sourcePlatform: '1688', sourceProductId: `product_${suffix}`,
      legacySupplyGoodsId: goodsId,
    } });
    await client!.sourceCaptureSnapshot.create({ data: {
      id: snapshotId, subjectId, version: 1, schemaVersion: 'source-product-capture-v2',
      captureHash: 'b'.repeat(64), payloadBytes: 2, payload: {}, stageCounts: {}, provenance: {},
      provenanceComplete: true, parserVersion: 'integration', completeness: {}, truncations: [],
      hasEstimatedValues: false, profile: {}, profileHash: 'c'.repeat(64), actorUserId: ownerUserId,
      ingestChannel: 'WEB_ACCOUNT', rolloutRevision: 'integration', rolloutStage: 'v2_only',
      capturedAt: new Date(),
    } });
    await client!.mediaAsset.create({ data: {
      id: sourceAssetId, ownerUserId, kind: 'SOURCE_ORIGINAL', sourceCaptureSnapshotId: snapshotId,
      sourceMediaKey: 'main-1', sourceUrl: 'https://source.example/main.png',
      url: '/uploads/source.png', storageBackend: 'local', storageKey: 'source.png',
      mimeType: 'image/png', sizeBytes: 68, sha256: 'd'.repeat(64),
    } });

    const workflowRepository = new PrismaAiMediaWorkflowRepository(client!);
    const workflowService = createAiMediaWorkflowService(workflowRepository);
    const jobRepository = new PrismaAiImageJobRepository(client!);
    const created = await workflowService.createImageToImage({
      ownerUserId, actorUserId: ownerUserId, sourceAssetId, prompt: 'Keep product unchanged',
      negativePrompt: null, count: 1, width: 1024, height: 1024,
      idempotencyKey: `create-${suffix}`, context: { type: 'collect', id: goodsId },
    });
    await expect(client!.aiMediaWorkflow.update({
      where: { id: created.workflow.id }, data: { contextSlotKey: 'tampered-slot' },
    })).rejects.toThrow(/workflow identity is immutable/i);
    await expect(client!.aiImageJob.update({
      where: { id: created.jobId }, data: { prompt: 'Tampered frozen request' },
    })).rejects.toThrow(/workflow child request is immutable/i);
    const legacyJob = await client!.aiImageJob.create({ data: {
      ownerUserId,
      actorUserId: ownerUserId,
      status: 'QUEUED',
      provider: 'fake',
      model: 'legacy-text-to-image',
      prompt: 'Legacy request must not be attached later',
      width: 1024,
      height: 1024,
      idempotencyKey: `legacy-${suffix}`,
    } });
    await expect(client!.aiImageJob.update({
      where: { id: legacyJob.id },
      data: {
        operation: 'IMAGE_TO_IMAGE',
        workflowId: created.workflow.id,
        workflowAttempt: 2,
      },
    })).rejects.toThrow(/workflow child binding is insert-time immutable/i);
    await expect(client!.aiMediaWorkflowInput.create({ data: {
      workflowId: created.workflow.id,
      ownerUserId,
      assetId: sourceAssetId,
      role: 'MASK',
      ordinal: 0,
      assetSha256: 'e'.repeat(64),
      assetUrl: '/uploads/source.png',
      mimeType: 'image/png',
    } })).rejects.toThrow(/input snapshot does not match locked asset/i);
    await runAiImageJob(created.jobId, 1, {
      repository: jobRepository,
      provider: createFakeAiImageProvider({ images: [{ buffer: Buffer.from('generated'), mimeType: 'image/png' }] }),
      uploadBuffer: async () => ({ url: '/uploads/generated.png', backend: 'local', key: 'generated.png' }),
      maxAttempts: 1,
    });
    const succeeded = await workflowService.get(created.workflow.id, ownerUserId);
    expect(succeeded).toMatchObject({ status: 'SUCCEEDED', reviewStatus: 'PENDING' });
    const output = (succeeded.jobs?.[0] as any)?.assets?.[0];
    expect(output?.id).toBeTruthy();
    expect(await client!.mediaAssetLineage.count({ where: {
      workflowId: succeeded.id, inputAssetId: sourceAssetId, outputAssetId: output.id,
    } })).toBe(1);
    await workflowService.review({
      id: succeeded.id, ownerUserId, actorUserId: ownerUserId,
      expectedRevision: succeeded.revision, outputAssetId: output.id, decision: 'APPROVE', note: null,
    });
    const targetBeforeApply = await client!.supplyGoods.findUniqueOrThrow({ where: { id: goodsId } });
    const applications = await Promise.allSettled([
      applyAiImageAssets(client! as any, {
        jobId: created.jobId, ownerUserId, actorUserId: ownerUserId,
        mode: 'append', targetType: 'collect', targetId: goodsId, selectedAssetId: output.id,
        expectedTargetUpdatedAt: targetBeforeApply.updatedAt.toISOString(),
      }),
      applyAiImageAssets(client! as any, {
        jobId: created.jobId, ownerUserId, actorUserId: ownerUserId,
        mode: 'append', targetType: 'collect', targetId: goodsId, selectedAssetId: output.id,
        expectedTargetUpdatedAt: targetBeforeApply.updatedAt.toISOString(),
      }),
    ]);
    expect(applications.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejectedApplication = applications.find((result) => result.status === 'rejected');
    expect(rejectedApplication).toMatchObject({ status: 'rejected', reason: { code: 'ALREADY_APPLIED' } });
    const appliedGoods = await client!.supplyGoods.findUnique({ where: { id: goodsId } });
    expect(appliedGoods?.images).toContain('/uploads/generated.png');
    expect((appliedGoods?.metadata as any)?.watermarkedImages).toContain('/uploads/generated.png');
    expect(await client!.aiMediaWorkflowEvent.count({ where: {
      workflowId: succeeded.id, eventType: 'APPLIED', actorUserId: ownerUserId, assetId: output.id,
    } })).toBe(1);
    await expect(client!.mediaAsset.update({
      where: { id: sourceAssetId }, data: { sha256: 'e'.repeat(64) },
    })).rejects.toThrow();
    await expect(client!.mediaAsset.update({
      where: { id: sourceAssetId }, data: { sourceUrl: 'https://source.example/tampered.png' },
    })).rejects.toThrow(/referenced media asset identity is immutable/i);
    await expect(client!.mediaAsset.update({
      where: { id: output.id }, data: { aiImageJobId: null },
    })).rejects.toThrow(/media asset job binding is insert-time immutable/i);
    const unreferencedAsset = await client!.mediaAsset.create({ data: {
      ownerUserId, kind: 'AI_GENERATED', url: '/uploads/unreferenced.png',
      storageBackend: 'local', storageKey: 'unreferenced.png', mimeType: 'image/png',
      sizeBytes: 68, sha256: 'f'.repeat(64),
    } });
    await expect(client!.mediaAsset.update({
      where: { id: unreferencedAsset.id }, data: { aiImageJobId: created.jobId },
    })).rejects.toThrow(/media asset job binding is insert-time immutable/i);

    const cancelling = await workflowService.createImageToImage({
      ownerUserId, actorUserId: ownerUserId, sourceAssetId, prompt: 'Cancellation race',
      negativePrompt: null, count: 1, width: 1024, height: 1024,
      idempotencyKey: `cancel-${suffix}`, context: { type: 'collect', id: goodsId },
    });
    await jobRepository.markRunning(cancelling.jobId, 1);
    await jobRepository.recordProviderJobId(cancelling.jobId, `provider-task-${suffix}`);
    await expect(client!.aiImageJob.update({
      where: { id: cancelling.jobId }, data: { providerJobId: null },
    })).rejects.toThrow(/provider job identity cannot be cleared or replaced/i);
    await expect(client!.aiImageJob.update({
      where: { id: cancelling.jobId }, data: { providerJobId: `replacement-task-${suffix}` },
    })).rejects.toThrow(/provider job identity cannot be cleared or replaced/i);
    const running = await workflowService.get(cancelling.workflow.id, ownerUserId);
    await workflowService.cancel(running.id, ownerUserId, ownerUserId, running.revision);
    await jobRepository.complete(cancelling.jobId, {
      providerJobId: null, actualCostCents: 0, billedUnits: 1,
      assets: [{
        ownerUserId, jobId: cancelling.jobId, url: '/uploads/late.png', storageBackend: 'local',
        storageKey: 'late.png', mimeType: 'image/png', sizeBytes: 4, sha256: 'f'.repeat(64),
      }],
    });
    const cancelled = await workflowService.get(running.id, ownerUserId);
    expect(cancelled.status).toBe('CANCELLED');
    expect(await client!.mediaAsset.count({ where: { aiImageJobId: cancelling.jobId } })).toBe(0);

    const retrying = await workflowService.createImageToImage({
      ownerUserId, actorUserId: ownerUserId, sourceAssetId, prompt: 'Retry idempotency race',
      negativePrompt: null, count: 1, width: 1024, height: 1024,
      idempotencyKey: `retry-create-${suffix}`, context: { type: 'collect', id: goodsId },
    });
    await jobRepository.markFailed(retrying.jobId, {
      attemptCount: 0, errorCode: 'QUEUE_UNAVAILABLE', errorMessage: 'integration retry fixture',
    });
    const failed = await workflowService.get(retrying.workflow.id, ownerUserId);
    const retryInput = {
      id: failed.id, ownerUserId, actorUserId: ownerUserId,
      expectedRevision: failed.revision, idempotencyKey: `retry-race-${suffix}`,
    };
    const retries = await Promise.all([
      workflowService.retry(retryInput),
      workflowService.retry(retryInput),
    ]);
    expect(new Set(retries.map((result) => result.jobId)).size).toBe(1);
    expect(retries.some((result) => result.replayed)).toBe(true);

    const competing = await workflowService.createImageToImage({
      ownerUserId, actorUserId: ownerUserId, sourceAssetId, prompt: 'Competing retry keys',
      negativePrompt: null, count: 1, width: 1024, height: 1024,
      idempotencyKey: `competing-create-${suffix}`, context: { type: 'collect', id: goodsId },
    });
    await jobRepository.markFailed(competing.jobId, {
      attemptCount: 0, errorCode: 'QUEUE_UNAVAILABLE', errorMessage: 'competing retry fixture',
    });
    const competingFailed = await workflowService.get(competing.workflow.id, ownerUserId);
    const competingRetries = await Promise.allSettled([
      workflowService.retry({
        id: competingFailed.id, ownerUserId, actorUserId: ownerUserId,
        expectedRevision: competingFailed.revision, idempotencyKey: `competing-a-${suffix}`,
      }),
      workflowService.retry({
        id: competingFailed.id, ownerUserId, actorUserId: ownerUserId,
        expectedRevision: competingFailed.revision, idempotencyKey: `competing-b-${suffix}`,
      }),
    ]);
    expect(competingRetries.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(competingRetries.find((result) => result.status === 'rejected')).toMatchObject({
      status: 'rejected', reason: { code: 'RECOVERY_REQUIRED' },
    });
  });
});
