import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { OzonListingDraft } from 'shared';
import {
  createSourceListingMediaImportService,
  type SourceListingMediaSelection,
} from '../services/source-listing-media-import.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

function draft(overrides: Partial<OzonListingDraft> = {}): OzonListingDraft {
  return {
    id: 'draft-1',
    ownerUserId: 'owner-1',
    shopId: 'shop-1',
    supplyGoodsId: 'goods-1',
    sourceCaptureSnapshotId: 'snapshot-1',
    sourceCaptureHash: 'a'.repeat(64),
    selectedSkuKeys: ['sku-1'],
    revision: 4,
    draftVersion: 3,
    stage: 'MEDIA_REVIEW',
    runState: 'ACTIVE',
    runStateReason: null,
    category: null,
    attributes: { values: {} },
    copy: { publishTitleRu: null, publishDescriptionRu: null, candidates: [], applyAudit: [] },
    media: { assignments: [] },
    pricing: { value: null },
    validation: { status: 'STALE', report: null },
    completedStepHashes: {}, blockers: [], warnings: [], publishTaskIds: [],
    freshness: Object.fromEntries(['category', 'attributes', 'content', 'media', 'pricing', 'validation'].map((key) => [key, { state: 'CURRENT', reason: null }])) as OzonListingDraft['freshness'],
    grantRevocation: { required: false, reason: null, previousShopId: null },
    auditEvents: [], createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z',
    ...overrides,
  };
}

function media(key: string, overrides: Record<string, unknown> = {}) {
  return {
    key,
    kind: 'image',
    role: 'product_main',
    url: `https://img.example.com/${key}.png`,
    skuKeys: [],
    disposition: 'accepted',
    ...overrides,
  } as any;
}

function setup(overrides: Record<string, unknown> = {}) {
  const findReusableAsset = vi.fn(async () => null);
  const createAsset = vi.fn(async (input: any) => ({ id: `asset-${input.sourceMediaKey}`, ...input }));
  const download = vi.fn(async (url: string) => ({
    sourceUrl: url,
    finalUrl: url,
    contentType: 'image/png',
    buffer: PNG,
    redirectCount: 0,
  }));
  const uploadBuffer = vi.fn(async () => ({
    url: 'https://cdn.example.com/owner/product.png',
    filename: 'owner/product.png',
    backend: 'oss' as const,
  }));
  const service = createSourceListingMediaImportService({
    loadCaptureAuthority: vi.fn(async () => ({
      snapshotId: 'snapshot-1',
      captureHash: 'a'.repeat(64),
      media: [media('main-1'), media('sku-image', { role: 'sku', skuKeys: ['sku-1'] })],
    })),
    findReusableAsset,
    loadOwnedAssets: vi.fn(async () => []),
    createAsset,
    download,
    getStorageBackend: vi.fn(async () => ({ uploadBuffer })),
    ...overrides,
  } as any);
  return { service, findReusableAsset, createAsset, download, uploadBuffer };
}

