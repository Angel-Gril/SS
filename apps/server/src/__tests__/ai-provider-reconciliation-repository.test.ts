import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { PrismaAiProviderReconciliationRepository } from '../repositories/ai-provider-reconciliation-repository.js';
import { createAiImageProviderRuntimeContract } from '../services/ai-image-provider-runtime-contract.js';
import type { AiProviderReconciliationClaim } from '../services/ai-provider-reconciliation.js';

const NOW = new Date('2026-07-21T08:00:00.000Z');

function pendingJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    workflowId: 'workflow-1',
    workflowAttempt: 1,
    ownerUserId: 'owner-1',
    actorUserId: 'actor-1',
    operation: 'IMAGE_TRANSLATE',
    provider: 'fake',
    model: 'fake-image-translation-v1',
    estimatedCostCents: 0,
    requestedImageCount: 1,
    width: 1024,
    height: 1024,
    actualCostCents: null,
    billedUnits: 0,
    providerJobId: 'provider-task-1',
    status: 'FAILED',
    providerReconciliationStatus: 'PENDING',
    providerReconciliationRevision: 1,
    providerReconciliationAttemptCount: 0,
    providerReconciliationNextAt: new Date('2026-07-21T07:59:00.000Z'),
    providerReconciliationDeadlineAt: new Date('2026-07-22T08:00:00.000Z'),
    providerReconciliationLeaseOwner: null,
    providerReconciliationLeaseTokenHash: null,
    providerReconciliationLeaseExpiresAt: null,
    workflow: { id: 'workflow-1', ownerUserId: 'owner-1', currentAttempt: 1 },
    ...overrides,
  };
}

function noOutputHarness(currency: 'USD' | 'CNY') {
  const acceptedAt = new Date(Date.now() - 1000);
  const deadline = new Date(Date.now() + 60_000);
  const leaseToken = 'no-output-lease';
  const fingerprint = 'a'.repeat(64);
  const provider = 'dashscope-wanx';
  const model = 'wanx2.1-imageedit';
  const job = pendingJob({ provider, model, operation: 'INPAINT', estimatedCostCents: 14, attemptCount: 1,
    requestFingerprint: fingerprint, providerDispatchedAt: acceptedAt, providerReconciliationStatus: 'RUNNING',
    providerReconciliationRevision: 2, providerReconciliationLeaseTokenHash: createHash('sha256').update(leaseToken).digest('hex'),
    providerReconciliationLeaseExpiresAt: deadline, providerReconciliationDeadlineAt: deadline,
    operationConfig: { providerRuntime: createAiImageProviderRuntimeContract({ provider, model,
      baseUrl: 'https://dashscope.aliyuncs.com/api/v1', costPerImageCents: 14, ...(currency === 'CNY' ? { currency } : {}),
      credentialRevision: { recordId: 'key-record', revision: 1, updatedAt: acceptedAt.toISOString() } }, { count: 1, width: 1024, height: 1024 }) },
    workflow: { id: 'workflow-1', ownerUserId: 'owner-1', currentAttempt: 1, operation: 'INPAINT', status: 'FAILED' } });
  const settlements: any[] = [];
  const reservation = { id: 'cost-1', ownerUserId: 'owner-1', actorUserId: 'actor-1', jobId: 'job-1', currency, provider, model,
    requestFingerprint: fingerprint, status: 'RECONCILIATION_REQUIRED', estimatedCostMinor: 14, maximumCostMinor: 14,
    providerRequestId: 'provider-task-1', providerAcceptedAt: acceptedAt, updatedAt: acceptedAt, settlements };
  const tx = { $queryRawUnsafe: vi.fn(async () => [{ id: job.id }]),
    aiImageJob: { findUnique: vi.fn(async () => job), updateMany: vi.fn(async ({ data }: any) => { Object.assign(job, data); return { count: 1 }; }) },
    aiCostReservation: { findUnique: vi.fn(async () => reservation), updateMany: vi.fn(async ({ data }: any) => { Object.assign(reservation, data); return { count: 1 }; }) },
    aiCostSettlement: { findUnique: vi.fn(async ({ where }: any) => settlements.find(row => row.idempotencyKey === where.ai_cost_settlement_reservation_idempotency.idempotencyKey) || null),
      create: vi.fn(async ({ data }: any) => { const row = { id: 'settlement-1', ...data }; settlements.push(row); return row; }) },
    aiProviderReconciliationEvent: { create: vi.fn(async ({ data }: any) => data) } };
  const repository = new PrismaAiProviderReconciliationRepository({ $transaction: async (callback: any) => callback(tx) } as never);
  const claim: AiProviderReconciliationClaim = { jobId: job.id, workflowId: 'workflow-1', workflowAttempt: 1, attemptCount: 1,
    ownerUserId: 'owner-1', actorUserId: 'actor-1', provider, model, operation: 'INPAINT', estimatedCostCents: 14,
    providerJobId: 'provider-task-1', jobStatus: 'FAILED', reconciliationStatus: 'RUNNING', reconciliationRevision: 2,
    reconciliationAttemptCount: 1, requestFingerprint: fingerprint, deadlineAt: deadline, leaseToken };
  const input = { claim, providerStatus: 'FAILED', errorCode: 'PROVIDER_TASK_FAILED', errorMessage: 'Definite no output', billingDisposition: 'UNKNOWN' as const };
  return { job, reservation, settlements, tx, repository, input };
}

