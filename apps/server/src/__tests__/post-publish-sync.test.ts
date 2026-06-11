import { describe, expect, it } from 'vitest';
import { enqueueProductSyncAfterPublish } from '../services/post-publish-sync.js';

describe('post publish product sync', () => {
  it('queues a product sync job after publish succeeds', async () => {
    const result = await enqueueProductSyncAfterPublish('shop-1', 'collect-publish', async () => ({ id: 'job-1' }));

    expect(result).toEqual({ queued: true, jobId: 'job-1' });
  });

  it('does not throw when product sync queueing fails', async () => {
    const result = await enqueueProductSyncAfterPublish('shop-1', 'collect-publish', async () => {
      throw new Error('redis down');
    });

    expect(result).toEqual({ queued: false, error: 'redis down' });
  });
});
