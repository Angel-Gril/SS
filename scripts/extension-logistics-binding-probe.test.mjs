import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const adapterPath = 'extensions/ss-erp/shared/logistics-rules/binding-probe-adapter.js';
const runtimePath = 'extensions/ss-erp/shared/logistics-rules/binding-probe-runtime.js';
const collectorPath = 'extensions/ss-erp/shared/logistics-rules/binding-probe-collector.js';

function plain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function loadAdapter() {
  const context = { Array, Boolean, Date, JSON, Number, Object, Set, String, TypeError, URL };
  context.globalThis = context;
  context.self = context;
  vm.runInNewContext(fs.readFileSync(adapterPath, 'utf8'), context, {
    filename: 'binding-probe-adapter.js',
  });
  return context.SS_ERP_LOGISTICS_BINDING_PROBE_ADAPTER;
}

function probe() {
  return {
    probeId: 'probe-a',
    claimToken: 'claim.' + 'x'.repeat(40),
    issuedAt: '2026-07-13T01:00:00.000Z',
    expiresAt: '2026-07-13T01:10:00.000Z',
    expected: {
      deploymentId: 'domestic-production',
      tenantId: 'owner-a',
      shopId: 'shop-a',
      warehouse: { id: 'warehouse-a', platformWarehouseId: 'ozon-warehouse-11' },
      deliveryMethod: { id: 'method-a', platformMethodId: 22 },
    },
  };
}

function warehouseEntry(options = {}) {
  const companyId = options.companyId || 'ozon-company-4494016';
  const warehouseId = options.warehouseId || 'ozon-warehouse-11';
  const methodId = options.methodId == null ? 22 : options.methodId;
  return {
    startedDateTime: '2026-07-13T01:02:00.000Z',
    request: {
      method: 'POST',
      url: 'https://seller.ozon.ru/api/site/logistic-service/v5/facade/warehouse/list',
      headers: [
        { name: 'x-o3-company-id', value: companyId },
        { name: 'authorization', value: 'Bearer must-never-leave-browser' },
      ],
      postData: { text: JSON.stringify({ company_id: companyId, cookie: 'cookie-secret' }) },
    },
    response: {
      status: 200,
      content: {
        text: JSON.stringify({
          result: {
            warehouses: [{
              id: warehouseId,
              name: 'Sensitive warehouse label',
              deliveryMethods: [{
                id: methodId,
                name: 'Sensitive method label',
                formula: 'must-not-upload',
              }],
            }],
          },
          apiKey: 'response-secret',
        }),
      },
    },
    _ozonCalc: { mode: 'seller-binding-probe', capturedAt: '2026-07-13T01:02:00.000Z' },
  };
}

function response(status, body) {
  const serialized = JSON.stringify(body);
  return {
    status,
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'content-length'
          ? String(Buffer.byteLength(serialized)) : null;
      },
    },
    async json() { return body; },
    async text() { return serialized; },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function runtimeProbe(overrides = {}) {
  const base = probe();
  return {
    probeId: base.probeId,
    bootstrapId: 'bootstrap-a',
    status: 'ISSUED',
    claimToken: base.claimToken,
    expiresAt: base.expiresAt,
    expected: base.expected,
    ...overrides,
  };
}

function loadRuntime(options = {}) {
  const context = {
    Array, Boolean, Date, Error, JSON, Math, Number, Object, Promise, Set, String,
    TypeError, URL,
  };
  context.globalThis = context;
  context.self = context;
  vm.runInNewContext(fs.readFileSync(adapterPath, 'utf8'), context, {
    filename: 'binding-probe-adapter.js',
  });
  vm.runInNewContext(fs.readFileSync(runtimePath, 'utf8'), context, {
    filename: 'binding-probe-runtime.js',
  });
  return context.SS_ERP_LOGISTICS_BINDING_PROBE_RUNTIME.createRuntime(options);
}

