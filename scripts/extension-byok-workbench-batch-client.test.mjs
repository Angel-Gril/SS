import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const modulePath = 'extensions/ss-erp/shared/byok/workbench-batch-client.js';
const NOW = Date.parse('2026-07-28T08:00:00.000Z');
const REQUEST_VERSION = 'extension-byok-workbench-batch-runtime-request/v1';
const START_VERSION = 'extension-byok-workbench-batch-user-start/v1';
const COMMAND_VERSION = 'extension-byok-workbench-batch-runtime-command/v1';
const INGEST_VERSION = 'extension-byok-workbench-batch-ingest/v1';
const COORDINATOR_VERSION = 'extension-byok-workbench-batch-coordinator/v1';
const PREVIEW_VERSION = 'extension-byok-workbench-preview-channel/v1';
const CANONICAL_BINI_SKU_KEY = 'sku:5777037825166|晚霞肤(1.5cm+4cm胸垫)>M(适合34/75ABC)';
const CANONICAL_BINI_SLOT_KEY = `sku:${CANONICAL_BINI_SKU_KEY}:hero`;

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadApi() {
  const context = {
    Array, Blob, Boolean, Date, Error, JSON, Map, Math, Number, Object, Promise,
    RegExp, Set, String, TypeError, URL, clearTimeout, queueMicrotask, setTimeout,
  };
  context.globalThis = context;
  vm.runInNewContext(readFileSync(modulePath, 'utf8'), context, { filename: modulePath });
  return context.SS_ERP_BYOK_WORKBENCH_BATCH_CLIENT;
}

function startInput(overrides = {}) {
  return {
    profileId: 'profile-1',
    requestedConcurrency: 1,
    slots: [
      {
        skuKey: 'sku-red', slotKey: 'sku:sku-red:hero', operation: 'TEXT_TO_IMAGE',
        providerIdempotencyKey: 'provider-attempt-0001', intentHash: '1'.repeat(64),
        prompt: 'Create a clean product hero image.', negativePrompt: null,
        size: '1024x1024',
      },
      {
        skuKey: 'sku-red', slotKey: 'shared:detail:DETAIL', operation: 'TEXT_TO_IMAGE',
        providerIdempotencyKey: 'provider-attempt-0002', intentHash: '2'.repeat(64),
        prompt: 'Show product construction details.', negativePrompt: 'No added text.',
        size: '1024x1024',
      },
    ],
    ...overrides,
  };
}

function attempt(index = 1, overrides = {}) {
  return {
    attemptId: `attempt-${index}`, generation: index, operation: 'TEXT_TO_IMAGE',
    state: 'CANDIDATE_READY', resultId: `result-${index}`, errorCode: null,
    retryOfAttemptId: null, externalChargePossible: false, retryRisk: null,
    chargeWarningVersion: null, automaticRetryAllowed: null, recoveryRequirement: null,
    unknownOutcomeSuperseded: false, reviewState: 'AVAILABLE',
    ...overrides,
  };
}

function assignment(index = 1) {
  return {
    slotKey: 'sku:sku-red:hero', skuKey: 'sku-red', assignmentOrdinal: 17,
    attemptId: `attempt-${index}`, resultId: `result-${index}`,
    assetId: `asset-${index}`, provenanceId: `provenance-${index}`,
    executionIntentId: `intent-${index}`, mimeType: 'image/png', width: 1024, height: 1024,
  };
}

function activeProjection(overrides = {}) {
  return {
    contractVersion: COORDINATOR_VERSION,
    executionMode: 'BYOK',
    revision: 4,
    scheduler: {
      state: 'REVIEW', activeCount: 0, queuedCount: 0,
      pauseRequested: false, effectiveConcurrency: 1,
    },
    billing: { erpGenerationChargeCents: 0 },
    slots: [{
      slotKey: 'sku:sku-red:hero', skuKey: 'sku-red', assignmentOrdinal: 17,
      operation: 'TEXT_TO_IMAGE', revision: 2, state: 'CANDIDATE_READY',
      selectedAttemptId: null, selectedResultId: null, attempts: [attempt()],
    }],
    ingest: {
      state: 'NOT_STARTED', idempotencyKey: null, replayed: null, receiptId: null,
      boundDraftRevision: null, boundDraftVersion: null, erpGenerationChargeCents: 0,
      rebootstrapRequired: false, assignments: [], errorCode: null,
    },
    ...overrides,
  };
}

