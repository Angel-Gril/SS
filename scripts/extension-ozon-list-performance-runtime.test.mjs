import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const background = readFileSync('extensions/ss-erp/background/collect-background.js', 'utf8').replace(/\r\n/g, '\n');
const overlay = readFileSync('extensions/ss-erp/content/ozon-list-overlay.js', 'utf8').replace(/\r\n/g, '\n');
const serviceWorker = readFileSync('extensions/ss-erp/background/service-worker.js', 'utf8').replace(/\r\n/g, '\n');

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  assert.notEqual(end, -1, `missing ${endMarker}`);
  return source.slice(start, end);
}

function loadQueueRuntime() {
  let now = 0;
  const state = sliceBetween(
    background,
    'var OZON_LIST_INSIGHT_REQUEST_CONCURRENCY',
    '\n\nconst DEFAULT_CONFIG',
  );
  const functions = sliceBetween(
    background,
    'function drainOzonListInsightRequestQueue',
    '\nfunction containsCjkText',
  );
  const sandbox = {
    Date: { now: () => now },
    Error,
    Map,
    Promise,
  };
  vm.runInNewContext(`${state}\n${functions}`, sandbox, { filename: 'ozon-list-request-queue.js' });
  return {
    enqueue: sandbox.enqueueOzonListInsightRequest,
    setNow(value) { now = value; },
  };
}

function loadCacheRuntime() {
  let now = 1000;
  const pending = [];
  const functions = sliceBetween(
    background,
    'function normalizeOzonInsightProfile',
    '\nfunction buildOzonWorkbenchRowFromSeed',
  );
  const sandbox = {
    Date: { now: () => now },
    Map,
    OZON_WORKBENCH_INSIGHT_TTL_MS: 5 * 60 * 1000,
    OZON_WORKBENCH_INSIGHT_MAX_ENTRIES: 300,
    aggregateOzonProductInsights: (sku, options) => new Promise((resolve) => {
      pending.push({ options, resolve, sku });
    }),
    getSellerCompanyId: () => Promise.resolve('company-1'),
    ozonWorkbenchInsightCache: new Map(),
    ozonWorkbenchInsightContextEpoch: 0,
    ozonWorkbenchInsightInFlight: new Map(),
  };
  vm.runInNewContext(functions, sandbox, { filename: 'ozon-list-insight-cache.js' });
  return {
    cache: sandbox.ozonWorkbenchInsightCache,
    fetch: sandbox.fetchCachedOzonWorkbenchInsight,
    get: sandbox.getCachedOzonWorkbenchInsight,
    inFlight: sandbox.ozonWorkbenchInsightInFlight,
    invalidate: sandbox.invalidateOzonWorkbenchInsightContext,
    pending,
    resolve(index, value) { pending[index].resolve(value); },
    set: sandbox.setCachedOzonWorkbenchInsight,
    setNow(value) { now = value; },
  };
}

