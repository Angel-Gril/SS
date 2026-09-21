import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const sessionPath = 'extensions/ss-erp/shared/erp-adapter/source-workflow-device-session.js';
const context = {
  AbortController, Array, ArrayBuffer, Boolean, Error, JSON, Math, Number, Object,
  Set, String, TextDecoder, TextEncoder, TypeError, URL, Uint8Array,
  clearTimeout, decodeURIComponent, encodeURIComponent, setTimeout,
};
context.globalThis = context;
vm.runInNewContext(readFileSync(sessionPath, 'utf8'), context, { filename: sessionPath });

const api = context.SS_ERP_SOURCE_WORKFLOW_DEVICE_SESSION;
const previewPath =
  '/api/extension-device/source-workbench/ai-image-suite/candidate-preview/consume';
const sourceMediaPreviewPath = '/api/extension-device/source-workbench/media-preview';
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function headers(values = {}) {
  const normalized = new Map(Object.entries(values).map(([key, value]) => [
    key.toLowerCase(), String(value),
  ]));
  return { get(name) { return normalized.get(String(name).toLowerCase()) ?? null; } };
}

function binaryResponse(bytes = png, overrides = {}) {
  return {
    ok: true,
    status: 200,
    headers: headers({
      'content-type': 'image/png',
      'content-length': bytes.byteLength,
      'x-ss-erp-content-sha256': 'a'.repeat(64),
      ...overrides.headers,
    }),
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
    ...overrides.response,
  };
}

function jsonResponse(payload = { code: 1, data: {} }, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: headers(),
    async text() { return JSON.stringify(payload); },
  };
}

function credentials(current = async () => true) {
  return {
    async beginOperation() {
      return {
        state: 'paired',
        epoch: 1,
        baseUrl: 'https://erp.example',
        accessToken: 'device-token',
        scopes: ['listing:review', 'listing:write', 'media:execute'],
      };
    },
    isOperationCurrent: current,
    async clearIfCurrent() { throw new Error('valid operation must not be cleared'); },
  };
}

const requests = [];
const transport = api.createTransport({
  credentials: credentials(),
  fetchImpl: async (url, init) => {
    requests.push({ url, init });
    return binaryResponse();
  },
});
const body = { binding: { planId: 'plan-1' }, token: 't'.repeat(43) };
const consumed = await transport.postRaw(previewPath, body, { requiredScope: 'listing:review' });

assert.equal(consumed.state, 'raw_response');
assert.equal(consumed.status, 200);
assert.equal(consumed.response.ok, true);
assert.equal(consumed.response.headers.get('content-type'), 'image/png');
assert.deepEqual(new Uint8Array(await consumed.response.arrayBuffer()), png);
assert.equal(requests.length, 1);
assert.equal(requests[0].url, 'https://erp.example' + previewPath);
assert.equal(requests[0].init.body, JSON.stringify(body));
assert.equal(requests[0].init.headers.Accept, 'image/png');
assert.equal(requests[0].init.headers.Authorization, 'Bearer device-token');
assert.equal(requests[0].init.credentials, 'omit');
assert.equal(requests[0].init.cache, 'no-store');
assert.equal(requests[0].init.redirect, 'error');

const sourceRequests = [];
const sourceTransport = api.createTransport({
  credentials: credentials(),
  fetchImpl: async (url, init) => {
    sourceRequests.push({ url, init });
    return binaryResponse();
  },
});
await sourceTransport.postRaw(sourceMediaPreviewPath, {
  sourceMediaKey: 'source-main-1', purpose: 'THUMBNAIL',
}, { requiredScopes: ['listing:review', 'media:execute'] });
assert.equal(sourceRequests[0].init.headers.Accept, 'image/png, image/jpeg');

const externalAbort = new AbortController();
let observedAbort = false;
const abortTransport = api.createTransport({
  credentials: credentials(),
  fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
    if (init.signal.aborted) {
      observedAbort = true;
      reject(new Error('fetch aborted'));
      return;
    }
    init.signal.addEventListener('abort', () => {
      observedAbort = true;
      reject(new Error('fetch aborted'));
    }, { once: true });
  }),
});
const aborted = abortTransport.postRaw(
  previewPath,
  body,
  { requiredScope: 'listing:review', signal: externalAbort.signal },
);
externalAbort.abort();
await assert.rejects(aborted, /source workbench request aborted/u);
assert.equal(observedAbort, true, 'preview revocation must abort the in-flight fetch');

let preSubmitFetchCount = 0;
const preSubmitTransport = api.createTransport({
  credentials: {
    async beginOperation() { throw new Error('credential lookup failed'); },
  },
  fetchImpl: async () => {
    preSubmitFetchCount += 1;
    throw new Error('pre-submit failure must not fetch');
  },
});
await assert.rejects(
  preSubmitTransport.post(
    '/api/extension-device/source-workbench/ai-image-suite/listing-assignments',
    { contractVersion: 'fixture/v1' },
    { requiredScope: 'listing:write' },
  ),
  (error) => error?.code === 'SS_ERP_SOURCE_WORKFLOW_REQUEST_NOT_SUBMITTED'
    && error.outcome === 'NOT_SUBMITTED'
    && error.requestDispatched === false,
);
assert.equal(preSubmitFetchCount, 0);

