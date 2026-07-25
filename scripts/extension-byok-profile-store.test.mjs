import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const schemaPath = 'extensions/ss-erp/shared/byok/profile-schema.js';
const storePath = 'extensions/ss-erp/shared/byok/profile-store.js';
const schemaSource = fs.readFileSync(schemaPath, 'utf8');
const storeSource = fs.readFileSync(storePath, 'utf8');

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createStorage() {
  const values = new Map();
  const calls = [];
  return {
    calls,
    async get(keys) {
      calls.push({ method: 'get', keys: clone(keys) });
      const requested = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(
        requested.filter((key) => values.has(key)).map((key) => [key, clone(values.get(key))]),
      );
    },
    async set(input) {
      calls.push({ method: 'set', input: clone(input) });
      for (const [key, value] of Object.entries(input)) values.set(key, clone(value));
    },
    async remove(keys) {
      calls.push({ method: 'remove', keys: clone(keys) });
      for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key);
    },
    value(key) { return clone(values.get(key)); },
  };
}

function loadApi({ localStorage = createStorage(), sessionStorage = createStorage(), now } = {}) {
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
    TextEncoder,
    TypeError,
    URL,
    URLSearchParams,
    crypto: webcrypto,
    now,
  };
  context.globalThis = context;
  vm.runInNewContext(schemaSource, context, { filename: schemaPath });
  vm.runInNewContext(storeSource, context, { filename: storePath });
  return {
    schema: context.SS_ERP_BYOK_PROFILE_SCHEMA,
    store: context.SS_ERP_BYOK_PROFILE_STORE.createStore({
      localStorage,
      sessionStorage,
      now: now || (() => new Date('2026-07-25T12:00:00.000Z')),
    }),
    localStorage,
    sessionStorage,
  };
}

function profile(overrides = {}) {
  return {
    id: 'relay-profile-1',
    name: 'Relay images',
    baseUrl: 'https://relay.example/v1/',
    model: 'image-model-v1',
    allowedOperations: ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE'],
    preferences: {
      defaultSize: '1024x1024',
      quality: 'auto',
      outputFormat: 'png',
    },
    ...overrides,
  };
}

function evidence(overrides = {}) {
  return {
    contractVersion: 'extension-byok-capability/v1',
    profileIdentity: 'https://relay.example/v1\u0000image-model-v1',
    operation: 'TEXT_TO_IMAGE',
    requestMode: 'json',
    policyRevision: 'policy-revision-1',
    verifiedAt: '2026-07-25T11:00:00.000Z',
    expiresAt: '2026-07-25T13:00:00.000Z',
    ...overrides,
  };
}

test('canonicalizes only public HTTPS Provider endpoints and rejects secret/SSRF shapes', () => {
  const { schema } = loadApi();
  assert.equal(schema.canonicalizeEndpoint('https://relay.example/v1/'), 'https://relay.example/v1');
  assert.equal(schema.canonicalizeEndpoint('https://relay.example'), 'https://relay.example');
  for (const value of [
    'http://relay.example/v1',
    'https://user:pass@relay.example/v1',
    'https://relay.example/v1?token=secret',
    'https://relay.example/v1#fragment',
    'https://localhost/v1',
    'https://127.0.0.1/v1',
    'https://10.0.0.1/v1',
    'https://169.254.169.254/latest',
    'https://[::1]/v1',
    'https://[::ffff:127.0.0.1]/v1',
    'https://[::a9fe:a9fe]/v1',
    'https://[::c0a8:101]/v1',
    'https://[::ac10:1]/v1',
    'https://[::6440:1]/v1',
    'https://[::7f00:1]/v1',
    'https://[2606:4700:4700::1111]/v1',
    'https://[fc00::1]/v1',
    'https://[fe80::1]/v1',
    'https://[2001:db8::1]/v1',
    'https://relay.example./v1',
    'https://provider.internal/v1',
    'https://provider.local/v1',
    'https://provider.home.arpa/v1',
    'https://provider/v1',
    'https://relay..example/v1',
  ]) {
    assert.throws(
      () => schema.canonicalizeEndpoint(value),
      (error) => error && error.code === 'SS_ERP_BYOK_PROFILE_ENDPOINT_INVALID',
    );
  }
  assert.throws(
    () => schema.normalizeProfile({ ...profile(), apiKey: 'secret-sentinel' }),
    (error) => error && error.code === 'SS_ERP_BYOK_PROFILE_SECRET_FIELD',
  );
  for (const key of ['constructor', 'toString', '__proto__']) {
    const candidate = profile();
    Object.defineProperty(candidate, key, { value: 'forbidden', enumerable: true });
    assert.throws(
      () => schema.normalizeProfile(candidate),
      (error) => error && error.code === 'SS_ERP_BYOK_PROFILE_INVALID',
    );
  }
});

