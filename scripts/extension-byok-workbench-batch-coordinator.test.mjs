import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const contractPath = 'extensions/ss-erp/shared/contracts/ai-image-workbench-v1.js';
const enginePath = 'extensions/ss-erp/shared/byok/media-job-engine.js';
const coordinatorPath = 'extensions/ss-erp/shared/byok/workbench-batch-coordinator.js';
const CANONICAL_BINI_SKU_KEY = 'sku:5777037825166|晚霞肤(1.5cm+4cm胸垫)>M(适合34/75ABC)';
const CANONICAL_BINI_SLOT_KEY = `sku:${CANONICAL_BINI_SKU_KEY}:hero`;

function loadApi() {
  assert.equal(fs.existsSync(coordinatorPath), true, 'BYOK batch coordinator module is missing');
  const context = {
    Array, Blob, Boolean, Date, Error, JSON, Map, Math, Number, Object, Promise,
    RegExp, Set, String, TextEncoder, TypeError, URL, Uint8Array,
  };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(contractPath, 'utf8'), context, { filename: contractPath });
  vm.runInNewContext(fs.readFileSync(enginePath, 'utf8'), context, { filename: enginePath });
  vm.runInNewContext(fs.readFileSync(coordinatorPath, 'utf8'), context, {
    filename: coordinatorPath,
  });
  return {
    coordinator: context.SS_ERP_BYOK_WORKBENCH_BATCH_COORDINATOR,
    engine: context.SS_ERP_BYOK_MEDIA_JOB_ENGINE,
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  return { promise, resolve, reject };
}

function binding(overrides = {}) {
  return {
    contractVersion: 'extension-byok-workbench-batch-binding/v1',
    lifecycleAuthority: {
      contractVersion: 'extension-byok-device-session-lifecycle/v1', epoch: 9,
    },
    ownerUserId: 'owner-1',
    deviceSessionId: 'device-session-1',
    shopId: 'shop-1',
    workflowId: 'workflow-1',
    draftRevision: 7,
    draftVersion: 11,
    sourcePlatform: '1688',
    sourceProductId: 'source-product-1',
    sourceCaptureSnapshotId: 'snapshot-1',
    supplyGoodsId: 'goods-1',
    skuKey: 'sku-red',
    providerOrigin: 'https://provider.example',
    model: 'image-model-v1',
    policyRevision: '734',
    ...overrides,
  };
}

function slot(index, overrides = {}) {
  const ordinal = 17 + index;
  const detailRoles = ['SCENE', 'DETAIL', 'SPEC', 'PACKAGING'];
  return {
    skuKey: 'sku-red',
    slotKey: index === 0 ? 'sku:sku-red:hero' : `shared:detail:${detailRoles[index - 1]}`,
    assignmentMode: 'APPEND',
    assignmentOrdinal: ordinal,
    operation: 'TEXT_TO_IMAGE',
    idempotencyKey: `provider-attempt-${index + 1}`,
    intentHash: String.fromCharCode(97 + index).repeat(64),
    dispatchRef: `dispatch-${index + 1}`,
    ...overrides,
  };
}

function engineJob(index, overrides = {}) {
  const input = slot(index, overrides);
  return {
    slotKey: input.slotKey,
    operation: input.operation,
    idempotencyKey: input.idempotencyKey,
    intentHash: input.intentHash,
    dispatchRef: input.dispatchRef,
  };
}

function batchInput(count = 2, overrides = {}) {
  return {
    contractVersion: 'extension-byok-workbench-batch-start/v1',
    batchId: 'batch-1',
    binding: binding(),
    slots: Array.from({ length: count }, (_, index) => slot(index)),
    ...overrides,
  };
}

function restoredSlot(value) {
  return {
    skuKey: value.skuKey,
    slotKey: value.slotKey,
    assignmentMode: value.assignmentMode,
    assignmentOrdinal: value.assignmentOrdinal,
    operation: value.operation,
  };
}

function restoredResultBinding(batchBinding, selectedSlot) {
  return {
    contractVersion: 'extension-byok-readiness-binding/v2',
    ownerUserId: batchBinding.ownerUserId,
    deviceSessionId: batchBinding.deviceSessionId,
    shopId: batchBinding.shopId,
    workflowId: batchBinding.workflowId,
    draftRevision: batchBinding.draftRevision,
    draftVersion: batchBinding.draftVersion,
    sourcePlatform: batchBinding.sourcePlatform,
    sourceProductId: batchBinding.sourceProductId,
    sourceCaptureSnapshotId: batchBinding.sourceCaptureSnapshotId,
    supplyGoodsId: batchBinding.supplyGoodsId,
    skuKey: selectedSlot.skuKey,
    slotKey: selectedSlot.slotKey,
    assignmentMode: 'APPEND',
    assignmentOrdinal: selectedSlot.assignmentOrdinal,
    providerOrigin: batchBinding.providerOrigin,
    model: batchBinding.model,
    operation: selectedSlot.operation,
    policyRevision: batchBinding.policyRevision,
  };
}

function seedRestoredAttempt(harness, batchBinding, selectedSlot, {
  attemptId, generation, idempotencyKey, intentHash, candidateId,
}) {
  const stored = harness.vault.store({
    attempt: {
      attemptId,
      operation: selectedSlot.operation,
      idempotencyKey,
    },
  }, restoredResultBinding(batchBinding, selectedSlot));
  return {
    attemptId,
    slotKey: selectedSlot.slotKey,
    generation,
    operation: selectedSlot.operation,
    idempotencyKey,
    intentHash,
    providerRequestHash: stored.requestHash,
    candidateId,
    resultHandle: stored.resultId,
    resultSha256: stored.sha256,
  };
}

