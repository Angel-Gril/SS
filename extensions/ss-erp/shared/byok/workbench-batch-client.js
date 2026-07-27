(function exposeByokWorkbenchBatchClient(global) {
  'use strict';

  var CONTRACT_VERSION = 'extension-byok-workbench-batch-client/v1';
  var REQUEST_VERSION = 'extension-byok-workbench-batch-runtime-request/v1';
  var USER_START_VERSION = 'extension-byok-workbench-batch-user-start/v1';
  var COMMAND_VERSION = 'extension-byok-workbench-batch-runtime-command/v1';
  var INGEST_VERSION = 'extension-byok-workbench-batch-ingest/v1';
  var COORDINATOR_VERSION = 'extension-byok-workbench-batch-coordinator/v1';
  var PREVIEW_VERSION = 'extension-byok-workbench-preview-channel/v1';
  var EXTERNAL_CHARGE_WARNING_VERSION = 'external-provider-charge/v1';
  var DUPLICATE_CHARGE_WARNING_VERSION = 'external-provider-duplicate-charge/v1';
  var DEFAULT_TIMEOUT_MS = 30 * 1000;
  var MAX_SLOTS = 4;
  var SERIAL_REQUESTED_CONCURRENCY = 1;
  var MAX_ATTEMPTS_PER_SLOT = 500;
  var MAX_IMAGE_BYTES = 20 * 1024 * 1024;
  var MAX_PROMPT_CHARACTERS = 8000;
  var MAX_NEGATIVE_PROMPT_CHARACTERS = 4000;
  var MESSAGE_TYPES = Object.freeze({
    BATCH_STATE: 'ss-erp:ai-image-workbench-batch-state',
    BATCH_START: 'ss-erp:ai-image-workbench-batch-start',
    BATCH_COMMAND: 'ss-erp:ai-image-workbench-batch-command',
    BATCH_PREVIEW: 'ss-erp:ai-image-workbench-batch-preview',
    BATCH_INGEST: 'ss-erp:ai-image-workbench-batch-ingest',
    BATCH_RECOVER: 'ss-erp:ai-image-workbench-batch-ingest-recover',
    BATCH_CLEAR: 'ss-erp:ai-image-workbench-batch-clear',
  });
  var OPERATIONS = Object.freeze([
    'TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT',
  ]);
  var ATTEMPT_STATES = Object.freeze([
    'QUEUED', 'SUBMITTING', 'WAITING', 'CANDIDATE_READY', 'FAILED_RETRYABLE',
    'FAILED_FINAL', 'UNKNOWN_OUTCOME', 'CANCELLED',
  ]);
  var SLOT_STATES = Object.freeze([
    'EMPTY', 'QUEUED', 'SUBMITTING', 'WAITING', 'CANDIDATE_READY',
    'FAILED_RETRYABLE', 'FAILED_FINAL', 'UNKNOWN_OUTCOME', 'CANCELLED', 'REJECTED',
  ]);
  var SCHEDULER_STATES = Object.freeze([
    'READY', 'RUNNING', 'PAUSING', 'PAUSED', 'REVIEW', 'CANCELLED', 'FAILED',
  ]);
  var INGEST_STATES = Object.freeze([
    'NOT_STARTED', 'SUBMITTING', 'RECOVERING', 'SUCCEEDED', 'FAILED_RETRYABLE',
    'FAILED_FINAL', 'UNKNOWN_OUTCOME', 'RECOVERY_REQUIRED',
  ]);
  var REVIEW_STATES = Object.freeze([
    'NOT_READY', 'AVAILABLE', 'KEPT', 'REJECTED', 'SUPERSEDED_UNKNOWN',
  ]);
  var RETRY_RISKS = Object.freeze([
    'NEW_PROVIDER_CHARGE_ACCEPTED', 'DUPLICATE_CHARGE_ACCEPTED',
    'SAFE_RECOVERY_EVIDENCE', 'POSSIBLE_DUPLICATE_PROVIDER_CHARGE',
  ]);
  var RECOVERY_REQUIREMENT =
    'PROVIDER_LOOKUP_OR_STABLE_IDEMPOTENCY_OR_EXPLICIT_DUPLICATE_CHARGE_CONFIRMATION';
  var RESTART_RECOVERY_REQUIREMENT = 'SERVICE_WORKER_RESTART_RECONCILIATION_REQUIRED';
  var SHARED_DETAIL_ROLES = Object.freeze(['SCENE', 'DETAIL', 'SPEC', 'PACKAGING']);
  var COMMAND_KINDS = Object.freeze([
    'PAUSE_AFTER_CURRENT', 'CONTINUE', 'CANCEL_QUEUED', 'KEEP_ATTEMPT',
    'REJECT_ATTEMPT', 'REGENERATE_SLOT', 'RETRY_ATTEMPT',
    'RESOLVE_UNKNOWN_ATTEMPT',
  ]);
  var COMMAND_BASE_KEYS = Object.freeze([
    'kind', 'commandId', 'expectedWorkspaceRevision', 'expectedRuntimeRevision',
  ]);
  var INPUT_FORBIDDEN_KEYS = Object.freeze(new Set([
    'apikey', 'secretkey', 'authorization', 'accesstoken', 'refreshtoken',
    'sessiontoken', 'devicetoken', 'commandtoken', 'granttoken', 'password',
    'credential', 'credentials', 'blob', 'image', 'imageblob', 'arraybuffer',
    'sharedarraybuffer', 'rawbytes', 'imagebytes', 'base64', 'b64json', 'url',
    'batchid', 'executionbatchid', 'binding', 'providerorigin', 'providerendpoint',
    'endpoint', 'model', 'policyrevision', 'lifecycleauthority', 'dispatchref',
    'requesthash', 'preparehash', 'recoveryref',
  ]));

  function clientError(code, outcome) {
    var error = new Error(code);
    error.name = 'ExtensionByokWorkbenchBatchClientError';
    error.code = code;
    if (outcome) {
      error.outcome = outcome;
      error.automaticRetryAllowed = false;
    }
    return error;
  }

  function fail(code, outcome) {
    throw clientError(code, outcome);
  }

  function isRecord(value) {
    return Boolean(value) && Object.prototype.toString.call(value) === '[object Object]'
      && Object.getOwnPropertySymbols(value).length === 0;
  }

  function exactKeys(value, keys) {
    return isRecord(value)
      && Object.keys(value).length === keys.length
      && Object.keys(value).every(function (key) { return keys.includes(key); });
  }

  function normalizedKey(value) {
    return String(value).normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/gu, '');
  }

  function binaryValue(value) {
    var tag = Object.prototype.toString.call(value);
    return tag === '[object Blob]' || tag === '[object ArrayBuffer]'
      || tag === '[object SharedArrayBuffer]' || tag === '[object DataView]'
      || /^\[object (?:Uint|Int|Float|BigInt|BigUint|Uint8Clamped)[0-9]*Array\]$/u
        .test(tag);
  }

  function hasControlCharacter(value) {
    for (var index = 0; index < value.length; index += 1) {
      var code = value.charCodeAt(index);
      if (code <= 31 || code === 127) return true;
    }
    return false;
  }

  function hasUnsafePromptCharacter(value) {
    for (var index = 0; index < value.length; index += 1) {
      var code = value.charCodeAt(index);
      if (code <= 8 || code === 11 || code === 12
        || (code >= 14 && code <= 31) || code === 127) return true;
    }
    return false;
  }

  function containsUrl(value) {
    return /(?:https?|ftp|file|blob|data):/iu.test(value);
  }

  function containsSecret(value) {
    return /(?:^|[^a-z0-9])(?:sk-[a-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|LTAI[a-zA-Z0-9]{12,}|AKID[a-zA-Z0-9]{12,})(?:$|[^a-z0-9])/iu
      .test(value)
      || /Bearer\s+\S+/iu.test(value)
      || /-----BEGIN [A-Z ]+PRIVATE KEY-----/u.test(value)
      || /(?:^|\s)eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+(?:$|\s)/u
        .test(value);
  }

  function assertInputTree(value, state, seen, fieldName) {
    state.nodes += 1;
    if (state.nodes > 512 || state.depth > 8) {
      fail('SS_ERP_BYOK_BATCH_CLIENT_INPUT_INVALID');
    }
    if (value === null || typeof value === 'boolean') return;
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value)) fail('SS_ERP_BYOK_BATCH_CLIENT_INPUT_INVALID');
      return;
    }
    if (typeof value === 'string') {
      var maximum = ['prompt', 'negativeprompt'].includes(normalizedKey(fieldName || ''))
        ? MAX_PROMPT_CHARACTERS : 8000;
      if (value.length > maximum || hasUnsafePromptCharacter(value)
        || containsUrl(value) || containsSecret(value)) {
        fail('SS_ERP_BYOK_BATCH_CLIENT_INPUT_INVALID');
      }
      return;
    }
    if (!value || typeof value !== 'object' || binaryValue(value)
      || seen.has(value) || (!Array.isArray(value) && !isRecord(value))) {
      fail('SS_ERP_BYOK_BATCH_CLIENT_INPUT_INVALID');
    }
    seen.add(value);
    var nextState = { nodes: state.nodes, depth: state.depth + 1 };
    if (Array.isArray(value)) {
      if (value.length > MAX_SLOTS) fail('SS_ERP_BYOK_BATCH_CLIENT_INPUT_INVALID');
      value.forEach(function (item) {
        assertInputTree(item, nextState, seen, fieldName);
        state.nodes = nextState.nodes;
      });
    } else {
      var keys = Object.keys(value);
      if (keys.length > 20) fail('SS_ERP_BYOK_BATCH_CLIENT_INPUT_INVALID');
      keys.forEach(function (key) {
        if (!key || key.length > 100 || hasControlCharacter(key)
          || INPUT_FORBIDDEN_KEYS.has(normalizedKey(key))) {
          fail('SS_ERP_BYOK_BATCH_CLIENT_INPUT_INVALID');
        }
        assertInputTree(value[key], nextState, seen, key);
        state.nodes = nextState.nodes;
      });
    }
    seen.delete(value);
  }

  function safeInput(value) {
    assertInputTree(value, { nodes: 0, depth: 0 }, new Set(), '');
    return value;
  }

  function canonicalText(value, minimum, maximum, code) {
    if (typeof value !== 'string' || value.length < minimum || value.length > maximum
      || value !== value.normalize('NFKC').trim() || hasControlCharacter(value)
      || containsUrl(value) || containsSecret(value)) fail(code);
    return value;
  }

  function prompt(value, maximum, nullable, code) {
    if (nullable && (value === null || value === '')) return null;
    if (typeof value !== 'string' || value.length < 1 || value.length > maximum
      || value !== value.normalize('NFKC').trim() || hasUnsafePromptCharacter(value)
      || containsUrl(value) || containsSecret(value)) fail(code);
    return value;
  }

  function identifier(value, minimum, maximum, code) {
    var result = canonicalText(value, minimum, maximum, code);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u.test(result)) fail(code);
    return result;
  }

  function opaqueText(value, minimum, maximum, code) {
    var result = canonicalText(value, minimum, maximum, code);
    if (result.includes('?') || result.includes('#')) fail(code);
    return result;
  }

  function positiveInteger(value, code) {
    if (!Number.isSafeInteger(value) || value < 1) fail(code);
    return value;
  }

  function nonNegativeInteger(value, maximum, code) {
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum) fail(code);
    return value;
  }

  function nullablePositiveInteger(value, code) {
    return value === null ? null : positiveInteger(value, code);
  }

  function sha256(value, code) {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) fail(code);
    return value;
  }

  function nullableIdentifier(value, code) {
    return value === null ? null : identifier(value, 1, 200, code);
  }

  function nullableSha256(value, code) {
    return value === null ? null : sha256(value, code);
  }

  function nullableErrorCode(value, code) {
    if (value === null) return null;
    if (typeof value !== 'string' || !/^[A-Z][A-Z0-9_.:-]{0,119}$/u.test(value)) fail(code);
    return value;
  }

  function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (isRecord(value)) {
      return Object.fromEntries(Object.entries(value).map(function (entry) {
        return [entry[0], clone(entry[1])];
      }));
    }
    return value;
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }

  function slotKey(value, code) {
    var result = identifier(value, 1, 200, code);
    if (!/^sku:.+:hero$/u.test(result)
      && !SHARED_DETAIL_ROLES.some(function (role) {
        return result === 'shared:detail:' + role;
      })) fail(code);
    return result;
  }

  function imageSize(value, code) {
    var result = canonicalText(value, 3, 9, code);
    if (!/^\d{1,4}x\d{1,4}$/u.test(result)) fail(code);
    var dimensions = result.split('x').map(Number);
    if (dimensions.some(function (dimension) {
      return !Number.isSafeInteger(dimension) || dimension < 1 || dimension > 4096;
    }) || dimensions[0] * dimensions[1] > 4096 * 4096) fail(code);
    return result;
  }

  function normalizeStartSlot(value) {
    var code = 'SS_ERP_BYOK_BATCH_CLIENT_INPUT_INVALID';
    if (!exactKeys(value, [
      'skuKey', 'slotKey', 'operation', 'providerIdempotencyKey', 'intentHash',
      'prompt', 'negativePrompt', 'size',
    ]) || value.operation !== 'TEXT_TO_IMAGE') fail(code);
    var skuKey = opaqueText(value.skuKey, 1, 500, code);
    var normalizedSlotKey = slotKey(value.slotKey, code);
    if (normalizedSlotKey !== 'sku:' + skuKey + ':hero'
      && !SHARED_DETAIL_ROLES.some(function (role) {
        return normalizedSlotKey === 'shared:detail:' + role;
      })) fail(code);
    return Object.freeze({
      skuKey: skuKey,
      slotKey: normalizedSlotKey,
      operation: 'TEXT_TO_IMAGE',
      providerIdempotencyKey: identifier(value.providerIdempotencyKey, 16, 200, code),
      intentHash: sha256(value.intentHash, code),
      prompt: prompt(value.prompt, MAX_PROMPT_CHARACTERS, false, code),
      negativePrompt: prompt(
        value.negativePrompt,
        MAX_NEGATIVE_PROMPT_CHARACTERS,
        true,
        code,
      ),
      size: imageSize(value.size, code),
    });
  }

  function normalizeStart(value) {
    var code = 'SS_ERP_BYOK_BATCH_CLIENT_INPUT_INVALID';
    safeInput(value);
    if (!exactKeys(value, ['profileId', 'requestedConcurrency', 'slots'])
      || !Array.isArray(value.slots) || value.slots.length < 1
      || value.slots.length > MAX_SLOTS) fail(code);
    var requestedConcurrency = positiveInteger(value.requestedConcurrency, code);
    if (requestedConcurrency !== SERIAL_REQUESTED_CONCURRENCY) fail(code);
    var slots = value.slots.map(normalizeStartSlot);
    ['slotKey', 'providerIdempotencyKey'].forEach(function (field) {
      if (new Set(slots.map(function (slot) { return slot[field]; })).size !== slots.length) {
        fail(code);
      }
    });
    return deepFreeze({
      contractVersion: USER_START_VERSION,
      profileId: identifier(value.profileId, 1, 128, code),
      requestedConcurrency: requestedConcurrency,
      slots: slots,
    });
  }

  function chargeAcknowledgement(value) {
    var code = 'SS_ERP_BYOK_BATCH_CLIENT_INPUT_INVALID';
    if (!exactKeys(value, ['warningVersion', 'confirmed'])
      || value.warningVersion !== EXTERNAL_CHARGE_WARNING_VERSION
      || value.confirmed !== true) fail(code);
    return Object.freeze({
      warningVersion: EXTERNAL_CHARGE_WARNING_VERSION,
      confirmed: true,
    });
  }

  function unknownRecovery(value) {
    var code = 'SS_ERP_BYOK_BATCH_CLIENT_INPUT_INVALID';
    if (!exactKeys(value, ['strategy', 'warningVersion', 'confirmed'])
      || value.strategy !== 'DUPLICATE_CHARGE_CONFIRMATION'
      || value.warningVersion !== DUPLICATE_CHARGE_WARNING_VERSION
      || value.confirmed !== true) fail(code);
    return Object.freeze({
      strategy: 'DUPLICATE_CHARGE_CONFIRMATION',
      warningVersion: DUPLICATE_CHARGE_WARNING_VERSION,
      confirmed: true,
    });
  }

  function commandBase(value, code) {
    return {
      contractVersion: COMMAND_VERSION,
      kind: value.kind,
      commandId: identifier(value.commandId, 1, 200, code),
      expectedWorkspaceRevision: positiveInteger(value.expectedWorkspaceRevision, code),
      expectedRuntimeRevision: positiveInteger(value.expectedRuntimeRevision, code),
    };
  }

  function slotCommand(value, base, code) {
    return {
      ...base,
      slotKey: slotKey(value.slotKey, code),
      attemptId: identifier(value.attemptId, 1, 200, code),
      expectedSlotRevision: positiveInteger(value.expectedSlotRevision, code),
    };
  }

  function normalizeCommand(value) {
    var code = 'SS_ERP_BYOK_BATCH_CLIENT_INPUT_INVALID';
    safeInput(value);
    if (!isRecord(value) || !COMMAND_KINDS.includes(value.kind)) fail(code);
    var base = commandBase(value, code);
    if (['PAUSE_AFTER_CURRENT', 'CONTINUE'].includes(value.kind)) {
      if (!exactKeys(value, COMMAND_BASE_KEYS)) fail(code);
      return Object.freeze(base);
    }
    var reviewKeys = COMMAND_BASE_KEYS.concat([
      'slotKey', 'attemptId', 'expectedSlotRevision',
    ]);
    if (['CANCEL_QUEUED', 'KEEP_ATTEMPT', 'REJECT_ATTEMPT'].includes(value.kind)) {
      if (!exactKeys(value, reviewKeys)) fail(code);
      return Object.freeze(slotCommand(value, base, code));
    }
    if (value.kind === 'REGENERATE_SLOT') {
      if (!exactKeys(value, COMMAND_BASE_KEYS.concat([
        'slotKey', 'expectedSlotRevision', 'externalChargeAcknowledgement',
      ]))) fail(code);
      return deepFreeze({
        ...base,
        slotKey: slotKey(value.slotKey, code),
        expectedSlotRevision: positiveInteger(value.expectedSlotRevision, code),
        externalChargeAcknowledgement: chargeAcknowledgement(
          value.externalChargeAcknowledgement,
        ),
      });
    }
    if (value.kind === 'RETRY_ATTEMPT') {
      var chargeKeys = reviewKeys.concat(['externalChargeAcknowledgement']);
      var recoveryKeys = reviewKeys.concat(['unknownOutcomeRecovery']);
      var charge = exactKeys(value, chargeKeys);
      var recovery = exactKeys(value, recoveryKeys);
      if (charge === recovery) fail(code);
      var retry = slotCommand(value, base, code);
      if (charge) {
        retry.externalChargeAcknowledgement = chargeAcknowledgement(
          value.externalChargeAcknowledgement,
        );
      } else retry.unknownOutcomeRecovery = unknownRecovery(value.unknownOutcomeRecovery);
      return deepFreeze(retry);
    }
    if (!exactKeys(value, reviewKeys)) fail(code);
    return Object.freeze(slotCommand(value, base, code));
  }

  function normalizePreviewInput(value) {
    var code = 'SS_ERP_BYOK_BATCH_CLIENT_INPUT_INVALID';
    safeInput(value);
    if (!exactKeys(value, ['slotKey', 'attemptId'])) fail(code);
    return Object.freeze({
      slotKey: slotKey(value.slotKey, code),
      attemptId: identifier(value.attemptId, 1, 200, code),
    });
  }

  function normalizeIngest(value) {
    var code = 'SS_ERP_BYOK_BATCH_CLIENT_INPUT_INVALID';
    safeInput(value);
    if (!exactKeys(value, ['idempotencyKey'])) fail(code);
    return Object.freeze({
      contractVersion: INGEST_VERSION,
      idempotencyKey: identifier(value.idempotencyKey, 16, 200, code),
    });
  }

  function normalizeAttempt(value) {
    var code = 'SS_ERP_BYOK_BATCH_CLIENT_RESPONSE_INVALID';
    var currentKeys = [
      'attemptId', 'generation', 'operation', 'intentHash', 'state', 'resultId',
      'resultSha256', 'errorCode', 'retryOfAttemptId', 'externalChargePossible',
      'retryRisk', 'chargeWarningVersion', 'automaticRetryAllowed',
      'recoveryRequirement', 'unknownOutcomeSuperseded', 'reviewState',
    ];
    var publicKeys = currentKeys.filter(function (key) {
      return key !== 'intentHash' && key !== 'resultSha256';
    });
    var hasCurrentShape = exactKeys(value, currentKeys);
    if (!hasCurrentShape && !exactKeys(value, publicKeys)) fail(code);
    if (!OPERATIONS.includes(value.operation) || !ATTEMPT_STATES.includes(value.state)
      || !REVIEW_STATES.includes(value.reviewState)
      || typeof value.externalChargePossible !== 'boolean'
      || typeof value.unknownOutcomeSuperseded !== 'boolean'
      || !(value.retryRisk === null || RETRY_RISKS.includes(value.retryRisk))
      || !(value.chargeWarningVersion === null
        || value.chargeWarningVersion === EXTERNAL_CHARGE_WARNING_VERSION
        || value.chargeWarningVersion === DUPLICATE_CHARGE_WARNING_VERSION)
      || !(value.automaticRetryAllowed === null
        || typeof value.automaticRetryAllowed === 'boolean')
      || !(value.recoveryRequirement === null
        || value.recoveryRequirement === RECOVERY_REQUIREMENT
        || value.recoveryRequirement === RESTART_RECOVERY_REQUIREMENT)) fail(code);
    if (hasCurrentShape) {
      sha256(value.intentHash, code);
      nullableSha256(value.resultSha256, code);
    }
    return Object.freeze({
      attemptId: identifier(value.attemptId, 1, 200, code),
      generation: positiveInteger(value.generation, code),
      operation: value.operation,
      state: value.state,
      resultId: nullableIdentifier(value.resultId, code),
      errorCode: nullableErrorCode(value.errorCode, code),
      retryOfAttemptId: nullableIdentifier(value.retryOfAttemptId, code),
      externalChargePossible: value.externalChargePossible,
      retryRisk: value.retryRisk,
      chargeWarningVersion: value.chargeWarningVersion,
      automaticRetryAllowed: value.automaticRetryAllowed,
      recoveryRequirement: value.recoveryRequirement,
      unknownOutcomeSuperseded: value.unknownOutcomeSuperseded,
      reviewState: value.reviewState,
    });
  }

  function normalizeSlot(value) {
    var code = 'SS_ERP_BYOK_BATCH_CLIENT_RESPONSE_INVALID';
    if (!exactKeys(value, [
      'slotKey', 'skuKey', 'assignmentOrdinal', 'operation', 'revision', 'state',
      'selectedAttemptId', 'selectedResultId', 'attempts',
    ]) || !OPERATIONS.includes(value.operation) || !SLOT_STATES.includes(value.state)
      || !Array.isArray(value.attempts) || value.attempts.length > MAX_ATTEMPTS_PER_SLOT) {
      fail(code);
    }
    var attempts = value.attempts.map(normalizeAttempt);
    var attemptIds = attempts.map(function (attempt) { return attempt.attemptId; });
    var selectedAttemptId = nullableIdentifier(value.selectedAttemptId, code);
    var selectedResultId = nullableIdentifier(value.selectedResultId, code);
    if (new Set(attemptIds).size !== attemptIds.length
      || (selectedAttemptId !== null && !attemptIds.includes(selectedAttemptId))
      || (selectedAttemptId === null) !== (selectedResultId === null)) fail(code);
    return deepFreeze({
      slotKey: slotKey(value.slotKey, code),
      skuKey: opaqueText(value.skuKey, 1, 500, code),
      assignmentOrdinal: nonNegativeInteger(value.assignmentOrdinal, 499, code),
      operation: value.operation,
      revision: nonNegativeInteger(value.revision, Number.MAX_SAFE_INTEGER, code),
      state: value.state,
      selectedAttemptId: selectedAttemptId,
      selectedResultId: selectedResultId,
      attempts: attempts,
    });
  }

  function normalizeScheduler(value) {
    var code = 'SS_ERP_BYOK_BATCH_CLIENT_RESPONSE_INVALID';
    if (!exactKeys(value, [
      'state', 'activeCount', 'queuedCount', 'pauseRequested', 'effectiveConcurrency',
    ]) || !SCHEDULER_STATES.includes(value.state)
      || typeof value.pauseRequested !== 'boolean') fail(code);
    return Object.freeze({
      state: value.state,
      activeCount: nonNegativeInteger(value.activeCount, MAX_SLOTS, code),
      queuedCount: nonNegativeInteger(value.queuedCount, MAX_SLOTS, code),
      pauseRequested: value.pauseRequested,
      effectiveConcurrency: positiveInteger(value.effectiveConcurrency, code),
    });
  }

  function normalizeBilling(value) {
    var code = 'SS_ERP_BYOK_BATCH_CLIENT_RESPONSE_INVALID';
    if (!exactKeys(value, ['erpGenerationChargeCents'])
      || value.erpGenerationChargeCents !== 0) fail(code);
    return Object.freeze({ erpGenerationChargeCents: 0 });
  }

  function normalizeAssignment(value) {
    var code = 'SS_ERP_BYOK_BATCH_CLIENT_RESPONSE_INVALID';
    var publicKeys = [
      'slotKey', 'skuKey', 'assignmentOrdinal', 'attemptId', 'resultId', 'assetId',
      'provenanceId', 'executionIntentId', 'mimeType', 'width', 'height',
    ];
    var currentKeys = [
      'slotKey', 'skuKey', 'assignmentOrdinal', 'attemptId', 'resultId',
      'resultSha256', 'assetId', 'provenanceId', 'executionIntentId',
      'providerRequestHash', 'providerResultSha256', 'normalizedSha256',
      'assignmentSha256', 'assignment', 'policyRevision', 'mimeType', 'width', 'height',
    ];
    var currentShape = exactKeys(value, currentKeys);
    if (!currentShape && !exactKeys(value, publicKeys)) fail(code);
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(value.mimeType)
      || !Number.isSafeInteger(value.width) || value.width < 1 || value.width > 4096
      || !Number.isSafeInteger(value.height) || value.height < 1 || value.height > 4096
      || value.width * value.height > 4096 * 4096) fail(code);
    if (currentShape) {
      [
        'resultSha256', 'providerRequestHash', 'providerResultSha256',
        'normalizedSha256', 'assignmentSha256',
      ].forEach(function (field) { sha256(value[field], code); });
      identifier(value.policyRevision, 1, 200, code);
      if (!isRecord(value.assignment)) fail(code);
    }
    return Object.freeze({
      slotKey: slotKey(value.slotKey, code),
      skuKey: opaqueText(value.skuKey, 1, 500, code),
      assignmentOrdinal: nonNegativeInteger(value.assignmentOrdinal, 499, code),
      attemptId: identifier(value.attemptId, 1, 200, code),
      resultId: identifier(value.resultId, 1, 200, code),
      assetId: identifier(value.assetId, 1, 200, code),
      provenanceId: identifier(value.provenanceId, 1, 200, code),
      executionIntentId: identifier(value.executionIntentId, 1, 200, code),
      mimeType: value.mimeType,
      width: value.width,
      height: value.height,
    });
  }

  function validateLegacyReceiptAssignment(value, assetId, code) {
    var skuKeys = ['scope', 'skuKey', 'slotKey', 'assetId', 'source'];
    var productKeys = ['scope', 'slotKey', 'assetId', 'source'];
    if ((!exactKeys(value, skuKeys) || value.scope !== 'SKU')
      && (!exactKeys(value, productKeys) || value.scope !== 'PRODUCT')) fail(code);
    if (value.assetId !== assetId || !['GENERATED', 'EDITED'].includes(value.source)) fail(code);
    slotKey(value.slotKey, code);
    if (value.scope === 'SKU') opaqueText(value.skuKey, 1, 500, code);
  }

  function validateLegacyReceiptItem(value, code) {
    if (!exactKeys(value, [
      'assetId', 'provenanceId', 'executionIntentId', 'providerRequestHash',
      'providerResultSha256', 'normalizedSha256', 'mimeType', 'width', 'height',
      'skuKey', 'slotKey', 'assignmentOrdinal', 'assignmentSha256', 'assignment',
      'policyRevision',
    ]) || !['image/png', 'image/jpeg', 'image/webp'].includes(value.mimeType)
      || !Number.isSafeInteger(value.width) || value.width < 1 || value.width > 4096
      || !Number.isSafeInteger(value.height) || value.height < 1 || value.height > 4096
      || value.width * value.height > 4096 * 4096) fail(code);
    var assetId = identifier(value.assetId, 1, 200, code);
    identifier(value.provenanceId, 1, 200, code);
    identifier(value.executionIntentId, 1, 200, code);
    identifier(value.policyRevision, 1, 200, code);
    opaqueText(value.skuKey, 1, 500, code);
    slotKey(value.slotKey, code);
    nonNegativeInteger(value.assignmentOrdinal, 499, code);
    [
      'providerRequestHash', 'providerResultSha256', 'normalizedSha256',
      'assignmentSha256',
    ].forEach(function (field) { sha256(value[field], code); });
    validateLegacyReceiptAssignment(value.assignment, assetId, code);
  }

  function validateLegacyReceipt(value, code) {
    if (!exactKeys(value, [
      'contractVersion', 'executionBatchId', 'replayed', 'receiptId', 'requestHash',
      'sourceDraftRevision', 'sourceDraftVersion', 'boundDraftRevision',
      'boundDraftVersion', 'erpAiChargeCents', 'items',
    ]) || value.contractVersion !== 'extension-byok-media-batch-ingest-receipt/v1'
      || typeof value.replayed !== 'boolean' || value.erpAiChargeCents !== 0
      || !Array.isArray(value.items) || value.items.length < 1
      || value.items.length > MAX_SLOTS) fail(code);
    identifier(value.executionBatchId, 1, 200, code);
    identifier(value.receiptId, 1, 200, code);
    sha256(value.requestHash, code);
    positiveInteger(value.sourceDraftRevision, code);
    positiveInteger(value.sourceDraftVersion, code);
    positiveInteger(value.boundDraftRevision, code);
    positiveInteger(value.boundDraftVersion, code);
    value.items.forEach(function (item) { validateLegacyReceiptItem(item, code); });
  }

  function normalizeIngestOutput(value) {
    var code = 'SS_ERP_BYOK_BATCH_CLIENT_RESPONSE_INVALID';
    var currentKeys = [
      'state', 'idempotencyKey', 'replayed', 'receiptId', 'requestHash',
      'boundDraftRevision', 'boundDraftVersion', 'erpGenerationChargeCents',
      'rebootstrapRequired', 'receipt', 'assignments', 'errorCode',
    ];
    var publicKeys = [
      'state', 'idempotencyKey', 'replayed', 'receiptId', 'boundDraftRevision',
      'boundDraftVersion', 'erpGenerationChargeCents', 'rebootstrapRequired',
      'assignments', 'errorCode',
    ];
    var hasCurrentShape = exactKeys(value, currentKeys);
    if (!hasCurrentShape && !exactKeys(value, publicKeys)) fail(code);
    if (!INGEST_STATES.includes(value.state)
      || value.erpGenerationChargeCents !== 0
      || typeof value.rebootstrapRequired !== 'boolean') fail(code);
    if (!(value.idempotencyKey === null
      || typeof value.idempotencyKey === 'string' && value.idempotencyKey.length >= 16)
      || !(value.replayed === null || typeof value.replayed === 'boolean')
      || !(value.receiptId === null || typeof value.receiptId === 'string')
      || !Array.isArray(value.assignments) || value.assignments.length > MAX_SLOTS) fail(code);
    if (hasCurrentShape) {
      if (!(value.requestHash === null || /^[a-f0-9]{64}$/u.test(value.requestHash))
        || !(value.receipt === null || isRecord(value.receipt))) fail(code);
      if (value.receipt !== null) validateLegacyReceipt(value.receipt, code);
    }
    var assignments = value.assignments.map(normalizeAssignment);
    return Object.freeze({
      state: value.state,
      idempotencyKey: value.idempotencyKey === null
        ? null : identifier(value.idempotencyKey, 16, 200, code),
      replayed: value.replayed,
      receiptId: value.receiptId === null
        ? null : identifier(value.receiptId, 1, 200, code),
      boundDraftRevision: nullablePositiveInteger(value.boundDraftRevision, code),
      boundDraftVersion: nullablePositiveInteger(value.boundDraftVersion, code),
      erpGenerationChargeCents: 0,
      rebootstrapRequired: value.rebootstrapRequired,
      assignments: assignments,
      errorCode: nullableErrorCode(value.errorCode, code),
    });
  }

  function normalizeProjection(value) {
    var code = 'SS_ERP_BYOK_BATCH_CLIENT_RESPONSE_INVALID';
    var publicKeys = [
      'contractVersion', 'executionMode', 'revision', 'scheduler', 'billing', 'slots',
      'ingest',
    ];
    var currentKeys = publicKeys.concat(['batchId', 'binding']);
    var currentShape = exactKeys(value, currentKeys);
    if (!currentShape && !exactKeys(value, publicKeys)) fail(code);
    if (value.contractVersion !== COORDINATOR_VERSION || value.executionMode !== 'BYOK'
      || !Array.isArray(value.slots) || value.slots.length > MAX_SLOTS) fail(code);
    if (currentShape) {
      if (!(value.batchId === null || typeof value.batchId === 'string')
        || !(value.binding === null || exactKeys(value.binding, [
          'shopId', 'workflowId', 'draftRevision', 'draftVersion', 'skuKey',
        ]))) fail(code);
      if (value.batchId !== null) identifier(value.batchId, 1, 200, code);
      if (value.binding !== null) {
        opaqueText(value.binding.shopId, 1, 200, code);
        opaqueText(value.binding.workflowId, 1, 200, code);
        positiveInteger(value.binding.draftRevision, code);
        positiveInteger(value.binding.draftVersion, code);
        opaqueText(value.binding.skuKey, 1, 500, code);
      }
    }
    var revision = nonNegativeInteger(value.revision, Number.MAX_SAFE_INTEGER, code);
    var empty = revision === 0;
    if (empty !== (value.scheduler === null) || empty !== (value.ingest === null)
      || (empty && value.slots.length !== 0)) fail(code);
    var slots = value.slots.map(normalizeSlot);
    if (new Set(slots.map(function (slot) { return slot.slotKey; })).size !== slots.length) {
      fail(code);
    }
    return deepFreeze({
      contractVersion: COORDINATOR_VERSION,
      executionMode: 'BYOK',
      revision: revision,
      scheduler: value.scheduler === null ? null : normalizeScheduler(value.scheduler),
      billing: normalizeBilling(value.billing),
      slots: slots,
      ingest: value.ingest === null ? null : normalizeIngestOutput(value.ingest),
    });
  }

  function normalizeCommandOutput(value) {
    if (exactKeys(value, ['cancelled', 'attemptId', 'projection'])
      && typeof value.cancelled === 'boolean') {
      identifier(value.attemptId, 1, 200, 'SS_ERP_BYOK_BATCH_CLIENT_RESPONSE_INVALID');
      return normalizeProjection(value.projection);
    }
    return normalizeProjection(value);
  }

  function normalizeClearOutput(value) {
    if (!exactKeys(value, ['cleared']) || value.cleared !== true) {
      fail('SS_ERP_BYOK_BATCH_CLIENT_RESPONSE_INVALID');
    }
    return Object.freeze({ cleared: true });
  }

  function createClient(options) {
    var config = options || {};
    if (!isRecord(config) || Object.keys(config).some(function (key) {
      return !['runtime', 'BroadcastChannel', 'now', 'timeoutMs'].includes(key);
    })) fail('SS_ERP_BYOK_BATCH_CLIENT_DEPENDENCY_UNAVAILABLE');
    var runtime = config.runtime || global.chrome && global.chrome.runtime;
    var Channel = config.BroadcastChannel || global.BroadcastChannel;
    var BlobConstructor = global.Blob;
    var now = typeof config.now === 'function' ? config.now : function () { return new Date(); };
    var schedule = global.setTimeout;
    var cancel = global.clearTimeout;
    var timeoutMs = config.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : config.timeoutMs;
    if (!runtime || typeof runtime.sendMessage !== 'function'
      || typeof Channel !== 'function' || typeof BlobConstructor !== 'function'
      || typeof schedule !== 'function' || typeof cancel !== 'function'
      || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1
      || timeoutMs > DEFAULT_TIMEOUT_MS) {
      fail('SS_ERP_BYOK_BATCH_CLIENT_DEPENDENCY_UNAVAILABLE');
    }
    var previewTickets = new Map();

    function currentMillis(code) {
      var result = new Date(now()).getTime();
      if (!Number.isFinite(result)) fail(code);
      return result;
    }

    function prunePreviewTickets(at) {
      previewTickets.forEach(function (expiresAt, ticket) {
        if (expiresAt <= at) previewTickets.delete(ticket);
      });
    }

    function operationError(type, timeout) {
      if (type === MESSAGE_TYPES.BATCH_START) {
        return clientError(
          timeout
            ? 'SS_ERP_BYOK_BATCH_CLIENT_START_TIMEOUT'
            : 'SS_ERP_BYOK_BATCH_CLIENT_START_FAILED',
          'UNKNOWN_OUTCOME',
        );
      }
      if ([MESSAGE_TYPES.BATCH_INGEST, MESSAGE_TYPES.BATCH_RECOVER].includes(type)) {
        return clientError(
          timeout
            ? 'SS_ERP_BYOK_BATCH_CLIENT_INGEST_TIMEOUT'
            : 'SS_ERP_BYOK_BATCH_CLIENT_INGEST_FAILED',
          'UNKNOWN_OUTCOME',
        );
      }
      return clientError(timeout
        ? 'SS_ERP_BYOK_BATCH_CLIENT_RUNTIME_TIMEOUT'
        : 'SS_ERP_BYOK_BATCH_CLIENT_RUNTIME_FAILED');
    }

    function send(type, payload, normalizeOutput) {
      var message = deepFreeze({ type: type, payload: clone(payload) });
      return new Promise(function (resolve, reject) {
        var settled = false;
        var timer = schedule(function () {
          if (settled) return;
          settled = true;
          reject(operationError(type, true));
        }, timeoutMs);

        function finish(callback, value) {
          if (settled) return;
          settled = true;
          cancel(timer);
          callback(value);
        }

        try {
          runtime.sendMessage(message, function (response) {
            if (runtime.lastError) {
              finish(reject, operationError(type, false));
              return;
            }
            if (exactKeys(response, [
              'ok', 'errorCode', 'error', 'outcome', 'automaticRetryAllowed',
            ])
              && response.ok === false
              && response.error === 'BYOK batch workbench operation failed'
              && ['FAILED_FINAL', 'FAILED_RETRYABLE', 'UNKNOWN_OUTCOME'].includes(response.outcome)
              && response.automaticRetryAllowed === false) {
              var errorCode = typeof response.errorCode === 'string'
                && /^[A-Z][A-Z0-9_]{0,119}$/u.test(response.errorCode)
                ? response.errorCode : 'SS_ERP_BYOK_BATCH_CLIENT_OPERATION_FAILED';
              finish(reject, clientError(errorCode, response.outcome));
              return;
            }
            if (!exactKeys(response, ['ok', 'data']) || response.ok !== true) {
              finish(reject, clientError('SS_ERP_BYOK_BATCH_CLIENT_RESPONSE_INVALID'));
              return;
            }
            try {
              finish(resolve, normalizeOutput(response.data));
            } catch (error) {
              finish(reject, error && error.name === 'ExtensionByokWorkbenchBatchClientError'
                ? error : clientError('SS_ERP_BYOK_BATCH_CLIENT_RESPONSE_INVALID'));
            }
          });
        } catch {
          finish(reject, operationError(type, false));
        }
      });
    }

    function normalizeTicket(value) {
      var code = 'SS_ERP_BYOK_BATCH_CLIENT_PREVIEW_INVALID';
      if (!exactKeys(value, [
        'contractVersion', 'channelName', 'previewTicket', 'expiresAt', 'metadata',
      ]) || value.contractVersion !== PREVIEW_VERSION
        || !/^ss-erp:byok-preview:[a-f0-9]{48}$/u.test(value.channelName)
        || !/^pt_[a-f0-9]{48}$/u.test(value.previewTicket)
        || !exactKeys(value.metadata, ['mimeType', 'byteLength', 'sha256'])
        || !['image/png', 'image/jpeg', 'image/webp'].includes(value.metadata.mimeType)
        || !Number.isSafeInteger(value.metadata.byteLength)
        || value.metadata.byteLength < 1 || value.metadata.byteLength > MAX_IMAGE_BYTES
        || !/^[a-f0-9]{64}$/u.test(value.metadata.sha256)
        || typeof value.expiresAt !== 'string') fail(code);
      var current = currentMillis(code);
      var expiresAt = Date.parse(value.expiresAt);
      if (!Number.isFinite(expiresAt) || new Date(expiresAt).toISOString() !== value.expiresAt
        || expiresAt <= current || expiresAt - current > DEFAULT_TIMEOUT_MS) fail(code);
      prunePreviewTickets(current);
      if (previewTickets.has(value.previewTicket)) fail(code);
      previewTickets.set(value.previewTicket, expiresAt);
      return Object.freeze({
        channelName: value.channelName,
        previewTicket: value.previewTicket,
        expiresAt: expiresAt,
        metadata: Object.freeze({
          mimeType: value.metadata.mimeType,
          byteLength: value.metadata.byteLength,
          sha256: value.metadata.sha256,
        }),
      });
    }

    function consumePreview(ticket) {
      return new Promise(function (resolve, reject) {
        var channel;
        try { channel = new Channel(ticket.channelName); } catch {
          reject(clientError('SS_ERP_BYOK_BATCH_CLIENT_PREVIEW_UNAVAILABLE'));
          return;
        }
        var settled = false;
        var timer = null;

        function close() {
          if (timer !== null) {
            try { cancel(timer); } catch {}
          }
          timer = null;
          if (channel) {
            channel.onmessage = null;
            try { channel.close(); } catch {}
          }
          channel = null;
        }

        function finish(callback, value) {
          if (settled) return;
          settled = true;
          close();
          callback(value);
        }

        channel.onmessage = function (event) {
          var message = event && event.data;
          if (!exactKeys(message, [
            'contractVersion', 'type', 'previewTicket', 'image', 'metadata',
          ]) || message.contractVersion !== PREVIEW_VERSION || message.type !== 'PREVIEW'
            || message.previewTicket !== ticket.previewTicket
            || !exactKeys(message.metadata, ['mimeType', 'byteLength', 'sha256'])
            || message.metadata.mimeType !== ticket.metadata.mimeType
            || message.metadata.byteLength !== ticket.metadata.byteLength
            || message.metadata.sha256 !== ticket.metadata.sha256
            || !(message.image instanceof BlobConstructor)
            || message.image.type !== ticket.metadata.mimeType
            || message.image.size !== ticket.metadata.byteLength) {
            finish(reject, clientError('SS_ERP_BYOK_BATCH_CLIENT_PREVIEW_INVALID'));
            return;
          }
          finish(resolve, Object.freeze({
            image: message.image,
            metadata: Object.freeze({ ...ticket.metadata }),
          }));
        };

        try {
          var remaining = ticket.expiresAt - currentMillis(
            'SS_ERP_BYOK_BATCH_CLIENT_PREVIEW_INVALID',
          );
          if (remaining < 1) fail('SS_ERP_BYOK_BATCH_CLIENT_PREVIEW_INVALID');
          timer = schedule(function () {
            finish(reject, clientError('SS_ERP_BYOK_BATCH_CLIENT_PREVIEW_TIMEOUT'));
          }, Math.min(remaining, timeoutMs));
          channel.postMessage(Object.freeze({
            type: 'READY',
            previewTicket: ticket.previewTicket,
          }));
        } catch (error) {
          finish(reject, error && error.name === 'ExtensionByokWorkbenchBatchClientError'
            ? error : clientError('SS_ERP_BYOK_BATCH_CLIENT_PREVIEW_UNAVAILABLE'));
        }
      });
    }

    function noArguments(args) {
      if (args.length !== 0) fail('SS_ERP_BYOK_BATCH_CLIENT_INPUT_INVALID');
    }

    return Object.freeze({
      state: function () {
        try {
          noArguments(arguments);
          return send(
            MESSAGE_TYPES.BATCH_STATE,
            { contractVersion: REQUEST_VERSION },
            normalizeProjection,
          );
        } catch (error) { return Promise.reject(error); }
      },
      start: function (value) {
        try {
          var input = normalizeStart(value);
          return send(MESSAGE_TYPES.BATCH_START, {
            contractVersion: REQUEST_VERSION,
            startRequest: input,
          }, normalizeProjection);
        } catch (error) { return Promise.reject(error); }
      },
      command: function (value) {
        try {
          var input = normalizeCommand(value);
          return send(MESSAGE_TYPES.BATCH_COMMAND, {
            contractVersion: REQUEST_VERSION,
            command: input,
          }, normalizeCommandOutput);
        } catch (error) { return Promise.reject(error); }
      },
      openPreview: function (value) {
        try {
          var input = normalizePreviewInput(value);
          return send(MESSAGE_TYPES.BATCH_PREVIEW, {
            contractVersion: REQUEST_VERSION,
            slotKey: input.slotKey,
            attemptId: input.attemptId,
          }, normalizeTicket).then(consumePreview);
        } catch (error) { return Promise.reject(error); }
      },
      ingest: function (value) {
        try {
          var input = normalizeIngest(value);
          return send(MESSAGE_TYPES.BATCH_INGEST, {
            contractVersion: REQUEST_VERSION,
            ingestCommand: input,
          }, normalizeProjection);
        } catch (error) { return Promise.reject(error); }
      },
      recover: function (value) {
        try {
          var input = normalizeIngest(value);
          return send(MESSAGE_TYPES.BATCH_RECOVER, {
            contractVersion: REQUEST_VERSION,
            ingestCommand: input,
          }, normalizeProjection);
        } catch (error) { return Promise.reject(error); }
      },
      clear: function () {
        try {
          noArguments(arguments);
          return send(
            MESSAGE_TYPES.BATCH_CLEAR,
            { contractVersion: REQUEST_VERSION },
            normalizeClearOutput,
          );
        } catch (error) { return Promise.reject(error); }
      },
    });
  }

  global.SS_ERP_BYOK_WORKBENCH_BATCH_CLIENT = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    REQUEST_VERSION: REQUEST_VERSION,
    USER_START_VERSION: USER_START_VERSION,
    COMMAND_VERSION: COMMAND_VERSION,
    INGEST_VERSION: INGEST_VERSION,
    MESSAGE_TYPES: MESSAGE_TYPES,
    createClient: createClient,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
