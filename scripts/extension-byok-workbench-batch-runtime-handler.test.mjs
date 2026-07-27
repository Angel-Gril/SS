import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const modulePath = 'extensions/ss-erp/shared/byok/workbench-batch-runtime-handler.js';
const context = {
  Array, ArrayBuffer, Blob, Boolean, Date, Error, Map, Math, Number, Object, Promise,
  Set, String, URL, Uint8Array, WeakSet,
};
context.globalThis = context;
vm.runInNewContext(readFileSync(modulePath, 'utf8'), context, { filename: modulePath });
const api = context.SS_ERP_BYOK_WORKBENCH_BATCH_RUNTIME_HANDLER;

const MESSAGE_TYPES = Object.freeze({
  BATCH_STATE: 'batch-state',
  BATCH_START: 'batch-start',
  BATCH_COMMAND: 'batch-command',
  BATCH_PREVIEW: 'batch-preview',
  BATCH_INGEST: 'batch-ingest',
  BATCH_RECOVER: 'batch-recover',
  BATCH_CLEAR: 'batch-clear',
});
const sender = Object.freeze({ tabId: 77, documentId: 'document-1', frameId: 0 });
const request = (value = {}) => ({ contractVersion: api.REQUEST_VERSION, ...value });
const hash = (character) => character.repeat(64);

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function startRequest(overrides = {}) {
  const slots = [
    {
      skuKey: 'sku-1',
      slotKey: 'sku:sku-1:hero',
      operation: 'TEXT_TO_IMAGE',
      providerIdempotencyKey: 'provider-attempt-0001',
      intentHash: hash('a'),
      prompt: 'Create a factual white ceramic mug product image.',
      negativePrompt: null,
      size: '1024x1024',
    },
    {
      skuKey: 'sku-1',
      slotKey: 'shared:detail:SCENE',
      operation: 'TEXT_TO_IMAGE',
      providerIdempotencyKey: 'provider-attempt-0002',
      intentHash: hash('b'),
      prompt: 'Create a factual lifestyle scene for the same ceramic mug.\nKeep product facts.',
      negativePrompt: 'No logos or invented accessories.',
      size: '1024x1024',
    },
  ];
  return {
    contractVersion: 'extension-byok-workbench-batch-user-start/v1',
    profileId: 'profile-1',
    requestedConcurrency: 1,
    slots,
    ...overrides,
  };
}

function ingestCommand(overrides = {}) {
  return {
    contractVersion: 'extension-byok-workbench-batch-ingest/v1',
    idempotencyKey: 'batch-ingest-idempotency-0001',
    ...overrides,
  };
}

function command(kind, values = {}) {
  return {
    contractVersion: api.COMMAND_VERSION,
    kind,
    commandId: `command-${kind.toLowerCase().replaceAll('_', '-')}`,
    expectedWorkspaceRevision: 9,
    expectedRuntimeRevision: 4,
    ...values,
  };
}

function fixture(options = {}) {
  const calls = [];
  const result = () => ({
    contractVersion: 'extension-byok-workbench-batch-public-fixture/v1',
    revision: 4,
    state: 'READY',
  });
  const registry = {
    async state(owner) { calls.push(['state', owner]); return result(); },
    async start(owner, value) { calls.push(['start', owner, value]); return result(); },
    async command(owner, value) { calls.push(['command', owner, value]); return result(); },
    async openPreview(owner, value) {
      calls.push(['openPreview', owner, value]);
      return {
        contractVersion: 'extension-byok-workbench-preview-channel/v1',
        channelName: 'ss-erp:byok-preview:abc',
        previewTicket: 'pt_abc',
        expiresAt: '2026-07-28T10:00:00.000Z',
        metadata: { mimeType: 'image/png', byteLength: 68, sha256: hash('e') },
      };
    },
    async ingest(owner, value) { calls.push(['ingest', owner, value]); return result(); },
    async recover(owner, value) { calls.push(['recover', owner, value]); return result(); },
    async clear(owner) { calls.push(['clear', owner]); },
    ...options.registry,
  };
  return {
    calls,
    registry,
    dispatcher: api.createDispatcher({ messageTypes: MESSAGE_TYPES, registry }),
  };
}

async function rejected(handler, handlerContext, errorCode) {
  const value = await handler(handlerContext);
  assert.deepEqual(plain(value), {
    ok: false,
    errorCode,
    error: 'BYOK batch workbench operation failed',
    outcome: 'FAILED_FINAL',
    automaticRetryAllowed: false,
  });
  assert.equal(Object.isFrozen(value), true);
  return value;
}

