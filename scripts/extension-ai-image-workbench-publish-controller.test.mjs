import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL(
  '../extensions/ss-erp/pages/ai-image-workbench-publish.js',
  import.meta.url,
), 'utf8');

class FakeTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  dispatchEvent(event) {
    for (const listener of this.listeners.get(event.type) || []) listener(event);
    return true;
  }
}

class FakeNode extends FakeTarget {
  constructor(id, tagName = 'div') {
    super();
    this.id = id;
    this.tagName = tagName.toUpperCase();
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.textContent = '';
    this.children = [];
  }
  replaceChildren(...children) { this.children = children; }
  dispatch(type, isTrusted = true) { this.dispatchEvent({ type, isTrusted }); }
}

class FakeCustomEvent {
  constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
}

class FakeDocument extends FakeTarget {
  constructor(nodes) { super(); this.nodes = nodes; }
  getElementById(id) { return this.nodes[id] || null; }
  createElement(tagName) { return new FakeNode('', tagName); }
}

const IDS = [
  'workspacePublishControls', 'workspacePublishMode', 'workspacePublishShop',
  'workspacePublishDraft', 'workspacePublishSkus', 'workspacePublishMedia',
  'workspacePublishOperationStatus', 'workspacePublishConfirmationRow',
  'workspacePublishConfirmation', 'workspacePublishConfirmButton',
  'workspacePublishRefreshButton', 'workspacePublishRecoverButton', 'publishPanel',
];

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

function request(executionMode = 'ERP_HOSTED') {
  return {
    executionMode,
    binding: {
      shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 12, draftVersion: 8,
    },
    selectedMedia: [{
      scope: 'SKU', skuKey: 'sku-red', slotKey: 'sku:sku-red:hero', assetId: 'asset-hero',
    }, {
      scope: 'PRODUCT', skuKey: null, slotKey: 'shared:detail:DETAIL', assetId: 'asset-detail',
    }],
  };
}

function snapshot(executionMode = 'ERP_HOSTED', state = 'BOUND', eligible = true) {
  const selected = request(executionMode);
  return {
    contractVersion: 'extension-byok-workbench-workspace-state/v1',
    executionMode,
    binding: clone(selected.binding),
    publishRevision: 0,
    publishBasis: {
      expectedWorkspaceRevision: 7,
      expectedRuntimeRevision: 4,
      binding: clone(selected.binding),
      orderedMedia: [{
        skuKey: 'sku-red', slotKey: 'sku:sku-red:hero', position: 0,
        role: 'HERO', attemptId: 'attempt-hero', mediaId: 'asset-hero',
      }, {
        skuKey: 'sku-red', slotKey: 'shared:detail:DETAIL', position: 1,
        role: 'DETAIL', attemptId: 'attempt-detail', mediaId: 'asset-detail',
      }],
    },
    slots: [{
      slotKey: 'sku:sku-red:hero', assignmentScope: 'SKU',
      applicableSkuKeys: ['sku-red'], publishMediaEligible: eligible,
      alternatives: [{ attemptId: 'attempt-hero', state, mediaId: 'asset-hero' }],
      selectedAttemptId: 'attempt-hero',
    }, {
      slotKey: 'shared:detail:DETAIL', assignmentScope: 'PRODUCT',
      applicableSkuKeys: ['sku-red'], publishMediaEligible: eligible,
      alternatives: [{ attemptId: 'attempt-detail', state, mediaId: 'asset-detail' }],
      selectedAttemptId: 'attempt-detail',
    }],
    publishSummary: { eligible },
  };
}

