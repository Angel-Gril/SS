import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { TextEncoder } from 'node:util';

const paths = [
  'extensions/ss-erp/shared/calculator-core/har-import.js',
  'extensions/ss-erp/shared/logistics-rules/capture-task-adapter.js',
  'extensions/ss-erp/shared/logistics-rules/capture-task-runtime.js',
];

function plain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function loadModules() {
  const context = {
    Array, Boolean, Date, Error, JSON, Map, Math, Number, Object, Promise, RegExp,
    Set, String, TextEncoder, TypeError, URL, crypto: webcrypto,
  };
  context.globalThis = context;
  context.self = context;
  for (const path of paths) {
    vm.runInNewContext(fs.readFileSync(path, 'utf8'), context, { filename: path });
  }
  return {
    adapter: context.SS_ERP_LOGISTICS_CAPTURE_ADAPTER,
    runtime: context.SS_ERP_LOGISTICS_CAPTURE_RUNTIME,
    importer: context.OZON_CALC_HAR_IMPORT,
  };
}

const scope = {
  tenantId: 'owner-a', shopId: 'shop-a', companyId: 'company-a',
  warehouseId: 'warehouse-a', originCountryUid: 'china', originCityUid: 'xiamen',
};
const expectedEndpoints = [
  'seller/template/by-location', 'seller/provider-inventory',
];
const legacyExpectedEndpoints = [
  'seller/template/by-location', 'seller/category/list', 'seller/delivery-speed',
  'seller/provider-inventory',
];

function sellerTask(overrides = {}) {
  return {
    id: 'task-seller-1', version: 'logistics-capture-task/v2', kind: 'SELLER',
    scope, destination: null, officialFingerprint: null, expectedEndpoints,
    fingerprintChecksum: 'a'.repeat(64), claimToken: 'claim.' + 'x'.repeat(40),
    status: 'ISSUED', issuedAt: '2026-07-12T10:00:00.000Z',
    expiresAt: '2026-07-12T10:10:00.000Z', ...overrides,
  };
}

function entry(path, request, body, capturedAt = '2026-07-12T10:01:00.000Z') {
  return {
    startedDateTime: capturedAt,
    request: {
      method: 'POST',
      url: 'https://seller.ozon.ru/api/delivery-method-service/v2/' + path,
      postData: { text: JSON.stringify(request) },
    },
    response: {
      status: 200,
      content: { mimeType: 'application/json', text: JSON.stringify(body) },
    },
    _ozonCalc: { mode: 'seller', capturedAt },
  };
}

function sellerEntries(companyId = 'company-a') {
  return [
    entry('provider/template/by-location/list', {
      available_integration_type: 1, company_id: companyId,
      point: { latitude: 24.480107, longitude: 118.085348 },
    }, {
      provider_templates: [{
        template_id: 101, provider_id: 1778, provider_name: 'ATC Express',
        template_name: 'ATC Express Premium Small to Ozon pick-up point', template_type: 'global',
        weight_type: 3, delivery_type: 'pvz', has_battery: false,
        min_weight: { value: 0 }, max_weight: { value: 20000 },
        max_length: { value: 600 }, max_width: { value: 400 }, max_height: { value: 400 },
        longest_side_limit: { value: 600 },
        destination: { country_uid: 'russia', location_uid: 'moscow' },
        delivery_tariff: {
          price_per_shipment: { units: 46, nanos: 190000000 },
          weight_rounding_step_price: { units: 10 },
          weight_rounding_step_grammes: 500,
          min_posting_weight_in_grams: { value: 500 },
        },
      }],
    }),
    entry('provider/template/category/list', {}, {
      result: [{ category_id: 1, category_name: 'Express', category_list_number: 1 }],
    }),
    entry('provider/template/speed/list', {}, {
      result: [{ speed_name: 'Express', category_delivery_days: [] }],
    }),
    {
      startedDateTime: '2026-07-12T10:01:10.000Z',
      request: {
        method: 'POST', url: 'ss-erp://capture/seller/provider-inventory',
        postData: { text: JSON.stringify({
          companyId,
          point: { latitude: 24.480107, longitude: 118.085348 },
        }) },
      },
      response: { status: 200, content: { mimeType: 'application/json', text: JSON.stringify({
        companyId,
        providers: [{
          providerId: 1778, providerName: 'ATC Express', source: 'both',
          status: 'succeeded', pointCount: 12,
        }],
        providerStats: {
          discovered: 1, attempted: 1, succeeded: 1, failed: 0, empty: 0,
          catalogComplete: true, methodBindingsComplete: true,
          methodBindingsRequired: true, complete: true,
        },
      }) } },
      _ozonCalc: { mode: 'seller', source: 'seller-provider-inventory-capture' },
    },
  ];
}

