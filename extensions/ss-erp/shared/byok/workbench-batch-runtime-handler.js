(function exposeByokWorkbenchBatchRuntimeHandler(global) {
  'use strict';

  var CONTRACT_VERSION = 'extension-byok-workbench-batch-runtime-handler/v1';
  var REQUEST_VERSION = 'extension-byok-workbench-batch-runtime-request/v1';
  var COMMAND_VERSION = 'extension-byok-workbench-batch-runtime-command/v1';
  var USER_START_VERSION = 'extension-byok-workbench-batch-user-start/v1';
  var REGISTRY_START_VERSION = 'extension-byok-workbench-batch-start-request/v1';
  var INGEST_VERSION = 'extension-byok-workbench-batch-ingest/v1';
  var EXTERNAL_CHARGE_WARNING_VERSION = 'external-provider-charge/v1';
  var DUPLICATE_CHARGE_WARNING_VERSION = 'external-provider-duplicate-charge/v1';
  var MAX_SELECTED_SLOTS = 4;
  var SERIAL_REQUESTED_CONCURRENCY = 1;
  var MAX_PROMPT_CHARACTERS = 8000;
  var MAX_NEGATIVE_PROMPT_CHARACTERS = 4000;
  var MAX_DIMENSION = 4096;
  var MAX_PIXELS = MAX_DIMENSION * MAX_DIMENSION;
  var MAX_INPUT_NODES = 512;
  var MAX_OUTPUT_NODES = 8192;
  var MESSAGE_TYPE_NAMES = Object.freeze([
    'BATCH_STATE', 'BATCH_START', 'BATCH_COMMAND', 'BATCH_PREVIEW',
    'BATCH_INGEST', 'BATCH_RECOVER', 'BATCH_CLEAR',
  ]);
  var REGISTRY_METHODS = Object.freeze([
    'state', 'start', 'command', 'openPreview', 'ingest', 'recover', 'clear',
  ]);
  var SHARED_DETAIL_ROLES = Object.freeze(['SCENE', 'DETAIL', 'SPEC', 'PACKAGING']);
  var COMMAND_KINDS = Object.freeze([
    'PAUSE_AFTER_CURRENT', 'CONTINUE', 'CANCEL_QUEUED', 'KEEP_ATTEMPT',
    'REJECT_ATTEMPT', 'REGENERATE_SLOT', 'RETRY_ATTEMPT', 'RESOLVE_UNKNOWN_ATTEMPT',
  ]);
  var COMMAND_BASE_KEYS = Object.freeze([
    'contractVersion', 'kind', 'commandId', 'expectedWorkspaceRevision',
    'expectedRuntimeRevision',
  ]);
  var USER_SLOT_KEYS = Object.freeze([
    'skuKey', 'slotKey', 'operation', 'providerIdempotencyKey', 'intentHash',
    'prompt', 'negativePrompt', 'size',
  ]);
  var SECRET_FORBIDDEN_KEYS = Object.freeze(new Set([
    'apikey', 'secretkey', 'authorization', 'accesstoken', 'refreshtoken',
    'sessiontoken', 'devicetoken', 'commandtoken', 'granttoken', 'password',
    'credential', 'credentials', 'blob', 'imageblob', 'arraybuffer', 'rawbytes',
    'imagebytes', 'base64', 'b64json',
  ]));
  var INPUT_FORBIDDEN_KEYS = Object.freeze(new Set([
    ...SECRET_FORBIDDEN_KEYS,
    'batchid', 'binding', 'providerorigin',
    'providerendpoint', 'endpoint', 'model', 'policyrevision', 'lifecycleauthority',
    'dispatchref', 'requesthash', 'preparehash', 'recoveryref',
  ]));
  var OUTPUT_FORBIDDEN_KEYS = Object.freeze(new Set([
    ...SECRET_FORBIDDEN_KEYS,
    'batchid', 'executionbatchid', 'binding', 'receipt', 'requesthash',
    'providerrequesthash', 'providerresultsha256', 'resultsha256', 'intenthash',
    'dispatchref', 'recoveryref',
    'providerorigin', 'providerendpoint', 'endpoint', 'model', 'prompt', 'prompttext',
    'dispatchinput', 'readinessbinding', 'lifecycleauthority',
  ]));

  function runtimeError(code) {
    var error = new Error(code);
    error.name = 'ExtensionByokWorkbenchBatchRuntimeHandlerError';
    error.code = code;
    return error;
  }

  function fail(code) {
    throw runtimeError(code);
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
    for (var index = 0; index < value.length; index += 1) {
      var code = value.charCodeAt(index);
      if (code <= 31 || code === 127) return true;
    }
    return false;
  }

  function hasUnsafeTextControlCharacter(value) {
    for (var index = 0; index < value.length; index += 1) {
      var code = value.charCodeAt(index);
      if (code <= 8 || code === 11 || code === 12
        || (code >= 14 && code <= 31) || code === 127) return true;
    }
    return false;
  }

  function canonicalText(value, minimum, maximum, code) {
    if (typeof value !== 'string' || value.length < minimum || value.length > maximum
      || value !== value.normalize('NFKC').trim() || hasControlCharacter(value)) fail(code);
    return value;
  }

  function identifier(value, minimum, maximum, code) {
    var result = canonicalText(value, minimum, maximum, code);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u.test(result)) fail(code);
    return result;
  }

  function opaqueText(value, minimum, maximum, code) {
    var result = canonicalText(value, minimum, maximum, code);
    if (/(?:https?|ftp|file|blob|data):/iu.test(result)
      || result.includes('?') || result.includes('#')) fail(code);
    return result;
  }

  function positiveInteger(value, code) {
    if (!Number.isSafeInteger(value) || value < 1) fail(code);
    return value;
  }

  function sha256(value, code) {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) fail(code);
    return value;
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }

  function normalizedKey(value) {
    return String(value).normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/gu, '');
  }

  function binaryValue(value) {
    var tag = Object.prototype.toString.call(value);
    return tag === '[object Blob]' || tag === '[object ArrayBuffer]'
      || tag === '[object SharedArrayBuffer]'
      || /^\[object (?!Array\])[a-zA-Z0-9]+Array\]$/u.test(tag)
      || tag === '[object DataView]';
  }

  function secretString(value, allowLongText) {
    return /^(?:sk-[a-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|LTAI[a-zA-Z0-9]{12,}|AKID[a-zA-Z0-9]{12,})$/iu
      .test(value)
      || /^Bearer\s+\S+/iu.test(value)
      || /^-----BEGIN [A-Z ]+PRIVATE KEY-----/u.test(value)
      || /^eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/u.test(value)
      || /^(?:data|blob):/iu.test(value)
      || (!allowLongText && value.length >= 128
        && /^(?:[a-zA-Z0-9+/]{4})+(?:[a-zA-Z0-9+/]{2}==|[a-zA-Z0-9+/]{3}=)?$/u
          .test(value));
  }

  function inspectValue(value, options, state, seen, fieldName) {
    state.nodes += 1;
    if (state.nodes > options.maxNodes || state.depth > options.maxDepth) fail(options.code);
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || !Number.isSafeInteger(value)) fail(options.code);
      return value;
    }
    if (typeof value === 'string') {
      var longText = options.longTextKeys.includes(normalizedKey(fieldName || ''));
      if (value.length > options.maxString || hasUnsafeTextControlCharacter(value)
        || secretString(value, longText)
        || (options.rejectUrls && /^(?:https?|ftp|file):/iu.test(value))) {
        fail(options.code);
      }
      return value;
    }
    if (!value || typeof value !== 'object' || binaryValue(value)
      || seen.has(value) || Object.getOwnPropertySymbols(value).length > 0) fail(options.code);
    seen.add(value);
    var nextState = { nodes: state.nodes, depth: state.depth + 1 };
    var result;
    if (Array.isArray(value)) {
      if (value.length > options.maxArray) fail(options.code);
      result = value.map(function (item) {
        var normalized = inspectValue(item, options, nextState, seen, fieldName);
        state.nodes = nextState.nodes;
        return normalized;
      });
    } else {
      var keys = Object.keys(value);
      if (keys.length > options.maxKeys) fail(options.code);
      result = {};
      keys.forEach(function (key) {
        if (!key || key.length > 100 || hasControlCharacter(key)
          || options.forbiddenKeys.has(normalizedKey(key))) fail(options.code);
        result[key] = inspectValue(value[key], options, nextState, seen, key);
        state.nodes = nextState.nodes;
      });
    }
    seen.delete(value);
    return result;
  }

  function assertSafeInput(value) {
    inspectValue(value, {
      code: 'SS_ERP_BYOK_BATCH_RUNTIME_INPUT_INVALID',
      maxNodes: MAX_INPUT_NODES,
      maxDepth: 8,
      maxArray: MAX_SELECTED_SLOTS,
      maxKeys: 20,
      maxString: MAX_PROMPT_CHARACTERS,
      forbiddenKeys: INPUT_FORBIDDEN_KEYS,
      rejectUrls: false,
      longTextKeys: ['prompt', 'negativeprompt'],
    }, { nodes: 0, depth: 0 }, new Set());
  }

  function publicOutput(value) {
    return deepFreeze(inspectValue(value, {
      code: 'SS_ERP_BYOK_BATCH_RUNTIME_RESPONSE_INVALID',
      maxNodes: MAX_OUTPUT_NODES,
      maxDepth: 12,
      maxArray: 512,
      maxKeys: 64,
      maxString: 4096,
      forbiddenKeys: OUTPUT_FORBIDDEN_KEYS,
      rejectUrls: true,
      longTextKeys: [],
    }, { nodes: 0, depth: 0 }, new Set()));
  }

  function senderOwner(value) {
    if (!isRecord(value) || !Number.isSafeInteger(value.tabId) || value.tabId < 0) {
      fail('SS_ERP_BYOK_BATCH_RUNTIME_SENDER_DENIED');
    }
    return Object.freeze({
      tabId: value.tabId,
      documentId: opaqueText(
        value.documentId,
        1,
        200,
        'SS_ERP_BYOK_BATCH_RUNTIME_SENDER_DENIED',
      ),
    });
  }

  function requestPayload(context, keys) {
    var value = context && context.payload;
    assertSafeInput(value);
    if (!exactKeys(value, keys) || value.contractVersion !== REQUEST_VERSION) {
      fail('SS_ERP_BYOK_BATCH_RUNTIME_INPUT_INVALID');
    }
    return value;
  }

  function promptText(value, maximum, nullable, code) {
    if (nullable && (value === null || value === '')) return null;
    if (typeof value !== 'string' || value.length < 1 || value.length > maximum
      || value !== value.normalize('NFKC').trim()
      || hasUnsafeTextControlCharacter(value)) fail(code);
    return value;
  }

  function imageSize(value, code) {
    var result = canonicalText(value, 3, 9, code);
    if (!/^\d{1,4}x\d{1,4}$/u.test(result)) fail(code);
    var dimensions = result.split('x').map(Number);
    if (dimensions.some(function (dimension) {
      return !Number.isSafeInteger(dimension) || dimension < 1 || dimension > MAX_DIMENSION;
    }) || dimensions[0] * dimensions[1] > MAX_PIXELS) fail(code);
    return result;
  }

  function normalizeUserSlot(value) {
    var code = 'SS_ERP_BYOK_BATCH_RUNTIME_INPUT_INVALID';
    if (!exactKeys(value, USER_SLOT_KEYS) || value.operation !== 'TEXT_TO_IMAGE') fail(code);
    var skuKey = opaqueText(value.skuKey, 1, 500, code);
    var normalizedSlotKey = slotKey(value.slotKey, code);
    var hero = normalizedSlotKey === 'sku:' + skuKey + ':hero';
    var shared = SHARED_DETAIL_ROLES.some(function (role) {
      return normalizedSlotKey === 'shared:detail:' + role;
    });
    if (!hero && !shared) fail(code);
    return Object.freeze({
      skuKey: skuKey,
      slotKey: normalizedSlotKey,
      operation: 'TEXT_TO_IMAGE',
      providerIdempotencyKey: identifier(value.providerIdempotencyKey, 16, 200, code),
      intentHash: sha256(value.intentHash, code),
      prompt: promptText(value.prompt, MAX_PROMPT_CHARACTERS, false, code),
      negativePrompt: promptText(
        value.negativePrompt, MAX_NEGATIVE_PROMPT_CHARACTERS, true, code,
      ),
      size: imageSize(value.size, code),
    });
  }

  function normalizeUserStart(value) {
    var code = 'SS_ERP_BYOK_BATCH_RUNTIME_INPUT_INVALID';
    if (!exactKeys(value, [
      'contractVersion', 'profileId', 'requestedConcurrency', 'slots',
    ]) || value.contractVersion !== USER_START_VERSION || !Array.isArray(value.slots)
      || value.slots.length < 1 || value.slots.length > MAX_SELECTED_SLOTS) fail(code);
    var requestedConcurrency = positiveInteger(value.requestedConcurrency, code);
    if (requestedConcurrency !== SERIAL_REQUESTED_CONCURRENCY) fail(code);
    var slots = value.slots.map(normalizeUserSlot);
    ['slotKey', 'providerIdempotencyKey'].forEach(function (field) {
      if (new Set(slots.map(function (slot) { return slot[field]; })).size !== slots.length) {
        fail(code);
      }
    });
    return deepFreeze({
      contractVersion: REGISTRY_START_VERSION,
      profileId: identifier(value.profileId, 1, 128, code),
      requestedConcurrency: requestedConcurrency,
      slots: Object.freeze(slots),
    });
  }

  function slotKey(value, code) {
    var result = canonicalText(value, 1, 200, code);
    if (SHARED_DETAIL_ROLES.some(function (role) {
      return result === 'shared:detail:' + role;
    })) return result;
    if (!result.startsWith('sku:') || !result.endsWith(':hero')) fail(code);
    var skuKey = canonicalText(result.slice(4, -5), 1, 500, code);
    if (result !== 'sku:' + skuKey + ':hero') fail(code);
    return result;
  }

  function chargeAcknowledgement(value) {
    var code = 'SS_ERP_BYOK_BATCH_RUNTIME_INPUT_INVALID';
    if (!exactKeys(value, ['warningVersion', 'confirmed'])
      || value.warningVersion !== EXTERNAL_CHARGE_WARNING_VERSION
      || value.confirmed !== true) fail(code);
    return Object.freeze({
      warningVersion: EXTERNAL_CHARGE_WARNING_VERSION,
      confirmed: true,
    });
  }

  function unknownRecovery(value) {
    var code = 'SS_ERP_BYOK_BATCH_RUNTIME_INPUT_INVALID';
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
    var code = 'SS_ERP_BYOK_BATCH_RUNTIME_INPUT_INVALID';
    if (!isRecord(value) || value.contractVersion !== COMMAND_VERSION
      || !COMMAND_KINDS.includes(value.kind)) fail(code);
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
      var charge = exactKeys(value, reviewKeys.concat(['externalChargeAcknowledgement']));
      var unknown = exactKeys(value, reviewKeys.concat(['unknownOutcomeRecovery']));
      if (!charge && !unknown) fail(code);
      var retry = slotCommand(value, base, code);
      if (charge) retry.externalChargeAcknowledgement = chargeAcknowledgement(
        value.externalChargeAcknowledgement,
      );
      else retry.unknownOutcomeRecovery = unknownRecovery(value.unknownOutcomeRecovery);
      return deepFreeze(retry);
    }
    if (!exactKeys(value, reviewKeys)) fail(code);
    return Object.freeze({
      ...slotCommand(value, base, code),
      kind: 'RESOLVE_UNKNOWN_ATTEMPT',
    });
  }

  function registryCommand(value) {
    var command = normalizeCommand(value);
    var kind = {
      PAUSE_AFTER_CURRENT: 'PAUSE',
      CONTINUE: 'CONTINUE',
      CANCEL_QUEUED: 'CANCEL_QUEUED',
      KEEP_ATTEMPT: 'KEEP',
      REJECT_ATTEMPT: 'REJECT',
      REGENERATE_SLOT: 'REGENERATE',
      RETRY_ATTEMPT: 'RETRY',
      RESOLVE_UNKNOWN_ATTEMPT: 'RESOLVE_UNKNOWN',
    }[command.kind];
    if (!kind) fail('SS_ERP_BYOK_BATCH_RUNTIME_INPUT_INVALID');
    var result = {
      contractVersion: COMMAND_VERSION,
      kind: kind,
      commandId: command.commandId,
      expectedWorkspaceRevision: command.expectedWorkspaceRevision,
      expectedRuntimeRevision: command.expectedRuntimeRevision,
    };
    if (!['PAUSE', 'CONTINUE'].includes(kind)) {
      result.slotKey = command.slotKey;
      result.expectedSlotRevision = command.expectedSlotRevision;
    }
    if (['CANCEL_QUEUED', 'KEEP', 'REJECT', 'RETRY', 'RESOLVE_UNKNOWN'].includes(kind)) {
      result.attemptId = command.attemptId;
    }
    if (kind === 'REGENERATE') {
      result.chargeAcknowledgement = command.externalChargeAcknowledgement;
    }
    if (kind === 'RETRY') {
      if (command.externalChargeAcknowledgement) {
        result.chargeAcknowledgement = command.externalChargeAcknowledgement;
      } else result.unknownOutcomeRecovery = command.unknownOutcomeRecovery;
    }
    return deepFreeze(result);
  }

  function normalizeIngest(value) {
    var code = 'SS_ERP_BYOK_BATCH_RUNTIME_INPUT_INVALID';
    if (!exactKeys(value, ['contractVersion', 'idempotencyKey'])
      || value.contractVersion !== INGEST_VERSION) fail(code);
    return Object.freeze({
      contractVersion: INGEST_VERSION,
      idempotencyKey: identifier(value.idempotencyKey, 16, 200, code),
    });
  }

  function safeFailure(error) {
    var candidate = error && typeof error === 'object' ? String(error.code || '') : '';
    var candidateOutcome = error && typeof error === 'object' ? error.outcome : null;
    var outcome = ['FAILED_FINAL', 'FAILED_RETRYABLE', 'UNKNOWN_OUTCOME'].includes(
      candidateOutcome,
    ) ? candidateOutcome : 'FAILED_FINAL';
    return deepFreeze({
      ok: false,
      errorCode: /^[A-Z][A-Z0-9_]{0,119}$/u.test(candidate) && !secretString(candidate)
        ? candidate
        : 'SS_ERP_BYOK_BATCH_RUNTIME_OPERATION_FAILED',
      error: 'BYOK batch workbench operation failed',
      outcome: outcome,
      automaticRetryAllowed: false,
    });
  }

  function success(value) {
    return deepFreeze({ ok: true, data: publicOutput(value) });
  }

  function guarded(operation) {
    return async function guardedHandler(context) {
      try {
        return success(await operation(context || {}));
      } catch (error) {
        return safeFailure(error);
      }
    };
  }

  function createDispatcher(options) {
    var code = 'SS_ERP_BYOK_BATCH_RUNTIME_DEPENDENCY_UNAVAILABLE';
    if (!exactKeys(options, ['messageTypes', 'registry'])
      || !exactKeys(options.messageTypes, MESSAGE_TYPE_NAMES)
      || !options.registry || REGISTRY_METHODS.some(function (name) {
        return typeof options.registry[name] !== 'function';
      })) fail(code);
    var messageTypes = options.messageTypes;
    var registry = options.registry;
    var values = MESSAGE_TYPE_NAMES.map(function (name) {
      return canonicalText(messageTypes[name], 1, 200, code);
    });
    if (new Set(values).size !== values.length) fail(code);

    function owner(context) {
      return senderOwner(context && context.sender);
    }

    var handlers = {};
    handlers[messageTypes.BATCH_STATE] = guarded(async function (context) {
      requestPayload(context, ['contractVersion']);
      return registry.state(owner(context));
    });
    handlers[messageTypes.BATCH_START] = guarded(async function (context) {
      var input = requestPayload(context, ['contractVersion', 'startRequest']);
      return registry.start(owner(context), normalizeUserStart(input.startRequest));
    });
    handlers[messageTypes.BATCH_COMMAND] = guarded(async function (context) {
      var input = requestPayload(context, ['contractVersion', 'command']);
      return registry.command(owner(context), registryCommand(input.command));
    });
    handlers[messageTypes.BATCH_PREVIEW] = guarded(async function (context) {
      var input = requestPayload(context, ['contractVersion', 'slotKey', 'attemptId']);
      return registry.openPreview(owner(context), deepFreeze({
        slotKey: slotKey(input.slotKey, 'SS_ERP_BYOK_BATCH_RUNTIME_INPUT_INVALID'),
        attemptId: identifier(
          input.attemptId, 1, 200, 'SS_ERP_BYOK_BATCH_RUNTIME_INPUT_INVALID',
        ),
      }));
    });
    handlers[messageTypes.BATCH_INGEST] = guarded(async function (context) {
      var input = requestPayload(context, ['contractVersion', 'ingestCommand']);
      return registry.ingest(owner(context), normalizeIngest(input.ingestCommand));
    });
    handlers[messageTypes.BATCH_RECOVER] = guarded(async function (context) {
      var input = requestPayload(context, ['contractVersion', 'ingestCommand']);
      return registry.recover(owner(context), normalizeIngest(input.ingestCommand));
    });
    handlers[messageTypes.BATCH_CLEAR] = guarded(async function (context) {
      requestPayload(context, ['contractVersion']);
      await registry.clear(owner(context));
      return Object.freeze({ cleared: true });
    });
    Object.freeze(handlers);

    async function dispatchAuthorized(messageType, context) {
      var handler = Object.prototype.hasOwnProperty.call(handlers, messageType)
        ? handlers[messageType]
        : null;
      return handler
        ? handler(context)
        : safeFailure(runtimeError('SS_ERP_BYOK_BATCH_RUNTIME_HANDLER_UNAVAILABLE'));
    }

    return Object.freeze({
      handlers: handlers,
      dispatchAuthorized: dispatchAuthorized,
    });
  }

  global.SS_ERP_BYOK_WORKBENCH_BATCH_RUNTIME_HANDLER = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    REQUEST_VERSION: REQUEST_VERSION,
    COMMAND_VERSION: COMMAND_VERSION,
    MESSAGE_TYPE_NAMES: MESSAGE_TYPE_NAMES,
    COMMAND_KINDS: COMMAND_KINDS,
    createDispatcher: createDispatcher,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
