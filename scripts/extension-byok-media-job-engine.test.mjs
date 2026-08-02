import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const contractPath = 'extensions/ss-erp/shared/contracts/ai-image-workbench-v1.js';
const enginePath = 'extensions/ss-erp/shared/byok/media-job-engine.js';
const CANONICAL_BINI_SKU_KEY = 'sku:5777037825166|晚霞肤(1.5cm+4cm胸垫)>M(适合34/75ABC)';
const CANONICAL_BINI_SLOT_KEY = `sku:${CANONICAL_BINI_SKU_KEY}:hero`;

function loadApi() {
  assert.equal(fs.existsSync(enginePath), true, 'media job engine module is missing');
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
  };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(contractPath, 'utf8'), context, { filename: contractPath });
  vm.runInNewContext(fs.readFileSync(enginePath, 'utf8'), context, { filename: enginePath });
  return context.SS_ERP_BYOK_MEDIA_JOB_ENGINE;
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

function job(slotKey, suffix, overrides = {}) {
  return {
    slotKey,
    operation: 'TEXT_TO_IMAGE',
    idempotencyKey: `job-${suffix}`,
    intentHash: createHash('sha256').update(suffix).digest('hex'),
    dispatchRef: `dispatch-${suffix}`,
    ...overrides,
  };
}

function success(candidateId, marker = 'b') {
  return {
    outcome: 'SUCCEEDED',
    candidateId,
    resultHandle: `result-${candidateId}`,
    resultSha256: marker.repeat(64),
    requestHash: marker.repeat(64),
  };
}

function createEngine(api, options) {
  const {
    policyMaxConcurrency = 4,
    runnerMaxConcurrency = 4,
    policyRevision = '734',
    resultRetention = {
      pin() { return true; },
      unpin() { return true; },
    },
    resolveDispatchInput = async (dispatchRef) => ({
      privateMarker: `private-${dispatchRef}`,
    }),
    resolveRecovery = async () => {
      throw new Error('no trusted recovery fixture');
    },
    ...rest
  } = options;
  return api.createEngine({
    ...rest,
    concurrencyAuthority: {
      policyRevision,
      maxConcurrency: policyMaxConcurrency,
    },
    runnerMaxConcurrency,
    resultRetention,
    resolveDispatchInput,
    resolveRecovery,
  });
}

test('caps deterministic FIFO dispatch at the requested, policy, and contract minimum', async () => {
  const api = loadApi();
  const controls = new Map();
  const starts = [];
  const engine = createEngine(api, {
    executionMode: 'BYOK',
    requestedConcurrency: 4,
    policyMaxConcurrency: 3,
    runnerMaxConcurrency: 2,
    policyRevision: '991',
    dispatch(input) {
      assert.equal(input.policyRevision, '991');
      starts.push(input.attemptId);
      const control = deferred();
      controls.set(input.attemptId, control);
      return control.promise;
    },
  });

  const attempts = engine.enqueueBatch([
    job('sku-1:hero', 'fifo-01'),
    job('sku-2:hero', 'fifo-02'),
    job('shared:detail-1', 'fifo-03'),
    job('shared:detail-2', 'fifo-04'),
  ]);
  await tick();
  assert.equal(engine.getSnapshot().effectiveConcurrency, 2);
  assert.equal(engine.getSnapshot().policyRevision, '991');
  assert.equal(engine.getSnapshot().activeCount, 2);
  assert.deepEqual(starts, attempts.slice(0, 2).map((item) => item.attemptId));
  assert.deepEqual(
    plain(engine.getSnapshot().attempts.map((item) => item.state)),
    ['SUBMITTING', 'SUBMITTING', 'QUEUED', 'QUEUED'],
  );

  controls.get(attempts[0].attemptId).resolve(success('candidate-1'));
  await tick();
  assert.deepEqual(starts, attempts.slice(0, 3).map((item) => item.attemptId));
  controls.get(attempts[1].attemptId).resolve(success('candidate-2', 'c'));
  await tick();
  assert.deepEqual(starts, attempts.map((item) => item.attemptId));
  controls.get(attempts[2].attemptId).resolve(success('candidate-3', 'd'));
  controls.get(attempts[3].attemptId).resolve(success('candidate-4', 'e'));
  await engine.whenSettled();

  const snapshot = engine.getSnapshot();
  assert.equal(snapshot.schedulerState, 'REVIEW');
  assert.equal(snapshot.activeCount, 0);
  assert.equal(snapshot.queuedCount, 0);
  assert.ok(snapshot.attempts.every((item) => item.state === 'CANDIDATE_READY'));
  assert.ok(snapshot.attempts.every((item) => item.providerRequestHash));
  assert.ok(snapshot.attempts.every((item) => item.intentHash));
  assert.ok(snapshot.attempts.every((item) => item.policyRevision === '991'));
  assert.ok(snapshot.attempts.every((item) => item.executionMode === 'BYOK'));
});

