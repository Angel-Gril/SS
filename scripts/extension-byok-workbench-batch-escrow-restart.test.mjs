import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const MODULES = [
  'extensions/ss-erp/shared/contracts/ai-image-workbench-v1.js',
  'extensions/ss-erp/shared/byok/device-session-lifecycle.js',
  'extensions/ss-erp/shared/byok/generated-result-vault-persistence.js',
  'extensions/ss-erp/shared/byok/generated-result-vault.js',
  'extensions/ss-erp/shared/byok/media-job-engine.js',
  'extensions/ss-erp/shared/byok/workbench-batch-coordinator.js',
];

const START_MILLIS = Date.parse('2026-08-03T10:00:00.000Z');
const PROVIDER_ORIGIN = 'https://provider.example';
const MODEL = 'fixture-image-model';
const POLICY_REVISION = '734';
const EXECUTION_INTENT_ID = 'intent-escrow-restart-1';
const PROVIDER_OPERATION_KEY = 'provider-escrow-restart-0001';
const SLOT_KEY = 'sku:sku-1:hero';

function clone(value) {
  return structuredClone(value);
}

function loadApis() {
  const context = vm.createContext({
    Array,
    ArrayBuffer,
    Blob,
    Boolean,
    DataView,
    Date,
    Error,
    JSON,
    Map,
    Math,
    Number,
    Object,
    Promise,
    RegExp,
    Set,
    String,
    TextDecoder,
    TextEncoder,
    TypeError,
    URL,
    Uint8Array,
    crypto: webcrypto,
  });
  context.globalThis = context;
  context.self = context;
  for (const modulePath of MODULES) {
    vm.runInContext(readFileSync(modulePath, 'utf8'), context, { filename: modulePath });
  }
  return {
    lifecycle: context.SS_ERP_BYOK_DEVICE_SESSION_LIFECYCLE,
    persistence: context.SS_ERP_BYOK_GENERATED_RESULT_VAULT_PERSISTENCE,
    vault: context.SS_ERP_BYOK_GENERATED_RESULT_VAULT,
    engine: context.SS_ERP_BYOK_MEDIA_JOB_ENGINE,
    coordinator: context.SS_ERP_BYOK_WORKBENCH_BATCH_COORDINATOR,
  };
}

function createLifecycle(api, sessionStorage, lockManager) {
  return api.createLifecycle({
    sessionStorage,
    credentials: {
      async claim() { return { state: 'paired' }; },
      async clear() { return { state: 'unpaired' }; },
      async clearIfCurrent() { return false; },
      async getAccessToken() { return 'token'; },
      async getStatus() {
        return { state: 'paired', ownerUserId: 'owner-1', sessionId: 'device-session-1' };
      },
      async getConnection() { return { baseUrl: 'https://erp.example' }; },
      async beginOperation() { return { state: 'paired' }; },
      async isOperationCurrent() { return true; },
    },
    lockManager,
    async clearByokState() {},
  });
}

function createLockManager() {
  let tail = Promise.resolve();
  return {
    request(_name, operation) {
      const next = tail.catch(() => {}).then(operation);
      tail = next.catch(() => {});
      return next;
    },
  };
}

function createRepository() {
  const rows = new Map();
  return {
    async ready() {},
    async list() { return [...rows.values()].map(clone); },
    async stage(row, limits) {
      const existing = [...rows.values()].find((candidate) => (
        candidate.resultId === row.resultId
        || candidate.executionIntentHash === row.executionIntentHash
        || candidate.operationKeyHash === row.operationKeyHash
      ));
      if (existing) {
        if (existing.identityHash !== row.identityHash) {
          const error = new Error('Escrow identity conflict');
          error.code = 'SS_ERP_BYOK_RESULT_ESCROW_CONFLICT';
          throw error;
        }
        return { kind: 'existing', record: clone(existing) };
      }
      const totalBytes = [...rows.values()].reduce((total, value) => (
        total + value.byteLength
      ), 0);
      if (rows.size + 1 > limits.maxEntries
        || totalBytes + row.byteLength > limits.maxTotalBytes) {
        const error = new Error('Escrow is full');
        error.code = 'SS_ERP_BYOK_RESULT_ESCROW_FULL';
        throw error;
      }
      rows.set(row.resultId, clone(row));
      return { kind: 'inserted', record: clone(row) };
    },
    async deleteMany(resultIds) {
      resultIds.forEach((resultId) => rows.delete(resultId));
    },
    async clear() { rows.clear(); },
    snapshot() { return [...rows.values()].map(clone); },
    size() { return rows.size; },
  };
}

function createSessionStorage() {
  const values = Object.create(null);
  return {
    async get(keys) {
      const result = {};
      for (const key of keys) {
        if (Object.hasOwn(values, key)) result[key] = clone(values[key]);
      }
      return result;
    },
    async set(patch) { Object.assign(values, clone(patch)); },
    async remove(keys) { keys.forEach((key) => delete values[key]); },
  };
}

