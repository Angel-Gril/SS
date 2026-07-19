import { describe, expect, it, vi } from 'vitest';
import { createAiMediaContextService } from '../services/ai-media-context.js';

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

function client(ownerFound = true) {
  return {
    supplyGoods: {
      findFirst: vi.fn(async ({ where }: any) => ownerFound && where.userId === 'owner-1' ? {
        id: 'goods-1', title: 'Product',
        sourceCaptureSubject: { snapshots: [{ id: 'snapshot-1', version: 2, captureHash: 'hash-1', payload: capture }] },
      } : null),
    },
    mediaAsset: {
      findMany: vi.fn(async () => [{
        id: 'asset-1', ownerUserId: 'owner-1', sourceCaptureSnapshotId: 'snapshot-1',
        sourceMediaKey: 'main-1', sourceUrl: 'https://source.example/main.jpg',
        url: 'https://cdn.example/main.jpg', storageBackend: 'oss', storageKey: 'raw/main.jpg',
        mimeType: 'image/jpeg', sizeBytes: 100, width: 1000, height: 1000, kind: 'SOURCE_ORIGINAL',
      }]),
      findFirst: vi.fn(), create: vi.fn(),
    },
    sourceCaptureSnapshot: { findFirst: vi.fn() },
  };
}

describe('AI media collect context', () => {
  it('returns only product-level accepted images and their owned durable asset identity', async () => {
    const db = client();
    const result = await createAiMediaContextService(db as never).loadCollect('owner-1', 'goods-1');
    expect(result.target).toEqual({ type: 'collect', id: 'goods-1', label: 'Product' });
    expect(result.inputs).toEqual([expect.objectContaining({
      sourceMediaKey: 'main-1', assetId: 'asset-1', assetUrl: 'https://cdn.example/main.jpg',
    })]);
    expect(db.supplyGoods.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'goods-1', userId: 'owner-1' },
    }));
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
      {
        id: 'asset-ozon', sourceMediaKey: 'main-1', url: 'https://ozon.example/main.jpg',
        storageBackend: 'ozon-cdn', mimeType: 'image/jpeg', width: 1000, height: 1000,
      },
      {
        id: 'asset-oss', sourceMediaKey: 'main-1', url: 'https://oss.example/main.jpg',
        storageBackend: 'oss', mimeType: 'image/jpeg', width: 1000, height: 1000,
      },
      {
        id: 'asset-local', sourceMediaKey: 'main-1', url: 'http://localhost/main.jpg',
        storageBackend: 'local', mimeType: 'image/jpeg', width: 1000, height: 1000,
      },
    ] as any);

    const result = await createAiMediaContextService(db as never).loadCollect('owner-1', 'goods-1');

    expect(result.inputs[0]).toMatchObject({ assetId: 'asset-oss', assetUrl: 'https://oss.example/main.jpg' });
  });

  it('reuses an already internalized SOURCE_ORIGINAL without downloading it again', async () => {
    const result = await createAiMediaContextService(client() as never)
      .internalizeCollect('owner-1', 'goods-1', 'main-1');
    expect(result).toMatchObject({ id: 'asset-1', url: 'https://cdn.example/main.jpg' });
  });
});