test('accepts only canonical structured Unicode slot keys while preserving legacy ASCII slots', async () => {
  const api = loadApi();
  const engine = createEngine(api, {
    executionMode: 'BYOK',
    requestedConcurrency: 1,
    policyMaxConcurrency: 1,
    async dispatch(input) { return success(`canonical-${input.slotKey.length}`); },
  });
  const unicode = engine.enqueue(job(CANONICAL_BINI_SLOT_KEY, 'canonical-unicode'));
  const ascii = engine.enqueue(job('sku-1:hero', 'canonical-ascii'));
  await engine.whenSettled();
  assert.equal(unicode.slotKey, CANONICAL_BINI_SLOT_KEY);
  assert.equal(ascii.slotKey, 'sku-1:hero');
  assert.throws(
    () => engine.enqueue(job('任意Unicode槽位', 'arbitrary-unicode')),
    (error) => error?.code === 'SS_ERP_MEDIA_JOB_INPUT_INVALID',
  );
  assert.throws(
    () => engine.enqueue(job('sku:任意:detail', 'unsupported-unicode')),
    (error) => error?.code === 'SS_ERP_MEDIA_JOB_INPUT_INVALID',
  );
});

test('rejects missing or malformed server concurrency authority and runner caps', () => {
  const api = loadApi();
  const common = {
    executionMode: 'BYOK',
    requestedConcurrency: 4,
    runnerMaxConcurrency: 1,
    resultRetention: { pin() { return true; }, unpin() { return true; } },
    dispatch: async () => success('candidate-authority'),
    resolveDispatchInput: async () => ({}),
    resolveRecovery: async () => ({}),
  };
  for (const concurrencyAuthority of [
    undefined,
    { policyRevision: '734' },
    { policyRevision: '734', maxConcurrency: 0 },
    { policyRevision: '734', maxConcurrency: 5 },
    { policyRevision: '734', maxConcurrency: 2, unexpected: true },
  ]) {
    assert.throws(
      () => api.createEngine({ ...common, concurrencyAuthority }),
      (error) => error && error.code === 'SS_ERP_MEDIA_JOB_INPUT_INVALID',
    );
  }
  assert.throws(
    () => api.createEngine({
      ...common,
      concurrencyAuthority: { policyRevision: '734', maxConcurrency: 2 },
      runnerMaxConcurrency: 0,
    }),
    (error) => error && error.code === 'SS_ERP_MEDIA_JOB_INPUT_INVALID',
  );
  const sharedCapped = api.createEngine({
    ...common,
    requestedConcurrency: 100,
    concurrencyAuthority: { policyRevision: '735', maxConcurrency: 4 },
    runnerMaxConcurrency: 100,
  });
  assert.equal(sharedCapped.getSnapshot().effectiveConcurrency, 4);
  assert.equal(sharedCapped.getSnapshot().policyRevision, '735');
});

test('pauses after active work, continues deterministically, and cancels only queued work', async () => {
  const api = loadApi();
  const controls = new Map();
  const starts = [];
  const engine = createEngine(api, {
    executionMode: 'ERP_HOSTED',
    requestedConcurrency: 2,
    policyMaxConcurrency: 2,
    dispatch(input) {
      starts.push(input.attemptId);
      const control = deferred();
      controls.set(input.attemptId, control);
      return control.promise;
    },
  });
  const attempts = engine.enqueueBatch([
    job('sku-1:hero', 'pause-01'),
    job('sku-2:hero', 'pause-02'),
    job('shared:detail-1', 'pause-03'),
    job('shared:detail-2', 'pause-04'),
  ]);
  await tick();
  assert.equal(engine.pause().schedulerState, 'PAUSING');
  assert.equal(engine.cancelQueued(attempts[3].attemptId).cancelled, true);
  assert.equal(engine.cancelQueued(attempts[0].attemptId).cancelled, false);

  controls.get(attempts[0].attemptId).resolve(success('candidate-pause-1'));
  controls.get(attempts[1].attemptId).resolve(success('candidate-pause-2', 'c'));
  await engine.whenSettled();
  assert.equal(engine.getSnapshot().schedulerState, 'PAUSED');
  assert.deepEqual(starts, attempts.slice(0, 2).map((item) => item.attemptId));
  assert.equal(
    engine.getSnapshot().attempts.find((item) => item.attemptId === attempts[2].attemptId).state,
    'QUEUED',
  );
  assert.equal(
    engine.getSnapshot().attempts.find((item) => item.attemptId === attempts[3].attemptId).state,
    'CANCELLED',
  );

  assert.equal(engine.continue().schedulerState, 'RUNNING');
  await tick();
  assert.deepEqual(starts, attempts.slice(0, 3).map((item) => item.attemptId));
  controls.get(attempts[2].attemptId).resolve(success('candidate-pause-3', 'd'));
  await engine.whenSettled();
  assert.equal(engine.getSnapshot().schedulerState, 'REVIEW');
});

test('freezes execution mode and keeps private dispatch input out of public state', async () => {
  const api = loadApi();
  const dispatches = [];
  const engine = createEngine(api, {
    executionMode: 'BYOK',
    requestedConcurrency: 1,
    policyMaxConcurrency: 4,
    async dispatch(input) {
      dispatches.push(input);
      return success('candidate-private');
    },
  });
  assert.throws(
    () => engine.enqueue({ ...job('sku-1:hero', 'mode-01'), executionMode: 'ERP_HOSTED' }),
    (error) => error && error.code === 'SS_ERP_MEDIA_JOB_INPUT_INVALID',
  );
  const attempt = engine.enqueue(job('sku-1:hero', 'mode-02'));
  await engine.whenSettled();
  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0].executionMode, 'BYOK');
  assert.equal(dispatches[0].dispatchInput.privateMarker, 'private-dispatch-mode-02');
  const serialized = JSON.stringify(engine.getSnapshot());
  assert.equal(serialized.includes('private-mode-02'), false);
  assert.equal(serialized.includes('dispatchInput'), false);
  assert.equal(
    engine.getSnapshot().attempts.find((item) => item.attemptId === attempt.attemptId).executionMode,
    'BYOK',
  );
  assert.equal(Object.prototype.hasOwnProperty.call(engine, 'setExecutionMode'), false);
});

