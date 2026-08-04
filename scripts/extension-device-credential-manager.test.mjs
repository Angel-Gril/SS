import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(
  'extensions/ss-erp/shared/logistics-rules/device-credential-manager.js',
  'utf8',
);
const serviceWorkerSource = fs.readFileSync(
  'extensions/ss-erp/background/service-worker.js',
  'utf8',
);
const LOCAL_CREDENTIAL_KEY = 'ss-erp:extension-device:credential:v1';
const SESSION_ACCESS_KEY = 'ss-erp:extension-device:access:v1';
const SESSION_ACCESS_VERSION = 'extension-device-session-access/v1';

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createStorage() {
  const values = new Map();
  const writes = [];
  return {
    writes,
    async get(keys) {
      const requested = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(
        requested.filter((key) => values.has(key)).map((key) => [key, clone(values.get(key))]),
      );
    },
    async set(input) {
      writes.push(clone(input));
      for (const [key, value] of Object.entries(input)) values.set(key, clone(value));
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key);
    },
    value(key) { return clone(values.get(key)); },
  };
}

function createLockManager() {
  const tails = new Map();
  return {
    request(name, operation) {
      const previous = tails.get(name) || Promise.resolve();
      const current = previous.catch(() => {}).then(operation);
      tails.set(name, current.catch(() => {}));
      return current;
    },
  };
}

function jwt(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode(payload) + '.signature';
}

function deviceJwt(input = {}) {
  const issuedAt = input.issuedAt == null
    ? Math.floor(new Date('2026-07-12T12:00:00.000Z').getTime() / 1000)
    : input.issuedAt;
  const expiresAt = input.expiresAt == null ? issuedAt + 15 * 60 : input.expiresAt;
  const sessionId = input.sessionId || 'session-1';
  const ownerUserId = input.ownerUserId || 'owner-1';
  return jwt({
    typ: 'extension_device',
    tokenUse: 'access',
    deploymentId: input.deploymentId || 'local-dev',
    sid: sessionId,
    deviceId: input.deviceId || 'device-1',
    ownerUserId,
    actorUserId: input.actorUserId || ownerUserId,
    scopes: input.scopes || ['logistics:read'],
    sub: sessionId,
    jti: input.jti || 'jti-1',
    iat: issuedAt,
    exp: expiresAt,
    ...input.claims,
  });
}

function storedCredential(overrides = {}) {
  return {
    baseUrl: 'https://erp.example',
    deploymentId: 'local-dev',
    deviceId: 'device-1',
    ownerUserId: 'owner-1',
    sessionId: 'session-1',
    currentJti: 'jti-1',
    scopes: ['logistics:read'],
    expiresAt: '2026-08-11T12:00:00.000Z',
    refreshToken: 'r'.repeat(43),
    ...overrides,
  };
}

function refreshResponse(accessToken, overrides = {}) {
  const credential = storedCredential(overrides);
  const currentJti = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url')).jti;
  return response(200, {
    code: 1,
    data: {
      session: {
        id: credential.sessionId,
        deploymentId: credential.deploymentId,
        deviceId: credential.deviceId,
        actorUserId: credential.ownerUserId,
        ownerUserId: credential.ownerUserId,
        scopes: credential.scopes,
        currentJti,
        expiresAt: credential.expiresAt,
      },
      accessToken,
      refreshToken: 'n'.repeat(43),
    },
  });
}

function response(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() { return body; },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function delayFirstStorageRead(storage) {
  const started = deferred();
  const release = deferred();
  let delayed = true;
  return {
    started: started.promise,
    release: release.resolve,
    adapter: {
      ...storage,
      async get(keys) {
        if (!delayed) return storage.get(keys);
        delayed = false;
        const snapshot = await storage.get(keys);
        started.resolve();
        await release.promise;
        return snapshot;
      },
    },
  };
}

function loadManager(options) {
  const context = {
    AbortController, Date, JSON, Number, Object, Array, String, Boolean, Set, Map, Promise, URL,
    atob, clearTimeout, setTimeout,
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: 'device-credential-manager.js' });
  return context.SS_ERP_EXTENSION_DEVICE_CREDENTIALS.createManager(options);
}

test('pairing stores only the rotating refresh credential locally and exposes no secrets to UI', async () => {
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  await sessionStorage.set({ [SESSION_ACCESS_KEY]: { stale: true } });
  const requests = [];
  const accessToken = deviceJwt({
    scopes: ['logistics:discover', 'logistics:read', 'logistics:receipt'],
  });
  const manager = loadManager({
    localStorage,
    sessionStorage,
    fetchImpl: async (url, init) => {
      assert.equal(sessionStorage.value(SESSION_ACCESS_KEY), undefined);
      requests.push({ url, init });
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
    },
    now: () => new Date('2026-07-12T12:00:00.000Z'),
  });

  const result = await manager.claim({
    baseUrl: 'https://erp.example/',
    code: 'p'.repeat(22),
    deploymentId: 'local-dev',
    deviceId: 'device-1',
    deviceLabel: 'Chrome Xiamen',
  });

  assert.equal(requests[0].url, 'https://erp.example/api/extension-device/pairing-claims');
  assert.equal(requests[0].init.credentials, 'omit');
  assert.equal('Authorization' in requests[0].init.headers, false);
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    code: 'p'.repeat(22),
    deploymentId: 'local-dev',
    deviceId: 'device-1',
    deviceLabel: 'Chrome Xiamen',
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    state: 'paired',
    sessionId: 'session-1',
    deploymentId: 'local-dev',
    deviceId: 'device-1',
    ownerUserId: 'owner-1',
    scopes: ['logistics:discover', 'logistics:read', 'logistics:receipt'],
    expiresAt: '2026-08-11T12:00:00.000Z',
  });
  assert.equal(JSON.stringify(result).includes(accessToken), false);
  assert.equal(JSON.stringify(result).includes('r'.repeat(43)), false);

  const persisted = localStorage.value('ss-erp:extension-device:credential:v1');
  assert.equal(persisted.refreshToken, 'r'.repeat(43));
  assert.equal(persisted.accessToken, undefined);
  assert.equal(persisted.pairingCode, undefined);
  assert.deepEqual(Object.keys(sessionStorage.value(SESSION_ACCESS_KEY)).sort(), [
    'baseUrl', 'contractVersion', 'currentJti', 'deploymentId', 'deviceId', 'expiresAt',
    'ownerUserId', 'sessionId', 'token',
  ]);
  assert.equal(sessionStorage.value(SESSION_ACCESS_KEY).token, accessToken);
  assert.equal(localStorage.value(SESSION_ACCESS_KEY), undefined);
  assert.equal(await manager.getAccessToken(), accessToken);
});

