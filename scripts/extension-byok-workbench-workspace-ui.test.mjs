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
assert.match(cssSource, /@media\s*\(max-width:\s*1120px\)/u);
assert.match(cssSource, /\.workspace-task-dock\s*\{[\s\S]*grid-column:\s*3;/u);
assert.match(cssSource, /@media\s*\(max-width:\s*720px\)[\s\S]*\.workspace-task-dock\s*\{[\s\S]*position:\s*static;/u);
assert.match(cssSource, /@media\s*\(max-width:\s*900px\)[\s\S]*\.workspace-board\s*\{\s*grid-template-columns:\s*repeat\(2,/u);
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
  'workspaceTaskDock', 'workspaceTaskSummary', 'workspaceModeSummary',
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
};
const nodes = Object.fromEntries(ids.map((id) => [id, new FakeNode(id, nodeTags[id] || 'div')]));
const documentListeners = new Map();
const emittedActions = [];
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
    for (const listener of documentListeners.get(event.type) || []) listener(event);
    return true;
  },
};
activeDocument = document;

const context = {
  Array, Boolean, Error, JSON, Map, Math, Number, Object, RegExp, Set, String, TypeError,
  CustomEvent: FakeCustomEvent,
  document,
};
context.globalThis = context;
vm.runInNewContext(fs.readFileSync(contractPath, 'utf8'), context, { filename: contractPath });
vm.runInNewContext(fs.readFileSync(statePath, 'utf8'), context, { filename: statePath });
vm.runInNewContext(controllerSource, context, { filename: controllerPath });

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

assert.equal(nodes.workspaceShell.hidden, true);
assert.equal(nodes.workspaceShell.attributes['aria-busy'], 'true');
dispatchDocument('ss-erp:workspace-runtime', {
  contractVersion: 'extension-byok-workbench-workspace-runtime/v1',
  revision: 1,
  task: { schedulerState: 'REVIEW', disabledReason: null },
  libraryItems: [libraryItem('pending-old', 'GENERATED', { skuKeys: ['red'] })],
  slots: [{
    slotKey: 'red:hero',
    status: 'CANDIDATE_READY',
    alternatives: [alternative('attempt-pending-old', 'CANDIDATE_READY', 'pending-old')],
    selectedAttemptId: 'attempt-pending-old',
  }],
});
dispatchDocument('ss-erp:workspace-runtime', {
  contractVersion: 'extension-byok-workbench-workspace-runtime/v1',
  revision: 2,
  task: { schedulerState: 'REVIEW', disabledReason: null },
  libraryItems: [libraryItem('pending-new', 'GENERATED', { skuKeys: ['red'] })],
  slots: [{
    slotKey: 'red:detail',
    status: 'CANDIDATE_READY',
    alternatives: [alternative('attempt-pending-new', 'CANDIDATE_READY', 'pending-new')],
    selectedAttemptId: 'attempt-pending-new',
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
assert.equal(moveUp.disabled, true, 'ordering remains unavailable until UI-05');
assert.match(moveUp.title, /审核排序阶段/u);

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

dispatchDocument('ss-erp:workspace-runtime', {
  contractVersion: 'extension-byok-workbench-workspace-runtime/v1',
  revision: 3,
  task: { schedulerState: 'REVIEW', disabledReason: null },
  libraryItems: [libraryItem('runtime-blue-detail', 'GENERATED', { skuKeys: ['blue'] })],
  slots: [{
    slotKey: 'blue:detail',
    status: 'CANDIDATE_READY',
    alternatives: [alternative('attempt-blue-detail', 'CANDIDATE_READY', 'runtime-blue-detail')],
    selectedAttemptId: 'attempt-blue-detail',
  }],
});
const focusedAlternative = actionNode(
  nodes.workspacePromptInspector, 'select-alternative', 'attemptId', 'attempt-blue-detail',
);
assert.equal(focusedAlternative.disabled, true);
assert.match(focusedAlternative.title, /候选选择将在统一审核阶段接通/u);
const alternativeActionCount = emittedActions.filter(
  (action) => action.action === 'SELECT_ALTERNATIVE',
).length;
focusedAlternative.dispatch('click');
assert.equal(emittedActions.filter(
  (action) => action.action === 'SELECT_ALTERNATIVE',
).length, alternativeActionCount);
nodes.workspacePromptInput.focus();
dispatchDocument('ss-erp:workspace-runtime', {
  contractVersion: 'extension-byok-workbench-workspace-runtime/v1',
  revision: 4,
  task: { schedulerState: 'REVIEW', disabledReason: null },
  libraryItems: [],
  slots: [{
    slotKey: 'blue:detail',
    status: 'CANDIDATE_READY',
    alternatives: [alternative('attempt-blue-detail', 'CANDIDATE_READY', 'runtime-blue-detail')],
    selectedAttemptId: 'attempt-blue-detail',
  }],
});
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
assert.match(nodes.workspaceTaskSummary.textContent, /3 个候选/u);
assert.equal(
  context.SS_ERP_BYOK_WORKBENCH_WORKSPACE_EVENTS.nextRuntimeRevision(),
  5,
  'the shared clock advances past replayed producer revisions',
);

dispatchDocument('ss-erp:workspace-runtime', {
  contractVersion: 'extension-byok-workbench-workspace-runtime/v1',
  revision: 5,
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
  }],
});
assert.match(nodes.workspaceTaskSummary.textContent, /1 个结果待核对/u);
assert.doesNotMatch(nodes.workspaceTaskSummary.textContent, /^就绪/u);
assert.equal(nodes.workspacePromptInput.disabled, true);
assert.ok(descendants(nodes.workspacePromptInspector).some((node) => (
  node.className === 'workspace-prompt-disabled-reason'
    && /结果待核对/u.test(node.textContent)
)));
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

console.log('Extension BYOK workspace UI tests passed');
