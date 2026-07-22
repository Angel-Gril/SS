import { describe, expect, it, vi } from 'vitest';
import {
  createExtensionMediaTranslationLauncher,
  ExtensionMediaWorkflowLaunchError,
  resolveExtensionMediaWorkflowSourceMediaKey,
  type ExtensionMediaTranslationExistingWorkflow,
} from '../services/extension-media-workflow-launch.js';

function workflow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'media-created-1', ownerUserId: 'owner-1', actorUserId: 'owner-1',
    operation: 'IMAGE_TRANSLATE', status: 'QUEUED', reviewStatus: 'NOT_READY',
    revision: 1, currentAttempt: 1, contextType: 'listing-draft',
    contextId: 'listing-1', contextSkuKey: null, contextSlotKey: null,
    contextDraftRevision: 11, contextDraftVersion: 7, suiteId: null,
    idempotencyKey: 'extension-translation-intent-1', requestFingerprint: 'a'.repeat(64),
    selectedOutputAssetId: null, createdAt: new Date(), updatedAt: new Date(), completedAt: null,
    jobs: [{ provider: 'fake', model: 'fake-translation-v1' }],
    ...overrides,
  } as any;
}

function command(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'ai-media-workflow-create/v1',
    action: 'CREATE_TRANSLATION',
    sourceMediaKey: 'media-main-1',
    draftRevision: 11,
    workflowOperationKey: 'extension-translation-intent-1',
    ...overrides,
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    ownerUserId: 'owner-1', actorUserId: 'owner-1', shopId: 'shop-1',
    listingWorkflowId: 'listing-1', draftVersion: 7,
    idempotencyKey: 'extension-translation-attempt-1',
    command: command(),
    ...overrides,
  } as any;
}

function setup(options: {
  production?: boolean;
  provider?: string;
  replayed?: boolean;
  sourceMediaKeys?: string[];
  storageReady?: boolean;
  existing?: Record<string, unknown> | null;
  existingError?: Error;
  createError?: Error;
  createdSuiteId?: string;
} = {}) {
  const createImageTranslation = vi.fn(async () => {
    if (options.createError) throw options.createError;
    return {
      workflow: workflow(options.createdSuiteId ? { suiteId: options.createdSuiteId } : {}),
      jobId: 'job-created-1',
      replayed: options.replayed === true,
    };
  });
  const loadContext = vi.fn(async () => ({
    id: 'listing-1', ownerUserId: 'owner-1', shopId: 'shop-1',
    supplyGoodsId: 'goods-1', snapshotId: 'snapshot-1',
    revision: 11, draftVersion: 7,
    sourceMediaKeys: options.sourceMediaKeys || ['media-main-1'],
  }));
  const internalizeSource = vi.fn(async () => ({ id: 'source-asset-1' }));
  const resolvePrompt = vi.fn(async () => ({
    templateKey: 'image-translation.base',
    release: { id: 'release-1' },
    checksum: 'b'.repeat(64),
    snapshot: { version: 1 },
    resolvedPrompt: 'Translate visible Chinese copy to Russian.',
    resolvedNegativePrompt: 'Keep numbers and product identity.',
  }));
  const enqueue = vi.fn(async () => undefined);
  const markEnqueueFailed = vi.fn(async () => true);
  const loadExisting = vi.fn(async (): Promise<ExtensionMediaTranslationExistingWorkflow | null> => {
    if (options.existingError) throw options.existingError;
    return options.existing as ExtensionMediaTranslationExistingWorkflow | null || null;
  });
  const launch = createExtensionMediaTranslationLauncher({
    workflowService: { createImageTranslation } as any,
    loadContext,
    loadExisting,
    internalizeSource,
    getSettings: vi.fn(async () => ({
      enabled: true,
      provider: options.provider || 'fake',
      model: 'fake-translation-v1',
      dailyLimit: 5,
      estimatedCostCents: 0,
    })),
    getStorageReadiness: vi.fn(async () => ({
      ready: options.storageReady !== false,
      reason: 'storage unavailable',
    })),
    resolvePrompt,
    enqueue,
    markEnqueueFailed,
    production: options.production ?? false,
  });
  return {
    launch, createImageTranslation, loadContext, internalizeSource,
    resolvePrompt, enqueue, markEnqueueFailed, loadExisting,
  };
}

