import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const modulePath = 'extensions/ss-erp/shared/byok/generated-asset-ingest-client.js';
const source = readFileSync(modulePath, 'utf8');
const context = { Array, Blob, Boolean, Error, JSON, Map, Number, Object, String, TextEncoder, Uint8Array, btoa };
context.globalThis = context;
vm.runInNewContext(
  readFileSync('extensions/ss-erp/shared/contracts/ai-image-workbench-v1.js', 'utf8'),
  context,
  { filename: 'extensions/ss-erp/shared/contracts/ai-image-workbench-v1.js' },
);
vm.runInNewContext(
  readFileSync('extensions/ss-erp/shared/byok/generated-result-vault.js', 'utf8'),
  context,
  { filename: 'extensions/ss-erp/shared/byok/generated-result-vault.js' },
);
vm.runInNewContext(source, context, { filename: modulePath });
const api = context.SS_ERP_BYOK_GENERATED_ASSET_INGEST_CLIENT;
const vaultApi = context.SS_ERP_BYOK_GENERATED_RESULT_VAULT;
const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' });
const ingestRequestHash = '1'.repeat(64);
const internal = {
  resultId: 'br_result_1', operation: 'TEXT_TO_IMAGE', requestMode: 'json',
  profileId: 'profile-1', providerOrigin: 'https://relay.example', model: 'image-model-v1',
  policyRevision: '734', idempotencyKey: 'provider-generate-1', requestHash: 'a'.repeat(64),
  executionIntentId: 'intent-1',
  promptHash: 'b'.repeat(64), negativePromptHash: null, endpointHash: 'c'.repeat(64),
  providerRequestIdSha256: '9'.repeat(64),
  sourceSha256: null, referenceSha256s: [], maskSha256: null,
  acceptedAt: '2026-07-25T15:00:00.000Z', mimeType: 'image/png', byteLength: 4,
  sha256: 'd'.repeat(64), blob,
  lifecycleEpoch: 7,
  binding: {
    contractVersion: 'extension-byok-readiness-binding/v2',
    ownerUserId: 'owner-1', deviceSessionId: 'session-1',
    shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
    sourcePlatform: '1688', sourceProductId: 'product-1',
    sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
    skuKey: 'sku-1', slotKey: 'sku:sku-1:hero', assignmentMode: 'APPEND',
    assignmentOrdinal: 0,
    providerOrigin: 'https://relay.example', model: 'image-model-v1',
    operation: 'TEXT_TO_IMAGE', policyRevision: '734',
  },
};
function runtimeAuthority(overrides = {}) {
  return {
    lifecycleAuthority: {
      contractVersion: 'extension-byok-device-session-lifecycle/v1',
      epoch: 7,
    },
    ownerUserId: 'owner-1',
    deviceSessionId: 'session-1',
    shopId: 'shop-1',
    workflowId: 'workflow-1',
    draftRevision: 3,
    draftVersion: 4,
    policyRevision: '734',
    ...overrides,
  };
}
function successData(overrides = {}) {
  return {
    replayed: false,
    receiptId: 'receipt-1',
    assetId: 'asset-1',
    provenanceId: 'provenance-1',
    normalizedSha256: 'e'.repeat(64),
    mimeType: 'image/png',
    width: 2,
    height: 2,
    sourceDraftRevision: 3,
    sourceDraftVersion: 4,
    boundDraftRevision: 4,
    boundDraftVersion: 5,
    assignmentOrdinal: 0,
    assignmentSha256: 'f'.repeat(64),
    skuKey: 'sku-1',
    slotKey: 'sku:sku-1:hero',
    ...overrides,
  };
}

