import { describe, expect, it, vi } from 'vitest';
import {
  createExtensionMediaApplyCommandExecutor,
  createExtensionMediaReviewCommandExecutor,
  ExtensionMediaReviewCommandError,
} from '../services/extension-media-review-commands.js';

function outputAsset(overrides: Record<string, unknown> = {}) {
  return {
    id: 'output-1', ownerUserId: 'owner-1', aiImageJobId: 'job-1',
    kind: 'AI_GENERATED', storageBackend: 'local',
    ...overrides,
  };
}

function workflow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'media-1', ownerUserId: 'owner-1', operation: 'IMAGE_TRANSLATE',
    status: 'SUCCEEDED', reviewStatus: 'PENDING', revision: 3,
    contextType: 'listing-draft', contextId: 'listing-1',
    contextDraftRevision: 11, contextDraftVersion: 7, suiteId: null,
    selectedOutputAssetId: null,
    jobs: [{
      id: 'job-1', provider: 'fake', status: 'SUCCEEDED',
      assets: [outputAsset()],
    }],
    ...overrides,
  } as any;
}

function reviewCommand(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'ai-media-workflow-review/v1', action: 'REVIEW',
    mediaWorkflowId: 'media-1', expectedRevision: 3, draftRevision: 11,
    outputAssetId: 'output-1', decision: 'APPROVE', note: null,
    ...overrides,
  };
}

function applyCommand(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'ai-media-workflow-apply/v1', action: 'APPLY',
    mediaWorkflowId: 'media-1', expectedWorkflowRevision: 4,
    expectedTargetRevision: 11, expectedTargetDraftVersion: 7,
    outputAssetId: 'output-1', mode: 'append',
    ...overrides,
  };
}

const baseInput = {
  ownerUserId: 'owner-1', actorUserId: 'owner-1', shopId: 'shop-1',
  listingWorkflowId: 'listing-1', draftVersion: 7,
  idempotencyKey: 'extension-media-review-operation-1',
};

