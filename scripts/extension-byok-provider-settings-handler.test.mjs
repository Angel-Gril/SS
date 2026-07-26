import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const schemaPath = 'extensions/ss-erp/shared/byok/profile-schema.js';
const handlerPath = 'extensions/ss-erp/shared/byok/provider-settings-handler.js';
const schemaSource = fs.readFileSync(schemaPath, 'utf8');
const handlerSource = fs.existsSync(handlerPath) ? fs.readFileSync(handlerPath, 'utf8') : '';

const TYPES = Object.freeze({
  GET_SETUP_CONTEXT: 'ss-erp:byok-provider-setup-context',
  LIST_PROFILES: 'ss-erp:byok-provider-profiles-list',
  GET_PROFILE_STATE: 'ss-erp:byok-provider-profile-state',
  SAVE_PROFILE: 'ss-erp:byok-provider-profile-save',
  REMOVE_PROFILE: 'ss-erp:byok-provider-profile-remove',
  SET_SESSION_KEY: 'ss-erp:byok-provider-session-key-set',
  CLEAR_SESSION_KEY: 'ss-erp:byok-provider-session-key-clear',
  PERMISSION_STATUS: 'ss-erp:byok-provider-permission-status',
  PREPARE_PERMISSION: 'ss-erp:byok-provider-permission-prepare',
  REQUEST_PERMISSION: 'ss-erp:byok-provider-permission-request',
  REVOKE_PERMISSION: 'ss-erp:byok-provider-permission-revoke',
  TEST_CAPABILITY: 'ss-erp:byok-provider-capability-test',
  GET_READINESS: 'ss-erp:byok-provider-readiness',
});

const secret = 'opaque-provider-secret-sentinel';

function profile(overrides = {}) {
  return {
    id: 'relay-profile-1',
    name: 'Catalog relay',
    baseUrl: 'https://relay.example/v1',
    model: 'image-model-v1',
    allowedOperations: ['TEXT_TO_IMAGE'],
    preferences: {
      defaultSize: '1024x1024',
      quality: 'auto',
      outputFormat: 'png',
    },
    ...overrides,
  };
}

