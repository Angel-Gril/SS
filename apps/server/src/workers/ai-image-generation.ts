import { Queue, Worker } from 'bullmq';
import { getConfig } from '../config/system-config-schema.js';
import { connection } from '../lib/bullmq-connection.js';
import { prisma } from '../lib/prisma.js';
import { redisDisabled } from '../lib/redis.js';
import { registerWorker } from '../lib/worker-registry.js';
import { PrismaAiImageJobRepository } from '../repositories/ai-image-job-repository.js';
import { getStorageBackend } from '../services/image-storage.js';
import { createDashScopeWanxProvider, createOpenAiImagesProvider } from '../services/ai-image-providers.js';
import { resolveAiImageProviderCapability } from '../services/ai-image-provider-capabilities.js';
import { AiImageJobError, createDisabledAiImageProvider, createFakeAiImageProvider, runAiImageJob, type AiImageJobRepository } from '../services/ai-image-jobs.js';

const QUEUE_NAME = 'ai-image-generation';
const fakePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2S8AAAAASUVORK5CYII=', 'base64');

export const aiImageGenerationQueue: Queue | null = redisDisabled ? null : new Queue(QUEUE_NAME, { connection });
export const AI_IMAGE_QUEUE_JOB_OPTIONS = {
  attempts: 2,
  backoff: { type: 'fixed', delay: 1_000 },
  removeOnComplete: 100,
  removeOnFail: 500,
} as const;

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
  onProviderJobCreated?: (providerJobId: string, providerAcceptedAt: Date) => Promise<void>,
) {
  if (provider === 'fake') {
    return createFakeAiImageProvider({ images: [{ buffer: fakePng, mimeType: 'image/png' }], actualCostCents: 0 });
  }
  if (provider !== config.provider || !config.apiKey || !config.model) return createDisabledAiImageProvider();
  const capability = resolveAiImageProviderCapability(provider, config.model);
  if (capability?.evidenceLevel !== 'sandbox-verified' || config.costPerImageCents <= 0) {
    return createDisabledAiImageProvider();
  }
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
  if (persisted.status === 'CANCEL_REQUESTED' || persisted.status === 'CANCELLED') {
    await repository.markCancelled(jobId);
    return;
  }
  if (persisted.status === 'SUCCEEDED' || persisted.status === 'FAILED') return;
  if (persisted.status === 'RUNNING') {
    const recoveryAttemptCount = Math.max(persisted.attemptCount || 0, attemptNumber);
    const recoverAcceptedProviderTask = async (providerJobId: string) => {
      await repository.markFailed(jobId, {
        attemptCount: recoveryAttemptCount,
        errorCode: 'PROVIDER_RECOVERY_REQUIRED',
        errorMessage: 'Provider task was accepted before worker interruption; reconcile the provider result before retrying',
        providerJobId,
      });
    };
    if (persisted.providerJobId) {
      await recoverAcceptedProviderTask(persisted.providerJobId);
      return;
    }
    if (persisted.provider === 'fake') {
      await repository.markFailed(jobId, {
        attemptCount: recoveryAttemptCount,
        errorCode: 'WORKER_INTERRUPTED_BEFORE_PROVIDER_ACCEPTANCE',
        errorMessage: 'Zero-cost fake provider execution was interrupted before completion',
      });
      return;
    }
    const uncertainError = new AiImageJobError(
      'PROVIDER_SUBMISSION_UNCERTAIN',
      'Provider submission outcome requires manual reconciliation',
    );
    if (!repository.recoverInterruptedJob) {
      await repository.markSubmissionUncertain?.(jobId, {
        attemptCount: recoveryAttemptCount,
        errorCode: uncertainError.code,
        errorMessage: uncertainError.message,
      });
      throw uncertainError;
    }
    const recovery = repository.recoverInterruptedJob
      ? await repository.recoverInterruptedJob(jobId, {
        attemptCount: recoveryAttemptCount,
        errorCode: 'PROVIDER_SUBMISSION_UNCERTAIN',
        errorMessage: 'Worker restarted without a completed provider result',
      })
      : null;
    if (recovery === 'FAILED_PRE_DISPATCH') return;
    if (recovery === 'SUBMISSION_UNCERTAIN') throw uncertainError;

    const latest = await repository.getById(jobId);
    if (!latest) return;
    if (latest.status === 'CANCEL_REQUESTED' || latest.status === 'CANCELLED') {
      await repository.markCancelled(jobId);
      return;
    }
    if (latest.status === 'SUCCEEDED' || latest.status === 'FAILED') return;
    if (latest.providerJobId) {
      await recoverAcceptedProviderTask(latest.providerJobId);
      return;
    }
    if (latest.status !== 'RUNNING') return;
    await repository.markSubmissionUncertain?.(jobId, {
      attemptCount: recoveryAttemptCount,
      errorCode: uncertainError.code,
      errorMessage: uncertainError.message,
    });
    throw uncertainError;
  }
  let providerConfig: AiImageProviderRuntimeConfig;
  let provider;
  let uploadBuffer: (...args: any[]) => Promise<any>;
  try {
    providerConfig = await (overrides.getProviderConfig || getAiImageProviderRuntimeConfig)();
    const onProviderJobCreated = repository.recordProviderJobId
      ? (providerJobId: string, providerAcceptedAt: Date) => repository.recordProviderJobId!(jobId, providerJobId, providerAcceptedAt)
      : undefined;
    provider = (overrides.resolveProvider || resolveAiImageProvider)(persisted.provider, providerConfig, onProviderJobCreated);
    const storage = overrides.uploadBuffer ? null : await getStorageBackend();
    uploadBuffer = overrides.uploadBuffer || storage!.uploadBuffer.bind(storage);
  } catch (error) {
    const failure = {
      attemptCount: attemptNumber,
      errorCode: 'WORKER_SETUP_FAILED',
      errorMessage: 'AI image worker setup failed before provider dispatch',
    };
    if (repository.markEnqueueFailed) {
      const failed = await repository.markEnqueueFailed(jobId, failure);
      if (!failed) {
        const latest = await repository.getById(jobId);
        if (latest?.status === 'CANCEL_REQUESTED' || latest?.status === 'CANCELLED') {
          await repository.markCancelled(jobId);
        }
      }
    } else await repository.markFailed(jobId, failure);
    throw error;
  }
  await (overrides.run || runAiImageJob)(jobId, attemptNumber, { repository, provider, uploadBuffer, maxAttempts: 1 });
}

export async function enqueueAiImageJob(jobId: string) {
  if (!aiImageGenerationQueue) {
    await processAiImageQueueJob(jobId, 1);
    return;
  }
  await aiImageGenerationQueue.add('generate', { jobId }, {
    jobId,
    ...AI_IMAGE_QUEUE_JOB_OPTIONS,
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
