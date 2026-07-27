import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const modulePath = 'extensions/ss-erp/shared/byok/workbench-batch-provider-executor.js';

function loadApi() {
  const context = { Array, Boolean, Error, JSON, Number, Object, Promise, Set, String, URL };
  context.globalThis = context;
  vm.runInNewContext(readFileSync(modulePath, 'utf8'), context, { filename: modulePath });
  return context.SS_ERP_BYOK_WORKBENCH_BATCH_PROVIDER_EXECUTOR;
}

function binding(overrides = {}) {
  return {
    contractVersion: 'extension-byok-readiness-binding/v2',
    ownerUserId: 'owner-1', deviceSessionId: 'session-1', shopId: 'shop-1',
    workflowId: 'workflow-1', draftRevision: 7, draftVersion: 11,
    sourcePlatform: '1688', sourceProductId: 'source-1',
    sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
    skuKey: 'sku-1', slotKey: 'sku:sku-1:hero', assignmentMode: 'APPEND',
    assignmentOrdinal: 17, providerOrigin: 'https://provider.example',
    model: 'image-model-1', operation: 'TEXT_TO_IMAGE', policyRevision: '23',
    ...overrides,
  };
}

function request(overrides = {}) {
  return {
    contractVersion: 'extension-byok-workbench-batch-provider-dispatch/v1',
    batchId: 'batch-1',
    resultBinding: binding(),
    attempt: {
      attemptId: 'attempt-1', slotKey: 'sku:sku-1:hero', generation: 1,
      operation: 'TEXT_TO_IMAGE', executionMode: 'BYOK', policyRevision: '23',
      idempotencyKey: 'provider-attempt-0001', intentHash: 'a'.repeat(64),
      retryOfAttemptId: null, retryRisk: null,
    },
    dispatchInput: {
      preparedRequestHandle: 'byok-prepared:11111111-1111-4111-8111-111111111111',
      executionIntentId: 'intent-1',
      providerRequestHash: 'b'.repeat(64),
    },
    markWaiting() { return true; },
    ...overrides,
  };
}

function createHarness(options = {}) {
  const events = [];
  const vaultEntries = new Map();
  const textClient = {
    async dispatchPrepared(handle) {
      events.push(['dispatch-text', handle]);
      latestGenerated = {
        outcome: 'SUCCEEDED', operation: 'TEXT_TO_IMAGE', requestMode: 'json',
        profileId: 'profile-1', providerOrigin: 'https://provider.example',
        model: 'image-model-1', policyRevision: '23',
        executionIntentId: 'intent-1', idempotencyKey: 'provider-attempt-0001',
        requestHash: 'b'.repeat(64), promptHash: 'c'.repeat(64), negativePromptHash: null,
        endpointHash: 'd'.repeat(64), providerRequestIdSha256: null,
        acceptedAt: '2026-07-28T03:00:00.000Z',
        image: { mimeType: 'image/png', byteLength: 4, sha256: 'e'.repeat(64), bytes: {} },
      };
      return latestGenerated;
    },
    releasePrepared(handle) {
      events.push(['release-prepared-text', handle]);
      return { released: true };
    },
    async commitResult(idempotencyKey, requestHash, commit) {
      events.push(['commit-text', idempotencyKey, requestHash]);
      return commit(latestGenerated);
    },
    releaseResult(idempotencyKey, requestHash) {
      events.push(['release-text', idempotencyKey, requestHash]);
      return true;
    },
  };
  let latestGenerated = null;
  const editClient = {
    async dispatchPrepared(handle) {
      events.push(['dispatch-edit', handle]);
      latestGenerated = {
        outcome: 'SUCCEEDED', operation: 'FULL_EDIT', requestMode: 'multipart',
        profileId: 'profile-1', providerOrigin: 'https://provider.example',
        model: 'image-model-1', policyRevision: '23',
        executionIntentId: 'intent-edit', idempotencyKey: 'provider-edit-attempt-0001',
        requestHash: '1'.repeat(64), promptHash: '2'.repeat(64), negativePromptHash: null,
        endpointHash: '3'.repeat(64), providerRequestIdSha256: null,
        sourceSha256: '4'.repeat(64), referenceSha256s: [], maskSha256: null,
        acceptedAt: '2026-07-28T03:00:00.000Z',
        image: { mimeType: 'image/png', byteLength: 4, sha256: '5'.repeat(64), bytes: {} },
      };
      return latestGenerated;
    },
    releasePrepared(handle) {
      events.push(['release-prepared-edit', handle]);
      return { released: true };
    },
    async commitResult(idempotencyKey, requestHash, commit) {
      events.push(['commit-edit', idempotencyKey, requestHash]);
      return commit(latestGenerated);
    },
    releaseResult(idempotencyKey, requestHash) {
      events.push(['release-edit', idempotencyKey, requestHash]);
      return true;
    },
  };
  const vault = {
    put(generated, exactBinding) {
      const resultId = generated.operation === 'TEXT_TO_IMAGE' ? 'result-text' : 'result-edit';
      vaultEntries.set(resultId, { generated, binding: exactBinding });
      return {
        resultId, outcome: 'SUCCEEDED', operation: generated.operation,
        idempotencyKey: generated.idempotencyKey, requestHash: generated.requestHash,
        reviewState: 'CANDIDATE_READY', image: { sha256: generated.image.sha256 },
      };
    },
    getPublic(resultId) {
      const entry = vaultEntries.get(resultId);
      return entry && {
        resultId, outcome: 'SUCCEEDED', operation: entry.generated.operation,
        idempotencyKey: entry.generated.idempotencyKey, requestHash: entry.generated.requestHash,
        reviewState: 'CANDIDATE_READY', image: { sha256: entry.generated.image.sha256 },
      };
    },
  };
  const authorityGuard = {
    async capture(exactBinding) {
      events.push(['capture', exactBinding.slotKey]);
      if (options.captureFailure) throw new Error('device authority is stale');
      return { lifecycleAuthority: { epoch: 9 } };
    },
    async commitGeneratedResult(input) {
      events.push(['authority-commit', input.binding.slotKey]);
      return input.vault.put(input.generated, input.binding, input.authority.lifecycleAuthority);
    },
  };
  const providerSemaphore = {
    async acquire(authority) {
      events.push(['lease', authority]);
      return { release() { events.push(['lease-release']); return true; } };
    },
  };
  const api = loadApi();
  const executor = api.createExecutor({
    textClient, editClient, authorityGuard, vault, providerSemaphore,
    ownerToken: 'workbench-tab:4:document:doc-1',
    concurrencyAuthority: {
      ownerUserId: 'owner-1', deviceSessionId: 'session-1', policyRevision: '23',
      maxConcurrency: 1, expiresAt: '2026-07-28T03:10:00.000Z',
    },
  });
  return { api, executor, events, vaultEntries };
}

