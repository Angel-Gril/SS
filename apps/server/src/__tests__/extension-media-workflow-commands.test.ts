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

function setup(current = workflow(), options: { replayed?: boolean } = {}) {
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
  const execute = createExtensionMediaWorkflowCommandExecutor({
    workflowService: { get, cancel, retry },
    loadListingDraft: vi.fn(async () => ({
      id: 'listing-1', ownerUserId: 'owner-1', shopId: 'shop-1',
      revision: 11, draftVersion: 7,
    })),
    getTranslationDailyLimit: vi.fn(async () => 5),
    getEditDailyLimit: vi.fn(async () => 4),
    enqueueGeneration, enqueueTranslation, enqueueEdit,
    markEnqueueFailed,
  });
  return {
    execute, get, cancel, retry, enqueueGeneration, enqueueTranslation, enqueueEdit,
    markEnqueueFailed,
  };
}

describe('extension media workflow commands', () => {
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

  it('accepts an enqueue race when another worker already claimed the durable job', async () => {
    const state = setup();
    state.enqueueTranslation.mockRejectedValueOnce(new Error('ambiguous queue response'));
    state.markEnqueueFailed.mockResolvedValueOnce(false);
    await expect(state.execute(input('RETRY'))).resolves.toEqual({
      workflowId: 'media-1', action: 'RETRY', status: 'QUEUED', revision: 4,
    });
    expect(state.markEnqueueFailed).toHaveBeenCalledWith('job-2');
  });
});
