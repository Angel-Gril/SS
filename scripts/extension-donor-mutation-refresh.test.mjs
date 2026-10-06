import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const root = 'extensions/ss-erp';
const extensionId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const flush = () => new Promise(resolve => setImmediate(resolve));

async function harness() {
  const nodes = [], frameMessages = [], runtimeRequests = [], listeners = new Map();
  const pendingStatus = [], pendingBilling = [], pendingMutation = [], pendingEditor = [];
  const handoff = { snapshotId: 'snapshot-fixture', supplyGoodsId: 'goods-fixture',
    sourceProductId: '845581683597', platform: '1688' };
  let listing = { id: 'draft-fixture', shopId: 'doth', stage: 'MEDIA_REVIEW', status: 'ACTIVE',
    runState: 'ACTIVE', revision: 2, draftVersion: 2, selectedSkuCount: 1, mediaAssignmentCount: 0,
    blockers: [], warnings: [], updatedAt: '2026-10-04T00:00:00.000Z' };
  let delayStatus = false, delayBilling = false, delayMutation = false, delayEditor = false, captureError = null;
  const statusResponse = () => ({ ok: true, handoff: structuredClone(handoff),
    result: { state: 'ready', status: { snapshot: { current: true },
      listing: { items: [structuredClone(listing)], truncated: false },
      media: { items: [], actionableCount: 0 } } } });
  const billingResponse = (reviewStatus = 'REJECTED') => ({ ok: true, result: { state: 'ready', projection: {
    contractVersion: 'extension-ai-image-suite-projection/v1', context: {
      ...handoff, shopId: listing.shopId, listingWorkflowId: listing.id,
      draftRevision: listing.revision, draftVersion: listing.draftVersion,
    }, plan: { preview: { currency: 'CNY', itemCount: 2, estimatedCostCents: 28, maximumCostCents: 28 } },
    suite: { status: 'SUCCEEDED', slots: [{ slotKey: 'sku:sku-white:hero', goal: '商品主图',
      status: 'SUCCEEDED', workflowId: 'media-fixture', reviewStatus, output: { id: 'output-fixture' },
      billing: { mode: 'ERP_HOSTED', currency: 'CNY', estimatedCostMinor: 14, maximumCostMinor: 14,
        reservationStatus: 'SETTLED', settlement: { kind: 'RECONCILED_CHARGE', actualCostMinor: 14, billedUnits: 1 } },
    }] },
  } } });
  function node() {
    const handlers = new Map();
    const item = { style: { removeProperty() {} }, hidden: false,
      contentWindow: { postMessage(message) { frameMessages.push(JSON.parse(JSON.stringify(message))); } },
      setAttribute() {}, appendChild() {}, remove() {},
      addEventListener(type, listener) { handlers.set(type, listener); },
      click() { handlers.get('click')?.({ target: item }); } };
    nodes.push(item); return item;
  }
  const environment = { URL, console,
    location: { href: `https://detail.1688.com/offer/${handoff.sourceProductId}.html`, hostname: 'detail.1688.com' },
    document: { documentElement: node(), createElement: node, addEventListener() {},
      getElementById(id) { return nodes.find(item => item.id === id); } },
    chrome: { runtime: { id: extensionId,
      getURL(path) { return `chrome-extension://${extensionId}/${path.replace(/^\//u, '')}`; },
      getManifest() { return { version: '1.0.412' }; }, onMessage: { addListener() {} },
      sendMessage(request, callback) {
        runtimeRequests.push(JSON.parse(JSON.stringify(request)));
        if (request.type === 'spb-self-hosted:get-ozon-shops') callback({ ok: true, data: [{ id: 'doth', name: 'DOTH', status: 'ACTIVE' }] });
        else if (request.type === 'ss-erp:source-listing-workbench-status') {
          if (delayStatus) pendingStatus.push(callback); else callback(statusResponse());
        } else if (request.type === 'ss-erp:source-listing-workbench-ai-image-suite') {
          if (delayBilling) pendingBilling.push(callback); else callback(billingResponse());
        } else if (request.type === 'ss-erp:source-listing-workbench-media-history') callback({ ok: true, result: {
          state: 'ready', history: { context: { ...handoff, shopId: listing.shopId,
            listingWorkflowId: listing.id, revision: listing.revision, draftVersion: listing.draftVersion },
          items: [], nextCursor: null },
        } });
        else if (request.type.startsWith('ss-erp:source-listing-workbench-editor-')) {
          if (delayEditor) pendingEditor.push({ request, callback });
          else callback({ ok: true, result: { state: 'ready', editor: { binding: request.binding } } });
        }
        else if (request.type === 'ss-erp:source-listing-workbench-ai-image-suite-command'
          || request.type === 'ss-erp:source-listing-workbench-ai-image-suite-assignment') {
          if (delayMutation) pendingMutation.push(callback);
          else callback({ ok: true, result: { state: 'completed', action: request.action, replay: false } });
        } else throw new Error(`unexpected fixture request ${request.type}`);
      },
    } },
    SS_ERP_DONOR_1688_CAPTURE: { async collect() { if (captureError) throw captureError;
      return { productId: handoff.sourceProductId, title: '测试商品',
      captureV2: { skus: [{ key: 'sku-white', name: '白色 / S' }] } }; } },
    addEventListener(type, listener) { listeners.set(type, listener); },
    setTimeout() { return 1; }, clearTimeout() {},
  };
  environment.globalThis = environment;
  const context = vm.createContext(environment);
  vm.runInContext(readFileSync(`${root}/shared/donor-workbench/workspace-contract.js`, 'utf8'), context);
  vm.runInContext(readFileSync(`${root}/content/donor-workbench-bridge.js`, 'utf8'), context);
  const frame = nodes.find(item => item.id === 'ss-erp-donor-workbench-frame');
  nodes.find(item => item.id === 'ss-erp-donor-workbench-trigger').click();
  await flush();
  const command = (type, requestId, fields = {}) => listeners.get('message')({ source: frame.contentWindow,
    origin: new URL(frame.src).origin, data: { contractVersion: 'ss-erp-donor-workbench/v1',
      type, requestId, ...fields } });
  const review = (requestId = 'review-fixture') => command('EXECUTE_HOSTED_SUITE', requestId, {
    listingWorkflowId: listing.id, action: 'REVIEW_SLOT', slotKey: 'sku:sku-white:hero',
    decision: 'REJECT', costConfirmed: false,
  });
  return { frameMessages, runtimeRequests, pendingStatus, pendingBilling, pendingMutation, pendingEditor, handoff,
    statusResponse, billingResponse, command, review,
    delay({ status = false, billing = false, mutation = false, editor = false } = {}) {
      delayStatus = status; delayBilling = billing; delayMutation = mutation; delayEditor = editor;
    },
    updateListing(value) { listing = { ...listing, ...value }; },
    failCapture(error) { captureError = error; },
    results(requestId) { return frameMessages.filter(item => item.type === 'COMMAND_RESULT' && item.requestId === requestId); },
    projection() { return frameMessages.filter(item => item.type === 'PROJECTION').at(-1)?.projection; },
  };
}