{
  const test = fixture({
    registry: {
      async state() {
        throw Object.assign(new Error('startup unresolved'), {
          code: 'SS_ERP_BYOK_BATCH_REGISTRY_START_UNRESOLVED',
          outcome: 'UNKNOWN_OUTCOME',
          automaticRetryAllowed: false,
        });
      },
    },
  });
  const response = await test.dispatcher.handlers[MESSAGE_TYPES.BATCH_STATE]({
    sender,
    payload: request(),
  });
  assert.deepEqual(plain(response), {
    ok: false,
    errorCode: 'SS_ERP_BYOK_BATCH_REGISTRY_START_UNRESOLVED',
    error: 'BYOK batch workbench operation failed',
    outcome: 'UNKNOWN_OUTCOME',
    automaticRetryAllowed: false,
  });
}

assert.equal(
  api.CONTRACT_VERSION,
  'extension-byok-workbench-batch-runtime-handler/v1',
);
assert.equal(api.REQUEST_VERSION, 'extension-byok-workbench-batch-runtime-request/v1');
assert.equal(api.COMMAND_VERSION, 'extension-byok-workbench-batch-runtime-command/v1');
assert.deepEqual([...api.MESSAGE_TYPE_NAMES], Object.keys(MESSAGE_TYPES));
assert.equal(Object.isFrozen(api), true);
assert.equal(Object.isFrozen(api.MESSAGE_TYPE_NAMES), true);
assert.equal(Object.isFrozen(api.COMMAND_KINDS), true);
assert.deepEqual([...api.COMMAND_KINDS], [
  'PAUSE_AFTER_CURRENT', 'CONTINUE', 'CANCEL_QUEUED', 'KEEP_ATTEMPT',
  'REJECT_ATTEMPT', 'REGENERATE_SLOT', 'RETRY_ATTEMPT', 'RESOLVE_UNKNOWN_ATTEMPT',
]);

{
  const test = fixture();
  const state = await test.dispatcher.handlers[MESSAGE_TYPES.BATCH_STATE]({
    sender,
    payload: request(),
  });
  assert.deepEqual(plain(state), {
    ok: true,
    data: {
      contractVersion: 'extension-byok-workbench-batch-public-fixture/v1',
      revision: 4,
      state: 'READY',
    },
  });
  assert.equal(Object.isFrozen(state), true);
  assert.deepEqual(plain(test.calls[0]), [
    'state', { tabId: 77, documentId: 'document-1' },
  ]);

  await test.dispatcher.handlers[MESSAGE_TYPES.BATCH_START]({
    sender,
    payload: request({ startRequest: startRequest() }),
  });
  assert.equal(test.calls[1][0], 'start');
  assert.deepEqual(plain(test.calls[1][1]), { tabId: 77, documentId: 'document-1' });
  assert.equal(Object.isFrozen(test.calls[1][1]), true);
  assert.equal(Object.isFrozen(test.calls[1][2]), true);
  assert.equal(Object.isFrozen(test.calls[1][2].slots), true);
  assert.equal(test.calls[1][2].slots.length, 2);
  assert.deepEqual(plain(test.calls[1][2]), {
    ...startRequest(),
    contractVersion: 'extension-byok-workbench-batch-start-request/v1',
  });
  assert.equal(JSON.stringify(test.calls[1][2]).includes('dispatchRef'), false);
  assert.equal(JSON.stringify(test.calls[1][2]).includes('providerOrigin'), false);

  await test.dispatcher.handlers[MESSAGE_TYPES.BATCH_PREVIEW]({
    sender,
    payload: request({ slotKey: 'sku:sku-1:hero', attemptId: 'attempt-000001' }),
  });
  assert.deepEqual(plain(test.calls[2]), [
    'openPreview',
    { tabId: 77, documentId: 'document-1' },
    { slotKey: 'sku:sku-1:hero', attemptId: 'attempt-000001' },
  ]);

  await test.dispatcher.handlers[MESSAGE_TYPES.BATCH_INGEST]({
    sender,
    payload: request({ ingestCommand: ingestCommand() }),
  });
  await test.dispatcher.handlers[MESSAGE_TYPES.BATCH_RECOVER]({
    sender,
    payload: request({ ingestCommand: ingestCommand() }),
  });
  await test.dispatcher.handlers[MESSAGE_TYPES.BATCH_CLEAR]({
    sender,
    payload: request(),
  });
  assert.deepEqual(test.calls.slice(3).map((call) => call[0]), ['ingest', 'recover', 'clear']);
  assert.deepEqual(plain(test.calls[3][2]), ingestCommand());
}

