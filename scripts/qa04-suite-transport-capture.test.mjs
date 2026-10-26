import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertExclusiveTargetOwnership,
  attachSuiteMutationNetworkCapture,
  createSuiteMutationCapture,
  classifySuiteMutationRequest,
  sanitizeSuiteTransportValue,
} from './qa04-suite-transport-capture.mjs';

test('fails closed when an extension target is already owned by another CDP client', () => {
  const owned = new Map();
  assert.equal(assertExclusiveTargetOwnership({ targetId: 'target-1', attached: false }, owned), 'available');
  owned.set('target-1', 'session-1');
  assert.equal(assertExclusiveTargetOwnership({ targetId: 'target-1', attached: true }, owned), 'owned');
  assert.throws(
    () => assertExclusiveTargetOwnership({ targetId: 'target-2', attached: true }, owned),
    /already attached by another CDP client/u,
  );
});

test('classifies only review and assignment mutation targets', () => {
  assert.equal(classifySuiteMutationRequest({
    method: 'POST',
    url: 'https://ss-erp.com/api/extension-device/media-workflows/execute',
    postData: JSON.stringify({ operation: 'MEDIA_REVIEW', command: { action: 'REVIEW_SLOT' } }),
  }), 'review');
  assert.equal(classifySuiteMutationRequest({
    method: 'POST',
    url: 'https://ss-erp.com/api/extension-device/source-workbench/ai-image-suite/listing-assignments',
    postData: JSON.stringify({ contractVersion: 'extension-hosted-ai-image-listing-assignment/v2' }),
  }), 'assignment');
  assert.equal(classifySuiteMutationRequest({
    method: 'POST',
    url: 'https://ss-erp.com/api/extension-device/command-grants',
    postData: JSON.stringify({ operation: 'MEDIA_REVIEW' }),
  }), null);
  assert.equal(classifySuiteMutationRequest({
    method: 'POST',
    url: 'https://ss-erp.com/api/extension-device/media-workflows/execute',
    postData: JSON.stringify({ operation: 'MEDIA_EXECUTE', command: { action: 'START' } }),
  }), 'suite');
  assert.equal(classifySuiteMutationRequest({
    method: 'GET',
    url: 'https://ss-erp.com/api/extension-device/media-workflows/execute',
  }), null);
});

test('captures the actual MEDIA_EXECUTE envelope, which deliberately omits operation', () => {
  for (const action of ['START', 'CONTINUE']) {
    assert.equal(classifySuiteMutationRequest({ method: 'POST',
      url: 'https://ss-erp.com/api/extension-device/media-workflows/execute',
      postData: JSON.stringify({ shopId: 'shop', workflowId: 'draft', draftVersion: 2,
        idempotencyKey: 'same-owner-stable-key', command: {
          version: 'extension-ai-image-suite-execute-command/v1', action,
        } }),
    }), 'suite');
  }
});

test('sanitizes credentials before a capture artifact is written', () => {
  const value = sanitizeSuiteTransportValue({
    grantToken: 'secret-grant',
    Authorization: 'Bearer secret',
    nested: { refreshToken: 'secret-refresh', result: 'kept' },
    command: { action: 'REVIEW_SLOT' },
  });
  assert.deepEqual(value, {
    grantToken: '[REDACTED]',
    Authorization: '[REDACTED]',
    nested: { refreshToken: '[REDACTED]', result: 'kept' },
    command: { action: 'REVIEW_SLOT' },
  });
});

