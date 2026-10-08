import { describe, expect, it, vi } from 'vitest';
vi.mock('../lib/redis.js', () => ({ redisDisabled: true }));
import { processAiImageQueueJob, resolveAiImageProvider } from '../workers/ai-image-generation.js';
import { resolveAiImageEditProvider } from '../workers/ai-image-edit.js';
import { isAiImageEditProviderCanvasSupported, resolveAiImageEditProviderContract } from '../services/ai-image-edit-provider-contract.js';
import { aiImageProviderEndpointSha256, createAiImageProviderRuntimeContract } from '../services/ai-image-provider-runtime-contract.js';

const config = { provider: 'custom', model: 'gpt-image-2-count', baseUrl: 'https://ai.big-model-api.top/v1',
  apiKey: 'synthetic-count-key', costPerImageCents: 10, currency: 'CNY' as const };
const operations = ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'] as const;
// Resolver-only fixture. This does not promote production capabilities or substitute for real calibration.
const capability = () => ({ provider: 'custom', model: config.model, operations, maxReferences: 1,
  supportsMask: true, inputTransport: 'multipart' as const, resultMode: 'sync' as const,
  evidenceLevel: 'sandbox-verified' as const, evidence: 'test-only dispatch fixture',
  sandboxEvidence: operations.map(operation => ({ endpointSha256: aiImageProviderEndpointSha256(config.provider, config.baseUrl),
    operation, inputTransport: operation === 'TEXT_TO_IMAGE' ? 'none' as const : 'multipart' as const, resultMode: 'sync' as const })) });
const source = { buffer: Buffer.from('trusted-source'), mimeType: 'image/png' as const };

