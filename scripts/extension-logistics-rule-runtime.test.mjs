import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const sources = [
  'extensions/ss-erp/shared/logistics-rules/device-credential-manager.js',
  'extensions/ss-erp/shared/logistics-rules/distribution-store.js',
  'extensions/ss-erp/shared/logistics-rules/distribution-client.js',
  'extensions/ss-erp/shared/logistics-rules/distribution-runtime.js',
].map((path) => [path, fs.readFileSync(path, 'utf8')]);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createStorage() {
  const values = new Map();
  return {
    async get(keys) {
      const requested = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(
        requested.filter((key) => values.has(key)).map((key) => [key, clone(values.get(key))]),
      );
    },
    async set(input) {
      for (const [key, value] of Object.entries(input)) values.set(key, clone(value));
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key);
    },
    all() { return Object.fromEntries([...values.entries()].map(([key, value]) => [key, clone(value)])); },
  };
}

function jwt(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode(payload) + '.signature';
}

function response(status, body, headers = {}) {
  const normalized = new Map(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]),
  );
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => normalized.get(String(name).toLowerCase()) || null },
    async json() { return body; },
  };
}

function scopedReleaseBundle(assignment, selectedServiceKeys) {
  return {
    schema: 'ozon-logistics-release/v1',
    scope: {
      tenantId: 'owner-1',
      shopId: assignment.shopId,
      ozonCompanyId: assignment.companyId,
      warehouseId: assignment.warehouseId,
      originCountryUid: assignment.originCountryUid,
      originCityUid: assignment.originCityUid,
      destinationCountryUid: assignment.destinationCountryUid,
      destinationLocationUid: assignment.destinationLocationUid,
    },
    revisionPayload: {
      scope: {
        deploymentId: 'local-dev',
        tenantId: 'owner-1',
        shopId: assignment.shopId,
        ozonCompanyId: assignment.companyId,
        erpWarehouseId: assignment.warehouseId,
        originCountryUid: assignment.originCountryUid,
        originCityUid: assignment.originCityUid,
        destinationCountryUid: assignment.destinationCountryUid,
        destinationLocationUid: assignment.destinationLocationUid,
        schemaMajor: 1,
      },
    },
    assignment: {
      id: assignment.assignmentId,
    },
    selectedServiceKeys,
  };
}

function loadRuntime(options, globals = {}) {
  const context = {
    Date, JSON, Number, Object, Array, String, Boolean, Set, Map, Promise, URL, atob,
  };
  context.globalThis = context;
  for (const [path, source] of sources) {
    vm.runInNewContext(source, context, { filename: path });
  }
  Object.assign(context, globals);
  return context.SS_ERP_LOGISTICS_DISTRIBUTION_RUNTIME.createRuntime(options);
}

function createUpgradeRequiredRuntimeFixture() {
  const localStorage = createStorage();
  let currentTime = new Date('2026-07-12T12:00:00.000Z');
  let upgradeRequired = false;
  const operation = {
    state: 'paired',
    epoch: 1,
    baseUrl: 'https://erp.example',
    deploymentId: 'local-dev',
    sessionId: 'session-a',
    deviceId: 'device-a',
    ownerUserId: 'owner-1',
    scopes: ['logistics:discover', 'logistics:read', 'logistics:receipt'],
    accessToken: 'device-token-a',
    expiresAt: '2026-08-12T12:00:00.000Z',
  };
  const assignment = {
    assignmentId: 'assignment-a',
    shopId: 'shop-a',
    shopName: 'Xiamen pilot',
    companyId: 'company-a',
    warehouseId: 'warehouse-a',
    warehouseName: 'Xiamen warehouse',
    originCountryUid: 'china',
    originCityUid: 'xiamen',
    originLabel: 'China / Xiamen',
    destinationCountryUid: 'russia',
    destinationLocationUid: 'moscow',
    destinationLabel: 'Russia / Moscow',
    releaseSequence: 1,
  };
  const credentials = {
    async claim() { return operation; },
    async clear() { return { state: 'unpaired' }; },
    async getStatus() { return operation; },
    async getConnection() { return operation; },
    async getAccessToken() { return operation.accessToken; },
    async beginOperation() { return operation; },
    async isOperationCurrent(candidate) { return candidate === operation; },
    async clearIfCurrent() { return true; },
  };
  const runtime = loadRuntime({
    localStorage,
    credentials,
    fetchImpl: async (url) => {
      if (url.endsWith('/api/logistics-rules/assignments')) {
        return response(200, { code: 1, data: { assignments: [assignment] } });
      }
      if (url.endsWith('/assignments/assignment-a/effective')) {
        if (upgradeRequired) {
          return response(426, {
            code: 0,
            errorCode: 'upgrade_required',
            data: { minExtensionVersion: '2.0.0' },
          });
        }
        return response(200, {
          code: 1,
          data: {
            deploymentId: 'local-dev',
            assignmentId: 'assignment-a',
            releaseId: 'release-1',
            releaseSequence: 1,
            contentChecksum: 'a'.repeat(64),
            effectiveChecksum: 'b'.repeat(64),
            minExtensionVersion: '1.0.0',
            validUntil: '2026-07-19T12:00:00.000Z',
            staleUntil: '2026-07-20T12:00:00.000Z',
            authorizationValidUntil: '2026-08-01T12:00:00.000Z',
            serverTime: '2026-07-12T12:00:00.000Z',
            bundle: scopedReleaseBundle(assignment, ['service-1']),
          },
        }, { etag: '"release-1"' });
      }
      if (url.endsWith('/releases/release-1/receipts')) {
        return response(201, {
          code: 1,
          data: { receiptId: 'receipt-1', duplicate: false },
        });
      }
      throw new Error('unexpected request ' + url);
    },
    validateBundle: (bundle) => ({ valid: true, bundle }),
    buildCalculatorState({ usable, expectedScope }) {
      const usableRemote = usable.quoteAllowed === true && Boolean(usable.bundle);
      return {
        state: usable.state,
        source: usableRemote ? 'remote' : 'none',
        quoteAllowed: usableRemote,
        scope: expectedScope,
        releaseId: usableRemote ? usable.bundle.releaseId : null,
        snapshot: usableRemote ? { marker: 'policy-valid-lkg' } : null,
        officialSnapshot: null,
      };
    },
    randomId: () => 'receipt-id-0000001',
    now: () => new Date(currentTime),
  });
  return {
    localStorage,
    runtime,
    requireUpgrade() { upgradeRequired = true; },
    setTime(value) { currentTime = new Date(value); },
  };
}

