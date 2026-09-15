import { describe, expect, it, vi } from 'vitest';
import * as launchOwner from '../services/extension-media-workflow-launch.js';
import { assertExtensionMediaJobProviderAuthorized } from '../services/extension-media-workflow-commands.js';
import { resolveAiImageEditReadiness, resolveAiImageToImageReadiness } from '../routes/ai-images.js';
import { resolveAiImageProviderCapability } from '../services/ai-image-provider-capabilities.js';
import { createAiImageProviderRuntimeContract, type AiImageProviderRuntimeIdentity } from '../services/ai-image-provider-runtime-contract.js';
import { assertWanxHostedEditPrompt } from '../services/ai-image-edit-provider-contract.js';
import { AiPromptTemplateRegistryService } from '../services/ai-prompt-template-registry.js';
import { InMemoryAiPromptTemplateStore } from '../services/ai-prompt-templates.js';

type Operation = 'IMAGE_TO_IMAGE' | 'FULL_EDIT' | 'INPAINT';
const openai: AiImageProviderRuntimeIdentity = {
  provider: 'openai-images', model: 'gpt-image-1', baseUrl: 'https://api.openai.com/v1', costPerImageCents: 9,
};
const wanx: AiImageProviderRuntimeIdentity = {
  provider: 'dashscope-wanx', model: 'wanx2.1-imageedit', baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
  costPerImageCents: 14, currency: 'CNY',
  credentialRevision: { recordId: 'synthetic-config', revision: 3, updatedAt: '2026-09-15T00:00:00.000Z' },
};
const readinessOptions = {
  production: true, storageReadiness: { ready: true, backend: 'local' as const, reason: 'synthetic owned storage' },
  resolveImageToImageReadiness: resolveAiImageToImageReadiness, resolveAiImageEditReadiness,
};
function settings(config: AiImageProviderRuntimeIdentity) {
  return { ...config, generationEnabled: true, imageToImageEnabled: true, fullEditEnabled: true, inpaintEnabled: true,
    globalDailyBudgetCents: 1000 };
}
function currentReadiness(operation: Operation, config: AiImageProviderRuntimeIdentity) {
  const common = { ...config, estimatedCostCents: config.costPerImageCents };
  const core = operation === 'IMAGE_TO_IMAGE'
    ? resolveAiImageToImageReadiness({ ...common, enabled: true, ...readinessOptions })
    : resolveAiImageEditReadiness(operation, { ...common, generationEnabled: true, fullEditEnabled: true, inpaintEnabled: true }, readinessOptions);
  return { ...core, ...config, testOnly: core.testOnly === true, globalDailyBudgetCents: 1000,
    evidenceLevel: resolveAiImageProviderCapability(config.provider, config.model)?.evidenceLevel };
}
function command(operation: Operation) {
  return { schemaVersion: 'ai-media-workflow-create/v2', action: 'CREATE_WORKFLOW', operation,
    sourceMediaKeys: ['media-main-1'], prompt: '只改背景，保留商品。'.normalize('NFKC'), negativePrompt: '不要增加文字。',
    draftRevision: 11, workflowOperationKey: 'normal-extension-image-intent',
    ...(operation === 'INPAINT' ? { maskAssetId: 'mask-1', maskSemantics: 'WHITE_EDIT_BLACK_PRESERVE_V1' } : {}) };
}
function invocation(operation: Operation) {
  return { ownerUserId: 'owner-1', actorUserId: 'actor-1', shopId: 'shop-1', listingWorkflowId: 'listing-1',
    draftVersion: 7, idempotencyKey: 'normal-extension-command', command: command(operation) };
}
function existing(operation: Operation, config: AiImageProviderRuntimeIdentity, status = 'QUEUED') {
  return { id: 'existing-workflow', ownerUserId: 'owner-1', operation, provider: config.provider, model: config.model,
    status, revision: 1, contextType: 'listing-draft', contextId: 'listing-1', contextDraftRevision: 11,
    contextDraftVersion: 7, sourceMediaKeys: ['media-main-1'], sourceMediaKey: 'media-main-1', suiteId: null,
    maskAssetId: operation === 'INPAINT' ? 'mask-1' : null, prompt: command(operation).prompt,
    negativePrompt: command(operation).negativePrompt, jobId: 'existing-job', estimatedCostCents: config.costPerImageCents,
    providerRuntimeContract: createAiImageProviderRuntimeContract(config, { count: 1, width: 1024, height: 1024 }) };
}
function harness(operation: Operation, config: AiImageProviderRuntimeIdentity, options: {
  existing?: ReturnType<typeof existing>;
  width?: number;
  height?: number;
  forceReady?: boolean;
} = {}) {
  const registry = new AiPromptTemplateRegistryService(new InMemoryAiPromptTemplateStore(), { getLegacyPrompt: async () => '' });
  const createImageToImage = vi.fn(async () => ({ workflow: { id: 'created', status: 'QUEUED', revision: 1 }, jobId: 'created-job', replayed: false }));
  const createImageEdit = vi.fn(async (input) => {
    if (config.provider === 'dashscope-wanx') assertWanxHostedEditPrompt(input);
    return { workflow: { id: 'created', status: 'QUEUED', revision: 1 }, jobId: 'created-job', replayed: false };
  });
  const internalizeSource = vi.fn(async () => ({ id: 'asset-1', width: options.width ?? 1024, height: options.height ?? 1024 }));
  const getReadiness = vi.fn(async (selected: Operation, frozen?: unknown) => {
    const project = Reflect.get(launchOwner, 'resolveExtensionMediaStandaloneReadiness');
    const readiness = typeof project === 'function'
      ? project(selected, settings(config), readinessOptions, frozen)
      : currentReadiness(selected, config);
    return options.forceReady ? { ...readiness, enabled: true, ready: true, testOnly: false, evidenceLevel: 'sandbox-verified' } : readiness;
  });
  const resolvePrompt = vi.fn((input: Parameters<AiPromptTemplateRegistryService['resolveTemplate']>[0]) => registry.resolveTemplate(input));
  const enqueueGeneration = vi.fn(async () => undefined), enqueueEdit = vi.fn(async () => undefined);
  const launch = launchOwner.createExtensionMediaWorkflowLauncher({
    workflowService: { createImageToImage, createImageEdit } as never,
    loadContext: async () => ({ id: 'listing-1', ownerUserId: 'owner-1', shopId: 'shop-1', supplyGoodsId: 'goods-1',
      snapshotId: 'snapshot-1', revision: 11, draftVersion: 7, sourceMediaKeys: ['media-main-1'] }),
    loadExisting: async () => options.existing || null, internalizeSource, getReadiness,
    getEditDailyLimit: async () => 5, resolvePrompt, enqueueGeneration, enqueueEdit,
    markEnqueueFailed: async () => true, production: true,
  });
  return { launch: () => launch(invocation(operation)), createImageToImage, createImageEdit, resolvePrompt,
    internalizeSource, getReadiness, enqueueGeneration, enqueueEdit };
}