function loadCookieLifecycleRuntime() {
  let nextTimerId = 1;
  let authCookieState = false;
  let clearedCompanyContexts = 0;
  let broadcastCompanyContexts = 0;
  let syncCalls = 0;
  const syncOptions = [];
  const deferred = [];
  const timers = new Map();
  const singleFlight = sliceBetween(
    serviceWorker,
    'function runOzonCookieOnlySyncSingleFlight',
    '\n\nasync function ensureCurrentOzonCookieSyncedForInsights',
  );
  const lifecycle = sliceBetween(
    serviceWorker,
    'function flushOzonSellerCookieLifecycleSync',
    '\n\nasync function scheduleOzonSellerCookieLifecycleSyncWhenTabExists',
  );
  const sandbox = {
    SS_ERP_OZON_COOKIE_LIFECYCLE_DEBOUNCE_MS: 750,
    broadcastOzonCompanyContextChanged: async () => {
      broadcastCompanyContexts += 1;
    },
    clearRuntimeOzonCompanyIdForSync: async () => {
      clearedCompanyContexts += 1;
    },
    clearTimeout: (id) => timers.delete(id),
    setTimeout: (callback) => {
      const id = nextTimerId;
      nextTimerId += 1;
      timers.set(id, callback);
      return id;
    },
    hasCurrentOzonSellerAuthCookieForSync: async () => authCookieState,
    syncCurrentOzonCookieForSync: (options) => {
      syncCalls += 1;
      syncOptions.push(options);
      return new Promise((resolve, reject) => deferred.push({ reject, resolve }));
    },
  };
  const prelude = `
    var ozonCookieOnlySyncInFlight = null;
    var ozonSellerCookieLifecycleTimer = null;
    var ozonSellerCookieLifecyclePending = false;
    var ozonSellerCookieRemovalPending = false;
  `;
  vm.runInNewContext(`${prelude}\n${singleFlight}\n${lifecycle}`, sandbox, {
    filename: 'ozon-cookie-lifecycle.js',
  });
  return {
    broadcastCompanyContexts: () => broadcastCompanyContexts,
    clearedCompanyContexts: () => clearedCompanyContexts,
    pending: deferred,
    markRemovalPending() { sandbox.ozonSellerCookieRemovalPending = true; },
    reject(index, error) { deferred[index].reject(error); },
    resolve(index, value) { deferred[index].resolve(value); },
    runNextTimer() {
      const entry = timers.entries().next().value;
      assert.ok(entry, 'expected a scheduled Cookie lifecycle timer');
      timers.delete(entry[0]);
      entry[1]();
    },
    schedule: sandbox.scheduleOzonSellerCookieLifecycleSync,
    setAuthCookieState(value) { authCookieState = value; },
    syncCalls: () => syncCalls,
    syncOptions,
    timerCount: () => timers.size,
  };
}

function loadSellerAuthCookieStateRuntime(getAll) {
  const reader = sliceBetween(
    serviceWorker,
    'async function hasCurrentOzonSellerAuthCookieForSync',
    '\n\nfunction isRelevantOzonSellerAuthCookieForSync',
  );
  const sandbox = {
    chrome: { cookies: { getAll } },
    isOzonSellerSessionAuthCookieForSync: (cookie) => Boolean(
      cookie && cookie.name === '__Secure-access-token',
    ),
  };
  vm.runInNewContext(reader, sandbox, { filename: 'ozon-seller-auth-cookie-state.js' });
  return sandbox.hasCurrentOzonSellerAuthCookieForSync;
}

function loadPremiumRuntime() {
  let resolveResponse;
  let sendCalls = 0;
  const helpers = sliceBetween(
    overlay,
    '  function premiumRequestKey',
    '  function invalidatePremiumContext',
  );
  const queueFunctions = sliceBetween(
    overlay,
    '  function enqueuePremiumRequest',
    '\n\n  // === 工具：DOM 解析',
  );
  const fetchFunction = sliceBetween(
    overlay,
    '  async function fetchPublicProduct',
    '\n  // === 字段提取',
  );
  const sandbox = {
    Date,
    Map,
    Promise,
    setTimeout,
    send: () => {
      sendCalls += 1;
      return new Promise((resolve) => { resolveResponse = resolve; });
    },
  };
  const prelude = `
    var premiumContextEpoch = 0;
    var premiumCache = new Map();
    var failedPremiumCache = new Map();
    var inFlightPremium = new Map();
    var inFlightPremiumCallers = new Map();
    var PREMIUM_TTL_MS = 600000;
    var PREMIUM_FAILURE_TTL_MS = 90000;
    var PREMIUM_CONCURRENCY = 3;
    var PREMIUM_MAX_PENDING = 60;
    var PREMIUM_QUEUE_DEADLINE_MS = 15000;
    var PREMIUM_QUEUE_SKIPPED = Object.freeze({ skipped: true });
    var premiumQueue = [];
    var activePremiumRequests = 0;
    function getCached(map, key) { var hit = map.get(key); return hit ? hit.data : null; }
    function setCached(map, key, data) { map.set(key, { data: data, ts: Date.now() }); }
    function autoSyncCurrentOzonCookieForListData() {}
    function rememberSourceErrors() {}
    function hasDisplayablePremiumData(data) { return Boolean(data && Object.keys(data).length); }
  `;
  vm.runInNewContext(`${prelude}\n${helpers}\n${queueFunctions}\n${fetchFunction}`, sandbox, {
    filename: 'ozon-list-premium-cache.js',
  });
  return {
    cache: sandbox.premiumCache,
    enqueue: sandbox.enqueuePremiumRequest,
    inFlight: sandbox.inFlightPremium,
    fetch: sandbox.fetchPublicProduct,
    resolve(value) { resolveResponse(value); },
    sendCalls() { return sendCalls; },
    setEpoch(value) { sandbox.premiumContextEpoch = value; },
  };
}

