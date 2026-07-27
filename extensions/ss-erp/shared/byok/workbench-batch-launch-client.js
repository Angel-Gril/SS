(function exposeByokWorkbenchBatchLaunchClient(global) {
  'use strict';

  var CONTRACT_VERSION = 'extension-byok-workbench-batch-launch-client/v2';
  var REQUEST_VERSION = 'extension-byok-workbench-launch-request/v2';
  var CONTEXT_VERSION = 'extension-byok-workbench-batch-launch-context/v1';
  var LAUNCH_PATH = '/api/extension-device/byok-media/workbench-batch-launch';
  var AUTHORITY_KEYS = [
    'sourcePlatform', 'sourceProductId', 'sourceCaptureSnapshotId', 'supplyGoodsId',
    'shopId', 'workflowId', 'draftRevision', 'draftVersion',
  ];
  var REQUEST_KEYS = [...AUTHORITY_KEYS, 'preferredSkuKey', 'selectionKind'];
  var CONTEXT_KEYS = [
    'contractVersion', ...AUTHORITY_KEYS, 'anchorSkuKey', 'firstAssignmentOrdinal', 'targets',
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

  function text(value, maximum, response) {
    if (typeof value !== 'string' || !value || value.length > maximum
      || value !== value.normalize('NFKC').trim()
      || /[\u0000-\u001f\u007f]/u.test(value) || /[?#]/u.test(value)
      || /(?:https?|ftp|data):/iu.test(value)
      || /^(?:sk-[a-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|LTAI[a-zA-Z0-9]{12,}|AKID[a-zA-Z0-9]{12,})$/iu
        .test(value)
      || /^eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/u.test(value)
      || /(?:api[_-]?key|access[_-]?token|authorization|password|secret)\s*[:=]/iu.test(value)) {
      throw launchError(response
        ? 'SS_ERP_BYOK_WORKBENCH_BATCH_LAUNCH_RESPONSE_INVALID'
        : 'SS_ERP_BYOK_WORKBENCH_BATCH_LAUNCH_INPUT_INVALID');
    }
    return value;
  }

  function positiveInteger(value, response) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw launchError(response
        ? 'SS_ERP_BYOK_WORKBENCH_BATCH_LAUNCH_RESPONSE_INVALID'
        : 'SS_ERP_BYOK_WORKBENCH_BATCH_LAUNCH_INPUT_INVALID');
    }
    return value;
  }

  function normalizeAuthority(value, response) {
    if (!exactKeys(value, AUTHORITY_KEYS)) {
      throw launchError(response
        ? 'SS_ERP_BYOK_WORKBENCH_BATCH_LAUNCH_RESPONSE_INVALID'
        : 'SS_ERP_BYOK_WORKBENCH_BATCH_LAUNCH_INPUT_INVALID');
    }
    var sourcePlatform = text(value.sourcePlatform, 16, response);
    if (!['1688', 'pdd', 'taobao', 'tmall'].includes(sourcePlatform)) {
      throw launchError(response
        ? 'SS_ERP_BYOK_WORKBENCH_BATCH_LAUNCH_RESPONSE_INVALID'
        : 'SS_ERP_BYOK_WORKBENCH_BATCH_LAUNCH_INPUT_INVALID');
    }
    return {
      sourcePlatform: sourcePlatform,
      sourceProductId: text(value.sourceProductId, 200, response),
      sourceCaptureSnapshotId: text(value.sourceCaptureSnapshotId, 200, response),
      supplyGoodsId: text(value.supplyGoodsId, 200, response),
      shopId: text(value.shopId, 200, response),
      workflowId: text(value.workflowId, 200, response),
      draftRevision: positiveInteger(value.draftRevision, response),
      draftVersion: positiveInteger(value.draftVersion, response),
    };
  }

  function normalizeRequest(value, response) {
    if (!exactKeys(value, REQUEST_KEYS)) {
      throw launchError(response
        ? 'SS_ERP_BYOK_WORKBENCH_BATCH_LAUNCH_RESPONSE_INVALID'
        : 'SS_ERP_BYOK_WORKBENCH_BATCH_LAUNCH_INPUT_INVALID');
    }
    var authority = normalizeAuthority(Object.fromEntries(AUTHORITY_KEYS.map(function (key) {
      return [key, value[key]];
    })), response);
    if (value.selectionKind !== 'EXPLICIT') {
      throw launchError(response
        ? 'SS_ERP_BYOK_WORKBENCH_BATCH_LAUNCH_RESPONSE_INVALID'
        : 'SS_ERP_BYOK_WORKBENCH_BATCH_LAUNCH_INPUT_INVALID');
    }
    return {
      ...authority,
      preferredSkuKey: text(value.preferredSkuKey, 500, response),
      selectionKind: 'EXPLICIT',
    };
  }

  function normalizeContext(value, request) {
    if (!exactKeys(value, CONTEXT_KEYS) || value.contractVersion !== CONTEXT_VERSION
      || !Array.isArray(value.targets) || value.targets.length < 1 || value.targets.length > 500
      || !Number.isSafeInteger(value.firstAssignmentOrdinal)
      || value.firstAssignmentOrdinal < 0 || value.firstAssignmentOrdinal > 499) {
      throw launchError('SS_ERP_BYOK_WORKBENCH_BATCH_LAUNCH_RESPONSE_INVALID');
    }
    var base = normalizeAuthority(Object.fromEntries(AUTHORITY_KEYS.map(function (key) {
      return [key, value[key]];
    })), true);
    if (AUTHORITY_KEYS.some(function (key) { return base[key] !== request[key]; })) {
      throw launchError('SS_ERP_BYOK_WORKBENCH_BATCH_LAUNCH_RESPONSE_INVALID');
    }
    var anchorSkuKey = text(value.anchorSkuKey, 500, true);
    if (anchorSkuKey !== request.preferredSkuKey) {
      throw launchError('SS_ERP_BYOK_WORKBENCH_BATCH_LAUNCH_RESPONSE_INVALID');
    }
    var detailSeen = false;
    var targets = value.targets.map(function (target) {
      if (!exactKeys(target, ['skuKey', 'slotKey'])) {
        throw launchError('SS_ERP_BYOK_WORKBENCH_BATCH_LAUNCH_RESPONSE_INVALID');
      }
      var skuKey = text(target.skuKey, 500, true);
      var slotKey = text(target.slotKey, 200, true);
      var shared = ['SCENE', 'DETAIL', 'SPEC', 'PACKAGING'].some(function (role) {
        return slotKey === 'shared:detail:' + role;
      });
      if (shared) detailSeen = true;
      if ((!shared && (detailSeen || slotKey !== 'sku:' + skuKey + ':hero'))
        || (shared && skuKey !== anchorSkuKey)) {
        throw launchError('SS_ERP_BYOK_WORKBENCH_BATCH_LAUNCH_RESPONSE_INVALID');
      }
      return Object.freeze({ skuKey: skuKey, slotKey: slotKey });
    });
    if (new Set(targets.map(function (target) { return target.slotKey; })).size !== targets.length) {
      throw launchError('SS_ERP_BYOK_WORKBENCH_BATCH_LAUNCH_RESPONSE_INVALID');
    }
    if (targets[0].skuKey !== anchorSkuKey
      || targets[0].slotKey !== 'sku:' + anchorSkuKey + ':hero') {
      throw launchError('SS_ERP_BYOK_WORKBENCH_BATCH_LAUNCH_RESPONSE_INVALID');
    }
    return Object.freeze({
      contractVersion: CONTEXT_VERSION,
      ...base,
      anchorSkuKey: anchorSkuKey,
      firstAssignmentOrdinal: value.firstAssignmentOrdinal,
      targets: Object.freeze(targets),
    });
  }

  function createClient(options) {
    var transport = options && options.transport;
    if (!transport || typeof transport.post !== 'function') {
      throw launchError('SS_ERP_BYOK_WORKBENCH_BATCH_LAUNCH_DEPENDENCY_UNAVAILABLE');
    }
    return Object.freeze({
      async resolve(value) {
        var request = normalizeRequest(value, false);
        var response;
        try {
          response = await transport.post(LAUNCH_PATH, {
            contractVersion: REQUEST_VERSION,
            ...request,
          }, { requiredScope: 'listing:review' });
        } catch (cause) {
          var transportError = launchError('SS_ERP_BYOK_WORKBENCH_BATCH_LAUNCH_UNAVAILABLE');
          transportError.state = cause && cause.state || 'transport_error';
          transportError.status = cause && cause.status || null;
          transportError.errorCode = cause && cause.errorCode || null;
          throw transportError;
        }
        if (!response || response.state !== 'response' || response.status !== 200
          || !exactKeys(response.body, ['code', 'data']) || response.body.code !== 1
          || !isRecord(response.body.data)) {
          var error = launchError('SS_ERP_BYOK_WORKBENCH_BATCH_LAUNCH_UNAVAILABLE');
          error.state = response && response.state || 'invalid_response';
          error.status = response && response.status || null;
          error.errorCode = response && response.body && response.body.errorCode || null;
          throw error;
        }
        return normalizeContext(response.body.data, request);
      },
    });
  }

  global.SS_ERP_BYOK_WORKBENCH_BATCH_LAUNCH_CLIENT = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    REQUEST_VERSION: REQUEST_VERSION,
    CONTEXT_VERSION: CONTEXT_VERSION,
    LAUNCH_PATH: LAUNCH_PATH,
    createClient: createClient,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
