import { describe, expect, it, vi } from 'vitest';
import { getQueueOverview } from '../lib/queue-monitor.js';

describe('queue monitor', () => {
  it('reports disabled queue monitoring when Redis is disabled', async () => {
    const overview = await getQueueOverview({
      redisDisabled: true,
      createQueue: vi.fn(),
    });

    expect(overview.status).toBe('disabled');
    expect(overview.queues).toEqual([]);
  });

  it('collects BullMQ counts and recent failed jobs for configured queues', async () => {
    const close = vi.fn();
    const productQueue = {
      getJobCounts: vi.fn().mockResolvedValue({
        waiting: 2,
        active: 1,
        completed: 12,
        failed: 1,
        delayed: 3,
        paused: 0,
      }),
      getJobs: vi.fn().mockResolvedValue([
        {
          id: 'job-1',
          name: 'sync',
          failedReason: 'OZON timeout',
          timestamp: Date.parse('2026-06-08T01:00:00.000Z'),
          finishedOn: Date.parse('2026-06-08T01:01:00.000Z'),
        },
      ]),
      close,
    };
    const orderQueue = {
      getJobCounts: vi.fn().mockResolvedValue({
        waiting: 0,
        active: 0,
        completed: 8,
        failed: 0,
        delayed: 0,
        paused: 0,
      }),
      getJobs: vi.fn().mockResolvedValue([]),
      close,
    };

    const createQueue = vi.fn()
      .mockReturnValueOnce(productQueue)
      .mockReturnValueOnce(orderQueue);

    const overview = await getQueueOverview({
      redisDisabled: false,
      definitions: [
        { name: 'product-sync', label: '商品同步' },
        { name: 'order-sync', label: '订单同步' },
      ],
      createQueue,
    });

    expect(overview.status).toBe('ok');
    expect(overview.queues).toEqual([
      {
        name: 'product-sync',
        label: '商品同步',
        status: 'warning',
        counts: {
          waiting: 2,
          active: 1,
          completed: 12,
          failed: 1,
          delayed: 3,
          paused: 0,
        },
        recentFailed: [
          {
            id: 'job-1',
            name: 'sync',
            failedReason: 'OZON timeout',
            timestamp: '2026-06-08T01:00:00.000Z',
            finishedOn: '2026-06-08T01:01:00.000Z',
          },
        ],
      },
      {
        name: 'order-sync',
        label: '订单同步',
        status: 'idle',
        counts: {
          waiting: 0,
          active: 0,
          completed: 8,
          failed: 0,
          delayed: 0,
          paused: 0,
        },
        recentFailed: [],
      },
    ]);
    expect(productQueue.getJobCounts).toHaveBeenCalledWith('waiting', 'active', 'completed', 'failed', 'delayed', 'paused');
    expect(productQueue.getJobs).toHaveBeenCalledWith(['failed'], 0, 4, false);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('marks a queue as failing when BullMQ inspection throws', async () => {
    const queue = {
      getJobCounts: vi.fn().mockRejectedValue(new Error('connection refused')),
      getJobs: vi.fn(),
      close: vi.fn(),
    };

    const overview = await getQueueOverview({
      redisDisabled: false,
      definitions: [{ name: 'product-sync', label: '商品同步' }],
      createQueue: vi.fn().mockReturnValue(queue),
    });

    expect(overview.status).toBe('degraded');
    expect(overview.queues[0]).toMatchObject({
      name: 'product-sync',
      status: 'error',
      error: 'connection refused',
    });
    expect(queue.close).toHaveBeenCalledOnce();
  });
});
