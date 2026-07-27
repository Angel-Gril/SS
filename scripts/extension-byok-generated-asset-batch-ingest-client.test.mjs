import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const modulePath = 'extensions/ss-erp/shared/byok/generated-asset-batch-ingest-client.js';
const context = {
  Array, Blob, Boolean, Error, FormData, JSON, Map, Number, Object, Set, String, URL,
};
context.globalThis = context;
vm.runInNewContext(readFileSync(modulePath, 'utf8'), context, { filename: modulePath });
const api = context.SS_ERP_BYOK_GENERATED_ASSET_BATCH_INGEST_CLIENT;

const REQUEST_HASH = 'f'.repeat(64);
const blobBytes = [
  new Uint8Array([1, 2, 3, 4]),
  new Uint8Array([5, 6, 7, 8]),
  new Uint8Array([9, 10, 11, 12]),
  new Uint8Array([13, 14, 15, 16]),
];

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function authority(overrides = {}) {
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

function approvedResult(index, overrides = {}, bindingOverrides = {}) {
  const skuKey = `sku-${index + 1}`;
  const bytes = blobBytes[index];
  const blob = new Blob([bytes], { type: 'image/png' });
  return {
    resultId: `br_result_${index + 1}`,
    operation: 'TEXT_TO_IMAGE',
    requestMode: 'json',
    profileId: 'profile-1',
    providerOrigin: 'https://relay.example',
    model: 'image-model-v1',
    policyRevision: '734',
    idempotencyKey: `provider-attempt-${String(index + 1).padStart(4, '0')}`,
    requestHash: String(index + 1).repeat(64),
    executionIntentId: `intent-${index + 1}`,
    promptHash: 'a'.repeat(64),
    negativePromptHash: null,
    endpointHash: 'b'.repeat(64),
    providerRequestIdSha256: null,
    sourceSha256: null,
    referenceSha256s: [],
    maskSha256: null,
    acceptedAt: '2026-07-28T08:00:00.000Z',
    mimeType: 'image/png',
    byteLength: blob.size,
    sha256: String(index + 5).repeat(64),
    blob,
    reviewState: 'APPROVED',
    reviewedAt: '2026-07-28T08:01:00.000Z',
    lifecycleEpoch: 7,
    binding: {
      contractVersion: 'extension-byok-readiness-binding/v2',
      ownerUserId: 'owner-1',
      deviceSessionId: 'session-1',
      shopId: 'shop-1',
      workflowId: 'workflow-1',
      draftRevision: 3,
      draftVersion: 4,
      sourcePlatform: '1688',
      sourceProductId: 'product-1',
      sourceCaptureSnapshotId: 'snapshot-1',
      supplyGoodsId: 'goods-1',
      skuKey,
      slotKey: `sku:${skuKey}:hero`,
      assignmentMode: 'APPEND',
      assignmentOrdinal: index,
      providerOrigin: 'https://relay.example',
      model: 'image-model-v1',
      operation: 'TEXT_TO_IMAGE',
      policyRevision: '734',
      ...bindingOverrides,
    },
    ...overrides,
  };
}

function input(results, overrides = {}) {
  return {
    executionBatchId: 'execution-batch-1',
    resultIds: results.map((result) => result.resultId),
    shopId: 'shop-1',
    workflowId: 'workflow-1',
    draftRevision: 3,
    draftVersion: 4,
    idempotencyKey: 'byok-batch-ingest-0001',
    ...overrides,
  };
}

function commandItem(result) {
  return {
    schemaVersion: 'byok-media-ingest/v1',
    providerOrigin: result.providerOrigin,
    providerOperation: result.operation,
    requestMode: result.requestMode,
    model: result.model,
    executionIntentId: result.executionIntentId,
    providerIdempotencyKey: result.idempotencyKey,
    providerRequestHash: result.requestHash,
    providerRequestIdSha256: result.providerRequestIdSha256,
    promptSha256: result.promptHash,
    negativePromptSha256: result.negativePromptHash,
    draftRevision: result.binding.draftRevision,
    skuKey: result.binding.skuKey,
    slotKey: result.binding.slotKey,
    assignmentMode: 'APPEND',
    replaceConfirmed: false,
    assignmentOrdinal: result.binding.assignmentOrdinal,
    resultSha256: result.sha256,
    resultMimeType: result.mimeType,
    resultSizeBytes: result.byteLength,
    sourceSha256: result.sourceSha256,
    referenceSha256s: result.referenceSha256s,
    maskSha256: result.maskSha256,
  };
}

function receiptItem(result, index, overrides = {}) {
  const assetId = `asset-${index + 1}`;
  const shared = result.binding.slotKey.startsWith('shared:detail:');
  const source = ['FULL_EDIT', 'INPAINT'].includes(result.operation) ? 'EDITED' : 'GENERATED';
  return {
    assetId,
    provenanceId: `provenance-${index + 1}`,
    executionIntentId: result.executionIntentId,
    providerRequestHash: result.requestHash,
    providerResultSha256: result.sha256,
    normalizedSha256: String(index + 5).repeat(64),
    mimeType: 'image/png',
    width: 1200,
    height: 1600,
    assignmentOrdinal: result.binding.assignmentOrdinal,
    assignmentSha256: String(index + 1).repeat(64),
    skuKey: result.binding.skuKey,
    slotKey: result.binding.slotKey,
    assignment: shared ? {
      scope: 'PRODUCT',
      slotKey: result.binding.slotKey,
      assetId,
      source,
    } : {
      scope: 'SKU',
      skuKey: result.binding.skuKey,
      slotKey: result.binding.slotKey,
      assetId,
      source,
    },
    policyRevision: Number(result.policyRevision),
    ...overrides,
  };
}

function receipt(results, overrides = {}) {
  return {
    contractVersion: 'extension-byok-media-batch-ingest-receipt/v1',
    executionBatchId: 'execution-batch-1',
    replayed: false,
    receiptId: 'receipt-batch-1',
    requestHash: REQUEST_HASH,
    sourceDraftRevision: 3,
    sourceDraftVersion: 4,
    boundDraftRevision: 4,
    boundDraftVersion: 5,
    erpAiChargeCents: 0,
    items: results.map((result, index) => receiptItem(result, index)),
    ...overrides,
  };
}

function normalizedClientReceipt(results, overrides = {}) {
  const value = receipt(results, overrides);
  return {
    ...value,
    items: value.items.map((item) => ({
      ...item,
      policyRevision: String(item.policyRevision),
    })),
  };
}

function response(data) {
  return { state: 'response', status: 200, body: { code: 1, data } };
}

function createHarness(results, overrides = {}) {
  const byId = new Map(results.map((result) => [result.resultId, result]));
  const events = [];
  let grants = 0;
  let uploads = 0;
  let authorityChecks = 0;
  const vault = {
    getApprovedForBackground(resultId) {
      events.push(`get:${resultId}`);
      const result = byId.get(resultId);
      if (!result) throw new Error('result is not locally APPROVED');
      return result;
    },
    release(resultId) {
      events.push(`release:${resultId}`);
      assert.ok(byId.has(resultId));
      return true;
    },
  };
  const transport = {
    async post(path, body, options) {
      if (path === '/api/extension-device/byok-media/batch-ingest-status') {
        events.push('status');
        if (overrides.postStatus) return overrides.postStatus(path, body, options);
        return { state: 'response', status: 202, body: { code: 1, data: { state: 'PENDING' } } };
      }
      grants += 1;
      events.push('grant');
      if (overrides.post) return overrides.post(path, body, options);
      return {
        state: 'response', status: 201,
        body: {
          code: 1,
          data: {
            grantId: 'grant-batch-1',
            grantToken: 'g'.repeat(43),
            requestHash: REQUEST_HASH,
            expiresAt: 'later',
          },
        },
      };
    },
    async postMultipart(path, form, options) {
      uploads += 1;
      events.push('multipart');
      if (overrides.postMultipart) return overrides.postMultipart(path, form, options);
      return response(receipt(results));
    },
  };
  const client = api.createClient({
    transport,
    vault,
    async isAuthorityCurrent(snapshot) {
      authorityChecks += 1;
      if (overrides.isAuthorityCurrent) return overrides.isAuthorityCurrent(snapshot);
      return snapshot && snapshot.epoch === 7;
    },
  });
  return {
    client,
    events,
    counts() { return { grants, uploads, authorityChecks }; },
  };
}

assert.equal(api.CONTRACT_VERSION, 'extension-byok-generated-asset-batch-ingest-client/v1');
assert.equal(api.COMMAND_VERSION, 'byok-media-ingest-batch/v1');
assert.equal(api.MANIFEST_VERSION, 'extension-byok-media-batch-ingest-manifest/v1');
assert.equal(api.RECEIPT_VERSION, 'extension-byok-media-batch-ingest-receipt/v1');
assert.equal(api.INGEST_PATH, '/api/extension-device/byok-media/batch-ingest');
assert.equal(api.STATUS_PATH, '/api/extension-device/byok-media/batch-ingest-status');
assert.equal(api.MAX_BATCH_BYTES, 50 * 1024 * 1024);
assert.throws(() => api.createClient({}), /dependencies are unavailable/u);

const primaryResults = [
  approvedResult(0),
  approvedResult(1, {}, { slotKey: 'shared:detail:DETAIL' }),
];
let capturedGrant = null;
let capturedManifest = null;
const primary = createHarness(primaryResults, {
  post(path, body, options) {
    capturedGrant = { path, body: plain(body), options: plain(options) };
    return {
      state: 'response', status: 201,
      body: {
        code: 1,
        data: {
          grantId: 'grant-batch-1', grantToken: 'g'.repeat(43),
          requestHash: REQUEST_HASH, expiresAt: 'later',
        },
      },
    };
  },
  async postMultipart(path, form, options) {
    assert.equal(path, '/api/extension-device/byok-media/batch-ingest');
    assert.ok(form instanceof FormData);
    assert.deepEqual(plain(options), {
      requiredScope: 'byok:media:ingest',
      commandGrant: 'g'.repeat(43),
    });
    const entries = [...form.entries()];
    assert.deepEqual(entries.map(([name]) => name), ['manifest', 'image-0', 'image-1']);
    assert.equal(typeof entries[0][1], 'string');
    capturedManifest = JSON.parse(entries[0][1]);
    assert.deepEqual(Object.keys(capturedManifest), [
      'contractVersion', 'operation', 'shopId', 'workflowId', 'draftVersion',
      'idempotencyKey', 'executionBatchId', 'command',
    ]);
    assert.equal(JSON.stringify(capturedManifest).includes('blob'), false);
    assert.equal(JSON.stringify(capturedManifest).includes('base64'), false);
    for (let index = 0; index < primaryResults.length; index += 1) {
      const file = entries[index + 1][1];
      assert.ok(file instanceof Blob);
      assert.deepEqual(
        [...new Uint8Array(await file.arrayBuffer())],
        [...blobBytes[index]],
      );
    }
    return response(receipt(primaryResults));
  },
});
const primaryInput = input(primaryResults);
const accepted = await primary.client.ingest(primaryInput, authority());
const expectedCommand = {
  schemaVersion: 'byok-media-ingest-batch/v1',
  executionBatchId: 'execution-batch-1',
  items: primaryResults.map(commandItem),
};
assert.deepEqual(capturedGrant, {
  path: '/api/extension-device/command-grants',
  body: {
    operation: 'BYOK_MEDIA_INGEST',
    shopId: 'shop-1',
    workflowId: 'workflow-1',
    draftVersion: 4,
    idempotencyKey: 'byok-batch-ingest-0001',
    command: expectedCommand,
  },
  options: { requiredScope: 'byok:media:ingest' },
});
assert.deepEqual(capturedManifest, {
  contractVersion: 'extension-byok-media-batch-ingest-manifest/v1',
  operation: 'BYOK_MEDIA_INGEST',
  shopId: 'shop-1',
  workflowId: 'workflow-1',
  draftVersion: 4,
  idempotencyKey: 'byok-batch-ingest-0001',
  executionBatchId: 'execution-batch-1',
  command: expectedCommand,
});
assert.deepEqual(plain(accepted), normalizedClientReceipt(primaryResults));
assert.equal(
  typeof receipt(primaryResults).items[0].policyRevision,
  'number',
  'the fake ERP JSON contract remains numeric at the transport boundary',
);
assert.equal(accepted.items[0].policyRevision, '734');
assert.equal(Object.isFrozen(accepted), true);
assert.equal(Object.isFrozen(accepted.items), true);
assert.deepEqual(primary.events.slice(-3), [
  'multipart', 'release:br_result_1', 'release:br_result_2',
]);
assert.deepEqual(primary.counts(), { grants: 1, uploads: 1, authorityChecks: 2 });
await assert.rejects(
  primary.client.ingest({
    ...primaryInput,
    resultIds: primaryInput.resultIds.toReversed(),
  }, authority()),
  (error) => error && error.code === 'SS_ERP_BYOK_BATCH_INGEST_IDEMPOTENCY_CONFLICT',
);
assert.deepEqual(primary.counts(), { grants: 1, uploads: 1, authorityChecks: 2 });
assert.deepEqual(
  plain(await primary.client.ingest(primaryInput, authority())),
  normalizedClientReceipt(primaryResults),
  'successful replay returns the same receipt without another grant or upload',
);
assert.deepEqual(primary.counts(), { grants: 1, uploads: 1, authorityChecks: 2 });

for (const count of [1, 4]) {
  const results = Array.from({ length: count }, (_, index) => approvedResult(index));
  const harness = createHarness(results);
  const result = await harness.client.ingest(input(results, {
    idempotencyKey: `byok-batch-count-${count}-0001`,
  }), authority());
  assert.equal(result.items.length, count);
  assert.deepEqual(harness.counts(), { grants: 1, uploads: 1, authorityChecks: 2 });
  assert.equal(harness.events.filter((event) => event.startsWith('release:')).length, count);
}

async function expectPreflightRejection(results, inputValue, authorityValue, expectedCode) {
  const harness = createHarness(results);
  await assert.rejects(
    harness.client.ingest(inputValue, authorityValue),
    (error) => error && error.code === expectedCode,
  );
  assert.equal(harness.counts().grants, 0, 'invalid batch must fail before grant I/O');
  assert.equal(harness.counts().uploads, 0, 'invalid batch must fail before multipart I/O');
  assert.equal(harness.events.some((event) => event.startsWith('release:')), false);
}

await expectPreflightRejection(
  [], input([], { resultIds: [] }), authority(), 'SS_ERP_BYOK_BATCH_INGEST_INPUT_INVALID',
);
const fiveResults = Array.from({ length: 5 }, (_, index) => approvedResult(index % 4, {
  resultId: `br_result_five_${index}`,
}));
await expectPreflightRejection(
  fiveResults,
  input(fiveResults),
  authority(),
  'SS_ERP_BYOK_BATCH_INGEST_INPUT_INVALID',
);
await expectPreflightRejection(
  primaryResults,
  { ...primaryInput, resultIds: ['br_result_1', 'br_result_1'] },
  authority(),
  'SS_ERP_BYOK_BATCH_INGEST_INPUT_INVALID',
);
await expectPreflightRejection(
  primaryResults,
  { ...primaryInput, unknown: true },
  authority(),
  'SS_ERP_BYOK_BATCH_INGEST_INPUT_INVALID',
);

const invalidResultSets = [
  [approvedResult(0), approvedResult(1, {}, { draftVersion: 5 })],
  [approvedResult(0), approvedResult(1, {}, { sourceCaptureSnapshotId: 'snapshot-2' })],
  [approvedResult(0), approvedResult(1, { executionIntentId: 'intent-1' })],
  [approvedResult(0), approvedResult(1, { sha256: '5'.repeat(64) })],
  [approvedResult(0), approvedResult(1, {}, { slotKey: 'sku:sku-1:hero', skuKey: 'sku-1' })],
  [approvedResult(0), approvedResult(1, { requestHash: '1'.repeat(64) })],
  [approvedResult(0), approvedResult(1, { idempotencyKey: 'provider-attempt-0001' })],
  [approvedResult(0), approvedResult(1, {}, { assignmentOrdinal: 3 })],
  [approvedResult(0), approvedResult(1, {}, {
    slotKey: 'shared:detail:SCENE', assignmentMode: 'REPLACE',
  })],
  [approvedResult(0), approvedResult(1, {}, { slotKey: 'group:visual-1:detail:SCENE' })],
  [approvedResult(0), approvedResult(1, {}, { slotKey: 'sku:sku-2:detail:1' })],
  [approvedResult(0), approvedResult(1, {}, { slotKey: 'shared:detail:FUNCTION' })],
  [approvedResult(0), approvedResult(1, { reviewState: 'CANDIDATE_READY', reviewedAt: null })],
  [approvedResult(0), approvedResult(1, {
    operation: 'FULL_EDIT', requestMode: 'multipart', sourceSha256: null,
  }, { operation: 'FULL_EDIT' })],
  [approvedResult(0), approvedResult(1, { byteLength: 99 })],
  [approvedResult(0), approvedResult(1, {
    providerOrigin: 'https://relay.example?secret=1',
  }, { providerOrigin: 'https://relay.example?secret=1' })],
];
for (const [index, results] of invalidResultSets.entries()) {
  await expectPreflightRejection(
    results,
    input(results, { idempotencyKey: `byok-invalid-results-${index}-0001` }),
    authority(),
    'SS_ERP_BYOK_BATCH_INGEST_BINDING_MISMATCH',
  );
}

await expectPreflightRejection(
  primaryResults,
  input(primaryResults, { idempotencyKey: 'byok-stale-authority-0001' }),
  authority({ draftVersion: 5 }),
  'SS_ERP_BYOK_BATCH_INGEST_AUTHORITY_INVALID',
);

const oversizedBatchBytes = new Uint8Array(13 * 1024 * 1024);
const oversizedBatch = Array.from({ length: 4 }, (_, index) => {
  const blob = new Blob([oversizedBatchBytes], { type: 'image/png' });
  return approvedResult(index, {
    blob,
    byteLength: blob.size,
    sha256: String(index + 5).repeat(64),
  });
});
await expectPreflightRejection(
  oversizedBatch,
  input(oversizedBatch, { idempotencyKey: 'byok-oversized-batch-0001' }),
  authority(),
  'SS_ERP_BYOK_BATCH_INGEST_BINDING_MISMATCH',
);

const unknownSecret = 'provider-body-secret-must-not-leak';
const unknownResults = [approvedResult(0)];
const unknown = createHarness(unknownResults, {
  async postMultipart() { throw new Error(unknownSecret); },
  async postStatus(path, body, options) {
    assert.equal(path, '/api/extension-device/byok-media/batch-ingest-status');
    assert.deepEqual(plain(options), { requiredScope: 'byok:media:ingest' });
    assert.equal(body.contractVersion, 'extension-byok-media-batch-ingest-status/v1');
    assert.equal(body.executionBatchId, 'execution-batch-1');
    assert.equal(body.idempotencyKey, 'byok-unknown-batch-0001');
    assert.equal(body.requestHash, REQUEST_HASH);
    assert.equal(body.items.length, 1);
    return response(receipt(unknownResults, { replayed: true }));
  },
});
const unknownInput = input(unknownResults, { idempotencyKey: 'byok-unknown-batch-0001' });
for (let attempt = 0; attempt < 2; attempt += 1) {
  let caught = null;
  try {
    await unknown.client.ingest(unknownInput, authority());
  } catch (error) {
    caught = error;
  }
  assert.equal(caught && caught.code, 'SS_ERP_BYOK_BATCH_INGEST_UNKNOWN_OUTCOME');
  assert.equal(caught && caught.outcome, 'UNKNOWN_OUTCOME');
  assert.equal(JSON.stringify(caught).includes(unknownSecret), false);
}
assert.deepEqual(unknown.counts(), { grants: 1, uploads: 1, authorityChecks: 2 });
assert.equal(unknown.events.some((event) => event.startsWith('release:')), false);
const recoveredUnknown = await unknown.client.recover(unknownInput, authority());
assert.equal(recoveredUnknown.executionBatchId, 'execution-batch-1');
assert.equal(recoveredUnknown.replayed, true);
assert.deepEqual(unknown.counts(), { grants: 1, uploads: 1, authorityChecks: 3 });
assert.equal(unknown.events.filter((event) => event === 'multipart').length, 1);
assert.equal(unknown.events.filter((event) => event === 'status').length, 1);

const pendingResults = [approvedResult(0)];
const pending = createHarness(pendingResults, {
  async postMultipart() { throw new Error('lost'); },
  async postStatus() {
    return { state: 'response', status: 202, body: { code: 1, data: { state: 'PENDING' } } };
  },
});
const pendingInput = input(pendingResults, { idempotencyKey: 'byok-pending-batch-0001' });
await assert.rejects(pending.client.ingest(pendingInput, authority()));
await assert.rejects(
  pending.client.recover(pendingInput, authority()),
  (error) => error && error.code === 'SS_ERP_BYOK_BATCH_INGEST_RECOVERY_PENDING'
    && error.outcome === 'UNKNOWN_OUTCOME',
);
assert.equal(pending.events.filter((event) => event === 'multipart').length, 1);

const malformedFactories = [
  (results) => ({ ...receipt(results), extra: true }),
  (results) => receipt(results, { executionBatchId: 'execution-batch-other' }),
  (results) => receipt(results, { replayed: 'false' }),
  (results) => receipt(results, { receiptId: '' }),
  (results) => receipt(results, { requestHash: 'e'.repeat(64) }),
  (results) => receipt(results, { erpAiChargeCents: 1 }),
  (results) => receipt(results, { boundDraftVersion: 6 }),
  (results) => receipt(results, { items: receipt(results).items.toReversed() }),
  (results) => receipt(results, {
    items: receipt(results).items.map((item, index) => index ? item : { ...item, extra: true }),
  }),
  (results) => receipt(results, {
    items: receipt(results).items.map((item, index) => index ? item : {
      ...item,
      assignment: { ...item.assignment, assetId: 'asset-conflict' },
    }),
  }),
];
for (const [index, malformed] of malformedFactories.entries()) {
  const results = [approvedResult(0), approvedResult(1)];
  const harness = createHarness(results, {
    async postMultipart() { return response(malformed(results)); },
  });
  await assert.rejects(
    harness.client.ingest(input(results, {
      idempotencyKey: `byok-malformed-receipt-${index}-0001`,
    }), authority()),
    (error) => error
      && error.code === 'SS_ERP_BYOK_BATCH_INGEST_RESPONSE_INVALID'
      && error.outcome === 'UNKNOWN_OUTCOME',
  );
  assert.equal(harness.events.some((event) => event.startsWith('release:')), false);
}

const badGrantResults = [approvedResult(0)];
const badGrant = createHarness(badGrantResults, {
  async post() {
    return { state: 'response', status: 201, body: { code: 1, data: { grantToken: 'short' } } };
  },
});
await assert.rejects(
  badGrant.client.ingest(input(badGrantResults, {
    idempotencyKey: 'byok-bad-grant-0001',
  }), authority()),
  (error) => error && error.code === 'SS_ERP_BYOK_BATCH_INGEST_GRANT_RESPONSE_INVALID',
);
assert.deepEqual(badGrant.counts(), { grants: 1, uploads: 0, authorityChecks: 1 });
assert.equal(badGrant.events.some((event) => event.startsWith('release:')), false);

console.log('extension BYOK generated asset batch ingest client tests passed');
