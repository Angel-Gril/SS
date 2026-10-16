import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { workbookFixture, documentFixture } from './commission-workbook-fixture.mjs';

const worker = fs.readFileSync('extensions/ss-erp/background/service-worker.js', 'utf8');
const rates = fs.readFileSync('extensions/ss-erp/shared/commission/commission-rates.js', 'utf8');
const settings = fs.readFileSync('extensions/ss-erp/pages/settings.js', 'utf8');
const key = 'ozon-calculator:commission-snapshot';
const table = '<table><tr><td>Clothing</td><td>12%</td><td>15%</td></tr></table>';
const shell = '<html><script type="application/json" id="__NUXT_DATA__" data-ssr="false">[{},false]</script></html>';
const official = { source: 'official-docs', sourceUrl: 'https://global-help.ozon.com/en/commissions/ozon-fees/commissions?region=CHN',
  fetchedAt: '2026-01-01T00:00:00.000Z', rules: [{ category: 'Clothing', bands: [{ minRUB: 0, maxRUB: 0, rfbs: 12, fbp: 15 }] }] };
const fallback = { ...official, source: 'local-fallback', sourceUrl: 'local-fallback:ozon-chn-commission' };
const section = (source, start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a);
  return source.slice(a, b);
};

function runtime({ documents = [shell], cached, fetchFailure, publicDocument, publicPageDocument, workbook = workbookFixture() } = {}) {
  const values = cached ? { [key]: structuredClone(cached) } : {};
  const requests = [], writes = [];
  let htmlRequests = 0;
  const context = { console, URL, TextDecoder, TextEncoder, AbortController, setTimeout, clearTimeout, Response,
    Blob, DecompressionStream, Uint8Array, DataView, crypto: webcrypto,
    toText: value => value == null ? '' : String(value),
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (fetchFailure) throw fetchFailure;
      if (url.includes('document-manager-api')) return new Response(JSON.stringify(publicDocument || {}), { status: publicDocument ? 200 : 404 });
      if (url.startsWith('https://cdn.ozone.ru/')) return new Response(workbook);
      const body = documents[Math.min(htmlRequests++, documents.length - 1)];
      return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
    },
    chrome: { storage: { local: {
      get: async keys => Object.fromEntries(keys.map(name => [name, values[name]])),
      set: async data => { writes.push(structuredClone(data)); Object.assign(values, data); },
    } } },
  };
  context.globalThis = context;
  if (publicPageDocument) context.OZON_CALC_COMMISSION_PUBLIC_DOCUMENT = { read: async () => publicPageDocument };
  vm.createContext(context);
  vm.runInContext(rates, context);
  if (fs.existsSync('extensions/ss-erp/shared/commission/commission-workbook.js')) {
    vm.runInContext(fs.readFileSync('extensions/ss-erp/shared/commission/commission-workbook.js', 'utf8'), context);
  }
  if (fs.existsSync('extensions/ss-erp/shared/commission/commission-sync.js')) {
    vm.runInContext(fs.readFileSync('extensions/ss-erp/shared/commission/commission-sync.js', 'utf8'), context);
  }
  vm.runInContext(section(worker, 'const OZON_COMMISSION_SNAPSHOT_KEY =', 'const OZON_FX_API_URL =')
    + section(worker, 'async function fetchJsonOrThrow(', 'async function syncFxSnapshot('), context);
  return { context, values, requests, writes, sync: automatic => context.syncCommissionSnapshot(automatic), parser: context.OZON_CALC_COMMISSION_RATES };
}

test('a nonempty dynamic shell is not a successful sync', async () => {
  const f = runtime(); const result = await f.sync();
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'commission_document_unavailable');
  assert.equal(result.snapshot.source, 'local-fallback');
});

test('unverified legacy HTML cannot replace the validated ordinary workbook contract', async () => {
  const f = runtime({ documents: [shell, table], cached: official }); const result = await f.sync();
  assert.equal(result.ok, false);
  assert.deepEqual(JSON.parse(JSON.stringify(f.values[key])), official);
});

test('a failed refresh preserves the exact last official snapshot and its successful timestamp', async () => {
  const f = runtime({ cached: official }); const result = await f.sync();
  assert.deepEqual(JSON.parse(JSON.stringify(f.values[key])), official);
  assert.equal(result.ok, false);
  assert.equal(result.snapshot.fetchedAt, official.fetchedAt);
  assert.equal(result.state, 'cached');
});

test('network errors do not turn the local fallback into current official data', async () => {
  const f = runtime({ fetchFailure: new TypeError('private-sentinel-do-not-echo') }); const result = await f.sync();
  assert.equal(result.ok, false);
  assert.equal(result.state, 'fallback');
  assert.equal(result.snapshot.fetchedAt, '');
  assert.doesNotMatch(JSON.stringify(result), /private-sentinel/);
});