describe('extension media review command executor', () => {
  function setup(current = workflow(), production = false) {
    const get = vi.fn(async () => current);
    const review = vi.fn(async () => workflow({
      reviewStatus: 'APPROVED', selectedOutputAssetId: 'output-1', revision: 4,
    }));
    const loadListingDraft = vi.fn(async () => ({
      id: 'listing-1', ownerUserId: 'owner-1', shopId: 'shop-1',
      revision: 11, draftVersion: 7,
    }));
    const execute = createExtensionMediaReviewCommandExecutor({
      workflowService: { get, review },
      loadListingDraft,
      production,
    });
    return { execute, get, review, loadListingDraft };
  }

  it('reviews one exact succeeded fake output through workflow revision CAS', async () => {
    const state = setup();
    await expect(state.execute({ ...baseInput, command: reviewCommand() })).resolves.toEqual({
      workflowId: 'media-1', action: 'REVIEW', status: 'SUCCEEDED',
      reviewStatus: 'APPROVED', selectedOutputAssetId: 'output-1',
      revision: 4, replayed: false,
    });
    expect(state.review).toHaveBeenCalledWith({
      id: 'media-1', ownerUserId: 'owner-1', actorUserId: 'owner-1',
      expectedRevision: 3, outputAssetId: 'output-1',
      decision: 'APPROVE', note: null,
      operationKey: 'extension-media-review-operation-1',
    });
  });

  it('recovers an already committed identical review without a second mutation', async () => {
    const state = setup(workflow({
      reviewStatus: 'APPROVED', selectedOutputAssetId: 'output-1', revision: 4,
      events: [{
        eventKey: 'media-1:review:3', eventType: 'REVIEW_APPROVED',
        assetId: 'output-1', payload: {
          note: null, operationKey: 'extension-media-review-operation-1',
        },
      }],
    }));
    await expect(state.execute({ ...baseInput, command: reviewCommand() })).resolves.toMatchObject({
      reviewStatus: 'APPROVED', selectedOutputAssetId: 'output-1',
      revision: 4, replayed: true,
    });
    expect(state.review).not.toHaveBeenCalled();
  });

  it('recovers an exact review after a later application advanced the draft', async () => {
    const state = setup(workflow({
      reviewStatus: 'APPROVED', selectedOutputAssetId: 'output-1', revision: 5,
      events: [{
        eventKey: 'media-1:review:3', eventType: 'REVIEW_APPROVED',
        assetId: 'output-1', payload: {
          note: null, operationKey: 'extension-media-review-operation-1',
        },
      }],
    }));
    state.loadListingDraft.mockResolvedValueOnce({
      id: 'listing-1', ownerUserId: 'owner-1', shopId: 'shop-1',
      revision: 12, draftVersion: 8,
    });

    await expect(state.execute({ ...baseInput, command: reviewCommand() })).resolves.toMatchObject({
      reviewStatus: 'APPROVED', selectedOutputAssetId: 'output-1',
      revision: 5, replayed: true,
    });
    expect(state.review).not.toHaveBeenCalled();
  });

  it('rejects a changed review command after the workflow was already reviewed', async () => {
    const state = setup(workflow({
      reviewStatus: 'APPROVED', selectedOutputAssetId: 'output-1', revision: 4,
      events: [{
        eventKey: 'media-1:review:3', eventType: 'REVIEW_APPROVED',
        assetId: 'output-1', payload: {
          note: null, operationKey: 'extension-media-review-operation-1',
        },
      }],
    }));
    await expect(state.execute({
      ...baseInput,
      command: reviewCommand({ note: 'different note' }),
    })).rejects.toMatchObject({ code: 'MEDIA_REVIEW_CONTEXT_STALE' });
    expect(state.review).not.toHaveBeenCalled();
  });

  it('rejects a review replay under a different operation key', async () => {
    const state = setup(workflow({
      reviewStatus: 'APPROVED', selectedOutputAssetId: 'output-1', revision: 4,
      events: [{
        eventKey: 'media-1:review:3', eventType: 'REVIEW_APPROVED',
        assetId: 'output-1', payload: {
          note: null, operationKey: 'extension-media-review-operation-1',
        },
      }],
    }));
    await expect(state.execute({
      ...baseInput,
      idempotencyKey: 'different-media-review-operation',
      command: reviewCommand(),
    })).rejects.toMatchObject({ code: 'MEDIA_REVIEW_CONTEXT_STALE' });
    expect(state.review).not.toHaveBeenCalled();
  });

  it.each([
    ['production', workflow(), true],
    ['paid provider', workflow({ jobs: [{
      id: 'job-1', provider: 'dashscope-qwen-mt-image', status: 'SUCCEEDED',
      assets: [outputAsset()],
    }] }), false],
    ['suite child', workflow({ suiteId: 'suite-1' }), false],
  ])('rejects %s review before mutation', async (_label, current, production) => {
    const state = setup(current, production);
    await expect(state.execute({ ...baseInput, command: reviewCommand() })).rejects.toBeInstanceOf(
      ExtensionMediaReviewCommandError,
    );
    expect(state.review).not.toHaveBeenCalled();
  });

  it('rejects client Provider and Prompt fields in the strict command', async () => {
    const state = setup();
    await expect(state.execute({
      ...baseInput,
      command: reviewCommand({ provider: 'fake', prompt: 'client prompt' }),
    })).rejects.toMatchObject({ code: 'MEDIA_REVIEW_COMMAND_INVALID' });
    expect(state.get).not.toHaveBeenCalled();
  });
});