{
  const test = fixture();
  const longPlainPrompt = 'A'.repeat(256);
  const value = startRequest({
    slots: [{
      ...startRequest().slots[0],
      prompt: longPlainPrompt,
    }],
  });
  const response = await test.dispatcher.handlers[MESSAGE_TYPES.BATCH_START]({
    sender,
    payload: request({ startRequest: value }),
  });
  assert.equal(response.ok, true);
  assert.equal(test.calls[0][2].slots[0].prompt, longPlainPrompt);
}

{
  const test = fixture();
  const commands = [
    command('PAUSE_AFTER_CURRENT'),
    command('CONTINUE'),
    command('CANCEL_QUEUED', {
      slotKey: 'sku:sku-1:hero', attemptId: 'attempt-000001', expectedSlotRevision: 3,
    }),
    command('KEEP_ATTEMPT', {
      slotKey: 'sku:sku-1:hero', attemptId: 'attempt-000001', expectedSlotRevision: 3,
    }),
    command('REJECT_ATTEMPT', {
      slotKey: 'shared:detail:SCENE', attemptId: 'attempt-000002', expectedSlotRevision: 4,
    }),
    command('REGENERATE_SLOT', {
      slotKey: 'sku:sku-1:hero',
      expectedSlotRevision: 3,
      externalChargeAcknowledgement: {
        warningVersion: 'external-provider-charge/v1',
        confirmed: true,
      },
    }),
    command('RETRY_ATTEMPT', {
      slotKey: 'sku:sku-1:hero',
      attemptId: 'attempt-000001',
      expectedSlotRevision: 4,
      externalChargeAcknowledgement: {
        warningVersion: 'external-provider-charge/v1',
        confirmed: true,
      },
    }),
    command('RETRY_ATTEMPT', {
      slotKey: 'shared:detail:SCENE',
      attemptId: 'attempt-000002',
      expectedSlotRevision: 5,
      unknownOutcomeRecovery: {
        strategy: 'DUPLICATE_CHARGE_CONFIRMATION',
        warningVersion: 'external-provider-duplicate-charge/v1',
        confirmed: true,
      },
    }),
    command('RESOLVE_UNKNOWN_ATTEMPT', {
      slotKey: 'shared:detail:SCENE',
      attemptId: 'attempt-000004',
      expectedSlotRevision: 6,
    }),
  ];
  for (const value of commands) {
    const response = await test.dispatcher.handlers[MESSAGE_TYPES.BATCH_COMMAND]({
      sender,
      payload: request({ command: value }),
    });
    assert.equal(response.ok, true);
  }
  assert.equal(test.calls.length, commands.length);
  assert.deepEqual(test.calls.map((call) => call[2].kind), [
    'PAUSE', 'CONTINUE', 'CANCEL_QUEUED', 'KEEP', 'REJECT',
    'REGENERATE', 'RETRY', 'RETRY', 'RESOLVE_UNKNOWN',
  ]);
  assert.deepEqual(plain(test.calls[5][2].chargeAcknowledgement), {
    warningVersion: 'external-provider-charge/v1',
    confirmed: true,
  });
  assert.equal(Object.hasOwn(test.calls[5][2], 'externalChargeAcknowledgement'), false);
  test.calls.forEach((call) => {
    assert.deepEqual(plain(call[1]), { tabId: 77, documentId: 'document-1' });
    assert.equal(Object.isFrozen(call[2]), true);
    assert.equal(JSON.stringify(call[2]).includes('dispatchRef'), false);
    assert.equal(JSON.stringify(call[2]).includes('recoveryRef'), false);
  });
}

{
  const test = fixture();
  await test.dispatcher.handlers[MESSAGE_TYPES.BATCH_STATE]({
    sender: { ...sender, documentId: 'document-2' },
    payload: request(),
  });
  await test.dispatcher.handlers[MESSAGE_TYPES.BATCH_STATE]({
    sender: { ...sender, tabId: 78, documentId: 'document-1' },
    payload: request(),
  });
  assert.deepEqual(test.calls.map((call) => plain(call[1])), [
    { tabId: 77, documentId: 'document-2' },
    { tabId: 78, documentId: 'document-1' },
  ]);
}

{
  const test = fixture();
  for (const badSender of [
    {}, { tabId: -1, documentId: 'document-1' },
    { tabId: 77 }, { tabId: 77, documentId: '' },
    { tabId: 77, documentId: ' document-1' },
    { tabId: 77, documentId: 'https://host.example/document' },
  ]) {
    await rejected(
      test.dispatcher.handlers[MESSAGE_TYPES.BATCH_STATE],
      { sender: badSender, payload: request() },
      'SS_ERP_BYOK_BATCH_RUNTIME_SENDER_DENIED',
    );
  }
  assert.equal(test.calls.length, 0);
}

