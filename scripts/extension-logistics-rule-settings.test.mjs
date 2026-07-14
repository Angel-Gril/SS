import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = fs.readFileSync('extensions/ss-erp/pages/settings.html', 'utf8');
const source = fs.readFileSync('extensions/ss-erp/pages/settings.js', 'utf8');
const workerSource = fs.readFileSync('extensions/ss-erp/background/service-worker.js', 'utf8');

test('settings exposes device pairing, scoped assignment selection, sync, and revoke controls', () => {
  for (const id of [
    'logisticsDeploymentInput',
    'logisticsPairingCodeInput',
    'logisticsDeviceLabelInput',
    'pairLogisticsDeviceBtn',
    'logisticsAssignmentSelect',
    'syncPublishedLogisticsBtn',
    'revokeLogisticsDeviceBtn',
    'logisticsDistributionStatus',
  ]) {
    assert.ok(html.includes('id="' + id + '"'), id + ' is required');
    assert.ok(source.includes("getElementById('" + id + "')"), id + ' must be wired');
  }
  assert.match(html, /id="logisticsPairingCodeInput"[^>]+type="password"/);
});

test('settings delegates secrets to the background runtime and never stores device tokens', () => {
  for (const type of [
    'ss-erp:logistics-device-claim',
    'ss-erp:logistics-device-status',
    'ss-erp:logistics-rules-sync',
    'ss-erp:logistics-device-clear',
  ]) {
    assert.ok(source.includes("type: '" + type + "'"), type + ' must be sent');
  }
  assert.equal(source.includes('ss-erp:extension-device:credential:v1'), false);
  assert.equal(source.includes('refreshToken'), false);
  assert.equal(source.includes('accessToken'), false);
});

test('settings runtime messages settle after a bounded timeout when Chrome drops the callback', async () => {
  const start = source.indexOf('function sendMessage(message)');
  const end = source.indexOf('\n  function formatRuntimeError', start);
  assert.ok(start >= 0 && end > start, 'sendMessage helper must be extractable');
  let scheduled = null;
  let callback = null;
  const context = {
    Promise,
    String,
    SS_ERP_MESSAGE_TIMEOUT_MS: 60000,
    chrome: {
      runtime: {
        lastError: null,
        sendMessage(_message, next) { callback = next; },
      },
    },
    clearTimeout() {},
    setTimeout(fn, delay) {
      scheduled = { fn, delay };
      return 1;
    },
    formatRuntimeError(message) { return String(message || ''); },
  };
  vm.runInNewContext(source.slice(start, end) + '\nthis.sendMessage = sendMessage;', context);

  const pending = context.sendMessage({ type: 'ss-erp:logistics-rules-sync' });
  assert.equal(typeof callback, 'function');
  assert.ok(scheduled, 'a lost Chrome callback must have a timeout fallback');
  assert.equal(scheduled.delay, 60000);
  scheduled.fn();

  assert.deepEqual(JSON.parse(JSON.stringify(await pending)), {
    ok: false,
    errorCode: 'runtime_timeout',
    error: '扩展后台响应超时，操作可能仍在后台执行，请刷新状态后重试。',

  });
});

