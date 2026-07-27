import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const sessionPath = 'extensions/ss-erp/shared/erp-adapter/source-workflow-device-session.js';
const source = readFileSync(sessionPath, 'utf8');
const context = {
  AbortController,
  Array,
  Blob,
  Boolean,
  Error,
  FormData,
  JSON,
  Math,
  Number,
  Object,
  Set,
  String,
  TextDecoder,
  TextEncoder,
  TypeError,
  URL,
  Uint8Array,
  clearTimeout,
  setTimeout,
};
context.globalThis = context;
vm.runInNewContext(source, context, { filename: sessionPath });

function response(status = 200, payload = { code: 1, data: { assetId: 'asset-1' } }) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get() { return null; } },
    async text() { return JSON.stringify(payload); },
  };
}

function credentials(scopes = ['byok:media:ingest']) {
  return {
    async beginOperation() {
      return {
        state: 'paired',
        epoch: 1,
        baseUrl: 'https://erp.example',
        accessToken: 'device-token',
        scopes,
      };
    },
    async isOperationCurrent() { return true; },
    async clearIfCurrent() { throw new Error('valid operation must not be cleared'); },
  };
}

const requests = [];
const transport = context.SS_ERP_SOURCE_WORKFLOW_DEVICE_SESSION.createTransport({
  credentials: credentials(),
  fetchImpl: async (url, init) => {
    requests.push({ url, init });
    return response();
  },
});
const image = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });
const manifest = Buffer.from(JSON.stringify({ contractVersion: 'fixture/v1' })).toString('base64url');
const result = await transport.postBytes(
  '/api/extension-device/byok-media/ingest',
  image,
  { contentType: 'image/png', manifest, commandGrant: 'g'.repeat(43) },
);
assert.equal(result.state, 'response');
assert.equal(requests.length, 1);
assert.equal(requests[0].url, 'https://erp.example/api/extension-device/byok-media/ingest');
assert.equal(requests[0].init.body, image, 'the Blob must move directly to fetch without base64');
assert.equal(requests[0].init.headers.Authorization, 'Bearer device-token');
assert.equal(requests[0].init.headers['Content-Type'], 'image/png');
assert.equal(requests[0].init.headers['X-SS-ERP-Command-Grant'], 'g'.repeat(43));
assert.equal(requests[0].init.headers['X-SS-ERP-BYOK-Ingest-Manifest'], manifest);
assert.equal(requests[0].init.credentials, 'omit');
assert.equal(requests[0].init.cache, 'no-store');
assert.equal(requests[0].init.redirect, 'error');

const statusPayload = {
  contractVersion: 'extension-byok-media-ingest-status/v1',
  shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
  skuKey: 'sku-1', slotKey: 'sku:sku-1:hero', assignmentOrdinal: 0,
  idempotencyKey: 'byok-ingest-status-0001',
};
const statusResult = await transport.post(
  '/api/extension-device/byok-media/ingest-status',
  statusPayload,
  { requiredScope: 'byok:media:ingest' },
);
assert.equal(statusResult.state, 'response');
assert.equal(requests.length, 2);
assert.equal(requests[1].url, 'https://erp.example/api/extension-device/byok-media/ingest-status');
assert.equal(requests[1].init.body, JSON.stringify(statusPayload));
assert.equal(requests[1].init.headers['X-SS-ERP-Command-Grant'], undefined);
assert.equal(requests[1].init.credentials, 'omit');
assert.equal(requests[1].init.cache, 'no-store');
assert.equal(requests[1].init.redirect, 'error');

