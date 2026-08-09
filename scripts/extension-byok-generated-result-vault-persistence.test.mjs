import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const modulePath = 'extensions/ss-erp/shared/byok/generated-result-vault-persistence.js';
const source = readFileSync(modulePath, 'utf8');
const context = {
  Array, ArrayBuffer, Blob, Boolean, DataView, Date, Error, JSON, Map, Math,
  Number, Object, Promise, Set, String, TextDecoder, TextEncoder, Uint8Array, URL,
  crypto: webcrypto,
};
context.globalThis = context;
vm.runInNewContext(source, context, { filename: modulePath });
const api = context.SS_ERP_BYOK_GENERATED_RESULT_VAULT_PERSISTENCE;

const NOW = Date.parse('2026-08-03T10:00:00.000Z');

function clone(value) { return structuredClone(value); }

function sessionStorage(initial = {}) {
  const values = clone(initial);
  return {
    async get(keys) {
      const result = {};
      for (const key of keys) if (Object.hasOwn(values, key)) result[key] = clone(values[key]);
      return result;
    },
    async set(patch) { Object.assign(values, clone(patch)); },
    async remove(keys) { for (const key of keys) delete values[key]; },
    snapshot() { return clone(values); },
  };
}

function namedError(name) { const error = new Error(name); error.name = name; return error; }

function isEscrowError(code) {
  return (error) => (
    error?.code === code
    && error?.outcome === 'FAILED_FINAL'
    && error?.automaticRetryAllowed === false
  );
}

function repository() {
  const rows = new Map();
  const events = [];
  let gate = null;
  let nextFailure = null;
  let nextDeleteFailure = null;
  let nextClearFailure = null;
  return {
    async ready() { events.push(['ready']); },
    async list() { return [...rows.values()].map(clone); },
    async stage(row, limits) {
      events.push(['stage-start', row.resultId]);
      if (gate) {
        const current = gate;
        gate = null;
        current.enter();
        await current.wait;
      }
      if (nextFailure) {
        const failure = nextFailure;
        nextFailure = null;
        throw namedError(failure);
      }
      const existing = rows.get(row.resultId) || [...rows.values()].find((candidate) => (
        candidate.executionIntentHash === row.executionIntentHash
        || candidate.operationKeyHash === row.operationKeyHash
      ));
      if (existing) {
        if (existing.resultId !== row.resultId && existing.identityHash !== row.identityHash
          || existing.identityHash !== row.identityHash) {
          const error = new Error('conflict');
          error.code = 'SS_ERP_BYOK_RESULT_ESCROW_CONFLICT';
          throw error;
        }
        return { kind: 'existing', record: clone(existing) };
      }
      const totalBytes = [...rows.values()].reduce((sum, item) => sum + item.byteLength, 0);
      if (rows.size + 1 > limits.maxEntries
        || totalBytes + row.byteLength > limits.maxTotalBytes) {
        const error = new Error('full');
        error.code = 'SS_ERP_BYOK_RESULT_ESCROW_FULL';
        throw error;
      }
      rows.set(row.resultId, clone(row));
      events.push(['stage-committed', row.resultId]);
      return { kind: 'inserted', record: clone(row) };
    },
    async deleteMany(ids) {
      events.push(['delete', [...ids]]);
      if (nextDeleteFailure) {
        const failure = nextDeleteFailure;
        nextDeleteFailure = null;
        throw namedError(failure);
      }
      ids.forEach((id) => rows.delete(id));
    },
    async clear() {
      events.push(['clear']);
      if (nextClearFailure) {
        const failure = nextClearFailure;
        nextClearFailure = null;
        throw namedError(failure);
      }
      rows.clear();
    },
    holdNextStage() {
      let enter;
      let release;
      const entered = new Promise((resolve) => { enter = resolve; });
      const wait = new Promise((resolve) => { release = resolve; });
      gate = { enter, wait };
      return { entered, release };
    },
    failNextStage(name = 'QuotaExceededError') { nextFailure = name; },
    failNextDelete(name = 'UnknownError') { nextDeleteFailure = name; },
    failNextClear(name = 'UnknownError') { nextClearFailure = name; },
    mutate(id, operation) { rows.set(id, operation(clone(rows.get(id)))); },
    get(id) { return clone(rows.get(id)); },
    size() { return rows.size; },
    events,
  };
}

