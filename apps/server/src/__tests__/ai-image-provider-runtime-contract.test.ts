import { describe, expect, it } from 'vitest';
import {
  AiImageProviderRuntimeContractError,
  assertAiImageProviderRuntimeContract,
  createAiImageProviderRuntimeContract,
} from '../services/ai-image-provider-runtime-contract.js';

describe('AI image Provider runtime contract', () => {
  const config = {
    provider: 'openai-images',
    baseUrl: 'https://api.openai.com/v1/',
    apiKey: 'must-not-be-frozen',
    model: 'gpt-image-1',
    costPerImageCents: 7,
  };

  it('freezes the endpoint identity and exact billed request without storing credentials', () => {
    const contract = createAiImageProviderRuntimeContract(config, {
      count: 1,
      width: 1024,
      height: 1024,
    });

    expect(contract).toEqual({
      contractVersion: 'ai-image-provider-runtime/v1',
      provider: 'openai-images',
      model: 'gpt-image-1',
      baseUrlSha256: 'd9617135d6fdd0a2cde722d637a1dfcc3da37515708b3ea5d66ae607c8ac785e',
      unitCostCents: 7,
      imageCount: 1,
      width: 1024,
      height: 1024,
      maximumCostCents: 7,
    });
    expect(JSON.stringify(contract)).not.toContain(config.apiKey);
    expect(assertAiImageProviderRuntimeContract(contract, config, {
      count: 1,
      width: 1024,
      height: 1024,
      estimatedCostCents: 7,
    })).toEqual(contract);
  });

  it('canonicalizes an empty official OpenAI base URL before hashing', () => {
    const implicit = createAiImageProviderRuntimeContract(
      { ...config, baseUrl: '' },
      { count: 1, width: 1024, height: 1024 },
    );
    const explicit = createAiImageProviderRuntimeContract(
      { ...config, baseUrl: 'https://api.openai.com/v1' },
      { count: 1, width: 1024, height: 1024 },
    );
    expect(implicit.baseUrlSha256).toBe(explicit.baseUrlSha256);
  });

  it.each([
    ['endpoint', { ...config, baseUrl: 'https://relay.example/v1' }],
    ['model', { ...config, model: 'gpt-image-2' }],
    ['price', { ...config, costPerImageCents: 8 }],
  ])('rejects a changed %s before paid dispatch', (_label, changed) => {
    const contract = createAiImageProviderRuntimeContract(config, {
      count: 1,
      width: 1024,
      height: 1024,
    });
    expect(() => assertAiImageProviderRuntimeContract(contract, changed, {
      count: 1,
      width: 1024,
      height: 1024,
      estimatedCostCents: 7,
    })).toThrow(AiImageProviderRuntimeContractError);
  });

  it('rejects a tampered request shape or total quote', () => {
    const contract = createAiImageProviderRuntimeContract(config, {
      count: 1,
      width: 1024,
      height: 1024,
    });
    expect(() => assertAiImageProviderRuntimeContract(contract, config, {
      count: 2,
      width: 1024,
      height: 1024,
      estimatedCostCents: 14,
    })).toThrow(/request shape/u);
    expect(() => assertAiImageProviderRuntimeContract(contract, config, {
      count: 1,
      width: 1024,
      height: 1024,
      estimatedCostCents: 8,
    })).toThrow(/cost quote/u);
  });
});
