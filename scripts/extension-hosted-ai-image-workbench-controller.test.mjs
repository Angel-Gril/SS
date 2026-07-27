import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const modulePath = 'extensions/ss-erp/pages/ai-image-workbench-hosted.js';

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...values) { values.forEach((value) => this.values.add(value)); }
  remove(...values) { values.forEach((value) => this.values.delete(value)); }
  toggle(value, force) {
    if (force === true) this.values.add(value);
    else if (force === false) this.values.delete(value);
    else if (this.values.has(value)) this.values.delete(value);
    else this.values.add(value);
  }
  contains(value) { return this.values.has(value); }
}

class FakeTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) {
    const rows = this.listeners.get(type) || [];
    rows.push(listener);
    this.listeners.set(type, rows);
  }
  removeEventListener(type, listener) {
    const rows = this.listeners.get(type) || [];
    this.listeners.set(type, rows.filter((row) => row !== listener));
  }
  dispatchEvent(event) {
    event.target = event.target || this;
    event.currentTarget = this;
    for (const listener of this.listeners.get(event.type) || []) listener(event);
    return true;
  }
}

class FakeNode extends FakeTarget {
  constructor(id, tagName = 'div') {
    super();
    this.id = id;
    this.tagName = tagName.toUpperCase();
    this.textContent = '';
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.value = '';
    this.src = '';
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.attributes = {};
    this.className = '';
    this.classList = new FakeClassList();
  }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  replaceChildren(...children) {
    this.children.forEach((child) => { child.parentNode = null; });
    this.children = [];
    children.forEach((child) => this.appendChild(child));
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  removeAttribute(name) {
    delete this.attributes[name];
    if (name === 'src') this.src = '';
  }
  dispatch(type, values = {}) {
    this.dispatchEvent({ type, isTrusted: true, ...values });
  }
}

class FakeCustomEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options.detail;
    this.isTrusted = false;
    this.target = null;
    this.currentTarget = null;
  }
}

class FakeDocument extends FakeTarget {
  constructor(nodes) {
    super();
    this.nodes = nodes;
    this.body = new FakeNode('body', 'body');
    this.body.dataset = {};
  }
  getElementById(id) { return this.nodes[id] || null; }
  createElement(tagName) { return new FakeNode('', tagName); }
}

const IDS = [
  'hostedControlPanel', 'workspaceConnectionBadge', 'hostedStateBadge', 'hostedStatus',
  'hostedPlanSummary', 'hostedReviewSummary', 'hostedSuiteSummary',
  'hostedCreatePlanButton', 'hostedApprovePlanButton', 'hostedRejectPlanButton',
  'hostedQuotePanel', 'hostedPricingVersion', 'hostedQuoteItems', 'hostedEstimatedCost',
  'hostedMaximumCost', 'hostedCostConfirmation', 'hostedCostConfirmationLabel',
  'hostedStartButton', 'hostedContinueButton', 'hostedCancelButton', 'hostedSlotList',
  'hostedPreviewPanel', 'hostedPreviewImage', 'hostedPreviewMeta',
  'hostedPreviewCloseButton', 'hostedAssignmentNotice', 'hostedAssignApprovedButton',
  'byokControlPanel',
  'resultPanel', 'editResultPanel', 'emptyResult',
];

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function launch(overrides = {}) {
  return deepFreeze({
    contractVersion: 'extension-byok-workbench-launch-context/v1',
    sourcePlatform: '1688', sourceProductId: 'product-1',
    sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
    shopId: 'shop-1', workflowId: 'listing-workflow-1',
    draftRevision: 11, draftVersion: 7, skuKey: 'sku-red',
    slotKey: 'sku:sku-red:hero', assignmentMode: 'APPEND', assignmentOrdinal: 2,
    ...overrides,
  });
}

function hostedBinding(context = launch()) {
  return {
    snapshotId: context.sourceCaptureSnapshotId,
    supplyGoodsId: context.supplyGoodsId,
    shopId: context.shopId,
    listingWorkflowId: context.workflowId,
    draftRevision: context.draftRevision,
    draftVersion: context.draftVersion,
  };
}

function modeLockResponse(context = launch(), overrides = {}) {
  return deepFreeze({
    contractVersion: 'extension-hosted-ai-image-mode-lock/v1',
    context: hostedBinding(context),
    state: 'NO_SUITE',
    hostedExecutionEnabled: true,
    ...overrides,
  });
}

function workspaceBinding(context = launch()) {
  return {
    shopId: context.shopId,
    workflowId: context.workflowId,
    draftRevision: context.draftRevision,
    draftVersion: context.draftVersion,
  };
}

function hostedIntent(action, options = {}) {
  const slotId = options.slotId ?? null;
  const decision = options.decision ?? null;
  const commandTemplate = action === 'START'
    ? {
      expectedPreviewHash: 'b'.repeat(64), acceptedPricingVersion: 'pricing-v1',
      acceptedEstimatedCostCents: 18, acceptedMaximumCostCents: 24,
    }
    : action === 'CONTINUE' || action === 'CANCEL'
      ? { suiteId: 'suite-1', expectedSuiteRevision: 8 }
      : action === 'RETRY_SLOT'
        ? {
          suiteId: 'suite-1', slotId, expectedSuiteRevision: 8,
          expectedSlotRevision: 5, acceptedAdditionalMaximumCostCents: 12,
        }
        : action === 'REVIEW_SLOT'
          ? {
            suiteId: 'suite-1', slotId, workflowId: `workflow-${slotId}`,
            outputAssetId: `asset-${slotId}`, expectedSuiteRevision: 8,
            expectedSlotRevision: 5, expectedWorkflowRevision: 4,
            decisions: ['APPROVE', 'REJECT'],
          }
          : {
            suiteId: 'suite-1', slotId, workflowId: `workflow-${slotId}`,
            outputAssetId: `asset-${slotId}`, expectedSuiteRevision: 8,
            expectedSlotRevision: 5, expectedWorkflowRevision: 4,
            mode: 'append', target: 'ERP_SOURCE_PRODUCT', writesStoreDraft: false,
            expectedTargetUpdatedAt: '2026-07-27T08:00:00.000Z',
          };
  return deepFreeze({
    version: 'extension-ai-image-suite-intent-witness/v1',
    context: hostedBinding(), authorityHash: 'a'.repeat(64), action,
    slotId, decision, commandTemplate,
  });
}

function planResponse(reviewStatus = 'APPROVED') {
  return deepFreeze({
    contractVersion: 'extension-hosted-ai-image-suite-workbench-client/v1',
    replayed: false, policyRevision: 9, binding: hostedBinding(),
    plan: reviewStatus === null ? null : {
      id: 'plan-1', revision: 3, latestVersion: 1,
      currentVersionId: 'plan-version-1', approvedVersionId: reviewStatus === 'APPROVED'
        ? 'plan-version-1' : null,
      reviewStatus, sourceCurrent: true, stale: false,
      currentVersion: { id: 'plan-version-1' },
      approvedVersion: reviewStatus === 'APPROVED' ? { id: 'plan-version-1' } : null,
      reviewedAt: reviewStatus === 'APPROVED' ? '2026-07-27T08:00:00.000Z' : null,
      updatedAt: '2026-07-27T08:00:00.000Z',
    },
  });
}

