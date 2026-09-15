import { describe, expect, it } from 'vitest';
import { AiImageJobError } from '../services/ai-image-jobs.js';
import { buildAiImageGenerationQuote } from '../services/ai-image-generation-quote.js';

describe('AI image generation quote', () => {
  it('freezes the positive per-image price into a safe total and runtime contract', () => {
    const quote = buildAiImageGenerationQuote({
      provider: 'openai-images',
      model: 'gpt-image-1',
      baseUrl: 'https://api.openai.com/v1',
      costPerImageCents: 7,
    }, {
      count: 2,
      width: 1024,
      height: 1024,
    });
    expect(quote.estimatedCostCents).toBe(14);
    expect(quote.maximumCostCents).toBe(14);
    expect(quote.operationConfig).toEqual(expect.objectContaining({
      contractVersion: 'ai-image-provider-runtime/v1',
      unitCostCents: 7,
      imageCount: 2,
      maximumCostCents: 14,
    }));
  });

  it('keeps fake lifecycle jobs at zero cost without a paid runtime contract', () => {
    expect(buildAiImageGenerationQuote({
      provider: 'fake', model: 'fake-image-v1', baseUrl: '', costPerImageCents: 0,
    }, {
      count: 1, width: 1024, height: 1024,
    })).toMatchObject({ estimatedCostCents: 0, maximumCostCents: 0, operationConfig: null,
      preview: { currency: 'USD', unitCostCents: 0, maximumCostCents: 0 } });
  });

  it('exposes a stable public price bound to currency, count, canvas, model and endpoint without runtime metadata', () => {
    const provider = { provider: 'custom', model: 'configured-image-model',
      baseUrl: 'https://relay.example/v1', costPerImageCents: 14, currency: 'CNY' as const };
    const request = { count: 2, width: 1024, height: 1024 };
    const preview = buildAiImageGenerationQuote(provider, request).preview;
    expect(preview).toEqual({
      provider: provider.provider, model: provider.model, currency: 'CNY', unitCostCents: 14,
      requestedImageCount: 2, width: 1024, height: 1024, maximumCostCents: 28,
      quoteFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(buildAiImageGenerationQuote({ ...provider, baseUrl: `${provider.baseUrl}/` }, request).preview).toEqual(preview);
    for (const change of [
      { currency: 'USD' as const }, { costPerImageCents: 15 }, { model: 'other-image-model' },
      { baseUrl: 'https://another.example/v1' },
    ]) {
      expect(buildAiImageGenerationQuote({ ...provider, ...change }, request).preview.quoteFingerprint)
        .not.toBe(preview.quoteFingerprint);
    }
    for (const change of [{ count: 1 }, { width: 1536 }, { height: 1536 }]) {
      expect(buildAiImageGenerationQuote(provider, { ...request, ...change }).preview.quoteFingerprint)
        .not.toBe(preview.quoteFingerprint);
    }
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER])(
    'rejects an unsafe paid unit price %s',
    (costPerImageCents) => {
      expect(() => buildAiImageGenerationQuote({
        provider: 'openai-images', model: 'gpt-image-1',
        baseUrl: 'https://api.openai.com/v1', costPerImageCents,
      }, {
        count: 4, width: 1024, height: 1024,
      })).toThrow(AiImageJobError);
    },
  );
});