test('public background commission reads omit credentials and are time bounded', async () => {
  const f = runtime({ publicDocument: documentFixture() }); await f.sync();
  assert.equal(f.requests[0].options.credentials, 'omit');
  assert.ok(f.requests[0].options.signal);
});

test('fallback matching preserves the rate while disclosing its nonofficial source', () => {
  const parser = runtime().parser;
  const match = parser.matchCommissionRate(fallback, { priceRUB: 1000, categoryHints: ['Clothing'], manualRatePct: 8 });
  assert.equal(match.ratePct, 12);
  assert.equal(match.source, 'local-fallback');
});

test('unknown-category fallback estimates also preserve their nonofficial source', () => {
  const match = runtime().parser.matchCommissionRate(fallback, { priceRUB: 1000, categoryHints: ['unmatched synthetic category'], manualRatePct: 8 });
  assert.equal(match.ratePct, 12);
  assert.equal(match.source, 'local-fallback');
});

function settingsRuntime(snapshot, syncState) {
  const node = () => ({ textContent: '', classList: { add() {}, remove() {} } });
  const context = { currentStatus: { commissionRuleCount: snapshot?.rules.length || 0,
    commissionSnapshot: snapshot, commissionSyncState: syncState }, currentSnapshot: {},
    commissionSyncStatusNode: node(), healthCommissionNode: node(), healthSummaryNode: node(),
    healthLogisticsNode: node(), healthFxNode: node(), fxSyncStatusNode: null, configStatusNode: node(),
    getServices: () => [], getSelectedIds: () => [], setText: (n, text) => { if (n) n.textContent = text; },
    setStatus: (n, text, tone) => { n.textContent = text; n.tone = tone; },
    setHealthState: (n, text, tone) => { n.textContent = text; n.tone = tone; },
    formatTime: value => value || '-', setBadge() {}, renderSelectedSummary() {}, renderStrategy() {},
    sendMessage: async () => ({ ok: false, state: 'fallback', snapshot: fallback, error: '未取得官方费率' }), loadStatus() {},
  };
  for (const name of ['sellerCountNode', 'officialCountNode', 'officialSampleCountNode', 'selectedCountNode', 'allCountNode',
    'configUpdatedAtNode', 'sellerBadgeNode', 'officialBadgeNode', 'selectedBadgeNode']) context[name] = node();
  context.globalThis = context;
  vm.createContext(context); vm.runInContext(rates, context);
  vm.runInContext(section(settings, '  function renderHealthSummary()', '  function setDiagnostic(')
    + section(settings, '  function syncCommissionRates()', '  function syncFxRates()'), context);
  return context;
}

test('settings refresh never marks a fallback snapshot as ready or officially synchronized', () => {
  const f = settingsRuntime(fallback); f.renderStatus(f.currentStatus);
  assert.equal(f.commissionSyncStatusNode.tone, 'warn');
  assert.equal(f.healthCommissionNode.tone, 'warn');
  assert.match(f.commissionSyncStatusNode.textContent, /备用/);
  assert.doesNotMatch(f.healthCommissionNode.textContent, /已就绪/);
});

test('settings keeps last official rates visible but reports the failed current refresh', () => {
  const f = settingsRuntime(official, { status: 'failed', attemptedAt: '2026-01-02T00:00:00.000Z' }); f.renderStatus(f.currentStatus);
  assert.equal(f.commissionSyncStatusNode.tone, 'warn');
  assert.match(f.commissionSyncStatusNode.textContent, /上次/);
  assert.equal(f.healthCommissionNode.tone, 'warn');
});

test('verified official sync still renders the ready state', () => {
  const f = settingsRuntime(official, { status: 'synced' }); f.renderStatus(f.currentStatus);
  assert.equal(f.commissionSyncStatusNode.tone, 'success');
  assert.equal(f.healthCommissionNode.tone, 'good');
});

test('manual synchronization does not show success for a fallback result', async () => {
  const f = settingsRuntime(fallback); await f.syncCommissionRates();
  assert.notEqual(f.commissionSyncStatusNode.tone, 'success');
  assert.doesNotMatch(f.commissionSyncStatusNode.textContent, /已同步/);
});

test('official dynamic JSON plus its ordinary workbook produces current six-band rates', async () => {
  const f = runtime({ publicDocument: documentFixture() }); const result = await f.sync();
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.rules.length, 1);
  assert.equal(result.snapshot.rules[0].bands[2].rfbs, 20.5);
  assert.equal(result.snapshot.rules[0].bands[2].fbp, 19.5);
  assert.equal(f.requests.filter(r => r.url.startsWith('https://cdn.ozone.ru/')).length, 1);
});

