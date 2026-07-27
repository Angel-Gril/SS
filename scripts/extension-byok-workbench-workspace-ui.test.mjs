import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const contractPath = 'extensions/ss-erp/shared/contracts/ai-image-workbench-v1.js';
const statePath = 'extensions/ss-erp/shared/byok/workbench-workspace-state.js';
const controllerPath = 'extensions/ss-erp/pages/ai-image-workbench-workspace.js';
const htmlPath = 'extensions/ss-erp/pages/ai-image-workbench.html';
const cssPath = 'extensions/ss-erp/pages/ai-image-workbench.css';

for (const path of [contractPath, statePath, controllerPath, htmlPath, cssPath]) {
  assert.equal(fs.existsSync(path), true, `${path} must exist`);
}

const controllerSource = fs.readFileSync(controllerPath, 'utf8');
const htmlSource = fs.readFileSync(htmlPath, 'utf8');
const cssSource = fs.readFileSync(cssPath, 'utf8');
const contractScriptIndex = htmlSource.indexOf('../shared/contracts/ai-image-workbench-v1.js');
const stateScriptIndex = htmlSource.indexOf('../shared/byok/workbench-workspace-state.js');
const controllerScriptIndex = htmlSource.indexOf('./ai-image-workbench-workspace.js');
const workbenchGridIndex = htmlSource.indexOf('class="workbench-grid"');
const taskDockIndex = htmlSource.indexOf('id="workspaceTaskDock"');
assert.ok(contractScriptIndex >= 0 && contractScriptIndex < stateScriptIndex);
assert.ok(stateScriptIndex < controllerScriptIndex);
assert.ok(workbenchGridIndex >= 0 && workbenchGridIndex < taskDockIndex);
for (const id of [
  'workspaceTaskProgress', 'workspacePauseButton', 'workspaceContinueButton',
  'workspaceTaskControlReason', 'workspaceQueuedAttempts', 'workspacePublishSummary',
  'workspaceChargeAcknowledgement', 'workspaceRegenerateButton',
  'workspaceRegenerateReason',
]) {
  assert.match(htmlSource, new RegExp(`id=["']${id}["']`, 'u'), `${id} must exist`);
}
assert.match(cssSource, /@media\s*\(max-width:\s*1120px\)/u);
assert.match(cssSource, /\.workspace-task-dock\s*\{[\s\S]*grid-column:\s*3;/u);
assert.match(cssSource, /@media\s*\(max-width:\s*720px\)[\s\S]*\.workspace-task-dock\s*\{[\s\S]*position:\s*static;/u);
assert.match(cssSource, /@media\s*\(max-width:\s*900px\)[\s\S]*\.workspace-board\s*\{\s*grid-template-columns:\s*repeat\(2,/u);
const mobileCss = cssSource.slice(
  cssSource.indexOf('@media (max-width: 520px)'),
  cssSource.indexOf('@media (prefers-reduced-motion: reduce)'),
);
for (const selector of [
  '.workspace-library-tabs [data-workspace-action="select-library-tab"]',
  '.workspace-library-list [data-workspace-action="toggle-global-reference"]',
  '.workspace-library-list [data-workspace-action="toggle-slot-reference"]',
  '.header-actions .button',
  '.generation-footer .button',
  '.hosted-plan-actions .button',
  '.hosted-slot-actions .button',
]) {
  assert.ok(mobileCss.includes(selector), `${selector} must retain the mobile touch target`);
}
assert.match(mobileCss, /min-height:\s*44px;/u);
assert.doesNotMatch(
  controllerSource,
  /innerHTML|\bfetch\s*\(|chrome\.storage|localStorage|sessionStorage/iu,
  'workspace UI must stay a pure state/rendering controller',
);
assert.match(controllerSource, /event\.isTrusted\s*===\s*true/u);
assert.match(controllerSource, /ss-erp:workspace-bootstrap/u);
assert.match(controllerSource, /ss-erp:workspace-runtime/u);
assert.match(controllerSource, /ss-erp:workspace-clear/u);

let activeDocument = null;

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...values) { values.forEach((value) => this.values.add(value)); }
  remove(...values) { values.forEach((value) => this.values.delete(value)); }
  contains(value) { return this.values.has(value); }
  toggle(value, force) {
    if (force === true) this.values.add(value);
    else if (force === false) this.values.delete(value);
    else if (this.values.has(value)) this.values.delete(value);
    else this.values.add(value);
  }
}

class FakeNode {
  constructor(id = '', tagName = 'div') {
    this.id = id;
    this.tagName = tagName.toUpperCase();
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this.hidden = false;
    this.checked = false;
    this.type = '';
    this.title = '';
    this.tabIndex = 0;
    this.dataset = {};
    this.attributes = {};
    this.children = [];
    this.parentNode = null;
    this.listeners = new Map();
    this.className = '';
    this.classList = new FakeClassList();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  setAttribute(name, value) { this.attributes[name] = String(value); }

  removeAttribute(name) { delete this.attributes[name]; }

  appendChild(child) {
    const movedFocusedSubtree = child.parentNode === this && activeDocument
      && [child, ...descendants(child)].includes(activeDocument.activeElement);
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    if (movedFocusedSubtree) activeDocument.activeElement = null;
    return child;
  }

  insertBefore(child, anchor) {
    if (!anchor) return this.appendChild(child);
    const movedFocusedSubtree = child.parentNode === this && activeDocument
      && [child, ...descendants(child)].includes(activeDocument.activeElement);
    if (child.parentNode) child.parentNode.removeChild(child);
    const index = this.children.indexOf(anchor);
    child.parentNode = this;
    this.children.splice(index < 0 ? this.children.length : index, 0, child);
    if (movedFocusedSubtree) activeDocument.activeElement = null;
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }

  focus() {
    if (activeDocument) activeDocument.activeElement = this;
  }

  dispatch(type, overrides = {}) {
    const event = {
      type,
      isTrusted: true,
      key: '',
      detail: null,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      ...overrides,
    };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }
}

class FakeCustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
}

const ids = [
  'workspaceShell', 'workspaceSkuList', 'workspaceLibraryTabs', 'workspaceLibraryList',
  'workspaceSlotList', 'workspacePromptInspector', 'workspacePromptInput',
  'workspaceNegativePromptInput', 'workspaceSavePromptButton', 'workspaceReferenceSummary',
  'workspaceTaskDock', 'workspaceTaskSummary', 'workspaceTaskProgress',
  'workspacePauseButton', 'workspaceContinueButton', 'workspaceTaskControlReason',
  'workspaceQueuedAttempts',
  'workspacePublishSummary', 'workspaceChargeAcknowledgement',
  'workspaceChargeAcknowledgementLabel',
  'workspaceRegenerateButton', 'workspaceRegenerateReason', 'workspaceOrderAnnouncement',
  'workspaceModeSummary',
];
const nodeTags = {
  workspaceSkuList: 'ul',
  workspaceLibraryTabs: 'div',
  workspaceLibraryList: 'ul',
  workspaceSlotList: 'ol',
  workspacePromptInput: 'textarea',
  workspaceNegativePromptInput: 'textarea',
  workspaceSavePromptButton: 'button',
  workspaceTaskDock: 'aside',
  workspaceTaskProgress: 'div',
  workspacePauseButton: 'button',
  workspaceContinueButton: 'button',
  workspaceTaskControlReason: 'p',
  workspaceQueuedAttempts: 'ul',
  workspacePublishSummary: 'div',
  workspaceChargeAcknowledgement: 'input',
  workspaceRegenerateButton: 'button',
  workspaceRegenerateReason: 'p',
  workspaceOrderAnnouncement: 'p',
};
const nodes = Object.fromEntries(ids.map((id) => [id, new FakeNode(id, nodeTags[id] || 'div')]));
const documentListeners = new Map();
const emittedActions = [];
const emittedIntents = [];
let commandIdSequence = 0;
const crypto = {
  randomUUID() {
    commandIdSequence += 1;
    return `00000000-0000-4000-8000-${commandIdSequence.toString(16).padStart(12, '0')}`;
  },
};
const document = {
  activeElement: null,
  getElementById(id) { return nodes[id] || null; },
  createElement(tagName) { return new FakeNode('', tagName); },
  addEventListener(type, listener) {
    const listeners = documentListeners.get(type) || [];
    listeners.push(listener);
    documentListeners.set(type, listeners);
  },
  dispatchEvent(event) {
    if (event.type === 'ss-erp:workspace-action') emittedActions.push(event.detail);
    if (event.type === 'ss-erp:workspace-intent') emittedIntents.push(event.detail);
    for (const listener of documentListeners.get(event.type) || []) listener(event);
    return true;
  },
};
activeDocument = document;

const context = {
  Array, Boolean, Error, JSON, Map, Math, Number, Object, RegExp, Set, String, TypeError,
  CustomEvent: FakeCustomEvent, crypto,
  document,
};
context.globalThis = context;
vm.runInNewContext(fs.readFileSync(contractPath, 'utf8'), context, { filename: contractPath });
vm.runInNewContext(fs.readFileSync(statePath, 'utf8'), context, { filename: statePath });
vm.runInNewContext(controllerSource, context, { filename: controllerPath });

assert.equal(nodes.workspaceTaskProgress.hidden, true);
assert.equal(nodes.workspaceTaskProgress.attributes.role, undefined);
assert.equal(nodes.workspaceTaskProgress.attributes['aria-valuenow'], undefined);
assert.equal(nodes.workspaceTaskProgress.attributes['aria-valuemax'], undefined);

function libraryItem(mediaId, sourceType, overrides = {}) {
  return {
    mediaId,
    sourceType,
    label: `${sourceType} ${mediaId}`,
    secondaryLabel: sourceType === 'SKU' ? '当前 SKU' : '',
    skuKeys: [],
    referenceEligible: true,
    ...overrides,
  };
}

const defaultBinding = Object.freeze({
  shopId: 'shop-ui-05',
  workflowId: 'workflow-ui-05',
  draftRevision: 7,
  draftVersion: 3,
});

function binding(overrides = {}) {
  return { ...defaultBinding, ...overrides };
}

function alternative(attemptId, state = 'CANDIDATE_READY', mediaId = `media-${attemptId}`) {
  return { attemptId, state, mediaId, errorCode: null };
}

function slot(slotKey, role, overrides = {}) {
  return {
    slotKey,
    role,
    prompt: `${slotKey} prompt`,
    negativePrompt: 'watermark',
    referenceIds: null,
    alternatives: [],
    selectedAttemptId: null,
    ...overrides,
  };
}

function sku(skuKey) {
  return {
    skuKey,
    label: `SKU ${skuKey}`,
    slots: [
      slot(`${skuKey}:hero`, 'HERO'),
      slot(`${skuKey}:detail`, 'DETAIL'),
    ],
  };
}

function bootstrapInput(overrides = {}) {
  return {
    contractVersion: 'extension-byok-workbench-workspace-state/v1',
    binding: binding(),
    executionMode: 'BYOK',
    dispatched: false,
    selectedSkuKey: 'red',
    selectedSlotKey: null,
    globalReferenceIds: ['captured-main'],
    libraryItems: [
      libraryItem('captured-main', 'CAPTURED'),
      libraryItem('red-source', 'SKU', { skuKeys: ['red'] }),
      libraryItem('upload-one', 'UPLOADED'),
      libraryItem('generated-seed', 'GENERATED'),
    ],
    skus: [sku('red'), sku('blue')],
    ...overrides,
  };
}

function blueDetailReviewProjection(revision, overrides = {}) {
  const selectedAttemptId = Object.prototype.hasOwnProperty.call(
    overrides,
    'selectedAttemptId',
  ) ? overrides.selectedAttemptId : 'attempt-blue-detail';
  const additionalAlternatives = overrides.additionalAlternatives || [];
  const additionalLibraryItems = overrides.additionalLibraryItems || [];
  return {
    contractVersion: 'extension-byok-workbench-workspace-runtime/v1',
    binding: binding(),
    revision,
    task: { schedulerState: 'REVIEW', disabledReason: null },
    libraryItems: [
      libraryItem('runtime-blue-detail', 'GENERATED', { skuKeys: ['blue'] }),
      libraryItem('runtime-blue-detail-alt', 'GENERATED', { skuKeys: ['blue'] }),
      ...additionalLibraryItems,
    ],
    slots: [{
      slotKey: 'blue:detail',
      status: 'CANDIDATE_READY',
      alternatives: [
        alternative('attempt-blue-detail', 'CANDIDATE_READY', 'runtime-blue-detail'),
        alternative(
          'attempt-blue-detail-alt',
          overrides.alternateState || 'CANDIDATE_READY',
          'runtime-blue-detail-alt',
        ),
        ...additionalAlternatives,
      ],
      selectedAttemptId,
      slotRevision: overrides.slotRevision || revision,
    }],
  };
}

function activeTaskProjection(revision, schedulerState, overrides = {}) {
  const activeState = overrides.activeState || 'SUBMITTING';
  const queuedState = overrides.queuedState || 'QUEUED';
  return {
    contractVersion: 'extension-byok-workbench-workspace-runtime/v1',
    binding: binding(),
    revision,
    task: { schedulerState, disabledReason: null },
    libraryItems: [],
    slots: [
      {
        slotKey: 'red:hero',
        status: activeState,
        alternatives: [alternative('attempt-task-active', activeState, null)],
        selectedAttemptId: null,
        slotRevision: overrides.activeSlotRevision || 10,
      },
      {
        slotKey: 'red:detail',
        status: queuedState,
        alternatives: [alternative('attempt-task-queued', queuedState, null)],
        selectedAttemptId: null,
        slotRevision: overrides.queuedSlotRevision || 20,
      },
    ],
  };
}

function dispatchDocument(type, detail) {
  document.dispatchEvent(new FakeCustomEvent(type, { detail }));
}

function descendants(node) {
  return node.children.flatMap((child) => [child, ...descendants(child)]);
}

function actionNodes(root, action) {
  return descendants(root).filter((node) => node.dataset.workspaceAction === action);
}

function actionNode(root, action, key, value) {
  return actionNodes(root, action).find((node) => !key || node.dataset[key] === value);
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

const actionIntentKeys = [
  'contractVersion', 'binding', 'action', 'commandId',
  'expectedWorkspaceRevision', 'expectedRuntimeRevision', 'expectedSlotRevision',
  'slotKey', 'attemptId', 'externalChargeAcknowledgement',
];

function assertActionIntent(actual, expected) {
  assert.deepEqual(Object.keys(actual), actionIntentKeys);
  assert.deepEqual(plain(actual), {
    contractVersion: context.SS_ERP_BYOK_WORKBENCH_WORKSPACE_STATE
      .ACTION_INTENT_CONTRACT_VERSION,
    binding: binding(),
    commandId: actual.commandId,
    expectedSlotRevision: null,
    externalChargeAcknowledgement: null,
    ...expected,
  });
  assert.match(actual.commandId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
}

function intentOutcome(intent, status, errorCode = null, overrides = {}) {
  return {
    contractVersion: context.SS_ERP_BYOK_WORKBENCH_WORKSPACE_STATE
      .ACTION_OUTCOME_CONTRACT_VERSION,
    binding: plain(intent.binding),
    action: intent.action,
    commandId: intent.commandId,
    expectedWorkspaceRevision: intent.expectedWorkspaceRevision,
    expectedRuntimeRevision: intent.expectedRuntimeRevision,
    expectedSlotRevision: intent.expectedSlotRevision,
    slotKey: intent.slotKey,
    attemptId: intent.attemptId,
    status,
    errorCode,
    ...overrides,
  };
}

function publishProjection(workspace, revision, overrides = {}) {
  const basis = workspace.getSnapshot().publishBasis;
  return {
    contractVersion: context.SS_ERP_BYOK_WORKBENCH_WORKSPACE_STATE
      .PUBLISH_PROJECTION_CONTRACT_VERSION,
    revision,
    expectedWorkspaceRevision: basis.expectedWorkspaceRevision,
    expectedRuntimeRevision: basis.expectedRuntimeRevision,
    binding: plain(basis.binding),
    draftState: 'CURRENT',
    disabledReason: null,
    orderedMedia: plain(basis.orderedMedia),
    ...overrides,
  };
}

assert.equal(nodes.workspaceShell.hidden, true);
assert.equal(nodes.workspaceShell.attributes['aria-busy'], 'true');
dispatchDocument('ss-erp:workspace-runtime', {
  contractVersion: 'extension-byok-workbench-workspace-runtime/v1',
  binding: binding(),
  revision: 1,
  task: { schedulerState: 'REVIEW', disabledReason: null },
  libraryItems: [libraryItem('pending-old', 'GENERATED', { skuKeys: ['red'] })],
  slots: [{
    slotKey: 'red:hero',
    status: 'CANDIDATE_READY',
    alternatives: [alternative('attempt-pending-old', 'CANDIDATE_READY', 'pending-old')],
    selectedAttemptId: 'attempt-pending-old',
    slotRevision: 11,
  }],
});
dispatchDocument('ss-erp:workspace-runtime', {
  contractVersion: 'extension-byok-workbench-workspace-runtime/v1',
  binding: binding(),
  revision: 2,
  task: { schedulerState: 'REVIEW', disabledReason: null },
  libraryItems: [libraryItem('pending-new', 'GENERATED', { skuKeys: ['red'] })],
  slots: [{
    slotKey: 'red:detail',
    status: 'CANDIDATE_READY',
    alternatives: [alternative('attempt-pending-new', 'CANDIDATE_READY', 'pending-new')],
    selectedAttemptId: 'attempt-pending-new',
    slotRevision: 12,
  }],
});
dispatchDocument('ss-erp:workspace-bootstrap', bootstrapInput());

assert.equal(nodes.workspaceShell.hidden, false);
assert.equal(nodes.workspaceShell.attributes['aria-busy'], 'false');
assert.equal(actionNodes(nodes.workspaceSkuList, 'select-sku').length, 2);
assert.equal(actionNodes(nodes.workspaceLibraryTabs, 'select-library-tab').length, 4);
assert.equal(actionNodes(nodes.workspaceLibraryList, 'toggle-global-reference').length, 1);
assert.equal(actionNodes(nodes.workspaceSlotList, 'select-slot').length, 2);
assert.match(nodes.workspaceReferenceSummary.textContent, /继承全局参考图 1 张/u);
assert.match(nodes.workspaceTaskSummary.textContent, /2 个槽位待补齐/u);
assert.match(nodes.workspaceTaskProgress.textContent, /2\s*\/\s*4/u);
assert.equal(nodes.workspaceTaskProgress.attributes['aria-valuenow'], '2');
assert.equal(nodes.workspaceTaskProgress.attributes['aria-valuemax'], '4');
assert.equal(nodes.workspacePauseButton.disabled, true);
assert.equal(nodes.workspaceContinueButton.disabled, true);
assert.match(nodes.workspacePublishSummary.textContent, /发布协调器尚未接入/u);
assert.match(nodes.workspacePublishSummary.textContent, /草稿状态.*待确认/u);
assert.ok(actionNode(
  nodes.workspacePromptInspector, 'select-alternative', 'attemptId', 'attempt-pending-new',
));
assert.ok(actionNode(
  nodes.workspacePromptInspector, 'select-alternative', 'attemptId', 'attempt-pending-old',
), 'disjoint pre-bootstrap runtime patches are merged before replay');
assert.equal(nodes.workspacePromptInput.disabled, true,
  'a slot with a dispatched candidate cannot accept optimistic Prompt edits');

const redSkuButton = actionNode(nodes.workspaceSkuList, 'select-sku', 'skuKey', 'red');
redSkuButton.focus();
const keyboardEvent = redSkuButton.dispatch('keydown', { key: 'ArrowRight' });
assert.equal(keyboardEvent.defaultPrevented, true);
const blueSkuButton = actionNode(nodes.workspaceSkuList, 'select-sku', 'skuKey', 'blue');
assert.equal(blueSkuButton.attributes['aria-selected'], 'true');
assert.equal(document.activeElement, blueSkuButton);
assert.deepEqual(
  actionNodes(nodes.workspaceSlotList, 'select-slot').map((node) => node.dataset.slotKey),
  ['blue:hero', 'blue:detail'],
);
assert.deepEqual(
  actionNodes(nodes.workspaceSlotList, 'select-slot').map((node) => node.children[0].textContent),
  ['1. 主图', '2. 详情图'],
);
assert.equal(nodes.workspacePromptInput.disabled, false,
  'an untouched SKU slot remains editable until its own execution starts');

const capturedTab = actionNode(
  nodes.workspaceLibraryTabs, 'select-library-tab', 'libraryKind', 'CAPTURED',
);
capturedTab.focus();
capturedTab.dispatch('keydown', { key: 'ArrowRight' });
const skuTab = actionNode(
  nodes.workspaceLibraryTabs, 'select-library-tab', 'libraryKind', 'SKU',
);
assert.equal(skuTab.attributes['aria-selected'], 'true');
assert.equal(document.activeElement, skuTab);
assert.equal(actionNodes(nodes.workspaceLibraryList, 'toggle-slot-reference').length, 1);
const scopedGlobalReference = actionNode(
  nodes.workspaceLibraryList, 'toggle-global-reference', 'mediaId', 'red-source',
);
const scopedSlotReference = actionNode(
  nodes.workspaceLibraryList, 'toggle-slot-reference', 'mediaId', 'red-source',
);
assert.equal(scopedGlobalReference.disabled, true);
assert.match(scopedGlobalReference.title, /任务已派发.*全局参考图已冻结/u);
assert.equal(scopedSlotReference.disabled, true);
assert.match(scopedSlotReference.title, /不属于当前 SKU/u);

const blueDetail = actionNode(
  nodes.workspaceSlotList, 'select-slot', 'slotKey', 'blue:detail',
);
blueDetail.dispatch('click');
assert.equal(blueDetail.attributes['aria-current'], 'true');
assert.equal(nodes.workspacePromptInput.value, 'blue:detail prompt');
const moveUp = actionNode(nodes.workspaceSlotList, 'move-slot-up', 'slotKey', 'blue:detail');
assert.equal(moveUp.disabled, false);
moveUp.focus();
moveUp.dispatch('click');
assert.deepEqual(
  actionNodes(nodes.workspaceSlotList, 'select-slot').map((node) => node.dataset.slotKey),
  ['blue:detail', 'blue:hero'],
);
assert.equal(document.activeElement,
  actionNode(nodes.workspaceSlotList, 'move-slot-up', 'slotKey', 'blue:detail'));
const setBlueDetailMain = actionNode(
  nodes.workspaceSlotList, 'set-main-slot', 'slotKey', 'blue:detail',
);
assert.ok(setBlueDetailMain);
setBlueDetailMain.dispatch('click');
assert.match(
  actionNode(nodes.workspaceSlotList, 'select-slot', 'slotKey', 'blue:detail').children[1]
    .textContent,
  /主图/u,
);

const blueDetailSelect = actionNode(
  nodes.workspaceSlotList, 'select-slot', 'slotKey', 'blue:detail',
);
blueDetailSelect.focus();
for (const [key, expectedOrder] of [
  ['End', ['blue:hero', 'blue:detail']],
  ['ArrowUp', ['blue:detail', 'blue:hero']],
  ['ArrowDown', ['blue:hero', 'blue:detail']],
  ['Home', ['blue:detail', 'blue:hero']],
]) {
  const orderEvent = blueDetailSelect.dispatch('keydown', { key });
  assert.equal(orderEvent.defaultPrevented, true);
  assert.deepEqual(
    actionNodes(nodes.workspaceSlotList, 'select-slot').map((node) => node.dataset.slotKey),
    expectedOrder,
  );
  assert.equal(document.activeElement, blueDetailSelect);
}
assert.match(nodes.workspaceOrderAnnouncement.textContent, /blue:detail.*第 1 位/u);

nodes.workspacePromptInput.value = 'Keep the verified blue product identity unchanged.';
nodes.workspacePromptInput.dispatch('input');
assert.equal(nodes.workspaceSavePromptButton.disabled, false);
nodes.workspacePromptInput.focus();
dispatchDocument('ss-erp:workspace-bootstrap', bootstrapInput({
  selectedSkuKey: 'blue',
  selectedSlotKey: 'blue:detail',
}));
assert.equal(nodes.workspacePromptInput.value,
  'Keep the verified blue product identity unchanged.');
assert.equal(nodes.workspaceSavePromptButton.disabled, false);
assert.equal(document.activeElement, nodes.workspacePromptInput);
const dirtyPromptOrder = actionNodes(nodes.workspaceSlotList, 'select-slot')
  .map((node) => node.dataset.slotKey);
const dirtyPromptOtherSlotMove = actionNode(
  nodes.workspaceSlotList, 'move-slot-down', 'slotKey', 'blue:hero',
);
assert.equal(dirtyPromptOtherSlotMove.disabled, false);
dirtyPromptOtherSlotMove.dispatch('click');
assert.deepEqual(
  actionNodes(nodes.workspaceSlotList, 'select-slot').map((node) => node.dataset.slotKey),
  dirtyPromptOrder,
  'mouse ordering cannot navigate away from an unsaved Prompt',
);
assert.equal(
  actionNode(nodes.workspaceSlotList, 'select-slot', 'slotKey', 'blue:detail')
    .attributes['aria-current'],
  'true',
);
assert.equal(nodes.workspacePromptInput.value,
  'Keep the verified blue product identity unchanged.');
redSkuButton.dispatch('click');
assert.equal(blueSkuButton.attributes['aria-selected'], 'true');
assert.equal(document.activeElement, nodes.workspacePromptInput);
assert.match(nodes.workspaceTaskSummary.textContent, /请先保存当前槽位提示词/u);
nodes.workspaceSavePromptButton.dispatch('click');
assert.equal(nodes.workspaceSavePromptButton.disabled, true);
assert.equal(document.activeElement, nodes.workspacePromptInput);
const promptAction = emittedActions.findLast((action) => action.action === 'SAVE_PROMPT');
assert.equal(promptAction.slotKey, 'blue:detail');
assert.equal(promptAction.prompt, 'Keep the verified blue product identity unchanged.');
assert.deepEqual(Object.keys(promptAction), [
  'contractVersion', 'action', 'revision', 'executionMode', 'skuKey', 'slotKey', 'mediaId',
  'attemptId', 'libraryKind', 'direction', 'prompt', 'negativePrompt',
]);

dispatchDocument('ss-erp:workspace-runtime', blueDetailReviewProjection(3, {
  slotRevision: 30,
}));
const focusedAlternative = actionNode(
  nodes.workspacePromptInspector, 'select-alternative', 'attemptId', 'attempt-blue-detail',
);
assert.equal(focusedAlternative.disabled, false);
assert.match(focusedAlternative.title, /一次性安全通道/u);
assert.equal(focusedAlternative.attributes['aria-pressed'], 'true');
const alternateCandidate = actionNode(
  nodes.workspacePromptInspector,
  'select-alternative',
  'attemptId',
  'attempt-blue-detail-alt',
);
assert.equal(alternateCandidate.attributes['aria-pressed'], 'false');
const keepAlternative = actionNode(
  nodes.workspacePromptInspector, 'keep-attempt', 'attemptId', 'attempt-blue-detail-alt',
);
const rejectAlternative = actionNode(
  nodes.workspacePromptInspector, 'reject-attempt', 'attemptId', 'attempt-blue-detail-alt',
);
assert.ok(keepAlternative);
assert.ok(rejectAlternative);
assert.notEqual(keepAlternative, rejectAlternative);
assert.equal(keepAlternative.disabled, true);
assert.equal(rejectAlternative.disabled, true);
assert.match(keepAlternative.title, /一次性安全通道/u);
assert.match(rejectAlternative.title, /一次性安全通道/u);
assert.ok(descendants(nodes.workspacePromptInspector).some((node) => (
  node.className === 'workspace-alternative-reason'
    && /一次性安全通道/u.test(node.textContent)
)));
alternateCandidate.dispatch('click');
const previewAction = emittedActions.findLast((action) => action.action === 'PREVIEW_ATTEMPT');
assert.equal(previewAction.slotKey, 'blue:detail');
assert.equal(previewAction.attemptId, 'attempt-blue-detail-alt');
dispatchDocument('ss-erp:workspace-preview-state', {
  contractVersion: 'extension-byok-workbench-preview-state/v1',
  slotKey: 'blue:detail',
  attemptId: 'attempt-blue-detail-alt',
  ready: true,
});
assert.equal(keepAlternative.disabled, false);
assert.equal(rejectAlternative.disabled, false);
const intentCountBeforePreviewClicks = emittedIntents.length;
const actionCountBeforePreviewClicks = emittedActions.length;
for (const control of [focusedAlternative, alternateCandidate, keepAlternative, rejectAlternative]) {
  control.dispatch('click', { isTrusted: false });
}
assert.equal(emittedIntents.length, intentCountBeforePreviewClicks,
  'untrusted candidate controls cannot emit review intents');
assert.equal(emittedActions.length, actionCountBeforePreviewClicks,
  'untrusted candidate controls cannot open a preview');
assert.equal(focusedAlternative.attributes['aria-pressed'], 'true');
assert.equal(alternateCandidate.attributes['aria-pressed'], 'false');

const alternativeCountBeforeRegenerate = actionNodes(
  nodes.workspacePromptInspector, 'select-alternative',
).length;
assert.equal(nodes.workspaceChargeAcknowledgement.checked, false);
assert.equal(nodes.workspaceRegenerateButton.disabled, true);
nodes.workspaceChargeAcknowledgement.checked = true;
nodes.workspaceChargeAcknowledgement.dispatch('change');
assert.equal(nodes.workspaceRegenerateButton.disabled, false);
const actionCountBeforeUntrustedRegenerate = emittedIntents.length;
nodes.workspaceRegenerateButton.dispatch('click', { isTrusted: false });
assert.equal(emittedIntents.length, actionCountBeforeUntrustedRegenerate);
nodes.workspaceRegenerateButton.dispatch('click');
assertActionIntent(emittedIntents.at(-1), {
  action: 'REGENERATE_SLOT',
  expectedWorkspaceRevision: 4,
  expectedRuntimeRevision: 3,
  expectedSlotRevision: 30,
  slotKey: 'blue:detail',
  attemptId: null,
  externalChargeAcknowledgement: {
    warningVersion: context.SS_ERP_BYOK_WORKBENCH_WORKSPACE_STATE
      .EXTERNAL_CHARGE_WARNING_VERSION,
    confirmed: true,
  },
});
const regenerateIntent = emittedIntents.at(-1);
assert.equal(
  actionNodes(nodes.workspacePromptInspector, 'select-alternative').length,
  alternativeCountBeforeRegenerate,
  'regeneration emits an intent without fabricating a new runtime attempt');
dispatchDocument('ss-erp:workspace-intent-outcome', intentOutcome(
  regenerateIntent,
  'APPLIED',
  null,
  { binding: binding({ workflowId: 'workflow-other' }) },
));
assert.match(nodes.workspaceRegenerateReason.textContent, /等待.*确认/u,
  'a cross-binding outcome is ignored');
dispatchDocument(
  'ss-erp:workspace-intent-outcome',
  intentOutcome(regenerateIntent, 'APPLIED'),
);
assert.match(nodes.workspaceRegenerateReason.textContent, /等待.*确认/u,
  'APPLIED cannot clear an intent before its state postcondition exists');
nodes.workspacePromptInput.focus();
dispatchDocument('ss-erp:workspace-runtime', {
  contractVersion: 'extension-byok-workbench-workspace-runtime/v1',
  binding: binding(),
  revision: 4,
  task: { schedulerState: 'REVIEW', disabledReason: null },
  libraryItems: [],
  slots: [],
});
assert.match(nodes.workspaceRegenerateReason.textContent, /等待.*确认/u,
  'an unrelated higher runtime revision cannot acknowledge regeneration');
dispatchDocument('ss-erp:workspace-runtime', blueDetailReviewProjection(5, {
  slotRevision: 31,
  additionalLibraryItems: [
    libraryItem('runtime-blue-detail-new', 'GENERATED', { skuKeys: ['blue'] }),
  ],
  additionalAlternatives: [
    alternative('attempt-blue-detail-new', 'CANDIDATE_READY', 'runtime-blue-detail-new'),
  ],
}));
const stableAlternative = actionNode(
  nodes.workspacePromptInspector, 'select-alternative', 'attemptId', 'attempt-blue-detail',
);
assert.equal(stableAlternative, focusedAlternative);
assert.equal(document.activeElement, nodes.workspacePromptInput);

dispatchDocument('ss-erp:workspace-bootstrap', bootstrapInput());
const replayedAlternative = actionNode(
  nodes.workspacePromptInspector, 'select-alternative', 'attemptId', 'attempt-blue-detail',
);
assert.equal(replayedAlternative, stableAlternative);
assert.match(nodes.workspaceTaskSummary.textContent, /5 个候选/u);
assert.equal(
  context.SS_ERP_BYOK_WORKBENCH_WORKSPACE_EVENTS.nextRuntimeRevision(),
  6,
  'the shared clock advances past replayed producer revisions',
);

dispatchDocument('ss-erp:workspace-runtime', {
  contractVersion: 'extension-byok-workbench-workspace-runtime/v1',
  binding: binding(),
  revision: 6,
  task: { schedulerState: 'RUNNING', disabledReason: null },
  libraryItems: [],
  slots: [],
  leaked: true,
});
assert.match(nodes.workspaceTaskSummary.textContent, /运行时任务数据无效/u);
assert.equal(stableAlternative.disabled, true);
assert.equal(nodes.workspaceShell.attributes['data-runtime-state'], 'INVALID');

dispatchDocument('ss-erp:workspace-bootstrap', {
  ...bootstrapInput(),
  leaked: true,
});
assert.equal(nodes.workspaceShell.attributes['aria-disabled'], 'true');
assert.equal(nodes.workspaceSkuList.children.length, 0);
assert.match(nodes.workspaceTaskSummary.textContent, /启动数据无效/u);

dispatchDocument('ss-erp:workspace-clear', null);
assert.equal(nodes.workspaceShell.hidden, true);
assert.equal(nodes.workspaceShell.attributes['aria-busy'], 'true');
assert.equal(nodes.workspacePromptInput.disabled, true);
assert.equal(nodes.workspaceSkuList.children.length, 0);

dispatchDocument('ss-erp:workspace-bootstrap', bootstrapInput());
dispatchDocument('ss-erp:workspace-runtime', {
  contractVersion: 'extension-byok-workbench-workspace-runtime/v1',
  binding: binding(),
  revision: context.SS_ERP_BYOK_WORKBENCH_WORKSPACE_EVENTS.nextRuntimeRevision(),
  task: {
    schedulerState: 'FAILED',
    disabledReason: 'PROVIDER_OUTCOME_RECONCILIATION_REQUIRED',
  },
  libraryItems: [],
  slots: [{
    slotKey: 'red:hero',
    status: 'UNKNOWN_OUTCOME',
    alternatives: [{
      attemptId: 'attempt-unknown',
      state: 'UNKNOWN_OUTCOME',
      mediaId: null,
      errorCode: 'PROVIDER_OUTCOME_UNKNOWN',
    }],
    selectedAttemptId: null,
    slotRevision: 40,
  }],
});
assert.match(nodes.workspaceTaskSummary.textContent, /1 个结果待核对/u);
assert.doesNotMatch(nodes.workspaceTaskSummary.textContent, /^就绪/u);
assert.equal(nodes.workspacePromptInput.disabled, true);
assert.ok(descendants(nodes.workspacePromptInspector).some((node) => (
  node.className === 'workspace-prompt-disabled-reason'
    && /结果待核对/u.test(node.textContent)
)));
nodes.workspaceChargeAcknowledgement.checked = true;
nodes.workspaceChargeAcknowledgement.dispatch('change');
assert.equal(nodes.workspaceRegenerateButton.disabled, true);
assert.match(nodes.workspaceRegenerateButton.title, /结果待核对/u);
const unknownActionCount = emittedIntents.length;
nodes.workspaceRegenerateButton.dispatch('click');
assert.equal(emittedIntents.length, unknownActionCount,
  'UNKNOWN_OUTCOME cannot use ordinary regeneration');
assert.match(nodes.workspacePublishSummary.textContent, /结果待核对/u);
dispatchDocument('ss-erp:workspace-clear', null);

const scopedRedSku = sku('red');
scopedRedSku.slots[1] = slot('red:detail', 'DETAIL', {
  assignmentScope: 'PRODUCT',
  applicableSkuKeys: ['blue', 'red'],
});
dispatchDocument('ss-erp:workspace-bootstrap', bootstrapInput({
  executionMode: 'ERP_HOSTED',
  availableExecutionModes: ['ERP_HOSTED', 'BYOK'],
  selectedSkuKey: 'red',
  selectedSlotKey: 'red:detail',
  skus: [scopedRedSku, sku('blue'), sku('green')],
}));
const sharedProductSlot = actionNode(
  nodes.workspaceSlotList, 'select-slot', 'slotKey', 'red:detail',
);
assert.match(sharedProductSlot.children[1].textContent, /商品共享.*SKU blue, red/u);
assert.match(sharedProductSlot.children[1].textContent, /不支持部分 SKU 共享/u);
assert.match(sharedProductSlot.title, /商品共享.*SKU blue, red/u);
dispatchDocument('ss-erp:workspace-clear', null);

dispatchDocument('ss-erp:workspace-bootstrap', bootstrapInput({
  executionMode: 'ERP_HOSTED',
  availableExecutionModes: ['ERP_HOSTED', 'BYOK'],
}));
const connectedHostedMode = actionNode(
  nodes.workspaceModeSummary, 'select-mode', 'executionMode', 'ERP_HOSTED',
);
const connectedByokMode = actionNode(
  nodes.workspaceModeSummary, 'select-mode', 'executionMode', 'BYOK',
);
assert.equal(connectedHostedMode.disabled, false);
assert.equal(connectedByokMode.disabled, false);
assert.match(nodes.workspaceChargeAcknowledgementLabel.textContent, /ERP.*最高追加费用/u);
dispatchDocument('ss-erp:workspace-clear', null);

dispatchDocument('ss-erp:workspace-bootstrap', bootstrapInput({ dispatched: true }));
const hostedMode = actionNode(
  nodes.workspaceModeSummary, 'select-mode', 'executionMode', 'ERP_HOSTED',
);
const byokMode = actionNode(
  nodes.workspaceModeSummary, 'select-mode', 'executionMode', 'BYOK',
);
assert.equal(hostedMode.disabled, true);
assert.match(hostedMode.title, /托管执行尚未接入/u);
assert.equal(byokMode.disabled, true);
assert.match(nodes.workspaceModeSummary.children.at(-1).textContent, /执行方式已冻结/u);
assert.equal(nodes.workspacePromptInput.disabled, true);
const lockedGlobalReference = actionNode(
  nodes.workspaceLibraryList, 'toggle-global-reference', 'mediaId', 'captured-main',
);
const lockedSlotReference = actionNode(
  nodes.workspaceLibraryList, 'toggle-slot-reference', 'mediaId', 'captured-main',
);
assert.equal(lockedGlobalReference.disabled, true);
assert.match(lockedGlobalReference.title, /全局参考图已冻结/u);
assert.equal(lockedSlotReference.disabled, true);
assert.match(lockedSlotReference.title, /当前槽位已开始执行/u);
const lockedPrompt = nodes.workspacePromptInput.value;
const lockedActionCount = emittedActions.filter((action) => action.action === 'SAVE_PROMPT').length;
nodes.workspacePromptInput.value = 'Must not save after dispatch';
nodes.workspacePromptInput.dispatch('input');
nodes.workspaceSavePromptButton.dispatch('click');
assert.equal(
  emittedActions.filter((action) => action.action === 'SAVE_PROMPT').length,
  lockedActionCount,
);
dispatchDocument('ss-erp:workspace-bootstrap', bootstrapInput({ dispatched: true }));
assert.equal(nodes.workspacePromptInput.value, lockedPrompt);

dispatchDocument('ss-erp:workspace-clear', null);
dispatchDocument('ss-erp:workspace-bootstrap', bootstrapInput());
assert.match(nodes.workspaceTaskSummary.textContent, /批量任务协调器尚未接入/u);
assert.equal(nodes.workspacePauseButton.disabled, true);
assert.match(nodes.workspacePauseButton.title, /批量任务协调器尚未接入/u);
assert.equal(nodes.workspaceContinueButton.disabled, true);
assert.equal(actionNodes(nodes.workspaceQueuedAttempts, 'cancel-queued').length, 0);
assert.match(nodes.workspacePublishSummary.textContent, /发布协调器尚未接入/u);
assert.match(nodes.workspacePublishSummary.textContent, /草稿状态.*待确认/u);

const runningRevision = context.SS_ERP_BYOK_WORKBENCH_WORKSPACE_EVENTS.nextRuntimeRevision();
dispatchDocument('ss-erp:workspace-runtime', activeTaskProjection(runningRevision, 'RUNNING'));
assert.match(nodes.workspaceTaskSummary.textContent, /1 个处理中/u);
assert.match(nodes.workspaceTaskSummary.textContent, /1 个排队/u);
assert.match(nodes.workspaceTaskProgress.textContent, /0\s*\/\s*4/u);
assert.equal(nodes.workspaceTaskProgress.attributes['aria-valuenow'], '0');
assert.equal(nodes.workspaceTaskProgress.attributes['aria-valuemax'], '4');
assert.equal(nodes.workspacePauseButton.disabled, false);
assert.equal(nodes.workspaceContinueButton.disabled, true);
const queuedCancel = actionNode(
  nodes.workspaceQueuedAttempts, 'cancel-queued', 'attemptId', 'attempt-task-queued',
);
assert.ok(queuedCancel);
assert.equal(queuedCancel.disabled, false);
assert.equal(actionNode(
  nodes.workspaceQueuedAttempts, 'cancel-queued', 'attemptId', 'attempt-task-active',
), undefined, 'only QUEUED attempts expose cancellation');

const actionCountBeforeUntrustedPause = emittedIntents.length;
nodes.workspacePauseButton.dispatch('click', { isTrusted: false });
assert.equal(emittedIntents.length, actionCountBeforeUntrustedPause);
const workingRandomUUID = context.crypto.randomUUID;
delete context.crypto.randomUUID;
nodes.workspacePauseButton.dispatch('click');
assert.equal(emittedIntents.length, actionCountBeforeUntrustedPause);
assert.match(nodes.workspaceTaskSummary.textContent, /无法创建安全的操作标识/u);
context.crypto.randomUUID = () => 'not-a-random-uuid';
nodes.workspacePauseButton.dispatch('click');
assert.equal(emittedIntents.length, actionCountBeforeUntrustedPause);
assert.match(nodes.workspaceTaskSummary.textContent, /无法创建安全的操作标识/u);
context.crypto.randomUUID = workingRandomUUID;
nodes.workspacePauseButton.focus();
nodes.workspacePauseButton.dispatch('click');
assertActionIntent(emittedIntents.at(-1), {
  action: 'PAUSE_AFTER_CURRENT',
  expectedWorkspaceRevision: 2,
  expectedRuntimeRevision: runningRevision,
  slotKey: null,
  attemptId: null,
});
assert.equal(nodes.workspacePauseButton.disabled, true);
assert.equal(document.activeElement, nodes.workspacePauseButton,
  'the trusted click keeps focus on the pending control until acknowledgement');
assert.match(nodes.workspacePauseButton.title, /等待.*确认/u);
const intentCountWhilePausePending = emittedIntents.length;
queuedCancel.dispatch('click');
assert.equal(emittedIntents.length, intentCountWhilePausePending);
assert.ok(actionNode(
  nodes.workspaceQueuedAttempts, 'cancel-queued', 'attemptId', 'attempt-task-queued',
), 'pending pause leaves authoritative queued state unchanged');

const pausingRevision = context.SS_ERP_BYOK_WORKBENCH_WORKSPACE_EVENTS.nextRuntimeRevision();
dispatchDocument('ss-erp:workspace-runtime', activeTaskProjection(pausingRevision, 'PAUSING'));
assert.equal(nodes.workspacePauseButton.disabled, true);
assert.match(nodes.workspacePauseButton.title, /当前任务完成后暂停/u);
assert.equal(nodes.workspaceContinueButton.disabled, false);
assert.equal(document.activeElement, nodes.workspaceContinueButton,
  'acknowledgement moves focus away from the now-disabled pause control');
queuedCancel.dispatch('click');
assertActionIntent(emittedIntents.at(-1), {
  action: 'CANCEL_QUEUED',
  expectedWorkspaceRevision: 3,
  expectedRuntimeRevision: pausingRevision,
  expectedSlotRevision: 20,
  slotKey: 'red:detail',
  attemptId: 'attempt-task-queued',
});
const firstCancelIntent = emittedIntents.at(-1);
dispatchDocument('ss-erp:workspace-intent-outcome', {
  ...intentOutcome(firstCancelIntent, 'REJECTED', 'ACTION_REJECTED_BY_COORDINATOR'),
  extra: true,
});
assert.equal(queuedCancel.disabled, true,
  'an outcome with extra fields is ignored');
dispatchDocument('ss-erp:workspace-intent-outcome', intentOutcome(
  firstCancelIntent,
  'REJECTED',
  'ACTION_REJECTED_BY_COORDINATOR',
  { expectedRuntimeRevision: firstCancelIntent.expectedRuntimeRevision + 1 },
));
assert.equal(queuedCancel.disabled, true,
  'an outcome with mismatched intent identity is ignored');
dispatchDocument(
  'ss-erp:workspace-intent-outcome',
  intentOutcome(firstCancelIntent, 'APPLIED'),
);
assert.equal(queuedCancel.disabled, true,
  'APPLIED waits for the queued-attempt postcondition');
document.activeElement = null;
dispatchDocument(
  'ss-erp:workspace-intent-outcome',
  intentOutcome(firstCancelIntent, 'REJECTED', 'ACTION_REJECTED_BY_COORDINATOR'),
);
assert.equal(queuedCancel.disabled, false);
assert.equal(document.activeElement, queuedCancel);
assert.match(nodes.workspaceTaskSummary.textContent,
  /操作被拒绝.*ACTION_REJECTED_BY_COORDINATOR/u);
queuedCancel.dispatch('click');
assertActionIntent(emittedIntents.at(-1), {
  action: 'CANCEL_QUEUED',
  expectedWorkspaceRevision: 3,
  expectedRuntimeRevision: pausingRevision,
  expectedSlotRevision: 20,
  slotKey: 'red:detail',
  attemptId: 'attempt-task-queued',
});
const secondCancelIntent = emittedIntents.at(-1);
assert.notEqual(secondCancelIntent.commandId, firstCancelIntent.commandId);
dispatchDocument(
  'ss-erp:workspace-intent-outcome',
  intentOutcome(firstCancelIntent, 'REJECTED', 'ACTION_REJECTED_BY_COORDINATOR'),
);
assert.equal(queuedCancel.disabled, true,
  'a delayed outcome for an earlier command cannot clear the retry');
const intentCountWhileCancelPending = emittedIntents.length;
nodes.workspaceContinueButton.dispatch('click');
assert.equal(emittedIntents.length, intentCountWhileCancelPending);
const cancelUnrelatedRevision = context.SS_ERP_BYOK_WORKBENCH_WORKSPACE_EVENTS
  .nextRuntimeRevision();
dispatchDocument(
  'ss-erp:workspace-runtime',
  activeTaskProjection(cancelUnrelatedRevision, 'PAUSING', {
    queuedSlotRevision: 20,
  }),
);
nodes.workspaceContinueButton.dispatch('click');
assert.equal(emittedIntents.length, intentCountWhileCancelPending,
  'a higher global revision with the same queued slot revision cannot acknowledge cancel');
const cancelAcknowledgedRevision = context.SS_ERP_BYOK_WORKBENCH_WORKSPACE_EVENTS
  .nextRuntimeRevision();
dispatchDocument(
  'ss-erp:workspace-runtime',
  activeTaskProjection(cancelAcknowledgedRevision, 'PAUSING', {
    queuedState: 'CANCELLED',
    queuedSlotRevision: 21,
  }),
);
nodes.workspaceContinueButton.dispatch('click');
assertActionIntent(emittedIntents.at(-1), {
  action: 'CONTINUE',
  expectedWorkspaceRevision: 5,
  expectedRuntimeRevision: cancelAcknowledgedRevision,
  slotKey: null,
  attemptId: null,
});
assert.equal(nodes.workspaceContinueButton.disabled, true,
  'continue intent is fenced while awaiting an authoritative scheduler projection');

dispatchDocument('ss-erp:workspace-clear', null);
const publishBootstrap = bootstrapInput();
const publishFixtureWorkspace = context.SS_ERP_BYOK_WORKBENCH_WORKSPACE_STATE
  .createWorkspace(plain(publishBootstrap));
dispatchDocument('ss-erp:workspace-bootstrap', publishBootstrap);
const publishRuntimeRevision = context.SS_ERP_BYOK_WORKBENCH_WORKSPACE_EVENTS
  .nextRuntimeRevision();
const publishRuntime = {
  contractVersion: 'extension-byok-workbench-workspace-runtime/v1',
  binding: binding(),
  revision: publishRuntimeRevision,
  task: { schedulerState: 'FAILED', disabledReason: null },
  libraryItems: [libraryItem('publish-red-bound', 'GENERATED', { skuKeys: ['red'] })],
  slots: [
    {
      slotKey: 'red:hero',
      status: 'BOUND',
      alternatives: [alternative('attempt-publish-bound', 'BOUND', 'publish-red-bound')],
      selectedAttemptId: 'attempt-publish-bound',
      slotRevision: 50,
    },
    {
      slotKey: 'blue:hero',
      status: 'UNKNOWN_OUTCOME',
      alternatives: [alternative('attempt-publish-unknown', 'UNKNOWN_OUTCOME', null)],
      selectedAttemptId: null,
      slotRevision: 51,
    },
    {
      slotKey: 'blue:detail',
      status: 'EXPIRED',
      alternatives: [alternative('attempt-publish-expired', 'EXPIRED', null)],
      selectedAttemptId: null,
      slotRevision: 52,
    },
  ],
};
dispatchDocument('ss-erp:workspace-runtime', publishRuntime);
publishFixtureWorkspace.applyRuntimeProjection(plain(publishRuntime));
const invalidPublishProjection = {
  ...publishProjection(publishFixtureWorkspace, 1, { draftState: 'STALE' }),
  leaked: true,
};
dispatchDocument('ss-erp:workspace-publish-projection', invalidPublishProjection);
assert.match(nodes.workspacePublishSummary.textContent, /发布核对数据无效/u);
assert.equal(nodes.workspaceShell.attributes['data-runtime-state'], 'READY',
  'a publish projection fault does not invalidate runtime controls');
dispatchDocument('ss-erp:workspace-publish-projection', {
  ...publishProjection(publishFixtureWorkspace, 99, { draftState: 'STALE' }),
  binding: binding({ shopId: 'shop-other' }),
});
assert.match(nodes.workspacePublishSummary.textContent, /发布核对数据无效/u,
  'a cross-binding publish projection is ignored without clearing or replacing local fault state');
const publishRefreshRevision = context.SS_ERP_BYOK_WORKBENCH_WORKSPACE_EVENTS
  .nextRuntimeRevision();
const publishRefreshRuntime = {
  contractVersion: 'extension-byok-workbench-workspace-runtime/v1',
  binding: binding(),
  revision: publishRefreshRevision,
  task: { schedulerState: 'FAILED', disabledReason: null },
  libraryItems: [],
  slots: [],
};
dispatchDocument('ss-erp:workspace-runtime', publishRefreshRuntime);
publishFixtureWorkspace.applyRuntimeProjection(plain(publishRefreshRuntime));
assert.match(nodes.workspacePublishSummary.textContent, /发布核对数据无效/u,
  'a valid runtime projection cannot clear an independent publish fault');
const currentPublishProjection = publishProjection(publishFixtureWorkspace, 1, {
  draftState: 'STALE',
});
dispatchDocument('ss-erp:workspace-publish-projection', currentPublishProjection);
publishFixtureWorkspace.applyPublishProjection(plain(currentPublishProjection));
assert.equal(nodes.workspacePublishSummary.attributes['data-eligible'], 'false');
assert.match(nodes.workspacePublishSummary.textContent, /1\s*\/\s*4/u);
assert.match(nodes.workspacePublishSummary.textContent, /草稿.*(?:变化|过期|失效)/u);
assert.match(nodes.workspacePublishSummary.textContent, /1 个槽位待补齐/u);
assert.match(nodes.workspacePublishSummary.textContent, /1 个结果待核对/u);
assert.match(nodes.workspacePublishSummary.textContent, /1 个结果已过期/u);

const publishSummaryBeforeForeignEvents = nodes.workspacePublishSummary.textContent;
dispatchDocument('ss-erp:workspace-runtime', {
  contractVersion: 'extension-byok-workbench-workspace-runtime/v1',
  binding: binding({ workflowId: 'workflow-other' }),
  revision: 9000,
  task: { schedulerState: 'RUNNING', disabledReason: null },
  libraryItems: [],
  slots: [],
  leaked: true,
});
assert.equal(nodes.workspaceShell.attributes['data-runtime-state'], 'READY');
assert.equal(nodes.workspacePublishSummary.textContent, publishSummaryBeforeForeignEvents);
dispatchDocument('ss-erp:workspace-publish-projection', {
  ...publishProjection(publishFixtureWorkspace, 2, { draftState: 'CURRENT' }),
  binding: binding({ draftRevision: defaultBinding.draftRevision + 1 }),
  leaked: true,
});
assert.equal(nodes.workspacePublishSummary.textContent, publishSummaryBeforeForeignEvents,
  'cross-binding runtime and publish events cannot pollute the active workspace');

const invalidRuntimeRevision = context.SS_ERP_BYOK_WORKBENCH_WORKSPACE_EVENTS
  .nextRuntimeRevision();
assert.ok(invalidRuntimeRevision < 9000,
  'a foreign runtime revision cannot advance the active binding clock');
dispatchDocument('ss-erp:workspace-runtime', {
  contractVersion: 'extension-byok-workbench-workspace-runtime/v1',
  binding: binding(),
  revision: invalidRuntimeRevision,
  task: { schedulerState: 'FAILED', disabledReason: null },
  libraryItems: [],
  slots: [],
  leaked: true,
});
assert.equal(nodes.workspaceShell.attributes['data-runtime-state'], 'INVALID');
const secondPublishProjection = publishProjection(publishFixtureWorkspace, 2, {
  draftState: 'STALE',
});
dispatchDocument('ss-erp:workspace-publish-projection', secondPublishProjection);
publishFixtureWorkspace.applyPublishProjection(plain(secondPublishProjection));
assert.doesNotMatch(nodes.workspacePublishSummary.textContent, /发布核对数据无效/u);
assert.equal(nodes.workspaceShell.attributes['data-runtime-state'], 'INVALID',
  'a valid publish projection cannot clear an independent runtime fault');

dispatchDocument('ss-erp:workspace-clear', null);
const orderedBootstrap = bootstrapInput({ skus: [sku('red')] });
const orderedFixtureWorkspace = context.SS_ERP_BYOK_WORKBENCH_WORKSPACE_STATE
  .createWorkspace(plain(orderedBootstrap));
dispatchDocument('ss-erp:workspace-bootstrap', orderedBootstrap);
const orderedRuntime = {
  contractVersion: 'extension-byok-workbench-workspace-runtime/v1',
  binding: binding(),
  revision: context.SS_ERP_BYOK_WORKBENCH_WORKSPACE_EVENTS.nextRuntimeRevision(),
  task: { schedulerState: 'REVIEW', disabledReason: null },
  libraryItems: [
    libraryItem('ordered-red-hero', 'GENERATED', { skuKeys: ['red'] }),
    libraryItem('ordered-red-detail', 'GENERATED', { skuKeys: ['red'] }),
  ],
  slots: [
    {
      slotKey: 'red:hero',
      status: 'BOUND',
      alternatives: [alternative('attempt-ordered-hero', 'BOUND', 'ordered-red-hero')],
      selectedAttemptId: 'attempt-ordered-hero',
      slotRevision: 61,
    },
    {
      slotKey: 'red:detail',
      status: 'BOUND',
      alternatives: [alternative('attempt-ordered-detail', 'BOUND', 'ordered-red-detail')],
      selectedAttemptId: 'attempt-ordered-detail',
      slotRevision: 62,
    },
  ],
};
dispatchDocument('ss-erp:workspace-runtime', orderedRuntime);
orderedFixtureWorkspace.applyRuntimeProjection(plain(orderedRuntime));
const orderedPublishProjection = publishProjection(orderedFixtureWorkspace, 1);
dispatchDocument('ss-erp:workspace-publish-projection', orderedPublishProjection);
orderedFixtureWorkspace.applyPublishProjection(plain(orderedPublishProjection));
assert.match(nodes.workspacePublishSummary.textContent, /已核对顺序/u);
const staleOrderMove = actionNode(
  nodes.workspaceSlotList, 'move-slot-down', 'slotKey', 'red:hero',
);
assert.equal(staleOrderMove.disabled, false);
staleOrderMove.dispatch('click');
orderedFixtureWorkspace.moveSelectedSlotDown();
assert.doesNotMatch(nodes.workspacePublishSummary.textContent, /已核对顺序/u);
assert.match(nodes.workspacePublishSummary.textContent, /当前顺序.*待重新核对/u,
  'a stale publish basis cannot label the newly edited order as verified');

dispatchDocument('ss-erp:workspace-clear', null);
dispatchDocument('ss-erp:workspace-runtime', {
  contractVersion: 'extension-byok-workbench-workspace-runtime/v1',
  binding: binding({ workflowId: 'workflow-retained-other' }),
  revision: 9100,
  task: { schedulerState: 'REVIEW', disabledReason: null },
  libraryItems: [libraryItem('foreign-retained', 'GENERATED', { skuKeys: ['red'] })],
  slots: [{
    slotKey: 'red:hero',
    status: 'CANDIDATE_READY',
    alternatives: [alternative(
      'attempt-foreign-retained', 'CANDIDATE_READY', 'foreign-retained',
    )],
    selectedAttemptId: 'attempt-foreign-retained',
    slotRevision: 91,
  }],
});
dispatchDocument('ss-erp:workspace-bootstrap', bootstrapInput());
assert.equal(actionNode(
  nodes.workspacePromptInspector,
  'select-alternative',
  'attemptId',
  'attempt-foreign-retained',
), undefined, 'bootstrap replays retained runtime only for its exact binding');
assert.equal(nodes.workspaceShell.attributes['data-runtime-state'], 'READY');
assert.ok(context.SS_ERP_BYOK_WORKBENCH_WORKSPACE_EVENTS.nextRuntimeRevision() < 9100,
  'discarded retained runtime cannot pollute the active binding clock');

console.log('Extension BYOK workspace UI tests passed');
