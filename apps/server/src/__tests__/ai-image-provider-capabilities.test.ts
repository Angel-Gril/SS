import { describe, expect, it } from 'vitest';
import {
  AI_IMAGE_EDIT_MODEL,
  AI_IMAGE_EDIT_PROVIDER,
  AI_IMAGE_SUITE_MODEL,
  AI_IMAGE_SUITE_PROVIDER,
  AI_IMAGE_PROVIDER_CAPABILITIES,
  AiMediaCapabilityError,
  assertAiMediaCapability,
  resolveAiImageProviderCapability,
  supportsAiMediaOperation,
} from '../services/ai-image-provider-capabilities.js';

describe('AI image provider capability matrix', () => {
  it('records only operations implemented by current adapters', () => {
    expect(resolveAiImageProviderCapability('dashscope-wanx', 'wanx2.1-t2i-turbo')).toMatchObject({
      model: 'wanx2.1-t2i-turbo',
      operations: ['TEXT_TO_IMAGE'],
      evidenceLevel: 'adapter-characterized',
    });
    expect(resolveAiImageProviderCapability('dashscope-wanx', 'legacy-wanx')?.model).toBe('*');
    expect(resolveAiImageProviderCapability('openai-images', 'gpt-image-1')).toMatchObject({
      operations: ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'],
      maxReferences: 16,
      supportsMask: true,
      inputTransport: 'multipart',
      evidenceLevel: 'adapter-characterized',
    });
    expect(
      supportsAiMediaOperation('dashscope-wanx', 'wanx2.1-t2i-turbo', 'IMAGE_TO_IMAGE', 1),
    ).toBe(false);
    expect(supportsAiMediaOperation('openai-images', 'gpt-image-1', 'IMAGE_TO_IMAGE', 2)).toBe(true);
    expect(supportsAiMediaOperation('openai-images', 'gpt-image-1', 'FULL_EDIT', 2)).toBe(true);
    expect(supportsAiMediaOperation('openai-images', 'gpt-image-1', 'INPAINT', 2, 1)).toBe(true);
    expect(supportsAiMediaOperation('openai-images', 'gpt-image-1', 'IMAGE_TO_IMAGE', 0)).toBe(false);
    expect(supportsAiMediaOperation('openai-images', 'gpt-image-1', 'IMAGE_TO_IMAGE', 17)).toBe(false);
    expect(supportsAiMediaOperation('openai-images', 'gpt-image-1', 'IMAGE_TO_IMAGE', 1, 1)).toBe(false);
    expect(resolveAiImageProviderCapability('openai-images', 'unverified-model')).toMatchObject({
      model: '*', operations: ['TEXT_TO_IMAGE'], inputTransport: 'none', supportsMask: false,
      evidenceLevel: 'adapter-characterized',
    });
    expect(resolveAiImageProviderCapability('dashscope-qwen-mt-image', 'qwen-mt-image')).toMatchObject({
      operations: ['IMAGE_TRANSLATE'], maxReferences: 1, inputTransport: 'public_url',
      evidenceLevel: 'adapter-characterized',
    });
    expect(supportsAiMediaOperation('dashscope-qwen-mt-image', 'qwen-mt-image', 'IMAGE_TRANSLATE', 1)).toBe(true);
    expect(supportsAiMediaOperation('dashscope-qwen-mt-image', 'qwen-mt-image', 'IMAGE_TRANSLATE', 2)).toBe(false);
  });

  it('keeps the fake provider available for deterministic lifecycle tests only', () => {
    expect(supportsAiMediaOperation('fake', 'test', 'IMAGE_TO_IMAGE', 1)).toBe(true);
    expect(supportsAiMediaOperation('fake', 'test', 'IMAGE_TO_IMAGE', 4)).toBe(true);
    expect(supportsAiMediaOperation('fake', 'test', 'IMAGE_TO_IMAGE', 5)).toBe(false);
    expect(supportsAiMediaOperation('fake', 'test', 'IMAGE_TO_IMAGE', 0)).toBe(false);
    expect(supportsAiMediaOperation('fake', 'test', 'IMAGE_TRANSLATE', 1)).toBe(true);
    expect(supportsAiMediaOperation(
      AI_IMAGE_SUITE_PROVIDER,
      AI_IMAGE_SUITE_MODEL,
      'IMAGE_TO_IMAGE',
      5,
    )).toBe(true);
  });

  it('requires the exact reference and mask shape for fake edit operations', () => {
    expect(resolveAiImageProviderCapability(AI_IMAGE_EDIT_PROVIDER, AI_IMAGE_EDIT_MODEL)).toMatchObject({
      provider: 'fake',
      model: 'fake-image-edit-v1',
      operations: ['FULL_EDIT', 'INPAINT'],
      maxReferences: 1,
      supportsMask: true,
      evidenceLevel: 'local-test',
    });

    expect(supportsAiMediaOperation(
      AI_IMAGE_EDIT_PROVIDER,
      AI_IMAGE_EDIT_MODEL,
      'FULL_EDIT',
      1,
      0,
    )).toBe(true);
    expect(supportsAiMediaOperation(
      AI_IMAGE_EDIT_PROVIDER,
      AI_IMAGE_EDIT_MODEL,
      'FULL_EDIT',
      1,
      1,
    )).toBe(false);
    expect(supportsAiMediaOperation(
      AI_IMAGE_EDIT_PROVIDER,
      AI_IMAGE_EDIT_MODEL,
      'INPAINT',
      1,
      1,
    )).toBe(true);
    expect(supportsAiMediaOperation(
      AI_IMAGE_EDIT_PROVIDER,
      AI_IMAGE_EDIT_MODEL,
      'INPAINT',
      1,
      true,
    )).toBe(true);
    expect(supportsAiMediaOperation(
      AI_IMAGE_EDIT_PROVIDER,
      AI_IMAGE_EDIT_MODEL,
      'INPAINT',
      1,
      0,
    )).toBe(false);
    expect(supportsAiMediaOperation(
      AI_IMAGE_EDIT_PROVIDER,
      AI_IMAGE_EDIT_MODEL,
      'INPAINT',
      1,
      2,
    )).toBe(false);

    expect(() => assertAiMediaCapability({
      provider: AI_IMAGE_EDIT_PROVIDER,
      model: AI_IMAGE_EDIT_MODEL,
      operation: 'INPAINT',
      inputCount: 1,
      maskCount: 1,
    })).not.toThrow();
    expect(() => assertAiMediaCapability({
      provider: AI_IMAGE_EDIT_PROVIDER,
      model: AI_IMAGE_EDIT_MODEL,
      operation: 'INPAINT',
      inputCount: 1,
      hasMask: true,
    })).not.toThrow();
    expect(() => assertAiMediaCapability({
      provider: AI_IMAGE_EDIT_PROVIDER,
      model: AI_IMAGE_EDIT_MODEL,
      operation: 'FULL_EDIT',
      inputCount: 1,
      maskCount: 1,
    })).toThrow(expect.objectContaining({ code: 'INVALID_MEDIA_INPUT' }));
    expect(supportsAiMediaOperation('fake', 'test', 'FULL_EDIT', 1, 0)).toBe(false);
  });

  it('keeps real providers without a characterized multipart adapter fail-closed for edit and inpaint', () => {
    for (const [provider, model] of [
      ['dashscope-wanx', 'wanx2.1-t2i-turbo'],
      ['dashscope-qwen-mt-image', 'qwen-mt-image'],
    ] as const) {
      expect(supportsAiMediaOperation(provider, model, 'FULL_EDIT', 1, 0)).toBe(false);
      expect(supportsAiMediaOperation(provider, model, 'INPAINT', 1, 1)).toBe(false);
    }
  });

  it('preserves typed capability failure reasons', () => {
    expect(() =>
      assertAiMediaCapability({ provider: 'unknown', model: 'x', operation: 'TEXT_TO_IMAGE' }),
    ).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_PROVIDER_MODEL' }));
    expect(() => assertAiMediaCapability({
      provider: 'openai-images',
      model: 'gpt-image-1',
      operation: 'IMAGE_TO_IMAGE',
      inputCount: 1,
    })).not.toThrow();
    expect(() => assertAiMediaCapability({
      provider: 'openai-images',
      model: 'gpt-image-1',
      operation: 'IMAGE_TO_IMAGE',
      inputCount: 0,
    })).toThrow(expect.objectContaining({ code: 'INVALID_MEDIA_INPUT' }));
    expect(() =>
      assertAiMediaCapability({
        provider: 'fake',
        model: 'test',
        operation: 'IMAGE_TO_IMAGE',
        inputCount: 5,
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_MEDIA_INPUT' }));
    expect(() =>
      assertAiMediaCapability({
        provider: 'fake',
        model: 'test',
        operation: 'IMAGE_TO_IMAGE',
        inputCount: -1,
      }),
    ).toThrow(AiMediaCapabilityError);
  });

  it('does not treat wildcard compatibility entries as sandbox acceptance', () => {
    expect(AI_IMAGE_PROVIDER_CAPABILITIES.length).toBeGreaterThanOrEqual(5);
    for (const capability of AI_IMAGE_PROVIDER_CAPABILITIES) {
      expect(capability.evidence.length).toBeGreaterThan(0);
      expect(['local-test', 'adapter-characterized', 'sandbox-verified']).toContain(
        capability.evidenceLevel,
      );
      if (capability.model === '*') expect(capability.evidenceLevel).not.toBe('sandbox-verified');
    }
  });
});