test('workbook brand conditions are retained rather than merged into universal rules', async () => {
  const f = runtime({ publicDocument: documentFixture(), workbook: workbookFixture({ brand: 'Dyson' }) }); const result = await f.sync();
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.rules[0].brand, 'Dyson');
  const unknown = f.parser.matchCommissionRate(result.snapshot, { categoryHints: ['测试吸尘器'], priceRUB: 1000, manualRatePct: 9 });
  assert.equal(unknown.source, 'manual');
  assert.equal(unknown.ratePct, 9);
  const matched = f.parser.matchCommissionRate(result.snapshot, { brand: 'Dyson', categoryHints: ['测试吸尘器'], priceRUB: 1000 });
  assert.equal(matched.ratePct, 12);
});

for (const [name, options] of [['formulas', { formula: true }], ['future fee dates', { future: true }]]) {
  test('rejects ' + name + ' without replacing saved official rates', async () => {
    const f = runtime({ publicDocument: documentFixture(), workbook: workbookFixture(options), cached: official });
    const result = await f.sync(); assert.equal(result.ok, false);
    assert.deepEqual(JSON.parse(JSON.stringify(f.values[key])), official);
  });
}

test('workbook external-link metadata never causes another network request', async () => {
  const f = runtime({ publicDocument: documentFixture(), workbook: workbookFixture({ external: true }) });
  const result = await f.sync(); assert.equal(result.ok, true);
  assert.equal(f.requests.some(r => r.url.includes('private.invalid')), false);
});

test('untrusted attachment origins are never fetched', async () => {
  const f = runtime({ publicDocument: documentFixture('https://private.invalid/Tarifs_CN_01_12_2025_1234567890.xlsx') });
  const result = await f.sync(); assert.equal(result.ok, false);
  assert.equal(f.requests.some(r => r.url.includes('private.invalid')), false);
});

test('a normal public help-page read can supply the document when anonymous background JSON is unavailable', async () => {
  const f = runtime({ publicPageDocument: documentFixture() }); const result = await f.sync();
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.rules[0].bands[2].rfbs, 20.5);
});

test('simultaneous synchronization shares one public document and attachment fetch', async () => {
  const f = runtime({ publicDocument: documentFixture() });
  const [a, b] = await Promise.all([f.sync(), f.sync()]);
  assert.equal(a.snapshot, b.snapshot);
  assert.equal(f.requests.filter(r => r.url.startsWith('https://cdn.ozone.ru/')).length, 1);
});

test('automatic refresh does not hammer the public site after a known failed attempt', async () => {
  const f = runtime(); await f.sync(true); const count = f.requests.length;
  const second = await f.sync(true); assert.equal(second.ok, false);
  assert.equal(f.requests.length, count);
  await f.sync(false); assert.ok(f.requests.length > count, 'a manual click can request a new bounded attempt');
});

test('the SKU workbench cannot bypass a brand refusal through its older matcher', async () => {
  const f = runtime({ publicDocument: documentFixture(), workbook: workbookFixture({ brand: 'Dyson' }) });
  const result = await f.sync();
  vm.runInContext(fs.readFileSync('extensions/ss-erp/shared/ozon/sku-workbench.js', 'utf8'), f.context);
  const row = f.context.SS_ERP_OZON_SKU_WORKBENCH.buildSkuWorkbenchRow({ sku: '123456', pagePrice: 1000, fxRate: 0.08,
    metrics: { category3: '测试吸尘器' }, commissionSnapshot: result.snapshot });
  assert.equal(row.commissionRate, null);
  const known = f.context.SS_ERP_OZON_SKU_WORKBENCH.buildSkuWorkbenchRow({ sku: '123456', pagePrice: 1000, fxRate: 0.08,
    metrics: { category3: '测试吸尘器', brand: 'Dyson' }, commissionSnapshot: result.snapshot });
  assert.equal(known.commissionRate, 12);
});

test('a storage write failure is surfaced instead of treated as another network failure', async () => {
  const f = runtime({ publicDocument: documentFixture() });
  f.context.chrome.storage.local.set = async () => { throw new Error('Storage unavailable'); };
  await assert.rejects(f.sync(), /Storage unavailable/);
  assert.equal(f.requests.length, 2);
});