const calls = [];
let released = 0;
let persistedIngestRequestHash = null;
const transport = {
  async post(path, body, options) {
    calls.push({ kind: 'grant', path, body, options });
    return {
      state: 'response', status: 201,
      body: {
        code: 1,
        data: {
          grantId: 'grant-1', grantToken: 'g'.repeat(43),
          requestHash: ingestRequestHash, expiresAt: 'later',
        },
      },
    };
  },
  async postBytes(path, body, options) {
    assert.equal(
      persistedIngestRequestHash,
      ingestRequestHash,
      'the exact grant request hash must persist before binary dispatch',
    );
    calls.push({ kind: 'bytes', path, body, options });
    return {
      state: 'response', status: 200,
      body: {
        code: 1,
        data: successData(),
      },
    };
  },
};
const vault = {
  getApprovedForBackground(id) {
    if (id !== internal.resultId) throw new Error('missing');
    return internal;
  },
  release(id) { assert.equal(id, internal.resultId); released += 1; return true; },
};
const currentAuthority = async (snapshot) => snapshot && snapshot.epoch === 7;
const client = api.createClient({ transport, vault, isAuthorityCurrent: currentAuthority });
const input = {
  resultId: internal.resultId, shopId: 'shop-1', workflowId: 'workflow-1',
  draftRevision: 3, draftVersion: 4, skuKey: 'sku-1', slotKey: 'sku:sku-1:hero',
  assignmentMode: 'APPEND', replaceConfirmed: false, assignmentOrdinal: 0,
  idempotencyKey: 'byok-ingest-operation-1',
};
const accepted = await client.ingest(
  input,
  runtimeAuthority(),
  undefined,
  async (requestHash) => { persistedIngestRequestHash = requestHash; },
);
assert.deepEqual(JSON.parse(JSON.stringify(accepted)), {
  contractVersion: 'extension-byok-generated-asset-ingest-client/v1',
  replayed: false,
  receiptId: 'receipt-1',
  assetId: 'asset-1',
  provenanceId: 'provenance-1',
  normalizedSha256: 'e'.repeat(64),
  mimeType: 'image/png',
  width: 2,
  height: 2,
  sourceDraftRevision: 3,
  sourceDraftVersion: 4,
  boundDraftRevision: 4,
  boundDraftVersion: 5,
  assignmentOrdinal: 0,
  assignmentSha256: 'f'.repeat(64),
  skuKey: 'sku-1',
  slotKey: 'sku:sku-1:hero',
});
assert.equal(released, 1);
assert.equal(calls.length, 2);
assert.equal(calls[0].path, '/api/extension-device/command-grants');
assert.deepEqual(JSON.parse(JSON.stringify(calls[0].body.command)), {
  schemaVersion: 'byok-media-ingest/v1',
  providerOrigin: 'https://relay.example', providerOperation: 'TEXT_TO_IMAGE', requestMode: 'json',
  model: 'image-model-v1', executionIntentId: 'intent-1',
  providerIdempotencyKey: 'provider-generate-1', providerRequestHash: 'a'.repeat(64),
  providerRequestIdSha256: '9'.repeat(64),
  promptSha256: 'b'.repeat(64), negativePromptSha256: null,
  draftRevision: 3, skuKey: 'sku-1', slotKey: 'sku:sku-1:hero',
  assignmentMode: 'APPEND', replaceConfirmed: false, assignmentOrdinal: 0,
  resultSha256: 'd'.repeat(64), resultMimeType: 'image/png', resultSizeBytes: 4,
  sourceSha256: null, referenceSha256s: [], maskSha256: null,
});
assert.equal(calls[1].body, blob, 'raw Blob must move only through the dedicated binary transport');
assert.equal(calls[1].options.commandGrant, 'g'.repeat(43));
assert.equal(calls[1].options.contentType, 'image/png');
const decodedManifest = JSON.parse(Buffer.from(calls[1].options.manifest, 'base64url').toString('utf8'));
assert.equal(decodedManifest.idempotencyKey, input.idempotencyKey);
assert.deepEqual(decodedManifest.command, JSON.parse(JSON.stringify(calls[0].body.command)));
assert.equal(JSON.stringify(client.getOperationState(input.idempotencyKey)).includes('g'.repeat(43)), false);
assert.deepEqual(
  JSON.parse(JSON.stringify(await client.ingest(input, runtimeAuthority()))),
  JSON.parse(JSON.stringify(accepted)),
  'successful replay must not issue another grant or upload',
);
assert.equal(calls.length, 2);

