import { describe, expect, it } from 'vitest';
import { createExtensionByokPolicyEvaluator } from '../services/extension-byok-policy.js';

const policy = {
  contractVersion: 'extension-byok-policy/v1', revision: 4, mode: 'pilot',
  generationEnabled: true, ingestEnabled: true, publishEnabled: false,
  ownerUserIds: ['owner'], shopIds: ['shop'], deviceSessionIds: ['device'],
  allowedOrigins: ['https://models.example.com'], allowedOperations: ['IMAGE_TO_IMAGE'], maxConcurrency: 1,
};
const context = { ownerUserId: 'owner', shopId: 'shop', deviceSessionId: 'device',
  providerOrigin: 'https://models.example.com', model: 'vision-model' };

describe('BYOK product analysis requires its own explicit permission', () => {
  it('keeps existing image-only policies closed for product analysis', async () => {
    const evaluator = createExtensionByokPolicyEvaluator({ loadPolicy: async () => policy });
    const result = await evaluator.evaluateProductAnalysis(context);
    expect(result.analysis).toEqual({ enabled: false, ready: false, reasonCode: 'ANALYSIS_DISABLED' });
  });
  it('opens only the explicit analysis model while preserving the existing image contract', async () => {
    const evaluator = createExtensionByokPolicyEvaluator({ loadPolicy: async () => ({ ...policy,
      analysisEnabled: true, allowedAnalysisModels: ['vision-model'] }) });
    expect((await evaluator.evaluateProductAnalysis(context)).analysis.ready).toBe(true);
    expect((await evaluator.evaluateProductAnalysis({ ...context, model: 'image-model' })).analysis)
      .toMatchObject({ ready: false, reasonCode: 'MODEL_NOT_ALLOWED' });
    expect((await evaluator.evaluate({ ...context, operation: 'IMAGE_TO_IMAGE' })).capabilities.generation.ready).toBe(true);
  });
  it.each([
    ['ownerUserId', 'other', 'OWNER_NOT_ALLOWED'], ['shopId', 'other', 'SHOP_NOT_ALLOWED'],
    ['deviceSessionId', 'other', 'DEVICE_NOT_ALLOWED'],
    ['providerOrigin', 'https://other.example.com', 'ORIGIN_NOT_ALLOWED'],
  ])('enforces the existing %s scope for analysis', async (field, value, reasonCode) => {
    const evaluator = createExtensionByokPolicyEvaluator({ loadPolicy: async () => ({ ...policy,
      analysisEnabled: true, allowedAnalysisModels: ['vision-model'] }) });
    expect((await evaluator.evaluateProductAnalysis({ ...context, [field]: value })).analysis)
      .toMatchObject({ ready: false, reasonCode });
  });
  it.each([{}, { analysisEnabled: true }, { allowedAnalysisModels: ['vision-model'] },
    { analysisEnabled: true, allowedAnalysisModels: ['vision-model', 'vision-model'] },
    { analysisEnabled: true, allowedAnalysisModels: ['vision-model'], unexpected: 'value' }])(
    'rejects malformed opt-in configuration instead of inheriting an image permission', async (addition) => {
      const invalid = Object.keys(addition).length ? { ...policy, ...addition } : { ...policy, analysisEnabled: 'true' };
      const evaluator = createExtensionByokPolicyEvaluator({ loadPolicy: async () => invalid });
      expect((await evaluator.evaluateProductAnalysis(context)).analysis.ready).toBe(false);
    });
});
