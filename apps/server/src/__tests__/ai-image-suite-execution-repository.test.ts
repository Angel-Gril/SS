import { describe, expect, it, vi } from 'vitest';
import {
  PrismaAiImageSuiteExecutionRepository,
  PrismaAiImageSuiteGenerationCoordinator,
} from '../repositories/ai-image-suite-execution-repository.js';
import type { AiImageSuiteGenerationQueuePayload } from '../workers/ai-image-suite-generation.js';

const FINGERPRINT = 'a'.repeat(64);

function paidAttempt(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    ownerUserId: 'owner-1',
    actorUserId: 'actor-1',
    workflowId: 'workflow-1',
    workflowAttempt: 1,
    status: 'FAILED',
    provider: 'openai-images',
    model: 'gpt-image-1',
    operation: 'IMAGE_TO_IMAGE',
    requestFingerprint: FINGERPRINT,
    requestedImageCount: 1,
    estimatedCostCents: 9,
    actualCostCents: null,
    billedUnits: 0,
    providerDispatchedAt: null,
    providerJobId: null,
    providerReconciliationStatus: 'NOT_REQUIRED',
    providerReconciliationLeaseOwner: null,
    providerReconciliationLeaseTokenHash: null,
    providerReconciliationLeaseExpiresAt: null,
    providerReconciledAt: null,
    assets: [],
    costReservation: {
      id: 'reservation-1',
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      workflowId: 'workflow-1',
      jobId: 'job-1',
      requestFingerprint: FINGERPRINT,
      provider: 'openai-images',
      model: 'gpt-image-1',
      operation: 'IMAGE_TO_IMAGE',
      currency: 'USD',
      roundingMode: 'HALF_UP',
      estimatedCostMinor: 9,
      maximumCostMinor: 12,
      status: 'RELEASED',
      settlements: [],
    },
    ...overrides,
  };
}

function retryFixture(jobs: any[]) {
  const slot = {
    id: 'slot-2',
    suiteId: 'suite-1',
    ownerUserId: 'owner-1',
    ordinal: 0,
    slotKey: 'sku:sku-1:hero',
    status: 'FAILED',
    attempt: jobs.length,
    revision: 5,
    childWorkflowId: 'workflow-1',
    estimatedCostCents: 9,
    maximumCostCents: 12,
    childWorkflow: {
      id: 'workflow-1',
      ownerUserId: 'owner-1',
      currentAttempt: jobs.length,
      jobs,
    },
  };
  const suite = {
    id: 'suite-1',
    ownerUserId: 'owner-1',
    actorUserId: 'actor-1',
    status: 'FAILED',
    revision: 7,
    itemCount: 1,
    slots: [slot],
  };
  const tx = {
    aiMediaSuiteEvent: {
      findUnique: vi.fn(async () => null),
      findFirst: vi.fn(async () => ({ id: 'materialized-event' })),
    },
    aiMediaSuite: { findFirst: vi.fn(async () => suite) },
  };
  return {
    tx,
    prisma: {
      ...tx,
      $transaction: vi.fn(async (action: (value: any) => Promise<unknown>) => action(tx)),
    },
  };
}

const retryInput = {
  suiteId: 'suite-1',
  slotId: 'slot-2',
  ownerUserId: 'owner-1',
  actorUserId: 'actor-1',
  expectedSlotRevision: 5,
  operationKey: 'retry-operation-1',
};

