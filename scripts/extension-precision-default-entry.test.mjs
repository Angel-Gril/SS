import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const root = 'extensions/ss-erp';
const runtimeId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
function harness(url = 'https://detail.1688.com/offer/845581683597.html', storage = {}, respond) {
  const nodes = [];
  const runtimeRequests = [], frameMessages = [];
  const listeners = new Map();
  let runtimeListener;
  let legacyClicks = 0;
  const sourceWindow = {};
  function node() {
    const handlers = new Map();
    const item = { hidden: false, style: { removeProperty() {} }, children: [],
      contentWindow: { postMessage(message) { frameMessages.push(JSON.parse(JSON.stringify(message))); } },
      addEventListener(type, handler) { handlers.set(type, handler); },
      setAttribute() {}, appendChild(child) { this.children.push(child); },
      remove() { const index = nodes.indexOf(this); if (index >= 0) nodes.splice(index, 1); },
      click() { handlers.get('click')?.({ target: this }); } };
    nodes.push(item);
    return item;
  }
  const legacy = node(); legacy.id = 'ss-erp-source-media-fab'; legacy.click = () => { legacyClicks += 1; };
  const documentRoot = node(); documentRoot.style.overflow = 'auto';
  const timers = new Map();
  let timerId = 0;
  const environment = {
    URL, console,
    location: { href: url, hostname: new URL(url).hostname },
    document: { documentElement: documentRoot, createElement: node,
      getElementById(id) { return nodes.find(item => item.id === id); },
      addEventListener() {}, dispatchEvent() {} },
    chrome: { runtime: { id: runtimeId,
      getURL(path) { return `chrome-extension://${runtimeId}/${path.replace(/^\//u, '')}`; },
      getManifest() { return { version: '1.0.401' }; },
      onMessage: { addListener(handler) { runtimeListener = handler; } },
      sendMessage(request, callback) {
        runtimeRequests.push(request);
        if (respond) respond(request, callback);
        else callback({ ok: false, error: 'LOCAL_DIAGNOSTIC_NO_DEVICE' });
      } },
      storage: { local: { get(_keys, callback) { callback(storage); } }, onChanged: { addListener() {} } } },
    addEventListener(type, handler) { listeners.set(type, handler); },
    setTimeout(handler) { const id = ++timerId; timers.set(id, handler); return id; },
    clearTimeout(id) { timers.delete(id); },
    SS_ERP_DONOR_1688_CAPTURE: { async collect() { return { productId: '845581683597', title: '测试商品' }; } },
    window: sourceWindow,
  };
  environment.globalThis = environment;
  const context = vm.createContext(environment);
  vm.runInContext(readFileSync(`${root}/shared/donor-workbench/workspace-contract.js`, 'utf8'), context);
  vm.runInContext(readFileSync(`${root}/content/donor-workbench-bridge.js`, 'utf8'), context);
  return { environment, nodes, documentRoot, listeners, runtimeRequests, frameMessages, get runtimeListener() { return runtimeListener; },
    get legacyClicks() { return legacyClicks; }, get trigger() { return nodes.find(item => item.id === 'ss-erp-donor-workbench-trigger'); },
    get frame() { return nodes.find(item => item.id === 'ss-erp-donor-workbench-frame'); } };
}

test('fresh installs and retired preview settings open only the precision workbench', () => {
  for (const storage of [{}, {
    'ss-erp:donor-workbench-preview-enabled': false,
    'ss-erp:precision-workbench-preview-enabled': false,
    'ss-erp:donor-workbench-preview-allowlist:v1': [],
  }]) {
    const state = harness(undefined, storage);
    assert.ok(state.trigger);
    state.trigger.click();
    assert.equal(state.frame.src, `chrome-extension://${runtimeId}/pages/precision-workbench.html`);
    assert.equal(state.frame.hidden, false);
    assert.equal(state.legacyClicks, 0);
  }
});

test('opening and closing the precision workbench preserves marketplace scrolling', () => {
  const state = harness();
  state.documentRoot.style.overflow = 'auto';
  state.trigger.click();
  assert.equal(state.frame.hidden, false);
  assert.equal(state.documentRoot.style.overflow, 'auto');
  state.listeners.get('message')({ source: state.frame.contentWindow,
    origin: new URL(state.frame.src).origin,
    data: { contractVersion: 'ss-erp-donor-workbench/v1', type: 'CLOSE', requestId: 'close-scroll-test' } });
  assert.equal(state.frame.hidden, true);
  assert.equal(state.documentRoot.style.overflow, 'auto');
});

