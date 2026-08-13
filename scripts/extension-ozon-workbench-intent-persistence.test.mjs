import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const backgroundPath = 'extensions/ss-erp/background/collect-background.js';
const background = readFileSync(backgroundPath, 'utf8');
const INTENT_KEY = 'ss_erp_ozon_workbench_publish_intent';
const QUEUE_KEY = 'ss_erp_ozon_workbench_publish_payload_queue';

function extractFunction(name) {
  const declarations = [`async function ${name}(`, `function ${name}(`];
  const start = declarations
    .map((declaration) => background.indexOf(declaration))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  assert.ok(Number.isInteger(start), `expected ${name} in ${backgroundPath}`);
  const nextDeclaration = /\n(?:async\s+)?function\s+[A-Za-z0-9_$]+\s*\(/g;
  nextDeclaration.lastIndex = start + declarations[0].length;
  const next = nextDeclaration.exec(background);
  return background.slice(start, next ? next.index : background.length).trim();
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function clientRequestIds(value, found = new Set()) {
  if (!value || typeof value !== 'object') return found;
  if (typeof value.clientRequestId === 'string') found.add(value.clientRequestId);
  for (const nested of Object.values(value)) clientRequestIds(nested, found);
  return found;
}

function storageHarness(initial = {}, options = {}) {
  const state = clone(initial);
  const mutations = [];
  let activeOperations = 0;
  let maxActiveOperations = 0;
  let queueWriteFailuresRemaining = Number(options.queueWriteFailures) || 0;
  const runtime = { lastError: null };

  const finish = (callback, error = null) => {
    setTimeout(() => {
      runtime.lastError = error ? { message: error } : null;
      try { callback(); } finally {
        runtime.lastError = null;
        activeOperations -= 1;
      }
    }, options.delayMs ?? 2);
  };
  const start = () => {
    activeOperations += 1;
    maxActiveOperations = Math.max(maxActiveOperations, activeOperations);
  };
  const snapshot = (kind) => mutations.push({ kind, state: clone(state) });

  return {
    state,
    mutations,
    runtime,
    get maxActiveOperations() { return maxActiveOperations; },
    api: {
      get(keys, callback) {
        start();
        const result = {};
        for (const key of Array.isArray(keys) ? keys : [keys]) result[key] = clone(state[key]);
        finish(() => callback(result));
      },
      set(patch, callback) {
        start();
        if (Object.prototype.hasOwnProperty.call(patch, QUEUE_KEY) && queueWriteFailuresRemaining > 0) {
          queueWriteFailuresRemaining -= 1;
          finish(callback, 'simulated queue persistence failure');
          return;
        }
        Object.assign(state, clone(patch));
        snapshot(`set:${Object.keys(patch).join(',')}`);
        finish(callback);
      },
      remove(keys, callback) {
        start();
        for (const key of Array.isArray(keys) ? keys : [keys]) delete state[key];
        snapshot(`remove:${Array.isArray(keys) ? keys.join(',') : keys}`);
        finish(callback);
      },
    },
  };
}

function createRuntime(storage, { create } = {}) {
  let uuidSequence = 0;
  const context = vm.createContext({
    Array,
    Date,
    Error,
    JSON,
    Map,
    Math,
    Number,
    Object,
    Promise,
    RegExp,
    Set,
    String,
    TextEncoder,
    URL,
    clearTimeout,
    console,
    setTimeout,
    chrome: {
      alarms: { create() {} },
      runtime: storage.runtime,
      storage: { local: storage.api },
    },
    crypto: {
      subtle: webcrypto.subtle,
      randomUUID() {
        uuidSequence += 1;
        return `00000000-0000-4000-8000-${String(uuidSequence).padStart(12, '0')}`;
      },
    },
  });
  context.globalThis = context;
  context.SS_ERP_EXTENSION_DEVICE_ONE_CLICK = {
    async create(payload) {
      return create ? create(payload) : { ok: true, data: { jobId: 'job-default' } };
    },
  };

  const functions = [
    'normalizeErrorMessage',
    'normalizeErrorCode',
    'enqueueOzonWorkbenchPublishPayloadQueueWrite',
    'cloneOzonWorkbenchPublishPayloadOptions',
    'normalizeOzonWorkbenchReviewJobId',
    'normalizeOzonWorkbenchClientRequestId',
    'ozonWorkbenchPublishIntentFingerprint',
    'newOzonWorkbenchClientRequestId',
    'loadOrCreateOzonWorkbenchPublishIntent',
    'clearOzonWorkbenchPublishIntent',
    'retainOzonWorkbenchPublishIntentAfterCreateFailure',
    'normalizeOzonWorkbenchPublishPayloadJob',
    'readOzonWorkbenchPublishPayloadQueue',
    'writeOzonWorkbenchPublishPayloadQueue',
    'upsertOzonWorkbenchPublishPayloadJob',
    'storageGet',
    'storageSet',
    'storageRemove',
    'createOzonWorkbenchPublishJob',
  ];
  const prelude = `
    const OZON_WORKBENCH_PUBLISH_INTENT_KEY = ${JSON.stringify(INTENT_KEY)};
    const OZON_WORKBENCH_PUBLISH_PAYLOAD_QUEUE_KEY = ${JSON.stringify(QUEUE_KEY)};
    const OZON_WORKBENCH_PUBLISH_INTENT_MAX_ENTRIES = 32;
    const OZON_WORKBENCH_PUBLISH_INTENT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
    const OZON_WORKBENCH_REVIEW_JOB_ID_MAX_LENGTH = 200;
    let ozonWorkbenchPublishPayloadQueueWriteQueue = Promise.resolve();
    async function ensureOzonWorkbenchPublishCookieSynced() {}
    function buildOzonWorkbenchInitialPublishPayload(productIds, options) {
      return { shopId: options.shopId, productIds: Array.from(productIds), rows: [] };
    }
    function ensureOzonWorkbenchPublishPayloadAlarm() {}
    async function flushOzonWorkbenchPublishPayloadQueue() {}
  `;
  vm.runInContext(
    `${prelude}\n${functions.map(extractFunction).join('\n')}\n`
      + `globalThis.__api = { loadOrCreateOzonWorkbenchPublishIntent, clearOzonWorkbenchPublishIntent, `
      + 'upsertOzonWorkbenchPublishPayloadJob, createOzonWorkbenchPublishJob };',
    context,
    { filename: backgroundPath },
  );
  return context.__api;
}

function containsIntent(state, requestId) {
  return clientRequestIds(state[INTENT_KEY]).has(requestId);
}

test('concurrent independent create intents remain durable and same-request retries reuse their key', async () => {
  const storage = storageHarness();
  const api = createRuntime(storage);
  const options = { shopId: 'shop-1', publishMode: 'clone', watermark: { enabled: true } };
  const [first, second] = await Promise.all([
    api.loadOrCreateOzonWorkbenchPublishIntent(['sku-1'], options),
    api.loadOrCreateOzonWorkbenchPublishIntent(['sku-2'], options),
  ]);

  assert.notEqual(first.clientRequestId, second.clientRequestId);
  assert.ok(containsIntent(storage.state, first.clientRequestId), 'first independent intent must not be overwritten');
  assert.ok(containsIntent(storage.state, second.clientRequestId), 'second independent intent must remain durable');
  const retried = await api.loadOrCreateOzonWorkbenchPublishIntent(['sku-1'], options);
  assert.equal(retried.clientRequestId, first.clientRequestId, 'same logical create must reuse its durable key');
});

test('intent fingerprints include rows, completion options, and stable nested key ordering', async () => {
  const storage = storageHarness();
  const api = createRuntime(storage);
  const first = await api.loadOrCreateOzonWorkbenchPublishIntent(['sku-1'], {
    shopId: 'shop-1',
    rows: [{ sku: 'sku-1', details: { title: 'A', price: 10 } }],
    prices: { 'sku-1': 10 },
    productTimeoutMs: 45_000,
  });
  const reordered = await api.loadOrCreateOzonWorkbenchPublishIntent(['sku-1'], {
    productTimeoutMs: 45_000,
    prices: { 'sku-1': 10 },
    rows: [{ details: { price: 10, title: 'A' }, sku: 'sku-1' }],
    shopId: 'shop-1',
  });
  const changedRows = await api.loadOrCreateOzonWorkbenchPublishIntent(['sku-1'], {
    shopId: 'shop-1',
    rows: [{ sku: 'sku-1', details: { title: 'B', price: 10 } }],
    prices: { 'sku-1': 10 },
    productTimeoutMs: 45_000,
  });
  const changedCompletion = await api.loadOrCreateOzonWorkbenchPublishIntent(['sku-1'], {
    shopId: 'shop-1',
    rows: [{ sku: 'sku-1', details: { title: 'A', price: 10 } }],
    prices: { 'sku-1': 10 },
    productTimeoutMs: 60_000,
  });

  assert.equal(reordered.clientRequestId, first.clientRequestId);
  assert.notEqual(changedRows.clientRequestId, first.clientRequestId);
  assert.notEqual(changedCompletion.clientRequestId, first.clientRequestId);
});

test('legacy single intents migrate and stale capacity is pruned before reuse', async () => {
  const sourceStorage = storageHarness();
  const sourceApi = createRuntime(sourceStorage);
  const legacy = await sourceApi.loadOrCreateOzonWorkbenchPublishIntent(
    ['sku-legacy'],
    { shopId: 'shop-1' },
  );
  const legacyStorage = storageHarness({ [INTENT_KEY]: legacy });
  const legacyApi = createRuntime(legacyStorage);
  const reused = await legacyApi.loadOrCreateOzonWorkbenchPublishIntent(
    ['sku-legacy'],
    { shopId: 'shop-1' },
  );

  assert.equal(reused.clientRequestId, legacy.clientRequestId);
  assert.equal(legacyStorage.state[INTENT_KEY].version, 1);
  assert.deepEqual(clone(legacyStorage.state[INTENT_KEY].intents), [clone(legacy)]);

  const expiredAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  const expired = Array.from({ length: 32 }, (_, index) => ({
    fingerprint: index.toString(16).padStart(64, '0'),
    clientRequestId: `expired-request-${String(index).padStart(3, '0')}`,
    createdAt: expiredAt,
  }));
  const staleStorage = storageHarness({
    [INTENT_KEY]: { version: 1, intents: expired },
  });
  const staleApi = createRuntime(staleStorage);
  const fresh = await staleApi.loadOrCreateOzonWorkbenchPublishIntent(
    ['sku-fresh'],
    { shopId: 'shop-1' },
  );

  assert.ok(fresh.clientRequestId);
  assert.deepEqual(clone(staleStorage.state[INTENT_KEY].intents), [clone(fresh)]);
});

test('live intent capacity fails closed without discarding reconciliation keys', async () => {
  const createdAt = new Date().toISOString();
  const live = Array.from({ length: 32 }, (_, index) => ({
    fingerprint: index.toString(16).padStart(64, 'a'),
    clientRequestId: `live-request-${String(index).padStart(4, '0')}`,
    createdAt,
  }));
  const storage = storageHarness({
    [INTENT_KEY]: { version: 1, intents: live },
  });
  const api = createRuntime(storage);

  await assert.rejects(
    api.loadOrCreateOzonWorkbenchPublishIntent(['sku-overflow'], { shopId: 'shop-1' }),
    (error) => error && error.errorCode === 'ozon_workbench_publish_intent_capacity_exceeded',
  );
  assert.equal(storage.state[INTENT_KEY].intents.length, 32);
});

test('unknown create outcome retains its durable intent for exact-key reconciliation', async () => {
  const storage = storageHarness();
  const api = createRuntime(storage, {
    create: async () => {
      throw Object.assign(new Error('request outcome unknown'), {
        outcome: 'UNKNOWN_OUTCOME',
        requestDispatched: true,
        automaticRetryAllowed: false,
      });
    },
  });

  const result = await api.createOzonWorkbenchPublishJob(['sku-unknown'], { shopId: 'shop-1' });
  assert.equal(result.ok, false);
  assert.equal(result.automaticRetryAllowed, false);
  assert.ok(containsIntent(storage.state, result.clientRequestId));
});

test('definitive create rejection clears its intent instead of consuming capacity', async () => {
  const storage = storageHarness();
  const api = createRuntime(storage, {
    create: async () => ({
      ok: false,
      errorCode: 'browser_one_click_expected_skus_invalid',
      error: 'invalid request',
      status: 400,
      terminal: true,
    }),
  });

  const result = await api.createOzonWorkbenchPublishJob(['sku-rejected'], { shopId: 'shop-1' });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'browser_one_click_expected_skus_invalid');
  assert.equal(storage.state[INTENT_KEY], undefined);
});

test('successful create persists its payload queue before clearing the matching intent', async () => {
  const storage = storageHarness();
  const api = createRuntime(storage, {
    create: async () => ({ ok: true, data: { jobId: 'job-ordering' } }),
  });
  const result = await api.createOzonWorkbenchPublishJob(['sku-ordering'], { shopId: 'shop-1' });
  assert.equal(result.ok, true);

  const queueIndex = storage.mutations.findIndex((entry) => (
    Array.isArray(entry.state[QUEUE_KEY])
    && entry.state[QUEUE_KEY].some((job) => job.jobId === 'job-ordering')
  ));
  const intentId = storage.mutations
    .flatMap((entry) => [...clientRequestIds(entry.state[INTENT_KEY])])[0];
  const clearIndex = storage.mutations.findIndex((entry, index) => (
    index > queueIndex && intentId && !containsIntent(entry.state, intentId)
  ));
  assert.ok(queueIndex >= 0, 'successful create must durably persist the payload queue');
  assert.ok(clearIndex > queueIndex, 'the recovery intent may clear only after queue persistence succeeds');
});

test('queue persistence failure cannot report success or discard the recovery intent', async () => {
  const storage = storageHarness({}, { queueWriteFailures: 1 });
  const api = createRuntime(storage, {
    create: async () => ({ ok: true, data: { jobId: 'job-write-failure' } }),
  });
  let result;
  let error;
  try {
    result = await api.createOzonWorkbenchPublishJob(['sku-write-failure'], { shopId: 'shop-1' });
  } catch (caught) {
    error = caught;
  }

  assert.ok(error || !result || result.ok !== true, 'failed durable queue write must not report a successful create');
  assert.ok(clientRequestIds(storage.state[INTENT_KEY]).size > 0, 'recovery intent must survive queue write failure');
  assert.equal(storage.state[QUEUE_KEY], undefined);
});

test('concurrent queue mutations serialize their read-modify-write cycles', async () => {
  const storage = storageHarness({}, { delayMs: 5 });
  const api = createRuntime(storage);
  await Promise.all([
    api.upsertOzonWorkbenchPublishPayloadJob({ jobId: 'job-a', productIds: ['sku-a'], options: {} }),
    api.upsertOzonWorkbenchPublishPayloadJob({ jobId: 'job-b', productIds: ['sku-b'], options: {} }),
  ]);

  assert.deepEqual(
    storage.state[QUEUE_KEY].map((job) => job.jobId).sort(),
    ['job-a', 'job-b'],
    'serialized mutations must not lose a concurrently added queue entry',
  );
  assert.equal(storage.maxActiveOperations, 1, 'one serialized mutation must finish its storage operation before the next starts');
});