function ingestedProjection() {
  return activeProjection({
    revision: 8,
    slots: [{
      slotKey: 'sku:sku-red:hero', skuKey: 'sku-red', assignmentOrdinal: 17,
      operation: 'TEXT_TO_IMAGE', revision: 3, state: 'CANDIDATE_READY',
      selectedAttemptId: 'attempt-1', selectedResultId: 'result-1',
      attempts: [attempt(1, { reviewState: 'KEPT' })],
    }],
    ingest: {
      state: 'SUCCEEDED', idempotencyKey: 'batch-ingest-000001', replayed: false,
      receiptId: 'receipt-1', boundDraftRevision: 8, boundDraftVersion: 12,
      erpGenerationChargeCents: 0, rebootstrapRequired: true,
      assignments: [assignment()], errorCode: null,
    },
  });
}

function emptyProjection() {
  return {
    contractVersion: COORDINATOR_VERSION, executionMode: 'BYOK', revision: 0,
    scheduler: null, billing: { erpGenerationChargeCents: 0 }, slots: [], ingest: null,
  };
}

function legacyProjection() {
  const projected = activeProjection();
  projected.batchId = 'execution-batch-private';
  projected.binding = {
    shopId: 'shop-private', workflowId: 'workflow-private',
    draftRevision: 7, draftVersion: 11, skuKey: 'sku-red',
  };
  projected.slots[0].attempts[0] = {
    ...projected.slots[0].attempts[0],
    intentHash: '3'.repeat(64), resultSha256: '4'.repeat(64),
  };
  projected.ingest = {
    state: 'NOT_STARTED', idempotencyKey: null, replayed: null, receiptId: null,
    requestHash: null, boundDraftRevision: null, boundDraftVersion: null,
    erpGenerationChargeCents: 0, rebootstrapRequired: false,
    receipt: null, assignments: [], errorCode: null,
  };
  return projected;
}

class FakeBroadcastChannel {
  static hooks = new Map();
  static instances = [];

  constructor(name) {
    this.name = name;
    this.onmessage = null;
    this.closed = false;
    FakeBroadcastChannel.instances.push(this);
  }

  postMessage(value) {
    FakeBroadcastChannel.hooks.get(this.name)?.(this, value);
  }

  close() {
    this.closed = true;
  }

  static reset() {
    this.hooks.clear();
    this.instances.length = 0;
  }
}

function previewTicket(suffix = 'a') {
  return {
    contractVersion: PREVIEW_VERSION,
    channelName: `ss-erp:byok-preview:${suffix.repeat(48)}`,
    previewTicket: `pt_${suffix.repeat(48)}`,
    expiresAt: new Date(NOW + 15_000).toISOString(),
    metadata: { mimeType: 'image/png', byteLength: 4, sha256: suffix.repeat(64) },
  };
}

function createRuntime(api, responseFor) {
  const messages = [];
  return {
    messages,
    runtime: {
      lastError: null,
      sendMessage(message, callback) {
        messages.push(message);
        queueMicrotask(() => callback(responseFor(message)));
      },
    },
  };
}

async function rejectsCode(value, code) {
  await assert.rejects(
    value,
    (error) => error?.name === 'ExtensionByokWorkbenchBatchClientError'
      && error?.code === code,
  );
}

function assertNoOrdinaryLeak(value) {
  if (value === null || ['boolean', 'number'].includes(typeof value)) return;
  if (typeof value === 'string') {
    assert.doesNotMatch(value, /(?:https?|ftp|file|blob|data):/iu);
    return;
  }
  assert.equal(value instanceof Blob, false, 'ordinary output must not expose a Blob');
  if (Array.isArray(value)) {
    value.forEach(assertNoOrdinaryLeak);
    return;
  }
  const forbidden = new Set([
    'batchid', 'binding', 'receipt', 'requesthash', 'intenthash', 'resultsha256',
    'providerorigin', 'providerendpoint', 'endpoint', 'model', 'apikey', 'secret',
  ]);
  for (const [key, child] of Object.entries(value)) {
    assert.equal(forbidden.has(key.toLowerCase().replace(/[^a-z0-9]/gu, '')), false, key);
    assertNoOrdinaryLeak(child);
  }
}