test('preserves the selected alternate across regeneration and requires charge acknowledgement', async () => {
  const api = loadApi();
  let generation = 0;
  const pinned = new Set();
  const retentionEvents = [];
  const engine = createEngine(api, {
    executionMode: 'BYOK',
    requestedConcurrency: 1,
    policyMaxConcurrency: 1,
    resultRetention: {
      pin(resultHandle) {
        retentionEvents.push(`pin:${resultHandle}`);
        if (resultHandle === 'result-candidate-alt-3') {
          const error = new Error('vault full');
          error.code = 'SS_ERP_BYOK_RESULT_VAULT_FULL';
          throw error;
        }
        pinned.add(resultHandle);
        return true;
      },
      unpin(resultHandle) {
        retentionEvents.push(`unpin:${resultHandle}`);
        return pinned.delete(resultHandle);
      },
    },
    async dispatch() {
      generation += 1;
      return success(`candidate-alt-${generation}`, String.fromCharCode(97 + generation));
    },
  });
  const first = engine.enqueue(job('sku-1:hero', 'alternate-01'));
  await engine.whenSettled();
  engine.selectCandidate('sku-1:hero', first.attemptId);
  assert.deepEqual([...pinned], ['result-candidate-alt-1']);
  const selectedRevision = engine.getSnapshot().slots
    .find((item) => item.slotKey === 'sku-1:hero').revision;
  assert.throws(
    () => engine.regenerate('sku-1:hero', job('sku-1:hero', 'alternate-02')),
    (error) => error && error.code === 'SS_ERP_MEDIA_JOB_CHARGE_ACK_REQUIRED',
  );
  const second = engine.regenerate('sku-1:hero', {
    ...job('sku-1:hero', 'alternate-03'),
    commandId: 'command-alternate-03',
    expectedSlotRevision: selectedRevision,
    chargeAcknowledgement: {
      warningVersion: api.EXTERNAL_CHARGE_WARNING_VERSION,
      confirmed: true,
    },
  });
  await engine.whenSettled();
  let slot = engine.getSnapshot().slots.find((item) => item.slotKey === 'sku-1:hero');
  assert.equal(slot.selectedAttemptId, first.attemptId);
  assert.deepEqual(plain(slot.attemptIds), [first.attemptId, second.attemptId]);
  assert.equal(slot.selectedCandidateId, 'candidate-alt-1');
  engine.selectCandidate('sku-1:hero', second.attemptId);
  slot = engine.getSnapshot().slots.find((item) => item.slotKey === 'sku-1:hero');
  assert.equal(slot.selectedCandidateId, 'candidate-alt-2');
  assert.deepEqual([...pinned], ['result-candidate-alt-2']);
  const secondRevision = slot.revision;
  const third = engine.regenerate('sku-1:hero', {
    ...job('sku-1:hero', 'alternate-04'),
    commandId: 'command-alternate-04',
    expectedSlotRevision: secondRevision,
    chargeAcknowledgement: {
      warningVersion: api.EXTERNAL_CHARGE_WARNING_VERSION,
      confirmed: true,
    },
  });
  await engine.whenSettled();
  assert.throws(
    () => engine.selectCandidate('sku-1:hero', third.attemptId),
    (error) => error && error.code === 'SS_ERP_MEDIA_JOB_RESULT_RETENTION_FAILED',
  );
  slot = engine.getSnapshot().slots.find((item) => item.slotKey === 'sku-1:hero');
  assert.equal(slot.selectedAttemptId, second.attemptId);
  assert.deepEqual([...pinned], ['result-candidate-alt-2']);
  assert.deepEqual(retentionEvents, [
    'pin:result-candidate-alt-1',
    'pin:result-candidate-alt-2',
    'unpin:result-candidate-alt-1',
    'pin:result-candidate-alt-3',
  ]);
});

test('retries definite failures as new charge-aware attempts without mutating history', async () => {
  const api = loadApi();
  let calls = 0;
  const engine = createEngine(api, {
    executionMode: 'BYOK',
    requestedConcurrency: 1,
    policyMaxConcurrency: 1,
    async dispatch() {
      calls += 1;
      if (calls === 1) {
        const error = new Error('bounded failure');
        error.code = 'PROVIDER_BUSY';
        error.outcome = 'FAILED_RETRYABLE';
        throw error;
      }
      return success('candidate-retry');
    },
  });
  const firstInput = job('sku-1:hero', 'retry-01');
  const first = engine.enqueue(firstInput);
  await engine.whenSettled();
  assert.equal(engine.getAttempt(first.attemptId).state, 'FAILED_RETRYABLE');
  await assert.rejects(
    engine.retryAttempt(first.attemptId, job('sku-1:hero', 'retry-02')),
    (error) => error && error.code === 'SS_ERP_MEDIA_JOB_CHARGE_ACK_REQUIRED',
  );
  const failedRevision = engine.getSnapshot().slots
    .find((item) => item.slotKey === 'sku-1:hero').revision;
  const second = await engine.retryAttempt(first.attemptId, {
    idempotencyKey: 'job-retry-03',
    intentHash: firstInput.intentHash,
    dispatchRef: 'dispatch-retry-03',
    commandId: 'command-retry-03',
    expectedSlotRevision: failedRevision,
    chargeAcknowledgement: {
      warningVersion: api.EXTERNAL_CHARGE_WARNING_VERSION,
      confirmed: true,
    },
  });
  await engine.whenSettled();
  assert.equal(engine.getAttempt(first.attemptId).state, 'FAILED_RETRYABLE');
  assert.equal(engine.getAttempt(second.attemptId).state, 'CANDIDATE_READY');
  assert.equal(engine.getAttempt(second.attemptId).retryOfAttemptId, first.attemptId);
  assert.equal(engine.getAttempt(second.attemptId).externalChargePossible, true);
});

