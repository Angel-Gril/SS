import { createHash, randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaAiImageJobRepository } from '../repositories/ai-image-job-repository.js';
import { PrismaAiMediaWorkflowRepository } from '../repositories/ai-media-workflow-repository.js';
import {
  applyAiMediaWorkflowApplication,
  listAiMediaWorkflowApplications,
  rollbackAiMediaWorkflowApplication,
} from '../services/ai-media-application-mutations.js';
import { createFakeAiImageProvider, runAiImageJob } from '../services/ai-image-jobs.js';
import { createAiMediaWorkflowService } from '../services/ai-media-workflows.js';

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

describePostgres('AI media application mutation PostgreSQL ledger', () => {
  beforeAll(async () => {
    assertIsolatedSchema();
    await client!.$connect();
  });
  afterAll(async () => client!.$disconnect());

  it('serializes idempotent apply and restores target projections in strict LIFO order', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const ownerUserId = `mutation_owner_${suffix}`;
    const otherOwnerUserId = `mutation_other_${suffix}`;
    const goodsId = `mutation_goods_${suffix}`;
    const subjectId = `mutation_subject_${suffix}`;
    const snapshotId = `mutation_snapshot_${suffix}`;
    const sourceAssetId = `mutation_source_${suffix}`;
    const legacyImages = { primary: 'https://legacy.example/main.png' };
    await client!.user.createMany({ data: [
      { id: ownerUserId, phone: `mutation_${suffix}`, passwordHash: 'integration-test' },
      { id: otherOwnerUserId, phone: `mutation_other_${suffix}`, passwordHash: 'integration-test' },
    ] });
    await client!.supplyGoods.create({ data: {
      id: goodsId,
      userId: ownerUserId,
      title: 'Application mutation integration fixture',
      sourcePlatform: '1688',
      sourceProductId: `product_${suffix}`,
      images: legacyImages,
      metadata: Prisma.JsonNull,
    } });
    await client!.sourceCaptureSubject.create({ data: {
      id: subjectId,
      ownerUserId,
      sourcePlatform: '1688',
      sourceProductId: `product_${suffix}`,
      legacySupplyGoodsId: goodsId,
    } });
    await client!.sourceCaptureSnapshot.create({ data: {
      id: snapshotId,
      subjectId,
      version: 1,
      schemaVersion: 'source-product-capture-v2',
      captureHash: 'a'.repeat(64),
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
      profileHash: 'b'.repeat(64),
      actorUserId: ownerUserId,
      ingestChannel: 'WEB_ACCOUNT',
      rolloutRevision: 'integration',
      rolloutStage: 'v2_only',
      capturedAt: new Date(),
    } });
    await client!.mediaAsset.create({ data: {
      id: sourceAssetId,
      ownerUserId,
      kind: 'SOURCE_ORIGINAL',
      sourceCaptureSnapshotId: snapshotId,
      sourceMediaKey: 'main-1',
      sourceUrl: 'https://source.example/main.png',
      url: '/uploads/source.png',
      storageBackend: 'local',
      storageKey: 'source.png',
      mimeType: 'image/png',
      sizeBytes: SOURCE_PNG_BYTES.length,
      sha256: SOURCE_PNG_SHA256,
    } });

    const workflowService = createAiMediaWorkflowService(
      new PrismaAiMediaWorkflowRepository(client!),
    );
    const jobRepository = new PrismaAiImageJobRepository(client!);
    const createReviewed = async (label: string) => {
      const created = await workflowService.createImageToImage({
        ownerUserId,
        actorUserId: ownerUserId,
        sourceAssetId,
        prompt: `Generate ${label}`,
        negativePrompt: null,
        count: 1,
        width: 1024,
        height: 1024,
        dailyLimit: 0,
        idempotencyKey: `mutation-create-${label}-${suffix}`,
        context: { type: 'collect', id: goodsId },
      });
      await runAiImageJob(created.jobId, 1, {
        repository: jobRepository,
        provider: createFakeAiImageProvider({
          images: [{ buffer: Buffer.from(`generated-${label}`), mimeType: 'image/png' }],
        }),
        uploadBuffer: async () => ({
          url: `/uploads/generated-${label}.png`,
          backend: 'local',
          key: `generated-${label}.png`,
        }),
        loadInputBuffer: async () => SOURCE_PNG_BYTES,
        maxAttempts: 1,
      });
      const succeeded = await workflowService.get(created.workflow.id, ownerUserId);
      const output = (succeeded.jobs?.[0] as any)?.assets?.[0];
      await workflowService.review({
        id: succeeded.id,
        ownerUserId,
        actorUserId: ownerUserId,
        expectedRevision: succeeded.revision,
        outputAssetId: output.id,
        decision: 'APPROVE',
        note: null,
      });
      return {
        workflow: await workflowService.get(succeeded.id, ownerUserId),
        jobId: created.jobId,
        output,
      };
    };

    const first = await createReviewed('first');
    const firstTarget = await client!.supplyGoods.findUniqueOrThrow({ where: { id: goodsId } });
    const firstInput = {
      workflowId: first.workflow.id,
      ownerUserId,
      actorUserId: ownerUserId,
      mode: 'append' as const,
      operationKey: `mutation-apply-first-${suffix}`,
      expectedWorkflowRevision: first.workflow.revision,
      expectedTargetUpdatedAt: firstTarget.updatedAt.toISOString(),
    };
    await expect(applyAiMediaWorkflowApplication(client!, {
      ...firstInput,
      operationKey: `mutation-production-fake-${suffix}`,
      production: true,
    })).rejects.toMatchObject({ code: 'PROVIDER_NOT_READY' });
    expect(await client!.aiMediaApplicationMutation.count({ where: { ownerUserId } })).toBe(0);
    const concurrentFirst = await Promise.all([
      applyAiMediaWorkflowApplication(client!, firstInput),
      applyAiMediaWorkflowApplication(client!, firstInput),
    ]);
    expect(concurrentFirst.filter((result) => result.replayed)).toHaveLength(1);
    expect(new Set(concurrentFirst.map((result) => result.application.id)).size).toBe(1);
    const firstApply = concurrentFirst[0]!.application;
    const persistedFirstApply = await client!.aiMediaApplicationMutation.findUniqueOrThrow({
      where: { id: firstApply.id },
      select: { revision: true },
    });
    expect(firstApply.revision).toBe(persistedFirstApply.revision);
    expect(concurrentFirst[1]!.application.revision).toBe(persistedFirstApply.revision);
    expect(await client!.aiMediaApplicationMutation.count({ where: {
      ownerUserId,
      jobId: first.jobId,
      kind: 'APPLY',
    } })).toBe(1);

    const second = await createReviewed('second');
    const secondTarget = await client!.supplyGoods.findUniqueOrThrow({ where: { id: goodsId } });
    const secondApplied = await applyAiMediaWorkflowApplication(client!, {
      workflowId: second.workflow.id,
      ownerUserId,
      actorUserId: ownerUserId,
      mode: 'append',
      operationKey: `mutation-apply-second-${suffix}`,
      expectedWorkflowRevision: second.workflow.revision,
      expectedTargetUpdatedAt: secondTarget.updatedAt.toISOString(),
    });
    const openHistory = await listAiMediaWorkflowApplications(client!, {
      workflowId: second.workflow.id,
      ownerUserId,
      limit: 10,
    });
    const persistedSecondApply = await client!.aiMediaApplicationMutation.findUniqueOrThrow({
      where: { id: secondApplied.application.id },
      select: { revision: true },
    });
    expect(secondApplied.application.revision).toBe(persistedSecondApply.revision);
    expect(openHistory.frontier).toMatchObject({
      id: secondApplied.application.id,
      revision: persistedSecondApply.revision,
    });
    expect(openHistory.items.find((item: any) => item.id === secondApplied.application.id))
      .toMatchObject({ revision: persistedSecondApply.revision });

    const beforeWrongOrder = await client!.supplyGoods.findUniqueOrThrow({ where: { id: goodsId } });
    const firstWorkflowAfterApply = await client!.aiMediaWorkflow.findUniqueOrThrow({
      where: { id: first.workflow.id },
    });
    await expect(rollbackAiMediaWorkflowApplication(client!, {
      applicationId: firstApply.id,
      ownerUserId,
      actorUserId: ownerUserId,
      operationKey: `mutation-rollback-wrong-${suffix}`,
      expectedApplicationRevision: 1,
      expectedWorkflowRevision: firstWorkflowAfterApply.revision,
      expectedTargetUpdatedAt: beforeWrongOrder.updatedAt.toISOString(),
    })).rejects.toMatchObject({ code: 'ROLLBACK_ORDER_CONFLICT' });

    const changedMetadata = {
      ...(beforeWrongOrder.metadata as Record<string, unknown>),
      marker: 'preserve-later-change',
      laterAudit: { actor: 'integration' },
    };
    const externallyUpdatedAt = new Date(beforeWrongOrder.updatedAt.getTime() + 5);
    await client!.supplyGoods.update({
      where: { id: goodsId },
      data: { metadata: changedMetadata, updatedAt: externallyUpdatedAt },
    });
    const secondWorkflowAfterApply = await client!.aiMediaWorkflow.findUniqueOrThrow({
      where: { id: second.workflow.id },
    });
    const secondRollbackInput = {
      applicationId: secondApplied.application.id,
      ownerUserId,
      actorUserId: ownerUserId,
      operationKey: `mutation-rollback-second-${suffix}`,
      expectedApplicationRevision: 1,
      expectedWorkflowRevision: secondWorkflowAfterApply.revision,
      expectedTargetUpdatedAt: externallyUpdatedAt.toISOString(),
    };
    const secondRollback = await rollbackAiMediaWorkflowApplication(client!, secondRollbackInput);
    const secondRollbackReplay = await rollbackAiMediaWorkflowApplication(client!, secondRollbackInput);
    const persistedSecondRollback = await client!.aiMediaApplicationMutation.findUniqueOrThrow({
      where: { id: secondRollback.application.id },
      select: { revision: true },
    });
    expect(secondRollback.replayed).toBe(false);
    expect(secondRollback.application.revision).toBe(persistedSecondRollback.revision);
    expect(secondRollbackReplay).toMatchObject({
      replayed: true,
      application: {
        id: secondRollback.application.id,
        revision: persistedSecondRollback.revision,
      },
    });

    const afterSecondRollback = await client!.supplyGoods.findUniqueOrThrow({ where: { id: goodsId } });
    const firstRollback = await rollbackAiMediaWorkflowApplication(client!, {
      applicationId: firstApply.id,
      ownerUserId,
      actorUserId: ownerUserId,
      operationKey: `mutation-rollback-first-${suffix}`,
      expectedApplicationRevision: 1,
      expectedWorkflowRevision: firstWorkflowAfterApply.revision,
      expectedTargetUpdatedAt: afterSecondRollback.updatedAt.toISOString(),
    });
    expect(firstRollback.application.kind).toBe('ROLLBACK');
    expect(firstRollback.target.images).toEqual(legacyImages);

    const restored = await client!.supplyGoods.findUniqueOrThrow({ where: { id: goodsId } });
    expect(restored.images).toEqual(legacyImages);
    expect(restored.metadata).toEqual({
      marker: 'preserve-later-change',
      laterAudit: { actor: 'integration' },
    });
    const history = await listAiMediaWorkflowApplications(client!, {
      workflowId: first.workflow.id,
      ownerUserId,
      limit: 10,
      operationKey: firstInput.operationKey,
    });
    expect(history.items.map((item: any) => item.targetSequence)).toEqual([4, 3, 2, 1]);
    expect(history.frontier).toBeNull();
    expect(history.recoveredOperation).toMatchObject({ id: firstApply.id, kind: 'APPLY' });
    expect(JSON.stringify(history)).not.toContain('"beforeState":');
    expect(history.legacyApplications).toEqual([]);
    const secondWorkflowHistory = await listAiMediaWorkflowApplications(client!, {
      workflowId: second.workflow.id,
      ownerUserId,
      limit: 1,
    });
    expect(secondWorkflowHistory.legacyApplications).toEqual([]);
    expect(await client!.aiMediaWorkflowEvent.count({ where: {
      ownerUserId,
      eventType: 'APPLIED',
    } })).toBe(2);
    expect(await client!.aiMediaWorkflowEvent.count({ where: {
      ownerUserId,
      eventType: 'APPLICATION_ROLLED_BACK',
    } })).toBe(2);

    await expect(client!.aiMediaApplicationMutation.update({
      where: { id: firstApply.id },
      data: { operationKey: `mutation-tampered-${suffix}` },
    })).rejects.toThrow(/AI media application mutations are immutable/i);
    await expect(client!.aiMediaApplicationMutation.delete({
      where: { id: firstApply.id },
    })).rejects.toThrow(/AI media application mutations are immutable/i);
    await expect(listAiMediaWorkflowApplications(client!, {
      workflowId: first.workflow.id,
      ownerUserId: otherOwnerUserId,
    })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