function loadCapturedCompanyRuntime() {
  let currentCompanyId = 'company-1';
  const calls = { broadcast: 0, maintenance: [], remembered: [] };
  const handler = sliceBetween(
    serviceWorker,
    'function handleCapturedOzonCompanyIdForSync',
    '\n\nasync function readOzonAutoSyncStatus',
  );
  const sandbox = {
    broadcastOzonCompanyContextChanged: () => {
      calls.broadcast += 1;
      return Promise.resolve();
    },
    getRuntimeOzonCompanyIdForSync: () => currentCompanyId,
    rememberRuntimeOzonCompanyIdForSync: (companyId) => {
      calls.remembered.push(companyId);
      currentCompanyId = String(companyId || '').trim();
      return currentCompanyId;
    },
    scheduleOzonCompanyMaintenance: (companyId) => calls.maintenance.push(companyId),
  };
  vm.runInNewContext(handler, sandbox, { filename: 'ozon-captured-company.js' });
  return { calls, handle: sandbox.handleCapturedOzonCompanyIdForSync };
}

function loadScanSchedulerRuntime() {
  const scheduled = [];
  const scanned = [];
  const body = { nodeType: 1, isConnected: true, contains: () => true };
  const scheduler = sliceBetween(
    overlay,
    '  const pendingScanRoots',
    '\n\n  function scheduleScan()',
  );
  const sandbox = {
    CARD_SCAN_DEBOUNCE_MS: 80,
    document: { body },
    isSsErpOwnedNode: () => false,
    scanRoot: (root) => scanned.push(root),
    setTimeout: (callback) => {
      scheduled.push(callback);
      return scheduled.length;
    },
  };
  vm.runInNewContext(scheduler, sandbox, { filename: 'ozon-list-scan-scheduler.js' });
  return { body, scanned, scheduled, schedule: sandbox.scheduleScanRoot };
}

function loadSellerCookieChangeRuntime() {
  const calls = {
    broadcast: 0,
    lifecycle: 0,
    maintenance: [],
    remembered: [],
  };
  const handler = sliceBetween(
    serviceWorker,
    'function handleOzonSellerCookieChange',
    '\n\nif (chrome.cookies && chrome.cookies.onChanged)',
  );
  const sandbox = {
    isRelevantOzonSellerAuthCookieForSync: (cookie) => Boolean(
      cookie && ['sc_company_id', '__Secure-access-token'].includes(cookie.name),
    ),
    broadcastOzonCompanyContextChanged: () => {
      calls.broadcast += 1;
      return Promise.resolve();
    },
    rememberRuntimeOzonCompanyIdForSync: (value) => {
      calls.remembered.push(value);
      return `normalized:${value}`;
    },
    scheduleOzonCompanyMaintenance: (companyId) => calls.maintenance.push(companyId),
    scheduleOzonSellerCookieLifecycleSync: () => {
      calls.lifecycle += 1;
    },
    ozonSellerCookieRemovalPending: false,
  };
  vm.runInNewContext(handler, sandbox, { filename: 'ozon-seller-cookie-change.js' });
  return {
    calls,
    handle: sandbox.handleOzonSellerCookieChange,
    removalPending: () => sandbox.ozonSellerCookieRemovalPending,
  };
}

