import Fastify, { type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import {
  extensionByokExecutionBatchRoutes,
} from '../routes/extension-byok-execution-batch.js';
import {
  ExtensionByokExecutionBatchError,
  type ExtensionByokExecutionBatchErrorCode,
  type ExtensionByokExecutionBatchItemRecord,
  type ExtensionByokExecutionBatchRecord,
} from '../services/extension-byok-execution-batch.js';
import type {
  ExtensionByokExecutionIntentRecord,
} from '../services/extension-byok-execution-intent.js';

const HASHES = ['a', 'b', 'c', 'd'].map((value) => value.repeat(64));

function binding(itemIndex = 0) {
  const skuKey = `sku-${itemIndex + 1}`;
  return {
    contractVersion: 'extension-byok-readiness-binding/v2' as const,
    ownerUserId: 'owner-1',
    deviceSessionId: 'session-1',
    shopId: 'shop-1',
    workflowId: 'workflow-1',
    draftRevision: 7,
    draftVersion: 11,
    sourcePlatform: '1688' as const,
    sourceProductId: 'source-1',
    sourceCaptureSnapshotId: 'snapshot-1',
    supplyGoodsId: 'goods-1',
    skuKey,
    slotKey: `sku:${skuKey}:hero`,
    assignmentMode: 'APPEND' as const,
    assignmentOrdinal: itemIndex,
    providerOrigin: 'https://provider.example',
    model: 'image-model-1',
    operation: 'TEXT_TO_IMAGE' as const,
    policyRevision: '23',
  };
}

function requestItem(itemIndex = 0) {
  return {
    binding: binding(itemIndex),
    requestMode: 'json' as const,
    providerIdempotencyKey: `provider-attempt-000${itemIndex + 1}`,
    providerRequestHash: HASHES[itemIndex]!,
  };
}

function createPayload() {
  return {
    contractVersion: 'extension-byok-execution-batch-request/v1',
    idempotencyKey: 'provider-batch-attempt-0001',
    items: [requestItem(0), requestItem(1)],
  };
}

function batch(
  overrides: Partial<ExtensionByokExecutionBatchRecord> = {},
): ExtensionByokExecutionBatchRecord {
  const createdAt = new Date('2026-07-28T02:00:00.000Z');
  return {
    id: 'batch-1',
    contractVersion: 'extension-byok-execution-batch/v1',
    status: 'OPEN',
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
    itemCount: 2,
    idempotencyKey: 'provider-batch-attempt-0001',
    requestHash: 'e'.repeat(64),
    boundDraftRevision: null,
    boundDraftVersion: null,
    boundAt: null,
    cancelledAt: null,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function intent(
  itemIndex: number,
  attemptIndex = 0,
): ExtensionByokExecutionIntentRecord {
  const value = requestItem(itemIndex);
  const createdAt = new Date('2026-07-28T02:00:00.000Z');
  return {
    id: `intent-${itemIndex}-${attemptIndex}`,
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
    skuKey: value.binding.skuKey,
    slotKey: value.binding.slotKey,
    assignmentMode: 'APPEND',
    assignmentOrdinal: itemIndex,
    policyRevision: 23,
    providerOriginSha256: 'f'.repeat(64),
    model: 'image-model-1',
    operation: 'TEXT_TO_IMAGE',
    requestMode: 'json',
    providerIdempotencyKey: attemptIndex === 0
      ? value.providerIdempotencyKey
      : `provider-successor-000${itemIndex + 1}`,
    providerRequestHash: attemptIndex === 0 ? value.providerRequestHash : HASHES[3]!,
    requestHash: '9'.repeat(64),
    executionBatchItemId: `batch-item-${itemIndex}`,
    executionBatchAttemptIndex: attemptIndex,
    outcome: 'PENDING',
    providerRequestIdSha256: null,
    resultSha256: null,
    outcomeUpdatedAt: null,
    createdAt,
    updatedAt: createdAt,
  };
}

function statusItem(
  itemIndex: number,
  status: ExtensionByokExecutionBatchItemRecord['status'],
  outcome: ExtensionByokExecutionIntentRecord['outcome'],
  attemptIndex = 0,
) {
  const value = intent(itemIndex, attemptIndex);
  const createdAt = new Date('2026-07-28T02:00:00.000Z');
  return {
    item: {
      id: `batch-item-${itemIndex}`,
      batchId: 'batch-1',
      ownerUserId: 'owner-1',
      listingWorkflowId: 'workflow-1',
      draftRevision: 7,
      draftVersion: 11,
      itemIndex,
      skuKey: value.skuKey,
      slotKey: value.slotKey,
      assignmentOrdinal: itemIndex,
      status,
      boundAt: status === 'BOUND' ? createdAt : null,
      releasedAt: status === 'RELEASED' ? createdAt : null,
      createdAt,
      updatedAt: createdAt,
    } satisfies ExtensionByokExecutionBatchItemRecord,
    intent: {
      ...value,
      outcome,
      resultSha256: outcome === 'SUCCEEDED' ? '8'.repeat(64) : null,
      outcomeUpdatedAt: outcome === 'PENDING' ? null : createdAt,
    },
  };
}

interface BuildOptions {
  scopes?: string[];
  shops?: string[];
  actorUserId?: string;
}

async function build(options: BuildOptions = {}) {
  const getStatusByIdempotencyKey = vi.fn(async () => ({
    batch: batch(),
    items: [
      statusItem(0, 'ACTIVE', 'PENDING'),
      statusItem(1, 'ACTIVE', 'PENDING'),
    ],
  }));
  const getStatus = vi.fn(async () => ({
    batch: batch(),
    items: [
      statusItem(0, 'ACTIVE', 'PENDING'),
      statusItem(1, 'ACTIVE', 'PENDING'),
    ],
  }));
  const claim = vi.fn(async () => ({
    replayed: false,
    batch: batch(),
    intents: [intent(1), intent(0)],
  }));
  const claimSuccessor = vi.fn(async () => ({
    replayed: false,
    batch: batch(),
    intent: intent(1, 1),
  }));
  const cancel = vi.fn(async () => ({
    replayed: false,
    batch: batch({
      status: 'CANCELLED',
      cancelledAt: new Date('2026-07-28T02:01:00.000Z'),
    }),
  }));
  const app = Fastify();
  await app.register(extensionByokExecutionBatchRoutes, {
    prefix: '/byok-media',
    authenticateDevice: async (request) => {
      (request as FastifyRequest & { device?: unknown }).device = {
        ownerUserId: 'owner-1',
        actorUserId: options.actorUserId ?? 'owner-1',
        sessionId: 'session-1',
        scopes: options.scopes ?? ['byok:media:ingest'],
        allowedShopIds: options.shops ?? ['shop-1'],
      };
    },
    service: { getStatusByIdempotencyKey, getStatus, claim, claimSuccessor, cancel },
  });
  await app.ready();
  return { app, getStatusByIdempotencyKey, getStatus, claim, claimSuccessor, cancel };
}

describe('extension BYOK execution batch routes', () => {
  it('recovers a PREPARING batch by idempotency key through the same status/v1 projection', async () => {
    const { app, getStatusByIdempotencyKey } = await build();
    const response = await app.inject({
      method: 'GET',
      url: '/byok-media/execution-batches/by-idempotency/provider-batch-attempt-0001',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        contractVersion: 'extension-byok-execution-batch-status/v1',
        batchId: 'batch-1',
        status: 'OPEN',
        boundDraftRevision: null,
        boundDraftVersion: null,
        items: [
          { itemIndex: 0, status: 'ACTIVE', intent: { outcome: 'PENDING' } },
          { itemIndex: 1, status: 'ACTIVE', intent: { outcome: 'PENDING' } },
        ],
      },
    });
    expect(getStatusByIdempotencyKey).toHaveBeenCalledWith({
      identity: {
        ownerUserId: 'owner-1', actorUserId: 'owner-1', deviceSessionId: 'session-1',
      },
      idempotencyKey: 'provider-batch-attempt-0001',
    });
    for (const forbidden of ['provider.example', 'image-model-1', 'resultSha256', 'apiKey']) {
      expect(response.body).not.toContain(forbidden);
    }
    await app.close();
  });

  it.each([
    ['too-short', ['byok:media:ingest'], ['shop-1'], 'owner-1', 400,
      'byok_execution_batch_invalid_request'],
    ['sk-abcdefghijklmnop', ['byok:media:ingest'], ['shop-1'], 'owner-1', 400,
      'byok_execution_batch_invalid_request'],
    ['provider-batch-attempt-0001', [], ['shop-1'], 'owner-1', 403,
      'byok_execution_batch_scope_denied'],
    ['provider-batch-attempt-0001', ['byok:media:ingest'], ['shop-1'], 'actor-2', 401,
      'invalid_device_context'],
  ] as const)('rejects unsafe or unauthorized idempotency recovery', async (
    idempotencyKey,
    scopes,
    shops,
    actorUserId,
    statusCode,
    errorCode,
  ) => {
    const { app, getStatusByIdempotencyKey } = await build({
      scopes: [...scopes],
      shops: [...shops],
      actorUserId,
    });
    const response = await app.inject({
      method: 'GET',
      url: `/byok-media/execution-batches/by-idempotency/${idempotencyKey}`,
    });
    expect(response.statusCode).toBe(statusCode);
    expect(response.json()).toMatchObject({ code: 0, errorCode });
    expect(getStatusByIdempotencyKey).not.toHaveBeenCalled();
    await app.close();
  });

  it('maps missing and foreign-device idempotency recovery to the same public response', async () => {
    const missing = await build();
    missing.getStatusByIdempotencyKey.mockRejectedValueOnce(
      new ExtensionByokExecutionBatchError(
        'BYOK_EXECUTION_BATCH_NOT_FOUND', 404, 'private database detail',
      ),
    );
    const notFound = await missing.app.inject({
      method: 'GET',
      url: '/byok-media/execution-batches/by-idempotency/provider-batch-attempt-0001',
    });
    expect(notFound.statusCode).toBe(404);
    expect(notFound.json()).toMatchObject({
      code: 0, errorCode: 'byok_execution_batch_not_found',
    });
    expect(notFound.body).not.toContain('private database detail');
    await missing.app.close();

    const forbidden = await build();
    forbidden.getStatusByIdempotencyKey.mockRejectedValueOnce(
      new ExtensionByokExecutionBatchError(
        'BYOK_EXECUTION_BATCH_FORBIDDEN', 403, 'foreign device detail',
      ),
    );
    const denied = await forbidden.app.inject({
      method: 'GET',
      url: '/byok-media/execution-batches/by-idempotency/provider-batch-attempt-0001',
    });
    expect(denied.statusCode).toBe(404);
    expect(denied.json()).toMatchObject({
      code: 0, errorCode: 'byok_execution_batch_not_found',
    });
    expect(denied.body).not.toContain('foreign device detail');
    await forbidden.app.close();

    const revoked = await build({ shops: [] });
    const shopDenied = await revoked.app.inject({
      method: 'GET',
      url: '/byok-media/execution-batches/by-idempotency/provider-batch-attempt-0001',
    });
    expect(shopDenied.statusCode).toBe(403);
    expect(shopDenied.json()).toMatchObject({
      code: 0, errorCode: 'byok_execution_batch_shop_denied',
    });
    expect(shopDenied.body).not.toContain('workflow-1');
    await revoked.app.close();
  });

  it('recovers an open batch and all latest intent outcomes through status/v1', async () => {
    const { app, getStatus } = await build();
    getStatus.mockResolvedValueOnce({
      batch: batch({
        itemCount: 4,
      }),
      items: [
        statusItem(0, 'ACTIVE', 'PENDING'),
        statusItem(1, 'ACTIVE', 'SUCCEEDED', 1),
        statusItem(2, 'ACTIVE', 'FAILED_FINAL', 2),
        statusItem(3, 'ACTIVE', 'UNKNOWN_OUTCOME', 3),
      ],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/byok-media/execution-batches/batch-1',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({
      code: 1,
      data: {
        contractVersion: 'extension-byok-execution-batch-status/v1',
        batchId: 'batch-1',
        status: 'OPEN',
        context: {
          shopId: 'shop-1',
          workflowId: 'workflow-1',
          draftRevision: 7,
          draftVersion: 11,
          sourcePlatform: '1688',
          sourceProductId: 'source-1',
          sourceCaptureSnapshotId: 'snapshot-1',
          supplyGoodsId: 'goods-1',
        },
        boundDraftRevision: null,
        boundDraftVersion: null,
        items: [
          expect.objectContaining({
            batchItemId: 'batch-item-0', itemIndex: 0, status: 'ACTIVE',
            intent: expect.objectContaining({ attemptIndex: 0, outcome: 'PENDING' }),
          }),
          expect.objectContaining({
            batchItemId: 'batch-item-1', itemIndex: 1, status: 'ACTIVE',
            intent: expect.objectContaining({ attemptIndex: 1, outcome: 'SUCCEEDED' }),
          }),
          expect.objectContaining({
            batchItemId: 'batch-item-2', itemIndex: 2, status: 'ACTIVE',
            intent: expect.objectContaining({ attemptIndex: 2, outcome: 'FAILED_FINAL' }),
          }),
          expect.objectContaining({
            batchItemId: 'batch-item-3', itemIndex: 3, status: 'ACTIVE',
            intent: expect.objectContaining({ attemptIndex: 3, outcome: 'UNKNOWN_OUTCOME' }),
          }),
        ],
      },
    });
    expect(getStatus).toHaveBeenCalledWith({
      identity: {
        ownerUserId: 'owner-1', actorUserId: 'owner-1', deviceSessionId: 'session-1',
      },
      batchId: 'batch-1',
    });
    for (const forbidden of [
      'provider.example', 'providerOriginSha256', 'image-model-1', 'resultSha256',
      'https://', 'data:', 'bytes', 'apiKey',
    ]) {
      expect(response.body).not.toContain(forbidden);
    }
    await app.close();
  });

  it('returns canonical result proofs only through explicitly negotiated status/v2', async () => {
    const { app, getStatus } = await build();
    getStatus.mockResolvedValueOnce({
      batch: batch({ itemCount: 4 }),
      items: [
        statusItem(0, 'ACTIVE', 'PENDING'),
        statusItem(1, 'ACTIVE', 'SUCCEEDED', 1),
        statusItem(2, 'ACTIVE', 'FAILED_FINAL', 2),
        statusItem(3, 'ACTIVE', 'UNKNOWN_OUTCOME', 3),
      ],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/byok-media/execution-batches/batch-1'
        + '?contractVersion=extension-byok-execution-batch-status%2Fv2',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        contractVersion: 'extension-byok-execution-batch-status/v2',
        items: [
          { intent: { outcome: 'PENDING', resultSha256: null } },
          { intent: { outcome: 'SUCCEEDED', resultSha256: '8'.repeat(64) } },
          { intent: { outcome: 'FAILED_FINAL', resultSha256: null } },
          { intent: { outcome: 'UNKNOWN_OUTCOME', resultSha256: null } },
        ],
      },
    });
    const body = response.json();
    expect(Object.keys(body.data.items[1].intent).sort()).toEqual([
      'attemptIndex',
      'contractVersion',
      'intentId',
      'outcome',
      'providerIdempotencyKey',
      'providerRequestHash',
      'resultSha256',
    ]);
    for (const forbidden of [
      'provider.example', 'providerOriginSha256', 'image-model-1',
      'https://', 'data:', 'bytes', 'prompt', 'apiKey', 'errorCode',
    ]) {
      expect(response.body).not.toContain(forbidden);
    }
    await app.close();
  });

  it('requires the same authenticated owner device for status/v2', async () => {
    const { app, getStatus } = await build({ actorUserId: 'actor-2' });
    const response = await app.inject({
      method: 'GET',
      url: '/byok-media/execution-batches/batch-1'
        + '?contractVersion=extension-byok-execution-batch-status%2Fv2',
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      code: 0, errorCode: 'invalid_device_context',
    });
    expect(getStatus).not.toHaveBeenCalled();
    await app.close();
  });

  it('negotiates status/v2 for idempotency recovery without weakening device authority', async () => {
    const { app, getStatusByIdempotencyKey } = await build();
    getStatusByIdempotencyKey.mockResolvedValueOnce({
      batch: batch(),
      items: [
        statusItem(0, 'ACTIVE', 'SUCCEEDED'),
        statusItem(1, 'ACTIVE', 'FAILED_FINAL'),
      ],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/byok-media/execution-batches/by-idempotency/provider-batch-attempt-0001'
        + '?contractVersion=extension-byok-execution-batch-status%2Fv2',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        contractVersion: 'extension-byok-execution-batch-status/v2',
        items: [
          { intent: { outcome: 'SUCCEEDED', resultSha256: '8'.repeat(64) } },
          { intent: { outcome: 'FAILED_FINAL', resultSha256: null } },
        ],
      },
    });
    await app.close();
  });

  it('keeps explicit status/v1 identical to the default projection', async () => {
    const { app } = await build();
    const implicit = await app.inject({
      method: 'GET', url: '/byok-media/execution-batches/batch-1',
    });
    const explicit = await app.inject({
      method: 'GET',
      url: '/byok-media/execution-batches/batch-1'
        + '?contractVersion=extension-byok-execution-batch-status%2Fv1',
    });

    expect(explicit.statusCode).toBe(200);
    expect(explicit.body).toBe(implicit.body);
    expect(explicit.body).not.toContain('resultSha256');
    await app.close();
  });

  it.each([
    ['missing success proof', { outcome: 'SUCCEEDED', resultSha256: null }],
    ['uppercase success proof', { outcome: 'SUCCEEDED', resultSha256: 'A'.repeat(64) }],
    ['proof on failed intent', { outcome: 'FAILED_FINAL', resultSha256: '8'.repeat(64) }],
  ] as const)('fails closed when status/v2 receives %s', async (_label, overrides) => {
    const { app, getStatus } = await build();
    const malformed = statusItem(0, 'ACTIVE', 'PENDING');
    malformed.intent = { ...malformed.intent, ...overrides };
    getStatus.mockResolvedValueOnce({
      batch: batch({ itemCount: 1 }),
      items: [malformed],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/byok-media/execution-batches/batch-1'
        + '?contractVersion=extension-byok-execution-batch-status%2Fv2',
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      code: 0, errorCode: 'byok_execution_batch_unavailable',
    });
    expect(response.body).not.toContain(String(overrides.resultSha256));
    await app.close();
  });

  it('rejects unsupported status contract negotiation before service access', async () => {
    const { app, getStatus } = await build();
    const response = await app.inject({
      method: 'GET',
      url: '/byok-media/execution-batches/batch-1'
        + '?contractVersion=extension-byok-execution-batch-status%2Fv3',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: 0, errorCode: 'byok_execution_batch_invalid_request',
    });
    expect(getStatus).not.toHaveBeenCalled();
    await app.close();
  });

  it.each([
    {
      batchStatus: 'BOUND' as const,
      itemStatus: 'BOUND' as const,
      boundDraftRevision: 8,
      boundDraftVersion: 12,
      boundAt: new Date('2026-07-28T02:01:00.000Z'),
      cancelledAt: null,
      outcomes: ['SUCCEEDED', 'SUCCEEDED'] as const,
    },
    {
      batchStatus: 'CANCELLED' as const,
      itemStatus: 'RELEASED' as const,
      boundDraftRevision: null,
      boundDraftVersion: null,
      boundAt: null,
      cancelledAt: new Date('2026-07-28T02:01:00.000Z'),
      outcomes: ['SUCCEEDED', 'FAILED_FINAL'] as const,
    },
  ])('recovers a $batchStatus batch with its exact lifecycle state', async (value) => {
    const { app, getStatus } = await build();
    getStatus.mockResolvedValueOnce({
      batch: batch({
        status: value.batchStatus,
        boundDraftRevision: value.boundDraftRevision,
        boundDraftVersion: value.boundDraftVersion,
        boundAt: value.boundAt,
        cancelledAt: value.cancelledAt,
      }),
      items: value.outcomes.map((outcome, index) => (
        statusItem(index, value.itemStatus, outcome)
      )),
    });

    const response = await app.inject({
      method: 'GET', url: '/byok-media/execution-batches/batch-1',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        contractVersion: 'extension-byok-execution-batch-status/v1',
        status: value.batchStatus,
        boundDraftRevision: value.boundDraftRevision,
        boundDraftVersion: value.boundDraftVersion,
        items: [
          { status: value.itemStatus, intent: { outcome: value.outcomes[0] } },
          { status: value.itemStatus, intent: { outcome: value.outcomes[1] } },
        ],
      },
    });
    await app.close();
  });

  it('rejects cross-device recovery and maps a missing batch without leaking details', async () => {
    const foreign = await build({ actorUserId: 'actor-2' });
    const denied = await foreign.app.inject({
      method: 'GET', url: '/byok-media/execution-batches/batch-1',
    });
    expect(denied.statusCode).toBe(401);
    expect(denied.json()).toMatchObject({ code: 0, errorCode: 'invalid_device_context' });
    expect(foreign.getStatus).not.toHaveBeenCalled();
    await foreign.app.close();

    const missing = await build();
    missing.getStatus.mockRejectedValueOnce(new ExtensionByokExecutionBatchError(
      'BYOK_EXECUTION_BATCH_NOT_FOUND',
      404,
      'private database detail',
    ));
    const notFound = await missing.app.inject({
      method: 'GET', url: '/byok-media/execution-batches/missing-batch',
    });
    expect(notFound.statusCode).toBe(404);
    expect(notFound.json()).toMatchObject({
      code: 0, errorCode: 'byok_execution_batch_not_found',
    });
    expect(notFound.body).not.toContain('private database detail');
    await missing.app.close();
  });

  it('returns all reserved items in stable order without Provider endpoint data', async () => {
    const { app, claim } = await build();
    const response = await app.inject({
      method: 'POST',
      url: '/byok-media/execution-batches',
      payload: createPayload(),
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers.pragma).toBe('no-cache');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.json()).toEqual({
      code: 1,
      data: {
        contractVersion: 'extension-byok-execution-batch/v1',
        batchId: 'batch-1',
        status: 'OPEN',
        replayed: false,
        context: {
          shopId: 'shop-1',
          workflowId: 'workflow-1',
          draftRevision: 7,
          draftVersion: 11,
        },
        items: [
          {
            batchItemId: 'batch-item-0',
            itemIndex: 0,
            skuKey: 'sku-1',
            slotKey: 'sku:sku-1:hero',
            assignmentOrdinal: 0,
            intent: {
              contractVersion: 'extension-byok-execution-intent/v1',
              intentId: 'intent-0-0',
              attemptIndex: 0,
              outcome: 'PENDING',
              providerIdempotencyKey: 'provider-attempt-0001',
              providerRequestHash: HASHES[0],
            },
          },
          {
            batchItemId: 'batch-item-1',
            itemIndex: 1,
            skuKey: 'sku-2',
            slotKey: 'sku:sku-2:hero',
            assignmentOrdinal: 1,
            intent: {
              contractVersion: 'extension-byok-execution-intent/v1',
              intentId: 'intent-1-0',
              attemptIndex: 0,
              outcome: 'PENDING',
              providerIdempotencyKey: 'provider-attempt-0002',
              providerRequestHash: HASHES[1],
            },
          },
        ],
      },
    });
    expect(response.body).not.toContain('provider.example');
    expect(response.body).not.toContain('providerOriginSha256');
    expect(claim).toHaveBeenCalledWith(expect.objectContaining({
      identity: {
        ownerUserId: 'owner-1',
        actorUserId: 'owner-1',
        deviceSessionId: 'session-1',
      },
    }));
    await app.close();
  });

  it('returns one exact successor item only after explicit Provider charge confirmation', async () => {
    const { app, claimSuccessor } = await build();
    const successor = requestItem(1);
    successor.providerIdempotencyKey = 'provider-successor-0002';
    successor.providerRequestHash = HASHES[3]!;
    const response = await app.inject({
      method: 'POST',
      url: '/byok-media/execution-batches/batch-1/items/1/attempts',
      payload: {
        contractVersion: 'extension-byok-execution-batch-attempt-request/v1',
        currentIntentId: 'intent-1-0',
        providerChargeConfirmed: true,
        item: successor,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      code: 1,
      data: {
        contractVersion: 'extension-byok-execution-batch-attempt/v1',
        batchId: 'batch-1',
        status: 'OPEN',
        replayed: false,
        context: {
          shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 7, draftVersion: 11,
        },
        item: {
          batchItemId: 'batch-item-1',
          itemIndex: 1,
          skuKey: 'sku-2',
          slotKey: 'sku:sku-2:hero',
          assignmentOrdinal: 1,
          intent: {
            contractVersion: 'extension-byok-execution-intent/v1',
            intentId: 'intent-1-1',
            attemptIndex: 1,
            outcome: 'PENDING',
            providerIdempotencyKey: 'provider-successor-0002',
            providerRequestHash: HASHES[3],
          },
        },
      },
    });
    expect(claimSuccessor).toHaveBeenCalledWith(expect.objectContaining({
      batchId: 'batch-1',
      itemIndex: 1,
      currentIntentId: 'intent-1-0',
      providerChargeConfirmed: true,
    }));
    await app.close();
  });

  it('returns only the stable cancelled batch receipt', async () => {
    const { app, cancel } = await build();
    const response = await app.inject({
      method: 'POST',
      url: '/byok-media/execution-batches/batch-1/cancel',
      payload: { contractVersion: 'extension-byok-execution-batch-cancel-request/v1' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      code: 1,
      data: {
        contractVersion: 'extension-byok-execution-batch-cancel/v1',
        batchId: 'batch-1',
        status: 'CANCELLED',
        replayed: false,
      },
    });
    expect(cancel).toHaveBeenCalledWith({
      identity: {
        ownerUserId: 'owner-1', actorUserId: 'owner-1', deviceSessionId: 'session-1',
      },
      batchId: 'batch-1',
    });
    await app.close();
  });

  it('uses 200 and preserves replay markers for create and successor recovery', async () => {
    const { app, claim, claimSuccessor } = await build();
    claim.mockResolvedValueOnce({
      replayed: true,
      batch: batch(),
      intents: [intent(0), intent(1)],
    });
    const createResponse = await app.inject({
      method: 'POST', url: '/byok-media/execution-batches', payload: createPayload(),
    });
    expect(createResponse.statusCode).toBe(200);
    expect(createResponse.json()).toMatchObject({ code: 1, data: { replayed: true } });

    claimSuccessor.mockResolvedValueOnce({
      replayed: true,
      batch: batch(),
      intent: intent(1, 1),
    });
    const successor = requestItem(1);
    successor.providerIdempotencyKey = 'provider-successor-0002';
    successor.providerRequestHash = HASHES[3]!;
    const attemptResponse = await app.inject({
      method: 'POST',
      url: '/byok-media/execution-batches/batch-1/items/1/attempts',
      payload: {
        contractVersion: 'extension-byok-execution-batch-attempt-request/v1',
        currentIntentId: 'intent-1-0',
        providerChargeConfirmed: true,
        item: successor,
      },
    });
    expect(attemptResponse.statusCode).toBe(200);
    expect(attemptResponse.json()).toMatchObject({ code: 1, data: { replayed: true } });
    await app.close();
  });

  it.each([
    [[], ['shop-1'], 'owner-1', 'byok_execution_batch_scope_denied'],
    [['byok:media:ingest'], [], 'owner-1', 'byok_execution_batch_shop_denied'],
    [['byok:media:ingest'], ['shop-1'], 'actor-2', 'invalid_device_context'],
  ] as const)(
    'rejects missing owner-device authority before batch reservation',
    async (scopes, shops, actorUserId, errorCode) => {
      const { app, claim } = await build({
        scopes: [...scopes], shops: [...shops], actorUserId,
      });
      const response = await app.inject({
        method: 'POST', url: '/byok-media/execution-batches', payload: createPayload(),
      });
      expect(response.statusCode).toBe(actorUserId === 'owner-1' ? 403 : 401);
      expect(response.json()).toMatchObject({ code: 0, errorCode });
      expect(claim).not.toHaveBeenCalled();
      await app.close();
    },
  );

  it('rejects unknown fields and unconfirmed retries before calling the service', async () => {
    const { app, claim, claimSuccessor } = await build();
    const invalidCreate = await app.inject({
      method: 'POST',
      url: '/byok-media/execution-batches',
      payload: { ...createPayload(), unexpected: true },
    });
    expect(invalidCreate.statusCode).toBe(400);
    expect(claim).not.toHaveBeenCalled();

    const invalidAttempt = await app.inject({
      method: 'POST',
      url: '/byok-media/execution-batches/batch-1/items/1/attempts',
      payload: {
        contractVersion: 'extension-byok-execution-batch-attempt-request/v1',
        currentIntentId: 'intent-1-0',
        providerChargeConfirmed: false,
        item: requestItem(1),
      },
    });
    expect(invalidAttempt.statusCode).toBe(400);
    expect(claimSuccessor).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects a batch binding owned by another user before calling the service', async () => {
    const { app, claim } = await build();
    const payload = createPayload();
    payload.items[0]!.binding.ownerUserId = 'owner-2';
    const response = await app.inject({
      method: 'POST', url: '/byok-media/execution-batches', payload,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      code: 0, errorCode: 'byok_execution_batch_forbidden',
    });
    expect(claim).not.toHaveBeenCalled();
    await app.close();
  });

  it.each([
    ['BYOK_EXECUTION_BATCH_INVALID_REQUEST', 400],
    ['BYOK_EXECUTION_BATCH_FORBIDDEN', 403],
    ['BYOK_EXECUTION_BATCH_CONTEXT_STALE', 409],
    ['BYOK_EXECUTION_BATCH_POLICY_UNAVAILABLE', 503],
    ['BYOK_EXECUTION_BATCH_POLICY_DISABLED', 409],
    ['BYOK_EXECUTION_BATCH_MODE_CONFLICT', 409],
    ['BYOK_EXECUTION_BATCH_IDEMPOTENCY_CONFLICT', 409],
    ['BYOK_EXECUTION_BATCH_RESERVATION_CONFLICT', 409],
    ['BYOK_EXECUTION_BATCH_NOT_FOUND', 404],
    ['BYOK_EXECUTION_BATCH_STATE_CONFLICT', 409],
    ['BYOK_EXECUTION_BATCH_ATTEMPT_BLOCKED', 409],
    ['BYOK_EXECUTION_BATCH_CAPACITY_EXCEEDED', 409],
    ['BYOK_EXECUTION_BATCH_UNAVAILABLE', 503],
  ] as const)('maps %s to a stable public response', async (code, statusCode) => {
    const { app, claim } = await build();
    claim.mockRejectedValueOnce(new ExtensionByokExecutionBatchError(
      code as ExtensionByokExecutionBatchErrorCode,
      statusCode,
      'private repository detail',
    ));
    const response = await app.inject({
      method: 'POST', url: '/byok-media/execution-batches', payload: createPayload(),
    });
    expect(response.statusCode).toBe(statusCode);
    expect(response.json()).toMatchObject({
      code: 0,
      errorCode: code.toLowerCase(),
    });
    expect(response.body).not.toContain('private repository detail');
    expect(response.headers['cache-control']).toBe('no-store');
    await app.close();
  });

  it('fails closed when a service result cannot form a bounded public projection', async () => {
    const { app, claim } = await build();
    claim.mockResolvedValueOnce({
      replayed: false,
      batch: batch(),
      intents: [{ ...intent(0), executionBatchItemId: null }],
    });
    const response = await app.inject({
      method: 'POST', url: '/byok-media/execution-batches', payload: createPayload(),
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      code: 0, errorCode: 'byok_execution_batch_unavailable',
    });
    expect(response.body).not.toContain('provider.example');
    await app.close();
  });
});
