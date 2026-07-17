import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pdd = require('../extensions/ss-erp/shared/collectors/pdd-network-normalizer.js');
const taobao = require('../extensions/ss-erp/shared/collectors/taobao-network-normalizer.js');
const manifest = JSON.parse(fs.readFileSync('extensions/ss-erp/manifest.json', 'utf8'));
const hookSource = fs.readFileSync('extensions/ss-erp/content/source-network-page-hook.js', 'utf8');
const bridgeSource = fs.readFileSync('extensions/ss-erp/content/source-network-bridge.js', 'utf8');
const collectSource = fs.readFileSync('extensions/ss-erp/content/collect-content-script.js', 'utf8');

function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

function loadHook(url) {
  function Xhr() {}
  Xhr.prototype.open = function () {};
  Xhr.prototype.send = function () {};
  Xhr.prototype.addEventListener = function () {};
  const location = new URL(url);
  const listeners = new Map();
  const originalFetch = function () { return Promise.resolve({}); };
  const originalOpen = Xhr.prototype.open;
  const context = {
    URL, TextEncoder, TextDecoder, Date, Number, JSON, Promise,
    setTimeout, clearTimeout, location, top: null, window: null, document: {},
    fetch: originalFetch, XMLHttpRequest: Xhr,
    addEventListener(type, listener) { listeners.set(type, listener); },
    postMessage() {}, globalThis: null,
  };
  context.top = context;
  context.window = context;
  context.globalThis = context;
  const sandbox = vm.createContext(context);
  vm.runInContext(hookSource, sandbox);
  return {
    api: context.SS_ERP_SOURCE_NETWORK_PAGE_HOOK,
    context,
    originalFetch,
    originalOpen,
    dispatchInit(data) {
      context.__initEvent = { origin: context.location.origin, data };
      const listener = listeners.get('message');
      context.__listener = listener;
      vm.runInContext('__initEvent.source = globalThis; __listener(__initEvent);', sandbox);
      delete context.__listener;
      delete context.__initEvent;
    },
  };
}

function validPddBody() {
  return {
    result: {
      goods_id: '730012340001', goods_name: 'Cup',
      goods_image_url: 'https://img.example/main.jpg',
      skus: [{ sku_id: 's1', price_fen: 2599, specs: [{ name: 'Color', value: 'Black' }] }],
    },
  };
}

function policy(now) {
  return {
    kind: 'ss-erp-source-network-policy', source: 'erp', enabled: true, revision: 1,
    platforms: ['pdd', 'taobao'], signature: 'v'.repeat(32),
    issuedAt: new Date(now - 1000).toISOString(),
    expiresAt: new Date(now + 60 * 60 * 1000).toISOString(),
  };
}

async function loadBridge(url, options = {}) {
  let now = options.now || Date.now();
  const listeners = new Map();
  const posted = [];
  const storageListeners = [];
  const context = {
    URL, TextEncoder, Date, Number, JSON, Promise, Uint8Array,
    location: new URL(url), top: null, window: null, document: {}, globalThis: null,
    SS_ERP_PDD_NETWORK_NORMALIZER: pdd,
    SS_ERP_TAOBAO_NETWORK_NORMALIZER: taobao,
    SS_ERP_SOURCE_NETWORK_NOW: () => now,
    SS_ERP_VERIFY_SOURCE_NETWORK_POLICY: options.verify,
    crypto: { getRandomValues(bytes) { bytes.fill(7); return bytes; } },
    addEventListener(type, listener) { listeners.set(type, listener); },
    postMessage(message) { posted.push(message); },
    chrome: {
      storage: {
        local: {
          get(_keys, callback) {
            callback({
              feature_source_network_capture: options.localEnabled === true,
              source_network_capture_policy: options.policy,
            });
          },
        },
        onChanged: { addListener(listener) { storageListeners.push(listener); } },
      },
    },
  };
  context.history = {
    pushState(_state, _title, next) { context.location = new URL(next, context.location.href); },
    replaceState(_state, _title, next) { context.location = new URL(next, context.location.href); },
  };
  context.top = context;
  context.window = context;
  context.globalThis = context;
  const sandbox = vm.createContext(context);
  vm.runInContext(bridgeSource, sandbox);
  await settle();
  return {
    context,
    bridge: context.SS_ERP_SOURCE_NETWORK_BRIDGE,
    posted,
    listeners,
    advance(ms) { now += ms; },
    currentTime() { return now; },
    dispatch(event) {
      context.__networkEvent = event;
      vm.runInContext(
        '__networkEvent.source = globalThis; SS_ERP_SOURCE_NETWORK_BRIDGE.onMessage(__networkEvent);',
        sandbox,
      );
      delete context.__networkEvent;
    },
    async changePolicy(nextPolicy) {
      for (const listener of storageListeners) {
        listener({ source_network_capture_policy: { newValue: nextPolicy } }, 'local');
      }
      await settle();
    },
  };
}

