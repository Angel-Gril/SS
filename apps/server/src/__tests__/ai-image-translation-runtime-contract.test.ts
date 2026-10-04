import { describe, expect, it } from 'vitest';
import { aiImageProviderEndpointSha256 } from '../services/ai-image-provider-runtime-contract.js';
import { resolveAiImageProviderCapability } from '../services/ai-image-provider-capabilities.js';
import {
  assertAiImageTranslationRuntime,
  buildAiImageTranslationRuntime,
  resolvePaidAiImageTranslationReadiness,
} from '../services/ai-image-translation-runtime-contract.js';

const credentialRevision = { recordId: 'translation-key-1', revision: 2, updatedAt: '2026-10-04T00:00:00.000Z' };
const settings = {
  enabled: true, provider: 'dashscope-qwen-mt-image', model: 'qwen-mt-image',
  baseUrl: 'https://dashscope.aliyuncs.com/api/v1', hasApiKey: true,
  estimatedCostCents: 14, globalDailyBudgetCents: 100, dailyLimit: 20,
  currency: 'CNY' as const, credentialRevision,
};
const storage = { ready: true, reason: 'ready', backend: 'oss' as const, publicHttps: true };
const capability = {
  ...resolveAiImageProviderCapability(settings.provider, settings.model)!,
  evidenceLevel: 'sandbox-verified' as const,
  sandboxEvidence: [{
    endpointSha256: aiImageProviderEndpointSha256(settings.provider, settings.baseUrl),
    operation: 'IMAGE_TRANSLATE' as const, inputTransport: 'public_url' as const, resultMode: 'async' as const,
  }],
};

describe('paid image translation runtime', () => {
  it('keeps the actual characterized registry dark', () => {
    expect(resolvePaidAiImageTranslationReadiness(settings, storage)).toMatchObject({ ready: false, reasonCode: 'MEDIA_PROVIDER_NOT_ALLOWED' });
  });

  it('requires exact registered endpoint/model/operation transport evidence', () => {
    const readiness = resolvePaidAiImageTranslationReadiness(settings, storage, () => capability);
    expect(readiness).toMatchObject({ ready: true, testOnly: false, price: {
      currency: 'CNY', unitCostCents: 14, maximumCostCents: 14,
      quoteFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
    } });
    for (const proof of [
      { ...capability, sandboxEvidence: [] },
      { ...capability, model: '*' },
      { ...capability, sandboxEvidence: [{ ...capability.sandboxEvidence[0]!, endpointSha256: 'a'.repeat(64) }] },
      { ...capability, sandboxEvidence: [{ ...capability.sandboxEvidence[0]!, operation: 'FULL_EDIT' as const }] },
      { ...capability, sandboxEvidence: [{ ...capability.sandboxEvidence[0]!, inputTransport: 'base64' as const }] },
    ]) expect(resolvePaidAiImageTranslationReadiness(settings, storage, () => proof).ready).toBe(false);
  });

  it.each([
    { enabled: false }, { hasApiKey: false }, { credentialRevision: undefined },
    { estimatedCostCents: 0 }, { globalDailyBudgetCents: 0 }, { currency: undefined },
    { model: 'wanx2.1-imageedit' }, { baseUrl: 'https://relay.example/api/v1' },
    { baseUrl: 'https://dashscope.aliyuncs.com:8443/api/v1' },
    { baseUrl: 'https://dashscope.aliyuncs.com/other' },
  ])('rejects incomplete or unauthorized runtime %j', (change) => {
    expect(resolvePaidAiImageTranslationReadiness({ ...settings, ...change }, storage, () => capability).ready).toBe(false);
  });

  it('requires owned public OSS input transport', () => {
    for (const input of [undefined, { ...storage, ready: false }, { ...storage, publicHttps: false }, { ...storage, backend: 'local' as const }]) {
      expect(resolvePaidAiImageTranslationReadiness(settings, input, () => capability).ready).toBe(false);
    }
  });

  it('binds the price acknowledgement to the endpoint and credential revision', () => {
    const original = buildAiImageTranslationRuntime(settings);
    expect(buildAiImageTranslationRuntime({ ...settings, credentialRevision: { ...credentialRevision, revision: 3 } }).price.quoteFingerprint).not.toBe(original.price.quoteFingerprint);
    expect(buildAiImageTranslationRuntime({ ...settings, estimatedCostCents: 15 }).price.quoteFingerprint).not.toBe(original.price.quoteFingerprint);
    expect(() => assertAiImageTranslationRuntime(original.runtime, { ...settings, credentialRevision: { ...credentialRevision, revision: 3 } }, 14)).toThrow();
    expect(() => assertAiImageTranslationRuntime(original.runtime, settings, 15)).toThrow();
    expect(assertAiImageTranslationRuntime(original.runtime, settings, 14)).toEqual(original.runtime);
  });
});
