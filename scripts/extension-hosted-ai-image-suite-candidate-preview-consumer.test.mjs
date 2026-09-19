import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const modulePath =
  'extensions/ss-erp/shared/hosted/ai-image-suite-candidate-preview-consumer.js';
const CONTRACT_VERSION = 'extension-hosted-ai-image-suite-candidate-preview-channel/v1';
const NOW = Date.parse('2026-07-27T08:00:00.000Z');
const pngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x53, 0x53, 0x2d, 0x45, 0x52, 0x50,
]);
const pngSha256 = createHash('sha256').update(pngBytes).digest('hex');

class FakeBroadcastChannel {
  static channels = new Map();

  static reset() {
    FakeBroadcastChannel.channels.clear();
  }

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
    if (this.closed) return;
    this.closed = true;
    FakeBroadcastChannel.channels.get(this.name)?.delete(this);
  }
}

class FakePageEvents {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type) {
    for (const listener of [...(this.listeners.get(type) || [])]) listener({ type });
  }
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
    clearTimeout(id) {
      rows.delete(id);
    },
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

function loadApi() {
  const context = {
    Array, ArrayBuffer, Blob, Boolean, Date, Error, JSON, Map, Math, Number,
    Object, Promise, RegExp, Set, String, TypeError, Uint8Array,
  };
  context.globalThis = context;
  vm.runInNewContext(readFileSync(modulePath, 'utf8'), context, { filename: modulePath });
  return context.SS_ERP_HOSTED_AI_IMAGE_SUITE_CANDIDATE_PREVIEW_CONSUMER;
}

const api = loadApi();

function ticket(index = 1, overrides = {}) {
  const hex = index.toString(16).padStart(2, '0').repeat(24);
  return {
    contractVersion: CONTRACT_VERSION,
    channelName: 'ss-erp:hosted-candidate-preview:' + hex,
    previewTicket: 'hp_' + hex,
    expiresAt: new Date(NOW + 30_000).toISOString(),
    metadata: { mimeType: 'image/png', byteLength: null },
    ...overrides,
  };
}

function previewMessage(inputTicket, overrides = {}) {
  const image = overrides.image || new Blob([pngBytes], { type: 'image/png' });
  return {
    contractVersion: CONTRACT_VERSION,
    type: 'PREVIEW',
    previewTicket: inputTicket.previewTicket,
    image,
    metadata: {
      mimeType: 'image/png',
      byteLength: image.size,
      sha256: pngSha256,
      ...(overrides.metadata || {}),
    },
    ...(overrides.extra || {}),
  };
}

function fixture() {
  FakeBroadcastChannel.reset();
  let nowMillis = NOW;
  const clockTimers = timers();
  const pageEvents = new FakePageEvents();
  const objectUrls = [];
  const revokedUrls = [];
  const consumer = api.createConsumer({
    BroadcastChannel: FakeBroadcastChannel,
    Blob,
    crypto: webcrypto,
    URL: {
      createObjectURL(blob) {
        assert.equal(blob instanceof Blob, true);
        const value = 'blob:ss-erp-preview-' + (objectUrls.length + 1);
        objectUrls.push(value);
        return value;
      },
      revokeObjectURL(value) {
        revokedUrls.push(value);
      },
    },
    eventTarget: pageEvents,
    now: () => new Date(nowMillis),
    setTimeout: clockTimers.setTimeout,
    clearTimeout: clockTimers.clearTimeout,
  });
  return {
    consumer,
    objectUrls,
    pageEvents,
    revokedUrls,
    timers: clockTimers,
    setNow(value) { nowMillis = value; },
  };
}

function backgroundFor(inputTicket, respond) {
  const channel = new FakeBroadcastChannel(inputTicket.channelName);
  const ready = [];
  channel.onmessage = (event) => {
    ready.push(event.data);
    respond?.(channel, event.data);
  };
  return { channel, ready };
}

async function rejectsCode(promise, code) {
  await assert.rejects(
    promise,
    (error) => error?.code === code && error?.name
      === 'ExtensionHostedAiImageSuiteCandidatePreviewConsumerError',
  );
}

{
  const test = fixture();
  const inputTicket = ticket();
  const background = backgroundFor(inputTicket, (channel) => {
    channel.postMessage(previewMessage(inputTicket));
    channel.postMessage({
      contractVersion: CONTRACT_VERSION,
      type: 'REJECTED',
      previewTicket: inputTicket.previewTicket,
      errorCode: 'SS_ERP_HOSTED_CANDIDATE_PREVIEW_REJECTED',
    });
  });
  const result = await test.consumer.consume(inputTicket);

  assert.deepEqual(JSON.parse(JSON.stringify(background.ready)), [{
    type: 'READY',
    previewTicket: inputTicket.previewTicket,
  }], 'the page sends exactly one READY message');
  assert.equal(result.objectUrl, 'blob:ss-erp-preview-1');
  assert.deepEqual(JSON.parse(JSON.stringify(result.metadata)), {
    mimeType: 'image/png',
    byteLength: pngBytes.byteLength,
    sha256: pngSha256,
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.metadata), true);
  assert.equal(test.consumer.pendingSize(), 0);
  assert.equal(background.channel.closed, false);
  assert.equal(FakeBroadcastChannel.channels.get(inputTicket.channelName)?.size, 1);

  result.revoke();
  result.revoke();
  assert.deepEqual(test.revokedUrls, ['blob:ss-erp-preview-1']);
  test.consumer.dispose();
}

