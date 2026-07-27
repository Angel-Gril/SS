(function exposeByokWorkbenchBatchRegistry(global) {
  'use strict';

  var CONTRACT_VERSION = 'extension-byok-workbench-batch-registry/v1';
  var START_REQUEST_VERSION = 'extension-byok-workbench-batch-start-request/v1';
  var COMMAND_VERSION = 'extension-byok-workbench-batch-runtime-command/v1';
  var INGEST_VERSION = 'extension-byok-workbench-batch-ingest/v1';
  var COORDINATOR_VERSION = 'extension-byok-workbench-batch-coordinator/v1';
  var COORDINATOR_START_VERSION = 'extension-byok-workbench-batch-start/v1';
  var COORDINATOR_BINDING_VERSION = 'extension-byok-workbench-batch-binding/v1';
  var READINESS_BINDING_VERSION = 'extension-byok-readiness-binding/v2';
  var PREPARED_REQUEST_VERSION = 'extension-byok-prepared-provider-request/v1';
  var BATCH_RECOVERY_VERSION = 'extension-byok-workbench-batch-recovery/v1';
  var SUCCESSOR_RECOVERY_VERSION = 'extension-byok-workbench-successor-recovery/v1';
  var LIFECYCLE_VERSION = 'extension-byok-device-session-lifecycle/v1';
  var EXTERNAL_CHARGE_WARNING_VERSION = 'external-provider-charge/v1';
  var DUPLICATE_CHARGE_WARNING_VERSION = 'external-provider-duplicate-charge/v1';
  var MAX_SLOTS = 4;
  var SERIAL_REQUESTED_CONCURRENCY = 1;
  var OPERATIONS = ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'];
  var SHARED_DETAIL_ROLES = ['SCENE', 'DETAIL', 'SPEC', 'PACKAGING'];
  var BATCH_RECOVERY_KEYS = [
    'contractVersion', 'phase', 'reservationIdempotencyKey', 'executionBatchId',
    'context', 'slots', 'successorRecovery',
  ];
  var LEGACY_BATCH_RECOVERY_KEYS = BATCH_RECOVERY_KEYS.filter(function (key) {
    return key !== 'successorRecovery';
  });
  var SUCCESSOR_RECOVERY_KEYS = [
    'contractVersion', 'state', 'itemIndex', 'assignmentOrdinal', 'predecessorIntentId',
    'predecessorGeneration', 'requestMode', 'providerIdempotencyKey',
    'providerRequestHash',
  ];
  var REQUIRED_COORDINATOR_METHODS = [
    'startBatch', 'getProjection', 'pause', 'continue', 'cancelQueued', 'keepAttempt',
    'rejectAttempt', 'regenerateSlot', 'retryAttempt', 'resolveUnknownAttempt',
    'ingestSelectedBatch', 'recoverIngest', 'dispose',
  ];
  var PROTECTED_PROVIDER_INPUT_KEYS = new Set([
    'profileId', 'operation', 'idempotencyKey', 'readinessBinding',
    'prompt', 'negativePrompt', 'size',
  ]);

  function registryError(code, outcome) {
    var error = new Error(code);
    error.name = 'ExtensionByokWorkbenchBatchRegistryError';
    error.code = code;
    error.outcome = outcome || 'FAILED_FINAL';
    error.automaticRetryAllowed = false;
    return error;
  }

  function fail(code, outcome) {
    throw registryError(code, outcome);
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

  function text(value, minimum, maximum, code) {
    if (typeof value !== 'string' || value.length < minimum || value.length > maximum
      || value !== value.normalize('NFKC').trim()
      || hasControlCharacter(value)) fail(code);
    return value;
  }

  function identifier(value, minimum, maximum, code) {
    var result = text(value, minimum, maximum, code);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u.test(result)
      || /^(?:sk-[a-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|LTAI[a-zA-Z0-9]{12,}|AKID[a-zA-Z0-9]{12,})$/iu
        .test(result)
      || /^eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/u.test(result)) fail(code);
    return result;
  }

  function sha256(value, code) {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) fail(code);
    return value;
  }

  function positiveInteger(value, code) {
    if (!Number.isSafeInteger(value) || value < 1) fail(code);
    return value;
  }

  function ordinal(value, code) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 499) fail(code);
    return value;
  }

  function nonnegativeInteger(value, code) {
    if (!Number.isSafeInteger(value) || value < 0) fail(code);
    return value;
  }

  function pageText(value, minimum, maximum, code) {
    var result = text(value, minimum, maximum, code);
    if (/(?:https?|ftp|file|blob|data):/iu.test(result)) fail(code);
    return result;
  }

  function nullableIdentifier(value, maximum, code) {
    return value === null ? null : identifier(value, 1, maximum, code);
  }

  function nullablePageText(value, maximum, code) {
    return value === null ? null : pageText(value, 1, maximum, code);
  }

  function nullableBoolean(value, code) {
    if (value !== null && typeof value !== 'boolean') fail(code);
    return value;
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
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

  function normalizeOwner(value) {
    var code = 'SS_ERP_BYOK_BATCH_REGISTRY_SENDER_INVALID';
    if (!exactKeys(value, ['tabId', 'documentId'])
      || !Number.isSafeInteger(value.tabId) || value.tabId < 0) fail(code);
    return Object.freeze({
      tabId: value.tabId,
      documentId: text(value.documentId, 1, 200, code),
    });
  }

  function ownerKey(value) {
    return String(value.tabId) + '\u0000' + value.documentId;
  }

  function sessionSender(value) {
    return { tabId: value.tabId, documentId: value.documentId, frameId: 0 };
  }

  function supportedSlot(skuKey, slotKey) {
    return slotKey === 'sku:' + skuKey + ':hero'
      || SHARED_DETAIL_ROLES.some(function (role) {
        return slotKey === 'shared:detail:' + role;
      });
  }

  function normalizePageSlot(value) {
    var code = 'SS_ERP_BYOK_BATCH_REGISTRY_INPUT_INVALID';
    if (!exactKeys(value, [
      'skuKey', 'slotKey', 'operation', 'providerIdempotencyKey', 'intentHash',
      'prompt', 'negativePrompt', 'size',
    ]) || !OPERATIONS.includes(value.operation)) fail(code);
    var skuKey = text(value.skuKey, 1, 500, code);
    var slotKey = identifier(value.slotKey, 1, 200, code);
    if (!supportedSlot(skuKey, slotKey)) fail(code);
    return Object.freeze({
      skuKey: skuKey,
      slotKey: slotKey,
      operation: value.operation,
      idempotencyKey: identifier(value.providerIdempotencyKey, 16, 200, code),
      intentHash: sha256(value.intentHash, code),
      prompt: text(value.prompt, 1, 8000, code),
      negativePrompt: value.negativePrompt === null
        ? null : text(value.negativePrompt, 1, 8000, code),
      size: text(value.size, 3, 64, code),
    });
  }

  function normalizeStart(value) {
    var code = 'SS_ERP_BYOK_BATCH_REGISTRY_INPUT_INVALID';
    if (!exactKeys(value, ['contractVersion', 'profileId', 'requestedConcurrency', 'slots'])
      || value.contractVersion !== START_REQUEST_VERSION
      || value.requestedConcurrency !== SERIAL_REQUESTED_CONCURRENCY
      || !Array.isArray(value.slots) || value.slots.length < 1
      || value.slots.length > MAX_SLOTS) fail(code);
    var slots = value.slots.map(normalizePageSlot);
    if (new Set(slots.map(function (slot) { return slot.slotKey; })).size !== slots.length
      || new Set(slots.map(function (slot) { return slot.idempotencyKey; })).size !== slots.length) {
      fail(code);
    }
    return Object.freeze({
      profileId: identifier(value.profileId, 1, 128, code),
      requestedConcurrency: value.requestedConcurrency,
      slots: Object.freeze(slots),
    });
  }

  function normalizeIngest(value) {
    var code = 'SS_ERP_BYOK_BATCH_REGISTRY_INPUT_INVALID';
    if (!exactKeys(value, ['contractVersion', 'idempotencyKey'])
      || value.contractVersion !== INGEST_VERSION) fail(code);
    return Object.freeze({
      contractVersion: INGEST_VERSION,
      idempotencyKey: identifier(value.idempotencyKey, 16, 200, code),
    });
  }

  function normalizeCharge(value) {
    var code = 'SS_ERP_BYOK_BATCH_REGISTRY_INPUT_INVALID';
    if (!exactKeys(value, ['warningVersion', 'confirmed'])
      || value.warningVersion !== EXTERNAL_CHARGE_WARNING_VERSION
      || value.confirmed !== true) fail(code);
    return Object.freeze({ warningVersion: value.warningVersion, confirmed: true });
  }

  function normalizeUnknownRecovery(value) {
    var code = 'SS_ERP_BYOK_BATCH_REGISTRY_INPUT_INVALID';
    if (!exactKeys(value, ['strategy', 'warningVersion', 'confirmed'])
      || value.strategy !== 'DUPLICATE_CHARGE_CONFIRMATION'
      || value.warningVersion !== DUPLICATE_CHARGE_WARNING_VERSION
      || value.confirmed !== true) fail(code);
    return Object.freeze({
      strategy: value.strategy,
      warningVersion: value.warningVersion,
      confirmed: true,
    });
  }

  function normalizeCommand(value) {
    var code = 'SS_ERP_BYOK_BATCH_REGISTRY_INPUT_INVALID';
    if (!isRecord(value) || value.contractVersion !== COMMAND_VERSION
      || typeof value.kind !== 'string') fail(code);
    var baseKeys = [
      'contractVersion', 'kind', 'commandId', 'expectedWorkspaceRevision',
      'expectedRuntimeRevision',
    ];
    var base = {
      kind: value.kind,
      commandId: identifier(value.commandId, 1, 200, code),
      expectedWorkspaceRevision: positiveInteger(value.expectedWorkspaceRevision, code),
      expectedRuntimeRevision: positiveInteger(value.expectedRuntimeRevision, code),
    };
    if (['PAUSE', 'CONTINUE'].includes(value.kind)) {
      if (!exactKeys(value, baseKeys)) fail(code);
      return Object.freeze(base);
    }
    if (value.kind === 'CANCEL_QUEUED') {
      if (!exactKeys(value, baseKeys.concat([
        'slotKey', 'attemptId', 'expectedSlotRevision',
      ]))) fail(code);
      return Object.freeze({
        ...base,
        slotKey: identifier(value.slotKey, 1, 200, code),
        attemptId: identifier(value.attemptId, 1, 200, code),
        expectedSlotRevision: positiveInteger(value.expectedSlotRevision, code),
      });
    }
    if (['KEEP', 'REJECT'].includes(value.kind)) {
      if (!exactKeys(value, baseKeys.concat([
        'slotKey', 'attemptId', 'expectedSlotRevision',
      ]))) fail(code);
      return Object.freeze({
        ...base,
        slotKey: identifier(value.slotKey, 1, 200, code),
        attemptId: identifier(value.attemptId, 1, 200, code),
        expectedSlotRevision: positiveInteger(value.expectedSlotRevision, code),
      });
    }
    if (value.kind === 'REGENERATE') {
      if (!exactKeys(value, baseKeys.concat([
        'slotKey', 'expectedSlotRevision', 'chargeAcknowledgement',
      ]))) fail(code);
      return Object.freeze({
        ...base,
        slotKey: identifier(value.slotKey, 1, 200, code),
        expectedSlotRevision: positiveInteger(value.expectedSlotRevision, code),
        chargeAcknowledgement: normalizeCharge(value.chargeAcknowledgement),
      });
    }
    if (value.kind === 'RETRY') {
      var charge = exactKeys(value, baseKeys.concat([
        'slotKey', 'attemptId', 'expectedSlotRevision', 'chargeAcknowledgement',
      ]));
      var unknown = exactKeys(value, baseKeys.concat([
        'slotKey', 'attemptId', 'expectedSlotRevision', 'unknownOutcomeRecovery',
      ]));
      if (!charge && !unknown) fail(code);
      var retry = {
        ...base,
        slotKey: identifier(value.slotKey, 1, 200, code),
        attemptId: identifier(value.attemptId, 1, 200, code),
        expectedSlotRevision: positiveInteger(value.expectedSlotRevision, code),
      };
      if (charge) retry.chargeAcknowledgement = normalizeCharge(value.chargeAcknowledgement);
      else retry.unknownOutcomeRecovery = normalizeUnknownRecovery(value.unknownOutcomeRecovery);
      return Object.freeze(retry);
    }
    if (value.kind === 'RESOLVE_UNKNOWN') {
      if (!exactKeys(value, baseKeys.concat([
        'attemptId', 'slotKey', 'expectedSlotRevision',
      ]))) fail(code);
      return Object.freeze({
        ...base,
        attemptId: identifier(value.attemptId, 1, 200, code),
        slotKey: identifier(value.slotKey, 1, 200, code),
        expectedSlotRevision: positiveInteger(value.expectedSlotRevision, code),
      });
    }
    fail(code);
  }

  function normalizePersistedSuccessorRecovery(value, slots, code) {
    if (value === null || value === undefined) return null;
    if (!exactKeys(value, SUCCESSOR_RECOVERY_KEYS)
      || value.contractVersion !== SUCCESSOR_RECOVERY_VERSION
      || !['CLAIMING', 'HANDOFF_STARTED'].includes(value.state)
      || !Number.isSafeInteger(value.itemIndex) || value.itemIndex < 0
      || value.itemIndex >= slots.length
      || !Number.isSafeInteger(value.predecessorGeneration)
      || value.predecessorGeneration < 1 || value.predecessorGeneration > 499) fail(code);
    var slot = slots[value.itemIndex];
    var requestMode = text(value.requestMode, 1, 16, code);
    if (requestMode !== (slot.operation === 'TEXT_TO_IMAGE' ? 'json' : 'multipart')) fail(code);
    return Object.freeze({
      contractVersion: SUCCESSOR_RECOVERY_VERSION,
      state: value.state,
      itemIndex: value.itemIndex,
      assignmentOrdinal: ordinal(value.assignmentOrdinal, code),
      predecessorIntentId: identifier(value.predecessorIntentId, 1, 200, code),
      predecessorGeneration: value.predecessorGeneration,
      requestMode: requestMode,
      providerIdempotencyKey: identifier(value.providerIdempotencyKey, 16, 200, code),
      providerRequestHash: sha256(value.providerRequestHash, code),
    });
  }

  function normalizeSession(value, owner) {
    var code = 'SS_ERP_BYOK_BATCH_REGISTRY_SESSION_INVALID';
    var context = value && value.context;
    if (!isRecord(value) || !isRecord(context)
      || value.workbenchTabId !== owner.tabId
      || value.workbenchDocumentId !== owner.documentId
      || context.contractVersion !== 'extension-byok-workbench-launch-context/v1'
      || context.assignmentMode !== 'APPEND'
      || !['1688', 'pdd', 'taobao', 'tmall'].includes(context.sourcePlatform)) fail(code);
    var normalizedContext = Object.freeze({
        sourcePlatform: text(context.sourcePlatform, 1, 16, code),
        sourceProductId: text(context.sourceProductId, 1, 200, code),
        sourceCaptureSnapshotId: text(context.sourceCaptureSnapshotId, 1, 200, code),
        supplyGoodsId: text(context.supplyGoodsId, 1, 200, code),
        shopId: text(context.shopId, 1, 200, code),
        workflowId: text(context.workflowId, 1, 200, code),
        draftRevision: positiveInteger(context.draftRevision, code),
        draftVersion: positiveInteger(context.draftVersion, code),
        skuKey: text(context.skuKey, 1, 500, code),
      });
    var operation = value.operation;
    if (operation !== null) {
      if (!exactKeys(operation, ['idempotencyKey', 'state', 'recovery'])
        || operation.state !== 'OUTCOME_UNRESOLVED') fail(code);
      var operationKey = identifier(operation.idempotencyKey, 1, 128, code);
      var recovery = operation.recovery;
      if (recovery !== null) {
        var legacyRecovery = exactKeys(recovery, LEGACY_BATCH_RECOVERY_KEYS);
        if (!legacyRecovery && !exactKeys(recovery, BATCH_RECOVERY_KEYS)
          || recovery.contractVersion !== BATCH_RECOVERY_VERSION
          || !['PREPARING', 'RESERVED', 'DISPATCHING'].includes(recovery.phase)
          || !exactKeys(recovery.context, [
            'shopId', 'workflowId', 'draftRevision', 'draftVersion',
          ]) || !Array.isArray(recovery.slots)
          || recovery.slots.length < 1 || recovery.slots.length > MAX_SLOTS
          || recovery.context.shopId !== normalizedContext.shopId
          || recovery.context.workflowId !== normalizedContext.workflowId
          || recovery.context.draftRevision !== normalizedContext.draftRevision
          || recovery.context.draftVersion !== normalizedContext.draftVersion) fail(code);
        var slots = recovery.slots.map(function (slot) {
          if (!exactKeys(slot, ['skuKey', 'slotKey', 'operation'])
            || !OPERATIONS.includes(slot.operation)) fail(code);
          var skuKey = text(slot.skuKey, 1, 500, code);
          var slotKey = identifier(slot.slotKey, 1, 200, code);
          if (!supportedSlot(skuKey, slotKey)) fail(code);
          return Object.freeze({ skuKey: skuKey, slotKey: slotKey, operation: slot.operation });
        });
        if (new Set(slots.map(function (slot) { return slot.slotKey; })).size !== slots.length) {
          fail(code);
        }
        var executionBatchId = recovery.executionBatchId === null
          ? null : identifier(recovery.executionBatchId, 1, 200, code);
        var reservationIdempotencyKey = identifier(
          recovery.reservationIdempotencyKey, 16, 200, code,
        );
        if (!/^byok-reservation:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
          .test(reservationIdempotencyKey)) fail(code);
        if ((recovery.phase === 'PREPARING') !== (executionBatchId === null)) fail(code);
        var successorRecovery = normalizePersistedSuccessorRecovery(
          legacyRecovery ? null : recovery.successorRecovery, slots, code,
        );
        if (successorRecovery !== null && recovery.phase !== 'DISPATCHING') fail(code);
        recovery = Object.freeze({
          contractVersion: BATCH_RECOVERY_VERSION,
          phase: recovery.phase,
          reservationIdempotencyKey: reservationIdempotencyKey,
          executionBatchId: executionBatchId,
          context: Object.freeze({ ...recovery.context }),
          slots: Object.freeze(slots),
          successorRecovery: successorRecovery,
        });
      }
      operation = Object.freeze({
        idempotencyKey: operationKey,
        state: 'OUTCOME_UNRESOLVED',
        recovery: recovery,
      });
    }
    return {
      raw: value,
      context: normalizedContext,
      operation: operation,
    };
  }

  function launchRequest(context) {
    return {
      sourcePlatform: context.sourcePlatform,
      sourceProductId: context.sourceProductId,
      sourceCaptureSnapshotId: context.sourceCaptureSnapshotId,
      supplyGoodsId: context.supplyGoodsId,
      shopId: context.shopId,
      workflowId: context.workflowId,
      draftRevision: context.draftRevision,
      draftVersion: context.draftVersion,
    };
  }

  function normalizeLaunch(value, session, slots) {
    var code = 'SS_ERP_BYOK_BATCH_REGISTRY_LAUNCH_INVALID';
    var request = launchRequest(session.context);
    if (!isRecord(value) || value.contractVersion
      !== 'extension-byok-workbench-batch-launch-context/v1'
      || value.anchorSkuKey !== session.context.skuKey
      || !Number.isSafeInteger(value.firstAssignmentOrdinal)
      || value.firstAssignmentOrdinal < 0 || value.firstAssignmentOrdinal > 499
      || !Array.isArray(value.targets) || value.targets.length < 1
      || Object.keys(request).some(function (key) { return value[key] !== request[key]; })) fail(code);
    var targets = value.targets.map(function (target) {
      if (!exactKeys(target, ['skuKey', 'slotKey'])) fail(code);
      return {
        skuKey: text(target.skuKey, 1, 500, code),
        slotKey: identifier(target.slotKey, 1, 200, code),
      };
    });
    var priorTarget = -1;
    slots.forEach(function (slot) {
      var targetIndex = targets.findIndex(function (target) {
        return target.skuKey === slot.skuKey && target.slotKey === slot.slotKey;
      });
      if (targetIndex <= priorTarget) fail(code);
      priorTarget = targetIndex;
    });
    if (value.firstAssignmentOrdinal + slots.length > 500) fail(code);
    return Object.freeze({
      context: session.context,
      anchorSkuKey: value.anchorSkuKey,
      firstAssignmentOrdinal: value.firstAssignmentOrdinal,
      targets: Object.freeze(targets),
    });
  }

  function expectedReadinessRequest(start, launch, slot, assignmentOrdinal) {
    return {
      profileId: start.profileId,
      shopId: launch.context.shopId,
      workflowId: launch.context.workflowId,
      draftRevision: launch.context.draftRevision,
      draftVersion: launch.context.draftVersion,
      sourcePlatform: launch.context.sourcePlatform,
      sourceProductId: launch.context.sourceProductId,
      sourceCaptureSnapshotId: launch.context.sourceCaptureSnapshotId,
      supplyGoodsId: launch.context.supplyGoodsId,
      skuKey: slot.skuKey,
      slotKey: slot.slotKey,
      assignmentMode: 'APPEND',
      assignmentOrdinal: assignmentOrdinal,
      operation: slot.operation,
    };
  }

  function normalizeReadiness(value, expected) {
    var code = 'SS_ERP_BYOK_BATCH_REGISTRY_READINESS_INVALID';
    var binding = value && value.readinessBinding;
    var concurrency = value && value.concurrencyAuthority;
    if (!isRecord(value) || !isRecord(binding) || !isRecord(concurrency)
      || binding.contractVersion !== READINESS_BINDING_VERSION
      || binding.shopId !== expected.shopId || binding.workflowId !== expected.workflowId
      || binding.draftRevision !== expected.draftRevision
      || binding.draftVersion !== expected.draftVersion
      || binding.sourcePlatform !== expected.sourcePlatform
      || binding.sourceProductId !== expected.sourceProductId
      || binding.sourceCaptureSnapshotId !== expected.sourceCaptureSnapshotId
      || binding.supplyGoodsId !== expected.supplyGoodsId
      || binding.skuKey !== expected.skuKey || binding.slotKey !== expected.slotKey
      || binding.assignmentMode !== 'APPEND'
      || binding.assignmentOrdinal !== expected.assignmentOrdinal
      || binding.operation !== expected.operation
      || concurrency.policyRevision !== binding.policyRevision
      || !Number.isSafeInteger(concurrency.maxConcurrency)
      || concurrency.maxConcurrency < 1 || concurrency.maxConcurrency > 4
      || typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt))) {
      fail(code);
    }
    text(binding.ownerUserId, 1, 200, code);
    text(binding.deviceSessionId, 1, 200, code);
    text(binding.providerOrigin, 9, 300, code);
    text(binding.model, 1, 200, code);
    text(binding.policyRevision, 1, 200, code);
    return Object.freeze({
      binding: deepFreeze(clone(binding)),
      expiresAt: value.expiresAt,
      maxConcurrency: concurrency.maxConcurrency,
    });
  }

  function sameReadinessAuthority(first, current) {
    return first.binding.ownerUserId === current.binding.ownerUserId
      && first.binding.deviceSessionId === current.binding.deviceSessionId
      && first.binding.providerOrigin === current.binding.providerOrigin
      && first.binding.model === current.binding.model
      && first.binding.policyRevision === current.binding.policyRevision
      && first.maxConcurrency === current.maxConcurrency;
  }

  function normalizePrepared(value, slot) {
    var code = 'SS_ERP_BYOK_BATCH_REGISTRY_PREPARE_INVALID';
    if (!exactKeys(value, [
      'contractVersion', 'preparedRequestHandle', 'operation', 'requestMode',
      'providerIdempotencyKey', 'providerRequestHash',
    ]) || value.contractVersion !== PREPARED_REQUEST_VERSION
      || value.operation !== slot.operation
      || value.requestMode !== (slot.operation === 'TEXT_TO_IMAGE' ? 'json' : 'multipart')
      || value.providerIdempotencyKey !== slot.idempotencyKey) fail(code);
    return Object.freeze({
      handle: text(value.preparedRequestHandle, 1, 200, code),
      operation: value.operation,
      requestMode: value.requestMode,
      providerIdempotencyKey: value.providerIdempotencyKey,
      providerRequestHash: sha256(value.providerRequestHash, code),
    });
  }

  function emptyProjection() {
    return deepFreeze({
      contractVersion: COORDINATOR_VERSION,
      executionMode: 'BYOK',
      revision: 0,
      scheduler: null,
      billing: { erpGenerationChargeCents: 0 },
      slots: [],
      ingest: null,
    });
  }

  function recoveryDescriptor(
    session,
    slots,
    reservationIdempotencyKey,
    phase,
    executionBatchId,
    successorRecovery
  ) {
    return deepFreeze({
      contractVersion: BATCH_RECOVERY_VERSION,
      phase: phase,
      reservationIdempotencyKey: reservationIdempotencyKey,
      executionBatchId: executionBatchId,
      context: {
        shopId: session.context.shopId,
        workflowId: session.context.workflowId,
        draftRevision: session.context.draftRevision,
        draftVersion: session.context.draftVersion,
      },
      slots: slots.map(function (slot) {
        return { skuKey: slot.skuKey, slotKey: slot.slotKey, operation: slot.operation };
      }),
      successorRecovery: successorRecovery || null,
    });
  }

  function successorRecoveryDescriptor(record, predecessorRecord, state) {
    if (!record || !record.prepared || !record.readiness || !record.readiness.binding
      || !predecessorRecord || !predecessorRecord.intent
      || !Number.isSafeInteger(predecessorRecord.serverAttemptIndex)
      || predecessorRecord.serverAttemptIndex < 0 || predecessorRecord.serverAttemptIndex >= 499) {
      fail('SS_ERP_BYOK_BATCH_REGISTRY_SUCCESSOR_RECOVERY_INVALID');
    }
    return deepFreeze({
      contractVersion: SUCCESSOR_RECOVERY_VERSION,
      state: state,
      itemIndex: record.itemIndex,
      assignmentOrdinal: record.readiness.binding.assignmentOrdinal,
      predecessorIntentId: predecessorRecord.intent.intentId,
      predecessorGeneration: predecessorRecord.serverAttemptIndex + 1,
      requestMode: record.prepared.requestMode,
      providerIdempotencyKey: record.prepared.providerIdempotencyKey,
      providerRequestHash: record.prepared.providerRequestHash,
    });
  }

  function entryRecoveryDescriptor(entry, successorRecovery) {
    return recoveryDescriptor(
      entry.session,
      entry.pageSlots,
      entry.reservationIdempotencyKey,
      'DISPATCHING',
      entry.executionBatchId,
      successorRecovery,
    );
  }

  async function persistEntrySuccessorRecovery(entry, successorRecovery, sessionManager) {
    var updated = normalizeSession(
      await sessionManager.updateOperationRecovery(
        sessionSender(entry.owner),
        entry.operationKey,
        entryRecoveryDescriptor(entry, successorRecovery),
      ),
      entry.owner,
    );
    entry.session = updated;
    return updated.operation.recovery.successorRecovery;
  }

  function successorStatusProof(session, recovery, status, successorRecovery) {
    if (!successorRecovery || successorRecovery.state !== 'CLAIMING'
      || status.status !== 'OPEN'
      || !persistedStatusMatches(session, recovery, status)) return 'UNPROVED';
    var item = status.items[successorRecovery.itemIndex];
    var slot = recovery.slots[successorRecovery.itemIndex];
    if (!item || !slot || item.itemIndex !== successorRecovery.itemIndex
      || item.skuKey !== slot.skuKey || item.slotKey !== slot.slotKey
      || item.assignmentOrdinal !== successorRecovery.assignmentOrdinal) return 'UNPROVED';
    var intent = item.intent;
    if (intent.intentId === successorRecovery.predecessorIntentId
      && intent.attemptIndex === successorRecovery.predecessorGeneration - 1) {
      return 'PREDECESSOR';
    }
    if (intent.intentId !== successorRecovery.predecessorIntentId
      && intent.attemptIndex === successorRecovery.predecessorGeneration
      && intent.providerIdempotencyKey === successorRecovery.providerIdempotencyKey
      && intent.providerRequestHash === successorRecovery.providerRequestHash
      && ['PENDING', 'FAILED_FINAL'].includes(intent.outcome)) {
      return intent.outcome === 'PENDING' ? 'SUCCESSOR_PENDING' : 'SUCCESSOR_TERMINAL';
    }
    return 'UNPROVED';
  }

  function adoptedSuccessorResult(status, successorRecovery) {
    return Object.freeze({
      status: 'OPEN',
      replayed: true,
      context: status.context,
      item: status.items[successorRecovery.itemIndex],
    });
  }

  function pageAttempt(value) {
    var code = 'SS_ERP_BYOK_BATCH_REGISTRY_PROJECTION_INVALID';
    if (!isRecord(value) || !OPERATIONS.includes(value.operation)
      || typeof value.externalChargePossible !== 'boolean'
      || typeof value.unknownOutcomeSuperseded !== 'boolean') fail(code);
    return {
      attemptId: identifier(value.attemptId, 1, 200, code),
      generation: positiveInteger(value.generation, code),
      operation: value.operation,
      state: pageText(value.state, 1, 100, code),
      resultId: nullableIdentifier(value.resultId, 200, code),
      errorCode: nullableIdentifier(value.errorCode, 120, code),
      retryOfAttemptId: nullableIdentifier(value.retryOfAttemptId, 200, code),
      externalChargePossible: value.externalChargePossible,
      retryRisk: nullablePageText(value.retryRisk, 100, code),
      chargeWarningVersion: nullablePageText(value.chargeWarningVersion, 100, code),
      automaticRetryAllowed: nullableBoolean(value.automaticRetryAllowed, code),
      recoveryRequirement: nullablePageText(value.recoveryRequirement, 200, code),
      unknownOutcomeSuperseded: value.unknownOutcomeSuperseded,
      reviewState: pageText(value.reviewState, 1, 100, code),
    };
  }

  function pageSlot(value) {
    var code = 'SS_ERP_BYOK_BATCH_REGISTRY_PROJECTION_INVALID';
    if (!isRecord(value) || !Array.isArray(value.attempts)) {
      fail(code);
    }
    var skuKey = pageText(value.skuKey, 1, 500, code);
    var slotKey = identifier(value.slotKey, 1, 200, code);
    if (!supportedSlot(skuKey, slotKey) || !OPERATIONS.includes(value.operation)) fail(code);
    return {
      slotKey: slotKey,
      skuKey: skuKey,
      assignmentOrdinal: ordinal(value.assignmentOrdinal, code),
      operation: value.operation,
      revision: nonnegativeInteger(value.revision, code),
      state: pageText(value.state, 1, 100, code),
      selectedAttemptId: nullableIdentifier(value.selectedAttemptId, 200, code),
      selectedResultId: nullableIdentifier(value.selectedResultId, 200, code),
      attempts: value.attempts.map(pageAttempt),
    };
  }

  function pageAssignment(value) {
    var code = 'SS_ERP_BYOK_BATCH_REGISTRY_PROJECTION_INVALID';
    if (!isRecord(value) || !Number.isSafeInteger(value.width) || value.width < 1
      || !Number.isSafeInteger(value.height) || value.height < 1) fail(code);
    return {
      slotKey: identifier(value.slotKey, 1, 200, code),
      skuKey: pageText(value.skuKey, 1, 500, code),
      assignmentOrdinal: ordinal(value.assignmentOrdinal, code),
      attemptId: identifier(value.attemptId, 1, 200, code),
      resultId: identifier(value.resultId, 1, 200, code),
      assetId: identifier(value.assetId, 1, 200, code),
      provenanceId: identifier(value.provenanceId, 1, 200, code),
      executionIntentId: identifier(value.executionIntentId, 1, 200, code),
      mimeType: pageText(value.mimeType, 1, 100, code),
      width: value.width,
      height: value.height,
    };
  }

  function pageIngest(value) {
    if (value === null) return null;
    var code = 'SS_ERP_BYOK_BATCH_REGISTRY_PROJECTION_INVALID';
    if (!isRecord(value) || !Array.isArray(value.assignments)) {
      fail(code);
    }
    if (value.erpGenerationChargeCents !== 0
      || typeof value.rebootstrapRequired !== 'boolean') fail(code);
    return {
      state: pageText(value.state, 1, 100, code),
      idempotencyKey: nullableIdentifier(value.idempotencyKey, 200, code),
      replayed: nullableBoolean(value.replayed, code),
      receiptId: nullableIdentifier(value.receiptId, 200, code),
      boundDraftRevision: value.boundDraftRevision === null
        ? null : positiveInteger(value.boundDraftRevision, code),
      boundDraftVersion: value.boundDraftVersion === null
        ? null : positiveInteger(value.boundDraftVersion, code),
      erpGenerationChargeCents: 0,
      rebootstrapRequired: value.rebootstrapRequired,
      assignments: value.assignments.map(pageAssignment),
      errorCode: nullableIdentifier(value.errorCode, 120, code),
    };
  }

  function pageProjection(value) {
    var code = 'SS_ERP_BYOK_BATCH_REGISTRY_PROJECTION_INVALID';
    if (!isRecord(value) || value.contractVersion !== COORDINATOR_VERSION
      || value.executionMode !== 'BYOK' || !Number.isSafeInteger(value.revision)
      || value.revision < 0 || !isRecord(value.billing)
      || value.billing.erpGenerationChargeCents !== 0 || !Array.isArray(value.slots)
      || (value.scheduler !== null && !isRecord(value.scheduler))) {
      fail(code);
    }
    return deepFreeze({
      contractVersion: COORDINATOR_VERSION,
      executionMode: 'BYOK',
      revision: value.revision,
      scheduler: value.scheduler === null ? null : {
        state: pageText(value.scheduler.state, 1, 100, code),
        activeCount: nonnegativeInteger(value.scheduler.activeCount, code),
        queuedCount: nonnegativeInteger(value.scheduler.queuedCount, code),
        pauseRequested: typeof value.scheduler.pauseRequested === 'boolean'
          ? value.scheduler.pauseRequested : fail(code),
        effectiveConcurrency: positiveInteger(value.scheduler.effectiveConcurrency, code),
      },
      billing: { erpGenerationChargeCents: 0 },
      slots: value.slots.map(pageSlot),
      ingest: pageIngest(value.ingest),
    });
  }

  function pageCancellation(value) {
    if (!isRecord(value) || typeof value.cancelled !== 'boolean'
      || typeof value.attemptId !== 'string' || !isRecord(value.projection)) {
      fail('SS_ERP_BYOK_BATCH_REGISTRY_PROJECTION_INVALID');
    }
    return deepFreeze({
      cancelled: value.cancelled,
      attemptId: value.attemptId,
      projection: pageProjection(value.projection),
    });
  }

  function persistedStatusMatches(session, recovery, status) {
    var context = status && status.context;
    return isRecord(status) && isRecord(context)
      && status.contractVersion === 'extension-byok-execution-batch-status/v1'
      && status.batchId === recovery.executionBatchId
      && ['OPEN', 'BOUND', 'CANCELLED'].includes(status.status)
      && context.shopId === session.context.shopId
      && context.workflowId === session.context.workflowId
      && context.draftRevision === session.context.draftRevision
      && context.draftVersion === session.context.draftVersion
      && context.sourcePlatform === session.context.sourcePlatform
      && context.sourceProductId === session.context.sourceProductId
      && context.sourceCaptureSnapshotId === session.context.sourceCaptureSnapshotId
      && context.supplyGoodsId === session.context.supplyGoodsId
      && Array.isArray(status.items)
      && status.items.length === recovery.slots.length
      && status.items.every(function (item, index) {
        var slot = recovery.slots[index];
        return isRecord(item) && isRecord(item.intent)
          && item.itemIndex === index
          && item.skuKey === slot.skuKey
          && item.slotKey === slot.slotKey;
      });
  }

  function persistedBoundProjection(status) {
    return pageProjection({
      contractVersion: COORDINATOR_VERSION,
      executionMode: 'BYOK',
      revision: 1,
      scheduler: null,
      billing: { erpGenerationChargeCents: 0 },
      slots: [],
      ingest: {
        state: 'SUCCEEDED', idempotencyKey: null, replayed: true, receiptId: null,
        boundDraftRevision: status.boundDraftRevision,
        boundDraftVersion: status.boundDraftVersion,
        erpGenerationChargeCents: 0, rebootstrapRequired: true,
        assignments: [], errorCode: null,
      },
    });
  }

  function persistedOpenProjection(recovery, status) {
    var allTerminal = status.items.every(function (item) {
      return ['FAILED_FINAL', 'SUCCEEDED'].includes(item.intent.outcome);
    });
    return pageProjection({
      contractVersion: COORDINATOR_VERSION,
      executionMode: 'BYOK',
      revision: 1,
      scheduler: {
        state: 'FAILED', activeCount: 0, queuedCount: 0,
        pauseRequested: false, effectiveConcurrency: SERIAL_REQUESTED_CONCURRENCY,
      },
      billing: { erpGenerationChargeCents: 0 },
      slots: status.items.map(function (item, index) {
        var slot = recovery.slots[index];
        var uncertain = ['PENDING', 'UNKNOWN_OUTCOME'].includes(item.intent.outcome);
        var attemptState = uncertain ? 'UNKNOWN_OUTCOME' : 'FAILED_FINAL';
        return {
          slotKey: slot.slotKey,
          skuKey: slot.skuKey,
          assignmentOrdinal: item.assignmentOrdinal,
          operation: slot.operation,
          revision: 1,
          state: attemptState,
          selectedAttemptId: null,
          selectedResultId: null,
          attempts: [{
            attemptId: 'recovered-attempt-' + index + '-' + item.intent.attemptIndex,
            generation: item.intent.attemptIndex + 1,
            operation: slot.operation,
            state: attemptState,
            resultId: null,
            errorCode: uncertain
              ? 'SS_ERP_BYOK_BATCH_WORKER_RESTART_UNRESOLVED'
              : item.intent.outcome === 'SUCCEEDED'
                ? 'SS_ERP_BYOK_BATCH_LOCAL_RESULT_LOST'
                : 'SS_ERP_BYOK_BATCH_PROVIDER_FAILED_FINAL',
            retryOfAttemptId: null,
            externalChargePossible: true,
            retryRisk: uncertain ? 'POSSIBLE_DUPLICATE_PROVIDER_CHARGE' : null,
            chargeWarningVersion: uncertain ? 'external-provider-duplicate-charge/v1' : null,
            automaticRetryAllowed: false,
            recoveryRequirement: uncertain
              ? 'SERVICE_WORKER_RESTART_RECONCILIATION_REQUIRED' : null,
            unknownOutcomeSuperseded: false,
            reviewState: 'NOT_READY',
          }],
        };
      }),
      ingest: {
        state: allTerminal ? 'FAILED_FINAL' : 'RECOVERY_REQUIRED',
        idempotencyKey: null, replayed: null, receiptId: null,
        boundDraftRevision: null, boundDraftVersion: null,
        erpGenerationChargeCents: 0, rebootstrapRequired: false,
        assignments: [],
        errorCode: 'SS_ERP_BYOK_BATCH_WORKER_RESTART_UNRESOLVED',
      },
    });
  }

  function createRegistry(options) {
    var sessionManager = options && options.sessionManager;
    var batchLaunchClient = options && options.batchLaunchClient;
    var readinessClient = options && options.readinessClient;
    var executionBatchClient = options && options.executionBatchClient;
    var claimBroker = options && options.claimBroker;
    var textClient = options && options.textClient;
    var editClient = options && options.editClient;
    var authorityGuard = options && options.authorityGuard;
    var createCoordinator = options && options.createCoordinator;
    var resolveProviderInput = options && options.resolveProviderInput;
    var resolveRecovery = options && options.resolveRecovery;
    var resultVault = options && options.resultVault;
    var previewBroker = options && options.previewBroker;
    var cryptoImpl = options && options.crypto || global.crypto;
    var dependencies = [
      [sessionManager, [
        'claim', 'beginOperation', 'updateOperationRecovery', 'clearOperation',
      ]],
      [batchLaunchClient, ['resolve']],
      [readinessClient, ['getReadiness']],
      [executionBatchClient, [
        'claim', 'claimSuccessor', 'cancel', 'status', 'statusByIdempotency',
      ]],
      [claimBroker, ['registerBatch', 'registerAttempt', 'releaseBatch', 'reportOutcome']],
      [textClient, ['prepareDispatch', 'releasePrepared']],
      [editClient, ['prepareDispatch', 'releasePrepared']],
      [authorityGuard, ['capture', 'assertCurrent']],
      [resultVault, ['getForBackground', 'release']],
      [previewBroker, ['open', 'releaseResult']],
    ];
    if (!isRecord(options)
      || dependencies.some(function (entry) {
        return !entry[0] || entry[1].some(function (name) {
          return typeof entry[0][name] !== 'function';
        });
      })
      || typeof createCoordinator !== 'function'
      || typeof resolveProviderInput !== 'function'
      || typeof resolveRecovery !== 'function'
      || !cryptoImpl || typeof cryptoImpl.randomUUID !== 'function') {
      fail('SS_ERP_BYOK_BATCH_REGISTRY_DEPENDENCY_UNAVAILABLE');
    }

    var entries = new Map();
    var starting = new Set();
    var cleanupRequested = new Set();

    function randomId(prefix) {
      var value = cryptoImpl.randomUUID();
      if (typeof value !== 'string'
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
          .test(value)) fail('SS_ERP_BYOK_BATCH_REGISTRY_RANDOM_UNAVAILABLE');
      return prefix + value;
    }

    function getEntry(owner) {
      return entries.get(ownerKey(owner)) || null;
    }

    function assertStartupNotCancelled(key) {
      if (cleanupRequested.has(key)) {
        fail('SS_ERP_BYOK_BATCH_REGISTRY_START_CANCELLED');
      }
    }

    async function claimSession(owner, expectedOperationKey) {
      var session = normalizeSession(await sessionManager.claim(sessionSender(owner)), owner);
      var operation = session.operation;
      if (expectedOperationKey === null) {
        if (operation !== null) fail('SS_ERP_BYOK_BATCH_REGISTRY_OPERATION_LOCKED', 'UNKNOWN_OUTCOME');
      } else if (!isRecord(operation)
        || operation.idempotencyKey !== expectedOperationKey
        || operation.state !== 'OUTCOME_UNRESOLVED') {
        fail('SS_ERP_BYOK_BATCH_REGISTRY_OPERATION_LOCKED', 'UNKNOWN_OUTCOME');
      }
      return session;
    }

    async function validateEntry(owner, entry) {
      var session = await claimSession(owner, entry.operationKey);
      if (JSON.stringify(session.context) !== JSON.stringify(entry.session.context)) {
        fail('SS_ERP_BYOK_BATCH_REGISTRY_SESSION_STALE', 'UNKNOWN_OUTCOME');
      }
      await authorityGuard.assertCurrent(entry.authority);
      return entry;
    }

    function clientForOperation(operation) {
      return operation === 'TEXT_TO_IMAGE' ? textClient : editClient;
    }

    async function providerInput(entry, slot, readinessBinding, request) {
      var extras = await resolveProviderInput(Object.freeze({
        owner: entry.owner,
        session: entry.session.raw,
        launch: entry.launch,
        profileId: entry.profileId,
        slot: request,
        readinessBinding: readinessBinding,
      }));
      if (!isRecord(extras) || Object.keys(extras).some(function (key) {
        return PROTECTED_PROVIDER_INPUT_KEYS.has(key);
      })) fail('SS_ERP_BYOK_BATCH_REGISTRY_PROVIDER_INPUT_INVALID');
      var result = {
        ...extras,
        profileId: entry.profileId,
        prompt: request.prompt,
        negativePrompt: request.negativePrompt,
        size: request.size,
        idempotencyKey: request.idempotencyKey,
        readinessBinding: readinessBinding,
      };
      if (slot.operation !== 'TEXT_TO_IMAGE') result.operation = slot.operation;
      return result;
    }

    async function prepareRecord(entry, slot, readiness, request, itemIndex) {
      var client = clientForOperation(slot.operation);
      var prepared = normalizePrepared(
        await client.prepareDispatch(await providerInput(
          entry, slot, readiness.binding, request,
        )),
        request,
      );
      var record = {
        dispatchRef: randomId('byok-dispatch:'),
        client: client,
        prepared: prepared,
        readiness: readiness,
        slot: slot,
        request: request,
        itemIndex: itemIndex,
        handedOff: false,
        resolving: false,
        intent: null,
        serverAttemptIndex: null,
      };
      entry.preparedByRef.set(record.dispatchRef, record);
      return record;
    }

    function releasePreparedRecord(entry, record) {
      if (!record || record.handedOff) return false;
      entry.preparedByRef.delete(record.dispatchRef);
      try { record.client.releasePrepared(record.prepared.handle); } catch {}
      return true;
    }

    function releaseAllPrepared(entry) {
      Array.from(entry.preparedByRef.values()).forEach(function (record) {
        releasePreparedRecord(entry, record);
      });
    }

    function expandIntent(batch, item, readiness) {
      var minimal = item && item.intent;
      if (!isRecord(batch) || !isRecord(item) || !isRecord(minimal)
      || batch.status !== 'OPEN' || typeof batch.replayed !== 'boolean'
      || minimal.contractVersion !== 'extension-byok-execution-intent/v1'
      || minimal.outcome !== 'PENDING'
      || !Number.isSafeInteger(minimal.attemptIndex)
      || minimal.attemptIndex < 0 || minimal.attemptIndex > 499
        || item.skuKey !== readiness.binding.skuKey
        || item.slotKey !== readiness.binding.slotKey
        || item.assignmentOrdinal !== readiness.binding.assignmentOrdinal) {
        fail('SS_ERP_BYOK_BATCH_REGISTRY_RESERVATION_INVALID');
      }
      return deepFreeze({
        contractVersion: 'extension-byok-execution-intent/v1',
        intentId: identifier(
          minimal.intentId, 1, 200, 'SS_ERP_BYOK_BATCH_REGISTRY_RESERVATION_INVALID',
        ),
        replayed: batch.replayed,
        executionMode: 'BYOK',
        outcome: 'PENDING',
        providerIdempotencyKey: minimal.providerIdempotencyKey,
        providerRequestHash: sha256(
          minimal.providerRequestHash, 'SS_ERP_BYOK_BATCH_REGISTRY_RESERVATION_INVALID',
        ),
        context: {
          shopId: batch.context.shopId,
          workflowId: batch.context.workflowId,
          draftRevision: batch.context.draftRevision,
          draftVersion: batch.context.draftVersion,
          skuKey: item.skuKey,
          slotKey: item.slotKey,
        },
      });
    }

    function validateBatch(batch, entry, records) {
      var context = batch && batch.context;
      if (!isRecord(batch) || !isRecord(context)
        || typeof batch.batchId !== 'string' || batch.status !== 'OPEN'
        || !Array.isArray(batch.items) || batch.items.length !== records.length
        || context.shopId !== entry.session.context.shopId
        || context.workflowId !== entry.session.context.workflowId
        || context.draftRevision !== entry.session.context.draftRevision
        || context.draftVersion !== entry.session.context.draftVersion) {
        fail('SS_ERP_BYOK_BATCH_REGISTRY_RESERVATION_INVALID');
      }
      return batch.items.map(function (item, index) {
        if (item.itemIndex !== index) fail('SS_ERP_BYOK_BATCH_REGISTRY_RESERVATION_INVALID');
        return expandIntent(batch, item, records[index].readiness);
      });
    }

    async function reportUndispatchedIntent(record) {
      if (!record || record.terminalReported) return true;
      var intent = record.intent;
      if (!intent) return false;
      await claimBroker.reportOutcome({
        intentId: intent.intentId,
        providerIdempotencyKey: intent.providerIdempotencyKey,
        providerRequestHash: intent.providerRequestHash,
        outcome: 'FAILED_FINAL',
        providerRequestIdSha256: null,
        resultSha256: null,
      });
      record.terminalReported = true;
      return true;
    }

    async function rollbackReservation(entry, records) {
      try {
        for (const record of records) await reportUndispatchedIntent(record);
        await executionBatchClient.cancel({ batchId: entry.executionBatchId });
        entry.reservationStatus = 'CANCELLED';
        claimBroker.releaseBatch(entry.executionBatchId);
        return true;
      } catch {
        entry.phase = 'RECOVERY_REQUIRED';
        return false;
      }
    }

    async function clearOperation(entry) {
      try {
        await sessionManager.clearOperation(sessionSender(entry.owner), entry.operationKey);
        return true;
      } catch {
        try {
          var session = normalizeSession(
            await sessionManager.claim(sessionSender(entry.owner)), entry.owner,
          );
          if (session.operation === null) return true;
        } catch {}
        return false;
      }
    }

    async function clearPersistedOperation(owner, operationKey) {
      try {
        await sessionManager.clearOperation(sessionSender(owner), operationKey);
        return true;
      } catch {
        try {
          var current = normalizeSession(
            await sessionManager.claim(sessionSender(owner)), owner,
          );
          if (current.operation === null) return true;
        } catch {}
        fail('SS_ERP_BYOK_BATCH_REGISTRY_RECONCILIATION_UNAVAILABLE', 'UNKNOWN_OUTCOME');
      }
    }

    async function loadPersistedStatus(owner, session) {
      var operation = session.operation;
      var recovery = operation && operation.recovery;
      if (!operation || !recovery) {
        fail('SS_ERP_BYOK_BATCH_REGISTRY_START_UNRESOLVED', 'UNKNOWN_OUTCOME');
      }
      var status;
      try {
        status = recovery.phase === 'PREPARING'
          ? await executionBatchClient.statusByIdempotency({
            idempotencyKey: recovery.reservationIdempotencyKey,
          })
          : await executionBatchClient.status({ batchId: recovery.executionBatchId });
      } catch {
        fail('SS_ERP_BYOK_BATCH_REGISTRY_RECONCILIATION_UNAVAILABLE', 'UNKNOWN_OUTCOME');
      }
      if (status === null) {
        if (recovery.phase !== 'PREPARING') {
          fail('SS_ERP_BYOK_BATCH_REGISTRY_RECONCILIATION_INVALID', 'UNKNOWN_OUTCOME');
        }
        return { operation: operation, recovery: recovery, status: null };
      }
      var effectiveRecovery = recovery.phase === 'PREPARING'
        ? Object.freeze({ ...recovery, phase: 'RESERVED', executionBatchId: status.batchId })
        : recovery;
      if (!persistedStatusMatches(session, effectiveRecovery, status)) {
        fail('SS_ERP_BYOK_BATCH_REGISTRY_RECONCILIATION_INVALID', 'UNKNOWN_OUTCOME');
      }
      return { operation: operation, recovery: effectiveRecovery, status: status };
    }

    async function updatePersistedSuccessorRecovery(owner, session, successorRecovery) {
      var operation = session.operation;
      if (!operation || !operation.recovery) {
        fail('SS_ERP_BYOK_BATCH_REGISTRY_RECONCILIATION_INVALID', 'UNKNOWN_OUTCOME');
      }
      var expectedRecovery = Object.freeze({
        ...operation.recovery,
        successorRecovery: successorRecovery,
      });
      try {
        return normalizeSession(
          await sessionManager.updateOperationRecovery(
            sessionSender(owner), operation.idempotencyKey, expectedRecovery,
          ),
          owner,
        );
      } catch {
        try {
          var current = normalizeSession(
            await sessionManager.claim(sessionSender(owner)), owner,
          );
          if (current.operation
            && current.operation.idempotencyKey === operation.idempotencyKey
            && JSON.stringify(current.operation.recovery) === JSON.stringify(expectedRecovery)) {
            return current;
          }
        } catch {}
        fail('SS_ERP_BYOK_BATCH_REGISTRY_RECONCILIATION_UNAVAILABLE', 'UNKNOWN_OUTCOME');
      }
    }

    async function reconcilePersistedSuccessor(owner, session, persisted) {
      var successorRecovery = persisted.recovery.successorRecovery;
      if (!successorRecovery || successorRecovery.state === 'HANDOFF_STARTED') return persisted;
      var proof = successorStatusProof(
        session, persisted.recovery, persisted.status, successorRecovery,
      );
      if (proof === 'UNPROVED') {
        fail('SS_ERP_BYOK_BATCH_REGISTRY_RECONCILIATION_INVALID', 'UNKNOWN_OUTCOME');
      }
      if (proof === 'SUCCESSOR_PENDING') {
        var item = persisted.status.items[successorRecovery.itemIndex];
        try {
          await claimBroker.reportOutcome({
            intentId: item.intent.intentId,
            providerIdempotencyKey: item.intent.providerIdempotencyKey,
            providerRequestHash: item.intent.providerRequestHash,
            outcome: 'FAILED_FINAL',
            providerRequestIdSha256: null,
            resultSha256: null,
          });
        } catch {
          fail('SS_ERP_BYOK_BATCH_REGISTRY_RECONCILIATION_UNAVAILABLE', 'UNKNOWN_OUTCOME');
        }
      }
      var updatedSession = await updatePersistedSuccessorRecovery(owner, session, null);
      var reloaded = await loadPersistedStatus(owner, updatedSession);
      if (reloaded.status === null) {
        fail('SS_ERP_BYOK_BATCH_REGISTRY_RECONCILIATION_INVALID', 'UNKNOWN_OUTCOME');
      }
      return reloaded;
    }

    async function cancelUndispatchedPersisted(owner, persisted) {
      if (persisted.recovery.phase !== 'RESERVED' || persisted.status.status !== 'OPEN'
        || persisted.status.items.some(function (item) {
          return !['PENDING', 'FAILED_FINAL'].includes(item.intent.outcome);
        })) {
        fail('SS_ERP_BYOK_BATCH_REGISTRY_RECONCILIATION_INVALID', 'UNKNOWN_OUTCOME');
      }
      try {
        for (const item of persisted.status.items) {
          if (item.intent.outcome === 'FAILED_FINAL') continue;
          await claimBroker.reportOutcome({
            intentId: item.intent.intentId,
            providerIdempotencyKey: item.intent.providerIdempotencyKey,
            providerRequestHash: item.intent.providerRequestHash,
            outcome: 'FAILED_FINAL',
            providerRequestIdSha256: null,
            resultSha256: null,
          });
        }
        await executionBatchClient.cancel({ batchId: persisted.recovery.executionBatchId });
      } catch {
        fail('SS_ERP_BYOK_BATCH_REGISTRY_RECONCILIATION_UNAVAILABLE', 'UNKNOWN_OUTCOME');
      }
      await clearPersistedOperation(owner, persisted.operation.idempotencyKey);
      return emptyProjection();
    }

    async function reconcilePersisted(owner, session) {
      var persisted = await loadPersistedStatus(owner, session);
      if (persisted.status === null) {
        await clearPersistedOperation(owner, persisted.operation.idempotencyKey);
        return emptyProjection();
      }
      if (persisted.status.status === 'CANCELLED') {
        await clearPersistedOperation(owner, persisted.operation.idempotencyKey);
        return emptyProjection();
      }
      if (persisted.status.status === 'BOUND') {
        await clearPersistedOperation(owner, persisted.operation.idempotencyKey);
        return persistedBoundProjection(persisted.status);
      }
      persisted = await reconcilePersistedSuccessor(owner, session, persisted);
      if (persisted.recovery.phase === 'RESERVED') {
        return cancelUndispatchedPersisted(owner, persisted);
      }
      return persistedOpenProjection(persisted.recovery, persisted.status);
    }

    function coordinatorMethods(value) {
      return value && REQUIRED_COORDINATOR_METHODS.every(function (name) {
        return typeof value[name] === 'function';
      });
    }

    function internalBinding(entry, lifecycleAuthority) {
      var first = entry.readiness[0].binding;
      return Object.freeze({
        contractVersion: COORDINATOR_BINDING_VERSION,
        lifecycleAuthority: lifecycleAuthority,
        ownerUserId: first.ownerUserId,
        deviceSessionId: first.deviceSessionId,
        shopId: first.shopId,
        workflowId: first.workflowId,
        draftRevision: first.draftRevision,
        draftVersion: first.draftVersion,
        sourcePlatform: first.sourcePlatform,
        sourceProductId: first.sourceProductId,
        sourceCaptureSnapshotId: first.sourceCaptureSnapshotId,
        supplyGoodsId: first.supplyGoodsId,
        skuKey: entry.launch.anchorSkuKey,
        providerOrigin: first.providerOrigin,
        model: first.model,
        policyRevision: first.policyRevision,
      });
    }

    function synchronizeAttempts(entry, projection) {
      if (!projection || !Array.isArray(projection.slots)) return;
      projection.slots.forEach(function (slot) {
        var current = entry.latestBySlot.get(slot.slotKey);
        if (!current || !Array.isArray(slot.attempts)) return;
        slot.attempts.forEach(function (attempt) {
          if (!entry.intentByAttempt.has(attempt.attemptId)
            && attempt.intentHash === current.record.request.intentHash) {
            entry.intentByAttempt.set(attempt.attemptId, current.record);
          }
        });
      });
    }

    async function resolvePrepared(entry, dispatchRef, attempt) {
      var record = entry.preparedByRef.get(dispatchRef);
      if (!record || record.handedOff || record.resolving || !record.intent
        || attempt.slotKey !== record.slot.slotKey
        || attempt.operation !== record.slot.operation
        || attempt.idempotencyKey !== record.request.idempotencyKey
        || attempt.intentHash !== record.request.intentHash) {
        fail('SS_ERP_BYOK_BATCH_REGISTRY_DISPATCH_UNAVAILABLE', 'UNKNOWN_OUTCOME');
      }
      record.resolving = true;
      try {
        await validateEntry(entry.owner, entry);
        if (record.handedOff) {
          fail('SS_ERP_BYOK_BATCH_REGISTRY_DISPATCH_UNAVAILABLE', 'UNKNOWN_OUTCOME');
        }
        record.handedOff = true;
        entry.intentByAttempt.set(attempt.attemptId, record);
        return Object.freeze({
          preparedRequestHandle: record.prepared.handle,
          executionIntentId: record.intent.intentId,
          providerRequestHash: record.intent.providerRequestHash,
        });
      } finally {
        record.resolving = false;
      }
    }

    async function internalRecovery(entry, value) {
      var record = value && entry.recoveryRefs.get(value.recoveryRef);
      if (!record || !value.attempt || value.attempt.attemptId !== record.attemptId) {
        fail('SS_ERP_BYOK_BATCH_REGISTRY_RECOVERY_INVALID', 'UNKNOWN_OUTCOME');
      }
      return resolveRecovery(Object.freeze({
        owner: entry.owner,
        authority: entry.authority,
        session: entry.session.raw,
        executionBatchId: entry.executionBatchId,
        command: record.command,
        attempt: value.attempt,
      }));
    }

    async function start(ownerValue, value) {
      var owner = normalizeOwner(ownerValue);
      var key = ownerKey(owner);
      if (entries.has(key) || starting.has(key)) {
        fail('SS_ERP_BYOK_BATCH_REGISTRY_ALREADY_STARTED');
      }
      var startRequest = normalizeStart(value);
      starting.add(key);
      var entry = null;
      var records = [];
      var reservationAttempted = false;
      try {
        var initialSession = await claimSession(owner, null);
        var operationKey = randomId('byok_batch_');
        var reservationIdempotencyKey = randomId('byok-reservation:');
        var lockedSession = normalizeSession(
          await sessionManager.beginOperation(
            sessionSender(owner),
            operationKey,
            recoveryDescriptor(
              initialSession,
              startRequest.slots,
              reservationIdempotencyKey,
              'PREPARING',
              null,
            ),
          ),
          owner,
        );
        if (!lockedSession.operation
          || lockedSession.operation.idempotencyKey !== operationKey) {
          fail('SS_ERP_BYOK_BATCH_REGISTRY_OPERATION_LOCKED', 'UNKNOWN_OUTCOME');
        }
        entry = {
          owner: owner,
          operationKey: operationKey,
          session: lockedSession,
          launch: null,
          profileId: startRequest.profileId,
          requestedConcurrency: startRequest.requestedConcurrency,
          pageSlots: startRequest.slots,
          readiness: [],
          authority: null,
          executionBatchId: null,
          reservationIdempotencyKey: reservationIdempotencyKey,
          reservationStatus: null,
          preparedByRef: new Map(),
          latestBySlot: new Map(),
          intentByAttempt: new Map(),
          recoveryRefs: new Map(),
          commandIds: new Set(),
          coordinator: null,
          phase: 'PREPARING',
          dispatchMayHaveStarted: false,
          rollbackRecords: records,
          previewResultIds: new Set(),
        };
        entries.set(key, entry);
        assertStartupNotCancelled(key);
        if (JSON.stringify(initialSession.context) !== JSON.stringify(lockedSession.context)) {
          fail('SS_ERP_BYOK_BATCH_REGISTRY_SESSION_STALE');
        }
        entry.launch = normalizeLaunch(
          await batchLaunchClient.resolve(launchRequest(lockedSession.context)),
          lockedSession,
          startRequest.slots,
        );
        for (let index = 0; index < startRequest.slots.length; index += 1) {
          var slot = startRequest.slots[index];
          var readinessRequest = expectedReadinessRequest(
            startRequest,
            entry.launch,
            slot,
            entry.launch.firstAssignmentOrdinal + index,
          );
          var readiness = normalizeReadiness(
            await readinessClient.getReadiness(readinessRequest),
            readinessRequest,
          );
          if (entry.readiness.length && !sameReadinessAuthority(entry.readiness[0], readiness)) {
            fail('SS_ERP_BYOK_BATCH_REGISTRY_READINESS_INVALID');
          }
          entry.readiness.push(readiness);
        }
        if (startRequest.requestedConcurrency > entry.readiness[0].maxConcurrency) {
          fail('SS_ERP_BYOK_BATCH_REGISTRY_READINESS_INVALID');
        }
        entry.authority = await authorityGuard.capture(entry.readiness[0].binding);
        await authorityGuard.assertCurrent(entry.authority);
        for (let index = 0; index < startRequest.slots.length; index += 1) {
          records.push(await prepareRecord(
            entry,
            startRequest.slots[index],
            entry.readiness[index],
            startRequest.slots[index],
            index,
          ));
        }
        await authorityGuard.assertCurrent(entry.authority);
        await claimSession(owner, operationKey);
        assertStartupNotCancelled(key);
        reservationAttempted = true;
        var batch = await executionBatchClient.claim({
          idempotencyKey: reservationIdempotencyKey,
          items: records.map(function (record) {
            return {
              readinessBinding: record.readiness.binding,
              requestMode: record.prepared.requestMode,
              providerIdempotencyKey: record.prepared.providerIdempotencyKey,
              providerRequestHash: record.prepared.providerRequestHash,
            };
          }),
        });
        entry.executionBatchId = identifier(
          batch.batchId, 1, 200, 'SS_ERP_BYOK_BATCH_REGISTRY_RESERVATION_INVALID',
        );
        await sessionManager.updateOperationRecovery(
          sessionSender(owner),
          operationKey,
          recoveryDescriptor(
            lockedSession,
            startRequest.slots,
            reservationIdempotencyKey,
            'RESERVED',
            entry.executionBatchId,
          ),
        );
        var intents = validateBatch(batch, entry, records);
        entry.reservationStatus = 'OPEN';
        records.forEach(function (record, index) {
          record.intent = intents[index];
          record.serverAttemptIndex = batch.items[index].intent.attemptIndex;
        });
        assertStartupNotCancelled(key);
        await claimBroker.registerBatch({
          executionBatchId: entry.executionBatchId,
          claims: records.map(function (record) {
            return {
              readinessBinding: record.readiness.binding,
              requestMode: record.prepared.requestMode,
              intent: record.intent,
            };
          }),
        });
        records.forEach(function (record) {
          entry.latestBySlot.set(record.slot.slotKey, { record: record });
        });
        await validateEntry(owner, entry);
        var coordinator = createCoordinator(Object.freeze({
          owner: owner,
          requestedConcurrency: startRequest.requestedConcurrency,
          concurrencyAuthority: Object.freeze({
            ownerUserId: entry.readiness[0].binding.ownerUserId,
            deviceSessionId: entry.readiness[0].binding.deviceSessionId,
            policyRevision: entry.readiness[0].binding.policyRevision,
            maxConcurrency: entry.readiness[0].maxConcurrency,
            expiresAt: entry.readiness[0].expiresAt,
          }),
          resolveDispatchInput: function (dispatchRef, attempt) {
            return resolvePrepared(entry, dispatchRef, attempt);
          },
          resolveRecovery: function (recovery) { return internalRecovery(entry, recovery); },
        }));
        if (!coordinatorMethods(coordinator)) {
          fail('SS_ERP_BYOK_BATCH_REGISTRY_COORDINATOR_INVALID');
        }
        entry.coordinator = coordinator;
        var lifecycleAuthority = entry.authority && entry.authority.lifecycleAuthority;
        if (!isRecord(lifecycleAuthority)
          || lifecycleAuthority.contractVersion !== LIFECYCLE_VERSION
          || !Number.isSafeInteger(lifecycleAuthority.epoch)
          || lifecycleAuthority.epoch < 0) {
          fail('SS_ERP_BYOK_BATCH_REGISTRY_AUTHORITY_INVALID');
        }
        entry.phase = 'SCHEDULING';
        assertStartupNotCancelled(key);
        await sessionManager.updateOperationRecovery(
          sessionSender(owner),
          operationKey,
          recoveryDescriptor(
            lockedSession,
            startRequest.slots,
            reservationIdempotencyKey,
            'DISPATCHING',
            entry.executionBatchId,
          ),
        );
        assertStartupNotCancelled(key);
        entry.dispatchMayHaveStarted = true;
        var projection = coordinator.startBatch({
          contractVersion: COORDINATOR_START_VERSION,
          batchId: entry.executionBatchId,
          binding: internalBinding(entry, lifecycleAuthority),
          slots: records.map(function (record) {
            return {
              skuKey: record.slot.skuKey,
              slotKey: record.slot.slotKey,
              assignmentMode: 'APPEND',
              assignmentOrdinal: record.readiness.binding.assignmentOrdinal,
              operation: record.slot.operation,
              idempotencyKey: record.request.idempotencyKey,
              intentHash: record.request.intentHash,
              dispatchRef: record.dispatchRef,
            };
          }),
        });
        entry.phase = 'ACTIVE';
        synchronizeAttempts(entry, projection);
        return pageProjection(projection);
      } catch (error) {
        if (entry) {
          releaseAllPrepared(entry);
          var safe = !reservationAttempted && !entry.dispatchMayHaveStarted;
          if (entry.executionBatchId && !entry.dispatchMayHaveStarted) {
            safe = await rollbackReservation(entry, records);
          }
          else if (reservationAttempted) safe = false;
          if (entry.coordinator && !entry.dispatchMayHaveStarted) {
            try { entry.coordinator.dispose(); } catch {}
          }
          if (safe && await clearOperation(entry)) entries.delete(key);
          else {
            entry.phase = 'RECOVERY_REQUIRED';
            if (reservationAttempted && !entry.executionBatchId
              && !entry.dispatchMayHaveStarted) entries.delete(key);
          }
        }
        if (entry && entry.phase === 'RECOVERY_REQUIRED') {
          throw registryError('SS_ERP_BYOK_BATCH_REGISTRY_START_FAILED', 'UNKNOWN_OUTCOME');
        }
        throw error && error.code ? error
          : registryError('SS_ERP_BYOK_BATCH_REGISTRY_START_FAILED', 'FAILED_FINAL');
      } finally {
        starting.delete(key);
        cleanupRequested.delete(key);
      }
    }

    function projectedAttempt(entry, attemptId) {
      var projection = entry.coordinator.getProjection();
      for (const slot of projection.slots || []) {
        var attempt = (slot.attempts || []).find(function (candidate) {
          return candidate.attemptId === attemptId;
        });
        if (attempt) return { projection: projection, slot: slot, attempt: attempt };
      }
      fail('SS_ERP_BYOK_BATCH_REGISTRY_ATTEMPT_INVALID');
    }

    async function terminalizeSafeAttempt(entry, attempted, stateOverride) {
      var state = stateOverride || attempted.attempt.state;
      if (!['FAILED_RETRYABLE', 'FAILED_FINAL', 'CANCELLED'].includes(state)) {
        return;
      }
      var record = entry.intentByAttempt.get(attempted.attempt.attemptId)
        || (entry.latestBySlot.get(attempted.slot.slotKey) || {}).record;
      if (!record) fail('SS_ERP_BYOK_BATCH_REGISTRY_ATTEMPT_INVALID');
      await reportUndispatchedIntent(record);
    }

    async function successor(entry, command, slot, priorAttempt) {
      if (slot.revision !== command.expectedSlotRevision) {
        fail('SS_ERP_BYOK_BATCH_REGISTRY_SLOT_STALE');
      }
      if (command.kind === 'RETRY') {
        if (!['FAILED_RETRYABLE', 'UNKNOWN_OUTCOME'].includes(priorAttempt.state)
          || (priorAttempt.state === 'UNKNOWN_OUTCOME') !== Boolean(command.unknownOutcomeRecovery)) {
          fail('SS_ERP_BYOK_BATCH_REGISTRY_RETRY_INVALID');
        }
      } else if ((slot.attempts || []).some(function (attempt) {
        return attempt.state === 'UNKNOWN_OUTCOME' && !attempt.unknownOutcomeSuperseded;
      })) {
        fail('SS_ERP_BYOK_BATCH_REGISTRY_RETRY_INVALID', 'UNKNOWN_OUTCOME');
      }
      await terminalizeSafeAttempt(entry, { slot: slot, attempt: priorAttempt });
      var current = entry.latestBySlot.get(slot.slotKey);
      var sourceRecord = entry.intentByAttempt.get(priorAttempt.attemptId);
      if (!current || !current.record.intent || !sourceRecord
        || sourceRecord.slot.slotKey !== slot.slotKey
        || sourceRecord.slot.operation !== slot.operation) {
        fail('SS_ERP_BYOK_BATCH_REGISTRY_ATTEMPT_INVALID');
      }
      var pageRequest = Object.freeze({
        skuKey: slot.skuKey,
        slotKey: slot.slotKey,
        operation: slot.operation,
        idempotencyKey: randomId('byok-provider:'),
        intentHash: sourceRecord.request.intentHash,
        prompt: sourceRecord.request.prompt,
        negativePrompt: sourceRecord.request.negativePrompt,
        size: sourceRecord.request.size,
      });
      var readinessRequest = expectedReadinessRequest(
        { profileId: entry.profileId },
        entry.launch,
        pageRequest,
        current.record.readiness.binding.assignmentOrdinal,
      );
      var readiness = normalizeReadiness(
        await readinessClient.getReadiness(readinessRequest),
        readinessRequest,
      );
      if (!sameReadinessAuthority(entry.readiness[0], readiness)) {
        fail('SS_ERP_BYOK_BATCH_REGISTRY_READINESS_INVALID');
      }
      await authorityGuard.assertCurrent(entry.authority);
      var record = await prepareRecord(
        entry, current.record.slot, readiness, pageRequest, current.record.itemIndex,
      );
      var recovery = successorRecoveryDescriptor(record, current.record, 'CLAIMING');
      var recoveryPersisted = false;
      try {
        await validateEntry(entry.owner, entry);
        await persistEntrySuccessorRecovery(entry, recovery, sessionManager);
        recoveryPersisted = true;
        var result;
        var claimError = null;
        try {
          result = await executionBatchClient.claimSuccessor({
            batchId: entry.executionBatchId,
            itemIndex: record.itemIndex,
            currentIntentId: current.record.intent.intentId,
            providerChargeConfirmed: true,
            item: {
              readinessBinding: readiness.binding,
              requestMode: record.prepared.requestMode,
              providerIdempotencyKey: record.prepared.providerIdempotencyKey,
              providerRequestHash: record.prepared.providerRequestHash,
            },
          });
        } catch (error) {
          claimError = error;
        }
        if (claimError) {
          var status;
          try {
            status = await executionBatchClient.status({ batchId: entry.executionBatchId });
          } catch {
            entry.phase = 'RECOVERY_REQUIRED';
            throw registryError(
              'SS_ERP_BYOK_BATCH_REGISTRY_SUCCESSOR_RECOVERY_REQUIRED', 'UNKNOWN_OUTCOME',
            );
          }
          var proof = successorStatusProof(
            entry.session, entry.session.operation.recovery, status, recovery,
          );
          if (proof === 'PREDECESSOR') {
            await persistEntrySuccessorRecovery(entry, null, sessionManager);
            recoveryPersisted = false;
            throw claimError;
          }
          if (proof !== 'SUCCESSOR_PENDING') {
            entry.phase = 'RECOVERY_REQUIRED';
            throw registryError(
              'SS_ERP_BYOK_BATCH_REGISTRY_SUCCESSOR_RECOVERY_REQUIRED', 'UNKNOWN_OUTCOME',
            );
          }
          result = adoptedSuccessorResult(status, recovery);
        }
        record.intent = expandIntent(result, result.item, readiness);
        record.serverAttemptIndex = result.item.intent.attemptIndex;
        await claimBroker.registerAttempt({
          executionBatchId: entry.executionBatchId,
          readinessBinding: readiness.binding,
          requestMode: record.prepared.requestMode,
          intent: record.intent,
        });
        entry.latestBySlot.set(slot.slotKey, { record: record });
        var internalRequest = {
          idempotencyKey: pageRequest.idempotencyKey,
          intentHash: pageRequest.intentHash,
          dispatchRef: record.dispatchRef,
          commandId: command.commandId,
          expectedSlotRevision: command.expectedSlotRevision,
        };
        if (command.unknownOutcomeRecovery) {
          internalRequest.unknownOutcomeRecovery = command.unknownOutcomeRecovery;
        } else {
          internalRequest.chargeAcknowledgement = command.chargeAcknowledgement;
        }
        recovery = Object.freeze({ ...recovery, state: 'HANDOFF_STARTED' });
        await persistEntrySuccessorRecovery(entry, recovery, sessionManager);
        var projection;
        if (command.kind === 'REGENERATE') {
          internalRequest.slotKey = slot.slotKey;
          internalRequest.operation = slot.operation;
          projection = entry.coordinator.regenerateSlot(slot.slotKey, internalRequest);
        } else {
          projection = await entry.coordinator.retryAttempt(priorAttempt.attemptId, internalRequest);
        }
        await persistEntrySuccessorRecovery(entry, null, sessionManager);
        recoveryPersisted = false;
        synchronizeAttempts(entry, projection);
        return projection;
      } catch (error) {
        if (recoveryPersisted) {
          entry.phase = 'RECOVERY_REQUIRED';
          throw error && error.code ? error : registryError(
            'SS_ERP_BYOK_BATCH_REGISTRY_SUCCESSOR_RECOVERY_REQUIRED', 'UNKNOWN_OUTCOME',
          );
        }
        releasePreparedRecord(entry, record);
        if (record.intent && !record.handedOff) {
          try { await reportUndispatchedIntent(record); } catch {
            entry.phase = 'RECOVERY_REQUIRED';
          }
        }
        throw error;
      }
    }

    async function command(ownerValue, value) {
      var owner = normalizeOwner(ownerValue);
      var entry = getEntry(owner);
      var input = normalizeCommand(value);
      if (!entry) {
        var persistedSession = normalizeSession(
          await sessionManager.claim(sessionSender(owner)), owner,
        );
        if (persistedSession.operation === null) {
          fail('SS_ERP_BYOK_BATCH_REGISTRY_NOT_STARTED');
        }
        if (input.kind !== 'RESOLVE_UNKNOWN') {
          fail('SS_ERP_BYOK_BATCH_REGISTRY_RESTART_RETRY_UNAVAILABLE', 'UNKNOWN_OUTCOME');
        }
        var persistedProjection = await reconcilePersisted(owner, persistedSession);
        if (persistedProjection.revision === 0 || persistedProjection.ingest?.state === 'SUCCEEDED') {
          return persistedProjection;
        }
        var persistedSlot = persistedProjection.slots.find(function (slot) {
          return slot.slotKey === input.slotKey;
        });
        var persistedAttempt = persistedSlot && persistedSlot.attempts.find(function (attempt) {
          return attempt.attemptId === input.attemptId;
        });
        if (persistedProjection.revision !== input.expectedRuntimeRevision
          || !persistedSlot || persistedSlot.revision !== input.expectedSlotRevision
          || !persistedAttempt || persistedAttempt.state !== 'UNKNOWN_OUTCOME') {
          fail('SS_ERP_BYOK_BATCH_REGISTRY_RUNTIME_STALE');
        }
        return persistedProjection;
      }
      if (!entry || !entry.coordinator || entry.phase !== 'ACTIVE') {
        fail('SS_ERP_BYOK_BATCH_REGISTRY_NOT_STARTED');
      }
      await validateEntry(owner, entry);
      var currentProjection = entry.coordinator.getProjection();
      if (currentProjection.revision !== input.expectedRuntimeRevision) {
        fail('SS_ERP_BYOK_BATCH_REGISTRY_RUNTIME_STALE');
      }
      if (entry.commandIds.has(input.commandId)) {
        fail('SS_ERP_BYOK_BATCH_REGISTRY_COMMAND_REPLAY_BLOCKED', 'UNKNOWN_OUTCOME');
      }
      entry.commandIds.add(input.commandId);
      if (input.kind === 'PAUSE') return pageProjection(entry.coordinator.pause());
      if (input.kind === 'CONTINUE') return pageProjection(entry.coordinator.continue());
      if (['KEEP', 'REJECT'].includes(input.kind)) {
        var review = projectedAttempt(entry, input.attemptId);
        if (review.slot.slotKey !== input.slotKey
          || review.slot.revision !== input.expectedSlotRevision) {
          fail('SS_ERP_BYOK_BATCH_REGISTRY_SLOT_STALE');
        }
        return pageProjection(input.kind === 'KEEP'
          ? entry.coordinator.keepAttempt(input.slotKey, input.attemptId)
          : entry.coordinator.rejectAttempt(input.slotKey, input.attemptId));
      }
      if (input.kind === 'CANCEL_QUEUED') {
        var attempted = projectedAttempt(entry, input.attemptId);
        if (attempted.slot.slotKey !== input.slotKey
          || attempted.slot.revision !== input.expectedSlotRevision
          || attempted.attempt.state !== 'QUEUED') {
          fail('SS_ERP_BYOK_BATCH_REGISTRY_SLOT_STALE');
        }
        var cancelled = entry.coordinator.cancelQueued(input.attemptId);
        if (cancelled.cancelled === true) {
          try { await terminalizeSafeAttempt(entry, attempted, 'CANCELLED'); } catch (error) {
            entry.phase = 'RECOVERY_REQUIRED';
            throw error;
          }
        }
        return pageCancellation(cancelled);
      }
      if (input.kind === 'REGENERATE') {
        var slot = (currentProjection.slots || []).find(function (candidate) {
          return candidate.slotKey === input.slotKey;
        });
        if (!slot) {
          fail('SS_ERP_BYOK_BATCH_REGISTRY_SLOT_STALE');
        }
        var prior = slot.attempts[slot.attempts.length - 1];
        return pageProjection(await successor(entry, input, slot, prior));
      }
      if (input.kind === 'RETRY') {
        var retry = projectedAttempt(entry, input.attemptId);
        if (retry.slot.slotKey !== input.slotKey) {
          fail('SS_ERP_BYOK_BATCH_REGISTRY_SLOT_STALE');
        }
        return pageProjection(await successor(entry, input, retry.slot, retry.attempt));
      }
      var unknown = projectedAttempt(entry, input.attemptId);
      if (unknown.slot.slotKey !== input.slotKey
        || unknown.slot.revision !== input.expectedSlotRevision
        || unknown.attempt.state !== 'UNKNOWN_OUTCOME') {
        fail('SS_ERP_BYOK_BATCH_REGISTRY_SLOT_STALE');
      }
      var recoveryRef = randomId('byok-recovery:');
      entry.recoveryRefs.set(recoveryRef, {
        attemptId: input.attemptId,
        command: input,
      });
      try {
        return pageProjection(
          await entry.coordinator.resolveUnknownAttempt(input.attemptId, recoveryRef),
        );
      } finally {
        entry.recoveryRefs.delete(recoveryRef);
      }
    }

    async function state(ownerValue) {
      var owner = normalizeOwner(ownerValue);
      var key = ownerKey(owner);
      var entry = getEntry(owner);
      if (starting.has(key) || entry && !entry.coordinator) {
        fail('SS_ERP_BYOK_BATCH_REGISTRY_START_UNRESOLVED', 'UNKNOWN_OUTCOME');
      }
      if (!entry) {
        var persisted = normalizeSession(
          await sessionManager.claim(sessionSender(owner)), owner,
        );
        if (persisted.operation !== null) {
          return reconcilePersisted(owner, persisted);
        }
        return emptyProjection();
      }
      await validateEntry(owner, entry);
      var projection = entry.coordinator.getProjection();
      synchronizeAttempts(entry, projection);
      return pageProjection(projection);
    }

    async function openPreview(ownerValue, value) {
      var owner = normalizeOwner(ownerValue);
      var entry = getEntry(owner);
      if (!entry || !entry.coordinator || !exactKeys(value, ['slotKey', 'attemptId'])) {
        fail('SS_ERP_BYOK_BATCH_REGISTRY_PREVIEW_INVALID');
      }
      await validateEntry(owner, entry);
      var attempted = projectedAttempt(
        entry,
        identifier(value.attemptId, 1, 200, 'SS_ERP_BYOK_BATCH_REGISTRY_PREVIEW_INVALID'),
      );
      if (attempted.slot.slotKey !== value.slotKey
        || !['CANDIDATE_READY', 'KEPT'].includes(attempted.attempt.state)
        || !attempted.attempt.resultId) {
        fail('SS_ERP_BYOK_BATCH_REGISTRY_PREVIEW_INVALID');
      }
      var result = resultVault.getForBackground(attempted.attempt.resultId);
      var ticket = previewBroker.open({
        resultId: result.resultId,
        reviewState: result.reviewState,
        blob: result.blob,
        mimeType: result.mimeType,
        byteLength: result.byteLength,
        sha256: result.sha256,
      });
      entry.previewResultIds.add(result.resultId);
      return ticket;
    }

    async function ingest(ownerValue, value) {
      var owner = normalizeOwner(ownerValue);
      var entry = getEntry(owner);
      if (!entry || !entry.coordinator || entry.phase !== 'ACTIVE') {
        fail('SS_ERP_BYOK_BATCH_REGISTRY_NOT_STARTED');
      }
      await validateEntry(owner, entry);
      return pageProjection(
        await entry.coordinator.ingestSelectedBatch(normalizeIngest(value)),
      );
    }

    async function recover(ownerValue, value) {
      var owner = normalizeOwner(ownerValue);
      var entry = getEntry(owner);
      if (!entry || !entry.coordinator) fail('SS_ERP_BYOK_BATCH_REGISTRY_NOT_STARTED');
      await validateEntry(owner, entry);
      return pageProjection(await entry.coordinator.recoverIngest(normalizeIngest(value)));
    }

    async function safeCleanup(entry) {
      var key = ownerKey(entry.owner);
      if (starting.has(key) || ['PREPARING', 'SCHEDULING'].includes(entry.phase)) {
        cleanupRequested.add(key);
        return false;
      }
      if (entry.phase === 'CLEANUP_PENDING') return clearOperation(entry);
      if (entry.phase === 'RECOVERY_REQUIRED') {
        if (entry.dispatchMayHaveStarted || !entry.executionBatchId) return false;
        if (!await rollbackReservation(entry, entry.rollbackRecords || [])) return false;
      }
      if (entry.coordinator) {
        var projection = entry.coordinator.getProjection();
        var attempts = (projection.slots || []).flatMap(function (slot) {
          return (slot.attempts || []).map(function (attempt) {
            return { slot: slot, attempt: attempt };
          });
        });
        if ((projection.scheduler && (projection.scheduler.activeCount > 0
          || attempts.some(function (value) {
            return ['SUBMITTING', 'WAITING', 'UNKNOWN_OUTCOME'].includes(value.attempt.state);
          }))) || (projection.ingest && [
          'SUBMITTING', 'RECOVERING', 'UNKNOWN_OUTCOME',
        ].includes(projection.ingest.state))) return false;
        for (const attempted of attempts) {
          if (attempted.attempt.state === 'QUEUED') {
            var cancelled = entry.coordinator.cancelQueued(attempted.attempt.attemptId);
            if (cancelled.cancelled !== true) return false;
            await terminalizeSafeAttempt(entry, attempted, 'CANCELLED');
          } else {
            await terminalizeSafeAttempt(entry, attempted);
          }
        }
        if (projection.ingest && projection.ingest.state === 'SUCCEEDED') {
          entry.reservationStatus = 'BOUND';
        }
      }
      if (entry.executionBatchId && entry.reservationStatus === 'OPEN') {
        try {
          await executionBatchClient.cancel({ batchId: entry.executionBatchId });
          entry.reservationStatus = 'CANCELLED';
        } catch {
          entry.phase = 'RECOVERY_REQUIRED';
          return false;
        }
      }
      releaseAllPrepared(entry);
      if (entry.executionBatchId) claimBroker.releaseBatch(entry.executionBatchId);
      if (entry.coordinator) {
        var finalProjection = entry.coordinator.getProjection();
        (finalProjection.slots || []).forEach(function (slot) {
          (slot.attempts || []).forEach(function (attempt) {
            if (attempt.resultId) {
              try { resultVault.release(attempt.resultId); } catch {}
            }
          });
        });
      }
      entry.previewResultIds.forEach(function (resultId) {
        try { previewBroker.releaseResult(resultId); } catch {}
      });
      entry.previewResultIds.clear();
      if (entry.coordinator) {
        try { entry.coordinator.dispose(); } catch {}
      }
      entry.phase = 'CLEANUP_PENDING';
      return clearOperation(entry);
    }

    async function clear(ownerValue) {
      var owner = normalizeOwner(ownerValue);
      var key = ownerKey(owner);
      if (starting.has(key)) {
        cleanupRequested.add(key);
        fail('SS_ERP_BYOK_BATCH_REGISTRY_CLEAR_UNSAFE', 'UNKNOWN_OUTCOME');
      }
      var entry = entries.get(key);
      if (!entry) {
        var session = normalizeSession(
          await sessionManager.claim(sessionSender(owner)), owner,
        );
        if (session.operation === null) return Object.freeze({ cleared: false });
        var persisted = await loadPersistedStatus(owner, session);
        if (persisted.status === null) {
          await clearPersistedOperation(owner, persisted.operation.idempotencyKey);
          return Object.freeze({ cleared: true });
        }
        if (persisted.status.status === 'BOUND' || persisted.status.status === 'CANCELLED') {
          await clearPersistedOperation(owner, persisted.operation.idempotencyKey);
          return Object.freeze({ cleared: true });
        }
        if (persisted.recovery.phase === 'RESERVED') {
          await cancelUndispatchedPersisted(owner, persisted);
          return Object.freeze({ cleared: true });
        }
        var terminal = persisted.status.items.every(function (item) {
          return ['FAILED_FINAL', 'SUCCEEDED'].includes(item.intent.outcome);
        });
        if (!terminal) {
          fail('SS_ERP_BYOK_BATCH_REGISTRY_CLEAR_UNSAFE', 'UNKNOWN_OUTCOME');
        }
        try {
          await executionBatchClient.cancel({ batchId: persisted.recovery.executionBatchId });
        } catch {
          fail('SS_ERP_BYOK_BATCH_REGISTRY_CLEAR_UNSAFE', 'UNKNOWN_OUTCOME');
        }
        await clearPersistedOperation(owner, persisted.operation.idempotencyKey);
        return Object.freeze({ cleared: true });
      }
      if (!await safeCleanup(entry)) {
        fail('SS_ERP_BYOK_BATCH_REGISTRY_CLEAR_UNSAFE', 'UNKNOWN_OUTCOME');
      }
      entries.delete(key);
      return Object.freeze({ cleared: true });
    }

    async function clearAll(reasonValue) {
      text(reasonValue, 1, 100, 'SS_ERP_BYOK_BATCH_REGISTRY_REASON_INVALID');
      starting.forEach(function (key) { cleanupRequested.add(key); });
      var cleared = 0;
      for (const pair of Array.from(entries.entries())) {
        try {
          if (await safeCleanup(pair[1])) {
            entries.delete(pair[0]);
            cleared += 1;
          }
        } catch {}
      }
      return cleared;
    }

    async function removeTab(tabIdValue) {
      if (!Number.isSafeInteger(tabIdValue) || tabIdValue < 0) {
        fail('SS_ERP_BYOK_BATCH_REGISTRY_SENDER_INVALID');
      }
      var prefix = String(tabIdValue) + '\u0000';
      starting.forEach(function (key) {
        if (key.startsWith(prefix)) cleanupRequested.add(key);
      });
      var cleared = 0;
      for (const pair of Array.from(entries.entries())) {
        if (pair[1].owner.tabId !== tabIdValue) continue;
        try {
          if (await safeCleanup(pair[1])) {
            entries.delete(pair[0]);
            cleared += 1;
          }
        } catch {}
      }
      return cleared;
    }

    return Object.freeze({
      state: state,
      start: start,
      command: command,
      openPreview: openPreview,
      ingest: ingest,
      recover: recover,
      clear: clear,
      clearAll: clearAll,
      removeTab: removeTab,
    });
  }

  global.SS_ERP_BYOK_WORKBENCH_BATCH_REGISTRY = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    START_REQUEST_VERSION: START_REQUEST_VERSION,
    COMMAND_VERSION: COMMAND_VERSION,
    INGEST_VERSION: INGEST_VERSION,
    createRegistry: createRegistry,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