test('pairing accepts the five-minute server clock-skew boundary and caps the local cache lifetime', async () => {
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  const now = new Date('2026-07-12T12:00:00.000Z');
  const issuedAt = Math.floor(now.getTime() / 1000) + 5 * 60;
  const accessToken = deviceJwt({ issuedAt, expiresAt: issuedAt + 15 * 60 });
  const manager = loadManager({
    localStorage,
    sessionStorage,
    fetchImpl: async () => response(201, {
      code: 1,
      data: {
        session: {
          id: 'session-1', deploymentId: 'local-dev', deviceId: 'device-1',
          actorUserId: 'owner-1', ownerUserId: 'owner-1', scopes: ['logistics:read'],
          currentJti: 'jti-1', expiresAt: '2026-08-11T12:00:00.000Z',
        },
        accessToken,
        refreshToken: 'r'.repeat(43),
      },
    }),
    now: () => now,
  });

  await manager.claim({
    baseUrl: 'https://erp.example', code: 'p'.repeat(22), deploymentId: 'local-dev',
    deviceId: 'device-1', deviceLabel: 'Clock skew boundary',
  });

  assert.equal(
    sessionStorage.value(SESSION_ACCESS_KEY).expiresAt,
    now.getTime() + 15 * 60 * 1000,
  );
});

test('pairing rejects an access token issued beyond the five-minute clock-skew boundary', async () => {
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  const now = new Date('2026-07-12T12:00:00.000Z');
  const issuedAt = Math.floor(now.getTime() / 1000) + 5 * 60 + 1;
  const accessToken = deviceJwt({ issuedAt, expiresAt: issuedAt + 15 * 60 });
  const manager = loadManager({
    localStorage,
    sessionStorage,
    fetchImpl: async () => response(201, {
      code: 1,
      data: {
        session: {
          id: 'session-1', deploymentId: 'local-dev', deviceId: 'device-1',
          actorUserId: 'owner-1', ownerUserId: 'owner-1', scopes: ['logistics:read'],
          currentJti: 'jti-1', expiresAt: '2026-08-11T12:00:00.000Z',
        },
        accessToken,
        refreshToken: 'r'.repeat(43),
      },
    }),
    now: () => now,
  });

  await assert.rejects(manager.claim({
    baseUrl: 'https://erp.example', code: 'p'.repeat(22), deploymentId: 'local-dev',
    deviceId: 'device-1', deviceLabel: 'Clock skew rejected',
  }), /device credentials are invalid/u);
  assert.equal(localStorage.value(LOCAL_CREDENTIAL_KEY), undefined);
  assert.equal(sessionStorage.value(SESSION_ACCESS_KEY), undefined);
});

test('a restarted worker reuses a claim access token from session storage without rotating refresh', async () => {
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  const lockManager = createLockManager();
  const accessToken = deviceJwt();
  const workerA = loadManager({
    localStorage,
    sessionStorage,
    lockManager,
    fetchImpl: async () => response(201, {
      code: 1,
      data: {
        session: {
          id: 'session-1', deploymentId: 'local-dev', deviceId: 'device-1',
          actorUserId: 'owner-1', ownerUserId: 'owner-1', scopes: ['logistics:read'],
          currentJti: 'jti-1', expiresAt: '2026-08-11T12:00:00.000Z',
        },
        accessToken,
        refreshToken: 'r'.repeat(43),
      },
    }),
    now: () => new Date('2026-07-12T12:00:00.000Z'),
  });
  await workerA.claim({
    baseUrl: 'https://erp.example', code: 'p'.repeat(22), deploymentId: 'local-dev',
    deviceId: 'device-1', deviceLabel: 'Chrome restart',
  });

  let refreshCalls = 0;
  const workerB = loadManager({
    localStorage,
    sessionStorage,
    lockManager,
    fetchImpl: async () => {
      refreshCalls += 1;
      throw new Error('session access must prevent refresh');
    },
    now: () => new Date('2026-07-12T12:01:00.000Z'),
  });

  assert.equal(await workerB.getAccessToken(), accessToken);
  assert.equal(refreshCalls, 0);
});

