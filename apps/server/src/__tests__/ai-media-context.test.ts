import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY } from 'shared';
import {
  AI_MEDIA_EDIT_SOURCE_MAX_BYTES,
  AI_MEDIA_LISTING_CONTEXT_MAX_INPUTS,
  AI_MEDIA_SOURCE_PREVIEW_MAX_EDGE,
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

const listingCapture = {
  captureVersion: 'source-product-capture-v2',
  facts: { title: 'Source product' },
  skus: [
    { key: 'sku-red', sourceSkuId: 'red-source' },
    { key: 'sku-blue', sourceSkuId: 'blue-source' },
  ],
  media: [{
    key: 'main-1', ordinal: 0, kind: 'image', disposition: 'accepted',
    role: 'product_main', skuKeys: [], url: 'https://source.example/main.jpg',
  }, {
    key: 'sku-red-1', ordinal: 1, kind: 'image', disposition: 'accepted',
    role: 'sku', skuKeys: ['red-source'], url: 'https://source.example/red.jpg',
  }, {
    key: 'sku-blue-1', ordinal: 2, kind: 'image', disposition: 'accepted',
    role: 'sku', skuKeys: ['blue-source'], url: 'https://source.example/blue.jpg',
  }, {
    key: 'sku-shared-1', ordinal: 3, kind: 'image', disposition: 'accepted',
    role: 'sku', skuKeys: ['red-source', 'blue-source'], url: 'https://source.example/shared.jpg',
  }],
};

function listingDraft(overrides: Record<string, unknown> = {}) {
  return {
    id: 'draft-1', ownerUserId: 'owner-1', revision: 4, draftVersion: 2,
    sourceCaptureSnapshotId: 'snapshot-1', sourceCaptureHash: 'b'.repeat(64),
    selectedSkuKeys: ['sku-red'], copy: { publishTitleRu: 'Russian title' },
    media: { assignments: [
      { scope: 'PRODUCT', slotKey: 'main-1', assetId: 'asset-1', source: 'SOURCE' },
      { scope: 'SKU', skuKey: 'sku-red', slotKey: 'sku-hero', assetId: 'asset-red', source: 'SOURCE' },
    ] },
    ...overrides,
  };
}

function listingClient(options: {
  draft?: Record<string, unknown>;
  workflow?: Record<string, unknown>;
  currentDraft?: Record<string, unknown>;
  snapshot?: Record<string, unknown>;
  capture?: Record<string, unknown>;
  assets?: unknown[];
  assignmentAssets?: unknown[];
  ownerFound?: boolean;
} = {}) {
  const draft = listingDraft(options.draft || {});
  const capture = { ...listingCapture, ...(options.capture || {}) };
  const db = client() as any;
  db.sourceListingWorkflow = {
    findFirst: vi.fn(async ({ where }: any) => options.ownerFound !== false
      && where.id === 'draft-1' && where.ownerUserId === 'owner-1' ? {
      id: 'draft-1', ownerUserId: 'owner-1', currentRevision: 4, currentDraftVersion: 2,
      sourceSubjectId: 'subject-1',
      currentSourceCaptureSnapshotId: 'snapshot-1',
      currentDraft: {
        id: 'draft-row-1', workflowId: 'draft-1', ownerUserId: 'owner-1',
        revision: 4, draftVersion: 2, sourceCaptureSnapshotId: 'snapshot-1', payload: draft,
      },
      currentSourceCaptureSnapshot: {
        id: 'snapshot-1', subjectId: 'subject-1', version: 5, captureHash: 'b'.repeat(64), payload: capture,
        subject: { ownerUserId: 'owner-1' },
      },
      ...(options.workflow || {}),
      ...(options.currentDraft ? { currentDraft: {
        id: 'draft-row-1', workflowId: 'draft-1', ownerUserId: 'owner-1',
        revision: 4, draftVersion: 2, sourceCaptureSnapshotId: 'snapshot-1', payload: draft,
        ...options.currentDraft,
      } } : {}),
      ...(options.snapshot ? { currentSourceCaptureSnapshot: {
        id: 'snapshot-1', subjectId: 'subject-1', version: 5, captureHash: 'b'.repeat(64), payload: capture,
        subject: { ownerUserId: 'owner-1' }, ...options.snapshot,
      } } : {}),
    } : null),
  };
  db.mediaAsset.findMany.mockImplementation(async ({ where }: any = {}) => {
    const ids = Array.isArray(where?.id?.in) ? where.id.in as string[] : [];
    if (ids.length) {
      if (options.assignmentAssets) return options.assignmentAssets;
      return ids.map((id) => editReadyAsset({
        id,
        sourceMediaKey: id === 'asset-red' ? 'sku-red-1' : 'main-1',
        sourceUrl: id === 'asset-red'
          ? 'https://source.example/red.jpg'
          : 'https://source.example/main.jpg',
      }));
    }
    return options.assets || [
      editReadyAsset(),
      editReadyAsset({
        id: 'asset-red',
        sourceMediaKey: 'sku-red-1',
        sourceUrl: 'https://source.example/red.jpg',
      }),
    ];
  });
  return db;
}

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

describe('AI media listing-draft context', () => {
  it('returns a metadata-stripped bounded source preview without persisting the remote URL', async () => {
    const source = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: '#806040' },
    }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const downloadPublicImage = vi.fn(async () => ({
      buffer: source,
      contentType: 'image/jpeg',
      sourceUrl: 'https://source.example/red.jpg',
      finalUrl: 'https://source.example/red.jpg',
      redirectCount: 0,
    }));
    const sanitizeOzonPublishImageBuffer = vi.fn(async () => ({
      buffer: source,
      filename: 'source.jpg',
      mimeType: 'image/jpeg' as const,
      converted: false,
      sourceFormat: 'jpeg',
    }));
    const service = createAiMediaContextService(listingClient() as never, {
      downloadPublicImage,
      sanitizeOzonPublishImageBuffer,
    });

    const preview = await service.loadListingDraftPreview(
      'owner-1',
      'draft-1',
      'sku-red-1',
      { expectedRevision: 4, expectedDraftVersion: 2, skuKey: 'sku-red' },
      'THUMBNAIL',
    );

    expect(preview).toMatchObject({
      mimeType: 'image/jpeg',
      width: Math.round(AI_MEDIA_SOURCE_PREVIEW_MAX_EDGE * 2 / 3),
      height: AI_MEDIA_SOURCE_PREVIEW_MAX_EDGE,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(Buffer.isBuffer(preview.bytes)).toBe(true);
    expect(preview.bytes.length).toBeGreaterThan(0);
    expect(preview).not.toHaveProperty('sourceUrl');
    expect((await sharp(preview.bytes).metadata()).orientation).toBeUndefined();
    expect(downloadPublicImage).toHaveBeenCalledWith('https://source.example/red.jpg');
    expect(sanitizeOzonPublishImageBuffer).toHaveBeenCalledOnce();
  });

  it('does not preview media owned by another selected SKU', async () => {
    const service = createAiMediaContextService(listingClient() as never, {
      downloadPublicImage: vi.fn(),
    });

    await expect(service.loadListingDraftPreview(
      'owner-1',
      'draft-1',
      'sku-blue-1',
      { expectedRevision: 4, expectedDraftVersion: 2, skuKey: 'sku-red' },
      'WORKING',
    )).rejects.toMatchObject({ code: 'SOURCE_MEDIA_NOT_FOUND', statusCode: 404 });
  });

  it('loads the current owner-scoped draft with product and selected-SKU media', async () => {
    const db = listingClient();
    const result = await createAiMediaContextService(db as never).loadListingDraft(
      'owner-1',
      'draft-1',
      { expectedRevision: 4, expectedDraftVersion: 2, skuKey: 'sku-red', slotKey: 'sku-hero' },
    );

    expect(result.target).toEqual({
      type: 'listing-draft', id: 'draft-1', label: 'Russian title', revision: 4,
      draftVersion: 2, skuKey: 'sku-red', slotKey: 'sku-hero', assignedAssetId: 'asset-red',
    });
    expect(result.snapshot).toEqual({
      id: 'snapshot-1', version: 5, captureHash: 'b'.repeat(64),
    });
    expect(result.selectedSkuKeys).toEqual(['sku-red']);
    expect(result.inputs.map((input) => ({ key: input.sourceMediaKey, scope: input.scope, skuKeys: input.skuKeys })))
      .toEqual([
        { key: 'main-1', scope: 'PRODUCT', skuKeys: [] },
        { key: 'sku-red-1', scope: 'SKU', skuKeys: ['sku-red'] },
        { key: 'sku-shared-1', scope: 'SKU', skuKeys: ['sku-red'] },
      ]);
    expect(db.sourceListingWorkflow.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'draft-1', ownerUserId: 'owner-1' },
    }));
  });

  it('allows source discovery before a fresh draft has assigned a target slot', async () => {
    const db = listingClient({ draft: { media: { assignments: [] } } });
    const result = await createAiMediaContextService(db as never).loadListingDraft(
      'owner-1', 'draft-1', { expectedRevision: 4, expectedDraftVersion: 2 },
    );
    expect(result.target).toMatchObject({ skuKey: null, slotKey: null, assignedAssetId: null });
    expect(result.inputs.map((input) => input.sourceMediaKey)).toEqual([
      'main-1', 'sku-red-1', 'sku-shared-1',
    ]);
  });

  it('allows a null SKU scope for a product-only listing draft', async () => {
    const database = listingClient({
      draft: {
        selectedSkuKeys: [SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY],
        media: { assignments: [
          { scope: 'PRODUCT', slotKey: 'main-1', assetId: 'asset-1', source: 'SOURCE' },
        ] },
      },
      capture: { skus: [], media: [listingCapture.media[0]] },
    });
    const result = await createAiMediaContextService(database as never).loadListingDraft(
      'owner-1', 'draft-1', { expectedRevision: 4, expectedDraftVersion: 2, skuKey: null },
    );
    expect(result.target).toMatchObject({ skuKey: null, slotKey: null });
    expect(result.selectedSkuKeys).toEqual([SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY]);
    expect(result.inputs.map((input) => input.sourceMediaKey)).toEqual(['main-1']);
  });

  it('rejects stale draft pointers and expected versions', async () => {
    const service = createAiMediaContextService(listingClient() as never);
    await expect(service.loadListingDraft('owner-1', 'draft-1', {
      expectedRevision: 3, expectedDraftVersion: 2,
    })).rejects.toMatchObject({ code: 'STALE_MEDIA_CONTEXT', statusCode: 409 });

    await expect(service.loadListingDraft('owner-1', 'draft-1', {
      expectedRevision: 4, expectedDraftVersion: 1,
    })).rejects.toMatchObject({ code: 'STALE_MEDIA_CONTEXT', statusCode: 409 });

    const stale = listingClient({ draft: { sourceCaptureHash: 'c'.repeat(64) } });
    await expect(createAiMediaContextService(stale as never).loadListingDraft(
      'owner-1', 'draft-1',
    )).rejects.toMatchObject({ code: 'STALE_MEDIA_CONTEXT', statusCode: 409 });
  });

  it.each([
    ['workflow revision', () => listingClient({ workflow: { currentRevision: 5 } })],
    ['workflow draft version', () => listingClient({ workflow: { currentDraftVersion: 3 } })],
    ['draft row revision', () => listingClient({ currentDraft: { revision: 3 } })],
    ['draft payload revision', () => listingClient({ draft: { revision: 3 } })],
    ['workflow snapshot pointer', () => listingClient({
      workflow: { currentSourceCaptureSnapshotId: 'snapshot-old' },
    })],
    ['draft row snapshot pointer', () => listingClient({
      currentDraft: { sourceCaptureSnapshotId: 'snapshot-old' },
    })],
    ['draft payload snapshot pointer', () => listingClient({
      draft: { sourceCaptureSnapshotId: 'snapshot-old' },
    })],
    ['snapshot subject owner', () => listingClient({
      snapshot: { subject: { ownerUserId: 'owner-2' } },
    })],
    ['snapshot subject identity', () => listingClient({
      snapshot: { subjectId: 'subject-2' },
    })],
  ])('rejects stale %s authority', async (_name, database) => {
    await expect(createAiMediaContextService(database() as never).loadListingDraft(
      'owner-1', 'draft-1',
    )).rejects.toMatchObject({ code: 'STALE_MEDIA_CONTEXT', statusCode: 409 });
  });

  it('requires stored selected SKU keys to remain canonical', async () => {
    const database = listingClient({ draft: { selectedSkuKeys: ['red-source'] } });
    await expect(createAiMediaContextService(database as never).loadListingDraft(
      'owner-1', 'draft-1',
    )).rejects.toMatchObject({ code: 'STALE_MEDIA_CONTEXT', statusCode: 409 });
  });

  it('resolves exactly one product slot and one SKU slot', async () => {
    const service = createAiMediaContextService(listingClient() as never);
    await expect(service.loadListingDraft('owner-1', 'draft-1', {
      slotKey: 'main-1',
    })).resolves.toMatchObject({ target: {
      skuKey: null, slotKey: 'main-1', assignedAssetId: 'asset-1',
    } });
    await expect(service.loadListingDraft('owner-1', 'draft-1', {
      skuKey: 'sku-red', slotKey: 'sku-hero',
    })).resolves.toMatchObject({ target: {
      skuKey: 'sku-red', slotKey: 'sku-hero', assignedAssetId: 'asset-red',
    } });
  });

  it('allows exact empty product and SKU slots but rejects an occupied slot from another scope', async () => {
    const service = createAiMediaContextService(listingClient() as never);
    await expect(service.loadListingDraft('owner-1', 'draft-1', { slotKey: 'missing' }))
      .resolves.toMatchObject({ target: {
        skuKey: null, slotKey: 'missing', assignedAssetId: null,
      } });
    await expect(service.loadListingDraft('owner-1', 'draft-1', {
      skuKey: 'sku-red', slotKey: 'sku-gallery-2',
    })).resolves.toMatchObject({ target: {
      skuKey: 'sku-red', slotKey: 'sku-gallery-2', assignedAssetId: null,
    } });
    await expect(service.loadListingDraft('owner-1', 'draft-1', { slotKey: 'sku-hero' }))
      .rejects.toMatchObject({ code: 'AI_MEDIA_CONTEXT_MISMATCH', statusCode: 409 });
    await expect(service.loadListingDraft('owner-1', 'draft-1', {
      skuKey: 'sku-red', slotKey: 'main-1',
    })).rejects.toMatchObject({ code: 'AI_MEDIA_CONTEXT_MISMATCH', statusCode: 409 });
  });

  it('rejects duplicate stored slots but permits a fresh draft to freeze an empty target slot', async () => {
    const duplicate = listingClient({ draft: { media: { assignments: [
      { scope: 'SKU', skuKey: 'sku-red', slotKey: 'sku-hero', assetId: 'asset-red', source: 'SOURCE' },
      { scope: 'SKU', skuKey: 'sku-red', slotKey: 'sku-hero', assetId: 'asset-red-2', source: 'SOURCE' },
    ] } } });
    await expect(createAiMediaContextService(duplicate as never).loadListingDraft(
      'owner-1', 'draft-1', { skuKey: 'sku-red', slotKey: 'sku-hero' },
    )).rejects.toMatchObject({ code: 'STALE_MEDIA_CONTEXT', statusCode: 409 });

    const fresh = listingClient({ draft: { media: { assignments: [] } } });
    await expect(createAiMediaContextService(fresh as never).loadListingDraft(
      'owner-1', 'draft-1', { slotKey: 'main-1' },
    )).resolves.toMatchObject({ target: {
      skuKey: null, slotKey: 'main-1', assignedAssetId: null,
    } });
  });

  it('fails closed instead of truncating an oversized listing media context', async () => {
    const media = Array.from({ length: AI_MEDIA_LISTING_CONTEXT_MAX_INPUTS + 1 }, (_, index) => ({
      key: `main-${String(index).padStart(3, '0')}`,
      ordinal: index,
      kind: 'image',
      disposition: 'accepted',
      role: 'product_detail',
      skuKeys: [],
      url: `https://source.example/main-${index}.jpg`,
    }));
    const database = listingClient({ capture: { media } });

    await expect(createAiMediaContextService(database as never).loadListingDraft(
      'owner-1', 'draft-1', { expectedRevision: 4, expectedDraftVersion: 2 },
    )).rejects.toMatchObject({
      code: 'AI_MEDIA_CONTEXT_LIMIT_EXCEEDED', statusCode: 413,
    });
    expect(database.mediaAsset.findMany).not.toHaveBeenCalled();
  });

  it('keeps the exact listing media input limit in capture order', async () => {
    const media = Array.from({ length: AI_MEDIA_LISTING_CONTEXT_MAX_INPUTS }, (_, index) => ({
      key: `main-${String(index).padStart(3, '0')}`,
      ordinal: index,
      kind: 'image',
      disposition: 'accepted',
      role: 'product_detail',
      skuKeys: [],
      url: `https://source.example/main-${index}.jpg`,
    }));
    const database = listingClient({ capture: { media } });

    const result = await createAiMediaContextService(database as never).loadListingDraft(
      'owner-1', 'draft-1', { expectedRevision: 4, expectedDraftVersion: 2 },
    );

    expect(result.inputs).toHaveLength(AI_MEDIA_LISTING_CONTEXT_MAX_INPUTS);
    expect(result.inputs.map((input) => input.sourceMediaKey)).toEqual(media.map((item) => item.key));
  });

  it('keeps listing assets snapshot-bound and deterministic across storage copies', async () => {
    const editKey = `ai-edit-source:v1:${createHash('sha256').update('main-1').digest('hex')}`;
    const database = listingClient({ assets: [
      editReadyAsset({ id: 'zz-direct', sourceMediaKey: 'main-1', metadata: {} }),
      editReadyAsset({ id: 'bb-edit', sourceMediaKey: editKey }),
      editReadyAsset({ id: 'aa-edit', sourceMediaKey: editKey }),
      editReadyAsset({
        id: 'local-edit', sourceMediaKey: editKey, storageBackend: 'local',
        url: 'http://localhost/edit.jpg', storageKey: 'raw/edit.jpg',
      }),
    ] });

    const result = await createAiMediaContextService(database as never).loadListingDraft(
      'owner-1', 'draft-1', { skuKey: 'sku-red' },
    );

    expect(result.inputs[0]).toMatchObject({
      sourceMediaKey: 'main-1', assetId: 'aa-edit', editReady: true,
      compatibleAssetIds: ['aa-edit', 'bb-edit', 'zz-direct', 'local-edit'],
    });
    expect(database.mediaAsset.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        ownerUserId: 'owner-1', sourceCaptureSnapshotId: 'snapshot-1', kind: 'SOURCE_ORIGINAL',
      }),
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }));
  });

  it('does not bind a same-key asset whose source URL differs from the frozen capture', async () => {
    const database = listingClient({ assets: [editReadyAsset({
      id: 'wrong-url', sourceMediaKey: 'main-1', sourceUrl: 'https://other.example/main.jpg',
    })] });

    const result = await createAiMediaContextService(database as never).loadListingDraft(
      'owner-1', 'draft-1', { skuKey: 'sku-red' },
    );

    expect(result.inputs.find((input) => input.sourceMediaKey === 'main-1')).toMatchObject({
      assetId: null, compatibleAssetIds: [],
    });
  });

  it('rejects a draft assignment whose asset is not bound to the current snapshot', async () => {
    const database = listingClient({ assignmentAssets: [
      editReadyAsset({ id: 'asset-1', sourceCaptureSnapshotId: 'snapshot-old' }),
      editReadyAsset({ id: 'asset-red', sourceCaptureSnapshotId: 'snapshot-old' }),
    ] });

    await expect(createAiMediaContextService(database as never).loadListingDraft(
      'owner-1', 'draft-1',
    )).rejects.toMatchObject({ code: 'STALE_MEDIA_CONTEXT', statusCode: 409 });
  });

  it('rejects cross-owner, unselected-SKU, and mismatched slot access', async () => {
    const service = createAiMediaContextService(listingClient() as never);
    await expect(service.loadListingDraft('owner-2', 'draft-1'))
      .rejects.toMatchObject({ code: 'AI_MEDIA_CONTEXT_NOT_FOUND', statusCode: 404 });
    await expect(service.loadListingDraft('owner-1', 'draft-1', { skuKey: 'sku-blue' }))
      .rejects.toMatchObject({ code: 'AI_MEDIA_CONTEXT_MISMATCH', statusCode: 409 });
    await expect(service.loadListingDraft('owner-1', 'draft-1', {
      skuKey: 'sku-red', slotKey: 'main-1',
    })).rejects.toMatchObject({ code: 'AI_MEDIA_CONTEXT_MISMATCH', statusCode: 409 });
  });
});