function createVault() {
  const entries = new Map();
  const rejected = [];
  const pins = [];
  let resultNumber = 0;

  function requireEntry(resultId) {
    const entry = entries.get(resultId);
    if (!entry) {
      const error = new Error('result missing');
      error.code = 'SS_ERP_BYOK_RESULT_NOT_FOUND';
      throw error;
    }
    return entry;
  }

  function publicResult(entry) {
    return {
      contractVersion: 'extension-byok-result-vault/v1',
      resultId: entry.resultId,
      outcome: 'SUCCEEDED',
      operation: entry.operation,
      requestMode: 'json',
      model: entry.model,
      policyRevision: entry.policyRevision,
      idempotencyKey: entry.idempotencyKey,
      requestHash: entry.requestHash,
      promptHash: 'c'.repeat(64),
      acceptedAt: '2026-07-28T00:00:00.000Z',
      reviewState: entry.reviewState,
      reviewedAt: entry.reviewedAt,
      expiresAt: '2026-07-28T00:10:00.000Z',
      image: {
        mimeType: 'image/png',
        byteLength: entry.blob.size,
        sha256: entry.sha256,
      },
    };
  }

  return {
    entries,
    rejected,
    pins,
    store(input, resultBinding) {
      resultNumber += 1;
      const resultId = `result-${input.attempt.attemptId}`;
      const sha256 = String((resultNumber % 9) + 1).repeat(64);
      const requestHash = ['a', 'b', 'c', 'd', 'e', 'f'][resultNumber % 6].repeat(64);
      entries.set(resultId, {
        resultId,
        operation: input.attempt.operation,
        model: resultBinding.model,
        policyRevision: resultBinding.policyRevision,
        idempotencyKey: input.attempt.idempotencyKey,
        executionIntentId: `intent-${input.attempt.attemptId}`,
        requestHash,
        sha256,
        binding: plain(resultBinding),
        reviewState: 'CANDIDATE_READY',
        reviewedAt: null,
        blob: new Blob([`private-${resultId}`], { type: 'image/png' }),
        providerResultUrl: `https://provider.example/results/${resultId}`,
        apiKey: 'sk-private-must-never-project',
      });
      return { resultId, sha256, requestHash };
    },
    getPublic(resultId) {
      return publicResult(requireEntry(resultId));
    },
    getApprovedForBackground(resultId) {
      const entry = requireEntry(resultId);
      if (entry.reviewState !== 'APPROVED') throw new Error('approval required');
      return entry;
    },
    pinSelection(resultId) {
      requireEntry(resultId).pinned = true;
      pins.push(`pin:${resultId}`);
      return true;
    },
    unpinSelection(resultId) {
      const entry = entries.get(resultId);
      if (entry) entry.pinned = false;
      pins.push(`unpin:${resultId}`);
      return true;
    },
    approve(resultId, resultBinding) {
      const entry = requireEntry(resultId);
      assert.deepEqual(entry.binding, plain(resultBinding), 'approval must use the exact result binding');
      entry.reviewState = 'APPROVED';
      entry.reviewedAt = '2026-07-28T00:01:00.000Z';
      return publicResult(entry);
    },
    reject(resultId, resultBinding) {
      const entry = requireEntry(resultId);
      assert.deepEqual(entry.binding, plain(resultBinding), 'rejection must use the exact result binding');
      rejected.push(resultId);
      entries.delete(resultId);
      return { resultId, reviewState: 'REJECTED' };
    },
  };
}

function receiptFor(api, request, vault, overrides = {}) {
  const items = request.resultIds.map((resultId, index) => {
    const result = vault.entries.get(resultId);
    const assignment = result.binding.slotKey === `sku:${result.binding.skuKey}:hero`
      ? {
        scope: 'SKU', skuKey: result.binding.skuKey, slotKey: result.binding.slotKey,
        assetId: `asset-${index + 1}`, source: 'GENERATED',
      }
      : {
        scope: 'PRODUCT', slotKey: result.binding.slotKey,
        assetId: `asset-${index + 1}`, source: 'GENERATED',
      };
    return {
    assetId: `asset-${index + 1}`,
    provenanceId: `provenance-${index + 1}`,
    executionIntentId: result.executionIntentId,
    providerRequestHash: result.requestHash,
    providerResultSha256: result.sha256,
    normalizedSha256: ['1', '2', '3', '4'][index].repeat(64),
    mimeType: 'image/png',
    width: 1024,
    height: 1024,
    skuKey: result.binding.skuKey,
    slotKey: result.binding.slotKey,
    assignmentOrdinal: result.binding.assignmentOrdinal,
    assignmentSha256: String(index + 5).repeat(64),
    assignment,
    policyRevision: result.binding.policyRevision,
  };
  });
  return {
    contractVersion: api.ATOMIC_BATCH_RECEIPT_VERSION,
    executionBatchId: request.executionBatchId,
    replayed: false,
    receiptId: 'batch-receipt-1',
    requestHash: '9'.repeat(64),
    sourceDraftRevision: request.draftRevision,
    sourceDraftVersion: request.draftVersion,
    boundDraftRevision: request.draftRevision + 1,
    boundDraftVersion: request.draftVersion + 1,
    erpAiChargeCents: 0,
    items,
    ...overrides,
  };
}

function createHarness({
  providerBehavior,
  providerYield = false,
  atomicBehavior,
  requestedConcurrency = 1,
  runnerMaxConcurrency = 4,
  concurrencyAuthority = {
    ownerUserId: 'owner-1',
    deviceSessionId: 'device-session-1',
    policyRevision: '734',
    maxConcurrency: 4,
    expiresAt: '2026-07-28T00:10:00.000Z',
  },
  resolveRecovery = async () => { throw new Error('no recovery fixture'); },
} = {}) {
  const loaded = loadApi();
  const vault = createVault();
  const providerCalls = [];
  let providerActive = 0;
  let providerMaxActive = 0;
  const ingestCalls = [];
  const recoverCalls = [];
  let coordinator;
  const providerExecutor = {
    async execute(input) {
      providerCalls.push(input);
      providerActive += 1;
      providerMaxActive = Math.max(providerMaxActive, providerActive);
      try {
        if (providerYield) await tick();
        if (providerBehavior) return providerBehavior(input, vault, loaded.coordinator);
        const stored = vault.store(input, input.resultBinding);
        return {
          outcome: 'SUCCEEDED',
          candidateId: `candidate-${input.attempt.attemptId}`,
          resultHandle: stored.resultId,
          resultSha256: stored.sha256,
          requestHash: stored.requestHash,
        };
      } finally {
        providerActive -= 1;
      }
    },
  };
  const atomicBatchIngest = {
    async ingest(request, runtimeAuthority) {
      ingestCalls.push({ request, runtimeAuthority });
      if (atomicBehavior) {
        return atomicBehavior(request, loaded.coordinator, vault, runtimeAuthority);
      }
      return receiptFor(loaded.coordinator, request, vault);
    },
    async recover(request, runtimeAuthority) {
      recoverCalls.push({ request, runtimeAuthority });
      if (atomicBehavior) {
        return atomicBehavior(request, loaded.coordinator, vault, runtimeAuthority, true);
      }
      return receiptFor(loaded.coordinator, request, vault, { replayed: true });
    },
  };
  coordinator = loaded.coordinator.createCoordinator({
    mediaJobEngine: loaded.engine,
    providerExecutor,
    resultVault: vault,
    atomicBatchIngest,
    requestedConcurrency,
    concurrencyAuthority,
    runnerMaxConcurrency,
    resolveDispatchInput: async (dispatchRef) => ({
      dispatchRef,
      apiKey: 'sk-private-dispatch-key',
      resultUrl: 'https://provider.example/private-result',
    }),
    resolveRecovery,
  });
  return {
    api: loaded.coordinator,
    coordinator,
    vault,
    providerCalls,
    get providerMaxActive() { return providerMaxActive; },
    ingestCalls,
    recoverCalls,
  };
}