test('source product entries are bounded to the supported marketplace product paths', () => {
  for (const url of ['https://item.taobao.com/item.htm?id=123', 'https://detail.tmall.com/item.htm?id=456',
    'https://mobile.yangkeduo.com/goods.html?goods_id=789']) assert.ok(harness(url).trigger, url);
  for (const url of ['https://detail.1688.com/', 'https://detail.1688.com.evil.test/offer/123.html',
    'http://detail.1688.com/offer/123.html', 'https://item.taobao.com/item.htm']) assert.equal(harness(url).trigger, undefined, url);
});

test('only the installed popup opens the same-page workbench and receives a visible-frame acknowledgement', () => {
  const state = harness();
  let result;
  state.runtimeListener({ type: 'ss-erp:precision-workbench-open' },
    { id: runtimeId, url: `chrome-extension://${runtimeId}/pages/popup.html` }, value => { result = value; });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { ok: true, state: 'WORKBENCH_OPENED' });
  assert.equal(state.frame.hidden, false);
  assert.equal(state.legacyClicks, 0);
  const readCount = state.runtimeRequests.length;
  state.runtimeListener({ type: 'ss-erp:precision-workbench-open' },
    { id: runtimeId, url: `chrome-extension://${runtimeId}/pages/popup.html` }, value => { result = value; });
  assert.equal(result.ok, true);
  assert.equal(state.runtimeRequests.length, readCount, 'opening an already visible workbench preserves the current editing context');
});

test('same-page popup entry rejects foreign senders, content-script senders and caller payloads', () => {
  for (const [message, sender] of [
    [{ type: 'ss-erp:precision-workbench-open' }, { id: 'foreign', url: `chrome-extension://${runtimeId}/pages/popup.html` }],
    [{ type: 'ss-erp:precision-workbench-open' }, { id: runtimeId, url: 'https://detail.1688.com/offer/845581683597.html', tab: { id: 7 } }],
    [{ type: 'ss-erp:precision-workbench-open', url: 'https://app.ss-erp.com' }, { id: runtimeId, url: `chrome-extension://${runtimeId}/pages/popup.html` }],
  ]) {
    const state = harness(); let result;
    state.runtimeListener(message, sender, value => { result = value; });
    assert.equal(result?.ok, false);
    assert.equal(state.frame.hidden, true);
  }
});

async function translationStatus(responseTransform = value => value, exercise) {
  const handoff = { snapshotId: 'snapshot-fixture', supplyGoodsId: 'goods-fixture', sourceProductId: '845581683597', platform: '1688' };
  const listing = { id: 'draft-fixture', shopId: 'doth', stage: 'MEDIA_REVIEW', status: 'ACTIVE', runState: 'ACTIVE',
    revision: 1, draftVersion: 1, selectedSkuCount: 1, mediaAssignmentCount: 0, blockerCount: 0, warningCount: 0,
    blockers: [], warnings: [], updatedAt: '2026-10-03T00:00:00.000Z' };
  const context = { snapshotId: handoff.snapshotId, supplyGoodsId: handoff.supplyGoodsId,
    shopId: listing.shopId, id: listing.id, revision: 1, draftVersion: 1 };
  const status = { ok: true, handoff, result: { state: 'ready', status: { snapshot: { current: true },
    listing: { items: [listing], truncated: false }, media: { items: [], actionableCount: 0 } } },
    launch: { state: 'ready', context, operations: { IMAGE_TRANSLATE: { enabled: true, ready: true, reasonCode: 'READY' } } } };
  const h = harness(undefined, {}, (request, callback) => {
    if (request.type === 'spb-self-hosted:get-ozon-shops') callback({ ok: true, data: [{ id: 'doth', name: 'DOTH', status: 'ACTIVE' }] });
    else if (request.type === 'ss-erp:source-listing-workbench-status') callback(request.listingWorkflowId ? responseTransform(structuredClone(status)) : structuredClone(status));
    else callback({ ok: false });
  });
  h.environment.SS_ERP_DONOR_1688_CAPTURE.collect = async () => ({ productId: handoff.sourceProductId, title: '测试商品',
    captureV2: { media: [{ key: 'image-1', role: 'product_main', disposition: 'accepted', url: 'https://img.fixture.invalid/1.png' },
      { key: 'image-7', role: 'product_detail', disposition: 'accepted', url: 'https://img.fixture.invalid/7.png' }] } });
  h.trigger.click();
  await new Promise(resolve => setImmediate(resolve));
  const projection = h.frameMessages.filter(item => item.type === 'PROJECTION').at(-1)?.projection;
  assert.equal(projection?.busy, false, 'the existing owner status finishes before the scoped read');
  assert.equal(projection.workbench.status.listing.items[0]?.id, listing.id);
  if (exercise) return exercise(h);
  h.listeners.get('message')({ source: h.frame.contentWindow, origin: new URL(h.frame.src).origin,
    data: { contractVersion: 'ss-erp-donor-workbench/v1', type: 'CHECK_TRANSLATION', requestId: 'translation-read', listingWorkflowId: listing.id } });
  await new Promise(resolve => setImmediate(resolve));
  const result = h.frameMessages.find(item => item.type === 'COMMAND_RESULT' && item.requestId === 'translation-read');
  assert.ok(result);
  assert.equal(h.runtimeRequests.every(request => ['spb-self-hosted:get-ozon-shops', 'ss-erp:source-listing-workbench-status'].includes(request.type)), true,
    'availability checks never create images, suites or launch mutations');
  return result;
}