function randomValues(seed = 1) {
  let value = seed;
  return (bytes) => {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = value++ % 256;
    return bytes;
  };
}

function png(marker = 1, size = 32) {
  const bytes = new Uint8Array(Math.max(8, size));
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.fill(marker, 8);
  return new Blob([bytes], { type: 'image/png' });
}

async function digest(blob) {
  const value = await webcrypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Buffer.from(value).toString('hex');
}

async function input(overrides = {}) {
  const blob = overrides.blob || png(overrides.marker || 1);
  const operation = overrides.operation || 'TEXT_TO_IMAGE';
  const result = {
    contractVersion: 'extension-byok-text-to-image-client/v1',
    outcome: 'SUCCEEDED', operation,
    requestMode: operation === 'TEXT_TO_IMAGE' ? 'json' : 'multipart',
    profileId: 'profile-1',
    profileIdentity: 'https://relay.example/v1\u0000image-model-v1',
    providerOrigin: 'https://relay.example', model: 'image-model-v1', policyRevision: '734',
    executionIntentId: overrides.executionIntentId || 'intent-1',
    idempotencyKey: overrides.idempotencyKey || 'provider-attempt-0001',
    requestHash: overrides.requestHash || 'a'.repeat(64), promptHash: 'b'.repeat(64),
    negativePromptHash: null, endpointHash: 'c'.repeat(64),
    providerRequestIdSha256: 'd'.repeat(64), providerTaskIdSha256: null,
    sourceSha256: null, referenceSha256s: [], maskSha256: null,
    acceptedAt: '2026-08-03T10:00:00.000Z',
    image: {
      blob, mimeType: overrides.mimeType || blob.type,
      byteLength: overrides.byteLength || blob.size,
      sha256: overrides.sha256 || await digest(blob),
    },
    ...(overrides.result || {}),
  };
  const binding = {
    contractVersion: 'extension-byok-readiness-binding/v2',
    ownerUserId: 'owner-1', deviceSessionId: 'device-session-1', shopId: 'shop-1',
    workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
    sourcePlatform: '1688', sourceProductId: 'product-1',
    sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
    skuKey: 'sku-1', slotKey: 'sku:sku-1:hero', assignmentMode: 'APPEND',
    assignmentOrdinal: 0, providerOrigin: result.providerOrigin, model: result.model,
    operation, policyRevision: result.policyRevision,
    ...(overrides.binding || {}),
  };
  const lifecycleAuthority = {
    contractVersion: 'extension-byok-device-session-lifecycle/v1', epoch: 7,
    ...(overrides.lifecycleAuthority || {}),
  };
  return { result, binding, lifecycleAuthority };
}

function store(options = {}) {
  return api.createStore({
    repository: options.repository || repository(),
    sessionStorage: options.sessionStorage || sessionStorage(),
    crypto: webcrypto,
    now: options.now || (() => NOW),
    randomValues: options.randomValues || randomValues(),
  });
}

async function stage(target, value) {
  return target.stage(value.result, value.binding, value.lifecycleAuthority);
}

test('exports the bounded Chrome 114 escrow and IndexedDB adapter contract', () => {
  assert.equal(api.CONTRACT_VERSION, 'extension-byok-result-vault-persistence/v1');
  assert.equal(api.MAX_ENTRIES, 16);
  assert.equal(api.MAX_TOTAL_BYTES, 50 * 1024 * 1024);
  assert.equal(api.MAX_RESULT_BYTES, 20 * 1024 * 1024);
  assert.equal(api.MAX_TTL_MS, 10 * 60 * 1000);
  assert.equal(typeof api.createStore, 'function');
  assert.equal(typeof api.createIndexedDbRepository, 'function');
  assert.match(source, /onupgradeneeded/u);
  assert.match(source, /createIndex\([^)]*executionIntentHash[^)]*unique:\s*true/u);
  assert.match(source, /createIndex\([^)]*operationKeyHash[^)]*unique:\s*true/u);
  assert.match(source, /transaction\([^)]*['"]readwrite['"]/u);
  assert.doesNotMatch(source, /unlimitedStorage|chrome\.storage\.local|chrome\.storage\.sync/u);
});

