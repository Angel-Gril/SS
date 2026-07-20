import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import {
  AI_IMAGE_EDIT_MASK_SEMANTICS,
} from '../services/ai-image-compositor.js';
import {
  AI_IMAGE_EDIT_POLICY_VERSION,
  createAiImageEditMask,
  runAiImageEditJob,
} from '../services/ai-image-edit.js';
import type {
  AiImageJobRecord,
  AiImageJobRepository,
  AiImageProvider,
} from '../services/ai-image-jobs.js';
import {
  createAiImageEditWorkflowFingerprint,
  createAiMediaWorkflowService,
  type AiMediaWorkflowRecord,
  type AiMediaWorkflowRepository,
  type CreateAiImageEditWorkflowInput,
} from '../services/ai-media-workflows.js';

async function rgbaPng(width: number, height: number, pixels: number[]) {
  return sharp(Buffer.from(pixels), {
    raw: { width, height, channels: 4 },
  }).png().toBuffer();
}

async function maskPng(width: number, height: number, values: number[]) {
  return rgbaPng(width, height, values.flatMap((value) => [value, value, value, 255]));
}

const digest = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

function editJob(input: {
  operation: 'FULL_EDIT' | 'INPAINT';
  source: Buffer;
  mask?: Buffer;
}): AiImageJobRecord {
  const inputs: NonNullable<AiImageJobRecord['inputAssets']> = [{
    assetId: 'source-asset-1', role: 'REFERENCE', ordinal: 0,
    url: '/uploads/source.png', mimeType: 'image/png', sha256: digest(input.source),
    sizeBytes: input.source.length, width: 2, height: 2,
    storageBackend: 'local', storageKey: 'source.png',
    kind: 'SOURCE_ORIGINAL',
  }];
  if (input.mask) inputs.push({
    assetId: 'mask-asset-1', role: 'MASK', ordinal: 0,
    url: '/uploads/mask.png', mimeType: 'image/png', sha256: digest(input.mask),
    sizeBytes: input.mask.length, width: 2, height: 2,
    storageBackend: 'local', storageKey: 'mask.png',
    kind: 'EDIT_MASK',
  });
  return {
    id: 'edit-job-1', ownerUserId: 'owner-1', actorUserId: 'actor-1',
    status: 'QUEUED', operation: input.operation, provider: 'fake', model: 'fake-image-edit-v1',
    prompt: 'Remove the label while preserving the product', negativePrompt: null,
    requestedImageCount: 1, width: 2, height: 2, attemptCount: 0, maxAttempts: 1,
    idempotencyKey: 'edit-idempotency-1', estimatedCostCents: 0, actualCostCents: null,
    billedUnits: 0, providerJobId: null, errorCode: null, errorMessage: null,
    inputAssets: inputs,
    operationConfig: {
      policyVersion: AI_IMAGE_EDIT_POLICY_VERSION,
      ...(input.operation === 'INPAINT'
        ? { maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS }
        : {}),
    },
  };
}

function memoryRepository(initial: AiImageJobRecord) {
  let current = structuredClone(initial);
  const rawAssets: Array<Record<string, unknown>> = [];
  const completions: Array<Record<string, unknown>> = [];
  const repository: AiImageJobRepository = {
    getById: vi.fn(async () => structuredClone(current)),
    markRunning: vi.fn(async (_id, attemptCount) => {
      if (!['PENDING', 'QUEUED', 'RETRYING'].includes(current.status)) return false;
      current = { ...current, status: 'RUNNING', attemptCount };
      return true;
    }),
    markRetrying: vi.fn(),
    markFailed: vi.fn(async (_id, data) => {
      current = {
        ...current,
        status: 'FAILED',
        attemptCount: data.attemptCount,
        errorCode: data.errorCode,
        errorMessage: data.errorMessage,
      };
    }),
    markCancelled: vi.fn(async () => { current = { ...current, status: 'CANCELLED' }; }),
    recordProviderOutput: vi.fn(async (_id, asset) => {
      rawAssets.push(asset as unknown as Record<string, unknown>);
      return { id: 'raw-asset-1', ...asset };
    }),
    complete: vi.fn(async (_id, data) => {
      completions.push(data as unknown as Record<string, unknown>);
      current = {
        ...current,
        status: 'SUCCEEDED',
        actualCostCents: data.actualCostCents,
        billedUnits: data.billedUnits,
      };
    }),
    createWithQuota: vi.fn(),
    requestCancellation: vi.fn(async () => {
      current = { ...current, status: 'CANCEL_REQUESTED' };
      return structuredClone(current);
    }),
    recordApplication: vi.fn(),
  };
  return { repository, current: () => current, rawAssets, completions };
}

