import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const context = { contractVersion: 'extension-byok-workbench-launch-context/v1', sourcePlatform: '1688', sourceProductId: 'p1', sourceCaptureSnapshotId: 's1', supplyGoodsId: 'g1', shopId: 'shop-1', workflowId: 'draft-1', draftRevision: 3, draftVersion: 4, skuKey: 'sku-1', slotKey: 'sku:sku-1:hero', assignmentMode: 'APPEND', assignmentOrdinal: 0 };
const snapshot = (state = 'CANDIDATE_READY') => ({ contractVersion: 'extension-byok-workbench-edit-controller/v1', operation: 'IMAGE_TO_IMAGE', scheduler: { state: 'REVIEW', activeCount: 0, queuedCount: 0 }, slot: { slotKey: context.slotKey, revision: 2, selectedAttemptId: 'attempt-000001' }, alternatives: [{ attemptId: 'attempt-000001', candidateId: 'br_' + 'a'.repeat(48), state, selected: true }] });

function harness() {
  const sandbox = vm.createContext({ structuredClone, Date, Set });
  vm.runInContext(readFileSync('extensions/ss-erp/shared/donor-workbench/precision-byok-edit-flow.js', 'utf8'), sandbox);
  const calls = [];
  let current = structuredClone(snapshot());
  const media = {
    async getPublicState() { calls.push(['state']); return { contractVersion: 'extension-byok-workbench-public-state/v1', executionMode: 'BYOK', context, generationOutcome: null }; },
    async getEditState() { calls.push(['edit-state']); return current; },
    async getSourceCatalog() { calls.push(['catalog']); return { contractVersion: 'extension-byok-workbench-source-catalog/v1', items: [{ sourceMediaKey: 'media-1', role: 'product_main', label: '商品主图' }, { sourceMediaKey: 'media-2', role: 'product_detail', label: '详情图' }] }; },
    async openSourcePreview(key) { calls.push(['source-preview', key]); return { blob: new Blob(['png'], { type: 'image/png' }), revoke() { calls.push(['source-revoke', key]); } }; },
    async uploadEditMedia(purpose) { calls.push(['upload', purpose]); return { mediaHandle: 'mh_' + 'b'.repeat(48), metadata: { mimeType: 'image/png', byteLength: 3, width: 10, height: 10, sha256: 'c'.repeat(64) } }; },
    async setEditReferences(value) { calls.push(['references', value]); return { executionMode: 'BYOK' }; },
    async releaseEditMedia(handle, purpose) { calls.push(['release', handle, purpose]); },
    async startEdit(value) { calls.push(['start', value]); current = snapshot(); return current; },
    async selectEditAlternative(id) { calls.push(['select', id]); current = snapshot(); return current; },
    async openEditPreview(id) { calls.push(['edit-preview', id]); return { objectUrl: 'blob:edit-preview', revoke() { calls.push(['preview-revoke']); } }; },
    async prepareEditReview(id, revision) { calls.push(['prepare-review', id, revision]); return { resultId: 'br_' + 'a'.repeat(48), reviewState: 'CANDIDATE_READY', deliveryState: 'NOT_INGESTED' }; },
  };
  const flow = sandbox.SS_ERP_PRECISION_BYOK_EDIT_FLOW.createController({ media, getBinding: () => context, onChange() {} });
  return { flow, media, calls };
}