test('stores ciphertext only and restores the exact candidate after worker restart', async () => {
  const repo = repository();
  const session = sessionStorage();
  const first = store({ repository: repo, sessionStorage: session, randomValues: randomValues(1) });
  await first.ready();
  const value = await input();
  const staged = await stage(first, value);
  assert.match(staged.resultId, /^br_[a-f0-9]{48}$/u);
  assert.equal(staged.result.executionIntentId, value.result.executionIntentId);

  const envelope = repo.get(staged.resultId);
  assert.deepEqual(Object.keys(envelope).sort(), [
    'byteLength', 'ciphertext', 'contractVersion', 'executionIntentHash', 'expiresAtMillis',
    'identityHash', 'iv', 'keyId', 'operationKeyHash', 'resultId',
  ]);
  assert.equal(envelope.iv.byteLength, 12);
  const serialized = JSON.stringify(envelope);
  for (const forbidden of [
    value.result.executionIntentId, value.result.providerOrigin,
    value.binding.ownerUserId, value.result.image.sha256, 'prompt', 'base64', 'apiKey',
  ]) assert.equal(serialized.includes(forbidden), false);

  const key = session.snapshot()[api.SESSION_STORAGE_KEY];
  assert.equal(key.keyBytes.length, 32);
  assert.match(key.keyId, /^[a-f0-9]{32}$/u);
  assert.equal(serialized.includes(key.keyBytes.join(',')), false);

  const restarted = store({ repository: repo, sessionStorage: session, randomValues: randomValues(80) });
  await restarted.ready();
  const recovered = await restarted.findByExecutionIntentId(value.result.executionIntentId, {
    resultSha256: value.result.image.sha256,
    binding: value.binding,
  });
  assert.equal(recovered.resultId, staged.resultId);
  assert.equal(recovered.lifecycleAuthority.epoch, 7);
  assert.equal('sourceSha256' in recovered.result, false);
  assert.equal('referenceSha256s' in recovered.result, false);
  assert.equal('maskSha256' in recovered.result, false);
  assert.deepEqual(new Uint8Array(await recovered.result.image.blob.arrayBuffer()),
    new Uint8Array(await value.result.image.blob.arrayBuffer()));
});

test('exact replay returns one stable result ID and conflicts fail closed', async () => {
  const target = store({ randomValues: randomValues(20) });
  await target.ready();
  const value = await input();
  const first = await stage(target, value);
  const replay = await stage(target, value);
  assert.equal(replay.resultId, first.resultId);
  await assert.rejects(
    stage(target, await input({ marker: 2 })),
    isEscrowError('SS_ERP_BYOK_RESULT_ESCROW_CONFLICT'),
  );
});

test('accepts async edit results while keeping text generation JSON-only', async () => {
  const target = store({ randomValues: randomValues(25) });
  await target.ready();
  const edit = await input({
    operation: 'FULL_EDIT',
    executionIntentId: 'intent-async-edit',
    idempotencyKey: 'provider-attempt-async-edit',
    requestHash: '7'.repeat(64),
    result: {
      adapterId: 'dashscope-wanx21-full-edit-v1',
      requestMode: 'async',
      sourceSha256: '8'.repeat(64),
    },
  });
  const staged = await stage(target, edit);
  assert.equal(staged.result.requestMode, 'async');
  assert.equal(Object.hasOwn(staged.result, 'adapterId'), false);
  assert.equal(Object.isFrozen(staged.result.image), true);
  assert.equal(Object.isFrozen(staged.result.referenceSha256s), true);
  await assert.rejects(
    stage(target, await input({ result: { requestMode: 'async' } })),
    isEscrowError('SS_ERP_BYOK_RESULT_ESCROW_INVALID'),
  );
});

test('uses independent 96-bit IVs and supports result ID lookup and delete', async () => {
  const repo = repository();
  const target = store({ repository: repo, randomValues: randomValues(30) });
  await target.ready();
  const firstValue = await input();
  const secondValue = await input({
    executionIntentId: 'intent-2', idempotencyKey: 'provider-attempt-0002',
    requestHash: 'e'.repeat(64), marker: 2,
  });
  const first = await stage(target, firstValue);
  const second = await stage(target, secondValue);
  assert.notDeepEqual([...new Uint8Array(repo.get(first.resultId).iv)],
    [...new Uint8Array(repo.get(second.resultId).iv)]);
  assert.equal((await target.find({ resultId: second.resultId })).result.executionIntentId, 'intent-2');
  assert.equal(await target.delete(first.resultId), true);
  assert.equal(await target.find({ resultId: first.resultId }), null);
});

