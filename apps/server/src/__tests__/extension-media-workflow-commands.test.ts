import { describe, expect, it, vi } from 'vitest';
import {
  createExtensionMediaWorkflowCommandExecutor,
  ExtensionMediaWorkflowCommandError,
} from '../services/extension-media-workflow-commands.js';

function workflow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'media-1', ownerUserId: 'owner-1', actorUserId: 'owner-1',
    operation: 'IMAGE_TRANSLATE', status: 'FAILED', reviewStatus: 'NOT_READY',
    revision: 3, currentAttempt: 1, contextType: 'listing-draft',
    contextId: 'listing-1', contextSkuKey: 'sku-1', contextSlotKey: 'hero',
    contextDraftRevision: 11, contextDraftVersion: 7, suiteId: null,
    idempotencyKey: 'created-media-1', requestFingerprint: 'a'.repeat(64),
    selectedOutputAssetId: null, createdAt: new Date(), updatedAt: new Date(), completedAt: null,
    jobs: [{ provider: 'fake' }],
    ...overrides,
  } as any;
}

function input(action: 'CANCEL' | 'RETRY') {
  return {
    ownerUserId: 'owner-1', actorUserId: 'owner-1', shopId: 'shop-1',
    listingWorkflowId: 'listing-1', draftVersion: 7,
    idempotencyKey: 'media-command-operation-1',
    command: {
      schemaVersion: 'ai-media-workflow-command/v1', action,
      mediaWorkflowId: 'media-1', expectedRevision: 3, draftRevision: 11,
    },
  };
}

function setup(current = workflow(), options: {
  replayed?: boolean;
  production?: boolean;
  retryReady?: boolean;
  retryProvider?: string;
  retryModel?: string;
} = {}) {
  const get = vi.fn(async () => current);
  const cancel = vi.fn(async () => workflow({ status: 'CANCELLED', revision: 4 }));
  const retry = vi.fn(async () => ({
    workflow: workflow({ status: 'QUEUED', revision: 4 }),
    jobId: 'job-2', replayed: options.replayed === true,
  }));
  const enqueueGeneration = vi.fn(async () => undefined);
  const enqueueTranslation = vi.fn(async () => undefined);
  const enqueueEdit = vi.fn(async () => undefined);
  const markEnqueueFailed = vi.fn(async () => true);
  const getRetryReadiness = vi.fn(async () => ({
    ready: options.retryReady !== false,
    ...(options.retryProvider ? { provider: options.retryProvider } : {}),
    ...(options.retryModel ? { model: options.retryModel } : {}),
  }));
  const launchWorkflow = vi.fn(async () => ({
    workflowId: 'media-v2-1', action: 'CREATE_WORKFLOW' as const,
    operation: 'FULL_EDIT' as const, status: 'QUEUED', revision: 1, replayed: false,
  }));
  const execute = createExtensionMediaWorkflowCommandExecutor({
    workflowService: { get, cancel, retry },
    launchWorkflow,
    loadListingDraft: vi.fn(async () => ({
      id: 'listing-1', ownerUserId: 'owner-1', shopId: 'shop-1',
      revision: 11, draftVersion: 7,
    })),
    getTranslationDailyLimit: vi.fn(async () => 5),
    getEditDailyLimit: vi.fn(async () => 4),
    getRetryReadiness,
    enqueueGeneration, enqueueTranslation, enqueueEdit,
    markEnqueueFailed,
    production: options.production ?? false,
  });
  return {
    execute, get, cancel, retry, enqueueGeneration, enqueueTranslation, enqueueEdit,
    markEnqueueFailed, launchWorkflow, getRetryReadiness,
  };
}