test('uses the seven registered messages and returns one strict sanitized state schema', async () => {
  FakeBroadcastChannel.reset();
  const api = loadApi();
  const ticket = previewTicket();
  const image = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });
  const fixture = createRuntime(api, (message) => {
    if (message.type === api.MESSAGE_TYPES.BATCH_STATE) {
      return { ok: true, data: legacyProjection() };
    }
    if (message.type === api.MESSAGE_TYPES.BATCH_PREVIEW) {
      return { ok: true, data: ticket };
    }
    if (message.type === api.MESSAGE_TYPES.BATCH_INGEST
      || message.type === api.MESSAGE_TYPES.BATCH_RECOVER) {
      return { ok: true, data: ingestedProjection() };
    }
    if (message.type === api.MESSAGE_TYPES.BATCH_CLEAR) {
      return { ok: true, data: { cleared: true } };
    }
    return { ok: true, data: activeProjection() };
  });
  const client = api.createClient({
    runtime: fixture.runtime,
    BroadcastChannel: FakeBroadcastChannel,
    now: () => new Date(NOW),
    timeoutMs: 1000,
  });

  assert.deepEqual(Object.keys(api.MESSAGE_TYPES), [
    'BATCH_STATE', 'BATCH_START', 'BATCH_COMMAND', 'BATCH_PREVIEW',
    'BATCH_INGEST', 'BATCH_RECOVER', 'BATCH_CLEAR',
  ]);
  assert.deepEqual(Object.keys(client), [
    'state', 'start', 'command', 'openPreview', 'ingest', 'recover', 'clear',
  ]);

  const state = await client.state();
  assert.deepEqual(Object.keys(state), [
    'contractVersion', 'executionMode', 'revision', 'scheduler', 'billing', 'slots', 'ingest',
  ]);
  assert.equal(state.contractVersion, COORDINATOR_VERSION);
  assertNoOrdinaryLeak(state);
  assert.equal(Object.isFrozen(state), true);
  assert.equal(Object.isFrozen(state.slots[0].attempts[0]), true);

  await client.start(startInput());
  const base = {
    commandId: 'command-1', expectedWorkspaceRevision: 12, expectedRuntimeRevision: 4,
  };
  await client.command({ kind: 'PAUSE_AFTER_CURRENT', ...base });
  await client.command({
    kind: 'KEEP_ATTEMPT', ...base, commandId: 'command-2',
    slotKey: 'sku:sku-red:hero', attemptId: 'attempt-1', expectedSlotRevision: 2,
  });
  const ingested = await client.ingest({ idempotencyKey: 'batch-ingest-000001' });
  const recovered = await client.recover({ idempotencyKey: 'batch-ingest-000001' });
  assert.deepEqual(plain(ingested.ingest), {
    state: 'SUCCEEDED', idempotencyKey: 'batch-ingest-000001', replayed: false,
    receiptId: 'receipt-1', boundDraftRevision: 8, boundDraftVersion: 12,
    erpGenerationChargeCents: 0, rebootstrapRequired: true,
    assignments: [assignment()], errorCode: null,
  });
  assert.deepEqual(plain(recovered), plain(ingested));
  assertNoOrdinaryLeak(ingested);
  assert.deepEqual(plain(await client.clear()), { cleared: true });

  FakeBroadcastChannel.hooks.set(ticket.channelName, (channel, ready) => {
    assert.deepEqual(plain(ready), { type: 'READY', previewTicket: ticket.previewTicket });
    channel.onmessage({
      data: {
        contractVersion: PREVIEW_VERSION, type: 'PREVIEW',
        previewTicket: ticket.previewTicket, image, metadata: ticket.metadata,
      },
    });
  });
  const preview = await client.openPreview({
    slotKey: 'sku:sku-red:hero', attemptId: 'attempt-1',
  });
  assert.equal(preview.image, image, 'openPreview is the only Blob-bearing result');
  assert.deepEqual(plain(preview.metadata), ticket.metadata);
  assert.equal(FakeBroadcastChannel.instances.at(-1).closed, true);
  assert.equal(FakeBroadcastChannel.instances.at(-1).onmessage, null);

  const messageTypes = fixture.messages.map((message) => message.type);
  assert.deepEqual(new Set(messageTypes), new Set(Object.values(api.MESSAGE_TYPES)));
  assert.deepEqual(plain(fixture.messages.find((message) => (
    message.type === api.MESSAGE_TYPES.BATCH_STATE
  ))), {
    type: api.MESSAGE_TYPES.BATCH_STATE,
    payload: { contractVersion: REQUEST_VERSION },
  });
  assert.deepEqual(plain(fixture.messages.find((message) => (
    message.type === api.MESSAGE_TYPES.BATCH_START
  )).payload), {
    contractVersion: REQUEST_VERSION,
    startRequest: { contractVersion: START_VERSION, ...startInput() },
  });
  assert.deepEqual(plain(fixture.messages.find((message) => (
    message.type === api.MESSAGE_TYPES.BATCH_COMMAND
  )).payload.command), {
    contractVersion: COMMAND_VERSION, kind: 'PAUSE_AFTER_CURRENT', ...base,
  });
  assert.deepEqual(plain(fixture.messages.find((message) => (
    message.type === api.MESSAGE_TYPES.BATCH_INGEST
  )).payload), {
    contractVersion: REQUEST_VERSION,
    ingestCommand: {
      contractVersion: INGEST_VERSION, idempotencyKey: 'batch-ingest-000001',
    },
  });
  assert.deepEqual(plain(fixture.messages.find((message) => (
    message.type === api.MESSAGE_TYPES.BATCH_RECOVER
  )).payload), {
    contractVersion: REQUEST_VERSION,
    ingestCommand: {
      contractVersion: INGEST_VERSION, idempotencyKey: 'batch-ingest-000001',
    },
  });
});

