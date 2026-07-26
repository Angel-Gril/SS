import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const modulePath = 'extensions/ss-erp/shared/byok/generated-result-vault.js';
const source = readFileSync(modulePath, 'utf8');
const context = { Array, Blob, Boolean, Date, Error, Map, Math, Number, Object, String, Uint8Array, URL };
context.globalThis = context;
vm.runInNewContext(source, context, { filename: modulePath });
const api = context.SS_ERP_BYOK_GENERATED_RESULT_VAULT;
let now = new Date('2026-07-25T15:00:00.000Z');
let randomByte = 1;
let nextTimerId = 1;
const timers = new Map();
const discardedResults = [];
const vault = api.createVault({
  now: () => now,
  randomValues(bytes) { bytes.fill(randomByte++); return bytes; },
  setTimeout(callback, delay) {
    const id = nextTimerId++;
    timers.set(id, { callback, delay });
    return id;
  },
  clearTimeout(id) { timers.delete(id); },
  onDiscardedResult(resultId) { discardedResults.push(resultId); },
});

const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const blob = new Blob([bytes], { type: 'image/png' });
function binding(overrides = {}) {
  return {
    contractVersion: 'extension-byok-readiness-binding/v2',
    ownerUserId: 'owner-1', deviceSessionId: 'session-1', shopId: 'shop-1',
    workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
    sourcePlatform: '1688', sourceProductId: 'product-1',
    sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
    skuKey: 'sku-1', slotKey: 'sku:sku-1:hero',
    assignmentMode: 'APPEND', assignmentOrdinal: 0,
    providerOrigin: 'https://relay.example', model: 'image-model-v1',
    operation: 'TEXT_TO_IMAGE', policyRevision: '734', ...overrides,
  };
}
function result(overrides = {}) {
  return {
    outcome: 'SUCCEEDED', operation: 'TEXT_TO_IMAGE', requestMode: 'json',
    profileId: 'profile-1', profileIdentity: 'https://relay.example/v1\u0000image-model-v1',
    providerOrigin: 'https://relay.example', model: 'image-model-v1', policyRevision: '734',
    idempotencyKey: 'provider-generate-0001', requestHash: 'a'.repeat(64),
    promptHash: 'b'.repeat(64), negativePromptHash: null, endpointHash: 'c'.repeat(64),
    providerRequestIdSha256: 'f'.repeat(64),
    acceptedAt: '2026-07-25T15:00:00.000Z',
    image: { blob, mimeType: 'image/png', byteLength: bytes.byteLength, sha256: 'd'.repeat(64) },
    ...overrides,
  };
}
function authority(overrides = {}) {
  return {
    contractVersion: 'extension-byok-device-session-lifecycle/v1',
    epoch: 7,
    ...overrides,
  };
}

const stored = vault.put(result(), binding(), authority());
assert.match(stored.resultId, /^br_[a-f0-9]{48}$/u);
assert.equal(stored.image.sha256, 'd'.repeat(64));
assert.equal(stored.reviewState, 'CANDIDATE_READY');
assert.equal(stored.reviewedAt, null);
assert.equal('blob' in stored.image, false);
assert.equal('profileIdentity' in stored, false);
assert.equal('providerOrigin' in stored, false);
assert.equal(JSON.stringify(stored).includes('base64'), false);
assert.equal(vault.getForBackground(stored.resultId).blob, blob);
assert.equal(vault.getForBackground(stored.resultId).lifecycleEpoch, 7);
assert.equal(vault.getForBackground(stored.resultId).binding.ownerUserId, 'owner-1');
assert.equal(vault.getForBackground(stored.resultId).providerRequestIdSha256, 'f'.repeat(64));
assert.equal(JSON.stringify(stored).includes('providerRequestIdSha256'), false);
assert.equal(vault.size(), 1);
assert.equal(vault.totalBytes(), bytes.byteLength);

assert.deepEqual(
  JSON.parse(JSON.stringify(vault.put(result(), binding(), authority()))),
  JSON.parse(JSON.stringify(stored)),
  'an exact operation replay returns the same vault identity',
);
assert.throws(
  () => vault.put(result({ requestHash: 'e'.repeat(64) }), binding(), authority()),
  /IDEMPOTENCY_CONFLICT/u,
);
for (const invalid of [
  [result(), binding({ model: 'other-model' })],
  [result({ image: { ...result().image, blob: new Blob([bytes], { type: 'image/jpeg' }) } }), binding()],
  [result({ providerOrigin: 'https://other.example' }), binding()],
  [result({ providerRequestIdSha256: 'provider-request-plaintext-sentinel' }), binding()],
]) {
  assert.throws(() => vault.put(invalid[0], invalid[1], authority()), /RESULT_INVALID/u);
}
assert.throws(
  () => vault.put(result({ idempotencyKey: 'provider-generate-context' }), binding(), authority({ epoch: -1 })),
  /RESULT_INVALID/u,
);