describe('source listing media import', () => {
  it('transfers large captures in bounded pages instead of rejecting every image', async () => {
    const fixture = setup();
    const download = vi.fn(async (url: string) => ({ sourceUrl: url, finalUrl: url,
      contentType: 'image/png', buffer: PNG, redirectCount: 0 }));
    const rows = Array.from({ length: 105 }, (_, index) => media(`source-${index}`));
    const { service } = setup({ download,
      loadCaptureAuthority: vi.fn(async () => ({ snapshotId: 'snapshot-1', captureHash: 'a'.repeat(64), media: rows })),
      getCaptureStorageBackend: vi.fn(async () => ({ backendType: 'oss', uploadBuffer: fixture.uploadBuffer })),
    });
    const first = await service.internalizeCapture({ ownerUserId: 'owner-1', snapshotId: 'snapshot-1', captureHash: 'a'.repeat(64) });
    expect(first.assets).toHaveLength(100);
    expect(first).toMatchObject({ nextOffset: 100, total: 105, errors: [] });
    const second = await service.internalizeCapture({ ownerUserId: 'owner-1', snapshotId: 'snapshot-1',
      captureHash: 'a'.repeat(64), offset: 100 } as any);
    expect(second.assets).toHaveLength(5);
    expect(second).toMatchObject({ nextOffset: 105, total: 105, errors: [] });
    expect(download).toHaveBeenCalledTimes(105);
  });
  it('internalizes capture main and SKU images before a draft exists without creating assignments', async () => {
    const fixture = setup();
    const getCaptureStorageBackend = vi.fn(async () => ({ backendType: 'oss', uploadBuffer: fixture.uploadBuffer }));
    const { service, createAsset } = setup({ getCaptureStorageBackend });
    const result = await (service as any).internalizeCapture({
      ownerUserId: 'owner-1', snapshotId: 'snapshot-1', captureHash: 'a'.repeat(64),
    });
    expect(result.assets.map((asset: any) => asset.sourceMediaKey)).toEqual(['main-1', 'sku-image']);
    expect(result.errors).toEqual([]);
    expect(result).not.toHaveProperty('assignments');
    expect(createAsset.mock.calls.map(([asset]) => asset)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'SOURCE_ORIGINAL', sourceCaptureSnapshotId: 'snapshot-1',
        sourceMediaKey: 'sku-image', sourceUrl: 'https://img.example.com/sku-image.png',
        storageBackend: 'oss', width: 1, height: 1, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    ]));
  });

  it('refuses another owner or stale capture before downloading or uploading', async () => {
    const { service, download, uploadBuffer } = setup({ loadCaptureAuthority: vi.fn(async () => null) });
    await expect((service as any).internalizeCapture({
      ownerUserId: 'other-owner', snapshotId: 'snapshot-1', captureHash: 'a'.repeat(64),
    })).rejects.toMatchObject({ code: 'SOURCE_LISTING_MEDIA_AUTHORITY_STALE' });
    expect(download).not.toHaveBeenCalled();
    expect(uploadBuffer).not.toHaveBeenCalled();
  });

  it('refuses non-owned storage without attempting an Ozon upload', async () => {
    const { service, download, uploadBuffer } = setup({
      getCaptureStorageBackend: vi.fn(async () => ({ backendType: 'ozon-cdn', uploadBuffer: vi.fn() })),
    });
    await expect((service as any).internalizeCapture({
      ownerUserId: 'owner-1', snapshotId: 'snapshot-1', captureHash: 'a'.repeat(64),
    })).rejects.toMatchObject({ code: 'SOURCE_LISTING_MEDIA_STORAGE_UNAVAILABLE' });
    expect(download).not.toHaveBeenCalled();
    expect(uploadBuffer).not.toHaveBeenCalled();
  });

  it('does not reuse an old Ozon CDN source asset during capture transfer', async () => {
    const oldAsset = {
      id: 'old-ozon', ownerUserId: 'owner-1', kind: 'SOURCE_ORIGINAL' as const,
      sourceCaptureSnapshotId: 'snapshot-1', sourceMediaKey: 'main-1', sourceUrl: 'https://img.example.com/main-1.png',
      url: 'https://cdn.ozon.ru/old.png', storageBackend: 'ozon-cdn', storageKey: 'old.png',
      mimeType: 'image/png', sizeBytes: PNG.length, width: 1, height: 1, sha256: 'a'.repeat(64),
    };
    const { service, download, uploadBuffer } = setup({
      findReusableAsset: vi.fn(async () => oldAsset),
      getCaptureStorageBackend: vi.fn(async () => ({ backendType: 'oss', uploadBuffer: vi.fn(async () => ({
        url: 'https://cdn.example.com/new.png', filename: 'new.png', backend: 'oss' as const, key: 'new.png',
      })) })),
    });
    const result = await (service as any).internalizeCapture({ ownerUserId: 'owner-1', snapshotId: 'snapshot-1', captureHash: 'a'.repeat(64) });
    expect(result.assets[0]?.storageBackend).toBe('oss');
    expect(result.assets[0]?.url).toBe('https://cdn.example.com/new.png');
    expect(download).toHaveBeenCalled();
    expect(uploadBuffer).not.toHaveBeenCalled();
  });

  it('keeps successful source assets and reports failed media keys without echoing raw errors', async () => {
    const fixture = setup();
    const { service } = setup({
      getCaptureStorageBackend: vi.fn(async () => ({ backendType: 'oss', uploadBuffer: fixture.uploadBuffer })),
      download: vi.fn(async (url: string) => {
        if (url.includes('sku-image')) throw new Error('private-token must never appear');
        return { sourceUrl: url, finalUrl: url, contentType: 'image/png', buffer: PNG, redirectCount: 0 };
      }),
    });
    const result = await (service as any).internalizeCapture({ ownerUserId: 'owner-1',
      snapshotId: 'snapshot-1', captureHash: 'a'.repeat(64) });
    expect(result.assets).toHaveLength(1);
    expect(result.errors).toEqual([{ sourceMediaKey: 'sku-image', code: 'SOURCE_IMAGE_TRANSFER_FAILED' }]);
    expect(JSON.stringify(result)).not.toContain('private-token');
  });

  it('imports exact capture media into durable owned assets and builds reviewed assignments', async () => {
    const { service, createAsset, download, uploadBuffer } = setup();
    const result = await service.internalize({
      ownerUserId: 'owner-1',
      draft: draft(),
      selections: [
        { sourceMediaKey: 'main-1', slotKey: 'product-main', scope: 'PRODUCT' },
        { sourceMediaKey: 'sku-image', slotKey: 'sku-1-main', scope: 'SKU', skuKey: 'sku-1' },
      ],
    });

    expect(download).toHaveBeenCalledTimes(2);
    expect(uploadBuffer).toHaveBeenCalledTimes(2);
    expect(createAsset).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 'owner-1',
      kind: 'SOURCE_ORIGINAL',
      sourceCaptureSnapshotId: 'snapshot-1',
      sourceMediaKey: 'main-1',
      sourceUrl: 'https://img.example.com/main-1.png',
      storageBackend: 'oss',
      storageKey: 'owner/product.png',
      mimeType: 'image/png',
      sizeBytes: PNG.length,
      sha256: createHash('sha256').update(PNG).digest('hex'),
    }));
    expect(result.assignments).toEqual([
      { assetId: 'asset-main-1', slotKey: 'product-main', source: 'SOURCE', scope: 'PRODUCT' },
      { assetId: 'asset-sku-image', slotKey: 'sku-1-main', source: 'SOURCE', scope: 'SKU', skuKey: 'sku-1' },
    ]);
  });

  it('reuses an immutable snapshot/media asset without downloading or uploading again', async () => {
    const existing = {
      id: 'asset-existing', ownerUserId: 'owner-1', sourceCaptureSnapshotId: 'snapshot-1',
      sourceMediaKey: 'main-1', sourceUrl: 'https://img.example.com/main-1.png',
      url: 'https://cdn.example.com/existing.png', storageBackend: 'oss', storageKey: 'existing.png',
      mimeType: 'image/png', sizeBytes: PNG.length, sha256: 'b'.repeat(64),
    };
    const { service, download, uploadBuffer, createAsset } = setup({
      findReusableAsset: vi.fn(async () => existing),
    });
    const result = await service.internalize({
      ownerUserId: 'owner-1', draft: draft(),
      selections: [{ sourceMediaKey: 'main-1', slotKey: 'product-main', scope: 'PRODUCT' }],
    });
    expect(download).not.toHaveBeenCalled();
    expect(uploadBuffer).not.toHaveBeenCalled();
    expect(createAsset).not.toHaveBeenCalled();
    expect(result.assignments[0]?.assetId).toBe('asset-existing');
  });

  it('fails closed for non-capture, rejected, video and invalid SKU-scoped media', async () => {
    const cases = [
      { key: 'missing', selection: { sourceMediaKey: 'missing', slotKey: 'x', scope: 'PRODUCT' } },
      { key: 'rejected', row: media('rejected', { disposition: 'rejected' }), selection: { sourceMediaKey: 'rejected', slotKey: 'x', scope: 'PRODUCT' } },
      { key: 'video', row: media('video', { kind: 'video' }), selection: { sourceMediaKey: 'video', slotKey: 'x', scope: 'PRODUCT' } },
      { key: 'other-sku', row: media('other-sku', { role: 'sku', skuKeys: ['sku-2'] }), selection: { sourceMediaKey: 'other-sku', slotKey: 'x', scope: 'SKU', skuKey: 'sku-1' } },
    ];
    for (const testCase of cases) {
      const rows = testCase.row ? [testCase.row] : [];
      const { service, download } = setup({
        loadCaptureAuthority: vi.fn(async () => ({ snapshotId: 'snapshot-1', captureHash: 'a'.repeat(64), media: rows })),
      });
      await expect(service.internalize({
        ownerUserId: 'owner-1', draft: draft(), selections: [testCase.selection as SourceListingMediaSelection],
      })).rejects.toThrow();
      expect(download).not.toHaveBeenCalled();
    }
  });

  it('rejects duplicate slots/media, stale snapshot authority and non-durable storage', async () => {
    const { service } = setup();
    await expect(service.internalize({
      ownerUserId: 'owner-1', draft: draft(), selections: [
        { sourceMediaKey: 'main-1', slotKey: 'same', scope: 'PRODUCT' },
        { sourceMediaKey: 'main-1', slotKey: 'same', scope: 'PRODUCT' },
      ],
    })).rejects.toThrow(/unique/i);

    const stale = setup({
      loadCaptureAuthority: vi.fn(async () => ({ snapshotId: 'snapshot-1', captureHash: 'b'.repeat(64), media: [media('main-1')] })),
    });
    await expect(stale.service.internalize({
      ownerUserId: 'owner-1', draft: draft(),
      selections: [{ sourceMediaKey: 'main-1', slotKey: 'main', scope: 'PRODUCT' }],
    })).rejects.toThrow(/authority/i);

    const local = setup({
      getStorageBackend: vi.fn(async () => ({ uploadBuffer: vi.fn(async () => ({
        url: 'http://localhost:3001/uploads/a.png', filename: 'a.png', backend: 'local',
      })) })),
    });
    await expect(local.service.internalize({
      ownerUserId: 'owner-1', draft: draft(),
      selections: [{ sourceMediaKey: 'main-1', slotKey: 'main', scope: 'PRODUCT' }],
    })).rejects.toThrow(/durable/i);
  });

  it('rejects declared MIME that disagrees with the decoded source image', async () => {
    const { service, createAsset } = setup({
      download: vi.fn(async (url: string) => ({
        sourceUrl: url, finalUrl: url, contentType: 'image/jpeg', buffer: PNG, redirectCount: 0,
      })),
    });
    await expect(service.internalize({
      ownerUserId: 'owner-1', draft: draft(),
      selections: [{ sourceMediaKey: 'main-1', slotKey: 'main', scope: 'PRODUCT' }],
    })).rejects.toThrow(/MIME/i);
    expect(createAsset).not.toHaveBeenCalled();
  });

  it('revalidates exact owner, snapshot lineage and durable source assets before assignment', async () => {
    const owned = {
      id: 'asset-1', ownerUserId: 'owner-1', kind: 'SOURCE_ORIGINAL' as const,
      sourceCaptureSnapshotId: 'snapshot-1', sourceMediaKey: 'main-1',
      sourceUrl: 'https://img.example.com/main-1.png', url: 'https://cdn.example.com/main-1.png',
      storageBackend: 'oss', storageKey: 'main-1.png', mimeType: 'image/png', sizeBytes: PNG.length,
    };
    const loadOwnedAssets = vi.fn(async () => [owned]);
    const { service } = setup({ loadOwnedAssets });
    const assignments = [{ assetId: 'asset-1', slotKey: 'main', source: 'SOURCE' as const, scope: 'PRODUCT' as const }];
    await expect(service.validateSourceAssignments({
      ownerUserId: 'owner-1', draft: draft(), assignments,
    })).resolves.toBeUndefined();
    expect(loadOwnedAssets).toHaveBeenCalledWith({ ownerUserId: 'owner-1', assetIds: ['asset-1'] });

    const wrongSnapshot = setup({
      loadOwnedAssets: vi.fn(async () => [{ ...owned, sourceCaptureSnapshotId: 'snapshot-2' }]),
    });
    await expect(wrongSnapshot.service.validateSourceAssignments({
      ownerUserId: 'owner-1', draft: draft(), assignments,
    })).rejects.toThrow(/snapshot/i);
  });

  it('rejects attempts to widen or retarget SKU-specific capture media assignments', async () => {
    const skuAsset = {
      id: 'asset-sku', ownerUserId: 'owner-1', kind: 'SOURCE_ORIGINAL' as const,
      sourceCaptureSnapshotId: 'snapshot-1', sourceMediaKey: 'sku-image',
      sourceUrl: 'https://img.example.com/sku-image.png', url: 'https://cdn.example.com/sku-image.png',
      storageBackend: 'oss', storageKey: 'sku-image.png', mimeType: 'image/png', sizeBytes: PNG.length,
    };
    const { service } = setup({ loadOwnedAssets: vi.fn(async () => [skuAsset]) });
    const current = draft({ selectedSkuKeys: ['sku-1', 'sku-2'] });

    await expect(service.validateSourceAssignments({
      ownerUserId: 'owner-1',
      draft: current,
      assignments: [{
        assetId: 'asset-sku', slotKey: 'product-main', source: 'SOURCE', scope: 'PRODUCT',
      }],
    })).rejects.toMatchObject({ code: 'SOURCE_LISTING_MEDIA_SCOPE_MISMATCH' });

    await expect(service.validateSourceAssignments({
      ownerUserId: 'owner-1',
      draft: current,
      assignments: [{
        assetId: 'asset-sku', slotKey: 'sku-2-main', source: 'SOURCE', scope: 'SKU', skuKey: 'sku-2',
      }],
    })).rejects.toMatchObject({ code: 'SOURCE_LISTING_MEDIA_SCOPE_MISMATCH' });
  });
});