function planSlot(ordinal, slotKey, goal) {
  return {
    ordinal, slotKey, goal, ownership: { level: 'sku', key: 'sku-red' },
    applicableSkuKeys: ['sku-red'],
    estimatedCostCents: 6, maximumCostCents: ordinal === 0 ? 8 : 12,
  };
}

function suiteSlot(plan, options = {}) {
  const id = options.id || `slot-${plan.ordinal + 1}`;
  const status = options.status || 'PLANNED';
  const reviewStatus = options.reviewStatus || 'NOT_READY';
  const hasOutput = status === 'SUCCEEDED';
  return {
    id, ordinal: plan.ordinal, slotKey: plan.slotKey, goal: plan.goal,
    ownership: { ...plan.ownership }, applicableSkuKeys: [...plan.applicableSkuKeys],
    status, attempt: 1, revision: 5,
    estimatedCostCents: plan.estimatedCostCents, maximumCostCents: plan.maximumCostCents,
    workflowId: hasOutput ? `workflow-${id}` : null,
    workflowRevision: hasOutput ? 4 : null,
    reviewStatus, previewAvailable: hasOutput,
    output: hasOutput ? {
      assetId: `asset-${id}`, mimeType: 'image/png', width: 1024, height: 1024,
    } : null,
    application: null,
    retryIntent: options.retry ? hostedIntent('RETRY_SLOT', { slotId: id }) : null,
    reviewIntents: reviewStatus === 'PENDING' ? {
      APPROVE: hostedIntent('REVIEW_SLOT', { slotId: id, decision: 'APPROVE' }),
      REJECT: hostedIntent('REVIEW_SLOT', { slotId: id, decision: 'REJECT' }),
    } : null,
    applyIntent: reviewStatus === 'APPROVED'
      ? hostedIntent('APPLY_SLOT', { slotId: id }) : null,
  };
}