test('never retries an unknown outcome without explicit recovery evidence or duplicate-charge consent', async () => {
  const api = loadApi();
  let calls = 0;
  const engine = createEngine(api, {
    executionMode: 'BYOK',
    requestedConcurrency: 1,
    policyMaxConcurrency: 1,
    async dispatch() {
      calls += 1;
      if (calls === 1) {
        const error = new Error('socket closed');
        error.code = 'PROVIDER_TIMEOUT';
        error.outcome = 'UNKNOWN_OUTCOME';
        throw error;
      }
      return success('candidate-after-unknown');
    },
  });
  const unknownInput = job('sku-1:hero', 'unknown-01');
  const unknown = engine.enqueue(unknownInput);
  await engine.whenSettled();
  const unknownState = engine.getAttempt(unknown.attemptId);
  assert.equal(unknownState.state, 'UNKNOWN_OUTCOME');
  assert.equal(unknownState.automaticRetryAllowed, false);
  assert.equal(
    unknownState.recoveryRequirement,
    'PROVIDER_LOOKUP_OR_STABLE_IDEMPOTENCY_OR_EXPLICIT_DUPLICATE_CHARGE_CONFIRMATION',
  );
  const unknownRevision = engine.getSnapshot().slots
    .find((item) => item.slotKey === 'sku-1:hero').revision;
  await assert.rejects(
    engine.retryAttempt(unknown.attemptId, {
      idempotencyKey: 'job-unknown-02',
      intentHash: unknownInput.intentHash,
      dispatchRef: 'dispatch-unknown-02',
      commandId: 'command-unknown-02',
      expectedSlotRevision: unknownRevision,
    }),
    (error) => error && error.code === 'SS_ERP_MEDIA_JOB_UNKNOWN_RECOVERY_REQUIRED',
  );
  assert.equal(calls, 1);

  const retry = await engine.retryAttempt(unknown.attemptId, {
    idempotencyKey: 'job-unknown-03',
    intentHash: unknownInput.intentHash,
    dispatchRef: 'dispatch-unknown-03',
    commandId: 'command-unknown-03',
    expectedSlotRevision: unknownRevision,
    unknownOutcomeRecovery: {
      strategy: 'DUPLICATE_CHARGE_CONFIRMATION',
      warningVersion: api.DUPLICATE_CHARGE_WARNING_VERSION,
      confirmed: true,
    },
  });
  await engine.whenSettled();
  assert.equal(calls, 2);
  assert.equal(engine.getAttempt(retry.attemptId).retryRisk, 'DUPLICATE_CHARGE_ACCEPTED');
  assert.equal(engine.getAttempt(retry.attemptId).state, 'CANDIDATE_READY');
});

test('accepts closed lookup or stable-idempotency evidence for unknown recovery', async () => {
  const api = loadApi();
  for (const strategy of ['PROVIDER_LOOKUP_NOT_ACCEPTED', 'STABLE_IDEMPOTENCY']) {
    let calls = 0;
    const engine = createEngine(api, {
      executionMode: 'ERP_HOSTED',
      requestedConcurrency: 1,
      policyMaxConcurrency: 1,
      async dispatch() {
        calls += 1;
        if (calls === 1) {
          const error = new Error('unknown');
          error.outcome = 'UNKNOWN_OUTCOME';
          throw error;
        }
        return success(`candidate-${strategy.toLowerCase()}`);
      },
      async resolveRecovery(input) {
        assert.equal(input.purpose, 'RETRY');
        assert.match(input.recoveryRef, /^recovery-/u);
        return {
          kind: 'RETRY_AUTHORITY',
          strategy,
          evidenceSha256: '9'.repeat(64),
        };
      },
    });
    const firstInput = job('shared:detail-1', `evidence-${strategy}-01`);
    const first = engine.enqueue(firstInput);
    await engine.whenSettled();
    const revision = engine.getSnapshot().slots
      .find((item) => item.slotKey === 'shared:detail-1').revision;
    const next = await engine.retryAttempt(first.attemptId, {
      idempotencyKey: strategy === 'STABLE_IDEMPOTENCY'
        ? firstInput.idempotencyKey
        : `job-evidence-${strategy}-02`,
      intentHash: firstInput.intentHash,
      dispatchRef: `dispatch-evidence-${strategy}-02`,
      commandId: `command-evidence-${strategy}-02`,
      expectedSlotRevision: revision,
      unknownOutcomeRecovery: {
        strategy: 'TRUSTED_RECOVERY_REF',
        recoveryRef: `recovery-${strategy}-02`,
      },
    });
    await engine.whenSettled();
    assert.equal(calls, 2);
    assert.equal(engine.getAttempt(next.attemptId).retryRisk, 'SAFE_RECOVERY_EVIDENCE');
    assert.equal(engine.getAttempt(next.attemptId).unknownRecoveryStrategy, strategy);
    assert.equal(engine.getAttempt(next.attemptId).recoveryEvidenceSha256, '9'.repeat(64));
  }
});

