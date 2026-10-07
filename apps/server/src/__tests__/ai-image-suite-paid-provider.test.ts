import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { resolveAiImageProviderCapability, type AiImageProviderCapability } from '../services/ai-image-provider-capabilities.js';
import { aiImageProviderEndpointSha256 } from '../services/ai-image-provider-runtime-contract.js';
import { AI_IMAGE_DONOR_GPT2_NORMALIZER_VERSION, createDonorGpt2FullFrameConfig } from '../services/ai-image-donor-gpt2-profile.js';
import type {
  OpenAiImageEditProviderOptions,
  OpenAiImageEditRequest,
} from '../services/ai-image-providers.js';
import {
  AiImageSuitePaidProviderError,
  type AiImageSuitePaidProviderInputAsset,
  type PrepareAiImageSuitePaidProviderInput,
  prepareAiImageSuitePaidProviderExecution,
} from '../services/ai-image-suite-paid-provider.js';
import {
  AI_IMAGE_SUITE_OUTPUT_HEIGHT,
  AI_IMAGE_SUITE_OUTPUT_PROFILE_VERSION,
  AI_IMAGE_SUITE_OUTPUT_WIDTH,
  AI_IMAGE_SUITE_PAID_CHILD_OPERATION_CONFIG_VERSION,
} from '../services/ai-image-suite-materialization.js';
import { AI_IMAGE_SUITE_OUTPUT_NORMALIZER_VERSION } from '../services/ai-image-suite-output-normalizer.js';
import {
  AI_IMAGE_SUITE_PROVIDER_REQUEST_HEIGHT,
  AI_IMAGE_SUITE_PROVIDER_REQUEST_WIDTH,
  createAiImageSuiteProviderRuntimeSnapshot,
  type AiImageSuiteProviderRuntimeSettings,
} from '../services/ai-image-suite-provider-runtime.js';

const SNAPSHOT_ID = 'snapshot-paid-suite-1';

let referencePng: Buffer;
let changedReferencePng: Buffer;

beforeAll(async () => {
  referencePng = await sharp({
    create: {
      width: 3,
      height: 2,
      channels: 4,
      background: { r: 12, g: 34, b: 56, alpha: 1 },
    },
  }).png().toBuffer();
  changedReferencePng = await sharp({
    create: {
      width: 3,
      height: 2,
      channels: 4,
      background: { r: 65, g: 43, b: 21, alpha: 1 },
    },
  }).png().toBuffer();
});

function settings(
  overrides: Partial<AiImageSuiteProviderRuntimeSettings> = {},
): AiImageSuiteProviderRuntimeSettings {
  return {
    provider: 'openai-images',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'active-secret-key',
    model: 'gpt-image-1',
    costPerImageCents: 8,
    concurrencyLimit: 2,
    ...overrides,
  };
}

function capability(
  evidenceLevel: AiImageProviderCapability['evidenceLevel'] = 'sandbox-verified',
  overrides: Partial<AiImageProviderCapability> = {},
): AiImageProviderCapability {
  return {
    provider: 'openai-images',
    model: 'gpt-image-1',
    operations: ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'],
    maxReferences: 16,
    supportsMask: true,
    inputTransport: 'multipart',
    resultMode: 'sync',
    evidenceLevel,
    evidence: 'isolated test evidence',
    ...(evidenceLevel === 'sandbox-verified' ? {
      sandboxEvidence: [{
        endpointSha256: aiImageProviderEndpointSha256(
          'openai-images',
          'https://api.openai.com/v1',
        ),
        operation: 'IMAGE_TO_IMAGE' as const,
        inputTransport: 'multipart' as const,
        resultMode: 'sync' as const,
      }],
    } : {}),
    ...overrides,
  };
}

function frozenAsset(
  overrides: Partial<AiImageSuitePaidProviderInputAsset> = {},
): AiImageSuitePaidProviderInputAsset {
  return {
    assetId: 'asset-reference-1',
    role: 'REFERENCE',
    ordinal: 0,
    sha256: createHash('sha256').update(referencePng).digest('hex'),
    mimeType: 'image/png',
    width: 3,
    height: 2,
    storageBackend: 'local',
    storageKey: 'reference-paid-suite.png',
    sizeBytes: referencePng.length,
    kind: 'SOURCE_ORIGINAL',
    sourceCaptureSnapshotId: SNAPSHOT_ID,
    ...overrides,
  };
}

