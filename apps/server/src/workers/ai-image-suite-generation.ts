import { createHash, randomUUID } from 'node:crypto';
import { Queue, Worker } from 'bullmq';
import { connection } from '../lib/bullmq-connection.js';
import { redis, redisDisabled } from '../lib/redis.js';
import { registerWorker } from '../lib/worker-registry.js';
import { AI_IMAGE_SUITE_MAX_CONCURRENCY } from '../services/ai-image-suite.js';
import { hasAdmittedWanxAiImageSuiteOperation } from '../services/ai-image-suite-provider-runtime.js';
import type { AiMediaCapabilityEvidence } from '../services/ai-image-provider-capabilities.js';
import {
  AI_IMAGE_SUITE_WORKER_HEARTBEAT_INTERVAL_MS,
  clearAiImageSuiteWorkerHeartbeat,
  recordAiImageSuiteWorkerHeartbeat,
  type AiImageSuiteRuntimeRedis,
} from '../services/ai-image-suite-runtime-readiness.js';

export const AI_IMAGE_SUITE_GENERATION_QUEUE_NAME = 'ai-image-suite-generation';
const AI_IMAGE_SUITE_GENERATION_QUEUE_TASK_NAME = 'generate-suite-slot';
const AI_IMAGE_SUITE_GENERATION_LEASE_MS = 60_000;
const AI_IMAGE_SUITE_GENERATION_RECOVERY_PAGE_SIZE = 100;
const AI_IMAGE_SUITE_GENERATION_RECOVERY_INTERVAL_MS = 30_000;
const AI_IMAGE_SUITE_GENERATION_RECOVERY_LEASE_MS = 120_000;
const AI_IMAGE_SUITE_GENERATION_RECOVERY_HEARTBEAT_MS = 30_000;
export const AI_IMAGE_SUITE_GENERATION_RECOVERY_LEASE_KEY =
  'lease:ai-image-suite-generation:recovery:v1';
const MAX_ID_LENGTH = 200;

const RENEW_RECOVERY_LEASE_SCRIPT = [
  "if redis.call('get', KEYS[1]) ~= ARGV[1] then return 0 end",
  "return redis.call('pexpire', KEYS[1], ARGV[2])",
].join('\n');
const RELEASE_RECOVERY_LEASE_SCRIPT = [
  "if redis.call('get', KEYS[1]) ~= ARGV[1] then return 0 end",
  "return redis.call('del', KEYS[1])",
].join('\n');

export const AI_IMAGE_SUITE_GENERATION_QUEUE_JOB_OPTIONS = {
  attempts: 2,
  backoff: { type: 'fixed', delay: 2_000 },
  removeOnComplete: 100,
  removeOnFail: 500,
} as const;

export interface AiImageSuiteGenerationQueuePayload {
  suiteId: string;
  slotId: string;
  workflowId: string;
  jobId: string;
  attempt: number;
}

export type AiImageSuiteGenerationExecutionClaim =
  | { kind: 'ignored' }
  | {
    kind: 'ready';
    provider: string;
    providerFacing: boolean;
    evidenceLevel?: AiMediaCapabilityEvidence | null;
    model?: string;
    operationConfig?: unknown;
    executionToken: string;
  };

export interface AiImageSuiteGenerationExecutionResult {
  kind: 'completed' | 'pending' | 'ignored';
  frontier?: AiImageSuiteGenerationQueuePayload[];
}

export interface AiImageSuiteGenerationRecoveryPage {
  items: AiImageSuiteGenerationQueuePayload[];
  nextCursor?: string | null;
}

export interface AiImageSuiteGenerationRuntimeFailure {
  code:
    | 'AI_MEDIA_SUITE_FAKE_PROVIDER_PRODUCTION_BLOCKED'
    | 'AI_MEDIA_SUITE_PAID_PROVIDER_NOT_VERIFIED';
  message: string;
}

/**
 * The implementation owns all database authority checks. revalidateAndClaim
 * must return a fenced claim for a still-queued frozen tuple; execute must
 * fence on executionToken and re-check the tuple before it calls a Provider.
 * The coordinator's queued-state CAS remains the authority for suite capacity.
 */