function attemptFor(projection, slotKey, generation = 1) {
  const projectedSlot = projection.slots.find((item) => item.slotKey === slotKey);
  return projectedSlot.attempts.find((item) => item.generation === generation);
}

test('dispatches four selected slots serially through the background engine and redacts projections', async () => {
  const harness = createHarness({ providerYield: true });
  harness.coordinator.startBatch(batchInput(4));
  await harness.coordinator.whenSettled();

  assert.equal(harness.providerCalls.length, 4);
  assert.equal(harness.providerMaxActive, 1);
  assert.ok(harness.providerCalls.every((call) => (
    call.contractVersion === harness.api.PROVIDER_DISPATCH_VERSION
      && call.batchId === 'batch-1'
      && call.resultBinding.shopId === 'shop-1'
      && call.resultBinding.workflowId === 'workflow-1'
      && call.resultBinding.draftRevision === 7
      && call.resultBinding.draftVersion === 11
      && call.resultBinding.skuKey === 'sku-red'
      && call.resultBinding.assignmentOrdinal >= 17
      && call.dispatchInput.apiKey === 'sk-private-dispatch-key'
  )));

  const projection = harness.coordinator.getProjection();
  assert.equal(projection.contractVersion, harness.api.CONTRACT_VERSION);
  assert.equal(projection.executionMode, 'BYOK');
  assert.equal(projection.slots.length, 4);
  assert.ok(projection.slots.every((item) => item.state === 'CANDIDATE_READY'));
  assert.equal(projection.billing.erpGenerationChargeCents, 0);
  assert.deepEqual(plain(projection.binding), {
    shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 7, draftVersion: 11,
    skuKey: 'sku-red',
  });
  const serialized = JSON.stringify(projection).toLowerCase();
  for (const forbidden of [
    'sk-private', 'apikey', 'authorization', 'https://', 'provider.example',
    'resulturl', 'blob', 'base64', 'data:image', 'private-result',
  ]) assert.equal(serialized.includes(forbidden), false, forbidden);
  assert.equal(Object.isFrozen(projection), true);

  for (const invalid of [
    batchInput(5),
    batchInput(2, { slots: [slot(0), slot(0, { idempotencyKey: 'other-attempt' })] }),
    batchInput(2, { slots: [slot(0), slot(1, { assignmentOrdinal: 19 })] }),
    batchInput(2, { slots: [slot(0), slot(1, { assignmentOrdinal: 16 })] }),
    batchInput(1, { slots: [slot(0, { slotKey: 'sku:sku-red:detail-unsupported' })] }),
    batchInput(1, { binding: binding({ shopId: 'shop-other' }), unexpected: true }),
  ]) {
    const isolated = createHarness();
    assert.throws(
      () => isolated.coordinator.startBatch(invalid),
      (error) => error?.code === 'SS_ERP_BYOK_BATCH_INPUT_INVALID',
    );
    assert.equal(isolated.providerCalls.length, 0);
  }
});

test('accepts the canonical Unicode SKU hero slot while keeping opaque identifiers ASCII-only', async () => {
  const harness = createHarness();
  harness.coordinator.startBatch(batchInput(1, {
    binding: binding({ skuKey: CANONICAL_BINI_SKU_KEY }),
    slots: [slot(0, {
      skuKey: CANONICAL_BINI_SKU_KEY,
      slotKey: CANONICAL_BINI_SLOT_KEY,
    })],
  }));
  await harness.coordinator.whenSettled();
  assert.equal(harness.providerCalls[0].resultBinding.slotKey, CANONICAL_BINI_SLOT_KEY);
  assert.equal(harness.coordinator.getProjection().slots[0].slotKey, CANONICAL_BINI_SLOT_KEY);
  assert.throws(
    () => createHarness().coordinator.startBatch(batchInput(1, {
      slots: [slot(0, { idempotencyKey: '凭据-1' })],
    })),
    (error) => error?.code === 'SS_ERP_BYOK_BATCH_INPUT_INVALID',
  );
});

test('rejects requested concurrency two through four at the coordinator boundary', () => {
  for (const requestedConcurrency of [2, 3, 4]) {
    assert.throws(
      () => createHarness({ requestedConcurrency }),
      (error) => error?.code === 'SS_ERP_BYOK_BATCH_INPUT_INVALID'
        && error?.outcome === 'FAILED_FINAL',
    );
  }
});

test('binds two SKU hero slots and one shared detail to their exact per-slot SKU', async () => {
  const harness = createHarness();
  harness.coordinator.startBatch(batchInput(3, {
    slots: [
      slot(0),
      slot(1, { skuKey: 'sku-blue', slotKey: 'sku:sku-blue:hero' }),
      slot(2, { slotKey: 'shared:detail:DETAIL' }),
    ],
  }));
  await harness.coordinator.whenSettled();
  assert.deepEqual(
    harness.providerCalls.map((call) => [
      call.resultBinding.skuKey,
      call.resultBinding.slotKey,
      call.resultBinding.assignmentOrdinal,
    ]),
    [
      ['sku-red', 'sku:sku-red:hero', 17],
      ['sku-blue', 'sku:sku-blue:hero', 18],
      ['sku-red', 'shared:detail:DETAIL', 19],
    ],
  );
  assert.deepEqual(
    plain(harness.coordinator.getProjection().slots.map((item) => ({
      skuKey: item.skuKey,
      slotKey: item.slotKey,
    }))),
    [
      { skuKey: 'sku-red', slotKey: 'sku:sku-red:hero' },
      { skuKey: 'sku-blue', slotKey: 'sku:sku-blue:hero' },
      { skuKey: 'sku-red', slotKey: 'shared:detail:DETAIL' },
    ],
  );
});

