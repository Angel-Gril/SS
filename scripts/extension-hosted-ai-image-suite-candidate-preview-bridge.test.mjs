import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const modulePath = 'extensions/ss-erp/shared/hosted/ai-image-suite-candidate-preview-bridge.js';

class FakeBroadcastChannel {
  static channels = new Map();

  constructor(name) {
    this.name = name;
    this.onmessage = null;
    this.closed = false;
    const peers = FakeBroadcastChannel.channels.get(name) || new Set();
    peers.add(this);
    FakeBroadcastChannel.channels.set(name, peers);
  }

  postMessage(data) {
    if (this.closed) throw new Error('channel closed');
    for (const peer of FakeBroadcastChannel.channels.get(this.name) || []) {
      if (peer !== this && !peer.closed && typeof peer.onmessage === 'function') {
        peer.onmessage({ data });
      }
    }
  }

  close() {
    this.closed = true;
    FakeBroadcastChannel.channels.get(this.name)?.delete(this);
  }
}

function loadApi() {
  const context = {
    AbortController, Array, ArrayBuffer, Blob, Boolean, Date, Error, JSON, Map, Math,
    Number, Object, Promise, RegExp, Set, String, TypeError, Uint8Array,
  };
  context.globalThis = context;
  vm.runInNewContext(readFileSync(modulePath, 'utf8'), context, { filename: modulePath });
  return context.SS_ERP_HOSTED_AI_IMAGE_SUITE_CANDIDATE_PREVIEW_BRIDGE;
}

const api = loadApi();
const NOW = Date.parse('2026-07-27T08:00:00.000Z');
const pngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x53, 0x53, 0x2d, 0x45, 0x52, 0x50,
]);
const pngSha256 = createHash('sha256').update(pngBytes).digest('hex');

function binding(overrides = {}) {
  return {
    snapshotId: 'snapshot-1',
    supplyGoodsId: 'goods-1',
    shopId: 'shop-1',
    listingWorkflowId: 'listing-workflow-1',
    draftRevision: 11,
    draftVersion: 7,
    planId: 'plan-1',
    planVersionId: 'plan-version-1',
    planRevision: 3,
    suiteId: 'suite-1',
    suiteRevision: 9,
    slotId: 'slot-1',
    slotRevision: 5,
    workflowId: 'workflow-1',
    workflowRevision: 4,
    outputAssetId: 'asset-1',
    ...overrides,
  };
}

function issueResult(inputBinding = binding(), overrides = {}) {
  return {
    contractVersion: 'extension-hosted-ai-image-suite-candidate-preview/v1',
    token: 'A'.repeat(43),
    expiresAt: new Date(NOW + 30_000).toISOString(),
    output: {
      assetId: inputBinding.outputAssetId,
      mimeType: 'image/png',
      width: 900,
      height: 1200,
      previewAvailable: true,
    },
    ...overrides,
  };
}

function arrayBuffer(value) {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
}

function consumeResult(overrides = {}) {
  const bytes = overrides.bytes || pngBytes;
  const headerValues = new Map(Object.entries({
    'content-type': 'image/png',
    'content-length': String(pngBytes.byteLength),
    'x-ss-erp-content-sha256': pngSha256,
    ...(overrides.headers || {}),
  }).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    ok: overrides.ok ?? true,
    status: overrides.status ?? 200,
    headers: {
      get(name) { return headerValues.get(String(name).toLowerCase()) ?? null; },
    },
    body: overrides.body ?? null,
    async arrayBuffer() { return arrayBuffer(bytes); },
  };
}

