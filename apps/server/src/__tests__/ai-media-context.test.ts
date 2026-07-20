import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import {
  AI_MEDIA_EDIT_SOURCE_MAX_BYTES,
  createAiMediaContextService,
  normalizeAiMediaSourceBuffer,
} from '../services/ai-media-context.js';

const capture = {
  captureVersion: 'source-product-capture-v2',
  media: [{
    key: 'main-1', kind: 'image', disposition: 'accepted', role: 'main', skuKeys: [],
    url: 'https://source.example/main.jpg',
  }, {
    key: 'sku-1', kind: 'image', disposition: 'accepted', role: 'sku', skuKeys: ['sku-red'],
    url: 'https://source.example/red.jpg',
  }],
};

function editReadyAsset(overrides: Record<string, unknown> = {}) {
  return {
    id: 'asset-1', ownerUserId: 'owner-1', sourceCaptureSnapshotId: 'snapshot-1',
    sourceMediaKey: 'main-1', sourceUrl: 'https://source.example/main.jpg',
    url: 'https://cdn.example/main.jpg', storageBackend: 'oss', storageKey: 'raw/main.jpg',
    mimeType: 'image/jpeg', sizeBytes: 100, width: 1000, height: 1000,
    sha256: 'a'.repeat(64), kind: 'SOURCE_ORIGINAL', metadata: { pixelOrientationNormalized: true },
    ...overrides,
  };
}

function client(ownerFound = true) {
  return {
    supplyGoods: {
      findFirst: vi.fn(async ({ where }: any) => ownerFound && where.userId === 'owner-1' ? {
        id: 'goods-1', title: 'Product',
        sourceCaptureSubject: { snapshots: [{ id: 'snapshot-1', version: 2, captureHash: 'hash-1', payload: capture }] },
      } : null),
    },
    mediaAsset: {
      findMany: vi.fn(async () => [editReadyAsset()]),
      findFirst: vi.fn(), create: vi.fn(),
    },
    sourceCaptureSnapshot: { findFirst: vi.fn() },
  };
}