test('a confirmed slot review is acknowledged before a slow authority refresh', async () => {
  const h = await harness();
  h.delay({ status: true, billing: true });
  h.review(); await flush();
  assert.deepEqual(h.results('review-fixture').map(item => item.ok), [true],
    'read-only refresh latency must not turn a committed review into UNKNOWN_OUTCOME');
  assert.equal(h.pendingStatus.length, 1);
  h.pendingStatus.shift()(h.statusResponse()); await flush();
  assert.equal(h.pendingBilling.length, 1);
  h.pendingBilling.shift()(h.billingResponse()); await flush();
  assert.deepEqual(h.results('review-fixture').map(item => item.ok), [true]);
  assert.equal(h.projection().billing.suite.slots[0].media.reviewStatus, 'REJECTED');
});

const editorBinding = { snapshotId: 'snapshot-fixture', supplyGoodsId: 'goods-fixture', shopId: 'doth',
  listingWorkflowId: 'draft-fixture', draftRevision: 2, draftVersion: 2 };

test('independent editor reads do not block one another or lock the whole workbench', async () => {
  const h = await harness(); h.delay({ editor: true });
  h.command('EDITOR_ATTRIBUTES', 'attributes', { binding: editorBinding, listingWorkflowId: 'draft-fixture' });
  h.command('EDITOR_CATALOG', 'catalog', { binding: editorBinding, listingWorkflowId: 'draft-fixture', query: '' });
  await flush();
  assert.equal(h.pendingEditor.length, 2);
  assert.equal(h.projection().busy, false);
  for (const { callback } of h.pendingEditor.splice(0)) callback({ ok: true, result: { state: 'ready' } });
  await flush();
  assert.equal(h.results('attributes')[0].ok, true);
  assert.equal(h.results('catalog')[0].ok, true);
});