function randomValues(seed) {
  let next = seed;
  return (bytes) => {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = next % 256;
      next += 1;
    }
    return bytes;
  };
}

function png() {
  return new Blob([
    new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x45, 0x53, 0x43, 0x52, 0x4f, 0x57, 0x2d, 0x31,
    ]),
  ], { type: 'image/png' });
}

async function sha256(value) {
  const bytes = typeof value === 'string'
    ? new TextEncoder().encode(value)
    : new Uint8Array(await value.arrayBuffer());
  const digest = await webcrypto.subtle.digest('SHA-256', bytes);
  return Buffer.from(digest).toString('hex');
}

function resultBinding(overrides = {}) {
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
    slotKey: SLOT_KEY,
    assignmentMode: 'APPEND',
    assignmentOrdinal: 0,
    providerOrigin: PROVIDER_ORIGIN,
    model: MODEL,
    operation: 'TEXT_TO_IMAGE',
    policyRevision: POLICY_REVISION,
    ...overrides,
  };
}

function lifecycleAuthority(epoch = 7) {
  return {
    contractVersion: 'extension-byok-device-session-lifecycle/v1',
    epoch,
  };
}

async function providerResult() {
  const blob = png();
  return {
    contractVersion: 'extension-byok-text-to-image-client/v1',
    outcome: 'SUCCEEDED',
    operation: 'TEXT_TO_IMAGE',
    requestMode: 'json',
    profileId: 'profile-1',
    profileIdentity: PROVIDER_ORIGIN + '/v1\u0000' + MODEL,
    providerOrigin: PROVIDER_ORIGIN,
    model: MODEL,
    policyRevision: POLICY_REVISION,
    executionIntentId: EXECUTION_INTENT_ID,
    idempotencyKey: PROVIDER_OPERATION_KEY,
    requestHash: 'a'.repeat(64),
    promptHash: 'b'.repeat(64),
    negativePromptHash: null,
    endpointHash: 'c'.repeat(64),
    providerRequestIdSha256: 'd'.repeat(64),
    acceptedAt: new Date(START_MILLIS).toISOString(),
    image: {
      blob,
      mimeType: blob.type,
      byteLength: blob.size,
      sha256: await sha256(blob),
    },
  };
}

function batchBinding(authority = lifecycleAuthority()) {
  return {
    contractVersion: 'extension-byok-workbench-batch-binding/v1',
    lifecycleAuthority: authority,
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
    providerOrigin: PROVIDER_ORIGIN,
    model: MODEL,
    policyRevision: POLICY_REVISION,
  };
}

function restoredSlot() {
  return {
    skuKey: 'sku-1',
    slotKey: SLOT_KEY,
    assignmentMode: 'APPEND',
    assignmentOrdinal: 0,
    operation: 'TEXT_TO_IMAGE',
  };
}

async function findExactCandidate(store, proof) {
  const candidate = await store.findByExecutionIntentId(proof.executionIntentId, {
    resultSha256: proof.resultSha256,
    binding: proof.binding,
  });
  if (!candidate) return null;
  const expectedLifecycle = proof.lifecycleAuthority;
  if (candidate.lifecycleAuthority.contractVersion !== expectedLifecycle.contractVersion
    || candidate.lifecycleAuthority.epoch !== expectedLifecycle.epoch) return null;
  return candidate;
}

function receiptFor(api, request, vault) {
  const entry = vault.getApprovedForBackground(request.resultIds[0]);
  const assetId = 'asset-escrow-restart-1';
  return {
    contractVersion: api.ATOMIC_BATCH_RECEIPT_VERSION,
    executionBatchId: request.executionBatchId,
    replayed: true,
    receiptId: 'receipt-escrow-restart-1',
    requestHash: '9'.repeat(64),
    sourceDraftRevision: request.draftRevision,
    sourceDraftVersion: request.draftVersion,
    boundDraftRevision: request.draftRevision + 1,
    boundDraftVersion: request.draftVersion + 1,
    erpAiChargeCents: 0,
    items: [{
      assetId,
      provenanceId: 'provenance-escrow-restart-1',
      executionIntentId: entry.executionIntentId,
      providerRequestHash: entry.requestHash,
      providerResultSha256: entry.sha256,
      normalizedSha256: '5'.repeat(64),
      mimeType: entry.mimeType,
      width: 1024,
      height: 1024,
      skuKey: entry.binding.skuKey,
      slotKey: entry.binding.slotKey,
      assignmentOrdinal: entry.binding.assignmentOrdinal,
      assignmentSha256: '6'.repeat(64),
      assignment: {
        scope: 'SKU',
        skuKey: entry.binding.skuKey,
        slotKey: entry.binding.slotKey,
        assetId,
        source: 'GENERATED',
      },
      policyRevision: entry.policyRevision,
    }],
  };
}