function loadSellerInsightRuntime() {
  let enqueueCall = 0;
  const getInsights = sliceBetween(
    background,
    'async function getOzonInsights',
    '\n\n// 并发批量拉取多个变体 SKU',
  );
  const sandbox = {
    OZON_ENDPOINTS: {
      analytics: 'https://seller.ozon.ru/analytics',
      bundleByVariantId: 'https://seller.ozon.ru/detail',
    },
    buildOzonAnalyticsRequestBody: () => ({}),
    enqueueOzonListInsightRequest: () => {
      enqueueCall += 1;
      if (enqueueCall === 1) {
        return Promise.resolve({
          items: [{ sku: '100', variantId: 'variant-100', soldCount: 9, name: 'Seller title' }],
        });
      }
      if (enqueueCall === 2) return Promise.resolve(null);
      return Promise.reject(new Error('detail unavailable'));
    },
    extractOzonSellerSearchItem: () => null,
    extractOzonSpecifications: () => ({}),
    fetchOzonSellerOffers: () => Promise.resolve(null),
    fetchOzonSellerSearchBySku: () => Promise.resolve(null),
    getSellerCompanyId: () => Promise.resolve('company-1'),
    normalizeErrorMessage: (error) => String(error && error.message || error),
    normalizeOzonAnalyticsRow: (row) => row,
    sellerTabFetchJson: () => Promise.resolve(null),
  };
  vm.runInNewContext(getInsights, sandbox, { filename: 'ozon-seller-insights.js' });
  return sandbox.getOzonInsights;
}

function loadAggregateRuntime() {
  const calls = { connection: 0, fetch: 0 };
  const aggregate = sliceBetween(
    background,
    'async function aggregateOzonProductInsights',
    '\n\nasync function getStoredErpConnection',
  );
  const sandbox = {
    OZON_LIST_INSIGHT_REQUEST_DEADLINE_MS: 18_000,
    applyOzonCommissionToAggregatedItem: () => Promise.resolve(),
    containsCjkText: () => false,
    fetch: () => {
      calls.fetch += 1;
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 1, data: {} }) });
    },
    fetchOzonProductViaTab: () => Promise.resolve(null),
    getOzonInsights: () => Promise.resolve({
      analytics: { items: [{}] },
      analyticsError: '',
      detailError: '',
      item: {
        sku: '100',
        soldCount: 9,
        title: 'Seller title',
        brand: 'Seller brand',
        category3: 'Seller category',
      },
      offers: null,
      searchError: '',
      searchItem: null,
      specs: { weightGrams: 500 },
    }),
    getStoredErpConnection: () => {
      calls.connection += 1;
      return Promise.resolve({ baseUrl: 'https://erp.example', token: 'legacy-token' });
    },
    normalizeCollectedTitleText: (value) => value,
    recordInsightSourceError: () => {},
    shouldFetchPublicProductFallback: () => false,
    waitForOzonInsightCookieSync: () => Promise.resolve(null),
  };
  vm.runInNewContext(aggregate, sandbox, { filename: 'ozon-aggregate-insights.js' });
  return { calls, aggregate: sandbox.aggregateOzonProductInsights };
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('Seller list queue enforces three active requests and prioritizes interactive work', async () => {
  const runtime = loadQueueRuntime();
  const releases = [];
  const started = [];
  let active = 0;
  let maximumActive = 0;
  const blocking = (name) => runtime.enqueue(() => new Promise((resolve) => {
    started.push(name);
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    releases.push(() => {
      active -= 1;
      resolve(name);
    });
  }), { priority: 'list' });

  const activeRuns = [blocking('active-1'), blocking('active-2'), blocking('active-3')];
  const queuedList = runtime.enqueue(() => {
    started.push('queued-list');
    return 'queued-list';
  }, { priority: 'list' });
  const queuedInteractive = runtime.enqueue(() => {
    started.push('queued-interactive');
    return 'queued-interactive';
  }, { priority: 'interactive' });
  await nextTurn();
  assert.equal(maximumActive, 3);
  assert.deepEqual(started, ['active-1', 'active-2', 'active-3']);

  releases.shift()();
  await nextTurn();
  assert.equal(started[3], 'queued-interactive');
  releases.splice(0).forEach((release) => release());
  await Promise.all([...activeRuns, queuedList, queuedInteractive]);
});

