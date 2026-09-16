import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import Fastify, { type FastifyRequest } from 'fastify';
import sharp from 'sharp';
import { aiImageRoutes, resolveAiImageToImageReadiness } from '../routes/ai-images.js';
import { resolveAiImageProviderCapability, supportsAiMediaOperation } from '../services/ai-image-provider-capabilities.js';
import { createAiImageProviderRuntimeContract } from '../services/ai-image-provider-runtime-contract.js';
import { createAiMediaWorkflowService, type CreateAiMediaWorkflowInput } from '../services/ai-media-workflows.js';
import { createDashScopeWanx21ImageEditProvider } from '../services/ai-image-wanx-edit-provider.js';
import { processAiImageQueueJob, resolveAiImageProvider, type AiImageProviderResolverDependencies } from '../workers/ai-image-generation.js';
import { runAiImageJob, type AiImageJobRecord } from '../services/ai-image-jobs.js';

const config = {
  provider: 'dashscope-wanx', model: 'wanx2.1-imageedit',
  baseUrl: 'https://dashscope.aliyuncs.com/api/v1', apiKey: 'synthetic-reference-key',
  costPerImageCents: 14, currency: 'CNY' as const,
  credentialRevision: { recordId: 'synthetic-reference-record', revision: 2, updatedAt: '2026-09-16T00:00:00.000Z' },
};

function input(): CreateAiMediaWorkflowInput {
  return {
    ownerUserId: 'owner-1', actorUserId: 'owner-1', references: [{ assetId: 'source-1' }],
    prompt: '保留杯子，在桌面上展示。', negativePrompt: '文字、标志', count: 1,
    width: 1024, height: 1024, dailyLimit: 10, estimatedCostCents: 14, globalDailyBudgetCents: 100,
    provider: config.provider, model: config.model,
    providerRuntimeContract: createAiImageProviderRuntimeContract(config, { count: 1, width: 1024, height: 1024 }),
    idempotencyKey: 'reference-1', context: { type: 'collect', id: 'goods-1' },
  };
}

function service() {
  const createImageToImage = vi.fn(async () => ({ kind: 'created', jobId: 'job-1', workflow: { id: 'workflow-1' } }));
  return { createImageToImage, api: createAiMediaWorkflowService({ createImageToImage } as never) };
}

function frozenJob(): AiImageJobRecord {
  const source = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2S8AAAAASUVORK5CYII=', 'base64');
  return {
    id: 'reference-job', ownerUserId: 'owner-1', actorUserId: 'owner-1', status: 'QUEUED', operation: 'IMAGE_TO_IMAGE',
    provider: config.provider, model: config.model, prompt: '保留商品。', negativePrompt: null,
    resolvedPrompt: '保留商品。', resolvedNegativePrompt: '', width: 1024, height: 1024, requestedImageCount: 1,
    estimatedCostCents: 14, actualCostCents: null, billedUnits: 0, attemptCount: 0, maxAttempts: 1,
    providerJobId: null, idempotencyKey: 'reference-job-1', errorCode: null, errorMessage: null,
    operationConfig: createAiImageProviderRuntimeContract(config, { count: 1, width: 1024, height: 1024 }),
    inputAssets: [{ assetId: 'source-1', role: 'REFERENCE', ordinal: 0, sha256: createHash('sha256').update(source).digest('hex'),
      mimeType: 'image/png', sizeBytes: source.length, storageBackend: 'local', storageKey: 'source.png', kind: 'SOURCE_ORIGINAL' }],
    costReservation: { id: 'reservation-1', provider: config.provider, model: config.model, currency: 'CNY',
      status: 'RESERVED', estimatedCostMinor: 14, maximumCostMinor: 14, requestFingerprint: 'a'.repeat(64) },
  };
}