test('one paired device discovers, applies, and acknowledges the single Xiamen assignment', async () => {
  const localStorage = createStorage();
  const requests = [];
  let revokeDiscovery = false;
  const accessToken = jwt({
    exp: Math.floor(new Date('2026-07-12T12:15:00.000Z').getTime() / 1000),
    typ: 'extension_device',
  });
  const assignment = {
    assignmentId: 'assignment-a',
    shopId: 'shop-a',
    shopName: 'Xiamen pilot',
    companyId: 'company-a',
    warehouseId: 'warehouse-a',
    warehouseName: 'Xiamen warehouse',
    originCountryUid: 'china',
    originCityUid: 'xiamen',
    originLabel: 'China / Xiamen',
    destinationCountryUid: 'russia',
    destinationLocationUid: 'moscow',
    destinationLabel: 'Russia / Moscow',
    releaseSequence: 1,
  };
  const calculatorInputs = [];
  const runtime = loadRuntime({
    localStorage,
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      if (url.endsWith('/pairing-claims')) {
        return response(201, {
          code: 1,
          data: {
            session: {
              id: 'session-1',
              deploymentId: 'local-dev',
              deviceId: 'device-1',
              actorUserId: 'owner-1',
              ownerUserId: 'owner-1',
              scopes: ['logistics:discover', 'logistics:read', 'logistics:receipt'],
              currentJti: 'jti-1',
              expiresAt: '2026-08-11T12:00:00.000Z',
            },
            accessToken,
            refreshToken: 'r'.repeat(43),
          },
        });
      }
      if (url.endsWith('/api/logistics-rules/assignments')) {
        if (revokeDiscovery) return response(401, { code: 0 });
        return response(200, { code: 1, data: { assignments: [assignment] } });
      }
      if (url.endsWith('/assignments/assignment-a/effective')) {
        return response(200, {
          code: 1,
          data: {
            deploymentId: 'local-dev',
            assignmentId: 'assignment-a',
            releaseId: 'release-1',
            releaseSequence: 1,
            contentChecksum: 'a'.repeat(64),
            effectiveChecksum: 'b'.repeat(64),
            minExtensionVersion: '1.0.0',
            validUntil: '2026-07-19T12:00:00.000Z',
            staleUntil: '2026-07-20T12:00:00.000Z',
            authorizationValidUntil: '2026-07-13T12:00:00.000Z',
            serverTime: '2026-07-12T12:00:00.000Z',
            bundle: scopedReleaseBundle(assignment, ['service-1']),
          },
        }, { etag: '"release-1"' });
      }
      if (url.endsWith('/releases/release-1/receipts')) {
        return response(201, {
          code: 1,
          data: { receiptId: 'receipt-1', duplicate: false },
        });
      }
      throw new Error('unexpected request ' + url);
    },
    validateBundle: (bundle) => bundle && bundle.schemaVersion === 'ozon-logistics/delivery-v1'
      ? { valid: true, bundle }
      : { valid: false, errors: ['invalid delivery envelope'] },
    buildCalculatorState(input) {
      calculatorInputs.push(clone(input));
      return {
        state: input.usable.state,
        source: 'remote',
        quoteAllowed: true,
        scope: input.expectedScope,
        snapshot: { userConfig: { selectedServiceIds: ['service-1'] } },
        officialSnapshot: null,
      };
    },
    randomId: () => '0123456789abcdef',
    now: () => new Date('2026-07-12T12:00:00.000Z'),
  });

  const paired = await runtime.claim({
    baseUrl: 'https://erp.example',
    code: 'p'.repeat(22),
    deploymentId: 'local-dev',
    deviceId: 'device-1',
    deviceLabel: 'Chrome Xiamen',
  });
  const [synced, duplicateWake] = await Promise.all([
    runtime.syncStored({
      reason: 'startup', extensionVersion: '1.2.0',
    }),
    runtime.syncStored({
      reason: 'alarm', extensionVersion: '1.2.0',
    }),
  ]);

  assert.equal(paired.state, 'paired');
  assert.equal(synced.state, 'active');
  assert.equal(synced.assignment.assignmentId, 'assignment-a');
  assert.equal(synced.assignment.originCityUid, 'xiamen');
  assert.equal(synced.assignment.destinationLocationUid, 'moscow');
  assert.equal(synced.receipt.state, 'reported');
  assert.equal(duplicateWake.releaseId, synced.releaseId);
  assert.equal(requests.length, 4);
  assert.equal(JSON.stringify({ paired, synced }).includes(accessToken), false);
  assert.equal(JSON.stringify({ paired, synced }).includes('r'.repeat(43)), false);

  const storage = localStorage.all();
  const pointerKey = Object.keys(storage).find((key) => key.endsWith(':pointer'));
  assert.equal(calculatorInputs.length, 1);
  assert.equal(calculatorInputs[0].expectedScope.originCityUid, 'xiamen');
  assert.equal(calculatorInputs[0].usable.state, 'healthy');
  assert.equal(calculatorInputs[0].usable.authorizationValidUntil, '2026-07-13T12:00:00.000Z');
  assert.equal(calculatorInputs[0].usable.validUntil, '2026-07-19T12:00:00.000Z');
  assert.equal(calculatorInputs[0].usable.staleUntil, '2026-07-20T12:00:00.000Z');
  assert.equal(storage['ozon-logistics:calculator-state:v1'].quoteAllowed, true);
  assert.deepEqual(storage['ozon-logistics:calculator-state:v1'].authority, {
    sessionId: 'session-1',
    deploymentId: 'local-dev',
    ownerUserId: 'owner-1',
  });
  assert.equal(storage['ozon-logistics:calculator-state:v1'].authorizationValidUntil, '2026-07-13T12:00:00.000Z');
  assert.equal(storage['ozon-logistics:calculator-state:v1'].validUntil, '2026-07-19T12:00:00.000Z');
  assert.equal(storage['ozon-logistics:calculator-state:v1'].staleUntil, '2026-07-20T12:00:00.000Z');
  assert.deepEqual(storage['ozon-logistics:calculator-state:v1'].route, {
    source: 'erp_assignment',
    assignmentId: 'assignment-a',
    originCountryUid: 'china',
    originCityUid: 'xiamen',
    destinationCountryUid: 'russia',
    destinationLocationUid: 'moscow',
    originLabel: 'China / Xiamen',
    destinationLabel: 'Russia / Moscow',
  });
  assert.deepEqual(storage['ozon-logistics:calculator-state:v1'].snapshot.userConfig.selectedServiceIds, ['service-1']);
  assert.ok(pointerKey);
  assert.equal(storage[pointerKey].activeChecksum, 'b'.repeat(64));
  assert.equal(storage[pointerKey].pendingReceipt, null);
  assert.equal(storage[pointerKey].lastReceipt.receiptId, 'receipt-1');

  await runtime.updatePreferences({
    snapshot: {
      userConfig: { selectedServiceIds: ['service-1'], resolutionMode: 'priority' },
      formState: { packingFee: 7 },
    },
  });
  await runtime.saveLocalFallback({
    snapshot: {
      userConfig: { selectedServiceIds: ['manual-1'], resolutionMode: 'lowest_cost' },
      formState: { packingFee: 5 },
      catalogSnapshot: { services: [{ id: 'manual-1' }] },
      ruleSnapshot: { services: [{ serviceId: 'manual-1' }] },
    },
    scopeBinding: localStorage.all()['ozon-logistics:calculator-state:v1'].scope,
  });

  const scopedStorage = localStorage.all();
  const preferenceKey = Object.keys(scopedStorage).find((key) => key.startsWith('ozon-logistics:preferences:v1:'));
  const fallbackKey = Object.keys(scopedStorage).find((key) => key.startsWith('ozon-logistics:fallback:v1:'));
  assert.ok(preferenceKey);
  assert.ok(fallbackKey);
  assert.equal(scopedStorage[preferenceKey].scope.originCityUid, 'xiamen');
  assert.equal(scopedStorage[preferenceKey].formState.packingFee, 7);
  assert.equal(scopedStorage[fallbackKey].scope.destinationLocationUid, 'moscow');
  assert.equal(calculatorInputs.length, 3);
  assert.equal(calculatorInputs[1].localPreferences.userConfig.resolutionMode, 'priority');
  assert.equal(calculatorInputs[2].localFallback.snapshot.userConfig.selectedServiceIds[0], 'manual-1');
  revokeDiscovery = true;
  const revoked = await runtime.syncStored({ reason: 'manual', extensionVersion: '1.2.0' });
  const revokedState = localStorage.all()['ozon-logistics:calculator-state:v1'];
  assert.equal(revoked.state, 'revoked');
  assert.equal(revokedState.state, 'revoked');
  assert.equal(revokedState.quoteAllowed, false);

  await runtime.clear();
  const cleared = localStorage.all()['ozon-logistics:calculator-state:v1'];
  assert.equal(cleared, undefined);
});

