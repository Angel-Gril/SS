import { describe, expect, it } from 'vitest';
import { enqueueProductSyncAfterPublish } from '../services/post-publish-sync.js';

describe('post publish product sync', () => {
  it('queues an immediate sync and one delayed follow-up after publish succeeds', async () => {
    const calls: Array<{ shopId: string; delayMs?: number; jobId?: string }> = [];
    const result = await enqueueProductSyncAfterPublish('shop-1', 'collect-publish', async (shopId, options) => {
      calls.push({ shopId, ...options });
      return { id: options?.delayMs ? 'job-follow-up' : 'job-now' };
    });

    expect(result).toEqual({ queued: true, jobId: 'job-now', followUpJobId: 'job-follow-up' });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({ shopId: 'shop-1' });
    expect(calls[1]?.shopId).toBe('shop-1');
    expect(calls[1]?.delayMs).toBe(5 * 60 * 1000);
    expect(calls[1]?.jobId).toContain('post-publish-follow-up:shop-1:');
  });

  it('does not throw when product sync queueing fails', async () => {
    const result = await enqueueProductSyncAfterPublish('shop-1', 'collect-publish', async () => {
      throw new Error('redis down');
    });

    expect(result).toEqual({ queued: false, error: 'redis down' });
  });
});
