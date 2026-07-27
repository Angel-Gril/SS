(function exposeByokExecutionIntentClaimBroker(global) {
  'use strict';

  var CONTRACT_VERSION = 'extension-byok-execution-intent-claim-broker/v1';
  var BINDING_VERSION = 'extension-byok-readiness-binding/v2';
  var INTENT_VERSION = 'extension-byok-execution-intent/v1';
  var OPERATIONS = ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'];
  var REQUEST_MODES = ['json', 'multipart'];
  var MAX_BATCH_CLAIMS = 500;
  var BINDING_KEYS = [
    'contractVersion', 'ownerUserId', 'deviceSessionId', 'shopId', 'workflowId',
    'draftRevision', 'draftVersion', 'sourcePlatform', 'sourceProductId',
    'sourceCaptureSnapshotId', 'supplyGoodsId', 'skuKey', 'slotKey',
    'assignmentMode', 'assignmentOrdinal', 'providerOrigin', 'model', 'operation',
    'policyRevision',
  ];
  var CLAIM_KEYS = [
    'readinessBinding', 'requestMode', 'providerIdempotencyKey', 'providerRequestHash',
  ];
  var INTENT_KEYS = [
    'contractVersion', 'intentId', 'replayed', 'executionMode', 'outcome',
    'providerIdempotencyKey', 'providerRequestHash', 'context',
  ];
  var CONTEXT_KEYS = [
    'shopId', 'workflowId', 'draftRevision', 'draftVersion', 'skuKey', 'slotKey',
  ];

  function brokerError(code, outcome) {
    var error = new Error(code);
    error.name = 'ExtensionByokExecutionIntentClaimBrokerError';
    error.code = code;
    error.outcome = outcome || 'FAILED_FINAL';
    error.automaticRetryAllowed = false;
    return error;
  }

  function invalid() {
    throw brokerError('SS_ERP_BYOK_EXECUTION_INTENT_RESERVATION_INVALID', 'FAILED_FINAL');
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
    if (typeof value !== 'string' || !value || value.length > maximum
      || value !== value.normalize('NFKC').trim()
      || /[\u0000-\u001f\u007f]/u.test(value)) invalid();
    return value;
  }

  function identifier(value, maximum) {
    var normalized = text(value, maximum || 200);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u.test(normalized)) invalid();
    return normalized;
  }

  function sha256(value) {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) invalid();
    return value;
  }

  function positiveInteger(value) {
    if (!Number.isSafeInteger(value) || value < 1) invalid();
    return value;
  }

  function ordinal(value) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 499) invalid();
    return value;
  }

  function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (isRecord(value)) {
      return Object.fromEntries(Object.entries(value).map(function (entry) {
        return [entry[0], clone(entry[1])];
      }));
    }
    return value;
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }

  function normalizeOrigin(value) {
    var normalized = text(value, 300);
    var parsed;
    try { parsed = new global.URL(normalized); } catch { invalid(); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password
      || parsed.search || parsed.hash || parsed.pathname !== '/'
      || parsed.origin !== normalized) invalid();
    return normalized;
  }

  function normalizeBinding(value) {
    if (!exactKeys(value, BINDING_KEYS) || value.contractVersion !== BINDING_VERSION
      || !['1688', 'pdd', 'taobao', 'tmall'].includes(value.sourcePlatform)
      || value.assignmentMode !== 'APPEND' || !OPERATIONS.includes(value.operation)) invalid();
    var result = {
      contractVersion: BINDING_VERSION,
      ownerUserId: text(value.ownerUserId, 200),
      deviceSessionId: text(value.deviceSessionId, 200),
      shopId: text(value.shopId, 200),
      workflowId: text(value.workflowId, 200),
      draftRevision: positiveInteger(value.draftRevision),
      draftVersion: positiveInteger(value.draftVersion),
      sourcePlatform: value.sourcePlatform,
      sourceProductId: text(value.sourceProductId, 200),
      sourceCaptureSnapshotId: text(value.sourceCaptureSnapshotId, 200),
      supplyGoodsId: text(value.supplyGoodsId, 200),
      skuKey: text(value.skuKey, 500),
      slotKey: text(value.slotKey, 200),
      assignmentMode: 'APPEND',
      assignmentOrdinal: ordinal(value.assignmentOrdinal),
      providerOrigin: normalizeOrigin(value.providerOrigin),
      model: text(value.model, 200),
      operation: value.operation,
      policyRevision: text(value.policyRevision, 200),
    };
    if (result.slotKey !== 'sku:' + result.skuKey + ':hero'
      && !['SCENE', 'DETAIL', 'SPEC', 'PACKAGING'].some(function (role) {
        return result.slotKey === 'shared:detail:' + role;
      })) invalid();
    return result;
  }

  function normalizeClaim(value) {
    if (!exactKeys(value, CLAIM_KEYS) || !REQUEST_MODES.includes(value.requestMode)) invalid();
    var binding = normalizeBinding(value.readinessBinding);
    if (value.requestMode !== (binding.operation === 'TEXT_TO_IMAGE' ? 'json' : 'multipart')) {
      invalid();
    }
    var providerIdempotencyKey = identifier(value.providerIdempotencyKey, 200);
    if (providerIdempotencyKey.length < 16) invalid();
    return {
      readinessBinding: binding,
      requestMode: value.requestMode,
      providerIdempotencyKey: providerIdempotencyKey,
      providerRequestHash: sha256(value.providerRequestHash),
    };
  }

  function normalizeIntent(value, claim) {
    if (!exactKeys(value, INTENT_KEYS) || value.contractVersion !== INTENT_VERSION
      || value.executionMode !== 'BYOK' || typeof value.replayed !== 'boolean'
      || !['PENDING', 'SUCCEEDED', 'FAILED_FINAL', 'UNKNOWN_OUTCOME'].includes(value.outcome)
      || !exactKeys(value.context, CONTEXT_KEYS)) invalid();
    var context = {
      shopId: text(value.context.shopId, 200),
      workflowId: text(value.context.workflowId, 200),
      draftRevision: positiveInteger(value.context.draftRevision),
      draftVersion: positiveInteger(value.context.draftVersion),
      skuKey: text(value.context.skuKey, 500),
      slotKey: text(value.context.slotKey, 200),
    };
    var binding = claim.readinessBinding;
    if (value.providerIdempotencyKey !== claim.providerIdempotencyKey
      || value.providerRequestHash !== claim.providerRequestHash
      || context.shopId !== binding.shopId || context.workflowId !== binding.workflowId
      || context.draftRevision !== binding.draftRevision
      || context.draftVersion !== binding.draftVersion
      || context.skuKey !== binding.skuKey || context.slotKey !== binding.slotKey) invalid();
    return deepFreeze({
      contractVersion: INTENT_VERSION,
      intentId: identifier(value.intentId, 200),
      replayed: value.replayed,
      executionMode: 'BYOK',
      outcome: value.outcome,
      providerIdempotencyKey: claim.providerIdempotencyKey,
      providerRequestHash: claim.providerRequestHash,
      context: context,
    });
  }

  function claimKey(value) {
    return value.providerIdempotencyKey + '\u0000' + value.providerRequestHash;
  }

  function sameClaim(left, right) {
    return left.requestMode === right.requestMode
      && BINDING_KEYS.every(function (key) {
        return left.readinessBinding[key] === right.readinessBinding[key];
      });
  }

  function createBroker(options) {
    var fallback = options && options.fallback;
    if (!fallback || typeof fallback.claim !== 'function'
      || typeof fallback.reportOutcome !== 'function') {
      throw brokerError('SS_ERP_BYOK_EXECUTION_INTENT_BROKER_UNAVAILABLE', 'FAILED_FINAL');
    }
    var claims = new Map();
    var batches = new Map();
    var reservedIdempotencyKeys = new Map();
    var reservedRequestHashes = new Map();

    function storeReservedClaim(executionBatchId, entry) {
      if (claims.has(entry.key)
        || reservedIdempotencyKeys.has(entry.claim.providerIdempotencyKey)
        || reservedRequestHashes.has(entry.claim.providerRequestHash)) {
        throw brokerError('SS_ERP_BYOK_EXECUTION_INTENT_RESERVATION_CONFLICT', 'FAILED_FINAL');
      }
      claims.set(entry.key, {
        executionBatchId: executionBatchId,
        claim: entry.claim,
        intent: entry.intent,
        consumed: false,
      });
      reservedIdempotencyKeys.set(entry.claim.providerIdempotencyKey, entry.key);
      reservedRequestHashes.set(entry.claim.providerRequestHash, entry.key);
    }

    function registerBatch(value) {
      if (!exactKeys(value, ['executionBatchId', 'claims'])
        || !Array.isArray(value.claims) || value.claims.length < 1 || value.claims.length > 4) {
        invalid();
      }
      var executionBatchId = identifier(value.executionBatchId, 200);
      if (batches.has(executionBatchId)) {
        throw brokerError('SS_ERP_BYOK_EXECUTION_INTENT_RESERVATION_CONFLICT', 'FAILED_FINAL');
      }
      var normalized = value.claims.map(function (entry) {
        if (!exactKeys(entry, ['readinessBinding', 'requestMode', 'intent'])) invalid();
        var claim = normalizeClaim({
          readinessBinding: entry.readinessBinding,
          requestMode: entry.requestMode,
          providerIdempotencyKey: entry.intent && entry.intent.providerIdempotencyKey,
          providerRequestHash: entry.intent && entry.intent.providerRequestHash,
        });
        return {
          key: claimKey(claim),
          claim: claim,
          intent: normalizeIntent(entry.intent, claim),
        };
      });
      var keys = normalized.map(function (entry) { return entry.key; });
      var uniqueIdentities = [
        keys,
        normalized.map(function (entry) { return entry.claim.providerIdempotencyKey; }),
        normalized.map(function (entry) { return entry.claim.providerRequestHash; }),
      ].every(function (values) { return new Set(values).size === values.length; });
      if (!uniqueIdentities || normalized.some(function (entry) {
        return claims.has(entry.key)
          || reservedIdempotencyKeys.has(entry.claim.providerIdempotencyKey)
          || reservedRequestHashes.has(entry.claim.providerRequestHash);
      })) {
        throw brokerError('SS_ERP_BYOK_EXECUTION_INTENT_RESERVATION_CONFLICT', 'FAILED_FINAL');
      }
      normalized.forEach(function (entry) {
        storeReservedClaim(executionBatchId, entry);
      });
      batches.set(executionBatchId, keys);
      return Object.freeze({ executionBatchId: executionBatchId, claimCount: keys.length });
    }

    function registerAttempt(value) {
      if (!exactKeys(value, [
        'executionBatchId', 'readinessBinding', 'requestMode', 'intent',
      ])) invalid();
      var executionBatchId = identifier(value.executionBatchId, 200);
      var keys = batches.get(executionBatchId);
      if (!keys || keys.length >= MAX_BATCH_CLAIMS) {
        throw brokerError('SS_ERP_BYOK_EXECUTION_INTENT_RESERVATION_CONFLICT', 'FAILED_FINAL');
      }
      var claim = normalizeClaim({
        readinessBinding: value.readinessBinding,
        requestMode: value.requestMode,
        providerIdempotencyKey: value.intent && value.intent.providerIdempotencyKey,
        providerRequestHash: value.intent && value.intent.providerRequestHash,
      });
      var key = claimKey(claim);
      var intent = normalizeIntent(value.intent, claim);
      storeReservedClaim(executionBatchId, {
        key: key,
        claim: claim,
        intent: intent,
      });
      keys.push(key);
      return Object.freeze({
        executionBatchId: executionBatchId,
        intentId: intent.intentId,
        claimCount: keys.length,
      });
    }

    async function claim(value) {
      var normalized = normalizeClaim(value);
      var key = claimKey(normalized);
      var reserved = claims.get(key);
      if (!reserved) {
        if (reservedIdempotencyKeys.has(normalized.providerIdempotencyKey)
          || reservedRequestHashes.has(normalized.providerRequestHash)) {
          throw brokerError('SS_ERP_BYOK_EXECUTION_INTENT_RESERVATION_MISMATCH', 'FAILED_FINAL');
        }
        return fallback.claim(value);
      }
      if (!sameClaim(reserved.claim, normalized)) {
        throw brokerError('SS_ERP_BYOK_EXECUTION_INTENT_RESERVATION_MISMATCH', 'FAILED_FINAL');
      }
      if (reserved.consumed) {
        throw brokerError('SS_ERP_BYOK_EXECUTION_INTENT_REPLAY_BLOCKED', 'UNKNOWN_OUTCOME');
      }
      reserved.consumed = true;
      return deepFreeze(clone(reserved.intent));
    }

    function releaseBatch(value) {
      var executionBatchId;
      try { executionBatchId = identifier(value, 200); } catch { return false; }
      var keys = batches.get(executionBatchId);
      if (!keys) return false;
      keys.forEach(function (key) {
        var reserved = claims.get(key);
        if (reserved && reserved.executionBatchId === executionBatchId) {
          claims.delete(key);
          reservedIdempotencyKeys.delete(reserved.claim.providerIdempotencyKey);
          reservedRequestHashes.delete(reserved.claim.providerRequestHash);
        }
      });
      batches.delete(executionBatchId);
      return true;
    }

    return Object.freeze({
      registerBatch: registerBatch,
      registerAttempt: registerAttempt,
      releaseBatch: releaseBatch,
      claim: claim,
      reportOutcome: function (value) { return fallback.reportOutcome(value); },
    });
  }

  global.SS_ERP_BYOK_EXECUTION_INTENT_CLAIM_BROKER = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    createBroker: createBroker,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