test('Seller list queue rejects work whose queue deadline elapsed before dispatch', async () => {
  const runtime = loadQueueRuntime();
  const releases = [];
  const blockers = Array.from({ length: 3 }, () => runtime.enqueue(() => new Promise((resolve) => {
    releases.push(resolve);
  }), { priority: 'list' }));
  const expired = runtime.enqueue(() => 'must-not-run', { priority: 'list', timeoutMs: 1000 });
  await nextTurn();
  runtime.setNow(2000);
  releases.shift()();
  await assert.rejects(expired, /expired before dispatch/);
  releases.splice(0).forEach((release) => release());
  await Promise.all(blockers);
});

test('Seller insight cache isolates company, profile, offers, and detail modes', () => {
  const runtime = loadCacheRuntime();
  const summaryOptions = {
    contextKey: 'company-1',
    profile: 'list-card',
    includeOffers: false,
    includeDetail: false,
  };
  const summary = { item: { sku: '100', soldCount: 4 } };
  runtime.set('100', summary, summaryOptions);

  assert.equal(runtime.get('100', summaryOptions), summary);
  assert.equal(runtime.get('100', { ...summaryOptions, includeDetail: true }), null);
  assert.equal(runtime.get('100', { ...summaryOptions, contextKey: 'company-2' }), null);
  assert.equal(runtime.get('100', { ...summaryOptions, profile: 'full' }), null);

  const detail = { item: { sku: '200', weightGrams: 500 } };
  runtime.set('200', detail, { ...summaryOptions, includeDetail: true });
  assert.equal(runtime.get('200', summaryOptions), detail);
});

test('Seller insight cache evicts oldest entries above its bounded capacity', () => {
  const runtime = loadCacheRuntime();
  for (let index = 0; index < 301; index += 1) {
    runtime.set(String(index), { item: { sku: String(index) } }, {
      contextKey: 'company-1',
      profile: 'list-card',
      includeOffers: false,
      includeDetail: false,
    });
  }
  assert.equal(runtime.cache.size, 300);
  assert.equal(runtime.get('0', {
    contextKey: 'company-1',
    profile: 'list-card',
    includeOffers: false,
    includeDetail: false,
  }), null);
});

test('background company epoch rejects stale cache writes and preserves replacement work', async () => {
  const runtime = loadCacheRuntime();
  const options = {
    companyId: 'company-1',
    includeDetail: false,
    includeOffers: false,
    profile: 'list-card',
  };
  const oldRequest = runtime.fetch('100', options);
  await nextTurn();
  assert.equal(runtime.pending.length, 1);

  runtime.invalidate();
  const replacement = runtime.fetch('100', options);
  await nextTurn();
  assert.equal(runtime.pending.length, 2);
  runtime.resolve(0, { item: { sku: '100', soldCount: 1 } });
  assert.equal(await oldRequest, null);
  assert.equal(runtime.cache.size, 0);
  assert.equal(runtime.inFlight.size, 1);

  const current = { item: { sku: '100', soldCount: 8 } };
  runtime.resolve(1, current);
  assert.equal(await replacement, current);
  assert.equal(runtime.cache.size, 1);
  assert.equal([...runtime.cache.values()][0].data, current);
});

test('an old company response cannot write cache or delete replacement in-flight work', async () => {
  const runtime = loadPremiumRuntime();
  const oldRequest = runtime.fetch('100', { includeDetail: false });
  await nextTurn();
  const oldKey = '0:100:summary';
  const replacement = Promise.resolve('replacement');
  runtime.inFlight.set(oldKey, replacement);
  runtime.setEpoch(1);
  runtime.resolve({ ok: true, item: { sku: '100', soldCount: 9 }, sources: ['seller'] });

  assert.equal(await oldRequest, null);
  assert.equal(runtime.cache.size, 0);
  assert.equal(runtime.inFlight.get(oldKey), replacement);
});