function officialTask(overrides = {}) {
  return {
    id: 'task-official-1', version: 'logistics-capture-task/v1', kind: 'OFFICIAL', scope,
    destination: { countryUid: 'russia', locationUid: 'moscow' },
    officialFingerprint: {
      originCountryUid: 'china', originCityUid: 'xiamen',
      destinationCountryUid: 'russia', destinationLocationUid: 'moscow',
      currency: 'CNY', declaredPriceMinor: '300000', weightGrams: '498',
      dimensionsMm: { length: '180', width: '160', height: '90' }, batteryMode: 'UNSPECIFIED',
    },
    expectedEndpoints: ['global-calculator/calculate'], fingerprintChecksum: 'b'.repeat(64),
    claimToken: 'claim.' + 'y'.repeat(40), status: 'ISSUED',
    issuedAt: '2026-07-12T10:00:00.000Z', expiresAt: '2026-07-12T10:10:00.000Z',
    ...overrides,
  };
}

function officialEntry(overrides = {}) {
  const request = {
    height: 90, width: 160, length: 180, weight: 498, price: 3000, currency: 'CNY',
    countryUid: 'china', cityUid: 'xiamen', destinationCountryUid: 'russia',
    destinationLocationUid: 'moscow', ...overrides,
  };
  return {
    startedDateTime: '2026-07-12T10:01:30.000Z',
    request: {
      method: 'POST',
      url: '/p-api/tpl-api-global-calc-gw/v1/calculator/calculate',
      postData: { text: JSON.stringify(request) },
    },
    response: { status: 200, content: { mimeType: 'application/json', text: JSON.stringify({
      tariffs: [{
        providerId: '1778', providerName: 'ATC Express Premium Small',
        description: 'ATC Express Premium Small to Ozon pick-up point', price: 46.19,
        rating: 4.8, weightType: 'weight', deliverySpeed: 12, isDropOff: true,
        hasBattery: false, templateType: 'global',
        clusterDeliverySpeeds: [{ min: 12, max: 19, clusterName: 'Moscow' }],
      }],
    }) } },
    _ozonCalc: {
      mode: 'official', pageUrl: 'https://globalcalculator.ozon.ru/',
      capturedAt: '2026-07-12T10:01:30.000Z',
    },
  };
}

function response(status, body) {
  return {
    status, ok: status >= 200 && status < 300,
    headers: { get() { return null; } }, async json() { return body; },
  };
}

test('Seller adapter builds a fresh, scoped, canonical capture', async () => {
  const { adapter, importer } = loadModules();
  const result = await adapter.buildCapture({
    task: sellerTask(), entries: sellerEntries(), selectedServiceIds: ['101'],
    harImporter: importer,
  });

  assert.equal(result.state, 'ready');
  assert.deepEqual(plain(result.payload.endpointBatch), {
    expected: expectedEndpoints, attempted: expectedEndpoints, succeeded: expectedEndpoints,
    failed: [], empty: [],
  });
  assert.deepEqual(plain(result.payload.sellerContext), {
    point: { latitude: 24.480107, longitude: 118.085348 },
  });
  assert.deepEqual(Object.keys(result.payload).sort(), [
    'schema', 'capturedAt', 'responseChecksum', 'sellerContext', 'endpointBatch',
    'providerStats', 'providerRows', 'services', 'legacySelectedServiceKeys',
  ].sort());
  assert.deepEqual(plain(result.payload.providerStats), {
    discovered: 1, attempted: 1, succeeded: 1, failed: 0, empty: 0,
    catalogComplete: true, methodBindingsComplete: true,
    methodBindingsRequired: true, complete: true,
  });
  assert.match(result.payload.responseChecksum, /^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(result.payload.services[0]).sort(), [
    'batteryMode', 'calculationRule', 'deliveryVariant', 'normalizedDescription',
    'providerId', 'routeCandidates', 'stableServiceKey', 'templateType', 'weightType',
  ].sort());
  assert.equal(result.payload.services[0].calculationRule.serviceId, result.payload.services[0].stableServiceKey);
  assert.equal(result.payload.services[0].weightType, 'weight');
  assert.equal(
    result.payload.services[0].stableServiceKey,
    'svc:v2:["1778","atc express premium small to ozon pick-up point","global","weight","no-battery"]',
  );
  assert.deepEqual(plain(result.payload.services[0].routeCandidates), [{
    destinationCountryUid: 'russia', destinationLocationUid: 'moscow',
    evidenceType: 'ozon_structured_destination',
  }]);
  assert.deepEqual(plain(result.payload.providerRows), [{
    providerId: '1778', name: 'ATC Express', source: 'both', status: 'succeeded', pointCount: 12,
  }]);
  assert.deepEqual(result.payload.legacySelectedServiceKeys, [result.payload.services[0].stableServiceKey]);
  assert.equal('selectedServiceKeys' in result.payload, false);
  assert.equal('defaultServiceKeys' in result.payload, false);
  assert.equal(/authorization|cookie|token/i.test(JSON.stringify(result.payload)), false);
});

