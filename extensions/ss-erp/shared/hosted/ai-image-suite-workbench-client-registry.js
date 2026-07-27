(function exposeHostedAiImageSuiteWorkbenchClientRegistry(global) {
  'use strict';

  var CONTRACT_VERSION = 'extension-hosted-ai-image-suite-workbench-client-registry/v1';
  var SENDER_KEYS = Object.freeze(['tabId', 'documentId', 'frameId']);
  var BINDING_KEYS = Object.freeze([
    'snapshotId', 'supplyGoodsId', 'shopId', 'listingWorkflowId',
    'draftRevision', 'draftVersion',
  ]);
  var REQUIRED_CLIENT_METHODS = Object.freeze([
    'getModeLock', 'createPlan', 'getCurrentPlan', 'getPlan', 'reviewPlan', 'loadSuite',
    'executeIntent', 'openPreview', 'assignApprovedOutputs', 'clear',
  ]);

  function registryError(code) {
    var error = new Error(code);
    error.name = 'ExtensionHostedAiImageSuiteWorkbenchClientRegistryError';
    error.code = code;
    return error;
  }

  function fail(code) {
    throw registryError(code);
  }

  function record(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
      ? value
      : null;
  }

  function exactKeys(value, keys) {
    var item = record(value);
    return Boolean(item)
      && Object.keys(item).length === keys.length
      && Object.keys(item).every(function (key) { return keys.includes(key); });
  }

  function hasControlCharacter(value) {
    for (var index = 0; index < value.length; index += 1) {
      var code = value.charCodeAt(index);
      if (code <= 31 || code === 127) return true;
    }
    return false;
  }

  function canonicalText(value, maximum, code) {
    if (typeof value !== 'string'
      || value.length < 1
      || value.length > maximum
      || value !== value.normalize('NFKC').trim()
      || hasControlCharacter(value)
      || /(?:https?|ftp|file|blob|data):/iu.test(value)
      || value.includes('?')
      || value.includes('#')) fail(code);
    return value;
  }

  function positiveInteger(value, code) {
    if (!Number.isSafeInteger(value) || value < 1) fail(code);
    return value;
  }

  function normalizeSender(value) {
    var code = 'SS_ERP_HOSTED_WORKBENCH_REGISTRY_SENDER_INVALID';
    if (!exactKeys(value, SENDER_KEYS)
      || !Number.isSafeInteger(value.tabId)
      || value.tabId < 0
      || value.frameId !== 0) fail(code);
    return Object.freeze({
      tabId: value.tabId,
      documentId: canonicalText(value.documentId, 200, code),
      frameId: 0,
    });
  }

  function normalizeBinding(value) {
    var code = 'SS_ERP_HOSTED_WORKBENCH_REGISTRY_BINDING_INVALID';
    if (!exactKeys(value, BINDING_KEYS)) fail(code);
    return Object.freeze({
      snapshotId: canonicalText(value.snapshotId, 200, code),
      supplyGoodsId: canonicalText(value.supplyGoodsId, 200, code),
      shopId: canonicalText(value.shopId, 200, code),
      listingWorkflowId: canonicalText(value.listingWorkflowId, 200, code),
      draftRevision: positiveInteger(value.draftRevision, code),
      draftVersion: positiveInteger(value.draftVersion, code),
    });
  }

  function sameBinding(left, right) {
    return BINDING_KEYS.every(function (key) { return left[key] === right[key]; });
  }

  function senderKey(sender) {
    return JSON.stringify([sender.tabId, sender.documentId, sender.frameId]);
  }

  function validClient(value) {
    if (!record(value) || !Object.isFrozen(value)
      || Object.getOwnPropertySymbols(value).length !== 0) return false;
    var names = Object.getOwnPropertyNames(value);
    return names.length === REQUIRED_CLIENT_METHODS.length
      && names.every(function (name) { return REQUIRED_CLIENT_METHODS.includes(name); })
      && REQUIRED_CLIENT_METHODS.every(function (name) {
        var descriptor = Object.getOwnPropertyDescriptor(value, name);
        return Boolean(descriptor)
          && Object.prototype.hasOwnProperty.call(descriptor, 'value')
          && typeof descriptor.value === 'function';
      });
  }

  function normalizeReason(value) {
    return canonicalText(value, 100, 'SS_ERP_HOSTED_WORKBENCH_REGISTRY_REASON_INVALID');
  }

  function createRegistry(options) {
    var createClient = options && options.createClient;
    if (typeof createClient !== 'function') {
      fail('SS_ERP_HOSTED_WORKBENCH_REGISTRY_DEPENDENCY_UNAVAILABLE');
    }

    var entries = new Map();
    var claimedClients = new WeakMap();

    function clearEntry(entry, reason) {
      var result;
      try {
        result = entry.client.clear(reason);
      } catch {
        fail('SS_ERP_HOSTED_WORKBENCH_REGISTRY_CLEAR_FAILED');
      }
      if (result && typeof result.then === 'function') {
        try { result.then(undefined, function () {}); } catch {}
        fail('SS_ERP_HOSTED_WORKBENCH_REGISTRY_CLEAR_FAILED');
      }
    }

    function clearEntries(selected, reason) {
      var failed = false;
      selected.forEach(function (entry) {
        try {
          clearEntry(entry, reason);
        } catch {
          failed = true;
        }
      });
      if (failed) fail('SS_ERP_HOSTED_WORKBENCH_REGISTRY_CLEAR_FAILED');
      return selected.length;
    }

    function getClient(senderValue, bindingValue) {
      var sender = normalizeSender(senderValue);
      var binding = normalizeBinding(bindingValue);
      var key = senderKey(sender);
      var existing = entries.get(key);
      if (existing && sameBinding(existing.binding, binding)) return existing.client;

      if (existing) {
        entries.delete(key);
        clearEntry(existing, 'binding_changed');
      }

      var candidate;
      try {
        candidate = createClient(Object.freeze({ sender: sender, binding: binding }));
      } catch {
        fail('SS_ERP_HOSTED_WORKBENCH_REGISTRY_FACTORY_FAILED');
      }
      if (!validClient(candidate)) {
        fail('SS_ERP_HOSTED_WORKBENCH_REGISTRY_CLIENT_INVALID');
      }
      if (claimedClients.has(candidate)) {
        fail('SS_ERP_HOSTED_WORKBENCH_REGISTRY_CLIENT_REUSED');
      }
      claimedClients.set(candidate, true);
      entries.set(key, Object.freeze({
        sender: sender,
        binding: binding,
        client: candidate,
      }));
      return candidate;
    }

    function clearSender(senderValue) {
      var sender = normalizeSender(senderValue);
      var key = senderKey(sender);
      var existing = entries.get(key);
      if (!existing) return 0;
      entries.delete(key);
      clearEntry(existing, 'sender_cleared');
      return 1;
    }

    function removeTab(tabId) {
      if (!Number.isSafeInteger(tabId) || tabId < 0) {
        fail('SS_ERP_HOSTED_WORKBENCH_REGISTRY_SENDER_INVALID');
      }
      var selected = [];
      entries.forEach(function (entry, key) {
        if (entry.sender.tabId !== tabId) return;
        entries.delete(key);
        selected.push(entry);
      });
      return clearEntries(selected, 'tab_removed');
    }

    function clearAll(reasonValue) {
      var reason = normalizeReason(reasonValue);
      var selected = Array.from(entries.values());
      entries.clear();
      return clearEntries(selected, reason);
    }

    return Object.freeze({
      getClient: getClient,
      removeTab: removeTab,
      clearSender: clearSender,
      clearAll: clearAll,
      size: function () { return entries.size; },
    });
  }

  global.SS_ERP_HOSTED_AI_IMAGE_SUITE_WORKBENCH_CLIENT_REGISTRY = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    REQUIRED_CLIENT_METHODS: REQUIRED_CLIENT_METHODS,
    createRegistry: createRegistry,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