{
  const test = fixture();
  const inputTicket = ticket(2);
  const background = backgroundFor(inputTicket, (channel) => {
    channel.postMessage({
      contractVersion: CONTRACT_VERSION,
      type: 'REJECTED',
      previewTicket: inputTicket.previewTicket,
      errorCode: 'SS_ERP_HOSTED_CANDIDATE_PREVIEW_REJECTED',
    });
  });
  await rejectsCode(
    test.consumer.consume(inputTicket),
    'SS_ERP_HOSTED_CANDIDATE_PREVIEW_REJECTED',
  );
  assert.equal(background.ready.length, 1);
  assert.equal(test.consumer.pendingSize(), 0);
  test.consumer.dispose();
}

{
  const test = fixture();
  const inputTicket = ticket(3, { expiresAt: new Date(NOW + 40_000).toISOString() });
  backgroundFor(inputTicket, (channel) => channel.postMessage(previewMessage(inputTicket)));
  const result = await test.consumer.consume(inputTicket);
  assert.equal(result.metadata.byteLength, pngBytes.byteLength);
  result.revoke();
  test.consumer.dispose();
}

{
  const invalidTickets = [
    ticket(4, { expiresAt: new Date(NOW + 60_001).toISOString() }),
    ticket(4, { expiresAt: new Date(NOW).toISOString() }),
    ticket(5, { metadata: { mimeType: 'image/png', byteLength: 14 } }),
    { ...ticket(6), previewUrl: 'https://storage.example/secret.png' },
  ];
  for (const invalidTicket of invalidTickets) {
    const test = fixture();
    await rejectsCode(
      test.consumer.consume(invalidTicket),
      'SS_ERP_HOSTED_CANDIDATE_PREVIEW_TICKET_INVALID',
    );
    assert.equal(test.consumer.pendingSize(), 0);
    test.consumer.dispose();
  }
}

{
  const malformedMessages = [
    (inputTicket) => previewMessage(inputTicket, {
      extra: { url: 'https://provider.example/result.png' },
    }),
    (inputTicket) => previewMessage(inputTicket, { extra: { b64_json: 'secret-base64' } }),
    (inputTicket) => previewMessage(inputTicket, { extra: { provider: 'provider-name' } }),
    (inputTicket) => previewMessage(inputTicket, {
      metadata: { byteLength: pngBytes.byteLength + 1 },
    }),
    (inputTicket) => previewMessage(inputTicket, { metadata: { sha256: '0'.repeat(64) } }),
    (inputTicket) => previewMessage(inputTicket, {
      image: new Blob([new Uint8Array(pngBytes.length)], { type: 'image/png' }),
    }),
    (inputTicket) => ({
      contractVersion: CONTRACT_VERSION,
      type: 'REJECTED',
      previewTicket: inputTicket.previewTicket,
      errorCode: 'PROVIDER_FAILURE',
      provider: 'must-not-be-accepted',
    }),
  ];
  for (const [offset, message] of malformedMessages.entries()) {
    const test = fixture();
    const inputTicket = ticket(10 + offset);
    backgroundFor(inputTicket, (channel) => channel.postMessage(message(inputTicket)));
    await rejectsCode(
      test.consumer.consume(inputTicket),
      'SS_ERP_HOSTED_CANDIDATE_PREVIEW_MESSAGE_INVALID',
    );
    assert.equal(test.objectUrls.length, 0);
    assert.equal(test.consumer.pendingSize(), 0);
    test.consumer.dispose();
  }
}

{
  const test = fixture();
  const inputTicket = ticket(20);
  const background = backgroundFor(inputTicket);
  const pending = test.consumer.consume(inputTicket);
  assert.equal(background.ready.length, 1);
  assert.equal(test.consumer.pendingSize(), 1);
  assert.equal([...test.timers.rows.values()][0].delay, 30_000);
  test.setNow(NOW + 30_000);
  test.timers.fireAll();
  await rejectsCode(pending, 'SS_ERP_HOSTED_CANDIDATE_PREVIEW_TIMEOUT');
  assert.equal(test.consumer.pendingSize(), 0);
  assert.equal(FakeBroadcastChannel.channels.get(inputTicket.channelName)?.size, 1);
  test.consumer.dispose();
}

{
  const test = fixture();
  const resolvedTicket = ticket(21);
  backgroundFor(resolvedTicket, (channel) => channel.postMessage(previewMessage(resolvedTicket)));
  const result = await test.consumer.consume(resolvedTicket);
  const pendingTicket = ticket(22);
  backgroundFor(pendingTicket);
  const pending = test.consumer.consume(pendingTicket);
  assert.equal(test.consumer.pendingSize(), 1);

  test.pageEvents.dispatch('pagehide');
  await rejectsCode(pending, 'SS_ERP_HOSTED_CANDIDATE_PREVIEW_CONSUMER_CLOSED');
  assert.deepEqual(test.revokedUrls, [result.objectUrl]);
  assert.equal(test.consumer.pendingSize(), 0);
  await rejectsCode(
    test.consumer.consume(ticket(23)),
    'SS_ERP_HOSTED_CANDIDATE_PREVIEW_CONSUMER_CLOSED',
  );
  result.revoke();
  assert.deepEqual(test.revokedUrls, [result.objectUrl]);
}

assert.equal(api.CONTRACT_VERSION, CONTRACT_VERSION);
assert.deepEqual(JSON.parse(JSON.stringify(api.LIMITS)), {
  ticketTtlMs: 30_000,
  maximumClockSkewMs: 30_000,
  maxImageBytes: 20 * 1024 * 1024,
});

console.log('extension hosted candidate preview consumer tests passed');