function timers() {
  let nextId = 1;
  const rows = new Map();
  return {
    setTimeout(callback, delay) {
      const id = nextId++;
      rows.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) { rows.delete(id); },
    fire(id) {
      const row = rows.get(id);
      if (!row) return false;
      rows.delete(id);
      row.callback();
      return true;
    },
    fireAll() {
      for (const id of [...rows.keys()]) this.fire(id);
    },
    rows,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  return { promise, resolve, reject };
}

function fixture(options = {}) {
  let nowMillis = NOW;
  let randomByte = 1;
  const clockTimers = timers();
  const calls = { issue: [], consume: [] };
  const issuePreview = options.issuePreview || (async (input) => {
    calls.issue.push(input);
    return issueResult(input.binding);
  });
  const consumePreview = options.consumePreview || (async (input) => {
    calls.consume.push(input);
    return consumeResult();
  });
  const bridge = api.createBridge({
    issuePreview,
    consumePreview,
    BroadcastChannel: FakeBroadcastChannel,
    Blob,
    crypto: webcrypto,
    now: () => new Date(nowMillis),
    randomValues(bytes) { bytes.fill(randomByte++); return bytes; },
    setTimeout: clockTimers.setTimeout,
    clearTimeout: clockTimers.clearTimeout,
  });
  return {
    bridge,
    calls,
    timers: clockTimers,
    setNow(value) { nowMillis = value; },
  };
}

async function receive(ticket, ready = { type: 'READY', previewTicket: ticket.previewTicket }) {
  const page = new FakeBroadcastChannel(ticket.channelName);
  const received = deferred();
  page.onmessage = (event) => received.resolve(event.data);
  page.postMessage(ready);
  const message = await received.promise;
  return { page, message };
}

{
  const test = fixture();
  const sourceBinding = binding();
  const opening = test.bridge.open(sourceBinding);
  sourceBinding.shopId = 'mutated-after-open';
  const ticket = await opening;

  assert.equal(ticket.contractVersion, api.CONTRACT_VERSION);
  assert.match(ticket.channelName, /^ss-erp:hosted-candidate-preview:[a-f0-9]{48}$/u);
  assert.match(ticket.previewTicket, /^hp_[a-f0-9]{48}$/u);
  assert.equal(ticket.expiresAt, '2026-07-27T08:00:30.000Z');
  assert.deepEqual(JSON.parse(JSON.stringify(ticket.metadata)), {
    mimeType: 'image/png',
    byteLength: null,
  });
  assert.equal(Object.isFrozen(ticket), true);
  assert.equal(Object.isFrozen(test.calls.issue[0].binding), true);
  assert.equal(test.calls.issue[0].binding.shopId, 'shop-1');
  assert.equal(test.calls.consume.length, 0, 'ERP bytes are not consumed before READY');
  assert.equal(test.bridge.pendingSize(), 1);

  const serializedTicket = JSON.stringify(ticket);
  for (const forbidden of [
    'https://', 'storageKey', 'provider', 'model', 'prompt', 'apiKey', 'authorization',
    'asset-1', 'shop-1', 'listing-workflow-1', 'A'.repeat(43),
  ]) {
    assert.equal(serializedTicket.toLowerCase().includes(forbidden.toLowerCase()), false, forbidden);
  }

  const { page, message } = await receive(ticket);
  assert.equal(message.contractVersion, api.CONTRACT_VERSION);
  assert.equal(message.type, 'PREVIEW');
  assert.equal(message.previewTicket, ticket.previewTicket);
  assert.equal(message.image instanceof Blob, true);
  assert.deepEqual(new Uint8Array(await message.image.arrayBuffer()), pngBytes);
  assert.deepEqual(JSON.parse(JSON.stringify(message.metadata)), {
    mimeType: 'image/png',
    byteLength: pngBytes.byteLength,
    sha256: pngSha256,
  });
  assert.equal(test.calls.consume.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(test.calls.consume[0].binding)), binding());
  assert.equal(test.calls.consume[0].token, 'A'.repeat(43));
  assert.equal(test.calls.consume[0].maximumBytes, api.LIMITS.maxImageBytes);
  assert.equal(test.bridge.pendingSize(), 0);

  page.postMessage({ type: 'READY', previewTicket: ticket.previewTicket });
  await Promise.resolve();
  assert.equal(test.calls.consume.length, 1, 'a replay cannot consume ERP bytes twice');
  page.close();
}

{
  const test = fixture();
  const first = await test.bridge.open(binding());
  const second = await test.bridge.open(binding({ outputAssetId: 'asset-2', slotId: 'slot-2' }));
  const attacker = new FakeBroadcastChannel(first.channelName);
  attacker.postMessage({ type: 'READY', previewTicket: second.previewTicket });
  await Promise.resolve();
  assert.equal(test.calls.consume.length, 0);
  assert.equal(test.bridge.pendingSize(), 1, 'a cross-binding ticket burns only its target channel');
  attacker.close();
  const delivered = await receive(second);
  assert.equal(delivered.message.type, 'PREVIEW');
  delivered.page.close();
}

{
  const test = fixture();
  const ticket = await test.bridge.open(binding());
  test.setNow(NOW + 30_000);
  const page = new FakeBroadcastChannel(ticket.channelName);
  page.postMessage({ type: 'READY', previewTicket: ticket.previewTicket });
  await Promise.resolve();
  assert.equal(test.calls.consume.length, 0, 'an expired ticket never consumes ERP bytes');
  assert.equal(test.bridge.pendingSize(), 0);
  page.close();
}

