import { describe, expect, it, vi } from 'vitest';
vi.mock('../lib/redis.js', () => ({ redisDisabled: true }));
import { AI_IMAGE_QUEUE_JOB_OPTIONS, processAiImageQueueJob } from '../workers/ai-image-generation.js';

describe('AI image BullMQ worker boundary', () => {
  it('allows one BullMQ redelivery for state recovery without provider resubmission', () => {
    expect(AI_IMAGE_QUEUE_JOB_OPTIONS).toEqual(expect.objectContaining({
      attempts: 2,
      backoff: { type: 'fixed', delay: 1_000 },
    }));
  });

  it('resolves the persisted provider and forwards the BullMQ attempt number', async () => {
    const job = { id: 'job-1', provider: 'fake' };
    const repository = { getById: vi.fn(async () => job) };
    const provider = { name: 'fake', generate: vi.fn() };
    const resolveProvider = vi.fn(() => provider);
    const run = vi.fn(async () => undefined);

    const providerConfig = { provider: 'fake', baseUrl: '', apiKey: '', model: 'fake-image-v1', costPerImageCents: 0 };
    await processAiImageQueueJob('job-1', 2, { repository: repository as any, getProviderConfig: vi.fn(async () => providerConfig), resolveProvider, uploadBuffer: vi.fn(), run });

    expect(resolveProvider).toHaveBeenCalledWith('fake', providerConfig, undefined);
    expect(run).toHaveBeenCalledWith('job-1', 2, expect.objectContaining({ repository, provider }));
  });

  it('keeps an adapter-characterized paid provider disabled until sandbox evidence is promoted', async () => {
    const repository = { getById: vi.fn(async () => ({ id: 'job-1', provider: 'dashscope-wanx' })) };
    const run = vi.fn(async () => undefined);
    await processAiImageQueueJob('job-1', 1, {
      repository: repository as any,
      getProviderConfig: vi.fn(async () => ({ provider: 'dashscope-wanx', baseUrl: 'https://dashscope.example/api/v1', apiKey: 'secret', model: 'wanx-v1', costPerImageCents: 5 })),
      uploadBuffer: vi.fn(), run,
    });
    expect((run as any).mock.calls[0]?.[2].provider.name).toBe('disabled');
  });

  it('keeps an unverified custom image provider disabled in the normal worker', async () => {
    const repository = { getById: vi.fn(async () => ({ id: 'job-custom', provider: 'custom' })) };
    const run = vi.fn(async () => undefined);
    await processAiImageQueueJob('job-custom', 1, {
      repository: repository as any,
      getProviderConfig: vi.fn(async () => ({
        provider: 'custom', baseUrl: 'https://relay.example', apiKey: 'secret',
        model: 'custom-image-model', costPerImageCents: 0,
      })),
      uploadBuffer: vi.fn(), run,
    });
    expect((run as any).mock.calls[0]?.[2].provider.name).toBe('disabled');
  });
  it('quarantines an unclassified paid provider failure when the queue allows one attempt', async () => {
    const job = {
      id: 'job-paid', ownerUserId: 'owner-1', provider: 'openai-images', model: 'gpt-image-1',
      status: 'QUEUED', prompt: 'photo', negativePrompt: null, requestedImageCount: 1,
      width: 1024, height: 1024, maxAttempts: 3, estimatedCostCents: 0,
    };
    const repository = {
      getById: vi.fn(async () => job),
      markRunning: vi.fn(async () => true),
      markRetrying: vi.fn(async () => undefined),
      markFailed: vi.fn(async () => undefined),
      markSubmissionUncertain: vi.fn(async () => undefined),
    };
    await expect(processAiImageQueueJob('job-paid', 1, {
      repository: repository as any,
      getProviderConfig: vi.fn(async () => ({ provider: 'openai-images', baseUrl: 'https://api.openai.example/v1', apiKey: 'secret', model: 'gpt-image-1', costPerImageCents: 0 })),
      resolveProvider: vi.fn(() => ({ name: 'openai-images', generate: vi.fn(async () => { throw new Error('provider failed'); }) })),
      uploadBuffer: vi.fn(),
    })).rejects.toThrow('provider failed');

    expect(repository.markSubmissionUncertain).toHaveBeenCalledWith('job-paid', expect.objectContaining({
      attemptCount: 1,
      errorCode: 'PROVIDER_ERROR',
      providerSubmissionUncertain: true,
    }));
    expect(repository.markFailed).not.toHaveBeenCalled();
    expect(repository.markRetrying).not.toHaveBeenCalled();
  });

  it('moves an accepted task to recovery instead of resubmitting on worker redelivery', async () => {
    const repository = {
      getById: vi.fn(async () => ({
        id: 'job-stalled', provider: 'dashscope-wanx', status: 'RUNNING', attemptCount: 1,
        providerJobId: 'provider-task-1',
      })),
      markFailed: vi.fn(async () => undefined),
    };
    const getProviderConfig = vi.fn();
    const resolveProvider = vi.fn();
    const uploadBuffer = vi.fn();
    const run = vi.fn();

    await processAiImageQueueJob('job-stalled', 2, {
      repository: repository as any,
      getProviderConfig,
      resolveProvider,
      uploadBuffer,
      run,
    });

    expect(repository.markFailed).toHaveBeenCalledWith('job-stalled', {
      attemptCount: 2,
      errorCode: 'PROVIDER_RECOVERY_REQUIRED',
      errorMessage: 'Provider task was accepted before worker interruption; reconcile the provider result before retrying',
      providerJobId: 'provider-task-1',
    });
    expect(getProviderConfig).not.toHaveBeenCalled();
    expect(resolveProvider).not.toHaveBeenCalled();
    expect(uploadBuffer).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('fails an interrupted zero-cost fake task without attempting a second generation', async () => {
    const repository = {
      getById: vi.fn(async () => ({
        id: 'job-fake-stalled', provider: 'fake', status: 'RUNNING', attemptCount: 1,
        providerJobId: null,
      })),
      markFailed: vi.fn(async () => undefined),
    };
    const getProviderConfig = vi.fn();
    const run = vi.fn();

    await processAiImageQueueJob('job-fake-stalled', 2, {
      repository: repository as any,
      getProviderConfig,
      uploadBuffer: vi.fn(),
      run,
    });

    expect(repository.markFailed).toHaveBeenCalledWith('job-fake-stalled', {
      attemptCount: 2,
      errorCode: 'WORKER_INTERRUPTED_BEFORE_PROVIDER_ACCEPTANCE',
      errorMessage: 'Zero-cost fake provider execution was interrupted before completion',
    });
    expect(getProviderConfig).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('keeps interrupted fake tasks out of paid-provider reconciliation when recovery support exists', async () => {
    const repository = {
      getById: vi.fn(async () => ({
        id: 'job-fake-stalled', provider: 'fake', status: 'RUNNING', attemptCount: 1,
        providerJobId: null,
      })),
      recoverInterruptedJob: vi.fn(async () => 'SUBMISSION_UNCERTAIN' as const),
      markFailed: vi.fn(async () => undefined),
    };

    await processAiImageQueueJob('job-fake-stalled', 2, { repository: repository as any });

    expect(repository.recoverInterruptedJob).not.toHaveBeenCalled();
    expect(repository.markFailed).toHaveBeenCalledWith('job-fake-stalled', {
      attemptCount: 2,
      errorCode: 'WORKER_INTERRUPTED_BEFORE_PROVIDER_ACCEPTANCE',
      errorMessage: 'Zero-cost fake provider execution was interrupted before completion',
    });
  });

  it('does not resubmit an ambiguous paid task without provider acceptance evidence', async () => {
    const repository = {
      getById: vi.fn(async () => ({
        id: 'job-paid-stalled', provider: 'openai-images', status: 'RUNNING', attemptCount: 1,
        providerJobId: null,
      })),
      markFailed: vi.fn(async () => undefined),
      markSubmissionUncertain: vi.fn(async () => undefined),
    };
    const getProviderConfig = vi.fn();
    const resolveProvider = vi.fn();
    const run = vi.fn();

    await expect(processAiImageQueueJob('job-paid-stalled', 2, {
      repository: repository as any,
      getProviderConfig,
      resolveProvider,
      uploadBuffer: vi.fn(),
      run,
    })).rejects.toMatchObject({ code: 'PROVIDER_SUBMISSION_UNCERTAIN' });

    expect(repository.markFailed).not.toHaveBeenCalled();
    expect(repository.markSubmissionUncertain).toHaveBeenCalledWith('job-paid-stalled', expect.objectContaining({
      errorCode: 'PROVIDER_SUBMISSION_UNCERTAIN', attemptCount: 2,
    }));
    expect(getProviderConfig).not.toHaveBeenCalled();
    expect(resolveProvider).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('finalizes cancellation when interrupted-job recovery loses its CAS race', async () => {
    const repository = {
      getById: vi.fn()
        .mockResolvedValueOnce({
          id: 'job-cancel-race', provider: 'openai-images', status: 'RUNNING', attemptCount: 1,
          providerJobId: null,
        })
        .mockResolvedValueOnce({
          id: 'job-cancel-race', provider: 'openai-images', status: 'CANCEL_REQUESTED', attemptCount: 1,
          providerJobId: null,
        }),
      recoverInterruptedJob: vi.fn(async () => null),
      markCancelled: vi.fn(async () => undefined),
      markFailed: vi.fn(async () => undefined),
    };

    await processAiImageQueueJob('job-cancel-race', 2, { repository: repository as any });

    expect(repository.markCancelled).toHaveBeenCalledWith('job-cancel-race');
    expect(repository.markFailed).not.toHaveBeenCalled();
  });

  it.each(['SUCCEEDED', 'FAILED'] as const)(
    'accepts a concurrent %s terminal state when interrupted-job recovery loses its CAS race',
    async (status) => {
      const repository = {
        getById: vi.fn()
          .mockResolvedValueOnce({
            id: 'job-terminal-race', provider: 'openai-images', status: 'RUNNING', attemptCount: 1,
            providerJobId: null,
          })
          .mockResolvedValueOnce({
            id: 'job-terminal-race', provider: 'openai-images', status, attemptCount: 1,
            providerJobId: null,
          }),
        recoverInterruptedJob: vi.fn(async () => null),
        markCancelled: vi.fn(async () => undefined),
        markFailed: vi.fn(async () => undefined),
      };

      await processAiImageQueueJob('job-terminal-race', 2, { repository: repository as any });

      expect(repository.markCancelled).not.toHaveBeenCalled();
      expect(repository.markFailed).not.toHaveBeenCalled();
    },
  );

  it('uses a provider identity persisted during an interrupted-job recovery race', async () => {
    const repository = {
      getById: vi.fn()
        .mockResolvedValueOnce({
          id: 'job-provider-race', provider: 'dashscope-wanx', status: 'RUNNING', attemptCount: 1,
          providerJobId: null,
        })
        .mockResolvedValueOnce({
          id: 'job-provider-race', provider: 'dashscope-wanx', status: 'RUNNING', attemptCount: 1,
          providerJobId: 'provider-task-late',
        }),
      recoverInterruptedJob: vi.fn(async () => null),
      markCancelled: vi.fn(async () => undefined),
      markFailed: vi.fn(async () => undefined),
    };

    await processAiImageQueueJob('job-provider-race', 2, { repository: repository as any });

    expect(repository.markFailed).toHaveBeenCalledWith('job-provider-race', {
      attemptCount: 2,
      errorCode: 'PROVIDER_RECOVERY_REQUIRED',
      errorMessage: 'Provider task was accepted before worker interruption; reconcile the provider result before retrying',
      providerJobId: 'provider-task-late',
    });
  });

  it('finalizes cancellation when setup failure loses its pre-dispatch CAS race', async () => {
    const setupError = new Error('config unavailable');
    const repository = {
      getById: vi.fn()
        .mockResolvedValueOnce({ id: 'job-setup-race', provider: 'openai-images', status: 'QUEUED' })
        .mockResolvedValueOnce({ id: 'job-setup-race', provider: 'openai-images', status: 'CANCEL_REQUESTED' }),
      markEnqueueFailed: vi.fn(async () => false),
      markCancelled: vi.fn(async () => undefined),
      markFailed: vi.fn(async () => undefined),
    };

    await expect(processAiImageQueueJob('job-setup-race', 1, {
      repository: repository as any,
      getProviderConfig: vi.fn(async () => { throw setupError; }),
    })).rejects.toThrow(setupError);

    expect(repository.markEnqueueFailed).toHaveBeenCalledWith('job-setup-race', {
      attemptCount: 1,
      errorCode: 'WORKER_SETUP_FAILED',
      errorMessage: 'AI image worker setup failed before provider dispatch',
    });
    expect(repository.markCancelled).toHaveBeenCalledWith('job-setup-race');
    expect(repository.markFailed).not.toHaveBeenCalled();
  });

  it('stops cleanly after repository recovery proves dispatch never started', async () => {
    const repository = {
      getById: vi.fn(async () => ({
        id: 'job-pre-dispatch', provider: 'openai-images', status: 'RUNNING', attemptCount: 1,
        providerJobId: null,
      })),
      recoverInterruptedJob: vi.fn(async () => 'FAILED_PRE_DISPATCH' as const),
      markFailed: vi.fn(async () => undefined),
    };

    await processAiImageQueueJob('job-pre-dispatch', 2, { repository: repository as any });

    expect(repository.recoverInterruptedJob).toHaveBeenCalledOnce();
    expect(repository.markFailed).not.toHaveBeenCalled();
  });

  it('surfaces repository-quarantined provider submission uncertainty', async () => {
    const repository = {
      getById: vi.fn(async () => ({
        id: 'job-dispatched', provider: 'openai-images', status: 'RUNNING', attemptCount: 1,
        providerJobId: null,
      })),
      recoverInterruptedJob: vi.fn(async () => 'SUBMISSION_UNCERTAIN' as const),
      markSubmissionUncertain: vi.fn(async () => undefined),
      markFailed: vi.fn(async () => undefined),
    };

    await expect(processAiImageQueueJob('job-dispatched', 2, {
      repository: repository as any,
    })).rejects.toMatchObject({ code: 'PROVIDER_SUBMISSION_UNCERTAIN' });

    expect(repository.markSubmissionUncertain).not.toHaveBeenCalled();
    expect(repository.markFailed).not.toHaveBeenCalled();
  });

});
