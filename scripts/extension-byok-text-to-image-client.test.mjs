import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const schemaPath = 'extensions/ss-erp/shared/byok/profile-schema.js';
const permissionPath = 'extensions/ss-erp/shared/byok/permission-broker.js';
const storePath = 'extensions/ss-erp/shared/byok/profile-store.js';
const clientPath = 'extensions/ss-erp/shared/byok/text-to-image-client.js';
const schemaSource = fs.readFileSync(schemaPath, 'utf8');
const permissionSource = fs.readFileSync(permissionPath, 'utf8');
const storeSource = fs.readFileSync(storePath, 'utf8');
const clientSource = fs.existsSync(clientPath) ? fs.readFileSync(clientPath, 'utf8') : '';

const pngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const webpBytes = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x08, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
]);

function sha256Text(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function jsonResponse(value, init = {}) {
  return new Response(JSON.stringify(value), {
    status: init.status || 200,
    headers: {
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

function profile(overrides = {}) {
  return {
    id: 'relay-profile-1',
    name: 'Relay images',
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

function readiness(overrides = {}) {
  return {
    contractVersion: 'extension-byok-readiness-binding/v2',
    ownerUserId: 'owner-1',
    deviceSessionId: 'device-session-1',
    shopId: 'shop-1',
    workflowId: 'workflow-1',
    draftRevision: 3,
    draftVersion: 4,
    sourcePlatform: '1688',
    sourceProductId: 'product-1',
    sourceCaptureSnapshotId: 'snapshot-1',
    supplyGoodsId: 'goods-1',
    skuKey: 'sku-1',
    slotKey: 'sku:sku-1:hero',
    assignmentMode: 'APPEND',
    assignmentOrdinal: 0,
    providerOrigin: 'https://relay.example',
    model: 'image-model-v1',
    operation: 'TEXT_TO_IMAGE',
    policyRevision: 'policy-7',
    ...overrides,
  };
}

function shopReadiness(overrides = {}) {
  return readiness({
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
    ...overrides,
  });
}

function request(overrides = {}) {
  return {
    profileId: 'relay-profile-1',
    prompt: 'A clean studio product photograph',
    negativePrompt: null,
    size: '1024x1024',
    idempotencyKey: 'generate-1',
    readinessBinding: readiness(),
    ...overrides,
  };
}

function capabilityEvidence(overrides = {}) {
  return {
    contractVersion: 'extension-byok-capability/v1',
    profileIdentity: 'https://relay.example/v1\u0000image-model-v1',
    operation: 'TEXT_TO_IMAGE',
    requestMode: 'json',
    policyRevision: 'policy-7',
    verifiedAt: '2026-07-25T11:55:00.000Z',
    expiresAt: '2026-07-25T12:05:00.000Z',
    ...overrides,
  };
}

function createPermissions(grantedOrigins = ['https://relay.example/*']) {
  const granted = new Set(grantedOrigins);
  return {
    async contains(input) {
      return input.origins.length === 1 && granted.has(input.origins[0]);
    },
    async request(input) {
      if (!input || input.origins.length !== 1) return false;
      granted.add(input.origins[0]);
      return true;
    },
    async remove(input) {
      return Boolean(input && input.origins.length === 1 && granted.delete(input.origins[0]));
    },
  };
}

function createStorage(initial = {}) {
  const values = new Map();
  for (const [key, value] of Object.entries(initial)) {
    values.set(key, JSON.parse(JSON.stringify(value)));
  }
  return {
    async get(keys) {
      const requested = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(requested
        .filter((key) => values.has(key))
        .map((key) => [key, JSON.parse(JSON.stringify(values.get(key)))]));
    },
    async set(input) {
      for (const [key, value] of Object.entries(input)) {
        values.set(key, JSON.parse(JSON.stringify(value)));
      }
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key);
    },
    value(key) {
      const value = values.get(key);
      return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    },
    seed(key, value) { values.set(key, JSON.parse(JSON.stringify(value))); },
  };
}

function loadPersistentClient({ localStorage, sessionStorage, fetchImpl, timeoutMs = 15 }) {
  const context = {
    AbortController, Array, ArrayBuffer, Blob, Boolean, Date, DOMException, Error, Event,
    JSON, Map, Math, Number, Object, Promise, Response, Set, String, TextDecoder, TextEncoder,
    TypeError, URL, URLSearchParams, Uint8Array, WeakMap, WeakSet, atob, btoa, clearTimeout,
    crypto: webcrypto, setTimeout,
  };
  context.globalThis = context;
  vm.runInNewContext(schemaSource, context, { filename: schemaPath });
  vm.runInNewContext(permissionSource, context, { filename: permissionPath });
  vm.runInNewContext(storeSource, context, { filename: storePath });
  vm.runInNewContext(clientSource, context, { filename: clientPath });
  sessionStorage.seed(
    context.SS_ERP_BYOK_PERMISSION_BROKER.SESSION_CONSENT_STORAGE_KEY,
    { 'https://relay.example': true },
  );
  const store = context.SS_ERP_BYOK_PROFILE_STORE.createStore({
    localStorage,
    sessionStorage,
    now: () => new Date('2026-07-25T12:00:00.000Z'),
  });
  const permissionBroker = context.SS_ERP_BYOK_PERMISSION_BROKER.createBroker({
    permissions: createPermissions(),
    sessionStorage,
  });
  return {
    schema: context.SS_ERP_BYOK_PROFILE_SCHEMA,
    store,
    client: context.SS_ERP_BYOK_TEXT_TO_IMAGE_CLIENT.createClient({
      profileStore: store,
      permissionBroker,
      fetchImpl,
      timeoutMs,
      crypto: webcrypto,
      now: () => new Date('2026-07-25T12:00:00.000Z'),
    }),
  };
}

function loadClient(options = {}) {
  class TestEvent {
    constructor(isTrusted) { this.isTrusted = isTrusted; }
  }
  TestEvent.prototype.composedPath = function composedPath() { return []; };
  const context = {
    AbortController,
    Array,
    ArrayBuffer,
    Blob,
    Boolean,
    Date,
    DOMException,
    Error,
    Event: TestEvent,
    JSON,
    Map,
    Math,
    Number,
    Object,
    Promise,
    Response,
    Set,
    String,
    TextDecoder,
    TextEncoder,
    TypeError,
    URL,
    Uint8Array,
    WeakMap,
    WeakSet,
    atob,
    btoa,
    clearTimeout,
    crypto: webcrypto,
    setTimeout,
  };
  context.globalThis = context;
  vm.runInNewContext(schemaSource, context, { filename: schemaPath });
  vm.runInNewContext(permissionSource, context, { filename: permissionPath });
  vm.runInNewContext(clientSource, context, { filename: clientPath });

  const selectedProfile = options.profile || profile();
  const storeCalls = [];
  let credentialRevision = options.credentialRevision || '1'.repeat(64);
  let currentApiKey = options.apiKey || 'sk-secret-sentinel';
  const profileStore = {
    async getProfile(id) {
      storeCalls.push({ method: 'getProfile', id });
      return id === selectedProfile.id ? selectedProfile : null;
    },
    async getCredentialSnapshotForBackground(id) {
      storeCalls.push({ method: 'getCredentialSnapshotForBackground', id });
      return id === selectedProfile.id ? {
        profile: selectedProfile,
        apiKey: currentApiKey,
        credentialRevision,
        evidence: options.evidence === undefined ? [capabilityEvidence({
          profileIdentity: `${selectedProfile.baseUrl.replace(/\/+$/u, '')}\u0000${selectedProfile.model}`,
        })] : options.evidence,
      } : null;
    },
    async assertCredentialRevisionForBackground(id, expectedProfileIdentity, expectedCredentialRevision) {
      storeCalls.push({
        method: 'assertCredentialRevisionForBackground',
        id,
        expectedProfileIdentity,
        expectedCredentialRevision,
      });
      const currentIdentity = `${selectedProfile.baseUrl.replace(/\/+$/u, '')}\u0000${selectedProfile.model}`;
      if (id !== selectedProfile.id || expectedProfileIdentity !== currentIdentity
        || expectedCredentialRevision !== credentialRevision) {
        const error = new Error('credential authority stale');
        error.code = 'SS_ERP_BYOK_CREDENTIAL_AUTHORITY_STALE';
        throw error;
      }
      return { current: true };
    },
    async commitWithCredentialRevisionForBackground(
      id,
      expectedProfileIdentity,
      expectedCredentialRevision,
      commit,
    ) {
      storeCalls.push({
        method: 'commitWithCredentialRevisionForBackground',
        id,
        expectedProfileIdentity,
        expectedCredentialRevision,
      });
      await this.assertCredentialRevisionForBackground(
        id,
        expectedProfileIdentity,
        expectedCredentialRevision,
      );
      return commit();
    },
    async beginProviderDispatch(id, value, expectedCredentialRevision) {
      storeCalls.push({ method: 'beginProviderDispatch', id, value, expectedCredentialRevision });
      if (options.dispatchPersistenceError) throw options.dispatchPersistenceError;
      return { started: true };
    },
    async setCapabilityEvidence(id, value, expectedCredentialRevision) {
      storeCalls.push({ method: 'setCapabilityEvidence', id, value, expectedCredentialRevision });
      if (expectedCredentialRevision !== credentialRevision) {
        const error = new Error('credential revision changed');
        error.code = 'SS_ERP_BYOK_CAPABILITY_EVIDENCE_INVALID';
        throw error;
      }
      return value;
    },
    async beginCapabilityProbe(id, value, expectedCredentialRevision) {
      storeCalls.push({ method: 'beginCapabilityProbe', id, value, expectedCredentialRevision });
      return { started: true };
    },
    async markCapabilityProbeUncertain(id, value, expectedCredentialRevision) {
      storeCalls.push({ method: 'markCapabilityProbeUncertain', id, value, expectedCredentialRevision });
      return { recorded: true };
    },
    async discardPendingCapabilityProbe(id, value, expectedCredentialRevision) {
      storeCalls.push({ method: 'discardPendingCapabilityProbe', id, value, expectedCredentialRevision });
      return { cleared: true };
    },
  };
  const permissionSessionStorage = options.permissionSessionStorage || createStorage();
  if (options.providerConsent !== false) {
    permissionSessionStorage.seed(
      context.SS_ERP_BYOK_PERMISSION_BROKER.SESSION_CONSENT_STORAGE_KEY,
      { 'https://relay.example': true },
    );
  }
  const permissionBroker = context.SS_ERP_BYOK_PERMISSION_BROKER.createBroker({
    permissions: options.permissions || createPermissions(),
    sessionStorage: permissionSessionStorage,
    readinessBridge: options.permissionReadinessBridge,
  });
  const client = context.SS_ERP_BYOK_TEXT_TO_IMAGE_CLIENT.createClient({
    profileStore,
    permissionBroker,
    fetchImpl: options.fetchImpl,
    authorizeResultOrigin: options.authorizeResultOrigin,
    timeoutMs: options.timeoutMs,
    crypto: webcrypto,
    now: options.now || (() => new Date('2026-07-25T12:00:00.000Z')),
  });
  return {
    api: context.SS_ERP_BYOK_TEXT_TO_IMAGE_CLIENT,
    client,
    permissionBroker,
    TestEvent,
    storeCalls,
    rotateCredential() {
      credentialRevision = '2'.repeat(64);
      currentApiKey = 'sk-rotated-secret-sentinel';
    },
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('sends one background-owned generations request and decodes bounded b64_json', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return jsonResponse({
      id: 'provider-request-1',
      data: [{ b64_json: Buffer.from(pngBytes).toString('base64') }],
    }, { headers: { 'x-request-id': 'header-request-ignored' } });
  };
  const { client } = loadClient({ fetchImpl });
  const result = await client.generate(request());

  assert.equal(result.outcome, 'SUCCEEDED');
  assert.equal(result.providerRequestIdSha256, sha256Text('provider-request-1'));
  assert.equal(JSON.stringify(result).includes('provider-request-1'), false);
  assert.equal(JSON.stringify(client.getOperationState('generate-1')).includes('provider-request-1'), false);
  assert.equal(result.image.source, 'b64_json');
  assert.equal(result.image.mimeType, 'image/png');
  assert.equal(result.image.byteLength, pngBytes.byteLength);
  assert.equal(result.image.blob instanceof Blob, true);
  assert.deepEqual(new Uint8Array(await result.image.blob.arrayBuffer()), pngBytes);
  assert.match(result.requestHash, /^[a-f0-9]{64}$/u);
  assert.match(result.promptHash, /^[a-f0-9]{64}$/u);
  assert.match(result.image.sha256, /^[a-f0-9]{64}$/u);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://relay.example/v1/images/generations');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[0].init.cache, 'no-store');
  assert.equal(calls[0].init.referrerPolicy, 'no-referrer');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-secret-sentinel');
  assert.equal(calls[0].init.headers['Idempotency-Key'], 'generate-1');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    model: 'image-model-v1',
    prompt: 'A clean studio product photograph',
    n: 1,
    size: '1024x1024',
  });

  const state = client.getOperationState('generate-1');
  assert.equal(state.outcome, 'SUCCEEDED');
  assert.equal(JSON.stringify(state).includes('sk-secret-sentinel'), false);
  assert.equal(JSON.stringify(state).includes(Buffer.from(pngBytes).toString('base64')), false);
  assert.equal(JSON.stringify(result).includes('1'.repeat(64)), false);
  assert.equal('blob' in state.image, false);
});

test('probe creates exact short-lived evidence and releases its test image without prior evidence', async () => {
  let fetchCalls = 0;
  const { client, storeCalls } = loadClient({
    evidence: [],
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse({
        id: 'provider-probe-1',
        data: [{ b64_json: Buffer.from(pngBytes).toString('base64') }],
      });
    },
  });
  const result = await client.probe(request({ idempotencyKey: 'probe-text-to-image-1' }));
  assert.equal(fetchCalls, 1);
  assert.deepEqual(plain(result.evidence), capabilityEvidence({
    verifiedAt: '2026-07-25T12:00:00.000Z',
    expiresAt: '2026-07-26T12:00:00.000Z',
  }));
  assert.equal(result.operation, 'TEXT_TO_IMAGE');
  assert.equal(result.requestMode, 'json');
  assert.equal(result.policyRevision, 'policy-7');
  assert.equal(storeCalls.filter((call) => call.method === 'setCapabilityEvidence').length, 1);
  assert.equal(
    storeCalls.find((call) => call.method === 'setCapabilityEvidence').expectedCredentialRevision,
    '1'.repeat(64),
  );
  assert.equal(client.getOperationState('probe-text-to-image-1').image.retained, false);
  assert.equal(JSON.stringify(result).includes('provider-probe-1'), false);
});

test('accepts shop-only readiness for capability probes but never for normal generation', async () => {
  let fetchCalls = 0;
  const { client } = loadClient({
    evidence: [],
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse({
        data: [{ b64_json: Buffer.from(pngBytes).toString('base64') }],
      });
    },
  });
  const probed = await client.probe(request({
    idempotencyKey: 'probe-shop-readiness-1',
    readinessBinding: shopReadiness(),
  }));
  assert.equal(probed.operation, 'TEXT_TO_IMAGE');
  assert.equal(fetchCalls, 1);
  await assert.rejects(
    client.generate(request({
      idempotencyKey: 'generate-shop-readiness-1',
      readinessBinding: shopReadiness(),
    })),
    (error) => error && error.code === 'SS_ERP_BYOK_PROVIDER_READINESS_INVALID',
  );
  assert.equal(fetchCalls, 1);
});

test('downloads an independently allowed URL without Provider Authorization or cookies', async () => {
  const calls = [];
  const signedUrl = 'https://cdn.example/generated/result.webp?signature=secret-url-sentinel';
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (calls.length === 1) {
      return jsonResponse({ id: 'provider-request-url', data: [{ url: signedUrl }] });
    }
    return new Response(webpBytes, { headers: { 'content-type': 'image/webp' } });
  };
  const loaded = loadClient({
    fetchImpl,
    permissions: createPermissions([
      'https://relay.example/*',
      'https://cdn.example/*',
    ]),
    authorizeResultOrigin: async (input) => (
      input.providerOrigin === 'https://relay.example'
      && input.resultOrigin === 'https://cdn.example'
      && input.policyRevision === 'policy-7'
    ),
    permissionReadinessBridge: {
      consume(_handle, _binding, expectedOrigin) {
        return { allowed: true, providerOrigin: expectedOrigin, policyRevision: 'policy-7' };
      },
    },
  });
  await loaded.permissionBroker.requestOriginPermission({
    endpoint: 'https://cdn.example',
    readinessHandle: 'cdn-result-readiness',
    readinessBinding: { providerOrigin: 'https://cdn.example' },
    trustedGesture: loaded.permissionBroker.createTrustedGestureToken(new loaded.TestEvent(true)),
  });
  const result = await loaded.client.generate(request());

  assert.equal(result.outcome, 'SUCCEEDED');
  assert.equal(result.image.source, 'url');
  assert.equal(result.image.resultOrigin, 'https://cdn.example');
  assert.match(result.image.resultUrlHash, /^[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(result).includes(signedUrl), false);
  assert.equal(
    JSON.stringify(loaded.client.getOperationState('generate-1')).includes('secret-url-sentinel'),
    false,
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, signedUrl);
  assert.equal(calls[1].init.method, 'GET');
  assert.equal(calls[1].init.credentials, 'omit');
  assert.equal(calls[1].init.redirect, 'error');
  assert.equal(calls[1].init.cache, 'no-store');
  assert.equal(calls[1].init.referrerPolicy, 'no-referrer');
  assert.deepEqual(plain(calls[1].init.headers), {
    Accept: 'image/png, image/jpeg, image/webp',
  });
  assert.equal(JSON.stringify(calls[1].init).includes('sk-secret-sentinel'), false);
});

test('rejects cross-origin result URLs without an independent policy decision and permission', async () => {
  for (const variant of ['policy', 'permission']) {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({
        id: 'accepted-before-result-policy',
        data: [{ url: 'https://cdn.example/result.png?sig=never-log-me' }],
      });
    };
    const { client } = loadClient({
      fetchImpl,
      permissions: createPermissions(variant === 'permission'
        ? ['https://relay.example/*']
        : ['https://relay.example/*', 'https://cdn.example/*']),
      authorizeResultOrigin: variant === 'policy' ? async () => false : async () => true,
    });
    await assert.rejects(
      client.generate(request({ idempotencyKey: 'cross-origin-' + variant })),
      (error) => error
        && error.code === 'SS_ERP_BYOK_PROVIDER_UNKNOWN_OUTCOME'
        && error.outcome === 'UNKNOWN_OUTCOME'
        && error.providerRequestIdSha256 === sha256Text('accepted-before-result-policy')
        && !String(error.message).includes('never-log-me'),
    );
    assert.equal(calls.length, 1);
  }
});

test('fails before reading the key or dispatch when readiness/profile/permission do not match', async () => {
  const fetchImpl = async () => { throw new Error('must not dispatch'); };
  const cases = [
    {
      input: request({ readinessBinding: readiness({ providerOrigin: 'https://other.example' }) }),
      permissions: createPermissions(),
      code: 'SS_ERP_BYOK_PROVIDER_READINESS_MISMATCH',
    },
    {
      input: request({ readinessBinding: readiness({ model: 'other-model' }) }),
      permissions: createPermissions(),
      code: 'SS_ERP_BYOK_PROVIDER_READINESS_MISMATCH',
    },
    {
      input: request(),
      permissions: createPermissions([]),
      code: 'SS_ERP_BYOK_PROVIDER_PERMISSION_REQUIRED',
    },
    {
      input: request({
        readinessBinding: readiness({ providerOrigin: 'https://provider.internal' }),
      }),
      profile: profile({ baseUrl: 'https://provider.internal/v1' }),
      permissions: createPermissions([]),
      code: 'SS_ERP_BYOK_PROVIDER_PROFILE_INVALID',
    },
  ];
  for (const item of cases) {
    const { client, storeCalls } = loadClient({
      fetchImpl,
      permissions: item.permissions,
      profile: item.profile,
    });
    await assert.rejects(
      client.generate(item.input),
      (error) => error && error.code === item.code && error.outcome === 'FAILED_RETRYABLE',
    );
    assert.equal(
      storeCalls.some((call) => call.method === 'getCredentialSnapshotForBackground'),
      false,
    );
  }
});

test('requires trusted session consent even when mandatory host access already exists', async () => {
  const grantedOrigins = new Set(['https://relay.example/*']);
  const permissions = {
    async contains(input) { return grantedOrigins.has(input.origins[0]); },
    async request(input) { grantedOrigins.add(input.origins[0]); return true; },
    async remove() { return false; },
  };
  const permissionSessionStorage = createStorage();
  let fetchCalls = 0;
  const fetchImpl = async () => {
    fetchCalls += 1;
    return jsonResponse({ data: [{ b64_json: Buffer.from(pngBytes).toString('base64') }] });
  };
  const readinessBridge = {
    consume() {
      return { allowed: true, providerOrigin: 'https://relay.example', policyRevision: 7 };
    },
  };
  const first = loadClient({
    fetchImpl,
    permissions,
    permissionSessionStorage,
    permissionReadinessBridge: readinessBridge,
    providerConsent: false,
  });
  await assert.rejects(
    first.client.generate(request({ idempotencyKey: 'mandatory-consent-before' })),
    (error) => error && error.code === 'SS_ERP_BYOK_PROVIDER_PERMISSION_REQUIRED',
  );
  assert.equal(fetchCalls, 0);

  await first.permissionBroker.requestOriginPermission({
    endpoint: 'https://relay.example/v1',
    readinessHandle: 'readiness-token',
    readinessBinding: { providerOrigin: 'https://relay.example' },
    trustedGesture: first.permissionBroker.createTrustedGestureToken(new first.TestEvent(true)),
  });
  await first.client.generate(request({ idempotencyKey: 'mandatory-consent-after' }));
  assert.equal(fetchCalls, 1);
  assert.equal(
    (await first.permissionBroker.removeOriginPermission('https://relay.example/v1')).removed,
    true,
  );

  const restarted = loadClient({
    fetchImpl,
    permissions,
    permissionSessionStorage,
    permissionReadinessBridge: readinessBridge,
    providerConsent: false,
  });
  await assert.rejects(
    restarted.client.generate(request({ idempotencyKey: 'mandatory-consent-revoked' })),
    (error) => error && error.code === 'SS_ERP_BYOK_PROVIDER_PERMISSION_REQUIRED',
  );
  assert.equal(fetchCalls, 1);
});

test('requires current exact text-to-image/json evidence from the atomic credential snapshot', async () => {
  let fetchCalls = 0;
  for (const evidence of [
    [],
    [capabilityEvidence({ policyRevision: 'old-policy' })],
    [capabilityEvidence({ operation: 'FULL_EDIT', requestMode: 'multipart' })],
    [capabilityEvidence({ requestMode: 'multipart' })],
    [capabilityEvidence({ expiresAt: '2026-07-25T12:00:00.000Z' })],
  ]) {
    const { client, storeCalls } = loadClient({
      evidence,
      fetchImpl: async () => {
        fetchCalls += 1;
        throw new Error('capability rejection must happen before fetch');
      },
    });
    await assert.rejects(
      client.generate(request({ idempotencyKey: `evidence-${fetchCalls}-${evidence.length}` })),
      (error) => error
        && error.code === 'SS_ERP_BYOK_PROVIDER_CAPABILITY_REQUIRED'
        && error.outcome === 'FAILED_RETRYABLE',
    );
    assert.equal(
      storeCalls.some((call) => call.method === 'getCredentialSnapshotForBackground'),
      true,
    );
  }
  assert.equal(fetchCalls, 0);
});

test('does not commit probe evidence when the session key rotates during Provider execution', async () => {
  let release;
  const loaded = loadClient({
    evidence: [],
    fetchImpl: async () => new Promise((resolve) => { release = resolve; }),
  });
  const pending = loaded.client.probe(request({ idempotencyKey: 'probe-key-rotation-1' }));
  while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
  loaded.rotateCredential();
  release(jsonResponse({ data: [{ b64_json: Buffer.from(pngBytes).toString('base64') }] }));
  await assert.rejects(
    pending,
    (error) => error
      && error.code === 'SS_ERP_BYOK_PROVIDER_RESULT_AUTHORITY_STALE'
      && error.outcome === 'FAILED_FINAL'
      && error.automaticRetryAllowed === false,
  );
  assert.equal(
    loaded.storeCalls.some((call) => call.method === 'setCapabilityEvidence'),
    false,
  );
  assert.equal(loaded.client.getOperationState('probe-key-rotation-1').image, null);
});

test('discards a completed normal result when the key rotates before post-response validation', async () => {
  let release;
  const loaded = loadClient({
    fetchImpl: async () => new Promise((resolve) => { release = resolve; }),
  });
  const pending = loaded.client.generate(request({ idempotencyKey: 'generate-key-rotation-1' }));
  while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
  loaded.rotateCredential();
  release(jsonResponse({ data: [{ b64_json: Buffer.from(pngBytes).toString('base64') }] }));
  await assert.rejects(
    pending,
    (error) => error
      && error.code === 'SS_ERP_BYOK_PROVIDER_RESULT_AUTHORITY_STALE'
      && error.outcome === 'FAILED_FINAL'
      && error.automaticRetryAllowed === false,
  );
  assert.equal(
    loaded.storeCalls.some((call) => call.method === 'commitWithCredentialRevisionForBackground'),
    false,
  );
});

test('discards a completed result and probe evidence when Provider consent is revoked in flight', async () => {
  for (const capabilityProbe of [false, true]) {
    let release;
    const loaded = loadClient({
      evidence: capabilityProbe ? [] : undefined,
      fetchImpl: async () => new Promise((resolve) => { release = resolve; }),
    });
    const input = request({
      idempotencyKey: capabilityProbe ? 'probe-permission-revoked-1' : 'generate-permission-revoked-1',
    });
    const pending = capabilityProbe ? loaded.client.probe(input) : loaded.client.generate(input);
    while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
    await loaded.permissionBroker.removeOriginPermission('https://relay.example/v1');
    release(jsonResponse({ data: [{ b64_json: Buffer.from(pngBytes).toString('base64') }] }));
    await assert.rejects(
      pending,
      (error) => error
        && error.code === 'SS_ERP_BYOK_PROVIDER_RESULT_AUTHORITY_STALE'
        && error.outcome === 'FAILED_FINAL'
        && error.automaticRetryAllowed === false,
    );
    assert.equal(
      loaded.storeCalls.some((call) => call.method === 'setCapabilityEvidence'),
      false,
    );
  }
});

test('revalidates private credential and consent authority immediately before vault commit', async () => {
  for (const mutation of ['credential', 'permission']) {
    const loaded = loadClient({
      fetchImpl: async () => jsonResponse({
        data: [{ b64_json: Buffer.from(pngBytes).toString('base64') }],
      }),
    });
    const input = request({ idempotencyKey: 'commit-authority-' + mutation });
    const generated = await loaded.client.generate(input);
    assert.equal(JSON.stringify(generated).includes('credentialRevision'), false);
    assert.equal(
      JSON.stringify(loaded.client.getOperationState(input.idempotencyKey)).includes('credentialRevision'),
      false,
    );
    if (mutation === 'credential') loaded.rotateCredential();
    else await loaded.permissionBroker.removeOriginPermission('https://relay.example/v1');
    let vaultCommits = 0;
    await assert.rejects(
      loaded.client.commitResult(generated.idempotencyKey, generated.requestHash, () => {
        vaultCommits += 1;
        return { stored: true };
      }),
      (error) => error
        && error.code === 'SS_ERP_BYOK_PROVIDER_RESULT_AUTHORITY_STALE'
        && error.outcome === 'FAILED_FINAL'
        && error.automaticRetryAllowed === false,
    );
    assert.equal(vaultCommits, 0);
  }
});

test('classifies a dispatched timeout as unknown and never blindly posts it again', async () => {
  let callCount = 0;
  const fetchImpl = async () => {
    callCount += 1;
    return new Promise(() => {});
  };
  const { client } = loadClient({ fetchImpl, timeoutMs: 15 });
  const input = request({ idempotencyKey: 'timeout-1' });
  await assert.rejects(
    client.generate(input),
    (error) => error
      && error.code === 'SS_ERP_BYOK_PROVIDER_UNKNOWN_OUTCOME'
      && error.outcome === 'UNKNOWN_OUTCOME'
      && error.automaticRetryAllowed === false,
  );
  await assert.rejects(
    client.generate(input),
    (error) => error
      && error.code === 'SS_ERP_BYOK_PROVIDER_UNKNOWN_OUTCOME'
      && error.replayed === true,
  );
  assert.equal(callCount, 1);
  assert.equal(client.getOperationState('timeout-1').outcome, 'UNKNOWN_OUTCOME');
  assert.equal(client.getOperationState('timeout-1').automaticRetryAllowed, false);
});

test('persists normal-generation dispatch before POST and blocks restart replay or hash conflict', async () => {
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  const providerRequestId = 'provider-request-restart-secret-sentinel';
  let postCount = 0;
  const fetchImpl = async () => {
    postCount += 1;
    return jsonResponse({
      id: providerRequestId,
      data: [{ b64_json: Buffer.from(pngBytes).toString('base64') }],
    });
  };
  const first = loadPersistentClient({ localStorage, sessionStorage, fetchImpl });
  await first.store.saveProfile(profile());
  await first.store.setApiKey('relay-profile-1', 'sk-normal-dispatch-session-sentinel');
  const snapshot = await first.store.getCredentialSnapshotForBackground('relay-profile-1');
  await first.store.setCapabilityEvidence(
    'relay-profile-1',
    capabilityEvidence(),
    snapshot.credentialRevision,
  );
  const input = request({ idempotencyKey: 'normal-worker-restart-1' });
  const generated = await first.client.generate(input);
  first.client.releaseResult(generated.idempotencyKey, generated.requestHash);
  assert.equal(postCount, 1);
  const tombstones = sessionStorage.value(first.schema.SESSION_PROVIDER_DISPATCHES_STORAGE_KEY);
  assert.ok(tombstones);
  assert.equal(JSON.stringify(tombstones).includes(providerRequestId), false);
  assert.equal(JSON.stringify(tombstones).includes('sk-normal-dispatch-session-sentinel'), false);

  const restarted = loadPersistentClient({ localStorage, sessionStorage, fetchImpl });
  await assert.rejects(
    restarted.client.generate(input),
    (error) => error
      && error.code === 'SS_ERP_BYOK_PROVIDER_UNKNOWN_OUTCOME'
      && error.outcome === 'UNKNOWN_OUTCOME'
      && error.automaticRetryAllowed === false
      && error.replayed === true,
  );
  await assert.rejects(
    restarted.client.generate({ ...input, prompt: 'A conflicting prompt' }),
    (error) => error
      && error.code === 'SS_ERP_BYOK_PROVIDER_IDEMPOTENCY_CONFLICT'
      && error.outcome === 'FAILED_FINAL',
  );
  assert.equal(postCount, 1);
});

test('fails retryably without network when the pre-dispatch tombstone cannot persist', async () => {
  let postCount = 0;
  const persistenceError = new Error('session storage write failed');
  const { client } = loadClient({
    dispatchPersistenceError: persistenceError,
    fetchImpl: async () => {
      postCount += 1;
      throw new Error('must not dispatch');
    },
  });
  await assert.rejects(
    client.generate(request({ idempotencyKey: 'dispatch-persistence-failed-1' })),
    (error) => error
      && error.code === 'SS_ERP_BYOK_PROVIDER_DISPATCH_GUARD_UNAVAILABLE'
      && error.outcome === 'FAILED_RETRYABLE',
  );
  assert.equal(postCount, 0);
});

test('fails malformed persisted normal-dispatch state closed before Provider network I/O', async () => {
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  let postCount = 0;
  const loaded = loadPersistentClient({
    localStorage,
    sessionStorage,
    fetchImpl: async () => {
      postCount += 1;
      throw new Error('must not dispatch');
    },
  });
  await loaded.store.saveProfile(profile());
  await loaded.store.setApiKey('relay-profile-1', 'sk-corrupt-client-guard-sentinel');
  const snapshot = await loaded.store.getCredentialSnapshotForBackground('relay-profile-1');
  await loaded.store.setCapabilityEvidence(
    'relay-profile-1',
    capabilityEvidence(),
    snapshot.credentialRevision,
  );
  sessionStorage.seed(loaded.schema.SESSION_PROVIDER_DISPATCHES_STORAGE_KEY, {
    'relay-profile-1': [{ malformed: true }],
  });
  await assert.rejects(
    loaded.client.generate(request({ idempotencyKey: 'malformed-dispatch-state-1' })),
    (error) => error
      && error.code === 'SS_ERP_BYOK_PROVIDER_UNKNOWN_OUTCOME'
      && error.outcome === 'UNKNOWN_OUTCOME'
      && error.automaticRetryAllowed === false,
  );
  assert.equal(postCount, 0);
});

test('persists an uncertain probe across MV3 client/store recreation and blocks a new probe id', async () => {
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  let postCount = 0;
  const first = loadPersistentClient({
    localStorage,
    sessionStorage,
    fetchImpl: async () => {
      postCount += 1;
      return new Promise(() => {});
    },
  });
  await first.store.saveProfile(profile());
  await first.store.setApiKey('relay-profile-1', 'sk-persistent-unknown-sentinel');
  await assert.rejects(
    first.client.probe(request({ idempotencyKey: 'probe-worker-1' })),
    (error) => error
      && error.code === 'SS_ERP_BYOK_PROVIDER_UNKNOWN_OUTCOME'
      && error.outcome === 'UNKNOWN_OUTCOME',
  );
  assert.equal(postCount, 1);
  assert.ok(sessionStorage.value(first.schema.SESSION_UNCERTAIN_PROBES_STORAGE_KEY));

  const restarted = loadPersistentClient({
    localStorage,
    sessionStorage,
    fetchImpl: async () => {
      postCount += 1;
      throw new Error('persistent guard must block before fetch');
    },
  });
  await assert.rejects(
    restarted.client.probe(request({ idempotencyKey: 'probe-worker-2' })),
    (error) => error
      && error.code === 'SS_ERP_BYOK_PROVIDER_UNKNOWN_OUTCOME'
      && error.outcome === 'UNKNOWN_OUTCOME'
      && error.automaticRetryAllowed === false,
  );
  assert.equal(postCount, 1, 'a new worker and idempotency key must not issue a second POST');
});

test('replays durable capability evidence after a successful probe response channel is lost', async () => {
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  let postCount = 0;
  const fetchImpl = async () => {
    postCount += 1;
    return jsonResponse({ data: [{ b64_json: Buffer.from(pngBytes).toString('base64') }] });
  };
  const first = loadPersistentClient({ localStorage, sessionStorage, fetchImpl });
  await first.store.saveProfile(profile());
  await first.store.setApiKey('relay-profile-1', 'sk-channel-loss-sentinel');
  await first.client.probe(request({ idempotencyKey: 'probe-channel-loss-1' }));
  assert.equal(postCount, 1);
  assert.equal(
    sessionStorage.value(first.schema.SESSION_UNCERTAIN_PROBES_STORAGE_KEY),
    undefined,
    'evidence and PENDING guard must commit atomically before the runtime response',
  );

  const restarted = loadPersistentClient({ localStorage, sessionStorage, fetchImpl });
  const replayed = await restarted.client.probe(request({ idempotencyKey: 'probe-channel-loss-2' }));
  assert.equal(postCount, 1, 'durable evidence must prevent another paid Provider POST');
  assert.equal(replayed.evidence.operation, 'TEXT_TO_IMAGE');
  assert.equal(replayed.evidence.policyRevision, 'policy-7');
});

test('applies the same deadline while streaming the Provider response body', async () => {
  let callCount = 0;
  const hangingBody = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"data":['));
      // Deliberately leave the stream open after the first bounded chunk.
    },
  });
  const { client } = loadClient({
    timeoutMs: 15,
    fetchImpl: async () => {
      callCount += 1;
      return new Response(hangingBody, { headers: { 'content-type': 'application/json' } });
    },
  });
  const input = request({ idempotencyKey: 'stream-timeout-1' });
  await assert.rejects(
    client.generate(input),
    (error) => error
      && error.code === 'SS_ERP_BYOK_PROVIDER_UNKNOWN_OUTCOME'
      && error.causeCode === 'SS_ERP_BYOK_PROVIDER_FETCH_TIMEOUT',
  );
  await assert.rejects(client.generate(input), (error) => error && error.replayed === true);
  assert.equal(callCount, 1);
});