test('settles an unknown attempt directly from bounded Provider lookup evidence', async () => {
  const api = loadApi();
  for (const state of ['CANDIDATE_READY', 'FAILED_RETRYABLE', 'FAILED_FINAL']) {
    let calls = 0;
    let resolution;
    const engine = createEngine(api, {
      executionMode: 'BYOK',
      requestedConcurrency: 1,
      policyMaxConcurrency: 1,
      async dispatch() {
        calls += 1;
        const error = new Error('unknown');
        error.outcome = 'UNKNOWN_OUTCOME';
        throw error;
      },
      async resolveRecovery(input) {
        assert.equal(input.purpose, 'RESOLVE');
        assert.match(input.recoveryRef, /^lookup-/u);
        return resolution;
      },
    });
    const attempt = engine.enqueue(job('sku-1:hero', `lookup-${state}-01`));
    await engine.whenSettled();
    resolution = state === 'CANDIDATE_READY'
      ? {
        kind: 'LOOKUP_RESOLUTION',
        state,
        evidenceSha256: '8'.repeat(64),
        candidateId: `candidate-lookup-${state.toLowerCase()}`,
        resultHandle: `result-lookup-${state.toLowerCase()}`,
        resultSha256: '6'.repeat(64),
        requestHash: '5'.repeat(64),
      }
      : {
        kind: 'LOOKUP_RESOLUTION',
        state,
        evidenceSha256: '8'.repeat(64),
        requestHash: '5'.repeat(64),
        errorCode: state === 'FAILED_FINAL' ? 'CONTENT_REJECTED' : 'PROVIDER_BUSY',
      };
    const settled = await engine.resolveUnknownAttempt(
      attempt.attemptId,
      `lookup-${state.toLowerCase()}`,
    );
    assert.equal(settled.state, state);
    assert.equal(settled.automaticRetryAllowed, null);
    assert.equal(settled.recoveryRequirement, null);
    assert.equal(settled.unknownRecoveryStrategy, 'PROVIDER_LOOKUP');
    assert.equal(settled.recoveryEvidenceSha256, '8'.repeat(64));
    assert.equal(calls, 1);
    if (state === 'CANDIDATE_READY') {
      assert.match(settled.candidateId, /^candidate-lookup-/u);
      engine.selectCandidate('sku-1:hero', attempt.attemptId);
    }
    await assert.rejects(
      engine.resolveUnknownAttempt(attempt.attemptId, `lookup-${state.toLowerCase()}`),
      (error) => error && error.code === 'SS_ERP_MEDIA_JOB_UNKNOWN_RESOLUTION_INVALID',
    );
  }
});

test('serializes lookup and retry recovery for each unknown Provider attempt', async () => {
  const api = loadApi();
  const lookup = deferred();
  let recoveryCalls = 0;
  let providerCalls = 0;
  const engine = createEngine(api, {
    executionMode: 'BYOK',
    requestedConcurrency: 1,
    policyMaxConcurrency: 1,
    async dispatch() {
      providerCalls += 1;
      const error = new Error('unknown');
      error.outcome = 'UNKNOWN_OUTCOME';
      throw error;
    },
    async resolveRecovery(input) {
      assert.equal(input.purpose, 'RESOLVE');
      recoveryCalls += 1;
      return lookup.promise;
    },
  });
  const input = job('sku-1:hero', 'serialized-unknown-01');
  const attempt = engine.enqueue(input);
  await engine.whenSettled();
  const revision = engine.getSnapshot().slots
    .find((item) => item.slotKey === 'sku-1:hero').revision;
  const resolving = engine.resolveUnknownAttempt(attempt.attemptId, 'lookup-serialized-01');
  await tick();
  await assert.rejects(
    engine.resolveUnknownAttempt(attempt.attemptId, 'lookup-serialized-02'),
    (error) => error && error.code === 'SS_ERP_MEDIA_JOB_UNKNOWN_RECOVERY_IN_PROGRESS',
  );
  await assert.rejects(
    engine.retryAttempt(attempt.attemptId, {
      idempotencyKey: 'job-serialized-unknown-02',
      intentHash: input.intentHash,
      dispatchRef: 'dispatch-serialized-unknown-02',
      commandId: 'command-serialized-unknown-02',
      expectedSlotRevision: revision,
      unknownOutcomeRecovery: {
        strategy: 'DUPLICATE_CHARGE_CONFIRMATION',
        warningVersion: api.DUPLICATE_CHARGE_WARNING_VERSION,
        confirmed: true,
      },
    }),
    (error) => error && error.code === 'SS_ERP_MEDIA_JOB_UNKNOWN_RECOVERY_IN_PROGRESS',
  );
  assert.equal(recoveryCalls, 1);
  assert.equal(providerCalls, 1);
  lookup.resolve({
    kind: 'LOOKUP_RESOLUTION',
    state: 'FAILED_RETRYABLE',
    evidenceSha256: '8'.repeat(64),
    requestHash: '7'.repeat(64),
    errorCode: 'PROVIDER_NOT_ACCEPTED',
  });
  assert.equal((await resolving).state, 'FAILED_RETRYABLE');
});