const executionIntentClaimPayload = {
  contractVersion: 'extension-byok-execution-intent-claim-request/v1',
};
await transport.post(
  '/api/extension-device/byok-media/execution-intents',
  executionIntentClaimPayload,
  { requiredScope: 'byok:media:ingest' },
);
const executionIntentOutcomePayload = {
  contractVersion: 'extension-byok-execution-intent-outcome-request/v1',
};
await transport.post(
  '/api/extension-device/byok-media/execution-intents/intent-1/outcome',
  executionIntentOutcomePayload,
  { requiredScope: 'byok:media:ingest' },
);
assert.equal(requests.length, 4);
assert.equal(
  requests[2].url,
  'https://erp.example/api/extension-device/byok-media/execution-intents',
);
assert.equal(requests[2].init.body, JSON.stringify(executionIntentClaimPayload));
assert.equal(
  requests[3].url,
  'https://erp.example/api/extension-device/byok-media/execution-intents/intent-1/outcome',
);
assert.equal(requests[3].init.body, JSON.stringify(executionIntentOutcomePayload));

const batchManifest = {
  contractVersion: 'extension-byok-media-batch-ingest-manifest/v1',
  operation: 'BYOK_MEDIA_INGEST',
  executionBatchId: 'execution-batch-1',
  shopId: 'shop-1',
  workflowId: 'workflow-1',
  draftVersion: 4,
  idempotencyKey: 'byok-batch-ingest-0001',
  command: {
    schemaVersion: 'byok-media-ingest-batch/v1',
    executionBatchId: 'execution-batch-1',
    items: [
      { resultMimeType: 'image/png', resultSizeBytes: image.size },
      { resultMimeType: 'image/png', resultSizeBytes: image.size },
    ],
  },
};
const batchForm = new FormData();
batchForm.append('manifest', JSON.stringify(batchManifest));
batchForm.append('image-0', image, 'image-0.png');
batchForm.append('image-1', image, 'image-1.png');
const batchResult = await transport.postMultipart(
  '/api/extension-device/byok-media/batch-ingest',
  batchForm,
  { requiredScope: 'byok:media:ingest', commandGrant: 'b'.repeat(43) },
);
assert.equal(batchResult.state, 'response');
assert.equal(requests.length, 5);
assert.equal(
  requests[4].url,
  'https://erp.example/api/extension-device/byok-media/batch-ingest',
);
assert.equal(requests[4].init.body, batchForm);
assert.equal(requests[4].init.headers['Content-Type'], undefined);
assert.equal(requests[4].init.headers['X-SS-ERP-Command-Grant'], 'b'.repeat(43));
assert.equal(requests[4].init.credentials, 'omit');
assert.equal(requests[4].init.redirect, 'error');

const publishRequests = [];
const publishTransport = context.SS_ERP_SOURCE_WORKFLOW_DEVICE_SESSION.createTransport({
  credentials: credentials(['listing:publish']),
  fetchImpl: async (url, init) => {
    publishRequests.push({ url, init });
    return response(202, {
      code: 1,
      data: { receipt: { id: 'publish-receipt-1', status: 'SUCCEEDED' }, replay: false },
    });
  },
});
const publishPayload = {
  shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 5,
  idempotencyKey: 'wb_publish_' + 'a'.repeat(48),
  command: {
    schemaVersion: 'ozon-publish-command/v1', draftRevision: 5,
    publishIntentId: 'publish-intent-1', selectedSkuKeys: ['sku-1'],
  },
};
const published = await publishTransport.post(
  '/api/extension-device/ozon-publish/execute',
  publishPayload,
  { requiredScope: 'listing:publish', commandGrant: 'p'.repeat(43) },
);
assert.equal(published.state, 'response');
assert.equal(publishRequests.length, 1);
assert.equal(publishRequests[0].url, 'https://erp.example/api/extension-device/ozon-publish/execute');
assert.equal(publishRequests[0].init.headers['X-SS-ERP-Command-Grant'], 'p'.repeat(43));
assert.equal(publishRequests[0].init.credentials, 'omit');
assert.equal(publishRequests[0].init.redirect, 'error');

for (const path of [
  '/api/extension-device/byok-publish/preview',
  '/api/extension-device/byok-publish/prepare',
  '/api/extension-device/byok-publish/status',
]) {
  const routeResult = await publishTransport.post(
    path,
    { contractVersion: 'extension-byok-listing-publish/v1' },
    { requiredScope: 'listing:publish' },
  );
  assert.equal(routeResult.state, 'response');
}