export interface AiImageSuiteGenerationCoordinator {
  revalidateAndClaim(
    payload: AiImageSuiteGenerationQueuePayload,
  ): Promise<AiImageSuiteGenerationExecutionClaim>;
  execute(
    payload: AiImageSuiteGenerationQueuePayload,
    claim: Extract<AiImageSuiteGenerationExecutionClaim, { kind: 'ready' }>,
  ): Promise<AiImageSuiteGenerationExecutionResult>;
  rejectRuntimeGate(
    payload: AiImageSuiteGenerationQueuePayload,
    claim: Extract<AiImageSuiteGenerationExecutionClaim, { kind: 'ready' }>,
    failure: AiImageSuiteGenerationRuntimeFailure,
  ): Promise<void>;
  scanRecoverable(input: {
    cursor?: string;
    limit: number;
  }): Promise<AiImageSuiteGenerationRecoveryPage>;
}

export type AiImageSuiteGenerationWorkerErrorCode =
  | AiImageSuiteGenerationRuntimeFailure['code']
  | 'AI_MEDIA_SUITE_GENERATION_INVALID_PAYLOAD'
  | 'AI_MEDIA_SUITE_GENERATION_INVALID_FRONTIER'
  | 'AI_MEDIA_SUITE_GENERATION_LEASE_BUSY'
  | 'AI_MEDIA_SUITE_GENERATION_QUEUE_UNAVAILABLE'
  | 'AI_MEDIA_SUITE_GENERATION_RECOVERY_CURSOR_LOOP'
  | 'AI_MEDIA_SUITE_GENERATION_RECOVERY_LEASE_LOST';

export class AiImageSuiteGenerationWorkerError extends Error {
  constructor(
    public readonly code: AiImageSuiteGenerationWorkerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AiImageSuiteGenerationWorkerError';
  }
}

interface QueueLike {
  add(
    name: string,
    data: AiImageSuiteGenerationQueuePayload,
    options: Record<string, unknown>,
  ): Promise<unknown>;
}

interface EnqueueOverrides {
  queue?: QueueLike | null;
}

interface ProcessOverrides {
  coordinator: AiImageSuiteGenerationCoordinator;
  acquireLease?: (suiteId: string, token: string) => Promise<boolean>;
  releaseLease?: (suiteId: string, token: string) => Promise<void>;
  enqueue?: (payload: AiImageSuiteGenerationQueuePayload) => Promise<void>;
  createLeaseToken?: () => string;
  nodeEnv?: string;
}

interface RecoveryOverrides {
  coordinator: AiImageSuiteGenerationCoordinator;
  enqueue?: (payload: AiImageSuiteGenerationQueuePayload) => Promise<void>;
  pageSize?: number;
  assertLeaseOwned?: () => Promise<void>;
}

export interface AiImageSuiteGenerationRecoveryLease {
  acquire(token: string): Promise<boolean>;
  renew(token: string): Promise<boolean>;
  release(token: string): Promise<void>;
}

export interface AiImageSuiteGenerationRecoveryRedis {
  set(
    key: string,
    token: string,
    expiryMode: 'PX',
    ttlMs: number,
    condition: 'NX',
  ): Promise<unknown>;
  eval(
    script: string,
    keyCount: 1,
    key: string,
    ...args: Array<string | number>
  ): Promise<unknown>;
}

interface RecoveryRunnerOverrides extends RecoveryOverrides {
  lease?: AiImageSuiteGenerationRecoveryLease;
  createLeaseToken?: () => string;
  heartbeatMs?: number;
  onLeaseReleaseError?: (error: unknown) => void;
}

export type AiImageSuiteGenerationRecoveryRunResult =
  | 'completed'
  | 'skipped-local'
  | 'skipped-distributed';

export const aiImageSuiteGenerationQueue: Queue | null = redisDisabled
  ? null
  : new Queue(AI_IMAGE_SUITE_GENERATION_QUEUE_NAME, { connection });

function invalidPayload(message: string): never {
  throw new AiImageSuiteGenerationWorkerError(
    'AI_MEDIA_SUITE_GENERATION_INVALID_PAYLOAD',
    message,
  );
}

function exactId(value: unknown, label: string): string {
  if (typeof value !== 'string'
    || !value
    || value !== value.trim()
    || value.length > MAX_ID_LENGTH) {
    return invalidPayload(`${label} is invalid`);
  }
  return value;
}

