import { createHash } from 'node:crypto';

const REVIEW_PATH = '/api/extension-device/media-workflows/execute';
const ASSIGNMENT_PATH = '/api/extension-device/source-workbench/ai-image-suite/listing-assignments';
const COMMAND_GRANT_PATH = '/api/extension-device/command-grants';
const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;
const API_ORIGINS = new Set(['https://ss-erp.com', 'https://ss-erp.cn']);
const SECRET_KEY = /authorization|bearer|token|password|apikey|secret|commandgrant/iu;

function parseJson(value) {
  if (typeof value !== 'string' || !value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function mutationUrl(value) {
  try {
    const url = new URL(value);
    if (!API_ORIGINS.has(url.origin) || url.username || url.password || url.search || url.hash) return null;
    return `${url.origin}${url.pathname}`;
  } catch { return null; }
}

export function assertExclusiveTargetOwnership(target, ownedTargets) {
  if (!target || !target.targetId) throw new Error('extension target identity is missing');
  if (ownedTargets.has(target.targetId)) return 'owned';
  if (target.attached) {
    throw new Error(`extension target is already attached by another CDP client: ${target.targetId}`);
  }
  return 'available';
}

export function sanitizeSuiteTransportValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeSuiteTransportValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      SECRET_KEY.test(key.replace(/[-_]/gu, ''))
        ? '[REDACTED]'
        : sanitizeSuiteTransportValue(item),
    ]));
  }
  return value;
}

export function classifySuiteMutationRequest({ method, url, postData } = {}) {
  if (method !== 'POST') return null;
  const safeUrl = mutationUrl(url);
  if (!safeUrl) return null;
  const path = new URL(safeUrl).pathname;
  if (path === ASSIGNMENT_PATH) return 'assignment';
  if (path !== REVIEW_PATH) return null;
  const body = parseJson(postData);
  if (body?.operation === 'MEDIA_REVIEW' && body?.command?.action === 'REVIEW_SLOT') return 'review';
  // listing-workflow-client deliberately omits operation from execute envelopes;
  // only command-grants and review mutations carry that field on the wire.
  if ((body?.operation === 'MEDIA_EXECUTE'
      || !Object.hasOwn(body || {}, 'operation')
        && body?.command?.version === 'extension-ai-image-suite-execute-command/v1')
    && ['START', 'CONTINUE'].includes(body?.command?.action)) return 'suite';
  return null;
}

function responseRecord(recordValue, body) {
  const bytes = Buffer.byteLength(JSON.stringify(body ?? null), 'utf8');
  if (bytes > MAX_CAPTURE_BYTES) throw new Error('suite mutation response body exceeds capture limit');
  return {
    ...recordValue,
    body: sanitizeSuiteTransportValue(body),
    bodySha256: createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex'),
  };
}

export function createSuiteMutationCapture() {
  const requests = new Map();
  const completed = new Map();
  const errors = [];

  return {
    requests,
    completed,
    errors,
    recordRequest(input) {
      const kind = classifySuiteMutationRequest(input);
      if (!kind || !input.requestId) return null;
      const body = parseJson(input.postData);
      const value = {
        kind,
        requestId: String(input.requestId),
        method: input.method,
        url: mutationUrl(input.url),
        at: input.at || new Date().toISOString(),
        body: sanitizeSuiteTransportValue(body),
      };
      requests.set(value.requestId, value);
      return value;
    },
    recordResponse(input) {
      const request = requests.get(String(input.requestId));
      if (!request) return null;
      const url = input.url === undefined ? request.url : mutationUrl(input.url);
      if (url !== request.url || input.status >= 300 && input.status < 400) {
        errors.push({ kind: request.kind, requestId: request.requestId, error: 'redirected or untrusted mutation response' });
        return null;
      }
      if (input.body === undefined) {
        errors.push({ kind: request.kind, requestId: request.requestId, error: 'response body unavailable' });
        return null;
      }
      const value = responseRecord({
        kind: request.kind,
        requestId: request.requestId,
        method: request.method,
        request: request.body,
        url,
        status: input.status,
        at: input.at || new Date().toISOString(),
      }, input.body);
      const pair = { request, response: value };
      completed.set(request.requestId, pair);
      return pair;
    },
    recordFailure(requestId, error) {
      const request = requests.get(String(requestId));
      if (!request) return;
      errors.push({ kind: request.kind, requestId: request.requestId, error });
    },
    requireCompleted(kind) {
      const values = [...completed.values()].filter(value => value.request.kind === kind);
      if (!values.length) throw new Error(`${kind} mutation response body is missing`);
      return values.at(-1);
    },
    snapshot() {
      return {
        requests: [...requests.values()],
        responses: [...completed.values()],
        unresolvedRequests: [...requests.values()].filter(request => !completed.has(request.requestId)),
        errors: errors.slice(),
      };
    },
  };
}