function historicalEvidenceFixture(input: {
  reservationStatus?: 'RELEASED' | 'SETTLED';
  actualCostCents?: number | null;
  billedUnits?: number;
  providerJobId?: string | null;
  mutate?: (value: ReturnType<typeof paidAttempt> & { workflow: any }) => void;
} = {}) {
  const suite = {
    id: 'suite-1', ownerUserId: 'owner-1', actorUserId: 'actor-1',
    provider: 'openai-images', model: 'gpt-image-1',
  };
  const slot = {
    id: 'slot-1', suiteId: 'suite-1', ownerUserId: 'owner-1',
    childWorkflowId: 'workflow-1', attempt: 2, suite,
  };
  const workflow = {
    id: 'workflow-1', ownerUserId: 'owner-1', actorUserId: 'actor-1',
    operation: 'IMAGE_TO_IMAGE', currentAttempt: 2,
    requestFingerprint: FINGERPRINT, suiteSlot: slot,
  };
  const job = {
    ...paidAttempt({
      providerDispatchedAt: new Date('2026-07-24T01:00:00.000Z'),
      providerJobId: input.providerJobId === undefined ? 'provider-job-1' : input.providerJobId,
      actualCostCents: input.actualCostCents ?? null,
      billedUnits: input.billedUnits ?? 0,
      costReservation: {
        ...paidAttempt().costReservation,
        status: input.reservationStatus || 'RELEASED',
        settlements: input.reservationStatus === 'SETTLED'
          ? [{
            kind: 'CHARGE', requestFingerprint: FINGERPRINT,
            actualCostMinor: input.actualCostCents ?? 9,
            billedUnits: input.billedUnits ?? 1,
          }]
          : [],
      },
    }),
    workflow,
  };
  input.mutate?.(job);
  const events: any[] = [];
  const jobUpdates: any[] = [];
  const tx = {
    aiImageJob: {
      findFirst: vi.fn(async () => job),
      findUnique: vi.fn(async () => job),
      updateMany: vi.fn(async (args: any) => {
        jobUpdates.push(args);
        Object.assign(job, args.data, {
          providerReconciliationRevision:
            Number((job as any).providerReconciliationRevision || 0)
            + Number(args.data.providerReconciliationRevision?.increment || 0),
        });
        return { count: 1 };
      }),
    },
    aiMediaWorkflowEvent: {
      findUnique: vi.fn(async () => ({
        payload: { providerAcceptedAt: '2026-07-24T01:01:00.000Z' },
      })),
      createMany: vi.fn(async (args: any) => {
        events.push(...args.data);
        return { count: args.data.length };
      }),
    },
    aiMediaSuiteSlot: {
      findFirst: vi.fn(async () => { throw new Error('current-slot loader must not be used'); }),
      updateMany: vi.fn(),
    },
    aiMediaWorkflow: { updateMany: vi.fn() },
    aiMediaSuite: { updateMany: vi.fn() },
    aiCostSettlement: { findUnique: vi.fn(), create: vi.fn() },
    aiCostReservation: { findUnique: vi.fn(), updateMany: vi.fn() },
  };
  return {
    job,
    events,
    jobUpdates,
    tx,
    prisma: {
      ...tx,
      $transaction: vi.fn(async (action: (value: any) => Promise<unknown>) => action(tx)),
    },
  };
}

const historicalPayload: AiImageSuiteGenerationQueuePayload = {
  suiteId: 'suite-1',
  slotId: 'slot-1',
  workflowId: 'workflow-1',
  jobId: 'job-1',
  attempt: 1,
};

type EvidenceCoordinator = {
  recordProviderAccepted(
    payload: AiImageSuiteGenerationQueuePayload,
    providerJobId: string,
    acceptedAt: Date,
  ): Promise<void>;
  recordProviderResultEvidence(
    payload: AiImageSuiteGenerationQueuePayload,
    evidence: {
      providerJobId: string | null;
      actualCostCents: number;
      providerResultReceivedAt: Date;
    },
  ): Promise<void>;
  finish(
    payload: AiImageSuiteGenerationQueuePayload,
    outcome: 'FAILED' | 'CANCELLED',
    failure: Record<string, unknown>,
  ): Promise<unknown>;
};