test('identical concurrent editor reads share one transport and acknowledge both callers', async () => {
  const h = await harness(); h.delay({ editor: true });
  for (const id of ['read-a', 'read-b']) h.command('EDITOR_READ', id, { binding: editorBinding, listingWorkflowId: 'draft-fixture' });
  await flush(); assert.equal(h.pendingEditor.length, 1);
  h.pendingEditor.shift().callback({ ok: true, result: { state: 'ready', editor: { binding: editorBinding } } });
  await flush();
  assert.equal(h.results('read-a')[0].ok, true);
  assert.equal(h.results('read-b')[0].ok, true);
});

test('editor read waits for confirmed save and its authority refresh instead of reporting busy', async () => {
  const h = await harness(); h.delay({ editor: true, status: true });
  h.command('EDITOR_SAVE', 'save', { binding: editorBinding, listingWorkflowId: 'draft-fixture',
    action: 'CATEGORY', operationKey: 'precision-editor:test', value: { categoryId: 1, typeId: 2, catalogRevision: 'catalog' } });
  await flush();
  h.command('EDITOR_READ', 'read', { binding: editorBinding, listingWorkflowId: 'draft-fixture' });
  await flush(); assert.equal(h.results('read').length, 0);
  h.pendingEditor.shift().callback({ ok: true, result: { state: 'ready' } });
  await flush(); assert.equal(h.pendingStatus.length, 1);
  assert.equal(h.pendingEditor.length, 0, 'read waits through the post-save authority refresh');
  h.pendingStatus.shift()(h.statusResponse()); await flush();
  assert.equal(h.pendingEditor.length, 1);
  h.pendingEditor.shift().callback({ ok: true, result: { state: 'ready' } }); await flush();
  assert.equal(h.results('save')[0].ok, true);
  assert.equal(h.results('read')[0].ok, true);
});

test('overlapping projection refreshes join one current authority read', async () => {
  const h = await harness(); h.delay({ status: true });
  h.command('REFRESH', 'refresh-a'); h.command('REFRESH', 'refresh-b'); await flush();
  assert.equal(h.pendingStatus.length, 1);
  h.pendingStatus.shift()(h.statusResponse()); await flush();
  assert.equal(h.results('refresh-a')[0].ok, true);
  assert.equal(h.results('refresh-b')[0].ok, true);
});

test('post-save authority read never reuses a projection requested before the save committed', async () => {
  const h = await harness(); h.delay({ editor: true, status: true });
  h.command('EDITOR_SAVE', 'save', { binding: editorBinding, listingWorkflowId: 'draft-fixture',
    action: 'CATEGORY', operationKey: 'precision-editor:test', value: { categoryId: 1, typeId: 2, catalogRevision: 'catalog' } });
  await flush(); h.command('REFRESH', 'pre-commit-read'); await flush();
  const staleResponse = h.statusResponse();
  h.updateListing({ revision: 3, draftVersion: 3 });
  h.pendingEditor.shift().callback({ ok: true, result: { state: 'ready' } }); await flush();
  h.pendingStatus.shift()(staleResponse); await flush();
  assert.equal(h.pendingStatus.length, 1, 'post-save needs a new authority read after the pre-commit response');
  assert.equal(h.projection().busy, true, 'editor mutation stays locked until its fresh readback finishes');
  h.pendingStatus.shift()(h.statusResponse()); await flush();
  assert.equal(h.projection().workbench.status.listing.items[0].draftVersion, 3);
  assert.equal(h.projection().busy, false);
});

