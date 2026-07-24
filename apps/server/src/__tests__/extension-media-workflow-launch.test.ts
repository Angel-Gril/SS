import { describe, expect, it, vi } from 'vitest';
import {
  createExtensionMediaWorkflowLauncher,
  createExtensionMediaTranslationLauncher,
  ExtensionMediaWorkflowLaunchError,
  parseExtensionMediaWorkflowCreateCommand,
  resolveExtensionMediaWorkflowSourceMediaKey,
  type ExtensionMediaTranslationExistingWorkflow,
} from '../services/extension-media-workflow-launch.js';
import { AI_IMAGE_EDIT_MASK_SEMANTICS } from '../services/ai-image-compositor.js';
import {
  AI_MEDIA_FULL_EDIT_TEMPLATE_KEY,
  AI_MEDIA_INPAINT_TEMPLATE_KEY,
} from '../services/ai-prompt-templates.js';

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

function translationExisting(status: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 'media-created-1', ownerUserId: 'owner-1', operation: 'IMAGE_TRANSLATE',
    provider: 'fake', model: 'fake-translation-v1', status, revision: 2,
    contextType: 'listing-draft', contextId: 'listing-1',
    contextDraftRevision: 11, contextDraftVersion: 7, suiteId: null,
    sourceMediaKey: 'media-main-1', jobId: 'job-created-1',
    ...overrides,
  };
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
  model?: string;
  replayed?: boolean;
  sourceMediaKeys?: string[];
  storageReady?: boolean;
  existing?: Record<string, unknown> | null;
  existingError?: Error;
  createError?: Error;
  createdSuiteId?: string;
  createdStatus?: string;
  category?: { categoryId: number; typeId: number };
  categoryGlossaryJson?: string;
  estimatedCostCents?: number;
  promptError?: Error;
} = {}) {
  const createImageTranslation = vi.fn(async () => {
    if (options.createError) throw options.createError;
    return {
      workflow: workflow({
        ...(options.createdSuiteId ? { suiteId: options.createdSuiteId } : {}),
        ...(options.createdStatus ? { status: options.createdStatus } : {}),
      }),
      jobId: 'job-created-1',
      replayed: options.replayed === true,
    };
  });
  const loadContext = vi.fn(async () => ({
    id: 'listing-1', ownerUserId: 'owner-1', shopId: 'shop-1',
    supplyGoodsId: 'goods-1', snapshotId: 'snapshot-1',
    revision: 11, draftVersion: 7,
    sourceMediaKeys: options.sourceMediaKeys || ['media-main-1'],
    ...(options.category ? { category: options.category } : {}),
  }));
  const internalizeSource = vi.fn(async () => ({ id: 'source-asset-1' }));
  const resolvePrompt = vi.fn(async () => {
    if (options.promptError) throw options.promptError;
    return {
      templateKey: 'image-translation.base',
      release: { id: 'release-1' },
      checksum: 'b'.repeat(64),
      snapshot: { version: 1 },
      resolvedPrompt: 'Translate visible Chinese copy to Russian.',
      resolvedNegativePrompt: 'Keep numbers and product identity.',
    };
  });
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
      model: options.model || 'fake-translation-v1',
      dailyLimit: 5,
      estimatedCostCents: options.estimatedCostCents ?? 0,
      globalDailyBudgetCents: 100,
      categoryGlossaryJson: options.categoryGlossaryJson || '',
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

function v2Command(
  operation: 'IMAGE_TO_IMAGE' | 'FULL_EDIT' | 'INPAINT',
  overrides: Record<string, unknown> = {},
) {
  return {
    schemaVersion: 'ai-media-workflow-create/v2',
    action: 'CREATE_WORKFLOW',
    operation,
    sourceMediaKeys: operation === 'IMAGE_TO_IMAGE'
      ? ['media-main-1', 'media-detail-1']
      : ['media-main-1'],
    prompt: 'Keep the product identity and improve the background.',
    negativePrompt: '',
    draftRevision: 11,
    workflowOperationKey: `extension-media-workflow:${operation.toLowerCase()}-1`,
    ...(operation === 'INPAINT' ? {
      maskAssetId: 'mask-asset-1',
      maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
    } : {}),
    ...overrides,
  };
}

function v2Existing(status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED', overrides: Record<string, unknown> = {}) {
  return {
    id: `media-existing-${status.toLowerCase()}`,
    ownerUserId: 'owner-1',
    operation: 'IMAGE_TO_IMAGE',
    provider: 'fake',
    model: 'fake-image-to-image-v1',
    status,
    revision: 2,
    contextType: 'listing-draft',
    contextId: 'listing-1',
    contextDraftRevision: 11,
    contextDraftVersion: 7,
    suiteId: null,
    sourceMediaKey: null,
    sourceMediaKeys: ['media-main-1', 'media-detail-1'],
    maskAssetId: null,
    prompt: 'Keep the product identity and improve the background.',
    negativePrompt: null,
    jobId: 'generation-job-existing-1',
    ...overrides,
  };
}

const paidStandaloneReadiness = {
  enabled: true,
  ready: true,
  reasonCode: 'READY',
  reason: 'paid provider ready',
  provider: 'openai-images',
  model: 'gpt-image-1',
  baseUrl: 'https://api.openai.com/v1',
  costPerImageCents: 9,
  globalDailyBudgetCents: 1_000,
  evidenceLevel: 'sandbox-verified',
} as const;

const paidImageToImageRuntimeContract = {
  contractVersion: 'ai-image-provider-runtime/v1',
  provider: 'openai-images',
  model: 'gpt-image-1',
  baseUrlSha256: 'd9617135d6fdd0a2cde722d637a1dfcc3da37515708b3ea5d66ae607c8ac785e',
  unitCostCents: 9,
  imageCount: 1,
  width: 1024,
  height: 1024,
  maximumCostCents: 9,
} as const;

function paidV2Existing(
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED',
  overrides: Record<string, unknown> = {},
) {
  return v2Existing(status, {
    provider: 'openai-images',
    model: 'gpt-image-1',
    estimatedCostCents: 9,
    providerRuntimeContract: paidImageToImageRuntimeContract,
    ...overrides,
  });
}

function setupV2(options: {
  production?: boolean;
  ready?: boolean;
  readiness?: {
    enabled: boolean;
    ready: boolean;
    reasonCode: string;
    reason: string;
    testOnly?: boolean;
    operation?: string;
    provider?: string;
    model?: string;
    baseUrl?: string;
    costPerImageCents?: number;
    globalDailyBudgetCents?: number;
    evidenceLevel?: string;
  };
  existing?: any;
  createError?: Error;
  replayed?: boolean;
  createdStatus?: string;
} = {}) {
  const createImageToImage = vi.fn(async () => {
    if (options.createError) throw options.createError;
    return {
      workflow: workflow({
        operation: 'IMAGE_TO_IMAGE',
        ...(options.createdStatus ? { status: options.createdStatus } : {}),
      }),
      jobId: 'generation-job-1', replayed: options.replayed === true,
    };
  });
  const createImageEdit = vi.fn(async (createInput: any) => {
    if (options.createError) throw options.createError;
    return {
      workflow: workflow({
        operation: createInput.operation,
        ...(options.createdStatus ? { status: options.createdStatus } : {}),
      }),
      jobId: 'edit-job-1', replayed: options.replayed === true,
    };
  });
  const internalizeSource = vi.fn(async (source: { sourceMediaKey: string }) => ({
    id: source.sourceMediaKey === 'media-main-1' ? 'source-asset-1' : 'source-asset-2',
    width: source.sourceMediaKey === 'media-main-1' ? 640 : 800,
    height: source.sourceMediaKey === 'media-main-1' ? 480 : 600,
  }));
  const resolvePrompt = vi.fn(async ({ templateKey }: { templateKey: string }) => ({
    templateKey,
    release: { id: 'release-edit-1' },
    checksum: 'c'.repeat(64),
    snapshot: { version: 1 },
    resolvedPrompt: 'Frozen edit prompt',
    resolvedNegativePrompt: 'Frozen edit negative prompt',
  }));
  const enqueueGeneration = vi.fn(async () => undefined);
  const enqueueEdit = vi.fn(async () => undefined);
  const loadContext = vi.fn(async () => ({
    id: 'listing-1', ownerUserId: 'owner-1', shopId: 'shop-1',
    supplyGoodsId: 'goods-1', snapshotId: 'snapshot-1', revision: 11, draftVersion: 7,
    sourceMediaKeys: ['media-main-1', 'media-detail-1'],
  }));
  const loadExisting = vi.fn(async () => options.existing || null);
  const getReadiness = vi.fn(async (operation: string) => options.readiness || ({
    enabled: options.ready !== false,
    ready: options.ready !== false,
    reasonCode: options.ready !== false ? 'READY' : 'AI_MEDIA_OPERATION_DISABLED',
    reason: options.ready !== false ? 'ready' : 'disabled',
    testOnly: true,
    operation,
  }));
  const markEnqueueFailed = vi.fn(async () => true);
  const launch = createExtensionMediaWorkflowLauncher({
    workflowService: { createImageToImage, createImageEdit } as any,
    loadContext,
    loadExisting,
    internalizeSource,
    getReadiness,
    getEditDailyLimit: vi.fn(async () => 4),
    resolvePrompt,
    enqueueGeneration,
    enqueueEdit,
    markEnqueueFailed,
    production: options.production ?? false,
  });
  return {
    launch, createImageToImage, createImageEdit, internalizeSource,
    resolvePrompt, enqueueGeneration, enqueueEdit, loadContext,
    loadExisting, getReadiness, markEnqueueFailed,
  };
}

describe('extension media translation launch', () => {
  it('parses only the strict v2 standalone create union', () => {
    const base = {
      schemaVersion: 'ai-media-workflow-create/v2',
      action: 'CREATE_WORKFLOW',
      prompt: 'Keep the product identity and improve the background.',
      negativePrompt: '',
      draftRevision: 11,
      workflowOperationKey: 'extension-media-workflow:v2-create-1',
    };
    expect(parseExtensionMediaWorkflowCreateCommand({
      ...base,
      operation: 'IMAGE_TO_IMAGE',
      sourceMediaKeys: ['media-main-1', 'media-detail-1'],
    })).toEqual({
      ...base,
      operation: 'IMAGE_TO_IMAGE',
      sourceMediaKeys: ['media-main-1', 'media-detail-1'],
    });
    expect(parseExtensionMediaWorkflowCreateCommand({
      ...base,
      operation: 'FULL_EDIT',
      sourceMediaKeys: ['media-main-1'],
    })).toEqual({
      ...base,
      operation: 'FULL_EDIT',
      sourceMediaKeys: ['media-main-1'],
    });
    expect(parseExtensionMediaWorkflowCreateCommand({
      ...base,
      operation: 'INPAINT',
      sourceMediaKeys: ['media-main-1'],
      maskAssetId: 'mask-asset-1',
      maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
    })).toEqual({
      ...base,
      operation: 'INPAINT',
      sourceMediaKeys: ['media-main-1'],
      maskAssetId: 'mask-asset-1',
      maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
    });

    for (const invalid of [
      { ...base, operation: 'IMAGE_TO_IMAGE', sourceMediaKeys: [] },
      { ...base, operation: 'IMAGE_TO_IMAGE', sourceMediaKeys: ['1', '2', '3', '4', '5'] },
      { ...base, operation: 'FULL_EDIT', sourceMediaKeys: ['1', '2'] },
      { ...base, operation: 'INPAINT', sourceMediaKeys: ['1'], maskAssetId: 'mask-1' },
      { ...base, operation: 'INPAINT', sourceMediaKeys: ['1'], maskAssetId: 'mask-1', maskSemantics: 'WHITE_KEEP' },
      { ...base, operation: 'FULL_EDIT', sourceMediaKeys: ['1'], provider: 'client-provider' },
    ]) {
      expect(() => parseExtensionMediaWorkflowCreateCommand(invalid)).toThrow(
        expect.objectContaining({ code: 'MEDIA_CREATE_INVALID' }),
      );
    }
  });

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
      globalDailyBudgetCents: 100,
      idempotencyKey: 'extension-translation-intent-1',
      templateKey: 'image-translation.base', templateReleaseId: 'release-1',
      context: { type: 'listing-draft', id: 'listing-1', revision: 11, draftVersion: 7 },
    }));
    expect(state.enqueue).toHaveBeenCalledWith('job-created-1');
  });

  it('passes the exact trusted category and type glossary terms into translation creation', async () => {
    const configuredTerms = [
      { src: '杯子', tgt: 'кружка' },
      { src: '容量', tgt: 'объём' },
    ];
    const resolvedTerms = [
      { src: '容量', tgt: 'объём' },
      { src: '杯子', tgt: 'кружка' },
    ];
    const state = setup({
      category: { categoryId: 1, typeId: 1 },
      categoryGlossaryJson: JSON.stringify({
        version: 1,
        profiles: [{
          sourceLanguage: 'zh', targetLanguage: 'ru', categoryId: 1, typeId: 1,
          terms: configuredTerms,
        }],
      }),
    });

    await expect(state.launch(input())).resolves.toMatchObject({
      action: 'CREATE_TRANSLATION', status: 'QUEUED', replayed: false,
    });
    expect(state.resolvePrompt).toHaveBeenCalledWith(expect.objectContaining({
      variables: expect.objectContaining({ terminologyJson: JSON.stringify({ terms: resolvedTerms }) }),
    }));
    expect(state.createImageTranslation).toHaveBeenCalledWith(expect.objectContaining({
      sourceLanguage: 'zh', targetLanguage: 'ru', terminologies: resolvedTerms,
    }));
  });

  it.each([
    ['empty category glossary', {
      category: { categoryId: 1, typeId: 1 },
      categoryGlossaryJson: '{"version":1,"profiles":[]}',
    }],
    ['missing trusted category', {
      categoryGlossaryJson: JSON.stringify({
        version: 1,
        profiles: [{
          sourceLanguage: 'zh', targetLanguage: 'ru',
          terms: [{ src: '杯子', tgt: 'кружка' }],
        }],
      }),
    }],
  ] as const)('blocks a paid translation with %s before create or queue', async (_label, glossary) => {
    const state = setup({
      provider: 'dashscope-qwen-mt-image', model: 'qwen-mt-image', estimatedCostCents: 5,
      ...glossary,
    });

    await expect(state.launch(input())).rejects.toEqual(expect.objectContaining({
      code: 'IMAGE_TRANSLATION_GLOSSARY_NOT_READY',
    }));
    expect(state.loadContext).toHaveBeenCalledTimes(1);
    expect(state.internalizeSource).not.toHaveBeenCalled();
    expect(state.resolvePrompt).not.toHaveBeenCalled();
    expect(state.createImageTranslation).not.toHaveBeenCalled();
    expect(state.enqueue).not.toHaveBeenCalled();
  });

  it('keeps the paid provider dark after the trusted category glossary is ready', async () => {
    const state = setup({
      provider: 'dashscope-qwen-mt-image', model: 'qwen-mt-image', estimatedCostCents: 5,
      category: { categoryId: 1, typeId: 1 },
      categoryGlossaryJson: JSON.stringify({
        version: 1,
        profiles: [{
          sourceLanguage: 'zh', targetLanguage: 'ru', categoryId: 1, typeId: 1,
          terms: [{ src: '杯子', tgt: 'кружка' }],
        }],
      }),
    });

    await expect(state.launch(input())).rejects.toEqual(expect.objectContaining({
      code: 'MEDIA_PROVIDER_NOT_ALLOWED',
    }));
    expect(state.loadContext).toHaveBeenCalledTimes(1);
    expect(state.internalizeSource).not.toHaveBeenCalled();
    expect(state.createImageTranslation).not.toHaveBeenCalled();
    expect(state.enqueue).not.toHaveBeenCalled();
  });

  it('rejects an unavailable translation prompt before internalizing the source image', async () => {
    const state = setup({ promptError: new Error('compiled prompt exceeds limit') });

    await expect(state.launch(input())).rejects.toEqual(expect.objectContaining({
      code: 'MEDIA_PROMPT_UNAVAILABLE',
    }));
    expect(state.resolvePrompt).toHaveBeenCalledTimes(1);
    expect(state.internalizeSource).not.toHaveBeenCalled();
    expect(state.createImageTranslation).not.toHaveBeenCalled();
    expect(state.enqueue).not.toHaveBeenCalled();
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
      provider: 'fake', model: 'fake-translation-v1', status: 'QUEUED', revision: 4,
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
      provider: 'fake', model: 'fake-translation-v1', status: 'QUEUED', revision: 5,
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

  it('does not re-enqueue a queued translation after its frozen model changes', async () => {
    const state = setup({ model: 'fake-translation-v2', existing: {
      id: 'existing-queued-old-model', ownerUserId: 'owner-1', operation: 'IMAGE_TRANSLATE',
      provider: 'fake', model: 'fake-translation-v1', status: 'QUEUED', revision: 6,
      contextType: 'listing-draft', contextId: 'listing-1',
      contextDraftRevision: 11, contextDraftVersion: 7,
      sourceMediaKey: 'media-main-1', jobId: 'frozen-job-6',
    } });
    await expect(state.launch(input())).rejects.toEqual(
      expect.objectContaining<Partial<ExtensionMediaWorkflowLaunchError>>({
        code: 'MEDIA_PROVIDER_CONFIG_CHANGED',
      }),
    );
    expect(state.enqueue).not.toHaveBeenCalled();
  });

  it.each([
    ['FAILED', 'MEDIA_CREATE_ALREADY_FAILED'],
    ['CANCEL_REQUESTED', 'MEDIA_CREATE_ALREADY_CANCELLED'],
    ['CANCELLED', 'MEDIA_CREATE_ALREADY_CANCELLED'],
  ])('does not report an idempotent translation in %s as successfully created', async (status, code) => {
    const state = setup({ existing: {
      id: `existing-${String(status).toLowerCase()}`,
      ownerUserId: 'owner-1', operation: 'IMAGE_TRANSLATE',
      provider: 'fake', model: 'fake-translation-v1', status, revision: 7,
      contextType: 'listing-draft', contextId: 'listing-1',
      contextDraftRevision: 11, contextDraftVersion: 7,
      sourceMediaKey: 'media-main-1', jobId: 'frozen-job-7',
    } });
    await expect(state.launch(input())).rejects.toEqual(
      expect.objectContaining<Partial<ExtensionMediaWorkflowLaunchError>>({ code }),
    );
    expect(state.enqueue).not.toHaveBeenCalled();
  });

  it.each([
    ['FAILED', 'MEDIA_CREATE_ALREADY_FAILED'],
    ['CANCEL_REQUESTED', 'MEDIA_CREATE_ALREADY_CANCELLED'],
    ['CANCELLED', 'MEDIA_CREATE_ALREADY_CANCELLED'],
  ])('rejects a workflow-service translation replay that returns %s after an empty lookup', async (status, code) => {
    const state = setup({ replayed: true, createdStatus: status });
    await expect(state.launch(input())).rejects.toEqual(
      expect.objectContaining<Partial<ExtensionMediaWorkflowLaunchError>>({ code }),
    );
    expect(state.loadExisting).toHaveBeenCalledTimes(1);
    expect(state.createImageTranslation).toHaveBeenCalledTimes(1);
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

  it.each(['RUNNING', 'SUCCEEDED'] as const)(
    'returns the authoritative %s translation after an enqueue-failure CAS miss',
    async (status) => {
      const state = setup();
      state.enqueue.mockRejectedValueOnce(new Error('redis unavailable'));
      state.markEnqueueFailed.mockResolvedValueOnce(false);
      state.loadExisting
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(translationExisting(status, { revision: 5 }));

      await expect(state.launch(input())).resolves.toEqual({
        workflowId: 'media-created-1', action: 'CREATE_TRANSLATION',
        operation: 'IMAGE_TRANSLATE', status, revision: 5, replayed: true,
      });
      expect(state.loadExisting).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    ['QUEUED', 'MEDIA_QUEUE_UNAVAILABLE'],
    ['FAILED', 'MEDIA_CREATE_ALREADY_FAILED'],
    ['CANCELLED', 'MEDIA_CREATE_ALREADY_CANCELLED'],
    ['UNKNOWN', 'MEDIA_CREATE_STATE_UNAVAILABLE'],
  ] as const)(
    'rejects authoritative %s translation state after an enqueue-failure CAS miss',
    async (status, code) => {
      const state = setup();
      state.enqueue.mockRejectedValueOnce(new Error('redis unavailable'));
      state.markEnqueueFailed.mockResolvedValueOnce(false);
      state.loadExisting
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(translationExisting(status));

      await expect(state.launch(input())).rejects.toEqual(
        expect.objectContaining({ code }),
      );
      expect(state.loadExisting).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    ['missing', null],
    ['unreadable', new Error('database unavailable')],
  ] as const)(
    'fails when authoritative translation state is %s after an enqueue-failure CAS miss',
    async (_label, authoritative) => {
      const state = setup();
      state.enqueue.mockRejectedValueOnce(new Error('redis unavailable'));
      state.markEnqueueFailed.mockResolvedValueOnce(false);
      state.loadExisting.mockResolvedValueOnce(null);
      if (authoritative instanceof Error) {
        state.loadExisting.mockRejectedValueOnce(authoritative);
      } else {
        state.loadExisting.mockResolvedValueOnce(authoritative);
      }

      await expect(state.launch(input())).rejects.toEqual(
        expect.objectContaining({ code: 'MEDIA_CREATE_STATE_UNAVAILABLE' }),
      );
      expect(state.loadExisting).toHaveBeenCalledTimes(2);
    },
  );

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

describe('extension standalone media launch', () => {
  it('dispatches a production paid image-to-image task with a frozen server-only Provider quote', async () => {
    const state = setupV2({ production: true, readiness: paidStandaloneReadiness });

    await expect(state.launch(input({ command: v2Command('IMAGE_TO_IMAGE') }))).resolves.toEqual({
      workflowId: 'media-created-1', action: 'CREATE_WORKFLOW', operation: 'IMAGE_TO_IMAGE',
      status: 'QUEUED', revision: 1, replayed: false,
    });
    expect(state.createImageToImage).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'openai-images',
      model: 'gpt-image-1',
      estimatedCostCents: 9,
      globalDailyBudgetCents: 1_000,
      providerRuntimeContract: {
        contractVersion: 'ai-image-provider-runtime/v1',
        provider: 'openai-images',
        model: 'gpt-image-1',
        baseUrlSha256: 'd9617135d6fdd0a2cde722d637a1dfcc3da37515708b3ea5d66ae607c8ac785e',
        unitCostCents: 9,
        imageCount: 1,
        width: 1024,
        height: 1024,
        maximumCostCents: 9,
      },
      count: 1,
      width: 1024,
      height: 1024,
    }));
    expect(state.enqueueGeneration).toHaveBeenCalledWith('generation-job-1');
  });

  it('freezes a paid full-image edit quote against the internalized source dimensions', async () => {
    const state = setupV2({ production: true, readiness: paidStandaloneReadiness });

    await expect(state.launch(input({ command: v2Command('FULL_EDIT') }))).resolves.toMatchObject({
      action: 'CREATE_WORKFLOW', operation: 'FULL_EDIT', status: 'QUEUED', replayed: false,
    });
    expect(state.createImageEdit).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'FULL_EDIT',
      sourceAssetId: 'source-asset-1',
      width: 640,
      height: 480,
      provider: 'openai-images',
      model: 'gpt-image-1',
      estimatedCostCents: 9,
      globalDailyBudgetCents: 1_000,
      providerRuntimeContract: expect.objectContaining({
        provider: 'openai-images',
        model: 'gpt-image-1',
        unitCostCents: 9,
        imageCount: 1,
        width: 640,
        height: 480,
        maximumCostCents: 9,
      }),
    }));
    expect(state.enqueueEdit).toHaveBeenCalledWith('edit-job-1');
  });

  it.each([
    ['zero width', { id: 'source-asset-1', width: 0, height: 480 }],
    ['fractional height', { id: 'source-asset-1', width: 640, height: 479.5 }],
  ])('rejects an internalized source with %s before workflow creation', async (_label, source) => {
    const state = setupV2();
    state.internalizeSource.mockResolvedValue(source);

    await expect(state.launch(input({ command: v2Command('FULL_EDIT') }))).rejects.toEqual(
      expect.objectContaining({ code: 'MEDIA_CREATE_CONTEXT_STALE' }),
    );
    expect(state.createImageEdit).not.toHaveBeenCalled();
    expect(state.enqueueEdit).not.toHaveBeenCalled();
  });

  it.each([
    ['test-only marker', { testOnly: true }],
    ['zero unit cost', { costPerImageCents: 0 }],
    ['missing global budget', { globalDailyBudgetCents: undefined }],
    ['unverified evidence', { evidenceLevel: 'adapter-characterized' }],
  ])('rejects paid readiness with an invalid %s before source internalization', async (_label, change) => {
    const state = setupV2({
      readiness: { ...paidStandaloneReadiness, ...change },
      production: true,
    });

    await expect(state.launch(input({ command: v2Command('IMAGE_TO_IMAGE') }))).rejects.toEqual(
      expect.objectContaining({ code: 'MEDIA_PROVIDER_NOT_ALLOWED' }),
    );
    expect(state.loadContext).not.toHaveBeenCalled();
    expect(state.internalizeSource).not.toHaveBeenCalled();
    expect(state.createImageToImage).not.toHaveBeenCalled();
  });

  it('creates one image-to-image workflow from one to four server-internalized sources', async () => {
    const state = setupV2();
    await expect(state.launch(input({ command: v2Command('IMAGE_TO_IMAGE') }))).resolves.toEqual({
      workflowId: 'media-created-1', action: 'CREATE_WORKFLOW', operation: 'IMAGE_TO_IMAGE',
      status: 'QUEUED', revision: 1, replayed: false,
    });
    expect(state.internalizeSource).toHaveBeenNthCalledWith(1, {
      ownerUserId: 'owner-1', listingWorkflowId: 'listing-1',
      sourceMediaKey: 'media-main-1', draftRevision: 11, draftVersion: 7, role: 'GENERAL',
    });
    expect(state.createImageToImage).toHaveBeenCalledWith({
      ownerUserId: 'owner-1', actorUserId: 'owner-1',
      references: [{ assetId: 'source-asset-1' }, { assetId: 'source-asset-2' }],
      prompt: 'Keep the product identity and improve the background.', negativePrompt: null,
      count: 1, width: 1024, height: 1024, dailyLimit: 4,
      idempotencyKey: 'extension-media-workflow:image_to_image-1',
      context: { type: 'listing-draft', id: 'listing-1', revision: 11, draftVersion: 7 },
    });
    expect(state.enqueueGeneration).toHaveBeenCalledWith('generation-job-1');
    expect(state.resolvePrompt).not.toHaveBeenCalled();
  });

  it.each([
    ['FULL_EDIT', AI_MEDIA_FULL_EDIT_TEMPLATE_KEY],
    ['INPAINT', AI_MEDIA_INPAINT_TEMPLATE_KEY],
  ] as const)('freezes the %s prompt and dispatches the dedicated edit worker', async (operation, templateKey) => {
    const state = setupV2();
    await expect(state.launch(input({ command: v2Command(operation) }))).resolves.toMatchObject({
      action: 'CREATE_WORKFLOW', operation, status: 'QUEUED', replayed: false,
    });
    expect(state.internalizeSource).toHaveBeenCalledWith(expect.objectContaining({
      sourceMediaKey: 'media-main-1', role: 'EDIT',
    }));
    expect(state.resolvePrompt).toHaveBeenCalledWith({
      templateKey,
      variables: {
        userPrompt: 'Keep the product identity and improve the background.',
        userNegativePrompt: '',
      },
    });
    expect(state.createImageEdit).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 'owner-1', actorUserId: 'owner-1', operation,
      sourceAssetId: 'source-asset-1',
      ...(operation === 'INPAINT' ? {
        maskAssetId: 'mask-asset-1', maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
      } : {}),
      prompt: 'Keep the product identity and improve the background.', negativePrompt: null,
      resolvedPrompt: 'Frozen edit prompt', resolvedNegativePrompt: 'Frozen edit negative prompt',
      templateKey, templateReleaseId: 'release-edit-1', templateChecksum: 'c'.repeat(64),
      templateSnapshot: { version: 1 }, dailyLimit: 4,
      idempotencyKey: `extension-media-workflow:${operation.toLowerCase()}-1`,
      context: { type: 'listing-draft', id: 'listing-1', revision: 11, draftVersion: 7 },
    }));
    expect(state.enqueueEdit).toHaveBeenCalledWith('edit-job-1');
    expect(state.enqueueGeneration).not.toHaveBeenCalled();
  });

  it.each([[], 'serialized-snapshot'] as const)(
    'rejects a non-object edit prompt snapshot before workflow creation',
    async (snapshot) => {
      const state = setupV2();
      state.resolvePrompt.mockResolvedValueOnce({
        templateKey: AI_MEDIA_FULL_EDIT_TEMPLATE_KEY,
        release: { id: 'release-edit-1' },
        checksum: 'c'.repeat(64),
        snapshot,
        resolvedPrompt: 'Frozen edit prompt',
        resolvedNegativePrompt: 'Frozen edit negative prompt',
      } as never);

      await expect(state.launch(input({ command: v2Command('FULL_EDIT') }))).rejects.toEqual(
        expect.objectContaining({ code: 'MEDIA_PROMPT_UNAVAILABLE' }),
      );
      expect(state.createImageEdit).not.toHaveBeenCalled();
      expect(state.enqueueEdit).not.toHaveBeenCalled();
    },
  );

  it('fails every v2 fake operation closed in production before source internalization', async () => {
    for (const operation of ['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'] as const) {
      const state = setupV2({ production: true });
      await expect(state.launch(input({ command: v2Command(operation) }))).rejects.toEqual(
        expect.objectContaining({ code: 'MEDIA_PROVIDER_NOT_ALLOWED' }),
      );
      expect(state.internalizeSource).not.toHaveBeenCalled();
      expect(state.createImageToImage).not.toHaveBeenCalled();
      expect(state.createImageEdit).not.toHaveBeenCalled();
    }
  });

  it.each([
    ['FAILED', 'MEDIA_CREATE_ALREADY_FAILED'],
    ['CANCEL_REQUESTED', 'MEDIA_CREATE_ALREADY_CANCELLED'],
    ['CANCELLED', 'MEDIA_CREATE_ALREADY_CANCELLED'],
  ])('does not report an idempotent %s workflow as successfully created', async (status, errorCode) => {
    const state = setupV2({
      existing: {
        id: 'media-failed-1',
        ownerUserId: 'owner-1',
        operation: 'IMAGE_TO_IMAGE',
        provider: 'fake',
        model: 'fake-image-to-image-v1',
        status,
        revision: 2,
        contextType: 'listing-draft',
        contextId: 'listing-1',
        contextDraftRevision: 11,
        contextDraftVersion: 7,
        suiteId: null,
        sourceMediaKeys: ['media-main-1', 'media-detail-1'],
        maskAssetId: null,
        prompt: 'Keep the product identity and improve the background.',
        negativePrompt: null,
        jobId: 'generation-job-failed-1',
      },
    });

    await expect(state.launch(input({ command: v2Command('IMAGE_TO_IMAGE') }))).rejects.toEqual(
      expect.objectContaining({ code: errorCode }),
    );
    expect(state.internalizeSource).not.toHaveBeenCalled();
    expect(state.enqueueGeneration).not.toHaveBeenCalled();
  });

  it.each(['QUEUED', 'RUNNING', 'SUCCEEDED'] as const)(
    'replays an exact existing v2 %s workflow without creating another workflow',
    async (status) => {
      const existing = v2Existing(status);
      const state = setupV2({ existing });
      await expect(state.launch(input({ command: v2Command('IMAGE_TO_IMAGE') }))).resolves.toEqual({
        workflowId: existing.id,
        action: 'CREATE_WORKFLOW',
        operation: 'IMAGE_TO_IMAGE',
        status,
        revision: 2,
        replayed: true,
      });
      expect(state.loadExisting).toHaveBeenCalledWith({
        ownerUserId: 'owner-1',
        idempotencyKey: 'extension-media-workflow:image_to_image-1',
      });
      expect(state.internalizeSource).not.toHaveBeenCalled();
      expect(state.createImageToImage).not.toHaveBeenCalled();
      if (status === 'QUEUED') {
        expect(state.getReadiness).toHaveBeenCalledWith('IMAGE_TO_IMAGE');
        expect(state.enqueueGeneration).toHaveBeenCalledWith('generation-job-existing-1');
      } else {
        expect(state.getReadiness).not.toHaveBeenCalled();
        expect(state.enqueueGeneration).not.toHaveBeenCalled();
      }
    },
  );

  it('re-enqueues an exact paid workflow only after its frozen Provider quote matches readiness', async () => {
    const existing = paidV2Existing('QUEUED');
    const state = setupV2({ existing, readiness: paidStandaloneReadiness, production: true });

    await expect(state.launch(input({ command: v2Command('IMAGE_TO_IMAGE') }))).resolves.toEqual({
      workflowId: existing.id,
      action: 'CREATE_WORKFLOW',
      operation: 'IMAGE_TO_IMAGE',
      status: 'QUEUED',
      revision: 2,
      replayed: true,
    });
    expect(state.getReadiness).toHaveBeenCalledWith('IMAGE_TO_IMAGE');
    expect(state.enqueueGeneration).toHaveBeenCalledWith('generation-job-existing-1');
    expect(state.createImageToImage).not.toHaveBeenCalled();
  });

  it.each([
    ['price', { costPerImageCents: 10 }],
    ['endpoint', { baseUrl: 'https://images.example.com/v1' }],
  ])('does not re-enqueue a paid workflow after its frozen %s changes', async (_label, change) => {
    const state = setupV2({
      existing: paidV2Existing('QUEUED'),
      readiness: { ...paidStandaloneReadiness, ...change },
      production: true,
    });

    await expect(state.launch(input({ command: v2Command('IMAGE_TO_IMAGE') }))).rejects.toEqual(
      expect.objectContaining({ code: 'MEDIA_PROVIDER_CONFIG_CHANGED' }),
    );
    expect(state.enqueueGeneration).not.toHaveBeenCalled();
    expect(state.markEnqueueFailed).not.toHaveBeenCalled();
  });

  it('does not re-enqueue a paid workflow after Provider authorization is revoked', async () => {
    const state = setupV2({
      existing: paidV2Existing('QUEUED'),
      readiness: {
        ...paidStandaloneReadiness,
        enabled: false,
        ready: false,
        reasonCode: 'AI_MEDIA_OPERATION_DISABLED',
        reason: 'disabled by administrator',
      },
      production: true,
    });

    await expect(state.launch(input({ command: v2Command('IMAGE_TO_IMAGE') }))).rejects.toEqual(
      expect.objectContaining({ code: 'MEDIA_CREATE_DISABLED' }),
    );
    expect(state.enqueueGeneration).not.toHaveBeenCalled();
    expect(state.markEnqueueFailed).not.toHaveBeenCalled();
  });

  it('classifies a v2 existing-workflow lookup outage before any create side effect', async () => {
    const state = setupV2();
    state.loadExisting.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(state.launch(input({ command: v2Command('IMAGE_TO_IMAGE') }))).rejects.toEqual(
      expect.objectContaining({ code: 'MEDIA_CREATE_STATE_UNAVAILABLE' }),
    );
    expect(state.getReadiness).not.toHaveBeenCalled();
    expect(state.loadContext).not.toHaveBeenCalled();
    expect(state.internalizeSource).not.toHaveBeenCalled();
    expect(state.createImageToImage).not.toHaveBeenCalled();
  });

  it('recovers the authoritative v2 workflow after an idempotency conflict race', async () => {
    const conflict = Object.assign(new Error('idempotency conflict'), {
      code: 'IDEMPOTENCY_KEY_CONFLICT',
    });
    const raced = v2Existing('RUNNING', { id: 'media-raced-1', revision: 4 });
    const state = setupV2({ createError: conflict });
    state.loadExisting
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(raced);
    await expect(state.launch(input({ command: v2Command('IMAGE_TO_IMAGE') }))).resolves.toEqual({
      workflowId: 'media-raced-1',
      action: 'CREATE_WORKFLOW',
      operation: 'IMAGE_TO_IMAGE',
      status: 'RUNNING',
      revision: 4,
      replayed: true,
    });
    expect(state.loadExisting).toHaveBeenCalledTimes(2);
    expect(state.createImageToImage).toHaveBeenCalledTimes(1);
    expect(state.enqueueGeneration).not.toHaveBeenCalled();
  });

  it('rejects an existing queued v2 workflow whose frozen job is missing', async () => {
    const state = setupV2({ existing: v2Existing('QUEUED', { jobId: null }) });
    await expect(state.launch(input({ command: v2Command('IMAGE_TO_IMAGE') }))).rejects.toEqual(
      expect.objectContaining({ code: 'MEDIA_QUEUE_UNAVAILABLE' }),
    );
    expect(state.getReadiness).toHaveBeenCalledWith('IMAGE_TO_IMAGE');
    expect(state.enqueueGeneration).not.toHaveBeenCalled();
    expect(state.internalizeSource).not.toHaveBeenCalled();
  });

  it('marks a newly committed v2 workflow failed when normal enqueue is unavailable', async () => {
    const state = setupV2();
    state.enqueueGeneration.mockRejectedValueOnce(new Error('redis unavailable'));
    await expect(state.launch(input({ command: v2Command('IMAGE_TO_IMAGE') }))).rejects.toEqual(
      expect.objectContaining({ code: 'MEDIA_QUEUE_UNAVAILABLE' }),
    );
    expect(state.createImageToImage).toHaveBeenCalledTimes(1);
    expect(state.markEnqueueFailed).toHaveBeenCalledWith('generation-job-1');
  });

  it.each(['RUNNING', 'SUCCEEDED'] as const)(
    'returns the authoritative %s v2 workflow after an enqueue-failure CAS miss',
    async (status) => {
      const state = setupV2();
      state.enqueueGeneration.mockRejectedValueOnce(new Error('redis unavailable'));
      state.markEnqueueFailed.mockResolvedValueOnce(false);
      state.loadExisting
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(v2Existing(status, { id: 'media-created-1', revision: 6 }));

      await expect(state.launch(input({ command: v2Command('IMAGE_TO_IMAGE') }))).resolves.toEqual({
        workflowId: 'media-created-1', action: 'CREATE_WORKFLOW',
        operation: 'IMAGE_TO_IMAGE', status, revision: 6, replayed: true,
      });
      expect(state.loadExisting).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    ['QUEUED', 'MEDIA_QUEUE_UNAVAILABLE'],
    ['FAILED', 'MEDIA_CREATE_ALREADY_FAILED'],
    ['CANCELLED', 'MEDIA_CREATE_ALREADY_CANCELLED'],
    ['UNKNOWN', 'MEDIA_CREATE_STATE_UNAVAILABLE'],
  ] as const)(
    'rejects authoritative %s v2 state after an enqueue-failure CAS miss',
    async (status, code) => {
      const state = setupV2();
      state.enqueueGeneration.mockRejectedValueOnce(new Error('redis unavailable'));
      state.markEnqueueFailed.mockResolvedValueOnce(false);
      state.loadExisting
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(v2Existing('RUNNING', { status }));

      await expect(state.launch(input({ command: v2Command('IMAGE_TO_IMAGE') }))).rejects.toEqual(
        expect.objectContaining({ code }),
      );
      expect(state.loadExisting).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    ['missing', null],
    ['unreadable', new Error('database unavailable')],
  ] as const)(
    'fails when authoritative v2 workflow state is %s after an enqueue-failure CAS miss',
    async (_label, authoritative) => {
      const state = setupV2();
      state.enqueueGeneration.mockRejectedValueOnce(new Error('redis unavailable'));
      state.markEnqueueFailed.mockResolvedValueOnce(false);
      state.loadExisting.mockResolvedValueOnce(null);
      if (authoritative instanceof Error) {
        state.loadExisting.mockRejectedValueOnce(authoritative);
      } else {
        state.loadExisting.mockResolvedValueOnce(authoritative);
      }

      await expect(state.launch(input({ command: v2Command('IMAGE_TO_IMAGE') }))).rejects.toEqual(
        expect.objectContaining({ code: 'MEDIA_CREATE_STATE_UNAVAILABLE' }),
      );
      expect(state.loadExisting).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    ['FAILED', 'MEDIA_CREATE_ALREADY_FAILED'],
    ['CANCEL_REQUESTED', 'MEDIA_CREATE_ALREADY_CANCELLED'],
    ['CANCELLED', 'MEDIA_CREATE_ALREADY_CANCELLED'],
  ])('rejects a workflow-service v2 replay that returns %s after an empty lookup', async (status, errorCode) => {
    const state = setupV2({ replayed: true, createdStatus: status });
    await expect(state.launch(input({ command: v2Command('IMAGE_TO_IMAGE') }))).rejects.toEqual(
      expect.objectContaining({ code: errorCode }),
    );
    expect(state.createImageToImage).toHaveBeenCalledTimes(1);
    expect(state.enqueueGeneration).not.toHaveBeenCalled();
  });

  it.each([
    'SOURCE_ASSET_DUPLICATE',
    'SOURCE_ASSET_INVALID',
    'MASK_ASSET_INVALID',
  ])('reports deterministic %s input failures as invalid instead of unavailable', async (code) => {
    const state = setupV2({
      createError: Object.assign(new Error(code), { code }),
    });

    await expect(state.launch(input({
      command: v2Command(code === 'MASK_ASSET_INVALID' ? 'INPAINT' : 'IMAGE_TO_IMAGE'),
    }))).rejects.toEqual(
      expect.objectContaining({ code: 'MEDIA_CREATE_INPUT_INVALID' }),
    );
  });
});