const pddRuntime = loadHook('https://mobile.yangkeduo.com/goods.html?goods_id=730012340001');
const pddHook = pddRuntime.api;
assert.equal(pddRuntime.context.fetch, pddRuntime.originalFetch);
assert.equal(pddRuntime.context.XMLHttpRequest.prototype.open, pddRuntime.originalOpen);
assert.equal(pddHook.canonicalPage().productId, '730012340001');
assert.ok(pddHook.matchRequest('https://api.pinduoduo.com/api/goods/detail?token=drop-me', 'POST'));
assert.ok(pddHook.matchRequest(new URL('https://api.pinduoduo.com/api/goods/detail'), 'GET'));
assert.equal(pddHook.matchRequest('https://api.pinduoduo.com/api/goods/detail/extra', 'POST'), null);
assert.equal(pddHook.matchRequest('http://api.pinduoduo.com/api/goods/detail', 'POST'), null);
assert.equal(pddHook.matchRequest('https://api.pinduoduo.com/api/goods/detail', 'DELETE'), null);
assert.equal(pddHook.matchRequest('https://api.pinduoduo.com:444/api/goods/detail', 'GET'), null);
const pddRule = pddHook.matchRequest('https://api.pinduoduo.com/api/goods/detail', 'POST');
assert.equal(pddHook.responseMatchesRule(pddRule, 'https://api.pinduoduo.com/api/goods/detail?ok=1'), true);
assert.equal(pddHook.responseMatchesRule(pddRule, 'https://redirect.example/api/goods/detail'), false);
let declaredLengthCancelCount = 0;
assert.equal(await pddHook.readBoundedText({
  headers: { get: () => String(pddHook.constants.MAX_RAW_BYTES + 1) },
  body: { cancel: async () => { declaredLengthCancelCount += 1; } },
}, pddHook.constants.MAX_RAW_BYTES), null);
assert.equal(declaredLengthCancelCount, 1);
let streamedCancelCount = 0;
let streamedReadCount = 0;
assert.equal(await pddHook.readBoundedText({
  headers: { get: () => '' },
  body: {
    getReader() {
      return {
        async read() {
          streamedReadCount += 1;
          return streamedReadCount === 1
            ? { done: false, value: new Uint8Array(pddHook.constants.MAX_RAW_BYTES + 1) }
            : { done: true };
        },
        async cancel() { streamedCancelCount += 1; },
      };
    },
  },
}, pddHook.constants.MAX_RAW_BYTES), null);
assert.equal(streamedCancelCount, 1);
let fallbackTextCalled = false;
assert.equal(await pddHook.readBoundedText({
  headers: { get: () => '' },
  body: {},
  async text() { fallbackTextCalled = true; return 'must-not-read'; },
}, pddHook.constants.MAX_RAW_BYTES), null);
assert.equal(fallbackTextCalled, false);
pddRuntime.dispatchInit({
  source: 'ss-erp-source-network-bridge', type: 'SS_ERP_SOURCE_NETWORK_INIT',
  nonce: 'a'.repeat(32), generation: 1,
  generationKey: 'mobile.yangkeduo.com/goods.html:730012340001',
  productId: '730012340001', platform: 'pdd',
});
assert.notEqual(pddRuntime.context.fetch, pddRuntime.originalFetch);
assert.notEqual(pddRuntime.context.XMLHttpRequest.prototype.open, pddRuntime.originalOpen);
const projectedPdd = pddHook.project({ platform: 'pdd' }, {
  ...validPddBody(), authorization: 'must-not-pass', headers: { cookie: 'drop' },
});
assert.equal(projectedPdd.authorization, undefined);
assert.equal(projectedPdd.result.goods_image_url, 'https://img.example/main.jpg');
assert.equal(pdd.normalize({ signature: 'pdd.mobile.goods.detail.v2', body: projectedPdd }, '730012340001').accepted, true);
assert.equal(pdd.normalize({ signature: 'unknown', body: projectedPdd }, '730012340001').reason, 'signature_not_allowed');
assert.equal(pdd.normalize({ signature: 'pdd.mobile.goods.detail.v2', body: projectedPdd }, 'other').reason, 'identity_mismatch');
const pddMissingTitle = structuredClone(projectedPdd);
pddMissingTitle.result.goods_name = '';
assert.equal(pdd.normalize({ signature: 'pdd.mobile.goods.detail.v2', body: pddMissingTitle }, '730012340001').reason, 'missing_title');
const pddMissingImage = structuredClone(projectedPdd);
pddMissingImage.result.goods_image_url = '';
assert.equal(pdd.normalize({ signature: 'pdd.mobile.goods.detail.v2', body: pddMissingImage }, '730012340001').reason, 'missing_main_image');

