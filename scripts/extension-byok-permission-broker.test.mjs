import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const modulePath = 'extensions/ss-erp/shared/byok/permission-broker.js';
const moduleSource = fs.existsSync(modulePath) ? fs.readFileSync(modulePath, 'utf8') : '';

function createPermissions() {
  const calls = [];
  let granted = false;
  return {
    calls,
    setGranted(value) {
      granted = Boolean(value);
    },
    async contains(input) {
      calls.push({ method: 'contains', input });
      return granted;
    },
    async request(input) {
      calls.push({ method: 'request', input });
      granted = true;
      return true;
    },
    async remove(input) {
      calls.push({ method: 'remove', input });
      granted = false;
      return true;
    },
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function createReadinessBridge() {
  return {
    consume(handle, binding, origin) {
      if (handle !== 'readiness-token' || !binding) throw new Error('invalid readiness handle');
      return binding.decision || decision({ providerOrigin: origin });
    },
  };
}

function loadApi(permissions = createPermissions(), readinessBridge = createReadinessBridge()) {
  class TestEvent {
    constructor(isTrusted) {
      this.isTrusted = isTrusted;
    }
  }
  TestEvent.prototype.composedPath = function composedPath() { return []; };
  const context = {
    Array,
    Boolean,
    Date,
    Error,
    Map,
    Object,
    Promise,
    Set,
    String,
    URL,
    TypeError,
    Event: TestEvent,
    WeakMap,
    WeakSet,
  };
  context.globalThis = context;
  vm.runInNewContext(moduleSource, context, { filename: modulePath });
  return {
    api: context.SS_ERP_BYOK_PERMISSION_BROKER,
    permissions,
    readinessBridge,
    TestEvent,
  };
}

function decision(overrides = {}) {
  return {
    allowed: true,
    providerOrigin: 'https://relay.example',
    policyRevision: 7,
    ...overrides,
  };
}

test('canonicalizes one public HTTPS origin and rejects unsafe endpoint/redirect shapes', () => {
  const { api } = loadApi();
  assert.equal(api.canonicalizeOrigin('https://relay.example/v1'), 'https://relay.example');
  assert.equal(api.canonicalizeOrigin('https://relay.example'), 'https://relay.example');

  for (const value of [
    'http://relay.example/v1',
    'https://user:pass@relay.example/v1',
    'https://relay.example/v1?token=secret',
    'https://relay.example/v1#fragment',
    'https://localhost/v1',
    'https://127.0.0.1/v1',
    'https://10.0.0.1/v1',
    'https://172.16.0.1/v1',
    'https://192.168.1.1/v1',
    'https://169.254.169.254/latest',
    'https://metadata.google.internal/v1',
    'https://[::1]/v1',
    'https://[fc00::1]/v1',
    'https://[::ffff:127.0.0.1]/v1',
    'https://[::a9fe:a9fe]/v1',
    'https://[2001:db8::1]/v1',
    'https://[2606:4700:4700::1111]/v1',
    'https://relay.example./v1',
    'https://relay..example/v1',
  ]) {
    assert.throws(
      () => api.canonicalizeOrigin(value),
      (error) => error && error.code === 'SS_ERP_BYOK_PERMISSION_ORIGIN_INVALID',
      value,
    );
  }
});

test('requests only the exact canonical origin after ERP approval and a trusted gesture', async () => {
  const { api, permissions, readinessBridge, TestEvent } = loadApi();
  const broker = api.createBroker({ permissions, readinessBridge });
  const token = broker.createTrustedGestureToken(new TestEvent(true));
  const result = await broker.requestOriginPermission({
    endpoint: 'https://relay.example/v1',
    readinessHandle: 'readiness-token',
    readinessBinding: { providerOrigin: 'https://relay.example' },
    trustedGesture: token,
  });

  assert.deepEqual(plain(result), {
    origin: 'https://relay.example',
    pattern: 'https://relay.example/*',
    granted: true,
    requested: true,
  });
  assert.deepEqual(plain(permissions.calls), [
    { method: 'request', input: { origins: ['https://relay.example/*'] } },
  ]);
});

test('checks existing permission separately and still requests directly inside the trusted gesture', async () => {
  const permissions = createPermissions();
  permissions.setGranted(true);
  const { api, readinessBridge, TestEvent } = loadApi(permissions);
  const broker = api.createBroker({ permissions, readinessBridge });
  assert.deepEqual(plain(await broker.containsOrigin('https://relay.example/v1')), {
    origin: 'https://relay.example',
    pattern: 'https://relay.example/*',
    granted: true,
  });
  permissions.calls.length = 0;
  const result = await broker.requestOriginPermission({
    endpoint: 'https://relay.example/v1',
    readinessHandle: 'readiness-token',
    readinessBinding: { providerOrigin: 'https://relay.example' },
    trustedGesture: broker.createTrustedGestureToken(new TestEvent(true)),
  });

  assert.equal(result.granted, true);
  assert.equal(result.requested, true);
  assert.deepEqual(permissions.calls.map((entry) => entry.method), ['request']);
});

test('waits for callback-only Chrome APIs even when native function length is zero', async () => {
  const calls = [];
  const permissions = {
    contains(...args) {
      calls.push('contains');
      queueMicrotask(() => args[1](true));
    },
    request(...args) {
      calls.push('request');
      queueMicrotask(() => args[1](true));
    },
    remove(...args) {
      calls.push('remove');
      queueMicrotask(() => args[1](true));
    },
  };
  assert.equal(permissions.request.length, 0);
  const { api, readinessBridge, TestEvent } = loadApi(permissions);
  const broker = api.createBroker({ permissions, readinessBridge });
  const result = await broker.requestOriginPermission({
    endpoint: 'https://relay.example/v1',
    readinessHandle: 'readiness-token',
    readinessBinding: { providerOrigin: 'https://relay.example' },
    trustedGesture: broker.createTrustedGestureToken(new TestEvent(true)),
  });
  assert.equal(result.granted, true);
  assert.deepEqual(calls, ['request']);
});

test('rejects forged, missing, mismatched, or disallowed trust before any Chrome permission I/O', async () => {
  const permissions = createPermissions();
  const { api, readinessBridge, TestEvent } = loadApi(permissions);
  const broker = api.createBroker({ permissions, readinessBridge });
  assert.throws(
    () => broker.createTrustedGestureToken({ isTrusted: true }),
    (error) => error && error.code === 'SS_ERP_BYOK_PERMISSION_GESTURE_REQUIRED',
  );
  assert.throws(
    () => broker.createTrustedGestureToken(new TestEvent(false)),
    (error) => error && error.code === 'SS_ERP_BYOK_PERMISSION_GESTURE_REQUIRED',
  );
  const oneEvent = new TestEvent(true);
  broker.createTrustedGestureToken(oneEvent);
  assert.throws(
    () => broker.createTrustedGestureToken(oneEvent),
    (error) => error && error.code === 'SS_ERP_BYOK_PERMISSION_GESTURE_REQUIRED',
  );
  const cases = [
    {
      endpoint: 'https://relay.example/v1',
      readinessHandle: 'readiness-token',
      readinessBinding: { providerOrigin: 'https://relay.example', decision: decision({ allowed: false }) },
      trustedGesture: broker.createTrustedGestureToken(new TestEvent(true)),
    },
    {
      endpoint: 'https://relay.example/v1',
      readinessHandle: 'readiness-token',
      readinessBinding: { providerOrigin: 'https://relay.example', decision: decision({ providerOrigin: 'https://other.example' }) },
      trustedGesture: broker.createTrustedGestureToken(new TestEvent(true)),
    },
    {
      endpoint: 'https://relay.example/v1',
      readinessHandle: 'readiness-token',
      readinessBinding: { providerOrigin: 'https://relay.example' },
      trustedGesture: { isTrusted: true },
    },
    {
      endpoint: 'https://relay.example/v1',
      readinessHandle: 'readiness-token',
      readinessBinding: { providerOrigin: 'https://relay.example' },
    },
    {
      endpoint: 'https://relay.example/v1?redirect=https://evil.example',
      readinessHandle: 'readiness-token',
      readinessBinding: { providerOrigin: 'https://relay.example' },
      trustedGesture: broker.createTrustedGestureToken(new TestEvent(true)),
    },
    {
      endpoint: 'https://relay.example/v1',
      readinessHandle: 'readiness-token',
      readinessBinding: { providerOrigin: 'https://relay.example' },
      trustedGesture: broker.createTrustedGestureToken(new TestEvent(true)),
      redirect: 'follow',
    },
  ];

  for (const input of cases) {
    await assert.rejects(
      broker.requestOriginPermission(input),
      (error) => error && /^SS_ERP_BYOK_PERMISSION_/u.test(error.code),
    );
  }
  assert.deepEqual(permissions.calls, []);

  await assert.rejects(
    broker.requestOriginPermission({
      endpoint: 'https://relay.example/v1',
      allowlistDecision: decision(),
      trustedGesture: broker.createTrustedGestureToken(new TestEvent(true)),
    }),
    (error) => error && error.code === 'SS_ERP_BYOK_PERMISSION_INPUT_INVALID',
  );
  assert.deepEqual(permissions.calls, []);

  const consumed = broker.createTrustedGestureToken(new TestEvent(true));
  await assert.rejects(
    broker.requestOriginPermission({
      endpoint: 'https://relay.example/v1',
      readinessHandle: 'readiness-token',
      readinessBinding: { providerOrigin: 'https://relay.example', decision: decision({ allowed: false }) },
      trustedGesture: consumed,
    }),
    (error) => error && error.code === 'SS_ERP_BYOK_PERMISSION_NOT_ALLOWED',
  );
  await assert.rejects(
    broker.requestOriginPermission({
      endpoint: 'https://relay.example/v1',
      readinessHandle: 'readiness-token',
      readinessBinding: { providerOrigin: 'https://relay.example' },
      trustedGesture: consumed,
    }),
    (error) => error && error.code === 'SS_ERP_BYOK_PERMISSION_GESTURE_REQUIRED',
  );
  assert.deepEqual(permissions.calls, []);
});

test('removes only the exact canonical origin and rejects unsafe removal shapes before I/O', async () => {
  const permissions = createPermissions();
  const { api, readinessBridge } = loadApi(permissions);
  const broker = api.createBroker({ permissions, readinessBridge });
  assert.deepEqual(
    plain(await broker.removeOriginPermission('https://relay.example/v1')),
    { origin: 'https://relay.example', pattern: 'https://relay.example/*', removed: true },
  );
  assert.deepEqual(plain(permissions.calls), [
    { method: 'remove', input: { origins: ['https://relay.example/*'] } },
  ]);
  permissions.calls.length = 0;
  await assert.rejects(
    broker.removeOriginPermission('https://127.0.0.1/v1'),
    (error) => error && error.code === 'SS_ERP_BYOK_PERMISSION_ORIGIN_INVALID',
  );
  assert.deepEqual(permissions.calls, []);
});

test('cloud manifest declares Provider access only as optional and never as a mandatory arbitrary host', () => {
  const manifest = JSON.parse(fs.readFileSync('extensions/ss-erp/manifest.json', 'utf8'));
  const buildScript = fs.readFileSync('scripts/build-extension-package.mjs', 'utf8');
  assert.deepEqual(manifest.optional_host_permissions, ['https://*/*']);
  assert.equal((manifest.host_permissions || []).includes('https://*/*'), false);
  assert.match(buildScript, /optional_host_permissions/u);
  assert.match(buildScript, /https:\/\/\*\/\*/u);
  const verifier = fs.readFileSync('scripts/verify-extension-package.mjs', 'utf8');
  assert.match(verifier, /cloud package has no mandatory arbitrary Provider host access/u);
  assert.match(verifier, /optional Provider host permission must be exactly https:\/\/\*\/\*/u);
  assert.match(verifier, /shared\/byok\/permission-broker\.js/u);
});

test('package verifier rejects arbitrary HTTPS host permissions with wildcard ports', () => {
  const build = spawnSync(process.execPath, ['scripts/build-extension-package.mjs', 'cloud'], {
    encoding: 'utf8',
  });
  assert.equal(build.status, 0, build.stderr || build.stdout);
  const builtDir = path.resolve('build/extensions/ss-erp-cloud');
  assert.equal(existsSync(builtDir), true);
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'ss-erp-byok-verifier-'));
  try {
    cpSync(builtDir, tempDir, { recursive: true });
    const manifestPath = path.join(tempDir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.host_permissions.push('https://*:*/*');
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const verification = spawnSync(
      process.execPath,
      ['scripts/verify-extension-package.mjs'],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          EXTENSION_DIR: tempDir,
          EXTENSION_TARGET: 'cloud',
        },
      },
    );
    assert.notEqual(verification.status, 0);
    assert.match(`${verification.stdout}\n${verification.stderr}`, /arbitrary Provider access.*mandatory/u);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

console.log('PASS extension BYOK permission broker contract');