function preview(input) {
  return {
    contractVersion: 'extension-workbench-listing-publish/v1',
    executionMode: input.executionMode,
    shopId: input.binding.shopId,
    workflowId: input.binding.workflowId,
    basisDraftRevision: input.binding.draftRevision,
    basisDraftVersion: input.binding.draftVersion,
    selectedMedia: clone(input.selectedMedia),
    currentDraftRevision: input.binding.draftRevision,
    currentDraftVersion: input.binding.draftVersion,
    previewHash: '8'.repeat(64),
    selectedSkuKeys: ['sku-red'],
    orderedMedia: [{
      ordinal: 0, scope: 'SKU', skuKey: 'sku-red', slotKey: 'source:hero',
      assetId: 'asset-source', source: 'SOURCE',
    }, {
      ordinal: 1, scope: 'SKU', skuKey: 'sku-red', slotKey: 'sku:sku-red:hero',
      assetId: 'asset-hero', source: 'GENERATED',
    }, {
      ordinal: 2, scope: 'PRODUCT', skuKey: null, slotKey: 'shared:detail:DETAIL',
      assetId: 'asset-detail', source: 'EDITED',
    }],
  };
}

function publishState(input, state = 'SUCCEEDED') {
  return {
    contractVersion: 'extension-workbench-listing-publish/v1',
    request: clone(input),
    state,
    executionMode: input.executionMode,
    shopId: input.binding.shopId,
    workflowId: input.binding.workflowId,
    currentDraftRevision: input.binding.draftRevision,
    currentDraftVersion: input.binding.draftVersion,
    previewHash: '8'.repeat(64),
    receiptId: ['PENDING', 'SUCCEEDED'].includes(state) ? 'receipt-1' : null,
    failureCode: state === 'FAILED' ? 'PUBLISH_FAILED' : null,
  };
}

function createHarness(options = {}) {
  const nodes = Object.fromEntries(IDS.map((id) => [id, new FakeNode(
    id,
    id === 'workspacePublishConfirmation' ? 'input'
      : id.endsWith('Button') ? 'button'
        : id === 'workspacePublishMedia' ? 'ol' : 'div',
  )]));
  const document = new FakeDocument(nodes);
  const calls = [];
  const runtimeListeners = [];
  const client = {
    async getActiveWorkspacePublish() {
      calls.push(['active']);
      return typeof options.active === 'function' ? options.active() : null;
    },
    async getWorkspacePublishState(value) {
      calls.push(['state', clone(value)]);
      return typeof options.state === 'function' ? options.state(value) : null;
    },
    async getWorkspacePublishPreview(value) {
      calls.push(['preview', clone(value)]);
      return typeof options.preview === 'function' ? options.preview(value) : preview(value);
    },
    async confirmWorkspacePublish(value, hash) {
      calls.push(['confirm', clone(value), hash]);
      return typeof options.confirm === 'function'
        ? options.confirm(value, hash) : publishState(value);
    },
    async recoverWorkspacePublish(value) {
      calls.push(['recover', clone(value)]);
      return typeof options.recover === 'function'
        ? options.recover(value) : publishState(value);
    },
  };
  const context = {
    console,
    CustomEvent: FakeCustomEvent,
    document,
    chrome: { runtime: { onMessage: { addListener(listener) { runtimeListeners.push(listener); } } } },
    SS_ERP_BYOK_WORKBENCH_CLIENT: {
      DEVICE_INVALIDATED_MESSAGE: 'SS_ERP_EXTENSION_DEVICE_INVALIDATED',
      createClient() { return client; },
    },
    SS_ERP_BYOK_WORKBENCH_WORKSPACE_STATE: {
      PUBLISH_PROJECTION_CONTRACT_VERSION: 'extension-byok-workbench-publish-projection/v1',
    },
    setTimeout,
    clearTimeout,
  };
  context.globalThis = context;
  context.self = context;
  vm.runInNewContext(source, context, { filename: 'ai-image-workbench-publish.js' });
  assert.ok(context.SS_ERP_WORKBENCH_PUBLISH_PAGE_CONTROLLER);
  return {
    context, document, nodes, calls, runtimeListeners,
    controller: context.SS_ERP_WORKBENCH_PUBLISH_PAGE_CONTROLLER,
    emitSnapshot(value) {
      document.dispatchEvent(new FakeCustomEvent('ss-erp:workspace-state', { detail: value }));
    },
  };
}

async function settle(turns = 20) {
  for (let index = 0; index < turns; index += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 5));
  for (let index = 0; index < turns; index += 1) await Promise.resolve();
}