{
  const test = fixture();
  const invalidPayloads = [
    {},
    { ...request(), extra: true },
    { ...request(), apiKey: 'sk-' + 'x'.repeat(32) },
    request({ startRequest: {
      ...startRequest(), slots: new Array(5).fill(startRequest().slots[0]),
    } }),
    ...[2, 3, 4].map((requestedConcurrency) => request({
      startRequest: startRequest({ requestedConcurrency }),
    })),
    request({ startRequest: startRequest({ requestedConcurrency: 5 }) }),
    request({ startRequest: {
      ...startRequest(), batchId: 'caller-controlled-batch',
    } }),
    request({ startRequest: {
      ...startRequest(), binding: { providerOrigin: 'https://provider.example' },
    } }),
    request({ startRequest: startRequest({ profileId: 'SK-' + 'X'.repeat(32) }) }),
    request({ startRequest: startRequest({
      slots: startRequest().slots.map((slot, index) => index === 0
        ? { ...slot, operation: 'IMAGE_TO_IMAGE' }
        : slot),
    }) }),
    request({ startRequest: startRequest({
      slots: startRequest().slots.map((slot, index) => index === 0
        ? { ...slot, dispatchRef: 'caller-dispatch-ref' }
        : slot),
    }) }),
    request({ startRequest: startRequest({
      slots: startRequest().slots.map((slot, index) => index === 0
        ? { ...slot, requestHash: hash('f') }
        : slot),
    }) }),
    request({ startRequest: startRequest({
      slots: startRequest().slots.map((slot, index) => index === 0
        ? { ...slot, prompt: 'x'.repeat(8001) }
        : slot),
    }) }),
    request({ startRequest: startRequest({
      slots: startRequest().slots.map((slot, index) => index === 0
        ? { ...slot, negativePrompt: 'x'.repeat(4001) }
        : slot),
    }) }),
    request({ startRequest: startRequest({
      slots: startRequest().slots.map((slot, index) => index === 0
        ? { ...slot, prompt: 'data:image/png;base64,AAAA' }
        : slot),
    }) }),
    request({ startRequest: startRequest({
      slots: startRequest().slots.map((slot, index) => index === 0
        ? { ...slot, size: '4097x1' }
        : slot),
    }) }),
    request({ startRequest: new Uint8Array([1, 2, 3]) }),
    request({ startRequest: new Blob(['secret']) }),
    request({ command: command('PAUSE_AFTER_CURRENT', { authorization: 'Bearer hidden' }) }),
  ];
  for (const payload of invalidPayloads) {
    const type = Object.hasOwn(payload, 'startRequest')
      ? MESSAGE_TYPES.BATCH_START
      : Object.hasOwn(payload, 'command')
        ? MESSAGE_TYPES.BATCH_COMMAND
        : MESSAGE_TYPES.BATCH_STATE;
    await rejected(
      test.dispatcher.handlers[type],
      { sender, payload },
      'SS_ERP_BYOK_BATCH_RUNTIME_INPUT_INVALID',
    );
  }
  assert.equal(test.calls.length, 0);
}

{
  const test = fixture();
  const invalidCommands = [
    command('UNKNOWN'),
    command('PAUSE_AFTER_CURRENT', { attemptId: 'extra' }),
    command('KEEP_ATTEMPT', {
      slotKey: 'invalid-slot', attemptId: 'attempt-1', expectedSlotRevision: 3,
    }),
    command('REGENERATE_SLOT', {
      slotKey: 'sku:sku-1:hero',
      expectedSlotRevision: 3,
      externalChargeAcknowledgement: {
        warningVersion: 'external-provider-charge/v1',
        confirmed: false,
      },
    }),
    command('RETRY_ATTEMPT', {
      slotKey: 'sku:sku-1:hero',
      attemptId: 'attempt-1',
      expectedSlotRevision: 4,
      dispatchRef: 'caller-dispatch-ref',
      externalChargeAcknowledgement: {
        warningVersion: 'external-provider-charge/v1',
        confirmed: true,
      },
    }),
    command('RETRY_ATTEMPT', {
      slotKey: 'sku:sku-1:hero',
      attemptId: 'attempt-1',
      expectedSlotRevision: 4,
      unknownOutcomeRecovery: {
        strategy: 'TRUSTED_RECOVERY_REF',
        recoveryRef: 'caller-recovery-ref',
      },
    }),
    command('RESOLVE_UNKNOWN_ATTEMPT', {
      slotKey: 'sku:sku-1:hero',
      attemptId: 'attempt-1',
      expectedSlotRevision: 4,
      recoveryRef: 'caller-recovery-ref',
    }),
  ];
  for (const value of invalidCommands) {
    await rejected(
      test.dispatcher.handlers[MESSAGE_TYPES.BATCH_COMMAND],
      { sender, payload: request({ command: value }) },
      'SS_ERP_BYOK_BATCH_RUNTIME_INPUT_INVALID',
    );
  }
  assert.equal(test.calls.length, 0);
}

