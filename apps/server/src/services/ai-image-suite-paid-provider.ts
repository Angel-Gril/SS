import { createHash } from 'node:crypto';
import sharp, { type Metadata } from 'sharp';
import { getAiImageOperationProviderRuntimeConfig } from './ai-image-operation-runtime-config.js';
import { loadAiImageEditInputBuffer } from './ai-image-edit-input-reader.js';
import {
  createOpenAiImageEditProvider,
  MAX_OPENAI_IMAGE_EDIT_INPUT_BYTES,
  type BeforeAiImageProviderDispatch,
  type OpenAiImageEditProvider,
} from './ai-image-providers.js';
import type { AiImageProviderCapability } from './ai-image-provider-capabilities.js';
import type { AiMediaCapabilityEvidence } from './ai-image-provider-capabilities.js';
import { createDashScopeWanx21ImageEditProvider, type DashScopeWanx21ImageEditProvider } from './ai-image-wanx-edit-provider.js';
import { assertWanxImageToImageInput } from './ai-image-wanx-image-to-image.js';
import { AI_IMAGE_WANX21_EDIT_PROFILE, assertAiImageWanx21EditMedia } from './ai-image-wanx-edit-profile.js';
import type { AiProviderTaskLookupResult } from './ai-provider-reconciliation.js';
import {
  AI_IMAGE_SUITE_PAID_CHILD_OPERATION_CONFIG_VERSION,
  AI_IMAGE_SUITE_OUTPUT_HEIGHT,
  AI_IMAGE_SUITE_OUTPUT_PROFILE_VERSION,
  AI_IMAGE_SUITE_OUTPUT_WIDTH,
} from './ai-image-suite-materialization.js';
import {
  aiImageSuiteProviderRequestDimensions,
  isWanxAiImageSuiteProvider,
  aiImageSuiteProviderRuntimeMatches,
  createAiImageSuiteProviderRuntimeSnapshot,
  type AiImageSuiteFrozenProviderIdentity,
  type AiImageSuiteProviderRuntimeSettings,
} from './ai-image-suite-provider-runtime.js';
import {
  AI_IMAGE_SUITE_OUTPUT_NORMALIZER_VERSION,
} from './ai-image-suite-output-normalizer.js';
import {
  AiImageProviderRuntimeContractError,
  assertAiImageProviderRuntimeContract,
  bindAiImageProviderExecutionConfig,
} from './ai-image-provider-runtime-contract.js';
import type { AiImageProviderResult } from './ai-image-jobs.js';

const MAX_REFERENCE_COUNT = 16;
const MAX_PROMPT_BYTES = 100_000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export type AiImageSuitePaidProviderErrorCode =
  | 'SUITE_PROVIDER_RUNTIME_UNAVAILABLE'
  | 'SUITE_PROVIDER_RUNTIME_CHANGED'
  | 'SUITE_PROVIDER_INPUT_INVALID'
  | 'SUITE_PROVIDER_INPUT_MISMATCH'
  | 'SUITE_PROVIDER_UNSUPPORTED';

export class AiImageSuitePaidProviderError extends Error {
  constructor(
    public readonly code: AiImageSuitePaidProviderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AiImageSuitePaidProviderError';
  }
}

export interface AiImageSuitePaidProviderInputAsset {
  assetId: string;
  role: 'REFERENCE';
  ordinal: number;
  sha256: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
  storageBackend: 'local' | 'oss';
  storageKey: string;
  sizeBytes: number;
  kind: 'SOURCE_ORIGINAL';
  sourceCaptureSnapshotId: string;
}

export interface PrepareAiImageSuitePaidProviderInput {
  suite: AiImageSuiteFrozenProviderIdentity & {
    sourceCaptureSnapshotId: string;
  };
  job: {
    provider: string;
    model: string;
    prompt: string;
    negativePrompt: string | null;
    estimatedCostCents: number;
    inputAssets: unknown;
    operationConfig: unknown;
    providerJobId?: string | null;
  };
}

export interface PreparedAiImageSuitePaidProviderExecution {
  evidenceLevel: AiMediaCapabilityEvidence;
  providerRequest?: { width: number; height: number };
  recover?(providerJobId: string, beforeTaskLookup: BeforeAiImageProviderDispatch): Promise<AiProviderTaskLookupResult>;
  execute(
    onProviderAccepted: (providerJobId: string, providerAcceptedAt: Date) => Promise<void>,
    beforeProviderDispatch?: BeforeAiImageProviderDispatch,
  ): Promise<AiImageProviderResult>;
}