test('a restarted worker reuses a freshly rotated access token without a second refresh', async () => {
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  const lockManager = createLockManager();
  await localStorage.set({ [LOCAL_CREDENTIAL_KEY]: storedCredential() });
  const accessToken = deviceJwt({ jti: 'jti-2' });
  let refreshCalls = 0;
  const workerA = loadManager({
    localStorage,
    sessionStorage,
    lockManager,
    fetchImpl: async () => {
      refreshCalls += 1;
      return refreshResponse(accessToken);
    },
    now: () => new Date('2026-07-12T12:00:00.000Z'),
  });
  assert.equal(await workerA.getAccessToken(), accessToken);
  assert.equal(refreshCalls, 1);

  const workerB = loadManager({
    localStorage,
    sessionStorage,
    lockManager,
    fetchImpl: async () => {
      refreshCalls += 1;
      throw new Error('restarted worker must reuse session access');
    },
    now: () => new Date('2026-07-12T12:01:00.000Z'),
  });
  assert.equal(await workerB.getAccessToken(), accessToken);
  assert.equal(refreshCalls, 1);
});

test('a pre-upgrade refresh credential gains a JTI-bound session cache after one rotation', async () => {
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  const lockManager = createLockManager();
  const legacyCredential = storedCredential();
  delete legacyCredential.currentJti;
  await localStorage.set({ [LOCAL_CREDENTIAL_KEY]: legacyCredential });
  const accessToken = deviceJwt({ jti: 'jti-2' });
  let refreshCalls = 0;
  const manager = loadManager({
    localStorage,
    sessionStorage,
    lockManager,
    fetchImpl: async () => {
      refreshCalls += 1;
      return refreshResponse(accessToken);
    },
    now: () => new Date('2026-07-12T12:00:00.000Z'),
  });

  assert.equal(await manager.getAccessToken(), accessToken);
  assert.equal(refreshCalls, 1);
  assert.equal(localStorage.value(LOCAL_CREDENTIAL_KEY).currentJti, 'jti-2');
  assert.equal(sessionStorage.value(SESSION_ACCESS_KEY).currentJti, 'jti-2');
  assert.equal(sessionStorage.value(SESSION_ACCESS_KEY).token, accessToken);
});

test('an older live worker adopts the access token rotated by a replacement worker', async () => {
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  const lockManager = createLockManager();
  const firstAccessToken = deviceJwt({ jti: 'jti-1' });
  let workerARefreshCalls = 0;
  const workerA = loadManager({
    localStorage,
    sessionStorage,
    lockManager,
    fetchImpl: async (url) => {
      if (url.endsWith('/refresh')) {
        workerARefreshCalls += 1;
        throw new Error('old worker must adopt the shared access token');
      }
      return response(201, {
        code: 1,
        data: {
          session: {
            id: 'session-1', deploymentId: 'local-dev', deviceId: 'device-1',
            actorUserId: 'owner-1', ownerUserId: 'owner-1', scopes: ['logistics:read'],
            currentJti: 'jti-1', expiresAt: '2026-08-11T12:00:00.000Z',
          },
          accessToken: firstAccessToken,
          refreshToken: 'r'.repeat(43),
        },
      });
    },
    now: () => new Date('2026-07-12T12:00:00.000Z'),
  });
  await workerA.claim({
    baseUrl: 'https://erp.example', code: 'p'.repeat(22), deploymentId: 'local-dev',
    deviceId: 'device-1', deviceLabel: 'Chrome old worker',
  });

  await sessionStorage.remove([SESSION_ACCESS_KEY]);
  const replacementAccessToken = deviceJwt({ jti: 'jti-2' });
  let workerBRefreshCalls = 0;
  const workerB = loadManager({
    localStorage,
    sessionStorage,
    lockManager,
    fetchImpl: async () => {
      workerBRefreshCalls += 1;
      return refreshResponse(replacementAccessToken);
    },
    now: () => new Date('2026-07-12T12:01:00.000Z'),
  });
  assert.equal(await workerB.getAccessToken(), replacementAccessToken);
  assert.equal(workerBRefreshCalls, 1);

  assert.equal(await workerA.getAccessToken(), replacementAccessToken);
  assert.equal(workerARefreshCalls, 0);
});

test('a shared cross-worker lock permits only one refresh when no access cache exists', async () => {
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  const lockManager = createLockManager();
  await localStorage.set({ [LOCAL_CREDENTIAL_KEY]: storedCredential() });
  const started = deferred();
  const completed = deferred();
  const accessToken = deviceJwt({ jti: 'jti-2' });
  let refreshCalls = 0;
  function worker() {
    return loadManager({
      localStorage,
      sessionStorage,
      lockManager,
      fetchImpl: async () => {
        refreshCalls += 1;
        started.resolve();
        await completed.promise;
        return refreshResponse(accessToken);
      },
      now: () => new Date('2026-07-12T12:01:00.000Z'),
    });
  }
  const first = worker().getAccessToken();
  await started.promise;
  const second = worker().getAccessToken();
  completed.resolve();

  assert.deepEqual(await Promise.all([first, second]), [accessToken, accessToken]);
  assert.equal(refreshCalls, 1);
});

