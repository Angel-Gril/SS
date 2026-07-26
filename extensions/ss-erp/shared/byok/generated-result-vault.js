(function exposeByokGeneratedResultVault(global) {
  'use strict';

  var CONTRACT_VERSION = 'extension-byok-result-vault/v1';
  var MAX_ENTRIES = 16;
  var MAX_TOTAL_BYTES = 50 * 1024 * 1024;
  var MAX_RESULT_BYTES = 20 * 1024 * 1024;
  var DEFAULT_TTL_MS = 10 * 60 * 1000;
  var MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
  var OPERATIONS = ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'];
  var READINESS_BINDING_VERSION = 'extension-byok-readiness-binding/v2';
  var LIFECYCLE_VERSION = 'extension-byok-device-session-lifecycle/v1';
  var BINDING_KEYS = [
    'contractVersion', 'ownerUserId', 'deviceSessionId', 'shopId', 'workflowId',
    'draftRevision', 'draftVersion', 'sourcePlatform', 'sourceProductId',
    'sourceCaptureSnapshotId', 'supplyGoodsId', 'skuKey', 'slotKey',
    'assignmentMode', 'assignmentOrdinal', 'providerOrigin', 'model', 'operation',
    'policyRevision',
  ];

  function vaultError(code) {
    var error = new Error(code);
    error.code = code;
    return error;
  }

  function text(value, maximum) {
    if (typeof value !== 'string') throw vaultError('SS_ERP_BYOK_RESULT_INVALID');
    var normalized = value.normalize('NFKC').trim();
    if (!normalized || normalized !== value || normalized.length > maximum
      || /[\u0000-\u001f\u007f]/u.test(normalized)) {
      throw vaultError('SS_ERP_BYOK_RESULT_INVALID');
    }
    return normalized;
  }

  function sha256(value) {
    var normalized = text(value, 64);
    if (!/^[a-f0-9]{64}$/u.test(normalized)) throw vaultError('SS_ERP_BYOK_RESULT_INVALID');
    return normalized;
  }

  function nullableSha256(value) {
    return value == null ? null : sha256(value);
  }

  function normalizedEditHashes(result, operation) {
    if (operation === 'TEXT_TO_IMAGE') {
      if (result.sourceSha256 !== undefined || result.referenceSha256s !== undefined
        || result.maskSha256 !== undefined) {
        throw vaultError('SS_ERP_BYOK_RESULT_INVALID');
      }
      return { sourceSha256: null, referenceSha256s: [], maskSha256: null };
    }
    if (!Array.isArray(result.referenceSha256s)) {
      throw vaultError('SS_ERP_BYOK_RESULT_INVALID');
    }
    var references = result.referenceSha256s.map(sha256);
    var sourceSha256 = nullableSha256(result.sourceSha256);
    var maskSha256 = nullableSha256(result.maskSha256);
    if ((operation === 'IMAGE_TO_IMAGE'
      && (sourceSha256 !== null || maskSha256 !== null
        || references.length < 1 || references.length > 4))
      || (operation === 'FULL_EDIT'
        && (!sourceSha256 || maskSha256 !== null || references.length !== 0))
      || (operation === 'INPAINT'
        && (!sourceSha256 || !maskSha256 || references.length !== 0))) {
      throw vaultError('SS_ERP_BYOK_RESULT_INVALID');
    }
    return {
      sourceSha256: sourceSha256,
      referenceSha256s: references,
      maskSha256: maskSha256,
    };
  }

  function positiveInteger(value, maximum) {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
      throw vaultError('SS_ERP_BYOK_RESULT_INVALID');
    }
    return value;
  }

  function assignmentOrdinal(value) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 499) {
      throw vaultError('SS_ERP_BYOK_RESULT_INVALID');
    }
    return value;
  }

  function exactKeys(value, keys) {
    return value && typeof value === 'object' && !Array.isArray(value)
      && Object.keys(value).length === keys.length
      && Object.keys(value).every(function (key) { return keys.includes(key); });
  }

  function normalizeBinding(value) {
    if (!exactKeys(value, BINDING_KEYS)
      || value.contractVersion !== READINESS_BINDING_VERSION) {
      throw vaultError('SS_ERP_BYOK_RESULT_INVALID');
    }
    var skuKey = text(value.skuKey, 500);
    var slotKey = text(value.slotKey, 200);
    if (!['1688', 'pdd', 'taobao', 'tmall'].includes(value.sourcePlatform)
      || value.assignmentMode !== 'APPEND'
      || slotKey !== 'sku:' + skuKey + ':hero') {
      throw vaultError('SS_ERP_BYOK_RESULT_INVALID');
    }
    return Object.freeze({
      contractVersion: READINESS_BINDING_VERSION,
      ownerUserId: text(value.ownerUserId, 200),
      deviceSessionId: text(value.deviceSessionId, 200),
      shopId: text(value.shopId, 200),
      workflowId: text(value.workflowId, 200),
      draftRevision: positiveInteger(value.draftRevision, Number.MAX_SAFE_INTEGER),
      draftVersion: positiveInteger(value.draftVersion, Number.MAX_SAFE_INTEGER),
      sourcePlatform: text(value.sourcePlatform, 16),
      sourceProductId: text(value.sourceProductId, 200),
      sourceCaptureSnapshotId: text(value.sourceCaptureSnapshotId, 200),
      supplyGoodsId: text(value.supplyGoodsId, 200),
      skuKey: skuKey,
      slotKey: slotKey,
      assignmentMode: 'APPEND',
      assignmentOrdinal: assignmentOrdinal(value.assignmentOrdinal),
      providerOrigin: text(value.providerOrigin, 300),
      model: text(value.model, 200),
      operation: text(value.operation, 64),
      policyRevision: text(value.policyRevision, 200),
    });
  }

  function normalizeLifecycleAuthority(value) {
    if (!exactKeys(value, ['contractVersion', 'epoch'])
      || value.contractVersion !== LIFECYCLE_VERSION
      || !Number.isSafeInteger(value.epoch) || value.epoch < 0) {
      throw vaultError('SS_ERP_BYOK_RESULT_INVALID');
    }
    return Object.freeze({ contractVersion: LIFECYCLE_VERSION, epoch: value.epoch });
  }

  function createId(randomValues) {
    var bytes = new Uint8Array(24);
    randomValues(bytes);
    return 'br_' + Array.from(bytes).map(function (byte) {
      return byte.toString(16).padStart(2, '0');
    }).join('');
  }

  function publicResult(entry) {
    return Object.freeze({
      contractVersion: CONTRACT_VERSION,
      resultId: entry.resultId,
      outcome: 'SUCCEEDED',
      operation: entry.operation,
      requestMode: entry.requestMode,
      model: entry.model,
      policyRevision: entry.policyRevision,
      idempotencyKey: entry.idempotencyKey,
      requestHash: entry.requestHash,
      promptHash: entry.promptHash,
      acceptedAt: entry.acceptedAt,
      reviewState: entry.reviewState,
      reviewedAt: entry.reviewedAt,
      expiresAt: entry.expiresAt,
      image: Object.freeze({
        mimeType: entry.mimeType,
        byteLength: entry.byteLength,
        sha256: entry.sha256,
      }),
    });
  }

  function createVault(options) {
    var now = options && options.now || function () { return new Date(); };
    var randomValues = options && options.randomValues
      || function (bytes) { return global.crypto.getRandomValues(bytes); };
    var scheduleTimeout = options && options.setTimeout
      || (typeof global.setTimeout === 'function' ? global.setTimeout.bind(global) : null);
    var cancelTimeout = options && options.clearTimeout
      || (typeof global.clearTimeout === 'function' ? global.clearTimeout.bind(global) : null);
    var onDiscardedResult = options && options.onDiscardedResult;
    var ttlMs = Number(options && options.ttlMs) || DEFAULT_TTL_MS;
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > DEFAULT_TTL_MS
      || Boolean(scheduleTimeout) !== Boolean(cancelTimeout)
      || (onDiscardedResult !== undefined && typeof onDiscardedResult !== 'function')) {
      throw vaultError('SS_ERP_BYOK_RESULT_VAULT_INVALID');
    }
    var entries = new Map();
    var operationIndex = new Map();
    var totalBytes = 0;

    function currentMillis() {
      var value = new Date(now()).getTime();
      if (!Number.isFinite(value)) throw vaultError('SS_ERP_BYOK_RESULT_VAULT_INVALID');
      return value;
    }

    function isCapacityRetained(entry) {
      return entry.selectionPinned || entry.reviewState === 'APPROVED';
    }

    function cancelExpiry(entry) {
      if (entry.expiryTimer !== null && cancelTimeout) {
        try { cancelTimeout(entry.expiryTimer); } catch (_error) {}
      }
      entry.expiryTimer = null;
    }

    function remove(resultId) {
      var entry = entries.get(resultId);
      if (!entry) return false;
      entries.delete(resultId);
      cancelExpiry(entry);
      if (operationIndex.get(entry.idempotencyKey) === resultId) {
        operationIndex.delete(entry.idempotencyKey);
      }
      totalBytes -= entry.byteLength;
      entry.blob = null;
      if (onDiscardedResult) {
        try { onDiscardedResult(entry.resultId); } catch (_error) {}
      }
      return true;
    }

    function scheduleExpiry(entry) {
      if (!scheduleTimeout) return;
      var delay = Math.max(1, entry.expiresAtMillis - currentMillis());
      entry.expiryTimer = scheduleTimeout(function () {
        entry.expiryTimer = null;
        var remaining;
        try { remaining = entry.expiresAtMillis - currentMillis(); } catch (_error) { remaining = 0; }
        if (remaining > 0) {
          scheduleExpiry(entry);
          return;
        }
        remove(entry.resultId);
      }, delay);
    }

    function prune(current) {
      entries.forEach(function (entry) {
        if (entry.expiresAtMillis <= current) remove(entry.resultId);
      });
    }

    function planEvictions(incomingBytes) {
      var candidates = [];
      var reclaimedBytes = 0;
      entries.forEach(function (entry) {
        var countFits = entries.size - candidates.length + 1 <= MAX_ENTRIES;
        var bytesFit = totalBytes - reclaimedBytes + incomingBytes <= MAX_TOTAL_BYTES;
        if ((!countFits || !bytesFit) && !isCapacityRetained(entry)) {
          candidates.push(entry.resultId);
          reclaimedBytes += entry.byteLength;
        }
      });
      if (entries.size - candidates.length + 1 > MAX_ENTRIES
        || totalBytes - reclaimedBytes + incomingBytes > MAX_TOTAL_BYTES) {
        throw vaultError('SS_ERP_BYOK_RESULT_VAULT_FULL');
      }
      return candidates;
    }

    function normalize(result, bindingValue, lifecycleAuthorityValue) {
      var binding = normalizeBinding(bindingValue);
      var lifecycleAuthority = normalizeLifecycleAuthority(lifecycleAuthorityValue);
      if (!result || typeof result !== 'object' || !binding || typeof binding !== 'object'
        || result.outcome !== 'SUCCEEDED' || !OPERATIONS.includes(result.operation)
        || (result.operation === 'TEXT_TO_IMAGE'
          ? result.requestMode !== 'json'
          : !['multipart', 'async'].includes(result.requestMode))
        || binding.operation !== result.operation
        || binding.providerOrigin !== result.providerOrigin || binding.model !== result.model
        || binding.policyRevision !== result.policyRevision
        || typeof Blob === 'undefined' || !(result.image && result.image.blob instanceof Blob)) {
        throw vaultError('SS_ERP_BYOK_RESULT_INVALID');
      }
      var mimeType = text(result.image.mimeType, 32).toLowerCase();
      var byteLength = positiveInteger(result.image.byteLength, MAX_RESULT_BYTES);
      if (!MIME_TYPES.includes(mimeType)
        || result.image.blob.type !== mimeType
        || result.image.blob.size !== byteLength) {
        throw vaultError('SS_ERP_BYOK_RESULT_INVALID');
      }
      var editHashes = normalizedEditHashes(result, result.operation);
      return {
        operation: result.operation,
        requestMode: result.requestMode,
        profileId: text(result.profileId, 128),
        providerOrigin: text(result.providerOrigin, 300),
        model: text(result.model, 200),
        policyRevision: text(result.policyRevision, 200),
        idempotencyKey: text(result.idempotencyKey, 200),
        requestHash: sha256(result.requestHash),
        promptHash: sha256(result.promptHash),
        negativePromptHash: result.negativePromptHash == null ? null : sha256(result.negativePromptHash),
        endpointHash: sha256(result.endpointHash),
        providerRequestIdSha256: result.providerRequestIdSha256 == null
          ? null
          : sha256(result.providerRequestIdSha256),
        providerTaskIdSha256: result.providerTaskIdSha256 == null
          ? null
          : sha256(result.providerTaskIdSha256),
        sourceSha256: editHashes.sourceSha256,
        referenceSha256s: editHashes.referenceSha256s,
        maskSha256: editHashes.maskSha256,
        acceptedAt: new Date(text(result.acceptedAt, 64)).toISOString(),
        mimeType: mimeType,
        byteLength: byteLength,
        sha256: sha256(result.image.sha256),
        blob: result.image.blob,
        reviewState: 'CANDIDATE_READY',
        reviewedAt: null,
        selectionPinned: false,
        lifecycleEpoch: lifecycleAuthority.epoch,
        binding: binding,
        authorityFingerprint: JSON.stringify({
          lifecycleEpoch: lifecycleAuthority.epoch,
          binding: binding,
        }),
      };
    }

    function put(result, binding, lifecycleAuthority) {
      var current = currentMillis();
      prune(current);
      var normalized = normalize(result, binding, lifecycleAuthority);
      var existingId = operationIndex.get(normalized.idempotencyKey);
      var existing = existingId && entries.get(existingId);
      if (existing) {
        if (existing.requestHash !== normalized.requestHash
          || existing.sha256 !== normalized.sha256
          || existing.authorityFingerprint !== normalized.authorityFingerprint) {
          throw vaultError('SS_ERP_BYOK_RESULT_IDEMPOTENCY_CONFLICT');
        }
        return publicResult(existing);
      }
      var resultId = createId(randomValues);
      if (entries.has(resultId)) throw vaultError('SS_ERP_BYOK_RESULT_ID_COLLISION');
      planEvictions(normalized.byteLength).forEach(remove);
      var expiresAtMillis = current + ttlMs;
      var entry = {
        ...normalized,
        resultId: resultId,
        expiresAtMillis: expiresAtMillis,
        expiresAt: new Date(expiresAtMillis).toISOString(),
        expiryTimer: null,
      };
      entries.set(resultId, entry);
      operationIndex.set(entry.idempotencyKey, resultId);
      totalBytes += entry.byteLength;
      scheduleExpiry(entry);
      return publicResult(entry);
    }

    function getForBackground(resultIdValue) {
      var current = currentMillis();
      prune(current);
      var resultId = text(resultIdValue, 128);
      var entry = entries.get(resultId);
      if (!entry || !entry.blob) throw vaultError('SS_ERP_BYOK_RESULT_NOT_FOUND');
      return entry;
    }

    function getPublic(resultIdValue) {
      return publicResult(getForBackground(resultIdValue));
    }

    function getPublicByOperation(idempotencyKeyValue) {
      var current = currentMillis();
      prune(current);
      var resultId = operationIndex.get(text(idempotencyKeyValue, 200));
      if (!resultId) throw vaultError('SS_ERP_BYOK_RESULT_NOT_FOUND');
      return getPublic(resultId);
    }

    function pinSelection(resultIdValue) {
      var entry = getForBackground(resultIdValue);
      entry.selectionPinned = true;
      return true;
    }

    function unpinSelection(resultIdValue) {
      var current = currentMillis();
      prune(current);
      var resultId = text(resultIdValue, 128);
      var entry = entries.get(resultId);
      if (!entry || !entry.blob) return false;
      entry.selectionPinned = false;
      return true;
    }

    function assertExactBinding(entry, bindingValue) {
      var binding = normalizeBinding(bindingValue);
      if (!BINDING_KEYS.every(function (key) { return entry.binding[key] === binding[key]; })) {
        throw vaultError('SS_ERP_BYOK_RESULT_AUTHORITY_MISMATCH');
      }
    }

    function approve(resultIdValue, bindingValue) {
      var entry = getForBackground(resultIdValue);
      assertExactBinding(entry, bindingValue);
      if (entry.reviewState === 'APPROVED') return publicResult(entry);
      if (entry.reviewState !== 'CANDIDATE_READY') {
        throw vaultError('SS_ERP_BYOK_RESULT_REVIEW_INVALID');
      }
      entry.reviewState = 'APPROVED';
      entry.reviewedAt = new Date(currentMillis()).toISOString();
      return publicResult(entry);
    }

    function reject(resultIdValue, bindingValue) {
      var entry = getForBackground(resultIdValue);
      assertExactBinding(entry, bindingValue);
      if (!['CANDIDATE_READY', 'APPROVED'].includes(entry.reviewState)) {
        throw vaultError('SS_ERP_BYOK_RESULT_REVIEW_INVALID');
      }
      remove(entry.resultId);
      return Object.freeze({ resultId: entry.resultId, reviewState: 'REJECTED' });
    }

    function getApprovedForBackground(resultIdValue) {
      var entry = getForBackground(resultIdValue);
      if (entry.reviewState !== 'APPROVED' || !entry.reviewedAt) {
        throw vaultError('SS_ERP_BYOK_RESULT_APPROVAL_REQUIRED');
      }
      return entry;
    }

    function clear() {
      Array.from(entries.keys()).forEach(remove);
    }

    return Object.freeze({
      put: put,
      getForBackground: getForBackground,
      getPublic: getPublic,
      getPublicByOperation: getPublicByOperation,
      getApprovedForBackground: getApprovedForBackground,
      pinSelection: pinSelection,
      unpinSelection: unpinSelection,
      approve: approve,
      reject: reject,
      release: function (resultId) { return remove(text(resultId, 128)); },
      clear: clear,
      size: function () { prune(currentMillis()); return entries.size; },
      totalBytes: function () { prune(currentMillis()); return totalBytes; },
    });
  }

  global.SS_ERP_BYOK_GENERATED_RESULT_VAULT = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    createVault: createVault,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
