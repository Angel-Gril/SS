import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import { createLogisticsPricing } from '../extensions/ss-erp/pages/donor/logistics-pricing.js';

const binding = { snapshotId: 'snapshot', supplyGoodsId: 'goods', shopId: 'shop', listingWorkflowId: 'draft', draftRevision: 1, draftVersion: 1 };
const selection = { assignmentId: 'assignment', companyId: 'company', warehouseId: 'warehouse', originCountryUid: 'cn', originCityUid: 'city', destinationCountryUid: 'ru', destinationLocationUid: 'dest' };
const contractVersion = 'extension-listing-logistics-pricing/v1';
const hints = { commission: null, fx: null, requiresManual: ['commissionPct', 'fxRate'] };
const expires = () => new Date(Date.now() + 60_000).toISOString();
const assignment = { ...selection, shopId: binding.shopId, shopName: 'Shop', warehouseName: 'Warehouse', originLabel: 'CN/City', destinationLabel: 'RU/Destination', releaseSequence: 1, effectiveReleaseAvailable: true };
const scopes = () => ({ contractVersion, binding, selectedSkuKeys: ['sku'], packaging: [{ skuKey: 'sku', weightG: 100, lengthMm: 100, widthMm: 100, heightMm: 100 }], assignments: [assignment], hints, requiresSelection: true });
const services = () => ({ contractVersion, binding, selection, releaseId: 'release', releaseSequence: 1, effectiveChecksum: 'b'.repeat(64), services: [{ stableServiceKey: 'service', providerId: 'provider', displayName: 'Parcel', deliveryVariant: 'pickup', deliveryPromise: '10 days' }], hints, validUntil: expires(), authorizationValidUntil: expires(), requiresSelection: true });
const item = { skuKey: 'sku', declaredPriceMinor: 10000, hasBattery: false };
const quoteInput = { binding, selection, releaseId: 'release', effectiveChecksum: 'b'.repeat(64), stableServiceKey: 'service', items: [item] };
const quote = () => ({ contractVersion, binding, selection, releaseId: 'release', effectiveChecksum: 'b'.repeat(64), stableServiceKey: 'service', source: 'ERP_PUBLISHED_FORMULA', currency: 'CNY', items: [{ skuKey: 'sku', declaredPriceMinor: 10000, shippingMinor: 1500, packingMinor: 0, totalLogisticsMinor: 1500, shippingCostMinor: 1500, shippingCostCny: 15, matchedBand: { priceRangeCNY: ['0', '0'], priceRangeRUB: ['0', '0'] }, matchedRuleDigest: 'c'.repeat(64) }], hints, validUntil: expires(), authorizationValidUntil: expires(), requiresPricePreview: true, writesDraft: false });

function clientFixture(data, state = 'response') {
  const context = { URL, URLSearchParams };
  vm.runInNewContext(readFileSync('extensions/ss-erp/shared/erp-adapter/listing-workflow-client.js', 'utf8'), context);
  const requests = [];
  const client = context.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({ transport: { get: async () => {},
    post: async (...args) => { requests.push(args); return { state, body: { code: 1, data } }; } } });
  return { client, requests };
}
const plain = value => JSON.parse(JSON.stringify(value));
const call = (client, action) => action === 'scopes' ? client.readDraftLogisticsScopes(binding)
  : action === 'services' ? client.readDraftLogisticsServices({ binding, selection }) : client.quoteDraftLogistics(quoteInput);

test('client consumes exact current draft logistics DTOs and posts only quote-specific inputs', async () => {
  for (const [action, data] of [['scopes', scopes()], ['services', services()], ['quote', quote()]]) {
    const { client, requests } = clientFixture(data);
    assert.deepEqual(plain((await call(client, action)).logistics), data);
    assert.equal(requests.length, 1);
    assert.equal(requests[0][0], '/api/extension-device/source-workbench/editor/logistics-' + action);
    assert.deepEqual(plain(requests[0][2]), { requiredScope: 'listing:review' });
  }
});