for (const [index, role] of ['SCENE', 'DETAIL', 'SPEC', 'PACKAGING'].entries()) {
  const slotKey = `shared:detail:${role}`;
  const assignmentOrdinal = index + 1;
  const resultId = `br_result_shared_${role.toLowerCase()}`;
  const sharedInternal = {
    ...internal,
    resultId,
    idempotencyKey: `provider-shared-${role.toLowerCase()}-1`,
    executionIntentId: `intent-shared-${role.toLowerCase()}`,
    binding: {
      ...internal.binding,
      slotKey,
      assignmentOrdinal,
    },
  };
  let sharedGrantCalls = 0;
  let sharedUploadCalls = 0;
  const sharedClient = api.createClient({
    transport: {
      async post() {
        sharedGrantCalls += 1;
        return {
          state: 'response', status: 201,
          body: {
            code: 1,
            data: {
              grantId: `grant-shared-${index}`,
              grantToken: 'h'.repeat(43),
              requestHash: ingestRequestHash,
              expiresAt: 'later',
            },
          },
        };
      },
      async postBytes() {
        sharedUploadCalls += 1;
        return {
          state: 'response', status: 200,
          body: {
            code: 1,
            data: successData({ slotKey, assignmentOrdinal }),
          },
        };
      },
    },
    vault: {
      getApprovedForBackground(id) {
        assert.equal(id, resultId);
        return sharedInternal;
      },
      release(id) {
        assert.equal(id, resultId);
        return true;
      },
    },
    isAuthorityCurrent: currentAuthority,
  });
  const sharedReceipt = await sharedClient.ingest({
    ...input,
    resultId,
    slotKey,
    assignmentOrdinal,
    idempotencyKey: `byok-ingest-shared-${role.toLowerCase()}`,
  }, runtimeAuthority());
  assert.equal(sharedReceipt.slotKey, slotKey);
  assert.equal(sharedGrantCalls, 1);
  assert.equal(sharedUploadCalls, 1);
}

await assert.rejects(
  client.ingest(
    { ...input, assignmentMode: 'REPLACE', replaceConfirmed: true },
    runtimeAuthority(),
  ),
  (error) => error && error.code === 'SS_ERP_BYOK_INGEST_INPUT_INVALID',
  'REPLACE must fail closed before idempotency or transport work',
);
await assert.rejects(
  client.ingest({ ...input, assignmentOrdinal: 499 }, runtimeAuthority()),
  (error) => error && error.code === 'SS_ERP_BYOK_INGEST_IDEMPOTENCY_CONFLICT',
  'assignment ordinal must participate in the idempotency fingerprint',
);
assert.equal(calls.length, 2, 'fingerprint conflicts must fail before issuing another grant');

for (const [name, bindingOverrides] of Object.entries({
  sku: { skuKey: 'sku-2', slotKey: 'sku:sku-2:hero' },
  slot: { slotKey: 'sku:sku-1:detail' },
  mode: { assignmentMode: 'REPLACE' },
  ordinal: { assignmentOrdinal: 1 },
})) {
  const mismatchVault = {
    getApprovedForBackground() {
      return { ...internal, binding: { ...internal.binding, ...bindingOverrides } };
    },
    release() { throw new Error('mismatched binding must not release'); },
  };
  const mismatchClient = api.createClient({
    transport: {
      async post() { throw new Error('mismatched binding must not request a grant'); },
      async postBytes() { throw new Error('mismatched binding must not upload'); },
    },
    vault: mismatchVault,
    isAuthorityCurrent: currentAuthority,
  });
  await assert.rejects(
    mismatchClient.ingest({
      ...input,
      idempotencyKey: `byok-ingest-binding-${name}`,
    }, runtimeAuthority()),
    (error) => error && error.code === 'SS_ERP_BYOK_INGEST_BINDING_MISMATCH',
    `${name} must remain bound to the approved vault result`,
  );
}

const realVault = vaultApi.createVault({
  now: () => new Date('2026-07-25T15:00:00.000Z'),
  randomValues(bytes) { bytes.fill(0x44); },
});
const realPublic = realVault.put({
  outcome: 'SUCCEEDED', operation: 'TEXT_TO_IMAGE', requestMode: 'json',
  profileId: internal.profileId, providerOrigin: internal.providerOrigin, model: internal.model,
  policyRevision: internal.policyRevision, idempotencyKey: internal.idempotencyKey,
  executionIntentId: internal.executionIntentId,
  requestHash: internal.requestHash, promptHash: internal.promptHash,
  negativePromptHash: internal.negativePromptHash, endpointHash: internal.endpointHash,
  providerRequestIdSha256: internal.providerRequestIdSha256,
  acceptedAt: internal.acceptedAt,
  image: { blob, mimeType: internal.mimeType, byteLength: blob.size, sha256: internal.sha256 },
}, internal.binding, {
  contractVersion: 'extension-byok-device-session-lifecycle/v1', epoch: 7,
});
realVault.approve(realPublic.resultId, internal.binding);
let realGrantCalls = 0;
let realUploadCalls = 0;
const realClient = api.createClient({
  vault: realVault,
  isAuthorityCurrent: currentAuthority,
  transport: {
    async post() {
      realGrantCalls += 1;
      return {
        state: 'response', status: 201,
        body: { code: 1, data: { grantToken: 'r'.repeat(43), requestHash: ingestRequestHash } },
      };
    },
    async postBytes() {
      realUploadCalls += 1;
      return { state: 'response', status: 200, body: { code: 1, data: successData() } };
    },
  },
});
const realInput = { ...input, resultId: realPublic.resultId, idempotencyKey: 'byok-real-replay-0001' };
const realAccepted = await realClient.ingest(realInput, runtimeAuthority());
assert.equal(realVault.size(), 0, 'successful ingest must remove the real Blob from the vault');
assert.deepEqual(
  JSON.parse(JSON.stringify(await realClient.ingest(realInput, runtimeAuthority()))),
  JSON.parse(JSON.stringify(realAccepted)),
  'successful replay must use the saved receipt after the real vault entry was released',
);
assert.equal(realGrantCalls, 1);
assert.equal(realUploadCalls, 1);

