import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  syncJobFindUnique: vi.fn(),
  syncJobUpdate: vi.fn(),
  registerWorker: vi.fn(),
}));

vi.mock('../lib/redis.js', () => ({ redisDisabled: true }));
vi.mock('../lib/bullmq-connection.js', () => ({ connection: {} }));
vi.mock('../lib/worker-registry.js', () => ({ registerWorker: mocks.registerWorker }));
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    syncJob: {
      findUnique: mocks.syncJobFindUnique,
      update: mocks.syncJobUpdate,
    },
  },
}));

function job(payload: Record<string, unknown>, status = 'RUNNING') {
  return {
    id: 'job-1',
    shopId: 'shop-1',
    status,
    payload: { source: 'browser-one-click-listing', ...payload },
    shop: { userId: 'user-1', platform: 'OZON', user: { id: 'user-1', role: 'USER' } },
  };
}

describe('browser one-click listing worker V2 boundary', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mocks.syncJobFindUnique.mockReset();
    mocks.syncJobUpdate.mockReset();
  });

  it('parks an authoritative review handoff without mutating the job', async () => {
    const handoff = {
      contractVersion: 'browser-one-click-v2-handoff/v1',
      state: 'REVIEW_REQUIRED',
      drafts: [{
        supplyGoodsId: 'goods-1',
        snapshotId: 'snapshot-1',
        draftId: 'draft-1',
        draftVersion: 1,
        revision: 1,
        skuKey: 'legacy-sku-1',
        sourceSku: 'sku-1',
      }],
      failures: [],
    };
    mocks.syncJobFindUnique.mockResolvedValue(job({
      browserOneClickPublishHandoff: handoff,
      browserPayloadReady: true,
      browserPayloadComplete: true,
      stage: 'review_required',
    }));
    const { runBrowserOneClickListingJob } = await import('../workers/browser-one-click-listing.js');

    await expect(runBrowserOneClickListingJob('job-1')).resolves.toMatchObject({
      skipped: true,
      reason: 'v2_review_required',
      handoff,
    });
    expect(mocks.syncJobUpdate).not.toHaveBeenCalled();
  });

  it('fails closed when an accidentally queued job has no authoritative handoff', async () => {
    let payload: Record<string, unknown> = {
      source: 'browser-one-click-listing',
      browserPayloadReady: true,
      rows: [{ sku: 'sku-1' }],
    };
    mocks.syncJobFindUnique.mockImplementation(async (args: any) => (
      args.include ? job(payload) : { payload }
    ));
    mocks.syncJobUpdate.mockImplementation(async ({ data }: any) => {
      payload = data.payload;
      return { id: 'job-1', status: data.status, payload };
    });
    const { runBrowserOneClickListingJob } = await import('../workers/browser-one-click-listing.js');

    await expect(runBrowserOneClickListingJob('job-1')).resolves.toEqual({
      skipped: true,
      status: 'FAILED',
      reason: 'v2_handoff_required',
      doNotRetry: true,
    });
    expect(mocks.syncJobUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'job-1' },
      data: expect.objectContaining({
        status: 'FAILED',
        finishedAt: expect.any(Date),
        payload: expect.objectContaining({
          stage: 'review_handoff_failed',
          publishOutcome: expect.objectContaining({
            state: 'FAILED',
            doNotRetry: true,
            reason: 'browser_one_click_v2_handoff_required',
          }),
        }),
      }),
    }));
  });

  it('fails closed when a queued job has only a forged handoff version', async () => {
    let payload: Record<string, unknown> = {
      source: 'browser-one-click-listing',
      stage: 'review_required',
      browserOneClickPublishHandoff: {
        contractVersion: 'browser-one-click-v2-handoff/v1',
        state: 'REVIEW_REQUIRED',
        drafts: [{ draftId: 'forged-draft' }],
        failures: [],
      },
    };
    mocks.syncJobFindUnique.mockImplementation(async (args: any) => (
      args.include ? job(payload) : { payload }
    ));
    mocks.syncJobUpdate.mockImplementation(async ({ data }: any) => {
      payload = data.payload;
      return { id: 'job-1', status: data.status, payload };
    });
    const { runBrowserOneClickListingJob } = await import('../workers/browser-one-click-listing.js');

    await expect(runBrowserOneClickListingJob('job-1')).resolves.toMatchObject({
      status: 'FAILED',
      reason: 'v2_handoff_required',
      doNotRetry: true,
    });
    expect(mocks.syncJobUpdate).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['SUCCESS', {}],
    ['FAILED', {}],
    ['RUNNING', { taskId: 987 }],
  ])('does not reprocess a terminal or externally identified job (%s)', async (status, payload) => {
    mocks.syncJobFindUnique.mockResolvedValue(job(payload, status));
    const { runBrowserOneClickListingJob } = await import('../workers/browser-one-click-listing.js');

    await expect(runBrowserOneClickListingJob('job-1')).resolves.toMatchObject({
      skipped: true,
      status,
    });
    expect(mocks.syncJobUpdate).not.toHaveBeenCalled();
  });

  it('ignores jobs from other workflows', async () => {
    mocks.syncJobFindUnique.mockResolvedValue({
      ...job({}),
      payload: { source: 'manual-listing' },
    });
    const { runBrowserOneClickListingJob } = await import('../workers/browser-one-click-listing.js');

    await expect(runBrowserOneClickListingJob('job-1')).resolves.toEqual({
      skipped: true,
      reason: 'not-browser-one-click',
    });
    expect(mocks.syncJobUpdate).not.toHaveBeenCalled();
  });

  it('contains no collection, credential, watermark, or network publisher path', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(new URL('../workers/browser-one-click-listing.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\/api\/collect\/publish-ozon/u);
    expect(source).not.toMatch(/createInternalAuthToken|signToken|storeSession/u);
    expect(source).not.toMatch(/supplyGoods\.(?:create|update)|resolveCollectedPrice/u);
    expect(source).not.toMatch(/processWatermark|fetch\s*\(/u);
    expect(source).not.toMatch(/appendBrowserOneClickListingRows/u);
  });
});
