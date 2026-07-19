import { describe, expect, it } from 'vitest';
import {
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
    expect(resolveAiImageProviderCapability('openai-images', 'gpt-image-1')?.operations).toEqual([
      'TEXT_TO_IMAGE',
    ]);
    expect(
      supportsAiMediaOperation('dashscope-wanx', 'wanx2.1-t2i-turbo', 'IMAGE_TO_IMAGE', 1),
    ).toBe(false);
    expect(supportsAiMediaOperation('openai-images', 'gpt-image-1', 'FULL_EDIT', 1)).toBe(false);
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

  it('preserves typed capability failure reasons', () => {
    expect(() =>
      assertAiMediaCapability({ provider: 'unknown', model: 'x', operation: 'TEXT_TO_IMAGE' }),
    ).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_PROVIDER_MODEL' }));
    expect(() =>
      assertAiMediaCapability({
        provider: 'openai-images',
        model: 'gpt-image-1',
        operation: 'IMAGE_TO_IMAGE',
        inputCount: 1,
      }),
    ).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_OPERATION' }));
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
