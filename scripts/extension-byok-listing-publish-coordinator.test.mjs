import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const SOURCE = await readFile(
  new URL('../extensions/ss-erp/shared/byok/listing-publish-coordinator.js', import.meta.url),
  'utf8',
);

function loadApi() {
  const context = vm.createContext({
    console,
    crypto: webcrypto,
    TextEncoder,
    setTimeout,
    clearTimeout,
  });
  context.globalThis = context;
  context.self = context;
  vm.runInContext(SOURCE, context, { filename: 'listing-publish-coordinator.js' });
  return context.SS_ERP_BYOK_LISTING_PUBLISH_COORDINATOR;
}

function plain(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createSessionStore() {
  const values = new Map();
  return {
    async get(key) {
      if (key === null) return Object.fromEntries([...values.entries()].map(([name, value]) => [name, plain(value)]));
      if (Array.isArray(key)) {
        return Object.fromEntries(key.filter((name) => values.has(name)).map((name) => [name, plain(values.get(name))]));
      }
      return values.has(key) ? { [key]: plain(values.get(key)) } : {};
    },
    async set(input) {
      for (const [key, value] of Object.entries(input)) values.set(key, plain(value));
    },
    async remove(key) {
      for (const name of Array.isArray(key) ? key : [key]) values.delete(name);
    },
    snapshot() {
      return plain(Object.fromEntries(values.entries()));
    },
  };
}

const CONTRACT_VERSION = 'extension-byok-listing-publish/v1';
const PREVIEW_HASH = 'a'.repeat(64);
const REQUEST_HASH = 'b'.repeat(64);
const SECRET_SENTINEL = 'sk-live-secret-sentinel-never-persist';
const GRANT_TOKEN = 'g'.repeat(43);

function boundContext(overrides = {}) {
  return {
    shopId: 'shop-1',
    workflowId: 'workflow-1',
    sourceDraftRevision: 3,
    sourceDraftVersion: 3,
    boundDraftRevision: 4,
    boundDraftVersion: 4,
    assetId: 'asset-byok-1',
    provenanceId: 'provenance-byok-1',
    normalizedSha256: 'c'.repeat(64),
    skuKey: 'sku-1',
    slotKey: 'sku:sku-1:hero',
    assignmentOrdinal: 1,
    assignmentSha256: 'd'.repeat(64),
    ...overrides,
  };
}

function previewData(input = boundContext(), overrides = {}) {
  return {
    contractVersion: CONTRACT_VERSION,
    previewHash: PREVIEW_HASH,
    ...input,
    selectedSkuKeys: ['sku-1'],
    orderedMedia: [
      {
        ordinal: 0,
        scope: 'PRODUCT',
        skuKey: null,
        slotKey: 'product:hero',
        assetId: 'asset-source-1',
        source: 'SOURCE',
      },
      {
        ordinal: 1,
        scope: 'SKU',
        skuKey: input.skuKey,
        slotKey: input.slotKey,
        assetId: input.assetId,
        source: 'GENERATED',
      },
    ],
    ...overrides,
  };
}

function envelope(input, idempotencyKey, overrides = {}) {
  return {
    operation: 'OZON_PUBLISH',
    shopId: input.shopId,
    workflowId: input.workflowId,
    draftVersion: input.boundDraftVersion,
    idempotencyKey,
    command: {
      schemaVersion: 'ozon-publish-command/v1',
      draftRevision: input.boundDraftRevision + 1,
      publishIntentId: 'publish-intent-1',
      selectedSkuKeys: ['sku-1'],
    },
    ...overrides,
  };
}

function response(status, body) {
  return { state: status >= 400 ? 'http_error' : 'response', status, body };
}

function previewResponse(input = boundContext(), overrides = {}) {
  return response(200, { code: 1, data: previewData(input, overrides) });
}

function prepareResponse(input, body, overrides = {}) {
  return response(201, {
    code: 1,
    data: {
      contractVersion: CONTRACT_VERSION,
      previewHash: PREVIEW_HASH,
      requestHash: REQUEST_HASH,
      replayed: false,
      envelope: envelope(input, body.idempotencyKey),
      ...overrides,
    },
  });
}

function grantResponse() {
  return response(201, {
    code: 1,
    msg: 'command grant issued',
    data: {
      grantId: 'grant-1',
      grantToken: GRANT_TOKEN,
      expiresAt: '2026-07-26T10:00:00.000Z',
    },
  });
}

function executeResponse(state = 'SUCCEEDED') {
  return response(state === 'FAILED' ? 409 : 202, state === 'FAILED' ? {
    code: 0,
    errorCode: 'publish_failed',
    msg: 'publish failed',
    data: {
      receipt: {
        id: 'receipt-1',
        status: 'FAILED',
        failureCode: 'OZON_SUBMIT_REJECTED',
        result: null,
      },
    },
  } : {
    code: 1,
    data: {
      replay: false,
      receipt: {
        id: 'receipt-1',
        status: state,
        failureCode: null,
        result: {
          rawProviderResult: SECRET_SENTINEL,
          ozonCredential: SECRET_SENTINEL,
          url: 'https://seller-api.example/private-result',
        },
      },
    },
  });
}

function statusResponse(state, overrides = {}) {
  const receiptId = state === 'NOT_COMMITTED' ? null : 'receipt-1';
  const failureCode = state === 'FAILED' ? 'OZON_SUBMIT_REJECTED' : null;
  return response(200, {
    code: 1,
    data: {
      contractVersion: CONTRACT_VERSION,
      state,
      receiptId,
      failureCode,
      ...overrides,
    },
  });
}

function createHappyTransport(input, calls, options = {}) {
  return {
    async post(path, body, requestOptions) {
      calls.push({ path, body: plain(body), options: plain(requestOptions) });
      if (path.endsWith('/preview')) return previewResponse(input);
      if (path.endsWith('/prepare')) return prepareResponse(input, body);
      if (path.endsWith('/command-grants')) return grantResponse();
      if (path.endsWith('/ozon-publish/execute')) {
        if (options.execute) return options.execute(path, body, requestOptions);
        return executeResponse();
      }
      if (path.endsWith('/status')) {
        return options.status ? options.status(path, body, requestOptions) : statusResponse('SUCCEEDED');
      }
      throw new Error('unexpected path: ' + path);
    },
  };
}

const api = loadApi();
assert.equal(api.CONTRACT_VERSION, CONTRACT_VERSION);
assert.equal(typeof api.createCoordinator, 'function');

{
  const input = boundContext();
  const calls = [];
  const store = createSessionStore();
  const coordinator = api.createCoordinator({
    transport: createHappyTransport(input, calls),
    store,
    crypto: webcrypto,
    now: () => 1_721_987_200_000,
  });

  const preview = plain(await coordinator.preview(input));
  assert.deepEqual(preview, previewData(input));
  const published = plain(await coordinator.confirm({ ...input, previewHash: PREVIEW_HASH }));
  assert.deepEqual(published, {
    contractVersion: CONTRACT_VERSION,
    state: 'SUCCEEDED',
    shopId: input.shopId,
    workflowId: input.workflowId,
    boundDraftRevision: input.boundDraftRevision,
    boundDraftVersion: input.boundDraftVersion,
    previewHash: PREVIEW_HASH,
    receiptId: 'receipt-1',
    failureCode: null,
  });

  assert.deepEqual(calls.map((call) => call.path), [
    '/api/extension-device/byok-publish/preview',
    '/api/extension-device/byok-publish/prepare',
    '/api/extension-device/command-grants',
    '/api/extension-device/ozon-publish/execute',
    '/api/extension-device/byok-publish/status',
  ]);
  const prepareCall = calls[1];
  assert.match(prepareCall.body.idempotencyKey, /^wb_publish_[a-f0-9]{48}$/u);
  assert.equal(prepareCall.options.requiredScope, 'listing:publish');
  const executeCall = calls[3];
  assert.equal(executeCall.body.operation, undefined);
  assert.equal(executeCall.options.commandGrant, GRANT_TOKEN);
  assert.equal(executeCall.options.requiredScope, 'listing:publish');
  assert.deepEqual(calls[4].body, {
    contractVersion: CONTRACT_VERSION,
    previewHash: PREVIEW_HASH,
    requestHash: REQUEST_HASH,
    provenanceId: input.provenanceId,
    envelope: prepareCall.body.idempotencyKey
      ? envelope(input, prepareCall.body.idempotencyKey)
      : null,
  });

  const durable = JSON.stringify(store.snapshot());
  assert.match(durable, /wb_publish_[a-f0-9]{48}/u);
  assert.doesNotMatch(durable, new RegExp(SECRET_SENTINEL, 'u'));
  assert.doesNotMatch(durable, /grantToken|seller-api\.example|rawProviderResult|ozonCredential/u);
  assert.doesNotMatch(JSON.stringify(published), new RegExp(SECRET_SENTINEL, 'u'));
}

{
  const input = boundContext();
  const calls = [];
  const store = createSessionStore();
  const coordinator = api.createCoordinator({
    transport: createHappyTransport(input, calls, {
      async execute() {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return executeResponse();
      },
    }),
    store,
    crypto: webcrypto,
    now: Date.now,
  });
  await coordinator.preview(input);
  const confirmation = { ...input, previewHash: PREVIEW_HASH };
  const [first, second] = await Promise.all([
    coordinator.confirm(confirmation),
    coordinator.confirm(confirmation),
  ]);
  assert.deepEqual(plain(first), plain(second));
  assert.equal(calls.filter((call) => call.path.endsWith('/prepare')).length, 1);
  assert.equal(calls.filter((call) => call.path.endsWith('/command-grants')).length, 1);
  assert.equal(calls.filter((call) => call.path.endsWith('/ozon-publish/execute')).length, 1);
}

async function createUnknownRecord(store, input = boundContext()) {
  const calls = [];
  const coordinator = api.createCoordinator({
    transport: createHappyTransport(input, calls, {
      async execute() { throw new Error('network timeout'); },
    }),
    store,
    crypto: webcrypto,
    now: Date.now,
  });
  await coordinator.preview(input);
  await assert.rejects(
    coordinator.confirm({ ...input, previewHash: PREVIEW_HASH }),
    (error) => error
      && error.code === 'SS_ERP_BYOK_PUBLISH_UNKNOWN_OUTCOME'
      && error.outcome === 'UNKNOWN_OUTCOME',
  );
  return calls;
}

for (const prepareStatus of [429, 503]) {
  const input = boundContext();
  const store = createSessionStore();
  const calls = [];
  let prepareCount = 0;
  const coordinator = api.createCoordinator({
    transport: {
      async post(path, body, requestOptions) {
        calls.push({ path, body: plain(body), options: plain(requestOptions) });
        if (path.endsWith('/preview')) return previewResponse(input);
        if (path.endsWith('/prepare')) {
          prepareCount += 1;
          return prepareCount === 1
            ? response(prepareStatus, { code: 0, errorCode: 'temporarily_unavailable', msg: 'retry' })
            : prepareResponse(input, body);
        }
        if (path.endsWith('/command-grants')) return grantResponse();
        if (path.endsWith('/ozon-publish/execute')) return executeResponse();
        if (path.endsWith('/status')) return statusResponse('SUCCEEDED');
        throw new Error('unexpected path ' + path);
      },
    },
    store,
    crypto: webcrypto,
    now: Date.now,
  });
  await coordinator.preview(input);
  await assert.rejects(
    coordinator.confirm({ ...input, previewHash: PREVIEW_HASH }),
    (error) => error
      && error.code === 'SS_ERP_BYOK_PUBLISH_UNKNOWN_OUTCOME'
      && error.outcome === 'UNKNOWN_OUTCOME',
  );
  assert.equal((await coordinator.getState(input)).state, 'OUTCOME_UNRESOLVED');
  assert.equal((await coordinator.recover(input)).state, 'SUCCEEDED');
  const prepareCalls = calls.filter((call) => call.path.endsWith('/prepare'));
  assert.equal(prepareCalls.length, 2);
  assert.equal(prepareCalls[0].body.idempotencyKey, prepareCalls[1].body.idempotencyKey,
    'transient prepare recovery must reuse the exact idempotency identity');
}

{
  const input = boundContext();
  const store = createSessionStore();
  await createUnknownRecord(store, input);
  const reloadCalls = [];
  const reloaded = api.createCoordinator({
    transport: createHappyTransport(input, reloadCalls, {
      status: async () => statusResponse('PENDING'),
    }),
    store,
    crypto: webcrypto,
    now: Date.now,
  });
  assert.equal((await reloaded.getState(input)).state, 'PENDING');
  assert.equal((await reloaded.recover(input)).state, 'PENDING');
  assert.equal(reloadCalls.filter((call) => call.path.endsWith('/ozon-publish/execute')).length, 1);
  assert.equal(reloadCalls.filter((call) => call.path.endsWith('/command-grants')).length, 1);
  assert.equal(reloadCalls[0].path.endsWith('/status'), true,
    'reload state checks status before any explicit recovery action');
}

{
  const input = boundContext();
  const store = createSessionStore();
  await createUnknownRecord(store, input);
  const calls = [];
  const reloaded = api.createCoordinator({
    transport: createHappyTransport(input, calls, {
      status: async () => { throw new Error('offline'); },
    }),
    store,
    crypto: webcrypto,
    now: Date.now,
  });
  const unresolved = plain(await reloaded.getState(input));
  assert.equal(unresolved.state, 'OUTCOME_UNRESOLVED');
  assert.equal(unresolved.receiptId, null);
  assert.equal(calls.filter((call) => call.path.endsWith('/status')).length, 1);
  assert.equal(calls.filter((call) => call.path.endsWith('/ozon-publish/execute')).length, 0,
    'reload must remain status-only while the authoritative ledger is unavailable');
}

{
  const input = boundContext();
  const store = createSessionStore();
  await createUnknownRecord(store, input);
  const calls = [];
  let statusCount = 0;
  const reloaded = api.createCoordinator({
    transport: createHappyTransport(input, calls, {
      status: async () => {
        statusCount += 1;
        return statusCount <= 2 ? statusResponse('NOT_COMMITTED') : statusResponse('SUCCEEDED');
      },
    }),
    store,
    crypto: webcrypto,
    now: Date.now,
  });
  assert.equal((await reloaded.getState(input)).state, 'NOT_COMMITTED');
  assert.equal(calls.filter((call) => call.path.endsWith('/ozon-publish/execute')).length, 0);
  assert.equal((await reloaded.recover(input)).state, 'SUCCEEDED');
  assert.equal(calls.filter((call) => call.path.endsWith('/command-grants')).length, 1);
  assert.equal(calls.filter((call) => call.path.endsWith('/ozon-publish/execute')).length, 1);
}

{
  const input = boundContext();
  const store = createSessionStore();
  await createUnknownRecord(store, input);
  const calls = [];
  const reloaded = api.createCoordinator({
    transport: createHappyTransport(input, calls, {
      status: async () => statusResponse('FAILED'),
    }),
    store,
    crypto: webcrypto,
    now: Date.now,
  });
  const failed = plain(await reloaded.getState(input));
  assert.equal(failed.state, 'FAILED');
  assert.equal(failed.failureCode, 'OZON_SUBMIT_REJECTED');
  assert.equal(calls.filter((call) => call.path.endsWith('/ozon-publish/execute')).length, 0);
  assert.deepEqual(plain(await reloaded.recover(input)), failed);
}

{
  const input = boundContext();
  let calls = 0;
  const coordinator = api.createCoordinator({
    transport: {
      async post() {
        calls += 1;
        return previewResponse(input, { shopId: 'shop-other' });
      },
    },
    store: createSessionStore(),
    crypto: webcrypto,
    now: Date.now,
  });
  await assert.rejects(
    coordinator.preview(input),
    (error) => error && error.code === 'SS_ERP_BYOK_PUBLISH_RESPONSE_INVALID',
  );
  assert.equal(calls, 1);
}

{
  const input = boundContext();
  const calls = [];
  const coordinator = api.createCoordinator({
    transport: {
      async post(path, body, requestOptions) {
        calls.push({ path, body: plain(body), options: plain(requestOptions) });
        if (path.endsWith('/preview')) return previewResponse(input);
        if (path.endsWith('/prepare')) {
          return prepareResponse(input, body, {
            envelope: envelope(input, body.idempotencyKey, { shopId: 'shop-other' }),
          });
        }
        throw new Error('must not issue or execute');
      },
    },
    store: createSessionStore(),
    crypto: webcrypto,
    now: Date.now,
  });
  await coordinator.preview(input);
  await assert.rejects(
    coordinator.confirm({ ...input, previewHash: PREVIEW_HASH }),
    (error) => error
      && error.code === 'SS_ERP_BYOK_PUBLISH_UNKNOWN_OUTCOME'
      && error.outcome === 'UNKNOWN_OUTCOME',
  );
  assert.deepEqual(calls.map((call) => call.path), [
    '/api/extension-device/byok-publish/preview',
    '/api/extension-device/byok-publish/prepare',
  ]);
}

{
  const input = boundContext();
  let calls = 0;
  const coordinator = api.createCoordinator({
    transport: {
      async post() { calls += 1; return previewResponse(input); },
    },
    store: createSessionStore(),
    crypto: webcrypto,
    now: Date.now,
  });
  await assert.rejects(
    coordinator.preview({ ...input, apiKey: SECRET_SENTINEL }),
    (error) => error && error.code === 'SS_ERP_BYOK_PUBLISH_INPUT_INVALID',
  );
  assert.equal(calls, 0);
  await assert.rejects(
    coordinator.confirm({ ...input, previewHash: PREVIEW_HASH }),
    (error) => error && error.code === 'SS_ERP_BYOK_PUBLISH_CONFIRMATION_REQUIRED',
  );
}

{
  const input = boundContext();
  const store = createSessionStore();
  const coordinator = api.createCoordinator({
    transport: createHappyTransport(input, []),
    store,
    crypto: webcrypto,
    now: Date.now,
  });
  await coordinator.preview(input);
  await coordinator.confirm({ ...input, previewHash: PREVIEW_HASH });
  await store.set({ unrelated: { keep: true } });
  assert.equal(await coordinator.clear(), 1);
  assert.deepEqual(store.snapshot(), { unrelated: { keep: true } });
}

console.log('extension BYOK listing publish coordinator tests passed');
