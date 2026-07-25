(function (global) {
  'use strict';

  var CONTRACT_VERSION = 'extension-byok-permission/v1';
  var hasOwn = Object.prototype.hasOwnProperty;
  var gestureTokens = typeof WeakMap === 'function' ? new WeakMap() : new Map();
  var gestureEvents = typeof WeakSet === 'function' ? new WeakSet() : new Set();
  var GESTURE_TOKEN_TTL_MS = 10 * 1000;

  function permissionError(code, message) {
    var result = new Error(message || code);
    result.code = code;
    return result;
  }

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function assertClosedRecord(value, allowedKeys, code) {
    if (!isRecord(value)) throw permissionError(code, 'permission input is invalid');
    Object.keys(value).forEach(function (key) {
      if (!hasOwn.call(allowedKeys, key)) {
        throw permissionError(code, 'permission input contains an unknown field');
      }
    });
  }

  function assertText(value, maximum, code, label) {
    if (typeof value !== 'string') throw permissionError(code, label + ' is invalid');
    var normalized = value.normalize('NFKC').trim();
    if (!normalized || normalized.length > maximum) {
      throw permissionError(code, label + ' is invalid');
    }
    for (var index = 0; index < normalized.length; index += 1) {
      var codePoint = normalized.codePointAt(index);
      if (codePoint <= 0x1f || codePoint === 0x7f) {
        throw permissionError(code, label + ' contains a control character');
      }
      if (codePoint > 0xffff) index += 1;
    }
    return normalized;
  }

  function isPrivateIpv4(hostname) {
    if (!/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname)) return false;
    var parts = hostname.split('.').map(Number);
    if (parts.some(function (part) { return !Number.isInteger(part) || part < 0 || part > 255; })) {
      return true;
    }
    var first = parts[0];
    var second = parts[1];
    return first === 0
      || first === 10
      || first === 127
      || (first === 100 && second >= 64 && second <= 127)
      || (first === 169 && second === 254)
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 168)
      || (first === 192 && second === 0)
      || (first === 198 && (second === 18 || second === 19))
      || (first === 198 && second === 51)
      || (first === 203 && second === 0)
      || first >= 224;
  }

  function isDisallowedHostname(hostname) {
    var raw = String(hostname || '').toLowerCase();
    // DNS trailing-dot and empty-label spellings are distinct URL origins and
    // are easy to miss in an administrator allowlist. Keep one canonical form.
    if (raw.endsWith('.') || raw.startsWith('.') || raw.includes('..')) return true;
    var normalized = raw;
    if (!normalized
      || normalized === 'localhost'
      || normalized.endsWith('.localhost')
      || normalized === 'metadata'
      || normalized === 'metadata.google.internal'
      || normalized.endsWith('.metadata.google.internal')
      || normalized === 'instance-data'
      || normalized.endsWith('.instance-data')
      || normalized.endsWith('.internal')
      || normalized.endsWith('.local')
      || normalized.endsWith('.home.arpa')
      || isPrivateIpv4(normalized)) {
      return true;
    }
    // IPv6 literals are intentionally outside the first-release Provider
    // contract; rejecting them avoids mapped/NAT64/6to4 SSRF aliases.
    if (normalized.startsWith('[') && normalized.endsWith(']')) return true;
    // Single-label HTTPS names are normally split-horizon/internal DNS. The
    // extension only grants public Provider origins, so fail closed here.
    if (!normalized.includes('.')) return true;
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/u.test(normalized)) {
      return true;
    }
    return false;
  }

  /**
   * Reduce a Provider endpoint to the one origin for which Chrome may grant
   * access. Paths are accepted for endpoint ergonomics but never enter the
   * permission pattern. Query, fragment, credentials, non-HTTPS, and private
   * targets fail before any chrome.permissions call.
   */
  function canonicalizeOrigin(value) {
    var raw = assertText(value, 2048, 'SS_ERP_BYOK_PERMISSION_ORIGIN_INVALID', 'Provider endpoint');
    if (raw.includes('\\') || raw.includes('?') || raw.includes('#')) {
      throw permissionError(
        'SS_ERP_BYOK_PERMISSION_ORIGIN_INVALID',
        'Provider endpoint must not contain a redirect, query, or fragment',
      );
    }
    var parsed;
    try {
      parsed = new URL(raw);
    } catch {
      throw permissionError('SS_ERP_BYOK_PERMISSION_ORIGIN_INVALID', 'Provider endpoint is invalid');
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password
      || parsed.search || parsed.hash || parsed.origin === 'null'
      || parsed.pathname.includes('\\')) {
      throw permissionError(
        'SS_ERP_BYOK_PERMISSION_ORIGIN_INVALID',
        'Provider endpoint must be a canonical public HTTPS origin',
      );
    }
    var hostname = String(parsed.hostname || '').toLowerCase();
    if (isDisallowedHostname(hostname)) {
      throw permissionError(
        'SS_ERP_BYOK_PERMISSION_ORIGIN_INVALID',
        'Provider endpoint host is not public',
      );
    }
    // URL canonicalization maps integer/octal IPv4 spellings to dotted private
    // addresses before this check. Reject any remaining numeric address that is
    // not explicitly public rather than guessing at DNS ownership.
    if (/^\d+(?:\.\d+){0,3}$/u.test(hostname) && isPrivateIpv4(hostname)) {
      throw permissionError('SS_ERP_BYOK_PERMISSION_ORIGIN_INVALID', 'Provider endpoint host is not public');
    }
    return parsed.origin;
  }

  function permissionPattern(origin) {
    return origin + '/*';
  }

  function normalizeDecision(value, expectedOrigin) {
    assertClosedRecord(value, {
      allowed: true,
      providerOrigin: true,
      policyRevision: true,
    }, 'SS_ERP_BYOK_PERMISSION_DECISION_INVALID');
    if (value.allowed !== true) {
      throw permissionError('SS_ERP_BYOK_PERMISSION_NOT_ALLOWED', 'ERP has not allowlisted this Provider origin');
    }
    var decisionOrigin;
    try {
      decisionOrigin = canonicalizeOrigin(value.providerOrigin);
    } catch {
      throw permissionError('SS_ERP_BYOK_PERMISSION_DECISION_INVALID', 'ERP Provider origin is invalid');
    }
    if (decisionOrigin !== expectedOrigin) {
      throw permissionError('SS_ERP_BYOK_PERMISSION_DECISION_INVALID', 'ERP decision does not bind this origin');
    }
    var policyRevision;
    if (Number.isSafeInteger(value.policyRevision) && value.policyRevision >= 0) {
      policyRevision = value.policyRevision;
    } else {
      policyRevision = assertText(
        value.policyRevision,
        200,
        'SS_ERP_BYOK_PERMISSION_DECISION_INVALID',
        'ERP policy revision',
      );
    }
    return {
      allowed: true,
      providerOrigin: decisionOrigin,
      policyRevision: policyRevision,
    };
  }

  // The ERP allowlist decision is supplied by a background-owned adapter, not
  // by the settings page.  The bridge must consume an already authenticated
  // readiness handle synchronously so the subsequent permissions.request call
  // remains inside Chrome's transient user-activation task.  A plain object in
  // the request would be forgeable by any extension page and is intentionally
  // rejected.
  function consumeVerifiedReadiness(bridge, handle, binding, expectedOrigin) {
    if (!bridge || typeof bridge.consume !== 'function') {
      throw permissionError(
        'SS_ERP_BYOK_PERMISSION_READINESS_UNAVAILABLE',
        'ERP readiness bridge is unavailable',
      );
    }
    var decision;
    try {
      decision = bridge.consume(handle, binding, expectedOrigin);
    } catch (_error) {
      throw permissionError(
        'SS_ERP_BYOK_PERMISSION_READINESS_INVALID',
        'ERP readiness handle is invalid or expired',
      );
    }
    // An asynchronous verifier here would lose transient user activation
    // before permissions.request.  The background adapter must pre-verify and
    // hand the page a one-use synchronous bridge token instead.
    if (decision && typeof decision.then === 'function') {
      throw permissionError(
        'SS_ERP_BYOK_PERMISSION_READINESS_UNAVAILABLE',
        'ERP readiness bridge must be synchronous',
      );
    }
    return normalizeDecision(decision, expectedOrigin);
  }

  function createTrustedGestureToken(event) {
    var eventConstructor = global.Event;
    var isNativeEvent = typeof eventConstructor === 'function'
      && event instanceof eventConstructor;
    var hasNativeEventSlots = false;
    if (isNativeEvent && eventConstructor.prototype
      && typeof eventConstructor.prototype.composedPath === 'function') {
      try {
        eventConstructor.prototype.composedPath.call(event);
        hasNativeEventSlots = true;
      } catch {
        hasNativeEventSlots = false;
      }
    }
    if (!isNativeEvent || !hasNativeEventSlots || event.isTrusted !== true) {
      throw permissionError(
        'SS_ERP_BYOK_PERMISSION_GESTURE_REQUIRED',
        'Provider permission must be requested from a trusted user gesture',
      );
    }
    if (gestureEvents.has(event)) {
      throw permissionError(
        'SS_ERP_BYOK_PERMISSION_GESTURE_REQUIRED',
        'Provider permission gesture has already been consumed',
      );
    }
    gestureEvents.add(event);
    var token = {};
    gestureTokens.set(token, Date.now());
    return Object.freeze(token);
  }

  function consumeTrustedGestureToken(token) {
    var issuedAt = token && gestureTokens.get(token);
    if (!token || !Number.isFinite(issuedAt) || Date.now() - issuedAt > GESTURE_TOKEN_TTL_MS) {
      throw permissionError(
        'SS_ERP_BYOK_PERMISSION_GESTURE_REQUIRED',
        'Provider permission must be requested from a trusted user gesture',
      );
    }
    gestureTokens.delete(token);
  }

  function resolvePermissionsApi(value) {
    var candidate = value || (global.chrome && global.chrome.permissions);
    if (!candidate || typeof candidate.contains !== 'function'
      || typeof candidate.request !== 'function' || typeof candidate.remove !== 'function') {
      throw permissionError(
        'SS_ERP_BYOK_PERMISSION_API_UNAVAILABLE',
        'Chrome optional permission API is unavailable',
      );
    }
    return candidate;
  }

  function callPermissionMethod(api, method, input) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      function finish(callback, value) {
        if (settled) return;
        settled = true;
        callback(value);
      }
      function callback(value) {
        var lastError = global.chrome && global.chrome.runtime && global.chrome.runtime.lastError;
        if (lastError) {
          finish(reject, permissionError(
            'SS_ERP_BYOK_PERMISSION_API_FAILED',
            'Chrome optional permission operation failed',
          ));
          return;
        }
        finish(resolve, value);
      }
      var result;
      try {
        result = api[method](input, callback);
      } catch (error) {
        finish(reject, error);
        return;
      }
      if (result && typeof result.then === 'function') {
        result.then(function (value) { finish(resolve, value); }, function (error) { finish(reject, error); });
      } else if (result !== undefined) {
        finish(resolve, result);
      }
    });
  }

  function assertRequestInput(input) {
    assertClosedRecord(input, {
      endpoint: true,
      readinessHandle: true,
      readinessBinding: true,
      trustedGesture: true,
    }, 'SS_ERP_BYOK_PERMISSION_INPUT_INVALID');
    if (!Object.prototype.hasOwnProperty.call(input, 'readinessHandle')
      || !Object.prototype.hasOwnProperty.call(input, 'readinessBinding')) {
      throw permissionError(
        'SS_ERP_BYOK_PERMISSION_READINESS_UNAVAILABLE',
        'ERP readiness handle and binding are required',
      );
    }
  }

  function createBroker(options) {
    var permissions = resolvePermissionsApi(options && options.permissions);
    // This object is captured when the broker is created in the background
    // worker.  It is never accepted from request input, where a page could
    // replace an ordinary allowlistDecision object.
    var readinessBridge = options && options.readinessBridge;

    async function containsOrigin(endpoint) {
      var origin = canonicalizeOrigin(endpoint);
      var pattern = permissionPattern(origin);
      var granted = await callPermissionMethod(permissions, 'contains', { origins: [pattern] });
      return { origin: origin, pattern: pattern, granted: Boolean(granted) };
    }

    async function requestOriginPermission(input) {
      assertRequestInput(input);
      var origin = canonicalizeOrigin(input.endpoint);
      var readinessHandle = assertText(
        input.readinessHandle,
        4096,
        'SS_ERP_BYOK_PERMISSION_READINESS_INVALID',
        'ERP readiness handle',
      );
      if (!isRecord(input.readinessBinding)) {
        throw permissionError(
          'SS_ERP_BYOK_PERMISSION_READINESS_INVALID',
          'ERP readiness binding is invalid',
        );
      }
      // Consume the user gesture before evaluating the one-use readiness
      // handle.  Validation failures must not leave a trusted event token
      // reusable by a later request in the same page task.
      consumeTrustedGestureToken(input.trustedGesture);
      consumeVerifiedReadiness(
        readinessBridge,
        readinessHandle,
        input.readinessBinding,
        origin,
      );
      var pattern = permissionPattern(origin);
      // Invoke request before the first await. Chrome binds permissions.request
      // to transient user activation; awaiting contains() first can move this
      // call outside the trusted click task. Requesting an already-granted exact
      // origin is idempotent and resolves true without broadening access.
      var granted = await callPermissionMethod(
        permissions,
        'request',
        { origins: [pattern] },
      );
      return {
        origin: origin,
        pattern: pattern,
        granted: Boolean(granted),
        requested: true,
      };
    }

    async function hasOriginPermission(endpoint) {
      return containsOrigin(endpoint);
    }

    async function removeOriginPermission(endpoint) {
      var origin = canonicalizeOrigin(endpoint);
      var pattern = permissionPattern(origin);
      var removed = await callPermissionMethod(
        permissions,
        'remove',
        { origins: [pattern] },
      );
      return { origin: origin, pattern: pattern, removed: Boolean(removed) };
    }

    return Object.freeze({
      createTrustedGestureToken: createTrustedGestureToken,
      canonicalizeOrigin: canonicalizeOrigin,
      containsOrigin: containsOrigin,
      hasOriginPermission: hasOriginPermission,
      requestOriginPermission: requestOriginPermission,
      removeOriginPermission: removeOriginPermission,
    });
  }

  global.SS_ERP_BYOK_PERMISSION_BROKER = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    canonicalizeOrigin: canonicalizeOrigin,
    createBroker: createBroker,
    createTrustedGestureToken: createTrustedGestureToken,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
