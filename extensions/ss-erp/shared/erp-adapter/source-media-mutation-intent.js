(function (root) {
  'use strict';

  var ACTIONS = new Set(['REVIEW_APPROVE', 'REVIEW_REJECT', 'APPLY_APPEND']);
  var PLATFORMS = new Set(['1688', 'pdd', 'taobao', 'tmall']);
  var ALLOWED_KEYS = new Set([
    'identity', 'platform', 'sourceProductId', 'snapshotId', 'listingWorkflowId', 'shopId',
    'mediaWorkflowId', 'outputAssetId', 'action', 'expectedWorkflowRevision',
    'expectedTargetRevision', 'expectedTargetDraftVersion', 'createdAt',
  ]);

  function text(value, maximum) {
    var normalized = String(value == null ? '' : value).normalize('NFKC').trim();
    return normalized && normalized.length <= maximum ? normalized : '';
  }

  function platform(value) {
    var normalized = text(value, 20).toLowerCase();
    return PLATFORMS.has(normalized) ? normalized : '';
  }

  function positiveInteger(value) {
    return Number.isSafeInteger(value) && value > 0 ? value : 0;
  }

  function identity(value) {
    var normalizedPlatform = platform(value && value.platform);
    var sourceProductId = text(value && value.sourceProductId, 200);
    var listingWorkflowId = text(value && value.listingWorkflowId, 200);
    var mediaWorkflowId = text(value && value.mediaWorkflowId, 200);
    var outputAssetId = text(value && value.outputAssetId, 200);
    var action = ACTIONS.has(value && value.action) ? value.action : '';
    var expectedWorkflowRevision = positiveInteger(value && value.expectedWorkflowRevision);
    if (!normalizedPlatform || !sourceProductId || !listingWorkflowId || !mediaWorkflowId
      || !outputAssetId || !action || !expectedWorkflowRevision) return '';
    return [
      normalizedPlatform,
      sourceProductId,
      listingWorkflowId,
      mediaWorkflowId,
      outputAssetId,
      action,
      expectedWorkflowRevision,
    ].map(function (part) { return encodeURIComponent(String(part)); }).join(':');
  }

  function normalize(value, options) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some(function (key) { return !ALLOWED_KEYS.has(key); })) return null;
    var now = Number.isSafeInteger(options && options.now) ? options.now : Date.now();
    var ttlMs = positiveInteger(options && options.ttlMs);
    var expectedIdentity = text(options && options.expectedIdentity, 5000);
    var normalizedIdentity = identity(value);
    var snapshotId = text(value.snapshotId, 200);
    var shopId = text(value.shopId, 200);
    var expectedTargetRevision = positiveInteger(value.expectedTargetRevision);
    var expectedTargetDraftVersion = positiveInteger(value.expectedTargetDraftVersion);
    var createdAt = positiveInteger(value.createdAt);
    if (!ttlMs || !normalizedIdentity || !expectedIdentity
      || normalizedIdentity !== expectedIdentity || value.identity !== normalizedIdentity
      || !snapshotId || !shopId || !expectedTargetRevision || !expectedTargetDraftVersion
      || !createdAt || createdAt > now + 60 * 1000 || createdAt <= now - ttlMs) return null;
    return {
      identity: normalizedIdentity,
      platform: platform(value.platform),
      sourceProductId: text(value.sourceProductId, 200),
      snapshotId: snapshotId,
      listingWorkflowId: text(value.listingWorkflowId, 200),
      shopId: shopId,
      mediaWorkflowId: text(value.mediaWorkflowId, 200),
      outputAssetId: text(value.outputAssetId, 200),
      action: value.action,
      expectedWorkflowRevision: positiveInteger(value.expectedWorkflowRevision),
      expectedTargetRevision: expectedTargetRevision,
      expectedTargetDraftVersion: expectedTargetDraftVersion,
      createdAt: createdAt,
    };
  }

  function sameContext(left, right) {
    return left.snapshotId === right.snapshotId
      && left.shopId === right.shopId
      && left.expectedTargetRevision === right.expectedTargetRevision
      && left.expectedTargetDraftVersion === right.expectedTargetDraftVersion;
  }

  function createStore(options) {
    var storage = options && options.storage;
    var storageKey = text(options && options.storageKey, 500);
    var ttlMs = positiveInteger(options && options.ttlMs);
    var limit = positiveInteger(options && options.limit);
    var now = options && typeof options.now === 'function' ? options.now : Date.now;
    if (!storage || typeof storage.get !== 'function' || typeof storage.set !== 'function'
      || !storageKey || !ttlMs || !limit) throw new Error('media mutation intent store options are invalid');
    var writeQueue = Promise.resolve();

    function enqueue(operation) {
      var next = writeQueue.then(operation, operation);
      writeQueue = next.catch(function () {});
      return next;
    }

    function normalizeRecord(value, expectedIdentity, currentTime) {
      return normalize(value, {
        expectedIdentity: expectedIdentity,
        now: currentTime,
        ttlMs: ttlMs,
      });
    }

    async function read(identityValue) {
      var expectedIdentity = text(identityValue, 5000);
      if (!expectedIdentity) return null;
      var stored = await storage.get([storageKey]);
      var records = stored && stored[storageKey];
      if (!records || typeof records !== 'object' || Array.isArray(records)) return null;
      return normalizeRecord(records[expectedIdentity], expectedIdentity, now());
    }

    async function getOrCreate(input) {
      var expectedIdentity = identity(input);
      if (!expectedIdentity) throw new Error('ERP 媒体结果操作意图无效');
      return enqueue(async function () {
        var currentTime = now();
        var candidate = normalize({
          ...input,
          identity: expectedIdentity,
          createdAt: currentTime,
        }, {
          expectedIdentity: expectedIdentity,
          now: currentTime,
          ttlMs: ttlMs,
        });
        if (!candidate) throw new Error('ERP 媒体结果操作意图无效');
        var stored = await storage.get([storageKey]);
        var raw = stored && stored[storageKey];
        var records = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
        var existing = normalizeRecord(records[expectedIdentity], expectedIdentity, currentTime);
        if (existing) {
          if (!sameContext(existing, candidate)) {
            throw new Error('ERP 媒体结果操作意图上下文冲突');
          }
          return { intent: existing, replay: true };
        }
        records[expectedIdentity] = candidate;
        var bounded = Object.fromEntries(Object.entries(records)
          .map(function (entry) {
            return [entry[0], normalizeRecord(entry[1], entry[0], currentTime)];
          })
          .filter(function (entry) { return Boolean(entry[1]); })
          .sort(function (left, right) {
            return left[1].createdAt - right[1].createdAt || left[0].localeCompare(right[0]);
          })
          .slice(-limit));
        await storage.set({ [storageKey]: bounded });
        return { intent: candidate, replay: false };
      });
    }

    return { read: read, getOrCreate: getOrCreate };
  }

  root.SS_ERP_SOURCE_MEDIA_MUTATION_INTENT = {
    identity: identity,
    normalize: normalize,
    sameContext: sameContext,
    createStore: createStore,
  };
}(typeof globalThis !== 'undefined' ? globalThis : self));
