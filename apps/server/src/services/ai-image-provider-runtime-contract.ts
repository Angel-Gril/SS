import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { AI_IMAGE_WANX21_EDIT_MODEL } from './ai-image-wanx-edit-profile.js';
import {
  isOfficialOpenAiImagesApiBase,
  normalizeOpenAiImagesApiBase,
} from './ai-image-openai-url.js';

export const AI_IMAGE_PROVIDER_RUNTIME_CONTRACT_VERSION =
  'ai-image-provider-runtime/v1' as const;
export const AI_IMAGE_PROVIDER_CREDENTIAL_RUNTIME_CONTRACT_VERSION =
  'ai-image-provider-runtime/v2' as const;
export const AI_IMAGE_PROVIDER_CURRENCY_RUNTIME_CONTRACT_VERSION =
  'ai-image-provider-runtime/v3' as const;
export type AiImageProviderCurrency = 'USD' | 'CNY';

export interface AiImageProviderCredentialRevision {
  recordId: string;
  revision: number;
  updatedAt: string;
}

export interface AiImageProviderRuntimeIdentity {
  provider: string;
  baseUrl: string;
  model: string;
  costPerImageCents: number;
  currency?: AiImageProviderCurrency;
  credentialRevision?: AiImageProviderCredentialRevision;
}

export interface AiImageProviderRuntimeContract extends Record<string, unknown> {
  contractVersion: typeof AI_IMAGE_PROVIDER_RUNTIME_CONTRACT_VERSION
    | typeof AI_IMAGE_PROVIDER_CREDENTIAL_RUNTIME_CONTRACT_VERSION
    | typeof AI_IMAGE_PROVIDER_CURRENCY_RUNTIME_CONTRACT_VERSION;
  provider: string;
  model: string;
  baseUrlSha256: string;
  unitCostCents: number;
  imageCount: number;
  width: number;
  height: number;
  maximumCostCents: number;
  currency?: AiImageProviderCurrency;
  credentialRevision?: AiImageProviderCredentialRevision;
}

export class AiImageProviderRuntimeContractError extends Error {
  readonly code = 'PROVIDER_RUNTIME_CONTRACT_MISMATCH';

  constructor(message: string) {
    super(message);
    this.name = 'AiImageProviderRuntimeContractError';
  }
}

function requiredText(value: unknown, label: string): string {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > 500) {
    throw new AiImageProviderRuntimeContractError(`${label} is invalid`);
  }
  return normalized;
}

function positiveInteger(value: unknown, label: string): number {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    throw new AiImageProviderRuntimeContractError(`${label} is invalid`);
  }
  return normalized;
}

function supportedCurrency(value: unknown): AiImageProviderCurrency {
  if (value !== 'USD' && value !== 'CNY') {
    throw new AiImageProviderRuntimeContractError('Provider quote currency must be USD or CNY');
  }
  return value;
}

function providerDefaultBaseUrl(provider: string): string {
  if (provider === 'openai-images') return 'https://api.openai.com/v1';
  if (provider === 'dashscope-wanx') return 'https://dashscope.aliyuncs.com/api/v1';
  return '';
}

export function canonicalAiImageProviderBaseUrl(providerValue: unknown, baseUrlValue: unknown): string {
  const provider = requiredText(providerValue, 'provider');
  const raw = String(baseUrlValue || '').trim() || providerDefaultBaseUrl(provider);
  if (!raw) throw new AiImageProviderRuntimeContractError('Provider base URL is required');
  if (provider === 'openai-images') {
    let normalized: string;
    try {
      normalized = normalizeOpenAiImagesApiBase(raw);
    } catch {
      throw new AiImageProviderRuntimeContractError('Official OpenAI Images base URL is invalid');
    }
    if (!isOfficialOpenAiImagesApiBase(normalized)) {
      throw new AiImageProviderRuntimeContractError(
        'The official OpenAI Images provider requires https://api.openai.com/v1; use custom for relays',
      );
    }
    return normalized;
  }
  const effectiveRaw = provider === 'custom'
    ? (() => {
        try {
          return normalizeOpenAiImagesApiBase(raw);
        } catch {
          throw new AiImageProviderRuntimeContractError(
            'Custom OpenAI-compatible image Provider base URL is invalid',
          );
        }
      })()
    : raw;
  let parsed: URL;
  try {
    parsed = new URL(effectiveRaw);
  } catch {
    throw new AiImageProviderRuntimeContractError('Provider base URL is invalid');
  }
  if (parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash) {
    throw new AiImageProviderRuntimeContractError(
      'Provider base URL must use HTTPS without credentials, query, or fragment',
    );
  }
  parsed.hostname = parsed.hostname.toLowerCase();
  parsed.pathname = parsed.pathname.replace(/\/+$/u, '') || '/';
  const normalized = parsed.toString().replace(/\/+$/u, '');
  return normalized;
}

