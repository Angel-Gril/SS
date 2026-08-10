import { describe, expect, it, vi } from 'vitest';
import {
  createExtensionWorkbenchByokPublishProvenanceService,
} from '../services/extension-workbench-byok-publish-provenance.js';

const reusableInput = {
  ownerUserId: 'owner-1',
  shopId: 'shop-1',
  workflowId: 'workflow-1',
  assetIds: ['byok-asset-1', 'byok-asset-2'],
};

const linkInput = {
  ...reusableInput,
  assetIds: ['source-asset-1', ...reusableInput.assetIds],
  publishIntentId: 'publish-intent-new',
  publishReceiptId: 'publish-receipt-new',
  requestHash: 'a'.repeat(64),
};
const SUBMIT_STARTED_AT = new Date('2026-08-09T00:00:00.000Z');
const SUBMITTED_AT = new Date('2026-08-09T00:00:01.000Z');

function rejectedHistory(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'provenance-1',
    executionMode: 'BYOK',
    ownerUserId: 'owner-1',
    shopId: 'shop-1',
    workflowId: 'workflow-1',
    assetId: 'byok-asset-1',
    publishIntentId: 'publish-intent-old',
    publishReceiptId: 'publish-receipt-old',
    publishIntent: {
      id: 'publish-intent-old',
      ownerUserId: 'owner-1',
      shopId: 'shop-1',
      workflowId: 'workflow-1',
      draftVersion: 9,
      idempotencyKey: 'old-publish-idempotency-key',
      publishAttempt: {
        publishIntentId: 'publish-intent-old',
        ownerUserId: 'owner-1',
        shopId: 'shop-1',
        workflowId: 'workflow-1',
        draftVersion: 9,
        state: 'REJECTED',
        reconciliationState: 'NOT_REQUIRED',
        ozonTaskId: null,
        acceptanceSource: null,
        leasePurpose: null,
        leaseToken: null,
        leaseOwner: null,
        heartbeatAt: null,
        leaseExpiresAt: null,
        submitStartedAt: SUBMIT_STARTED_AT,
        submittedAt: null,
        rejectedAt: SUBMITTED_AT,
      },
    },
    publishReceipt: {
      id: 'publish-receipt-old',
      status: 'FAILED',
      result: null,
      failureCode: 'OZON_SUBMIT_REJECTED',
      grant: {
        ownerUserId: 'owner-1',
        shopId: 'shop-1',
        workflowId: 'workflow-1',
        draftVersion: 9,
        operation: 'OZON_PUBLISH',
        idempotencyKey: 'old-publish-idempotency-key',
        requestHash: 'b'.repeat(64),
      },
    },
    ...overrides,
  };
}

function unlinked(assetId = 'byok-asset-2') {
  return {
    id: `provenance-${assetId}`,
    executionMode: 'BYOK',
    ownerUserId: 'owner-1',
    shopId: 'shop-1',
    workflowId: 'workflow-1',
    assetId,
    publishIntentId: null,
    publishReceiptId: null,
    publishIntent: null,
    publishReceipt: null,
  };
}

function linkedToTarget(assetId = 'byok-asset-2') {
  return {
    ...unlinked(assetId),
    publishIntentId: linkInput.publishIntentId,
    publishReceiptId: linkInput.publishReceiptId,
  };
}

function targetIntent(overrides: Record<string, unknown> = {}) {
  return {
    id: linkInput.publishIntentId,
    ownerUserId: linkInput.ownerUserId,
    shopId: linkInput.shopId,
    workflowId: linkInput.workflowId,
    draftVersion: 10,
    idempotencyKey: 'new-publish-idempotency-key',
    publishAttempt: {
      id: 'attempt-new',
      publishIntentId: linkInput.publishIntentId,
      ownerUserId: linkInput.ownerUserId,
      shopId: linkInput.shopId,
      workflowId: linkInput.workflowId,
      draftVersion: 10,
      state: 'SUBMITTED',
      reconciliationState: 'PENDING',
      ozonTaskId: '123456789',
      acceptanceSource: 'OZON_TASK_RESPONSE',
      leasePurpose: null,
      leaseToken: null,
      leaseOwner: null,
      heartbeatAt: null,
      leaseExpiresAt: null,
      submitStartedAt: SUBMIT_STARTED_AT,
      submittedAt: SUBMITTED_AT,
      rejectedAt: null,
    },
    ...overrides,
  };
}

