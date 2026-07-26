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

function loadApi({
  localStorage = createStorage(),
  sessionStorage = createStorage(),
  now,
  onCredentialAuthorityChanged,
} = {}) {
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
      onCredentialAuthorityChanged,
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

function probeGuard(profileIdentity, overrides = {}) {
  return {
    profileIdentity,
    operation: 'TEXT_TO_IMAGE',
    requestMode: 'json',
    policyRevision: 'policy-revision-1',
    idempotencyKey: 'probe-persistent-1',
    requestHash: '9'.repeat(64),
    ...overrides,
  };
}

function providerDispatch(profileIdentity, overrides = {}) {
  return {
    profileIdentity,
    operation: 'TEXT_TO_IMAGE',
    requestMode: 'json',
    idempotencyKey: 'normal-dispatch-1',
    requestHash: '8'.repeat(64),
    ...overrides,
  };
}

async function setEvidenceForCurrentCredential(api, profileId, value) {
  const snapshot = await api.store.getCredentialSnapshotForBackground(profileId);
  return api.store.setCapabilityEvidence(
    profileId,
    value,
    snapshot && snapshot.credentialRevision,
  );
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
  const snapshot = await api.store.getCredentialSnapshotForBackground('relay-profile-1');
  assert.match(snapshot.credentialRevision, /^[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(publicState).includes(snapshot.credentialRevision), false);
});

test('creates a fresh private credential revision for every key load and rejects stale evidence CAS', async () => {
  const api = loadApi();
  await api.store.saveProfile(profile());
  await api.store.setApiKey('relay-profile-1', 'sk-session-secret-sentinel');
  const first = await api.store.getCredentialSnapshotForBackground('relay-profile-1');
  await api.store.setApiKey('relay-profile-1', 'sk-session-secret-sentinel');
  const second = await api.store.getCredentialSnapshotForBackground('relay-profile-1');
  assert.notEqual(first.credentialRevision, second.credentialRevision);
  await assert.rejects(
    api.store.setCapabilityEvidence('relay-profile-1', evidence(), first.credentialRevision),
    (error) => error && error.code === 'SS_ERP_BYOK_CAPABILITY_EVIDENCE_INVALID',
  );
  assert.deepEqual((await api.store.getPublicState('relay-profile-1')).evidence, []);
});

test('invalidates generated results before key rotation, profile rebind, and credential removal', async () => {
  const invalidations = [];
  const api = loadApi({
    onCredentialAuthorityChanged(input) { invalidations.push(clone(input)); },
  });
  await api.store.saveProfile(profile());
  await api.store.setApiKey('relay-profile-1', 'sk-session-secret-sentinel');
  await api.store.setApiKey('relay-profile-1', 'sk-rotated-session-secret');
  await api.store.saveProfile(profile({ model: 'image-model-v2' }));
  await api.store.clearApiKey('relay-profile-1');
  await api.store.deleteProfile('relay-profile-1');

  assert.deepEqual(invalidations.map((item) => item.reason), [
    'session_key_set',
    'session_key_set',
    'profile_authority_changed',
    'session_key_cleared',
    'profile_deleted',
  ]);
  assert.equal(JSON.stringify(invalidations).includes('sk-'), false);
});

test('persists bounded normal dispatch tombstones across store recreation and clears them on key reset', async () => {
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  const api = loadApi({ localStorage, sessionStorage });
  await api.store.saveProfile(profile());
  await api.store.setApiKey('relay-profile-1', 'sk-dispatch-guard-sentinel');
  const snapshot = await api.store.getCredentialSnapshotForBackground('relay-profile-1');
  const identity = api.schema.profileIdentity(snapshot.profile);
  const dispatch = providerDispatch(identity);
  assert.deepEqual(
    await api.store.beginProviderDispatch('relay-profile-1', dispatch, snapshot.credentialRevision),
    { started: true },
  );
  const stored = sessionStorage.value(api.schema.SESSION_PROVIDER_DISPATCHES_STORAGE_KEY);
  assert.equal(stored['relay-profile-1'].length, 1);
  assert.equal(JSON.stringify(stored).includes('sk-dispatch-guard-sentinel'), false);
  assert.equal(JSON.stringify(await api.store.getPublicState('relay-profile-1'))
    .includes(snapshot.credentialRevision), false);

  const restarted = loadApi({ localStorage, sessionStorage });
  await assert.rejects(
    restarted.store.beginProviderDispatch('relay-profile-1', dispatch, snapshot.credentialRevision),
    (error) => error
      && error.code === 'SS_ERP_BYOK_PROVIDER_UNKNOWN_OUTCOME'
      && error.outcome === 'UNKNOWN_OUTCOME'
      && error.automaticRetryAllowed === false
      && error.replayed === true,
  );
  await assert.rejects(
    restarted.store.beginProviderDispatch(
      'relay-profile-1',
      { ...dispatch, requestHash: '7'.repeat(64) },
      snapshot.credentialRevision,
    ),
    (error) => error
      && error.code === 'SS_ERP_BYOK_PROVIDER_IDEMPOTENCY_CONFLICT'
      && error.outcome === 'FAILED_FINAL',
  );

  await restarted.store.setApiKey('relay-profile-1', 'sk-dispatch-reset-sentinel');
  assert.equal(
    sessionStorage.value(api.schema.SESSION_PROVIDER_DISPATCHES_STORAGE_KEY),
    undefined,
  );
  const replacement = await restarted.store.getCredentialSnapshotForBackground('relay-profile-1');
  const replacementIdentity = api.schema.profileIdentity(replacement.profile);
  for (let index = 0; index < 100; index += 1) {
    await restarted.store.beginProviderDispatch(
      'relay-profile-1',
      providerDispatch(replacementIdentity, {
        idempotencyKey: `bounded-dispatch-${String(index).padStart(3, '0')}`,
        requestHash: index.toString(16).padStart(64, '0'),
      }),
      replacement.credentialRevision,
    );
  }
  await assert.rejects(
    restarted.store.beginProviderDispatch(
      'relay-profile-1',
      providerDispatch(replacementIdentity, {
        idempotencyKey: 'bounded-dispatch-overflow',
        requestHash: 'f'.repeat(64),
      }),
      replacement.credentialRevision,
    ),
    (error) => error
      && error.code === 'SS_ERP_BYOK_PROVIDER_DISPATCH_LIMIT'
      && error.outcome === 'FAILED_RETRYABLE',
  );
  assert.equal(
    sessionStorage.value(api.schema.SESSION_PROVIDER_DISPATCHES_STORAGE_KEY)['relay-profile-1'].length,
    100,
  );
});

test('fails a malformed persisted dispatch guard closed until the browser session is cleared', async () => {
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  const api = loadApi({ localStorage, sessionStorage });
  await api.store.saveProfile(profile());
  await api.store.setApiKey('relay-profile-1', 'sk-corrupt-guard-sentinel');
  const snapshot = await api.store.getCredentialSnapshotForBackground('relay-profile-1');
  const identity = api.schema.profileIdentity(snapshot.profile);
  await sessionStorage.set({
    [api.schema.SESSION_PROVIDER_DISPATCHES_STORAGE_KEY]: {
      'relay-profile-1': [{
        contractVersion: 'extension-byok-provider-dispatch/v1',
        profileIdentity: identity,
        credentialRevision: snapshot.credentialRevision,
        operation: 'TEXT_TO_IMAGE',
        requestMode: 'json',
        idempotencyKey: 'corrupt-dispatch-1',
        requestHash: 'not-a-sha256',
      }],
    },
  });
  await assert.rejects(
    api.store.beginProviderDispatch(
      'relay-profile-1',
      providerDispatch(identity, { idempotencyKey: 'corrupt-dispatch-2' }),
      snapshot.credentialRevision,
    ),
    (error) => error
      && error.code === 'SS_ERP_BYOK_PROVIDER_UNKNOWN_OUTCOME'
      && error.outcome === 'UNKNOWN_OUTCOME'
      && error.automaticRetryAllowed === false,
  );
  await api.store.clearSession();
  assert.equal(sessionStorage.value(api.schema.SESSION_PROVIDER_DISPATCHES_STORAGE_KEY), undefined);
});

test('persists uncertain probe authority across store instances and clears it only on explicit resets', async () => {
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  const api = loadApi({ localStorage, sessionStorage });
  await api.store.saveProfile(profile());
  await api.store.setApiKey('relay-profile-1', 'sk-session-secret-sentinel');
  const snapshot = await api.store.getCredentialSnapshotForBackground('relay-profile-1');
  const identity = api.schema.profileIdentity(snapshot.profile);
  const original = probeGuard(identity);
  await api.store.beginCapabilityProbe(
    'relay-profile-1',
    original,
    snapshot.credentialRevision,
  );
  await api.store.markCapabilityProbeUncertain(
    'relay-profile-1',
    original,
    snapshot.credentialRevision,
  );

  const publicState = await api.store.getPublicState('relay-profile-1');
  assert.equal(JSON.stringify(publicState).includes(snapshot.credentialRevision), false);
  assert.equal(JSON.stringify(publicState).includes(original.idempotencyKey), false);
  const stored = sessionStorage.value(api.schema.SESSION_UNCERTAIN_PROBES_STORAGE_KEY);
  assert.equal(stored['relay-profile-1'][0].state, 'UNKNOWN_OUTCOME');
  assert.equal(stored['relay-profile-1'][0].requestHash, original.requestHash);

  await api.store.saveProfile(profile({
    preferences: { defaultSize: '1536x1024', quality: 'high', outputFormat: 'webp' },
  }));
  assert.ok(sessionStorage.value(api.schema.SESSION_UNCERTAIN_PROBES_STORAGE_KEY));

  const restarted = loadApi({ localStorage, sessionStorage });
  await assert.rejects(
    restarted.store.beginCapabilityProbe(
      'relay-profile-1',
      probeGuard(identity, {
        idempotencyKey: 'probe-persistent-2',
        requestHash: '8'.repeat(64),
      }),
      snapshot.credentialRevision,
    ),
    (error) => error
      && error.code === 'SS_ERP_BYOK_PROVIDER_UNKNOWN_OUTCOME'
      && error.outcome === 'UNKNOWN_OUTCOME'
      && error.automaticRetryAllowed === false,
  );

  await restarted.store.setApiKey('relay-profile-1', 'sk-replaced-session-secret');
  assert.equal(
    sessionStorage.value(api.schema.SESSION_UNCERTAIN_PROBES_STORAGE_KEY),
    undefined,
  );
  const replacement = await restarted.store.getCredentialSnapshotForBackground('relay-profile-1');
  await restarted.store.beginCapabilityProbe(
    'relay-profile-1',
    probeGuard(identity, {
      idempotencyKey: 'probe-persistent-3',
      requestHash: '7'.repeat(64),
    }),
    replacement.credentialRevision,
  );
  await restarted.store.clearApiKey('relay-profile-1');
  assert.equal(
    sessionStorage.value(api.schema.SESSION_UNCERTAIN_PROBES_STORAGE_KEY),
    undefined,
  );
});

test('prevents a session write started before disconnect from restoring cleared authority', async () => {
  const api = loadApi();
  await api.store.saveProfile(profile());
  const originalGet = api.sessionStorage.get.bind(api.sessionStorage);
  let releaseRead;
  let readStarted;
  const started = new Promise((resolve) => { readStarted = resolve; });
  api.sessionStorage.get = async function (keys) {
    readStarted();
    await new Promise((resolve) => { releaseRead = resolve; });
    return originalGet(keys);
  };
  const loading = api.store.setApiKey('relay-profile-1', 'sk-late-session-secret');
  await started;
  const clearing = api.store.clearSession();
  releaseRead();
  await assert.rejects(
    loading,
    (error) => error && error.code === 'SS_ERP_BYOK_SESSION_INVALIDATED',
  );
  await clearing;
  assert.equal(api.sessionStorage.value(api.schema.SESSION_SECRETS_STORAGE_KEY), undefined);
});

test('invalidates the key and capability evidence on endpoint/model rebinding but not preference edits', async () => {
  const api = loadApi();
  await api.store.saveProfile(profile());
  await api.store.setApiKey('relay-profile-1', 'sk-session-secret-sentinel');
  await setEvidenceForCurrentCredential(api, 'relay-profile-1', evidence());
  await api.store.saveProfile(profile({ preferences: { defaultSize: '1536x1024', quality: 'high', outputFormat: 'webp' } }));
  assert.equal((await api.store.getPublicState('relay-profile-1')).hasKey, true);
  assert.equal((await api.store.getPublicState('relay-profile-1')).evidence.length, 1);

  await api.store.saveProfile(profile({ baseUrl: 'https://another-relay.example/v1/' }));
  assert.equal(await api.store.readSecretForBackground('relay-profile-1'), null);
  assert.deepEqual((await api.store.getPublicState('relay-profile-1')).evidence, []);

  await api.store.setApiKey('relay-profile-1', 'sk-session-secret-sentinel-2');
  await setEvidenceForCurrentCredential(api, 'relay-profile-1', evidence({
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
    setEvidenceForCurrentCredential(api, 'relay-profile-1', evidence({ profileIdentity: 'wrong' })),
    (error) => error && error.code === 'SS_ERP_BYOK_CAPABILITY_EVIDENCE_INVALID',
  );
  await assert.rejects(
    setEvidenceForCurrentCredential(api, 'relay-profile-1', evidence({ expiresAt: '2026-07-25T11:00:00.000Z' })),
    (error) => error && error.code === 'SS_ERP_BYOK_CAPABILITY_EVIDENCE_INVALID',
  );
  await assert.rejects(
    setEvidenceForCurrentCredential(api, 'relay-profile-1', evidence({
      verifiedAt: '2026-07-25T13:00:00.000Z',
      expiresAt: '2026-07-25T14:00:00.000Z',
    })),
    (error) => error && error.code === 'SS_ERP_BYOK_CAPABILITY_EVIDENCE_INVALID',
  );
  await assert.rejects(
    setEvidenceForCurrentCredential(api, 'relay-profile-1', evidence({
      expiresAt: '2026-08-03T12:00:00.000Z',
    })),
    (error) => error && error.code === 'SS_ERP_BYOK_CAPABILITY_EVIDENCE_INVALID',
  );
  await setEvidenceForCurrentCredential(api, 'relay-profile-1', evidence());
  const state = await api.store.getPublicState('relay-profile-1');
  assert.deepEqual(state.evidence, [evidence()]);
  assert.equal(JSON.stringify(state).includes('sk-'), false);
});

test('removes evidence for operations removed from a profile without clearing its key', async () => {
  const api = loadApi();
  await api.store.saveProfile(profile());
  await api.store.setApiKey('relay-profile-1', 'sk-session-secret-sentinel');
  await setEvidenceForCurrentCredential(api, 'relay-profile-1', evidence());
  await api.store.saveProfile(profile({ allowedOperations: ['IMAGE_TO_IMAGE'] }));

  const state = await api.store.getPublicState('relay-profile-1');
  assert.equal(state.hasKey, true);
  assert.deepEqual(state.evidence, []);
  assert.equal(await api.store.readSecretForBackground('relay-profile-1'), 'sk-session-secret-sentinel');
  assert.equal(api.sessionStorage.value(api.schema.SESSION_EVIDENCE_STORAGE_KEY), undefined);
});

test('keeps capability evidence isolated by operation and request mode', async () => {
  const api = loadApi();
  await api.store.saveProfile(profile({
    allowedOperations: ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'],
  }));
  await api.store.setApiKey('relay-profile-1', 'sk-session-secret-sentinel');
  const expected = [
    ['TEXT_TO_IMAGE', 'json'],
    ['IMAGE_TO_IMAGE', 'multipart'],
    ['FULL_EDIT', 'multipart'],
    ['INPAINT', 'multipart'],
  ];
  for (const [operation, requestMode] of expected) {
    await setEvidenceForCurrentCredential(api, 'relay-profile-1', evidence({
      operation,
      requestMode,
    }));
  }
  const state = await api.store.getPublicState('relay-profile-1');
  assert.deepEqual(
    state.evidence.map((item) => [item.operation, item.requestMode]),
    expected,
  );
  assert.equal(JSON.stringify(state).includes('sk-session-secret-sentinel'), false);
});

test('does not accept capability evidence without a matching session key', async () => {
  const api = loadApi();
  await api.store.saveProfile(profile());
  await assert.rejects(
    setEvidenceForCurrentCredential(api, 'relay-profile-1', evidence()),
    (error) => error && error.code === 'SS_ERP_BYOK_CAPABILITY_EVIDENCE_INVALID',
  );
});

test('device disconnect/session clear removes every secret and evidence entry', async () => {
  const api = loadApi();
  await api.store.saveProfile(profile());
  await api.store.setApiKey('relay-profile-1', 'sk-session-secret-sentinel');
  await setEvidenceForCurrentCredential(api, 'relay-profile-1', evidence());
  await api.store.disconnectDevice();
  assert.equal(api.sessionStorage.value(api.schema.SESSION_SECRETS_STORAGE_KEY), undefined);
  assert.equal(api.sessionStorage.value(api.schema.SESSION_EVIDENCE_STORAGE_KEY), undefined);
  assert.equal(await api.store.readSecretForBackground('relay-profile-1'), null);
  assert.deepEqual((await api.store.getPublicState('relay-profile-1')).evidence, []);
  assert.equal(api.localStorage.value(api.schema.PROFILES_STORAGE_KEY).length, 1);
});

test('clears only the selected profile session key and capability evidence', async () => {
  const api = loadApi();
  const secondProfile = profile({
    id: 'relay-profile-2',
    name: 'Second relay',
    baseUrl: 'https://second-relay.example/v1',
  });
  await api.store.saveProfile(profile());
  await api.store.saveProfile(secondProfile);
  await api.store.setApiKey('relay-profile-1', 'sk-session-secret-sentinel');
  await api.store.setApiKey('relay-profile-2', 'sk-second-session-secret-sentinel');
  await setEvidenceForCurrentCredential(api, 'relay-profile-1', evidence());
  await setEvidenceForCurrentCredential(api, 'relay-profile-2', evidence({
    profileIdentity: 'https://second-relay.example/v1\u0000image-model-v1',
  }));

  assert.deepEqual(await api.store.clearApiKey('relay-profile-1'), {
    profileId: 'relay-profile-1',
    hasKey: false,
    cleared: true,
  });
  assert.equal(await api.store.readSecretForBackground('relay-profile-1'), null);
  assert.deepEqual((await api.store.getPublicState('relay-profile-1')).evidence, []);
  assert.equal(
    await api.store.readSecretForBackground('relay-profile-2'),
    'sk-second-session-secret-sentinel',
  );
  assert.equal((await api.store.getPublicState('relay-profile-2')).evidence.length, 1);
  await assert.rejects(
    api.store.clearApiKey('missing-profile'),
    (error) => error && error.code === 'SS_ERP_BYOK_PROFILE_NOT_FOUND',
  );
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
  await setEvidenceForCurrentCredential(api, 'relay-profile-1', evidence());
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