test('requires the target response body and preserves first-vs-replay state', () => {
  const capture = createSuiteMutationCapture();
  capture.recordRequest({
    requestId: 'review-1',
    method: 'POST',
    url: 'https://ss-erp.com/api/extension-device/media-workflows/execute',
    postData: JSON.stringify({ operation: 'MEDIA_REVIEW', command: { action: 'REVIEW_SLOT' } }),
    at: '2026-10-26T00:00:00.000Z',
  });
  capture.recordResponse({
    requestId: 'review-1',
    status: 202,
    url: 'https://ss-erp.com/api/extension-device/media-workflows/execute',
    at: '2026-10-26T00:00:00.100Z',
    body: { code: 1, data: { receipt: { status: 'SUCCEEDED' }, replay: false } },
  });
  const first = capture.requireCompleted('review');
  assert.equal(first.response.body.data.replay, false);

  capture.recordRequest({
    requestId: 'assignment-1',
    method: 'POST',
    url: 'https://ss-erp.com/api/extension-device/source-workbench/ai-image-suite/listing-assignments',
    postData: JSON.stringify({ contractVersion: 'extension-hosted-ai-image-listing-assignment/v2' }),
    at: '2026-10-26T00:00:01.000Z',
  });
  capture.recordResponse({
    requestId: 'assignment-1',
    status: 200,
    url: 'https://ss-erp.com/api/extension-device/source-workbench/ai-image-suite/listing-assignments',
    at: '2026-10-26T00:00:01.100Z',
    body: { code: 1, data: { replayed: true, assignments: [] } },
  });
  const replay = capture.requireCompleted('assignment');
  assert.equal(replay.response.body.data.replayed, true);
});

test('fails closed when a mutation has no captured response body', () => {
  const capture = createSuiteMutationCapture();
  capture.recordRequest({
    requestId: 'review-missing',
    method: 'POST',
    url: 'https://ss-erp.com/api/extension-device/media-workflows/execute',
    postData: JSON.stringify({ operation: 'MEDIA_REVIEW', command: { action: 'REVIEW_SLOT' } }),
    at: '2026-10-26T00:00:00.000Z',
  });
  assert.throws(() => capture.requireCompleted('review'), /response body/u);
});

test('CDP attachment waits for loadingFinished and keeps the session bound', async () => {
  const listeners = new Map();
  const fakeCdp = {
    on(method, listener) { listeners.set(method, listener); },
    async send(method, _params, sessionId) {
      assert.equal(method, 'Network.getResponseBody');
      assert.equal(sessionId, 'worker-session');
      return { body: JSON.stringify({ code: 1, data: { replay: false } }) };
    },
  };
  const capture = attachSuiteMutationNetworkCapture(fakeCdp, {
    sessions: new Set(['worker-session']),
  });
  listeners.get('Network.requestWillBeSent')({
    requestId: 'network-1',
    request: {
      method: 'POST',
      url: 'https://ss-erp.com/api/extension-device/media-workflows/execute',
      postData: JSON.stringify({ operation: 'MEDIA_REVIEW', command: { action: 'REVIEW_SLOT' } }),
    },
  }, 'worker-session');
  listeners.get('Network.responseReceived')({
    requestId: 'network-1',
    response: { status: 202, url: 'https://ss-erp.com/api/extension-device/media-workflows/execute' },
  }, 'worker-session');
  listeners.get('Network.loadingFinished')({ requestId: 'network-1' }, 'worker-session');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(capture.requireCompleted('review').response.body.data.replay, false);
});

test('empty owned session set never accepts another client or an unbound event', () => {
  const listeners = new Map();
  const capture = attachSuiteMutationNetworkCapture({
    on(method, listener) { listeners.set(method, listener); },
  }, { sessions: new Set() });
  listeners.get('Network.requestWillBeSent')({ requestId: 'foreign', request: {
    method: 'POST', url: 'https://ss-erp.com/api/extension-device/media-workflows/execute',
    postData: JSON.stringify({ operation: 'MEDIA_EXECUTE', command: { action: 'START' } }),
  } }, 'foreign-session');
  assert.equal(capture.snapshot().requests.length, 0);
});

