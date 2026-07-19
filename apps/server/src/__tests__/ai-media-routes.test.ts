import Fastify, { type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { aiImageRoutes, resolveAiImageToImageReadiness } from '../routes/ai-images.js';
import { AiMediaWorkflowError, type AiMediaWorkflowRecord } from '../services/ai-media-workflows.js';

const workflow: AiMediaWorkflowRecord = {
  id: 'workflow-1', ownerUserId: 'owner-1', actorUserId: 'actor-1',
  operation: 'IMAGE_TO_IMAGE', status: 'QUEUED', reviewStatus: 'NOT_READY',
  revision: 1, currentAttempt: 1, contextType: 'collect', contextId: 'goods-1',
  contextSkuKey: null, contextSlotKey: null, idempotencyKey: 'workflow-idem-1',
  requestFingerprint: 'secret-fingerprint', selectedOutputAssetId: null,
  createdAt: new Date(), updatedAt: new Date(), completedAt: null,
  inputs: [{ id: 'input-1', assetId: 'asset-1', role: 'REFERENCE', ordinal: 0, assetUrl: '/images/source.png', mimeType: 'image/png', asset: { storageKey: 'secret-key' } }],
  jobs: [{
    id: 'job-1', ownerUserId: 'owner-1', workflowId: 'workflow-1', status: 'SUCCEEDED',
    prompt: 'Keep product', costReservation: { status: 'RELEASED', maximumCostMinor: 99 },
    assets: [{ id: 'output-1', url: '/output.png', storageKey: 'secret-output-key', storageBackend: 'oss' }],
  }], events: [],
};

function jobRepository() {
  return {
    getById: vi.fn(async () => ({
      id: 'job-1', ownerUserId: 'owner-1', workflowId: 'workflow-1', status: 'SUCCEEDED',
      assets: [{ id: 'output-1', url: '/output.png' }],
    })),
    createWithQuota: vi.fn(), requestCancellation: vi.fn(), recordApplication: vi.fn(async () => ({
      id: 'job-1', ownerUserId: 'owner-1', status: 'SUCCEEDED', appliedMode: 'append', assets: [],
    })),
    markRunning: vi.fn(), markRetrying: vi.fn(), markFailed: vi.fn(),
    markEnqueueFailed: vi.fn(async () => true), markCancelled: vi.fn(), complete: vi.fn(),
  } as any;
}

async function build(
  enabled = true,
  ownerUserId = 'owner-1',
  translationEnabled = false,
  translationProvider = 'fake',
  webMediaEnabled = true,
  production = false,
  translationStorageReady = true,
  translationStorageBackend: 'oss' | 'local' | 'ozon-cdn' = 'oss',
  translationStoragePublicHttps = true,
) {
  const mediaWorkflowService = {
    createImageToImage: vi.fn(async () => ({ workflow, jobId: 'job-1', replayed: false })),
    createImageTranslation: vi.fn(async () => ({
      workflow: { ...workflow, operation: 'IMAGE_TRANSLATE' as const }, jobId: 'job-translation-1', replayed: false,
    })),
    list: vi.fn(async () => [workflow]),
    get: vi.fn(async (_id: string, owner: string) => {
      if (owner !== 'owner-1') throw new AiMediaWorkflowError('NOT_FOUND', 'not found');
      return workflow;
    }),
    cancel: vi.fn(async () => ({ ...workflow, status: 'CANCELLED' as const })),
    retry: vi.fn(async () => ({ workflow, jobId: 'job-2', replayed: false })),
    review: vi.fn(async () => ({ ...workflow, status: 'SUCCEEDED' as const, reviewStatus: 'APPROVED' as const })),
  };
  const mediaContextService = {
    loadCollect: vi.fn(async () => ({
      target: { type: 'collect' as const, id: 'goods-1', label: 'Product' },
      snapshot: { id: 'snapshot-1', version: 1, captureHash: 'hash-1' },
      inputs: [{ sourceMediaKey: 'main-1', role: 'main', sourceUrl: 'https://source.example/main.jpg', assetId: 'asset-1', assetUrl: 'https://cdn.example/main.jpg', mimeType: 'image/jpeg', width: 1000, height: 1000 }],
    })),
    internalizeCollect: vi.fn(async () => ({ id: 'asset-1', url: 'https://cdn.example/main.jpg', mimeType: 'image/jpeg', width: 1000, height: 1000 })),
  };
  const enqueue = vi.fn(async () => undefined);
  const enqueueTranslation = vi.fn(async () => undefined);
  const applyAssets = vi.fn(async (input: any) => ({
    jobId: input.jobId,
    mode: input.mode,
    targetType: input.targetType,
    targetId: input.targetId,
    images: [],
    mainImage: null,
    editedImages: [],
    targetUpdatedAt: new Date(),
    appliedAt: new Date(),
  }));
  const repository = jobRepository();
  const app = Fastify();
  await app.register(aiImageRoutes, {
    repository, mediaWorkflowService, mediaContextService, enqueue, enqueueTranslation, applyAssets,
    getTranslationSettings: async () => ({
      enabled: translationEnabled, provider: translationEnabled ? translationProvider : 'disabled',
      model: translationProvider === 'fake' ? 'fake-image-translation-v1' : 'qwen-mt-image',
      dailyLimit: 20, estimatedCostCents: 0,
    }),
    resolveTranslationPrompt: async () => ({
      templateKey: 'image-translation.base',
      release: { id: 'translation-release-1', revisionId: 'translation-revision-1', sequence: 1 },
      checksum: 'a'.repeat(64),
      snapshot: { templateKey: 'image-translation.base', sequence: 1 },
      resolvedPrompt: 'Frozen translation domain policy',
      resolvedNegativePrompt: 'Frozen terminology policy',
    } as any),
    getSourceListingWebMediaEnabled: async () => webMediaEnabled,
    getTranslationStorageReadiness: async () => ({
      ready: translationStorageReady,
      backend: translationStorageBackend,
      publicHttps: translationStoragePublicHttps,
      reason: translationStorageReady
        ? 'Image translation storage is ready'
        : 'Image translation requires OSS or local storage because no shop context is frozen',
    }),
    production,
    getMediaWorkflowEnabled: async () => enabled,
    authenticate: async (request: FastifyRequest) => {
      (request as any).user = { userId: ownerUserId, actorUserId: 'actor-1' };
    },
  });
  return {
    app, repository, mediaWorkflowService, mediaContextService,
    enqueue, enqueueTranslation, applyAssets,
  };
}

describe('AI media workflow routes', () => {
  it('reports owner-scoped Web operation readiness without exposing provider secrets', async () => {
    const { app } = await build(true, 'owner-1', true);
    const response = await app.inject({ method: 'GET', url: '/capabilities' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        webMediaEnabled: true,
        workflowEnabled: true,
        operations: {
          IMAGE_TO_IMAGE: { enabled: true, ready: true, reasonCode: 'READY' },
          IMAGE_TRANSLATE: { enabled: true, ready: true, reasonCode: 'READY' },
        },
      },
    });
    expect(JSON.stringify(response.json())).not.toContain('apiKey');
  });

  it('keeps paid image translation unavailable until sandbox evidence is verified', async () => {
    const { app } = await build(true, 'owner-1', true, 'dashscope-qwen-mt-image');
    const response = await app.inject({ method: 'GET', url: '/capabilities' });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.operations.IMAGE_TRANSLATE).toMatchObject({
      enabled: true,
      ready: false,
      reasonCode: 'PROVIDER_NOT_READY',
    });
  });

  it('rejects paid image translation when storage is local instead of owned public HTTPS OSS', async () => {
    const { app, mediaWorkflowService, enqueueTranslation } = await build(
      true,
      'owner-1',
      true,
      'dashscope-qwen-mt-image',
      true,
      false,
      true,
      'local',
      false,
    );
    const capabilities = await app.inject({ method: 'GET', url: '/capabilities' });
    const create = await app.inject({ method: 'POST', url: '/workflows', payload: {
      operation: 'IMAGE_TRANSLATE', sourceAssetId: 'asset-1',
      idempotencyKey: 'paid-translation-local-storage', context: { type: 'collect', id: 'goods-1' },
    } });

    expect(capabilities.json().data.operations.IMAGE_TRANSLATE).toMatchObject({
      ready: false,
      reasonCode: 'STORAGE_NOT_READY',
    });
    expect(create.statusCode).toBe(503);
    expect(create.json()).toMatchObject({ code: 'STORAGE_NOT_READY' });
    expect(mediaWorkflowService.createImageTranslation).not.toHaveBeenCalled();
    expect(enqueueTranslation).not.toHaveBeenCalled();
  });

  it('reports and enforces an incompatible translation storage backend before enqueue', async () => {
    const { app, mediaWorkflowService, enqueueTranslation } = await build(
      true,
      'owner-1',
      true,
      'fake',
      true,
      false,
      false,
    );
    const capabilities = await app.inject({ method: 'GET', url: '/capabilities' });
    const create = await app.inject({ method: 'POST', url: '/workflows', payload: {
      operation: 'IMAGE_TRANSLATE', sourceAssetId: 'asset-1',
      idempotencyKey: 'translation-storage-off', context: { type: 'collect', id: 'goods-1' },
    } });

    expect(capabilities.json().data.operations.IMAGE_TRANSLATE).toMatchObject({
      enabled: true,
      ready: false,
      reasonCode: 'STORAGE_NOT_READY',
    });
    expect(create.statusCode).toBe(503);
    expect(create.json()).toMatchObject({ code: 'STORAGE_NOT_READY' });
    expect(mediaWorkflowService.createImageTranslation).not.toHaveBeenCalled();
    expect(enqueueTranslation).not.toHaveBeenCalled();
  });

  it('keeps the fake image-to-image lifecycle unavailable in production', () => {
    expect(resolveAiImageToImageReadiness({ workflowEnabled: true, production: true })).toMatchObject({
      enabled: true,
      ready: false,
      reasonCode: 'PROVIDER_NOT_READY',
      testOnly: true,
    });
    expect(resolveAiImageToImageReadiness({ workflowEnabled: true, production: false })).toMatchObject({
      ready: true,
      testOnly: true,
    });
  });

  it('does not review or apply historical fake workflow candidates in production', async () => {
    const { app, repository, mediaWorkflowService } = await build(
      true,
      'owner-1',
      true,
      'fake',
      true,
      true,
    );
    mediaWorkflowService.get.mockResolvedValueOnce({
      ...workflow,
      status: 'SUCCEEDED',
      reviewStatus: 'PENDING',
      jobs: [{ id: 'job-1', provider: 'fake', assets: [{ id: 'output-1', url: '/output.png' }] }],
    });
    const review = await app.inject({ method: 'POST', url: '/workflows/workflow-1/review', payload: {
      expectedRevision: 1, outputAssetId: 'output-1', decision: 'APPROVE',
    } });
    repository.getById.mockResolvedValueOnce({
      id: 'job-1', ownerUserId: 'owner-1', workflowId: 'workflow-1', operation: 'IMAGE_TO_IMAGE',
      provider: 'fake', status: 'SUCCEEDED', assets: [{ id: 'output-1', url: '/output.png' }],
    } as any);
    const apply = await app.inject({ method: 'POST', url: '/jobs/job-1/apply', payload: {
      mode: 'append', targetType: 'collect', targetId: 'goods-1',
    } });

    expect(review.statusCode).toBe(503);
    expect(apply.statusCode).toBe(503);
    expect(review.json()).toMatchObject({ code: 'PROVIDER_NOT_READY' });
    expect(apply.json()).toMatchObject({ code: 'PROVIDER_NOT_READY' });
    expect(mediaWorkflowService.review).not.toHaveBeenCalled();
  });

  it('gates Web media create, retry and internalization by the owner rollout decision', async () => {
    const { app, mediaWorkflowService, mediaContextService, enqueue } = await build(
      true,
      'owner-1',
      true,
      'fake',
      false,
    );
    const create = await app.inject({ method: 'POST', url: '/workflows', payload: {
      operation: 'IMAGE_TO_IMAGE', sourceAssetId: 'asset-1', prompt: 'Keep product',
      idempotencyKey: 'web-media-disabled-create', context: { type: 'collect', id: 'goods-1' },
    } });
    const retry = await app.inject({ method: 'POST', url: '/workflows/workflow-1/retry', payload: {
      expectedRevision: 1, idempotencyKey: 'web-media-disabled-retry',
    } });
    const internalize = await app.inject({
      method: 'POST',
      url: '/contexts/collect/goods-1/internalize',
      payload: { sourceMediaKey: 'main-1' },
    });

    for (const response of [create, retry, internalize]) {
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ code: 'SOURCE_LISTING_WEB_MEDIA_DISABLED' });
    }
    expect(mediaWorkflowService.createImageToImage).not.toHaveBeenCalled();
    expect(mediaWorkflowService.retry).not.toHaveBeenCalled();
    expect(mediaContextService.internalizeCollect).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('creates and enqueues a gated IMAGE_TRANSLATE workflow with frozen language options', async () => {
    const { app, mediaWorkflowService, enqueueTranslation } = await build(true, 'owner-1', true);
    const response = await app.inject({ method: 'POST', url: '/workflows', payload: {
      operation: 'IMAGE_TRANSLATE', sourceAssetId: 'asset-1',
      sourceLanguage: 'zh', targetLanguage: 'ru',
      domainHint: 'Translate concise product banner copy',
      terminologies: [{ src: 'piano black', tgt: 'glossy black' }],
      idempotencyKey: 'translation-idem-1', context: { type: 'collect', id: 'goods-1' },
    } });
    expect(response.statusCode).toBe(202);
    expect(mediaWorkflowService.createImageTranslation).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 'owner-1', sourceAssetId: 'asset-1', sourceLanguage: 'zh', targetLanguage: 'ru',
      domainHint: expect.stringContaining('Frozen translation domain policy'),
      terminologies: [{ src: 'piano black', tgt: 'glossy black' }], provider: 'fake',
      templateKey: 'image-translation.base', templateReleaseId: 'translation-release-1',
    }));
    expect(enqueueTranslation).toHaveBeenCalledWith('job-translation-1');
  });

  it('does not create a translation workflow while its operation gate is disabled', async () => {
    const { app, mediaWorkflowService, enqueueTranslation } = await build(true, 'owner-1', false);
    const response = await app.inject({ method: 'POST', url: '/workflows', payload: {
      operation: 'IMAGE_TRANSLATE', sourceAssetId: 'asset-1', idempotencyKey: 'translation-idem-off',
      context: { type: 'collect', id: 'goods-1' },
    } });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'AI_MEDIA_OPERATION_DISABLED' });
    expect(mediaWorkflowService.createImageTranslation).not.toHaveBeenCalled();
    expect(enqueueTranslation).not.toHaveBeenCalled();
  });

  it('keeps an adapter-characterized paid translation provider behind the sandbox gate', async () => {
    const { app, mediaWorkflowService, enqueueTranslation } = await build(
      true,
      'owner-1',
      true,
      'dashscope-qwen-mt-image',
    );
    const response = await app.inject({ method: 'POST', url: '/workflows', payload: {
      operation: 'IMAGE_TRANSLATE', sourceAssetId: 'asset-1', idempotencyKey: 'translation-idem-paid',
      context: { type: 'collect', id: 'goods-1' },
    } });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'PROVIDER_NOT_READY' });
    expect(mediaWorkflowService.createImageTranslation).not.toHaveBeenCalled();
    expect(enqueueTranslation).not.toHaveBeenCalled();
  });

  it('rejects same-language translation and duplicate terminology before persistence', async () => {
    const { app, mediaWorkflowService } = await build(true, 'owner-1', true);
    const response = await app.inject({ method: 'POST', url: '/workflows', payload: {
      operation: 'IMAGE_TRANSLATE', sourceAssetId: 'asset-1', sourceLanguage: 'zh', targetLanguage: 'ZH',
      terminologies: [{ src: 'A', tgt: 'a' }, { src: 'a', tgt: 'b' }],
      idempotencyKey: 'translation-idem-invalid', context: { type: 'collect', id: 'goods-1' },
    } });
    expect(response.statusCode).toBe(400);
    expect(mediaWorkflowService.createImageTranslation).not.toHaveBeenCalled();
  });

  it('creates and enqueues a feature-gated IMAGE_TO_IMAGE workflow', async () => {
    const { app, mediaWorkflowService, enqueue } = await build();
    const response = await app.inject({ method: 'POST', url: '/workflows', payload: {
      operation: 'IMAGE_TO_IMAGE', sourceAssetId: 'asset-1', prompt: 'Keep product',
      count: 1, width: 1024, height: 1024, idempotencyKey: 'workflow-idem-1',
      context: { type: 'collect', id: 'goods-1' },
    } });
    expect(response.statusCode).toBe(202);
    expect(mediaWorkflowService.createImageToImage).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 'owner-1', actorUserId: 'actor-1', sourceAssetId: 'asset-1',
    }));
    expect(enqueue).toHaveBeenCalledWith('job-1');
    expect(response.json().data).not.toHaveProperty('requestFingerprint');
    expect(JSON.stringify(response.json())).not.toContain('secret-key');
    expect(JSON.stringify(response.json())).not.toContain('secret-output-key');
    expect(response.json().data.jobs[0]).toMatchObject({ costStatus: 'RELEASED' });
    expect(response.json().data.jobs[0]).not.toHaveProperty('costReservation');
    expect(JSON.stringify(response.json())).not.toContain('maximumCostMinor');
  });

  it('compensates a workflow that could not be enqueued', async () => {
    const { app, repository, enqueue } = await build();
    enqueue.mockRejectedValueOnce(new Error('queue offline'));

    const response = await app.inject({ method: 'POST', url: '/workflows', payload: {
      operation: 'IMAGE_TO_IMAGE', sourceAssetId: 'asset-1', prompt: 'Keep product',
      count: 1, width: 1024, height: 1024, idempotencyKey: 'workflow-idem-offline',
      context: { type: 'collect', id: 'goods-1' },
    } });

    expect(response.statusCode).toBe(503);
    expect(repository.markEnqueueFailed).toHaveBeenCalledWith('job-1', expect.objectContaining({
      errorCode: 'QUEUE_UNAVAILABLE',
    }));
  });

  it('accepts ordered references while preserving the legacy single-reference request', async () => {
    const { app, mediaWorkflowService, enqueue } = await build();
    const response = await app.inject({ method: 'POST', url: '/workflows', payload: {
      operation: 'IMAGE_TO_IMAGE',
      references: [{ assetId: 'asset-1' }, { assetId: 'asset-2' }],
      prompt: 'Keep product identity from both references',
      count: 1, width: 1024, height: 1024, idempotencyKey: 'workflow-idem-multi',
      context: { type: 'collect', id: 'goods-1' },
    } });
    expect(response.statusCode).toBe(202);
    expect(mediaWorkflowService.createImageToImage).toHaveBeenCalledWith(expect.objectContaining({
      sourceAssetId: undefined,
      references: [{ assetId: 'asset-1' }, { assetId: 'asset-2' }],
    }));
    expect(enqueue).toHaveBeenCalledWith('job-1');
  });

  it('rejects ambiguous legacy and references payloads', async () => {
    const { app, mediaWorkflowService, enqueue } = await build();
    const response = await app.inject({ method: 'POST', url: '/workflows', payload: {
      operation: 'IMAGE_TO_IMAGE', sourceAssetId: 'asset-1',
      references: [{ assetId: 'asset-2' }], prompt: 'Ambiguous inputs',
      idempotencyKey: 'workflow-idem-ambiguous', context: { type: 'collect', id: 'goods-1' },
    } });
    expect(response.statusCode).toBe(400);
    expect(mediaWorkflowService.createImageToImage).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('returns a conflict for duplicate immutable reference content', async () => {
    const { app, mediaWorkflowService, enqueue } = await build();
    mediaWorkflowService.createImageToImage.mockRejectedValueOnce(
      Object.assign(new Error('Source references must have unique content'), { code: 'SOURCE_ASSET_DUPLICATE' }),
    );
    const response = await app.inject({ method: 'POST', url: '/workflows', payload: {
      operation: 'IMAGE_TO_IMAGE', references: [{ assetId: 'asset-1' }, { assetId: 'asset-2' }],
      prompt: 'Use both views', idempotencyKey: 'workflow-idem-duplicate-content',
      context: { type: 'collect', id: 'goods-1' },
    } });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'SOURCE_ASSET_DUPLICATE' });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('fails closed when the workflow feature is disabled', async () => {
    const { app, mediaWorkflowService } = await build(false);
    const response = await app.inject({ method: 'POST', url: '/workflows', payload: {
      operation: 'IMAGE_TO_IMAGE', sourceAssetId: 'asset-1', prompt: 'Keep product',
      idempotencyKey: 'workflow-idem-1',
      context: { type: 'collect', id: 'goods-1' },
    } });
    expect(response.statusCode).toBe(503);
    expect(mediaWorkflowService.createImageToImage).not.toHaveBeenCalled();
  });

  it('does not create or enqueue a retry while the tenant rollout is disabled', async () => {
    const { app, mediaWorkflowService, enqueue } = await build(false);
    const response = await app.inject({
      method: 'POST',
      url: '/workflows/workflow-1/retry',
      payload: { expectedRevision: 2, idempotencyKey: 'retry-idem-disabled' },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'AI_MEDIA_WORKFLOW_DISABLED' });
    expect(mediaWorkflowService.retry).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('checks the translation operation gate before creating a retry attempt', async () => {
    const { app, mediaWorkflowService, enqueueTranslation } = await build(true, 'owner-1', false);
    mediaWorkflowService.get.mockResolvedValueOnce({
      ...workflow,
      operation: 'IMAGE_TRANSLATE' as any,
      jobs: [{ provider: 'fake', model: 'fake-image-translation-v1' }],
    });
    const response = await app.inject({
      method: 'POST',
      url: '/workflows/workflow-1/retry',
      payload: { expectedRevision: 2, idempotencyKey: 'translation-retry-disabled' },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'AI_MEDIA_OPERATION_DISABLED' });
    expect(mediaWorkflowService.retry).not.toHaveBeenCalled();
    expect(enqueueTranslation).not.toHaveBeenCalled();
  });

  it('returns 429 when a translation retry exceeds its daily quota', async () => {
    const { app, mediaWorkflowService, enqueueTranslation } = await build(true, 'owner-1', true);
    mediaWorkflowService.get.mockResolvedValueOnce({
      ...workflow,
      operation: 'IMAGE_TRANSLATE' as any,
      jobs: [{ provider: 'fake', model: 'fake-image-translation-v1', estimatedCostCents: 0 }],
    });
    mediaWorkflowService.retry.mockRejectedValueOnce(
      new AiMediaWorkflowError('IMAGE_TRANSLATION_QUOTA_EXCEEDED', 'quota exceeded'),
    );
    const response = await app.inject({
      method: 'POST', url: '/workflows/workflow-1/retry',
      payload: { expectedRevision: 2, idempotencyKey: 'translation-retry-quota' },
    });
    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({ code: 'IMAGE_TRANSLATION_QUOTA_EXCEEDED' });
    expect(enqueueTranslation).not.toHaveBeenCalled();
  });

  it('reports a disabled read context without surfacing a transport error', async () => {
    const { app, mediaContextService } = await build(false);
    const response = await app.inject({ method: 'GET', url: '/contexts/collect/goods-1' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ code: 0, msg: 'AI media workflow is disabled' });
    expect(mediaContextService.loadCollect).not.toHaveBeenCalled();
  });

  it('lists owner-scoped contextual workflow history', async () => {
    const { app, mediaWorkflowService } = await build();
    const response = await app.inject({ method: 'GET', url: '/workflows?contextType=collect&contextId=goods-1&limit=10' });
    expect(response.statusCode).toBe(200);
    expect(mediaWorkflowService.list).toHaveBeenCalledWith({
      ownerUserId: 'owner-1', contextType: 'collect', contextId: 'goods-1', limit: 10,
    });
    expect(response.json().data).toHaveLength(1);
  });

  it('returns safe translation metadata while keeping the frozen operation config private', async () => {
    const { app, mediaWorkflowService } = await build(true, 'owner-1', true);
    mediaWorkflowService.list.mockResolvedValueOnce([{
      ...workflow,
      operation: 'IMAGE_TRANSLATE' as any,
      jobs: [{
        id: 'translation-job-1', operation: 'IMAGE_TRANSLATE', status: 'SUCCEEDED',
        operationConfig: {
          sourceLanguage: 'zh', targetLanguage: 'ru', policyVersion: 'ai-image-translation-policy/1.0',
          terminologies: [{ src: '钢琴黑', tgt: 'глянцевый черный' }],
          domainHint: 'private compiled provider policy',
        },
        assets: [],
      }],
    }]);

    const response = await app.inject({ method: 'GET', url: '/workflows?contextType=collect&contextId=goods-1' });
    expect(response.json().data[0].jobs[0].translation).toEqual({
      sourceLanguage: 'zh', targetLanguage: 'ru', policyVersion: 'ai-image-translation-policy/1.0',
      terminologies: [{ src: '钢琴黑', tgt: 'глянцевый черный' }],
    });
    expect(response.json().data[0].jobs[0]).not.toHaveProperty('operationConfig');
    expect(JSON.stringify(response.json())).not.toContain('private compiled provider policy');
  });

  it('does not expose another tenant workflow', async () => {
    const { app } = await build(true, 'owner-2');
    const response = await app.inject({ method: 'GET', url: '/workflows/workflow-1' });
    expect(response.statusCode).toBe(404);
  });

  it('uses workflow revision CAS for review and retry', async () => {
    const { app, mediaWorkflowService, enqueue } = await build();
    const reviewed = await app.inject({ method: 'POST', url: '/workflows/workflow-1/review', payload: {
      expectedRevision: 3, outputAssetId: 'output-1', decision: 'APPROVE', note: 'usable',
    } });
    expect(reviewed.statusCode).toBe(200);
    expect(mediaWorkflowService.review).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 3 }));

    const retried = await app.inject({ method: 'POST', url: '/workflows/workflow-1/retry', payload: {
      expectedRevision: 4, idempotencyKey: 'retry-idem-1',
    } });
    expect(retried.statusCode).toBe(202);
    expect(enqueue).toHaveBeenCalledWith('job-2');
  });

  it('keeps suite child workflows behind the suite-level lifecycle contract', async () => {
    const { app, repository, mediaWorkflowService, enqueue, applyAssets } = await build();
    mediaWorkflowService.get.mockResolvedValue({ ...workflow, suiteId: 'suite-1' });
    repository.getById.mockResolvedValue({
      id: 'job-1',
      ownerUserId: 'owner-1',
      workflowId: 'workflow-1',
      status: 'SUCCEEDED',
      prompt: 'frozen suite prompt must not leak',
      workflow: { suiteSlot: { suiteId: 'suite-1', ownerUserId: 'owner-1' } },
      assets: [],
    });

    const jobDetail = await app.inject({ method: 'GET', url: '/jobs/job-1' });
    expect(jobDetail.statusCode).toBe(409);
    expect(jobDetail.json()).toMatchObject({ code: 'INVALID_STATE' });
    expect(jobDetail.body).not.toContain('frozen suite prompt');

    const detail = await app.inject({ method: 'GET', url: '/workflows/workflow-1' });
    expect(detail.statusCode).toBe(409);
    expect(detail.json()).toMatchObject({ code: 'WORKFLOW_CONFLICT' });
    expect(detail.body).not.toContain('prompt');

    const cancel = await app.inject({ method: 'POST', url: '/workflows/workflow-1/cancel', payload: {
      expectedRevision: 1,
    } });
    expect(cancel.statusCode).toBe(409);
    expect(cancel.json()).toMatchObject({ code: 'WORKFLOW_CONFLICT' });
    expect(mediaWorkflowService.cancel).not.toHaveBeenCalled();

    const retry = await app.inject({ method: 'POST', url: '/workflows/workflow-1/retry', payload: {
      expectedRevision: 1, idempotencyKey: 'suite-child-retry-blocked',
    } });
    expect(retry.statusCode).toBe(409);
    expect(retry.json()).toMatchObject({ code: 'WORKFLOW_CONFLICT' });
    expect(mediaWorkflowService.retry).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();

    const review = await app.inject({ method: 'POST', url: '/workflows/workflow-1/review', payload: {
      expectedRevision: 1, outputAssetId: 'output-1', decision: 'APPROVE',
    } });
    expect(review.statusCode).toBe(409);
    expect(review.json()).toMatchObject({ code: 'WORKFLOW_CONFLICT' });
    expect(mediaWorkflowService.review).not.toHaveBeenCalled();

    const apply = await app.inject({ method: 'POST', url: '/jobs/job-1/apply', payload: {
      mode: 'append', targetType: 'collect', targetId: 'goods-1',
    } });
    expect(apply.statusCode).toBe(400);
    expect(apply.json()).toMatchObject({ code: 'INVALID_STATE' });
    expect(applyAssets).not.toHaveBeenCalled();
  });

  it('rejects retry when the frozen source capture snapshot is no longer current', async () => {
    const { app, mediaWorkflowService, enqueue } = await build();
    mediaWorkflowService.get.mockResolvedValueOnce({
      ...workflow,
      status: 'FAILED',
      inputs: [{ assetId: 'asset-from-old-snapshot', url: '/images/old-source.png' }],
    });

    const response = await app.inject({ method: 'POST', url: '/workflows/workflow-1/retry', payload: {
      expectedRevision: 1,
      idempotencyKey: 'retry-stale-source',
    } });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'STALE_MEDIA_WORKFLOW' });
    expect(mediaWorkflowService.retry).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('resolves and internalizes an owner-scoped collect image context', async () => {
    const { app, mediaContextService } = await build();
    const loaded = await app.inject({ method: 'GET', url: '/contexts/collect/goods-1' });
    expect(loaded.statusCode).toBe(200);
    expect(loaded.json().data.inputs[0]).toMatchObject({ assetId: 'asset-1', sourceMediaKey: 'main-1' });
    expect(mediaContextService.loadCollect).toHaveBeenCalledWith('owner-1', 'goods-1');

    const internalized = await app.inject({
      method: 'POST', url: '/contexts/collect/goods-1/internalize', payload: { sourceMediaKey: 'main-1' },
    });
    expect(internalized.statusCode).toBe(200);
    expect(mediaContextService.internalizeCollect).toHaveBeenCalledWith('owner-1', 'goods-1', 'main-1');
  });

  it('compensates a retry when the queue is unavailable', async () => {
    const { app, repository, enqueue } = await build();
    enqueue.mockRejectedValueOnce(new Error('queue offline'));
    const response = await app.inject({ method: 'POST', url: '/workflows/workflow-1/retry', payload: {
      expectedRevision: 2, idempotencyKey: 'retry-idem-offline',
    } });
    expect(response.statusCode).toBe(503);
    expect(repository.markEnqueueFailed).toHaveBeenCalledWith('job-2', expect.objectContaining({
      errorCode: 'QUEUE_UNAVAILABLE',
    }));
  });

  it('does not overwrite a retry already claimed by a worker when queue acknowledgement fails', async () => {
    const { app, repository, enqueue } = await build();
    enqueue.mockRejectedValueOnce(new Error('queue acknowledgement lost'));
    repository.markEnqueueFailed.mockResolvedValueOnce(false);

    const response = await app.inject({ method: 'POST', url: '/workflows/workflow-1/retry', payload: {
      expectedRevision: 2, idempotencyKey: 'retry-idem-claimed',
    } });

    expect(response.statusCode).toBe(202);
    expect(repository.markFailed).not.toHaveBeenCalled();
  });

  it('binds approved output application to the reviewed collect context', async () => {
    const { app, repository, mediaWorkflowService } = await build();
    mediaWorkflowService.get.mockResolvedValueOnce({
      ...workflow, status: 'SUCCEEDED', reviewStatus: 'APPROVED',
      contextType: 'collect', contextId: 'goods-1', selectedOutputAssetId: 'output-1',
    });
    const response = await app.inject({ method: 'POST', url: '/jobs/job-1/apply', payload: {
      mode: 'append', targetType: 'collect', targetId: 'other-goods',
    } });
    expect(response.statusCode).toBe(400);
    expect(repository.recordApplication).not.toHaveBeenCalled();
  });

  it('rejects review when the source capture snapshot is no longer current', async () => {
    const { app, mediaWorkflowService } = await build();
    mediaWorkflowService.get.mockResolvedValueOnce({
      ...workflow,
      status: 'SUCCEEDED',
      reviewStatus: 'PENDING',
      contextType: 'collect',
      contextId: 'goods-1',
      inputs: [{ assetId: 'asset-from-old-snapshot', url: '/images/old-source.png' }],
    });

    const response = await app.inject({ method: 'POST', url: '/workflows/workflow-1/review', payload: {
      expectedRevision: 1, outputAssetId: 'output-1', decision: 'APPROVE',
    } });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'STALE_MEDIA_WORKFLOW' });
    expect(mediaWorkflowService.review).not.toHaveBeenCalled();
  });

  it('rejects replace application for translation candidates', async () => {
    const { app, repository } = await build();
    repository.getById.mockResolvedValueOnce({
      id: 'job-translation-1', ownerUserId: 'owner-1', workflowId: 'workflow-1',
      operation: 'IMAGE_TRANSLATE', status: 'SUCCEEDED', assets: [{ id: 'output-1', url: '/output.png' }],
    } as any);
    const response = await app.inject({ method: 'POST', url: '/jobs/job-translation-1/apply', payload: {
      mode: 'replace', targetType: 'collect', targetId: 'goods-1',
    } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'UNSAFE_APPLY_MODE' });
  });

  it('rejects an approved candidate after its source capture snapshot changes', async () => {
    const { app, mediaWorkflowService } = await build();
    mediaWorkflowService.get.mockResolvedValueOnce({
      ...workflow,
      status: 'SUCCEEDED',
      reviewStatus: 'APPROVED',
      contextType: 'collect',
      contextId: 'goods-1',
      selectedOutputAssetId: 'output-1',
      inputs: [{ assetId: 'asset-from-old-snapshot', url: '/images/old-source.png' }],
    });

    const response = await app.inject({ method: 'POST', url: '/jobs/job-1/apply', payload: {
      mode: 'append', targetType: 'collect', targetId: 'goods-1',
      expectedTargetUpdatedAt: '2026-07-19T00:00:00.000Z',
    } });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'STALE_MEDIA_WORKFLOW' });
  });

  it('requires workflow cancellation for a workflow-backed child job', async () => {
    const { app, repository } = await build();
    const response = await app.inject({ method: 'POST', url: '/jobs/job-1/cancel' });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'WORKFLOW_CANCEL_REQUIRED' });
    expect(repository.requestCancellation).not.toHaveBeenCalled();
  });

  it('does not reveal another tenant workflow child through the legacy cancellation endpoint', async () => {
    const { app, repository } = await build(true, 'owner-2');
    const response = await app.inject({ method: 'POST', url: '/jobs/job-1/cancel' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'NOT_FOUND' });
    expect(repository.requestCancellation).not.toHaveBeenCalled();
  });
});