test('fails closed on duplicate identities, invalid results, and unknown public fields', async () => {
  const api = loadApi();
  const engine = createEngine(api, {
    executionMode: 'BYOK',
    requestedConcurrency: 1,
    policyMaxConcurrency: 1,
    async dispatch() {
      return {
        outcome: 'SUCCEEDED',
        candidateId: '../unsafe',
        resultHandle: 'result-unsafe',
        resultSha256: 'a'.repeat(64),
        requestHash: 'b'.repeat(64),
      };
    },
  });
  const firstInput = job('sku-1:hero', 'closed-01');
  const first = engine.enqueue(firstInput);
  assert.throws(
    () => engine.enqueue(firstInput),
    (error) => error && error.code === 'SS_ERP_MEDIA_JOB_IDEMPOTENCY_CONFLICT',
  );
  await engine.whenSettled();
  assert.equal(engine.getAttempt(first.attemptId).state, 'UNKNOWN_OUTCOME');
  assert.equal(engine.getAttempt(first.attemptId).automaticRetryAllowed, false);
  assert.throws(
    () => api.createEngine({
      executionMode: 'BYOK',
      requestedConcurrency: 1,
      policyMaxConcurrency: 1,
      dispatch: async () => success('candidate'),
      unexpected: true,
    }),
    (error) => error && error.code === 'SS_ERP_MEDIA_JOB_INPUT_INVALID',
  );
  assert.equal(plain(engine.getSnapshot()).contractVersion, 'extension-byok-media-job-engine/v1');
});

test('requires regeneration instead of retry when the immutable intent hash changes', async () => {
  const api = loadApi();
  const engine = createEngine(api, {
    executionMode: 'BYOK',
    requestedConcurrency: 1,
    policyMaxConcurrency: 1,
    async dispatch() {
      const error = new Error('retryable');
      error.outcome = 'FAILED_RETRYABLE';
      throw error;
    },
  });
  const input = job('sku-1:hero', 'retry-hash-01');
  const first = engine.enqueue(input);
  await engine.whenSettled();
  const revision = engine.getSnapshot().slots
    .find((item) => item.slotKey === 'sku-1:hero').revision;
  await assert.rejects(
    engine.retryAttempt(first.attemptId, {
      idempotencyKey: 'job-retry-hash-02',
      intentHash: '7'.repeat(64),
      dispatchRef: 'dispatch-retry-hash-02',
      commandId: 'command-retry-hash-02',
      expectedSlotRevision: revision,
      chargeAcknowledgement: {
        warningVersion: api.EXTERNAL_CHARGE_WARNING_VERSION,
        confirmed: true,
      },
    }),
    (error) => error && error.code === 'SS_ERP_MEDIA_JOB_RETRY_REQUEST_MISMATCH',
  );
  assert.equal(engine.getSnapshot().attempts.length, 1);
});

test('publishes only redacted immutable snapshots to isolated listeners', async () => {
  const api = loadApi();
  const states = [];
  const engine = createEngine(api, {
    executionMode: 'BYOK',
    requestedConcurrency: 1,
    policyMaxConcurrency: 1,
    async dispatch() {
      return success('candidate-listener');
    },
  });
  const unsubscribeThrowing = engine.subscribe(() => {
    throw new Error('listener failure must stay isolated');
  });
  const unsubscribe = engine.subscribe((snapshot) => {
    assert.equal(Object.isFrozen(snapshot), true);
    states.push(snapshot.schedulerState);
    assert.equal(JSON.stringify(snapshot).includes('private-dispatch-listener-01'), false);
  });
  engine.enqueue(job('sku-1:hero', 'listener-01'));
  await engine.whenSettled();
  assert.ok(states.includes('READY'));
  assert.ok(states.includes('RUNNING'));
  assert.ok(states.includes('REVIEW'));
  assert.equal(unsubscribe(), true);
  assert.equal(unsubscribe(), false);
  assert.equal(unsubscribeThrowing(), true);
  assert.throws(
    () => engine.subscribe(null),
    (error) => error && error.code === 'SS_ERP_MEDIA_JOB_INPUT_INVALID',
  );
});