test('translation availability reads the selected draft and preserves a disabled Provider reason', async () => {
  assert.deepEqual((await translationStatus()).data, { available: true, testOnly: false, reasonCode: 'READY' });
  const denied = await translationStatus(value => {
    value.launch.operations.IMAGE_TRANSLATE = { enabled: false, ready: false, reasonCode: 'MEDIA_PROVIDER_NOT_ALLOWED' };
    return value;
  });
  assert.deepEqual(denied.data, { available: false, testOnly: false, reasonCode: 'MEDIA_PROVIDER_NOT_ALLOWED' });
});

test('translation availability rejects another source snapshot or changed draft revisions', async () => {
  for (const transform of [value => { value.handoff.snapshotId = 'foreign-snapshot'; return value; },
    value => { value.result.status.listing.items[0].revision++; return value; },
    value => { value.launch.context.shopId = 'foreign-shop'; return value; }]) {
    assert.equal((await translationStatus(transform)).ok, false);
  }
});

test('translation capability without a usable launch context is unavailable', async () => {
  const result = await translationStatus(value => { value.launch.state = 'not_ready'; value.launch.context = null; return value; });
  assert.equal(result.data?.available, false);
});

function erpEntryFixture({ changedRevision = false } = {}) {
  const context = { contractVersion: 'extension-byok-workbench-launch-context/v1', sourcePlatform: '1688',
    sourceProductId: '845581683597', sourceCaptureSnapshotId: 'snapshot-erp', supplyGoodsId: 'goods-erp', shopId: 'doth',
    workflowId: 'draft-erp', draftRevision: 3, draftVersion: 2, skuKey: 'sku-1', slotKey: 'sku:sku-1:hero', assignmentMode: 'APPEND', assignmentOrdinal: 0 };
  const handoff = { snapshotId: context.sourceCaptureSnapshotId, supplyGoodsId: context.supplyGoodsId,
    sourceProductId: context.sourceProductId, platform: context.sourcePlatform };
  const listings = ['first-same-shop', context.workflowId].map(id => ({ id, shopId: 'doth',
    revision: context.draftRevision + (changedRevision ? 1 : 0), draftVersion: context.draftVersion, stage: 'MEDIA_REVIEW',
    runState: 'ACTIVE', selectedSkuCount: 1, mediaAssignmentCount: 0 }));
  const state = harness(undefined, {}, (request, callback) => {
    if (request.type === 'ss-erp:precision-erp-launch-claim') callback({ ok: true, result: { context, handoff } });
    else if (request.type === 'spb-self-hosted:get-ozon-shops') callback({ ok: true, data: [{ id: 'doth', name: 'DOTH' }] });
    else if (request.type === 'ss-erp:source-listing-workbench-status') callback({ ok: true, handoff,
      result: { state: 'ready', status: { snapshot: { current: true }, listing: { items: listings }, media: { items: [] } } } });
    else callback({ ok: false });
  });
  state.environment.SS_ERP_DONOR_1688_CAPTURE.collect = async () => ({ productId: context.sourceProductId,
    captureV2: { skus: [{ key: 'sku-1', sourceSkuId: 'sku-1' }], media: [] } });
  return { ...state, context };
}
// Chrome tabs.sendMessage from the Worker carries extension sender identity,
// not the tab/document/frame of its receiving content script.
const workerSender = { id: runtimeId, url: `chrome-extension://${runtimeId}/background/service-worker.js` };
const erpOpen = { type: 'ss-erp:precision-erp-workbench-open', nonce: 'a'.repeat(48) };

