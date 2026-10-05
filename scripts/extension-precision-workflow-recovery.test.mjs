import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const context = { URL };
for (const source of ['workspace-contract.js', 'precision-workflow.js'])
  vm.runInNewContext(readFileSync('extensions/ss-erp/shared/donor-workbench/' + source, 'utf8'), context);
const api = context.SS_ERP_PRECISION_WORKFLOW, contract = context.SS_ERP_DONOR_WORKBENCH_CONTRACT;
const plain = (value) => JSON.parse(JSON.stringify(value));
const product = { productId: '123456', title: '商品', captureV2: { sourceIdentity: { productId: '123456',
  canonicalUrl: 'https://detail.1688.com/offer/123456.html' }, skus: ['red', 'blue', 'green'].map((key) => ({ key,
  specText: key, sourceSkuId: 'source-' + key, mediaKeys: [], priceCny: 10, stock: 0 })), media: [] } };
const handoff = { platform: '1688', sourceProductId: '123456', snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1' };
function summary(id = 'draft-1', shopId = 'shop', selectedSkuCount = 2) {
  return { id, shopId, revision: 1, draftVersion: 1, status: 'ACTIVE', stage: 'CATEGORY_REVIEW', runState: 'ACTIVE',
    selectedSkuCount, mediaAssignmentCount: 0, blockers: [], warnings: [] };
}
function setup(operation = 'CREATE_DRAFT', { missingReadback = false } = {}) {
  let currentProduct = product, currentHandoff = operation === 'CREATE_DRAFT' ? handoff : null,
    listings = [], snapshotCurrent = Boolean(currentHandoff), allowedShop = true, refreshError = null, readState = 'ready', readHook = null;
  const requests = [], editors = new Map(), readBindingChanges = new Map();
  let readFailure = null;
  const projection = () => contract.createProjection({ platform: '1688', product: currentProduct,
    shops: allowedShop ? [{ id: 'shop', name: 'Shop' }] : [], handoff: currentHandoff,
    workbench: { state: 'ready', status: { snapshot: { current: snapshotCurrent }, listing: { items: listings } } } });
  const session = api.createSession({ getProjection: projection, send: async (type, fields = {}) => {
    requests.push({ type, ...fields });
    if (type === 'REFRESH') { if (refreshError) throw refreshError; return { ok: true }; }
    if (type === 'EDITOR_READ') {
      if (readFailure) throw readFailure;
      if (readHook) readHook();
      const keys = editors.get(fields.listingWorkflowId);
      return { ok: true, data: { state: readState, editor: { contractVersion: 'extension-listing-editor/v1',
        binding: { ...fields.binding, ...readBindingChanges.get(fields.listingWorkflowId) }, selectedSkuKeys: keys || [] } } };
    }
    if (type === operation) {
      if (missingReadback) return { ok: true };
      throw Object.assign(new Error('原请求响应丢失'), { outcome: 'UNKNOWN_OUTCOME' });
    }
    throw Error('Unexpected mutation ' + type);
  } });
  const start = () => session.start({ shopId: 'shop', selectSkus: async (raw) => ({ ...raw,
    sku_matrix: raw.sku_matrix.filter((row) => row.row_id === 'red' || row.row_id === 'blue') }) });
  return { session, requests, start, editors, readBindingChanges,
    setListings(value) { listings = value; }, setHandoff(value) { currentHandoff = value; snapshotCurrent = Boolean(value); },
    setProduct(value) { currentProduct = value; }, setCurrent(value) { snapshotCurrent = value; },
    setAuthorized(value) { allowedShop = value; }, setRefreshError(value) { refreshError = value; },
    setReadFailure(value) { readFailure = value; },
    setReadState(value) { readState = value; }, setReadHook(value) { readHook = value; },
  };
}
async function unknown(fixture) {
  await assert.rejects(fixture.start(), (error) => error.outcome === 'UNKNOWN_OUTCOME');
  assert.equal(fixture.session.needsRecovery(), true);
}

test('a lost CREATE_DRAFT is recovered by fresh owner-scoped reads of exact snapshot/shop/SKU keys without a second write', async () => {
  const f = setup(); await unknown(f);
  f.setListings([summary()]); f.editors.set('draft-1', ['blue', 'red']);
  const result = await f.session.recoverCurrentDraft();
  assert.equal(result.state, 'ready'); assert.equal(result.recoveredOperation, 'CREATE_DRAFT');
  assert.equal(result.draft.id, 'draft-1'); assert.deepEqual(plain(result.selectedSkuKeys), ['blue', 'red']);
  assert.equal(f.session.needsRecovery(), false);
  assert.deepEqual(plain(f.requests).map((item) => item.type), ['REFRESH', 'CREATE_DRAFT', 'REFRESH', 'EDITOR_READ']);
  assert.deepEqual(plain(f.requests.at(-1)), { type: 'EDITOR_READ', listingWorkflowId: 'draft-1', binding: {
    snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1', shopId: 'shop', listingWorkflowId: 'draft-1', draftRevision: 1, draftVersion: 1 } });
  const draft = await f.start(); assert.equal(draft.id, 'draft-1');
  assert.equal(f.requests.filter((item) => item.type === 'CREATE_DRAFT').length, 1);
});

test('a successful create response without matching draft readback is UNKNOWN and remains blocked until proven', async () => {
  const f = setup('CREATE_DRAFT', { missingReadback: true }); await unknown(f);
  const result = await f.session.recoverCurrentDraft();
  assert.equal(result.state, 'recovery_required'); assert.equal(f.session.needsRecovery(), true);
  await assert.rejects(f.start(), /核对/);
  assert.equal(f.requests.filter((item) => item.type === 'CREATE_DRAFT').length, 1);
});

test('a lost COLLECT can confirm a current owned snapshot but never automatically creates a draft', async () => {
  const f = setup('COLLECT'); await unknown(f);
  f.setHandoff(handoff);
  const result = await f.session.recoverCurrentDraft();
  assert.equal(result.state, 'ready'); assert.equal(result.recoveredOperation, 'COLLECT'); assert.equal(result.draft, null);
  assert.equal(result.handoff.snapshotId, 'snapshot-1'); assert.equal(f.session.needsRecovery(), false);
  assert.deepEqual(plain(f.requests).map((item) => item.type), ['REFRESH', 'COLLECT', 'REFRESH']);
});

for (const mismatch of ['shop', 'sku', 'snapshot', 'goods', 'source', 'uncurrent', 'terminal', 'unauthorized', 'unavailable']) {
  test('read-only recovery remains blocked for changed ' + mismatch, async () => {
    const f = setup(); await unknown(f);
    const draft = summary(); f.setListings([draft]); f.editors.set(draft.id, ['blue', 'red']);
    if (mismatch === 'shop') draft.shopId = 'other-shop';
    if (mismatch === 'sku') f.editors.set(draft.id, ['green', 'red']);
    if (mismatch === 'snapshot') f.setHandoff({ ...handoff, snapshotId: 'new-snapshot' });
    if (mismatch === 'goods') f.setHandoff({ ...handoff, supplyGoodsId: 'other-goods' });
    if (mismatch === 'source') f.setProduct({ ...product, productId: 'other-product', captureV2: { ...product.captureV2,
      sourceIdentity: { productId: 'other-product', canonicalUrl: 'https://detail.1688.com/offer/9999.html' } } });
    if (mismatch === 'uncurrent') f.setCurrent(false);
    if (mismatch === 'terminal') draft.stage = 'PUBLISHED';
    if (mismatch === 'unauthorized') f.setAuthorized(false);
    if (mismatch === 'unavailable') f.setReadFailure(new Error('设备身份已失效'));
    const result = await f.session.recoverCurrentDraft();
    assert.equal(result.state, 'recovery_required'); assert.equal(f.session.needsRecovery(), true);
    await assert.rejects(f.start(), /核对/);
    assert.equal(f.requests.filter((item) => ['COLLECT', 'CREATE_DRAFT'].includes(item.type)).length, 1);
  });
}

test('recovering COLLECT refuses absent snapshots or source SKU drift', async () => {
  const f = setup('COLLECT'); await unknown(f);
  assert.equal((await f.session.recoverCurrentDraft()).state, 'recovery_required');
  f.setHandoff(handoff); f.setProduct({ ...product, captureV2: { ...product.captureV2, skus: product.captureV2.skus.slice(0, 1) } });
  assert.equal((await f.session.recoverCurrentDraft()).state, 'recovery_required');
  assert.equal(f.session.needsRecovery(), true);
  assert.equal(f.requests.filter((item) => item.type === 'COLLECT').length, 1);
});

test('recovery searches same-shop summaries by exact SKU identity instead of selecting the newest count match', async () => {
  const f = setup(); await unknown(f);
  f.setListings([summary('wrong'), summary('exact')]);
  f.editors.set('wrong', ['green', 'red']); f.editors.set('exact', ['red', 'blue']);
  const result = await f.session.recoverCurrentDraft();
  assert.equal(result.state, 'ready'); assert.equal(result.draft.id, 'exact');
  assert.equal(f.session.currentDraft('shop').id, 'exact');
  assert.equal(f.session.currentDraft('other-shop'), null);
  assert.equal(f.requests.filter((item) => item.type === 'EDITOR_READ').length, 2);
});

test('two indistinguishable candidates or stale editor bindings do not claim a closed recovery', async () => {
  for (const mismatch of ['ambiguous', 'editor']) {
    const f = setup(); await unknown(f);
    f.setListings([summary('first'), ...(mismatch === 'ambiguous' ? [summary('second')] : [])]);
    f.editors.set('first', ['blue', 'red']); f.editors.set('second', ['blue', 'red']);
    if (mismatch === 'editor') f.readBindingChanges.set('first', { draftRevision: 2 });
    assert.equal((await f.session.recoverCurrentDraft()).state, 'recovery_required');
    assert.equal(f.session.needsRecovery(), true);
  }
});

test('an unavailable editor or source switch during its read cannot clear original uncertainty', async () => {
  for (const mismatch of ['read-state', 'context']) {
    const f = setup(); await unknown(f); f.setListings([summary()]); f.editors.set('draft-1', ['red', 'blue']);
    if (mismatch === 'read-state') f.setReadState('unavailable');
    else f.setReadHook(() => f.setHandoff({ ...handoff, snapshotId: 'new-snapshot' }));
    assert.equal((await f.session.recoverCurrentDraft()).state, 'recovery_required');
    assert.equal(f.session.needsRecovery(), true);
  }
});

test('a failed read preserves the original pending context and never sends a new mutation', async () => {
  const f = setup(); await unknown(f); f.setRefreshError(new Error('REFRESH 网络失败'));
  assert.equal((await f.session.recoverCurrentDraft()).state, 'recovery_required');
  assert.equal(f.session.needsRecovery(), true);
  f.setRefreshError(null); f.setListings([summary()]); f.editors.set('draft-1', ['red', 'blue']);
  assert.equal((await f.session.recoverCurrentDraft()).state, 'ready');
  assert.equal(f.requests.filter((item) => item.type === 'CREATE_DRAFT').length, 1);
});

test('a recovered preferred draft disappearing never substitutes another same-shop draft', async () => {
  const f = setup(); await unknown(f);
  f.setListings([summary('wrong'), summary('exact')]); f.editors.set('wrong', ['green', 'red']); f.editors.set('exact', ['blue', 'red']);
  assert.equal((await f.session.recoverCurrentDraft()).state, 'ready');
  f.setListings([summary('wrong')]);
  assert.equal(f.session.currentDraft('shop'), null);
  assert.equal(f.session.needsRecovery(), true);
  await assert.rejects(f.start(), /核对/);
  assert.equal((await f.session.recoverCurrentDraft()).state, 'recovery_required');
  assert.equal(f.requests.filter((item) => item.type === 'CREATE_DRAFT').length, 1);
});

test('snapshot and shop authority changes revoke a recovered preference instead of reusing it', async () => {
  const f = setup(); await unknown(f);
  f.setListings([summary('exact')]); f.editors.set('exact', ['blue', 'red']);
  await f.session.recoverCurrentDraft();
  f.setHandoff({ ...handoff, snapshotId: 'new-snapshot', supplyGoodsId: 'new-goods' });
  f.setListings([summary('new-current')]);
  assert.equal(f.session.currentDraft('shop').id, 'new-current');
  f.setAuthorized(false);
  assert.equal(f.session.currentDraft('shop'), null);
});

test('ordinary rejected writes do not become unresolved or lose normal retryability', async () => {
  let calls = 0;
  const projection = contract.createProjection({ platform: '1688', product, handoff, shops: [{ id: 'shop', name: 'Shop' }] });
  const session = api.createSession({ getProjection: () => projection, send: async (type) => {
    if (type === 'CREATE_DRAFT') { calls++; throw Object.assign(new Error('拒绝'), { outcome: 'NOT_SUBMITTED' }); }
    return { ok: true };
  } });
  const input = { shopId: 'shop', selectSkus: async (raw) => raw };
  await assert.rejects(session.start(input), /拒绝/); assert.equal(session.needsRecovery(), false);
  await assert.rejects(session.start(input), /拒绝/); assert.equal(calls, 2);
});

test('recovery is guarded against concurrent read/start operations', async () => {
  const f = setup(); await unknown(f);
  f.setListings([summary()]); f.editors.set('draft-1', ['red', 'blue']);
  const recovery = f.session.recoverCurrentDraft();
  await assert.rejects(f.session.recoverCurrentDraft(), /正在/);
  await assert.rejects(f.start(), /正在/);
  await recovery; assert.equal(f.session.needsRecovery(), false);
});
