import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const modulePath = 'extensions/ss-erp/shared/byok/workbench-client.js';

class FakeBroadcastChannel {
  static hooks = new Map();

  constructor(name) {
    this.name = name;
    this.onmessage = null;
    this.closed = false;
  }

  postMessage(value) {
    FakeBroadcastChannel.hooks.get(this.name)?.(this, value);
  }

  close() { this.closed = true; }
}

const objectUrls = [];
const revoked = [];
const urlApi = {
  createObjectURL(blob) { objectUrls.push(blob); return 'blob:extension-preview-1'; },
  revokeObjectURL(url) { revoked.push(url); },
};
const context = {
  Array, Blob, Boolean, Date, Error, Map, Math, Number, Object, Promise, Set, String,
  clearTimeout, setTimeout,
};
context.globalThis = context;
vm.runInNewContext(readFileSync(modulePath, 'utf8'), context, { filename: modulePath });
const api = context.SS_ERP_BYOK_WORKBENCH_CLIENT;

const binding = {
  contractVersion: 'extension-byok-readiness-binding/v2',
  ownerUserId: 'owner-1', deviceSessionId: 'session-1', shopId: 'shop-1',
  workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
  sourcePlatform: '1688', sourceProductId: 'product-1',
  sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
  skuKey: 'sku-1', slotKey: 'sku:sku-1:hero', assignmentMode: 'APPEND',
  assignmentOrdinal: 0, providerOrigin: 'https://relay.example',
  model: 'image-model-v1', operation: 'TEXT_TO_IMAGE', policyRevision: '7',
};
const readiness = {
  readinessHandle: 'rh_' + 'a'.repeat(48),
  readinessBinding: binding,
  expiresAt: '2026-07-26T10:05:00.000Z',
};
const resultId = 'br_' + 'b'.repeat(48);
const blob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });
const messages = [];
const responses = new Map([
  [api.MESSAGE_TYPES.GET_PUBLIC_STATE, { ok: true, data: { mode: 'BYOK' } }],
  [api.MESSAGE_TYPES.GET_READINESS, { ok: true, data: readiness }],
  [api.MESSAGE_TYPES.EXECUTE_PROVIDER, {
    ok: true,
    data: { resultId, reviewState: 'CANDIDATE_READY', image: { mimeType: 'image/png', byteLength: blob.size, sha256: 'c'.repeat(64) } },
  }],
  [api.MESSAGE_TYPES.OPEN_PREVIEW, {
    ok: true,
    data: {
      contractVersion: 'extension-byok-workbench-preview-channel/v1',
      channelName: 'ss-erp:byok-preview:' + 'd'.repeat(48),
      previewTicket: 'pt_' + 'e'.repeat(48),
      expiresAt: '2026-07-26T10:00:15.000Z',
      metadata: { mimeType: 'image/png', byteLength: blob.size, sha256: 'c'.repeat(64) },
    },
  }],
  [api.MESSAGE_TYPES.REVIEW_RESULT, { ok: true, data: { resultId, reviewState: 'APPROVED' } }],
]);
const runtime = {
  lastError: null,
  sendMessage(message, callback) {
    messages.push(message);
    queueMicrotask(() => callback(responses.get(message.type)));
  },
};
const client = api.createClient({
  runtime,
  BroadcastChannel: FakeBroadcastChannel,
  URL: urlApi,
  now: () => new Date('2026-07-26T10:00:00.000Z'),
  timeoutMs: 1000,
});

assert.deepEqual(JSON.parse(JSON.stringify(await client.getPublicState())), { mode: 'BYOK' });
assert.deepEqual(JSON.parse(JSON.stringify(await client.getReadiness('profile-1'))), readiness);
const generated = await client.generate({
  profileId: 'profile-1', prompt: 'Create a clean product hero image', negativePrompt: null,
  size: '1024x1024', idempotencyKey: 'workbench-generate-0001', readiness,
});
assert.equal(generated.resultId, resultId);
assert.equal(generated.reviewState, 'CANDIDATE_READY');

const channelName = responses.get(api.MESSAGE_TYPES.OPEN_PREVIEW).data.channelName;
FakeBroadcastChannel.hooks.set(channelName, (page, value) => {
  assert.deepEqual(JSON.parse(JSON.stringify(value)), {
    type: 'READY', previewTicket: 'pt_' + 'e'.repeat(48),
  });
  page.onmessage({
    data: {
      contractVersion: 'extension-byok-workbench-preview-channel/v1',
      type: 'PREVIEW',
      previewTicket: 'pt_' + 'e'.repeat(48),
      image: blob,
      metadata: { mimeType: 'image/png', byteLength: blob.size, sha256: 'c'.repeat(64) },
    },
  });
});
const preview = await client.openPreview(resultId);
assert.equal(preview.objectUrl, 'blob:extension-preview-1');
assert.equal(objectUrls[0], blob);
preview.revoke();
preview.revoke();
assert.deepEqual(revoked, ['blob:extension-preview-1']);

const approved = await client.reviewResult(resultId, 'APPROVE');
assert.equal(approved.reviewState, 'APPROVED');
assert.equal(messages.some((message) => JSON.stringify(message).includes('apiKey')), false);
assert.equal(messages.some((message) => JSON.stringify(message).includes('base64')), false);
assert.equal(messages.some((message) => JSON.stringify(message).includes('blob:extension-preview')), false);
assert.deepEqual(JSON.parse(JSON.stringify(
  messages.find((message) => message.type === api.MESSAGE_TYPES.GET_PUBLIC_STATE),
)), {
  type: api.MESSAGE_TYPES.GET_PUBLIC_STATE, payload: {},
});

for (const invalid of [
  { profileId: 'profile-1', prompt: '', negativePrompt: null, size: '1024x1024', idempotencyKey: 'workbench-generate-0002', readiness },
  { profileId: 'profile-1', prompt: 'ok', negativePrompt: null, size: '99999x1', idempotencyKey: 'workbench-generate-0002', readiness },
  { profileId: 'profile-1', prompt: 'ok', negativePrompt: null, size: '1024x1024', idempotencyKey: 'bad key', readiness },
]) {
  await assert.rejects(async () => client.generate(invalid), /INPUT_INVALID/u);
}

console.log('extension BYOK workbench client tests passed');