describe('extension media translation launch', () => {
  it('recovers the original source key from an internalized edit asset metadata snapshot', () => {
    expect(resolveExtensionMediaWorkflowSourceMediaKey({
      sourceMediaKey: 'ai-edit-source:v1:hash',
      metadata: { originalSourceMediaKey: 'media-main-1' },
    })).toBe('media-main-1');
    expect(resolveExtensionMediaWorkflowSourceMediaKey({
      sourceMediaKey: 'media-main-1', metadata: null,
    })).toBe('media-main-1');
    expect(resolveExtensionMediaWorkflowSourceMediaKey({
      sourceMediaKey: ' media-main-1', metadata: null,
    })).toBeNull();
  });

  it('derives the fake provider, fixed languages, prompt snapshot, and context on the server', async () => {
    const state = setup();
    await expect(state.launch(input())).resolves.toEqual({
      workflowId: 'media-created-1', action: 'CREATE_TRANSLATION',
      operation: 'IMAGE_TRANSLATE', status: 'QUEUED', revision: 1, replayed: false,
    });
    expect(state.loadContext).toHaveBeenCalledWith({
      ownerUserId: 'owner-1', listingWorkflowId: 'listing-1',
      draftRevision: 11, draftVersion: 7,
    });
    expect(state.internalizeSource).toHaveBeenCalledWith({
      ownerUserId: 'owner-1', listingWorkflowId: 'listing-1',
      sourceMediaKey: 'media-main-1', draftRevision: 11, draftVersion: 7,
    });
    expect(state.resolvePrompt).toHaveBeenCalledWith({
      templateKey: 'image-translation.base',
      variables: {
        sourceLanguage: 'zh', targetLanguage: 'ru', userInstructions: '',
        terminologyJson: '{"terms":[]}', platformConstraints: '',
      },
    });
    expect(state.createImageTranslation).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 'owner-1', actorUserId: 'owner-1', sourceAssetId: 'source-asset-1',
      sourceLanguage: 'zh', targetLanguage: 'ru', terminologies: [], imageSegment: false,
      provider: 'fake', model: 'fake-translation-v1', estimatedCostCents: 0,
      idempotencyKey: 'extension-translation-intent-1',
      templateKey: 'image-translation.base', templateReleaseId: 'release-1',
      context: { type: 'listing-draft', id: 'listing-1', revision: 11, draftVersion: 7 },
    }));
    expect(state.enqueue).toHaveBeenCalledWith('job-created-1');
  });

  it.each([
    ['provider', 'dashscope-qwen-mt-image'],
    ['model', 'client-model'],
    ['apiKey', 'secret'],
    ['resolvedPrompt', 'client prompt'],
  ])('rejects a client-injected %s before any side effect', async (field, value) => {
    const state = setup();
    await expect(state.launch(input({ command: command({ [field]: value }) }))).rejects.toEqual(
      expect.objectContaining<Partial<ExtensionMediaWorkflowLaunchError>>({ code: 'MEDIA_CREATE_INVALID' }),
    );
    expect(state.loadContext).not.toHaveBeenCalled();
    expect(state.internalizeSource).not.toHaveBeenCalled();
    expect(state.createImageTranslation).not.toHaveBeenCalled();
  });

  it.each([
    ['production fake', { production: true }, 'MEDIA_PROVIDER_NOT_ALLOWED'],
    ['paid provider', { provider: 'dashscope-qwen-mt-image' }, 'MEDIA_PROVIDER_NOT_ALLOWED'],
    ['storage unavailable', { storageReady: false }, 'MEDIA_STORAGE_NOT_READY'],
  ])('fails closed for %s before internalizing the image', async (_label, options, code) => {
    const state = setup(options);
    await expect(state.launch(input())).rejects.toEqual(
      expect.objectContaining<Partial<ExtensionMediaWorkflowLaunchError>>({ code }),
    );
    expect(state.loadContext).not.toHaveBeenCalled();
    expect(state.internalizeSource).not.toHaveBeenCalled();
  });

  it('rejects a source media key that is not in the exact current draft context', async () => {
    const state = setup({ sourceMediaKeys: ['other-media'] });
    await expect(state.launch(input())).rejects.toEqual(
      expect.objectContaining<Partial<ExtensionMediaWorkflowLaunchError>>({
        code: 'MEDIA_CREATE_CONTEXT_STALE',
      }),
    );
    expect(state.internalizeSource).not.toHaveBeenCalled();
    expect(state.createImageTranslation).not.toHaveBeenCalled();
  });

  it('uses the durable workflow operation key rather than the per-attempt grant key', async () => {
    const state = setup({ replayed: true });
    await state.launch(input({ idempotencyKey: 'extension-translation-attempt-2' }));
    expect(state.createImageTranslation).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: 'extension-translation-intent-1',
    }));
    expect(state.enqueue).toHaveBeenCalledWith('job-created-1');
  });

  it('replays an existing queued workflow and re-enqueues only that frozen job', async () => {
    const state = setup({ existing: {
      id: 'existing-queued', ownerUserId: 'owner-1', operation: 'IMAGE_TRANSLATE',
      provider: 'fake', status: 'QUEUED', revision: 4,
      contextType: 'listing-draft', contextId: 'listing-1',
      contextDraftRevision: 11, contextDraftVersion: 7,
      sourceMediaKey: 'media-main-1', jobId: 'frozen-job-4',
    } });
    await expect(state.launch(input({ command: command({ workflowOperationKey: 'replay-key' }) }))).resolves.toEqual({
      workflowId: 'existing-queued', action: 'CREATE_TRANSLATION',
      operation: 'IMAGE_TRANSLATE', status: 'QUEUED', revision: 4, replayed: true,
    });
    expect(state.enqueue).toHaveBeenCalledTimes(1);
    expect(state.enqueue).toHaveBeenCalledWith('frozen-job-4');
    expect(state.createImageTranslation).not.toHaveBeenCalled();
    expect(state.loadContext).not.toHaveBeenCalled();
    expect(state.resolvePrompt).not.toHaveBeenCalled();
  });

  it('does not re-enqueue a queued fake workflow after the production gate closes', async () => {
    const state = setup({ production: true, existing: {
      id: 'existing-queued-prod', ownerUserId: 'owner-1', operation: 'IMAGE_TRANSLATE',
      provider: 'fake', status: 'QUEUED', revision: 5,
      contextType: 'listing-draft', contextId: 'listing-1',
      contextDraftRevision: 11, contextDraftVersion: 7,
      sourceMediaKey: 'media-main-1', jobId: 'frozen-job-5',
    } });
    await expect(state.launch(input())).rejects.toEqual(
      expect.objectContaining<Partial<ExtensionMediaWorkflowLaunchError>>({
        code: 'MEDIA_PROVIDER_NOT_ALLOWED',
      }),
    );
    expect(state.enqueue).not.toHaveBeenCalled();
  });

  it('classifies an idempotency lookup outage as a retryable service failure', async () => {
    const state = setup({ existingError: new Error('database unavailable') });
    await expect(state.launch(input())).rejects.toEqual(
      expect.objectContaining<Partial<ExtensionMediaWorkflowLaunchError>>({
        code: 'MEDIA_CREATE_STATE_UNAVAILABLE',
      }),
    );
    expect(state.loadContext).not.toHaveBeenCalled();
    expect(state.internalizeSource).not.toHaveBeenCalled();
  });

  it('does not enqueue a terminal replay and does not reread current Provider or Prompt settings', async () => {
    const state = setup({
      provider: 'dashscope-qwen-mt-image',
      existing: {
        id: 'existing-succeeded', ownerUserId: 'owner-1', operation: 'IMAGE_TRANSLATE',
        provider: 'fake', status: 'SUCCEEDED', revision: 9,
        contextType: 'listing-draft', contextId: 'listing-1',
        contextDraftRevision: 11, contextDraftVersion: 7,
        sourceMediaKey: 'media-main-1', jobId: 'frozen-job-9',
      },
    });
    await expect(state.launch(input({ command: command({ workflowOperationKey: 'replay-key-2' }) }))).resolves.toMatchObject({
      workflowId: 'existing-succeeded', status: 'SUCCEEDED', replayed: true,
    });
    expect(state.enqueue).not.toHaveBeenCalled();
    expect(state.createImageTranslation).not.toHaveBeenCalled();
    expect(state.resolvePrompt).not.toHaveBeenCalled();
  });

  it('rejects a replay whose frozen context or source differs from the command', async () => {
    const state = setup({ existing: {
      id: 'existing-conflict', ownerUserId: 'owner-1', operation: 'IMAGE_TRANSLATE',
      provider: 'fake', status: 'QUEUED', revision: 2,
      contextType: 'listing-draft', contextId: 'other-listing',
      contextDraftRevision: 11, contextDraftVersion: 7,
      sourceMediaKey: 'media-main-1', jobId: 'frozen-job-2',
    } });
    await expect(state.launch(input())).rejects.toEqual(
      expect.objectContaining<Partial<ExtensionMediaWorkflowLaunchError>>({
        code: 'MEDIA_CREATE_IDEMPOTENCY_CONFLICT',
      }),
    );
    expect(state.enqueue).not.toHaveBeenCalled();
    expect(state.createImageTranslation).not.toHaveBeenCalled();
  });

  it('never replays a workflow owned by a media suite', async () => {
    const state = setup({ existing: {
      id: 'suite-child', ownerUserId: 'owner-1', operation: 'IMAGE_TRANSLATE',
      provider: 'fake', status: 'SUCCEEDED', revision: 3,
      contextType: 'listing-draft', contextId: 'listing-1',
      contextDraftRevision: 11, contextDraftVersion: 7,
      suiteId: 'suite-1', sourceMediaKey: 'media-main-1', jobId: 'suite-job-3',
    } });
    await expect(state.launch(input())).rejects.toEqual(
      expect.objectContaining<Partial<ExtensionMediaWorkflowLaunchError>>({
        code: 'MEDIA_CREATE_IDEMPOTENCY_CONFLICT',
      }),
    );
    expect(state.createImageTranslation).not.toHaveBeenCalled();
  });

  it('rejects a suite child returned by a repository idempotency race', async () => {
    const state = setup({ replayed: true, createdSuiteId: 'suite-race-1' });
    await expect(state.launch(input())).rejects.toEqual(
      expect.objectContaining<Partial<ExtensionMediaWorkflowLaunchError>>({
        code: 'MEDIA_CREATE_IDEMPOTENCY_CONFLICT',
      }),
    );
    expect(state.enqueue).not.toHaveBeenCalled();
  });

  it('marks a committed workflow failed when queue submission is unavailable', async () => {
    const state = setup();
    state.enqueue.mockRejectedValueOnce(new Error('redis unavailable'));
    await expect(state.launch(input())).rejects.toEqual(
      expect.objectContaining<Partial<ExtensionMediaWorkflowLaunchError>>({
        code: 'MEDIA_QUEUE_UNAVAILABLE',
      }),
    );
    expect(state.markEnqueueFailed).toHaveBeenCalledWith('job-created-1');
  });

  it('classifies an unknown workflow persistence failure as a retryable state outage', async () => {
    const state = setup({ createError: new Error('database unavailable') });
    await expect(state.launch(input())).rejects.toEqual(
      expect.objectContaining<Partial<ExtensionMediaWorkflowLaunchError>>({
        code: 'MEDIA_CREATE_STATE_UNAVAILABLE',
      }),
    );
    expect(state.enqueue).not.toHaveBeenCalled();
  });
});