test('delegates pause, continue, and queued cancellation deterministically', async () => {
  const controls = [];
  const harness = createHarness({
    runnerMaxConcurrency: 1,
    providerBehavior(input, vault) {
      const control = deferred();
      controls.push({ input, vault, control });
      return control.promise;
    },
  });
  harness.coordinator.startBatch(batchInput(3));
  await tick();
  let projection = harness.coordinator.pause();
  assert.equal(projection.scheduler.state, 'PAUSING');
  assert.equal(harness.providerCalls.length, 1);

  const thirdAttempt = attemptFor(projection, slot(2).slotKey);
  const cancelled = harness.coordinator.cancelQueued(thirdAttempt.attemptId);
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.attemptId, thirdAttempt.attemptId);

  const first = controls[0];
  const storedFirst = first.vault.store(first.input, first.input.resultBinding);
  first.control.resolve({
    outcome: 'SUCCEEDED', candidateId: 'candidate-pause-1',
    resultHandle: storedFirst.resultId, resultSha256: storedFirst.sha256,
    requestHash: storedFirst.requestHash,
  });
  await harness.coordinator.whenSettled();
  projection = harness.coordinator.getProjection();
  assert.equal(projection.scheduler.state, 'PAUSED');
  assert.equal(harness.providerCalls.length, 1);

  projection = harness.coordinator.continue();
  assert.equal(projection.scheduler.state, 'RUNNING');
  await tick();
  assert.equal(harness.providerCalls.length, 2);
  const second = controls[1];
  const storedSecond = second.vault.store(second.input, second.input.resultBinding);
  second.control.resolve({
    outcome: 'SUCCEEDED', candidateId: 'candidate-pause-2',
    resultHandle: storedSecond.resultId, resultSha256: storedSecond.sha256,
    requestHash: storedSecond.requestHash,
  });
  await harness.coordinator.whenSettled();
  projection = harness.coordinator.getProjection();
  assert.equal(projection.scheduler.state, 'REVIEW');
  assert.equal(attemptFor(projection, slot(2).slotKey).state, 'CANCELLED');
});

test('keeps reviewed alternatives, excludes rejected attempts, and atomically ingests every selected result once', async () => {
  const harness = createHarness();
  harness.coordinator.startBatch(batchInput(2));
  await harness.coordinator.whenSettled();
  let projection = harness.coordinator.getProjection();
  const firstHero = attemptFor(projection, slot(0).slotKey);
  const firstDetail = attemptFor(projection, slot(1).slotKey);
  harness.coordinator.keepAttempt(slot(0).slotKey, firstHero.attemptId);
  harness.coordinator.keepAttempt(slot(1).slotKey, firstDetail.attemptId);

  projection = harness.coordinator.getProjection();
  const heroSlot = projection.slots.find((item) => item.slotKey === slot(0).slotKey);
  assert.throws(
    () => harness.coordinator.regenerateSlot(slot(0).slotKey, {
      ...engineJob(0, {
        idempotencyKey: 'provider-regenerate-no-ack',
        dispatchRef: 'dispatch-regenerate-no-ack',
      }),
      commandId: 'regenerate-no-ack', expectedSlotRevision: heroSlot.revision,
    }),
    (error) => error?.code === 'SS_ERP_MEDIA_JOB_CHARGE_ACK_REQUIRED',
  );
  assert.throws(
    () => harness.coordinator.regenerateSlot(slot(0).slotKey, {
      ...engineJob(0, {
        idempotencyKey: 'provider-regenerate-old-warning',
        dispatchRef: 'dispatch-regenerate-old-warning',
      }),
      commandId: 'regenerate-old-warning', expectedSlotRevision: heroSlot.revision,
      chargeAcknowledgement: { warningVersion: 'external-provider-charge/v0', confirmed: true },
    }),
    (error) => error?.code === 'SS_ERP_MEDIA_JOB_CHARGE_ACK_REQUIRED',
  );

  harness.coordinator.regenerateSlot(slot(0).slotKey, {
    ...engineJob(0, {
      idempotencyKey: 'provider-regenerate-current',
      dispatchRef: 'dispatch-regenerate-current',
      intentHash: 'f'.repeat(64),
    }),
    commandId: 'regenerate-current', expectedSlotRevision: heroSlot.revision,
    chargeAcknowledgement: {
      warningVersion: harness.api.EXTERNAL_CHARGE_WARNING_VERSION,
      confirmed: true,
    },
  });
  await harness.coordinator.whenSettled();
  projection = harness.coordinator.getProjection();
  let projectedHero = projection.slots.find((item) => item.slotKey === slot(0).slotKey);
  assert.equal(projectedHero.selectedAttemptId, firstHero.attemptId,
    'regeneration must preserve the previous selected result');
  const regenerated = projectedHero.attempts.find((item) => item.generation === 2);
  assert.equal(regenerated.externalChargePossible, true);
  assert.equal(regenerated.chargeWarningVersion, harness.api.EXTERNAL_CHARGE_WARNING_VERSION);

  harness.coordinator.keepAttempt(slot(0).slotKey, regenerated.attemptId);
  harness.coordinator.rejectAttempt(slot(0).slotKey, firstHero.attemptId);
  projectedHero = harness.coordinator.getProjection().slots.find(
    (item) => item.slotKey === slot(0).slotKey,
  );
  assert.equal(projectedHero.selectedAttemptId, regenerated.attemptId);
  assert.equal(
    projectedHero.attempts.find((item) => item.attemptId === firstHero.attemptId).reviewState,
    'REJECTED',
  );

  const ingestInput = {
    contractVersion: harness.api.INGEST_COMMAND_VERSION,
    idempotencyKey: 'batch-ingest-idempotency-1',
  };
  const accepted = await harness.coordinator.ingestSelectedBatch(ingestInput);
  assert.equal(harness.ingestCalls.length, 1, 'selected results must use one atomic batch call');
  assert.equal(harness.ingestCalls[0].request.executionBatchId, 'batch-1');
  assert.equal(harness.ingestCalls[0].request.resultIds.length, 2);
  assert.ok(harness.ingestCalls[0].request.resultIds.every((resultId) => (
    harness.vault.entries.get(resultId).reviewState === 'APPROVED'
      && harness.vault.entries.get(resultId).blob instanceof Blob
  )));
  assert.equal(
    harness.ingestCalls[0].request.resultIds.includes(firstHero.resultId),
    false,
    'a rejected attempt must never enter the ingest request',
  );
  assert.deepEqual(
    harness.ingestCalls[0].request.resultIds,
    [regenerated.resultId, firstDetail.resultId],
  );
  assert.deepEqual(plain(harness.ingestCalls[0].runtimeAuthority), {
    lifecycleAuthority: {
      contractVersion: 'extension-byok-device-session-lifecycle/v1', epoch: 9,
    },
    ownerUserId: 'owner-1', deviceSessionId: 'device-session-1',
    shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 7, draftVersion: 11,
    policyRevision: '734',
  });
  assert.equal(accepted.ingest.state, 'SUCCEEDED');
  assert.equal(accepted.ingest.erpGenerationChargeCents, 0);
  assert.equal(accepted.ingest.receiptId, 'batch-receipt-1');
  assert.equal(accepted.binding.draftRevision, 8);
  assert.equal(accepted.binding.draftVersion, 12);
  assert.equal(accepted.ingest.assignments.length, 2);
  const exactReceipt = receiptFor(
    harness.api,
    harness.ingestCalls[0].request,
    harness.vault,
  );
  assert.deepEqual(plain(accepted.ingest.receipt), exactReceipt);
  assert.equal(accepted.ingest.rebootstrapRequired, true);
  assert.equal(Object.isFrozen(accepted.ingest.receipt), true);
  assert.equal(Object.isFrozen(accepted.ingest.receipt.items), true);
  assert.ok(accepted.ingest.receipt.items.every((item) => !('receiptId' in item)));
  assert.ok(accepted.ingest.receipt.items.every((item) => !('replayed' in item)));

  const replay = await harness.coordinator.ingestSelectedBatch(ingestInput);
  assert.deepEqual(plain(replay), plain(accepted));
  assert.equal(harness.ingestCalls.length, 1, 'accepted batch replay must not ingest again');
});

