import { Queue, Worker } from 'bullmq';
import {isDonorGpt2SuiteProvider} from '../services/ai-image-donor-gpt2-profile.js';
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
  createGptImage2CountGenerationProvider,
  createGptImage2CountEditProvider,
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
import { createDashScopeWanx21ImageEditProvider } from '../services/ai-image-wanx-edit-provider.js';
import { assertWanxImageToImageInput } from '../services/ai-image-wanx-image-to-image.js';
import { isGptImage2CountHostedProvider, isWanxHostedEdit, resolveAiImageEditProviderContract } from '../services/ai-image-edit-provider-contract.js';
import { isGptImage2CountOrdinarySizeSupported } from '../services/ai-image-gpt2-count-profile.js';
import { getFrozenAiImageTaskPrice } from '../services/ai-image-task-cost.js';
import { getAiImageOperationProviderRuntimeConfig } from '../services/ai-image-operation-runtime-config.js';
import { assertFrozenWanxImageToImageJob } from '../services/ai-image-wanx-image-to-image.js';

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

export async function getAiImageProviderRuntimeConfig(
  operation: 'TEXT_TO_IMAGE' | 'IMAGE_TO_IMAGE' = 'TEXT_TO_IMAGE',
): Promise<AiImageProviderRuntimeConfig> {
  return getAiImageOperationProviderRuntimeConfig(operation);
}