test('accepts the canonical Unicode SKU hero slot without relaxing profile identifiers', async () => {
  const api = loadApi();
  const unicodeProjection = activeProjection({
    slots: [{
      ...activeProjection().slots[0],
      skuKey: CANONICAL_BINI_SKU_KEY,
      slotKey: CANONICAL_BINI_SLOT_KEY,
    }],
  });
  const fixture = createRuntime(api, () => ({ ok: true, data: unicodeProjection }));
  const client = api.createClient({
    runtime: fixture.runtime,
    BroadcastChannel: FakeBroadcastChannel,
    now: () => new Date(NOW),
    timeoutMs: 1000,
  });
  const input = startInput({
    slots: [{
      ...startInput().slots[0],
      skuKey: CANONICAL_BINI_SKU_KEY,
      slotKey: CANONICAL_BINI_SLOT_KEY,
    }],
  });

  const result = await client.start(input);
  assert.equal(result.slots[0].slotKey, CANONICAL_BINI_SLOT_KEY);
  assert.equal(fixture.messages[0].payload.startRequest.slots[0].slotKey,
    CANONICAL_BINI_SLOT_KEY);
  await client.command({
    kind: 'KEEP_ATTEMPT', commandId: 'command-unicode-slot',
    expectedWorkspaceRevision: 4, expectedRuntimeRevision: 2,
    expectedSlotRevision: 2, slotKey: CANONICAL_BINI_SLOT_KEY, attemptId: 'attempt-1',
  });
  await rejectsCode(client.start({ ...input, profileId: '档案-1' }),
    'SS_ERP_BYOK_BATCH_CLIENT_INPUT_INVALID');
});

