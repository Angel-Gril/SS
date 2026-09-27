(function (root) {
  'use strict';

  var CONTRACT_VERSION = 'ss-erp-donor-prompt-handoff/v1';
  var DRAFT_VERSION = 'ss-erp-donor-prompt-prefill/v1';
  var STORAGE_KEY = 'ss-erp:donor-workbench:prompt-handoffs:v1';
  var DEFAULT_TTL_MS = 10 * 60 * 1000;
  var MAX_TTL_MS = 15 * 60 * 1000;
  var BINDING_KEYS = [
    'sourcePlatform', 'sourceProductId', 'sourceCaptureSnapshotId', 'supplyGoodsId',
    'shopId', 'workflowId', 'draftRevision', 'draftVersion', 'skuKey',
  ];

  function fail() { throw new TypeError('donor prompt handoff is invalid'); }
  function record(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : null; }
  function exactKeys(value, keys) {
    var item = record(value);
    return Boolean(item) && Object.keys(item).length === keys.length
      && Object.keys(item).every(function (key) { return keys.includes(key); });
  }
  function id(value, maximum) {
    if (typeof value !== 'string' || !value || value !== value.normalize('NFKC').trim()
      || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) fail();
    return value;
  }
  function revision(value) {
    if (!Number.isSafeInteger(value) || value < 1) fail();
    return value;
  }
  function safePrompt(value, maximum, allowEmpty) {
    if (typeof value !== 'string' || value.length > maximum) fail();
    var normalized = value.normalize('NFKC').trim();
    if (!allowEmpty && !normalized) fail();
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(normalized)
      || /^data:/imu.test(normalized)
      || /\bbearer\s+[a-z0-9._~+/=-]{8,}/iu.test(normalized)
      || /\b(?:sk|rk)[-_][a-z0-9._-]{12,}/iu.test(normalized)
      || /\b(?:api[_-]?key|access[_-]?token|authorization|password|secret)\s*[:=]/iu.test(normalized)
      || /\beyJ[a-z0-9_-]{16,}\.[a-z0-9_-]{8,}\./iu.test(normalized)) fail();
    return normalized;
  }
  function normalizeBinding(value) {
    if (!exactKeys(value, BINDING_KEYS)) fail();
    var platform = id(value.sourcePlatform, 16);
    if (!['1688', 'pdd', 'taobao', 'tmall'].includes(platform)) fail();
    return Object.freeze({
      sourcePlatform: platform,
      sourceProductId: id(value.sourceProductId, 200),
      sourceCaptureSnapshotId: id(value.sourceCaptureSnapshotId, 200),
      supplyGoodsId: id(value.supplyGoodsId, 200),
      shopId: id(value.shopId, 200),
      workflowId: id(value.workflowId, 200),
      draftRevision: revision(value.draftRevision),
      draftVersion: revision(value.draftVersion),
      skuKey: id(value.skuKey, 500),
    });
  }
  function normalizeDraft(value) {
    if (!exactKeys(value, ['contractVersion', 'prompt', 'negativePrompt'])
      || value.contractVersion !== DRAFT_VERSION) fail();
    return Object.freeze({
      contractVersion: DRAFT_VERSION,
      prompt: safePrompt(value.prompt, 8000, false),
      negativePrompt: safePrompt(value.negativePrompt, 4000, true),
    });
  }
  function tabId(value) {
    if (!Number.isSafeInteger(value) || value < 0) fail();
    return value;
  }
  function sameBinding(left, right) {
    return BINDING_KEYS.every(function (key) { return left[key] === right[key]; });
  }

  function createStore(options) {
    var storage = options && options.storage;
    var now = options && typeof options.now === 'function' ? options.now : Date.now;
    var ttlMs = Number(options && options.ttlMs) || DEFAULT_TTL_MS;
    if (!storage || typeof storage.get !== 'function' || typeof storage.set !== 'function'
      || typeof storage.remove !== 'function' || !Number.isSafeInteger(ttlMs)
      || ttlMs < 1 || ttlMs > MAX_TTL_MS) fail();
    var queue = Promise.resolve();
    function enqueue(operation) {
      var next = queue.then(operation, operation);
      queue = next.catch(function () {});
      return next;
    }
    function currentTime() {
      var value = Number(now());
      if (!Number.isSafeInteger(value)) fail();
      return value;
    }
    async function read(current) {
      var result = await storage.get([STORAGE_KEY]);
      var raw = record(result && result[STORAGE_KEY]) || {};
      var records = {};
      Object.keys(raw).forEach(function (key) {
        var candidate = record(raw[key]);
        try {
          if (!candidate || !exactKeys(candidate, ['binding', 'draft', 'createdAt', 'expiresAt'])) return;
          var binding = normalizeBinding(candidate.binding);
          var draft = normalizeDraft(candidate.draft);
          if (!Number.isSafeInteger(candidate.createdAt) || !Number.isSafeInteger(candidate.expiresAt)
            || candidate.expiresAt <= current || candidate.expiresAt - candidate.createdAt > ttlMs) return;
          records[key] = { binding: binding, draft: draft, createdAt: candidate.createdAt, expiresAt: candidate.expiresAt };
        } catch {}
      });
      return records;
    }
    async function write(records) {
      if (Object.keys(records).length) await storage.set({ [STORAGE_KEY]: records });
      else await storage.remove([STORAGE_KEY]);
    }
    return Object.freeze({
      stage: function (input) {
        return enqueue(async function () {
          var tab = tabId(input && input.tabId);
          var binding = normalizeBinding(input && input.binding);
          var draft = normalizeDraft(input && input.draft);
          var current = currentTime();
          var records = await read(current);
          records[String(tab)] = { binding: binding, draft: draft, createdAt: current, expiresAt: current + ttlMs };
          await write(records);
          return true;
        });
      },
      consume: function (input) {
        return enqueue(async function () {
          var tab = tabId(input && input.tabId);
          var binding = normalizeBinding(input && input.binding);
          var current = currentTime();
          var records = await read(current);
          var candidate = records[String(tab)] || null;
          delete records[String(tab)];
          await write(records);
          if (!candidate || !sameBinding(candidate.binding, binding)) {
            return Object.freeze({ contractVersion: CONTRACT_VERSION, state: 'empty', prompt: null, negativePrompt: null });
          }
          return Object.freeze({
            contractVersion: CONTRACT_VERSION,
            state: 'ready',
            prompt: candidate.draft.prompt,
            negativePrompt: candidate.draft.negativePrompt,
          });
        });
      },
      clearTab: function (value) {
        return enqueue(async function () {
          var tab = tabId(value);
          var records = await read(currentTime());
          var existed = Object.prototype.hasOwnProperty.call(records, String(tab));
          delete records[String(tab)];
          await write(records);
          return existed;
        });
      },
    });
  }

  root.SS_ERP_DONOR_PROMPT_HANDOFF = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    DRAFT_VERSION: DRAFT_VERSION,
    parseDraft: normalizeDraft,
    createStore: createStore,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
