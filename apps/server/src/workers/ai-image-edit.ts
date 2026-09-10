import { randomUUID } from 'node:crypto';
import { Queue, Worker } from 'bullmq';
import sharp from 'sharp';
import { getConfig } from '../config/system-config-schema.js';
import {
  getAiImageEditProviderRuntimeConfig,
  type AiImageEditProviderRuntimeConfig,
} from '../services/ai-image-edit-runtime-config.js';
export { getAiImageEditProviderRuntimeConfig, type AiImageEditProviderRuntimeConfig };
import { connection } from '../lib/bullmq-connection.js';
import { prisma } from '../lib/prisma.js';
import { redis, redisDisabled } from '../lib/redis.js';
import { registerWorker } from '../lib/worker-registry.js';
import { PrismaAiImageJobRepository } from '../repositories/ai-image-job-repository.js';
import { getStorageBackend } from '../services/image-storage.js';
import { runAiImageEditJob } from '../services/ai-image-edit.js';
import {
  assertAiImageEditCostReservation,
  createAiImageEditDispatchFence,
} from '../services/ai-image-edit-dispatch.js';
import {
  loadAiImageEditInputBuffer,
  readBoundedAiImageEditFile,
  readBoundedAiImageEditStream,
} from '../services/ai-image-edit-input-reader.js';
import {
  createOpenAiImageEditProvider,
  withProviderSubmissionRejected,
  type BeforeAiImageProviderDispatch,
} from '../services/ai-image-providers.js';
import { createDashScopeWanx21ImageEditProvider } from '../services/ai-image-wanx-edit-provider.js';
import { isWanxHostedEdit, resolveAiImageEditProviderContract } from '../services/ai-image-edit-provider-contract.js';
import {
  hasExactAiMediaSandboxEvidence,
  resolveAiImageProviderCapability,
} from '../services/ai-image-provider-capabilities.js';
import {
  AiImageProviderRuntimeContractError,
  assertAiImageProviderRuntimeContract,
} from '../services/ai-image-provider-runtime-contract.js';
import {
  AiImageJobError,
  createDisabledAiImageProvider,
  type AiImageJobRecord,
  type AiImageJobRepository,
  type AiImageProvider,
} from '../services/ai-image-jobs.js';
import { getAiMediaRolloutDecision } from '../services/ai-media-rollout.js';

const QUEUE_NAME = 'ai-image-edit';
const EDIT_EXECUTION_LEASE_MS = 20_000;
const EDIT_EXECUTION_HEARTBEAT_MS = 5_000;
export const AI_IMAGE_EDIT_FAKE_PROVIDER_PRODUCTION_BLOCKED =
  'AI_IMAGE_EDIT_FAKE_PROVIDER_PRODUCTION_BLOCKED' as const;

type FrozenInputAsset = NonNullable<AiImageJobRecord['inputAssets']>[number];

export interface AiImageEditDispatchAuthorization {
  enabled: boolean;
  reasonCode: string;
  reason: string;
}

export interface AiImageEditProviderResolverDependencies {
  resolveCapability?: typeof resolveAiImageProviderCapability;
  createOpenAiEditProvider?: typeof createOpenAiImageEditProvider;
  createWanxEditProvider?: typeof createDashScopeWanx21ImageEditProvider;
  beforeProviderDispatch?: BeforeAiImageProviderDispatch;
}