function publicPageRuntime({ targetUrl = 'https://global-help.ozon.com/zh/commissions/ozon-fees/commissions?region=CHN', injectionFails = false } = {}) {
  const removed = [], injected = [], created = [];
  const context = { URL, setTimeout, clearTimeout };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('extensions/ss-erp/shared/commission/commission-public-document.js', 'utf8'), context);
  const options = { tabs: { create: async spec => { created.push(spec); return { id: 987 }; },
    get: async () => ({ id: 987, status: 'complete', url: targetUrl }),
    remove: async id => { removed.push(id); }, onUpdated: { addListener() {}, removeListener() {} } },
  scripting: { executeScript: async spec => { injected.push(spec); if (injectionFails) throw new Error('Page unavailable'); return [{ result: documentFixture() }]; } } };
  return { removed, injected, created, read: () => context.OZON_CALC_COMMISSION_PUBLIC_DOCUMENT.read(options) };
}

test('public-document reader creates an inactive owned page and closes precisely that tab', async () => {
  const f = publicPageRuntime(); await f.read();
  assert.equal(f.created[0].active, false);
  assert.equal(f.injected[0].target.tabId, 987);
  assert.deepEqual(f.removed, [987]);
});

test('public-document reader refuses navigation to login or another origin and closes its owned tab', async () => {
  for (const targetUrl of ['https://global-help.ozon.com/login', 'https://private.invalid/commissions']) {
    const f = publicPageRuntime({ targetUrl });
    await assert.rejects(f.read(), /public_page_rejected/);
    assert.equal(f.injected.length, 0); assert.deepEqual(f.removed, [987]);
  }
});

test('public-document reader also closes its tab on an injection failure', async () => {
  const f = publicPageRuntime({ injectionFails: true }); await assert.rejects(f.read(), /Page unavailable/);
  assert.deepEqual(f.removed, [987]);
});

test('a broad category is not evidence for a specific workbook product type', async () => {
  const f = runtime({ publicDocument: documentFixture() }); const result = await f.sync();
  const match = f.parser.matchCommissionRate(result.snapshot, { categoryHints: ['吸尘器'], priceRUB: 1000, manualRatePct: 8 });
  assert.equal(match.source, 'manual'); assert.equal(match.ratePct, 8);
});

test('equally matched product types with different rates require confirmation instead of taking the first row', () => {
  const f = runtime();
  const snapshot = { source: 'official-docs', rules: [
    { category: '测试保护套', typeSpecific: true, group: '普通用品', bands: [{ minRUB: 0, maxRUB: 0, rfbs: 12, fbp: 11 }] },
    { category: '测试保护套', typeSpecific: true, group: '特殊用品', bands: [{ minRUB: 0, maxRUB: 0, rfbs: 20, fbp: 19 }] },
  ] };
  const match = f.parser.matchCommissionRate(snapshot, { categoryHints: ['测试保护套'], priceRUB: 1000, manualRatePct: 8 });
  assert.equal(match.source, 'manual'); assert.equal(match.reason, 'ambiguous_category');
});

test('a WHD HTML table cannot be promoted to the ordinary official commission cache', async () => {
  const f = runtime({ documents: ['<h1>WHD commission</h1>' + table], cached: official });
  const result = await f.sync(); assert.equal(result.ok, false);
  assert.deepEqual(JSON.parse(JSON.stringify(f.values[key])), official);
});

for (const [name, corrupt] of [
  ['more than 32 archive entries', bytes => { bytes.writeUInt16LE(99, bytes.length - 14); bytes.writeUInt16LE(99, bytes.length - 12); }],
  ['declared ZIP expansion beyond limit', bytes => { const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); bytes.writeUInt32LE(32 * 1024 * 1024, central + 24); }],
  ['bad CRC', bytes => { const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); bytes.writeUInt32LE(123, central + 16); }],
  ['encrypted ZIP', bytes => { const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); bytes.writeUInt16LE(1, central + 8); }],
]) {
  test('rejects ' + name + ' without changing the official cache', async () => {
    const bytes = workbookFixture(); corrupt(bytes);
    const f = runtime({ cached: official, publicDocument: documentFixture(), workbook: bytes });
    const result = await f.sync(); assert.equal(result.ok, false);
    assert.deepEqual(JSON.parse(JSON.stringify(f.values[key])), official);
  });
}

test('an overlarge HTTP response is rejected before downloading its body', async () => {
  const f = runtime({ cached: official, publicDocument: documentFixture() }); let bodyRead = false;
  f.context.fetch = async () => ({ ok: true, headers: new Headers({ 'content-length': '9999999' }),
    body: { getReader() { bodyRead = true; throw new Error('should never read'); } } });
  const result = await f.sync(); assert.equal(result.ok, false); assert.equal(bodyRead, false);
});

test('specific workbook rates require a known positive RUB price', async () => {
  const f = runtime({ publicDocument: documentFixture() }); const result = await f.sync();
  const match = f.parser.matchCommissionRate(result.snapshot, { categoryHints: ['测试吸尘器'], priceRUB: 0, manualRatePct: 8 });
  assert.equal(match.source, 'manual'); assert.equal(match.ratePct, 8);
});
