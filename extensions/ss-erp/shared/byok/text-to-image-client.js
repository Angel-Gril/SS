(function (global) {
  'use strict';

  var schema = global.SS_ERP_BYOK_PROFILE_SCHEMA;
  if (!schema) throw new Error('SS_ERP_BYOK_PROFILE_SCHEMA is required');

  var CONTRACT_VERSION = 'extension-byok-text-to-image/v1';
  var PREPARED_REQUEST_CONTRACT_VERSION = 'extension-byok-prepared-provider-request/v1';
  var READINESS_BINDING_VERSION = 'extension-byok-readiness-binding/v2';
  var OPERATION = 'TEXT_TO_IMAGE';
  var REQUEST_MODE = 'json';
  var SHARED_DETAIL_ROLES = Object.freeze(['SCENE', 'DETAIL', 'SPEC', 'PACKAGING']);
  var MAX_PROMPT_CHARACTERS = 8000;
  var MAX_NEGATIVE_PROMPT_CHARACTERS = 4000;
  var MAX_REQUEST_BYTES = 50 * 1024 * 1024;
  var MAX_RESULT_BYTES = 20 * 1024 * 1024;
  var MAX_JSON_BYTES = 32 * 1024 * 1024;
  var MAX_DIMENSION = 4096;
  var MAX_PIXELS = MAX_DIMENSION * MAX_DIMENSION;
  var MAX_RESULT_URL_CHARACTERS = 8192;
  var MAX_OPERATION_COUNT = 100;
  var MAX_PREPARED_REQUEST_COUNT = 16;
  var MAX_CONSUMED_PREPARED_HANDLE_COUNT = 100;
  var MAX_CONCURRENCY = 1;
  var DEFAULT_TIMEOUT_MS = 120000;
  var CAPABILITY_EVIDENCE_TTL_MS = 24 * 60 * 60 * 1000;
  var READINESS_KEYS = [
    'contractVersion',
    'ownerUserId',
    'deviceSessionId',
    'shopId',
    'workflowId',
    'draftRevision',
    'draftVersion',
    'sourcePlatform',
    'sourceProductId',
    'sourceCaptureSnapshotId',
    'supplyGoodsId',
    'skuKey',
    'slotKey',
    'assignmentMode',
    'assignmentOrdinal',
    'providerOrigin',
    'model',
    'operation',
    'policyRevision',
  ];

  function clientError(code, message, outcome, details) {
    var result = new Error(message || code);
    result.name = 'ExtensionByokTextToImageError';
    result.code = code;
    if (outcome) result.outcome = outcome;
    if (details && typeof details === 'object') {
      Object.keys(details).forEach(function (key) {
        result[key] = details[key];
      });
    }
    return result;
  }

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
  }

  function assertClosedRecord(value, allowedKeys, code) {
    if (!isRecord(value)) throw clientError(code, 'BYOK Provider input is invalid', 'FAILED_RETRYABLE');
    var allowed = new Set(allowedKeys);
    Object.keys(value).forEach(function (key) {
      if (!allowed.has(key)) {
        throw clientError(code, 'BYOK Provider input contains an unknown field', 'FAILED_RETRYABLE');
      }
    });
  }

  function requiredOwn(value, key, code) {
    if (!hasOwn(value, key)) {
      throw clientError(code, 'BYOK Provider input is incomplete', 'FAILED_RETRYABLE');
    }
    return value[key];
  }

  function normalizedId(value, label) {
    if (typeof value !== 'string') {
      throw clientError('SS_ERP_BYOK_PROVIDER_INPUT_INVALID', label + ' is invalid', 'FAILED_RETRYABLE');
    }
    var result = value.normalize('NFKC').trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/u.test(result)) {
      throw clientError('SS_ERP_BYOK_PROVIDER_INPUT_INVALID', label + ' is invalid', 'FAILED_RETRYABLE');
    }
    return result;
  }

  function canonicalText(value, maximum, label) {
    if (typeof value !== 'string' || !value || value.length > maximum
      || value !== value.normalize('NFKC').trim()
      || /[\u0000-\u001f\u007f]/u.test(value)) {
      throw clientError(
        'SS_ERP_BYOK_PROVIDER_READINESS_INVALID',
        label + ' is invalid',
        'FAILED_RETRYABLE',
      );
    }
    return value;
  }

  function isSupportedSlotKey(skuKey, slotKey) {
    return slotKey === 'sku:' + skuKey + ':hero'
      || SHARED_DETAIL_ROLES.some(function (role) {
        return slotKey === 'shared:detail:' + role;
      });
  }

  function promptText(value, maximum, label, nullable) {
    if (nullable && (value === null || value === undefined || value === '')) return null;
    if (typeof value !== 'string') {
      throw clientError('SS_ERP_BYOK_PROVIDER_INPUT_INVALID', label + ' is invalid', 'FAILED_RETRYABLE');
    }
    var result = value.trim();
    if (!result || result.length > maximum) {
      throw clientError('SS_ERP_BYOK_PROVIDER_INPUT_INVALID', label + ' is invalid', 'FAILED_RETRYABLE');
    }
    for (var index = 0; index < result.length; index += 1) {
      var codePoint = result.codePointAt(index);
      if ((codePoint <= 0x08) || codePoint === 0x0b || codePoint === 0x0c
        || (codePoint >= 0x0e && codePoint <= 0x1f) || codePoint === 0x7f) {
        throw clientError('SS_ERP_BYOK_PROVIDER_INPUT_INVALID', label + ' contains a control character', 'FAILED_RETRYABLE');
      }
      if (codePoint > 0xffff) index += 1;
    }
    return result;
  }

  function normalizedSize(value) {
    if (typeof value !== 'string' || !/^\d{1,4}x\d{1,4}$/u.test(value.trim())) {
      throw clientError('SS_ERP_BYOK_PROVIDER_INPUT_INVALID', 'image size is invalid', 'FAILED_RETRYABLE');
    }
    var normalized = value.trim();
    var parts = normalized.split('x').map(Number);
    if (parts.some(function (part) {
      return !Number.isSafeInteger(part) || part < 1 || part > MAX_DIMENSION;
    }) || parts[0] * parts[1] > MAX_PIXELS) {
      throw clientError('SS_ERP_BYOK_PROVIDER_INPUT_INVALID', 'image size exceeds the workbench limit', 'FAILED_RETRYABLE');
    }
    return normalized;
  }

  function normalizeInput(value) {
    assertClosedRecord(value, [
      'profileId', 'prompt', 'negativePrompt', 'size', 'idempotencyKey', 'readinessBinding',
    ], 'SS_ERP_BYOK_PROVIDER_INPUT_INVALID');
    var profileId = normalizedId(
      requiredOwn(value, 'profileId', 'SS_ERP_BYOK_PROVIDER_INPUT_INVALID'),
      'profileId',
    );
    var prompt = promptText(
      requiredOwn(value, 'prompt', 'SS_ERP_BYOK_PROVIDER_INPUT_INVALID'),
      MAX_PROMPT_CHARACTERS,
      'prompt',
      false,
    );
    var negativePrompt = promptText(
      requiredOwn(value, 'negativePrompt', 'SS_ERP_BYOK_PROVIDER_INPUT_INVALID'),
      MAX_NEGATIVE_PROMPT_CHARACTERS,
      'negativePrompt',
      true,
    );
    return {
      profileId: profileId,
      prompt: prompt,
      negativePrompt: negativePrompt,
      size: normalizedSize(requiredOwn(value, 'size', 'SS_ERP_BYOK_PROVIDER_INPUT_INVALID')),
      idempotencyKey: normalizedId(
        requiredOwn(value, 'idempotencyKey', 'SS_ERP_BYOK_PROVIDER_INPUT_INVALID'),
        'idempotencyKey',
      ),
      readinessBinding: requiredOwn(
        value,
        'readinessBinding',
        'SS_ERP_BYOK_PROVIDER_INPUT_INVALID',
      ),
    };
  }

  function normalizedReadiness(value, permissionBroker, requireDraftContext) {
    assertClosedRecord(value, READINESS_KEYS, 'SS_ERP_BYOK_PROVIDER_READINESS_INVALID');
    if (Object.keys(value).length !== READINESS_KEYS.length
      || value.contractVersion !== READINESS_BINDING_VERSION) {
      throw clientError(
        'SS_ERP_BYOK_PROVIDER_READINESS_INVALID',
        'Authenticated BYOK readiness is invalid',
        'FAILED_RETRYABLE',
      );
    }
    READINESS_KEYS.forEach(function (key) {
      requiredOwn(value, key, 'SS_ERP_BYOK_PROVIDER_READINESS_INVALID');
    });
    var policyRevision = normalizedId(value.policyRevision, 'policyRevision');
    var providerOrigin;
    try {
      providerOrigin = permissionBroker.canonicalizeOrigin(value.providerOrigin);
    } catch {
      throw clientError(
        'SS_ERP_BYOK_PROVIDER_READINESS_INVALID',
        'Authenticated BYOK readiness origin is invalid',
        'FAILED_RETRYABLE',
      );
    }
    if (providerOrigin !== value.providerOrigin || typeof value.model !== 'string'
      || !value.model.trim() || value.model.length > 200 || value.operation !== OPERATION) {
      throw clientError(
        'SS_ERP_BYOK_PROVIDER_READINESS_INVALID',
        'Authenticated BYOK readiness is invalid',
        'FAILED_RETRYABLE',
      );
    }
    canonicalText(value.ownerUserId, 200, 'ownerUserId');
    canonicalText(value.deviceSessionId, 200, 'deviceSessionId');
    canonicalText(value.shopId, 200, 'shopId');
    var draftValues = [
      value.workflowId, value.draftRevision, value.draftVersion, value.sourcePlatform,
      value.sourceProductId, value.sourceCaptureSnapshotId, value.supplyGoodsId,
      value.skuKey, value.slotKey, value.assignmentMode, value.assignmentOrdinal,
    ];
    var hasDraftContext = draftValues.every(function (item) { return item !== null; });
    if ((!hasDraftContext && !draftValues.every(function (item) { return item === null; }))
      || (requireDraftContext === true && !hasDraftContext)) {
      throw clientError(
        'SS_ERP_BYOK_PROVIDER_READINESS_INVALID',
        'Authenticated BYOK draft readiness is invalid',
        'FAILED_RETRYABLE',
      );
    }
    if (hasDraftContext) {
      var skuKey = canonicalText(value.skuKey, 500, 'skuKey');
      var slotKey = canonicalText(value.slotKey, 200, 'slotKey');
      if (!['1688', 'pdd', 'taobao', 'tmall'].includes(value.sourcePlatform)
        || canonicalText(value.sourceProductId, 200, 'sourceProductId') !== value.sourceProductId
        || canonicalText(value.sourceCaptureSnapshotId, 200, 'sourceCaptureSnapshotId')
          !== value.sourceCaptureSnapshotId
        || canonicalText(value.supplyGoodsId, 200, 'supplyGoodsId') !== value.supplyGoodsId
        || canonicalText(value.workflowId, 200, 'workflowId') !== value.workflowId
        || !Number.isSafeInteger(value.draftRevision) || value.draftRevision < 1
        || !Number.isSafeInteger(value.draftVersion) || value.draftVersion < 1
        || value.assignmentMode !== 'APPEND'
        || !Number.isSafeInteger(value.assignmentOrdinal) || value.assignmentOrdinal < 0
        || value.assignmentOrdinal > 499
        || !isSupportedSlotKey(skuKey, slotKey)) {
        throw clientError(
          'SS_ERP_BYOK_PROVIDER_READINESS_INVALID',
          'Authenticated BYOK draft readiness is invalid',
          'FAILED_RETRYABLE',
        );
      }
    }
    return {
      contractVersion: READINESS_BINDING_VERSION,
      ownerUserId: value.ownerUserId,
      deviceSessionId: value.deviceSessionId,
      shopId: value.shopId,
      workflowId: value.workflowId,
      draftRevision: value.draftRevision,
      draftVersion: value.draftVersion,
      sourcePlatform: value.sourcePlatform,
      sourceProductId: value.sourceProductId,
      sourceCaptureSnapshotId: value.sourceCaptureSnapshotId,
      supplyGoodsId: value.supplyGoodsId,
      skuKey: value.skuKey,
      slotKey: value.slotKey,
      assignmentMode: value.assignmentMode,
      assignmentOrdinal: value.assignmentOrdinal,
      providerOrigin: providerOrigin,
      model: value.model.trim(),
      operation: OPERATION,
      policyRevision: policyRevision,
    };
  }

  function generationsEndpoint(baseUrl, permissionBroker) {
    var base = schema.canonicalizeEndpoint(baseUrl);
    var parsed = new URL(base);
    if (/\/images\/(?:generations|edits|tasks)(?:\/|$)/iu.test(parsed.pathname)) {
      throw clientError(
        'SS_ERP_BYOK_PROVIDER_ENDPOINT_INVALID',
        'Provider profile must contain an API base, not an image operation endpoint',
        'FAILED_RETRYABLE',
      );
    }
    var providerOrigin;
    try {
      providerOrigin = permissionBroker.canonicalizeOrigin(base);
    } catch {
      throw clientError(
        'SS_ERP_BYOK_PROVIDER_ENDPOINT_INVALID',
        'Provider profile origin is invalid',
        'FAILED_RETRYABLE',
      );
    }
    return {
      baseUrl: base,
      providerOrigin: providerOrigin,
      endpoint: base.replace(/\/+$/u, '') + '/images/generations',
    };
  }

  function safeProviderRequestId(value) {
    if (typeof value !== 'string') return null;
    var normalized = value.trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/u.test(normalized)) return null;
    return normalized;
  }

  function safeSha256(value) {
    return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value) ? value : null;
  }

  function providerRequestId(response, body) {
    var bodyId = safeProviderRequestId(body && body.id);
    if (bodyId) return bodyId;
    if (!response || !response.headers || typeof response.headers.get !== 'function') return null;
    return safeProviderRequestId(
      response.headers.get('x-request-id')
        || response.headers.get('request-id')
        || response.headers.get('openai-request-id'),
    );
  }

  function utf8Bytes(value) {
    return new TextEncoder().encode(value);
  }

  function hex(bytes) {
    return Array.from(new Uint8Array(bytes)).map(function (value) {
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

  function contentLength(response) {
    var raw = response && response.headers && typeof response.headers.get === 'function'
      ? response.headers.get('content-length')
      : null;
    if (raw === null || raw === '') return null;
    var parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  function cancelResponseBody(response) {
    try {
      if (response && response.body && typeof response.body.cancel === 'function') {
        var cancelled = response.body.cancel();
        if (cancelled && typeof cancelled.catch === 'function') cancelled.catch(function () {});
      }
    } catch {}
  }

  async function readBodyWithLimit(response, maximum, deadline) {
    var declared = contentLength(response);
    if (declared !== null && declared > maximum) {
      cancelResponseBody(response);
      throw clientError(
        'SS_ERP_BYOK_PROVIDER_RESPONSE_TOO_LARGE',
        'Provider response exceeds the configured byte limit',
      );
    }
    var body = response && response.body;
    if (body && typeof body.getReader === 'function') {
      var reader = body.getReader();
      var chunks = [];
      var total = 0;
      try {
        while (true) {
          var part = await promiseWithDeadline(
            reader.read(),
            deadline,
            function () {
              try {
                var cancelled = reader.cancel();
                if (cancelled && typeof cancelled.catch === 'function') {
                  cancelled.catch(function () {});
                }
              } catch {}
            },
          );
          if (part.done) break;
          var chunk = part.value instanceof Uint8Array
            ? part.value
            : new Uint8Array(part.value || []);
          total += chunk.byteLength;
          if (!Number.isSafeInteger(total) || total > maximum) {
            try { await reader.cancel(); } catch {}
            throw clientError(
              'SS_ERP_BYOK_PROVIDER_RESPONSE_TOO_LARGE',
              'Provider response exceeds the configured byte limit',
            );
          }
          chunks.push(chunk);
        }
      } finally {
        try {
          if (typeof reader.releaseLock === 'function') reader.releaseLock();
        } catch {}
      }
      var merged = new Uint8Array(total);
      var offset = 0;
      chunks.forEach(function (chunk) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
      });
      return merged;
    }
    if (!response || typeof response.arrayBuffer !== 'function') {
      throw clientError('SS_ERP_BYOK_PROVIDER_RESPONSE_INVALID', 'Provider response body is unavailable');
    }
    var fallback = new Uint8Array(await promiseWithDeadline(
      response.arrayBuffer(),
      deadline,
      function () { cancelResponseBody(response); },
    ));
    if (fallback.byteLength > maximum) {
      throw clientError(
        'SS_ERP_BYOK_PROVIDER_RESPONSE_TOO_LARGE',
        'Provider response exceeds the configured byte limit',
      );
    }
    return fallback;
  }

  async function readJson(response, deadline) {
    var raw = await readBodyWithLimit(response, MAX_JSON_BYTES, deadline);
    if (!raw.byteLength) {
      throw clientError('SS_ERP_BYOK_PROVIDER_RESPONSE_INVALID', 'Provider returned an empty response');
    }
    var decoded;
    try {
      decoded = new TextDecoder('utf-8', { fatal: true }).decode(raw);
    } catch {
      throw clientError('SS_ERP_BYOK_PROVIDER_RESPONSE_INVALID', 'Provider returned invalid UTF-8');
    }
    try {
      var parsed = JSON.parse(decoded);
      if (!isRecord(parsed)) throw new Error('not an object');
      return parsed;
    } catch {
      throw clientError('SS_ERP_BYOK_PROVIDER_RESPONSE_INVALID', 'Provider returned invalid JSON');
    }
  }

  function base64Bytes(value) {
    if (typeof value !== 'string' || !value || value.length % 4 !== 0) {
      throw clientError('SS_ERP_BYOK_PROVIDER_RESULT_INVALID', 'Provider returned invalid image data');
    }
    var maximumEncodedLength = Math.ceil(MAX_RESULT_BYTES / 3) * 4 + 4;
    if (value.length > maximumEncodedLength || !/^[a-zA-Z0-9+/]*={0,2}$/u.test(value)) {
      throw clientError(
        'SS_ERP_BYOK_PROVIDER_RESPONSE_TOO_LARGE',
        'Provider image result exceeds the configured byte limit',
      );
    }
    var binary;
    try {
      binary = global.atob(value);
    } catch {
      throw clientError('SS_ERP_BYOK_PROVIDER_RESULT_INVALID', 'Provider returned invalid image data');
    }
    if (!binary.length || binary.length > MAX_RESULT_BYTES) {
      throw clientError(
        'SS_ERP_BYOK_PROVIDER_RESPONSE_TOO_LARGE',
        'Provider image result exceeds the configured byte limit',
      );
    }
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
    throw clientError('SS_ERP_BYOK_PROVIDER_RESULT_INVALID', 'Provider result is not a supported image');
  }

  function declaredImageMime(response, detected) {
    var raw = response && response.headers && typeof response.headers.get === 'function'
      ? response.headers.get('content-type')
      : null;
    if (!raw) return detected;
    var declared = String(raw).split(';')[0].trim().toLowerCase();
    if (declared === 'image/jpg') declared = 'image/jpeg';
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(declared) || declared !== detected) {
      throw clientError('SS_ERP_BYOK_PROVIDER_RESULT_INVALID', 'Provider image MIME does not match its bytes');
    }
    return detected;
  }

  function parseResultUrl(value, permissionBroker) {
    if (typeof value !== 'string' || !value || value.length > MAX_RESULT_URL_CHARACTERS
      || value.includes('\\')) {
      throw clientError('SS_ERP_BYOK_PROVIDER_RESULT_URL_INVALID', 'Provider result URL is invalid');
    }
    var parsed;
    try {
      parsed = new URL(value);
    } catch {
      throw clientError('SS_ERP_BYOK_PROVIDER_RESULT_URL_INVALID', 'Provider result URL is invalid');
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) {
      throw clientError('SS_ERP_BYOK_PROVIDER_RESULT_URL_INVALID', 'Provider result URL is invalid');
    }
    var resultOrigin;
    try {
      resultOrigin = permissionBroker.canonicalizeOrigin(parsed.origin);
    } catch {
      throw clientError('SS_ERP_BYOK_PROVIDER_RESULT_URL_INVALID', 'Provider result URL origin is invalid');
    }
    return { url: parsed.toString(), origin: resultOrigin };
  }

  function remainingTime(deadline) {
    return Math.max(0, deadline - Date.now());
  }

  async function promiseWithDeadline(value, deadline, onTimeout) {
    var remaining = remainingTime(deadline);
    if (remaining < 1) {
      if (typeof onTimeout === 'function') {
        try { onTimeout(); } catch {}
      }
      throw clientError('SS_ERP_BYOK_PROVIDER_FETCH_TIMEOUT', 'Provider request timed out');
    }
    var timeoutId;
    var timeout = new Promise(function (_resolve, reject) {
      timeoutId = setTimeout(function () {
        reject(clientError('SS_ERP_BYOK_PROVIDER_FETCH_TIMEOUT', 'Provider request timed out'));
        if (typeof onTimeout === 'function') {
          try { onTimeout(); } catch {}
        }
      }, remaining);
    });
    try {
      return await Promise.race([Promise.resolve(value), timeout]);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function fetchWithDeadline(fetchImpl, url, init, deadline) {
    var controller = new AbortController();
    var request;
    try {
      request = Promise.resolve(fetchImpl(url, Object.assign({}, init, { signal: controller.signal })));
    } catch {
      request = Promise.reject(clientError('SS_ERP_BYOK_PROVIDER_FETCH_FAILED', 'Provider request failed'));
    }
    try {
      return await promiseWithDeadline(request, deadline, function () { controller.abort(); });
    } catch (error) {
      if (controller.signal.aborted || (error && error.name === 'AbortError')) {
        throw clientError('SS_ERP_BYOK_PROVIDER_FETCH_TIMEOUT', 'Provider request timed out');
      }
      if (error && /^SS_ERP_BYOK_PROVIDER_/u.test(String(error.code || ''))) throw error;
      throw clientError('SS_ERP_BYOK_PROVIDER_FETCH_FAILED', 'Provider request failed');
    }
  }

  function httpOutcome(status) {
    return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500
      ? 'FAILED_RETRYABLE'
      : 'FAILED_FINAL';
  }

  function unknownOutcome(error, providerRequestIdSha256Value) {
    return clientError(
      'SS_ERP_BYOK_PROVIDER_UNKNOWN_OUTCOME',
      'Provider may have accepted the request; automatic retry is disabled',
      'UNKNOWN_OUTCOME',
      {
        automaticRetryAllowed: false,
        providerRequestIdSha256: safeSha256(providerRequestIdSha256Value),
        causeCode: error && error.code ? String(error.code) : 'SS_ERP_BYOK_PROVIDER_RESULT_UNAVAILABLE',
      },
    );
  }

  function snapshotError(error) {
    return {
      code: String(error && error.code || 'SS_ERP_BYOK_PROVIDER_FAILED'),
      message: String(error && error.message || 'BYOK Provider request failed').slice(0, 500),
      outcome: String(error && error.outcome || 'UNKNOWN_OUTCOME'),
      automaticRetryAllowed: error && error.automaticRetryAllowed === false ? false : undefined,
      providerRequestIdSha256: safeSha256(error && error.providerRequestIdSha256),
      status: Number.isSafeInteger(error && error.status) ? error.status : undefined,
      causeCode: typeof (error && error.causeCode) === 'string'
        ? String(error.causeCode).slice(0, 100)
        : undefined,
    };
  }

  function replayError(snapshot, replayed) {
    var details = {
      replayed: Boolean(replayed),
      providerRequestIdSha256: snapshot.providerRequestIdSha256 || null,
    };
    if (snapshot.automaticRetryAllowed === false) details.automaticRetryAllowed = false;
    if (Number.isSafeInteger(snapshot.status)) details.status = snapshot.status;
    if (snapshot.causeCode) details.causeCode = snapshot.causeCode;
    return clientError(snapshot.code, snapshot.message, snapshot.outcome, details);
  }

  function releasedResultError() {
    return clientError(
      'SS_ERP_BYOK_PROVIDER_RESULT_RELEASED',
      'The generated image bytes were already released',
      'SUCCEEDED',
      { replayed: true },
    );
  }

  function resultAuthorityStale(error) {
    return clientError(
      'SS_ERP_BYOK_PROVIDER_RESULT_AUTHORITY_STALE',
      'Provider result authorization changed before the result could be accepted',
      'FAILED_FINAL',
      {
        automaticRetryAllowed: false,
        causeCode: error && error.code
          ? String(error.code).slice(0, 100)
          : 'SS_ERP_BYOK_PROVIDER_RESULT_AUTHORITY_UNAVAILABLE',
      },
    );
  }

  function executionIntentFailure(error, fallbackCode, fallbackMessage, fallbackOutcome) {
    if (error && typeof error.code === 'string'
      && ['FAILED_RETRYABLE', 'FAILED_FINAL', 'UNKNOWN_OUTCOME'].includes(error.outcome)) {
      return error;
    }
    return clientError(
      fallbackCode,
      fallbackMessage,
      fallbackOutcome,
      {
        causeCode: error && typeof error.code === 'string'
          ? String(error.code).slice(0, 100)
          : undefined,
      },
    );
  }

  function undispatchedIntentOutcomeUnresolved(setupError, reportError) {
    return clientError(
      'SS_ERP_BYOK_EXECUTION_INTENT_OUTCOME_UNRESOLVED',
      'The undispatched BYOK intent outcome could not be confirmed',
      'UNKNOWN_OUTCOME',
      {
        automaticRetryAllowed: false,
        causeCode: reportError && typeof reportError.code === 'string'
          ? String(reportError.code).slice(0, 100)
          : setupError && typeof setupError.code === 'string'
            ? String(setupError.code).slice(0, 100)
            : 'SS_ERP_BYOK_EXECUTION_INTENT_OUTCOME_UNAVAILABLE',
      },
    );
  }

  function assertExecutionIntentProjection(value, prepared) {
    var binding = prepared.input.readinessBinding;
    if (!isRecord(value)
      || value.contractVersion !== 'extension-byok-execution-intent/v1'
      || value.executionMode !== 'BYOK'
      || typeof value.intentId !== 'string'
      || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/u.test(value.intentId)
      || typeof value.replayed !== 'boolean'
      || !['PENDING', 'SUCCEEDED', 'FAILED_FINAL', 'UNKNOWN_OUTCOME'].includes(value.outcome)
      || value.providerIdempotencyKey !== prepared.input.idempotencyKey
      || value.providerRequestHash !== prepared.requestHash
      || !isRecord(value.context)
      || value.context.shopId !== binding.shopId
      || value.context.workflowId !== binding.workflowId
      || value.context.draftRevision !== binding.draftRevision
      || value.context.draftVersion !== binding.draftVersion
      || value.context.skuKey !== binding.skuKey
      || value.context.slotKey !== binding.slotKey) {
      throw clientError(
        'SS_ERP_BYOK_EXECUTION_INTENT_RESPONSE_INVALID',
        'BYOK execution authority returned an invalid response',
        'FAILED_FINAL',
        { automaticRetryAllowed: false },
      );
    }
    return value;
  }

  function assertExecutionOutcomeProjection(value, entry, prepared, outcome) {
    var resultSha256 = outcome === 'SUCCEEDED' && entry.resultSha256
      ? entry.resultSha256
      : null;
    if (!isRecord(value)
      || value.contractVersion !== 'extension-byok-execution-intent-outcome/v1'
      || value.intentId !== entry.executionIntentId
      || typeof value.replayed !== 'boolean'
      || value.outcome !== outcome
      || value.providerIdempotencyKey !== prepared.input.idempotencyKey
      || value.providerRequestHash !== prepared.requestHash
      || (value.providerRequestIdSha256 || null) !== (entry.providerRequestIdSha256 || null)
      || (value.resultSha256 || null) !== resultSha256) {
      throw clientError(
        'SS_ERP_BYOK_EXECUTION_INTENT_OUTCOME_RESPONSE_INVALID',
        'BYOK execution outcome authority returned an invalid response',
        'FAILED_FINAL',
        { automaticRetryAllowed: false },
      );
    }
    return value;
  }

  function createClient(options) {
    var profileStore = options && options.profileStore;
    var permissionBroker = options && options.permissionBroker;
    var executionIntentClient = options && options.executionIntentClient;
    var stageResult = options && options.stageResult;
    var fetchImpl = options && options.fetchImpl;
    var authorizeResultOrigin = options && options.authorizeResultOrigin;
    var cryptoImpl = options && options.crypto || global.crypto;
    var now = options && typeof options.now === 'function'
      ? options.now
      : function () { return new Date(); };
    var configuredTimeout = Number(options && options.timeoutMs);
    var timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
      ? Math.min(configuredTimeout, DEFAULT_TIMEOUT_MS)
      : DEFAULT_TIMEOUT_MS;
    if (!profileStore || typeof profileStore.getProfile !== 'function'
      || typeof profileStore.getCredentialSnapshotForBackground !== 'function'
      || typeof profileStore.assertCredentialRevisionForBackground !== 'function'
      || typeof profileStore.commitWithCredentialRevisionForBackground !== 'function'
      || typeof profileStore.beginProviderDispatch !== 'function'
      || typeof profileStore.setCapabilityEvidence !== 'function'
      || typeof profileStore.beginCapabilityProbe !== 'function'
      || typeof profileStore.markCapabilityProbeUncertain !== 'function'
      || typeof profileStore.discardPendingCapabilityProbe !== 'function') {
      throw new TypeError('BYOK background profile store is required');
    }
    if (!permissionBroker || typeof permissionBroker.canonicalizeOrigin !== 'function'
      || typeof permissionBroker.hasOriginPermission !== 'function'
      || typeof permissionBroker.commitWithOriginPermission !== 'function') {
      throw new TypeError('BYOK exact-origin permission broker is required');
    }
    if (!executionIntentClient || typeof executionIntentClient.claim !== 'function'
      || typeof executionIntentClient.reportOutcome !== 'function') {
      throw new TypeError('BYOK execution intent client is required');
    }
    if (typeof fetchImpl !== 'function') throw new TypeError('background fetchImpl is required');
    if (!cryptoImpl || !cryptoImpl.subtle || typeof cryptoImpl.subtle.digest !== 'function') {
      throw new TypeError('Web Crypto is required');
    }
    if (authorizeResultOrigin !== undefined && typeof authorizeResultOrigin !== 'function') {
      throw new TypeError('authorizeResultOrigin must be a function');
    }
    if (stageResult !== undefined && typeof stageResult !== 'function') {
      throw new TypeError('stageResult must be a function');
    }

    var operations = new Map();
    var preparedRequests = new Map();
    var consumedPreparedHandles = new Set();
    var preparingRequestCount = 0;
    var activeOperationKey = null;

    function preparedRequestError(code, message, outcome) {
      return clientError(code, message, outcome, { automaticRetryAllowed: false });
    }

    function newPreparedRequestHandle() {
      if (!cryptoImpl || typeof cryptoImpl.randomUUID !== 'function') {
        throw preparedRequestError(
          'SS_ERP_BYOK_PROVIDER_PREPARED_REQUEST_UNAVAILABLE',
          'Secure Provider request preparation is unavailable',
          'FAILED_FINAL',
        );
      }
      return 'byok-prepared:' + cryptoImpl.randomUUID();
    }

    function normalizedPreparedRequestHandle(value) {
      if (typeof value !== 'string'
        || !/^byok-prepared:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
          .test(value)) {
        throw preparedRequestError(
          'SS_ERP_BYOK_PROVIDER_PREPARED_REQUEST_INVALID',
          'Prepared Provider request handle is invalid',
          'FAILED_FINAL',
        );
      }
      return value;
    }

    function rememberConsumedPreparedHandle(handle) {
      consumedPreparedHandles.add(handle);
      while (consumedPreparedHandles.size > MAX_CONSUMED_PREPARED_HANDLE_COUNT) {
        consumedPreparedHandles.delete(consumedPreparedHandles.values().next().value);
      }
    }

    function capabilityProbeIdentity(prepared) {
      return {
        profileIdentity: schema.profileIdentity(prepared.profile),
        operation: OPERATION,
        requestMode: REQUEST_MODE,
        policyRevision: prepared.binding.policyRevision,
        idempotencyKey: prepared.input.idempotencyKey,
        requestHash: prepared.requestHash,
      };
    }

    function providerDispatchIdentity(prepared) {
      return {
        profileIdentity: schema.profileIdentity(prepared.profile),
        operation: OPERATION,
        requestMode: REQUEST_MODE,
        idempotencyKey: prepared.input.idempotencyKey,
        requestHash: prepared.requestHash,
      };
    }

    async function persistProviderDispatch(entry, prepared) {
      try {
        await profileStore.beginProviderDispatch(
          prepared.input.profileId,
          providerDispatchIdentity(prepared),
          entry.credentialRevision,
        );
      } catch (error) {
        var code = String(error && error.code || '');
        if (code === 'SS_ERP_BYOK_PROVIDER_UNKNOWN_OUTCOME') {
          throw clientError(
            code,
            'Provider dispatch may already have been accepted; automatic retry is disabled',
            'UNKNOWN_OUTCOME',
            { automaticRetryAllowed: false, replayed: error && error.replayed === true },
          );
        }
        if (code === 'SS_ERP_BYOK_PROVIDER_IDEMPOTENCY_CONFLICT') {
          throw clientError(
            code,
            'The idempotency key is already bound to a different Provider request',
            'FAILED_FINAL',
            { automaticRetryAllowed: false },
          );
        }
        if (code === 'SS_ERP_BYOK_PROVIDER_DISPATCH_LIMIT') {
          throw clientError(code, 'The browser session Provider dispatch limit is reached', 'FAILED_RETRYABLE');
        }
        throw clientError(
          'SS_ERP_BYOK_PROVIDER_DISPATCH_GUARD_UNAVAILABLE',
          'Provider dispatch safety state could not be persisted',
          'FAILED_RETRYABLE',
        );
      }
    }

    async function claimExecutionIntent(entry, prepared) {
      var claimed;
      try {
        claimed = await executionIntentClient.claim({
          readinessBinding: prepared.input.readinessBinding,
          requestMode: REQUEST_MODE,
          providerIdempotencyKey: prepared.input.idempotencyKey,
          providerRequestHash: prepared.requestHash,
        });
      } catch (error) {
        throw executionIntentFailure(
          error,
          'SS_ERP_BYOK_EXECUTION_INTENT_UNAVAILABLE',
          'BYOK execution authority is unavailable',
          'FAILED_RETRYABLE',
        );
      }
      assertExecutionIntentProjection(claimed, prepared);
      if (claimed.replayed === true || claimed.outcome !== 'PENDING') {
        var replayOutcome = claimed.outcome === 'FAILED_FINAL'
          ? 'FAILED_FINAL' : 'UNKNOWN_OUTCOME';
        throw clientError(
          'SS_ERP_BYOK_EXECUTION_INTENT_REPLAY_BLOCKED',
          'A persisted Provider attempt cannot be submitted again automatically',
          replayOutcome,
          {
            automaticRetryAllowed: false,
            replayed: claimed.replayed === true,
            persistedOutcome: claimed.outcome,
          },
        );
      }
      entry.executionIntentId = claimed.intentId;
    }

    async function reportExecutionOutcome(entry, prepared, outcome) {
      var reported;
      try {
        reported = await executionIntentClient.reportOutcome({
          intentId: entry.executionIntentId,
          providerIdempotencyKey: prepared.input.idempotencyKey,
          providerRequestHash: prepared.requestHash,
          outcome: outcome,
          providerRequestIdSha256: entry.providerRequestIdSha256 || null,
          resultSha256: outcome === 'SUCCEEDED' ? entry.resultSha256 : null,
        });
      } catch (error) {
        throw executionIntentFailure(
          error,
          'SS_ERP_BYOK_EXECUTION_INTENT_OUTCOME_UNAVAILABLE',
          'BYOK execution outcome authority is unavailable',
          'FAILED_RETRYABLE',
        );
      }
      assertExecutionOutcomeProjection(reported, entry, prepared, outcome);
      entry.executionIntentOutcomeReported = outcome;
    }

    async function reportFailureBestEffort(entry, prepared, error) {
      if (!entry.executionIntentId || entry.executionIntentOutcomeReported
        || !entry.dispatched || !error
        || !['FAILED_FINAL', 'UNKNOWN_OUTCOME'].includes(error.outcome)) return;
      entry.providerRequestIdSha256 = safeSha256(error.providerRequestIdSha256);
      entry.resultSha256 = null;
      try {
        await reportExecutionOutcome(entry, prepared, error.outcome);
      } catch {
        // The Provider outcome remains authoritative and absorbing when audit transport fails.
      }
    }

    async function stageCompletedResult(result, binding) {
      if (!stageResult) return result;
      var staged;
      try {
        staged = await stageResult(result, binding);
      } catch (error) {
        throw clientError(
          'SS_ERP_BYOK_PROVIDER_RESULT_ESCROW_UNAVAILABLE',
          'Provider result could not be retained for review',
          'UNKNOWN_OUTCOME',
          {
            automaticRetryAllowed: false,
            causeCode: String(error && error.code || 'SS_ERP_BYOK_RESULT_ESCROW_UNAVAILABLE')
              .slice(0, 100),
          },
        );
      }
      if (!isRecord(staged) || typeof staged.resultId !== 'string'
        || !/^br_[a-f0-9]{48}$/u.test(staged.resultId)) {
        throw clientError(
          'SS_ERP_BYOK_PROVIDER_RESULT_ESCROW_UNAVAILABLE',
          'Provider result escrow returned an invalid identity',
          'UNKNOWN_OUTCOME',
          { automaticRetryAllowed: false },
        );
      }
      result.escrowResultId = staged.resultId;
      return result;
    }

    async function stageCompletedResultWithAuthority(
      entry,
      prepared,
      result,
      providerRequestIdSha256,
    ) {
      var stageStarted = false;
      try {
        return await permissionBroker.commitWithOriginPermission(
          prepared.endpoint.baseUrl,
          function () {
            return profileStore.commitWithCredentialRevisionForBackground(
              entry.profileId,
              entry.profileIdentity,
              entry.credentialRevision,
              function () {
                stageStarted = true;
                return stageCompletedResult(result, prepared.binding);
              },
            );
          },
        );
      } catch (error) {
        if (stageStarted) throw error;
        var stale = resultAuthorityStale(error);
        stale.providerRequestIdSha256 = safeSha256(providerRequestIdSha256);
        throw stale;
      }
    }

    async function prepare(value, requireCapabilityEvidence) {
      var input = normalizeInput(value);
      var storedProfile;
      try {
        storedProfile = await profileStore.getProfile(input.profileId);
      } catch {
        throw clientError(
          'SS_ERP_BYOK_PROVIDER_PROFILE_UNAVAILABLE',
          'Provider profile is unavailable',
          'FAILED_RETRYABLE',
        );
      }
      if (!storedProfile) {
        throw clientError(
          'SS_ERP_BYOK_PROVIDER_PROFILE_NOT_FOUND',
          'Provider profile is not found',
          'FAILED_RETRYABLE',
        );
      }
      var selectedProfile;
      try {
        selectedProfile = schema.publicProfile(storedProfile);
      } catch {
        throw clientError(
          'SS_ERP_BYOK_PROVIDER_PROFILE_INVALID',
          'Provider profile is invalid',
          'FAILED_RETRYABLE',
        );
      }
      if (!selectedProfile.allowedOperations.includes(OPERATION)) {
        throw clientError(
          'SS_ERP_BYOK_PROVIDER_OPERATION_NOT_ALLOWED',
          'Text-to-image is not enabled for this profile',
          'FAILED_RETRYABLE',
        );
      }
      var endpoint = generationsEndpoint(selectedProfile.baseUrl, permissionBroker);
      var binding = normalizedReadiness(
        input.readinessBinding,
        permissionBroker,
        requireCapabilityEvidence === true,
      );
      if (binding.providerOrigin !== endpoint.providerOrigin
        || binding.model !== selectedProfile.model || binding.operation !== OPERATION) {
        throw clientError(
          'SS_ERP_BYOK_PROVIDER_READINESS_MISMATCH',
          'Provider profile does not match authenticated ERP readiness',
          'FAILED_RETRYABLE',
        );
      }
      var sentPrompt = input.negativePrompt
        ? input.prompt + '\n\nAvoid: ' + input.negativePrompt
        : input.prompt;
      var body = JSON.stringify({
        model: selectedProfile.model,
        prompt: sentPrompt,
        n: 1,
        size: input.size,
      });
      if (utf8Bytes(body).byteLength > MAX_REQUEST_BYTES) {
        throw clientError(
          'SS_ERP_BYOK_PROVIDER_REQUEST_TOO_LARGE',
          'Provider request exceeds the workbench limit',
          'FAILED_RETRYABLE',
        );
      }
      var requestHash = await sha256Bytes(cryptoImpl, JSON.stringify({
        method: 'POST',
        endpoint: endpoint.endpoint,
        idempotencyKey: input.idempotencyKey,
        body: body,
      }));
      return {
        input: input,
        profile: selectedProfile,
        binding: binding,
        endpoint: endpoint,
        body: body,
        sentPrompt: sentPrompt,
        requestHash: requestHash,
        promptHash: await sha256Bytes(cryptoImpl, input.prompt),
        negativePromptHash: input.negativePrompt
          ? await sha256Bytes(cryptoImpl, input.negativePrompt)
          : null,
        endpointHash: await sha256Bytes(cryptoImpl, endpoint.endpoint),
        requireCapabilityEvidence: requireCapabilityEvidence === true,
      };
    }

    async function assertProviderPermission(prepared) {
      var permission;
      try {
        permission = await permissionBroker.hasOriginPermission(prepared.endpoint.baseUrl);
      } catch {
        throw clientError(
          'SS_ERP_BYOK_PROVIDER_PERMISSION_UNAVAILABLE',
          'Provider permission could not be verified',
          'FAILED_RETRYABLE',
        );
      }
      if (!permission || permission.granted !== true
        || permission.origin !== prepared.endpoint.providerOrigin) {
        throw clientError(
          'SS_ERP_BYOK_PROVIDER_PERMISSION_REQUIRED',
          'Exact Provider origin permission is required',
          'FAILED_RETRYABLE',
        );
      }
    }

    async function readCredentialSnapshot(prepared) {
      var snapshot;
      try {
        snapshot = await profileStore.getCredentialSnapshotForBackground(prepared.input.profileId);
      } catch {
        throw clientError(
          'SS_ERP_BYOK_PROVIDER_KEY_UNAVAILABLE',
          'The session API key is unavailable',
          'FAILED_RETRYABLE',
        );
      }
      var snapshotProfile;
      try {
        snapshotProfile = snapshot && schema.publicProfile(snapshot.profile);
      } catch {
        snapshotProfile = null;
      }
      if (!snapshotProfile
        || snapshotProfile.id !== prepared.profile.id
        || schema.profileIdentity(snapshotProfile) !== schema.profileIdentity(prepared.profile)
        || !snapshotProfile.allowedOperations.includes(OPERATION)) {
        throw clientError(
          'SS_ERP_BYOK_PROVIDER_PROFILE_CHANGED',
          'The Provider profile changed before dispatch',
          'FAILED_RETRYABLE',
        );
      }
      if (typeof snapshot.apiKey !== 'string' || !snapshot.apiKey
        || snapshot.apiKey.length > schema.MAX_API_KEY_LENGTH
        || typeof snapshot.credentialRevision !== 'string'
        || !/^[a-f0-9]{64}$/u.test(snapshot.credentialRevision)) {
        throw clientError(
          'SS_ERP_BYOK_PROVIDER_KEY_REQUIRED',
          'A session API key is required',
          'FAILED_RETRYABLE',
        );
      }
      if (prepared.requireCapabilityEvidence) {
        var profileIdentity = schema.profileIdentity(snapshotProfile);
        var capabilityEvidence = Array.isArray(snapshot.evidence)
          ? snapshot.evidence.find(function (candidate) {
            try {
              var normalized = schema.normalizeEvidence(candidate, profileIdentity, new Date(now()));
              return normalized.operation === OPERATION
                && normalized.requestMode === REQUEST_MODE
                && normalized.policyRevision === prepared.binding.policyRevision;
            } catch {
              return false;
            }
          })
          : null;
        if (!capabilityEvidence) {
          throw clientError(
            'SS_ERP_BYOK_PROVIDER_CAPABILITY_REQUIRED',
            'Exact Provider capability evidence is required',
            'FAILED_RETRYABLE',
          );
        }
      }
      return snapshot;
    }

    async function assertCompletedResultAuthority(entry, prepared) {
      try {
        await assertProviderPermission(prepared);
        await profileStore.assertCredentialRevisionForBackground(
          prepared.input.profileId,
          schema.profileIdentity(prepared.profile),
          entry.credentialRevision,
        );
      } catch (error) {
        throw resultAuthorityStale(error);
      }
    }

    async function authorizeUrlResult(prepared, parsed, deadline) {
      if (parsed.origin === prepared.endpoint.providerOrigin) return;
      if (typeof authorizeResultOrigin !== 'function') {
        throw clientError(
          'SS_ERP_BYOK_PROVIDER_RESULT_ORIGIN_NOT_ALLOWED',
          'Provider result origin is not independently allowed',
        );
      }
      var allowed = false;
      try {
        allowed = await promiseWithDeadline(authorizeResultOrigin({
          providerOrigin: prepared.endpoint.providerOrigin,
          resultOrigin: parsed.origin,
          policyRevision: prepared.binding.policyRevision,
          operation: OPERATION,
        }), deadline);
      } catch {
        allowed = false;
      }
      if (allowed !== true) {
        throw clientError(
          'SS_ERP_BYOK_PROVIDER_RESULT_ORIGIN_NOT_ALLOWED',
          'Provider result origin is not independently allowed',
        );
      }
      var permission;
      try {
        permission = await promiseWithDeadline(
          permissionBroker.hasOriginPermission(parsed.origin),
          deadline,
        );
      } catch {
        permission = null;
      }
      if (!permission || permission.granted !== true || permission.origin !== parsed.origin) {
        throw clientError(
          'SS_ERP_BYOK_PROVIDER_RESULT_PERMISSION_REQUIRED',
          'Exact result origin permission is required',
        );
      }
    }

    async function downloadUrlResult(prepared, value, deadline) {
      var parsed = parseResultUrl(value, permissionBroker);
      await authorizeUrlResult(prepared, parsed, deadline);
      var response = await fetchWithDeadline(fetchImpl, parsed.url, {
        method: 'GET',
        headers: { Accept: 'image/png, image/jpeg, image/webp' },
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      }, deadline);
      if (!response || !response.ok) {
        cancelResponseBody(response);
        throw clientError('SS_ERP_BYOK_PROVIDER_RESULT_DOWNLOAD_FAILED', 'Provider image download failed');
      }
      var bytes = await readBodyWithLimit(response, MAX_RESULT_BYTES, deadline);
      var detected = detectedImageMime(bytes);
      return {
        bytes: bytes,
        mimeType: declaredImageMime(response, detected),
        source: 'url',
        resultOrigin: parsed.origin,
        resultUrlHash: await sha256Bytes(cryptoImpl, parsed.url),
      };
    }

    async function normalizeImageResult(prepared, response, body, deadline) {
      var data = Array.isArray(body.data) ? body.data : [];
      if (data.length !== 1 || !isRecord(data[0])) {
        throw clientError('SS_ERP_BYOK_PROVIDER_RESULT_INVALID', 'Provider returned an invalid image result');
      }
      var item = data[0];
      var hasBase64 = typeof item.b64_json === 'string' && item.b64_json.length > 0;
      var hasUrl = typeof item.url === 'string' && item.url.length > 0;
      if (hasBase64 === hasUrl) {
        throw clientError('SS_ERP_BYOK_PROVIDER_RESULT_INVALID', 'Provider returned an ambiguous image result');
      }
      if (hasBase64) {
        var bytes = base64Bytes(item.b64_json);
        return {
          bytes: bytes,
          mimeType: detectedImageMime(bytes),
          source: 'b64_json',
          resultOrigin: null,
          resultUrlHash: null,
        };
      }
      return downloadUrlResult(prepared, item.url, deadline);
    }

    async function execute(entry, prepared) {
      await assertProviderPermission(prepared);
      var credential = await readCredentialSnapshot(prepared);
      entry.credentialRevision = credential.credentialRevision;
      entry.profileId = prepared.input.profileId;
      entry.profileIdentity = schema.profileIdentity(prepared.profile);
      entry.providerBaseUrl = prepared.endpoint.baseUrl;
      if (entry.capabilityProbe) {
        entry.capabilityProbeIdentity = capabilityProbeIdentity(prepared);
        var claim = await profileStore.beginCapabilityProbe(
          prepared.input.profileId,
          entry.capabilityProbeIdentity,
          entry.credentialRevision,
        );
        if (claim && claim.replayed === true && claim.evidence) {
          var replayedEvidence = schema.normalizeEvidence(
            claim.evidence,
            entry.capabilityProbeIdentity.profileIdentity,
            new Date(now()),
          );
          if (replayedEvidence.operation !== OPERATION
            || replayedEvidence.requestMode !== REQUEST_MODE
            || replayedEvidence.policyRevision !== prepared.binding.policyRevision) {
            throw clientError(
              'SS_ERP_BYOK_PROVIDER_CAPABILITY_UNAVAILABLE',
              'Stored Provider capability evidence is unavailable',
              'FAILED_RETRYABLE',
            );
          }
          credential = null;
          return {
            contractVersion: schema.CAPABILITY_EVIDENCE_CONTRACT_VERSION,
            outcome: 'CAPABILITY_EVIDENCE_REPLAY',
            profileId: prepared.input.profileId,
            operation: OPERATION,
            requestMode: REQUEST_MODE,
            policyRevision: prepared.binding.policyRevision,
            idempotencyKey: prepared.input.idempotencyKey,
            requestHash: prepared.requestHash,
            evidence: replayedEvidence,
          };
        }
        entry.capabilityProbeClaimed = true;
      } else {
        await claimExecutionIntent(entry, prepared);
        await persistProviderDispatch(entry, prepared);
      }
      var apiKey = credential.apiKey;
      credential = null;
      var deadline = Date.now() + timeoutMs;
      entry.dispatched = true;
      entry.status = 'SUBMITTING';
      var response;
      try {
        response = await fetchWithDeadline(fetchImpl, prepared.endpoint.endpoint, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            Authorization: 'Bearer ' + apiKey,
            'Content-Type': 'application/json',
            'Idempotency-Key': prepared.input.idempotencyKey,
          },
          body: prepared.body,
          credentials: 'omit',
          redirect: 'error',
          cache: 'no-store',
          referrerPolicy: 'no-referrer',
        }, deadline);
      } catch (error) {
        throw unknownOutcome(error, null);
      } finally {
        apiKey = null;
      }
      entry.responseReceived = true;
      if (!response || !Number.isSafeInteger(Number(response.status))) {
        throw unknownOutcome(
          clientError('SS_ERP_BYOK_PROVIDER_RESPONSE_INVALID', 'Provider response is invalid'),
          null,
        );
      }
      var headerRequestId = providerRequestId(response, null);
      var headerRequestIdSha256 = headerRequestId
        ? await sha256Bytes(cryptoImpl, headerRequestId)
        : null;
      headerRequestId = null;
      if (!response.ok) {
        var status = Number(response.status);
        cancelResponseBody(response);
        throw clientError(
          'SS_ERP_BYOK_PROVIDER_HTTP_FAILED',
          'Provider request failed with HTTP ' + status,
          httpOutcome(status),
          { status: status, providerRequestIdSha256: headerRequestIdSha256 },
        );
      }
      var body;
      try {
        body = await readJson(response, deadline);
      } catch (error) {
        throw unknownOutcome(error, headerRequestIdSha256);
      }
      var requestId = providerRequestId(response, body);
      var providerRequestIdSha256 = requestId
        ? await sha256Bytes(cryptoImpl, requestId)
        : headerRequestIdSha256;
      requestId = null;
      var image;
      try {
        image = await normalizeImageResult(prepared, response, body, deadline);
      } catch (error) {
        throw unknownOutcome(error, providerRequestIdSha256);
      }
      body = null;
      var resultHash = await sha256Bytes(cryptoImpl, image.bytes);
      try {
        await assertCompletedResultAuthority(entry, prepared);
      } catch (error) {
        error.providerRequestIdSha256 = providerRequestIdSha256;
        throw error;
      }
      entry.providerRequestIdSha256 = providerRequestIdSha256;
      entry.resultSha256 = resultHash;
      var acceptedAt;
      try {
        acceptedAt = new Date(now());
        if (!Number.isFinite(acceptedAt.getTime())) throw new Error('clock invalid');
      } catch {
        acceptedAt = new Date();
      }
      var result = {
        contractVersion: CONTRACT_VERSION,
        outcome: 'SUCCEEDED',
        operation: OPERATION,
        requestMode: REQUEST_MODE,
        profileId: prepared.input.profileId,
        profileIdentity: schema.profileIdentity(prepared.profile),
        providerOrigin: prepared.endpoint.providerOrigin,
        model: prepared.profile.model,
        policyRevision: prepared.binding.policyRevision,
        executionIntentId: entry.executionIntentId,
        idempotencyKey: prepared.input.idempotencyKey,
        requestHash: prepared.requestHash,
        promptHash: prepared.promptHash,
        negativePromptHash: prepared.negativePromptHash,
        endpointHash: prepared.endpointHash,
        providerRequestIdSha256: providerRequestIdSha256,
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
      if (!entry.capabilityProbe) {
        result = await stageCompletedResultWithAuthority(
          entry,
          prepared,
          result,
          providerRequestIdSha256,
        );
        try {
          await reportExecutionOutcome(entry, prepared, 'SUCCEEDED');
        } catch (error) {
          throw unknownOutcome(error, providerRequestIdSha256);
        }
      }
      return result;
    }

    async function runPrepared(prepared, capabilityProbe) {
      var idempotencyKey = prepared.input.idempotencyKey;
      var existing = operations.get(idempotencyKey);
      if (existing) {
        if (existing.requestHash !== prepared.requestHash) {
          throw clientError(
            'SS_ERP_BYOK_PROVIDER_IDEMPOTENCY_CONFLICT',
            'The idempotency key is already bound to a different Provider request',
            'FAILED_FINAL',
          );
        }
        if (existing.status === 'SUCCEEDED') {
          if (existing.resultReleased) throw releasedResultError();
          return existing.result;
        }
        if (existing.error) throw replayError(existing.error, true);
        return existing.promise;
      }
      if (operations.size >= MAX_OPERATION_COUNT) {
        throw clientError(
          'SS_ERP_BYOK_PROVIDER_OPERATION_LIMIT',
          'Too many Provider operations are retained in this browser session',
          'FAILED_RETRYABLE',
        );
      }

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
        executionIntentId: null,
        executionIntentOutcomeReported: null,
        providerRequestIdSha256: null,
        resultSha256: null,
        capabilityProbe: capabilityProbe === true,
        capabilityProbeClaimed: false,
        capabilityProbeIdentity: null,
        error: null,
        promise: null,
      };
      operations.set(idempotencyKey, entry);
      entry.promise = (async function () {
        var ownsConcurrencySlot = false;
        try {
          if (activeOperationKey && activeOperationKey !== idempotencyKey) {
            throw clientError(
              'SS_ERP_BYOK_PROVIDER_CONCURRENCY_LIMIT',
              'The first BYOK release permits one active Provider request',
              'FAILED_RETRYABLE',
            );
          }
          activeOperationKey = idempotencyKey;
          ownsConcurrencySlot = true;
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
                  prepared.input.profileId,
                  entry.capabilityProbeIdentity,
                  entry.credentialRevision,
                );
              } catch (_cleanupError) {
                // A retained PENDING guard fails closed on the next worker.
              }
            }
            if (!entry.capabilityProbe && entry.executionIntentId
              && (!error || error.outcome !== 'UNKNOWN_OUTCOME')) {
              try {
                entry.providerRequestIdSha256 = null;
                entry.resultSha256 = null;
                await reportExecutionOutcome(entry, prepared, 'FAILED_FINAL');
              } catch (reportError) {
                var unresolved = undispatchedIntentOutcomeUnresolved(error, reportError);
                entry.status = unresolved.outcome;
                entry.outcome = unresolved.outcome;
                entry.error = snapshotError(unresolved);
                throw replayError(entry.error, false);
              }
            }
            operations.delete(idempotencyKey);
            throw error;
          }
          var safeError = error && error.outcome
            ? error
            : unknownOutcome(error, null);
          await reportFailureBestEffort(entry, prepared, safeError);
          entry.status = safeError.outcome;
          entry.outcome = safeError.outcome;
          entry.error = snapshotError(safeError);
          if (entry.capabilityProbeClaimed) {
            try {
              if (safeError.outcome === 'UNKNOWN_OUTCOME') {
                await profileStore.markCapabilityProbeUncertain(
                  prepared.input.profileId,
                  entry.capabilityProbeIdentity,
                  entry.credentialRevision,
                );
              } else {
                await profileStore.discardPendingCapabilityProbe(
                  prepared.input.profileId,
                  entry.capabilityProbeIdentity,
                  entry.credentialRevision,
                );
              }
            } catch (_guardError) {
              // PENDING is itself fail-closed if final state persistence is interrupted.
            }
          }
          throw replayError(entry.error, false);
        } finally {
          if (ownsConcurrencySlot && activeOperationKey === idempotencyKey) {
            activeOperationKey = null;
          }
        }
      })();
      return entry.promise;
    }

    async function run(value, requireCapabilityEvidence, capabilityProbe) {
      return runPrepared(
        await prepare(value, requireCapabilityEvidence),
        capabilityProbe,
      );
    }

    async function prepareDispatch(value) {
      if (preparedRequests.size + preparingRequestCount >= MAX_PREPARED_REQUEST_COUNT) {
        throw clientError(
          'SS_ERP_BYOK_PROVIDER_PREPARED_REQUEST_LIMIT',
          'Too many Provider requests are waiting for reservation',
          'FAILED_RETRYABLE',
        );
      }
      preparingRequestCount += 1;
      try {
        var prepared = await prepare(value, true);
        var handle = newPreparedRequestHandle();
        while (preparedRequests.has(handle) || consumedPreparedHandles.has(handle)) {
          handle = newPreparedRequestHandle();
        }
        preparedRequests.set(handle, prepared);
        return Object.freeze({
          contractVersion: PREPARED_REQUEST_CONTRACT_VERSION,
          preparedRequestHandle: handle,
          operation: OPERATION,
          requestMode: REQUEST_MODE,
          providerIdempotencyKey: prepared.input.idempotencyKey,
          providerRequestHash: prepared.requestHash,
        });
      } finally {
        preparingRequestCount -= 1;
      }
    }

    async function dispatchPrepared(value) {
      var handle = normalizedPreparedRequestHandle(value);
      if (consumedPreparedHandles.has(handle)) {
        throw preparedRequestError(
          'SS_ERP_BYOK_PROVIDER_PREPARED_REQUEST_CONSUMED',
          'Prepared Provider request was already consumed',
          'UNKNOWN_OUTCOME',
        );
      }
      var prepared = preparedRequests.get(handle);
      if (!prepared) {
        throw preparedRequestError(
          'SS_ERP_BYOK_PROVIDER_PREPARED_REQUEST_UNAVAILABLE',
          'Prepared Provider request is unavailable',
          'FAILED_FINAL',
        );
      }
      preparedRequests.delete(handle);
      rememberConsumedPreparedHandle(handle);
      return runPrepared(prepared, false);
    }

    function releasePrepared(value) {
      var handle = normalizedPreparedRequestHandle(value);
      return { released: preparedRequests.delete(handle) };
    }

    async function generate(value) {
      return run(value, true, false);
    }

    async function commitResult(idempotencyKeyValue, requestHash, commit) {
      var idempotencyKey = normalizedId(idempotencyKeyValue, 'idempotencyKey');
      if (typeof requestHash !== 'string' || !/^[a-f0-9]{64}$/u.test(requestHash)
        || typeof commit !== 'function') {
        throw clientError(
          'SS_ERP_BYOK_PROVIDER_IDEMPOTENCY_CONFLICT',
          'Provider result commit identity is invalid',
          'FAILED_FINAL',
        );
      }
      var entry = operations.get(idempotencyKey);
      if (!entry || entry.requestHash !== requestHash || entry.status !== 'SUCCEEDED'
        || !entry.result || entry.resultReleased) {
        if (entry && entry.resultReleased) throw releasedResultError();
        throw clientError(
          'SS_ERP_BYOK_PROVIDER_IDEMPOTENCY_CONFLICT',
          'Provider result commit identity does not match',
          'FAILED_FINAL',
        );
      }
      var commitStarted = false;
      try {
        return await permissionBroker.commitWithOriginPermission(
          entry.providerBaseUrl,
          function () {
            return profileStore.commitWithCredentialRevisionForBackground(
              entry.profileId,
              entry.profileIdentity,
              entry.credentialRevision,
              function () {
                commitStarted = true;
                return commit(entry.result);
              },
            );
          },
        );
      } catch (error) {
        if (commitStarted) throw error;
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
        automaticRetryAllowed: entry.error && entry.error.automaticRetryAllowed === false
          ? false
          : null,
        providerHttpStatus: entry.error && Number.isSafeInteger(entry.error.status)
          ? entry.error.status
          : null,
        executionIntentId: entry.executionIntentId,
        providerRequestIdSha256: entry.error && entry.error.providerRequestIdSha256 || null,
        image: null,
      };
      if (entry.result && entry.result.image) {
        state.providerRequestIdSha256 = entry.result.providerRequestIdSha256;
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
      if (typeof requestHash !== 'string' || !/^[a-f0-9]{64}$/u.test(requestHash)) {
        throw clientError(
          'SS_ERP_BYOK_PROVIDER_IDEMPOTENCY_CONFLICT',
          'Provider result release identity is invalid',
          'FAILED_FINAL',
        );
      }
      var entry = operations.get(idempotencyKey);
      if (!entry || entry.requestHash !== requestHash || entry.status !== 'SUCCEEDED' || !entry.result) {
        throw clientError(
          'SS_ERP_BYOK_PROVIDER_IDEMPOTENCY_CONFLICT',
          'Provider result release identity does not match',
          'FAILED_FINAL',
        );
      }
      var released = !entry.resultReleased;
      entry.resultReleased = true;
      entry.result.image.blob = null;
      return { released: released, outcome: 'SUCCEEDED' };
    }

    async function probe(value) {
      var result = await run(value, false, true);
      if (result.outcome === 'CAPABILITY_EVIDENCE_REPLAY') {
        return {
          contractVersion: schema.CAPABILITY_EVIDENCE_CONTRACT_VERSION,
          profileId: result.profileId,
          operation: OPERATION,
          requestMode: REQUEST_MODE,
          policyRevision: result.policyRevision,
          evidence: result.evidence,
        };
      }
      var verifiedAt = new Date(result.acceptedAt);
      var evidence = {
        contractVersion: schema.CAPABILITY_EVIDENCE_CONTRACT_VERSION,
        profileIdentity: result.profileIdentity,
        operation: OPERATION,
        requestMode: REQUEST_MODE,
        policyRevision: result.policyRevision,
        verifiedAt: verifiedAt.toISOString(),
        expiresAt: new Date(verifiedAt.getTime() + CAPABILITY_EVIDENCE_TTL_MS).toISOString(),
      };
      try {
        var operation = operations.get(result.idempotencyKey);
        var expectedCredentialRevision = operation && operation.credentialRevision;
        var storedEvidence;
        try {
          storedEvidence = await permissionBroker.commitWithOriginPermission(
            result.providerOrigin,
            function () {
              return profileStore.setCapabilityEvidence(
                result.profileId,
                evidence,
                expectedCredentialRevision,
                operation && operation.capabilityProbeIdentity,
              );
            },
          );
        } catch (error) {
          throw resultAuthorityStale(error);
        }
        return {
          contractVersion: schema.CAPABILITY_EVIDENCE_CONTRACT_VERSION,
          profileId: result.profileId,
          operation: OPERATION,
          requestMode: REQUEST_MODE,
          policyRevision: result.policyRevision,
          evidence: storedEvidence,
        };
      } finally {
        releaseResult(result.idempotencyKey, result.requestHash);
      }
    }

    return Object.freeze({
      generate: generate,
      prepareDispatch: prepareDispatch,
      dispatchPrepared: dispatchPrepared,
      releasePrepared: releasePrepared,
      commitResult: commitResult,
      probe: probe,
      getOperationState: getOperationState,
      releaseResult: releaseResult,
    });
  }

  global.SS_ERP_BYOK_TEXT_TO_IMAGE_CLIENT = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    PREPARED_REQUEST_CONTRACT_VERSION: PREPARED_REQUEST_CONTRACT_VERSION,
    OPERATION: OPERATION,
    REQUEST_MODE: REQUEST_MODE,
    LIMITS: Object.freeze({
      maxRequestBytes: MAX_REQUEST_BYTES,
      maxResultBytes: MAX_RESULT_BYTES,
      maxJsonBytes: MAX_JSON_BYTES,
      maxPromptCharacters: MAX_PROMPT_CHARACTERS,
      maxNegativePromptCharacters: MAX_NEGATIVE_PROMPT_CHARACTERS,
      maxDimension: MAX_DIMENSION,
      maxPixels: MAX_PIXELS,
      maxConcurrency: MAX_CONCURRENCY,
      providerTimeoutMs: DEFAULT_TIMEOUT_MS,
    }),
    createClient: createClient,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