export function aiImageProviderEndpointSha256(provider: string, baseUrl: string): string {
  return createHash('sha256')
    .update(canonicalAiImageProviderBaseUrl(provider, baseUrl))
    .digest('hex');
}

function safeMaximumCost(unitCostCents: number, imageCount: number): number {
  const total = unitCostCents * imageCount;
  if (!Number.isSafeInteger(total) || total < 1) {
    throw new AiImageProviderRuntimeContractError('Provider maximum cost is invalid');
  }
  return total;
}

export function requiresAiImageProviderCredentialRevision(provider: string, model: string): boolean {
  return (provider === 'dashscope-wanx' && model === AI_IMAGE_WANX21_EDIT_MODEL)
    || (provider === 'custom' && model === 'gpt-image-2-count');
}

/** Config metadata only: never derive this identity from a secret or encrypted value. */
export function parseAiImageProviderCredentialRevision(value: unknown): AiImageProviderCredentialRevision {
  const input = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const timestamp = typeof input.updatedAt === 'string' ? Date.parse(input.updatedAt) : NaN;
  if (Object.keys(input).length !== 3
    || typeof input.recordId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(input.recordId)
    || typeof input.revision !== 'number' || !Number.isSafeInteger(input.revision) || input.revision < 0
    || !Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== input.updatedAt) {
    throw new AiImageProviderRuntimeContractError('Provider credential revision is missing or invalid');
  }
  return { recordId: input.recordId, revision: input.revision, updatedAt: input.updatedAt as string };
}

export function createAiImageProviderRuntimeContract(
  identity: AiImageProviderRuntimeIdentity,
  request: { count: number; width: number; height: number },
): AiImageProviderRuntimeContract {
  const provider = requiredText(identity.provider, 'provider');
  const model = requiredText(identity.model, 'model');
  const unitCostCents = positiveInteger(identity.costPerImageCents, 'unit cost');
  const imageCount = positiveInteger(request.count, 'image count');
  const width = positiveInteger(request.width, 'image width');
  const height = positiveInteger(request.height, 'image height');
  const currency = identity.currency === undefined ? undefined : supportedCurrency(identity.currency);
  const credentialRevision = requiresAiImageProviderCredentialRevision(provider, model)
    ? parseAiImageProviderCredentialRevision(identity.credentialRevision) : undefined;
  return {
    contractVersion: currency ? AI_IMAGE_PROVIDER_CURRENCY_RUNTIME_CONTRACT_VERSION
      : credentialRevision ? AI_IMAGE_PROVIDER_CREDENTIAL_RUNTIME_CONTRACT_VERSION : AI_IMAGE_PROVIDER_RUNTIME_CONTRACT_VERSION,
    provider,
    model,
    baseUrlSha256: aiImageProviderEndpointSha256(provider, identity.baseUrl),
    unitCostCents,
    imageCount,
    width,
    height,
    maximumCostCents: safeMaximumCost(unitCostCents, imageCount),
    ...(currency ? { currency } : {}),
    ...(credentialRevision ? { credentialRevision } : {}),
  };
}

