import { randomUUID } from 'node:crypto';
import { Queue, Worker } from 'bullmq';
import sharp from 'sharp';
import { connection } from '../lib/bullmq-connection.js';
import { prisma } from '../lib/prisma.js';
import { redis, redisDisabled } from '../lib/redis.js';
import { registerWorker } from '../lib/worker-registry.js';
import { PrismaAiImageJobRepository } from '../repositories/ai-image-job-repository.js';
import { getStorageBackend } from '../services/image-storage.js';
import { runAiImageEditJob } from '../services/ai-image-edit.js';
import {
  loadAiImageEditInputBuffer,
  readBoundedAiImageEditFile,
  readBoundedAiImageEditStream,
} from '../services/ai-image-edit-input-reader.js';
import {
  AiImageJobError,
  createDisabledAiImageProvider,
  type AiImageJobRecord,
  type AiImageJobRepository,
  type AiImageProvider,
} from '../services/ai-image-jobs.js';

const QUEUE_NAME = 'ai-image-edit';
const EDIT_EXECUTION_LEASE_MS = 20_000;
const EDIT_EXECUTION_HEARTBEAT_MS = 5_000;
export const AI_IMAGE_EDIT_FAKE_PROVIDER_PRODUCTION_BLOCKED =
  'AI_IMAGE_EDIT_FAKE_PROVIDER_PRODUCTION_BLOCKED' as const;

type FrozenInputAsset = NonNullable<AiImageJobRecord['inputAssets']>[number];

type AiImageEditWorkerOverrides = {
  repository?: AiImageJobRepository;
  resolveProvider?: typeof resolveAiImageEditProvider;
  uploadBuffer?: (...args: any[]) => Promise<any>;
  loadInputBuffer?: (asset: FrozenInputAsset) => Promise<Buffer>;
  run?: typeof runAiImageEditJob;
  acquireLease?: (jobId: string, token: string) => Promise<boolean>;
  renewLease?: (jobId: string, token: string) => Promise<boolean>;
  releaseLease?: (jobId: string, token: string) => Promise<void>;
  nodeEnv?: string;
};

export const aiImageEditQueue: Queue | null = redisDisabled
  ? null
  : new Queue(QUEUE_NAME, { connection });

export const AI_IMAGE_EDIT_QUEUE_JOB_OPTIONS = {
  attempts: 1,
  removeOnComplete: 100,
  removeOnFail: 500,
} as const;

async function acquireEditExecutionLease(jobId: string, token: string) {
  if (redisDisabled) return true;
  return (
    (await redis.set(
      `lease:ai-image-edit:${jobId}`,
      token,
      'PX',
      EDIT_EXECUTION_LEASE_MS,
      'NX',
    )) === 'OK'
  );
}

async function renewEditExecutionLease(jobId: string, token: string) {
  if (redisDisabled) return true;
  return (
    (await redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end",
      1,
      `lease:ai-image-edit:${jobId}`,
      token,
      EDIT_EXECUTION_LEASE_MS,
    )) === 1
  );
}

async function releaseEditExecutionLease(jobId: string, token: string) {
  if (redisDisabled) return;
  await redis.eval(
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
    1,
    `lease:ai-image-edit:${jobId}`,
    token,
  );
}

export {
  loadAiImageEditInputBuffer,
  readBoundedAiImageEditFile,
  readBoundedAiImageEditStream,
};

export function assertAiImageEditProviderRuntime(
  provider: string,
  nodeEnv = process.env.NODE_ENV,
): void {
  if (provider === 'fake' && nodeEnv === 'production') {
    throw new AiImageJobError(
      AI_IMAGE_EDIT_FAKE_PROVIDER_PRODUCTION_BLOCKED,
      'The fake AI image edit Provider is disabled in production',
    );
  }
}

export function resolveAiImageEditProvider(
  provider: string,
  model: string,
  nodeEnv = process.env.NODE_ENV,
): AiImageProvider {
  assertAiImageEditProviderRuntime(provider, nodeEnv);
  if (provider !== 'fake' || model !== 'fake-image-edit-v1') return createDisabledAiImageProvider();
  return {
    name: 'fake',
    async generate(request) {
      if (
        !['FULL_EDIT', 'INPAINT'].includes(String(request.operation)) ||
        request.model !== 'fake-image-edit-v1' ||
        request.count !== 1
      ) {
        throw new AiImageJobError(
          'INVALID_MEDIA_INPUT',
          'Fake edit request does not match its frozen contract',
        );
      }
      const buffer = await sharp({
        create: {
          width: request.width,
          height: request.height,
          channels: 4,
          background:
            request.operation === 'INPAINT'
              ? { r: 38, g: 166, b: 154, alpha: 1 }
              : { r: 225, g: 64, b: 73, alpha: 1 },
        },
      })
        .png({ compressionLevel: 9 })
        .toBuffer();
      return { images: [{ buffer, mimeType: 'image/png' }], actualCostCents: 0 };
    },
  };
}

