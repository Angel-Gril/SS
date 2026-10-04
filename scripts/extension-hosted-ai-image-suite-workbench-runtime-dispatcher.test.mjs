import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const modulePath =
  'extensions/ss-erp/shared/hosted/ai-image-suite-workbench-runtime-dispatcher.js';

function loadApi() {
  const context = {
    Array, Boolean, Date, Error, JSON, Map, Math, Number, Object, Promise,
    RegExp, Set, String, TypeError,
  };
  context.globalThis = context;
  vm.runInNewContext(readFileSync(modulePath, 'utf8'), context, { filename: modulePath });
  return context.SS_ERP_HOSTED_AI_IMAGE_SUITE_WORKBENCH_RUNTIME_DISPATCHER;
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
  const sourceBinding = binding();
  const common = {
    version: 'extension-ai-image-suite-intent-witness/v1',
    context: sourceBinding,
    authorityHash: 'a'.repeat(64),
    action,
    slotId: null,
    decision: null,
    commandTemplate: null,
  };
  if (action === 'START') {
    common.commandTemplate = {
      expectedPreviewHash: 'b'.repeat(64),
      acceptedPricingVersion: 'pricing-v1',
      acceptedEstimatedCostCents: 18,
      acceptedMaximumCostCents: 24,
    };
  } else if (action === 'CONTINUE' || action === 'CANCEL') {
    common.commandTemplate = { suiteId: 'suite-1', expectedSuiteRevision: 8 };
  } else if (action === 'RETRY_SLOT') {
    common.slotId = 'slot-1';
    common.commandTemplate = {
      suiteId: 'suite-1', slotId: 'slot-1', expectedSuiteRevision: 8,
      expectedSlotRevision: 5, acceptedAdditionalMaximumCostCents: 12,
    };
  } else if (action === 'REVIEW_SLOT') {
    common.slotId = 'slot-1';
    common.decision = 'APPROVE';
    common.commandTemplate = {
      suiteId: 'suite-1', slotId: 'slot-1', workflowId: 'child-workflow-1',
      outputAssetId: 'asset-1', expectedSuiteRevision: 8, expectedSlotRevision: 5,
      expectedWorkflowRevision: 4, decisions: ['APPROVE', 'REJECT'],
    };
  } else if (action === 'APPLY_SLOT') {
    common.slotId = 'slot-1';
    common.commandTemplate = {
      suiteId: 'suite-1', slotId: 'slot-1', workflowId: 'child-workflow-1',
      outputAssetId: 'asset-1', expectedSuiteRevision: 8, expectedSlotRevision: 5,
      expectedWorkflowRevision: 4, mode: 'append', target: 'ERP_SOURCE_PRODUCT',
      writesStoreDraft: false, expectedTargetUpdatedAt: '2026-07-27T08:00:00.000Z',
    };
  }
  return { ...common, ...overrides };
}