const taobaoHook = loadHook('https://item.taobao.com/item.htm?id=860012340001').api;
const projectedTaobao = taobaoHook.project({ platform: 'taobao' }, {
  data: {
    item: { itemId: '860012340001', title: 'Box', images: ['https://img.example/a.jpg?q=drop'] },
    skuBase: {
      props: [{ pid: '1627207', propName: '颜色', values: [{ vid: '28341', name: '绿色' }] }],
      skus: [{ skuId: 't1', propPath: '1627207:28341' }],
    },
    skuCore: { sku2info: { t1: { price: { priceText: '12.80' }, account_id: 'drop' } } },
  },
  headers: { authorization: 'drop' },
});
assert.equal(projectedTaobao.item.images[0], 'https://img.example/a.jpg');
assert.equal(projectedTaobao.skuBase.props[0].values[0].name, '绿色');
const normalizedTaobao = taobao.normalize(
  { signature: 'mtop.taobao.detail.getdetail.v7', body: projectedTaobao },
  '860012340001',
);
assert.equal(normalizedTaobao.accepted, true);
assert.equal(normalizedTaobao.source.value.skuBase.props[0].propName, '颜色');
const taobaoMissingImage = structuredClone(projectedTaobao);
taobaoMissingImage.item.images = [];
assert.equal(taobao.normalize(
  { signature: 'mtop.taobao.detail.getdetail.v7', body: taobaoMissingImage },
  '860012340001',
).reason, 'missing_main_image');

const localOnly = await loadBridge(
  'https://mobile.yangkeduo.com/goods.html?goods_id=730012340001',
  { localEnabled: true },
);
assert.equal(localOnly.bridge.snapshot().enabled, false);
assert.equal(localOnly.posted.length, 0);
assert.ok(localOnly.bridge.snapshot().degradations.some((entry) => entry.reason === 'local_boolean_ignored'));

const unsignedRuntime = await loadBridge(
  'https://mobile.yangkeduo.com/goods.html?goods_id=730012340001',
  { policy: policy(Date.now()) },
);
assert.equal(unsignedRuntime.bridge.snapshot().enabled, false);
assert.ok(unsignedRuntime.bridge.snapshot().degradations.some(
  (entry) => entry.reason === 'trusted_policy_verifier_unavailable',
));

