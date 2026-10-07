import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import * as runtimeOwner from '../services/ai-image-provider-runtime-contract.js';
import {
  AiImageProviderRuntimeContractError,
  assertAiImageProviderRuntimeContract,
  createAiImageProviderRuntimeContract,
} from '../services/ai-image-provider-runtime-contract.js';

describe('AI image Provider runtime contract', () => {
  it('pins the selected donor relay credential revision without freezing the API key',()=>{
    const donor={provider:'custom',baseUrl:'https://ai.big-model-api.top/v1',model:'gpt-image-2-count',apiKey:'private-fixture-key',costPerImageCents:8,
      credentialRevision:{recordId:'fixture-donor-key',revision:1,updatedAt:'2026-10-08T00:00:00.000Z'}};
    const shape={count:1,width:1008,height:1344};const frozen=createAiImageProviderRuntimeContract(donor,shape);
    expect(frozen).toMatchObject({contractVersion:'ai-image-provider-runtime/v2',credentialRevision:donor.credentialRevision});
    expect(JSON.stringify(frozen)).not.toContain(donor.apiKey);
    expect(()=>assertAiImageProviderRuntimeContract(frozen,{...donor,credentialRevision:{...donor.credentialRevision,revision:2}},{...shape,estimatedCostCents:8})).toThrow();
  });
  const config = {
    provider: 'openai-images',
    baseUrl: 'https://api.openai.com/v1/',
    apiKey: 'must-not-be-frozen',
    model: 'gpt-image-1',
    costPerImageCents: 7,
  };

  const credentialRevision = {
    recordId: 'synthetic-wanx-key-record',
    revision: 7,
    updatedAt: '2026-09-09T10:00:00.000Z',
  };
  const wanx = {
    ...config,
    provider: 'dashscope-wanx',
    model: 'wanx2.1-imageedit',
    baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
    credentialRevision,
  };
  const shape = { count: 1, width: 1024, height: 1024 };

  it.each(['USD', 'CNY'] as const)('freezes an explicit %s price in the v3 contract', currency => {
    const contract = createAiImageProviderRuntimeContract({ ...wanx, currency }, shape);
    expect(contract).toMatchObject({ contractVersion: 'ai-image-provider-runtime/v3', currency, unitCostCents: 7, credentialRevision });
    expect(runtimeOwner.parseAiImageProviderRuntimeContract(contract)).toEqual(contract);
    const legacy = createAiImageProviderRuntimeContract(wanx, shape);
    expect(legacy.contractVersion).toBe('ai-image-provider-runtime/v2');
    expect(legacy).not.toHaveProperty('currency');
  });

  it.each(['EUR', '', null])('rejects an unsupported explicit currency %j', currency => {
    expect(() => createAiImageProviderRuntimeContract({ ...wanx, currency } as never, shape)).toThrow(AiImageProviderRuntimeContractError);
  });

  it('keeps strict quote validation sensitive to currency', () => {
    const contract = createAiImageProviderRuntimeContract({ ...wanx, currency: 'CNY' } as never, shape);
    expect(() => assertAiImageProviderRuntimeContract(contract, { ...wanx, currency: 'USD' } as never,
      { ...shape, estimatedCostCents: 7 })).toThrow(AiImageProviderRuntimeContractError);
  });

  it.each([false, true])('binds execution to the frozen price/currency while active pricing changes (v3=%s)', explicit => {
    const identity = explicit ? { ...wanx, currency: 'CNY' as const } : wanx;
    const contract = createAiImageProviderRuntimeContract(identity, shape);
    const bind = (runtimeOwner as Record<string, any>).bindAiImageProviderExecutionConfig;
    expect(typeof bind).toBe('function');
    const current = { ...wanx, costPerImageCents: 99, currency: explicit ? 'USD' : 'CNY' };
    const bound = bind(contract, current, { ...shape, estimatedCostCents: 7 });
    expect(bound).toMatchObject({ costPerImageCents: 7, currency: explicit ? 'CNY' : 'USD', apiKey: config.apiKey });
    expect(current.costPerImageCents).toBe(99);
    expect(() => bind(contract, { ...current, credentialRevision: { ...credentialRevision, revision: 8 } },
      { ...shape, estimatedCostCents: 7 })).toThrow(AiImageProviderRuntimeContractError);
    expect(() => bind(contract, { ...current, model: 'changed-model' }, { ...shape, estimatedCostCents: 7 }))
      .toThrow(AiImageProviderRuntimeContractError);
    expect(() => bind(contract, current, { ...shape, count: 2, estimatedCostCents: 14 }))
      .toThrow(AiImageProviderRuntimeContractError);
  });

  it('freezes a non-secret credential record revision for Wanx without changing other providers', () => {
    const contract = createAiImageProviderRuntimeContract(wanx, shape);
    expect(contract).toMatchObject({
      contractVersion: 'ai-image-provider-runtime/v2', credentialRevision,
    });
    expect(contract.credentialRevision).not.toBe(credentialRevision);
    expect(JSON.stringify(contract)).not.toContain(config.apiKey);
    expect(assertAiImageProviderRuntimeContract(contract, wanx, {
      ...shape, estimatedCostCents: 7,
    })).toEqual(contract);
    expect(createAiImageProviderRuntimeContract({ ...config, credentialRevision }, shape))
      .toMatchObject({ contractVersion: 'ai-image-provider-runtime/v1' });
  });

  it('fails a legacy or missing Wanx credential binding closed instead of adopting the active account', () => {
    const { credentialRevision: _revision, ...missing } = wanx;
    expect(() => createAiImageProviderRuntimeContract(missing, shape))
      .toThrow(AiImageProviderRuntimeContractError);
    const contract = createAiImageProviderRuntimeContract(wanx, shape);
    expect(() => assertAiImageProviderRuntimeContract({
      ...contract, contractVersion: 'ai-image-provider-runtime/v1', credentialRevision: undefined,
    }, wanx, { ...shape, estimatedCostCents: 7 })).toThrow(AiImageProviderRuntimeContractError);
  });

  it.each([
    { ...credentialRevision, revision: 8 },
    { ...credentialRevision, recordId: 'recreated-key-record' },
    { ...credentialRevision, updatedAt: '2026-09-09T10:00:01.000Z' },
  ])('rejects an account rotation or recreated config record: %j', (changed) => {
    const contract = createAiImageProviderRuntimeContract(wanx, shape);
    expect(() => assertAiImageProviderRuntimeContract(contract, {
      ...wanx, credentialRevision: changed,
    }, { ...shape, estimatedCostCents: 7 })).toThrow(AiImageProviderRuntimeContractError);
  });

  it.each([
    null,
    { ...credentialRevision, revision: -1 },
    { ...credentialRevision, revision: '7' },
    { ...credentialRevision, updatedAt: 'not-a-date' },
    { ...credentialRevision, recordId: '' },
    { ...credentialRevision, apiKey: 'never-freeze-this' },
  ])('rejects invalid or secret-bearing credential metadata: %j', (invalid) => {
    expect(() => createAiImageProviderRuntimeContract({
      ...wanx, credentialRevision: invalid,
    } as never, shape)).toThrow(AiImageProviderRuntimeContractError);
  });

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
