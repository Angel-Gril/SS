import { randomUUID } from 'node:crypto';
import { Queue, Worker } from 'bullmq';
import { getConfig } from '../config/system-config-schema.js';
import { getRuntimeConfigForStorage } from '../adapters/runtime-config.js';
import { connection } from '../lib/bullmq-connection.js';
import { prisma } from '../lib/prisma.js';
import { redis, redisDisabled } from '../lib/redis.js';
import { registerWorker } from '../lib/worker-registry.js';
import { PrismaAiImageJobRepository } from '../repositories/ai-image-job-repository.js';
import { getStorageBackend } from '../services/image-storage.js';
import {
  hasExactAiMediaSandboxEvidence,
  resolveAiImageProviderCapability,
} from '../services/ai-image-provider-capabilities.js';
import {
  isPublicHttpsStorageUrl,
  resolveAiImageTranslationStorageReadiness,
  type AiImageTranslationStorageReadiness,
} from '../services/ai-image-translation-storage.js';
import {
  createDashScopeImageTranslationProvider,
  type DashScopeImageTranslationProviderOptions,
} from '../services/ai-image-providers.js';
import {
  AI_IMAGE_TRANSLATION_MAX_ACCEPTED_TASK_AGE_MS,
  createDisabledAiImageTranslationProvider,
  createFakeAiImageTranslationProvider,
  isAiImageTranslationTransientError,
  runAiImageTranslationJob,
  type AiImageTranslationProvider,
} from '../services/ai-image-translation.js';
import { AiImageJobError, type AiImageJobRecord, type AiImageJobRepository } from '../services/ai-image-jobs.js';

const QUEUE_NAME = 'ai-image-translation';
const POLL_DELAY_MS = 2_000;
const MAX_POLL_DELAY_MS = 30_000;
// Covers the provider timeout for submit, poll, result download, and a slow
// object-store write. The database state/deadline remains authoritative.
const POLL_LEASE_MS = 20 * 60 * 1000;
const RECOVERY_PAGE_SIZE = 100;
const fakePng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2S8AAAAASUVORK5CYII=',
  'base64',
);

export const aiImageTranslationQueue: Queue | null = redisDisabled
  ? null
  : new Queue(QUEUE_NAME, { connection });

export const AI_IMAGE_TRANSLATION_QUEUE_JOB_OPTIONS = {
  attempts: 2,
  backoff: { type: 'fixed', delay: 2_000 },
  removeOnComplete: 100,
  removeOnFail: 500,
} as const;

export function aiImageTranslationQueueJobId(jobId: string) {
  return `translate-${jobId}`;
}

export function aiImageTranslationPollJobId(jobId: string, dueAtMs: number) {
  return `poll-${jobId}-${Math.floor(dueAtMs / 1_000)}`;
}

export interface AiImageTranslationProviderRuntimeConfig {
  enabled: boolean;
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  costPerImageCents: number;
}

export async function getAiImageTranslationProviderRuntimeConfig(): Promise<AiImageTranslationProviderRuntimeConfig> {
  const [enabled, provider, baseUrl, apiKey, model, costPerImageCents] = await Promise.all([
    getConfig('feature_image_translate'),
    getConfig('ai_image_translation_provider'),
    getConfig('ai_image_translation_base_url'),
    getConfig('ai_image_translation_api_key'),
    getConfig('ai_image_translation_model'),
    getConfig('ai_image_translation_cost_cents'),
  ]);
  return {
    enabled,
    provider,
    baseUrl,
    apiKey,
    model,
    costPerImageCents: Number(costPerImageCents || 0),
  };
}

export function resolveAiImageTranslationProvider(
  provider: string,
  config: AiImageTranslationProviderRuntimeConfig,
): AiImageTranslationProvider {
  if (provider === 'fake') {
    return createFakeAiImageTranslationProvider({
      image: { buffer: fakePng, mimeType: 'image/png' },
      actualCostCents: 0,
    });
  }
  if (
    provider !== config.provider
    || provider !== 'dashscope-qwen-mt-image'
    || !config.apiKey.trim()
    || !config.model.trim()
  ) {
    return createDisabledAiImageTranslationProvider();
  }
  const options: DashScopeImageTranslationProviderOptions = {
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
    costPerImageCents: config.costPerImageCents,
  };
  return createDashScopeImageTranslationProvider(options);
}

