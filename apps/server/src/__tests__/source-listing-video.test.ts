import { describe, expect, it, vi } from 'vitest';
import type { OzonNormalizedAttributeSchema } from 'shared';
import { InMemoryOzonListingDraftRepository } from '../services/ozon-listing-draft.js';
import { createSourceListingWorkflowService, hashOzonListingPublishState } from '../services/source-listing-workflow.js';
import { createSourceListingVideoService, normalizeOfficialOzonVideoUrl, SourceListingVideoError,
  type SourceListingVideoCommitInput } from '../services/source-listing-video.js';

const official = 'https://cdnvideo.v.ozone.ru/vod/video-64/01KF0S7TY54CCQ9SZCCMQAM1RS/asset_0_h264.mp4';
const temporary = 'https://cdn1.ozone.ru/s3/sc-temporary/test-media/clip.mp4';
const schema: OzonNormalizedAttributeSchema = {
  schemaVersion: 'ozon-attribute-schema/v1', shopId: 'shop', descriptionCategoryId: 1, typeId: 2,
  language: 'DEFAULT', catalogRevision: 'catalog', definitionsHash: 'd'.repeat(64),
  fields: [21841, 21842, 21843, 21844, 21845, 21846, 22964, 23256, 22336].map(attributeId => ({
    attributeId, name: 'Видео', description: '', sourceType: 'String', valueType: 'STRING', cardinality: 'SINGLE',
    required: false, dictionaryId: null, valuePolicy: 'FREE_TEXT', ownership: 'MEDIA', editorMode: 'MEDIA_WORKBENCH',
    aiSuggestionAllowed: false,
  })),
};

async function fixture() {
  const repository = new InMemoryOzonListingDraftRepository();
  const workflow = createSourceListingWorkflowService({ repository, idFactory: prefix => `${prefix}-test` });
  const created = await workflow.createDraft({ ownerUserId: 'owner', actorUserId: 'owner', shopId: 'shop', supplyGoodsId: 'goods',
    sourceCaptureSnapshotId: 'snapshot', sourceCaptureHash: 'a'.repeat(64), selectedSkuKeys: ['white', 'blue'] });
  const draft = { ...created, category: { categoryId: 1, typeId: 2, catalogRevision: 'catalog' } };
  await repository.compareAndSwap({ draftId: draft.id, ownerUserId: 'owner', actorUserId: 'owner', expectedRevision: 1,
    next: { ...draft, revision: 2, draftVersion: 2 } });
  const actor = { ownerUserId: 'owner', actorUserId: 'owner', sessionId: 'device', scopes: ['listing:review', 'listing:write', 'media:execute'], allowedShopIds: ['shop'] };
  const binding = { snapshotId: 'snapshot', supplyGoodsId: 'goods', shopId: 'shop', listingWorkflowId: draft.id, draftRevision: 2, draftVersion: 2 };
  const request = { binding, skuKey: 'white', mainUrl: official, richContentUrl: official, operationKey: 'video-operation-001' };
  const assertActiveBinding = vi.fn(async () => {});
  const loadSchema = vi.fn(async () => structuredClone(schema));
  const commit = vi.fn(async (input: SourceListingVideoCommitInput) => ({ draft: await repository.compareAndSwap({ draftId: input.next.id,
    ownerUserId: input.actor.ownerUserId, actorUserId: input.actor.actorUserId, expectedRevision: input.binding.draftRevision, next: input.next }), replayed: false }));
  const service = createSourceListingVideoService({ repository, assertActiveBinding, loadSchema, commit, now: () => new Date('2026-10-04T00:00:00Z') });
  return { repository, service, actor, binding, request, assertActiveBinding, loadSchema, commit };
}