test('client rejects malformed, foreign, duplicate and secret-bearing scope/hint responses', async () => {
  const mutations = [
    data => { data.assignments[0].shopId = 'foreign'; },
    data => { data.assignments[0].warehouseId = ''; },
    data => { data.assignments.push(data.assignments[0]); },
    data => { data.assignments[0].apiKey = 'secret-sentinel'; },
    data => { data.binding.shopId = 'foreign'; },
    data => { data.binding.ownerUserId = 'private-owner'; },
    data => { data.selectedSkuKeys = ['sku', 'sku']; },
    data => { data.packaging[0].weightG = -1; },
    data => { data.packaging[0].skuKey = 'foreign'; },
    data => { data.hints.fx = { rate: Infinity, source: 'open.er-api.com', fetchedAt: new Date().toISOString() }; },
    data => { data.hints.fx = { rate: 0.09, source: 'fallback', fetchedAt: new Date().toISOString() }; },
    data => { data.hints.fx = { rate: 0.09, source: 'open.er-api.com', fetchedAt: '2020-01-01T00:00:00.000Z' }; },
    data => { data.hints.apiKey = 'secret-sentinel'; },
    data => { data.requiresSelection = false; },
    data => { data.bundle = { secret: 'sentinel' }; },
  ];
  for (const mutate of mutations) {
    const data = structuredClone(scopes()); mutate(data);
    await assert.rejects(call(clientFixture(data).client, 'scopes'), /invalid logistics/);
  }
});

test('client rejects services for another selection, invalid leases or unexpected private fields', async () => {
  const mutations = [
    data => { data.selection.warehouseId = 'foreign'; },
    data => { data.selection.assignmentId = 'foreign'; },
    data => { data.services[0].stableServiceKey = ''; },
    data => { data.services.push(data.services[0]); },
    data => { data.services[0].deliveryVariant = 'unknown'; },
    data => { data.services[0].calculationRule = { private: true }; },
    data => { data.releaseSequence = 0; },
    data => { data.validUntil = new Date(Date.now() - 1000).toISOString(); },
    data => { data.authorizationValidUntil = new Date(Date.now() - 1000).toISOString(); },
    data => { data.hints.fx = { rate: 0.09, source: 'open.er-api.com', fetchedAt: new Date().toISOString(), apiKey: 'secret-sentinel' }; },
  ];
  for (const mutate of mutations) {
    const data = structuredClone(services()); mutate(data);
    await assert.rejects(call(clientFixture(data).client, 'services'), /invalid logistics/);
  }
});

test('client rejects over-limit quotes, mutated bands, mismatched money and missing preview contract', async () => {
  const mutations = [
    data => { data.items[0].shippingMinor = 1_000_000_001; data.items[0].shippingCostCny = data.items[0].shippingMinor / 100; },
    data => { data.items[0].packingMinor = 1; },
    data => { data.items[0].totalLogisticsMinor = 99; },
    data => { data.items[0].shippingCostMinor = 0; },
    data => { data.items[0].shippingCostCny = '15'; },
    data => { data.items[0].matchedBand.priceRangeCNY = ['100', '50']; },
    data => { data.items[0].matchedBand.priceRangeCNY = ['200', '300']; },
    data => { data.items[0].matchedRuleDigest = 'invalid'; },
    data => { data.items[0].skuKey = 'foreign'; },
    data => { data.items[0].declaredPriceMinor = 99; },
    data => { data.items[0].apiKey = 'secret-sentinel'; },
    data => { data.items.push(data.items[0]); },
    data => { data.requiresPricePreview = false; },
    data => { data.writesDraft = true; },
    data => { data.validUntil = 'invalid'; },
    data => { data.releaseId = 'foreign'; },
    data => { data.selection.destinationLocationUid = 'foreign'; },
  ];
  for (const mutate of mutations) {
    const data = structuredClone(quote()); mutate(data);
    await assert.rejects(call(clientFixture(data).client, 'quote'), /invalid logistics/);
  }
});

test('client treats nonresponse state as failure even with a response-like forged body', async () => {
  for (const state of ['http_error', 'scope_required', 'authorization_required', 'unpaired']) {
    await assert.rejects(call(clientFixture(scopes(), state).client, 'scopes'));
  }
});

