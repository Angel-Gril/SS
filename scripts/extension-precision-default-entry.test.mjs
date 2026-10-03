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

test('source product entries are bounded to the supported marketplace product paths', () => {
  for (const url of ['https://item.taobao.com/item.htm?id=123', 'https://detail.tmall.com/item.htm?id=456',
    'https://mobile.yangkeduo.com/goods.html?goods_id=789']) assert.ok(harness(url).trigger, url);
  for (const url of ['https://detail.1688.com/', 'https://detail.1688.com.evil.test/offer/123.html',
    'http://detail.1688.com/offer/123.html', 'https://item.taobao.com/item.htm']) assert.equal(harness(url).trigger, undefined, url);
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
  assert.deepEqual((await translationStatus()).data, { available: true, reasonCode: 'READY' });
  const denied = await translationStatus(value => {
    value.launch.operations.IMAGE_TRANSLATE = { enabled: false, ready: false, reasonCode: 'MEDIA_PROVIDER_NOT_ALLOWED' };
    return value;
  });
  assert.deepEqual(denied.data, { available: false, reasonCode: 'MEDIA_PROVIDER_NOT_ALLOWED' });
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