describe('Prisma AI Provider reconciliation repository', () => {
  it.each(['USD', 'CNY'] as const)('releases a confirmed no-output %s task without requiring supplier charge proof', async currency => {
    const state = noOutputHarness(currency);
    await state.repository.completeNoOutput(state.input);
    expect(state.reservation.status).toBe('RELEASED');
    expect(state.job).toMatchObject({ status: 'FAILED', providerReconciliationStatus: 'NO_OUTPUT', actualCostCents: 0, billedUnits: 0 });
    expect(state.settlements).toEqual([expect.objectContaining({ kind: 'RECONCILED_RELEASE', actualCostMinor: 0, billedUnits: 0 })]);
    await expect(state.repository.completeNoOutput(state.input)).rejects.toMatchObject({ code: 'PROVIDER_RECONCILIATION_LEASE_LOST' });
    expect(state.settlements).toHaveLength(1);
  });

  it.each(['UNKNOWN', 'PENDING', 'NOT_FOUND'])('does not relabel Provider status %s as confirmed no output', async providerStatus => {
    const state = noOutputHarness('USD');
    await expect(state.repository.completeNoOutput({ ...state.input, providerStatus })).rejects.toThrow();
    expect(state.settlements).toHaveLength(0);
    expect(state.tx.aiImageJob.updateMany).not.toHaveBeenCalled();
  });

  it.each(['', 'different-task'])('requires the exact stable task identity before zero-output release: %j', providerJobId => {
    const state = noOutputHarness('USD');
    return expect(state.repository.completeNoOutput({ ...state.input, claim: { ...state.input.claim, providerJobId } }))
      .rejects.toThrow().then(() => {
        expect(state.settlements).toHaveLength(0);
        expect(state.tx.aiImageJob.updateMany).not.toHaveBeenCalled();
      });
  });

  it.each(['SETTLED', 'RELEASED'])('preserves an earlier %s fee decision when no output is later observed', async status => {
    const state = noOutputHarness('USD');
    state.reservation.status = status;
    const actualCostCents = status === 'SETTLED' ? 14 : 0;
    const billedUnits = status === 'SETTLED' ? 1 : 0;
    Object.assign(state.job, { actualCostCents, billedUnits });
    state.settlements.push({ reservationId: 'cost-1', idempotencyKey: 'prior-terminal',
      kind: status === 'SETTLED' ? 'RECONCILED_CHARGE' : 'RECONCILED_RELEASE', actualCostMinor: actualCostCents, billedUnits });
    await state.repository.completeNoOutput(state.input);
    expect(state.reservation.status).toBe(status);
    expect(state.job).toMatchObject({ actualCostCents, billedUnits });
    expect(state.settlements).toHaveLength(1);
  });

  it('prioritizes expired running leases before a sustained due-task backlog', async () => {
    const expired = pendingJob({
      id: 'job-expired',
      providerJobId: 'provider-task-expired',
      providerReconciliationStatus: 'RUNNING',
      providerReconciliationRevision: 3,
      providerReconciliationAttemptCount: 1,
      providerReconciliationNextAt: null,
      providerReconciliationLeaseOwner: 'dead-worker',
      providerReconciliationLeaseTokenHash: 'a'.repeat(64),
      providerReconciliationLeaseExpiresAt: new Date('2026-07-21T07:58:00.000Z'),
    });
    const due = pendingJob({ id: 'job-due', providerJobId: 'provider-task-due' });
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([{ id: expired.id }])
      .mockResolvedValueOnce([{ id: due.id }]);
    const tx = {
      aiImageJob: {
        findUnique: vi.fn(async ({ where }: any) => (where.id === expired.id ? expired : due)),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      aiMediaWorkflowEvent: { createMany: vi.fn(async () => ({ count: 1 })) },
    };
    const repository = new PrismaAiProviderReconciliationRepository({
      aiImageJob: { findMany },
      $transaction: vi.fn(async (callback: any) => callback(tx)),
    } as never);

    const claims = await repository.claimDue({
      workerId: 'worker-a',
      now: NOW,
      limit: 1,
      leaseMs: 60_000,
    });

    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ jobId: 'job-expired', reconciliationAttemptCount: 2 });
    expect(findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ providerReconciliationStatus: 'RUNNING' }),
        orderBy: [{ providerReconciliationLeaseExpiresAt: 'asc' }, { id: 'asc' }],
      }),
    );
    expect(findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          providerReconciliationStatus: { in: ['PENDING', 'RETRY_WAIT'] },
        }),
      }),
    );
  });

  it('fences duplicate claims and persists only a hash of the random lease token', async () => {
    const row = pendingJob();
    const updateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const tx = {
      aiImageJob: {
        findUnique: vi.fn(async () => row),
        updateMany,
      },
      aiMediaWorkflowEvent: { createMany: vi.fn(async () => ({ count: 1 })) },
    };
    const client = {
      aiImageJob: { findMany: vi.fn(async () => [{ id: 'job-1' }]) },
      $transaction: vi.fn(async (callback: any) => callback(tx)),
    };
    const first = new PrismaAiProviderReconciliationRepository(client as never);
    const second = new PrismaAiProviderReconciliationRepository(client as never);

    const [winner, loser] = await Promise.all([
      first.claimDue({ workerId: 'worker-a', now: NOW, limit: 1, leaseMs: 60_000 }),
      second.claimDue({ workerId: 'worker-b', now: NOW, limit: 1, leaseMs: 60_000 }),
    ]);

    expect(winner).toHaveLength(1);
    expect(loser).toEqual([]);
    const leaseToken = winner[0]!.leaseToken;
    expect(leaseToken).toMatch(/^[0-9a-f-]{36}$/u);
    expect(updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'job-1',
          providerReconciliationStatus: 'PENDING',
          providerReconciliationRevision: 1,
        }),
        data: expect.objectContaining({
          providerReconciliationStatus: 'RUNNING',
          providerReconciliationRevision: 2,
          providerReconciliationAttemptCount: 1,
          providerReconciliationLeaseOwner: 'worker-a',
          providerReconciliationLeaseTokenHash: createHash('sha256')
            .update(leaseToken)
            .digest('hex'),
          providerReconciliationLeaseExpiresAt: new Date('2026-07-21T08:01:00.000Z'),
        }),
      }),
    );
    expect(JSON.stringify(updateMany.mock.calls)).not.toContain(leaseToken);
  });

  it('releases a claimed task to retry wait only with the exact lease fence', async () => {
    const leaseToken = '8c4b21aa-4c52-4a5d-a574-b9a46104267c';
    const tokenHash = createHash('sha256').update(leaseToken).digest('hex');
    const row = pendingJob({
      providerReconciliationStatus: 'RUNNING',
      providerReconciliationRevision: 2,
      providerReconciliationAttemptCount: 1,
      providerReconciliationLeaseOwner: 'worker-a',
      providerReconciliationLeaseTokenHash: tokenHash,
      providerReconciliationLeaseExpiresAt: new Date('2026-07-21T08:01:00.000Z'),
    });
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const eventCreate = vi.fn(async () => ({}));
    const tx = {
      aiImageJob: { findUnique: vi.fn(async () => row), updateMany },
      aiMediaWorkflowEvent: { createMany: eventCreate },
    };
    const repository = new PrismaAiProviderReconciliationRepository({
      $transaction: vi.fn(async (callback: any) => callback(tx)),
    } as never);
    const claim = {
      jobId: 'job-1',
      workflowId: 'workflow-1',
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      operation: 'IMAGE_TRANSLATE' as const,
      provider: 'fake',
      model: 'fake-image-translation-v1',
      estimatedCostCents: 0,
      providerJobId: 'provider-task-1',
      jobStatus: 'FAILED' as const,
      reconciliationStatus: 'RUNNING' as const,
      reconciliationRevision: 2,
      reconciliationAttemptCount: 1,
      deadlineAt: new Date('2026-07-22T08:00:00.000Z'),
      leaseToken,
    };

    await repository.defer({
      claim,
      nextAttemptAt: new Date('2026-07-21T08:00:30.000Z'),
      providerStatus: 'RUNNING',
      errorCode: 'PROVIDER_TIMEOUT',
      errorMessage: 'temporary timeout',
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'job-1',
        ownerUserId: 'owner-1',
        providerJobId: 'provider-task-1',
        providerReconciliationStatus: 'RUNNING',
        providerReconciliationRevision: 2,
        providerReconciliationLeaseTokenHash: tokenHash,
      },
      data: expect.objectContaining({
        providerReconciliationStatus: 'RETRY_WAIT',
        providerReconciliationRevision: 3,
        providerReconciliationNextAt: new Date('2026-07-21T08:00:30.000Z'),
        providerReconciliationLeaseOwner: null,
        providerReconciliationLeaseTokenHash: null,
        providerReconciliationLeaseExpiresAt: null,
        providerReconciliationLastProviderStatus: 'RUNNING',
        providerReconciliationLastErrorCode: 'PROVIDER_TIMEOUT',
      }),
    });
    expect(eventCreate).toHaveBeenCalledTimes(1);
    expect(eventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ jobId: 'job-1' })],
      }),
    );
  });

  it('fails closed when a stale lease tries to mutate the task', async () => {
    const updateMany = vi.fn(async () => ({ count: 0 }));
    const tx = {
      aiImageJob: { findUnique: vi.fn(async () => pendingJob()), updateMany },
      aiMediaWorkflowEvent: { createMany: vi.fn() },
    };
    const repository = new PrismaAiProviderReconciliationRepository({
      $transaction: vi.fn(async (callback: any) => callback(tx)),
    } as never);

    await expect(
      repository.markManualReview({
        claim: {
          jobId: 'job-1',
          workflowId: 'workflow-1',
          ownerUserId: 'owner-1',
          actorUserId: 'actor-1',
          operation: 'IMAGE_TRANSLATE',
          provider: 'fake',
          model: 'fake-image-translation-v1',
          estimatedCostCents: 0,
          providerJobId: 'provider-task-1',
          jobStatus: 'FAILED',
          reconciliationStatus: 'RUNNING',
          reconciliationRevision: 2,
          reconciliationAttemptCount: 1,
          deadlineAt: new Date('2026-07-22T08:00:00.000Z'),
          leaseToken: 'stale-token',
        },
        errorCode: 'PROVIDER_LOOKUP_UNSUPPORTED',
        errorMessage: 'unsupported',
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_RECONCILIATION_LEASE_LOST' });
  });

  it.each([0, 99])('atomically restores the same failed attempt at its frozen price despite amount %s', async reportedCost => {
    const leaseToken = '8c4b21aa-4c52-4a5d-a574-b9a46104267c';
    const fingerprint = 'a'.repeat(64);
    const job = pendingJob({
      provider: 'dashscope-qwen-mt-image', model: 'qwen-mt-image', estimatedCostCents: 12,
      status: 'FAILED',
      requestFingerprint: fingerprint,
      providerReconciliationStatus: 'RUNNING',
      providerReconciliationRevision: 2,
      providerReconciliationAttemptCount: 1,
      providerReconciliationLeaseTokenHash: createHash('sha256').update(leaseToken).digest('hex'),
      workflow: {
        id: 'workflow-1',
        ownerUserId: 'owner-1',
        currentAttempt: 1,
        inputs: [
          {
            assetId: 'source-1',
            role: 'REFERENCE',
            ordinal: 0,
            asset: { sourceCaptureSnapshotId: 'snapshot-1' },
          },
        ],
      },
    });
    const reservation = {
      id: 'cost-1',
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      jobId: 'job-1',
      requestFingerprint: fingerprint,
      status: 'RECONCILIATION_REQUIRED',
      maximumCostMinor: 20,
      providerRequestId: 'provider-task-1',
      updatedAt: new Date('2026-07-21T07:55:00.000Z'),
      settlements: [],
    };
    const assetCreate = vi.fn(async ({ data }: any) => ({ id: 'output-1', ...data }));
    const lineageCreate = vi.fn(async ({ data }: any) => ({ id: 'lineage-1', ...data }));
    const jobUpdate = vi.fn(async () => ({ count: 1 }));
    const workflowUpdate = vi.fn(async () => ({ count: 1 }));
    const settlementCreate = vi.fn(async ({ data }: any) => ({ id: 'settlement-1', ...data }));
    const costUpdate = vi.fn(async ({ data }: any) => {
      Object.assign(reservation, data);
      return { count: 1 };
    });
    const providerEventCreate = vi.fn(async ({ data }: any) => ({
      id: 'provider-event-1',
      ...data,
    }));
    const tx = {
      aiImageJob: { findUnique: vi.fn(async () => job), updateMany: jobUpdate },
      mediaAsset: { create: assetCreate },
      mediaAssetLineage: { create: lineageCreate },
      aiMediaWorkflow: { updateMany: workflowUpdate },
      aiMediaWorkflowEvent: { createMany: vi.fn(async () => ({ count: 1 })) },
      aiProviderReconciliationEvent: { create: providerEventCreate },
      aiCostReservation: {
        findUnique: vi.fn(async () => reservation),
        updateMany: costUpdate,
      },
      aiCostSettlement: {
        findUnique: vi.fn(async () => null),
        create: settlementCreate,
      },
    };
    const repository = new PrismaAiProviderReconciliationRepository({
      $transaction: vi.fn(async (callback: any) => callback(tx)),
    } as never);

    await repository.completeRecovered({
      claim: {
        jobId: 'job-1',
        workflowId: 'workflow-1',
        ownerUserId: 'owner-1',
        actorUserId: 'actor-1',
        operation: 'IMAGE_TRANSLATE',
        provider: 'dashscope-qwen-mt-image',
        model: 'qwen-mt-image',
        estimatedCostCents: 12,
        providerJobId: 'provider-task-1',
        jobStatus: 'FAILED',
        reconciliationStatus: 'RUNNING',
        reconciliationRevision: 2,
        reconciliationAttemptCount: 1,
        deadlineAt: new Date('2026-07-22T08:00:00.000Z'),
        leaseToken,
      },
      providerStatus: 'SUCCEEDED',
      actualCostCents: reportedCost,
      asset: {
        ownerUserId: 'owner-1',
        jobId: 'job-1',
        url: 'https://cdn.example/output.png',
        storageBackend: 'oss',
        storageKey: 'ai/output.png',
        mimeType: 'image/png',
        sizeBytes: 68,
        sha256: 'b'.repeat(64),
      },
    });

    expect(assetCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ownerUserId: 'owner-1',
        aiImageJobId: 'job-1',
        kind: 'AI_GENERATED',
        sourceCaptureSnapshotId: 'snapshot-1',
        sha256: 'b'.repeat(64),
      }),
    });
    expect(lineageCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workflowId: 'workflow-1',
        jobId: 'job-1',
        inputAssetId: 'source-1',
        outputAssetId: 'output-1',
        operation: 'IMAGE_TRANSLATE',
      }),
    });
    expect(jobUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'job-1',
          status: 'FAILED',
          providerReconciliationLeaseTokenHash: expect.any(String),
        }),
        data: expect.objectContaining({
          status: 'SUCCEEDED',
          progress: 100,
          providerReconciliationStatus: 'RECOVERED',
          billedUnits: 1,
        }),
      }),
    );
    expect(workflowUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'workflow-1', currentAttempt: 1, status: 'FAILED' }),
        data: expect.objectContaining({ status: 'SUCCEEDED', reviewStatus: 'PENDING' }),
      }),
    );
    expect(settlementCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reservationId: 'cost-1',
        kind: 'RECONCILED_CHARGE',
        actualCostMinor: 12,
        billedUnits: 1,
        idempotencyKey: 'job-1:cost:provider-reconciliation:settle',
      }),
    });
    expect(costUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'SETTLED' }),
      }),
    );
    expect(providerEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        payload: expect.objectContaining({
          cost: expect.objectContaining({ reservationStatus: 'SETTLED' }),
        }),
      }),
    });
  });

  it.each([
    {
      costStatus: 'SETTLED',
      settlementKind: 'RECONCILED_CHARGE',
      projectedCost: 5,
      projectedUnits: 1,
    },
    {
      costStatus: 'RELEASED',
      settlementKind: 'RECONCILED_RELEASE',
      projectedCost: 0,
      projectedUnits: 0,
    },
  ])(
    'retains a cancelled Provider output while preserving a $costStatus cost decision',
    async ({ costStatus, settlementKind, projectedCost, projectedUnits }) => {
      const leaseToken = '8c4b21aa-4c52-4a5d-a574-b9a46104267c';
      const completedAt = new Date('2026-07-21T07:58:00.000Z');
      const job = pendingJob({
        status: 'CANCELLED',
        completedAt,
        providerReconciliationStatus: 'RUNNING',
        providerReconciliationRevision: 4,
        providerReconciliationAttemptCount: 2,
        providerReconciliationLeaseTokenHash: createHash('sha256').update(leaseToken).digest('hex'),
        actualCostCents: projectedCost,
        billedUnits: projectedUnits,
        workflow: {
          id: 'workflow-1',
          ownerUserId: 'owner-1',
          currentAttempt: 1,
          inputs: [
            {
              assetId: 'source-1',
              role: 'REFERENCE',
              ordinal: 0,
              asset: { sourceCaptureSnapshotId: 'snapshot-1' },
            },
          ],
        },
      });
      const jobUpdate = vi.fn(async () => ({ count: 1 }));
      const workflowUpdate = vi.fn();
      const assetCreate = vi.fn(async ({ data }: any) => ({ id: 'audit-output-1', ...data }));
      const tx = {
        aiImageJob: { findUnique: vi.fn(async () => job), updateMany: jobUpdate },
        mediaAsset: { create: assetCreate },
        mediaAssetLineage: { create: vi.fn(async () => ({})) },
        aiMediaWorkflow: { updateMany: workflowUpdate },
        aiMediaWorkflowEvent: { createMany: vi.fn(async () => ({ count: 1 })) },
        aiCostReservation: {
          findUnique: vi.fn(async () => ({
            status: costStatus,
            providerRequestId: 'provider-task-1',
            settlements: [
              {
                kind: settlementKind,
                actualCostMinor: projectedCost,
                billedUnits: projectedUnits,
              },
            ],
          })),
        },
      };
      const repository = new PrismaAiProviderReconciliationRepository({
        $transaction: vi.fn(async (callback: any) => callback(tx)),
      } as never);

      await repository.completeRecovered({
        claim: {
          jobId: 'job-1',
          workflowId: 'workflow-1',
          ownerUserId: 'owner-1',
          actorUserId: 'actor-1',
          operation: 'IMAGE_TRANSLATE',
          provider: 'fake',
          model: 'fake-image-translation-v1',
          estimatedCostCents: 0,
          providerJobId: 'provider-task-1',
          jobStatus: 'CANCELLED',
          reconciliationStatus: 'RUNNING',
          reconciliationRevision: 4,
          reconciliationAttemptCount: 2,
          deadlineAt: new Date('2026-07-22T08:00:00.000Z'),
          leaseToken,
        },
        providerStatus: 'SUCCEEDED',
        actualCostCents: 12,
        asset: {
          ownerUserId: 'owner-1',
          jobId: 'job-1',
          url: 'https://cdn.example/audit.png',
          storageBackend: 'oss',
          storageKey: 'ai/audit.png',
          mimeType: 'image/png',
          sizeBytes: 68,
          sha256: 'c'.repeat(64),
        },
      });

      expect(assetCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ kind: 'AI_PROVIDER_OUTPUT' }),
      });
      expect(jobUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'CANCELLED' }),
          data: expect.not.objectContaining({
            status: 'SUCCEEDED',
            completedAt: expect.anything(),
          }),
        }),
      );
      expect(jobUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            providerReconciliationStatus: 'CANCELLED_OUTPUT_RETAINED',
            actualCostCents: projectedCost,
            billedUnits: projectedUnits,
          }),
        }),
      );
      expect(workflowUpdate).not.toHaveBeenCalled();
    },
  );

  it('rejects a recovered result when the cost ledger names another Provider task', async () => {
    const leaseToken = '8c4b21aa-4c52-4a5d-a574-b9a46104267c';
    const job = pendingJob({
      status: 'FAILED',
      providerReconciliationStatus: 'RUNNING',
      providerReconciliationRevision: 2,
      providerReconciliationAttemptCount: 1,
      providerReconciliationLeaseTokenHash: createHash('sha256').update(leaseToken).digest('hex'),
      workflow: {
        id: 'workflow-1',
        ownerUserId: 'owner-1',
        currentAttempt: 1,
        inputs: [
          {
            assetId: 'source-1',
            role: 'REFERENCE',
            ordinal: 0,
            asset: { sourceCaptureSnapshotId: 'snapshot-1' },
          },
        ],
      },
    });
    const assetCreate = vi.fn();
    const tx = {
      aiImageJob: { findUnique: vi.fn(async () => job), updateMany: vi.fn() },
      mediaAsset: { create: assetCreate },
      mediaAssetLineage: { create: vi.fn() },
      aiCostReservation: {
        findUnique: vi.fn(async () => ({
          id: 'cost-1',
          ownerUserId: 'owner-1',
          actorUserId: 'actor-1',
          jobId: 'job-1',
          requestFingerprint: 'a'.repeat(64),
          status: 'RECONCILIATION_REQUIRED',
          providerRequestId: 'different-provider-task',
          settlements: [],
        })),
      },
    };
    const repository = new PrismaAiProviderReconciliationRepository({
      $transaction: vi.fn(async (callback: any) => callback(tx)),
    } as never);

    await expect(
      repository.completeRecovered({
        claim: {
          jobId: 'job-1',
          workflowId: 'workflow-1',
          ownerUserId: 'owner-1',
          actorUserId: 'actor-1',
          operation: 'IMAGE_TRANSLATE',
          provider: 'fake',
          model: 'fake-image-translation-v1',
          estimatedCostCents: 0,
          providerJobId: 'provider-task-1',
          jobStatus: 'FAILED',
          reconciliationStatus: 'RUNNING',
          reconciliationRevision: 2,
          reconciliationAttemptCount: 1,
          deadlineAt: new Date('2026-07-22T08:00:00.000Z'),
          leaseToken,
        },
        providerStatus: 'SUCCEEDED',
        actualCostCents: 12,
        asset: {
          ownerUserId: 'owner-1',
          jobId: 'job-1',
          url: 'https://cdn.example/output.png',
          storageBackend: 'oss',
          storageKey: 'ai/output.png',
          mimeType: 'image/png',
          sizeBytes: 68,
          sha256: 'd'.repeat(64),
        },
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_COST_TASK_ID_MISMATCH' });
    expect(assetCreate).not.toHaveBeenCalled();
  });
});