function validInput(
  activeSettings = settings(),
  activeCapability = capability(),
): PrepareAiImageSuitePaidProviderInput {
  const snapshot = createAiImageSuiteProviderRuntimeSnapshot(activeSettings, {
    resolveCapability: () => activeCapability,
  });
  if (!snapshot.providerConfig || !snapshot.providerRuntime) {
    throw new Error('test fixture requires a paid Provider runtime');
  }
  const providerConfig = snapshot.providerConfig;
  return {
    suite: {
      provider: providerConfig.provider,
      model: providerConfig.model,
      providerConfigHash: providerConfig.providerConfigHash,
      pricingVersion: providerConfig.pricingVersion,
      concurrencyLimit: providerConfig.concurrencyLimit,
      itemCount: 1,
      estimatedCostCents: providerConfig.estimatedCostPerImageCents,
      maximumCostCents: providerConfig.maximumCostPerImageCents,
      sourceCaptureSnapshotId: SNAPSHOT_ID,
    },
    job: {
      provider: providerConfig.provider,
      model: providerConfig.model,
      prompt: 'Place the supplied product on a clean studio background.',
      negativePrompt: 'text, watermark',
      estimatedCostCents: providerConfig.estimatedCostPerImageCents,
      inputAssets: [frozenAsset()],
      operationConfig: {
        version: AI_IMAGE_SUITE_PAID_CHILD_OPERATION_CONFIG_VERSION,
        outputProfile: AI_IMAGE_SUITE_OUTPUT_PROFILE_VERSION,
        width: AI_IMAGE_SUITE_OUTPUT_WIDTH,
        height: AI_IMAGE_SUITE_OUTPUT_HEIGHT,
        providerRuntime: snapshot.providerRuntime,
        providerRequest: {
          count: 1,
          width: AI_IMAGE_SUITE_PROVIDER_REQUEST_WIDTH,
          height: AI_IMAGE_SUITE_PROVIDER_REQUEST_HEIGHT,
        },
        finalOutput: {
          profile: AI_IMAGE_SUITE_OUTPUT_PROFILE_VERSION,
          width: AI_IMAGE_SUITE_OUTPUT_WIDTH,
          height: AI_IMAGE_SUITE_OUTPUT_HEIGHT,
          fit: 'contain',
          background: '#ffffff',
          format: 'png',
          normalizerVersion: AI_IMAGE_SUITE_OUTPUT_NORMALIZER_VERSION,
        },
        ...(activeSettings.provider === 'custom' && ['gpt-image-2','gpt-image-2-count'].includes(activeSettings.model) ? {
          requestProfile: createDonorGpt2FullFrameConfig().requestProfile,
          providerRequest: createDonorGpt2FullFrameConfig().providerRequest,
          finalOutput: createDonorGpt2FullFrameConfig().finalOutput,
        } : {}),
      },
    },
  };
}

function inputAssets(input: PrepareAiImageSuitePaidProviderInput) {
  return input.job.inputAssets as AiImageSuitePaidProviderInputAsset[];
}

function paidDependencies(overrides: Record<string, unknown> = {}) {
  return {
    loadSettings: vi.fn(async () => settings()),
    resolveCapability: vi.fn(() => capability()),
    loadInputBuffer: vi.fn(async () => referencePng),
    ...overrides,
  };
}