test('connects exact source draft context and loads only current source media', async () => {
  const f = harness(); await f.flow.connect(); const state = await f.flow.loadCatalog();
  assert.deepEqual(state.catalog.map(item => item.sourceMediaKey), ['media-1', 'media-2']);
  assert.deepEqual(f.calls.map(call => call[0]), ['state', 'edit-state', 'catalog']);
});
test('reference upload is bounded, uses Blob preview, and commits handles only after setEditReferences', async () => {
  const f = harness(); await f.flow.connect(); await f.flow.loadCatalog();
  const state = await f.flow.setReferences(['media-1', 'media-2']);
  assert.equal(state.references.length, 2);
  assert.deepEqual(f.calls.filter(call => call[0] === 'upload').map(call => call[1]), ['REFERENCE', 'REFERENCE']);
  assert.equal(f.calls.filter(call => call[0] === 'references').length, 1);
  await assert.rejects(f.flow.setReferences(['foreign-media']), /REFERENCE_INVALID/);
});
test('reference generation freezes the selected handles, previews a candidate, and hands off only selected review', async () => {
  const f = harness(); await f.flow.connect(); await f.flow.loadCatalog(); await f.flow.setReferences(['media-1']);
  await f.flow.start({ profileId: 'profile-1', operation: 'IMAGE_TO_IMAGE', prompt: '保留商品结构,浅灰背景', size: '1024x1024', sourceHandle: null, maskHandle: null });
  const selected = await f.flow.select('attempt-000001'); assert.equal(selected.snapshot.slot.selectedAttemptId, 'attempt-000001');
  const preview = await f.flow.openCandidate('attempt-000001'); assert.equal(preview.preview.objectUrl, 'blob:edit-preview');
  const handoff = await f.flow.prepareReview();
  assert.equal(handoff.handoff.resultId, 'br_' + 'a'.repeat(48));
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.find(call => call[0] === 'start')[1])), { profileId: 'profile-1', operation: 'IMAGE_TO_IMAGE', prompt: '保留商品结构,浅灰背景', negativePrompt: null, size: '1024x1024', sourceHandle: null, maskHandle: null });
});
test('failed reference synchronization does not expose partial handles and invalidates the flow', async () => {
  const f = harness(); await f.flow.connect(); await f.flow.loadCatalog();
  f.media.setEditReferences = async () => { throw new Error('set reference failed'); };
  await assert.rejects(f.flow.setReferences(['media-1']), /set reference failed/);
  assert.equal(f.flow.state().references.length, 0);
  f.flow.invalidate(); assert.equal(f.flow.state().connected, false);
});
test('changed draft context is rejected before starting Provider edit', async () => {
  const f = harness(); await f.flow.connect(); await f.flow.loadCatalog(); await f.flow.setReferences(['media-1']);
  f.media.startEdit = async () => { throw new Error('must not dispatch'); };
  f.flow.invalidate();
  await assert.rejects(f.flow.start({ profileId: 'profile-1', operation: 'IMAGE_TO_IMAGE', prompt: 'x', size: '1024x1024', sourceHandle: null, maskHandle: null }));
  assert.equal(f.calls.some(call => call[0] === 'start'), false);
});
test('full edit uses one validated source handle and never accepts a reference handle as source', async () => {
  const f = harness(); await f.flow.connect(); await f.flow.loadCatalog(); await f.flow.setSource('media-1');
  await f.flow.start({ profileId: 'profile-1', operation: 'FULL_EDIT', prompt: '调整整张图背景', size: '1024x1024', sourceHandle: 'mh_' + 'b'.repeat(48), maskHandle: null });
  assert.equal(f.calls.find(call => call[0] === 'start')[1].operation, 'FULL_EDIT');
  await assert.rejects(f.flow.start({ profileId: 'profile-1', operation: 'FULL_EDIT', prompt: 'x', size: '1024x1024', sourceHandle: null, maskHandle: null }), /SOURCE_REQUIRED/);
});
test('inpaint requires a separate MASK handle and rejects missing or wrong-purpose masks', async () => {
  const f = harness(); await f.flow.connect(); await f.flow.loadCatalog(); await f.flow.setSource('media-1');
  await assert.rejects(f.flow.start({ profileId: 'profile-1', operation: 'INPAINT', prompt: '改动选区', size: '1024x1024', sourceHandle: 'mh_' + 'b'.repeat(48), maskHandle: null }), /MASK_REQUIRED/);
  await f.flow.setMaskBlob(new Blob(['mask'], { type: 'image/png' }));
  await f.flow.start({ profileId: 'profile-1', operation: 'INPAINT', prompt: '改动选区', size: '1024x1024', sourceHandle: 'mh_' + 'b'.repeat(48), maskHandle: 'mh_' + 'b'.repeat(48) });
  assert.equal(f.calls.find(call => call[0] === 'start')[1].operation, 'INPAINT');
});

console.log('PASS extension precision BYOK edit flow contract');
