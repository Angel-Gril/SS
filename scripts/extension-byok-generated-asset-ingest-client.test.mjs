import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const modulePath = 'extensions/ss-erp/shared/byok/generated-asset-ingest-client.js';
const source = readFileSync(modulePath, 'utf8');
const context = { Array, Blob, Boolean, Error, JSON, Map, Number, Object, String, TextEncoder, Uint8Array, btoa };
context.globalThis = context;
vm.runInNewContext(source, context, { filename: modulePath });
const api = context.SS_ERP_BYOK_GENERATED_ASSET_INGEST_CLIENT;
const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' });
const internal = {
  resultId: 'br_result_1', operation: 'TEXT_TO_IMAGE', requestMode: 'json',
  profileId: 'profile-1', providerOrigin: 'https://relay.example', model: 'image-model-v1',
  policyRevision: '734', idempotencyKey: 'provider-generate-1', requestHash: 'a'.repeat(64),
  promptHash: 'b'.repeat(64), negativePromptHash: null, endpointHash: 'c'.repeat(64),
  providerRequestIdSha256: '9'.repeat(64),
  acceptedAt: '2026-07-25T15:00:00.000Z', mimeType: 'image/png', byteLength: 4,
  sha256: 'd'.repeat(64), blob,
  lifecycleEpoch: 7,
  binding: {
    ownerUserId: 'owner-1', deviceSessionId: 'session-1',
    shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
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
const transport = {
  async post(path, body, options) {
    calls.push({ kind: 'grant', path, body, options });
    return {
      state: 'response', status: 201,
      body: { code: 1, data: { grantId: 'grant-1', grantToken: 'g'.repeat(43), expiresAt: 'later' } },
    };
  },
  async postBytes(path, body, options) {
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
  getForBackground(id) {
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
const accepted = await client.ingest(input, runtimeAuthority());
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
  model: 'image-model-v1', providerRequestIdSha256: '9'.repeat(64),
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
await assert.rejects(
  client.ingest(
    { ...input, assignmentMode: 'REPLACE', replaceConfirmed: true },
    runtimeAuthority(),
  ),
  (error) => error && error.code === 'SS_ERP_BYOK_INGEST_IDEMPOTENCY_CONFLICT',
  'assignment mode and confirmation must participate in the idempotency fingerprint',
);
await assert.rejects(
  client.ingest({ ...input, assignmentOrdinal: 499 }, runtimeAuthority()),
  (error) => error && error.code === 'SS_ERP_BYOK_INGEST_IDEMPOTENCY_CONFLICT',
  'assignment ordinal must participate in the idempotency fingerprint',
);
assert.equal(calls.length, 2, 'fingerprint conflicts must fail before issuing another grant');

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
        body: { code: 1, data: { grantToken: 'h'.repeat(43) } },
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
