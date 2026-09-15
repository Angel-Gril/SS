import { Queue, Worker } from 'bullmq';
import { getConfig } from '../config/system-config-schema.js';
import { connection } from '../lib/bullmq-connection.js';
import { prisma } from '../lib/prisma.js';
import { redisDisabled } from '../lib/redis.js';
import { registerWorker } from '../lib/worker-registry.js';
import { PrismaAiImageJobRepository } from '../repositories/ai-image-job-repository.js';
import { loadAiImageEditInputBuffer } from '../services/ai-image-edit-input-reader.js';
import { getStorageBackend } from '../services/image-storage.js';
import {
  createDashScopeWanxProvider,
  createOpenAiImageEditProvider,
  createOpenAiImagesProvider,
} from '../services/ai-image-providers.js';
import {
  resolveAiImageProviderCapability,
} from '../services/ai-image-provider-capabilities.js';
import { canRunAiImageProviderOperation } from '../services/ai-image-provider-admission.js';
import {
  AiImageProviderRuntimeContractError,
  bindAiImageProviderExecutionConfig,
  type AiImageProviderRuntimeIdentity,
} from '../services/ai-image-provider-runtime-contract.js';
import {
  AiImageJobError,
  createDisabledAiImageProvider,
  createFakeAiImageProvider,
  runAiImageJob,
  type AiImageJobRepository,
  type AiImageProvider,
} from '../services/ai-image-jobs.js';
import { getAiMediaRolloutDecision } from '../services/ai-media-rollout.js';

const QUEUE_NAME = 'ai-image-generation';
const fakePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2S8AAAAASUVORK5CYII=', 'base64');

export const aiImageGenerationQueue: Queue | null = redisDisabled ? null : new Queue(QUEUE_NAME, { connection });
export const AI_IMAGE_QUEUE_JOB_OPTIONS = {
  attempts: 2,
  backoff: { type: 'fixed', delay: 1_000 },
  removeOnComplete: 100,
  removeOnFail: 500,
} as const;

export interface AiImageProviderRuntimeConfig extends AiImageProviderRuntimeIdentity {
  apiKey: string;
}

export interface AiImageDispatchAuthorization {
  enabled: boolean;
  reasonCode: string;
  reason: string;
}

