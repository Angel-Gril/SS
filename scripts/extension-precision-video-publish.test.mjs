import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoPublishFlow } from '../extensions/ss-erp/pages/donor/video-publish-editor.js';
const binding = { snapshotId: 'snapshot', supplyGoodsId: 'goods', shopId: 'shop', listingWorkflowId: 'draft', draftRevision: 2, draftVersion: 2 };
function fixture(overrides = {}) {
  const calls = []; let current = { ...binding }; let sku = 'white';
  const flow = createVideoPublishFlow({ getBinding: () => current, getSkuKey: () => sku,
    command: async (type, fields) => {
      calls.push({ type, fields });
      if (type === 'VIDEO_READ') return { data: { state: 'ready', binding: { ...current }, videoBindings: [] } };
      return { data: { state: 'ready', replayed: false, binding: { ...binding, draftRevision: 3, draftVersion: 3 }, videoBindings: [
        { skuKey: 'white', role: 'MAIN', url: fields.request.mainUrl, sourceCaptureSnapshotId: 'snapshot', sourceCaptureHash: 'a'.repeat(64), approvedByUserId: 'owner', approvedAt: '2026-10-04T00:00:00Z', sourceMediaKey: null },
      ] } };
    }, ...overrides });
  return { flow, calls, changeBinding: value => { current = { ...current, ...value }; }, changeSku: value => { sku = value; } };
}
test('saving reviewed video uses a current exact draft and preserves its response', async () => {
  const f = fixture(); await f.flow.read();
  assert.equal(await f.flow.save({ mainUrl: 'https://cdn1.ozone.ru/s3/sc-temporary/video.mp4', richContentUrl: null }), true);
  assert.equal(f.calls[1].type, 'VIDEO_SAVE'); assert.deepEqual(f.calls[1].fields.request.binding, binding);
  assert.equal(f.calls[1].fields.request.skuKey, 'white');
  assert.equal(f.flow.state().unknown, false);
});
test('an unknown save preserves the original idempotent request and blocks a different video', async () => {
  const f = fixture({ command: async (type, fields) => {
    f.calls.push({ type, fields });
    if (type === 'VIDEO_READ') return { data: { state: 'ready', binding, videoBindings: [] } };
    throw Object.assign(new Error('timeout'), { outcome: 'UNKNOWN_OUTCOME' });
  } });
  await f.flow.read(); await f.flow.save({ mainUrl: 'https://cdn1.ozone.ru/s3/sc-temporary/a.mp4', richContentUrl: null });
  assert.equal(f.flow.state().unknown, true);
  assert.equal(await f.flow.save({ mainUrl: 'https://cdn1.ozone.ru/s3/sc-temporary/b.mp4', richContentUrl: null }), false);
  await f.flow.replay(); assert.deepEqual(f.calls[1], f.calls[2]);
});
test('draft or SKU changes before save reject the old editor before dispatch', async () => {
  const f = fixture(); await f.flow.read(); f.changeSku('black');
  assert.equal(await f.flow.save({ mainUrl: null, richContentUrl: null }), false); assert.equal(f.calls.length, 1);
  const g = fixture(); await g.flow.read(); g.changeBinding({ draftVersion: 3 });
  assert.equal(await g.flow.save({ mainUrl: null, richContentUrl: null }), false); assert.equal(g.calls.length, 1);
});
test('a response for another shop cannot falsely confirm the video write', async () => {
  const f = fixture({ command: async type => ({ data: { state: 'ready', binding: { ...binding, shopId: type === 'VIDEO_SAVE' ? 'foreign' : binding.shopId }, videoBindings: [] } }) });
  await f.flow.read(); assert.equal(await f.flow.save({ mainUrl: null, richContentUrl: null }), false);
  assert.equal(f.flow.state().unknown, true);
});
