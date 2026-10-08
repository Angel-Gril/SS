import { createHash } from 'node:crypto';
import {
  AI_IMAGE_SUITE_MAX_CONCURRENCY,
  type AiImageSuiteProviderConfig,
} from './ai-image-suite.js';
import {
  AI_IMAGE_SUITE_OUTPUT_HEIGHT,
  AI_IMAGE_SUITE_OUTPUT_PROFILE_VERSION,
  AI_IMAGE_SUITE_OUTPUT_WIDTH,
  AI_IMAGE_SUITE_PAID_CHILD_OPERATION_CONFIG_VERSION,
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
  parseAiImageProviderRuntimeContract,
} from './ai-image-provider-runtime-contract.js';
import {
  AI_IMAGE_SUITE_OUTPUT_NORMALIZER_VERSION,
  AI_IMAGE_SUITE_PROVIDER_OUTPUT_HEIGHT,
  AI_IMAGE_SUITE_PROVIDER_OUTPUT_WIDTH,
} from './ai-image-suite-output-normalizer.js';
import { hashAiMediaPlanningJson } from './ai-media-planning.js';
import { canRunAiImageProviderOperation } from './ai-image-provider-admission.js';
import { AI_IMAGE_WANX21_EDIT_MODEL, AI_IMAGE_WANX21_EDIT_PROFILE } from './ai-image-wanx-edit-profile.js';
import {AI_IMAGE_DONOR_GPT2_COUNT_MODEL,AI_IMAGE_DONOR_GPT2_PROFILE,isDonorGpt2SuiteProvider,createDonorGpt2FullFrameConfig,assertDonorGpt2ProviderModel} from './ai-image-donor-gpt2-profile.js';
import type { AiImageProviderCredentialRevision, AiImageProviderCurrency } from './ai-image-provider-runtime-contract.js';
import {requiresAiImageProviderCredentialRevision} from './ai-image-provider-runtime-contract.js';

export const AI_IMAGE_SUITE_PROVIDER_REQUEST_WIDTH =
  AI_IMAGE_SUITE_PROVIDER_OUTPUT_WIDTH;
export const AI_IMAGE_SUITE_PROVIDER_REQUEST_HEIGHT =
  AI_IMAGE_SUITE_PROVIDER_OUTPUT_HEIGHT;
export const AI_IMAGE_SUITE_PROVIDER_RUNTIME_VERSION =
  'ai-image-suite-provider-runtime/v1' as const;
export const AI_IMAGE_SUITE_PAID_PRICING_VERSION =
  'ai-image-suite-price/v1' as const;
export const AI_IMAGE_SUITE_CNY_PRICING_VERSION = 'ai-image-suite-price-cny/v1' as const;
export const AI_IMAGE_SUITE_DEFAULT_CONCURRENCY = 2;

export interface AiImageSuiteProviderRuntimeSettings {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  costPerImageCents: number;
  currency?: AiImageProviderCurrency;
  credentialRevision?: AiImageProviderCredentialRevision;
  concurrencyLimit?: number;
}

export function isWanxAiImageSuiteProvider(provider: string, model: string): boolean {
  return provider === 'dashscope-wanx' && model === AI_IMAGE_WANX21_EDIT_MODEL;
}

export function aiImageSuiteProviderRequestDimensions(provider: string, model: string) {
  return isWanxAiImageSuiteProvider(provider, model)
    ? { width: AI_IMAGE_WANX21_EDIT_PROFILE.width, height: AI_IMAGE_WANX21_EDIT_PROFILE.height }
    : isDonorGpt2SuiteProvider(provider, model)
      ? {width:AI_IMAGE_DONOR_GPT2_PROFILE.width,height:AI_IMAGE_DONOR_GPT2_PROFILE.height}
    : { width: AI_IMAGE_SUITE_PROVIDER_REQUEST_WIDTH, height: AI_IMAGE_SUITE_PROVIDER_REQUEST_HEIGHT };
}

/** Legacy suite price versions remain USD; Wanx/count CNY is bound in the distinct price version. */
export function aiImageSuiteQuoteCurrency(pricingVersion: string): AiImageProviderCurrency {
  return new RegExp(`^${AI_IMAGE_SUITE_CNY_PRICING_VERSION}:[a-f0-9]{32}$`, 'u').test(pricingVersion)
    ? 'CNY' : 'USD';
}

