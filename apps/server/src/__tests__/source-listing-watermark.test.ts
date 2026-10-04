import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { describe, it, expect, vi } from 'vitest';
import { InMemoryOzonListingDraftRepository } from '../services/ozon-listing-draft.js';
import { createSourceListingWorkflowService } from '../services/source-listing-workflow.js';
import { createSourceListingWatermarkService, SourceListingWatermarkError, type SourceListingWatermarkAsset, type SourceListingWatermarkCommitInput } from '../services/source-listing-watermark.js';
import type { SourceCaptureMedia, SourceCaptureEvidence } from 'shared';

async function fixture() {
  const repository = new InMemoryOzonListingDraftRepository();
  const workflow = createSourceListingWorkflowService({ repository, idFactory: (prefix) => `${prefix}-test` });
  const draft = await workflow.createDraft({ ownerUserId: 'owner', actorUserId: 'owner', shopId: 'shop', supplyGoodsId: 'goods',
    sourceCaptureSnapshotId: 'snapshot', sourceCaptureHash: 'a'.repeat(64), selectedSkuKeys: ['sku-white', 'sku-blue'] });
  let bytes = await sharp({ create: { width: 300, height: 400, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const assets: SourceListingWatermarkAsset[] = [];
  const download = vi.fn(async () => ({ buffer: bytes, width: 300, height: 400, format: 'png',
    sourceUrl: 'https://source.example/white.png', finalUrl: 'https://source.example/white.png', contentType: 'image/png', redirectCount: 0 }));
  const uploadBuffer = vi.fn(async (_bytes: Buffer, filename: string) => ({ backend: 'oss' as const, filename,
    key: `owned/${filename}`, url: `https://media.example/${filename}` }));
  const deleteUploaded = vi.fn(async () => {});
  const commit = vi.fn(async (input: SourceListingWatermarkCommitInput) => {
    const result = await repository.compareAndSwap({ draftId: input.next.id, ownerUserId: input.actor.ownerUserId,
      actorUserId: input.actor.actorUserId, expectedRevision: input.binding.draftRevision, next: input.next });
    assets.push(...input.assets);
    return { draft: result, assets: input.assets, replayed: false };
  });
  const loadCaptureAuthority = vi.fn(async () => ({ snapshotId: 'snapshot', captureHash: 'a'.repeat(64), media: [
    { key: 'white-source', kind: 'image', role: 'sku', disposition: 'accepted', url: 'https://source.example/white.png', skuKeys: ['sku-white'] },
    { key: 'product-source', kind: 'image', role: 'product_main', disposition: 'accepted', url: 'https://source.example/product.png', skuKeys: [] },
    { key: 'rejected-source', kind: 'image', role: 'product_main', disposition: 'rejected', url: 'https://source.example/rejected.png', skuKeys: [] },
  ].map((media, ordinal) => {
    const evidence: SourceCaptureEvidence = { value: null, sourceType: 'dom', sourcePath: '/media', confidence: 1,
      isEstimated: false, missingReason: null, observedAt: '2026-10-04T00:00:00Z', parserVersion: 'test', derivedFrom: [] };
    return { ...media, ordinal, width: 300, height: 400, mimeType: 'image/png', rejectionReason: null,
      duplicateOfMediaKey: null, rowEvidence: evidence, fieldEvidence: { role: evidence, url: evidence, width: evidence, height: evidence, mimeType: evidence } };
  }) as SourceCaptureMedia[] }));
  const assertActiveBinding = vi.fn(async () => {});
  const service = createSourceListingWatermarkService({ repository, loadCaptureAuthority, assertActiveBinding,
    loadOwnedAssets: async ({ assetIds }) => assets.filter(asset => assetIds.includes(asset.id)),
    getStorage: async () => ({ backendType: 'oss', namespaceId: 'f'.repeat(64), uploadBuffer,
      deleteUploaded }), download, commit });
  const actor = { ownerUserId: 'owner', actorUserId: 'owner', sessionId: 'device',
    scopes: ['listing:write', 'media:execute'], allowedShopIds: ['shop'] };
  const input = { contractVersion: 'extension-workbench-watermark/v1' as const, snapshotId: 'snapshot', supplyGoodsId: 'goods',
    shopId: 'shop', listingWorkflowId: draft.id, draftRevision: 1, draftVersion: 1,
    items: [{ skuKey: 'sku-white', slotKey: 'sku:sku-white:hero', sourceMediaKey: 'white-source' }],
    config: { type: 'text' as const, text: 'SS TEST', position: 'center' as const, opacity: 80, fontSize: 30, fontColor: '#ff0000' } };
  return { repository, service, actor, input, bytes, assets, download, uploadBuffer, deleteUploaded, commit, loadCaptureAuthority, assertActiveBinding,
    replaceSource: async () => { bytes = await sharp({ create: { width: 300, height: 400, channels: 3, background: '#00ff00' } }).png().toBuffer(); } };
}

describe('source-listing deterministic watermark owner', () => {
  it('renders a bounded real preview with no storage or draft mutation', async () => {
    const f = await fixture(); const preview = await f.service.preview(f.actor, f.input);
    expect(preview.previewHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(preview.items).toHaveLength(1);
    const bytes = Buffer.from(preview.items[0]!.dataUrl.split(',')[1]!, 'base64');
    expect((await sharp(bytes).metadata()).format).toBe('jpeg');
    expect((await sharp(bytes).stats()).channels[1]!.min).toBeLessThan(200);
    expect(f.uploadBuffer).not.toHaveBeenCalled(); expect(f.commit).not.toHaveBeenCalled();
  });
  it('applies the exact preview pixels to a new server-owned version and preserves other slots', async () => {
    const f = await fixture(); const preview = await f.service.preview(f.actor, f.input);
    const result = await f.service.apply(f.actor, { ...f.input, previewHash: preview.previewHash, idempotencyKey: 'watermark-request-001' });
    expect(result.draft).toMatchObject({ revision: 2, draftVersion: 2, validation: { status: 'STALE' },
      grantRevocation: { required: true, reason: 'MEDIA_ASSIGNMENT_CHANGED' } });
    expect(result.draft.media.assignments[0]).toMatchObject({ scope: 'SKU', skuKey: 'sku-white', source: 'EDITED', slotKey: 'sku:sku-white:hero' });
    expect(result.assets[0]).toMatchObject({ kind: 'IMAGE_PROCESSED', ownerUserId: 'owner', sourceCaptureSnapshotId: 'snapshot',
      metadata: { operation: 'WATERMARK', erpGenerationChargeMinor: 0, sourceSha256: createHash('sha256').update(f.bytes).digest('hex') } });
    expect(result.draft.auditEvents.at(-1)).toMatchObject({ type: 'IMAGE_PROCESSING_APPLIED', details: { deviceSessionId: 'device', idempotencyKey: 'watermark-request-001' } });
  });
  it('replays from the persistent audit after service state is lost without downloading or uploading again', async () => {
    const f = await fixture(); const preview = await f.service.preview(f.actor, f.input);
    const request = { ...f.input, previewHash: preview.previewHash, idempotencyKey: 'watermark-request-001' };
    const first = await f.service.apply(f.actor, request); f.download.mockClear(); f.uploadBuffer.mockClear();
    const replay = await f.service.apply(f.actor, request);
    expect(replay.replayed).toBe(true); expect(replay.draft).toEqual(first.draft);
    expect(f.download).not.toHaveBeenCalled(); expect(f.uploadBuffer).not.toHaveBeenCalled(); expect(f.commit).toHaveBeenCalledTimes(1);
    await expect(f.service.apply(f.actor, { ...request, config: { ...request.config, text: 'other' } })).rejects.toMatchObject({ code: 'watermark_idempotency_conflict' });
  });
  it('rejects image content drift between preview and apply before upload', async () => {
    const f = await fixture(); const preview = await f.service.preview(f.actor, f.input); await f.replaceSource();
    await expect(f.service.apply(f.actor, { ...f.input, previewHash: preview.previewHash, idempotencyKey: 'watermark-request-001' })).rejects.toMatchObject({ code: 'watermark_preview_changed' });
    expect(f.uploadBuffer).not.toHaveBeenCalled(); expect(f.commit).not.toHaveBeenCalled();
  });
  it('rejects a changed current source projection before image IO even when the historical snapshot exists', async () => {
    const f = await fixture(); f.assertActiveBinding.mockRejectedValue(new SourceListingWatermarkError('watermark_context_stale', 409, 'source changed'));
    await expect(f.service.preview(f.actor, f.input)).rejects.toMatchObject({ code: 'watermark_context_stale' });
    expect(f.download).not.toHaveBeenCalled();
  });
  it('cleans the unique uploaded result after a known transaction rollback and creates no receipt', async () => {
    const f = await fixture(); const preview = await f.service.preview(f.actor, f.input);
    f.commit.mockRejectedValueOnce(new SourceListingWatermarkError('watermark_context_stale', 409, 'source moved during upload'));
    await expect(f.service.apply(f.actor, { ...f.input, previewHash: preview.previewHash, idempotencyKey: 'watermark-request-001' })).rejects.toMatchObject({ code: 'watermark_context_stale' });
    expect(f.deleteUploaded).toHaveBeenCalledTimes(1); expect(f.assets).toHaveLength(0);
    expect((await f.repository.getCurrent(f.input.listingWorkflowId, 'owner'))?.revision).toBe(1);
  });
  it('coalesces concurrent same-key applies and charges no AI generation', async () => {
    const f = await fixture(); const preview = await f.service.preview(f.actor, f.input);
    const request = { ...f.input, previewHash: preview.previewHash, idempotencyKey: 'watermark-request-001' };
    const results = await Promise.all([f.service.apply(f.actor, request), f.service.apply(f.actor, request)]);
    expect(results[0].draft).toEqual(results[1].draft); expect(f.commit).toHaveBeenCalledTimes(1); expect(f.uploadBuffer).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['other owner', { ownerUserId: 'other', actorUserId: 'other' }, 'watermark_context_not_found'],
    ['actor impersonation', { actorUserId: 'other' }, 'watermark_forbidden'],
    ['missing scope', { scopes: ['listing:write'] }, 'watermark_forbidden'],
    ['ungranted shop', { allowedShopIds: ['other'] }, 'watermark_forbidden'],
  ])('rejects %s before image IO', async (_label, changes, code) => {
    const f = await fixture(); await expect(f.service.preview({ ...f.actor, ...changes }, f.input)).rejects.toMatchObject({ code });
    expect(f.download).not.toHaveBeenCalled();
  });
  it.each([
    ['wrong revision', { draftRevision: 2 }, 'watermark_context_stale'],
    ['wrong version', { draftVersion: 2 }, 'watermark_context_stale'],
    ['wrong snapshot', { snapshotId: 'other' }, 'watermark_context_stale'],
    ['wrong goods', { supplyGoodsId: 'other' }, 'watermark_context_stale'],
    ['another SKU source', { items: [{ skuKey: 'sku-blue', slotKey: 'sku:sku-blue:hero', sourceMediaKey: 'white-source' }] }, 'watermark_source_invalid'],
    ['unbound result', { items: [{ skuKey: 'sku-white', slotKey: 'sku:sku-white:hero', sourceAssetId: 'unbound' }] }, 'watermark_source_invalid'],
    ['arbitrary URL', { items: [{ skuKey: 'sku-white', slotKey: 'sku:sku-white:hero', sourceMediaKey: 'white-source', url: 'http://localhost/private' }] }, 'watermark_invalid_request'],
    ['duplicate slot', { items: [{ skuKey: null, slotKey: 'product-main', sourceMediaKey: 'product-source' }, { skuKey: null, slotKey: 'product-main', sourceMediaKey: 'product-source' }] }, 'watermark_invalid_request'],
    ['empty text', { config: { type: 'text', text: '', position: 'center', opacity: 80 } }, 'watermark_invalid_request'],
  ])('rejects %s before image IO', async (_label, changes, code) => {
    const f = await fixture(); await expect(f.service.preview(f.actor, { ...f.input, ...changes })).rejects.toMatchObject({ code });
    expect(f.download).not.toHaveBeenCalled();
  });
});