function readinessBinding(overrides = {}) {
  return {
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
    policyRevision: '17',
    ...overrides,
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadDispatcher(overrides = {}) {
  const context = {
    Array,
    Boolean,
    Date,
    Error,
    JSON,
    Map,
    Math,
    Number,
    Object,
    Promise,
    Set,
    String,
    TypeError,
    URL,
  };
  context.globalThis = context;
  vm.runInNewContext(schemaSource, context, { filename: schemaPath });
  vm.runInNewContext(handlerSource, context, { filename: handlerPath });

  let keyPresent = true;
  const calls = [];
  const preparedPermissionHandles = new Set();
  const selectedProfile = profile();
  const profileRows = Array.isArray(overrides.profileRows)
    ? overrides.profileRows : [selectedProfile];
  const publicState = () => ({
    profile: {
      ...selectedProfile,
      apiKey: secret,
      internalCredential: secret,
    },
    hasKey: keyPresent,
    evidence: keyPresent ? [{
      contractVersion: 'extension-byok-capability/v1',
      profileIdentity: `https://relay.example/v1\u0000image-model-v1`,
      operation: 'TEXT_TO_IMAGE',
      requestMode: 'json',
      policyRevision: '17',
      verifiedAt: '2026-07-25T12:00:00.000Z',
      expiresAt: '2026-07-26T12:00:00.000Z',
      providerBody: secret,
    }] : [],
    apiKey: secret,
  });
  const profileStore = {
    async listPublicProfiles() {
      calls.push({ method: 'listPublicProfiles' });
      return profileRows.map((item) => ({ ...item, apiKey: secret, internalCredential: secret }));
    },
    async getProfile(id) {
      calls.push({ method: 'getProfile', id });
      return id === selectedProfile.id ? selectedProfile : null;
    },
    async getPublicState(id) {
      calls.push({ method: 'getPublicState', id });
      return id === selectedProfile.id ? publicState() : { profile: null, hasKey: false, evidence: [] };
    },
    async saveProfile(value) {
      calls.push({ method: 'saveProfile', value: plain(value) });
      return { profile: { ...value, apiKey: secret }, rebound: false, apiKey: secret };
    },
    async deleteProfile(id) {
      calls.push({ method: 'deleteProfile', id });
      return { deleted: id === selectedProfile.id, apiKey: secret };
    },
    async setApiKey(id, value) {
      calls.push({ method: 'setApiKey', id, value });
      keyPresent = true;
      return { profileId: id, hasKey: true, apiKey: secret };
    },
    async clearApiKey(id) {
      calls.push({ method: 'clearApiKey', id });
      keyPresent = false;
      return { profileId: id, cleared: true, apiKey: secret };
    },
  };
  let requestPermissionCalls = 0;
  const permissionBroker = {
    async containsOrigin(endpoint) {
      calls.push({ method: 'containsOrigin', endpoint });
      return {
        origin: 'https://relay.example',
        pattern: 'https://relay.example/*',
        granted: overrides.permissionGranted !== false,
      };
    },
    async hasOriginPermission(endpoint) {
      calls.push({ method: 'hasOriginPermission', endpoint });
      return {
        origin: 'https://relay.example',
        pattern: 'https://relay.example/*',
        granted: overrides.permissionGranted !== false,
        accessToken: secret,
      };
    },
    async removeOriginPermission(endpoint) {
      calls.push({ method: 'removeOriginPermission', endpoint });
      return {
        origin: 'https://relay.example',
        pattern: 'https://relay.example/*',
        removed: overrides.permissionRemoved !== false,
        credential: secret,
      };
    },
    async captureConsentEpoch() {
      calls.push({ method: 'captureConsentEpoch' });
      return 7;
    },
    async finalizeOriginConsent(endpoint, epoch) {
      calls.push({ method: 'finalizeOriginConsent', endpoint, epoch });
      return {
        origin: 'https://relay.example',
        pattern: 'https://relay.example/*',
        granted: overrides.permissionGranted !== false && epoch === 7,
      };
    },
    async requestOriginPermission() {
      requestPermissionCalls += 1;
      throw new Error('generic handler must never request permission');
    },
  };
  const readinessClient = {
    async getReadiness(value) {
      calls.push({ method: 'getReadiness', value: plain(value) });
      return {
        readinessHandle: 'rh_one_use_handle',
        readinessBinding: readinessBinding({ shopId: value.shopId, operation: value.operation }),
        expiresAt: '2026-07-25T12:10:00.000Z',
        accessToken: secret,
      };
    },
  };
  const capabilityClient = {
    async probe(value) {
      calls.push({ method: 'probe', value: plain(value) });
      return {
        contractVersion: 'extension-byok-capability/v1',
        profileId: value.profileId,
        operation: 'TEXT_TO_IMAGE',
        requestMode: 'json',
        policyRevision: '17',
        providerRequestId: secret,
        evidence: {
          verifiedAt: '2026-07-25T12:00:00.000Z',
          expiresAt: '2026-07-26T12:00:00.000Z',
          providerBody: secret,
        },
      };
    },
  };

  const dispatcher = context.SS_ERP_BYOK_PROVIDER_SETTINGS_HANDLER.createDispatcher({
    messageTypes: TYPES,
    profileSchema: context.SS_ERP_BYOK_PROFILE_SCHEMA,
    profileStore,
    permissionBroker,
    readinessClient,
    capabilityClient,
    async preparePermissionReadiness(value) {
      calls.push({ method: 'preparePermissionReadiness', value: plain(value) });
      if (preparedPermissionHandles.has(value.handleId)) {
        const error = new Error('verified readiness was already prepared');
        error.code = 'SS_ERP_BYOK_READINESS_UNAVAILABLE';
        throw error;
      }
      preparedPermissionHandles.add(value.handleId);
      return {
        readinessHandle: value.handleId,
        readinessBinding: value.binding,
        expiresAt: value.expiresAt,
        accessToken: secret,
      };
    },
    async readDeviceStatus() {
      calls.push({ method: 'readDeviceStatus' });
      return {
        state: 'paired',
        scopes: ['byok:media:ingest', 'listing:write', 'byok:media:ingest'],
        expiresAt: '2026-08-25T12:00:00.000Z',
        endpoint: 'https://api.ss-erp.example',
        sessionId: 'private-session-id',
        accessToken: secret,
      };
    },
    async listShops() {
      calls.push({ method: 'listShops' });
      return {
        ok: true,
        authMode: 'device',
        accessToken: secret,
        data: [
          {
            id: 'shop-1',
            platform: 'OZON',
            name: 'Ozon RU',
            status: 'ACTIVE',
            apiKey: secret,
          },
          { id: 'shop-2', platform: 'WB', name: 'Other marketplace', status: 'ACTIVE' },
        ],
      };
    },
    now: () => new Date('2026-07-25T12:00:00.000Z'),
    ...overrides,
  });
  return {
    api: context.SS_ERP_BYOK_PROVIDER_SETTINGS_HANDLER,
    dispatcher,
    calls,
    profileStore,
    permissionBroker,
    readinessClient,
    capabilityClient,
    getRequestPermissionCalls: () => requestPermissionCalls,
  };
}

test('exposes a closed generic handler map without invoking chrome permission requests', async () => {
  const { dispatcher, getRequestPermissionCalls } = loadDispatcher();
  const expected = Object.values(TYPES).sort();
  assert.deepEqual(Object.keys(dispatcher.handlers).sort(), expected);
  assert.equal(getRequestPermissionCalls(), 0);
});

test('projects setup context to public device and Ozon shop fields only', async () => {
  const { dispatcher } = loadDispatcher();
  const response = await dispatcher.handlers[TYPES.GET_SETUP_CONTEXT]({ payload: {} });
  assert.deepEqual(plain(response), {
    ok: true,
    data: {
      device: {
        state: 'paired',
        scopes: ['byok:media:ingest', 'listing:write'],
        expiresAt: '2026-08-25T12:00:00.000Z',
      },
      shops: [{ id: 'shop-1', name: 'Ozon RU', status: 'ACTIVE' }],
      shopsState: 'available',
    },
  });
  assert.equal(JSON.stringify(response).includes(secret), false);
  assert.equal(JSON.stringify(response).includes('private-session-id'), false);
  assert.equal(JSON.stringify(response).includes('api.ss-erp.example'), false);
});

test('keeps paired device and profile setup usable when shop discovery is temporarily unavailable', async () => {
  const { dispatcher } = loadDispatcher({
    async listShops() {
      return { ok: false, errorCode: 'temporary_failure', accessToken: secret };
    },
  });
  const response = await dispatcher.handlers[TYPES.GET_SETUP_CONTEXT]({ payload: {} });
  assert.equal(response.ok, true);
  assert.equal(response.data.device.state, 'paired');
  assert.deepEqual(plain(response.data.shops), []);
  assert.equal(response.data.shopsState, 'unavailable');
  assert.equal(JSON.stringify(response).includes(secret), false);
});

test('lists, reads, saves, and removes profiles through redacted projections', async () => {
  const { dispatcher, calls } = loadDispatcher();
  const listed = await dispatcher.handlers[TYPES.LIST_PROFILES]({ payload: {} });
  assert.deepEqual(plain(listed.data.profiles), [profile()]);

  const state = await dispatcher.handlers[TYPES.GET_PROFILE_STATE]({
    payload: { profileId: 'relay-profile-1' },
  });
  assert.equal(state.data.hasKey, true);
  assert.deepEqual(plain(state.data.evidence), [{
    contractVersion: 'extension-byok-capability/v1',
    operation: 'TEXT_TO_IMAGE',
    requestMode: 'json',
    policyRevision: '17',
    verifiedAt: '2026-07-25T12:00:00.000Z',
    expiresAt: '2026-07-26T12:00:00.000Z',
  }]);

  const saved = await dispatcher.handlers[TYPES.SAVE_PROFILE]({
    payload: { profile: profile({ name: 'Updated relay' }) },
  });
  assert.equal(saved.ok, true);
  assert.equal(calls.some((call) => call.method === 'saveProfile' && call.value.name === 'Updated relay'), true);

  const removed = await dispatcher.handlers[TYPES.REMOVE_PROFILE]({
    payload: { profileId: 'relay-profile-1' },
  });
  assert.deepEqual(plain(removed), {
    ok: true,
    data: { profileId: 'relay-profile-1', deleted: true },
  });
  assert.equal(JSON.stringify([listed, state, saved, removed]).includes(secret), false);
});

test('reads a session key once, never returns it, and clears only the selected profile key', async () => {
  const { dispatcher, calls } = loadDispatcher();
  let reads = 0;
  const set = await dispatcher.handlers[TYPES.SET_SESSION_KEY]({
    readSecretPayload() {
      reads += 1;
      return { profileId: 'relay-profile-1', apiKey: secret };
    },
  });
  assert.equal(reads, 1);
  assert.equal(set.ok, true);
  assert.equal(set.data.hasKey, true);
  assert.equal(JSON.stringify(set).includes(secret), false);
  assert.equal(calls.filter((call) => call.method === 'setApiKey').length, 1);
  assert.equal(calls.find((call) => call.method === 'setApiKey').value, secret);

  const cleared = await dispatcher.handlers[TYPES.CLEAR_SESSION_KEY]({
    payload: { profileId: 'relay-profile-1' },
  });
  assert.equal(cleared.ok, true);
  assert.equal(cleared.data.hasKey, false);
  assert.deepEqual(plain(cleared.data.evidence), []);
  assert.equal(calls.filter((call) => call.method === 'clearApiKey').length, 1);
  assert.equal(calls.find((call) => call.method === 'clearApiKey').id, 'relay-profile-1');
  assert.equal(JSON.stringify(cleared).includes(secret), false);
});

test('derives exact permission origin from the stored profile and never requests permission generically', async () => {
  const { dispatcher, calls, getRequestPermissionCalls } = loadDispatcher();
  const status = await dispatcher.handlers[TYPES.PERMISSION_STATUS]({
    payload: { profileId: 'relay-profile-1' },
  });
  assert.deepEqual(plain(status), {
    ok: true,
    data: { profileId: 'relay-profile-1', origin: 'https://relay.example', granted: true },
  });
  const revoked = await dispatcher.handlers[TYPES.REVOKE_PERMISSION]({
    payload: { profileId: 'relay-profile-1' },
  });
  assert.deepEqual(plain(revoked), {
    ok: true,
    data: { profileId: 'relay-profile-1', origin: 'https://relay.example', removed: true },
  });
  assert.deepEqual(
    calls.filter((call) => ['hasOriginPermission', 'removeOriginPermission'].includes(call.method))
      .map((call) => ({ method: call.method, endpoint: call.endpoint })),
    [
      { method: 'hasOriginPermission', endpoint: 'https://relay.example/v1' },
      { method: 'removeOriginPermission', endpoint: 'https://relay.example/v1' },
    ],
  );
  assert.equal(getRequestPermissionCalls(), 0);
  assert.equal(JSON.stringify([status, revoked]).includes(secret), false);
});

test('revokes an abandoned old origin before profile rebind or final-profile deletion', async () => {
  const rebound = loadDispatcher();
  const saved = await rebound.dispatcher.handlers[TYPES.SAVE_PROFILE]({
    payload: { profile: profile({ baseUrl: 'https://new-relay.example/v1' }) },
  });
  assert.equal(saved.ok, true);
  const reboundCalls = rebound.calls.map((call) => call.method);
  assert.ok(reboundCalls.indexOf('removeOriginPermission') < reboundCalls.indexOf('saveProfile'));
  assert.equal(
    rebound.calls.find((call) => call.method === 'removeOriginPermission').endpoint,
    'https://relay.example/v1',
  );

  const shared = loadDispatcher({
    profileRows: [profile(), profile({ id: 'relay-profile-2', name: 'Shared origin' })],
  });
  const removed = await shared.dispatcher.handlers[TYPES.REMOVE_PROFILE]({
    payload: { profileId: 'relay-profile-1' },
  });
  assert.equal(removed.ok, true);
  assert.equal(shared.calls.some((call) => call.method === 'removeOriginPermission'), false);
});

test('fails profile rebind closed when an abandoned exact-origin permission remains granted', async () => {
  const fixture = loadDispatcher({ permissionRemoved: false, permissionGranted: true });
  const saved = await fixture.dispatcher.handlers[TYPES.SAVE_PROFILE]({
    payload: { profile: profile({ baseUrl: 'https://new-relay.example/v1' }) },
  });
  assert.equal(saved.ok, false);
  assert.equal(saved.errorCode, 'SS_ERP_BYOK_PERMISSION_REVOKE_FAILED');
  assert.equal(fixture.calls.some((call) => call.method === 'saveProfile'), false);
});

test('prepares permission by consuming authorized readiness before the page click', async () => {
  const { dispatcher, calls } = loadDispatcher();
  const prepared = await dispatcher.handlers[TYPES.PREPARE_PERMISSION]({
    payload: { profileId: 'relay-profile-1', operation: 'TEXT_TO_IMAGE' },
    authorization: {
      readiness: {
        handleId: 'rh_verified_once',
        expiresAt: '2026-07-25T12:10:00.000Z',
        binding: readinessBinding(),
      },
    },
  });
  assert.deepEqual(plain(prepared), {
    ok: true,
    data: {
      readinessHandle: 'rh_verified_once',
      readinessBinding: readinessBinding(),
      expiresAt: '2026-07-25T12:10:00.000Z',
    },
  });
  assert.equal(calls.filter((call) => call.method === 'preparePermissionReadiness').length, 1);
  assert.deepEqual(
    calls.find((call) => call.method === 'preparePermissionReadiness').value,
    {
      handleId: 'rh_verified_once',
      expiresAt: '2026-07-25T12:10:00.000Z',
      binding: readinessBinding(),
    },
  );
  assert.equal(JSON.stringify(prepared).includes(secret), false);

  const replay = await dispatcher.handlers[TYPES.PREPARE_PERMISSION]({
    payload: { profileId: 'relay-profile-1', operation: 'TEXT_TO_IMAGE' },
    authorization: {
      readiness: {
        handleId: 'rh_verified_once',
        expiresAt: '2026-07-25T12:10:00.000Z',
        binding: readinessBinding(),
      },
    },
  });
  assert.deepEqual(plain(replay), {
    ok: false,
    errorCode: 'SS_ERP_BYOK_READINESS_UNAVAILABLE',
    error: 'BYOK Provider settings operation failed',
  });
  assert.equal(JSON.stringify(replay).includes(secret), false);
});

test('finalizes page-granted permission once through live readiness and background consent authority', async () => {
  const { dispatcher, calls } = loadDispatcher();
  const binding = readinessBinding();
  await dispatcher.handlers[TYPES.PREPARE_PERMISSION]({
    payload: { profileId: 'relay-profile-1', operation: 'TEXT_TO_IMAGE' },
    authorization: {
      readiness: {
        handleId: 'rh_finalize_once',
        expiresAt: '2026-07-25T12:10:00.000Z',
        binding,
      },
    },
  });
  const finalized = await dispatcher.handlers[TYPES.REQUEST_PERMISSION]({
    payload: {
      profileId: 'relay-profile-1',
      shopId: 'shop-1',
      operation: 'TEXT_TO_IMAGE',
      permissionTicket: 'rh_finalize_once',
    },
  });
  assert.deepEqual(plain(finalized), {
    ok: true,
    data: {
      profileId: 'relay-profile-1',
      origin: 'https://relay.example',
      granted: true,
    },
  });
  assert.deepEqual(
    calls.filter((call) => [
      'captureConsentEpoch', 'getReadiness', 'containsOrigin', 'finalizeOriginConsent',
    ].includes(call.method)).map((call) => call.method),
    ['captureConsentEpoch', 'getReadiness', 'containsOrigin', 'finalizeOriginConsent'],
  );
  assert.deepEqual(
    calls.find((call) => call.method === 'finalizeOriginConsent'),
    { method: 'finalizeOriginConsent', endpoint: 'https://relay.example/v1', epoch: 7 },
  );

  const replay = await dispatcher.handlers[TYPES.REQUEST_PERMISSION]({
    payload: {
      profileId: 'relay-profile-1',
      shopId: 'shop-1',
      operation: 'TEXT_TO_IMAGE',
      permissionTicket: 'rh_finalize_once',
    },
  });
  assert.equal(replay.ok, false);
  assert.equal(replay.errorCode, 'SS_ERP_BYOK_PERMISSION_READINESS_UNAVAILABLE');
});

test('rejects PREPARE_PERMISSION fixture drift before consuming verified readiness', async () => {
  const { dispatcher, calls } = loadDispatcher();
  for (const authorization of [
    undefined,
    { readiness: { handleId: 'rh_missing_binding' } },
    {
      readiness: {
        handleId: 'rh_wrong_model',
        expiresAt: '2026-07-25T12:10:00.000Z',
        binding: readinessBinding({ model: 'other-model' }),
      },
    },
    {
      readiness: {
        handleId: 'rh_wrong_origin',
        expiresAt: '2026-07-25T12:10:00.000Z',
        binding: readinessBinding({ providerOrigin: 'https://other.example' }),
      },
    },
  ]) {
    const response = await dispatcher.handlers[TYPES.PREPARE_PERMISSION]({
      payload: { profileId: 'relay-profile-1', operation: 'TEXT_TO_IMAGE' },
      ...(authorization ? { authorization } : {}),
    });
    assert.equal(response.ok, false);
    assert.equal(response.errorCode, 'SS_ERP_BYOK_PROVIDER_READINESS_MISMATCH');
  }
  assert.equal(calls.some((call) => call.method === 'preparePermissionReadiness'), false);
});

test('requires an explicit shop for readiness and returns a projected one-use envelope', async () => {
  const { dispatcher, calls } = loadDispatcher();
  const missingShop = await dispatcher.handlers[TYPES.GET_READINESS]({
    payload: {
      profileId: 'relay-profile-1',
      operation: 'TEXT_TO_IMAGE',
      workflowId: null,
      draftRevision: null,
      draftVersion: null,
    },
  });
  assert.equal(missingShop.ok, false);
  assert.equal(missingShop.errorCode, 'SS_ERP_BYOK_PROVIDER_SETTINGS_INPUT_INVALID');
  assert.equal(calls.some((call) => call.method === 'getReadiness'), false);

  const response = await dispatcher.handlers[TYPES.GET_READINESS]({
    payload: {
      profileId: 'relay-profile-1',
      shopId: 'shop-1',
      operation: 'TEXT_TO_IMAGE',
      workflowId: null,
      draftRevision: null,
      draftVersion: null,
    },
  });
  assert.equal(response.ok, true);
  assert.equal(response.data.readinessHandle, 'rh_one_use_handle');
  assert.deepEqual(plain(response.data.readinessBinding), readinessBinding());
  assert.equal(JSON.stringify(response).includes(secret), false);
  assert.deepEqual(
    calls.find((call) => call.method === 'getReadiness').value,
    {
      profileId: 'relay-profile-1',
      shopId: 'shop-1',
      operation: 'TEXT_TO_IMAGE',
      workflowId: null,
      draftRevision: null,
      draftVersion: null,
    },
  );
});

test('probes only implemented operations with the authorized readiness binding and redacts evidence', async () => {
  const { dispatcher, calls } = loadDispatcher();
  const authorization = { readiness: { binding: readinessBinding() } };
  const response = await dispatcher.handlers[TYPES.TEST_CAPABILITY]({
    payload: {
      profileId: 'relay-profile-1',
      operation: 'TEXT_TO_IMAGE',
      idempotencyKey: 'probe-text-to-image-1',
    },
    authorization,
  });
  assert.deepEqual(plain(response), {
    ok: true,
    data: {
      contractVersion: 'extension-byok-capability/v1',
      profileId: 'relay-profile-1',
      operation: 'TEXT_TO_IMAGE',
      requestMode: 'json',
      policyRevision: '17',
      verifiedAt: '2026-07-25T12:00:00.000Z',
      expiresAt: '2026-07-26T12:00:00.000Z',
    },
  });
  const probe = calls.find((call) => call.method === 'probe');
  assert.equal(probe.value.profileId, 'relay-profile-1');
  assert.equal(probe.value.idempotencyKey, 'probe-text-to-image-1');
  assert.equal(probe.value.size, '1024x1024');
  assert.deepEqual(probe.value.readinessBinding, readinessBinding());
  assert.equal(typeof probe.value.prompt, 'string');
  assert.equal(probe.value.prompt.length > 0, true);
  assert.equal(JSON.stringify(response).includes(secret), false);

  const unsupported = await dispatcher.handlers[TYPES.TEST_CAPABILITY]({
    payload: {
      profileId: 'relay-profile-1',
      operation: 'FULL_EDIT',
      idempotencyKey: 'probe-full-edit-1',
    },
    authorization: { readiness: { binding: readinessBinding({ operation: 'FULL_EDIT' }) } },
  });
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.errorCode, 'SS_ERP_BYOK_PROVIDER_OPERATION_UNSUPPORTED');
  assert.equal(calls.filter((call) => call.method === 'probe').length, 1);
});

test('maps dependency failures to stable codes without reflecting secret-bearing messages', async () => {
  const { dispatcher } = loadDispatcher({
    profileStore: {
      async listPublicProfiles() { return []; },
      async getProfile() { return profile(); },
      async getPublicState() { return { profile: profile(), hasKey: false, evidence: [] }; },
      async saveProfile() { return {}; },
      async deleteProfile() { return { deleted: false }; },
      async clearApiKey() { return {}; },
      async setApiKey() {
        const error = new Error(`Provider rejected ${secret}`);
        error.code = 'SS_ERP_BYOK_API_KEY_INVALID';
        throw error;
      },
    },
  });
  const response = await dispatcher.handlers[TYPES.SET_SESSION_KEY]({
    readSecretPayload() { return { profileId: 'relay-profile-1', apiKey: secret }; },
  });
  assert.deepEqual(plain(response), {
    ok: false,
    errorCode: 'SS_ERP_BYOK_API_KEY_INVALID',
    error: 'BYOK Provider settings operation failed',
  });
  assert.equal(JSON.stringify(response).includes(secret), false);
});

console.log('PASS extension BYOK Provider settings background handler contract');