function createRuntimeHarness(options = {}) {
  const requests = [];
  const statuses = [];
  const clears = [];
  const pending = options.probe || runtimeProbe();
  let credentialEpoch = 1;
  let identity = options.deviceStatus || {
    state: 'paired', sessionId: 'session-a', deploymentId: 'domestic-production',
    ownerUserId: 'owner-a', scopes: ['logistics:capture'],
  };
  const credentials = {
    async getStatus() { return plain(identity); },
    async getConnection() {
      return {
        baseUrl: 'https://erp.example', sessionId: identity.sessionId,
        deploymentId: identity.deploymentId, ownerUserId: identity.ownerUserId,
        deviceId: identity.deviceId || 'device-a',
      };
    },
    async getAccessToken() { return 'device-access-secret-' + identity.sessionId; },
    async beginOperation() {
      const connection = await this.getConnection();
      return {
        epoch: credentialEpoch,
        sessionId: identity.sessionId,
        deploymentId: identity.deploymentId,
        ownerUserId: identity.ownerUserId,
        scopes: identity.scopes.slice(),
        baseUrl: connection.baseUrl,
        accessToken: await this.getAccessToken(),
      };
    },
    async isOperationCurrent(operation) {
      return Boolean(operation)
        && operation.epoch === credentialEpoch
        && operation.sessionId === identity.sessionId
        && operation.deploymentId === identity.deploymentId
        && operation.ownerUserId === identity.ownerUserId;
    },
    async clearIfCurrent(operation, input) {
      if (!await this.isOperationCurrent(operation)) return false;
      clears.push(plain(input));
      credentialEpoch += 1;
      identity = { state: 'unpaired', scopes: [] };
      return true;
    },
    async clear(input) {
      clears.push(plain(input));
      credentialEpoch += 1;
      identity = { state: 'unpaired', scopes: [] };
    },
  };
  function switchSession(next = {}) {
    credentialEpoch += 1;
    identity = {
      state: 'paired', sessionId: next.sessionId || 'session-b',
      deploymentId: next.deploymentId || 'domestic-production',
      ownerUserId: next.ownerUserId || 'owner-b',
      scopes: next.scopes || ['logistics:capture'],
    };
  }
  const runtime = loadRuntime({
    credentials,
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      if (typeof options.fetchImpl === 'function') {
        return options.fetchImpl(url, init, requests.length);
      }
      if (url.endsWith('/binding-probes/pending')) {
        return response(200, { code: 1, data: { probes: [pending] } });
      }
      if (url.endsWith('/binding-probes/probe-a/claim')) {
        return response(200, {
          code: 1, data: { probeId: 'probe-a', status: 'CLAIMED', duplicate: false },
        });
      }
      if (url.endsWith('/binding-probes/probe-a/submit')) {
        return response(201, {
          code: 1, data: { probeId: 'probe-a', status: 'SUBMITTED', duplicate: false },
        });
      }
      throw new Error('unexpected request ' + url);
    },
    readCurrentCompanyId: async () => options.currentCompanyId || 'ozon-company-4494016',
    readCapturedEntries: async () => options.entries || [warehouseEntry()],
    collectEvidence: options.collectEvidence || (async (probes) => ({
      state: 'ready',
      matches: probes.slice(0, 1).map((item) => ({
        probeId: item.probeId,
        evidence: {
          companyId: 'ozon-company-4494016',
          warehouse: { platformWarehouseId: item.expected.warehouse.platformWarehouseId },
          deliveryMethod: { platformMethodId: item.expected.deliveryMethod.platformMethodId },
        },
      })),
    })),
    writeStatus: async (value) => { statuses.push(plain(value)); },
    readStatus: async () => statuses.at(-1) || { state: 'idle' },
    now: () => new Date(options.now || '2026-07-13T01:02:00.000Z'),
  });
  return { runtime, requests, statuses, clears, credentials, switchSession };
}

test('binding probe adapter is available as an isolated extension module', () => {
  assert.equal(fs.existsSync(adapterPath), true);
});

test('adapter emits only current Seller company and expected warehouse/method IDs', () => {
  const adapter = loadAdapter();
  const result = adapter.buildEvidence({
    probe: probe(),
    observedEvidence: {
      companyId: 'ozon-company-4494016',
      warehouse: { platformWarehouseId: 'ozon-warehouse-11' },
      deliveryMethod: { platformMethodId: 22 },
    },
  });

  assert.deepEqual(plain(result), {
    state: 'ready',
    evidence: {
      companyId: 'ozon-company-4494016',
      warehouse: { platformWarehouseId: 'ozon-warehouse-11' },
      deliveryMethod: { platformMethodId: 22 },
    },
  });
  const serialized = JSON.stringify(result);
  for (const forbidden of [
    'authorization', 'Bearer', 'cookie', 'formula', 'apiKey',
    'Sensitive warehouse label', 'Sensitive method label', 'response-secret',
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden + ' must be omitted');
  }
});

test('adapter rejects observations that do not exactly match the issued warehouse or method', () => {
  const adapter = loadAdapter();
  const methodMismatch = adapter.buildEvidence({
    probe: probe(),
    observedEvidence: {
      companyId: 'ozon-company-4494016',
      warehouse: { platformWarehouseId: 'ozon-warehouse-11' },
      deliveryMethod: { platformMethodId: 37 },
    },
  });

  assert.deepEqual(plain(methodMismatch), {
    state: 'waiting', reason: 'warehouse_method_not_observed',
  });
});

test('adapter has no raw request or response parsing path', () => {
  const source = fs.readFileSync(adapterPath, 'utf8');
  for (const forbidden of ['request.headers', 'request.postData', 'response.content']) {
    assert.equal(source.includes(forbidden), false, forbidden + ' must stay outside the adapter');
  }
});


test('adapter rejects non-numeric or non-positive delivery method IDs', () => {
  const adapter = loadAdapter();
  for (const value of ['22', 0, -1, Number.MAX_SAFE_INTEGER + 1]) {
    const invalid = probe();
    invalid.expected.deliveryMethod.platformMethodId = value;
    assert.throws(() => adapter.buildEvidence({
      probe: invalid,
      observedEvidence: {
        companyId: 'ozon-company-4494016',
        warehouse: { platformWarehouseId: 'ozon-warehouse-11' },
        deliveryMethod: { platformMethodId: 22 },
      },
    }), /expected IDs/);
  }
});
test('forged page warehouse/list messages are outside the captured HAR allowlist', () => {
  const context = { console, Date, JSON, URL };
  context.globalThis = context;
  vm.runInNewContext(
    fs.readFileSync('extensions/ss-erp/shared/capture-bridge/captured-har-store.js', 'utf8'),
    context,
    { filename: 'captured-har-store.js' },
  );
  const store = context.OZON_CALC_CAPTURE_STORE;
  const request = { method: 'POST' };
  const pageUrl = 'https://seller.ozon.ru/app/settings/warehouses';

  assert.equal(store.detectSupportedEndpoint(
    'https://seller.ozon.ru/api/site/logistic-service/v5/facade/warehouse/list',
    request,
    pageUrl,
  ), null);
  assert.equal(store.detectSupportedEndpoint(
    'https://seller.ozon.ru/api/site/logistic-service/v2/warehouse/list',
    request,
    pageUrl,
  ), null);
  assert.equal(store.detectSupportedEndpoint(
    'https://seller.ozon.ru/api/posting-service/seller-ui/delivery-method/list',
    request,
    pageUrl,
  ), null);
  assert.equal(store.detectSupportedEndpoint(
    'https://evil.example/api/site/logistic-service/v5/facade/warehouse/list',
    request,
    pageUrl,
  ), null);
  assert.equal(store.detectSupportedEndpoint(
    'https://seller.ozon.ru/api/site/logistic-service/v5/facade/warehouse/list/other',
    request,
    pageUrl,
  ), null);
});

