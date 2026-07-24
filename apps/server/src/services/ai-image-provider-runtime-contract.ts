import { createHash } from 'node:crypto';

export const AI_IMAGE_PROVIDER_RUNTIME_CONTRACT_VERSION =
  'ai-image-provider-runtime/v1' as const;

export interface AiImageProviderRuntimeIdentity {
  provider: string;
  baseUrl: string;
  model: string;
  costPerImageCents: number;
}

export interface AiImageProviderRuntimeContract extends Record<string, unknown> {
  contractVersion: typeof AI_IMAGE_PROVIDER_RUNTIME_CONTRACT_VERSION;
  provider: string;
  model: string;
  baseUrlSha256: string;
  unitCostCents: number;
  imageCount: number;
  width: number;
  height: number;
  maximumCostCents: number;
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

function providerDefaultBaseUrl(provider: string): string {
  if (provider === 'openai-images') return 'https://api.openai.com/v1';
  if (provider === 'dashscope-wanx') return 'https://dashscope.aliyuncs.com/api/v1';
  return '';
}

export function canonicalAiImageProviderBaseUrl(providerValue: unknown, baseUrlValue: unknown): string {
  const provider = requiredText(providerValue, 'provider');
  const raw = String(baseUrlValue || '').trim() || providerDefaultBaseUrl(provider);
  if (!raw) throw new AiImageProviderRuntimeContractError('Provider base URL is required');
  let parsed: URL;
  try {
    parsed = new URL(raw);
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

function baseUrlHash(provider: string, baseUrl: string): string {
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
  return {
    contractVersion: AI_IMAGE_PROVIDER_RUNTIME_CONTRACT_VERSION,
    provider,
    model,
    baseUrlSha256: baseUrlHash(provider, identity.baseUrl),
    unitCostCents,
    imageCount,
    width,
    height,
    maximumCostCents: safeMaximumCost(unitCostCents, imageCount),
  };
}

function parseContract(value: unknown): AiImageProviderRuntimeContract {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AiImageProviderRuntimeContractError('Provider runtime contract is missing');
  }
  const input = value as Record<string, unknown>;
  if (input.contractVersion !== AI_IMAGE_PROVIDER_RUNTIME_CONTRACT_VERSION) {
    throw new AiImageProviderRuntimeContractError('Provider runtime contract version is invalid');
  }
  const provider = requiredText(input.provider, 'frozen provider');
  const model = requiredText(input.model, 'frozen model');
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
    contractVersion: AI_IMAGE_PROVIDER_RUNTIME_CONTRACT_VERSION,
    provider,
    model,
    baseUrlSha256,
    unitCostCents,
    imageCount,
    width,
    height,
    maximumCostCents,
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
  const frozen = parseContract(frozenValue);
  const active = createAiImageProviderRuntimeContract(activeIdentity, request);
  if (frozen.provider !== active.provider
    || frozen.model !== active.model
    || frozen.baseUrlSha256 !== active.baseUrlSha256
    || frozen.unitCostCents !== active.unitCostCents) {
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
