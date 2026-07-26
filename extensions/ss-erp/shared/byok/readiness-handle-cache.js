(function exposeByokReadinessHandleCache(global) {
  'use strict';

  var ATTESTATION_VERSION = 'extension-byok-readiness-attestation/v2';
  var BINDING_VERSION = 'extension-byok-readiness-binding/v2';
  var VERIFICATION_VERSION = 'extension-byok-readiness-verification/v2';
  var MAX_TTL_MS = 10 * 60 * 1000;
  var MAX_ENTRIES = 64;
  var BINDING_KEYS = [
    'contractVersion', 'ownerUserId', 'deviceSessionId', 'shopId', 'workflowId',
    'draftRevision', 'draftVersion', 'sourcePlatform', 'sourceProductId',
    'sourceCaptureSnapshotId', 'supplyGoodsId', 'skuKey', 'slotKey',
    'assignmentMode', 'assignmentOrdinal', 'providerOrigin', 'model', 'operation',
    'policyRevision',
  ];

  function cacheError(code) {
    var error = new Error(code);
    error.code = code;
    return error;
  }

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function exactKeys(value, keys) {
    return isRecord(value)
      && Object.keys(value).length === keys.length
      && Object.keys(value).every(function (key) { return keys.includes(key); });
  }

  function text(value, maximum) {
    if (typeof value !== 'string') throw cacheError('SS_ERP_BYOK_READINESS_INVALID');
    var normalized = value.normalize('NFKC').trim();
    if (!normalized || normalized !== value || normalized.length > maximum
      || /[\u0000-\u001f\u007f]/u.test(normalized)) {
      throw cacheError('SS_ERP_BYOK_READINESS_INVALID');
    }
    return normalized;
  }

  function nullableText(value) {
    return value === null ? null : text(value, 200);
  }

  function nullablePositiveInteger(value) {
    if (value === null) return null;
    if (!Number.isSafeInteger(value) || value < 1) {
      throw cacheError('SS_ERP_BYOK_READINESS_INVALID');
    }
    return value;
  }

  function nullableOrdinal(value) {
    if (value === null) return null;
    if (!Number.isSafeInteger(value) || value < 0 || value > 499) {
      throw cacheError('SS_ERP_BYOK_READINESS_INVALID');
    }
    return value;
  }

  function providerOrigin(value) {
    var parsed;
    try {
      parsed = new URL(text(value, 300));
    } catch (_error) {
      throw cacheError('SS_ERP_BYOK_READINESS_INVALID');
    }
    if (parsed.protocol !== 'https:' || parsed.origin !== value || parsed.pathname !== '/'
      || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw cacheError('SS_ERP_BYOK_READINESS_INVALID');
    }
    return parsed.origin;
  }

  function normalizeBinding(value) {
    if (!exactKeys(value, BINDING_KEYS) || value.contractVersion !== BINDING_VERSION) {
      throw cacheError('SS_ERP_BYOK_READINESS_INVALID');
    }
    var workflowId = nullableText(value.workflowId);
    var draftRevision = nullablePositiveInteger(value.draftRevision);
    var draftVersion = nullablePositiveInteger(value.draftVersion);
    var sourcePlatform = nullableText(value.sourcePlatform);
    var sourceProductId = nullableText(value.sourceProductId);
    var sourceCaptureSnapshotId = nullableText(value.sourceCaptureSnapshotId);
    var supplyGoodsId = nullableText(value.supplyGoodsId);
    var skuKey = value.skuKey === null ? null : text(value.skuKey, 500);
    var slotKey = nullableText(value.slotKey);
    var assignmentMode = nullableText(value.assignmentMode);
    var assignmentOrdinal = nullableOrdinal(value.assignmentOrdinal);
    var draftContext = [
      workflowId, draftRevision, draftVersion, sourcePlatform, sourceProductId,
      sourceCaptureSnapshotId, supplyGoodsId, skuKey, slotKey, assignmentMode,
      assignmentOrdinal,
    ];
    if (draftContext.some(function (item) { return item === null; })
      && draftContext.some(function (item) { return item !== null; })) {
      throw cacheError('SS_ERP_BYOK_READINESS_INVALID');
    }
    if (workflowId !== null && (!['1688', 'pdd', 'taobao', 'tmall'].includes(sourcePlatform)
      || assignmentMode !== 'APPEND'
      || slotKey !== 'sku:' + skuKey + ':hero')) {
      throw cacheError('SS_ERP_BYOK_READINESS_INVALID');
    }
    var operation = text(value.operation, 64);
    if (!['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'].includes(operation)) {
      throw cacheError('SS_ERP_BYOK_READINESS_INVALID');
    }
    return Object.freeze({
      contractVersion: BINDING_VERSION,
      ownerUserId: text(value.ownerUserId, 200),
      deviceSessionId: text(value.deviceSessionId, 200),
      shopId: text(value.shopId, 200),
      workflowId: workflowId,
      draftRevision: draftRevision,
      draftVersion: draftVersion,
      sourcePlatform: sourcePlatform,
      sourceProductId: sourceProductId,
      sourceCaptureSnapshotId: sourceCaptureSnapshotId,
      supplyGoodsId: supplyGoodsId,
      skuKey: skuKey,
      slotKey: slotKey,
      assignmentMode: assignmentMode,
      assignmentOrdinal: assignmentOrdinal,
      providerOrigin: providerOrigin(value.providerOrigin),
      model: text(value.model, 200),
      operation: operation,
      policyRevision: text(value.policyRevision, 200),
    });
  }

  function sameBinding(left, right) {
    var normalized = normalizeBinding(right);
    return BINDING_KEYS.every(function (key) { return left[key] === normalized[key]; });
  }

  function createHandle(randomValues) {
    var bytes = new Uint8Array(24);
    randomValues(bytes);
    return 'rh_' + Array.from(bytes).map(function (byte) {
      return byte.toString(16).padStart(2, '0');
    }).join('');
  }

  function createCache(options) {
    var now = options && options.now || function () { return new Date(); };
    var randomValues = options && options.randomValues
      || function (bytes) { return global.crypto.getRandomValues(bytes); };
    var entries = new Map();
    var verified = new Map();

    function nowMillis() {
      var value = new Date(now()).getTime();
      if (!Number.isFinite(value)) throw cacheError('SS_ERP_BYOK_READINESS_INVALID');
      return value;
    }

    function prune(current) {
      [entries, verified].forEach(function (store) {
        store.forEach(function (entry, handle) {
          if (entry.expiresAtMillis <= current) store.delete(handle);
        });
      });
      while (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value);
      while (verified.size >= MAX_ENTRIES) verified.delete(verified.keys().next().value);
    }

    function issue(attestation) {
      if (!exactKeys(attestation, ['contractVersion', 'authenticated', 'expiresAt', 'binding', 'decision'])
        || attestation.contractVersion !== ATTESTATION_VERSION
        || attestation.authenticated !== true) {
        throw cacheError('SS_ERP_BYOK_READINESS_INVALID');
      }
      var current = nowMillis();
      var expiresAtMillis = Date.parse(text(attestation.expiresAt, 64));
      if (!Number.isFinite(expiresAtMillis) || expiresAtMillis <= current
        || expiresAtMillis - current > MAX_TTL_MS) {
        throw cacheError('SS_ERP_BYOK_READINESS_INVALID');
      }
      var binding = normalizeBinding(attestation.binding);
      var decision = attestation.decision;
      if (!exactKeys(decision, ['allowed', 'providerOrigin', 'policyRevision'])
        || decision.allowed !== true
        || providerOrigin(decision.providerOrigin) !== binding.providerOrigin
        || !Number.isSafeInteger(decision.policyRevision)
        || decision.policyRevision < 0
        || String(decision.policyRevision) !== binding.policyRevision) {
        throw cacheError('SS_ERP_BYOK_READINESS_INVALID');
      }
      prune(current);
      var handle = createHandle(randomValues);
      if (entries.has(handle) || verified.has(handle)) {
        throw cacheError('SS_ERP_BYOK_READINESS_COLLISION');
      }
      entries.set(handle, {
        binding: binding,
        decision: Object.freeze({
          allowed: true,
          providerOrigin: binding.providerOrigin,
          policyRevision: decision.policyRevision,
        }),
        expiresAt: new Date(expiresAtMillis).toISOString(),
        expiresAtMillis: expiresAtMillis,
      });
      return Object.freeze({
        readinessHandle: handle,
        readinessBinding: binding,
        expiresAt: new Date(expiresAtMillis).toISOString(),
      });
    }

    function consume(input) {
      var current = nowMillis();
      prune(current);
      var handle = text(input && input.handle, 128);
      var entry = entries.get(handle);
      entries.delete(handle);
      if (!entry || entry.expiresAtMillis <= current
        || !sameBinding(entry.binding, input.expectedBinding)) {
        throw cacheError('SS_ERP_BYOK_READINESS_UNAVAILABLE');
      }
      verified.set(handle, entry);
      return {
        contractVersion: VERIFICATION_VERSION,
        authenticated: true,
        handleId: handle,
        expiresAt: entry.expiresAt,
        binding: entry.binding,
      };
    }

    function createPermissionBridge(verification) {
      var handle = text(verification && verification.handleId, 128);
      var used = false;
      return Object.freeze({
        consume: function (candidateHandle, binding, expectedOrigin) {
          if (used) throw cacheError('SS_ERP_BYOK_READINESS_UNAVAILABLE');
          used = true;
          var entry = verified.get(handle);
          verified.delete(handle);
          if (!entry
            || candidateHandle !== handle
            || entry.expiresAtMillis <= nowMillis()
            || !sameBinding(entry.binding, binding)
            || entry.binding.providerOrigin !== providerOrigin(expectedOrigin)) {
            throw cacheError('SS_ERP_BYOK_READINESS_UNAVAILABLE');
          }
          return entry.decision;
        },
      });
    }

    function clear() {
      entries.clear();
      verified.clear();
    }

    return Object.freeze({
      issue: issue,
      consume: consume,
      createPermissionBridge: createPermissionBridge,
      clear: clear,
      size: function () { return entries.size + verified.size; },
    });
  }

  global.SS_ERP_BYOK_READINESS_HANDLE_CACHE = Object.freeze({
    ATTESTATION_VERSION: ATTESTATION_VERSION,
    BINDING_VERSION: BINDING_VERSION,
    VERIFICATION_VERSION: VERIFICATION_VERSION,
    MAX_TTL_MS: MAX_TTL_MS,
    createCache: createCache,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