test('recovers an unknown atomic ingest by status lookup without resending multipart', async () => {
  let initial = true;
  const harness = createHarness({
    atomicBehavior(request, api, vault, _authority, recovering) {
      if (!recovering && initial) {
        initial = false;
        const error = new Error('transport lost after dispatch');
        error.code = 'SS_ERP_BYOK_BATCH_INGEST_UNKNOWN_OUTCOME';
        error.outcome = 'UNKNOWN_OUTCOME';
        throw error;
      }
      return receiptFor(api, request, vault, { replayed: true });
    },
  });
  harness.coordinator.startBatch(batchInput(1));
  await harness.coordinator.whenSettled();
  const projection = harness.coordinator.getProjection();
  harness.coordinator.keepAttempt(
    projection.slots[0].slotKey,
    projection.slots[0].attempts[0].attemptId,
  );
  const command = {
    contractVersion: harness.api.INGEST_COMMAND_VERSION,
    idempotencyKey: 'batch-ingest-recovery-0001',
  };
  await assert.rejects(
    harness.coordinator.ingestSelectedBatch(command),
    (error) => error?.outcome === 'UNKNOWN_OUTCOME',
  );
  assert.equal(harness.ingestCalls.length, 1);
  const recovered = await harness.coordinator.recoverIngest(command);
  assert.equal(recovered.ingest.state, 'SUCCEEDED');
  assert.equal(recovered.ingest.replayed, true);
  assert.equal(recovered.ingest.rebootstrapRequired, true);
  assert.equal(harness.ingestCalls.length, 1, 'recovery must never resend multipart');
  assert.equal(harness.recoverCalls.length, 1);
  assert.equal(harness.recoverCalls[0].request.executionBatchId, 'batch-1');
});

test('requires current charge acknowledgement for retry and retains failed attempt history', async () => {
  let providerCalls = 0;
  const harness = createHarness({
    providerBehavior(input, vault) {
      providerCalls += 1;
      if (providerCalls === 1) {
        const error = new Error('provider busy');
        error.code = 'PROVIDER_BUSY';
        error.outcome = 'FAILED_RETRYABLE';
        throw error;
      }
      const stored = vault.store(input, input.resultBinding);
      return {
        outcome: 'SUCCEEDED', candidateId: 'candidate-after-retry',
        resultHandle: stored.resultId, resultSha256: stored.sha256,
        requestHash: stored.requestHash,
      };
    },
  });
  harness.coordinator.startBatch(batchInput(1));
  await harness.coordinator.whenSettled();
  let projection = harness.coordinator.getProjection();
  const failed = attemptFor(projection, slot(0).slotKey);
  const projectedSlot = projection.slots[0];
  await assert.rejects(
    harness.coordinator.retryAttempt(failed.attemptId, {
      idempotencyKey: 'provider-retry-no-ack', intentHash: failed.intentHash,
      dispatchRef: 'dispatch-retry-no-ack', commandId: 'retry-no-ack',
      expectedSlotRevision: projectedSlot.revision,
    }),
    (error) => error?.code === 'SS_ERP_MEDIA_JOB_CHARGE_ACK_REQUIRED',
  );

  await harness.coordinator.retryAttempt(failed.attemptId, {
    idempotencyKey: 'provider-retry-current', intentHash: failed.intentHash,
    dispatchRef: 'dispatch-retry-current', commandId: 'retry-current',
    expectedSlotRevision: projectedSlot.revision,
    chargeAcknowledgement: {
      warningVersion: harness.api.EXTERNAL_CHARGE_WARNING_VERSION,
      confirmed: true,
    },
  });
  await harness.coordinator.whenSettled();
  projection = harness.coordinator.getProjection();
  assert.equal(projection.slots[0].attempts.length, 2);
  assert.equal(projection.slots[0].attempts[0].state, 'FAILED_RETRYABLE');
  assert.equal(projection.slots[0].attempts[1].state, 'CANDIDATE_READY');
  assert.equal(projection.slots[0].attempts[1].retryOfAttemptId, failed.attemptId);
  assert.equal(projection.slots[0].attempts[1].externalChargePossible, true);
});