test('Seller adapter accepts the live by-location identity shape', async () => {
  const { adapter, importer } = loadModules();
  const entries = sellerEntries();
  const templateEntry = entries[0];
  const response = JSON.parse(templateEntry.response.content.text);
  delete response.provider_templates[0].template_type;
  response.provider_templates[0].weight_type = 2;
  templateEntry.response.content.text = JSON.stringify(response);

  const result = await adapter.buildCapture({
    task: sellerTask(), entries, selectedServiceIds: ['101'], harImporter: importer,
  });

  assert.equal(result.state, 'ready');
  assert.equal(result.payload.services[0].templateType, 'global');
  assert.equal(result.payload.services[0].weightType, 'weight');
  assert.equal(
    result.payload.services[0].stableServiceKey,
    'svc:v2:["1778","atc express premium small to ozon pick-up point","global","weight","no-battery"]',
  );
});

test('Seller adapter serializes captured money as canonical decimal strings', async () => {
  const { adapter, importer } = loadModules();
  const result = await adapter.buildCapture({
    task: sellerTask(), entries: sellerEntries(), selectedServiceIds: [], harImporter: importer,
  });

  const rule = result.payload.services[0].calculationRule;
  assert.deepEqual(plain(rule.conditions.priceRangeCNY), ['0', '0']);
  assert.deepEqual(plain(rule.conditions.priceRangeRUB), ['0', '0']);
  assert.equal(rule.pricing.baseFee, '46.19');
  assert.equal(rule.pricing.stepFee, '10');
});

test('Seller adapter keeps the retired v1 endpoint batch compatible with legacy tasks', async () => {
  const { adapter, importer } = loadModules();
  const result = await adapter.buildCapture({
    task: sellerTask({
      version: 'logistics-capture-task/v1',
      expectedEndpoints: legacyExpectedEndpoints,
    }),
    entries: sellerEntries(),
    selectedServiceIds: ['101'],
    harImporter: importer,
  });

  assert.equal(result.state, 'ready');
  assert.deepEqual(plain(result.payload.endpointBatch), {
    expected: legacyExpectedEndpoints,
    attempted: legacyExpectedEndpoints,
    succeeded: legacyExpectedEndpoints,
    failed: [],
    empty: [],
  });
});

test('Seller adapter reads current by-location responses with provider_templates nested in result', async () => {
  const { adapter, importer } = loadModules();
  const entries = sellerEntries();
  const direct = JSON.parse(entries[0].response.content.text);
  entries[0].response.content.text = JSON.stringify({ result: direct });

  const result = await adapter.buildCapture({
    task: sellerTask(), entries, selectedServiceIds: ['101'], harImporter: importer,
  });

  assert.equal(result.state, 'ready');
  assert.equal(result.payload.services.length, 1);
});

test('Seller adapter accepts sanitized current method provenance', async () => {
  const { adapter, importer } = loadModules();
  const entries = sellerEntries();
  const inventory = JSON.parse(entries.at(-1).response.content.text);
  inventory.providers[0].source = 'method';
  entries.at(-1).response.content.text = JSON.stringify(inventory);

  const result = await adapter.buildCapture({
    task: sellerTask(), entries, selectedServiceIds: ['101'], harImporter: importer,
  });

  assert.equal(result.state, 'ready');
  assert.equal(result.payload.providerRows[0].source, 'method');
});

