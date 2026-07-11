import { Queue, Worker } from 'bullmq';
import { connection } from '../lib/bullmq-connection.js';
import { prisma } from '../lib/prisma.js';
import { redisDisabled } from '../lib/redis.js';
import { registerWorker } from '../lib/worker-registry.js';
import { PrismaAiImageJobRepository } from '../repositories/ai-image-job-repository.js';
import { getStorageBackend } from '../services/image-storage.js';
import { createDisabledAiImageProvider, createFakeAiImageProvider, runAiImageJob, type AiImageJobProvider, type AiImageJobRepository } from '../services/ai-image-jobs.js';

const QUEUE_NAME = 'ai-image-generation';
const fakePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2S8AAAAASUVORK5CYII=', 'base64');

export const aiImageGenerationQueue: Queue | null = redisDisabled ? null : new Queue(QUEUE_NAME, { connection });

export function resolveAiImageProvider(provider: string) {
  if (provider === 'fake') {
    return createFakeAiImageProvider({ images: [{ buffer: fakePng, mimeType: 'image/png' }], actualCostCents: 0 });
  }
  return createDisabledAiImageProvider();
}

export async function processAiImageQueueJob(
  jobId: string,
  attemptNumber: number,
  overrides: {
    repository?: AiImageJobRepository;
    resolveProvider?: typeof resolveAiImageProvider;
    uploadBuffer?: (...args: any[]) => Promise<any>;
    run?: typeof runAiImageJob;
  } = {},
) {
  const repository = overrides.repository || new PrismaAiImageJobRepository(prisma);
  const persisted = await repository.getById(jobId);
  if (!persisted) return;
  const provider = (overrides.resolveProvider || resolveAiImageProvider)(persisted.provider);
  const storage = overrides.uploadBuffer ? null : await getStorageBackend();
  const uploadBuffer = overrides.uploadBuffer || storage!.uploadBuffer.bind(storage);
  await (overrides.run || runAiImageJob)(jobId, attemptNumber, { repository, provider, uploadBuffer });
}

export async function enqueueAiImageJob(jobId: string) {
  if (!aiImageGenerationQueue) {
    await processAiImageQueueJob(jobId, 1);
    return;
  }
  await aiImageGenerationQueue.add('generate', { jobId }, {
    jobId,
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  });
}

export function startAiImageGenerationWorker() {
  if (redisDisabled) return null;
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      await processAiImageQueueJob(String(job.data.jobId), job.attemptsMade + 1);
    },
    { connection, concurrency: 2 },
  );
  worker.on('failed', (job, error) => {
    console.error(`[ai-image] job ${job?.id || 'unknown'} failed:`, error.message);
  });
  registerWorker(worker);
  return worker;
}
