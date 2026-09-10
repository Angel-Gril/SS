import { createHash, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { Readable } from 'node:stream';
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { PrismaAiImageJobRepository } from '../repositories/ai-image-job-repository.js';
import { PrismaAiMediaWorkflowRepository } from '../repositories/ai-media-workflow-repository.js';
import { PrismaAiProviderReconciliationRepository } from '../repositories/ai-provider-reconciliation-repository.js';
import { runAiProviderReconciliationTick } from '../workers/ai-provider-reconciliation.js';
import { createAiImageEditRecovery } from '../services/ai-image-edit-recovery.js';
import { appendAiCostSettlementInTransaction } from '../services/ai-cost-ledger.js';
import { deriveOwnedImageStorageKey, type ImageUploadOptions } from '../services/image-storage.js';
import { AI_IMAGE_EDIT_MASK_SEMANTICS } from '../services/ai-image-compositor.js';
import {
  loadAiImageEditInputBuffer,
  readBoundedAiImageEditStream,
} from '../services/ai-image-edit-input-reader.js';
import { createOpenAiImageEditProvider } from '../services/ai-image-providers.js';
import { createDashScopeWanx21ImageEditProvider } from '../services/ai-image-wanx-edit-provider.js';
import { AiPromptTemplateRegistryService } from '../services/ai-prompt-template-registry.js';
import { InMemoryAiPromptTemplateStore } from '../services/ai-prompt-templates.js';
import type { AiImageProviderCapability } from '../services/ai-image-provider-capabilities.js';
import {
  aiImageProviderEndpointSha256,
  createAiImageProviderRuntimeContract,
} from '../services/ai-image-provider-runtime-contract.js';
import { createAiMediaWorkflowService } from '../services/ai-media-workflows.js';
import {
  processAiImageEditQueueJob,
  resolveAiImageEditProvider,
  type AiImageEditProviderRuntimeConfig,
} from '../workers/ai-image-edit.js';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
vi.mock('../lib/redis.js', () => ({ redisDisabled: true, redis: {} }));

const enabled = process.env.RUN_AI_MEDIA_POSTGRES_TESTS === '1';
const databaseUrl = process.env.AI_MEDIA_TEST_DATABASE_URL || '';
const WIDTH = 1024;
const HEIGHT = 1024;
const runtime = {
  provider: 'openai-images',
  model: 'gpt-image-1',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'synthetic-edit-dispatch-sentinel',
  // Synthetic USD cents exercise the existing ledger, not a Provider price or CNY receipt.
  costPerImageCents: 7,
};
const fixtureCapability: AiImageProviderCapability = {
  provider: runtime.provider,
  model: runtime.model,
  operations: ['FULL_EDIT', 'INPAINT'],
  maxReferences: 1,
  supportsMask: true,
  inputTransport: 'multipart',
  resultMode: 'sync',
  evidenceLevel: 'sandbox-verified',
  evidence: 'SYNTHETIC TEST FIXTURE ONLY; no Provider capability promotion',
  sandboxEvidence: ['FULL_EDIT', 'INPAINT'].map((operation) => ({
    endpointSha256: aiImageProviderEndpointSha256(runtime.provider, runtime.baseUrl),
    operation: operation as 'FULL_EDIT' | 'INPAINT',
    inputTransport: 'multipart',
    resultMode: 'sync',
  })),
};
const digest = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

describe.skipIf(!enabled)('paid edit dispatch fence PostgreSQL evidence', () => {
  let database: PrismaClient;

  beforeAll(async () => {
    const schema = databaseUrl ? new URL(databaseUrl).searchParams.get('schema') || '' : '';
    if (!/^ai_media_test_[a-z0-9_]+$/u.test(schema)) {
      throw new Error('AI_MEDIA_TEST_DATABASE_URL must target an isolated ai_media_test_* schema');
    }
    database = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await database.$connect();
  });
  afterAll(async () => database?.$disconnect());
  beforeEach(() => {
    vi.mocked(lookup).mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as never);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  async function fixture(operation: 'FULL_EDIT' | 'INPAINT', providerMode: 'openai' | 'wanx' = 'openai') {
    const activeRuntime: AiImageEditProviderRuntimeConfig = providerMode === 'wanx'
      ? { ...runtime, provider: 'dashscope-wanx', model: 'wanx2.1-imageedit', baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
        credentialRevision: { recordId: 'synthetic-wanx-config', revision: 3, updatedAt: '2026-09-09T10:00:00.000Z' } }
      : runtime;
    const activeCapability: AiImageProviderCapability = providerMode === 'wanx' ? {
      ...fixtureCapability, provider: activeRuntime.provider, model: activeRuntime.model,
      inputTransport: 'base64', resultMode: 'async',
      sandboxEvidence: (['FULL_EDIT', 'INPAINT'] as const).map((operation) => ({
        endpointSha256: aiImageProviderEndpointSha256(activeRuntime.provider, activeRuntime.baseUrl),
        operation, inputTransport: 'base64', resultMode: 'async',
      })),
    } : fixtureCapability;
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const ownerUserId = `edit_dispatch_owner_${suffix}`;
    const goodsId = `edit_dispatch_goods_${suffix}`;
    const subjectId = `edit_dispatch_subject_${suffix}`;
    const snapshotId = `edit_dispatch_snapshot_${suffix}`;
    const sourceAssetId = `edit_dispatch_source_${suffix}`;
    const maskAssetId = `edit_dispatch_mask_${suffix}`;
    const source = await sharp({ create: {
      width: WIDTH, height: HEIGHT, channels: 4,
      background: { r: 10, g: 20, b: 30, alpha: 1 },
    } }).png().toBuffer();
    const candidate = await sharp({ create: {
      width: WIDTH, height: HEIGHT, channels: 4,
      background: { r: 200, g: 150, b: 100, alpha: 1 },
    } }).png().toBuffer();
    const maskPixels = Buffer.alloc(WIDTH * HEIGHT * 4);
    for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel += 1) {
      maskPixels.fill(pixel % WIDTH < WIDTH / 2 ? 0 : 255, pixel * 4, pixel * 4 + 3);
      maskPixels[pixel * 4 + 3] = 255;
    }
    const mask = await sharp(maskPixels, {
      raw: { width: WIDTH, height: HEIGHT, channels: 4 },
    }).png().toBuffer();
    const sourceKey = `${suffix}/source.png`;
    const maskKey = `${suffix}/mask.png`;
    const objects = new Map<string, Buffer>([[sourceKey, source], [maskKey, mask]]);
    const uploaded = new Map<string, Buffer>();

    await database.user.create({ data: {
      id: ownerUserId, phone: `edit_dispatch_${suffix}`, passwordHash: 'integration-test',
    } });
    await database.supplyGoods.create({ data: {
      id: goodsId, userId: ownerUserId, title: 'Synthetic edit dispatch fixture',
      sourcePlatform: '1688', sourceProductId: `edit_dispatch_${suffix}`,
    } });
    await database.sourceCaptureSubject.create({ data: {
      id: subjectId, ownerUserId, sourcePlatform: '1688', sourceProductId: `edit_dispatch_${suffix}`,
      legacySupplyGoodsId: goodsId,
    } });
    await database.sourceCaptureSnapshot.create({ data: {
      id: snapshotId, subjectId, version: 1, schemaVersion: 'source-product-capture-v2',
      captureHash: digest(`capture-${suffix}`), payloadBytes: 2, payload: {}, stageCounts: {}, provenance: {},
      provenanceComplete: true, parserVersion: 'integration', completeness: {}, truncations: [],
      hasEstimatedValues: false, profile: {}, profileHash: digest(`profile-${suffix}`), actorUserId: ownerUserId,
      ingestChannel: 'WEB_ACCOUNT', rolloutRevision: 'integration', rolloutStage: 'v2_only',
      capturedAt: new Date(),
    } });
    await database.mediaAsset.create({ data: {
      id: sourceAssetId, ownerUserId, kind: 'SOURCE_ORIGINAL', sourceCaptureSnapshotId: snapshotId,
      sourceMediaKey: 'main-1', sourceUrl: 'https://source.example/fixture.png',
      url: `https://edit-dispatch-fixture.invalid/${sourceKey}`, storageBackend: 'oss', storageKey: sourceKey,
      mimeType: 'image/png', sizeBytes: source.length, width: WIDTH, height: HEIGHT, sha256: digest(source),
      metadata: { pixelOrientationNormalized: true },
    } });
    if (operation === 'INPAINT') {
      await database.mediaAsset.create({ data: {
        id: maskAssetId, ownerUserId, kind: 'EDIT_MASK', sourceCaptureSnapshotId: snapshotId,
        sourceMediaKey: `edit-mask:${sourceAssetId}:${digest(mask)}`,
        url: `https://edit-dispatch-fixture.invalid/${maskKey}`, storageBackend: 'oss', storageKey: maskKey,
        mimeType: 'image/png', sizeBytes: mask.length, width: WIDTH, height: HEIGHT, sha256: digest(mask),
        metadata: {
          contractVersion: 'ai-image-edit-policy/1.0', maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
          sourceAssetId, sourceSha256: digest(source),
        },
      } });
    }

    const workflowRepository = new PrismaAiMediaWorkflowRepository(database);
    const workflowService = createAiMediaWorkflowService(workflowRepository, { resolveCapability: () => activeCapability });
    const compiled = providerMode === 'wanx'
      ? await new AiPromptTemplateRegistryService(new InMemoryAiPromptTemplateStore(), { getLegacyPrompt: async () => 'unused' })
        .resolveTemplate({ templateKey: operation === 'INPAINT' ? 'inpaint.base' : 'full-image-edit.base',
          renderingProfile: 'ai-image-wanx21-edit-prompt/v1', variables: { userPrompt: 'Edit the background', userNegativePrompt: '' } })
      : null;
    // Capability is a declared fixture. The real registry remains unverified and disabled.
    const creationInput = {
      ownerUserId, actorUserId: ownerUserId, operation, sourceAssetId, width: WIDTH, height: HEIGHT,
      ...(operation === 'INPAINT' ? { maskAssetId, maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS } : {}),
      prompt: 'Edit the background', negativePrompt: null,
      resolvedPrompt: compiled?.resolvedPrompt ?? 'Synthetic frozen background edit',
      resolvedNegativePrompt: compiled?.resolvedNegativePrompt ?? 'Preserve product identity',
      templateKey: operation === 'INPAINT' ? 'inpaint.base' : 'full-image-edit.base',
      templateReleaseId: compiled?.release.id ?? `synthetic-edit-release-${suffix}`,
      templateChecksum: compiled?.checksum ?? digest(`template-${suffix}`),
      templateSnapshot: compiled?.snapshot ?? { syntheticFixture: true }, dailyLimit: 20,
      provider: activeRuntime.provider, model: activeRuntime.model, estimatedCostCents: activeRuntime.costPerImageCents,
      globalDailyBudgetCents: 1_000_000,
      providerRuntimeContract: createAiImageProviderRuntimeContract(activeRuntime, {
        count: 1, width: WIDTH, height: HEIGHT,
      }),
      idempotencyKey: `edit-dispatch-${suffix}`, context: { type: 'collect' as const, id: goodsId },
    };
    const created = await workflowService.createImageEdit(creationInput);
    expect(created.replayed).toBe(false);
    expect(resolveAiImageEditProvider(
      activeRuntime.provider, activeRuntime.model, operation, activeRuntime, undefined, 'test',
    ).name).toBe('disabled');

    const repository = new PrismaAiImageJobRepository(database);
    const loadInputBuffer = (asset: Parameters<typeof loadAiImageEditInputBuffer>[0]) => loadAiImageEditInputBuffer(asset, {
      readOssObject: async (key, expectedSize) => {
        const buffer = objects.get(key);
        if (!buffer) throw new Error('Unknown synthetic storage object');
        return readBoundedAiImageEditStream(Readable.from([buffer]), expectedSize);
      },
    });
    const uploadBuffer = async (buffer: Buffer, filename: string, _mimeType?: string, options?: ImageUploadOptions) => {
      const key = deriveOwnedImageStorageKey('oss', filename, options!);
      uploaded.set(key, Buffer.from(buffer));
      return { url: `https://edit-dispatch-fixture.invalid/${key}`, backend: 'oss', key };
    };
    const execute = (attempt = 1, overrides: Parameters<typeof processAiImageEditQueueJob>[2] = {}) => processAiImageEditQueueJob(created.jobId, attempt, {
      repository, nodeEnv: 'test',
      getProviderConfig: async () => ({ ...activeRuntime }),
      getDispatchAuthorization: async () => ({
        enabled: true, reasonCode: 'synthetic-fixture', reason: 'Synthetic fixture authorization',
      }),
      acquireLease: async () => true,
      renewLease: async () => true,
      releaseLease: async () => undefined,
      resolveProvider: (provider, model, requestedOperation, config, onCreated, nodeEnv, dependencies) => (
        resolveAiImageEditProvider(provider, model, requestedOperation, config, onCreated, nodeEnv, {
          ...dependencies,
          resolveCapability: () => activeCapability,
          createOpenAiEditProvider: (options) => createOpenAiImageEditProvider({
            ...options, timeoutMs: 10_000,
          }),
          createWanxEditProvider: (options) => createDashScopeWanx21ImageEditProvider({
            ...options, timeoutMs: 10_000, pollIntervalMs: 0,
          }),
        })
      ),
      loadInputBuffer, uploadBuffer, ...overrides,
    });
    const state = async () => {
      const [job, workflow, reservation, assets] = await Promise.all([
        database.aiImageJob.findUniqueOrThrow({ where: { id: created.jobId } }),
        database.aiMediaWorkflow.findUniqueOrThrow({ where: { id: created.workflow.id }, include: { inputs: true } }),
        database.aiCostReservation.findUniqueOrThrow({ where: { jobId: created.jobId }, include: { settlements: true } }),
        database.mediaAsset.findMany({ where: { aiImageJobId: created.jobId } }),
      ]);
      return { job, workflow, reservation, assets };
    };
    expect((await state()).reservation).toMatchObject({
      status: 'RESERVED', currency: 'USD', estimatedCostMinor: 7, maximumCostMinor: 7,
    });
    const response = () => new Response(JSON.stringify({
      id: `synthetic-request-${suffix}`, data: [{ b64_json: candidate.toString('base64') }],
    }), { headers: { 'content-type': 'application/json' } });
    return {
      ...created, ownerUserId, snapshotId, sourceAssetId, maskAssetId, source, candidate, mask,
      repository, workflowRepository, workflowService, uploaded, execute, state, response, creationInput,
      loadInputBuffer, uploadBuffer, activeRuntime,
    };
  }

  function recoveryRepository(jobId: string) {
    // Restrict candidate selection to this test's real persisted job; all transactions use PostgreSQL.
    return new PrismaAiProviderReconciliationRepository({
      aiImageJob: { findMany: (args: any) => database.aiImageJob.findMany({
        ...args, where: { AND: [args.where, { id: jobId }] },
      }) },
      $transaction: database.$transaction.bind(database),
    } as never);
  }

  const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  function wanxSuccess(taskId: string) {
    return jsonResponse({ output: { task_id: taskId, task_status: 'SUCCEEDED',
      results: [{ url: 'https://dashscope-test.oss-cn-beijing.aliyuncs.com/recovered.png' }],
      task_metrics: { TOTAL: 1, SUCCEEDED: 1, FAILED: 0 } }, usage: { image_count: 1 } });
  }

  function recoverTarget(target: Awaited<ReturnType<typeof fixture>>, overrides: Parameters<typeof runAiProviderReconciliationTick>[0] = {}) {
    return runAiProviderReconciliationTick({
      repository: recoveryRepository(target.jobId), getEditProviderConfig: async () => target.activeRuntime,
      loadEditInputBuffer: target.loadInputBuffer, uploadBuffer: target.uploadBuffer, limit: 1, ...overrides,
    });
  }

  async function interruptedWanx(operation: 'FULL_EDIT' | 'INPAINT' = 'FULL_EDIT') {
    const target = await fixture(operation, 'wanx');
    const taskId = `interrupted-${target.jobId}`;
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ output: { task_id: taskId, task_status: 'PENDING' } }))
      .mockRejectedValueOnce(new Error('Synthetic interrupted poll'));
    vi.stubGlobal('fetch', fetcher);
    await expect(target.execute()).rejects.toThrow('Synthetic interrupted poll');
    return { target, taskId, fetcher };
  }

  it.each(['before-worker', 'before-recovery', 'during-lookup-dns'] as const)('refuses credential rotation %s without sending another request', async (when) => {
    const target = when === 'before-worker' ? await fixture('FULL_EDIT', 'wanx') : (await interruptedWanx()).target;
    const before = await target.state();
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const changed = { ...target.activeRuntime, credentialRevision: {
      ...target.activeRuntime.credentialRevision!, revision: 99,
    } };
    if (when === 'before-worker') {
      expect(await target.execute(1, { getProviderConfig: async () => changed })).toBe('ignored');
      const after = await target.state();
      expect(after.job.errorCode).toBe('PROVIDER_RUNTIME_CONTRACT_MISMATCH');
      expect(after.reservation.status).toBe('RELEASED');
      expect(after.reservation.settlements).toEqual([expect.objectContaining({ kind: 'RELEASE', actualCostMinor: 0 })]);
    } else {
      let active = when === 'before-recovery' ? changed : target.activeRuntime;
      if (when === 'during-lookup-dns') {
        vi.mocked(lookup).mockImplementationOnce(async () => {
          active = changed;
          return [{ address: '8.8.8.8', family: 4 }] as never;
        });
      }
      expect(await recoverTarget(target, { getEditProviderConfig: async () => active }))
        .toMatchObject({ manualReview: 1, recovered: 0 });
      const after = await target.state();
      expect(after.job.providerReconciliationLastErrorCode).toBe('PROVIDER_RUNTIME_CONTRACT_MISMATCH');
      expect(after.reservation).toEqual(before.reservation);
    }
    expect(fetcher).not.toHaveBeenCalled();
    expect((await target.state()).assets).toHaveLength(0);
  });

  it('retains only raw output after accepted cancellation, with no reviewable candidate or resubmission', async () => {
    const target = await fixture('INPAINT', 'wanx');
    const taskId = `cancelled-${target.jobId}`;
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ output: { task_id: taskId, task_status: 'PENDING' } }))
      .mockImplementationOnce(async () => {
        const { workflow } = await target.state();
        await target.workflowService.cancel(workflow.id, target.ownerUserId, target.ownerUserId, workflow.revision);
        throw new Error('Synthetic cancelled poll');
      })
      .mockResolvedValueOnce(wanxSuccess(taskId))
      .mockResolvedValueOnce(new Response(target.candidate, { headers: { 'content-type': 'image/png' } }));
    vi.stubGlobal('fetch', fetcher);
    expect(await target.execute()).toBe('ignored');
    expect((await target.state()).job).toMatchObject({ status: 'CANCELLED', providerReconciliationStatus: 'PENDING' });
    expect(await recoverTarget(target)).toMatchObject({ recovered: 1 });
    const state = await target.state();
    expect(state.job).toMatchObject({ status: 'CANCELLED', providerJobId: taskId, providerReconciliationStatus: 'CANCELLED_OUTPUT_RETAINED' });
    expect(state.workflow).toMatchObject({ status: 'CANCELLED', reviewStatus: 'NOT_READY', selectedOutputAssetId: null });
    expect(state.assets).toEqual([expect.objectContaining({ kind: 'AI_PROVIDER_OUTPUT' })]);
    expect(state.reservation.settlements.filter((entry) => entry.kind === 'RECONCILED_CHARGE')).toHaveLength(1);
    expect(target.uploaded.size).toBe(1);
    expect(fetcher.mock.calls.filter((call: any[]) => call[1]?.method === 'POST')).toHaveLength(1);
  });

  it('reuses persisted raw output after final storage failure and settles only on successful recovery', async () => {
    const { target, taskId, fetcher } = await interruptedWanx('INPAINT');
    fetcher.mockResolvedValueOnce(wanxSuccess(taskId))
      .mockResolvedValueOnce(new Response(target.candidate, { headers: { 'content-type': 'image/png' } }));
    expect(await recoverTarget(target, { uploadBuffer: async (buffer: Buffer, filename: string, mimeType?: string, options?: ImageUploadOptions) => {
      if (filename.includes('-final.')) throw new Error('Synthetic storage outage');
      return target.uploadBuffer(buffer, filename, mimeType, options);
    } })).toMatchObject({ pending: 1, recovered: 0, manualReview: 0 });
    const failed = await target.state();
    expect(failed.job).toMatchObject({ status: 'FAILED', providerReconciliationStatus: 'RETRY_WAIT' });
    expect(failed.assets).toEqual([expect.objectContaining({ kind: 'AI_PROVIDER_OUTPUT' })]);
    expect(failed.reservation.status).toBe('RECONCILIATION_REQUIRED');
    fetcher.mockResolvedValueOnce(wanxSuccess(taskId))
      .mockResolvedValueOnce(new Response(target.candidate, { headers: { 'content-type': 'image/png' } }));
    expect(await recoverTarget(target, { now: () => new Date(failed.job.providerReconciliationNextAt!.getTime() + 1) }))
      .toMatchObject({ recovered: 1, manualReview: 0 });
    const recovered = await target.state();
    expect(recovered.assets.find((asset) => asset.kind === 'AI_PROVIDER_OUTPUT')!.id).toBe(failed.assets[0]!.id);
    expect(recovered.assets).toHaveLength(2);
    expect(recovered.reservation.settlements.filter((entry) => entry.kind === 'RECONCILED_CHARGE')).toHaveLength(1);
    expect(await database.mediaAssetLineage.count({ where: { jobId: target.jobId } })).toBe(4);
    expect(fetcher.mock.calls.filter((call: any[]) => call[1]?.method === 'POST')).toHaveLength(1);
  });

  it.each(['wrong-id', 'wrong-dimensions', 'changed-source', 'unknown', 'failed'] as const)('keeps %s recovery unreviewable and never infers a free request', async (failure) => {
    const { target, taskId, fetcher } = await interruptedWanx();
    const before = await target.state();
    if (failure === 'unknown' || failure === 'failed') {
      fetcher.mockResolvedValueOnce(jsonResponse({ output: { task_id: taskId, task_status: failure.toUpperCase() } }));
    } else {
      fetcher.mockResolvedValueOnce(wanxSuccess(failure === 'wrong-id' ? 'different-task' : taskId));
      const image = failure === 'wrong-dimensions'
        ? await sharp({ create: { width: 512, height: 512, channels: 3, background: '#112233' } }).png().toBuffer()
        : target.candidate;
      fetcher.mockResolvedValueOnce(new Response(image, { headers: { 'content-type': 'image/png' } }));
    }
    const result = await recoverTarget(target, failure === 'changed-source'
      ? { loadEditInputBuffer: async () => target.candidate } : {});
    expect(result).toMatchObject({ recovered: 0, ...(failure === 'failed' ? { noOutput: 1 } : { manualReview: 1 }) });
    const after = await target.state();
    expect(after.job).toMatchObject({ status: 'FAILED', providerJobId: taskId });
    expect(after.reservation).toEqual(before.reservation);
    expect(after.assets).toHaveLength(0);
    expect(fetcher.mock.calls.filter((call: any[]) => call[1]?.method === 'POST')).toHaveLength(1);
  });

  it('fences duplicate, expired, foreign and superseded claims before output writes, and accepts only the winner', async () => {
    const { target, taskId, fetcher } = await interruptedWanx();
    const repo = recoveryRepository(target.jobId);
    const claims = await Promise.all(['worker-a', 'worker-b'].map((workerId) => repo.claimDue({
      workerId, now: new Date(), limit: 1, leaseMs: 60_000,
    })));
    expect(claims.flat()).toHaveLength(1);
    const original = claims.flat()[0]!;
    for (const forged of [
      { ...original, ownerUserId: 'foreign-owner' },
      { ...original, workflowAttempt: 99 },
      { ...original, requestFingerprint: '0'.repeat(64) },
      { ...original, providerJobId: 'different-task' },
    ]) {
      await expect(repo.getClaimedEditJob(forged)).rejects.toMatchObject({ code: 'PROVIDER_RECONCILIATION_LEASE_LOST' });
      await expect(repo.recordRecoveredEditRaw({ claim: forged, asset: {
        ownerUserId: target.ownerUserId, jobId: target.jobId, kind: 'AI_PROVIDER_OUTPUT',
        url: 'https://fixture.invalid/raw.png', storageBackend: 'oss', storageKey: 'raw.png',
        mimeType: 'image/png', sizeBytes: target.candidate.length, sha256: digest(target.candidate), width: WIDTH, height: HEIGHT,
      } })).rejects.toMatchObject({ code: 'PROVIDER_RECONCILIATION_LEASE_LOST' });
      await expect(repo.completeRecoveredEdit({ claim: forged, rawAssetId: 'uncommitted-raw',
        finalAsset: null, providerStatus: 'SUCCEEDED', actualCostCents: 7,
      })).rejects.toMatchObject({ code: 'PROVIDER_RECONCILIATION_LEASE_LOST' });
    }
    // Expire only this isolated test's lease through the existing revisioned schema contract.
    await database.aiImageJob.update({ where: { id: target.jobId }, data: {
      providerReconciliationLeaseExpiresAt: new Date(Date.now() - 1), providerReconciliationRevision: { increment: 1 },
    } });
    const expired = { ...original, reconciliationRevision: original.reconciliationRevision + 1 };
    await expect(repo.getClaimedEditJob(expired)).rejects.toMatchObject({ code: 'PROVIDER_RECONCILIATION_LEASE_LOST' });
    await expect(repo.completeRecoveredEdit({ claim: expired, rawAssetId: 'uncommitted-raw',
      finalAsset: null, providerStatus: 'SUCCEEDED', actualCostCents: 7,
    })).rejects.toMatchObject({ code: 'PROVIDER_RECONCILIATION_LEASE_LOST' });
    const [winner] = await repo.claimDue({ workerId: 'worker-c', now: new Date(), limit: 1, leaseMs: 60_000 });
    expect(winner).toBeDefined();
    await expect(repo.getClaimedEditJob(original)).rejects.toMatchObject({ code: 'PROVIDER_RECONCILIATION_LEASE_LOST' });
    fetcher.mockResolvedValueOnce(wanxSuccess(taskId))
      .mockResolvedValueOnce(new Response(target.candidate, { headers: { 'content-type': 'image/png' } }));
    const recovery = createAiImageEditRecovery({ repository: repo, getProviderConfig: async () => target.activeRuntime,
      loadInputBuffer: target.loadInputBuffer, uploadBuffer: target.uploadBuffer });
    const output = await recovery.lookup(winner!);
    expect(output.status).toBe('SUCCEEDED');
    if (output.status !== 'SUCCEEDED') throw new Error('Expected fixture task output');
    await recovery.recover(winner!, output);
    await expect(recovery.recover(winner!, output)).rejects.toMatchObject({ code: 'PROVIDER_RECONCILIATION_LEASE_LOST' });
    expect((await target.state()).assets).toHaveLength(2);
    expect((await target.state()).reservation.settlements.filter((entry) => entry.kind === 'RECONCILED_CHARGE')).toHaveLength(1);
  });

  it('rejects changed raw bytes on recovery without overwriting the original output identity or object', async () => {
    const { target, taskId, fetcher } = await interruptedWanx();
    fetcher.mockResolvedValueOnce(wanxSuccess(taskId))
      .mockResolvedValueOnce(new Response(target.candidate, { headers: { 'content-type': 'image/png' } }));
    expect(await recoverTarget(target, { uploadBuffer: async (...args: Parameters<typeof target.uploadBuffer>) => {
      if (args[1].includes('-final.')) throw new Error('Synthetic final storage failure');
      return target.uploadBuffer(...args);
    } })).toMatchObject({ pending: 1 });
    const before = await target.state();
    const raw = before.assets[0]!;
    const changedBytes = await sharp({ create: { width: WIDTH, height: HEIGHT, channels: 3, background: '#aa2211' } }).png().toBuffer();
    fetcher.mockResolvedValueOnce(wanxSuccess(taskId))
      .mockResolvedValueOnce(new Response(changedBytes, { headers: { 'content-type': 'image/png' } }));
    expect(await recoverTarget(target, { now: () => new Date(before.job.providerReconciliationNextAt!.getTime() + 1) }))
      .toMatchObject({ manualReview: 1, recovered: 0 });
    const after = await target.state();
    expect(after.job.providerReconciliationLastErrorCode).toBe('PROVIDER_OUTPUT_CONFLICT');
    expect(after.assets).toEqual(before.assets);
    expect(digest(target.uploaded.get(raw.storageKey!)!)).toBe(raw.sha256);
    expect(after.reservation).toEqual(before.reservation);
  });

  it('refuses a credential change after downloading the result before creating any review candidate', async () => {
    const { target, taskId, fetcher } = await interruptedWanx();
    let active = target.activeRuntime;
    fetcher.mockResolvedValueOnce(wanxSuccess(taskId)).mockImplementationOnce(async () => {
      active = { ...active, credentialRevision: { ...active.credentialRevision!, revision: 99 } };
      return new Response(target.candidate, { headers: { 'content-type': 'image/png' } });
    });
    const before = await target.state();
    expect(await recoverTarget(target, { getEditProviderConfig: async () => active })).toMatchObject({ manualReview: 1 });
    expect((await target.state()).assets).toHaveLength(0);
    expect((await target.state()).reservation).toEqual(before.reservation);
  });

  it.each(['SETTLED', 'RELEASED'] as const)('preserves an existing %s cost decision when the accepted cancelled task later returns output', async (costStatus) => {
    const target = await fixture('FULL_EDIT', 'wanx');
    const taskId = `terminal-cost-${target.jobId}`;
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ output: { task_id: taskId, task_status: 'PENDING' } }))
      .mockImplementationOnce(async () => {
        const { workflow } = await target.state();
        await target.workflowService.cancel(workflow.id, target.ownerUserId, target.ownerUserId, workflow.revision);
        throw new Error('Synthetic cancelled task');
      });
    vi.stubGlobal('fetch', fetcher);
    expect(await target.execute()).toBe('ignored');
    const pending = await target.state();
    const actualCost = costStatus === 'SETTLED' ? 5 : 0;
    const billedUnits = costStatus === 'SETTLED' ? 1 : 0;
    // Establish a prior, explicitly different terminal cost decision through the real ledger in this isolated schema.
    await database.$transaction(async (tx) => {
      await appendAiCostSettlementInTransaction(tx as never, {
        reservationId: pending.reservation.id, ownerUserId: target.ownerUserId, actorUserId: target.ownerUserId,
        idempotencyKey: `synthetic-terminal-${target.jobId}`, requestFingerprint: pending.reservation.requestFingerprint,
        kind: costStatus === 'SETTLED' ? 'RECONCILED_CHARGE' : 'RECONCILED_RELEASE',
        actualCostMinor: actualCost, billedUnits, reason: 'Synthetic prior billing decision',
      });
      await tx.aiImageJob.update({ where: { id: target.jobId }, data: { actualCostCents: actualCost, billedUnits } });
    });
    const before = await target.state();
    fetcher.mockResolvedValueOnce(wanxSuccess(taskId))
      .mockResolvedValueOnce(new Response(target.candidate, { headers: { 'content-type': 'image/png' } }));
    expect(await recoverTarget(target)).toMatchObject({ recovered: 1 });
    const after = await target.state();
    expect(after.reservation).toEqual(before.reservation);
    expect(after.job).toMatchObject({ status: 'CANCELLED', actualCostCents: actualCost, billedUnits,
      providerReconciliationStatus: 'CANCELLED_OUTPUT_RETAINED' });
    expect(after.assets).toEqual([expect.objectContaining({ kind: 'AI_PROVIDER_OUTPUT' })]);
  });

  it('refuses translation-style completion and a status-only free-charge claim for an accepted edit', async () => {
    const { target } = await interruptedWanx();
    const repo = recoveryRepository(target.jobId);
    const [claim] = await repo.claimDue({ workerId: 'invalid-path', now: new Date(), limit: 1, leaseMs: 60_000 });
    const before = await target.state();
    await expect(repo.completeRecovered({ claim: claim!, providerStatus: 'SUCCEEDED', actualCostCents: 7, asset: {
      ownerUserId: target.ownerUserId, jobId: target.jobId, kind: 'AI_GENERATED',
      url: 'https://fixture.invalid/bypass.png', storageBackend: 'oss', storageKey: 'bypass.png',
      mimeType: 'image/png', sizeBytes: target.candidate.length, sha256: digest(target.candidate), width: WIDTH, height: HEIGHT,
    } })).rejects.toMatchObject({ code: 'INVALID_EDIT_OUTPUT_GRAPH' });
    await expect(repo.completeNoOutput({ claim: claim!, providerStatus: 'FAILED', errorCode: 'PROVIDER_TASK_FAILED',
      errorMessage: 'Synthetic failure', billingDisposition: 'NO_CHARGE',
    })).rejects.toMatchObject({ code: 'PROVIDER_COST_EVIDENCE_MISMATCH' });
    const after = await target.state();
    expect(after.assets).toHaveLength(0);
    expect(after.reservation).toEqual(before.reservation);
  });

  it.each(['FULL_EDIT', 'INPAINT'] as const)('recovers accepted Wanx %s via GET, preserving the original attempt and review graph', async (operation) => {
    const target = await fixture(operation, 'wanx');
    const taskId = `recovery-${target.jobId}`;
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ output: { task_id: taskId, task_status: 'PENDING' } }))
      .mockRejectedValueOnce(new Error('Synthetic interrupted poll'))
      .mockResolvedValueOnce(wanxSuccess(taskId))
      .mockResolvedValueOnce(new Response(target.candidate, { headers: { 'content-type': 'image/png' } }));
    vi.stubGlobal('fetch', fetcher);
    await expect(target.execute()).rejects.toThrow('Synthetic interrupted poll');
    const failed = await target.state();
    expect(failed.job).toMatchObject({ status: 'FAILED', providerJobId: taskId, providerReconciliationStatus: 'PENDING', attemptCount: 1 });
    const repo = recoveryRepository(target.jobId);
    const recover = () => runAiProviderReconciliationTick({
      repository: repo, getEditProviderConfig: async () => target.activeRuntime,
      loadEditInputBuffer: target.loadInputBuffer, uploadBuffer: target.uploadBuffer, limit: 1,
    });
    expect(await recover()).toMatchObject({ claimed: 1, recovered: 1, manualReview: 0 });
    expect(fetcher.mock.calls.map((call: any[]) => call[1]?.method)).toEqual(['POST', 'GET', 'GET', 'GET']);
    const state = await target.state();
    expect(state.job).toMatchObject({ status: 'SUCCEEDED', providerReconciliationStatus: 'RECOVERED',
      providerJobId: taskId, attemptCount: 1, workflowAttempt: failed.job.workflowAttempt });
    expect(state.job.providerDispatchedAt).toEqual(failed.job.providerDispatchedAt);
    expect(state.reservation.providerAcceptedAt).toEqual(failed.reservation.providerAcceptedAt);
    expect(state.workflow).toMatchObject({ currentAttempt: 1, reviewStatus: 'PENDING', selectedOutputAssetId: null });
    expect(state.reservation).toMatchObject({ status: 'SETTLED', providerRequestId: taskId, currency: 'USD' });
    expect(state.reservation.settlements.filter((settlement) => settlement.kind === 'RECONCILED_CHARGE'))
      .toEqual([expect.objectContaining({ actualCostMinor: 7, billedUnits: 1 })]);
    expect(state.assets).toHaveLength(2);
    const raw = state.assets.find((asset) => asset.kind === 'AI_PROVIDER_OUTPUT')!;
    const final = state.assets.find((asset) => asset.kind === 'AI_GENERATED')!;
    expect(final).toMatchObject({ sourceCaptureSnapshotId: target.snapshotId, metadata: { providerOutputAssetId: raw.id, pixelOrientationNormalized: true } });
    const pixels = await sharp(target.uploaded.get(final.storageKey!)!).ensureAlpha().raw().toBuffer();
    expect(pixels[0]).toBe(operation === 'INPAINT' ? 10 : 200);
    expect(pixels[(WIDTH / 2) * 4]).toBe(200);
    expect(await database.mediaAssetLineage.count({ where: { jobId: target.jobId } })).toBe(operation === 'INPAINT' ? 4 : 2);
    await expect(target.workflowService.review({ id: target.workflow.id, ownerUserId: target.ownerUserId,
      actorUserId: target.ownerUserId, expectedRevision: state.workflow.revision, outputAssetId: raw.id, decision: 'APPROVE', note: null }))
      .rejects.toMatchObject({ code: 'WORKFLOW_CONFLICT' });
    await expect(target.workflowService.review({ id: target.workflow.id, ownerUserId: target.ownerUserId,
      actorUserId: target.ownerUserId, expectedRevision: state.workflow.revision, outputAssetId: final.id, decision: 'APPROVE', note: null }))
      .resolves.toMatchObject({ reviewStatus: 'APPROVED' });
    expect(await recover()).toMatchObject({ claimed: 0 });
    expect((await target.state()).assets).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it.each(['FULL_EDIT', 'INPAINT'] as const)('executes frozen Wanx %s through the real service, database and async adapter', async (operation) => {
    const target = await fixture(operation, 'wanx');
    const initial = await target.state();
    expect(initial.job.templateSnapshot).toMatchObject({ renderingContract: { profile: 'ai-image-wanx21-edit-prompt/v1' } });
    const taskId = `synthetic-wanx-${target.jobId}`;
    const resultUrl = 'https://dashscope-test.oss-cn-beijing.aliyuncs.com/hosted-result.png';
    const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        expect(url).toBe('https://dashscope.aliyuncs.com/api/v1/services/aigc/image2image/image-synthesis');
        expect(new Headers(init.headers).get('X-DashScope-Async')).toBe('enable');
        const body = JSON.parse(String(init.body));
        expect(body.input.prompt).toBe(initial.job.resolvedPrompt);
        expect(Array.from(body.input.prompt)).toHaveLength(Array.from(initial.job.resolvedPrompt!).length);
        expect(body.input.function).toBe(operation === 'INPAINT' ? 'description_edit_with_mask' : 'description_edit');
        if (operation === 'INPAINT') {
          const bytes = Buffer.from(String(body.input.mask_image_url).split(',')[1]!, 'base64');
          const pixels = await sharp(bytes).removeAlpha().raw().toBuffer();
          expect(pixels[0]).toBe(0);
          expect(pixels[(WIDTH / 2) * 3]).toBe(255);
        }
        return json({ output: { task_id: taskId, task_status: 'PENDING' } });
      }
      if (url.endsWith(`/tasks/${taskId}`)) {
        expect((await target.state()).job.providerJobId).toBe(taskId);
        return json({ output: { task_id: taskId, task_status: 'SUCCEEDED', results: [{ url: resultUrl }],
          task_metrics: { TOTAL: 1, SUCCEEDED: 1, FAILED: 0 } }, usage: { image_count: 1 } });
      }
      expect(url).toBe(resultUrl);
      expect(new Headers(init?.headers).has('authorization')).toBe(false);
      return new Response(target.candidate, { headers: { 'content-type': 'image/png' } });
    });
    vi.stubGlobal('fetch', fetcher);
    await expect(target.execute()).resolves.toBe('completed');
    expect(fetcher.mock.calls.map((call) => call[1]?.method)).toEqual(['POST', 'GET', 'GET']);
    const state = await target.state();
    expect(state.job).toMatchObject({ status: 'SUCCEEDED', provider: 'dashscope-wanx', model: 'wanx2.1-imageedit', providerJobId: taskId });
    expect(state.reservation).toMatchObject({ status: 'SETTLED', currency: 'USD' });
    expect(state.reservation.settlements).toEqual([expect.objectContaining({ kind: 'CHARGE', actualCostMinor: 7, billedUnits: 1 })]);
    expect(state.assets).toHaveLength(2);
    const raw = state.assets.find((asset) => asset.kind === 'AI_PROVIDER_OUTPUT')!;
    const final = state.assets.find((asset) => asset.kind === 'AI_GENERATED')!;
    const expected = await sharp(operation === 'FULL_EDIT' ? target.candidate : target.source).ensureAlpha().raw().toBuffer();
    if (operation === 'INPAINT') {
      const generated = await sharp(target.candidate).ensureAlpha().raw().toBuffer();
      for (let row = 0; row < HEIGHT; row += 1) {
        const start = (row * WIDTH + WIDTH / 2) * 4;
        generated.copy(expected, start, start, (row + 1) * WIDTH * 4);
      }
    }
    expect((await sharp(target.uploaded.get(final.storageKey!)!).ensureAlpha().raw().toBuffer()).equals(expected)).toBe(true);
    expect(await database.mediaAssetLineage.count({ where: { jobId: target.jobId } })).toBe(operation === 'INPAINT' ? 4 : 2);
    await expect(target.workflowService.review({ id: target.workflow.id, ownerUserId: target.ownerUserId, actorUserId: target.ownerUserId,
      expectedRevision: state.workflow.revision, outputAssetId: raw.id, decision: 'APPROVE', note: null })).rejects.toMatchObject({ code: 'WORKFLOW_CONFLICT' });
    await expect(target.workflowService.review({ id: target.workflow.id, ownerUserId: target.ownerUserId, actorUserId: target.ownerUserId,
      expectedRevision: state.workflow.revision, outputAssetId: final.id, decision: 'APPROVE', note: null })).resolves.toMatchObject({ reviewStatus: 'APPROVED' });
    await expect(target.execute(2)).resolves.toBe('ignored');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('rejects an incompatible Wanx canvas at the repository before another quota reservation exists', async () => {
    const target = await fixture('FULL_EDIT', 'wanx');
    const before = await database.aiCostReservation.count({ where: { ownerUserId: target.ownerUserId } });
    await expect(target.workflowRepository.createImageEdit({ ...target.creationInput, width: 512, height: 512,
      idempotencyKey: `invalid-${target.jobId}` })).rejects.toMatchObject({ code: 'UNSUPPORTED_PROVIDER_EDIT_DIMENSIONS' });
    expect(await database.aiCostReservation.count({ where: { ownerUserId: target.ownerUserId } })).toBe(before);
  });

  it('retains Wanx acceptance for reconciliation when the Provider returns the wrong output dimensions', async () => {
    const target = await fixture('FULL_EDIT', 'wanx');
    const taskId = `wrong-size-${target.jobId}`;
    const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    const wrongSize = await sharp({ create: { width: 512, height: 512, channels: 3, background: '#223344' } }).png().toBuffer();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ output: { task_id: taskId, task_status: 'PENDING' } }))
      .mockResolvedValueOnce(json({ output: { task_id: taskId, task_status: 'SUCCEEDED',
        results: [{ url: 'https://dashscope-test.oss-cn-beijing.aliyuncs.com/wrong-size.png' }],
        task_metrics: { TOTAL: 1, SUCCEEDED: 1, FAILED: 0 } }, usage: { image_count: 1 } }))
      .mockResolvedValueOnce(new Response(wrongSize, { headers: { 'content-type': 'image/png' } }));
    vi.stubGlobal('fetch', fetcher);
    await expect(target.execute()).rejects.toMatchObject({ code: 'INVALID_MEDIA_INPUT' });
    const state = await target.state();
    expect(state.job).toMatchObject({ status: 'FAILED', providerJobId: taskId, billedUnits: 0 });
    expect(state.reservation).toMatchObject({ status: 'RECONCILIATION_REQUIRED', providerRequestId: taskId });
    expect(state.reservation.settlements).toEqual([expect.objectContaining({ kind: 'RECONCILIATION_REQUIRED', actualCostMinor: null })]);
    expect(state.assets).toHaveLength(0);
    expect(target.uploaded.size).toBe(0);
    await expect(target.execute(2)).resolves.toBe('ignored');
    expect(fetcher.mock.calls.map((call) => call[1]?.method)).toEqual(['POST', 'GET', 'GET']);
  });

  it('cancels during DNS with zero POSTs and exactly one released reservation', async () => {
    const target = await fixture('FULL_EDIT');
    const fetcher = vi.fn(async () => target.response());
    vi.stubGlobal('fetch', fetcher);
    vi.mocked(lookup).mockImplementationOnce(async () => {
      const { job, workflow } = await target.state();
      expect(job.status).toBe('RUNNING');
      expect(job.providerJobId).toBeNull();
      await target.workflowService.cancel(workflow.id, target.ownerUserId, target.ownerUserId, workflow.revision);
      return [{ address: '8.8.8.8', family: 4 }] as never;
    });

    await expect(target.execute()).resolves.toBe('ignored');
    expect(lookup).toHaveBeenCalledOnce();
    expect(fetcher).not.toHaveBeenCalled();
    const state = await target.state();
    expect(state.job).toMatchObject({ status: 'CANCELLED', providerJobId: null, billedUnits: 0 });
    expect(state.workflow).toMatchObject({ status: 'CANCELLED', reviewStatus: 'NOT_READY' });
    expect(state.reservation).toMatchObject({ status: 'RELEASED', currency: 'USD' });
    expect(state.reservation.settlements).toEqual([
      expect.objectContaining({ kind: 'RELEASE', actualCostMinor: 0, billedUnits: 0 }),
    ]);
    expect(state.assets).toHaveLength(0);
    expect(target.uploaded.size).toBe(0);

    await expect(target.execute(2)).resolves.toBe('ignored');
    expect(fetcher).not.toHaveBeenCalled();
    expect((await target.state()).reservation.settlements).toEqual(state.reservation.settlements);
  });

  it('retains accepted task identity when cancellation races with the first acceptance persistence failure', async () => {
    const target = await fixture('FULL_EDIT');
    const response = target.response();
    const { id: providerJobId } = await response.clone().json() as { id: string };
    const persistAcceptance = vi.spyOn(target.repository, 'recordProviderJobId')
      .mockRejectedValueOnce(new Error('Synthetic acceptance persistence I/O failure'));
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      const { workflow } = await target.state();
      await target.workflowService.cancel(workflow.id, target.ownerUserId, target.ownerUserId, workflow.revision);
      return response;
    });
    vi.stubGlobal('fetch', fetcher);

    await expect(target.execute()).resolves.toBe('ignored');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(persistAcceptance).toHaveBeenCalledExactlyOnceWith(target.jobId, providerJobId, expect.any(Date));
    const state = await target.state();
    expect(state.job).toMatchObject({ status: 'CANCELLED', providerJobId, billedUnits: 0 });
    expect(state.workflow).toMatchObject({ status: 'CANCELLED', reviewStatus: 'NOT_READY' });
    expect(state.reservation).toMatchObject({
      status: 'RECONCILIATION_REQUIRED', currency: 'USD',
      providerRequestId: providerJobId, providerAcceptedAt: expect.any(Date),
    });
    expect(state.reservation.settlements).toEqual([
      expect.objectContaining({ kind: 'RECONCILIATION_REQUIRED', actualCostMinor: null, billedUnits: 0 }),
    ]);
    expect(state.assets).toHaveLength(0);
    expect(target.uploaded.size).toBe(0);

    await expect(target.execute(2)).resolves.toBe('ignored');
    expect(fetcher).toHaveBeenCalledOnce();
    expect((await target.state()).reservation.settlements).toEqual(state.reservation.settlements);
  });

  it.each(['CANCELLED', 'FAILED'] as const)(
    'retains late Wanx acceptance after %s wins and the first identity write fails',
    async (status) => {
      const target = await fixture('FULL_EDIT', 'wanx');
      const providerJobId = `late-accepted-${target.jobId}`;
      let initialUncertainty: unknown;
      const persistAcceptance = vi.spyOn(target.repository, 'recordProviderJobId')
        .mockRejectedValueOnce(new Error('Synthetic acceptance persistence I/O failure'));
      const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
        expect(init?.method).toBe('POST');
        if (status === 'CANCELLED') {
          const { workflow } = await target.state();
          await target.workflowService.cancel(workflow.id, target.ownerUserId, target.ownerUserId, workflow.revision);
          await target.repository.markCancelled(target.jobId);
        } else {
          await target.repository.markSubmissionUncertain(target.jobId, {
            attemptCount: 1,
            errorCode: 'PROVIDER_SUBMISSION_UNCERTAIN',
            errorMessage: 'Synthetic concurrent interrupted dispatch',
            providerSubmissionUncertain: true,
          });
        }
        const beforeAcceptance = await target.state();
        expect(beforeAcceptance.job).toMatchObject({ status, providerJobId: null });
        expect(beforeAcceptance.reservation.settlements).toEqual([
          expect.objectContaining({ kind: 'SUBMISSION_UNCERTAIN', actualCostMinor: null, billedUnits: 0 }),
        ]);
        initialUncertainty = beforeAcceptance.reservation.settlements[0];
        return jsonResponse({ output: { task_id: providerJobId, task_status: 'PENDING' } });
      });
      vi.stubGlobal('fetch', fetcher);

      if (status === 'CANCELLED') await expect(target.execute()).resolves.toBe('ignored');
      else await expect(target.execute()).rejects.toMatchObject({ code: 'PROVIDER_ACCEPTED_PERSISTENCE_FAILED' });

      expect(fetcher).toHaveBeenCalledOnce();
      expect(persistAcceptance).toHaveBeenCalledExactlyOnceWith(target.jobId, providerJobId, expect.any(Date));
      const state = await target.state();
      expect(state.job).toMatchObject({ status, providerJobId, billedUnits: 0 });
      expect(state.workflow).toMatchObject({ status, reviewStatus: 'NOT_READY' });
      expect(state.reservation).toMatchObject({
        status: 'RECONCILIATION_REQUIRED', currency: 'USD',
        providerRequestId: providerJobId, providerAcceptedAt: expect.any(Date),
      });
      // Late identity refines the unresolved outcome; it must not erase the
      // original uncertainty record or add a charge/release settlement.
      expect(state.reservation.settlements).toHaveLength(2);
      expect(state.reservation.settlements).toContainEqual(initialUncertainty);
      expect(state.reservation.settlements).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'SUBMISSION_UNCERTAIN', actualCostMinor: null, billedUnits: 0 }),
        expect.objectContaining({ kind: 'RECONCILIATION_REQUIRED', actualCostMinor: null, billedUnits: 0 }),
      ]));
      expect(state.assets).toHaveLength(0);
      expect(target.uploaded.size).toBe(0);

      await expect(target.execute(2)).resolves.toBe('ignored');
      expect(fetcher).toHaveBeenCalledOnce();
      expect((await target.state()).reservation.settlements).toEqual(state.reservation.settlements);
    },
  );

  it.each(['FULL_EDIT', 'INPAINT'] as const)(
    'persists one raw image, one reviewable %s candidate and one USD charge through the real owners',
    async (operation) => {
      const target = await fixture(operation);
      const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
        expect(url).toBe('https://api.openai.com/v1/images/edits');
        expect(init?.method).toBe('POST');
        expect(init?.redirect).toBe('error');
        const form = init?.body as FormData;
        expect(form).toBeInstanceOf(FormData);
        expect(digest(Buffer.from(await (form.get('image') as Blob).arrayBuffer()))).toBe(digest(target.source));
        if (operation === 'INPAINT') {
          const sentMask = await sharp(Buffer.from(await (form.get('mask') as Blob).arrayBuffer()))
            .ensureAlpha().raw().toBuffer();
          expect(sentMask[3]).toBe(255);
          expect(sentMask[(WIDTH / 2) * 4 + 3]).toBe(0);
        } else {
          expect(form.has('mask')).toBe(false);
        }
        return target.response();
      });
      vi.stubGlobal('fetch', fetcher);

      await expect(target.execute()).resolves.toBe('completed');
      expect(fetcher).toHaveBeenCalledOnce();
      const state = await target.state();
      expect(state.job).toMatchObject({ status: 'SUCCEEDED', actualCostCents: 7, billedUnits: 1 });
      expect(state.job.providerJobId).toMatch(/^synthetic-request-/u);
      expect(state.workflow).toMatchObject({ status: 'SUCCEEDED', reviewStatus: 'PENDING', selectedOutputAssetId: null });
      expect(state.reservation).toMatchObject({ status: 'SETTLED', currency: 'USD' });
      expect(state.reservation.settlements).toEqual([
        expect.objectContaining({ kind: 'CHARGE', actualCostMinor: 7, billedUnits: 1 }),
      ]);
      expect(state.assets).toHaveLength(2);
      const raw = state.assets.find((asset) => asset.kind === 'AI_PROVIDER_OUTPUT')!;
      const final = state.assets.find((asset) => asset.kind === 'AI_GENERATED')!;
      expect(raw).toMatchObject({
        kind: 'AI_PROVIDER_OUTPUT', ownerUserId: target.ownerUserId, aiImageJobId: target.jobId,
        sha256: digest(target.candidate),
      });
      expect(final).toMatchObject({
        kind: 'AI_GENERATED', ownerUserId: target.ownerUserId, aiImageJobId: target.jobId,
        sourceCaptureSnapshotId: target.snapshotId, width: WIDTH, height: HEIGHT,
        metadata: { providerOutputAssetId: raw.id, pixelOrientationNormalized: true },
      });
      const frozenInputs = [
        { assetId: target.sourceAssetId, role: 'REFERENCE', ordinal: 0, assetSha256: digest(target.source) },
        ...(operation === 'INPAINT'
          ? [{ assetId: target.maskAssetId, role: 'MASK', ordinal: 0, assetSha256: digest(target.mask) }]
          : []),
      ];
      expect(state.workflow.inputs).toHaveLength(frozenInputs.length);
      expect(state.workflow.inputs).toEqual(expect.arrayContaining(frozenInputs.map((input) => (
        expect.objectContaining({ ...input, ownerUserId: target.ownerUserId, workflowId: target.workflow.id })
      ))));
      // Raw output provenance is carried by lineage, not by candidate source eligibility.
      const lineage = await database.mediaAssetLineage.findMany({
        where: { jobId: target.jobId },
        select: {
          ownerUserId: true, workflowId: true, jobId: true, operation: true,
          inputAssetId: true, outputAssetId: true, inputRole: true, ordinal: true,
        },
      });
      const expectedLineage = [raw.id, final.id].flatMap((outputAssetId) => frozenInputs.map((input) => ({
        ownerUserId: target.ownerUserId,
        workflowId: target.workflow.id,
        jobId: target.jobId,
        operation,
        inputAssetId: input.assetId,
        outputAssetId,
        inputRole: input.role,
        ordinal: input.ordinal,
      })));
      expect(lineage).toHaveLength(expectedLineage.length);
      expect(lineage).toEqual(expect.arrayContaining(expectedLineage));
      const finalBuffer = target.uploaded.get(final.storageKey!)!;
      const finalPixels = await sharp(finalBuffer).ensureAlpha().raw().toBuffer();
      const candidatePixels = await sharp(target.candidate).ensureAlpha().raw().toBuffer();
      const expectedPixels = operation === 'FULL_EDIT'
        ? candidatePixels
        : await sharp(target.source).ensureAlpha().raw().toBuffer();
      if (operation === 'INPAINT') {
        for (let row = 0; row < HEIGHT; row += 1) {
          const start = (row * WIDTH + WIDTH / 2) * 4;
          candidatePixels.copy(expectedPixels, start, start, (row + 1) * WIDTH * 4);
        }
      }
      expect(finalPixels.equals(expectedPixels)).toBe(true);
      expect(digest(finalBuffer)).toBe(final.sha256);
      expect(JSON.stringify(state)).not.toContain(runtime.apiKey);

      await expect(target.workflowService.review({
        id: target.workflow.id, ownerUserId: target.ownerUserId, actorUserId: target.ownerUserId,
        expectedRevision: state.workflow.revision, outputAssetId: raw.id, decision: 'APPROVE', note: null,
      })).rejects.toMatchObject({ code: 'WORKFLOW_CONFLICT' });
      await expect(target.workflowService.review({
        id: target.workflow.id, ownerUserId: target.ownerUserId, actorUserId: target.ownerUserId,
        expectedRevision: state.workflow.revision, outputAssetId: final.id, decision: 'APPROVE', note: null,
      })).resolves.toMatchObject({ reviewStatus: 'APPROVED', selectedOutputAssetId: final.id });
      await expect(target.execute(2)).resolves.toBe('ignored');
      expect(fetcher).toHaveBeenCalledOnce();
      const replayed = await target.state();
      expect(replayed.assets).toHaveLength(2);
      expect(replayed.reservation.settlements).toEqual(state.reservation.settlements);
    },
  );

  it('retains one uncertain submission after a lost response and blocks automatic or explicit retry', async () => {
    const target = await fixture('FULL_EDIT');
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      throw new TypeError('Synthetic response connection loss');
    });
    vi.stubGlobal('fetch', fetcher);

    await expect(target.execute()).rejects.toMatchObject({ providerSubmissionUncertain: true });
    expect(fetcher).toHaveBeenCalledOnce();
    const state = await target.state();
    expect(state.job).toMatchObject({
      status: 'FAILED', errorCode: 'PROVIDER_SUBMISSION_UNCERTAIN', providerJobId: null,
      providerReconciliationStatus: 'MANUAL_REVIEW', billedUnits: 0,
    });
    expect(state.workflow).toMatchObject({ status: 'FAILED', reviewStatus: 'NOT_READY' });
    expect(state.reservation).toMatchObject({ status: 'SUBMISSION_UNCERTAIN', currency: 'USD' });
    expect(state.reservation.settlements).toEqual([
      expect.objectContaining({ kind: 'SUBMISSION_UNCERTAIN', actualCostMinor: null, billedUnits: 0 }),
    ]);
    expect(state.assets).toHaveLength(0);
    await expect(target.execute(2)).resolves.toBe('ignored');
    await expect(target.workflowService.retry({
      id: target.workflow.id, ownerUserId: target.ownerUserId, actorUserId: target.ownerUserId,
      expectedRevision: state.workflow.revision, idempotencyKey: `retry-${target.jobId}`,
      dailyLimit: 20, globalDailyBudgetCents: 1_000_000,
    })).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' });
    expect(fetcher).toHaveBeenCalledOnce();
    expect((await target.state()).reservation.settlements).toEqual(state.reservation.settlements);
  });
});
