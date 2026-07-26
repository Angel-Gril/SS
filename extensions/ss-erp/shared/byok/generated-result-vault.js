(function exposeByokGeneratedResultVault(global) {
  'use strict';

  var CONTRACT_VERSION = 'extension-byok-result-vault/v1';
  var MAX_ENTRIES = 16;
  var MAX_TOTAL_BYTES = 50 * 1024 * 1024;
  var MAX_RESULT_BYTES = 20 * 1024 * 1024;
  var DEFAULT_TTL_MS = 10 * 60 * 1000;
  var MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
  var READINESS_BINDING_VERSION = 'extension-byok-readiness-binding/v1';
  var LIFECYCLE_VERSION = 'extension-byok-device-session-lifecycle/v1';
  var BINDING_KEYS = [
    'contractVersion', 'ownerUserId', 'deviceSessionId', 'shopId', 'workflowId',
    'draftRevision', 'draftVersion', 'providerOrigin', 'model', 'operation', 'policyRevision',
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

  function positiveInteger(value, maximum) {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
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
    return Object.freeze({
      contractVersion: READINESS_BINDING_VERSION,
      ownerUserId: text(value.ownerUserId, 200),
      deviceSessionId: text(value.deviceSessionId, 200),
      shopId: text(value.shopId, 200),
      workflowId: text(value.workflowId, 200),
      draftRevision: positiveInteger(value.draftRevision, Number.MAX_SAFE_INTEGER),
      draftVersion: positiveInteger(value.draftVersion, Number.MAX_SAFE_INTEGER),
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
    var ttlMs = Number(options && options.ttlMs) || DEFAULT_TTL_MS;
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > DEFAULT_TTL_MS) {
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

    function remove(resultId) {
      var entry = entries.get(resultId);
      if (!entry) return false;
      entries.delete(resultId);
      if (operationIndex.get(entry.idempotencyKey) === resultId) {
        operationIndex.delete(entry.idempotencyKey);
      }
      totalBytes -= entry.byteLength;
      entry.blob = null;
      return true;
    }

    function prune(current) {
      entries.forEach(function (entry) {
        if (entry.expiresAtMillis <= current) remove(entry.resultId);
      });
    }

    function normalize(result, bindingValue, lifecycleAuthorityValue) {
      var binding = normalizeBinding(bindingValue);
      var lifecycleAuthority = normalizeLifecycleAuthority(lifecycleAuthorityValue);
      if (!result || typeof result !== 'object' || !binding || typeof binding !== 'object'
        || result.outcome !== 'SUCCEEDED' || result.operation !== 'TEXT_TO_IMAGE'
        || result.requestMode !== 'json' || binding.operation !== result.operation
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
      return {
        operation: 'TEXT_TO_IMAGE',
        requestMode: 'json',
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
        acceptedAt: new Date(text(result.acceptedAt, 64)).toISOString(),
        mimeType: mimeType,
        byteLength: byteLength,
        sha256: sha256(result.image.sha256),
        blob: result.image.blob,
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
      while (entries.size >= MAX_ENTRIES || totalBytes + normalized.byteLength > MAX_TOTAL_BYTES) {
        var oldest = entries.keys().next().value;
        if (!oldest) throw vaultError('SS_ERP_BYOK_RESULT_VAULT_FULL');
        remove(oldest);
      }
      var resultId = createId(randomValues);
      if (entries.has(resultId)) throw vaultError('SS_ERP_BYOK_RESULT_ID_COLLISION');
      var expiresAtMillis = current + ttlMs;
      var entry = {
        ...normalized,
        resultId: resultId,
        expiresAtMillis: expiresAtMillis,
        expiresAt: new Date(expiresAtMillis).toISOString(),
      };
      entries.set(resultId, entry);
      operationIndex.set(entry.idempotencyKey, resultId);
      totalBytes += entry.byteLength;
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

    function clear() {
      Array.from(entries.keys()).forEach(remove);
    }

    return Object.freeze({
      put: put,
      getForBackground: getForBackground,
      getPublic: getPublic,
      getPublicByOperation: getPublicByOperation,
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
