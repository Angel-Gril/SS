import { describe, expect, it } from 'vitest';
import { calculateAiImageTaskCost, getFrozenAiImageTaskPrice } from '../services/ai-image-task-cost.js';
import { createAiImageProviderRuntimeContract } from '../services/ai-image-provider-runtime-contract.js';
import { buildAiImageTranslationRuntime } from '../services/ai-image-translation-runtime-contract.js';

const legacy = { provider: 'openai-images', model: 'gpt-image-1', requestedImageCount: 2, width: 1024, height: 1024,
  estimatedCostCents: 28, operationConfig: null };
const config = { provider: legacy.provider, model: legacy.model, baseUrl: 'https://api.openai.com/v1', costPerImageCents: 14 };
const shape = { count: 2, width: 1024, height: 1024 };

describe('confirmed AI image task fees', () => {
  it('uses the frozen translation price and currency without Provider money or active configuration', () => {
    const runtime = buildAiImageTranslationRuntime({
      enabled: true, provider: 'dashscope-qwen-mt-image', model: 'qwen-mt-image',
      baseUrl: 'https://dashscope.aliyuncs.com/api/v1', currency: 'CNY', estimatedCostCents: 14,
      credentialRevision: { recordId: 'translation-key-1', revision: 2, updatedAt: '2026-10-04T00:00:00.000Z' },
    }).runtime;
    const job = { ...legacy, provider: runtime.provider, model: runtime.model,
      requestedImageCount: 1, estimatedCostCents: 14, operationConfig: { translationRuntime: runtime },
      costReservation: { currency: 'CNY' } };
    expect(calculateAiImageTaskCost(job, 1)).toMatchObject({ currency: 'CNY', actualCostCents: 14, billedUnits: 1 });
    expect(() => getFrozenAiImageTaskPrice({ ...job, estimatedCostCents: 15 })).toThrow();
    expect(() => getFrozenAiImageTaskPrice({ ...job, operationConfig: { translationRuntime: null } })).toThrow();
  });

  it('calculates a partial successful result with the frozen CNY unit price', () => {
    const task = { ...legacy, operationConfig: createAiImageProviderRuntimeContract({ ...config, currency: 'CNY' }, shape),
      costReservation: { currency: 'CNY' } };
    expect(getFrozenAiImageTaskPrice(task)).toEqual({ currency: 'CNY', unitCostCents: 14, requestedImageCount: 2, maximumCostCents: 28 });
    expect(calculateAiImageTaskCost(task, 1)).toEqual({ currency: 'CNY', unitCostCents: 14, actualCostCents: 14, billedUnits: 1 });
    expect(calculateAiImageTaskCost(task, 0)).toMatchObject({ actualCostCents: 0, billedUnits: 0 });
  });

  it.each([null, createAiImageProviderRuntimeContract(config, shape)])('preserves USD meaning for a legacy quote: %j', operationConfig => {
    const task = { ...legacy, operationConfig };
    expect(calculateAiImageTaskCost(task, 1)).toMatchObject({ currency: 'USD', actualCostCents: 14, billedUnits: 1 });
    expect(() => calculateAiImageTaskCost({ ...task, costReservation: { currency: 'CNY' } }, 1)).toThrow();
  });

  it('does not reinterpret a legacy runtime when an unversioned currency field is appended', () => {
    const task = { ...legacy, operationConfig: { ...createAiImageProviderRuntimeContract(config, shape), currency: 'CNY' } };
    expect(getFrozenAiImageTaskPrice(task).currency).toBe('USD');
    expect(() => getFrozenAiImageTaskPrice({ ...task, costReservation: { currency: 'CNY' } })).toThrow();
  });

  it('refuses a reservation denominated differently from its explicit frozen quote', () => {
    const task = { ...legacy, operationConfig: createAiImageProviderRuntimeContract({ ...config, currency: 'CNY' }, shape),
      costReservation: { currency: 'USD' } };
    expect(() => getFrozenAiImageTaskPrice(task)).toThrow();
  });

  it.each([0, null])('refuses a present malformed runtime instead of falling back to a legacy total: %j', providerRuntime => {
    expect(() => getFrozenAiImageTaskPrice({ ...legacy, operationConfig: { providerRuntime } })).toThrow();
  });

  it.each([-1, 0.5, 3, NaN])('rejects invalid successful image count %s', count => {
    expect(() => calculateAiImageTaskCost(legacy, count)).toThrow();
  });

  it('does not round an ambiguous legacy per-image price', () => {
    expect(() => getFrozenAiImageTaskPrice({ ...legacy, estimatedCostCents: 27 })).toThrow();
  });

  it('keeps a local fake generation free', () => {
    expect(calculateAiImageTaskCost({ ...legacy, provider: 'fake', estimatedCostCents: 0 }, 1))
      .toMatchObject({ currency: 'USD', unitCostCents: 0, actualCostCents: 0, billedUnits: 1 });
  });
});
