(function (root) {
  'use strict';

  function toFiniteNumber(value, fallback) {
    var number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
  }

  function toBoolean(value, fallback) {
    if (value === true || value === false) return value;
    return fallback;
  }

  function normalizeMode(value) {
    var mode = String(value || '').trim().toLowerCase();
    if (mode === 'complete' || mode === 'full') return 'complete';
    if (mode === 'balanced' || mode === 'hybrid') return 'balanced';
    return 'quick';
  }

  function resolveOzonCollectionPolicy(options) {
    var opts = options && typeof options === 'object' ? options : {};
    var mode = normalizeMode(opts.mode || opts.collectMode);
    var complete = mode === 'complete';
    var recursiveDefaultsEnabled = complete;
    var recursive = opts.recursive && typeof opts.recursive === 'object' ? opts.recursive : {};

    return {
      mode: mode,
      discoverVariants: toBoolean(opts.discoverVariants, complete),
      fetchRootSellerInsights: toBoolean(opts.fetchRootSellerInsights, true),
      fetchVariantSellerInsights: toBoolean(opts.fetchVariantSellerInsights, complete),
      rootProductDelayMs: toFiniteNumber(opts.rootProductDelayMs, complete ? 200 : 0),
      recursive: {
        maxPages: toFiniteNumber(recursive.maxPages != null ? recursive.maxPages : opts.recursiveMaxPages, recursiveDefaultsEnabled ? 120 : 0),
        maxDepth: toFiniteNumber(recursive.maxDepth != null ? recursive.maxDepth : opts.recursiveMaxDepth, recursiveDefaultsEnabled ? 3 : 0),
        delayMs: toFiniteNumber(recursive.delayMs != null ? recursive.delayMs : opts.recursiveDelayMs, 0),
      },
    };
  }

  root.SS_ERP_OZON_COLLECTION_POLICY = {
    resolveOzonCollectionPolicy: resolveOzonCollectionPolicy,
  };
}(typeof globalThis !== 'undefined' ? globalThis : window));