type TranslationWorkerOverrides = {
  repository?: AiImageJobRepository;
  resolveProvider?: typeof resolveAiImageTranslationProvider;
  getProviderConfig?: typeof getAiImageTranslationProviderRuntimeConfig;
  resolveCapability?: typeof resolveAiImageProviderCapability;
  getStorageConfig?: typeof getRuntimeConfigForStorage;
  uploadBuffer?: (...args: any[]) => Promise<any>;
  schedulePoll?: (jobId: string, delayMs: number) => Promise<void>;
  acquireLease?: (jobId: string, token: string) => Promise<boolean>;
  releaseLease?: (jobId: string, token: string) => Promise<void>;
};

function pollDelay(job: AiImageJobRecord) {
  const dispatchedAt = job.providerDispatchedAt instanceof Date
    ? job.providerDispatchedAt.getTime()
    : Date.now();
  const ageSteps = Math.max(0, Math.floor((Date.now() - dispatchedAt) / 30_000));
  return Math.min(MAX_POLL_DELAY_MS, POLL_DELAY_MS * (2 ** Math.min(4, ageSteps)));
}

function acceptedTaskExpired(job: AiImageJobRecord) {
  return job.providerDispatchedAt instanceof Date
    && Date.now() - job.providerDispatchedAt.getTime() >= AI_IMAGE_TRANSLATION_MAX_ACCEPTED_TASK_AGE_MS;
}

async function scheduleTranslationPoll(jobId: string, delayMs: number) {
  if (!aiImageTranslationQueue) {
    throw new AiImageJobError('QUEUE_UNAVAILABLE', 'Redis is required for asynchronous image translation');
  }
  const queueJobId = aiImageTranslationPollJobId(jobId, Date.now() + Math.max(0, delayMs));
  try {
    await aiImageTranslationQueue.add(
      'poll',
      { jobId },
      {
        ...AI_IMAGE_TRANSLATION_QUEUE_JOB_OPTIONS,
        delay: Math.max(0, delayMs),
        jobId: queueJobId,
      },
    );
  } catch (error) {
    if (!/job.*(?:already )?exists/iu.test(error instanceof Error ? error.message : String(error))) throw error;
  }
}

async function acquireTranslationLease(jobId: string, token: string) {
  if (redisDisabled) return true;
  return await redis.set(`lease:ai-image-translation:${jobId}`, token, 'PX', POLL_LEASE_MS, 'NX') === 'OK';
}

async function releaseTranslationLease(jobId: string, token: string) {
  if (redisDisabled) return;
  await redis.eval(
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
    1,
    `lease:ai-image-translation:${jobId}`,
    token,
  );
}

async function failRuntimeGate(
  repository: AiImageJobRepository,
  job: AiImageJobRecord,
  attemptNumber: number,
  error: AiImageJobError,
) {
  await repository.markFailed(job.id, {
    attemptCount: attemptNumber,
    errorCode: error.code,
    errorMessage: error.message,
    ...(job.providerJobId
      ? { providerJobId: job.providerJobId }
      : { providerSubmissionRejected: true }),
  });
  throw error;
}

