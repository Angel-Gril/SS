import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const modulePath = 'extensions/ss-erp/shared/byok/device-session-lifecycle.js';
const authorityModulePath = 'extensions/ss-erp/shared/byok/runtime-authority.js';
const serviceWorkerPath = 'extensions/ss-erp/background/service-worker.js';
const profileStorePath = 'extensions/ss-erp/shared/byok/profile-store.js';
const workbenchRuntimePath = 'extensions/ss-erp/shared/byok/workbench-runtime-handler.js';
const source = fs.readFileSync(modulePath, 'utf8');
const authoritySource = fs.readFileSync(authorityModulePath, 'utf8');

function loadLifecycle() {
  const context = { Error, Object, Promise };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: modulePath });
  return context.SS_ERP_BYOK_DEVICE_SESSION_LIFECYCLE;
}

function createSessionStorage(initial = {}) {
  const values = structuredClone(initial);
  return {
    async get(keys) {
      const result = {};
      for (const key of keys) {
        if (Object.hasOwn(values, key)) result[key] = structuredClone(values[key]);
      }
      return result;
    },
    async set(patch) { Object.assign(values, structuredClone(patch)); },
    snapshot() { return structuredClone(values); },
  };
}

function createLockManager() {
  const tails = new Map();
  return {
    request(name, operation) {
      const next = (tails.get(name) || Promise.resolve())
        .catch(() => {})
        .then(operation);
      tails.set(name, next.catch(() => {}));
      return next;
    },
  };
}

function createFixture(options = {}) {
  const calls = [];
  let clearIfCurrentResult = true;
  const credentials = {
    async claim(input) { calls.push(['claim', input]); return { state: 'paired' }; },
    async clear() { calls.push(['clear']); return { state: 'unpaired' }; },
    async clearIfCurrent(operation, reason) {
      calls.push(['clearIfCurrent', operation, reason]);
      return clearIfCurrentResult;
    },
    async getAccessToken() { return 'token'; },
    async getStatus() { return { state: 'paired' }; },
    async getConnection() { return { baseUrl: 'https://erp.example' }; },
    async beginOperation() { return { state: 'paired' }; },
    async isOperationCurrent() { return true; },
  };
  const lifecycle = loadLifecycle().createLifecycle({
    credentials,
    sessionStorage: options.sessionStorage || createSessionStorage(),
    lockManager: options.lockManager || createLockManager(),
    async clearByokState(input) { calls.push(['clearByokState', input.reason]); },
  });
  return {
    lifecycle,
    calls,
    setClearIfCurrentResult(value) { clearIfCurrentResult = value; },
  };
}

test('clears BYOK session authority before every new device claim', async () => {
  const fixture = createFixture();
  await fixture.lifecycle.claim({ code: 'pairing-code' });
  assert.deepEqual(fixture.calls, [
    ['clearByokState', 'device_claim'],
    ['claim', { code: 'pairing-code' }],
  ]);
});

test('restores the claimed lifecycle epoch across MV3 worker instances', async () => {
  const sessionStorage = createSessionStorage();
  const lockManager = createLockManager();
  const workerA = createFixture({ sessionStorage, lockManager });
  await workerA.lifecycle.claim({ code: 'pairing-code' });
  const claimedAuthority = await workerA.lifecycle.captureAuthority();
  assert.equal(claimedAuthority.epoch, 1);

  const workerB = createFixture({ sessionStorage, lockManager });
  const restoredAuthority = await workerB.lifecycle.captureAuthority();
  assert.equal(restoredAuthority.contractVersion, claimedAuthority.contractVersion);
  assert.equal(restoredAuthority.epoch, claimedAuthority.epoch);
  assert.equal(await workerB.lifecycle.isAuthorityCurrent(claimedAuthority), true);

  await workerB.lifecycle.clear();
  assert.equal(await workerB.lifecycle.isAuthorityCurrent(claimedAuthority), false);
  assert.equal((await workerB.lifecycle.captureAuthority()).epoch, 2);
});

test('serializes durable epoch increments across concurrent worker instances', async () => {
  const sessionStorage = createSessionStorage();
  const lockManager = createLockManager();
  const workerA = createFixture({ sessionStorage, lockManager });
  const workerB = createFixture({ sessionStorage, lockManager });
  await Promise.all([
    workerA.lifecycle.claim({ code: 'worker-a-claim' }),
    workerB.lifecycle.claim({ code: 'worker-b-claim' }),
  ]);
  assert.equal((await workerA.lifecycle.captureAuthority()).epoch, 2);
  assert.equal((await workerB.lifecycle.captureAuthority()).epoch, 2);
});