test('keeps Provider and ingest UNKNOWN_OUTCOME states absorbing without blind dispatch', async () => {
  let providerCalls = 0;
  const providerUnknown = createHarness({
    providerBehavior() {
      providerCalls += 1;
      const error = new Error('socket closed after POST');
      error.code = 'PROVIDER_TIMEOUT';
      error.outcome = 'UNKNOWN_OUTCOME';
      throw error;
    },
  });
  providerUnknown.coordinator.startBatch(batchInput(1));
  await providerUnknown.coordinator.whenSettled();
  const unknownProjection = providerUnknown.coordinator.getProjection();
  const unknownAttempt = attemptFor(unknownProjection, slot(0).slotKey);
  assert.equal(unknownAttempt.state, 'UNKNOWN_OUTCOME');
  assert.equal(unknownProjection.slots[0].state, 'UNKNOWN_OUTCOME');
  assert.throws(
    () => providerUnknown.coordinator.keepAttempt(slot(0).slotKey, unknownAttempt.attemptId),
    (error) => error?.code === 'SS_ERP_BYOK_BATCH_UNKNOWN_OUTCOME_LOCKED',
  );
  assert.throws(
    () => providerUnknown.coordinator.rejectAttempt(slot(0).slotKey, unknownAttempt.attemptId),
    (error) => error?.code === 'SS_ERP_BYOK_BATCH_UNKNOWN_OUTCOME_LOCKED',
  );
  assert.throws(
    () => providerUnknown.coordinator.regenerateSlot(slot(0).slotKey, {
      ...engineJob(0, {
        idempotencyKey: 'provider-regenerate-unknown',
        dispatchRef: 'dispatch-regenerate-unknown',
      }),
      commandId: 'regenerate-unknown',
      expectedSlotRevision: unknownProjection.slots[0].revision,
      chargeAcknowledgement: {
        warningVersion: providerUnknown.api.EXTERNAL_CHARGE_WARNING_VERSION,
        confirmed: true,
      },
    }),
    (error) => error?.code === 'SS_ERP_BYOK_BATCH_UNKNOWN_OUTCOME_LOCKED',
  );
  await assert.rejects(
    providerUnknown.coordinator.ingestSelectedBatch({
      contractVersion: providerUnknown.api.INGEST_COMMAND_VERSION,
      idempotencyKey: 'batch-ingest-provider-unknown',
    }),
    (error) => error?.code === 'SS_ERP_BYOK_BATCH_UNKNOWN_OUTCOME_LOCKED',
  );
  assert.equal(providerCalls, 1);
  assert.equal(providerUnknown.ingestCalls.length, 0);

  let ingestDispatches = 0;
  const ingestUnknown = createHarness({
    atomicBehavior() {
      ingestDispatches += 1;
      const error = new Error('ERP response lost');
      error.code = 'ERP_BATCH_TIMEOUT';
      error.outcome = 'UNKNOWN_OUTCOME';
      throw error;
    },
  });
  ingestUnknown.coordinator.startBatch(batchInput(1));
  await ingestUnknown.coordinator.whenSettled();
  const ready = ingestUnknown.coordinator.getProjection();
  ingestUnknown.coordinator.keepAttempt(
    slot(0).slotKey,
    attemptFor(ready, slot(0).slotKey).attemptId,
  );
  const command = {
    contractVersion: ingestUnknown.api.INGEST_COMMAND_VERSION,
    idempotencyKey: 'batch-ingest-unknown-1',
  };
  await assert.rejects(
    ingestUnknown.coordinator.ingestSelectedBatch(command),
    (error) => error?.code === 'ERP_BATCH_TIMEOUT' && error.outcome === 'UNKNOWN_OUTCOME',
  );
  assert.equal(ingestUnknown.coordinator.getProjection().ingest.state, 'UNKNOWN_OUTCOME');
  await assert.rejects(
    ingestUnknown.coordinator.ingestSelectedBatch(command),
    (error) => error?.code === 'SS_ERP_BYOK_BATCH_INGEST_UNKNOWN_OUTCOME',
  );
  assert.equal(ingestDispatches, 1, 'unknown atomic ingest must never be blindly repeated');
});

test('retires one UNKNOWN attempt after acknowledged retry and allows its successful successor to ingest', async () => {
  let providerCalls = 0;
  const harness = createHarness({
    providerBehavior(input, vault) {
      providerCalls += 1;
      if (providerCalls === 1) {
        const error = new Error('response lost after Provider accepted the POST');
        error.code = 'PROVIDER_TIMEOUT';
        error.outcome = 'UNKNOWN_OUTCOME';
        throw error;
      }
      const stored = vault.store(input, input.resultBinding);
      return {
        outcome: 'SUCCEEDED', candidateId: 'candidate-after-unknown-retry',
        resultHandle: stored.resultId, resultSha256: stored.sha256,
        requestHash: stored.requestHash,
      };
    },
  });
  harness.coordinator.startBatch(batchInput(1));
  await harness.coordinator.whenSettled();
  let projection = harness.coordinator.getProjection();
  const unknown = attemptFor(projection, slot(0).slotKey);
  await assert.rejects(
    harness.coordinator.retryAttempt(unknown.attemptId, {
      idempotencyKey: 'provider-unknown-blind-retry', intentHash: unknown.intentHash,
      dispatchRef: 'dispatch-unknown-blind-retry', commandId: 'unknown-blind-retry',
      expectedSlotRevision: projection.slots[0].revision,
    }),
    (error) => error?.code === 'SS_ERP_MEDIA_JOB_UNKNOWN_RECOVERY_REQUIRED',
  );
  assert.equal(providerCalls, 1);

  await harness.coordinator.retryAttempt(unknown.attemptId, {
    idempotencyKey: 'provider-unknown-confirmed-retry', intentHash: unknown.intentHash,
    dispatchRef: 'dispatch-unknown-confirmed-retry', commandId: 'unknown-confirmed-retry',
    expectedSlotRevision: projection.slots[0].revision,
    unknownOutcomeRecovery: {
      strategy: 'DUPLICATE_CHARGE_CONFIRMATION',
      warningVersion: harness.api.DUPLICATE_CHARGE_WARNING_VERSION,
      confirmed: true,
    },
  });
  await harness.coordinator.whenSettled();
  projection = harness.coordinator.getProjection();
  const retired = projection.slots[0].attempts.find(
    (attempt) => attempt.attemptId === unknown.attemptId,
  );
  const successor = projection.slots[0].attempts.find(
    (attempt) => attempt.retryOfAttemptId === unknown.attemptId,
  );
  assert.equal(retired.state, 'UNKNOWN_OUTCOME');
  assert.equal(retired.unknownOutcomeSuperseded, true);
  assert.equal(successor.state, 'CANDIDATE_READY');
  assert.equal(projection.slots[0].state, 'CANDIDATE_READY');
  assert.equal(providerCalls, 2);

  await assert.rejects(
    harness.coordinator.retryAttempt(unknown.attemptId, {
      idempotencyKey: 'provider-unknown-second-retry', intentHash: unknown.intentHash,
      dispatchRef: 'dispatch-unknown-second-retry', commandId: 'unknown-second-retry',
      expectedSlotRevision: projection.slots[0].revision,
      unknownOutcomeRecovery: {
        strategy: 'DUPLICATE_CHARGE_CONFIRMATION',
        warningVersion: harness.api.DUPLICATE_CHARGE_WARNING_VERSION,
        confirmed: true,
      },
    }),
    (error) => error?.code === 'SS_ERP_BYOK_BATCH_UNKNOWN_ATTEMPT_RETIRED',
  );
  assert.equal(providerCalls, 2, 'a retired UNKNOWN attempt must never dispatch again');

  harness.coordinator.keepAttempt(slot(0).slotKey, successor.attemptId);
  const accepted = await harness.coordinator.ingestSelectedBatch({
    contractVersion: harness.api.INGEST_COMMAND_VERSION,
    idempotencyKey: 'batch-ingest-after-unknown-retry',
  });
  assert.equal(accepted.ingest.state, 'SUCCEEDED');
  assert.equal(harness.ingestCalls.length, 1);
  assert.deepEqual(harness.ingestCalls[0].request.resultIds, [successor.resultId]);
});

