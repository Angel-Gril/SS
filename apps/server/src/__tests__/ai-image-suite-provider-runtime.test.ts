import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AiImageProviderCapability } from '../services/ai-image-provider-capabilities.js';
import { aiImageProviderEndpointSha256 } from '../services/ai-image-provider-runtime-contract.js';
import {
  AI_IMAGE_SUITE_PROVIDER_REQUEST_HEIGHT,
  AI_IMAGE_SUITE_PROVIDER_REQUEST_WIDTH,
  aiImageSuiteProviderConfigMatches,
  aiImageSuiteProviderRuntimeMatches,
  createAiImageSuiteProviderRuntimeSnapshot,
  createProviderFreeAiImageSuiteConfig,
} from '../services/ai-image-suite-provider-runtime.js';

const settings = (overrides: Record<string, unknown> = {}) => ({
  provider: 'openai-images',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'secret-key-must-not-leak',
  model: 'gpt-image-1',
  costPerImageCents: 8,
  concurrencyLimit: 2,
  ...overrides,
}) as any;

const exactCapability = (evidenceLevel: AiImageProviderCapability['evidenceLevel']) => ({
  provider: 'openai-images',
  model: 'gpt-image-1',
  operations: ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'],
  maxReferences: 16,
  supportsMask: true,
  inputTransport: 'multipart',
  resultMode: 'sync',
  evidenceLevel,
  evidence: 'test evidence',
  ...(evidenceLevel === 'sandbox-verified' ? {
    sandboxEvidence: [{
      endpointSha256: aiImageProviderEndpointSha256(
        'openai-images',
        'https://api.openai.com/v1',
      ),
      operation: 'IMAGE_TO_IMAGE' as const,
      inputTransport: 'multipart' as const,
      resultMode: 'sync' as const,
    }],
  } : {}),
}) satisfies AiImageProviderCapability;

