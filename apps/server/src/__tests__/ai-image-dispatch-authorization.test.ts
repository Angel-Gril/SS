import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  rollout: { enabled: true, revision: 1, reason: 'tenant_allowed' },
}));
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    systemConfig: {
      findMany: vi.fn(async () => [...state.values].map(([key, value]) => ({
        key, value: String(value), id: `synthetic-${key}`, revision: 1,
        updatedAt: new Date('2026-09-16T00:00:00.000Z'),
      }))),
    },
  },
}));
vi.mock('../lib/redis.js', () => ({ redisDisabled: true }));
vi.mock('../config/system-config-schema.js', async (importOriginal) => ({
  ...await importOriginal<object>(),
  getConfig: vi.fn(async (key: string) => state.values.get(key)),
}));
vi.mock('../services/ai-media-rollout.js', () => ({
  getAiMediaRolloutDecision: vi.fn(async () => state.rollout),
}));

import { getAiImageDispatchAuthorization, getAiImageProviderRuntimeConfig, processAiImageQueueJob } from '../workers/ai-image-generation.js';

describe('Normal image generation configuration authorization', () => {
  beforeEach(() => {
    state.values = new Map([
      ['ai_image_generation_enabled', true], ['feature_ai_media_image_to_image', true],
    ]);
    state.rollout = { enabled: true, revision: 1, reason: 'tenant_allowed' };
  });

  it('rechecks the reference-generation operation switch for an already queued request', async () => {
    state.values.set('feature_ai_media_image_to_image', false);
    await expect(getAiImageDispatchAuthorization('owner-1', 'IMAGE_TO_IMAGE'))
      .resolves.toMatchObject({ enabled: false, reasonCode: 'feature_off' });
    await expect(getAiImageDispatchAuthorization('owner-1', 'TEXT_TO_IMAGE'))
      .resolves.toMatchObject({ enabled: true });
  });

  it.each(['master', 'tenant'] as const)('keeps %s revocation effective for normal image requests', async (scope) => {
    if (scope === 'master') state.values.set('ai_image_generation_enabled', false);
    else state.rollout = { enabled: false, revision: 2, reason: 'tenant_not_allowed' };
    await expect(getAiImageDispatchAuthorization('owner-1', 'IMAGE_TO_IMAGE'))
      .resolves.toMatchObject({ enabled: false });
  });

  it('passes the persisted reference operation to authorization before loading credentials', async () => {
    state.values.set('feature_ai_media_image_to_image', false);
    const repository = {
      getById: vi.fn(async () => ({
        id: 'queued-reference', ownerUserId: 'owner-1', status: 'QUEUED',
        provider: 'openai-images', operation: 'IMAGE_TO_IMAGE',
      })),
      markEnqueueFailed: vi.fn(async () => true),
    };
    const getProviderConfig = vi.fn();
    await processAiImageQueueJob('queued-reference', 1, { repository: repository as never, getProviderConfig });
    expect(repository.markEnqueueFailed).toHaveBeenCalledWith('queued-reference', expect.objectContaining({
      errorCode: 'AI_IMAGE_DISPATCH_REVOKED',
    }));
    expect(getProviderConfig).not.toHaveBeenCalled();
  });

  it('uses explicit CNY for a newly configured official Wanx text model', async () => {
    state.values.set('ai_image_provider', 'dashscope-wanx');
    state.values.set('ai_image_model', 'wanx2.1-t2i-turbo');
    state.values.set('ai_image_base_url', 'https://dashscope.aliyuncs.com/api/v1');
    state.values.set('ai_image_api_key', 'synthetic-key');
    state.values.set('ai_image_generation_cost_cents', 14);
    await expect(getAiImageProviderRuntimeConfig()).resolves.toMatchObject({ currency: 'CNY', costPerImageCents: 14 });
    state.values.set('ai_image_provider', 'custom');
    expect(await getAiImageProviderRuntimeConfig()).not.toHaveProperty('currency');
  });
});