async function processClaimedTranslationJob(
  jobId: string,
  attemptNumber: number,
  overrides: TranslationWorkerOverrides,
) {
  const repository = overrides.repository || new PrismaAiImageJobRepository(prisma);
  const persisted = await repository.getById(jobId);
  if (!persisted || persisted.operation !== 'IMAGE_TRANSLATE') return 'ignored' as const;
  if (persisted.status === 'SUCCEEDED' || persisted.status === 'FAILED') return 'ignored' as const;
  if (persisted.status === 'CANCEL_REQUESTED' || persisted.status === 'CANCELLED') {
    await repository.markCancelled(jobId, {
      providerSubmissionUncertain: Boolean(persisted.providerJobId),
    });
    return 'ignored' as const;
  }

  const schedulePoll = overrides.schedulePoll || scheduleTranslationPoll;
  let providerConfig: AiImageTranslationProviderRuntimeConfig;
  let provider: AiImageTranslationProvider;
  let uploadBuffer: (...args: any[]) => Promise<any>;
  try {
    providerConfig = await (overrides.getProviderConfig || getAiImageTranslationProviderRuntimeConfig)();
    if (!providerConfig.enabled || providerConfig.provider === 'disabled') {
      return await failRuntimeGate(repository, persisted, attemptNumber, new AiImageJobError(
        'AI_MEDIA_OPERATION_DISABLED',
        'AI image translation is disabled',
      ));
    }
    if (persisted.provider !== providerConfig.provider || persisted.model !== providerConfig.model) {
      return await failRuntimeGate(repository, persisted, attemptNumber, new AiImageJobError(
        'PROVIDER_CONFIG_CHANGED',
        'Image translation provider or model changed after the job was frozen',
      ));
    }
    const fakeAllowed = process.env.NODE_ENV !== 'production';
    if (persisted.provider === 'fake' && !fakeAllowed) {
      return await failRuntimeGate(repository, persisted, attemptNumber, new AiImageJobError(
        'PROVIDER_NOT_READY',
        'The fake image translation provider is test-only',
      ));
    }
    if (persisted.provider !== 'fake') {
      if (providerConfig.costPerImageCents <= 0 || persisted.estimatedCostCents <= 0) {
        return await failRuntimeGate(repository, persisted, attemptNumber, new AiImageJobError(
          'PROVIDER_NOT_READY',
          'A verified positive image translation cost is required before paid dispatch',
        ));
      }
      if (persisted.estimatedCostCents !== providerConfig.costPerImageCents) {
        return await failRuntimeGate(repository, persisted, attemptNumber, new AiImageJobError(
          'PROVIDER_CONFIG_CHANGED',
          'Image translation cost configuration changed after the job was frozen',
        ));
      }
    }
    if (!overrides.uploadBuffer) {
      const storageConfig = await (overrides.getStorageConfig || getRuntimeConfigForStorage)();
      const storageReadiness: AiImageTranslationStorageReadiness =
        resolveAiImageTranslationStorageReadiness(storageConfig);
      if (
        !storageReadiness.ready
        || (persisted.provider !== 'fake'
          && (storageReadiness.backend !== 'oss' || storageReadiness.publicHttps !== true))
      ) {
        throw new AiImageJobError(
          'STORAGE_NOT_READY',
          storageReadiness.reason || 'Image translation storage is not ready for Provider dispatch',
        );
      }
      if (persisted.provider !== 'fake') {
        const frozenSourceUrl = persisted.inputAssets
          ?.find((asset) => asset.role === 'REFERENCE')
          ?.url;
        if (!isPublicHttpsStorageUrl(frozenSourceUrl)) {
          throw new AiImageJobError(
            'STORAGE_NOT_READY',
            'The frozen image translation source is not reachable over public HTTPS',
          );
        }
      }
    }
    // Capability evidence gates only new paid dispatches. Once a Provider has
    // accepted a task, recovery must keep polling it even if the current
    // capability registry is still dark or has since been tightened.
    if (persisted.provider !== 'fake' && !persisted.providerJobId) {
      const capability = (overrides.resolveCapability || resolveAiImageProviderCapability)(
        persisted.provider,
        persisted.model,
      );
      if (!hasExactAiMediaSandboxEvidence({
        capability,
        provider: persisted.provider,
        model: persisted.model,
        baseUrl: providerConfig.baseUrl,
        operation: 'IMAGE_TRANSLATE',
        inputTransport: 'public_url',
        resultMode: 'async',
      })) {
        return await failRuntimeGate(
          repository,
          persisted,
          attemptNumber,
          new AiImageJobError(
            'PROVIDER_NOT_READY',
            'Image translation provider has not passed its sandbox capability gate',
          ),
        );
      }
    }
    provider = (overrides.resolveProvider || resolveAiImageTranslationProvider)(
      persisted.provider,
      providerConfig,
    );
    const storage = overrides.uploadBuffer ? null : await getStorageBackend();
    uploadBuffer = overrides.uploadBuffer || storage!.uploadBuffer.bind(storage);
  } catch (error) {
    if (error instanceof AiImageJobError && ['AI_MEDIA_OPERATION_DISABLED', 'PROVIDER_CONFIG_CHANGED', 'PROVIDER_NOT_READY'].includes(error.code)) {
      throw error;
    }
    await repository.markFailed(jobId, {
      attemptCount: attemptNumber,
      errorCode: error instanceof AiImageJobError ? error.code : 'WORKER_SETUP_FAILED',
      errorMessage: error instanceof Error
        ? error.message
        : 'AI image translation worker setup failed before provider dispatch',
      ...(persisted.providerJobId
        ? { providerJobId: persisted.providerJobId }
        : { providerSubmissionRejected: true }),
    });
    throw error;
  }

  try {
    const result = await runAiImageTranslationJob(jobId, attemptNumber, {
      repository,
      provider,
      uploadBuffer,
    });
    if (result === 'pending') {
      const latest = await repository.getById(jobId);
      if (latest?.status === 'RUNNING' && latest.providerJobId) {
        await schedulePoll(jobId, pollDelay(latest));
      }
    }
    return result;
  } catch (error) {
    const latest = await repository.getById(jobId);
    if (latest?.status === 'RUNNING' && latest.providerJobId && isAiImageTranslationTransientError(error)) {
      if (!latest.providerDispatchedAt || acceptedTaskExpired(latest)) {
        await repository.markFailed(jobId, {
          attemptCount: attemptNumber,
          errorCode: 'PROVIDER_POLL_TIMEOUT',
          errorMessage: latest.providerDispatchedAt
            ? 'Image translation provider task exceeded the recovery deadline'
            : 'Image translation provider task has no durable poll deadline',
          providerJobId: latest.providerJobId,
        });
        throw new AiImageJobError('PROVIDER_POLL_TIMEOUT', 'Image translation provider polling cannot continue safely');
      }
      await schedulePoll(jobId, pollDelay(latest));
      return 'pending' as const;
    }
    throw error;
  }
}