const pendingPublic = realVault.put({
  outcome: 'SUCCEEDED', operation: 'TEXT_TO_IMAGE', requestMode: 'json',
  profileId: internal.profileId, providerOrigin: internal.providerOrigin, model: internal.model,
  policyRevision: internal.policyRevision, idempotencyKey: 'provider-pending-commit-1',
  executionIntentId: 'intent-pending-commit-1',
  requestHash: '2'.repeat(64), promptHash: internal.promptHash,
  negativePromptHash: internal.negativePromptHash, endpointHash: internal.endpointHash,
  providerRequestIdSha256: internal.providerRequestIdSha256,
  acceptedAt: internal.acceptedAt,
  image: { blob, mimeType: internal.mimeType, byteLength: blob.size, sha256: internal.sha256 },
}, internal.binding, {
  contractVersion: 'extension-byok-device-session-lifecycle/v1', epoch: 7,
});
realVault.approve(pendingPublic.resultId, internal.binding);
let pendingUploads = 0;
const pendingClient = api.createClient({
  vault: realVault,
  isAuthorityCurrent: currentAuthority,
  transport: {
    async post() {
      return {
        state: 'response', status: 201,
        body: { code: 1, data: { grantToken: 'p'.repeat(43), requestHash: ingestRequestHash } },
      };
    },
    async postBytes() {
      pendingUploads += 1;
      return { state: 'response', status: 200, body: { code: 1, data: successData() } };
    },
  },
});
const pendingInput = {
  ...input,
  resultId: pendingPublic.resultId,
  idempotencyKey: 'byok-receipt-pending-0001',
};
await assert.rejects(
  pendingClient.ingest(pendingInput, runtimeAuthority(), async () => {
    throw new Error('session storage temporarily unavailable');
  }),
  (error) => error
    && error.code === 'SS_ERP_BYOK_INGEST_RECEIPT_COMMIT_FAILED'
    && error.outcome === 'FAILED_RETRYABLE',
);
assert.equal(realVault.size(), 1, 'receipt commit failure must retain the approved Blob');
let committedReceipt = null;
const recoveredPending = await pendingClient.ingest(
  pendingInput,
  runtimeAuthority(),
  async (receipt) => { committedReceipt = receipt; },
);
assert.equal(committedReceipt.receiptId, recoveredPending.receiptId);
assert.equal(realVault.size(), 0);
assert.equal(pendingUploads, 1, 'receipt commit retry must not upload the image a second time');

