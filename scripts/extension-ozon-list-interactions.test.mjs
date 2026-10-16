import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
const source = readFileSync('extensions/ss-erp/content/ozon-list-overlay.js', 'utf8').replace(/\r\n/gu, '\n');
const slice = (start, end) => { const a = source.indexOf(start), b = source.indexOf(end, a); assert.ok(a >= 0 && b > a); return source.slice(a, b); };

test('list initial scan creates quick actions and installs observers without retired modules', () => {
  const body = {}, calls = { quick: 0, observed: 0, safety: 0 };
  const sandbox = { document: { body }, Set, Map, isProductPage: () => true, isSsErpOwnedNode: () => false,
    ensureListSkuPageContext: () => false, rememberVisibleListSkus() {}, ensureIntersectionObserver: () => null,
    collectCardCandidates: () => new Set(), cleanupDetachedExpandedPanels() {}, ensureListQuickActions() { calls.quick++; },
    ensureListOverlayStyles() {}, hydrateProductSelectionRulesFromStorage() {}, autoSyncCurrentOzonCookieForListData() {},
    MutationObserver: class { observe() { calls.observed++; } }, handleListMutations() {}, startPeriodicSafetyScan() { calls.safety++; } };
  vm.createContext(sandbox);
  vm.runInContext(slice('  function scanRoot(', '  const pendingScanRoots')
    + slice('  function init()', '  function startPeriodicSafetyScan()'), sandbox);
  assert.doesNotThrow(() => sandbox.init());
  assert.deepEqual(calls, { quick: 1, observed: 1, safety: 1 });
});

function attached() {
  const buttons = new Map(), attrs = {}, requests = [], transitions = [];
  const node = () => ({ disabled: false, textContent: '', style: {}, listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn; }, setAttribute() {},
    click() { return this.listeners.click?.({ preventDefault() {}, stopPropagation() {} }); } });
  buttons.set('.ss-erp-expand-btn', node()); buttons.set('[data-role="collect-follow"]', node());
  const wrap = { isConnected: true, addEventListener() {}, querySelector: selector => buttons.get(selector),
    __ssErpDom: { title: 'current title' }, __ssErpPremium: { soldCount: 296 } };
  const expanded = { style: { display: 'none' }, innerHTML: '', setAttribute() {} };
  const card = { isConnected: true, getAttribute: key => attrs[key], setAttribute: (key, value) => { attrs[key] = value; }, querySelector: () => null };
  let resolveCollection;
  const sandbox = { resolveProductCardTarget: () => card, extractSku: () => '123456789', SKU_ATTR: 'sku',
    PROCESSED_ATTR: 'processed', CARD_CLASS: 'card', buildCard: () => wrap, createExpandedPortal: () => expanded,
    insertOverlay() {}, extractCardData: () => ({ title: 'original', url: 'https://www.ozon.ru/product/fixture-123456789/' }),
    selectedListFieldsNeedDetail: () => false, fetchPublicProduct: async () => ({ soldCount: 296 }), renderMetrics() {},
    getBestCachedPremium: () => ({ soldCount: 296 }), renderExpandedFields: (_sku, dom, premium) => dom.title + ':' + premium.soldCount,
    setExpandedPanelOpen: (_wrap, panel, _btn, open) => { panel.style.display = open ? 'block' : 'none'; transitions.push(open); },
    send: message => { requests.push(message); return new Promise(resolve => { resolveCollection = resolve; }); },
    Map, Set, Error, Number, String, collectionStates: new Map() };
  vm.createContext(sandbox);
  vm.runInContext(slice('  async function attachOverlay(', '  // === 扫描 + 视口加载'), sandbox);
  return { sandbox, card, wrap, expanded, buttons, requests, transitions, finish: response => resolveCollection(response) };
}

test('loaded metrics can expand, collapse, and use latest data without a new network request', async () => {
  const f = attached(); await f.sandbox.attachOverlay(f.card);
  const button = f.buttons.get('.ss-erp-expand-btn');
  assert.equal(typeof button.listeners.click, 'function');
  await button.click(); assert.equal(f.expanded.style.display, 'block');
  assert.equal(f.expanded.innerHTML, 'current title:296');
  await button.click(); assert.equal(f.expanded.style.display, 'none');
  assert.deepEqual(f.transitions, [true, false]); assert.equal(f.requests.length, 0);
});

test('list collect/follow is explicit, single-flight, and never says success for zero collected rows', async () => {
  const f = attached(); await f.sandbox.attachOverlay(f.card);
  assert.equal(f.requests.length, 0);
  const button = f.buttons.get('[data-role="collect-follow"]');
  assert.equal(typeof button.listeners.click, 'function');
  const first = button.click(); await button.click();
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].type, 'spb-self-hosted:fetch-ozon-product-to-erp');
  assert.deepEqual(Array.from(f.requests[0].productIds), ['123456789']);
  f.finish({ ok: false, msg: '请先配对' }); await first;
  assert.equal(button.disabled, false); assert.match(button.textContent, /失败/u);
  const second = button.click(); f.finish({ ok: true, data: { collected: 1, pushed: { code: 1, data: { saved: 1 } }, errors: [] } }); await second;
  assert.match(button.textContent, /已采集/u);
});

test('missing save receipt and timeout keep same-product capture locked without retry', async () => {
  for (const response of [{ ok: true, data: { collected: 1 } }, { ok: false, timedOut: true, msg: '通信超时' },
    { ok: false, transportFailed: true, msg: 'The message port closed before a response was received.' },
    { ok: true, data: { collected: 1, pushed: { code: 1, data: { saved: 0 } }, errors: [] } }]) {
    const f = attached(); await f.sandbox.attachOverlay(f.card);
    const button = f.buttons.get('[data-role="collect-follow"]'), operation = button.click();
    f.finish(response); await operation;
    assert.equal(button.disabled, true); assert.match(button.textContent, /待核对/u);
    await button.click(); assert.equal(f.requests.length, 1);
  }
});
