(function exposeByokWorkbenchLaunchSession(global) {
  'use strict';

  var CONTRACT_VERSION = 'extension-byok-workbench-launch-session/v1';
  var CONTEXT_VERSION = 'extension-byok-workbench-launch-context/v1';
  var REVIEW_CONTEXT_VERSION = 'extension-byok-workbench-review-launch-context/v1';
  var STORAGE_KEY = 'ss-erp:byok:workbench-launch-sessions:v1';
  var DOCUMENT_FENCE_STORAGE_KEY = 'ss-erp:byok:workbench-document-fences:v1';
  var BATCH_RECOVERY_STORAGE_KEY = 'ss-erp:byok:workbench-batch-recoveries:v1';
  var EDIT_REVIEW_STORAGE_KEY = 'ss-erp:byok:workbench-edit-review-handoffs:v1';
  var DEFAULT_TTL_MS = 10 * 60 * 1000;
  var MAX_TTL_MS = 15 * 60 * 1000;
  var DEFAULT_LIMIT = 8;
  var MAX_RETIRED_DOCUMENTS = 32;
  var INGEST_CONTRACT_VERSION = 'extension-byok-generated-asset-ingest-client/v1';
  var BATCH_RECOVERY_VERSION_V1 = 'extension-byok-workbench-batch-recovery/v1';
  var BATCH_RECOVERY_VERSION = 'extension-byok-workbench-batch-recovery/v2';
  var SUCCESSOR_RECOVERY_VERSION = 'extension-byok-workbench-successor-recovery/v1';
  var BATCH_RECOVERY_PHASES = ['PREPARING', 'RESERVED', 'DISPATCHING'];
  var BATCH_RECOVERY_OPERATIONS = [
    'TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT',
  ];
  var CONTEXT_KEYS = [
    'contractVersion', 'sourcePlatform', 'sourceProductId', 'sourceCaptureSnapshotId',
    'supplyGoodsId', 'shopId', 'workflowId', 'draftRevision', 'draftVersion', 'skuKey',
    'slotKey', 'assignmentMode', 'assignmentOrdinal',
  ];
  var REVIEW_CONTEXT_KEYS = [
    'contractVersion', 'launchMode', 'sourcePlatform', 'sourceProductId',
    'sourceCaptureSnapshotId', 'supplyGoodsId', 'shopId', 'workflowId',
    'draftRevision', 'draftVersion', 'skuKey', 'slotKey', 'assignmentOrdinal',
    'assetId', 'source',
  ];
  var SESSION_KEYS = [
    'contractVersion', 'context', 'sourceTabId', 'sourceDocumentId', 'workbenchTabId',
    'workbenchDocumentId', 'operation', 'result', 'createdAt', 'expiresAt',
  ];
  var RESULT_KEYS = [
    'resultId', 'reviewState', 'deliveryState', 'ingestIdempotencyKey',
    'ingestRequestHash', 'ingestAuthority', 'ingest',
  ];
  var INGEST_AUTHORITY_KEYS = [
    'ownerUserId', 'deviceSessionId', 'shopId', 'workflowId',
    'draftRevision', 'draftVersion', 'policyRevision',
  ];
  var INGEST_KEYS = [
    'contractVersion', 'replayed', 'receiptId', 'assetId', 'provenanceId',
    'normalizedSha256', 'mimeType', 'width', 'height', 'sourceDraftRevision',
    'sourceDraftVersion', 'boundDraftRevision', 'boundDraftVersion',
    'assignmentOrdinal', 'assignmentSha256', 'skuKey', 'slotKey',
  ];
  var BATCH_RECOVERY_KEYS = [
    'contractVersion', 'phase', 'reservationIdempotencyKey', 'executionBatchId',
    'context', 'slots', 'successorRecovery', 'profileId',
  ];
  var BATCH_RECOVERY_KEYS_V1 = BATCH_RECOVERY_KEYS.filter(function (key) {
    return key !== 'profileId';
  });
  var LEGACY_BATCH_RECOVERY_KEYS_V1 = BATCH_RECOVERY_KEYS_V1.filter(function (key) {
    return key !== 'successorRecovery';
  });
  var BATCH_RECOVERY_CONTEXT_KEYS = [
    'shopId', 'workflowId', 'draftRevision', 'draftVersion',
  ];
  var BATCH_RECOVERY_SLOT_KEYS = ['skuKey', 'slotKey', 'operation'];
  var SUCCESSOR_RECOVERY_KEYS = [
    'contractVersion', 'state', 'itemIndex', 'assignmentOrdinal', 'predecessorIntentId',
    'predecessorGeneration', 'requestMode', 'providerIdempotencyKey',
    'providerRequestHash',
  ];

  function sessionError(code) {
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

  function exactText(value, maximum, code) {
    if (typeof value !== 'string' || !value || value.length > maximum
      || value !== value.normalize('NFKC').trim()
      // eslint-disable-next-line no-control-regex
      || /[\u0000-\u001f\u007f]/u.test(value)) {
      throw sessionError(code);
    }
    return value;
  }

  function secretShapedIdentifier(value) {
    return /^(?:sk-[a-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|LTAI[a-zA-Z0-9]{12,}|AKID[a-zA-Z0-9]{12,})$/iu
      .test(value)
      || /^Bearer\s+\S+/iu.test(value)
      || /^eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/u.test(value);
  }

  function tabId(value, code) {
    if (!Number.isSafeInteger(value) || value < 0) throw sessionError(code);
    return value;
  }

  function positiveInteger(value, code) {
    if (!Number.isSafeInteger(value) || value < 1) throw sessionError(code);
    return value;
  }

  function sha256(value, code) {
    var normalized = exactText(value, 64, code);
    if (!/^[a-f0-9]{64}$/u.test(normalized)) throw sessionError(code);
    return normalized;
  }

  function recoveryIdentifier(value, minimum, maximum, code) {
    var normalized = exactText(value, maximum, code);
    if (normalized.length < minimum
      || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u.test(normalized)
      || secretShapedIdentifier(normalized)) throw sessionError(code);
    return normalized;
  }

  function normalizeContext(value) {
    var code = 'SS_ERP_BYOK_WORKBENCH_SESSION_CONTEXT_INVALID';
    if (exactKeys(value, REVIEW_CONTEXT_KEYS)
      && value.contractVersion === REVIEW_CONTEXT_VERSION) {
      var reviewSourcePlatform = exactText(value.sourcePlatform, 16, code);
      var reviewSkuKey = exactText(value.skuKey, 500, code);
      var reviewSlotKey = exactText(value.slotKey, 200, code);
      var reviewAssetId = exactText(value.assetId, 500, code);
      if (!['1688', 'pdd', 'taobao', 'tmall'].includes(reviewSourcePlatform)
        || value.launchMode !== 'REVIEW_PUBLISH_ONLY'
        || reviewSlotKey !== 'sku:' + reviewSkuKey + ':hero'
        || !Number.isSafeInteger(value.assignmentOrdinal)
        || value.assignmentOrdinal < 0 || value.assignmentOrdinal > 499
        || value.source !== 'GENERATED'
        || secretShapedIdentifier(reviewAssetId)
        || /(?:https?|ftp|data):/iu.test(reviewAssetId)) {
        throw sessionError(code);
      }
      return Object.freeze({
        contractVersion: REVIEW_CONTEXT_VERSION,
        launchMode: 'REVIEW_PUBLISH_ONLY',
        sourcePlatform: reviewSourcePlatform,
        sourceProductId: exactText(value.sourceProductId, 200, code),
        sourceCaptureSnapshotId: exactText(value.sourceCaptureSnapshotId, 200, code),
        supplyGoodsId: exactText(value.supplyGoodsId, 200, code),
        shopId: exactText(value.shopId, 200, code),
        workflowId: exactText(value.workflowId, 200, code),
        draftRevision: positiveInteger(value.draftRevision, code),
        draftVersion: positiveInteger(value.draftVersion, code),
        skuKey: reviewSkuKey,
        slotKey: reviewSlotKey,
        assignmentOrdinal: value.assignmentOrdinal,
        assetId: reviewAssetId,
        source: 'GENERATED',
      });
    }
    if (!exactKeys(value, CONTEXT_KEYS) || value.contractVersion !== CONTEXT_VERSION) {
      throw sessionError(code);
    }
    var sourcePlatform = exactText(value.sourcePlatform, 16, code);
    var skuKey = exactText(value.skuKey, 500, code);
    var slotKey = exactText(value.slotKey, 200, code);
    if (!['1688', 'pdd', 'taobao', 'tmall'].includes(sourcePlatform)
      || value.assignmentMode !== 'APPEND'
      || slotKey !== 'sku:' + skuKey + ':hero'
      || !Number.isSafeInteger(value.assignmentOrdinal)
      || value.assignmentOrdinal < 0
      || value.assignmentOrdinal > 499) {
      throw sessionError(code);
    }
    return Object.freeze({
      contractVersion: CONTEXT_VERSION,
      sourcePlatform: sourcePlatform,
      sourceProductId: exactText(value.sourceProductId, 200, code),
      sourceCaptureSnapshotId: exactText(value.sourceCaptureSnapshotId, 200, code),
      supplyGoodsId: exactText(value.supplyGoodsId, 200, code),
      shopId: exactText(value.shopId, 200, code),
      workflowId: exactText(value.workflowId, 200, code),
      draftRevision: positiveInteger(value.draftRevision, code),
      draftVersion: positiveInteger(value.draftVersion, code),
      skuKey: skuKey,
      slotKey: slotKey,
      assignmentMode: 'APPEND',
      assignmentOrdinal: value.assignmentOrdinal,
    });
  }

  function sameContext(left, right) {
    var normalizedLeft;
    var normalizedRight;
    try {
      normalizedLeft = normalizeContext(left);
      normalizedRight = normalizeContext(right);
    } catch {
      return false;
    }
    return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
  }

  function normalizeIngest(value) {
    var code = 'SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_INVALID';
    if (!exactKeys(value, INGEST_KEYS)
      || value.contractVersion !== INGEST_CONTRACT_VERSION
      || typeof value.replayed !== 'boolean'
      || !['image/png', 'image/jpeg', 'image/webp'].includes(value.mimeType)
      || !Number.isSafeInteger(value.assignmentOrdinal)
      || value.assignmentOrdinal < 0 || value.assignmentOrdinal > 499) {
      throw sessionError(code);
    }
    var sourceDraftRevision = positiveInteger(value.sourceDraftRevision, code);
    var sourceDraftVersion = positiveInteger(value.sourceDraftVersion, code);
    var boundDraftRevision = positiveInteger(value.boundDraftRevision, code);
    var boundDraftVersion = positiveInteger(value.boundDraftVersion, code);
    if (boundDraftRevision !== sourceDraftRevision + 1
      || boundDraftVersion !== sourceDraftVersion + 1) {
      throw sessionError(code);
    }
    return Object.freeze({
      contractVersion: INGEST_CONTRACT_VERSION,
      replayed: value.replayed,
      receiptId: exactText(value.receiptId, 200, code),
      assetId: exactText(value.assetId, 200, code),
      provenanceId: exactText(value.provenanceId, 200, code),
      normalizedSha256: sha256(value.normalizedSha256, code),
      mimeType: value.mimeType,
      width: positiveInteger(value.width, code),
      height: positiveInteger(value.height, code),
      sourceDraftRevision: sourceDraftRevision,
      sourceDraftVersion: sourceDraftVersion,
      boundDraftRevision: boundDraftRevision,
      boundDraftVersion: boundDraftVersion,
      assignmentOrdinal: value.assignmentOrdinal,
      assignmentSha256: sha256(value.assignmentSha256, code),
      skuKey: exactText(value.skuKey, 500, code),
      slotKey: exactText(value.slotKey, 200, code),
    });
  }

  function ingestMatchesContext(ingest, context) {
    return context.contractVersion === CONTEXT_VERSION
      && ingest.sourceDraftRevision === context.draftRevision
      && ingest.sourceDraftVersion === context.draftVersion
      && ingest.assignmentOrdinal === context.assignmentOrdinal
      && ingest.skuKey === context.skuKey
      && ingest.slotKey === context.slotKey;
  }

  function normalizeIngestAuthority(value, context) {
    var code = 'SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_INVALID';
    if (!exactKeys(value, INGEST_AUTHORITY_KEYS)) throw sessionError(code);
    var authority = Object.freeze({
      ownerUserId: exactText(value.ownerUserId, 200, code),
      deviceSessionId: exactText(value.deviceSessionId, 200, code),
      shopId: exactText(value.shopId, 200, code),
      workflowId: exactText(value.workflowId, 200, code),
      draftRevision: positiveInteger(value.draftRevision, code),
      draftVersion: positiveInteger(value.draftVersion, code),
      policyRevision: exactText(value.policyRevision, 200, code),
    });
    if (context && (authority.shopId !== context.shopId
      || authority.workflowId !== context.workflowId
      || authority.draftRevision !== context.draftRevision
      || authority.draftVersion !== context.draftVersion)) {
      throw sessionError(code);
    }
    return authority;
  }

  function normalizeEditReviewHandoff(value) {
    var code = 'SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_INVALID';
    if (!exactKeys(value, [
      'contractVersion', 'resultId', 'attemptId', 'expectedSlotRevision', 'operation',
    ]) || value.contractVersion !== 'extension-byok-edit-review-handoff/v1'
      || !['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'].includes(value.operation)) {
      throw sessionError(code);
    }
    var id = exactText(value.resultId, 128, code);
    var attemptId = exactText(value.attemptId, 200, code);
    if (!/^br_[a-f0-9]{48}$/u.test(id)
      || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/u.test(attemptId)
      || secretShapedIdentifier(attemptId)) throw sessionError(code);
    return Object.freeze({
      contractVersion: value.contractVersion,
      resultId: id,
      attemptId: attemptId,
      expectedSlotRevision: positiveInteger(value.expectedSlotRevision, code),
      operation: value.operation,
    });
  }

  function normalizeResult(value) {
    if (value === null) return null;
    if (isRecord(value) && Object.prototype.hasOwnProperty.call(value, 'editReviewHandoff')) {
      if (!exactKeys(value, RESULT_KEYS.concat(['editReviewHandoff']))) {
        throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_INVALID');
      }
      var base = {};
      RESULT_KEYS.forEach(function (key) { base[key] = value[key]; });
      var normalized = normalizeResult(base);
      var handoff = normalizeEditReviewHandoff(value.editReviewHandoff);
      if (normalized.resultId !== handoff.resultId
        || normalized.reviewState !== 'CANDIDATE_READY'
        || normalized.deliveryState !== 'NOT_INGESTED') {
        throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_INVALID');
      }
      return Object.freeze({ ...normalized, editReviewHandoff: handoff });
    }
    var legacy = exactKeys(value, ['resultId', 'reviewState']);
    if (!legacy && !exactKeys(value, RESULT_KEYS)) {
      throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_INVALID');
    }
    var resultId = exactText(value.resultId, 128, 'SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_INVALID');
    if (!/^br_[a-f0-9]{48}$/u.test(resultId)
      || !['CANDIDATE_READY', 'APPROVED'].includes(value.reviewState)) {
      throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_INVALID');
    }
    if (legacy) {
      return Object.freeze({
        resultId: resultId,
        reviewState: value.reviewState,
        deliveryState: 'NOT_INGESTED',
        ingestIdempotencyKey: null,
        ingestRequestHash: null,
        ingestAuthority: null,
        ingest: null,
      });
    }
    if (value.deliveryState === 'NOT_INGESTED'
      && value.ingestIdempotencyKey === null
      && value.ingestRequestHash === null
      && value.ingestAuthority === null
      && value.ingest === null) {
      return Object.freeze({
        resultId: resultId,
        reviewState: value.reviewState,
        deliveryState: 'NOT_INGESTED',
        ingestIdempotencyKey: null,
        ingestRequestHash: null,
        ingestAuthority: null,
        ingest: null,
      });
    }
    var idempotencyKey = exactText(
      value.ingestIdempotencyKey,
      128,
      'SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_INVALID',
    );
    if (value.reviewState !== 'APPROVED'
      || !['INGESTING', 'BOUND'].includes(value.deliveryState)
      || !/^wb_ingest_[a-f0-9]{48}$/u.test(idempotencyKey)) {
      throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_INVALID');
    }
    var ingestAuthority = normalizeIngestAuthority(value.ingestAuthority);
    var ingestRequestHash = value.ingestRequestHash === null
      ? null
      : sha256(value.ingestRequestHash, 'SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_INVALID');
    if (value.deliveryState === 'INGESTING') {
      if (value.ingest !== null) {
        throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_INVALID');
      }
      return Object.freeze({
        resultId: resultId,
        reviewState: 'APPROVED',
        deliveryState: 'INGESTING',
        ingestIdempotencyKey: idempotencyKey,
        ingestRequestHash: ingestRequestHash,
        ingestAuthority: ingestAuthority,
        ingest: null,
      });
    }
    if (ingestRequestHash === null) {
      throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_INVALID');
    }
    return Object.freeze({
      resultId: resultId,
      reviewState: 'APPROVED',
      deliveryState: 'BOUND',
      ingestIdempotencyKey: idempotencyKey,
      ingestRequestHash: ingestRequestHash,
      ingestAuthority: ingestAuthority,
      ingest: normalizeIngest(value.ingest),
    });
  }

  function normalizeSuccessorRecovery(value, context, slots) {
    if (value === null || value === undefined) return null;
    var code = 'SS_ERP_BYOK_WORKBENCH_SESSION_OPERATION_INVALID';
    if (!exactKeys(value, SUCCESSOR_RECOVERY_KEYS)
      || value.contractVersion !== SUCCESSOR_RECOVERY_VERSION
      || !['CLAIMING', 'HANDOFF_STARTED'].includes(value.state)
      || !Number.isSafeInteger(value.itemIndex) || value.itemIndex < 0
      || value.itemIndex >= slots.length
      || !Number.isSafeInteger(value.assignmentOrdinal)
      || value.assignmentOrdinal < 0 || value.assignmentOrdinal > 499
      || !Number.isSafeInteger(value.predecessorGeneration)
      || value.predecessorGeneration < 1 || value.predecessorGeneration > 499) {
      throw sessionError(code);
    }
    var slot = slots[value.itemIndex];
    var requestMode = exactText(value.requestMode, 16, code);
    if (requestMode !== (slot.operation === 'TEXT_TO_IMAGE' ? 'json' : 'multipart')) {
      throw sessionError(code);
    }
    return Object.freeze({
      contractVersion: SUCCESSOR_RECOVERY_VERSION,
      state: value.state,
      itemIndex: value.itemIndex,
      assignmentOrdinal: value.assignmentOrdinal,
      predecessorIntentId: recoveryIdentifier(value.predecessorIntentId, 1, 200, code),
      predecessorGeneration: value.predecessorGeneration,
      requestMode: requestMode,
      providerIdempotencyKey: recoveryIdentifier(
        value.providerIdempotencyKey, 16, 200, code,
      ),
      providerRequestHash: sha256(value.providerRequestHash, code),
    });
  }

  function normalizeBatchRecovery(value, context) {
    if (value === null || value === undefined) return null;
    var code = 'SS_ERP_BYOK_WORKBENCH_SESSION_OPERATION_INVALID';
    var recoveryV2 = exactKeys(value, BATCH_RECOVERY_KEYS)
      && value.contractVersion === BATCH_RECOVERY_VERSION;
    var recoveryV1 = exactKeys(value, BATCH_RECOVERY_KEYS_V1)
      && value.contractVersion === BATCH_RECOVERY_VERSION_V1;
    var legacyRecoveryV1 = exactKeys(value, LEGACY_BATCH_RECOVERY_KEYS_V1)
      && value.contractVersion === BATCH_RECOVERY_VERSION_V1;
    if (!recoveryV2 && !recoveryV1 && !legacyRecoveryV1
      || !BATCH_RECOVERY_PHASES.includes(value.phase)
      || !exactKeys(value.context, BATCH_RECOVERY_CONTEXT_KEYS)
      || !Array.isArray(value.slots) || value.slots.length < 1 || value.slots.length > 4) {
      throw sessionError(code);
    }
    var recoveryContext = Object.freeze({
      shopId: exactText(value.context.shopId, 200, code),
      workflowId: exactText(value.context.workflowId, 200, code),
      draftRevision: positiveInteger(value.context.draftRevision, code),
      draftVersion: positiveInteger(value.context.draftVersion, code),
    });
    if (!context || recoveryContext.shopId !== context.shopId
      || recoveryContext.workflowId !== context.workflowId
      || recoveryContext.draftRevision !== context.draftRevision
      || recoveryContext.draftVersion !== context.draftVersion) {
      throw sessionError(code);
    }
    var slots = value.slots.map(function (slot) {
      if (!exactKeys(slot, BATCH_RECOVERY_SLOT_KEYS)
        || !BATCH_RECOVERY_OPERATIONS.includes(slot.operation)) throw sessionError(code);
      var skuKey = exactText(slot.skuKey, 500, code);
      var slotKey = exactText(slot.slotKey, 200, code);
      var hero = slotKey === 'sku:' + skuKey + ':hero';
      var shared = ['SCENE', 'DETAIL', 'SPEC', 'PACKAGING'].some(function (role) {
        return slotKey === 'shared:detail:' + role;
      });
      if (!hero && (!shared || skuKey !== context.skuKey)) throw sessionError(code);
      return Object.freeze({ skuKey: skuKey, slotKey: slotKey, operation: slot.operation });
    });
    if (new Set(slots.map(function (slot) { return slot.slotKey; })).size !== slots.length) {
      throw sessionError(code);
    }
    var executionBatchId = value.executionBatchId === null
      ? null
      : exactText(value.executionBatchId, 200, code);
    var reservationIdempotencyKey = exactText(value.reservationIdempotencyKey, 200, code);
    if (!/^byok-reservation:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
      .test(reservationIdempotencyKey)) throw sessionError(code);
    if (executionBatchId !== null && secretShapedIdentifier(executionBatchId)) {
      throw sessionError(code);
    }
    if ((value.phase === 'PREPARING') !== (executionBatchId === null)) {
      throw sessionError(code);
    }
    var successorRecovery = normalizeSuccessorRecovery(
      legacyRecoveryV1 ? null : value.successorRecovery, context, slots,
    );
    if (successorRecovery !== null && value.phase !== 'DISPATCHING') {
      throw sessionError(code);
    }
    var normalized = {
      contractVersion: recoveryV2 ? BATCH_RECOVERY_VERSION : BATCH_RECOVERY_VERSION_V1,
      phase: value.phase,
      reservationIdempotencyKey: reservationIdempotencyKey,
      executionBatchId: executionBatchId,
      context: recoveryContext,
      slots: Object.freeze(slots),
      successorRecovery: successorRecovery,
    };
    if (recoveryV2) {
      normalized.profileId = recoveryIdentifier(value.profileId, 1, 128, code);
    }
    return Object.freeze(normalized);
  }

  function normalizeOperation(value, context) {
    if (value === null) return null;
    var legacy = exactKeys(value, ['idempotencyKey', 'state']);
    if (!legacy && !exactKeys(value, ['idempotencyKey', 'state', 'recovery'])) {
      throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_OPERATION_INVALID');
    }
    if (value.state !== 'OUTCOME_UNRESOLVED') {
      throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_OPERATION_INVALID');
    }
    var idempotencyKey = exactText(
      value.idempotencyKey,
      128,
      'SS_ERP_BYOK_WORKBENCH_SESSION_OPERATION_INVALID',
    );
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u.test(idempotencyKey)) {
      throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_OPERATION_INVALID');
    }
    if (secretShapedIdentifier(idempotencyKey)) {
      throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_OPERATION_INVALID');
    }
    return Object.freeze({
      idempotencyKey: idempotencyKey,
      state: 'OUTCOME_UNRESOLVED',
      recovery: normalizeBatchRecovery(legacy ? null : value.recovery, context),
    });
  }

  function normalizeSession(value, current, ttlMs) {
    try {
      if (!exactKeys(value, SESSION_KEYS) || value.contractVersion !== CONTRACT_VERSION) return null;
      var createdAt = Number(value.createdAt);
      var expiresAt = Number(value.expiresAt);
      if (!Number.isSafeInteger(createdAt) || !Number.isSafeInteger(expiresAt)
        || createdAt > current + 60 * 1000
        || expiresAt <= createdAt || expiresAt - createdAt > ttlMs) return null;
      var workbenchDocumentId = value.workbenchDocumentId === null
        ? null
        : exactText(value.workbenchDocumentId, 200, 'SS_ERP_BYOK_WORKBENCH_SESSION_INVALID');
      var context = normalizeContext(value.context);
      var result = normalizeResult(value.result);
      var operation = normalizeOperation(value.operation, context);
      if (result && ['INGESTING', 'BOUND'].includes(result.deliveryState)) {
        try { normalizeIngestAuthority(result.ingestAuthority, context); } catch { return null; }
      }
      if (result && result.deliveryState === 'BOUND'
        && !ingestMatchesContext(result.ingest, context)) return null;
      var protectedState = operation !== null
        || Boolean(result && ['INGESTING', 'BOUND'].includes(result.deliveryState));
      if (!protectedState && expiresAt <= current) return null;
      return Object.freeze({
        contractVersion: CONTRACT_VERSION,
        context: context,
        sourceTabId: tabId(value.sourceTabId, 'SS_ERP_BYOK_WORKBENCH_SESSION_INVALID'),
        sourceDocumentId: exactText(
          value.sourceDocumentId,
          200,
          'SS_ERP_BYOK_WORKBENCH_SESSION_INVALID',
        ),
        workbenchTabId: tabId(value.workbenchTabId, 'SS_ERP_BYOK_WORKBENCH_SESSION_INVALID'),
        workbenchDocumentId: workbenchDocumentId,
        operation: operation,
        result: result,
        createdAt: createdAt,
        expiresAt: expiresAt,
      });
    } catch {
      return null;
    }
  }

  function normalizeDocumentFence(value, session) {
    if (!session) return null;
    var code = 'SS_ERP_BYOK_WORKBENCH_SESSION_INVALID';
    if (!exactKeys(value, ['currentDocumentId', 'retiredDocumentIds'])
      || !Array.isArray(value.retiredDocumentIds)
      || value.retiredDocumentIds.length > MAX_RETIRED_DOCUMENTS) return null;
    try {
      var currentDocumentId = exactText(value.currentDocumentId, 200, code);
      var retiredDocumentIds = value.retiredDocumentIds.map(function (documentId) {
        return exactText(documentId, 200, code);
      });
      if ((session.workbenchDocumentId !== null
        && currentDocumentId !== session.workbenchDocumentId)
        || new Set(retiredDocumentIds).size !== retiredDocumentIds.length
        || retiredDocumentIds.includes(currentDocumentId)) return null;
      return Object.freeze({
        currentDocumentId: currentDocumentId,
        retiredDocumentIds: Object.freeze(retiredDocumentIds),
      });
    } catch {
      return null;
    }
  }

  function senderIdentity(value) {
    if (!isRecord(value) || value.frameId !== 0) {
      throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_SENDER_DENIED');
    }
    return {
      tabId: tabId(value.tabId, 'SS_ERP_BYOK_WORKBENCH_SESSION_SENDER_DENIED'),
      documentId: exactText(
        value.documentId,
        200,
        'SS_ERP_BYOK_WORKBENCH_SESSION_SENDER_DENIED',
      ),
    };
  }

  function createManager(options) {
    var storage = options && options.sessionStorage;
    var tabs = options && options.tabs;
    var runtime = options && options.runtime;
    var now = options && typeof options.now === 'function' ? options.now : Date.now;
    var onDiscardedResult = options && options.onDiscardedResult;
    var ttlMs = Number(options && options.ttlMs) || DEFAULT_TTL_MS;
    var limit = Number(options && options.limit) || DEFAULT_LIMIT;
    if (!storage || typeof storage.get !== 'function' || typeof storage.set !== 'function'
      || typeof storage.remove !== 'function'
      || !tabs || typeof tabs.create !== 'function' || typeof tabs.update !== 'function'
      || !runtime || typeof runtime.getURL !== 'function'
      || (onDiscardedResult !== undefined && typeof onDiscardedResult !== 'function')
      || !Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > MAX_TTL_MS
      || !Number.isSafeInteger(limit) || limit < 1 || limit > 32) {
      throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_DEPENDENCY_UNAVAILABLE');
    }
    var queue = Promise.resolve();
    if (!onDiscardedResult) onDiscardedResult = function () {};

    function enqueue(operation) {
      var next = queue.then(operation, operation);
      queue = next.catch(function () {});
      return next;
    }

    function currentMillis() {
      var value = Number(now());
      if (!Number.isSafeInteger(value)) {
        throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_INVALID');
      }
      return value;
    }

    function renewLease(session, current) {
      return {
        ...session,
        createdAt: current,
        expiresAt: current + ttlMs,
      };
    }

    function discardResult(value) {
      var candidate = value && value.result && value.result.resultId;
      if (typeof candidate !== 'string' || !/^br_[a-f0-9]{48}$/u.test(candidate)) return;
      try { onDiscardedResult(candidate); } catch {}
    }

    async function loadState(current) {
      var stored = await storage.get([
        STORAGE_KEY, DOCUMENT_FENCE_STORAGE_KEY, BATCH_RECOVERY_STORAGE_KEY, EDIT_REVIEW_STORAGE_KEY,
      ]);
      var raw = stored && stored[STORAGE_KEY];
      var records = isRecord(raw) ? raw : {};
      var rawFences = stored && stored[DOCUMENT_FENCE_STORAGE_KEY];
      var rawRecoveries = stored && stored[BATCH_RECOVERY_STORAGE_KEY];
      var rawEditReviews = stored && stored[EDIT_REVIEW_STORAGE_KEY];
      var valid = {};
      var fences = {};
      Object.keys(records).forEach(function (key) {
        var session = normalizeSession(records[key], current, ttlMs);
        if (session && String(session.workbenchTabId) === key) {
          if (session.result && isRecord(rawEditReviews)
            && Object.prototype.hasOwnProperty.call(rawEditReviews, key)) {
            try {
              session = Object.freeze({
                ...session,
                result: normalizeResult({
                  ...session.result, editReviewHandoff: rawEditReviews[key],
                }),
              });
            } catch {}
          }
          if (session.operation && isRecord(rawRecoveries)
            && Object.prototype.hasOwnProperty.call(rawRecoveries, key)) {
            var recovery = null;
            var envelope = rawRecoveries[key];
            try {
              if (exactKeys(envelope, ['operationIdempotencyKey', 'recovery'])
                && envelope.operationIdempotencyKey === session.operation.idempotencyKey) {
                recovery = normalizeBatchRecovery(envelope.recovery, session.context);
              }
            } catch {}
            session = Object.freeze({
              ...session,
              operation: Object.freeze({ ...session.operation, recovery: recovery }),
            });
          }
          var fence = normalizeDocumentFence(isRecord(rawFences) ? rawFences[key] : null, session);
          if (fence) {
            fences[key] = fence;
            if (session.workbenchDocumentId === null) {
              session = Object.freeze({
                ...session,
                workbenchDocumentId: fence.currentDocumentId,
              });
            }
          }
          else if (session.workbenchDocumentId !== null) {
            fences[key] = {
              currentDocumentId: session.workbenchDocumentId,
              retiredDocumentIds: [],
            };
          }
          valid[key] = session;
        } else discardResult(records[key]);
      });
      return { records: valid, fences: fences };
    }

    async function storeState(records, fences) {
      if (!Object.keys(records).length) {
        await storage.remove([
          STORAGE_KEY, DOCUMENT_FENCE_STORAGE_KEY, BATCH_RECOVERY_STORAGE_KEY, EDIT_REVIEW_STORAGE_KEY,
        ]);
        return;
      }
      var serializedRecords = {};
      var recoveries = {};
      var editReviews = {};
      Object.keys(records).forEach(function (key) {
        var session = records[key];
        if (session.operation) {
          var legacyCurrent = currentMillis();
          serializedRecords[key] = {
            ...session,
            // A previous package can claim this tab after a rollback reload
            // without deleting the unresolved two-field operation as stale.
            workbenchDocumentId: null,
            operation: {
              idempotencyKey: session.operation.idempotencyKey,
              state: session.operation.state,
            },
            createdAt: legacyCurrent,
            expiresAt: legacyCurrent + ttlMs,
          };
        } else serializedRecords[key] = session;
        if (session.result && session.result.editReviewHandoff) {
          editReviews[key] = session.result.editReviewHandoff;
          var result = {};
          RESULT_KEYS.forEach(function (field) { result[field] = session.result[field]; });
          serializedRecords[key] = { ...serializedRecords[key], result: result };
        }
        if (session.operation && session.operation.recovery) {
          recoveries[key] = {
            operationIdempotencyKey: session.operation.idempotencyKey,
            recovery: session.operation.recovery,
          };
        }
      });
      await storage.set({
        [STORAGE_KEY]: serializedRecords,
        [DOCUMENT_FENCE_STORAGE_KEY]: fences,
        [BATCH_RECOVERY_STORAGE_KEY]: recoveries,
        [EDIT_REVIEW_STORAGE_KEY]: editReviews,
      });
    }

    async function mutateForSender(sender, operation, mutationOptions) {
      var identity = senderIdentity(sender);
      return enqueue(async function () {
        var current = currentMillis();
        var state = await loadState(current);
        var records = state.records;
        var fences = state.fences;
        var key = String(identity.tabId);
        var session = records[key];
        if (!session) {
          await storeState(records, fences);
          throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_NOT_FOUND');
        }
        if (session.workbenchDocumentId !== null
          && session.workbenchDocumentId !== identity.documentId) {
          var protectedOperation = Boolean(
            session.operation && session.operation.state === 'OUTCOME_UNRESOLVED',
          );
          var protectedDelivery = Boolean(
            session.result && ['INGESTING', 'BOUND'].includes(session.result.deliveryState),
          );
          var fence = fences[key] || {
            currentDocumentId: session.workbenchDocumentId,
            retiredDocumentIds: [],
          };
          var retiredDocument = fence.retiredDocumentIds.includes(identity.documentId);
          if (mutationOptions && mutationOptions.allowDocumentRebind === true
            && (protectedOperation || protectedDelivery)) {
            if (retiredDocument || fence.retiredDocumentIds.length >= MAX_RETIRED_DOCUMENTS) {
              await storeState(records, fences);
              throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_SENDER_DENIED');
            }
            fences[key] = {
              currentDocumentId: identity.documentId,
              retiredDocumentIds: fence.retiredDocumentIds.concat([
                fence.currentDocumentId,
              ]),
            };
          } else if (mutationOptions && mutationOptions.allowDeliveryRebind === true
            && protectedDelivery && retiredDocument
            && fence.retiredDocumentIds[fence.retiredDocumentIds.length - 1]
              === identity.documentId) {
            // A completion started by the previous document may finish after a
            // reload, but it must not take ownership back from the live page.
          } else if (retiredDocument || protectedOperation || protectedDelivery) {
            await storeState(records, fences);
            throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_SENDER_DENIED');
          } else {
            delete records[key];
            delete fences[key];
            await storeState(records, fences);
            discardResult(session);
            var denied = sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_SENDER_DENIED');
            if (session.result && session.result.resultId) {
              denied.discardedResultId = session.result.resultId;
            }
            throw denied;
          }
        }
        var next = operation(session, identity, current);
        var normalized = normalizeSession(next, current, ttlMs);
        if (!normalized) throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_INVALID');
        records[key] = normalized;
        if (normalized.workbenchDocumentId !== null && !fences[key]) {
          fences[key] = {
            currentDocumentId: normalized.workbenchDocumentId,
            retiredDocumentIds: [],
          };
        }
        await storeState(records, fences);
        return normalized;
      });
    }

    async function focusExisting(session, launchUrl, workbenchUrl) {
      var update = { active: true };
      if (typeof tabs.get === 'function') {
        var existing;
        try { existing = await tabs.get(session.workbenchTabId); } catch { return false; }
        if (!isRecord(existing) || existing.id !== session.workbenchTabId) return false;
        var effectiveUrl = typeof existing.pendingUrl === 'string' && existing.pendingUrl
          ? existing.pendingUrl
          : existing.url;
        if (typeof effectiveUrl === 'string' && effectiveUrl
          && effectiveUrl !== launchUrl && effectiveUrl !== workbenchUrl) return false;
        if (effectiveUrl === launchUrl) update.url = workbenchUrl;
      }
      try {
        await tabs.update(session.workbenchTabId, update);
        return true;
      } catch {
        return false;
      }
    }

    function exactLaunchMatch(session, context, sourceTabId, sourceDocumentId) {
      return session.sourceTabId === sourceTabId
        && session.sourceDocumentId === sourceDocumentId
        && sameContext(session.context, context);
    }

    function replacementSession(session, workbenchTabId, current) {
      return {
        ...session,
        workbenchTabId: workbenchTabId,
        workbenchDocumentId: null,
        createdAt: current,
        expiresAt: current + ttlMs,
      };
    }

    async function open(value) {
      var context = normalizeContext(value && value.context);
      var sourceTabId = tabId(
        value && value.sourceTabId,
        'SS_ERP_BYOK_WORKBENCH_SESSION_CONTEXT_INVALID',
      );
      var sourceDocumentId = exactText(
        value && value.sourceDocumentId,
        200,
        'SS_ERP_BYOK_WORKBENCH_SESSION_CONTEXT_INVALID',
      );
      var launchUrl = runtime.getURL('pages/ai-image-workbench-launch.html');
      var workbenchUrl = runtime.getURL('pages/ai-image-workbench.html');
      return enqueue(async function () {
        var current = currentMillis();
        var state = await loadState(current);
        var records = state.records;
        var fences = state.fences;
        var originalRecords = { ...records };
        var originalFences = { ...fences };
        var matching = Object.values(records)
          .filter(function (session) {
            return exactLaunchMatch(session, context, sourceTabId, sourceDocumentId);
          })
          .sort(function (left, right) {
            return right.createdAt - left.createdAt
              || right.workbenchTabId - left.workbenchTabId;
          })[0] || null;
        if (matching && await focusExisting(matching, launchUrl, workbenchUrl)) {
          records[String(matching.workbenchTabId)] = renewLease(matching, current);
          await storeState(records, fences);
          return Object.freeze({ state: 'workbench_focused', tabId: matching.workbenchTabId });
        }

        if (matching) {
          delete records[String(matching.workbenchTabId)];
          delete fences[String(matching.workbenchTabId)];
        }

        var created;
        var workbenchTabId;
        var discardedSessions = [];
        try {
          created = await tabs.create({ url: launchUrl, active: true });
          workbenchTabId = tabId(
            created && created.id,
            'SS_ERP_BYOK_WORKBENCH_SESSION_OPEN_FAILED',
          );
          var ordered = Object.values(records).sort(function (left, right) {
            return left.createdAt - right.createdAt || left.workbenchTabId - right.workbenchTabId;
          });
          while (ordered.length >= limit) {
            var discardIndex = ordered.findIndex(function (candidate) {
              return !candidate.operation
                && !(candidate.result
                  && ['INGESTING', 'BOUND'].includes(candidate.result.deliveryState));
            });
            if (discardIndex < 0) {
              throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_CAPACITY_EXCEEDED');
            }
            var discarded = ordered.splice(discardIndex, 1)[0];
            delete records[String(discarded.workbenchTabId)];
            delete fences[String(discarded.workbenchTabId)];
            discardedSessions.push(discarded);
          }
          var nextSession = matching
            ? replacementSession(matching, workbenchTabId, current)
            : {
              contractVersion: CONTRACT_VERSION,
              context: context,
              sourceTabId: sourceTabId,
              sourceDocumentId: sourceDocumentId,
              workbenchTabId: workbenchTabId,
              workbenchDocumentId: null,
              operation: null,
              result: null,
              createdAt: current,
              expiresAt: current + ttlMs,
            };
          records[String(workbenchTabId)] = nextSession;
          await storeState(records, fences);
          await tabs.update(workbenchTabId, { url: workbenchUrl, active: true });
          discardedSessions.forEach(discardResult);
          return Object.freeze({ state: 'workbench_opened', tabId: workbenchTabId });
        } catch (error) {
          try { await storeState(originalRecords, originalFences); } catch {}
          if (Number.isSafeInteger(workbenchTabId) && typeof tabs.remove === 'function') {
            try { await tabs.remove(workbenchTabId); } catch {}
          }
          throw error;
        }
      });
    }

    function claim(sender) {
      return mutateForSender(sender, function (session, identity, current) {
        return renewLease({ ...session, workbenchDocumentId: identity.documentId }, current);
      }, { allowDocumentRebind: true });
    }

    function beginOperation(sender, idempotencyKeyValue, recoveryValue) {
      return mutateForSender(sender, function (session, _identity, current) {
        var operation = normalizeOperation({
          idempotencyKey: idempotencyKeyValue,
          state: 'OUTCOME_UNRESOLVED',
          recovery: recoveryValue === undefined ? null : recoveryValue,
        }, session.context);
        if (session.result) {
          throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_OPERATION_CONFLICT');
        }
        if (session.operation) {
          throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_OPERATION_CONFLICT');
        }
        return renewLease({ ...session, operation: operation }, current);
      });
    }

    function updateOperationRecovery(sender, idempotencyKeyValue, recoveryValue) {
      return mutateForSender(sender, function (session) {
        if (!session.operation || session.operation.idempotencyKey !== idempotencyKeyValue) {
          throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_OPERATION_CONFLICT');
        }
        var recovery = normalizeBatchRecovery(recoveryValue, session.context);
        var previous = session.operation.recovery;
        var sameBase = previous && recovery
          && previous.contractVersion === recovery.contractVersion
          && (previous.profileId || null) === (recovery.profileId || null)
          && JSON.stringify(previous.context) === JSON.stringify(recovery.context)
          && JSON.stringify(previous.slots) === JSON.stringify(recovery.slots)
          && previous.reservationIdempotencyKey === recovery.reservationIdempotencyKey;
        var samePhaseTransition = sameBase && (
          JSON.stringify(previous) === JSON.stringify(recovery)
          || (previous.phase === 'PREPARING' && previous.executionBatchId === null
            && previous.successorRecovery === null
            && recovery.phase === 'RESERVED' && recovery.executionBatchId !== null
            && recovery.successorRecovery === null)
          || (previous.phase === 'RESERVED' && previous.successorRecovery === null
            && recovery.phase === 'DISPATCHING'
            && previous.executionBatchId === recovery.executionBatchId
            && recovery.successorRecovery === null)
        );
        var successorTransition = sameBase
          && previous.phase === 'DISPATCHING' && recovery.phase === 'DISPATCHING'
          && previous.executionBatchId === recovery.executionBatchId
          && (
            JSON.stringify(previous.successorRecovery)
              === JSON.stringify(recovery.successorRecovery)
            || (previous.successorRecovery === null && recovery.successorRecovery !== null
              && recovery.successorRecovery.state === 'CLAIMING')
            || (previous.successorRecovery !== null && recovery.successorRecovery !== null
              && previous.successorRecovery.state === 'CLAIMING'
              && recovery.successorRecovery.state === 'HANDOFF_STARTED'
              && JSON.stringify({ ...previous.successorRecovery, state: 'HANDOFF_STARTED' })
                === JSON.stringify(recovery.successorRecovery))
            || (previous.successorRecovery !== null && recovery.successorRecovery === null)
          );
        if (!previous || !recovery
          || JSON.stringify(previous.context) !== JSON.stringify(recovery.context)
          || JSON.stringify(previous.slots) !== JSON.stringify(recovery.slots)
          || previous.reservationIdempotencyKey !== recovery.reservationIdempotencyKey
          || !(samePhaseTransition || successorTransition)) {
          throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_OPERATION_CONFLICT');
        }
        return { ...session, operation: { ...session.operation, recovery: recovery } };
      });
    }

    function clearOperation(sender, idempotencyKeyValue) {
      var operation = normalizeOperation({
        idempotencyKey: idempotencyKeyValue,
        state: 'OUTCOME_UNRESOLVED',
      }, null);
      return mutateForSender(sender, function (session, _identity, current) {
        if (!session.operation
          || session.operation.idempotencyKey !== operation.idempotencyKey) {
          throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_OPERATION_CONFLICT');
        }
        return renewLease({ ...session, operation: null }, current);
      });
    }

    function attachResult(sender, result, idempotencyKeyValue) {
      var normalizedResult = normalizeResult(result);
      var operation = normalizeOperation({
        idempotencyKey: idempotencyKeyValue,
        state: 'OUTCOME_UNRESOLVED',
      });
      if (!normalizedResult || normalizedResult.reviewState !== 'CANDIDATE_READY') {
        return Promise.reject(sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_INVALID'));
      }
      return mutateForSender(sender, function (session, _identity, current) {
        if (session.result && session.result.resultId !== normalizedResult.resultId) {
          throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_CONFLICT');
        }
        if (session.result) return session;
        if (!session.operation
          || session.operation.idempotencyKey !== operation.idempotencyKey) {
          throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_OPERATION_CONFLICT');
        }
        return renewLease({ ...session, operation: null, result: normalizedResult }, current);
      });
    }

    function setReviewState(sender, resultIdValue, reviewState) {
      var resultId = exactText(
        resultIdValue,
        128,
        'SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_INVALID',
      );
      if (reviewState !== 'APPROVED') {
        return Promise.reject(sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_INVALID'));
      }
      return mutateForSender(sender, function (session) {
        if (!session.result || session.result.resultId !== resultId
          || session.result.reviewState !== 'CANDIDATE_READY') {
          throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_CONFLICT');
        }
        return { ...session, result: { resultId: resultId, reviewState: 'APPROVED' } };
      });
    }

    function attachEditResult(sender, contextValue, handoffValue) {
      var context = normalizeContext(contextValue);
      var handoff = normalizeEditReviewHandoff(handoffValue);
      return mutateForSender(sender, function (session, _identity, current) {
        if (!sameContext(session.context, context)) {
          throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_CONTEXT_INVALID');
        }
        if (session.operation) {
          throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_OPERATION_CONFLICT');
        }
        if (session.result) {
          if (session.result.reviewState !== 'CANDIDATE_READY'
            || session.result.deliveryState !== 'NOT_INGESTED'
            || JSON.stringify(session.result.editReviewHandoff) !== JSON.stringify(handoff)) {
            throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_CONFLICT');
          }
          return session;
        }
        return renewLease({
          ...session,
          result: {
            ...normalizeResult({ resultId: handoff.resultId, reviewState: 'CANDIDATE_READY' }),
            editReviewHandoff: handoff,
          },
        }, current);
      });
    }

    function beginIngest(sender, resultIdValue, idempotencyKeyValue, authorityValue) {
      var normalizedResultId = exactText(
        resultIdValue,
        128,
        'SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_INVALID',
      );
      var normalizedIdempotencyKey = exactText(
        idempotencyKeyValue,
        128,
        'SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_INVALID',
      );
      if (!/^br_[a-f0-9]{48}$/u.test(normalizedResultId)
        || !/^wb_ingest_[a-f0-9]{48}$/u.test(normalizedIdempotencyKey)) {
        return Promise.reject(sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_INVALID'));
      }
      return mutateForSender(sender, function (session) {
        var authority = normalizeIngestAuthority(authorityValue, session.context);
        if (!session.result || session.result.resultId !== normalizedResultId
          || session.result.reviewState !== 'APPROVED') {
          throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_CONFLICT');
        }
        if (session.result.deliveryState === 'INGESTING') {
          if (session.result.ingestIdempotencyKey !== normalizedIdempotencyKey
            || JSON.stringify(session.result.ingestAuthority) !== JSON.stringify(authority)) {
            throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_CONFLICT');
          }
          return session;
        }
        if (session.result.deliveryState !== 'NOT_INGESTED') {
          throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_CONFLICT');
        }
        return {
          ...session,
          result: {
            resultId: normalizedResultId,
            reviewState: 'APPROVED',
            deliveryState: 'INGESTING',
            ingestIdempotencyKey: normalizedIdempotencyKey,
            ingestRequestHash: null,
            ingestAuthority: authority,
            ingest: null,
          },
        };
      });
    }

    function setIngestRequestHash(
      sender,
      resultIdValue,
      idempotencyKeyValue,
      requestHashValue
    ) {
      var normalizedResultId = exactText(
        resultIdValue,
        128,
        'SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_INVALID',
      );
      var normalizedIdempotencyKey = exactText(
        idempotencyKeyValue,
        128,
        'SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_INVALID',
      );
      var requestHash = sha256(
        requestHashValue,
        'SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_INVALID',
      );
      if (!/^br_[a-f0-9]{48}$/u.test(normalizedResultId)
        || !/^wb_ingest_[a-f0-9]{48}$/u.test(normalizedIdempotencyKey)) {
        return Promise.reject(sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_INVALID'));
      }
      return mutateForSender(sender, function (session) {
        if (!session.result || session.result.resultId !== normalizedResultId
          || session.result.reviewState !== 'APPROVED'
          || !['INGESTING', 'BOUND'].includes(session.result.deliveryState)
          || session.result.ingestIdempotencyKey !== normalizedIdempotencyKey
          || (session.result.ingestRequestHash !== null
            && session.result.ingestRequestHash !== requestHash)) {
          throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_CONFLICT');
        }
        if (session.result.ingestRequestHash === requestHash) return session;
        return {
          ...session,
          result: { ...session.result, ingestRequestHash: requestHash },
        };
      }, { allowDeliveryRebind: true });
    }

    function resetIngest(sender, resultIdValue, idempotencyKeyValue) {
      var normalizedResultId = exactText(
        resultIdValue,
        128,
        'SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_INVALID',
      );
      var normalizedIdempotencyKey = exactText(
        idempotencyKeyValue,
        128,
        'SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_INVALID',
      );
      return mutateForSender(sender, function (session) {
        if (!session.result || session.result.resultId !== normalizedResultId
          || session.result.reviewState !== 'APPROVED'
          || session.result.deliveryState !== 'INGESTING'
          || session.result.ingestIdempotencyKey !== normalizedIdempotencyKey) {
          throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_CONFLICT');
        }
        return {
          ...session,
          result: {
            resultId: normalizedResultId,
            reviewState: 'APPROVED',
            deliveryState: 'NOT_INGESTED',
            ingestIdempotencyKey: null,
            ingestRequestHash: null,
            ingestAuthority: null,
            ingest: null,
          },
        };
      }, { allowDeliveryRebind: true });
    }

    function setIngestResult(sender, resultIdValue, idempotencyKeyValue, authorityValue, ingestValue) {
      var normalizedResultId = exactText(
        resultIdValue,
        128,
        'SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_INVALID',
      );
      var normalizedIdempotencyKey = exactText(
        idempotencyKeyValue,
        128,
        'SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_INVALID',
      );
      var normalizedIngest = normalizeIngest(ingestValue);
      if (!/^br_[a-f0-9]{48}$/u.test(normalizedResultId)
        || !/^wb_ingest_[a-f0-9]{48}$/u.test(normalizedIdempotencyKey)) {
        return Promise.reject(sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_INVALID'));
      }
      return mutateForSender(sender, function (session) {
        var normalizedAuthority = normalizeIngestAuthority(authorityValue, session.context);
        if (!session.result || session.result.resultId !== normalizedResultId
          || session.result.reviewState !== 'APPROVED'
          || session.result.ingestRequestHash === null) {
          throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_CONFLICT');
        }
        if (session.result.deliveryState === 'BOUND') {
          var sameIngest = JSON.stringify(session.result.ingest) === JSON.stringify(normalizedIngest);
          var sameAuthority = JSON.stringify(session.result.ingestAuthority)
            === JSON.stringify(normalizedAuthority);
          if (session.result.ingestIdempotencyKey !== normalizedIdempotencyKey
            || !sameAuthority || !sameIngest) {
            throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_CONFLICT');
          }
          return session;
        }
        if (session.result.deliveryState !== 'INGESTING'
          || session.result.ingestIdempotencyKey !== normalizedIdempotencyKey
          || JSON.stringify(session.result.ingestAuthority) !== JSON.stringify(normalizedAuthority)
          || !ingestMatchesContext(normalizedIngest, session.context)) {
          throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_CONFLICT');
        }
        return {
          ...session,
          result: {
            resultId: normalizedResultId,
            reviewState: 'APPROVED',
            deliveryState: 'BOUND',
            ingestIdempotencyKey: normalizedIdempotencyKey,
            ingestRequestHash: session.result.ingestRequestHash,
            ingestAuthority: normalizedAuthority,
            ingest: normalizedIngest,
          },
        };
      }, { allowDeliveryRebind: true });
    }

    function clearResult(sender, resultIdValue) {
      var resultId = exactText(
        resultIdValue,
        128,
        'SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_INVALID',
      );
      return mutateForSender(sender, function (session) {
        if (!session.result || session.result.resultId !== resultId) {
          throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_CONFLICT');
        }
        return { ...session, result: null };
      });
    }

    function takeByTab(value) {
      var id = tabId(value, 'SS_ERP_BYOK_WORKBENCH_SESSION_SENDER_DENIED');
      return enqueue(async function () {
        var state = await loadState(currentMillis());
        var records = state.records;
        var session = records[String(id)] || null;
        if (!session) {
          await storeState(records, state.fences);
          return null;
        }
        delete records[String(id)];
        delete state.fences[String(id)];
        await storeState(records, state.fences);
        return session;
      });
    }

    function takeByTabIfIdle(value) {
      var id = tabId(value, 'SS_ERP_BYOK_WORKBENCH_SESSION_SENDER_DENIED');
      return enqueue(async function () {
        var state = await loadState(currentMillis());
        var records = state.records;
        var session = records[String(id)] || null;
        if (!session) {
          await storeState(records, state.fences);
          return null;
        }
        if (session.operation
          || (session.result
            && ['INGESTING', 'BOUND'].includes(session.result.deliveryState))) {
          await storeState(records, state.fences);
          return null;
        }
        delete records[String(id)];
        delete state.fences[String(id)];
        await storeState(records, state.fences);
        return session;
      });
    }

    function removeByTab(value) {
      return takeByTab(value).then(function (session) {
        if (session) discardResult(session);
        return session ? 1 : 0;
      });
    }

    function clear() {
      return enqueue(async function () {
        var stored = await storage.get([STORAGE_KEY]);
        var raw = stored && stored[STORAGE_KEY];
        if (isRecord(raw)) Object.keys(raw).forEach(function (key) { discardResult(raw[key]); });
        await storage.remove([
          STORAGE_KEY, DOCUMENT_FENCE_STORAGE_KEY, BATCH_RECOVERY_STORAGE_KEY, EDIT_REVIEW_STORAGE_KEY,
        ]);
      });
    }

    function clearProviderState() {
      return enqueue(async function () {
        var state = await loadState(currentMillis());
        var records = state.records;
        var preservedResultIds = [];
        Object.keys(records).forEach(function (key) {
          var session = records[key];
          if (session.result
            && ['INGESTING', 'BOUND'].includes(session.result.deliveryState)) {
            preservedResultIds.push(session.result.resultId);
            return;
          }
          if (session.result) discardResult(session);
          records[key] = { ...session, result: null };
        });
        await storeState(records, state.fences);
        return Object.freeze({
          preservedResultIds: Object.freeze(preservedResultIds),
        });
      });
    }

    return Object.freeze({
      open: open,
      claim: claim,
      beginOperation: beginOperation,
      updateOperationRecovery: updateOperationRecovery,
      clearOperation: clearOperation,
      attachResult: attachResult,
      attachEditResult: attachEditResult,
      setReviewState: setReviewState,
      beginIngest: beginIngest,
      setIngestRequestHash: setIngestRequestHash,
      resetIngest: resetIngest,
      setIngestResult: setIngestResult,
      clearResult: clearResult,
      removeByTab: removeByTab,
      takeByTab: takeByTab,
      takeByTabIfIdle: takeByTabIfIdle,
      clearProviderState: clearProviderState,
      clear: clear,
      sameContext: sameContext,
    });
  }

  global.SS_ERP_BYOK_WORKBENCH_LAUNCH_SESSION = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    CONTEXT_VERSION: CONTEXT_VERSION,
    REVIEW_CONTEXT_VERSION: REVIEW_CONTEXT_VERSION,
    BATCH_RECOVERY_VERSION: BATCH_RECOVERY_VERSION,
    BATCH_RECOVERY_VERSION_V1: BATCH_RECOVERY_VERSION_V1,
    SUCCESSOR_RECOVERY_VERSION: SUCCESSOR_RECOVERY_VERSION,
    STORAGE_KEY: STORAGE_KEY,
    BATCH_RECOVERY_STORAGE_KEY: BATCH_RECOVERY_STORAGE_KEY,
    EDIT_REVIEW_STORAGE_KEY: EDIT_REVIEW_STORAGE_KEY,
    DEFAULT_TTL_MS: DEFAULT_TTL_MS,
    createManager: createManager,
    normalizeContext: normalizeContext,
    sameContext: sameContext,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