function projection(options = {}) {
  const plans = options.plans || [
    planSlot(0, 'sku:sku-red:hero', 'Product hero'),
    planSlot(1, 'sku:sku-red:detail-1', 'Product detail'),
  ];
  const suite = options.suite === false ? null : {
    id: 'suite-1', status: options.suiteStatus || 'RUNNING', revision: 8,
    itemCount: plans.length, estimatedCostCents: 18, maximumCostCents: 24,
    continueIntent: options.continueIntent ? hostedIntent('CONTINUE') : null,
    cancelIntent: options.cancelIntent ? hostedIntent('CANCEL') : null,
    slots: plans.map((plan, index) => suiteSlot(plan, options.slots?.[index] || {})),
  };
  return deepFreeze({
    contractVersion: 'hosted-ai-image-suite-workbench-adapter/v1',
    executionMode: 'ERP_HOSTED', binding: workspaceBinding(),
    sourceBinding: { snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1', skuKey: null },
    applyPolicy: { target: 'ERP_SOURCE_PRODUCT', mode: 'append', writesStoreDraft: false },
    quote: {
      pricingVersion: 'pricing-v1', itemCount: plans.length,
      estimatedCostCents: 18, maximumCostCents: 24,
    },
    plan: {
      id: 'plan-1', versionId: 'plan-version-1', revision: 3,
      status: 'APPROVED', skuKey: null, previewHash: 'b'.repeat(64), slots: plans,
      startIntent: suite || options.startIntent === false ? null : hostedIntent('START'),
    },
    suite,
  });
}

function emptyProjection() {
  return deepFreeze({
    contractVersion: 'hosted-ai-image-suite-workbench-adapter/v1',
    executionMode: 'ERP_HOSTED', binding: workspaceBinding(),
    sourceBinding: { snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1', skuKey: null },
    applyPolicy: { target: 'ERP_SOURCE_PRODUCT', mode: 'append', writesStoreDraft: false },
    quote: null, plan: null, suite: null,
  });
}

function modeAction(executionMode) {
  return deepFreeze({
    contractVersion: 'extension-byok-workbench-workspace-action/v1',
    action: 'SELECT_MODE', revision: 2, executionMode,
    skuKey: null, slotKey: null, mediaId: null, attemptId: null,
    libraryKind: null, direction: null, prompt: null, negativePrompt: null,
  });
}

function workspaceIntent(action, values = {}) {
  return deepFreeze({
    contractVersion: 'extension-byok-workbench-action-intent/v1',
    binding: workspaceBinding(), action, commandId: `command-${action.toLowerCase()}`,
    expectedWorkspaceRevision: 3, expectedRuntimeRevision: 2,
    expectedSlotRevision: values.expectedSlotRevision ?? null,
    slotKey: values.slotKey ?? null, attemptId: values.attemptId ?? null,
    externalChargeAcknowledgement: values.externalChargeAcknowledgement ?? null,
  });
}

function findAction(node, action, slotId = null) {
  if (node.dataset?.hostedAction === action
    && (slotId === null || node.dataset.hostedSlotId === slotId)) return node;
  for (const child of node.children || []) {
    const found = findAction(child, action, slotId);
    if (found) return found;
  }
  return null;
}

async function settle(turns = 20) {
  for (let index = 0; index < turns; index += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 10));
  for (let index = 0; index < turns; index += 1) await Promise.resolve();
}

function harness(options = {}) {
  const nodes = Object.fromEntries(IDS.map((id) => [id, new FakeNode(
    id,
    id.endsWith('Button') ? 'button'
      : id === 'hostedCostConfirmation' ? 'input'
        : id === 'hostedPreviewImage' ? 'img'
          : id === 'hostedSlotList' ? 'ol' : 'div',
  )]));
  nodes.hostedControlPanel.hidden = true;
  nodes.hostedQuotePanel.hidden = true;
  nodes.hostedPreviewPanel.hidden = true;
  nodes.resultPanel.hidden = true;
  nodes.editResultPanel.hidden = true;
  const document = new FakeDocument(nodes);
  const windowTarget = new FakeTarget();
  const calls = [];
  const workspaceEvents = [];
  const runtimeListeners = [];
  let previewRevokeCount = 0;
  let consumerDisposeCount = 0;
  let runtimeRevision = 0;
  let uuidCounter = 0;
  let currentLaunch = options.launch || launch();
  let currentPlan = options.plan || planResponse('APPROVED');
  let currentProjection = options.projection || projection({ suite: false });
  let currentModeLock = options.modeLock || modeLockResponse(currentLaunch, {
    state: currentProjection.suite ? 'HAS_SUITE' : 'NO_SUITE',
  });
  let executeError = options.executeError || null;
  let executeAccepted = false;
  let reloadFailureRemaining = Boolean(options.reloadFailureAfterExecute);
  let rejectedReloadFailureRemaining = Boolean(options.reloadFailureAfterRejectedStart);
  let assignmentError = options.assignmentError || null;
  let lookupError = options.lookupError || null;
  const createErrors = [...(options.createErrors || [])];
  let mapperRuntimeCalls = 0;

  document.addEventListener('ss-erp:workspace-refresh-request', (event) => {
    workspaceEvents.push(['refresh', event.detail]);
  });
  document.addEventListener('ss-erp:workspace-bootstrap', (event) => {
    workspaceEvents.push(['bootstrap', event.detail]);
  });
  document.addEventListener('ss-erp:workspace-runtime', (event) => {
    workspaceEvents.push(['runtime', event.detail]);
  });
  document.addEventListener('ss-erp:workspace-intent-outcome', (event) => {
    workspaceEvents.push(['outcome', event.detail]);
  });
  document.addEventListener('ss-erp:workspace-clear', (event) => {
    workspaceEvents.push(['clear', event.detail]);
  });

  const runtimeClient = {
    async getModeLock(value) {
      calls.push(['mode-lock', value]);
      if (options.authorityGate) await options.authorityGate;
      if (options.authorityError) throw Object.assign(new Error('mode lock unavailable'), {
        code: options.authorityError,
      });
      return currentModeLock;
    },
    async getCurrentPlan(value) {
      calls.push(['current-plan', value]);
      return currentPlan;
    },
    async createPlan(value) {
      calls.push(['create-plan', value]);
      const error = createErrors.shift();
      if (error) throw error;
      return currentPlan;
    },
    async getPlan(value) { calls.push(['get-plan', value]); return currentPlan; },
    async reviewPlan(value) { calls.push(['review-plan', value]); return currentPlan; },
    async loadSuite(value) {
      calls.push(['load-suite', value]);
      if (rejectedReloadFailureRemaining
        && calls.some((row) => row[0] === 'execute')) {
        rejectedReloadFailureRemaining = false;
        throw Object.assign(new Error('rejected START authority reload failed'), {
          code: 'SS_ERP_HOSTED_WORKBENCH_REQUEST_FAILED',
        });
      }
      if (executeAccepted && reloadFailureRemaining) {
        reloadFailureRemaining = false;
        throw Object.assign(new Error('authority reload failed'), {
          code: 'SS_ERP_HOSTED_WORKBENCH_REQUEST_FAILED',
        });
      }
      return currentProjection;
    },
    async executeIntent(value) {
      calls.push(['execute', value]);
      if (executeError) throw executeError;
      if (options.executeDeferred) await options.executeDeferred;
      executeAccepted = true;
      return deepFreeze({
        contractVersion: 'extension-hosted-ai-image-suite-workbench-client/v1',
        state: 'completed', replayed: false, action: value.intent.action,
      });
    },
    async openPreview(value) {
      calls.push(['open-preview', value]);
      return deepFreeze({
        contractVersion: 'extension-hosted-ai-image-suite-candidate-preview-channel/v1',
        channelName: 'ss-erp:hosted-candidate-preview:' + 'c'.repeat(48),
        previewTicket: 'hp_' + 'd'.repeat(48),
        expiresAt: '2099-07-27T08:00:30.000Z',
        metadata: { mimeType: 'image/png', byteLength: null },
      });
    },
    async assignApprovedOutputs(value) {
      calls.push(['assign', value]);
      if (assignmentError) throw assignmentError;
      return deepFreeze({
        contractVersion: 'extension-hosted-ai-image-listing-assignment/v2',
        batchId: 'assignment-batch-1', replayed: false, shopId: 'shop-1',
        listingWorkflowId: 'listing-workflow-1', sourceDraftRevision: 11,
        sourceDraftVersion: 7, boundDraftRevision: 12, boundDraftVersion: 8,
        assignments: value.intents.map((intent, index) => ({
          assignmentId: `assignment-${index + 1}`,
          skuKey: 'sku-red',
          slotKey: intent.slotId === 'slot-2'
            ? 'sku:sku-red:detail-1' : 'sku:sku-red:hero',
          assignmentScope: 'SKU',
          assignmentOrdinal: value.assignmentStartOrdinal + index,
          assetId: intent.commandTemplate.outputAssetId,
        })),
        validationStatus: 'STALE', publishReadiness: 'STALE',
      });
    },
    async clear(value) { calls.push(['clear-client', value]); return { cleared: true }; },
  };

  const mapper = {
    createBootstrap() {
      calls.push(['mapper-bootstrap']);
      return deepFreeze({
        contractVersion: 'extension-byok-workbench-workspace-state/v1',
        binding: workspaceBinding(currentLaunch), executionMode: 'ERP_HOSTED',
        availableExecutionModes: ['ERP_HOSTED', 'BYOK'], dispatched: false,
        selectedSkuKey: currentLaunch.skuKey, selectedSlotKey: currentLaunch.slotKey,
        globalReferenceIds: [], libraryItems: [], skus: [],
      });
    },
    projectRuntime(value) {
      calls.push(['mapper-runtime', value]);
      mapperRuntimeCalls += 1;
      if (options.mapperRuntimeErrorAt === mapperRuntimeCalls) {
        throw Object.assign(new Error('stale mapper'), {
          code: 'SS_ERP_HOSTED_WORKSPACE_AUTHORITY_STALE',
        });
      }
      return deepFreeze({
        contractVersion: 'extension-byok-workbench-workspace-runtime/v1',
        binding: workspaceBinding(currentLaunch), revision: value.revision,
        task: { schedulerState: 'RUNNING', disabledReason: null },
        libraryItems: [], slots: [],
      });
    },
    lookupStartIntent(confirmation) {
      calls.push(['lookup-start', confirmation]);
      if (confirmation?.maximumCostCents !== 24) throw Object.assign(new Error('cost'), {
        code: 'SS_ERP_HOSTED_WORKSPACE_COST_CONFIRMATION_REQUIRED',
      });
      return deepFreeze({ intent: currentProjection.plan.startIntent, confirmation });
    },
    lookupWorkspaceIntent(value, confirmation) {
      calls.push(['lookup-workspace', value, confirmation]);
      if (lookupError) throw lookupError;
      const slot = currentProjection.suite?.slots.find((item) => item.slotKey === value.slotKey);
      let selected;
      if (value.action === 'CONTINUE') selected = currentProjection.suite.continueIntent;
      if (value.action === 'CANCEL_QUEUED') selected = currentProjection.suite.cancelIntent;
      if (value.action === 'KEEP_ATTEMPT') selected = slot.reviewIntents.APPROVE;
      if (value.action === 'REJECT_ATTEMPT') selected = slot.reviewIntents.REJECT;
      if (value.action === 'REGENERATE_SLOT') selected = slot.retryIntent;
      return deepFreeze({ intent: selected, confirmation: confirmation || null });
    },
  };

  const context = {
    Array, ArrayBuffer, Boolean, Date, Error, JSON, Map, Math, Number, Object, Promise,
    RegExp, Set, String, TextEncoder, TypeError, Uint8Array,
    Blob: class Blob {}, BroadcastChannel: class BroadcastChannel {},
    CustomEvent: FakeCustomEvent,
    document,
    chrome: {
      runtime: {
        onMessage: { addListener(listener) { runtimeListeners.push(listener); } },
      },
    },
    crypto: {
      subtle: webcrypto.subtle,
      randomUUID() {
        uuidCounter += 1;
        return `00000000-0000-4000-8000-${String(uuidCounter).padStart(12, '0')}`;
      },
    },
    URL: {},
    addEventListener: windowTarget.addEventListener.bind(windowTarget),
    removeEventListener: windowTarget.removeEventListener.bind(windowTarget),
    dispatchEvent: windowTarget.dispatchEvent.bind(windowTarget),
    setTimeout, clearTimeout,
    SS_ERP_BYOK_WORKBENCH_CLIENT: {
      DEVICE_INVALIDATED_MESSAGE: 'SS_ERP_EXTENSION_DEVICE_INVALIDATED',
      createClient() {
        return {
          async getPublicState() {
            calls.push(['launch-context']);
            return deepFreeze({ executionMode: 'BYOK', context: currentLaunch });
          },
        };
      },
    },
    SS_ERP_HOSTED_AI_IMAGE_SUITE_WORKBENCH_RUNTIME_CLIENT: {
      createClient() { calls.push(['create-runtime-client']); return runtimeClient; },
    },
    SS_ERP_HOSTED_AI_IMAGE_SUITE_CANDIDATE_PREVIEW_CONSUMER: {
      createConsumer() {
        calls.push(['create-consumer']);
        return {
          async consume(ticket) {
            calls.push(['consume-preview', ticket]);
            return Object.freeze({
              objectUrl: 'blob:hosted-preview',
              metadata: Object.freeze({
                mimeType: 'image/png', byteLength: 128, sha256: 'e'.repeat(64),
              }),
              revoke() { previewRevokeCount += 1; },
            });
          },
          dispose() { consumerDisposeCount += 1; return true; },
        };
      },
    },
    SS_ERP_HOSTED_AI_IMAGE_SUITE_WORKSPACE_PROJECTION: {
      HOSTED_CHARGE_WARNING_VERSION: 'erp-hosted-additional-cost/v1',
      createMapper(value) { calls.push(['create-mapper', value]); return mapper; },
    },
    SS_ERP_BYOK_WORKBENCH_WORKSPACE_EVENTS: {
      nextRuntimeRevision() { runtimeRevision += 1; return runtimeRevision; },
    },
  };
  context.globalThis = context;
  context.window = context;
  vm.runInNewContext(readFileSync(modulePath, 'utf8'), context, { filename: modulePath });

  return {
    context, document, nodes, calls, workspaceEvents, runtimeListeners,
    controller: context.SS_ERP_HOSTED_AI_IMAGE_WORKBENCH_CONTROLLER,
    setProjection(value) { currentProjection = value; },
    setModeLock(value) { currentModeLock = value; },
    setPlan(value) { currentPlan = value; },
    setLaunch(value) { currentLaunch = value; },
    setExecuteError(value) { executeError = value; },
    previewRevokes() { return previewRevokeCount; },
    consumerDisposes() { return consumerDisposeCount; },
    pagehide() { windowTarget.dispatchEvent({ type: 'pagehide', isTrusted: true }); },
  };
}

function activate(test, executionMode = 'ERP_HOSTED') {
  test.document.dispatchEvent(new FakeCustomEvent(
    'ss-erp:workspace-action',
    { detail: modeAction(executionMode) },
  ));
}

const source = readFileSync(modulePath, 'utf8');
assert.doesNotMatch(
  source,
  /innerHTML|ingestApproved|generated-asset-ingest|confirmPublish|recoverPublish|https?:\/\//iu,
);
assert.match(source, /SS_ERP_HOSTED_AI_IMAGE_WORKBENCH_CONTROLLER/u);
assert.match(source, /ASSIGNMENT_UNKNOWN_OUTCOME|EXECUTION_UNKNOWN_OUTCOME/u);

{
  let releaseAuthority;
  const authorityGate = new Promise((resolve) => { releaseAuthority = resolve; });
  const cold = harness({ projection: projection(), authorityGate });
  await settle(4);
  assert.equal(cold.controller.isByokExecutionAllowed(), false);
  assert.equal(cold.controller.isActive(), false);
  assert.equal(cold.workspaceEvents.some((row) => row[0] === 'bootstrap'), false);
  releaseAuthority();
  await settle(40);
  assert.equal(cold.controller.isActive(), true);
  assert.equal(cold.controller.isByokExecutionAllowed(), false);
  const firstBootstrap = cold.workspaceEvents.find((row) => row[0] === 'bootstrap');
  assert.equal(firstBootstrap[1].executionMode, 'ERP_HOSTED');
  assert.equal(firstBootstrap[1].dispatched, true);
}

{
  const coldByok = harness({ projection: projection({ suite: false }) });
  assert.equal(coldByok.controller.isByokExecutionAllowed(), false);
  await settle(40);
  assert.equal(coldByok.controller.isActive(), false);
  assert.equal(coldByok.controller.isByokExecutionAllowed(), true);
  assert.equal(coldByok.workspaceEvents.some((row) => row[0] === 'bootstrap'), false);
}

{
  const disabled = harness({ authorityError: 'SS_ERP_HOSTED_AI_DISABLED' });
  assert.equal(disabled.controller.isAvailable(), false);
  assert.equal(disabled.controller.isActive(), false);
  assert.equal(disabled.nodes.hostedControlPanel.hidden, true);
  assert.equal(await disabled.controller.refresh(), false);
  activate(disabled);
  await settle();
  assert.equal(disabled.controller.isActive(), false);
  assert.equal(disabled.nodes.hostedControlPanel.hidden, true);
}

{
  const policyDisabledNoSuite = harness({
    modeLock: modeLockResponse(launch(), { hostedExecutionEnabled: false }),
  });
  await settle(40);
  assert.equal(policyDisabledNoSuite.controller.isAvailable(), false);
  assert.equal(policyDisabledNoSuite.controller.isActive(), false);
  assert.equal(policyDisabledNoSuite.controller.isByokExecutionAllowed(), true,
    'an explicit NO_SUITE decision releases BYOK even when hosted execution is disabled');
  assert.equal(policyDisabledNoSuite.calls.some((row) => row[0] === 'current-plan'), false);
  assert.equal(policyDisabledNoSuite.calls.some((row) => row[0] === 'load-suite'), false);
}

{
  const readOnlyProjection = projection({
    continueIntent: true,
    cancelIntent: true,
    slots: [
      { status: 'SUCCEEDED', reviewStatus: 'PENDING' },
      { status: 'SUCCEEDED', reviewStatus: 'APPROVED' },
    ],
  });
  const policyDisabledExistingSuite = harness({
    projection: readOnlyProjection,
    modeLock: modeLockResponse(launch(), {
      state: 'HAS_SUITE',
      hostedExecutionEnabled: false,
    }),
  });
  await settle(40);
  assert.equal(policyDisabledExistingSuite.controller.isAvailable(), false);
  assert.equal(policyDisabledExistingSuite.controller.isActive(), true);
  assert.equal(policyDisabledExistingSuite.controller.isByokExecutionAllowed(), false,
    'an existing suite remains mode-locked when hosted execution policy is disabled');
  assert.equal(policyDisabledExistingSuite.calls.some((row) => row[0] === 'current-plan'), true);
  assert.equal(policyDisabledExistingSuite.calls.some((row) => row[0] === 'load-suite'), true);
  assert.equal(policyDisabledExistingSuite.nodes.hostedControlPanel.hidden, false);
  assert.equal(policyDisabledExistingSuite.nodes.hostedContinueButton.disabled, true);
  assert.equal(policyDisabledExistingSuite.nodes.hostedCancelButton.disabled, true);
  assert.equal(policyDisabledExistingSuite.nodes.hostedAssignApprovedButton.disabled, true);

  const preview = findAction(
    policyDisabledExistingSuite.nodes.hostedSlotList,
    'preview',
    'slot-1',
  );
  const approve = findAction(
    policyDisabledExistingSuite.nodes.hostedSlotList,
    'approve',
    'slot-1',
  );
  assert.ok(preview && approve);
  assert.equal(preview.disabled, false, 'candidate preview remains a read-only recovery action');
  assert.equal(approve.disabled, true, 'candidate review remains a denied mutation');
  preview.dispatch('click');
  await settle();
  assert.equal(
    policyDisabledExistingSuite.calls.filter((row) => row[0] === 'open-preview').length,
    1,
  );
  assert.equal(policyDisabledExistingSuite.nodes.hostedPreviewImage.src, 'blob:hosted-preview');

  [
    policyDisabledExistingSuite.nodes.hostedCreatePlanButton,
    policyDisabledExistingSuite.nodes.hostedContinueButton,
    policyDisabledExistingSuite.nodes.hostedCancelButton,
    policyDisabledExistingSuite.nodes.hostedAssignApprovedButton,
    approve,
  ].forEach((button) => {
    button.disabled = false;
    button.dispatch('click');
  });
  await settle();
  assert.equal(
    policyDisabledExistingSuite.calls.some((row) => [
      'create-plan', 'review-plan', 'execute', 'assign',
    ].includes(row[0])),
    false,
    'function-entry gates deny every hosted mutation while policy is disabled',
  );
}

{
  const invalidModeLocks = [
    deepFreeze({
      contractVersion: 'extension-hosted-ai-image-mode-lock/v1',
      context: hostedBinding(),
      state: 'UNKNOWN',
      hostedExecutionEnabled: false,
    }),
    modeLockResponse(launch({ shopId: 'shop-other' }), {
      state: 'HAS_SUITE',
      hostedExecutionEnabled: false,
    }),
  ];
  for (const modeLock of invalidModeLocks) {
    const malformedModeLock = harness({ modeLock });
    await settle(40);
    assert.equal(malformedModeLock.controller.isAvailable(), false);
    assert.equal(malformedModeLock.controller.isActive(), false);
    assert.equal(malformedModeLock.controller.isByokExecutionAllowed(), false);
    assert.equal(malformedModeLock.calls.some((row) => row[0] === 'current-plan'), false);
    assert.equal(malformedModeLock.calls.some((row) => row[0] === 'load-suite'), false);
  }
}

{
  const test = harness({ projection: projection({ suite: false }) });
  assert.equal(test.controller.isAvailable(), false, 'global API is exposed before authority');
  assert.equal(await test.controller.refresh(), true);
  assert.equal(test.controller.isAvailable(), true);
  assert.equal(test.controller.isActive(), false);
  assert.equal(test.nodes.hostedControlPanel.hidden, true);
  assert.equal(test.workspaceEvents.some((row) => row[0] === 'refresh'), true);
  test.nodes.byokControlPanel.hidden = false;
  test.nodes.resultPanel.hidden = false;
  test.nodes.editResultPanel.hidden = true;
  test.nodes.emptyResult.hidden = false;

  activate(test);
  await settle();
  assert.equal(test.controller.isActive(), true);
  assert.equal(test.nodes.hostedControlPanel.hidden, false);
  assert.equal(test.document.body.classList.contains('is-hosted-mode'), true);
  assert.equal(test.nodes.byokControlPanel.hidden, false);
  assert.equal(test.nodes.resultPanel.hidden, false);
  assert.equal(test.nodes.editResultPanel.hidden, true);
  assert.equal(test.nodes.emptyResult.hidden, false);
  assert.equal(test.workspaceEvents.some((row) => row[0] === 'bootstrap'), true);
  assert.equal(test.workspaceEvents.some((row) => row[0] === 'runtime'), true);
  assert.equal(test.nodes.hostedStartButton.disabled, true);

  activate(test, 'BYOK');
  await settle();
  assert.equal(test.controller.isActive(), false);
  assert.equal(test.document.body.classList.contains('is-hosted-mode'), false);
  assert.equal(test.nodes.byokControlPanel.hidden, false);
  assert.equal(test.nodes.resultPanel.hidden, false);
  activate(test);
  await settle();

  test.nodes.hostedCostConfirmation.checked = true;
  test.nodes.hostedCostConfirmation.dispatch('change');
  assert.equal(test.nodes.hostedStartButton.disabled, false);
  test.nodes.hostedStartButton.dispatch('click');
  await settle(40);
  const execute = test.calls.find((row) => row[0] === 'execute');
  assert.equal(execute[1].intent.action, 'START');
  assert.deepEqual(JSON.parse(JSON.stringify(execute[1].confirmation)), {
    confirmed: true, maximumCostCents: 24,
  });
  assert.equal(test.nodes.hostedCostConfirmation.checked, false);
  assert.ok(test.calls.filter((row) => row[0] === 'load-suite').length >= 2);
}

{
  const test = harness({ projection: projection() });
  await test.controller.refresh();
  activate(test);
  await settle(20);
  const bootstrapCount = test.workspaceEvents.filter((row) => row[0] === 'bootstrap').length;
  activate(test, 'BYOK');
  assert.equal(test.controller.isActive(), true,
    'an authority-projected suite keeps the mode locked after page reload');
  const corrected = test.workspaceEvents.filter((row) => row[0] === 'bootstrap');
  assert.equal(corrected.length, bootstrapCount + 1);
  assert.equal(corrected.at(-1)[1].executionMode, 'ERP_HOSTED');
  assert.equal(corrected.at(-1)[1].dispatched, true);
}

{
  let releaseExecute;
  const executeDeferred = new Promise((resolve) => { releaseExecute = resolve; });
  const test = harness({
    projection: projection({ suite: false }),
    executeDeferred,
  });
  await test.controller.refresh();
  activate(test);
  await settle(20);
  test.nodes.hostedCostConfirmation.checked = true;
  test.nodes.hostedCostConfirmation.dispatch('change');
  test.nodes.hostedStartButton.dispatch('click');
  await Promise.resolve();
  const lockedBootstrap = test.workspaceEvents.filter((row) => row[0] === 'bootstrap').at(-1)[1];
  assert.equal(lockedBootstrap.executionMode, 'ERP_HOSTED');
  assert.equal(lockedBootstrap.dispatched, true, 'START must synchronously freeze mode selection');

  const bootstrapCount = test.workspaceEvents.filter((row) => row[0] === 'bootstrap').length;
  activate(test, 'BYOK');
  assert.equal(test.controller.isActive(), true, 'a pre-mutated BYOK selector event must be reverted');
  const corrected = test.workspaceEvents.filter((row) => row[0] === 'bootstrap');
  assert.equal(corrected.length, bootstrapCount + 1);
  assert.equal(corrected.at(-1)[1].executionMode, 'ERP_HOSTED');
  assert.equal(corrected.at(-1)[1].dispatched, true);

  test.setProjection(projection());
  releaseExecute();
  await settle(40);
  assert.equal(test.controller.isActive(), true);
}

{
  const rejected = Object.assign(new Error('not submitted'), {
    code: 'SS_ERP_HOSTED_WORKBENCH_REQUEST_FAILED',
  });
  const test = harness({ projection: projection({ suite: false }), executeError: rejected });
  await test.controller.refresh();
  activate(test);
  await settle(20);
  test.nodes.hostedCostConfirmation.checked = true;
  test.nodes.hostedCostConfirmation.dispatch('change');
  test.nodes.hostedStartButton.dispatch('click');
  await settle(40);
  const reloaded = test.workspaceEvents.filter((row) => row[0] === 'bootstrap').at(-1)[1];
  assert.equal(reloaded.dispatched, false, 'definite pre-submit failure unlocks only via reload');
  activate(test, 'BYOK');
  assert.equal(test.controller.isActive(), false);
}

{
  const rejected = Object.assign(new Error('not submitted'), {
    code: 'SS_ERP_HOSTED_WORKBENCH_REQUEST_FAILED',
  });
  const test = harness({
    projection: projection({ suite: false }),
    executeError: rejected,
    reloadFailureAfterRejectedStart: true,
  });
  await test.controller.refresh();
  activate(test);
  await settle(20);
  test.nodes.hostedCostConfirmation.checked = true;
  test.nodes.hostedCostConfirmation.dispatch('change');
  test.nodes.hostedStartButton.dispatch('click');
  await settle(40);
  assert.equal(test.controller.isAvailable(), false);
  assert.equal(test.controller.isActive(), true);
  assert.match(test.nodes.hostedStatus.textContent, /权威状态刷新失败.*保持锁定/u);
  assert.equal(
    test.workspaceEvents.filter((row) => row[0] === 'bootstrap').at(-1)[1].dispatched,
    true,
  );
  activate(test, 'BYOK');
  assert.equal(test.controller.isActive(), true,
    'a failed authority reload cannot release the START mode lock');
}

{
  const test = harness({
    projection: projection({ suite: false }),
    reloadFailureAfterExecute: true,
  });
  await test.controller.refresh();
  activate(test);
  await settle(20);
  test.nodes.hostedCostConfirmation.checked = true;
  test.nodes.hostedCostConfirmation.dispatch('change');
  test.nodes.hostedStartButton.dispatch('click');
  await settle(40);
  assert.equal(test.controller.isAvailable(), false);
  assert.equal(test.controller.isActive(), true);
  assert.match(test.nodes.hostedStatus.textContent, /已被 ERP 接受/u);
  assert.equal(
    test.workspaceEvents.filter((row) => row[0] === 'bootstrap').at(-1)[1].dispatched,
    true,
  );
  activate(test, 'BYOK');
  assert.equal(test.controller.isActive(), true, 'accepted START remains mode-locked on reload failure');
}

{
  const responseLoss = Object.assign(new Error('response lost'), {
    code: 'SS_ERP_HOSTED_WORKBENCH_RUNTIME_TIMEOUT',
  });
  const test = harness({
    plan: planResponse(null),
    projection: emptyProjection(),
    createErrors: [responseLoss],
  });
  await test.controller.refresh();
  activate(test);
  await settle(30);
  assert.equal(test.controller.isAvailable(), true);
  assert.equal(
    test.nodes.hostedCreatePlanButton.disabled,
    false,
    'a fresh authority without a plan may create one',
  );

  test.nodes.hostedCreatePlanButton.dispatch('click');
  await settle(40);
  const firstCreate = test.calls.filter((row) => row[0] === 'create-plan')[0];
  assert.ok(firstCreate);
  assert.equal(test.nodes.hostedCreatePlanButton.disabled, false);

  const reloadedPage = harness({ plan: planResponse(null), projection: emptyProjection() });
  await reloadedPage.controller.refresh();
  activate(reloadedPage);
  await settle();
  reloadedPage.nodes.hostedCreatePlanButton.dispatch('click');
  await settle(40);
  assert.equal(
    reloadedPage.calls.find((row) => row[0] === 'create-plan')[1].idempotencyKey,
    firstCreate[1].idempotencyKey,
    'the exact create basis must survive a full page reload deterministically',
  );

  test.setPlan(planResponse('PENDING'));
  test.setProjection(emptyProjection());
  test.nodes.hostedCreatePlanButton.dispatch('click');
  await settle(40);
  const creates = test.calls.filter((row) => row[0] === 'create-plan');
  assert.equal(creates.length, 2);
  assert.equal(
    creates[1][1].idempotencyKey,
    creates[0][1].idempotencyKey,
    'response-loss retry must reuse the exact create identity',
  );
  assert.equal(test.nodes.hostedApprovePlanButton.disabled, false);
  assert.equal(test.nodes.hostedRejectPlanButton.disabled, false);

  test.setPlan(planResponse('APPROVED'));
  test.setProjection(projection({ suite: false }));
  test.nodes.hostedApprovePlanButton.dispatch('click');
  await settle(40);
  const approval = test.calls.find((row) => row[0] === 'review-plan');
  assert.equal(approval[1].decision, 'APPROVE');
  assert.equal(approval[1].expectedRevision, 3);
  assert.equal(test.workspaceEvents.some((row) => row[0] === 'bootstrap'), true);
}

{
  const redHero = planSlot(0, 'sku:sku-red:hero', 'Red hero');
  const blueHero = planSlot(1, 'sku:sku-blue:hero', 'Blue hero');
  blueHero.ownership = { level: 'sku', key: 'sku-blue' };
  blueHero.applicableSkuKeys = ['sku-blue'];
  const partialShared = planSlot(2, 'group:visual-shared:gallery:1', 'Shared detail');
  partialShared.ownership = { level: 'compatibility_group', key: 'visual-shared' };
  partialShared.applicableSkuKeys = ['sku-red'];
  const plans = [redHero, blueHero, partialShared];

  const unpaid = harness({ projection: projection({
    plans,
    suite: false,
    startIntent: false,
  }) });
  await unpaid.controller.refresh();
  activate(unpaid);
  await settle(20);
  assert.equal(unpaid.nodes.hostedStartButton.disabled, true);
  assert.equal(unpaid.nodes.hostedCostConfirmation.disabled, true);
  assert.match(unpaid.nodes.hostedAssignmentNotice.textContent, /禁止付费执行/u);
  unpaid.nodes.hostedStartButton.dispatch('click');
  assert.equal(unpaid.calls.some((row) => row[0] === 'execute'), false);

  const existing = harness({
    projection: projection({
      plans,
      slots: plans.map(() => ({ status: 'SUCCEEDED', reviewStatus: 'APPROVED' })),
    }),
  });
  await existing.controller.refresh();
  activate(existing);
  await settle(20);
  assert.equal(existing.nodes.hostedAssignApprovedButton.disabled, true);
  assert.match(existing.nodes.hostedAssignmentNotice.textContent, /部分 SKU/u);
  const sharedCopy = existing.nodes.hostedSlotList.children[2].children[0];
  assert.match(
    sharedCopy.children.map((node) => node.textContent).join(' '),
    /商品共享.*sku-red.*不支持部分 SKU/u,
  );

  const paused = harness({
    projection: projection({ plans, suiteStatus: 'PLANNED', continueIntent: true }),
  });
  await paused.controller.refresh();
  activate(paused);
  await settle(20);
  assert.equal(paused.nodes.hostedContinueButton.disabled, true);
  paused.nodes.hostedContinueButton.dispatch('click');
  assert.equal(paused.calls.some((row) => row[0] === 'execute'), false);

  const failed = harness({
    projection: projection({
      plans,
      suiteStatus: 'FAILED',
      slots: plans.map((plan, index) => ({
        status: 'FAILED',
        retry: index === 0,
      })),
    }),
  });
  await failed.controller.refresh();
  activate(failed);
  await settle(20);
  const retry = findAction(failed.nodes.hostedSlotList, 'retry', 'slot-1');
  assert.equal(retry.disabled, true);
  retry.dispatch('click');
  assert.equal(failed.calls.some((row) => row[0] === 'execute'), false);
}

{
  const test = harness({ plan: planResponse('PENDING'), projection: emptyProjection() });
  await test.controller.refresh();
  activate(test);
  await settle(20);
  test.setPlan(planResponse('REJECTED'));
  test.setProjection(emptyProjection());
  test.nodes.hostedRejectPlanButton.dispatch('click');
  await settle(30);
  const rejection = test.calls.find((row) => row[0] === 'review-plan');
  assert.equal(rejection[1].decision, 'REJECT');
  assert.equal(
    test.nodes.hostedCreatePlanButton.disabled,
    true,
    'rejected plans require a new authority instead of same-binding re-plan',
  );
}

{
  const schedulable = projection({ continueIntent: true, cancelIntent: true });
  const test = harness({ projection: schedulable });
  await test.controller.refresh();
  activate(test);
  await settle(20);
  assert.equal(test.nodes.hostedContinueButton.disabled, false);
  assert.equal(test.nodes.hostedCancelButton.disabled, false);
  test.nodes.hostedContinueButton.dispatch('click');
  await settle(30);
  test.nodes.hostedCancelButton.dispatch('click');
  await settle(30);
  assert.deepEqual(
    test.calls.filter((row) => row[0] === 'execute').map((row) => row[1].intent.action),
    ['CONTINUE', 'CANCEL'],
  );
}

{
  const retryable = projection({
    suiteStatus: 'FAILED',
    slots: [{ status: 'PLANNED' }, { status: 'FAILED', retry: true }],
  });
  const test = harness({ projection: retryable });
  await test.controller.refresh();
  activate(test);
  await settle(20);
  const chooseRetry = findAction(test.nodes.hostedSlotList, 'retry', 'slot-2');
  assert.equal(chooseRetry.textContent, '选择重试');
  chooseRetry.dispatch('click');
  assert.match(test.nodes.hostedCostConfirmationLabel.textContent, /¥0\.12/u);
  assert.equal(test.calls.some((row) => row[0] === 'execute'), false);
  test.nodes.hostedCostConfirmation.checked = true;
  test.nodes.hostedCostConfirmation.dispatch('change');
  const confirmRetry = findAction(test.nodes.hostedSlotList, 'retry', 'slot-2');
  assert.equal(confirmRetry.textContent, '确认重试');
  assert.equal(confirmRetry.disabled, false);
  confirmRetry.dispatch('click');
  await settle(30);
  const retries = test.calls.filter((row) => row[0] === 'execute');
  assert.equal(retries.length, 1);
  assert.equal(retries[0][1].intent.action, 'RETRY_SLOT');
  assert.deepEqual(JSON.parse(JSON.stringify(retries[0][1].confirmation)), {
    confirmed: true, maximumCostCents: 12,
  });
}

{
  const schedulable = projection({ continueIntent: true });
  const test = harness({ projection: schedulable, mapperRuntimeErrorAt: 2 });
  await test.controller.refresh();
  activate(test);
  await settle(30);
  assert.equal(test.calls.filter((row) => row[0] === 'create-mapper').length, 1);
  test.nodes.hostedContinueButton.dispatch('click');
  await settle(40);
  assert.equal(
    test.calls.filter((row) => row[0] === 'create-mapper').length,
    1,
    'a stale runtime projection must not be accepted by rebuilding its mapper',
  );
  assert.equal(test.controller.isAvailable(), false);
  assert.match(test.nodes.hostedStatus.textContent, /重新读取/u);
}

{
  const pending = projection({
    slots: [
      { status: 'SUCCEEDED', reviewStatus: 'PENDING' },
      { status: 'SUCCEEDED', reviewStatus: 'PENDING' },
    ],
  });
  const test = harness({ projection: pending });
  await test.controller.refresh();
  activate(test);
  await settle(30);
  const preview = findAction(test.nodes.hostedSlotList, 'preview', 'slot-1');
  const approve = findAction(test.nodes.hostedSlotList, 'approve', 'slot-1');
  const reject = findAction(test.nodes.hostedSlotList, 'reject', 'slot-2');
  assert.ok(preview && approve && reject);
  assert.equal(test.nodes.hostedSlotList.children[0].className, 'hosted-slot-item');
  assert.equal(test.nodes.hostedSlotList.children[0].children[0].className, 'hosted-slot-copy');

  preview.dispatch('click');
  await settle(30);
  assert.equal(test.nodes.hostedPreviewImage.src, 'blob:hosted-preview');
  assert.equal(test.nodes.hostedPreviewPanel.hidden, false);
  await test.controller.refresh();
  assert.equal(test.previewRevokes(), 1, 'authority replacement revokes the prior candidate');
  assert.equal(test.nodes.hostedPreviewPanel.hidden, true);
  assert.equal(test.nodes.hostedPreviewImage.src, '');
  findAction(test.nodes.hostedSlotList, 'preview', 'slot-1').dispatch('click');
  await settle(30);
  test.nodes.hostedPreviewCloseButton.dispatch('click');
  assert.equal(test.previewRevokes(), 2);
  assert.equal(test.nodes.hostedPreviewImage.src, '');

  approve.dispatch('click');
  await settle(30);
  reject.dispatch('click');
  await settle(30);
  const reviews = test.calls.filter((row) => row[0] === 'execute')
    .map((row) => row[1].intent);
  assert.equal(reviews.some((row) => row.action === 'REVIEW_SLOT'
    && row.decision === 'APPROVE'), true);
  assert.equal(reviews.some((row) => row.action === 'REVIEW_SLOT'
    && row.decision === 'REJECT'), true);
}

{
  const approved = projection({
    slots: [
      { status: 'SUCCEEDED', reviewStatus: 'APPROVED' },
      { status: 'SUCCEEDED', reviewStatus: 'APPROVED' },
    ],
  });
  const test = harness({ projection: approved });
  await test.controller.refresh();
  activate(test);
  await settle(30);
  assert.equal(test.nodes.hostedAssignApprovedButton.disabled, false);
  test.nodes.hostedAssignApprovedButton.dispatch('click');
  await settle(40);
  const assignment = test.calls.find((row) => row[0] === 'assign');
  assert.equal(assignment[1].intents.length, 2);
  assert.equal(assignment[1].intents.every((intent) => intent.action === 'APPLY_SLOT'), true);
  assert.equal(
    assignment[1].assignmentStartOrdinal,
    2,
    'batch assignment must start at the exact draft tail',
  );
  assert.equal(
    test.calls.some((row) => row[0] === 'execute' && row[1].intent.action === 'APPLY_SLOT'),
    false,
  );
  assert.equal(test.controller.isAvailable(), false);
  assert.equal(test.controller.isActive(), true);
  assert.equal(test.workspaceEvents.some((row) => row[0] === 'clear'), true);
  assert.match(test.nodes.hostedAssignmentNotice.textContent, /重新校验/u);
  assert.equal(
    await test.controller.refresh(),
    false,
    'the pre-assignment launch context cannot satisfy draft revalidation',
  );
}

{
  const unknown = Object.assign(new Error('assignment response lost'), {
    code: 'SS_ERP_HOSTED_WORKBENCH_ASSIGNMENT_UNKNOWN_OUTCOME',
    outcome: 'UNKNOWN_OUTCOME', automaticRetryAllowed: false,
  });
  const approved = projection({
    slots: [
      { status: 'SUCCEEDED', reviewStatus: 'APPROVED' },
      { status: 'SUCCEEDED', reviewStatus: 'REJECTED' },
    ],
  });
  const test = harness({ projection: approved, assignmentError: unknown });
  await test.controller.refresh();
  activate(test);
  await settle(20);
  test.nodes.hostedAssignApprovedButton.dispatch('click');
  await settle(30);
  assert.match(test.nodes.hostedStatus.textContent, /写入结果待核对/u);
  assert.equal(test.calls.filter((row) => row[0] === 'assign').length, 1);
  const blocked = test.nodes.hostedAssignApprovedButton;
  assert.equal(blocked.disabled, true);
  blocked.dispatch('click');
  await settle();
  assert.equal(test.calls.filter((row) => row[0] === 'assign').length, 1);
  activate(test, 'BYOK');
  assert.equal(test.controller.isActive(), true,
    'an assignment unknown outcome keeps the hosted mode locked');
}

{
  const unknown = Object.assign(new Error('do not retry'), {
    code: 'SS_ERP_HOSTED_WORKBENCH_EXECUTION_UNKNOWN_OUTCOME',
    outcome: 'UNKNOWN_OUTCOME', automaticRetryAllowed: false,
  });
  const test = harness({ projection: projection({ suite: false }), executeError: unknown });
  await test.controller.refresh();
  activate(test);
  await settle(20);
  test.nodes.hostedCostConfirmation.checked = true;
  test.nodes.hostedCostConfirmation.dispatch('change');
  test.nodes.hostedStartButton.dispatch('click');
  await settle(30);
  assert.match(test.nodes.hostedStatus.textContent, /结果待核对/u);
  assert.equal(test.nodes.hostedStartButton.disabled, true);
  test.nodes.hostedStartButton.dispatch('click');
  await settle();
  assert.equal(test.calls.filter((row) => row[0] === 'execute').length, 1);
  activate(test, 'BYOK');
  assert.equal(test.controller.isActive(), true);
  const corrected = test.workspaceEvents.filter((row) => row[0] === 'bootstrap').at(-1)[1];
  assert.equal(corrected.executionMode, 'ERP_HOSTED');
  assert.equal(corrected.dispatched, true);
}

{
  const stale = Object.assign(new Error('stale'), {
    code: 'SS_ERP_HOSTED_WORKSPACE_ACTION_STALE',
  });
  const reviewable = projection({
    slots: [
      { status: 'SUCCEEDED', reviewStatus: 'PENDING' },
      { status: 'PLANNED' },
    ],
  });
  const test = harness({ projection: reviewable, lookupError: stale });
  await test.controller.refresh();
  activate(test);
  await settle(20);
  test.document.dispatchEvent(new FakeCustomEvent('ss-erp:workspace-intent', {
    detail: workspaceIntent('KEEP_ATTEMPT', {
      slotKey: 'sku:sku-red:hero', attemptId: 'hosted:slot-1:1',
      expectedSlotRevision: 5,
    }),
  }));
  await settle(20);
  const outcome = test.workspaceEvents.find((row) => row[0] === 'outcome');
  assert.equal(outcome[1].status, 'REJECTED');
  assert.equal(outcome[1].errorCode, 'SS_ERP_HOSTED_WORKSPACE_ACTION_STALE');
  assert.equal(test.calls.some((row) => row[0] === 'execute'), false);
}

for (const workspaceCase of [
  {
    name: 'continue',
    projection: projection({ continueIntent: true }),
    intent: workspaceIntent('CONTINUE'),
  },
  {
    name: 'review',
    projection: projection({
      slots: [
        { status: 'SUCCEEDED', reviewStatus: 'PENDING' },
        { status: 'PLANNED' },
      ],
    }),
    intent: workspaceIntent('KEEP_ATTEMPT', {
      slotKey: 'sku:sku-red:hero',
      attemptId: 'hosted:slot-1:1',
      expectedSlotRevision: 5,
    }),
  },
  {
    name: 'retry',
    projection: projection({
      suiteStatus: 'FAILED',
      slots: [{ status: 'PLANNED' }, { status: 'FAILED', retry: true }],
    }),
    intent: workspaceIntent('REGENERATE_SLOT', {
      slotKey: 'sku:sku-red:detail-1',
      expectedSlotRevision: 5,
      externalChargeAcknowledgement: {
        warningVersion: 'erp-hosted-additional-cost/v1', confirmed: true,
      },
    }),
  },
]) {
  const unknown = Object.assign(new Error(workspaceCase.name + ' unknown'), {
    code: 'SS_ERP_HOSTED_WORKBENCH_EXECUTION_UNKNOWN_OUTCOME',
    outcome: 'UNKNOWN_OUTCOME', automaticRetryAllowed: false,
  });
  const test = harness({ projection: workspaceCase.projection, executeError: unknown });
  await test.controller.refresh();
  activate(test);
  await settle(20);
  const priorOutcomes = test.workspaceEvents.filter((row) => row[0] === 'outcome').length;
  test.document.dispatchEvent(new FakeCustomEvent('ss-erp:workspace-intent', {
    detail: workspaceCase.intent,
  }));
  await settle(30);
  assert.equal(test.calls.filter((row) => row[0] === 'execute').length, 1, workspaceCase.name);
  assert.equal(
    test.workspaceEvents.filter((row) => row[0] === 'outcome').length,
    priorOutcomes,
    workspaceCase.name + ' unknown must keep the workspace intent pending',
  );
  assert.match(test.nodes.hostedStatus.textContent, /结果待核对/u);
}

{
  const previewable = projection({
    slots: [
      { status: 'SUCCEEDED', reviewStatus: 'PENDING' },
      { status: 'PLANNED' },
    ],
  });
  const test = harness({ projection: previewable });
  await test.controller.refresh();
  activate(test);
  await settle(20);
  findAction(test.nodes.hostedSlotList, 'preview', 'slot-1').dispatch('click');
  await settle(20);
  test.pagehide();
  await settle();
  assert.equal(test.previewRevokes(), 1);
  assert.equal(test.consumerDisposes(), 1);
  assert.equal(test.controller.isAvailable(), false);
  assert.equal(test.controller.isActive(), false);
  assert.equal(test.calls.some((row) => row[0] === 'clear-client'), true);
}

{
  const test = harness();
  await test.controller.refresh();
  assert.equal(test.runtimeListeners.length, 1);
  test.runtimeListeners[0]({ type: 'SS_ERP_EXTENSION_DEVICE_INVALIDATED' });
  await settle();
  assert.equal(test.consumerDisposes(), 1);
  assert.equal(test.controller.isAvailable(), false);
  assert.equal(test.controller.isActive(), false);
}

console.log('extension hosted AI image workbench controller tests passed');
