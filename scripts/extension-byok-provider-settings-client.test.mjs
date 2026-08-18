import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const permissionPath = 'extensions/ss-erp/shared/byok/permission-broker.js';
const bridgePath = 'extensions/ss-erp/shared/byok/permission-readiness-bridge.js';
const clientPath = 'extensions/ss-erp/shared/byok/provider-settings-client.js';

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function createSessionStorage() {
  const values = new Map();
  return {
    async get(keys) {
      const requested = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(requested
        .filter((key) => values.has(key))
        .map((key) => [key, plain(values.get(key))]));
    },
    async set(input) {
      for (const [key, value] of Object.entries(input)) values.set(key, plain(value));
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key);
    },
  };
}

function readiness() {
  return {
    readinessHandle: 'rh_' + 'a'.repeat(48),
    readinessBinding: {
      contractVersion: 'extension-byok-readiness-binding/v2',
      ownerUserId: 'owner-1',
      deviceSessionId: 'device-session-1',
      shopId: 'shop-1',
      workflowId: null,
      draftRevision: null,
      draftVersion: null,
      sourcePlatform: null,
      sourceProductId: null,
      sourceCaptureSnapshotId: null,
      supplyGoodsId: null,
      skuKey: null,
      slotKey: null,
      assignmentMode: null,
      assignmentOrdinal: null,
      providerOrigin: 'https://relay.example',
      model: 'image-model-v1',
      operation: 'TEXT_TO_IMAGE',
      policyRevision: '734',
    },
    expiresAt: '2026-07-26T08:05:00.000Z',
  };
}

function loadClient(options = {}) {
  const messages = [];
  const responses = new Map();
  let permissionRequestCount = 0;
  class TestEvent {
    constructor(isTrusted) { this.isTrusted = isTrusted; }
  }
  TestEvent.prototype.composedPath = function () { return []; };
  const permissions = {
    contains(_input, callback) { callback(false); },
    request(_input, callback) {
      permissionRequestCount += 1;
      callback(true);
    },
    remove(_input, callback) { callback(true); },
  };
  const runtime = {
    lastError: null,
    sendMessage(message, callback) {
      messages.push(plain(message));
      if (Array.isArray(options.deferredTypes) && options.deferredTypes.includes(message.type)) {
        return;
      }
      if (Array.isArray(options.runtimeLastErrorTypes)
        && options.runtimeLastErrorTypes.includes(message.type)) {
        runtime.lastError = { message: 'message channel closed' };
        callback(undefined);
        runtime.lastError = null;
        return;
      }
      callback(responses.get(message.type) || { ok: true, data: {} });
    },
  };
  const context = {
    Array,
    Boolean,
    Date,
    Error,
    Event: TestEvent,
    Map,
    Number,
    Object,
    Promise,
    Set,
    String,
    TypeError,
    URL,
    WeakMap,
    WeakSet,
    clearTimeout: options.clearTimeout || clearTimeout,
    setTimeout: options.setTimeout || setTimeout,
  };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(permissionPath, 'utf8'), context, { filename: permissionPath });
  vm.runInNewContext(fs.readFileSync(bridgePath, 'utf8'), context, { filename: bridgePath });
  vm.runInNewContext(fs.readFileSync(clientPath, 'utf8'), context, { filename: clientPath });
  const client = context.SS_ERP_BYOK_PROVIDER_SETTINGS_CLIENT.createClient({
    runtime,
    permissions,
    sessionStorage: options.sessionStorage || createSessionStorage(),
    now: () => new Date('2026-07-26T08:00:00.000Z'),
  });
  return {
    api: context.SS_ERP_BYOK_PROVIDER_SETTINGS_CLIENT,
    client,
    messages,
    responses,
    TestEvent,
    permissionRequestCalled: () => permissionRequestCount > 0,
    permissionRequestCount: () => permissionRequestCount,
  };
}