test('key loss, ciphertext tamper, and hard expiry never return candidate bytes', async () => {
  const repo = repository();
  const session = sessionStorage();
  let now = NOW;
  const first = store({ repository: repo, sessionStorage: session, now: () => now });
  await first.ready();
  const value = await input();
  const staged = await stage(first, value);
  repo.mutate(staged.resultId, (row) => {
    const bytes = new Uint8Array(row.ciphertext);
    bytes[bytes.length - 1] ^= 0xff;
    row.ciphertext = bytes.buffer;
    return row;
  });
  const restarted = store({ repository: repo, sessionStorage: session, now: () => now });
  await restarted.ready();
  assert.equal(await restarted.find({ resultId: staged.resultId }), null);
  assert.equal(repo.size(), 0);

  const expiring = await stage(restarted, await input({
    executionIntentId: 'intent-expiring', idempotencyKey: 'provider-attempt-expiring',
    requestHash: 'f'.repeat(64),
  }));
  now += api.MAX_TTL_MS + 1;
  assert.equal(await restarted.find({ resultId: expiring.resultId }), null);

  const beforeKeyLoss = await stage(restarted, await input({
    executionIntentId: 'intent-key-loss', idempotencyKey: 'provider-attempt-key-loss',
    requestHash: '1'.repeat(64), marker: 3,
  }));
  await session.remove([api.SESSION_STORAGE_KEY]);
  const afterLoss = store({ repository: repo, sessionStorage: session, now: () => now });
  await afterLoss.ready();
  assert.equal(await afterLoss.find({ resultId: beforeKeyLoss.resultId }), null);
  assert.equal(repo.size(), 0);
});

test('rejects malformed result, binding, lifecycle, secret fields, magic, hash, and size', async () => {
  const target = store();
  await target.ready();
  const cases = [
    await input({ result: { prompt: 'raw prompt' } }),
    await input({ result: { apiKey: 'sk-' + 'x'.repeat(32) } }),
    await input({ result: { resultUrl: 'https://cdn.example/result.png' } }),
    await input({ binding: { shopId: '' } }),
    await input({ lifecycleAuthority: { epoch: -1 } }),
    await input({ mimeType: 'image/jpeg' }),
    await input({ sha256: '0'.repeat(64) }),
  ];
  for (const value of cases) {
    await assert.rejects(
      stage(target, value),
      isEscrowError('SS_ERP_BYOK_RESULT_ESCROW_INVALID'),
    );
  }
  const oversized = await input({ blob: png(1, api.MAX_RESULT_BYTES + 1) });
  await assert.rejects(
    stage(target, oversized),
    isEscrowError('SS_ERP_BYOK_RESULT_ESCROW_INVALID'),
  );
});

test('enforces 16 entries and maps quota failure without exposing an uncommitted row', async () => {
  const repo = repository();
  const target = store({ repository: repo, randomValues: randomValues(40) });
  await target.ready();
  for (let index = 0; index < 16; index += 1) {
    await stage(target, await input({
      executionIntentId: `intent-${index + 1}`,
      idempotencyKey: `provider-attempt-${String(index + 1).padStart(4, '0')}`,
      requestHash: index.toString(16).repeat(64), marker: index + 1,
    }));
  }
  await assert.rejects(stage(target, await input({
    executionIntentId: 'intent-17', idempotencyKey: 'provider-attempt-0017',
    requestHash: '0'.repeat(64), marker: 17,
  })), isEscrowError('SS_ERP_BYOK_RESULT_ESCROW_FULL'));
  assert.equal(repo.size(), 16);

  await target.clearAndRotateKey();
  repo.failNextStage();
  const failed = await input();
  await assert.rejects(stage(target, failed), (error) => (
    error?.code === 'SS_ERP_BYOK_RESULT_ESCROW_QUOTA'
    && error?.automaticRetryAllowed === false
  ));
  assert.equal(repo.size(), 0);
});

test('serializes mutations and waits for transaction completion before success', async () => {
  const repo = repository();
  const target = store({ repository: repo, randomValues: randomValues(60) });
  await target.ready();
  const gate = repo.holdNextStage();
  const firstValue = await input();
  const secondValue = await input({
    executionIntentId: 'intent-2', idempotencyKey: 'provider-attempt-0002',
    requestHash: 'e'.repeat(64), marker: 2,
  });
  let settled = false;
  const first = stage(target, firstValue).finally(() => { settled = true; });
  await gate.entered;
  const second = stage(target, secondValue);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(settled, false);
  assert.equal(repo.events.filter((event) => event[0] === 'stage-start').length, 1);
  gate.release();
  await Promise.all([first, second]);
  assert.equal(repo.events.filter((event) => event[0] === 'stage-committed').length, 2);
});

