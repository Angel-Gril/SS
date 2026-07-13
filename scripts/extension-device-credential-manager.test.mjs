import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(
  'extensions/ss-erp/shared/logistics-rules/device-credential-manager.js',
  'utf8',
);

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

function jwt(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode(payload) + '.signature';
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

function loadManager(options) {
  const context = {
    Date, JSON, Number, Object, Array, String, Boolean, Set, Map, Promise, URL, atob,
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: 'device-credential-manager.js' });
  return context.SS_ERP_EXTENSION_DEVICE_CREDENTIALS.createManager(options);
}

test('pairing stores only the rotating refresh credential locally and exposes no secrets to UI', async () => {
  const localStorage = createStorage();
  const requests = [];
  const accessToken = jwt({
    exp: Math.floor(new Date('2026-07-12T12:15:00.000Z').getTime() / 1000),
    typ: 'extension_device',
  });
  const manager = loadManager({
    localStorage,
    fetchImpl: async (url, init) => {
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
  assert.equal(await manager.getAccessToken(), accessToken);
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
  const nextAccessToken = jwt({
    exp: Math.floor(new Date('2026-07-12T12:15:00.000Z').getTime() / 1000),
    typ: 'extension_device',
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
    fetchImpl: async () => response(401, {
      code: 0,
      errorCode: 'refresh_reuse_detected',
    }),
    now: () => new Date('2026-07-12T12:00:00.000Z'),
  });

  await assert.rejects(manager.getAccessToken(), /re-pairing required/);
  assert.equal(localStorage.value('ss-erp:extension-device:credential:v1'), undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(await manager.getStatus())), {
    state: 'unpaired',
  });
});

test('clearing credentials cannot be undone by an older in-flight refresh', async () => {
  const localStorage = createStorage();
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
  const started = deferred();
  const completed = deferred();
  const accessToken = jwt({
    exp: Math.floor(new Date('2026-07-12T12:15:00.000Z').getTime() / 1000),
    typ: 'extension_device',
  });
  const manager = loadManager({
    localStorage,
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
  const oldAccessToken = jwt({
    exp: Math.floor(new Date('2026-07-12T12:15:00.000Z').getTime() / 1000),
    typ: 'extension_device',
  });
  const newAccessToken = jwt({
    exp: Math.floor(new Date('2026-07-12T12:20:00.000Z').getTime() / 1000),
    typ: 'extension_device',
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
  const oldAccessToken = jwt({
    exp: Math.floor(new Date('2026-07-12T12:15:00.000Z').getTime() / 1000),
    typ: 'extension_device',
    sid: 'session-old',
  });
  const newAccessToken = jwt({
    exp: Math.floor(new Date('2026-07-12T12:20:00.000Z').getTime() / 1000),
    typ: 'extension_device',
    sid: 'session-new',
  });
  const manager = loadManager({
    localStorage,
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
  assert.deepEqual(clone(await manager.getStatus()), { state: 'unpaired' });
});
