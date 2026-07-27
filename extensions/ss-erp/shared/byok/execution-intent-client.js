(function exposeByokExecutionIntentClient(global) {
  'use strict';

  var CONTRACT_VERSION = 'extension-byok-execution-intent-client/v1';
  var CLAIM_REQUEST_VERSION = 'extension-byok-execution-intent-request/v1';
  var CLAIM_RESPONSE_VERSION = 'extension-byok-execution-intent/v1';
  var OUTCOME_REQUEST_VERSION = 'extension-byok-execution-intent-outcome-request/v1';
  var OUTCOME_RESPONSE_VERSION = 'extension-byok-execution-intent-outcome/v1';
  var CLAIM_PATH = '/api/extension-device/byok-media/execution-intents';
  var REQUIRED_SCOPE = 'byok:media:ingest';
  var HASH_PATTERN = /^[a-f0-9]{64}$/u;
  var SOURCE_PLATFORMS = ['1688', 'pdd', 'taobao', 'tmall'];
  var OPERATIONS = ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'];
  var SHARED_DETAIL_ROLES = ['SCENE', 'DETAIL', 'SPEC', 'PACKAGING'];
  var REQUEST_MODES = ['json', 'multipart'];
  var OUTCOMES = ['SUCCEEDED', 'FAILED_FINAL', 'UNKNOWN_OUTCOME'];
  var CLAIM_OUTCOMES = ['PENDING'].concat(OUTCOMES);
  var SAFE_TRANSPORT_STATES = [
    'response', 'http_error', 'scope_required', 'authorization_required', 'unpaired',
  ];
  var BINDING_KEYS = [
    'contractVersion', 'ownerUserId', 'deviceSessionId', 'shopId', 'workflowId',
    'draftRevision', 'draftVersion', 'sourcePlatform', 'sourceProductId',
    'sourceCaptureSnapshotId', 'supplyGoodsId', 'skuKey', 'slotKey',
    'assignmentMode', 'assignmentOrdinal', 'providerOrigin', 'model', 'operation',
    'policyRevision',
  ];
  var CLAIM_INPUT_KEYS = [
    'readinessBinding', 'requestMode', 'providerIdempotencyKey', 'providerRequestHash',
  ];
  var CLAIM_RESPONSE_KEYS = [
    'contractVersion', 'intentId', 'replayed', 'executionMode', 'outcome',
    'providerIdempotencyKey', 'providerRequestHash', 'context',
  ];
  var CONTEXT_KEYS = [
    'shopId', 'workflowId', 'draftRevision', 'draftVersion', 'skuKey', 'slotKey',
  ];
  var OUTCOME_INPUT_KEYS = [
    'intentId', 'providerIdempotencyKey', 'providerRequestHash', 'outcome',
    'providerRequestIdSha256', 'resultSha256',
  ];
  var OUTCOME_RESPONSE_KEYS = [
    'contractVersion', 'intentId', 'replayed', 'outcome', 'providerIdempotencyKey',
    'providerRequestHash', 'providerRequestIdSha256', 'resultSha256',
  ];

  function clientError(code, outcome, details) {
    var error = new Error(code);
    error.code = code;
    error.outcome = outcome;
    error.automaticRetryAllowed = outcome === 'FAILED_RETRYABLE';
    if (details) Object.assign(error, details);
    return error;
  }

  function failInput() {
    throw clientError('SS_ERP_BYOK_EXECUTION_INTENT_INPUT_INVALID', 'FAILED_FINAL');
  }

  function failResponse() {
    throw clientError('SS_ERP_BYOK_EXECUTION_INTENT_RESPONSE_INVALID', 'FAILED_RETRYABLE');
  }

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function exactKeys(value, keys) {
    return isRecord(value)
      && Object.keys(value).length === keys.length
      && Object.keys(value).every(function (key) { return keys.includes(key); });
  }

  function hasControlCharacter(value) {
    return Array.from(value).some(function (character) {
      var codePoint = character.codePointAt(0) || 0;
      return codePoint <= 31 || codePoint === 127;
    });
  }

  function canonicalText(value, maximum, onInvalid) {
    if (typeof value !== 'string' || value.length < 1 || value.length > maximum
      || value !== value.normalize('NFKC').trim()
      || hasControlCharacter(value)
      || /(?:https?|ftp|data):/iu.test(value)
      || /[?#]/u.test(value)) {
      onInvalid();
    }
    return value;
  }

  function positiveInteger(value, onInvalid) {
    if (!Number.isSafeInteger(value) || value < 1) onInvalid();
    return value;
  }

  function assignmentOrdinal(value, onInvalid) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 499) onInvalid();
    return value;
  }

  function isSupportedSlotKey(skuKey, slotKey) {
    return slotKey === 'sku:' + skuKey + ':hero'
      || SHARED_DETAIL_ROLES.some(function (role) {
        return slotKey === 'shared:detail:' + role;
      });
  }

  function sha256(value, onInvalid) {
    if (typeof value !== 'string' || !HASH_PATTERN.test(value)) onInvalid();
    return value;
  }

  function nullableSha256(value, onInvalid) {
    return value === null ? null : sha256(value, onInvalid);
  }

  function canonicalProviderOrigin(value, onInvalid) {
    if (typeof value !== 'string' || value.length < 1 || value.length > 2048
      || value !== value.trim() || hasControlCharacter(value)) {
      onInvalid();
    }
    var url;
    try {
      url = new URL(value);
    } catch {
      onInvalid();
    }
    if (!url || url.protocol !== 'https:' || url.username || url.password
      || url.search || url.hash || url.pathname !== '/' || url.origin !== value) {
      onInvalid();
    }
    return value;
  }

  function normalizePolicyRevision(value, onInvalid) {
    if (typeof value !== 'string' || !/^[1-9][0-9]{0,31}$/u.test(value)
      || !Number.isSafeInteger(Number(value))) {
      onInvalid();
    }
    return value;
  }

  function normalizeBinding(value, onInvalid) {
    if (!exactKeys(value, BINDING_KEYS)
      || value.contractVersion !== 'extension-byok-readiness-binding/v2'
      || !SOURCE_PLATFORMS.includes(value.sourcePlatform)
      || !OPERATIONS.includes(value.operation)
      || value.assignmentMode !== 'APPEND') {
      onInvalid();
    }
    var skuKey = canonicalText(value.skuKey, 500, onInvalid);
    var slotKey = canonicalText(value.slotKey, 200, onInvalid);
    if (!isSupportedSlotKey(skuKey, slotKey)) onInvalid();
    return {
      contractVersion: 'extension-byok-readiness-binding/v2',
      ownerUserId: canonicalText(value.ownerUserId, 200, onInvalid),
      deviceSessionId: canonicalText(value.deviceSessionId, 200, onInvalid),
      shopId: canonicalText(value.shopId, 200, onInvalid),
      workflowId: canonicalText(value.workflowId, 200, onInvalid),
      draftRevision: positiveInteger(value.draftRevision, onInvalid),
      draftVersion: positiveInteger(value.draftVersion, onInvalid),
      sourcePlatform: value.sourcePlatform,
      sourceProductId: canonicalText(value.sourceProductId, 200, onInvalid),
      sourceCaptureSnapshotId: canonicalText(
        value.sourceCaptureSnapshotId,
        200,
        onInvalid,
      ),
      supplyGoodsId: canonicalText(value.supplyGoodsId, 200, onInvalid),
      skuKey: skuKey,
      slotKey: slotKey,
      assignmentMode: 'APPEND',
      assignmentOrdinal: assignmentOrdinal(value.assignmentOrdinal, onInvalid),
      providerOrigin: canonicalProviderOrigin(value.providerOrigin, onInvalid),
      model: canonicalText(value.model, 200, onInvalid),
      operation: value.operation,
      policyRevision: normalizePolicyRevision(value.policyRevision, onInvalid),
    };
  }

  function normalizeClaimInput(value) {
    if (!exactKeys(value, CLAIM_INPUT_KEYS)) failInput();
    var binding = normalizeBinding(value.readinessBinding, failInput);
    if (!REQUEST_MODES.includes(value.requestMode)
      || value.requestMode !== (binding.operation === 'TEXT_TO_IMAGE' ? 'json' : 'multipart')) {
      failInput();
    }
    return {
      readinessBinding: binding,
      requestMode: value.requestMode,
      providerIdempotencyKey: canonicalText(
        value.providerIdempotencyKey,
        200,
        failInput,
      ),
      providerRequestHash: sha256(value.providerRequestHash, failInput),
    };
  }

  function normalizeOutcomeIdentity(value, onInvalid) {
    var outcome = value.outcome;
    if (!OUTCOMES.includes(outcome)) onInvalid();
    var resultSha256 = nullableSha256(value.resultSha256, onInvalid);
    if ((outcome === 'SUCCEEDED') !== (resultSha256 !== null)) onInvalid();
    return {
      intentId: canonicalText(value.intentId, 200, onInvalid),
      providerIdempotencyKey: canonicalText(
        value.providerIdempotencyKey,
        200,
        onInvalid,
      ),
      providerRequestHash: sha256(value.providerRequestHash, onInvalid),
      outcome: outcome,
      providerRequestIdSha256: nullableSha256(value.providerRequestIdSha256, onInvalid),
      resultSha256: resultSha256,
    };
  }

  function normalizeOutcomeInput(value) {
    if (!exactKeys(value, OUTCOME_INPUT_KEYS)) failInput();
    return normalizeOutcomeIdentity(value, failInput);
  }

  function responseEnvelope(response, operation) {
    var status = response && Number.isSafeInteger(response.status)
      && response.status >= 100 && response.status <= 599
      ? response.status
      : null;
    var state = response && SAFE_TRANSPORT_STATES.includes(response.state)
      ? response.state
      : null;
    if (!response || state !== 'response' || ![200, 201].includes(status)) {
      var rejected = ['scope_required', 'authorization_required', 'unpaired'].includes(state)
        || (state === 'http_error' && status !== null && status >= 400 && status < 500
          && status !== 429);
      throw clientError(
        rejected
          ? 'SS_ERP_BYOK_EXECUTION_INTENT_REJECTED'
          : 'SS_ERP_BYOK_EXECUTION_INTENT_UNAVAILABLE',
        rejected ? 'FAILED_FINAL' : 'FAILED_RETRYABLE',
        { operation: operation, state: state, status: status },
      );
    }
    if (!exactKeys(response.body, ['code', 'data'])
      || response.body.code !== 1 || !isRecord(response.body.data)) {
      failResponse();
    }
    return response.body.data;
  }

  function assertReplayStatus(response, replayed) {
    if ((replayed === true && response.status !== 200)
      || (replayed === false && response.status !== 201)) {
      failResponse();
    }
  }

  function normalizeClaimResponse(value, input, response) {
    if (!exactKeys(value, CLAIM_RESPONSE_KEYS)
      || value.contractVersion !== CLAIM_RESPONSE_VERSION
      || typeof value.replayed !== 'boolean'
      || value.executionMode !== 'BYOK'
      || !CLAIM_OUTCOMES.includes(value.outcome)
      || value.providerIdempotencyKey !== input.providerIdempotencyKey
      || value.providerRequestHash !== input.providerRequestHash
      || !exactKeys(value.context, CONTEXT_KEYS)) {
      failResponse();
    }
    assertReplayStatus(response, value.replayed);
    var intentId = canonicalText(value.intentId, 200, failResponse);
    var context = {
      shopId: canonicalText(value.context.shopId, 200, failResponse),
      workflowId: canonicalText(value.context.workflowId, 200, failResponse),
      draftRevision: positiveInteger(value.context.draftRevision, failResponse),
      draftVersion: positiveInteger(value.context.draftVersion, failResponse),
      skuKey: canonicalText(value.context.skuKey, 500, failResponse),
      slotKey: canonicalText(value.context.slotKey, 200, failResponse),
    };
    if (context.shopId !== input.readinessBinding.shopId
      || context.workflowId !== input.readinessBinding.workflowId
      || context.draftRevision !== input.readinessBinding.draftRevision
      || context.draftVersion !== input.readinessBinding.draftVersion
      || context.skuKey !== input.readinessBinding.skuKey
      || context.slotKey !== input.readinessBinding.slotKey) {
      failResponse();
    }
    return Object.freeze({
      contractVersion: CLAIM_RESPONSE_VERSION,
      intentId: intentId,
      replayed: value.replayed,
      executionMode: 'BYOK',
      outcome: value.outcome,
      providerIdempotencyKey: input.providerIdempotencyKey,
      providerRequestHash: input.providerRequestHash,
      context: Object.freeze(context),
    });
  }

  function normalizeOutcomeResponse(value, input, response) {
    if (!exactKeys(value, OUTCOME_RESPONSE_KEYS)
      || value.contractVersion !== OUTCOME_RESPONSE_VERSION
      || typeof value.replayed !== 'boolean') {
      failResponse();
    }
    var normalized = normalizeOutcomeIdentity(value, failResponse);
    assertReplayStatus(response, value.replayed);
    if (normalized.intentId !== input.intentId
      || normalized.providerIdempotencyKey !== input.providerIdempotencyKey
      || normalized.providerRequestHash !== input.providerRequestHash
      || normalized.outcome !== input.outcome
      || normalized.providerRequestIdSha256 !== input.providerRequestIdSha256
      || normalized.resultSha256 !== input.resultSha256) {
      failResponse();
    }
    return Object.freeze({
      contractVersion: OUTCOME_RESPONSE_VERSION,
      intentId: normalized.intentId,
      replayed: value.replayed,
      outcome: normalized.outcome,
      providerIdempotencyKey: normalized.providerIdempotencyKey,
      providerRequestHash: normalized.providerRequestHash,
      providerRequestIdSha256: normalized.providerRequestIdSha256,
      resultSha256: normalized.resultSha256,
    });
  }

  function createClient(options) {
    var transport = options && options.transport;
    if (!transport || typeof transport.post !== 'function') {
      throw clientError(
        'SS_ERP_BYOK_EXECUTION_INTENT_DEPENDENCY_UNAVAILABLE',
        'FAILED_FINAL',
      );
    }

    async function post(path, body, operation) {
      var response;
      try {
        response = await transport.post(path, body, { requiredScope: REQUIRED_SCOPE });
      } catch {
        throw clientError(
          'SS_ERP_BYOK_EXECUTION_INTENT_UNAVAILABLE',
          'FAILED_RETRYABLE',
          { operation: operation, state: null, status: null },
        );
      }
      return { response: response, data: responseEnvelope(response, operation) };
    }

    return Object.freeze({
      contractVersion: CONTRACT_VERSION,
      claim: async function (value) {
        var input = normalizeClaimInput(value);
        if (input.providerIdempotencyKey.length < 16) failInput();
        var result = await post(CLAIM_PATH, {
          contractVersion: CLAIM_REQUEST_VERSION,
          binding: input.readinessBinding,
          requestMode: input.requestMode,
          providerIdempotencyKey: input.providerIdempotencyKey,
          providerRequestHash: input.providerRequestHash,
        }, 'CLAIM');
        return normalizeClaimResponse(result.data, input, result.response);
      },
      reportOutcome: async function (value) {
        var input = normalizeOutcomeInput(value);
        if (input.providerIdempotencyKey.length < 16) failInput();
        var result = await post(
          CLAIM_PATH + '/' + encodeURIComponent(input.intentId) + '/outcome',
          {
            contractVersion: OUTCOME_REQUEST_VERSION,
            providerIdempotencyKey: input.providerIdempotencyKey,
            providerRequestHash: input.providerRequestHash,
            outcome: input.outcome,
            providerRequestIdSha256: input.providerRequestIdSha256,
            resultSha256: input.resultSha256,
          },
          'REPORT_OUTCOME',
        );
        return normalizeOutcomeResponse(result.data, input, result.response);
      },
    });
  }

  global.SS_ERP_BYOK_EXECUTION_INTENT_CLIENT = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    CLAIM_REQUEST_VERSION: CLAIM_REQUEST_VERSION,
    CLAIM_RESPONSE_VERSION: CLAIM_RESPONSE_VERSION,
    OUTCOME_REQUEST_VERSION: OUTCOME_REQUEST_VERSION,
    OUTCOME_RESPONSE_VERSION: OUTCOME_RESPONSE_VERSION,
    CLAIM_PATH: CLAIM_PATH,
    REQUIRED_SCOPE: REQUIRED_SCOPE,
    OUTCOMES: Object.freeze(OUTCOMES.slice()),
    createClient: createClient,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
