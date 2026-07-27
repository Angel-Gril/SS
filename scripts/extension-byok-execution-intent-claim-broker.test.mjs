import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const modulePath = 'extensions/ss-erp/shared/byok/execution-intent-claim-broker.js';

function loadApi() {
  const context = { Array, Boolean, Error, Map, Number, Object, Promise, Set, String, URL };
  context.globalThis = context;
  vm.runInNewContext(readFileSync(modulePath, 'utf8'), context, { filename: modulePath });
  return context.SS_ERP_BYOK_EXECUTION_INTENT_CLAIM_BROKER;
}

const HASH = 'a'.repeat(64);

function binding(overrides = {}) {
  return {
    contractVersion: 'extension-byok-readiness-binding/v2',
    ownerUserId: 'owner-1',
    deviceSessionId: 'session-1',
    shopId: 'shop-1',
    workflowId: 'workflow-1',
    draftRevision: 7,
    draftVersion: 11,
    sourcePlatform: '1688',
    sourceProductId: 'source-1',
    sourceCaptureSnapshotId: 'snapshot-1',
    supplyGoodsId: 'goods-1',
    skuKey: 'sku-1',
    slotKey: 'sku:sku-1:hero',
    assignmentMode: 'APPEND',
    assignmentOrdinal: 2,
    providerOrigin: 'https://provider.example',
    model: 'image-model-1',
    operation: 'TEXT_TO_IMAGE',
    policyRevision: '23',
    ...overrides,
  };
}

function claimInput(overrides = {}) {
  return {
    readinessBinding: binding(),
    requestMode: 'json',
    providerIdempotencyKey: 'provider-attempt-0001',
    providerRequestHash: HASH,
    ...overrides,
  };
}

function projection(overrides = {}) {
  return {
    contractVersion: 'extension-byok-execution-intent/v1',
    intentId: 'intent-1',
    replayed: false,
    executionMode: 'BYOK',
    outcome: 'PENDING',
    providerIdempotencyKey: 'provider-attempt-0001',
    providerRequestHash: HASH,
    context: {
      shopId: 'shop-1',
      workflowId: 'workflow-1',
      draftRevision: 7,
      draftVersion: 11,
      skuKey: 'sku-1',
      slotKey: 'sku:sku-1:hero',
    },
    ...overrides,
  };
}

function registration(overrides = {}) {
  return {
    executionBatchId: 'batch-1',
    claims: [{
      readinessBinding: binding(),
      requestMode: 'json',
      intent: projection(),
    }],
    ...overrides,
  };
}

function createFallback() {
  const calls = { claim: [], outcome: [] };
  return {
    calls,
    client: {
      async claim(value) {
        calls.claim.push(value);
        return { fallback: true };
      },
      async reportOutcome(value) {
        calls.outcome.push(value);
        return { reported: true };
      },
    },
  };
}

test('consumes an exact reserved intent once without issuing a second claim', async () => {
  const api = loadApi();
  const fallback = createFallback();
  const broker = api.createBroker({ fallback: fallback.client });
  assert.deepEqual(
    JSON.parse(JSON.stringify(broker.registerBatch(registration()))),
    { executionBatchId: 'batch-1', claimCount: 1 },
  );

  assert.deepEqual(
    JSON.parse(JSON.stringify(await broker.claim(claimInput()))),
    projection(),
  );
  assert.equal(fallback.calls.claim.length, 0);
  await assert.rejects(
    broker.claim(claimInput()),
    (error) => error && error.code === 'SS_ERP_BYOK_EXECUTION_INTENT_REPLAY_BLOCKED'
      && error.outcome === 'UNKNOWN_OUTCOME'
      && error.automaticRetryAllowed === false,
  );
  assert.equal(fallback.calls.claim.length, 0);
});

