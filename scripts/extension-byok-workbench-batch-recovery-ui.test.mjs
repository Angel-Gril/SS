import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL(
  '../extensions/ss-erp/pages/ai-image-workbench-batch.js',
  import.meta.url,
), 'utf8');

const SLOT_KEY = 'sku:sku-1:hero';
const ATTEMPT_ID = 'attempt-1';
const COMMAND_ID = 'byok-command:00000000-0000-4000-8000-000000000001';
const LIFECYCLE_PING = 'ss-erp:ai-image-workbench-batch-lifecycle-ping/v1';
const LIFECYCLE_ACK = 'ss-erp:ai-image-workbench-batch-lifecycle-ack/v1';

class TestNode {
  constructor(id = '', tagName = 'div') {
    this.id = id;
    this.tagName = String(tagName).toUpperCase();
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this.hidden = false;
    this.checked = false;
    this.src = '';
    this.complete = true;
    this.naturalWidth = 1024;
    this.naturalHeight = 1024;
    this.dataset = {};
    this.children = [];
    this.listeners = {};
    this.attributes = {};
    this.className = '';
  }

  get firstChild() { return this.children[0] || null; }

  addEventListener(type, listener) { this.listeners[type] = listener; }

  setAttribute(name, value) { this.attributes[name] = String(value); }

  removeAttribute(name) {
    delete this.attributes[name];
    if (name === 'src') this.src = '';
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    return child;
  }
}

function bootstrap() {
  return {
    contractVersion: 'extension-byok-workbench-workspace-state/v1',
    executionMode: 'BYOK',
    dispatched: false,
    binding: {
      shopId: 'shop-1',
      workflowId: 'workflow-1',
      draftRevision: 3,
      draftVersion: 4,
    },
    selectedSlotKey: SLOT_KEY,
    skus: [{
      skuKey: 'sku-1',
      label: 'SKU 1',
      slots: [{
        slotKey: SLOT_KEY,
        role: 'HERO',
        prompt: 'White ceramic mug on a clean background',
        negativePrompt: 'watermark',
      }],
    }],
  };
}

function projection(state, recoveryRequirement = null) {
  const unknown = state === 'UNKNOWN_OUTCOME';
  return {
    contractVersion: 'extension-byok-workbench-batch-coordinator/v1',
    executionMode: 'BYOK',
    revision: 3,
    scheduler: {
      state: 'FAILED',
      activeCount: 0,
      queuedCount: 0,
      pauseRequested: false,
      effectiveConcurrency: 1,
    },
    billing: { erpGenerationChargeCents: 0 },
    slots: [{
      slotKey: SLOT_KEY,
      skuKey: 'sku-1',
      assignmentOrdinal: 0,
      operation: 'TEXT_TO_IMAGE',
      revision: 2,
      state,
      selectedAttemptId: null,
      selectedResultId: null,
      attempts: [{
        attemptId: ATTEMPT_ID,
        generation: 1,
        operation: 'TEXT_TO_IMAGE',
        state,
        resultId: null,
        errorCode: unknown ? 'PROVIDER_OUTCOME_UNKNOWN' : 'PROVIDER_RETRYABLE',
        retryOfAttemptId: null,
        externalChargePossible: true,
        retryRisk: unknown ? 'DUPLICATE_CHARGE' : 'EXTERNAL_PROVIDER_CHARGE',
        chargeWarningVersion: unknown
          ? 'external-provider-duplicate-charge/v1'
          : 'external-provider-charge/v1',
        automaticRetryAllowed: false,
        recoveryRequirement,
        unknownOutcomeSuperseded: false,
        reviewState: 'AVAILABLE',
      }],
    }],
    ingest: {
      state: 'NOT_STARTED',
      replayed: null,
      receiptId: null,
      boundDraftRevision: null,
      boundDraftVersion: null,
      erpGenerationChargeCents: 0,
      rebootstrapRequired: false,
      errorCode: null,
    },
  };
}

function descendants(root) {
  return [root, ...root.children.flatMap(descendants)];
}

function elements(root, predicate) {
  return descendants(root).filter(predicate);
}

function single(root, predicate, message) {
  const matches = elements(root, predicate);
  assert.equal(matches.length, 1, message);
  return matches[0];
}

function textValues(root) {
  return elements(root, (node) => node.textContent.length > 0).map((node) => node.textContent);
}

