import { createHash } from 'node:crypto';
import {
  AI_IMAGE_SUITE_MAX_CONCURRENCY,
  type AiImageSuiteProviderConfig,
} from './ai-image-suite.js';
import {
  AI_IMAGE_SUITE_OUTPUT_HEIGHT,
  AI_IMAGE_SUITE_OUTPUT_PROFILE_VERSION,
  AI_IMAGE_SUITE_OUTPUT_WIDTH,
} from './ai-image-suite-materialization.js';
import {
  AI_IMAGE_SUITE_MODEL,
  AI_IMAGE_SUITE_PROVIDER,
  hasExactAiMediaSandboxEvidence,
  resolveAiImageProviderCapability,
  type AiImageProviderCapability,
  type AiMediaCapabilityEvidence,
} from './ai-image-provider-capabilities.js';
import {
  createAiImageProviderRuntimeContract,
  type AiImageProviderRuntimeContract,
} from './ai-image-provider-runtime-contract.js';
import {
  AI_IMAGE_SUITE_OUTPUT_NORMALIZER_VERSION,
  AI_IMAGE_SUITE_PROVIDER_OUTPUT_HEIGHT,
  AI_IMAGE_SUITE_PROVIDER_OUTPUT_WIDTH,
} from './ai-image-suite-output-normalizer.js';
import { hashAiMediaPlanningJson } from './ai-media-planning.js';

export const AI_IMAGE_SUITE_PROVIDER_REQUEST_WIDTH =
  AI_IMAGE_SUITE_PROVIDER_OUTPUT_WIDTH;
export const AI_IMAGE_SUITE_PROVIDER_REQUEST_HEIGHT =
  AI_IMAGE_SUITE_PROVIDER_OUTPUT_HEIGHT;
export const AI_IMAGE_SUITE_PROVIDER_RUNTIME_VERSION =
  'ai-image-suite-provider-runtime/v1' as const;
export const AI_IMAGE_SUITE_PAID_PRICING_VERSION =
  'ai-image-suite-price/v1' as const;
export const AI_IMAGE_SUITE_DEFAULT_CONCURRENCY = 2;

export interface AiImageSuiteProviderRuntimeSettings {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  costPerImageCents: number;
  concurrencyLimit?: number;
}

export type AiImageSuiteProviderRuntimeReasonCode =
  | 'READY'
  | 'FAKE_PRODUCTION_BLOCKED'
  | 'PROVIDER_DISABLED'
  | 'PROVIDER_CAPABILITY_UNSUPPORTED'
  | 'PROVIDER_CONFIG_INVALID'
  | 'PROVIDER_CREDENTIAL_MISSING'
  | 'PROVIDER_EVIDENCE_UNVERIFIED';

export interface AiImageSuiteProviderRuntimeSnapshot {
  providerConfig: AiImageSuiteProviderConfig | null;
  providerRuntime: AiImageProviderRuntimeContract | null;
  capability: {
    provider: string;
    model: string;
    evidenceLevel: AiMediaCapabilityEvidence;
    inputTransport: AiImageProviderCapability['inputTransport'];
    resultMode: AiImageProviderCapability['resultMode'];
    maxReferences: number;
  } | null;
  configured: boolean;
  executionReady: boolean;
  testOnly: boolean;
  reasonCode: AiImageSuiteProviderRuntimeReasonCode;
  reason: string;
}

export interface AiImageSuiteFrozenProviderIdentity {
  provider: string;
  model: string;
  providerConfigHash: string;
  pricingVersion: string;
  concurrencyLimit: number;
  itemCount: number;
  estimatedCostCents: number;
  maximumCostCents: number;
}

interface RuntimeDependencies {
  nodeEnv?: string;
  resolveCapability?: typeof resolveAiImageProviderCapability;
}

function fakeConfig(): AiImageSuiteProviderConfig {
  const provider = AI_IMAGE_SUITE_PROVIDER;
  const model = AI_IMAGE_SUITE_MODEL;
  const pricingVersion = 'provider-free-zero/v1';
  const providerConfigHash = createHash('sha256').update(JSON.stringify({
    version: 'ai-image-suite-runtime/v1',
    provider,
    model,
    pricingVersion,
    estimatedCostPerImageCents: 0,
    maximumCostPerImageCents: 0,
    concurrencyLimit: AI_IMAGE_SUITE_DEFAULT_CONCURRENCY,
  })).digest('hex');
  return {
    provider,
    model,
    providerConfigHash,
    pricingVersion,
    estimatedCostPerImageCents: 0,
    maximumCostPerImageCents: 0,
    concurrencyLimit: AI_IMAGE_SUITE_DEFAULT_CONCURRENCY,
  };
}

