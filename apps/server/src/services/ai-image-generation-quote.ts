import { AiImageJobError } from './ai-image-jobs.js';
import {
  createAiImageProviderRuntimeContract,
  type AiImageProviderRuntimeContract,
} from './ai-image-provider-runtime-contract.js';

export interface AiImageGenerationQuote {
  estimatedCostCents: number;
  maximumCostCents: number;
  operationConfig: AiImageProviderRuntimeContract | null;
}

export function buildAiImageGenerationQuote(
  provider: {
    provider: string;
    model: string;
    baseUrl: string;
    costPerImageCents: number;
  },
  request: { count: number; width: number; height: number },
): AiImageGenerationQuote {
  if (provider.provider === 'fake') {
    return { estimatedCostCents: 0, maximumCostCents: 0, operationConfig: null };
  }
  if (!Number.isSafeInteger(provider.costPerImageCents) || provider.costPerImageCents < 1) {
    throw new AiImageJobError(
      'PROVIDER_NOT_READY',
      'A verified positive per-image cost is required before paid dispatch',
    );
  }
  let operationConfig: AiImageProviderRuntimeContract;
  try {
    operationConfig = createAiImageProviderRuntimeContract(provider, request);
  } catch (error) {
    throw new AiImageJobError(
      'PROVIDER_NOT_READY',
      error instanceof Error ? error.message : 'AI image Provider runtime contract is invalid',
    );
  }
  return {
    estimatedCostCents: operationConfig.maximumCostCents,
    maximumCostCents: operationConfig.maximumCostCents,
    operationConfig,
  };
}
