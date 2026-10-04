import { describe, expect, it } from 'vitest';
import { canRunAiImageProviderOperation, canUseAiImageJobOperation } from '../services/ai-image-provider-admission.js';
import { hasExactAiMediaSandboxEvidence, resolveAiImageProviderCapability } from '../services/ai-image-provider-capabilities.js';
import { aiImageProviderEndpointSha256, createAiImageProviderRuntimeContract } from '../services/ai-image-provider-runtime-contract.js';
import { buildAiImageTranslationRuntime } from '../services/ai-image-translation-runtime-contract.js';

const openai = {
  provider: 'openai-images', model: 'gpt-image-1', baseUrl: 'https://api.openai.com/v1',
  operation: 'TEXT_TO_IMAGE' as const, inputTransport: 'none' as const, resultMode: 'sync' as const,
};
const wanx = {
  provider: 'dashscope-wanx', model: 'wanx2.1-t2i-turbo', baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
  operation: 'TEXT_TO_IMAGE' as const, inputTransport: 'none' as const, resultMode: 'async' as const,
};

describe('Normal AI image protocol admission', () => {
  it('admits an existing frozen translation for review only with exact sandbox evidence', () => {
    const runtime = buildAiImageTranslationRuntime({
      enabled: true, provider: 'dashscope-qwen-mt-image', model: 'qwen-mt-image',
      baseUrl: 'https://dashscope.aliyuncs.com/api/v1', currency: 'CNY', estimatedCostCents: 14,
      credentialRevision: { recordId: 'translation-key-1', revision: 2, updatedAt: '2026-10-04T00:00:00.000Z' },
    }).runtime;
    const capability = { ...resolveAiImageProviderCapability(runtime.provider, runtime.model)!, evidenceLevel: 'sandbox-verified' as const,
      sandboxEvidence: [{ endpointSha256: runtime.baseUrlSha256, operation: 'IMAGE_TRANSLATE' as const, inputTransport: 'public_url' as const, resultMode: 'async' as const }] };
    const job = { provider: runtime.provider, model: runtime.model, operation: 'IMAGE_TRANSLATE', operationConfig: { translationRuntime: runtime } };
    expect(canUseAiImageJobOperation(job, true, () => capability)).toBe(true);
    expect(canUseAiImageJobOperation(job, true)).toBe(true);
    expect(canUseAiImageJobOperation(job, true, () => ({ ...capability, evidenceLevel: 'adapter-characterized' }))).toBe(false);
    expect(canUseAiImageJobOperation({ ...job, operationConfig: {} }, true, () => capability)).toBe(false);
    expect(canUseAiImageJobOperation({ ...job, operationConfig: { translationRuntime: { ...runtime, baseUrlSha256: 'a'.repeat(64) } } }, true, () => capability)).toBe(false);
  });

  it.each(['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'] as const)('admits an existing normal %s job by its frozen endpoint', (operation) => {
    const runtime = createAiImageProviderRuntimeContract({ ...openai, costPerImageCents: 14, currency: 'CNY' }, { count: 1, width: 1024, height: 1024 });
    const job = { provider: openai.provider, model: openai.model, operation,
      operationConfig: operation === 'IMAGE_TO_IMAGE' ? runtime : { providerRuntime: runtime } };
    expect(canUseAiImageJobOperation(job, true)).toBe(true);
    expect(canUseAiImageJobOperation({ ...job, operationConfig: null }, true)).toBe(false);
    expect(canUseAiImageJobOperation({ ...job, operationConfig: { ...runtime, baseUrlSha256: 'a'.repeat(64) } }, true)).toBe(false);
    expect(canUseAiImageJobOperation({ ...job, model: 'another-model' }, true)).toBe(false);
  });

  it('keeps legacy characterized jobs closed and fake jobs out of production', () => {
    expect(canUseAiImageJobOperation({ provider: 'fake', operation: 'IMAGE_TRANSLATE' }, false)).toBe(true);
    expect(canUseAiImageJobOperation({ provider: 'fake', operation: 'IMAGE_TRANSLATE' }, true)).toBe(false);
    expect(canUseAiImageJobOperation({ provider: 'custom', model: 'unregistered', operation: 'FULL_EDIT' }, true)).toBe(false);
    expect(canUseAiImageJobOperation({ provider: 'dashscope-wanx', model: 'wanx2.1-imageedit', operation: 'FULL_EDIT' }, true)).toBe(true);
    expect(canUseAiImageJobOperation({ provider: 'dashscope-wanx', model: 'wanx2.1-imageedit', operation: 'FULL_EDIT', operationConfig: { providerRuntime: null } }, true)).toBe(false);
  });
  it.each([
    openai, wanx,
    ...(['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'] as const).map(operation => ({
      ...openai, operation, inputTransport: 'multipart' as const,
    })),
    ...(['FULL_EDIT', 'INPAINT'] as const).map(operation => ({
      ...wanx, model: 'wanx2.1-imageedit', operation, inputTransport: 'base64' as const,
    })),
    { ...openai, provider: 'custom', model: 'admin-selected-image-model', baseUrl: 'https://relay.example/v1' },
  ])('admits registered $provider/$model/$operation from a configured or frozen endpoint', (input) => {
    const capability = resolveAiImageProviderCapability(input.provider, input.model);
    expect(canRunAiImageProviderOperation({ ...input, capability })).toBe(true);
    expect(canRunAiImageProviderOperation({
      ...input, capability, baseUrl: undefined,
      baseUrlSha256: aiImageProviderEndpointSha256(input.provider, input.baseUrl),
    })).toBe(true);
  });

  it('keeps normal protocol readiness separate from a real sandbox receipt', () => {
    const capability = resolveAiImageProviderCapability(openai.provider, openai.model);
    expect(canRunAiImageProviderOperation({ ...openai, capability })).toBe(true);
    expect(capability?.evidenceLevel).toBe('adapter-characterized');
    expect(hasExactAiMediaSandboxEvidence({ ...openai, capability })).toBe(false);
  });

  it.each([
    { ...openai, provider: 'unknown' },
    { ...openai, model: 'unknown-openai-model' },
    { ...wanx, model: 'unknown-wanx-model' },
    { ...openai, baseUrl: 'https://relay.example/v1' },
    { ...wanx, baseUrl: 'https://workspace-other.cn-beijing.maas.aliyuncs.com/api/v1' },
    { ...openai, baseUrl: 'http://api.openai.com/v1' },
    { ...openai, baseUrl: 'https://user:password@api.openai.com/v1' },
    { ...openai, baseUrl: 'https://api.openai.com/v1?token=synthetic' },
    { ...openai, inputTransport: 'multipart' as const },
    { ...openai, resultMode: 'async' as const },
    { ...wanx, resultMode: 'sync' as const },
    { ...openai, provider: 'custom', model: '', baseUrl: 'https://relay.example/v1' },
    ...(['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'] as const).map(operation => ({
      ...openai, provider: 'custom', model: 'admin-selected-image-model', baseUrl: 'https://relay.example/v1',
      operation, inputTransport: 'multipart' as const,
    })),
  ])('rejects unsupported identity or protocol: $provider/$model/$operation/$baseUrl', (input) => {
    expect(canRunAiImageProviderOperation({
      ...input, capability: resolveAiImageProviderCapability(input.provider, input.model),
    })).toBe(false);
  });

  it.each(['', 'A'.repeat(64), 'a'.repeat(64)])('rejects an invalid or inconsistent frozen official endpoint: %s', (baseUrlSha256) => {
    const capability = resolveAiImageProviderCapability(openai.provider, openai.model);
    expect(canRunAiImageProviderOperation({ ...openai, capability, baseUrlSha256 })).toBe(false);
    expect(canRunAiImageProviderOperation({ ...openai, capability, baseUrl: undefined, baseUrlSha256 })).toBe(false);
  });
});
