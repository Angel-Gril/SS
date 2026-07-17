import Fastify, { type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { aiImageRoutes } from '../routes/ai-images.js';
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
    prompt: 'Keep product', assets: [{ id: 'output-1', url: '/output.png', storageKey: 'secret-output-key', storageBackend: 'oss' }],
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
    markRunning: vi.fn(), markRetrying: vi.fn(), markFailed: vi.fn(), markCancelled: vi.fn(), complete: vi.fn(),
  } as any;
}

async function build(enabled = true, ownerUserId = 'owner-1') {
  const mediaWorkflowService = {
    createImageToImage: vi.fn(async () => ({ workflow, jobId: 'job-1', replayed: false })),
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
  const repository = jobRepository();
  const app = Fastify();
  await app.register(aiImageRoutes, {
    repository, mediaWorkflowService, mediaContextService, enqueue,
    getMediaWorkflowEnabled: async () => enabled,
    authenticate: async (request: FastifyRequest) => {
      (request as any).user = { userId: ownerUserId, actorUserId: 'actor-1' };
    },
  });
  return { app, repository, mediaWorkflowService, mediaContextService, enqueue };
}

describe('AI media workflow routes', () => {
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
    expect(repository.markFailed).toHaveBeenCalledWith('job-2', expect.objectContaining({
      errorCode: 'QUEUE_UNAVAILABLE',
    }));
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
