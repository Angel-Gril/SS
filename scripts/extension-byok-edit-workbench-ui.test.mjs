import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = 'extensions/ss-erp';
const html = readFileSync(`${root}/pages/ai-image-workbench.html`, 'utf8');
const css = readFileSync(`${root}/pages/ai-image-workbench.css`, 'utf8');
const source = readFileSync(`${root}/pages/ai-image-workbench-edit.js`, 'utf8');

for (const id of [
  'operationSwitch', 'operationImageToImage', 'operationFullEdit', 'operationInpaint',
  'referenceScopeGlobal', 'referenceScopeSlot', 'referenceFiles', 'sourceFile',
  'editMaskCanvas', 'maskPaintButton', 'maskEraseButton', 'maskUndoButton',
  'maskRedoButton', 'editAlternatives', 'regenerateChargeConfirmation',
  'regenerateEditButton', 'restartRecovery', 'restartChargeConfirmation',
  'restartAcknowledgeButton',
]) {
  assert.match(html, new RegExp(`id=["']${id}["']`, 'u'));
}
assert.match(html, /image-mask-core\.js[\s\S]*image-mask-layout\.js[\s\S]*image-mask-canvas\.js/u);
assert.match(html, /ai-image-workbench-edit\.js/u);
assert.match(html, /当前槽位存在参考图时会覆盖本次会话/u);
assert.match(html, /外部 Provider 再次扣费/u);
assert.match(css, /\.operation-switch/u);
assert.match(css, /\.source-stage canvas[\s\S]*touch-action:\s*none/u);
assert.match(css, /\.alternative-button\.is-selected/u);
assert.match(css, /\.edit-selected-media\s*\{[\s\S]*aspect-ratio:\s*1/u);
assert.match(css, /\.alternative-button img\s*\{[\s\S]*display:\s*block/u);
assert.match(css, /input:focus-visible[\s\S]*canvas:focus-visible/u);
assert.match(css, /--focus:\s*rgb\(15 118 110 \/ 24%\)/u);
assert.match(css, /\.button-primary:hover:not\(:disabled\)\s*\{[\s\S]*background:\s*var\(--brand\)/u);
assert.match(css, /#editResultNotice\.is-error/u);
assert.match(html, /id="editMaskCanvas"[\s\S]*tabindex="0"/u);
assert.match(html, /class="mask-toolbar" role="group"/u);
assert.doesNotMatch(html, /class="mask-toolbar" role="toolbar"/u);
assert.match(html, /id="editResultStatus"[\s\S]*aria-live="polite"/u);
assert.match(css, /@media\s*\(max-width:\s*520px\)/u);
assert.doesNotMatch(source, /innerHTML|localStorage|storage\.local|storage\.sync|data:image|readAsDataURL/u);
assert.match(source, /event\.isTrusted\s*!==\s*true/u);
assert.match(source, /effectiveReferences/u);
assert.match(source, /state\.references\.SLOT\.length\s*\?/u);
assert.match(source, /maskCanvasApi\.sourcePoint/u);
assert.match(source, /maskCanvasApi\.exportPng/u);
assert.match(source, /selectEditAlternative/u);
assert.match(source, /warningVersion:\s*'external-provider-charge\/v1'/u);
assert.match(source, /state\s*===\s*'EXPIRED'/u);
assert.match(source, /var lifecycleEpoch = state\.lifecycleEpoch;[\s\S]*client\.getEditState\(\)/u);
assert.match(source, /client\.startEdit\([\s\S]*state\.lifecycleEpoch !== lifecycleEpoch/u);
assert.match(source, /client\.selectEditAlternative\([\s\S]*state\.lifecycleEpoch !== lifecycleEpoch/u);
assert.match(source, /client\.regenerateEdit\([\s\S]*state\.lifecycleEpoch !== lifecycleEpoch/u);
assert.match(
  source,
  /uploadEditMedia\('REFERENCE', file\);[\s\S]{0,400}lifecycleIsCurrent\(lifecycleEpoch\)/u,
  'REFERENCE uploads must fence late lifecycle results before creating public page state',
);
assert.match(
  source,
  /ensureMaskHandle\(lifecycleEpoch\)[\s\S]*uploadEditMedia\('MASK', exported\.blob\);[\s\S]{0,400}releaseUploadedMedia\(uploaded, 'MASK'\)/u,
  'MASK uploads must release a handle that arrives after lifecycle invalidation',
);
assert.match(
  source,
  /sendReferenceTarget\(scope, items, lifecycleEpoch\)[\s\S]*setEditReferences\(input\);[\s\S]{0,300}assertLifecycleCurrent\(lifecycleEpoch\)/u,
  'reference transactions must validate lifecycle after background acknowledgement',
);

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

class FakeNode {
  constructor(id, tagName = 'div') {
    this.id = id;
    this.tagName = tagName.toUpperCase();
    this.textContent = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.files = [];
    this.children = [];
    this.listeners = new Map();
    this.attributes = {};
    this.classList = new FakeClassList();
    this.style = {};
    this.src = '';
    this.width = 100;
    this.height = 100;
    this.capturedPointerId = null;
  }
  addEventListener(type, listener) {
    const values = this.listeners.get(type) || [];
    values.push(listener);
    this.listeners.set(type, values);
  }
  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) {
      listener({ target: this, isTrusted: true, ...event });
    }
  }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  removeAttribute(name) { delete this.attributes[name]; if (name === 'src') this.src = ''; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; }
  getContext() {
    return {
      save() {}, restore() {}, beginPath() {}, arc() {}, fill() {}, stroke() {},
      moveTo() {}, lineTo() {}, clearRect() {}, fillRect() {}, getImageData() {
        return { data: new Uint8ClampedArray(100 * 100 * 4) };
      },
    };
  }
  setPointerCapture(id) { this.capturedPointerId = id; }
  hasPointerCapture(id) { return this.capturedPointerId === id; }
  releasePointerCapture(id) { if (this.capturedPointerId === id) this.capturedPointerId = null; }
  focus() { this.focused = true; }
}

const ids = [
  'generationTitle', 'profileSelect', 'promptInput', 'negativePromptInput', 'sizeSelect',
  'generateButton', 'runEditButton', 'editInputPanel', 'operationReason',
  'restartRecovery', 'restartChargeConfirmation', 'restartAcknowledgeButton',
  'operationTextToImage', 'operationImageToImage', 'operationFullEdit', 'operationInpaint',
  'referenceInputGroup', 'sourceInputGroup', 'referenceScopeGlobal', 'referenceScopeSlot',
  'referenceFiles', 'referenceList', 'editMediaCount', 'sourceFile', 'sourceStage',
  'editSourceImage', 'sourceMeta', 'editMaskCanvas', 'maskTools', 'maskPaintButton',
  'maskEraseButton', 'maskBrushSize', 'maskBrushValue', 'maskUndoButton', 'maskRedoButton',
  'maskClearButton', 'maskEditPixels', 'maskPreservedPixels', 'editResultPanel',
  'editResultStatus', 'editSelectedPreview', 'editSelectedImage', 'editSelectedMeta',
  'editAlternatives', 'editResultNotice', 'regenerateConfirmationRow',
  'regenerateChargeConfirmation', 'regenerateEditButton', 'refreshButton',
];
const nodes = Object.fromEntries(ids.map((id) => [id, new FakeNode(id,
  id.startsWith('operation') || id.startsWith('referenceScope')
    || id === 'regenerateChargeConfirmation' || id === 'restartChargeConfirmation' ? 'input'
      : id.endsWith('Button') ? 'button'
        : id === 'profileSelect' || id === 'sizeSelect' ? 'select'
          : id === 'promptInput' || id === 'negativePromptInput' ? 'textarea'
            : id.includes('Canvas') ? 'canvas' : id.includes('Image') ? 'img' : 'div')],
));
nodes.profileSelect.value = 'profile-1';
nodes.promptInput.value = 'Preserve the exact product and improve the catalog composition';
nodes.sizeSelect.value = '1024x1024';
nodes.operationTextToImage.checked = true;
nodes.operationTextToImage.value = 'TEXT_TO_IMAGE';
nodes.operationImageToImage.value = 'IMAGE_TO_IMAGE';
nodes.operationFullEdit.value = 'FULL_EDIT';
nodes.operationInpaint.value = 'INPAINT';
nodes.referenceScopeGlobal.checked = true;
nodes.maskBrushSize.value = '24';

const optionNodes = Object.fromEntries([
  'TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT',
].map((operation) => [operation, new FakeNode(`option-${operation}`, 'label')]));
const reasonNodes = Object.fromEntries(Object.keys(optionNodes)
  .map((operation) => [operation, new FakeNode(`reason-${operation}`, 'small')]));
const body = new FakeNode('body', 'body');
body.dataset = {};
let objectUrlCounter = 0;
const revokedUrls = [];
const createdUrls = [];
const calls = [];
let mediaCounter = 0;
const referenceOutcomes = [];
const deferredUploads = new Map();
let nextEditStateError = null;
let deferredEditState = null;
let deferredStartEdit = null;
let nextStartEditError = null;
let nextStartEditSnapshot = null;
const editStateOutcomes = [];

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  return { promise, resolve, reject };
}

function clientFailure(code) {
  return Object.assign(new Error(code), { code });
}

const profileRow = {
  profile: {
    id: 'profile-1', name: 'Relay', baseUrl: 'https://relay.example/v1',
    model: 'edit-model-v1',
    allowedOperations: ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'],
    preferences: {},
  },
  hasKey: true,
  permissionState: 'GRANTED',
  textToImageEvidence: {
    operation: 'TEXT_TO_IMAGE', requestMode: 'json', policyRevision: '734',
    verifiedAt: '2026-07-27T09:00:00.000Z', expiresAt: '2099-07-27T10:00:00.000Z',
  },
  capabilityEvidence: ['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'].map((operation) => ({
    operation, requestMode: 'multipart', policyRevision: '734',
    verifiedAt: '2026-07-27T09:00:00.000Z', expiresAt: '2099-07-27T10:00:00.000Z',
  })),
};
const emptySnapshot = {
  contractVersion: 'extension-byok-workbench-edit-controller/v1', executionMode: 'BYOK',
  slotKey: 'sku:sku-1:hero', profileId: null, operation: null,
  references: {
    sessionGlobalCount: 0, slotOverrideActive: false,
    slotOverrideCount: null, effectiveCount: 0,
  },
  operationAvailability: [],
  scheduler: {
    state: 'READY', activeCount: 0, queuedCount: 0,
    pauseRequested: false, effectiveConcurrency: null,
  },
  slot: { revision: 0, attemptIds: [], selectedAttemptId: null, selectedCandidateId: null },
  alternatives: [],
};
const candidateId = `br_${'a'.repeat(48)}`;
const reviewSnapshot = (selected = false) => ({
  ...emptySnapshot,
  profileId: 'profile-1', operation: 'IMAGE_TO_IMAGE',
  scheduler: { ...emptySnapshot.scheduler, state: 'REVIEW', effectiveConcurrency: 1 },
  slot: {
    revision: selected ? 4 : 3, attemptIds: ['attempt-000001'],
    selectedAttemptId: selected ? 'attempt-000001' : null,
    selectedCandidateId: selected ? candidateId : null,
  },
  alternatives: [{
    attemptId: 'attempt-000001', generation: 1, operation: 'IMAGE_TO_IMAGE',
    state: 'CANDIDATE_READY', candidateId, errorCode: null, selected,
    externalChargePossible: false, retryRisk: null,
  }],
});
const runningSnapshot = () => ({
  ...emptySnapshot,
  profileId: 'profile-1', operation: 'IMAGE_TO_IMAGE',
  scheduler: {
    ...emptySnapshot.scheduler,
    state: 'RUNNING', activeCount: 1, effectiveConcurrency: 1,
  },
  slot: {
    revision: 1, attemptIds: ['attempt-running-0001'],
    selectedAttemptId: null, selectedCandidateId: null,
  },
  alternatives: [{
    attemptId: 'attempt-running-0001', generation: 1, operation: 'IMAGE_TO_IMAGE',
    state: 'WAITING', candidateId: null, errorCode: null, selected: false,
    externalChargePossible: true, retryRisk: null,
  }],
});

let publicContext = {
  shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
  skuKey: 'sku-1', slotKey: 'sku:sku-1:hero',
};

const client = {
  async getPublicState() {
    calls.push(['public-state']);
    return {
      profiles: [profileRow],
      context: { ...publicContext },
    };
  },
  async getEditState() {
    calls.push(['edit-state']);
    const queued = editStateOutcomes.shift();
    if (queued?.error) throw queued.error;
    if (queued?.promise) return queued.promise;
    if (queued && 'value' in queued) return queued.value;
    if (deferredEditState) return deferredEditState.promise;
    if (nextEditStateError) {
      const error = nextEditStateError;
      nextEditStateError = null;
      throw error;
    }
    return emptySnapshot;
  },
  async uploadEditMedia(purpose, blob) {
    calls.push(['upload', purpose, blob]);
    const deferred = deferredUploads.get(purpose);
    if (deferred) {
      deferredUploads.delete(purpose);
      return deferred.promise;
    }
    mediaCounter += 1;
    return {
      mediaHandle: `mh_${String(mediaCounter).padStart(48, '0')}`,
      purpose,
      metadata: {
        mimeType: blob.type, byteLength: blob.size,
        width: 100,
        height: purpose === 'SOURCE' ? 300 : 100,
        sha256: String(mediaCounter).repeat(64).slice(0, 64),
      },
    };
  },
  async releaseEditMedia(handle, purpose) { calls.push(['release', handle, purpose]); return { released: true }; },
  async setEditReferences(value) {
    calls.push(['references', value]);
    const outcome = referenceOutcomes.shift();
    if (outcome) throw outcome;
    return emptySnapshot;
  },
  async startEdit(value) {
    calls.push(['start', value]);
    if (nextStartEditError) {
      const error = nextStartEditError;
      nextStartEditError = null;
      throw error;
    }
    if (nextStartEditSnapshot) {
      const snapshot = nextStartEditSnapshot;
      nextStartEditSnapshot = null;
      return snapshot;
    }
    return deferredStartEdit ? deferredStartEdit.promise : reviewSnapshot(false);
  },
  async selectEditAlternative(attemptId) {
    calls.push(['select', attemptId]);
    return reviewSnapshot(true);
  },
  async regenerateEdit(value) { calls.push(['regenerate', value]); return reviewSnapshot(true); },
  async openEditPreview(id) {
    calls.push(['preview', id]);
    return { objectUrl: 'blob:preview', metadata: {}, revoke() { revokedUrls.push('blob:preview'); } };
  },
  async cleanupEditSession() { calls.push(['cleanup']); return {}; },
  async acknowledgeEditRestart() { calls.push(['acknowledge-restart']); return {}; },
};

const maskState = { strokes: [], redo: [] };
const mask = {
  beginStroke(input) { maskState.active = input; return true; },
  extendStroke() { return true; },
  endStroke() { if (maskState.active) maskState.strokes.push(maskState.active); maskState.active = null; return true; },
  cancelStroke() { maskState.active = null; },
  undo() { const row = maskState.strokes.pop(); if (row) maskState.redo.push(row); },
  redo() { const row = maskState.redo.pop(); if (row) maskState.strokes.push(row); },
  clear() { maskState.strokes = []; },
  commands() { return maskState.strokes.map(() => ({ mode: 'paint', brushSize: 0.1, points: [{ x: 0.5, y: 0.5 }] })); },
  state() {
    return {
      canUndo: maskState.strokes.length > 0, canRedo: maskState.redo.length > 0,
      strokeCount: maskState.strokes.length, budgetExhausted: false,
    };
  },
};

const windowListeners = new Map();
const documentListeners = new Map();
const runtimeListeners = [];
const documentEvents = [];
let hostedByokExecutionAllowed = true;
const context = {
  Array, Blob, Boolean, Date, Error, Map, Math, Number, Object, Promise, Set, String,
  Uint8Array, Uint8ClampedArray,
  CustomEvent: class CustomEvent {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
  },
  document: {
    body,
    getElementById(id) { return nodes[id] || null; },
    querySelector(selector) {
      const option = selector.match(/^\[data-operation-option="([A-Z_]+)"\]$/u);
      if (option) return optionNodes[option[1]];
      const reason = selector.match(/^\[data-operation-reason="([A-Z_]+)"\]$/u);
      return reason ? reasonNodes[reason[1]] : null;
    },
    createElement(tagName) { return new FakeNode('', tagName); },
    addEventListener(type, listener) {
      const values = documentListeners.get(type) || [];
      values.push(listener);
      documentListeners.set(type, values);
    },
    dispatchEvent(event) {
      documentEvents.push(event);
      for (const listener of documentListeners.get(event.type) || []) listener(event);
      return true;
    },
  },
  chrome: { runtime: { onMessage: { addListener(listener) { runtimeListeners.push(listener); } } } },
  URL: {
    createObjectURL() {
      objectUrlCounter += 1;
      const value = `blob:local-${objectUrlCounter}`;
      createdUrls.push(value);
      return value;
    },
    revokeObjectURL(value) { revokedUrls.push(value); },
  },
  setTimeout(callback) { queueMicrotask(callback); return ++objectUrlCounter; },
  clearTimeout() {},
  queueMicrotask,
};
context.window = context;
context.globalThis = context;
context.addEventListener = (type, listener) => {
  const values = windowListeners.get(type) || [];
  values.push(listener);
  windowListeners.set(type, values);
};
context.SS_ERP_BYOK_WORKBENCH_CLIENT = {
  DEVICE_INVALIDATED_MESSAGE: 'ss-erp:byok-device-session-invalidated',
  createClient() { return client; },
};
context.SS_ERP_HOSTED_AI_IMAGE_WORKBENCH_CONTROLLER = {
  isByokExecutionAllowed() { return hostedByokExecutionAllowed; },
};
let workspaceRuntimeRevision = 0;
context.SS_ERP_BYOK_WORKBENCH_WORKSPACE_EVENTS = Object.freeze({
  nextRuntimeRevision() {
    workspaceRuntimeRevision += 1;
    return workspaceRuntimeRevision;
  },
});
context.SS_ERP_IMAGE_MASK_CORE = { createMask() { return mask; } };
context.SS_ERP_IMAGE_MASK_CANVAS = {
  sourcePoint(input) {
    return {
      x: input.clientX * input.sourceWidth / input.rect.width,
      y: input.clientY * input.sourceHeight / input.rect.height,
    };
  },
  renderCommands() {},
  measure() {
    return maskState.strokes.length
      ? { partial: true, editPixelCount: 100, preservedPixelCount: 9900 }
      : { partial: false, editPixelCount: 0, preservedPixelCount: 10000 };
  },
  async exportPng() {
    calls.push(['export-mask']);
    return { blob: new Blob(['mask'], { type: 'image/png' }) };
  },
};

vm.runInNewContext(source, context, { filename: `${root}/pages/ai-image-workbench-edit.js` });
const tick = () => new Promise((resolve) => setImmediate(resolve));

function assertRestartUnknownRuntime(eventOffset, message) {
  const event = documentEvents.slice(eventOffset).findLast(
    (candidate) => candidate.type === 'ss-erp:workspace-runtime',
  );
  assert.ok(event, message);
  assert.equal(event.detail.task.schedulerState, 'FAILED');
  assert.equal(
    event.detail.task.disabledReason,
    'PROVIDER_OUTCOME_RECONCILIATION_REQUIRED',
  );
  assert.equal(event.detail.slots[0].status, 'UNKNOWN_OUTCOME');
  assert.equal(event.detail.slots[0].alternatives[0].state, 'UNKNOWN_OUTCOME');
  assert.equal(event.detail.slots[0].alternatives[0].mediaId, null);
  assert.equal(event.detail.slots[0].alternatives[0].errorCode, 'PROVIDER_OUTCOME_UNKNOWN');
  assert.deepEqual(JSON.parse(JSON.stringify(event.detail.binding)), {
    shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
  });
}

await tick();
await tick();

assert.equal(nodes.operationImageToImage.disabled, false);
assert.match(reasonNodes.IMAGE_TO_IMAGE.textContent, /证据有效/u);

nodes.operationTextToImage.checked = false;
nodes.operationImageToImage.checked = true;
nodes.operationImageToImage.dispatch('change');
assert.equal(body.classList.contains('is-edit-operation'), true);
assert.equal(nodes.referenceInputGroup.hidden, false);
assert.match(nodes.operationReason.textContent, /1-4 张参考图/u);

const globalReference = new Blob(['global'], { type: 'image/png' });
referenceOutcomes.push(clientFailure('SS_ERP_BYOK_EDIT_INPUT_INVALID'));
nodes.referenceFiles.files = [globalReference];
nodes.referenceFiles.dispatch('change');
await tick();
await tick();
assert.equal(calls.some((row) => row[0] === 'release'
  && row[1] === `mh_${'1'.padStart(48, '0')}`), true,
  'a definitive reference sync failure releases the uncommitted handle');
assert.equal(nodes.referenceList.children.length, 0);

referenceOutcomes.push(
  clientFailure('SS_ERP_BYOK_WORKBENCH_RUNTIME_TIMEOUT'),
  clientFailure('SS_ERP_BYOK_WORKBENCH_RUNTIME_TIMEOUT'),
);
nodes.referenceFiles.files = [globalReference];
nodes.referenceFiles.dispatch('change');
await tick();
await tick();
await tick();
assert.equal(calls.some((row) => row[0] === 'release'
  && row[1] === `mh_${'2'.padStart(48, '0')}`), false,
  'an ambiguous sync retains the handle because the background may have committed it');
assert.match(nodes.operationReason.textContent, /同步结果未知/u);
assert.equal(nodes.runEditButton.disabled, true);
nodes.refreshButton.dispatch('click');
await tick();
await tick();
assert.equal(nodes.runEditButton.disabled, false,
  'refresh retries the exact reference target and clears the dispatch block');

referenceOutcomes.push(
  clientFailure('SS_ERP_BYOK_WORKBENCH_RUNTIME_FAILED'),
  clientFailure('SS_ERP_BYOK_WORKBENCH_RUNTIME_FAILED'),
);
nodes.referenceList.children[0].children[2].dispatch('click');
await tick();
await tick();
await tick();
assert.equal(nodes.referenceList.children.length, 1);
assert.match(nodes.referenceList.children[0].children[2].attributes['aria-label'], /第 1 张/u);
assert.equal(calls.some((row) => row[0] === 'release'
  && row[1] === `mh_${'2'.padStart(48, '0')}`), false,
  'an ambiguously removed handle remains retained until reconciliation');
assert.equal(nodes.runEditButton.disabled, true);
nodes.refreshButton.dispatch('click');
await tick();
await tick();
assert.equal(nodes.referenceList.children.length, 0);
assert.equal(nodes.referenceFiles.focused, true);
assert.equal(calls.some((row) => row[0] === 'release'
  && row[1] === `mh_${'2'.padStart(48, '0')}`), true,
  'a confirmed removal releases the handle only after background state commits');

nodes.referenceFiles.files = [globalReference];
nodes.referenceFiles.dispatch('change');
await tick();
await tick();
assert.deepEqual(JSON.parse(JSON.stringify(calls.filter((row) => row[0] === 'references').at(-1)[1])), {
  scope: 'SESSION_GLOBAL', handles: [`mh_${'3'.padStart(48, '0')}`],
});
assert.equal(nodes.runEditButton.disabled, false);

hostedByokExecutionAllowed = false;
context.document.dispatchEvent(new context.CustomEvent('ss-erp:workspace-refresh-request'));
assert.equal(nodes.runEditButton.disabled, true,
  'Hosted authority pending or locked disables BYOK edit before submission');
assert.equal(nodes.profileSelect.disabled, true);
assert.equal(nodes.referenceFiles.disabled, true);
assert.equal(nodes.sourceFile.disabled, true);
assert.equal(nodes.operationImageToImage.disabled, true);
const startsBeforeHostedLockClick = calls.filter((row) => row[0] === 'start').length;
nodes.runEditButton.dispatch('click');
await tick();
assert.equal(calls.filter((row) => row[0] === 'start').length, startsBeforeHostedLockClick);
hostedByokExecutionAllowed = true;
context.document.dispatchEvent(new context.CustomEvent('ss-erp:workspace-refresh-request'));
assert.equal(nodes.runEditButton.disabled, false,
  'an explicit NO_SUITE authority refresh re-enables BYOK edit');

nodes.referenceScopeGlobal.checked = false;
nodes.referenceScopeSlot.checked = true;
nodes.referenceScopeSlot.dispatch('change');
nodes.referenceFiles.files = [new Blob(['slot'], { type: 'image/webp' })];
nodes.referenceFiles.dispatch('change');
await tick();
await tick();
assert.deepEqual(JSON.parse(JSON.stringify(
  calls.filter((row) => row[0] === 'references').at(-1)[1],
)), {
  scope: 'SLOT', handles: [`mh_${'4'.padStart(48, '0')}`],
});

const dispatchRefreshOffset = documentEvents.length;
deferredStartEdit = createDeferred();
nodes.runEditButton.dispatch('click');
await tick();
assert.equal(body.dataset.editTaskLocked, 'true');
assert.ok(documentEvents.slice(dispatchRefreshOffset).some(
  (event) => event.type === 'ss-erp:workspace-refresh-request',
), 'the workspace freezes before the edit Provider request settles');
deferredStartEdit.resolve(reviewSnapshot(false));
deferredStartEdit = null;
await tick();
await tick();
assert.equal(calls.filter((row) => row[0] === 'start').length, 1);
assert.equal(calls.filter((row) => row[0] === 'select').length, 1,
  'the first reviewable alternative is selected without discarding other attempts');
const selectedWorkspaceRuntime = documentEvents.filter(
  (event) => event.type === 'ss-erp:workspace-runtime',
).at(-1);
assert.equal(selectedWorkspaceRuntime.detail.slots[0].slotRevision, 4,
  'workspace slot intents receive the media engine revision instead of a polling revision');
assert.deepEqual(JSON.parse(JSON.stringify(selectedWorkspaceRuntime.detail.binding)), {
  shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
});
assert.equal(nodes.editAlternatives.children.length, 1);
assert.equal(nodes.editSelectedPreview.hidden, false,
  'the selected preview frame reserves space as soon as alternatives exist');
const stableAlternativeRow = nodes.editAlternatives.children[0];
assert.equal(stableAlternativeRow.children[0].children[0].classList.contains('alternative-media'), true);
assert.equal(body.dataset.editTaskLocked, 'true');
assert.equal(nodes.profileSelect.disabled, true);
assert.equal(nodes.operationInpaint.disabled, true);
nodes.profileSelect.value = 'profile-other';
nodes.profileSelect.dispatch('change');
assert.equal(nodes.profileSelect.value, 'profile-1',
  'a started task freezes its Provider profile');

nodes.regenerateChargeConfirmation.checked = true;
nodes.regenerateChargeConfirmation.dispatch('change');
assert.equal(nodes.regenerateEditButton.disabled, false);
hostedByokExecutionAllowed = false;
context.document.dispatchEvent(new context.CustomEvent('ss-erp:workspace-refresh-request'));
assert.equal(nodes.regenerateEditButton.disabled, true);
const regeneratesBeforeHostedLockClick = calls.filter((row) => row[0] === 'regenerate').length;
nodes.regenerateEditButton.dispatch('click');
await tick();
assert.equal(calls.filter((row) => row[0] === 'regenerate').length,
  regeneratesBeforeHostedLockClick);
hostedByokExecutionAllowed = true;
context.document.dispatchEvent(new context.CustomEvent('ss-erp:workspace-refresh-request'));
assert.equal(nodes.regenerateEditButton.disabled, false);
nodes.regenerateEditButton.dispatch('click');
await tick();
assert.equal(nodes.editAlternatives.children[0], stableAlternativeRow,
  'selection and preview updates preserve the focused alternative DOM node');
const regenerated = calls.find((row) => row[0] === 'regenerate')[1];
assert.deepEqual(JSON.parse(JSON.stringify(regenerated.chargeAcknowledgement)), {
  warningVersion: 'external-provider-charge/v1', confirmed: true,
});

const refreshRestartOffset = documentEvents.length;
const lateNormalState = createDeferred();
editStateOutcomes.push(
  { promise: lateNormalState.promise },
  { error: clientFailure('SS_ERP_BYOK_EDIT_WORKER_RESTARTED') },
);
nodes.refreshButton.dispatch('click');
nodes.refreshButton.dispatch('click');
await tick();
await tick();
assert.equal(nodes.restartRecovery.hidden, false);
assert.equal(body.dataset.editTaskState, 'UNKNOWN_OUTCOME');
assertRestartUnknownRuntime(
  refreshRestartOffset,
  'a restart discovered while reading edit state projects an unknown Provider outcome',
);
lateNormalState.resolve(reviewSnapshot(true));
await tick();
await tick();
assert.equal(body.dataset.editTaskState, 'UNKNOWN_OUTCOME');
assertRestartUnknownRuntime(
  refreshRestartOffset,
  'a normal snapshot issued before restart detection cannot overwrite the unknown outcome',
);
assert.match(nodes.editResultNotice.textContent, /上一次请求结果可能未知/u);
assert.equal(nodes.restartAcknowledgeButton.disabled, true);
nodes.restartChargeConfirmation.checked = true;
nodes.restartChargeConfirmation.dispatch('change');
assert.equal(nodes.restartAcknowledgeButton.disabled, false);
hostedByokExecutionAllowed = false;
context.document.dispatchEvent(new context.CustomEvent('ss-erp:workspace-refresh-request'));
assert.equal(nodes.restartAcknowledgeButton.disabled, true);
const acknowledgementsBeforeHostedLockClick = calls.filter((row) => (
  row[0] === 'acknowledge-restart'
)).length;
nodes.restartAcknowledgeButton.dispatch('click');
await tick();
assert.equal(calls.filter((row) => row[0] === 'acknowledge-restart').length,
  acknowledgementsBeforeHostedLockClick);
hostedByokExecutionAllowed = true;
context.document.dispatchEvent(new context.CustomEvent('ss-erp:workspace-refresh-request'));
assert.equal(nodes.restartAcknowledgeButton.disabled, false);
nodes.restartAcknowledgeButton.dispatch('click');
await tick();
await tick();
assert.equal(calls.some((row) => row[0] === 'acknowledge-restart'), true);
assert.equal(nodes.restartRecovery.hidden, true);
assert.equal(body.dataset.editTaskLocked, 'false');
const resetClearIndex = documentEvents.findIndex((event) => event.type === 'ss-erp:workspace-clear');
const resetRefreshIndex = documentEvents.findIndex((event, index) => (
  index > resetClearIndex && event.type === 'ss-erp:workspace-refresh-request'
));
assert.ok(resetClearIndex >= 0 && resetRefreshIndex > resetClearIndex,
  'an explicit edit reset clears retained runtime before requesting a fresh bootstrap');

nodes.referenceFiles.files = [globalReference];
nodes.referenceFiles.dispatch('change');
await tick();
await tick();
const pollingRestartOffset = documentEvents.length;
nextStartEditSnapshot = runningSnapshot();
nextEditStateError = clientFailure('SS_ERP_BYOK_EDIT_WORKER_RESTARTED');
nodes.runEditButton.dispatch('click');
await tick();
await tick();
await tick();
assert.equal(nodes.restartRecovery.hidden, false);
assert.equal(body.dataset.editTaskState, 'UNKNOWN_OUTCOME');
assertRestartUnknownRuntime(
  pollingRestartOffset,
  'a worker restart discovered by scheduled polling replaces stale RUNNING state',
);
nodes.restartChargeConfirmation.checked = true;
nodes.restartChargeConfirmation.dispatch('change');
nodes.restartAcknowledgeButton.dispatch('click');
await tick();
await tick();

nodes.referenceFiles.files = [globalReference];
nodes.referenceFiles.dispatch('change');
await tick();
await tick();
const startRestartOffset = documentEvents.length;
nextStartEditError = clientFailure('SS_ERP_BYOK_EDIT_WORKER_RESTARTED');
nodes.runEditButton.dispatch('click');
await tick();
await tick();
assert.equal(nodes.restartRecovery.hidden, false);
assert.equal(body.dataset.editTaskState, 'UNKNOWN_OUTCOME');
assertRestartUnknownRuntime(
  startRestartOffset,
  'a worker restart returned by startEdit never remains projected as SUBMITTING',
);
nodes.restartChargeConfirmation.checked = true;
nodes.restartChargeConfirmation.dispatch('change');
nodes.restartAcknowledgeButton.dispatch('click');
await tick();
await tick();

nodes.operationImageToImage.checked = false;
nodes.operationInpaint.checked = true;
nodes.operationInpaint.dispatch('change');
nodes.sourceFile.files = [new Blob(['source'], { type: 'image/png' })];
nodes.sourceFile.dispatch('change');
await tick();
await tick();
assert.equal(calls.filter((row) => row[0] === 'upload').at(-1)[1], 'SOURCE');
assert.equal(nodes.sourceStage.style.width, 'min(100%, 140px)');
nodes.editMaskCanvas.dispatch('focus');
nodes.editMaskCanvas.dispatch('keydown', { key: 'ArrowRight', preventDefault() {} });
nodes.editMaskCanvas.dispatch('keydown', { key: 'Enter', preventDefault() {} });
assert.equal(maskState.strokes.length, 1,
  'keyboard users can position and apply the current mask tool');
nodes.editMaskCanvas.dispatch('pointerdown', {
  pointerId: 7, button: 0, isPrimary: true, clientX: 20, clientY: 20,
});
nodes.editMaskCanvas.dispatch('pointerup', {
  pointerId: 7, button: 0, isPrimary: true, clientX: 30, clientY: 30,
});
assert.equal(nodes.maskUndoButton.disabled, false);
assert.equal(nodes.maskEditPixels.textContent, '100');
assert.equal(nodes.editAlternatives.children.length, 0,
  'restart acknowledgement clears stale candidate DOM nodes');

profileRow.profile.allowedOperations = ['TEXT_TO_IMAGE'];
nodes.refreshButton.dispatch('click');
await tick();
await tick();
assert.equal(nodes.operationInpaint.disabled, true);
assert.match(reasonNodes.INPAINT.textContent, /当前档案未启用/u);

const runtimeEventsBeforeLateState = documentEvents.filter(
  (event) => event.type === 'ss-erp:workspace-runtime',
).length;
deferredEditState = createDeferred();
nodes.refreshButton.dispatch('click');
await tick();
await tick();
const deferredSourceUpload = createDeferred();
const lateSourceHandle = `mh_${'8'.repeat(48)}`;
const createdUrlsBeforeLateSource = createdUrls.length;
deferredUploads.set('SOURCE', deferredSourceUpload);
nodes.sourceFile.files = [new Blob(['late-source'], { type: 'image/png' })];
nodes.sourceFile.dispatch('change');
await tick();
assert.equal(calls.filter((row) => row[0] === 'upload').at(-1)[1], 'SOURCE');
runtimeListeners[0]({ type: 'ss-erp:byok-device-session-invalidated' });
const invalidationClearIndex = documentEvents.findLastIndex(
  (event) => event.type === 'ss-erp:workspace-clear',
);
deferredSourceUpload.resolve({
  mediaHandle: lateSourceHandle,
  purpose: 'SOURCE',
  metadata: {
    mimeType: 'image/png', byteLength: 11, width: 100, height: 300,
    sha256: '8'.repeat(64),
  },
});
deferredEditState.resolve(reviewSnapshot(true));
await tick();
await tick();
assert.equal(body.dataset.editTaskLocked, 'false');
assert.equal(nodes.editAlternatives.children.length, 0);
assert.equal(nodes.sourceStage.hidden, true,
  'a SOURCE upload arriving after invalidation cannot restore source UI');
assert.equal(createdUrls.length, createdUrlsBeforeLateSource,
  'a stale SOURCE upload cannot create an object URL after invalidation');
assert.equal(calls.some((row) => row[0] === 'release'
  && row[1] === lateSourceHandle && row[2] === 'SOURCE'), true,
'a stale SOURCE upload handle is released after invalidation');
assert.equal(documentEvents.filter(
  (event) => event.type === 'ss-erp:workspace-runtime',
).length, runtimeEventsBeforeLateState,
'a getEditState response arriving after device invalidation cannot restore workspace runtime');
assert.ok(invalidationClearIndex >= 0, 'device invalidation clears retained workspace projection');
assert.match(nodes.editResultNotice.textContent, /设备会话已变化/u);

const invalidBindingEventOffset = documentEvents.length;
publicContext = {
  shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3,
  skuKey: 'sku-1', slotKey: 'sku:sku-1:hero',
};
editStateOutcomes.push({ value: reviewSnapshot(true) });
nodes.refreshButton.dispatch('click');
await tick();
await tick();
assert.equal(documentEvents.slice(invalidBindingEventOffset).some(
  (event) => event.type === 'ss-erp:workspace-runtime',
), false, 'an incomplete edit draft binding never produces runtime state');
assert.equal(documentEvents.slice(invalidBindingEventOffset).some(
  (event) => event.type === 'ss-erp:workspace-clear',
), true, 'an incomplete edit draft binding clears retained workspace state');
assert.equal(documentEvents.slice(invalidBindingEventOffset).some(
  (event) => event.type === 'ss-erp:workspace-refresh-request',
), true, 'an incomplete edit draft binding requests an authoritative refresh');
publicContext = {
  shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
  skuKey: 'sku-1', slotKey: 'sku:sku-1:hero',
};
deferredEditState = null;
nodes.refreshButton.dispatch('click');
await tick();
await tick();

const deferredReferenceUpload = createDeferred();
const lateReferenceHandle = `mh_${'9'.repeat(48)}`;
const createdUrlsBeforePagehide = createdUrls.length;
deferredUploads.set('REFERENCE', deferredReferenceUpload);
nodes.referenceFiles.files = [new Blob(['late-reference'], { type: 'image/webp' })];
nodes.referenceFiles.dispatch('change');
await tick();
for (const listener of windowListeners.get('pagehide') || []) listener({});
deferredReferenceUpload.resolve({
  mediaHandle: lateReferenceHandle,
  purpose: 'REFERENCE',
  metadata: {
    mimeType: 'image/webp', byteLength: 14, width: 100, height: 100,
    sha256: '9'.repeat(64),
  },
});
await tick();
await tick();
assert.equal(createdUrls.length, createdUrlsBeforePagehide,
  'a REFERENCE upload arriving after pagehide cannot create an object URL');
assert.equal(nodes.referenceList.children.length, 0,
  'a REFERENCE upload arriving after pagehide cannot restore reference UI');
assert.equal(calls.some((row) => row[0] === 'release'
  && row[1] === lateReferenceHandle && row[2] === 'REFERENCE'), true,
'a stale REFERENCE upload handle is released after pagehide');
assert.ok(revokedUrls.includes('blob:preview'));
console.log('PASS extension BYOK edit workbench UI');
