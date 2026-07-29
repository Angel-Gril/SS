import { createHash } from 'node:crypto';
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
    const originOnly = createAiImageProviderRuntimeContract(
      { ...config, baseUrl: 'https://api.openai.com' },
      { count: 1, width: 1024, height: 1024 },
    );
    expect(implicit.baseUrlSha256).toBe(explicit.baseUrlSha256);
    expect(originOnly.baseUrlSha256).toBe(explicit.baseUrlSha256);
  });

  it('rejects a relay labeled as official OpenAI while preserving explicit custom relays', () => {
    expect(() => createAiImageProviderRuntimeContract({
      ...config,
      baseUrl: 'https://relay.example/v1',
    }, {
      count: 1,
      width: 1024,
      height: 1024,
    })).toThrow(/official OpenAI/u);

    expect(createAiImageProviderRuntimeContract({
      ...config,
      provider: 'custom',
      baseUrl: 'https://relay.example/v1',
    }, {
      count: 1,
      width: 1024,
      height: 1024,
    })).toMatchObject({
      provider: 'custom',
      model: 'gpt-image-1',
    });
  });

  it('binds custom relay identity to the same effective v1 API base used for dispatch', () => {
    const bare = createAiImageProviderRuntimeContract({
      ...config,
      provider: 'custom',
      baseUrl: 'https://relay.example',
    }, {
      count: 1,
      width: 1024,
      height: 1024,
    });
    const explicit = createAiImageProviderRuntimeContract({
      ...config,
      provider: 'custom',
      baseUrl: 'https://relay.example/v1',
    }, {
      count: 1,
      width: 1024,
      height: 1024,
    });
    const prefixed = createAiImageProviderRuntimeContract({
      ...config,
      provider: 'custom',
      baseUrl: 'https://relay.example/openai',
    }, {
      count: 1,
      width: 1024,
      height: 1024,
    });
    const explicitPrefixed = createAiImageProviderRuntimeContract({
      ...config,
      provider: 'custom',
      baseUrl: 'https://relay.example/openai/v1',
    }, {
      count: 1,
      width: 1024,
      height: 1024,
    });

    expect(bare.baseUrlSha256).toBe(explicit.baseUrlSha256);
    expect(prefixed.baseUrlSha256).toBe(explicitPrefixed.baseUrlSha256);
  });

  it.each([
    ['bare origin', 'https://relay.example', 'https://relay.example/v1'],
    ['custom prefix', 'https://relay.example/openai', 'https://relay.example/openai/v1'],
  ])('fails a legacy custom %s hash closed while preserving the explicit v1 contract', (
    _label,
    legacyBaseUrl,
    effectiveBaseUrl,
  ) => {
    const identity = {
      ...config,
      provider: 'custom',
      baseUrl: legacyBaseUrl,
    };
    const current = createAiImageProviderRuntimeContract(identity, {
      count: 1,
      width: 1024,
      height: 1024,
    });
    const explicit = createAiImageProviderRuntimeContract({
      ...identity,
      baseUrl: effectiveBaseUrl,
    }, {
      count: 1,
      width: 1024,
      height: 1024,
    });
    const legacy = {
      ...current,
      baseUrlSha256: createHash('sha256').update(legacyBaseUrl).digest('hex'),
    };

    expect(current).toEqual(explicit);
    expect(() => assertAiImageProviderRuntimeContract(
      legacy,
      identity,
      { count: 1, width: 1024, height: 1024, estimatedCostCents: 7 },
    )).toThrow(/identity does not match/u);
  });

  it('fails an old v1 bare-origin hash closed after binding the effective official transport', () => {
    const current = createAiImageProviderRuntimeContract(
      { ...config, baseUrl: 'https://api.openai.com' },
      { count: 1, width: 1024, height: 1024 },
    );
    const legacyBareOrigin = {
      ...current,
      baseUrlSha256: createHash('sha256')
        .update('https://api.openai.com')
        .digest('hex'),
    };

    expect(() => assertAiImageProviderRuntimeContract(
      legacyBareOrigin,
      { ...config, baseUrl: 'https://api.openai.com' },
      { count: 1, width: 1024, height: 1024, estimatedCostCents: 7 },
    )).toThrow(/identity does not match/u);
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
