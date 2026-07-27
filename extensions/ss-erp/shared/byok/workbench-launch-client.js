(function exposeByokWorkbenchLaunchClient(global) {
  'use strict';

  var CONTRACT_VERSION = 'extension-byok-workbench-launch-client/v2';
  var REQUEST_VERSION = 'extension-byok-workbench-launch-request/v2';
  var DECISION_VERSION = 'extension-byok-workbench-launch-decision/v2';
  var CONTEXT_VERSION = 'extension-byok-workbench-launch-context/v1';
  var LAUNCH_PATH = '/api/extension-device/byok-media/workbench-launch';
  var SOURCE_PLATFORMS = ['1688', 'pdd', 'taobao', 'tmall'];
  var AUTHORITY_KEYS = [
    'sourcePlatform', 'sourceProductId', 'sourceCaptureSnapshotId', 'supplyGoodsId',
    'shopId', 'workflowId', 'draftRevision', 'draftVersion',
  ];
  var REQUEST_KEYS = [...AUTHORITY_KEYS, 'preferredSkuKey', 'selectionKind'];
  var CONTEXT_KEYS = [
    'contractVersion', ...AUTHORITY_KEYS, 'skuKey', 'slotKey', 'assignmentMode',
    'assignmentOrdinal',
  ];

  function launchError(code) {
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

  function text(value, maximum) {
    if (typeof value !== 'string' || !value || value.length > maximum
      || value !== value.normalize('NFKC').trim()
      || /[\u0000-\u001f\u007f]/u.test(value)
      || /[?#]/u.test(value)
      || /(?:https?|ftp|data):/iu.test(value)
      || /^(?:sk-[a-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|LTAI[a-zA-Z0-9]{12,}|AKID[a-zA-Z0-9]{12,})$/iu
        .test(value)
      || /^eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/u.test(value)
      || /(?:api[_-]?key|access[_-]?token|authorization|password|secret)\s*[:=]/iu.test(value)) {
      throw launchError('SS_ERP_BYOK_WORKBENCH_LAUNCH_INPUT_INVALID');
    }
    return value;
  }

  function positiveInteger(value) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw launchError('SS_ERP_BYOK_WORKBENCH_LAUNCH_INPUT_INVALID');
    }
    return value;
  }

  function normalizeAuthority(value) {
    if (!exactKeys(value, AUTHORITY_KEYS)) {
      throw launchError('SS_ERP_BYOK_WORKBENCH_LAUNCH_INPUT_INVALID');
    }
    var sourcePlatform = text(value.sourcePlatform, 16);
    if (!SOURCE_PLATFORMS.includes(sourcePlatform)) {
      throw launchError('SS_ERP_BYOK_WORKBENCH_LAUNCH_INPUT_INVALID');
    }
    return {
      sourcePlatform: sourcePlatform,
      sourceProductId: text(value.sourceProductId, 200),
      sourceCaptureSnapshotId: text(value.sourceCaptureSnapshotId, 200),
      supplyGoodsId: text(value.supplyGoodsId, 200),
      shopId: text(value.shopId, 200),
      workflowId: text(value.workflowId, 200),
      draftRevision: positiveInteger(value.draftRevision),
      draftVersion: positiveInteger(value.draftVersion),
    };
  }

  function normalizeRequest(value) {
    if (!exactKeys(value, REQUEST_KEYS)) {
      throw launchError('SS_ERP_BYOK_WORKBENCH_LAUNCH_INPUT_INVALID');
    }
    var authority = normalizeAuthority(Object.fromEntries(AUTHORITY_KEYS.map(function (key) {
      return [key, value[key]];
    })));
    var selectionKind = value.selectionKind;
    if (!['HINT', 'EXPLICIT'].includes(selectionKind)) {
      throw launchError('SS_ERP_BYOK_WORKBENCH_LAUNCH_INPUT_INVALID');
    }
    if (selectionKind === 'EXPLICIT' && value.preferredSkuKey === null) {
      throw launchError('SS_ERP_BYOK_WORKBENCH_LAUNCH_INPUT_INVALID');
    }
    return {
      ...authority,
      preferredSkuKey: value.preferredSkuKey === null ? null : text(value.preferredSkuKey, 500),
      selectionKind: selectionKind,
    };
  }

  function responseError() {
    return launchError('SS_ERP_BYOK_WORKBENCH_LAUNCH_RESPONSE_INVALID');
  }

  function responseAuthority(value, request) {
    var normalized;
    try {
      normalized = normalizeAuthority(value);
    } catch {
      throw responseError();
    }
    if (AUTHORITY_KEYS.some(function (key) { return normalized[key] !== request[key]; })) {
      throw responseError();
    }
    return normalized;
  }

  function normalizeContext(value, request) {
    if (!exactKeys(value, CONTEXT_KEYS) || value.contractVersion !== CONTEXT_VERSION) {
      throw launchError('SS_ERP_BYOK_WORKBENCH_LAUNCH_RESPONSE_INVALID');
    }
    var normalized;
    try {
      normalized = normalizeAuthority(Object.fromEntries(AUTHORITY_KEYS.map(function (key) {
        return [key, value[key]];
      })));
    } catch {
      throw launchError('SS_ERP_BYOK_WORKBENCH_LAUNCH_RESPONSE_INVALID');
    }
    if (AUTHORITY_KEYS.some(function (key) { return normalized[key] !== request[key]; })) {
      throw launchError('SS_ERP_BYOK_WORKBENCH_LAUNCH_RESPONSE_INVALID');
    }
    var skuKey;
    var slotKey;
    try {
      skuKey = text(value.skuKey, 500);
      slotKey = text(value.slotKey, 200);
    } catch {
      throw launchError('SS_ERP_BYOK_WORKBENCH_LAUNCH_RESPONSE_INVALID');
    }
    if (slotKey !== 'sku:' + skuKey + ':hero'
      || (request.preferredSkuKey !== null && request.preferredSkuKey !== skuKey)
      || value.assignmentMode !== 'APPEND'
      || !Number.isSafeInteger(value.assignmentOrdinal)
      || value.assignmentOrdinal < 0
      || value.assignmentOrdinal > 499) {
      throw launchError('SS_ERP_BYOK_WORKBENCH_LAUNCH_RESPONSE_INVALID');
    }
    return Object.freeze({
      contractVersion: CONTEXT_VERSION,
      ...normalized,
      skuKey: skuKey,
      slotKey: slotKey,
      assignmentMode: 'APPEND',
      assignmentOrdinal: value.assignmentOrdinal,
    });
  }

  function normalizeDecision(value, request) {
    if (!isRecord(value) || value.contractVersion !== DECISION_VERSION) {
      throw responseError();
    }
    if (value.state === 'READY') {
      if (!exactKeys(value, ['contractVersion', 'state', 'context'])) throw responseError();
      return Object.freeze({
        contractVersion: DECISION_VERSION,
        state: 'READY',
        context: normalizeContext(value.context, request),
      });
    }
    if (value.state !== 'CHOICE_REQUIRED'
      || !exactKeys(value, ['contractVersion', 'state', 'binding', 'skuKeys'])
      || request.selectionKind !== 'HINT'
      || !Array.isArray(value.skuKeys)
      || value.skuKeys.length < 1 || value.skuKeys.length > 500) {
      throw responseError();
    }
    var binding = responseAuthority(value.binding, request);
    var skuKeys;
    try {
      skuKeys = value.skuKeys.map(function (skuKey) { return text(skuKey, 500); });
    } catch {
      throw responseError();
    }
    if (new Set(skuKeys).size !== skuKeys.length) throw responseError();
    return Object.freeze({
      contractVersion: DECISION_VERSION,
      state: 'CHOICE_REQUIRED',
      binding: Object.freeze(binding),
      skuKeys: Object.freeze(skuKeys),
    });
  }

  function createClient(options) {
    var transport = options && options.transport;
    if (!transport || typeof transport.post !== 'function') {
      throw launchError('SS_ERP_BYOK_WORKBENCH_LAUNCH_DEPENDENCY_UNAVAILABLE');
    }
    return Object.freeze({
      async resolve(value) {
        var request = normalizeRequest(value);
        var response;
        try {
          response = await transport.post(LAUNCH_PATH, {
            contractVersion: REQUEST_VERSION,
            ...request,
          }, { requiredScope: 'listing:review' });
        } catch (cause) {
          var transportError = launchError('SS_ERP_BYOK_WORKBENCH_LAUNCH_UNAVAILABLE');
          transportError.state = cause && cause.state || 'transport_error';
          transportError.status = cause && cause.status || null;
          transportError.errorCode = cause && cause.errorCode || null;
          throw transportError;
        }
        if (!response || response.state !== 'response' || response.status !== 200
          || !exactKeys(response.body, ['code', 'data']) || response.body.code !== 1
          || !isRecord(response.body.data)) {
          var error = launchError('SS_ERP_BYOK_WORKBENCH_LAUNCH_UNAVAILABLE');
          error.state = response && response.state || 'invalid_response';
          error.status = response && response.status || null;
          error.errorCode = response && response.body && response.body.errorCode || null;
          throw error;
        }
        return normalizeDecision(response.body.data, request);
      },
    });
  }

  global.SS_ERP_BYOK_WORKBENCH_LAUNCH_CLIENT = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    REQUEST_VERSION: REQUEST_VERSION,
    DECISION_VERSION: DECISION_VERSION,
    CONTEXT_VERSION: CONTEXT_VERSION,
    LAUNCH_PATH: LAUNCH_PATH,
    createClient: createClient,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
