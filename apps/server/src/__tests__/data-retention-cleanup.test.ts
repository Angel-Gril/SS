import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dryRun: false,
  getConfig: vi.fn(async (key: string) => key === 'retention_cleanup_dry_run' ? mocks.dryRun : 30),
  registerTimer: vi.fn(),
  parityCount: vi.fn(),
  parityFindMany: vi.fn(),
  parityDeleteMany: vi.fn(),
}));

vi.mock('../config/system-config-schema.js', () => ({ getConfig: mocks.getConfig }));
vi.mock('../lib/worker-registry.js', () => ({ registerTimer: mocks.registerTimer }));
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readdirSync: vi.fn(() => []),
  statSync: vi.fn(),
  unlinkSync: vi.fn(),
}));
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    session: { count: vi.fn(async () => 0), deleteMany: vi.fn() },
    notification: { count: vi.fn(async () => 0), deleteMany: vi.fn() },
    syncJob: { count: vi.fn(async () => 0), deleteMany: vi.fn() },
    ozonPublisherParityObservation: {
      count: mocks.parityCount,
      findMany: mocks.parityFindMany,
      deleteMany: mocks.parityDeleteMany,
    },
  },
}));

import {
  cleanupOnce,
  DATA_RETENTION_INITIAL_DELAY_MS,
  DATA_RETENTION_PARITY_BATCH_SIZE,
  DATA_RETENTION_PARITY_MAX_BATCHES,
  DATA_RETENTION_PARITY_RETRY_MS,
  startDataRetentionWorker,
  stopDataRetentionWorker,
} from '../workers/data-retention-cleanup.js';

