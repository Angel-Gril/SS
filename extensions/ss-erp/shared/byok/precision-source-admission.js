(function exposePrecisionSourceAdmission(global) {
  'use strict';

  var CONTRACT_VERSION = 'extension-precision-source-admission/v1';
  var ATTESTATION_TTL_MS = 5000;
  var MAX_PENDING = 16;
  var QUERY_TYPE = 'ss-erp:precision-source-attest';
  var ACK_TYPE = 'ss-erp:precision-source-attestation';
  var PLATFORMS = ['1688', 'pdd', 'taobao', 'tmall'];
  var SAFE_ERROR_CODES = new Set([
    'SS_ERP_PRECISION_SOURCE_FRAME_INVALID', 'SS_ERP_PRECISION_SOURCE_DEPENDENCY_UNAVAILABLE',
    'SS_ERP_PRECISION_SOURCE_CLOCK_INVALID', 'SS_ERP_PRECISION_SOURCE_DEVICE_UNAVAILABLE',
    'SS_ERP_PRECISION_SOURCE_CHANGED',
    'SS_ERP_PRECISION_SOURCE_NONCE_INVALID', 'SS_ERP_PRECISION_SOURCE_ATTESTATION_EXPIRED',
    'SS_ERP_PRECISION_SOURCE_ATTESTATION_TRANSPORT_FAILED', 'SS_ERP_PRECISION_SOURCE_CAPACITY_EXHAUSTED',
    'SS_ERP_PRECISION_SOURCE_DEVICE_CHANGED', 'SS_ERP_PRECISION_SOURCE_INVALIDATED',
    'SS_ERP_PRECISION_SOURCE_UNAVAILABLE',
  ]);

  function admissionError(code) {
    var error = new Error(code);
    error.name = 'ExtensionPrecisionSourceAdmissionError';
    error.code = code;
    return error;
  }
  function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
  function safeError(error) {
    return admissionError(error && SAFE_ERROR_CODES.has(error.code) ? error.code : 'SS_ERP_PRECISION_SOURCE_UNAVAILABLE');
  }
  function exactKeys(value, keys) {
    return record(value) && Object.keys(value).length === keys.length
      && Object.keys(value).every(function (key) { return keys.includes(key); });
  }
  function identifier(value, maximum) {
    return typeof value === 'string' && value.length > 0 && value.length <= maximum
      && value === value.normalize('NFKC').trim()
      && !Array.from(value).some(function (character) { return character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127; })
      && !/^(?:sk-|rk-|gsk_|Bearer\s|eyJ[^.]*\.)/u.test(value);
  }
  function validTabId(value) { return Number.isSafeInteger(value) && value >= 0; }
  function sourceUrl(value) {
    if (typeof value !== 'string' || value.length > 4096) return null;
    try {
      var url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && !url.hash && !url.port ? url : null;
    } catch { return null; }
  }
  function normalizeFrame(value) {
    if (!exactKeys(value, ['tabId', 'frameId', 'documentId', 'url', 'origin'])
      || !validTabId(value.tabId) || !Number.isSafeInteger(value.frameId) || value.frameId < 1
      || !identifier(value.documentId, 200) || typeof value.url !== 'string' || value.url.length > 4096) {
      throw admissionError('SS_ERP_PRECISION_SOURCE_FRAME_INVALID');
    }
    var url;
    try { url = new URL(value.url); } catch { throw admissionError('SS_ERP_PRECISION_SOURCE_FRAME_INVALID'); }
    if (url.protocol !== 'chrome-extension:' || !identifier(url.hostname, 200) || url.username || url.password
      || value.origin !== 'chrome-extension://' + url.hostname) throw admissionError('SS_ERP_PRECISION_SOURCE_FRAME_INVALID');
    return { tabId: value.tabId, frameId: value.frameId, documentId: value.documentId, runtimeId: url.hostname };
  }
  function sameProduct(left, right) {
    return Boolean(left && right && left.sourcePlatform === right.sourcePlatform && left.sourceProductId === right.sourceProductId);
  }

  function create(options) {
    var config = options || {};
    var methods = ['getTab', 'sendToSourcePage', 'readDevice', 'randomNonce', 'now', 'resolveProductUrl'];
    if (methods.some(function (name) { return typeof config[name] !== 'function'; })) {
      throw admissionError('SS_ERP_PRECISION_SOURCE_DEPENDENCY_UNAVAILABLE');
    }
    var schedule = config.setTimeout || global.setTimeout;
    var cancel = config.clearTimeout || global.clearTimeout;
    if (typeof schedule !== 'function' || typeof cancel !== 'function') throw admissionError('SS_ERP_PRECISION_SOURCE_DEPENDENCY_UNAVAILABLE');
    var operations = new Set();
    var pending = new Map();

    function timestamp() {
      var value = config.now();
      if (!Number.isFinite(value)) throw admissionError('SS_ERP_PRECISION_SOURCE_CLOCK_INVALID');
      return value;
    }
    function product(url) {
      var resolved = config.resolveProductUrl(url.href);
      if (!exactKeys(resolved, ['sourcePlatform', 'sourceProductId']) || !PLATFORMS.includes(resolved.sourcePlatform)
        || !identifier(resolved.sourceProductId, 200)) return null;
      return { sourcePlatform: resolved.sourcePlatform, sourceProductId: resolved.sourceProductId };
    }
    function device(value) {
      if (!record(value) || value.state !== 'paired' || !identifier(value.ownerUserId, 200)
        || !identifier(value.sessionId, 200) || !Array.isArray(value.scopes) || !value.scopes.includes('listing:review')
        || typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt))
        || Date.parse(value.expiresAt) <= timestamp()) throw admissionError('SS_ERP_PRECISION_SOURCE_DEVICE_UNAVAILABLE');
      return { ownerUserId: value.ownerUserId, deviceSessionId: value.sessionId };
    }
    function finish(operation, error, result) {
      if (operation.settled) return;
      operation.settled = true;
      operations.delete(operation);
      if (operation.nonce && pending.get(operation.nonce) === operation) pending.delete(operation.nonce);
      cancel(operation.timer);
      if (error) operation.reject(error);
      else operation.resolve(Object.freeze(result));
    }
    function active(operation) {
      if (operation.settled) return false;
      if (timestamp() >= operation.expiresAt) {
        finish(operation, admissionError('SS_ERP_PRECISION_SOURCE_ATTESTATION_EXPIRED'));
        return false;
      }
      return true;
    }
    async function currentTab(operation) {
      var tab = await config.getTab(operation.frame.tabId);
      if (!active(operation)) return null;
      var url = record(tab) && tab.id === operation.frame.tabId ? sourceUrl(tab.url) : null;
      var source = url && product(url);
      if (!url || !source || operation.url && (operation.url.href !== url.href || !sameProduct(operation.source, source))) {
        throw admissionError('SS_ERP_PRECISION_SOURCE_CHANGED');
      }
      return { url: url, source: source };
    }
    async function prepare(operation) {
      try {
        var current = await currentTab(operation);
        if (!current) return;
        var authority = device(await config.readDevice());
        if (!active(operation)) return;
        var latest = await currentTab(operation);
        if (!latest || latest.url.href !== current.url.href || !sameProduct(latest.source, current.source)) {
          if (!operation.settled) throw admissionError('SS_ERP_PRECISION_SOURCE_CHANGED');
          return;
        }
        var nonce = config.randomNonce();
        if (typeof nonce !== 'string' || !/^[a-zA-Z0-9_-]{32,128}$/u.test(nonce) || !identifier(nonce, 128) || pending.has(nonce)) {
          throw admissionError('SS_ERP_PRECISION_SOURCE_NONCE_INVALID');
        }
        operation.url = current.url;
        operation.source = current.source;
        operation.authority = authority;
        operation.nonce = nonce;
        pending.set(nonce, operation);
        try {
          // A tabs.sendMessage response is transport acknowledgement, never source authority.
          await config.sendToSourcePage(operation.frame.tabId, Object.freeze({ type: QUERY_TYPE, nonce: nonce,
            sourcePlatform: current.source.sourcePlatform, sourceProductId: current.source.sourceProductId }), Object.freeze({ frameId: 0 }));
        } catch {
          finish(operation, admissionError('SS_ERP_PRECISION_SOURCE_ATTESTATION_TRANSPORT_FAILED'));
        }
      } catch (error) {
        finish(operation, safeError(error));
      }
    }
    function resolveSource(frameValue) {
      var frame;
      var expiresAt;
      try {
        frame = normalizeFrame(frameValue);
        if (operations.size >= MAX_PENDING) throw admissionError('SS_ERP_PRECISION_SOURCE_CAPACITY_EXHAUSTED');
        expiresAt = timestamp() + ATTESTATION_TTL_MS;
      } catch (error) { return Promise.reject(error); }
      return new Promise(function (resolve, reject) {
        var operation = { frame: frame, expiresAt: expiresAt, resolve: resolve, reject: reject, settled: false, accepting: false, nonce: null };
        operations.add(operation);
        operation.timer = schedule(function () {
          finish(operation, admissionError('SS_ERP_PRECISION_SOURCE_ATTESTATION_EXPIRED'));
        }, ATTESTATION_TTL_MS);
        prepare(operation);
      });
    }
    async function acceptAttestation(message, sender) {
      if (!exactKeys(message, ['type', 'nonce']) || message.type !== ACK_TYPE || typeof message.nonce !== 'string') return false;
      var operation = pending.get(message.nonce);
      if (!operation || !active(operation) || operation.accepting) return false;
      if (!record(sender) || sender.id !== operation.frame.runtimeId || sender.frameId !== 0
        || !identifier(sender.documentId, 200) || !record(sender.tab) || sender.tab.id !== operation.frame.tabId) return false;
      var url = sourceUrl(sender.url);
      var tabUrl = sourceUrl(sender.tab.url);
      if (!url || !tabUrl || url.href !== operation.url.href || tabUrl.href !== url.href || sender.origin !== url.origin
        || !sameProduct(product(url), operation.source) || !sameProduct(product(tabUrl), operation.source)) return false;
      operation.accepting = true;
      try {
        var current = await currentTab(operation);
        if (!current) return false;
        var authority = device(await config.readDevice());
        if (!active(operation)) return false;
        if (authority.ownerUserId !== operation.authority.ownerUserId || authority.deviceSessionId !== operation.authority.deviceSessionId) {
          throw admissionError('SS_ERP_PRECISION_SOURCE_DEVICE_CHANGED');
        }
        var latest = await currentTab(operation);
        if (!latest || !active(operation)) return false;
        finish(operation, null, { tabId: operation.frame.tabId, documentId: sender.documentId,
          sourcePlatform: operation.source.sourcePlatform, sourceProductId: operation.source.sourceProductId,
          ownerUserId: authority.ownerUserId, deviceSessionId: authority.deviceSessionId });
        return true;
      } catch (error) {
        finish(operation, safeError(error));
        return false;
      } finally { operation.accepting = false; }
    }
    function invalidateTab(tabId) {
      operations.forEach(function (operation) {
        if (operation.frame.tabId === tabId) finish(operation, admissionError('SS_ERP_PRECISION_SOURCE_INVALIDATED'));
      });
    }
    function clear() {
      operations.forEach(function (operation) { finish(operation, admissionError('SS_ERP_PRECISION_SOURCE_INVALIDATED')); });
    }
    return Object.freeze({ resolveSource: resolveSource, acceptAttestation: acceptAttestation, invalidateTab: invalidateTab, clear: clear });
  }
  global.SS_ERP_PRECISION_SOURCE_ADMISSION = Object.freeze({ CONTRACT_VERSION: CONTRACT_VERSION,
    ATTESTATION_TTL_MS: ATTESTATION_TTL_MS, MAX_PENDING: MAX_PENDING, create: create });
}(typeof globalThis !== 'undefined' ? globalThis : self));
