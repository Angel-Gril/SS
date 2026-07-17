import { describe, expect, it, vi } from 'vitest';
import { PrismaAiMediaWorkflowRepository } from '../repositories/ai-media-workflow-repository.js';

describe('Prisma AI media workflow repository recovery fence', () => {
  it('freezes ordered multi-reference inputs and child-job compatibility JSON', async () => {
    const assets = [
      { id: 'asset-2', sha256: 'b'.repeat(64), sourceCaptureSnapshotId: 'snapshot-1', url: 'https://cdn/2.png', mimeType: 'image/png', width: 900, height: 900 },
      { id: 'asset-1', sha256: 'a'.repeat(64), sourceCaptureSnapshotId: 'snapshot-1', url: 'https://cdn/1.png', mimeType: 'image/png', width: 1000, height: 1000 },
    ];
    const inputCreates: any[] = [];
    const jobCreate = vi.fn(async ({ data }: any) => ({ id: 'job-1', ...data }));
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

  it('replays the exact retry attempt recorded by the idempotency event', async () => {
    const tx = {
      aiMediaWorkflowEvent: { findUnique: vi.fn(async () => ({ jobId: 'job-2' })) },
      aiMediaWorkflow: { findFirst: vi.fn(async () => ({
        id: 'workflow-1', ownerUserId: 'owner-1', currentAttempt: 3,
        jobs: [{ id: 'job-2', workflowAttempt: 2 }, { id: 'job-3', workflowAttempt: 3 }],
      })) },
    };
    const client = { $transaction: vi.fn(async (callback: any) => callback(tx)) };
    const result = await new PrismaAiMediaWorkflowRepository(client as never).retryOwned({
      id: 'workflow-1', ownerUserId: 'owner-1', actorUserId: 'actor-1',
      expectedRevision: 5, idempotencyKey: 'retry-idem-1',
    });
    expect(result).toMatchObject({ jobId: 'job-2', replayed: true });
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