describe('normal Wanx single-reference image generation', () => {
  it('admits only the independently characterized one-reference operation', () => {
    expect(resolveAiImageToImageReadiness({
      ...config, enabled: true, workflowEnabled: true, production: true, estimatedCostCents: 14,
      storageReadiness: { ready: true, backend: 'local', reason: 'synthetic owned storage' },
    })).toMatchObject({ ready: true, reasonCode: 'READY' });
    expect(resolveAiImageProviderCapability(config.provider, config.model)).toMatchObject({
      maxReferences: 1, inputTransport: 'base64', resultMode: 'async',
    });
    expect(supportsAiMediaOperation(config.provider, config.model, 'IMAGE_TO_IMAGE', 1)).toBe(true);
    expect(supportsAiMediaOperation(config.provider, config.model, 'IMAGE_TO_IMAGE', 2)).toBe(false);
    expect(supportsAiMediaOperation(config.provider, config.model, 'TEXT_TO_IMAGE')).toBe(false);
  });

  it('freezes complete user instructions and the original CNY credential-bound quote', async () => {
    const state = service();
    const request = input();
    await expect(state.api.createImageToImage(request)).resolves.toMatchObject({ jobId: 'job-1' });
    expect(state.createImageToImage).toHaveBeenCalledWith(expect.objectContaining({
      prompt: request.prompt, negativePrompt: request.negativePrompt,
      resolvedPrompt: `${request.prompt}\n避免：${request.negativePrompt}`, resolvedNegativePrompt: '',
      providerRuntimeContract: request.providerRuntimeContract,
    }));
  });

  it.each([
    { label: 'multiple references', change: { references: [{ assetId: 'one' }, { assetId: 'two' }] } },
    { label: 'non-square output', change: { height: 1536 } },
    { label: 'oversized prompt', change: { prompt: '字'.repeat(801), negativePrompt: null } },
    { label: 'combined prompt overflow', change: { prompt: '字'.repeat(795), negativePrompt: '不加文字' } },
  ])('rejects $label without silently dropping input or reserving cost', async ({ change }) => {
    const state = service();
    await expect(state.api.createImageToImage({ ...input(), ...change })).rejects.toMatchObject({ code: 'INVALID_MEDIA_INPUT' });
    expect(state.createImageToImage).not.toHaveBeenCalled();
  });

  it('counts Unicode characters without cutting instructions at the exact prompt boundary', async () => {
    const state = service();
    const prompt = '🫖'.repeat(800);
    await state.api.createImageToImage({ ...input(), prompt, negativePrompt: null });
    expect(state.createImageToImage).toHaveBeenCalledWith(expect.objectContaining({ resolvedPrompt: prompt }));
  });

  it('creates a normal HTTP workflow with its CNY price and credential revision intact', async () => {
    const state = service();
    const enqueue = vi.fn(async () => undefined);
    const app = Fastify();
    await app.register(aiImageRoutes, {
      repository: {} as never, mediaWorkflowService: state.api, production: true,
      authenticate: async (request: FastifyRequest) => { (request as any).user = { userId: 'owner-1', actorUserId: 'owner-1' }; },
      getMediaWorkflowEnabled: async () => true, getSourceListingWebMediaEnabled: async () => true,
      getEditSettings: async () => ({ ...config, generationEnabled: true, imageToImageEnabled: true,
        fullEditEnabled: true, inpaintEnabled: true, dailyLimit: 10, estimatedCostCents: 14, globalDailyBudgetCents: 100 }),
      getEditStorageReadiness: async () => ({ ready: true, reason: 'synthetic owned storage', backend: 'local' }),
      enqueue,
    });
    try {
      const response = await app.inject({ method: 'POST', url: '/workflows', payload: {
        operation: 'IMAGE_TO_IMAGE', sourceAssetId: 'source-1', prompt: '保留商品，换桌面。',
        negativePrompt: '文字', count: 1, width: 1024, height: 1024,
        idempotencyKey: 'normal-wanx-reference', context: { type: 'collect', id: 'goods-1' },
      } });
      expect(response.statusCode, response.body).toBe(202);
      expect(state.createImageToImage).toHaveBeenCalledWith(expect.objectContaining({
        providerRuntimeContract: expect.objectContaining({ currency: 'CNY', credentialRevision: config.credentialRevision }),
      }));
      expect(enqueue).toHaveBeenCalledExactlyOnceWith('job-1');
    } finally { await app.close(); }
  });

  it('rejects a changed frozen prompt before the provider dispatch fence', async () => {
    const job = frozenJob();
    job.resolvedPrompt = '换成另外的商品。';
    const generate = vi.fn(async () => ({ images: [{ buffer: Buffer.from('output'), mimeType: 'image/png' }] }));
    const dispatch = vi.fn(async () => true);
    const repository = { getById: vi.fn(async () => job), markRunning: vi.fn(async () => { job.status = 'RUNNING'; return true; }),
      recordProviderDispatchStarted: dispatch, markFailed: vi.fn(), complete: vi.fn() };
    await expect(runAiImageJob(job.id, 1, { repository: repository as never, provider: { name: config.provider, generate },
      loadInputBuffer: async () => Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2S8AAAAASUVORK5CYII=', 'base64'),
      uploadBuffer: async () => ({ url: '/output.png', backend: 'local', key: 'output.png' }),
    })).rejects.toMatchObject({ code: 'FROZEN_INPUT_MISMATCH' });
    expect(dispatch).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it.each(['authorization', 'credential'] as const)('rechecks %s immediately before the Wanx POST', async (changed) => {
    const job = frozenJob();
    let hooks: AiImageProviderResolverDependencies | undefined;
    const getProviderConfig = vi.fn(async () => config);
    if (changed === 'credential') getProviderConfig.mockResolvedValueOnce(config).mockResolvedValueOnce({
      ...config, credentialRevision: { ...config.credentialRevision, revision: 3 },
    });
    const getDispatchAuthorization = vi.fn(async () => ({ enabled: true, reasonCode: 'allowed', reason: 'allowed' }));
    if (changed === 'authorization') getDispatchAuthorization.mockResolvedValueOnce({ enabled: true, reasonCode: 'allowed', reason: 'allowed' })
      .mockResolvedValueOnce({ enabled: false, reasonCode: 'revoked', reason: 'revoked' });
    await expect(processAiImageQueueJob(job.id, 1, {
      repository: { getById: async () => job, markEnqueueFailed: vi.fn(async () => true) } as never,
      getProviderConfig, getDispatchAuthorization, uploadBuffer: vi.fn(),
      resolveProvider: (_provider, _config, _accepted, dependencies) => {
        hooks = dependencies;
        return { name: config.provider, generate: vi.fn() };
      },
      run: async () => { job.status = 'RUNNING'; await hooks?.beforeProviderDispatch?.(); },
    })).rejects.toMatchObject({ code: changed === 'authorization' ? 'AI_IMAGE_DISPATCH_REVOKED' : 'PROVIDER_RUNTIME_CONTRACT_MISMATCH' });
    expect(getProviderConfig).toHaveBeenNthCalledWith(1, 'IMAGE_TO_IMAGE');
  });

  it('uses the existing async adapter with one POST and the original task lookup', async () => {
    const source = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#eeeeee' } }).png().toBuffer();
    const requests: Array<{ url: string; method: string; body?: any }> = [];
    const accepted = vi.fn(async () => undefined);
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), method: init?.method || 'GET', ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
      if (init?.method === 'POST') return new Response(JSON.stringify({ output: { task_id: 'reference-task', task_status: 'PENDING' } }));
      if (String(url).includes('/tasks/')) return new Response(JSON.stringify({
        output: { task_id: 'reference-task', task_status: 'SUCCEEDED', task_metrics: { TOTAL: 1, SUCCEEDED: 1, FAILED: 0 },
          results: [{ url: 'https://dashscope-result.oss-cn-beijing.aliyuncs.com/reference.png' }] },
        usage: { image_count: 1 },
      }));
      return new Response(new Uint8Array(source), { headers: { 'content-type': 'image/png' } });
    });
    const provider = resolveAiImageProvider(config.provider, config, accepted, {
      createWanxEditProvider: (options: Parameters<typeof createDashScopeWanx21ImageEditProvider>[0]) => createDashScopeWanx21ImageEditProvider({
        ...options, fetch: fetcher, pollIntervalMs: 0,
      }),
    } as never);
    expect(provider.name).toBe(config.provider);
    const result = await provider.generate({
      operation: 'IMAGE_TO_IMAGE', prompt: '保留商品，换成木桌背景。', negativePrompt: null,
      count: 1, width: 1024, height: 1024, model: config.model,
      inputImages: [{ buffer: source, mimeType: 'image/png' }],
    });
    expect(result.providerJobId).toBe('reference-task');
    expect(result.actualCostCents).toBe(14);
    expect(accepted).toHaveBeenCalledTimes(1);
    expect(requests.filter((request) => request.method === 'POST')).toEqual([expect.objectContaining({
      url: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/image2image/image-synthesis',
      body: { model: config.model, input: { function: 'description_edit', prompt: '保留商品，换成木桌背景。',
        base_image_url: `data:image/png;base64,${source.toString('base64')}` }, parameters: { n: 1 } },
    })]);
    expect(requests.some((request) => request.url.endsWith('/tasks/reference-task'))).toBe(true);
  });
});
