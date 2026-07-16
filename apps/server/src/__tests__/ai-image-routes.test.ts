import Fastify, { type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { aiImageRoutes } from '../routes/ai-images.js';
import type { AiImageJobRecord, AiImageJobRepository } from '../services/ai-image-jobs.js';

const baseJob: AiImageJobRecord = {
  id: 'job-1', ownerUserId: 'owner-1', actorUserId: 'actor-1', status: 'SUCCEEDED',
  provider: 'fake', model: 'fake-image-v1', prompt: 'photo', negativePrompt: null,
  requestedImageCount: 1, width: 1024, height: 1024, attemptCount: 1, maxAttempts: 3,
  idempotencyKey: 'idem-1', estimatedCostCents: 4, actualCostCents: 3, billedUnits: 1,
  providerJobId: 'provider-1', errorCode: null, errorMessage: null,
};

async function buildApp(ownerUserId = 'owner-1', provider = 'fake') {
  const repository: AiImageJobRepository = {
    getById: vi.fn(async () => baseJob),
    createWithQuota: vi.fn(async () => ({ kind: 'created' as const, job: { ...baseJob, status: 'QUEUED' as const } })),
    requestCancellation: vi.fn(async (_id, owner) => owner === 'owner-1' ? { ...baseJob, status: 'CANCEL_REQUESTED' as const } : null),
    recordApplication: vi.fn(async (_id, data) => ({ ...baseJob, appliedMode: data.mode })),
    markRunning: vi.fn(async () => true), markRetrying: vi.fn(), markFailed: vi.fn(), markCancelled: vi.fn(), complete: vi.fn(),
  };
  const enqueue = vi.fn(async () => undefined);
  const applyAssets = vi.fn(async (input: any) => ({
    jobId: input.jobId,
    mode: input.mode,
    targetType: input.targetType,
    targetId: input.targetId,
    images: ['https://cdn.example/applied.png'],
    editedImages: ['https://cdn.example/applied.png'],
    mainImage: 'https://cdn.example/applied.png',
    targetUpdatedAt: new Date('2026-07-17T00:00:00.000Z'),
    appliedAt: new Date('2026-07-17T00:00:00.000Z'),
  }));
  const app = Fastify();
  await app.register(aiImageRoutes, {
    repository,
    enqueue,
    applyAssets,
    authenticate: async (request: FastifyRequest) => {
      (request as any).user = { userId: ownerUserId, actorUserId: 'actor-1', role: 'USER' };
    },
    getSettings: async () => ({ enabled: true, provider, model: provider === 'fake' ? 'fake-image-v1' : 'wanx-v1', dailyLimit: 5, estimatedCostCents: 4 }),
    resolvePrompt: async ({
      templateKey,
      userPrompt,
      userNegativePrompt,
    }: {
      templateKey: string;
      userPrompt: string;
      userNegativePrompt: string;
    }) => ({
      templateKey,
      release: { id: 'release-1', revisionId: 'revision-1', sequence: 1 },
      checksum: 'a'.repeat(64),
      snapshot: { templateKey, releaseId: 'release-1', revisionId: 'revision-1', sequence: 1 },
      resolvedPrompt: userPrompt,
      resolvedNegativePrompt: userNegativePrompt,
    }),
  });
  return { app, repository, enqueue, applyAssets };
}

describe('AI image job routes', () => {
  it('creates and enqueues a new owner-scoped job', async () => {
    const { app, repository, enqueue } = await buildApp();
    const response = await app.inject({ method: 'POST', url: '/jobs', payload: { prompt: 'photo', count: 1, width: 1024, height: 1024, idempotencyKey: 'idem-0001' } });
    expect(response.statusCode).toBe(202);
    expect(repository.createWithQuota).toHaveBeenCalledWith(expect.objectContaining({ ownerUserId: 'owner-1', actorUserId: 'actor-1' }), 5);
    expect(enqueue).toHaveBeenCalledWith('job-1');
  });

  it('does not expose a job owned by another tenant', async () => {
    const { app } = await buildApp('other-owner');
    const response = await app.inject({ method: 'GET', url: '/jobs/job-1' });
    expect(response.statusCode).toBe(404);
  });

  it('requests cancellation through an owner-scoped update', async () => {
    const { app, repository } = await buildApp();
    const response = await app.inject({ method: 'POST', url: '/jobs/job-1/cancel' });
    expect(response.statusCode).toBe(200);
    expect(repository.requestCancellation).toHaveBeenCalledWith('job-1', 'owner-1');
  });

  it('requires an explicit append or replace mode when applying', async () => {
    const { app, applyAssets } = await buildApp();
    const invalid = await app.inject({ method: 'POST', url: '/jobs/job-1/apply', payload: { targetType: 'collect', targetId: 'item-1' } });
    expect(invalid.statusCode).toBe(400);

    const valid = await app.inject({ method: 'POST', url: '/jobs/job-1/apply', payload: { mode: 'replace', targetType: 'collect', targetId: 'item-1' } });
    expect(valid.statusCode).toBe(200);
    expect(applyAssets).toHaveBeenCalledWith(expect.objectContaining({
      jobId: 'job-1', ownerUserId: 'owner-1', actorUserId: 'actor-1', mode: 'replace',
    }));
    expect(valid.json().data).toEqual(expect.objectContaining({
      jobId: 'job-1', mode: 'replace', targetType: 'collect', targetId: 'item-1',
      images: ['https://cdn.example/applied.png'],
      editedImages: ['https://cdn.example/applied.png'],
      targetUpdatedAt: '2026-07-17T00:00:00.000Z',
    }));
  });
  it('accepts supported real providers and rejects unsupported custom adapters', async () => {
    const { app: dashscope, enqueue } = await buildApp('owner-1', 'dashscope-wanx');
    const accepted = await dashscope.inject({
      method: 'POST', url: '/jobs',
      payload: { prompt: 'photo', count: 1, width: 1024, height: 1024, idempotencyKey: 'idem-real-1' },
    });
    expect(accepted.statusCode).toBe(202);
    expect(enqueue).toHaveBeenCalledWith('job-1');

    const { app: custom } = await buildApp('owner-1', 'custom');
    const rejected = await custom.inject({ method: 'POST', url: '/jobs', payload: { prompt: 'photo' } });
    expect(rejected.statusCode).toBe(503);
  });
});
