import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { getConfig } from '../config/system-config-schema.js';
import { loadAiImageEditInputBuffer } from './ai-image-edit-input-reader.js';
import {
  createOpenAiImageEditProvider,
  MAX_OPENAI_IMAGE_EDIT_INPUT_BYTES,
  type BeforeAiImageProviderDispatch,
  type OpenAiImageEditProvider,
} from './ai-image-providers.js';
import type { AiImageProviderCapability } from './ai-image-provider-capabilities.js';
import {
  AI_IMAGE_SUITE_PAID_CHILD_OPERATION_CONFIG_VERSION,
  AI_IMAGE_SUITE_OUTPUT_HEIGHT,
  AI_IMAGE_SUITE_OUTPUT_PROFILE_VERSION,
  AI_IMAGE_SUITE_OUTPUT_WIDTH,
} from './ai-image-suite-materialization.js';
import {
  AI_IMAGE_SUITE_PROVIDER_REQUEST_HEIGHT,
  AI_IMAGE_SUITE_PROVIDER_REQUEST_WIDTH,
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
  };
}

export interface PreparedAiImageSuitePaidProviderExecution {
  evidenceLevel: 'sandbox-verified';
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
}

async function defaultSettings(): Promise<AiImageSuiteProviderRuntimeSettings> {
  const [provider, baseUrl, apiKey, model, costPerImageCents] = await Promise.all([
    getConfig('ai_image_provider'),
    getConfig('ai_image_base_url'),
    getConfig('ai_image_api_key'),
    getConfig('ai_image_model'),
    getConfig('ai_image_generation_cost_cents'),
  ]);
  return { provider, baseUrl, apiKey, model, costPerImageCents };
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
  if (!config
    || config.version !== AI_IMAGE_SUITE_PAID_CHILD_OPERATION_CONFIG_VERSION
    || config.outputProfile !== AI_IMAGE_SUITE_OUTPUT_PROFILE_VERSION
    || config.width !== AI_IMAGE_SUITE_OUTPUT_WIDTH
    || config.height !== AI_IMAGE_SUITE_OUTPUT_HEIGHT
    || !request
    || request.count !== 1
    || request.width !== AI_IMAGE_SUITE_PROVIDER_REQUEST_WIDTH
    || request.height !== AI_IMAGE_SUITE_PROVIDER_REQUEST_HEIGHT
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
    let metadata: sharp.Metadata;
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
  const settings = await (dependencies.loadSettings || defaultSettings)();
  const snapshot = createAiImageSuiteProviderRuntimeSnapshot(settings, {
    resolveCapability: dependencies.resolveCapability,
  });
  if (!snapshot.executionReady
    || snapshot.capability?.evidenceLevel !== 'sandbox-verified'
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
  if (settings.provider !== 'openai-images') {
    throw new AiImageSuitePaidProviderError(
      'SUITE_PROVIDER_UNSUPPORTED',
      'Only the exact sandbox-verified OpenAI image edit adapter supports paid suites',
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

  return {
    evidenceLevel: 'sandbox-verified',
    async execute(onProviderAccepted, beforeProviderDispatch) {
      const provider = (dependencies.createOpenAiProvider || createOpenAiImageEditProvider)({
        baseUrl: settings.baseUrl,
        apiKey: settings.apiKey,
        model: settings.model,
        costPerImageCents: settings.costPerImageCents,
        onProviderJobCreated: onProviderAccepted,
        beforeProviderDispatch,
      });
      return provider.edit({
        operation: 'IMAGE_TO_IMAGE',
        prompt,
        negativePrompt,
        width: AI_IMAGE_SUITE_PROVIDER_REQUEST_WIDTH,
        height: AI_IMAGE_SUITE_PROVIDER_REQUEST_HEIGHT,
        model: settings.model,
        images,
        mask: null,
      });
    },
  };
}
