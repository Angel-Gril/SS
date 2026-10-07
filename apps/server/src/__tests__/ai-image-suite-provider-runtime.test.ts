import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AiImageProviderCapability } from '../services/ai-image-provider-capabilities.js';
import { aiImageProviderEndpointSha256 } from '../services/ai-image-provider-runtime-contract.js';
import { hashAiMediaPlanningJson } from '../services/ai-media-planning.js';
import { createDonorGpt2FullFrameConfig } from '../services/ai-image-donor-gpt2-profile.js';
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
  it('admits only the live verified single-reference count alias and rejects another origin',()=>{
    const correct=settings({provider:'custom',model:'gpt-image-2-count',baseUrl:'https://ai.big-model-api.top/v1',
      credentialRevision:{recordId:'fixture-donor-key',revision:1,updatedAt:'2026-10-08T00:00:00.000Z'}});
    expect(createAiImageSuiteProviderRuntimeSnapshot(correct)).toMatchObject({executionReady:true,reasonCode:'READY',capability:{maxReferences:1}});
    expect(createAiImageSuiteProviderRuntimeSnapshot({...correct,baseUrl:'https://wrong.fixture.example/v1'}))
      .toMatchObject({executionReady:false,reasonCode:'PROVIDER_CONFIG_INVALID'});
  });
  const donorSettings = (overrides: Record<string, unknown> = {}) => settings({
    provider: 'custom', model: 'gpt-image-2', baseUrl: 'https://configured-provider.example/v1', ...overrides,
  });
  const donorCapability = (): AiImageProviderCapability => ({
    ...exactCapability('sandbox-verified'), provider: 'custom', model: 'gpt-image-2', operations: ['IMAGE_TO_IMAGE'],
    supportsMask: false, sandboxEvidence: [{
      endpointSha256: aiImageProviderEndpointSha256('custom', donorSettings().baseUrl),
      operation: 'IMAGE_TO_IMAGE' as const, inputTransport: 'multipart' as const, resultMode: 'sync' as const,
    }],
  });

  it('keeps the registered donor GPT2 adapter dark while exposing the actual portrait request and a secret-free preview', () => {
    const snapshot = createAiImageSuiteProviderRuntimeSnapshot(donorSettings(), { nodeEnv: 'production' });
    expect(snapshot).toMatchObject({ configured: true, executionReady: false, testOnly: true,
      reasonCode: 'PROVIDER_EVIDENCE_UNVERIFIED',
      capability: { provider: 'custom', model: 'gpt-image-2', evidenceLevel: 'adapter-characterized', maxReferences: 16 },
      providerRuntime: { width: 1008, height: 1344, imageCount: 1 },
    });
    expect(JSON.stringify(snapshot)).not.toContain('secret-key-must-not-leak');
    expect(JSON.stringify(snapshot)).not.toContain(donorSettings().baseUrl);
  });

  it('binds injected exact donor endpoint evidence to the full-frame recipe and one-image quote', () => {
    const snapshot = createAiImageSuiteProviderRuntimeSnapshot(donorSettings(), { resolveCapability: () => donorCapability() });
    expect(snapshot).toMatchObject({ executionReady: true, testOnly: false, reasonCode: 'READY',
      providerRuntime: { width: 1008, height: 1344, imageCount: 1, unitCostCents: 8, maximumCostCents: 8 },
    });
    expect(snapshot.providerConfig!.providerConfigHash).toBe(hashAiMediaPlanningJson({
      version: 'ai-image-suite-provider-runtime/v1', providerRuntime: snapshot.providerRuntime,
      finalOutput: createDonorGpt2FullFrameConfig().finalOutput,
      concurrencyLimit: 2,
    }));
  });

  it('rejects donor endpoint drift instead of inheriting evidence from another vendor', () => {
    const snapshot = createAiImageSuiteProviderRuntimeSnapshot(donorSettings({ baseUrl: 'https://another-provider.example/v1' }),
      { resolveCapability: () => donorCapability() });
    expect(snapshot).toMatchObject({ executionReady: false, testOnly: true, reasonCode: 'PROVIDER_EVIDENCE_UNVERIFIED' });
  });

  const wanxSettings = (overrides: Record<string, unknown> = {}) => settings({
    provider: 'dashscope-wanx', model: 'wanx2.1-imageedit',
    baseUrl: 'https://dashscope.aliyuncs.com/api/v1', costPerImageCents: 14, currency: 'CNY',
    credentialRevision: { recordId: 'wanx-key', revision: 4, updatedAt: '2026-09-16T00:00:00.000Z' },
    ...overrides,
  });

  it('admits the registered Wanx single-reference asynchronous transport and freezes CNY plus its credential revision', () => {
    const snapshot = createAiImageSuiteProviderRuntimeSnapshot(wanxSettings(), { nodeEnv: 'production' });
    expect(snapshot).toMatchObject({
      configured: true, executionReady: true, testOnly: false, reasonCode: 'READY',
      capability: { inputTransport: 'base64', resultMode: 'async', maxReferences: 1 },
      providerRuntime: { contractVersion: 'ai-image-provider-runtime/v3', currency: 'CNY',
        width: 1024, height: 1024, imageCount: 1, unitCostCents: 14, maximumCostCents: 14,
        credentialRevision: { recordId: 'wanx-key', revision: 4 } },
      providerConfig: { pricingVersion: expect.stringMatching(/^ai-image-suite-price-cny\/v1:/u) },
    });
    expect(JSON.stringify(snapshot)).not.toContain('secret-key-must-not-leak');
  });

  it('rejects invalid Wanx currency, absent revisions, custom endpoints and changed frozen identity', () => {
    for (const change of [{ currency: 'USD' }, { credentialRevision: undefined }, { baseUrl: 'https://relay.example/api/v1' }]) {
      expect(createAiImageSuiteProviderRuntimeSnapshot(wanxSettings(change)).executionReady).toBe(false);
    }
    const initial = createAiImageSuiteProviderRuntimeSnapshot(wanxSettings());
    const rotated = createAiImageSuiteProviderRuntimeSnapshot(wanxSettings({
      credentialRevision: { recordId: 'wanx-key', revision: 5, updatedAt: '2026-09-16T01:00:00.000Z' },
    }));
    expect(initial.providerConfig).not.toBeNull();
    expect(rotated.providerConfig?.providerConfigHash).not.toBe(initial.providerConfig?.providerConfigHash);
  });

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
    ['bare custom origin', 'https://relay.example', 'https://relay.example/v1'],
    ['custom path prefix', 'https://relay.example/openai', 'https://relay.example/openai/v1'],
  ])('accepts exact custom evidence across the canonical %s representation', (
    _label,
    configuredBaseUrl,
    evidenceBaseUrl,
  ) => {
    const capability = {
      ...exactCapability('sandbox-verified'),
      provider: 'custom',
      sandboxEvidence: [{
        endpointSha256: aiImageProviderEndpointSha256('custom', evidenceBaseUrl),
        operation: 'IMAGE_TO_IMAGE' as const,
        inputTransport: 'multipart' as const,
        resultMode: 'sync' as const,
      }],
    } satisfies AiImageProviderCapability;
    const snapshot = createAiImageSuiteProviderRuntimeSnapshot(settings({
      provider: 'custom',
      baseUrl: configuredBaseUrl,
    }), {
      resolveCapability: () => capability,
    });

    expect(snapshot).toMatchObject({
      configured: true,
      executionReady: true,
      testOnly: false,
      reasonCode: 'READY',
      providerRuntime: { provider: 'custom' },
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
