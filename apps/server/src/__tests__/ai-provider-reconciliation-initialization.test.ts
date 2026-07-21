import { describe, expect, it, vi } from 'vitest';
import { PrismaAiImageJobRepository } from '../repositories/ai-image-job-repository.js';

function transactionClient(job: Record<string, unknown>) {
  const updateMany = vi.fn(async () => ({ count: 1 }));
  const tx = {
    aiImageJob: { findUnique: vi.fn(async () => job), updateMany },
    aiCostReservation: { findUnique: vi.fn(async () => null) },
    aiMediaWorkflow: { updateMany: vi.fn(async () => ({ count: 1 })) },
    aiMediaWorkflowEvent: { createMany: vi.fn(async () => ({ count: 1 })), create: vi.fn(async () => ({})) },
  };
  return {
    updateMany,
    repository: new PrismaAiImageJobRepository({
      $transaction: vi.fn(async (callback: any) => callback(tx)),
    } as never),
  };
}

describe('AI Provider reconciliation initialization', () => {
  it('moves a submission with no recoverable task identity to manual review', async () => {
    const { repository, updateMany } = transactionClient({
      id: 'job-1', ownerUserId: 'owner-1', actorUserId: 'actor-1', status: 'RUNNING',
      operation: 'IMAGE_TRANSLATE', provider: 'paid-provider', providerJobId: null,
      providerDispatchedAt: new Date('2026-07-21T08:00:00.000Z'), workflowId: null,
      attemptCount: 1, providerReconciliationStatus: 'NOT_REQUIRED',
      providerReconciliationRevision: 0,
    });

    await repository.markSubmissionUncertain('job-1', {
      attemptCount: 1,
      errorCode: 'PROVIDER_TIMEOUT',
      errorMessage: 'submission timed out',
      providerSubmissionUncertain: true,
    });

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'FAILED',
        providerReconciliationStatus: 'MANUAL_REVIEW',
        providerReconciliationRevision: 1,
        providerReconciliationLastErrorCode: 'PROVIDER_SUBMISSION_UNCERTAIN',
      }),
    }));
  });

  it('queues an accepted translation task for lookup after normal execution fails', async () => {
    const dispatchedAt = new Date('2026-07-21T08:00:00.000Z');
    const { repository, updateMany } = transactionClient({
      id: 'job-1', ownerUserId: 'owner-1', actorUserId: 'actor-1', status: 'RUNNING',
      operation: 'IMAGE_TRANSLATE', provider: 'fake', providerJobId: 'provider-task-1',
      providerDispatchedAt: dispatchedAt, workflowId: null, attemptCount: 1,
      providerReconciliationStatus: 'NOT_REQUIRED', providerReconciliationRevision: 0,
    });

    await repository.markFailed('job-1', {
      attemptCount: 1,
      errorCode: 'PROVIDER_POLL_TIMEOUT',
      errorMessage: 'normal polling window expired',
      providerJobId: 'provider-task-1',
      providerAcceptedAt: dispatchedAt,
    });

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'FAILED',
        providerReconciliationStatus: 'PENDING',
        providerReconciliationRevision: 1,
        providerReconciliationNextAt: expect.any(Date),
        providerReconciliationDeadlineAt: expect.any(Date),
      }),
    }));
  });

  it('records a proven terminal Provider failure as no output instead of polling again', async () => {
    const dispatchedAt = new Date('2026-07-21T08:00:00.000Z');
    const { repository, updateMany } = transactionClient({
      id: 'job-1', ownerUserId: 'owner-1', actorUserId: 'actor-1', status: 'RUNNING',
      operation: 'IMAGE_TRANSLATE', provider: 'fake', providerJobId: 'provider-task-1',
      providerDispatchedAt: dispatchedAt, workflowId: null, attemptCount: 1,
      providerReconciliationStatus: 'NOT_REQUIRED', providerReconciliationRevision: 0,
    });

    await repository.markFailed('job-1', {
      attemptCount: 1,
      errorCode: 'PROVIDER_TASK_FAILED',
      errorMessage: 'Provider task failed',
      providerJobId: 'provider-task-1',
      providerAcceptedAt: dispatchedAt,
    });

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        providerReconciliationStatus: 'NO_OUTPUT',
        providerReconciliationRevision: 1,
        providerReconciledAt: expect.any(Date),
      }),
    }));
    expect(updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ providerReconciliationStatus: 'PENDING' }),
    }));
  });

  it('upgrades a late accepted task identity from manual review into the lookup queue', async () => {
    const acceptedAt = new Date('2026-07-21T08:00:05.000Z');
    const { repository, updateMany } = transactionClient({
      id: 'job-1', ownerUserId: 'owner-1', actorUserId: 'actor-1', status: 'FAILED',
      operation: 'IMAGE_TRANSLATE', provider: 'fake', providerJobId: null,
      providerDispatchedAt: new Date('2026-07-21T08:00:00.000Z'), workflowId: null,
      attemptCount: 1, errorCode: 'PROVIDER_SUBMISSION_UNCERTAIN',
      providerReconciliationStatus: 'MANUAL_REVIEW', providerReconciliationRevision: 1,
    });

    await repository.recordProviderJobId('job-1', 'provider-task-late', acceptedAt);

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'job-1', providerJobId: null }),
      data: expect.objectContaining({
        providerJobId: 'provider-task-late',
        providerReconciliationStatus: 'PENDING',
        providerReconciliationRevision: 2,
        providerReconciliationNextAt: expect.any(Date),
        providerReconciliationDeadlineAt: expect.any(Date),
      }),
    }));
  });

  it('keeps a cancelled job terminal while fencing a conflicting late task identity', async () => {
    const { repository, updateMany } = transactionClient({
      id: 'job-1', ownerUserId: 'owner-1', actorUserId: 'actor-1', status: 'CANCELLED',
      operation: 'IMAGE_TRANSLATE', provider: 'fake', providerJobId: 'provider-task-1',
      providerDispatchedAt: new Date('2026-07-21T08:00:00.000Z'), workflowId: null,
      attemptCount: 1, providerReconciliationStatus: 'PENDING',
      providerReconciliationRevision: 1,
    });

    await expect(repository.recordProviderJobId(
      'job-1',
      'provider-task-conflict',
      new Date('2026-07-21T08:00:05.000Z'),
    )).rejects.toMatchObject({ code: 'PROVIDER_JOB_ID_MISMATCH' });

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'job-1',
        status: { in: expect.arrayContaining(['CANCELLED']) },
      }),
      data: expect.objectContaining({
        status: 'CANCELLED',
        providerReconciliationStatus: 'MANUAL_REVIEW',
        providerReconciliationRevision: 2,
      }),
    }));
  });
});