function provider(image: Buffer): AiImageProvider {
  return {
    name: 'fake',
    generate: vi.fn(async () => ({ images: [{ buffer: image, mimeType: 'image/png' }], actualCostCents: 0 })),
  };
}

describe('AI image manual edit lifecycle', () => {
  it('treats an uncoordinated duplicate RUNNING invocation as a no-op', async () => {
    const source = await rgbaPng(2, 2, new Array(16).fill(10));
    const initial = editJob({ operation: 'FULL_EDIT', source });
    initial.status = 'RUNNING';
    initial.attemptCount = 1;
    const state = memoryRepository(initial);

    await expect(runAiImageEditJob('edit-job-1', 1, {
      repository: state.repository,
      provider: provider(source),
      loadInputBuffer: vi.fn(),
      uploadBuffer: vi.fn(),
    })).resolves.toBe('ignored');

    expect(state.repository.markFailed).not.toHaveBeenCalled();
  });

  it('persists separate raw and reviewable assets for a full-image edit without mutating the source', async () => {
    const source = await rgbaPng(2, 2, new Array(16).fill(10));
    const candidate = await rgbaPng(2, 2, new Array(16).fill(210));
    const state = memoryRepository(editJob({ operation: 'FULL_EDIT', source }));
    const uploadBuffer = vi.fn(async (_buffer: Buffer, filename: string) => ({
      url: `/uploads/${filename}`, backend: 'local', key: filename,
    }));

    await expect(runAiImageEditJob('edit-job-1', 1, {
      repository: state.repository,
      provider: provider(candidate),
      loadInputBuffer: vi.fn(async () => source),
      uploadBuffer,
    })).resolves.toBe('completed');

    expect(state.rawAssets).toEqual([
      expect.objectContaining({ kind: 'AI_PROVIDER_OUTPUT', sha256: digest(candidate) }),
    ]);
    expect(state.completions[0]).toMatchObject({
      actualCostCents: 0,
      billedUnits: 1,
      assets: [expect.objectContaining({
        kind: 'AI_GENERATED', sha256: digest(candidate),
        metadata: expect.objectContaining({ outputRole: 'FINAL_CANDIDATE' }),
      })],
    });
    expect(uploadBuffer).toHaveBeenCalledTimes(1);
  });

  it('derives the durable raw filename and MIME type from the decoded Provider bytes', async () => {
    const source = await rgbaPng(2, 2, new Array(16).fill(10));
    const candidate = await sharp({
      create: { width: 2, height: 2, channels: 3, background: { r: 200, g: 190, b: 180 } },
    }).webp().toBuffer();
    const state = memoryRepository(editJob({ operation: 'FULL_EDIT', source }));
    const uploadBuffer = vi.fn(async (_buffer: Buffer, filename: string) => ({
      url: `/uploads/${filename}`, backend: 'local', key: filename,
    }));
    const selectedProvider: AiImageProvider = {
      name: 'fake',
      generate: vi.fn(async () => ({
        images: [{ buffer: candidate, mimeType: 'image/png' }], actualCostCents: 0,
      })),
    };

    await runAiImageEditJob('edit-job-1', 1, {
      repository: state.repository,
      provider: selectedProvider,
      loadInputBuffer: vi.fn(async () => source),
      uploadBuffer,
    });

    expect(uploadBuffer).toHaveBeenCalledWith(
      candidate,
      'edit-edit-job-1-provider-raw.webp',
      'image/webp',
      expect.any(Object),
    );
    expect(state.rawAssets[0]).toMatchObject({ mimeType: 'image/webp' });
    expect(state.completions[0]).toMatchObject({
      assets: [expect.objectContaining({ mimeType: 'image/webp' })],
    });
  });

  it('composites an inpaint candidate and preserves every black-mask source pixel', async () => {
    const source = await rgbaPng(2, 2, [
      10, 20, 30, 255, 40, 50, 60, 255,
      70, 80, 90, 255, 100, 110, 120, 255,
    ]);
    const candidate = await rgbaPng(2, 2, new Array(16).fill(200));
    const mask = await maskPng(2, 2, [0, 255, 0, 255]);
    const state = memoryRepository(editJob({ operation: 'INPAINT', source, mask }));
    const uploaded: Buffer[] = [];

    await runAiImageEditJob('edit-job-1', 1, {
      repository: state.repository,
      provider: provider(candidate),
      loadInputBuffer: vi.fn(async (asset) => asset.role === 'MASK' ? mask : source),
      uploadBuffer: vi.fn(async (buffer, filename) => {
        uploaded.push(buffer);
        return { url: `/uploads/${filename}`, backend: 'local', key: filename };
      }),
    });

    expect(uploaded).toHaveLength(2);
    const final = await sharp(uploaded[1]!).ensureAlpha().raw().toBuffer();
    expect([...final]).toEqual([
      10, 20, 30, 255, 200, 200, 200, 200,
      70, 80, 90, 255, 200, 200, 200, 200,
    ]);
    expect(state.completions[0]).toMatchObject({
      assets: [expect.objectContaining({
        kind: 'AI_GENERATED',
        metadata: expect.objectContaining({
          outputRole: 'FINAL_COMPOSITE',
          maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
          preservedPixelCount: 2,
        }),
      })],
    });
  });

  it('rejects stale frozen source bytes before provider submission', async () => {
    const source = await rgbaPng(2, 2, new Array(16).fill(10));
    const changed = await rgbaPng(2, 2, new Array(16).fill(11));
    const state = memoryRepository(editJob({ operation: 'FULL_EDIT', source }));
    const selectedProvider = provider(source);

    await expect(runAiImageEditJob('edit-job-1', 1, {
      repository: state.repository,
      provider: selectedProvider,
      loadInputBuffer: vi.fn(async () => changed),
      uploadBuffer: vi.fn(),
    })).rejects.toMatchObject({ code: 'FROZEN_INPUT_MISMATCH' });

    expect(selectedProvider.generate).not.toHaveBeenCalled();
    expect(state.current()).toMatchObject({ status: 'FAILED', errorCode: 'FROZEN_INPUT_MISMATCH' });
  });

  it('keeps local and object-storage diagnostics out of persisted public failures', async () => {
    const source = await rgbaPng(2, 2, new Array(16).fill(10));
    const state = memoryRepository(editJob({ operation: 'FULL_EDIT', source }));
    const selectedProvider = provider(source);
    const privateDiagnostic = 'ENOENT: D:\\private-install\\uploads\\source.png';

    await expect(runAiImageEditJob('edit-job-1', 1, {
      repository: state.repository,
      provider: selectedProvider,
      loadInputBuffer: vi.fn(async () => { throw new Error(privateDiagnostic); }),
      uploadBuffer: vi.fn(),
    })).rejects.toThrow(privateDiagnostic);

    expect(state.current()).toMatchObject({
      status: 'FAILED',
      errorCode: 'EDIT_PROCESSING_FAILED',
      errorMessage: 'AI image edit processing failed',
    });
    expect(state.current().errorMessage).not.toContain('private-install');
    expect(selectedProvider.generate).not.toHaveBeenCalled();
  });

  it('terminalizes cancellation when processing fails after the cancel request wins', async () => {
    const source = await rgbaPng(2, 2, new Array(16).fill(10));
    const state = memoryRepository(editJob({ operation: 'FULL_EDIT', source }));
    const privateFailure = new Error('storage failed after cancellation');

    await expect(runAiImageEditJob('edit-job-1', 1, {
      repository: state.repository,
      provider: provider(source),
      loadInputBuffer: vi.fn(async () => {
        await state.repository.requestCancellation('edit-job-1', 'owner-1');
        throw privateFailure;
      }),
      uploadBuffer: vi.fn(),
    })).resolves.toBe('ignored');

    expect(state.repository.markCancelled).toHaveBeenCalledWith('edit-job-1');
    expect(state.repository.markFailed).not.toHaveBeenCalled();
    expect(state.current()).toMatchObject({ status: 'CANCELLED' });
  });

  it('fails before Provider dispatch when raw-output persistence is unavailable', async () => {
    const source = await rgbaPng(2, 2, new Array(16).fill(10));
    const candidate = await rgbaPng(2, 2, new Array(16).fill(210));
    const state = memoryRepository(editJob({ operation: 'FULL_EDIT', source }));
    state.repository.recordProviderOutput = undefined;
    const selectedProvider = provider(candidate);
    const uploadBuffer = vi.fn();

    await expect(runAiImageEditJob('edit-job-1', 1, {
      repository: state.repository,
      provider: selectedProvider,
      loadInputBuffer: vi.fn(async () => source),
      uploadBuffer,
    })).rejects.toMatchObject({ code: 'EDIT_PERSISTENCE_NOT_READY' });

    expect(selectedProvider.generate).not.toHaveBeenCalled();
    expect(uploadBuffer).not.toHaveBeenCalled();
  });

  it('keeps the raw provider output when final composite storage fails', async () => {
    const source = await rgbaPng(2, 2, new Array(16).fill(10));
    const candidate = await rgbaPng(2, 2, new Array(16).fill(210));
    const mask = await maskPng(2, 2, [0, 255, 0, 255]);
    const state = memoryRepository(editJob({ operation: 'INPAINT', source, mask }));
    const uploadBuffer = vi.fn()
      .mockResolvedValueOnce({ url: '/uploads/raw.png', backend: 'local', key: 'raw.png' })
      .mockRejectedValueOnce(new Error('final storage offline'));

    await expect(runAiImageEditJob('edit-job-1', 1, {
      repository: state.repository,
      provider: provider(candidate),
      loadInputBuffer: vi.fn(async (asset) => asset.role === 'MASK' ? mask : source),
      uploadBuffer,
    })).rejects.toThrow('final storage offline');

    expect(state.repository.recordProviderOutput).toHaveBeenCalledTimes(1);
    expect(state.repository.complete).not.toHaveBeenCalled();
    expect(state.current()).toMatchObject({ status: 'FAILED' });
  });
});

