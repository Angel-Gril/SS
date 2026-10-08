import Fastify, { type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { aiImageRoutes, isPaidAiImageEditCanvasSupported } from '../routes/ai-images.js';
import type { AiImageProviderCapability } from '../services/ai-image-provider-capabilities.js';
import type { AiImageJobRecord, AiImageJobRepository } from '../services/ai-image-jobs.js';
import { buildAiImageGenerationQuote } from '../services/ai-image-generation-quote.js';
import type { AiImageProviderCredentialRevision } from '../services/ai-image-provider-runtime-contract.js';

const baseJob: AiImageJobRecord = {
  id: 'job-1', ownerUserId: 'owner-1', actorUserId: 'actor-1', status: 'SUCCEEDED',
  provider: 'fake', model: 'fake-image-v1', prompt: 'photo', negativePrompt: null,
  requestedImageCount: 1, width: 1024, height: 1024, attemptCount: 1, maxAttempts: 3,
  idempotencyKey: 'idem-1', estimatedCostCents: 4, actualCostCents: 3, billedUnits: 1,
  providerJobId: 'provider-1', errorCode: null, errorMessage: null,
};

async function buildApp(
  ownerUserId = 'owner-1',
  provider = 'fake',
  workflowDecision: { enabled: boolean; reason: string; revision: number } = {
    enabled: true,
    reason: 'tenant_allowed',
    revision: 1,
  },
  overrides: {
    model?: string;
    baseUrl?: string;
    estimatedCostCents?: number;
    currency?: 'USD' | 'CNY';
    credentialRevision?: AiImageProviderCredentialRevision;
    resolveProviderCapability?: (
      provider: string,
      model: string,
    ) => AiImageProviderCapability | null;
  } = {},
) {
  const repository: AiImageJobRepository = {
    getById: vi.fn(async () => baseJob),
    findByOwnerAndIdempotencyKey: vi.fn(async () => null),
    createWithQuota: vi.fn(async () => ({ kind: 'created' as const, job: { ...baseJob, status: 'QUEUED' as const } })),
    requestCancellation: vi.fn(async (_id, owner) => owner === 'owner-1' ? { ...baseJob, status: 'CANCEL_REQUESTED' as const } : null),
    recordApplication: vi.fn(async (_id, data) => ({ ...baseJob, appliedMode: data.mode })),
    markRunning: vi.fn(async () => true), markRetrying: vi.fn(), markFailed: vi.fn(),
    markEnqueueFailed: vi.fn(async () => true), markCancelled: vi.fn(), complete: vi.fn(),
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
  const resolvePrompt = vi.fn(async ({
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
  }));
  const app = Fastify();
  await app.register(aiImageRoutes, {
    repository,
    enqueue,
    applyAssets,
    authenticate: async (request: FastifyRequest) => {
      (request as any).user = { userId: ownerUserId, actorUserId: 'actor-1', role: 'USER' };
    },
    getSettings: async () => ({
      enabled: true,
      provider,
      model: overrides.model || (provider === 'fake' ? 'fake-image-v1' : 'wanx-v1'),
      baseUrl: overrides.baseUrl,
      dailyLimit: 5,
      estimatedCostCents: overrides.estimatedCostCents ?? 4,
      currency: overrides.currency,
      credentialRevision: overrides.credentialRevision,
    }),
    getMediaWorkflowDecision: async () => workflowDecision,
    resolvePrompt,
    resolveProviderCapability: overrides.resolveProviderCapability,
  });
  return { app, repository, enqueue, applyAssets, resolvePrompt };
}

describe('AI image job routes', () => {
  const pricedProvider = { provider: 'dashscope-wanx', model: 'wanx2.1-t2i-turbo',
    baseUrl: 'https://dashscope.aliyuncs.com/api/v1', costPerImageCents: 14, currency: 'CNY' as const };
  const pricedRequest = { prompt: 'photo', count: 2, width: 1024, height: 1024, idempotencyKey: 'quoted-request-1' };
  const pricedOptions = { ...pricedProvider, estimatedCostCents: pricedProvider.costPerImageCents };

  it('returns one count-model CNY0.10 quote while freezing its credential revision privately', async () => {
    const { app, repository, enqueue } = await buildApp('owner-1', 'custom', undefined, {
      model: 'gpt-image-2-count', baseUrl: 'https://ai.big-model-api.top/v1', estimatedCostCents: 10, currency: 'CNY',
      credentialRevision: { recordId: 'fixture-private-key-record', revision: 3, updatedAt: '2026-10-08T00:00:00.000Z' },
    });
    try {
      const response = await app.inject({ method: 'GET', url: '/quote?count=1&width=900&height=1200' });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toMatchObject({ provider: 'custom', model: 'gpt-image-2-count',
        currency: 'CNY', unitCostCents: 10, maximumCostCents: 10, requestedImageCount: 1 });
      expect(response.body).not.toContain('fixture-private-key-record');
      expect(repository.createWithQuota).not.toHaveBeenCalled();
      expect(enqueue).not.toHaveBeenCalled();
      for (const query of ['count=2&width=900&height=1200', 'count=1&width=999&height=1200']) {
        expect((await app.inject({ method: 'GET', url: `/quote?${query}` })).statusCode).toBe(400);
      }
    } finally { await app.close(); }
  });

  it('returns the authenticated server quote without creating, reserving or dispatching a task', async () => {
    const { app, repository, enqueue, resolvePrompt } = await buildApp('owner-1', pricedProvider.provider, undefined, pricedOptions);
    try {
      const response = await app.inject({ method: 'GET', url: '/quote?count=2&width=1024&height=1024' });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toEqual(buildAiImageGenerationQuote(pricedProvider, pricedRequest).preview);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(repository.createWithQuota).not.toHaveBeenCalled();
      expect(enqueue).not.toHaveBeenCalled();
      expect(resolvePrompt).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it('rejects quotes outside the tenant rollout and invalid image counts', async () => {
    const { app, repository } = await buildApp('owner-1', 'fake', { enabled: false, reason: 'tenant_not_allowed', revision: 2 });
    try {
      const denied = await app.inject({ method: 'GET', url: '/quote' });
      expect(denied.statusCode).toBe(503);
      expect(denied.json().code).toBe('AI_MEDIA_WORKFLOW_DISABLED');
      const invalid = await app.inject({ method: 'GET', url: '/quote?count=5' });
      expect(invalid.statusCode).toBe(400);
      expect(repository.createWithQuota).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it('accepts the displayed quote and refuses a stale price before reserving or enqueuing', async () => {
    const { app, repository, enqueue } = await buildApp('owner-1', pricedProvider.provider, undefined, pricedOptions);
    try {
      const stale = buildAiImageGenerationQuote({ ...pricedProvider, costPerImageCents: 7 }, pricedRequest).preview;
      const rejected = await app.inject({ method: 'POST', url: '/jobs', payload: { ...pricedRequest, quoteFingerprint: stale.quoteFingerprint } });
      expect(rejected.statusCode).toBe(409);
      expect(rejected.json().code).toBe('QUOTE_CHANGED');
      expect(repository.createWithQuota).not.toHaveBeenCalled();
      expect(enqueue).not.toHaveBeenCalled();
      const current = buildAiImageGenerationQuote(pricedProvider, pricedRequest).preview;
      const accepted = await app.inject({ method: 'POST', url: '/jobs', payload: { ...pricedRequest, quoteFingerprint: current.quoteFingerprint } });
      expect(accepted.statusCode).toBe(202);
      expect(repository.createWithQuota).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ estimatedCostCents: 28 }), 5, 0);
    } finally { await app.close(); }
  });

  it('retrieves a lost response with its frozen price even after current pricing and rollout change', async () => {
    const frozen = buildAiImageGenerationQuote(pricedProvider, pricedRequest);
    const stored = { ...baseJob, ...pricedProvider, operation: 'TEXT_TO_IMAGE' as const,
      idempotencyKey: pricedRequest.idempotencyKey, requestedImageCount: 2,
      operationConfig: frozen.operationConfig, estimatedCostCents: 28, actualCostCents: 28, billedUnits: 2 };
    const { app, repository, enqueue, resolvePrompt } = await buildApp('owner-1', 'disabled', { enabled: false, reason: 'master_off', revision: 3 });
    vi.mocked(repository.findByOwnerAndIdempotencyKey!).mockResolvedValue(stored);
    try {
      const response = await app.inject({ method: 'POST', url: '/jobs', payload: { ...pricedRequest, quoteFingerprint: frozen.preview.quoteFingerprint } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ replayed: true, data: { id: baseJob.id,
        pricing: { currency: 'CNY', unitCostCents: 14, maximumCostCents: 28 }, actualCostCents: 28 } });
      expect(repository.findByOwnerAndIdempotencyKey).toHaveBeenCalledWith('owner-1', pricedRequest.idempotencyKey);
      expect(repository.createWithQuota).not.toHaveBeenCalled();
      expect(enqueue).not.toHaveBeenCalled();
      expect(resolvePrompt).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it.each([{ prompt: 'another request' }, { count: 1 }, { width: 1536 }, { negativePrompt: 'different' }])(
    'rejects an existing idempotency key used with changed request fields %j', async (change) => {
      const { app, repository, enqueue } = await buildApp();
      vi.mocked(repository.findByOwnerAndIdempotencyKey!).mockResolvedValue({ ...baseJob, requestedImageCount: 2 });
      try {
        const response = await app.inject({ method: 'POST', url: '/jobs', payload: { ...pricedRequest, ...change } });
        expect(response.statusCode).toBe(409);
        expect(response.json().code).toBe('IDEMPOTENCY_KEY_CONFLICT');
        expect(repository.createWithQuota).not.toHaveBeenCalled();
        expect(enqueue).not.toHaveBeenCalled();
      } finally { await app.close(); }
    },
  );

  it('does not expose another owner through replay or let broken historical pricing hide an owned job', async () => {
    const { app, repository } = await buildApp();
    try {
      vi.mocked(repository.findByOwnerAndIdempotencyKey!).mockResolvedValue({ ...baseJob, ownerUserId: 'other-owner' });
      const other = await app.inject({ method: 'POST', url: '/jobs', payload: { prompt: 'photo', idempotencyKey: 'another-owner-key' } });
      expect(other.statusCode).toBe(404);
      vi.mocked(repository.getById).mockResolvedValue({ ...baseJob, provider: 'custom', operationConfig: { contractVersion: 'broken' } });
      const historic = await app.inject({ method: 'GET', url: '/jobs/job-1' });
      expect(historic.statusCode).toBe(200);
      expect(historic.json().data.pricing).toBeNull();
      expect(historic.json().data.operationConfig).toBeUndefined();
    } finally { await app.close(); }
  });
  it.each([
    { provider: 'openai-images', model: 'gpt-image-1', baseUrl: 'https://api.openai.com/v1', currency: undefined },
    { provider: 'dashscope-wanx', model: 'wanx2.1-t2i-turbo', baseUrl: 'https://dashscope.aliyuncs.com/api/v1', currency: 'CNY' as const },
    { provider: 'custom', model: 'admin-configured-model', baseUrl: 'https://relay.example/v1', currency: undefined },
  ])('creates a normal $provider text job from configured protocol and price', async ({ provider, model, baseUrl, currency }) => {
    const { app, repository, enqueue } = await buildApp('owner-1', provider, {
      enabled: true, reason: 'tenant_allowed', revision: 1,
    }, { model, baseUrl, currency, estimatedCostCents: 7 });
    try {
      const response = await app.inject({ method: 'POST', url: '/jobs', payload: {
        prompt: 'A studio product photograph', count: 2, width: 1024, height: 1024, idempotencyKey: 'normal-text-job',
      } });
      expect(response.statusCode, response.body).toBe(202);
      expect(repository.createWithQuota).toHaveBeenCalledWith(expect.objectContaining({
        provider, model, estimatedCostCents: 14,
        operationConfig: expect.objectContaining({ unitCostCents: 7, imageCount: 2, ...(currency ? { currency } : {}) }),
      }), 5, 0);
      expect(enqueue).toHaveBeenCalledExactlyOnceWith('job-1');
    } finally { await app.close(); }
  });
  it.each([
    ['fake', 900, 1200, true],
    ['custom', 1024, 1536, true],
    ['custom', 900, 1200, false],
    ['openai-images', 1024, 1365, false],
  ])('checks paid edit canvas support before quota work (%s %dx%d)', (provider, width, height, supported) => {
    expect(isPaidAiImageEditCanvasSupported(provider, width, height)).toBe(supported);
  });

  it('creates and enqueues a new owner-scoped job', async () => {
    const { app, repository, enqueue } = await buildApp();
    const response = await app.inject({ method: 'POST', url: '/jobs', payload: { prompt: 'photo', count: 1, width: 1024, height: 1024, idempotencyKey: 'idem-0001' } });
    expect(response.statusCode).toBe(202);
    expect(repository.createWithQuota).toHaveBeenCalledWith(expect.objectContaining({ ownerUserId: 'owner-1', actorUserId: 'actor-1' }), 5);
    expect(enqueue).toHaveBeenCalledWith('job-1');
  });

  it('creates a custom Relay job only with exact text-generation sandbox evidence', async () => {
    const baseUrl = 'https://relay.example/v1';
    const model = 'relay-image-v2';
    const endpointSha256 = '889271d70d18282b00bbed393fc85cc923bc38817f3aea457379d58f98bd9d3b';
    const capability: AiImageProviderCapability = {
      provider: 'custom', model, operations: ['TEXT_TO_IMAGE'], maxReferences: 0,
      supportsMask: false, inputTransport: 'none', resultMode: 'sync',
      evidenceLevel: 'sandbox-verified', evidence: 'exact custom Relay generation evidence',
      sandboxEvidence: [{
        endpointSha256,
        operation: 'TEXT_TO_IMAGE',
        inputTransport: 'none',
        resultMode: 'sync',
      }],
    };
    const { app, repository, enqueue } = await buildApp(
      'owner-1',
      'custom',
      { enabled: true, reason: 'tenant_allowed', revision: 1 },
      {
        baseUrl,
        model,
        estimatedCostCents: 9,
        resolveProviderCapability: () => capability,
      },
    );

    const response = await app.inject({
      method: 'POST',
      url: '/jobs',
      payload: {
        prompt: 'studio product photo', count: 1, width: 1024, height: 1024,
        idempotencyKey: 'idem-custom-relay-1',
      },
    });

    expect(response.statusCode).toBe(202);
    expect(repository.createWithQuota).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'custom',
      model,
      estimatedCostCents: 9,
      operationConfig: expect.objectContaining({
        provider: 'custom',
        model,
        baseUrlSha256: endpointSha256,
        maximumCostCents: 9,
      }),
    }), 5, 0);
    expect(enqueue).toHaveBeenCalledWith('job-1');
  });

  it('uses the configured custom text endpoint instead of an unrelated supplier receipt', async () => {
    const baseUrl = 'https://relay.example/v1';
    const model = 'relay-image-v2';
    const capability: AiImageProviderCapability = {
      provider: 'custom', model, operations: ['TEXT_TO_IMAGE'], maxReferences: 0,
      supportsMask: false, inputTransport: 'none', resultMode: 'sync',
      evidenceLevel: 'sandbox-verified', evidence: 'different endpoint evidence',
      sandboxEvidence: [{
        endpointSha256: 'a3d9c9d847e21f89d3a11ba60f2fcfa16546a2cb9d601c28c67ca7e079171fe2',
        operation: 'TEXT_TO_IMAGE',
        inputTransport: 'none',
        resultMode: 'sync',
      }],
    };
    const { app, repository, enqueue, resolvePrompt } = await buildApp(
      'owner-1',
      'custom',
      { enabled: true, reason: 'tenant_allowed', revision: 1 },
      {
        baseUrl,
        model,
        estimatedCostCents: 9,
        resolveProviderCapability: () => capability,
      },
    );

    const response = await app.inject({
      method: 'POST',
      url: '/jobs',
      payload: { prompt: 'studio product photo', idempotencyKey: 'idem-custom-relay-2' },
    });

    expect(response.statusCode).toBe(202);
    expect(resolvePrompt).toHaveBeenCalledOnce();
    expect(repository.createWithQuota).toHaveBeenCalledWith(expect.objectContaining({
      operationConfig: expect.objectContaining({
        baseUrlSha256: '889271d70d18282b00bbed393fc85cc923bc38817f3aea457379d58f98bd9d3b',
      }),
    }), 5, 0);
    expect(enqueue).toHaveBeenCalledOnce();
  });

  it('rejects a tenant outside the canonical media rollout before any job side effect', async () => {
    const { app, repository, enqueue, resolvePrompt } = await buildApp('owner-1', 'fake', {
      enabled: false,
      reason: 'tenant_not_allowed',
      revision: 2,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/jobs',
      payload: {
        prompt: 'photo',
        count: 1,
        width: 1024,
        height: 1024,
        idempotencyKey: 'idem-rollout-denied',
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'AI_MEDIA_WORKFLOW_DISABLED' });
    expect(resolvePrompt).not.toHaveBeenCalled();
    expect(repository.createWithQuota).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('marks a queued job failed when enqueueing never reached a worker', async () => {
    const { app, repository, enqueue } = await buildApp();
    enqueue.mockRejectedValueOnce(new Error('queue offline'));

    const response = await app.inject({
      method: 'POST', url: '/jobs',
      payload: { prompt: 'photo', count: 1, width: 1024, height: 1024, idempotencyKey: 'idem-offline-1' },
    });

    expect(response.statusCode).toBe(503);
    expect(repository.markEnqueueFailed).toHaveBeenCalledWith('job-1', expect.objectContaining({
      errorCode: 'QUEUE_UNAVAILABLE',
    }));
  });

  it('keeps the accepted response when a worker claimed the job before enqueue reported failure', async () => {
    const { app, repository, enqueue } = await buildApp();
    enqueue.mockRejectedValueOnce(new Error('queue acknowledgement lost'));
    vi.mocked(repository.markEnqueueFailed!).mockResolvedValueOnce(false);

    const response = await app.inject({
      method: 'POST', url: '/jobs',
      payload: { prompt: 'photo', count: 1, width: 1024, height: 1024, idempotencyKey: 'idem-claimed-1' },
    });

    expect(response.statusCode).toBe(202);
    expect(repository.markFailed).not.toHaveBeenCalled();
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
  it('rejects unregistered official models and an unconfigured custom endpoint', async () => {
    const { app: dashscope, enqueue } = await buildApp('owner-1', 'dashscope-wanx');
    const rejectedDashscope = await dashscope.inject({
      method: 'POST', url: '/jobs',
      payload: { prompt: 'photo', count: 1, width: 1024, height: 1024, idempotencyKey: 'idem-real-1' },
    });
    expect(rejectedDashscope.statusCode).toBe(503);
    expect(enqueue).not.toHaveBeenCalled();

    const { app: custom } = await buildApp('owner-1', 'custom');
    const rejected = await custom.inject({ method: 'POST', url: '/jobs', payload: { prompt: 'photo' } });
    expect(rejected.statusCode).toBe(503);

    const { app: openai } = await buildApp('owner-1', 'openai-images');
    const rejectedAlias = await openai.inject({ method: 'POST', url: '/jobs', payload: { prompt: 'photo' } });
    expect(rejectedAlias.statusCode).toBe(503);
  });
});
