import { describe, expect, it, vi } from 'vitest';
vi.mock('../lib/redis.js', () => ({ redisDisabled: true }));
import { processAiImageQueueJob } from '../workers/ai-image-generation.js';

describe('AI image BullMQ worker boundary', () => {
  it('resolves the persisted provider and forwards the BullMQ attempt number', async () => {
    const job = { id: 'job-1', provider: 'fake' };
    const repository = { getById: vi.fn(async () => job) };
    const provider = { name: 'fake', generate: vi.fn() };
    const resolveProvider = vi.fn(() => provider);
    const run = vi.fn(async () => undefined);

    const providerConfig = { provider: 'fake', baseUrl: '', apiKey: '', model: 'fake-image-v1', costPerImageCents: 0 };
    await processAiImageQueueJob('job-1', 2, { repository: repository as any, getProviderConfig: vi.fn(async () => providerConfig), resolveProvider, uploadBuffer: vi.fn(), run });

    expect(resolveProvider).toHaveBeenCalledWith('fake', providerConfig, undefined);
    expect(run).toHaveBeenCalledWith('job-1', 2, expect.objectContaining({ repository, provider }));
  });

  it('builds a real adapter from the current SystemConfig credentials', async () => {
    const repository = { getById: vi.fn(async () => ({ id: 'job-1', provider: 'dashscope-wanx' })) };
    const run = vi.fn(async () => undefined);
    await processAiImageQueueJob('job-1', 1, {
      repository: repository as any,
      getProviderConfig: vi.fn(async () => ({ provider: 'dashscope-wanx', baseUrl: 'https://dashscope.example/api/v1', apiKey: 'secret', model: 'wanx-v1', costPerImageCents: 5 })),
      uploadBuffer: vi.fn(), run,
    });
    expect((run as any).mock.calls[0]?.[2].provider.name).toBe('dashscope-wanx');
  });
  it('marks a paid provider failure final when the queue allows one attempt', async () => {
    const job = {
      id: 'job-paid', ownerUserId: 'owner-1', provider: 'openai-images', model: 'gpt-image-1',
      status: 'QUEUED', prompt: 'photo', negativePrompt: null, requestedImageCount: 1,
      width: 1024, height: 1024, maxAttempts: 3, estimatedCostCents: 0,
    };
    const repository = {
      getById: vi.fn(async () => job),
      markRunning: vi.fn(async () => true),
      markRetrying: vi.fn(async () => undefined),
      markFailed: vi.fn(async () => undefined),
    };
    await expect(processAiImageQueueJob('job-paid', 1, {
      repository: repository as any,
      getProviderConfig: vi.fn(async () => ({ provider: 'openai-images', baseUrl: 'https://api.openai.example/v1', apiKey: 'secret', model: 'gpt-image-1', costPerImageCents: 0 })),
      resolveProvider: vi.fn(() => ({ name: 'openai-images', generate: vi.fn(async () => { throw new Error('provider failed'); }) })),
      uploadBuffer: vi.fn(),
    })).rejects.toThrow('provider failed');

    expect(repository.markFailed).toHaveBeenCalledOnce();
    expect(repository.markRetrying).not.toHaveBeenCalled();
  });

});