let editRandomByte = 24;
const editVault = api.createVault({
  now: () => new Date('2026-07-25T15:00:00.000Z'),
  randomValues(value) { value.fill(editRandomByte++); return value; },
});
const editCases = [
  {
    operation: 'IMAGE_TO_IMAGE', requestMode: 'multipart',
    sourceSha256: null, referenceSha256s: ['1'.repeat(64), '2'.repeat(64)], maskSha256: null,
  },
  {
    operation: 'FULL_EDIT', requestMode: 'multipart',
    sourceSha256: '3'.repeat(64), referenceSha256s: [], maskSha256: null,
  },
  {
    operation: 'INPAINT', requestMode: 'async',
    sourceSha256: '4'.repeat(64), referenceSha256s: [], maskSha256: '5'.repeat(64),
  },
];
for (const [index, edit] of editCases.entries()) {
  const storedEdit = editVault.put(result({
    ...edit,
    idempotencyKey: `provider-edit-${index}`,
    requestHash: String(index + 1).repeat(64),
    providerTaskIdSha256: edit.requestMode === 'async' ? '6'.repeat(64) : null,
  }), binding({ operation: edit.operation }), authority());
  const retainedEdit = editVault.getForBackground(storedEdit.resultId);
  assert.equal(storedEdit.operation, edit.operation);
  assert.equal(storedEdit.requestMode, edit.requestMode);
  assert.equal(retainedEdit.sourceSha256, edit.sourceSha256);
  assert.deepEqual([...retainedEdit.referenceSha256s], edit.referenceSha256s);
  assert.equal(retainedEdit.maskSha256, edit.maskSha256);
  assert.equal('blob' in storedEdit.image, false);
}
assert.throws(() => editVault.put(result({
  operation: 'INPAINT', requestMode: 'multipart', idempotencyKey: 'provider-edit-invalid',
  sourceSha256: '4'.repeat(64), referenceSha256s: [], maskSha256: null,
}), binding({ operation: 'INPAINT' }), authority()), /RESULT_INVALID/u);
editVault.clear();

assert.throws(() => vault.getApprovedForBackground(stored.resultId), /APPROVAL_REQUIRED/u);
const approved = vault.approve(stored.resultId, binding());
assert.equal(approved.reviewState, 'APPROVED');
assert.equal(approved.reviewedAt, '2026-07-25T15:00:00.000Z');
assert.equal(vault.getApprovedForBackground(stored.resultId).blob, blob);
const approvedRejected = vault.put(
  result({ idempotencyKey: 'provider-generate-approved-reject' }),
  binding(),
  authority(),
);
vault.approve(approvedRejected.resultId, binding());
assert.deepEqual(
  JSON.parse(JSON.stringify(vault.reject(approvedRejected.resultId, binding()))),
  { resultId: approvedRejected.resultId, reviewState: 'REJECTED' },
  'an approved but not ingested result remains explicitly discardable',
);
assert.throws(() => vault.getForBackground(approvedRejected.resultId), /NOT_FOUND/u);
assert.ok(discardedResults.includes(approvedRejected.resultId));
assert.throws(
  () => vault.put(
    result({ idempotencyKey: 'provider-generate-context' }),
    { ...binding(), ownerUserId: undefined },
    authority(),
  ),
  /RESULT_INVALID/u,
);

const expiringEntry = vault.getForBackground(stored.resultId);
now = new Date('2026-07-25T15:10:00.001Z');
for (const [id, timer] of [...timers]) {
  timers.delete(id);
  timer.callback();
}
assert.equal(expiringEntry.blob, null, 'TTL callback must release Blob bytes without a later vault read');
assert.ok(discardedResults.includes(stored.resultId), 'TTL cleanup must notify dependent ingest state');
assert.throws(() => vault.getForBackground(stored.resultId), /NOT_FOUND/u);
assert.equal(vault.totalBytes(), 0);

const released = vault.put(
  result({ idempotencyKey: 'provider-generate-0002' }),
  binding(),
  authority(),
);
assert.deepEqual(
  JSON.parse(JSON.stringify(vault.reject(released.resultId, binding()))),
  { resultId: released.resultId, reviewState: 'REJECTED' },
);
assert.equal(vault.release(released.resultId), false);
assert.equal(vault.totalBytes(), 0);
vault.clear();

