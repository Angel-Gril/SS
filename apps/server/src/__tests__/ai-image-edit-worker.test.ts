import { createHash } from 'node:crypto';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  AI_IMAGE_EDIT_FAKE_PROVIDER_PRODUCTION_BLOCKED,
  assertAiImageEditProviderRuntime,
  getAiImageEditDispatchAuthorization,
  loadAiImageEditInputBuffer,
  processAiImageEditQueueJob,
  readBoundedAiImageEditFile,
  readBoundedAiImageEditStream,
  resolveAiImageEditProvider,
} from '../workers/ai-image-edit.js';
import { AI_IMAGE_EDIT_MAX_INPUT_BYTES } from '../services/ai-image-edit.js';
import {
  aiImageProviderEndpointSha256,
  createAiImageProviderRuntimeContract,
} from '../services/ai-image-provider-runtime-contract.js';

const fakeProviderConfig = {
  provider: 'fake', baseUrl: '', apiKey: '', model: 'fake-image-edit-v1',
  costPerImageCents: 0,
};

const paidProviderConfig = {
  provider: 'openai-images', baseUrl: 'https://api.openai.com/v1', apiKey: 'secret',
  model: 'gpt-image-1', costPerImageCents: 7,
};

const allowPaidDispatch = async () => ({
  enabled: true,
  reasonCode: 'tenant_allowed',
  reason: 'allowed',
});

const asset = {
  assetId: 'source-1', role: 'REFERENCE' as const, ordinal: 0,
  storageBackend: 'local', storageKey: 'source.png', kind: 'SOURCE_ORIGINAL' as const,
  sha256: 'a'.repeat(64), sizeBytes: Buffer.byteLength('owned-bytes'), width: 2, height: 2,
};