test('an old operation cannot clear credentials rotated by a replacement worker', async () => {
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  const lockManager = createLockManager();
  const firstAccessToken = deviceJwt({ jti: 'jti-1' });
  const workerA = loadManager({
    localStorage,
    sessionStorage,
    lockManager,
    fetchImpl: async (url) => {
      if (url.endsWith('/refresh')) throw new Error('unexpected old-worker refresh');
      return response(201, {
        code: 1,
        data: {
          session: {
            id: 'session-1', deploymentId: 'local-dev', deviceId: 'device-1',
            actorUserId: 'owner-1', ownerUserId: 'owner-1', scopes: ['logistics:read'],
            currentJti: 'jti-1', expiresAt: '2026-08-11T12:00:00.000Z',
          },
          accessToken: firstAccessToken,
          refreshToken: 'r'.repeat(43),
        },
      });
    },
    now: () => new Date('2026-07-12T12:00:00.000Z'),
  });
  await workerA.claim({
    baseUrl: 'https://erp.example', code: 'p'.repeat(22), deploymentId: 'local-dev',
    deviceId: 'device-1', deviceLabel: 'Chrome old operation',
  });
  const oldOperation = await workerA.beginOperation();
  assert.equal(oldOperation.currentJti, 'jti-1');

  await sessionStorage.remove([SESSION_ACCESS_KEY]);
  const replacementAccessToken = deviceJwt({ jti: 'jti-2' });
  const workerB = loadManager({
    localStorage,
    sessionStorage,
    lockManager,
    fetchImpl: async () => refreshResponse(replacementAccessToken),
    now: () => new Date('2026-07-12T12:01:00.000Z'),
  });
  assert.equal(await workerB.getAccessToken(), replacementAccessToken);

  assert.equal(await workerA.clearIfCurrent(oldOperation, { status: 401 }), false);
  assert.equal(localStorage.value(LOCAL_CREDENTIAL_KEY).currentJti, 'jti-2');
  assert.equal(sessionStorage.value(SESSION_ACCESS_KEY).currentJti, 'jti-2');
  assert.equal(sessionStorage.value(SESSION_ACCESS_KEY).token, replacementAccessToken);
});

for (const scenario of [
  {
    name: 'binding mismatch',
    mutate(record) { record.sessionId = 'session-other'; },
  },
  {
    name: 'expired record',
    now: '2026-07-12T12:15:00.000Z',
    mutate() {},
  },
  {
    name: 'tampered token claims',
    mutate(record) {
      record.token = deviceJwt({ claims: { ownerUserId: 'owner-other' } });
    },
  },
  {
    name: 'unexpected record field',
    mutate(record) { record.extra = true; },
  },
  {
    name: 'torn refresh generation',
    credentialOverrides: { currentJti: 'jti-2', refreshToken: 'n'.repeat(43) },
    cachedJti: 'jti-1',
    mutate() {},
  },
]) {
  test(`invalid session access (${scenario.name}) is removed before a normal refresh`, async () => {
    const localStorage = createStorage();
    const sessionStorage = createStorage();
    const credential = storedCredential(scenario.credentialOverrides);
    await localStorage.set({ [LOCAL_CREDENTIAL_KEY]: credential });
    const cachedToken = deviceJwt({ jti: scenario.cachedJti || credential.currentJti });
    const cachedRecord = {
      contractVersion: SESSION_ACCESS_VERSION,
      baseUrl: credential.baseUrl,
      deploymentId: credential.deploymentId,
      deviceId: credential.deviceId,
      ownerUserId: credential.ownerUserId,
      sessionId: credential.sessionId,
      currentJti: scenario.cachedJti || credential.currentJti,
      token: cachedToken,
      expiresAt: new Date('2026-07-12T12:15:00.000Z').getTime(),
    };
    scenario.mutate(cachedRecord);
    await sessionStorage.set({ [SESSION_ACCESS_KEY]: cachedRecord });
    const currentTime = new Date(scenario.now || '2026-07-12T12:01:00.000Z');
    const issuedAt = Math.floor(currentTime.getTime() / 1000);
    const refreshedToken = deviceJwt({
      jti: 'jti-refreshed', issuedAt, expiresAt: issuedAt + 15 * 60,
    });
    let refreshCalls = 0;
    const manager = loadManager({
      localStorage,
      sessionStorage,
      fetchImpl: async () => {
        refreshCalls += 1;
        return refreshResponse(refreshedToken);
      },
      now: () => currentTime,
    });

    assert.equal(await manager.getAccessToken(), refreshedToken);
    assert.equal(refreshCalls, 1);
    assert.equal(sessionStorage.value(SESSION_ACCESS_KEY).token, refreshedToken);
  });
}

test('invalid-cache cleanup does not remove a newer access record', async () => {
  const localStorage = createStorage();
  const backingSessionStorage = createStorage();
  const credential = storedCredential({ currentJti: 'jti-2', refreshToken: 'n'.repeat(43) });
  await localStorage.set({ [LOCAL_CREDENTIAL_KEY]: credential });
  const staleToken = deviceJwt({ jti: 'jti-1' });
  const freshToken = deviceJwt({ jti: 'jti-2' });
  const baseRecord = (token, currentJti) => ({
    contractVersion: SESSION_ACCESS_VERSION,
    baseUrl: credential.baseUrl,
    deploymentId: credential.deploymentId,
    deviceId: credential.deviceId,
    ownerUserId: credential.ownerUserId,
    sessionId: credential.sessionId,
    currentJti,
    token,
    expiresAt: new Date('2026-07-12T12:15:00.000Z').getTime(),
  });
  const staleRecord = baseRecord(staleToken, 'jti-1');
  const freshRecord = baseRecord(freshToken, 'jti-2');
  await backingSessionStorage.set({ [SESSION_ACCESS_KEY]: staleRecord });
  const compareStarted = deferred();
  const releaseCompare = deferred();
  let reads = 0;
  let removes = 0;
  const sessionStorage = {
    ...backingSessionStorage,
    async get(keys) {
      reads += 1;
      if (reads === 2) {
        compareStarted.resolve();
        await releaseCompare.promise;
      }
      return backingSessionStorage.get(keys);
    },
    async remove(keys) {
      removes += 1;
      return backingSessionStorage.remove(keys);
    },
  };
  const refreshedToken = deviceJwt({ jti: 'jti-3' });
  const manager = loadManager({
    localStorage,
    sessionStorage,
    fetchImpl: async () => {
      assert.equal(removes, 0);
      assert.equal(backingSessionStorage.value(SESSION_ACCESS_KEY).token, freshToken);
      return refreshResponse(refreshedToken);
    },
    now: () => new Date('2026-07-12T12:01:00.000Z'),
  });

  const loading = manager.getAccessToken();
  await compareStarted.promise;
  await backingSessionStorage.set({ [SESSION_ACCESS_KEY]: freshRecord });
  releaseCompare.resolve();

  assert.equal(await loading, refreshedToken);
  assert.equal(removes, 0);
});

