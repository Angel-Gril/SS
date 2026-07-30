import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../lib/redis.js', () => ({ redisDisabled: true }));
import {
  AI_IMAGE_QUEUE_JOB_OPTIONS,
  processAiImageQueueJob,
  resolveAiImageProvider,
} from '../workers/ai-image-generation.js';
import {
  aiImageProviderEndpointSha256,
  createAiImageProviderRuntimeContract,
} from '../services/ai-image-provider-runtime-contract.js';

const allowPaidDispatch = async () => ({
  enabled: true,
  reasonCode: 'tenant_allowed',
  reason: 'allowed',
});

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
    const loadInputBuffer = vi.fn();

    const providerConfig = { provider: 'fake', baseUrl: '', apiKey: '', model: 'fake-image-v1', costPerImageCents: 0 };
    await processAiImageQueueJob('job-1', 2, {
      repository: repository as any,
      getProviderConfig: vi.fn(async () => providerConfig),
      resolveProvider,
      loadInputBuffer,
      uploadBuffer: vi.fn(),
      run,
    });

    expect(resolveProvider).toHaveBeenCalledWith('fake', providerConfig, undefined);
    expect(run).toHaveBeenCalledWith('job-1', 2, expect.objectContaining({
      repository,
      provider,
      loadInputBuffer,
    }));
  });

  it('routes OpenAI text generation and IMAGE_TO_IMAGE through their operation-specific adapters', async () => {
    const generated = { images: [{ buffer: Buffer.from('generated'), mimeType: 'image/png' }] };
    const edited = { images: [{ buffer: Buffer.from('edited'), mimeType: 'image/png' }] };
    const generate = vi.fn(async () => generated);
    const edit = vi.fn(async () => edited);
    const inputImages = [{ buffer: Buffer.from('source'), mimeType: 'image/png' as const }];
    const endpointSha256 = aiImageProviderEndpointSha256(
      'openai-images',
      'https://api.openai.com/v1',
    );
    const provider = resolveAiImageProvider(
      'openai-images',
      {
        provider: 'openai-images', baseUrl: 'https://api.openai.com/v1', apiKey: 'secret',
        model: 'gpt-image-1', costPerImageCents: 7,
      },
      undefined,
      {
        resolveCapability: () => ({
          provider: 'openai-images', model: 'gpt-image-1',
          operations: ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE'], maxReferences: 16,
          supportsMask: false, inputTransport: 'multipart', resultMode: 'sync',
          evidenceLevel: 'sandbox-verified', evidence: 'test',
          sandboxEvidence: [
            {
              endpointSha256,
              operation: 'TEXT_TO_IMAGE',
              inputTransport: 'none',
              resultMode: 'sync',
            },
            {
              endpointSha256,
              operation: 'IMAGE_TO_IMAGE',
              inputTransport: 'multipart',
              resultMode: 'sync',
            },
          ],
        }),
        createOpenAiGenerationProvider: () => ({ name: 'openai-images', generate }),
        createOpenAiEditProvider: () => ({ name: 'openai-image-edits', edit }),
      },
    );
    const textRequest = {
      operation: 'TEXT_TO_IMAGE' as const,
      prompt: 'studio photo', negativePrompt: null, count: 1,
      width: 1024, height: 1024, model: 'gpt-image-1',
    };
    const editRequest = {
      operation: 'IMAGE_TO_IMAGE' as const,
      prompt: 'keep the product', negativePrompt: 'text', count: 1,
      width: 1024, height: 1024, model: 'gpt-image-1', inputImages,
    };

    await expect(provider.generate(textRequest)).resolves.toBe(generated);
    await expect(provider.generate(editRequest)).resolves.toBe(edited);

    expect(generate).toHaveBeenCalledWith(textRequest);
    expect(edit).toHaveBeenCalledWith({
      operation: 'IMAGE_TO_IMAGE',
      prompt: 'keep the product',
      negativePrompt: 'text',
      width: 1024,
      height: 1024,
      model: 'gpt-image-1',
      images: inputImages,
      mask: null,
    });
  });

  it('routes an exact sandbox-verified custom Relay through the OpenAI-compatible adapters', async () => {
    const config = {
      provider: 'custom', baseUrl: 'https://relay.example/v1', apiKey: 'relay-secret',
      model: 'relay-image-v2', costPerImageCents: 9,
    };
    const generated = { images: [{ buffer: Buffer.from('generated'), mimeType: 'image/png' as const }] };
    const edited = { images: [{ buffer: Buffer.from('edited'), mimeType: 'image/png' as const }] };
    const generate = vi.fn(async () => generated);
    const edit = vi.fn(async () => edited);
    const createGeneration = vi.fn(() => ({ name: 'openai-images', generate }));
    const createEdit = vi.fn(() => ({ name: 'openai-image-edits', edit }));
    const endpointSha256 = aiImageProviderEndpointSha256('custom', config.baseUrl);
    const provider = resolveAiImageProvider('custom', config, undefined, {
      resolveCapability: () => ({
        provider: 'custom', model: 'relay-image-v2',
        operations: ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE'], maxReferences: 4,
        supportsMask: false, inputTransport: 'multipart', resultMode: 'sync',
        evidenceLevel: 'sandbox-verified', evidence: 'exact custom Relay evidence',
        sandboxEvidence: [
          {
            endpointSha256,
            operation: 'TEXT_TO_IMAGE',
            inputTransport: 'none',
            resultMode: 'sync',
          },
          {
            endpointSha256,
            operation: 'IMAGE_TO_IMAGE',
            inputTransport: 'multipart',
            resultMode: 'sync',
          },
        ],
      }),
      createOpenAiGenerationProvider: createGeneration,
      createOpenAiEditProvider: createEdit,
    });
    const inputImages = [{ buffer: Buffer.from('source'), mimeType: 'image/png' as const }];
    const textRequest = {
      operation: 'TEXT_TO_IMAGE' as const,
      prompt: 'studio photo', negativePrompt: null, count: 1,
      width: 1024, height: 1024, model: config.model,
    };
    const editRequest = {
      operation: 'IMAGE_TO_IMAGE' as const,
      prompt: 'keep the product', negativePrompt: null, count: 1,
      width: 1024, height: 1024, model: config.model, inputImages,
    };

    expect(provider.name).toBe('custom');
    await expect(provider.generate(textRequest)).resolves.toBe(generated);
    await expect(provider.generate(editRequest)).resolves.toBe(edited);
    const adapterOptions = {
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      costPerImageCents: config.costPerImageCents,
    };
    expect(createGeneration).toHaveBeenCalledWith(expect.objectContaining(adapterOptions));
    expect(createEdit).toHaveBeenCalledWith(expect.objectContaining(adapterOptions));
    expect(generate).toHaveBeenCalledWith(textRequest);
    expect(edit).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'IMAGE_TO_IMAGE', images: inputImages, mask: null,
    }));
  });

  it('does not let text-to-image sandbox evidence unlock IMAGE_TO_IMAGE dispatch', async () => {
    const generate = vi.fn(async () => ({ images: [] }));
    const edit = vi.fn(async () => ({ images: [] }));
    const endpointSha256 = aiImageProviderEndpointSha256(
      'openai-images',
      'https://api.openai.com/v1',
    );
    const provider = resolveAiImageProvider(
      'openai-images',
      {
        provider: 'openai-images', baseUrl: 'https://api.openai.com/v1', apiKey: 'secret',
        model: 'gpt-image-1', costPerImageCents: 7,
      },
      undefined,
      {
        resolveCapability: () => ({
          provider: 'openai-images', model: 'gpt-image-1',
          operations: ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE'], maxReferences: 16,
          supportsMask: false, inputTransport: 'multipart', resultMode: 'sync',
          evidenceLevel: 'sandbox-verified', evidence: 'text-only sandbox evidence',
          sandboxEvidence: [{
            endpointSha256,
            operation: 'TEXT_TO_IMAGE',
            inputTransport: 'none',
            resultMode: 'sync',
          }],
        }),
        createOpenAiGenerationProvider: () => ({ name: 'openai-images', generate }),
        createOpenAiEditProvider: () => ({ name: 'openai-image-edits', edit }),
      },
    );

    await expect(provider.generate({
      operation: 'IMAGE_TO_IMAGE', prompt: 'keep product', negativePrompt: null,
      count: 1, width: 1024, height: 1024, model: 'gpt-image-1',
      inputImages: [{ buffer: Buffer.from('source'), mimeType: 'image/png' }],
    })).rejects.toMatchObject({ code: 'PROVIDER_NOT_READY' });
    expect(generate).not.toHaveBeenCalled();
    expect(edit).not.toHaveBeenCalled();
  });

  it('fails a queued paid job closed when tenant rollout is revoked before dispatch', async () => {
    const repository = {
      getById: vi.fn(async () => ({
        id: 'job-revoked', ownerUserId: 'owner-1', provider: 'openai-images',
        model: 'gpt-image-1', status: 'QUEUED', estimatedCostCents: 7,
        requestedImageCount: 1, width: 1024, height: 1024,
        costReservation: { status: 'RESERVED' },
      })),
      markEnqueueFailed: vi.fn(async () => true),
    };
    const getProviderConfig = vi.fn();
    const resolveProvider = vi.fn();
    const run = vi.fn();

    await processAiImageQueueJob('job-revoked', 1, {
      repository: repository as any,
      getDispatchAuthorization: vi.fn(async () => ({
        enabled: false,
        reasonCode: 'tenant_not_allowed',
        reason: 'AI media rollout was revoked',
      })),
      getProviderConfig,
      resolveProvider,
      run,
    });

    expect(repository.markEnqueueFailed).toHaveBeenCalledWith('job-revoked', {
      attemptCount: 1,
      errorCode: 'AI_IMAGE_DISPATCH_REVOKED',
      errorMessage: 'AI media rollout was revoked',
    });
    expect(getProviderConfig).not.toHaveBeenCalled();
    expect(resolveProvider).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('requires a RESERVED cost reservation before resolving a paid Provider', async () => {
    const repository = {
      getById: vi.fn(async () => ({
        id: 'job-no-cost', ownerUserId: 'owner-1', provider: 'openai-images',
        model: 'gpt-image-1', status: 'QUEUED', estimatedCostCents: 7,
        requestedImageCount: 1, width: 1024, height: 1024,
        costReservation: null,
      })),
      markEnqueueFailed: vi.fn(async () => true),
    };
    const getProviderConfig = vi.fn();

    await processAiImageQueueJob('job-no-cost', 1, {
      repository: repository as any,
      getDispatchAuthorization: vi.fn(async () => ({
        enabled: true, reasonCode: 'tenant_allowed', reason: 'allowed',
      })),
      getProviderConfig,
    });

    expect(repository.markEnqueueFailed).toHaveBeenCalledWith('job-no-cost', {
      attemptCount: 1,
      errorCode: 'AI_IMAGE_COST_RESERVATION_REQUIRED',
      errorMessage: 'Paid AI image dispatch requires an exact RESERVED cost reservation',
    });
    expect(getProviderConfig).not.toHaveBeenCalled();
  });

  it('dispatches only when the active endpoint, model, price and request match the frozen contract', async () => {
    const providerConfig = {
      provider: 'openai-images', baseUrl: 'https://api.openai.com/v1', apiKey: 'secret',
      model: 'gpt-image-1', costPerImageCents: 7,
    };
    const runtimeContract = createAiImageProviderRuntimeContract(providerConfig, {
      count: 1, width: 1024, height: 1024,
    });
    const job = {
      id: 'job-frozen', ownerUserId: 'owner-1', provider: 'openai-images',
      model: 'gpt-image-1', status: 'QUEUED', estimatedCostCents: 7,
      requestedImageCount: 1, width: 1024, height: 1024,
      operationConfig: runtimeContract,
      costReservation: {
        status: 'RESERVED', provider: 'openai-images', model: 'gpt-image-1',
        estimatedCostMinor: 7, maximumCostMinor: 7,
      },
    };
    const repository = { getById: vi.fn(async () => job) };
    const provider = { name: 'openai-images', generate: vi.fn() };
    const run = vi.fn(async () => undefined);

    await processAiImageQueueJob('job-frozen', 1, {
      repository: repository as any,
      getDispatchAuthorization: vi.fn(async () => ({
        enabled: true, reasonCode: 'tenant_allowed', reason: 'allowed',
      })),
      getProviderConfig: vi.fn(async () => providerConfig),
      resolveProvider: vi.fn(() => provider),
      uploadBuffer: vi.fn(),
      run,
    });

    expect(run).toHaveBeenCalledWith('job-frozen', 1, expect.objectContaining({ provider }));
  });

  it('fails before Provider resolution when the configured endpoint changed after queueing', async () => {
    const frozenConfig = {
      provider: 'openai-images', baseUrl: 'https://api.openai.com/v1', apiKey: 'old',
      model: 'gpt-image-1', costPerImageCents: 7,
    };
    const job = {
      id: 'job-endpoint-changed', ownerUserId: 'owner-1', provider: 'openai-images',
      model: 'gpt-image-1', status: 'QUEUED', estimatedCostCents: 7,
      requestedImageCount: 1, width: 1024, height: 1024,
      operationConfig: createAiImageProviderRuntimeContract(frozenConfig, {
        count: 1, width: 1024, height: 1024,
      }),
      costReservation: {
        status: 'RESERVED', provider: 'openai-images', model: 'gpt-image-1',
        estimatedCostMinor: 7, maximumCostMinor: 7,
      },
    };
    const repository = {
      getById: vi.fn(async () => job),
      markEnqueueFailed: vi.fn(async () => true),
    };
    const resolveProvider = vi.fn();
    const run = vi.fn();

    await processAiImageQueueJob('job-endpoint-changed', 1, {
      repository: repository as any,
      getDispatchAuthorization: vi.fn(async () => ({
        enabled: true, reasonCode: 'tenant_allowed', reason: 'allowed',
      })),
      getProviderConfig: vi.fn(async () => ({
        ...frozenConfig, baseUrl: 'https://relay.example/v1', apiKey: 'new',
      })),
      resolveProvider,
      run,
    });

    expect(repository.markEnqueueFailed).toHaveBeenCalledWith('job-endpoint-changed', {
      attemptCount: 1,
      errorCode: 'PROVIDER_RUNTIME_CONTRACT_MISMATCH',
      errorMessage:
        'The official OpenAI Images provider requires https://api.openai.com/v1; use custom for relays',
    });
    expect(resolveProvider).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects a legacy relay-labeled contract even when the active relay still matches it', async () => {
    const relayConfig = {
      provider: 'openai-images', baseUrl: 'https://relay.example/v1', apiKey: 'legacy-secret',
      model: 'gpt-image-1', costPerImageCents: 7,
    };
    const operationConfig = {
      contractVersion: 'ai-image-provider-runtime/v1',
      provider: 'openai-images',
      model: 'gpt-image-1',
      baseUrlSha256: createHash('sha256').update(relayConfig.baseUrl).digest('hex'),
      unitCostCents: 7,
      imageCount: 1,
      width: 1024,
      height: 1024,
      maximumCostCents: 7,
    };
    const repository = {
      getById: vi.fn(async () => ({
        id: 'job-legacy-relay', ownerUserId: 'owner-1', provider: 'openai-images',
        model: 'gpt-image-1', status: 'QUEUED', estimatedCostCents: 7,
        requestedImageCount: 1, width: 1024, height: 1024, operationConfig,
        costReservation: {
          status: 'RESERVED', provider: 'openai-images', model: 'gpt-image-1',
          estimatedCostMinor: 7, maximumCostMinor: 7,
        },
      })),
      markEnqueueFailed: vi.fn(async () => true),
    };
    const resolveProvider = vi.fn();
    const run = vi.fn();

    await processAiImageQueueJob('job-legacy-relay', 1, {
      repository: repository as any,
      getDispatchAuthorization: vi.fn(async () => ({
        enabled: true, reasonCode: 'tenant_allowed', reason: 'allowed',
      })),
      getProviderConfig: vi.fn(async () => relayConfig),
      resolveProvider,
      run,
    });

    expect(repository.markEnqueueFailed).toHaveBeenCalledWith('job-legacy-relay', {
      attemptCount: 1,
      errorCode: 'PROVIDER_RUNTIME_CONTRACT_MISMATCH',
      errorMessage:
        'The official OpenAI Images provider requires https://api.openai.com/v1; use custom for relays',
    });
    expect(resolveProvider).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    ['bare custom origin', 'https://relay.example'],
    ['custom path prefix', 'https://relay.example/openai'],
  ])('rejects a legacy raw hash for a %s before Provider resolution', async (
    _label,
    baseUrl,
  ) => {
    const relayConfig = {
      provider: 'custom', baseUrl, apiKey: 'legacy-secret',
      model: 'relay-image-v2', costPerImageCents: 7,
    };
    const current = createAiImageProviderRuntimeContract(relayConfig, {
      count: 1, width: 1024, height: 1024,
    });
    const operationConfig = {
      ...current,
      baseUrlSha256: createHash('sha256').update(baseUrl).digest('hex'),
    };
    const repository = {
      getById: vi.fn(async () => ({
        id: 'job-legacy-custom', ownerUserId: 'owner-1', provider: 'custom',
        model: 'relay-image-v2', status: 'QUEUED', estimatedCostCents: 7,
        requestedImageCount: 1, width: 1024, height: 1024, operationConfig,
        costReservation: {
          status: 'RESERVED', provider: 'custom', model: 'relay-image-v2',
          estimatedCostMinor: 7, maximumCostMinor: 7,
        },
      })),
      markEnqueueFailed: vi.fn(async () => true),
    };
    const resolveProvider = vi.fn();
    const run = vi.fn();

    await processAiImageQueueJob('job-legacy-custom', 1, {
      repository: repository as any,
      getDispatchAuthorization: vi.fn(async () => ({
        enabled: true, reasonCode: 'tenant_allowed', reason: 'allowed',
      })),
      getProviderConfig: vi.fn(async () => relayConfig),
      resolveProvider,
      run,
    });

    expect(repository.markEnqueueFailed).toHaveBeenCalledWith('job-legacy-custom', {
      attemptCount: 1,
      errorCode: 'PROVIDER_RUNTIME_CONTRACT_MISMATCH',
      errorMessage: 'Active Provider identity does not match the frozen runtime contract',
    });
    expect(resolveProvider).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('keeps an adapter-characterized paid provider disabled until sandbox evidence is promoted', async () => {
    const providerConfig = {
      provider: 'dashscope-wanx', baseUrl: 'https://dashscope.example/api/v1',
      apiKey: 'secret', model: 'wanx-v1', costPerImageCents: 5,
    };
    const repository = { getById: vi.fn(async () => ({
      id: 'job-1', ownerUserId: 'owner-1', provider: 'dashscope-wanx', model: 'wanx-v1',
      status: 'QUEUED', requestedImageCount: 1, width: 1024, height: 1024,
      estimatedCostCents: 5,
      operationConfig: createAiImageProviderRuntimeContract(providerConfig, {
        count: 1, width: 1024, height: 1024,
      }),
      costReservation: {
        status: 'RESERVED', provider: 'dashscope-wanx', model: 'wanx-v1',
        estimatedCostMinor: 5, maximumCostMinor: 5,
      },
    })) };
    const run = vi.fn(async () => undefined);
    await processAiImageQueueJob('job-1', 1, {
      repository: repository as any,
      getDispatchAuthorization: allowPaidDispatch,
      getProviderConfig: vi.fn(async () => providerConfig),
      uploadBuffer: vi.fn(), run,
    });
    expect((run as any).mock.calls[0]?.[2].provider.name).toBe('disabled');
  });

  it('keeps an unverified custom image provider disabled in the normal worker', async () => {
    const providerConfig = {
      provider: 'custom', baseUrl: 'https://relay.example', apiKey: 'secret',
      model: 'custom-image-model', costPerImageCents: 5,
    };
    const repository = { getById: vi.fn(async () => ({
      id: 'job-custom', ownerUserId: 'owner-1', provider: 'custom', model: 'custom-image-model',
      status: 'QUEUED', requestedImageCount: 1, width: 1024, height: 1024,
      estimatedCostCents: 5,
      operationConfig: createAiImageProviderRuntimeContract(providerConfig, {
        count: 1, width: 1024, height: 1024,
      }),
      costReservation: {
        status: 'RESERVED', provider: 'custom', model: 'custom-image-model',
        estimatedCostMinor: 5, maximumCostMinor: 5,
      },
    })) };
    const run = vi.fn(async () => undefined);
    await processAiImageQueueJob('job-custom', 1, {
      repository: repository as any,
      getDispatchAuthorization: allowPaidDispatch,
      getProviderConfig: vi.fn(async () => providerConfig),
      uploadBuffer: vi.fn(), run,
    });
    expect((run as any).mock.calls[0]?.[2].provider.name).toBe('disabled');
  });
  it('quarantines an unclassified paid provider failure when the queue allows one attempt', async () => {
    const providerConfig = {
      provider: 'openai-images', baseUrl: 'https://api.openai.com/v1',
      apiKey: 'secret', model: 'gpt-image-1', costPerImageCents: 7,
    };
    const job = {
      id: 'job-paid', ownerUserId: 'owner-1', provider: 'openai-images', model: 'gpt-image-1',
      status: 'QUEUED', prompt: 'photo', negativePrompt: null, requestedImageCount: 1,
      width: 1024, height: 1024, maxAttempts: 3, estimatedCostCents: 7,
      operationConfig: createAiImageProviderRuntimeContract(providerConfig, {
        count: 1, width: 1024, height: 1024,
      }),
      costReservation: {
        status: 'RESERVED', provider: 'openai-images', model: 'gpt-image-1',
        estimatedCostMinor: 7, maximumCostMinor: 7,
      },
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
      getDispatchAuthorization: allowPaidDispatch,
      getProviderConfig: vi.fn(async () => providerConfig),
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
        .mockResolvedValueOnce({
          id: 'job-setup-race', ownerUserId: 'owner-1', provider: 'openai-images',
          model: 'gpt-image-1', status: 'QUEUED', estimatedCostCents: 7,
          requestedImageCount: 1, width: 1024, height: 1024,
          costReservation: {
            status: 'RESERVED', provider: 'openai-images', model: 'gpt-image-1',
            estimatedCostMinor: 7, maximumCostMinor: 7,
          },
        })
        .mockResolvedValueOnce({ id: 'job-setup-race', provider: 'openai-images', status: 'CANCEL_REQUESTED' }),
      markEnqueueFailed: vi.fn(async () => false),
      markCancelled: vi.fn(async () => undefined),
      markFailed: vi.fn(async () => undefined),
    };

    await expect(processAiImageQueueJob('job-setup-race', 1, {
      repository: repository as any,
      getDispatchAuthorization: allowPaidDispatch,
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