test('restores encrypted candidate across workers for review and atomic ingest recovery', async () => {
  const apis = loadApis();
  const repository = createRepository();
  const sessionStorage = createSessionStorage();
  let now = START_MILLIS;
  const result = await providerResult();
  const binding = resultBinding();
  const authorityLockManager = createLockManager();
  const lifecycleA = createLifecycle(apis.lifecycle, sessionStorage, authorityLockManager);
  await lifecycleA.claim({ code: 'worker-a-device-claim' });
  const authority = await lifecycleA.captureAuthority();
  assert.equal(authority.epoch, 1);

  const workerA = apis.persistence.createStore({
    repository,
    sessionStorage,
    crypto: webcrypto,
    now: () => now,
    randomValues: randomValues(1),
  });
  const staged = await workerA.stage(result, binding, authority);
  const originalExpiry = staged.expiresAtMillis;
  assert.equal(originalExpiry, START_MILLIS + apis.persistence.MAX_TTL_MS);
  assert.match(staged.resultId, /^br_[a-f0-9]{48}$/u);

  const [envelope] = repository.snapshot();
  assert.deepEqual(Object.keys(envelope).sort(), [
    'byteLength', 'ciphertext', 'contractVersion', 'executionIntentHash',
    'expiresAtMillis', 'identityHash', 'iv', 'keyId', 'operationKeyHash', 'resultId',
  ]);
  const serializedEnvelope = JSON.stringify(envelope);
  for (const plaintext of [
    EXECUTION_INTENT_ID, PROVIDER_ORIGIN, result.image.sha256,
    binding.ownerUserId, binding.shopId,
  ]) assert.equal(serializedEnvelope.includes(plaintext), false);

  now += 60_000;
  const workerB = apis.persistence.createStore({
    repository,
    sessionStorage,
    crypto: webcrypto,
    now: () => now,
    randomValues: randomValues(160),
  });
  await workerB.ready();
  const lifecycleB = createLifecycle(apis.lifecycle, sessionStorage, authorityLockManager);
  const restoredAuthority = await lifecycleB.captureAuthority();
  assert.equal(restoredAuthority.epoch, authority.epoch);
  assert.equal(await lifecycleB.isAuthorityCurrent(authority), true);

  const mismatchVault = apis.vault.createVault({ now: () => new Date(now) });
  assert.equal(await findExactCandidate(workerB, {
    executionIntentId: EXECUTION_INTENT_ID,
    resultSha256: '0'.repeat(64),
    binding,
    lifecycleAuthority: authority,
  }), null, 'a result hash mismatch must fail before vault hydration');
  assert.equal(await findExactCandidate(workerB, {
    executionIntentId: EXECUTION_INTENT_ID,
    resultSha256: result.image.sha256,
    binding: { ...binding, shopId: 'shop-other' },
    lifecycleAuthority: authority,
  }), null, 'a binding mismatch must fail before vault hydration');
  assert.equal(await findExactCandidate(workerB, {
    executionIntentId: EXECUTION_INTENT_ID,
    resultSha256: result.image.sha256,
    binding,
    lifecycleAuthority: lifecycleAuthority(authority.epoch + 1),
  }), null, 'a lifecycle mismatch must fail before vault hydration');
  assert.equal(mismatchVault.size(), 0);

  const recoveredCandidate = await findExactCandidate(workerB, {
    executionIntentId: EXECUTION_INTENT_ID,
    resultSha256: result.image.sha256,
    binding,
    lifecycleAuthority: restoredAuthority,
  });
  assert.ok(recoveredCandidate);
  assert.equal(recoveredCandidate.resultId, staged.resultId);
  assert.equal(recoveredCandidate.expiresAtMillis, originalExpiry);

  const freshVault = apis.vault.createVault({ now: () => new Date(now) });
  const restored = freshVault.restore(recoveredCandidate);
  assert.equal(restored.resultId, staged.resultId);
  assert.equal(restored.expiresAt, new Date(originalExpiry).toISOString());
  const preview = freshVault.getForBackground(restored.resultId);
  assert.equal(preview.resultId, staged.resultId);
  assert.equal(preview.blob instanceof Blob, true);
  assert.deepEqual(
    new Uint8Array(await preview.blob.arrayBuffer()),
    new Uint8Array(await result.image.blob.arrayBuffer()),
  );

  let providerDispatches = 0;
  let dispatchInputReads = 0;
  let ingestCalls = 0;
  let recoverCalls = 0;
  const providerExecutor = {
    async execute() {
      providerDispatches += 1;
      throw new Error('A restored review-only batch must never dispatch Provider work');
    },
  };
  const atomicBatchIngest = {
    async ingest() {
      ingestCalls += 1;
      const error = new Error('ERP response lost after atomic ingest dispatch');
      error.code = 'ERP_BATCH_TIMEOUT';
      error.outcome = 'UNKNOWN_OUTCOME';
      throw error;
    },
    async recover(request) {
      recoverCalls += 1;
      return receiptFor(apis.coordinator, request, freshVault);
    },
  };
  const coordinator = apis.coordinator.createCoordinator({
    mediaJobEngine: apis.engine,
    providerExecutor,
    resultVault: freshVault,
    atomicBatchIngest,
    requestedConcurrency: 1,
    concurrencyAuthority: {
      ownerUserId: 'owner-1',
      deviceSessionId: 'device-session-1',
      policyRevision: POLICY_REVISION,
      maxConcurrency: 1,
      expiresAt: new Date(originalExpiry).toISOString(),
    },
    runnerMaxConcurrency: 1,
    async resolveDispatchInput() {
      dispatchInputReads += 1;
      throw new Error('Review-only recovery must not load Provider credentials');
    },
    async resolveRecovery() {
      throw new Error('Review-only recovery must not call Provider lookup');
    },
  });
  const attempt = {
    attemptId: 'attempt-escrow-restart-1',
    slotKey: SLOT_KEY,
    generation: 1,
    operation: 'TEXT_TO_IMAGE',
    idempotencyKey: PROVIDER_OPERATION_KEY,
    intentHash: await sha256(EXECUTION_INTENT_ID),
    providerRequestHash: result.requestHash,
    candidateId: 'candidate-escrow-restart-1',
    resultHandle: staged.resultId,
    resultSha256: result.image.sha256,
  };
  let projection = coordinator.restoreBatch({
    contractVersion: apis.coordinator.RESTORE_COMMAND_VERSION,
    batchId: 'batch-escrow-restart-1',
    binding: batchBinding(restoredAuthority),
    slots: [restoredSlot()],
    attempts: [attempt],
  });
  assert.equal(projection.scheduler.state, 'REVIEW');
  assert.equal(projection.slots[0].attempts[0].resultId, staged.resultId);
  assert.equal(providerDispatches, 0);
  assert.equal(dispatchInputReads, 0);

  projection = coordinator.keepAttempt(SLOT_KEY, attempt.attemptId);
  assert.equal(projection.slots[0].selectedAttemptId, attempt.attemptId);
  const ingestCommand = {
    contractVersion: apis.coordinator.INGEST_COMMAND_VERSION,
    idempotencyKey: 'ingest-escrow-restart-0001',
  };
  await assert.rejects(
    coordinator.ingestSelectedBatch(ingestCommand),
    (error) => error?.outcome === 'UNKNOWN_OUTCOME',
  );
  projection = await coordinator.recoverIngest(ingestCommand);
  assert.equal(projection.ingest.state, 'SUCCEEDED');
  assert.equal(projection.ingest.replayed, true);
  assert.equal(ingestCalls, 1);
  assert.equal(recoverCalls, 1);
  assert.equal(providerDispatches, 0);
  assert.equal(dispatchInputReads, 0);

  now = originalExpiry;
  assert.equal(freshVault.size(), 0, 'memory restoration must retain the original hard TTL');
  assert.equal(await workerB.find({ resultId: staged.resultId }), null,
    'encrypted escrow must expire at the original deadline after restart');
  assert.equal(repository.size(), 0);
  coordinator.dispose();
});

