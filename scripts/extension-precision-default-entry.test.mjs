import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const root = 'extensions/ss-erp';
const runtimeId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
function harness(url = 'https://detail.1688.com/offer/845581683597.html', storage = {}) {
  const nodes = [];
  const listeners = new Map();
  let runtimeListener;
  let legacyClicks = 0;
  const sourceWindow = {};
  function node() {
    const handlers = new Map();
    const item = { hidden: false, style: { removeProperty() {} }, children: [],
      contentWindow: { postMessage() {} },
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
      sendMessage(_request, callback) { callback({ ok: false, error: 'LOCAL_DIAGNOSTIC_NO_DEVICE' }); } },
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
  return { environment, nodes, documentRoot, listeners, get runtimeListener() { return runtimeListener; },
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