test('fails closed when the persisted lifecycle epoch is unavailable', async () => {
  const fixture = createFixture({
    sessionStorage: {
      async get() { throw new Error('session storage unavailable'); },
      async set() { throw new Error('session storage unavailable'); },
    },
  });
  await assert.rejects(
    fixture.lifecycle.captureAuthority(),
    (error) => error?.code === 'SS_ERP_BYOK_DEVICE_LIFECYCLE_AUTHORITY_UNAVAILABLE',
  );
  await assert.rejects(
    fixture.lifecycle.claim({ code: 'must-not-claim' }),
    (error) => error?.code === 'SS_ERP_BYOK_DEVICE_LIFECYCLE_AUTHORITY_UNAVAILABLE',
  );
  assert.equal(fixture.calls.some((call) => call[0] === 'claim'), false);
});

test('cleans old BYOK state but never claims when the epoch write fails', async () => {
  const fixture = createFixture({
    sessionStorage: {
      async get() { return {}; },
      async set() { throw new Error('session storage write unavailable'); },
    },
  });
  await assert.rejects(
    fixture.lifecycle.claim({ code: 'must-not-claim' }),
    (error) => error?.code === 'SS_ERP_BYOK_DEVICE_LIFECYCLE_AUTHORITY_UNAVAILABLE',
  );
  assert.deepEqual(fixture.calls, [['clearByokState', 'device_claim']]);
});

test('fails closed when the cross-worker authority lock is unavailable', async () => {
  const fixture = createFixture({
    lockManager: {
      async request() { throw new Error('lock unavailable'); },
    },
  });
  await assert.rejects(
    fixture.lifecycle.captureAuthority(),
    (error) => error?.code === 'SS_ERP_BYOK_DEVICE_LIFECYCLE_AUTHORITY_UNAVAILABLE',
  );
});

test('does not invalidate current authority while a stale clearIfCurrent resolves false', async () => {
  let resolveClear;
  let clearStarted;
  const inClear = new Promise((resolve) => { clearStarted = resolve; });
  const credentials = {
    async claim() {},
    async clear() {},
    async clearIfCurrent() {
      clearStarted();
      return new Promise((resolve) => { resolveClear = resolve; });
    },
    async getAccessToken() {},
    async getStatus() { return { state: 'paired' }; },
    async getConnection() {},
    async beginOperation() {},
    async isOperationCurrent() { return true; },
  };
  const lifecycle = loadLifecycle().createLifecycle({
    credentials,
    sessionStorage: createSessionStorage(),
    lockManager: createLockManager(),
    async clearByokState() {},
  });
  const authority = await lifecycle.captureAuthority();
  const clearing = lifecycle.clearIfCurrent({ epoch: 7 }, { status: 401 });
  await inClear;
  assert.equal(await lifecycle.isAuthorityCurrent(authority), true);
  resolveClear(false);
  assert.equal(await clearing, false);
  assert.equal(await lifecycle.isAuthorityCurrent(authority), true);
});

test('clears BYOK state for explicit disconnect and live revocation only when authority changed', async () => {
  const fixture = createFixture();
  await fixture.lifecycle.clear();
  assert.deepEqual(fixture.calls.slice(0, 2), [
    ['clear'],
    ['clearByokState', 'device_clear'],
  ]);
  fixture.calls.length = 0;
  await fixture.lifecycle.clearIfCurrent({ epoch: 1 }, { status: 401 });
  assert.deepEqual(fixture.calls, [
    ['clearIfCurrent', { epoch: 1 }, { status: 401 }],
    ['clearByokState', 'device_authority_revoked'],
  ]);
  fixture.calls.length = 0;
  fixture.setClearIfCurrentResult(false);
  await fixture.lifecycle.clearIfCurrent({ epoch: 2 }, { status: 410 });
  assert.deepEqual(fixture.calls, [
    ['clearIfCurrent', { epoch: 2 }, { status: 410 }],
  ]);
});

test('attempts BYOK cleanup even when credential clear fails', async () => {
  const calls = [];
  const credentials = {
    async claim() {},
    async clear() { calls.push('clear'); throw new Error('credential clear failed'); },
    async clearIfCurrent() { return false; },
    async getAccessToken() {},
    async getStatus() {},
    async getConnection() {},
    async beginOperation() {},
    async isOperationCurrent() {},
  };
  const lifecycle = loadLifecycle().createLifecycle({
    credentials,
    sessionStorage: createSessionStorage(),
    lockManager: createLockManager(),
    async clearByokState() { calls.push('clearByokState'); },
  });
  await assert.rejects(lifecycle.clear(), /credential clear failed/u);
  assert.deepEqual(calls, ['clear', 'clearByokState']);
});

