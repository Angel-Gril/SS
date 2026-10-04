import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  aiImageProviderEndpointSha256,
  parseAiImageProviderCredentialRevision,
  type AiImageProviderCredentialRevision,
  type AiImageProviderCurrency,
} from './ai-image-provider-runtime-contract.js';
import {
  hasExactAiMediaSandboxEvidence,
  resolveAiImageProviderCapability,
} from './ai-image-provider-capabilities.js';
import type { AiImageTranslationStorageReadiness } from './ai-image-translation-storage.js';
import { AI_GLOBAL_COST_BUDGET_MAX_MINOR } from './ai-cost-budget.js';

export interface AiImageTranslationRuntimeSettings {
  enabled: boolean;
  provider: string;
  model: string;
  baseUrl?: string;
  hasApiKey?: boolean;
  estimatedCostCents: number;
  globalDailyBudgetCents?: number;
  currency?: AiImageProviderCurrency;
  credentialRevision?: AiImageProviderCredentialRevision;
}

export interface AiImageTranslationPrice {
  currency: AiImageProviderCurrency;
  unitCostCents: number;
  maximumCostCents: number;
  quoteFingerprint: string;
}

export interface AiImageTranslationPriceConfirmation {
  currency: AiImageProviderCurrency;
  maximumCostCents: number;
  quoteFingerprint: string;
}

export interface AiImageTranslationRuntimeContract extends Record<string, unknown> {
  contractVersion: 'ai-image-translation-runtime/v1';
  provider: 'dashscope-qwen-mt-image';
  model: 'qwen-mt-image';
  operation: 'IMAGE_TRANSLATE';
  baseUrlSha256: string;
  credentialRevision: AiImageProviderCredentialRevision;
  currency: AiImageProviderCurrency;
  unitCostCents: number;
  maximumCostCents: number;
  imageCount: 1;
}

export class AiImageTranslationRuntimeError extends Error {
  readonly code = 'PROVIDER_RUNTIME_CONTRACT_MISMATCH';
}

function fail(message: string): never { throw new AiImageTranslationRuntimeError(message); }

/** Official translation transport only; generation endpoints do not prove image translation. */
export function canonicalAiImageTranslationBaseUrl(value: unknown): string {
  let url: URL;
  try { url = new URL(String(value || '').trim()); } catch { return fail('Image translation endpoint is invalid'); }
  if (url.origin !== 'https://dashscope.aliyuncs.com' || url.username || url.password || url.search || url.hash
    || !['', '/', '/api/v1', '/api/v1/'].includes(url.pathname)) {
    return fail('Image translation requires the official DashScope API base');
  }
  return 'https://dashscope.aliyuncs.com/api/v1';
}

export function buildAiImageTranslationRuntime(settings: AiImageTranslationRuntimeSettings): {
  runtime: AiImageTranslationRuntimeContract; price: AiImageTranslationPrice;
} {
  if (settings.provider !== 'dashscope-qwen-mt-image' || settings.model !== 'qwen-mt-image'
    || !Number.isSafeInteger(settings.estimatedCostCents) || settings.estimatedCostCents < 1
    || settings.estimatedCostCents > AI_GLOBAL_COST_BUDGET_MAX_MINOR
    || !['CNY', 'USD'].includes(String(settings.currency))) fail('Image translation runtime identity or price is invalid');
  const runtime: AiImageTranslationRuntimeContract = {
    contractVersion: 'ai-image-translation-runtime/v1',
    provider: 'dashscope-qwen-mt-image', model: 'qwen-mt-image', operation: 'IMAGE_TRANSLATE',
    baseUrlSha256: aiImageProviderEndpointSha256(settings.provider, canonicalAiImageTranslationBaseUrl(settings.baseUrl)),
    credentialRevision: parseAiImageProviderCredentialRevision(settings.credentialRevision),
    currency: settings.currency!, unitCostCents: settings.estimatedCostCents,
    maximumCostCents: settings.estimatedCostCents, imageCount: 1,
  };
  return { runtime, price: aiImageTranslationRuntimePrice(runtime) };
}

