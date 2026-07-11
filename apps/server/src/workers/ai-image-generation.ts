import { Queue, Worker } from 'bullmq';
import { getConfig } from '../config/system-config-schema.js';
import { connection } from '../lib/bullmq-connection.js';
import { prisma } from '../lib/prisma.js';
import { redisDisabled } from '../lib/redis.js';
import { registerWorker } from '../lib/worker-registry.js';
import { PrismaAiImageJobRepository } from '../repositories/ai-image-job-repository.js';
import { getStorageBackend } from '../services/image-storage.js';
import { createDashScopeWanxProvider, createOpenAiImagesProvider } from '../services/ai-image-providers.js';
import { createDisabledAiImageProvider, createFakeAiImageProvider, runAiImageJob, type AiImageJobProvider, type AiImageJobRepository } from '../services/ai-image-jobs.js';

const QUEUE_NAME = 'ai-image-generation';
const fakePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2S8AAAAASUVORK5CYII=', 'base64');

export const aiImageGenerationQueue: Queue | null = redisDisabled ? null : new Queue(QUEUE_NAME, { connection });

export interface AiImageProviderRuntimeConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  costPerImageCents: number;
}

export async function getAiImageProviderRuntimeConfig(): Promise<AiImageProviderRuntimeConfig> {
  const [provider, baseUrl, apiKey, model] = await Promise.all([
    getConfig('ai_image_provider'), getConfig('ai_image_base_url'),
    getConfig('ai_image_api_key'), getConfig('ai_image_model'),
  ]);
  return { provider, baseUrl, apiKey, model, costPerImageCents: 0 };
}

export function resolveAiImageProvider(
  provider: string,
  config: AiImageProviderRuntimeConfig,
  onProviderJobCreated?: (providerJobId: string) => Promise<void>,
) {
  if (provider === 'fake') {
    return createFakeAiImageProvider({ images: [{ buffer: fakePng, mimeType: 'image/png' }], actualCostCents: 0 });
  }
  if (provider !== config.provider || !config.apiKey || !config.model) return createDisabledAiImageProvider();
  const options = { baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model, costPerImageCents: config.costPerImageCents, onProviderJobCreated };
  if (provider === 'dashscope-wanx') return createDashScopeWanxProvider(options);
  if (provider === 'openai-images') return createOpenAiImagesProvider(options);
  return createDisabledAiImageProvider();
}

export async function processAiImageQueueJob(
  jobId: string,
  attemptNumber: number,
  overrides: {
    repository?: AiImageJobRepository;
    resolveProvider?: typeof resolveAiImageProvider;
    getProviderConfig?: typeof getAiImageProviderRuntimeConfig;
    uploadBuffer?: (...args: any[]) => Promise<any>;
    run?: typeof runAiImageJob;
  } = {},
) {
  const repository = overrides.repository || new PrismaAiImageJobRepository(prisma);
  const persisted = await repository.getById(jobId);
  if (!persisted) return;
  const providerConfig = await (overrides.getProviderConfig || getAiImageProviderRuntimeConfig)();
  const onProviderJobCreated = repository.recordProviderJobId
    ? (providerJobId: string) => repository.recordProviderJobId!(jobId, providerJobId) : undefined;
  const provider = (overrides.resolveProvider || resolveAiImageProvider)(persisted.provider, providerConfig, onProviderJobCreated);
  const storage = overrides.uploadBuffer ? null : await getStorageBackend();
  const uploadBuffer = overrides.uploadBuffer || storage!.uploadBuffer.bind(storage);
  await (overrides.run || runAiImageJob)(jobId, attemptNumber, { repository, provider, uploadBuffer, maxAttempts: 1 });
}

export async function enqueueAiImageJob(jobId: string) {
  if (!aiImageGenerationQueue) {
    await processAiImageQueueJob(jobId, 1);
    return;
  }
  await aiImageGenerationQueue.add('generate', { jobId }, {
    jobId,
    attempts: 1,
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