test('deduplicates concurrent identical work and rejects an idempotency conflict', async () => {
  let release;
  let callCount = 0;
  const fetchImpl = async () => {
    callCount += 1;
    return new Promise((resolve) => { release = resolve; });
  };
  const { client } = loadClient({ fetchImpl, timeoutMs: 1000 });
  const first = client.generate(request({ idempotencyKey: 'same-key' }));
  const duplicate = client.generate(request({ idempotencyKey: 'same-key' }));
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(callCount, 1);
  await assert.rejects(
    client.generate(request({ idempotencyKey: 'same-key', prompt: 'A different request' })),
    (error) => error && error.code === 'SS_ERP_BYOK_PROVIDER_IDEMPOTENCY_CONFLICT',
  );
  release(jsonResponse({ data: [{ b64_json: Buffer.from(pngBytes).toString('base64') }] }));
  const [firstResult, duplicateResult] = await Promise.all([first, duplicate]);
  assert.equal(firstResult.image.sha256, duplicateResult.image.sha256);
  assert.equal(callCount, 1);
});

test('keeps the initial BYOK runtime at one active Provider request', async () => {
  let release;
  let callCount = 0;
  const { api, client } = loadClient({
    timeoutMs: 1000,
    fetchImpl: async () => {
      callCount += 1;
      return new Promise((resolve) => { release = resolve; });
    },
  });
  assert.equal(api.LIMITS.maxConcurrency, 1);
  const first = client.generate(request({ idempotencyKey: 'concurrency-1' }));
  await new Promise((resolve) => setTimeout(resolve, 25));
  await assert.rejects(
    client.generate(request({ idempotencyKey: 'concurrency-2' })),
    (error) => error
      && error.code === 'SS_ERP_BYOK_PROVIDER_CONCURRENCY_LIMIT'
      && error.outcome === 'FAILED_RETRYABLE',
  );
  assert.equal(callCount, 1);
  release(jsonResponse({ data: [{ b64_json: Buffer.from(pngBytes).toString('base64') }] }));
  await first;
});