test('all four manual logistics entry points delegate to unified scoped persistence', () => {
  assert.match(workerSource, /importScripts\('\.\.\/shared\/logistics-rules\/manual-fallback-persistence\.js'\)/);
  assert.equal((workerSource.match(/persistManualCalculatorData\(\{/g) || []).length, 4);
  for (const marker of [
    'if (message.type === OZON_CALC_SYNC_CHANNEL)',
    "if (message.type === 'ozon-calculator:build-config-from-captured-seller')",
    "if (message.type === 'ozon-calculator:sync-captured-seller-official')",
    "if (message.type === 'ozon-calculator:sync-captured-official')",
  ]) {
    const start = workerSource.indexOf(marker);
    const end = workerSource.indexOf('\n  if (message.type === ', start + marker.length);
    assert.ok(start >= 0 && end > start, marker + ' must be extractable');
    const handler = workerSource.slice(start, end);
    assert.match(handler, /persistManualCalculatorData\(\{/);
    assert.match(handler, /scope_required/);
  }
});

const persistencePath = 'extensions/ss-erp/shared/logistics-rules/manual-fallback-persistence.js';

function loadPersistence(options = {}) {
  assert.equal(fs.existsSync(persistencePath), true, 'manual fallback persistence helper is required');
  const context = { console, JSON, Object, Array, String, Boolean, Date };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(persistencePath, 'utf8'), context, {
    filename: 'manual-fallback-persistence.js',
  });
  return context.SS_ERP_LOGISTICS_MANUAL_FALLBACK.createPersistence(options);
}

function createStorage(initial = {}) {
  const values = JSON.parse(JSON.stringify(initial));
  const writes = [];
  return {
    writes,
    values,
    async get(keys) {
      return Object.fromEntries(keys.filter((key) => key in values).map((key) => [key, values[key]]));
    },
    async set(input) {
      writes.push(JSON.parse(JSON.stringify(input)));
      Object.assign(values, JSON.parse(JSON.stringify(input)));
    },
  };
}

const fallbackScope = {
  deploymentId: 'local-dev', tenantSubject: 'tenant-a', shopId: 'shop-a',
  ozonCompanyId: 'company-a', warehouseId: 'warehouse-a',
  originCountryUid: 'china', originCityUid: 'xiamen',
  destinationCountryUid: 'russia', destinationLocationUid: 'moscow',
  assignmentId: 'assignment-a', schemaMajor: 1,
};
const fallbackSnapshot = {
  userConfig: { selectedServiceIds: ['manual-a'] },
  catalogSnapshot: { metadata: { source: 'erp_release' }, services: [{ id: 'manual-a' }] },
  ruleSnapshot: { services: [{ serviceId: 'manual-a' }] },
};

test('manual persistence fails closed when distribution is enabled without an active scope', async () => {
  const storage = createStorage({ 'ozon-calc:config-snapshot': { legacy: true } });
  const persistence = loadPersistence({
    storage,
    isFeatureEnabled: () => true,
    runtime: { async saveLocalFallback() { throw new Error('must not run'); } },
  });

  const result = await persistence.persist({ snapshot: fallbackSnapshot });

  assert.equal(result.state, 'scope_required');
  assert.equal(storage.writes.length, 0);
  assert.deepEqual(storage.values['ozon-calc:config-snapshot'], { legacy: true });
});

test('manual persistence keeps healthy remote rules active and scopes fallback samples exactly', async () => {
  const storage = createStorage({
    'ozon-logistics:calculator-state:v1': { scope: fallbackScope, state: 'healthy', source: 'remote' },
  });
  const calls = [];
  const remoteState = { state: 'healthy', source: 'remote', quoteAllowed: true, snapshot: { remote: true } };
  const persistence = loadPersistence({
    storage,
    isFeatureEnabled: () => true,
    runtime: {
      async saveLocalFallback() { throw new Error('erp_release must use one atomic command'); },
      async updatePreferences() { throw new Error('erp_release must use one atomic command'); },
      async saveLocalFallbackWithPreferences(input) {
        calls.push(['configuration', input]); return remoteState;
      },
    },
  });
  const officialSnapshot = {
    samples: [
      { request: { origin: { countryUid: 'china', cityUid: 'xiamen' }, destination: { countryUid: 'russia', locationUid: 'moscow' } } },
      { request: { origin: { countryUid: 'china', cityUid: 'shenzhen' }, destination: { countryUid: 'russia', locationUid: 'moscow' } } },
    ],
  };

  const result = await persistence.persist({
    snapshot: fallbackSnapshot,
    officialSnapshot,
    source: 'erp_release',
  });

  assert.equal(result.state, 'healthy');
  assert.equal(result.mode, 'scoped_fallback');
  assert.equal(calls[0][0], 'configuration');
  assert.equal(calls[0][1].officialSnapshot.samples.length, 1);
  assert.equal(calls[0][1].officialSnapshot.scope.assignmentId, fallbackScope.assignmentId);
  assert.equal(calls.length, 1);
  assert.equal(storage.writes.length, 0);
});

test('Official-only persistence delegates to the exact existing scoped fallback', async () => {
  const storage = createStorage({
    'ozon-logistics:calculator-state:v1': { scope: fallbackScope, state: 'local_fallback' },
  });
  let saved = null;
  const persistence = loadPersistence({
    storage,
    isFeatureEnabled: () => true,
    runtime: {
      async saveLocalFallback(input) {
        saved = input;
        return { state: 'local_fallback', snapshot: fallbackSnapshot, officialSnapshot: input.officialSnapshot };
      },
    },
  });

  const result = await persistence.persist({
    officialSnapshot: {
      samples: [{ request: { origin: { countryUid: 'china', cityUid: 'xiamen' }, destination: { countryUid: 'russia', locationUid: 'moscow' } } }],
    },
  });

  assert.equal(saved.snapshot, undefined);
  assert.equal(saved.scopeBinding.assignmentId, fallbackScope.assignmentId);
  assert.equal(result.state, 'local_fallback');
});

test('manual persistence retains legacy global storage only while distribution is disabled', async () => {
  const storage = createStorage();
  const officialSnapshot = { tariffs: [{ id: 'official-a' }] };
  const persistence = loadPersistence({
    storage,
    isFeatureEnabled: () => false,
    getRuntime() { throw new Error('must not run'); },
    now: () => new Date('2026-07-14T00:00:00.000Z'),
  });

  const result = await persistence.persist({ snapshot: fallbackSnapshot, officialSnapshot });

  assert.equal(result.mode, 'legacy_unscoped');
  assert.deepEqual(storage.values['ozon-calc:config-snapshot'], fallbackSnapshot);
  assert.deepEqual(storage.values['ozon-calculator:official-snapshot'], officialSnapshot);
  assert.equal(storage.values['ozon-calc:config-updated-at'], '2026-07-14T00:00:00.000Z');
});
