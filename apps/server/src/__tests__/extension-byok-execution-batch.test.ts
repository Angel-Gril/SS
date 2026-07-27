import { describe, expect, it, vi } from 'vitest';
import {
  createExtensionByokExecutionBatchService,
  ExtensionByokExecutionBatchError,
  type ExtensionByokExecutionBatchClaimInput,
  type ExtensionByokExecutionBatchClaimResult,
  type ExtensionByokExecutionBatchCancelResult,
  type ExtensionByokExecutionBatchItemRecord,
  type ExtensionByokExecutionBatchLoadResult,
  type ExtensionByokExecutionBatchRecord,
  type ExtensionByokExecutionBatchRepository,
  type ExtensionByokExecutionBatchSuccessorClaimResult,
} from '../services/extension-byok-execution-batch.js';
import type {
  ExtensionByokExecutionIntentRecord,
} from '../services/extension-byok-execution-intent.js';
import type { ExtensionByokWorkbenchDraft } from '../services/extension-byok-workbench-launch.js';

const HASHES = ['a', 'b', 'c', 'd'].map((value) => value.repeat(64));

function draft(): ExtensionByokWorkbenchDraft {
  return {
    id: 'workflow-1',
    ownerUserId: 'owner-1',
    shopId: 'shop-1',
    revision: 7,
    draftVersion: 11,
    supplyGoodsId: 'goods-1',
    sourceCaptureSnapshotId: 'snapshot-1',
    sourceCaptureCurrent: true,
    sourcePlatform: '1688',
    sourceProductId: 'source-1',
    selectedSkuKeys: ['sku-1', 'sku-2'],
    media: { assignments: [] },
    stage: 'MEDIA_REVIEW',
    runState: 'ACTIVE',
  };
}

function item(
  index: number,
  overrides: Partial<ExtensionByokExecutionBatchClaimInput['items'][number]> = {},
): ExtensionByokExecutionBatchClaimInput['items'][number] {
  const targets = [
    { skuKey: 'sku-1', slotKey: 'sku:sku-1:hero' },
    { skuKey: 'sku-2', slotKey: 'sku:sku-2:hero' },
    { skuKey: 'sku-1', slotKey: 'shared:detail:SCENE' },
  ] as const;
  const target = targets[index] ?? targets[0];
  return {
    binding: {
      contractVersion: 'extension-byok-readiness-binding/v2',
      ownerUserId: 'owner-1',
      deviceSessionId: 'session-1',
      shopId: 'shop-1',
      workflowId: 'workflow-1',
      draftRevision: 7,
      draftVersion: 11,
      sourcePlatform: '1688',
      sourceProductId: 'source-1',
      sourceCaptureSnapshotId: 'snapshot-1',
      supplyGoodsId: 'goods-1',
      ...target,
      assignmentMode: 'APPEND',
      assignmentOrdinal: index,
      providerOrigin: 'https://provider.example',
      model: 'image-model-1',
      operation: 'TEXT_TO_IMAGE',
      policyRevision: '23',
    },
    requestMode: 'json',
    providerIdempotencyKey: `provider-attempt-000${index + 1}`,
    providerRequestHash: HASHES[index]!,
    ...overrides,
  };
}

function batchRecord(
  id: string,
  status: ExtensionByokExecutionBatchRecord['status'],
): ExtensionByokExecutionBatchRecord {
  const createdAt = new Date('2026-07-28T01:00:00.000Z');
  return {
    id,
    contractVersion: 'extension-byok-execution-batch/v1',
    status,
    ownerUserId: 'owner-1',
    actorUserId: 'owner-1',
    deviceSessionId: 'session-1',
    shopId: 'shop-1',
    listingWorkflowId: 'workflow-1',
    draftRevision: 7,
    draftVersion: 11,
    sourcePlatform: '1688',
    sourceProductId: 'source-1',
    sourceCaptureSnapshotId: 'snapshot-1',
    supplyGoodsId: 'goods-1',
    firstAssignmentOrdinal: 0,
    itemCount: 3,
    idempotencyKey: 'provider-batch-attempt-0001',
    requestHash: 'f'.repeat(64),
    boundDraftRevision: null,
    boundDraftVersion: null,
    boundAt: null,
    cancelledAt: status === 'CANCELLED' ? createdAt : null,
    createdAt,
    updatedAt: createdAt,
  };
}