const malformedPolicy = policy(Date.now());
malformedPolicy.signature = 'short';
const malformedRuntime = await loadBridge(
  'https://mobile.yangkeduo.com/goods.html?goods_id=730012340001',
  { policy: malformedPolicy, verify: async () => true },
);
assert.equal(malformedRuntime.bridge.snapshot().enabled, false);
assert.ok(malformedRuntime.bridge.snapshot().degradations.some((entry) => entry.reason === 'policy_unsigned'));

const runtime = await loadBridge(
  'https://mobile.yangkeduo.com/goods.html?goods_id=730012340001',
  { policy: policy(Date.now()), verify: async () => true },
);
let snapshot = runtime.bridge.snapshot();
assert.equal(snapshot.enabled, true);
const init = runtime.posted.find((message) => message.type === 'SS_ERP_SOURCE_NETWORK_INIT');
assert.ok(init && init.source === 'ss-erp-source-network-bridge');

function candidateEvent(candidate, sequence, observedAt = runtime.currentTime()) {
  return {
    source: runtime.context,
    origin: runtime.context.location.origin,
    data: {
      source: 'ss-erp-source-network-page', type: 'SS_ERP_SOURCE_NETWORK_CANDIDATE',
      nonce: init.nonce, generation: init.generation, productId: '730012340001', platform: 'pdd',
      sequence, observedAt,
      candidate,
    },
  };
}
const invalidUrlCandidate = {
  signature: 'pdd.mobile.goods.detail.v2', method: 'POST', url: 'api.pinduoduo.com/api/other',
  body: projectedPdd, bytes: new TextEncoder().encode(JSON.stringify(projectedPdd)).length,
};
runtime.dispatch(candidateEvent(invalidUrlCandidate, 1));
assert.equal(runtime.bridge.snapshot().candidates.length, 0);

runtime.dispatch(candidateEvent({
  ...invalidUrlCandidate,
  method: 'DELETE',
  url: 'api.pinduoduo.com/api/goods/detail',
}, 1));
assert.equal(runtime.bridge.snapshot().candidates.length, 0);

const staleEvent = candidateEvent({
  signature: 'pdd.mobile.goods.detail.v2', method: 'POST', url: 'api.pinduoduo.com/api/goods/detail',
  body: projectedPdd, bytes: new TextEncoder().encode(JSON.stringify(projectedPdd)).length,
}, 1);
staleEvent.data.generation -= 1;
runtime.dispatch(staleEvent);
assert.equal(runtime.bridge.snapshot().candidates.length, 0);
assert.ok(runtime.bridge.snapshot().degradations.some((entry) => entry.reason === 'stale_or_forged_channel'));

runtime.dispatch(candidateEvent(validCandidateForSequence(projectedPdd), 2));
assert.equal(runtime.bridge.snapshot().candidates.length, 0);

runtime.dispatch(candidateEvent(validCandidateForSequence(projectedPdd), 1, runtime.currentTime() + 1));
assert.equal(runtime.bridge.snapshot().candidates.length, 0);

const oversizedBody = { ...projectedPdd, padding: 'x'.repeat(70000) };
runtime.dispatch(candidateEvent({
  signature: 'pdd.mobile.goods.detail.v2', method: 'POST', url: 'api.pinduoduo.com/api/goods/detail',
  body: oversizedBody, bytes: new TextEncoder().encode(JSON.stringify(oversizedBody)).length,
}, 1));
assert.equal(runtime.bridge.snapshot().candidates.length, 0);

function validCandidateForSequence(body) {
  return {
    signature: 'pdd.mobile.goods.detail.v2', method: 'POST', url: 'api.pinduoduo.com/api/goods/detail',
    body, bytes: new TextEncoder().encode(JSON.stringify(body)).length,
  };
}
const validCandidate = {
  signature: 'pdd.mobile.goods.detail.v2', method: 'POST', url: 'api.pinduoduo.com/api/goods/detail',
  body: projectedPdd, bytes: new TextEncoder().encode(JSON.stringify(projectedPdd)).length,
};
runtime.dispatch(candidateEvent(validCandidate, 1));
snapshot = runtime.bridge.snapshot();
assert.equal(snapshot.candidates.length, 1, JSON.stringify(snapshot.degradations));
assert.equal(snapshot.candidates[0].source.sourceType, 'page_observed_network');
assert.equal(snapshot.candidates[0].source.trust, 'untrusted');
runtime.dispatch(candidateEvent(validCandidate, 3));
assert.equal(runtime.bridge.snapshot().candidates.length, 1);