describe('AI image suite Provider runtime snapshot', () => {
  it('preserves the stable provider-free identity and blocks fake in production', () => {
    const expected = createHash('sha256').update(JSON.stringify({
      version: 'ai-image-suite-runtime/v1',
      provider: 'fake',
      model: 'fake-image-suite-v1',
      pricingVersion: 'provider-free-zero/v1',
      estimatedCostPerImageCents: 0,
      maximumCostPerImageCents: 0,
      concurrencyLimit: 2,
    })).digest('hex');
    expect(createProviderFreeAiImageSuiteConfig()).toEqual({
      provider: 'fake',
      model: 'fake-image-suite-v1',
      providerConfigHash: expected,
      pricingVersion: 'provider-free-zero/v1',
      estimatedCostPerImageCents: 0,
      maximumCostPerImageCents: 0,
      concurrencyLimit: 2,
    });
    expect(createAiImageSuiteProviderRuntimeSnapshot(settings({ provider: 'fake' }), {
      nodeEnv: 'development',
    })).toMatchObject({ executionReady: true, testOnly: true, reasonCode: 'READY' });
    expect(createAiImageSuiteProviderRuntimeSnapshot(settings({ provider: 'fake' }), {
      nodeEnv: 'production',
    })).toMatchObject({
      executionReady: false,
      testOnly: true,
      reasonCode: 'FAKE_PRODUCTION_BLOCKED',
    });
  });

  it('builds a secret-free frozen runtime and keeps adapter-characterized paid execution dark', () => {
    const snapshot = createAiImageSuiteProviderRuntimeSnapshot(settings());
    expect(snapshot).toMatchObject({
      configured: true,
      executionReady: false,
      testOnly: true,
      reasonCode: 'PROVIDER_EVIDENCE_UNVERIFIED',
      providerRuntime: {
        provider: 'openai-images',
        model: 'gpt-image-1',
        imageCount: 1,
        width: AI_IMAGE_SUITE_PROVIDER_REQUEST_WIDTH,
        height: AI_IMAGE_SUITE_PROVIDER_REQUEST_HEIGHT,
        unitCostCents: 8,
        maximumCostCents: 8,
      },
      providerConfig: {
        estimatedCostPerImageCents: 8,
        maximumCostPerImageCents: 8,
        concurrencyLimit: 2,
      },
    });
    const publicJson = JSON.stringify(snapshot);
    expect(publicJson).not.toContain('secret-key-must-not-leak');
    expect(publicJson).not.toContain('https://api.openai.com');
  });

  it('activates only an injected exact sandbox-verified capability', () => {
    const snapshot = createAiImageSuiteProviderRuntimeSnapshot(settings(), {
      resolveCapability: () => exactCapability('sandbox-verified'),
    });
    expect(snapshot).toMatchObject({
      configured: true,
      executionReady: true,
      testOnly: false,
      reasonCode: 'READY',
      capability: { model: 'gpt-image-1', evidenceLevel: 'sandbox-verified' },
    });
  });

  it.each([
    ['endpoint', { endpointSha256: '0'.repeat(64) }],
    ['operation', { operation: 'FULL_EDIT' as const }],
    ['input transport', { inputTransport: 'base64' as const }],
    ['result mode', { resultMode: 'async' as const }],
  ])('keeps paid suites dark when sandbox evidence has the wrong %s', (_label, change) => {
    const exact = exactCapability('sandbox-verified');
    const snapshot = createAiImageSuiteProviderRuntimeSnapshot(settings(), {
      resolveCapability: () => ({
        ...exact,
        sandboxEvidence: [{ ...exact.sandboxEvidence![0]!, ...change }],
      }),
    });
    expect(snapshot).toMatchObject({
      configured: true,
      executionReady: false,
      reasonCode: 'PROVIDER_EVIDENCE_UNVERIFIED',
      testOnly: true,
    });
  });

  it('rejects wildcard and non-image-to-image capability fallbacks', () => {
    const wildcard = { ...exactCapability('sandbox-verified'), model: '*' };
    expect(createAiImageSuiteProviderRuntimeSnapshot(settings({ model: 'unknown-model' }), {
      resolveCapability: () => wildcard,
    })).toMatchObject({
      providerConfig: null,
      executionReady: false,
      reasonCode: 'PROVIDER_CAPABILITY_UNSUPPORTED',
    });
    expect(createAiImageSuiteProviderRuntimeSnapshot(settings(), {
      resolveCapability: () => ({
        ...exactCapability('sandbox-verified'),
        operations: ['TEXT_TO_IMAGE'],
        maxReferences: 0,
      }),
    })).toMatchObject({
      providerConfig: null,
      reasonCode: 'PROVIDER_CAPABILITY_UNSUPPORTED',
    });
  });

  it('keeps credential presence out of the hash while rejecting endpoint drift and hashing price drift', () => {
    const resolver = () => exactCapability('sandbox-verified');
    const first = createAiImageSuiteProviderRuntimeSnapshot(settings(), { resolveCapability: resolver });
    const rotatedKey = createAiImageSuiteProviderRuntimeSnapshot(settings({ apiKey: 'rotated-secret' }), {
      resolveCapability: resolver,
    });
    const changedEndpoint = createAiImageSuiteProviderRuntimeSnapshot(
      settings({ baseUrl: 'https://images.example.com/v1' }),
      { resolveCapability: resolver },
    );
    const changedPrice = createAiImageSuiteProviderRuntimeSnapshot(settings({ costPerImageCents: 9 }), {
      resolveCapability: resolver,
    });
    expect(rotatedKey.providerConfig).toEqual(first.providerConfig);
    expect(changedEndpoint).toMatchObject({
      providerConfig: null,
      executionReady: false,
      reasonCode: 'PROVIDER_CONFIG_INVALID',
    });
    expect(changedPrice.providerConfig?.providerConfigHash)
      .not.toBe(first.providerConfig?.providerConfigHash);
    expect(changedPrice.providerConfig?.pricingVersion)
      .not.toBe(first.providerConfig?.pricingVersion);
  });

  it('exposes price preview without a key but fails execution readiness closed', () => {
    const snapshot = createAiImageSuiteProviderRuntimeSnapshot(settings({ apiKey: '' }), {
      resolveCapability: () => exactCapability('sandbox-verified'),
    });
    expect(snapshot).toMatchObject({
      providerConfig: expect.any(Object),
      configured: false,
      executionReady: false,
      reasonCode: 'PROVIDER_CREDENTIAL_MISSING',
    });
  });

  it('matches the complete frozen suite identity and total exposure only', () => {
    const snapshot = createAiImageSuiteProviderRuntimeSnapshot(settings(), {
      resolveCapability: () => exactCapability('sandbox-verified'),
    });
    const config = snapshot.providerConfig!;
    const frozen = {
      provider: config.provider,
      model: config.model,
      providerConfigHash: config.providerConfigHash,
      pricingVersion: config.pricingVersion,
      concurrencyLimit: config.concurrencyLimit,
      itemCount: 3,
      estimatedCostCents: 24,
      maximumCostCents: 24,
    };
    expect(aiImageSuiteProviderRuntimeMatches(frozen, snapshot)).toBe(true);
    expect(aiImageSuiteProviderConfigMatches(config, snapshot)).toBe(true);
    expect(aiImageSuiteProviderConfigMatches({ ...config, concurrencyLimit: 3 }, snapshot))
      .toBe(false);
    expect(aiImageSuiteProviderRuntimeMatches({ ...frozen, maximumCostCents: 25 }, snapshot))
      .toBe(false);
    expect(aiImageSuiteProviderRuntimeMatches({ ...frozen, providerConfigHash: 'a'.repeat(64) }, snapshot))
      .toBe(false);
  });

  it('fails closed for disabled, missing-price, invalid-endpoint and unsupported providers', () => {
    expect(createAiImageSuiteProviderRuntimeSnapshot(settings({ provider: 'disabled' })))
      .toMatchObject({ reasonCode: 'PROVIDER_DISABLED', providerConfig: null });
    expect(createAiImageSuiteProviderRuntimeSnapshot(settings({ costPerImageCents: 0 })))
      .toMatchObject({ reasonCode: 'PROVIDER_CONFIG_INVALID', providerConfig: null });
    expect(createAiImageSuiteProviderRuntimeSnapshot(settings({ baseUrl: 'http://api.openai.com/v1' })))
      .toMatchObject({ reasonCode: 'PROVIDER_CONFIG_INVALID', providerConfig: null });
    expect(createAiImageSuiteProviderRuntimeSnapshot(settings({
      provider: 'dashscope-wanx',
      model: 'wanx2.1-t2i-turbo',
    }))).toMatchObject({
      reasonCode: 'PROVIDER_CAPABILITY_UNSUPPORTED',
      providerConfig: null,
    });
  });
});