test('fails a new claim closed when old BYOK session cleanup fails', async () => {
  const calls = [];
  const credentials = {
    async claim() { calls.push('claim'); },
    async clear() {},
    async clearIfCurrent() { return false; },
    async getAccessToken() {},
    async getStatus() {},
    async getConnection() {},
    async beginOperation() {},
    async isOperationCurrent() {},
  };
  const lifecycle = loadLifecycle().createLifecycle({
    credentials,
    sessionStorage: createSessionStorage(),
    lockManager: createLockManager(),
    async clearByokState(input) {
      calls.push(['clearByokState', input.reason]);
      throw new Error('old BYOK state was not cleared');
    },
  });
  await assert.rejects(
    lifecycle.claim({ code: 'new-pairing-code' }),
    /old BYOK state was not cleared/u,
  );
  assert.deepEqual(calls, [['clearByokState', 'device_claim']]);
});

test('detects credential revocation performed inside beginOperation and invalidates the lifecycle epoch', async () => {
  const calls = [];
  let paired = true;
  const credentials = {
    async claim() {},
    async clear() { paired = false; },
    async clearIfCurrent() { return false; },
    async getAccessToken() {},
    async getStatus() { return { state: paired ? 'paired' : 'unpaired' }; },
    async getConnection() {},
    async beginOperation() {
      paired = false;
      throw new Error('refresh credential revoked');
    },
    async isOperationCurrent() { return paired; },
  };
  const lifecycle = loadLifecycle().createLifecycle({
    credentials,
    sessionStorage: createSessionStorage(),
    lockManager: createLockManager(),
    async clearByokState(input) { calls.push(input.reason); },
  });
  const captured = await lifecycle.captureAuthority();
  await assert.rejects(lifecycle.beginOperation(), /refresh credential revoked/u);
  assert.deepEqual(calls, ['device_authority_revoked']);
  assert.equal(await lifecycle.isAuthorityCurrent(captured), false);
});

test('drops a Provider result when device authority changes while generation is running', async () => {
  let epoch = 4;
  let paired = true;
  const credentials = {
    async captureAuthority() {
      return {
        contractVersion: 'extension-byok-device-session-lifecycle/v1',
        epoch,
      };
    },
    async isAuthorityCurrent(snapshot) { return snapshot && snapshot.epoch === epoch; },
    async getStatus() {
      return paired
        ? { state: 'paired', ownerUserId: 'owner-1', sessionId: 'session-1' }
        : { state: 'unpaired' };
    },
  };
  const context = { Error, Number, Object, Promise };
  context.globalThis = context;
  vm.runInNewContext(authoritySource, context, { filename: authorityModulePath });
  const guard = context.SS_ERP_BYOK_RUNTIME_AUTHORITY.createGuard({ credentials });
  const binding = {
    ownerUserId: 'owner-1', deviceSessionId: 'session-1', shopId: 'shop-1',
    workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4, policyRevision: '734',
  };
  const authority = await guard.capture(binding);
  let finishGeneration;
  const generation = new Promise((resolve) => { finishGeneration = resolve; });
  let vaultWrites = 0;
  const commit = (async () => guard.commitGeneratedResult({
    authority,
    binding,
    generated: await generation,
    vault: { put() { vaultWrites += 1; return {}; } },
  }))();
  epoch += 1;
  finishGeneration({ outcome: 'SUCCEEDED' });
  await assert.rejects(
    commit,
    (error) => error && error.code === 'SS_ERP_BYOK_DEVICE_AUTHORITY_STALE',
  );
  assert.equal(vaultWrites, 0);
});

test('normalizes lifecycle storage failures to the runtime stale-authority contract', async () => {
  const credentials = {
    async captureAuthority() {
      const error = new Error('authority storage unavailable');
      error.code = 'SS_ERP_BYOK_DEVICE_LIFECYCLE_AUTHORITY_UNAVAILABLE';
      throw error;
    },
    async isAuthorityCurrent() { return true; },
    async getStatus() {
      return { state: 'paired', ownerUserId: 'owner-1', sessionId: 'session-1' };
    },
  };
  const context = { Error, Number, Object, Promise };
  context.globalThis = context;
  vm.runInNewContext(authoritySource, context, { filename: authorityModulePath });
  const guard = context.SS_ERP_BYOK_RUNTIME_AUTHORITY.createGuard({ credentials });
  await assert.rejects(
    guard.capture({ ownerUserId: 'owner-1', deviceSessionId: 'session-1' }),
    (error) => error?.code === 'SS_ERP_BYOK_DEVICE_AUTHORITY_STALE',
  );
});