function finishFixture() {
  const operations: string[] = [];
  const reservation = {
    ...paidAttempt().costReservation,
    status: 'RESERVED',
    settlements: [] as any[],
  };
  const job = {
    ...paidAttempt({
      status: 'RUNNING',
      providerDispatchedAt: new Date('2026-07-24T01:00:00.000Z'),
      providerJobId: 'provider-job-1',
      providerReconciliationStatus: 'NOT_REQUIRED',
      costReservation: reservation,
    }),
  };
  const suite: any = {
    id: 'suite-1', ownerUserId: 'owner-1', actorUserId: 'actor-1',
    provider: 'openai-images', model: 'gpt-image-1', status: 'RUNNING',
    revision: 6, itemCount: 1, concurrencyLimit: 1,
  };
  const workflow: any = {
    id: 'workflow-1', ownerUserId: 'owner-1', actorUserId: 'actor-1',
    currentAttempt: 1, status: 'RUNNING', jobs: [job], inputs: [],
  };
  const slot: any = {
    id: 'slot-1', suiteId: 'suite-1', ownerUserId: 'owner-1',
    ordinal: 0, slotKey: 'sku:sku-1:hero',
    childWorkflowId: 'workflow-1', status: 'RUNNING', attempt: 1, revision: 4,
    estimatedCostCents: 9, maximumCostCents: 12,
    executionClaimToken: null, executionLeaseExpiresAt: null,
    childWorkflow: workflow, suite,
  };
  suite.slots = [slot];
  const apply = (target: any, data: any) => {
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === 'object' && 'increment' in value) {
        target[key] = Number(target[key] || 0) + Number((value as any).increment);
      } else {
        target[key] = value;
      }
    }
  };
  const tx = {
    aiMediaSuiteSlot: {
      findFirst: vi.fn(async () => slot),
      updateMany: vi.fn(async (args: any) => {
        operations.push('slot-terminal');
        apply(slot, args.data);
        return { count: 1 };
      }),
    },
    aiMediaSuite: {
      findFirst: vi.fn(async () => suite),
      updateMany: vi.fn(async (args: any) => {
        operations.push('suite-terminal');
        apply(suite, args.data);
        return { count: 1 };
      }),
    },
    aiImageJob: {
      updateMany: vi.fn(async (args: any) => {
        operations.push(args.data.status ? 'job-terminal' : 'job-cost-evidence');
        apply(job, args.data);
        return { count: 1 };
      }),
    },
    aiMediaWorkflow: {
      updateMany: vi.fn(async (args: any) => {
        operations.push('workflow-terminal');
        apply(workflow, args.data);
        return { count: 1 };
      }),
    },
    aiMediaWorkflowEvent: {
      findUnique: vi.fn(async (): Promise<{
        payload: { providerAcceptedAt: string };
      } | null> => ({
        payload: { providerAcceptedAt: '2026-07-24T01:01:00.000Z' },
      })),
      createMany: vi.fn(async (args: any) => {
        operations.push(`event:${args.data[0].eventType}`);
        return { count: args.data.length };
      }),
    },
    aiMediaSuiteEvent: { create: vi.fn(async () => ({})) },
    aiCostReservation: {
      findUnique: vi.fn(async () => reservation),
      updateMany: vi.fn(async (args: any) => {
        operations.push(`reservation:${args.data.status}`);
        apply(reservation, args.data);
        return { count: 1 };
      }),
    },
    aiCostSettlement: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async (args: any) => {
        operations.push(`settlement:${args.data.kind}`);
        const row = { id: 'settlement-1', ...args.data };
        reservation.settlements.push(row);
        return row;
      }),
    },
  };
  return {
    operations,
    reservation,
    job,
    tx,
    prisma: {
      ...tx,
      $transaction: vi.fn(async (action: (value: any) => Promise<unknown>) => action(tx)),
    },
  };
}

