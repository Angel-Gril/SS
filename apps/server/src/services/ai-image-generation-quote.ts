import { createHash } from 'node:crypto';
import { AiImageJobError } from './ai-image-job-error.js';
import {
  createAiImageProviderRuntimeContract,
  type AiImageProviderRuntimeContract,
  type AiImageProviderRuntimeIdentity,
  type AiImageProviderCurrency,
} from './ai-image-provider-runtime-contract.js';

export interface AiImageGenerationQuotePreview {
  provider: string;
  model: string;
  currency: AiImageProviderCurrency;
  unitCostCents: number;
  requestedImageCount: number;
  width: number;
  height: number;
  maximumCostCents: number;
  quoteFingerprint: string;
}

export interface AiImageGenerationQuote {
  estimatedCostCents: number;
  maximumCostCents: number;
  operationConfig: AiImageProviderRuntimeContract | null;
  preview: AiImageGenerationQuotePreview;
}

export function buildAiImageGenerationQuote(
  provider: AiImageProviderRuntimeIdentity,
  request: { count: number; width: number; height: number },
): AiImageGenerationQuote {
  const fake = provider.provider === 'fake';
  if (!fake && (!Number.isSafeInteger(provider.costPerImageCents) || provider.costPerImageCents < 1)) {
    throw new AiImageJobError(
      'PROVIDER_NOT_READY',
      'A verified positive per-image cost is required before paid dispatch',
    );
  }
  let operationConfig: AiImageProviderRuntimeContract | null;
  try {
    operationConfig = fake ? null : createAiImageProviderRuntimeContract(provider, request);
  } catch (error) {
    throw new AiImageJobError(
      'PROVIDER_NOT_READY',
      error instanceof Error ? error.message : 'AI image Provider runtime contract is invalid',
    );
  }
  const pricing = {
    provider: operationConfig?.provider ?? provider.provider,
    model: operationConfig?.model ?? provider.model,
    currency: operationConfig?.currency ?? 'USD' as const,
    unitCostCents: operationConfig?.unitCostCents ?? 0,
    requestedImageCount: request.count,
    width: request.width,
    height: request.height,
    maximumCostCents: operationConfig?.maximumCostCents ?? 0,
  };
  // A price acknowledgement, not an authorization token. Admission and all amounts
  // are recomputed on the server. Endpoint/credential metadata stays private.
  const quoteFingerprint = createHash('sha256').update(JSON.stringify({
    version: 'ai-image-generation-quote/v1',
    ...pricing,
    endpoint: operationConfig?.baseUrlSha256 ?? null,
  })).digest('hex');
  return {
    estimatedCostCents: pricing.maximumCostCents,
    maximumCostCents: pricing.maximumCostCents,
    operationConfig,
    preview: { ...pricing, quoteFingerprint },
  };
}
