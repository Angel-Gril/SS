import { describe, expect, it, vi } from 'vitest';
import { PrismaAiImageJobRepository } from '../repositories/ai-image-job-repository.js';

describe('AI image workflow child terminal transitions', () => {
  function costLedger(
    status: 'RESERVED' | 'SUBMISSION_UNCERTAIN' | 'RECONCILIATION_REQUIRED' | 'SETTLED' | 'RELEASED' = 'RESERVED',
  ) {
    const reservation = {
      id: 'reservation-1', ownerUserId: 'owner-1', actorUserId: 'actor-1', jobId: 'job-1',
      requestFingerprint: 'f'.repeat(64), maximumCostMinor: 20, status,
      providerRequestId: null as string | null,
      providerAcceptedAt: null as Date | null,
    };
    const settlements: any[] = [];
    return {
      reservation,
      settlements,
      aiCostReservation: {
        findUnique: vi.fn(async () => reservation),
        updateMany: vi.fn(async ({ data }: any) => {
          Object.assign(reservation, data);
          return { count: 1 };
        }),
      },
      aiCostSettlement: {
        findUnique: vi.fn(async ({ where }: any) => {
          const key = where.ai_cost_settlement_reservation_idempotency;
          return settlements.find((row) => row.reservationId === key.reservationId
            && row.idempotencyKey === key.idempotencyKey) || null;
        }),
        create: vi.fn(async ({ data }: any) => {
          const settlement = { id: `settlement-${settlements.length + 1}`, ...data };
          settlements.push(settlement);
          return settlement;
        }),
      },
    };
  }

  it('rejects raw Provider assets passed through the shared completion interface', async () => {
    const transaction = vi.fn();
    const repository = new PrismaAiImageJobRepository({ $transaction: transaction } as never);

    await expect(repository.complete('job-1', {
      providerJobId: null,
      actualCostCents: 0,
      billedUnits: 1,
      assets: [{
        ownerUserId: 'owner-1', jobId: 'job-1', kind: 'AI_PROVIDER_OUTPUT',
        url: '/uploads/raw.png', storageBackend: 'local', storageKey: 'raw.png',
        mimeType: 'image/png', sizeBytes: 1, sha256: 'a'.repeat(64),
      }],
    })).rejects.toMatchObject({ code: 'INVALID_FINAL_OUTPUT' });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('recovers the exact raw-output winner after a concurrent unique-key race', async () => {
    const asset = {
      ownerUserId: 'owner-1', jobId: 'job-1', kind: 'AI_PROVIDER_OUTPUT' as const,
      url: '/uploads/raw.png', storageBackend: 'local', storageKey: 'raw.png',
      mimeType: 'image/png', sizeBytes: 10, width: 2, height: 2, sha256: 'a'.repeat(64),
    };
    const winner = {
      id: 'raw-winner-1', aiImageJobId: 'job-1', ...asset,
    };
    const repository = new PrismaAiImageJobRepository({
      $transaction: vi.fn(async () => {
        throw Object.assign(new Error('unique race'), { code: 'P2002' });
      }),
      mediaAsset: { findFirst: vi.fn(async () => winner) },
    } as never);

    await expect(repository.recordProviderOutput('job-1', asset)).resolves.toMatchObject({
      id: 'raw-winner-1', sha256: asset.sha256,
    });
  });

  it('loads frozen workflow inputs in ordinal order for provider execution', async () => {
    const findUnique = vi.fn(async () => null);
    await new PrismaAiImageJobRepository({ aiImageJob: { findUnique } } as never).getById('job-1');
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        workflow: {
          include: {
            inputs: expect.objectContaining({ orderBy: { ordinal: 'asc' } }),
            suiteSlot: { select: { suiteId: true, ownerUserId: true } },
          },
        },
      }),
    }));
  });

  it('persists the dispatch fence for legacy jobs without a parent workflow', async () => {
    const dispatchedAt = new Date('2026-07-17T08:00:00.000Z');
    const job = {
      id: 'job-1', ownerUserId: 'owner-1', actorUserId: 'actor-1', workflowId: null,
      attemptCount: 1, status: 'RUNNING', providerJobId: null,
      providerDispatchedAt: null as Date | null,
    };
    const tx = {
      aiImageJob: {
        findUnique: vi.fn(async () => job),
        updateMany: vi.fn(async ({ data }: any) => {
          job.providerDispatchedAt = data.providerDispatchedAt;
          return { count: 1 };
        }),
      },
    };
    const repository = new PrismaAiImageJobRepository({
      $transaction: vi.fn(async (callback: any) => callback(tx)),
    } as never);

    await expect(repository.recordProviderDispatchStarted('job-1', dispatchedAt)).resolves.toBe(true);
    expect(job.providerDispatchedAt).toEqual(dispatchedAt);
    expect(tx.aiImageJob.updateMany).toHaveBeenCalledWith({
      where: { id: 'job-1', status: 'RUNNING', providerJobId: null, providerDispatchedAt: null },
      data: { providerDispatchedAt: dispatchedAt },
    });
  });

  it('fails a legacy interrupted job normally when no dispatch fence was persisted', async () => {
    const job = {
      id: 'job-1', ownerUserId: 'owner-1', actorUserId: 'actor-1', workflowId: null,
      attemptCount: 1, operation: 'TEXT_TO_IMAGE', status: 'RUNNING', providerJobId: null,
      providerDispatchedAt: null,
    };
    const tx = {
      aiImageJob: {
        findUnique: vi.fn(async () => job),
        updateMany: vi.fn(async ({ data }: any) => {
          Object.assign(job, data);
          return { count: 1 };
        }),
      },
    };
    const repository = new PrismaAiImageJobRepository({
      $transaction: vi.fn(async (callback: any) => callback(tx)),
    } as never);

    await expect(repository.recoverInterruptedJob('job-1', {
      attemptCount: 2,
      errorCode: 'PROVIDER_SUBMISSION_UNCERTAIN',
      errorMessage: 'worker restarted',
    })).resolves.toBe('FAILED_PRE_DISPATCH');
    expect(job).toMatchObject({
      status: 'FAILED',
      errorCode: 'WORKER_INTERRUPTED_BEFORE_PROVIDER_DISPATCH',
    });
  });

  it('binds a late provider identity to a cancelled legacy job with a persisted dispatch fence', async () => {
    const providerAcceptedAt = new Date('2026-07-17T08:01:00.000Z');
    const job = {
      id: 'job-1', ownerUserId: 'owner-1', actorUserId: 'actor-1', workflowId: null,
      attemptCount: 1, status: 'CANCELLED', providerJobId: null as string | null,
      providerDispatchedAt: new Date('2026-07-17T08:00:00.000Z'),
    };
    const tx = {
      aiImageJob: {
        findUnique: vi.fn(async () => job),
        updateMany: vi.fn(async ({ data }: any) => {
          job.providerJobId = data.providerJobId;
          return { count: 1 };
        }),
      },
    };
    const repository = new PrismaAiImageJobRepository({
      $transaction: vi.fn(async (callback: any) => callback(tx)),
    } as never);

    await repository.recordProviderJobId('job-1', 'provider-late-legacy', providerAcceptedAt);

    expect(job.providerJobId).toBe('provider-late-legacy');
  });

  it('does not attach outputs or overwrite cancellation when completion loses the race', async () => {
    const job = {
      id: 'job-1', ownerUserId: 'owner-1', actorUserId: 'actor-1', workflowId: 'workflow-1',
      workflowAttempt: 1, attemptCount: 1, operation: 'IMAGE_TO_IMAGE', status: 'CANCEL_REQUESTED',
    };
    const tx = {
      aiImageJob: {
        findUnique: vi.fn(async () => job),
        updateMany: vi.fn(async ({ where, data }: any) => {
          if (where.status === 'CANCEL_REQUESTED') Object.assign(job, data);
          return { count: 1 };
        }),
      },
      aiMediaWorkflow: { updateMany: vi.fn(async () => ({ count: 1 })) },
      aiMediaWorkflowEvent: { create: vi.fn(async () => ({})) },
      mediaAsset: { create: vi.fn() },
    };
    const client = { $transaction: vi.fn(async (callback: any) => callback(tx)) };
    await new PrismaAiImageJobRepository(client as never).complete('job-1', {
      providerJobId: null, actualCostCents: 0, billedUnits: 1,
      assets: [{
        ownerUserId: 'owner-1', jobId: 'job-1', url: '/generated.png', storageBackend: 'local',
        storageKey: 'generated.png', mimeType: 'image/png', sizeBytes: 10, sha256: 'a'.repeat(64),
      }],
    });
    expect(job.status).toBe('CANCELLED');
    expect(tx.mediaAsset.create).not.toHaveBeenCalled();
    expect(tx.aiMediaWorkflow.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'CANCELLED' }),
    }));
  });

  it('preserves no-ID paid result evidence when legacy cancellation wins inside completion', async () => {
    const job = {
      id: 'job-1', ownerUserId: 'owner-1', actorUserId: 'actor-1', workflowId: null,
      workflowAttempt: null, attemptCount: 1, operation: 'TEXT_TO_IMAGE', status: 'CANCEL_REQUESTED',
      providerJobId: null, providerDispatchedAt: new Date('2026-07-17T08:00:00.000Z'),
      errorCode: null as string | null, errorMessage: null as string | null,
    };
    const tx = {
      aiImageJob: {
        findUnique: vi.fn(async () => job),
        updateMany: vi.fn(async ({ where, data }: any) => {
          if (where.status === 'CANCEL_REQUESTED') Object.assign(job, data);
          return { count: 1 };
        }),
      },
      mediaAsset: { create: vi.fn() },
    };
    const repository = new PrismaAiImageJobRepository({
      $transaction: vi.fn(async (callback: any) => callback(tx)),
    } as never);

    await repository.complete('job-1', {
      providerJobId: null,
      providerResultReceivedWithoutIdentity: true,
      actualCostCents: 8,
      billedUnits: 1,
      assets: [],
    });

    expect(job).toMatchObject({
      status: 'CANCELLED',
      errorCode: 'PROVIDER_SUBMISSION_UNCERTAIN',
    });
  });

  it('releases cost when cancellation races with a definite provider rejection', async () => {
    const job = {
      id: 'job-1', ownerUserId: 'owner-1', actorUserId: 'actor-1', workflowId: null,
      workflowAttempt: null, attemptCount: 1, operation: 'TEXT_TO_IMAGE', status: 'CANCEL_REQUESTED',
      providerJobId: null, providerDispatchedAt: new Date('2026-07-17T08:00:00.000Z'),
    };
    const cost = costLedger();
    const tx = {
      ...cost,
      aiImageJob: {
        findUnique: vi.fn(async () => job),
        updateMany: vi.fn(async ({ where, data }: any) => {
          if (where.status === 'CANCEL_REQUESTED') Object.assign(job, data);
          return { count: 1 };
        }),
      },
    };
    const repository = new PrismaAiImageJobRepository({
      $transaction: vi.fn(async (callback: any) => callback(tx)),
    } as never);

    await repository.markFailed('job-1', {
      attemptCount: 1,
      errorCode: 'PROVIDER_REQUEST_FAILED',
      errorMessage: 'Provider rejected the request',
      providerSubmissionRejected: true,
    });

    expect(cost.reservation.status).toBe('RELEASED');
    expect(cost.settlements).toEqual([
      expect.objectContaining({ kind: 'RELEASE', actualCostMinor: 0, billedUnits: 0 }),
    ]);
    expect(cost.settlements.some((row) => row.kind === 'SUBMISSION_UNCERTAIN')).toBe(false);
  });

  it('binds a final-result provider identity before cancellation finalization', async () => {
    const providerAcceptedAt = new Date('2026-07-17T05:00:00.000Z');
    const job = {
      id: 'job-1', ownerUserId: 'owner-1', actorUserId: 'actor-1', workflowId: 'workflow-1',
      workflowAttempt: 1, attemptCount: 1, operation: 'IMAGE_TO_IMAGE', status: 'CANCEL_REQUESTED',
      providerJobId: null as string | null,
    };
    const cost = costLedger();
    const tx = {
      ...cost,
      aiImageJob: {
        findUnique: vi.fn(async () => job),
        updateMany: vi.fn(async ({ where, data }: any) => {
          if (where.providerJobId === null) job.providerJobId = data.providerJobId;
          if (where.status === 'CANCEL_REQUESTED') job.status = data.status;
          return { count: 1 };
        }),
      },
      aiMediaWorkflow: { updateMany: vi.fn(async () => ({ count: 1 })) },
      aiMediaWorkflowEvent: {
        findUnique: vi.fn(async () => ({ createdAt: providerAcceptedAt })),
        create: vi.fn(async () => ({})),
      },
      mediaAsset: { create: vi.fn() },
    };
    const client = { $transaction: vi.fn(async (callback: any) => callback(tx)) };

    await new PrismaAiImageJobRepository(client as never).complete('job-1', {
      providerJobId: 'provider-final', actualCostCents: 8, billedUnits: 1,
      assets: [{
        ownerUserId: 'owner-1', jobId: 'job-1', url: '/late.png', storageBackend: 'local',
        storageKey: 'late.png', mimeType: 'image/png', sizeBytes: 10, sha256: 'a'.repeat(64),
      }],
    });

    expect(job).toMatchObject({ status: 'CANCELLED', providerJobId: 'provider-final' });
    expect(tx.aiMediaWorkflowEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      eventType: 'PROVIDER_SUBMITTED',
      payload: expect.objectContaining({
        providerJobId: 'provider-final', providerAcceptedAt: expect.any(String),
      }),
    }) });
    expect(cost.settlements).toEqual([expect.objectContaining({ kind: 'RECONCILIATION_REQUIRED' })]);
    expect(cost.settlements.some((settlement) => settlement.kind === 'RELEASE')).toBe(false);
    expect(cost.reservation).toMatchObject({
      status: 'RECONCILIATION_REQUIRED',
      providerRequestId: 'provider-final',
      providerAcceptedAt,
    });
    expect(tx.mediaAsset.create).not.toHaveBeenCalled();
  });

  it('persists an accepted provider task when cancellation wins the callback race', async () => {
    const job = {
      id: 'job-1', ownerUserId: 'owner-1', actorUserId: 'actor-1', workflowId: 'workflow-1',
      workflowAttempt: 1, attemptCount: 1, operation: 'IMAGE_TO_IMAGE', status: 'CANCEL_REQUESTED',
      providerJobId: null as string | null,
    };
    const tx = {
      aiImageJob: {
        findUnique: vi.fn(async () => job),
        updateMany: vi.fn(async () => {
          job.providerJobId = 'provider-task-1';
          return { count: 1 };
        }),
      },
      aiMediaWorkflowEvent: { create: vi.fn(async () => ({})) },
    };
    const client = { $transaction: vi.fn(async (callback: any) => callback(tx)) };

    await new PrismaAiImageJobRepository(client as never).recordProviderJobId('job-1', 'provider-task-1');

    expect(job.providerJobId).toBe('provider-task-1');
    expect(tx.aiImageJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { in: ['RUNNING', 'CANCEL_REQUESTED'] }, providerJobId: null }),
    }));
    expect(tx.aiMediaWorkflowEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      eventType: 'PROVIDER_SUBMITTED',
      payload: expect.objectContaining({
        providerJobId: 'provider-task-1', providerAcceptedAt: expect.any(String),
      }),
    }) });
  });

  it('upgrades a quarantined failed submission when its provider identity arrives late', async () => {
    const providerAcceptedAt = new Date('2026-07-17T07:00:00.123Z');
    const job = {
      id: 'job-1', ownerUserId: 'owner-1', actorUserId: 'actor-1', workflowId: 'workflow-1',
      workflowAttempt: 1, attemptCount: 2, operation: 'IMAGE_TO_IMAGE', status: 'FAILED',
      errorCode: 'PROVIDER_SUBMISSION_UNCERTAIN', errorMessage: null as string | null,
      providerJobId: null as string | null,
    };
    const cost = costLedger('SUBMISSION_UNCERTAIN');
    cost.settlements.push({
      id: 'settlement-1', reservationId: cost.reservation.id, kind: 'SUBMISSION_UNCERTAIN',
      idempotencyKey: 'job-1:cost:submission-uncertain',
      requestFingerprint: cost.reservation.requestFingerprint, actualCostMinor: null, billedUnits: 0,
    });
    const events = new Map<string, any>([[
      'workflow-1:PROVIDER_DISPATCH_STARTED:job-1:2',
      { eventType: 'PROVIDER_DISPATCH_STARTED', createdAt: new Date('2026-07-17T06:59:59.000Z') },
    ]]);
    const tx = {
      ...cost,
      aiImageJob: {
        findUnique: vi.fn(async () => job),
        updateMany: vi.fn(async ({ data }: any) => {
          Object.assign(job, data);
          return { count: 1 };
        }),
      },
      aiMediaWorkflow: { updateMany: vi.fn(async () => ({ count: 0 })) },
      aiMediaWorkflowEvent: {
        findUnique: vi.fn(async ({ where }: any) => events.get(where.eventKey) || null),
        create: vi.fn(async ({ data }: any) => {
          events.set(data.eventKey, { ...data, createdAt: new Date() });
          return data;
        }),
        createMany: vi.fn(async ({ data }: any) => {
          for (const event of data) events.set(event.eventKey, { ...event, createdAt: new Date() });
          return { count: data.length };
        }),
      },
    };
    const repository = new PrismaAiImageJobRepository({
      $transaction: vi.fn(async (callback: any) => callback(tx)),
    } as never);

    await repository.recordProviderJobId('job-1', 'provider-late-1', providerAcceptedAt);

    expect(job).toMatchObject({ status: 'FAILED', providerJobId: 'provider-late-1' });
    expect(events.get('workflow-1:PROVIDER_SUBMITTED:job-1:2')).toMatchObject({
      payload: { providerJobId: 'provider-late-1', providerAcceptedAt: providerAcceptedAt.toISOString() },
    });
    expect(cost.reservation).toMatchObject({
      status: 'RECONCILIATION_REQUIRED',
      providerRequestId: 'provider-late-1',
      providerAcceptedAt,
    });
    expect(cost.settlements.filter((row) => row.kind === 'RECONCILIATION_REQUIRED')).toHaveLength(1);
    expect(cost.settlements.some((row) => row.kind === 'RELEASE')).toBe(false);

    await repository.recordProviderJobId('job-1', 'provider-late-1', providerAcceptedAt);
    expect(cost.settlements.filter((row) => row.kind === 'RECONCILIATION_REQUIRED')).toHaveLength(1);
    expect(tx.aiMediaWorkflowEvent.create).toHaveBeenCalledTimes(1);
    await expect(repository.recordProviderJobId('job-1', 'provider-late-2', providerAcceptedAt))
      .rejects.toMatchObject({ code: 'PROVIDER_JOB_ID_MISMATCH' });
    expect(job).toMatchObject({
      status: 'FAILED',
      providerJobId: 'provider-late-1',
      errorCode: 'PROVIDER_JOB_ID_MISMATCH',
    });
    expect(job.errorMessage).toContain('provider-late-1');
    expect(job.errorMessage).toContain('provider-late-2');
    expect([...events.values()]).toContainEqual(expect.objectContaining({
      eventType: 'PROVIDER_JOB_ID_MISMATCH',
      payload: {
        persistedProviderJobId: 'provider-late-1',
        observedProviderJobId: 'provider-late-2',
      },
    }));
  });

  it('keeps cancellation terminal when an uncertain provider identity arrives late', async () => {
    const providerAcceptedAt = new Date('2026-07-17T07:15:00.456Z');
    const job = {
      id: 'job-1', ownerUserId: 'owner-1', actorUserId: 'actor-1', workflowId: 'workflow-1',
      workflowAttempt: 1, attemptCount: 3, operation: 'IMAGE_TO_IMAGE', status: 'CANCELLED',
      providerJobId: null as string | null,
    };
    const cost = costLedger('SUBMISSION_UNCERTAIN');
    cost.settlements.push({
      id: 'settlement-1', reservationId: cost.reservation.id, kind: 'SUBMISSION_UNCERTAIN',
      idempotencyKey: 'job-1:cost:submission-uncertain',
      requestFingerprint: cost.reservation.requestFingerprint, actualCostMinor: null, billedUnits: 0,
    });
    const events = new Map<string, any>([[
      'workflow-1:PROVIDER_DISPATCH_STARTED:job-1:3',
      { eventType: 'PROVIDER_DISPATCH_STARTED', createdAt: new Date('2026-07-17T07:14:59.000Z') },
    ]]);
    const tx = {
      ...cost,
      aiImageJob: {
        findUnique: vi.fn(async () => job),
        updateMany: vi.fn(async ({ data }: any) => {
          job.providerJobId = data.providerJobId;
          return { count: 1 };
        }),
      },
      aiMediaWorkflowEvent: {
        findUnique: vi.fn(async ({ where }: any) => events.get(where.eventKey) || null),
        create: vi.fn(async ({ data }: any) => {
          events.set(data.eventKey, { ...data, createdAt: new Date() });
          return data;
        }),
      },
    };
    const repository = new PrismaAiImageJobRepository({
      $transaction: vi.fn(async (callback: any) => callback(tx)),
    } as never);

    await repository.recordProviderJobId('job-1', 'provider-cancelled-1', providerAcceptedAt);

    expect(job).toMatchObject({ status: 'CANCELLED', providerJobId: 'provider-cancelled-1' });
    expect(cost.reservation).toMatchObject({
      status: 'RECONCILIATION_REQUIRED',
      providerRequestId: 'provider-cancelled-1',
      providerAcceptedAt,
    });
    expect(cost.settlements.filter((row) => row.kind === 'RECONCILIATION_REQUIRED')).toHaveLength(1);
    expect(cost.settlements.some((row) => row.kind === 'RELEASE')).toBe(false);
  });

  it('rejects a late provider identity after cancelled cost was definitively released', async () => {
    const job = {
      id: 'job-1', ownerUserId: 'owner-1', actorUserId: 'actor-1', workflowId: 'workflow-1',
      workflowAttempt: 1, attemptCount: 1, operation: 'IMAGE_TO_IMAGE', status: 'CANCELLED',
      providerJobId: null as string | null,
    };
    const cost = costLedger('RELEASED');
    const tx = {
      ...cost,
      aiImageJob: { findUnique: vi.fn(async () => job), updateMany: vi.fn() },
      aiMediaWorkflowEvent: {
        findUnique: vi.fn(async () => ({ eventType: 'PROVIDER_DISPATCH_STARTED' })),
        create: vi.fn(),
      },
    };
    const repository = new PrismaAiImageJobRepository({
      $transaction: vi.fn(async (callback: any) => callback(tx)),
    } as never);

    await expect(repository.recordProviderJobId('job-1', 'provider-too-late'))
      .rejects.toMatchObject({ code: 'PROVIDER_JOB_ID_PERSISTENCE_CONFLICT' });
    expect(job.providerJobId).toBeNull();
    expect(tx.aiImageJob.updateMany).not.toHaveBeenCalled();
    expect(tx.aiMediaWorkflowEvent.create).not.toHaveBeenCalled();
  });

  it('preserves a previously persisted provider task when completion omits it', async () => {
    const job = {
      id: 'job-1', ownerUserId: 'owner-1', actorUserId: 'actor-1', workflowId: null,
      workflowAttempt: null, attemptCount: 1, operation: 'IMAGE_TO_IMAGE', status: 'RUNNING',
      providerJobId: 'provider-task-1', errorCode: null as string | null, errorMessage: null as string | null,
    };
    const tx = {
      aiImageJob: {
        findUnique: vi.fn(async () => job),
        updateMany: vi.fn(async ({ data }: any) => {
          Object.assign(job, data);
          return { count: 1 };
        }),
      },
      mediaAsset: { create: vi.fn(async ({ data }: any) => ({ id: 'output-1', ...data })) },
    };
    const client = { $transaction: vi.fn(async (callback: any) => callback(tx)) };

    await new PrismaAiImageJobRepository(client as never).complete('job-1', {
      providerJobId: null, actualCostCents: 0, billedUnits: 1,
      assets: [{
        ownerUserId: 'owner-1', jobId: 'job-1', url: '/generated.png', storageBackend: 'local',
        storageKey: 'generated.png', mimeType: 'image/png', sizeBytes: 10, sha256: 'a'.repeat(64),
      }],
    });

    expect(job.providerJobId).toBe('provider-task-1');
    expect(job.status).toBe('SUCCEEDED');
  });

  it('quarantines a completion that conflicts with the persisted provider recovery identity', async () => {
    const job = {
      id: 'job-1', ownerUserId: 'owner-1', actorUserId: 'actor-1', workflowId: null,
      workflowAttempt: null, attemptCount: 1, operation: 'IMAGE_TO_IMAGE', status: 'RUNNING',
      providerJobId: 'provider-task-1', errorCode: null as string | null, errorMessage: null as string | null,
    };
    const tx = {
      aiImageJob: {
        findUnique: vi.fn(async () => job),
        updateMany: vi.fn(async ({ data }: any) => {
          Object.assign(job, data);
          return { count: 1 };
        }),
      },
      mediaAsset: { create: vi.fn() },
    };
    const client = { $transaction: vi.fn(async (callback: any) => callback(tx)) };

    await expect(new PrismaAiImageJobRepository(client as never).complete('job-1', {
      providerJobId: 'provider-task-2', actualCostCents: 0, billedUnits: 1, assets: [],
    })).rejects.toMatchObject({ code: 'PROVIDER_JOB_ID_MISMATCH' });
    expect(job).toMatchObject({
      status: 'FAILED',
      providerJobId: 'provider-task-1',
      errorCode: 'PROVIDER_JOB_ID_MISMATCH',
    });
    expect(job.errorMessage).toContain('provider-task-1');
    expect(job.errorMessage).toContain('provider-task-2');
    expect(tx.mediaAsset.create).not.toHaveBeenCalled();
  });

  it('settles an existing reservation atomically with successful completion', async () => {
    const job = {
      id: 'job-1', ownerUserId: 'owner-1', actorUserId: 'actor-1', workflowId: null,
      workflowAttempt: null, attemptCount: 1, operation: 'IMAGE_TO_IMAGE', status: 'RUNNING',
      providerJobId: 'provider-task-1',
    };
    const cost = costLedger();
    const tx = {
      ...cost,
      aiImageJob: {
        findUnique: vi.fn(async () => job),
        updateMany: vi.fn(async ({ data }: any) => { Object.assign(job, data); return { count: 1 }; }),
      },
      mediaAsset: { create: vi.fn(async ({ data }: any) => ({ id: 'output-1', ...data })) },
    };
    const client = { $transaction: vi.fn(async (callback: any) => callback(tx)) };

    await new PrismaAiImageJobRepository(client as never).complete('job-1', {
      providerJobId: 'provider-task-1', actualCostCents: 7, billedUnits: 1,
      assets: [{
        ownerUserId: 'owner-1', jobId: 'job-1', url: '/generated.png', storageBackend: 'local',
        storageKey: 'generated.png', mimeType: 'image/png', sizeBytes: 10, sha256: 'a'.repeat(64),
      }],
    });

    expect(cost.settlements).toEqual([expect.objectContaining({
      kind: 'CHARGE', actualCostMinor: 7, billedUnits: 1, idempotencyKey: 'job-1:cost:settle',
    })]);
    expect(cost.reservation.status).toBe('SETTLED');
    expect(job.status).toBe('SUCCEEDED');
  });

  it('releases a reservation when a job fails before provider acceptance', async () => {
    const job = {
      id: 'job-1', ownerUserId: 'owner-1', actorUserId: 'actor-1', workflowId: null,
      attemptCount: 1, operation: 'IMAGE_TO_IMAGE', status: 'RUNNING', providerJobId: null,
    };
    const cost = costLedger();
    const tx = {
      ...cost,
      aiImageJob: { findUnique: vi.fn(async () => job), updateMany: vi.fn(async () => ({ count: 1 })) },
    };
    const client = { $transaction: vi.fn(async (callback: any) => callback(tx)) };

    await new PrismaAiImageJobRepository(client as never).markFailed('job-1', {
      attemptCount: 1, errorCode: 'PROVIDER_ERROR', errorMessage: 'failed before acceptance',
    });

    expect(cost.settlements).toEqual([expect.objectContaining({
      kind: 'RELEASE', actualCostMinor: 0, billedUnits: 0, idempotencyKey: 'job-1:cost:release',
    })]);
    expect(cost.reservation.status).toBe('RELEASED');
  });

  it('keeps an accepted failed job in reconciliation with its provider identity', async () => {
    const providerAcceptedAt = new Date('2026-07-17T05:30:00.000Z');
    const job = {
      id: 'job-1', ownerUserId: 'owner-1', actorUserId: 'actor-1', workflowId: 'workflow-1',
      workflowAttempt: 1,
      attemptCount: 1, operation: 'IMAGE_TO_IMAGE', status: 'RUNNING', providerJobId: 'provider-task-1',
    };
    const cost = costLedger();
    const tx = {
      ...cost,
      aiImageJob: { findUnique: vi.fn(async () => job), updateMany: vi.fn(async () => ({ count: 1 })) },
      aiMediaWorkflow: { updateMany: vi.fn(async () => ({ count: 1 })) },
      aiMediaWorkflowEvent: {
        findUnique: vi.fn(async () => ({ createdAt: providerAcceptedAt })),
        create: vi.fn(async () => ({})),
      },
    };
    const client = { $transaction: vi.fn(async (callback: any) => callback(tx)) };

    await new PrismaAiImageJobRepository(client as never).markFailed('job-1', {
      attemptCount: 1, errorCode: 'PROVIDER_ERROR', errorMessage: 'result unknown',
    });

    expect(cost.settlements).toEqual([expect.objectContaining({
      kind: 'RECONCILIATION_REQUIRED', actualCostMinor: null, billedUnits: 0,
      idempotencyKey: 'job-1:cost:unknown',
    })]);
    expect(cost.settlements.some((settlement) => settlement.kind === 'RELEASE')).toBe(false);
    expect(cost.reservation).toMatchObject({
      status: 'RECONCILIATION_REQUIRED', providerRequestId: 'provider-task-1',
    });
    expect(cost.reservation.providerAcceptedAt).toEqual(providerAcceptedAt);
  });

  it('binds provider acceptance metadata before terminal failure and excludes it from the job update', async () => {
    const providerAcceptedAt = new Date('2026-07-17T06:00:00.000Z');
    const job = {
      id: 'job-1', ownerUserId: 'owner-1', actorUserId: 'actor-1', workflowId: 'workflow-1',
      workflowAttempt: 1, attemptCount: 1, operation: 'IMAGE_TO_IMAGE', status: 'RUNNING',
      providerJobId: null as string | null,
    };
    const cost = costLedger();
    const updates: any[] = [];
    const tx = {
      ...cost,
      aiImageJob: {
        findUnique: vi.fn(async () => job),
        updateMany: vi.fn(async ({ where, data }: any) => {
          updates.push(data);
          if (where.providerJobId === null) job.providerJobId = data.providerJobId;
          if (data.status === 'FAILED') job.status = data.status;
          return { count: 1 };
        }),
      },
      aiMediaWorkflow: { updateMany: vi.fn(async () => ({ count: 1 })) },
      aiMediaWorkflowEvent: {
        findUnique: vi.fn(async () => ({ createdAt: providerAcceptedAt })),
        create: vi.fn(async () => ({})),
      },
    };
    const client = { $transaction: vi.fn(async (callback: any) => callback(tx)) };

    await new PrismaAiImageJobRepository(client as never).markFailed('job-1', {
      attemptCount: 1,
      errorCode: 'PROVIDER_ACCEPTED_PERSISTENCE_FAILED',
      errorMessage: 'database unavailable',
      providerJobId: 'provider-task-1',
      providerAcceptedAt,
    });

    expect(job).toMatchObject({ status: 'FAILED', providerJobId: 'provider-task-1' });
    expect(cost.reservation).toMatchObject({
      status: 'RECONCILIATION_REQUIRED', providerRequestId: 'provider-task-1', providerAcceptedAt,
    });
    const failureUpdate = updates.find((data) => data.status === 'FAILED');
    expect(failureUpdate).not.toHaveProperty('providerJobId');
    expect(failureUpdate).not.toHaveProperty('providerAcceptedAt');
  });

  it('rejects reconciliation when persisted provider acceptance has no timestamp evidence', async () => {
    const job = {
      id: 'job-1', ownerUserId: 'owner-1', actorUserId: 'actor-1', workflowId: 'workflow-1',
      workflowAttempt: 1, attemptCount: 1, operation: 'IMAGE_TO_IMAGE', status: 'RUNNING',
      providerJobId: 'provider-task-1',
    };
    const cost = costLedger();
    const tx = {
      ...cost,
      aiImageJob: { findUnique: vi.fn(async () => job), updateMany: vi.fn(async () => ({ count: 1 })) },
      aiMediaWorkflowEvent: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async () => ({})),
      },
    };
    const client = { $transaction: vi.fn(async (callback: any) => callback(tx)) };

    await expect(new PrismaAiImageJobRepository(client as never).markFailed('job-1', {
      attemptCount: 1, errorCode: 'PROVIDER_RECOVERY_REQUIRED', errorMessage: 'worker interrupted',
    })).rejects.toMatchObject({ code: 'PROVIDER_ACCEPTANCE_EVIDENCE_MISSING' });
    expect(cost.settlements).toHaveLength(0);
    expect(cost.reservation.status).toBe('RESERVED');
  });

  it('uses the same release-versus-reconciliation rule when cancellation becomes terminal', async () => {
    for (const providerJobId of [null, 'provider-task-1']) {
      const providerAcceptedAt = new Date('2026-07-17T06:30:00.000Z');
      const job = {
        id: 'job-1', ownerUserId: 'owner-1', actorUserId: 'actor-1',
        workflowId: providerJobId ? 'workflow-1' : null, workflowAttempt: providerJobId ? 1 : null,
        attemptCount: 1, operation: 'IMAGE_TO_IMAGE', status: 'CANCEL_REQUESTED', providerJobId,
      };
      const cost = costLedger();
      const tx = {
        ...cost,
        aiImageJob: { findUnique: vi.fn(async () => job), updateMany: vi.fn(async () => ({ count: 1 })) },
        aiMediaWorkflow: { updateMany: vi.fn(async () => ({ count: 1 })) },
        aiMediaWorkflowEvent: {
          findUnique: vi.fn(async () => providerJobId ? ({ createdAt: providerAcceptedAt }) : null),
          create: vi.fn(async () => ({})),
        },
      };
      const client = { $transaction: vi.fn(async (callback: any) => callback(tx)) };

      await new PrismaAiImageJobRepository(client as never).markCancelled('job-1');

      expect(cost.settlements[0]?.kind).toBe(providerJobId ? 'RECONCILIATION_REQUIRED' : 'RELEASE');
      expect(cost.reservation.status).toBe(providerJobId ? 'RECONCILIATION_REQUIRED' : 'RELEASED');
      if (providerJobId) {
        expect(cost.reservation.providerRequestId).toBe(providerJobId);
        expect(cost.reservation.providerAcceptedAt).toEqual(providerAcceptedAt);
      }
    }
  });

  it('attributes cancellation cost settlement to the actual cancelling actor', async () => {
    const job = {
      id: 'job-1', ownerUserId: 'owner-1', actorUserId: 'creator-1', workflowId: 'workflow-1',
      workflowAttempt: 1, attemptCount: 0, operation: 'IMAGE_TO_IMAGE',
      status: 'CANCEL_REQUESTED', providerJobId: null,
    };
    const cost = costLedger();
    const tx = {
      ...cost,
      aiImageJob: { findUnique: vi.fn(async () => job), updateMany: vi.fn(async () => ({ count: 1 })) },
      aiMediaWorkflow: { updateMany: vi.fn(async () => ({ count: 1 })) },
      aiMediaWorkflowEvent: {
        findFirst: vi.fn(async () => ({ actorUserId: 'canceller-1' })),
        findUnique: vi.fn(async () => null),
        create: vi.fn(async () => ({})),
      },
    };
    const client = { $transaction: vi.fn(async (callback: any) => callback(tx)) };

    await new PrismaAiImageJobRepository(client as never).markCancelled('job-1');

    expect(cost.settlements).toEqual([
      expect.objectContaining({ kind: 'RELEASE', actorUserId: 'canceller-1' }),
    ]);
    expect(tx.aiMediaWorkflowEvent.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ eventType: 'CANCEL_REQUESTED', jobId: 'job-1' }),
    }));
  });

  it('quarantines a legacy paid cancellation when a synchronous result has no provider ID', async () => {
    const job = {
      id: 'job-1', ownerUserId: 'owner-1', actorUserId: 'actor-1', workflowId: null,
      workflowAttempt: null, attemptCount: 1, operation: 'TEXT_TO_IMAGE',
      status: 'CANCEL_REQUESTED', providerJobId: null,
    };
    const cost = costLedger();
    const tx = {
      ...cost,
      aiImageJob: { findUnique: vi.fn(async () => job), updateMany: vi.fn(async () => ({ count: 1 })) },
    };
    const client = { $transaction: vi.fn(async (callback: any) => callback(tx)) };

    await new PrismaAiImageJobRepository(client as never).markCancelled('job-1', {
      providerSubmissionUncertain: true,
    });

    expect(cost.settlements).toEqual([
      expect.objectContaining({ kind: 'SUBMISSION_UNCERTAIN', actualCostMinor: null }),
    ]);
    expect(cost.reservation.status).toBe('SUBMISSION_UNCERTAIN');
  });

  it('replays the same release when a directly-cancelled queued job is observed again', async () => {
    const job = {
      id: 'job-1', ownerUserId: 'owner-1', actorUserId: 'actor-1', workflowId: null,
      attemptCount: 0, operation: 'IMAGE_TO_IMAGE', status: 'CANCELLED', providerJobId: null,
    };
    const cost = costLedger();
    cost.reservation.status = 'RELEASED';
    cost.settlements.push({
      id: 'settlement-1', reservationId: cost.reservation.id,
      kind: 'RELEASE', idempotencyKey: 'job-1:cost:release',
      requestFingerprint: cost.reservation.requestFingerprint,
      actualCostMinor: 0, billedUnits: 0,
    });
    const tx = {
      ...cost,
      aiImageJob: { findUnique: vi.fn(async () => job), updateMany: vi.fn() },
    };
    const client = { $transaction: vi.fn(async (callback: any) => callback(tx)) };
    await expect(new PrismaAiImageJobRepository(client as never).markCancelled('job-1'))
      .resolves.toBeUndefined();
    expect(cost.settlements).toHaveLength(1);
  });

  it('does not append a second release after manual reconciliation released the cost', async () => {
    const job = {
      id: 'job-1', ownerUserId: 'owner-1', actorUserId: 'actor-1', workflowId: null,
      attemptCount: 1, operation: 'IMAGE_TO_IMAGE', status: 'CANCELLED', providerJobId: null,
    };
    const cost = costLedger('RELEASED');
    cost.settlements.push({
      id: 'settlement-1', reservationId: cost.reservation.id,
      kind: 'RECONCILED_RELEASE', idempotencyKey: 'manual-reconciliation-release',
      requestFingerprint: cost.reservation.requestFingerprint,
      actualCostMinor: 0, billedUnits: 0,
    });
    const tx = {
      ...cost,
      aiImageJob: { findUnique: vi.fn(async () => job), updateMany: vi.fn() },
    };
    const repository = new PrismaAiImageJobRepository({
      $transaction: vi.fn(async (callback: any) => callback(tx)),
    } as never);

    await expect(repository.markCancelled('job-1')).resolves.toBeUndefined();
    expect(cost.settlements).toHaveLength(1);
    expect(cost.settlements[0]).toMatchObject({ kind: 'RECONCILED_RELEASE' });
  });
});