describe('extension media apply command executor', () => {
  function setup(options: { current?: any; replayed?: boolean; production?: boolean } = {}) {
    const current = options.current || workflow({
      reviewStatus: 'APPROVED', selectedOutputAssetId: 'output-1', revision: 4,
    });
    const get = vi.fn(async () => current);
    const applyListingDraftApplication = vi.fn(async (): Promise<any> => ({
      replayed: options.replayed === true,
      application: {
        id: 'application-1', operationKey: 'extension-media-apply-operation-1',
        workflowId: 'media-1', outputAssetId: 'output-1', mode: 'append',
        rolledBackById: null,
        workflowRevisionBefore: 4, workflowRevisionAfter: 5,
        targetRevisionBefore: 11, targetDraftVersionBefore: 7,
        targetRevisionAfter: 12, targetDraftVersionAfter: 8,
      },
      target: { revision: 99, draftVersion: 77 },
    }));
    const execute = createExtensionMediaApplyCommandExecutor({
      workflowService: { get },
      applyListingDraftApplication,
      production: options.production ?? false,
    });
    return { execute, get, applyListingDraftApplication };
  }

  it('applies only append mode with the receipt operation key', async () => {
    const state = setup();
    await expect(state.execute({
      ...baseInput,
      idempotencyKey: 'extension-media-apply-operation-1',
      command: applyCommand(),
    })).resolves.toEqual({
      workflowId: 'media-1', action: 'APPLY', status: 'SUCCEEDED',
      reviewStatus: 'APPROVED', selectedOutputAssetId: 'output-1',
      revision: 5, applicationId: 'application-1',
      targetRevision: 12, targetDraftVersion: 8, replayed: false,
    });
    expect(state.applyListingDraftApplication).toHaveBeenCalledWith({
      workflowId: 'media-1', ownerUserId: 'owner-1', actorUserId: 'owner-1',
      mode: 'append', operationKey: 'extension-media-apply-operation-1',
      expectedWorkflowRevision: 4, expectedTargetRevision: 11,
      expectedTargetDraftVersion: 7, production: false,
    });
  });

  it('projects an application-ledger replay after an ambiguous response', async () => {
    const state = setup({ replayed: true });
    await expect(state.execute({
      ...baseInput,
      idempotencyKey: 'extension-media-apply-operation-1',
      command: applyCommand(),
    })).resolves.toMatchObject({
      applicationId: 'application-1', targetRevision: 12,
      targetDraftVersion: 8, replayed: true,
    });
  });

  it.each([
    ['wrong operation key', { operationKey: 'another-operation-key' }],
    ['rolled back application', { rolledBackById: 'rollback-1' }],
    ['wrong original target', { targetDraftVersionBefore: 6 }],
  ])('rejects an invalid application ledger result: %s', async (_label, patch) => {
    const state = setup();
    state.applyListingDraftApplication.mockResolvedValueOnce({
      replayed: true,
      application: {
        id: 'application-1', operationKey: 'extension-media-apply-operation-1',
        workflowId: 'media-1', outputAssetId: 'output-1', mode: 'append',
        rolledBackById: null,
        workflowRevisionBefore: 4, workflowRevisionAfter: 5,
        targetRevisionBefore: 11, targetDraftVersionBefore: 7,
        targetRevisionAfter: 12, targetDraftVersionAfter: 8,
        ...patch,
      },
      target: { revision: 99, draftVersion: 77 },
    });
    await expect(state.execute({
      ...baseInput,
      idempotencyKey: 'extension-media-apply-operation-1',
      command: applyCommand(),
    })).rejects.toMatchObject({ code: 'MEDIA_APPLY_STATE_UNAVAILABLE' });
  });

  it.each([
    ['different selected output', workflow({
      reviewStatus: 'APPROVED', selectedOutputAssetId: 'other-output', revision: 4,
    }), false],
    ['production fake', workflow({
      reviewStatus: 'APPROVED', selectedOutputAssetId: 'output-1', revision: 4,
    }), true],
  ])('rejects %s application', async (_label, current, production) => {
    const state = setup({ current, production });
    await expect(state.execute({
      ...baseInput,
      idempotencyKey: 'extension-media-apply-operation-1',
      command: applyCommand(),
    })).rejects.toBeInstanceOf(Error);
    expect(state.applyListingDraftApplication).not.toHaveBeenCalled();
  });
});