export async function processAiImageTranslationQueueJob(
  jobId: string,
  attemptNumber: number,
  overrides: TranslationWorkerOverrides = {},
) {
  const token = randomUUID();
  const acquireLease = overrides.acquireLease
    || (overrides.repository ? async () => true : acquireTranslationLease);
  const releaseLease = overrides.releaseLease
    || (overrides.repository ? async () => undefined : releaseTranslationLease);
  if (!await acquireLease(jobId, token)) return 'ignored' as const;
  try {
    return await processClaimedTranslationJob(jobId, attemptNumber, overrides);
  } finally {
    await releaseLease(jobId, token);
  }
}

export async function enqueueAiImageTranslationJob(jobId: string) {
  if (!aiImageTranslationQueue) {
    throw new AiImageJobError('QUEUE_UNAVAILABLE', 'Redis is required for asynchronous image translation');
  }
  await aiImageTranslationQueue.add('translate', { jobId }, {
    ...AI_IMAGE_TRANSLATION_QUEUE_JOB_OPTIONS,
    jobId: aiImageTranslationQueueJobId(jobId),
  });
}

export async function enqueueRecoverableTranslationJobs() {
  if (!aiImageTranslationQueue) return;
  let cursor: string | undefined;
  while (true) {
    const rows = await (prisma as any).aiImageJob.findMany({
      where: {
        operation: 'IMAGE_TRANSLATE',
        status: { in: ['PENDING', 'QUEUED', 'RUNNING', 'RETRYING', 'CANCEL_REQUESTED'] },
      },
      select: { id: true, status: true },
      orderBy: { id: 'asc' },
      take: RECOVERY_PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!rows.length) break;
    await Promise.all(rows.map((row: { id: string; status: string }) => (
      row.status === 'RUNNING' || row.status === 'CANCEL_REQUESTED'
        ? scheduleTranslationPoll(row.id, 0)
        : aiImageTranslationQueue.add('translate', { jobId: row.id }, {
          ...AI_IMAGE_TRANSLATION_QUEUE_JOB_OPTIONS,
          jobId: aiImageTranslationQueueJobId(row.id),
        })
    )));
    if (rows.length < RECOVERY_PAGE_SIZE) break;
    cursor = rows[rows.length - 1]!.id;
  }
}

export function startAiImageTranslationWorker() {
  if (redisDisabled) return null;
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      await processAiImageTranslationQueueJob(String(job.data.jobId), job.attemptsMade + 1);
    },
    { connection, concurrency: 2 },
  );
  worker.on('failed', (job, error) => {
    console.error(`[ai-image-translation] job ${job?.id || 'unknown'} failed:`, error.message);
  });
  registerWorker(worker);
  void enqueueRecoverableTranslationJobs().catch((error) => {
    console.error('[ai-image-translation] recovery scan failed:', error);
  });
  return worker;
}