function normalizePayload(value: unknown): AiImageSuiteGenerationQueuePayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalidPayload('AI image suite generation queue payload is invalid');
  }
  const input = value as Record<string, unknown>;
  const attempt = input.attempt;
  if (!Number.isSafeInteger(attempt) || Number(attempt) < 1) {
    return invalidPayload('attempt is invalid');
  }
  return {
    suiteId: exactId(input.suiteId, 'suiteId'),
    slotId: exactId(input.slotId, 'slotId'),
    workflowId: exactId(input.workflowId, 'workflowId'),
    jobId: exactId(input.jobId, 'jobId'),
    attempt: Number(attempt),
  };
}

export function aiImageSuiteGenerationQueueJobId(
  value: AiImageSuiteGenerationQueuePayload,
): string {
  const payload = normalizePayload(value);
  const digest = createHash('sha256')
    .update(JSON.stringify([
      'ai-image-suite-generation/v1',
      payload.suiteId,
      payload.slotId,
      payload.workflowId,
      payload.jobId,
      payload.attempt,
    ]))
    .digest('hex');
  return `suite-generate-${digest}`;
}

export function aiImageSuiteGenerationRecoveryJobId(
  value: AiImageSuiteGenerationQueuePayload,
  bucket = Math.floor(Date.now() / AI_IMAGE_SUITE_GENERATION_RECOVERY_INTERVAL_MS),
): string {
  return `${aiImageSuiteGenerationQueueJobId(value)}-recover-${bucket}`;
}

function suiteLeaseKey(suiteId: string): string {
  const digest = createHash('sha256').update(suiteId).digest('hex');
  return `lease:ai-image-suite-generation:${digest}`;
}

async function acquireSuiteLease(suiteId: string, token: string): Promise<boolean> {
  if (redisDisabled) return true;
  return await redis.set(
    suiteLeaseKey(suiteId),
    token,
    'PX',
    AI_IMAGE_SUITE_GENERATION_LEASE_MS,
    'NX',
  ) === 'OK';
}

async function releaseSuiteLease(suiteId: string, token: string): Promise<void> {
  if (redisDisabled) return;
  await redis.eval(
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
    1,
    suiteLeaseKey(suiteId),
    token,
  );
}

function recoveryLeaseToken(value: string): string {
  if (typeof value !== 'string'
    || !value
    || value !== value.trim()
    || value.length > MAX_ID_LENGTH) {
    throw new TypeError('AI image suite generation recovery lease token is invalid');
  }
  return value;
}

export function createRedisAiImageSuiteGenerationRecoveryLease(options: {
  redis: AiImageSuiteGenerationRecoveryRedis;
  disabled?: boolean;
}): AiImageSuiteGenerationRecoveryLease {
  return {
    async acquire(value: string): Promise<boolean> {
      const token = recoveryLeaseToken(value);
      if (options.disabled) return true;
      const result = await options.redis.set(
        AI_IMAGE_SUITE_GENERATION_RECOVERY_LEASE_KEY,
        token,
        'PX',
        AI_IMAGE_SUITE_GENERATION_RECOVERY_LEASE_MS,
        'NX',
      );
      if (result === 'OK') return true;
      if (result == null) return false;
      throw new Error('AI image suite generation recovery lease returned an invalid acquire result');
    },
    async renew(value: string): Promise<boolean> {
      const token = recoveryLeaseToken(value);
      if (options.disabled) return true;
      const result = await options.redis.eval(
        RENEW_RECOVERY_LEASE_SCRIPT,
        1,
        AI_IMAGE_SUITE_GENERATION_RECOVERY_LEASE_KEY,
        token,
        AI_IMAGE_SUITE_GENERATION_RECOVERY_LEASE_MS,
      );
      return Number(result) === 1;
    },
    async release(value: string): Promise<void> {
      const token = recoveryLeaseToken(value);
      if (options.disabled) return;
      await options.redis.eval(
        RELEASE_RECOVERY_LEASE_SCRIPT,
        1,
        AI_IMAGE_SUITE_GENERATION_RECOVERY_LEASE_KEY,
        token,
      );
    },
  };
}