const largeSkuKeys = Array.from({ length: 500 }, (_unused, index) => (
  `sku-${String(index).padStart(3, '0')}-` + 'x'.repeat(280)
));
const largePublishPayload = {
  ...publishPayload,
  command: { ...publishPayload.command, selectedSkuKeys: largeSkuKeys },
};
assert.ok(new TextEncoder().encode(JSON.stringify(largePublishPayload)).byteLength > 64 * 1024);
assert.equal((await publishTransport.post(
  '/api/extension-device/ozon-publish/execute',
  largePublishPayload,
  { requiredScope: 'listing:publish', commandGrant: 'p'.repeat(43) },
)).state, 'response', 'a contract-valid large publish envelope must pass the publish-only bound');

const largePreviewTransport = context.SS_ERP_SOURCE_WORKFLOW_DEVICE_SESSION.createTransport({
  credentials: credentials(['listing:publish']),
  fetchImpl: async () => response(200, {
    code: 1,
    data: { preview: 'x'.repeat(600 * 1024) },
  }),
});
assert.equal((await largePreviewTransport.post(
  '/api/extension-device/byok-publish/preview',
  { contractVersion: 'extension-byok-listing-publish/v1' },
  { requiredScope: 'listing:publish' },
)).state, 'response', 'a bounded large publish preview must pass the preview-only response limit');

const defaultResponseTransport = context.SS_ERP_SOURCE_WORKFLOW_DEVICE_SESSION.createTransport({
  credentials: credentials(),
  fetchImpl: async () => response(200, {
    code: 1,
    data: { payload: 'x'.repeat(600 * 1024) },
  }),
});
await assert.rejects(
  defaultResponseTransport.post(
    '/api/extension-device/byok-media/ingest-status',
    statusPayload,
    { requiredScope: 'byok:media:ingest' },
  ),
  /response is too large/u,
  'non-publish responses retain the default 512 KiB bound',
);

let forbiddenFetches = 0;
const guarded = context.SS_ERP_SOURCE_WORKFLOW_DEVICE_SESSION.createTransport({
  credentials: credentials(),
  fetchImpl: async () => {
    forbiddenFetches += 1;
    return response();
  },
});
for (const [label, path, blob, options] of [
  ['wrong path', '/api/extension-device/command-grants', image,
    { contentType: 'image/png', manifest, commandGrant: 'g'.repeat(43) }],
  ['MIME mismatch', '/api/extension-device/byok-media/ingest', image,
    { contentType: 'image/jpeg', manifest, commandGrant: 'g'.repeat(43) }],
  ['missing manifest', '/api/extension-device/byok-media/ingest', image,
    { contentType: 'image/png', commandGrant: 'g'.repeat(43) }],
  ['missing grant', '/api/extension-device/byok-media/ingest', image,
    { contentType: 'image/png', manifest }],
]) {
  await assert.rejects(guarded.postBytes(path, blob, options), Error, label);
}
const oversized = new Blob([new Uint8Array((20 * 1024 * 1024) + 1)], { type: 'image/png' });
await assert.rejects(
  guarded.postBytes('/api/extension-device/byok-media/ingest', oversized, {
    contentType: 'image/png', manifest, commandGrant: 'g'.repeat(43),
  }),
  /Blob is invalid/u,
);
assert.equal(forbiddenFetches, 0, 'invalid binary requests must fail before network I/O');

const missingScope = context.SS_ERP_SOURCE_WORKFLOW_DEVICE_SESSION.createTransport({
  credentials: credentials(['listing:review']),
  fetchImpl: async () => { throw new Error('missing scope must not fetch'); },
});
assert.deepEqual(
  JSON.parse(JSON.stringify(await missingScope.postBytes(
    '/api/extension-device/byok-media/ingest',
    image,
    { contentType: 'image/png', manifest, commandGrant: 'g'.repeat(43) },
  ))),
  { state: 'scope_required', scope: 'byok:media:ingest' },
);