test('a queued old-company card request is cancelled before Seller dispatch', async () => {
  const runtime = loadPremiumRuntime();
  const releases = [];
  const blockers = Array.from({ length: 3 }, () => runtime.enqueue(() => new Promise((resolve) => {
    releases.push(resolve);
  })));
  await nextTurn();

  const staleRequest = runtime.fetch('stale-company-sku', { includeDetail: false });
  runtime.setEpoch(1);
  releases.shift()();

  assert.equal(await staleRequest, null);
  assert.equal(runtime.sendCalls(), 0);
  releases.splice(0).forEach((release) => release());
  await Promise.all(blockers);
});

test('a detached duplicate caller cannot cancel the shared request for a visible card', async () => {
  const runtime = loadPremiumRuntime();
  const releases = [];
  const blockers = Array.from({ length: 3 }, () => runtime.enqueue(() => new Promise((resolve) => {
    releases.push(resolve);
  })));
  await nextTurn();

  let firstCancelled = false;
  const first = runtime.fetch('shared-sku', {
    includeDetail: false,
    isCancelled: () => firstCancelled,
  });
  const second = runtime.fetch('shared-sku', {
    includeDetail: false,
    isCancelled: () => false,
  });
  firstCancelled = true;
  releases.shift()();
  await nextTurn();
  assert.equal(runtime.sendCalls(), 1);
  runtime.resolve({ ok: true, item: { sku: 'shared-sku', soldCount: 7 } });

  assert.equal(await first, null);
  assert.equal((await second).soldCount, 7);
  releases.splice(0).forEach((release) => release());
  await Promise.all(blockers);
});

test('an added Ozon node detached before the debounce is never scanned', () => {
  const runtime = loadScanSchedulerRuntime();
  const root = { nodeType: 1, isConnected: true, contains: () => false };
  runtime.schedule(root);
  root.isConnected = false;
  runtime.scheduled.shift()();
  assert.deepEqual(runtime.scanned, []);
});

test('Seller Cookie changes route company replacement and auth refresh without duplicate maintenance', () => {
  const removedCompany = loadSellerCookieChangeRuntime();
  removedCompany.handle({
    removed: true,
    cookie: { name: 'sc_company_id', value: 'old-company' },
  });
  assert.deepEqual(removedCompany.calls, {
    broadcast: 1,
    lifecycle: 1,
    maintenance: [],
    remembered: [],
  });
  assert.equal(removedCompany.removalPending(), true);

  const addedCompany = loadSellerCookieChangeRuntime();
  addedCompany.handle({
    removed: false,
    cookie: { name: 'sc_company_id', value: 'new-company' },
  });
  assert.deepEqual(addedCompany.calls, {
    broadcast: 1,
    lifecycle: 0,
    maintenance: ['normalized:new-company'],
    remembered: ['new-company'],
  });

  const authRefresh = loadSellerCookieChangeRuntime();
  authRefresh.handle({
    removed: false,
    cookie: { name: '__Secure-access-token', value: 'sensitive-value' },
  });
  assert.deepEqual(authRefresh.calls, {
    broadcast: 0,
    lifecycle: 1,
    maintenance: [],
    remembered: [],
  });

  const removedAuth = loadSellerCookieChangeRuntime();
  removedAuth.handle({
    removed: true,
    cookie: { name: '__Secure-access-token', value: 'sensitive-value' },
  });
  assert.deepEqual(removedAuth.calls, {
    broadcast: 0,
    lifecycle: 1,
    maintenance: [],
    remembered: [],
  });
  assert.equal(removedAuth.removalPending(), true);
});

test('captured Seller company changes invalidate context once and coalesce full maintenance', () => {
  const runtime = loadCapturedCompanyRuntime();
  assert.equal(runtime.handle('company-1', 1000), 'company-1');
  assert.deepEqual(runtime.calls, {
    broadcast: 0,
    maintenance: [],
    remembered: ['company-1'],
  });

  assert.equal(runtime.handle('company-2', 2000), 'company-2');
  assert.deepEqual(runtime.calls, {
    broadcast: 1,
    maintenance: ['company-2'],
    remembered: ['company-1', 'company-2'],
  });
});