test('credential-bearing warehouse/list fixtures never enter storage or Seller HAR export', () => {
  const context = { console, Date, JSON, URL };
  context.globalThis = context;
  vm.runInNewContext(
    fs.readFileSync('extensions/ss-erp/shared/capture-bridge/captured-har-store.js', 'utf8'),
    context,
    { filename: 'captured-har-store.js' },
  );
  const store = context.OZON_CALC_CAPTURE_STORE;
  const normalized = store.normalizeCapturedEntry(warehouseEntry());

  assert.equal(normalized, null);
  assert.equal(store.buildHarPayload([warehouseEntry()], 'seller').log.entries.length, 0);
});

test('main-world page hook cannot capture warehouse/list for binding attestation', () => {
  const source = fs.readFileSync('extensions/ss-erp/content/capture-page-hook.js', 'utf8');
  assert.doesNotMatch(source, /\/api\/site\/logistic-service\/v5\/facade\/warehouse\/list/);
  assert.doesNotMatch(source, /\/api\/site\/logistic-service\/v2\/warehouse\/list/);
  assert.doesNotMatch(source, /\/api\/posting-service\/seller-ui\/delivery-method\/list/);
  assert.doesNotMatch(source, /SAFE_HEADER_NAMES\s*=\s*\[[\s\S]{0,500}['\"]authorization['\"]/i);
  assert.doesNotMatch(source, /SAFE_HEADER_NAMES\s*=\s*\[[\s\S]{0,500}['\"]cookie['\"]/i);
});

test('isolated collector immediately projects warehouse response to minimal probe matches', async () => {
  assert.equal(fs.existsSync(collectorPath), true);
  const requests = [];
  const context = {
    Array, Boolean, Date, Error, JSON, Number, Object, Promise, Set, String,
    TextDecoder, TextEncoder, TypeError, Uint8Array, URL,
    async fetch(url, init) {
      requests.push({ url, init });
      if (url.endsWith('/api/site/logistic-service/v2/warehouse/list')) {
        return response(200, {
          result: [{
            warehouse_id: 'ozon-warehouse-11',
            name: 'must-not-return',
          }],
        });
      }
      return response(200, {
        cursor: '',
        delivery_methods: [{
          warehouse_id: 'ozon-warehouse-11', delivery_method_id: 22,
          delivery_method: 'method-secret', formula: 'formula-secret',
        }],
        authorization: 'Bearer response-secret',
        cookie: 'cookie-secret',
      });
    },
  };
  context.globalThis = context;
  context.self = context;
  vm.runInNewContext(fs.readFileSync(collectorPath, 'utf8'), context, {
    filename: 'binding-probe-collector.js',
  });
  const collector = context.SS_ERP_LOGISTICS_BINDING_PROBE_COLLECTOR;
  const missing = runtimeProbe({ probeId: 'probe-missing' });
  missing.expected = {
    ...missing.expected,
    deliveryMethod: { ...missing.expected.deliveryMethod, platformMethodId: 37 },
  };
  const result = await collector.collectWarehouseEvidence({
    companyId: '4494016',
    probes: [runtimeProbe(), missing],
  });

  assert.equal(requests.length, 3);
  assert.equal(requests[0].url, 'https://seller.ozon.ru/api/site/logistic-service/v2/warehouse/list');
  assert.equal(requests[1].url,
    'https://seller.ozon.ru/api/posting-service/seller-ui/delivery-method/list');
  assert.equal(requests[2].url,
    'https://seller.ozon.ru/api/posting-service/seller-ui/delivery-method/list');
  assert.equal(requests[0].init.credentials, 'include');
  assert.equal(requests[0].init.headers['x-o3-company-id'], '4494016');
  assert.deepEqual(JSON.parse(requests[0].init.body), { company_id: 4494016 });
  assert.deepEqual(plain(result), {
    state: 'ready',
    matches: [{
      probeId: 'probe-a',
      evidence: {
        companyId: '4494016',
        warehouse: { platformWarehouseId: 'ozon-warehouse-11' },
        deliveryMethod: { platformMethodId: 22 },
      },
    }],
  });
  assert.doesNotMatch(JSON.stringify(result), /authorization|Bearer|cookie|formula|must-not-return|method-secret/i);
});
test('isolated collector validates the current v2 warehouse and paginated posting delivery-method pair', async () => {
  const requests = [];
  const context = {
    Array, Boolean, Date, Error, JSON, Number, Object, Promise, Set, String,
    TextDecoder, TextEncoder, TypeError, Uint8Array, URL,
    async fetch(url, init) {
      requests.push({ url, init });
      if (url.endsWith('/api/site/logistic-service/v2/warehouse/list')) {
        return response(200, {
          result: [{ warehouse_id: 'ozon-warehouse-11', name: 'must-not-return' }],
          new_carriage_label_picker_enabled: true,
        });
      }
      if (!url.endsWith('/api/posting-service/seller-ui/delivery-method/list')) {
        throw new Error('unexpected request ' + url);
      }
      const body = JSON.parse(init.body);
      if (body.delivery_method_statuses.includes('disabled')) {
        return response(200, {
          cursor: '',
          delivery_methods: [{
            warehouse_id: 'ozon-warehouse-11', delivery_method_id: 22,
            delivery_method: 'matching-method-secret',
          }],
        });
      }
      if (!body.cursor) {
        return response(200, {
          cursor: 'cursor-2',
          delivery_methods: [{
            warehouse_id: 'ozon-warehouse-11', delivery_method_id: 37,
            delivery_method: 'wrong-method-secret',
          }],
        });
      }
      return response(200, {
        cursor: '',
        delivery_methods: [{
          warehouse_id: 'ozon-warehouse-11', delivery_method_id: 38,
          delivery_method: 'second-wrong-method-secret',
        }],
      });
    },
  };
  context.globalThis = context;
  context.self = context;
  vm.runInNewContext(fs.readFileSync(collectorPath, 'utf8'), context, {
    filename: 'binding-probe-collector.js',
  });

  const result = await context.SS_ERP_LOGISTICS_BINDING_PROBE_COLLECTOR.collectWarehouseEvidence({
    companyId: '4494016',
    probes: [runtimeProbe()],
  });

  assert.equal(requests.length, 4);
  assert.equal(requests[0].url,
    'https://seller.ozon.ru/api/site/logistic-service/v2/warehouse/list');
  assert.deepEqual(JSON.parse(requests[0].init.body), { company_id: 4494016 });
  for (const request of requests.slice(1)) {
    assert.equal(request.url,
      'https://seller.ozon.ru/api/posting-service/seller-ui/delivery-method/list');
    assert.equal(request.init.headers['x-o3-page-type'], 'CbPostingsFbs');
    const body = JSON.parse(request.init.body);
    assert.equal(body.company_id, 4494016);
    assert.equal(body.limit, 20);
    assert.deepEqual(body.status_alias, ['awaiting_packaging']);
    assert.match(body.processed_at_from, /T00:00:00\.000Z$/);
    assert.match(body.processed_at_to, /T23:59:59\.999Z$/);
  }
  assert.deepEqual(JSON.parse(requests[1].init.body).delivery_method_statuses, ['active']);
  assert.deepEqual(JSON.parse(requests[2].init.body).delivery_method_statuses, ['active']);
  assert.deepEqual(JSON.parse(requests[3].init.body).delivery_method_statuses, ['disabled', 'new']);
  assert.equal(JSON.parse(requests[1].init.body).cursor, undefined);
  assert.equal(JSON.parse(requests[2].init.body).cursor, 'cursor-2');
  assert.equal(JSON.parse(requests[3].init.body).cursor, undefined);
  assert.deepEqual(plain(result), {
    state: 'ready',
    matches: [{
      probeId: 'probe-a',
      evidence: {
        companyId: '4494016',
        warehouse: { platformWarehouseId: 'ozon-warehouse-11' },
        deliveryMethod: { platformMethodId: 22 },
      },
    }],
  });
  assert.doesNotMatch(JSON.stringify(result), /must-not-return|wrong-method-secret|matching-method-secret/);
});

test('isolated collector reports request_failed when current Seller delivery-method lookup fails', async () => {
  const requests = [];
  const context = {
    Array, Boolean, Date, Error, JSON, Number, Object, Promise, Set, String,
    TextDecoder, TextEncoder, TypeError, Uint8Array, URL,
    async fetch(url) {
      requests.push(url);
      if (url.endsWith('/api/site/logistic-service/v2/warehouse/list')) {
        return response(200, { result: [{ warehouse_id: 'ozon-warehouse-11' }] });
      }
      return response(403, { error: { code: 'PermissionDenied', secret: 'must-not-return' } });
    },
  };
  context.globalThis = context;
  context.self = context;
  vm.runInNewContext(fs.readFileSync(collectorPath, 'utf8'), context, {
    filename: 'binding-probe-collector.js',
  });

  const result = await context.SS_ERP_LOGISTICS_BINDING_PROBE_COLLECTOR.collectWarehouseEvidence({
    companyId: '4494016',
    probes: [runtimeProbe()],
  });

  assert.deepEqual(plain(result), { state: 'request_failed', matches: [] });
  assert.equal(requests.length, 2);
  assert.equal(JSON.stringify(result).includes('must-not-return'), false);
});

test('isolated collector rejects an advertised response larger than two MiB before reading it', async () => {
  let textReads = 0;
  const context = {
    Array, Boolean, Date, Error, JSON, Number, Object, Promise, Set, String,
    TextDecoder, TextEncoder, TypeError, Uint8Array, URL,
    async fetch() {
      return {
        status: 200,
        headers: { get: () => String(2 * 1024 * 1024 + 1) },
        async text() { textReads += 1; return '{}'; },
        async json() {
          return {
            result: {
              warehouses: [{
                id: 'ozon-warehouse-11', deliveryMethods: [{ id: 22 }],
              }],
            },
          };
        },
      };
    },
  };
  context.globalThis = context;
  context.self = context;
  vm.runInNewContext(fs.readFileSync(collectorPath, 'utf8'), context, {
    filename: 'binding-probe-collector.js',
  });

  const result = await context.SS_ERP_LOGISTICS_BINDING_PROBE_COLLECTOR.collectWarehouseEvidence({
    companyId: 'ozon-company-4494016',
    probes: [runtimeProbe()],
  });

  assert.deepEqual(plain(result), { state: 'request_failed', matches: [] });
  assert.equal(textReads, 0);
});

test('isolated collector rejects an actually oversized response without returning raw content', async () => {
  const oversized = JSON.stringify({ padding: 'x'.repeat(2 * 1024 * 1024) });
  const context = {
    Array, Boolean, Date, Error, JSON, Number, Object, Promise, Set, String,
    TextDecoder, TextEncoder, TypeError, Uint8Array, URL,
    async fetch() {
      return {
        status: 200,
        headers: { get: () => null },
        async text() { return oversized; },
        async json() { return JSON.parse(oversized); },
      };
    },
  };
  context.globalThis = context;
  context.self = context;
  vm.runInNewContext(fs.readFileSync(collectorPath, 'utf8'), context, {
    filename: 'binding-probe-collector.js',
  });

  const result = await context.SS_ERP_LOGISTICS_BINDING_PROBE_COLLECTOR.collectWarehouseEvidence({
    companyId: 'ozon-company-4494016',
    probes: [runtimeProbe()],
  });

  assert.deepEqual(plain(result), { state: 'request_failed', matches: [] });
  assert.equal(JSON.stringify(result).includes('padding'), false);
});

test('isolated collector cancels a chunked response after cumulative bytes exceed two MiB', async () => {
  const valid = JSON.stringify({
    result: {
      warehouses: [{
        id: 'ozon-warehouse-11', deliveryMethods: [{ id: 22 }],
      }],
    },
  });
  const chunks = [new Uint8Array(1_500_000), new Uint8Array(700_000)];
  let chunkIndex = 0;
  let cancelled = false;
  const context = {
    Array, Boolean, Date, Error, JSON, Number, Object, Promise, Set, String,
    TextDecoder, TextEncoder, TypeError, Uint8Array, URL,
    async fetch() {
      return {
        status: 200,
        headers: { get: () => null },
        body: {
          getReader() {
            return {
              async read() {
                if (chunkIndex >= chunks.length) return { done: true };
                return { done: false, value: chunks[chunkIndex++] };
              },
              async cancel() { cancelled = true; },
            };
          },
        },
        async text() { return valid; },
      };
    },
  };
  context.globalThis = context;
  context.self = context;
  vm.runInNewContext(fs.readFileSync(collectorPath, 'utf8'), context, {
    filename: 'binding-probe-collector.js',
  });

  const result = await context.SS_ERP_LOGISTICS_BINDING_PROBE_COLLECTOR.collectWarehouseEvidence({
    companyId: 'ozon-company-4494016',
    probes: [runtimeProbe()],
  });

  assert.deepEqual(plain(result), { state: 'request_failed', matches: [] });
  assert.equal(cancelled, true);
});

test('isolated collector enforces the fallback limit in UTF-8 bytes for multibyte text', async () => {
  const multibyte = JSON.stringify({ padding: '中'.repeat(700_000) });
  assert.equal(multibyte.length < 2 * 1024 * 1024, true);
  assert.equal(new TextEncoder().encode(multibyte).byteLength > 2 * 1024 * 1024, true);
  const context = {
    Array, Boolean, Date, Error, JSON, Number, Object, Promise, Set, String,
    TextDecoder, TextEncoder, TypeError, Uint8Array, URL,
    async fetch() {
      return {
        status: 200,
        headers: { get: () => null },
        async text() { return multibyte; },
      };
    },
  };
  context.globalThis = context;
  context.self = context;
  vm.runInNewContext(fs.readFileSync(collectorPath, 'utf8'), context, {
    filename: 'binding-probe-collector.js',
  });

  const result = await context.SS_ERP_LOGISTICS_BINDING_PROBE_COLLECTOR.collectWarehouseEvidence({
    companyId: 'ozon-company-4494016',
    probes: [runtimeProbe()],
  });

  assert.deepEqual(plain(result), { state: 'request_failed', matches: [] });
});

test('binding probe runtime is available as an isolated extension module', () => {
  assert.equal(fs.existsSync(runtimePath), true);
});

test('runtime discovers, claims, and submits a minimal paired-device probe', async () => {
  const { runtime, requests, statuses } = createRuntimeHarness();
  const result = await runtime.run({ extensionVersion: '1.0.127' });

  assert.deepEqual(plain(result), {
    state: 'submitted', probeId: 'probe-a', duplicate: false,
    updatedAt: '2026-07-13T01:02:00.000Z',
  });
  assert.equal(requests.length, 3);
  assert.equal(requests[0].url, 'https://erp.example/api/logistics-rules/binding-probes/pending');
  assert.equal(requests[1].url, 'https://erp.example/api/logistics-rules/binding-probes/probe-a/claim');
  assert.equal(requests[2].url, 'https://erp.example/api/logistics-rules/binding-probes/probe-a/submit');
  assert.equal(requests.every(
    (item) => item.init.headers.Authorization === 'Bearer device-access-secret-session-a',
  ), true);
  assert.deepEqual(JSON.parse(requests[1].init.body), {
    claimToken: runtimeProbe().claimToken,
  });
  assert.deepEqual(JSON.parse(requests[2].init.body), {
    claimToken: runtimeProbe().claimToken,
    evidence: {
      companyId: 'ozon-company-4494016',
      warehouse: { platformWarehouseId: 'ozon-warehouse-11' },
      deliveryMethod: { platformMethodId: 22 },
    },
  });
  const publicState = JSON.stringify({ result, statuses });
  assert.equal(publicState.includes(runtimeProbe().claimToken), false);
  assert.equal(publicState.includes('device-access-secret'), false);
  assert.equal(publicState.includes('response-secret'), false);
});


test('runtime filters every pending probe and claims only the unique exact match', async () => {
  const wrong = runtimeProbe({
    probeId: 'probe-wrong-scope', claimToken: 'claim.' + 'w'.repeat(40),
    expected: { ...runtimeProbe().expected, deploymentId: 'foreign-production' },
  });
  const expired = runtimeProbe({
    probeId: 'probe-expired', claimToken: 'claim.' + 'e'.repeat(40),
    expiresAt: '2026-07-13T00:59:00.000Z',
  });
  const missing = runtimeProbe({
    probeId: 'probe-missing', claimToken: 'claim.' + 'm'.repeat(40),
    expected: {
      ...runtimeProbe().expected,
      deliveryMethod: { ...runtimeProbe().expected.deliveryMethod, platformMethodId: 37 },
    },
  });
  const exact = runtimeProbe({
    probeId: 'probe-exact', claimToken: 'claim.' + 'x'.repeat(42),
  });
  const harness = createRuntimeHarness({
    collectEvidence: async (probes) => {
      assert.deepEqual(plain(probes.map((item) => item.probeId)), ['probe-missing', 'probe-exact']);
      return {
        state: 'ready',
        matches: [{
          probeId: 'probe-exact',
          evidence: {
            companyId: 'ozon-company-4494016',
            warehouse: { platformWarehouseId: 'ozon-warehouse-11' },
            deliveryMethod: { platformMethodId: 22 },
          },
        }],
      };
    },
    fetchImpl: async (url) => {
      if (url.endsWith('/pending')) {
        return response(200, { code: 1, data: { probes: [wrong, expired, missing, exact] } });
      }
      if (url.endsWith('/probe-exact/claim')) {
        return response(200, {
          code: 1, data: { probeId: 'probe-exact', status: 'CLAIMED', duplicate: false },
        });
      }
      if (url.endsWith('/probe-exact/submit')) {
        return response(201, {
          code: 1, data: { probeId: 'probe-exact', status: 'SUBMITTED', duplicate: false },
        });
      }
      throw new Error('unexpected request ' + url);
    },
  });

  assert.deepEqual(plain(await harness.runtime.run({ extensionVersion: '1.0.127' })), {
    state: 'submitted', probeId: 'probe-exact', duplicate: false,
    updatedAt: '2026-07-13T01:02:00.000Z',
  });
  assert.equal(harness.requests.length, 3);
});

test('runtime refuses to claim when more than one pending probe exactly matches', async () => {
  const second = runtimeProbe({
    probeId: 'probe-b', claimToken: 'claim.' + 'b'.repeat(40),
  });
  const harness = createRuntimeHarness({
    collectEvidence: async () => ({
      state: 'ready',
      matches: [runtimeProbe(), second].map((item) => ({
        probeId: item.probeId,
        evidence: {
          companyId: 'ozon-company-4494016',
          warehouse: { platformWarehouseId: 'ozon-warehouse-11' },
          deliveryMethod: { platformMethodId: 22 },
        },
      })),
    }),
    fetchImpl: async (url) => {
      assert.equal(url.endsWith('/pending'), true);
      return response(200, { code: 1, data: { probes: [runtimeProbe(), second] } });
    },
  });

  assert.deepEqual(plain(await harness.runtime.run({ extensionVersion: '1.0.127' })), {
    state: 'ambiguous', reason: 'multiple_exact_matches',
    updatedAt: '2026-07-13T01:02:00.000Z',
  });
  assert.equal(harness.requests.length, 1);
});
test('runtime waits without claiming until exact warehouse evidence exists', async () => {
  const { runtime, requests, statuses } = createRuntimeHarness({
    collectEvidence: async () => ({ state: 'ready', matches: [] }),
  });
  const result = await runtime.run({ extensionVersion: '1.0.127' });

  assert.deepEqual(plain(result), {
    state: 'pending', reason: 'warehouse_method_not_observed',
    updatedAt: '2026-07-13T01:02:00.000Z',
  });
  assert.equal(requests.length, 1);
  assert.equal(statuses.at(-1).state, 'pending');
});

test('runtime reports Seller request failure as retryable instead of pending', async () => {
  const { runtime, requests, statuses } = createRuntimeHarness({
    collectEvidence: async () => ({ state: 'request_failed', matches: [] }),
  });

  const result = await runtime.run({ extensionVersion: '1.0.127' });

  assert.deepEqual(plain(result), {
    state: 'retryable', reason: 'seller_collection_failed',
    updatedAt: '2026-07-13T01:02:00.000Z',
  });
  assert.equal(requests.length, 1);
  assert.equal(statuses.at(-1).state, 'retryable');
});

test('runtime rejects wrong deployment or expired pending probes before claim', async () => {
  const wrong = createRuntimeHarness({
    probe: runtimeProbe({
      expected: { ...runtimeProbe().expected, deploymentId: 'foreign-production' },
    }),
  });
  const expired = createRuntimeHarness({ now: '2026-07-13T01:11:00.000Z' });

  assert.deepEqual(plain(await wrong.runtime.run({ extensionVersion: '1.0.127' })), {
    state: 'scope_mismatch', probeId: 'probe-a',
    updatedAt: '2026-07-13T01:02:00.000Z',
  });
  assert.deepEqual(plain(await expired.runtime.run({ extensionVersion: '1.0.127' })), {
    state: 'expired', probeId: 'probe-a',
    updatedAt: '2026-07-13T01:11:00.000Z',
  });
  assert.equal(wrong.requests.length, 1);
  assert.equal(expired.requests.length, 1);
});

test('runtime safely persists revoked for 401, 403, and revocation 410 but not probe expiry 410', async () => {
  const revokedRuns = [401, 403, 410].map((status) => createRuntimeHarness({
    fetchImpl: async () => response(status, {
      code: 0, error: { code: 'EXTENSION_DEVICE_SCOPE_REVOKED' },
    }),
  }));
  const expired = createRuntimeHarness({
    fetchImpl: async (url) => {
      if (url.endsWith('/pending')) {
        return response(200, { code: 1, data: { probes: [runtimeProbe()] } });
      }
      return response(410, {
        code: 0, error: { code: 'BINDING_PROBE_EXPIRED' },
      });
    },
  });

  for (const revoked of revokedRuns) {
    assert.equal((await revoked.runtime.run({ extensionVersion: '1.0.127' })).state, 'revoked');
    assert.equal(revoked.clears.length, 1);
    assert.equal(revoked.statuses.at(-1)?.state, 'revoked');
  }
  assert.equal((await expired.runtime.run({ extensionVersion: '1.0.127' })).state, 'expired');
  assert.equal(expired.clears.length, 0);
});


test('account switch starts a new epoch run while stale pending work cannot persist', async () => {
  const oldPendingStarted = deferred();
  const oldPending = deferred();
  const harness = createRuntimeHarness({
    fetchImpl: async (url, init) => {
      assert.equal(url.endsWith('/pending'), true);
      if (init.headers.Authorization.endsWith('session-a')) {
        oldPendingStarted.resolve();
        return oldPending.promise;
      }
      assert.equal(init.headers.Authorization.endsWith('session-b'), true);
      return response(200, { code: 1, data: { probes: [] } });
    },
  });

  const oldRun = harness.runtime.run({ extensionVersion: '1.0.127' });
  await oldPendingStarted.promise;
  harness.switchSession({ sessionId: 'session-b', ownerUserId: 'owner-a' });
  const newRun = harness.runtime.run({ extensionVersion: '1.0.127' });
  const distinctRuns = newRun !== oldRun;
  oldPending.resolve(response(200, { code: 1, data: { probes: [runtimeProbe()] } }));
  const [oldResult, newResult] = await Promise.all([oldRun, newRun]);

  assert.equal(distinctRuns, true);
  assert.deepEqual(plain(oldResult), { state: 'superseded' });
  assert.deepEqual(plain(newResult), {
    state: 'idle', updatedAt: '2026-07-13T01:02:00.000Z',
  });
  assert.deepEqual(harness.statuses, [{
    state: 'idle', updatedAt: '2026-07-13T01:02:00.000Z',
  }]);
  assert.equal(harness.clears.length, 0);
  assert.equal(harness.requests.length, 2);
});

test('re-pair during claim prevents stale submit, status write, and credential clear', async () => {
  const claimStarted = deferred();
  const claimResponse = deferred();
  const harness = createRuntimeHarness({
    fetchImpl: async (url) => {
      if (url.endsWith('/pending')) {
        return response(200, { code: 1, data: { probes: [runtimeProbe()] } });
      }
      if (url.endsWith('/claim')) {
        claimStarted.resolve();
        return claimResponse.promise;
      }
      if (url.endsWith('/submit')) {
        return response(201, {
          code: 1, data: { probeId: 'probe-a', status: 'SUBMITTED', duplicate: false },
        });
      }
      throw new Error('unexpected request ' + url);
    },
  });

  const staleRun = harness.runtime.run({ extensionVersion: '1.0.127' });
  await claimStarted.promise;
  harness.switchSession({ sessionId: 'session-new', ownerUserId: 'owner-a' });
  claimResponse.resolve(response(200, {
    code: 1, data: { probeId: 'probe-a', status: 'CLAIMED', duplicate: false },
  }));

  assert.deepEqual(plain(await staleRun), { state: 'superseded' });
  assert.equal(harness.requests.some((item) => item.url.endsWith('/submit')), false);
  assert.deepEqual(harness.statuses, []);
  assert.deepEqual(harness.clears, []);
  assert.equal(await harness.credentials.isOperationCurrent({
    epoch: 2,
    sessionId: 'session-new',
    deploymentId: 'domestic-production',
    ownerUserId: 'owner-a',
  }), true);
});

test('stale authorization failure cannot clear newly paired credentials', async () => {
  const pendingStarted = deferred();
  const pendingResponse = deferred();
  const harness = createRuntimeHarness({
    fetchImpl: async () => {
      pendingStarted.resolve();
      return pendingResponse.promise;
    },
  });
  const staleRun = harness.runtime.run({ extensionVersion: '1.0.127' });
  await pendingStarted.promise;
  harness.switchSession({ sessionId: 'session-new', ownerUserId: 'owner-a' });
  pendingResponse.resolve(response(410, {
    code: 0, error: { code: 'EXTENSION_DEVICE_SCOPE_REVOKED' },
  }));

  assert.deepEqual(plain(await staleRun), { state: 'superseded' });
  assert.deepEqual(harness.clears, []);
  assert.deepEqual(harness.statuses, []);
});
test('message boundary allows only an explicit trusted settings-page probe', async () => {
  const context = {
    Array, Boolean, Date, Error, JSON, Math, Number, Object, Promise, Set, String,
    TypeError, URL,
  };
  context.globalThis = context;
  context.self = context;
  vm.runInNewContext(fs.readFileSync(runtimePath, 'utf8'), context, {
    filename: 'binding-probe-runtime.js',
  });
  const calls = [];
  const handler = context.SS_ERP_LOGISTICS_BINDING_PROBE_RUNTIME.createMessageHandler({
    runtime: {
      async run(input) { calls.push(plain(input)); return { state: 'submitted' }; },
      async getStatus() { return { state: 'pending' }; },
    },
    extensionId: 'extension-id',
    isTrustedSettingsSender(sender, extensionId) {
      return sender && sender.url === 'chrome-extension://extension-id/pages/settings.html'
        && extensionId === 'extension-id';
    },
  });

  assert.deepEqual(plain(await handler(
    { type: 'ss-erp:logistics-binding-probe-run', extensionVersion: '1.0.127' },
    { url: 'https://seller.ozon.ru/app' },
  )), { handled: true, ok: false, errorCode: 'untrusted_sender' });
  assert.deepEqual(plain(await handler(
    { type: 'ss-erp:logistics-binding-probe-run', extensionVersion: '1.0.127' },
    { url: 'chrome-extension://extension-id/pages/settings.html' },
  )), { handled: true, ok: true, data: { state: 'submitted' } });
  assert.deepEqual(calls, [{ extensionVersion: '1.0.127' }]);
  assert.deepEqual(plain(await handler(
    { type: 'ss-erp:logistics-binding-probe-status' },
    { url: 'chrome-extension://extension-id/pages/settings.html' },
  )), { handled: true, ok: true, data: { state: 'pending' } });
  assert.deepEqual(plain(await handler(
    { type: 'ss-erp:logistics-binding-probe-run' },
    { url: 'chrome-extension://extension-id/pages/popup.html' },
  )), { handled: true, ok: false, errorCode: 'untrusted_sender' });
});

test('service worker wires an explicit probe without scheduling background probing', () => {
  const worker = fs.readFileSync('extensions/ss-erp/background/service-worker.js', 'utf8');
  const manifest = JSON.parse(fs.readFileSync('extensions/ss-erp/manifest.json', 'utf8'));
  assert.match(worker, /binding-probe-adapter\.js/);
  assert.match(worker, /binding-probe-collector\.js/);
  assert.match(worker, /binding-probe-runtime\.js/);
  assert.match(worker, /getLogisticsBindingProbeRuntime/);
  assert.match(worker, /world:\s*['"]ISOLATED['"]/);
  assert.equal(manifest.permissions.includes('cookies'), true);
  assert.equal(manifest.host_permissions.includes('https://seller.ozon.ru/*'), true);
  const probeFlow = worker.slice(
    worker.indexOf('async function readCurrentOzonCompanyIdForBindingProbe'),
    worker.indexOf('function getLogisticsBindingProbeMessageHandler'),
  );
  assert.match(probeFlow, /chrome\.cookies\.get/);
  assert.match(probeFlow, /url:\s*['"]https:\/\/seller\.ozon\.ru\/['"]/);
  assert.match(probeFlow, /name:\s*['"]sc_company_id['"]/);
  assert.doesNotMatch(probeFlow, /getCapturedOzonCompanyIdForSync/);
  assert.doesNotMatch(probeFlow, /readOzonSellerCookieValueFromOpenTabForSync/);
  assert.doesNotMatch(probeFlow, /SS_ERP_OZON_COMPANY_ID_CAPTURE|window\.postMessage|ozon-company-id/);
  assert.doesNotMatch(probeFlow, /world:\s*['"]MAIN['"]/);
  const statusFlow = worker.slice(
    worker.indexOf('async function writeLogisticsBindingProbeStatus'),
    worker.indexOf('async function readCurrentOzonCompanyIdForBindingProbe'),
  );
  assert.match(statusFlow, /ownerSessionId/);
  assert.match(statusFlow, /getLogisticsDeviceCredentials\(\)\.getStatus/);
  const runtimeWiring = worker.slice(
    worker.indexOf('function getLogisticsBindingProbeRuntime'),
    worker.indexOf('function getLogisticsBindingProbeMessageHandler'),
  );
  assert.doesNotMatch(runtimeWiring, /readLogisticsCaptureEntries/);
  assert.match(runtimeWiring, /collectEvidence/);
  assert.match(worker, /ss-erp:logistics-binding-probe-run/);
  assert.match(worker, /ss-erp:logistics-binding-probe-status/);
  assert.doesNotMatch(worker, /BINDING_PROBE[^\n]{0,80}ALARM/i);
});

test('settings shows pending, success, and error probe states without credential material', () => {
  const html = fs.readFileSync('extensions/ss-erp/pages/settings.html', 'utf8');
  const source = fs.readFileSync('extensions/ss-erp/pages/settings.js', 'utf8');
  for (const id of ['logisticsBindingProbeStatus', 'runLogisticsBindingProbeBtn']) {
    assert.ok(html.includes('id="' + id + '"'), id + ' is required');
    assert.ok(source.includes("getElementById('" + id + "')"), id + ' must be wired');
  }
  assert.match(source, /ss-erp:logistics-binding-probe-run/);
  assert.match(source, /ss-erp:logistics-binding-probe-status/);
  assert.match(source, /pending[\s\S]{0,800}submitted/);
  assert.match(source, /revoked[\s\S]{0,800}(expired|replayed|rejected)/);
  assert.match(source, /https:\/\/seller\.ozon\.ru\/app\/postings\/fbs/);
  assert.doesNotMatch(source, /https:\/\/seller\.ozon\.ru\/app\/settings\/logistics/);
  assert.equal(source.includes('claimToken'), false);
  assert.equal(source.includes('refreshToken'), false);
});