test('central service-worker cleanup clears all device-scoped BYOK authority and notifies pages', () => {
  const serviceWorkerSource = fs.readFileSync(serviceWorkerPath, 'utf8');
  const cachedCleanupStart = serviceWorkerSource.indexOf('function clearCachedByokGeneratedResults()');
  const cachedCleanupEnd = serviceWorkerSource.indexOf(
    '\nfunction isLogisticsDistributionFeatureEnabled()',
    cachedCleanupStart,
  );
  assert.notEqual(cachedCleanupStart, -1);
  assert.notEqual(cachedCleanupEnd, -1);
  const cachedCleanupSource = serviceWorkerSource.slice(cachedCleanupStart, cachedCleanupEnd);
  assert.match(cachedCleanupSource, /byokWorkbenchSessionManager\.clearProviderState\(\)/u);
  assert.doesNotMatch(cachedCleanupSource, /byokWorkbenchSessionManager\.clear\(\)/u);
  assert.match(serviceWorkerSource, /onCredentialAuthorityChanged: clearCachedByokGeneratedResults/u);
  assert.match(serviceWorkerSource, /onConsentRevoked: clearCachedByokGeneratedResults/u);
  assert.match(
    serviceWorkerSource,
    /lifecycle\.createLifecycle\(\{\s*credentials,\s*sessionStorage: chrome\.storage\.session,\s*lockManager: globalThis\.navigator && globalThis\.navigator\.locks,/u,
  );

  const cleanupStart = serviceWorkerSource.indexOf('async function clearByokDeviceSessionState(input)');
  const cleanupEnd = serviceWorkerSource.indexOf('\nfunction logisticsDistributionDisabledResult()', cleanupStart);
  assert.notEqual(cleanupStart, -1);
  assert.notEqual(cleanupEnd, -1);
  const cleanupSource = serviceWorkerSource.slice(cleanupStart, cleanupEnd);
  assert.match(cleanupSource, /getByokReadinessHandleCache\(\)\.clear\(\)/u);
  assert.match(cleanupSource, /getByokGeneratedResultVault\(\)\.clear\(\)/u);
  assert.match(cleanupSource, /getByokWorkbenchSessionManager\(\)\.clearProviderState\(\)/u);
  assert.match(cleanupSource, /byokWorkbenchPreviewBroker\.clear\(\)/u);
  assert.match(cleanupSource, /getByokProfileStore\(\)\.disconnectDevice\(\)/u);
  assert.match(cleanupSource, /getByokPermissionBroker\(\)\.clearSessionConsent\(\)/u);
  assert.match(cleanupSource, /notifyByokDeviceSessionInvalidated\(input && input\.reason\)/u);

  const profileStoreSource = fs.readFileSync(profileStorePath, 'utf8');
  const workbenchRuntimeSource = fs.readFileSync(workbenchRuntimePath, 'utf8');
  assert.match(
    profileStoreSource,
    /async function disconnectDevice\(\) \{\s*return clearSession\(\);\s*\}/u,
  );
  assert.match(profileStoreSource, /schema\.SESSION_SECRETS_STORAGE_KEY/u);
  assert.match(profileStoreSource, /schema\.SESSION_EVIDENCE_STORAGE_KEY/u);
  assert.match(serviceWorkerSource, /shared\/byok\/workbench-runtime-handler\.js/u);
  assert.match(workbenchRuntimeSource, /captureAuthority\(binding\)/u);
  assert.match(
    workbenchRuntimeSource,
    /commitGeneratedResult\(\{/u,
  );
  assert.match(workbenchRuntimeSource, /committed\s*=\s*await commitResult\(/u);
  assert.match(
    serviceWorkerSource,
    /ingestClient:\s*getByokGeneratedAssetIngestClient\(\)/u,
  );
  assert.match(workbenchRuntimeSource, /handlers\[messageTypes\.INGEST\]/u);
  assert.match(workbenchRuntimeSource, /setIngestResult\(/u);
  assert.doesNotMatch(
    serviceWorkerSource,
    /const ingestHandler\s*=|WORKBENCH\.INGEST\]:\s*ingestHandler/u,
  );
});

console.log('PASS extension BYOK device-session lifecycle contract');
