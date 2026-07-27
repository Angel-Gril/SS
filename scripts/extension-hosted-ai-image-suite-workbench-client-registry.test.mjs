import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const modulePath =
  'extensions/ss-erp/shared/hosted/ai-image-suite-workbench-client-registry.js';
const source = readFileSync(modulePath, 'utf8');
const context = { Array, Boolean, Error, JSON, Map, Number, Object, Set, String, WeakMap };
context.globalThis = context;
vm.runInNewContext(source, context, { filename: modulePath });

const api = context.SS_ERP_HOSTED_AI_IMAGE_SUITE_WORKBENCH_CLIENT_REGISTRY;
const REQUIRED_METHODS = [
  'getModeLock', 'createPlan', 'getCurrentPlan', 'getPlan', 'reviewPlan', 'loadSuite',
  'executeIntent', 'openPreview', 'assignApprovedOutputs', 'clear',
];

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function sender(overrides = {}) {
  return {
    tabId: 17,
    documentId: 'workbench-document-1',
    frameId: 0,
    ...overrides,
  };
}

function binding(overrides = {}) {
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

function client(label, clearCalls) {
  const result = {};
  for (const name of REQUIRED_METHODS) {
    result[name] = name === 'clear'
      ? (reason) => { clearCalls.push({ label, reason }); }
      : () => ({ contractVersion: 'fixture/v1' });
  }
  return Object.freeze(result);
}

function registryHarness(factoryOverride) {
  const created = [];
  const clearCalls = [];
  const createClient = factoryOverride || ((input) => {
    created.push({
      input,
      clearsObserved: clearCalls.length,
    });
    return client('client-' + created.length, clearCalls);
  });
  return {
    registry: api.createRegistry({ createClient }),
    created,
    clearCalls,
  };
}

assert.equal(api.CONTRACT_VERSION,
  'extension-hosted-ai-image-suite-workbench-client-registry/v1');
assert.deepEqual(plain(api.REQUIRED_CLIENT_METHODS), REQUIRED_METHODS);
assert.doesNotMatch(source, /\bchrome\b/u, 'shared registry must not import Chrome globals');
assert.doesNotMatch(source, /(?:https?|ftp|file|blob|data):\/\//iu);

{
  const rawClientPath =
    'extensions/ss-erp/shared/hosted/ai-image-suite-workbench-client.js';
  const rawContext = {
    Array, Boolean, Date, Error, JSON, Map, Math, Number, Object, Promise,
    RegExp, Set, String, TextEncoder, TypeError, URL, URLSearchParams,
  };
  rawContext.globalThis = rawContext;
  vm.runInNewContext(readFileSync(rawClientPath, 'utf8'), rawContext, {
    filename: rawClientPath,
  });
  const rawClient = rawContext.SS_ERP_HOSTED_AI_IMAGE_SUITE_WORKBENCH_CLIENT.createClient({
    transport: { get() {}, post() {} },
    listingClient: { getAiImageSuite() {}, executeAiImageSuiteCommand() {} },
    adapter: { project() {} },
    previewBridge: { open() {}, revoke() {} },
  });
  const actual = registryHarness(() => rawClient);
  assert.strictEqual(
    actual.registry.getClient(sender(), binding()),
    rawClient,
    'the registry contract must accept the actual hosted workbench client surface',
  );
}

const basic = registryHarness();
const first = basic.registry.getClient(sender(), binding());
assert.equal(basic.registry.size(), 1);
assert.equal(basic.created.length, 1);
assert.deepEqual(plain(basic.created[0].input), {
  sender: sender(),
  binding: binding(),
});
assert.equal(Object.isFrozen(basic.created[0].input), true);
assert.equal(Object.isFrozen(basic.created[0].input.sender), true);
assert.equal(Object.isFrozen(basic.created[0].input.binding), true);
assert.strictEqual(basic.registry.getClient(sender(), binding()), first);
assert.equal(basic.created.length, 1, 'the exact sender and binding reuse one client');

const revised = basic.registry.getClient(sender(), binding({ draftRevision: 12 }));
assert.notStrictEqual(revised, first);
assert.deepEqual(basic.clearCalls, [{ label: 'client-1', reason: 'binding_changed' }]);
assert.equal(
  basic.created[1].clearsObserved,
  1,
  'the stale client and preview authority clear synchronously before replacement',
);
assert.equal(basic.registry.size(), 1);

{
  const exactBinding = registryHarness();
  const changes = [
    { snapshotId: 'snapshot-2' },
    { supplyGoodsId: 'goods-2' },
    { shopId: 'shop-2' },
    { listingWorkflowId: 'listing-workflow-2' },
    { draftRevision: 12 },
    { draftVersion: 8 },
  ];
  exactBinding.registry.getClient(sender(), binding());
  changes.forEach((change, index) => {
    exactBinding.registry.getClient(sender(), binding(change));
    assert.equal(exactBinding.clearCalls.length, index + 1);
    assert.equal(exactBinding.created.at(-1).clearsObserved, index + 1);
  });
  assert.equal(exactBinding.registry.size(), 1);
}

const otherDocument = basic.registry.getClient(
  sender({ documentId: 'workbench-document-2' }),
  binding(),
);
const otherTab = basic.registry.getClient(sender({ tabId: 18 }), binding());
assert.notStrictEqual(otherDocument, revised);
assert.notStrictEqual(otherTab, revised);
assert.equal(basic.registry.size(), 3, 'tabs and documents own isolated clients');

assert.equal(basic.registry.clearSender(sender({ tabId: 999 })), 0);
assert.equal(basic.registry.clearSender(sender({ documentId: 'workbench-document-2' })), 1);
assert.equal(basic.registry.size(), 2);
assert.deepEqual(basic.clearCalls.at(-1), {
  label: 'client-3',
  reason: 'sender_cleared',
});
assert.equal(basic.registry.removeTab(17), 1);
assert.equal(basic.registry.size(), 1);
assert.deepEqual(basic.clearCalls.at(-1), {
  label: 'client-2',
  reason: 'tab_removed',
});
assert.equal(basic.registry.clearAll('device_disconnected'), 1);
assert.equal(basic.registry.size(), 0);
assert.deepEqual(basic.clearCalls.at(-1), {
  label: 'client-4',
  reason: 'device_disconnected',
});

{
  const tabs = registryHarness();
  tabs.registry.getClient(sender({ documentId: 'document-a' }), binding());
  tabs.registry.getClient(sender({ documentId: 'document-b' }), binding());
  tabs.registry.getClient(sender({ tabId: 18, documentId: 'document-c' }), binding());
  assert.equal(tabs.registry.removeTab(17), 2);
  assert.equal(tabs.registry.size(), 1);
  assert.deepEqual(tabs.clearCalls, [
    { label: 'client-1', reason: 'tab_removed' },
    { label: 'client-2', reason: 'tab_removed' },
  ]);
}

for (const invalidSender of [
  null,
  {},
  { tabId: 17, documentId: 'workbench-document-1' },
  sender({ frameId: 1 }),
  sender({ tabId: -1 }),
  sender({ tabId: 1.5 }),
  sender({ documentId: '' }),
  sender({ documentId: ' document-1' }),
  sender({ documentId: 'document\u0000-1' }),
  { ...sender(), unexpected: true },
]) {
  assert.throws(
    () => basic.registry.getClient(invalidSender, binding()),
    (error) => error?.code === 'SS_ERP_HOSTED_WORKBENCH_REGISTRY_SENDER_INVALID',
  );
}

for (const invalidBinding of [
  null,
  {},
  binding({ shopId: ' shop-1' }),
  binding({ shopId: 'https://erp.example' }),
  binding({ draftRevision: 0 }),
  binding({ draftVersion: 1.5 }),
  { ...binding(), unexpected: true },
]) {
  assert.throws(
    () => basic.registry.getClient(sender(), invalidBinding),
    (error) => error?.code === 'SS_ERP_HOSTED_WORKBENCH_REGISTRY_BINDING_INVALID',
  );
}

assert.throws(
  () => api.createRegistry(),
  (error) => error?.code === 'SS_ERP_HOSTED_WORKBENCH_REGISTRY_DEPENDENCY_UNAVAILABLE',
);
assert.throws(
  () => api.createRegistry({ createClient: 'not-a-function' }),
  (error) => error?.code === 'SS_ERP_HOSTED_WORKBENCH_REGISTRY_DEPENDENCY_UNAVAILABLE',
);
assert.throws(
  () => basic.registry.clearAll(' https://erp.example'),
  (error) => error?.code === 'SS_ERP_HOSTED_WORKBENCH_REGISTRY_REASON_INVALID',
);

const factoryFailure = registryHarness(() => {
  throw new Error('factory internals must not escape');
});
assert.throws(
  () => factoryFailure.registry.getClient(sender(), binding()),
  (error) => error?.code === 'SS_ERP_HOSTED_WORKBENCH_REGISTRY_FACTORY_FAILED'
    && !error.message.includes('internals'),
);
assert.equal(factoryFailure.registry.size(), 0);

const invalidClient = registryHarness(() => Object.freeze({ clear() {} }));
assert.throws(
  () => invalidClient.registry.getClient(sender(), binding()),
  (error) => error?.code === 'SS_ERP_HOSTED_WORKBENCH_REGISTRY_CLIENT_INVALID',
);
assert.equal(invalidClient.registry.size(), 0);

const leakingClient = registryHarness(() => Object.freeze({
  ...Object.fromEntries(REQUIRED_METHODS.map((name) => [name, () => {}])),
  rawProjection: { providerUrl: 'sensitive' },
}));
assert.throws(
  () => leakingClient.registry.getClient(sender(), binding()),
  (error) => error?.code === 'SS_ERP_HOSTED_WORKBENCH_REGISTRY_CLIENT_INVALID',
);

{
  const clearCalls = [];
  const reusedClient = client('shared', clearCalls);
  const reused = registryHarness(() => reusedClient);
  assert.strictEqual(reused.registry.getClient(sender(), binding()), reusedClient);
  assert.throws(
    () => reused.registry.getClient(sender({ tabId: 18 }), binding()),
    (error) => error?.code === 'SS_ERP_HOSTED_WORKBENCH_REGISTRY_CLIENT_REUSED',
  );
  assert.equal(reused.registry.size(), 1);
  assert.deepEqual(clearCalls, [], 'cross-sender reuse cannot revoke the valid owner');
  assert.throws(
    () => reused.registry.getClient(sender(), binding({ draftVersion: 8 })),
    (error) => error?.code === 'SS_ERP_HOSTED_WORKBENCH_REGISTRY_CLIENT_REUSED',
  );
  assert.equal(reused.registry.size(), 0);
  assert.deepEqual(clearCalls, [{ label: 'shared', reason: 'binding_changed' }]);
}

{
  const clearCalls = [];
  const asyncClear = client('async', clearCalls);
  const value = Object.freeze({
    ...asyncClear,
    clear(reason) {
      clearCalls.push({ label: 'async', reason });
      return Promise.resolve();
    },
  });
  const cleanup = registryHarness(() => value);
  cleanup.registry.getClient(sender(), binding());
  assert.throws(
    () => cleanup.registry.clearSender(sender()),
    (error) => error?.code === 'SS_ERP_HOSTED_WORKBENCH_REGISTRY_CLEAR_FAILED',
  );
  assert.equal(cleanup.registry.size(), 0, 'failed cleanup still removes authority');
}

assert.deepEqual(Object.keys(basic.registry).sort(), [
  'clearAll', 'clearSender', 'getClient', 'removeTab', 'size',
]);
assert.equal(JSON.stringify(basic.registry), '{}');

console.log('extension hosted AI image suite workbench client registry tests passed');