test('upgrade_required preserves a policy-valid last-known-good and assignment selection', async () => {
  const fixture = createUpgradeRequiredRuntimeFixture();
  const first = await fixture.runtime.syncStored({ reason: 'manual', extensionVersion: '1.2.0' });
  const before = fixture.localStorage.all();
  const pointerKey = Object.keys(before).find((key) => key.endsWith(':pointer'));
  const calculatorKey = 'ozon-logistics:calculator-state:v1';
  const selectionKey = 'ss-erp:logistics:selection:v1';

  fixture.requireUpgrade();
  const result = await fixture.runtime.syncStored({ reason: 'manual', extensionVersion: '1.2.0' });
  const after = fixture.localStorage.all();

  assert.equal(first.state, 'active');
  assert.equal(result.state, 'upgrade_required');
  assert.equal(result.assignment.assignmentId, 'assignment-a');
  assert.equal(result.calculatorState.quoteAllowed, true);
  assert.equal(result.calculatorState.snapshot.marker, 'policy-valid-lkg');
  assert.deepEqual(after[pointerKey], before[pointerKey]);
  assert.deepEqual(after[calculatorKey], before[calculatorKey]);
  assert.deepEqual(after[selectionKey], before[selectionKey]);
});

test('upgrade_required does not keep an expired last-known-good quotable', async () => {
  const fixture = createUpgradeRequiredRuntimeFixture();
  await fixture.runtime.syncStored({ reason: 'manual', extensionVersion: '1.2.0' });
  const before = fixture.localStorage.all();
  const pointerKey = Object.keys(before).find((key) => key.endsWith(':pointer'));
  const calculatorKey = 'ozon-logistics:calculator-state:v1';
  const selectionKey = 'ss-erp:logistics:selection:v1';

  fixture.setTime('2026-07-21T12:00:00.000Z');
  fixture.requireUpgrade();
  const result = await fixture.runtime.syncStored({ reason: 'manual', extensionVersion: '1.2.0' });
  const after = fixture.localStorage.all();

  assert.equal(result.state, 'upgrade_required');
  assert.equal(result.calculatorState.state, 'expired');
  assert.equal(result.calculatorState.quoteAllowed, false);
  assert.equal(result.calculatorState.snapshot, null);
  assert.deepEqual(after[pointerKey], before[pointerKey]);
  assert.equal(after[calculatorKey].quoteAllowed, false);
  assert.equal(after[calculatorKey].snapshot, null);
  assert.equal(after[selectionKey].assignmentId, 'assignment-a');
});