test('client rejects caller-owned fields, empty-price and duplicate-SKU requests before POST', async () => {
  const { client, requests } = clientFixture(quote());
  for (const input of [
    { ...quoteInput, bundle: {} }, { ...quoteInput, commissionPct: 0 },
    { ...quoteInput, items: [{ ...item, declaredPriceMinor: 0 }] },
    { ...quoteInput, items: [item, item] },
    { ...quoteInput, selection: { ...selection, apiKey: 'secret-sentinel' } },
  ]) await assert.rejects(client.quoteDraftLogistics(input));
  assert.equal(requests.length, 0);
});

class Element {
  constructor(tag, registry) { this.tag = tag; this.registry = registry; this.children = []; this.listeners = new Map(); this.value = ''; this.disabled = false; }
  set id(value) { this.registry.set(value, this); }
  append(...items) { this.children.push(...items); }
  prepend(...items) { this.children.unshift(...items); }
  replaceChildren(...items) { this.children = items; this.value = ''; }
  setAttribute() {}
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  trigger(type, trusted = true) { return this.listeners.get(type)?.({ isTrusted: trusted }); }
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function uiFixture(commandOverride, calculate = () => ({ price: '100.00' })) {
  const registry = new Map();
  globalThis.document = { createElement: tag => new Element(tag, registry) };
  const applied = [], errors = [], calls = [];
  let currentBinding = { ...binding }, rows = [{ skuKey: 'sku', cost: 70, shippingCost: '' }], parameters = { currency: 'CNY', commissionPct: 10 };
  const command = async (type, payload) => {
    calls.push({ type, payload });
    if (commandOverride) { const overridden = commandOverride(type, payload); if (overridden) return overridden; }
    const data = type === 'LOGISTICS_SCOPES' ? scopes() : type === 'LOGISTICS_SERVICES' ? services() : quote();
    return { data: { logistics: data } };
  };
  const tool = createLogisticsPricing({ root: new Element('root', registry), command, getBinding: () => currentBinding,
    getRows: () => rows, getParameters: () => parameters, calculate, onQuote: value => applied.push(value), report: error => errors.push(error) });
  return { tool, registry, applied, calls, errors, setBinding: value => { currentBinding = value; }, setRows: value => { rows = value; }, setParameters: value => { parameters = value; } };
}
async function prepare(ui) {
  await ui.tool.open();
  const scope = ui.registry.get('precision-logistics-scope'); scope.value = '0'; scope.trigger('change');
  ui.registry.get('precision-logistics-read').trigger('click'); await tick();
  const service = ui.registry.get('precision-logistics-service'); service.value = 'service'; service.trigger('change');
  const battery = ui.registry.get('precision-logistics-battery'); battery.value = 'no'; battery.trigger('change');
}

test('modal requires explicit scope/service/battery and disables inputs during quote', async () => {
  const pending = deferred(), ui = uiFixture(type => type === 'LOGISTICS_QUOTE' ? pending.promise : undefined);
  await ui.tool.open();
  assert.equal(ui.registry.get('precision-logistics-scope').value, '');
  assert.equal(ui.registry.get('precision-logistics-quote').disabled, true);
  await prepare(ui);
  ui.registry.get('precision-logistics-quote').trigger('click'); await tick();
  for (const id of ['scope', 'service', 'battery']) assert.equal(ui.registry.get('precision-logistics-' + id).disabled, true);
  pending.resolve({ data: { logistics: quote() } }); await tick();
  assert.equal(ui.applied.length, 1);
  assert.equal(ui.calls.filter(call => call.type === 'LOGISTICS_QUOTE').length, 1);
});

test('services arriving after a route change cannot install the previous route release', async () => {
  const pending = deferred(), ui = uiFixture(type => type === 'LOGISTICS_SERVICES' ? pending.promise : undefined);
  await ui.tool.open();
  const scope = ui.registry.get('precision-logistics-scope'); scope.value = '0'; scope.trigger('change');
  ui.registry.get('precision-logistics-read').trigger('click'); await tick();
  scope.value = ''; scope.trigger('change');
  pending.resolve({ data: { logistics: services() } }); await tick();
  assert.deepEqual(ui.registry.get('precision-logistics-service').children.map(item => item.value), []);
});

test('quote does not apply after service, battery, rows, parameters or binding change', async () => {
  for (const change of ['service', 'battery', 'rows', 'parameters', 'binding']) {
    const pending = deferred(), ui = uiFixture(type => type === 'LOGISTICS_QUOTE' ? pending.promise : undefined);
    await prepare(ui);
    ui.registry.get('precision-logistics-quote').trigger('click'); await tick();
    if (change === 'service') ui.registry.get('precision-logistics-service').value = 'changed';
    if (change === 'battery') ui.registry.get('precision-logistics-battery').value = 'yes';
    if (change === 'rows') ui.setRows([{ skuKey: 'sku', cost: 80, shippingCost: '' }]);
    if (change === 'parameters') ui.setParameters({ currency: 'CNY', commissionPct: 20 });
    if (change === 'binding') ui.setBinding({ ...binding, draftVersion: 2 });
    pending.resolve({ data: { logistics: quote() } }); await tick();
    assert.equal(ui.applied.length, 0, change);
    assert.equal(ui.calls.filter(call => call.type === 'LOGISTICS_QUOTE').length, 1, change);
  }
});

test('closing/reopening invalidates a pending quote even for the identical draft and inputs', async () => {
  const pending = deferred(), ui = uiFixture(type => type === 'LOGISTICS_QUOTE' ? pending.promise : undefined);
  await prepare(ui);
  ui.registry.get('precision-logistics-quote').trigger('click'); await tick();
  ui.tool.close(); await ui.tool.open();
  pending.resolve({ data: { logistics: quote() } }); await tick();
  assert.equal(ui.applied.length, 0);
});

test('overlapping opens suppress the superseded scopes response and cannot select its first route', async () => {
  const first = deferred(), second = deferred(); let count = 0;
  const ui = uiFixture(type => type === 'LOGISTICS_SCOPES' ? (++count === 1 ? first.promise : second.promise) : undefined);
  const earlier = ui.tool.open(), latest = ui.tool.open();
  second.resolve({ data: { logistics: { ...scopes(), assignments: [{ ...assignment, assignmentId: 'latest', warehouseName: 'Latest' }] } } });
  await latest;
  first.resolve({ data: { logistics: scopes() } }); await earlier;
  const options = ui.registry.get('precision-logistics-scope').children;
  assert.equal(options.length, 2);
  assert.match(options[1].textContent, /Latest/);
  assert.equal(ui.registry.get('precision-logistics-scope').value, '');
});

test('a quotation that cannot stabilize stops after eight checks without filling freight', async () => {
  let attempts = 0;
  const ui = uiFixture((type, payload) => {
    if (type !== 'LOGISTICS_QUOTE') return;
    const data = quote();
    data.items[0].declaredPriceMinor = payload.items[0].declaredPriceMinor;
    data.items[0].shippingCostCny = ++attempts;
    return Promise.resolve({ data: { logistics: data } });
  }, input => ({ price: String(Number(input.cost) + Number(input.shippingCost)) }));
  await prepare(ui);
  ui.registry.get('precision-logistics-quote').trigger('click'); await tick();
  assert.equal(attempts, 8);
  assert.equal(ui.applied.length, 0);
  assert.match(ui.registry.get('precision-logistics-state').textContent, /未能收敛/);
});

test('zero-price calculation never invents a positive declared price or calls the quote endpoint', async () => {
  const ui = uiFixture(undefined, () => ({ price: '0.00' }));
  await prepare(ui);
  ui.registry.get('precision-logistics-quote').trigger('click'); await tick();
  assert.equal(ui.calls.filter(call => call.type === 'LOGISTICS_QUOTE').length, 0);
  assert.equal(ui.applied.length, 0);
});

test('a second physical quote click during the request cannot send another quotation', async () => {
  const pending = deferred(), ui = uiFixture(type => type === 'LOGISTICS_QUOTE' ? pending.promise : undefined);
  await prepare(ui);
  const button = ui.registry.get('precision-logistics-quote');
  button.trigger('click'); button.trigger('click'); await tick();
  assert.equal(ui.calls.filter(call => call.type === 'LOGISTICS_QUOTE').length, 1);
  pending.resolve({ data: { logistics: quote() } }); await tick();
  assert.equal(ui.applied.length, 1);
});