test('the service worker gives the credential manager session-only access storage', () => {
  const start = serviceWorkerSource.indexOf('const credentials = api.createManager({');
  const end = serviceWorkerSource.indexOf('\n  });', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const wiring = serviceWorkerSource.slice(start, end);
  assert.match(wiring, /localStorage:\s*chrome\.storage\.local/u);
  assert.match(wiring, /sessionStorage:\s*chrome\.storage\.session/u);
  assert.match(wiring, /lockManager:\s*globalThis\.navigator\s*&&\s*globalThis\.navigator\.locks/u);
  assert.doesNotMatch(wiring, /syncStorage|chrome\.storage\.sync/u);
});
test('concurrent access requests after restart perform exactly one refresh rotation', async () => {
  const localStorage = createStorage();
  await localStorage.set({
    'ss-erp:extension-device:credential:v1': {
      baseUrl: 'https://erp.example',
      deploymentId: 'local-dev',
      deviceId: 'device-1',
      ownerUserId: 'owner-1',
      sessionId: 'session-1',
      scopes: ['logistics:discover', 'logistics:read', 'logistics:receipt'],
      expiresAt: '2026-08-11T12:00:00.000Z',
      refreshToken: 'r'.repeat(43),
    },
  });
  const nextAccessToken = deviceJwt({
    scopes: ['logistics:discover', 'logistics:read', 'logistics:receipt'],
  });
  let refreshCalls = 0;
  const manager = loadManager({
    localStorage,
    fetchImpl: async (url, init) => {
      refreshCalls += 1;
      assert.equal(url, 'https://erp.example/api/extension-device/refresh');
      assert.deepEqual(JSON.parse(init.body), { refreshToken: 'r'.repeat(43) });
      await Promise.resolve();
      return response(200, {
        code: 1,
        data: {
          session: {
            id: 'session-1',
            deploymentId: 'local-dev',
            deviceId: 'device-1',
            actorUserId: 'owner-1',
            ownerUserId: 'owner-1',
            scopes: ['logistics:discover', 'logistics:read', 'logistics:receipt'],
            currentJti: 'jti-2',
            expiresAt: '2026-08-11T12:00:00.000Z',
          },
          accessToken: nextAccessToken,
          refreshToken: 'n'.repeat(43),
        },
      });
    },
    now: () => new Date('2026-07-12T12:00:00.000Z'),
  });

  const [first, second] = await Promise.all([
    manager.getAccessToken(),
    manager.getAccessToken(),
  ]);

  assert.equal(first, nextAccessToken);
  assert.equal(second, nextAccessToken);
  assert.equal(refreshCalls, 1);
  const persisted = localStorage.value('ss-erp:extension-device:credential:v1');
  assert.equal(persisted.refreshToken, 'n'.repeat(43));
  assert.equal(persisted.accessToken, undefined);
});
test('a rejected refresh credential is deleted and requires re-pairing', async () => {
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  await localStorage.set({
    'ss-erp:extension-device:credential:v1': {
      baseUrl: 'https://erp.example',
      deploymentId: 'local-dev',
      deviceId: 'device-1',
      ownerUserId: 'owner-1',
      sessionId: 'session-1',
      scopes: ['logistics:read'],
      expiresAt: '2026-08-11T12:00:00.000Z',
      refreshToken: 'r'.repeat(43),
    },
  });
  const manager = loadManager({
    localStorage,
    sessionStorage,
    fetchImpl: async () => response(401, {
      code: 0,
      errorCode: 'refresh_reuse_detected',
    }),
    now: () => new Date('2026-07-12T12:00:00.000Z'),
  });

  await assert.rejects(manager.getAccessToken(), /re-pairing required/);
  assert.equal(localStorage.value('ss-erp:extension-device:credential:v1'), undefined);
  assert.equal(sessionStorage.value(SESSION_ACCESS_KEY), undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(await manager.getStatus())), {
    state: 'unpaired',
  });
});

test('clearing credentials cannot be undone by an older in-flight refresh', async () => {
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  await localStorage.set({
    'ss-erp:extension-device:credential:v1': {
      baseUrl: 'https://erp.example',
      deploymentId: 'local-dev',
      deviceId: 'device-1',
      ownerUserId: 'owner-1',
      sessionId: 'session-1',
      scopes: ['logistics:read'],
      expiresAt: '2026-08-11T12:00:00.000Z',
      refreshToken: 'r'.repeat(43),
    },
  });
  await sessionStorage.set({ [SESSION_ACCESS_KEY]: { stale: true } });
  const started = deferred();
  const completed = deferred();
  const accessToken = deviceJwt();
  const manager = loadManager({
    localStorage,
    sessionStorage,
    fetchImpl: async () => {
      started.resolve();
      return completed.promise;
    },
    now: () => new Date('2026-07-12T12:00:00.000Z'),
  });

  const refreshing = manager.getAccessToken();
  await started.promise;
  await manager.clear();
  completed.resolve(response(200, {
    code: 1,
    data: {
      session: {
        id: 'session-1',
        deploymentId: 'local-dev',
        deviceId: 'device-1',
        ownerUserId: 'owner-1',
        scopes: ['logistics:read'],
        expiresAt: '2026-08-11T12:00:00.000Z',
      },
      accessToken,
      refreshToken: 'n'.repeat(43),
    },
  }));

  await assert.rejects(refreshing, /superseded/i);
  assert.equal(localStorage.value('ss-erp:extension-device:credential:v1'), undefined);
  assert.equal(sessionStorage.value(SESSION_ACCESS_KEY), undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(await manager.getStatus())), {
    state: 'unpaired',
  });
});