const MESSAGE_TYPES = Object.freeze({
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

function planOutput(name) {
  return {
    contractVersion: 'extension-hosted-ai-image-suite-workbench-client/v1',
    replayed: false,
    policyRevision: 9,
    binding: binding(),
    plan: null,
    operation: name,
  };
}

function modeLockOutput() {
  return {
    contractVersion: 'extension-hosted-ai-image-mode-lock/v1',
    context: binding(),
    state: 'NO_SUITE',
    hostedExecutionEnabled: false,
  };
}

function suiteOutput() {
  return {
    contractVersion: 'hosted-ai-image-suite-workbench-adapter/v1',
    executionMode: 'ERP_HOSTED',
    binding: {
      shopId: 'shop-1', workflowId: 'listing-workflow-1',
      draftRevision: 11, draftVersion: 7,
    },
    sourceBinding: { snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1', skuKey: 'sku-1' },
    applyPolicy: { target: 'ERP_SOURCE_PRODUCT', mode: 'append', writesStoreDraft: false },
    quote: {
      pricingVersion: 'pricing-v1', itemCount: 1,
      estimatedCostCents: 18, maximumCostCents: 24,
    },
    plan: { startIntent: intent('START') },
    suite: null,
  };
}

function fixture(api, options = {}) {
  const calls = [];
  const client = {
    async getModeLock(value) {
      calls.push(['getModeLock', value]);
      return modeLockOutput();
    },
    async getCurrentPlan(value) {
      calls.push(['getCurrentPlan', value]);
      return options.output || planOutput('current');
    },
    async createPlan(value) {
      calls.push(['createPlan', value]);
      return planOutput('create');
    },
    async getPlan(value) {
      calls.push(['getPlan', value]);
      return planOutput('get');
    },
    async reviewPlan(value) {
      calls.push(['reviewPlan', value]);
      return planOutput('review');
    },
    async loadSuite(value) {
      calls.push(['loadSuite', value]);
      return suiteOutput();
    },
    async executeIntent(value, confirmation) {
      calls.push(['executeIntent', value, confirmation]);
      return {
        contractVersion: 'extension-hosted-ai-image-suite-workbench-client/v1',
        state: 'completed', replayed: false, action: value.action,
      };
    },
    async openPreview(slotId) {
      calls.push(['openPreview', slotId]);
      return {
        contractVersion: 'extension-hosted-ai-image-suite-candidate-preview-channel/v1',
        channelName: 'ss-erp:hosted-candidate-preview:' + 'c'.repeat(48),
        previewTicket: 'hp_' + 'd'.repeat(48),
        expiresAt: '2026-07-27T08:00:30.000Z',
        metadata: { mimeType: 'image/png', byteLength: null },
      };
    },
    async assignApprovedOutputs(value) {
      calls.push(['assignApprovedOutputs', value]);
      return {
        contractVersion: 'extension-hosted-ai-image-listing-assignment/v2',
        batchId: 'assignment-batch-1', replayed: false,
        shopId: 'shop-1', listingWorkflowId: 'listing-workflow-1',
        sourceDraftRevision: 11, sourceDraftVersion: 7,
        boundDraftRevision: 12, boundDraftVersion: 8,
        assignments: [
          {
            assignmentId: 'assignment-1', skuKey: 'sku-1', slotKey: 'hero-primary',
            assignmentScope: 'SKU', assignmentOrdinal: value.assignmentStartOrdinal,
            assetId: 'asset-1',
          },
          {
            assignmentId: 'assignment-2', skuKey: 'sku-2', slotKey: 'detail-shared',
            assignmentScope: 'PRODUCT', assignmentOrdinal: value.assignmentStartOrdinal + 1,
            assetId: 'asset-2',
          },
        ],
        validationStatus: 'STALE', publishReadiness: 'STALE',
      };
    },
    async clear() { calls.push(['clear']); },
  };
  const sender = Object.freeze({ tabId: 77, documentId: 'document-1' });
  const getClient = async (receivedSender, receivedBinding) => {
    calls.push(['getClient', receivedSender, receivedBinding]);
    assert.equal(receivedSender, sender);
    assert.equal(Object.isFrozen(receivedBinding), true);
    return options.client || client;
  };
  return {
    calls,
    client,
    sender,
    dispatcher: api.createDispatcher({ messageTypes: MESSAGE_TYPES, getClient }),
  };
}

async function rejects(handler, context, code) {
  const result = await handler(context);
  assert.deepEqual(plain(result), {
    ok: false,
    errorCode: code,
    error: 'Hosted AI image workbench operation failed',
  });
  return result;
}

const api = loadApi();
{
  const creativeBrief = { prompt: '浅灰背景\n柔光', negativePrompt: '' };
  const output = planOutput('current');
  output.plan = { currentVersion: { creativeBrief: plain(creativeBrief) }, approvedVersion: { creativeBrief: plain(creativeBrief) } };
  const selected = fixture(api, { output });
  const result = await selected.dispatcher.handlers[MESSAGE_TYPES.CREATE_PLAN]({
    payload: { binding: binding(), idempotencyKey: 'brief-plan-1', creativeBrief }, sender: selected.sender,
  });
  assert.equal(result.ok, true);
  const forwarded = selected.calls.find((row) => row[0] === 'createPlan')[1];
  assert.deepEqual(plain(forwarded.creativeBrief), creativeBrief);
  assert.equal(Object.isFrozen(forwarded.creativeBrief), true);
  creativeBrief.prompt = 'changed';
  assert.equal(forwarded.creativeBrief.prompt, '浅灰背景\n柔光');
  const readback = await selected.dispatcher.handlers[MESSAGE_TYPES.GET_CURRENT_PLAN]({
    payload: { binding: binding() }, sender: selected.sender,
  });
  assert.equal(readback.ok, true);
  assert.deepEqual(plain(readback.data.plan.currentVersion.creativeBrief), output.plan.currentVersion.creativeBrief);
  assert.deepEqual(plain(readback.data.plan.approvedVersion.creativeBrief), output.plan.approvedVersion.creativeBrief);
  for (const invalid of [
    null, [], {}, { prompt: '' }, { prompt: ' padded ' }, { prompt: '😀'.repeat(301) },
    { prompt: 'light', negativePrompt: '😀'.repeat(151) }, { prompt: 'light', negativePrompt: null },
    { prompt: 'light', provider: 'test' }, { prompt: 'light\tbackground' }, { prompt: 'light\u0085background' },
    ...['https://invalid.test', 'custom://invalid', 'www.invalid.test', 'data:image/png',
      'Authorization: Bearer secret', 'API key=secret', '方向 sk-secret123'].map((prompt) => ({ prompt })),
  ]) {
    await rejects(selected.dispatcher.handlers[MESSAGE_TYPES.CREATE_PLAN], {
      payload: { binding: binding(), idempotencyKey: 'brief-plan-1', creativeBrief: invalid }, sender: selected.sender,
    }, 'SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID');
  }
  assert.equal(selected.calls.filter((row) => row[0] === 'createPlan').length, 1);
  for (const plan of [
    { creativeBrief: { prompt: 'light' } },
    { currentVersion: { creativeBrief: { prompt: 'light', provider: 'test' } } },
    { currentVersion: { creativeBrief: { prompt: 'API key=secret' } } },
    { currentVersion: { creativeBrief: { prompt: 'light' }, prompt: 'provider raw prompt' } },
  ]) {
    const bad = fixture(api, { output: { ...planOutput('current'), plan } });
    await rejects(bad.dispatcher.handlers[MESSAGE_TYPES.GET_CURRENT_PLAN], {
      payload: { binding: binding() }, sender: bad.sender,
    }, 'SS_ERP_HOSTED_WORKBENCH_OUTPUT_INVALID');
  }
}
{
  const selected = fixture(api);
  const candidateMediaKeys = ['reference-1', 'reference-2'];
  const result = await selected.dispatcher.handlers[MESSAGE_TYPES.CREATE_PLAN]({
    payload: { binding: binding(), idempotencyKey: 'refs-plan-1', candidateMediaKeys }, sender: selected.sender,
  });
  assert.equal(result.ok, true);
  const forwarded = selected.calls.find((row) => row[0] === 'createPlan')[1];
  assert.deepEqual(plain(forwarded.candidateMediaKeys), ['reference-1', 'reference-2']);
  assert.equal(Object.isFrozen(forwarded.candidateMediaKeys), true);
  candidateMediaKeys.push('mutated');
  assert.deepEqual(plain(forwarded.candidateMediaKeys), ['reference-1', 'reference-2']);
  for (const invalid of [null, [], 'reference-1', ['reference-1', 'reference-1'], [''], [' padded '],
    ['x'.repeat(501)], Array.from({ length: 26 }, (_, index) => 'reference-' + index),
    ['ＡＢＣ'], ['reference\n1'], ['reference\u007f1'], ['https://invalid.test'],
    ['custom://invalid'], ['data:image/png'], ['javascript:alert'], ['ws:socket'], ['www.invalid.test'], ['ref?query'], ['ref#hash']]) {
    await rejects(selected.dispatcher.handlers[MESSAGE_TYPES.CREATE_PLAN], {
      payload: { binding: binding(), idempotencyKey: 'refs-plan-1', candidateMediaKeys: invalid }, sender: selected.sender,
    }, 'SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID');
  }
  assert.equal(selected.calls.filter((row) => row[0] === 'createPlan').length, 1);
}
{
  const selected = fixture(api);
  const galleryGoals = ['scene'];
  const result = await selected.dispatcher.handlers[MESSAGE_TYPES.CREATE_PLAN]({
    payload: { binding: binding(), idempotencyKey: 'gallery-plan-1', galleryGoals }, sender: selected.sender,
  });
  assert.equal(result.ok, true);
  const forwarded = selected.calls.find((row) => row[0] === 'createPlan')[1];
  assert.deepEqual(plain(forwarded.galleryGoals), ['scene']);
  galleryGoals.push('detail');
  assert.deepEqual(plain(forwarded.galleryGoals), ['scene']);
  assert.equal(Object.isFrozen(forwarded.galleryGoals), true);
  const heroOnly = [];
  const heroResult = await selected.dispatcher.handlers[MESSAGE_TYPES.CREATE_PLAN]({
    payload: { binding: binding(), idempotencyKey: 'hero-only-plan-1', galleryGoals: heroOnly }, sender: selected.sender,
  });
  assert.equal(heroResult.ok, true);
  const heroForwarded = selected.calls.filter((row) => row[0] === 'createPlan')[1][1];
  assert.deepEqual(plain(heroForwarded.galleryGoals), []);
  assert.equal(Object.isFrozen(heroForwarded.galleryGoals), true);
  heroOnly.push('scene');
  assert.deepEqual(plain(heroForwarded.galleryGoals), []);
  for (const invalid of [null, ['scene', 'scene'], ['hero'], ['SCENE'], 'scene', ['scene', 1]]) {
    await rejects(selected.dispatcher.handlers[MESSAGE_TYPES.CREATE_PLAN], {
      payload: { binding: binding(), idempotencyKey: 'gallery-plan-1', galleryGoals: invalid },
      sender: selected.sender,
    }, 'SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID');
  }
  assert.equal(selected.calls.filter((row) => row[0] === 'createPlan').length, 2);
}
assert.equal(
  api.CONTRACT_VERSION,
  'extension-hosted-ai-image-suite-workbench-runtime-dispatcher/v1',
);
assert.deepEqual([...api.MESSAGE_TYPE_NAMES], Object.keys(MESSAGE_TYPES));
assert.equal(Object.isFrozen(api), true);
assert.equal(Object.isFrozen(api.MESSAGE_TYPE_NAMES), true);

const test = fixture(api);
const payloadBinding = binding();

const modeLock = await test.dispatcher.handlers[MESSAGE_TYPES.GET_MODE_LOCK]({
  payload: { binding: payloadBinding }, sender: test.sender,
});
assert.equal(modeLock.ok, true);
assert.equal(modeLock.data.state, 'NO_SUITE');

const current = await test.dispatcher.handlers[MESSAGE_TYPES.GET_CURRENT_PLAN]({
  payload: { binding: payloadBinding }, sender: test.sender,
});
assert.equal(current.ok, true);
assert.equal(current.data.operation, 'current');
assert.equal(Object.isFrozen(current.data), true);
payloadBinding.shopId = 'mutated-after-dispatch';
assert.equal(test.calls.find((row) => row[0] === 'getCurrentPlan')[1].shopId, 'shop-1');

await test.dispatcher.handlers[MESSAGE_TYPES.CREATE_PLAN]({
  payload: { binding: binding(), idempotencyKey: 'plan-create-0001' }, sender: test.sender,
});
await test.dispatcher.handlers[MESSAGE_TYPES.GET_PLAN]({
  payload: { binding: binding(), planId: 'plan-1' }, sender: test.sender,
});
await test.dispatcher.handlers[MESSAGE_TYPES.REVIEW_PLAN]({
  payload: {
    binding: binding(), planId: 'plan-1', expectedRevision: 1,
    operationKey: 'plan-review-0001', decision: 'APPROVE', note: null,
  },
  sender: test.sender,
});
await test.dispatcher.handlers[MESSAGE_TYPES.LOAD_SUITE]({
  payload: { binding: binding() }, sender: test.sender,
});
await test.dispatcher.handlers[MESSAGE_TYPES.OPEN_PREVIEW]({
  payload: { binding: binding(), slotId: 'slot-1' }, sender: test.sender,
});

assert.deepEqual(plain(test.calls.find((row) => row[0] === 'createPlan')[1]), {
  binding: binding(), idempotencyKey: 'plan-create-0001',
});
assert.deepEqual(plain(test.calls.find((row) => row[0] === 'getPlan')[1]), {
  binding: binding(), planId: 'plan-1',
});
assert.deepEqual(plain(test.calls.find((row) => row[0] === 'reviewPlan')[1]), {
  binding: binding(), planId: 'plan-1', expectedRevision: 1,
  operationKey: 'plan-review-0001', decision: 'APPROVE', note: null,
});
assert.deepEqual(plain(test.calls.find((row) => row[0] === 'loadSuite')[1]), binding());
assert.equal(test.calls.find((row) => row[0] === 'openPreview')[1], 'slot-1');

const start = intent('START');
const executed = await test.dispatcher.handlers[MESSAGE_TYPES.EXECUTE_INTENT]({
  payload: {
    binding: binding(), intent: start,
    confirmation: { confirmed: true, maximumCostCents: 24 },
  },
  sender: test.sender,
});
assert.equal(executed.ok, true);
const executeCall = test.calls.find((row) => row[0] === 'executeIntent');
assert.equal(Object.isFrozen(executeCall[1]), true);
assert.equal(Object.isFrozen(executeCall[2]), true);
assert.deepEqual(plain(executeCall[1]), start);
assert.deepEqual(plain(executeCall[2]), { confirmed: true, maximumCostCents: 24 });

const unknownClient = {
  ...test.client,
  async executeIntent() {
    throw Object.assign(new Error('execution response lost'), {
      code: 'SS_ERP_HOSTED_WORKBENCH_EXECUTION_UNKNOWN_OUTCOME',
      outcome: 'UNKNOWN_OUTCOME',
      automaticRetryAllowed: false,
    });
  },
  async assignApprovedOutputs() {
    throw Object.assign(new Error('assignment response lost'), {
      code: 'SS_ERP_HOSTED_WORKBENCH_ASSIGNMENT_UNKNOWN_OUTCOME',
      outcome: 'UNKNOWN_OUTCOME',
      automaticRetryAllowed: false,
    });
  },
};
const unknown = fixture(api, { client: unknownClient });
await rejects(
  unknown.dispatcher.handlers[MESSAGE_TYPES.EXECUTE_INTENT],
  {
    payload: {
      binding: binding(), intent: start,
      confirmation: { confirmed: true, maximumCostCents: 24 },
    },
    sender: unknown.sender,
  },
  'SS_ERP_HOSTED_WORKBENCH_EXECUTION_UNKNOWN_OUTCOME',
);

const invalidMutationOutputClient = {
  ...test.client,
  async executeIntent() {
    return {
      contractVersion: 'extension-hosted-ai-image-suite-workbench-client/v1',
      state: 'completed', replayed: false, action: 'START',
      provider: 'must-not-escape',
    };
  },
  async assignApprovedOutputs() {
    return {
      contractVersion: 'extension-hosted-ai-image-listing-assignment/v2',
      batchId: 'assignment-batch-1', provider: 'must-not-escape',
    };
  },
};
const invalidMutationOutput = fixture(api, { client: invalidMutationOutputClient });
await rejects(
  invalidMutationOutput.dispatcher.handlers[MESSAGE_TYPES.EXECUTE_INTENT],
  {
    payload: {
      binding: binding(), intent: start,
      confirmation: { confirmed: true, maximumCostCents: 24 },
    },
    sender: invalidMutationOutput.sender,
  },
  'SS_ERP_HOSTED_WORKBENCH_EXECUTION_UNKNOWN_OUTCOME',
);

await test.dispatcher.handlers[MESSAGE_TYPES.EXECUTE_INTENT]({
  payload: { binding: binding(), intent: intent('CONTINUE'), confirmation: null },
  sender: test.sender,
});
const retry = intent('RETRY_SLOT');
await rejects(
  test.dispatcher.handlers[MESSAGE_TYPES.EXECUTE_INTENT],
  {
    payload: {
      binding: binding(), intent: retry,
      confirmation: { confirmed: true, maximumCostCents: 13 },
    },
    sender: test.sender,
  },
  'SS_ERP_HOSTED_WORKBENCH_COST_CONFIRMATION_REQUIRED',
);
const retried = await test.dispatcher.handlers[MESSAGE_TYPES.EXECUTE_INTENT]({
  payload: {
    binding: binding(), intent: retry,
    confirmation: { confirmed: true, maximumCostCents: 12 },
  },
  sender: test.sender,
});
assert.equal(retried.data.action, 'RETRY_SLOT');

const executeCount = test.calls.filter((row) => row[0] === 'executeIntent').length;
await rejects(
  test.dispatcher.handlers[MESSAGE_TYPES.EXECUTE_INTENT],
  {
    payload: {
      binding: binding(), intent: start,
      confirmation: { confirmed: true, maximumCostCents: 23 },
    },
    sender: test.sender,
  },
  'SS_ERP_HOSTED_WORKBENCH_COST_CONFIRMATION_REQUIRED',
);
await rejects(
  test.dispatcher.handlers[MESSAGE_TYPES.EXECUTE_INTENT],
  {
    payload: {
      binding: binding(), intent: start,
      confirmation: { confirmed: true, maximumCostCents: '24' },
    },
    sender: test.sender,
  },
  'SS_ERP_HOSTED_WORKBENCH_COST_CONFIRMATION_REQUIRED',
);
await rejects(
  test.dispatcher.handlers[MESSAGE_TYPES.EXECUTE_INTENT],
  { payload: { binding: binding(), intent: intent('APPLY_SLOT'), confirmation: null }, sender: test.sender },
  'SS_ERP_HOSTED_WORKBENCH_ASSIGNMENT_REQUIRED',
);
assert.equal(test.calls.filter((row) => row[0] === 'executeIntent').length, executeCount);

const firstApplyIntent = intent('APPLY_SLOT');
const secondApplyIntent = intent('APPLY_SLOT', {
  slotId: 'slot-2',
  commandTemplate: {
    suiteId: 'suite-1', slotId: 'slot-2', workflowId: 'child-workflow-2',
    outputAssetId: 'asset-2', expectedSuiteRevision: 8, expectedSlotRevision: 6,
    expectedWorkflowRevision: 3, mode: 'append', target: 'ERP_SOURCE_PRODUCT',
    writesStoreDraft: false, expectedTargetUpdatedAt: '2026-07-27T08:00:00.000Z',
  },
});
const assigned = await test.dispatcher.handlers[MESSAGE_TYPES.ASSIGN_APPROVED_OUTPUT]({
  payload: {
    binding: binding(), intents: [firstApplyIntent, secondApplyIntent],
    assignmentStartOrdinal: 2,
    idempotencyKey: 'assignment-key-0001',
  },
  sender: test.sender,
});
assert.equal(assigned.ok, true);
assert.deepEqual(plain(test.calls.find((row) => row[0] === 'assignApprovedOutputs')[1]), {
  intents: [firstApplyIntent, secondApplyIntent],
  assignmentStartOrdinal: 2,
  idempotencyKey: 'assignment-key-0001',
});
await rejects(
  unknown.dispatcher.handlers[MESSAGE_TYPES.ASSIGN_APPROVED_OUTPUT],
  {
    payload: {
      binding: binding(), intents: [firstApplyIntent, secondApplyIntent],
      assignmentStartOrdinal: 2,
      idempotencyKey: 'assignment-key-response-loss',
    },
    sender: unknown.sender,
  },
  'SS_ERP_HOSTED_WORKBENCH_ASSIGNMENT_UNKNOWN_OUTCOME',
);
await rejects(
  invalidMutationOutput.dispatcher.handlers[MESSAGE_TYPES.ASSIGN_APPROVED_OUTPUT],
  {
    payload: {
      binding: binding(), intents: [firstApplyIntent, secondApplyIntent],
      assignmentStartOrdinal: 2,
      idempotencyKey: 'assignment-key-invalid-output',
    },
    sender: invalidMutationOutput.sender,
  },
  'SS_ERP_HOSTED_WORKBENCH_ASSIGNMENT_UNKNOWN_OUTCOME',
);

const cleared = await test.dispatcher.handlers[MESSAGE_TYPES.CLEAR]({
  payload: { binding: binding() }, sender: test.sender,
});
assert.deepEqual(plain(cleared), { ok: true, data: { cleared: true } });

const dispatched = await test.dispatcher.dispatchAuthorized(MESSAGE_TYPES.GET_CURRENT_PLAN, {
  payload: { binding: binding() }, sender: test.sender,
});
assert.equal(dispatched.ok, true);
await rejects(
  (context) => test.dispatcher.dispatchAuthorized('UNKNOWN_HOSTED_MESSAGE', context),
  {},
  'SS_ERP_HOSTED_WORKBENCH_HANDLER_UNAVAILABLE',
);

for (const [label, messageType, payload] of [
  ['binding extra key', MESSAGE_TYPES.GET_CURRENT_PLAN, { binding: binding({ ownerUserId: 'forged' }) }],
  ['payload extra key', MESSAGE_TYPES.GET_CURRENT_PLAN, { binding: binding(), rawProjection: {} }],
  ['bad revision', MESSAGE_TYPES.GET_CURRENT_PLAN, { binding: binding({ draftRevision: 0 }) }],
  ['short create key', MESSAGE_TYPES.CREATE_PLAN, { binding: binding(), idempotencyKey: 'short' }],
  ['path traversal', MESSAGE_TYPES.GET_PLAN, { binding: binding(), planId: '../plan' }],
  ['bad review note', MESSAGE_TYPES.REVIEW_PLAN, {
    binding: binding(), planId: 'plan-1', expectedRevision: 1,
    operationKey: 'plan-review-0001', decision: 'APPROVE', note: 'bad\u0000note',
  }],
  ['preview URL', MESSAGE_TYPES.OPEN_PREVIEW, {
    binding: binding(), slotId: 'https://provider.example/private',
  }],
  ['assignment ordinal', MESSAGE_TYPES.ASSIGN_APPROVED_OUTPUT, {
    binding: binding(), intents: [firstApplyIntent], assignmentStartOrdinal: 500,
    idempotencyKey: 'assignment-key-0002',
  }],
  ['assignment batch overflow', MESSAGE_TYPES.ASSIGN_APPROVED_OUTPUT, {
    binding: binding(), intents: [firstApplyIntent, secondApplyIntent],
    assignmentStartOrdinal: 499, idempotencyKey: 'assignment-key-0003',
  }],
  ['duplicate assignment slot', MESSAGE_TYPES.ASSIGN_APPROVED_OUTPUT, {
    binding: binding(), intents: [firstApplyIntent, firstApplyIntent],
    assignmentStartOrdinal: 0, idempotencyKey: 'assignment-key-0004',
  }],
]) {
  await rejects(
    test.dispatcher.handlers[messageType],
    { payload, sender: test.sender },
    'SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID',
  );
  assert.ok(label);
}

await rejects(
  test.dispatcher.handlers[MESSAGE_TYPES.EXECUTE_INTENT],
  {
    payload: {
      binding: binding(),
      intent: intent('START', { context: binding({ shopId: 'shop-other' }) }),
      confirmation: { confirmed: true, maximumCostCents: 24 },
    },
    sender: test.sender,
  },
  'SS_ERP_HOSTED_WORKBENCH_CONTEXT_STALE',
);

await rejects(
  test.dispatcher.handlers[MESSAGE_TYPES.ASSIGN_APPROVED_OUTPUT],
  {
    payload: {
      binding: binding(), intents: [intent('REVIEW_SLOT')], assignmentStartOrdinal: 0,
      idempotencyKey: 'assignment-key-0005',
    },
    sender: test.sender,
  },
  'SS_ERP_HOSTED_WORKBENCH_ASSIGNMENT_REQUIRED',
);

for (const leakingOutput of [
  {
    contractVersion: 'extension-ai-image-suite-projection/v1',
    context: binding(), commandAuthority: null, applyPolicy: {}, plan: null, suite: null,
  },
  { contractVersion: 'extension-hosted-ai-image-suite-workbench-client/v1', rawProjection: { safe: false } },
  { contractVersion: 'extension-hosted-ai-image-suite-workbench-client/v1', previewUrl: 'https://provider.example/private' },
  { contractVersion: 'extension-hosted-ai-image-suite-workbench-client/v1', erpToken: 'erp-secret' },
  { contractVersion: 'extension-hosted-ai-image-suite-workbench-client/v1', sessionToken: 'session-secret' },
  { contractVersion: 'extension-hosted-ai-image-suite-workbench-client/v1', bytes: [1, 2, 3] },
  { contractVersion: 'extension-hosted-ai-image-suite-workbench-client/v1', payload: new Uint8Array([1, 2, 3]) },
  { contractVersion: 'extension-hosted-ai-image-suite-workbench-client/v1', provider: 'provider-secret' },
  { contractVersion: 'extension-hosted-ai-image-suite-workbench-client/v1', model: 'model-secret' },
  { contractVersion: 'extension-hosted-ai-image-suite-workbench-client/v1', prompt: 'prompt-secret' },
  { contractVersion: 'extension-hosted-ai-image-suite-workbench-client/v1', storageKey: 'private/object.png' },
  { contractVersion: 'extension-hosted-ai-image-suite-workbench-client/v1', jobId: 'job-secret' },
  { contractVersion: 'extension-hosted-ai-image-suite-workbench-client/v1', billingId: 'billing-secret' },
]) {
  const leak = fixture(api, { output: leakingOutput });
  const result = await leak.dispatcher.handlers[MESSAGE_TYPES.GET_CURRENT_PLAN]({
    payload: { binding: binding() }, sender: leak.sender,
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'SS_ERP_HOSTED_WORKBENCH_OUTPUT_INVALID');
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.equal(JSON.stringify(result).includes('https://'), false);
}

const throwingClient = fixture(api, {
  client: {
    ...fixture(api).client,
    async getCurrentPlan() {
      throw Object.assign(new Error('Bearer secret must not escape'), {
        code: 'SS_ERP_HOSTED_WORKBENCH_REQUEST_FAILED',
      });
    },
  },
});
const failed = await throwingClient.dispatcher.handlers[MESSAGE_TYPES.GET_CURRENT_PLAN]({
  payload: { binding: binding() }, sender: throwingClient.sender,
});
assert.equal(failed.errorCode, 'SS_ERP_HOSTED_WORKBENCH_REQUEST_FAILED');
assert.equal(JSON.stringify(failed).includes('Bearer'), false);

assert.throws(
  () => api.createDispatcher({
    messageTypes: { ...MESSAGE_TYPES, EXTRA: 'unexpected' },
    getClient() {},
  }),
  (error) => error?.code === 'SS_ERP_HOSTED_WORKBENCH_DEPENDENCY_UNAVAILABLE',
);
assert.throws(
  () => api.createDispatcher({
    messageTypes: { ...MESSAGE_TYPES, CLEAR: MESSAGE_TYPES.OPEN_PREVIEW },
    getClient() {},
  }),
  (error) => error?.code === 'SS_ERP_HOSTED_WORKBENCH_DEPENDENCY_UNAVAILABLE',
);
assert.throws(
  () => api.createDispatcher({ messageTypes: MESSAGE_TYPES }),
  (error) => error?.code === 'SS_ERP_HOSTED_WORKBENCH_DEPENDENCY_UNAVAILABLE',
);

console.log('extension hosted AI image suite workbench runtime dispatcher tests passed');