test('bounds JSON, base64, and downloaded image bodies and keeps accepted failures unknown', async () => {
  let emittedJsonChunks = 0;
  const chunkedJsonBomb = new Response(new ReadableStream({
    pull(controller) {
      if (emittedJsonChunks >= 33) {
        controller.close();
        return;
      }
      emittedJsonChunks += 1;
      controller.enqueue(new Uint8Array(1024 * 1024));
    },
  }), { headers: { 'content-type': 'application/json' } });
  const oversizedJson = new Response('{"data":[]}', {
    headers: {
      'content-type': 'application/json',
      'content-length': String(33 * 1024 * 1024),
    },
  });
  const oversizedDownload = new Response(pngBytes, {
    headers: {
      'content-type': 'image/png',
      'content-length': String(21 * 1024 * 1024),
    },
  });
  const cases = [
    {
      name: 'json',
      responses: [oversizedJson],
    },
    {
      name: 'chunked-json',
      responses: [chunkedJsonBomb],
    },
    {
      name: 'base64',
      responses: [jsonResponse({
        id: 'accepted-large-b64',
        data: [{ b64_json: 'A'.repeat((20 * 1024 * 1024 * 4 / 3) + 16) }],
      })],
    },
    {
      name: 'download',
      responses: [
        jsonResponse({ id: 'accepted-large-url', data: [{ url: 'https://relay.example/large.png' }] }),
        oversizedDownload,
      ],
    },
  ];

  for (const item of cases) {
    const queue = item.responses.slice();
    let calls = 0;
    const { client } = loadClient({
      fetchImpl: async () => {
        calls += 1;
        return queue.shift();
      },
    });
    await assert.rejects(
      client.generate(request({ idempotencyKey: 'oversized-' + item.name })),
      (error) => error
        && error.code === 'SS_ERP_BYOK_PROVIDER_UNKNOWN_OUTCOME'
        && error.outcome === 'UNKNOWN_OUTCOME',
    );
    assert.equal(calls, item.responses.length);
  }
});

