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

    await processAiImageQueueJob('job-1', 2, { repository: repository as any, resolveProvider, uploadBuffer: vi.fn(), run });

    expect(resolveProvider).toHaveBeenCalledWith('fake');
    expect(run).toHaveBeenCalledWith('job-1', 2, expect.objectContaining({ repository, provider }));
  });
});