test('rejects secret, binary, URL, binding, batch, and Provider identity page inputs', async () => {
  const api = loadApi();
  const fixture = createRuntime(api, () => ({ ok: true, data: activeProjection() }));
  const client = api.createClient({
    runtime: fixture.runtime, BroadcastChannel: FakeBroadcastChannel,
    now: () => new Date(NOW), timeoutMs: 1000,
  });
  const invalidStarts = [
    ...[2, 3, 4].map((requestedConcurrency) => startInput({ requestedConcurrency })),
    { ...startInput(), batchId: 'batch-private' },
    { ...startInput(), binding: { shopId: 'shop-private' } },
    { ...startInput(), model: 'provider-model-private' },
    { ...startInput(), apiKey: 'sk-1234567890abcdefghijklmnop' },
    { ...startInput(), image: new Blob(['private']) },
    startInput({ slots: [{
      ...startInput().slots[0], prompt: 'Read https://private.example before generation.',
    }] }),
    startInput({ slots: [{
      ...startInput().slots[0],
      prompt: 'Use this credential sk-1234567890abcdefghijklmnop for generation.',
    }] }),
  ];
  for (const value of invalidStarts) {
    await rejectsCode(
      client.start(value),
      'SS_ERP_BYOK_BATCH_CLIENT_INPUT_INVALID',
    );
  }
  await rejectsCode(
    client.command({
      kind: 'CONTINUE', commandId: 'command-1', expectedWorkspaceRevision: 2,
      expectedRuntimeRevision: 3, providerOrigin: 'https://provider.example',
    }),
    'SS_ERP_BYOK_BATCH_CLIENT_INPUT_INVALID',
  );
  await rejectsCode(
    client.openPreview({
      slotKey: 'sku:sku-red:hero', attemptId: 'attempt-1', image: new Blob(['private']),
    }),
    'SS_ERP_BYOK_BATCH_CLIENT_INPUT_INVALID',
  );
  await rejectsCode(client.state({ apiKey: 'private' }), 'SS_ERP_BYOK_BATCH_CLIENT_INPUT_INVALID');
  await rejectsCode(client.clear({ batchId: 'private' }), 'SS_ERP_BYOK_BATCH_CLIENT_INPUT_INVALID');
  assert.equal(fixture.messages.length, 0, 'invalid page values never reach runtime messaging');
});

test('encodes every closed command variant exactly as the runtime-handler contract', async () => {
  const api = loadApi();
  const fixture = createRuntime(api, () => ({ ok: true, data: activeProjection() }));
  const client = api.createClient({
    runtime: fixture.runtime, BroadcastChannel: FakeBroadcastChannel,
    now: () => new Date(NOW), timeoutMs: 1000,
  });
  const common = {
    expectedWorkspaceRevision: 12, expectedRuntimeRevision: 4,
  };
  const slot = {
    slotKey: 'sku:sku-red:hero', attemptId: 'attempt-1', expectedSlotRevision: 2,
  };
  const charge = {
    warningVersion: 'external-provider-charge/v1', confirmed: true,
  };
  const duplicateCharge = {
    strategy: 'DUPLICATE_CHARGE_CONFIRMATION',
    warningVersion: 'external-provider-duplicate-charge/v1', confirmed: true,
  };
  const commands = [
    { kind: 'PAUSE_AFTER_CURRENT', commandId: 'command-1', ...common },
    { kind: 'CONTINUE', commandId: 'command-2', ...common },
    { kind: 'CANCEL_QUEUED', commandId: 'command-3', ...common, ...slot },
    { kind: 'KEEP_ATTEMPT', commandId: 'command-4', ...common, ...slot },
    { kind: 'REJECT_ATTEMPT', commandId: 'command-5', ...common, ...slot },
    {
      kind: 'REGENERATE_SLOT', commandId: 'command-6', ...common,
      slotKey: slot.slotKey, expectedSlotRevision: slot.expectedSlotRevision,
      externalChargeAcknowledgement: charge,
    },
    {
      kind: 'RETRY_ATTEMPT', commandId: 'command-7', ...common, ...slot,
      externalChargeAcknowledgement: charge,
    },
    {
      kind: 'RETRY_ATTEMPT', commandId: 'command-8', ...common, ...slot,
      unknownOutcomeRecovery: duplicateCharge,
    },
    { kind: 'RESOLVE_UNKNOWN_ATTEMPT', commandId: 'command-9', ...common, ...slot },
  ];
  for (const command of commands) await client.command(command);
  assert.deepEqual(
    plain(fixture.messages.map((message) => message.payload)),
    commands.map((command) => ({
      contractVersion: REQUEST_VERSION,
      command: { contractVersion: COMMAND_VERSION, ...command },
    })),
  );

  await rejectsCode(client.command({
    kind: 'RETRY_ATTEMPT', commandId: 'command-10', ...common, ...slot,
    externalChargeAcknowledgement: charge, unknownOutcomeRecovery: duplicateCharge,
  }), 'SS_ERP_BYOK_BATCH_CLIENT_INPUT_INVALID');
  assert.equal(fixture.messages.length, commands.length);
});