const aiImageSuiteGenerationRecoveryLease = createRedisAiImageSuiteGenerationRecoveryLease({
  redis,
  disabled: redisDisabled,
});

function duplicateQueueJob(error: unknown): boolean {
  return /job.*(?:already )?exists/iu.test(error instanceof Error ? error.message : String(error));
}

export async function enqueueAiImageSuiteGenerationJob(
  value: AiImageSuiteGenerationQueuePayload,
  overrides: EnqueueOverrides = {},
): Promise<void> {
  const payload = normalizePayload(value);
  const queue = overrides.queue === undefined
    ? aiImageSuiteGenerationQueue
    : overrides.queue;
  if (!queue) {
    throw new AiImageSuiteGenerationWorkerError(
      'AI_MEDIA_SUITE_GENERATION_QUEUE_UNAVAILABLE',
      'Redis is required for AI image suite generation',
    );
  }
  try {
    await queue.add(AI_IMAGE_SUITE_GENERATION_QUEUE_TASK_NAME, payload, {
      ...AI_IMAGE_SUITE_GENERATION_QUEUE_JOB_OPTIONS,
      jobId: aiImageSuiteGenerationQueueJobId(payload),
    });
  } catch (error) {
    if (!duplicateQueueJob(error)) throw error;
  }
}

export async function enqueueAiImageSuiteGenerationRecoveryJob(
  value: AiImageSuiteGenerationQueuePayload,
  overrides: EnqueueOverrides = {},
): Promise<void> {
  const payload = normalizePayload(value);
  const queue = overrides.queue === undefined
    ? aiImageSuiteGenerationQueue
    : overrides.queue;
  if (!queue) {
    throw new AiImageSuiteGenerationWorkerError(
      'AI_MEDIA_SUITE_GENERATION_QUEUE_UNAVAILABLE',
      'Redis is required for AI image suite generation recovery',
    );
  }
  try {
    await queue.add(AI_IMAGE_SUITE_GENERATION_QUEUE_TASK_NAME, payload, {
      ...AI_IMAGE_SUITE_GENERATION_QUEUE_JOB_OPTIONS,
      jobId: aiImageSuiteGenerationRecoveryJobId(payload),
    });
  } catch (error) {
    if (!duplicateQueueJob(error)) throw error;
  }
}

function runtimeFailure(
  claim: Extract<AiImageSuiteGenerationExecutionClaim, { kind: 'ready' }>,
  nodeEnv: string | undefined,
): AiImageSuiteGenerationRuntimeFailure | null {
  if (claim.provider !== 'fake' && claim.evidenceLevel !== 'sandbox-verified'
    && !hasAdmittedWanxAiImageSuiteOperation(claim)) {
    return {
      code: 'AI_MEDIA_SUITE_PAID_PROVIDER_NOT_VERIFIED',
      message: 'Paid AI image suite generation requires sandbox-verified Provider evidence',
    };
  }
  if (claim.provider === 'fake' && nodeEnv === 'production') {
    return {
      code: 'AI_MEDIA_SUITE_FAKE_PROVIDER_PRODUCTION_BLOCKED',
      message: 'The fake AI image suite Provider is disabled in production',
    };
  }
  return null;
}

function validateFrontier(
  suiteId: string,
  frontier: AiImageSuiteGenerationQueuePayload[] | undefined,
): AiImageSuiteGenerationQueuePayload[] {
  if (frontier === undefined) return [];
  if (!Array.isArray(frontier)) {
    throw new AiImageSuiteGenerationWorkerError(
      'AI_MEDIA_SUITE_GENERATION_INVALID_FRONTIER',
      'AI image suite generation frontier is invalid',
    );
  }
  if (frontier.length > AI_IMAGE_SUITE_MAX_CONCURRENCY) {
    throw new AiImageSuiteGenerationWorkerError(
      'AI_MEDIA_SUITE_GENERATION_INVALID_FRONTIER',
      'AI image suite generation frontier exceeds the bounded concurrency limit',
    );
  }
  return frontier.map((value) => {
    const payload = normalizePayload(value);
    if (payload.suiteId !== suiteId) {
      throw new AiImageSuiteGenerationWorkerError(
        'AI_MEDIA_SUITE_GENERATION_INVALID_FRONTIER',
        'AI image suite generation frontier crossed suite authority',
      );
    }
    return payload;
  });
}

