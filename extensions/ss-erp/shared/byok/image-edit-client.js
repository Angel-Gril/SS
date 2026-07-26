(function exposeByokImageEditClient(global) {
  'use strict';

  var schema = global.SS_ERP_BYOK_PROFILE_SCHEMA;
  var defaultInspector = global.SS_ERP_BYOK_IMAGE_INPUT_INSPECTOR;
  var adaptersApi = global.SS_ERP_BYOK_IMAGE_EDIT_ADAPTERS;
  if (!schema) throw new Error('SS_ERP_BYOK_PROFILE_SCHEMA is required');
  if (!defaultInspector) throw new Error('SS_ERP_BYOK_IMAGE_INPUT_INSPECTOR is required');
  if (!adaptersApi) throw new Error('SS_ERP_BYOK_IMAGE_EDIT_ADAPTERS is required');

  var CONTRACT_VERSION = 'extension-byok-image-edit/v1';
  var READINESS_BINDING_VERSION = 'extension-byok-readiness-binding/v2';
  var EDIT_OPERATIONS = Object.freeze(['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT']);
  var INTERNAL_MASK_SEMANTICS = 'WHITE_EDIT_BLACK_PRESERVE_V1';
  var MAX_PROMPT_CHARACTERS = 8000;
  var MAX_NEGATIVE_PROMPT_CHARACTERS = 4000;
  var MAX_RESULT_BYTES = 20 * 1024 * 1024;
  var MAX_JSON_BYTES = 32 * 1024 * 1024;
  var MAX_DIMENSION = 4096;
  var MAX_PIXELS = MAX_DIMENSION * MAX_DIMENSION;
  var MAX_RESULT_URL_CHARACTERS = 8192;
  var MAX_OPERATION_COUNT = 100;
  var DEFAULT_TIMEOUT_MS = 120000;
  var DEFAULT_POLL_INTERVAL_MS = 1000;
  var CAPABILITY_EVIDENCE_TTL_MS = 24 * 60 * 60 * 1000;
  var READINESS_KEYS = [
    'contractVersion', 'ownerUserId', 'deviceSessionId', 'shopId', 'workflowId',
    'draftRevision', 'draftVersion', 'sourcePlatform', 'sourceProductId',
    'sourceCaptureSnapshotId', 'supplyGoodsId', 'skuKey', 'slotKey',
    'assignmentMode', 'assignmentOrdinal', 'providerOrigin', 'model', 'operation',
    'policyRevision',
  ];

  function clientError(code, message, outcome, details) {
    var error = new Error(message || code);
    error.name = 'ExtensionByokImageEditError';
    error.code = code;
    if (outcome) error.outcome = outcome;
    if (details && typeof details === 'object') {
      Object.keys(details).forEach(function (key) { error[key] = details[key]; });
    }
    return error;
  }

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
  }

  function assertClosedRecord(value, allowedKeys) {
    if (!isRecord(value)) throw clientError(
      'SS_ERP_BYOK_IMAGE_EDIT_INPUT_INVALID',
      'BYOK image edit input is invalid',
      'FAILED_RETRYABLE',
    );
    var allowed = new Set(allowedKeys);
    if (Object.keys(value).some(function (key) { return !allowed.has(key); })) {
      throw clientError(
        'SS_ERP_BYOK_IMAGE_EDIT_INPUT_INVALID',
        'BYOK image edit input contains an unknown field',
        'FAILED_RETRYABLE',
      );
    }
  }

  function normalizedId(value, label) {
    if (typeof value !== 'string') throw clientError(
      'SS_ERP_BYOK_IMAGE_EDIT_INPUT_INVALID', label + ' is invalid', 'FAILED_RETRYABLE',
    );
    var result = value.normalize('NFKC').trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/u.test(result)) throw clientError(
      'SS_ERP_BYOK_IMAGE_EDIT_INPUT_INVALID', label + ' is invalid', 'FAILED_RETRYABLE',
    );
    return result;
  }

  function promptText(value, maximum, label, nullable) {
    if (nullable && value == null) return null;
    if (typeof value !== 'string' || value !== value.normalize('NFKC').trim()
      || (!nullable && !value) || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) {
      throw clientError(
        'SS_ERP_BYOK_IMAGE_EDIT_INPUT_INVALID', label + ' is invalid', 'FAILED_RETRYABLE',
      );
    }
    return value || null;
  }

  function normalizedSize(value) {
    if (typeof value !== 'string' || !/^\d{1,4}x\d{1,4}$/u.test(value)) throw clientError(
      'SS_ERP_BYOK_IMAGE_EDIT_INPUT_INVALID', 'size is invalid', 'FAILED_RETRYABLE',
    );
    var dimensions = value.split('x').map(Number);
    if (dimensions.some(function (item) {
      return !Number.isSafeInteger(item) || item < 1 || item > MAX_DIMENSION;
    }) || dimensions[0] * dimensions[1] > MAX_PIXELS) throw clientError(
      'SS_ERP_BYOK_IMAGE_EDIT_INPUT_INVALID', 'size is invalid', 'FAILED_RETRYABLE',
    );
    return value;
  }

  function normalizeInput(value) {
    assertClosedRecord(value, [
      'profileId', 'operation', 'prompt', 'negativePrompt', 'size', 'idempotencyKey',
      'readinessBinding', 'images', 'mask',
    ]);
    var operation = value.operation;
    if (!EDIT_OPERATIONS.includes(operation)) throw clientError(
      'SS_ERP_BYOK_IMAGE_EDIT_INPUT_INVALID', 'operation is invalid', 'FAILED_RETRYABLE',
    );
    if (!Array.isArray(value.images)
      || (operation === 'IMAGE_TO_IMAGE' && (value.images.length < 1 || value.images.length > 4))
      || (operation !== 'IMAGE_TO_IMAGE' && value.images.length !== 1)
      || value.images.some(function (blob) { return !(blob instanceof Blob); })) {
      throw clientError(
        'SS_ERP_BYOK_IMAGE_EDIT_INPUT_INVALID', 'source images are invalid', 'FAILED_RETRYABLE',
      );
    }
    var mask = value.mask;
    if (operation === 'INPAINT') {
      assertClosedRecord(mask, ['blob', 'maskSemantics']);
      if (!(mask.blob instanceof Blob) || mask.maskSemantics !== INTERNAL_MASK_SEMANTICS) {
        throw clientError(
          'SS_ERP_BYOK_IMAGE_EDIT_INPUT_INVALID', 'inpaint mask is invalid', 'FAILED_RETRYABLE',
        );
      }
    } else if (mask !== null) {
      throw clientError(
        'SS_ERP_BYOK_IMAGE_EDIT_INPUT_INVALID', 'mask is invalid for this operation', 'FAILED_RETRYABLE',
      );
    }
    return {
      profileId: normalizedId(value.profileId, 'profileId'),
      operation: operation,
      prompt: promptText(value.prompt, MAX_PROMPT_CHARACTERS, 'prompt', false),
      negativePrompt: promptText(
        value.negativePrompt, MAX_NEGATIVE_PROMPT_CHARACTERS, 'negativePrompt', true,
      ),
      size: normalizedSize(value.size),
      idempotencyKey: normalizedId(value.idempotencyKey, 'idempotencyKey'),
      readinessBinding: value.readinessBinding,
      images: value.images.slice(),
      mask: mask,
    };
  }

  function nullableText(value, maximum) {
    if (value === null) return null;
    if (typeof value !== 'string' || !value || value !== value.normalize('NFKC').trim()
      || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) {
      throw new Error('invalid nullable text');
    }
    return value;
  }

  function nullablePositiveInteger(value) {
    if (value === null) return null;
    if (!Number.isSafeInteger(value) || value < 1) throw new Error('invalid nullable integer');
    return value;
  }

  function normalizedReadiness(value, permissionBroker, requireDraftContext) {
    try {
      if (!isRecord(value) || Object.keys(value).length !== READINESS_KEYS.length
        || READINESS_KEYS.some(function (key) { return !hasOwn(value, key); })
        || value.contractVersion !== READINESS_BINDING_VERSION) throw new Error('invalid readiness');
      var result = {
        contractVersion: READINESS_BINDING_VERSION,
        ownerUserId: normalizedId(value.ownerUserId, 'ownerUserId'),
        deviceSessionId: normalizedId(value.deviceSessionId, 'deviceSessionId'),
        shopId: normalizedId(value.shopId, 'shopId'),
        workflowId: nullableText(value.workflowId, 200),
        draftRevision: nullablePositiveInteger(value.draftRevision),
        draftVersion: nullablePositiveInteger(value.draftVersion),
        sourcePlatform: nullableText(value.sourcePlatform, 50),
        sourceProductId: nullableText(value.sourceProductId, 200),
        sourceCaptureSnapshotId: nullableText(value.sourceCaptureSnapshotId, 200),
        supplyGoodsId: nullableText(value.supplyGoodsId, 200),
        skuKey: nullableText(value.skuKey, 500),
        slotKey: nullableText(value.slotKey, 200),
        assignmentMode: nullableText(value.assignmentMode, 50),
        assignmentOrdinal: value.assignmentOrdinal === null
          ? null
          : Number.isSafeInteger(value.assignmentOrdinal) && value.assignmentOrdinal >= 0
            ? value.assignmentOrdinal
            : (function invalidOrdinal() { throw new Error('invalid ordinal'); }()),
        providerOrigin: permissionBroker.canonicalizeOrigin(value.providerOrigin),
        model: nullableText(value.model, 200),
        operation: value.operation,
        policyRevision: normalizedId(value.policyRevision, 'policyRevision'),
      };
      var draftValues = [
        result.workflowId, result.draftRevision, result.draftVersion, result.sourcePlatform,
        result.sourceProductId, result.sourceCaptureSnapshotId, result.supplyGoodsId,
        result.skuKey, result.slotKey, result.assignmentMode, result.assignmentOrdinal,
      ];
      if ((requireDraftContext && draftValues.some(function (item) { return item === null; }))
        || (!requireDraftContext && draftValues.some(function (item) { return item !== null; })
          && draftValues.some(function (item) { return item === null; }))) {
        throw new Error('invalid draft context');
      }
      return result;
    } catch (error) {
      if (error && error.name === 'ExtensionByokImageEditError') throw error;
      throw clientError(
        'SS_ERP_BYOK_IMAGE_EDIT_READINESS_INVALID',
        'Authenticated BYOK edit readiness is invalid',
        'FAILED_RETRYABLE',
      );
    }
  }

  function editEndpoint(baseUrl, permissionBroker) {
    var base;
    try {
      base = schema.canonicalizeEndpoint(baseUrl);
    } catch {
      throw clientError(
        'SS_ERP_BYOK_IMAGE_EDIT_ENDPOINT_INVALID', 'Provider endpoint is invalid', 'FAILED_RETRYABLE',
      );
    }
    var parsed = new URL(base);
    if (/\/images\/(?:generations|edits|tasks)(?:\/|$)/iu.test(parsed.pathname)) throw clientError(
      'SS_ERP_BYOK_IMAGE_EDIT_ENDPOINT_INVALID',
      'Provider profile must contain an API base',
      'FAILED_RETRYABLE',
    );
    var providerOrigin;
    try {
      providerOrigin = permissionBroker.canonicalizeOrigin(base);
    } catch {
      throw clientError(
        'SS_ERP_BYOK_IMAGE_EDIT_ENDPOINT_INVALID', 'Provider origin is invalid', 'FAILED_RETRYABLE',
      );
    }
    return { apiBaseUrl: base, providerOrigin: providerOrigin };
  }

  function utf8Bytes(value) {
    return new TextEncoder().encode(value);
  }

  function hex(buffer) {
    return Array.from(new Uint8Array(buffer)).map(function (value) {
      return value.toString(16).padStart(2, '0');
    }).join('');
  }

  async function sha256Bytes(cryptoImpl, value) {
    var bytes = typeof value === 'string' ? utf8Bytes(value) : value;
    var buffer = bytes instanceof Uint8Array
      ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      : bytes;
    return hex(await cryptoImpl.subtle.digest('SHA-256', buffer));
  }

  async function sha256Blob(cryptoImpl, blob) {
    return sha256Bytes(cryptoImpl, await blob.arrayBuffer());
  }

  function safeSha256(value) {
    return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value) ? value : null;
  }

  function safeProviderId(value) {
    if (typeof value !== 'string') return null;
    var normalized = value.trim();
    return /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/u.test(normalized) ? normalized : null;
  }

  function providerRequestId(response, body) {
    var bodyId = safeProviderId(body && body.id);
    if (bodyId) return bodyId;
    if (!response || !response.headers || typeof response.headers.get !== 'function') return null;
    return safeProviderId(
      response.headers.get('x-request-id')
        || response.headers.get('request-id')
        || response.headers.get('openai-request-id'),
    );
  }

  function contentLength(response) {
    var value = response && response.headers && response.headers.get('content-length');
    if (value == null || value === '') return null;
    var parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  function cancelResponse(response) {
    try {
      if (response && response.body && typeof response.body.cancel === 'function') {
        var cancelled = response.body.cancel();
        if (cancelled && typeof cancelled.catch === 'function') cancelled.catch(function () {});
      }
    } catch {}
  }

  function remainingTime(deadline) {
    return Math.max(0, deadline - Date.now());
  }

  async function withDeadline(value, deadline, onTimeout) {
    var remaining = remainingTime(deadline);
    if (remaining <= 0) {
      if (onTimeout) onTimeout();
      throw clientError('SS_ERP_BYOK_IMAGE_EDIT_FETCH_TIMEOUT', 'Provider request timed out');
    }
    var timeoutId;
    var timeout = new Promise(function (_resolve, reject) {
      timeoutId = setTimeout(function () {
        if (onTimeout) onTimeout();
        reject(clientError('SS_ERP_BYOK_IMAGE_EDIT_FETCH_TIMEOUT', 'Provider request timed out'));
      }, remaining);
    });
    try {
      return await Promise.race([value, timeout]);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function readBodyWithLimit(response, maximum, deadline) {
    var declared = contentLength(response);
    if (declared !== null && declared > maximum) {
      cancelResponse(response);
      throw clientError(
        'SS_ERP_BYOK_IMAGE_EDIT_RESPONSE_TOO_LARGE', 'Provider response is too large',
      );
    }
    if (!response || !response.body || typeof response.body.getReader !== 'function') {
      var fallback = new Uint8Array(await withDeadline(response.arrayBuffer(), deadline));
      if (fallback.byteLength > maximum) throw clientError(
        'SS_ERP_BYOK_IMAGE_EDIT_RESPONSE_TOO_LARGE', 'Provider response is too large',
      );
      return fallback;
    }
    var reader = response.body.getReader();
    var chunks = [];
    var total = 0;
    try {
      while (true) {
        var next = await withDeadline(reader.read(), deadline, function () {
          try { reader.cancel(); } catch {}
        });
        if (next.done) break;
        var chunk = next.value instanceof Uint8Array ? next.value : new Uint8Array(next.value);
        total += chunk.byteLength;
        if (total > maximum) {
          try { await reader.cancel(); } catch {}
          throw clientError(
            'SS_ERP_BYOK_IMAGE_EDIT_RESPONSE_TOO_LARGE', 'Provider response is too large',
          );
        }
        chunks.push(chunk);
      }
    } finally {
      if (typeof reader.releaseLock === 'function') reader.releaseLock();
    }
    var result = new Uint8Array(total);
    var offset = 0;
    chunks.forEach(function (chunk) { result.set(chunk, offset); offset += chunk.byteLength; });
    return result;
  }

  async function readJson(response, deadline) {
    var bytes = await readBodyWithLimit(response, MAX_JSON_BYTES, deadline);
    var text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw clientError('SS_ERP_BYOK_IMAGE_EDIT_RESPONSE_INVALID', 'Provider returned invalid UTF-8');
    }
    try {
      var value = JSON.parse(text);
      if (!isRecord(value)) throw new Error('invalid JSON body');
      return value;
    } catch {
      throw clientError('SS_ERP_BYOK_IMAGE_EDIT_RESPONSE_INVALID', 'Provider returned invalid JSON');
    }
  }

  async function fetchWithDeadline(fetchImpl, url, init, deadline) {
    var controller = new AbortController();
    try {
      return await withDeadline(fetchImpl(url, { ...init, signal: controller.signal }), deadline, function () {
        controller.abort();
      });
    } catch (error) {
      if (controller.signal.aborted || (error && error.name === 'AbortError')) throw clientError(
        'SS_ERP_BYOK_IMAGE_EDIT_FETCH_TIMEOUT', 'Provider request timed out',
      );
      if (error && /^SS_ERP_BYOK_IMAGE_EDIT_/u.test(String(error.code || ''))) throw error;
      throw clientError('SS_ERP_BYOK_IMAGE_EDIT_FETCH_FAILED', 'Provider request failed');
    }
  }

  function base64Bytes(value) {
    if (typeof value !== 'string' || !value || value.length % 4 !== 0
      || value.length > Math.ceil(MAX_RESULT_BYTES / 3) * 4 + 4
      || !/^[a-zA-Z0-9+/]*={0,2}$/u.test(value)) throw clientError(
      'SS_ERP_BYOK_IMAGE_EDIT_RESULT_INVALID', 'Provider returned invalid image data',
    );
    var binary;
    try { binary = global.atob(value); } catch {
      throw clientError('SS_ERP_BYOK_IMAGE_EDIT_RESULT_INVALID', 'Provider returned invalid image data');
    }
    if (!binary.length || binary.length > MAX_RESULT_BYTES) throw clientError(
      'SS_ERP_BYOK_IMAGE_EDIT_RESPONSE_TOO_LARGE', 'Provider image result is too large',
    );
    var bytes = new Uint8Array(binary.length);
    for (var index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function detectedImageMime(bytes) {
    if (bytes.byteLength >= 8
      && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
      && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
      return 'image/png';
    }
    if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return 'image/jpeg';
    }
    if (bytes.byteLength >= 12
      && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
      && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
      return 'image/webp';
    }
    throw clientError('SS_ERP_BYOK_IMAGE_EDIT_RESULT_INVALID', 'Provider result is not an image');
  }

  function declaredImageMime(response, detected) {
    var raw = response && response.headers && response.headers.get('content-type');
    if (!raw) return detected;
    var declared = String(raw).split(';')[0].trim().toLowerCase();
    if (declared === 'image/jpg') declared = 'image/jpeg';
    if (declared !== detected) throw clientError(
      'SS_ERP_BYOK_IMAGE_EDIT_RESULT_INVALID', 'Provider result MIME does not match its bytes',
    );
    return detected;
  }

  function parseResultUrl(value, permissionBroker) {
    if (typeof value !== 'string' || !value || value.length > MAX_RESULT_URL_CHARACTERS
      || value.includes('\\')) throw clientError(
      'SS_ERP_BYOK_IMAGE_EDIT_RESULT_URL_INVALID', 'Provider result URL is invalid',
    );
    var parsed;
    try { parsed = new URL(value); } catch {
      throw clientError('SS_ERP_BYOK_IMAGE_EDIT_RESULT_URL_INVALID', 'Provider result URL is invalid');
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) throw clientError(
      'SS_ERP_BYOK_IMAGE_EDIT_RESULT_URL_INVALID', 'Provider result URL is invalid',
    );
    var origin;
    try { origin = permissionBroker.canonicalizeOrigin(parsed.origin); } catch {
      throw clientError('SS_ERP_BYOK_IMAGE_EDIT_RESULT_URL_INVALID', 'Provider result origin is invalid');
    }
    return { url: parsed.toString(), origin: origin };
  }

  function unknownOutcome(error, providerRequestIdSha256, providerTaskIdSha256) {
    return clientError(
      'SS_ERP_BYOK_IMAGE_EDIT_UNKNOWN_OUTCOME',
      'Provider may have accepted the edit; automatic retry is disabled',
      'UNKNOWN_OUTCOME',
      {
        automaticRetryAllowed: false,
        providerRequestIdSha256: safeSha256(providerRequestIdSha256),
        providerTaskIdSha256: safeSha256(providerTaskIdSha256),
        causeCode: String(error && error.code || 'SS_ERP_BYOK_IMAGE_EDIT_RESULT_UNAVAILABLE').slice(0, 100),
      },
    );
  }

  function snapshotError(error) {
    return {
      code: String(error && error.code || 'SS_ERP_BYOK_IMAGE_EDIT_FAILED'),
      message: String(error && error.message || 'BYOK image edit failed').slice(0, 500),
      outcome: String(error && error.outcome || 'UNKNOWN_OUTCOME'),
      automaticRetryAllowed: error && error.automaticRetryAllowed === false ? false : undefined,
      providerRequestIdSha256: safeSha256(error && error.providerRequestIdSha256),
      providerTaskIdSha256: safeSha256(error && error.providerTaskIdSha256),
      status: Number.isSafeInteger(error && error.status) ? error.status : undefined,
      causeCode: error && typeof error.causeCode === 'string' ? error.causeCode.slice(0, 100) : undefined,
    };
  }

  function replayError(snapshot, replayed) {
    return clientError(snapshot.code, snapshot.message, snapshot.outcome, {
      replayed: Boolean(replayed),
      automaticRetryAllowed: snapshot.automaticRetryAllowed,
      providerRequestIdSha256: snapshot.providerRequestIdSha256 || null,
      providerTaskIdSha256: snapshot.providerTaskIdSha256 || null,
      status: snapshot.status,
      causeCode: snapshot.causeCode,
    });
  }

  function resultAuthorityStale(error, providerRequestIdSha256, providerTaskIdSha256) {
    return clientError(
      'SS_ERP_BYOK_IMAGE_EDIT_RESULT_AUTHORITY_STALE',
      'Provider result authority changed before acceptance',
      'FAILED_FINAL',
      {
        automaticRetryAllowed: false,
        providerRequestIdSha256: safeSha256(providerRequestIdSha256),
        providerTaskIdSha256: safeSha256(providerTaskIdSha256),
        causeCode: String(error && error.code || '').slice(0, 100),
      },
    );
  }

  function createClient(options) {
    var profileStore = options && options.profileStore;
    var permissionBroker = options && options.permissionBroker;
    var inspector = options && options.imageInputInspector || defaultInspector;
    var maskTransformer = options && options.maskTransformer;
    var selectedAdapter = options && options.adapter || adaptersApi.OPENAI_MULTIPART_SYNC;
    var adapter;
    try {
      adapter = adaptersApi.resolveAdapter(
        typeof selectedAdapter === 'string' ? selectedAdapter : selectedAdapter && selectedAdapter.id,
      );
    } catch {
      adapter = null;
    }
    var fetchImpl = options && options.fetchImpl;
    var authorizeResultOrigin = options && options.authorizeResultOrigin;
    var decodeImage = options && options.decodeImage;
    var probeMediaFactory = options && options.probeMediaFactory;
    var cryptoImpl = options && options.crypto || global.crypto;
    var now = options && typeof options.now === 'function' ? options.now : function () { return new Date(); };
    var timeoutValue = Number(options && options.timeoutMs);
    var timeoutMs = Number.isFinite(timeoutValue) && timeoutValue > 0
      ? Math.min(timeoutValue, DEFAULT_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
    var pollValue = Number(options && options.pollIntervalMs);
    var pollIntervalMs = Number.isFinite(pollValue) && pollValue >= 0
      ? Math.min(pollValue, 5000) : DEFAULT_POLL_INTERVAL_MS;
    if (!profileStore || [
      'getProfile', 'getCredentialSnapshotForBackground',
      'assertCredentialRevisionForBackground', 'commitWithCredentialRevisionForBackground',
      'beginProviderDispatch', 'setCapabilityEvidence', 'beginCapabilityProbe',
      'markCapabilityProbeUncertain', 'discardPendingCapabilityProbe',
    ].some(function (method) { return typeof profileStore[method] !== 'function'; })) {
      throw new TypeError('BYOK background profile store is required');
    }
    if (!permissionBroker || typeof permissionBroker.canonicalizeOrigin !== 'function'
      || typeof permissionBroker.hasOriginPermission !== 'function'
      || typeof permissionBroker.commitWithOriginPermission !== 'function') {
      throw new TypeError('BYOK exact-origin permission broker is required');
    }
    if (!inspector || typeof inspector.inspectImageBlob !== 'function'
      || typeof inspector.assertSameDimensions !== 'function') {
      throw new TypeError('BYOK image input inspector is required');
    }
    if (!adapter || !adaptersApi.ADAPTER_IDS.includes(adapter.id)) {
      throw new TypeError('BYOK image edit adapter is required');
    }
    if (!maskTransformer || typeof maskTransformer.toOpenAiMask !== 'function') {
      throw new TypeError('BYOK image mask transformer is required');
    }
    if (probeMediaFactory !== undefined
      && (!probeMediaFactory || typeof probeMediaFactory.create !== 'function')) {
      throw new TypeError('BYOK image edit probe media factory is invalid');
    }
    if (adapter.requestMode === 'async'
      && typeof profileStore.recordAcceptedProviderTask !== 'function') {
      throw new TypeError('BYOK async task persistence is required');
    }
    if (typeof fetchImpl !== 'function') throw new TypeError('background fetchImpl is required');
    if (authorizeResultOrigin !== undefined && typeof authorizeResultOrigin !== 'function') {
      throw new TypeError('authorizeResultOrigin must be a function');
    }
    if (!cryptoImpl || !cryptoImpl.subtle || typeof cryptoImpl.subtle.digest !== 'function') {
      throw new TypeError('Web Crypto is required');
    }

    var operations = new Map();
    var activeOperationKey = null;

    async function inspectBlob(blob, allowedMimeTypes) {
      try {
        return await inspector.inspectImageBlob({
          blob: blob,
          allowedMimeTypes: allowedMimeTypes,
          maxBytes: MAX_RESULT_BYTES,
          maxDimension: MAX_DIMENSION,
          maxPixels: MAX_PIXELS,
          ...(typeof decodeImage === 'function' ? { decodeImage: decodeImage } : {}),
        });
      } catch (error) {
        throw clientError(
          'SS_ERP_BYOK_IMAGE_EDIT_INPUT_INVALID',
          'BYOK image edit media input is invalid',
          'FAILED_RETRYABLE',
          { causeCode: String(error && error.code || '').slice(0, 100) },
        );
      }
    }

    async function prepare(value, requireEvidence) {
      var input = normalizeInput(value);
      var imageInspections = [];
      for (var index = 0; index < input.images.length; index += 1) {
        imageInspections.push(await inspectBlob(
          input.images[index], ['image/png', 'image/jpeg', 'image/webp'],
        ));
      }
      var maskInspection = null;
      var providerMask = null;
      if (input.mask) {
        maskInspection = await inspectBlob(input.mask.blob, ['image/png']);
        try {
          inspector.assertSameDimensions(imageInspections[0], maskInspection);
        } catch {
          throw clientError(
            'SS_ERP_BYOK_IMAGE_EDIT_DIMENSION_MISMATCH',
            'Source and mask dimensions do not match',
            'FAILED_RETRYABLE',
          );
        }
        try {
          providerMask = await maskTransformer.toOpenAiMask({
            blob: input.mask.blob,
            width: maskInspection.width,
            height: maskInspection.height,
            maskSemantics: input.mask.maskSemantics,
          });
        } catch (error) {
          throw clientError(
            'SS_ERP_BYOK_IMAGE_EDIT_INPUT_INVALID',
            'OpenAI mask conversion failed',
            'FAILED_RETRYABLE',
            { causeCode: String(error && error.code || '').slice(0, 100) },
          );
        }
        if (!providerMask || !(providerMask.blob instanceof Blob)
          || providerMask.maskSemantics !== adapter.maskSemantics) throw clientError(
          'SS_ERP_BYOK_IMAGE_EDIT_INPUT_INVALID',
          'OpenAI mask conversion is invalid',
          'FAILED_RETRYABLE',
        );
        var providerMaskInspection = await inspectBlob(providerMask.blob, ['image/png']);
        try { inspector.assertSameDimensions(imageInspections[0], providerMaskInspection); } catch {
          throw clientError(
            'SS_ERP_BYOK_IMAGE_EDIT_DIMENSION_MISMATCH',
            'Converted mask dimensions do not match the source',
            'FAILED_RETRYABLE',
          );
        }
      }

      var storedProfile;
      try { storedProfile = await profileStore.getProfile(input.profileId); } catch {
        throw clientError(
          'SS_ERP_BYOK_IMAGE_EDIT_PROFILE_UNAVAILABLE', 'Provider profile is unavailable', 'FAILED_RETRYABLE',
        );
      }
      if (!storedProfile) throw clientError(
        'SS_ERP_BYOK_IMAGE_EDIT_PROFILE_NOT_FOUND', 'Provider profile is not found', 'FAILED_RETRYABLE',
      );
      var profile;
      try { profile = schema.publicProfile(storedProfile); } catch {
        throw clientError(
          'SS_ERP_BYOK_IMAGE_EDIT_PROFILE_INVALID', 'Provider profile is invalid', 'FAILED_RETRYABLE',
        );
      }
      if (!profile.allowedOperations.includes(input.operation)) throw clientError(
        'SS_ERP_BYOK_IMAGE_EDIT_OPERATION_NOT_ALLOWED',
        'Image edit operation is not enabled for this profile',
        'FAILED_RETRYABLE',
      );
      var endpoint = editEndpoint(profile.baseUrl, permissionBroker);
      var binding = normalizedReadiness(input.readinessBinding, permissionBroker, requireEvidence);
      if (binding.providerOrigin !== endpoint.providerOrigin
        || binding.model !== profile.model || binding.operation !== input.operation) throw clientError(
        'SS_ERP_BYOK_IMAGE_EDIT_READINESS_MISMATCH',
        'Provider profile does not match authenticated ERP readiness',
        'FAILED_RETRYABLE',
      );
      var imageSha256s = [];
      for (var shaIndex = 0; shaIndex < input.images.length; shaIndex += 1) {
        imageSha256s.push(await sha256Blob(cryptoImpl, input.images[shaIndex]));
      }
      var maskSha256 = input.mask ? await sha256Blob(cryptoImpl, input.mask.blob) : null;
      var requestManifest = {
        method: 'POST',
        apiBaseUrl: endpoint.apiBaseUrl,
        adapterId: adapter.id,
        requestMode: adapter.requestMode,
        operation: input.operation,
        model: profile.model,
        prompt: input.prompt,
        negativePrompt: input.negativePrompt,
        size: input.size,
        idempotencyKey: input.idempotencyKey,
        imageSha256s: imageSha256s,
        maskSha256: maskSha256,
      };
      var imageDescriptors = input.images.map(function (blob, descriptorIndex) {
        return {
          blob: blob,
          mimeType: imageInspections[descriptorIndex].mimeType,
          width: imageInspections[descriptorIndex].width,
          height: imageInspections[descriptorIndex].height,
        };
      });
      var maskDescriptor = providerMask ? {
        blob: providerMask.blob,
        mimeType: 'image/png',
        width: imageInspections[0].width,
        height: imageInspections[0].height,
        maskSemantics: providerMask.maskSemantics,
      } : null;
      var submitRequest;
      try {
        submitRequest = adapter.createSubmitRequest({
          apiBaseUrl: endpoint.apiBaseUrl,
          operation: input.operation,
          model: profile.model,
          prompt: input.prompt,
          negativePrompt: input.negativePrompt,
          size: input.size,
          images: imageDescriptors,
          mask: maskDescriptor,
        });
      } catch (error) {
        throw clientError(
          'SS_ERP_BYOK_IMAGE_EDIT_INPUT_INVALID',
          'Provider edit request could not be constructed',
          'FAILED_RETRYABLE',
          { causeCode: String(error && error.code || '').slice(0, 100) },
        );
      }
      return {
        input: input,
        profile: profile,
        binding: binding,
        endpoint: endpoint,
        submitRequest: submitRequest,
        requestHash: await sha256Bytes(cryptoImpl, JSON.stringify(requestManifest)),
        promptHash: await sha256Bytes(cryptoImpl, input.prompt),
        negativePromptHash: input.negativePrompt
          ? await sha256Bytes(cryptoImpl, input.negativePrompt) : null,
        endpointHash: await sha256Bytes(cryptoImpl, submitRequest.endpoint),
        sourceSha256: input.operation === 'IMAGE_TO_IMAGE' ? null : imageSha256s[0],
        referenceSha256s: input.operation === 'IMAGE_TO_IMAGE' ? imageSha256s : [],
        maskSha256: maskSha256,
        requireEvidence: requireEvidence,
      };
    }

    async function assertProviderPermission(prepared) {
      var permission;
      try { permission = await permissionBroker.hasOriginPermission(prepared.endpoint.apiBaseUrl); } catch {
        permission = null;
      }
      if (!permission || permission.granted !== true
        || permission.origin !== prepared.endpoint.providerOrigin) throw clientError(
        'SS_ERP_BYOK_IMAGE_EDIT_PERMISSION_REQUIRED',
        'Exact Provider origin permission is required',
        'FAILED_RETRYABLE',
      );
    }

    async function readCredential(prepared) {
      var snapshot;
      try { snapshot = await profileStore.getCredentialSnapshotForBackground(prepared.input.profileId); } catch {
        snapshot = null;
      }
      var snapshotProfile;
      try { snapshotProfile = snapshot && schema.publicProfile(snapshot.profile); } catch {
        snapshotProfile = null;
      }
      if (!snapshotProfile || schema.profileIdentity(snapshotProfile) !== schema.profileIdentity(prepared.profile)
        || !snapshotProfile.allowedOperations.includes(prepared.input.operation)) throw clientError(
        'SS_ERP_BYOK_IMAGE_EDIT_PROFILE_CHANGED',
        'Provider profile changed before dispatch',
        'FAILED_RETRYABLE',
      );
      if (typeof snapshot.apiKey !== 'string' || !snapshot.apiKey
        || snapshot.apiKey.length > schema.MAX_API_KEY_LENGTH
        || typeof snapshot.credentialRevision !== 'string'
        || !/^[a-f0-9]{64}$/u.test(snapshot.credentialRevision)) throw clientError(
        'SS_ERP_BYOK_IMAGE_EDIT_KEY_REQUIRED', 'A session API key is required', 'FAILED_RETRYABLE',
      );
      if (prepared.requireEvidence) {
        var identity = schema.profileIdentity(snapshotProfile);
        var currentEvidence = Array.isArray(snapshot.evidence) && snapshot.evidence.some(function (candidate) {
          try {
            var normalized = schema.normalizeEvidence(candidate, identity, new Date(now()));
            return normalized.operation === prepared.input.operation
              && normalized.requestMode === adapter.requestMode
              && normalized.policyRevision === prepared.binding.policyRevision;
          } catch { return false; }
        });
        if (!currentEvidence) throw clientError(
          'SS_ERP_BYOK_IMAGE_EDIT_CAPABILITY_UNAVAILABLE',
          'Exact image edit capability evidence is required',
          'FAILED_RETRYABLE',
        );
      }
      return snapshot;
    }

    function dispatchIdentity(prepared) {
      return {
        profileIdentity: schema.profileIdentity(prepared.profile),
        operation: prepared.input.operation,
        requestMode: adapter.requestMode,
        idempotencyKey: prepared.input.idempotencyKey,
        requestHash: prepared.requestHash,
      };
    }

    async function persistDispatch(entry, prepared) {
      try {
        await profileStore.beginProviderDispatch(
          prepared.input.profileId, dispatchIdentity(prepared), entry.credentialRevision,
        );
      } catch (error) {
        var code = String(error && error.code || '');
        if (code === 'SS_ERP_BYOK_PROVIDER_UNKNOWN_OUTCOME') throw unknownOutcome(error, null, null);
        if (code === 'SS_ERP_BYOK_PROVIDER_IDEMPOTENCY_CONFLICT') throw clientError(
          'SS_ERP_BYOK_IMAGE_EDIT_IDEMPOTENCY_CONFLICT',
          'The idempotency key is already bound to a different edit',
          'FAILED_FINAL',
          { automaticRetryAllowed: false },
        );
        throw clientError(
          'SS_ERP_BYOK_IMAGE_EDIT_DISPATCH_GUARD_UNAVAILABLE',
          'Provider dispatch safety state could not be persisted',
          'FAILED_RETRYABLE',
        );
      }
    }

    async function assertResultAuthority(
      entry,
      prepared,
      providerRequestIdSha256,
      providerTaskIdSha256,
    ) {
      try {
        await assertProviderPermission(prepared);
        await profileStore.assertCredentialRevisionForBackground(
          prepared.input.profileId,
          schema.profileIdentity(prepared.profile),
          entry.credentialRevision,
        );
      } catch (error) {
        throw resultAuthorityStale(
          error,
          providerRequestIdSha256,
          providerTaskIdSha256,
        );
      }
    }

    async function authorizeUrl(prepared, parsed, deadline) {
      if (parsed.origin === prepared.endpoint.providerOrigin) return;
      var allowed = false;
      if (typeof authorizeResultOrigin === 'function') {
        try {
          allowed = await withDeadline(authorizeResultOrigin({
            providerOrigin: prepared.endpoint.providerOrigin,
            resultOrigin: parsed.origin,
            policyRevision: prepared.binding.policyRevision,
            operation: prepared.input.operation,
          }), deadline);
        } catch { allowed = false; }
      }
      if (allowed !== true) throw clientError(
        'SS_ERP_BYOK_IMAGE_EDIT_RESULT_ORIGIN_NOT_ALLOWED',
        'Provider result origin is not allowed',
      );
      var permission;
      try { permission = await withDeadline(permissionBroker.hasOriginPermission(parsed.origin), deadline); } catch {
        permission = null;
      }
      if (!permission || permission.granted !== true || permission.origin !== parsed.origin) throw clientError(
        'SS_ERP_BYOK_IMAGE_EDIT_RESULT_PERMISSION_REQUIRED',
        'Exact result origin permission is required',
      );
    }

    async function inspectResultBytes(bytes, mimeType) {
      try {
        var inspection = await inspector.inspectImageBlob({
          blob: new Blob([bytes], { type: mimeType }),
          allowedMimeTypes: [mimeType],
          maxBytes: MAX_RESULT_BYTES,
          maxDimension: MAX_DIMENSION,
          maxPixels: MAX_PIXELS,
          ...(typeof decodeImage === 'function' ? { decodeImage: decodeImage } : {}),
        });
        if (!inspection || inspection.mimeType !== mimeType
          || inspection.byteLength !== bytes.byteLength) throw new Error('invalid inspection');
        return inspection;
      } catch (error) {
        throw clientError(
          'SS_ERP_BYOK_IMAGE_EDIT_RESULT_INVALID',
          'Provider returned invalid image data',
          null,
          { causeCode: String(error && error.code || '').slice(0, 100) },
        );
      }
    }

    async function materializeImage(
      entry,
      prepared,
      normalized,
      deadline,
      providerRequestIdSha256,
      providerTaskIdSha256,
    ) {
      await assertResultAuthority(
        entry,
        prepared,
        providerRequestIdSha256,
        providerTaskIdSha256,
      );
      if (normalized.source === 'b64_json') {
        var base64 = base64Bytes(normalized.b64Json);
        var base64MimeType = detectedImageMime(base64);
        await inspectResultBytes(base64, base64MimeType);
        return {
          bytes: base64,
          mimeType: base64MimeType,
          source: 'b64_json',
          resultOrigin: null,
          resultUrlHash: null,
        };
      }
      var parsed = parseResultUrl(normalized.url, permissionBroker);
      await authorizeUrl(prepared, parsed, deadline);
      var response = await fetchWithDeadline(fetchImpl, parsed.url, {
        method: 'GET',
        headers: { Accept: 'image/png, image/jpeg, image/webp' },
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      }, deadline);
      if (!response || !response.ok) {
        cancelResponse(response);
        throw clientError(
          'SS_ERP_BYOK_IMAGE_EDIT_RESULT_DOWNLOAD_FAILED', 'Provider image download failed',
        );
      }
      var bytes = await readBodyWithLimit(response, MAX_RESULT_BYTES, deadline);
      var mimeType = declaredImageMime(response, detectedImageMime(bytes));
      await inspectResultBytes(bytes, mimeType);
      return {
        bytes: bytes,
        mimeType: mimeType,
        source: 'url',
        resultOrigin: parsed.origin,
        resultUrlHash: await sha256Bytes(cryptoImpl, parsed.url),
      };
    }

    async function requestJsonWithAuth(request, apiKey, idempotencyKey, deadline) {
      var headers = { ...request.headers, Authorization: 'Bearer ' + apiKey };
      if (request.method === 'POST') headers['Idempotency-Key'] = idempotencyKey;
      var response = await fetchWithDeadline(fetchImpl, request.endpoint, {
        method: request.method,
        headers: headers,
        ...(request.body === undefined ? {} : { body: request.body }),
        credentials: request.credentials,
        redirect: request.redirect,
        cache: request.cache,
        referrerPolicy: request.referrerPolicy,
      }, deadline);
      if (!response || !Number.isSafeInteger(Number(response.status))) throw clientError(
        'SS_ERP_BYOK_IMAGE_EDIT_RESPONSE_INVALID', 'Provider response is invalid',
      );
      if (!response.ok) {
        var status = Number(response.status);
        cancelResponse(response);
        throw clientError(
          'SS_ERP_BYOK_IMAGE_EDIT_HTTP_FAILED',
          'Provider request failed with HTTP ' + status,
          status === 408 || status === 409 || status === 425 || status === 429 || status >= 500
            ? 'FAILED_RETRYABLE' : 'FAILED_FINAL',
          { status: status },
        );
      }
      return { response: response, body: await readJson(response, deadline) };
    }

    async function execute(entry, prepared) {
      await assertProviderPermission(prepared);
      var credential = await readCredential(prepared);
      entry.credentialRevision = credential.credentialRevision;
      entry.profileId = prepared.input.profileId;
      entry.profileIdentity = schema.profileIdentity(prepared.profile);
      entry.providerBaseUrl = prepared.endpoint.apiBaseUrl;
      var probeIdentity = {
        ...dispatchIdentity(prepared),
        policyRevision: prepared.binding.policyRevision,
      };
      if (entry.capabilityProbe) {
        entry.capabilityProbeIdentity = probeIdentity;
        var claim = await profileStore.beginCapabilityProbe(
          prepared.input.profileId, probeIdentity, entry.credentialRevision,
        );
        if (claim && claim.replayed === true && claim.evidence) {
          return {
            outcome: 'CAPABILITY_EVIDENCE_REPLAY',
            operation: prepared.input.operation,
            requestMode: adapter.requestMode,
            profileId: prepared.input.profileId,
            policyRevision: prepared.binding.policyRevision,
            idempotencyKey: prepared.input.idempotencyKey,
            requestHash: prepared.requestHash,
            evidence: schema.normalizeEvidence(
              claim.evidence, entry.profileIdentity, new Date(now()),
            ),
          };
        }
        entry.capabilityProbeClaimed = true;
      } else {
        await persistDispatch(entry, prepared);
      }
      var apiKey = credential.apiKey;
      credential = null;
      var deadline = Date.now() + timeoutMs;
      entry.dispatched = true;
      entry.status = 'SUBMITTING';
      var accepted;
      var requestIdHash = null;
      var taskIdHash = null;
      try {
        accepted = await requestJsonWithAuth(
          prepared.submitRequest, apiKey, prepared.input.idempotencyKey, deadline,
        );
      } catch (error) {
        apiKey = null;
        if (error && error.outcome && error.code === 'SS_ERP_BYOK_IMAGE_EDIT_HTTP_FAILED') throw error;
        throw unknownOutcome(error, null, null);
      }
      entry.responseReceived = true;
      var requestId = providerRequestId(accepted.response, accepted.body);
      requestIdHash = requestId ? await sha256Bytes(cryptoImpl, requestId) : null;
      requestId = null;
      var normalized;
      try { normalized = adapter.normalizeSubmitResponse(accepted.body); } catch (error) {
        apiKey = null;
        throw unknownOutcome(error, requestIdHash, null);
      }
      accepted.body = null;
      if (normalized.kind === 'ASYNC_TASK') {
        var taskId = normalized.taskId;
        taskIdHash = await sha256Bytes(cryptoImpl, taskId);
        try {
          await profileStore.recordAcceptedProviderTask(prepared.input.profileId, {
            ...dispatchIdentity(prepared),
            taskId: taskId,
          }, entry.credentialRevision);
        } catch (error) {
          apiKey = null;
          taskId = null;
          throw unknownOutcome(error, requestIdHash, taskIdHash);
        }
        while (true) {
          if (pollIntervalMs > 0) {
            try {
              await withDeadline(new Promise(function (resolve) {
                setTimeout(resolve, pollIntervalMs);
              }), deadline);
            } catch (error) {
              apiKey = null;
              taskId = null;
              throw unknownOutcome(error, requestIdHash, taskIdHash);
            }
          }
          try {
            await assertResultAuthority(
              entry,
              prepared,
              requestIdHash,
              taskIdHash,
            );
          } catch (error) {
            apiKey = null;
            taskId = null;
            throw error;
          }
          var pollRequest;
          try {
            pollRequest = adapter.createPollRequest({
              apiBaseUrl: prepared.endpoint.apiBaseUrl,
              taskId: taskId,
            });
          } catch (error) {
            apiKey = null;
            taskId = null;
            throw unknownOutcome(error, requestIdHash, taskIdHash);
          }
          var polled;
          try {
            polled = await requestJsonWithAuth(pollRequest, apiKey, null, deadline);
          } catch (error) {
            apiKey = null;
            taskId = null;
            throw unknownOutcome(error, requestIdHash, taskIdHash);
          }
          var status;
          try { status = adapter.normalizePollResponse(polled.body, taskId); } catch (error) {
            apiKey = null;
            taskId = null;
            throw unknownOutcome(error, requestIdHash, taskIdHash);
          }
          if (!status.terminal) continue;
          taskId = null;
          if (status.state !== 'SUCCEEDED') {
            apiKey = null;
            throw clientError(
              'SS_ERP_BYOK_IMAGE_EDIT_TASK_FAILED',
              'Provider edit task failed',
              'FAILED_FINAL',
              { providerTaskIdSha256: taskIdHash, causeCode: status.errorCode || status.state },
            );
          }
          normalized = status.image;
          break;
        }
      }
      apiKey = null;
      var image;
      try {
        image = await materializeImage(
          entry,
          prepared,
          normalized,
          deadline,
          requestIdHash,
          taskIdHash,
        );
      } catch (error) {
        if (error && error.code === 'SS_ERP_BYOK_IMAGE_EDIT_RESULT_AUTHORITY_STALE') throw error;
        throw unknownOutcome(error, requestIdHash, taskIdHash);
      }
      var resultHash = await sha256Bytes(cryptoImpl, image.bytes);
      await assertResultAuthority(entry, prepared, requestIdHash, taskIdHash);
      var acceptedAt = new Date(now());
      if (!Number.isFinite(acceptedAt.getTime())) acceptedAt = new Date();
      return {
        contractVersion: CONTRACT_VERSION,
        outcome: 'SUCCEEDED',
        operation: prepared.input.operation,
        requestMode: adapter.requestMode,
        adapterId: adapter.id,
        profileId: prepared.input.profileId,
        profileIdentity: schema.profileIdentity(prepared.profile),
        providerOrigin: prepared.endpoint.providerOrigin,
        model: prepared.profile.model,
        policyRevision: prepared.binding.policyRevision,
        idempotencyKey: prepared.input.idempotencyKey,
        requestHash: prepared.requestHash,
        promptHash: prepared.promptHash,
        negativePromptHash: prepared.negativePromptHash,
        endpointHash: prepared.endpointHash,
        sourceSha256: prepared.sourceSha256,
        referenceSha256s: prepared.referenceSha256s.slice(),
        maskSha256: prepared.maskSha256,
        providerRequestIdSha256: requestIdHash,
        providerTaskIdSha256: taskIdHash,
        acceptedAt: acceptedAt.toISOString(),
        image: {
          blob: new Blob([image.bytes], { type: image.mimeType }),
          mimeType: image.mimeType,
          byteLength: image.bytes.byteLength,
          sha256: resultHash,
          source: image.source,
          resultOrigin: image.resultOrigin,
          resultUrlHash: image.resultUrlHash,
        },
      };
    }

    async function run(value, requireEvidence, capabilityProbe) {
      var prepared = await prepare(value, requireEvidence);
      var idempotencyKey = prepared.input.idempotencyKey;
      var existing = operations.get(idempotencyKey);
      if (existing) {
        if (existing.requestHash !== prepared.requestHash) throw clientError(
          'SS_ERP_BYOK_IMAGE_EDIT_IDEMPOTENCY_CONFLICT',
          'The idempotency key is bound to a different edit',
          'FAILED_FINAL',
        );
        if (existing.status === 'SUCCEEDED') {
          if (existing.resultReleased) throw clientError(
            'SS_ERP_BYOK_IMAGE_EDIT_RESULT_RELEASED', 'Edit result was already released', 'SUCCEEDED',
          );
          return existing.result;
        }
        if (existing.error) throw replayError(existing.error, true);
        return existing.promise;
      }
      if (operations.size >= MAX_OPERATION_COUNT) throw clientError(
        'SS_ERP_BYOK_IMAGE_EDIT_OPERATION_LIMIT', 'Too many edit operations are retained', 'FAILED_RETRYABLE',
      );
      var entry = {
        idempotencyKey: idempotencyKey,
        requestHash: prepared.requestHash,
        status: 'PREPARING',
        outcome: null,
        dispatched: false,
        responseReceived: false,
        result: null,
        resultReleased: false,
        credentialRevision: null,
        profileId: null,
        profileIdentity: null,
        providerBaseUrl: null,
        capabilityProbe: capabilityProbe,
        capabilityProbeClaimed: false,
        capabilityProbeIdentity: null,
        error: null,
        promise: null,
      };
      operations.set(idempotencyKey, entry);
      entry.promise = (async function () {
        var ownsSlot = false;
        try {
          if (activeOperationKey && activeOperationKey !== idempotencyKey) throw clientError(
            'SS_ERP_BYOK_IMAGE_EDIT_CONCURRENCY_LIMIT',
            'Only one edit request may run at a time',
            'FAILED_RETRYABLE',
          );
          activeOperationKey = idempotencyKey;
          ownsSlot = true;
          var result = await execute(entry, prepared);
          entry.status = 'SUCCEEDED';
          entry.outcome = 'SUCCEEDED';
          entry.result = result;
          return result;
        } catch (error) {
          if (!entry.dispatched) {
            if (entry.capabilityProbeClaimed) {
              try {
                await profileStore.discardPendingCapabilityProbe(
                  prepared.input.profileId, entry.capabilityProbeIdentity, entry.credentialRevision,
                );
              } catch {}
            }
            operations.delete(idempotencyKey);
            throw error;
          }
          var safeError = error && error.outcome ? error : unknownOutcome(error, null, null);
          entry.status = safeError.outcome;
          entry.outcome = safeError.outcome;
          entry.error = snapshotError(safeError);
          if (entry.capabilityProbeClaimed) {
            try {
              if (safeError.outcome === 'UNKNOWN_OUTCOME') {
                await profileStore.markCapabilityProbeUncertain(
                  prepared.input.profileId, entry.capabilityProbeIdentity, entry.credentialRevision,
                );
              } else {
                await profileStore.discardPendingCapabilityProbe(
                  prepared.input.profileId, entry.capabilityProbeIdentity, entry.credentialRevision,
                );
              }
            } catch {}
          }
          throw replayError(entry.error, false);
        } finally {
          if (ownsSlot && activeOperationKey === idempotencyKey) activeOperationKey = null;
        }
      })();
      return entry.promise;
    }

    async function edit(value) {
      return run(value, true, false);
    }

    async function commitResult(idempotencyKeyValue, requestHash, commit) {
      var idempotencyKey = normalizedId(idempotencyKeyValue, 'idempotencyKey');
      if (typeof requestHash !== 'string' || !/^[a-f0-9]{64}$/u.test(requestHash)
        || typeof commit !== 'function') throw clientError(
        'SS_ERP_BYOK_IMAGE_EDIT_IDEMPOTENCY_CONFLICT', 'Edit result identity is invalid', 'FAILED_FINAL',
      );
      var entry = operations.get(idempotencyKey);
      if (!entry || entry.requestHash !== requestHash || entry.status !== 'SUCCEEDED'
        || !entry.result || entry.resultReleased) throw clientError(
        'SS_ERP_BYOK_IMAGE_EDIT_IDEMPOTENCY_CONFLICT', 'Edit result identity does not match', 'FAILED_FINAL',
      );
      var started = false;
      try {
        return await permissionBroker.commitWithOriginPermission(entry.providerBaseUrl, function () {
          return profileStore.commitWithCredentialRevisionForBackground(
            entry.profileId, entry.profileIdentity, entry.credentialRevision, function () {
              started = true;
              return commit(entry.result);
            },
          );
        });
      } catch (error) {
        if (started) throw error;
        throw resultAuthorityStale(error);
      }
    }

    function getOperationState(idempotencyKeyValue) {
      var idempotencyKey = normalizedId(idempotencyKeyValue, 'idempotencyKey');
      var entry = operations.get(idempotencyKey);
      if (!entry) return null;
      var state = {
        contractVersion: CONTRACT_VERSION,
        idempotencyKey: idempotencyKey,
        requestHash: entry.requestHash,
        status: entry.status,
        outcome: entry.outcome,
        dispatched: entry.dispatched,
        responseReceived: entry.responseReceived,
        errorCode: entry.error && entry.error.code || null,
        automaticRetryAllowed: entry.error && entry.error.automaticRetryAllowed === false ? false : null,
        providerRequestIdSha256: entry.error && entry.error.providerRequestIdSha256 || null,
        providerTaskIdSha256: entry.error && entry.error.providerTaskIdSha256 || null,
        image: null,
      };
      if (entry.result && entry.result.image) {
        state.providerRequestIdSha256 = entry.result.providerRequestIdSha256;
        state.providerTaskIdSha256 = entry.result.providerTaskIdSha256;
        state.image = {
          mimeType: entry.result.image.mimeType,
          byteLength: entry.result.image.byteLength,
          sha256: entry.result.image.sha256,
          source: entry.result.image.source,
          resultOrigin: entry.result.image.resultOrigin,
          resultUrlHash: entry.result.image.resultUrlHash,
          retained: !entry.resultReleased,
        };
      }
      return state;
    }

    function releaseResult(idempotencyKeyValue, requestHash) {
      var idempotencyKey = normalizedId(idempotencyKeyValue, 'idempotencyKey');
      var entry = operations.get(idempotencyKey);
      if (typeof requestHash !== 'string' || !/^[a-f0-9]{64}$/u.test(requestHash)
        || !entry || entry.requestHash !== requestHash || entry.status !== 'SUCCEEDED' || !entry.result) {
        throw clientError(
          'SS_ERP_BYOK_IMAGE_EDIT_IDEMPOTENCY_CONFLICT', 'Edit result release identity does not match', 'FAILED_FINAL',
        );
      }
      var released = !entry.resultReleased;
      entry.resultReleased = true;
      entry.result.image.blob = null;
      return { released: released, outcome: 'SUCCEEDED' };
    }

    async function probe(value) {
      var probeInput = value;
      if (isRecord(value) && !hasOwn(value, 'images')) {
        if (!probeMediaFactory) throw clientError(
          'SS_ERP_BYOK_IMAGE_EDIT_PROBE_MEDIA_UNAVAILABLE',
          'Synthetic image edit probe media is unavailable',
          'FAILED_RETRYABLE',
        );
        var media;
        try { media = await probeMediaFactory.create(value.operation); } catch (error) {
          throw clientError(
            'SS_ERP_BYOK_IMAGE_EDIT_PROBE_MEDIA_UNAVAILABLE',
            'Synthetic image edit probe media is unavailable',
            'FAILED_RETRYABLE',
            { causeCode: String(error && error.code || '').slice(0, 100) },
          );
        }
        if (!isRecord(media) || !Array.isArray(media.images) || !hasOwn(media, 'mask')) {
          throw clientError(
            'SS_ERP_BYOK_IMAGE_EDIT_PROBE_MEDIA_UNAVAILABLE',
            'Synthetic image edit probe media is invalid',
            'FAILED_RETRYABLE',
          );
        }
        probeInput = { ...value, images: media.images, mask: media.mask };
      }
      var result = await run(probeInput, false, true);
      if (result.outcome === 'CAPABILITY_EVIDENCE_REPLAY') return {
        contractVersion: schema.CAPABILITY_EVIDENCE_CONTRACT_VERSION,
        profileId: result.profileId,
        operation: result.operation,
        requestMode: result.requestMode,
        policyRevision: result.policyRevision,
        evidence: result.evidence,
      };
      var verifiedAt = new Date(result.acceptedAt);
      var evidence = {
        contractVersion: schema.CAPABILITY_EVIDENCE_CONTRACT_VERSION,
        profileIdentity: result.profileIdentity,
        operation: result.operation,
        requestMode: result.requestMode,
        policyRevision: result.policyRevision,
        verifiedAt: verifiedAt.toISOString(),
        expiresAt: new Date(verifiedAt.getTime() + CAPABILITY_EVIDENCE_TTL_MS).toISOString(),
      };
      try {
        var entry = operations.get(result.idempotencyKey);
        var stored = await permissionBroker.commitWithOriginPermission(result.providerOrigin, function () {
          return profileStore.setCapabilityEvidence(
            result.profileId, evidence, entry && entry.credentialRevision,
            entry && entry.capabilityProbeIdentity,
          );
        });
        return {
          contractVersion: schema.CAPABILITY_EVIDENCE_CONTRACT_VERSION,
          profileId: result.profileId,
          operation: result.operation,
          requestMode: result.requestMode,
          policyRevision: result.policyRevision,
          evidence: stored,
        };
      } catch (error) {
        throw resultAuthorityStale(error);
      } finally {
        releaseResult(result.idempotencyKey, result.requestHash);
      }
    }

    return Object.freeze({
      edit: edit,
      probe: probe,
      commitResult: commitResult,
      getOperationState: getOperationState,
      releaseResult: releaseResult,
    });
  }

  global.SS_ERP_BYOK_IMAGE_EDIT_CLIENT = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    EDIT_OPERATIONS: EDIT_OPERATIONS,
    createClient: createClient,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
