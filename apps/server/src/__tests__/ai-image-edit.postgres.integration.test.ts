import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { PrismaAiImageJobRepository } from '../repositories/ai-image-job-repository.js';
import { PrismaAiMediaWorkflowRepository } from '../repositories/ai-media-workflow-repository.js';
import { applyAiImageAssets } from '../services/ai-image-application.js';
import { AI_IMAGE_EDIT_MASK_SEMANTICS } from '../services/ai-image-compositor.js';
import { runAiImageEditJob } from '../services/ai-image-edit.js';
import { createFakeAiImageProvider } from '../services/ai-image-jobs.js';
import { createAiMediaWorkflowService } from '../services/ai-media-workflows.js';

const databaseUrl = process.env.AI_MEDIA_TEST_DATABASE_URL || '';
const enabled = process.env.RUN_AI_MEDIA_POSTGRES_TESTS === '1' && Boolean(databaseUrl);
const describePostgres = enabled ? describe : describe.skip;
const client = enabled ? new PrismaClient({ datasources: { db: { url: databaseUrl } } }) : null;

const digest = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

async function rgbaPng(width: number, height: number, pixels: number[]) {
  return sharp(Buffer.from(pixels), { raw: { width, height, channels: 4 } }).png().toBuffer();
}

function assertIsolatedSchema() {
  const schema = databaseUrl ? new URL(databaseUrl).searchParams.get('schema') || '' : '';
  if (!/^ai_media_test_[a-z0-9_]+$/u.test(schema)) {
    throw new Error('AI_MEDIA_TEST_DATABASE_URL must target an isolated ai_media_test_* schema');
  }
}