test('deleteMany and clearAndRotateKey remove ciphertext and rotate the key', async () => {
  const repo = repository();
  const session = sessionStorage();
  const target = store({ repository: repo, sessionStorage: session, randomValues: randomValues(70) });
  await target.ready();
  const first = await stage(target, await input());
  const second = await stage(target, await input({
    executionIntentId: 'intent-2', idempotencyKey: 'provider-attempt-0002',
    requestHash: 'e'.repeat(64), marker: 2,
  }));
  const oldKey = session.snapshot()[api.SESSION_STORAGE_KEY].keyId;
  assert.equal(await target.deleteMany([first.resultId, 'br_' + 'f'.repeat(48)]), 1);
  assert.equal(repo.size(), 1);
  await target.clearAndRotateKey();
  assert.equal(repo.size(), 0);
  assert.notEqual(session.snapshot()[api.SESSION_STORAGE_KEY].keyId, oldKey);
  assert.equal(await target.find({ resultId: second.resultId }), null);
});

test('clearAndDeleteKey removes ciphertext and the session key without rotating it', async () => {
  const repo = repository();
  const session = sessionStorage();
  const target = store({ repository: repo, sessionStorage: session, randomValues: randomValues(72) });
  await target.ready();
  const candidate = await stage(target, await input());
  assert.equal(repo.size(), 1);
  assert.ok(session.snapshot()[api.SESSION_STORAGE_KEY]);

  const cleared = await target.clearAndDeleteKey();
  assert.equal(cleared.cleared, true);
  assert.equal(cleared.keyDeleted, true);
  assert.equal(repo.size(), 0);
  assert.equal(session.snapshot()[api.SESSION_STORAGE_KEY], undefined);

  await target.ready();
  assert.ok(session.snapshot()[api.SESSION_STORAGE_KEY]);
  assert.equal(await target.find({ resultId: candidate.resultId }), null);
});

test('clearAndDeleteKey does not create a key for an uninitialized empty escrow', async () => {
  const repo = repository();
  const session = sessionStorage();
  const target = store({ repository: repo, sessionStorage: session, randomValues: randomValues(73) });

  await target.clearAndDeleteKey();

  assert.equal(repo.size(), 0);
  assert.deepEqual(session.snapshot(), {});
});

test('clearAndDeleteKey removes the session key without waiting for ciphertext cleanup', async () => {
  const repo = repository();
  const session = sessionStorage();
  const target = store({ repository: repo, sessionStorage: session, randomValues: randomValues(77) });
  await target.ready();
  await stage(target, await input());
  const originalClear = repo.clear.bind(repo);
  let releaseClear;
  let markClearStarted;
  const clearStarted = new Promise((resolve) => { markClearStarted = resolve; });
  const clearGate = new Promise((resolve) => { releaseClear = resolve; });
  repo.clear = async () => {
    markClearStarted();
    await clearGate;
    return originalClear();
  };

  const clearing = target.clearAndDeleteKey();
  await clearStarted;
  await Promise.resolve();
  assert.equal(session.snapshot()[api.SESSION_STORAGE_KEY], undefined);
  releaseClear();
  await clearing;
  assert.equal(repo.size(), 0);
});