type AiImageEditWorkerOverrides = {
  repository?: AiImageJobRepository;
  resolveProvider?: typeof resolveAiImageEditProvider;
  getProviderConfig?: typeof getAiImageEditProviderRuntimeConfig;
  getDispatchAuthorization?: typeof getAiImageEditDispatchAuthorization;
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

export async function getAiImageEditDispatchAuthorization(
  ownerUserId: string,
  operation: 'FULL_EDIT' | 'INPAINT',
  dependencies: {
    loadConfig?: typeof getConfig;
    getRolloutDecision?: typeof getAiMediaRolloutDecision;
  } = {},
): Promise<AiImageEditDispatchAuthorization> {
  const loadConfig = dependencies.loadConfig || getConfig;
  const featureKey = operation === 'INPAINT'
    ? 'feature_ai_media_inpaint' as const
    : 'feature_ai_media_full_edit' as const;
  const [generationEnabled, featureEnabled, rollout] = await Promise.all([
    loadConfig('ai_image_generation_enabled'),
    loadConfig(featureKey),
    (dependencies.getRolloutDecision || getAiMediaRolloutDecision)(ownerUserId),
  ]);
  if (!generationEnabled) {
    return {
      enabled: false,
      reasonCode: 'master_off',
      reason: 'AI image generation was disabled before Provider dispatch',
    };
  }
  if (!rollout.enabled) {
    return {
      enabled: false,
      reasonCode: rollout.reason,
      reason: 'AI media rollout was revoked before Provider dispatch',
    };
  }
  if (!featureEnabled) {
    return {
      enabled: false,
      reasonCode: 'feature_off',
      reason: `${operation} was disabled before Provider dispatch`,
    };
  }
  return {
    enabled: true,
    reasonCode: rollout.reason,
    reason: 'AI image edit dispatch is authorized',
  };
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
  operation: 'FULL_EDIT' | 'INPAINT',
  config: AiImageEditProviderRuntimeConfig,
  onProviderJobCreated?: (providerJobId: string, providerAcceptedAt: Date) => Promise<void>,
  nodeEnv = process.env.NODE_ENV,
  dependencies: AiImageEditProviderResolverDependencies = {},
): AiImageProvider {
  assertAiImageEditProviderRuntime(provider, nodeEnv);
  if (provider === 'fake') {
    if (model !== 'fake-image-edit-v1') return createDisabledAiImageProvider();
    return {
      name: 'fake',
      async generate(request) {
        if (
          request.operation !== operation
          || request.model !== 'fake-image-edit-v1'
          || request.count !== 1
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
  const contract = resolveAiImageEditProviderContract(provider, model, config.baseUrl);
  if (
    !contract
    || provider !== config.provider
    || model !== config.model
    || !config.apiKey.trim()
    || config.costPerImageCents <= 0
  ) {
    return createDisabledAiImageProvider();
  }
  const capability = (dependencies.resolveCapability || resolveAiImageProviderCapability)(
    provider,
    model,
  );
  if (!hasExactAiMediaSandboxEvidence({
    capability,
    provider,
    model,
    baseUrl: config.baseUrl,
    operation,
    inputTransport: contract.inputTransport,
    resultMode: contract.resultMode,
  })) {
    return createDisabledAiImageProvider();
  }
  const createEditProvider = contract.kind === 'wanx21'
    ? dependencies.createWanxEditProvider || createDashScopeWanx21ImageEditProvider
    : dependencies.createOpenAiEditProvider || createOpenAiImageEditProvider;
  const editProvider = createEditProvider({
    baseUrl: contract.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
    costPerImageCents: config.costPerImageCents,
    onProviderJobCreated,
    beforeProviderDispatch: dependencies.beforeProviderDispatch,
  });
  return {
    name: provider,
    async generate(request) {
      if (
        request.operation !== operation
        || request.model !== model
        || request.count !== 1
        || request.inputImages?.length !== 1
        || (operation === 'INPAINT' ? !request.mask : Boolean(request.mask))
      ) {
        throw withProviderSubmissionRejected(new AiImageJobError(
          'INVALID_MEDIA_INPUT',
          'Image edit request does not match its frozen runtime inputs',
        ));
      }
      return editProvider.edit({
        operation,
        prompt: request.prompt,
        negativePrompt: request.negativePrompt,
        width: request.width,
        height: request.height,
        model: request.model,
        images: request.inputImages,
        mask: request.mask ?? null,
      });
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
  const assertExecutionLease = () => {
    if (leaseLost) {
      throw new AiImageJobError('EDIT_EXECUTION_LEASE_LOST', 'AI image edit execution lease was lost');
    }
  };
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
        'An interrupted image edit requires reconciliation before another invocation',
      );
      await repository.markFailed(job.id, {
        attemptCount: isWanxHostedEdit(job.provider, job.model)
          ? job.attemptCount : Math.max(job.attemptCount, attemptNumber),
        errorCode: interrupted.code,
        errorMessage: interrupted.message,
      });
      throw interrupted;
    }
    const failBeforeDispatch = async (errorCode: string, errorMessage: string) => {
      const details = { attemptCount: attemptNumber, errorCode, errorMessage };
      if (repository.markEnqueueFailed) {
        const failed = await repository.markEnqueueFailed(jobId, details);
        if (!failed) {
          const latest = await repository.getById(jobId);
          if (latest?.status === 'CANCEL_REQUESTED' || latest?.status === 'CANCELLED') {
            await repository.markCancelled(jobId);
          }
        }
      } else {
        await repository.markFailed(jobId, details);
      }
    };
    const paidJob = job.provider !== 'fake';
    if (paidJob) {
      if (job.operation !== 'FULL_EDIT' && job.operation !== 'INPAINT') {
        await failBeforeDispatch('UNSUPPORTED_OPERATION', 'Queued AI image edit operation is invalid');
        return 'ignored' as const;
      }
      const authorization = await (
        overrides.getDispatchAuthorization || getAiImageEditDispatchAuthorization
      )(job.ownerUserId, job.operation);
      if (!authorization.enabled) {
        await failBeforeDispatch('AI_IMAGE_EDIT_DISPATCH_REVOKED', authorization.reason);
        return 'ignored' as const;
      }
      try {
        assertAiImageEditCostReservation(job);
      } catch (error) {
        if (!(error instanceof AiImageJobError)) throw error;
        await failBeforeDispatch(error.code, error.message);
        return 'ignored' as const;
      }
    }
    let provider: AiImageProvider;
    let uploadBuffer: (...args: any[]) => Promise<any>;
    try {
      const providerConfig = await (
        overrides.getProviderConfig || getAiImageEditProviderRuntimeConfig
      )();
      if (paidJob) {
        const operationConfig = job.operationConfig && typeof job.operationConfig === 'object'
          ? job.operationConfig
          : {};
        try {
          assertAiImageProviderRuntimeContract(
            operationConfig.providerRuntime,
            providerConfig,
            {
              count: 1,
              width: job.width,
              height: job.height,
              estimatedCostCents: job.estimatedCostCents,
            },
          );
        } catch (error) {
          if (error instanceof AiImageProviderRuntimeContractError) {
            await failBeforeDispatch(error.code, error.message);
            return 'ignored' as const;
          }
          throw error;
        }
      }
      const onProviderJobCreated = repository.recordProviderJobId
        ? (providerJobId: string, providerAcceptedAt: Date) => repository.recordProviderJobId!(
          jobId,
          providerJobId,
          providerAcceptedAt,
        )
        : undefined;
      const beforeProviderDispatch = paidJob
        ? createAiImageEditDispatchFence({ job, attemptNumber, providerConfig }, {
          loadJob: () => repository.getById(jobId),
          loadProviderConfig: overrides.getProviderConfig || getAiImageEditProviderRuntimeConfig,
          loadAuthorization: () => (
            overrides.getDispatchAuthorization || getAiImageEditDispatchAuthorization
          )(job.ownerUserId, job.operation as 'FULL_EDIT' | 'INPAINT'),
          assertExecutionLease,
          renewExecutionLease: () => renewLease(jobId, token),
        })
        : undefined;
      provider = (overrides.resolveProvider || resolveAiImageEditProvider)(
        job.provider,
        job.model,
        job.operation as 'FULL_EDIT' | 'INPAINT',
        providerConfig,
        onProviderJobCreated,
        nodeEnv,
        { beforeProviderDispatch },
      );
      const storage = overrides.uploadBuffer ? null : await getStorageBackend();
      uploadBuffer = overrides.uploadBuffer || storage!.uploadBuffer.bind(storage);
    } catch (error) {
      const details = {
        attemptCount: attemptNumber,
        errorCode: 'WORKER_SETUP_FAILED',
        errorMessage: 'AI image edit worker setup failed before Provider execution',
      };
      await failBeforeDispatch(details.errorCode, details.errorMessage);
      throw error;
    }
    return await (overrides.run || runAiImageEditJob)(jobId, attemptNumber, {
      repository,
      provider,
      uploadBuffer,
      loadInputBuffer: overrides.loadInputBuffer || loadAiImageEditInputBuffer,
      assertExecutionLease,
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