const invalidInputs = [
  { ...input, idempotencyKey: 'byok-ingest-invalid-01', assignmentMode: 'INSERT' },
  { ...input, idempotencyKey: 'byok-ingest-invalid-02', replaceConfirmed: true },
  {
    ...input,
    idempotencyKey: 'byok-ingest-invalid-03',
    assignmentMode: 'REPLACE',
    replaceConfirmed: false,
  },
  { ...input, idempotencyKey: 'byok-ingest-invalid-04', assignmentOrdinal: -1 },
  { ...input, idempotencyKey: 'byok-ingest-invalid-05', assignmentOrdinal: 500 },
  { ...input, idempotencyKey: 'byok-ingest-invalid-06', assignmentOrdinal: 1.5 },
  { ...input, idempotencyKey: 'byok-ingest-invalid-07', slotKey: 'sku:sku-2:hero' },
  { ...input, idempotencyKey: 'byok-ingest-invalid-08', slotKey: 'sku:sku-1:detail:1' },
  { ...input, idempotencyKey: 'byok-ingest-invalid-09', slotKey: 'group:visual-1:detail:SCENE' },
  { ...input, idempotencyKey: 'byok-ingest-invalid-10', slotKey: 'shared:detail:FUNCTION' },
  { ...input, idempotencyKey: 'byok-ingest-invalid-11', slotKey: 'shared:detail:SPECIFICATION' },
  { ...input, idempotencyKey: 'byok-ingest-invalid-12', slotKey: 'shared:detail:scene' },
  { ...input, idempotencyKey: 'byok-ingest-invalid-13', slotKey: 'shared:detail:SCENE:extra' },
  {
    ...input,
    idempotencyKey: 'byok-ingest-invalid-14',
    slotKey: 'shared:detail:SCENE',
    assignmentMode: 'REPLACE',
    replaceConfirmed: true,
  },
  Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'assignmentMode')),
  { ...input, unexpectedAssignmentField: true },
];
for (const invalidInput of invalidInputs) {
  await assert.rejects(
    client.ingest(invalidInput, runtimeAuthority()),
    (error) => error && error.code === 'SS_ERP_BYOK_INGEST_INPUT_INVALID',
  );
}
assert.equal(calls.length, 2, 'invalid assignment input must fail before transport');

let unknownCalls = 0;
const retryClient = api.createClient({
  vault,
  isAuthorityCurrent: currentAuthority,
  transport: {
    post: transport.post,
    async postBytes() {
      unknownCalls += 1;
      if (unknownCalls === 1) throw new Error('connection lost after dispatch');
      return transport.postBytes(...arguments);
    },
  },
});
await assert.rejects(retryClient.ingest(
  { ...input, idempotencyKey: 'byok-ingest-operation-2' },
  runtimeAuthority(),
), (error) => (
  error && error.outcome === 'UNKNOWN_OUTCOME'
));
assert.equal(retryClient.getOperationState('byok-ingest-operation-2').hasGrant, true);
await retryClient.ingest(
  { ...input, idempotencyKey: 'byok-ingest-operation-2' },
  runtimeAuthority(),
);
assert.equal(unknownCalls, 2);

let pendingReplayCalls = 0;
const pendingReplayClient = api.createClient({
  vault,
  isAuthorityCurrent: currentAuthority,
  transport: {
    post: transport.post,
    async postBytes() {
      pendingReplayCalls += 1;
      if (pendingReplayCalls === 1) throw new Error('response lost after dispatch');
      if (pendingReplayCalls === 2) {
        return {
          state: 'http_error', status: 409,
          body: { code: 0, errorCode: 'byok_ingest_receipt_pending' },
        };
      }
      return { state: 'response', status: 200, body: { code: 1, data: successData() } };
    },
  },
});
const pendingReplayInput = { ...input, idempotencyKey: 'byok-ingest-pending-replay-1' };
await assert.rejects(
  pendingReplayClient.ingest(pendingReplayInput, runtimeAuthority()),
  (error) => error && error.outcome === 'UNKNOWN_OUTCOME',
);
await assert.rejects(
  pendingReplayClient.ingest(pendingReplayInput, runtimeAuthority()),
  (error) => error
    && error.code === 'SS_ERP_BYOK_INGEST_UNKNOWN_OUTCOME'
    && error.outcome === 'UNKNOWN_OUTCOME',
  'a server-side PENDING receipt must remain recoverable with the same key',
);
assert.equal(
  pendingReplayClient.getOperationState(pendingReplayInput.idempotencyKey).status,
  'UNKNOWN_OUTCOME',
);
await pendingReplayClient.ingest(pendingReplayInput, runtimeAuthority());
assert.equal(pendingReplayCalls, 3);