test('clearAndDeleteKey fails closed and is retryable after either durable clear fails', async () => {
  const repositoryFailureRepo = repository();
  const repositoryFailureSession = sessionStorage();
  const repositoryFailureTarget = store({
    repository: repositoryFailureRepo,
    sessionStorage: repositoryFailureSession,
    randomValues: randomValues(74),
  });
  await repositoryFailureTarget.ready();
  await stage(repositoryFailureTarget, await input());
  repositoryFailureRepo.failNextClear();
  await assert.rejects(
    repositoryFailureTarget.clearAndDeleteKey(),
    isEscrowError('SS_ERP_BYOK_RESULT_ESCROW_UNAVAILABLE'),
  );
  assert.equal(repositoryFailureRepo.size(), 1);
  assert.equal(repositoryFailureSession.snapshot()[api.SESSION_STORAGE_KEY], undefined);
  await repositoryFailureTarget.clearAndDeleteKey();
  assert.equal(repositoryFailureRepo.size(), 0);
  assert.equal(repositoryFailureSession.snapshot()[api.SESSION_STORAGE_KEY], undefined);

  const sessionFailureRepo = repository();
  const sessionFailureStorage = sessionStorage();
  const originalRemove = sessionFailureStorage.remove.bind(sessionFailureStorage);
  let failNextRemove = false;
  sessionFailureStorage.remove = async (keys) => {
    if (failNextRemove) {
      failNextRemove = false;
      throw namedError('UnknownError');
    }
    return originalRemove(keys);
  };
  const sessionFailureTarget = store({
    repository: sessionFailureRepo,
    sessionStorage: sessionFailureStorage,
    randomValues: randomValues(76),
  });
  await sessionFailureTarget.ready();
  await stage(sessionFailureTarget, await input());
  failNextRemove = true;
  await assert.rejects(
    sessionFailureTarget.clearAndDeleteKey(),
    isEscrowError('SS_ERP_BYOK_RESULT_ESCROW_UNAVAILABLE'),
  );
  assert.equal(sessionFailureRepo.size(), 0);
  assert.ok(sessionFailureStorage.snapshot()[api.SESSION_STORAGE_KEY]);
  await sessionFailureTarget.clearAndDeleteKey();
  assert.equal(sessionFailureStorage.snapshot()[api.SESSION_STORAGE_KEY], undefined);
});

test('deletes ciphertext durably by a closed bounded set of canonical execution intent IDs', async () => {
  const repo = repository();
  const target = store({ repository: repo, randomValues: randomValues(75) });
  await target.ready();
  const first = await stage(target, await input());
  const second = await stage(target, await input({
    executionIntentId: 'intent-2', idempotencyKey: 'provider-attempt-0002',
    requestHash: 'e'.repeat(64), marker: 2,
  }));

  assert.equal(await target.deleteByExecutionIntentIds({
    executionIntentIds: ['intent-1', 'intent-already-absent'],
  }), 1);
  assert.equal(repo.size(), 1);
  assert.equal(await target.find({ resultId: first.resultId }), null);
  assert.equal((await target.find({ resultId: second.resultId })).resultId, second.resultId);
  assert.equal(await target.deleteByExecutionIntentIds({
    executionIntentIds: ['intent-already-absent'],
  }), 0, 'an absent ciphertext is already deleted');

  for (const invalidRequest of [
    ['intent-2'],
    { executionIntentIds: ['intent-2'], extra: true },
    { executionIntentIds: Array.from({ length: 17 }, (_, index) => `intent-${index + 1}`) },
    { executionIntentIds: [' intent-2'] },
    { executionIntentIds: ['sk-' + 'a'.repeat(32)] },
  ]) {
    await assert.rejects(
      target.deleteByExecutionIntentIds(invalidRequest),
      isEscrowError('SS_ERP_BYOK_RESULT_ESCROW_INVALID'),
    );
  }
  assert.equal(repo.size(), 1);
});

test('execution-intent deletion prunes first and fails closed when durable deletion fails', async () => {
  let now = NOW;
  const repo = repository();
  const target = store({
    repository: repo,
    now: () => now,
    randomValues: randomValues(80),
  });
  await target.ready();
  const staged = await stage(target, await input());
  now += api.MAX_TTL_MS;
  repo.failNextDelete();

  await assert.rejects(
    target.deleteByExecutionIntentIds({ executionIntentIds: ['intent-1'] }),
    isEscrowError('SS_ERP_BYOK_RESULT_ESCROW_UNAVAILABLE'),
  );
  assert.equal(repo.size(), 1);
  assert.equal(repo.events.filter((event) => event[0] === 'delete').length, 1);
  assert.equal(repo.get(staged.resultId).resultId, staged.resultId);
});

test('delete failure is final and never reports retained ciphertext as removed', async () => {
  const repo = repository();
  const target = store({ repository: repo, randomValues: randomValues(90) });
  await target.ready();
  const staged = await stage(target, await input());
  repo.failNextDelete();
  await assert.rejects(
    target.delete(staged.resultId),
    isEscrowError('SS_ERP_BYOK_RESULT_ESCROW_UNAVAILABLE'),
  );
  assert.equal(repo.size(), 1);
  assert.equal((await target.find({ resultId: staged.resultId })).resultId, staged.resultId);
});