function targetReceipt(overrides: Record<string, unknown> = {}) {
  const attempt = targetIntent().publishAttempt;
  return {
    id: linkInput.publishReceiptId,
    status: 'SUCCEEDED',
    result: {
      id: attempt.id,
      publishIntentId: attempt.publishIntentId,
      ownerUserId: attempt.ownerUserId,
      shopId: attempt.shopId,
      workflowId: attempt.workflowId,
      draftVersion: attempt.draftVersion,
      state: attempt.state,
      reconciliationState: attempt.reconciliationState,
      ozonTaskId: attempt.ozonTaskId,
      acceptanceSource: attempt.acceptanceSource,
      submitStartedAt: attempt.submitStartedAt.toISOString(),
      submittedAt: attempt.submittedAt.toISOString(),
      rejectedAt: null,
    },
    failureCode: null,
    grant: {
      ownerUserId: linkInput.ownerUserId,
      shopId: linkInput.shopId,
      workflowId: linkInput.workflowId,
      draftVersion: 10,
      operation: 'OZON_PUBLISH',
      idempotencyKey: 'new-publish-idempotency-key',
      requestHash: linkInput.requestHash,
    },
    ...overrides,
  };
}

function database(rows: any[]) {
  const updateMany = vi.fn(async () => ({ count: 1 }));
  const client: any = {
    $queryRawUnsafe: vi.fn(async () => [{ locked: 1 }]),
    extensionByokMediaProvenance: {
      findMany: vi.fn(async () => structuredClone(rows)),
      updateMany,
    },
    sourceListingPublishIntent: {
      findFirst: vi.fn(async () => targetIntent()),
    },
    extensionCommandReceipt: {
      findFirst: vi.fn(async () => targetReceipt()),
    },
  };
  client.$transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => (
    callback(client)
  ));
  return { client, updateMany };
}

async function expectConflict(value: Promise<unknown>) {
  await expect(value).rejects.toMatchObject({
    code: 'EXTENSION_WORKBENCH_BYOK_PUBLISH_PROVENANCE_CONFLICT',
    statusCode: 409,
  });
}