let recoveryChecks = 0;
let recoveredReceipt = null;
const recoveryClient = api.createClient({
  vault: {
    getApprovedForBackground() { throw new Error('recovery must not require lost Blob bytes'); },
    release() { return false; },
  },
  isAuthorityCurrent: currentAuthority,
  transport: {
    async post(path, body) {
      assert.equal(path, '/api/extension-device/byok-media/ingest-status');
      assert.equal(body.requestHash, ingestRequestHash);
      recoveryChecks += 1;
      if (recoveryChecks === 1) {
        return {
          state: 'response', status: 202,
          body: { code: 1, data: { state: 'PENDING' } },
        };
      }
      if (recoveryChecks === 2) {
        return {
          state: 'response', status: 202,
          body: { code: 1, data: { state: 'NOT_COMMITTED' } },
        };
      }
      return {
        state: 'response', status: 200,
        body: { code: 1, data: { state: 'SUCCEEDED', ...successData({ replayed: true }) } },
      };
    },
    async postBytes() { throw new Error('receipt recovery must not upload bytes'); },
  },
});
const recoveryInput = {
  ...input,
  idempotencyKey: 'byok-ingest-recovery-0001',
  requestHash: ingestRequestHash,
};
await assert.rejects(
  recoveryClient.recover(
    { ...recoveryInput, requestHash: null },
    runtimeAuthority(),
  ),
  (error) => error
    && error.code === 'SS_ERP_BYOK_INGEST_REQUEST_HASH_REQUIRED'
    && error.outcome === 'FAILED_FINAL',
);
await assert.rejects(
  recoveryClient.recover(recoveryInput, runtimeAuthority()),
  (error) => error
    && error.code === 'SS_ERP_BYOK_INGEST_RECEIPT_PENDING'
    && error.outcome === 'UNKNOWN_OUTCOME',
);
await assert.rejects(
  recoveryClient.recover(recoveryInput, runtimeAuthority()),
  (error) => error
    && error.code === 'SS_ERP_BYOK_INGEST_RECEIPT_NOT_COMMITTED'
    && error.outcome === 'UNKNOWN_OUTCOME',
);
const recovered = await recoveryClient.recover(
  recoveryInput,
  runtimeAuthority(),
  async (receipt) => { recoveredReceipt = receipt; },
);
assert.equal(recoveredReceipt.receiptId, recovered.receiptId);
assert.equal(recovered.replayed, true);
assert.equal(recoveryChecks, 3);
assert.equal(
  recoveryClient.getOperationState(recoveryInput.idempotencyKey).status,
  'SUCCEEDED',
);

let regrantCalls = 0;
let regrantUploads = 0;
const regrantTokens = ['q'.repeat(43), 'r'.repeat(43)];
const regrantClient = api.createClient({
  vault,
  isAuthorityCurrent: currentAuthority,
  transport: {
    async post(path) {
      if (path === '/api/extension-device/byok-media/ingest-status') {
        return {
          state: 'response', status: 202,
          body: { code: 1, data: { state: 'NOT_COMMITTED' } },
        };
      }
      const grantToken = regrantTokens[regrantCalls];
      regrantCalls += 1;
      return {
        state: 'response', status: 201,
        body: { code: 1, data: { grantToken, requestHash: ingestRequestHash } },
      };
    },
    async postBytes(_path, _body, options) {
      regrantUploads += 1;
      if (regrantUploads === 1) throw new Error('first upload response was lost');
      assert.equal(options.commandGrant, regrantTokens[1], 'retry must use a newly signed grant');
      return { state: 'response', status: 200, body: { code: 1, data: successData() } };
    },
  },
});
const regrantInput = { ...input, idempotencyKey: 'byok-ingest-regrant-0001' };
await assert.rejects(
  regrantClient.ingest(regrantInput, runtimeAuthority()),
  (error) => error && error.outcome === 'UNKNOWN_OUTCOME',
);
assert.equal(regrantClient.getOperationState(regrantInput.idempotencyKey).hasGrant, true);
await assert.rejects(
  regrantClient.recover(
    { ...regrantInput, requestHash: ingestRequestHash },
    runtimeAuthority(),
  ),
  (error) => error && error.code === 'SS_ERP_BYOK_INGEST_RECEIPT_NOT_COMMITTED',
);
assert.equal(
  regrantClient.getOperationState(regrantInput.idempotencyKey).hasGrant,
  false,
  'authoritative NOT_COMMITTED must retire the old command grant before byte resend',
);
await regrantClient.ingest(
  { ...regrantInput, requestHash: ingestRequestHash },
  runtimeAuthority(),
);
assert.equal(regrantCalls, 2);
assert.equal(regrantUploads, 2);

