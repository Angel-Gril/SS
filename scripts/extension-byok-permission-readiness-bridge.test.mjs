import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const permissionPath = 'extensions/ss-erp/shared/byok/permission-broker.js';
const bridgePath = 'extensions/ss-erp/shared/byok/permission-readiness-bridge.js';

function loadApi() {
  const context = {
    Array,
    Boolean,
    Date,
    Error,
    Map,
    Number,
    Object,
    Promise,
    Set,
    String,
    URL,
    WeakMap,
    WeakSet,
  };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(permissionPath, 'utf8'), context, { filename: permissionPath });
  vm.runInNewContext(fs.readFileSync(bridgePath, 'utf8'), context, { filename: bridgePath });
  return context.SS_ERP_BYOK_PERMISSION_READINESS_BRIDGE;
}

const now = new Date('2026-07-26T08:00:00.000Z');

function binding(overrides = {}) {
  return {
    contractVersion: 'extension-byok-readiness-binding/v1',
    ownerUserId: 'owner-1',
    deviceSessionId: 'device-session-1',
    shopId: 'shop-1',
    workflowId: null,
    draftRevision: null,
    draftVersion: null,
    providerOrigin: 'https://relay.example',
    model: 'image-model-v1',
    operation: 'TEXT_TO_IMAGE',
    policyRevision: '734',
    ...overrides,
  };
}

function readiness(overrides = {}) {
  return {
    readinessHandle: 'rh_' + 'a'.repeat(48),
    readinessBinding: binding(),
    expiresAt: '2026-07-26T08:05:00.000Z',
    ...overrides,
  };
}

function createOptions(overrides = {}) {
  return {
    readiness: readiness(),
    profile: { baseUrl: 'https://relay.example/v1', model: 'image-model-v1' },
    shopId: 'shop-1',
    operation: 'TEXT_TO_IMAGE',
    now: () => now,
    ...overrides,
  };
}

test('creates a one-use synchronous bridge for the exact background-issued binding', () => {
  const api = loadApi();
  const options = createOptions();
  const bridge = api.createBridge(options);
  assert.deepEqual(JSON.parse(JSON.stringify(bridge.consume(
    options.readiness.readinessHandle,
    options.readiness.readinessBinding,
    'https://relay.example',
  ))), {
    allowed: true,
    providerOrigin: 'https://relay.example',
    policyRevision: '734',
  });
  assert.throws(
    () => bridge.consume(
      options.readiness.readinessHandle,
      options.readiness.readinessBinding,
      'https://relay.example',
    ),
    (error) => error && error.code === 'SS_ERP_BYOK_PERMISSION_READINESS_UNAVAILABLE',
  );
});

test('rejects replay of one prepared ticket across separately created bridges', () => {
  const api = loadApi();
  const options = createOptions();
  const first = api.createBridge(options);
  const replay = api.createBridge(options);
  assert.deepEqual(JSON.parse(JSON.stringify(first.consume(
    options.readiness.readinessHandle,
    options.readiness.readinessBinding,
    'https://relay.example',
  ))), {
    allowed: true,
    providerOrigin: 'https://relay.example',
    policyRevision: '734',
  });
  assert.throws(
    () => replay.consume(
      options.readiness.readinessHandle,
      options.readiness.readinessBinding,
      'https://relay.example',
    ),
    (error) => error && error.code === 'SS_ERP_BYOK_PERMISSION_READINESS_UNAVAILABLE',
  );
});

test('rejects stale, cross-profile, cross-shop and draft-bound readiness before permission I/O', () => {
  const api = loadApi();
  const invalidOptions = [
    createOptions({ now: () => new Date('2026-07-26T08:06:00.000Z') }),
    createOptions({ profile: { baseUrl: 'https://other.example/v1', model: 'image-model-v1' } }),
    createOptions({ shopId: 'shop-2' }),
    createOptions({ operation: 'FULL_EDIT' }),
    createOptions({
      readiness: readiness({
        readinessBinding: binding({
          workflowId: 'workflow-1',
          draftRevision: 2,
          draftVersion: 3,
        }),
      }),
    }),
  ];
  for (const input of invalidOptions) {
    assert.throws(
      () => api.createBridge(input),
      (error) => error && error.code.startsWith('SS_ERP_BYOK_PERMISSION_READINESS_'),
    );
  }
});

test('burns the bridge on a mismatched consume attempt and contains no side-channel APIs', () => {
  const api = loadApi();
  const options = createOptions();
  const bridge = api.createBridge(options);
  const replay = api.createBridge(options);
  assert.throws(
    () => bridge.consume(
      options.readiness.readinessHandle,
      options.readiness.readinessBinding,
      'https://other.example',
    ),
    (error) => error && error.code === 'SS_ERP_BYOK_PERMISSION_READINESS_MISMATCH',
  );
  assert.throws(
    () => bridge.consume(
      options.readiness.readinessHandle,
      options.readiness.readinessBinding,
      'https://relay.example',
    ),
    (error) => error && error.code === 'SS_ERP_BYOK_PERMISSION_READINESS_UNAVAILABLE',
  );
  assert.throws(
    () => replay.consume(
      options.readiness.readinessHandle,
      options.readiness.readinessBinding,
      'https://relay.example',
    ),
    (error) => error && error.code === 'SS_ERP_BYOK_PERMISSION_READINESS_UNAVAILABLE',
  );
  const source = fs.readFileSync(bridgePath, 'utf8');
  assert.doesNotMatch(source, /chrome\.storage|localStorage|sessionStorage|runtime\.sendMessage|console\./u);
});
