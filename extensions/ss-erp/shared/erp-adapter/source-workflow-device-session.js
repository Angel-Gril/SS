(function (global) {
  'use strict';

  var DEFAULT_REQUEST_TIMEOUT_MS = 10000;
  var MAX_RESPONSE_BYTES = 512 * 1024;

  function requiredText(value, label) {
    var normalized = String(value == null ? '' : value).normalize('NFKC').trim();
    if (!normalized) throw new TypeError(label + ' is required');
    return normalized;
  }

  function statusPath(value) {
    var path = requiredText(value, 'path');
    if (!path.startsWith('/api/extension-device/source-workbench/')) {
      throw new TypeError('source workbench path is invalid');
    }
    var parsed = new URL(path, 'https://ss-erp.invalid');
    if (parsed.origin !== 'https://ss-erp.invalid'
      || !parsed.pathname.startsWith('/api/extension-device/source-workbench/')) {
      throw new TypeError('source workbench path is invalid');
    }
    return parsed.pathname + parsed.search;
  }

  function responseHeader(response, name) {
    return response && response.headers && typeof response.headers.get === 'function'
      ? response.headers.get(name)
      : null;
  }

  function byteLength(value) {
    return new TextEncoder().encode(value).byteLength;
  }

  async function readJsonResponse(response) {
    var contentLength = Number(responseHeader(response, 'content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
      throw new Error('source workbench response is too large');
    }

    var body = response && response.body;
    if (body && typeof body.getReader === 'function') {
      var reader = body.getReader();
      var chunks = [];
      var total = 0;
      try {
        while (true) {
          var part = await reader.read();
          if (part.done) break;
          var chunk = part.value instanceof Uint8Array ? part.value : new Uint8Array(part.value || []);
          total += chunk.byteLength;
          if (total > MAX_RESPONSE_BYTES) {
            if (typeof reader.cancel === 'function') await reader.cancel();
            throw new Error('source workbench response is too large');
          }
          chunks.push(chunk);
        }
      } finally {
        if (typeof reader.releaseLock === 'function') reader.releaseLock();
      }
      var bytes = new Uint8Array(total);
      var offset = 0;
      chunks.forEach(function (chunk) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      });
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    }

    if (!response || typeof response.text !== 'function') {
      throw new Error('source workbench response body is unavailable');
    }
    var text = await response.text();
    if (byteLength(text) > MAX_RESPONSE_BYTES) {
      throw new Error('source workbench response is too large');
    }
    return JSON.parse(text);
  }

  function createTransport(options) {
    var credentials = options && options.credentials;
    var fetchImpl = options && options.fetchImpl;
    var configuredTimeout = Number(options && options.requestTimeoutMs);
    var requestTimeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
      ? Math.min(configuredTimeout, DEFAULT_REQUEST_TIMEOUT_MS)
      : DEFAULT_REQUEST_TIMEOUT_MS;
    if (!credentials || typeof credentials.beginOperation !== 'function') {
      throw new TypeError('device credentials are required');
    }
    if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');

    async function operationCurrent(operation) {
      return typeof credentials.isOperationCurrent === 'function'
        && Boolean(await credentials.isOperationCurrent(operation));
    }

    return {
      async get(pathValue) {
        var path = statusPath(pathValue);
        var controller = new AbortController();
        var timeoutId;
        var timeout = new Promise(function (_resolve, reject) {
          timeoutId = setTimeout(function () {
            controller.abort();
            reject(new Error('source workbench request timed out'));
          }, requestTimeoutMs);
        });
        var request = (async function () {
          var operation = await credentials.beginOperation();
          if (!operation || operation.state !== 'paired') return { state: 'unpaired' };
          if (!Array.isArray(operation.scopes) || !operation.scopes.includes('listing:review')) {
            return { state: 'scope_required', scope: 'listing:review' };
          }
          var accessToken = requiredText(operation.accessToken, 'device access token');
          var baseUrl = requiredText(operation.baseUrl, 'baseUrl').replace(/\/+$/, '');
          var response = await fetchImpl(baseUrl + path, {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              Authorization: 'Bearer ' + accessToken,
            },
            credentials: 'omit',
            cache: 'no-store',
            signal: controller.signal,
          });
          if (!await operationCurrent(operation)) {
            throw new Error('device credential operation superseded');
          }
          if (response.status === 401 || response.status === 410) {
            if (typeof credentials.clearIfCurrent === 'function') {
              var cleared = await credentials.clearIfCurrent(operation, {
                status: response.status,
                reason: 'source_workbench_authorization_revoked',
              });
              if (!cleared) throw new Error('device credential operation superseded');
            }
            return { state: 'authorization_required', status: response.status };
          }
          if (response.status === 403) return { state: 'scope_required', scope: 'listing:review' };
          if (response.status === 404) return { state: 'not_found' };
          if (!response.ok) return { state: 'http_error', status: response.status };
          var responseBody = await readJsonResponse(response);
          if (!await operationCurrent(operation)) {
            throw new Error('device credential operation superseded');
          }
          return { state: 'response', status: response.status, body: responseBody };
        })();
        try {
          return await Promise.race([request, timeout]);
        } catch (error) {
          if (controller.signal.aborted) throw new Error('source workbench request timed out');
          throw error;
        } finally {
          clearTimeout(timeoutId);
        }
      },
    };
  }

  global.SS_ERP_SOURCE_WORKFLOW_DEVICE_SESSION = {
    createTransport: createTransport,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