export async function getAiImageDispatchAuthorization(
  ownerUserId: string,
  operation: 'TEXT_TO_IMAGE' | 'IMAGE_TO_IMAGE' = 'TEXT_TO_IMAGE',
): Promise<AiImageDispatchAuthorization> {
  const [generationEnabled, rollout, operationEnabled] = await Promise.all([
    getConfig('ai_image_generation_enabled'),
    getAiMediaRolloutDecision(ownerUserId),
    operation === 'IMAGE_TO_IMAGE' ? getConfig('feature_ai_media_image_to_image') : Promise.resolve(true),
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
  if (!operationEnabled) {
    return {
      enabled: false,
      reasonCode: 'feature_off',
      reason: 'Reference image generation was disabled before Provider dispatch',
    };
  }
  return {
    enabled: true,
    reasonCode: rollout.reason,
    reason: 'AI image dispatch is authorized',
  };
}

export async function getAiImageProviderRuntimeConfig(): Promise<AiImageProviderRuntimeConfig> {
  const [provider, baseUrl, apiKey, model, costPerImageCents] = await Promise.all([
    getConfig('ai_image_provider'), getConfig('ai_image_base_url'),
    getConfig('ai_image_api_key'), getConfig('ai_image_model'),
    getConfig('ai_image_generation_cost_cents'),
  ]);
  return { provider, baseUrl, apiKey, model, costPerImageCents,
    ...(provider === 'dashscope-wanx' ? { currency: 'CNY' as const } : {}) };
}

export interface AiImageProviderResolverDependencies {
  resolveCapability?: typeof resolveAiImageProviderCapability;
  createOpenAiGenerationProvider?: typeof createOpenAiImagesProvider;
  createOpenAiEditProvider?: typeof createOpenAiImageEditProvider;
}

export function resolveAiImageProvider(
  provider: string,
  config: AiImageProviderRuntimeConfig,
  onProviderJobCreated?: (providerJobId: string, providerAcceptedAt: Date) => Promise<void>,
  dependencies: AiImageProviderResolverDependencies = {},
): AiImageProvider {
  if (provider === 'fake') {
    return createFakeAiImageProvider({ images: [{ buffer: fakePng, mimeType: 'image/png' }], actualCostCents: 0 });
  }
  if (provider !== config.provider || !config.apiKey.trim() || !config.model.trim()) return createDisabledAiImageProvider();
  const capability = (dependencies.resolveCapability || resolveAiImageProviderCapability)(
    provider,
    config.model,
  );
  if (!capability || config.costPerImageCents <= 0) {
    return createDisabledAiImageProvider();
  }
  const options = { baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model, costPerImageCents: config.costPerImageCents, onProviderJobCreated };
  if (provider === 'dashscope-wanx') {
    if (!canRunAiImageProviderOperation({
      capability,
      provider,
      model: config.model,
      baseUrl: config.baseUrl,
      operation: 'TEXT_TO_IMAGE',
      inputTransport: 'none',
      resultMode: 'async',
    })) return createDisabledAiImageProvider();
    return createDashScopeWanxProvider(options);
  }
  if (provider === 'openai-images' || provider === 'custom') {
    const operationReady = (operation: Parameters<AiImageProvider['generate']>[0]['operation']) => canRunAiImageProviderOperation({
      capability, provider, model: config.model, baseUrl: config.baseUrl,
      operation: operation || 'TEXT_TO_IMAGE',
      inputTransport: !operation || operation === 'TEXT_TO_IMAGE' ? 'none' : 'multipart',
      resultMode: 'sync',
    });
    if (!operationReady('TEXT_TO_IMAGE') && !operationReady('IMAGE_TO_IMAGE')) return createDisabledAiImageProvider();
    const generation = (
      dependencies.createOpenAiGenerationProvider || createOpenAiImagesProvider
    )(options);
    const edit = (
      dependencies.createOpenAiEditProvider || createOpenAiImageEditProvider
    )(options);
    const assertReady = (request: Parameters<AiImageProvider['generate']>[0]) => {
      const operation = request.operation || 'TEXT_TO_IMAGE';
      if (!operationReady(operation)) {
        throw new AiImageJobError(
          'PROVIDER_NOT_READY',
          `OpenAI ${operation} endpoint or request protocol is not supported`,
        );
      }
    };
    return {
      name: provider,
      assertReady,
      async generate(request) {
        const operation = request.operation || 'TEXT_TO_IMAGE';
        assertReady(request);
        if (operation === 'TEXT_TO_IMAGE') return generation.generate(request);
        if (operation !== 'IMAGE_TO_IMAGE') {
          throw new AiImageJobError(
            'UNSUPPORTED_OPERATION',
            `OpenAI ${operation} must run through its operation-specific worker`,
          );
        }
        if (!request.inputImages?.length) {
          throw new AiImageJobError(
            'INVALID_MEDIA_INPUT',
            'OpenAI IMAGE_TO_IMAGE requires trusted runtime image bytes',
          );
        }
        return edit.edit({
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
  return createDisabledAiImageProvider();
}

export async function processAiImageQueueJob(
  jobId: string,
  attemptNumber: number,
  overrides: {
    repository?: AiImageJobRepository;
    resolveProvider?: typeof resolveAiImageProvider;
    getProviderConfig?: typeof getAiImageProviderRuntimeConfig;
    getDispatchAuthorization?: typeof getAiImageDispatchAuthorization;
    loadInputBuffer?: typeof loadAiImageEditInputBuffer;
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
  const failBeforeDispatch = async (errorCode: string, errorMessage: string) => {
    const failure = { attemptCount: attemptNumber, errorCode, errorMessage };
    if (repository.markEnqueueFailed) {
      const failed = await repository.markEnqueueFailed(jobId, failure);
      if (!failed) {
        const latest = await repository.getById(jobId);
        if (latest?.status === 'CANCEL_REQUESTED' || latest?.status === 'CANCELLED') {
          await repository.markCancelled(jobId);
        }
      }
    } else {
      await repository.markFailed(jobId, failure);
    }
  };
  const paidJob = persisted.provider !== 'fake';
  if (paidJob) {
    const authorization = await (
      overrides.getDispatchAuthorization || getAiImageDispatchAuthorization
    )(persisted.ownerUserId, persisted.operation === 'IMAGE_TO_IMAGE' ? 'IMAGE_TO_IMAGE' : 'TEXT_TO_IMAGE');
    if (!authorization.enabled) {
      await failBeforeDispatch('AI_IMAGE_DISPATCH_REVOKED', authorization.reason);
      return;
    }
    const reservation = (persisted as typeof persisted & {
      costReservation?: {
        status?: unknown;
        provider?: unknown;
        model?: unknown;
        estimatedCostMinor?: unknown;
        maximumCostMinor?: unknown;
      } | null;
    }).costReservation;
    if (!reservation
      || reservation.status !== 'RESERVED'
      || reservation.provider !== persisted.provider
      || reservation.model !== persisted.model
      || Number(reservation.estimatedCostMinor) !== persisted.estimatedCostCents
      || Number(reservation.maximumCostMinor) !== persisted.estimatedCostCents) {
      await failBeforeDispatch(
        'AI_IMAGE_COST_RESERVATION_REQUIRED',
        'Paid AI image dispatch requires an exact RESERVED cost reservation',
      );
      return;
    }
  }
  let providerConfig: AiImageProviderRuntimeConfig;
  let provider;
  let uploadBuffer: (...args: any[]) => Promise<any>;
  try {
    providerConfig = await (overrides.getProviderConfig || getAiImageProviderRuntimeConfig)();
    if (paidJob) {
      try {
        providerConfig = bindAiImageProviderExecutionConfig(
          persisted.operationConfig,
          providerConfig,
          {
            count: persisted.requestedImageCount,
            width: persisted.width,
            height: persisted.height,
            estimatedCostCents: persisted.estimatedCostCents,
          },
        );
      } catch (error) {
        if (error instanceof AiImageProviderRuntimeContractError) {
          await failBeforeDispatch(error.code, error.message);
          return;
        }
        throw error;
      }
    }
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
    await failBeforeDispatch(failure.errorCode, failure.errorMessage);
    throw error;
  }
  await (overrides.run || runAiImageJob)(jobId, attemptNumber, {
    repository,
    provider,
    loadInputBuffer: overrides.loadInputBuffer || loadAiImageEditInputBuffer,
    uploadBuffer,
    maxAttempts: 1,
  });
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
