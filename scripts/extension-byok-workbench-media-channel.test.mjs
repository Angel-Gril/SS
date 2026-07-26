import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const inspectorPath = 'extensions/ss-erp/shared/byok/image-input-inspector.js';
const modulePath = 'extensions/ss-erp/shared/byok/workbench-media-channel.js';
const moduleSource = readFileSync(modulePath, 'utf8');

assert.doesNotMatch(moduleSource, /storage\.(?:local|sync)|localStorage|sessionStorage/u);

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
    if (this.closed) return;
    this.closed = true;
    FakeBroadcastChannel.channels.get(this.name)?.delete(this);
  }

  static reset() {
    for (const peers of this.channels.values()) {
      for (const peer of peers) peer.close();
    }
    this.channels.clear();
  }
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function uint32(value) {
  const result = Buffer.alloc(4);
  result.writeUInt32BE(value);
  return result;
}

function pngChunk(type, data) {
  return Buffer.concat([
    uint32(data.length),
    Buffer.from(type, 'ascii'),
    data,
    Buffer.alloc(4),
  ]);
}

function pngFixture(width = 4, height = 3) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return new Blob([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', header),
    pngChunk('IDAT', Buffer.from([0])),
    pngChunk('IEND', Buffer.alloc(0)),
  ], { type: 'image/png' });
}

function jpegFixture(width = 7, height = 5) {
  const sof = Buffer.from([
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >>> 8) & 0xff, height & 0xff,
    (width >>> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
  ]);
  return new Blob([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]),
    sof,
    Buffer.from([0xff, 0xd9]),
  ], { type: 'image/jpeg' });
}