/**
 * Attach to the browser-level CDP connection used by the real suite runner.
 * The runner must enable Network on the extension Worker and iframe sessions
 * before any mutation. Command-grant responses are intentionally ignored;
 * only the grant-protected business response is persisted.
 */
export function attachSuiteMutationNetworkCapture(cdp, options = {}) {
  const capture = createSuiteMutationCapture();
  const sessions = options.sessions || new Set();
  const pendingResponses = new Map();
  const rejectedRequests = new Set();
  const isSessionAllowed = sessionId => Boolean(sessionId) && sessions.has(sessionId);
  const requestKey = (sessionId, requestId) => `${sessionId}:${requestId}`;
  const onRequest = (event, sessionId) => {
    if (!isSessionAllowed(sessionId)) return;
    const key = requestKey(sessionId, event?.requestId);
    const input = {
      requestId: key,
      method: event?.request?.method,
      url: event?.request?.url,
      postData: event?.request?.postData,
      at: new Date().toISOString(),
    };
    if (event?.redirectResponse) {
      const request = capture.requests.get(key) || capture.recordRequest(input);
      if (request) {
        rejectedRequests.add(key); pendingResponses.delete(key);
        capture.recordFailure(key, 'redirected mutation is not eligible for capture');
      }
      return;
    }
    capture.recordRequest(input);
  };
  const onResponse = (event, sessionId) => {
    if (!isSessionAllowed(sessionId)) return;
    const key = requestKey(sessionId, event?.requestId), request = capture.requests.get(key);
    if (!request || rejectedRequests.has(key)) return;
    const url = mutationUrl(event.response?.url || request.url);
    if (url !== request.url || event.response?.status >= 300 && event.response.status < 400) {
      rejectedRequests.add(key); pendingResponses.delete(key);
      capture.recordFailure(key, 'redirected or untrusted mutation response');
      return;
    }
    pendingResponses.set(`${sessionId || ''}:${event.requestId}`, {
      sessionId,
      requestId: event.requestId,
      captureRequestId: requestKey(sessionId, event.requestId),
      status: event.response?.status,
      url,
      at: new Date().toISOString(),
    });
  };
  const onFinished = async (event, sessionId) => {
    const key = `${sessionId || ''}:${event?.requestId || ''}`;
    const pending = pendingResponses.get(key);
    if (!pending) return;
    pendingResponses.delete(key);
    try {
      const raw = await cdp.send('Network.getResponseBody', {
        requestId: pending.requestId,
      }, pending.sessionId);
      const body = raw.base64Encoded ? Buffer.from(raw.body, 'base64').toString('utf8') : raw.body;
      const bodyValue = parseJson(body);
      if (bodyValue === null) throw new Error('response body is not JSON');
      if (!rejectedRequests.has(pending.captureRequestId)) {
        capture.recordResponse({ ...pending, requestId: pending.captureRequestId, body: bodyValue });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      capture.recordFailure(pending.captureRequestId,
        ['response body is not JSON', 'suite mutation response body exceeds capture limit'].includes(message)
          ? message : 'response body unavailable');
    }
  };
  const onFailed = (event, sessionId) => {
    if (!isSessionAllowed(sessionId)) return;
    const key = requestKey(sessionId, event?.requestId);
    if (!capture.requests.has(key)) return;
    pendingResponses.delete(key);
    rejectedRequests.add(key);
    capture.recordFailure(key, 'network loading failed');
  };
  cdp.on('Network.requestWillBeSent', onRequest);
  cdp.on('Network.responseReceived', onResponse);
  cdp.on('Network.loadingFinished', (event, sessionId) => { void onFinished(event, sessionId); });
  cdp.on('Network.loadingFailed', onFailed);
  return capture;
}

export const suiteMutationPaths = Object.freeze({
  review: REVIEW_PATH,
  assignment: ASSIGNMENT_PATH,
  commandGrant: COMMAND_GRANT_PATH,
});
