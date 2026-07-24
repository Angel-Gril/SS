import { describe, expect, it, vi } from 'vitest';
import { PrismaAiMediaWorkflowRepository } from '../repositories/ai-media-workflow-repository.js';
import {
  aiMediaPayloadHash,
  createAiImageEditWorkflowFingerprint,
  createAiMediaWorkflowFingerprint,
  type AiMediaWorkflowContext,
} from '../services/ai-media-workflows.js';
import { AI_IMAGE_EDIT_MASK_SEMANTICS } from '../services/ai-image-compositor.js';
import { createAiImageProviderRuntimeContract } from '../services/ai-image-provider-runtime-contract.js';

function paidProviderRuntime(width = 1024, height = 1024, costPerImageCents = 7) {
  return createAiImageProviderRuntimeContract({
    provider: 'openai-images', model: 'gpt-image-1',
    baseUrl: 'https://api.openai.com/v1', costPerImageCents,
  }, { count: 1, width, height });
}

const listingDraftCapture = {
  captureVersion: 'source-product-capture-v2',
  facts: { title: 'Source listing' },
  skus: [
    { key: 'sku-red', sourceSkuId: 'red-source' },
    { key: 'sku-blue', sourceSkuId: 'blue-source' },
  ],
  media: [
    {
      key: 'main-1', ordinal: 0, kind: 'image', disposition: 'accepted',
      role: 'product_main', skuKeys: [], url: 'https://source.example/main.jpg',
    },
    {
      key: 'sku-red-1', ordinal: 1, kind: 'image', disposition: 'accepted',
      role: 'sku', skuKeys: ['red-source'], url: 'https://source.example/red.jpg',
    },
    {
      key: 'sku-blue-1', ordinal: 2, kind: 'image', disposition: 'accepted',
      role: 'sku', skuKeys: ['blue-source'], url: 'https://source.example/blue.jpg',
    },
  ],
};

function listingDraftAsset(overrides: Record<string, unknown> = {}) {
  return {
    id: 'asset-red', ownerUserId: 'owner-1', kind: 'SOURCE_ORIGINAL',
    sha256: 'a'.repeat(64), sourceCaptureSnapshotId: 'snapshot-1',
    sourceMediaKey: 'sku-red-1', sourceUrl: 'https://source.example/red.jpg',
    url: 'https://cdn.example/red.jpg', mimeType: 'image/jpeg',
    width: 1200, height: 900, storageBackend: 'oss', storageKey: 'red.jpg', sizeBytes: 120,
    metadata: { pixelOrientationNormalized: true },
    ...overrides,
  };
}

function listingDraftImageToImageTransaction() {
  const product = listingDraftAsset({
    id: 'asset-product', sha256: 'b'.repeat(64), sourceMediaKey: 'main-1',
    sourceUrl: 'https://source.example/main.jpg', url: 'https://cdn.example/main.jpg',
  });
  const red = listingDraftAsset();
  const blue = listingDraftAsset({
    id: 'asset-blue', sha256: 'c'.repeat(64), sourceMediaKey: 'sku-blue-1',
    sourceUrl: 'https://source.example/blue.jpg', url: 'https://cdn.example/blue.jpg',
  });
  const assets = new Map([
    [product.id, product],
    [red.id, red],
    [blue.id, blue],
  ]);
  const sourceListingWorkflowFindFirst = vi.fn(async ({ where }: any) => (
    where.id === 'draft-1' && where.ownerUserId === 'owner-1'
      ? {
        id: 'draft-1', ownerUserId: 'owner-1', sourceSubjectId: 'subject-1',
        currentRevision: 4, currentDraftVersion: 2,
        currentSourceCaptureSnapshotId: 'snapshot-1',
        currentDraft: {
          workflowId: 'draft-1', ownerUserId: 'owner-1', revision: 4, draftVersion: 2,
          sourceCaptureSnapshotId: 'snapshot-1', payload: {
            id: 'draft-1', ownerUserId: 'owner-1', revision: 4, draftVersion: 2,
            sourceCaptureSnapshotId: 'snapshot-1', sourceCaptureHash: 'd'.repeat(64),
            selectedSkuKeys: ['sku-red'], copy: { publishTitleRu: 'Red listing' },
            media: { assignments: [
              { scope: 'PRODUCT', slotKey: 'main-1', assetId: 'asset-product', source: 'SOURCE' },
              { scope: 'SKU', skuKey: 'sku-red', slotKey: 'sku-hero', assetId: 'asset-red', source: 'SOURCE' },
            ] },
          },
        },
        currentSourceCaptureSnapshot: {
          id: 'snapshot-1', subjectId: 'subject-1', version: 7, captureHash: 'd'.repeat(64),
          payload: listingDraftCapture, subject: { ownerUserId: 'owner-1' },
        },
      }
      : null
  ));
  const mediaAssetFindMany = vi.fn(async ({ where }: any = {}) => {
    if (where.sourceMediaKey?.in) return [product, red];
    if (where.id?.in) {
      return (where.id.in as string[])
        .map((id) => assets.get(id))
        .filter((asset): asset is typeof product => Boolean(asset));
    }
    return [];
  });
  const workflowCreate = vi.fn(async ({ data }: any) => ({ id: 'workflow-listing-1', ...data }));
  const inputCreate = vi.fn(async ({ data }: any) => data);
  const jobCreate = vi.fn(async ({ data }: any) => ({ id: 'job-listing-1', ...data }));
  const costCreate = vi.fn(async ({ data }: any) => ({ id: 'cost-listing-1', ...data }));
  const tx = {
    sourceListingWorkflow: { findFirst: sourceListingWorkflowFindFirst },
    mediaAsset: { findMany: mediaAssetFindMany },
    aiMediaWorkflow: {
      findUnique: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'workflow-listing-1', contextType: 'listing-draft', contextId: 'draft-1',
          contextSkuKey: 'sku-red', contextSlotKey: 'sku-hero',
          contextDraftRevision: 4, contextDraftVersion: 2,
          inputs: [], jobs: [], events: [],
        }),
      create: workflowCreate,
    },
    aiMediaWorkflowInput: { create: inputCreate },
    aiImageJob: { create: jobCreate },
    aiCostReservation: { findUnique: vi.fn(async () => null), create: costCreate },
    aiMediaWorkflowEvent: { create: vi.fn(async () => ({})) },
  };
  return {
    tx,
    sourceListingWorkflowFindFirst,
    mediaAssetFindMany,
    workflowCreate,
    inputCreate,
    client: { $transaction: vi.fn(async (callback: any) => callback(tx)) },
  };
}

function listingDraftImageToImageInput(overrides: Record<string, unknown> = {}) {
  return {
    ownerUserId: 'owner-1', actorUserId: 'actor-1', sourceAssetId: 'asset-red',
    prompt: 'Translate the red product scene', negativePrompt: null,
    count: 1, width: 1024, height: 1024, dailyLimit: 0, idempotencyKey: 'listing-image-1',
    context: {
      type: 'listing-draft' as const, id: 'draft-1', skuKey: 'sku-red', slotKey: 'sku-hero',
      revision: 4, draftVersion: 2,
    },
    ...overrides,
  };
}