assert.doesNotMatch(source, /innerHTML|fetch\s*\(|Authorization|apiKey|ozon\.ru/iu);
assert.match(source, /getWorkspacePublishPreview|confirmWorkspacePublish|recoverWorkspacePublish/u);

for (const state of ['CANDIDATE_READY', 'REJECTED', 'UNKNOWN_OUTCOME', 'SUCCEEDED']) {
  const test = createHarness();
  test.emitSnapshot(snapshot('BYOK', state, false));
  await settle();
  assert.equal(
    test.calls.some((row) => row[0] === 'preview'),
    false,
    `${state} media must never request a publish preview`,
  );
  assert.equal(test.controller.getState().request, null);
  assert.equal(test.nodes.workspacePublishConfirmButton.disabled, true);
}

for (const mode of ['ERP_HOSTED', 'BYOK']) {
  const test = createHarness();
  const current = snapshot(mode);
  const projectionEvents = [];
  test.document.addEventListener('ss-erp:workspace-publish-projection', (event) => {
    projectionEvents.push(event.detail);
  });
  test.emitSnapshot(current);
  await settle();
  const previewCall = test.calls.find((row) => row[0] === 'preview');
  assert.deepEqual(previewCall[1], request(mode));
  assert.equal(test.nodes.workspacePublishMode.textContent,
    mode === 'ERP_HOSTED' ? 'ERP 托管计费' : '自带 API Key');
  assert.equal(test.nodes.workspacePublishMedia.children.length, 3);
  assert.match(test.nodes.workspacePublishMedia.children[0].textContent, /asset-source/u);
  assert.match(test.nodes.workspacePublishMedia.children[2].textContent, /asset-detail/u);
  assert.equal(projectionEvents.length, 1);
  assert.deepEqual(clone(projectionEvents[0].orderedMedia), current.publishBasis.orderedMedia);
  assert.deepEqual(clone(projectionEvents[0].binding), current.binding);
  test.emitSnapshot(current);
  assert.equal(projectionEvents.length, 1, 'same snapshot must not fabricate a second preview');

  test.nodes.workspacePublishConfirmation.checked = true;
  test.nodes.workspacePublishConfirmation.dispatch('change', false);
  assert.equal(test.nodes.workspacePublishConfirmButton.disabled, true);
  test.nodes.workspacePublishConfirmation.dispatch('change', true);
  assert.equal(test.nodes.workspacePublishConfirmButton.disabled, false);
  test.nodes.workspacePublishConfirmButton.dispatch('click', false);
  await settle();
  assert.equal(test.calls.some((row) => row[0] === 'confirm'), false);
  test.nodes.workspacePublishConfirmButton.dispatch('click', true);
  await settle();
  assert.equal(test.calls.filter((row) => row[0] === 'confirm').length, 1);
  assert.equal(test.controller.getState().publishState.receiptId, 'receipt-1');
}

{
  let attempts = 0;
  const rejected = Object.assign(new Error('draft validation stale'), {
    code: 'SS_ERP_WORKBENCH_PUBLISH_DRAFT_NOT_READY',
  });
  const test = createHarness({
    async preview(value) {
      attempts += 1;
      if (attempts === 1) throw rejected;
      return preview(value);
    },
  });
  test.emitSnapshot(snapshot());
  await settle();
  assert.equal(test.nodes.workspacePublishControls.hidden, false);
  assert.match(test.nodes.workspacePublishOperationStatus.textContent, /草稿校验尚未通过/u);
  assert.equal(test.nodes.workspacePublishRefreshButton.hidden, false);
  test.nodes.workspacePublishRefreshButton.dispatch('click', false);
  await settle();
  assert.equal(attempts, 1, 'an untrusted retry must not reach ERP');
  test.nodes.workspacePublishRefreshButton.dispatch('click', true);
  await settle();
  assert.equal(attempts, 2);
  assert.equal(test.controller.getState().preview.previewHash, '8'.repeat(64));
  assert.equal(test.nodes.workspacePublishRefreshButton.hidden, true);
  test.document.dispatchEvent(new FakeCustomEvent('ss-erp:workspace-state-clear', {
    detail: null,
  }));
  assert.equal(test.controller.getState().request, null);
  assert.equal(test.controller.getState().lastError, null);
  assert.equal(test.nodes.workspacePublishControls.hidden, true);
}

{
  let resolveConfirm;
  const pending = new Promise((resolve) => { resolveConfirm = resolve; });
  const test = createHarness({ confirm: () => pending });
  test.emitSnapshot(snapshot());
  await settle();
  test.nodes.workspacePublishConfirmation.checked = true;
  test.nodes.workspacePublishConfirmation.dispatch('change', true);
  test.nodes.workspacePublishConfirmButton.dispatch('click', true);
  test.nodes.workspacePublishConfirmButton.dispatch('click', true);
  assert.equal(test.calls.filter((row) => row[0] === 'confirm').length, 1);
  assert.equal(test.controller.getState().busy, true);
  resolveConfirm(publishState(request()));
  await settle();
  assert.equal(test.controller.getState().publishState.state, 'SUCCEEDED');
}

for (const code of [
  'SS_ERP_WORKBENCH_PUBLISH_UNKNOWN_OUTCOME',
  'SS_ERP_BYOK_PUBLISH_UNKNOWN_OUTCOME',
]) {
  const unknown = Object.assign(new Error('response lost'), {
    code,
    outcome: 'UNKNOWN_OUTCOME',
    automaticRetryAllowed: false,
  });
  const test = createHarness({ confirm: async () => { throw unknown; } });
  test.emitSnapshot(snapshot('BYOK'));
  await settle();
  test.nodes.workspacePublishConfirmation.checked = true;
  test.nodes.workspacePublishConfirmation.dispatch('change', true);
  test.nodes.workspacePublishConfirmButton.dispatch('click', true);
  await settle();
  assert.equal(test.controller.getState().publishState.state, 'OUTCOME_UNRESOLVED');
  assert.equal(test.nodes.workspacePublishRecoverButton.hidden, false);
  assert.equal(test.nodes.workspacePublishConfirmButton.hidden, true);
  assert.equal(test.calls.filter((row) => row[0] === 'confirm').length, 1);
  assert.equal(test.calls.filter((row) => row[0] === 'recover').length, 0);
  test.nodes.workspacePublishConfirmButton.dispatch('click', true);
  await settle();
  assert.equal(test.calls.filter((row) => row[0] === 'confirm').length, 1);
  assert.equal(test.calls.filter((row) => row[0] === 'recover').length, 0);
}

{
  const active = publishState(request('BYOK'), 'OUTCOME_UNRESOLVED');
  const test = createHarness({
    active: async () => active,
    recover: async (value) => publishState(value, 'SUCCEEDED'),
  });
  await settle();
  assert.equal(test.controller.getState().publishState.state, 'OUTCOME_UNRESOLVED');
  assert.equal(test.nodes.workspacePublishRecoverButton.hidden, false);
  test.nodes.workspacePublishRecoverButton.dispatch('click', true);
  test.nodes.workspacePublishRecoverButton.dispatch('click', true);
  await settle();
  assert.equal(test.calls.filter((row) => row[0] === 'recover').length, 1);
  assert.equal(test.controller.getState().publishState.state, 'SUCCEEDED');
  assert.equal(test.controller.getState().publishState.receiptId, 'receipt-1');
}

{
  let resolveActive;
  const active = new Promise((resolve) => { resolveActive = resolve; });
  const test = createHarness({ active: () => active });
  assert.equal(test.runtimeListeners.length, 1);
  test.runtimeListeners[0]({ type: 'SS_ERP_EXTENSION_DEVICE_INVALIDATED' });
  resolveActive(publishState(request('BYOK'), 'OUTCOME_UNRESOLVED'));
  await settle();
  assert.equal(test.controller.getState().request, null);
  assert.equal(test.controller.getState().publishState, null);
  assert.match(test.controller.getState().lastError, /设备会话已失效/u);
}

console.log('extension AI image workbench publish controller tests passed');
