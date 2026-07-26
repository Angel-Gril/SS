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

console.log('extension BYOK ingest transport tests passed');
