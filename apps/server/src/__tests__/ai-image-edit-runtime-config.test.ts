import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { getAiImageEditProviderRuntimeConfig } from '../workers/ai-image-edit.js';
import { getStrictConfigSnapshot, setConfig } from '../config/system-config-schema.js';
import { aiImageRoutes } from '../routes/ai-images.js';

const db = vi.hoisted(() => ({ findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn() }));
vi.mock('../lib/prisma.js', () => ({ prisma: { systemConfig: db } }));
vi.mock('../lib/redis.js', () => ({ redisDisabled: true, redis: {} }));

const changedAt = new Date('2026-09-09T10:00:00.000Z');
const values = {
  ai_image_provider: 'dashscope-wanx',
  ai_image_model: 'wanx2.1-imageedit',
  ai_image_base_url: 'https://dashscope.aliyuncs.com/api/v1',
  ai_image_api_key: 'synthetic-config-sentinel',
  ai_image_generation_cost_cents: '7',
};
const rows = Object.entries(values).map(([key, value]) => ({
  key, value, id: `record-${key}`, revision: 3, updatedAt: changedAt,
}));

describe('hosted edit credential snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const current = rows.map((row) => ({ ...row }));
    db.findUnique.mockImplementation(async ({ where }) => current.find((row) => row.key === where.key));
    db.findMany.mockImplementation(async () => current);
    db.upsert.mockImplementation(async ({ where, update }) => {
      const record = current.find((row) => row.key === where.key)!;
      record.value = update.value;
      record.revision += update.revision?.increment || 0;
      return record;
    });
  });

  it('reads identity, secret and revision from one statement and freezes only non-secret metadata', async () => {
    const config = await getAiImageEditProviderRuntimeConfig();
    expect(config).toEqual({
      provider: values.ai_image_provider,
      model: values.ai_image_model,
      baseUrl: values.ai_image_base_url,
      apiKey: values.ai_image_api_key,
      costPerImageCents: 7,
      currency: 'CNY',
      credentialRevision: {
        recordId: 'record-ai_image_api_key', revision: 3, updatedAt: changedAt.toISOString(),
      },
    });
    expect(db.findMany).toHaveBeenCalledOnce();
    expect(db.findUnique).not.toHaveBeenCalled();
    expect(JSON.stringify(config.credentialRevision)).not.toContain(values.ai_image_api_key);
  });

  it('exposes requested revision metadata without changing the existing values-only snapshot contract', async () => {
    const snapshot = await getStrictConfigSnapshot(['ai_image_api_key'] as const, { includeRevisions: true });
    expect(snapshot).toEqual({
      values: { ai_image_api_key: values.ai_image_api_key },
      revisions: { ai_image_api_key: { id: 'record-ai_image_api_key', revision: 3, updatedAt: changedAt } },
    });
    expect(await getStrictConfigSnapshot(['ai_image_api_key'] as const))
      .toEqual({ ai_image_api_key: values.ai_image_api_key });
  });

  it('refuses corrupt encrypted credentials instead of returning an encrypted string as a usable key', async () => {
    const corrupt = rows.map((row) => row.key === 'ai_image_api_key'
      ? { ...row, value: 'enc:v1:synthetic-corrupt' } : row);
    db.findMany.mockResolvedValue(corrupt);
    db.findUnique.mockImplementation(async ({ where }) => corrupt.find((row) => row.key === where.key));
    await expect(getAiImageEditProviderRuntimeConfig()).rejects.toThrow();
  });

  it.each(['id', 'revision', 'updatedAt'] as const)('refuses an unbindable Wanx credential %s', async (field) => {
    db.findMany.mockResolvedValue(rows.map((row) => row.key === 'ai_image_api_key'
      ? { ...row, [field]: null } : row));
    await expect(getAiImageEditProviderRuntimeConfig()).rejects.toMatchObject({
      code: 'PROVIDER_RUNTIME_CONTRACT_MISMATCH',
    });
  });

  it('advances the image credential revision through the typed writer even when the timestamp is unchanged', async () => {
    const before = await getAiImageEditProviderRuntimeConfig();
    await setConfig('ai_image_api_key', 'synthetic-rotated-credential');
    const after = await getAiImageEditProviderRuntimeConfig();
    expect(after.apiKey).toBe('synthetic-rotated-credential');
    expect(after.credentialRevision).toEqual({ ...before.credentialRevision, revision: 4 });
  });

  it.each(['', '   '])('rejects an empty credential before returning an admissible Wanx configuration: %j', async (value) => {
    db.findMany.mockResolvedValue(rows.map((row) => row.key === 'ai_image_api_key' ? { ...row, value } : row));
    await expect(getAiImageEditProviderRuntimeConfig()).rejects.toMatchObject({ code: 'PROVIDER_RUNTIME_CONTRACT_MISMATCH' });
  });

  it.each(['missing-revision', 'corrupt-key', 'empty-key', 'whitespace-key'] as const)('reports %s through the default HTTP loader as unavailable, without leaking configuration', async (failure) => {
    db.findMany.mockResolvedValue(rows.map((row) => row.key === 'ai_image_api_key'
      ? failure === 'missing-revision' ? { ...row, revision: null }
        : { ...row, value: failure === 'empty-key' ? '' : failure === 'whitespace-key' ? '   ' : 'enc:v1:synthetic-corrupt' }
      : row));
    const app = Fastify();
    const create = vi.fn();
    const retry = vi.fn();
    const enqueue = vi.fn();
    await app.register(aiImageRoutes, {
      repository: {} as never, mediaWorkflowService: { createImageEdit: create, retry,
        get: async () => ({ id: 'fixture-workflow', operation: 'FULL_EDIT', status: 'FAILED', jobs: [] }),
      } as never, enqueueEdit: enqueue,
      authenticate: async (request: FastifyRequest) => { (request as any).user = { userId: 'fixture-owner' }; },
      getMediaWorkflowEnabled: async () => true, getSourceListingWebMediaEnabled: async () => true,
      getTranslationSettings: async () => ({ enabled: false, provider: 'disabled', model: '', dailyLimit: 0,
        estimatedCostCents: 0, globalDailyBudgetCents: 0, categoryGlossaryJson: '{"version":1,"profiles":[]}' }),
      getEditStorageReadiness: async () => ({ ready: true, backend: 'local', reason: 'fixture' }),
      getTranslationStorageReadiness: async () => ({ ready: false, reason: 'disabled fixture' }),
    });
    try {
      for (const response of [
        await app.inject({ method: 'GET', url: '/capabilities' }),
        await app.inject({ method: 'POST', url: '/workflows', payload: { operation: 'FULL_EDIT', sourceAssetId: 'source',
          userPrompt: 'Edit background', idempotencyKey: 'synthetic-config-http', context: { type: 'collect', id: 'goods' } } }),
        await app.inject({ method: 'POST', url: '/workflows', payload: { operation: 'INPAINT', sourceAssetId: 'source',
          maskAssetId: 'mask', maskSemantics: 'WHITE_EDIT_BLACK_PRESERVE_V1', userPrompt: 'Edit selection',
          idempotencyKey: 'synthetic-config-mask', context: { type: 'collect', id: 'goods' } } }),
        await app.inject({ method: 'POST', url: '/workflows/fixture-workflow/retry', payload: {
          expectedRevision: 2, idempotencyKey: 'synthetic-config-retry',
        } }),
      ]) {
        expect(response.statusCode, response.body).toBe(503);
        expect(response.json().code).toBe('PROVIDER_NOT_READY');
        expect(response.body).not.toContain(values.ai_image_api_key);
        expect(response.body).not.toContain('enc:v1');
        expect(response.body).not.toContain('record-ai_image_api_key');
      }
      expect(create).not.toHaveBeenCalled();
      expect(retry).not.toHaveBeenCalled();
      expect(enqueue).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});