test('Seller Cookie lifecycle debounces bursts and schedules one follow-up after in-flight work', async () => {
  const runtime = loadCookieLifecycleRuntime();
  runtime.schedule();
  runtime.schedule();
  runtime.schedule();
  assert.equal(runtime.timerCount(), 1);
  runtime.runNextTimer();
  assert.equal(runtime.syncCalls(), 1);
  assert.equal(runtime.syncOptions[0].clearIfMissingAuth, false);

  runtime.schedule();
  runtime.schedule();
  runtime.runNextTimer();
  assert.equal(runtime.syncCalls(), 1);
  runtime.resolve(0, { ok: true });
  await nextTurn();
  await nextTurn();
  assert.equal(runtime.timerCount(), 1);
  runtime.runNextTimer();
  assert.equal(runtime.syncCalls(), 2);
  runtime.resolve(1, { ok: true });
  await nextTurn();
});

test('Seller Cookie removal requests a guarded clear only after the debounce', async () => {
  const runtime = loadCookieLifecycleRuntime();
  runtime.markRemovalPending();
  runtime.schedule();
  assert.equal(runtime.syncCalls(), 0);
  runtime.runNextTimer();
  assert.equal(runtime.syncCalls(), 1);
  assert.equal(runtime.syncOptions[0].clearIfMissingAuth, true);
  runtime.resolve(0, { cleared: true, ok: true });
  await nextTurn();
  await nextTurn();
  assert.equal(runtime.clearedCompanyContexts(), 1);
  assert.equal(runtime.broadcastCompanyContexts(), 1);
});

test('Seller auth absence is confirmed only when every Cookie query succeeds', async () => {
  const partialFailure = loadSellerAuthCookieStateRuntime(async (query) => {
    if (query.domain === '.ozon.ru') return [];
    throw new Error('cookie store unavailable');
  });
  assert.equal(await partialFailure(), null);

  const absent = loadSellerAuthCookieStateRuntime(async () => []);
  assert.equal(await absent(), false);

  let calls = 0;
  const present = loadSellerAuthCookieStateRuntime(async () => {
    calls += 1;
    return [{ domain: '.ozon.ru', name: '__Secure-access-token' }];
  });
  assert.equal(await present(), true);
  assert.equal(calls, 1);
});

test('a replacement Seller login preserves its captured company after an older clear', async () => {
  const runtime = loadCookieLifecycleRuntime();
  runtime.setAuthCookieState(true);
  runtime.markRemovalPending();
  runtime.schedule();
  runtime.runNextTimer();
  runtime.resolve(0, { cleared: true, ok: true });
  await nextTurn();
  await nextTurn();
  assert.equal(runtime.clearedCompanyContexts(), 0);
  assert.equal(runtime.broadcastCompanyContexts(), 1);
});

test('Seller Cookie single-flight releases after a failed sync', async () => {
  const runtime = loadCookieLifecycleRuntime();
  runtime.schedule();
  runtime.runNextTimer();
  runtime.reject(0, new Error('sync failed'));
  await nextTurn();
  await nextTurn();

  runtime.schedule();
  runtime.runNextTimer();
  assert.equal(runtime.syncCalls(), 2);
  runtime.resolve(1, { ok: true });
  await nextTurn();
});

test('Seller detail failure preserves successful analytics and search enrichment', async () => {
  const getInsights = loadSellerInsightRuntime();
  const result = await getInsights('100', { includeOffers: false, includeDetail: true });

  assert.equal(result.item.soldCount, 9);
  assert.equal(result.item.name, 'Seller title');
  assert.equal(result.detail, null);
  assert.equal(result.specs, null);
  assert.equal(result.detailError, 'detail unavailable');
});

test('ordinary list cards skip legacy per-SKU ERP cache HTTP', async () => {
  const runtime = loadAggregateRuntime();
  const result = await runtime.aggregate('100', {
    includeDetail: true,
    includeOffers: false,
    profile: 'list-card',
  });

  assert.equal(result.item.soldCount, 9);
  assert.equal(runtime.calls.connection, 0);
  assert.equal(runtime.calls.fetch, 0);
});