test('rejects any non-exact or charged atomic receipt and makes its uncertain outcome absorbing', async () => {
  const mutations = [
    (receipt) => { receipt.erpAiChargeCents = 1; },
    (receipt) => { receipt.items = []; },
    (receipt) => { receipt.items[0].slotKey = 'shared:detail:SCENE'; },
    (receipt) => { receipt.boundDraftVersion += 1; },
    (receipt) => { receipt.receiptId = 'https://provider.example/receipt'; },
    (receipt) => { receipt.requestHash = 'not-a-sha256'; },
    (receipt) => { receipt.replayed = 'false'; },
    (receipt) => { receipt.executionBatchId = 'batch-other'; },
    (receipt) => { receipt.items[1].assetId = receipt.items[0].assetId; },
    (receipt) => { receipt.items[1].provenanceId = receipt.items[0].provenanceId; },
    (receipt) => { receipt.items[1].executionIntentId = receipt.items[0].executionIntentId; },
    (receipt) => { receipt.items[1].providerRequestHash = receipt.items[0].providerRequestHash; },
    (receipt) => { receipt.items[1].providerResultSha256 = receipt.items[0].providerResultSha256; },
    (receipt) => { receipt.items[1].normalizedSha256 = receipt.items[0].normalizedSha256; },
    (receipt) => { receipt.items[1].assignmentSha256 = receipt.items[0].assignmentSha256; },
    (receipt) => { receipt.items[0].receiptId = 'item-receipt-forbidden'; },
    (receipt) => { receipt.items[0].replayed = false; },
    (receipt) => { receipt.items[0].assignment.assetId = 'asset-other'; },
    (receipt) => { receipt.items[0].policyRevision = '735'; },
    (receipt) => { receipt.extra = true; },
  ];
  for (const [index, mutate] of mutations.entries()) {
    let calls = 0;
    const harness = createHarness({
      atomicBehavior(request, api, vault) {
        calls += 1;
        const receipt = receiptFor(api, request, vault);
        mutate(receipt);
        return receipt;
      },
    });
    harness.coordinator.startBatch(batchInput(2));
    await harness.coordinator.whenSettled();
    const projection = harness.coordinator.getProjection();
    for (const selectedSlot of projection.slots) {
      harness.coordinator.keepAttempt(
        selectedSlot.slotKey,
        selectedSlot.attempts[0].attemptId,
      );
    }
    const command = {
      contractVersion: harness.api.INGEST_COMMAND_VERSION,
      idempotencyKey: `batch-ingest-invalid-receipt-${index}`,
    };
    await assert.rejects(
      harness.coordinator.ingestSelectedBatch(command),
      (error) => error?.code === 'SS_ERP_BYOK_BATCH_RECEIPT_INVALID'
        && error.outcome === 'UNKNOWN_OUTCOME',
    );
    assert.equal(harness.coordinator.getProjection().ingest.state, 'UNKNOWN_OUTCOME');
    await assert.rejects(
      harness.coordinator.ingestSelectedBatch(command),
      (error) => error?.code === 'SS_ERP_BYOK_BATCH_INGEST_UNKNOWN_OUTCOME',
    );
    assert.equal(calls, 1);
  }
});

