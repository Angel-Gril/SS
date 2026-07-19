import { describe, expect, it, vi } from 'vitest';
import { Job } from 'bullmq';
import type { AiImageTranslationProvider } from '../services/ai-image-translation.js';
import { AiImageJobError, type AiImageJobRecord, type AiImageJobRepository } from '../services/ai-image-jobs.js';
import { AiCostLedgerError } from '../services/ai-cost-ledger.js';
import {
  AI_IMAGE_TRANSLATION_QUEUE_JOB_OPTIONS,
  aiImageTranslationPollJobId,
  aiImageTranslationQueueJobId,
  processAiImageTranslationQueueJob,
} from '../workers/ai-image-translation.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2S8AAAAASUVORK5CYII=',
  'base64',
);

function job(status: AiImageJobRecord['status'], providerJobId: string | null): AiImageJobRecord {
  return {
    id: 'translation-job-1', ownerUserId: 'owner-1', actorUserId: 'actor-1',
    operation: 'IMAGE_TRANSLATE', operationConfig: {
      sourceLanguage: 'zh', targetLanguage: 'ru', domainHint: 'Frozen translation policy',
      terminologies: [], imageSegment: false, policyVersion: 'ai-image-translation-policy/1.0',
    },
    status, provider: 'fake', model: 'fake-image-translation-v1', providerJobId,
    providerDispatchedAt: providerJobId ? new Date() : null, prompt: 'Translate', negativePrompt: null,
    requestedImageCount: 1, width: 1024, height: 1024, attemptCount: 1, maxAttempts: 3,
    idempotencyKey: 'translation-idem-1', estimatedCostCents: 0,
    actualCostCents: null, billedUnits: 0, errorCode: null, errorMessage: null,
    inputAssets: [{
      assetId: 'asset-1', role: 'REFERENCE', ordinal: 0,
      url: 'https://owned.example/source.png', mimeType: 'image/png', sha256: 'a'.repeat(64),
    }],
  };
}

function repositoryState(initial: AiImageJobRecord) {
  let current = structuredClone(initial);
  const repository = {
    getById: vi.fn(async () => structuredClone(current)),
    markRunning: vi.fn(async (_id: string, attemptCount: number) => {
      if (!['PENDING', 'QUEUED', 'RETRYING'].includes(current.status)) return false;
      current = { ...current, status: 'RUNNING', attemptCount };
      return true;
    }),
    markRetrying: vi.fn(),
    markFailed: vi.fn(async (_id: string, data: any) => {
      current = { ...current, status: 'FAILED', errorCode: data.errorCode, errorMessage: data.errorMessage };
    }),
    markCancelled: vi.fn(async () => { current = { ...current, status: 'CANCELLED' }; }),
    markSubmissionUncertain: vi.fn(async (_id: string, data: any) => {
      current = { ...current, status: 'FAILED', errorCode: data.errorCode };
    }),
    recordProviderDispatchStarted: vi.fn(async (_id: string, dispatchedAt: Date) => {
      current = { ...current, providerDispatchedAt: dispatchedAt };
      return true;
    }),
    recordProviderJobId: vi.fn(async (_id: string, taskId: string) => {
      current = { ...current, providerJobId: taskId };
    }),
    complete: vi.fn(async (_id: string, data: any) => {
      current = { ...current, status: 'SUCCEEDED', providerJobId: data.providerJobId, billedUnits: 1 };
    }),
    createWithQuota: vi.fn(), requestCancellation: vi.fn(), recordApplication: vi.fn(),
  } as unknown as AiImageJobRepository;
  return { repository, current: () => current };
}

const runtimeConfig = async () => ({
  enabled: true,
  provider: 'fake', baseUrl: '', apiKey: '', model: 'fake-image-translation-v1', costPerImageCents: 0,
});