let dispatchedFetchCount = 0;
const responseLostTransport = api.createTransport({
  credentials: credentials(),
  fetchImpl: async () => {
    dispatchedFetchCount += 1;
    throw new Error('response lost after request dispatch');
  },
});
await assert.rejects(
  responseLostTransport.post(
    '/api/extension-device/source-workbench/ai-image-suite/listing-assignments',
    { contractVersion: 'fixture/v1' },
    { requiredScope: 'listing:write' },
  ),
  (error) => error?.code === 'SS_ERP_SOURCE_WORKFLOW_REQUEST_OUTCOME_UNKNOWN'
    && error.outcome === 'UNKNOWN_OUTCOME'
    && error.requestDispatched === true
    && error.automaticRetryAllowed === false,
);
assert.equal(dispatchedFetchCount, 1);

for (const scenario of [
  {
    name: 'expired hosted candidate preview ticket',
    invoke(transport) {
      return transport.postRaw(previewPath, body, { requiredScope: 'listing:review' });
    },
    errorCode: 'hosted_candidate_preview_token_invalid',
  },
  {
    name: 'expired media command grant',
    invoke(transport) {
      return transport.post(
        '/api/extension-device/media-workflows/execute',
        { contractVersion: 'fixture/v1' },
        { requiredScope: 'media:execute' },
      );
    },
    errorCode: 'COMMAND_GRANT_EXPIRED',
  },
]) {
  let credentialClears = 0;
  const businessExpiryTransport = api.createTransport({
    credentials: {
      ...credentials(),
      async clearIfCurrent() { credentialClears += 1; return true; },
    },
    fetchImpl: async () => jsonResponse({
      code: 0,
      errorCode: scenario.errorCode,
    }, 410),
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(await scenario.invoke(businessExpiryTransport))),
    {
      state: 'http_error',
      status: 410,
      body: { code: 0, errorCode: scenario.errorCode },
    },
    `${scenario.name} must remain a business-resource error`,
  );
  assert.equal(
    credentialClears,
    0,
    `${scenario.name} must not revoke a valid device credential`,
  );
}

const jsonTransport = api.createTransport({
  credentials: credentials(),
  fetchImpl: async () => jsonResponse(),
});
await assert.doesNotReject(jsonTransport.post(
  '/api/extension-device/source-workbench/plans',
  { contractVersion: 'fixture/v1' },
  { requiredScope: 'media:execute' },
));
await assert.doesNotReject(jsonTransport.post(
  '/api/extension-device/source-workbench/plans/plan-1/review',
  { contractVersion: 'fixture/v1' },
  { requiredScope: 'listing:review' },
));
await assert.doesNotReject(jsonTransport.post(
  '/api/extension-device/source-workbench/plans/%E8%AE%A1%E5%88%92-1/review',
  { contractVersion: 'fixture/v1' },
  { requiredScope: 'listing:review' },
));
await assert.doesNotReject(jsonTransport.post(
  '/api/extension-device/source-workbench/ai-image-suite/listing-assignments',
  { contractVersion: 'fixture/v1' },
  { requiredScope: 'listing:write' },
));
await assert.doesNotReject(jsonTransport.post(
  '/api/extension-device/source-workbench/ai-image-suite/candidate-preview',
  { binding: {} },
  { requiredScope: 'listing:review' },
));

for (const path of [
  '/api/extension-device/source-workbench/plans/plan-1/delete',
  '/api/extension-device/source-workbench/plans/%2Fadmin/review',
  '/api/extension-device/source-workbench/plans/plan-1/review?owner=other',
  '/api/extension-device/source-workbench/arbitrary-command',
]) {
  await assert.rejects(
    jsonTransport.post(path, { contractVersion: 'fixture/v1' }, { requiredScope: 'media:execute' }),
    /source workbench path is invalid/u,
  );
}
await assert.rejects(
  transport.postRaw(
    '/api/extension-device/source-workbench/ai-image-suite/candidate-preview',
    body,
    { requiredScope: 'listing:review' },
  ),
  /hosted preview response path is invalid/u,
);

let epochChecks = 0;
const staleTransport = api.createTransport({
  credentials: credentials(async () => {
    epochChecks += 1;
    return epochChecks === 1;
  }),
  fetchImpl: async () => binaryResponse(),
});
await assert.rejects(
  staleTransport.postRaw(previewPath, body, { requiredScope: 'listing:review' }),
  /device credential operation superseded/u,
);
assert.equal(epochChecks, 2, 'credential epoch must be checked after the PNG bytes are consumed');

const oversizedTransport = api.createTransport({
  credentials: credentials(),
  fetchImpl: async () => binaryResponse(png, {
    headers: { 'content-length': String(20 * 1024 * 1024 + 1) },
  }),
});
await assert.rejects(
  oversizedTransport.postRaw(previewPath, body, { requiredScope: 'listing:review' }),
  /binary response is too large/u,
);

console.log('extension hosted AI image transport tests passed');
