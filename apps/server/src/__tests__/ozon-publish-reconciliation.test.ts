import { describe, expect, it, vi } from 'vitest';
import type {
  OzonPublishAttemptRecord,
  OzonPublishAttemptRepository,
  OzonPublishReconciliationLeaseClaim,
} from '../services/ozon-publish-attempts.js';
import { OzonPublishAttemptError } from '../services/ozon-publish-attempts.js';
import {
  DEFAULT_OZON_PUBLISH_RECONCILIATION_SETTINGS,
  runOzonPublishReconciliationTick,
  type OzonPublishReconciliationLogger,
} from '../services/ozon-publish-reconciliation.js';
import {
  runOzonPublishReconciliationWorkerTick,
  startOzonPublishReconciliationWorker,
} from '../workers/ozon-publish-reconciliation.js';

const HASH = 'a'.repeat(64);
const NOW = new Date('2026-07-15T08:00:00.000Z');

function attempt(overrides: Partial<OzonPublishAttemptRecord> = {}): OzonPublishAttemptRecord {
  return {
    id: 'attempt-1',
    publishIntentId: 'intent-1',
    workflowId: 'workflow-1',
    ownerUserId: 'user-1',
    shopId: 'shop-1',
    draftVersion: 3,
    revision: 7,
    sourceCaptureSnapshotId: 'snapshot-1',
    actorUserId: 'user-1',
    idempotencyKey: 'publish-key-1',
    catalogSnapshotId: 'catalog-1',
    catalogRevision: 'catalog-r1',
    catalogSnapshot: {},
    catalogSnapshotHash: HASH,
    attributeSchemaSnapshot: {},
    attributeSchemaHash: HASH,
    publisherContractVersion: 'ozon-v3/v1',
    endpoint: '/v3/product/import',
    draftPayloadHash: HASH,
    draftStateHash: HASH,
    requestPayload: { items: [{ offer_id: 'offer-a' }, { offer_id: 'offer-b' }] },
    requestPayloadHash: HASH,
    offerTrace: [
      { ordinal: 0, offerId: 'offer-a', skuKey: 'sku-a' },
      { ordinal: 1, offerId: 'offer-b', skuKey: 'sku-b' },
    ],
    itemCount: 2,
    state: 'SUBMITTED',
    reconciliationState: 'RUNNING',
    stateVersion: 4,
    ozonTaskId: '123',
    acceptanceSource: 'ozon-response',
    response: { result: { task_id: 123 } },
    responseHash: HASH,
    itemResults: null,
    itemErrors: [],
    lastErrorCode: null,
    lastErrorMessage: null,
    leasePurpose: 'RECONCILE',
    leaseToken: 'lease-1',
    leaseOwner: 'worker-1',
    leaseEpoch: 2,
    heartbeatAt: NOW.toISOString(),
    leaseExpiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
    submitStartedAt: new Date(NOW.getTime() - 60_000).toISOString(),
    submittedAt: new Date(NOW.getTime() - 50_000).toISOString(),
    unknownAt: null,
    rejectedAt: null,
    nextReconcileAt: null,
    reconcileAttemptCount: 1,
    lastReconciledAt: null,
    completedAt: null,
    resolvedByUserId: null,
    resolutionNote: null,
    resolutionEvidence: null,
    resolutionEvidenceHash: null,
    createdAt: new Date(NOW.getTime() - 70_000).toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

function claim(value = attempt()): OzonPublishReconciliationLeaseClaim {
  return {
    attempt: value,
    leaseToken: value.leaseToken || 'lease-1',
    leaseEpoch: value.leaseEpoch || 1,
  };
}

function repository(input: {
  claims?: OzonPublishReconciliationLeaseClaim[];
  complete?: (
    args: Parameters<OzonPublishAttemptRepository['completeReconciliation']>[0],
  ) => ReturnType<OzonPublishAttemptRepository['completeReconciliation']>;
  calls?: string[];
} = {}) {
  const calls = input.calls || [];
  const complete = input.complete || vi.fn(async ({ outcome }) => attempt({
    reconciliationState: outcome.kind,
    leasePurpose: null,
    leaseToken: null,
    leaseOwner: null,
    heartbeatAt: null,
    leaseExpiresAt: null,
  }));
  const value = {
    markStaleSubmissionsUnknown: vi.fn(async () => {
      calls.push('stale');
      return [];
    }),
    claimReconciliation: vi.fn(async () => {
      calls.push('claim');
      return input.claims || [];
    }),
    completeReconciliation: vi.fn(async (args) => {
      calls.push(`complete:${args.attemptId}`);
      return complete(args);
    }),
    attachLateAcknowledgement: vi.fn(async ({ attemptId, taskId }) => {
      calls.push(`attach:${attemptId}:${taskId}`);
      return attempt({
        id: attemptId,
        state: 'SUBMITTED',
        reconciliationState: 'PENDING',
        ozonTaskId: taskId,
        leasePurpose: null,
        leaseToken: null,
        leaseOwner: null,
        heartbeatAt: null,
        leaseExpiresAt: null,
      });
    }),
  };
  return value as typeof value & OzonPublishAttemptRepository;
}

function logger(): OzonPublishReconciliationLogger {
  return {
    info: vi.fn<(message: string, details?: unknown) => void>(),
    warn: vi.fn<(message: string, details?: unknown) => void>(),
    error: vi.fn<(message: string, details?: unknown) => void>(),
  };
}

function settings(overrides: Partial<typeof DEFAULT_OZON_PUBLISH_RECONCILIATION_SETTINGS> = {}) {
  return {
    ...DEFAULT_OZON_PUBLISH_RECONCILIATION_SETTINGS,
    workerId: 'worker-1',
    retryBaseDelayMs: 1_000,
    retryMaxDelayMs: 10_000,
    maxAttempts: 5,
    ...overrides,
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('Ozon publish reconciliation service', () => {
  it('does not claim reconciliation work when the stale-submission scan fails', async () => {
    const repo = repository();
    repo.markStaleSubmissionsUnknown.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(runOzonPublishReconciliationTick({
      repository: repo,
      resolveOwnedClient: vi.fn(),
      settings: settings(),
      now: () => NOW,
      logger: logger(),
    })).rejects.toThrow('database unavailable');

    expect(repo.claimReconciliation).not.toHaveBeenCalled();
  });

  it('marks stale submissions before claiming and persists a pending trace as RETRY_WAIT', async () => {
    const calls: string[] = [];
    const repo = repository({ claims: [claim()], calls });
    const getImportInfo = vi.fn(async () => ({
      total: 2,
      items: [
        { offer_id: 'offer-a', product_id: 11, status: 'imported', errors: [] },
        { offer_id: 'offer-b', product_id: 0, status: 'pending', errors: [] },
      ],
    }));

    const result = await runOzonPublishReconciliationTick({
      repository: repo,
      resolveOwnedClient: vi.fn(async (ownerUserId, shopId) => {
        calls.push(`resolve:${ownerUserId}:${shopId}`);
        return { getImportInfo };
      }),
      settings: settings(),
      now: () => NOW,
      logger: logger(),
    });

    expect(calls).toEqual([
      'stale',
      'claim',
      'resolve:user-1:shop-1',
      'complete:attempt-1',
    ]);
    expect(getImportInfo).toHaveBeenCalledWith(123);
    expect(repo.completeReconciliation).toHaveBeenCalledWith(expect.objectContaining({
      attemptId: 'attempt-1',
      workerId: 'worker-1',
      leaseToken: 'lease-1',
      leaseEpoch: 2,
      outcome: expect.objectContaining({
        kind: 'RETRY_WAIT',
        errorCode: 'OZON_IMPORT_PENDING',
        nextReconcileAt: new Date('2026-07-15T08:00:01.000Z'),
        itemResults: [
          expect.objectContaining({ ordinal: 0, offerId: 'offer-a', skuKey: 'sku-a', found: true, status: 'imported' }),
          expect.objectContaining({ ordinal: 1, offerId: 'offer-b', skuKey: 'sku-b', found: true, status: 'pending' }),
        ],
      }),
    }));
    expect(result).toEqual(expect.objectContaining({ staleMarked: 0, claimed: 1, retried: 1 }));
  });

  it('persists complete success mapped to the immutable offer trace', async () => {
    const repo = repository({ claims: [claim()] });
    await runOzonPublishReconciliationTick({
      repository: repo,
      resolveOwnedClient: async () => ({
        getImportInfo: async () => ({
          total: 2,
          items: [
            { offer_id: 'offer-b', product_id: 22, status: 'imported', errors: [] },
            { offer_id: 'offer-a', product_id: 11, status: 'imported', errors: [] },
          ],
        }),
      }),
      settings: settings(),
      now: () => NOW,
      logger: logger(),
    });

    const outcome = repo.completeReconciliation.mock.calls[0]?.[0].outcome;
    expect(outcome).toEqual(expect.objectContaining({ kind: 'SUCCEEDED', itemErrors: [] }));
    expect(outcome.itemResults).toEqual([
      expect.objectContaining({ ordinal: 0, offerId: 'offer-a', productId: 11 }),
      expect.objectContaining({ ordinal: 1, offerId: 'offer-b', productId: 22 }),
    ]);
  });

  it.each([
    {
      name: 'partial failure',
      items: [
        { offer_id: 'offer-a', product_id: 11, status: 'imported', errors: [] },
        { offer_id: 'offer-b', product_id: 0, status: 'failed', errors: [{ code: 'BAD_TITLE', state: 'declined', level: 'error', description: 'bad title', field: 'name' }] },
      ],
      expected: 'PARTIAL_FAILURE',
    },
    {
      name: 'complete failure',
      items: [
        { offer_id: 'offer-a', product_id: 0, status: 'failed', errors: [{ code: 'BAD_A', state: 'declined', level: 'error', description: 'bad a', field: 'name' }] },
        { offer_id: 'offer-b', product_id: 0, status: 'failed', errors: [{ code: 'BAD_B', state: 'declined', level: 'error', description: 'bad b', field: 'name' }] },
      ],
      expected: 'FAILED',
    },
  ])('classifies $name and retains item-level errors', async ({ items, expected }) => {
    const repo = repository({ claims: [claim()] });
    await runOzonPublishReconciliationTick({
      repository: repo,
      resolveOwnedClient: async () => ({ getImportInfo: async () => ({ total: 2, items }) }),
      settings: settings(),
      now: () => NOW,
      logger: logger(),
    });

    const outcome = repo.completeReconciliation.mock.calls[0]?.[0].outcome;
    expect(outcome.kind).toBe(expected);
    expect(outcome.itemErrors).toEqual(expect.arrayContaining([
      expect.objectContaining({ ordinal: expect.any(Number), offerId: expect.any(String), code: expect.stringMatching(/^BAD_/) }),
    ]));
  });

  it('never submits UNKNOWN attempts and retries ambiguous evidence', async () => {
    const unknown = attempt({
      state: 'UNKNOWN',
      ozonTaskId: null,
      acceptanceSource: null,
      response: null,
      responseHash: null,
      submittedAt: null,
      unknownAt: NOW.toISOString(),
    });
    const repo = repository({ claims: [claim(unknown)] });
    const readClient = { getImportInfo: vi.fn() };
    const resolveOwnedClient = vi.fn(async () => readClient);
    const probeUnknownAttempt = vi.fn(async () => ({
      confirmedAccepted: false as const,
      reason: 'No trustworthy task acknowledgement was found',
    }));

    await runOzonPublishReconciliationTick({
      repository: repo,
      resolveOwnedClient,
      probeUnknownAttempt,
      settings: settings(),
      now: () => NOW,
      logger: logger(),
    });

    expect(resolveOwnedClient).toHaveBeenCalledWith('user-1', 'shop-1');
    expect(probeUnknownAttempt).toHaveBeenCalledWith(unknown, readClient);
    expect(repo.attachLateAcknowledgement).not.toHaveBeenCalled();
    expect(repo.completeReconciliation).toHaveBeenCalledWith(expect.objectContaining({
      outcome: expect.objectContaining({
        kind: 'RETRY_WAIT',
        errorCode: 'OZON_UNKNOWN_ACK_UNPROVEN',
      }),
    }));
  });

  it('attaches only an explicit trustworthy late acknowledgement', async () => {
    const unknown = attempt({
      state: 'UNKNOWN',
      ozonTaskId: null,
      acceptanceSource: null,
      response: null,
      responseHash: null,
    });
    const repo = repository({ claims: [claim(unknown)] });
    await runOzonPublishReconciliationTick({
      repository: repo,
      resolveOwnedClient: vi.fn(),
      probeUnknownAttempt: async () => ({
        confirmedAccepted: true,
        trustworthy: true,
        taskId: '987',
        evidence: { source: 'signed-ozon-ack', requestId: 'request-1' },
      }),
      settings: settings(),
      now: () => NOW,
      logger: logger(),
    });

    expect(repo.attachLateAcknowledgement).toHaveBeenCalledWith({
      attemptId: 'attempt-1',
      workerId: 'worker-1',
      leaseToken: 'lease-1',
      leaseEpoch: 2,
      taskId: '987',
      response: { source: 'signed-ozon-ack', requestId: 'request-1' },
    });
    expect(repo.completeReconciliation).not.toHaveBeenCalled();
  });

  it('does not attach an acknowledgement that is asserted but not trustworthy', async () => {
    const unknown = attempt({ state: 'UNKNOWN', ozonTaskId: null });
    const repo = repository({ claims: [claim(unknown)] });
    await runOzonPublishReconciliationTick({
      repository: repo,
      resolveOwnedClient: async () => ({ getImportInfo: vi.fn() }),
      probeUnknownAttempt: async () => ({
        confirmedAccepted: true,
        trustworthy: false,
        taskId: '987',
        evidence: { source: 'unverified-offer-lookup' },
        reason: 'Offer presence does not prove this request was accepted',
      }),
      settings: settings(),
      now: () => NOW,
      logger: logger(),
    });

    expect(repo.attachLateAcknowledgement).not.toHaveBeenCalled();
    expect(repo.completeReconciliation).toHaveBeenCalledWith(expect.objectContaining({
      outcome: expect.objectContaining({
        kind: 'RETRY_WAIT',
        errorCode: 'OZON_UNKNOWN_ACK_UNPROVEN',
      }),
    }));
  });

  it('bounds retries when a trustworthy late acknowledgement cannot be persisted', async () => {
    const unknown = attempt({ state: 'UNKNOWN', ozonTaskId: null });
    const repo = repository({ claims: [claim(unknown)] });
    repo.attachLateAcknowledgement.mockRejectedValueOnce(new Error('task ID already exists'));

    const result = await runOzonPublishReconciliationTick({
      repository: repo,
      resolveOwnedClient: async () => ({ getImportInfo: vi.fn() }),
      probeUnknownAttempt: async () => ({
        confirmedAccepted: true,
        trustworthy: true,
        taskId: '987',
        evidence: { source: 'signed-ozon-ack' },
      }),
      settings: settings(),
      now: () => NOW,
      logger: logger(),
    });

    expect(repo.completeReconciliation).toHaveBeenCalledWith(expect.objectContaining({
      attemptId: 'attempt-1',
      leaseToken: 'lease-1',
      leaseEpoch: 2,
      outcome: expect.objectContaining({
        kind: 'RETRY_WAIT',
        errorCode: 'OZON_LATE_ACK_PERSIST_FAILED',
      }),
    }));
    expect(result.retried).toBe(1);
  });

  it('uses exponential backoff and sends unresolved attempts to manual review at the limit', async () => {
    const retryRepo = repository({ claims: [claim(attempt({ reconcileAttemptCount: 3 }))] });
    await runOzonPublishReconciliationTick({
      repository: retryRepo,
      resolveOwnedClient: async () => ({ getImportInfo: async () => ({ total: 0, items: [] }) }),
      settings: settings({ maxAttempts: 5 }),
      now: () => NOW,
      logger: logger(),
    });
    expect(retryRepo.completeReconciliation).toHaveBeenCalledWith(expect.objectContaining({
      outcome: expect.objectContaining({
        kind: 'RETRY_WAIT',
        nextReconcileAt: new Date('2026-07-15T08:00:04.000Z'),
      }),
    }));

    const manualRepo = repository({ claims: [claim(attempt({ reconcileAttemptCount: 5 }))] });
    await runOzonPublishReconciliationTick({
      repository: manualRepo,
      resolveOwnedClient: async () => ({ getImportInfo: async () => ({ total: 0, items: [] }) }),
      settings: settings({ maxAttempts: 5 }),
      now: () => NOW,
      logger: logger(),
    });
    expect(manualRepo.completeReconciliation).toHaveBeenCalledWith(expect.objectContaining({
      outcome: expect.objectContaining({ kind: 'MANUAL_REVIEW' }),
    }));
  });

  it('bounds oversized provider diagnostics without losing terminal failure classification', async () => {
    const one = attempt({
      offerTrace: [{ ordinal: 0, offerId: 'offer-a', skuKey: 'sku-a' }],
      itemCount: 1,
    });
    const repo = repository({ claims: [claim(one)] });
    await runOzonPublishReconciliationTick({
      repository: repo,
      resolveOwnedClient: async () => ({
        getImportInfo: async () => ({
          total: 1,
          items: [{
            offer_id: 'offer-a',
            product_id: 0,
            status: 'failed',
            errors: [{
              code: 'TOO_LARGE',
              state: 'declined',
              level: 'error',
              description: 'x'.repeat(2_001),
              field: 'name',
            }],
          }],
        }),
      }),
      settings: settings(),
      now: () => NOW,
      logger: logger(),
    });

    const outcome = repo.completeReconciliation.mock.calls[0]?.[0].outcome;
    expect(outcome.kind).toBe('FAILED');
    expect(outcome.itemResults).toEqual([
      expect.objectContaining({
        errorCount: 1,
        errorsTruncated: true,
        errors: [expect.objectContaining({ truncatedFields: ['description'] })],
      }),
    ]);
    const retainedDescription = outcome.itemResults?.[0]?.errors?.[0]?.description;
    expect(Buffer.byteLength(String(retainedDescription), 'utf8')).toBe(1_000);
    expect(outcome.itemErrors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'OZON_ERRORS_TRUNCATED',
        level: 'error',
        description: 'Truncated oversized fields in the retained Ozon error sample',
      }),
    ]));
  });

  it.each([
    { blockingTail: true, expectedKind: 'FAILED', expectedLevel: 'error' },
    { blockingTail: false, expectedKind: 'SUCCEEDED', expectedLevel: 'warning' },
  ])('retains classification when the error-count sample is truncated ($expectedKind)', async ({
    blockingTail,
    expectedKind,
    expectedLevel,
  }) => {
    const one = attempt({
      offerTrace: [{ ordinal: 0, offerId: 'offer-a', skuKey: 'sku-a' }],
      itemCount: 1,
    });
    const warnings = Array.from({ length: 50 }, (_, index) => ({
      code: `WARNING_${index}`,
      state: 'warning',
      level: 'warning',
      description: `warning ${index}`,
      field: 'name',
    }));
    const repo = repository({ claims: [claim(one)] });
    await runOzonPublishReconciliationTick({
      repository: repo,
      resolveOwnedClient: async () => ({
        getImportInfo: async () => ({
          total: 1,
          items: [{
            offer_id: 'offer-a',
            product_id: 11,
            status: 'imported',
            errors: [
              ...warnings,
              blockingTail
                ? { code: 'BLOCKING_TAIL', state: 'declined', level: 'error', description: 'blocked', field: 'name' }
                : { code: 'WARNING_TAIL', state: 'warning', level: 'warning', description: 'warning tail', field: 'name' },
            ],
          }],
        }),
      }),
      settings: settings(),
      now: () => NOW,
      logger: logger(),
    });

    const outcome = repo.completeReconciliation.mock.calls[0]?.[0].outcome;
    expect(outcome.kind).toBe(expectedKind);
    expect(outcome.itemResults).toEqual([
      expect.objectContaining({ errorCount: 51, errorsTruncated: true }),
    ]);
    expect(outcome.itemResults?.[0]?.errors).toHaveLength(50);
    expect(outcome.itemErrors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'OZON_ERRORS_TRUNCATED',
        level: expectedLevel,
        description: 'Retained 50 of 51 Ozon errors',
      }),
    ]));
  });

  it('preserves a blocking classification beyond the global retained-error budget', async () => {
    const offerTrace = Array.from({ length: 11 }, (_, ordinal) => ({
      ordinal,
      offerId: `offer-${ordinal}`,
      skuKey: `sku-${ordinal}`,
    }));
    const warningErrors = Array.from({ length: 50 }, (_, index) => ({
      code: `WARNING_${index}`,
      state: 'warning',
      level: 'warning',
      description: `warning ${index}`,
      field: 'name',
    }));
    const target = attempt({ offerTrace, itemCount: offerTrace.length });
    const repo = repository({ claims: [claim(target)] });
    await runOzonPublishReconciliationTick({
      repository: repo,
      resolveOwnedClient: async () => ({
        getImportInfo: async () => ({
          total: offerTrace.length,
          items: offerTrace.map((trace) => ({
            offer_id: trace.offerId,
            product_id: trace.ordinal + 1,
            status: 'imported',
            errors: trace.ordinal < 10
              ? warningErrors
              : [{ code: 'BLOCKED_AFTER_GLOBAL_LIMIT', state: 'declined', level: 'error', description: 'blocked', field: 'name' }],
          })),
        }),
      }),
      settings: settings(),
      now: () => NOW,
      logger: logger(),
    });

    const outcome = repo.completeReconciliation.mock.calls[0]?.[0].outcome;
    expect(outcome.kind).toBe('PARTIAL_FAILURE');
    expect(outcome.itemResults?.[10]).toEqual(expect.objectContaining({
      offerId: 'offer-10',
      errorCount: 1,
      errors: [],
      errorsTruncated: true,
    }));
    expect(outcome.itemErrors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        offerId: 'offer-10',
        code: 'OZON_ERRORS_TRUNCATED',
        level: 'error',
      }),
    ]));
  });

  it('never turns an unexpected PREPARED claim into an automatic submission', async () => {
    const prepared = attempt({
      state: 'PREPARED',
      reconciliationState: 'NOT_REQUIRED',
      ozonTaskId: null,
      leasePurpose: null,
      leaseToken: null,
      leaseOwner: null,
      heartbeatAt: null,
      leaseExpiresAt: null,
    });
    const repo = repository({ claims: [claim(prepared)] });
    const resolveOwnedClient = vi.fn();

    const result = await runOzonPublishReconciliationTick({
      repository: repo,
      resolveOwnedClient,
      settings: settings(),
      now: () => NOW,
      logger: logger(),
    });

    expect(resolveOwnedClient).not.toHaveBeenCalled();
    expect(repo.completeReconciliation).not.toHaveBeenCalled();
    expect(repo.attachLateAcknowledgement).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
  });

  it('treats lease loss as fencing and continues processing later claims', async () => {
    const lost = attempt({ id: 'attempt-lost', offerTrace: [{ ordinal: 0, offerId: 'offer-a', skuKey: 'sku-a' }], itemCount: 1 });
    const next = attempt({ id: 'attempt-next', offerTrace: [{ ordinal: 0, offerId: 'offer-a', skuKey: 'sku-a' }], itemCount: 1 });
    const complete = vi.fn(async (input: Parameters<
      OzonPublishAttemptRepository['completeReconciliation']
    >[0]) => {
      if (input.attemptId === 'attempt-lost') {
        throw new OzonPublishAttemptError('LEASE_LOST', 'lease expired');
      }
      return next;
    });
    const repo = repository({ claims: [claim(lost), claim(next)], complete });
    const logs = logger();

    const result = await runOzonPublishReconciliationTick({
      repository: repo,
      resolveOwnedClient: async () => ({
        getImportInfo: async () => ({
          total: 1,
          items: [{ offer_id: 'offer-a', product_id: 11, status: 'imported', errors: [] }],
        }),
      }),
      settings: settings(),
      now: () => NOW,
      logger: logs,
    });

    expect(complete).toHaveBeenCalledTimes(2);
    expect(result).toEqual(expect.objectContaining({ claimed: 2, completed: 1, leaseLost: 1 }));
    expect(logs.warn).toHaveBeenCalledWith(expect.stringContaining('attempt-lost'), expect.anything());
  });

  it('starts every claimed read before waiting for another claimed read to finish', async () => {
    const first = attempt({ id: 'attempt-a', ozonTaskId: '123' });
    const second = attempt({ id: 'attempt-b', ozonTaskId: '456' });
    const repo = repository({ claims: [claim(first), claim(second)] });
    const releases = new Map<number | string, (value: unknown) => void>();
    const getImportInfo = vi.fn((taskId: number | string) => new Promise((resolve) => {
      releases.set(taskId, resolve);
    }));

    const running = runOzonPublishReconciliationTick({
      repository: repo,
      resolveOwnedClient: async () => ({ getImportInfo }),
      settings: settings(),
      now: () => NOW,
      logger: logger(),
    });
    await flush();

    expect(getImportInfo).toHaveBeenCalledTimes(2);
    releases.get(123)?.({
      total: 2,
      items: [
        { offer_id: 'offer-a', product_id: 11, status: 'imported', errors: [] },
        { offer_id: 'offer-b', product_id: 22, status: 'imported', errors: [] },
      ],
    });
    releases.get(456)?.({
      total: 2,
      items: [
        { offer_id: 'offer-a', product_id: 11, status: 'imported', errors: [] },
        { offer_id: 'offer-b', product_id: 22, status: 'imported', errors: [] },
      ],
    });
    await running;
    expect(repo.completeReconciliation).toHaveBeenCalledTimes(2);
  });
});

