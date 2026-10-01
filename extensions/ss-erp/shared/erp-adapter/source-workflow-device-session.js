(function (global) {
  'use strict';

  var DEFAULT_REQUEST_TIMEOUT_MS = 10000;
  var DEFAULT_PUBLISH_REQUEST_TIMEOUT_MS = 30000;
  var DEFAULT_MASK_REQUEST_TIMEOUT_MS = 60000;
  var MAX_RESPONSE_BYTES = 512 * 1024;
  var MAX_COMMAND_REQUEST_BYTES = 64 * 1024;
  var MAX_PUBLISH_RESPONSE_BYTES = 4 * 1024 * 1024;
  var MAX_PUBLISH_REQUEST_BYTES = 1 * 1024 * 1024;
  var MAX_SHOP_ANALYTICS_REQUEST_BYTES = 1 * 1024 * 1024;
  var MAX_MEDIA_EDIT_MASK_REQUEST_BYTES = 30 * 1024 * 1024;
  var MAX_BYOK_INGEST_REQUEST_BYTES = 20 * 1024 * 1024;
  var MAX_BYOK_BATCH_INGEST_REQUEST_BYTES = 50 * 1024 * 1024;
  var MAX_BYOK_BATCH_MANIFEST_BYTES = 64 * 1024;
  var MAX_HOSTED_PREVIEW_RESPONSE_BYTES = 20 * 1024 * 1024;
  var MAX_BYOK_INGEST_MANIFEST_CHARACTERS = Math.ceil(16 * 1024 * 4 / 3) + 8;
  var MEDIA_EDIT_SOURCE_PATH = '/api/extension-device/source-workbench/media-edit-source';
  var MEDIA_EDIT_MASK_PATH = '/api/extension-device/source-workbench/media-edit-mask';
  var BYOK_MEDIA_INGEST_PATH = '/api/extension-device/byok-media/ingest';
  var BYOK_MEDIA_INGEST_STATUS_PATH = '/api/extension-device/byok-media/ingest-status';
  var BYOK_MEDIA_BATCH_INGEST_PATH = '/api/extension-device/byok-media/batch-ingest';
  var BYOK_MEDIA_BATCH_INGEST_STATUS_PATH =
    '/api/extension-device/byok-media/batch-ingest-status';
  var BYOK_READINESS_PATH = '/api/extension-device/byok-media/readiness';
  var BYOK_WORKBENCH_LAUNCH_PATH = '/api/extension-device/byok-media/workbench-launch';
  var BYOK_WORKBENCH_BATCH_LAUNCH_PATH =
    '/api/extension-device/byok-media/workbench-batch-launch';
  var BYOK_EXECUTION_INTENT_PATH = '/api/extension-device/byok-media/execution-intents';
  var BYOK_EXECUTION_BATCH_PATH = '/api/extension-device/byok-media/execution-batches';
  var BYOK_EXECUTION_BATCH_STATUS_V2_QUERY =
    '?contractVersion=extension-byok-execution-batch-status%2Fv2';
  var BYOK_PUBLISH_PREVIEW_PATH = '/api/extension-device/byok-publish/preview';
  var BYOK_PUBLISH_PREPARE_PATH = '/api/extension-device/byok-publish/prepare';
  var BYOK_PUBLISH_STATUS_PATH = '/api/extension-device/byok-publish/status';
  var WORKBENCH_PUBLISH_PREVIEW_PATH = '/api/extension-device/workbench-publish/preview';
  var WORKBENCH_PUBLISH_PREPARE_PATH = '/api/extension-device/workbench-publish/prepare';
  var WORKBENCH_PUBLISH_STATUS_PATH = '/api/extension-device/workbench-publish/status';
  var OZON_PUBLISH_EXECUTE_PATH = '/api/extension-device/ozon-publish/execute';
  var BROWSER_ONE_CLICK_JOBS_PATH = '/api/extension-device/browser-one-click/jobs';
  var BROWSER_ONE_CLICK_STATUS_PATH = '/api/extension-device/browser-one-click/status/read';
  var BROWSER_ONE_CLICK_WATERMARK_PATH =
    '/api/extension-device/browser-one-click/watermark-templates/read';
  var PRODUCT_SELECTION_RULES_PATH = '/api/extension-device/product-selection/rules';
  var SOURCE_WORKBENCH_DRAFT_PATH = '/api/extension-device/source-workbench/drafts';
  var HOSTED_PLAN_PATH = '/api/extension-device/source-workbench/plans';
  var HOSTED_LISTING_ASSIGNMENT_PATH =
    '/api/extension-device/source-workbench/ai-image-suite/listing-assignments';
  var HOSTED_PREVIEW_PATH =
    '/api/extension-device/source-workbench/ai-image-suite/candidate-preview';
  var HOSTED_PREVIEW_CONSUME_PATH = HOSTED_PREVIEW_PATH + '/consume';
  var SOURCE_MEDIA_PREVIEW_PATH =
    '/api/extension-device/source-workbench/media-preview';
  var DEVICE_AUTHORIZATION_ERROR_CODES = new Set([
    'byok_batch_ingest_session_invalid',
    'byok_ingest_session_invalid',
    'command_session_invalid',
    'device_shop_revoked',
    'device_token_required',
    'invalid_device_context',
    'invalid_device_token',
  ]);
  var LARGE_PUBLISH_REQUEST_PATHS = new Set([
    '/api/extension-device/command-grants',
    WORKBENCH_PUBLISH_PREVIEW_PATH,
    WORKBENCH_PUBLISH_PREPARE_PATH,
    WORKBENCH_PUBLISH_STATUS_PATH,
    OZON_PUBLISH_EXECUTE_PATH,
    BROWSER_ONE_CLICK_JOBS_PATH,
    BROWSER_ONE_CLICK_WATERMARK_PATH,
  ]);
  var PUBLISH_REQUEST_PATHS = new Set([
    '/api/extension-device/command-grants',
    BYOK_PUBLISH_PREVIEW_PATH,
    BYOK_PUBLISH_PREPARE_PATH,
    BYOK_PUBLISH_STATUS_PATH,
    WORKBENCH_PUBLISH_PREVIEW_PATH,
    WORKBENCH_PUBLISH_PREPARE_PATH,
    WORKBENCH_PUBLISH_STATUS_PATH,
    OZON_PUBLISH_EXECUTE_PATH,
    BROWSER_ONE_CLICK_JOBS_PATH,
    BROWSER_ONE_CLICK_WATERMARK_PATH,
  ]);
  var MEDIA_EDIT_LONG_REQUEST_PATHS = new Set([
    MEDIA_EDIT_SOURCE_PATH,
    MEDIA_EDIT_MASK_PATH,
    BYOK_MEDIA_INGEST_PATH,
    BYOK_MEDIA_BATCH_INGEST_PATH,
    HOSTED_PREVIEW_CONSUME_PATH,
    SOURCE_MEDIA_PREVIEW_PATH,
  ]);
  var BYOK_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

  function requestFailure(message, requestDispatched) {
    var error = new Error(message);
    error.name = 'ExtensionSourceWorkflowRequestError';
    error.code = requestDispatched
      ? 'SS_ERP_SOURCE_WORKFLOW_REQUEST_OUTCOME_UNKNOWN'
      : 'SS_ERP_SOURCE_WORKFLOW_REQUEST_NOT_SUBMITTED';
    error.outcome = requestDispatched ? 'UNKNOWN_OUTCOME' : 'NOT_SUBMITTED';
    error.requestDispatched = requestDispatched;
    if (requestDispatched) error.automaticRetryAllowed = false;
    return error;
  }

  function responseErrorCode(body) {
    return body && typeof body === 'object' && !Array.isArray(body)
      ? String(body.errorCode || '').normalize('NFKC').trim().toLowerCase()
      : '';
  }

  function deviceAuthorizationRejected(status, body) {
    var code = responseErrorCode(body);
    if (status === 401) {
      // An unreadable 401 must remain fail-closed. A readable business-level
      // 401 (for example a missing command grant) must not erase the valid
      // rotating device credential.
      return !code || DEVICE_AUTHORIZATION_ERROR_CODES.has(code);
    }
    return status === 410 && DEVICE_AUTHORIZATION_ERROR_CODES.has(code);
  }

  function requiredText(value, label) {
    var normalized = String(value == null ? '' : value).normalize('NFKC').trim();
    if (!normalized) throw new TypeError(label + ' is required');
    return normalized;
  }

  function exactEncodedIdentifier(value) {
    if (!value || value.includes('/')) return false;
    try {
      var decoded = decodeURIComponent(value);
      return decoded.length > 0 && decoded.length <= 200
        && decoded === decoded.normalize('NFKC').trim()
        && !decoded.includes('/') && !decoded.includes('\\')
        && encodeURIComponent(decoded) === value;
    } catch {
      return false;
    }
  }

  function browserOneClickJobWritePath(candidate) {
    var prefix = BROWSER_ONE_CLICK_JOBS_PATH + '/';
    return candidate.startsWith(prefix)
      && exactEncodedIdentifier(candidate.slice(prefix.length));
  }

  function browserOneClickJobReadPath(candidate) {
    var prefix = BROWSER_ONE_CLICK_JOBS_PATH + '/';
    var suffix = '/read';
    return candidate.startsWith(prefix)
      && candidate.endsWith(suffix)
      && exactEncodedIdentifier(candidate.slice(prefix.length, -suffix.length));
  }

  function requestPath(value, method) {
    var path = requiredText(value, 'path');
    var commandPaths = new Set([
      '/api/extension-device/command-grants',
      '/api/extension-device/erp-launch-grants/consume',
      '/api/extension-device/media-workflows/execute',
      MEDIA_EDIT_SOURCE_PATH,
      MEDIA_EDIT_MASK_PATH,
      BYOK_MEDIA_INGEST_PATH,
      BYOK_MEDIA_INGEST_STATUS_PATH,
      BYOK_MEDIA_BATCH_INGEST_PATH,
      BYOK_MEDIA_BATCH_INGEST_STATUS_PATH,
      BYOK_READINESS_PATH,
      BYOK_WORKBENCH_LAUNCH_PATH,
      BYOK_WORKBENCH_BATCH_LAUNCH_PATH,
      BYOK_EXECUTION_INTENT_PATH,
      BYOK_EXECUTION_BATCH_PATH,
      BYOK_PUBLISH_PREVIEW_PATH,
      BYOK_PUBLISH_PREPARE_PATH,
      BYOK_PUBLISH_STATUS_PATH,
      WORKBENCH_PUBLISH_PREVIEW_PATH,
      WORKBENCH_PUBLISH_PREPARE_PATH,
      WORKBENCH_PUBLISH_STATUS_PATH,
      OZON_PUBLISH_EXECUTE_PATH,
      BROWSER_ONE_CLICK_STATUS_PATH,
      BROWSER_ONE_CLICK_JOBS_PATH,
      BROWSER_ONE_CLICK_WATERMARK_PATH,
      SOURCE_WORKBENCH_DRAFT_PATH,
      '/api/extension-device/source-workbench/editor/read',
      '/api/extension-device/source-workbench/editor/catalog',
      '/api/extension-device/source-workbench/editor/attributes',
      '/api/extension-device/source-workbench/editor/dictionary',
      '/api/extension-device/source-workbench/editor/save',
      HOSTED_PLAN_PATH,
      HOSTED_LISTING_ASSIGNMENT_PATH,
      HOSTED_PREVIEW_PATH,
      HOSTED_PREVIEW_CONSUME_PATH,
      SOURCE_MEDIA_PREVIEW_PATH,
    ]);
    function hostedPlanReviewPath(candidate) {
      var prefix = HOSTED_PLAN_PATH + '/';
      var suffix = '/review';
      if (!candidate.startsWith(prefix) || !candidate.endsWith(suffix)) return false;
      var encodedPlanId = candidate.slice(prefix.length, -suffix.length);
      if (!encodedPlanId || encodedPlanId.includes('/')) return false;
      try {
        var planId = decodeURIComponent(encodedPlanId);
        return planId.length > 0 && planId.length <= 200
          && planId === planId.normalize('NFKC').trim()
          && !planId.includes('/') && !planId.includes('\\')
          && encodeURIComponent(planId) === encodedPlanId;
      } catch {
        return false;
      }
    }
    function byokExecutionIntentOutcomePath(candidate) {
      var prefix = BYOK_EXECUTION_INTENT_PATH + '/';
      var suffix = '/outcome';
      if (!candidate.startsWith(prefix) || !candidate.endsWith(suffix)) return false;
      var encodedIntentId = candidate.slice(prefix.length, -suffix.length);
      if (!encodedIntentId || encodedIntentId.includes('/')) return false;
      try {
        var intentId = decodeURIComponent(encodedIntentId);
        return intentId.length > 0 && intentId.length <= 200
          && intentId === intentId.normalize('NFKC').trim()
          && !intentId.includes('/') && !intentId.includes('\\')
          && encodeURIComponent(intentId) === encodedIntentId;
      } catch {
        return false;
      }
    }
    function byokExecutionBatchMutationPath(candidate) {
      var prefix = BYOK_EXECUTION_BATCH_PATH + '/';
      if (!candidate.startsWith(prefix)) return false;
      var remainder = candidate.slice(prefix.length);
      var cancelSuffix = '/cancel';
      if (remainder.endsWith(cancelSuffix)) {
        return exactEncodedIdentifier(remainder.slice(0, -cancelSuffix.length));
      }
      var match = /^([^/]+)\/items\/([0-3])\/attempts$/u.exec(remainder);
      return Boolean(match && exactEncodedIdentifier(match[1]));
    }
    function byokExecutionBatchReadPath(candidate) {
      var prefix = BYOK_EXECUTION_BATCH_PATH + '/';
      if (!candidate.startsWith(prefix)) return false;
      var remainder = candidate.slice(prefix.length);
      var idempotencyPrefix = 'by-idempotency/';
      if (remainder.startsWith(idempotencyPrefix)) {
        return exactEncodedIdentifier(remainder.slice(idempotencyPrefix.length));
      }
      return exactEncodedIdentifier(remainder);
    }
    function shopAnalyticsWritePath(candidate) {
      var prefix = '/api/extension-device/shops/';
      if (!candidate.startsWith(prefix)) return false;
      var remainder = candidate.slice(prefix.length);
      var analyticsSuffix = '/analytics';
      var graphsSuffix = '/analytics-graphs';
      var suffix = remainder.endsWith(graphsSuffix) ? graphsSuffix
        : remainder.endsWith(analyticsSuffix) ? analyticsSuffix : '';
      return Boolean(suffix
        && exactEncodedIdentifier(remainder.slice(0, -suffix.length)));
    }
    function allowedGetPath(candidate) {
      return candidate === PRODUCT_SELECTION_RULES_PATH
        || candidate.startsWith('/api/extension-device/source-workbench/')
        || byokExecutionBatchReadPath(candidate);
    }
    function allowedPostPath(candidate) {
      return commandPaths.has(candidate)
        || hostedPlanReviewPath(candidate)
        || byokExecutionIntentOutcomePath(candidate)
        || byokExecutionBatchMutationPath(candidate)
        || shopAnalyticsWritePath(candidate)
        || browserOneClickJobWritePath(candidate)
        || browserOneClickJobReadPath(candidate)
        || candidate === PRODUCT_SELECTION_RULES_PATH
        || /^\/api\/extension-device\/product-selection\/rules\/[^/]+\/(?:toggle|delete)$/u.test(candidate);
    }
    var parsed;
    try { parsed = new URL(path, 'https://ss-erp.invalid'); } catch {
      throw new TypeError('source workbench path is invalid');
    }
    var allowedPath = method === 'GET'
      ? allowedGetPath(parsed.pathname) : allowedPostPath(parsed.pathname);
    var executionBatchRead = method === 'GET'
      && byokExecutionBatchReadPath(parsed.pathname);
    var allowedQuery = method === 'GET'
      ? (!executionBatchRead || parsed.search === ''
        || parsed.search === BYOK_EXECUTION_BATCH_STATUS_V2_QUERY)
      : parsed.search === '';
    if (parsed.origin !== 'https://ss-erp.invalid'
      || path !== parsed.pathname + parsed.search
      || !allowedPath
      || !allowedQuery) {
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

  function byokBinaryRequest(blobValue, commandOptions, path) {
    if (path !== BYOK_MEDIA_INGEST_PATH
      || typeof Blob === 'undefined'
      || !(blobValue instanceof Blob)
      || !Number.isSafeInteger(blobValue.size)
      || blobValue.size < 1
      || blobValue.size > MAX_BYOK_INGEST_REQUEST_BYTES) {
      throw new TypeError('BYOK ingest image Blob is invalid');
    }
    var contentType = requiredText(commandOptions && commandOptions.contentType, 'contentType')
      .toLowerCase();
    if (!BYOK_IMAGE_MIME_TYPES.has(contentType)
      || (blobValue.type && blobValue.type.toLowerCase() !== contentType)) {
      throw new TypeError('BYOK ingest image MIME is invalid');
    }
    var manifest = String(commandOptions && commandOptions.manifest || '').trim();
    if (!manifest
      || manifest.length > MAX_BYOK_INGEST_MANIFEST_CHARACTERS
      || !/^[A-Za-z0-9_-]+$/.test(manifest)) {
      throw new TypeError('BYOK ingest manifest is invalid');
    }
    var commandGrant = String(commandOptions && commandOptions.commandGrant || '').trim();
    if (!/^[A-Za-z0-9_-]{43,4096}$/.test(commandGrant)) {
      throw new TypeError('BYOK ingest command grant is invalid');
    }
    return {
      body: blobValue,
      contentType: contentType,
      manifest: manifest,
      commandGrant: commandGrant,
    };
  }

  function byokBatchMultipartRequest(formValue, commandOptions, path) {
    if (path !== BYOK_MEDIA_BATCH_INGEST_PATH
      || typeof FormData === 'undefined'
      || !(formValue instanceof FormData)) {
      throw new TypeError('BYOK batch ingest form is invalid');
    }
    var entries = Array.from(formValue.entries());
    if (entries.length < 2 || entries.length > 5
      || entries[0][0] !== 'manifest' || typeof entries[0][1] !== 'string') {
      throw new TypeError('BYOK batch ingest form is invalid');
    }
    var manifestText = entries[0][1];
    if (byteLength(manifestText) < 1 || byteLength(manifestText) > MAX_BYOK_BATCH_MANIFEST_BYTES) {
      throw new TypeError('BYOK batch ingest manifest is invalid');
    }
    var manifest;
    try { manifest = JSON.parse(manifestText); } catch {
      throw new TypeError('BYOK batch ingest manifest is invalid');
    }
    var items = manifest && manifest.command && manifest.command.items;
    if (manifest.contractVersion !== 'extension-byok-media-batch-ingest-manifest/v1'
      || manifest.operation !== 'BYOK_MEDIA_INGEST'
      || typeof manifest.executionBatchId !== 'string'
      || manifest.executionBatchId !== manifest.executionBatchId.normalize('NFKC').trim()
      || manifest.executionBatchId.length < 1 || manifest.executionBatchId.length > 200
      || !manifest.command || manifest.command.executionBatchId !== manifest.executionBatchId
      || !Array.isArray(items)
      || items.length !== entries.length - 1
      || items.length < 1 || items.length > 4) {
      throw new TypeError('BYOK batch ingest manifest is invalid');
    }
    var totalBytes = 0;
    for (var index = 0; index < items.length; index += 1) {
      var entry = entries[index + 1];
      var blob = entry[1];
      var item = items[index];
      if (entry[0] !== 'image-' + index
        || typeof Blob === 'undefined' || !(blob instanceof Blob)
        || !Number.isSafeInteger(blob.size) || blob.size < 1
        || blob.size > MAX_BYOK_INGEST_REQUEST_BYTES
        || !BYOK_IMAGE_MIME_TYPES.has(blob.type)
        || !item || item.resultMimeType !== blob.type
        || item.resultSizeBytes !== blob.size) {
        throw new TypeError('BYOK batch ingest image is invalid');
      }
      totalBytes += blob.size;
    }
    if (totalBytes > MAX_BYOK_BATCH_INGEST_REQUEST_BYTES) {
      throw new TypeError('BYOK batch ingest images are too large');
    }
    var commandGrant = String(commandOptions && commandOptions.commandGrant || '').trim();
    if (!/^[A-Za-z0-9_-]{43,4096}$/.test(commandGrant)) {
      throw new TypeError('BYOK batch ingest command grant is invalid');
    }
    return { body: formValue, commandGrant: commandGrant };
  }

  async function readJsonResponse(response, maximumBytes) {
    var byteLimit = Number.isSafeInteger(maximumBytes) && maximumBytes > 0
      ? maximumBytes
      : MAX_RESPONSE_BYTES;
    var contentLength = Number(responseHeader(response, 'content-length'));
    if (Number.isFinite(contentLength) && contentLength > byteLimit) {
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
          if (total > byteLimit) {
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
    if (byteLength(text) > byteLimit) {
      throw new Error('source workbench response is too large');
    }
    return JSON.parse(text);
  }

  async function readBinaryResponse(response, maximumBytes) {
    var rawLength = responseHeader(response, 'content-length');
    if (typeof rawLength !== 'string' || !/^[1-9]\d{0,8}$/.test(rawLength)) {
      throw new Error('source workbench binary response length is invalid');
    }
    var declaredLength = Number(rawLength);
    if (!Number.isSafeInteger(declaredLength) || declaredLength > maximumBytes) {
      throw new Error('source workbench binary response is too large');
    }
    var body = response && response.body;
    if (body && typeof body.getReader === 'function') {
      var reader = body.getReader();
      var chunks = [];
      var total = 0;
      try {
        while (true) {
          var part = await reader.read();
          if (!part || part.done) break;
          if (!(part.value instanceof Uint8Array)) {
            if (typeof reader.cancel === 'function') await reader.cancel();
            throw new Error('source workbench binary response is invalid');
          }
          total += part.value.byteLength;
          if (total > declaredLength || total > maximumBytes) {
            if (typeof reader.cancel === 'function') await reader.cancel();
            throw new Error('source workbench binary response is too large');
          }
          chunks.push(part.value);
        }
      } finally {
        if (typeof reader.releaseLock === 'function') reader.releaseLock();
      }
      if (total !== declaredLength) {
        throw new Error('source workbench binary response length changed');
      }
      var result = new Uint8Array(total);
      var offset = 0;
      chunks.forEach(function (chunk) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
      });
      return result;
    }
    if (!response || typeof response.arrayBuffer !== 'function') {
      throw new Error('source workbench binary response body is unavailable');
    }
    var buffer = await response.arrayBuffer();
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== declaredLength
      || buffer.byteLength > maximumBytes) {
      throw new Error('source workbench binary response length changed');
    }
    return new Uint8Array(buffer);
  }

  function createTransport(options) {
    var credentials = options && options.credentials;
    var fetchImpl = options && options.fetchImpl;
    var configuredTimeout = Number(options && options.requestTimeoutMs);
    var requestTimeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
      ? Math.min(configuredTimeout, DEFAULT_REQUEST_TIMEOUT_MS)
      : DEFAULT_REQUEST_TIMEOUT_MS;
    var configuredPublishTimeout = Number(options && options.publishRequestTimeoutMs);
    var publishRequestTimeoutMs = Number.isFinite(configuredPublishTimeout)
      && configuredPublishTimeout > 0
      ? Math.min(configuredPublishTimeout, DEFAULT_PUBLISH_REQUEST_TIMEOUT_MS)
      : DEFAULT_PUBLISH_REQUEST_TIMEOUT_MS;
    var configuredMaskTimeout = Number(options && options.maskRequestTimeoutMs);
    var maskRequestTimeoutMs = Number.isFinite(configuredMaskTimeout) && configuredMaskTimeout > 0
      ? Math.min(configuredMaskTimeout, DEFAULT_MASK_REQUEST_TIMEOUT_MS)
      : DEFAULT_MASK_REQUEST_TIMEOUT_MS;
    if (!credentials || typeof credentials.beginOperation !== 'function') {
      throw new TypeError('device credentials are required');
    }
    if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');

    async function operationCurrent(operation) {
      return typeof credentials.isOperationCurrent === 'function'
        && Boolean(await credentials.isOperationCurrent(operation));
    }

    return {
      async get(pathValue, requestOptions) {
        return send('GET', pathValue, null, requestOptions || null, 'none');
      },
      async post(pathValue, bodyValue, commandOptions) {
        return send('POST', pathValue, bodyValue, commandOptions || null, 'json');
      },
      async postBytes(pathValue, blobValue, commandOptions) {
        return send('POST', pathValue, blobValue, commandOptions || null, 'byok-bytes');
      },
      async postMultipart(pathValue, formValue, commandOptions) {
        return send('POST', pathValue, formValue, commandOptions || null, 'byok-multipart');
      },
      async postRaw(pathValue, bodyValue, commandOptions) {
        return send('POST', pathValue, bodyValue, commandOptions || null, 'hosted-preview');
      },
    };

    async function send(method, pathValue, bodyValue, commandOptions, bodyMode) {
        var path = requestPath(pathValue, method);
        var configuredRequiredScopes = commandOptions && commandOptions.requiredScopes;
        if (configuredRequiredScopes != null
          && (!Array.isArray(configuredRequiredScopes)
            || configuredRequiredScopes.length === 0
            || configuredRequiredScopes.some(function (scope) {
              return ![
                'listing:review',
                'listing:write',
                'listing:publish',
                'media:execute',
                'byok:media:ingest',
                'capture:write',
              ].includes(scope);
            }))) {
          throw new TypeError('source workbench required scopes are invalid');
        }
        var browserOneClickJobWriteRequest = browserOneClickJobWritePath(path);
        var publishRequest = Boolean(
          commandOptions
          && (commandOptions.requiredScope === 'listing:publish'
            || configuredRequiredScopes && configuredRequiredScopes.includes('listing:publish'))
          && (PUBLISH_REQUEST_PATHS.has(path) || browserOneClickJobWriteRequest),
        );
        var requestBody = null;
        var binaryRequest = null;
        if (bodyMode === 'byok-bytes') {
          binaryRequest = byokBinaryRequest(bodyValue, commandOptions, path);
          requestBody = binaryRequest.body;
        } else if (bodyMode === 'byok-multipart') {
          binaryRequest = byokBatchMultipartRequest(bodyValue, commandOptions, path);
          requestBody = binaryRequest.body;
        } else if (method === 'POST') {
          if (bodyMode === 'hosted-preview'
            && path !== HOSTED_PREVIEW_CONSUME_PATH
            && path !== SOURCE_MEDIA_PREVIEW_PATH) {
            throw new TypeError('hosted preview response path is invalid');
          }
          if (!bodyValue || typeof bodyValue !== 'object' || Array.isArray(bodyValue)) {
            throw new TypeError('source workbench command body is invalid');
          }
          requestBody = JSON.stringify(bodyValue);
          var shopAnalyticsRequest = /^\/api\/extension-device\/shops\/[^/]+\/analytics(?:-graphs)?$/u
            .test(path);
          var maximumRequestBytes = path === MEDIA_EDIT_MASK_PATH
            ? MAX_MEDIA_EDIT_MASK_REQUEST_BYTES
            : shopAnalyticsRequest
              ? MAX_SHOP_ANALYTICS_REQUEST_BYTES
            : publishRequest
              && (LARGE_PUBLISH_REQUEST_PATHS.has(path) || browserOneClickJobWriteRequest)
              ? MAX_PUBLISH_REQUEST_BYTES : MAX_COMMAND_REQUEST_BYTES;
          if (byteLength(requestBody) > maximumRequestBytes) {
            throw new Error('source workbench command is too large');
          }
        }
        var controller = new AbortController();
        var externalSignal = bodyMode === 'hosted-preview'
          ? commandOptions && commandOptions.signal
          : null;
        var externallyAborted = false;
        var abortFromExternal = null;
        if (externalSignal !== null && externalSignal !== undefined) {
          if (typeof externalSignal !== 'object'
            || typeof externalSignal.aborted !== 'boolean'
            || typeof externalSignal.addEventListener !== 'function'
            || typeof externalSignal.removeEventListener !== 'function') {
            throw new TypeError('hosted preview abort signal is invalid');
          }
          abortFromExternal = function () {
            externallyAborted = true;
            controller.abort();
          };
          if (externalSignal.aborted) abortFromExternal();
          else externalSignal.addEventListener('abort', abortFromExternal, { once: true });
        }
        var timeoutId;
        var timeoutMs = MEDIA_EDIT_LONG_REQUEST_PATHS.has(path)
          ? maskRequestTimeoutMs
          : publishRequest ? publishRequestTimeoutMs : requestTimeoutMs;
        var requestDispatched = false;
        var timeout = new Promise(function (_resolve, reject) {
          timeoutId = setTimeout(function () {
            controller.abort();
            reject(new Error('source workbench request timed out'));
          }, timeoutMs);
        });
        var request = (async function () {
          var operation = await credentials.beginOperation();
          if (!operation || operation.state !== 'paired') return { state: 'unpaired' };
          var requestedScope = commandOptions && commandOptions.requiredScope;
          var scopeExemptRequest = path === BROWSER_ONE_CLICK_STATUS_PATH;
          var requiredScope = scopeExemptRequest
            ? null
            : bodyMode === 'byok-bytes' || bodyMode === 'byok-multipart'
            ? 'byok:media:ingest'
            : requestedScope === 'listing:review'
            || requestedScope === 'listing:write'
            || requestedScope === 'listing:publish'
            || requestedScope === 'media:execute'
            || requestedScope === 'byok:media:ingest'
            || requestedScope === 'capture:write'
            ? requestedScope
            : method === 'GET' ? 'listing:review' : 'media:execute';
          var requiredScopes = scopeExemptRequest
            ? []
            : configuredRequiredScopes || (requiredScope ? [requiredScope] : []);
          var missingScope = requiredScopes.find(function (scope) {
            return !Array.isArray(operation.scopes) || !operation.scopes.includes(scope);
          });
          if (missingScope) {
            return { state: 'scope_required', scope: missingScope };
          }
          var accessToken = requiredText(operation.accessToken, 'device access token');
          var baseUrl = requiredText(operation.baseUrl, 'baseUrl').replace(/\/+$/, '');
          var headers = {
            Accept: bodyMode === 'hosted-preview'
              ? path === SOURCE_MEDIA_PREVIEW_PATH
                ? 'image/png, image/jpeg'
                : 'image/png'
              : 'application/json',
            Authorization: 'Bearer ' + accessToken,
          };
          if (method === 'POST') {
            if (!binaryRequest) headers['Content-Type'] = 'application/json';
            else if (binaryRequest.contentType) headers['Content-Type'] = binaryRequest.contentType;
            var commandGrant = binaryRequest
              ? binaryRequest.commandGrant
              : String(commandOptions && commandOptions.commandGrant || '').trim();
            if (commandGrant) headers['X-SS-ERP-Command-Grant'] = commandGrant;
            if (binaryRequest && binaryRequest.manifest) {
              headers['X-SS-ERP-BYOK-Ingest-Manifest'] = binaryRequest.manifest;
            }
          }
          requestDispatched = true;
          var response = await fetchImpl(baseUrl + path, {
            method: method,
            headers: {
              ...headers,
            },
            ...(requestBody == null ? {} : { body: requestBody }),
            credentials: 'omit',
            cache: 'no-store',
            redirect: 'error',
            signal: controller.signal,
          });
          if (!await operationCurrent(operation)) {
            throw new Error('device credential operation superseded');
          }
          var maximumResponseBytes = path === BYOK_PUBLISH_PREVIEW_PATH
            || path === WORKBENCH_PUBLISH_PREVIEW_PATH
            || browserOneClickJobWriteRequest
            ? MAX_PUBLISH_RESPONSE_BYTES
            : bodyMode === 'hosted-preview'
              ? MAX_HOSTED_PREVIEW_RESPONSE_BYTES
              : MAX_RESPONSE_BYTES;
          var authorizationErrorBody = null;
          if (!response.ok && [401, 404, 410].includes(response.status)) {
            try {
              authorizationErrorBody = await readJsonResponse(
                response,
                maximumResponseBytes,
              );
            } catch {}
          }
          if ((response.status === 401 || response.status === 410) && binaryRequest) {
            var grantErrorBody = authorizationErrorBody;
            if (grantErrorBody && [
              'byok_ingest_grant_required',
              'byok_ingest_grant_expired',
              'byok_ingest_grant_revoked',
            ].includes(grantErrorBody.errorCode)) {
              return { state: 'http_error', status: response.status, body: grantErrorBody };
            }
          }
          if ((response.status === 401 || response.status === 404 || response.status === 410)
            && path === OZON_PUBLISH_EXECUTE_PATH) {
            var publishGrantErrorBody = authorizationErrorBody;
            var publishGrantErrorCode = String(
              publishGrantErrorBody && publishGrantErrorBody.errorCode || '',
            );
            if (publishGrantErrorBody
              && (publishGrantErrorCode === 'command_grant_required'
                || [
                  'COMMAND_GRANT_NOT_FOUND',
                  'COMMAND_GRANT_EXPIRED',
                  'COMMAND_GRANT_REVOKED',
                ].includes(publishGrantErrorCode.toUpperCase()))) {
              return {
                state: 'http_error',
                status: response.status,
                body: publishGrantErrorBody,
              };
            }
          }
          if (deviceAuthorizationRejected(response.status, authorizationErrorBody)) {
            if (typeof credentials.clearIfCurrent === 'function') {
              var cleared = await credentials.clearIfCurrent(operation, {
                status: response.status,
                reason: 'source_workbench_authorization_revoked',
              });
              if (!cleared) throw new Error('device credential operation superseded');
            }
            return { state: 'authorization_required', status: response.status };
          }
          if (response.status === 403 && !binaryRequest && requiredScopes.length) {
            return { state: 'scope_required', scope: missingScope || requiredScopes[0] };
          }
          if (method === 'GET' && response.status === 404) return { state: 'not_found' };
          if (!response.ok) {
            var errorBody = authorizationErrorBody;
            if (errorBody === null) {
              try { errorBody = await readJsonResponse(response, maximumResponseBytes); } catch {}
            }
            return { state: 'http_error', status: response.status, body: errorBody };
          }
          if (bodyMode === 'hosted-preview') {
            var previewBytes = await readBinaryResponse(
              response,
              MAX_HOSTED_PREVIEW_RESPONSE_BYTES,
            );
            if (!await operationCurrent(operation)) {
              throw new Error('device credential operation superseded');
            }
            var immutableBytes = previewBytes.slice();
            return {
              state: 'raw_response',
              status: response.status,
              response: Object.freeze({
                ok: true,
                status: response.status,
                headers: response.headers,
                arrayBuffer: async function () {
                  return immutableBytes.buffer.slice(
                    immutableBytes.byteOffset,
                    immutableBytes.byteOffset + immutableBytes.byteLength,
                  );
                },
              }),
            };
          }
          var responseBody = await readJsonResponse(response, maximumResponseBytes);
          if (!await operationCurrent(operation)) {
            throw new Error('device credential operation superseded');
          }
          return { state: 'response', status: response.status, body: responseBody };
        })();
        try {
          return await Promise.race([request, timeout]);
        } catch (error) {
          if (controller.signal.aborted) {
            throw requestFailure(
              externallyAborted
                ? 'source workbench request aborted'
                : 'source workbench request timed out',
              requestDispatched,
            );
          }
          throw requestFailure(
            error && typeof error.message === 'string'
              ? error.message : 'source workbench request failed',
            requestDispatched,
          );
        } finally {
          clearTimeout(timeoutId);
          if (externalSignal && abortFromExternal) {
            try { externalSignal.removeEventListener('abort', abortFromExternal); } catch {}
          }
        }
    }
  }

  global.SS_ERP_SOURCE_WORKFLOW_DEVICE_SESSION = {
    createTransport: createTransport,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
