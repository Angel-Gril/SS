import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  createExtensionAiImageSuitePostCommitRunner,
  createExtensionAiImageSuiteApplyCommandExecutor,
  createExtensionAiImageSuiteReviewCommandExecutor,
  createExtensionAiImageSuiteExecuteCommandExecutor,
} from '../services/extension-ai-image-suite-commands.js';
import {
  deriveExtensionAiImageSuiteIdempotencyKey,
  hashExtensionAiImageSuiteContext,
} from '../services/extension-ai-image-suite.js';

const context = {
  snapshotId: 'snapshot-1',
  supplyGoodsId: 'goods-1',
  shopId: 'shop-1',
  listingWorkflowId: 'listing-1',
  draftRevision: 11,
  draftVersion: 7,
};

const commandAuthority = {
  snapshotId: 'snapshot-1',
  supplyGoodsId: 'goods-1',
  draftRevision: 11,
  planId: 'plan-1',
  planVersionId: 'plan-version-1',
  planRevision: 3,
  skuKey: null,
};

const authority = {
  ownerUserId: 'owner-1',
  ...context,
};
const targetUpdatedAt = '2026-07-24T00:00:00.000Z';

function startCommand(overrides: Record<string, unknown> = {}) {
  return {
    version: 'extension-ai-image-suite-execute-command/v1',
    action: 'START',
    ...commandAuthority,
    expectedPreviewHash: 'a'.repeat(64),
    acceptedPricingVersion: 'pricing-2026-07-24',
    acceptedEstimatedCostCents: 18,
    acceptedMaximumCostCents: 24,
    ...overrides,
  };
}

function startProjection() {
  return {
    contractVersion: 'extension-ai-image-suite-projection/v1',
    context: { ...context },
    commandAuthority: {
      ...commandAuthority,
      authorityHash: hashExtensionAiImageSuiteContext(commandAuthority),
    },
    applyPolicy: {
      target: 'ERP_SOURCE_PRODUCT', mode: 'append', writesStoreDraft: false,
    },
    plan: {
      id: 'plan-1', versionId: 'plan-version-1', revision: 3,
      status: 'APPROVED', skuKey: null,
      preview: {
        hash: 'a'.repeat(64), pricingVersion: 'pricing-2026-07-24', itemCount: 2,
        estimatedCostCents: 18, maximumCostCents: 24, slots: [],
      },
      allowedActions: ['START'],
      commands: {
        START: {
          expectedPreviewHash: 'a'.repeat(64),
          acceptedPricingVersion: 'pricing-2026-07-24',
          acceptedEstimatedCostCents: 18,
          acceptedMaximumCostCents: 24,
        },
      },
    },
    suite: null,
  };
}

function continueCommand(overrides: Record<string, unknown> = {}) {
  return {
    version: 'extension-ai-image-suite-execute-command/v1',
    action: 'CONTINUE',
    ...commandAuthority,
    suiteId: 'suite-1',
    expectedSuiteRevision: 4,
    ...overrides,
  };
}

function cancelCommand(overrides: Record<string, unknown> = {}) {
  return {
    version: 'extension-ai-image-suite-execute-command/v1',
    action: 'CANCEL',
    ...commandAuthority,
    suiteId: 'suite-1',
    expectedSuiteRevision: 7,
    ...overrides,
  };
}

function retryCommand(overrides: Record<string, unknown> = {}) {
  return {
    version: 'extension-ai-image-suite-execute-command/v1',
    action: 'RETRY_SLOT',
    ...commandAuthority,
    suiteId: 'suite-1', slotId: 'slot-2',
    expectedSuiteRevision: 8, expectedSlotRevision: 3,
    acceptedAdditionalMaximumCostCents: 12,
    ...overrides,
  };
}