export interface AiImageProviderResolverDependencies {
  resolveCapability?: typeof resolveAiImageProviderCapability;
  createOpenAiGenerationProvider?: typeof createOpenAiImagesProvider;
  createOpenAiEditProvider?: typeof createOpenAiImageEditProvider;
  createCountGenerationProvider?: typeof createGptImage2CountGenerationProvider;
  createCountEditProvider?: typeof createGptImage2CountEditProvider;
  createWanxEditProvider?: typeof createDashScopeWanx21ImageEditProvider;
  beforeProviderDispatch?: () => Promise<void>;
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
    if (isWanxHostedEdit(provider, config.model)) {
      if (!canRunAiImageProviderOperation({ capability, provider, model: config.model, baseUrl: config.baseUrl,
        operation: 'IMAGE_TO_IMAGE', inputTransport: 'base64', resultMode: 'async' })) return createDisabledAiImageProvider();
      const edit = (dependencies.createWanxEditProvider || createDashScopeWanx21ImageEditProvider)({
        ...options, beforeProviderDispatch: dependencies.beforeProviderDispatch,
      });
      const assertReady = (request: Parameters<AiImageProvider['generate']>[0]) => {
        if (request.operation !== 'IMAGE_TO_IMAGE') {
          throw new AiImageJobError('UNSUPPORTED_OPERATION', 'Wanx reference worker only accepts IMAGE_TO_IMAGE');
        }
        return assertWanxImageToImageInput({ ...request, referenceCount: request.inputImages?.length || 0 });
      };
      return {
        name: provider,
        assertReady: (request) => { assertReady(request); },
        async generate(request) {
          const compiled = assertReady(request);
          return edit.edit({
            operation: 'IMAGE_TO_IMAGE', prompt: compiled.resolvedPrompt, negativePrompt: null,
            width: request.width, height: request.height, model: request.model,
            images: request.inputImages!, mask: null,
          });
        },
      };
    }
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
    const countProvider = isGptImage2CountHostedProvider(provider, config.model);
    if (countProvider && !resolveAiImageEditProviderContract(provider, config.model, config.baseUrl)) {
      return createDisabledAiImageProvider();
    }
    const operationReady = (operation: Parameters<AiImageProvider['generate']>[0]['operation']) =>
      !(operation==='IMAGE_TO_IMAGE' && isDonorGpt2SuiteProvider(provider,config.model) && !countProvider) && canRunAiImageProviderOperation({
      capability:(dependencies.resolveCapability || resolveAiImageProviderCapability)(provider,config.model,operation||'TEXT_TO_IMAGE'),
      provider, model: config.model, baseUrl: config.baseUrl,
      operation: operation || 'TEXT_TO_IMAGE',
      inputTransport: !operation || operation === 'TEXT_TO_IMAGE' ? 'none' : 'multipart',
      resultMode: 'sync',
    });
    if (!operationReady('TEXT_TO_IMAGE') && !operationReady('IMAGE_TO_IMAGE')) return createDisabledAiImageProvider();
    const ordinaryOptions = { ...options, beforeProviderDispatch: dependencies.beforeProviderDispatch };
    const generation = countProvider
      ? (dependencies.createCountGenerationProvider || createGptImage2CountGenerationProvider)(ordinaryOptions)
      : (dependencies.createOpenAiGenerationProvider || createOpenAiImagesProvider)(options);
    const edit = countProvider
      ? (dependencies.createCountEditProvider || createGptImage2CountEditProvider)(ordinaryOptions)
      : (dependencies.createOpenAiEditProvider || createOpenAiImageEditProvider)(options);
    const assertReady = (request: Parameters<AiImageProvider['generate']>[0]) => {
      const operation = request.operation || 'TEXT_TO_IMAGE';
      if (!operationReady(operation)) {
        throw new AiImageJobError(
          'PROVIDER_NOT_READY',
          `OpenAI ${operation} endpoint or request protocol is not supported`,
        );
      }
      if (countProvider && (request.model !== config.model || request.count !== 1
        || !isGptImage2CountOrdinarySizeSupported(request.width, request.height)
        || (operation === 'IMAGE_TO_IMAGE' ? request.inputImages?.length !== 1 || Boolean(request.mask)
          : Boolean(request.inputImages?.length || request.mask)))) {
        throw new AiImageJobError('INVALID_MEDIA_INPUT', 'GPT Image 2 count request must match its one-image ordinary operation contract');
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
    const operation = persisted.operation === 'IMAGE_TO_IMAGE' ? 'IMAGE_TO_IMAGE' : 'TEXT_TO_IMAGE';
    providerConfig = await (overrides.getProviderConfig || getAiImageProviderRuntimeConfig)(operation);
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
    const countProvider = isGptImage2CountHostedProvider(persisted.provider, persisted.model);
    if (paidJob && countProvider && persisted.costReservation?.currency !== getFrozenAiImageTaskPrice({ ...persisted, costReservation: undefined }).currency) {
      await failBeforeDispatch('AI_IMAGE_COST_RESERVATION_REQUIRED', 'Paid count generation requires the exact frozen reservation currency');
      return;
    }
    const beforeProviderDispatch = countProvider || (operation === 'IMAGE_TO_IMAGE' && isWanxHostedEdit(persisted.provider, persisted.model))
      ? async () => {
        const [currentConfig, authorization, currentJob] = await Promise.all([
          (overrides.getProviderConfig || getAiImageProviderRuntimeConfig)(operation),
          (overrides.getDispatchAuthorization || getAiImageDispatchAuthorization)(persisted.ownerUserId, operation),
          repository.getById(jobId),
        ]);
        if (!authorization.enabled || !currentJob || currentJob.status !== 'RUNNING'
          || currentJob.requestFingerprint !== persisted.requestFingerprint) {
          throw new AiImageJobError('AI_IMAGE_DISPATCH_REVOKED', 'Reference generation authority changed before Provider dispatch');
        }
        if (!countProvider) assertFrozenWanxImageToImageJob(currentJob);
        if (countProvider && (currentJob.provider !== persisted.provider || currentJob.model !== persisted.model
          || currentJob.operation !== persisted.operation || currentJob.width !== persisted.width || currentJob.height !== persisted.height
          || currentJob.requestedImageCount !== 1 || currentJob.costReservation?.status !== 'RESERVED'
          || currentJob.costReservation.currency !== getFrozenAiImageTaskPrice(currentJob).currency
          || Number(currentJob.costReservation.estimatedCostMinor) !== persisted.estimatedCostCents
          || Number(currentJob.costReservation.maximumCostMinor) !== persisted.estimatedCostCents)) {
          throw new AiImageJobError('AI_IMAGE_DISPATCH_REVOKED', 'Count generation inputs or frozen reservation changed before Provider dispatch');
        }
        bindAiImageProviderExecutionConfig(persisted.operationConfig, currentConfig, {
          count: persisted.requestedImageCount, width: persisted.width, height: persisted.height,
          estimatedCostCents: persisted.estimatedCostCents,
        });
      } : undefined;
    provider = beforeProviderDispatch
      ? (overrides.resolveProvider || resolveAiImageProvider)(persisted.provider, providerConfig, onProviderJobCreated, { beforeProviderDispatch })
      : (overrides.resolveProvider || resolveAiImageProvider)(persisted.provider, providerConfig, onProviderJobCreated);
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