describe('AI image suite paid Provider preparation', () => {
  it('refuses a rotated count-relay credential before creating a Provider or sending its saved command',async()=>{
    const active=settings({provider:'custom',model:'gpt-image-2-count',baseUrl:'https://ai.big-model-api.top/v1',
      credentialRevision:{recordId:'fixture-count-key',revision:1,updatedAt:'2026-10-08T00:00:00.000Z'}});
    const input=validInput(active,resolveAiImageProviderCapability(active.provider,active.model)!);
    const createOpenAiProvider=vi.fn();const prepared=await prepareAiImageSuitePaidProviderExecution(input,{loadSettings:async()=>active,
      loadInputBuffer:async()=>referencePng,createOpenAiProvider});
    active.credentialRevision={...active.credentialRevision!,revision:2};
    await expect(prepared.execute(async()=>undefined)).rejects.toMatchObject({code:'SUITE_PROVIDER_RUNTIME_CHANGED'});
    expect(createOpenAiProvider).not.toHaveBeenCalled();
  });
  const donorSettings = () => settings({ provider: 'custom', model: 'gpt-image-2', baseUrl: 'https://configured-provider.example/v1' });
  const donorCapability = (evidenceLevel: AiImageProviderCapability['evidenceLevel'] = 'sandbox-verified') => capability(evidenceLevel, {
    provider: 'custom', model: 'gpt-image-2', operations: ['IMAGE_TO_IMAGE'], supportsMask: false,
    ...(evidenceLevel === 'sandbox-verified' ? { sandboxEvidence: [{
      endpointSha256: aiImageProviderEndpointSha256('custom', donorSettings().baseUrl),
      operation: 'IMAGE_TO_IMAGE', inputTransport: 'multipart', resultMode: 'sync',
    }] } : {}),
  });

  it('keeps donor GPT2 dark under the registered adapter-only capability before source reads or Provider creation', async () => {
    const activeSettings = donorSettings();
    const sourceRead = vi.fn();
    const createOpenAiProvider = vi.fn();
    await expect(prepareAiImageSuitePaidProviderExecution(validInput(activeSettings, donorCapability()), {
      loadSettings: async () => activeSettings, loadInputBuffer: sourceRead, createOpenAiProvider,
    })).rejects.toMatchObject({ code: 'SUITE_PROVIDER_RUNTIME_UNAVAILABLE' });
    expect(sourceRead).not.toHaveBeenCalled();
    expect(createOpenAiProvider).not.toHaveBeenCalled();
  });

  it('preserves the frozen donor source bytes and reference shape without pre-padding its frame', async () => {
    const activeSettings = donorSettings();
    const activeCapability = donorCapability();
    const input = validInput(activeSettings, activeCapability);
    const edit = vi.fn(async (_request: OpenAiImageEditRequest) => ({ images: [{ buffer: referencePng, mimeType: 'image/png' }], actualCostCents: 8 }));
    const createOpenAiProvider = vi.fn(() => ({ name: 'donor-image-edits', edit }));
    const prepared = await prepareAiImageSuitePaidProviderExecution(input, {
      loadSettings: async () => activeSettings, resolveCapability: () => activeCapability,
      loadInputBuffer: async () => referencePng, createOpenAiProvider,
    });
    expect(prepared.normalizerVersion).toBe(AI_IMAGE_DONOR_GPT2_NORMALIZER_VERSION);
    expect(createOpenAiProvider).not.toHaveBeenCalled();
    await prepared.execute(async () => undefined);
    expect(createOpenAiProvider).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: activeSettings.baseUrl, model: 'gpt-image-2', costPerImageCents: 8,
    }));
    const request = edit.mock.calls[0]![0];
    expect(request).toMatchObject({ operation: 'IMAGE_TO_IMAGE', width: 1008, height: 1344, model: 'gpt-image-2', mask: null });
    expect(request.images[0]!.buffer).toBe(referencePng);
    expect(await sharp(request.images[0]!.buffer).metadata()).toMatchObject({ width: 3, height: 2 });
    expect(inputAssets(input)[0]!.sha256).toBe(createHash('sha256').update(referencePng).digest('hex'));
    expect(input.job.operationConfig).not.toHaveProperty('referenceCanvas');
  });

  it.each([
    ['request dimensions', (config: any) => { config.providerRequest.width = 1024; }],
    ['quality', (config: any) => { config.providerRequest.quality = 'auto'; }],
    ['normalizer version', (config: any) => { config.finalOutput.normalizerVersion = AI_IMAGE_SUITE_OUTPUT_NORMALIZER_VERSION; }],
    ['padding recipe', (config: any) => { config.referenceCanvas = { width: 768, height: 1024 }; }],
    ['count', (config: any) => { config.providerRequest.count = 2; }],
  ])('rejects a changed frozen donor %s before loading bytes or constructing the Provider', async (_label, mutate) => {
    const activeSettings = donorSettings();
    const activeCapability = donorCapability();
    const input = validInput(activeSettings, activeCapability);
    mutate(input.job.operationConfig);
    const loadInputBuffer = vi.fn();
    const createOpenAiProvider = vi.fn();
    await expect(prepareAiImageSuitePaidProviderExecution(input, {
      loadSettings: async () => activeSettings, resolveCapability: () => activeCapability, loadInputBuffer, createOpenAiProvider,
    })).rejects.toMatchObject({ code: 'SUITE_PROVIDER_RUNTIME_CHANGED' });
    expect(loadInputBuffer).not.toHaveBeenCalled();
    expect(createOpenAiProvider).not.toHaveBeenCalled();
  });

  it('uses Wanx single-reference transport and read-only recovery with the frozen quote', async () => {
    const source = await sharp({ create: { width: 512, height: 512, channels: 3, background: 'white' } }).png().toBuffer();
    const activeSettings = settings({ provider: 'dashscope-wanx', model: 'wanx2.1-imageedit',
      baseUrl: 'https://dashscope.aliyuncs.com/api/v1', costPerImageCents: 14, currency: 'CNY',
      credentialRevision: { recordId: 'wanx-credential', revision: 4, updatedAt: '2026-09-16T00:00:00.000Z' } });
    const input = validInput(activeSettings, resolveAiImageProviderCapability(activeSettings.provider, activeSettings.model)!);
    (input.job.operationConfig as any).providerRequest = { count: 1, width: 1024, height: 1024 };
    input.job.inputAssets = [frozenAsset({ width: 512, height: 512, sizeBytes: source.length,
      sha256: createHash('sha256').update(source).digest('hex') })];
    const edit = vi.fn(async () => ({ images: [{ buffer: source, mimeType: 'image/png' }], providerJobId: 'wanx-task-original', actualCostCents: 14 }));
    const poll = vi.fn(async () => ({ status: 'PENDING', providerJobId: 'wanx-task-original', providerStatus: 'RUNNING' }));
    const createWanxProvider = vi.fn(() => ({ name: 'dashscope-wanx21-image-edit', edit, poll }));
    const createOpenAiProvider = vi.fn();
    const deps = {
      loadSettings: async () => ({ ...activeSettings, costPerImageCents: 99 }),
      loadInputBuffer: async () => source, createWanxProvider, createOpenAiProvider,
    };
    const prepared = await prepareAiImageSuitePaidProviderExecution(input, deps as any);
    await prepared.execute(async () => undefined);
    expect(createOpenAiProvider).not.toHaveBeenCalled();
    expect(createWanxProvider).toHaveBeenCalledWith(expect.objectContaining({ costPerImageCents: 14 }));
    expect(edit).toHaveBeenCalledWith(expect.objectContaining({ operation: 'IMAGE_TO_IMAGE', width: 1024, height: 1024,
      prompt: expect.stringContaining('避免：text, watermark'), negativePrompt: '', images: [{ buffer: source, mimeType: 'image/png' }] }));
    const recoveryPrepared = await prepareAiImageSuitePaidProviderExecution({ ...input, job: { ...input.job, providerJobId: 'wanx-task-original' } }, deps as any);
    await expect(recoveryPrepared.execute(async () => undefined)).rejects.toMatchObject({ code: 'SUITE_PROVIDER_INPUT_MISMATCH' });
    await expect(recoveryPrepared.recover!('wanx-task-original', async () => undefined)).resolves.toMatchObject({ status: 'PENDING' });
    expect(poll).toHaveBeenCalledWith('wanx-task-original');
    expect(edit).toHaveBeenCalledTimes(1);
    await expect(recoveryPrepared.recover!('different-task', async () => undefined)).rejects.toMatchObject({ code: 'SUITE_PROVIDER_INPUT_MISMATCH' });
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it('keeps adapter-characterized evidence dark', async () => {
    const createOpenAiProvider = vi.fn();
    await expect(prepareAiImageSuitePaidProviderExecution(validInput(), paidDependencies({
      resolveCapability: vi.fn(() => capability('adapter-characterized')),
      createOpenAiProvider,
    }) as any)).rejects.toMatchObject({
      code: 'SUITE_PROVIDER_RUNTIME_UNAVAILABLE',
    });
    expect(createOpenAiProvider).not.toHaveBeenCalled();
  });

  it('rejects a wildcard capability even when it claims sandbox evidence', async () => {
    const loadInputBuffer = vi.fn(async () => referencePng);
    await expect(prepareAiImageSuitePaidProviderExecution(validInput(), paidDependencies({
      resolveCapability: vi.fn(() => capability('sandbox-verified', { model: '*' })),
      loadInputBuffer,
    }) as any)).rejects.toMatchObject({
      code: 'SUITE_PROVIDER_RUNTIME_UNAVAILABLE',
    });
    expect(loadInputBuffer).not.toHaveBeenCalled();
  });

  it('prepares only an exact sandbox capability and defers Provider construction until execute', async () => {
    const acceptedAt = new Date('2026-07-24T00:00:00.000Z');
    const result = {
      images: [{ buffer: Buffer.from('provider-output'), mimeType: 'image/png' }],
      providerJobId: 'provider-request-1',
      actualCostCents: 8,
    };
    const edit = vi.fn(async (_request: OpenAiImageEditRequest) => result);
    const createOpenAiProvider = vi.fn((options: OpenAiImageEditProviderOptions) => ({
      name: 'openai-image-edits',
      edit: vi.fn(async (request: OpenAiImageEditRequest) => {
        await options.beforeProviderDispatch?.();
        await options.onProviderJobCreated?.('provider-request-1', acceptedAt);
        return edit(request);
      }),
    }));
    const onProviderAccepted = vi.fn(async () => undefined);
    const beforeProviderDispatch = vi.fn(async () => undefined);

    const prepared = await prepareAiImageSuitePaidProviderExecution(validInput(), paidDependencies({
      createOpenAiProvider,
    }) as any);

    expect(prepared.evidenceLevel).toBe('sandbox-verified');
    expect(createOpenAiProvider).not.toHaveBeenCalled();
    expect(edit).not.toHaveBeenCalled();
    expect(onProviderAccepted).not.toHaveBeenCalled();

    await expect(prepared.execute(onProviderAccepted, beforeProviderDispatch)).resolves.toEqual(result);
    expect(createOpenAiProvider).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'active-secret-key',
      model: 'gpt-image-1',
      costPerImageCents: 8,
      onProviderJobCreated: onProviderAccepted,
      beforeProviderDispatch,
    }));
    expect(edit).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'IMAGE_TO_IMAGE',
      model: 'gpt-image-1',
      width: AI_IMAGE_SUITE_PROVIDER_REQUEST_WIDTH,
      height: AI_IMAGE_SUITE_PROVIDER_REQUEST_HEIGHT,
      images: [{ buffer: referencePng, mimeType: 'image/png' }],
      mask: null,
    }));
    expect(onProviderAccepted).toHaveBeenCalledWith('provider-request-1', acceptedAt);
    expect(beforeProviderDispatch).toHaveBeenCalledOnce();
  });

  it('prepares an exact sandbox-verified custom OpenAI-compatible relay', async () => {
    const activeSettings = settings({
      provider: 'custom',
      baseUrl: 'https://relay.example',
      model: 'relay-image-v2',
    });
    const activeCapability = capability('sandbox-verified', {
      provider: 'custom',
      model: 'relay-image-v2',
      operations: ['IMAGE_TO_IMAGE'],
      sandboxEvidence: [{
        endpointSha256: aiImageProviderEndpointSha256('custom', 'https://relay.example/v1'),
        operation: 'IMAGE_TO_IMAGE',
        inputTransport: 'multipart',
        resultMode: 'sync',
      }],
    });
    const input = validInput(activeSettings, activeCapability);
    const result = {
      images: [{ buffer: Buffer.from('relay-output'), mimeType: 'image/png' as const }],
      providerJobId: 'relay-request-1',
      actualCostCents: 8,
    };
    const edit = vi.fn(async () => result);
    const createOpenAiProvider = vi.fn(() => ({ name: 'openai-image-edits', edit }));

    const prepared = await prepareAiImageSuitePaidProviderExecution(input, paidDependencies({
      loadSettings: vi.fn(async () => activeSettings),
      resolveCapability: vi.fn(() => activeCapability),
      createOpenAiProvider,
    }) as any);

    await expect(prepared.execute(vi.fn(async () => undefined))).resolves.toEqual(result);
    expect(input.suite).toMatchObject({ provider: 'custom', model: 'relay-image-v2' });
    expect(input.job).toMatchObject({ provider: 'custom', model: 'relay-image-v2' });
    expect(createOpenAiProvider).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'https://relay.example',
      model: 'relay-image-v2',
      costPerImageCents: 8,
    }));
    expect(edit).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'IMAGE_TO_IMAGE',
      model: 'relay-image-v2',
      images: [{ buffer: referencePng, mimeType: 'image/png' }],
      mask: null,
    }));
  });

  it('keeps a custom relay dark without exact sandbox evidence', async () => {
    const activeSettings = settings({
      provider: 'custom',
      baseUrl: 'https://relay.example/v1',
      model: 'relay-image-v2',
    });
    const activeCapability = capability('adapter-characterized', {
      provider: 'custom',
      model: 'relay-image-v2',
      operations: ['IMAGE_TO_IMAGE'],
    });
    const loadInputBuffer = vi.fn(async () => referencePng);
    const createOpenAiProvider = vi.fn();

    await expect(prepareAiImageSuitePaidProviderExecution(
      validInput(activeSettings, activeCapability),
      paidDependencies({
        loadSettings: vi.fn(async () => activeSettings),
        resolveCapability: vi.fn(() => activeCapability),
        loadInputBuffer,
        createOpenAiProvider,
      }) as any,
    )).rejects.toMatchObject({ code: 'SUITE_PROVIDER_RUNTIME_UNAVAILABLE' });
    expect(loadInputBuffer).not.toHaveBeenCalled();
    expect(createOpenAiProvider).not.toHaveBeenCalled();
  });

  it('keeps an exact custom relay bound to the frozen suite and job identity', async () => {
    const activeSettings = settings({
      provider: 'custom',
      baseUrl: 'https://relay.example/v1',
      model: 'relay-image-v2',
    });
    const activeCapability = capability('sandbox-verified', {
      provider: 'custom',
      model: 'relay-image-v2',
      operations: ['IMAGE_TO_IMAGE'],
      sandboxEvidence: [{
        endpointSha256: aiImageProviderEndpointSha256('custom', 'https://relay.example/v1'),
        operation: 'IMAGE_TO_IMAGE',
        inputTransport: 'multipart',
        resultMode: 'sync',
      }],
    });
    const mutations: Array<(input: PrepareAiImageSuitePaidProviderInput) => void> = [
      (input) => { input.suite.provider = 'openai-images'; },
      (input) => { input.job.model = 'other-relay-model'; },
    ];

    for (const mutate of mutations) {
      const input = validInput(activeSettings, activeCapability);
      mutate(input);
      const loadInputBuffer = vi.fn(async () => referencePng);
      const createOpenAiProvider = vi.fn();
      await expect(prepareAiImageSuitePaidProviderExecution(input, paidDependencies({
        loadSettings: vi.fn(async () => activeSettings),
        resolveCapability: vi.fn(() => activeCapability),
        loadInputBuffer,
        createOpenAiProvider,
      }) as any)).rejects.toMatchObject({ code: 'SUITE_PROVIDER_RUNTIME_CHANGED' });
      expect(loadInputBuffer).not.toHaveBeenCalled();
      expect(createOpenAiProvider).not.toHaveBeenCalled();
    }
  });

  it('fails closed when active endpoint configuration drifts from the frozen suite', async () => {
    const loadInputBuffer = vi.fn(async () => referencePng);
    await expect(prepareAiImageSuitePaidProviderExecution(validInput(), paidDependencies({
      loadSettings: vi.fn(async () => settings({ baseUrl: 'https://images.example.com/v1' })),
      loadInputBuffer,
    }) as any)).rejects.toMatchObject({
      code: 'SUITE_PROVIDER_RUNTIME_UNAVAILABLE',
    });
    expect(loadInputBuffer).not.toHaveBeenCalled();
  });

  it('fails closed when the frozen operation runtime no longer matches active cost or endpoint', async () => {
    const input = validInput();
    const operationConfig = input.job.operationConfig as Record<string, any>;
    operationConfig.providerRuntime = {
      ...operationConfig.providerRuntime,
      unitCostCents: 9,
      maximumCostCents: 9,
    };
    const loadInputBuffer = vi.fn(async () => referencePng);

    await expect(prepareAiImageSuitePaidProviderExecution(input, paidDependencies({
      loadInputBuffer,
    }) as any)).rejects.toMatchObject({
      code: 'SUITE_PROVIDER_RUNTIME_CHANGED',
    });
    expect(loadInputBuffer).not.toHaveBeenCalled();
  });

  it('rejects changed reference bytes even when the replacement image has the same dimensions', async () => {
    await expect(prepareAiImageSuitePaidProviderExecution(validInput(), paidDependencies({
      loadInputBuffer: vi.fn(async () => changedReferencePng),
    }) as any)).rejects.toMatchObject({
      code: 'SUITE_PROVIDER_INPUT_MISMATCH',
    });
  });

  it('rejects a frozen MIME identity that disagrees with the stored image encoding', async () => {
    const input = validInput();
    inputAssets(input)[0]!.mimeType = 'image/jpeg';

    await expect(prepareAiImageSuitePaidProviderExecution(input, paidDependencies() as any))
      .rejects.toMatchObject({
        code: 'SUITE_PROVIDER_INPUT_MISMATCH',
      });
  });

  it('rejects frozen dimensions that disagree with the stored image', async () => {
    const input = validInput();
    inputAssets(input)[0]!.width = 4;

    await expect(prepareAiImageSuitePaidProviderExecution(input, paidDependencies() as any))
      .rejects.toMatchObject({
        code: 'SUITE_PROVIDER_INPUT_MISMATCH',
      });
  });

  it('accepts only trusted storage backends and rejects local path traversal before file access', async () => {
    const untrustedBackend = validInput();
    (inputAssets(untrustedBackend)[0] as any).storageBackend = 'r2';
    const loadInputBuffer = vi.fn(async () => referencePng);
    await expect(prepareAiImageSuitePaidProviderExecution(untrustedBackend, paidDependencies({
      loadInputBuffer,
    }) as any)).rejects.toMatchObject({
      code: 'SUITE_PROVIDER_INPUT_INVALID',
    });
    expect(loadInputBuffer).not.toHaveBeenCalled();

    const traversal = validInput();
    inputAssets(traversal)[0]!.storageKey = '../outside-upload-root.png';
    await expect(prepareAiImageSuitePaidProviderExecution(traversal, paidDependencies({
      loadInputBuffer: undefined,
    }) as any)).rejects.toMatchObject({
      code: 'INVALID_MEDIA_INPUT',
    });
  });

  it('rejects mutated paid-operation shapes before reading any reference', async () => {
    const mutations: Array<(operation: Record<string, any>) => void> = [
      (operation) => { operation.version = 'ai-image-suite-child-operation/v1'; },
      (operation) => { operation.providerRequest.count = 2; },
      (operation) => { operation.providerRequest.width = AI_IMAGE_SUITE_OUTPUT_WIDTH; },
      (operation) => { operation.finalOutput.fit = 'cover'; },
      (operation) => { operation.finalOutput.format = 'svg'; },
      (operation) => { operation.finalOutput.normalizerVersion = 'attacker-normalizer/v1'; },
    ];

    for (const mutate of mutations) {
      const input = validInput();
      mutate(input.job.operationConfig as Record<string, any>);
      const loadInputBuffer = vi.fn(async () => referencePng);
      await expect(prepareAiImageSuitePaidProviderExecution(input, paidDependencies({
        loadInputBuffer,
      }) as any)).rejects.toBeInstanceOf(AiImageSuitePaidProviderError);
      expect(loadInputBuffer).not.toHaveBeenCalled();
    }
  });
});
