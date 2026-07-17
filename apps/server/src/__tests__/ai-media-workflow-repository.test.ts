import { describe, expect, it, vi } from 'vitest';
import { PrismaAiMediaWorkflowRepository } from '../repositories/ai-media-workflow-repository.js';
import {
  aiMediaPayloadHash,
  createAiMediaWorkflowFingerprint,
} from '../services/ai-media-workflows.js';

describe('Prisma AI media workflow repository recovery fence', () => {
  it('freezes ordered multi-reference inputs and child-job compatibility JSON', async () => {
    const assets = [
      { id: 'asset-2', sha256: 'b'.repeat(64), sourceCaptureSnapshotId: 'snapshot-1', url: 'https://cdn/2.png', mimeType: 'image/png', width: 900, height: 900 },
      { id: 'asset-1', sha256: 'a'.repeat(64), sourceCaptureSnapshotId: 'snapshot-1', url: 'https://cdn/1.png', mimeType: 'image/png', width: 1000, height: 1000 },
    ];
    const inputCreates: any[] = [];
    const jobCreate = vi.fn(async ({ data }: any) => ({ id: 'job-1', ...data }));
    const costReservationCreate = vi.fn(async ({ data }: any) => ({ id: 'cost-1', ...data }));
    const tx = {
      mediaAsset: { findMany: vi.fn(async () => assets) },
      supplyGoods: { findFirst: vi.fn(async () => ({
        id: 'goods-1', sourceCaptureSubject: { snapshots: [{ id: 'snapshot-1' }] },
      })) },
      aiMediaWorkflow: {
        findUnique: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: 'workflow-1', inputs: [], jobs: [], events: [] }),
        create: vi.fn(async ({ data }: any) => ({ id: 'workflow-1', ...data })),
      },
      aiMediaWorkflowInput: { create: vi.fn(async ({ data }: any) => { inputCreates.push(data); return data; }) },
      aiImageJob: { create: jobCreate },
      aiCostReservation: {
        findUnique: vi.fn(async () => null),
        create: costReservationCreate,
      },
      aiMediaWorkflowEvent: { create: vi.fn(async () => ({})) },
    };
    const client = { $transaction: vi.fn(async (callback: any) => callback(tx)) };
    await new PrismaAiMediaWorkflowRepository(client as never).createImageToImage({
      ownerUserId: 'owner-1', actorUserId: 'actor-1',
      references: [{ assetId: 'asset-1' }, { assetId: 'asset-2' }],
      prompt: 'Use both views', negativePrompt: null, count: 1, width: 1024, height: 1024,
      idempotencyKey: 'workflow-idem-multi', context: { type: 'collect', id: 'goods-1' },
    });
    expect(inputCreates.map(({ assetId, ordinal }) => ({ assetId, ordinal }))).toEqual([
      { assetId: 'asset-1', ordinal: 0 },
      { assetId: 'asset-2', ordinal: 1 },
    ]);
    expect(jobCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      inputAssets: [
        { assetId: 'asset-1', role: 'REFERENCE', ordinal: 0, sha256: 'a'.repeat(64) },
        { assetId: 'asset-2', role: 'REFERENCE', ordinal: 1, sha256: 'b'.repeat(64) },
      ],
    }) }));
    expect(costReservationCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      workflowId: 'workflow-1',
      jobId: 'job-1',
      idempotencyKey: 'job-1:cost:reserve',
      requestFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
      provider: 'fake',
      model: 'fake-image-to-image-v1',
      operation: 'IMAGE_TO_IMAGE',
      currency: 'USD',
      estimatedCostMinor: 0,
      maximumCostMinor: 0,
    }) });
    expect(jobCreate.mock.invocationCallOrder[0]).toBeLessThan(costReservationCreate.mock.invocationCallOrder[0]!);
  });

  it('keeps workflow creation inside the transaction when cost reservation fails', async () => {
    const eventCreate = vi.fn(async () => ({}));
    const tx = {
      mediaAsset: { findMany: vi.fn(async () => [{
        id: 'asset-1', sha256: 'a'.repeat(64), sourceCaptureSnapshotId: 'snapshot-1',
        url: 'https://cdn/1.png', mimeType: 'image/png', width: 1000, height: 1000,
      }]) },
      supplyGoods: { findFirst: vi.fn(async () => ({
        id: 'goods-1', sourceCaptureSubject: { snapshots: [{ id: 'snapshot-1' }] },
      })) },
      aiMediaWorkflow: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async ({ data }: any) => ({ id: 'workflow-1', ...data })),
      },
      aiMediaWorkflowInput: { create: vi.fn(async ({ data }: any) => data) },
      aiImageJob: { create: vi.fn(async ({ data }: any) => ({ id: 'job-1', ...data })) },
      aiCostReservation: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async () => { throw new Error('cost reservation unavailable'); }),
      },
      aiMediaWorkflowEvent: { create: eventCreate },
    };
    const client = { $transaction: vi.fn(async (callback: any) => callback(tx)) };

    await expect(new PrismaAiMediaWorkflowRepository(client as never).createImageToImage({
      ownerUserId: 'owner-1', actorUserId: 'actor-1', sourceAssetId: 'asset-1',
      prompt: 'Keep the product', negativePrompt: null, count: 1, width: 1024, height: 1024,
      idempotencyKey: 'workflow-cost-failure', context: { type: 'collect', id: 'goods-1' },
    })).rejects.toThrow('cost reservation unavailable');
    expect(eventCreate).not.toHaveBeenCalled();
    expect(client.$transaction).toHaveBeenCalledTimes(1);
  });

  it('replays an existing workflow without creating a second cost reservation', async () => {
    const costReservationCreate = vi.fn();
    const existing = {
      id: 'workflow-1', requestFingerprint: '', inputs: [],
      jobs: [{ id: 'job-1', workflowAttempt: 1 }], events: [],
    };
    const tx = {
      mediaAsset: { findMany: vi.fn(async () => [{
        id: 'asset-1', sha256: 'a'.repeat(64), sourceCaptureSnapshotId: 'snapshot-1',
        url: 'https://cdn/1.png', mimeType: 'image/png', width: 1000, height: 1000,
      }]) },
      supplyGoods: { findFirst: vi.fn(async () => ({
        id: 'goods-1', sourceCaptureSubject: { snapshots: [{ id: 'snapshot-1' }] },
      })) },
      aiMediaWorkflow: { findUnique: vi.fn(async () => existing) },
      aiCostReservation: { create: costReservationCreate },
    };
    const client = { $transaction: vi.fn(async (callback: any) => callback(tx)) };
    const repository = new PrismaAiMediaWorkflowRepository(client as never);
    const input = {
      ownerUserId: 'owner-1', actorUserId: 'actor-1', sourceAssetId: 'asset-1',
      prompt: 'Keep the product', negativePrompt: null, count: 1, width: 1024, height: 1024,
      idempotencyKey: 'workflow-replay', context: { type: 'collect' as const, id: 'goods-1' },
    };
    const fingerprint = createAiMediaWorkflowFingerprint(input);
    const payloadHash = aiMediaPayloadHash({
      request: fingerprint,
      sourceAssetSha256: 'a'.repeat(64),
    });
    existing.requestFingerprint = payloadHash;

    const result = await repository.createImageToImage(input);
    expect(result).toMatchObject({ kind: 'existing', jobId: 'job-1' });
    expect(costReservationCreate).not.toHaveBeenCalled();
  });

  it('rejects different asset IDs with the same immutable content hash', async () => {
    const tx = {
      mediaAsset: { findMany: vi.fn(async () => [
        { id: 'asset-1', sha256: 'a'.repeat(64), sourceCaptureSnapshotId: 'snapshot-1' },
        { id: 'asset-2', sha256: 'a'.repeat(64), sourceCaptureSnapshotId: 'snapshot-1' },
      ]) },
    };
    const client = { $transaction: vi.fn(async (callback: any) => callback(tx)) };
    await expect(new PrismaAiMediaWorkflowRepository(client as never).createImageToImage({
      ownerUserId: 'owner-1', actorUserId: 'actor-1',
      references: [{ assetId: 'asset-1' }, { assetId: 'asset-2' }],
      prompt: 'Use both views', negativePrompt: null, count: 1, width: 1024, height: 1024,
      idempotencyKey: 'workflow-idem-duplicate', context: { type: 'collect', id: 'goods-1' },
    })).rejects.toMatchObject({ code: 'SOURCE_ASSET_DUPLICATE' });
  });

  it('never creates a new attempt after the provider accepted the previous request', async () => {
    const tx = {
      aiMediaWorkflowEvent: { findUnique: vi.fn(async () => null) },
      aiMediaWorkflow: {
        findFirst: vi.fn(async () => ({
          id: 'workflow-1', ownerUserId: 'owner-1', status: 'FAILED', revision: 3, currentAttempt: 1,
        })),
      },
      aiImageJob: {
        findFirst: vi.fn(async () => ({
          id: 'job-1', workflowId: 'workflow-1', workflowAttempt: 1,
          providerJobId: 'provider-task-accepted',
        })),
        create: vi.fn(),
      },
    };
    const client = { $transaction: vi.fn(async (callback: any) => callback(tx)) };
    const repository = new PrismaAiMediaWorkflowRepository(client as never);
    const result = await repository.retryOwned({
      id: 'workflow-1', ownerUserId: 'owner-1', actorUserId: 'actor-1',
      expectedRevision: 3, idempotencyKey: 'retry-idem-1',
    });
    expect(result).toBeNull();
    expect(tx.aiImageJob.create).not.toHaveBeenCalled();
  });

  it.each(['SETTLED', 'RELEASED'])('allows retry after provider cost is manually reconciled to %s', async (status) => {
    const fingerprint = 'f'.repeat(64);
    const jobCreate = vi.fn(async ({ data }: any) => ({ id: 'job-2', ...data }));
    const tx = {
      aiMediaWorkflowEvent: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async () => ({})),
      },
      aiMediaWorkflow: {
        findFirst: vi.fn(async () => ({
          id: 'workflow-1', ownerUserId: 'owner-1', status: 'FAILED', revision: 3,
          currentAttempt: 1, requestFingerprint: fingerprint,
        })),
        update: vi.fn(async () => ({})),
        findUnique: vi.fn(async () => ({
          id: 'workflow-1', ownerUserId: 'owner-1', status: 'QUEUED', currentAttempt: 2,
          inputs: [], jobs: [{ id: 'job-2', workflowAttempt: 2 }], events: [],
        })),
      },
      aiImageJob: {
        findFirst: vi.fn(async () => ({
          id: 'job-1', ownerUserId: 'owner-1', providerJobId: 'provider-task-accepted',
          errorCode: 'PROVIDER_SUBMISSION_UNCERTAIN', operation: 'IMAGE_TO_IMAGE',
          provider: 'fake', model: 'fake-image-to-image-v1', prompt: 'Retry prompt',
          negativePrompt: null, requestFingerprint: fingerprint, inputAssets: [],
          requestedImageCount: 1, width: 1024, height: 1024,
        })),
        create: jobCreate,
      },
      aiCostReservation: {
        findUnique: vi.fn(async ({ where }: any) => (
          where.ai_cost_reservation_job_owner?.jobId === 'job-1'
            ? { id: 'cost-1', status }
            : null
        )),
        create: vi.fn(async ({ data }: any) => ({ id: 'cost-2', ...data })),
      },
    };

    const result = await new PrismaAiMediaWorkflowRepository({
      $transaction: vi.fn(async (callback: any) => callback(tx)),
    } as never).retryOwned({
      id: 'workflow-1', ownerUserId: 'owner-1', actorUserId: 'actor-1',
      expectedRevision: 3, idempotencyKey: `retry-after-${status.toLowerCase()}`,
    });

    expect(result).toMatchObject({ jobId: 'job-2', replayed: false });
    expect(jobCreate).toHaveBeenCalledTimes(1);
  });

  it.each(['RESERVED', 'SUBMISSION_UNCERTAIN', 'RECONCILIATION_REQUIRED'])(
    'blocks retry while provider cost remains %s',
    async (status) => {
      const jobCreate = vi.fn();
      const tx = {
        aiMediaWorkflowEvent: { findUnique: vi.fn(async () => null) },
        aiMediaWorkflow: { findFirst: vi.fn(async () => ({
          id: 'workflow-1', ownerUserId: 'owner-1', status: 'FAILED', revision: 3, currentAttempt: 1,
        })) },
        aiImageJob: {
          findFirst: vi.fn(async () => ({
            id: 'job-1', ownerUserId: 'owner-1', providerJobId: 'provider-task-accepted',
            errorCode: 'PROVIDER_SUBMISSION_UNCERTAIN',
          })),
          create: jobCreate,
        },
        aiCostReservation: { findUnique: vi.fn(async () => ({ id: 'cost-1', status })) },
      };

      const result = await new PrismaAiMediaWorkflowRepository({
        $transaction: vi.fn(async (callback: any) => callback(tx)),
      } as never).retryOwned({
        id: 'workflow-1', ownerUserId: 'owner-1', actorUserId: 'actor-1',
        expectedRevision: 3, idempotencyKey: `retry-blocked-${status.toLowerCase()}`,
      });

      expect(result).toBeNull();
      expect(jobCreate).not.toHaveBeenCalled();
    },
  );

  it('creates a new cost reservation atomically with a retry attempt', async () => {
    const fingerprint = 'f'.repeat(64);
    const jobCreate = vi.fn(async ({ data }: any) => ({ id: 'job-2', ...data }));
    const costReservationCreate = vi.fn(async ({ data }: any) => ({ id: 'cost-2', ...data }));
    const workflowUpdate = vi.fn(async () => ({}));
    const eventCreate = vi.fn(async () => ({}));
    const tx = {
      aiMediaWorkflowEvent: {
        findUnique: vi.fn(async () => null),
        create: eventCreate,
      },
      aiMediaWorkflow: {
        findFirst: vi.fn(async () => ({
          id: 'workflow-1', ownerUserId: 'owner-1', status: 'FAILED', revision: 3,
          currentAttempt: 1, requestFingerprint: fingerprint,
        })),
        update: workflowUpdate,
        findUnique: vi.fn(async () => ({
          id: 'workflow-1', ownerUserId: 'owner-1', status: 'QUEUED', currentAttempt: 2,
          inputs: [], jobs: [{ id: 'job-2', workflowAttempt: 2 }], events: [],
        })),
      },
      aiImageJob: {
        findFirst: vi.fn(async () => ({
          id: 'job-1', ownerUserId: 'owner-1', providerJobId: null,
          operation: 'IMAGE_TO_IMAGE', provider: 'fake', model: 'fake-image-to-image-v1',
          prompt: 'Retry prompt', negativePrompt: null, requestFingerprint: fingerprint,
          inputAssets: [], requestedImageCount: 1, width: 1024, height: 1024,
        })),
        create: jobCreate,
      },
      aiCostReservation: {
        findUnique: vi.fn(async () => null),
        create: costReservationCreate,
      },
    };
    const client = { $transaction: vi.fn(async (callback: any) => callback(tx)) };

    const result = await new PrismaAiMediaWorkflowRepository(client as never).retryOwned({
      id: 'workflow-1', ownerUserId: 'owner-1', actorUserId: 'actor-1',
      expectedRevision: 3, idempotencyKey: 'retry-idem-cost',
    });

    expect(result).toMatchObject({ jobId: 'job-2', replayed: false });
    expect(costReservationCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      workflowId: 'workflow-1',
      jobId: 'job-2',
      idempotencyKey: 'job-2:cost:reserve',
      requestFingerprint: fingerprint,
      provider: 'fake',
      model: 'fake-image-to-image-v1',
      operation: 'IMAGE_TO_IMAGE',
      currency: 'USD',
      estimatedCostMinor: 0,
      maximumCostMinor: 0,
    }) });
    expect(jobCreate.mock.invocationCallOrder[0]).toBeLessThan(costReservationCreate.mock.invocationCallOrder[0]!);
    expect(costReservationCreate.mock.invocationCallOrder[0]).toBeLessThan(workflowUpdate.mock.invocationCallOrder[0]!);
    expect(costReservationCreate.mock.invocationCallOrder[0]).toBeLessThan(eventCreate.mock.invocationCallOrder[0]!);
  });

  it('replays the exact retry attempt recorded by the idempotency event', async () => {
    const costReservationCreate = vi.fn();
    const tx = {
      aiMediaWorkflowEvent: { findUnique: vi.fn(async () => ({ jobId: 'job-2' })) },
      aiMediaWorkflow: { findFirst: vi.fn(async () => ({
        id: 'workflow-1', ownerUserId: 'owner-1', currentAttempt: 3,
        jobs: [{ id: 'job-2', workflowAttempt: 2 }, { id: 'job-3', workflowAttempt: 3 }],
      })) },
      aiCostReservation: { create: costReservationCreate },
    };
    const client = { $transaction: vi.fn(async (callback: any) => callback(tx)) };
    const result = await new PrismaAiMediaWorkflowRepository(client as never).retryOwned({
      id: 'workflow-1', ownerUserId: 'owner-1', actorUserId: 'actor-1',
      expectedRevision: 5, idempotencyKey: 'retry-idem-1',
    });
    expect(result).toMatchObject({ jobId: 'job-2', replayed: true });
    expect(costReservationCreate).not.toHaveBeenCalled();
  });

  it('recovers the exact retry attempt after a concurrent unique-key winner commits', async () => {
    const client = {
      $transaction: vi.fn().mockRejectedValue({ code: 'P2002' }),
      aiMediaWorkflowEvent: { findUnique: vi.fn(async () => ({
        workflowId: 'workflow-1', ownerUserId: 'owner-1', jobId: 'job-2',
      })) },
      aiMediaWorkflow: { findFirst: vi.fn(async () => ({
        id: 'workflow-1', ownerUserId: 'owner-1', currentAttempt: 2,
        jobs: [{ id: 'job-1', workflowAttempt: 1 }, { id: 'job-2', workflowAttempt: 2 }],
      })) },
    };

    const result = await new PrismaAiMediaWorkflowRepository(client as never).retryOwned({
      id: 'workflow-1', ownerUserId: 'owner-1', actorUserId: 'actor-1',
      expectedRevision: 3, idempotencyKey: 'retry-idem-1',
    });

    expect(result).toMatchObject({ jobId: 'job-2', replayed: true });
  });

  it('returns a stable conflict when another retry key wins the same revision', async () => {
    const client = {
      $transaction: vi.fn().mockRejectedValue({ code: 'P2002' }),
      aiMediaWorkflowEvent: { findUnique: vi.fn(async () => null) },
      aiMediaWorkflow: { findFirst: vi.fn(async () => ({ revision: 4, status: 'QUEUED' })) },
    };

    const result = await new PrismaAiMediaWorkflowRepository(client as never).retryOwned({
      id: 'workflow-1', ownerUserId: 'owner-1', actorUserId: 'actor-1',
      expectedRevision: 3, idempotencyKey: 'losing-retry-key',
    });

    expect(result).toBeNull();
  });

  it('releases the cost reservation when a queued job is cancelled before provider submission', async () => {
    const fingerprint = 'a'.repeat(64);
    const reservation = {
      id: 'cost-1', ownerUserId: 'owner-1', actorUserId: 'actor-1', workflowId: 'workflow-1',
      jobId: 'job-1', requestFingerprint: fingerprint, status: 'RESERVED', maximumCostMinor: 0,
    };
    const settlementCreate = vi.fn(async ({ data }: any) => ({ id: 'settlement-1', ...data }));
    const reservationUpdate = vi.fn(async () => ({ count: 1 }));
    const jobUpdate = vi.fn(async () => ({}));
    const tx = {
      aiMediaWorkflow: {
        findFirst: vi.fn(async () => ({
          id: 'workflow-1', ownerUserId: 'owner-1', revision: 2,
          currentAttempt: 1, status: 'QUEUED',
        })),
        update: vi.fn(async () => ({})),
        findUnique: vi.fn(async () => ({
          id: 'workflow-1', ownerUserId: 'owner-1', revision: 3,
          currentAttempt: 1, status: 'CANCELLED', inputs: [], jobs: [], events: [],
        })),
      },
      aiImageJob: {
        findFirst: vi.fn(async () => ({ id: 'job-1', status: 'QUEUED', providerJobId: null })),
        update: jobUpdate,
      },
      aiCostReservation: {
        findUnique: vi.fn(async ({ where }: any) => (
          where.ai_cost_reservation_job_owner || where.ai_cost_reservation_id_owner ? reservation : null
        )),
        updateMany: reservationUpdate,
      },
      aiCostSettlement: {
        findUnique: vi.fn(async () => null),
        create: settlementCreate,
      },
      aiMediaWorkflowEvent: { create: vi.fn(async () => ({})) },
    };
    const client = { $transaction: vi.fn(async (callback: any) => callback(tx)) };

    const result = await new PrismaAiMediaWorkflowRepository(client as never).cancelOwned(
      'workflow-1', 'owner-1', 'actor-1', 2,
    );

    expect(result).toMatchObject({ status: 'CANCELLED' });
    expect(jobUpdate).toHaveBeenCalledWith({ where: { id: 'job-1' }, data: { status: 'CANCELLED' } });
    expect(settlementCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      reservationId: 'cost-1',
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      kind: 'RELEASE',
      idempotencyKey: 'job-1:cost:release',
      requestFingerprint: fingerprint,
      actualCostMinor: 0,
      billedUnits: 0,
      reason: 'cancelled before provider submission',
    }) });
    expect(reservationUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'cost-1', ownerUserId: 'owner-1', status: 'RESERVED' },
      data: expect.objectContaining({ status: 'RELEASED' }),
    }));
  });

  it('keeps cancellation compatible with legacy jobs that have no cost reservation', async () => {
    const settlementCreate = vi.fn();
    const tx = {
      aiMediaWorkflow: {
        findFirst: vi.fn(async () => ({
          id: 'workflow-legacy', ownerUserId: 'owner-1', revision: 1,
          currentAttempt: 1, status: 'QUEUED',
        })),
        update: vi.fn(async () => ({})),
        findUnique: vi.fn(async () => ({
          id: 'workflow-legacy', ownerUserId: 'owner-1', revision: 2,
          currentAttempt: 1, status: 'CANCELLED', inputs: [], jobs: [], events: [],
        })),
      },
      aiImageJob: {
        findFirst: vi.fn(async () => ({ id: 'job-legacy', status: 'QUEUED', providerJobId: null })),
        update: vi.fn(async () => ({})),
      },
      aiCostReservation: { findUnique: vi.fn(async () => null) },
      aiCostSettlement: { create: settlementCreate },
      aiMediaWorkflowEvent: { create: vi.fn(async () => ({})) },
    };
    const client = { $transaction: vi.fn(async (callback: any) => callback(tx)) };

    const result = await new PrismaAiMediaWorkflowRepository(client as never).cancelOwned(
      'workflow-legacy', 'owner-1', 'actor-1', 1,
    );

    expect(result).toMatchObject({ status: 'CANCELLED' });
    expect(settlementCreate).not.toHaveBeenCalled();
  });

  it('records the correctly spelled rejection audit event', async () => {
    const created = vi.fn(async () => ({}));
    const tx = {
      aiMediaWorkflow: {
        findFirst: vi.fn(async () => ({ id: 'workflow-1', ownerUserId: 'owner-1' })),
        update: vi.fn(async () => ({})),
        findUnique: vi.fn(async () => ({ id: 'workflow-1', reviewStatus: 'REJECTED' })),
      },
      mediaAsset: { findFirst: vi.fn(async () => ({ id: 'output-1' })) },
      aiMediaWorkflowEvent: { create: created },
    };
    const client = { $transaction: vi.fn(async (callback: any) => callback(tx)) };
    await new PrismaAiMediaWorkflowRepository(client as never).reviewOwned({
      id: 'workflow-1', ownerUserId: 'owner-1', actorUserId: 'actor-1',
      expectedRevision: 4, outputAssetId: 'output-1', decision: 'REJECT', note: null,
    });
    expect(created).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: 'REVIEW_REJECTED' }),
    }));
  });
});