export async function processAiImageSuiteGenerationQueueJob(
  value: AiImageSuiteGenerationQueuePayload,
  overrides: ProcessOverrides,
): Promise<'completed' | 'pending' | 'ignored'> {
  const payload = normalizePayload(value);
  const token = (overrides.createLeaseToken || randomUUID)();
  const acquireLease = overrides.acquireLease || acquireSuiteLease;
  const releaseLease = overrides.releaseLease || releaseSuiteLease;
  if (!await acquireLease(payload.suiteId, token)) {
    throw new AiImageSuiteGenerationWorkerError(
      'AI_MEDIA_SUITE_GENERATION_LEASE_BUSY',
      'AI image suite generation coordination lease is busy',
    );
  }
  let claim: AiImageSuiteGenerationExecutionClaim;
  try {
    claim = await overrides.coordinator.revalidateAndClaim(payload);
  } finally {
    try {
      await releaseLease(payload.suiteId, token);
    } catch (error) {
      // The persisted claim is fenced by the database; the short Redis lease may expire safely.
      console.error('[ai-image-suite] coordination lease release failed:', error);
    }
  }
  if (claim.kind === 'ignored') return 'ignored';

  const failure = claim.providerFacing
    ? runtimeFailure(
      claim,
      overrides.nodeEnv === undefined ? process.env.NODE_ENV : overrides.nodeEnv,
    )
    : null;
  if (failure) {
    await overrides.coordinator.rejectRuntimeGate(payload, claim, failure);
    throw new AiImageSuiteGenerationWorkerError(failure.code, failure.message);
  }

  const result = await overrides.coordinator.execute(payload, claim);
  const frontier = validateFrontier(payload.suiteId, result.frontier);
  const enqueue = overrides.enqueue || enqueueAiImageSuiteGenerationRecoveryJob;
  for (const next of frontier) await enqueue(next);
  return result.kind;
}