test('keeps capability runtime messaging alive beyond the background Provider deadline', async () => {
  const delays = [];
  const loaded = loadClient({
    setTimeout(_callback, delay) {
      delays.push(delay);
      return { delay };
    },
    clearTimeout() {},
  });
  loaded.responses.set(loaded.api.MESSAGE_TYPES.TEST_CAPABILITY, {
    ok: true,
    data: { operation: 'TEXT_TO_IMAGE' },
  });
  await loaded.client.listProfiles();
  await loaded.client.testCapability({
    profileId: 'relay-profile-1',
    operation: 'TEXT_TO_IMAGE',
    idempotencyKey: 'probe-long-running-1',
    prompt: 'A neutral catalog product test image on a plain white background. No text.',
    quotedCostUsd: 0.08,
    maximumCostUsd: 0.10,
    readiness: readiness(),
  });
  assert.equal(delays[0], 15_000);
  assert.equal(
    delays[1],
    315_000,
    'capability messaging must outlive the 240-second background Provider deadline',
  );
});

test('locks an uncertain capability probe instead of retrying it with a fresh id', async () => {
  const timers = [];
  const loaded = loadClient({
    deferredTypes: ['ss-erp:byok-provider-capability-test'],
    setTimeout(callback, delay) {
      timers.push({ callback, delay });
      return timers.length;
    },
    clearTimeout() {},
  });
  const pending = loaded.client.testCapability({
    profileId: 'relay-profile-1',
    operation: 'TEXT_TO_IMAGE',
    idempotencyKey: 'probe-uncertain-1',
    prompt: 'A neutral catalog product test image on a plain white background. No text.',
    quotedCostUsd: 0.08,
    maximumCostUsd: 0.10,
    readiness: readiness(),
  });
  assert.equal(timers[0].delay, 315_000);
  timers[0].callback();
  await assert.rejects(
    pending,
    (error) => error
      && error.code === 'SS_ERP_BYOK_PROVIDER_UNKNOWN_OUTCOME'
      && error.outcome === 'UNKNOWN_OUTCOME'
      && error.automaticRetryAllowed === false,
  );
  await assert.rejects(
    loaded.client.testCapability({
      profileId: 'relay-profile-1',
      operation: 'TEXT_TO_IMAGE',
      idempotencyKey: 'probe-uncertain-2',
      prompt: 'A neutral catalog product test image on a plain white background. No text.',
      quotedCostUsd: 0.08,
      maximumCostUsd: 0.10,
      readiness: readiness(),
    }),
    (error) => error
      && error.code === 'SS_ERP_BYOK_PROVIDER_UNKNOWN_OUTCOME'
      && error.replayed === true,
  );
  await loaded.client.saveProfile({ id: 'relay-profile-1' });
  await assert.rejects(
    loaded.client.testCapability({
      profileId: 'relay-profile-1',
      operation: 'TEXT_TO_IMAGE',
      idempotencyKey: 'probe-uncertain-3',
      prompt: 'A neutral catalog product test image on a plain white background. No text.',
      quotedCostUsd: 0.08,
      maximumCostUsd: 0.10,
      readiness: readiness(),
    }),
    (error) => error
      && error.code === 'SS_ERP_BYOK_PROVIDER_UNKNOWN_OUTCOME'
      && error.replayed === true,
  );
  assert.equal(
    loaded.messages.filter((message) => message.type === loaded.api.MESSAGE_TYPES.TEST_CAPABILITY).length,
    1,
  );
});

test('treats capability runtime channel loss as an unknown Provider outcome', async () => {
  const loaded = loadClient({
    runtimeLastErrorTypes: ['ss-erp:byok-provider-capability-test'],
  });
  await assert.rejects(
    loaded.client.testCapability({
      profileId: 'relay-profile-1',
      operation: 'TEXT_TO_IMAGE',
      idempotencyKey: 'probe-channel-loss-1',
      prompt: 'A neutral catalog product test image on a plain white background. No text.',
      quotedCostUsd: 0.08,
      maximumCostUsd: 0.10,
      readiness: readiness(),
    }),
    (error) => error
      && error.code === 'SS_ERP_BYOK_PROVIDER_UNKNOWN_OUTCOME'
      && error.outcome === 'UNKNOWN_OUTCOME'
      && error.automaticRetryAllowed === false,
  );
});