export async function processAiImageEditQueueJob(
  jobId: string,
  attemptNumber: number,
  overrides: AiImageEditWorkerOverrides = {},
) {
  const token = randomUUID();
  const acquireLease =
    overrides.acquireLease || (overrides.repository ? async () => true : acquireEditExecutionLease);
  const renewLease =
    overrides.renewLease || (overrides.repository ? async () => true : renewEditExecutionLease);
  const releaseLease =
    overrides.releaseLease ||
    (overrides.repository ? async () => undefined : releaseEditExecutionLease);
  const repository = overrides.repository || new PrismaAiImageJobRepository(prisma);
  let leaseAcquired: boolean;
  try {
    leaseAcquired = await acquireLease(jobId, token);
  } catch (error) {
    const details = {
      attemptCount: attemptNumber,
      errorCode: 'EDIT_EXECUTION_LEASE_UNAVAILABLE',
      errorMessage: 'AI image edit execution coordination is temporarily unavailable',
    };
    if (repository.markEnqueueFailed) await repository.markEnqueueFailed(jobId, details);
    else await repository.markFailed(jobId, details);
    throw error;
  }
  if (!leaseAcquired) return 'ignored' as const;
  let leaseLost = false;
  let heartbeatInFlight = false;
  const heartbeatTimer = setInterval(() => {
    if (heartbeatInFlight || leaseLost) return;
    heartbeatInFlight = true;
    void renewLease(jobId, token)
      .then((renewed) => {
        if (!renewed) leaseLost = true;
      })
      .catch(() => {
        leaseLost = true;
      })
      .finally(() => {
        heartbeatInFlight = false;
      });
  }, EDIT_EXECUTION_HEARTBEAT_MS);
  heartbeatTimer.unref();
  try {
    const job = await repository.getById(jobId);
    if (!job || ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(job.status))
      return 'ignored' as const;
    const nodeEnv = overrides.nodeEnv === undefined ? process.env.NODE_ENV : overrides.nodeEnv;
    if (job.provider === 'fake' && nodeEnv === 'production') {
      const blocked = new AiImageJobError(
        AI_IMAGE_EDIT_FAKE_PROVIDER_PRODUCTION_BLOCKED,
        'The fake AI image edit Provider is disabled in production',
      );
      const details = {
        attemptCount: Math.max(job.attemptCount, attemptNumber),
        errorCode: blocked.code,
        errorMessage: blocked.message,
      };
      if (job.status === 'RUNNING') {
        await repository.markFailed(job.id, details);
      } else if (repository.markEnqueueFailed) {
        await repository.markEnqueueFailed(job.id, details);
      } else {
        await repository.markFailed(job.id, details);
      }
      throw blocked;
    }
    if (job.status === 'RUNNING') {
      const interrupted = new AiImageJobError(
        'EDIT_RECOVERY_REQUIRED',
        'An exclusively reclaimed image edit requires an explicit workflow retry',
      );
      await repository.markFailed(job.id, {
        attemptCount: Math.max(job.attemptCount, attemptNumber),
        errorCode: interrupted.code,
        errorMessage: interrupted.message,
      });
      throw interrupted;
    }
    let provider: AiImageProvider;
    let uploadBuffer: (...args: any[]) => Promise<any>;
    try {
      provider = (overrides.resolveProvider || resolveAiImageEditProvider)(job.provider, job.model, nodeEnv);
      const storage = overrides.uploadBuffer ? null : await getStorageBackend();
      uploadBuffer = overrides.uploadBuffer || storage!.uploadBuffer.bind(storage);
    } catch (error) {
      const details = {
        attemptCount: attemptNumber,
        errorCode: 'WORKER_SETUP_FAILED',
        errorMessage: 'AI image edit worker setup failed before Provider execution',
      };
      if (repository.markEnqueueFailed) await repository.markEnqueueFailed(jobId, details);
      else await repository.markFailed(jobId, details);
      throw error;
    }
    return await (overrides.run || runAiImageEditJob)(jobId, attemptNumber, {
      repository,
      provider,
      uploadBuffer,
      loadInputBuffer: overrides.loadInputBuffer || loadAiImageEditInputBuffer,
      assertExecutionLease: () => {
        if (leaseLost) {
          throw new AiImageJobError(
            'EDIT_EXECUTION_LEASE_LOST',
            'AI image edit execution lease was lost',
          );
        }
      },
    });
  } finally {
    clearInterval(heartbeatTimer);
    await releaseLease(jobId, token);
  }
}

export async function enqueueAiImageEditJob(jobId: string) {
  if (!aiImageEditQueue) {
    await processAiImageEditQueueJob(jobId, 1);
    return;
  }
  await aiImageEditQueue.add(
    'edit',
    { jobId },
    {
      jobId,
      ...AI_IMAGE_EDIT_QUEUE_JOB_OPTIONS,
    },
  );
}

export function startAiImageEditWorker() {
  if (redisDisabled) return null;
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => processAiImageEditQueueJob(String(job.data.jobId), job.attemptsMade + 1),
    { connection, concurrency: 1 },
  );
  worker.on('failed', (job, error) => {
    console.error(`[ai-image-edit] job ${job?.id || 'unknown'} failed:`, error.message);
  });
  registerWorker(worker);
  return worker;
}