test('Seller adapter waits for matching company and every expected endpoint', async () => {
  const { adapter, importer } = loadModules();
  const mismatched = await adapter.buildCapture({
    task: sellerTask(), entries: sellerEntries('other-company'), selectedServiceIds: ['101'],
    harImporter: importer,
  });
  const incomplete = await adapter.buildCapture({
    task: sellerTask(), entries: sellerEntries().slice(0, 2), selectedServiceIds: ['101'],
    harImporter: importer,
  });
  const maliciousEntries = sellerEntries();
  maliciousEntries[0].request.url = 'https://evil.example/provider/template/by-location/list';
  const malicious = await adapter.buildCapture({
    task: sellerTask(), entries: maliciousEntries, selectedServiceIds: ['101'],
    harImporter: importer,
  });
  assert.equal(mismatched.reason, 'seller_scope_mismatch');
  assert.deepEqual(incomplete.missingEndpoints, ['seller/provider-inventory']);
  assert.equal(malicious.missingEndpoints.includes('seller/template/by-location'), true);
});

test('Seller adapter quarantines category and speed entries captured from another company', async () => {
  const { adapter, importer } = loadModules();
  const entries = sellerEntries();
  for (const entry of entries.slice(1, 3)) {
    entry.request.headers = [{ name: 'x-o3-company-id', value: 'company-b' }];
  }

  const result = await adapter.buildCapture({
    task: sellerTask({
      version: 'logistics-capture-task/v1',
      expectedEndpoints: legacyExpectedEndpoints,
    }),
    entries,
    selectedServiceIds: ['101'],
    harImporter: importer,
  });

  assert.equal(result.state, 'waiting');
  assert.equal(result.reason, 'seller_scope_mismatch');
  assert.deepEqual(result.missingEndpoints, [
    'seller/category/list',
    'seller/delivery-speed',
  ]);
});

test('Seller adapter rejects provider inventory captured for another warehouse point', async () => {
  const { adapter, importer } = loadModules();
  const entries = sellerEntries();
  entries.at(-1).request.postData.text = JSON.stringify({
    companyId: 'company-a',
    point: { latitude: 31.230416, longitude: 121.473701 },
  });

  const result = await adapter.buildCapture({
    task: sellerTask(), entries, selectedServiceIds: ['101'], harImporter: importer,
  });

  assert.equal(result.state, 'waiting');
  assert.ok(result.missingEndpoints.includes('seller/provider-inventory'));
  assert.deepEqual(plain(result.collectionContext), {
    companyId: 'company-a',
    point: { latitude: 24.480107, longitude: 118.085348 },
  });
});

test('Seller adapter rejects null and empty-string point coordinates', async () => {
  const { adapter, importer } = loadModules();
  for (const point of [null, { latitude: '', longitude: '' }]) {
    const entries = sellerEntries();
    const templateRequest = JSON.parse(entries[0].request.postData.text);
    templateRequest.point = point;
    entries[0].request.postData.text = JSON.stringify(templateRequest);
    const inventoryRequest = JSON.parse(entries.at(-1).request.postData.text);
    inventoryRequest.point = point;
    entries.at(-1).request.postData.text = JSON.stringify(inventoryRequest);

    const result = await adapter.buildCapture({
      task: sellerTask(), entries, selectedServiceIds: ['101'], harImporter: importer,
    });

    assert.equal(result.state, 'waiting');
    assert.ok(
      result.missingEndpoints.includes('seller/provider-inventory'),
      'non-number inventory point must not match the Seller point',
    );
  }
});

test('Seller capture keeps all services and failed provider diagnostics without a local selection', async () => {
  const { adapter, importer } = loadModules();
  const entries = sellerEntries();
  const templates = JSON.parse(entries[0].response.content.text);
  delete templates.provider_templates[0].has_battery;
  entries[0].response.content.text = JSON.stringify(templates);
  const inventory = JSON.parse(entries.at(-1).response.content.text);
  inventory.providers[0].status = 'failed';
  inventory.providers[0].pointCount = 0;
  inventory.providerStats.succeeded = 0;
  inventory.providerStats.failed = 1;
  inventory.providerStats.complete = false;
  inventory.providerStats.catalogComplete = false;
  entries.at(-1).response.content.text = JSON.stringify(inventory);

  const result = await adapter.buildCapture({
    task: sellerTask(), entries, selectedServiceIds: [], harImporter: importer,
  });

  assert.equal(result.state, 'ready');
  assert.equal(result.payload.services.length, 1);
  assert.equal(result.payload.services[0].batteryMode, 'unspecified');
  assert.match(result.payload.services[0].stableServiceKey, /,"unspecified"\]$/);
  assert.equal(result.payload.providerRows[0].status, 'failed');
  assert.deepEqual(result.payload.legacySelectedServiceKeys, []);
});

