import assert from 'node:assert/strict';
import test from 'node:test';
import { createWatermarkFlow } from '../extensions/ss-erp/pages/donor/watermark-editor.js';
function fixture(overrides = {}) {
  let binding = { snapshotId: 'snapshot', supplyGoodsId: 'goods', shopId: 'shop', listingWorkflowId: 'draft', draftRevision: 2, draftVersion: 2 };
  const items = [{ skuKey: 'sku', slotKey: 'sku:sku:hero', sourceMediaKey: 'source' }];
  const calls = [];
  const result = { draft: { id: 'draft', shopId: 'shop', sourceCaptureSnapshotId: 'snapshot', supplyGoodsId: 'goods', revision: 3, draftVersion: 3 }, applied: 1, assets: [{ id: 'processed' }] };
  const command = async (type, fields) => { calls.push({ type, fields }); if (type === 'WATERMARK_PREVIEW') return { data: {
    contractVersion: 'extension-workbench-watermark/v1', previewHash: 'a'.repeat(64), items: [{ ...items[0], dataUrl: 'data:image/jpeg;base64,YQ==' }] } };
    return { data: result }; };
  const flow = createWatermarkFlow({ command, getBinding: () => binding, getItems: () => items, ...overrides });
  return { flow, calls, result, config: { type: 'text', text: 'Watermark', position: 'center', opacity: 60 },
    changeBinding: value => { binding = { ...binding, ...value }; } };
}
test('watermark uses the same frozen request for preview and actual owner application', async () => {
  const f = fixture(); assert.equal(await f.flow.preview(f.config), true); assert.equal(await f.flow.apply(), true);
  assert.equal(f.calls[0].type, 'WATERMARK_PREVIEW'); assert.equal(f.calls[1].type, 'WATERMARK_APPLY');
  assert.equal(f.calls[1].fields.request.previewHash, 'a'.repeat(64));
  assert.deepEqual(f.calls[1].fields.request.config, f.calls[0].fields.request.config); assert.equal(f.flow.state().applied, 1);
});
test('image templates load from the exact draft binding and produce URL-free image requests', async () => {
  const calls = [];
  const f = fixture({ command: async (type, fields) => {
    calls.push({ type, fields });
    if (type === 'WATERMARK_TEMPLATES') return { data: { contractVersion: 'extension-workbench-watermark/v1', templates: [
      { id: 'logo', name: 'My Logo', position: 'top-right', opacity: 50, scale: 25, isDefault: true },
    ] } };
    return { data: { contractVersion: 'extension-workbench-watermark/v1', previewHash: 'a'.repeat(64), items: [{ dataUrl: 'data:image/jpeg;base64,YQ==' }] } };
  } });
  assert.equal(await f.flow.loadTemplates(), true);
  assert.deepEqual(f.flow.state().templates, [{ id: 'logo', name: 'My Logo', position: 'top-right', opacity: 50, scale: 25, isDefault: true }]);
  assert.equal(calls[0].fields.request.shopId, 'shop'); assert.equal(calls[0].fields.request.items, undefined);
  assert.equal(await f.flow.preview({ type: 'image', templateId: 'logo', position: 'top-right', opacity: 50, scale: 25 }), true);
  assert.equal(calls[1].fields.request.config.templateId, 'logo'); assert.equal(calls[1].fields.request.config.imageUrl, undefined);
});
test('a template read from a previous draft does not populate a new context', async () => {
  let finish; const pending = new Promise(resolve => { finish = resolve; });
  const f = fixture({ command: async () => pending }); const request = f.flow.loadTemplates();
  f.changeBinding({ shopId: 'other' });
  finish({ data: { contractVersion: 'extension-workbench-watermark/v1', templates: [{ id: 'logo', name: 'Logo', position: 'center', opacity: 50, scale: 25, isDefault: false }] } });
  assert.equal(await request, false); assert.deepEqual(f.flow.state().templates, []); assert.match(f.flow.state().templateError, /已变化/u);
});
test('an unavailable template read leaves text watermark and existing preview state usable', async () => {
  const f = fixture({ command: async type => { if (type === 'WATERMARK_TEMPLATES') throw new Error('list unavailable');
    return { data: { contractVersion: 'extension-workbench-watermark/v1', previewHash: 'a'.repeat(64), items: [{ dataUrl: 'data:image/jpeg;base64,YQ==' }] } }; } });
  assert.equal(await f.flow.loadTemplates(), false); assert.match(f.flow.state().templateError, /list unavailable/u);
  assert.equal(await f.flow.preview(f.config), true); assert.equal(f.flow.state().unknown, false);
});
test('changed draft or selection invalidates a preview before a write', async () => {
  const f = fixture(); await f.flow.preview(f.config); f.changeBinding({ draftRevision: 3 });
  assert.equal(await f.flow.apply(), false); assert.equal(f.calls.length, 1); assert.match(f.flow.state().error, /已变化/u);
});
test('unknown mutation retains one request for explicit idempotent verification after authority refresh', async () => {
  let attempts = 0; let f;
  f = fixture({ command: async (type, fields) => {
    f.calls.push({ type, fields });
    if (type === 'WATERMARK_PREVIEW') return { data: { contractVersion: 'extension-workbench-watermark/v1', previewHash: 'a'.repeat(64), items: [{ dataUrl: 'data:image/jpeg;base64,YQ==' }] } };
    if (++attempts === 1) throw Object.assign(new Error('timeout'), { outcome: 'UNKNOWN_OUTCOME' });
    return { data: f.result };
  } });
  await f.flow.preview(f.config); assert.equal(await f.flow.apply(), false); assert.equal(f.flow.state().unknown, true);
  assert.equal(f.flow.invalidate(), false); assert.equal(await f.flow.preview(f.config), false);
  f.changeBinding({ draftRevision: 3, draftVersion: 3 }); assert.equal(await f.flow.apply(), true);
  assert.deepEqual(f.calls[1].fields.request, f.calls[2].fields.request); assert.equal(f.flow.state().unknown, false);
});
test('foreign draft success response remains unknown rather than falsely applied', async () => {
  const f = fixture(); await f.flow.preview(f.config); f.result.draft.shopId = 'foreign';
  assert.equal(await f.flow.apply(), false); assert.equal(f.flow.state().unknown, true); assert.equal(f.flow.state().applied, 0);
});
test('a confirmed apply survives a failing later read without a second mutation', async () => {
  const f = fixture({ onApplied: async () => { throw new Error('read failed'); } });
  await f.flow.preview(f.config); assert.equal(await f.flow.apply(), true);
  assert.equal(f.flow.state().unknown, false); assert.equal(f.flow.state().applied, 1); assert.match(f.flow.state().error, /已应用/u);
  assert.equal(await f.flow.apply(), false); assert.equal(f.calls.length, 2);
});
test('empty and over-limit selections never call the ERP', async () => {
  const f = fixture({ getItems: () => [] }); assert.equal(await f.flow.preview(f.config), false); assert.equal(f.calls.length, 0);
  const g = fixture({ getItems: () => Array.from({ length: 6 }, () => ({})) }); assert.equal(await g.flow.preview(g.config), false); assert.equal(g.calls.length, 0);
});
