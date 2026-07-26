(function exposeByokPermissionReadinessBridge(global) {
  'use strict';

  var CONTRACT_VERSION = 'extension-byok-permission-readiness-bridge/v1';
  var BINDING_VERSION = 'extension-byok-readiness-binding/v1';
  var MAX_TTL_MS = 10 * 60 * 1000;
  var MAX_CONSUMED_HANDLES = 512;
  var consumedHandles = new Map();
  var OPERATIONS = ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'];
  var BINDING_KEYS = [
    'contractVersion', 'ownerUserId', 'deviceSessionId', 'shopId', 'workflowId',
    'draftRevision', 'draftVersion', 'providerOrigin', 'model', 'operation', 'policyRevision',
  ];

  function bridgeError(code) {
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

  function exactText(value, maximum) {
    if (typeof value !== 'string') throw bridgeError('SS_ERP_BYOK_PERMISSION_READINESS_INVALID');
    var normalized = value.normalize('NFKC').trim();
    if (!normalized || normalized !== value || normalized.length > maximum
      || /[\u0000-\u001f\u007f]/u.test(normalized)) {
      throw bridgeError('SS_ERP_BYOK_PERMISSION_READINESS_INVALID');
    }
    return normalized;
  }

  function sameBinding(left, right) {
    return exactKeys(right, BINDING_KEYS)
      && BINDING_KEYS.every(function (key) { return left[key] === right[key]; });
  }

  function burnHandle(handle, expiresAt, now) {
    consumedHandles.forEach(function (expiry, candidate) {
      if (!Number.isFinite(expiry) || expiry <= now) consumedHandles.delete(candidate);
    });
    if (consumedHandles.has(handle) || consumedHandles.size >= MAX_CONSUMED_HANDLES) {
      throw bridgeError('SS_ERP_BYOK_PERMISSION_READINESS_UNAVAILABLE');
    }
    // Burn before checking caller-supplied binding/origin values. A failed attempt
    // must not leave the same page ticket usable through another bridge instance.
    consumedHandles.set(handle, expiresAt);
  }

  function createBridge(options) {
    var permissionApi = global.SS_ERP_BYOK_PERMISSION_BROKER;
    if (!permissionApi || typeof permissionApi.canonicalizeOrigin !== 'function') {
      throw bridgeError('SS_ERP_BYOK_PERMISSION_READINESS_UNAVAILABLE');
    }
    if (!isRecord(options) || !exactKeys(options, [
      'readiness', 'profile', 'shopId', 'operation', 'now',
    ])) {
      throw bridgeError('SS_ERP_BYOK_PERMISSION_READINESS_INVALID');
    }
    var readiness = options.readiness;
    var profile = options.profile;
    if (!exactKeys(readiness, ['readinessHandle', 'readinessBinding', 'expiresAt'])
      || !isRecord(profile)) {
      throw bridgeError('SS_ERP_BYOK_PERMISSION_READINESS_INVALID');
    }
    var handle = exactText(readiness.readinessHandle, 128);
    var binding = readiness.readinessBinding;
    if (!exactKeys(binding, BINDING_KEYS) || binding.contractVersion !== BINDING_VERSION) {
      throw bridgeError('SS_ERP_BYOK_PERMISSION_READINESS_INVALID');
    }
    var operation = exactText(options.operation, 64);
    if (!OPERATIONS.includes(operation)
      || binding.operation !== operation
      || binding.shopId !== exactText(options.shopId, 200)
      || binding.model !== exactText(profile.model, 200)
      || binding.workflowId !== null
      || binding.draftRevision !== null
      || binding.draftVersion !== null) {
      throw bridgeError('SS_ERP_BYOK_PERMISSION_READINESS_MISMATCH');
    }
    var origin = permissionApi.canonicalizeOrigin(profile.baseUrl);
    if (binding.providerOrigin !== origin) {
      throw bridgeError('SS_ERP_BYOK_PERMISSION_READINESS_MISMATCH');
    }
    var nowValue = typeof options.now === 'function' ? options.now() : new Date();
    var nowMillis = new Date(nowValue).getTime();
    var expiresMillis = Date.parse(exactText(readiness.expiresAt, 64));
    if (!Number.isFinite(nowMillis) || !Number.isFinite(expiresMillis)
      || expiresMillis <= nowMillis || expiresMillis - nowMillis > MAX_TTL_MS) {
      throw bridgeError('SS_ERP_BYOK_PERMISSION_READINESS_EXPIRED');
    }
    exactText(binding.ownerUserId, 200);
    exactText(binding.deviceSessionId, 200);
    var policyRevision = exactText(binding.policyRevision, 200);
    var used = false;

    return Object.freeze({
      contractVersion: CONTRACT_VERSION,
      consume: function consume(candidateHandle, candidateBinding, expectedOrigin) {
        if (used) throw bridgeError('SS_ERP_BYOK_PERMISSION_READINESS_UNAVAILABLE');
        used = true;
        var consumeNow = new Date(
          typeof options.now === 'function' ? options.now() : new Date(),
        ).getTime();
        burnHandle(handle, expiresMillis, consumeNow);
        if (candidateHandle !== handle
          || !sameBinding(binding, candidateBinding)
          || permissionApi.canonicalizeOrigin(expectedOrigin) !== origin
          || !Number.isFinite(consumeNow) || consumeNow >= expiresMillis) {
          throw bridgeError('SS_ERP_BYOK_PERMISSION_READINESS_MISMATCH');
        }
        return Object.freeze({
          allowed: true,
          providerOrigin: origin,
          policyRevision: policyRevision,
        });
      },
    });
  }

  global.SS_ERP_BYOK_PERMISSION_READINESS_BRIDGE = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    createBridge: createBridge,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