describe('extension media workflow commands', () => {
  it('delegates a strict v2 create command to the standalone launcher', async () => {
    const state = setup();
    const createInput = {
      ownerUserId: 'owner-1', actorUserId: 'owner-1', shopId: 'shop-1',
      listingWorkflowId: 'listing-1', draftVersion: 7,
      idempotencyKey: 'media-create-attempt-v2-1',
      command: {
        schemaVersion: 'ai-media-workflow-create/v2', action: 'CREATE_WORKFLOW',
        operation: 'FULL_EDIT', sourceMediaKeys: ['media-main-1'],
        prompt: 'Improve the background.', negativePrompt: '', draftRevision: 11,
        workflowOperationKey: 'extension-media-workflow:v2-full-edit-1',
      },
    };
    await expect(state.execute(createInput)).resolves.toMatchObject({
      workflowId: 'media-v2-1', action: 'CREATE_WORKFLOW', operation: 'FULL_EDIT',
    });
    expect(state.launchWorkflow).toHaveBeenCalledWith(createInput);
    expect(state.get).not.toHaveBeenCalled();
  });

  it('cancels the exact fake listing-draft workflow through revision CAS', async () => {
    const state = setup(workflow({ status: 'RUNNING' }));
    await expect(state.execute(input('CANCEL'))).resolves.toEqual({
      workflowId: 'media-1', action: 'CANCEL', status: 'CANCELLED', revision: 4,
    });
    expect(state.cancel).toHaveBeenCalledWith('media-1', 'owner-1', 'owner-1', 3);
    expect(state.retry).not.toHaveBeenCalled();
  });

  it('retries one fake translation with the configured quota and operation key', async () => {
    const state = setup();
    await expect(state.execute(input('RETRY'))).resolves.toEqual({
      workflowId: 'media-1', action: 'RETRY', status: 'QUEUED', revision: 4,
    });
    expect(state.retry).toHaveBeenCalledWith({
      id: 'media-1', ownerUserId: 'owner-1', actorUserId: 'owner-1',
      expectedRevision: 3, idempotencyKey: 'media-command-operation-1', dailyLimit: 5,
    });
    expect(state.enqueueTranslation).toHaveBeenCalledWith('job-2');
    expect(state.enqueueGeneration).not.toHaveBeenCalled();
    expect(state.enqueueEdit).not.toHaveBeenCalled();
  });

  it('does not enqueue a retry replay twice', async () => {
    const state = setup(workflow(), { replayed: true });
    await state.execute(input('RETRY'));
    expect(state.enqueueTranslation).not.toHaveBeenCalled();
  });

  it.each(['IMAGE_TO_IMAGE', 'IMAGE_TRANSLATE', 'FULL_EDIT', 'INPAINT'])(
    'keeps a failed fake %s workflow dark when an environment is production',
    async (operation) => {
      const state = setup(workflow({ operation }), { production: true });
      await expect(state.execute(input('RETRY'))).rejects.toEqual(
        expect.objectContaining<Partial<ExtensionMediaWorkflowCommandError>>({
          code: 'MEDIA_PROVIDER_NOT_ALLOWED',
        }),
      );
      expect(state.retry).not.toHaveBeenCalled();
      expect(state.enqueueGeneration).not.toHaveBeenCalled();
      expect(state.enqueueTranslation).not.toHaveBeenCalled();
      expect(state.enqueueEdit).not.toHaveBeenCalled();
    },
  );

  it('rejects a translation retry when its frozen provider model no longer matches admin config', async () => {
    const state = setup(workflow({
      operation: 'IMAGE_TRANSLATE',
      jobs: [{ provider: 'fake', model: 'fake-translation-v1' }],
    }), {
      retryProvider: 'fake',
      retryModel: 'fake-translation-v2',
    });
    await expect(state.execute(input('RETRY'))).rejects.toEqual(
      expect.objectContaining<Partial<ExtensionMediaWorkflowCommandError>>({
        code: 'MEDIA_CAPABILITY_UNAVAILABLE',
      }),
    );
    expect(state.retry).not.toHaveBeenCalled();
  });

  it('still permits cancelling a running fake workflow in production', async () => {
    const state = setup(workflow({ status: 'RUNNING' }), { production: true });
    await expect(state.execute(input('CANCEL'))).resolves.toMatchObject({
      action: 'CANCEL', status: 'CANCELLED',
    });
    expect(state.cancel).toHaveBeenCalledOnce();
  });

  it.each(['IMAGE_TO_IMAGE', 'IMAGE_TRANSLATE', 'FULL_EDIT', 'INPAINT'])(
    'honors the admin readiness kill switch before retrying %s',
    async (operation) => {
      const state = setup(workflow({ operation }), { retryReady: false });
      await expect(state.execute(input('RETRY'))).rejects.toEqual(
        expect.objectContaining<Partial<ExtensionMediaWorkflowCommandError>>({
          code: 'MEDIA_CAPABILITY_UNAVAILABLE',
        }),
      );
      expect(state.getRetryReadiness).toHaveBeenCalledWith(operation);
      expect(state.retry).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['paid provider', workflow({ jobs: [{ provider: 'dashscope-qwen-mt-image' }] }), {}, 'MEDIA_PROVIDER_NOT_ALLOWED'],
    ['stale draft', workflow({ contextDraftVersion: 6 }), {}, 'MEDIA_COMMAND_CONTEXT_STALE'],
    ['suite child', workflow({ suiteId: 'suite-1' }), {}, 'MEDIA_COMMAND_CONTEXT_STALE'],
  ])('fails closed for %s', async (_label, current, options, code) => {
    const state = setup(current, options);
    await expect(state.execute(input('RETRY'))).rejects.toEqual(
      expect.objectContaining<Partial<ExtensionMediaWorkflowCommandError>>({ code }),
    );
    expect(state.retry).not.toHaveBeenCalled();
    expect(state.enqueueTranslation).not.toHaveBeenCalled();
  });

  it('marks a durable retry failed before returning a queue failure receipt', async () => {
    const state = setup();
    state.enqueueTranslation.mockRejectedValueOnce(new Error('redis unavailable'));
    await expect(state.execute(input('RETRY'))).rejects.toEqual(
      expect.objectContaining<Partial<ExtensionMediaWorkflowCommandError>>({
        code: 'MEDIA_QUEUE_UNAVAILABLE',
      }),
    );
    expect(state.markEnqueueFailed).toHaveBeenCalledWith('job-2');
  });

  it.each(['RUNNING', 'SUCCEEDED'] as const)(
    'returns the authoritative %s retry after an enqueue-failure CAS miss',
    async (status) => {
      const state = setup();
      state.enqueueTranslation.mockRejectedValueOnce(new Error('ambiguous queue response'));
      state.markEnqueueFailed.mockResolvedValueOnce(false);
      state.get
        .mockResolvedValueOnce(workflow())
        .mockResolvedValueOnce(workflow({ status, revision: 5 }));
      await expect(state.execute(input('RETRY'))).resolves.toEqual({
        workflowId: 'media-1', action: 'RETRY', status, revision: 5,
      });
      expect(state.markEnqueueFailed).toHaveBeenCalledWith('job-2');
      expect(state.get).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    ['QUEUED', 'MEDIA_QUEUE_UNAVAILABLE'],
    ['FAILED', 'MEDIA_CREATE_STATE_UNAVAILABLE'],
    ['CANCEL_REQUESTED', 'MEDIA_CREATE_STATE_UNAVAILABLE'],
    ['CANCELLED', 'MEDIA_CREATE_STATE_UNAVAILABLE'],
    ['UNKNOWN', 'MEDIA_CREATE_STATE_UNAVAILABLE'],
  ] as const)(
    'rejects authoritative %s retry state after an enqueue-failure CAS miss',
    async (status, code) => {
      const state = setup();
      state.enqueueTranslation.mockRejectedValueOnce(new Error('ambiguous queue response'));
      state.markEnqueueFailed.mockResolvedValueOnce(false);
      state.get
        .mockResolvedValueOnce(workflow())
        .mockResolvedValueOnce(workflow({ status, revision: 5 }));

      await expect(state.execute(input('RETRY'))).rejects.toEqual(
        expect.objectContaining<Partial<ExtensionMediaWorkflowCommandError>>({ code }),
      );
      expect(state.get).toHaveBeenCalledTimes(2);
    },
  );

  it.each(['missing', 'unreadable'] as const)(
    'rejects an %s authoritative retry after an enqueue-failure CAS miss',
    async (failure) => {
      const state = setup();
      state.enqueueTranslation.mockRejectedValueOnce(new Error('ambiguous queue response'));
      state.markEnqueueFailed.mockResolvedValueOnce(false);
      state.get.mockResolvedValueOnce(workflow());
      if (failure === 'missing') state.get.mockResolvedValueOnce(null as never);
      else state.get.mockRejectedValueOnce(new Error('database unavailable'));

      await expect(state.execute(input('RETRY'))).rejects.toEqual(
        expect.objectContaining<Partial<ExtensionMediaWorkflowCommandError>>({
          code: 'MEDIA_CREATE_STATE_UNAVAILABLE',
        }),
      );
      expect(state.get).toHaveBeenCalledTimes(2);
    },
  );

  it('maps enqueue-failure persistence outages to a retryable state error', async () => {
    const state = setup();
    state.enqueueTranslation.mockRejectedValueOnce(new Error('ambiguous queue response'));
    state.markEnqueueFailed.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(state.execute(input('RETRY'))).rejects.toEqual(
      expect.objectContaining<Partial<ExtensionMediaWorkflowCommandError>>({
        code: 'MEDIA_CREATE_STATE_UNAVAILABLE',
      }),
    );
  });
});