test('persists only non-secret profile metadata and keeps the API key in session storage', async () => {
  const api = loadApi();
  const saved = await api.store.saveProfile(profile());
  assert.deepEqual(saved.profile, {
    id: 'relay-profile-1',
    name: 'Relay images',
    baseUrl: 'https://relay.example/v1',
    model: 'image-model-v1',
    allowedOperations: ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE'],
    preferences: { defaultSize: '1024x1024', quality: 'auto', outputFormat: 'png' },
  });
  await api.store.setApiKey('relay-profile-1', 'sk-session-secret-sentinel');
  const publicState = await api.store.getPublicState('relay-profile-1');
  assert.equal(publicState.hasKey, true);
  assert.equal('apiKey' in publicState, false);
  assert.equal(JSON.stringify(publicState).includes('sk-session-secret-sentinel'), false);
  assert.equal(await api.store.readSecretForBackground('relay-profile-1'), 'sk-session-secret-sentinel');
  assert.equal(api.localStorage.value(api.schema.PROFILES_STORAGE_KEY).some((row) => (
    JSON.stringify(row).includes('sk-session-secret-sentinel')
  )), false);
  assert.equal(JSON.stringify(api.localStorage.calls).includes('sk-session-secret-sentinel'), false);
  assert.equal(JSON.stringify(api.sessionStorage.value(api.schema.SESSION_SECRETS_STORAGE_KEY))
    .includes('sk-session-secret-sentinel'), true);
});

test('invalidates the key and capability evidence on endpoint/model rebinding but not preference edits', async () => {
  const api = loadApi();
  await api.store.saveProfile(profile());
  await api.store.setApiKey('relay-profile-1', 'sk-session-secret-sentinel');
  await api.store.setCapabilityEvidence('relay-profile-1', evidence());
  await api.store.saveProfile(profile({ preferences: { defaultSize: '1536x1024', quality: 'high', outputFormat: 'webp' } }));
  assert.equal((await api.store.getPublicState('relay-profile-1')).hasKey, true);
  assert.equal((await api.store.getPublicState('relay-profile-1')).evidence.length, 1);

  await api.store.saveProfile(profile({ baseUrl: 'https://another-relay.example/v1/' }));
  assert.equal(await api.store.readSecretForBackground('relay-profile-1'), null);
  assert.deepEqual((await api.store.getPublicState('relay-profile-1')).evidence, []);

  await api.store.setApiKey('relay-profile-1', 'sk-session-secret-sentinel-2');
  await api.store.setCapabilityEvidence('relay-profile-1', evidence({
    profileIdentity: 'https://another-relay.example/v1\u0000image-model-v1',
  }));
  await api.store.saveProfile(profile({
    baseUrl: 'https://another-relay.example/v1/',
    model: 'another-model-v2',
  }));
  assert.equal(await api.store.readSecretForBackground('relay-profile-1'), null);
  assert.deepEqual((await api.store.getPublicState('relay-profile-1')).evidence, []);
});