for (const [name, response, code] of [
  [
    'not found',
    { state: 'http_error', status: 404, body: { code: 0, errorCode: 'byok_ingest_status_not_found' } },
    'SS_ERP_BYOK_INGEST_RECEIPT_NOT_FOUND',
  ],
  [
    'failed',
    { state: 'http_error', status: 409, body: { code: 0, errorCode: 'byok_ingest_status_failed' } },
    'SS_ERP_BYOK_INGEST_RECEIPT_FAILED',
  ],
]) {
  const terminalClient = api.createClient({
    vault,
    isAuthorityCurrent: currentAuthority,
    transport: {
      async post() { return response; },
      async postBytes() { throw new Error(name + ' recovery must not upload'); },
    },
  });
  const terminalInput = {
    ...recoveryInput,
    idempotencyKey: 'byok-ingest-terminal-' + name.replace(' ', '-'),
  };
  await assert.rejects(
    terminalClient.recover(terminalInput, runtimeAuthority()),
    (error) => error && error.code === code && error.outcome === 'FAILED_FINAL',
  );
  if (name === 'not found') {
    assert.equal(
      terminalClient.getOperationState(terminalInput.idempotencyKey),
      null,
      'an exact authenticated status 404 must clear the retired client operation',
    );
  } else {
    assert.equal(terminalClient.getOperationState(terminalInput.idempotencyKey).status, 'FAILED_FINAL');
  }
}

const proxyNotFoundClient = api.createClient({
  vault,
  isAuthorityCurrent: currentAuthority,
  transport: {
    async post() {
      return { state: 'http_error', status: 404, body: { code: 0, errorCode: 'route_not_found' } };
    },
    async postBytes() { throw new Error('non-authoritative recovery 404 must not upload'); },
  },
});
await assert.rejects(
  proxyNotFoundClient.recover({
    ...recoveryInput,
    idempotencyKey: 'byok-ingest-proxy-status-not-found',
  }, runtimeAuthority()),
  (error) => error
    && error.code === 'SS_ERP_BYOK_INGEST_RECOVERY_UNAVAILABLE'
    && error.outcome === 'UNKNOWN_OUTCOME',
  'only the exact authenticated status error may prove that no grant exists',
);

for (const status of [400, 403, 404]) {
  let binaryCalls = 0;
  const deniedGrantClient = api.createClient({
    vault,
    isAuthorityCurrent: currentAuthority,
    transport: {
      async post() {
        return { state: 'http_error', status, body: { code: 0, errorCode: 'grant_denied' } };
      },
      async postBytes() { binaryCalls += 1; },
    },
  });
  await assert.rejects(
    deniedGrantClient.ingest({
      ...input,
      idempotencyKey: 'byok-ingest-grant-denied-' + status,
    }, runtimeAuthority()),
    (error) => error
      && error.code === 'SS_ERP_BYOK_INGEST_GRANT_REJECTED'
      && error.outcome === 'FAILED_FINAL',
  );
  assert.equal(binaryCalls, 0);
}

for (const [status, errorCode, suffix] of [
  [401, 'byok_ingest_grant_required', 'required'],
  [410, 'byok_ingest_grant_expired', 'expired'],
]) {
  const refreshableGrantClient = api.createClient({
    vault,
    isAuthorityCurrent: currentAuthority,
    transport: {
      async post() {
        return {
          state: 'response', status: 201,
          body: {
            code: 1,
            data: { grantToken: 'x'.repeat(43), requestHash: ingestRequestHash },
          },
        };
      },
      async postBytes() {
        return { state: 'http_error', status, body: { code: 0, errorCode } };
      },
    },
  });
  const refreshableGrantInput = {
    ...input,
    idempotencyKey: 'byok-ingest-refresh-grant-' + suffix,
  };
  await assert.rejects(
    refreshableGrantClient.ingest(refreshableGrantInput, runtimeAuthority()),
    (error) => error
      && error.code === 'SS_ERP_BYOK_INGEST_GRANT_UNAVAILABLE'
      && error.outcome === 'FAILED_RETRYABLE'
      && error.resetGrant === true,
  );
  assert.equal(
    refreshableGrantClient.getOperationState(refreshableGrantInput.idempotencyKey).hasGrant,
    false,
    'a missing or expired command grant must retire only the grant token',
  );
}