{
  const leakedKey = 'sk-' + 's'.repeat(40);
  for (const leaked of [
    { apiKey: leakedKey },
    { image: new Blob(['image']) },
    { encoded: 'a'.repeat(128) },
    { providerOrigin: 'https://provider.example' },
  ]) {
    const test = fixture({ registry: { async state() { return leaked; } } });
    const response = await rejected(
      test.dispatcher.handlers[MESSAGE_TYPES.BATCH_STATE],
      { sender, payload: request() },
      'SS_ERP_BYOK_BATCH_RUNTIME_RESPONSE_INVALID',
    );
    assert.equal(JSON.stringify(response).includes(leakedKey), false);
    assert.equal(JSON.stringify(response).includes('provider.example'), false);
  }
}

{
  const secret = 'sk-' + 'z'.repeat(40);
  const test = fixture({
    registry: {
      async state() {
        const error = new Error(`upstream rejected ${secret}`);
        error.code = 'PROVIDER_TIMEOUT';
        error.details = { authorization: `Bearer ${secret}` };
        throw error;
      },
    },
  });
  const response = await rejected(
    test.dispatcher.handlers[MESSAGE_TYPES.BATCH_STATE],
    { sender, payload: request() },
    'PROVIDER_TIMEOUT',
  );
  assert.equal(JSON.stringify(response).includes(secret), false);

  test.registry.state = async () => {
    throw Object.assign(new Error(secret), { code: 'bad-code-with-secret' });
  };
  await rejected(
    test.dispatcher.handlers[MESSAGE_TYPES.BATCH_STATE],
    { sender, payload: request() },
    'SS_ERP_BYOK_BATCH_RUNTIME_OPERATION_FAILED',
  );

  const secretCode = 'AKIA' + 'Q'.repeat(16);
  test.registry.state = async () => {
    throw Object.assign(new Error('upstream failure'), { code: secretCode });
  };
  const secretCodeResponse = await rejected(
    test.dispatcher.handlers[MESSAGE_TYPES.BATCH_STATE],
    { sender, payload: request() },
    'SS_ERP_BYOK_BATCH_RUNTIME_OPERATION_FAILED',
  );
  assert.equal(JSON.stringify(secretCodeResponse).includes(secretCode), false);
}

{
  const test = fixture();
  await rejected(
    (handlerContext) => test.dispatcher.dispatchAuthorized('unknown-message', handlerContext),
    { sender, payload: request() },
    'SS_ERP_BYOK_BATCH_RUNTIME_HANDLER_UNAVAILABLE',
  );
}

assert.throws(
  () => api.createDispatcher({ messageTypes: MESSAGE_TYPES }),
  (error) => error?.code === 'SS_ERP_BYOK_BATCH_RUNTIME_DEPENDENCY_UNAVAILABLE',
);
assert.throws(
  () => api.createDispatcher({
    messageTypes: { ...MESSAGE_TYPES, EXTRA: 'extra' },
    registry: fixture().registry,
  }),
  (error) => error?.code === 'SS_ERP_BYOK_BATCH_RUNTIME_DEPENDENCY_UNAVAILABLE',
);
assert.throws(
  () => api.createDispatcher({
    messageTypes: { ...MESSAGE_TYPES, BATCH_CLEAR: MESSAGE_TYPES.BATCH_STATE },
    registry: fixture().registry,
  }),
  (error) => error?.code === 'SS_ERP_BYOK_BATCH_RUNTIME_DEPENDENCY_UNAVAILABLE',
);
assert.throws(
  () => api.createDispatcher({
    messageTypes: MESSAGE_TYPES,
    registry: { ...fixture().registry, recover: null },
  }),
  (error) => error?.code === 'SS_ERP_BYOK_BATCH_RUNTIME_DEPENDENCY_UNAVAILABLE',
);

console.log('extension BYOK workbench batch runtime handler tests passed');