test('uses the exact closed background message contract and binds capability readiness', async () => {
  const loaded = loadClient();
  loaded.responses.set(loaded.api.MESSAGE_TYPES.GET_READINESS, { ok: true, data: readiness() });
  loaded.responses.set(loaded.api.MESSAGE_TYPES.TEST_CAPABILITY, {
    ok: true,
    data: { operation: 'TEXT_TO_IMAGE', verifiedAt: '2026-07-26T08:00:00.000Z' },
  });
  const ready = await loaded.client.getReadiness({
    profileId: 'relay-profile-1',
    shopId: 'shop-1',
    operation: 'TEXT_TO_IMAGE',
  });
  await loaded.client.testCapability({
    profileId: 'relay-profile-1',
    operation: 'TEXT_TO_IMAGE',
    idempotencyKey: 'probe-1',
    prompt: 'A neutral catalog product test image on a plain white background. No text.',
    quotedCostUsd: 0.08,
    maximumCostUsd: 0.10,
    readiness: ready,
  });
  assert.deepEqual(loaded.messages[0], {
    type: loaded.api.MESSAGE_TYPES.GET_READINESS,
    payload: {
      profileId: 'relay-profile-1',
      shopId: 'shop-1',
      workflowId: null,
      draftRevision: null,
      draftVersion: null,
      operation: 'TEXT_TO_IMAGE',
    },
  });
  assert.equal(loaded.messages[1].readinessHandle, ready.readinessHandle);
  assert.deepEqual(loaded.messages[1].readinessBinding, plain(ready.readinessBinding));
});

test('transports a custom text prompt and bounded USD cost control', async () => {
  const loaded = loadClient();
  loaded.responses.set(loaded.api.MESSAGE_TYPES.TEST_CAPABILITY, {
    ok: true,
    data: { operation: 'TEXT_TO_IMAGE', verifiedAt: '2026-07-26T08:00:00.000Z' },
  });
  await loaded.client.testCapability({
    profileId: 'relay-profile-1',
    operation: 'TEXT_TO_IMAGE',
    idempotencyKey: 'probe-custom-cost-1',
    prompt: '生成一张白色马克杯的纯白背景产品图',
    quotedCostUsd: 0.08,
    maximumCostUsd: 0.10,
    readiness: readiness(),
  });
  assert.deepEqual(loaded.messages[0].payload, {
    profileId: 'relay-profile-1',
    operation: 'TEXT_TO_IMAGE',
    idempotencyKey: 'probe-custom-cost-1',
    prompt: '生成一张白色马克杯的纯白背景产品图',
    quotedCostUsd: 0.08,
    maximumCostUsd: 0.1,
  });
});

test('keeps the session key request one-way and maps background failures to stable codes', async () => {
  const loaded = loadClient();
  const secret = 'opaque-session-key-\u212A-sentinel';
  loaded.responses.set(loaded.api.MESSAGE_TYPES.SET_SESSION_KEY, {
    ok: true,
    data: { profile: null, hasKey: true, evidence: [] },
  });
  const state = await loaded.client.setSessionKey('relay-profile-1', secret);
  assert.equal(state.hasKey, true);
  assert.equal(JSON.stringify(state).includes(secret), false);
  assert.equal(loaded.messages[0].payload.apiKey, secret);

  loaded.responses.set(loaded.api.MESSAGE_TYPES.CLEAR_SESSION_KEY, {
    ok: false,
    errorCode: 'SS_ERP_BYOK_PROFILE_NOT_FOUND',
    error: `must not echo ${secret}`,
  });
  await assert.rejects(
    loaded.client.clearSessionKey('relay-profile-1'),
    (error) => error && error.code === 'SS_ERP_BYOK_PROFILE_NOT_FOUND'
      && !String(error.message).includes(secret),
  );
});

test('projects only a safe readiness reason code from background failures', async () => {
  const loaded = loadClient();
  loaded.responses.set(loaded.api.MESSAGE_TYPES.GET_READINESS, {
    ok: false,
    errorCode: 'SS_ERP_BYOK_READINESS_UNAVAILABLE',
    error: 'generic safe failure',
    reasonCode: 'ORIGIN_NOT_ALLOWED',
    readinessErrorCode: 'byok_readiness_not_ready',
    readinessState: 'response',
    readinessStatus: 409,
  });
  await assert.rejects(
    loaded.client.getReadiness({
      profileId: 'relay-profile-1',
      shopId: 'shop-1',
      operation: 'TEXT_TO_IMAGE',
    }),
    (error) => error
      && error.code === 'SS_ERP_BYOK_READINESS_UNAVAILABLE'
      && error.reasonCode === 'ORIGIN_NOT_ALLOWED'
      && error.errorCode === 'byok_readiness_not_ready'
      && error.state === 'response'
      && error.status === 409,
  );

  loaded.responses.set(loaded.api.MESSAGE_TYPES.GET_READINESS, {
    ok: false,
    errorCode: 'SS_ERP_BYOK_READINESS_UNAVAILABLE',
    error: 'generic safe failure',
    reasonCode: 'UNSAFE_UNRECOGNIZED_REASON',
  });
  await assert.rejects(
    loaded.client.getReadiness({
      profileId: 'relay-profile-1',
      shopId: 'shop-1',
      operation: 'TEXT_TO_IMAGE',
    }),
    (error) => error
      && error.code === 'SS_ERP_BYOK_READINESS_UNAVAILABLE'
      && !Object.prototype.hasOwnProperty.call(error, 'reasonCode'),
  );
});