async function flushAsync(turns = 4) {
  for (let index = 0; index < turns; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function createHarness(state, recoveryRequirement = null) {
  const ids = [
    'profileSelect', 'promptInput', 'negativePromptInput', 'sizeSelect', 'generateButton',
    'batchStatus', 'batchStateBadge', 'batchSlotSelection', 'batchConcurrency',
    'batchAcceptButton', 'batchRecoverButton', 'batchClearButton', 'batchRecoveryList',
    'batchPreviewPanel', 'batchPreviewImage', 'batchPreviewMeta', 'batchPreviewCloseButton',
  ];
  const nodes = Object.fromEntries(ids.map((id) => [id, new TestNode(
    id,
    id === 'profileSelect' || id === 'sizeSelect' || id === 'batchConcurrency'
      ? 'select'
      : id === 'promptInput' || id === 'negativePromptInput'
        ? 'textarea'
        : id.endsWith('Button') ? 'button' : id === 'batchPreviewImage' ? 'img' : 'div',
  )]));
  nodes.profileSelect.value = 'profile-1';
  nodes.sizeSelect.value = '1024x1024';

  const authoritative = projection(state, recoveryRequirement);
  const commands = [];
  const client = {
    async state() { return authoritative; },
    async start() { throw new Error('unexpected start'); },
    async command(value) {
      commands.push(JSON.parse(JSON.stringify(value)));
      return authoritative;
    },
    async openPreview() { throw new Error('unexpected preview'); },
    async ingest() { throw new Error('unexpected ingest'); },
    async recover() { throw new Error('unexpected ingest recovery'); },
    async clear() { return true; },
  };
  const documentListeners = new Map();
  const body = new TestNode('body', 'body');
  let runtimeRevision = 0;
  const lifecycleMessageListeners = [];
  const lifecycleDisconnectListeners = [];
  let lifecycleDisconnected = false;
  const context = {
    Array,
    Blob,
    Boolean,
    Date,
    Error,
    Map,
    Math,
    Number,
    Object,
    Promise,
    Set,
    String,
    TextEncoder,
    Uint8Array,
    document: {
      body,
      getElementById(id) { return nodes[id] || null; },
      createElement(tagName) { return new TestNode('', tagName); },
      addEventListener(type, listener) {
        const listeners = documentListeners.get(type) || [];
        listeners.push(listener);
        documentListeners.set(type, listeners);
      },
      dispatchEvent(event) {
        for (const listener of documentListeners.get(event.type) || []) listener(event);
        return true;
      },
    },
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    crypto: {
      randomUUID() { return '00000000-0000-4000-8000-000000000001'; },
      subtle: {
        async digest() { return Uint8Array.from({ length: 32 }, (_value, index) => index).buffer; },
      },
    },
    chrome: {
      runtime: {
        connect(input) {
          assert.equal(input && input.name, 'ss-erp:ai-image-workbench-batch-lifecycle');
          assert.deepEqual(Object.keys(input || {}), ['name']);
          return {
            onMessage: {
              addListener(listener) { lifecycleMessageListeners.push(listener); },
            },
            onDisconnect: {
              addListener(listener) { lifecycleDisconnectListeners.push(listener); },
            },
            postMessage(message) {
              assert.equal(lifecycleDisconnected, false);
              assert.equal(message, LIFECYCLE_PING);
              Promise.resolve().then(function () {
                lifecycleMessageListeners.forEach(function (listener) {
                  listener(LIFECYCLE_ACK);
                });
              });
            },
            disconnect() {
              if (lifecycleDisconnected) return;
              lifecycleDisconnected = true;
              lifecycleDisconnectListeners.forEach(function (listener) { listener(); });
            },
          };
        },
      },
    },
    URL: {
      createObjectURL() { return 'blob:unused'; },
      revokeObjectURL() {},
    },
    setTimeout(callback, delay) {
      const timer = setTimeout(callback, delay);
      timer.unref();
      return timer;
    },
    clearTimeout,
  };
  context.globalThis = context;
  context.SS_ERP_BYOK_WORKBENCH_BATCH_CLIENT = {
    createClient() { return client; },
  };
  context.SS_ERP_BYOK_WORKBENCH_WORKSPACE_EVENTS = {
    nextRuntimeRevision() {
      runtimeRevision += 1;
      return runtimeRevision;
    },
  };

  vm.runInNewContext(source, context, { filename: 'ai-image-workbench-batch.js' });
  context.document.dispatchEvent(new context.CustomEvent('ss-erp:workspace-bootstrap', {
    detail: bootstrap(),
  }));
  await flushAsync();

  assert.equal(nodes.batchRecoveryList.hidden, false, 'the recovery warning list is visible');
  assert.equal(nodes.batchRecoveryList.children.length, 1, 'one exact attempt is recoverable');
  return { commands, nodes, row: nodes.batchRecoveryList.children[0] };
}

function assertBaseCommand(command, kind) {
  assert.deepEqual(command, {
    kind,
    commandId: COMMAND_ID,
    expectedWorkspaceRevision: 2,
    expectedRuntimeRevision: 3,
    slotKey: SLOT_KEY,
    attemptId: ATTEMPT_ID,
    expectedSlotRevision: 2,
  });
}

test('retryable failure exposes a truthful charge warning and requires trusted confirmation', async () => {
  const harness = await createHarness('FAILED_RETRYABLE');
  const texts = textValues(harness.row);
  assert.ok(texts.includes(`${SLOT_KEY}：可在确认费用后重试`));
  assert.ok(texts.includes('确认再次产生 Provider 费用'));
  assert.ok(!texts.some((value) => value.includes('重复扣费')),
    'a known failure must not be described as an unknown duplicate-charge outcome');

  const confirmation = single(harness.row,
    (node) => node.tagName === 'INPUT' && node.type === 'checkbox',
    'the external-charge acknowledgement checkbox is rendered');
  const retry = single(harness.row,
    (node) => node.tagName === 'BUTTON' && node.textContent === '重试',
    'the normal retry command has a truthful label');
  assert.equal(retry.disabled, true);

  confirmation.checked = true;
  confirmation.listeners.change({ isTrusted: false });
  assert.equal(retry.disabled, true, 'a synthetic checkbox event cannot unlock a charged retry');
  confirmation.listeners.change({ isTrusted: true });
  assert.equal(retry.disabled, false);
  retry.listeners.click({ isTrusted: false });
  assert.equal(harness.commands.length, 0, 'a synthetic click cannot submit the retry');
  retry.listeners.click({ isTrusted: true });
  await flushAsync();

  assert.deepEqual(harness.commands, [{
    kind: 'RETRY_ATTEMPT',
    commandId: COMMAND_ID,
    expectedWorkspaceRevision: 2,
    expectedRuntimeRevision: 3,
    slotKey: SLOT_KEY,
    attemptId: ATTEMPT_ID,
    expectedSlotRevision: 2,
    externalChargeAcknowledgement: {
      warningVersion: 'external-provider-charge/v1',
      confirmed: true,
    },
  }]);
});

test('unknown outcome separates safe lookup from explicitly confirmed duplicate-charge retry', async () => {
  const lookupHarness = await createHarness('UNKNOWN_OUTCOME');
  const lookupTexts = textValues(lookupHarness.row);
  assert.ok(lookupTexts.includes(`${SLOT_KEY}：Provider 结果未知`));
  assert.ok(lookupTexts.includes('确认可能重复扣费'));
  assert.ok(lookupTexts.includes('承担风险并重试'));

  const resolve = single(lookupHarness.row,
    (node) => node.tagName === 'BUTTON' && node.textContent === '查询原请求',
    'the non-charging lookup action is explicit');
  const lockedRetry = single(lookupHarness.row,
    (node) => node.tagName === 'BUTTON' && node.textContent === '承担风险并重试',
    'the duplicate-charge retry action is explicit');
  assert.equal(resolve.disabled, false, 'read-only Provider lookup does not require charge consent');
  assert.equal(lockedRetry.disabled, true, 'Provider resubmission remains locked');
  resolve.listeners.click({ isTrusted: false });
  assert.equal(lookupHarness.commands.length, 0);
  resolve.listeners.click({ isTrusted: true });
  await flushAsync();
  assert.equal(lookupHarness.commands.length, 1);
  assertBaseCommand(lookupHarness.commands[0], 'RESOLVE_UNKNOWN_ATTEMPT');

  const retryHarness = await createHarness('UNKNOWN_OUTCOME');
  const confirmation = single(retryHarness.row,
    (node) => node.tagName === 'INPUT' && node.type === 'checkbox',
    'the duplicate-charge acknowledgement checkbox is rendered');
  const retry = single(retryHarness.row,
    (node) => node.tagName === 'BUTTON' && node.textContent === '承担风险并重试',
    'the duplicate-charge retry button is rendered');
  confirmation.checked = true;
  confirmation.listeners.change({ isTrusted: true });
  assert.equal(retry.disabled, false);
  retry.listeners.click({ isTrusted: true });
  await flushAsync();

  assert.deepEqual(retryHarness.commands, [{
    kind: 'RETRY_ATTEMPT',
    commandId: COMMAND_ID,
    expectedWorkspaceRevision: 2,
    expectedRuntimeRevision: 3,
    slotKey: SLOT_KEY,
    attemptId: ATTEMPT_ID,
    expectedSlotRevision: 2,
    unknownOutcomeRecovery: {
      strategy: 'DUPLICATE_CHARGE_CONFIRMATION',
      warningVersion: 'external-provider-duplicate-charge/v1',
      confirmed: true,
    },
  }]);
});

test('restart-orphaned unknown outcome exposes lookup only and cannot resubmit Provider work', async () => {
  const harness = await createHarness(
    'UNKNOWN_OUTCOME',
    'SERVICE_WORKER_RESTART_RECONCILIATION_REQUIRED',
  );
  const texts = textValues(harness.row);
  assert.ok(texts.includes(`${SLOT_KEY}：Provider 结果未知`));
  assert.ok(texts.includes('查询原请求'));
  assert.ok(!texts.some((value) => value.includes('重试')),
    'restart-orphaned attempts do not expose a Provider resubmission control');
  assert.equal(elements(harness.row,
    (node) => node.tagName === 'INPUT' && node.type === 'checkbox').length, 0,
  'restart-orphaned attempts do not imply duplicate-charge consent can make retry safe');

  const resolve = single(harness.row,
    (node) => node.tagName === 'BUTTON' && node.textContent === '查询原请求',
    'restart reconciliation retains only the authoritative status lookup');
  assert.equal(resolve.disabled, false);
  resolve.listeners.click({ isTrusted: true });
  await flushAsync();
  assert.equal(harness.commands.length, 1);
  assertBaseCommand(harness.commands[0], 'RESOLVE_UNKNOWN_ATTEMPT');
});