function batchItemRecord(index: number): ExtensionByokExecutionBatchItemRecord {
  const target = item(index).binding;
  const createdAt = new Date('2026-07-28T01:00:00.000Z');
  return {
    id: `batch-item-${index}`,
    batchId: 'batch-1',
    ownerUserId: 'owner-1',
    listingWorkflowId: 'workflow-1',
    draftRevision: 7,
    draftVersion: 11,
    itemIndex: index,
    skuKey: target.skuKey!,
    slotKey: target.slotKey!,
    assignmentOrdinal: index,
    status: 'ACTIVE',
    boundAt: null,
    releasedAt: null,
    createdAt,
    updatedAt: createdAt,
  };
}

function executionIntent(
  index: number,
  outcome: ExtensionByokExecutionIntentRecord['outcome'] = 'PENDING',
): ExtensionByokExecutionIntentRecord {
  const value = item(index);
  const createdAt = new Date('2026-07-28T01:00:00.000Z');
  return {
    id: `intent-${index}`,
    contractVersion: 'extension-byok-execution-intent/v1',
    executionMode: 'BYOK',
    ownerUserId: 'owner-1',
    actorUserId: 'owner-1',
    deviceSessionId: 'session-1',
    shopId: 'shop-1',
    listingWorkflowId: 'workflow-1',
    draftRevision: 7,
    draftVersion: 11,
    sourceCaptureSnapshotId: 'snapshot-1',
    supplyGoodsId: 'goods-1',
    skuKey: value.binding.skuKey!,
    slotKey: value.binding.slotKey!,
    assignmentMode: 'APPEND',
    assignmentOrdinal: index,
    policyRevision: 23,
    providerOriginSha256: 'e'.repeat(64),
    model: 'image-model-1',
    operation: 'TEXT_TO_IMAGE',
    requestMode: 'json',
    providerIdempotencyKey: value.providerIdempotencyKey,
    providerRequestHash: value.providerRequestHash,
    requestHash: 'f'.repeat(64),
    executionBatchItemId: `batch-item-${index}`,
    executionBatchAttemptIndex: 0,
    outcome,
    providerRequestIdSha256: null,
    resultSha256: outcome === 'SUCCEEDED' ? '9'.repeat(64) : null,
    outcomeUpdatedAt: outcome === 'PENDING' ? null : createdAt,
    createdAt,
    updatedAt: createdAt,
  };
}

function input(
  overrides: Partial<ExtensionByokExecutionBatchClaimInput> = {},
): ExtensionByokExecutionBatchClaimInput {
  return {
    identity: {
      ownerUserId: 'owner-1',
      actorUserId: 'owner-1',
      deviceSessionId: 'session-1',
    },
    idempotencyKey: 'provider-batch-attempt-0001',
    items: [item(0), item(1), item(2)],
    ...overrides,
  };
}