describe('AI image manual edit workflow contract', () => {
  const workflow: AiMediaWorkflowRecord = {
    id: 'edit-workflow-1', ownerUserId: 'owner-1', actorUserId: 'actor-1',
    operation: 'FULL_EDIT', status: 'QUEUED', reviewStatus: 'NOT_READY',
    revision: 1, currentAttempt: 1, contextType: 'collect', contextId: 'goods-1',
    contextSkuKey: null, contextSlotKey: null, idempotencyKey: 'edit-workflow-idem-1',
    requestFingerprint: 'a'.repeat(64), selectedOutputAssetId: null,
    createdAt: new Date(), updatedAt: new Date(), completedAt: null,
  };
  const repository = (resultKind: 'created' | 'existing' | 'conflict' = 'created') => ({
    createImageToImage: vi.fn(),
    createImageEdit: vi.fn(async (input: CreateAiImageEditWorkflowInput) => ({
      kind: resultKind,
      workflow: { ...workflow, operation: input.operation },
      jobId: 'edit-job-1',
    })),
    listOwned: vi.fn(async () => []),
    getOwned: vi.fn(async () => null),
    cancelOwned: vi.fn(async () => null),
    retryOwned: vi.fn(async () => null),
    reviewOwned: vi.fn(async () => null),
  }) satisfies AiMediaWorkflowRepository;
  const fullEdit: CreateAiImageEditWorkflowInput = {
    ownerUserId: 'owner-1', actorUserId: 'actor-1', operation: 'FULL_EDIT',
    sourceAssetId: 'source-asset-1', prompt: 'Remove the printed label', negativePrompt: null,
    resolvedPrompt: 'Frozen full edit prompt', resolvedNegativePrompt: 'Frozen constraints',
    templateKey: 'full-image-edit.base', templateReleaseId: 'release-1',
    templateChecksum: 'a'.repeat(64), templateSnapshot: { sequence: 1 },
    dailyLimit: 5,
    idempotencyKey: 'edit-workflow-idem-1', context: { type: 'collect', id: 'goods-1' },
  };

  it('creates provider-neutral FULL_EDIT and INPAINT workflows with exact mask cardinality', async () => {
    const repo = repository();
    const service = createAiMediaWorkflowService(repo);
    await expect(service.createImageEdit(fullEdit)).resolves.toMatchObject({
      jobId: 'edit-job-1', workflow: { operation: 'FULL_EDIT' }, replayed: false,
    });
    await expect(service.createImageEdit({
      ...fullEdit,
      operation: 'INPAINT',
      maskAssetId: 'mask-asset-1',
      maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
      templateKey: 'inpaint.base',
      idempotencyKey: 'inpaint-workflow-idem-1',
    })).resolves.toMatchObject({ workflow: { operation: 'INPAINT' } });
    expect(repo.createImageEdit).toHaveBeenCalledTimes(2);
  });

  it('rejects missing, extra or inverted mask contracts before persistence', async () => {
    const repo = repository();
    const service = createAiMediaWorkflowService(repo);
    await expect(service.createImageEdit({
      ...fullEdit,
      operation: 'INPAINT',
      templateKey: 'inpaint.base',
    })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(service.createImageEdit({
      ...fullEdit,
      maskAssetId: 'mask-asset-1',
      maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
    })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(service.createImageEdit({
      ...fullEdit,
      operation: 'INPAINT',
      maskAssetId: 'mask-asset-1',
      maskSemantics: 'BLACK_EDIT_WHITE_PRESERVE_V1' as never,
      templateKey: 'inpaint.base',
    })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(repo.createImageEdit).not.toHaveBeenCalled();
  });

  it('rejects an invalid edit resource limit before persistence', async () => {
    const repo = repository();
    const service = createAiMediaWorkflowService(repo);

    await expect(service.createImageEdit({
      ...fullEdit,
      dailyLimit: -1,
    })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(repo.createImageEdit).not.toHaveBeenCalled();
  });

  it('binds idempotency to the operation, source, mask and frozen Prompt snapshot', () => {
    const base = createAiImageEditWorkflowFingerprint(fullEdit);
    expect(base).not.toBe(createAiImageEditWorkflowFingerprint({
      ...fullEdit,
      templateSnapshot: { sequence: 2 },
    }));
    expect(base).not.toBe(createAiImageEditWorkflowFingerprint({
      ...fullEdit,
      operation: 'INPAINT',
      maskAssetId: 'mask-asset-1',
      maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
      templateKey: 'inpaint.base',
    }));
  });
});

describe('AI image edit mask authority', () => {
  it('binds a validated mask to the owned current source snapshot with content-addressed storage', async () => {
    const mask = await maskPng(2, 2, [0, 255, 0, 128]);
    const create = vi.fn(async ({ data }: any) => ({ id: 'mask-asset-1', ...data }));
    const database = {
      supplyGoods: { findFirst: vi.fn(async () => ({
        id: 'goods-1', sourceCaptureSubject: { snapshots: [{ id: 'snapshot-1' }] },
      })) },
      mediaAsset: {
        findFirst: vi.fn()
          .mockResolvedValueOnce({
            id: 'source-asset-1', ownerUserId: 'owner-1', kind: 'SOURCE_ORIGINAL',
            sourceCaptureSnapshotId: 'snapshot-1', sha256: 'a'.repeat(64), width: 2, height: 2,
            url: '/uploads/source.png', mimeType: 'image/png',
            storageBackend: 'local', storageKey: 'source.png', sizeBytes: 100,
            metadata: { pixelOrientationNormalized: true },
          })
          .mockResolvedValueOnce(null),
        create,
      },
    };
    const uploadBuffer = vi.fn(async () => ({
      url: '/uploads/mask.png', backend: 'local', key: 'mask.png',
    }));

    const result = await createAiImageEditMask({
      ownerUserId: 'owner-1', actorUserId: 'actor-1', contextId: 'goods-1',
      sourceAssetId: 'source-asset-1', maskBuffer: mask,
      maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
    }, { database, getStorage: async () => ({ uploadBuffer }) });

    expect(result).toMatchObject({ asset: { id: 'mask-asset-1', kind: 'EDIT_MASK' }, replayed: false });
    expect(uploadBuffer).toHaveBeenCalledWith(mask, expect.stringMatching(/^edit-mask-/u), 'image/png', expect.objectContaining({
      category: 'raw', ownerId: 'owner-1', idempotencyKey: expect.stringMatching(/^[a-f0-9]{64}$/u),
    }));
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({
      ownerUserId: 'owner-1', sourceCaptureSnapshotId: 'snapshot-1',
      sourceMediaKey: expect.stringContaining('source-asset-1'),
      metadata: expect.objectContaining({
        sourceAssetId: 'source-asset-1', sourceSha256: 'a'.repeat(64),
        maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
      }),
    }) });
  });

  it('fails before storage when the source is not owned by the current collect snapshot', async () => {
    const mask = await maskPng(2, 2, [0, 255, 0, 255]);
    const uploadBuffer = vi.fn();
    await expect(createAiImageEditMask({
      ownerUserId: 'owner-1', actorUserId: 'actor-1', contextId: 'goods-1',
      sourceAssetId: 'other-source', maskBuffer: mask,
      maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
    }, {
      database: {
        supplyGoods: { findFirst: vi.fn(async () => ({
          id: 'goods-1', sourceCaptureSubject: { snapshots: [{ id: 'snapshot-1' }] },
        })) },
        mediaAsset: { findFirst: vi.fn(async () => null), create: vi.fn() },
      },
      getStorage: async () => ({ uploadBuffer }),
    })).rejects.toMatchObject({ code: 'SOURCE_ASSET_NOT_FOUND' });
    expect(uploadBuffer).not.toHaveBeenCalled();
  });

  it('does not consume upload quota when a content-addressed mask is replayed', async () => {
    const mask = await maskPng(2, 2, [0, 255, 0, 255]);
    const checkUploadLimits = vi.fn(async () => ({ allowed: false as const, reason: 'quota exhausted' }));
    const getStorage = vi.fn();
    const source = {
      id: 'source-asset-1', ownerUserId: 'owner-1', kind: 'SOURCE_ORIGINAL',
      sourceCaptureSnapshotId: 'snapshot-1', sha256: 'a'.repeat(64),
      width: 2, height: 2, sizeBytes: 100,
      url: '/uploads/source.png', mimeType: 'image/png',
      storageBackend: 'local', storageKey: 'source.png',
      metadata: { pixelOrientationNormalized: true },
    };
    const existing = {
      id: 'mask-asset-1', ownerUserId: 'owner-1', kind: 'EDIT_MASK',
      sourceCaptureSnapshotId: 'snapshot-1',
      sourceMediaKey: `edit-mask:${source.id}:${digest(mask)}`,
      url: '/uploads/mask.png', storageBackend: 'local', storageKey: 'mask.png',
      mimeType: 'image/png', sizeBytes: mask.length, width: 2, height: 2,
      sha256: digest(mask),
      metadata: {
        maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
        sourceAssetId: source.id, sourceSha256: source.sha256,
      },
    };

    await expect(createAiImageEditMask({
      ownerUserId: 'owner-1', actorUserId: 'actor-1', contextId: 'goods-1',
      sourceAssetId: source.id, maskBuffer: mask,
      maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
    }, {
      database: {
        supplyGoods: { findFirst: vi.fn(async () => ({
          id: 'goods-1', sourceCaptureSubject: { snapshots: [{ id: 'snapshot-1' }] },
        })) },
        mediaAsset: {
          findFirst: vi.fn().mockResolvedValueOnce(source).mockResolvedValueOnce(existing),
          create: vi.fn(),
        },
      },
      getStorage,
      checkUploadQuota: checkUploadLimits,
    })).resolves.toMatchObject({ replayed: true, asset: { id: 'mask-asset-1' } });

    expect(checkUploadLimits).not.toHaveBeenCalled();
    expect(getStorage).not.toHaveBeenCalled();
  });

  it('checks upload quota after validation but before storing a new mask', async () => {
    const mask = await maskPng(2, 2, [0, 255, 0, 255]);
    const checkUploadLimits = vi.fn(async () => ({ allowed: false as const, reason: 'quota exhausted' }));
    const getStorage = vi.fn();
    const create = vi.fn();

    await expect(createAiImageEditMask({
      ownerUserId: 'owner-1', actorUserId: 'actor-1', contextId: 'goods-1',
      sourceAssetId: 'source-asset-1', maskBuffer: mask,
      maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
    }, {
      database: {
        supplyGoods: { findFirst: vi.fn(async () => ({
          id: 'goods-1', sourceCaptureSubject: { snapshots: [{ id: 'snapshot-1' }] },
        })) },
        mediaAsset: {
          findFirst: vi.fn()
            .mockResolvedValueOnce({
              id: 'source-asset-1', ownerUserId: 'owner-1', kind: 'SOURCE_ORIGINAL',
              sourceCaptureSnapshotId: 'snapshot-1', sha256: 'a'.repeat(64),
              width: 2, height: 2, sizeBytes: 100,
              url: '/uploads/source.png', mimeType: 'image/png',
              storageBackend: 'local', storageKey: 'source.png',
              metadata: { pixelOrientationNormalized: true },
            })
            .mockResolvedValueOnce(null),
          create,
        },
      },
      getStorage,
      checkUploadQuota: checkUploadLimits,
    })).rejects.toMatchObject({ code: 'EDIT_RESOURCE_QUOTA_EXCEEDED' });

    expect(checkUploadLimits).toHaveBeenCalledWith('owner-1', mask.length);
    expect(getStorage).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('fails before storage when the current source is not readable through trusted edit storage', async () => {
    const mask = await maskPng(2, 2, [0, 255, 0, 255]);
    const getStorage = vi.fn();
    await expect(createAiImageEditMask({
      ownerUserId: 'owner-1', actorUserId: 'actor-1', contextId: 'goods-1',
      sourceAssetId: 'source-asset-1', maskBuffer: mask,
      maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
    }, {
      database: {
        supplyGoods: { findFirst: vi.fn(async () => ({
          id: 'goods-1', sourceCaptureSubject: { snapshots: [{ id: 'snapshot-1' }] },
        })) },
        mediaAsset: {
          findFirst: vi.fn(async () => ({
            id: 'source-asset-1', ownerUserId: 'owner-1', kind: 'SOURCE_ORIGINAL',
            sourceCaptureSnapshotId: 'snapshot-1', sha256: 'a'.repeat(64),
            width: 2, height: 2, sizeBytes: 100,
            storageBackend: 'ozon-cdn', storageKey: null,
          })),
          create: vi.fn(),
        },
      },
      getStorage,
    })).rejects.toMatchObject({ code: 'SOURCE_ASSET_NOT_FOUND' });
    expect(getStorage).not.toHaveBeenCalled();
  });

  it('rejects a persisted mask replay whose metadata no longer matches the source contract', async () => {
    const mask = await maskPng(2, 2, [0, 255, 0, 255]);
    const getStorage = vi.fn();
    await expect(createAiImageEditMask({
      ownerUserId: 'owner-1', actorUserId: 'actor-1', contextId: 'goods-1',
      sourceAssetId: 'source-asset-1', maskBuffer: mask,
      maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
    }, {
      database: {
        supplyGoods: { findFirst: vi.fn(async () => ({
          id: 'goods-1', sourceCaptureSubject: { snapshots: [{ id: 'snapshot-1' }] },
        })) },
        mediaAsset: {
          findFirst: vi.fn()
            .mockResolvedValueOnce({
              id: 'source-asset-1', ownerUserId: 'owner-1', kind: 'SOURCE_ORIGINAL',
              sourceCaptureSnapshotId: 'snapshot-1', sha256: 'a'.repeat(64),
              width: 2, height: 2, sizeBytes: 100,
              url: '/uploads/source.png', mimeType: 'image/png',
              storageBackend: 'local', storageKey: 'source.png',
              metadata: { pixelOrientationNormalized: true },
            })
            .mockResolvedValueOnce({
              id: 'mask-asset-1', ownerUserId: 'owner-1', kind: 'EDIT_MASK',
              sourceCaptureSnapshotId: 'snapshot-1',
              sourceMediaKey: `edit-mask:source-asset-1:${digest(mask)}`,
              url: '/uploads/mask.png', storageBackend: 'local', storageKey: 'mask.png',
              mimeType: 'image/png', sizeBytes: mask.length, width: 2, height: 2,
              sha256: digest(mask),
              metadata: {
                maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
                sourceAssetId: 'different-source', sourceSha256: 'a'.repeat(64),
              },
            }),
          create: vi.fn(),
        },
      },
      getStorage,
    })).rejects.toMatchObject({ code: 'INVALID_MEDIA_INPUT' });
    expect(getStorage).not.toHaveBeenCalled();
  });
});