export function createProviderFreeAiImageSuiteConfig(): AiImageSuiteProviderConfig {
  return fakeConfig();
}

function invalidSnapshot(
  reasonCode: AiImageSuiteProviderRuntimeReasonCode,
  reason: string,
): AiImageSuiteProviderRuntimeSnapshot {
  return {
    providerConfig: null,
    providerRuntime: null,
    capability: null,
    configured: false,
    executionReady: false,
    testOnly: true,
    reasonCode,
    reason,
  };
}

function safeConcurrency(value: number | undefined): number | null {
  const normalized = value ?? AI_IMAGE_SUITE_DEFAULT_CONCURRENCY;
  return Number.isSafeInteger(normalized)
    && normalized >= 1
    && normalized <= AI_IMAGE_SUITE_MAX_CONCURRENCY
    ? normalized
    : null;
}

function exactImageToImageCapability(
  value: AiImageProviderCapability | null,
  provider: string,
  model: string,
): value is AiImageProviderCapability {
  return Boolean(
    value
    && value.provider === provider
    && value.model === model
    && value.model !== '*'
    && value.operations.includes('IMAGE_TO_IMAGE')
    && value.maxReferences >= 1
    && value.maxReferences <= 16
    && value.inputTransport === 'multipart'
    && value.resultMode === 'sync'
  );
}

function publicCapability(value: AiImageProviderCapability) {
  return {
    provider: value.provider,
    model: value.model,
    evidenceLevel: value.evidenceLevel,
    inputTransport: value.inputTransport,
    resultMode: value.resultMode,
    maxReferences: value.maxReferences,
  };
}

function paidConfig(
  providerRuntime: AiImageProviderRuntimeContract,
  concurrencyLimit: number,
): AiImageSuiteProviderConfig {
  const providerConfigHash = hashAiMediaPlanningJson({
    version: AI_IMAGE_SUITE_PROVIDER_RUNTIME_VERSION,
    providerRuntime,
    finalOutput: {
      profile: AI_IMAGE_SUITE_OUTPUT_PROFILE_VERSION,
      width: AI_IMAGE_SUITE_OUTPUT_WIDTH,
      height: AI_IMAGE_SUITE_OUTPUT_HEIGHT,
      fit: 'contain',
      background: '#ffffff',
      format: 'png',
      normalizerVersion: AI_IMAGE_SUITE_OUTPUT_NORMALIZER_VERSION,
    },
    concurrencyLimit,
  });
  const pricingHash = hashAiMediaPlanningJson({
    version: AI_IMAGE_SUITE_PAID_PRICING_VERSION,
    provider: providerRuntime.provider,
    model: providerRuntime.model,
    unitCostCents: providerRuntime.unitCostCents,
    currency: 'USD',
  });
  return {
    provider: providerRuntime.provider,
    model: providerRuntime.model,
    providerConfigHash,
    pricingVersion: `${AI_IMAGE_SUITE_PAID_PRICING_VERSION}:${pricingHash.slice(0, 32)}`,
    estimatedCostPerImageCents: providerRuntime.unitCostCents,
    maximumCostPerImageCents: providerRuntime.maximumCostCents,
    concurrencyLimit,
  };
}

