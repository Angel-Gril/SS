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
const vault = api.createVault({
  now: () => now,
  randomValues(bytes) { bytes.fill(randomByte++); return bytes; },
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

assert.throws(() => vault.getApprovedForBackground(stored.resultId), /APPROVAL_REQUIRED/u);
const approved = vault.approve(stored.resultId, binding());
assert.equal(approved.reviewState, 'APPROVED');
assert.equal(approved.reviewedAt, '2026-07-25T15:00:00.000Z');
assert.equal(vault.getApprovedForBackground(stored.resultId).blob, blob);
assert.throws(() => vault.reject(stored.resultId, binding()), /REVIEW_INVALID/u);
assert.throws(
  () => vault.put(
    result({ idempotencyKey: 'provider-generate-context' }),
    { ...binding(), ownerUserId: undefined },
    authority(),
  ),
  /RESULT_INVALID/u,
);

now = new Date('2026-07-25T15:10:00.001Z');
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

console.log('extension BYOK generated result vault tests passed');