test('rejects malformed image bytes and MIME mismatch without exposing Provider bodies', async () => {
  const cases = [
    jsonResponse({
      id: 'bad-base64-image',
      data: [{ b64_json: Buffer.from('not-an-image').toString('base64') }],
    }),
    [
      jsonResponse({ id: 'bad-url-image', data: [{ url: 'https://relay.example/result.png' }] }),
      new Response(webpBytes, { headers: { 'content-type': 'image/png' } }),
    ],
  ];
  for (let index = 0; index < cases.length; index += 1) {
    const queue = Array.isArray(cases[index]) ? cases[index].slice() : [cases[index]];
    const { client } = loadClient({ fetchImpl: async () => queue.shift() });
    await assert.rejects(
      client.generate(request({ idempotencyKey: 'malformed-' + index })),
      (error) => error
        && error.code === 'SS_ERP_BYOK_PROVIDER_UNKNOWN_OUTCOME'
        && !String(error.message).includes('not-an-image'),
    );
  }
});

test('maps bounded HTTP failures without reading or echoing a hostile response body', async () => {
  for (const status of [400, 429, 503]) {
    let calls = 0;
    const secretBody = 'sk-hostile-provider-response-secret';
    const { client } = loadClient({
      fetchImpl: async () => {
        calls += 1;
        return new Response(secretBody.repeat(1000), { status });
      },
    });
    const input = request({ idempotencyKey: 'http-' + status });
    await assert.rejects(
      client.generate(input),
      (error) => error
        && error.code === 'SS_ERP_BYOK_PROVIDER_HTTP_FAILED'
        && error.status === status
        && error.outcome === (status === 400 ? 'FAILED_FINAL' : 'FAILED_RETRYABLE')
        && !String(error.message).includes(secretBody),
    );
    await assert.rejects(client.generate(input), (error) => error && error.replayed === true);
    assert.equal(calls, 1);
  }
});

test('releases retained Blob bytes but keeps a no-resubmit idempotency tombstone', async () => {
  let calls = 0;
  const { client } = loadClient({
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({ data: [{ b64_json: Buffer.from(pngBytes).toString('base64') }] });
    },
  });
  const input = request({ idempotencyKey: 'release-1' });
  const result = await client.generate(input);
  assert.equal(result.providerRequestIdSha256, null);
  assert.equal(result.image.blob.size, pngBytes.byteLength);
  assert.deepEqual(plain(client.releaseResult('release-1', result.requestHash)), {
    released: true,
    outcome: 'SUCCEEDED',
  });
  assert.equal(client.getOperationState('release-1').image.retained, false);
  await assert.rejects(
    client.generate(input),
    (error) => error && error.code === 'SS_ERP_BYOK_PROVIDER_RESULT_RELEASED' && error.replayed === true,
  );
  assert.equal(calls, 1);
});

console.log('PASS extension BYOK text-to-image background client contract');