test('upgrade_required without a prior active release remains non-quotable', async () => {
  const fixture = createUpgradeRequiredRuntimeFixture();
  const calculatorKey = 'ozon-logistics:calculator-state:v1';
  const selectionKey = 'ss-erp:logistics:selection:v1';

  fixture.requireUpgrade();
  const result = await fixture.runtime.syncStored({ reason: 'manual', extensionVersion: '1.2.0' });
  const stored = fixture.localStorage.all();
  const pointerKey = Object.keys(stored).find((key) => key.endsWith(':pointer'));

  assert.equal(result.state, 'upgrade_required');
  assert.equal(result.calculatorState.state, 'no_config');
  assert.equal(result.calculatorState.quoteAllowed, false);
  assert.equal(result.calculatorState.snapshot, null);
  assert.equal(pointerKey, undefined);
  assert.equal(stored[calculatorKey].quoteAllowed, false);
  assert.equal(stored[calculatorKey].snapshot, null);
  assert.equal(stored[selectionKey].assignmentId, 'assignment-a');
});

test('scheduled failures persist bounded backoff and skip premature network retries', async () => {
  const localStorage = createStorage();
  const accessToken = jwt({
    exp: Math.floor(new Date('2026-07-12T12:15:00.000Z').getTime() / 1000),
  });
  let requests = 0;
  const runtime = loadRuntime({
    localStorage,
    fetchImpl: async (url) => {
      requests += 1;
      if (url.endsWith('/pairing-claims')) {
        return response(201, {
          code: 1,
          data: {
            session: {
              id: 'session-1', deploymentId: 'local-dev', deviceId: 'device-1',
              ownerUserId: 'owner-1', scopes: ['logistics:discover'],
              expiresAt: '2026-08-11T12:00:00.000Z',
            },
            accessToken,
            refreshToken: 'r'.repeat(43),
          },
        });
      }
      return response(503, { code: 0 });
    },
    validateBundle: () => ({ valid: false, errors: ['unused'] }),
    randomId: () => '0123456789abcdef',
    random: () => 0.5,
    now: () => new Date('2026-07-12T12:00:00.000Z'),
  });

  await runtime.claim({
    baseUrl: 'https://erp.example', code: 'p'.repeat(22), deploymentId: 'local-dev',
    deviceId: 'device-1', deviceLabel: 'Chrome Xiamen',
  });
  const failed = await runtime.syncStored({ reason: 'alarm', extensionVersion: '1.2.0' });
  const backedOff = await runtime.syncStored({ reason: 'alarm', extensionVersion: '1.2.0' });

  assert.equal(failed.state, 'http_error');
  assert.equal(backedOff.state, 'backoff');
  assert.match(backedOff.nextAttemptAt, /^2026-07-12T12:/);
  assert.equal(requests, 2, 'claim plus one discovery request; backoff must skip the retry');
});
test('device pairing and synchronization messages reject non-settings senders', async () => {
  const calls = [];
  const runtime = {
    async claim(input) { calls.push(['claim', input]); return { state: 'paired' }; },
    async sync(input) { calls.push(['sync', input]); return { state: 'active' }; },
    async clear() { calls.push(['clear']); return { state: 'unpaired' }; },
    async getStatus() { calls.push(['status']); return { state: 'paired' }; },
  };
  const context = {
    Date, JSON, Number, Object, Array, String, Boolean, Set, Map, Promise, URL, atob,
  };
  context.globalThis = context;
  for (const [path, source] of sources) {
    vm.runInNewContext(source, context, { filename: path });
  }
  const handler = context.SS_ERP_LOGISTICS_DISTRIBUTION_RUNTIME.createMessageHandler({
    runtime,
    extensionId: 'extension-id',
    isTrustedSettingsSender: (sender) => sender && sender.id === 'extension-id'
      && sender.url === 'chrome-extension://extension-id/pages/settings.html',
  });

  const denied = await handler(
    { type: 'ss-erp:logistics-device-claim', code: 'secret-code' },
    { id: 'extension-id', url: 'https://evil.example/' },
  );
  const allowed = await handler(
    {
      type: 'ss-erp:logistics-device-claim',
      baseUrl: 'https://erp.example',
      code: 'p'.repeat(22),
      deploymentId: 'local-dev',
      deviceId: 'device-1',
      deviceLabel: 'Chrome Xiamen',
    },
    { id: 'extension-id', url: 'chrome-extension://extension-id/pages/settings.html' },
  );

  assert.deepEqual(JSON.parse(JSON.stringify(denied)), {
    handled: true,
    ok: false,
    errorCode: 'untrusted_sender',
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'claim');
  assert.deepEqual(JSON.parse(JSON.stringify(allowed)), {
    handled: true,
    ok: true,
    data: { state: 'paired' },
  });
});

test('manual synchronization message returns a compact summary instead of the persisted rule snapshot', async () => {
  const largeCalculatorState = {
    state: 'healthy',
    snapshot: {
      ruleSnapshot: {
        services: Array.from({ length: 285 }, (_, index) => ({
          serviceId: 'service-' + index,
          formula: { basePriceMinor: index, padding: 'x'.repeat(1000) },
        })),
      },
    },
  };
  const runtime = {
    async sync() {
      return {
        state: 'active',
        assignment: {
          assignmentId: 'assignment-a',
          originLabel: 'China / Xiamen',
          destinationLabel: 'Russia / Moscow',
        },
        releaseId: 'release-a',
        releaseSequence: 7,
        calculatorState: largeCalculatorState,
      };
    },
    async claim() { return { state: 'paired' }; },
    async clear() { return { state: 'unpaired' }; },
    async getStatus() { return { state: 'paired' }; },
  };
  const context = {
    Date, JSON, Number, Object, Array, String, Boolean, Set, Map, Promise, URL, atob,
  };
  context.globalThis = context;
  for (const [path, moduleSource] of sources) {
    vm.runInNewContext(moduleSource, context, { filename: path });
  }
  const handler = context.SS_ERP_LOGISTICS_DISTRIBUTION_RUNTIME.createMessageHandler({
    runtime,
    extensionId: 'extension-id',
    isTrustedSettingsSender: () => true,
  });

  const response = clone(await handler({
    type: 'ss-erp:logistics-rules-sync',
    baseUrl: 'https://erp.example',
    extensionVersion: '1.0.194',
  }, { id: 'extension-id', url: 'chrome-extension://extension-id/pages/settings.html' }));

  assert.deepEqual(response, {
    handled: true,
    ok: true,
    data: {
      state: 'active',
      assignment: {
        assignmentId: 'assignment-a',
        originLabel: 'China / Xiamen',
        destinationLabel: 'Russia / Moscow',
      },
      releaseId: 'release-a',
      releaseSequence: 7,
    },
  });
  assert.equal(JSON.stringify(response).includes('calculatorState'), false);
  assert.ok(JSON.stringify(response).length < 2000);
});
test('two independent devices survive 20 worker restarts, updates, and rollback applies', async () => {
  const now = new Date('2026-07-12T12:00:00.000Z');
  const releases = [
    {
      id: 'release-1', sequence: 1, contentChecksum: 'a'.repeat(64),
      effectiveChecksum: 'b'.repeat(64), serviceKey: 'service-1',
    },
    {
      id: 'release-2', sequence: 2, contentChecksum: 'c'.repeat(64),
      effectiveChecksum: 'd'.repeat(64), serviceKey: 'service-2',
    },
    {
      id: 'release-3', sequence: 3, contentChecksum: 'a'.repeat(64),
      effectiveChecksum: 'e'.repeat(64), serviceKey: 'service-1',
    },
  ];
  let activeRelease = releases[0];
  const receipts = new Map();
  const requestCounts = { effective200: 0, effective304: 0, receipt: 0 };
  const devices = ['device-a', 'device-b'].map((deviceId, index) => {
    const suffix = index === 0 ? 'a' : 'b';
    return {
      deviceId,
      sessionId: `session-${suffix}`,
      accessToken: jwt({
        exp: Math.floor(new Date('2026-07-12T13:00:00.000Z').getTime() / 1000),
        typ: 'extension_device',
        deviceId,
      }),
      refreshToken: suffix.repeat(43),
      assignment: {
        assignmentId: `assignment-${suffix}`,
        shopId: `shop-${suffix}`,
        shopName: `Xiamen pilot ${suffix.toUpperCase()}`,
        companyId: `company-${suffix}`,
        warehouseId: `warehouse-${suffix}`,
        warehouseName: `Xiamen warehouse ${suffix.toUpperCase()}`,
        originCountryUid: 'china',
        originCityUid: 'xiamen',
        originLabel: 'China / Xiamen',
        destinationCountryUid: 'russia',
        destinationLocationUid: 'moscow',
        destinationLabel: 'Russia / Moscow',
        releaseSequence: 1,
      },
      storage: createStorage(),
    };
  });
  const deviceByToken = new Map(devices.map((device) => [device.accessToken, device]));

  function requestDevice(init) {
    const authorization = init && init.headers && (init.headers.Authorization || init.headers.authorization);
    return deviceByToken.get(String(authorization || '').replace(/^Bearer\s+/i, ''));
  }

  async function fetchImpl(url, init = {}) {
    if (url.endsWith('/pairing-claims')) {
      const body = JSON.parse(init.body);
      const device = devices.find((candidate) => candidate.deviceId === body.deviceId);
      assert.ok(device, 'pairing must name one of the pilot devices');
      return response(201, {
        code: 1,
        data: {
          session: {
            id: device.sessionId,
            deploymentId: 'local-dev',
            deviceId: device.deviceId,
            actorUserId: 'owner-1',
            ownerUserId: 'owner-1',
            scopes: ['logistics:discover', 'logistics:read', 'logistics:receipt'],
            currentJti: `jti-${device.deviceId}`,
            expiresAt: '2026-08-11T12:00:00.000Z',
          },
          accessToken: device.accessToken,
          refreshToken: device.refreshToken,
        },
      });
    }

    if (url.endsWith('/api/extension-device/refresh')) {
      const body = JSON.parse(init.body);
      const device = devices.find((candidate) => candidate.refreshToken === body.refreshToken);
      assert.ok(device, 'refresh must use one device-only rotating credential');
      return response(200, {
        code: 1,
        data: {
          session: {
            id: device.sessionId,
            deploymentId: 'local-dev',
            deviceId: device.deviceId,
            actorUserId: 'owner-1',
            ownerUserId: 'owner-1',
            scopes: ['logistics:discover', 'logistics:read', 'logistics:receipt'],
            currentJti: `jti-${device.deviceId}`,
            expiresAt: '2026-08-11T12:00:00.000Z',
          },
          accessToken: device.accessToken,
          refreshToken: device.refreshToken,
        },
      });
    }

    const device = requestDevice(init);
    assert.ok(device, 'all distribution requests must use a paired device token');
    if (url.endsWith('/api/logistics-rules/assignments')) {
      return response(200, {
        code: 1,
        data: {
          assignments: [{ ...device.assignment, releaseSequence: activeRelease.sequence }],
        },
      });
    }
    if (url.endsWith(`/assignments/${device.assignment.assignmentId}/effective`)) {
      const etag = `"${device.assignment.assignmentId}:${activeRelease.id}"`;
      const ifNoneMatch = init.headers['If-None-Match'] || init.headers['if-none-match'];
      const leaseHeaders = {
        etag,
        'x-ss-erp-server-time': now.toISOString(),
        'x-ss-erp-authorization-valid-until': '2026-07-13T12:00:00.000Z',
      };
      if (ifNoneMatch === etag) {
        requestCounts.effective304 += 1;
        return response(304, null, leaseHeaders);
      }
      requestCounts.effective200 += 1;
      return response(200, {
        code: 1,
        data: {
          deploymentId: 'local-dev',
          assignmentId: device.assignment.assignmentId,
          releaseId: activeRelease.id,
          releaseSequence: activeRelease.sequence,
          contentChecksum: activeRelease.contentChecksum,
          effectiveChecksum: activeRelease.effectiveChecksum,
          minExtensionVersion: '1.0.0',
          validUntil: '2026-07-19T12:00:00.000Z',
          staleUntil: '2026-07-20T12:00:00.000Z',
          authorizationValidUntil: '2026-07-13T12:00:00.000Z',
          serverTime: now.toISOString(),
          bundle: scopedReleaseBundle(device.assignment, [activeRelease.serviceKey]),
        },
      }, leaseHeaders);
    }
    if (url.endsWith(`/releases/${activeRelease.id}/receipts`)) {
      requestCounts.receipt += 1;
      const body = JSON.parse(init.body);
      const key = `${device.sessionId}:${activeRelease.id}:${body.idempotencyKey}`;
      const duplicate = receipts.has(key);
      if (!duplicate) receipts.set(key, body);
      return response(duplicate ? 200 : 201, {
        code: 1,
        data: { receiptId: `receipt-${device.deviceId}-${activeRelease.sequence}`, duplicate },
      });
    }
    throw new Error(`unexpected pilot request ${url}`);
  }

  const runtimeOptions = (device) => ({
    localStorage: device.storage,
    fetchImpl,
    validateBundle: (bundle) => bundle && bundle.schemaVersion === 'ozon-logistics/delivery-v1'
      ? { valid: true, bundle }
      : { valid: false, errors: ['invalid delivery envelope'] },
    buildCalculatorState(input) {
      return {
        state: input.usable.state,
        source: 'remote',
        quoteAllowed: input.usable.quoteAllowed !== false,
        scope: input.expectedScope,
        snapshot: input.usable.bundle,
        officialSnapshot: null,
      };
    },
    randomId: () => `receipt-key-${device.deviceId}`,
    now: () => now,
  });

  for (const device of devices) {
    const runtime = loadRuntime(runtimeOptions(device));
    const paired = await runtime.claim({
      baseUrl: 'https://erp.example',
      code: 'p'.repeat(22),
      deploymentId: 'local-dev',
      deviceId: device.deviceId,
      deviceLabel: `Pilot ${device.deviceId}`,
    });
    assert.equal(paired.state, 'paired');
  }

  for (let cycle = 0; cycle < 20; cycle += 1) {
    if (cycle === 7) activeRelease = releases[1];
    if (cycle === 14) activeRelease = releases[2];
    for (const device of devices) {
      const restartedRuntime = loadRuntime(runtimeOptions(device));
      const result = await restartedRuntime.syncStored({
        reason: 'startup',
        extensionVersion: '1.2.0',
      });
      assert.ok(
        result.state === 'active' || result.state === 'not_modified',
        JSON.stringify({ cycle, deviceId: device.deviceId, result }),
      );
      assert.equal(result.assignment.assignmentId, device.assignment.assignmentId);
      assert.equal(result.assignment.shopId, device.assignment.shopId);
      const stored = device.storage.all();
      const pointerKey = Object.keys(stored).find((key) => key.endsWith(':pointer'));
      assert.ok(pointerKey);
      assert.equal(stored[pointerKey].activeChecksum, activeRelease.effectiveChecksum);
      assert.equal(stored[pointerKey].pendingReceipt, null);
      assert.equal(stored['ozon-logistics:calculator-state:v1'].scope.shopId, device.assignment.shopId);
    }
  }

  assert.equal(requestCounts.effective200, 6, 'three immutable releases apply once per device');
  assert.equal(requestCounts.effective304, 34, 'unchanged restarts must reuse ETag');
  assert.equal(requestCounts.receipt, 6, 'each device acknowledges each release once');
  assert.equal(receipts.size, 6, 'apply receipts remain idempotent across worker restarts');
  const [firstStorage, secondStorage] = devices.map((device) => device.storage.all());
  assert.equal(JSON.stringify(firstStorage).includes('shop-b'), false);
  assert.equal(JSON.stringify(secondStorage).includes('shop-a'), false);
});
test('pairing clears prior global tenant state only after a successful claim', async () => {
  const localStorage = createStorage();
  const calculatorKey = 'ozon-logistics:calculator-state:v1';
  const selectionKey = 'ss-erp:logistics:selection:v1';
  const scheduleKey = 'ss-erp:logistics:schedule:v1';
  const prior = {
    [calculatorKey]: { marker: 'tenant-a-calculator' },
    [selectionKey]: { marker: 'tenant-a-selection' },
    [scheduleKey]: { marker: 'tenant-a-schedule' },
  };
  await localStorage.set(prior);
  let rejectClaim = true;
  const operation = {
    state: 'paired', epoch: 1, baseUrl: 'https://erp.example',
    deploymentId: 'deployment-b', sessionId: 'session-b', deviceId: 'device-b',
    ownerUserId: 'tenant-b', scopes: ['logistics:discover'], accessToken: 'token-b',
  };
  const credentials = {
    async claim() {
      if (rejectClaim) throw new Error('pairing failed');
      return { state: 'paired', sessionId: operation.sessionId };
    },
    async clear() { return { state: 'unpaired' }; },
    async getStatus() { return operation; },
    async getConnection() { return operation; },
    async getAccessToken() { return operation.accessToken; },
    async beginOperation() { return operation; },
    async isOperationCurrent(candidate) { return candidate === operation; },
    async clearIfCurrent() { return true; },
  };
  const runtime = loadRuntime({
    localStorage,
    credentials,
    fetchImpl: async () => { throw new Error('network must not be used'); },
    validateBundle: () => ({ valid: false, errors: ['unused'] }),
    randomId: () => 'unused-id-000000',
  });

  await assert.rejects(runtime.claim({}), /pairing failed/);
  assert.deepEqual(localStorage.all(), prior);

  rejectClaim = false;
  const paired = await runtime.claim({});
  const stored = localStorage.all();

  assert.equal(paired.state, 'paired');
  assert.equal(stored[calculatorKey], undefined);
  assert.equal(stored[selectionKey], undefined);
  assert.equal(stored[scheduleKey], undefined);
});

test('an initial revoked receipt stops refresh and disables the calculator immediately', async () => {
  const localStorage = createStorage();
  const calculatorKey = 'ozon-logistics:calculator-state:v1';
  const scheduleKey = 'ss-erp:logistics:schedule:v1';
  await localStorage.set({
    [calculatorKey]: {
      state: 'healthy', source: 'remote', quoteAllowed: true,
      snapshot: { services: ['old'] }, officialSnapshot: null,
    },
    [scheduleKey]: {
      deploymentId: 'deployment-a', sessionId: 'session-a',
      failures: 1, nextAttemptAt: null, lastState: 'retryable',
    },
  });
  const operation = {
    state: 'paired', epoch: 1, baseUrl: 'https://erp.example',
    deploymentId: 'deployment-a', sessionId: 'session-a', deviceId: 'device-a',
    ownerUserId: 'tenant-a', scopes: ['logistics:discover'], accessToken: 'token-a',
  };
  const assignment = {
    assignmentId: 'assignment-a', shopId: 'shop-a', shopName: 'Shop A',
    companyId: 'company-a', warehouseId: 'warehouse-a', warehouseName: 'Warehouse A',
    originCountryUid: 'china', originCityUid: 'xiamen', originLabel: 'Xiamen',
    destinationCountryUid: 'russia', destinationLocationUid: 'moscow',
    destinationLabel: 'Moscow', releaseSequence: 1,
  };
  let refreshCalls = 0;
  const client = {
    async discover() { return { state: 'ready', assignments: [assignment] }; },
    async flushPendingReceipt() { return { state: 'revoked', status: 401 }; },
    async refresh() { refreshCalls += 1; return { state: 'retryable', reason: 'network' }; },
  };
  const credentials = {
    async claim() { return operation; },
    async clear() { return { state: 'unpaired' }; },
    async getStatus() { return operation; },
    async getConnection() { return operation; },
    async getAccessToken() { return operation.accessToken; },
    async beginOperation() { return operation; },
    async isOperationCurrent(candidate) { return candidate === operation; },
    async clearIfCurrent() { return true; },
  };
  const runtime = loadRuntime({
    localStorage,
    credentials,
    fetchImpl: async () => { throw new Error('fake client owns network'); },
    validateBundle: () => ({ valid: false, errors: ['unused'] }),
    buildCalculatorState: () => ({
      state: 'missing', source: 'none', quoteAllowed: false,
      scope: { deploymentId: 'deployment-a' }, snapshot: null, officialSnapshot: null,
    }),
    randomId: () => 'unused-id-000000',
  }, {
    SS_ERP_LOGISTICS_DISTRIBUTION_CLIENT: { createClient: () => client },
  });

  const result = await runtime.syncStored({ reason: 'manual', extensionVersion: '1.2.0' });
  const stored = localStorage.all();

  assert.equal(result.state, 'revoked');
  assert.equal(refreshCalls, 0);
  assert.equal(stored[calculatorKey].state, 'revoked');
  assert.equal(stored[calculatorKey].quoteAllowed, false);
  assert.equal(stored[scheduleKey], undefined);
});

test('a sync superseded by re-pairing cannot overwrite the new tenant global state', async () => {
  const localStorage = createStorage();
  const calculatorKey = 'ozon-logistics:calculator-state:v1';
  const selectionKey = 'ss-erp:logistics:selection:v1';
  const operation = {
    state: 'paired', epoch: 1, baseUrl: 'https://erp.example',
    deploymentId: 'deployment-a', sessionId: 'session-a', deviceId: 'device-a',
    ownerUserId: 'tenant-a', scopes: ['logistics:discover'], accessToken: 'token-a',
  };
  const assignment = {
    assignmentId: 'assignment-a', shopId: 'shop-a', shopName: 'Shop A',
    companyId: 'company-a', warehouseId: 'warehouse-a', warehouseName: 'Warehouse A',
    originCountryUid: 'china', originCityUid: 'xiamen', originLabel: 'Xiamen',
    destinationCountryUid: 'russia', destinationLocationUid: 'moscow',
    destinationLabel: 'Moscow', releaseSequence: 1,
  };
  let current = true;
  let flushCalls = 0;
  let refreshCalls = 0;
  const client = {
    async discover() {
      current = false;
      await localStorage.set({
        [calculatorKey]: { marker: 'tenant-b-calculator' },
        [selectionKey]: { marker: 'tenant-b-selection' },
      });
      return { state: 'ready', assignments: [assignment] };
    },
    async flushPendingReceipt() { flushCalls += 1; return { state: 'no_pending' }; },
    async refresh() { refreshCalls += 1; return { state: 'retryable', reason: 'network' }; },
  };
  const credentials = {
    async claim() { return operation; },
    async clear() { return { state: 'unpaired' }; },
    async getStatus() { return operation; },
    async getConnection() { return operation; },
    async getAccessToken() { return operation.accessToken; },
    async beginOperation() { return operation; },
    async isOperationCurrent(candidate) { return candidate === operation && current; },
    async clearIfCurrent() { return false; },
  };
  const runtime = loadRuntime({
    localStorage,
    credentials,
    fetchImpl: async () => { throw new Error('fake client owns network'); },
    validateBundle: () => ({ valid: false, errors: ['unused'] }),
    buildCalculatorState: () => ({
      marker: 'tenant-a-calculator', state: 'missing', source: 'none', quoteAllowed: false,
      scope: { deploymentId: 'deployment-a' }, snapshot: null, officialSnapshot: null,
    }),
    randomId: () => 'unused-id-000000',
  }, {
    SS_ERP_LOGISTICS_DISTRIBUTION_CLIENT: { createClient: () => client },
  });

  const result = await runtime.sync({ reason: 'manual', extensionVersion: '1.2.0' });
  const stored = localStorage.all();

  assert.equal(result.state, 'superseded');
  assert.equal(stored[calculatorKey].marker, 'tenant-b-calculator');
  assert.equal(stored[selectionKey].marker, 'tenant-b-selection');
  assert.equal(flushCalls, 0);
  assert.equal(refreshCalls, 0);
});

test('authority terminal states disable stale quotes and clear global selection state', async () => {
  const calculatorKey = 'ozon-logistics:calculator-state:v1';
  const selectionKey = 'ss-erp:logistics:selection:v1';
  const scheduleKey = 'ss-erp:logistics:schedule:v1';
  const assignment = {
    assignmentId: 'assignment-a', shopId: 'shop-a', shopName: 'Shop A', companyId: 'company-a', warehouseId: 'warehouse-a', warehouseName: 'Warehouse A',
    originCountryUid: 'china', originCityUid: 'xiamen', originLabel: 'Xiamen',
    destinationCountryUid: 'russia', destinationLocationUid: 'moscow', destinationLabel: 'Moscow', releaseSequence: 1,
  };
  for (const terminal of ['unpaired', 'no_assignment', 'needs_selection']) {
    const localStorage = createStorage();
    await localStorage.set({
      [calculatorKey]: {
        state: 'healthy', source: 'remote', quoteAllowed: true,
        snapshot: { services: ['old'] }, officialSnapshot: null,
      },
      [selectionKey]: { marker: 'old-selection' },
      [scheduleKey]: { marker: 'old-schedule' },
    });
    const operation = {
      state: 'paired', epoch: 1, baseUrl: 'https://erp.example',
      deploymentId: 'deployment-a', sessionId: 'session-a', deviceId: 'device-a',
      ownerUserId: 'tenant-a', scopes: ['logistics:discover'], accessToken: 'token-a',
    };
    const credentials = {
      async claim() { return operation; },
      async clear() { return { state: 'unpaired' }; },
      async getStatus() { return terminal === 'unpaired' ? { state: 'unpaired' } : operation; },
      async getConnection() { return operation; },
      async getAccessToken() { return operation.accessToken; },
      async beginOperation() { return operation; },
      async isOperationCurrent(candidate) { return candidate === operation; },
      async clearIfCurrent() { return true; },
    };
    const assignments = terminal === 'no_assignment' ? [] : [
      assignment,
      { ...assignment, assignmentId: 'assignment-b' },
    ];
    const client = {
      async discover() { return { state: 'ready', assignments }; },
      async flushPendingReceipt() { throw new Error('receipt must not run'); },
      async refresh() { throw new Error('refresh must not run'); },
    };
    const runtime = loadRuntime({
      localStorage, credentials,
      fetchImpl: async () => { throw new Error('fake client owns network'); },
      validateBundle: () => ({ valid: false, errors: ['unused'] }),
      buildCalculatorState: () => ({ state: 'missing', quoteAllowed: false }),
      randomId: () => 'unused-id-000000',
    }, {
      SS_ERP_LOGISTICS_DISTRIBUTION_CLIENT: { createClient: () => client },
    });
    const result = await runtime.syncStored({ reason: 'manual', extensionVersion: '1.2.0' });
    const stored = localStorage.all();
    assert.equal(result.state, terminal);
    assert.equal(stored[calculatorKey].state, terminal);
    assert.equal(stored[calculatorKey].quoteAllowed, false);
    assert.equal(stored[calculatorKey].snapshot, null);
    assert.equal(stored[selectionKey], undefined);
    assert.equal(stored[scheduleKey], undefined);
  }
});

test('local fallback requires an explicit binding to the complete active scope', async () => {
  const localStorage = createStorage();
  const calculatorKey = 'ozon-logistics:calculator-state:v1';
  const scope = {
    deploymentId: 'deployment-a', tenantSubject: 'tenant-a',
    shopId: 'shop-a', ozonCompanyId: 'company-a', warehouseId: 'warehouse-a',
    originCountryUid: 'china', originCityUid: 'xiamen',
    destinationCountryUid: 'russia', destinationLocationUid: 'moscow',
    assignmentId: 'assignment-a', schemaMajor: 1,
  };
  await localStorage.set({ [calculatorKey]: { state: 'healthy', scope, quoteAllowed: true } });
  const operation = { state: 'paired', epoch: 1, ...scope, ownerUserId: 'tenant-a', sessionId: 'session-a', deviceId: 'device-a', baseUrl: 'https://erp.example', scopes: ['logistics:read'], accessToken: 'token-a' };
  const credentials = {
    async claim() { return operation; },
    async clear() { return { state: 'unpaired' }; },
    async getStatus() { return operation; },
    async getConnection() { return operation; },
    async getAccessToken() { return operation.accessToken; },
    async beginOperation() { return operation; },
    async isOperationCurrent(candidate) { return candidate === operation; },
    async clearIfCurrent() { return true; },
  };
  const runtime = loadRuntime({
    localStorage, credentials,
    fetchImpl: async () => { throw new Error('network must not run'); },
    validateBundle: () => ({ valid: false, errors: ['unused'] }),
    buildCalculatorState: ({ expectedScope }) => ({ state: 'local_fallback', source: 'local', quoteAllowed: true, scope: expectedScope, snapshot: {} }),
    randomId: () => 'unused-id-000000',
  }, {
    SS_ERP_LOGISTICS_DISTRIBUTION_CLIENT: { createClient: () => ({}) },
  });
  const snapshot = {
    userConfig: { selectedServiceIds: ['manual-1'], resolutionMode: 'lowest_cost' },
    formState: { packingFee: 5 },
    catalogSnapshot: { services: [{ id: 'manual-1' }] },
    ruleSnapshot: { services: [{ serviceId: 'manual-1' }] },
  };
  await assert.rejects(
    runtime.saveLocalFallback({ snapshot }),
    /explicit scope binding/i,
  );
  await assert.rejects(
    runtime.saveLocalFallback({ snapshot, scopeBinding: { ...scope, shopId: 'shop-b' } }),
    /scope binding does not match/i,
  );
  const before = localStorage.all();
  assert.equal(Object.keys(before).filter((key) => key.startsWith('ozon-logistics:fallback:v1:')).length, 0);
  const accepted = await runtime.saveLocalFallback({
    snapshot,
    scopeBinding: scope,
  });
  assert.equal(accepted.state, 'local_fallback');
  const stored = localStorage.all();
  const fallbackKey = Object.keys(stored).find((key) => key.startsWith('ozon-logistics:fallback:v1:'));
  assert.ok(fallbackKey);
  assert.equal(stored[fallbackKey].scope.shopId, 'shop-a');
});
