import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(
  new URL('../extensions/ss-erp/pages/ai-image-workbench-batch.js', import.meta.url),
  'utf8',
);

const PORT_NAME = 'ss-erp:ai-image-workbench-batch-lifecycle';
const PING = 'ss-erp:ai-image-workbench-batch-lifecycle-ping/v1';
const ACK = 'ss-erp:ai-image-workbench-batch-lifecycle-ack/v1';
const UNAVAILABLE = 'SS_ERP_BYOK_BATCH_LIFECYCLE_UNAVAILABLE';
const ACK_DEADLINE_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 20_000;
const MAX_LIFECYCLE_MS = 20 * 60 * 1_000;
const SLOT_KEY = 'sku:sku-1:hero';
const ATTEMPT_ID = 'attempt-1';

class FakeClock {
  constructor() {
    this.now = 0;
    this.nextId = 1;
    this.tasks = new Map();
  }

  setTimeout(callback, delay) {
    assert.equal(typeof callback, 'function');
    assert.equal(Number.isSafeInteger(delay) && delay >= 0, true);
    const id = this.nextId;
    this.nextId += 1;
    this.tasks.set(id, { callback, dueAt: this.now + delay, id });
    return id;
  }

  clearTimeout(id) {
    this.tasks.delete(id);
  }

  pendingDelays() {
    return [...this.tasks.values()]
      .map((task) => task.dueAt - this.now)
      .sort((left, right) => left - right);
  }

  nextDueAt() {
    return (
      [...this.tasks.values()].map((task) => task.dueAt).sort((left, right) => left - right)[0] ??
      null
    );
  }

  elapseWithoutRunning(delay) {
    assert.equal(Number.isSafeInteger(delay) && delay >= 0, true);
    const target = this.now + delay;
    const nextDueAt = this.nextDueAt();
    assert.ok(
      nextDueAt === null || nextDueAt > target,
      'elapsed test time cannot skip a due lifecycle timer',
    );
    this.now = target;
  }

  runNext({ delayedBy = 0 } = {}) {
    const task = [...this.tasks.values()].sort(
      (left, right) => left.dueAt - right.dueAt || left.id - right.id,
    )[0];
    assert.ok(task, 'a scheduled lifecycle task is required');
    this.tasks.delete(task.id);
    this.now = Math.max(this.now, task.dueAt) + delayedBy;
    task.callback();
  }
}

class ListenerSignal {
  constructor() {
    this.listeners = [];
  }

  addListener(listener) {
    assert.equal(typeof listener, 'function');
    this.listeners.push(listener);
  }

  emit(value) {
    for (const listener of [...this.listeners]) listener(value);
  }
}

class TestPort {
  constructor(options = {}) {
    this.onMessage = new ListenerSignal();
    this.onDisconnect = new ListenerSignal();
    this.messages = [];
    this.disconnectCount = 0;
    this.disconnected = false;
    this.failAtPost = options.failAtPost ?? null;
    this.postAttempts = 0;
  }

  postMessage(message) {
    this.postAttempts += 1;
    if (this.postAttempts === this.failAtPost) throw new Error('PORT_POST_FAILED');
    assert.equal(this.disconnected, false, 'a disconnected lifecycle port cannot be reused');
    this.messages.push(message);
  }

  disconnect() {
    if (this.disconnected) return;
    this.disconnected = true;
    this.disconnectCount += 1;
    this.onDisconnect.emit();
  }

  receive(message) {
    assert.equal(this.disconnected, false, 'a disconnected lifecycle port receives no ACK');
    this.onMessage.emit(message);
  }

  remoteDisconnect() {
    if (this.disconnected) return;
    this.disconnected = true;
    this.onDisconnect.emit();
  }
}

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
    this.naturalWidth = 1;
    this.naturalHeight = 1;
    this.dataset = {};
    this.children = [];
    this.listeners = new Map();
    this.attributes = {};
    this.className = '';
  }

  get firstChild() {
    return this.children[0] || null;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type, event) {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

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
    skus: [
      {
        skuKey: 'sku-1',
        label: 'SKU 1',
        slots: [
          {
            slotKey: SLOT_KEY,
            role: 'HERO',
            prompt: 'White ceramic mug on a clean background',
            negativePrompt: 'watermark',
          },
        ],
      },
    ],
  };
}