test('fences each slot by active work, command identity, and expected revision', async () => {
  const api = loadApi();
  const control = deferred();
  let dispatchCalls = 0;
  const engine = createEngine(api, {
    executionMode: 'BYOK',
    requestedConcurrency: 2,
    policyMaxConcurrency: 2,
    async dispatch() {
      dispatchCalls += 1;
      if (dispatchCalls === 1) return control.promise;
      return success(`candidate-fenced-${dispatchCalls}`);
    },
  });
  const initial = engine.enqueue(job('sku-1:hero', 'fenced-01'));
  await tick();
  const activeRevision = engine.getSnapshot().slots[0].revision;
  const repeat = {
    ...job('sku-1:hero', 'fenced-02'),
    commandId: 'command-fenced-02',
    expectedSlotRevision: activeRevision,
    chargeAcknowledgement: {
      warningVersion: api.EXTERNAL_CHARGE_WARNING_VERSION,
      confirmed: true,
    },
  };
  assert.throws(
    () => engine.regenerate('sku-1:hero', repeat),
    (error) => error && error.code === 'SS_ERP_MEDIA_JOB_SLOT_ACTIVE',
  );
  control.resolve(success('candidate-fenced-1'));
  await engine.whenSettled();
  assert.throws(
    () => engine.regenerate('sku-1:hero', repeat),
    (error) => error && error.code === 'SS_ERP_MEDIA_JOB_SLOT_REVISION_STALE',
  );

  const currentRevision = engine.getSnapshot().slots[0].revision;
  const second = engine.regenerate('sku-1:hero', {
    ...repeat,
    expectedSlotRevision: currentRevision,
  });
  await engine.whenSettled();
  assert.equal(engine.getAttempt(initial.attemptId).state, 'CANDIDATE_READY');
  assert.equal(engine.getAttempt(second.attemptId).state, 'CANDIDATE_READY');
  assert.throws(
    () => engine.regenerate('sku-1:hero', {
      ...job('sku-1:hero', 'fenced-03'),
      commandId: 'command-fenced-02',
      expectedSlotRevision: engine.getSnapshot().slots[0].revision,
      chargeAcknowledgement: repeat.chargeAcknowledgement,
    }),
    (error) => error && error.code === 'SS_ERP_MEDIA_JOB_COMMAND_CONFLICT',
  );
  assert.equal(dispatchCalls, 2);
});

test('rejects duplicate initial slots atomically and maps terminal aggregate states', async () => {
  const api = loadApi();
  const atomic = createEngine(api, {
    executionMode: 'BYOK',
    requestedConcurrency: 2,
    policyMaxConcurrency: 2,
    async dispatch() { return success('candidate-unused'); },
  });
  assert.throws(
    () => atomic.enqueueBatch([
      job('sku-1:hero', 'atomic-01'),
      job('sku-1:hero', 'atomic-02'),
    ]),
    (error) => error && error.code === 'SS_ERP_MEDIA_JOB_SLOT_EXISTS',
  );
  assert.equal(atomic.getSnapshot().attempts.length, 0);

  const failed = createEngine(api, {
    executionMode: 'BYOK',
    requestedConcurrency: 1,
    policyMaxConcurrency: 1,
    async dispatch() {
      const error = new Error('final');
      error.outcome = 'FAILED_FINAL';
      throw error;
    },
  });
  failed.enqueue(job('sku-1:hero', 'aggregate-failed-01'));
  await failed.whenSettled();
  assert.equal(failed.getSnapshot().schedulerState, 'FAILED');
  assert.equal(failed.pause().schedulerState, 'FAILED');

  const cancelled = createEngine(api, {
    executionMode: 'BYOK',
    requestedConcurrency: 1,
    policyMaxConcurrency: 1,
    async dispatch() { return success('candidate-never'); },
  });
  cancelled.pause();
  const queued = cancelled.enqueue(job('sku-1:hero', 'aggregate-cancelled-01'));
  assert.equal(cancelled.cancelQueued(queued.attemptId).cancelled, true);
  assert.equal(cancelled.getSnapshot().schedulerState, 'CANCELLED');
});

test('fails retryably before dispatch when an opaque dispatch reference cannot resolve', async () => {
  const api = loadApi();
  let dispatchCalls = 0;
  const engine = createEngine(api, {
    executionMode: 'BYOK',
    requestedConcurrency: 1,
    policyMaxConcurrency: 1,
    async resolveDispatchInput() {
      throw new Error('private vault unavailable');
    },
    async dispatch() {
      dispatchCalls += 1;
      return success('candidate-must-not-run');
    },
  });
  const attempt = engine.enqueue(job('sku-1:hero', 'dispatch-ref-01'));
  await engine.whenSettled();
  assert.equal(dispatchCalls, 0);
  assert.equal(engine.getAttempt(attempt.attemptId).state, 'FAILED_RETRYABLE');
  assert.equal(
    engine.getAttempt(attempt.attemptId).errorCode,
    'SS_ERP_MEDIA_JOB_DISPATCH_REF_UNAVAILABLE',
  );
});

test('exposes an explicit one-way waiting lifecycle for accepted async Provider work', async () => {
  const api = loadApi();
  const control = deferred();
  let markWaiting;
  const engine = createEngine(api, {
    executionMode: 'BYOK',
    requestedConcurrency: 1,
    policyMaxConcurrency: 1,
    async dispatch(input) {
      markWaiting = input.markWaiting;
      assert.equal(input.markWaiting(), true);
      assert.equal(input.markWaiting(), false);
      return control.promise;
    },
  });
  const attempt = engine.enqueue(job('sku-1:hero', 'waiting-01'));
  await tick();
  assert.equal(engine.getAttempt(attempt.attemptId).state, 'WAITING');
  control.resolve(success('candidate-waiting'));
  await engine.whenSettled();
  assert.equal(engine.getAttempt(attempt.attemptId).state, 'CANDIDATE_READY');
  assert.equal(markWaiting(), false);
});