test('readback failure stays visible without rewriting a successful mutation receipt', async () => {
  const h = await harness(); h.delay({ billing: true });
  h.review(); await flush();
  h.pendingBilling.shift()({ ok: false, error: 'AUTHORITY_READ_TEMPORARILY_UNAVAILABLE' }); await flush();
  assert.deepEqual(h.results('review-fixture').map(item => item.ok), [true]);
  assert.equal(h.projection().billing.state, 'error');
  assert.equal(h.projection().billing.error, 'AUTHORITY_READ_TEMPORARILY_UNAVAILABLE');
  assert.equal(h.projection().busy, false);
  assert.equal(h.runtimeRequests.filter(item => item.type.endsWith('suite-command')).length, 1);
});

test('a failed source refresh preserves its read error and the verified review receipt', async () => {
  const h = await harness(); h.failCapture(new Error('SOURCE_READ_TEMPORARILY_UNAVAILABLE'));
  h.review(); await flush();
  assert.deepEqual(h.results('review-fixture').map(item => item.ok), [true]);
  assert.equal(h.projection().error, 'SOURCE_READ_TEMPORARILY_UNAVAILABLE');
  assert.equal(h.projection().busy, false);
});

test('a caller read joins the post-assignment refresh and observes the new draft version', async () => {
  const h = await harness(); h.delay({ status: true, billing: true });
  h.command('ASSIGN_HOSTED_SUITE', 'assign-fixture', { listingWorkflowId: 'draft-fixture' }); await flush();
  assert.deepEqual(h.results('assign-fixture').map(item => item.ok), [true]);
  h.command('LOAD_BILLING', 'billing-fixture', { listingWorkflowId: 'draft-fixture' }); await flush();
  assert.equal(h.pendingBilling.length, 0, 'do not read against the pre-assignment draft revision');
  h.updateListing({ revision: 3, draftVersion: 3, mediaAssignmentCount: 2 });
  h.pendingStatus.shift()(h.statusResponse()); await flush();
  assert.equal(h.pendingBilling.length, 1);
  h.pendingBilling.shift()(h.billingResponse('APPROVED')); await flush();
  assert.deepEqual(h.results('billing-fixture').map(item => item.ok), [true]);
  assert.equal(h.projection().workbench.status.listing.items[0].draftVersion, 3);
  assert.equal(h.projection().billing.state, 'ready');
  assert.equal(h.runtimeRequests.filter(item => item.type.endsWith('ai-image-suite')).length, 1,
    'the caller reuses the just-completed bound readback');
});

test('a failed or unresolved mutation never becomes successful due to a later state read', async () => {
  const h = await harness(); h.delay({ mutation: true });
  h.review(); await flush();
  h.pendingMutation.shift()({ ok: false, error: 'MUTATION_UNRESOLVED', outcome: 'UNKNOWN_OUTCOME' }); await flush();
  assert.deepEqual(h.results('review-fixture').map(item => item.ok), [false]);
  assert.equal(h.runtimeRequests.filter(item => item.type.endsWith('ai-image-suite')).length, 0);
  assert.equal(h.runtimeRequests.filter(item => item.type.endsWith('workbench-status')).length, 1);
});

test('an incomplete mutation response is not acknowledged as a completed review', async () => {
  const h = await harness(); h.delay({ mutation: true });
  h.review(); await flush();
  h.pendingMutation.shift()({ ok: true, result: { state: 'unavailable' } }); await flush();
  assert.deepEqual(h.results('review-fixture').map(item => item.ok), [false]);
  assert.equal(h.runtimeRequests.filter(item => item.type.endsWith('ai-image-suite')).length, 0);
});

test('late mutation completion does not refresh a different source snapshot', async () => {
  const h = await harness(); h.delay({ mutation: true });
  h.review(); await flush();
  h.handoff.snapshotId = 'new-snapshot';
  h.command('REFRESH', 'new-snapshot-refresh'); await flush();
  const before = h.runtimeRequests.length;
  h.pendingMutation.shift()({ ok: true, result: { state: 'completed', action: 'REVIEW_SLOT', replay: false } }); await flush();
  assert.deepEqual(h.results('review-fixture').map(item => item.ok), [true]);
  assert.equal(h.runtimeRequests.length, before, 'do not refresh or overwrite the successor snapshot with old mutation state');
  assert.equal(h.projection().handoff.snapshotId, 'new-snapshot');
  assert.equal(h.projection().busy, false, 'the completed original mutation releases its lock after a source switch');
});

