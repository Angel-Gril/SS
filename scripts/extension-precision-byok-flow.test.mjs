import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const resultId = 'br_' + 'a'.repeat(48);
const context = { contractVersion: 'extension-byok-workbench-launch-context/v1', sourcePlatform: '1688',
  sourceProductId: 'product-1', sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1', shopId: 'shop-1',
  workflowId: 'draft-1', draftRevision: 3, draftVersion: 4, skuKey: 'sku-1', slotKey: 'sku:sku-1:hero',
  assignmentMode: 'APPEND', assignmentOrdinal: 0 };
const receipt = { contractVersion: 'extension-byok-generated-asset-ingest-client/v1', replayed: false,
  receiptId: 'receipt-1', assetId: 'asset-1', provenanceId: 'provenance-1', normalizedSha256: 'b'.repeat(64),
  mimeType: 'image/png', width: 1024, height: 1024, sourceDraftRevision: 3, sourceDraftVersion: 4,
  boundDraftRevision: 4, boundDraftVersion: 5, assignmentOrdinal: 0, assignmentSha256: 'c'.repeat(64),
  skuKey: 'sku-1', slotKey: 'sku:sku-1:hero' };
const candidate = { resultId, reviewState: 'CANDIDATE_READY', deliveryState: 'NOT_INGESTED' };
const bound = { resultId, reviewState: 'APPROVED', deliveryState: 'BOUND', ingest: receipt };
const bindingKeys = ['sourcePlatform', 'sourceProductId', 'sourceCaptureSnapshotId', 'supplyGoodsId',
  'shopId', 'workflowId', 'draftRevision', 'draftVersion', 'skuKey'];
const plain = value => JSON.parse(JSON.stringify(value));

function harness() {
  const sandbox = vm.createContext({ structuredClone, Date, Set, console });
  vm.runInContext(readFileSync('extensions/ss-erp/shared/donor-workbench/precision-byok-flow.js', 'utf8'), sandbox);
  let binding = { ...Object.fromEntries(bindingKeys.map(key => [key, context[key]])), slotKey: context.slotKey, assignmentMode: 'APPEND', assignmentOrdinal: 0 };
  let publicState = { contractVersion: 'extension-byok-workbench-public-state/v1', executionMode: 'BYOK',
    context, profiles: [], result: null, generationOutcome: null, deliveryState: 'NOT_READY', publish: null };
  const calls = [], changes = [];
  const media = {
    async getPublicState() { calls.push(['read']); return structuredClone(publicState); },
    async getReadiness(id) { calls.push(['readiness', id]); return { readinessHandle: 'fixture-handle' }; },
    async generate(value) { calls.push(['generate', structuredClone(value)]); publicState.result = candidate; return candidate; },
    async openPreview(id) { calls.push(['preview', id]); return { objectUrl: 'blob:fixture', metadata: { mimeType: 'image/png', byteLength: 50, sha256: 'd'.repeat(64) }, revoke() { calls.push(['revoke']); } }; },
    async reviewResult(id, decision) { calls.push(['review', id, decision]); publicState.result = decision === 'APPROVE'
      ? { ...candidate, reviewState: 'APPROVED' } : null; return decision === 'APPROVE' ? publicState.result : { resultId: id, reviewState: 'REJECTED' }; },
    async ingestApproved(id) { calls.push(['ingest', id]); publicState.result = bound; return bound; },
  };
  const flow = sandbox.SS_ERP_PRECISION_BYOK_FLOW.createController({ media,
    registerUi: async () => { calls.push(['register']); return { registered: true, state: calls.some(c => c[0] === 'launch') ? 'MEDIA_READY' : 'UI_REGISTERED' }; },
    openSession: async value => { calls.push(['launch', plain(value)]); return { state: 'workbench_embedded' }; },
    getBinding: () => binding, newOperationKey: () => 'precision-generate-fixture', onChange: state => changes.push(plain(state)) });
  return { flow, media, calls, changes, setBinding(value) { binding = value; }, binding: () => binding,
    setPublic(value) { publicState = { ...publicState, ...value }; } };
}
const generateInput = () => ({ profileId: 'profile-1', prompt: '保留商品形状，浅灰背景', negativePrompt: '', size: '1024x1024', chargeConfirmed: true });

