import { randomUUID } from 'node:crypto';
import { open } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { Queue, Worker } from 'bullmq';
import sharp from 'sharp';
import { getRuntimeConfigForStorage } from '../adapters/runtime-config.js';
import { connection } from '../lib/bullmq-connection.js';
import { prisma } from '../lib/prisma.js';
import { redis, redisDisabled } from '../lib/redis.js';
import { registerWorker } from '../lib/worker-registry.js';
import { PrismaAiImageJobRepository } from '../repositories/ai-image-job-repository.js';
import { getStorageBackend } from '../services/image-storage.js';
import {
  AI_IMAGE_EDIT_MAX_INPUT_BYTES,
  runAiImageEditJob,
} from '../services/ai-image-edit.js';
import {
  AiImageJobError,
  createDisabledAiImageProvider,
  type AiImageJobRecord,
  type AiImageJobRepository,
  type AiImageProvider,
} from '../services/ai-image-jobs.js';

const QUEUE_NAME = 'ai-image-edit';
const LOCAL_UPLOAD_ROOT = resolve(process.cwd(), 'public', 'uploads');
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

function exactStorageKey(value: unknown) {
  const key = String(value || '')
    .normalize('NFKC')
    .trim();
  if (!key || key.length > 2_000 || key.includes('\0')) {
    throw new AiImageJobError('INVALID_MEDIA_INPUT', 'Frozen edit storage key is invalid');
  }
  return key;
}

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

function frozenInputSize(value: unknown): number {
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size < 1 || size > AI_IMAGE_EDIT_MAX_INPUT_BYTES) {
    throw new AiImageJobError('INVALID_MEDIA_INPUT', 'Frozen edit input size is invalid');
  }
  return size;
}

function frozenSizeMismatch(): AiImageJobError {
  return new AiImageJobError(
    'FROZEN_INPUT_MISMATCH',
    'Stored edit input size does not match the frozen asset identity',
  );
}

export async function readBoundedAiImageEditFile(
  path: string,
  expectedSizeValue: number,
): Promise<Buffer> {
  const expectedSize = frozenInputSize(expectedSizeValue);
  const handle = await open(path, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > AI_IMAGE_EDIT_MAX_INPUT_BYTES) {
      throw new AiImageJobError('INVALID_MEDIA_INPUT', 'Frozen local edit input is empty or too large');
    }
    if (stat.size !== expectedSize) throw frozenSizeMismatch();

    const buffer = Buffer.allocUnsafe(expectedSize);
    let offset = 0;
    while (offset < expectedSize) {
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        expectedSize - offset,
        offset,
      );
      if (bytesRead < 1) throw frozenSizeMismatch();
      offset += bytesRead;
    }
    const sentinel = Buffer.allocUnsafe(1);
    const { bytesRead: extraBytes } = await handle.read(sentinel, 0, 1, expectedSize);
    if (extraBytes !== 0) throw frozenSizeMismatch();
    return buffer;
  } finally {
    await handle.close();
  }
}

function streamChunkBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === 'string') return Buffer.from(value);
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  throw new AiImageJobError('INVALID_MEDIA_INPUT', 'Frozen OSS edit input stream is invalid');
}

export async function readBoundedAiImageEditStream(
  stream: AsyncIterable<unknown>,
  expectedSizeValue: number,
): Promise<Buffer> {
  const expectedSize = frozenInputSize(expectedSizeValue);
  const buffer = Buffer.allocUnsafe(expectedSize);
  let offset = 0;
  for await (const value of stream) {
    const chunk = streamChunkBuffer(value);
    if (!chunk.length) continue;
    const remaining = expectedSize - offset;
    if (remaining < 1 || chunk.length > remaining) throw frozenSizeMismatch();
    chunk.copy(buffer, offset);
    offset += chunk.length;
  }
  if (offset !== expectedSize) throw frozenSizeMismatch();
  return buffer;
}