test('the bridge does not dispatch a second mutation while the first is in flight', async () => {
  const h = await harness(); h.delay({ mutation: true });
  h.review('first-review'); h.review('second-review'); await flush();
  assert.equal(h.pendingMutation.length, 1);
  assert.deepEqual(h.results('second-review').map(item => item.ok), [false]);
  h.pendingMutation.shift()({ ok: true, result: { state: 'completed', action: 'REVIEW_SLOT', replay: false } }); await flush();
});

test('a manual projection refresh cannot release an in-flight suite mutation lock', async () => {
  const h = await harness(); h.delay({ mutation: true });
  h.review('first-review'); await flush();
  h.command('REFRESH', 'refresh-during-write'); await flush();
  h.review('second-review'); await flush();
  assert.equal(h.pendingMutation.length, 1);
  assert.equal(h.results('second-review')[0].ok, false);
  h.pendingMutation.shift()({ ok: true, result: { state: 'completed', action: 'REVIEW_SLOT', replay: false } }); await flush();
  assert.equal(h.projection().busy, false);
});

test('suite and assignment keep their lock across a pre-commit refresh and release queued editor reads after fresh billing', async () => {
  for (const kind of ['review', 'assignment']) {
    const h = await harness(); h.delay({ mutation: true, status: true, billing: true, editor: true });
    const dispatch = requestId => kind === 'review' ? h.review(requestId)
      : h.command('ASSIGN_HOSTED_SUITE', requestId, { listingWorkflowId: 'draft-fixture' });
    dispatch('first'); await flush();
    h.command('REFRESH', 'pre-commit-refresh'); await flush();
    const staleResponse = h.statusResponse();
    dispatch('second-before-commit'); await flush();
    assert.equal(h.pendingMutation.length, 1, kind + ': refresh cannot unlock the original mutation');
    assert.deepEqual(h.results('second-before-commit').map(item => item.ok), [false]);
    h.updateListing({ revision: 3, draftVersion: 3 });
    h.pendingMutation.shift()({ ok: true, result: { state: 'completed', action: 'REVIEW_SLOT', replay: false } });
    await flush();
    assert.deepEqual(h.results('first').map(item => item.ok), [true], 'committed receipt precedes its readback');
    const freshBinding = { ...editorBinding, draftRevision: 3, draftVersion: 3 };
    h.command('EDITOR_READ', 'queued-read', { binding: freshBinding, listingWorkflowId: 'draft-fixture' });
    await flush(); assert.equal(h.pendingEditor.length, 0);
    h.pendingStatus.shift()(staleResponse); await flush();
    assert.equal(h.pendingStatus.length, 1, kind + ': a post-commit status read replaces the old response');
    assert.equal(h.projection().busy, true);
    dispatch('second-after-stale-read'); await flush();
    assert.deepEqual(h.results('second-after-stale-read').map(item => item.ok), [false]);
    h.pendingStatus.shift()(h.statusResponse()); await flush();
    assert.equal(h.pendingBilling.length, 1);
    assert.equal(h.pendingEditor.length, 0, 'editor waits through the bound billing read');
    h.pendingBilling.shift()(h.billingResponse('APPROVED')); await flush();
    assert.equal(h.projection().busy, false, kind + ': the original mutation releases its lock after readback');
    assert.equal(h.projection().workbench.status.listing.items[0].draftVersion, 3);
    assert.equal(h.projection().billing.state, 'ready');
    assert.equal(h.pendingEditor.length, 1, 'the queued editor read resumes without another refresh');
    const read = h.pendingEditor.shift();
    assert.equal(read.request.binding.draftVersion, 3);
    read.callback({ ok: true, result: { state: 'ready', editor: { binding: freshBinding } } }); await flush();
    assert.deepEqual(h.results('queued-read').map(item => item.ok), [true]);
    assert.equal(h.runtimeRequests.filter(item => item.type.endsWith('suite-command') || item.type.endsWith('suite-assignment')).length, 1);
  }
});