test('a new pairing cannot be overwritten by an older in-flight refresh', async () => {
  const localStorage = createStorage();
  await localStorage.set({
    'ss-erp:extension-device:credential:v1': {
      baseUrl: 'https://old.example',
      deploymentId: 'old-deployment',
      deviceId: 'device-1',
      ownerUserId: 'owner-old',
      sessionId: 'session-old',
      scopes: ['logistics:read'],
      expiresAt: '2026-08-11T12:00:00.000Z',
      refreshToken: 'r'.repeat(43),
    },
  });
  const started = deferred();
  const completed = deferred();
  const oldAccessToken = deviceJwt({
    sessionId: 'session-old', deploymentId: 'old-deployment', deviceId: 'device-1',
    ownerUserId: 'owner-old',
  });
  const newAccessToken = deviceJwt({
    sessionId: 'session-new', deploymentId: 'new-deployment', deviceId: 'device-2',
    ownerUserId: 'owner-new',
  });
  const manager = loadManager({
    localStorage,
    fetchImpl: async (url) => {
      if (url.endsWith('/refresh')) {
        started.resolve();
        return completed.promise;
      }
      return response(201, {
        code: 1,
        data: {
          session: {
            id: 'session-new',
            deploymentId: 'new-deployment',
            deviceId: 'device-2',
            ownerUserId: 'owner-new',
            scopes: ['logistics:read'],
            expiresAt: '2026-08-11T12:00:00.000Z',
          },
          accessToken: newAccessToken,
          refreshToken: 'q'.repeat(43),
        },
      });
    },
    now: () => new Date('2026-07-12T12:00:00.000Z'),
  });

  const oldRefresh = manager.getAccessToken();
  await started.promise;
  await manager.claim({
    baseUrl: 'https://new.example',
    code: 'p'.repeat(22),
    deploymentId: 'new-deployment',
    deviceId: 'device-2',
    deviceLabel: 'New Chrome',
  });
  completed.resolve(response(200, {
    code: 1,
    data: {
      session: {
        id: 'session-old',
        deploymentId: 'old-deployment',
        deviceId: 'device-1',
        ownerUserId: 'owner-old',
        scopes: ['logistics:read'],
        expiresAt: '2026-08-11T12:00:00.000Z',
      },
      accessToken: oldAccessToken,
      refreshToken: 'n'.repeat(43),
    },
  }));

  await assert.rejects(oldRefresh, /superseded/i);
  const persisted = localStorage.value('ss-erp:extension-device:credential:v1');
  assert.equal(persisted.sessionId, 'session-new');
  assert.equal(persisted.ownerUserId, 'owner-new');
  assert.equal(persisted.refreshToken, 'q'.repeat(43));
  assert.equal(await manager.getAccessToken(), newAccessToken);
});

test('operation epochs prevent stale authorization failures from clearing a new pairing', async () => {
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  const oldAccessToken = deviceJwt({
    sessionId: 'session-old', deploymentId: 'old-deployment', deviceId: 'device-old',
    ownerUserId: 'owner-old', scopes: ['logistics:capture', 'logistics:read'],
  });
  const newAccessToken = deviceJwt({
    sessionId: 'session-new', deploymentId: 'new-deployment', deviceId: 'device-new',
    ownerUserId: 'owner-new', scopes: ['logistics:capture', 'logistics:read'],
  });
  const manager = loadManager({
    localStorage,
    sessionStorage,
    fetchImpl: async (_url, init) => {
      const request = JSON.parse(init.body);
      const isNew = request.deploymentId === 'new-deployment';
      return response(201, {
        code: 1,
        data: {
          session: {
            id: isNew ? 'session-new' : 'session-old',
            deploymentId: request.deploymentId,
            deviceId: request.deviceId,
            ownerUserId: isNew ? 'owner-new' : 'owner-old',
            scopes: ['logistics:capture', 'logistics:read'],
            currentJti: 'jti-1',
            expiresAt: '2026-08-11T12:00:00.000Z',
          },
          accessToken: isNew ? newAccessToken : oldAccessToken,
          refreshToken: (isNew ? 'q' : 'r').repeat(43),
        },
      });
    },
    now: () => new Date('2026-07-12T12:00:00.000Z'),
  });

  await manager.claim({
    baseUrl: 'https://old.example',
    code: 'o'.repeat(22),
    deploymentId: 'old-deployment',
    deviceId: 'device-old',
    deviceLabel: 'Old Chrome',
  });
  const oldOperation = await manager.beginOperation();
  assert.equal(oldOperation.state, 'paired');
  assert.equal(oldOperation.sessionId, 'session-old');
  assert.equal(oldOperation.accessToken, oldAccessToken);
  assert.equal(Number.isSafeInteger(oldOperation.epoch), true);
  assert.equal('refreshToken' in oldOperation, false);

  await manager.claim({
    baseUrl: 'https://new.example',
    code: 'n'.repeat(22),
    deploymentId: 'new-deployment',
    deviceId: 'device-new',
    deviceLabel: 'New Chrome',
  });

  assert.equal(await manager.isOperationCurrent(oldOperation), false);
  assert.equal(await manager.clearIfCurrent(oldOperation, {
    status: 410,
    reason: 'stale_authorization_failure',
  }), false);
  const persisted = localStorage.value('ss-erp:extension-device:credential:v1');
  assert.equal(persisted.sessionId, 'session-new');
  assert.equal(persisted.ownerUserId, 'owner-new');
  assert.equal(persisted.refreshToken, 'q'.repeat(43));

  const currentOperation = await manager.beginOperation();
  assert.equal(await manager.isOperationCurrent(currentOperation), true);
  assert.equal('refreshToken' in currentOperation, false);
  assert.equal(await manager.clearIfCurrent(currentOperation, {
    status: 410,
    reason: 'current_authorization_failure',
  }), true);
  assert.equal(sessionStorage.value(SESSION_ACCESS_KEY), undefined);
  assert.deepEqual(clone(await manager.getStatus()), { state: 'unpaired' });
});