describe('AI image edit worker boundary', () => {
  it('reads local inputs only from the trusted upload root and rejects traversal or unsupported backends', async () => {
    const readLocalFile = vi.fn(async () => Buffer.from('owned-bytes'));
    await expect(loadAiImageEditInputBuffer(asset, { readLocalFile })).resolves.toEqual(Buffer.from('owned-bytes'));
    expect(readLocalFile).toHaveBeenCalledWith(
      expect.stringMatching(/[\\/]public[\\/]uploads[\\/]source\.png$/u),
      Buffer.byteLength('owned-bytes'),
    );

    await expect(loadAiImageEditInputBuffer({ ...asset, storageKey: '../secret' }, { readLocalFile }))
      .rejects.toMatchObject({ code: 'INVALID_MEDIA_INPUT' });
    await expect(loadAiImageEditInputBuffer({ ...asset, storageBackend: 'ozon-cdn' }, { readLocalFile }))
      .rejects.toMatchObject({ code: 'INVALID_MEDIA_INPUT' });
    await expect(loadAiImageEditInputBuffer(asset, {
      readLocalFile: vi.fn(async () => Buffer.from('changed')),
    })).rejects.toMatchObject({ code: 'FROZEN_INPUT_MISMATCH' });
  });

  it('bounds local reads before allocation and rejects a changed frozen size', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ss-erp-edit-input-'));
    const exactPath = join(directory, 'exact.bin');
    const oversizedPath = join(directory, 'oversized.bin');
    try {
      await writeFile(exactPath, Buffer.from('exact'));
      await expect(readBoundedAiImageEditFile(exactPath, 5)).resolves.toEqual(Buffer.from('exact'));
      await expect(readBoundedAiImageEditFile(exactPath, 4))
        .rejects.toMatchObject({ code: 'FROZEN_INPUT_MISMATCH' });

      const handle = await open(oversizedPath, 'w');
      await handle.truncate(AI_IMAGE_EDIT_MAX_INPUT_BYTES + 1);
      await handle.close();
      await expect(readBoundedAiImageEditFile(oversizedPath, 5))
        .rejects.toMatchObject({ code: 'INVALID_MEDIA_INPUT' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('reads OSS bodies through a bounded stream and cancels once frozen size is exceeded', async () => {
    let finalized = false;
    async function* changedObject() {
      try {
        yield Buffer.from('exact');
        yield Buffer.from('replacement bytes that must not be retained');
      } finally {
        finalized = true;
      }
    }

    await expect(readBoundedAiImageEditStream(changedObject(), 5))
      .rejects.toMatchObject({ code: 'FROZEN_INPUT_MISMATCH' });
    expect(finalized).toBe(true);
    await expect(readBoundedAiImageEditStream((async function* () {
      yield Buffer.from('exact');
    })(), 5)).resolves.toEqual(Buffer.from('exact'));
  });

  it('uses an exact fake edit adapter that returns the requested dimensions', async () => {
    const provider = resolveAiImageEditProvider(
      'fake', 'fake-image-edit-v1', 'FULL_EDIT', fakeProviderConfig,
    );
    const generated = await provider.generate({
      operation: 'FULL_EDIT', prompt: 'edit', negativePrompt: null,
      count: 1, width: 3, height: 2, model: 'fake-image-edit-v1',
    });
    expect(provider.name).toBe('fake');
    expect(generated.images).toHaveLength(1);
    const sharp = (await import('sharp')).default;
    await expect(sharp(generated.images[0]!.buffer).metadata()).resolves.toMatchObject({ width: 3, height: 2 });
    await expect(resolveAiImageEditProvider(
      'openai-images', 'gpt-image-1', 'FULL_EDIT', paidProviderConfig,
    ).generate({
      operation: 'FULL_EDIT', prompt: 'edit', negativePrompt: null,
      count: 1, width: 3, height: 2, model: 'gpt-image-1',
    })).rejects.toMatchObject({ code: 'PROVIDER_DISABLED' });
  });

  it('blocks the fake edit Provider in production even when called directly', () => {
    expect(() => assertAiImageEditProviderRuntime('fake', 'production'))
      .toThrowError(expect.objectContaining({ code: AI_IMAGE_EDIT_FAKE_PROVIDER_PRODUCTION_BLOCKED }));
    expect(() => resolveAiImageEditProvider(
      'fake', 'fake-image-edit-v1', 'FULL_EDIT', fakeProviderConfig, undefined,
      'production',
    ))
      .toThrowError(expect.objectContaining({ code: AI_IMAGE_EDIT_FAKE_PROVIDER_PRODUCTION_BLOCKED }));
  });

  it('requires an exact sandbox-verified OpenAI edit capability before creating the adapter', async () => {
    const createOpenAiEditProvider = vi.fn(() => ({
      name: 'openai-image-edits',
      edit: vi.fn(async () => ({ images: [] })),
    }));
    const source = { buffer: Buffer.from('source'), mimeType: 'image/png' as const };
    const endpointSha256 = aiImageProviderEndpointSha256(
      'openai-images',
      paidProviderConfig.baseUrl,
    );
    const exactCapability = () => ({
      provider: 'openai-images', model: 'gpt-image-1', operations: ['FULL_EDIT', 'INPAINT'] as const,
      maxReferences: 1, supportsMask: true, inputTransport: 'multipart' as const, resultMode: 'sync' as const,
      evidenceLevel: 'sandbox-verified' as const, evidence: 'test-only evidence',
      sandboxEvidence: [{
        endpointSha256,
        operation: 'FULL_EDIT' as const,
        inputTransport: 'multipart' as const,
        resultMode: 'sync' as const,
      }],
    });

    const disabled = resolveAiImageEditProvider(
      'openai-images', 'gpt-image-1', 'FULL_EDIT', paidProviderConfig, undefined,
      'production', { createOpenAiEditProvider },
    );
    await expect(disabled.generate({
      operation: 'FULL_EDIT', prompt: 'edit', negativePrompt: null,
      count: 1, width: 1024, height: 1024, model: 'gpt-image-1', inputImages: [source],
    })).rejects.toMatchObject({ code: 'PROVIDER_DISABLED' });
    expect(createOpenAiEditProvider).not.toHaveBeenCalled();

    const edit = vi.fn(async () => ({
      images: [{ buffer: Buffer.from('edited'), mimeType: 'image/png' }],
      actualCostCents: 7,
    }));
    const verified = resolveAiImageEditProvider(
      'openai-images', 'gpt-image-1', 'FULL_EDIT', paidProviderConfig, undefined,
      'production', {
        resolveCapability: exactCapability,
        createOpenAiEditProvider: () => ({ name: 'openai-image-edits', edit }),
      },
    );
    await expect(verified.generate({
      operation: 'FULL_EDIT', prompt: 'edit', negativePrompt: 'text',
      count: 1, width: 1024, height: 1024, model: 'gpt-image-1', inputImages: [source],
    })).resolves.toMatchObject({ actualCostCents: 7 });
    expect(edit).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'FULL_EDIT', images: [source], mask: null,
    }));

    const createInpaintProvider = vi.fn();
    const inpaint = resolveAiImageEditProvider(
      'openai-images', 'gpt-image-1', 'INPAINT', paidProviderConfig, undefined,
      'production', {
        resolveCapability: exactCapability,
        createOpenAiEditProvider: createInpaintProvider,
      },
    );
    await expect(inpaint.generate({
      operation: 'INPAINT', prompt: 'edit', negativePrompt: null,
      count: 1, width: 1024, height: 1024, model: 'gpt-image-1',
      inputImages: [source], mask: source,
    })).rejects.toMatchObject({ code: 'PROVIDER_DISABLED' });
    expect(createInpaintProvider).not.toHaveBeenCalled();
  });

  it('checks the generation master switch, tenant rollout and operation switch together', async () => {
    const values = new Map<string, unknown>([
      ['ai_image_generation_enabled', true],
      ['feature_ai_media_full_edit', false],
    ]);
    await expect(getAiImageEditDispatchAuthorization('owner-1', 'FULL_EDIT', {
      loadConfig: vi.fn(async (key: string) => values.get(key)) as any,
      getRolloutDecision: vi.fn(async () => ({
        enabled: true, revision: 1, reason: 'tenant_allowed' as const,
      })),
    })).resolves.toMatchObject({ enabled: false, reasonCode: 'feature_off' });
  });

  it('fails a paid edit before reading Provider config when dispatch authorization is revoked', async () => {
    const repository = {
      getById: vi.fn(async () => ({
        id: 'job-revoked', ownerUserId: 'owner-1', status: 'QUEUED', operation: 'INPAINT',
        provider: 'openai-images', model: 'gpt-image-1', estimatedCostCents: 7,
      })),
      markEnqueueFailed: vi.fn(async () => true),
    } as any;
    const getProviderConfig = vi.fn();
    const resolveProvider = vi.fn();
    const run = vi.fn();

    await processAiImageEditQueueJob('job-revoked', 1, {
      repository,
      getDispatchAuthorization: vi.fn(async () => ({
        enabled: false, reasonCode: 'feature_off', reason: 'INPAINT was disabled before Provider dispatch',
      })),
      getProviderConfig,
      resolveProvider,
      run,
    });

    expect(repository.markEnqueueFailed).toHaveBeenCalledWith('job-revoked', expect.objectContaining({
      errorCode: 'AI_IMAGE_EDIT_DISPATCH_REVOKED',
    }));
    expect(getProviderConfig).not.toHaveBeenCalled();
    expect(resolveProvider).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('requires an exact RESERVED cost reservation and nested Provider runtime contract', async () => {
    const requestFingerprint = 'b'.repeat(64);
    const baseJob = {
      id: 'job-paid', ownerUserId: 'owner-1', status: 'QUEUED', operation: 'FULL_EDIT',
      provider: 'openai-images', model: 'gpt-image-1', estimatedCostCents: 7,
      requestedImageCount: 1, width: 1024, height: 1024, requestFingerprint,
      operationConfig: {
        policyVersion: 'ai-image-edit-policy/1.0',
        providerRuntime: createAiImageProviderRuntimeContract(paidProviderConfig, {
          count: 1, width: 1024, height: 1024,
        }),
      },
    };
    const repositoryWithoutReservation = {
      getById: vi.fn(async () => ({ ...baseJob, costReservation: null })),
      markEnqueueFailed: vi.fn(async () => true),
    } as any;
    const getProviderConfig = vi.fn(async () => paidProviderConfig);

    await processAiImageEditQueueJob('job-paid', 1, {
      repository: repositoryWithoutReservation,
      getDispatchAuthorization: allowPaidDispatch,
      getProviderConfig,
    });
    expect(repositoryWithoutReservation.markEnqueueFailed).toHaveBeenCalledWith('job-paid', expect.objectContaining({
      errorCode: 'AI_IMAGE_COST_RESERVATION_REQUIRED',
    }));
    expect(getProviderConfig).not.toHaveBeenCalled();

    const repositoryChangedEndpoint = {
      getById: vi.fn(async () => ({
        ...baseJob,
        costReservation: {
          id: 'reservation-1', status: 'RESERVED', provider: 'openai-images', model: 'gpt-image-1',
          estimatedCostMinor: 7, maximumCostMinor: 7, requestFingerprint,
        },
      })),
      markEnqueueFailed: vi.fn(async () => true),
    } as any;
    const resolveProvider = vi.fn();
    await processAiImageEditQueueJob('job-paid', 1, {
      repository: repositoryChangedEndpoint,
      getDispatchAuthorization: allowPaidDispatch,
      getProviderConfig: vi.fn(async () => ({
        ...paidProviderConfig, baseUrl: 'https://relay.example/v1',
      })),
      resolveProvider,
    });
    expect(repositoryChangedEndpoint.markEnqueueFailed).toHaveBeenCalledWith('job-paid', expect.objectContaining({
      errorCode: 'PROVIDER_RUNTIME_CONTRACT_MISMATCH',
    }));
    expect(resolveProvider).not.toHaveBeenCalled();
  });

  it('rejects a legacy relay-labeled edit contract before resolving a Provider', async () => {
    const requestFingerprint = 'c'.repeat(64);
    const relayConfig = {
      provider: 'openai-images', baseUrl: 'https://relay.example/v1', apiKey: 'legacy-secret',
      model: 'gpt-image-1', costPerImageCents: 7,
    };
    const providerRuntime = {
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
        id: 'job-legacy-relay-edit', ownerUserId: 'owner-1', status: 'QUEUED',
        operation: 'FULL_EDIT', provider: 'openai-images', model: 'gpt-image-1',
        estimatedCostCents: 7, requestedImageCount: 1, width: 1024, height: 1024,
        requestFingerprint,
        operationConfig: { policyVersion: 'ai-image-edit-policy/1.0', providerRuntime },
        costReservation: {
          id: 'reservation-legacy', status: 'RESERVED', provider: 'openai-images',
          model: 'gpt-image-1', estimatedCostMinor: 7, maximumCostMinor: 7,
          requestFingerprint,
        },
      })),
      markEnqueueFailed: vi.fn(async () => true),
    } as any;
    const resolveProvider = vi.fn();
    const run = vi.fn();

    await processAiImageEditQueueJob('job-legacy-relay-edit', 1, {
      repository,
      getDispatchAuthorization: allowPaidDispatch,
      getProviderConfig: vi.fn(async () => relayConfig),
      resolveProvider,
      run,
    });

    expect(repository.markEnqueueFailed).toHaveBeenCalledWith(
      'job-legacy-relay-edit',
      expect.objectContaining({
        attemptCount: 1,
        errorCode: 'PROVIDER_RUNTIME_CONTRACT_MISMATCH',
        errorMessage:
          'The official OpenAI Images provider requires https://api.openai.com/v1; use custom for relays',
      }),
    );
    expect(resolveProvider).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects a legacy custom bare-origin edit hash before resolving a Provider', async () => {
    const requestFingerprint = 'd'.repeat(64);
    const relayConfig = {
      provider: 'custom', baseUrl: 'https://relay.example', apiKey: 'legacy-secret',
      model: 'relay-image-v2', costPerImageCents: 7,
    };
    const current = createAiImageProviderRuntimeContract(relayConfig, {
      count: 1, width: 1024, height: 1024,
    });
    const providerRuntime = {
      ...current,
      baseUrlSha256: createHash('sha256').update(relayConfig.baseUrl).digest('hex'),
    };
    const repository = {
      getById: vi.fn(async () => ({
        id: 'job-legacy-custom-edit', ownerUserId: 'owner-1', status: 'QUEUED',
        operation: 'FULL_EDIT', provider: 'custom', model: 'relay-image-v2',
        estimatedCostCents: 7, requestedImageCount: 1, width: 1024, height: 1024,
        requestFingerprint,
        operationConfig: { policyVersion: 'ai-image-edit-policy/1.0', providerRuntime },
        costReservation: {
          id: 'reservation-legacy-custom', status: 'RESERVED', provider: 'custom',
          model: 'relay-image-v2', estimatedCostMinor: 7, maximumCostMinor: 7,
          requestFingerprint,
        },
      })),
      markEnqueueFailed: vi.fn(async () => true),
    } as any;
    const resolveProvider = vi.fn();
    const run = vi.fn();

    await processAiImageEditQueueJob('job-legacy-custom-edit', 1, {
      repository,
      getDispatchAuthorization: allowPaidDispatch,
      getProviderConfig: vi.fn(async () => relayConfig),
      resolveProvider,
      run,
    });

    expect(repository.markEnqueueFailed).toHaveBeenCalledWith(
      'job-legacy-custom-edit',
      expect.objectContaining({
        attemptCount: 1,
        errorCode: 'PROVIDER_RUNTIME_CONTRACT_MISMATCH',
        errorMessage: 'Active Provider identity does not match the frozen runtime contract',
      }),
    );
    expect(resolveProvider).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('persists and rejects queued fake edit jobs in production before resolving or running a Provider', async () => {
    const repository = {
      getById: vi.fn(async () => ({
        id: 'job-production-fake', status: 'QUEUED', attemptCount: 0,
        provider: 'fake', model: 'fake-image-edit-v1',
      })),
      markEnqueueFailed: vi.fn(async () => true),
      markFailed: vi.fn(),
    } as any;
    const resolveProvider = vi.fn();
    const run = vi.fn();

    await expect(processAiImageEditQueueJob('job-production-fake', 1, {
      repository,
      nodeEnv: 'production',
      resolveProvider,
      run,
      acquireLease: vi.fn(async () => true),
      releaseLease: vi.fn(async () => undefined),
    })).rejects.toMatchObject({ code: AI_IMAGE_EDIT_FAKE_PROVIDER_PRODUCTION_BLOCKED });

    expect(repository.markEnqueueFailed).toHaveBeenCalledWith('job-production-fake', expect.objectContaining({
      errorCode: AI_IMAGE_EDIT_FAKE_PROVIDER_PRODUCTION_BLOCKED,
    }));
    expect(resolveProvider).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('dispatches through the dedicated edit runner without sharing the generation worker', async () => {
    const repository = {
      getById: vi.fn(async () => ({
        id: 'job-1', status: 'QUEUED', operation: 'FULL_EDIT',
        provider: 'fake', model: 'fake-image-edit-v1',
      })),
      markEnqueueFailed: vi.fn(),
    } as any;
    const run = vi.fn(async () => 'completed' as const);
    await processAiImageEditQueueJob('job-1', 1, {
      repository,
      getProviderConfig: vi.fn(async () => fakeProviderConfig),
      resolveProvider: vi.fn(() => resolveAiImageEditProvider(
        'fake', 'fake-image-edit-v1', 'FULL_EDIT', fakeProviderConfig,
      )),
      uploadBuffer: vi.fn(),
      loadInputBuffer: vi.fn(),
      run,
    });
    expect(run).toHaveBeenCalledWith('job-1', 1, expect.objectContaining({ repository }));
  });

  it('does not enter a second runner while another worker owns the execution lease', async () => {
    const repository = {
      getById: vi.fn(), markFailed: vi.fn(),
    } as any;
    const run = vi.fn();
    const releaseLease = vi.fn();

    await expect(processAiImageEditQueueJob('job-1', 1, {
      repository,
      run,
      acquireLease: vi.fn(async () => false),
      releaseLease,
    })).resolves.toBe('ignored');

    expect(repository.getById).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(releaseLease).not.toHaveBeenCalled();
  });

  it('fails a queued job explicitly when execution lease infrastructure is unavailable', async () => {
    const infrastructureError = new Error('redis lease unavailable');
    const repository = {
      getById: vi.fn(),
      markEnqueueFailed: vi.fn(async () => true),
      markFailed: vi.fn(),
    } as any;
    const releaseLease = vi.fn();

    await expect(processAiImageEditQueueJob('job-1', 1, {
      repository,
      acquireLease: vi.fn(async () => { throw infrastructureError; }),
      releaseLease,
    })).rejects.toBe(infrastructureError);

    expect(repository.markEnqueueFailed).toHaveBeenCalledWith('job-1', {
      attemptCount: 1,
      errorCode: 'EDIT_EXECUTION_LEASE_UNAVAILABLE',
      errorMessage: 'AI image edit execution coordination is temporarily unavailable',
    });
    expect(repository.getById).not.toHaveBeenCalled();
    expect(repository.markFailed).not.toHaveBeenCalled();
    expect(releaseLease).not.toHaveBeenCalled();
  });

  it('fails an interrupted RUNNING attempt only after exclusively reclaiming its lease', async () => {
    const repository = {
      getById: vi.fn(async () => ({
        id: 'job-1', status: 'RUNNING', operation: 'FULL_EDIT',
        provider: 'fake', model: 'fake-image-edit-v1', attemptCount: 1,
      })),
      markFailed: vi.fn(),
    } as any;
    const releaseLease = vi.fn();

    await expect(processAiImageEditQueueJob('job-1', 2, {
      repository,
      acquireLease: vi.fn(async () => true),
      renewLease: vi.fn(async () => true),
      releaseLease,
    })).rejects.toMatchObject({ code: 'EDIT_RECOVERY_REQUIRED' });

    expect(repository.markFailed).toHaveBeenCalledWith('job-1', expect.objectContaining({
      attemptCount: 2, errorCode: 'EDIT_RECOVERY_REQUIRED',
    }));
    expect(releaseLease).toHaveBeenCalledOnce();
  });
});