const retainedDiscards = [];
let retainedRandomByte = 32;
const retainedVault = api.createVault({
  now: () => new Date('2026-07-25T15:00:00.000Z'),
  randomValues(value) { value.fill(retainedRandomByte++); return value; },
  onDiscardedResult(resultId) { retainedDiscards.push(resultId); },
});
const retained = [];
for (let index = 0; index < 16; index += 1) {
  const marker = index.toString(16);
  retained.push(retainedVault.put(result({
    idempotencyKey: `provider-retained-${index}`,
    requestHash: marker.repeat(64),
    promptHash: marker.repeat(64),
    image: { ...result().image, sha256: marker.repeat(64) },
  }), binding(), authority()));
}
retainedVault.pinSelection(retained[0].resultId);
retainedVault.approve(retained[1].resultId, binding());
const overflow = retainedVault.put(result({
  idempotencyKey: 'provider-retained-overflow',
  requestHash: 'f'.repeat(64),
  promptHash: 'f'.repeat(64),
  image: { ...result().image, sha256: 'f'.repeat(64) },
}), binding(), authority());
assert.equal(retainedVault.getForBackground(retained[0].resultId).selectionPinned, true);
assert.equal(retainedVault.getPublic(retained[1].resultId).reviewState, 'APPROVED');
assert.throws(() => retainedVault.getForBackground(retained[2].resultId), /NOT_FOUND/u);
assert.ok(retainedDiscards.includes(retained[2].resultId));

for (const item of [...retained.slice(3), overflow]) {
  retainedVault.pinSelection(item.resultId);
}
assert.throws(
  () => retainedVault.put(result({
    idempotencyKey: 'provider-retained-backpressure',
    requestHash: 'e'.repeat(64),
    promptHash: 'e'.repeat(64),
    image: { ...result().image, sha256: 'e'.repeat(64) },
  }), binding(), authority()),
  /VAULT_FULL/u,
  'a full vault must apply backpressure instead of silently evicting selected or approved bytes',
);
assert.equal(retainedVault.size(), 16);
assert.equal(retainedVault.unpinSelection(retained[0].resultId), true);
const afterRelease = retainedVault.put(result({
  idempotencyKey: 'provider-retained-after-release',
  requestHash: 'd'.repeat(64),
  promptHash: 'd'.repeat(64),
  image: { ...result().image, sha256: 'd'.repeat(64) },
}), binding(), authority());
assert.match(afterRelease.resultId, /^br_[a-f0-9]{48}$/u);
assert.throws(() => retainedVault.getForBackground(retained[0].resultId), /NOT_FOUND/u);
assert.equal(retainedVault.getPublic(retained[1].resultId).reviewState, 'APPROVED');
retainedVault.clear();

let selectionNow = new Date('2026-07-25T15:00:00.000Z');
let selectionRandomByte = 80;
const selectionVault = api.createVault({
  now: () => selectionNow,
  randomValues(value) { value.fill(selectionRandomByte++); return value; },
});
const selection = selectionVault.put(result({
  idempotencyKey: 'provider-selection-ttl',
}), binding(), authority());
selectionVault.pinSelection(selection.resultId);
selectionNow = new Date('2026-07-25T15:20:00.000Z');
assert.equal(
  selectionVault.size(),
  0,
  'selection pin prevents capacity eviction but preserves the public hard TTL contract',
);
assert.equal(selectionVault.unpinSelection(selection.resultId), false);

const MIB = 1024 * 1024;
function largeImage(mebibytes, marker) {
  const largeBlob = new Blob([new Uint8Array(mebibytes * MIB)], { type: 'image/png' });
  return {
    blob: largeBlob,
    mimeType: 'image/png',
    byteLength: largeBlob.size,
    sha256: marker.repeat(64),
  };
}
const atomicDiscards = [];
let atomicRandomByte = 100;
const atomicVault = api.createVault({
  now: () => new Date('2026-07-25T15:00:00.000Z'),
  randomValues(value) { value.fill(atomicRandomByte++); return value; },
  onDiscardedResult(resultId) { atomicDiscards.push(resultId); },
});
const atomicApproved = atomicVault.put(result({
  idempotencyKey: 'provider-atomic-approved',
  requestHash: 'a'.repeat(64),
  image: largeImage(20, 'a'),
}), binding(), authority());
atomicVault.approve(atomicApproved.resultId, binding());
const atomicSelected = atomicVault.put(result({
  idempotencyKey: 'provider-atomic-selected',
  requestHash: 'b'.repeat(64),
  image: largeImage(20, 'b'),
}), binding(), authority());
atomicVault.pinSelection(atomicSelected.resultId);
const atomicAlternate = atomicVault.put(result({
  idempotencyKey: 'provider-atomic-alternate',
  requestHash: 'c'.repeat(64),
  image: largeImage(1, 'c'),
}), binding(), authority());
const atomicBytesBefore = atomicVault.totalBytes();
assert.throws(
  () => atomicVault.put(result({
    idempotencyKey: 'provider-atomic-overflow',
    requestHash: 'd'.repeat(64),
    image: largeImage(20, 'd'),
  }), binding(), authority()),
  /VAULT_FULL/u,
);
assert.equal(atomicVault.size(), 3);
assert.equal(atomicVault.totalBytes(), atomicBytesBefore);
assert.equal(atomicVault.getForBackground(atomicAlternate.resultId).byteLength, MIB);
assert.deepEqual(atomicDiscards, [], 'a rejected put must not partially evict old alternates');
atomicVault.clear();

console.log('extension BYOK generated result vault tests passed');