test('a never-settling pairing request aborts at the configured deadline without writing credentials', async () => {
  const localStorage = createStorage();
  let requestSignal;
  const manager = loadManager({
    localStorage,
    requestTimeoutMs: 15,
    fetchImpl: async (_url, init) => {
      requestSignal = init.signal;
      return new Promise(() => {});
    },
    now: () => new Date('2026-07-12T12:00:00.000Z'),
  });

  await assert.rejects(manager.claim({
    baseUrl: 'https://erp.example',
    code: 'p'.repeat(22),
    deploymentId: 'local-dev',
    deviceId: 'device-1',
    deviceLabel: 'Chrome timeout',
  }), /pairing request timed out/);

  assert.equal(requestSignal instanceof AbortSignal, true);
  assert.equal(requestSignal.aborted, true);
  assert.equal(localStorage.value('ss-erp:extension-device:credential:v1'), undefined);
});

test('a never-settling refresh request aborts and clears the possibly consumed refresh credential', async () => {
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  await localStorage.set({
    'ss-erp:extension-device:credential:v1': {
      baseUrl: 'https://erp.example',
      deploymentId: 'local-dev',
      deviceId: 'device-1',
      ownerUserId: 'owner-1',
      sessionId: 'session-1',
      scopes: ['logistics:read'],
      expiresAt: '2026-08-11T12:00:00.000Z',
      refreshToken: 'r'.repeat(43),
    },
  });
  await sessionStorage.set({ [SESSION_ACCESS_KEY]: { stale: true } });
  let requestSignal;
  const manager = loadManager({
    localStorage,
    sessionStorage,
    requestTimeoutMs: 15,
    fetchImpl: async (_url, init) => {
      requestSignal = init.signal;
      return new Promise(() => {});
    },
    now: () => new Date('2026-07-12T12:00:00.000Z'),
  });

  await assert.rejects(manager.getAccessToken(), /re-pairing required/);

  assert.equal(requestSignal instanceof AbortSignal, true);
  assert.equal(requestSignal.aborted, true);
  assert.equal(localStorage.value('ss-erp:extension-device:credential:v1'), undefined);
  assert.equal(sessionStorage.value(SESSION_ACCESS_KEY), undefined);
  assert.deepEqual(clone(await manager.getStatus()), { state: 'unpaired' });
});

test('an ambiguous refresh JSON failure clears the old refresh credential', async () => {
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  await localStorage.set({
    'ss-erp:extension-device:credential:v1': {
      baseUrl: 'https://erp.example', deploymentId: 'local-dev', deviceId: 'device-1',
      ownerUserId: 'owner-1', sessionId: 'session-1', scopes: ['logistics:read'],
      expiresAt: '2026-08-11T12:00:00.000Z', refreshToken: 'r'.repeat(43),
    },
  });
  await sessionStorage.set({ [SESSION_ACCESS_KEY]: { stale: true } });
  const manager = loadManager({
    localStorage,
    sessionStorage,
    fetchImpl: async () => ({
      status: 200,
      async json() { throw new SyntaxError('truncated JSON'); },
    }),
    now: () => new Date('2026-07-12T12:00:00.000Z'),
  });

  await assert.rejects(manager.getAccessToken(), /re-pairing required/);
  assert.equal(localStorage.value('ss-erp:extension-device:credential:v1'), undefined);
  assert.equal(sessionStorage.value(SESSION_ACCESS_KEY), undefined);
  assert.deepEqual(clone(await manager.getStatus()), { state: 'unpaired' });
});