describe('AI image suite execution repository paid safety', () => {
  it.each([
    ['non-zero actual cost', { actualCostCents: 9 }],
    ['billed unit', { billedUnits: 1 }],
    ['persisted asset', { assets: [{ id: 'raw-1' }] }],
    ['reconciliation lease owner', { providerReconciliationLeaseOwner: 'worker-1' }],
    ['reconciliation lease token', { providerReconciliationLeaseTokenHash: 'b'.repeat(64) }],
    ['reconciliation lease expiry', { providerReconciliationLeaseExpiresAt: new Date() }],
    ['dispatch under NOT_REQUIRED authority', {
      providerDispatchedAt: new Date('2026-07-24T01:00:00.000Z'),
    }],
    ['Provider ID under NOT_REQUIRED authority', { providerJobId: 'provider-job-1' }],
    ['terminal authority without reconciliation time', {
      providerReconciliationStatus: 'NO_OUTPUT', providerReconciledAt: null,
    }],
  ])('blocks paid retry with %s', async (_label, unsafe) => {
    const fixture = retryFixture([paidAttempt(unsafe)]);
    const repository = new PrismaAiImageSuiteExecutionRepository(fixture.prisma as never);

    await expect(repository.retryFailedSlot(retryInput)).resolves.toEqual({
      kind: 'retry-not-allowed',
    });
  });

  it('scans every historical paid attempt for unresolved Provider authority', async () => {
    const first = paidAttempt({
      id: 'job-1', workflowAttempt: 1,
      providerDispatchedAt: new Date('2026-07-24T01:00:00.000Z'),
    });
    const second = paidAttempt({
      id: 'job-2', workflowAttempt: 2,
      costReservation: { ...paidAttempt().costReservation, id: 'reservation-2', jobId: 'job-2' },
    });
    const fixture = retryFixture([first, second]);
    const repository = new PrismaAiImageSuiteExecutionRepository(fixture.prisma as never);

    await expect(repository.retryFailedSlot(retryInput)).resolves.toEqual({
      kind: 'retry-not-allowed',
    });
  });

  it.each(['NOT_SUBMITTED', 'NO_OUTPUT'] as const)(
    'accepts reconciled %s authority and reaches the paid controls gate',
    async (providerReconciliationStatus) => {
      const fixture = retryFixture([paidAttempt({
        providerDispatchedAt: new Date('2026-07-24T01:00:00.000Z'),
        providerReconciliationStatus,
        providerReconciledAt: new Date('2026-07-24T01:01:00.000Z'),
      })]);
      const repository = new PrismaAiImageSuiteExecutionRepository(fixture.prisma as never);

      await expect(repository.retryFailedSlot(retryInput)).resolves.toEqual({
        kind: 'cost-controls-unavailable',
        reason: 'Paid AI image suite cost controls are not configured',
      });
    },
  );

  it('records a RELEASED late-result conflict on the historical job, then throws explicitly', async () => {
    const fixture = historicalEvidenceFixture();
    const coordinator = new PrismaAiImageSuiteGenerationCoordinator(
      fixture.prisma as never,
    ) as unknown as EvidenceCoordinator;

    await expect(coordinator.recordProviderResultEvidence(historicalPayload, {
      providerJobId: 'provider-job-1',
      actualCostCents: 9,
      providerResultReceivedAt: new Date('2026-07-24T01:02:00.000Z'),
    })).rejects.toMatchObject({ code: 'PROVIDER_RESULT_AFTER_COST_RELEASE_CONFLICT' });

    expect(fixture.job).toMatchObject({
      actualCostCents: null,
      billedUnits: 0,
      providerReconciliationStatus: 'MANUAL_REVIEW',
    });
    expect(fixture.events).toEqual([
      expect.objectContaining({
        workflowId: 'workflow-1',
        jobId: 'job-1',
        eventKey: 'workflow-1:PROVIDER_RESULT_COST_CONFLICT:job-1:1',
        eventType: 'PROVIDER_RESULT_COST_CONFLICT',
      }),
    ]);
    expect(fixture.tx.aiCostReservation.updateMany).not.toHaveBeenCalled();
    expect(fixture.tx.aiCostSettlement.create).not.toHaveBeenCalled();
    expect(fixture.tx.aiMediaSuiteSlot.updateMany).not.toHaveBeenCalled();
    expect(fixture.tx.aiMediaWorkflow.updateMany).not.toHaveBeenCalled();
    expect(fixture.tx.aiMediaSuite.updateMany).not.toHaveBeenCalled();
  });

  it('treats matching SETTLED historical result evidence as idempotent', async () => {
    const fixture = historicalEvidenceFixture({
      reservationStatus: 'SETTLED', actualCostCents: 9, billedUnits: 1,
    });
    const coordinator = new PrismaAiImageSuiteGenerationCoordinator(
      fixture.prisma as never,
    ) as unknown as EvidenceCoordinator;

    await expect(coordinator.recordProviderResultEvidence(historicalPayload, {
      providerJobId: 'provider-job-1',
      actualCostCents: 9,
      providerResultReceivedAt: new Date('2026-07-24T01:02:00.000Z'),
    })).resolves.toBeUndefined();
    expect(fixture.jobUpdates).toHaveLength(0);
    expect(fixture.events).toEqual([
      expect.objectContaining({
        eventType: 'PROVIDER_RESULT_RECEIVED',
        jobId: 'job-1',
      }),
    ]);
    expect(fixture.tx.aiImageJob.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'job-1',
        workflowId: 'workflow-1',
        workflowAttempt: 1,
      },
    }));
  });

  it.each([
    ['owner', (job: any) => { job.workflow.ownerUserId = 'other-owner'; }],
    ['suite', (job: any) => { job.workflow.suiteSlot.suite.id = 'other-suite'; }],
    ['slot attempt', (job: any) => { job.workflow.suiteSlot.attempt = 0; }],
    ['provider', (job: any) => { job.costReservation.provider = 'other-provider'; }],
    ['model', (job: any) => { job.model = 'other-model'; }],
    ['fingerprint', (job: any) => { job.workflow.requestFingerprint = 'b'.repeat(64); }],
  ])('rejects a forged historical %s graph before any mutation', async (_label, mutate) => {
    const fixture = historicalEvidenceFixture({
      mutate,
    });
    const coordinator = new PrismaAiImageSuiteGenerationCoordinator(
      fixture.prisma as never,
    ) as unknown as EvidenceCoordinator;

    await expect(coordinator.recordProviderAccepted(
      historicalPayload,
      'provider-job-1',
      new Date('2026-07-24T01:01:00.000Z'),
    )).rejects.toMatchObject({ code: 'PROVIDER_JOB_ID_PERSISTENCE_CONFLICT' });
    expect(fixture.jobUpdates).toHaveLength(0);
    expect(fixture.events).toHaveLength(0);
    expect(fixture.tx.aiMediaSuiteSlot.findFirst).not.toHaveBeenCalled();
  });

  it('binds late Provider identity only to its historical attempt', async () => {
    const fixture = historicalEvidenceFixture({ providerJobId: null });
    const coordinator = new PrismaAiImageSuiteGenerationCoordinator(
      fixture.prisma as never,
    ) as unknown as EvidenceCoordinator;

    await coordinator.recordProviderAccepted(
      historicalPayload,
      'provider-job-1',
      new Date('2026-07-24T01:01:00.000Z'),
    );

    expect(fixture.job).toMatchObject({
      id: 'job-1',
      providerJobId: 'provider-job-1',
      providerReconciliationStatus: 'MANUAL_REVIEW',
    });
    expect(fixture.events).toEqual([
      expect.objectContaining({
        workflowId: 'workflow-1',
        jobId: 'job-1',
        eventKey: 'workflow-1:PROVIDER_SUBMITTED:job-1:1',
      }),
    ]);
    expect(fixture.tx.aiMediaSuiteSlot.updateMany).not.toHaveBeenCalled();
    expect(fixture.tx.aiMediaWorkflow.updateMany).not.toHaveBeenCalled();
    expect(fixture.tx.aiMediaSuite.updateMany).not.toHaveBeenCalled();
  });

  it('persists definite rejection as reconciled NOT_SUBMITTED authority', async () => {
    const fixture = finishFixture();
    fixture.job.providerJobId = null;
    const coordinator = new PrismaAiImageSuiteGenerationCoordinator(
      fixture.prisma as never,
    ) as unknown as EvidenceCoordinator;

    await coordinator.finish(historicalPayload, 'FAILED', {
      code: 'PROVIDER_REQUEST_REJECTED',
      message: 'Provider rejected the request',
      providerSubmissionRejected: true,
    });

    expect(fixture.reservation.status).toBe('RELEASED');
    expect(fixture.job).toMatchObject({
      status: 'FAILED',
      actualCostCents: null,
      billedUnits: 0,
      providerReconciliationStatus: 'NOT_SUBMITTED',
      providerReconciliationLeaseOwner: null,
      providerReconciliationLeaseTokenHash: null,
      providerReconciliationLeaseExpiresAt: null,
    });
    expect(fixture.job.providerReconciledAt).toBeInstanceOf(Date);
  });

  it('persists transient result evidence before charging in finish', async () => {
    const fixture = finishFixture();
    const coordinator = new PrismaAiImageSuiteGenerationCoordinator(
      fixture.prisma as never,
    ) as unknown as EvidenceCoordinator;

    await coordinator.finish(historicalPayload, 'FAILED', {
      code: 'PROVIDER_POST_PROCESSING_FAILED',
      message: 'normalization failed after Provider result',
      providerResultReceived: true,
      providerJobId: 'provider-job-1',
      actualCostCents: 9,
      providerResultReceivedAt: new Date('2026-07-24T01:02:00.000Z'),
    });

    expect(fixture.operations).toEqual(expect.arrayContaining([
      'job-cost-evidence',
      'event:PROVIDER_RESULT_RECEIVED',
      'settlement:CHARGE',
      'job-terminal',
    ]));
    expect(fixture.operations.indexOf('job-cost-evidence'))
      .toBeLessThan(fixture.operations.indexOf('event:PROVIDER_RESULT_RECEIVED'));
    expect(fixture.operations.indexOf('event:PROVIDER_RESULT_RECEIVED'))
      .toBeLessThan(fixture.operations.indexOf('settlement:CHARGE'));
    expect(fixture.job).toMatchObject({ actualCostCents: 9, billedUnits: 1 });
  });

  it('does not charge transient result claims without a valid received-at timestamp', async () => {
    const fixture = finishFixture();
    const coordinator = new PrismaAiImageSuiteGenerationCoordinator(
      fixture.prisma as never,
    ) as unknown as EvidenceCoordinator;

    await coordinator.finish(historicalPayload, 'FAILED', {
      code: 'PROVIDER_POST_PROCESSING_FAILED',
      message: 'missing durable Provider result timestamp',
      providerResultReceived: true,
      providerJobId: 'provider-job-1',
      actualCostCents: 9,
    });

    expect(fixture.operations).not.toContain('settlement:CHARGE');
    expect(fixture.operations).not.toContain('event:PROVIDER_RESULT_RECEIVED');
    expect(fixture.job).toMatchObject({ actualCostCents: null, billedUnits: 0 });
    expect(fixture.reservation.status).toBe('RECONCILIATION_REQUIRED');
  });

  it('does not substitute the pre-dispatch marker for missing Provider acceptance evidence', async () => {
    const fixture = finishFixture();
    fixture.tx.aiMediaWorkflowEvent.findUnique.mockResolvedValueOnce(null);
    const coordinator = new PrismaAiImageSuiteGenerationCoordinator(
      fixture.prisma as never,
    ) as unknown as EvidenceCoordinator;

    await expect(coordinator.finish(historicalPayload, 'FAILED', {
      code: 'PROVIDER_TIMEOUT',
      message: 'accepted Provider identity has no durable acceptance timestamp',
      providerJobId: 'provider-job-1',
    })).rejects.toMatchObject({ code: 'PROVIDER_ACCEPTANCE_EVIDENCE_MISSING' });

    expect(fixture.operations).toEqual([]);
    expect(fixture.reservation.status).toBe('RESERVED');
    expect(fixture.job.status).toBe('RUNNING');
  });
});