interface Dependencies {
  loadSettings?: () => Promise<AiImageSuiteProviderRuntimeSettings>;
  resolveCapability?: (provider: string, model: string) => AiImageProviderCapability | null;
  loadInputBuffer?: typeof loadAiImageEditInputBuffer;
  createOpenAiProvider?: (options: Parameters<typeof createOpenAiImageEditProvider>[0]) => OpenAiImageEditProvider;
  createWanxProvider?: (options: Parameters<typeof createDashScopeWanx21ImageEditProvider>[0]) => DashScopeWanx21ImageEditProvider;
}

async function defaultSettings(): Promise<AiImageSuiteProviderRuntimeSettings> {
  return getAiImageOperationProviderRuntimeConfig('IMAGE_TO_IMAGE');
}

function record(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : null;
}

function exactText(value: unknown, maximum: number): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value === value.trim()
    && value.length <= maximum;
}

function parseInputAssets(
  value: unknown,
  snapshotId: string,
): AiImageSuitePaidProviderInputAsset[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_REFERENCE_COUNT) {
    throw new AiImageSuitePaidProviderError(
      'SUITE_PROVIDER_INPUT_INVALID',
      'AI image suite paid execution requires a bounded frozen reference set',
    );
  }
  return value.map((raw, index) => {
    const asset = record(raw);
    if (!asset
      || !exactText(asset.assetId, 200)
      || asset.role !== 'REFERENCE'
      || asset.ordinal !== index
      || typeof asset.sha256 !== 'string'
      || !SHA256_PATTERN.test(asset.sha256)
      || !['image/png', 'image/jpeg', 'image/webp'].includes(asset.mimeType)
      || !Number.isSafeInteger(asset.width) || asset.width < 1
      || !Number.isSafeInteger(asset.height) || asset.height < 1
      || !['local', 'oss'].includes(asset.storageBackend)
      || !exactText(asset.storageKey, 2_000)
      || !Number.isSafeInteger(asset.sizeBytes) || asset.sizeBytes < 1 || asset.sizeBytes > 20 * 1024 * 1024
      || asset.kind !== 'SOURCE_ORIGINAL'
      || asset.sourceCaptureSnapshotId !== snapshotId) {
      throw new AiImageSuitePaidProviderError(
        'SUITE_PROVIDER_INPUT_INVALID',
        'AI image suite frozen reference identity is invalid',
      );
    }
    return asset as AiImageSuitePaidProviderInputAsset;
  });
}

function assertOperationConfig(
  value: unknown,
  settings: AiImageSuiteProviderRuntimeSettings,
  estimatedCostCents: number,
) {
  const config = record(value);
  const request = record(config?.providerRequest);
  const finalOutput = record(config?.finalOutput);
  const dimensions = aiImageSuiteProviderRequestDimensions(settings.provider, settings.model);
  if (!config
    || config.version !== AI_IMAGE_SUITE_PAID_CHILD_OPERATION_CONFIG_VERSION
    || config.outputProfile !== AI_IMAGE_SUITE_OUTPUT_PROFILE_VERSION
    || config.width !== AI_IMAGE_SUITE_OUTPUT_WIDTH
    || config.height !== AI_IMAGE_SUITE_OUTPUT_HEIGHT
    || !request
    || request.count !== 1
    || request.width !== dimensions.width
    || request.height !== dimensions.height
    || !finalOutput
    || finalOutput.profile !== AI_IMAGE_SUITE_OUTPUT_PROFILE_VERSION
    || finalOutput.width !== AI_IMAGE_SUITE_OUTPUT_WIDTH
    || finalOutput.height !== AI_IMAGE_SUITE_OUTPUT_HEIGHT
    || finalOutput.fit !== 'contain'
    || finalOutput.background !== '#ffffff'
    || finalOutput.format !== 'png'
    || finalOutput.normalizerVersion !== AI_IMAGE_SUITE_OUTPUT_NORMALIZER_VERSION) {
    throw new AiImageSuitePaidProviderError(
      'SUITE_PROVIDER_RUNTIME_CHANGED',
      'AI image suite paid operation contract is invalid',
    );
  }
  try {
    return assertAiImageProviderRuntimeContract(config.providerRuntime, settings, {
      count: 1,
      width: request.width,
      height: request.height,
      estimatedCostCents,
    });
  } catch (error) {
    throw new AiImageSuitePaidProviderError(
      'SUITE_PROVIDER_RUNTIME_CHANGED',
      error instanceof AiImageProviderRuntimeContractError
        ? error.message
        : 'AI image suite Provider runtime contract changed',
    );
  }
}