function reviewCommand(overrides: Record<string, unknown> = {}) {
  return {
    version: 'extension-ai-image-suite-review-command/v1',
    action: 'REVIEW_SLOT',
    ...commandAuthority,
    suiteId: 'suite-1', slotId: 'slot-1',
    workflowId: 'workflow-1', outputAssetId: 'asset-1',
    expectedSuiteRevision: 8, expectedSlotRevision: 5, expectedWorkflowRevision: 4,
    decision: 'APPROVE',
    ...overrides,
  };
}

function applyCommand(overrides: Record<string, unknown> = {}) {
  return {
    version: 'extension-ai-image-suite-apply-command/v1',
    action: 'APPLY_SLOT',
    ...commandAuthority,
    suiteId: 'suite-1', slotId: 'slot-1',
    workflowId: 'workflow-1', outputAssetId: 'asset-1',
    expectedSuiteRevision: 8, expectedSlotRevision: 5, expectedWorkflowRevision: 5,
    expectedTargetUpdatedAt: targetUpdatedAt,
    mode: 'append',
    ...overrides,
  };
}

function reviewProjection(overrides: Record<string, unknown> = {}) {
  return suiteProjection({
    status: 'PARTIAL_FAILURE', revision: 8,
    allowedActions: [], commands: {},
    slots: [{
      id: 'slot-1', status: 'SUCCEEDED', revision: 5,
      workflowId: 'workflow-1', workflowRevision: 4,
      reviewStatus: 'PENDING', output: { id: 'asset-1', url: 'https://erp.example/asset.png' },
      allowedActions: ['REVIEW_SLOT'],
      commands: {
        REVIEW_SLOT: {
          suiteId: 'suite-1', slotId: 'slot-1',
          workflowId: 'workflow-1', outputAssetId: 'asset-1',
          expectedSuiteRevision: 8, expectedSlotRevision: 5, expectedWorkflowRevision: 4,
          decisions: ['APPROVE', 'REJECT'],
        },
      },
    }],
    ...overrides,
  });
}

function applyProjection() {
  const projection = reviewProjection() as any;
  const slot = projection.suite.slots[0];
  slot.workflowRevision = 5;
  slot.reviewStatus = 'APPROVED';
  slot.allowedActions = ['APPLY_SLOT'];
  slot.commands = {
    APPLY_SLOT: {
      suiteId: 'suite-1', slotId: 'slot-1',
      workflowId: 'workflow-1', outputAssetId: 'asset-1',
      expectedSuiteRevision: 8, expectedSlotRevision: 5, expectedWorkflowRevision: 5,
      mode: 'append', target: 'ERP_SOURCE_PRODUCT', writesStoreDraft: false,
      expectedTargetUpdatedAt: targetUpdatedAt,
    },
  };
  return projection;
}

function suiteProjection(overrides: Record<string, unknown> = {}) {
  const projection = startProjection() as any;
  projection.plan.allowedActions = [];
  projection.plan.commands = {};
  projection.suite = {
    id: 'suite-1', status: 'PLANNED', revision: 4,
    previewHash: 'a'.repeat(64), pricingVersion: 'pricing-2026-07-24',
    itemCount: 2, estimatedCostCents: 18, maximumCostCents: 24,
    allowedActions: ['CONTINUE'],
    commands: { CONTINUE: { suiteId: 'suite-1', expectedSuiteRevision: 4 } },
    slots: [],
    ...overrides,
  };
  return projection;
}

function envelope(command: Record<string, unknown>) {
  return {
    ownerUserId: 'owner-1', actorUserId: 'owner-1',
    shopId: 'shop-1', listingWorkflowId: 'listing-1', draftVersion: 7,
    idempotencyKey: deriveExtensionAiImageSuiteIdempotencyKey(command),
    command,
  };
}