describe('Prisma AI media workflow repository recovery fence', () => {
  const unresolvedQuotaFilter = expect.objectContaining({
    OR: expect.arrayContaining([
      expect.objectContaining({ status: { in: ['PENDING', 'QUEUED', 'RUNNING', 'RETRYING'] } }),
      expect.objectContaining({
        status: { in: ['FAILED', 'CANCELLED'] },
        billedUnits: 0,
        OR: expect.arrayContaining([
          { providerReconciliationStatus: { in: ['PENDING', 'RUNNING', 'RETRY_WAIT', 'MANUAL_REVIEW'] } },
          { costReservation: { is: { status: { in: ['SUBMISSION_UNCERTAIN', 'RECONCILIATION_REQUIRED'] } } } },
        ]),
      }),
    ]),
  });

  it('returns a stable owner/context keyset page and probes one extra row', async () => {
    const createdAt = new Date('2026-07-20T09:00:00.000Z');
    const findMany = vi.fn(async () => [
      { id: 'workflow-c', createdAt, suiteSlot: null },
      { id: 'workflow-b', createdAt, suiteSlot: null },
      { id: 'workflow-a', createdAt, suiteSlot: null },
    ]);
    const repository = new PrismaAiMediaWorkflowRepository({
      aiMediaWorkflow: { findMany },
    } as never);

    const page = await repository.listOwned({
      ownerUserId: 'owner-1', contextType: 'collect', contextId: 'goods-1', limit: 2,
      cursor: { createdAt: new Date('2026-07-20T10:00:00.000Z'), id: 'workflow-z' },
    });

    expect(page.items.map((item: { id: string }) => item.id)).toEqual(['workflow-c', 'workflow-b']);
    expect(page.nextCursor).toEqual({ createdAt, id: 'workflow-b' });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        ownerUserId: 'owner-1', contextType: 'collect', contextId: 'goods-1',
        suiteSlot: { is: null },
        OR: [
          { createdAt: { lt: new Date('2026-07-20T10:00:00.000Z') } },
          {
            createdAt: new Date('2026-07-20T10:00:00.000Z'),
            id: { lt: 'workflow-z' },
          },
        ],
      }),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 3,
    }));
  });

  it('queries priority as one owner/context lane with a frozen recent cutoff', async () => {
    const updatedAt = new Date('2026-07-20T09:00:00.000Z');
    const recentCutoff = new Date('2026-07-19T10:00:00.000Z');
    const findMany = vi.fn(async () => [
      { id: 'workflow-c', updatedAt, suiteSlot: null },
      { id: 'workflow-b', updatedAt, suiteSlot: null },
      { id: 'workflow-a', updatedAt, suiteSlot: null },
    ]);
    const repository = new PrismaAiMediaWorkflowRepository({
      aiMediaWorkflow: { findMany },
    } as never);

    const page = await repository.listPriorityOwned({
      ownerUserId: 'owner-1', contextType: 'collect', contextId: 'goods-1', limit: 2,
      cursor: {
        updatedAt: new Date('2026-07-20T10:00:00.000Z'),
        id: 'workflow-z',
        recentCutoff,
      },
    });

    expect(page.items.map((item: { id: string }) => item.id)).toEqual(['workflow-c', 'workflow-b']);
    expect(page.nextCursor).toEqual({ updatedAt, id: 'workflow-b', recentCutoff });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        ownerUserId: 'owner-1', contextType: 'collect', contextId: 'goods-1',
        suiteSlot: { is: null },
        AND: [
          {
            OR: [
              { status: { in: ['QUEUED', 'RUNNING', 'CANCEL_REQUESTED'] } },
              { status: 'SUCCEEDED', reviewStatus: 'PENDING' },
              {
                status: 'SUCCEEDED', reviewStatus: 'APPROVED',
                selectedOutputAsset: { is: { aiImageJob: { is: { appliedAt: null } } } },
              },
              {
                jobs: { some: { providerReconciliationStatus: {
                  in: ['PENDING', 'RUNNING', 'RETRY_WAIT', 'MANUAL_REVIEW'],
                } } },
              },
              { updatedAt: { gte: recentCutoff } },
            ],
          },
          {
            OR: [
              { updatedAt: { lt: new Date('2026-07-20T10:00:00.000Z') } },
              {
                updatedAt: new Date('2026-07-20T10:00:00.000Z'),
                id: { lt: 'workflow-z' },
              },
            ],
          },
        ],
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: 3,
    }));
  });

  it('atomically freezes an owner-scoped INPAINT source, mask, Prompt and zero-cost job', async () => {
    const inputCreates: any[] = [];
    const jobCreate = vi.fn(async ({ data }: any) => ({ id: 'edit-job-1', ...data }));
    const costCreate = vi.fn(async ({ data }: any) => ({ id: 'edit-cost-1', ...data }));
    const source = {
      id: 'source-1', ownerUserId: 'owner-1', kind: 'SOURCE_ORIGINAL',
      sha256: 'a'.repeat(64), sourceCaptureSnapshotId: 'snapshot-1',
      url: '/uploads/source.png', mimeType: 'image/png', width: 1000, height: 1000,
      storageBackend: 'local', storageKey: 'source.png', sizeBytes: 100,
      metadata: { pixelOrientationNormalized: true },
    };
    const mask = {
      id: 'mask-1', ownerUserId: 'owner-1', kind: 'EDIT_MASK',
      sha256: 'b'.repeat(64), sourceCaptureSnapshotId: 'snapshot-1',
      url: '/uploads/mask.png', mimeType: 'image/png', width: 1000, height: 1000,
      storageBackend: 'local', storageKey: 'mask.png', sizeBytes: 80,
      metadata: {
        maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
        sourceAssetId: 'source-1', sourceSha256: 'a'.repeat(64),
      },
    };
    const findMany = vi.fn(async () => [mask, source]);
    const tx = {
      mediaAsset: { findMany },
      supplyGoods: { findFirst: vi.fn(async () => ({
        id: 'goods-1', sourceCaptureSubject: { snapshots: [{ id: 'snapshot-1' }] },
      })) },
      aiMediaWorkflow: {
        findUnique: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({
          id: 'edit-workflow-1', operation: 'INPAINT', inputs: [], jobs: [], events: [],
        }),
        create: vi.fn(async ({ data }: any) => ({ id: 'edit-workflow-1', ...data })),
      },
      aiMediaWorkflowInput: {
        create: vi.fn(async ({ data }: any) => { inputCreates.push(data); return data; }),
      },
      aiImageJob: {
        aggregate: vi.fn(async () => ({ _sum: { requestedImageCount: 0, billedUnits: 0 } })),
        create: jobCreate,
      },
      aiCostReservation: { findUnique: vi.fn(async () => null), create: costCreate },
      aiMediaWorkflowEvent: { create: vi.fn(async () => ({})) },
    };
    const repository = new PrismaAiMediaWorkflowRepository({
      $transaction: vi.fn(async (callback: any) => callback(tx)),
    } as never);

    const result = await repository.createImageEdit({
      ownerUserId: 'owner-1', actorUserId: 'actor-1', operation: 'INPAINT',
      sourceAssetId: 'source-1', maskAssetId: 'mask-1',
      width: 1000, height: 1000,
      maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
      prompt: 'Remove label', negativePrompt: null,
      resolvedPrompt: 'Frozen edit prompt', resolvedNegativePrompt: 'Frozen constraints',
      templateKey: 'inpaint.base', templateReleaseId: 'release-1',
      templateChecksum: 'c'.repeat(64), templateSnapshot: { sequence: 1 },
      dailyLimit: 5,
      idempotencyKey: 'edit-idempotency-1', context: { type: 'collect', id: 'goods-1' },
    });

    expect(result).toMatchObject({ kind: 'created', jobId: 'edit-job-1' });
    expect(findMany).toHaveBeenCalledWith({
      where: { id: { in: ['source-1', 'mask-1'] }, ownerUserId: 'owner-1' },
      include: {
        aiImageJob: {
          include: { workflow: { include: { suiteSlot: true } } },
        },
      },
    });
    expect(inputCreates.map(({ role, ordinal, assetId }) => ({ role, ordinal, assetId }))).toEqual([
      { role: 'REFERENCE', ordinal: 0, assetId: 'source-1' },
      { role: 'MASK', ordinal: 0, assetId: 'mask-1' },
    ]);
    expect(jobCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      operation: 'INPAINT', provider: 'fake', model: 'fake-image-edit-v1',
      requestedImageCount: 1, width: 1000, height: 1000, maxAttempts: 1,
      resolvedPrompt: 'Frozen edit prompt', templateKey: 'inpaint.base',
      operationConfig: expect.objectContaining({
        policyVersion: 'ai-image-edit-policy/1.0',
        maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
      }),
    }) });
    expect(costCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      operation: 'INPAINT', estimatedCostMinor: 0, maximumCostMinor: 0,
    }) });
  });

  it('freezes paid FULL_EDIT Provider identity, runtime contract and cost in one transaction', async () => {
    const runtime = paidProviderRuntime(1000, 1000);
    const workflowCreate = vi.fn(async ({ data }: any) => ({ id: 'edit-paid-workflow-1', ...data }));
    const jobCreate = vi.fn(async ({ data }: any) => ({ id: 'edit-paid-job-1', ...data }));
    const costCreate = vi.fn(async ({ data }: any) => ({ id: 'edit-paid-cost-1', ...data }));
    const tx = {
      $queryRawUnsafe: vi.fn(async () => [{ locked: 1 }]),
      mediaAsset: { findMany: vi.fn(async () => [{
        id: 'source-1', ownerUserId: 'owner-1', kind: 'SOURCE_ORIGINAL',
        sha256: 'a'.repeat(64), sourceCaptureSnapshotId: 'snapshot-1',
        url: '/uploads/source.png', mimeType: 'image/png', width: 1000, height: 1000,
        storageBackend: 'local', storageKey: 'source.png', sizeBytes: 100,
        metadata: { pixelOrientationNormalized: true },
      }]) },
      supplyGoods: { findFirst: vi.fn(async () => ({
        id: 'goods-1', sourceCaptureSubject: { snapshots: [{ id: 'snapshot-1' }] },
      })) },
      aiMediaWorkflow: {
        findUnique: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({
          id: 'edit-paid-workflow-1', operation: 'FULL_EDIT', inputs: [], jobs: [], events: [],
        }),
        create: workflowCreate,
      },
      aiMediaWorkflowInput: { create: vi.fn(async ({ data }: any) => data) },
      aiImageJob: {
        aggregate: vi.fn(async () => ({ _sum: { requestedImageCount: 0, billedUnits: 0 } })),
        create: jobCreate,
      },
      aiCostSettlement: { aggregate: vi.fn(async () => ({ _sum: { actualCostMinor: 0 } })) },
      aiCostReservation: {
        aggregate: vi.fn(async () => ({ _sum: { maximumCostMinor: 0 } })),
        findUnique: vi.fn(async () => null), create: costCreate,
      },
      aiMediaWorkflowEvent: { create: vi.fn(async () => ({})) },
    };
    const repository = new PrismaAiMediaWorkflowRepository({
      $transaction: vi.fn(async (callback: any) => callback(tx)),
    } as never);

    await expect(repository.createImageEdit({
      ownerUserId: 'owner-1', actorUserId: 'actor-1', operation: 'FULL_EDIT',
      sourceAssetId: 'source-1', width: 1000, height: 1000,
      prompt: 'Clean background', negativePrompt: null,
      resolvedPrompt: 'Frozen edit prompt', resolvedNegativePrompt: 'Frozen constraints',
      templateKey: 'full-image-edit.base', templateReleaseId: 'release-1',
      templateChecksum: 'c'.repeat(64), templateSnapshot: { sequence: 1 },
      dailyLimit: 5, provider: 'openai-images', model: 'gpt-image-1',
      estimatedCostCents: 7, globalDailyBudgetCents: 100,
      providerRuntimeContract: runtime, idempotencyKey: 'edit-paid-1',
      context: { type: 'collect', id: 'goods-1' },
    })).resolves.toMatchObject({ kind: 'created', jobId: 'edit-paid-job-1' });
    expect(jobCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      provider: 'openai-images', model: 'gpt-image-1', estimatedCostCents: 7,
      operationConfig: expect.objectContaining({
        policyVersion: 'ai-image-edit-policy/1.0', providerRuntime: runtime,
      }),
    }) });
    expect(costCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      provider: 'openai-images', model: 'gpt-image-1',
      estimatedCostMinor: 7, maximumCostMinor: 7,
    }) });
    expect(tx.aiCostReservation.aggregate.mock.invocationCallOrder[0])
      .toBeLessThan(workflowCreate.mock.invocationCallOrder[0]!);
    expect(workflowCreate.mock.invocationCallOrder[0]).toBeLessThan(jobCreate.mock.invocationCallOrder[0]!);
    expect(jobCreate.mock.invocationCallOrder[0]).toBeLessThan(costCreate.mock.invocationCallOrder[0]!);
  });

  it('replays an edit before mutable source authority checks and conflicts on a different fingerprint', async () => {
    const input = {
      ownerUserId: 'owner-1', actorUserId: 'actor-1', operation: 'INPAINT' as const,
      sourceAssetId: 'source-1', maskAssetId: 'mask-1',
      width: 1000, height: 1000,
      maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
      prompt: 'Remove label', negativePrompt: null,
      resolvedPrompt: 'Frozen edit prompt', resolvedNegativePrompt: 'Frozen constraints',
      templateKey: 'inpaint.base', templateReleaseId: 'release-1',
      templateChecksum: 'c'.repeat(64), templateSnapshot: { sequence: 1 },
      dailyLimit: 1,
      idempotencyKey: 'edit-replay-1', context: { type: 'collect' as const, id: 'goods-1' },
    };
    const existing = {
      id: 'edit-workflow-1', ownerUserId: 'owner-1',
      requestFingerprint: aiMediaPayloadHash({
        request: createAiImageEditWorkflowFingerprint(input),
        sourceAssetSha256: 'a'.repeat(64),
        maskAssetSha256: 'b'.repeat(64),
      }),
      inputs: [
        { role: 'REFERENCE', ordinal: 0, assetSha256: 'a'.repeat(64) },
        { role: 'MASK', ordinal: 0, assetSha256: 'b'.repeat(64) },
      ],
      jobs: [{ id: 'edit-job-1', workflowAttempt: 1 }],
      events: [],
    };
    const tx = {
      aiMediaWorkflow: { findUnique: vi.fn(async () => existing) },
      mediaAsset: { findMany: vi.fn(async () => { throw new Error('mutable assets must not load'); }) },
      supplyGoods: { findFirst: vi.fn(async () => { throw new Error('mutable context must not load'); }) },
    };
    const repository = new PrismaAiMediaWorkflowRepository({
      $transaction: vi.fn(async (callback: any) => callback(tx)),
    } as never);

    await expect(repository.createImageEdit(input)).resolves.toMatchObject({
      kind: 'existing', jobId: 'edit-job-1',
    });
    await expect(repository.createImageEdit({ ...input, prompt: 'A different edit' })).resolves.toMatchObject({
      kind: 'conflict', jobId: 'edit-job-1',
    });
    expect(tx.mediaAsset.findMany).not.toHaveBeenCalled();
    expect(tx.supplyGoods.findFirst).not.toHaveBeenCalled();
  });

  it('freezes a normalized final candidate from a successful standalone edit in the same context', async () => {
    const candidate = {
      id: 'candidate-1', ownerUserId: 'owner-1', kind: 'AI_GENERATED',
      aiImageJobId: 'source-job-1',
      sha256: 'a'.repeat(64), sourceCaptureSnapshotId: 'snapshot-1',
      url: '/uploads/candidate.png', mimeType: 'image/png', width: 900, height: 1200,
      storageBackend: 'local', storageKey: 'candidate.png', sizeBytes: 100,
      metadata: {
        pixelOrientationNormalized: true,
        outputRole: 'FINAL_CANDIDATE',
        editSourceContractVersion: 'ai-media-edit-source/v1',
      },
      aiImageJob: {
        id: 'source-job-1', ownerUserId: 'owner-1', status: 'SUCCEEDED', operation: 'FULL_EDIT',
        workflowId: 'source-workflow-1', workflowAttempt: 1,
        workflow: {
          id: 'source-workflow-1', ownerUserId: 'owner-1', contextType: 'collect',
          contextId: 'goods-1', suiteSlot: null, status: 'SUCCEEDED', operation: 'FULL_EDIT',
          currentAttempt: 1, completedAt: new Date('2026-07-20T08:00:00.000Z'),
        },
      },
    };
    const inputCreates: any[] = [];
    const tx = {
      mediaAsset: { findMany: vi.fn(async () => [candidate]) },
      supplyGoods: { findFirst: vi.fn(async () => ({
        id: 'goods-1', sourceCaptureSubject: { snapshots: [{ id: 'snapshot-1' }] },
      })) },
      aiMediaWorkflow: {
        findUnique: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({
          id: 'chained-workflow-1', operation: 'FULL_EDIT', inputs: [], jobs: [], events: [],
        }),
        create: vi.fn(async ({ data }: any) => ({ id: 'chained-workflow-1', ...data })),
      },
      aiMediaWorkflowInput: {
        create: vi.fn(async ({ data }: any) => { inputCreates.push(data); return data; }),
      },
      aiImageJob: {
        aggregate: vi.fn(async () => ({ _sum: { requestedImageCount: 0, billedUnits: 0 } })),
        create: vi.fn(async ({ data }: any) => ({ id: 'chained-job-1', ...data })),
      },
      aiCostReservation: { findUnique: vi.fn(async () => null), create: vi.fn(async () => ({})) },
      aiMediaWorkflowEvent: { create: vi.fn(async () => ({})) },
    };
    const repository = new PrismaAiMediaWorkflowRepository({
      $transaction: vi.fn(async (callback: any) => callback(tx)),
    } as never);

    await expect(repository.createImageEdit({
      ownerUserId: 'owner-1', actorUserId: 'actor-1', operation: 'FULL_EDIT',
      sourceAssetId: candidate.id, width: 900, height: 1200,
      prompt: 'Refine the candidate', negativePrompt: null,
      resolvedPrompt: 'Frozen edit prompt', resolvedNegativePrompt: 'Frozen constraints',
      templateKey: 'full-image-edit.base', templateReleaseId: 'release-1',
      templateChecksum: 'c'.repeat(64), templateSnapshot: { sequence: 1 },
      dailyLimit: 5, idempotencyKey: 'candidate-chain-1',
      context: { type: 'collect', id: 'goods-1' },
    })).resolves.toMatchObject({ kind: 'created', jobId: 'chained-job-1' });
    expect(inputCreates).toEqual([expect.objectContaining({
      assetId: candidate.id, role: 'REFERENCE', ordinal: 0,
    })]);
  });

  it('rejects a legacy source that has not frozen orientation-normalized pixels', async () => {
    const source = {
      id: 'source-legacy', ownerUserId: 'owner-1', kind: 'SOURCE_ORIGINAL',
      sha256: 'a'.repeat(64), sourceCaptureSnapshotId: 'snapshot-1',
      url: '/uploads/source.jpg', mimeType: 'image/jpeg', width: 3, height: 2,
      storageBackend: 'local', storageKey: 'source.jpg', sizeBytes: 100, metadata: {},
    };
    const tx = {
      aiMediaWorkflow: { findUnique: vi.fn(async () => null) },
      mediaAsset: { findMany: vi.fn(async () => [source]) },
      supplyGoods: { findFirst: vi.fn(async () => ({
        id: 'goods-1', sourceCaptureSubject: { snapshots: [{ id: 'snapshot-1' }] },
      })) },
    };
    const repository = new PrismaAiMediaWorkflowRepository({
      $transaction: vi.fn(async (callback: any) => callback(tx)),
    } as never);

    await expect(repository.createImageEdit({
      ownerUserId: 'owner-1', actorUserId: 'actor-1', operation: 'FULL_EDIT',
      sourceAssetId: 'source-legacy', width: 3, height: 2,
      prompt: 'Clean background', negativePrompt: null,
      resolvedPrompt: 'Frozen edit prompt', resolvedNegativePrompt: 'Frozen constraints',
      templateKey: 'full-image-edit.base', templateReleaseId: 'release-1',
      templateChecksum: 'c'.repeat(64), templateSnapshot: { sequence: 1 },
      dailyLimit: 5, idempotencyKey: 'legacy-edit-source',
      context: { type: 'collect', id: 'goods-1' },
    })).rejects.toMatchObject({ code: 'SOURCE_ASSET_NOT_FOUND' });
  });

  it('rejects a new edit when the shared image-generation daily limit is exhausted', async () => {
    const source = {
      id: 'source-1', ownerUserId: 'owner-1', kind: 'SOURCE_ORIGINAL',
      sha256: 'a'.repeat(64), sourceCaptureSnapshotId: 'snapshot-1',
      url: '/uploads/source.png', mimeType: 'image/png', width: 1000, height: 1000,
      storageBackend: 'local', storageKey: 'source.png', sizeBytes: 100,
      metadata: { pixelOrientationNormalized: true },
    };
    const aggregate = vi.fn()
      .mockResolvedValueOnce({ _sum: { requestedImageCount: 1 } })
      .mockResolvedValueOnce({ _sum: { billedUnits: 0 } });
    const tx = {
      aiMediaWorkflow: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async () => { throw new Error('quota must fail before create'); }),
      },
      mediaAsset: { findMany: vi.fn(async () => [source]) },
      supplyGoods: { findFirst: vi.fn(async () => ({
        id: 'goods-1', sourceCaptureSubject: { snapshots: [{ id: 'snapshot-1' }] },
      })) },
      aiImageJob: { aggregate },
    };
    const repository = new PrismaAiMediaWorkflowRepository({
      $transaction: vi.fn(async (callback: any) => callback(tx)),
    } as never);

    await expect(repository.createImageEdit({
      ownerUserId: 'owner-1', actorUserId: 'actor-1', operation: 'FULL_EDIT',
      sourceAssetId: 'source-1', width: 1000, height: 1000,
      prompt: 'Clean background', negativePrompt: null,
      resolvedPrompt: 'Frozen edit prompt', resolvedNegativePrompt: 'Frozen constraints',
      templateKey: 'full-image-edit.base', templateReleaseId: 'release-1',
      templateChecksum: 'c'.repeat(64), templateSnapshot: { sequence: 1 },
      dailyLimit: 1,
      idempotencyKey: 'edit-quota-1', context: { type: 'collect', id: 'goods-1' },
    })).rejects.toMatchObject({ code: 'AI_IMAGE_EDIT_QUOTA_EXCEEDED' });
    expect(aggregate).toHaveBeenCalledTimes(2);
    expect(aggregate).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({
        status: { in: ['SUCCEEDED', 'FAILED', 'CANCELLED'] },
        billedUnits: { gt: 0 },
      }),
    }));
    expect(aggregate).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: unresolvedQuotaFilter,
    }));
    expect(tx.aiMediaWorkflow.create).not.toHaveBeenCalled();
  });

  it('creates an IMAGE_TRANSLATE child with frozen operation config and cost reservation', async () => {
    const jobCreate = vi.fn(async ({ data }: any) => ({ id: 'translation-job-1', ...data }));
    const costCreate = vi.fn(async ({ data }: any) => ({ id: 'cost-1', ...data }));
    const tx = {
      mediaAsset: { findMany: vi.fn(async () => [{
        id: 'asset-1', sha256: 'a'.repeat(64), sourceCaptureSnapshotId: 'snapshot-1',
        url: 'https://cdn.example/source.png', mimeType: 'image/png', width: 1200, height: 800,
      }]) },
      supplyGoods: { findFirst: vi.fn(async () => ({
        id: 'goods-1', sourceCaptureSubject: { snapshots: [{ id: 'snapshot-1' }] },
      })) },
      aiMediaWorkflow: {
        findUnique: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce({
          id: 'translation-workflow-1', operation: 'IMAGE_TRANSLATE', inputs: [], jobs: [], events: [],
        }),
        create: vi.fn(async ({ data }: any) => ({ id: 'translation-workflow-1', ...data })),
      },
      aiMediaWorkflowInput: { create: vi.fn(async ({ data }: any) => data) },
      aiImageJob: {
        aggregate: vi.fn(async () => ({ _sum: { requestedImageCount: 0, billedUnits: 0 } })),
        create: jobCreate,
      },
      aiCostReservation: { findUnique: vi.fn(async () => null), create: costCreate },
      aiMediaWorkflowEvent: { create: vi.fn(async () => ({})) },
    };
    const repository = new PrismaAiMediaWorkflowRepository({
      $transaction: vi.fn(async (callback: any) => callback(tx)),
    } as never);
    const result = await repository.createImageTranslation({
      ownerUserId: 'owner-1', actorUserId: 'actor-1', sourceAssetId: 'asset-1',
      sourceLanguage: 'zh', targetLanguage: 'ru', domainHint: 'safe', terminologies: [],
      imageSegment: false, provider: 'fake', model: 'fake-image-translation-v1',
      dailyLimit: 20, estimatedCostCents: 7, idempotencyKey: 'translation-idem-1',
      context: { type: 'collect', id: 'goods-1' },
      options: {
        sourceLanguage: 'zh', targetLanguage: 'ru', domainHint: 'Frozen safe policy',
        terminologies: [], imageSegment: false, policyVersion: 'ai-image-translation-policy/1.0',
      },
    });
    expect(result).toMatchObject({ kind: 'created', jobId: 'translation-job-1' });
    expect(jobCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      operation: 'IMAGE_TRANSLATE', provider: 'fake', model: 'fake-image-translation-v1',
      requestedImageCount: 1, width: 1200, height: 800, estimatedCostCents: 7,
      operationConfig: expect.objectContaining({
        sourceLanguage: 'zh', targetLanguage: 'ru', imageSegment: false,
        policyVersion: 'ai-image-translation-policy/1.0',
      }),
    }) });
    expect(costCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      operation: 'IMAGE_TRANSLATE', estimatedCostMinor: 7, maximumCostMinor: 7,
    }) });
    expect(tx.aiImageJob.aggregate).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: unresolvedQuotaFilter,
    }));
  });

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
      dailyLimit: 0, idempotencyKey: 'workflow-idem-multi', context: { type: 'collect', id: 'goods-1' },
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

  it('rejects IMAGE_TO_IMAGE creation when active and billed units exhaust the daily quota', async () => {
    const workflowCreate = vi.fn();
    const jobCreate = vi.fn();
    const aggregate = vi.fn()
      .mockResolvedValueOnce({ _sum: { requestedImageCount: 2 } })
      .mockResolvedValueOnce({ _sum: { billedUnits: 3 } });
    const tx = {
      mediaAsset: { findMany: vi.fn(async () => [{
        id: 'asset-1', sha256: 'a'.repeat(64), sourceCaptureSnapshotId: 'snapshot-1',
        url: 'https://cdn/1.png', mimeType: 'image/png', width: 1024, height: 1024,
      }]) },
      supplyGoods: { findFirst: vi.fn(async () => ({
        id: 'goods-1', sourceCaptureSubject: { snapshots: [{ id: 'snapshot-1' }] },
      })) },
      aiMediaWorkflow: { findUnique: vi.fn(async () => null), create: workflowCreate },
      aiImageJob: { aggregate, create: jobCreate },
    };

    await expect(new PrismaAiMediaWorkflowRepository({
      $transaction: vi.fn(async (callback: any) => callback(tx)),
    } as never).createImageToImage({
      ownerUserId: 'owner-1', actorUserId: 'actor-1', sourceAssetId: 'asset-1',
      prompt: 'Keep the product', negativePrompt: null, count: 1, width: 1024, height: 1024,
      dailyLimit: 5, idempotencyKey: 'workflow-quota-overflow',
      context: { type: 'collect', id: 'goods-1' },
    })).rejects.toMatchObject({
      code: 'AI_IMAGE_GENERATION_QUOTA_EXCEEDED', used: 5, limit: 5,
    });
    expect(aggregate).toHaveBeenCalledTimes(2);
    expect(aggregate).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: unresolvedQuotaFilter,
    }));
    expect(aggregate).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({
        ownerUserId: 'owner-1', status: { in: ['SUCCEEDED', 'FAILED', 'CANCELLED'] },
        billedUnits: { gt: 0 },
      }),
    }));
    expect(workflowCreate).not.toHaveBeenCalled();
    expect(jobCreate).not.toHaveBeenCalled();
  });

  it('locks and reserves the global budget before atomically freezing a paid IMAGE_TO_IMAGE job', async () => {
    const runtime = paidProviderRuntime();
    const lock = vi.fn(async () => [{ locked: 1 }]);
    const idempotencyRead = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'workflow-paid-1', inputs: [], jobs: [], events: [] });
    const workflowCreate = vi.fn(async ({ data }: any) => ({ id: 'workflow-paid-1', ...data }));
    const jobCreate = vi.fn(async ({ data }: any) => ({ id: 'job-paid-1', ...data }));
    const costCreate = vi.fn(async ({ data }: any) => ({ id: 'cost-paid-1', ...data }));
    const tx = {
      $queryRawUnsafe: lock,
      mediaAsset: { findMany: vi.fn(async () => [{
        id: 'asset-1', sha256: 'a'.repeat(64), sourceCaptureSnapshotId: 'snapshot-1',
        url: 'https://cdn/1.png', mimeType: 'image/png', width: 1024, height: 1024,
      }]) },
      supplyGoods: { findFirst: vi.fn(async () => ({
        id: 'goods-1', sourceCaptureSubject: { snapshots: [{ id: 'snapshot-1' }] },
      })) },
      aiMediaWorkflow: {
        findUnique: idempotencyRead,
        create: workflowCreate,
      },
      aiMediaWorkflowInput: { create: vi.fn(async ({ data }: any) => data) },
      aiImageJob: { create: jobCreate },
      aiCostSettlement: { aggregate: vi.fn(async () => ({ _sum: { actualCostMinor: 0 } })) },
      aiCostReservation: {
        aggregate: vi.fn(async () => ({ _sum: { maximumCostMinor: 0 } })),
        findUnique: vi.fn(async () => null),
        create: costCreate,
      },
      aiMediaWorkflowEvent: { create: vi.fn(async () => ({})) },
    };
    const repository = new PrismaAiMediaWorkflowRepository({
      $transaction: vi.fn(async (callback: any) => callback(tx)),
    } as never);

    await expect(repository.createImageToImage({
      ownerUserId: 'owner-1', actorUserId: 'actor-1', sourceAssetId: 'asset-1',
      prompt: 'Keep the product', negativePrompt: null, count: 1, width: 1024, height: 1024,
      dailyLimit: 0,
      provider: 'openai-images', model: 'gpt-image-1', estimatedCostCents: 7,
      globalDailyBudgetCents: 100, providerRuntimeContract: runtime,
      idempotencyKey: 'workflow-paid-1', context: { type: 'collect', id: 'goods-1' },
    })).resolves.toMatchObject({ kind: 'created', jobId: 'job-paid-1' });

    expect(jobCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      provider: 'openai-images', model: 'gpt-image-1', estimatedCostCents: 7,
      operationConfig: runtime,
    }) });
    expect(costCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      provider: 'openai-images', model: 'gpt-image-1',
      estimatedCostMinor: 7, maximumCostMinor: 7,
    }) });
    expect(lock.mock.invocationCallOrder[0]).toBeLessThan(idempotencyRead.mock.invocationCallOrder[0]!);
    expect(tx.aiCostReservation.aggregate.mock.invocationCallOrder[0])
      .toBeLessThan(workflowCreate.mock.invocationCallOrder[0]!);
    expect(workflowCreate.mock.invocationCallOrder[0]).toBeLessThan(jobCreate.mock.invocationCallOrder[0]!);
    expect(jobCreate.mock.invocationCallOrder[0]).toBeLessThan(costCreate.mock.invocationCallOrder[0]!);
  });

  it('rejects a paid IMAGE_TO_IMAGE budget overflow before creating any workflow state', async () => {
    const workflowCreate = vi.fn();
    const jobCreate = vi.fn();
    const costCreate = vi.fn();
    const tx = {
      $queryRawUnsafe: vi.fn(async () => [{ locked: 1 }]),
      mediaAsset: { findMany: vi.fn(async () => [{
        id: 'asset-1', sha256: 'a'.repeat(64), sourceCaptureSnapshotId: 'snapshot-1',
        url: 'https://cdn/1.png', mimeType: 'image/png', width: 1024, height: 1024,
      }]) },
      supplyGoods: { findFirst: vi.fn(async () => ({
        id: 'goods-1', sourceCaptureSubject: { snapshots: [{ id: 'snapshot-1' }] },
      })) },
      aiMediaWorkflow: { findUnique: vi.fn(async () => null), create: workflowCreate },
      aiCostSettlement: { aggregate: vi.fn(async () => ({ _sum: { actualCostMinor: 0 } })) },
      aiCostReservation: {
        aggregate: vi.fn(async () => ({ _sum: { maximumCostMinor: 95 } })),
        findUnique: vi.fn(), create: costCreate,
      },
      aiImageJob: { create: jobCreate },
    };
    const repository = new PrismaAiMediaWorkflowRepository({
      $transaction: vi.fn(async (callback: any) => callback(tx)),
    } as never);

    await expect(repository.createImageToImage({
      ownerUserId: 'owner-1', actorUserId: 'actor-1', sourceAssetId: 'asset-1',
      prompt: 'Keep the product', negativePrompt: null, count: 1, width: 1024, height: 1024,
      dailyLimit: 0,
      provider: 'openai-images', model: 'gpt-image-1', estimatedCostCents: 7,
      globalDailyBudgetCents: 100, providerRuntimeContract: paidProviderRuntime(),
      idempotencyKey: 'workflow-budget-overflow', context: { type: 'collect', id: 'goods-1' },
    })).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
    expect(workflowCreate).not.toHaveBeenCalled();
    expect(jobCreate).not.toHaveBeenCalled();
    expect(costCreate).not.toHaveBeenCalled();
  });

  it('locks before paid idempotency replay and conflicts when frozen cost configuration changes', async () => {
    const base = {
      ownerUserId: 'owner-1', actorUserId: 'actor-1', sourceAssetId: 'asset-1',
      prompt: 'Keep the product', negativePrompt: null, count: 1, width: 1024, height: 1024,
      dailyLimit: 0,
      provider: 'openai-images', model: 'gpt-image-1', estimatedCostCents: 7,
      globalDailyBudgetCents: 100, providerRuntimeContract: paidProviderRuntime(),
      idempotencyKey: 'workflow-paid-replay', context: { type: 'collect' as const, id: 'goods-1' },
    };
    const existing = {
      id: 'workflow-paid-replay', ownerUserId: 'owner-1',
      requestFingerprint: aiMediaPayloadHash({
        request: createAiMediaWorkflowFingerprint(base),
        sourceAssetSha256: 'a'.repeat(64),
      }),
      inputs: [{ assetSha256: 'a'.repeat(64) }],
      jobs: [{ id: 'job-paid-replay', workflowAttempt: 1 }], events: [],
    };
    const lock = vi.fn(async () => [{ locked: 1 }]);
    const idempotencyRead = vi.fn(async () => existing);
    const budgetAggregate = vi.fn();
    const tx = {
      $queryRawUnsafe: lock,
      aiMediaWorkflow: { findUnique: idempotencyRead },
      mediaAsset: { findMany: vi.fn() },
      aiCostReservation: { aggregate: budgetAggregate },
    };
    const repository = new PrismaAiMediaWorkflowRepository({
      $transaction: vi.fn(async (callback: any) => callback(tx)),
    } as never);

    await expect(repository.createImageToImage(base)).resolves.toMatchObject({
      kind: 'existing', jobId: 'job-paid-replay',
    });
    await expect(repository.createImageToImage({
      ...base,
      estimatedCostCents: 8,
      providerRuntimeContract: paidProviderRuntime(1024, 1024, 8),
    })).resolves.toMatchObject({ kind: 'conflict', jobId: 'job-paid-replay' });
    expect(lock).toHaveBeenCalledTimes(2);
    expect(lock.mock.invocationCallOrder[0]).toBeLessThan(idempotencyRead.mock.invocationCallOrder[0]!);
    expect(tx.mediaAsset.findMany).not.toHaveBeenCalled();
    expect(budgetAggregate).not.toHaveBeenCalled();
  });

  it('creates IMAGE_TO_IMAGE only for the current listing draft source/SKU/slot authority', async () => {
    const fixture = listingDraftImageToImageTransaction();
    const repository = new PrismaAiMediaWorkflowRepository(fixture.client as never);

    const result = await repository.createImageToImage(listingDraftImageToImageInput());

    expect(result).toMatchObject({ kind: 'created', jobId: 'job-listing-1' });
    expect(fixture.workflowCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      contextType: 'listing-draft', contextId: 'draft-1',
      contextSkuKey: 'sku-red', contextSlotKey: 'sku-hero',
      contextDraftRevision: 4, contextDraftVersion: 2,
    }) });
    expect(fixture.inputCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      assetId: 'asset-red', role: 'REFERENCE', ordinal: 0,
      assetSha256: 'a'.repeat(64),
    }) });
    expect(fixture.sourceListingWorkflowFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'draft-1', ownerUserId: 'owner-1' },
    }));
    expect(fixture.mediaAssetFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        ownerUserId: 'owner-1', sourceCaptureSnapshotId: 'snapshot-1',
        sourceMediaKey: expect.objectContaining({ in: expect.arrayContaining(['sku-red-1']) }),
      }),
    }));
  });

  it.each([
    {
      name: 'a stale draft revision',
      context: {
        type: 'listing-draft' as const, id: 'draft-1', skuKey: 'sku-red', slotKey: 'sku-hero',
        revision: 3, draftVersion: 2,
      },
      sourceAssetId: 'asset-red', code: 'STALE_MEDIA_CONTEXT',
    },
    {
      name: 'an unselected SKU',
      context: {
        type: 'listing-draft' as const, id: 'draft-1', skuKey: 'sku-blue', slotKey: 'sku-hero',
        revision: 4, draftVersion: 2,
      },
      sourceAssetId: 'asset-blue', code: 'AI_MEDIA_CONTEXT_MISMATCH',
    },
    {
      name: 'a product slot used as a SKU slot',
      context: {
        type: 'listing-draft' as const, id: 'draft-1', skuKey: 'sku-red', slotKey: 'main-1',
        revision: 4, draftVersion: 2,
      },
      sourceAssetId: 'asset-red', code: 'AI_MEDIA_CONTEXT_MISMATCH',
    },
    {
      name: 'a source asset outside the selected SKU context',
      context: {
        type: 'listing-draft' as const, id: 'draft-1', skuKey: 'sku-red', slotKey: 'sku-hero',
        revision: 4, draftVersion: 2,
      },
      sourceAssetId: 'asset-blue', code: 'AI_MEDIA_CONTEXT_MISMATCH',
    },
  ])('rejects $name without creating a workflow', async ({ context, sourceAssetId, code }) => {
    const fixture = listingDraftImageToImageTransaction();
    const repository = new PrismaAiMediaWorkflowRepository(fixture.client as never);

    await expect(repository.createImageToImage(listingDraftImageToImageInput({
      sourceAssetId,
      context,
      idempotencyKey: `listing-invalid-${sourceAssetId}-${context.slotKey}-${context.revision}`,
    }))).rejects.toMatchObject({ code });
    expect(fixture.workflowCreate).not.toHaveBeenCalled();
  });

  it('replays an existing listing-draft workflow without rereading mutable draft authority', async () => {
    const input = listingDraftImageToImageInput({ idempotencyKey: 'listing-replay-1' });
    const frozenHash = 'a'.repeat(64);
    const existing = {
      id: 'workflow-existing-listing', ownerUserId: 'owner-1',
      requestFingerprint: aiMediaPayloadHash({
        request: createAiMediaWorkflowFingerprint(input),
        sourceAssetSha256: frozenHash,
      }),
      inputs: [{ assetSha256: frozenHash }],
      jobs: [{ id: 'job-existing-listing', workflowAttempt: 1 }], events: [],
    };
    const draftRead = vi.fn(async () => { throw new Error('replay must not reread mutable listing draft'); });
    const assetRead = vi.fn(async () => { throw new Error('replay must not reread mutable source assets'); });
    const tx = {
      aiMediaWorkflow: { findUnique: vi.fn(async () => existing) },
      sourceListingWorkflow: { findFirst: draftRead },
      mediaAsset: { findMany: assetRead },
    };
    const client = { $transaction: vi.fn(async (callback: any) => callback(tx)) };

    const result = await new PrismaAiMediaWorkflowRepository(client as never)
      .createImageToImage(input as {
        ownerUserId: string; actorUserId: string; sourceAssetId: string;
        prompt: string; negativePrompt: string | null; count: number; width: number; height: number;
        dailyLimit: number; idempotencyKey: string; context: AiMediaWorkflowContext;
      });

    expect(result).toMatchObject({ kind: 'existing', jobId: 'job-existing-listing' });
    expect(draftRead).not.toHaveBeenCalled();
    expect(assetRead).not.toHaveBeenCalled();
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
      dailyLimit: 0, idempotencyKey: 'workflow-cost-failure', context: { type: 'collect', id: 'goods-1' },
    })).rejects.toThrow('cost reservation unavailable');
    expect(eventCreate).not.toHaveBeenCalled();
    expect(client.$transaction).toHaveBeenCalledTimes(1);
  });

  it('replays an existing workflow without charging quota or creating a second cost reservation', async () => {
    const costReservationCreate = vi.fn();
    const quotaAggregate = vi.fn();
    const existing = {
      id: 'workflow-1', requestFingerprint: '', inputs: [{ assetSha256: 'a'.repeat(64) }],
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
      aiImageJob: { aggregate: quotaAggregate },
      aiCostReservation: { create: costReservationCreate },
    };
    const client = { $transaction: vi.fn(async (callback: any) => callback(tx)) };
    const repository = new PrismaAiMediaWorkflowRepository(client as never);
    const input = {
      ownerUserId: 'owner-1', actorUserId: 'actor-1', sourceAssetId: 'asset-1',
      prompt: 'Keep the product', negativePrompt: null, count: 1, width: 1024, height: 1024,
      dailyLimit: 1, idempotencyKey: 'workflow-replay', context: { type: 'collect' as const, id: 'goods-1' },
    };
    const fingerprint = createAiMediaWorkflowFingerprint(input);
    const payloadHash = aiMediaPayloadHash({
      request: fingerprint,
      sourceAssetSha256: 'a'.repeat(64),
    });
    existing.requestFingerprint = payloadHash;

    const result = await repository.createImageToImage(input);
    expect(result).toMatchObject({ kind: 'existing', jobId: 'job-1' });
    expect(quotaAggregate).not.toHaveBeenCalled();
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
      dailyLimit: 0, idempotencyKey: 'workflow-idem-duplicate', context: { type: 'collect', id: 'goods-1' },
    })).rejects.toMatchObject({ code: 'SOURCE_ASSET_DUPLICATE' });
  });

  it('never creates a new attempt after the provider accepted the previous request', async () => {
    const tx = {
      aiMediaWorkflowEvent: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async () => ({})),
      },
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

  it('never creates a retry attempt after the collect source snapshot changes', async () => {
    const findPrevious = vi.fn();
    const createJob = vi.fn();
    const tx = {
      aiMediaWorkflowEvent: { findUnique: vi.fn(async () => null) },
      aiMediaWorkflow: {
        findFirst: vi.fn(async () => ({
          id: 'workflow-1', ownerUserId: 'owner-1', status: 'FAILED', revision: 3,
          currentAttempt: 1, contextType: 'collect', contextId: 'goods-1',
          inputs: [{ asset: { sourceCaptureSnapshotId: 'snapshot-old' } }],
        })),
      },
      supplyGoods: {
        findFirst: vi.fn(async () => ({
          sourceCaptureSubject: { snapshots: [{ id: 'snapshot-current' }] },
        })),
      },
      aiImageJob: { findFirst: findPrevious, create: createJob },
    };

    await expect(new PrismaAiMediaWorkflowRepository({
      $transaction: vi.fn(async (callback: any) => callback(tx)),
    } as never).retryOwned({
      id: 'workflow-1', ownerUserId: 'owner-1', actorUserId: 'actor-1',
      expectedRevision: 3, idempotencyKey: 'retry-stale-snapshot',
    })).rejects.toMatchObject({ code: 'STALE_MEDIA_WORKFLOW' });

    expect(findPrevious).not.toHaveBeenCalled();
    expect(createJob).not.toHaveBeenCalled();
  });

  it('never creates a retry attempt after the frozen listing draft advances', async () => {
    const findPrevious = vi.fn();
    const createJob = vi.fn();
    const tx = {
      aiMediaWorkflowEvent: { findUnique: vi.fn(async () => null) },
      aiMediaWorkflow: {
        findFirst: vi.fn(async () => ({
          id: 'workflow-1', ownerUserId: 'owner-1', status: 'FAILED', revision: 3,
          currentAttempt: 1, contextType: 'listing-draft', contextId: 'draft-1',
          contextDraftRevision: 4, contextDraftVersion: 2,
          contextSkuKey: 'sku-red', contextSlotKey: 'sku-hero',
          inputs: [{ asset: { sourceCaptureSnapshotId: 'snapshot-1' } }],
        })),
      },
      sourceListingWorkflow: { findFirst: vi.fn(async () => null) },
      mediaAsset: { findMany: vi.fn() },
      aiImageJob: { findFirst: findPrevious, create: createJob },
    };

    await expect(new PrismaAiMediaWorkflowRepository({
      $transaction: vi.fn(async (callback: any) => callback(tx)),
    } as never).retryOwned({
      id: 'workflow-1', ownerUserId: 'owner-1', actorUserId: 'actor-1',
      expectedRevision: 3, idempotencyKey: 'retry-stale-listing-draft',
    })).rejects.toMatchObject({ code: 'STALE_MEDIA_WORKFLOW' });

    expect(findPrevious).not.toHaveBeenCalled();
    expect(createJob).not.toHaveBeenCalled();
    expect(tx.mediaAsset.findMany).not.toHaveBeenCalled();
  });

  it.each(['SETTLED', 'RELEASED'])(
    'allows retry after provider result is terminal and cost is manually reconciled to %s',
    async (status) => {
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
          providerReconciliationStatus: 'NO_OUTPUT',
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
      expectedRevision: 3, idempotencyKey: `retry-after-${status.toLowerCase()}`, dailyLimit: 0,
    });

      expect(result).toMatchObject({ jobId: 'job-2', replayed: false });
      expect(jobCreate).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['PENDING', 'RUNNING', 'RETRY_WAIT', 'MANUAL_REVIEW'])(
    'blocks retry after cost reconciliation while provider result remains %s',
    async (providerReconciliationStatus) => {
      const jobCreate = vi.fn();
      const tx = {
        aiMediaWorkflowEvent: { findUnique: vi.fn(async () => null) },
        aiMediaWorkflow: { findFirst: vi.fn(async () => ({
          id: 'workflow-1', ownerUserId: 'owner-1', status: 'FAILED', revision: 3, currentAttempt: 1,
        })) },
        aiImageJob: {
          findFirst: vi.fn(async () => ({
            id: 'job-1', ownerUserId: 'owner-1', providerJobId: 'provider-task-accepted',
            errorCode: 'PROVIDER_RECOVERY_REQUIRED', providerReconciliationStatus,
          })),
          create: jobCreate,
        },
        aiCostReservation: { findUnique: vi.fn(async () => ({ id: 'cost-1', status: 'SETTLED' })) },
      };

      const result = await new PrismaAiMediaWorkflowRepository({
        $transaction: vi.fn(async (callback: any) => callback(tx)),
      } as never).retryOwned({
        id: 'workflow-1', ownerUserId: 'owner-1', actorUserId: 'actor-1',
        expectedRevision: 3, idempotencyKey: `retry-provider-${providerReconciliationStatus.toLowerCase()}`,
      });

      expect(result).toBeNull();
      expect(jobCreate).not.toHaveBeenCalled();
    },
  );

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
      expectedRevision: 3, idempotencyKey: 'retry-idem-cost', dailyLimit: 0,
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

  it('preserves translation cost and enforces the daily quota on retry', async () => {
    const fingerprint = 'e'.repeat(64);
    const jobCreate = vi.fn(async ({ data }: any) => ({ id: 'translation-job-2', ...data }));
    const costCreate = vi.fn(async ({ data }: any) => ({ id: 'translation-cost-2', ...data }));
    const aggregate = vi.fn()
      .mockResolvedValueOnce({ _sum: { requestedImageCount: 1 } })
      .mockResolvedValueOnce({ _sum: { billedUnits: 2 } });
    const tx = {
      aiMediaWorkflowEvent: { findUnique: vi.fn(async () => null), create: vi.fn(async () => ({})) },
      aiMediaWorkflow: {
        findFirst: vi.fn(async () => ({
          id: 'translation-workflow-1', ownerUserId: 'owner-1', status: 'FAILED', revision: 2,
          currentAttempt: 1, requestFingerprint: fingerprint,
        })),
        update: vi.fn(async () => ({})),
        findUnique: vi.fn(async () => ({
          id: 'translation-workflow-1', ownerUserId: 'owner-1', status: 'QUEUED', currentAttempt: 2,
          inputs: [], jobs: [{ id: 'translation-job-2', workflowAttempt: 2 }], events: [],
        })),
      },
      aiImageJob: {
        findFirst: vi.fn(async () => ({
          id: 'translation-job-1', ownerUserId: 'owner-1', providerJobId: null,
          operation: 'IMAGE_TRANSLATE', provider: 'fake', model: 'fake-image-translation-v1',
          prompt: 'Translate', negativePrompt: null, requestFingerprint: fingerprint,
          inputAssets: [], operationConfig: { policyVersion: 'ai-image-translation-policy/1.0' },
          requestedImageCount: 1, width: 1024, height: 1024, estimatedCostCents: 7,
        })),
        aggregate,
        create: jobCreate,
      },
      aiCostReservation: { findUnique: vi.fn(async () => null), create: costCreate },
    };
    const result = await new PrismaAiMediaWorkflowRepository({
      $transaction: vi.fn(async (callback: any) => callback(tx)),
    } as never).retryOwned({
      id: 'translation-workflow-1', ownerUserId: 'owner-1', actorUserId: 'actor-1',
      expectedRevision: 2, idempotencyKey: 'translation-retry-1', dailyLimit: 10,
    });
    expect(result).toMatchObject({ jobId: 'translation-job-2', replayed: false });
    expect(aggregate).toHaveBeenCalledTimes(2);
    expect(aggregate).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({
        status: { in: ['SUCCEEDED', 'FAILED', 'CANCELLED'] },
        billedUnits: { gt: 0 },
      }),
    }));
    expect(aggregate).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: unresolvedQuotaFilter,
    }));
    expect(jobCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      operation: 'IMAGE_TRANSLATE', estimatedCostCents: 7,
      operationConfig: { policyVersion: 'ai-image-translation-policy/1.0' },
    }) });
    expect(costCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      estimatedCostMinor: 7, maximumCostMinor: 7,
    }) });
  });

  it('enforces the shared image generation daily quota on an edit retry', async () => {
    const fingerprint = 'd'.repeat(64);
    const jobCreate = vi.fn(async ({ data }: any) => ({ id: 'edit-job-2', ...data }));
    const aggregate = vi.fn()
      .mockResolvedValueOnce({ _sum: { requestedImageCount: 2 } })
      .mockResolvedValueOnce({ _sum: { billedUnits: 3 } });
    const tx = {
      aiMediaWorkflowEvent: { findUnique: vi.fn(async () => null) },
      aiMediaWorkflow: {
        findFirst: vi.fn(async () => ({
          id: 'edit-workflow-1', ownerUserId: 'owner-1', status: 'FAILED', revision: 2,
          currentAttempt: 1, requestFingerprint: fingerprint,
        })),
        update: vi.fn(async () => ({})),
        findUnique: vi.fn(async () => ({
          id: 'edit-workflow-1', ownerUserId: 'owner-1', status: 'QUEUED', currentAttempt: 2,
          inputs: [], jobs: [{ id: 'edit-job-2', workflowAttempt: 2 }], events: [],
        })),
      },
      aiImageJob: {
        findFirst: vi.fn(async () => ({
          id: 'edit-job-1', ownerUserId: 'owner-1', providerJobId: null,
          operation: 'FULL_EDIT', provider: 'fake', model: 'fake-image-edit-v1',
          prompt: 'Clean background', negativePrompt: null, requestFingerprint: fingerprint,
          inputAssets: [], operationConfig: { policyVersion: 'ai-image-edit-policy/1.0' },
          requestedImageCount: 1, width: 1024, height: 1024, estimatedCostCents: 0,
        })),
        aggregate,
        create: jobCreate,
      },
      aiCostReservation: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async ({ data }: any) => ({ id: 'edit-cost-2', ...data })),
      },
    };

    await expect(new PrismaAiMediaWorkflowRepository({
      $transaction: vi.fn(async (callback: any) => callback(tx)),
    } as never).retryOwned({
      id: 'edit-workflow-1', ownerUserId: 'owner-1', actorUserId: 'actor-1',
      expectedRevision: 2, idempotencyKey: 'edit-retry-quota', dailyLimit: 5,
    })).rejects.toMatchObject({ code: 'AI_IMAGE_EDIT_QUOTA_EXCEEDED' });
    expect(aggregate).toHaveBeenCalledTimes(2);
    expect(aggregate).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: unresolvedQuotaFilter,
    }));
    expect(jobCreate).not.toHaveBeenCalled();
  });

  it('rejects an IMAGE_TO_IMAGE retry when active and billed units exhaust the daily quota', async () => {
    const fingerprint = 'c'.repeat(64);
    const jobCreate = vi.fn();
    const aggregate = vi.fn()
      .mockResolvedValueOnce({ _sum: { requestedImageCount: 2 } })
      .mockResolvedValueOnce({ _sum: { billedUnits: 3 } });
    const tx = {
      aiMediaWorkflowEvent: { findUnique: vi.fn(async () => null) },
      aiMediaWorkflow: {
        findFirst: vi.fn(async () => ({
          id: 'workflow-1', ownerUserId: 'owner-1', status: 'FAILED', revision: 2,
          currentAttempt: 1, requestFingerprint: fingerprint,
        })),
      },
      aiImageJob: {
        findFirst: vi.fn(async () => ({
          id: 'job-1', ownerUserId: 'owner-1', providerJobId: null,
          operation: 'IMAGE_TO_IMAGE', provider: 'fake', model: 'fake-image-to-image-v1',
          prompt: 'Retry prompt', negativePrompt: null, requestFingerprint: fingerprint,
          inputAssets: [], requestedImageCount: 1, width: 1024, height: 1024,
          estimatedCostCents: 0,
        })),
        aggregate,
        create: jobCreate,
      },
      aiCostReservation: { findUnique: vi.fn(async () => null), create: vi.fn() },
    };

    await expect(new PrismaAiMediaWorkflowRepository({
      $transaction: vi.fn(async (callback: any) => callback(tx)),
    } as never).retryOwned({
      id: 'workflow-1', ownerUserId: 'owner-1', actorUserId: 'actor-1',
      expectedRevision: 2, idempotencyKey: 'image-to-image-retry-quota', dailyLimit: 5,
    })).rejects.toMatchObject({
      code: 'AI_IMAGE_GENERATION_QUOTA_EXCEEDED', used: 5, limit: 5,
    });
    expect(aggregate).toHaveBeenCalledTimes(2);
    expect(aggregate).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: unresolvedQuotaFilter,
    }));
    expect(aggregate).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({
        ownerUserId: 'owner-1', status: { in: ['SUCCEEDED', 'FAILED', 'CANCELLED'] },
        billedUnits: { gt: 0 },
      }),
    }));
    expect(jobCreate).not.toHaveBeenCalled();
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
    const findOutput = vi.fn(async () => ({ id: 'output-1' }));
    const tx = {
      aiMediaWorkflow: {
        findFirst: vi.fn(async () => ({
          id: 'workflow-1', ownerUserId: 'owner-1', operation: 'INPAINT', currentAttempt: 2,
        })),
        update: vi.fn(async () => ({})),
        findUnique: vi.fn(async () => ({ id: 'workflow-1', reviewStatus: 'REJECTED' })),
      },
      mediaAsset: { findFirst: findOutput },
      aiMediaWorkflowEvent: { create: created },
    };
    const client = { $transaction: vi.fn(async (callback: any) => callback(tx)) };
    await new PrismaAiMediaWorkflowRepository(client as never).reviewOwned({
      id: 'workflow-1', ownerUserId: 'owner-1', actorUserId: 'actor-1',
      expectedRevision: 4, outputAssetId: 'output-1', decision: 'REJECT', note: null,
      operationKey: 'extension-media-review-operation-1',
    });
    expect(created).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventType: 'REVIEW_REJECTED',
        payload: { note: null, operationKey: 'extension-media-review-operation-1' },
      }),
    }));
    expect(findOutput).toHaveBeenCalledWith({ where: expect.objectContaining({
      id: 'output-1', ownerUserId: 'owner-1', kind: 'AI_GENERATED',
      aiImageJob: expect.objectContaining({
        workflowId: 'workflow-1', workflowAttempt: 2, operation: 'INPAINT', status: 'SUCCEEDED',
      }),
    }) });
  });
});