test('executes text generation under one lease and commits only to the exact vault binding', async () => {
  const harness = createHarness();
  let waiting = 0;
  const result = await harness.executor.execute(request({
    markWaiting() { waiting += 1; return true; },
  }));
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    outcome: 'SUCCEEDED', candidateId: 'result-text', resultHandle: 'result-text',
    resultSha256: 'e'.repeat(64), requestHash: 'b'.repeat(64),
  });
  assert.equal(waiting, 1);
  assert.equal(harness.vaultEntries.get('result-text').binding.slotKey, 'sku:sku-1:hero');
  assert.equal(harness.events.filter((event) => event[0] === 'lease').length, 1);
  assert.ok(harness.events.findIndex((event) => event[0] === 'capture')
    < harness.events.findIndex((event) => event[0] === 'dispatch-text'));
  assert.equal(harness.events.filter((event) => event[0] === 'lease-release').length, 1);
  assert.equal(harness.events.filter((event) => event[0] === 'release-text').length, 1);
});

test('routes full edit through the edit client and preserves the reserved intent binding', async () => {
  const harness = createHarness();
  const editBinding = binding({ operation: 'FULL_EDIT' });
  const input = request({
    resultBinding: editBinding,
    attempt: {
      ...request().attempt, operation: 'FULL_EDIT', idempotencyKey: 'provider-edit-attempt-0001',
    },
    dispatchInput: {
      preparedRequestHandle: 'byok-prepared:22222222-2222-4222-8222-222222222222',
      executionIntentId: 'intent-edit',
      providerRequestHash: '1'.repeat(64),
    },
  });
  const result = await harness.executor.execute(input);
  assert.equal(result.resultHandle, 'result-edit');
  assert.equal(harness.events.filter((event) => event[0] === 'dispatch-edit').length, 1);
  assert.equal(harness.events.filter((event) => event[0] === 'release-edit').length, 1);
  assert.equal(harness.vaultEntries.get('result-edit').generated.executionIntentId, 'intent-edit');
});

test('rejects secret-bearing dispatch input and mismatched slot attempts before Provider I/O', async () => {
  const harness = createHarness();
  await assert.rejects(
    harness.executor.execute(request({ dispatchInput: { apiKey: 'sk-must-not-pass' } })),
    (error) => error && error.code === 'SS_ERP_BYOK_BATCH_PROVIDER_INPUT_INVALID',
  );
  await assert.rejects(
    harness.executor.execute(request({
      attempt: { ...request().attempt, slotKey: 'sku:other:hero' },
    })),
    (error) => error && error.code === 'SS_ERP_BYOK_BATCH_PROVIDER_INPUT_INVALID',
  );
  assert.equal(harness.events.length, 0);
});

test('absorbs a Provider result that does not match the exact reserved execution intent', async () => {
  const harness = createHarness();
  await assert.rejects(
    harness.executor.execute(request({
      dispatchInput: {
        ...request().dispatchInput,
        executionIntentId: 'different-intent',
      },
    })),
    (error) => error?.code === 'SS_ERP_BYOK_BATCH_PROVIDER_RESULT_INVALID'
      && error.outcome === 'UNKNOWN_OUTCOME'
      && error.automaticRetryAllowed === false,
  );
  assert.equal(harness.vaultEntries.size, 0);
  assert.equal(harness.events.filter((event) => event[0] === 'dispatch-text').length, 1);
});

test('releases an unconsumed prepared handle when the queued attempt becomes stale', async () => {
  const harness = createHarness();
  await assert.rejects(
    harness.executor.execute(request({ markWaiting() { return false; } })),
    (error) => error?.code === 'SS_ERP_BYOK_BATCH_PROVIDER_ATTEMPT_STALE',
  );
  assert.equal(harness.events.filter((event) => event[0] === 'dispatch-text').length, 0);
  assert.equal(
    harness.events.filter((event) => event[0] === 'release-prepared-text').length,
    1,
  );
});

test('revalidates device authority and releases preparation before any Provider dispatch', async () => {
  const harness = createHarness({ captureFailure: true });
  await assert.rejects(harness.executor.execute(request()), /device authority is stale/u);
  assert.equal(harness.events.filter((event) => event[0] === 'dispatch-text').length, 0);
  assert.equal(harness.events.filter((event) => event[0] === 'release-prepared-text').length, 1);
  assert.equal(harness.events.filter((event) => event[0] === 'lease-release').length, 1);
});
