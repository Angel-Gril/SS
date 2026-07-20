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

  it('walks owner/context history without duplicates across an equal-timestamp boundary', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const ownerUserId = `history_owner_${suffix}`;
    const otherOwnerUserId = `history_other_${suffix}`;
    const createdAt = new Date('2026-07-20T12:00:00.000Z');
    await client!.user.createMany({ data: [
      { id: ownerUserId, phone: `history_${suffix}`, passwordHash: 'integration-test' },
      { id: otherOwnerUserId, phone: `history_other_${suffix}`, passwordHash: 'integration-test' },
    ] });
    await client!.aiMediaWorkflow.createMany({ data: [
      {
        id: `history_${suffix}_c`, ownerUserId, operation: 'IMAGE_TO_IMAGE',
        contextType: 'collect', contextId: `goods_${suffix}`,
        requestFingerprint: '1'.repeat(64), createdAt,
      },
      {
        id: `history_${suffix}_b`, ownerUserId, operation: 'IMAGE_TO_IMAGE',
        contextType: 'collect', contextId: `goods_${suffix}`,
        requestFingerprint: '2'.repeat(64), createdAt,
      },
      {
        id: `history_${suffix}_a`, ownerUserId, operation: 'IMAGE_TO_IMAGE',
        contextType: 'collect', contextId: `goods_${suffix}`,
        requestFingerprint: '3'.repeat(64), createdAt,
      },
      {
        id: `history_${suffix}_other_context`, ownerUserId, operation: 'IMAGE_TO_IMAGE',
        contextType: 'collect', contextId: `other_goods_${suffix}`,
        requestFingerprint: '4'.repeat(64), createdAt,
      },
      {
        id: `history_${suffix}_other_owner`, ownerUserId: otherOwnerUserId,
        operation: 'IMAGE_TO_IMAGE', contextType: 'collect', contextId: `goods_${suffix}`,
        requestFingerprint: '5'.repeat(64), createdAt,
      },
    ] });

    const repository = new PrismaAiMediaWorkflowRepository(client!);
    const first = await repository.listOwned({
      ownerUserId, contextType: 'collect', contextId: `goods_${suffix}`, limit: 2,
      includePriority: true,
    });
    expect(first.items.map((workflow: { id: string }) => workflow.id)).toEqual([
      `history_${suffix}_c`, `history_${suffix}_b`,
    ]);
    expect(first.nextCursor).toEqual({ createdAt, id: `history_${suffix}_b` });
    expect(first.priorityItems?.map((workflow: { id: string }) => workflow.id)).toEqual([
      `history_${suffix}_c`, `history_${suffix}_b`, `history_${suffix}_a`,
    ]);

    const second = await repository.listOwned({
      ownerUserId, contextType: 'collect', contextId: `goods_${suffix}`, limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.items.map((workflow: { id: string }) => workflow.id)).toEqual([`history_${suffix}_a`]);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((workflow: { id: string }) => workflow.id)).size).toBe(3);
  });

  it('walks more than 100 equal-updated priority rows without owner/context leakage or duplicates', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const ownerUserId = `priority_owner_${suffix}`;
    const otherOwnerUserId = `priority_other_${suffix}`;
    const contextId = `priority_goods_${suffix}`;
    const otherContextId = `priority_other_goods_${suffix}`;
    const updatedAt = new Date('2026-07-20T12:30:00.000Z');
    const ids = Array.from(
      { length: 103 },
      (_, index) => `priority_${suffix}_${String(index).padStart(3, '0')}`,
    );
    await client!.user.createMany({ data: [
      { id: ownerUserId, phone: `priority_${suffix}`, passwordHash: 'integration-test' },
      { id: otherOwnerUserId, phone: `priority_other_${suffix}`, passwordHash: 'integration-test' },
    ] });
    await client!.aiMediaWorkflow.createMany({ data: [
      ...ids.map((id, index) => ({
        id,
        ownerUserId,
        operation: 'IMAGE_TO_IMAGE' as const,
        contextType: 'collect',
        contextId,
        requestFingerprint: String(index % 10).repeat(64),
        createdAt: updatedAt,
        updatedAt,
      })),
      {
        id: `priority_${suffix}_other_context`, ownerUserId,
        operation: 'IMAGE_TO_IMAGE' as const, contextType: 'collect', contextId: otherContextId,
        requestFingerprint: 'a'.repeat(64), createdAt: updatedAt, updatedAt,
      },
      {
        id: `priority_${suffix}_other_owner`, ownerUserId: otherOwnerUserId,
        operation: 'IMAGE_TO_IMAGE' as const, contextType: 'collect', contextId,
        requestFingerprint: 'b'.repeat(64), createdAt: updatedAt, updatedAt,
      },
    ] });

    const service = createAiMediaWorkflowService(new PrismaAiMediaWorkflowRepository(client!));
    const first = await service.listPriority({
      ownerUserId, contextType: 'collect', contextId, limit: 100,
    });
    expect(first.items).toHaveLength(100);
    expect(first.nextCursor).toEqual(expect.any(String));

    const second = await service.listPriority({
      ownerUserId, contextType: 'collect', contextId, limit: 100, cursor: first.nextCursor!,
    });
    expect(second.items).toHaveLength(3);
    expect(second.nextCursor).toBeNull();
    const returnedIds = [...first.items, ...second.items].map((workflow) => workflow.id);
    expect(new Set(returnedIds).size).toBe(103);
    expect(new Set(returnedIds)).toEqual(new Set(ids));

    await expect(service.listPriority({
      ownerUserId: otherOwnerUserId, contextType: 'collect', contextId, cursor: first.nextCursor!,
    })).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    await expect(service.listPriority({
      ownerUserId, contextType: 'collect', contextId: otherContextId, cursor: first.nextCursor!,
    })).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
  });

  it('selects every actionable and recent priority state while excluding applied and cold terminal rows', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const ownerUserId = `priority_matrix_owner_${suffix}`;
    const contextId = `priority_matrix_goods_${suffix}`;
    const recentAt = new Date(Date.now() - 60 * 60 * 1_000);
    const oldAt = new Date(Date.now() - 48 * 60 * 60 * 1_000);
    const workflowId = (label: string) => `priority_matrix_${suffix}_${label}`;
    await client!.user.create({ data: {
      id: ownerUserId, phone: `priority_matrix_${suffix}`, passwordHash: 'integration-test',
    } });
    await client!.aiMediaWorkflow.createMany({ data: [
      {
        id: workflowId('running'), ownerUserId, operation: 'IMAGE_TO_IMAGE', status: 'RUNNING',
        contextType: 'collect', contextId, requestFingerprint: '1'.repeat(64),
        createdAt: oldAt, updatedAt: oldAt,
      },
      {
        id: workflowId('cancel_requested'), ownerUserId, operation: 'IMAGE_TO_IMAGE',
        status: 'CANCEL_REQUESTED', contextType: 'collect', contextId,
        requestFingerprint: '2'.repeat(64), cancelRequestedAt: oldAt,
        createdAt: oldAt, updatedAt: oldAt,
      },
      {
        id: workflowId('pending_review'), ownerUserId, operation: 'IMAGE_TO_IMAGE',
        status: 'SUCCEEDED', reviewStatus: 'PENDING', contextType: 'collect', contextId,
        requestFingerprint: '3'.repeat(64), completedAt: oldAt,
        createdAt: oldAt, updatedAt: oldAt,
      },
      {
        id: workflowId('approved_unapplied'), ownerUserId, operation: 'IMAGE_TO_IMAGE',
        status: 'SUCCEEDED', reviewStatus: 'PENDING', contextType: 'collect', contextId,
        requestFingerprint: '4'.repeat(64), completedAt: oldAt,
        createdAt: oldAt, updatedAt: oldAt,
      },
      {
        id: workflowId('approved_applied'), ownerUserId, operation: 'IMAGE_TO_IMAGE',
        status: 'SUCCEEDED', reviewStatus: 'PENDING', contextType: 'collect', contextId,
        requestFingerprint: '5'.repeat(64), completedAt: oldAt,
        createdAt: oldAt, updatedAt: oldAt,
      },
      {
        id: workflowId('recent_failed'), ownerUserId, operation: 'IMAGE_TO_IMAGE', status: 'FAILED',
        contextType: 'collect', contextId, requestFingerprint: '6'.repeat(64), completedAt: recentAt,
        createdAt: recentAt, updatedAt: recentAt,
      },
      {
        id: workflowId('cold_failed'), ownerUserId, operation: 'IMAGE_TO_IMAGE', status: 'FAILED',
        contextType: 'collect', contextId, requestFingerprint: '7'.repeat(64), completedAt: oldAt,
        createdAt: oldAt, updatedAt: oldAt,
      },
    ] });

    for (const applied of [false, true]) {
      const label = applied ? 'approved_applied' : 'approved_unapplied';
      const jobId = `priority_matrix_job_${suffix}_${label}`;
      const assetId = `priority_matrix_asset_${suffix}_${label}`;
      await client!.aiImageJob.create({ data: {
        id: jobId, ownerUserId, status: 'SUCCEEDED', operation: 'IMAGE_TO_IMAGE',
        workflowId: workflowId(label), workflowAttempt: 1,
        provider: 'fake', model: 'priority-matrix', prompt: 'priority matrix',
        width: 1024, height: 1024, progress: 100, completedAt: oldAt,
        ...(applied ? {
          appliedMode: 'append', applyTargetType: 'collect', applyTargetId: contextId, appliedAt: oldAt,
        } : {}),
        createdAt: oldAt, updatedAt: oldAt,
      } });
      await client!.mediaAsset.create({ data: {
        id: assetId, ownerUserId, aiImageJobId: jobId, kind: 'AI_GENERATED',
        url: `/priority/${assetId}.png`, storageBackend: 'local', storageKey: `${assetId}.png`,
        mimeType: 'image/png', sizeBytes: 68, sha256: (applied ? '9' : '8').repeat(64),
        createdAt: oldAt,
      } });
      await client!.aiMediaWorkflow.update({
        where: { id: workflowId(label) },
        data: {
          reviewStatus: 'APPROVED', selectedOutputAssetId: assetId,
          reviewedByUserId: ownerUserId, reviewedAt: oldAt, updatedAt: oldAt,
        },
      });
    }

    const page = await new PrismaAiMediaWorkflowRepository(client!).listPriorityOwned({
      ownerUserId, contextType: 'collect', contextId, limit: 100,
    });
    const returnedIds = new Set(page.items.map((workflow: { id: string }) => workflow.id));
    expect(returnedIds).toEqual(new Set([
      workflowId('running'),
      workflowId('cancel_requested'),
      workflowId('pending_review'),
      workflowId('approved_unapplied'),
      workflowId('recent_failed'),
    ]));
    expect(returnedIds.has(workflowId('approved_applied'))).toBe(false);
    expect(returnedIds.has(workflowId('cold_failed'))).toBe(false);
  });

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
    expect(await client!.aiCostReservation.findUnique({ where: { jobId: created.jobId } }))
      .toMatchObject({ status: 'RESERVED', estimatedCostMinor: 0, maximumCostMinor: 0 });
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
    const settledCost = await client!.aiCostReservation.findUniqueOrThrow({
      where: { jobId: created.jobId }, include: { settlements: true },
    });
    expect(settledCost).toMatchObject({ status: 'SETTLED' });
    expect(settledCost.settlements).toEqual([expect.objectContaining({
      kind: 'CHARGE', actualCostMinor: 0, billedUnits: 1,
    })]);
    const output = (succeeded.jobs?.[0] as any)?.assets?.[0];
    expect(output?.id).toBeTruthy();
    expect(output?.sourceCaptureSnapshotId).toBe(snapshotId);
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
    const cancellingCost = await client!.aiCostReservation.findUniqueOrThrow({
      where: { jobId: cancelling.jobId }, include: { settlements: true },
    });
    expect(cancellingCost).toMatchObject({
      status: 'RECONCILIATION_REQUIRED', providerRequestId: `provider-task-${suffix}`,
    });
    expect(cancellingCost.providerAcceptedAt).toBeInstanceOf(Date);
    expect(cancellingCost.settlements).toEqual([expect.objectContaining({
      kind: 'RECONCILIATION_REQUIRED', actualCostMinor: null,
    })]);

    const interrupted = await workflowService.createImageToImage({
      ownerUserId, actorUserId: ownerUserId, sourceAssetId, prompt: 'Interrupted provider recovery',
      negativePrompt: null, count: 1, width: 1024, height: 1024,
      idempotencyKey: `interrupted-${suffix}`, context: { type: 'collect', id: goodsId },
    });
    await jobRepository.markRunning(interrupted.jobId, 1);
    const interruptedProviderJobId = `provider-interrupted-${suffix}`;
    await jobRepository.recordProviderJobId(interrupted.jobId, interruptedProviderJobId);
    const acceptanceEvent = await client!.aiMediaWorkflowEvent.findUniqueOrThrow({
      where: { eventKey: `${interrupted.workflow.id}:PROVIDER_SUBMITTED:${interrupted.jobId}:1` },
    });
    const providerAcceptedAt = new Date(String((acceptanceEvent.payload as any).providerAcceptedAt));
    await jobRepository.markFailed(interrupted.jobId, {
      attemptCount: 2,
      errorCode: 'PROVIDER_RECOVERY_REQUIRED',
      errorMessage: 'worker interrupted after provider acceptance',
      providerJobId: interruptedProviderJobId,
    });
    expect(await client!.aiImageJob.findUnique({ where: { id: interrupted.jobId } }))
      .toMatchObject({ status: 'FAILED', providerJobId: interruptedProviderJobId });
    expect(await workflowService.get(interrupted.workflow.id, ownerUserId))
      .toMatchObject({ status: 'FAILED', reviewStatus: 'NOT_READY' });
    const interruptedCost = await client!.aiCostReservation.findUniqueOrThrow({
      where: { jobId: interrupted.jobId }, include: { settlements: true },
    });
    expect(interruptedCost).toMatchObject({
      status: 'RECONCILIATION_REQUIRED',
      providerRequestId: interruptedProviderJobId,
      providerAcceptedAt,
    });
    expect(interruptedCost.settlements).toEqual([expect.objectContaining({
      kind: 'RECONCILIATION_REQUIRED', idempotencyKey: `${interrupted.jobId}:cost:unknown`,
    })]);

    const missingEvidence = await workflowService.createImageToImage({
      ownerUserId, actorUserId: ownerUserId, sourceAssetId, prompt: 'Missing provider evidence',
      negativePrompt: null, count: 1, width: 1024, height: 1024,
      idempotencyKey: `missing-evidence-${suffix}`, context: { type: 'collect', id: goodsId },
    });
    await jobRepository.markRunning(missingEvidence.jobId, 1);
    await client!.aiImageJob.update({
      where: { id: missingEvidence.jobId },
      data: { providerJobId: `provider-without-event-${suffix}` },
    });
    await expect(jobRepository.markFailed(missingEvidence.jobId, {
      attemptCount: 2,
      errorCode: 'PROVIDER_RECOVERY_REQUIRED',
      errorMessage: 'provider identity has no acceptance event',
    })).rejects.toMatchObject({ code: 'PROVIDER_ACCEPTANCE_EVIDENCE_MISSING' });
    expect(await client!.aiImageJob.findUnique({ where: { id: missingEvidence.jobId } }))
      .toMatchObject({ status: 'RUNNING', providerJobId: `provider-without-event-${suffix}` });
    expect(await client!.aiCostReservation.findUnique({ where: { jobId: missingEvidence.jobId } }))
      .toMatchObject({ status: 'RESERVED' });
    expect(await client!.aiCostSettlement.count({ where: { reservation: { jobId: missingEvidence.jobId } } }))
      .toBe(0);

    const retrying = await workflowService.createImageToImage({
      ownerUserId, actorUserId: ownerUserId, sourceAssetId, prompt: 'Retry idempotency race',
      negativePrompt: null, count: 1, width: 1024, height: 1024,
      idempotencyKey: `retry-create-${suffix}`, context: { type: 'collect', id: goodsId },
    });
    await jobRepository.markFailed(retrying.jobId, {
      attemptCount: 0, errorCode: 'QUEUE_UNAVAILABLE', errorMessage: 'integration retry fixture',
    });
    expect(await client!.aiCostReservation.findUnique({ where: { jobId: retrying.jobId } }))
      .toMatchObject({ status: 'RELEASED' });
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
    expect(await client!.aiCostReservation.count({ where: {
      workflowId: retrying.workflow.id,
    } })).toBe(2);
    expect(await client!.aiCostReservation.findUnique({ where: { jobId: retries[0]!.jobId } }))
      .toMatchObject({ status: 'RESERVED' });

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

    const enqueueRace = await workflowService.createImageToImage({
      ownerUserId, actorUserId: ownerUserId, sourceAssetId, prompt: 'Enqueue acknowledgement race',
      negativePrompt: null, count: 1, width: 1024, height: 1024,
      idempotencyKey: `enqueue-race-${suffix}`, context: { type: 'collect', id: goodsId },
    });
    const enqueueRaceResults = await Promise.all([
      jobRepository.markRunning(enqueueRace.jobId, 1),
      jobRepository.markEnqueueFailed(enqueueRace.jobId, {
        attemptCount: 0,
        errorCode: 'QUEUE_UNAVAILABLE',
        errorMessage: 'queue acknowledgement lost',
      }),
    ]);
    expect(enqueueRaceResults.filter(Boolean)).toHaveLength(1);
    const enqueueRaceJob = await client!.aiImageJob.findUniqueOrThrow({ where: { id: enqueueRace.jobId } });
    const enqueueRaceWorkflow = await workflowService.get(enqueueRace.workflow.id, ownerUserId);
    const enqueueRaceCost = await client!.aiCostReservation.findUniqueOrThrow({
      where: { jobId: enqueueRace.jobId },
    });
    if (enqueueRaceJob.status === 'RUNNING') {
      expect(enqueueRaceWorkflow.status).toBe('RUNNING');
      expect(enqueueRaceCost.status).toBe('RESERVED');
    } else {
      expect(enqueueRaceJob).toMatchObject({ status: 'FAILED', errorCode: 'QUEUE_UNAVAILABLE' });
      expect(enqueueRaceWorkflow.status).toBe('FAILED');
      expect(enqueueRaceCost.status).toBe('RELEASED');
    }

    const completionRace = await workflowService.createImageToImage({
      ownerUserId, actorUserId: ownerUserId, sourceAssetId, prompt: 'Completion cancellation race',
      negativePrompt: null, count: 1, width: 1024, height: 1024,
      idempotencyKey: `completion-race-${suffix}`, context: { type: 'collect', id: goodsId },
    });
    await jobRepository.markRunning(completionRace.jobId, 1);
    const runningCompletionRace = await workflowService.get(completionRace.workflow.id, ownerUserId);
    await Promise.allSettled([
      workflowService.cancel(
        runningCompletionRace.id,
        ownerUserId,
        ownerUserId,
        runningCompletionRace.revision,
      ),
      jobRepository.complete(completionRace.jobId, {
        providerJobId: null,
        actualCostCents: 0,
        billedUnits: 1,
        assets: [{
          ownerUserId,
          jobId: completionRace.jobId,
          url: `/uploads/completion-race-${suffix}.png`,
          storageBackend: 'local',
          storageKey: `completion-race-${suffix}.png`,
          mimeType: 'image/png',
          sizeBytes: 68,
          sha256: 'e'.repeat(64),
        }],
      }),
    ]);
    const completionRaceJob = await client!.aiImageJob.findUniqueOrThrow({
      where: { id: completionRace.jobId },
    });
    const completionRaceWorkflow = await workflowService.get(completionRace.workflow.id, ownerUserId);
    const completionRaceCost = await client!.aiCostReservation.findUniqueOrThrow({
      where: { jobId: completionRace.jobId }, include: { settlements: true },
    });
    const completionRaceAssetCount = await client!.mediaAsset.count({
      where: { aiImageJobId: completionRace.jobId },
    });
    if (completionRaceJob.status === 'SUCCEEDED') {
      expect(completionRaceWorkflow.status).toBe('SUCCEEDED');
      expect(completionRaceCost.status).toBe('SETTLED');
      expect(completionRaceCost.settlements).toEqual([
        expect.objectContaining({ kind: 'CHARGE', billedUnits: 1 }),
      ]);
      expect(completionRaceAssetCount).toBe(1);
    } else {
      expect(completionRaceJob.status).toBe('CANCELLED');
      expect(completionRaceWorkflow.status).toBe('CANCELLED');
      expect(completionRaceCost.status).toBe('RELEASED');
      expect(completionRaceCost.settlements).toEqual([
        expect.objectContaining({ kind: 'RELEASE', billedUnits: 0 }),
      ]);
      expect(completionRaceAssetCount).toBe(0);
    }
  });
});
