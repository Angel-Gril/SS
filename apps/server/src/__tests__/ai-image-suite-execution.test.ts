import { describe, expect, it, vi } from 'vitest';
import {
  AiImageSuiteExecutionError,
  createAiImageSuiteCancelRequestFingerprint,
  createAiImageSuiteDispatchRequestFingerprint,
  createAiImageSuiteExecutionEventKey,
  createAiImageSuiteExecutionService,
  createAiImageSuiteRetryRequestFingerprint,
  type AiImageSuiteExecutionRepository,
  type AiImageSuiteExecutionSummary,
  type CancelAiImageSuiteInput,
  type DispatchAiImageSuiteInput,
  type RetryAiImageSuiteSlotInput,
} from '../services/ai-image-suite-execution.js';
import {
  PrismaAiImageSuiteExecutionRepository,
  createAiImageSuiteOutputAssetData,
} from '../repositories/ai-image-suite-execution-repository.js';

const dispatchInput: DispatchAiImageSuiteInput = {
  suiteId: 'suite-1',
  ownerUserId: 'owner-1',
  actorUserId: 'actor-1',
  expectedRevision: 4,
  operationKey: 'dispatch-operation-1',
};

const cancelInput: CancelAiImageSuiteInput = {
  suiteId: 'suite-1',
  ownerUserId: 'owner-1',
  actorUserId: 'actor-1',
  expectedRevision: 5,
  operationKey: 'cancel-operation-1',
};

const retryInput: RetryAiImageSuiteSlotInput = {
  suiteId: 'suite-1',
  slotId: 'slot-2',
  ownerUserId: 'owner-1',
  actorUserId: 'actor-1',
  expectedSlotRevision: 5,
  operationKey: 'retry-operation-1',
};

function summary(overrides: Partial<AiImageSuiteExecutionSummary> = {}): AiImageSuiteExecutionSummary {
  return {
    suiteId: 'suite-1',
    revision: 5,
    status: 'QUEUED',
    itemCount: 2,
    concurrencyLimit: 1,
    counts: {
      planned: 0,
      queued: 2,
      running: 0,
      succeeded: 0,
      failed: 0,
      cancelRequested: 0,
      cancelled: 0,
    },
    slots: [
      {
        slotId: 'slot-1',
        ordinal: 0,
        slotKey: 'sku:sku-1:hero',
        status: 'QUEUED',
        attempt: 1,
        revision: 3,
        childWorkflowId: 'workflow-1',
        error: null,
      },
      {
        slotId: 'slot-2',
        ordinal: 1,
        slotKey: 'group:group-1:gallery:1',
        status: 'QUEUED',
        attempt: 1,
        revision: 3,
        childWorkflowId: 'workflow-2',
        error: null,
      },
    ],
    ...overrides,
  };
}

function repository(
  overrides: Partial<AiImageSuiteExecutionRepository> = {},
): AiImageSuiteExecutionRepository {
  return {
    findDispatchReplay: vi.fn(async () => null),
    dispatch: vi.fn(async () => ({ kind: 'committed' as const, ...summary() })),
    findCancelReplay: vi.fn(async () => null),
    cancel: vi.fn(async () => ({
      kind: 'committed' as const,
      ...summary({ revision: 6, status: 'CANCEL_REQUESTED' }),
    })),
    findRetryReplay: vi.fn(async () => null),
    retryFailedSlot: vi.fn(async () => ({
      kind: 'committed' as const,
      ...summary({ revision: 8, status: 'QUEUED' }),
    })),
    ...overrides,
  };
}