for (const [label, response] of [
  ['wrong MIME', () => consumeResult({ headers: { 'content-type': 'image/jpeg' } })],
  ['wrong length', () => consumeResult({ headers: { 'content-length': String(pngBytes.byteLength + 1) } })],
  ['wrong hash', () => consumeResult({ headers: { 'x-ss-erp-content-sha256': 'f'.repeat(64) } })],
  ['wrong magic', () => consumeResult({ bytes: new Uint8Array(14) })],
  ['oversize declaration', () => consumeResult({
    headers: { 'content-length': String(api.LIMITS.maxImageBytes + 1) },
  })],
  ['HTTP failure', () => consumeResult({ ok: false, status: 410 })],
]) {
  const calls = [];
  const test = fixture({
    consumePreview: async (input) => {
      calls.push(input);
      return response(input);
    },
  });
  const ticket = await test.bridge.open(binding());
  const { page, message } = await receive(ticket);
  assert.deepEqual(JSON.parse(JSON.stringify(message)), {
    contractVersion: api.CONTRACT_VERSION,
    type: 'REJECTED',
    previewTicket: ticket.previewTicket,
    errorCode: 'SS_ERP_HOSTED_CANDIDATE_PREVIEW_REJECTED',
  }, label);
  assert.equal(calls.length, 1, label);
  assert.equal(test.bridge.pendingSize(), 0, label);
  page.close();
}

{
  const test = fixture({
    consumePreview: async (input) => {
      test.calls.consume.push(input);
      return consumeResult({ headers: { 'x-ss-erp-content-sha256': undefined } });
    },
  });
  const ticket = await test.bridge.open(binding());
  const { page, message } = await receive(ticket);
  assert.equal(message.type, 'PREVIEW');
  assert.equal(message.metadata.sha256, pngSha256, 'the bridge exposes its verified digest');
  page.close();
}

{
  const consumed = deferred();
  const consumeCalls = [];
  const test = fixture({
    consumePreview: (input) => {
      consumeCalls.push(input);
      return consumed.promise;
    },
  });
  const ticket = await test.bridge.open(binding());
  const page = new FakeBroadcastChannel(ticket.channelName);
  let leaked = false;
  page.onmessage = () => { leaked = true; };
  page.postMessage({ type: 'READY', previewTicket: ticket.previewTicket });
  await Promise.resolve();
  assert.equal(consumeCalls.length, 1);
  assert.equal(test.bridge.revoke(binding({ shopId: 'shop-other' })), 0);
  assert.equal(test.bridge.pendingSize(), 1);
  assert.equal(test.bridge.revoke(binding()), 1);
  assert.equal(consumeCalls[0].signal.aborted, true);
  consumed.resolve(consumeResult());
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(leaked, false, 'a revoked in-flight request cannot deliver late bytes');
  assert.equal(test.bridge.pendingSize(), 0);
  page.close();
}

{
  const test = fixture();
  await test.bridge.open(binding());
  await test.bridge.open(binding({ outputAssetId: 'asset-2', slotId: 'slot-2' }));
  assert.equal(test.bridge.clear(), 2);
  assert.equal(test.bridge.clear(), 0);
  assert.equal(test.bridge.pendingSize(), 0);
}

await assert.rejects(
  fixture().bridge.open({ ...binding(), provider: 'must-not-be-accepted' }),
  (error) => error?.code === 'SS_ERP_HOSTED_CANDIDATE_PREVIEW_BINDING_INVALID',
);

await assert.rejects(
  fixture({
    issuePreview: async (input) => ({
      ...issueResult(input.binding),
      storageKey: 'must-not-be-exposed.png',
    }),
  }).bridge.open(binding()),
  (error) => error?.code === 'SS_ERP_HOSTED_CANDIDATE_PREVIEW_ISSUE_INVALID',
);

await assert.rejects(
  fixture({
    issuePreview: async (input) => issueResult(input.binding, {
      output: {
        ...issueResult(input.binding).output,
        assetId: 'asset-from-another-binding',
      },
    }),
  }).bridge.open(binding()),
  (error) => error?.code === 'SS_ERP_HOSTED_CANDIDATE_PREVIEW_ISSUE_INVALID',
);

{
  let cancelled = 0;
  let reads = 0;
  const oversizedChunk = new Uint8Array(pngBytes.byteLength + 1);
  oversizedChunk.set(pngBytes);
  const test = fixture({
    consumePreview: async () => consumeResult({
      body: {
        getReader() {
          return {
            async read() {
              reads += 1;
              return { done: false, value: oversizedChunk };
            },
            async cancel() { cancelled += 1; },
            releaseLock() {},
          };
        },
      },
    }),
  });
  const ticket = await test.bridge.open(binding());
  const { page, message } = await receive(ticket);
  assert.equal(message.type, 'REJECTED');
  assert.equal(reads, 1);
  assert.equal(cancelled, 1, 'a stream that exceeds Content-Length is cancelled immediately');
  page.close();
}

console.log('extension hosted AI image suite candidate preview bridge tests passed');