describePostgres('AI image edit PostgreSQL workflow', () => {
  beforeAll(async () => {
    assertIsolatedSchema();
    await client!.$connect();
  });
  afterAll(async () => client!.$disconnect());

  it('persists raw/composite lineage, reviews only the final candidate, and appends without replacing originals', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const ownerUserId = `edit_owner_${suffix}`;
    const goodsId = `edit_goods_${suffix}`;
    const subjectId = `edit_subject_${suffix}`;
    const snapshotId = `edit_snapshot_${suffix}`;
    const sourceAssetId = `edit_source_${suffix}`;
    const maskAssetId = `edit_mask_${suffix}`;
    const source = await rgbaPng(2, 2, [
      10, 20, 30, 255, 40, 50, 60, 255,
      70, 80, 90, 255, 100, 110, 120, 255,
    ]);
    const mask = await rgbaPng(2, 2, [
      0, 0, 0, 255, 255, 255, 255, 255,
      0, 0, 0, 255, 255, 255, 255, 255,
    ]);
    const candidate = await rgbaPng(2, 2, new Array(16).fill(200));

    await client!.user.create({ data: {
      id: ownerUserId, phone: `edit_${suffix}`, passwordHash: 'integration-test',
    } });
    await client!.supplyGoods.create({ data: {
      id: goodsId, userId: ownerUserId, title: 'AI edit integration fixture',
      sourcePlatform: '1688', sourceProductId: `product_${suffix}`,
      images: ['https://cdn.example/original.png'],
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
    await (client! as any).mediaAsset.create({ data: {
      id: sourceAssetId, ownerUserId, kind: 'SOURCE_ORIGINAL', sourceCaptureSnapshotId: snapshotId,
      sourceMediaKey: 'main-1', sourceUrl: 'https://source.example/main.png',
      url: `/uploads/${sourceAssetId}.png`, storageBackend: 'local', storageKey: `${sourceAssetId}.png`,
      mimeType: 'image/png', sizeBytes: source.length, width: 2, height: 2, sha256: digest(source),
      metadata: { pixelOrientationNormalized: true },
    } });
    await (client! as any).mediaAsset.create({ data: {
      id: maskAssetId, ownerUserId, kind: 'EDIT_MASK', sourceCaptureSnapshotId: snapshotId,
      sourceMediaKey: `edit-mask:${sourceAssetId}:${digest(mask)}`,
      url: `/uploads/${maskAssetId}.png`, storageBackend: 'local', storageKey: `${maskAssetId}.png`,
      mimeType: 'image/png', sizeBytes: mask.length, width: 2, height: 2, sha256: digest(mask),
      metadata: {
        contractVersion: 'ai-image-edit-policy/1.0',
        maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
        sourceAssetId,
        sourceSha256: digest(source),
      },
    } });

    const workflowRepository = new PrismaAiMediaWorkflowRepository(client!);
    const workflowService = createAiMediaWorkflowService(workflowRepository);
    const jobRepository = new PrismaAiImageJobRepository(client!);
    const created = await workflowService.createImageEdit({
      ownerUserId, actorUserId: ownerUserId, operation: 'INPAINT',
      sourceAssetId, maskAssetId, maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
      prompt: 'Remove the label', negativePrompt: null,
      resolvedPrompt: 'Frozen remove-label prompt', resolvedNegativePrompt: 'Preserve product identity',
      templateKey: 'inpaint.base', templateReleaseId: `edit-release-${suffix}`,
      templateChecksum: 'd'.repeat(64), templateSnapshot: { sequence: 1 },
      dailyLimit: 20,
      idempotencyKey: `edit-create-${suffix}`, context: { type: 'collect', id: goodsId },
    });

    const uploaded = new Map<string, Buffer>();
    await runAiImageEditJob(created.jobId, 1, {
      repository: jobRepository,
      provider: createFakeAiImageProvider({ images: [{ buffer: candidate, mimeType: 'image/png' }] }),
      loadInputBuffer: async (asset) => asset.role === 'MASK' ? mask : source,
      uploadBuffer: async (buffer, filename) => {
        uploaded.set(filename, buffer);
        return { url: `/uploads/${filename}`, backend: 'local', key: filename };
      },
    });

    const succeeded = await workflowService.get(created.workflow.id, ownerUserId);
    expect(succeeded).toMatchObject({ status: 'SUCCEEDED', reviewStatus: 'PENDING', operation: 'INPAINT' });
    const persistedAssets = await (client! as any).mediaAsset.findMany({
      where: { aiImageJobId: created.jobId }, orderBy: { kind: 'asc' },
    });
    const raw = persistedAssets.find((asset: any) => asset.kind === 'AI_PROVIDER_OUTPUT');
    const final = persistedAssets.find((asset: any) => asset.kind === 'AI_GENERATED');
    expect(raw).toBeTruthy();
    expect(final).toBeTruthy();
    expect(final.metadata).toMatchObject({ providerOutputAssetId: raw.id });
    expect(await client!.mediaAssetLineage.count({ where: { jobId: created.jobId } })).toBe(4);
    const finalBuffer = [...uploaded.entries()].find(([name]) => name.endsWith('-composite.png'))?.[1];
    expect(finalBuffer).toBeTruthy();
    expect([...(await sharp(finalBuffer!).ensureAlpha().raw().toBuffer())]).toEqual([
      10, 20, 30, 255, 200, 200, 200, 200,
      70, 80, 90, 255, 200, 200, 200, 200,
    ]);

    await expect(workflowService.review({
      id: succeeded.id, ownerUserId, actorUserId: ownerUserId,
      expectedRevision: succeeded.revision, outputAssetId: raw.id,
      decision: 'APPROVE', note: null,
    })).rejects.toMatchObject({ code: 'WORKFLOW_CONFLICT' });
    const approved = await workflowService.review({
      id: succeeded.id, ownerUserId, actorUserId: ownerUserId,
      expectedRevision: succeeded.revision, outputAssetId: final.id,
      decision: 'APPROVE', note: null,
    });
    expect(approved.reviewStatus).toBe('APPROVED');

    const target = await client!.supplyGoods.findUniqueOrThrow({ where: { id: goodsId } });
    const applied = await applyAiImageAssets(client! as any, {
      jobId: created.jobId, ownerUserId, actorUserId: ownerUserId,
      mode: 'append', targetType: 'collect', targetId: goodsId,
      selectedAssetId: final.id, expectedTargetUpdatedAt: target.updatedAt.toISOString(),
    });
    expect(applied.images).toEqual([
      'https://cdn.example/original.png',
      final.url,
    ]);
    expect(applied.images).not.toContain(raw.url);

    await expect((client! as any).mediaAsset.create({ data: {
      ownerUserId, aiImageJobId: created.jobId, kind: 'AI_PROVIDER_OUTPUT',
      url: '/uploads/forged-raw.png', storageBackend: 'local', storageKey: 'forged-raw.png',
      mimeType: 'image/png', sizeBytes: 1, width: 2, height: 2, sha256: 'e'.repeat(64),
    } })).rejects.toThrow();
    await expect((client! as any).mediaAsset.update({
      where: { id: final.id },
      data: { metadata: { ...(final.metadata as object), providerOutputAssetId: 'forged-raw-id' } },
    })).rejects.toThrow(/metadata is immutable|output graph is invalid/i);
  });

  it('allows only one final candidate when concurrent transactions target the same edit job', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const ownerUserId = `edit_unique_owner_${suffix}`;
    const jobId = `edit_unique_job_${suffix}`;

    await client!.user.create({ data: {
      id: ownerUserId, phone: `edit_unique_${suffix}`, passwordHash: 'integration-test',
    } });
    await client!.aiImageJob.create({ data: {
      id: jobId,
      ownerUserId,
      actorUserId: ownerUserId,
      provider: 'fake',
      model: 'fake-edit-unique-v1',
      prompt: 'concurrent final uniqueness fixture',
      status: 'RUNNING',
      operation: 'FULL_EDIT',
      width: 1,
      height: 1,
      idempotencyKey: `${jobId}:request`,
    } });

    const createFinal = (assetId: string) => client!.$transaction(async (tx) => tx.mediaAsset.create({ data: {
      id: assetId,
      ownerUserId,
      aiImageJobId: jobId,
      kind: 'AI_GENERATED',
      url: `https://storage.example/${assetId}.png`,
      storageBackend: 'local',
      storageKey: `${assetId}.png`,
      mimeType: 'image/png',
      sizeBytes: 68,
      width: 1,
      height: 1,
      sha256: 'f'.repeat(64),
      metadata: {
        outputRole: 'FINAL_CANDIDATE',
        providerOutputAssetId: `raw-${jobId}`,
      },
    } }));

    const outcomes = await Promise.allSettled([
      createFinal(`edit_unique_asset_a_${suffix}`),
      createFinal(`edit_unique_asset_b_${suffix}`),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
    expect(rejected?.status === 'rejected' && (rejected.reason?.code === 'P2002'
      || /unique|duplicate/i.test(String(rejected.reason?.message)))).toBe(true);
    expect(await client!.mediaAsset.count({ where: { aiImageJobId: jobId } })).toBe(1);
  });
});