describe('AI image translation worker recovery', () => {
  it('uses custom queue IDs accepted by BullMQ for dispatch and polling', () => {
    class ValidatingJob extends Job {
      validate() {
        this.validateOptions(this.asJSON());
      }
    }
    const queue = {
      keys: {},
      client: Promise.resolve({}),
      redisVersion: '7.0.0',
      toKey: (key: string) => key,
      opts: {},
      closing: Promise.resolve(),
      databaseType: 'redis',
      qualifiedName: 'bull:ai-image-translation',
    } as any;
    const ids = [
      aiImageTranslationQueueJobId('translation-job-1'),
      aiImageTranslationPollJobId('translation-job-1', 1_234_567),
    ];

    for (const jobId of ids) {
      const candidate = new ValidatingJob(queue, 'translate', {}, {
        ...AI_IMAGE_TRANSLATION_QUEUE_JOB_OPTIONS,
        jobId,
      });
      expect(() => candidate.validate()).not.toThrow();
      expect(jobId).not.toContain(':');
    }
  });

  it('fails queued work without dispatch when the operation switch is disabled', async () => {
    const state = repositoryState(job('QUEUED', null));
    const provider: AiImageTranslationProvider = {
      name: 'fake', submit: vi.fn(), poll: vi.fn(),
    };
    await expect(processAiImageTranslationQueueJob('translation-job-1', 1, {
      repository: state.repository,
      getProviderConfig: async () => ({ ...await runtimeConfig(), enabled: false }),
      resolveProvider: () => provider,
      uploadBuffer: vi.fn(),
      schedulePoll: vi.fn(),
    })).rejects.toMatchObject({ code: 'AI_MEDIA_OPERATION_DISABLED' });
    expect(provider.submit).not.toHaveBeenCalled();
    expect(provider.poll).not.toHaveBeenCalled();
    expect(state.current().status).toBe('FAILED');
  });

  it('fails closed when the frozen model differs from current configuration', async () => {
    const state = repositoryState(job('QUEUED', null));
    const provider: AiImageTranslationProvider = { name: 'fake', submit: vi.fn(), poll: vi.fn() };
    await expect(processAiImageTranslationQueueJob('translation-job-1', 1, {
      repository: state.repository,
      getProviderConfig: async () => ({ ...await runtimeConfig(), model: 'different-model' }),
      resolveProvider: () => provider,
      uploadBuffer: vi.fn(),
      schedulePoll: vi.fn(),
    })).rejects.toMatchObject({ code: 'PROVIDER_CONFIG_CHANGED' });
    expect(provider.submit).not.toHaveBeenCalled();
  });

  it('fails paid work before dispatch when storage has no public HTTPS owned transport', async () => {
    const paidJob = {
      ...job('QUEUED', null),
      provider: 'dashscope-qwen-mt-image',
      model: 'qwen-mt-image',
      estimatedCostCents: 10,
    };
    const state = repositoryState(paidJob);
    const provider: AiImageTranslationProvider = {
      name: 'dashscope-qwen-mt-image', submit: vi.fn(), poll: vi.fn(),
    };

    await expect(processAiImageTranslationQueueJob('translation-job-1', 1, {
      repository: state.repository,
      getProviderConfig: async () => ({
        enabled: true,
        provider: 'dashscope-qwen-mt-image',
        baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
        apiKey: 'test-only-key',
        model: 'qwen-mt-image',
        costPerImageCents: 10,
      }),
      getStorageConfig: async () => ({
        source: 'system-config',
        mode: 'local',
        imageStorage: 'oss',
        authSource: 'cookie',
        extensionSync: 'direct',
        oss: {
          endpoint: 'https://storage.example.com',
          bucket: 'media',
          accessKeyId: 'key',
          accessKeySecret: 'secret',
          region: 'auto',
        },
        ozonCdnRelayUrl: undefined,
        ossFallbackToCdn: false,
        localBaseUrl: 'http://localhost:3001',
      }),
      resolveProvider: () => provider,
      schedulePoll: vi.fn(),
    })).rejects.toMatchObject({ code: 'STORAGE_NOT_READY' });

    expect(provider.submit).not.toHaveBeenCalled();
    expect(provider.poll).not.toHaveBeenCalled();
    expect(state.current()).toMatchObject({ status: 'FAILED', errorCode: 'STORAGE_NOT_READY' });
  });

  it('fails paid work before dispatch when its frozen source URL is private', async () => {
    const paidJob = {
      ...job('QUEUED', null),
      provider: 'dashscope-qwen-mt-image',
      model: 'qwen-mt-image',
      estimatedCostCents: 10,
      inputAssets: [{
        assetId: 'asset-1', role: 'REFERENCE' as const, ordinal: 0,
        url: 'http://localhost:3001/uploads/source.png', mimeType: 'image/png', sha256: 'a'.repeat(64),
      }],
    };
    const state = repositoryState(paidJob);
    const provider: AiImageTranslationProvider = {
      name: 'dashscope-qwen-mt-image', submit: vi.fn(), poll: vi.fn(),
    };

    await expect(processAiImageTranslationQueueJob('translation-job-1', 1, {
      repository: state.repository,
      getProviderConfig: async () => ({
        enabled: true,
        provider: 'dashscope-qwen-mt-image',
        baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
        apiKey: 'test-only-key',
        model: 'qwen-mt-image',
        costPerImageCents: 10,
      }),
      getStorageConfig: async () => ({
        source: 'system-config',
        mode: 'cloud',
        imageStorage: 'oss',
        authSource: 'token',
        extensionSync: 'queue',
        oss: {
          endpoint: 'https://storage.example.com',
          bucket: 'media',
          accessKeyId: 'key',
          accessKeySecret: 'secret',
          region: 'auto',
          cdnDomain: 'https://cdn.example.com',
        },
        ozonCdnRelayUrl: undefined,
        ossFallbackToCdn: false,
        localBaseUrl: 'https://erp.example.com',
      }),
      resolveProvider: () => provider,
      schedulePoll: vi.fn(),
    })).rejects.toMatchObject({ code: 'STORAGE_NOT_READY' });

    expect(provider.submit).not.toHaveBeenCalled();
    expect(provider.poll).not.toHaveBeenCalled();
    expect(state.current()).toMatchObject({ status: 'FAILED', errorCode: 'STORAGE_NOT_READY' });
  });

  it('does not reschedule permanent accepted-task authentication failures', async () => {
    const state = repositoryState({ ...job('RUNNING', 'provider-task-auth'), providerDispatchedAt: new Date() });
    const schedulePoll = vi.fn(async () => undefined);
    const provider: AiImageTranslationProvider = {
      name: 'fake', submit: vi.fn(),
      poll: vi.fn(async () => { throw Object.assign(new AiImageJobError('PROVIDER_AUTH_FAILED', 'expired'), { providerHttpStatus: 401 }); }),
    };
    await expect(processAiImageTranslationQueueJob('translation-job-1', 2, {
      repository: state.repository, getProviderConfig: runtimeConfig,
      resolveProvider: () => provider, uploadBuffer: vi.fn(), schedulePoll,
    })).rejects.toMatchObject({ code: 'PROVIDER_AUTH_FAILED' });
    expect(schedulePoll).not.toHaveBeenCalled();
    expect(state.current().status).toBe('FAILED');
  });

  it('does not poll-loop a cost reconciliation failure after the provider result is accepted', async () => {
    const state = repositoryState({ ...job('RUNNING', 'provider-task-cost'), providerDispatchedAt: new Date() });
    state.repository.complete = vi.fn(async () => {
      throw new AiCostLedgerError('COST_OVERRUN_REQUIRES_RECONCILIATION', 'actual cost exceeds reserve');
    });
    const schedulePoll = vi.fn(async () => undefined);
    const provider: AiImageTranslationProvider = {
      name: 'fake', submit: vi.fn(),
      poll: vi.fn(async () => ({
        status: 'SUCCEEDED' as const, providerStatus: 'SUCCEEDED' as const,
        image: { buffer: png, mimeType: 'image/png' }, actualCostCents: 99,
      })),
    };
    await expect(processAiImageTranslationQueueJob('translation-job-1', 2, {
      repository: state.repository, getProviderConfig: runtimeConfig,
      resolveProvider: () => provider, uploadBuffer: vi.fn(async () => ({
        url: 'https://owned.example/result.png', backend: 'oss', key: 'result.png',
      })), schedulePoll,
    })).rejects.toMatchObject({ code: 'COST_OVERRUN_REQUIRES_RECONCILIATION' });
    expect(schedulePoll).not.toHaveBeenCalled();
    expect(state.current().status).toBe('FAILED');
  });

  it('polls an accepted task after restart without submitting it again', async () => {
    const state = repositoryState(job('RUNNING', 'provider-task-1'));
    const provider: AiImageTranslationProvider = {
      name: 'fake',
      submit: vi.fn(),
      poll: vi.fn(async () => ({
        status: 'SUCCEEDED' as const, providerStatus: 'SUCCEEDED' as const,
        image: { buffer: png, mimeType: 'image/png' }, actualCostCents: 0,
      })),
    };
    const uploadBuffer = vi.fn(async () => ({
      url: 'https://owned.example/translated.png', backend: 'oss', key: 'translated.png',
    }));
    await expect(processAiImageTranslationQueueJob('translation-job-1', 2, {
      repository: state.repository,
      getProviderConfig: runtimeConfig,
      resolveProvider: () => provider,
      uploadBuffer,
      schedulePoll: vi.fn(),
    })).resolves.toBe('completed');
    expect(provider.submit).not.toHaveBeenCalled();
    expect(provider.poll).toHaveBeenCalledWith('provider-task-1');
    expect(state.current().status).toBe('SUCCEEDED');
  });

  it('persists one submission, schedules pending work, then completes on a later poll', async () => {
    const state = repositoryState(job('QUEUED', null));
    let polls = 0;
    const provider: AiImageTranslationProvider = {
      name: 'fake',
      submit: vi.fn(async (_request, onAccepted) => {
        const acceptedAt = new Date();
        await onAccepted('provider-task-2', acceptedAt);
        return { providerJobId: 'provider-task-2', providerAcceptedAt: acceptedAt };
      }),
      poll: vi.fn(async () => {
        polls += 1;
        return polls === 1
          ? { status: 'PENDING' as const, providerStatus: 'RUNNING' }
          : {
            status: 'SUCCEEDED' as const, providerStatus: 'SUCCEEDED' as const,
            image: { buffer: png, mimeType: 'image/png' }, actualCostCents: 0,
          };
      }),
    };
    const schedulePoll = vi.fn(async () => undefined);
    const overrides = {
      repository: state.repository,
      getProviderConfig: runtimeConfig,
      resolveProvider: () => provider,
      uploadBuffer: vi.fn(async () => ({ url: 'https://owned.example/result.png', backend: 'oss' })),
      schedulePoll,
    };
    await expect(processAiImageTranslationQueueJob('translation-job-1', 1, overrides)).resolves.toBe('pending');
    expect(state.current()).toMatchObject({ status: 'RUNNING', providerJobId: 'provider-task-2' });
    expect(state.repository.recordProviderJobId).toHaveBeenCalledTimes(1);
    expect(schedulePoll).toHaveBeenCalledWith('translation-job-1', expect.any(Number));

    await expect(processAiImageTranslationQueueJob('translation-job-1', 2, overrides)).resolves.toBe('completed');
    expect(provider.submit).toHaveBeenCalledTimes(1);
    expect(provider.poll).toHaveBeenCalledTimes(2);
    expect(state.current().status).toBe('SUCCEEDED');
  });
});