describe('ordinary count-model dispatch contracts', () => {
  it('selects distinct count text and reference factories, retaining the final dispatch guard', async () => {
    const generate = vi.fn(async () => ({ images: [], actualCostCents: 10 }));
    const edit = vi.fn(async () => ({ images: [], actualCostCents: 10 }));
    const createGeneration = vi.fn(() => ({ name: 'count-text', generate }));
    const createEdit = vi.fn(() => ({ name: 'count-edit', edit }));
    const legacyFactory = vi.fn();
    const beforeProviderDispatch = vi.fn(async () => {});
    const provider = resolveAiImageProvider('custom', config, undefined, { resolveCapability: capability,
      createCountGenerationProvider: createGeneration, createCountEditProvider: createEdit,
      createOpenAiGenerationProvider: legacyFactory, createOpenAiEditProvider: legacyFactory,
      beforeProviderDispatch } as any);
    const request = { prompt: 'replace the background', negativePrompt: null, count: 1, width: 900, height: 1200, model: config.model };
    await expect(provider.generate({ ...request, operation: 'TEXT_TO_IMAGE' })).resolves.toMatchObject({ actualCostCents: 10 });
    await expect(provider.generate({ ...request, operation: 'IMAGE_TO_IMAGE', inputImages: [source] })).resolves.toMatchObject({ actualCostCents: 10 });
    expect(createGeneration).toHaveBeenCalledWith(expect.objectContaining({ beforeProviderDispatch }));
    expect(createEdit).toHaveBeenCalledWith(expect.objectContaining({ beforeProviderDispatch }));
    expect(legacyFactory).not.toHaveBeenCalled();
    expect(edit).toHaveBeenCalledWith(expect.objectContaining({ operation: 'IMAGE_TO_IMAGE', images: [source], width: 900, height: 1200 }));
    await expect(provider.generate({ ...request, operation: 'TEXT_TO_IMAGE', count: 2 })).rejects.toBeDefined();
    await expect(provider.generate({ ...request, operation: 'IMAGE_TO_IMAGE', inputImages: [source, source] })).rejects.toBeDefined();
    expect(generate).toHaveBeenCalledOnce();
    expect(edit).toHaveBeenCalledOnce();
  });

  it.each(['FULL_EDIT', 'INPAINT'] as const)('dispatches ordinary %s through the count factory with one owned reference', async operation => {
    const edit = vi.fn(async () => ({ images: [], actualCostCents: 10 }));
    const createCountEditProvider = vi.fn(() => ({ name: 'count-edit', edit }));
    const createOpenAiEditProvider = vi.fn();
    const beforeProviderDispatch = vi.fn(async () => {});
    const provider = resolveAiImageEditProvider('custom', config.model, operation, config, undefined, 'production', {
      resolveCapability: capability, createCountEditProvider, createOpenAiEditProvider, beforeProviderDispatch } as any);
    const request = { operation, prompt: 'replace selected background', negativePrompt: null, count: 1,
      width: 900, height: 1200, model: config.model, inputImages: [source], mask: operation === 'INPAINT' ? source : null };
    await expect(provider.generate(request)).resolves.toMatchObject({ actualCostCents: 10 });
    expect(createCountEditProvider).toHaveBeenCalledWith(expect.objectContaining({ beforeProviderDispatch }));
    expect(createOpenAiEditProvider).not.toHaveBeenCalled();
    expect(edit).toHaveBeenCalledWith(expect.objectContaining({ operation, images: [source], mask: request.mask }));
    await expect(provider.generate({ ...request, count: 2 })).rejects.toMatchObject({ code: 'INVALID_MEDIA_INPUT' });
    expect(edit).toHaveBeenCalledOnce();
  });

  it('admits only the count endpoint and declared source/output canvases', () => {
    expect(resolveAiImageEditProviderContract('custom', config.model, config.baseUrl)).toMatchObject({ kind: 'gpt2-count', inputTransport: 'multipart', resultMode: 'sync' });
    expect(resolveAiImageEditProviderContract('custom', config.model, 'https://different.example/v1')).toBeNull();
    expect(isAiImageEditProviderCanvasSupported('custom', config.model, 900, 1200)).toBe(true);
    expect(isAiImageEditProviderCanvasSupported('custom', config.model, 999, 1200)).toBe(false);
    expect(isAiImageEditProviderCanvasSupported('custom', 'other-model', 900, 1200)).toBe(false);
    expect(isAiImageEditProviderCanvasSupported('dashscope-wanx', 'wanx2.1-imageedit', 900, 1200)).toBe(false);
  });

  it.each(['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE'] as const)('rechecks the count credential immediately before %s POST', async operation => {
    const frozenConfig = { ...config, credentialRevision: { recordId: 'fixture-count-key', revision: 1, updatedAt: '2026-10-08T00:00:00.000Z' } };
    const job = { id: 'fixture-count-job', ownerUserId: 'fixture-owner', provider: config.provider, model: config.model, operation,
      status: 'QUEUED', requestFingerprint: 'a'.repeat(64), width: 900, height: 1200, requestedImageCount: 1, estimatedCostCents: 10,
      operationConfig: createAiImageProviderRuntimeContract(frozenConfig, { count: 1, width: 900, height: 1200 }),
      costReservation: { status: 'RESERVED', currency: 'CNY', provider: config.provider, model: config.model, estimatedCostMinor: 10, maximumCostMinor: 10 } };
    const providerPost = vi.fn(async () => ({ images: [] }));
    const getProviderConfig = vi.fn().mockResolvedValueOnce(frozenConfig)
      .mockResolvedValue({ ...frozenConfig, apiKey: 'synthetic-rotated-key', credentialRevision: { ...frozenConfig.credentialRevision, revision: 2 } });
    const repository = { getById: vi.fn(async () => job), markEnqueueFailed: vi.fn(async () => true) };
    const resolveProvider = vi.fn((_provider, _config, _created, dependencies) => ({ name: config.provider,
      generate: async () => { await dependencies.beforeProviderDispatch(); return providerPost(); } }));
    await expect(processAiImageQueueJob(job.id, 1, { repository: repository as any, getProviderConfig,
      getDispatchAuthorization: async () => ({ enabled: true, reasonCode: 'fixture-allowed', reason: 'fixture' }),
      resolveProvider, uploadBuffer: vi.fn(), run: (async (_id: string, _attempt: number, dependencies: any) => {
        job.status = 'RUNNING';
        return dependencies.provider.generate({ operation, prompt: 'fixture', negativePrompt: null, width: 900, height: 1200,
          model: config.model, count: 1, ...(operation === 'IMAGE_TO_IMAGE' ? { inputImages: [source] } : {}) });
      }) as any,
    })).rejects.toMatchObject({ code: 'PROVIDER_RUNTIME_CONTRACT_MISMATCH' });
    expect(getProviderConfig).toHaveBeenCalledTimes(2);
    expect(providerPost).not.toHaveBeenCalled();
  });

  it('rejects a count reservation in another currency before resolving the provider', async () => {
    const frozenConfig = { ...config, credentialRevision: { recordId: 'fixture-count-key', revision: 1, updatedAt: '2026-10-08T00:00:00.000Z' } };
    const job = { id: 'fixture-count-currency', ownerUserId: 'fixture-owner', provider: config.provider, model: config.model, operation: 'TEXT_TO_IMAGE',
      status: 'QUEUED', width: 900, height: 1200, requestedImageCount: 1, estimatedCostCents: 10,
      operationConfig: createAiImageProviderRuntimeContract(frozenConfig, { count: 1, width: 900, height: 1200 }),
      costReservation: { status: 'RESERVED', currency: 'USD', provider: config.provider, model: config.model, estimatedCostMinor: 10, maximumCostMinor: 10 } };
    const repository = { getById: vi.fn(async () => job), markEnqueueFailed: vi.fn(async () => true) };
    const resolveProvider = vi.fn();
    await processAiImageQueueJob(job.id, 1, { repository: repository as any, getProviderConfig: async () => frozenConfig,
      getDispatchAuthorization: async () => ({ enabled: true, reasonCode: 'fixture-allowed', reason: 'fixture' }), resolveProvider });
    expect(repository.markEnqueueFailed).toHaveBeenCalledWith(job.id, expect.objectContaining({ errorCode: 'AI_IMAGE_COST_RESERVATION_REQUIRED' }));
    expect(resolveProvider).not.toHaveBeenCalled();
  });
});