describe('Ozon publish reconciliation timer worker', () => {
  it('runs the standalone production tick through the injected owner/shop status client', async () => {
    const value = attempt({ ozonTaskId: '9007199254740997' });
    const store = repository({ claims: [claim(value)] });
    const getImportInfo = vi.fn(async () => ({
      items: value.offerTrace.map((trace, index) => ({
        offer_id: trace.offerId,
        product_id: index + 1,
        status: 'imported',
        errors: [],
      })),
    }));
    const resolveOwnedClient = vi.fn(async () => ({ getImportInfo }));

    const result = await runOzonPublishReconciliationWorkerTick({
      repository: store,
      resolveOwnedClient,
      workerId: 'standalone-worker-1',
      logger: logger(),
    });

    expect(resolveOwnedClient).toHaveBeenCalledWith('user-1', 'shop-1');
    expect(getImportInfo).toHaveBeenCalledOnce();
    expect(getImportInfo).toHaveBeenCalledWith('9007199254740997');
    expect(store.completeReconciliation).toHaveBeenCalledWith(expect.objectContaining({
      attemptId: 'attempt-1',
      workerId: 'standalone-worker-1',
      outcome: expect.objectContaining({ kind: 'SUCCEEDED' }),
    }));
    expect(result).toMatchObject({ claimed: 1, completed: 1, failed: 0 });
  });

  it('starts immediately, logs a single-line initial result, and registers an awaitable stop', async () => {
    const emptyTickResult = {
      staleMarked: 0,
      claimed: 0,
      completed: 0,
      retried: 0,
      manualReview: 0,
      lateAcknowledged: 0,
      leaseLost: 0,
      failed: 0,
      skipped: 0,
    };
    let releaseFirst!: () => void;
    const firstTick = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const runTick = vi.fn()
      .mockImplementationOnce(async () => {
        await firstTick;
        return emptyTickResult;
      })
      .mockResolvedValue(emptyTickResult);
    const scheduled: Array<{ callback: () => void; delay: number; handle: object }> = [];
    const setTimeoutFn = vi.fn((callback: () => void, delay: number) => {
      const handle = { unref: vi.fn() };
      scheduled.push({ callback, delay, handle });
      return handle as unknown as ReturnType<typeof setTimeout>;
    });
    const clearTimeoutFn = vi.fn();
    const registerStop = vi.fn();
    const logs = logger();

    const worker = startOzonPublishReconciliationWorker({
      runTick,
      intervalMs: 2_500,
      setTimeout: setTimeoutFn,
      clearTimeout: clearTimeoutFn,
      registerStop,
      logger: logs,
    });

    expect(runTick).toHaveBeenCalledTimes(1);
    expect(registerStop).toHaveBeenCalledWith(worker.stop);
    expect(scheduled).toHaveLength(0);

    releaseFirst();
    await flush();
    expect(logs.info).toHaveBeenCalledWith(
      '[ozon-publish-reconciliation] {"event":"INITIAL_TICK_COMPLETED","staleMarked":0,"claimed":0,"completed":0,"retried":0,"manualReview":0,"lateAcknowledged":0,"leaseLost":0,"failed":0,"skipped":0}',
    );
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.delay).toBe(2_500);

    scheduled[0]?.callback();
    await flush();
    expect(runTick).toHaveBeenCalledTimes(2);
    expect(scheduled).toHaveLength(2);

    await worker.stop();
    expect(clearTimeoutFn).toHaveBeenCalledWith(scheduled[1]?.handle);
    scheduled[1]?.callback();
    await flush();
    expect(runTick).toHaveBeenCalledTimes(2);
  });

  it('does not reschedule an in-flight tick after stop and logs tick failures safely', async () => {
    let rejectTick!: (error: Error) => void;
    const runTick = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectTick = reject; }));
    const setTimeoutFn = vi.fn();
    const logs = logger();
    const registerStop = vi.fn();

    const worker = startOzonPublishReconciliationWorker({
      runTick,
      intervalMs: 2_500,
      setTimeout: setTimeoutFn,
      clearTimeout: vi.fn(),
      registerStop,
      logger: logs,
    });
    let stopCompleted = false;
    const stopping = worker.stop().then(() => { stopCompleted = true; });
    await flush();
    expect(stopCompleted).toBe(false);
    rejectTick(new Error('database unavailable'));
    await stopping;
    expect(stopCompleted).toBe(true);

    expect(logs.error).toHaveBeenCalledWith(
      '[ozon-publish-reconciliation] tick failed',
      expect.any(Error),
    );
    expect(setTimeoutFn).not.toHaveBeenCalled();
  });

  it('logs a failed tick and keeps the periodic loop alive', async () => {
    const runTick = vi.fn()
      .mockRejectedValueOnce(new Error('temporary database failure'))
      .mockResolvedValue(undefined);
    const scheduled: Array<() => void> = [];
    const setTimeoutFn = vi.fn((callback: () => void) => {
      scheduled.push(callback);
      return { unref: vi.fn() } as unknown as ReturnType<typeof setTimeout>;
    });
    const logs = logger();
    const worker = startOzonPublishReconciliationWorker({
      runTick,
      intervalMs: 2_500,
      setTimeout: setTimeoutFn,
      clearTimeout: vi.fn(),
      registerStop: vi.fn(),
      logger: logs,
    });
    await flush();

    expect(logs.error).toHaveBeenCalledWith(
      '[ozon-publish-reconciliation] tick failed',
      expect.any(Error),
    );
    expect(scheduled).toHaveLength(1);
    scheduled[0]?.();
    await flush();
    expect(runTick).toHaveBeenCalledTimes(2);
    await worker.stop();
  });
});