test('Seller adapter keeps optional method-binding incompleteness reviewable', async () => {
  const { adapter, importer } = loadModules();
  const entries = sellerEntries();
  const inventory = JSON.parse(entries.at(-1).response.content.text);
  inventory.providerStats.methodBindingsComplete = false;
  inventory.providerStats.methodBindingsRequired = false;
  inventory.providerStats.complete = true;
  entries.at(-1).response.content.text = JSON.stringify(inventory);

  const result = await adapter.buildCapture({
    task: sellerTask(), entries, selectedServiceIds: [], harImporter: importer,
  });

  assert.equal(result.state, 'ready');
  assert.deepEqual(plain(result.payload.providerStats), {
    discovered: 1, attempted: 1, succeeded: 1, failed: 0, empty: 0,
    catalogComplete: true, methodBindingsComplete: false,
    methodBindingsRequired: false, complete: true,
  });
});

test('Seller adapter waits when required method bindings are incomplete', async () => {
  const { adapter, importer } = loadModules();
  const entries = sellerEntries();
  const inventory = JSON.parse(entries.at(-1).response.content.text);
  inventory.providerStats.methodBindingsComplete = false;
  inventory.providerStats.methodBindingsRequired = true;
  inventory.providerStats.complete = false;
  entries.at(-1).response.content.text = JSON.stringify(inventory);

  const result = await adapter.buildCapture({
    task: sellerTask(), entries, selectedServiceIds: [], harImporter: importer,
  });

  assert.equal(result.state, 'waiting');
  assert.equal(result.reason, 'provider_inventory_incomplete');
  assert.deepEqual(plain(result.providerStats), {
    discovered: 1, attempted: 1, succeeded: 1, failed: 0, empty: 0,
    catalogComplete: true, methodBindingsComplete: false,
    methodBindingsRequired: true, complete: false,
  });
});

test('Official adapter selects only the exact fingerprint and retains full tariff identity', async () => {
  const { adapter, importer } = loadModules();
  const result = await adapter.buildCapture({
    task: officialTask(), entries: [officialEntry()], selectedServiceIds: [],
    harImporter: importer,
  });
  const mismatch = await adapter.buildCapture({
    task: officialTask(), entries: [officialEntry({ cityUid: 'shanghai' })],
    selectedServiceIds: [], harImporter: importer,
  });
  assert.equal(result.state, 'ready');
  assert.deepEqual(plain(result.payload.fingerprint), {
    originCountryUid: 'china',
    originCityUid: 'xiamen',
    destinationCountryUid: 'russia',
    destinationLocationUid: 'moscow',
    currency: 'CNY', declaredPriceMinor: '300000', weightGrams: '498',
    dimensionsMm: { length: '180', width: '160', height: '90' },
  });
  assert.deepEqual(plain(result.payload.quotes[0]), {
    stableServiceKey: 'svc:v2:["1778","atc express premium small to ozon pick-up point","global","weight","no-battery"]',
    providerId: '1778',
    normalizedDescription: 'atc express premium small to ozon pick-up point',
    templateType: 'global', weightType: 'weight', batteryMode: 'no-battery',
    deliveryVariant: 'pickup', priceMinor: '4619', currency: 'CNY', isDropOff: true,
    clusterDeliverySpeeds: [{ min: 12, max: 19, clusterName: 'Moscow' }],
    deliverySpeed: 12, rating: 4.8,
  });
  assert.equal(mismatch.reason, 'official_fingerprint_mismatch');
});

test('Official adapter projects battery mode into observed fingerprint evidence', async () => {
  const { adapter, importer } = loadModules();
  const base = officialTask();
  const task = officialTask({
    officialFingerprint: { ...base.officialFingerprint, batteryMode: 'CONTAINS_BATTERY' },
  });
  const result = await adapter.buildCapture({
    task, entries: [officialEntry({ hasBattery: true })], selectedServiceIds: [], harImporter: importer,
  });
  const expected = { ...task.officialFingerprint, batteryInput: true };
  delete expected.batteryMode;
  assert.deepEqual(plain(result.payload.fingerprint), expected);
});