async function loadFrozenInputs(
  assets: AiImageSuitePaidProviderInputAsset[],
  load: typeof loadAiImageEditInputBuffer,
) {
  return Promise.all(assets.map(async (asset) => {
    const buffer = await load(asset as any);
    if (buffer.length !== asset.sizeBytes
      || createHash('sha256').update(buffer).digest('hex') !== asset.sha256) {
      throw new AiImageSuitePaidProviderError(
        'SUITE_PROVIDER_INPUT_MISMATCH',
        'AI image suite reference bytes changed after materialization',
      );
    }
    let metadata: Metadata;
    try {
      metadata = await sharp(buffer, { animated: false, failOn: 'warning' }).metadata();
    } catch {
      throw new AiImageSuitePaidProviderError(
        'SUITE_PROVIDER_INPUT_MISMATCH',
        'AI image suite reference image cannot be decoded',
      );
    }
    const decodedMime = metadata.format === 'png'
      ? 'image/png'
      : metadata.format === 'jpeg'
        ? 'image/jpeg'
        : metadata.format === 'webp'
          ? 'image/webp'
          : null;
    if (decodedMime !== asset.mimeType
      || metadata.width !== asset.width
      || metadata.height !== asset.height
      || Number(metadata.pages ?? 1) !== 1) {
      throw new AiImageSuitePaidProviderError(
        'SUITE_PROVIDER_INPUT_MISMATCH',
        'AI image suite reference encoding or dimensions changed after materialization',
      );
    }
    return { buffer, mimeType: asset.mimeType };
  }));
}