test('restores review-only candidates without Provider dispatch and reuses review plus atomic ingest', async () => {
  const harness = createHarness();
  const batchBinding = binding();
  const selectedSlots = [restoredSlot(slot(0)), restoredSlot(slot(1))];
  const hero = seedRestoredAttempt(harness, batchBinding, selectedSlots[0], {
    attemptId: 'attempt-restored-hero-1', generation: 1,
    idempotencyKey: 'provider-restored-hero-1', intentHash: '1'.repeat(64),
    candidateId: 'candidate-restored-hero-1',
  });
  const alternate = seedRestoredAttempt(harness, batchBinding, selectedSlots[0], {
    attemptId: 'attempt-restored-hero-2', generation: 2,
    idempotencyKey: 'provider-restored-hero-2', intentHash: '2'.repeat(64),
    candidateId: 'candidate-restored-hero-2',
  });
  const detail = seedRestoredAttempt(harness, batchBinding, selectedSlots[1], {
    attemptId: 'attempt-restored-detail-1', generation: 1,
    idempotencyKey: 'provider-restored-detail-1', intentHash: '3'.repeat(64),
    candidateId: 'candidate-restored-detail-1',
  });

  let projection = harness.coordinator.restoreBatch({
    contractVersion: harness.api.RESTORE_COMMAND_VERSION,
    batchId: 'batch-restored-1',
    binding: batchBinding,
    slots: selectedSlots,
    attempts: [hero, alternate, detail],
  });
  assert.equal(harness.providerCalls.length, 0);
  assert.equal(projection.scheduler.state, 'REVIEW');
  assert.equal(projection.scheduler.activeCount, 0);
  assert.equal(projection.scheduler.queuedCount, 0);
  assert.deepEqual(plain(projection.slots[0].attempts.map((attempt) => ({
    attemptId: attempt.attemptId,
    generation: attempt.generation,
    intentHash: attempt.intentHash,
    resultId: attempt.resultId,
    resultSha256: attempt.resultSha256,
  }))), [hero, alternate].map((attempt) => ({
    attemptId: attempt.attemptId,
    generation: attempt.generation,
    intentHash: attempt.intentHash,
    resultId: attempt.resultHandle,
    resultSha256: attempt.resultSha256,
  })));
  assert.equal(harness.vault.getPublic(hero.resultHandle).reviewState, 'CANDIDATE_READY');

  const reviewOnly = (error) => error?.code === 'SS_ERP_BYOK_BATCH_REVIEW_ONLY';
  assert.throws(() => harness.coordinator.pause(), reviewOnly);
  assert.throws(() => harness.coordinator.continue(), reviewOnly);
  assert.throws(() => harness.coordinator.cancelQueued(hero.attemptId), reviewOnly);
  assert.throws(
    () => harness.coordinator.regenerateSlot(hero.slotKey, {}),
    reviewOnly,
  );
  await assert.rejects(harness.coordinator.retryAttempt(hero.attemptId, {}), reviewOnly);
  await assert.rejects(
    harness.coordinator.resolveUnknownAttempt(hero.attemptId, 'lookup-restored-1'),
    reviewOnly,
  );
  assert.equal(harness.providerCalls.length, 0);

  harness.coordinator.keepAttempt(hero.slotKey, hero.attemptId);
  harness.coordinator.rejectAttempt(alternate.slotKey, alternate.attemptId);
  projection = harness.coordinator.keepAttempt(detail.slotKey, detail.attemptId);
  assert.equal(projection.slots[0].selectedAttemptId, hero.attemptId);
  assert.equal(
    projection.slots[0].attempts.find((attempt) => attempt.attemptId === alternate.attemptId)
      .reviewState,
    'REJECTED',
  );
  assert.equal(harness.vault.entries.has(alternate.resultHandle), false);

  const accepted = await harness.coordinator.ingestSelectedBatch({
    contractVersion: harness.api.INGEST_COMMAND_VERSION,
    idempotencyKey: 'restored-batch-ingest-0001',
  });
  assert.equal(accepted.ingest.state, 'SUCCEEDED');
  assert.equal(accepted.ingest.erpGenerationChargeCents, 0);
  assert.equal(harness.ingestCalls.length, 1);
  assert.deepEqual(
    harness.ingestCalls[0].request.resultIds,
    [hero.resultHandle, detail.resultHandle],
  );
  assert.equal(harness.providerCalls.length, 0);
  harness.coordinator.dispose();
  assert.equal(harness.coordinator.getProjection().ingest.state, 'SUCCEEDED');
});

test('rejects non-exact restored batch schemas atomically before activation', () => {
  const harness = createHarness();
  const batchBinding = binding();
  const selectedSlot = restoredSlot(slot(0));
  const attempt = seedRestoredAttempt(harness, batchBinding, selectedSlot, {
    attemptId: 'attempt-restored-exact-1', generation: 1,
    idempotencyKey: 'provider-restored-exact-1', intentHash: '4'.repeat(64),
    candidateId: 'candidate-restored-exact-1',
  });
  assert.throws(() => harness.coordinator.restoreBatch({
    contractVersion: harness.api.RESTORE_COMMAND_VERSION,
    batchId: 'batch-restored-exact-1',
    binding: batchBinding,
    slots: [selectedSlot],
    attempts: [{ ...attempt, dispatchRef: 'must-not-be-restored' }],
  }), (error) => error?.code === 'SS_ERP_BYOK_BATCH_INPUT_INVALID');
  assert.equal(harness.coordinator.getProjection().batchId, null);
  assert.throws(() => harness.coordinator.restoreBatch({
    contractVersion: harness.api.RESTORE_COMMAND_VERSION,
    batchId: 'batch-restored-exact-1',
    binding: batchBinding,
    slots: [selectedSlot],
    attempts: [{ ...attempt, providerRequestHash: 'f'.repeat(64) }],
  }), (error) => error?.code === 'SS_ERP_BYOK_BATCH_RESTORE_RESULT_INVALID');
  assert.equal(harness.coordinator.getProjection().batchId, null);
  assert.equal(harness.providerCalls.length, 0);
});

test('recovers an unknown atomic ingest for restored candidates without Provider redispatch', async () => {
  let firstIngest = true;
  const harness = createHarness({
    atomicBehavior(request, api, vault, _authority, recovering) {
      if (!recovering && firstIngest) {
        firstIngest = false;
        const error = new Error('ERP response lost after atomic ingest dispatch');
        error.code = 'ERP_BATCH_TIMEOUT';
        error.outcome = 'UNKNOWN_OUTCOME';
        throw error;
      }
      return receiptFor(api, request, vault, { replayed: true });
    },
  });
  const batchBinding = binding();
  const selectedSlot = restoredSlot(slot(0));
  const attempt = seedRestoredAttempt(harness, batchBinding, selectedSlot, {
    attemptId: 'attempt-restored-recovery-1', generation: 1,
    idempotencyKey: 'provider-restored-recovery-1', intentHash: '5'.repeat(64),
    candidateId: 'candidate-restored-recovery-1',
  });
  harness.coordinator.restoreBatch({
    contractVersion: harness.api.RESTORE_COMMAND_VERSION,
    batchId: 'batch-restored-recovery-1',
    binding: batchBinding,
    slots: [selectedSlot],
    attempts: [attempt],
  });
  harness.coordinator.keepAttempt(selectedSlot.slotKey, attempt.attemptId);
  const command = {
    contractVersion: harness.api.INGEST_COMMAND_VERSION,
    idempotencyKey: 'restored-ingest-recovery-0001',
  };
  await assert.rejects(
    harness.coordinator.ingestSelectedBatch(command),
    (error) => error?.outcome === 'UNKNOWN_OUTCOME',
  );
  const recovered = await harness.coordinator.recoverIngest(command);
  assert.equal(recovered.ingest.state, 'SUCCEEDED');
  assert.equal(recovered.ingest.replayed, true);
  assert.equal(harness.ingestCalls.length, 1);
  assert.equal(harness.recoverCalls.length, 1);
  assert.equal(harness.providerCalls.length, 0);
});
