(function exposeByokWorkbenchBatchCoordinator(global) {
  'use strict';

  var CONTRACT_VERSION = 'extension-byok-workbench-batch-coordinator/v1';
  var START_COMMAND_VERSION = 'extension-byok-workbench-batch-start/v1';
  var BINDING_VERSION = 'extension-byok-workbench-batch-binding/v1';
  var PROVIDER_DISPATCH_VERSION = 'extension-byok-workbench-batch-provider-dispatch/v1';
  var INGEST_COMMAND_VERSION = 'extension-byok-workbench-batch-ingest/v1';
  var ATOMIC_BATCH_RECEIPT_VERSION = 'extension-byok-media-batch-ingest-receipt/v1';
  var RESULT_BINDING_VERSION = 'extension-byok-readiness-binding/v2';
  var LIFECYCLE_VERSION = 'extension-byok-device-session-lifecycle/v1';
  var EXTERNAL_CHARGE_WARNING_VERSION = 'external-provider-charge/v1';
  var DUPLICATE_CHARGE_WARNING_VERSION = 'external-provider-duplicate-charge/v1';
  var MAX_SELECTED_SLOTS = 4;
  var SERIAL_REQUESTED_CONCURRENCY = 1;
  var OPERATIONS = ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'];
  var SOURCE_PLATFORMS = ['1688', 'pdd', 'taobao', 'tmall'];
  var SHARED_DETAIL_ROLES = ['SCENE', 'DETAIL', 'SPEC', 'PACKAGING'];
  var BINDING_KEYS = [
    'contractVersion', 'lifecycleAuthority', 'ownerUserId', 'deviceSessionId', 'shopId',
    'workflowId', 'draftRevision', 'draftVersion', 'sourcePlatform', 'sourceProductId',
    'sourceCaptureSnapshotId', 'supplyGoodsId', 'skuKey', 'providerOrigin', 'model',
    'policyRevision',
  ];
  var SLOT_KEYS = [
    'skuKey', 'slotKey', 'assignmentMode', 'assignmentOrdinal', 'operation', 'idempotencyKey',
    'intentHash', 'dispatchRef',
  ];
  var RESULT_BINDING_KEYS = [
    'contractVersion', 'ownerUserId', 'deviceSessionId', 'shopId', 'workflowId',
    'draftRevision', 'draftVersion', 'sourcePlatform', 'sourceProductId',
    'sourceCaptureSnapshotId', 'supplyGoodsId', 'skuKey', 'slotKey', 'assignmentMode',
    'assignmentOrdinal', 'providerOrigin', 'model', 'operation', 'policyRevision',
  ];
  var RECEIPT_KEYS = [
    'contractVersion', 'executionBatchId', 'replayed', 'receiptId', 'requestHash', 'sourceDraftRevision',
    'sourceDraftVersion', 'boundDraftRevision', 'boundDraftVersion',
    'erpAiChargeCents', 'items',
  ];
  var RECEIPT_ITEM_KEYS = [
    'assetId', 'provenanceId', 'executionIntentId', 'providerRequestHash',
    'providerResultSha256', 'normalizedSha256', 'mimeType', 'width', 'height',
    'skuKey', 'slotKey', 'assignmentOrdinal', 'assignmentSha256', 'assignment',
    'policyRevision',
  ];

  function coordinatorError(code, outcome, message) {
    var error = new Error(message || code);
    error.name = 'ExtensionByokWorkbenchBatchCoordinatorError';
    error.code = code;
    error.outcome = outcome || 'FAILED_FINAL';
    error.automaticRetryAllowed = error.outcome === 'FAILED_RETRYABLE';
    return error;
  }

  function invalid(message) {
    throw coordinatorError('SS_ERP_BYOK_BATCH_INPUT_INVALID', 'FAILED_FINAL', message);
  }

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function exactKeys(value, keys) {
    return isRecord(value)
      && Object.keys(value).length === keys.length
      && Object.keys(value).every(function (key) { return keys.includes(key); });
  }

  function canonicalText(value, minimum, maximum, label) {
    if (typeof value !== 'string') invalid(label + ' is invalid');
    var normalized = value.normalize('NFKC').trim();
    if (normalized !== value || normalized.length < minimum || normalized.length > maximum
      || Array.from(normalized).some(function (character) {
        var code = character.charCodeAt(0);
        return code < 32 || code === 127;
      })) invalid(label + ' is invalid');
    return normalized;
  }

  function identifier(value, label) {
    var normalized = canonicalText(value, 1, 200, label);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/u.test(normalized)) {
      invalid(label + ' is invalid');
    }
    return normalized;
  }

  function sha256(value, label) {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
      invalid(label + ' is invalid');
    }
    return value;
  }

  function positiveInteger(value, label) {
    if (!Number.isSafeInteger(value) || value < 1) invalid(label + ' is invalid');
    return value;
  }

  function assignmentOrdinal(value) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 499) {
      invalid('assignment ordinal is invalid');
    }
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

  function canonicalOrigin(value) {
    var normalized = canonicalText(value, 9, 300, 'Provider origin');
    var parsed;
    try { parsed = new global.URL(normalized); } catch {
      invalid('Provider origin is invalid');
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password
      || parsed.search || parsed.hash || parsed.pathname !== '/'
      || parsed.origin !== normalized) invalid('Provider origin is invalid');
    return normalized;
  }

  function normalizeLifecycleAuthority(value) {
    if (!exactKeys(value, ['contractVersion', 'epoch'])
      || value.contractVersion !== LIFECYCLE_VERSION
      || !Number.isSafeInteger(value.epoch) || value.epoch < 0) {
      invalid('lifecycle authority is invalid');
    }
    return Object.freeze({ contractVersion: LIFECYCLE_VERSION, epoch: value.epoch });
  }

  function normalizeBinding(value) {
    if (!exactKeys(value, BINDING_KEYS) || value.contractVersion !== BINDING_VERSION) {
      invalid('batch binding is invalid');
    }
    if (!SOURCE_PLATFORMS.includes(value.sourcePlatform)) {
      invalid('source platform is invalid');
    }
    var policyRevision = identifier(value.policyRevision, 'policy revision');
    if (!/^(?:0|[1-9][0-9]*)$/u.test(policyRevision)
      || !Number.isSafeInteger(Number(policyRevision))) invalid('policy revision is invalid');
    return Object.freeze({
      contractVersion: BINDING_VERSION,
      lifecycleAuthority: normalizeLifecycleAuthority(value.lifecycleAuthority),
      ownerUserId: canonicalText(value.ownerUserId, 1, 200, 'owner user ID'),
      deviceSessionId: canonicalText(value.deviceSessionId, 1, 200, 'device session ID'),
      shopId: canonicalText(value.shopId, 1, 200, 'shop ID'),
      workflowId: canonicalText(value.workflowId, 1, 200, 'workflow ID'),
      draftRevision: positiveInteger(value.draftRevision, 'draft revision'),
      draftVersion: positiveInteger(value.draftVersion, 'draft version'),
      sourcePlatform: value.sourcePlatform,
      sourceProductId: canonicalText(value.sourceProductId, 1, 200, 'source product ID'),
      sourceCaptureSnapshotId: canonicalText(
        value.sourceCaptureSnapshotId, 1, 200, 'source capture snapshot ID',
      ),
      supplyGoodsId: canonicalText(value.supplyGoodsId, 1, 200, 'supply goods ID'),
      skuKey: canonicalText(value.skuKey, 1, 500, 'SKU key'),
      providerOrigin: canonicalOrigin(value.providerOrigin),
      model: canonicalText(value.model, 1, 200, 'Provider model'),
      policyRevision: policyRevision,
    });
  }

  function normalizeSlot(value) {
    if (!exactKeys(value, SLOT_KEYS) || value.assignmentMode !== 'APPEND'
      || !OPERATIONS.includes(value.operation)) {
      invalid('batch slot is invalid');
    }
    return Object.freeze({
      skuKey: canonicalText(value.skuKey, 1, 500, 'SKU key'),
      slotKey: identifier(value.slotKey, 'slot key'),
      assignmentMode: 'APPEND',
      assignmentOrdinal: assignmentOrdinal(value.assignmentOrdinal),
      operation: value.operation,
      idempotencyKey: identifier(value.idempotencyKey, 'Provider idempotency key'),
      intentHash: sha256(value.intentHash, 'intent hash'),
      dispatchRef: identifier(value.dispatchRef, 'dispatch reference'),
    });
  }

  function normalizeStart(value) {
    if (!exactKeys(value, ['contractVersion', 'batchId', 'binding', 'slots'])
      || value.contractVersion !== START_COMMAND_VERSION
      || !Array.isArray(value.slots) || value.slots.length < 1
      || value.slots.length > MAX_SELECTED_SLOTS) invalid('batch start command is invalid');
    var binding = normalizeBinding(value.binding);
    var slots = value.slots.map(normalizeSlot);
    var firstAssignmentOrdinal = slots[0].assignmentOrdinal;
    if (slots.some(function (slot, index) {
      return slot.assignmentOrdinal !== firstAssignmentOrdinal + index;
    })) invalid('batch assignment ordinals must be absolute and consecutive');
    if (slots.some(function (slot) {
      var skuHero = slot.slotKey === 'sku:' + slot.skuKey + ':hero';
      var sharedDetail = slot.skuKey === binding.skuKey
        && SHARED_DETAIL_ROLES.some(function (role) {
          return slot.slotKey === 'shared:detail:' + role;
        });
      return !skuHero && !sharedDetail;
    })) invalid('batch slot is not supported by the exact binding');
    ['slotKey', 'idempotencyKey', 'dispatchRef'].forEach(function (field) {
      if (new Set(slots.map(function (slot) { return slot[field]; })).size !== slots.length) {
        invalid('batch slots must be unique');
      }
    });
    return Object.freeze({
      batchId: identifier(value.batchId, 'batch ID'),
      binding: binding,
      slots: Object.freeze(slots),
    });
  }

  function normalizeIngestCommand(value) {
    if (!exactKeys(value, ['contractVersion', 'idempotencyKey'])
      || value.contractVersion !== INGEST_COMMAND_VERSION) {
      invalid('batch ingest command is invalid');
    }
    var idempotencyKey = identifier(value.idempotencyKey, 'batch ingest idempotency key');
    if (idempotencyKey.length < 16) invalid('batch ingest idempotency key is invalid');
    return Object.freeze({ idempotencyKey: idempotencyKey });
  }

  function resultBinding(binding, slot) {
    return Object.freeze({
      contractVersion: RESULT_BINDING_VERSION,
      ownerUserId: binding.ownerUserId,
      deviceSessionId: binding.deviceSessionId,
      shopId: binding.shopId,
      workflowId: binding.workflowId,
      draftRevision: binding.draftRevision,
      draftVersion: binding.draftVersion,
      sourcePlatform: binding.sourcePlatform,
      sourceProductId: binding.sourceProductId,
      sourceCaptureSnapshotId: binding.sourceCaptureSnapshotId,
      supplyGoodsId: binding.supplyGoodsId,
      skuKey: slot.skuKey,
      slotKey: slot.slotKey,
      assignmentMode: 'APPEND',
      assignmentOrdinal: slot.assignmentOrdinal,
      providerOrigin: binding.providerOrigin,
      model: binding.model,
      operation: slot.operation,
      policyRevision: binding.policyRevision,
    });
  }

  function sameResultBinding(left, right) {
    return isRecord(left) && RESULT_BINDING_KEYS.every(function (key) {
      return left[key] === right[key];
    }) && Object.keys(left).length === RESULT_BINDING_KEYS.length;
  }

  function safeErrorCode(value, fallback) {
    return typeof value === 'string' && /^[A-Z][A-Z0-9_.:-]{0,99}$/u.test(value)
      ? value
      : fallback;
  }

  function normalizeDependencyError(error) {
    var outcome = error && error.outcome;
    if (!['FAILED_RETRYABLE', 'FAILED_FINAL', 'UNKNOWN_OUTCOME'].includes(outcome)) {
      outcome = 'UNKNOWN_OUTCOME';
    }
    return coordinatorError(
      safeErrorCode(error && error.code, 'SS_ERP_BYOK_BATCH_INGEST_FAILED'),
      outcome,
    );
  }

  function normalizeReceiptAssignment(value, expected, assetId) {
    var source = ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE'].includes(expected.slot.operation)
      ? 'GENERATED'
      : 'EDITED';
    if (expected.slot.slotKey === 'sku:' + expected.approved.binding.skuKey + ':hero') {
      if (!exactKeys(value, ['scope', 'skuKey', 'slotKey', 'assetId', 'source'])
        || value.scope !== 'SKU' || value.skuKey !== expected.approved.binding.skuKey
        || value.slotKey !== expected.slot.slotKey || value.assetId !== assetId
        || value.source !== source) throw coordinatorError(
        'SS_ERP_BYOK_BATCH_RECEIPT_INVALID', 'UNKNOWN_OUTCOME',
        'Atomic batch SKU assignment is invalid',
      );
      return Object.freeze({
        scope: 'SKU', skuKey: value.skuKey, slotKey: value.slotKey,
        assetId: assetId, source: source,
      });
    }
    if (!exactKeys(value, ['scope', 'slotKey', 'assetId', 'source'])
      || value.scope !== 'PRODUCT' || value.slotKey !== expected.slot.slotKey
      || value.assetId !== assetId || value.source !== source) throw coordinatorError(
      'SS_ERP_BYOK_BATCH_RECEIPT_INVALID', 'UNKNOWN_OUTCOME',
      'Atomic batch product assignment is invalid',
    );
    return Object.freeze({
      scope: 'PRODUCT', slotKey: value.slotKey, assetId: assetId, source: source,
    });
  }

  function normalizeReceiptItem(value, expected) {
    if (!exactKeys(value, RECEIPT_ITEM_KEYS) || typeof value.assetId !== 'string'
      || value.assetId.length < 1 || value.assetId.length > 200
      || typeof value.provenanceId !== 'string' || value.provenanceId.length < 1
      || value.provenanceId.length > 200
      || typeof value.executionIntentId !== 'string'
      || value.executionIntentId !== expected.approved.executionIntentId
      || value.providerRequestHash !== expected.attempt.providerRequestHash
      || value.providerResultSha256 !== expected.attempt.resultSha256
      || !/^[a-f0-9]{64}$/u.test(String(value.providerRequestHash || ''))
      || !/^[a-f0-9]{64}$/u.test(String(value.providerResultSha256 || ''))
      || !/^[a-f0-9]{64}$/u.test(String(value.normalizedSha256 || ''))
      || !['image/png', 'image/jpeg', 'image/webp'].includes(value.mimeType)
      || !Number.isSafeInteger(value.width) || value.width < 1
      || !Number.isSafeInteger(value.height) || value.height < 1
      || value.assignmentOrdinal !== expected.approved.binding.assignmentOrdinal
      || !/^[a-f0-9]{64}$/u.test(String(value.assignmentSha256 || ''))
      || value.skuKey !== expected.approved.binding.skuKey
      || value.slotKey !== expected.slot.slotKey
      || value.policyRevision !== expected.approved.binding.policyRevision) {
      throw coordinatorError(
        'SS_ERP_BYOK_BATCH_RECEIPT_INVALID', 'UNKNOWN_OUTCOME',
        'Atomic batch receipt item is invalid',
      );
    }
    var assetId = identifier(value.assetId, 'asset ID');
    return Object.freeze({
      assetId: assetId,
      provenanceId: identifier(value.provenanceId, 'provenance ID'),
      executionIntentId: identifier(value.executionIntentId, 'execution intent ID'),
      providerRequestHash: value.providerRequestHash,
      providerResultSha256: value.providerResultSha256,
      normalizedSha256: value.normalizedSha256,
      mimeType: value.mimeType,
      width: value.width,
      height: value.height,
      assignmentOrdinal: value.assignmentOrdinal,
      assignmentSha256: value.assignmentSha256,
      assignment: normalizeReceiptAssignment(value.assignment, expected, assetId),
      skuKey: value.skuKey,
      slotKey: value.slotKey,
      policyRevision: identifier(value.policyRevision, 'policy revision'),
    });
  }

  function normalizeReceipt(value, expected) {
    if (!exactKeys(value, RECEIPT_KEYS)
      || value.contractVersion !== ATOMIC_BATCH_RECEIPT_VERSION
      || value.executionBatchId !== expected.executionBatchId
      || typeof value.replayed !== 'boolean'
      || typeof value.receiptId !== 'string' || value.receiptId.length < 1
      || value.receiptId.length > 200
      || !/^[a-f0-9]{64}$/u.test(String(value.requestHash || ''))
      || value.sourceDraftRevision !== expected.binding.draftRevision
      || value.sourceDraftVersion !== expected.binding.draftVersion
      || value.boundDraftRevision !== value.sourceDraftRevision + 1
      || value.boundDraftVersion !== value.sourceDraftVersion + 1
      || value.erpAiChargeCents !== 0 || !Array.isArray(value.items)
      || value.items.length !== expected.selected.length) {
      throw coordinatorError(
        'SS_ERP_BYOK_BATCH_RECEIPT_INVALID', 'UNKNOWN_OUTCOME',
        'Atomic batch receipt is invalid',
      );
    }
    var items = value.items.map(function (item, index) {
      return normalizeReceiptItem(item, expected.selected[index]);
    });
    [
      'assetId', 'provenanceId', 'executionIntentId', 'providerRequestHash',
      'providerResultSha256', 'normalizedSha256', 'assignmentSha256',
    ].forEach(
      function (field) {
        if (new Set(items.map(function (item) { return item[field]; })).size !== items.length) {
          throw coordinatorError(
            'SS_ERP_BYOK_BATCH_RECEIPT_INVALID', 'UNKNOWN_OUTCOME',
            'Atomic batch receipt identities are not unique',
          );
        }
      },
    );
    return deepFreeze({
      contractVersion: ATOMIC_BATCH_RECEIPT_VERSION,
      executionBatchId: expected.executionBatchId,
      replayed: value.replayed,
      receiptId: identifier(value.receiptId, 'batch receipt ID'),
      requestHash: value.requestHash,
      sourceDraftRevision: value.sourceDraftRevision,
      sourceDraftVersion: value.sourceDraftVersion,
      boundDraftRevision: value.boundDraftRevision,
      boundDraftVersion: value.boundDraftVersion,
      erpAiChargeCents: 0,
      items: items,
    });
  }

  function createCoordinator(options) {
    var optionKeys = [
      'mediaJobEngine', 'providerExecutor', 'resultVault', 'atomicBatchIngest',
      'requestedConcurrency', 'concurrencyAuthority', 'runnerMaxConcurrency',
      'resolveDispatchInput', 'resolveRecovery',
    ];
    if (!exactKeys(options, optionKeys)
      || options.requestedConcurrency !== SERIAL_REQUESTED_CONCURRENCY) {
      invalid('batch coordinator options are invalid');
    }
    var mediaJobEngine = options.mediaJobEngine;
    var providerExecutor = options.providerExecutor;
    var resultVault = options.resultVault;
    var atomicBatchIngest = options.atomicBatchIngest;
    if (!mediaJobEngine || typeof mediaJobEngine.createEngine !== 'function'
      || mediaJobEngine.EXTERNAL_CHARGE_WARNING_VERSION !== EXTERNAL_CHARGE_WARNING_VERSION
      || mediaJobEngine.DUPLICATE_CHARGE_WARNING_VERSION !== DUPLICATE_CHARGE_WARNING_VERSION
      || !providerExecutor || typeof providerExecutor.execute !== 'function'
      || !resultVault || typeof resultVault.getPublic !== 'function'
      || typeof resultVault.getApprovedForBackground !== 'function'
      || typeof resultVault.pinSelection !== 'function'
      || typeof resultVault.unpinSelection !== 'function'
      || typeof resultVault.approve !== 'function' || typeof resultVault.reject !== 'function'
      || !atomicBatchIngest || typeof atomicBatchIngest.ingest !== 'function'
      || typeof atomicBatchIngest.recover !== 'function'
      || typeof options.resolveDispatchInput !== 'function'
      || typeof options.resolveRecovery !== 'function') {
      invalid('batch coordinator dependencies are invalid');
    }

    var active = null;
    var listeners = new Set();
    var engine;
    var engineUnsubscribe = null;

    function requireActive() {
      if (!active) throw coordinatorError(
        'SS_ERP_BYOK_BATCH_NOT_STARTED', 'FAILED_FINAL', 'BYOK batch is not started',
      );
      return active;
    }

    function findSlot(slotKeyValue) {
      var state = requireActive();
      var slotKey = identifier(slotKeyValue, 'slot key');
      var slot = state.slotByKey.get(slotKey);
      if (!slot) throw coordinatorError(
        'SS_ERP_BYOK_BATCH_SLOT_NOT_FOUND', 'FAILED_FINAL', 'BYOK batch slot is unavailable',
      );
      return slot;
    }

    function ensureReviewMutable() {
      var state = requireActive();
      if (state.ingest.state !== 'NOT_STARTED') throw coordinatorError(
        'SS_ERP_BYOK_BATCH_INGEST_LOCKED', 'FAILED_FINAL',
        'BYOK batch review is locked after ingest starts',
      );
      return state;
    }

    function attemptsForSlot(slotKey) {
      return engine.getSnapshot().attempts.filter(function (attempt) {
        return attempt.slotKey === slotKey;
      });
    }

    function unknownInSlot(slotKey) {
      return attemptsForSlot(slotKey).some(function (attempt) {
        return attempt.state === 'UNKNOWN_OUTCOME'
          && !active.retiredUnknownAttemptIds.has(attempt.attemptId);
      });
    }

    function anyUnknown() {
      return engine.getSnapshot().attempts.some(function (attempt) {
        return attempt.state === 'UNKNOWN_OUTCOME'
          && !active.retiredUnknownAttemptIds.has(attempt.attemptId);
      });
    }

    function assertNoUnknown(slotKey) {
      if (slotKey ? unknownInSlot(slotKey) : anyUnknown()) throw coordinatorError(
        'SS_ERP_BYOK_BATCH_UNKNOWN_OUTCOME_LOCKED', 'UNKNOWN_OUTCOME',
        'Unknown Provider outcome requires explicit recovery',
      );
    }

    function publicAttempt(attempt, selectedAttemptId, rejected) {
      var unknownOutcomeSuperseded = attempt.state === 'UNKNOWN_OUTCOME'
        && active.retiredUnknownAttemptIds.has(attempt.attemptId);
      var reviewState = unknownOutcomeSuperseded
        ? 'SUPERSEDED_UNKNOWN'
        : rejected
        ? 'REJECTED'
        : attempt.attemptId === selectedAttemptId ? 'KEPT'
          : attempt.state === 'CANDIDATE_READY' ? 'AVAILABLE' : 'NOT_READY';
      var warningVersion = null;
      if (attempt.externalChargePossible) {
        warningVersion = attempt.retryRisk === 'DUPLICATE_CHARGE_ACCEPTED'
          ? DUPLICATE_CHARGE_WARNING_VERSION
          : EXTERNAL_CHARGE_WARNING_VERSION;
      }
      return {
        attemptId: attempt.attemptId,
        generation: attempt.generation,
        operation: attempt.operation,
        intentHash: attempt.intentHash,
        state: attempt.state,
        resultId: rejected ? null : attempt.resultHandle,
        resultSha256: rejected ? null : attempt.resultSha256,
        errorCode: attempt.errorCode,
        retryOfAttemptId: attempt.retryOfAttemptId,
        externalChargePossible: attempt.externalChargePossible,
        retryRisk: attempt.retryRisk,
        chargeWarningVersion: warningVersion,
        automaticRetryAllowed: attempt.automaticRetryAllowed,
        recoveryRequirement: attempt.recoveryRequirement,
        unknownOutcomeSuperseded: unknownOutcomeSuperseded,
        reviewState: reviewState,
      };
    }

    function publicSlot(slot, snapshot) {
      var state = requireActive();
      var projected = snapshot.slots.find(function (candidate) {
        return candidate.slotKey === slot.slotKey;
      });
      var attempts = snapshot.attempts.filter(function (attempt) {
        return attempt.slotKey === slot.slotKey;
      });
      var selectedAttemptId = projected && projected.selectedAttemptId;
      if (selectedAttemptId && state.rejectedAttemptIds.has(selectedAttemptId)) {
        selectedAttemptId = null;
      }
      var publicAttempts = attempts.map(function (attempt) {
        return publicAttempt(
          attempt,
          selectedAttemptId,
          state.rejectedAttemptIds.has(attempt.attemptId),
        );
      });
      var slotState = 'EMPTY';
      if (attempts.some(function (attempt) {
        return attempt.state === 'UNKNOWN_OUTCOME'
          && !state.retiredUnknownAttemptIds.has(attempt.attemptId);
      })) {
        slotState = 'UNKNOWN_OUTCOME';
      } else if (selectedAttemptId) {
        slotState = attempts.find(function (attempt) {
          return attempt.attemptId === selectedAttemptId;
        }).state;
      } else if (publicAttempts.length) {
        var latest = publicAttempts[publicAttempts.length - 1];
        slotState = latest.reviewState === 'REJECTED' ? 'REJECTED' : latest.state;
      }
      var selected = publicAttempts.find(function (attempt) {
        return attempt.attemptId === selectedAttemptId;
      });
      return {
        slotKey: slot.slotKey,
        skuKey: slot.skuKey,
        assignmentOrdinal: slot.assignmentOrdinal,
        operation: slot.operation,
        revision: projected ? projected.revision : 0,
        state: slotState,
        selectedAttemptId: selectedAttemptId || null,
        selectedResultId: selected ? selected.resultId : null,
        attempts: publicAttempts,
      };
    }

    function publicIngest() {
      var ingest = active.ingest;
      return {
        state: ingest.state,
        idempotencyKey: ingest.idempotencyKey,
        replayed: ingest.receipt ? ingest.receipt.replayed : null,
        receiptId: ingest.receipt ? ingest.receipt.receiptId : null,
        requestHash: ingest.receipt ? ingest.receipt.requestHash : null,
        boundDraftRevision: ingest.receipt ? ingest.receipt.boundDraftRevision : null,
        boundDraftVersion: ingest.receipt ? ingest.receipt.boundDraftVersion : null,
        erpGenerationChargeCents: 0,
        rebootstrapRequired: ingest.state === 'SUCCEEDED',
        receipt: ingest.receipt ? clone(ingest.receipt) : null,
        assignments: ingest.assignments.map(clone),
        errorCode: ingest.errorCode,
      };
    }

    function getProjection() {
      if (!active) return deepFreeze({
        contractVersion: CONTRACT_VERSION,
        executionMode: 'BYOK',
        revision: 0,
        batchId: null,
        binding: null,
        scheduler: null,
        billing: { erpGenerationChargeCents: 0 },
        slots: [],
        ingest: null,
      });
      var snapshot = engine.getSnapshot();
      return deepFreeze({
        contractVersion: CONTRACT_VERSION,
        executionMode: 'BYOK',
        revision: active.revision,
        batchId: active.batchId,
        binding: {
          shopId: active.binding.shopId,
          workflowId: active.binding.workflowId,
          draftRevision: active.currentDraftRevision,
          draftVersion: active.currentDraftVersion,
          skuKey: active.binding.skuKey,
        },
        scheduler: {
          state: snapshot.schedulerState,
          activeCount: snapshot.activeCount,
          queuedCount: snapshot.queuedCount,
          pauseRequested: snapshot.pauseRequested,
          effectiveConcurrency: snapshot.effectiveConcurrency,
        },
        billing: { erpGenerationChargeCents: 0 },
        slots: active.slots.map(function (slot) { return publicSlot(slot, snapshot); }),
        ingest: publicIngest(),
      });
    }

    function emit() {
      if (!active) return;
      active.revision += 1;
      if (!listeners.size) return;
      var projection = getProjection();
      listeners.forEach(function (listener) {
        try { listener(projection); } catch {}
      });
    }

    async function dispatchProvider(input) {
      var state = requireActive();
      var slot = state.slotByKey.get(input.slotKey);
      if (!slot) throw coordinatorError(
        'SS_ERP_BYOK_BATCH_SLOT_NOT_FOUND', 'FAILED_FINAL', 'Provider slot is unavailable',
      );
      var binding = resultBinding(state.binding, slot);
      var result = await providerExecutor.execute(Object.freeze({
        contractVersion: PROVIDER_DISPATCH_VERSION,
        batchId: state.batchId,
        resultBinding: binding,
        attempt: Object.freeze({
          attemptId: input.attemptId,
          slotKey: input.slotKey,
          generation: input.generation,
          operation: input.operation,
          executionMode: input.executionMode,
          policyRevision: input.policyRevision,
          idempotencyKey: input.idempotencyKey,
          intentHash: input.intentHash,
          retryOfAttemptId: input.retryOfAttemptId,
          retryRisk: input.retryRisk,
        }),
        dispatchInput: input.dispatchInput,
        markWaiting: input.markWaiting,
      }));
      try {
        var publicResult = resultVault.getPublic(result && result.resultHandle);
        if (!publicResult || publicResult.resultId !== result.resultHandle
          || publicResult.outcome !== 'SUCCEEDED' || publicResult.operation !== input.operation
          || publicResult.model !== state.binding.model
          || publicResult.policyRevision !== state.binding.policyRevision
          || publicResult.idempotencyKey !== input.idempotencyKey
          || publicResult.requestHash !== result.requestHash
          || !publicResult.image || publicResult.image.sha256 !== result.resultSha256
          || publicResult.reviewState !== 'CANDIDATE_READY') throw new Error('result mismatch');
      } catch {
        throw coordinatorError(
          'SS_ERP_BYOK_BATCH_PROVIDER_RESULT_INVALID', 'UNKNOWN_OUTCOME',
          'Provider result did not match its retained vault entry',
        );
      }
      return result;
    }

    engine = mediaJobEngine.createEngine({
      executionMode: 'BYOK',
      requestedConcurrency: options.requestedConcurrency,
      concurrencyAuthority: Object.freeze({
        policyRevision: options.concurrencyAuthority.policyRevision,
        maxConcurrency: options.concurrencyAuthority.maxConcurrency,
      }),
      runnerMaxConcurrency: options.runnerMaxConcurrency,
      resultRetention: {
        pin: function (resultId) { return resultVault.pinSelection(resultId); },
        unpin: function (resultId) { return resultVault.unpinSelection(resultId); },
      },
      dispatch: dispatchProvider,
      resolveDispatchInput: options.resolveDispatchInput,
      resolveRecovery: options.resolveRecovery,
    });
    engineUnsubscribe = engine.subscribe(function () { emit(); });

    function startBatch(value) {
      if (active) throw coordinatorError(
        'SS_ERP_BYOK_BATCH_ALREADY_STARTED', 'FAILED_FINAL',
        'A coordinator owns exactly one immutable BYOK batch',
      );
      var normalized = normalizeStart(value);
      if (normalized.binding.policyRevision !== String(options.concurrencyAuthority.policyRevision)) {
        invalid('batch policy revision does not match concurrency authority');
      }
      active = {
        batchId: normalized.batchId,
        binding: normalized.binding,
        slots: normalized.slots,
        slotByKey: new Map(normalized.slots.map(function (slot) { return [slot.slotKey, slot]; })),
        rejectedAttemptIds: new Set(),
        retiredUnknownAttemptIds: new Set(),
        unknownRetryInFlightIds: new Set(),
        currentDraftRevision: normalized.binding.draftRevision,
        currentDraftVersion: normalized.binding.draftVersion,
        revision: 1,
        ingest: {
          state: 'NOT_STARTED', idempotencyKey: null, selectionBasis: null,
          receipt: null, assignments: [], errorCode: null, promise: null,
          selected: null, request: null,
        },
      };
      try {
        engine.enqueueBatch(normalized.slots.map(function (slot) {
          return {
            slotKey: slot.slotKey,
            operation: slot.operation,
            idempotencyKey: slot.idempotencyKey,
            intentHash: slot.intentHash,
            dispatchRef: slot.dispatchRef,
          };
        }));
      } catch (error) {
        active = null;
        throw error;
      }
      emit();
      return getProjection();
    }

    function pause() {
      ensureReviewMutable();
      engine.pause();
      return getProjection();
    }

    function continueBatch() {
      ensureReviewMutable();
      engine.continue();
      return getProjection();
    }

    function cancelQueued(attemptIdValue) {
      ensureReviewMutable();
      var result = engine.cancelQueued(identifier(attemptIdValue, 'attempt ID'));
      return deepFreeze({
        cancelled: result.cancelled,
        attemptId: result.attemptId,
        projection: getProjection(),
      });
    }

    function requireCandidate(slotKeyValue, attemptIdValue) {
      var slot = findSlot(slotKeyValue);
      assertNoUnknown(slot.slotKey);
      var attemptId = identifier(attemptIdValue, 'attempt ID');
      var attempt = engine.getAttempt(attemptId);
      if (!attempt || attempt.slotKey !== slot.slotKey || attempt.state !== 'CANDIDATE_READY'
        || !attempt.resultHandle) throw coordinatorError(
        'SS_ERP_BYOK_BATCH_REVIEW_INVALID', 'FAILED_FINAL',
        'Only a retained candidate can be reviewed',
      );
      return { slot: slot, attempt: attempt };
    }

    function keepAttempt(slotKeyValue, attemptIdValue) {
      var state = ensureReviewMutable();
      var selected = requireCandidate(slotKeyValue, attemptIdValue);
      if (state.rejectedAttemptIds.has(selected.attempt.attemptId)) throw coordinatorError(
        'SS_ERP_BYOK_BATCH_REVIEW_INVALID', 'FAILED_FINAL',
        'A rejected candidate cannot be selected',
      );
      resultVault.getPublic(selected.attempt.resultHandle);
      engine.selectCandidate(selected.slot.slotKey, selected.attempt.attemptId);
      emit();
      return getProjection();
    }

    function rejectAttempt(slotKeyValue, attemptIdValue) {
      var state = ensureReviewMutable();
      var selected = requireCandidate(slotKeyValue, attemptIdValue);
      if (state.rejectedAttemptIds.has(selected.attempt.attemptId)) return getProjection();
      resultVault.reject(
        selected.attempt.resultHandle,
        resultBinding(state.binding, selected.slot),
      );
      state.rejectedAttemptIds.add(selected.attempt.attemptId);
      emit();
      return getProjection();
    }

    function regenerateSlot(slotKeyValue, value) {
      ensureReviewMutable();
      var slot = findSlot(slotKeyValue);
      assertNoUnknown(slot.slotKey);
      if (!isRecord(value) || value.slotKey !== slot.slotKey || value.operation !== slot.operation) {
        invalid('regeneration must preserve the exact slot operation');
      }
      engine.regenerate(slot.slotKey, value);
      return getProjection();
    }

    async function retryAttempt(attemptIdValue, value) {
      ensureReviewMutable();
      var attemptId = identifier(attemptIdValue, 'attempt ID');
      var attempt = engine.getAttempt(attemptId);
      if (!attempt || !active.slotByKey.has(attempt.slotKey)) throw coordinatorError(
        'SS_ERP_BYOK_BATCH_RETRY_INVALID', 'FAILED_FINAL', 'Retry attempt is unavailable',
      );
      if (active.retiredUnknownAttemptIds.has(attemptId)
        || active.unknownRetryInFlightIds.has(attemptId)) throw coordinatorError(
        'SS_ERP_BYOK_BATCH_UNKNOWN_ATTEMPT_RETIRED', 'FAILED_FINAL',
        'A consumed unknown Provider attempt cannot be retried again',
      );
      var retiresUnknown = attempt.state === 'UNKNOWN_OUTCOME';
      if (retiresUnknown) active.unknownRetryInFlightIds.add(attemptId);
      try {
        await engine.retryAttempt(attemptId, value);
        if (retiresUnknown) active.retiredUnknownAttemptIds.add(attemptId);
      } finally {
        if (retiresUnknown) active.unknownRetryInFlightIds.delete(attemptId);
      }
      emit();
      return getProjection();
    }

    async function resolveUnknownAttempt(attemptIdValue, recoveryRefValue) {
      ensureReviewMutable();
      var attemptId = identifier(attemptIdValue, 'attempt ID');
      var attempt = engine.getAttempt(attemptId);
      if (!attempt || !active.slotByKey.has(attempt.slotKey)) throw coordinatorError(
        'SS_ERP_BYOK_BATCH_UNKNOWN_RESOLUTION_INVALID', 'FAILED_FINAL',
        'Unknown attempt is unavailable',
      );
      if (active.retiredUnknownAttemptIds.has(attemptId)
        || active.unknownRetryInFlightIds.has(attemptId)) throw coordinatorError(
        'SS_ERP_BYOK_BATCH_UNKNOWN_ATTEMPT_RETIRED', 'FAILED_FINAL',
        'A consumed unknown Provider attempt cannot be resolved again',
      );
      await engine.resolveUnknownAttempt(attemptId, recoveryRefValue);
      return getProjection();
    }

    function validateApproved(selected) {
      var binding = resultBinding(active.binding, selected.slot);
      resultVault.approve(selected.attempt.resultHandle, binding);
      var approved = resultVault.getApprovedForBackground(selected.attempt.resultHandle);
      if (!approved || approved.resultId !== selected.attempt.resultHandle
        || approved.reviewState !== 'APPROVED'
        || approved.idempotencyKey !== selected.attempt.idempotencyKey
        || approved.requestHash !== selected.attempt.providerRequestHash
        || approved.sha256 !== selected.attempt.resultSha256
        || !identifier(approved.executionIntentId, 'execution intent ID')
        || !sameResultBinding(approved.binding, binding)
        || !global.Blob || !(approved.blob instanceof global.Blob)
        || approved.blob.size < 1) throw coordinatorError(
        'SS_ERP_BYOK_BATCH_APPROVED_RESULT_INVALID', 'FAILED_FINAL',
        'Approved result does not match the selected Provider attempt',
      );
      return { slot: selected.slot, attempt: selected.attempt, approved: approved };
    }

    function collectSelected() {
      var snapshot = engine.getSnapshot();
      if (snapshot.activeCount !== 0 || snapshot.queuedCount !== 0
        || ['RUNNING', 'PAUSING', 'PAUSED'].includes(snapshot.schedulerState)) {
        throw coordinatorError(
          'SS_ERP_BYOK_BATCH_NOT_SETTLED', 'FAILED_RETRYABLE',
          'All selected Provider jobs must settle before ingest',
        );
      }
      assertNoUnknown();
      var selected = active.slots.map(function (slot) {
        var projected = snapshot.slots.find(function (candidate) {
          return candidate.slotKey === slot.slotKey;
        });
        var attempt = projected && projected.selectedAttemptId
          ? engine.getAttempt(projected.selectedAttemptId)
          : null;
        if (!attempt || active.rejectedAttemptIds.has(attempt.attemptId)
          || attempt.state !== 'CANDIDATE_READY' || !attempt.resultHandle) {
          throw coordinatorError(
            'SS_ERP_BYOK_BATCH_SELECTION_INCOMPLETE', 'FAILED_FINAL',
            'Every selected batch slot requires one kept Provider result',
          );
        }
        return validateApproved({ slot: slot, attempt: attempt });
      });
      var firstAssignmentOrdinal = selected[0].approved.binding.assignmentOrdinal;
      if (selected.some(function (item, index) {
        return item.approved.binding.assignmentOrdinal !== firstAssignmentOrdinal + index;
      })) throw coordinatorError(
        'SS_ERP_BYOK_BATCH_APPROVED_RESULT_INVALID', 'FAILED_FINAL',
        'Approved result ordinals must be absolute and consecutive',
      );
      return selected;
    }

    function selectionBasis(selected) {
      return JSON.stringify(selected.map(function (item) {
        return {
          slotKey: item.slot.slotKey,
          assignmentOrdinal: item.approved.binding.assignmentOrdinal,
          attemptId: item.attempt.attemptId,
          resultId: item.attempt.resultHandle,
          resultSha256: item.attempt.resultSha256,
          providerRequestHash: item.attempt.providerRequestHash,
          executionIntentId: item.approved.executionIntentId,
        };
      }));
    }

    function runtimeAuthority() {
      return Object.freeze({
        lifecycleAuthority: active.binding.lifecycleAuthority,
        ownerUserId: active.binding.ownerUserId,
        deviceSessionId: active.binding.deviceSessionId,
        shopId: active.binding.shopId,
        workflowId: active.binding.workflowId,
        draftRevision: active.binding.draftRevision,
        draftVersion: active.binding.draftVersion,
        policyRevision: active.binding.policyRevision,
      });
    }

    function receiptAssignments(receipt, selected) {
      return receipt.items.map(function (item, index) {
        var source = selected[index];
        return {
          slotKey: item.slotKey,
          skuKey: item.skuKey,
          assignmentOrdinal: item.assignmentOrdinal,
          attemptId: source.attempt.attemptId,
          resultId: source.attempt.resultHandle,
          resultSha256: source.attempt.resultSha256,
          assetId: item.assetId,
          provenanceId: item.provenanceId,
          executionIntentId: item.executionIntentId,
          providerRequestHash: item.providerRequestHash,
          providerResultSha256: item.providerResultSha256,
          normalizedSha256: item.normalizedSha256,
          assignmentSha256: item.assignmentSha256,
          assignment: clone(item.assignment),
          policyRevision: item.policyRevision,
          mimeType: item.mimeType,
          width: item.width,
          height: item.height,
        };
      });
    }

    async function ingestSelectedBatch(value) {
      var state = requireActive();
      var command = normalizeIngestCommand(value);
      var ingest = state.ingest;
      if (ingest.idempotencyKey && ingest.idempotencyKey !== command.idempotencyKey) {
        throw coordinatorError(
          'SS_ERP_BYOK_BATCH_INGEST_IDEMPOTENCY_CONFLICT', 'FAILED_FINAL',
          'Batch ingest idempotency key is already bound',
        );
      }
      if (ingest.state === 'SUCCEEDED') return getProjection();
      if (ingest.state === 'UNKNOWN_OUTCOME') throw coordinatorError(
        'SS_ERP_BYOK_BATCH_INGEST_UNKNOWN_OUTCOME', 'UNKNOWN_OUTCOME',
        'Atomic batch ingest outcome requires status recovery',
      );
      if (ingest.state === 'FAILED_FINAL') throw coordinatorError(
        ingest.errorCode || 'SS_ERP_BYOK_BATCH_INGEST_FAILED', 'FAILED_FINAL',
      );
      if (ingest.promise) return ingest.promise;

      var selected = collectSelected();
      var basis = selectionBasis(selected);
      if (ingest.selectionBasis && ingest.selectionBasis !== basis) throw coordinatorError(
        'SS_ERP_BYOK_BATCH_SELECTION_CHANGED', 'FAILED_FINAL',
        'Batch selection changed after ingest was prepared',
      );
      ingest.idempotencyKey = command.idempotencyKey;
      ingest.selectionBasis = basis;
      ingest.state = 'SUBMITTING';
      ingest.errorCode = null;
      emit();

      var request = Object.freeze({
        executionBatchId: state.batchId,
        resultIds: Object.freeze(selected.map(function (item) {
          return item.attempt.resultHandle;
        })),
        shopId: state.binding.shopId,
        workflowId: state.binding.workflowId,
        draftRevision: state.binding.draftRevision,
        draftVersion: state.binding.draftVersion,
        idempotencyKey: command.idempotencyKey,
      });
      ingest.selected = selected;
      ingest.request = request;
      ingest.promise = (async function () {
        try {
          var rawReceipt = await atomicBatchIngest.ingest(request, runtimeAuthority());
          var receipt;
          try {
            receipt = normalizeReceipt(rawReceipt, {
              executionBatchId: state.batchId,
              binding: state.binding,
              selected: selected,
            });
          } catch {
            throw coordinatorError(
              'SS_ERP_BYOK_BATCH_RECEIPT_INVALID', 'UNKNOWN_OUTCOME',
              'Atomic batch receipt is invalid',
            );
          }
          ingest.receipt = receipt;
          ingest.assignments = receiptAssignments(receipt, selected);
          ingest.state = 'SUCCEEDED';
          ingest.errorCode = null;
          state.currentDraftRevision = receipt.boundDraftRevision;
          state.currentDraftVersion = receipt.boundDraftVersion;
          emit();
          return getProjection();
        } catch (error) {
          var safeError = error && error.name === 'ExtensionByokWorkbenchBatchCoordinatorError'
            ? error
            : normalizeDependencyError(error);
          ingest.state = safeError.outcome;
          ingest.errorCode = safeError.code;
          emit();
          throw safeError;
        } finally {
          ingest.promise = null;
        }
      }());
      return ingest.promise;
    }

    async function recoverIngest(value) {
      var state = requireActive();
      var command = normalizeIngestCommand(value);
      var ingest = state.ingest;
      if (ingest.idempotencyKey !== command.idempotencyKey
        || !ingest.request || !Array.isArray(ingest.selected)) {
        throw coordinatorError(
          'SS_ERP_BYOK_BATCH_INGEST_RECOVERY_INVALID', 'FAILED_FINAL',
          'Batch ingest recovery identity is unavailable',
        );
      }
      if (ingest.state === 'SUCCEEDED') return getProjection();
      if (ingest.state !== 'UNKNOWN_OUTCOME') throw coordinatorError(
        'SS_ERP_BYOK_BATCH_INGEST_RECOVERY_INVALID', 'FAILED_FINAL',
        'Only an unknown atomic ingest may use status recovery',
      );
      if (ingest.promise) return ingest.promise;
      ingest.state = 'RECOVERING';
      ingest.errorCode = null;
      emit();
      ingest.promise = (async function () {
        try {
          var rawReceipt = await atomicBatchIngest.recover(
            ingest.request,
            runtimeAuthority(),
          );
          var receipt;
          try {
            receipt = normalizeReceipt(rawReceipt, {
              executionBatchId: state.batchId,
              binding: state.binding,
              selected: ingest.selected,
            });
          } catch {
            throw coordinatorError(
              'SS_ERP_BYOK_BATCH_RECEIPT_INVALID', 'UNKNOWN_OUTCOME',
              'Recovered atomic batch receipt is invalid',
            );
          }
          ingest.receipt = receipt;
          ingest.assignments = receiptAssignments(receipt, ingest.selected);
          ingest.state = 'SUCCEEDED';
          ingest.errorCode = null;
          state.currentDraftRevision = receipt.boundDraftRevision;
          state.currentDraftVersion = receipt.boundDraftVersion;
          emit();
          return getProjection();
        } catch (error) {
          var safeError = error && error.name === 'ExtensionByokWorkbenchBatchCoordinatorError'
            ? error
            : normalizeDependencyError(error);
          ingest.state = safeError.outcome === 'FAILED_FINAL'
            ? 'FAILED_FINAL' : 'UNKNOWN_OUTCOME';
          ingest.errorCode = safeError.code;
          emit();
          throw safeError;
        } finally {
          ingest.promise = null;
        }
      }());
      return ingest.promise;
    }

    function subscribe(listener) {
      if (typeof listener !== 'function') invalid('batch projection listener is invalid');
      listeners.add(listener);
      try { listener(getProjection()); } catch {}
      var subscribed = true;
      return function unsubscribe() {
        if (!subscribed) return false;
        subscribed = false;
        return listeners.delete(listener);
      };
    }

    return Object.freeze({
      startBatch: startBatch,
      pause: pause,
      continue: continueBatch,
      cancelQueued: cancelQueued,
      keepAttempt: keepAttempt,
      rejectAttempt: rejectAttempt,
      regenerateSlot: regenerateSlot,
      retryAttempt: retryAttempt,
      resolveUnknownAttempt: resolveUnknownAttempt,
      ingestSelectedBatch: ingestSelectedBatch,
      recoverIngest: recoverIngest,
      getProjection: getProjection,
      whenSettled: async function () {
        await engine.whenSettled();
        return getProjection();
      },
      subscribe: subscribe,
      dispose: function () {
        if (engineUnsubscribe) engineUnsubscribe();
        engineUnsubscribe = null;
        listeners.clear();
      },
    });
  }

  global.SS_ERP_BYOK_WORKBENCH_BATCH_COORDINATOR = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    START_COMMAND_VERSION: START_COMMAND_VERSION,
    BINDING_VERSION: BINDING_VERSION,
    PROVIDER_DISPATCH_VERSION: PROVIDER_DISPATCH_VERSION,
    INGEST_COMMAND_VERSION: INGEST_COMMAND_VERSION,
    ATOMIC_BATCH_RECEIPT_VERSION: ATOMIC_BATCH_RECEIPT_VERSION,
    EXTERNAL_CHARGE_WARNING_VERSION: EXTERNAL_CHARGE_WARNING_VERSION,
    DUPLICATE_CHARGE_WARNING_VERSION: DUPLICATE_CHARGE_WARNING_VERSION,
    MAX_SELECTED_SLOTS: MAX_SELECTED_SLOTS,
    createCoordinator: createCoordinator,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
