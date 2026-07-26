import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const modulePath = 'extensions/ss-erp/shared/byok/workbench-preview-channel.js';

class FakeBroadcastChannel {
  static channels = new Map();

  constructor(name) {
    this.name = name;
    this.onmessage = null;
    this.closed = false;
    const rows = FakeBroadcastChannel.channels.get(name) || new Set();
    rows.add(this);
    FakeBroadcastChannel.channels.set(name, rows);
  }

  postMessage(data) {
    if (this.closed) throw new Error('closed');
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

const context = {
  Array, Blob, Boolean, Date, Error, Map, Math, Number, Object, Set, String, Uint8Array,
};
context.globalThis = context;
vm.runInNewContext(readFileSync(modulePath, 'utf8'), context, { filename: modulePath });
const api = context.SS_ERP_BYOK_WORKBENCH_PREVIEW_CHANNEL;

let randomByte = 1;
const broker = api.createBroker({
  BroadcastChannel: FakeBroadcastChannel,
  now: () => new Date('2026-07-26T10:00:00.000Z'),
  randomValues(bytes) { bytes.fill(randomByte++); return bytes; },
  setTimeout(callback) { return setTimeout(callback, 1000); },
  clearTimeout,
});
const blob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });
const entry = {
  resultId: 'br_' + 'a'.repeat(48),
  reviewState: 'CANDIDATE_READY',
  blob,
  mimeType: 'image/png',
  byteLength: blob.size,
  sha256: 'b'.repeat(64),
};

const ticket = broker.open(entry);
assert.equal(ticket.contractVersion, api.CONTRACT_VERSION);
assert.match(ticket.channelName, /^ss-erp:byok-preview:[a-f0-9]{48}$/u);
assert.match(ticket.previewTicket, /^pt_[a-f0-9]{48}$/u);
assert.equal(JSON.stringify(ticket).includes('base64'), false);
assert.equal(JSON.stringify(ticket).includes('blob'), false);
assert.equal(JSON.stringify(ticket).includes(entry.resultId), false);
assert.equal(broker.size(), 1);

const page = new FakeBroadcastChannel(ticket.channelName);
let delivered = null;
page.onmessage = (event) => { delivered = event.data; };
page.postMessage({ type: 'READY', previewTicket: ticket.previewTicket });
assert.equal(delivered.type, 'PREVIEW');
assert.equal(delivered.previewTicket, ticket.previewTicket);
assert.equal(delivered.image, blob);
assert.deepEqual(JSON.parse(JSON.stringify(delivered.metadata)), {
  mimeType: 'image/png', byteLength: blob.size, sha256: 'b'.repeat(64),
});
assert.equal(broker.size(), 0);
page.postMessage({ type: 'READY', previewTicket: ticket.previewTicket });
assert.equal(delivered.image, blob, 'a consumed channel never sends a second payload');
page.close();

const burned = broker.open({ ...entry, resultId: 'br_' + 'c'.repeat(48) });
const attacker = new FakeBroadcastChannel(burned.channelName);
let leaked = false;
attacker.onmessage = () => { leaked = true; };
attacker.postMessage({ type: 'READY', previewTicket: 'pt_' + 'f'.repeat(48) });
assert.equal(leaked, false);
assert.equal(broker.size(), 0, 'a mismatched attempt burns the one-use preview channel');
attacker.close();

assert.throws(
  () => broker.open({ ...entry, blob: 'not-a-blob' }),
  /PREVIEW_INVALID/u,
);

broker.open({ ...entry, resultId: 'br_' + 'd'.repeat(48) });
broker.open({ ...entry, resultId: 'br_' + 'd'.repeat(48) });
broker.open({ ...entry, resultId: 'br_' + 'e'.repeat(48) });
assert.equal(broker.releaseResult('br_' + 'd'.repeat(48)), 2);
assert.equal(broker.size(), 1);
assert.equal(broker.releaseResult('br_' + 'd'.repeat(48)), 0);
broker.clear();
assert.equal(broker.size(), 0);

console.log('extension BYOK workbench preview channel tests passed');