test('fails closed on a reserved identity mismatch and never falls back', async () => {
  const api = loadApi();
  const fallback = createFallback();
  const broker = api.createBroker({ fallback: fallback.client });
  broker.registerBatch(registration());

  await assert.rejects(
    broker.claim(claimInput({ readinessBinding: binding({ assignmentOrdinal: 3 }) })),
    (error) => error && error.code === 'SS_ERP_BYOK_EXECUTION_INTENT_RESERVATION_MISMATCH'
      && error.outcome === 'FAILED_FINAL',
  );
  assert.equal(fallback.calls.claim.length, 0);
  await assert.rejects(
    broker.claim(claimInput({ providerRequestHash: 'f'.repeat(64) })),
    (error) => error && error.code === 'SS_ERP_BYOK_EXECUTION_INTENT_RESERVATION_MISMATCH'
      && error.outcome === 'FAILED_FINAL',
  );
  await assert.rejects(
    broker.claim(claimInput({ providerIdempotencyKey: 'provider-attempt-forged' })),
    (error) => error && error.code === 'SS_ERP_BYOK_EXECUTION_INTENT_RESERVATION_MISMATCH'
      && error.outcome === 'FAILED_FINAL',
  );
  assert.equal(fallback.calls.claim.length, 0);
});

test('delegates unreserved single-image claims and all terminal outcome reports', async () => {
  const api = loadApi();
  const fallback = createFallback();
  const broker = api.createBroker({ fallback: fallback.client });
  assert.deepEqual(
    JSON.parse(JSON.stringify(await broker.claim(claimInput({
      providerIdempotencyKey: 'single-attempt-0001',
    })))),
    { fallback: true },
  );
  const outcome = {
    intentId: 'intent-1',
    providerIdempotencyKey: 'provider-attempt-0001',
    providerRequestHash: HASH,
    outcome: 'SUCCEEDED',
    providerRequestIdSha256: 'b'.repeat(64),
    resultSha256: 'c'.repeat(64),
  };
  assert.deepEqual(
    JSON.parse(JSON.stringify(await broker.reportOutcome(outcome))),
    { reported: true },
  );
  assert.deepEqual(fallback.calls.outcome, [outcome]);
});

test('rejects duplicate batch registration and clears only the named reservation', async () => {
  const api = loadApi();
  const fallback = createFallback();
  const broker = api.createBroker({ fallback: fallback.client });
  broker.registerBatch(registration());
  assert.throws(
    () => broker.registerBatch(registration()),
    (error) => error && error.code === 'SS_ERP_BYOK_EXECUTION_INTENT_RESERVATION_CONFLICT',
  );
  assert.equal(broker.releaseBatch('batch-1'), true);
  assert.equal(broker.releaseBatch('batch-1'), false);
  await broker.claim(claimInput());
  assert.equal(fallback.calls.claim.length, 1);
});

test('registers one exact successor under an existing batch before its Provider claim', async () => {
  const api = loadApi();
  const fallback = createFallback();
  const broker = api.createBroker({ fallback: fallback.client });
  broker.registerBatch({
    executionBatchId: 'batch-successor',
    claims: [{
      readinessBinding: binding(),
      requestMode: 'json',
      intent: projection(),
    }],
  });
  const successorBinding = binding({ assignmentOrdinal: 7 });
  const successorIntent = projection({
    intentId: 'intent-successor',
    providerIdempotencyKey: 'provider-attempt-successor',
    providerRequestHash: 'd'.repeat(64),
  });
  const registered = broker.registerAttempt({
    executionBatchId: 'batch-successor',
    readinessBinding: successorBinding,
    requestMode: 'json',
    intent: successorIntent,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(registered)), {
    executionBatchId: 'batch-successor',
    intentId: 'intent-successor',
    claimCount: 2,
  });
  const claimed = await broker.claim({
    readinessBinding: successorBinding,
    requestMode: 'json',
    providerIdempotencyKey: successorIntent.providerIdempotencyKey,
    providerRequestHash: successorIntent.providerRequestHash,
  });
  assert.equal(claimed.intentId, 'intent-successor');
  assert.equal(fallback.calls.claim.length, 0);
  assert.equal(broker.releaseBatch('batch-successor'), true);
  await broker.claim({
    readinessBinding: successorBinding,
    requestMode: 'json',
    providerIdempotencyKey: successorIntent.providerIdempotencyKey,
    providerRequestHash: successorIntent.providerRequestHash,
  });
  assert.equal(fallback.calls.claim.length, 1);
});
