import { afterEach, describe, expect, it, vi } from 'vitest';
import { startListingTaskRefreshWorker } from '../workers/listing-task-refresh.js';

const mocks = vi.hoisted(() => ({
  syncJobFindMany: vi.fn(),
  registerTimer: vi.fn(),
  shouldAutoRefreshProductPushJob: vi.fn(() => true),
  getListingTaskRefreshSettings: vi.fn(),
  getListingTaskRefreshEnvDefaults: vi.fn(() => ({
    intervalMs: 30000,
    batchSize: 10,
    concurrency: 3,
    lookbackHours: 48,
    ozonApiTimeoutMs: 20000,
  })),
  refreshListingProductPushJob: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    syncJob: {
      findMany: mocks.syncJobFindMany,
    },
  },
}));

vi.mock('../lib/worker-registry.js', () => ({
  registerTimer: mocks.registerTimer,
}));

vi.mock('../services/listing-task-refresh.js', () => ({
  shouldAutoRefreshProductPushJob: mocks.shouldAutoRefreshProductPushJob,
  getListingTaskRefreshSettings: mocks.getListingTaskRefreshSettings,
  getListingTaskRefreshEnvDefaults: mocks.getListingTaskRefreshEnvDefaults,
}));

vi.mock('../routes/listing.js', () => ({
  refreshListingProductPushJob: mocks.refreshListingProductPushJob,
}));

async function waitForWorkerTick() {
  for (let i = 0; i < 10; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (mocks.syncJobFindMany.mock.calls.length) return;
  }
}

describe('listing task refresh worker', () => {
  afterEach(() => {
    const shutdown = mocks.registerTimer.mock.calls.at(-1)?.[0];
    if (typeof shutdown === 'function') shutdown();
    vi.clearAllMocks();
  });

  it('uses admin-configured refresh settings for each automatic tick', async () => {
    mocks.getListingTaskRefreshSettings.mockResolvedValue({
      intervalMs: 45000,
      batchSize: 2,
      concurrency: 2,
      lookbackHours: 72,
      ozonApiTimeoutMs: 26000,
    });
    mocks.syncJobFindMany.mockResolvedValue([
      { id: 'job-1', type: 'PRODUCT_PUSH', status: 'RUNNING', payload: { taskId: 1 } },
      { id: 'job-2', type: 'PRODUCT_PUSH', status: 'RUNNING', payload: { taskId: 2 } },
      { id: 'job-3', type: 'PRODUCT_PUSH', status: 'RUNNING', payload: { taskId: 3 } },
    ]);
    mocks.refreshListingProductPushJob.mockResolvedValue({ code: 1, data: { status: 'RUNNING' } });

    startListingTaskRefreshWorker();
    await waitForWorkerTick();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.getListingTaskRefreshSettings).toHaveBeenCalled();
    expect(mocks.syncJobFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        type: 'PRODUCT_PUSH',
        createdAt: { gte: expect.any(Date) },
      }),
    }));
    expect(mocks.refreshListingProductPushJob).toHaveBeenCalledTimes(2);
    expect(mocks.refreshListingProductPushJob).toHaveBeenCalledWith('job-1', undefined, { ozonApiTimeoutMs: 26000 });
    expect(mocks.refreshListingProductPushJob).toHaveBeenCalledWith('job-2', undefined, { ozonApiTimeoutMs: 26000 });
  });
});