describe('AI media collect context', () => {
  it('normalizes EXIF-oriented source pixels before freezing edit dimensions', async () => {
    const oriented = await sharp({
      create: { width: 3, height: 2, channels: 3, background: { r: 200, g: 100, b: 50 } },
    }).jpeg().withMetadata({ orientation: 6 }).toBuffer();

    const normalized = await normalizeAiMediaSourceBuffer({
      buffer: oriented,
      mimeType: 'image/jpeg',
    });

    expect(normalized).toMatchObject({
      width: 2,
      height: 3,
      sourceOrientation: 6,
      orientationNormalizationApplied: true,
    });
    await expect(sharp(normalized.buffer).metadata()).resolves.toMatchObject({
      width: 2,
      height: 3,
    });
  });

  it('rejects compressed source images beyond the edit pixel or byte contract', async () => {
    const oversizedPixels = await sharp({
      create: { width: 4000, height: 4000, channels: 3, background: '#ffffff' },
    }).jpeg().withMetadata({ orientation: 6 }).toBuffer();

    await expect(normalizeAiMediaSourceBuffer({
      buffer: oversizedPixels,
      mimeType: 'image/jpeg',
    })).rejects.toMatchObject({ code: 'INVALID_MEDIA_INPUT', statusCode: 400 });
    await expect(normalizeAiMediaSourceBuffer({
      buffer: Buffer.alloc(AI_MEDIA_EDIT_SOURCE_MAX_BYTES + 1),
      mimeType: 'image/jpeg',
    })).rejects.toMatchObject({ code: 'INVALID_MEDIA_INPUT', statusCode: 400 });
  });

  it('returns only product-level accepted images and their owned durable asset identity', async () => {
    const db = client();
    const result = await createAiMediaContextService(db as never).loadCollect('owner-1', 'goods-1');
    expect(result.target).toEqual({ type: 'collect', id: 'goods-1', label: 'Product' });
    expect(result.inputs).toEqual([expect.objectContaining({
      sourceMediaKey: 'main-1', assetId: 'asset-1', assetUrl: 'https://cdn.example/main.jpg', editReady: true,
    })]);
    expect(db.supplyGoods.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'goods-1', userId: 'owner-1' },
    }));
  });

  it('keeps legacy source IDs compatible when an edit-ready companion becomes preferred', async () => {
    const db = client();
    db.mediaAsset.findMany.mockResolvedValue([
      editReadyAsset({
        id: 'legacy-source', sourceMediaKey: 'main-1', metadata: {},
      }),
      editReadyAsset({
        id: 'edit-companion',
        sourceMediaKey: `ai-edit-source:v1:${createHash('sha256').update('main-1').digest('hex')}`,
        metadata: { pixelOrientationNormalized: true, originalSourceMediaKey: 'main-1' },
      }),
    ] as any);

    const result = await createAiMediaContextService(db as never).loadCollect('owner-1', 'goods-1');

    expect(result.inputs[0]).toMatchObject({
      assetId: 'edit-companion',
      editReady: true,
    });
    expect(result.inputs[0]!.compatibleAssetIds).toEqual(['edit-companion', 'legacy-source']);
  });

  it('does not expose a collect context owned by another tenant', async () => {
    const service = createAiMediaContextService(client(false) as never);
    await expect(service.loadCollect('owner-2', 'goods-1')).rejects.toMatchObject({
      code: 'AI_MEDIA_CONTEXT_NOT_FOUND', statusCode: 404,
    });
  });

  it('selects the OSS source variant deterministically when multiple storage copies exist', async () => {
    const db = client();
    db.mediaAsset.findMany.mockResolvedValue([
      editReadyAsset({
        id: 'asset-ozon', sourceMediaKey: 'main-1', url: 'https://ozon.example/main.jpg',
        storageBackend: 'ozon-cdn', mimeType: 'image/jpeg', width: 1000, height: 1000,
      }),
      editReadyAsset({
        id: 'asset-oss', sourceMediaKey: 'main-1', url: 'https://oss.example/main.jpg',
        storageBackend: 'oss', mimeType: 'image/jpeg', width: 1000, height: 1000,
      }),
      editReadyAsset({
        id: 'asset-local', sourceMediaKey: 'main-1', url: 'http://localhost/main.jpg',
        storageBackend: 'local', mimeType: 'image/jpeg', width: 1000, height: 1000,
      }),
    ] as any);

    const result = await createAiMediaContextService(db as never).loadCollect('owner-1', 'goods-1');

    expect(result.inputs[0]).toMatchObject({ assetId: 'asset-oss', assetUrl: 'https://oss.example/main.jpg' });
  });

  it('reuses an edit-ready SOURCE_ORIGINAL without downloading it again', async () => {
    const result = await createAiMediaContextService(client() as never)
      .internalizeCollect('owner-1', 'goods-1', 'main-1', 'EDIT');
    expect(result).toMatchObject({ id: 'asset-1', url: 'https://cdn.example/main.jpg', editReady: true });
  });

  it('creates a bounded normalized companion for an incompatible legacy source', async () => {
    const oriented = await sharp({
      create: { width: 3, height: 2, channels: 3, background: '#806040' },
    }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const db = client();
    const legacy = editReadyAsset({
      id: 'legacy-local', storageBackend: 'local', storageKey: 'legacy.jpg',
      sha256: null, metadata: {}, width: 3, height: 2,
    });
    db.mediaAsset.findMany.mockResolvedValue([legacy] as any);
    db.mediaAsset.findFirst.mockResolvedValue(legacy as any);
    db.mediaAsset.create.mockImplementation(async ({ data }: any) => ({ id: 'normalized-1', ...data }));
    let uploadedBuffer: Buffer | null = null;
    const uploadBuffer = vi.fn(async (buffer: Buffer) => {
      uploadedBuffer = buffer;
      return {
      url: '/uploads/normalized.jpg', backend: 'local', key: 'raw/normalized.jpg', filename: 'normalized.jpg',
      };
    });
    const download = vi.fn(async () => {
      throw new Error('owned local storage should be preferred');
    });
    const loadStoredSourceAsset = vi.fn(async () => oriented);
    const service = createAiMediaContextService(db as never, {
      downloadPublicImage: download,
      sanitizeOzonPublishImageBuffer: vi.fn(async () => ({
        buffer: oriented, filename: 'source.jpg', mimeType: 'image/jpeg' as const,
        converted: false, sourceFormat: 'jpeg',
      })),
      getStorageBackend: vi.fn(async () => ({ uploadBuffer }) as never),
      loadStoredSourceAsset,
    });

    const result = await service.internalizeCollect('owner-1', 'goods-1', 'main-1', 'EDIT');

    expect(result).toMatchObject({
      id: 'normalized-1', storageBackend: 'local', width: 2, height: 3, editReady: true,
    });
    expect(loadStoredSourceAsset).toHaveBeenCalledWith(expect.objectContaining({ id: 'legacy-local' }));
    expect(download).not.toHaveBeenCalled();
    expect(uploadBuffer).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.stringMatching(/^ai-edit-source-[a-f0-9]{24}\.jpg$/u),
      'image/jpeg',
      expect.objectContaining({ ownerId: 'owner-1', idempotencyKey: expect.stringMatching(/^[a-f0-9]{64}$/u) }),
    );
    const created = db.mediaAsset.create.mock.calls[0]![0].data;
    expect(created).toMatchObject({
      sourceMediaKey: expect.stringMatching(/^ai-edit-source:v1:[a-f0-9]{64}$/u),
      width: 2,
      height: 3,
      metadata: expect.objectContaining({
        originalSourceMediaKey: 'main-1',
        pixelOrientationNormalized: true,
        sourceOrientation: 6,
        sourceReadMode: 'owned_storage',
      }),
    });
    expect(uploadedBuffer).not.toBeNull();
    await expect(sharp(uploadedBuffer!).metadata()).resolves.toMatchObject({
      width: 2,
      height: 3,
    });
  });

  it('keeps the legacy GENERAL internalize contract for images above the edit pixel limit', async () => {
    const large = await sharp({
      create: { width: 4000, height: 4000, channels: 3, background: '#806040' },
    }).jpeg().toBuffer();
    const db = client();
    db.mediaAsset.findMany.mockResolvedValue([] as any);
    db.mediaAsset.create.mockImplementation(async ({ data }: any) => ({ id: 'general-1', ...data }));
    const uploadBuffer = vi.fn(async () => ({
      url: '/uploads/general.jpg', backend: 'local', key: 'general.jpg', filename: 'general.jpg',
    }));
    const service = createAiMediaContextService(db as never, {
      downloadPublicImage: vi.fn(async () => ({
        buffer: large,
        contentType: 'image/jpeg',
        sourceUrl: 'https://source.example/main.jpg',
        finalUrl: 'https://source.example/main.jpg',
        redirectCount: 0,
      })),
      sanitizeOzonPublishImageBuffer: vi.fn(async () => ({
        buffer: large, filename: 'general.jpg', mimeType: 'image/jpeg' as const,
        converted: false, sourceFormat: 'jpeg',
      })),
      getStorageBackend: vi.fn(async () => ({ uploadBuffer }) as never),
    });

    const result = await service.internalizeCollect('owner-1', 'goods-1', 'main-1', 'GENERAL');

    expect(result).toMatchObject({ id: 'general-1', width: 4000, height: 4000, editReady: false });
    expect(db.mediaAsset.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      sourceMediaKey: 'main-1',
      metadata: expect.objectContaining({ lineageVersion: 'ai-media-source/v1' }),
    }) });
  });
});