export function parseAiImageProviderRuntimeContract(value: unknown): AiImageProviderRuntimeContract {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AiImageProviderRuntimeContractError('Provider runtime contract is missing');
  }
  const input = value as Record<string, unknown>;
  const provider = requiredText(input.provider, 'frozen provider');
  const model = requiredText(input.model, 'frozen model');
  const credentialBound = requiresAiImageProviderCredentialRevision(provider, model);
  const currencyBound = input.contractVersion === AI_IMAGE_PROVIDER_CURRENCY_RUNTIME_CONTRACT_VERSION;
  const contractVersion = currencyBound ? AI_IMAGE_PROVIDER_CURRENCY_RUNTIME_CONTRACT_VERSION
    : credentialBound ? AI_IMAGE_PROVIDER_CREDENTIAL_RUNTIME_CONTRACT_VERSION : AI_IMAGE_PROVIDER_RUNTIME_CONTRACT_VERSION;
  if (input.contractVersion !== contractVersion) {
    throw new AiImageProviderRuntimeContractError('Provider runtime contract version is invalid');
  }
  const currency = currencyBound ? supportedCurrency(input.currency) : undefined;
  const credentialRevision = credentialBound
    ? parseAiImageProviderCredentialRevision(input.credentialRevision) : undefined;
  const baseUrlSha256 = String(input.baseUrlSha256 || '');
  if (!/^[a-f0-9]{64}$/u.test(baseUrlSha256)) {
    throw new AiImageProviderRuntimeContractError('Frozen Provider endpoint identity is invalid');
  }
  const unitCostCents = positiveInteger(input.unitCostCents, 'frozen unit cost');
  const imageCount = positiveInteger(input.imageCount, 'frozen image count');
  const width = positiveInteger(input.width, 'frozen image width');
  const height = positiveInteger(input.height, 'frozen image height');
  const maximumCostCents = positiveInteger(input.maximumCostCents, 'frozen maximum cost');
  if (maximumCostCents !== safeMaximumCost(unitCostCents, imageCount)) {
    throw new AiImageProviderRuntimeContractError('Frozen Provider cost quote is inconsistent');
  }
  return {
    contractVersion,
    provider,
    model,
    baseUrlSha256,
    unitCostCents,
    imageCount,
    width,
    height,
    maximumCostCents,
    ...(currency ? { currency } : {}),
    ...(credentialRevision ? { credentialRevision } : {}),
  };
}

export function assertAiImageProviderRuntimeContract(
  frozenValue: unknown,
  activeIdentity: AiImageProviderRuntimeIdentity,
  request: {
    count: number;
    width: number;
    height: number;
    estimatedCostCents: number;
  },
): AiImageProviderRuntimeContract {
  const frozen = parseAiImageProviderRuntimeContract(frozenValue);
  const active = createAiImageProviderRuntimeContract(activeIdentity, request);
  if (frozen.provider !== active.provider
    || frozen.model !== active.model
    || frozen.baseUrlSha256 !== active.baseUrlSha256
    || frozen.unitCostCents !== active.unitCostCents
    || (frozen.currency ?? 'USD') !== (active.currency ?? 'USD')
    || !isDeepStrictEqual(frozen.credentialRevision, active.credentialRevision)) {
    throw new AiImageProviderRuntimeContractError(
      'Active Provider identity does not match the frozen runtime contract',
    );
  }
  if (frozen.imageCount !== request.count
    || frozen.width !== request.width
    || frozen.height !== request.height) {
    throw new AiImageProviderRuntimeContractError(
      'Active Provider request shape does not match the frozen runtime contract',
    );
  }
  if (frozen.maximumCostCents !== request.estimatedCostCents
    || active.maximumCostCents !== request.estimatedCostCents) {
    throw new AiImageProviderRuntimeContractError(
      'Active Provider cost quote does not match the frozen runtime contract',
    );
  }
  return frozen;
}

/** Execute an already confirmed quote without adopting subsequent price changes. */
export function bindAiImageProviderExecutionConfig<T extends AiImageProviderRuntimeIdentity>(
  frozenValue: unknown,
  activeIdentity: T,
  request: { count: number; width: number; height: number; estimatedCostCents: number },
): T {
  const frozen = parseAiImageProviderRuntimeContract(frozenValue);
  const executionIdentity = { ...activeIdentity, costPerImageCents: frozen.unitCostCents, currency: frozen.currency ?? 'USD' };
  assertAiImageProviderRuntimeContract(frozen, executionIdentity, request);
  return executionIdentity;
}
