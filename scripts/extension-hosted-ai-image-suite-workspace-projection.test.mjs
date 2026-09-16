import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const contractPath = 'extensions/ss-erp/shared/contracts/ai-image-workbench-v1.js';
const workspacePath = 'extensions/ss-erp/shared/byok/workbench-workspace-state.js';
const modulePath =
  'extensions/ss-erp/shared/hosted/ai-image-suite-workspace-projection.js';

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('CNY quote remains bound to the frozen start pricing version and exact maximum', () => {
  const { mapper: api } = loadApis();
  const value = plain(projection({ suite: false }));
  const version = `ai-image-suite-price-cny/v1:${'c'.repeat(32)}`;
  Object.assign(value.quote, { pricingVersion: version, currency: 'CNY' });
  value.plan.startIntent.commandTemplate.acceptedPricingVersion = version;
  const mapper = api.createMapper({ launchContext: launch(), projection: deepFreeze(value) });
  const resolved = mapper.lookupStartIntent({ confirmed: true, maximumCostCents: 24 });
  assert.equal(resolved.intent.commandTemplate.acceptedPricingVersion, version);
  assert.deepEqual(plain(resolved.confirmation), { confirmed: true, maximumCostCents: 24 });
  assert.equal(Object.hasOwn(resolved.intent.commandTemplate, 'currency'), false);
});