test('rejects non-exact or leaking ordinary responses instead of projecting them', async () => {
  const api = loadApi();
  for (const data of [
    { ...activeProjection(), providerOrigin: 'https://provider.example' },
    { ...activeProjection(), model: 'private-model' },
    activeProjection({ slots: [{
      ...activeProjection().slots[0], skuKey: 'https://private.example/sku',
    }] }),
    { ...activeProjection(), privateBlob: new Blob(['private']) },
  ]) {
    const fixture = createRuntime(api, () => ({ ok: true, data }));
    const client = api.createClient({
      runtime: fixture.runtime, BroadcastChannel: FakeBroadcastChannel,
      now: () => new Date(NOW), timeoutMs: 1000,
    });
    await rejectsCode(client.state(), 'SS_ERP_BYOK_BATCH_CLIENT_RESPONSE_INVALID');
  }

  const failure = createRuntime(api, () => ({
    ok: false, errorCode: 'SS_ERP_BYOK_BATCH_REGISTRY_NOT_STARTED',
    error: 'BYOK batch workbench operation failed',
    outcome: 'FAILED_FINAL', automaticRetryAllowed: false,
  }));
  const client = api.createClient({
    runtime: failure.runtime, BroadcastChannel: FakeBroadcastChannel,
    now: () => new Date(NOW), timeoutMs: 1000,
  });
  await rejectsCode(client.state(), 'SS_ERP_BYOK_BATCH_REGISTRY_NOT_STARTED');
});

test('preserves an explicit unresolved Registry outcome across the runtime boundary', async () => {
  const api = loadApi();
  const failure = createRuntime(api, () => ({
    ok: false,
    errorCode: 'SS_ERP_BYOK_BATCH_REGISTRY_START_UNRESOLVED',
    error: 'BYOK batch workbench operation failed',
    outcome: 'UNKNOWN_OUTCOME',
    automaticRetryAllowed: false,
  }));
  const client = api.createClient({
    runtime: failure.runtime, BroadcastChannel: FakeBroadcastChannel,
    now: () => new Date(NOW), timeoutMs: 1000,
  });
  await assert.rejects(
    client.state(),
    (error) => error?.code === 'SS_ERP_BYOK_BATCH_REGISTRY_START_UNRESOLVED'
      && error?.outcome === 'UNKNOWN_OUTCOME'
      && error?.automaticRetryAllowed === false,
  );
});