test('invokes exact-origin permissions.request synchronously inside the trusted click path', async () => {
  const loaded = loadClient();
  loaded.responses.set(loaded.api.MESSAGE_TYPES.PREPARE_PERMISSION, {
    ok: true,
    data: readiness(),
  });
  loaded.responses.set(loaded.api.MESSAGE_TYPES.REQUEST_PERMISSION, {
    ok: true,
    data: {
      profileId: 'relay-profile-1',
      origin: 'https://relay.example',
      granted: true,
    },
  });
  const prepared = await loaded.client.preparePermission({
    profileId: 'relay-profile-1',
    operation: 'TEXT_TO_IMAGE',
    readiness: readiness(),
  });
  const request = loaded.client.requestPermissionFromGesture({
    event: new loaded.TestEvent(true),
    profile: { id: 'relay-profile-1', baseUrl: 'https://relay.example/v1', model: 'image-model-v1' },
    shopId: 'shop-1',
    operation: 'TEXT_TO_IMAGE',
    readiness: prepared,
  });
  assert.equal(
    loaded.permissionRequestCalled(),
    true,
    'permissions.request must run before control returns from the click call stack',
  );
  assert.deepEqual(plain(await request), {
    profileId: 'relay-profile-1',
    origin: 'https://relay.example',
    granted: true,
  });
  const finalizeMessage = loaded.messages.find((message) => (
    message.type === loaded.api.MESSAGE_TYPES.REQUEST_PERMISSION
  ));
  assert.deepEqual(finalizeMessage, {
    type: loaded.api.MESSAGE_TYPES.REQUEST_PERMISSION,
    payload: {
      profileId: 'relay-profile-1',
      shopId: 'shop-1',
      operation: 'TEXT_TO_IMAGE',
      permissionTicket: readiness().readinessHandle,
    },
  });
  const prepareMessage = loaded.messages.find((message) => (
    message.type === loaded.api.MESSAGE_TYPES.PREPARE_PERMISSION
  ));
  assert.equal(prepareMessage.readinessHandle, readiness().readinessHandle);
  assert.throws(
    () => loaded.client.requestPermissionFromGesture({
      event: new loaded.TestEvent(true),
      profile: { baseUrl: 'https://relay.example/v1', model: 'image-model-v1' },
      shopId: 'shop-1',
      operation: 'TEXT_TO_IMAGE',
      readiness: prepared,
    }),
    (error) => error && error.code === 'SS_ERP_BYOK_PERMISSION_READINESS_UNAVAILABLE',
  );
  assert.equal(loaded.permissionRequestCount(), 1);
});

test('burns a prepared ticket after a synthetic gesture without Chrome permission I/O', async () => {
  const loaded = loadClient();
  loaded.responses.set(loaded.api.MESSAGE_TYPES.PREPARE_PERMISSION, {
    ok: true,
    data: readiness(),
  });
  const prepared = await loaded.client.preparePermission({
    profileId: 'relay-profile-1',
    operation: 'TEXT_TO_IMAGE',
    readiness: readiness(),
  });
  assert.throws(
    () => loaded.client.requestPermissionFromGesture({
      event: new loaded.TestEvent(false),
      profile: { baseUrl: 'https://relay.example/v1', model: 'image-model-v1' },
      shopId: 'shop-1',
      operation: 'TEXT_TO_IMAGE',
      readiness: prepared,
    }),
    (error) => error && error.code === 'SS_ERP_BYOK_PERMISSION_GESTURE_REQUIRED',
  );
  assert.throws(
    () => loaded.client.requestPermissionFromGesture({
      event: new loaded.TestEvent(true),
      profile: { baseUrl: 'https://relay.example/v1', model: 'image-model-v1' },
      shopId: 'shop-1',
      operation: 'TEXT_TO_IMAGE',
      readiness: prepared,
    }),
    (error) => error && error.code === 'SS_ERP_BYOK_PERMISSION_READINESS_UNAVAILABLE',
  );
  assert.equal(loaded.permissionRequestCalled(), false);
});