let discardedUploadCalls = 0;
const discardedClient = api.createClient({
  vault,
  isAuthorityCurrent: currentAuthority,
  transport: {
    post: transport.post,
    async postBytes() {
      discardedUploadCalls += 1;
      throw new Error('connection lost');
    },
  },
});
const discardedInput = { ...input, idempotencyKey: 'byok-ingest-discarded-0001' };
await assert.rejects(
  discardedClient.ingest(discardedInput, runtimeAuthority()),
  (error) => error && error.outcome === 'UNKNOWN_OUTCOME',
);
assert.equal(discardedClient.getOperationState(discardedInput.idempotencyKey).hasGrant, true);
assert.equal(discardedClient.discardResult(internal.resultId), 1);
assert.equal(discardedClient.getOperationState(discardedInput.idempotencyKey), null);
assert.equal(discardedUploadCalls, 1);

const invalidResponses = [
  { sourceDraftRevision: 2 },
  { sourceDraftVersion: 3 },
  { boundDraftRevision: 3 },
  { boundDraftVersion: 6 },
  { assignmentOrdinal: 1 },
  { assignmentSha256: 'not-a-sha256' },
  { skuKey: 'sku-other' },
  { slotKey: 'sku:sku-1:detail' },
];
for (const [index, responseOverrides] of invalidResponses.entries()) {
  const invalidResponseClient = api.createClient({
    vault,
    isAuthorityCurrent: currentAuthority,
    transport: {
      post: transport.post,
      async postBytes() {
        return {
          state: 'response',
          status: 200,
          body: { code: 1, data: successData(responseOverrides) },
        };
      },
    },
  });
  await assert.rejects(
    invalidResponseClient.ingest({
      ...input,
      idempotencyKey: `byok-ingest-invalid-response-${String(index).padStart(2, '0')}`,
    }, runtimeAuthority()),
    (error) => error
      && error.code === 'SS_ERP_BYOK_INGEST_RESPONSE_INVALID'
      && error.outcome === 'UNKNOWN_OUTCOME',
  );
}

const deniedClient = api.createClient({
  transport,
  vault,
  isAuthorityCurrent: currentAuthority,
});
await assert.rejects(
  deniedClient.ingest(
    { ...input, idempotencyKey: 'byok-ingest-operation-3', draftRevision: 5 },
    runtimeAuthority({ draftRevision: 5 }),
  ),
  (error) => error && error.code === 'SS_ERP_BYOK_INGEST_BINDING_MISMATCH',
);

for (const [name, authority] of Object.entries({
  epoch: runtimeAuthority({
    lifecycleAuthority: {
      contractVersion: 'extension-byok-device-session-lifecycle/v1',
      epoch: 8,
    },
  }),
  owner: runtimeAuthority({ ownerUserId: 'owner-2' }),
  device: runtimeAuthority({ deviceSessionId: 'session-2' }),
  shop: runtimeAuthority({ shopId: 'shop-2' }),
  workflow: runtimeAuthority({ workflowId: 'workflow-2' }),
  revision: runtimeAuthority({ draftRevision: 4 }),
  version: runtimeAuthority({ draftVersion: 5 }),
  policy: runtimeAuthority({ policyRevision: '735' }),
})) {
  const mismatchClient = api.createClient({
    transport,
    vault,
    isAuthorityCurrent: async () => true,
  });
  await assert.rejects(
    mismatchClient.ingest({
      ...input,
      idempotencyKey: `byok-ingest-authority-${name}`,
      shopId: authority.shopId,
      workflowId: authority.workflowId,
      draftRevision: authority.draftRevision,
      draftVersion: authority.draftVersion,
    }, authority),
    (error) => error && error.code === 'SS_ERP_BYOK_INGEST_BINDING_MISMATCH',
  );
}

let liveEpoch = true;
let staleBinaryCalls = 0;
const staleClient = api.createClient({
  vault,
  isAuthorityCurrent: async () => liveEpoch,
  transport: {
    async post() {
      liveEpoch = false;
      return {
        state: 'response', status: 201,
        body: { code: 1, data: { grantToken: 'h'.repeat(43), requestHash: ingestRequestHash } },
      };
    },
    async postBytes() { staleBinaryCalls += 1; throw new Error('must not upload'); },
  },
});
await assert.rejects(
  staleClient.ingest(
    { ...input, idempotencyKey: 'byok-ingest-disconnect-race' },
    runtimeAuthority(),
  ),
  (error) => error
    && error.code === 'SS_ERP_BYOK_INGEST_AUTHORITY_STALE'
    && error.outcome === 'FAILED_FINAL',
);
assert.equal(staleBinaryCalls, 0, 'disconnect after grant must stop before binary upload');

console.log('extension BYOK generated asset ingest client tests passed');