export function aiImageTranslationRuntimePrice(runtime: AiImageTranslationRuntimeContract): AiImageTranslationPrice {
  return {
    currency: runtime.currency, unitCostCents: runtime.unitCostCents, maximumCostCents: runtime.maximumCostCents,
    quoteFingerprint: createHash('sha256').update(JSON.stringify(runtime)).digest('hex'),
  };
}

export function parseAiImageTranslationRuntime(value: unknown): AiImageTranslationRuntimeContract {
  const obj = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  if (Object.keys(obj).sort().join(',') !== [
    'baseUrlSha256', 'contractVersion', 'credentialRevision', 'currency', 'imageCount',
    'maximumCostCents', 'model', 'operation', 'provider', 'unitCostCents',
  ].sort().join(',') || obj.contractVersion !== 'ai-image-translation-runtime/v1'
    || obj.operation !== 'IMAGE_TRANSLATE' || obj.imageCount !== 1) fail('Frozen image translation runtime is invalid');
  const expected = buildAiImageTranslationRuntime({
    enabled: true, provider: String(obj.provider), model: String(obj.model),
    baseUrl: 'https://dashscope.aliyuncs.com/api/v1', estimatedCostCents: Number(obj.unitCostCents),
    currency: obj.currency as AiImageProviderCurrency, credentialRevision: obj.credentialRevision as AiImageProviderCredentialRevision,
  }).runtime;
  if (!isDeepStrictEqual(expected, obj)) fail('Frozen image translation runtime is invalid');
  return expected;
}

export function assertAiImageTranslationRuntime(
  value: unknown, settings: AiImageTranslationRuntimeSettings, estimatedCostCents: number,
): AiImageTranslationRuntimeContract {
  const frozen = parseAiImageTranslationRuntime(value);
  const current = buildAiImageTranslationRuntime(settings).runtime;
  if (!isDeepStrictEqual(frozen, current) || frozen.maximumCostCents !== estimatedCostCents) {
    fail('The frozen image translation endpoint, credential revision or price changed');
  }
  return frozen;
}

export function resolvePaidAiImageTranslationReadiness(
  settings: AiImageTranslationRuntimeSettings,
  storage: AiImageTranslationStorageReadiness | undefined,
  resolveCapability = resolveAiImageProviderCapability,
) {
  const rejected = (reason: string, reasonCode = 'MEDIA_PROVIDER_NOT_ALLOWED') => ({
    enabled: settings.enabled && settings.provider !== 'disabled', ready: false, reasonCode, reason, testOnly: false,
  });
  if (!settings.enabled || settings.provider === 'disabled') return rejected('Image translation is disabled', 'MEDIA_CREATE_DISABLED');
  if (settings.hasApiKey !== true) return rejected('Image translation credentials are not configured');
  let quote: ReturnType<typeof buildAiImageTranslationRuntime>;
  try { quote = buildAiImageTranslationRuntime(settings); } catch { return rejected('Image translation runtime configuration is incomplete or invalid'); }
  const capability = resolveCapability(settings.provider, settings.model);
  if (!hasExactAiMediaSandboxEvidence({
    capability, provider: settings.provider, model: settings.model, baseUrl: canonicalAiImageTranslationBaseUrl(settings.baseUrl),
    operation: 'IMAGE_TRANSLATE', inputTransport: 'public_url', resultMode: 'async',
  })) return rejected('Image translation has no exact sandbox capability evidence');
  if (!storage?.ready || storage.backend !== 'oss' || storage.publicHttps !== true) {
    return rejected('Image translation requires owned public HTTPS object storage', 'MEDIA_STORAGE_NOT_READY');
  }
  if (!Number.isSafeInteger(settings.globalDailyBudgetCents) || Number(settings.globalDailyBudgetCents) < quote.price.maximumCostCents
    || Number(settings.globalDailyBudgetCents) > AI_GLOBAL_COST_BUDGET_MAX_MINOR) {
    return rejected('Image translation global daily budget is not configured');
  }
  return { enabled: true, ready: true, reasonCode: 'READY', reason: 'AI image translation is ready', testOnly: false, price: quote.price };
}
