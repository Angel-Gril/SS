(function (root, factory) {
  var api = factory(root);
  root.SS_ERP_SOURCE_NETWORK_BRIDGE = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  var SOURCE = 'ss-erp-source-network-page';
  var BRIDGE_SOURCE = 'ss-erp-source-network-bridge';
  var STORE_LIMIT = 20;
  var TTL_MS = 120000;
  var MAX_CANDIDATE_BYTES = 65536;
  var MAX_TOTAL_BYTES = 524288;
  var POLICY_STORAGE_KEY = 'source_network_capture_policy';
  var RULES = {
    pdd: {
      signature: 'pdd.mobile.goods.detail.v2',
      url: 'api.pinduoduo.com/api/goods/detail',
      methods: ['GET', 'POST'],
    },
    taobao: {
      signature: 'mtop.taobao.detail.getdetail.v7',
      url: 'h5api.m.taobao.com/h5/mtop.taobao.detail.getdetail/7.0/',
      methods: ['GET', 'POST'],
    },
  };
  var state = {
    enabled: false,
    nonce: '',
    generation: 0,
    generationKey: '',
    platform: '',
    productId: '',
    candidates: [],
    degradations: [],
    totalBytes: 0,
    lastSequence: 0,
    policy: null,
  };

  function nowMs() {
    return typeof root.SS_ERP_SOURCE_NETWORK_NOW === 'function'
      ? Number(root.SS_ERP_SOURCE_NETWORK_NOW())
      : Date.now();
  }
  function pageIdentity() {
    var url = new URL(root.location.href);
    var host = url.hostname.toLowerCase();
    var platform = '';
    var productId = '';
    if (host === 'mobile.yangkeduo.com' && url.pathname === '/goods.html') {
      platform = 'pdd';
      productId = url.searchParams.get('goods_id') || '';
    } else if (
      (host === 'item.taobao.com' || host === 'detail.tmall.com') &&
      url.pathname === '/item.htm'
    ) {
      platform = 'taobao';
      productId = url.searchParams.get('id') || '';
    }
    return {
      platform: platform,
      productId: /^\d{4,32}$/.test(productId) ? productId : '',
      generationKey: host + url.pathname + ':' + productId,
    };
  }
  function randomNonce() {
    var bytes = new Uint8Array(16);
    root.crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map(function (value) { return value.toString(16).padStart(2, '0'); })
      .join('');
  }
  function degrade(reason) {
    state.degradations.push({
      reason: reason,
      observedAt: new Date(nowMs()).toISOString(),
      generation: state.generation,
    });
    if (state.degradations.length > 20) state.degradations.shift();
  }
  function reset(identity) {
    state.enabled = false;
    state.generation += 1;
    state.generationKey = identity.generationKey;
    state.platform = identity.platform;
    state.productId = identity.productId;
    state.nonce = randomNonce();
    state.candidates = [];
    state.degradations = [];
    state.totalBytes = 0;
    state.lastSequence = 0;
    return state.generation;
  }
  function policyShape(policy, identity) {
    if (!policy || policy.kind !== 'ss-erp-source-network-policy' || policy.source !== 'erp')
      return 'policy_missing';
    if (policy.enabled !== true) return 'policy_disabled';
    if (!Number.isSafeInteger(policy.revision) || policy.revision < 1) return 'policy_invalid';
    if (!Array.isArray(policy.platforms) || policy.platforms.indexOf(identity.platform) < 0)
      return 'platform_not_allowed';
    if (typeof policy.signature !== 'string' || policy.signature.length < 32) return 'policy_unsigned';
    var issuedAt = Date.parse(policy.issuedAt || '');
    var expiresAt = Date.parse(policy.expiresAt || '');
    var now = nowMs();
    if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || issuedAt > now || expiresAt <= now)
      return 'policy_expired';
    return null;
  }
  function synchronizeIdentity() {
    var identity = pageIdentity();
    if (
      identity.generationKey !== state.generationKey || identity.productId !== state.productId ||
      identity.platform !== state.platform
    ) {
      reset(identity);
      degrade('page_identity_changed');
      return false;
    }
    return true;
  }
  function ensurePolicyActive() {
    if (!synchronizeIdentity() || !state.enabled) return false;
    var reason = policyShape(state.policy, pageIdentity());
    if (reason) {
      state.enabled = false;
      degrade(reason);
      return false;
    }
    return true;
  }
  async function configurePolicy(policy) {
    var identity = pageIdentity();
    var generation = reset(identity);
    state.policy = policy && typeof policy === 'object' ? policy : null;
    if (root.top !== root) { degrade('not_top_frame'); return false; }
    if (!identity.productId) { degrade('unsupported_page_identity'); return false; }
    var shapeError = policyShape(policy, identity);
    if (shapeError) { degrade(shapeError); return false; }
    var verifier = root.SS_ERP_VERIFY_SOURCE_NETWORK_POLICY;
    // No trusted policy sync/verifier is shipped yet, so production remains fail-closed.
    if (typeof verifier !== 'function') {
      degrade('trusted_policy_verifier_unavailable');
      return false;
    }
    var verified = false;
    try {
      verified = (await verifier(policy, identity)) === true;
    } catch (_) {}
    if (generation !== state.generation) return false;
    if (!verified) { degrade('policy_signature_invalid'); return false; }
    state.enabled = true;
    root.postMessage({
      source: BRIDGE_SOURCE,
      type: 'SS_ERP_SOURCE_NETWORK_INIT',
      nonce: state.nonce,
      generation: state.generation,
      generationKey: state.generationKey,
      productId: state.productId,
      platform: state.platform,
    }, root.location.origin);
    return true;
  }
  function onMessage(event) {
    var data = event.data;
    if (
      !ensurePolicyActive() || event.source !== root || event.origin !== root.location.origin ||
      !data || data.source !== SOURCE || data.type !== 'SS_ERP_SOURCE_NETWORK_CANDIDATE'
    ) return;
    var identity = pageIdentity();
    if (
      data.nonce !== state.nonce || data.generation !== state.generation ||
      data.productId !== state.productId || data.platform !== state.platform ||
      identity.generationKey !== state.generationKey
    ) { degrade('stale_or_forged_channel'); return; }
    var rule = RULES[data.platform];
    var candidate = data.candidate;
    var now = nowMs();
    var observedAt = Number(data.observedAt);
    if (
      !rule || !candidate || !Number.isSafeInteger(observedAt) || observedAt > now ||
      now - observedAt > TTL_MS
    ) {
      degrade('candidate_budget_or_ttl'); return;
    }
    var serializedBody;
    try { serializedBody = JSON.stringify(candidate.body); } catch (_) {
      degrade('candidate_validation_failed'); return;
    }
    if (typeof serializedBody !== 'string') { degrade('candidate_validation_failed'); return; }
    var bytes = new TextEncoder().encode(serializedBody).length;
    var observedIso;
    try { observedIso = new Date(observedAt).toISOString(); } catch (_) {
      degrade('candidate_validation_failed'); return;
    }
    if (
      candidate.signature !== rule.signature || candidate.url !== rule.url ||
      rule.methods.indexOf(String(candidate.method || '').toUpperCase()) < 0 ||
      !Number.isSafeInteger(data.sequence) || data.sequence !== state.lastSequence + 1 ||
      data.sequence > STORE_LIMIT ||
      bytes > MAX_CANDIDATE_BYTES || state.totalBytes + bytes > MAX_TOTAL_BYTES ||
      Number(candidate.bytes) !== bytes || state.candidates.length >= STORE_LIMIT
    ) { degrade('candidate_validation_failed'); return; }
    state.lastSequence = data.sequence;
    var normalizer = data.platform === 'pdd'
      ? root.SS_ERP_PDD_NETWORK_NORMALIZER
      : root.SS_ERP_TAOBAO_NETWORK_NORMALIZER;
    var result = normalizer && normalizer.normalize
      ? normalizer.normalize(candidate, state.productId)
      : null;
    if (!result || !result.accepted) {
      degrade((result && result.reason) || 'normalizer_unavailable'); return;
    }
    state.totalBytes += bytes;
    state.candidates.push({
      observedAt: observedIso,
      candidate: candidate,
      source: result.source,
    });
  }
  function snapshot() {
    synchronizeIdentity();
    ensurePolicyActive();
    var cutoff = nowMs() - TTL_MS;
    var retained = state.candidates.filter(function (entry) {
      return Date.parse(entry.observedAt || '') >= cutoff;
    });
    if (retained.length !== state.candidates.length) {
      state.candidates = retained;
      state.totalBytes = retained.reduce(function (sum, entry) {
        return sum + Number(entry.candidate && entry.candidate.bytes || 0);
      }, 0);
      degrade('candidate_expired');
    }
    return {
      enabled: state.enabled,
      generation: state.generation,
      platform: state.platform,
      productId: state.productId,
      candidates: state.candidates.slice(),
      degradations: state.degradations.slice(),
    };
  }
  function navigationChanged() {
    void configurePolicy(state.policy);
  }
  function install() {
    root.addEventListener('message', onMessage);
    root.addEventListener('popstate', navigationChanged);
    root.addEventListener('hashchange', navigationChanged);
    ['pushState', 'replaceState'].forEach(function (method) {
      if (!root.history || typeof root.history[method] !== 'function') return;
      var original = root.history[method];
      root.history[method] = function () {
        var result = original.apply(this, arguments);
        navigationChanged();
        return result;
      };
    });
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['feature_source_network_capture', POLICY_STORAGE_KEY], function (values) {
        var localBooleanIgnored = values && values.feature_source_network_capture === true
          && !values[POLICY_STORAGE_KEY];
        void configurePolicy(values && values[POLICY_STORAGE_KEY]).then(function () {
          if (localBooleanIgnored) degrade('local_boolean_ignored');
        });
      if (chrome.storage.onChanged && typeof chrome.storage.onChanged.addListener === 'function') {
        chrome.storage.onChanged.addListener(function (changes, areaName) {
          if (areaName !== 'local' || !changes) return;
          if (changes[POLICY_STORAGE_KEY]) {
            void configurePolicy(changes[POLICY_STORAGE_KEY].newValue || null);
            return;
          }
          if (
            changes.feature_source_network_capture &&
            changes.feature_source_network_capture.newValue === true
          ) degrade('local_boolean_ignored');
        });
      }
      });
    } else void configurePolicy(null);
  }
  var api = {
    configurePolicy: configurePolicy,
    snapshot: snapshot,
    onMessage: onMessage,
    pageIdentity: pageIdentity,
    install: install,
    constants: { TTL_MS: TTL_MS, POLICY_STORAGE_KEY: POLICY_STORAGE_KEY },
  };
  if (root.window === root && root.document) install();
  return api;
});