function build(options: { draft?: ExtensionByokWorkbenchDraft } = {}) {
  const loadBatchStateByIdempotency = vi.fn(async ():
  Promise<ExtensionByokExecutionBatchLoadResult> => ({
      kind: 'found',
      batch: batchRecord('batch-1', 'OPEN'),
      items: [0, 1, 2].map((index) => ({
        item: batchItemRecord(index),
        intent: executionIntent(index),
      })),
    }));
  const loadBatchState = vi.fn(async (
    value: Parameters<ExtensionByokExecutionBatchRepository['loadBatchState']>[0],
  ): Promise<ExtensionByokExecutionBatchLoadResult> => ({
      kind: 'found',
      batch: batchRecord(value.batchId, 'OPEN'),
      items: [0, 1, 2].map((index) => ({
        item: batchItemRecord(index),
        intent: executionIntent(index),
      })),
    }));
  const claimBatch = vi.fn(async (
    value: Parameters<ExtensionByokExecutionBatchRepository['claimBatch']>[0],
  ): Promise<ExtensionByokExecutionBatchClaimResult> => ({
      kind: 'created',
      batch: value.batch,
      intents: value.intents,
    }));
  const claimSuccessor = vi.fn(async (
    value: Parameters<ExtensionByokExecutionBatchRepository['claimSuccessor']>[0],
  ): Promise<ExtensionByokExecutionBatchSuccessorClaimResult> => ({
      kind: 'created' as const,
      batch: batchRecord(value.batchId, 'OPEN'),
      intent: {
        ...value.intent,
        executionBatchItemId: 'batch-item-1',
        executionBatchAttemptIndex: 1,
      },
    }));
  const cancelBatch = vi.fn(async (
    value: Parameters<ExtensionByokExecutionBatchRepository['cancelBatch']>[0],
  ): Promise<ExtensionByokExecutionBatchCancelResult> => ({
      kind: 'cancelled' as const,
      batch: batchRecord(value.batchId, 'CANCELLED'),
    }));
  const repository = {
    loadBatchStateByIdempotency,
    loadBatchState,
    claimBatch,
    claimSuccessor,
    cancelBatch,
  };
  let sequence = 0;
  const service = createExtensionByokExecutionBatchService({
    loadShop: vi.fn(async () => ({
      id: 'shop-1', userId: 'owner-1', platform: 'OZON', status: 'ACTIVE',
    })),
    loadDraft: vi.fn(async () => options.draft || draft()),
    evaluatePolicy: vi.fn(async (value) => ({
      contractVersion: 'extension-byok-readiness/v1' as const,
      allowed: true,
      mode: 'pilot' as const,
      policyRevision: 23,
      maxConcurrency: 1,
      context: value,
      capabilities: {
        generation: { enabled: true, ready: true, reasonCode: 'READY' as const },
        ingest: { enabled: true, ready: true, reasonCode: 'READY' as const },
        publish: { enabled: false, ready: false, reasonCode: 'PUBLISH_DISABLED' as const },
      },
    })),
    repository,
    createId: () => `reserved-${++sequence}`,
    now: () => new Date('2026-07-28T01:00:00.000Z'),
  });
  return { service, repository };
}