test('workspace rejects unknown, missing CNY, and conflicting quote currency', () => {
  const { mapper: api } = loadApis();
  for (const [pricingVersion, currency] of [
    ['pricing-v1', 'CNY'], ['pricing-v1', 'JPY'], ['pricing-v1', null],
    [`ai-image-suite-price-cny/v1:${'c'.repeat(32)}`, 'USD'],
    [`ai-image-suite-price-cny/v1:${'c'.repeat(32)}`, undefined],
  ]) {
    const value = plain(projection({ suite: false }));
    value.quote.pricingVersion = pricingVersion;
    if (currency !== undefined) value.quote.currency = currency;
    value.plan.startIntent.commandTemplate.acceptedPricingVersion = pricingVersion;
    assert.throws(() => api.createMapper({ launchContext: launch(), projection: deepFreeze(value) }),
      (error) => error?.code === 'SS_ERP_HOSTED_WORKSPACE_AUTHORITY_INVALID');
  }
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function loadApis() {
  const context = {
    Array, Boolean, Date, Error, JSON, Map, Math, Number, Object, Promise,
    RegExp, Set, String, TypeError,
  };
  context.globalThis = context;
  vm.runInNewContext(readFileSync(contractPath, 'utf8'), context, {
    filename: contractPath,
  });
  vm.runInNewContext(readFileSync(workspacePath, 'utf8'), context, {
    filename: workspacePath,
  });
  vm.runInNewContext(readFileSync(modulePath, 'utf8'), context, {
    filename: modulePath,
  });
  return {
    mapper: context.SS_ERP_HOSTED_AI_IMAGE_SUITE_WORKSPACE_PROJECTION,
    workspace: context.SS_ERP_BYOK_WORKBENCH_WORKSPACE_STATE,
  };
}

function launch(overrides = {}) {
  return {
    contractVersion: 'extension-byok-workbench-launch-context/v1',
    sourcePlatform: '1688',
    sourceProductId: 'source-product-1',
    sourceCaptureSnapshotId: 'snapshot-1',
    supplyGoodsId: 'goods-1',
    shopId: 'shop-1',
    workflowId: 'listing-workflow-1',
    draftRevision: 11,
    draftVersion: 7,
    skuKey: 'sku-red',
    slotKey: 'sku:sku-red:hero',
    assignmentMode: 'APPEND',
    assignmentOrdinal: 0,
    ...overrides,
  };
}

function hostedBinding(overrides = {}) {
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

function workspaceBinding() {
  return {
    shopId: 'shop-1',
    workflowId: 'listing-workflow-1',
    draftRevision: 11,
    draftVersion: 7,
  };
}

function hostedIntent(action, options = {}) {
  const slotId = options.slotId || null;
  const decision = options.decision || null;
  let commandTemplate;
  if (action === 'START') {
    commandTemplate = {
      expectedPreviewHash: 'b'.repeat(64),
      acceptedPricingVersion: 'pricing-v1',
      acceptedEstimatedCostCents: 18,
      acceptedMaximumCostCents: 24,
    };
  } else if (action === 'CONTINUE' || action === 'CANCEL') {
    commandTemplate = { suiteId: 'suite-1', expectedSuiteRevision: options.suiteRevision || 1 };
  } else if (action === 'RETRY_SLOT') {
    commandTemplate = {
      suiteId: 'suite-1',
      slotId,
      expectedSuiteRevision: options.suiteRevision || 1,
      expectedSlotRevision: options.slotRevision || 1,
      acceptedAdditionalMaximumCostCents: options.maximumCostCents || 12,
    };
  } else if (action === 'REVIEW_SLOT') {
    commandTemplate = {
      suiteId: 'suite-1',
      slotId,
      workflowId: `workflow-${slotId}`,
      outputAssetId: options.assetId,
      expectedSuiteRevision: options.suiteRevision || 1,
      expectedSlotRevision: options.slotRevision || 1,
      expectedWorkflowRevision: options.workflowRevision || 1,
      decisions: ['APPROVE', 'REJECT'],
    };
  } else {
    commandTemplate = {
      suiteId: 'suite-1',
      slotId,
      workflowId: `workflow-${slotId}`,
      outputAssetId: options.assetId,
      expectedSuiteRevision: options.suiteRevision || 1,
      expectedSlotRevision: options.slotRevision || 1,
      expectedWorkflowRevision: options.workflowRevision || 1,
      mode: 'append',
      target: 'ERP_SOURCE_PRODUCT',
      writesStoreDraft: false,
      expectedTargetUpdatedAt: '2026-07-27T08:00:00.000Z',
    };
  }
  return {
    version: 'extension-ai-image-suite-intent-witness/v1',
    context: hostedBinding(),
    authorityHash: 'a'.repeat(64),
    action,
    slotId,
    decision,
    commandTemplate,
  };
}

function planSlot(ordinal, slotKey, skuKey, goal = '商品图片') {
  return {
    ordinal,
    slotKey,
    goal,
    ownership: { level: 'sku', key: skuKey },
    applicableSkuKeys: [skuKey],
    estimatedCostCents: 6,
    maximumCostCents: 8,
  };
}

function planSlots() {
  return [
    planSlot(0, 'sku:sku-red:hero', 'sku-red', '红色主图'),
    planSlot(1, 'sku:sku-red:detail-1', 'sku-red', '红色细节'),
    planSlot(2, 'sku:sku-blue:hero', 'sku-blue', '蓝色主图'),
  ];
}

function ruleBasedCompatibilityGroupPlanSlots() {
  const shared = planSlot(
    2,
    'group:visual-7c9e6679f4f04d8f8c3f4a72:gallery:1',
    'visual-7c9e6679f4f04d8f8c3f4a72',
    'scene',
  );
  shared.ownership.level = 'compatibility_group';
  shared.applicableSkuKeys = ['sku-blue', 'sku-red'];
  return [
    planSlot(0, 'sku:sku-blue:hero', 'sku-blue', 'sku_hero'),
    planSlot(1, 'sku:sku-red:hero', 'sku-red', 'sku_hero'),
    shared,
  ];
}

function suiteSlot(plan, index, options = {}) {
  const id = options.id || `slot-${index + 1}`;
  const status = options.status || 'PLANNED';
  const reviewStatus = options.reviewStatus || 'NOT_READY';
  const output = options.output === undefined
    ? status === 'SUCCEEDED'
      ? {
        assetId: options.assetId || `asset-${index + 1}`,
        mimeType: 'image/png',
        width: 1024,
        height: 1024,
      }
      : null
    : options.output;
  const suiteRevision = options.suiteRevision || 1;
  const slotRevision = options.slotRevision || 1;
  const reviewIntents = reviewStatus === 'PENDING' ? {
    APPROVE: hostedIntent('REVIEW_SLOT', {
      slotId: id,
      decision: 'APPROVE',
      assetId: output.assetId,
      suiteRevision,
      slotRevision,
    }),
    REJECT: hostedIntent('REVIEW_SLOT', {
      slotId: id,
      decision: 'REJECT',
      assetId: output.assetId,
      suiteRevision,
      slotRevision,
    }),
  } : null;
  return {
    id,
    ordinal: plan.ordinal,
    slotKey: plan.slotKey,
    goal: plan.goal,
    ownership: { ...plan.ownership },
    applicableSkuKeys: [...plan.applicableSkuKeys],
    status,
    attempt: options.attempt || 1,
    revision: slotRevision,
    estimatedCostCents: plan.estimatedCostCents,
    maximumCostCents: plan.maximumCostCents,
    workflowId: status === 'SUCCEEDED' ? `workflow-${id}` : null,
    workflowRevision: status === 'SUCCEEDED' ? 1 : null,
    reviewStatus,
    previewAvailable: Boolean(output),
    output,
    application: null,
    retryIntent: options.retry === true
      ? hostedIntent('RETRY_SLOT', {
        slotId: id,
        suiteRevision,
        slotRevision,
        maximumCostCents: plan.maximumCostCents,
      })
      : null,
    reviewIntents,
    applyIntent: reviewStatus === 'APPROVED'
      ? hostedIntent('APPLY_SLOT', {
        slotId: id,
        assetId: output.assetId,
        suiteRevision,
        slotRevision,
      })
      : null,
  };
}

function projection(options = {}) {
  const slots = options.planSlots || planSlots();
  const suiteRevision = options.suiteRevision || 1;
  let suite = null;
  if (options.suiteStatus) {
    const suiteSlots = slots.map((slot, index) => suiteSlot(slot, index, {
      status: options.slotStatuses?.[index] || options.slotStatus || 'PLANNED',
      reviewStatus: options.reviewStatuses?.[index] || options.reviewStatus || 'NOT_READY',
      retry: options.retryIndexes?.includes(index),
      attempt: options.attempts?.[index] || 1,
      suiteRevision,
      slotRevision: options.slotRevisions?.[index] || suiteRevision,
    }));
    suite = {
      id: 'suite-1',
      status: options.suiteStatus,
      revision: suiteRevision,
      itemCount: suiteSlots.length,
      estimatedCostCents: 18,
      maximumCostCents: 24,
      continueIntent: options.continueIntent === false
        ? null
        : options.suiteStatus === 'PLANNED'
          ? hostedIntent('CONTINUE', { suiteRevision })
          : null,
      cancelIntent: options.cancelIntent === false
        ? null
        : ['PLANNED', 'QUEUED', 'RUNNING'].includes(options.suiteStatus)
          ? hostedIntent('CANCEL', { suiteRevision })
          : null,
      slots: suiteSlots,
    };
  }
  return deepFreeze({
    contractVersion: 'hosted-ai-image-suite-workbench-adapter/v1',
    executionMode: 'ERP_HOSTED',
    binding: workspaceBinding(),
    sourceBinding: { snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1', skuKey: null },
    applyPolicy: { target: 'ERP_SOURCE_PRODUCT', mode: 'append', writesStoreDraft: false },
    quote: {
      pricingVersion: 'pricing-v1',
      itemCount: slots.length,
      estimatedCostCents: 18,
      maximumCostCents: 24,
    },
    plan: {
      id: 'plan-1',
      versionId: 'plan-version-1',
      revision: 3,
      status: 'APPROVED',
      skuKey: null,
      previewHash: 'b'.repeat(64),
      slots,
      startIntent: suite || options.startIntent === false ? null : hostedIntent('START'),
    },
    suite,
  });
}

function singleProjection(options = {}) {
  return projection({
    ...options,
    planSlots: [planSlot(0, 'sku:sku-red:hero', 'sku-red', '红色主图')],
  });
}

function createWorkspaceIntent(workspace, action, slotKey, attemptId, suffix = action) {
  if (action === 'PAUSE_AFTER_CURRENT') {
    return workspace.createPauseAfterCurrentIntent(`command-${suffix}`);
  }
  if (action === 'CONTINUE') return workspace.createContinueIntent(`command-${suffix}`);
  if (action === 'CANCEL_QUEUED') {
    return workspace.createCancelQueuedIntent(attemptId, `command-${suffix}`);
  }
  if (action === 'KEEP_ATTEMPT') {
    return workspace.createKeepAttemptIntent(slotKey, attemptId, `command-${suffix}`);
  }
  if (action === 'REJECT_ATTEMPT') {
    return workspace.createRejectAttemptIntent(slotKey, attemptId, `command-${suffix}`);
  }
  return workspace.createRegenerateIntent(slotKey, {
    warningVersion: 'erp-hosted-additional-cost/v1',
    confirmed: true,
  }, `command-${suffix}`);
}

test('projects exact hosted bootstrap and start confirmation without leaking authority data', () => {
  const { mapper: api, workspace: workspaceApi } = loadApis();
  assert.equal(api.CONTRACT_VERSION, 'extension-hosted-ai-image-suite-workspace-projection/v1');
  assert.equal(api.WORKSPACE_VERSION, 'extension-byok-workbench-workspace-state/v1');
  assert.equal(
    api.WORKSPACE_RUNTIME_VERSION,
    'extension-byok-workbench-workspace-runtime/v1',
  );
  assert.equal(Object.isFrozen(api), true);

  const sourceProjection = projection();
  const mapper = api.createMapper({ launchContext: launch(), projection: sourceProjection });
  const bootstrap = mapper.createBootstrap();
  assert.deepEqual(Object.keys(bootstrap), [
    'contractVersion', 'binding', 'executionMode', 'availableExecutionModes',
    'dispatched', 'selectedSkuKey', 'selectedSlotKey', 'globalReferenceIds',
    'libraryItems', 'skus',
  ]);
  assert.deepEqual(plain(bootstrap.binding), workspaceBinding());
  assert.deepEqual(plain(bootstrap.availableExecutionModes), ['ERP_HOSTED', 'BYOK']);
  assert.equal(bootstrap.executionMode, 'ERP_HOSTED');
  assert.equal(bootstrap.dispatched, false);
  assert.deepEqual(plain(bootstrap.skus.map((sku) => ({
    skuKey: sku.skuKey,
    slots: sku.slots.map((slot) => [slot.slotKey, slot.role]),
  }))), [
    {
      skuKey: 'sku-red',
      slots: [
        ['sku:sku-red:hero', 'HERO'],
        ['sku:sku-red:detail-1', 'DETAIL'],
      ],
    },
    { skuKey: 'sku-blue', slots: [['sku:sku-blue:hero', 'HERO']] },
  ]);
  assert.equal(bootstrap.skus[0].slots[0].prompt, '');
  assert.equal(Object.isFrozen(bootstrap.skus[0].slots[0]), true);
  assert.doesNotMatch(
    JSON.stringify(bootstrap).toLowerCase(),
    /https?:|base64|apikey|provider|storage|rawprojection|jobid|billing/u,
  );
  const workspace = workspaceApi.createWorkspace(bootstrap);
  assert.equal(workspace.getSnapshot().executionMode, 'ERP_HOSTED');
  assert.equal(workspace.getSnapshot().modeDisabledReasons.ERP_HOSTED, null);
  assert.equal(workspace.getSnapshot().modeDisabledReasons.BYOK, null);
  assert.equal(workspace.setExecutionMode('BYOK').executionMode, 'BYOK');
  assert.equal(workspace.setExecutionMode('ERP_HOSTED').executionMode, 'ERP_HOSTED');

  assert.throws(
    () => mapper.lookupStartIntent({ confirmed: true, maximumCostCents: 23 }),
    (error) => error?.code === 'SS_ERP_HOSTED_WORKSPACE_COST_CONFIRMATION_REQUIRED',
  );
  const start = mapper.lookupStartIntent({ confirmed: true, maximumCostCents: 24 });
  assert.equal(start.intent, sourceProjection.plan.startIntent);
  assert.deepEqual(plain(start.confirmation), { confirmed: true, maximumCostCents: 24 });
  assert.equal(Object.isFrozen(start), true);
});

test('projects one rule-based shared gallery slot and exposes its candidate to every member SKU', () => {
  const { mapper: api, workspace: workspaceApi } = loadApis();
  const planSlots = ruleBasedCompatibilityGroupPlanSlots();
  const pending = projection({
    planSlots,
    suiteStatus: 'SUCCEEDED',
    slotStatus: 'SUCCEEDED',
    reviewStatus: 'PENDING',
    suiteRevision: 3,
    slotRevisions: [3, 3, 3],
  });
  const mapper = api.createMapper({ launchContext: launch(), projection: pending });
  const bootstrap = mapper.createBootstrap();
  assert.deepEqual(plain(bootstrap.skus.map((sku) => ({
    skuKey: sku.skuKey,
    slots: sku.slots.map((slot) => [slot.slotKey, slot.role]),
  }))), [{
    skuKey: 'sku-blue',
    slots: [
      ['sku:sku-blue:hero', 'HERO'],
      ['group:visual-7c9e6679f4f04d8f8c3f4a72:gallery:1', 'DETAIL'],
    ],
  }, {
    skuKey: 'sku-red',
    slots: [['sku:sku-red:hero', 'HERO']],
  }]);
  assert.equal(
    bootstrap.skus.flatMap((sku) => sku.slots).filter((slot) => (
      slot.slotKey === 'group:visual-7c9e6679f4f04d8f8c3f4a72:gallery:1'
    )).length,
    1,
  );
  const sharedBootstrap = bootstrap.skus.flatMap((sku) => sku.slots).find((slot) => (
    slot.slotKey === 'group:visual-7c9e6679f4f04d8f8c3f4a72:gallery:1'
  ));
  assert.equal(sharedBootstrap.assignmentScope, 'PRODUCT');
  assert.deepEqual(plain(sharedBootstrap.applicableSkuKeys), ['sku-blue', 'sku-red']);

  const workspace = workspaceApi.createWorkspace(bootstrap);
  const runtime = mapper.projectRuntime({ projection: pending, revision: 3 });
  const sharedItem = runtime.libraryItems.find((item) => item.mediaId === 'asset-3');
  assert.deepEqual(plain(sharedItem.skuKeys), ['sku-blue', 'sku-red']);
  const sharedRuntime = runtime.slots.find((slot) => (
    slot.slotKey === 'group:visual-7c9e6679f4f04d8f8c3f4a72:gallery:1'
  ));
  assert.equal(sharedRuntime.slotKey, planSlots[2].slotKey);
  const snapshot = workspace.applyRuntimeProjection(runtime);
  const sharedSlot = snapshot.slots.find((slot) => slot.slotKey === sharedRuntime.slotKey);
  assert.equal(sharedSlot.assignmentScope, 'PRODUCT');
  assert.deepEqual(plain(sharedSlot.applicableSkuKeys), ['sku-blue', 'sku-red']);
  const keep = workspace.createKeepAttemptIntent(
    sharedSlot.slotKey,
    sharedSlot.alternatives[0].attemptId,
    'command-keep-shared',
  );
  assert.equal(mapper.lookupReviewIntent(keep).intent, pending.suite.slots[2].reviewIntents.APPROVE);
});

test('blocks paid start and apply semantics for a strict-subset compatibility group while retaining review', () => {
  const { mapper: api, workspace: workspaceApi } = loadApis();
  const planSlots = ruleBasedCompatibilityGroupPlanSlots();
  planSlots[2].applicableSkuKeys = ['sku-blue'];

  const planned = projection({ planSlots, suite: false, startIntent: false });
  const plannedMapper = api.createMapper({ launchContext: launch(), projection: planned });
  assert.throws(
    () => plannedMapper.lookupStartIntent({ confirmed: true, maximumCostCents: 24 }),
    (error) => error?.code === 'SS_ERP_HOSTED_WORKSPACE_GROUP_SCOPE_UNSUPPORTED',
  );

  const pending = projection({
    planSlots,
    suiteStatus: 'SUCCEEDED',
    slotStatus: 'SUCCEEDED',
    reviewStatus: 'PENDING',
    suiteRevision: 3,
    slotRevisions: [3, 3, 3],
  });
  const mapper = api.createMapper({ launchContext: launch(), projection: pending });
  const workspace = workspaceApi.createWorkspace(mapper.createBootstrap());
  const runtime = mapper.projectRuntime({ projection: pending, revision: 3 });
  const snapshot = workspace.applyRuntimeProjection(runtime);
  const shared = snapshot.slots.find((slot) => slot.slotKey === planSlots[2].slotKey);
  assert.equal(shared.assignmentScope, 'PRODUCT');
  assert.deepEqual(plain(shared.applicableSkuKeys), ['sku-blue']);
  const keep = workspace.createKeepAttemptIntent(
    shared.slotKey,
    shared.alternatives[0].attemptId,
    'command-keep-partial-shared',
  );
  assert.equal(mapper.lookupReviewIntent(keep).intent, pending.suite.slots[2].reviewIntents.APPROVE);

  const paused = projection({
    planSlots,
    suiteStatus: 'PLANNED',
    continueIntent: false,
  });
  const pausedMapper = api.createMapper({ launchContext: launch(), projection: paused });
  const pausedWorkspace = workspaceApi.createWorkspace(pausedMapper.createBootstrap());
  const pausedSnapshot = pausedWorkspace.applyRuntimeProjection(pausedMapper.projectRuntime({
    projection: paused,
    revision: 4,
  }));
  assert.equal(pausedSnapshot.taskControls.continue.enabled, false);
  assert.equal(
    pausedSnapshot.taskControls.continue.disabledReason,
    'HOSTED_GROUP_SCOPE_UNSUPPORTED',
  );
});

test('maps planned suite to paused runtime and resolves only exact current continue witness', () => {
  const { mapper: api, workspace: workspaceApi } = loadApis();
  const initial = projection();
  const mapper = api.createMapper({ launchContext: launch(), projection: initial });
  const workspace = workspaceApi.createWorkspace(mapper.createBootstrap());
  const planned = projection({ suiteStatus: 'PLANNED' });
  const runtime = mapper.projectRuntime({ projection: planned, revision: 10 });
  assert.deepEqual(plain(runtime.binding), workspaceBinding());
  assert.equal(runtime.revision, 10);
  assert.equal(runtime.task.schedulerState, 'PAUSED');
  assert.equal(runtime.task.disabledReason, null);
  assert.equal(runtime.slots.every((slot) => slot.status === 'QUEUED'), true);
  assert.equal(runtime.slots.every((slot) => slot.selectedAttemptId === null), true);
  const snapshot = workspace.applyRuntimeProjection(runtime);
  assert.equal(snapshot.taskControls.continue.enabled, true);
  const continueAction = workspace.createContinueIntent('command-continue');
  const resolved = mapper.lookupContinueIntent(continueAction);
  assert.equal(resolved.intent, planned.suite.continueIntent);
  assert.equal(resolved.confirmation, null);

  const queued = snapshot.taskControls.cancelQueued.attemptIds[0];
  const cancelAction = workspace.createCancelQueuedIntent(queued, 'command-cancel-many');
  assert.throws(
    () => mapper.lookupCancelIntent(cancelAction),
    (error) => error?.code === 'SS_ERP_HOSTED_WORKSPACE_CANCEL_SCOPE_UNSUPPORTED',
  );
  assert.throws(
    () => mapper.projectRuntime({ projection: planned, revision: 10 }),
    (error) => error?.code === 'SS_ERP_HOSTED_WORKSPACE_RUNTIME_STALE',
  );
});

test('maps single queued cancellation exactly and fails pause closed', () => {
  const { mapper: api, workspace: workspaceApi } = loadApis();
  const mapper = api.createMapper({ launchContext: launch(), projection: singleProjection() });
  const workspace = workspaceApi.createWorkspace(mapper.createBootstrap());
  const planned = singleProjection({ suiteStatus: 'PLANNED' });
  const paused = workspace.applyRuntimeProjection(mapper.projectRuntime({
    projection: planned,
    revision: 1,
  }));
  const attemptId = paused.taskControls.cancelQueued.attemptIds[0];
  const cancelAction = workspace.createCancelQueuedIntent(attemptId, 'command-cancel-one');
  assert.equal(mapper.lookupCancelIntent(cancelAction).intent, planned.suite.cancelIntent);

  const running = singleProjection({
    suiteStatus: 'RUNNING',
    slotStatus: 'RUNNING',
    suiteRevision: 2,
    slotRevisions: [2],
  });
  const runningSnapshot = workspace.applyRuntimeProjection(mapper.projectRuntime({
    projection: running,
    revision: 2,
  }));
  assert.equal(runningSnapshot.taskControls.pauseAfterCurrent.enabled, true);
  const pause = workspace.createPauseAfterCurrentIntent('command-pause');
  assert.throws(
    () => mapper.lookupPauseIntent(pause),
    (error) => error?.code === 'SS_ERP_HOSTED_WORKSPACE_PAUSE_UNSUPPORTED',
  );
});

test('maps pending review without optimistic approval and returns exact review witnesses', () => {
  const { mapper: api, workspace: workspaceApi } = loadApis();
  const mapper = api.createMapper({ launchContext: launch(), projection: projection() });
  const workspace = workspaceApi.createWorkspace(mapper.createBootstrap());
  const pending = projection({
    suiteStatus: 'SUCCEEDED',
    slotStatus: 'SUCCEEDED',
    reviewStatus: 'PENDING',
    suiteRevision: 3,
    slotRevisions: [3, 3, 3],
  });
  const runtime = mapper.projectRuntime({ projection: pending, revision: 3 });
  assert.equal(runtime.task.schedulerState, 'REVIEW');
  assert.equal(runtime.libraryItems.length, 3);
  assert.equal(runtime.slots.every((slot) => slot.status === 'CANDIDATE_READY'), true);
  assert.equal(runtime.slots.every((slot) => slot.selectedAttemptId === null), true);
  const snapshot = workspace.applyRuntimeProjection(runtime);
  const target = snapshot.slots.find((slot) => slot.slotKey === 'sku:sku-red:hero');
  const candidate = target.alternatives[0];
  assert.equal(candidate.keepAvailable, true);
  assert.equal(candidate.rejectAvailable, true);
  const keep = createWorkspaceIntent(
    workspace,
    'KEEP_ATTEMPT',
    target.slotKey,
    candidate.attemptId,
    'keep',
  );
  const reject = createWorkspaceIntent(
    workspace,
    'REJECT_ATTEMPT',
    target.slotKey,
    candidate.attemptId,
    'reject',
  );
  assert.equal(
    mapper.lookupReviewIntent(keep).intent,
    pending.suite.slots[0].reviewIntents.APPROVE,
  );
  assert.equal(
    mapper.lookupWorkspaceIntent(reject).intent,
    pending.suite.slots[0].reviewIntents.REJECT,
  );
  assert.equal(workspace.getSnapshot().slots[0].selectedAttemptId, null);
});

test('maps authoritative approval but never translates APPLY_SLOT', () => {
  const { mapper: api, workspace: workspaceApi } = loadApis();
  const mapper = api.createMapper({ launchContext: launch(), projection: singleProjection() });
  const workspace = workspaceApi.createWorkspace(mapper.createBootstrap());
  const approved = singleProjection({
    suiteStatus: 'SUCCEEDED',
    slotStatus: 'SUCCEEDED',
    reviewStatus: 'APPROVED',
    suiteRevision: 4,
    slotRevisions: [4],
  });
  const runtime = mapper.projectRuntime({ projection: approved, revision: 4 });
  assert.equal(runtime.slots[0].status, 'APPROVED');
  assert.equal(runtime.slots[0].selectedAttemptId, 'hosted:slot-1:1');
  const snapshot = workspace.applyRuntimeProjection(runtime);
  assert.equal(snapshot.slots[0].status, 'APPROVED');
  assert.equal(JSON.stringify(runtime).includes('APPLY_SLOT'), false);
  assert.throws(
    () => mapper.lookupWorkspaceIntent({ action: 'APPLY_SLOT' }),
    (error) => error?.code === 'SS_ERP_HOSTED_WORKSPACE_DEDICATED_ASSIGNMENT_REQUIRED',
  );
});

test('preserves completed review candidates when the remaining suite is cancelled', () => {
  const { mapper: api, workspace: workspaceApi } = loadApis();
  const cancelled = projection({
    suiteStatus: 'CANCELLED',
    slotStatuses: ['SUCCEEDED', 'CANCELLED', 'CANCELLED'],
    reviewStatuses: ['PENDING', 'NOT_READY', 'NOT_READY'],
    suiteRevision: 5,
    slotRevisions: [5, 5, 5],
  });
  const mapper = api.createMapper({ launchContext: launch(), projection: cancelled });
  const workspace = workspaceApi.createWorkspace(mapper.createBootstrap());
  const runtime = mapper.projectRuntime({ projection: cancelled, revision: 5 });
  assert.equal(runtime.task.schedulerState, 'REVIEW');
  assert.deepEqual(plain(runtime.slots.map((slot) => slot.status)), [
    'CANDIDATE_READY', 'CANCELLED', 'CANCELLED',
  ]);
  const snapshot = workspace.applyRuntimeProjection(runtime);
  assert.equal(snapshot.taskSummary.schedulerState, 'REVIEW');
  assert.equal(snapshot.taskSummary.candidateReadyAttempts, 1);
  assert.equal(snapshot.taskSummary.cancelledAttempts, 2);
});

test('requires a renewed exact hosted maximum-cost confirmation for retry', () => {
  const { mapper: api, workspace: workspaceApi } = loadApis();
  const failed = singleProjection({
    suiteStatus: 'FAILED',
    slotStatus: 'FAILED',
    retryIndexes: [0],
    suiteRevision: 5,
    slotRevisions: [5],
  });
  const mapper = api.createMapper({ launchContext: launch(), projection: failed });
  const workspace = workspaceApi.createWorkspace(mapper.createBootstrap());
  const snapshot = workspace.applyRuntimeProjection(mapper.projectRuntime({
    projection: failed,
    revision: 5,
  }));
  const slot = snapshot.slots[0];
  assert.equal(slot.status, 'FAILED_RETRYABLE');
  assert.equal(slot.regenerateAvailable, true);
  const regenerate = createWorkspaceIntent(
    workspace,
    'REGENERATE_SLOT',
    slot.slotKey,
    null,
    'regenerate',
  );
  assert.throws(
    () => mapper.lookupRegenerateIntent(regenerate),
    (error) => error?.code === 'SS_ERP_HOSTED_WORKSPACE_COST_CONFIRMATION_REQUIRED',
  );
  assert.throws(
    () => mapper.lookupRegenerateIntent(regenerate, {
      confirmed: true,
      maximumCostCents: 7,
    }),
    (error) => error?.code === 'SS_ERP_HOSTED_WORKSPACE_COST_CONFIRMATION_REQUIRED',
  );
  const resolved = mapper.lookupRegenerateIntent(regenerate, {
    confirmed: true,
    maximumCostCents: 8,
  });
  assert.equal(resolved.intent, failed.suite.slots[0].retryIntent);
  assert.deepEqual(plain(resolved.confirmation), { confirmed: true, maximumCostCents: 8 });
  assert.throws(
    () => mapper.lookupRegenerateIntent(regenerate),
    (error) => error?.code === 'SS_ERP_HOSTED_WORKSPACE_COST_CONFIRMATION_REQUIRED',
  );
  const retried = singleProjection({
    suiteStatus: 'RUNNING',
    slotStatus: 'RUNNING',
    suiteRevision: 6,
    slotRevisions: [6],
    attempts: [2],
  });
  const retriedRuntime = mapper.projectRuntime({ projection: retried, revision: 6 });
  assert.equal(retriedRuntime.slots[0].alternatives[0].attemptId, 'hosted:slot-1:2');
  assert.notEqual(
    retriedRuntime.slots[0].alternatives[0].attemptId,
    snapshot.slots[0].alternatives[0].attemptId,
  );
  assert.throws(
    () => mapper.lookupRegenerateIntent(regenerate),
    (error) => error?.code === 'SS_ERP_HOSTED_WORKSPACE_ACTION_INVALID',
  );
});

test('fails closed for malformed or cross-SKU group evidence, noncanonical HERO groups, and stale authority', () => {
  const { mapper: api } = loadApis();
  for (const applicableSkuKeys of [
    [],
    ['sku-red', 'sku-blue'],
    ['sku-blue', 'sku-outside'],
  ]) {
    const slots = ruleBasedCompatibilityGroupPlanSlots();
    slots[2].applicableSkuKeys = applicableSkuKeys;
    assert.throws(
      () => api.createMapper({
        launchContext: launch(),
        projection: projection({ planSlots: slots }),
      }),
      (error) => error?.code === 'SS_ERP_HOSTED_WORKSPACE_AUTHORITY_INVALID',
    );
  }

  const mismatchedSuite = plain(projection({
    planSlots: ruleBasedCompatibilityGroupPlanSlots(),
    suiteStatus: 'PLANNED',
  }));
  mismatchedSuite.suite.slots[2].applicableSkuKeys = ['sku-blue'];
  assert.throws(
    () => api.createMapper({
      launchContext: launch(),
      projection: deepFreeze(mismatchedSuite),
    }),
    (error) => error?.code === 'SS_ERP_HOSTED_WORKSPACE_AUTHORITY_INVALID',
  );

  const detailFirst = [
    planSlot(0, 'sku:sku-red:detail-1', 'sku-red'),
    planSlot(1, 'sku:sku-red:hero', 'sku-red'),
  ];
  assert.throws(
    () => api.createMapper({
      launchContext: launch(),
      projection: projection({ planSlots: detailFirst }),
    }),
    (error) => error?.code === 'SS_ERP_HOSTED_WORKSPACE_AUTHORITY_INVALID',
  );

  assert.throws(
    () => api.createMapper({
      launchContext: launch({ shopId: 'shop-other' }),
      projection: projection(),
    }),
    (error) => error?.code === 'SS_ERP_HOSTED_WORKSPACE_AUTHORITY_INVALID',
  );

  const mutable = plain(projection());
  assert.throws(
    () => api.createMapper({ launchContext: launch(), projection: mutable }),
    (error) => error?.code === 'SS_ERP_HOSTED_WORKSPACE_AUTHORITY_INVALID',
  );

  const mapper = api.createMapper({ launchContext: launch(), projection: projection() });
  const planned = projection({ suiteStatus: 'PLANNED' });
  mapper.projectRuntime({ projection: planned, revision: 1 });
  const reusedRevision = plain(planned);
  reusedRevision.suite.cancelIntent = null;
  assert.throws(
    () => mapper.projectRuntime({ projection: deepFreeze(reusedRevision), revision: 2 }),
    (error) => error?.code === 'SS_ERP_HOSTED_WORKSPACE_AUTHORITY_REVISION_REUSED',
  );
  const changedPlan = plain(projection({ suiteStatus: 'PLANNED' }));
  changedPlan.plan.versionId = 'different-version';
  assert.throws(
    () => mapper.projectRuntime({ projection: deepFreeze(changedPlan), revision: 2 }),
    (error) => error?.code === 'SS_ERP_HOSTED_WORKSPACE_CONTEXT_STALE',
  );
});

test('rejects output URLs and does not expose raw hosted projection or sensitive fields', () => {
  const { mapper: api } = loadApis();
  const leaking = plain(singleProjection({
    suiteStatus: 'SUCCEEDED',
    slotStatus: 'SUCCEEDED',
    reviewStatus: 'PENDING',
  }));
  leaking.suite.slots[0].output.previewUrl = 'https://private.example/candidate.png';
  assert.throws(
    () => api.createMapper({
      launchContext: launch(),
      projection: deepFreeze(leaking),
    }),
    (error) => error?.code === 'SS_ERP_HOSTED_WORKSPACE_AUTHORITY_INVALID'
      || error?.code === 'SS_ERP_HOSTED_WORKSPACE_OUTPUT_INVALID',
  );

  const source = readFileSync(modulePath, 'utf8');
  assert.doesNotMatch(source, /generated-asset-ingest|SS_ERP_BYOK_PROVIDER|\/api\//iu);
});
