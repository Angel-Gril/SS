import { describe, expect, it, vi } from 'vitest';
import { createSourceCaptureMediaDisplayService } from '../services/source-capture-media-display.js';
import { readFileSync } from 'node:fs';
import { createSourceCaptureViewService } from '../services/source-capture-view.js';
import { createExtensionSourceWorkbenchService } from '../services/extension-source-workbench.js';

const media = [{ key: 'media-main', kind: 'image', role: 'product_main', disposition: 'accepted',
  url: 'https://cbu01.alicdn.com/source.jpg', skuKeys: [] }];
const scope = { ownerUserId: 'owner-1', snapshotId: 'snapshot-1', media: media as any };
function asset(extra: Record<string, unknown> = {}) {
  return { ownerUserId: scope.ownerUserId, sourceCaptureSnapshotId: scope.snapshotId,
    sourceMediaKey: media[0]!.key, sourceUrl: media[0]!.url, kind: 'SOURCE_ORIGINAL', aiImageJobId: null,
    storageBackend: 'oss', storageKey: 'raw/owner/source.jpg', url: 'https://cdn.example/raw/source.jpg',
    mimeType: 'image/jpeg', sizeBytes: 1024, width: 900, height: 1200, sha256: 'a'.repeat(64), ...extra };
}

describe('source capture media display owner', () => {
  it('displays a long detail image within the importer side and pixel limits', async () => {
    const owner = createSourceCaptureMediaDisplayService({ client: { mediaAsset: { findMany: async () => [asset({ width: 800, height: 14000 })] } } });
    expect(await owner.loadDisplayUrls(scope)).toHaveLength(1);
  });
  it('projects stored URLs without mutating original URLs, keys or SKU membership', async () => {
    const before = structuredClone(media);
    const findMany = vi.fn(async () => [asset()]);
    const owner = createSourceCaptureMediaDisplayService({ client: { mediaAsset: { findMany } } });
    expect(await owner.loadDisplayUrls(scope)).toEqual([{ key: 'media-main', sourceUrl: media[0]!.url,
      displayUrl: 'https://cdn.example/raw/source.jpg' }]);
    expect(media).toEqual(before);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      ownerUserId: 'owner-1', sourceCaptureSnapshotId: 'snapshot-1', sourceMediaKey: { in: ['media-main'] },
      kind: 'SOURCE_ORIGINAL', aiImageJobId: null, storageBackend: 'oss',
    } }));
  });

  it.each([
    { ownerUserId: 'other' }, { sourceCaptureSnapshotId: 'other' }, { sourceMediaKey: 'other' },
    { sourceUrl: 'https://cbu01.alicdn.com/other.jpg' }, { kind: 'AI_GENERATED' }, { aiImageJobId: 'job-1' },
    { storageBackend: 'ozon-cdn' }, { storageBackend: 'local' }, { storageKey: null },
    { url: 'http://cdn.example/source.jpg' }, { url: 'https://127.0.0.1/source.jpg' },
    { url: 'https://user:password@cdn.example/source.jpg' }, { mimeType: 'text/html' },
    { width: 0 }, { height: null }, { sha256: null }, { sizeBytes: 0 },
  ])('does not use an invalid or differently bound asset %j', async (override) => {
    const owner = createSourceCaptureMediaDisplayService({ client: { mediaAsset: { findMany: async () => [asset(override)] } } });
    expect(await owner.loadDisplayUrls(scope)).toEqual([]);
  });

  it('does not query rejected, video or ambiguous source media', async () => {
    const findMany = vi.fn(async () => [asset()]);
    const owner = createSourceCaptureMediaDisplayService({ client: { mediaAsset: { findMany } } });
    for (const items of [[{ ...media[0], disposition: 'rejected' }], [{ ...media[0], kind: 'video' }], [media[0], media[0]]]) {
      expect(await owner.loadDisplayUrls({ ...scope, media: items as any })).toEqual([]);
    }
    expect(findMany).toHaveBeenCalledTimes(0);
  });

  it('does not emit non-public or non-HTTPS source URLs into the strict extension display contract', async () => {
    const findMany = vi.fn(async () => [asset()]);
    const owner = createSourceCaptureMediaDisplayService({ client: { mediaAsset: { findMany } } });
    for (const url of ['http://cbu01.alicdn.com/source.jpg', 'https://127.0.0.1/source.jpg', 'https://localhost/source.jpg',
      'https://cbu01.alicdn.com/source.jpg#fragment', 'https://[2001:4860:4860::8888]/source.jpg']) {
      expect(await owner.loadDisplayUrls({ ...scope, media: [{ ...media[0], url }] as any })).toEqual([]);
    }
    expect(findMany).not.toHaveBeenCalled();
  });

  it('bounds the display projection independently from the workbench response budget', async () => {
    const mediaRows = Array.from({ length: 120 }, (_, index) => ({ ...media[0], key: `media-${index}`,
      url: `https://cbu01.alicdn.com/${'s'.repeat(3800)}-${index}.jpg` }));
    const rows = mediaRows.map(item => asset({ sourceMediaKey: item.key, sourceUrl: item.url,
      url: `https://cdn.example/${'d'.repeat(3800)}-${item.key}.jpg` }));
    const owner = createSourceCaptureMediaDisplayService({ client: { mediaAsset: { findMany: async () => rows } } });
    const result = await owner.loadDisplayUrls({ ...scope, media: mediaRows as any });
    expect(result.length).toBeGreaterThan(0);
    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(96 * 1024);
    expect(result.length).toBeLessThan(120);
  });
});