describe('official video draft binding owner', () => {
  it('persists separate main/rich slots without adding image assignments or AI charge', async () => {
    const f = await fixture(); const before = await f.repository.getCurrent(f.binding.listingWorkflowId, 'owner');
    const result = await f.service.save(f.actor, f.request);
    expect(result).toMatchObject({ state: 'ready', replayed: false, binding: { draftRevision: 3, draftVersion: 3 }, videoBindings: [
      { skuKey: 'white', role: 'MAIN', url: official, sourceCaptureHash: 'a'.repeat(64), approvedByUserId: 'owner' },
      { skuKey: 'white', role: 'RICH_CONTENT', url: official },
    ] });
    const after = await f.repository.getCurrent(f.binding.listingWorkflowId, 'owner');
    expect(after!.media.assignments).toEqual(before!.media.assignments);
    expect(after!.validation.status).toBe('STALE'); expect(after!.grantRevocation.required).toBe(true);
    expect(after!.auditEvents.at(-1)).toMatchObject({ type: 'VIDEO_BINDING_CHANGED', details: { deviceSessionId: 'device', erpGenerationChargeMinor: 0 } });
    expect(hashOzonListingPublishState(before!)).not.toBe(hashOzonListingPublishState(after!));
  });
  it('replays persistent receipt after revision advances and rejects changed same-key payload', async () => {
    const f = await fixture(); const first = await f.service.save(f.actor, f.request);
    const replay = await f.service.save(f.actor, f.request);
    expect(replay).toEqual({ ...first, replayed: true }); expect(f.commit).toHaveBeenCalledTimes(1);
    await expect(f.service.save(f.actor, { ...f.request, mainUrl: temporary })).rejects.toMatchObject({ code: 'video_idempotency_conflict' });
  });
  it('clears one SKU without changing another SKU and leaves image assignments intact', async () => {
    const f = await fixture(); const first = await f.service.save(f.actor, f.request);
    const second = await f.service.save(f.actor, { ...f.request, binding: first.binding, skuKey: 'blue', mainUrl: temporary, richContentUrl: null, operationKey: 'video-operation-002' });
    const cleared = await f.service.save(f.actor, { ...f.request, binding: second.binding, mainUrl: null, richContentUrl: null, operationKey: 'video-operation-003' });
    expect(cleared.videoBindings).toHaveLength(1); expect(cleared.videoBindings[0]).toMatchObject({ skuKey: 'blue', role: 'MAIN', url: temporary });
  });
  it('reads exact current binding without mutation', async () => {
    const f = await fixture(); expect(await f.service.read(f.actor, { binding: f.binding })).toEqual({ binding: f.binding, videoBindings: [] });
    expect(f.commit).not.toHaveBeenCalled();
  });
  it('coalesces concurrent requests before the CAS owner', async () => {
    const f = await fixture(); const results = await Promise.all([f.service.save(f.actor, f.request), f.service.save(f.actor, f.request)]);
    expect(results[0]).toEqual(results[1]); expect(f.commit).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['other owner', { ownerUserId: 'other', actorUserId: 'other' }, 'video_context_not_found'],
    ['subaccount', { actorUserId: 'staff' }, 'video_forbidden'],
    ['missing media scope', { scopes: ['listing:review', 'listing:write'] }, 'video_forbidden'],
    ['wrong shop grant', { allowedShopIds: [] }, 'video_forbidden'],
    ['empty device', { sessionId: '' }, 'video_forbidden'],
  ])('rejects %s before persistence', async (_label, changes, code) => {
    const f = await fixture(); await expect(f.service.save({ ...f.actor, ...changes }, f.request)).rejects.toMatchObject({ code });
    expect(f.commit).not.toHaveBeenCalled();
  });
  it.each([
    ['revision', { draftRevision: 1 }], ['version', { draftVersion: 1 }], ['snapshot', { snapshotId: 'old' }],
    ['shop', { shopId: 'other' }], ['goods', { supplyGoodsId: 'other' }],
  ])('rejects stale %s', async (_label, changes) => {
    const f = await fixture(); await expect(f.service.save(f.actor, { ...f.request, binding: { ...f.binding, ...changes } })).rejects.toBeInstanceOf(SourceListingVideoError);
    expect(f.commit).not.toHaveBeenCalled();
  });
  it('checks active source/shop authority again on idempotent replay', async () => {
    const f = await fixture(); await f.service.save(f.actor, f.request);
    f.assertActiveBinding.mockRejectedValueOnce(new SourceListingVideoError('video_context_stale', 409, 'stale'));
    await expect(f.service.save(f.actor, f.request)).rejects.toMatchObject({ code: 'video_context_stale' });
  });
  it('rejects stale category schema before persistence', async () => {
    const f = await fixture(); f.loadSchema.mockResolvedValueOnce({ ...schema, typeId: 9 });
    await expect(f.service.save(f.actor, f.request)).rejects.toMatchObject({ code: 'video_schema_stale' }); expect(f.commit).not.toHaveBeenCalled();
  });
  it('rejects a category missing official video attributes', async () => {
    const f = await fixture(); f.loadSchema.mockResolvedValueOnce({ ...schema, fields: [] });
    await expect(f.service.save(f.actor, f.request)).rejects.toMatchObject({ code: 'video_schema_unsupported' });
  });
  it('rejects unknown SKU and unuploaded source URLs with an explicit supported-path message', async () => {
    const f = await fixture(); await expect(f.service.save(f.actor, { ...f.request, skuKey: 'missing' })).rejects.toMatchObject({ code: 'video_sku_invalid' });
    await expect(f.service.save(f.actor, { ...f.request, mainUrl: 'https://cloud.video.taobao.com/test.mp4' })).rejects.toMatchObject({ code: 'video_upload_required' });
    expect(f.commit).not.toHaveBeenCalled();
  });
  it.each(['http://cdn1.ozone.ru/s3/sc-temporary/clip.mp4', 'https://cdn1.ozone.ru:8443/s3/sc-temporary/clip.mp4',
    'https://user:secret@cdn1.ozone.ru/s3/sc-temporary/clip.mp4', 'https://cdn1.ozone.ru.evil.test/s3/sc-temporary/clip.mp4',
    'https://cdn1.ozone.ru/s3/sc-temporary/%2e%2e/private.mp4', 'https://cdn1.ozone.ru/s3/sc-temporary/clip.mp4?token=private',
    'https://cdn1.ozone.ru/s3/sc-temporary/clip.mp4#private', 'https://127.0.0.1/clip.mp4',
    'https://cdn1.ozone.ru/s3/sc-temporary/a%2fb.mp4', 'https://cdn1.ozone.ru./s3/sc-temporary/clip.mp4'])('rejects non-exact official URL %s', value => {
    expect(normalizeOfficialOzonVideoUrl(value)).toBeNull();
  });
});