for (const operation of ['status', 'connection', 'begin', 'refresh']) {
  test(`a ${operation} read clears a credential pinned to the opposite deployment`, async () => {
    const localStorage = createStorage();
    const sessionStorage = createStorage();
    await localStorage.set({
      'ss-erp:extension-device:credential:v1': {
        baseUrl: 'https://ss-erp.cn', deploymentId: 'cn-prod', deviceId: 'device-1',
        ownerUserId: 'owner-1', sessionId: 'session-cn', scopes: ['logistics:read'],
        expiresAt: '2026-08-11T12:00:00.000Z', refreshToken: 'r'.repeat(43),
      },
    });
    await sessionStorage.set({ [SESSION_ACCESS_KEY]: { stale: true } });
    let fetchCalls = 0;
    const manager = loadManager({
      localStorage,
      sessionStorage,
      expectedBaseUrl: 'https://ss-erp.com',
      fetchImpl: async () => {
        fetchCalls += 1;
        throw new Error('must not contact the opposite deployment');
      },
      now: () => new Date('2026-07-12T12:00:00.000Z'),
    });

    if (operation === 'status') {
      assert.deepEqual(clone(await manager.getStatus()), { state: 'unpaired' });
    } else if (operation === 'connection') {
      assert.equal(await manager.getConnection(), null);
    } else if (operation === 'begin') {
      assert.deepEqual(clone(await manager.beginOperation()), { state: 'unpaired', epoch: 1 });
    } else {
      await assert.rejects(manager.getAccessToken(), /refresh credential is unavailable/);
    }
    assert.equal(fetchCalls, 0);
    assert.equal(localStorage.value('ss-erp:extension-device:credential:v1'), undefined);
    assert.equal(sessionStorage.value(SESSION_ACCESS_KEY), undefined);
  });
}

test('a manual claim cannot target an API origin outside the packaged deployment', async () => {
  const localStorage = createStorage();
  let fetchCalls = 0;
  const manager = loadManager({
    localStorage,
    expectedBaseUrl: 'https://ss-erp.com',
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error('unexpected fetch');
    },
    now: () => new Date('2026-07-12T12:00:00.000Z'),
  });

  await assert.rejects(manager.claim({
    baseUrl: 'https://ss-erp.cn', code: 'p'.repeat(22), deploymentId: 'cn-prod',
    deviceId: 'device-1', deviceLabel: 'Wrong deployment',
  }), /another ERP deployment/);
  assert.equal(fetchCalls, 0);
  assert.equal(localStorage.value('ss-erp:extension-device:credential:v1'), undefined);
});

test('beginOperation rejects an old deferred storage snapshot after a concurrent claim', async () => {
  const storage = createStorage();
  await storage.set({
    'ss-erp:extension-device:credential:v1': {
      baseUrl: 'https://erp.example', deploymentId: 'local-dev', deviceId: 'device-1',
      ownerUserId: 'owner-1', sessionId: 'session-1', scopes: ['logistics:read'],
      expiresAt: '2026-08-11T12:00:00.000Z', refreshToken: 'r'.repeat(43),
    },
  });
  const delayed = delayFirstStorageRead(storage);
  const newAccessToken = deviceJwt();
  const requests = [];
  const manager = loadManager({
    localStorage: delayed.adapter,
    fetchImpl: async (url) => {
      requests.push(url);
      return response(201, {
        code: 1,
        data: {
          session: {
            id: 'session-1', deploymentId: 'local-dev', deviceId: 'device-1',
            ownerUserId: 'owner-1', scopes: ['logistics:read'],
            expiresAt: '2026-08-11T12:00:00.000Z',
          },
          accessToken: newAccessToken,
          refreshToken: 'q'.repeat(43),
        },
      });
    },
    now: () => new Date('2026-07-12T12:00:00.000Z'),
  });

  const oldBegin = manager.beginOperation();
  await delayed.started;
  await manager.claim({
    baseUrl: 'https://erp.example', code: 'p'.repeat(22), deploymentId: 'local-dev',
    deviceId: 'device-1', deviceLabel: 'Current Chrome',
  });
  delayed.release();

  await assert.rejects(oldBegin, /superseded/);
  assert.equal(requests.filter((url) => url.endsWith('/refresh')).length, 0);
  assert.equal(storage.value('ss-erp:extension-device:credential:v1').refreshToken, 'q'.repeat(43));
  assert.equal(await manager.getAccessToken(), newAccessToken);
});

test('refresh rejects an old deferred storage snapshot without sending its token after a concurrent claim', async () => {
  const storage = createStorage();
  await storage.set({
    'ss-erp:extension-device:credential:v1': {
      baseUrl: 'https://erp.example', deploymentId: 'local-dev', deviceId: 'device-1',
      ownerUserId: 'owner-1', sessionId: 'session-1', scopes: ['logistics:read'],
      expiresAt: '2026-08-11T12:00:00.000Z', refreshToken: 'r'.repeat(43),
    },
  });
  const delayed = delayFirstStorageRead(storage);
  const newAccessToken = deviceJwt();
  const requests = [];
  const manager = loadManager({
    localStorage: delayed.adapter,
    fetchImpl: async (url) => {
      requests.push(url);
      if (url.endsWith('/refresh')) throw new Error('stale refresh token must not be sent');
      return response(201, {
        code: 1,
        data: {
          session: {
            id: 'session-1', deploymentId: 'local-dev', deviceId: 'device-1',
            ownerUserId: 'owner-1', scopes: ['logistics:read'],
            expiresAt: '2026-08-11T12:00:00.000Z',
          },
          accessToken: newAccessToken,
          refreshToken: 'q'.repeat(43),
        },
      });
    },
    now: () => new Date('2026-07-12T12:00:00.000Z'),
  });

  const oldRefresh = manager.getAccessToken();
  await delayed.started;
  await manager.claim({
    baseUrl: 'https://erp.example', code: 'p'.repeat(22), deploymentId: 'local-dev',
    deviceId: 'device-1', deviceLabel: 'Current Chrome',
  });
  delayed.release();

  await assert.rejects(oldRefresh, /superseded/);
  assert.equal(requests.filter((url) => url.endsWith('/refresh')).length, 0);
  assert.equal(storage.value('ss-erp:extension-device:credential:v1').refreshToken, 'q'.repeat(43));
  assert.equal(await manager.getAccessToken(), newAccessToken);
});