function createManualTime(start = Date.parse('2026-07-27T08:00:00.000Z')) {
  let current = start;
  let nextTimer = 1;
  const timers = new Map();
  return {
    now: () => new Date(current),
    advance(milliseconds) { current += milliseconds; },
    setTimeout(callback, delay) {
      const id = nextTimer;
      nextTimer += 1;
      timers.set(id, { callback, dueAt: current + delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    runDue() {
      for (const [id, row] of [...timers]) {
        if (row.dueAt <= current) {
          timers.delete(id);
          row.callback();
        }
      }
    },
  };
}

function loadApi() {
  const context = {
    Array, ArrayBuffer, Blob, Boolean, Date, Error, Map, Math, Number, Object,
    Promise, Set, String, TypeError, Uint8Array,
  };
  context.globalThis = context;
  vm.runInNewContext(readFileSync(inspectorPath, 'utf8'), context, { filename: inspectorPath });
  vm.runInNewContext(readFileSync(modulePath, 'utf8'), context, { filename: modulePath });
  return {
    api: context.SS_ERP_BYOK_WORKBENCH_MEDIA_CHANNEL,
    inspector: context.SS_ERP_BYOK_IMAGE_INPUT_INSPECTOR,
  };
}

function owner(overrides = {}) {
  return {
    ownerId: 'workbench-owner-1',
    tabId: 41,
    documentId: 'document-1',
    ...overrides,
  };
}

function uploadMessage(api, ticket, image, overrides = {}) {
  return {
    contractVersion: api.CONTRACT_VERSION,
    type: 'UPLOAD',
    uploadTicket: ticket.uploadTicket,
    purpose: ticket.purpose,
    image,
    ...overrides,
  };
}

function waitForMessage(channel) {
  return new Promise((resolve) => { channel.onmessage = (event) => resolve(event.data); });
}

function createBroker(options = {}) {
  const { api, inspector } = loadApi();
  const time = options.time || createManualTime();
  let randomByte = options.randomByte || 1;
  const broker = api.createBroker({
    BroadcastChannel: FakeBroadcastChannel,
    imageInspector: options.imageInspector || inspector,
    crypto: webcrypto,
    now: time.now,
    randomValues(bytes) { bytes.fill(randomByte); randomByte += 1; return bytes; },
    setTimeout: time.setTimeout,
    clearTimeout: time.clearTimeout,
    ...(options.decodeImage ? { decodeImage: options.decodeImage } : {}),
    ...(options.maxOwnerBytes ? { maxOwnerBytes: options.maxOwnerBytes } : {}),
  });
  return { api, broker, time };
}

async function upload(api, broker, binding, purpose, image, overrides = {}) {
  const ticket = broker.prepare({ ...binding, purpose });
  const page = new FakeBroadcastChannel(ticket.channelName);
  const responsePromise = waitForMessage(page);
  page.postMessage(uploadMessage(api, ticket, image, overrides));
  const response = await responsePromise;
  page.close();
  return { ticket, response };
}

test.beforeEach(() => FakeBroadcastChannel.reset());
test.afterEach(() => FakeBroadcastChannel.reset());

test('accepts one Blob once, validates and hashes it, and exposes only an opaque handle', async () => {
  const { api, broker } = createBroker();
  const binding = owner();
  const image = pngFixture();
  const { ticket, response } = await upload(api, broker, binding, 'REFERENCE', image);

  assert.equal(ticket.contractVersion, api.CONTRACT_VERSION);
  assert.match(ticket.channelName, /^ss-erp:byok-media-upload:[a-f0-9]{48}$/u);
  assert.match(ticket.uploadTicket, /^ut_[a-f0-9]{48}$/u);
  assert.equal(ticket.purpose, 'REFERENCE');
  assert.equal(JSON.stringify(ticket).includes(binding.ownerId), false);
  assert.equal(JSON.stringify(ticket).includes(binding.documentId), false);

  assert.equal(response.type, 'ACCEPTED');
  assert.match(response.mediaHandle, /^mh_[a-f0-9]{48}$/u);
  assert.deepEqual(plain(response.metadata), {
    mimeType: 'image/png',
    byteLength: image.size,
    width: 4,
    height: 3,
    sha256: createHash('sha256').update(Buffer.from(await image.arrayBuffer())).digest('hex'),
  });
  assert.equal(JSON.stringify(response).includes('blob'), false);
  assert.equal(JSON.stringify(response).includes(binding.ownerId), false);
  assert.equal(broker.pendingSize(), 0);
  assert.equal(broker.size(), 1);

  const retained = broker.getForBackground({
    ...binding,
    purpose: 'REFERENCE',
    mediaHandle: response.mediaHandle,
  });
  assert.equal(retained.blob, image);
  assert.equal(retained.metadata.sha256, response.metadata.sha256);

  assert.throws(() => broker.getForBackground({
    ...binding,
    ownerId: 'workbench-owner-2',
    purpose: 'REFERENCE',
    mediaHandle: response.mediaHandle,
  }), (error) => error?.code === 'SS_ERP_BYOK_WORKBENCH_MEDIA_BINDING_MISMATCH');
  assert.throws(() => broker.release({
    ...binding,
    purpose: 'SOURCE',
    mediaHandle: response.mediaHandle,
  }), (error) => error?.code === 'SS_ERP_BYOK_WORKBENCH_MEDIA_BINDING_MISMATCH');
  assert.equal(broker.release({
    ...binding,
    purpose: 'REFERENCE',
    mediaHandle: response.mediaHandle,
  }), true);
  assert.equal(broker.size(), 0);
});

test('burns a ticket on wrong purpose and never accepts a replay', async () => {
  const { api, broker } = createBroker();
  const ticket = broker.prepare({ ...owner(), purpose: 'SOURCE' });
  const page = new FakeBroadcastChannel(ticket.channelName);
  const rejectedPromise = waitForMessage(page);
  page.postMessage(uploadMessage(api, ticket, pngFixture(), { purpose: 'REFERENCE' }));
  const rejected = await rejectedPromise;
  assert.equal(rejected.type, 'REJECTED');
  assert.equal(rejected.errorCode, 'SS_ERP_BYOK_WORKBENCH_MEDIA_TICKET_MISMATCH');
  assert.equal(broker.pendingSize(), 0);
  assert.equal(broker.size(), 0);

  let replayResponses = 0;
  page.onmessage = () => { replayResponses += 1; };
  page.postMessage(uploadMessage(api, ticket, pngFixture()));
  await Promise.resolve();
  assert.equal(replayResponses, 0);
  assert.equal(broker.size(), 0, 'a consumed ticket cannot create a result on replay');
  page.close();
});

test('accepts Blob payloads only and burns malformed tickets', async () => {
  const { api, broker } = createBroker();
  const ticket = broker.prepare({ ...owner(), purpose: 'REFERENCE' });
  const page = new FakeBroadcastChannel(ticket.channelName);
  const rejectedPromise = waitForMessage(page);
  page.postMessage(uploadMessage(api, ticket, { type: 'image/png', size: 12 }));
  const rejected = await rejectedPromise;
  assert.equal(rejected.type, 'REJECTED');
  assert.equal(rejected.errorCode, 'SS_ERP_BYOK_WORKBENCH_MEDIA_BLOB_INVALID');
  assert.equal(broker.size(), 0);
  assert.equal(broker.pendingSize(), 0);
  page.close();
});

test('rejects expired tickets and closes their channels', async () => {
  const time = createManualTime();
  const { api, broker } = createBroker({ time });
  const ticket = broker.prepare({ ...owner(), purpose: 'REFERENCE' });
  const page = new FakeBroadcastChannel(ticket.channelName);
  const rejectedPromise = waitForMessage(page);
  time.advance(api.LIMITS.maxTicketTtlMs + 1);
  page.postMessage(uploadMessage(api, ticket, pngFixture()));
  const rejected = await rejectedPromise;
  assert.equal(rejected.type, 'REJECTED');
  assert.equal(rejected.errorCode, 'SS_ERP_BYOK_WORKBENCH_MEDIA_TICKET_EXPIRED');
  assert.equal(broker.pendingSize(), 0);
  assert.equal(broker.size(), 0);
  assert.equal(page.closed, false, 'the page owns and closes its own channel endpoint');
  page.close();
});

test('timer expiry closes an unused background endpoint', () => {
  const time = createManualTime();
  const { api, broker } = createBroker({ time });
  const ticket = broker.prepare({ ...owner(), purpose: 'REFERENCE' });
  assert.equal(FakeBroadcastChannel.channels.get(ticket.channelName)?.size, 1);
  time.advance(api.LIMITS.maxTicketTtlMs);
  time.runDue();
  assert.equal(broker.pendingSize(), 0);
  assert.equal(FakeBroadcastChannel.channels.get(ticket.channelName)?.size || 0, 0);
});

test('enforces purpose MIME rules and delegates hostile image validation to the inspector', async () => {
  const { api, broker } = createBroker();
  const binding = owner();
  const jpeg = jpegFixture();
  const source = await upload(api, broker, binding, 'SOURCE', jpeg);
  assert.equal(source.response.type, 'ACCEPTED');
  assert.equal(source.response.metadata.mimeType, 'image/jpeg');

  const wrongMask = await upload(api, broker, binding, 'MASK', jpeg);
  assert.equal(wrongMask.response.type, 'REJECTED');
  assert.equal(wrongMask.response.errorCode, 'SS_ERP_BYOK_IMAGE_MIME_UNSUPPORTED');

  const malformed = new Blob([Buffer.from('not an image')], { type: 'image/png' });
  const hostile = await upload(api, broker, binding, 'REFERENCE', malformed);
  assert.equal(hostile.response.type, 'REJECTED');
  assert.equal(hostile.response.errorCode, 'SS_ERP_BYOK_IMAGE_FORMAT_INVALID');
  assert.equal(broker.size(), 1, 'only the valid JPEG remains retained');
  broker.clear();
});

test('forwards an optional background decoder to the injected inspector', async () => {
  let decoded = 0;
  let closed = 0;
  const decodeImage = async () => {
    decoded += 1;
    return { width: 4, height: 3, close() { closed += 1; } };
  };
  const { api, broker } = createBroker({ decodeImage });
  const result = await upload(api, broker, owner(), 'SOURCE', pngFixture());
  assert.equal(result.response.type, 'ACCEPTED');
  assert.equal(decoded, 1);
  assert.equal(closed, 1);
  broker.clear();
});

test('rejects an invalid inspector projection instead of trusting dimensions or MIME', async () => {
  const imageInspector = {
    async inspectImageBlob({ blob }) {
      return {
        contractVersion: 'forged-inspection/v1',
        mimeType: blob.type,
        byteLength: blob.size,
        width: 4,
        height: 3,
        animated: false,
        decodeVerified: false,
      };
    },
  };
  const { api, broker } = createBroker({ imageInspector });
  const result = await upload(api, broker, owner(), 'REFERENCE', pngFixture());
  assert.equal(result.response.type, 'REJECTED');
  assert.equal(
    result.response.errorCode,
    'SS_ERP_BYOK_WORKBENCH_MEDIA_INSPECTION_INVALID',
  );
  assert.equal(broker.size(), 0);
});

test('enforces the 20 MiB image bound before inspection', async () => {
  let inspectionCalls = 0;
  const imageInspector = {
    async inspectImageBlob() { inspectionCalls += 1; throw new Error('must not inspect'); },
  };
  const { api, broker } = createBroker({ imageInspector });
  assert.equal(api.LIMITS.maxImageBytes, 20 * 1024 * 1024);
  const oversized = new Blob(
    [new Uint8Array(api.LIMITS.maxImageBytes + 1)],
    { type: 'image/png' },
  );
  const result = await upload(api, broker, owner(), 'REFERENCE', oversized);
  assert.equal(result.response.type, 'REJECTED');
  assert.equal(result.response.errorCode, 'SS_ERP_BYOK_WORKBENCH_MEDIA_BYTES_INVALID');
  assert.equal(inspectionCalls, 0);
});

test('applies the owner aggregate atomically and keeps other owners independent', async () => {
  const inspected = {
    contractVersion: 'extension-byok-image-input-inspector/v1',
    mimeType: 'image/png', byteLength: 6, width: 1, height: 1,
    animated: false, decodeVerified: false,
  };
  const imageInspector = {
    async inspectImageBlob({ blob }) { return { ...inspected, byteLength: blob.size }; },
  };
  const { api, broker } = createBroker({ imageInspector, maxOwnerBytes: 10 });
  assert.equal(api.LIMITS.maxOwnerBytes, 50 * 1024 * 1024);
  const sixBytes = () => new Blob([new Uint8Array(6)], { type: 'image/png' });
  const first = await upload(api, broker, owner(), 'REFERENCE', sixBytes());
  assert.equal(first.response.type, 'ACCEPTED');
  const overBudget = await upload(api, broker, owner(), 'SOURCE', sixBytes());
  assert.equal(overBudget.response.type, 'REJECTED');
  assert.equal(overBudget.response.errorCode, 'SS_ERP_BYOK_WORKBENCH_MEDIA_OWNER_LIMIT');
  assert.equal(broker.ownerBytes(owner()), 6);

  const sameOwnerOtherDocument = owner({ tabId: 99, documentId: 'document-99' });
  const crossDocumentBudget = await upload(
    api, broker, sameOwnerOtherDocument, 'REFERENCE', sixBytes(),
  );
  assert.equal(crossDocumentBudget.response.type, 'REJECTED');
  assert.equal(
    crossDocumentBudget.response.errorCode,
    'SS_ERP_BYOK_WORKBENCH_MEDIA_OWNER_LIMIT',
    'changing tab/document cannot bypass an owner-wide budget',
  );
  assert.equal(broker.ownerBytes(sameOwnerOtherDocument), 6);

  const otherOwner = owner({ ownerId: 'workbench-owner-2', tabId: 42, documentId: 'document-2' });
  const independent = await upload(api, broker, otherOwner, 'REFERENCE', sixBytes());
  assert.equal(independent.response.type, 'ACCEPTED');
  assert.equal(broker.ownerBytes(otherOwner), 6);
  assert.equal(broker.size(), 2);
  broker.clear();
});

test('releaseOwner closes pending/in-flight channels and removes only exact-owner bytes', async () => {
  let resolveInspection;
  const inspection = new Promise((resolve) => { resolveInspection = resolve; });
  let inspectionCalls = 0;
  const validInspection = {
    contractVersion: 'extension-byok-image-input-inspector/v1',
    mimeType: 'image/png', byteLength: pngFixture().size, width: 4, height: 3,
    animated: false, decodeVerified: false,
  };
  const imageInspector = {
    inspectImageBlob() {
      inspectionCalls += 1;
      return inspectionCalls === 1 ? inspection : Promise.resolve(validInspection);
    },
  };
  const { api, broker } = createBroker({ imageInspector });
  const firstOwner = owner();
  const secondOwner = owner({ ownerId: 'workbench-owner-2', tabId: 42, documentId: 'document-2' });
  const pending = broker.prepare({ ...firstOwner, purpose: 'REFERENCE' });
  const inFlight = broker.prepare({ ...firstOwner, purpose: 'SOURCE' });
  const page = new FakeBroadcastChannel(inFlight.channelName);
  page.postMessage(uploadMessage(api, inFlight, pngFixture()));
  await Promise.resolve();

  const retained = await upload(api, broker, secondOwner, 'REFERENCE', pngFixture(), {});
  assert.equal(retained.response.type, 'ACCEPTED');

  const released = broker.releaseOwner(firstOwner);
  assert.equal(released.cancelledChannels, 2);
  assert.equal(FakeBroadcastChannel.channels.get(pending.channelName)?.size || 0, 0);
  assert.equal(broker.ownerBytes(firstOwner), 0);
  assert.equal(broker.ownerBytes(secondOwner), pngFixture().size);
  resolveInspection(validInspection);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(broker.ownerBytes(firstOwner), 0, 'cancelled inspection cannot commit after releaseOwner');
  page.close();
  broker.clear();
});