describe('extension BYOK execution batch reservation', () => {
  it('atomically prepares two SKU heroes and one shared detail with consecutive live ordinals', async () => {
    const { service, repository } = build();
    const result = await service.claim(input());

    expect(result).toMatchObject({
      replayed: false,
      batch: {
        id: 'reserved-1',
        status: 'OPEN',
        firstAssignmentOrdinal: 0,
        itemCount: 3,
      },
      intents: [
        { id: 'reserved-5', skuKey: 'sku-1', assignmentOrdinal: 0, outcome: 'PENDING' },
        { id: 'reserved-6', skuKey: 'sku-2', assignmentOrdinal: 1, outcome: 'PENDING' },
        { id: 'reserved-7', slotKey: 'shared:detail:SCENE', assignmentOrdinal: 2 },
      ],
    });
    expect(repository.claimBatch).toHaveBeenCalledOnce();
  });

  it('reserves a batch with an explicitly selected non-first SKU shared-detail anchor', async () => {
    const { service, repository } = build();
    const secondHero = item(1, {
      binding: { ...item(1).binding, assignmentOrdinal: 0 },
    });
    const firstHero = item(0, {
      binding: { ...item(0).binding, assignmentOrdinal: 1 },
    });
    const sharedDetail = item(2, {
      binding: { ...item(2).binding, skuKey: 'sku-2', assignmentOrdinal: 2 },
    });

    await expect(service.claim(input({
      items: [secondHero, firstHero, sharedDetail],
    }))).resolves.toMatchObject({
      intents: [
        { skuKey: 'sku-2', slotKey: 'sku:sku-2:hero', assignmentOrdinal: 0 },
        { skuKey: 'sku-1', slotKey: 'sku:sku-1:hero', assignmentOrdinal: 1 },
        { skuKey: 'sku-2', slotKey: 'shared:detail:SCENE', assignmentOrdinal: 2 },
      ],
    });
    expect(repository.claimBatch).toHaveBeenCalledOnce();
  });

  it.each([
    ['model', () => item(0, {
      binding: { ...item(0).binding, model: 'sk-secret-model-value' },
    })],
    ['Provider idempotency key', () => item(0, {
      providerIdempotencyKey: 'sk-secret-provider-idempotency-value',
    })],
  ])('rejects a secret-shaped %s before reserving a batch', async (_field, createItem) => {
    const { service, repository } = build();
    await expect(service.claim(input({
      items: [createItem(), item(1), item(2)],
    }))).rejects.toMatchObject({ code: 'BYOK_EXECUTION_BATCH_INVALID_REQUEST' });
    expect(repository.claimBatch).not.toHaveBeenCalled();
  });

  it('supports an exact repository replay without changing Provider attempt identities', async () => {
    const { service, repository } = build();
    repository.claimBatch.mockImplementationOnce(async (value) => ({
      kind: 'replayed' as const,
      batch: { ...value.batch, id: 'batch-existing' },
      intents: value.intents.map((intent, index) => ({
        ...intent, id: `intent-existing-${index}`,
      })),
    }));
    await expect(service.claim(input())).resolves.toMatchObject({
      replayed: true,
      batch: { id: 'batch-existing' },
      intents: [
        { id: 'intent-existing-0', providerIdempotencyKey: 'provider-attempt-0001' },
        { id: 'intent-existing-1' },
        { id: 'intent-existing-2' },
      ],
    });
  });

  it.each([
    ['non-consecutive ordinal', [item(0), item(1, {
      binding: { ...item(1).binding, assignmentOrdinal: 2 },
    })]],
    ['duplicate slot', [item(0), item(1, {
      binding: { ...item(1).binding, skuKey: 'sku-1', slotKey: 'sku:sku-1:hero' },
    })]],
    ['unselected shared anchor', [item(0), item(2, {
      binding: { ...item(2).binding, skuKey: 'sku-3', assignmentOrdinal: 1 },
    })]],
    ['mixed draft', [item(0), item(1, {
      binding: { ...item(1).binding, workflowId: 'workflow-2' },
    })]],
  ] as const)('rejects %s before reservation persistence', async (_label, items) => {
    const { service, repository } = build();
    await expect(service.claim(input({ items: [...items] }))).rejects.toBeInstanceOf(
      ExtensionByokExecutionBatchError,
    );
    expect(repository.claimBatch).not.toHaveBeenCalled();
  });

  it('uses the live draft tail rather than assuming zero', async () => {
    const current = draft();
    current.media.assignments = [{
      scope: 'PRODUCT', slotKey: 'existing:detail', assetId: 'asset-existing', source: 'SOURCE',
    }];
    const { service, repository } = build({ draft: current });
    const items = [0, 1].map((index) => item(index, {
      binding: { ...item(index).binding, assignmentOrdinal: index + 1 },
    }));
    await expect(service.claim(input({ items }))).resolves.toMatchObject({
      batch: { firstAssignmentOrdinal: 1, itemCount: 2 },
    });
    expect(repository.claimBatch).toHaveBeenCalledOnce();
  });

  it('requires explicit Provider charge confirmation for a same-slot successor attempt', async () => {
    const { service, repository } = build();
    const successor = {
      identity: input().identity,
      batchId: 'batch-1',
      itemIndex: 0,
      currentIntentId: 'intent-1',
      providerChargeConfirmed: true as const,
      item: item(0, {
        providerIdempotencyKey: 'provider-attempt-successor-0001',
        providerRequestHash: 'd'.repeat(64),
      }),
    };
    await expect(service.claimSuccessor(successor)).resolves.toMatchObject({
      replayed: false,
      intent: {
        executionBatchItemId: 'batch-item-1',
        executionBatchAttemptIndex: 1,
        providerIdempotencyKey: 'provider-attempt-successor-0001',
      },
    });
    expect(repository.claimSuccessor).toHaveBeenCalledOnce();

    await expect(service.claimSuccessor({
      ...successor,
      providerChargeConfirmed: false as never,
    })).rejects.toMatchObject({ code: 'BYOK_EXECUTION_BATCH_INVALID_REQUEST' });
  });

  it('maps pending/unknown successor and cancellation fences to a stable conflict', async () => {
    const { service, repository } = build();
    repository.claimSuccessor.mockResolvedValueOnce({ kind: 'attempt_blocked' });
    await expect(service.claimSuccessor({
      identity: input().identity,
      batchId: 'batch-1',
      itemIndex: 0,
      currentIntentId: 'intent-pending',
      providerChargeConfirmed: true,
      item: item(0, {
        providerIdempotencyKey: 'provider-attempt-successor-0001',
        providerRequestHash: 'd'.repeat(64),
      }),
    })).rejects.toMatchObject({ code: 'BYOK_EXECUTION_BATCH_ATTEMPT_BLOCKED' });

    repository.cancelBatch.mockResolvedValueOnce({ kind: 'attempt_blocked' });
    await expect(service.cancel({
      identity: input().identity,
      batchId: 'batch-1',
    })).rejects.toMatchObject({ code: 'BYOK_EXECUTION_BATCH_ATTEMPT_BLOCKED' });
  });

  it('recovers the exact same-device batch state without re-evaluating mutable policy', async () => {
    const { service, repository } = build();
    const result = await service.getStatus({
      identity: input().identity,
      batchId: 'batch-1',
    });

    expect(result).toMatchObject({
      batch: { id: 'batch-1', status: 'OPEN' },
      items: [
        { item: { itemIndex: 0 }, intent: { outcome: 'PENDING' } },
        { item: { itemIndex: 1 }, intent: { outcome: 'PENDING' } },
        { item: { itemIndex: 2 }, intent: { outcome: 'PENDING' } },
      ],
    });
    expect(repository.loadBatchState).toHaveBeenCalledWith({
      identity: input().identity,
      batchId: 'batch-1',
    });
  });

  it.each([
    ['not_found', 'BYOK_EXECUTION_BATCH_NOT_FOUND', 404],
    ['forbidden', 'BYOK_EXECUTION_BATCH_FORBIDDEN', 403],
  ] as const)('maps a %s status lookup to a stable service error', async (
    kind,
    code,
    statusCode,
  ) => {
    const { service, repository } = build();
    repository.loadBatchState.mockResolvedValueOnce({ kind });
    await expect(service.getStatus({
      identity: input().identity,
      batchId: 'batch-1',
    })).rejects.toMatchObject({ code, statusCode });
  });

  it('fails closed when a repository returns state for another device', async () => {
    const { service, repository } = build();
    const foreign = batchRecord('batch-1', 'OPEN');
    foreign.deviceSessionId = 'session-2';
    repository.loadBatchState.mockResolvedValueOnce({
      kind: 'found',
      batch: foreign,
      items: [0, 1, 2].map((index) => ({
        item: batchItemRecord(index),
        intent: executionIntent(index),
      })),
    });

    await expect(service.getStatus({
      identity: input().identity,
      batchId: 'batch-1',
    })).rejects.toMatchObject({ code: 'BYOK_EXECUTION_BATCH_FORBIDDEN', statusCode: 403 });
  });

  it('recovers a PREPARING batch by its exact owner-scoped idempotency key', async () => {
    const { service, repository } = build();
    await expect(service.getStatusByIdempotencyKey({
      identity: input().identity,
      idempotencyKey: 'provider-batch-attempt-0001',
    })).resolves.toMatchObject({ batch: { id: 'batch-1', status: 'OPEN' } });
    expect(repository.loadBatchStateByIdempotency).toHaveBeenCalledWith({
      identity: input().identity,
      idempotencyKey: 'provider-batch-attempt-0001',
    });
  });

  it.each(['not_found', 'forbidden'] as const)(
    'closes idempotency recovery %s as the same not-found error',
    async (kind) => {
    const { service, repository } = build();
    repository.loadBatchStateByIdempotency.mockResolvedValueOnce({ kind });
    await expect(service.getStatusByIdempotencyKey({
      identity: input().identity,
      idempotencyKey: 'provider-batch-attempt-0001',
    })).rejects.toMatchObject({ code: 'BYOK_EXECUTION_BATCH_NOT_FOUND', statusCode: 404 });
    },
  );

  it.each([
    'too-short',
    'sk-abcdefghijklmnop',
    'https://provider.example/key',
  ])('rejects unsafe idempotency lookup %s before repository access', async (idempotencyKey) => {
    const { service, repository } = build();
    await expect(service.getStatusByIdempotencyKey({
      identity: input().identity,
      idempotencyKey,
    })).rejects.toMatchObject({ code: 'BYOK_EXECUTION_BATCH_INVALID_REQUEST' });
    expect(repository.loadBatchStateByIdempotency).not.toHaveBeenCalled();
  });
});