export function hasAdmittedWanxAiImageSuiteOperation(input: {
  provider: string; model?: string | null; operationConfig?: unknown;
}): boolean {
  if (!isWanxAiImageSuiteProvider(input.provider, input.model || '')) return false;
  const config = input.operationConfig as Record<string, any> | null;
  try {
    const runtime = parseAiImageProviderRuntimeContract(config?.providerRuntime);
    return config?.version === AI_IMAGE_SUITE_PAID_CHILD_OPERATION_CONFIG_VERSION
      && runtime.provider === input.provider && runtime.model === input.model
      && runtime.currency === 'CNY' && runtime.imageCount === 1
      && runtime.width === AI_IMAGE_WANX21_EDIT_PROFILE.width && runtime.height === AI_IMAGE_WANX21_EDIT_PROFILE.height
      && config.providerRequest?.count === 1
      && config.providerRequest.width === runtime.width && config.providerRequest.height === runtime.height
      && canRunAiImageProviderOperation({
        provider: runtime.provider, model: runtime.model, operation: 'IMAGE_TO_IMAGE',
        baseUrlSha256: runtime.baseUrlSha256,
        capability: resolveAiImageProviderCapability(runtime.provider, runtime.model),
        inputTransport: 'base64', resultMode: 'async',
      });
  } catch { return false; }
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
    && (isWanxAiImageSuiteProvider(provider, model)
      ? value.maxReferences === 1 && value.inputTransport === 'base64' && value.resultMode === 'async'
      : value.inputTransport === 'multipart' && value.resultMode === 'sync')
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
    finalOutput: isDonorGpt2SuiteProvider(providerRuntime.provider,providerRuntime.model) ? createDonorGpt2FullFrameConfig().finalOutput : {
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
  const pricingVersion = providerRuntime.currency === 'CNY'
    ? AI_IMAGE_SUITE_CNY_PRICING_VERSION : AI_IMAGE_SUITE_PAID_PRICING_VERSION;
  const pricingHash = hashAiMediaPlanningJson({
    version: pricingVersion,
    provider: providerRuntime.provider,
    model: providerRuntime.model,
    unitCostCents: providerRuntime.unitCostCents,
    currency: providerRuntime.currency || 'USD',
  });
  return {
    provider: providerRuntime.provider,
    model: providerRuntime.model,
    providerConfigHash,
    pricingVersion: `${pricingVersion}:${pricingHash.slice(0, 32)}`,
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
  const wanx = isWanxAiImageSuiteProvider(provider, model);
  const count = provider === 'custom' && model === AI_IMAGE_DONOR_GPT2_COUNT_MODEL;
  const currencyValid = wanx ? rawSettings.currency === 'CNY'
    : rawSettings.currency === undefined || rawSettings.currency === 'USD'
      || (count && rawSettings.currency === 'CNY');
  if (!concurrencyLimit
    || !Number.isSafeInteger(rawSettings?.costPerImageCents)
    || rawSettings.costPerImageCents < 1
    || !currencyValid) {
    return invalidSnapshot(
      'PROVIDER_CONFIG_INVALID',
      'AI image suite Provider price or concurrency is invalid',
    );
  }

  let providerRuntime: AiImageProviderRuntimeContract;
  try {
    if (isDonorGpt2SuiteProvider(provider,model)) assertDonorGpt2ProviderModel(rawSettings.baseUrl,model);
    providerRuntime = createAiImageProviderRuntimeContract({
      provider,
      model,
      baseUrl: rawSettings.baseUrl,
      costPerImageCents: rawSettings.costPerImageCents,
      // Keep historical count USD v2 identities stable, including when frozen
      // execution binding makes the formerly implicit USD currency explicit.
      ...(rawSettings.currency === 'CNY' ? { currency: 'CNY' as const } : {}),
      ...(wanx ? { credentialRevision: rawSettings.credentialRevision } : {}),
      ...(!wanx && requiresAiImageProviderCredentialRevision(provider,model) ? {credentialRevision:rawSettings.credentialRevision} : {}),
    }, {
      count: 1,
      ...aiImageSuiteProviderRequestDimensions(provider, model),
    });
  } catch {
    return invalidSnapshot(
      'PROVIDER_CONFIG_INVALID',
      'AI image suite Provider endpoint, model, or price is invalid',
    );
  }

  const providerConfig = paidConfig(providerRuntime, concurrencyLimit);
  const credentialConfigured = Boolean(String(rawSettings.apiKey || '').trim());
  const evidenceReady = wanx ? canRunAiImageProviderOperation({
    capability, provider, model, baseUrl: rawSettings.baseUrl,
    operation: 'IMAGE_TO_IMAGE', inputTransport: capability.inputTransport, resultMode: capability.resultMode,
  }) : hasExactAiMediaSandboxEvidence({
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