function workspaceIntent(action, index = 1, overrides = {}) {
  const slotScoped = !['PAUSE_AFTER_CURRENT', 'CONTINUE'].includes(action);
  const attemptScoped = ['CANCEL_QUEUED', 'KEEP_ATTEMPT', 'REJECT_ATTEMPT'].includes(action);
  return {
    contractVersion: 'extension-byok-workbench-action-intent/v1',
    binding: bootstrap().binding,
    action,
    commandId: `byok-command:00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    expectedWorkspaceRevision: 2,
    expectedRuntimeRevision: 3,
    expectedSlotRevision: slotScoped ? 2 : null,
    slotKey: slotScoped ? SLOT_KEY : null,
    attemptId: attemptScoped ? ATTEMPT_ID : null,
    externalChargeAcknowledgement: action === 'REGENERATE_SLOT'
      ? { warningVersion: 'external-provider-charge/v1', confirmed: true }
      : null,
    ...overrides,
  };
}

function projection(options = {}) {
  const kept = options.kept === true;
  const ingestState = options.ingestState || 'NOT_STARTED';
  return {
    contractVersion: 'extension-byok-workbench-batch-coordinator/v1',
    executionMode: 'BYOK',
    revision: 3,
    scheduler: {
      state: ingestState === 'UNKNOWN_OUTCOME' ? 'FAILED' : 'REVIEW',
      activeCount: 0,
      queuedCount: 0,
      pauseRequested: false,
      effectiveConcurrency: 1,
    },
    billing: { erpGenerationChargeCents: 0 },
    slots: [
      {
        slotKey: SLOT_KEY,
        skuKey: 'sku-1',
        assignmentOrdinal: 0,
        operation: 'TEXT_TO_IMAGE',
        revision: 2,
        state: 'CANDIDATE_READY',
        selectedAttemptId: kept ? ATTEMPT_ID : null,
        selectedResultId: kept ? `br_${'a'.repeat(48)}` : null,
        attempts: [
          {
            attemptId: ATTEMPT_ID,
            generation: 1,
            operation: 'TEXT_TO_IMAGE',
            state: 'CANDIDATE_READY',
            resultId: `br_${'a'.repeat(48)}`,
            errorCode: null,
            retryOfAttemptId: null,
            externalChargePossible: true,
            retryRisk: null,
            chargeWarningVersion: 'external-provider-charge/v1',
            automaticRetryAllowed: false,
            recoveryRequirement: null,
            unknownOutcomeSuperseded: false,
            reviewState: kept ? 'KEPT' : 'AVAILABLE',
          },
        ],
      },
    ],
    ingest: {
      state: ingestState,
      replayed: null,
      receiptId: null,
      boundDraftRevision: null,
      boundDraftVersion: null,
      erpGenerationChargeCents: 0,
      rebootstrapRequired: false,
      errorCode: ingestState === 'UNKNOWN_OUTCOME' ? 'INGEST_OUTCOME_UNKNOWN' : null,
    },
  };
}

function emptyProjection() {
  return {
    contractVersion: 'extension-byok-workbench-batch-coordinator/v1',
    executionMode: 'BYOK',
    revision: 0,
    scheduler: null,
    billing: { erpGenerationChargeCents: 0 },
    slots: [],
    ingest: null,
  };
}

async function flushAsync(turns = 4) {
  for (let index = 0; index < turns; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function createHarness(options = {}) {
  const clock = new FakeClock();
  const ports = [];
  const connectInputs = [];
  const pageListeners = new Map();
  const documentListeners = new Map();
  const intentOutcomes = [];
  const calls = {
    state: [],
    start: [],
    command: [],
    openPreview: [],
    ingest: [],
    recover: [],
    clear: [],
  };
  const ids = [
    'profileSelect',
    'promptInput',
    'negativePromptInput',
    'sizeSelect',
    'generateButton',
    'batchStatus',
    'batchStateBadge',
    'batchSlotSelection',
    'batchConcurrency',
    'batchAcceptButton',
    'batchRecoverButton',
    'batchClearButton',
    'batchRecoveryList',
    'batchPreviewPanel',
    'batchPreviewImage',
    'batchPreviewMeta',
    'batchPreviewCloseButton',
  ];
  const nodes = Object.fromEntries(ids.map((id) => [id, new TestNode(id)]));
  nodes.profileSelect.value = 'profile-1';
  nodes.promptInput.value = 'White ceramic mug on a clean background';
  nodes.negativePromptInput.value = 'watermark';
  nodes.sizeSelect.value = '1024x1024';
  const activeProjection = projection(options.projection);
  const client = {
    async state(value) {
      calls.state.push(value);
      return emptyProjection();
    },
    async start(value) {
      calls.start.push(value);
      return activeProjection;
    },
    async command(value) {
      calls.command.push(value);
      return activeProjection;
    },
    async openPreview(value) {
      calls.openPreview.push(value);
      return {
        slotKey: SLOT_KEY,
        attemptId: ATTEMPT_ID,
        image: new Blob(['image'], { type: 'image/png' }),
        metadata: { mimeType: 'image/png', byteLength: 5, sha256: 'b'.repeat(64) },
      };
    },
    async ingest(value) {
      calls.ingest.push(value);
      return activeProjection;
    },
    async recover(value) {
      calls.recover.push(value);
      return activeProjection;
    },
    async clear(value) {
      calls.clear.push(value);
      return { cleared: true };
    },
  };
  const document = {
    body: new TestNode('body', 'body'),
    getElementById(id) {
      return nodes[id] || null;
    },
    createElement(tagName) {
      return new TestNode('', tagName);
    },
    addEventListener(type, listener) {
      const listeners = documentListeners.get(type) || [];
      listeners.push(listener);
      documentListeners.set(type, listeners);
    },
    dispatchEvent(event) {
      for (const listener of documentListeners.get(event.type) || []) listener(event);
      return true;
    },
  };
  document.addEventListener('ss-erp:workspace-intent-outcome', (event) => {
    intentOutcomes.push(event.detail);
  });
  const context = {
    ArrayBuffer,
    Blob,
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    TextEncoder,
    Uint8Array,
    URL: {
      createObjectURL() {
        return 'blob:unused';
      },
      revokeObjectURL() {},
    },
    chrome: {
      runtime: {
        connect(input) {
          connectInputs.push(input);
          const port = new TestPort(options.port);
          ports.push(port);
          return port;
        },
      },
    },
    clearTimeout(id) {
      clock.clearTimeout(id);
    },
    crypto: {
      randomUUID() {
        return '00000000-0000-4000-8000-000000000001';
      },
      subtle: {
        async digest() {
          return Uint8Array.from({ length: 32 }, (_value, index) => index).buffer;
        },
      },
    },
    document,
    setTimeout(callback, delay) {
      return clock.setTimeout(callback, delay);
    },
    addEventListener(type, listener) {
      const listeners = pageListeners.get(type) || [];
      listeners.push(listener);
      pageListeners.set(type, listeners);
    },
  };
  context.globalThis = context;
  context.self = context;
  context.SS_ERP_BYOK_WORKBENCH_BATCH_CLIENT = {
    createClient() {
      return client;
    },
  };
  context.SS_ERP_BYOK_WORKBENCH_WORKSPACE_EVENTS = {
    nextRuntimeRevision() {
      return 1;
    },
  };

  vm.runInNewContext(source, context, { filename: 'ai-image-workbench-batch.js' });
  const controller = context.SS_ERP_BYOK_WORKBENCH_BATCH_PAGE_CONTROLLER;
  assert.ok(controller, 'the real workbench page initializer must complete');
  context.document.dispatchEvent(
    new context.CustomEvent('ss-erp:workspace-bootstrap', {
      detail: bootstrap(),
    }),
  );
  await flushAsync();
  assert.equal(controller.isAvailable(), true);
  assert.equal(controller.getView().active, false);

  return {
    calls,
    clock,
    connectInputs,
    context,
    controller,
    document,
    nodes,
    intentOutcomes,
    ports,
    pagehide() {
      for (const listener of pageListeners.get('pagehide') || []) listener({ type: 'pagehide' });
    },
  };
}

function assertConnection(harness) {
  assert.equal(harness.connectInputs.length, 1);
  assert.equal(harness.connectInputs[0]?.name, PORT_NAME);
  assert.deepEqual(Object.keys(harness.connectInputs[0] || {}), ['name']);
  assert.equal(harness.ports.length, 1);
  return harness.ports[0];
}

function assertOnlyPublicPings(port, expectedCount) {
  assert.equal(port.messages.length, expectedCount);
  for (const message of port.messages) {
    assert.equal(typeof message, 'string');
    assert.equal(message, PING);
    assert.equal(/payload|secret|token|authorization|api.?key/iu.test(message), false);
  }
}

function assertLifecycleError(error) {
  return error?.code === UNAVAILABLE;
}

function assertPendingDelay(clock, delay, message) {
  assert.ok(clock.pendingDelays().includes(delay), message);
}

async function startWithAck(harness) {
  const pending = harness.controller.startFromPage();
  await flushAsync();
  const port = assertConnection(harness);
  assertOnlyPublicPings(port, 1);
  assert.equal(harness.calls.start.length, 0);
  assert.equal(harness.controller.isLifecycleReady(), false);
  assertPendingDelay(
    harness.clock,
    ACK_DEADLINE_MS,
    'the initial PING must retain its fixed ACK deadline',
  );
  port.receive(ACK);
  assert.equal(await pending, true);
  assert.equal(harness.calls.start.length, 1);
  assert.equal(harness.controller.isLifecycleReady(), true);
  assert.equal(harness.controller.getView().active, true);
  assertPendingDelay(
    harness.clock,
    HEARTBEAT_INTERVAL_MS,
    'the next heartbeat starts only after the fixed ACK',
  );
  return port;
}

test('idle page connects lazily and fixed ACK gates one Provider batch start', async () => {
  const harness = await createHarness();
  assert.equal(harness.connectInputs.length, 0, 'an idle workbench must not pin the worker');
  assert.equal(typeof harness.controller.isLifecycleReady, 'function');
  const port = await startWithAck(harness);

  harness.clock.runNext({ delayedBy: 45_000 });
  assertOnlyPublicPings(port, 2);
  assertPendingDelay(
    harness.clock,
    ACK_DEADLINE_MS,
    'a throttled timer sends once and awaits ACK instead of replaying missed heartbeats',
  );
  port.receive(ACK);
  assertPendingDelay(harness.clock, HEARTBEAT_INTERVAL_MS);

  await harness.controller.clear();
  assert.equal(harness.calls.clear.length, 1);
  assert.equal(harness.controller.getView().active, false);
  assert.equal(harness.controller.isLifecycleReady(), false);
  assert.equal(port.disconnected, true);
  assert.deepEqual(harness.clock.pendingDelays(), []);
});

test('active lifecycle keepalive expires fail-closed within twenty minutes', async () => {
  const harness = await createHarness();
  const pending = harness.controller.startFromPage();
  await flushAsync();
  const port = assertConnection(harness);
  assert.equal(harness.calls.start.length, 0);
  harness.clock.elapseWithoutRunning(ACK_DEADLINE_MS - 1_000);
  port.receive(ACK);
  assert.equal(await pending, true);
  assert.equal(harness.calls.start.length, 1);
  const deadline = MAX_LIFECYCLE_MS;
  let steps = 0;

  while (
    !port.disconnected &&
    harness.clock.nextDueAt() !== null &&
    harness.clock.nextDueAt() <= deadline
  ) {
    const priorMessages = port.messages.length;
    harness.clock.runNext();
    if (!port.disconnected && port.messages.length === priorMessages + 1) {
      port.receive(ACK);
    }
    steps += 1;
    assert.ok(steps <= 128, 'bounded keepalive must not create an unbounded timer loop');
  }

  assert.equal(port.disconnected, true);
  assert.equal(port.disconnectCount, 1);
  assert.ok(harness.clock.now <= deadline);
  assert.equal(harness.controller.isLifecycleReady(), false);
  assert.deepEqual(harness.clock.pendingDelays(), []);
  assert.equal(harness.calls.start.length, 1, 'keepalive expiry cannot dispatch another batch');
  assertOnlyPublicPings(port, port.messages.length);
});

test('pre-dispatch lifecycle failures reject stably without a batch client call', async (t) => {
  const cases = [
    ['missing ACK', {}, (harness) => harness.clock.runNext()],
    [
      'invalid ACK',
      {},
      (_harness, port) => {
        port.receive({ type: ACK, payload: 'must-not-be-accepted' });
      },
    ],
    ['remote disconnect', {}, (_harness, port) => port.remoteDisconnect()],
    ['initial send failure', { port: { failAtPost: 1 } }, () => {}],
  ];
  for (const [name, options, trigger] of cases) {
    await t.test(name, async () => {
      const harness = await createHarness(options);
      const pending = harness.controller.startFromPage();
      const rejection = assert.rejects(pending, assertLifecycleError);
      await flushAsync();
      const port = assertConnection(harness);
      trigger(harness, port);
      await rejection;
      assert.equal(harness.calls.start.length, 0);
      assert.equal(harness.controller.isLifecycleReady(), false);
      assert.equal(port.disconnected, true);
      assert.deepEqual(harness.clock.pendingDelays(), []);
    });
  }
});

test('pagehide and heartbeat send failure clean up an active lifecycle', async (t) => {
  await t.test('pagehide', async () => {
    const harness = await createHarness();
    const port = await startWithAck(harness);
    harness.pagehide();
    assert.equal(port.disconnected, true);
    assert.equal(port.disconnectCount, 1);
    assert.equal(harness.controller.isLifecycleReady(), false);
    assert.deepEqual(harness.clock.pendingDelays(), []);
  });

  await t.test('later send failure', async () => {
    const harness = await createHarness({ port: { failAtPost: 2 } });
    const port = await startWithAck(harness);
    harness.clock.runNext();
    assert.equal(port.disconnected, true);
    assert.equal(port.disconnectCount, 1);
    assert.equal(harness.controller.isLifecycleReady(), false);
    assert.deepEqual(harness.clock.pendingDelays(), []);
    assertOnlyPublicPings(port, 1);
  });
});

test('active lifecycle loss blocks preview and intent but still permits cleanup', async () => {
  const harness = await createHarness();
  const port = await startWithAck(harness);
  port.remoteDisconnect();
  assert.equal(harness.controller.isLifecycleReady(), false);

  harness.document.dispatchEvent(
    new harness.context.CustomEvent('ss-erp:workspace-action', {
      detail: {
        contractVersion: 'extension-byok-workbench-workspace-action/v1',
        action: 'PREVIEW_ATTEMPT',
        revision: 2,
        executionMode: 'BYOK',
        slotKey: SLOT_KEY,
        attemptId: ATTEMPT_ID,
      },
    }),
  );
  harness.document.dispatchEvent(
    new harness.context.CustomEvent('ss-erp:workspace-intent', {
      detail: workspaceIntent('KEEP_ATTEMPT'),
    }),
  );
  await flushAsync();
  assert.equal(harness.calls.openPreview.length, 0);
  assert.equal(harness.calls.command.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(harness.intentOutcomes)), [{
    contractVersion: 'extension-byok-workbench-action-outcome/v1',
    binding: bootstrap().binding,
    action: 'KEEP_ATTEMPT',
    commandId: 'byok-command:00000000-0000-4000-8000-000000000001',
    expectedWorkspaceRevision: 2,
    expectedRuntimeRevision: 3,
    expectedSlotRevision: 2,
    slotKey: SLOT_KEY,
    attemptId: ATTEMPT_ID,
    status: 'REJECTED',
    errorCode: UNAVAILABLE,
  }]);

  await harness.controller.clear();
  assert.equal(harness.calls.clear.length, 1, 'local cleanup remains available fail-closed');
});

test('lifecycle rejection is scoped to the exact active BYOK workspace owner', async (t) => {
  await t.test('inactive BYOK batch', async () => {
    const harness = await createHarness();
    harness.document.dispatchEvent(new harness.context.CustomEvent('ss-erp:workspace-intent', {
      detail: workspaceIntent('KEEP_ATTEMPT'),
    }));
    await flushAsync();
    assert.equal(harness.intentOutcomes.length, 0);
    assert.equal(harness.calls.command.length, 0);
  });

  await t.test('cross-binding and non-closed intent', async () => {
    const harness = await createHarness();
    const port = await startWithAck(harness);
    port.remoteDisconnect();
    harness.document.dispatchEvent(new harness.context.CustomEvent('ss-erp:workspace-intent', {
      detail: workspaceIntent('KEEP_ATTEMPT', 2, {
        binding: { ...bootstrap().binding, workflowId: 'workflow-other' },
      }),
    }));
    harness.document.dispatchEvent(new harness.context.CustomEvent('ss-erp:workspace-intent', {
      detail: { ...workspaceIntent('KEEP_ATTEMPT', 3), extra: true },
    }));
    const symbolExtended = workspaceIntent('KEEP_ATTEMPT', 4);
    symbolExtended[Symbol('extra')] = true;
    harness.document.dispatchEvent(new harness.context.CustomEvent('ss-erp:workspace-intent', {
      detail: symbolExtended,
    }));
    await flushAsync();
    assert.equal(harness.intentOutcomes.length, 0);
    assert.equal(harness.calls.command.length, 0);
  });

  await t.test('same-binding ERP hosted workspace', async () => {
    const harness = await createHarness();
    const port = await startWithAck(harness);
    port.remoteDisconnect();
    harness.document.dispatchEvent(new harness.context.CustomEvent('ss-erp:workspace-bootstrap', {
      detail: { ...bootstrap(), executionMode: 'ERP_HOSTED' },
    }));
    harness.document.dispatchEvent(new harness.context.CustomEvent('ss-erp:workspace-intent', {
      detail: workspaceIntent('KEEP_ATTEMPT', 5),
    }));
    await flushAsync();
    assert.equal(harness.intentOutcomes.length, 0,
      'the BYOK listener must not reject a hosted intent after hosted execution has started');
    assert.equal(harness.calls.command.length, 0);
  });
});

test('active BYOK lifecycle loss rejects every owned workspace intent without dispatch', async () => {
  const harness = await createHarness();
  const port = await startWithAck(harness);
  port.remoteDisconnect();
  const actions = [
    'PAUSE_AFTER_CURRENT', 'CONTINUE', 'CANCEL_QUEUED', 'KEEP_ATTEMPT',
    'REJECT_ATTEMPT', 'REGENERATE_SLOT',
  ];
  actions.forEach((action, index) => {
    harness.document.dispatchEvent(new harness.context.CustomEvent('ss-erp:workspace-intent', {
      detail: workspaceIntent(action, index + 10),
    }));
  });
  await flushAsync();
  assert.deepEqual(harness.intentOutcomes.map((outcome) => outcome.action), actions);
  assert.ok(harness.intentOutcomes.every((outcome) => (
    outcome.status === 'REJECTED' && outcome.errorCode === UNAVAILABLE
  )));
  assert.equal(harness.calls.command.length, 0);
});

test('active lifecycle loss blocks ingest and recovery UI actions', async (t) => {
  await t.test('ingest', async () => {
    const harness = await createHarness({ projection: { kept: true } });
    const port = await startWithAck(harness);
    assert.equal(harness.nodes.batchAcceptButton.disabled, false);
    port.remoteDisconnect();
    harness.nodes.batchAcceptButton.emit('click', { isTrusted: true });
    await flushAsync();
    assert.equal(harness.calls.ingest.length, 0);
  });

  await t.test('recovery', async () => {
    const harness = await createHarness({ projection: { ingestState: 'UNKNOWN_OUTCOME' } });
    const port = await startWithAck(harness);
    assert.equal(harness.nodes.batchRecoverButton.disabled, false);
    port.remoteDisconnect();
    harness.nodes.batchRecoverButton.emit('click', { isTrusted: true });
    await flushAsync();
    assert.equal(harness.calls.recover.length, 0);
  });
});