const policyDenied = context.SS_ERP_SOURCE_WORKFLOW_DEVICE_SESSION.createTransport({
  credentials: credentials(),
  fetchImpl: async () => response(403, { code: 0, errorCode: 'byok_ingest_shop_denied' }),
});
assert.deepEqual(
  JSON.parse(JSON.stringify(await policyDenied.postBytes(
    '/api/extension-device/byok-media/ingest',
    image,
    { contentType: 'image/png', manifest, commandGrant: 'g'.repeat(43) },
  ))),
  {
    state: 'http_error',
    status: 403,
    body: { code: 0, errorCode: 'byok_ingest_shop_denied' },
  },
  'a policy/shop denial must not be mislabeled as a missing Chrome device scope',
);

let grantRequiredCredentialClears = 0;
const grantRequiredTransport = context.SS_ERP_SOURCE_WORKFLOW_DEVICE_SESSION.createTransport({
  credentials: {
    ...credentials(),
    async clearIfCurrent() { grantRequiredCredentialClears += 1; return true; },
  },
  fetchImpl: async () => response(401, {
    code: 0,
    errorCode: 'byok_ingest_grant_required',
  }),
});
assert.deepEqual(
  JSON.parse(JSON.stringify(await grantRequiredTransport.postBytes(
    '/api/extension-device/byok-media/ingest',
    image,
    { contentType: 'image/png', manifest, commandGrant: 'g'.repeat(43) },
  ))),
  {
    state: 'http_error',
    status: 401,
    body: { code: 0, errorCode: 'byok_ingest_grant_required' },
  },
);
assert.equal(grantRequiredCredentialClears, 0, 'missing grant must not revoke device credentials');

let grantExpiryCredentialClears = 0;
const grantExpiryTransport = context.SS_ERP_SOURCE_WORKFLOW_DEVICE_SESSION.createTransport({
  credentials: {
    ...credentials(),
    async clearIfCurrent() { grantExpiryCredentialClears += 1; return true; },
  },
  fetchImpl: async () => response(410, {
    code: 0,
    errorCode: 'byok_ingest_grant_expired',
  }),
});
assert.deepEqual(
  JSON.parse(JSON.stringify(await grantExpiryTransport.postBytes(
    '/api/extension-device/byok-media/ingest',
    image,
    { contentType: 'image/png', manifest, commandGrant: 'g'.repeat(43) },
  ))),
  {
    state: 'http_error',
    status: 410,
    body: { code: 0, errorCode: 'byok_ingest_grant_expired' },
  },
);
assert.equal(grantExpiryCredentialClears, 0, 'grant expiry must not revoke device credentials');

let publishGrantCredentialClears = 0;
const publishGrantExpiredTransport = context.SS_ERP_SOURCE_WORKFLOW_DEVICE_SESSION.createTransport({
  credentials: {
    ...credentials(['listing:publish']),
    async clearIfCurrent() { publishGrantCredentialClears += 1; return true; },
  },
  fetchImpl: async () => response(410, {
    code: 0,
    errorCode: 'COMMAND_GRANT_EXPIRED',
  }),
});
assert.deepEqual(
  JSON.parse(JSON.stringify(await publishGrantExpiredTransport.post(
    '/api/extension-device/ozon-publish/execute',
    publishPayload,
    { requiredScope: 'listing:publish', commandGrant: 'p'.repeat(43) },
  ))),
  {
    state: 'http_error',
    status: 410,
    body: { code: 0, errorCode: 'COMMAND_GRANT_EXPIRED' },
  },
);
assert.equal(publishGrantCredentialClears, 0, 'publish grant expiry must not revoke device credentials');

