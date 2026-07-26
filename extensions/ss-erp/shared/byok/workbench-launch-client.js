(function exposeByokWorkbenchLaunchClient(global) {
  'use strict';

  var CONTRACT_VERSION = 'extension-byok-workbench-launch-client/v1';
  var REQUEST_VERSION = 'extension-byok-workbench-launch-request/v1';
  var CONTEXT_VERSION = 'extension-byok-workbench-launch-context/v1';
  var LAUNCH_PATH = '/api/extension-device/byok-media/workbench-launch';
  var SOURCE_PLATFORMS = ['1688', 'pdd', 'taobao', 'tmall'];
  var REQUEST_KEYS = [
    'sourcePlatform', 'sourceProductId', 'sourceCaptureSnapshotId', 'supplyGoodsId',
    'shopId', 'workflowId', 'draftRevision', 'draftVersion',
  ];
  var CONTEXT_KEYS = [
    'contractVersion', ...REQUEST_KEYS, 'skuKey', 'slotKey', 'assignmentMode',
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
      || /(?:https?|ftp|data):/iu.test(value)) {
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

  function normalizeRequest(value) {
    if (!exactKeys(value, REQUEST_KEYS)) {
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

  function normalizeContext(value, request) {
    if (!exactKeys(value, CONTEXT_KEYS) || value.contractVersion !== CONTEXT_VERSION) {
      throw launchError('SS_ERP_BYOK_WORKBENCH_LAUNCH_RESPONSE_INVALID');
    }
    var normalized;
    try {
      normalized = normalizeRequest(Object.fromEntries(REQUEST_KEYS.map(function (key) {
        return [key, value[key]];
      })));
    } catch (_error) {
      throw launchError('SS_ERP_BYOK_WORKBENCH_LAUNCH_RESPONSE_INVALID');
    }
    if (REQUEST_KEYS.some(function (key) { return normalized[key] !== request[key]; })) {
      throw launchError('SS_ERP_BYOK_WORKBENCH_LAUNCH_RESPONSE_INVALID');
    }
    var skuKey;
    var slotKey;
    try {
      skuKey = text(value.skuKey, 500);
      slotKey = text(value.slotKey, 200);
    } catch (_error) {
      throw launchError('SS_ERP_BYOK_WORKBENCH_LAUNCH_RESPONSE_INVALID');
    }
    if (slotKey !== 'sku:' + skuKey + ':hero'
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

  function createClient(options) {
    var transport = options && options.transport;
    if (!transport || typeof transport.post !== 'function') {
      throw launchError('SS_ERP_BYOK_WORKBENCH_LAUNCH_DEPENDENCY_UNAVAILABLE');
    }
    return Object.freeze({
      async resolve(value) {
        var request = normalizeRequest(value);
        var response = await transport.post(LAUNCH_PATH, {
          contractVersion: REQUEST_VERSION,
          ...request,
        }, { requiredScope: 'byok:media:ingest' });
        if (!response || response.state !== 'response' || response.status !== 200
          || !isRecord(response.body) || response.body.code !== 1
          || !isRecord(response.body.data)) {
          var error = launchError('SS_ERP_BYOK_WORKBENCH_LAUNCH_UNAVAILABLE');
          error.state = response && response.state || 'invalid_response';
          error.status = response && response.status || null;
          error.errorCode = response && response.body && response.body.errorCode || null;
          throw error;
        }
        return normalizeContext(response.body.data, request);
      },
    });
  }

  global.SS_ERP_BYOK_WORKBENCH_LAUNCH_CLIENT = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    REQUEST_VERSION: REQUEST_VERSION,
    CONTEXT_VERSION: CONTEXT_VERSION,
    LAUNCH_PATH: LAUNCH_PATH,
    createClient: createClient,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
