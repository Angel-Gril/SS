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
const ingestReceipt = {
  contractVersion: 'extension-byok-generated-asset-ingest-client/v1', replayed: false,
  receiptId: 'receipt-1', assetId: 'asset-1', provenanceId: 'provenance-1',
  normalizedSha256: 'f'.repeat(64), mimeType: 'image/png', width: 1024, height: 1024,
  sourceDraftRevision: 3, sourceDraftVersion: 4,
  boundDraftRevision: 4, boundDraftVersion: 5,
  assignmentOrdinal: 0, assignmentSha256: '1'.repeat(64),
  skuKey: 'sku-1', slotKey: 'sku:sku-1:hero',
};
const boundResult = {
  resultId, reviewState: 'APPROVED', deliveryState: 'BOUND', ingest: ingestReceipt,
};
const publishPreview = {
  contractVersion: 'extension-byok-listing-publish-preview/v1',
  previewHash: '9'.repeat(64),
  shop: { id: 'shop-1', name: 'Ozon Primary' },
  draft: { workflowId: 'workflow-1', revision: 4, draftVersion: 5 },
  selectedSkuKeys: ['sku-1'],
  media: [],
};
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
  [api.MESSAGE_TYPES.INGEST, { ok: true, data: boundResult }],
  [api.MESSAGE_TYPES.RECOVER_INGEST, { ok: true, data: boundResult }],
]);
const runtime = {
  lastError: null,
  sendMessage(message, callback) {
    messages.push(message);
    queueMicrotask(() => callback(message.type === api.MESSAGE_TYPES.PUBLISH
      ? { ok: true, data: message.payload.action === 'PREVIEW'
        ? publishPreview
        : { state: 'SUCCEEDED', receiptId: 'publish-receipt-1', replayed: false } }
      : responses.get(message.type)));
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
const ingested = await client.ingestApproved(resultId);
assert.deepEqual(JSON.parse(JSON.stringify(ingested)), boundResult);
const recoveredIngest = await client.recoverApprovedIngest(resultId);
assert.deepEqual(JSON.parse(JSON.stringify(recoveredIngest)), boundResult);
assert.deepEqual(JSON.parse(JSON.stringify(await client.getPublishPreview())), publishPreview);
assert.equal((await client.confirmPublish('9'.repeat(64))).receiptId, 'publish-receipt-1');
assert.equal((await client.recoverPublish()).state, 'SUCCEEDED');
assert.deepEqual(JSON.parse(JSON.stringify(
  messages.find((message) => message.type === api.MESSAGE_TYPES.INGEST),
)), {
  type: 'ss-erp:ai-image-workbench-ingest',
  payload: { resultId },
});
assert.deepEqual(JSON.parse(JSON.stringify(
  messages.find((message) => message.type === api.MESSAGE_TYPES.RECOVER_INGEST),
)), {
  type: 'ss-erp:ai-image-workbench-ingest-recover',
  payload: { resultId },
});
assert.deepEqual(
  JSON.parse(JSON.stringify(messages.filter((message) => (
    message.type === api.MESSAGE_TYPES.PUBLISH
  )).map((message) => message.payload))),
  [
    { action: 'PREVIEW' },
    { action: 'CONFIRM', previewHash: '9'.repeat(64) },
    { action: 'RECOVER' },
  ],
);
await assert.rejects(
  client.confirmPublish('not-a-hash'),
  (error) => error && error.code === 'SS_ERP_BYOK_PUBLISH_INPUT_INVALID',
);
assert.equal(api.DEVICE_INVALIDATED_MESSAGE, 'ss-erp:byok-device-session-invalidated');
assert.equal(messages.some((message) => JSON.stringify(message).includes('apiKey')), false);
assert.equal(messages.some((message) => JSON.stringify(message).includes('base64')), false);
assert.equal(messages.some((message) => JSON.stringify(message).includes('blob:extension-preview')), false);
assert.equal(messages.some((message) => JSON.stringify(message).includes('imageBytes')), false);
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

function loadClientWithRuntime(runtimeValue, timers) {
  const isolated = {
    Array, Blob, Boolean, Date, Error, Map, Math, Number, Object, Promise, Set, String,
    clearTimeout: timers.clearTimeout,
    setTimeout: timers.setTimeout,
  };
  isolated.globalThis = isolated;
  vm.runInNewContext(readFileSync(modulePath, 'utf8'), isolated, { filename: modulePath });
  return isolated.SS_ERP_BYOK_WORKBENCH_CLIENT.createClient({
    runtime: runtimeValue,
    BroadcastChannel: FakeBroadcastChannel,
    URL: urlApi,
    now: () => new Date('2026-07-26T10:00:00.000Z'),
    timeoutMs: 1000,
  });
}

const recoveryTimers = [];
const recoveryClient = loadClientWithRuntime({
  lastError: null,
  sendMessage() {},
}, {
  setTimeout(callback, delay) {
    recoveryTimers.push({ callback, delay });
    return recoveryTimers.length;
  },
  clearTimeout() {},
});
const timedOutRecovery = recoveryClient.recoverApprovedIngest(resultId);
assert.equal(recoveryTimers[0].delay, 130_000, 'receipt recovery shares the full ingest timeout');
recoveryTimers[0].callback();
await assert.rejects(
  timedOutRecovery,
  (error) => error && error.code === 'SS_ERP_BYOK_INGEST_UNKNOWN_OUTCOME',
);

const lastErrorRuntime = {
  lastError: null,
  sendMessage(_message, callback) {
    this.lastError = { message: 'worker response channel closed' };
    callback(undefined);
    this.lastError = null;
  },
};
const lastErrorClient = loadClientWithRuntime(lastErrorRuntime, {
  setTimeout() { return 1; },
  clearTimeout() {},
});
await assert.rejects(
  lastErrorClient.recoverApprovedIngest(resultId),
  (error) => error && error.code === 'SS_ERP_BYOK_INGEST_UNKNOWN_OUTCOME',
);

const missingResponseClient = loadClientWithRuntime({
  lastError: null,
  sendMessage(_message, callback) { callback(undefined); },
}, {
  setTimeout() { return 1; },
  clearTimeout() {},
});
await assert.rejects(
  missingResponseClient.recoverApprovedIngest(resultId),
  (error) => error && error.code === 'SS_ERP_BYOK_INGEST_UNKNOWN_OUTCOME',
);

const throwingClient = loadClientWithRuntime({
  lastError: null,
  sendMessage() { throw new Error('runtime unavailable'); },
}, {
  setTimeout() { return 1; },
  clearTimeout() {},
});
await assert.rejects(
  throwingClient.recoverApprovedIngest(resultId),
  (error) => error && error.code === 'SS_ERP_BYOK_INGEST_UNKNOWN_OUTCOME',
);

console.log('extension BYOK workbench client tests passed');