test('ERP entry waits for the actual precision frame to confirm the exact draft before reporting opened', async () => {
  const state = erpEntryFixture(); let response;
  assert.equal(state.runtimeListener(erpOpen, workerSender, value => { response = value; }), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(response, undefined, 'an iframe element is not an opened-and-bound acknowledgement');
  assert.equal(state.frame.hidden, false);
  const entry = state.frameMessages.filter(item => item.type === 'PROJECTION').at(-1).entryContext;
  assert.equal(entry.context.workflowId, state.context.workflowId);
  state.listeners.get('message')({ source: state.frame.contentWindow, origin: new URL(state.frame.src).origin,
    data: { contractVersion: 'ss-erp-donor-workbench/v1', type: 'ENTRY_ACCEPTED', requestId: 'entry-ack',
      entryRequestId: entry.requestId, workflowId: state.context.workflowId, draftRevision: 3, draftVersion: 2, accepted: true } });
  assert.deepEqual(JSON.parse(JSON.stringify(response)), { ok: true, state: 'WORKBENCH_OPENED', workflowId: 'draft-erp', draftRevision: 3, draftVersion: 2 });
  const mutations = state.runtimeRequests.filter(item => !['ss-erp:precision-erp-launch-claim', 'spb-self-hosted:get-ozon-shops', 'ss-erp:source-listing-workbench-status'].includes(item.type));
  assert.equal(mutations.length, 0);
  state.listeners.get('message')({ source: state.frame.contentWindow, origin: new URL(state.frame.src).origin,
    data: { contractVersion: 'ss-erp-donor-workbench/v1', type: 'READY', requestId: 'iframe-reload' } });
  assert.equal(state.frameMessages.filter(item => item.type === 'PROJECTION').at(-1).entryContext.context.workflowId, 'draft-erp');
});

test('ERP entry rejects spoofed page/popup messages before claiming a launch', () => {
  for (const sender of [{ ...workerSender, id: 'other' }, { ...workerSender, tab: { id: 3 } },
    { ...workerSender, url: `chrome-extension://${runtimeId}/pages/popup.html` }]) {
    const state = erpEntryFixture(); let response;
    state.runtimeListener(erpOpen, sender, value => { response = value; });
    assert.equal(response?.ok, false);
    assert.equal(state.runtimeRequests.length, 0);
    assert.equal(state.frame.hidden, true);
  }
});

test('ERP entry rejects a changed draft projection and never shows a different same-shop draft', async () => {
  const state = erpEntryFixture({ changedRevision: true }); let response;
  state.runtimeListener(erpOpen, workerSender, value => { response = value; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(response?.ok, false);
  assert.equal(state.frame.hidden, true);
});

test('a frame declining to replace unsaved edits is not reported as opened', async () => {
  const state = erpEntryFixture(); let response;
  state.runtimeListener(erpOpen, workerSender, value => { response = value; });
  await new Promise(resolve => setImmediate(resolve));
  const entry = state.frameMessages.filter(item => item.type === 'PROJECTION').at(-1).entryContext;
  state.listeners.get('message')({ source: state.frame.contentWindow, origin: new URL(state.frame.src).origin,
    data: { contractVersion: 'ss-erp-donor-workbench/v1', type: 'ENTRY_ACCEPTED', requestId: 'entry-declined',
      entryRequestId: entry.requestId, workflowId: state.context.workflowId, draftRevision: 3, draftVersion: 2, accepted: false } });
  assert.equal(response?.ok, false);
});

test('an id-only native Worker sender is accepted while content-script sender fields are refused', async () => {
  const state = erpEntryFixture(); let result;
  assert.equal(state.runtimeListener(erpOpen, { id: runtimeId }, value => { result = value; }), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(result, undefined);
  assert.equal(state.frame.hidden, false);
  for (const extra of [{ frameId: 1 }, { documentId: 'source-document' },
    { tab: { id: 7, url: 'https://detail.1688.com/offer/845581683597.html' } }, { origin: 'https://detail.1688.com' }]) {
    const denied = erpEntryFixture(); let response;
    denied.runtimeListener(erpOpen, { ...workerSender, ...extra }, value => { response = value; });
    assert.equal(response?.ok, false); assert.equal(denied.runtimeRequests.length, 0);
  }
});