test('collapses duplicate prepared tickets and discards the exact ticket once', async () => {
  const loaded = loadClient();
  loaded.responses.set(loaded.api.MESSAGE_TYPES.PREPARE_PERMISSION, {
    ok: true,
    data: readiness(),
  });
  const first = await loaded.client.preparePermission({
    profileId: 'relay-profile-1',
    operation: 'TEXT_TO_IMAGE',
    readiness: readiness(),
  });
  const replay = await loaded.client.preparePermission({
    profileId: 'relay-profile-1',
    operation: 'TEXT_TO_IMAGE',
    readiness: readiness(),
  });
  assert.deepEqual(plain(first), plain(replay));
  assert.deepEqual(plain(loaded.client.discardPreparedPermission(first)), { discarded: true });
  assert.deepEqual(plain(loaded.client.discardPreparedPermission(replay)), { discarded: false });
  assert.throws(
    () => loaded.client.requestPermissionFromGesture({
      event: new loaded.TestEvent(true),
      profile: { baseUrl: 'https://relay.example/v1', model: 'image-model-v1' },
      shopId: 'shop-1',
      operation: 'TEXT_TO_IMAGE',
      readiness: replay,
    }),
    (error) => error && error.code === 'SS_ERP_BYOK_PERMISSION_READINESS_UNAVAILABLE',
  );
  assert.equal(loaded.permissionRequestCount(), 0);
});

test('invalidates all prepared permission tickets on device-session changes', async () => {
  const loaded = loadClient();
  loaded.responses.set(loaded.api.MESSAGE_TYPES.PREPARE_PERMISSION, {
    ok: true,
    data: readiness(),
  });
  const prepared = await loaded.client.preparePermission({
    profileId: 'relay-profile-1',
    operation: 'TEXT_TO_IMAGE',
    readiness: readiness(),
  });
  const secondReadiness = readiness();
  secondReadiness.readinessHandle = 'rh_' + 'b'.repeat(48);
  loaded.responses.set(loaded.api.MESSAGE_TYPES.PREPARE_PERMISSION, {
    ok: true,
    data: secondReadiness,
  });
  const secondPrepared = await loaded.client.preparePermission({
    profileId: 'relay-profile-1',
    operation: 'TEXT_TO_IMAGE',
    readiness: secondReadiness,
  });
  assert.equal(
    loaded.api.DEVICE_SESSION_INVALIDATED_MESSAGE,
    'ss-erp:byok-device-session-invalidated',
  );
  assert.deepEqual(plain(loaded.client.invalidatePreparedPermissions()), { cleared: 2 });
  assert.deepEqual(plain(loaded.client.invalidatePreparedPermissions()), { cleared: 0 });
  assert.throws(
    () => loaded.client.requestPermissionFromGesture({
      event: new loaded.TestEvent(true),
      profile: { baseUrl: 'https://relay.example/v1', model: 'image-model-v1' },
      shopId: 'shop-1',
      operation: 'TEXT_TO_IMAGE',
      readiness: prepared,
    }),
    (error) => error && error.code === 'SS_ERP_BYOK_PERMISSION_READINESS_UNAVAILABLE',
  );
  assert.throws(
    () => loaded.client.requestPermissionFromGesture({
      event: new loaded.TestEvent(true),
      profile: { baseUrl: 'https://relay.example/v1', model: 'image-model-v1' },
      shopId: 'shop-1',
      operation: 'TEXT_TO_IMAGE',
      readiness: secondPrepared,
    }),
    (error) => error && error.code === 'SS_ERP_BYOK_PERMISSION_READINESS_UNAVAILABLE',
  );
  assert.equal(loaded.permissionRequestCount(), 0);
});