describe('data retention cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dryRun = false;
    mocks.parityCount.mockResolvedValue(0);
    mocks.parityFindMany.mockResolvedValue([{ id: 'observation-1' }, { id: 'observation-2' }]);
    mocks.parityDeleteMany.mockResolvedValue({ count: 2 });
  });

  it('drains expired parity observations while repository-style hasMore remains false', async () => {
    const fullBatch = Array.from(
      { length: DATA_RETENTION_PARITY_BATCH_SIZE + 1 },
      (_, index) => ({ id: `observation-${index}` }),
    );
    mocks.parityFindMany
      .mockResolvedValueOnce(fullBatch)
      .mockResolvedValueOnce([{ id: 'observation-final' }]);
    mocks.parityDeleteMany
      .mockResolvedValueOnce({ count: DATA_RETENTION_PARITY_BATCH_SIZE })
      .mockResolvedValueOnce({ count: 1 });

    const result = await cleanupOnce();

    expect(mocks.parityFindMany).toHaveBeenNthCalledWith(1, {
      where: { expiresAt: { lt: expect.any(Date) } },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
      take: DATA_RETENTION_PARITY_BATCH_SIZE + 1,
    });
    expect(mocks.parityDeleteMany).toHaveBeenCalledTimes(2);
    expect(mocks.parityDeleteMany.mock.calls[0]?.[0].where.id.in).toHaveLength(
      DATA_RETENTION_PARITY_BATCH_SIZE,
    );
    expect(mocks.parityDeleteMany).toHaveBeenLastCalledWith({
      where: { id: { in: ['observation-final'] } },
    });
    expect(result).toEqual({ parityObservationBacklog: false });
  });

  it('stops at the batch cap and reports a continued parity backlog', async () => {
    const rows = Array.from(
      { length: DATA_RETENTION_PARITY_BATCH_SIZE + 1 },
      (_, index) => ({ id: `observation-${index}` }),
    );
    mocks.parityFindMany.mockResolvedValue(rows);
    mocks.parityDeleteMany.mockResolvedValue({ count: DATA_RETENTION_PARITY_BATCH_SIZE });

    const result = await cleanupOnce();

    expect(mocks.parityFindMany).toHaveBeenCalledTimes(DATA_RETENTION_PARITY_MAX_BATCHES);
    expect(mocks.parityDeleteMany).toHaveBeenCalledTimes(DATA_RETENTION_PARITY_MAX_BATCHES);
    expect(result).toEqual({ parityObservationBacklog: true });
  });

  it('counts but never enumerates or deletes expired observations during dry-run', async () => {
    mocks.dryRun = true;
    mocks.parityCount.mockResolvedValue(12_345);

    const result = await cleanupOnce();

    expect(mocks.parityCount).toHaveBeenCalledWith({
      where: { expiresAt: { lt: expect.any(Date) } },
    });
    expect(mocks.parityFindMany).not.toHaveBeenCalled();
    expect(mocks.parityDeleteMany).not.toHaveBeenCalled();
    expect(result).toEqual({ parityObservationBacklog: false });
  });

  it('promptly reschedules bounded cleanup while parity backlog remains', async () => {
    vi.useFakeTimers();
    const rows = Array.from(
      { length: DATA_RETENTION_PARITY_BATCH_SIZE + 1 },
      (_, index) => ({ id: `observation-${index}` }),
    );
    mocks.parityFindMany.mockResolvedValue(rows);
    mocks.parityDeleteMany.mockResolvedValue({ count: DATA_RETENTION_PARITY_BATCH_SIZE });

    try {
      startDataRetentionWorker();
      expect(mocks.parityFindMany).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(DATA_RETENTION_INITIAL_DELAY_MS);
      expect(mocks.parityFindMany).toHaveBeenCalledTimes(DATA_RETENTION_PARITY_MAX_BATCHES);

      await vi.advanceTimersByTimeAsync(DATA_RETENTION_PARITY_RETRY_MS - 1);
      expect(mocks.parityFindMany).toHaveBeenCalledTimes(DATA_RETENTION_PARITY_MAX_BATCHES);

      await vi.advanceTimersByTimeAsync(1);
      expect(mocks.parityFindMany).toHaveBeenCalledTimes(DATA_RETENTION_PARITY_MAX_BATCHES * 2);
    } finally {
      stopDataRetentionWorker();
      vi.useRealTimers();
    }
  });

  it('retries after a cleanup exception instead of waiting for the daily interval', async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.parityFindMany
      .mockRejectedValueOnce(new Error('temporary parity cleanup failure'))
      .mockResolvedValue([]);

    try {
      startDataRetentionWorker();

      await vi.advanceTimersByTimeAsync(DATA_RETENTION_INITIAL_DELAY_MS);
      expect(mocks.parityFindMany).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledWith(
        '[DataRetention] tick failed:',
        expect.objectContaining({ message: 'temporary parity cleanup failure' }),
      );

      await vi.advanceTimersByTimeAsync(DATA_RETENTION_PARITY_RETRY_MS - 1);
      expect(mocks.parityFindMany).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(mocks.parityFindMany).toHaveBeenCalledTimes(2);
    } finally {
      stopDataRetentionWorker();
      error.mockRestore();
      vi.useRealTimers();
    }
  });

  it('does not let an in-flight tick schedule into a restarted worker generation', async () => {
    vi.useFakeTimers();
    let resolveFirst!: (rows: Array<{ id: string }>) => void;
    const firstCleanup = new Promise<Array<{ id: string }>>((resolve) => {
      resolveFirst = resolve;
    });
    mocks.parityFindMany
      .mockImplementationOnce(() => firstCleanup)
      .mockResolvedValue([]);

    try {
      startDataRetentionWorker();
      vi.advanceTimersByTime(DATA_RETENTION_INITIAL_DELAY_MS);
      for (let turn = 0; turn < 20 && mocks.parityFindMany.mock.calls.length === 0; turn += 1) {
        await Promise.resolve();
      }
      expect(mocks.parityFindMany).toHaveBeenCalledTimes(1);

      stopDataRetentionWorker();
      startDataRetentionWorker();
      expect(vi.getTimerCount()).toBe(1);

      resolveFirst([]);
      for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();

      expect(vi.getTimerCount()).toBe(1);
    } finally {
      stopDataRetentionWorker();
      resolveFirst([]);
      vi.useRealTimers();
    }
  });
});