describe('extension AI image suite post-commit queue recovery', () => {
  it('returns the committed receipt when frontier enqueue is deferred to recovery', async () => {
    const enqueueError = new Error('redis unavailable');
    const enqueue = vi.fn(async () => { throw enqueueError; });
    const onDeferred = vi.fn(() => { throw new Error('logger unavailable'); });
    const runPostCommit = createExtensionAiImageSuitePostCommitRunner({
      enqueue,
      onDeferred,
    });
    const receipt = {
      suiteId: 'suite-1', status: 'QUEUED', revision: 5, replayed: false,
    };

    await expect(runPostCommit('suite-1', async () => receipt)).resolves.toBe(receipt);

    expect(enqueue).toHaveBeenCalledWith('suite-1');
    expect(onDeferred).toHaveBeenCalledWith('suite-1', enqueueError);
  });

  it('does not hide mutation failures or enqueue work before the commit succeeds', async () => {
    const mutationError = new Error('revision changed');
    const enqueue = vi.fn(async () => undefined);
    const onDeferred = vi.fn();
    const runPostCommit = createExtensionAiImageSuitePostCommitRunner({
      enqueue,
      onDeferred,
    });

    await expect(runPostCommit('suite-1', async () => {
      throw mutationError;
    })).rejects.toBe(mutationError);

    expect(enqueue).not.toHaveBeenCalled();
    expect(onDeferred).not.toHaveBeenCalled();
  });

  it('returns the committed receipt when BullMQ delivery never settles', async () => {
    vi.useFakeTimers();
    try {
      const enqueue = vi.fn(async () => await new Promise<void>(() => undefined));
      const onDeferred = vi.fn();
      const runPostCommit = createExtensionAiImageSuitePostCommitRunner({
        enqueue,
        onDeferred,
        timeoutMs: 1_000,
      });
      const receipt = {
        suiteId: 'suite-1', status: 'QUEUED', revision: 5, replayed: false,
      };

      const pending = runPostCommit('suite-1', async () => receipt);
      await vi.advanceTimersByTimeAsync(1_000);

      await expect(pending).resolves.toBe(receipt);
      expect(onDeferred).toHaveBeenCalledWith(
        'suite-1',
        expect.objectContaining({
          message: 'AI image suite post-commit frontier enqueue timed out',
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('wires CONTINUE, CANCEL, and RETRY_SLOT through the post-commit runner', () => {
    const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');

    expect(source.match(/commitExtensionAiImageSuiteWithFrontierRecovery\(/gu)).toHaveLength(3);
    expect(source).not.toContain('await enqueueExtensionAiImageSuiteFrontier');
  });
});

describe('extension AI image suite execute command executor', () => {
  it('starts only the current server-priced approved plan and returns a safe receipt', async () => {
    const start = vi.fn(async () => ({
      suiteId: 'suite-1', status: 'PLANNED', revision: 1, replayed: false,
      provider: 'must-not-leak', prompt: 'must-not-leak', apiKey: 'must-not-leak',
    }));
    const execute = createExtensionAiImageSuiteExecuteCommandExecutor({
      loadAuthority: vi.fn(async () => authority),
      loadProjection: vi.fn(async () => startProjection()),
      start,
      continue: vi.fn(), cancel: vi.fn(), retry: vi.fn(),
    });
    const command = startCommand();

    const result = await execute(envelope(command));

    expect(result).toEqual({
      action: 'START', suiteId: 'suite-1', status: 'PLANNED', revision: 1, replayed: false,
    });
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
    expect(start).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 'owner-1', actorUserId: 'owner-1',
      snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
      shopId: 'shop-1', listingWorkflowId: 'listing-1',
      draftRevision: 11, draftVersion: 7,
      planId: 'plan-1', planVersionId: 'plan-version-1', planRevision: 3,
      expectedPreviewHash: 'a'.repeat(64), pricingVersion: 'pricing-2026-07-24',
      estimatedCostCents: 18, maximumCostCents: 24,
      operationKey: deriveExtensionAiImageSuiteIdempotencyKey(command),
    }));
  });

  it('continues only the exact projected suite revision', async () => {
    const continueSuite = vi.fn(async () => ({
      suiteId: 'suite-1', status: 'QUEUED', revision: 5, replayed: false,
    }));
    const execute = createExtensionAiImageSuiteExecuteCommandExecutor({
      loadAuthority: vi.fn(async () => authority),
      loadProjection: vi.fn(async () => suiteProjection()),
      start: vi.fn(), continue: continueSuite, cancel: vi.fn(), retry: vi.fn(),
    });
    const command = continueCommand();

    await expect(execute(envelope(command))).resolves.toEqual({
      action: 'CONTINUE', suiteId: 'suite-1', status: 'QUEUED', revision: 5, replayed: false,
    });
    expect(continueSuite).toHaveBeenCalledWith(expect.objectContaining({
      suiteId: 'suite-1', expectedSuiteRevision: 4,
      operationKey: deriveExtensionAiImageSuiteIdempotencyKey(command),
    }));
  });

  it('cancels only when the current suite projection allows cancellation', async () => {
    const cancel = vi.fn(async () => ({
      suiteId: 'suite-1', status: 'CANCEL_REQUESTED', revision: 8, replayed: false,
    }));
    const projection = suiteProjection({
      status: 'RUNNING', revision: 7,
      allowedActions: ['CANCEL'],
      commands: { CANCEL: { suiteId: 'suite-1', expectedSuiteRevision: 7 } },
    });
    const execute = createExtensionAiImageSuiteExecuteCommandExecutor({
      loadAuthority: vi.fn(async () => authority),
      loadProjection: vi.fn(async () => projection),
      start: vi.fn(), continue: vi.fn(), cancel, retry: vi.fn(),
    });
    const command = cancelCommand();

    await expect(execute(envelope(command))).resolves.toEqual({
      action: 'CANCEL', suiteId: 'suite-1',
      status: 'CANCEL_REQUESTED', revision: 8, replayed: false,
    });
    expect(cancel).toHaveBeenCalledWith(expect.objectContaining({
      suiteId: 'suite-1', expectedSuiteRevision: 7,
      operationKey: deriveExtensionAiImageSuiteIdempotencyKey(command),
    }));
  });

  it('retries only the exact failed slot and current additional maximum cost', async () => {
    const retry = vi.fn(async () => ({
      suiteId: 'suite-1', status: 'QUEUED', revision: 9, replayed: false,
    }));
    const projection = suiteProjection({
      status: 'PARTIAL_FAILURE', revision: 8,
      allowedActions: [], commands: {},
      slots: [{
        id: 'slot-2', status: 'FAILED', revision: 3,
        maximumCostCents: 12,
        allowedActions: ['RETRY_SLOT'],
        commands: {
          RETRY_SLOT: {
            suiteId: 'suite-1', slotId: 'slot-2',
            expectedSuiteRevision: 8, expectedSlotRevision: 3,
            acceptedAdditionalMaximumCostCents: 12,
          },
        },
      }],
    });
    const execute = createExtensionAiImageSuiteExecuteCommandExecutor({
      loadAuthority: vi.fn(async () => authority),
      loadProjection: vi.fn(async () => projection),
      start: vi.fn(), continue: vi.fn(), cancel: vi.fn(), retry,
    });
    const command = retryCommand();

    await expect(execute(envelope(command))).resolves.toEqual({
      action: 'RETRY_SLOT', suiteId: 'suite-1',
      status: 'QUEUED', revision: 9, replayed: false,
    });
    expect(retry).toHaveBeenCalledWith(expect.objectContaining({
      suiteId: 'suite-1', expectedSuiteRevision: 8,
      slotId: 'slot-2', expectedSlotRevision: 3,
      additionalMaximumCostCents: 12,
      operationKey: deriveExtensionAiImageSuiteIdempotencyKey(command),
    }));
  });

  it.each([
    ['owner', { ...authority, ownerUserId: 'other-owner' }, 'AI_IMAGE_SUITE_COMMAND_FORBIDDEN'],
    ['snapshot', { ...authority, snapshotId: 'snapshot-2' }, 'AI_IMAGE_SUITE_COMMAND_CONTEXT_STALE'],
    ['source product', { ...authority, supplyGoodsId: 'goods-2' }, 'AI_IMAGE_SUITE_COMMAND_CONTEXT_STALE'],
    ['listing revision', { ...authority, draftRevision: 12 }, 'AI_IMAGE_SUITE_COMMAND_CONTEXT_STALE'],
    ['listing version', { ...authority, draftVersion: 8 }, 'AI_IMAGE_SUITE_COMMAND_CONTEXT_STALE'],
  ])('rejects stale or unauthorized %s authority before mutation', async (_label, current, code) => {
    const start = vi.fn();
    const loadProjection = vi.fn(async () => startProjection());
    const execute = createExtensionAiImageSuiteExecuteCommandExecutor({
      loadAuthority: vi.fn(async () => current), loadProjection,
      start, continue: vi.fn(), cancel: vi.fn(), retry: vi.fn(),
    });

    await expect(execute(envelope(startCommand()))).rejects.toMatchObject({ code });
    expect(loadProjection).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it('rejects a start after the server preview price changes', async () => {
    const start = vi.fn();
    const projection = startProjection() as any;
    projection.plan.preview.maximumCostCents = 25;
    const execute = createExtensionAiImageSuiteExecuteCommandExecutor({
      loadAuthority: vi.fn(async () => authority),
      loadProjection: vi.fn(async () => projection),
      start, continue: vi.fn(), cancel: vi.fn(), retry: vi.fn(),
    });

    await expect(execute(envelope(startCommand()))).rejects.toMatchObject({
      code: 'AI_IMAGE_SUITE_COMMAND_PRICING_CHANGED',
    });
    expect(start).not.toHaveBeenCalled();
  });

  it('rejects a retry after the server-side slot price changes', async () => {
    const retry = vi.fn();
    const projection = suiteProjection({
      status: 'PARTIAL_FAILURE', revision: 8,
      allowedActions: [], commands: {},
      slots: [{
        id: 'slot-2', status: 'FAILED', revision: 3, maximumCostCents: 13,
        allowedActions: ['RETRY_SLOT'],
        commands: { RETRY_SLOT: {
          suiteId: 'suite-1', slotId: 'slot-2',
          expectedSuiteRevision: 8, expectedSlotRevision: 3,
          acceptedAdditionalMaximumCostCents: 13,
        } },
      }],
    });
    const execute = createExtensionAiImageSuiteExecuteCommandExecutor({
      loadAuthority: vi.fn(async () => authority),
      loadProjection: vi.fn(async () => projection),
      start: vi.fn(), continue: vi.fn(), cancel: vi.fn(), retry,
    });

    await expect(execute(envelope(retryCommand()))).rejects.toMatchObject({
      code: 'AI_IMAGE_SUITE_COMMAND_PRICING_CHANGED',
    });
    expect(retry).not.toHaveBeenCalled();
  });

  it('passes the same derived operation key through an idempotent replay', async () => {
    const start = vi.fn()
      .mockResolvedValueOnce({ suiteId: 'suite-1', status: 'PLANNED', revision: 1, replayed: false })
      .mockResolvedValueOnce({ suiteId: 'suite-1', status: 'PLANNED', revision: 1, replayed: true });
    const execute = createExtensionAiImageSuiteExecuteCommandExecutor({
      loadAuthority: vi.fn(async () => authority),
      loadProjection: vi.fn(async () => startProjection()),
      start, continue: vi.fn(), cancel: vi.fn(), retry: vi.fn(),
    });
    const command = startCommand();
    const input = envelope(command);
    const { idempotencyKey: _idempotencyKey, ...derivedInput } = input;

    await expect(execute(input)).resolves.toMatchObject({ replayed: false });
    await expect(execute(derivedInput)).resolves.toMatchObject({ replayed: true });
    const expectedKey = deriveExtensionAiImageSuiteIdempotencyKey(command);
    expect(start).toHaveBeenNthCalledWith(1, expect.objectContaining({ operationKey: expectedKey }));
    expect(start).toHaveBeenNthCalledWith(2, expect.objectContaining({ operationKey: expectedKey }));
  });

  it('rejects an envelope idempotency key that is not derived from the strict command', async () => {
    const start = vi.fn();
    const execute = createExtensionAiImageSuiteExecuteCommandExecutor({
      loadAuthority: vi.fn(async () => authority),
      loadProjection: vi.fn(async () => startProjection()),
      start, continue: vi.fn(), cancel: vi.fn(), retry: vi.fn(),
    });

    await expect(execute({
      ...envelope(startCommand()), idempotencyKey: 'f'.repeat(64),
    })).rejects.toMatchObject({ code: 'AI_IMAGE_SUITE_COMMAND_IDEMPOTENCY_MISMATCH' });
    expect(start).not.toHaveBeenCalled();
  });

  it.each([
    ['client provider fields', {
      ownerUserId: 'owner-1', actorUserId: 'owner-1',
      shopId: 'shop-1', listingWorkflowId: 'listing-1', draftVersion: 7,
      command: startCommand({
        provider: 'openai-images', model: 'gpt-image-1',
        baseUrl: 'https://provider.invalid/v1', apiKey: 'secret',
      }),
    }],
    ['unknown envelope fields', { ...envelope(startCommand()), providerUrl: 'https://provider.invalid' }],
  ])('rejects %s before authority lookup', async (_label, input) => {
    const loadAuthority = vi.fn();
    const execute = createExtensionAiImageSuiteExecuteCommandExecutor({
      loadAuthority, loadProjection: vi.fn(),
      start: vi.fn(), continue: vi.fn(), cancel: vi.fn(), retry: vi.fn(),
    });

    await expect(execute(input)).rejects.toMatchObject({
      code: 'AI_IMAGE_SUITE_COMMAND_INVALID',
    });
    expect(loadAuthority).not.toHaveBeenCalled();
  });
});

describe('extension AI image suite review command executor', () => {
  it('reviews only the exact projected suite output revision', async () => {
    const review = vi.fn(async () => ({
      suiteId: 'suite-1', status: 'SUCCEEDED', revision: 5, replayed: false,
      provider: 'must-not-leak', prompt: 'must-not-leak',
    }));
    const execute = createExtensionAiImageSuiteReviewCommandExecutor({
      loadAuthority: vi.fn(async () => authority),
      loadProjection: vi.fn(async () => reviewProjection()),
      review,
    });
    const command = reviewCommand();

    const result = await execute(envelope(command));

    expect(result).toEqual({
      action: 'REVIEW_SLOT', suiteId: 'suite-1', slotId: 'slot-1',
      workflowId: 'workflow-1', status: 'SUCCEEDED', revision: 5, replayed: false,
    });
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
    expect(review).toHaveBeenCalledWith(expect.objectContaining({
      suiteId: 'suite-1', slotId: 'slot-1', workflowId: 'workflow-1',
      outputAssetId: 'asset-1', expectedSuiteRevision: 8,
      expectedSlotRevision: 5, expectedWorkflowRevision: 4,
      decision: 'APPROVE',
      operationKey: deriveExtensionAiImageSuiteIdempotencyKey(command),
    }));
  });

  it.each([
    ['plan version', (projection: any) => { projection.plan.versionId = 'plan-version-2'; }],
    ['plan revision', (projection: any) => { projection.commandAuthority.planRevision = 4; }],
    ['suite revision', (projection: any) => { projection.suite.revision = 9; }],
    ['slot revision', (projection: any) => { projection.suite.slots[0].revision = 6; }],
    ['workflow revision', (projection: any) => { projection.suite.slots[0].workflowRevision = 5; }],
    ['output', (projection: any) => { projection.suite.slots[0].output.id = 'asset-2'; }],
  ])('rejects a stale %s before review', async (_label, mutate) => {
    const projection = reviewProjection() as any;
    mutate(projection);
    const review = vi.fn();
    const execute = createExtensionAiImageSuiteReviewCommandExecutor({
      loadAuthority: vi.fn(async () => authority),
      loadProjection: vi.fn(async () => projection),
      review,
    });

    await expect(execute(envelope(reviewCommand()))).rejects.toMatchObject({
      code: 'AI_IMAGE_SUITE_COMMAND_CONTEXT_STALE',
    });
    expect(review).not.toHaveBeenCalled();
  });

  it('rejects review when the current projection no longer allows it', async () => {
    const projection = reviewProjection() as any;
    projection.suite.slots[0].allowedActions = [];
    projection.suite.slots[0].commands = {};
    const review = vi.fn();
    const execute = createExtensionAiImageSuiteReviewCommandExecutor({
      loadAuthority: vi.fn(async () => authority),
      loadProjection: vi.fn(async () => projection),
      review,
    });

    await expect(execute(envelope(reviewCommand()))).rejects.toMatchObject({
      code: 'AI_IMAGE_SUITE_COMMAND_ACTION_NOT_ALLOWED',
    });
    expect(review).not.toHaveBeenCalled();
  });
});

describe('extension AI image suite apply command executor', () => {
  it('applies only by appending the approved output to the ERP source product', async () => {
    const apply = vi.fn(async () => ({
      suiteId: 'suite-1', status: 'SUCCEEDED', revision: 6, replayed: false,
      storeDraftUrl: 'must-not-leak', provider: 'must-not-leak',
    }));
    const execute = createExtensionAiImageSuiteApplyCommandExecutor({
      loadAuthority: vi.fn(async () => authority),
      loadProjection: vi.fn(async () => applyProjection()),
      apply,
    });
    const command = applyCommand();

    const result = await execute(envelope(command));

    expect(result).toEqual({
      action: 'APPLY_SLOT', suiteId: 'suite-1', slotId: 'slot-1',
      workflowId: 'workflow-1', status: 'SUCCEEDED', revision: 6, replayed: false,
      target: 'ERP_SOURCE_PRODUCT', mode: 'append', writesStoreDraft: false,
    });
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({
      suiteId: 'suite-1', slotId: 'slot-1', workflowId: 'workflow-1',
      outputAssetId: 'asset-1', expectedSuiteRevision: 8,
      expectedSlotRevision: 5, expectedWorkflowRevision: 5,
      targetType: 'collect', targetId: 'goods-1',
      target: 'ERP_SOURCE_PRODUCT', mode: 'append', writesStoreDraft: false,
      expectedTargetUpdatedAt: targetUpdatedAt,
      operationKey: deriveExtensionAiImageSuiteIdempotencyKey(command),
    }));
  });

  it('fails closed if the projection claims a store-draft write', async () => {
    const projection = applyProjection() as any;
    projection.applyPolicy.writesStoreDraft = true;
    const apply = vi.fn();
    const execute = createExtensionAiImageSuiteApplyCommandExecutor({
      loadAuthority: vi.fn(async () => authority),
      loadProjection: vi.fn(async () => projection),
      apply,
    });

    await expect(execute(envelope(applyCommand()))).rejects.toMatchObject({
      code: 'AI_IMAGE_SUITE_COMMAND_ACTION_NOT_ALLOWED',
    });
    expect(apply).not.toHaveBeenCalled();
  });

  it('rejects apply when the frozen ERP source-product target version changed', async () => {
    const projection = applyProjection() as any;
    projection.suite.slots[0].commands.APPLY_SLOT.expectedTargetUpdatedAt =
      '2026-07-24T00:00:01.000Z';
    const apply = vi.fn();
    const execute = createExtensionAiImageSuiteApplyCommandExecutor({
      loadAuthority: vi.fn(async () => authority),
      loadProjection: vi.fn(async () => projection),
      apply,
    });

    await expect(execute(envelope(applyCommand()))).rejects.toMatchObject({
      code: 'AI_IMAGE_SUITE_COMMAND_CONTEXT_STALE',
    });
    expect(apply).not.toHaveBeenCalled();
  });
});
