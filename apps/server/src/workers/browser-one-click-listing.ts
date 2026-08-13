import { Queue, Worker } from 'bullmq';
import { redisDisabled } from '../lib/redis.js';
import { connection } from '../lib/bullmq-connection.js';
import { registerWorker } from '../lib/worker-registry.js';
import { prisma } from '../lib/prisma.js';
import { parseBrowserOneClickReviewHandoff } from '../services/browser-one-click-review-handoff.js';

export interface AddBrowserOneClickListingJobOptions {
  attempts?: 1 | 2 | 3;
}

const QUEUE_NAME = 'browser-one-click-listing';
export const browserOneClickListingQueue: Queue | null = redisDisabled ? null : new Queue(QUEUE_NAME, { connection });

function objectRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

async function mergeBrowserOneClickJobPayload(jobId: string, patch: Record<string, any>, status?: 'RUNNING' | 'SUCCESS' | 'FAILED', errorMessage?: string | null) {
  const current = await prisma.syncJob.findUnique({
    where: { id: jobId },
    select: { payload: true },
  });
  const payload = {
    ...objectRecord(current?.payload),
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await prisma.syncJob.update({
    where: { id: jobId },
    data: {
      ...(status ? { status } : {}),
      payload,
      ...(errorMessage !== undefined ? { errorMessage } : {}),
      ...(status === 'SUCCESS' || status === 'FAILED' ? { finishedAt: new Date() } : {}),
    },
  });
  return payload;
}

export async function runBrowserOneClickListingJob(syncJobId: string) {
  const job = await prisma.syncJob.findUnique({
    where: { id: syncJobId },
    include: { shop: { include: { user: { select: { id: true, role: true } } } } },
  });
  if (!job) throw new Error(`Browser one-click listing job ${syncJobId} not found`);
  const payload = objectRecord(job.payload);
  if (payload.source !== 'browser-one-click-listing' && payload.browserOneClickJob !== true) {
    return { skipped: true, reason: 'not-browser-one-click' };
  }
  if (job.status === 'SUCCESS' || job.status === 'FAILED' || payload.taskId) {
    return { skipped: true, status: job.status, taskId: payload.taskId };
  }

  const handoff = parseBrowserOneClickReviewHandoff(payload.browserOneClickPublishHandoff);
  if (handoff) {
    return {
      skipped: true,
      status: job.status,
      reason: 'v2_review_required',
      handoff,
    };
  }
  await mergeBrowserOneClickJobPayload(job.id, {
    stage: 'review_handoff_failed',
    publishOutcome: {
      state: 'FAILED',
      doNotRetry: true,
      reason: 'browser_one_click_v2_handoff_required',
      observedAt: new Date().toISOString(),
    },
  }, 'FAILED', '浏览器一键上架缺少完整 ERP 审核草稿交接，任务已停止且不会发布');
  return {
    skipped: true,
    status: 'FAILED',
    reason: 'v2_handoff_required',
    doNotRetry: true,
  };
}

export async function addBrowserOneClickListingJob(
  syncJobId: string,
  options: AddBrowserOneClickListingJobOptions = {},
) {
  const id = String(syncJobId || '').trim();
  if (!id) throw new Error('缺少一键上架任务 ID');
  if (redisDisabled) {
    setTimeout(() => {
      runBrowserOneClickListingJob(id).catch((error) => {
        console.error(`[browser-one-click-listing inline] ${id} failed:`, error?.message || error);
      });
    }, 0).unref();
    return { id: `inline-${Date.now()}`, syncJobId: id };
  }
  const job = await browserOneClickListingQueue!.add('publish', { syncJobId: id }, {
    jobId: id,
    attempts: options.attempts || 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 50,
    removeOnFail: 20,
  });
  return { id: job.id, syncJobId: id };
}

export function startBrowserOneClickListingWorker() {
  if (redisDisabled) {
    console.log('[browser-one-click-listing] REDIS_DISABLED=1, worker queue disabled; jobs run inline from API');
    return null;
  }
  const worker = new Worker(QUEUE_NAME, async (job) => {
    return await runBrowserOneClickListingJob(String(job.data?.syncJobId || ''));
  }, {
    connection,
    concurrency: Math.max(1, Number(process.env.BROWSER_ONE_CLICK_LISTING_CONCURRENCY) || 2),
  });
  worker.on('failed', (job, error) => {
    console.error(`[browser-one-click-listing] job ${job?.id || 'unknown'} failed:`, error?.message || error);
  });
  registerWorker(worker);
  console.log('[browser-one-click-listing] worker started');
  return worker;
}