test('consumes preview tickets once and closes channels on invalid data and timeout', async () => {
  FakeBroadcastChannel.reset();
  const api = loadApi();
  const ticket = previewTicket('b');
  const image = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' });
  const fixture = createRuntime(api, () => ({ ok: true, data: ticket }));
  const client = api.createClient({
    runtime: fixture.runtime, BroadcastChannel: FakeBroadcastChannel,
    now: () => new Date(NOW), timeoutMs: 20,
  });
  FakeBroadcastChannel.hooks.set(ticket.channelName, (channel) => {
    channel.onmessage({
      data: {
        contractVersion: PREVIEW_VERSION, type: 'PREVIEW',
        previewTicket: ticket.previewTicket, image, metadata: ticket.metadata,
      },
    });
  });
  await client.openPreview({ slotKey: 'sku:sku-red:hero', attemptId: 'attempt-1' });
  await rejectsCode(
    client.openPreview({ slotKey: 'sku:sku-red:hero', attemptId: 'attempt-1' }),
    'SS_ERP_BYOK_BATCH_CLIENT_PREVIEW_INVALID',
  );
  assert.equal(FakeBroadcastChannel.instances.length, 1, 'a replayed ticket opens no channel');

  const invalidTicket = previewTicket('c');
  const invalidRuntime = createRuntime(api, () => ({ ok: true, data: invalidTicket }));
  const invalidClient = api.createClient({
    runtime: invalidRuntime.runtime, BroadcastChannel: FakeBroadcastChannel,
    now: () => new Date(NOW), timeoutMs: 20,
  });
  FakeBroadcastChannel.hooks.set(invalidTicket.channelName, (channel) => {
    channel.onmessage({
      data: {
        contractVersion: PREVIEW_VERSION, type: 'PREVIEW',
        previewTicket: invalidTicket.previewTicket,
        image: new Blob(['wrong-size'], { type: 'image/png' }), metadata: invalidTicket.metadata,
      },
    });
  });
  await rejectsCode(
    invalidClient.openPreview({ slotKey: 'sku:sku-red:hero', attemptId: 'attempt-1' }),
    'SS_ERP_BYOK_BATCH_CLIENT_PREVIEW_INVALID',
  );
  assert.equal(FakeBroadcastChannel.instances.at(-1).closed, true);
  assert.equal(FakeBroadcastChannel.instances.at(-1).onmessage, null);

  const timeoutTicket = previewTicket('d');
  const timeoutRuntime = createRuntime(api, () => ({ ok: true, data: timeoutTicket }));
  const timeoutClient = api.createClient({
    runtime: timeoutRuntime.runtime, BroadcastChannel: FakeBroadcastChannel,
    now: () => new Date(NOW), timeoutMs: 5,
  });
  await rejectsCode(
    timeoutClient.openPreview({ slotKey: 'sku:sku-red:hero', attemptId: 'attempt-1' }),
    'SS_ERP_BYOK_BATCH_CLIENT_PREVIEW_TIMEOUT',
  );
  assert.equal(FakeBroadcastChannel.instances.at(-1).closed, true);
  assert.equal(FakeBroadcastChannel.instances.at(-1).onmessage, null);
});

test('bounds runtime waits and classifies uncertain start and ingest outcomes', async () => {
  const api = loadApi();
  const runtime = {
    lastError: null,
    sendMessage() {},
  };
  const client = api.createClient({
    runtime, BroadcastChannel: FakeBroadcastChannel,
    now: () => new Date(NOW), timeoutMs: 5,
  });
  await assert.rejects(
    client.start(startInput()),
    (error) => error?.code === 'SS_ERP_BYOK_BATCH_CLIENT_START_TIMEOUT'
      && error?.outcome === 'UNKNOWN_OUTCOME' && error?.automaticRetryAllowed === false,
  );
  await assert.rejects(
    client.ingest({ idempotencyKey: 'batch-ingest-000001' }),
    (error) => error?.code === 'SS_ERP_BYOK_BATCH_CLIENT_INGEST_TIMEOUT'
      && error?.outcome === 'UNKNOWN_OUTCOME' && error?.automaticRetryAllowed === false,
  );
  await rejectsCode(client.state(), 'SS_ERP_BYOK_BATCH_CLIENT_RUNTIME_TIMEOUT');
});

test('rejects invalid dependencies and accepts the exact empty state', async () => {
  const api = loadApi();
  assert.throws(
    () => api.createClient({ runtime: {}, BroadcastChannel: FakeBroadcastChannel }),
    (error) => error?.code === 'SS_ERP_BYOK_BATCH_CLIENT_DEPENDENCY_UNAVAILABLE',
  );
  assert.throws(
    () => api.createClient({
      runtime: { sendMessage() {} }, BroadcastChannel: FakeBroadcastChannel,
      apiKey: 'not-an-option',
    }),
    (error) => error?.code === 'SS_ERP_BYOK_BATCH_CLIENT_DEPENDENCY_UNAVAILABLE',
  );
  const fixture = createRuntime(api, () => ({ ok: true, data: emptyProjection() }));
  const client = api.createClient({
    runtime: fixture.runtime, BroadcastChannel: FakeBroadcastChannel,
    now: () => new Date(NOW), timeoutMs: 1000,
  });
  assert.deepEqual(plain(await client.state()), emptyProjection());
});
