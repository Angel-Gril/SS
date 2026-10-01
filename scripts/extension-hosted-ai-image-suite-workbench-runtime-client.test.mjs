import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const modulePath =
  'extensions/ss-erp/shared/hosted/ai-image-suite-workbench-runtime-client.js';

function loadApi() {
  const context = {
    Array, Boolean, Date, Error, JSON, Map, Math, Number, Object, Promise,
    RegExp, Set, String, TypeError, clearTimeout, setTimeout,
  };
  context.globalThis = context;
  vm.runInNewContext(readFileSync(modulePath, 'utf8'), context, { filename: modulePath });
  return context.SS_ERP_HOSTED_AI_IMAGE_SUITE_WORKBENCH_RUNTIME_CLIENT;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function binding(overrides = {}) {
  return {
    snapshotId: 'snapshot-1',
    supplyGoodsId: 'goods-1',
    shopId: 'shop-1',
    listingWorkflowId: 'listing-workflow-1',
    draftRevision: 11,
    draftVersion: 7,
    ...overrides,
  };
}

function intent(action, overrides = {}) {
  const value = {
    version: 'extension-ai-image-suite-intent-witness/v1',
    context: binding(),
    authorityHash: 'a'.repeat(64),
    action,
    slotId: null,
    decision: null,
    commandTemplate: null,
  };
  if (action === 'START') {
    value.commandTemplate = {
      expectedPreviewHash: 'b'.repeat(64),
      acceptedPricingVersion: 'pricing-v1',
      acceptedEstimatedCostCents: 18,
      acceptedMaximumCostCents: 24,
    };
  } else if (action === 'CONTINUE' || action === 'CANCEL') {
    value.commandTemplate = { suiteId: 'suite-1', expectedSuiteRevision: 8 };
  } else if (action === 'RETRY_SLOT') {
    value.slotId = 'slot-1';
    value.commandTemplate = {
      suiteId: 'suite-1',
      slotId: 'slot-1',
      expectedSuiteRevision: 8,
      expectedSlotRevision: 5,
      acceptedAdditionalMaximumCostCents: 12,
    };
  } else if (action === 'REVIEW_SLOT') {
    value.slotId = 'slot-1';
    value.decision = 'APPROVE';
    value.commandTemplate = {
      suiteId: 'suite-1',
      slotId: 'slot-1',
      workflowId: 'child-workflow-1',
      outputAssetId: 'asset-1',
      expectedSuiteRevision: 8,
      expectedSlotRevision: 5,
      expectedWorkflowRevision: 4,
      decisions: ['APPROVE', 'REJECT'],
    };
  } else if (action === 'APPLY_SLOT') {
    value.slotId = 'slot-1';
    value.commandTemplate = {
      suiteId: 'suite-1',
      slotId: 'slot-1',
      workflowId: 'child-workflow-1',
      outputAssetId: 'asset-1',
      expectedSuiteRevision: 8,
      expectedSlotRevision: 5,
      expectedWorkflowRevision: 4,
      mode: 'append',
      target: 'ERP_SOURCE_PRODUCT',
      writesStoreDraft: false,
      expectedTargetUpdatedAt: '2026-07-27T08:00:00.000Z',
    };
  }
  return { ...value, ...overrides };
}

function planData(overrides = {}) {
  return {
    contractVersion: 'extension-hosted-ai-image-suite-workbench-client/v1',
    replayed: false,
    policyRevision: 9,
    binding: binding(),
    plan: {
      id: 'plan-1',
      revision: 3,
      latestVersion: 2,
      reviewStatus: 'APPROVED',
    },
    ...overrides,
  };
}

function modeLockData(overrides = {}) {
  return {
    contractVersion: 'extension-hosted-ai-image-mode-lock/v1',
    context: binding(),
    state: 'NO_SUITE',
    hostedExecutionEnabled: false,
    ...overrides,
  };
}

function suiteData(overrides = {}) {
  return {
    contractVersion: 'hosted-ai-image-suite-workbench-adapter/v1',
    executionMode: 'ERP_HOSTED',
    binding: {
      shopId: 'shop-1',
      workflowId: 'listing-workflow-1',
      draftRevision: 11,
      draftVersion: 7,
    },
    sourceBinding: {
      snapshotId: 'snapshot-1',
      supplyGoodsId: 'goods-1',
      skuKey: 'sku-1',
    },
    applyPolicy: {
      target: 'ERP_SOURCE_PRODUCT',
      mode: 'append',
      writesStoreDraft: false,
    },
    quote: {
      pricingVersion: 'pricing-v1',
      itemCount: 1,
      estimatedCostCents: 18,
      maximumCostCents: 24,
    },
    plan: {
      id: 'plan-1',
      revision: 3,
      startIntent: intent('START'),
    },
    suite: null,
    ...overrides,
  };
}

function executeData(action) {
  return {
    contractVersion: 'extension-hosted-ai-image-suite-workbench-client/v1',
    state: 'completed',
    replayed: false,
    action,
  };
}

function previewData(overrides = {}) {
  return {
    contractVersion: 'extension-hosted-ai-image-suite-candidate-preview-channel/v1',
    channelName: 'ss-erp:hosted-candidate-preview:' + 'c'.repeat(48),
    previewTicket: 'hp_' + 'd'.repeat(48),
    expiresAt: '2026-07-27T08:00:30.000Z',
    metadata: { mimeType: 'image/png', byteLength: null },
    ...overrides,
  };
}

function assignmentData() {
  return {
    contractVersion: 'extension-hosted-ai-image-listing-assignment/v2',
    batchId: 'assignment-batch-1',
    replayed: false,
    shopId: 'shop-1',
    listingWorkflowId: 'listing-workflow-1',
    sourceDraftRevision: 11,
    sourceDraftVersion: 7,
    boundDraftRevision: 12,
    boundDraftVersion: 8,
    assignments: [{
      assignmentId: 'assignment-1',
      skuKey: 'sku-1',
      slotKey: 'hero-primary',
      assignmentScope: 'SKU',
      assignmentOrdinal: 0,
      assetId: 'asset-1',
    }],
    validationStatus: 'STALE',
    publishReadiness: 'STALE',
  };
}

function responseFor(message) {
  const type = message.type;
  if (type.endsWith('GET_MODE_LOCK')) return { ok: true, data: modeLockData() };
  if (type.endsWith('GET_CURRENT_PLAN')
    || type.endsWith('CREATE_PLAN')
    || type.endsWith('GET_PLAN')
    || type.endsWith('REVIEW_PLAN')) return { ok: true, data: planData() };
  if (type.endsWith('LOAD_SUITE')) return { ok: true, data: suiteData() };
  if (type.endsWith('EXECUTE_INTENT')) {
    return { ok: true, data: executeData(message.payload.intent.action) };
  }
  if (type.endsWith('OPEN_PREVIEW')) return { ok: true, data: previewData() };
  if (type.endsWith('ASSIGN_APPROVED_OUTPUT')) {
    return { ok: true, data: assignmentData() };
  }
  if (type.endsWith('CLEAR')) return { ok: true, data: { cleared: true } };
  throw new Error('unexpected message type');
}

function harness(api, options = {}) {
  const calls = [];
  const runtime = {
    lastError: null,
    sendMessage(message, callback) {
      calls.push(message);
      if (options.noResponse) return;
      const response = options.respond
        ? options.respond(message, runtime)
        : responseFor(message);
      if (response !== harness.NO_CALLBACK) callback(response);
    },
  };
  const client = api.createClient({
    runtime,
    now: () => new Date('2026-07-27T08:00:00.000Z'),
    timeoutMs: options.timeoutMs,
    setTimeout: options.setTimeout,
    clearTimeout: options.clearTimeout,
  });
  return { calls, client, runtime };
}
harness.NO_CALLBACK = Symbol('NO_CALLBACK');

async function rejectsCode(value, code, predicate) {
  await assert.rejects(
    value,
    (error) => error?.code === code && (!predicate || predicate(error)),
  );
}

const api = loadApi();
{
  const creativeBrief = { prompt: '浅灰背景\n柔光', negativePrompt: '' };
  const selected = harness(api, { respond() {
    return { ok: true, data: planData({ plan: {
      currentVersion: { creativeBrief: plain(creativeBrief) },
      approvedVersion: { creativeBrief: plain(creativeBrief) },
    } }) };
  } });
  const result = await selected.client.createPlan({ binding: binding(), idempotencyKey: 'brief-plan-1', creativeBrief });
  assert.deepEqual(plain(selected.calls[0].payload.creativeBrief), creativeBrief);
  assert.equal(Object.isFrozen(selected.calls[0].payload.creativeBrief), true);
  assert.deepEqual(plain(result.plan.currentVersion.creativeBrief), creativeBrief);
  assert.deepEqual(plain(result.plan.approvedVersion.creativeBrief), creativeBrief);
  creativeBrief.prompt = 'changed';
  assert.equal(selected.calls[0].payload.creativeBrief.prompt, '浅灰背景\n柔光');
  for (const invalid of [
    null, [], {}, { prompt: '' }, { prompt: ' padded ' }, { prompt: '😀'.repeat(301) },
    { prompt: 'light', negativePrompt: '😀'.repeat(151) }, { prompt: 'light', negativePrompt: null },
    { prompt: 'light', provider: 'test' }, { prompt: 'light\tbackground' }, { prompt: 'light\u0085background' },
    ...['https://invalid.test', 'custom://invalid', 'www.invalid.test', 'data:image/png',
      'Authorization: Bearer secret', 'API key=secret', '方向 sk-secret123'].map((prompt) => ({ prompt })),
  ]) {
    assert.throws(() => selected.client.createPlan({
      binding: binding(), idempotencyKey: 'brief-plan-1', creativeBrief: invalid,
    }), { code: 'SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID' });
  }
  assert.equal(selected.calls.length, 1);
  const unicode = harness(api);
  await unicode.client.createPlan({ binding: binding(), idempotencyKey: 'unicode-brief-1',
    creativeBrief: { prompt: '😀'.repeat(300), negativePrompt: '😀'.repeat(150) } });
  for (const plan of [
    { creativeBrief: { prompt: 'light' } },
    { currentVersion: { creativeBrief: { prompt: 'light', provider: 'test' } } },
    { currentVersion: { creativeBrief: { prompt: 'API key=secret' } } },
    { currentVersion: { creativeBrief: { prompt: 'light' }, prompt: 'provider raw prompt' } },
  ]) {
    const bad = harness(api, { respond() { return { ok: true, data: planData({ plan }) }; } });
    await rejectsCode(bad.client.getCurrentPlan(binding()), 'SS_ERP_HOSTED_WORKBENCH_RESPONSE_INVALID');
  }
}
{
  const selected = harness(api);
  const candidateMediaKeys = ['reference-1', 'reference-2'];
  await selected.client.createPlan({ binding: binding(), idempotencyKey: 'refs-plan-1', candidateMediaKeys });
  assert.deepEqual(plain(selected.calls[0].payload.candidateMediaKeys), ['reference-1', 'reference-2']);
  assert.equal(Object.isFrozen(selected.calls[0].payload.candidateMediaKeys), true);
  candidateMediaKeys.push('mutated');
  assert.deepEqual(plain(selected.calls[0].payload.candidateMediaKeys), ['reference-1', 'reference-2']);
  for (const invalid of [null, [], 'reference-1', ['reference-1', 'reference-1'], [''], [' padded '],
    ['x'.repeat(501)], Array.from({ length: 26 }, (_, index) => 'reference-' + index),
    ['ＡＢＣ'], ['reference\n1'], ['reference\u007f1'], ['https://invalid.test'],
    ['custom://invalid'], ['data:image/png'], ['javascript:alert'], ['ws:socket'], ['www.invalid.test'], ['ref?query'], ['ref#hash']]) {
    assert.throws(() => selected.client.createPlan({ binding: binding(), idempotencyKey: 'refs-plan-1', candidateMediaKeys: invalid }), { code: 'SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID' });
  }
  assert.equal(selected.calls.length, 1);
}
{
  const selected = harness(api);
  const galleryGoals = ['scene'];
  await selected.client.createPlan({ binding: binding(), idempotencyKey: 'gallery-plan-1', galleryGoals });
  assert.deepEqual(plain(selected.calls[0].payload.galleryGoals), ['scene']);
  galleryGoals.push('detail');
  assert.deepEqual(plain(selected.calls[0].payload.galleryGoals), ['scene']);
  assert.equal(Object.isFrozen(selected.calls[0].payload.galleryGoals), true);
  for (const invalid of [null, [], ['scene', 'scene'], ['hero'], ['SCENE'], 'scene', ['scene', 1]]) {
    assert.throws(() => selected.client.createPlan({
      binding: binding(), idempotencyKey: 'gallery-plan-1', galleryGoals: invalid,
    }), { code: 'SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID' });
  }
  assert.equal(selected.calls.length, 1);
}
assert.equal(
  api.CONTRACT_VERSION,
  'extension-hosted-ai-image-suite-workbench-runtime-client/v1',
);
assert.equal(api.DEFAULT_TIMEOUT_MS, 30_000);
assert.equal(api.MAXIMUM_PREVIEW_CLOCK_SKEW_MS, 30_000);
assert.deepEqual([...api.BINDING_KEYS], [
  'snapshotId', 'supplyGoodsId', 'shopId', 'listingWorkflowId',
  'draftRevision', 'draftVersion',
]);
assert.deepEqual(plain(api.MESSAGE_TYPES), {
  GET_MODE_LOCK: 'SS_ERP_HOSTED_WORKBENCH_GET_MODE_LOCK',
  GET_CURRENT_PLAN: 'SS_ERP_HOSTED_WORKBENCH_GET_CURRENT_PLAN',
  CREATE_PLAN: 'SS_ERP_HOSTED_WORKBENCH_CREATE_PLAN',
  GET_PLAN: 'SS_ERP_HOSTED_WORKBENCH_GET_PLAN',
  REVIEW_PLAN: 'SS_ERP_HOSTED_WORKBENCH_REVIEW_PLAN',
  LOAD_SUITE: 'SS_ERP_HOSTED_WORKBENCH_LOAD_SUITE',
  EXECUTE_INTENT: 'SS_ERP_HOSTED_WORKBENCH_EXECUTE_INTENT',
  OPEN_PREVIEW: 'SS_ERP_HOSTED_WORKBENCH_OPEN_PREVIEW',
  ASSIGN_APPROVED_OUTPUT: 'SS_ERP_HOSTED_WORKBENCH_ASSIGN_APPROVED_OUTPUT',
  CLEAR: 'SS_ERP_HOSTED_WORKBENCH_CLEAR',
});
assert.equal(Object.isFrozen(api), true);
assert.equal(Object.isFrozen(api.MESSAGE_TYPES), true);

{
  const skewed = harness(api, {
    respond(message) {
      if (message.type.endsWith('OPEN_PREVIEW')) {
        return { ok: true, data: previewData({
          expiresAt: '2026-07-27T08:00:40.000Z',
        }) };
      }
      return responseFor(message);
    },
  });
  const result = await skewed.client.openPreview({ binding: binding(), slotId: 'slot-1' });
  assert.equal(result.expiresAt, '2026-07-27T08:00:40.000Z');

  const excessive = harness(api, {
    respond(message) {
      if (message.type.endsWith('OPEN_PREVIEW')) {
        return { ok: true, data: previewData({
          expiresAt: '2026-07-27T08:01:00.001Z',
        }) };
      }
      return responseFor(message);
    },
  });
  await rejectsCode(
    excessive.client.openPreview({ binding: binding(), slotId: 'slot-1' }),
    'SS_ERP_HOSTED_WORKBENCH_RESPONSE_INVALID',
  );
}

const test = harness(api);
const sourceBinding = binding();
const modeLock = await test.client.getModeLock(sourceBinding);
const current = await test.client.getCurrentPlan(sourceBinding);
const created = await test.client.createPlan({
  binding: sourceBinding,
  idempotencyKey: 'plan-create-0001',
});
await test.client.getPlan({ binding: sourceBinding, planId: 'plan-1' });
await test.client.reviewPlan({
  binding: sourceBinding,
  planId: 'plan-1',
  expectedRevision: 2,
  operationKey: 'plan-review-0001',
  decision: 'APPROVE',
  note: null,
});
const suite = await test.client.loadSuite(sourceBinding);
const executed = await test.client.executeIntent({
  binding: sourceBinding,
  intent: intent('START'),
  confirmation: { confirmed: true, maximumCostCents: 24 },
});
const preview = await test.client.openPreview({ binding: sourceBinding, slotId: 'slot-1' });
const assignment = await test.client.assignApprovedOutputs({
  binding: sourceBinding,
  intents: [intent('APPLY_SLOT')],
  assignmentStartOrdinal: 0,
  idempotencyKey: 'assignment-key-0001',
});
const cleared = await test.client.clear(sourceBinding);

assert.equal(current.plan.id, 'plan-1');
assert.equal(modeLock.state, 'NO_SUITE');
assert.equal(modeLock.hostedExecutionEnabled, false);
assert.equal(created.policyRevision, 9);
assert.equal(suite.executionMode, 'ERP_HOSTED');
assert.equal(executed.action, 'START');
assert.match(preview.channelName, /^ss-erp:hosted-candidate-preview:/u);
assert.equal(assignment.boundDraftRevision, 12);
assert.deepEqual(plain(cleared), { cleared: true });
for (const result of [modeLock, current, created, suite, executed, preview, assignment, cleared]) {
  assert.equal(Object.isFrozen(result), true);
}

assert.deepEqual(test.calls.map((call) => call.type), Object.values(api.MESSAGE_TYPES));
for (const call of test.calls) {
  assert.deepEqual(plain(call.payload.binding), binding());
  assert.deepEqual(Object.keys(call.payload.binding), [...api.BINDING_KEYS]);
  assert.equal(Object.isFrozen(call), true);
  assert.equal(Object.isFrozen(call.payload.binding), true);
}
assert.deepEqual(plain(test.calls[2].payload), {
  binding: binding(),
  idempotencyKey: 'plan-create-0001',
});
assert.deepEqual(plain(test.calls[4].payload), {
  binding: binding(),
  planId: 'plan-1',
  expectedRevision: 2,
  operationKey: 'plan-review-0001',
  decision: 'APPROVE',
  note: null,
});
assert.deepEqual(plain(test.calls[6].payload.confirmation), {
  confirmed: true,
  maximumCostCents: 24,
});
assert.equal(test.calls[8].payload.intents[0].action, 'APPLY_SLOT');

sourceBinding.shopId = 'mutated-after-call';
assert.equal(test.calls[0].payload.binding.shopId, 'shop-1');

const inputCount = test.calls.length;
assert.throws(
  () => test.client.getCurrentPlan(binding({ ownerUserId: 'forged' })),
  (error) => error?.code === 'SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID',
);
assert.throws(
  () => test.client.getPlan({ binding: binding(), planId: 'https://private.example/plan' }),
  (error) => error?.code === 'SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID',
);
assert.throws(
  () => test.client.reviewPlan({
    binding: binding(),
    planId: 'plan-1',
    expectedRevision: 2,
    operationKey: 'plan-review-0002',
    decision: 'APPROVE',
    note: 'see https://private.example',
  }),
  (error) => error?.code === 'SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID',
);
assert.throws(
  () => test.client.executeIntent({
    binding: binding(),
    intent: intent('START'),
    confirmation: { confirmed: true, maximumCostCents: 23 },
  }),
  (error) => error?.code === 'SS_ERP_HOSTED_WORKBENCH_COST_CONFIRMATION_REQUIRED',
);
assert.throws(
  () => test.client.executeIntent({
    binding: binding(),
    intent: intent('APPLY_SLOT'),
    confirmation: null,
  }),
  (error) => error?.code === 'SS_ERP_HOSTED_WORKBENCH_ASSIGNMENT_REQUIRED',
);
assert.throws(
  () => test.client.assignApprovedOutputs({
    binding: binding(),
    intents: [intent('REVIEW_SLOT')],
    assignmentStartOrdinal: 0,
    idempotencyKey: 'assignment-key-0002',
  }),
  (error) => error?.code === 'SS_ERP_HOSTED_WORKBENCH_ASSIGNMENT_REQUIRED',
);
assert.throws(
  () => test.client.openPreview({
    binding: binding({ shopId: 'shop-other' }),
    slotId: 'slot-1',
  }),
  (error) => error?.code === 'SS_ERP_HOSTED_WORKBENCH_CONTEXT_STALE',
);
assert.equal(test.calls.length, inputCount);

for (const [forbiddenKey, forbiddenValue] of [
  ['previewUrl', 'private-location'],
  ['base64Image', 'encoded-image'],
  ['providerId', 'provider-secret'],
  ['modelId', 'model-secret'],
  ['promptText', 'prompt-secret'],
  ['storageKey', 'private-object'],
  ['jobId', 'job-secret'],
  ['billingId', 'billing-secret'],
  ['rawProjection', { internal: true }],
]) {
  const leaking = harness(api, {
    respond() {
      const value = planData();
      value.plan[forbiddenKey] = forbiddenValue;
      return { ok: true, data: value };
    },
  });
  await rejectsCode(
    leaking.client.getCurrentPlan(binding()),
    'SS_ERP_HOSTED_WORKBENCH_RESPONSE_INVALID',
  );
}

const leakingString = harness(api, {
  respond() {
    const value = planData();
    value.plan.goal = 'https://provider.example/private.png';
    return { ok: true, data: value };
  },
});
await rejectsCode(
  leakingString.client.getCurrentPlan(binding()),
  'SS_ERP_HOSTED_WORKBENCH_RESPONSE_INVALID',
);

const badEnvelope = harness(api, {
  respond() { return { ok: true, data: planData(), trace: 'internal' }; },
});
await rejectsCode(
  badEnvelope.client.getCurrentPlan(binding()),
  'SS_ERP_HOSTED_WORKBENCH_RESPONSE_INVALID',
);

const knownFailure = harness(api, {
  respond() {
    return {
      ok: false,
      errorCode: 'SS_ERP_HOSTED_WORKBENCH_CONTEXT_STALE',
      error: 'details must not escape',
    };
  },
});
await rejectsCode(
  knownFailure.client.executeIntent({
    binding: binding(),
    intent: intent('CONTINUE'),
    confirmation: null,
  }),
  'SS_ERP_HOSTED_WORKBENCH_CONTEXT_STALE',
);

for (const [invoke, expectedCode, operation] of [
  [
    (client) => client.executeIntent({
      binding: binding(),
      intent: intent('START'),
      confirmation: { confirmed: true, maximumCostCents: 24 },
    }),
    'SS_ERP_HOSTED_WORKBENCH_EXECUTION_UNKNOWN_OUTCOME',
    'EXECUTE_INTENT',
  ],
  [
    (client) => client.assignApprovedOutputs({
      binding: binding(), intents: [intent('APPLY_SLOT')],
      assignmentStartOrdinal: 0,
      idempotencyKey: 'assignment-key-response-loss',
    }),
    'SS_ERP_HOSTED_WORKBENCH_ASSIGNMENT_UNKNOWN_OUTCOME',
    'ASSIGN_APPROVED_OUTPUT',
  ],
]) {
  const forwardedUnknown = harness(api, {
    respond() {
      return {
        ok: false,
        errorCode: expectedCode,
        error: 'details must not escape',
      };
    },
  });
  await rejectsCode(
    invoke(forwardedUnknown.client),
    expectedCode,
    (error) => error.outcome === 'UNKNOWN_OUTCOME'
      && error.automaticRetryAllowed === false
      && error.operation === operation,
  );
}

const mutatedResponse = planData();
const cloneTest = harness(api, {
  respond() { return { ok: true, data: mutatedResponse }; },
});
const cloned = await cloneTest.client.getCurrentPlan(binding());
mutatedResponse.plan.id = 'changed-after-response';
assert.equal(cloned.plan.id, 'plan-1');
assert.equal(Object.isFrozen(cloned.plan), true);

for (const [method, expectedCode, operation] of [
  [
    (client) => client.executeIntent({
      binding: binding(),
      intent: intent('START'),
      confirmation: { confirmed: true, maximumCostCents: 24 },
    }),
    'SS_ERP_HOSTED_WORKBENCH_EXECUTION_UNKNOWN_OUTCOME',
    'EXECUTE_INTENT',
  ],
  [
    (client) => client.assignApprovedOutputs({
      binding: binding(),
      intents: [intent('APPLY_SLOT')],
      assignmentStartOrdinal: 0,
      idempotencyKey: 'assignment-key-timeout',
    }),
    'SS_ERP_HOSTED_WORKBENCH_ASSIGNMENT_UNKNOWN_OUTCOME',
    'ASSIGN_APPROVED_OUTPUT',
  ],
]) {
  const timedOut = harness(api, { noResponse: true, timeoutMs: 5 });
  await rejectsCode(method(timedOut.client), expectedCode, (error) => (
    error.outcome === 'UNKNOWN_OUTCOME'
      && error.automaticRetryAllowed === false
      && error.operation === operation
  ));
  assert.equal(timedOut.calls.length, 1, 'the runtime client must never retry a mutation');
}

const invalidMutationResponse = harness(api, {
  respond() {
    return { ok: true, data: { contractVersion: 'invalid/v1' } };
  },
});
await rejectsCode(
  invalidMutationResponse.client.executeIntent({
    binding: binding(),
    intent: intent('CONTINUE'),
    confirmation: null,
  }),
  'SS_ERP_HOSTED_WORKBENCH_EXECUTION_UNKNOWN_OUTCOME',
  (error) => error.outcome === 'UNKNOWN_OUTCOME' && error.automaticRetryAllowed === false,
);

const lastErrorMutation = harness(api, {
  respond(_message, runtime) {
    runtime.lastError = { message: 'port closed' };
    return { ok: true, data: executeData('CONTINUE') };
  },
});
await rejectsCode(
  lastErrorMutation.client.executeIntent({
    binding: binding(),
    intent: intent('CONTINUE'),
    confirmation: null,
  }),
  'SS_ERP_HOSTED_WORKBENCH_EXECUTION_UNKNOWN_OUTCOME',
  (error) => error.outcome === 'UNKNOWN_OUTCOME',
);

const scheduledDelays = [];
const cappedTimeout = harness(api, {
  noResponse: true,
  timeoutMs: 60_000,
  setTimeout(callback, delay) {
    scheduledDelays.push(delay);
    queueMicrotask(callback);
    return 1;
  },
  clearTimeout() {},
});
await rejectsCode(
  cappedTimeout.client.getCurrentPlan(binding()),
  'SS_ERP_HOSTED_WORKBENCH_RUNTIME_TIMEOUT',
);
assert.deepEqual(scheduledDelays, [30_000]);

assert.throws(
  () => api.createClient({ runtime: {} }),
  (error) => error?.code === 'SS_ERP_HOSTED_WORKBENCH_RUNTIME_UNAVAILABLE',
);

const source = readFileSync(modulePath, 'utf8');
assert.doesNotMatch(source, /SS_ERP_BYOK|generated-asset-ingest|\/byok(?:\/|\b)/iu);

console.log('extension hosted AI image suite workbench runtime client tests passed');