test('connect uses the source-page launch owner, re-registers MEDIA_READY and reads state without dispatch', async () => {
  const f = harness(); await f.flow.connect();
  assert.deepEqual(f.calls.map(c => c[0]), ['register', 'launch', 'register', 'read']);
  assert.deepEqual(f.calls[1][1], { listingWorkflowId: 'draft-1', preferredSkuKey: 'sku-1' });
  assert.equal(f.flow.state().ready, true);
});
test('generate freezes exact prompt and binding, rejects double click and requires explicit charge consent', async () => {
  const f = harness(); await f.flow.connect();
  await assert.rejects(f.flow.generate({ ...generateInput(), chargeConfirmed: false }), /CONFIRMATION_REQUIRED/);
  let finish; f.media.generate = value => { f.calls.push(['generate', plain(value)]); return new Promise(resolve => { finish = resolve; }); };
  const running = f.flow.generate(generateInput());
  await assert.rejects(f.flow.generate(generateInput()), /BUSY/);
  for (let i = 0; i < 8; i++) await Promise.resolve();
  finish(candidate); await running;
  assert.equal(f.calls.filter(c => c[0] === 'generate').length, 1);
  assert.equal(f.calls.find(c => c[0] === 'generate')[1].idempotencyKey, 'precision-generate-fixture');
  assert.equal(f.flow.state().candidate.reviewState, 'CANDIDATE_READY');
});
test('a changed SKU/shop/revision while readiness is loading submits no Provider request', async () => {
  const f = harness(); await f.flow.connect();
  f.media.getReadiness = async () => { f.setBinding({ ...f.binding(), skuKey: 'sku-2' }); return {}; };
  await assert.rejects(f.flow.generate(generateInput()), /CONTEXT_STALE/);
  assert.equal(f.calls.some(c => c[0] === 'generate'), false);
});
test('preview is required before approve and approval never implicitly ingests or publishes', async () => {
  const f = harness(); await f.flow.connect(); await f.flow.generate(generateInput());
  await assert.rejects(f.flow.review('APPROVE'), /PREVIEW_REQUIRED/);
  const preview = await f.flow.preview(); assert.equal(preview.objectUrl, 'blob:fixture'); f.flow.confirmPreview(resultId);
  await f.flow.review('APPROVE');
  assert.equal(f.flow.state().candidate.reviewState, 'APPROVED');
  assert.equal(f.calls.some(c => c[0] === 'ingest'), false);
});
test('only a verified bound receipt closes ingest, exact readback does not send another ingest', async () => {
  const f = harness(); await f.flow.connect(); await f.flow.generate(generateInput()); await f.flow.preview(); f.flow.confirmPreview(resultId);
  await f.flow.review('APPROVE'); await f.flow.ingest();
  f.setBinding({ ...f.binding(), draftRevision: 4, draftVersion: 5 });
  await f.flow.refresh();
  assert.equal(f.flow.state().candidate.ingest.receiptId, 'receipt-1');
  assert.equal(f.calls.filter(c => c[0] === 'ingest').length, 1);
  await assert.rejects(f.flow.ingest(), /REVIEW_REQUIRED/);
});
test('unknown generation stays fenced until an authoritative result is read; refresh never POSTs', async () => {
  const f = harness(); await f.flow.connect();
  f.media.generate = async () => { f.calls.push(['generate']); throw new Error('lost transport'); };
  await assert.rejects(f.flow.generate(generateInput()));
  f.setPublic({ generationOutcome: 'UNKNOWN_OUTCOME' }); await f.flow.refresh();
  await assert.rejects(f.flow.generate(generateInput()), /RESULT_PENDING/);
  f.setPublic({ generationOutcome: null, result: candidate }); await f.flow.refresh();
  assert.equal(f.flow.state().candidate.resultId, resultId);
  assert.equal(f.calls.filter(c => c[0] === 'generate').length, 1);
});
test('lost review and ingest responses only allow readback, never a blind replay', async () => {
  const f = harness(); await f.flow.connect(); await f.flow.generate(generateInput()); await f.flow.preview(); f.flow.confirmPreview(resultId);
  f.media.reviewResult = async () => { throw new Error('lost review response'); };
  await assert.rejects(f.flow.review('APPROVE')); await assert.rejects(f.flow.review('APPROVE'), /READBACK_REQUIRED/);
  f.setPublic({ result: { ...candidate, reviewState: 'APPROVED' } }); await f.flow.refresh();
  f.media.ingestApproved = async () => { f.calls.push(['ingest']); throw new Error('lost ingest response'); };
  await assert.rejects(f.flow.ingest()); await assert.rejects(f.flow.ingest(), /READBACK_REQUIRED/);
  f.setPublic({ result: bound }); f.setBinding({ ...f.binding(), draftRevision: 4, draftVersion: 5 }); await f.flow.refresh();
  assert.equal(f.flow.state().candidate.deliveryState, 'BOUND');
  assert.equal(f.calls.filter(c => c[0] === 'ingest').length, 1);
});
test('malformed or another SKU receipt remains unknown and does not announce assignment', async () => {
  const f = harness(); await f.flow.connect(); await f.flow.generate(generateInput()); await f.flow.preview(); f.flow.confirmPreview(resultId); await f.flow.review('APPROVE');
  f.media.ingestApproved = async () => ({ ...bound, ingest: { ...receipt, skuKey: 'another-sku' } });
  await assert.rejects(f.flow.ingest(), /RESPONSE_INVALID/);
  assert.notEqual(f.flow.state().candidate.deliveryState, 'BOUND');
  assert.equal(f.flow.state().readbackRequired, true);
});
test('another draft or SKU public response is rejected and cannot clear a pending result', async () => {
  const f = harness(); await f.flow.connect(); await f.flow.generate(generateInput());
  f.setPublic({ context: { ...context, shopId: 'foreign-shop' }, result: null });
  await assert.rejects(f.flow.refresh(), /CONTEXT_STALE/);
  assert.equal(f.flow.state().candidate.resultId, resultId);
  await assert.rejects(f.flow.generate(generateInput()));
});
test('reject releases the preview and permits a fresh operation only after confirmed removal', async () => {
  const f = harness(); await f.flow.connect(); await f.flow.generate(generateInput()); await f.flow.preview(); f.flow.confirmPreview(resultId);
  await f.flow.review('REJECT'); assert.equal(f.flow.state().candidate, null);
  assert.equal(f.calls.filter(c => c[0] === 'revoke').length, 1);
});
