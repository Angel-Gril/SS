import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const path = 'extensions/ss-erp/shared/donor-workbench/workspace-contract.js';
const sandbox = { URL, URLSearchParams, Map, Set, Date, Object, Array, Number, String };
sandbox.globalThis = sandbox;
vm.runInNewContext(fs.readFileSync(path, 'utf8'), sandbox);
const contract = sandbox.SS_ERP_DONOR_WORKBENCH_CONTRACT;
const sourceUrl = 'https://cbu01.alicdn.com/source.jpg';
const displayUrl = 'https://cdn.example/raw/source.jpg';
const product = { title: 'Sanitized product', captureV2: { sourceIdentity: { productId: '1001' },
  skus: [{ key: 'sku-1', mediaKeys: ['media-1'] }],
  media: [{ key: 'media-1', kind: 'image', role: 'sku', disposition: 'accepted', url: sourceUrl, skuKeys: ['sku-1'] }] } };
const handoff = { snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1', platform: '1688', sourceProductId: '1001' };
function project(overrides = {}) {
  return contract.createProjection({ platform: '1688', product, handoff,
    workbench: { state: 'ready', status: { snapshot: { current: true, id: 'snapshot-1', captureHash: 'a'.repeat(64) }, sourceMedia: {
      snapshotId: 'snapshot-1', captureHash: 'a'.repeat(64), items: [{ key: 'media-1', sourceUrl, displayUrl }],
      transferStatus: 'COMPLETE',
      ...overrides } } } });
}

test('stored display URLs survive iframe parsing and preserve capture URL/key authority', () => {
  const before = JSON.stringify(product);
  const result = project();
  assert.equal(result.media[0].url, sourceUrl);
  assert.equal(result.media[0].key, 'media-1');
  assert.equal(result.media[0].displayUrl, displayUrl);
  assert.equal(result.skus[0].imageUrl, displayUrl);
  assert.equal(result.skus[0].imageCrossOrigin, 'anonymous');
  assert.equal(contract.parseProjection(result).media[0].displayUrl, displayUrl);
  assert.equal(contract.parseProjection(result).skus[0].imageCrossOrigin, 'anonymous');
  assert.equal(JSON.stringify(product), before);
});

test('different snapshots, URLs and unsafe display URLs cannot override source media', () => {
  for (const overrides of [ { snapshotId: 'other' }, { captureHash: 'invalid' },
    { items: [{ key: 'media-1', sourceUrl: 'https://cbu01.alicdn.com/other.jpg', displayUrl }] },
    { items: [{ key: 'media-1', sourceUrl, displayUrl: 'https://127.0.0.1/source.jpg' }] } ]) {
    assert.equal(project(overrides).media[0].displayUrl, undefined);
  }
});

test('device status parser accepts the display contract and rejects stale or unsafe mapping', async () => {
  vm.runInNewContext(fs.readFileSync('extensions/ss-erp/shared/erp-adapter/listing-workflow-client.js', 'utf8'), sandbox);
  const sourceMedia = { snapshotId: 'snapshot-1', captureHash: 'a'.repeat(64), transferStatus: 'COMPLETE', items: [{ key: 'media-1', sourceUrl, displayUrl }] };
  const status = { contractVersion: 'extension-source-workbench-status/v1', snapshot: {
    id: 'snapshot-1', version: 1, capturedAt: '2026-10-10T00:00:00.000Z', current: true, captureHash: 'a'.repeat(64) },
    sourceMedia, listing: { items: [], truncated: false }, media: { items: [], truncated: false, actionableCount: 0 } };
  const client = sandbox.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({ transport: { async get() {
    return { state: 'response', body: { code: 1, data: { capability: { enabled: true, reason: 'pilot_match', revision: 'pilot-1' }, status } } };
  } } });
  assert.equal((await client.getStatus({ snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1' })).status.sourceMedia.items[0].displayUrl, displayUrl);
  for (const invalid of [{ ...sourceMedia, captureHash: 'b'.repeat(64) }, { ...sourceMedia, snapshotId: 'other' },
    { ...sourceMedia, items: [{ key: 'media-1', sourceUrl, displayUrl: 'https://127.0.0.1/private.jpg' }] },
    { ...sourceMedia, items: [{ key: 'media-1', sourceUrl, displayUrl, storageKey: 'private' }] }]) {
    status.sourceMedia = invalid;
    await assert.rejects(client.getStatus({ snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1' }));
  }
});

function bridgeHarness() {
  const nodes = [], messages = [], requests = [], timers = new Map(), listeners = new Map(), pending = [];
  let id = 0, state = 'PENDING', delayed = false, productId = '1001';
  const handoff = { snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1', platform: '1688', sourceProductId: '1001' };
  const response = () => ({ ok: true, handoff: { ...handoff }, result: { state: 'ready', status: {
    snapshot: { id: 'snapshot-1', current: true, captureHash: 'a'.repeat(64) },
    sourceMedia: { snapshotId: 'snapshot-1', captureHash: 'a'.repeat(64), transferStatus: state,
      items: state === 'COMPLETE' ? [{ key: 'media-1', sourceUrl, displayUrl }] : [] },
    listing: { items: [], truncated: false }, media: { items: [], actionableCount: 0 } } } });
  function node() {
    const handlers = new Map();
    const result = { style: { removeProperty() {} }, hidden: false,
      contentWindow: { postMessage(value) { messages.push(JSON.parse(JSON.stringify(value))); } },
      setAttribute() {}, appendChild() {}, remove() {},
      addEventListener(key, handler) { handlers.set(key, handler); },
      click() { handlers.get('click')?.({ target: result }); } };
    nodes.push(result); return result;
  }
  const environment = { URL, Map, Set, console, location: { href: 'https://detail.1688.com/offer/1001.html', hostname: 'detail.1688.com' },
    document: { documentElement: node(), createElement: node, addEventListener() {}, getElementById(key) { return nodes.find(value => value.id === key); } },
    chrome: { runtime: { id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', getManifest() { return { version: '1.0.452' }; },
      getURL(path) { return 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/' + path.replace(/^\//u, ''); },
      onMessage: { addListener() {} }, sendMessage(request, callback) {
        requests.push(request);
        if (request.type === 'spb-self-hosted:get-ozon-shops') callback({ ok: true, data: [] });
        else if (request.type === 'ss-erp:source-listing-workbench-status') delayed ? pending.push(callback) : callback(response());
        else throw Error('unexpected write or read ' + request.type);
      } } },
    SS_ERP_DONOR_1688_CAPTURE: { async collect() { return { ...structuredClone(product), productId }; } },
    addEventListener(key, handler) { listeners.set(key, handler); },
    setTimeout(handler, ms) { const key = ++id; timers.set(key, { handler, ms }); return key; }, clearTimeout(key) { timers.delete(key); } };
  environment.globalThis = environment;
  const context = vm.createContext(environment);
  vm.runInContext(fs.readFileSync(path, 'utf8'), context);
  vm.runInContext(fs.readFileSync('extensions/ss-erp/content/donor-workbench-bridge.js', 'utf8'), context);
  const frame = nodes.find(value => value.id === 'ss-erp-donor-workbench-frame');
  nodes.find(value => value.id === 'ss-erp-donor-workbench-trigger').click();
  const flush = () => new Promise(resolve => setImmediate(resolve));
  return { requests, pending, timers, response, flush, setState(value) { state = value; }, delay() { delayed = true; },
    open() { nodes.find(value => value.id === 'ss-erp-donor-workbench-trigger').click(); },
    projection() { return messages.filter(value => value.type === 'PROJECTION').at(-1)?.projection; },
    fire() { const entry = [...timers].find(([, value]) => value.ms !== 10000); assert.ok(entry, 'pending transfer must schedule a read');
      timers.delete(entry[0]); entry[1].handler(); },
    close() { listeners.get('message')({ source: frame.contentWindow, origin: new URL(frame.src).origin,
      data: { contractVersion: 'ss-erp-donor-workbench/v1', type: 'CLOSE', requestId: 'close' } }); },
    changeSource() { environment.location.href = 'https://detail.1688.com/offer/1002.html'; productId = '1002'; },
  };
}

test('an open workbench automatically shows completed source transfer without recollecting or changing editor authority', async () => {
  const h = bridgeHarness(); await h.flush();
  const before = h.projection(); assert.equal(before.busy, false);
  h.setState('COMPLETE'); h.fire(); await h.flush();
  assert.equal(h.projection().media[0].displayUrl, displayUrl);
  assert.equal(h.projection().busy, false);
  assert.deepEqual(h.projection().handoff, before.handoff);
  assert.deepEqual(h.projection().workbench.status.listing, before.workbench.status.listing);
  assert.equal(h.requests.filter(value => value.type === 'spb-self-hosted:get-ozon-shops').length, 1);
  assert.equal([...h.timers.values()].filter(value => value.ms !== 10000).length, 0);
});

test('source transfer polling is single-flight and discards delayed reads after close or source change', async () => {
  for (const stop of ['close', 'source']) {
    const h = bridgeHarness(); await h.flush(); h.delay(); h.fire(); await h.flush();
    assert.equal(h.pending.length, 1);
    assert.equal([...h.timers.values()].filter(value => value.ms !== 10000).length, 0);
    stop === 'close' ? h.close() : h.changeSource(); h.setState('COMPLETE'); h.pending.shift()(h.response()); await h.flush();
    assert.equal(h.projection().media[0].displayUrl, undefined);
    assert.equal([...h.timers.values()].filter(value => value.ms !== 10000).length, 0);
  }
});

test('terminal or repeatedly pending source transfer ends its bounded polling budget', async () => {
  for (const state of ['FAILED', 'UNKNOWN']) {
    const h = bridgeHarness(); await h.flush(); h.setState(state); h.fire(); await h.flush();
    assert.equal([...h.timers.values()].filter(value => value.ms !== 10000).length, 0);
  }
  const h = bridgeHarness(); await h.flush();
  for (let attempt = 0; attempt < 120; attempt += 1) { h.fire(); await h.flush(); }
  assert.equal([...h.timers.values()].filter(value => value.ms !== 10000).length, 0);
});

test('a closed window late response cannot cancel polling in a freshly reopened context', async () => {
  const h = bridgeHarness(); await h.flush(); h.delay(); h.fire(); await h.flush();
  h.close(); h.open(); await h.flush();
  assert.equal(h.pending.length, 2);
  h.pending.pop()(h.response()); await h.flush();
  assert.equal([...h.timers.values()].filter(value => value.ms !== 10000).length, 1);
  h.pending.shift()(h.response()); await h.flush();
  assert.equal([...h.timers.values()].filter(value => value.ms !== 10000).length, 1);
});

test('source thumbnail and enlarged preview use the display URL without changing source commands', () => {
  const page = fs.readFileSync('extensions/ss-erp/pages/precision-workbench.js', 'utf8');
  assert.match(page, /image\.src = item\.displayUrl \|\| item\.url/u);
  assert.match(page, /originalUrl: item\.displayUrl \|\| item\.url/u);
  assert.match(page, /if \(item\.displayUrl\) image\.crossOrigin = 'anonymous'/u);
  const workflow = fs.readFileSync('extensions/ss-erp/shared/donor-workbench/precision-workflow.js', 'utf8');
  assert.match(workflow, /main_images:[^\n]+return item\.url/u);
  assert.match(workflow, /sku_image_cross_origin: sku\.imageCrossOrigin/u);
  const table = fs.readFileSync('extensions/ss-erp/pages/donor/sku-image-workspace.js', 'utf8');
  assert.match(table, /image\.src = item\.displayUrl \|\| item\.url/u);
  const picker = fs.readFileSync('extensions/ss-erp/pages/donor/ui/presentation/views/sku-picker-view.js', 'utf8');
  assert.match(picker, /imageCrossOrigin === 'anonymous'\) createElementResult28\.crossOrigin = 'anonymous'/u);
  const editor = fs.readFileSync('extensions/ss-erp/pages/donor/ui/modules/product-editor.js', 'utf8');
  assert.match(editor, /arg121\.imageCrossOrigin === 'anonymous'\) localValue69\.crossOrigin = 'anonymous'/u);
});
