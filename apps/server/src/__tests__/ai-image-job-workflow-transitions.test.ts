import { describe, expect, it, vi } from 'vitest';
import { PrismaAiImageJobRepository } from '../repositories/ai-image-job-repository.js';

describe('AI image workflow child terminal transitions', () => {
  it('loads frozen workflow inputs in ordinal order for provider execution', async () => {
    const findUnique = vi.fn(async () => null);
    await new PrismaAiImageJobRepository({ aiImageJob: { findUnique } } as never).getById('job-1');
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        workflow: { include: { inputs: { orderBy: { ordinal: 'asc' } } } },
      }),
    }));
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
      eventType: 'PROVIDER_SUBMITTED', payload: { providerJobId: 'provider-task-1' },
    }) });
  });

  it('preserves a previously persisted provider task when completion omits it', async () => {
    const job = {
      id: 'job-1', ownerUserId: 'owner-1', actorUserId: 'actor-1', workflowId: null,
      workflowAttempt: null, attemptCount: 1, operation: 'IMAGE_TO_IMAGE', status: 'RUNNING',
      providerJobId: 'provider-task-1',
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

  it('rejects a completion that tries to replace the persisted provider recovery identity', async () => {
    const job = {
      id: 'job-1', ownerUserId: 'owner-1', actorUserId: 'actor-1', workflowId: null,
      workflowAttempt: null, attemptCount: 1, operation: 'IMAGE_TO_IMAGE', status: 'RUNNING',
      providerJobId: 'provider-task-1',
    };
    const tx = {
      aiImageJob: { findUnique: vi.fn(async () => job), updateMany: vi.fn() },
      mediaAsset: { create: vi.fn() },
    };
    const client = { $transaction: vi.fn(async (callback: any) => callback(tx)) };

    await expect(new PrismaAiImageJobRepository(client as never).complete('job-1', {
      providerJobId: 'provider-task-2', actualCostCents: 0, billedUnits: 1, assets: [],
    })).rejects.toMatchObject({ code: 'PROVIDER_JOB_ID_MISMATCH' });
    expect(tx.aiImageJob.updateMany).not.toHaveBeenCalled();
    expect(tx.mediaAsset.create).not.toHaveBeenCalled();
  });
});