export async function enqueueRecoverableAiImageSuiteGenerationJobs(
  overrides: RecoveryOverrides,
): Promise<void> {
  const pageSize = overrides.pageSize ?? AI_IMAGE_SUITE_GENERATION_RECOVERY_PAGE_SIZE;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1_000) {
    throw new AiImageSuiteGenerationWorkerError(
      'AI_MEDIA_SUITE_GENERATION_INVALID_PAYLOAD',
      'AI image suite generation recovery page size is invalid',
    );
  }
  const enqueue = overrides.enqueue || enqueueAiImageSuiteGenerationRecoveryJob;
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  while (true) {
    await overrides.assertLeaseOwned?.();
    const page = await overrides.coordinator.scanRecoverable({ cursor, limit: pageSize });
    await overrides.assertLeaseOwned?.();
    for (const value of page.items) {
      await overrides.assertLeaseOwned?.();
      await enqueue(normalizePayload(value));
    }

    if (!page.nextCursor) {
      await overrides.assertLeaseOwned?.();
      return;
    }
    const nextCursor = exactId(page.nextCursor, 'recovery cursor');
    if (seenCursors.has(nextCursor)) {
      throw new AiImageSuiteGenerationWorkerError(
        'AI_MEDIA_SUITE_GENERATION_RECOVERY_CURSOR_LOOP',
        'AI image suite generation recovery cursor repeated',
      );
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
}

function recoveryLeaseLost(): AiImageSuiteGenerationWorkerError {
  return new AiImageSuiteGenerationWorkerError(
    'AI_MEDIA_SUITE_GENERATION_RECOVERY_LEASE_LOST',
    'AI image suite generation recovery lease ownership was lost',
  );
}

export function createAiImageSuiteGenerationRecoveryRunner(
  overrides: RecoveryRunnerOverrides,
): () => Promise<AiImageSuiteGenerationRecoveryRunResult> {
  const heartbeatMs = overrides.heartbeatMs
    ?? AI_IMAGE_SUITE_GENERATION_RECOVERY_HEARTBEAT_MS;
  if (!Number.isSafeInteger(heartbeatMs)
    || heartbeatMs < 100
    || heartbeatMs >= AI_IMAGE_SUITE_GENERATION_RECOVERY_LEASE_MS) {
    throw new TypeError('AI image suite generation recovery heartbeat is invalid');
  }
  const lease = overrides.lease || aiImageSuiteGenerationRecoveryLease;
  const createLeaseToken = overrides.createLeaseToken || randomUUID;
  const onLeaseReleaseError = overrides.onLeaseReleaseError || ((error: unknown) => {
    console.error('[ai-image-suite] recovery lease release failed:', error);
  });
  let inFlight = false;

  return async () => {
    if (inFlight) return 'skipped-local';
    inFlight = true;
    let acquired = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let token = '';
    let renewalFailure: AiImageSuiteGenerationWorkerError | null = null;
    let renewalChain: Promise<void> = Promise.resolve();
    try {
      token = recoveryLeaseToken(createLeaseToken());
      acquired = await lease.acquire(token);
      if (!acquired) return 'skipped-distributed';

      const queueRenewal = () => {
        renewalChain = renewalChain.then(async () => {
          if (renewalFailure) return;
          try {
            if (!await lease.renew(token)) renewalFailure = recoveryLeaseLost();
          } catch {
            renewalFailure = recoveryLeaseLost();
          }
        });
        return renewalChain;
      };
      const assertLeaseOwned = async () => {
        await renewalChain;
        if (renewalFailure) throw renewalFailure;
      };

      heartbeat = setInterval(() => void queueRenewal(), heartbeatMs);
      heartbeat.unref?.();
      await enqueueRecoverableAiImageSuiteGenerationJobs({
        coordinator: overrides.coordinator,
        enqueue: overrides.enqueue,
        pageSize: overrides.pageSize,
        assertLeaseOwned,
      });
      await queueRenewal();
      await assertLeaseOwned();
      return 'completed';
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      await renewalChain;
      if (acquired) {
        try {
          await lease.release(token);
        } catch (error) {
          // The token-safe TTL lease can expire without deleting a replacement owner.
          onLeaseReleaseError(error);
        }
      }
      inFlight = false;
    }
  };
}

export function startAiImageSuiteGenerationWorker(
  coordinator: AiImageSuiteGenerationCoordinator,
) {
  if (redisDisabled) return null;
  const worker = new Worker(
    AI_IMAGE_SUITE_GENERATION_QUEUE_NAME,
    async (job) => {
      await processAiImageSuiteGenerationQueueJob(job.data, { coordinator });
    },
    { connection, concurrency: 4 },
  );
  worker.on('failed', (job, error) => {
    console.error(`[ai-image-suite] job ${job?.id || 'unknown'} failed:`, error.message);
  });
  registerWorker(worker);
  const heartbeatToken = randomUUID();
  let heartbeatInFlight = false;
  const heartbeat = async () => {
    if (heartbeatInFlight || !worker.isRunning() || worker.isPaused()) return;
    heartbeatInFlight = true;
    try {
      const client = await worker.client;
      await recordAiImageSuiteWorkerHeartbeat(
        client as unknown as Pick<AiImageSuiteRuntimeRedis, 'set'>,
        heartbeatToken,
      );
    } catch (error) {
      console.error('[ai-image-suite] worker heartbeat failed:', error);
    } finally {
      heartbeatInFlight = false;
    }
  };
  worker.on('ready', () => void heartbeat());
  const heartbeatTimer = setInterval(
    () => void heartbeat(),
    AI_IMAGE_SUITE_WORKER_HEARTBEAT_INTERVAL_MS,
  );
  heartbeatTimer.unref();
  const runRecovery = createAiImageSuiteGenerationRecoveryRunner({ coordinator });
  const recover = () => runRecovery().catch((error) => {
    console.error('[ai-image-suite] recovery scan failed:', error);
  });
  void recover();
  const recoveryTimer = setInterval(() => void recover(), AI_IMAGE_SUITE_GENERATION_RECOVERY_INTERVAL_MS);
  recoveryTimer.unref();
  worker.on('closed', () => {
    clearInterval(recoveryTimer);
    clearInterval(heartbeatTimer);
    void clearAiImageSuiteWorkerHeartbeat(redis, heartbeatToken).catch((error) => {
      console.error('[ai-image-suite] worker heartbeat cleanup failed:', error);
    });
  });
  return worker;
}
