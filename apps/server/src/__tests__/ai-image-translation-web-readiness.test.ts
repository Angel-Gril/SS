import { describe, expect, it } from 'vitest';
import { resolveAiImageTranslationReadiness } from '../routes/ai-images.js';
import { resolveAiImageProviderCapability } from '../services/ai-image-provider-capabilities.js';

describe('Web paid translation price confirmation boundary', () => {
  it('does not advertise paid translation before the Web owner can confirm a frozen quote', () => {
    const capability = { ...resolveAiImageProviderCapability('dashscope-qwen-mt-image', 'qwen-mt-image')!, evidenceLevel: 'sandbox-verified' as const };
    const result = resolveAiImageTranslationReadiness({
      enabled: true, provider: 'dashscope-qwen-mt-image', model: 'qwen-mt-image', dailyLimit: 20,
      estimatedCostCents: 14, globalDailyBudgetCents: 100, categoryGlossaryJson: '{"version":1,"profiles":[]}',
    }, { production: true, storageReadiness: { ready: true, reason: 'ready', backend: 'oss', publicHttps: true }, resolveCapability: () => capability });
    expect(result).toMatchObject({ enabled: true, ready: false, reasonCode: 'WEB_TRANSLATION_PRICE_CONFIRMATION_UNAVAILABLE' });
  });
});
