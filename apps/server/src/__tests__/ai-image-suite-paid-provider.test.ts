import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { AiImageProviderCapability } from '../services/ai-image-provider-capabilities.js';
import { aiImageProviderEndpointSha256 } from '../services/ai-image-provider-runtime-contract.js';
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