test('a fresh worker durably deletes an unhydrated candidate by execution intent ID', async () => {
  const apis = loadApis();
  const repository = createRepository();
  const sessionStorage = createSessionStorage();
  const result = await providerResult();
  const binding = resultBinding();
  const authority = lifecycleAuthority();
  const workerA = apis.persistence.createStore({
    repository,
    sessionStorage,
    crypto: webcrypto,
    now: () => START_MILLIS,
    randomValues: randomValues(1),
  });
  const staged = await workerA.stage(result, binding, authority);

  const workerB = apis.persistence.createStore({
    repository,
    sessionStorage,
    crypto: webcrypto,
    now: () => START_MILLIS + 60_000,
    randomValues: randomValues(160),
  });
  assert.equal(await workerB.deleteByExecutionIntentIds({
    executionIntentIds: [EXECUTION_INTENT_ID],
  }), 1);
  assert.equal(repository.size(), 0);

  const workerC = apis.persistence.createStore({
    repository,
    sessionStorage,
    crypto: webcrypto,
    now: () => START_MILLIS + 120_000,
    randomValues: randomValues(200),
  });
  assert.equal(await workerC.find({ resultId: staged.resultId }), null);
  assert.equal(await workerC.deleteByExecutionIntentIds({
    executionIntentIds: [EXECUTION_INTENT_ID],
  }), 0, 'a missing record is already durably deleted');
});