test('never downgrades accepted async work to an ordinary retryable failure', async () => {
  const api = loadApi();
  const engine = createEngine(api, {
    executionMode: 'BYOK',
    requestedConcurrency: 1,
    policyMaxConcurrency: 1,
    async dispatch(input) {
      input.markWaiting();
      const error = new Error('poll channel closed after Provider acceptance');
      error.code = 'PROVIDER_POLL_UNAVAILABLE';
      error.outcome = 'FAILED_RETRYABLE';
      error.requestHash = '7'.repeat(64);
      throw error;
    },
  });
  const input = job('sku-1:hero', 'waiting-failure-01');
  const attempt = engine.enqueue(input);
  await engine.whenSettled();
  const failed = engine.getAttempt(attempt.attemptId);
  assert.equal(failed.state, 'UNKNOWN_OUTCOME');
  assert.equal(failed.automaticRetryAllowed, false);
  assert.equal(failed.recoveryRequirement, api.UNKNOWN_RECOVERY_REQUIREMENT);
  await assert.rejects(
    engine.retryAttempt(attempt.attemptId, {
      idempotencyKey: 'job-waiting-failure-02',
      intentHash: input.intentHash,
      dispatchRef: 'dispatch-waiting-failure-02',
      commandId: 'command-waiting-failure-02',
      expectedSlotRevision: engine.getSnapshot().slots[0].revision,
      chargeAcknowledgement: {
        warningVersion: api.EXTERNAL_CHARGE_WARNING_VERSION,
        confirmed: true,
      },
    }),
    (error) => error && error.code === 'SS_ERP_MEDIA_JOB_UNKNOWN_RECOVERY_REQUIRED',
  );
});

test('reserves the global attempt bound across concurrent trusted recovery awaits', async () => {
  const api = loadApi();
  const recovery = deferred();
  const engine = createEngine(api, {
    executionMode: 'BYOK',
    requestedConcurrency: 4,
    policyMaxConcurrency: 4,
    runnerMaxConcurrency: 4,
    async dispatch() {
      const error = new Error('unknown Provider outcome');
      error.code = 'PROVIDER_OUTCOME_UNKNOWN';
      throw error;
    },
    async resolveRecovery() {
      return recovery.promise;
    },
  });
  const originals = [];
  for (let offset = 0; offset < 499; offset += 100) {
    const count = Math.min(100, 499 - offset);
    const inputs = Array.from({ length: count }, (_, index) => {
      const ordinal = offset + index;
      return job(`sku-${ordinal}:hero`, `capacity-${ordinal}`);
    });
    const attempts = engine.enqueueBatch(inputs);
    originals.push(...attempts.map((attempt, index) => ({ attempt, input: inputs[index] })));
    await engine.whenSettled();
  }
  assert.equal(engine.getSnapshot().attempts.length, 499);
  const revisions = new Map(engine.getSnapshot().slots.map((slot) => [slot.slotKey, slot.revision]));
  const pending = originals.map(({ attempt, input }, index) => engine.retryAttempt(
    attempt.attemptId,
    {
      idempotencyKey: `recovered-capacity-${index}`,
      intentHash: input.intentHash,
      dispatchRef: `dispatch-recovered-capacity-${index}`,
      commandId: `command-recovered-capacity-${index}`,
      expectedSlotRevision: revisions.get(input.slotKey),
      unknownOutcomeRecovery: {
        strategy: 'TRUSTED_RECOVERY_REF',
        recoveryRef: `recovery-capacity-${index}`,
      },
    },
  ));
  await tick();
  recovery.resolve({
    kind: 'RETRY_AUTHORITY',
    strategy: 'PROVIDER_LOOKUP_NOT_ACCEPTED',
    evidenceSha256: '9'.repeat(64),
  });
  const settled = await Promise.allSettled(pending);
  assert.equal(settled.filter((item) => item.status === 'fulfilled').length, 1);
  assert.ok(settled.filter((item) => item.status === 'rejected').every(
    (item) => item.reason && item.reason.code === 'SS_ERP_MEDIA_JOB_LIMIT_REACHED',
  ));
  await engine.whenSettled();
  assert.equal(engine.getSnapshot().attempts.length, 500);
});

test('pauses queued Provider work when the result vault applies backpressure', async () => {
  const api = loadApi();
  const starts = [];
  let capacityAvailable = false;
  const engine = createEngine(api, {
    executionMode: 'BYOK',
    requestedConcurrency: 1,
    policyMaxConcurrency: 1,
    async dispatch(input) {
      starts.push(input.attemptId);
      if (!capacityAvailable) {
        const error = new Error('result vault is full');
        error.code = 'SS_ERP_BYOK_RESULT_VAULT_FULL';
        error.requestHash = '8'.repeat(64);
        throw error;
      }
      return success(`candidate-${input.attemptId}`);
    },
  });
  const attempts = engine.enqueueBatch([
    job('sku-1:hero', 'backpressure-01'),
    job('sku-2:hero', 'backpressure-02'),
  ]);
  await engine.whenSettled();
  let snapshot = engine.getSnapshot();
  assert.equal(snapshot.schedulerState, 'PAUSED');
  assert.equal(snapshot.pauseRequested, true);
  assert.equal(snapshot.queuedCount, 1);
  assert.deepEqual(starts, [attempts[0].attemptId]);
  assert.equal(engine.getAttempt(attempts[0].attemptId).state, 'UNKNOWN_OUTCOME');

  capacityAvailable = true;
  engine.continue();
  await engine.whenSettled();
  snapshot = engine.getSnapshot();
  assert.equal(snapshot.pauseRequested, false);
  assert.equal(snapshot.queuedCount, 0);
  assert.deepEqual(starts, attempts.map((attempt) => attempt.attemptId));
  assert.equal(engine.getAttempt(attempts[1].attemptId).state, 'CANDIDATE_READY');
});