describe('AI image suite execution service', () => {
  it('binds generated suite outputs to the frozen source-capture snapshot', () => {
    expect(createAiImageSuiteOutputAssetData({
      ownerUserId: 'owner-1',
      jobId: 'job-1',
      sourceCaptureSnapshotId: 'snapshot-1',
      suiteId: 'suite-1',
      slotId: 'slot-1',
      attempt: 2,
      asset: {
        url: 'https://erp.example/generated.png',
        storageBackend: 'oss',
        storageKey: 'generated.png',
        mimeType: 'image/png',
        sizeBytes: 123,
        sha256: 'a'.repeat(64),
      },
    })).toMatchObject({
      ownerUserId: 'owner-1',
      aiImageJobId: 'job-1',
      sourceCaptureSnapshotId: 'snapshot-1',
      kind: 'AI_GENERATED',
      metadata: {
        suiteId: 'suite-1',
        slotId: 'slot-1',
        attempt: 2,
      },
    });
  });

  it.each([
    ['suiteId', { suiteId: '' }],
    ['ownerUserId', { ownerUserId: ' owner-1' }],
    ['actorUserId', { actorUserId: 'actor-1 ' }],
    ['operationKey minimum', { operationKey: 'short' }],
    ['operationKey maximum', { operationKey: 'x'.repeat(129) }],
    ['expectedRevision value', { expectedRevision: 5 }],
    ['expectedRevision integer', { expectedRevision: 4.5 }],
  ] as const)('rejects invalid dispatch %s before persistence', async (_label, overrides) => {
    const repo = repository();
    const service = createAiImageSuiteExecutionService(repo);

    await expect(service.dispatch({ ...dispatchInput, ...overrides })).rejects.toMatchObject({
      code: 'AI_MEDIA_SUITE_EXECUTION_INVALID_INPUT',
      statusCode: 400,
    });
    expect(repo.findDispatchReplay).not.toHaveBeenCalled();
    expect(repo.dispatch).not.toHaveBeenCalled();
  });

  it.each([
    ['suiteId', { suiteId: '' }],
    ['ownerUserId', { ownerUserId: 'owner-1 ' }],
    ['actorUserId', { actorUserId: ' actor-1' }],
    ['operationKey', { operationKey: 'short' }],
    ['expectedRevision lower bound', { expectedRevision: 3 }],
    ['expectedRevision integer', { expectedRevision: 5.5 }],
  ] as const)('rejects invalid cancel %s before persistence', async (_label, overrides) => {
    const repo = repository();
    const service = createAiImageSuiteExecutionService(repo);

    await expect(service.cancel({ ...cancelInput, ...overrides })).rejects.toMatchObject({
      code: 'AI_MEDIA_SUITE_EXECUTION_INVALID_INPUT',
      statusCode: 400,
    });
    expect(repo.findCancelReplay).not.toHaveBeenCalled();
    expect(repo.cancel).not.toHaveBeenCalled();
  });

  it.each([
    ['suiteId', { suiteId: '' }],
    ['slotId', { slotId: ' slot-2' }],
    ['ownerUserId', { ownerUserId: '' }],
    ['actorUserId', { actorUserId: 'actor-1 ' }],
    ['operationKey', { operationKey: 'short' }],
    ['expectedSlotRevision lower bound', { expectedSlotRevision: 1 }],
    ['expectedSlotRevision integer', { expectedSlotRevision: 5.5 }],
  ] as const)('rejects invalid retry %s before persistence', async (_label, overrides) => {
    const repo = repository();
    const service = createAiImageSuiteExecutionService(repo);

    await expect(service.retryFailedSlot({ ...retryInput, ...overrides })).rejects.toMatchObject({
      code: 'AI_MEDIA_SUITE_EXECUTION_INVALID_INPUT',
      statusCode: 400,
    });
    expect(repo.findRetryReplay).not.toHaveBeenCalled();
    expect(repo.retryFailedSlot).not.toHaveBeenCalled();
  });

  it('creates command-specific fingerprints and one owner-scoped operation event key', () => {
    const dispatchFingerprint = createAiImageSuiteDispatchRequestFingerprint(dispatchInput);
    const cancelFingerprint = createAiImageSuiteCancelRequestFingerprint({
      ...cancelInput,
      operationKey: dispatchInput.operationKey,
    });
    const retryFingerprint = createAiImageSuiteRetryRequestFingerprint({
      ...retryInput,
      operationKey: dispatchInput.operationKey,
    });

    expect(dispatchFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(new Set([dispatchFingerprint, cancelFingerprint, retryFingerprint]).size).toBe(3);
    expect(createAiImageSuiteExecutionEventKey(dispatchInput)).toMatch(/^suite-execution:[a-f0-9]{64}$/u);
    expect(createAiImageSuiteExecutionEventKey(dispatchInput)).toBe(
      createAiImageSuiteExecutionEventKey({
        ownerUserId: dispatchInput.ownerUserId,
        operationKey: dispatchInput.operationKey,
      }),
    );
  });

  it.each([
    ['dispatch', 'findDispatchReplay', 'dispatch', dispatchInput],
    ['cancel', 'findCancelReplay', 'cancel', cancelInput],
    ['retryFailedSlot', 'findRetryReplay', 'retryFailedSlot', retryInput],
  ] as const)('returns an exact %s replay before mutable state checks', async (
    method,
    replayMethod,
    commitMethod,
    input,
  ) => {
    const replay = summary({ revision: 11, status: 'PARTIAL_FAILURE' });
    const repo = repository({
      [replayMethod]: vi.fn(async () => ({ kind: 'existing' as const, ...replay })),
      [commitMethod]: vi.fn(async () => {
        throw new Error('commit must not run for exact replay');
      }),
    });
    const service = createAiImageSuiteExecutionService(repo);

    await expect(service[method](input as never)).resolves.toEqual({ ...replay, replayed: true });
    expect(repo[replayMethod]).toHaveBeenCalledWith(input);
    expect(repo[commitMethod]).not.toHaveBeenCalled();
  });

  it.each([
    ['dispatch', 'findDispatchReplay', 'dispatch', dispatchInput],
    ['cancel', 'findCancelReplay', 'cancel', cancelInput],
    ['retryFailedSlot', 'findRetryReplay', 'retryFailedSlot', retryInput],
  ] as const)('rejects a reused %s operation key with changed authority', async (
    method,
    replayMethod,
    commitMethod,
    input,
  ) => {
    const repo = repository({ [replayMethod]: vi.fn(async () => ({ kind: 'conflict' as const })) });
    const service = createAiImageSuiteExecutionService(repo);

    await expect(service[method](input as never)).rejects.toMatchObject({
      code: 'AI_MEDIA_SUITE_EXECUTION_IDEMPOTENCY_CONFLICT',
      statusCode: 409,
    });
    expect(repo[commitMethod]).not.toHaveBeenCalled();
  });

  it.each([
    ['dispatch', 'dispatch', dispatchInput, summary({ revision: 5 })],
    ['cancel', 'cancel', cancelInput, summary({ revision: 6, status: 'CANCEL_REQUESTED' })],
    ['retryFailedSlot', 'retryFailedSlot', retryInput, summary({ revision: 8, status: 'QUEUED' })],
  ] as const)('returns first %s commit and a race replay without leaking mutable internals', async (
    method,
    commitMethod,
    input,
    committed,
  ) => {
    const repo = repository({
      [commitMethod]: vi.fn()
        .mockResolvedValueOnce({ kind: 'committed' as const, ...committed })
        .mockResolvedValueOnce({ kind: 'existing' as const, ...committed }),
    });
    const service = createAiImageSuiteExecutionService(repo);

    await expect(service[method](input as never)).resolves.toEqual({ ...committed, replayed: false });
    await expect(service[method](input as never)).resolves.toEqual({ ...committed, replayed: true });
  });

  it('projects repository state into the safe DTO on commits and exact replays', async () => {
    const safe = summary();
    const internal = {
      ...safe,
      providerJobId: 'provider-job-secret',
      resolvedPrompt: 'frozen Prompt secret',
      outputUrl: 'https://storage.example/secret.png',
      slots: safe.slots.map((slot) => ({
        ...slot,
        providerJobId: 'provider-slot-secret',
        assetHash: 'a'.repeat(64),
      })),
    };
    const commitRepo = repository({
      dispatch: vi.fn(async () => ({ kind: 'committed' as const, ...internal })),
    });
    const replayRepo = repository({
      findDispatchReplay: vi.fn(async () => ({ kind: 'existing' as const, ...internal })),
    });

    await expect(createAiImageSuiteExecutionService(commitRepo).dispatch(dispatchInput))
      .resolves.toEqual({ ...safe, replayed: false });
    await expect(createAiImageSuiteExecutionService(replayRepo).dispatch(dispatchInput))
      .resolves.toEqual({ ...safe, replayed: true });
  });

  it.each([
    ['not-found', 'AI_MEDIA_SUITE_EXECUTION_NOT_FOUND', 404],
    ['not-materialized', 'AI_MEDIA_SUITE_EXECUTION_NOT_MATERIALIZED', 409],
    ['provider-not-ready', 'AI_MEDIA_SUITE_EXECUTION_PROVIDER_NOT_READY', 503],
    ['cost-reservation-invalid', 'AI_MEDIA_SUITE_COST_RESERVATION_INVALID', 503],
    ['already-dispatched', 'AI_MEDIA_SUITE_ALREADY_DISPATCHED', 409],
    ['revision-conflict', 'AI_MEDIA_SUITE_DISPATCH_CONFLICT', 409],
    ['conflict', 'AI_MEDIA_SUITE_DISPATCH_CONFLICT', 409],
  ] as const)('maps dispatch result %s to a typed error', async (kind, code, statusCode) => {
    const repo = repository({ dispatch: vi.fn(async () => ({ kind }) as never) });
    const service = createAiImageSuiteExecutionService(repo);

    const failure = await service.dispatch(dispatchInput).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AiImageSuiteExecutionError);
    expect(failure).toMatchObject({ code, statusCode });
  });

  it.each([
    ['not-found', 'AI_MEDIA_SUITE_EXECUTION_NOT_FOUND', 404],
    ['not-materialized', 'AI_MEDIA_SUITE_EXECUTION_NOT_MATERIALIZED', 409],
    ['not-cancellable', 'AI_MEDIA_SUITE_NOT_CANCELLABLE', 409],
    ['revision-conflict', 'AI_MEDIA_SUITE_CANCEL_CONFLICT', 409],
    ['conflict', 'AI_MEDIA_SUITE_CANCEL_CONFLICT', 409],
  ] as const)('maps cancel result %s to a typed error', async (kind, code, statusCode) => {
    const repo = repository({ cancel: vi.fn(async () => ({ kind }) as never) });
    const service = createAiImageSuiteExecutionService(repo);

    const failure = await service.cancel(cancelInput).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AiImageSuiteExecutionError);
    expect(failure).toMatchObject({ code, statusCode });
  });

  it.each([
    ['not-found', 'AI_MEDIA_SUITE_EXECUTION_NOT_FOUND', 404],
    ['not-materialized', 'AI_MEDIA_SUITE_EXECUTION_NOT_MATERIALIZED', 409],
    ['slot-not-found', 'AI_MEDIA_SUITE_SLOT_NOT_FOUND', 404],
    ['slot-not-failed', 'AI_MEDIA_SUITE_SLOT_NOT_FAILED', 409],
    ['retry-not-allowed', 'AI_MEDIA_SUITE_SLOT_RETRY_NOT_ALLOWED', 409],
    ['active-suite-conflict', 'AI_MEDIA_SUITE_PLAN_ACTIVE_CONFLICT', 409],
    ['slot-revision-conflict', 'AI_MEDIA_SUITE_SLOT_RETRY_CONFLICT', 409],
    ['conflict', 'AI_MEDIA_SUITE_SLOT_RETRY_CONFLICT', 409],
  ] as const)('maps retry result %s to a typed error', async (kind, code, statusCode) => {
    const repo = repository({ retryFailedSlot: vi.fn(async () => ({ kind }) as never) });
    const service = createAiImageSuiteExecutionService(repo);

    const failure = await service.retryFailedSlot(retryInput).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AiImageSuiteExecutionError);
    expect(failure).toMatchObject({ code, statusCode });
  });

  it.each([
    [
      { kind: 'quota-exceeded', used: 5, requested: 1, limit: 5 } as const,
      'AI_MEDIA_SUITE_DAILY_QUOTA_EXCEEDED',
      429,
    ],
    [
      {
        kind: 'budget-exceeded',
        settledCostCents: 10,
        pendingMaximumCostCents: 20,
        requestedMaximumCostCents: 11,
        limit: 40,
      } as const,
      'AI_MEDIA_SUITE_GLOBAL_BUDGET_EXCEEDED',
      429,
    ],
    [
      { kind: 'cost-controls-unavailable', reason: 'cost controls unavailable' } as const,
      'AI_MEDIA_SUITE_COST_CONTROLS_UNAVAILABLE',
      503,
    ],
  ])('maps retry paid cost-control failure %# to a typed error', async (result, code, statusCode) => {
    const service = createAiImageSuiteExecutionService(repository({
      retryFailedSlot: vi.fn(async () => result),
    }));

    await expect(service.retryFailedSlot(retryInput)).rejects.toMatchObject({ code, statusCode });
  });

  it('classifies a retry partial-index collision after confirming another plan version is active', async () => {
    const prisma = {
      $transaction: vi.fn(async () => {
        throw Object.assign(new Error('unique constraint'), { code: 'P2002' });
      }),
      aiMediaSuiteEvent: {
        findUnique: vi.fn(async () => null),
      },
      aiMediaSuite: {
        findFirst: vi.fn()
          .mockResolvedValueOnce({ planId: 'plan-1', planVersionId: 'version-1' })
          .mockResolvedValueOnce({ id: 'suite-new-version' }),
      },
    };
    const repo = new PrismaAiImageSuiteExecutionRepository(prisma as never);

    await expect(repo.retryFailedSlot(retryInput)).resolves.toEqual({
      kind: 'active-suite-conflict',
    });
    expect(prisma.aiMediaSuite.findFirst).toHaveBeenNthCalledWith(2, {
      where: {
        ownerUserId: 'owner-1',
        planId: 'plan-1',
        id: { not: 'suite-1' },
        planVersionId: { not: 'version-1' },
        OR: [
          { status: { in: ['QUEUED', 'RUNNING', 'CANCEL_REQUESTED'] } },
          { status: 'PLANNED', revision: { gte: 4 } },
        ],
      },
      select: { id: true },
    });
  });
});