export function createAiImageSuiteProviderRuntimeSnapshot(
  rawSettings: AiImageSuiteProviderRuntimeSettings,
  dependencies: RuntimeDependencies = {},
): AiImageSuiteProviderRuntimeSnapshot {
  const provider = String(rawSettings?.provider || '').trim();
  const nodeEnv = dependencies.nodeEnv ?? process.env.NODE_ENV;
  if (provider === 'fake') {
    const providerConfig = fakeConfig();
    const executionReady = nodeEnv !== 'production';
    return {
      providerConfig,
      providerRuntime: null,
      capability: {
        provider: AI_IMAGE_SUITE_PROVIDER,
        model: AI_IMAGE_SUITE_MODEL,
        evidenceLevel: 'local-test',
        inputTransport: 'none',
        resultMode: 'sync',
        maxReferences: 5,
      },
      configured: true,
      executionReady,
      testOnly: true,
      reasonCode: executionReady ? 'READY' : 'FAKE_PRODUCTION_BLOCKED',
      reason: executionReady
        ? 'Provider-free AI image suite runtime is ready for local testing'
        : 'The fake AI image suite Provider is disabled in production',
    };
  }
  if (!provider || provider === 'disabled') {
    return invalidSnapshot('PROVIDER_DISABLED', 'AI image Provider is disabled');
  }

  const model = String(rawSettings?.model || '').trim();
  const capability = (dependencies.resolveCapability || resolveAiImageProviderCapability)(
    provider,
    model,
  );
  if (!exactImageToImageCapability(capability, provider, model)) {
    return invalidSnapshot(
      'PROVIDER_CAPABILITY_UNSUPPORTED',
      'An exact IMAGE_TO_IMAGE Provider/model capability is required for AI image suites',
    );
  }
  const concurrencyLimit = safeConcurrency(rawSettings?.concurrencyLimit);
  if (!concurrencyLimit
    || !Number.isSafeInteger(rawSettings?.costPerImageCents)
    || rawSettings.costPerImageCents < 1) {
    return invalidSnapshot(
      'PROVIDER_CONFIG_INVALID',
      'AI image suite Provider price or concurrency is invalid',
    );
  }

  let providerRuntime: AiImageProviderRuntimeContract;
  try {
    providerRuntime = createAiImageProviderRuntimeContract({
      provider,
      model,
      baseUrl: rawSettings.baseUrl,
      costPerImageCents: rawSettings.costPerImageCents,
    }, {
      count: 1,
      width: AI_IMAGE_SUITE_PROVIDER_REQUEST_WIDTH,
      height: AI_IMAGE_SUITE_PROVIDER_REQUEST_HEIGHT,
    });
  } catch {
    return invalidSnapshot(
      'PROVIDER_CONFIG_INVALID',
      'AI image suite Provider endpoint, model, or price is invalid',
    );
  }

  const providerConfig = paidConfig(providerRuntime, concurrencyLimit);
  const credentialConfigured = Boolean(String(rawSettings.apiKey || '').trim());
  const evidenceReady = hasExactAiMediaSandboxEvidence({
    capability,
    provider,
    model,
    baseUrl: rawSettings.baseUrl,
    operation: 'IMAGE_TO_IMAGE',
    inputTransport: 'multipart',
    resultMode: 'sync',
  });
  const configured = credentialConfigured;
  const executionReady = configured && evidenceReady;
  const reasonCode = !credentialConfigured
    ? 'PROVIDER_CREDENTIAL_MISSING' as const
    : !evidenceReady
      ? 'PROVIDER_EVIDENCE_UNVERIFIED' as const
      : 'READY' as const;
  return {
    providerConfig,
    providerRuntime,
    capability: publicCapability(capability),
    configured,
    executionReady,
    testOnly: !evidenceReady,
    reasonCode,
    reason: reasonCode === 'READY'
      ? 'AI image suite Provider runtime is ready'
      : reasonCode === 'PROVIDER_CREDENTIAL_MISSING'
        ? 'AI image suite Provider credential is missing'
        : 'AI image suite Provider requires exact sandbox-verified evidence',
  };
}

export function aiImageSuiteProviderRuntimeMatches(
  frozen: AiImageSuiteFrozenProviderIdentity,
  snapshot: AiImageSuiteProviderRuntimeSnapshot,
): boolean {
  const config = snapshot.providerConfig;
  if (!config
    || !Number.isSafeInteger(frozen.itemCount)
    || frozen.itemCount < 1) return false;
  const estimatedTotal = config.estimatedCostPerImageCents * frozen.itemCount;
  const maximumTotal = config.maximumCostPerImageCents * frozen.itemCount;
  return Number.isSafeInteger(estimatedTotal)
    && Number.isSafeInteger(maximumTotal)
    && frozen.provider === config.provider
    && frozen.model === config.model
    && frozen.providerConfigHash === config.providerConfigHash
    && frozen.pricingVersion === config.pricingVersion
    && frozen.concurrencyLimit === config.concurrencyLimit
    && frozen.estimatedCostCents === estimatedTotal
    && frozen.maximumCostCents === maximumTotal;
}

export function aiImageSuiteProviderConfigMatches(
  candidate: AiImageSuiteProviderConfig,
  snapshot: AiImageSuiteProviderRuntimeSnapshot,
): boolean {
  const config = snapshot.providerConfig;
  return Boolean(
    config
    && candidate.provider === config.provider
    && candidate.model === config.model
    && candidate.providerConfigHash === config.providerConfigHash
    && candidate.pricingVersion === config.pricingVersion
    && candidate.estimatedCostPerImageCents === config.estimatedCostPerImageCents
    && candidate.maximumCostPerImageCents === config.maximumCostPerImageCents
    && candidate.concurrencyLimit === config.concurrencyLimit,
  );
}
