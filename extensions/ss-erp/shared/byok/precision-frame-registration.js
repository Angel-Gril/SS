(function exposePrecisionFrameRegistration(global) {
  'use strict';

  var CONTRACT_VERSION = 'extension-precision-frame-registration/v1';
  var STORAGE_KEY = 'ss-erp:precision:frame-registrations:v1';
  var DEFAULT_TTL_MS = 10 * 60 * 1000;
  var MAX_TTL_MS = 15 * 60 * 1000;
  var MAX_RETIRED_DOCUMENTS = 32;
  var SOURCE_KEYS = ['tabId', 'documentId', 'sourcePlatform', 'sourceProductId', 'ownerUserId', 'deviceSessionId'];
  var storageQueues = new WeakMap();

  function fail(code) {
    var error = new Error(code);
    error.code = code;
    throw error;
  }

  function record(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function exactKeys(value, keys) {
    return record(value) && Object.keys(value).length === keys.length
      && keys.every(function (key) { return Object.prototype.hasOwnProperty.call(value, key); });
  }

  function canonical(value, maximum) {
    return typeof value === 'string' && value.length > 0 && value.length <= maximum
      && value === value.normalize('NFKC').trim() && !/[\u0000-\u001f\u007f]/u.test(value);
  }

  function normalizeFrame(value, runtimeId, requireRuntime) {
    var expectedOrigin = 'chrome-extension://' + runtimeId;
    var tab = value && value.tab;
    var tabId = tab ? tab.id : value && value.tabId;
    var url = value && (value.url || value.documentUrl);
    if (!record(value) || (requireRuntime && value.id !== runtimeId)
      || (value.id !== undefined && value.id !== runtimeId)
      || !Number.isSafeInteger(tabId) || tabId < 0
      || !Number.isSafeInteger(value.frameId) || value.frameId < 1
      || !canonical(value.documentId, 200)
      || url !== expectedOrigin + '/pages/precision-workbench.html'
      || value.origin !== expectedOrigin
      || (value.documentUrl !== undefined && value.documentUrl !== url)) {
      fail('PRECISION_FRAME_SENDER_DENIED');
    }
    return Object.freeze({ tabId: tabId, frameId: value.frameId, documentId: value.documentId, url: url, origin: expectedOrigin });
  }

  function normalizeSource(value, frame) {
    if (!exactKeys(value, SOURCE_KEYS) || value.tabId !== frame.tabId
      || !['1688', 'taobao', 'tmall', 'pdd'].includes(value.sourcePlatform)
      || !SOURCE_KEYS.filter(function (key) { return key !== 'tabId'; }).every(function (key) { return canonical(value[key], 200); })) {
      fail('PRECISION_FRAME_SOURCE_STALE');
    }
    return Object.freeze(Object.fromEntries(SOURCE_KEYS.map(function (key) { return [key, value[key]]; })));
  }

  function equal(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function createRegistry(options) {
    var storage = options && options.sessionStorage;
    var runtimeId = options && options.runtimeId;
    var resolveSource = options && options.resolveSource;
    var validateMediaContext = options && options.validateMediaContext;
    var normalizeMediaContext = options && options.normalizeMediaContext;
    var now = options && options.now || Date.now;
    var ttlMs = options && options.ttlMs || DEFAULT_TTL_MS;
    var limit = options && options.limit || 8;
    if (!storage || typeof storage.get !== 'function' || typeof storage.set !== 'function'
      || !canonical(runtimeId, 200) || !/^[a-z0-9-]+$/u.test(runtimeId)
      || typeof resolveSource !== 'function' || typeof validateMediaContext !== 'function'
      || typeof normalizeMediaContext !== 'function' || typeof now !== 'function'
      || !Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > MAX_TTL_MS
      || !Number.isSafeInteger(limit) || limit < 1 || limit > 32) {
      throw new TypeError('Precision frame registration dependencies are unavailable');
    }

    function currentTime() {
      var current = Number(now());
      if (!Number.isSafeInteger(current) || current < 0) fail('PRECISION_FRAME_STATE_INVALID');
      return current;
    }

    function enqueue(operation) {
      var previous = storageQueues.get(storage) || Promise.resolve();
      var next = previous.then(operation, operation);
      storageQueues.set(storage, next.catch(function () {}));
      return next;
    }

    async function load() {
      var stored = await storage.get([STORAGE_KEY]);
      var value = stored && stored[STORAGE_KEY];
      if (value === undefined) return { contractVersion: CONTRACT_VERSION, revision: 0, records: {} };
      if (!exactKeys(value, ['contractVersion', 'revision', 'records'])
        || value.contractVersion !== CONTRACT_VERSION || !Number.isSafeInteger(value.revision) || value.revision < 0
        || !record(value.records) || Object.keys(value.records).length > 32) fail('PRECISION_FRAME_STATE_INVALID');
      Object.keys(value.records).forEach(function (key) {
        var entry = value.records[key];
        if (!exactKeys(entry, ['frame', 'source', 'state', 'context', 'retiredDocumentIds', 'createdAt', 'expiresAt'])
          || String(entry.frame && entry.frame.tabId) !== key
          || !['UI_REGISTERED', 'MEDIA_READY'].includes(entry.state)
          || !Array.isArray(entry.retiredDocumentIds) || entry.retiredDocumentIds.length > MAX_RETIRED_DOCUMENTS
          || new Set(entry.retiredDocumentIds).size !== entry.retiredDocumentIds.length
          || entry.retiredDocumentIds.some(function (id) { return !canonical(id, 200) || id === entry.frame.documentId; })
          || !Number.isSafeInteger(entry.createdAt) || !Number.isSafeInteger(entry.expiresAt)
          || entry.expiresAt <= entry.createdAt || entry.expiresAt - entry.createdAt > ttlMs
          || entry.createdAt > currentTime() + 60 * 1000) fail('PRECISION_FRAME_STATE_INVALID');
        entry.frame = normalizeFrame(entry.frame, runtimeId, false);
        entry.source = normalizeSource(entry.source, entry.frame);
        if (entry.state === 'UI_REGISTERED' && entry.context !== null) fail('PRECISION_FRAME_STATE_INVALID');
        if (entry.state === 'MEDIA_READY') {
          entry.context = normalizeMediaContext(entry.context);
          if (entry.context.sourcePlatform !== entry.source.sourcePlatform
            || entry.context.sourceProductId !== entry.source.sourceProductId) fail('PRECISION_FRAME_STATE_INVALID');
        }
      });
      return value;
    }

    async function save(state) {
      if (!Number.isSafeInteger(state.revision + 1)) fail('PRECISION_FRAME_STATE_INVALID');
      state.revision += 1;
      await storage.set({ [STORAGE_KEY]: state });
    }

    async function sourceFor(frame) {
      var source;
      try { source = await resolveSource(frame); } catch (_error) { fail('PRECISION_FRAME_SOURCE_STALE'); }
      return normalizeSource(source, frame);
    }

    async function registerFrame(sender) {
      var frame = normalizeFrame(sender, runtimeId, true);
      var observed = await load();
      var frameKey = String(frame.tabId);
      var observedEntry = observed.records[frameKey];

      // =================================================================
      // 幂等路径（2026-11）
      // -----------------------------------------------------------------
      // 原实现无条件先走 sourceFor() → resolveSource() → attestation，
      // 而 attestation 依赖 source 页面在 TTL 内回 ACK。
      // 结果是：即使已有完全有效的注册记录，任何一次 ACK 抖动都会让
      // 重复注册整体失败，工作台于是反复显示「扩展注册失败」。
      // 这里在 frame（tabId + frameId + documentId）完全一致且未过期时，
      // 直接续期，不再触发 attestation —— O(1)、零网络、零竞态。
      // 只有页面 reload（新 frameId/documentId）才需要重新取证。
      // =================================================================
      if (observedEntry
        && observedEntry.expiresAt > currentTime()
        && equal(observedEntry.frame, frame)
        && ['UI_REGISTERED', 'MEDIA_READY'].includes(observedEntry.state)) {
        return enqueue(async function () {
          var state = await load();
          if (state.revision !== observed.revision) fail('PRECISION_FRAME_STATE_CHANGED');
          var entry = state.records[frameKey];
          if (!entry || !equal(entry.frame, frame)) fail('PRECISION_FRAME_SENDER_DENIED');
          var renewedAt = currentTime();
          // createdAt 必须同步推进：load() 会校验 expiresAt - createdAt <= ttlMs
          entry.createdAt = renewedAt;
          entry.expiresAt = renewedAt + ttlMs;
          await save(state);
          return Object.freeze({ state: entry.state, registered: true, renewed: true });
        });
      }

      var source = await sourceFor(frame);
      return enqueue(async function () {
        var state = await load();
        if (state.revision !== observed.revision) fail('PRECISION_FRAME_STATE_CHANGED');
        var key = String(frame.tabId);
        var previous = state.records[key];
        if (previous && previous.retiredDocumentIds.includes(frame.documentId)) fail('PRECISION_FRAME_DOCUMENT_RETIRED');
        if (previous && equal(previous.source, source) && previous.frame.frameId !== frame.frameId) fail('PRECISION_FRAME_SENDER_DENIED');
        var current = currentTime();
        if (!previous && Object.keys(state.records).length >= limit) {
          var expired = Object.keys(state.records).find(function (candidate) { return state.records[candidate].expiresAt <= current; });
          if (expired === undefined) fail('PRECISION_FRAME_CAPACITY_EXCEEDED');
          delete state.records[expired];
        }
        var retired = previous ? previous.retiredDocumentIds.slice() : [];
        var sameDocument = previous && equal(previous.frame, frame) && equal(previous.source, source);
        if (previous && previous.frame.documentId !== frame.documentId) {
          if (retired.length >= MAX_RETIRED_DOCUMENTS) fail('PRECISION_FRAME_DOCUMENT_FENCE_LIMIT');
          retired.push(previous.frame.documentId);
        }
        state.records[key] = {
          frame: frame, source: source,
          state: sameDocument && previous.expiresAt > current ? previous.state : 'UI_REGISTERED',
          context: sameDocument && previous.expiresAt > current ? previous.context : null,
          retiredDocumentIds: retired, createdAt: current, expiresAt: current + ttlMs,
        };
        await save(state);
        return Object.freeze({ state: state.records[key].state, registered: true });
      });
    }

    async function observe(sender, mediaRequired) {
      var frame = normalizeFrame(sender, runtimeId, false);
      var state = await load();
      var entry = state.records[String(frame.tabId)];
      if (!entry || entry.expiresAt <= currentTime()) fail('PRECISION_FRAME_NOT_REGISTERED');
      if (!equal(entry.frame, frame)) fail('PRECISION_FRAME_SENDER_DENIED');
      if (!equal(entry.source, await sourceFor(frame))) fail('PRECISION_FRAME_SOURCE_STALE');
      if (mediaRequired === true && entry.state !== 'MEDIA_READY') fail('PRECISION_FRAME_MEDIA_NOT_READY');
      var current = await load();
      if (current.revision !== state.revision) fail('PRECISION_FRAME_STATE_CHANGED');
      return { state: current, entry: entry };
    }

    async function claimFrame(sender, requirements) {
      return (await observe(sender, requirements && requirements.mediaRequired)).entry;
    }

    async function bindMedia(sender, contextValue) {
      var observed = await observe(sender, false);
      var context;
      var verified;
      try {
        context = normalizeMediaContext(contextValue);
        verified = normalizeMediaContext(await validateMediaContext({
          frame: observed.entry.frame, source: observed.entry.source, context: context,
        }));
      } catch (_error) { fail('PRECISION_FRAME_MEDIA_CONTEXT_STALE'); }
      if (!equal(verified, context) || context.sourcePlatform !== observed.entry.source.sourcePlatform
        || context.sourceProductId !== observed.entry.source.sourceProductId) fail('PRECISION_FRAME_MEDIA_CONTEXT_STALE');
      return enqueue(async function () {
        var state = await load();
        if (state.revision !== observed.state.revision) fail('PRECISION_FRAME_STATE_CHANGED');
        var key = String(observed.entry.frame.tabId);
        state.records[key] = Object.assign({}, state.records[key], { state: 'MEDIA_READY', context: context });
        await save(state);
        return Object.freeze({ state: 'MEDIA_READY' });
      });
    }

    async function getFrameBySource(sourceSender) {
      if (!record(sourceSender) || !Number.isSafeInteger(sourceSender.tabId) || !canonical(sourceSender.documentId, 200)) {
        fail('PRECISION_FRAME_SOURCE_STALE');
      }
      var state = await load();
      var entry = state.records[String(sourceSender.tabId)];
      if (!entry || entry.source.documentId !== sourceSender.documentId) fail('PRECISION_FRAME_NOT_REGISTERED');
      return claimFrame(entry.frame);
    }

    async function invalidateTab(tabId) {
      if (!Number.isSafeInteger(tabId) || tabId < 0) fail('PRECISION_FRAME_SENDER_DENIED');
      return enqueue(async function () {
        var state = await load();
        delete state.records[String(tabId)];
        await save(state);
      });
    }

    async function clear() {
      return enqueue(async function () {
        var state = await load();
        state.records = {};
        await save(state);
      });
    }

    return Object.freeze({
      registerFrame: registerFrame, claimFrame: claimFrame, bindMedia: bindMedia,
      getFrameBySource: getFrameBySource, invalidateTab: invalidateTab, clear: clear,
      authorizeEmbeddedFrame: async function (input) { return (await claimFrame(input.sender, input)).state; },
    });
  }

  global.SS_ERP_PRECISION_FRAME_REGISTRATION = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION, STORAGE_KEY: STORAGE_KEY, DEFAULT_TTL_MS: DEFAULT_TTL_MS,
    createRegistry: createRegistry,
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