describe('source media display read consumers', () => {
  const submission = JSON.parse(readFileSync(new URL(
    '../../../../scripts/fixtures/source-collect/1688/minimal-v2-submission.sanitized.json', import.meta.url), 'utf8'));
  function persistence() {
    const payload = structuredClone(submission.capture);
    const first = payload.media.find((item: any) => item.kind === 'image' && item.disposition === 'accepted');
    const row = { id: 'snapshot-1', version: 1, capturedAt: new Date('2026-07-21T00:00:00Z'),
      schemaVersion: payload.captureVersion, captureHash: submission.captureHash, payloadBytes: submission.payloadBytes,
      payload, stageCounts: { fields: {} }, completeness: payload.completeness, truncations: payload.truncations,
      subject: { legacySupplyGoodsId: 'goods-1', snapshots: [{ id: 'snapshot-1' }],
        legacySupplyGoods: { id: 'goods-1', userId: 'owner-1', metadata: {
          sourceCaptureV2: { snapshotId: 'snapshot-1', captureHash: submission.captureHash },
          sourceImageTransferV2: { version: 'source-capture-image-transfer/v1', snapshotId: 'snapshot-1',
            captureHash: submission.captureHash, status: 'PENDING' },
        } } } };
    const findMany = vi.fn(async () => [asset({ sourceMediaKey: first.key, sourceUrl: first.url })]);
    return { row, first, findMany, client: { sourceCaptureSnapshot: { findFirst: vi.fn(async () => row) },
      supplyGoods: { findFirst: vi.fn(async (args: any) => (
        args.where.id === row.subject.legacySupplyGoods.id && args.where.userId === row.subject.legacySupplyGoods.userId
          ? { metadata: row.subject.legacySupplyGoods.metadata } : null
      )) },
      mediaAsset: { findMany }, sourceListingWorkflow: { findMany: async () => [] }, aiMediaWorkflow: { findMany: async () => [] } } };
  }

  it('adds a display URL to paged Web media without changing payload bytes/hash or source identities', async () => {
    const state = persistence();
    const before = JSON.stringify(state.row);
    const view = await createSourceCaptureViewService({ client: state.client }).getView({
      snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1', ownerUserId: 'owner-1',
      skuOffset: 0, skuLimit: 50, mediaOffset: 0, mediaLimit: 50 });
    expect(view.captureHash).toBe(submission.captureHash);
    expect(view.media.items.find(item => item.key === state.first.key)).toMatchObject({
      url: state.first.url, displayUrl: 'https://cdn.example/raw/source.jpg' });
    expect(view.skus.items).toEqual(submission.capture.skus);
    expect(JSON.stringify(state.row)).toBe(before);
  });

  it('adds verified snapshot-bound display URLs to device workbench status without writes', async () => {
    const state = persistence();
    const before = JSON.stringify(state.row);
    const result = await createExtensionSourceWorkbenchService({ client: state.client }).loadStatus({
      ownerUserId: 'owner-1', allowedShopIds: [], snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1' });
    expect(result.snapshot.captureHash).toBe(submission.captureHash);
    expect(result.sourceMedia).toEqual({ snapshotId: 'snapshot-1', captureHash: submission.captureHash, transferStatus: 'PENDING',
      items: [{ key: state.first.key, sourceUrl: state.first.url, displayUrl: 'https://cdn.example/raw/source.jpg' }] });
    expect(state.client.supplyGoods.findFirst).toHaveBeenCalledWith({
      where: { id: 'goods-1', userId: 'owner-1' }, select: { metadata: true },
    });
    expect(JSON.stringify(state.row)).toBe(before);
  });

  it('exposes only bounded transfer state for the exact projection owner/snapshot/hash', async () => {
    for (const mutate of [
      (row: any) => { row.subject.legacySupplyGoods.userId = 'other'; },
      (row: any) => { row.subject.legacySupplyGoods.id = 'other'; },
      (row: any) => { row.subject.legacySupplyGoods.metadata.sourceImageTransferV2.captureHash = 'b'.repeat(64); },
      (row: any) => { row.subject.legacySupplyGoods.metadata.sourceCaptureV2.snapshotId = 'other'; },
      (row: any) => { row.subject.legacySupplyGoods.metadata.sourceImageTransferV2.status = 'unbounded-private-value'; },
    ]) {
      const state = persistence(); mutate(state.row);
      const result = await createExtensionSourceWorkbenchService({ client: state.client }).loadStatus({
        ownerUserId: 'owner-1', allowedShopIds: [], snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1' });
      expect(result.sourceMedia?.transferStatus).toBe('UNKNOWN');
      expect(JSON.stringify(result)).not.toContain('unbounded-private-value');
    }
  });

  it('does not query or return display URLs when snapshot integrity verification fails', async () => {
    const state = persistence();
    state.row.captureHash = 'b'.repeat(64);
    const result = await createExtensionSourceWorkbenchService({ client: state.client }).loadStatus({
      ownerUserId: 'owner-1', allowedShopIds: [], snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1' });
    expect(result.sourceMedia).toBeUndefined();
    expect(state.findMany).not.toHaveBeenCalled();
  });
});