runtime.advance(runtime.bridge.constants.TTL_MS + 1);
snapshot = runtime.bridge.snapshot();
assert.equal(snapshot.candidates.length, 0);
assert.ok(snapshot.degradations.some((entry) => entry.reason === 'candidate_expired'));

runtime.context.history.pushState({}, '', '/goods.html?goods_id=730012340002');
await settle();
snapshot = runtime.bridge.snapshot();
assert.equal(snapshot.productId, '730012340002');
assert.equal(snapshot.candidates.length, 0);
assert.ok(snapshot.generation > init.generation);

const directSpa = await loadBridge(
  'https://mobile.yangkeduo.com/goods.html?goods_id=730012340001',
  { policy: policy(Date.now()), verify: async () => true },
);
directSpa.context.location = new URL('https://mobile.yangkeduo.com/goods.html?goods_id=730012340009');
snapshot = directSpa.bridge.snapshot();
assert.equal(snapshot.enabled, false);
assert.equal(snapshot.productId, '730012340009');
assert.ok(snapshot.degradations.some((entry) => entry.reason === 'page_identity_changed'));

const expiryNow = Date.now();
const expiringPolicy = policy(expiryNow);
expiringPolicy.expiresAt = new Date(expiryNow + 100).toISOString();
const expiring = await loadBridge(
  'https://mobile.yangkeduo.com/goods.html?goods_id=730012340001',
  { now: expiryNow, policy: expiringPolicy, verify: async () => true },
);
expiring.advance(101);
snapshot = expiring.bridge.snapshot();
assert.equal(snapshot.enabled, false);
assert.ok(snapshot.degradations.some((entry) => entry.reason === 'policy_expired'));

await runtime.changePolicy(null);
snapshot = runtime.bridge.snapshot();
assert.equal(snapshot.enabled, false);
assert.ok(snapshot.degradations.some((entry) => entry.reason === 'policy_missing'));

const mainEntry = manifest.content_scripts.find(
  (entry) => entry.world === 'MAIN' && entry.js.includes('content/source-network-page-hook.js'),
);
const isolatedEntry = manifest.content_scripts.find((entry) => entry.js.includes('content/source-network-bridge.js'));
assert.equal(mainEntry, undefined, 'untrusted MAIN hook must not be statically injected');
assert.doesNotMatch(
  bridgeSource,
  /source-network-page-hook|executeScript|registerContentScripts/,
  'local state or page messages must not dynamically install the MAIN hook',
);
assert.ok(isolatedEntry && isolatedEntry.run_at === 'document_start' && !isolatedEntry.world);
assert.ok(isolatedEntry.js.indexOf('shared/collectors/pdd-network-normalizer.js') < isolatedEntry.js.indexOf('content/source-network-bridge.js'));
assert.doesNotMatch(manifest.permissions.join(' '), /debugger/);
assert.match(hookSource, /body\.getReader/);
assert.match(hookSource, /reader\.cancel/);
assert.doesNotMatch(hookSource, /response\.text\(\)/);
assert.match(hookSource, /utf8ByteLength/);
assert.match(bridgeSource, /local_boolean_ignored/);
assert.match(bridgeSource, /trusted_policy_verifier_unavailable/);
assert.match(collectSource, /pickBoundProductId/);
assert.match(collectSource, /networkSnapshotMatchesSource/);
assert.match(collectSource, /buildNetworkCaptureDiagnostic/);
assert.match(collectSource, /networkCapture:/);
assert.doesNotMatch(collectSource, /allSources\.unshift\(entry\.source\.value\)/);

console.log('PASS extension source network capture contract');
