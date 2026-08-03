(function exposeByokExecutionBatchClient(global) {
  'use strict';

  var CONTRACT_VERSION = 'extension-byok-execution-batch-client/v1';
  var CREATE_REQUEST_VERSION = 'extension-byok-execution-batch-request/v1';
  var CREATE_RESPONSE_VERSION = 'extension-byok-execution-batch/v1';
  var STATUS_RESPONSE_VERSION = 'extension-byok-execution-batch-status/v1';
  var STATUS_RESPONSE_VERSION_V2 = 'extension-byok-execution-batch-status/v2';
  var ATTEMPT_REQUEST_VERSION = 'extension-byok-execution-batch-attempt-request/v1';
  var ATTEMPT_RESPONSE_VERSION = 'extension-byok-execution-batch-attempt/v1';
  var CANCEL_REQUEST_VERSION = 'extension-byok-execution-batch-cancel-request/v1';
  var CANCEL_RESPONSE_VERSION = 'extension-byok-execution-batch-cancel/v1';
  var PATH = '/api/extension-device/byok-media/execution-batches';
  var REQUIRED_SCOPE = 'byok:media:ingest';
  var BINDING_VERSION = 'extension-byok-readiness-binding/v2';
  var INTENT_VERSION = 'extension-byok-execution-intent/v1';
  var OPERATIONS = ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'];
  var OUTCOMES = ['PENDING', 'SUCCEEDED', 'FAILED_FINAL', 'UNKNOWN_OUTCOME'];
  var STATUSES = ['OPEN', 'BOUND', 'CANCELLED'];
  var BINDING_KEYS = [
    'contractVersion', 'ownerUserId', 'deviceSessionId', 'shopId', 'workflowId',
    'draftRevision', 'draftVersion', 'sourcePlatform', 'sourceProductId',
    'sourceCaptureSnapshotId', 'supplyGoodsId', 'skuKey', 'slotKey',
    'assignmentMode', 'assignmentOrdinal', 'providerOrigin', 'model', 'operation',
    'policyRevision',
  ];
  var ITEM_KEYS = [
    'readinessBinding', 'requestMode', 'providerIdempotencyKey', 'providerRequestHash',
  ];
  var PUBLIC_ITEM_KEYS = [
    'batchItemId', 'itemIndex', 'skuKey', 'slotKey', 'assignmentOrdinal', 'intent',
  ];
  var INTENT_KEYS = [
    'contractVersion', 'intentId', 'attemptIndex', 'outcome',
    'providerIdempotencyKey', 'providerRequestHash',
  ];
  var CONTEXT_KEYS = ['shopId', 'workflowId', 'draftRevision', 'draftVersion'];
  var STATUS_CONTEXT_KEYS = CONTEXT_KEYS.concat([
    'sourcePlatform', 'sourceProductId', 'sourceCaptureSnapshotId', 'supplyGoodsId',
  ]);

  function clientError(code, outcome, details) {
    var error = new Error(code);
    error.name = 'ExtensionByokExecutionBatchClientError';
    error.code = code;
    error.outcome = outcome || 'FAILED_FINAL';
    error.automaticRetryAllowed = error.outcome === 'FAILED_RETRYABLE';
    if (details) Object.assign(error, details);
    return error;
  }

  function invalid() {
    throw clientError('SS_ERP_BYOK_EXECUTION_BATCH_INPUT_INVALID', 'FAILED_FINAL');
  }

  function invalidResponse() {
    throw clientError('SS_ERP_BYOK_EXECUTION_BATCH_RESPONSE_INVALID', 'FAILED_FINAL');
  }

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function exactKeys(value, keys) {
    return isRecord(value)
      && Object.keys(value).length === keys.length
      && Object.keys(value).every(function (key) { return keys.includes(key); });
  }

  function text(value, maximum, onInvalid) {
    if (typeof value !== 'string' || !value || value.length > maximum
      || value !== value.normalize('NFKC').trim()
      // eslint-disable-next-line no-control-regex
      || /[\u0000-\u001f\u007f]/u.test(value)) onInvalid();
    return value;
  }

  function identifier(value, maximum, onInvalid) {
    var normalized = text(value, maximum || 200, onInvalid);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u.test(normalized)
      || /^(?:sk-[a-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|LTAI[a-zA-Z0-9]{12,}|AKID[a-zA-Z0-9]{12,})$/iu
        .test(normalized)
      || /^eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/u.test(normalized)) {
      onInvalid();
    }
    return normalized;
  }

  function sha256(value, onInvalid) {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) onInvalid();
    return value;
  }

  function positiveInteger(value, onInvalid) {
    if (!Number.isSafeInteger(value) || value < 1) onInvalid();
    return value;
  }

  function ordinal(value, onInvalid) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 499) onInvalid();
    return value;
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }

  function normalizeOrigin(value) {
    var origin = text(value, 300, invalid);
    var parsed;
    try { parsed = new global.URL(origin); } catch { invalid(); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password
      || parsed.search || parsed.hash || parsed.pathname !== '/'
      || parsed.origin !== origin) invalid();
    return origin;
  }

  function normalizeBinding(value) {
    if (!exactKeys(value, BINDING_KEYS) || value.contractVersion !== BINDING_VERSION
      || !['1688', 'pdd', 'taobao', 'tmall'].includes(value.sourcePlatform)
      || value.assignmentMode !== 'APPEND' || !OPERATIONS.includes(value.operation)) invalid();
    var result = {
      contractVersion: BINDING_VERSION,
      ownerUserId: text(value.ownerUserId, 200, invalid),
      deviceSessionId: text(value.deviceSessionId, 200, invalid),
      shopId: identifier(value.shopId, 200, invalid),
      workflowId: identifier(value.workflowId, 200, invalid),
      draftRevision: positiveInteger(value.draftRevision, invalid),
      draftVersion: positiveInteger(value.draftVersion, invalid),
      sourcePlatform: value.sourcePlatform,
      sourceProductId: text(value.sourceProductId, 200, invalid),
      sourceCaptureSnapshotId: text(value.sourceCaptureSnapshotId, 200, invalid),
      supplyGoodsId: text(value.supplyGoodsId, 200, invalid),
      skuKey: text(value.skuKey, 500, invalid),
      slotKey: text(value.slotKey, 200, invalid),
      assignmentMode: 'APPEND',
      assignmentOrdinal: ordinal(value.assignmentOrdinal, invalid),
      providerOrigin: normalizeOrigin(value.providerOrigin),
      model: text(value.model, 200, invalid),
      operation: value.operation,
      policyRevision: text(value.policyRevision, 200, invalid),
    };
    if (result.slotKey !== 'sku:' + result.skuKey + ':hero'
      && !['SCENE', 'DETAIL', 'SPEC', 'PACKAGING'].some(function (role) {
        return result.slotKey === 'shared:detail:' + role;
      })) invalid();
    return Object.freeze(result);
  }

  function normalizeItem(value) {
    if (!exactKeys(value, ITEM_KEYS) || !['json', 'multipart'].includes(value.requestMode)) {
      invalid();
    }
    var readinessBinding = normalizeBinding(value.readinessBinding);
    if (value.requestMode !== (readinessBinding.operation === 'TEXT_TO_IMAGE'
      ? 'json' : 'multipart')) invalid();
    var providerIdempotencyKey = identifier(value.providerIdempotencyKey, 200, invalid);
    if (providerIdempotencyKey.length < 16) invalid();
    return Object.freeze({
      readinessBinding: readinessBinding,
      requestMode: value.requestMode,
      providerIdempotencyKey: providerIdempotencyKey,
      providerRequestHash: sha256(value.providerRequestHash, invalid),
    });
  }

  function normalizeCreateInput(value) {
    if (!exactKeys(value, ['idempotencyKey', 'items'])
      || !Array.isArray(value.items) || value.items.length < 1 || value.items.length > 4) invalid();
    var idempotencyKey = identifier(value.idempotencyKey, 200, invalid);
    if (idempotencyKey.length < 16) invalid();
    var items = value.items.map(normalizeItem);
    var first = items[0].readinessBinding;
    if (items.some(function (item, index) {
      var binding = item.readinessBinding;
      return binding.ownerUserId !== first.ownerUserId
        || binding.deviceSessionId !== first.deviceSessionId
        || binding.shopId !== first.shopId || binding.workflowId !== first.workflowId
        || binding.draftRevision !== first.draftRevision
        || binding.draftVersion !== first.draftVersion
        || binding.sourcePlatform !== first.sourcePlatform
        || binding.sourceProductId !== first.sourceProductId
        || binding.sourceCaptureSnapshotId !== first.sourceCaptureSnapshotId
        || binding.supplyGoodsId !== first.supplyGoodsId
        || binding.assignmentOrdinal !== first.assignmentOrdinal + index;
    })) invalid();
    for (const values of [
      items.map(function (item) { return item.readinessBinding.slotKey; }),
      items.map(function (item) { return item.providerIdempotencyKey; }),
      items.map(function (item) { return item.providerRequestHash; }),
    ]) if (new Set(values).size !== values.length) invalid();
    return Object.freeze({ idempotencyKey: idempotencyKey, items: Object.freeze(items) });
  }

  function normalizeContext(value, expected) {
    if (!exactKeys(value, CONTEXT_KEYS)) invalidResponse();
    var context = {
      shopId: identifier(value.shopId, 200, invalidResponse),
      workflowId: identifier(value.workflowId, 200, invalidResponse),
      draftRevision: positiveInteger(value.draftRevision, invalidResponse),
      draftVersion: positiveInteger(value.draftVersion, invalidResponse),
    };
    if (expected && (context.shopId !== expected.shopId
      || context.workflowId !== expected.workflowId
      || context.draftRevision !== expected.draftRevision
      || context.draftVersion !== expected.draftVersion)) invalidResponse();
    return Object.freeze(context);
  }

  function normalizePublicItem(value, expected, expectedIndex, requireInitial) {
    if (!exactKeys(value, PUBLIC_ITEM_KEYS) || !exactKeys(value.intent, INTENT_KEYS)) {
      invalidResponse();
    }
    var itemIndex = ordinal(value.itemIndex, invalidResponse);
    var attemptIndex = ordinal(value.intent.attemptIndex, invalidResponse);
    if (itemIndex !== expectedIndex || (requireInitial && attemptIndex !== 0)
      || value.skuKey !== expected.readinessBinding.skuKey
      || value.slotKey !== expected.readinessBinding.slotKey
      || value.assignmentOrdinal !== expected.readinessBinding.assignmentOrdinal
      || value.intent.contractVersion !== INTENT_VERSION
      || !OUTCOMES.includes(value.intent.outcome)
      || value.intent.providerIdempotencyKey !== expected.providerIdempotencyKey
      || value.intent.providerRequestHash !== expected.providerRequestHash) invalidResponse();
    return deepFreeze({
      batchItemId: identifier(value.batchItemId, 200, invalidResponse),
      itemIndex: itemIndex,
      skuKey: text(value.skuKey, 500, invalidResponse),
      slotKey: text(value.slotKey, 200, invalidResponse),
      assignmentOrdinal: ordinal(value.assignmentOrdinal, invalidResponse),
      intent: {
        contractVersion: INTENT_VERSION,
        intentId: identifier(value.intent.intentId, 200, invalidResponse),
        attemptIndex: attemptIndex,
        outcome: value.intent.outcome,
        providerIdempotencyKey: value.intent.providerIdempotencyKey,
        providerRequestHash: value.intent.providerRequestHash,
      },
    });
  }

  function assertReplayStatus(response, replayed, allowOnly200) {
    if (allowOnly200 ? response.status !== 200
      : (replayed === true ? response.status !== 200 : response.status !== 201)) invalidResponse();
  }

  function responseData(response, operation) {
    var status = response && Number.isSafeInteger(response.status) ? response.status : null;
    var state = response && response.state;
    if (response && state === 'response' && [200, 201].includes(status)
      && exactKeys(response.body, ['code', 'data']) && response.body.code === 1
      && isRecord(response.body.data)) return response.body.data;
    var rejected = ['scope_required', 'authorization_required', 'unpaired'].includes(state)
      || (state === 'http_error' && status !== null && status >= 400 && status < 500
        && status !== 429);
    throw clientError(
      rejected ? 'SS_ERP_BYOK_EXECUTION_BATCH_REJECTED'
        : 'SS_ERP_BYOK_EXECUTION_BATCH_UNAVAILABLE',
      rejected ? 'FAILED_FINAL' : 'FAILED_RETRYABLE',
      { operation: operation, status: status },
    );
  }

  function isExactLookupMiss(response) {
    return response && response.state === 'http_error' && response.status === 404
      && exactKeys(response.body, ['code', 'errorCode', 'msg'])
      && response.body.code === 0
      && response.body.errorCode === 'byok_execution_batch_not_found'
      && typeof response.body.msg === 'string';
  }

  function normalizeCreateResponse(value, input, response) {
    if (!exactKeys(value, ['contractVersion', 'batchId', 'status', 'replayed', 'context', 'items'])
      || value.contractVersion !== CREATE_RESPONSE_VERSION || !STATUSES.includes(value.status)
      || typeof value.replayed !== 'boolean' || !Array.isArray(value.items)
      || value.items.length !== input.items.length) invalidResponse();
    assertReplayStatus(response, value.replayed, false);
    var first = input.items[0].readinessBinding;
    var context = normalizeContext(value.context, first);
    var items = value.items.map(function (item, index) {
      return normalizePublicItem(item, input.items[index], index, true);
    });
    if (new Set(items.map(function (item) { return item.batchItemId; })).size !== items.length
      || new Set(items.map(function (item) { return item.intent.intentId; })).size !== items.length) {
      invalidResponse();
    }
    return deepFreeze({
      contractVersion: CREATE_RESPONSE_VERSION,
      batchId: identifier(value.batchId, 200, invalidResponse),
      status: value.status,
      replayed: value.replayed,
      context: context,
      items: items,
    });
  }

  function normalizeAttemptInput(value) {
    if (!exactKeys(value, [
      'batchId', 'itemIndex', 'currentIntentId', 'providerChargeConfirmed', 'item',
    ]) || value.providerChargeConfirmed !== true) invalid();
    var itemIndex = ordinal(value.itemIndex, invalid);
    if (itemIndex > 3) invalid();
    return Object.freeze({
      batchId: identifier(value.batchId, 200, invalid),
      itemIndex: itemIndex,
      currentIntentId: identifier(value.currentIntentId, 200, invalid),
      providerChargeConfirmed: true,
      item: normalizeItem(value.item),
    });
  }

  function normalizeAttemptResponse(value, input, response) {
    if (!exactKeys(value, ['contractVersion', 'batchId', 'status', 'replayed', 'context', 'item'])
      || value.contractVersion !== ATTEMPT_RESPONSE_VERSION || value.batchId !== input.batchId
      || !STATUSES.includes(value.status) || typeof value.replayed !== 'boolean') invalidResponse();
    assertReplayStatus(response, value.replayed, false);
    var context = normalizeContext(value.context, input.item.readinessBinding);
    var item = normalizePublicItem(value.item, input.item, input.itemIndex, false);
    if (item.intent.attemptIndex < 1) invalidResponse();
    return deepFreeze({
      contractVersion: ATTEMPT_RESPONSE_VERSION,
      batchId: input.batchId,
      status: value.status,
      replayed: value.replayed,
      context: context,
      item: item,
    });
  }

  function normalizeStatusItem(value, contractVersion) {
    var intentKeys = contractVersion === STATUS_RESPONSE_VERSION_V2
      ? INTENT_KEYS.concat(['resultSha256']) : INTENT_KEYS;
    if (!exactKeys(value, PUBLIC_ITEM_KEYS.concat(['status']))
      || !exactKeys(value.intent, intentKeys)
      || !['ACTIVE', 'BOUND', 'RELEASED'].includes(value.status)) invalidResponse();
    var itemIndex = ordinal(value.itemIndex, invalidResponse);
    var attemptIndex = ordinal(value.intent.attemptIndex, invalidResponse);
    if (itemIndex > 3 || !OUTCOMES.includes(value.intent.outcome)
      || value.intent.contractVersion !== INTENT_VERSION) invalidResponse();
    var skuKey = text(value.skuKey, 500, invalidResponse);
    var slotKey = text(value.slotKey, 200, invalidResponse);
    if (slotKey !== 'sku:' + skuKey + ':hero'
      && !['SCENE', 'DETAIL', 'SPEC', 'PACKAGING'].some(function (role) {
        return slotKey === 'shared:detail:' + role;
      })) invalidResponse();
    var providerIdempotencyKey = identifier(
      value.intent.providerIdempotencyKey, 200, invalidResponse,
    );
    if (providerIdempotencyKey.length < 16) invalidResponse();
    var resultSha256 = null;
    if (contractVersion === STATUS_RESPONSE_VERSION_V2) {
      if (value.intent.outcome === 'SUCCEEDED') {
        resultSha256 = sha256(value.intent.resultSha256, invalidResponse);
      } else if (value.intent.resultSha256 !== null) invalidResponse();
    }
    return deepFreeze({
      batchItemId: identifier(value.batchItemId, 200, invalidResponse),
      itemIndex: itemIndex,
      skuKey: skuKey,
      slotKey: slotKey,
      assignmentOrdinal: ordinal(value.assignmentOrdinal, invalidResponse),
      status: value.status,
      intent: {
        contractVersion: INTENT_VERSION,
        intentId: identifier(value.intent.intentId, 200, invalidResponse),
        attemptIndex: attemptIndex,
        outcome: value.intent.outcome,
        providerIdempotencyKey: providerIdempotencyKey,
        providerRequestHash: sha256(value.intent.providerRequestHash, invalidResponse),
        ...(contractVersion === STATUS_RESPONSE_VERSION_V2
          ? { resultSha256: resultSha256 } : {}),
      },
    });
  }

  function normalizeStatusResponse(value, batchId, response, contractVersion) {
    if (!exactKeys(value, [
      'contractVersion', 'batchId', 'status', 'context', 'boundDraftRevision',
      'boundDraftVersion', 'items',
    ]) || value.contractVersion !== contractVersion || value.batchId !== batchId
      || !STATUSES.includes(value.status) || !exactKeys(value.context, STATUS_CONTEXT_KEYS)
      || !Array.isArray(value.items) || value.items.length < 1 || value.items.length > 4) {
      invalidResponse();
    }
    assertReplayStatus(response, false, true);
    var context = {
      ...normalizeContext(Object.fromEntries(CONTEXT_KEYS.map(function (key) {
        return [key, value.context[key]];
      }))),
      sourcePlatform: text(value.context.sourcePlatform, 16, invalidResponse),
      sourceProductId: text(value.context.sourceProductId, 200, invalidResponse),
      sourceCaptureSnapshotId: text(
        value.context.sourceCaptureSnapshotId, 200, invalidResponse,
      ),
      supplyGoodsId: text(value.context.supplyGoodsId, 200, invalidResponse),
    };
    if (!['1688', 'pdd', 'taobao', 'tmall'].includes(context.sourcePlatform)) invalidResponse();
    var boundDraftRevision = value.boundDraftRevision === null
      ? null : positiveInteger(value.boundDraftRevision, invalidResponse);
    var boundDraftVersion = value.boundDraftVersion === null
      ? null : positiveInteger(value.boundDraftVersion, invalidResponse);
    if ((value.status === 'BOUND') !== (boundDraftRevision !== null && boundDraftVersion !== null)
      || (value.status !== 'BOUND'
        && (boundDraftRevision !== null || boundDraftVersion !== null))) invalidResponse();
    var expectedItemStatus = value.status === 'OPEN'
      ? 'ACTIVE' : value.status === 'BOUND' ? 'BOUND' : 'RELEASED';
    var items = value.items.map(function (item) {
      return normalizeStatusItem(item, contractVersion);
    });
    var firstOrdinal = items[0].assignmentOrdinal;
    if (items.some(function (item, index) {
      return item.itemIndex !== index || item.status !== expectedItemStatus
        || item.assignmentOrdinal !== firstOrdinal + index;
    }) || new Set(items.map(function (item) { return item.batchItemId; })).size !== items.length
      || new Set(items.map(function (item) { return item.slotKey; })).size !== items.length
      || new Set(items.map(function (item) { return item.intent.intentId; })).size !== items.length) {
      invalidResponse();
    }
    return deepFreeze({
      contractVersion: contractVersion,
      batchId: batchId,
      status: value.status,
      context: context,
      boundDraftRevision: boundDraftRevision,
      boundDraftVersion: boundDraftVersion,
      items: items,
    });
  }

  function createClient(options) {
    var transport = options && options.transport;
    if (!transport || typeof transport.post !== 'function') {
      throw clientError('SS_ERP_BYOK_EXECUTION_BATCH_DEPENDENCY_UNAVAILABLE', 'FAILED_FINAL');
    }

    async function post(path, body, operation) {
      var response;
      try {
        response = await transport.post(path, body, { requiredScope: REQUIRED_SCOPE });
      } catch {
        throw clientError('SS_ERP_BYOK_EXECUTION_BATCH_UNAVAILABLE', 'FAILED_RETRYABLE', {
          operation: operation, status: null,
        });
      }
      return { response: response, data: responseData(response, operation) };
    }

    return Object.freeze({
      claim: async function (value) {
        var input = normalizeCreateInput(value);
        var result = await post(PATH, {
          contractVersion: CREATE_REQUEST_VERSION,
          idempotencyKey: input.idempotencyKey,
          items: input.items.map(function (item) {
            return {
              binding: item.readinessBinding,
              requestMode: item.requestMode,
              providerIdempotencyKey: item.providerIdempotencyKey,
              providerRequestHash: item.providerRequestHash,
            };
          }),
        }, 'CLAIM');
        return normalizeCreateResponse(result.data, input, result.response);
      },
      claimSuccessor: async function (value) {
        var input = normalizeAttemptInput(value);
        var path = PATH + '/' + encodeURIComponent(input.batchId)
          + '/items/' + input.itemIndex + '/attempts';
        var result = await post(path, {
          contractVersion: ATTEMPT_REQUEST_VERSION,
          currentIntentId: input.currentIntentId,
          providerChargeConfirmed: true,
          item: {
            binding: input.item.readinessBinding,
            requestMode: input.item.requestMode,
            providerIdempotencyKey: input.item.providerIdempotencyKey,
            providerRequestHash: input.item.providerRequestHash,
          },
        }, 'CLAIM_SUCCESSOR');
        return normalizeAttemptResponse(result.data, input, result.response);
      },
      cancel: async function (value) {
        if (!exactKeys(value, ['batchId'])) invalid();
        var batchId = identifier(value.batchId, 200, invalid);
        var result = await post(
          PATH + '/' + encodeURIComponent(batchId) + '/cancel',
          { contractVersion: CANCEL_REQUEST_VERSION },
          'CANCEL',
        );
        var data = result.data;
        if (!exactKeys(data, ['contractVersion', 'batchId', 'status', 'replayed'])
          || data.contractVersion !== CANCEL_RESPONSE_VERSION || data.batchId !== batchId
          || data.status !== 'CANCELLED' || typeof data.replayed !== 'boolean') invalidResponse();
        assertReplayStatus(result.response, data.replayed, true);
        return Object.freeze({
          contractVersion: CANCEL_RESPONSE_VERSION,
          batchId: batchId,
          status: 'CANCELLED',
          replayed: data.replayed,
        });
      },
      status: async function (value) {
        if (!exactKeys(value, ['batchId']) || typeof transport.get !== 'function') invalid();
        var batchId = identifier(value.batchId, 200, invalid);
        var response;
        try {
          response = await transport.get(
            PATH + '/' + encodeURIComponent(batchId),
            { requiredScope: REQUIRED_SCOPE },
          );
        } catch {
          throw clientError('SS_ERP_BYOK_EXECUTION_BATCH_UNAVAILABLE', 'FAILED_RETRYABLE', {
            operation: 'STATUS', status: null,
          });
        }
        return normalizeStatusResponse(
          responseData(response, 'STATUS'), batchId, response, STATUS_RESPONSE_VERSION,
        );
      },
      statusV2: async function (value) {
        if (!exactKeys(value, ['batchId']) || typeof transport.get !== 'function') invalid();
        var batchId = identifier(value.batchId, 200, invalid);
        var response;
        try {
          response = await transport.get(
            PATH + '/' + encodeURIComponent(batchId) + '?contractVersion='
              + encodeURIComponent(STATUS_RESPONSE_VERSION_V2),
            { requiredScope: REQUIRED_SCOPE },
          );
        } catch {
          throw clientError('SS_ERP_BYOK_EXECUTION_BATCH_UNAVAILABLE', 'FAILED_RETRYABLE', {
            operation: 'STATUS_V2', status: null,
          });
        }
        return normalizeStatusResponse(
          responseData(response, 'STATUS_V2'), batchId, response, STATUS_RESPONSE_VERSION_V2,
        );
      },
      statusByIdempotency: async function (value) {
        if (!exactKeys(value, ['idempotencyKey']) || typeof transport.get !== 'function') invalid();
        var idempotencyKey = identifier(value.idempotencyKey, 200, invalid);
        if (idempotencyKey.length < 16) invalid();
        var response;
        try {
          response = await transport.get(
            PATH + '/by-idempotency/' + encodeURIComponent(idempotencyKey),
            { requiredScope: REQUIRED_SCOPE },
          );
        } catch {
          throw clientError('SS_ERP_BYOK_EXECUTION_BATCH_UNAVAILABLE', 'FAILED_RETRYABLE', {
            operation: 'STATUS_BY_IDEMPOTENCY', status: null,
          });
        }
        if (isExactLookupMiss(response)) return null;
        var data = responseData(response, 'STATUS_BY_IDEMPOTENCY');
        if (!isRecord(data)) invalidResponse();
        var batchId = identifier(data.batchId, 200, invalidResponse);
        return normalizeStatusResponse(data, batchId, response, STATUS_RESPONSE_VERSION);
      },
      statusByIdempotencyV2: async function (value) {
        if (!exactKeys(value, ['idempotencyKey']) || typeof transport.get !== 'function') invalid();
        var idempotencyKey = identifier(value.idempotencyKey, 200, invalid);
        if (idempotencyKey.length < 16) invalid();
        var response;
        try {
          response = await transport.get(
            PATH + '/by-idempotency/' + encodeURIComponent(idempotencyKey)
              + '?contractVersion=' + encodeURIComponent(STATUS_RESPONSE_VERSION_V2),
            { requiredScope: REQUIRED_SCOPE },
          );
        } catch {
          throw clientError('SS_ERP_BYOK_EXECUTION_BATCH_UNAVAILABLE', 'FAILED_RETRYABLE', {
            operation: 'STATUS_BY_IDEMPOTENCY_V2', status: null,
          });
        }
        if (isExactLookupMiss(response)) return null;
        var data = responseData(response, 'STATUS_BY_IDEMPOTENCY_V2');
        if (!isRecord(data)) invalidResponse();
        var batchId = identifier(data.batchId, 200, invalidResponse);
        return normalizeStatusResponse(data, batchId, response, STATUS_RESPONSE_VERSION_V2);
      },
    });
  }

  global.SS_ERP_BYOK_EXECUTION_BATCH_CLIENT = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    CREATE_REQUEST_VERSION: CREATE_REQUEST_VERSION,
    CREATE_RESPONSE_VERSION: CREATE_RESPONSE_VERSION,
    STATUS_RESPONSE_VERSION: STATUS_RESPONSE_VERSION,
    STATUS_RESPONSE_VERSION_V2: STATUS_RESPONSE_VERSION_V2,
    ATTEMPT_REQUEST_VERSION: ATTEMPT_REQUEST_VERSION,
    ATTEMPT_RESPONSE_VERSION: ATTEMPT_RESPONSE_VERSION,
    CANCEL_REQUEST_VERSION: CANCEL_REQUEST_VERSION,
    CANCEL_RESPONSE_VERSION: CANCEL_RESPONSE_VERSION,
    PATH: PATH,
    REQUIRED_SCOPE: REQUIRED_SCOPE,
    createClient: createClient,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