export async function prepareAiImageSuitePaidProviderExecution(
  input: PrepareAiImageSuitePaidProviderInput,
  dependencies: Dependencies = {},
): Promise<PreparedAiImageSuitePaidProviderExecution> {
  const wanx = isWanxAiImageSuiteProvider(input.job.provider, input.job.model);
  const frozenTaskId = input.job.providerJobId || null;
  const loadBoundSettings = async () => {
    const active = await (dependencies.loadSettings || defaultSettings)();
    if (!wanx) return active;
    if (active.currency !== 'CNY') {
      throw new AiImageSuitePaidProviderError('SUITE_PROVIDER_RUNTIME_CHANGED', 'Wanx suite currency changed');
    }
    try {
      return bindAiImageProviderExecutionConfig(record(input.job.operationConfig)?.providerRuntime, active, {
        count: 1, ...aiImageSuiteProviderRequestDimensions(input.job.provider, input.job.model),
        estimatedCostCents: input.job.estimatedCostCents,
      });
    } catch {
      throw new AiImageSuitePaidProviderError('SUITE_PROVIDER_RUNTIME_CHANGED', 'Wanx suite runtime or credential revision changed');
    }
  };
  const settings = await loadBoundSettings();
  const snapshot = createAiImageSuiteProviderRuntimeSnapshot(settings, {
    resolveCapability: dependencies.resolveCapability,
  });
  if (!snapshot.executionReady
    || (!wanx && snapshot.capability?.evidenceLevel !== 'sandbox-verified')
    || !snapshot.providerRuntime) {
    throw new AiImageSuitePaidProviderError(
      'SUITE_PROVIDER_RUNTIME_UNAVAILABLE',
      snapshot.reason,
    );
  }
  if (!aiImageSuiteProviderRuntimeMatches(input.suite, snapshot)
    || input.job.provider !== input.suite.provider
    || input.job.model !== input.suite.model) {
    throw new AiImageSuitePaidProviderError(
      'SUITE_PROVIDER_RUNTIME_CHANGED',
      'Active AI image suite Provider identity no longer matches the frozen suite',
    );
  }
  if (!wanx && !['openai-images', 'custom'].includes(settings.provider)) {
    throw new AiImageSuitePaidProviderError(
      'SUITE_PROVIDER_UNSUPPORTED',
      'Only an exact sandbox-verified OpenAI-compatible image edit adapter supports paid suites',
    );
  }
  assertOperationConfig(input.job.operationConfig, settings, input.job.estimatedCostCents);
  const prompt = input.job.prompt;
  if (typeof prompt !== 'string'
    || !prompt
    || prompt !== prompt.trim()
    || Buffer.byteLength(prompt, 'utf8') > MAX_PROMPT_BYTES) {
    throw new AiImageSuitePaidProviderError(
      'SUITE_PROVIDER_INPUT_INVALID',
      'AI image suite frozen Prompt is invalid',
    );
  }
  const negativePrompt = input.job.negativePrompt;
  if (negativePrompt !== null
    && (typeof negativePrompt !== 'string'
      || negativePrompt !== negativePrompt.trim()
      || Buffer.byteLength(negativePrompt, 'utf8') > MAX_PROMPT_BYTES)) {
    throw new AiImageSuitePaidProviderError(
      'SUITE_PROVIDER_INPUT_INVALID',
      'AI image suite frozen negative Prompt is invalid',
    );
  }
  const assets = parseInputAssets(
    input.job.inputAssets,
    input.suite.sourceCaptureSnapshotId,
  );
  const dimensions = aiImageSuiteProviderRequestDimensions(settings.provider, settings.model);
  const wanxPrompt = wanx ? assertWanxImageToImageInput({
    count: 1, ...dimensions, referenceCount: assets.length, prompt, negativePrompt,
  }) : null;
  if (assets.length > (snapshot.capability?.maxReferences || 0)) {
    throw new AiImageSuitePaidProviderError(
      'SUITE_PROVIDER_INPUT_INVALID',
      'AI image suite reference count exceeds the frozen Provider capability',
    );
  }
  let totalInputBytes = 0;
  for (const asset of assets) {
    if (asset.sizeBytes > MAX_OPENAI_IMAGE_EDIT_INPUT_BYTES - totalInputBytes) {
      throw new AiImageSuitePaidProviderError(
        'SUITE_PROVIDER_INPUT_INVALID',
        'AI image suite frozen references exceed the OpenAI edit input byte limit',
      );
    }
    totalInputBytes += asset.sizeBytes;
  }
  if (totalInputBytes > MAX_OPENAI_IMAGE_EDIT_INPUT_BYTES) {
    throw new AiImageSuitePaidProviderError(
      'SUITE_PROVIDER_INPUT_INVALID',
      'AI image suite frozen references exceed the OpenAI edit input byte limit',
    );
  }
  const images = await loadFrozenInputs(
    assets,
    dependencies.loadInputBuffer || loadAiImageEditInputBuffer,
  );
  if (wanx) {
    if (totalInputBytes > AI_IMAGE_WANX21_EDIT_PROFILE.maximumInputBytes) {
      throw new AiImageSuitePaidProviderError('SUITE_PROVIDER_INPUT_INVALID', 'Wanx suite reference exceeds the input byte limit');
    }
    assertAiImageWanx21EditMedia({ source: {
      bytes: images[0]!.buffer, width: assets[0]!.width, height: assets[0]!.height,
    } });
  }

  return {
    evidenceLevel: snapshot.capability!.evidenceLevel,
    ...(wanx ? { providerRequest: dimensions, async recover(providerJobId: string, beforeTaskLookup: BeforeAiImageProviderDispatch) {
      if (!frozenTaskId || providerJobId !== frozenTaskId) {
        throw new AiImageSuitePaidProviderError('SUITE_PROVIDER_INPUT_MISMATCH', 'Recovery must query the original accepted suite task');
      }
      const active = await loadBoundSettings();
      const provider = (dependencies.createWanxProvider || createDashScopeWanx21ImageEditProvider)({
        ...active,
        beforeTaskLookup: async () => { await loadBoundSettings(); await beforeTaskLookup(); },
      });
      return provider.poll(providerJobId);
    } } : {}),
    async execute(onProviderAccepted, beforeProviderDispatch) {
      if (frozenTaskId) {
        throw new AiImageSuitePaidProviderError('SUITE_PROVIDER_INPUT_MISMATCH', 'An accepted suite task may only be recovered, never submitted again');
      }
      const active = wanx ? await loadBoundSettings() : settings;
      const createProvider = wanx
        ? dependencies.createWanxProvider || createDashScopeWanx21ImageEditProvider
        : dependencies.createOpenAiProvider || createOpenAiImageEditProvider;
      const provider = createProvider({
        baseUrl: active.baseUrl,
        apiKey: active.apiKey,
        model: active.model,
        costPerImageCents: active.costPerImageCents,
        onProviderJobCreated: onProviderAccepted,
        beforeProviderDispatch: wanx
          ? async () => { await loadBoundSettings(); await beforeProviderDispatch?.(); }
          : beforeProviderDispatch,
      });
      return provider.edit({
        operation: 'IMAGE_TO_IMAGE',
        prompt: wanxPrompt?.resolvedPrompt || prompt,
        negativePrompt: wanxPrompt ? wanxPrompt.resolvedNegativePrompt : negativePrompt,
        ...dimensions,
        model: settings.model,
        images,
        mask: null,
      });
    },
  };
}