let deviceRevocationCredentialClears = 0;
const deviceRevocationTransport = context.SS_ERP_SOURCE_WORKFLOW_DEVICE_SESSION.createTransport({
  credentials: {
    ...credentials(),
    async clearIfCurrent(_operation, reason) {
      deviceRevocationCredentialClears += 1;
      assert.equal(reason.status, 410);
      assert.equal(reason.reason, 'source_workbench_authorization_revoked');
      return true;
    },
  },
  fetchImpl: async () => response(410, {
    code: 0,
    errorCode: 'device_shop_revoked',
  }),
});
assert.deepEqual(
  JSON.parse(JSON.stringify(await deviceRevocationTransport.postBytes(
    '/api/extension-device/byok-media/ingest',
    image,
    { contentType: 'image/png', manifest, commandGrant: 'g'.repeat(43) },
  ))),
  { state: 'authorization_required', status: 410 },
);
assert.equal(deviceRevocationCredentialClears, 1, 'device revocation must still clear credentials');

const deviceSessionInvalidTransport = context.SS_ERP_SOURCE_WORKFLOW_DEVICE_SESSION.createTransport({
  credentials: {
    ...credentials(),
    async clearIfCurrent(_operation, reason) {
      deviceRevocationCredentialClears += 1;
      assert.equal(reason.status, 401);
      return true;
    },
  },
  fetchImpl: async () => response(401, {
    code: 0,
    errorCode: 'byok_ingest_session_invalid',
  }),
});
assert.deepEqual(
  JSON.parse(JSON.stringify(await deviceSessionInvalidTransport.postBytes(
    '/api/extension-device/byok-media/ingest',
    image,
    { contentType: 'image/png', manifest, commandGrant: 'g'.repeat(43) },
  ))),
  { state: 'authorization_required', status: 401 },
);
assert.equal(deviceRevocationCredentialClears, 2, 'invalid device sessions must clear credentials');

const batchRouteRequests = [];
const batchRouteTransport = context.SS_ERP_SOURCE_WORKFLOW_DEVICE_SESSION.createTransport({
  credentials: credentials(),
  fetchImpl: async (url, init) => {
    batchRouteRequests.push({ url, init });
    return response(200, { code: 1, data: {} });
  },
});
for (const path of [
  '/api/extension-device/byok-media/workbench-launch',
  '/api/extension-device/byok-media/workbench-batch-launch',
  '/api/extension-device/byok-media/execution-batches',
  '/api/extension-device/byok-media/execution-batches/batch-1/items/3/attempts',
  '/api/extension-device/byok-media/execution-batches/batch-1/cancel',
  '/api/extension-device/byok-media/batch-ingest-status',
]) {
  await batchRouteTransport.post(path, { contractVersion: 'fixture/v1' }, {
    requiredScope: 'byok:media:ingest',
  });
}
assert.equal(batchRouteRequests.length, 6);
for (const path of [
  '/api/extension-device/byok-media/execution-batches/batch-1',
  '/api/extension-device/byok-media/execution-batches/by-idempotency/reservation-key-0001',
  '/api/extension-device/byok-media/execution-batches/by-idempotency/%E6%89%B9%E6%AC%A1-1',
]) {
  await batchRouteTransport.get(path, { requiredScope: 'byok:media:ingest' });
}
assert.equal(batchRouteRequests.length, 9);
for (const invalidPath of [
  '/api/extension-device/byok-media/execution-batches/batch-1/items/4/attempts',
  '/api/extension-device/byok-media/execution-batches/batch-1/items/0/attempts?secret=1',
  '/api/extension-device/byok-media/execution-batches/batch/extra/cancel',
]) {
  await assert.rejects(
    batchRouteTransport.post(invalidPath, { contractVersion: 'fixture/v1' }, {
      requiredScope: 'byok:media:ingest',
    }),
    /path is invalid/u,
  );
}
for (const invalidPath of [
  '/api/extension-device/byok-media/execution-batches/batch/extra',
  '/api/extension-device/byok-media/execution-batches/by-idempotency/',
  '/api/extension-device/byok-media/execution-batches/by-idempotency/key?secret=1',
  '/api/extension-device/byok-media/execution-batches/%2Fadmin',
]) {
  await assert.rejects(
    batchRouteTransport.get(invalidPath, { requiredScope: 'byok:media:ingest' }),
    /path is invalid/u,
  );
}
assert.equal(batchRouteRequests.length, 9);

console.log('extension BYOK ingest transport tests passed');
