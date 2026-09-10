import Fastify, { type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { aiImageRoutes, resolveAiImageEditReadiness } from '../routes/ai-images.js';
import { resolveAiImageEditProvider } from '../workers/ai-image-edit.js';
import {
  resolveAiImageProviderCapability, supportsAiMediaOperation,
  type AiImageProviderCapability,
} from '../services/ai-image-provider-capabilities.js';
import { aiImageProviderEndpointSha256, createAiImageProviderRuntimeContract } from '../services/ai-image-provider-runtime-contract.js';
import { createDashScopeWanx21ImageEditProvider } from '../services/ai-image-wanx-edit-provider.js';
import { AiPromptTemplateRegistryService } from '../services/ai-prompt-template-registry.js';
import { InMemoryAiPromptTemplateStore } from '../services/ai-prompt-templates.js';
import { createAiMediaWorkflowService, type CreateAiImageEditWorkflowInput } from '../services/ai-media-workflows.js';
import { assertAiImageEditCostReservation } from '../services/ai-image-edit-dispatch.js';
import { PrismaAiImageJobRepository } from '../repositories/ai-image-job-repository.js';
import { assertWanxHostedEditPrompt } from '../services/ai-image-edit-provider-contract.js';

const config = {
  provider: 'dashscope-wanx', model: 'wanx2.1-imageedit',
  baseUrl: 'https://dashscope.aliyuncs.com/api/v1', apiKey: 'synthetic-wanx-hosted-key',
  costPerImageCents: 7,
  credentialRevision: {
    recordId: 'synthetic-wanx-hosted-record', revision: 3, updatedAt: '2026-09-09T10:00:00.000Z',
  },
};
const PROFILE = 'ai-image-wanx21-edit-prompt/v1' as const;
const settings = { ...config, fullEditEnabled: true, inpaintEnabled: true, estimatedCostCents: 7 };
const readyStorage = { ready: true, backend: 'local' as const, reason: 'synthetic local storage' };

function capability(baseUrl = config.baseUrl): AiImageProviderCapability {
  return {
    provider: config.provider, model: config.model, operations: ['FULL_EDIT', 'INPAINT'],
    maxReferences: 1, supportsMask: true, inputTransport: 'base64', resultMode: 'async',
    evidenceLevel: 'sandbox-verified', evidence: 'SYNTHETIC TEST ONLY; not a live promotion',
    sandboxEvidence: (['FULL_EDIT', 'INPAINT'] as const).map((operation) => ({
      endpointSha256: aiImageProviderEndpointSha256(config.provider, baseUrl),
      operation, inputTransport: 'base64', resultMode: 'async',
    })),
  };
}

function promptRegistry() {
  return new AiPromptTemplateRegistryService(new InMemoryAiPromptTemplateStore(), { getLegacyPrompt: async () => 'Unused legacy prompt' });
}

async function editInput(operation: 'FULL_EDIT' | 'INPAINT' = 'FULL_EDIT'): Promise<CreateAiImageEditWorkflowInput> {
  const templateKey = operation === 'FULL_EDIT' ? 'full-image-edit.base' : 'inpaint.base';
  const resolved = await promptRegistry().resolveTemplate({ templateKey, renderingProfile: PROFILE, variables: {
    userPrompt: '只改背景，保持商品。', userNegativePrompt: '不要新增文字。',
  } });
  return {
    operation, ownerUserId: 'owner-1', actorUserId: 'owner-1', sourceAssetId: 'source-1',
    width: 1024, height: 1024, prompt: '只改背景，保持商品。', negativePrompt: '不要新增文字。',
    resolvedPrompt: resolved.resolvedPrompt, resolvedNegativePrompt: resolved.resolvedNegativePrompt,
    templateKey, templateReleaseId: resolved.release.id, templateChecksum: resolved.checksum,
    templateSnapshot: resolved.snapshot, provider: config.provider, model: config.model,
    estimatedCostCents: 7, dailyLimit: 20, context: { type: 'collect', id: 'goods-1' },
    providerRuntimeContract: createAiImageProviderRuntimeContract(config, { count: 1, width: 1024, height: 1024 }),
    ...(operation === 'INPAINT' ? { maskAssetId: 'mask-1', maskSemantics: 'WHITE_EDIT_BLACK_PRESERVE_V1' as const } : {}),
    idempotencyKey: 'wanx-hosted-synthetic',
  };
}

function workflowRepository() {
  return {
    createImageEdit: vi.fn(async (input: CreateAiImageEditWorkflowInput) => ({
      kind: 'created', jobId: 'job-1',
      workflow: { id: 'workflow-1', ownerUserId: input.ownerUserId, actorUserId: input.actorUserId,
        operation: input.operation, status: 'QUEUED', reviewStatus: 'NOT_READY', revision: 1,
        currentAttempt: 1, inputs: [], jobs: [], events: [] },
    })),
  };
}

describe('Wanx hosted edit entry', () => {
  it.each(['CNY', undefined])('rejects a non-USD or missing reservation currency: %s', (currency) => {
    expect(() => assertAiImageEditCostReservation({
      provider: config.provider, model: config.model, requestFingerprint: 'f'.repeat(64), estimatedCostCents: 7,
      costReservation: { id: 'reservation-1', provider: config.provider, model: config.model,
        requestFingerprint: 'f'.repeat(64), status: 'RESERVED', estimatedCostMinor: 7, maximumCostMinor: 7, currency },
    } as never)).toThrowError(expect.objectContaining({ code: 'AI_IMAGE_COST_RESERVATION_REQUIRED' }));
  });

  it('projects the persisted currency through the real job repository', async () => {
    const findUnique = vi.fn(async () => ({ id: 'job-1', costReservation: { id: 'reservation-1', currency: 'USD' } }));
    const repository = new PrismaAiImageJobRepository({ aiImageJob: { findUnique } } as never);
    expect((await repository.getById('job-1'))?.costReservation).toMatchObject({ currency: 'USD' });
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({ costReservation: { select: expect.objectContaining({ currency: true }) } }),
    }));
  });

  it('characterizes the exact edit model without promoting it or inheriting text-to-image', () => {
    expect(resolveAiImageProviderCapability(config.provider, config.model)).toMatchObject({
      model: config.model, operations: ['FULL_EDIT', 'INPAINT'],
      inputTransport: 'base64', resultMode: 'async', evidenceLevel: 'adapter-characterized',
    });
    expect(supportsAiMediaOperation(config.provider, config.model, 'TEXT_TO_IMAGE')).toBe(false);
    expect(supportsAiMediaOperation(config.provider, config.model, 'IMAGE_TO_IMAGE', 1)).toBe(false);
    expect(resolveAiImageEditReadiness('FULL_EDIT', settings, { storageReadiness: readyStorage }).ready).toBe(false);
    expect(resolveAiImageEditProvider(config.provider, config.model, 'FULL_EDIT', config).name).toBe('disabled');
  });

  it.each(['FULL_EDIT', 'INPAINT'] as const)('requires exact async evidence for %s', (operation) => {
    expect(resolveAiImageEditReadiness(operation, settings, {
      storageReadiness: readyStorage, resolveCapability: () => capability(),
    })).toMatchObject({ ready: true, reasonCode: 'READY' });
    expect(resolveAiImageEditReadiness(operation, settings, {
      storageReadiness: readyStorage,
      resolveCapability: () => capability('https://workspace-other.cn-beijing.maas.aliyuncs.com/api/v1'),
    }).ready).toBe(false);
    const wrongTransport = capability();
    wrongTransport.sandboxEvidence = wrongTransport.sandboxEvidence!.map((entry) => ({ ...entry, inputTransport: 'multipart', resultMode: 'sync' }));
    expect(resolveAiImageEditReadiness(operation, settings, {
      storageReadiness: readyStorage, resolveCapability: () => wrongTransport,
    }).ready).toBe(false);
  });

  it('rejects an ambiguous bare origin rather than freezing another endpoint spelling', () => {
    const baseUrl = 'https://dashscope.aliyuncs.com';
    expect(resolveAiImageEditReadiness('FULL_EDIT', { ...settings, baseUrl }, {
      storageReadiness: readyStorage, resolveCapability: () => capability(baseUrl),
    }).ready).toBe(false);
  });

  it.each(['', 'https://DASHSCOPE.aliyuncs.com/api/v1/'])('preserves the exact default endpoint through harmless normalization: %s', (baseUrl) => {
    expect(resolveAiImageEditReadiness('FULL_EDIT', { ...settings, baseUrl }, {
      storageReadiness: readyStorage, resolveCapability: () => capability(),
    }).ready).toBe(true);
  });

  it('uses the real async adapter and forwards the final dispatch fence and acceptance callback', async () => {
    const input = await editInput();
    const source = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#334455' } }).png().toBuffer();
    const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ output: { task_id: 'synthetic-hosted-task', task_status: 'PENDING' } }))
      .mockResolvedValueOnce(json({ output: { task_id: 'synthetic-hosted-task', task_status: 'SUCCEEDED',
        results: [{ url: 'https://dashscope-test.oss-cn-beijing.aliyuncs.com/hosted.png' }],
        task_metrics: { TOTAL: 1, SUCCEEDED: 1, FAILED: 0 } }, usage: { image_count: 1 } }))
      .mockResolvedValueOnce(new Response(source, { headers: { 'content-type': 'image/png' } }));
    const beforeProviderDispatch = vi.fn(async () => undefined);
    const accepted = vi.fn(async () => undefined);
    const provider = resolveAiImageEditProvider(config.provider, config.model, 'FULL_EDIT', config, accepted, 'test', {
      resolveCapability: () => capability(), beforeProviderDispatch,
      createWanxEditProvider: (options) => createDashScopeWanx21ImageEditProvider({ ...options, fetch: fetcher, pollIntervalMs: 0 }),
    });
    expect(provider.name).toBe(config.provider);
    await expect(provider.generate({
      operation: 'FULL_EDIT', model: config.model, prompt: input.resolvedPrompt, negativePrompt: input.resolvedNegativePrompt,
      count: 1, width: 1024, height: 1024, inputImages: [{ buffer: source, mimeType: 'image/png' }],
    })).resolves.toMatchObject({ providerJobId: 'synthetic-hosted-task', actualCostCents: 7 });
    expect(beforeProviderDispatch).toHaveBeenCalledOnce();
    expect(accepted).toHaveBeenCalledWith('synthetic-hosted-task', expect.any(Date));
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).input.prompt).toBe(input.resolvedPrompt);
    expect(fetcher.mock.calls.map((call) => call[1]?.method)).toEqual(['POST', 'GET', 'GET']);
  });

  it('accepts a fully frozen compiled request at the real workflow service with fixture evidence', async () => {
    const repository = workflowRepository();
    const service = createAiMediaWorkflowService(repository as never, { resolveCapability: () => capability() });
    await expect(service.createImageEdit(await editInput())).resolves.toMatchObject({ jobId: 'job-1' });
    expect(repository.createImageEdit).toHaveBeenCalledOnce();
    expect(repository.createImageEdit).toHaveBeenCalledWith(expect.objectContaining({
      providerRuntimeContract: expect.objectContaining({
        contractVersion: 'ai-image-provider-runtime/v2', credentialRevision: config.credentialRevision,
      }),
    }));
  });

  it.each(['prompt', 'negative', 'contract', 'checksum', 'release', 'empty-release', 'null-release'] as const)('rejects altered frozen %s before persistence', async (field) => {
    const input = await editInput();
    if (field === 'prompt') input.resolvedPrompt += '改成别的商品';
    if (field === 'negative') input.resolvedNegativePrompt = 'silently ignored';
    if (field === 'contract') input.templateSnapshot = { ...input.templateSnapshot, renderingContract: {} };
    if (field === 'checksum') input.templateChecksum = 'a'.repeat(64);
    if (field === 'release') input.templateReleaseId = 'another-release';
    if (field === 'empty-release' || field === 'null-release') {
      const releaseId = field === 'empty-release' ? '' : null;
      input.templateReleaseId = releaseId as unknown as string;
      input.templateSnapshot = { ...input.templateSnapshot, releaseId };
    }
    expect(() => assertWanxHostedEditPrompt(input)).toThrowError(expect.objectContaining({ code: 'FROZEN_PROMPT_MISMATCH' }));
    const repository = workflowRepository();
    const service = createAiMediaWorkflowService(repository as never, { resolveCapability: () => capability() });
    await expect(service.createImageEdit(input)).rejects.toMatchObject({ code: 'FROZEN_PROMPT_MISMATCH' });
    expect(repository.createImageEdit).not.toHaveBeenCalled();
  });

  it.each([
    { width: 1024, height: 1024, text: '只改背景。', expected: 202 },
    { width: 1024, height: 1536, text: '只改背景。', expected: 422 },
    { width: 512, height: 512, text: '只改背景。', expected: 422 },
    { width: 1024, height: 1024, text: '长'.repeat(801), expected: 400 },
  ])('selects the profile and rejects incompatible input before HTTP materialization: $width x $height / $expected', async (testCase) => {
    const repository = workflowRepository();
    const service = createAiMediaWorkflowService(repository as never, { resolveCapability: () => capability() });
    const prompts = promptRegistry();
    const enqueue = vi.fn(async () => undefined);
    const app = Fastify();
    await app.register(aiImageRoutes, {
      repository: {} as never, mediaWorkflowService: service,
      authenticate: async (request: FastifyRequest) => { (request as any).user = { userId: 'owner-1', actorUserId: 'owner-1' }; },
      getMediaWorkflowEnabled: async () => true, getSourceListingWebMediaEnabled: async () => true,
      getEditSettings: async () => ({ ...settings, imageToImageEnabled: false, dailyLimit: 20 }),
      getEditStorageReadiness: async () => readyStorage,
      getOwnedAssetDimensions: async () => ({ width: testCase.width, height: testCase.height }),
      resolveProviderCapability: () => capability(),
      resolveEditPrompt: (input: Parameters<AiPromptTemplateRegistryService['resolveTemplate']>[0]) => prompts.resolveTemplate(input), enqueueEdit: enqueue,
    });
    try {
      const response = await app.inject({ method: 'POST', url: '/workflows', payload: {
        operation: 'FULL_EDIT', sourceAssetId: 'source-1', userPrompt: testCase.text, userNegativePrompt: '不要加字。',
        idempotencyKey: 'synthetic-wanx-http', context: { type: 'collect', id: 'goods-1' },
      } });
      expect(response.statusCode, response.body).toBe(testCase.expected);
      if (testCase.expected === 202) {
        expect(repository.createImageEdit).toHaveBeenCalledWith(expect.objectContaining({
          provider: config.provider, model: config.model, resolvedNegativePrompt: '',
          providerRuntimeContract: expect.objectContaining({
            contractVersion: 'ai-image-provider-runtime/v2', credentialRevision: config.credentialRevision,
          }),
          templateSnapshot: expect.objectContaining({ renderingContract: expect.objectContaining({ profile: PROFILE }) }),
        }));
        expect(enqueue).toHaveBeenCalledWith('job-1');
      } else {
        expect(repository.createImageEdit).not.toHaveBeenCalled();
        expect(enqueue).not.toHaveBeenCalled();
      }
    } finally { await app.close(); }
  });
});