test('same request ID from different owned CDP sessions cannot cross-wire bodies', async () => {
  const listeners = new Map();
  const capture = attachSuiteMutationNetworkCapture({
    on(method, listener) { listeners.set(method, listener); },
    async send(_method, _params, sessionId) {
      return { body: JSON.stringify({ code: 1, data: { sessionId } }) };
    },
  }, { sessions: new Set(['worker', 'iframe']) });
  for (const sessionId of ['worker', 'iframe']) {
    listeners.get('Network.requestWillBeSent')({ requestId: 'same-id', request: {
      method: 'POST', url: 'https://ss-erp.com/api/extension-device/media-workflows/execute',
      postData: JSON.stringify({ operation: 'MEDIA_EXECUTE', command: { action: sessionId === 'worker' ? 'START' : 'CONTINUE' } }),
    } }, sessionId);
    listeners.get('Network.responseReceived')({ requestId: 'same-id', response: {
      status: 202, url: 'https://ss-erp.com/api/extension-device/media-workflows/execute',
    } }, sessionId);
  }
  for (const sessionId of ['worker', 'iframe']) {
    listeners.get('Network.loadingFinished')({ requestId: 'same-id' }, sessionId);
  }
  await new Promise(resolve => setImmediate(resolve));
  const pairs = capture.snapshot().responses;
  assert.equal(pairs.length, 2);
  assert.deepEqual(pairs.map(pair => [pair.request.body.command.action, pair.response.body.data.sessionId]),
    [['START', 'worker'], ['CONTINUE', 'iframe']]);
});

test('decodes base64 CDP JSON response bodies instead of losing accepted mutations', async () => {
  const listeners = new Map();
  const capture = attachSuiteMutationNetworkCapture({
    on(method, listener) { listeners.set(method, listener); },
    async send() { return { body: Buffer.from(JSON.stringify({ code: 1 })).toString('base64'), base64Encoded: true }; },
  }, { sessions: new Set(['worker']) });
  listeners.get('Network.requestWillBeSent')({ requestId: 'base64', request: {
    method: 'POST', url: 'https://ss-erp.com/api/extension-device/media-workflows/execute',
    postData: JSON.stringify({ operation: 'MEDIA_EXECUTE', command: { action: 'START' } }),
  } }, 'worker');
  listeners.get('Network.responseReceived')({ requestId: 'base64', response: {
    status: 202, url: 'https://ss-erp.com/api/extension-device/media-workflows/execute',
  } }, 'worker');
  listeners.get('Network.loadingFinished')({ requestId: 'base64' }, 'worker');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(capture.requireCompleted('suite').response.body.code, 1);
});

test('captures only clean COM/CN HTTPS API URLs and never persists URL credentials or token fields', () => {
  const postData = JSON.stringify({ command: { version: 'extension-ai-image-suite-execute-command/v1', action: 'START' } });
  for (const origin of ['https://ss-erp.com', 'https://ss-erp.cn']) {
    assert.equal(classifySuiteMutationRequest({ method: 'POST',
      url: origin + '/api/extension-device/media-workflows/execute', postData }), 'suite');
  }
  for (const url of [
    'http://ss-erp.com/api/extension-device/media-workflows/execute',
    'https://foreign.invalid/api/extension-device/media-workflows/execute',
    'https://ss-erp.com:8443/api/extension-device/media-workflows/execute',
    'https://QA_USER_SENTINEL:QA_PASSWORD_SENTINEL@ss-erp.com/api/extension-device/media-workflows/execute',
    'https://ss-erp.com/api/extension-device/media-workflows/execute?grantToken=QA_URL_SENTINEL',
    'https://ss-erp.com/api/extension-device/media-workflows/execute#QA_FRAGMENT_SENTINEL',
  ]) {
    const capture = createSuiteMutationCapture();
    assert.equal(classifySuiteMutationRequest({ method: 'POST', url, postData }), null);
    assert.equal(capture.recordRequest({ requestId: 'unsafe', method: 'POST', url, postData }), null);
    assert.ok(!JSON.stringify(capture.snapshot()).includes('SENTINEL'));
  }
  const value = sanitizeSuiteTransportValue({ deviceToken: 'QA_DEVICE_SENTINEL', session_token: 'QA_SESSION_SENTINEL',
    api_key: 'QA_KEY_SENTINEL', nested: { clientSecret: 'QA_SECRET_SENTINEL' }, idempotencyKey: 'kept' });
  assert.ok(!JSON.stringify(value).includes('SENTINEL'));
  assert.equal(value.idempotencyKey, 'kept');
});