function ossBodyStream(body: unknown): AsyncIterable<unknown> {
  const direct = body as AsyncIterable<unknown> | null;
  if (direct && typeof direct[Symbol.asyncIterator] === 'function') return direct;
  const webStream = (body as { transformToWebStream?: () => unknown } | null)
    ?.transformToWebStream?.() as AsyncIterable<unknown> | null;
  if (webStream && typeof webStream[Symbol.asyncIterator] === 'function') return webStream;
  throw new AiImageJobError('EDIT_STORAGE_NOT_READY', 'OSS input reader did not return a bounded stream');
}

async function defaultReadOssObject(key: string, expectedSizeValue: number): Promise<Buffer> {
  const expectedSize = frozenInputSize(expectedSizeValue);
  const runtime = await getRuntimeConfigForStorage();
  const config = runtime.oss;
  if (!config?.endpoint || !config.bucket || !config.accessKeyId || !config.accessKeySecret) {
    throw new AiImageJobError('EDIT_STORAGE_NOT_READY', 'OSS input reader is not configured');
  }
  const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const endpoint = config.endpoint.startsWith('http')
    ? config.endpoint
    : `https://${config.endpoint}`;
  const client = new S3Client({
    endpoint,
    region: config.region || 'auto',
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.accessKeySecret,
    },
    forcePathStyle: endpoint.includes('localhost') || endpoint.includes('minio'),
  });
  try {
    const result = await client.send(new GetObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Range: `bytes=0-${expectedSize}`,
    }));
    const contentLength = result.ContentLength == null ? null : Number(result.ContentLength);
    if (!result.Body || (contentLength != null && (
      !Number.isSafeInteger(contentLength)
      || contentLength < 1
      || contentLength > AI_IMAGE_EDIT_MAX_INPUT_BYTES
    ))) {
      throw new AiImageJobError('INVALID_MEDIA_INPUT', 'Frozen OSS edit input is empty or too large');
    }
    if (contentLength != null && contentLength !== expectedSize) throw frozenSizeMismatch();
    return await readBoundedAiImageEditStream(ossBodyStream(result.Body), expectedSize);
  } finally {
    client.destroy();
  }
}

export async function loadAiImageEditInputBuffer(
  asset: FrozenInputAsset,
  overrides: {
    readLocalFile?: (path: string, expectedSize: number) => Promise<Buffer>;
    readOssObject?: (key: string, expectedSize: number) => Promise<Buffer>;
  } = {},
) {
  const key = exactStorageKey(asset.storageKey);
  const expectedSize = frozenInputSize(asset.sizeBytes);
  let buffer: Buffer;
  if (asset.storageBackend === 'local') {
    if (basename(key) !== key || key.includes('/') || key.includes('\\')) {
      throw new AiImageJobError(
        'INVALID_MEDIA_INPUT',
        'Local edit input storage key must be a filename',
      );
    }
    const path = resolve(join(LOCAL_UPLOAD_ROOT, key));
    if (!path.startsWith(`${LOCAL_UPLOAD_ROOT}\\`) && !path.startsWith(`${LOCAL_UPLOAD_ROOT}/`)) {
      throw new AiImageJobError(
        'INVALID_MEDIA_INPUT',
        'Local edit input escaped the trusted upload root',
      );
    }
    buffer = await (overrides.readLocalFile || readBoundedAiImageEditFile)(path, expectedSize);
  } else if (asset.storageBackend === 'oss') {
    buffer = await (overrides.readOssObject || defaultReadOssObject)(key, expectedSize);
  } else {
    throw new AiImageJobError(
      'INVALID_MEDIA_INPUT',
      'Edit inputs must use trusted local or OSS storage',
    );
  }
  if (!Buffer.isBuffer(buffer)) {
    throw new AiImageJobError('INVALID_MEDIA_INPUT', 'Frozen edit input reader returned invalid bytes');
  }
  if (buffer.length !== expectedSize) throw frozenSizeMismatch();
  return buffer;
}

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