describe('normal extension media admission and runtime bindings', () => {
  it.each(['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'] as const)('shares the generation master in the %s readiness projection', (operation) => {
    const project = Reflect.get(launchOwner, 'resolveExtensionMediaStandaloneReadiness');
    expect(project).toBeTypeOf('function');
    expect(project(operation, settings(openai), readinessOptions)).toMatchObject({ ready: true, testOnly: false });
    expect(project(operation, { ...settings(openai), generationEnabled: false }, readinessOptions))
      .toMatchObject({ enabled: false, ready: false });
  });

  it.each(['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'] as const)('launches configured OpenAI %s through the normal registry', async (operation) => {
    const state = harness(operation, openai);
    await expect(state.launch()).resolves.toMatchObject({ operation, status: 'QUEUED', replayed: false });
    expect(operation === 'IMAGE_TO_IMAGE' ? state.createImageToImage : state.createImageEdit).toHaveBeenCalledOnce();
  });

  it.each(['FULL_EDIT', 'INPAINT'] as const)('freezes Wanx %s CNY, credentials and the native prompt profile', async (operation) => {
    const state = harness(operation, wanx);
    await expect(state.launch()).resolves.toMatchObject({ operation, status: 'QUEUED' });
    expect(state.resolvePrompt).toHaveBeenCalledWith(expect.objectContaining({ renderingProfile: 'ai-image-wanx21-edit-prompt/v1' }));
    expect(state.createImageEdit).toHaveBeenCalledWith(expect.objectContaining({
      providerRuntimeContract: expect.objectContaining({ contractVersion: 'ai-image-provider-runtime/v3',
        currency: 'CNY', unitCostCents: 14, credentialRevision: wanx.credentialRevision }),
    }));
  });

  it.each([undefined, 'CNY'] as const)('replays a running Wanx workflow with its versioned %s quote', async (currency) => {
    const state = harness('FULL_EDIT', wanx, { existing: existing('FULL_EDIT', { ...wanx, currency }, 'RUNNING') });
    await expect(state.launch()).resolves.toMatchObject({ workflowId: 'existing-workflow', replayed: true });
    expect(state.getReadiness).not.toHaveBeenCalled();
    expect(state.createImageEdit).not.toHaveBeenCalled();
  });

  it.each([0, 99])('re-enqueues the same queued job at its confirmed price after active price changes to %s', async (costPerImageCents) => {
    const frozen = existing('IMAGE_TO_IMAGE', openai);
    const state = harness('IMAGE_TO_IMAGE', { ...openai, costPerImageCents }, { existing: frozen });
    await expect(state.launch()).resolves.toMatchObject({ workflowId: frozen.id, replayed: true });
    expect(state.getReadiness).toHaveBeenCalledWith('IMAGE_TO_IMAGE', frozen.providerRuntimeContract);
    expect(state.enqueueGeneration).toHaveBeenCalledExactlyOnceWith('existing-job');
    expect(state.createImageToImage).not.toHaveBeenCalled();
  });

  it('rejects an unregistered custom edit even when an obsolete readiness claims sandbox verification', async () => {
    const state = harness('FULL_EDIT', { ...openai, provider: 'custom', model: 'unregistered-edit', baseUrl: 'https://relay.example/v1' }, { forceReady: true });
    await expect(state.launch()).rejects.toMatchObject({ code: 'MEDIA_PROVIDER_NOT_ALLOWED' });
    expect(state.internalizeSource).not.toHaveBeenCalled();
    expect(state.createImageEdit).not.toHaveBeenCalled();
  });

  it('rejects a non-1024 Wanx canvas before workflow creation', async () => {
    const state = harness('FULL_EDIT', wanx, { width: 1024, height: 1536 });
    await expect(state.launch()).rejects.toMatchObject({ code: 'MEDIA_PROVIDER_NOT_ALLOWED' });
    expect(state.createImageEdit).not.toHaveBeenCalled();
  });

  it.each([
    { operation: 'IMAGE_TO_IMAGE' as const, config: openai },
    { operation: 'FULL_EDIT' as const, config: openai },
    { operation: 'INPAINT' as const, config: wanx },
  ])('authorizes a normal $operation retry using its complete frozen runtime', ({ operation, config }) => {
    const runtime = createAiImageProviderRuntimeContract(config, { count: 1, width: 1024, height: 1024 });
    expect(() => assertExtensionMediaJobProviderAuthorized({ operation,
      job: { ...config, operation, requestedImageCount: 1, width: 1024, height: 1024,
        estimatedCostCents: config.costPerImageCents,
        operationConfig: operation === 'IMAGE_TO_IMAGE' ? runtime : { providerRuntime: runtime } },
      readiness: currentReadiness(operation, config), production: true, requireReadiness: true, requireGlobalDailyBudget: true,
    })).not.toThrow();
  });
});