describe('extension workbench BYOK publish provenance coordinator', () => {
  it('allows unlinked provenance and a complete terminal Ozon rejection without changing old IDs', async () => {
    const old = rejectedHistory();
    const { client, updateMany } = database([old, unlinked()]);
    const service = createExtensionWorkbenchByokPublishProvenanceService(client);

    await expect(service.assertReusable(reusableInput)).resolves.toEqual({
      provenanceCount: 2,
      rejectedHistoryCount: 1,
    });
    expect(old.publishIntentId).toBe('publish-intent-old');
    expect(old.publishReceiptId).toBe('publish-receipt-old');
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('rejects an incomplete provenance result set', async () => {
    const { client } = database([unlinked('byok-asset-1')]);
    await expectConflict(
      createExtensionWorkbenchByokPublishProvenanceService(client)
        .assertReusable(reusableInput),
    );
  });

  it.each([
    ['partial intent only', { publishReceiptId: null, publishReceipt: null }],
    ['partial receipt only', { publishIntentId: null, publishIntent: null }],
    ['missing receipt relation', { publishReceipt: null }],
    ['missing attempt relation', {
      publishIntent: { ...rejectedHistory().publishIntent, publishAttempt: null },
    }],
    ['unknown attempt', {
      publishIntent: {
        ...rejectedHistory().publishIntent,
        publishAttempt: {
          ...rejectedHistory().publishIntent.publishAttempt,
          state: 'UNKNOWN',
          reconciliationState: 'PENDING',
        },
      },
    }],
    ['submitted attempt', {
      publishIntent: {
        ...rejectedHistory().publishIntent,
        publishAttempt: {
          ...rejectedHistory().publishIntent.publishAttempt,
          state: 'SUBMITTED',
          reconciliationState: 'PENDING',
        },
      },
    }],
    ['succeeded receipt', {
      publishReceipt: { ...rejectedHistory().publishReceipt, status: 'SUCCEEDED', result: {} },
    }],
    ['another failure code', {
      publishReceipt: {
        ...rejectedHistory().publishReceipt,
        failureCode: 'PUBLISH_FAILED',
      },
    }],
  ])('rejects %s history before Ozon work', async (_label, overrides) => {
    const { client } = database([rejectedHistory(overrides), unlinked()]);
    await expectConflict(
      createExtensionWorkbenchByokPublishProvenanceService(client)
        .assertReusable(reusableInput),
    );
  });

  it.each([
    ['task', { ozonTaskId: 'task-1' }],
    ['acknowledgement', { acceptanceSource: 'TASK_ACK' }],
    ['lease purpose', { leasePurpose: 'SUBMIT' }],
    ['lease token', { leaseToken: 'lease-1' }],
    ['lease owner', { leaseOwner: 'worker-1' }],
    ['lease heartbeat', { heartbeatAt: new Date('2026-08-09T00:00:00.000Z') }],
    ['lease expiry', { leaseExpiresAt: new Date('2026-08-09T00:01:00.000Z') }],
    ['submitted timestamp', { submittedAt: new Date('2026-08-09T00:00:00.000Z') }],
  ])('rejects terminal-looking history that still has %s evidence', async (_label, attemptPatch) => {
    const history = rejectedHistory();
    history.publishIntent.publishAttempt = {
      ...history.publishIntent.publishAttempt,
      ...attemptPatch,
    };
    const { client } = database([history, unlinked()]);
    await expectConflict(
      createExtensionWorkbenchByokPublishProvenanceService(client)
        .assertReusable(reusableInput),
    );
  });

  it.each([
    ['receipt owner', {
      publishReceipt: {
        ...rejectedHistory().publishReceipt,
        grant: { ...rejectedHistory().publishReceipt.grant, ownerUserId: 'owner-other' },
      },
    }],
    ['intent workflow', {
      publishIntent: { ...rejectedHistory().publishIntent, workflowId: 'workflow-other' },
    }],
    ['attempt intent', {
      publishIntent: {
        ...rejectedHistory().publishIntent,
        publishAttempt: {
          ...rejectedHistory().publishIntent.publishAttempt,
          publishIntentId: 'publish-intent-other',
        },
      },
    }],
  ])('rejects a mismatched %s identity', async (_label, overrides) => {
    const { client } = database([rejectedHistory(overrides), unlinked()]);
    await expectConflict(
      createExtensionWorkbenchByokPublishProvenanceService(client)
        .assertReusable(reusableInput),
    );
  });

  it('links every unlinked row only after validating the complete set and target receipt', async () => {
    const { client, updateMany } = database([
      unlinked('byok-asset-1'),
      unlinked('byok-asset-2'),
    ]);
    updateMany.mockResolvedValue({ count: 2 });
    const service = createExtensionWorkbenchByokPublishProvenanceService(client);

    await expect(service.linkStatus(linkInput)).resolves.toEqual({
      linkedCount: 2,
      replayedCount: 0,
      preservedRejectedCount: 0,
      skippedTargetCount: 0,
    });
    expect(client.$queryRawUnsafe).toHaveBeenCalledWith(
      'SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtextextended($1, 0))',
      'ozon-publish-attempt-workflow:owner-1:workflow-1',
    );
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: expect.arrayContaining([
          'provenance-byok-asset-1', 'provenance-byok-asset-2',
        ]) },
        executionMode: 'BYOK',
        ownerUserId: 'owner-1',
        shopId: 'shop-1',
        workflowId: 'workflow-1',
        publishIntentId: null,
        publishReceiptId: null,
      },
      data: {
        publishIntentId: linkInput.publishIntentId,
        publishReceiptId: linkInput.publishReceiptId,
      },
    });
  });

  it('treats the same publish IDs as replay and preserves different rejected IDs as no-ops', async () => {
    const { client, updateMany } = database([
      linkedToTarget('byok-asset-1'),
      rejectedHistory({ assetId: 'byok-asset-2', id: 'provenance-byok-asset-2' }),
    ]);
    const service = createExtensionWorkbenchByokPublishProvenanceService(client);

    await expect(service.linkStatus(linkInput)).resolves.toEqual({
      linkedCount: 0,
      replayedCount: 1,
      preservedRejectedCount: 1,
      skippedTargetCount: 0,
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('links only an unlinked row while preserving immutable rejected publish IDs', async () => {
    const { client, updateMany } = database([
      rejectedHistory(),
      unlinked('byok-asset-2'),
    ]);
    const service = createExtensionWorkbenchByokPublishProvenanceService(client);

    await expect(service.linkStatus(linkInput)).resolves.toEqual({
      linkedCount: 1,
      replayedCount: 0,
      preservedRejectedCount: 1,
      skippedTargetCount: 0,
    });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: { in: ['provenance-byok-asset-2'] },
      }),
    }));
  });

  it('validates the target receipt binding before writing any provenance row', async () => {
    const { client, updateMany } = database([unlinked('byok-asset-1')]);
    client.extensionCommandReceipt.findFirst.mockResolvedValue(targetReceipt({
      grant: { ...targetReceipt().grant, requestHash: 'b'.repeat(64) },
    }));
    const service = createExtensionWorkbenchByokPublishProvenanceService(client);

    await expectConflict(service.linkStatus({
      ...linkInput,
      assetIds: ['byok-asset-1'],
    }));
    expect(updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed result', null],
    ['another attempt', { ...targetReceipt().result, id: 'attempt-other' }],
    ['another publish intent', {
      ...targetReceipt().result, publishIntentId: 'publish-intent-other',
    }],
    ['a non-submitted receipt snapshot', {
      ...targetReceipt().result, state: 'UNKNOWN',
    }],
    ['a non-pending receipt snapshot', {
      ...targetReceipt().result, reconciliationState: 'RUNNING',
    }],
    ['another task', { ...targetReceipt().result, ozonTaskId: '987654321' }],
    ['another acceptance source', {
      ...targetReceipt().result, acceptanceSource: 'TASK_ACK',
    }],
  ])('rejects a successful receipt with %s before writing provenance', async (_label, result) => {
    const { client, updateMany } = database([unlinked('byok-asset-1')]);
    client.extensionCommandReceipt.findFirst.mockResolvedValue(targetReceipt({ result }));

    await expectConflict(createExtensionWorkbenchByokPublishProvenanceService(client).linkStatus({
      ...linkInput,
      assetIds: ['byok-asset-1'],
    }));
    expect(updateMany).not.toHaveBeenCalled();
  });

  it.each([
    'RUNNING',
    'RETRY_WAIT',
    'SUCCEEDED',
    'PARTIAL_FAILURE',
    'FAILED',
    'MANUAL_REVIEW',
  ])('links an immutable submitted receipt after current reconciliation advances to %s', async (
    reconciliationState,
  ) => {
    const { client, updateMany } = database([unlinked('byok-asset-1')]);
    const reconciliationLease = reconciliationState === 'RUNNING'
      ? {
        leasePurpose: 'RECONCILE',
        leaseToken: 'reconciliation-lease-token',
        leaseOwner: 'reconciliation-worker',
        heartbeatAt: new Date('2026-08-09T00:02:00.000Z'),
        leaseExpiresAt: new Date('2026-08-09T00:03:00.000Z'),
      }
      : {};
    client.sourceListingPublishIntent.findFirst.mockResolvedValue(targetIntent({
      publishAttempt: {
        ...targetIntent().publishAttempt,
        reconciliationState,
        ...reconciliationLease,
      },
    }));

    await expect(createExtensionWorkbenchByokPublishProvenanceService(client).linkStatus({
      ...linkInput,
      assetIds: ['byok-asset-1'],
    })).resolves.toEqual({
      linkedCount: 1,
      replayedCount: 0,
      preservedRejectedCount: 0,
      skippedTargetCount: 0,
    });
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it('performs no write when any later row is partial or unsafe', async () => {
    const { client, updateMany } = database([
      unlinked('byok-asset-1'),
      rejectedHistory({
        id: 'provenance-byok-asset-2',
        assetId: 'byok-asset-2',
        publishReceiptId: null,
        publishReceipt: null,
      }),
    ]);
    const service = createExtensionWorkbenchByokPublishProvenanceService(client);

    await expectConflict(service.linkStatus(linkInput));
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('re-reads a concurrent null-to-same-target race as an idempotent replay', async () => {
    const { client, updateMany } = database([
      unlinked('byok-asset-1'),
      unlinked('byok-asset-2'),
    ]);
    client.extensionByokMediaProvenance.findMany
      .mockResolvedValueOnce([
        unlinked('byok-asset-1'),
        unlinked('byok-asset-2'),
      ])
      .mockResolvedValue([
        linkedToTarget('byok-asset-1'),
        linkedToTarget('byok-asset-2'),
      ]);
    updateMany.mockResolvedValue({ count: 1 });
    const service = createExtensionWorkbenchByokPublishProvenanceService(client);

    await expect(service.linkStatus(linkInput)).resolves.toEqual({
      linkedCount: 0,
      replayedCount: 2,
      preservedRejectedCount: 0,
      skippedTargetCount: 0,
    });
    expect(client.$transaction).toHaveBeenCalledTimes(2);
  });

  it('retries serializable P2034 conflicts at most three times', async () => {
    const { client } = database([linkedToTarget('byok-asset-1')]);
    client.$transaction
      .mockRejectedValueOnce(Object.assign(new Error('serialization conflict'), { code: 'P2034' }))
      .mockRejectedValueOnce(Object.assign(new Error('serialization conflict'), { code: 'P2034' }))
      .mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(client));

    await expect(createExtensionWorkbenchByokPublishProvenanceService(client).linkStatus({
      ...linkInput,
      assetIds: ['byok-asset-1'],
    })).resolves.toEqual({
      linkedCount: 0,
      replayedCount: 1,
      preservedRejectedCount: 0,
      skippedTargetCount: 0,
    });
    expect(client.$transaction).toHaveBeenCalledTimes(3);
  });

  it('maps an exhausted P2034 retry budget to a provenance conflict', async () => {
    const { client, updateMany } = database([unlinked('byok-asset-1')]);
    client.$transaction.mockRejectedValue(
      Object.assign(new Error('serialization conflict'), { code: 'P2034' }),
    );

    await expectConflict(createExtensionWorkbenchByokPublishProvenanceService(client).linkStatus({
      ...linkInput,
      assetIds: ['byok-asset-1'],
    }));
    expect(client.$transaction).toHaveBeenCalledTimes(3);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['pending receipt', targetIntent(), targetReceipt({
      status: 'PENDING', result: null, failureCode: null,
    })],
    ['missing attempt', targetIntent({ publishAttempt: null }), targetReceipt()],
    ['local failure', targetIntent({
      publishAttempt: {
        ...targetIntent().publishAttempt,
        state: 'REJECTED',
        reconciliationState: 'NOT_REQUIRED',
        ozonTaskId: null,
        acceptanceSource: null,
        submitStartedAt: null,
        submittedAt: null,
        rejectedAt: SUBMITTED_AT,
      },
    }), targetReceipt({ status: 'FAILED', result: null, failureCode: 'LOCAL_STALE_DRAFT' })],
    ['unknown attempt', targetIntent({
      publishAttempt: {
        ...targetIntent().publishAttempt,
        state: 'UNKNOWN',
        reconciliationState: 'PENDING',
        ozonTaskId: null,
        acceptanceSource: null,
        submittedAt: null,
        rejectedAt: null,
      },
    }), targetReceipt({ status: 'FAILED', result: null, failureCode: 'PUBLISH_FAILED' })],
    ['submitted attempt with impossible reconciliation', targetIntent({
      publishAttempt: {
        ...targetIntent().publishAttempt,
        reconciliationState: 'NOT_REQUIRED',
      },
    }), targetReceipt()],
  ])('treats a non-linkable %s as a safe no-op', async (_label, intent, receipt) => {
    const { client, updateMany } = database([unlinked('byok-asset-1')]);
    client.sourceListingPublishIntent.findFirst.mockResolvedValue(intent);
    client.extensionCommandReceipt.findFirst.mockResolvedValue(receipt);

    await expect(createExtensionWorkbenchByokPublishProvenanceService(client).linkStatus({
      ...linkInput,
      assetIds: ['byok-asset-1'],
    })).resolves.toEqual({
      linkedCount: 0,
      replayedCount: 0,
      preservedRejectedCount: 0,
      skippedTargetCount: 1,
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('links a complete definitive rejected target', async () => {
    const { client, updateMany } = database([unlinked('byok-asset-1')]);
    client.sourceListingPublishIntent.findFirst.mockResolvedValue(targetIntent({
      publishAttempt: {
        ...targetIntent().publishAttempt,
        state: 'REJECTED',
        reconciliationState: 'NOT_REQUIRED',
        ozonTaskId: null,
        acceptanceSource: null,
        submitStartedAt: SUBMIT_STARTED_AT,
        submittedAt: null,
        rejectedAt: SUBMITTED_AT,
      },
    }));
    client.extensionCommandReceipt.findFirst.mockResolvedValue(targetReceipt({
      status: 'FAILED', result: null, failureCode: 'OZON_SUBMIT_REJECTED',
    }));

    await expect(createExtensionWorkbenchByokPublishProvenanceService(client).linkStatus({
      ...linkInput,
      assetIds: ['byok-asset-1'],
    })).resolves.toEqual({
      linkedCount: 1,
      replayedCount: 0,
      preservedRejectedCount: 0,
      skippedTargetCount: 0,
    });
    expect(updateMany).toHaveBeenCalledTimes(1);
  });
});