test('stores only exact, non-expired capability evidence bound to current profile identity', async () => {
  const api = loadApi();
  await api.store.saveProfile(profile());
  await api.store.setApiKey('relay-profile-1', 'sk-session-secret-sentinel');
  await assert.rejects(
    api.store.setCapabilityEvidence('relay-profile-1', evidence({ profileIdentity: 'wrong' })),
    (error) => error && error.code === 'SS_ERP_BYOK_CAPABILITY_EVIDENCE_INVALID',
  );
  await assert.rejects(
    api.store.setCapabilityEvidence('relay-profile-1', evidence({ expiresAt: '2026-07-25T11:00:00.000Z' })),
    (error) => error && error.code === 'SS_ERP_BYOK_CAPABILITY_EVIDENCE_INVALID',
  );
  await assert.rejects(
    api.store.setCapabilityEvidence('relay-profile-1', evidence({
      verifiedAt: '2026-07-25T13:00:00.000Z',
      expiresAt: '2026-07-25T14:00:00.000Z',
    })),
    (error) => error && error.code === 'SS_ERP_BYOK_CAPABILITY_EVIDENCE_INVALID',
  );
  await assert.rejects(
    api.store.setCapabilityEvidence('relay-profile-1', evidence({
      expiresAt: '2026-08-03T12:00:00.000Z',
    })),
    (error) => error && error.code === 'SS_ERP_BYOK_CAPABILITY_EVIDENCE_INVALID',
  );
  await api.store.setCapabilityEvidence('relay-profile-1', evidence());
  const state = await api.store.getPublicState('relay-profile-1');
  assert.deepEqual(state.evidence, [evidence()]);
  assert.equal(JSON.stringify(state).includes('sk-'), false);
});

test('does not accept capability evidence without a matching session key', async () => {
  const api = loadApi();
  await api.store.saveProfile(profile());
  await assert.rejects(
    api.store.setCapabilityEvidence('relay-profile-1', evidence()),
    (error) => error && error.code === 'SS_ERP_BYOK_CAPABILITY_EVIDENCE_INVALID',
  );
});

test('device disconnect/session clear removes every secret and evidence entry', async () => {
  const api = loadApi();
  await api.store.saveProfile(profile());
  await api.store.setApiKey('relay-profile-1', 'sk-session-secret-sentinel');
  await api.store.setCapabilityEvidence('relay-profile-1', evidence());
  await api.store.disconnectDevice();
  assert.equal(api.sessionStorage.value(api.schema.SESSION_SECRETS_STORAGE_KEY), undefined);
  assert.equal(api.sessionStorage.value(api.schema.SESSION_EVIDENCE_STORAGE_KEY), undefined);
  assert.equal(await api.store.readSecretForBackground('relay-profile-1'), null);
  assert.deepEqual((await api.store.getPublicState('relay-profile-1')).evidence, []);
  assert.equal(api.localStorage.value(api.schema.PROFILES_STORAGE_KEY).length, 1);
});

test('fails closed when session storage is unavailable and rejects open profile fields', async () => {
  const api = loadApi({ sessionStorage: null });
  await assert.rejects(
    api.store.setApiKey('relay-profile-1', 'sk-secret'),
    (error) => error && error.code === 'SS_ERP_BYOK_SESSION_STORAGE_UNAVAILABLE',
  );
  const normal = loadApi();
  await assert.rejects(
    normal.store.saveProfile(profile({ preferences: { arbitrary: true } })),
    (error) => error && error.code === 'SS_ERP_BYOK_PROFILE_INVALID',
  );
});

test('refuses endpoint rebinding before metadata changes when session cleanup cannot be confirmed', async () => {
  const api = loadApi();
  await api.store.saveProfile(profile());
  await api.store.setApiKey('relay-profile-1', 'sk-session-secret-sentinel');
  const original = api.localStorage.value(api.schema.PROFILES_STORAGE_KEY);
  api.sessionStorage.get = async () => { throw new Error('session storage failed'); };
  await assert.rejects(
    api.store.saveProfile(profile({ baseUrl: 'https://another-relay.example/v1' })),
    /session storage failed/,
  );
  assert.deepEqual(api.localStorage.value(api.schema.PROFILES_STORAGE_KEY), original);
});

test('never returns a session key or evidence after out-of-band profile identity drift', async () => {
  const api = loadApi();
  await api.store.saveProfile(profile());
  await api.store.setApiKey('relay-profile-1', 'sk-session-secret-sentinel');
  await api.store.setCapabilityEvidence('relay-profile-1', evidence());
  await api.localStorage.set({
    [api.schema.PROFILES_STORAGE_KEY]: [profile({
      baseUrl: 'https://another-relay.example/v1',
      model: 'another-model-v2',
    })],
  });
  assert.equal(await api.store.readSecretForBackground('relay-profile-1'), null);
  const state = await api.store.getPublicState('relay-profile-1');
  assert.equal(state.hasKey, false);
  assert.deepEqual(state.evidence, []);
});