test('a failure before response headers preserves the request and records its composite identity', () => {
  const listeners = new Map();
  const capture = attachSuiteMutationNetworkCapture({ on(method, listener) { listeners.set(method, listener); } },
    { sessions: new Set(['worker']) });
  listeners.get('Network.requestWillBeSent')({ requestId: 'early-failure', request: {
    method: 'POST', url: 'https://ss-erp.com/api/extension-device/source-workbench/ai-image-suite/listing-assignments',
    postData: JSON.stringify({ idempotencyKey: 'first-assignment-unknown-outcome' }),
  } }, 'worker');
  listeners.get('Network.loadingFailed')({ requestId: 'early-failure', errorText: 'net::ERR_CONNECTION_RESET' }, 'worker');
  const snapshot = capture.snapshot();
  assert.equal(snapshot.requests.length, 1);
  assert.equal(snapshot.errors.length, 1);
  assert.equal(snapshot.errors[0].requestId, 'worker:early-failure');
  assert.equal(snapshot.unresolvedRequests[0].body.idempotencyKey, 'first-assignment-unknown-outcome');
});

for (const redirected of [false, true]) test('rejects ' + (redirected ? 'redirected' : 'foreign response') + ' mutation bodies without persisting their URLs', async () => {
  const listeners = new Map(); let bodyReads = 0;
  const capture = attachSuiteMutationNetworkCapture({
    on(method, listener) { listeners.set(method, listener); },
    async send() { bodyReads++; return { body: JSON.stringify({ code: 1 }) }; },
  }, { sessions: new Set(['worker']) });
  const url = 'https://ss-erp.com/api/extension-device/media-workflows/execute';
  const request = { method: 'POST', url, postData: JSON.stringify({ command: {
    version: 'extension-ai-image-suite-execute-command/v1', action: 'START',
  } }) };
  listeners.get('Network.requestWillBeSent')({ requestId: 'redirect', request }, 'worker');
  const foreign = 'https://foreign.invalid/api/extension-device/media-workflows/execute?token=QA_REDIRECT_SENTINEL';
  if (redirected) listeners.get('Network.requestWillBeSent')({ requestId: 'redirect',
    redirectResponse: { status: 307, url }, request: { ...request, url: foreign } }, 'worker');
  listeners.get('Network.responseReceived')({ requestId: 'redirect', response: { status: 200, url: foreign } }, 'worker');
  listeners.get('Network.loadingFinished')({ requestId: 'redirect' }, 'worker');
  await new Promise(resolve => setImmediate(resolve));
  const snapshot = capture.snapshot();
  assert.equal(bodyReads, 0);
  assert.equal(snapshot.responses.length, 0);
  assert.ok(snapshot.errors.length > 0);
  assert.ok(!JSON.stringify(snapshot).includes('QA_REDIRECT_SENTINEL'));
});

test('a redirect from an untrusted origin cannot become an eligible owned mutation', async () => {
  const listeners = new Map(); let bodyReads = 0;
  const capture = attachSuiteMutationNetworkCapture({
    on(method, listener) { listeners.set(method, listener); },
    async send() { bodyReads++; return { body: JSON.stringify({ code: 1 }) }; },
  }, { sessions: new Set(['worker']) });
  const url = 'https://ss-erp.cn/api/extension-device/media-workflows/execute';
  listeners.get('Network.requestWillBeSent')({ requestId: 'incoming',
    redirectResponse: { url: 'https://foreign.invalid/?token=QA_INCOMING_SENTINEL', status: 307 },
    request: { method: 'POST', url, postData: JSON.stringify({ command: {
      version: 'extension-ai-image-suite-execute-command/v1', action: 'START',
    } }) } }, 'worker');
  listeners.get('Network.responseReceived')({ requestId: 'incoming', response: { status: 200, url } }, 'worker');
  listeners.get('Network.loadingFinished')({ requestId: 'incoming' }, 'worker');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(bodyReads, 0);
  assert.equal(capture.snapshot().responses.length, 0);
  assert.ok(capture.snapshot().errors.length > 0);
  assert.ok(!JSON.stringify(capture.snapshot()).includes('QA_INCOMING_SENTINEL'));
});
