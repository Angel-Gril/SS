(function exposeByokWorkbenchRuntimeHandler(global) {
  'use strict';

  var CONTRACT_VERSION = 'extension-byok-workbench-runtime-handler/v2';
  var LAUNCH_DECISION_VERSION = 'extension-byok-workbench-launch-decision/v2';
  var REVIEW_LAUNCH_DECISION_VERSION = 'extension-byok-workbench-launch-decision/v3';
  var REVIEW_CONTEXT_VERSION = 'extension-byok-workbench-review-launch-context/v1';
  var PUBLIC_STATE_VERSION = 'extension-byok-workbench-public-state/v1';
  var REVIEW_PUBLIC_STATE_VERSION = 'extension-byok-workbench-review-public-state/v1';
  var OPERATION = 'TEXT_TO_IMAGE';
  var REQUEST_MODE = 'json';
  var EDIT_OPERATIONS = ['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'];
  var CONTEXT_KEYS = [
    'sourcePlatform', 'sourceProductId', 'sourceCaptureSnapshotId', 'supplyGoodsId',
    'shopId', 'workflowId', 'draftRevision', 'draftVersion', 'skuKey', 'slotKey',
    'assignmentMode', 'assignmentOrdinal',
  ];
  var PUBLIC_READINESS_REASON_CODES = new Set([
    'POLICY_DISABLED',
    'OWNER_NOT_ALLOWED',
    'SHOP_NOT_ALLOWED',
    'DEVICE_NOT_ALLOWED',
    'ORIGIN_NOT_ALLOWED',
    'OPERATION_NOT_ALLOWED',
    'GENERATION_DISABLED',
  ]);
  var PUBLIC_READINESS_ERROR_CODES = new Set([
    'byok_readiness_request_invalid',
    'byok_readiness_scope_denied',
    'byok_readiness_shop_denied',
    'byok_readiness_draft_stale',
    'byok_readiness_target_stale',
    'byok_readiness_not_ready',
    'byok_readiness_unavailable',
  ]);
  var PUBLIC_READINESS_STATES = new Set([
    'response',
    'unpaired',
    'authorization_required',
    'invalid_response',
  ]);

  function handlerError(code) {
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

  function text(value, maximum, code) {
    if (typeof value !== 'string' || !value || value.length > maximum
      || value !== value.normalize('NFKC').trim()
      || /[\u0000-\u001f\u007f]/u.test(value)) {
      throw handlerError(code);
    }
    return value;
  }

  function profileId(value) {
    var result = text(value, 128, 'SS_ERP_BYOK_WORKBENCH_INPUT_INVALID');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u.test(result)) {
      throw handlerError('SS_ERP_BYOK_WORKBENCH_INPUT_INVALID');
    }
    return result;
  }

  function resultId(value) {
    var result = text(value, 128, 'SS_ERP_BYOK_WORKBENCH_INPUT_INVALID');
    if (!/^br_[a-f0-9]{48}$/u.test(result)) {
      throw handlerError('SS_ERP_BYOK_WORKBENCH_INPUT_INVALID');
    }
    return result;
  }

  function requiredMethod(value, name) {
    if (!value || typeof value[name] !== 'function') {
      throw handlerError('SS_ERP_BYOK_WORKBENCH_DEPENDENCY_UNAVAILABLE');
    }
    return value[name].bind(value);
  }

  function safeFailure(error) {
    var candidate = error && typeof error === 'object' ? String(error.code || '') : '';
    var failure = {
      ok: false,
      errorCode: /^[A-Z][A-Z0-9_]{0,99}$/u.test(candidate)
        ? candidate
        : 'SS_ERP_BYOK_WORKBENCH_OPERATION_FAILED',
      error: 'BYOK workbench operation failed',
    };
    var reasonCode = error && typeof error === 'object' ? error.reasonCode : null;
    var readinessErrorCode = error && typeof error === 'object' ? error.errorCode : null;
    var readinessState = error && typeof error === 'object' ? error.state : null;
    var readinessStatus = Number(error && typeof error === 'object' ? error.status : NaN);
    if (PUBLIC_READINESS_REASON_CODES.has(reasonCode)) failure.reasonCode = reasonCode;
    if (PUBLIC_READINESS_ERROR_CODES.has(readinessErrorCode)) {
      failure.readinessErrorCode = readinessErrorCode;
    }
    if (PUBLIC_READINESS_STATES.has(readinessState)) failure.readinessState = readinessState;
    if (Number.isSafeInteger(readinessStatus) && readinessStatus >= 100 && readinessStatus <= 599) {
      failure.readinessStatus = readinessStatus;
    }
    return failure;
  }

  function success(data) {
    return { ok: true, data: data };
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

  function launchRequest(context, preferredSkuKey, selectionKind) {
    return {
      sourcePlatform: context.sourcePlatform,
      sourceProductId: context.sourceProductId,
      sourceCaptureSnapshotId: context.sourceCaptureSnapshotId,
      supplyGoodsId: context.supplyGoodsId,
      shopId: context.shopId,
      workflowId: context.workflowId,
      draftRevision: context.draftRevision,
      draftVersion: context.draftVersion,
      preferredSkuKey: preferredSkuKey,
      selectionKind: selectionKind,
    };
  }

  function readyLaunchContext(value) {
    if (!isRecord(value) || !exactKeys(value, ['contractVersion', 'state', 'context'])
      || !isRecord(value.context)) return null;
    if (value.contractVersion === LAUNCH_DECISION_VERSION && value.state === 'READY') {
      return value.context;
    }
    return value.contractVersion === REVIEW_LAUNCH_DECISION_VERSION
      && value.state === 'REVIEW_PUBLISH_ONLY'
      && value.context.contractVersion === REVIEW_CONTEXT_VERSION
      ? value.context : null;
  }

  function isReviewPublishContext(value) {
    return isRecord(value)
      && value.contractVersion === REVIEW_CONTEXT_VERSION
      && value.launchMode === 'REVIEW_PUBLISH_ONLY';
  }

  function reviewPublishRequest(context) {
    return {
      executionMode: 'BYOK',
      binding: {
        shopId: context.shopId,
        workflowId: context.workflowId,
        draftRevision: context.draftRevision,
        draftVersion: context.draftVersion,
      },
      selectedMedia: [{
        scope: 'SKU',
        skuKey: context.skuKey,
        slotKey: context.slotKey,
        assetId: context.assetId,
      }],
    };
  }

  function reviewPublishRequestMatches(value, context) {
    return exactKeys(value, ['executionMode', 'binding', 'selectedMedia'])
      && value.executionMode === 'BYOK'
      && exactKeys(value.binding, ['shopId', 'workflowId', 'draftRevision', 'draftVersion'])
      && value.binding.shopId === context.shopId
      && value.binding.workflowId === context.workflowId
      && value.binding.draftRevision === context.draftRevision
      && value.binding.draftVersion === context.draftVersion
      && Array.isArray(value.selectedMedia)
      && value.selectedMedia.length === 1
      && exactKeys(value.selectedMedia[0], ['scope', 'skuKey', 'slotKey', 'assetId'])
      && value.selectedMedia[0].scope === 'SKU'
      && value.selectedMedia[0].skuKey === context.skuKey
      && value.selectedMedia[0].slotKey === context.slotKey
      && value.selectedMedia[0].assetId === context.assetId;
  }

  function choiceRequiredLaunch(value) {
    return isRecord(value)
      && exactKeys(value, ['contractVersion', 'state', 'binding', 'skuKeys'])
      && value.contractVersion === LAUNCH_DECISION_VERSION
      && value.state === 'CHOICE_REQUIRED'
      && isRecord(value.binding)
      && Array.isArray(value.skuKeys)
      ? value
      : null;
  }

  function bindingMatchesContext(binding, context) {
    return isRecord(binding) && CONTEXT_KEYS.every(function (key) {
      return binding[key] === context[key];
    }) && binding.operation === OPERATION;
  }

  function ingestAuthorityProjection(value) {
    if (!isRecord(value)) throw handlerError('SS_ERP_BYOK_DEVICE_AUTHORITY_STALE');
    return {
      ownerUserId: value.ownerUserId,
      deviceSessionId: value.deviceSessionId,
      shopId: value.shopId,
      workflowId: value.workflowId,
      draftRevision: value.draftRevision,
      draftVersion: value.draftVersion,
      policyRevision: value.policyRevision,
    };
  }

  function readinessRequest(profileIdValue, context) {
    return {
      profileId: profileIdValue,
      shopId: context.shopId,
      workflowId: context.workflowId,
      draftRevision: context.draftRevision,
      draftVersion: context.draftVersion,
      sourcePlatform: context.sourcePlatform,
      sourceProductId: context.sourceProductId,
      sourceCaptureSnapshotId: context.sourceCaptureSnapshotId,
      supplyGoodsId: context.supplyGoodsId,
      skuKey: context.skuKey,
      slotKey: context.slotKey,
      assignmentMode: context.assignmentMode,
      assignmentOrdinal: context.assignmentOrdinal,
      operation: OPERATION,
    };
  }

  function sourceSender(value) {
    if (!isRecord(value) || value.frameId !== 0
      || !Number.isSafeInteger(value.tabId) || value.tabId < 0) {
      throw handlerError('SS_ERP_BYOK_WORKBENCH_LAUNCH_SENDER_DENIED');
    }
    return {
      tabId: value.tabId,
      documentId: text(
        value.documentId,
        200,
        'SS_ERP_BYOK_WORKBENCH_LAUNCH_SENDER_DENIED',
      ),
    };
  }

  function editOwner(sender, session) {
    if (!isRecord(sender) || !Number.isSafeInteger(sender.tabId) || sender.tabId < 0
      || typeof sender.documentId !== 'string' || !sender.documentId
      || !session || !isRecord(session.context)) {
      throw handlerError('SS_ERP_BYOK_WORKBENCH_SESSION_SENDER_DENIED');
    }
    return {
      tabId: sender.tabId,
      documentId: sender.documentId,
      context: session.context,
    };
  }

  function providerOwnerToken(sender) {
    if (!isRecord(sender) || !Number.isSafeInteger(sender.tabId) || sender.tabId < 0
      || typeof sender.documentId !== 'string' || !sender.documentId) {
      throw handlerError('SS_ERP_BYOK_WORKBENCH_SESSION_SENDER_DENIED');
    }
    return 'workbench-tab:' + sender.tabId + ':document:' + sender.documentId;
  }

  function createDispatcher(options) {
    var config = options || {};
    var messageTypes = config.messageTypes;
    if (!isRecord(messageTypes)) {
      throw handlerError('SS_ERP_BYOK_WORKBENCH_DEPENDENCY_UNAVAILABLE');
    }
    var requiredTypes = [
      'GET_PUBLIC_STATE', 'GET_READINESS', 'EXECUTE_PROVIDER', 'OPEN_PREVIEW',
      'SOURCE_CATALOG', 'SOURCE_PREVIEW',
      'REVIEW_RESULT', 'INGEST', 'RECOVER_INGEST', 'PUBLISH',
      'EDIT_MEDIA_PREPARE', 'EDIT_MEDIA_RELEASE', 'EDIT_STATE', 'EDIT_REFERENCES',
      'EDIT_START', 'EDIT_SELECT', 'EDIT_REGENERATE', 'EDIT_PREVIEW', 'EDIT_REVIEW', 'EDIT_CLEANUP',
    ];
    var typeValues = requiredTypes.map(function (name) {
      return text(
        messageTypes[name],
        200,
        'SS_ERP_BYOK_WORKBENCH_DEPENDENCY_UNAVAILABLE',
      );
    });
    if (new Set(typeValues).size !== typeValues.length) {
      throw handlerError('SS_ERP_BYOK_WORKBENCH_DEPENDENCY_UNAVAILABLE');
    }

    var sessionManager = config.sessionManager;
    var openSession = requiredMethod(sessionManager, 'open');
    var claimSession = requiredMethod(sessionManager, 'claim');
    var beginOperation = requiredMethod(sessionManager, 'beginOperation');
    var clearOperation = requiredMethod(sessionManager, 'clearOperation');
    var attachResult = requiredMethod(sessionManager, 'attachResult');
    var setReviewState = requiredMethod(sessionManager, 'setReviewState');
    var beginIngest = requiredMethod(sessionManager, 'beginIngest');
    var setIngestRequestHash = requiredMethod(sessionManager, 'setIngestRequestHash');
    var resetIngest = requiredMethod(sessionManager, 'resetIngest');
    var setIngestResult = requiredMethod(sessionManager, 'setIngestResult');
    var clearResult = requiredMethod(sessionManager, 'clearResult');
    var takeByTabIfIdle = requiredMethod(sessionManager, 'takeByTabIfIdle');
    var sameContext = requiredMethod(sessionManager, 'sameContext');
    var resolveLaunch = requiredMethod(config.launchClient, 'resolve');
    var assertSourceCurrent = requiredMethod(config, 'assertSourceCurrent');

    async function sourceRemainsCurrent(value) {
      try {
        await assertSourceCurrent(value);
        return true;
      } catch (error) {
        if (Number(error && error.status) === 409
          || (error && error.code === 'SS_ERP_BYOK_WORKBENCH_SOURCE_STALE')) return false;
        throw error;
      }
    }
    var listProfiles = config.profileStore
      && typeof config.profileStore.listPublicProfiles === 'function'
      ? config.profileStore.listPublicProfiles.bind(config.profileStore)
      : requiredMethod(config.profileStore, 'listProfiles');
    var getProfile = requiredMethod(config.profileStore, 'getProfile');
    var getProfileState = requiredMethod(config.profileStore, 'getPublicState');
    var permissionStatus = requiredMethod(config.permissionBroker, 'hasOriginPermission');
    var getReadiness = requiredMethod(config.readinessClient, 'getReadiness');
    var generate = requiredMethod(config.providerClient, 'generate');
    var commitResult = requiredMethod(config.providerClient, 'commitResult');
    var releaseProviderResult = requiredMethod(config.providerClient, 'releaseResult');
    var getOperationState = requiredMethod(config.providerClient, 'getOperationState');
    var ingestApprovedResult = requiredMethod(config.ingestClient, 'ingest');
    var recoverIngestResult = requiredMethod(config.ingestClient, 'recover');
    var discardIngestResult = requiredMethod(config.ingestClient, 'discardResult');
    var getIngestOperationState = requiredMethod(config.ingestClient, 'getOperationState');
    var previewPublish = requiredMethod(config.publishCoordinator, 'preview');
    var confirmPublish = requiredMethod(config.publishCoordinator, 'confirm');
    var recoverPublish = requiredMethod(config.publishCoordinator, 'recover');
    var getPublishState = requiredMethod(config.publishCoordinator, 'getState');
    var workspacePublishCoordinator = config.workbenchPublishCoordinator;

    function workspacePublishMethod(name) {
      if (!workspacePublishCoordinator
        || typeof workspacePublishCoordinator[name] !== 'function') {
        throw handlerError('SS_ERP_WORKBENCH_PUBLISH_DEPENDENCY_UNAVAILABLE');
      }
      return workspacePublishCoordinator[name].bind(workspacePublishCoordinator);
    }
    var vault = config.vault;
    var getVaultEntry = requiredMethod(vault, 'getForBackground');
    var getPublicResult = requiredMethod(vault, 'getPublic');
    var getPublicByOperation = requiredMethod(vault, 'getPublicByOperation');
    var approveResult = requiredMethod(vault, 'approve');
    var rejectResult = requiredMethod(vault, 'reject');
    var releaseVaultResult = requiredMethod(vault, 'release');
    var captureAuthority = requiredMethod(config.authorityGuard, 'capture');
    var commitGeneratedResult = requiredMethod(config.authorityGuard, 'commitGeneratedResult');
    var matchesVaultAuthority = requiredMethod(config.authorityGuard, 'matchesVaultAuthority');
    var openPreview = requiredMethod(config.previewBroker, 'open');
    var releasePreviewResult = requiredMethod(config.previewBroker, 'releaseResult');
    var sourceMediaLibrary = config.sourceMediaLibrary;
    var loadSourceCatalog = requiredMethod(sourceMediaLibrary, 'loadCatalog');
    var openSourcePreview = requiredMethod(sourceMediaLibrary, 'open');
    var editController = config.editController;
    var openEdit = requiredMethod(editController, 'open');
    var setEditReferences = requiredMethod(editController, 'setReferences');
    var startEdit = requiredMethod(editController, 'start');
    var regenerateEdit = requiredMethod(editController, 'regenerate');
    var selectEditAlternative = requiredMethod(editController, 'selectAlternative');
    var getEditSnapshot = requiredMethod(editController, 'getSnapshot');
    var cleanupEdit = requiredMethod(editController, 'cleanup');
    var cleanupEditByTab = requiredMethod(editController, 'cleanupByTab');
    var prepareEditMedia = requiredMethod(config.editMediaStore, 'prepare');
    var releaseEditMedia = requiredMethod(config.editMediaStore, 'release');
    var assertEditEpoch = requiredMethod(config.editEpochGuard, 'assertCurrent');
    var beginEditEpoch = requiredMethod(config.editEpochGuard, 'begin');
    var clearEditEpoch = requiredMethod(config.editEpochGuard, 'clear');
    var clearEditEpochByTab = requiredMethod(config.editEpochGuard, 'clearByTab');
    var acknowledgeEditEpoch = requiredMethod(config.editEpochGuard, 'acknowledge');
    var acquireProviderLease = requiredMethod(config.providerSemaphore, 'tryAcquire');
    var cancelProviderOwner = requiredMethod(config.providerSemaphore, 'cancelOwner');
    var now = typeof config.now === 'function' ? config.now : function () { return new Date(); };
    var randomValues = typeof config.randomValues === 'function'
      ? config.randomValues
      : global.crypto && typeof global.crypto.getRandomValues === 'function'
        ? global.crypto.getRandomValues.bind(global.crypto)
        : null;
    if (!randomValues) throw handlerError('SS_ERP_BYOK_WORKBENCH_DEPENDENCY_UNAVAILABLE');
    var reviewLocks = new Set();
    var publishLocks = new Set();
    var modeTransitionLocks = new Map();

    function generationGuarded(operation) {
      return guarded(async function generationOnlyHandler(handlerContext) {
        var session = await claimSession(handlerContext && handlerContext.sender);
        if (isReviewPublishContext(session.context)) {
          throw handlerError('SS_ERP_BYOK_WORKBENCH_REVIEW_ONLY');
        }
        return operation(handlerContext);
      });
    }

    function currentMillis() {
      var value = new Date(now()).getTime();
      if (!Number.isFinite(value)) {
        throw handlerError('SS_ERP_BYOK_WORKBENCH_STATE_INVALID');
      }
      return value;
    }

    async function withModeTransitionLock(sender, operation) {
      var token = providerOwnerToken(sender);
      var previous = modeTransitionLocks.get(token) || Promise.resolve();
      var unlock;
      var current = new Promise(function (resolve) { unlock = resolve; });
      var tail = previous.then(function () { return current; });
      modeTransitionLocks.set(token, tail);
      await previous;
      try {
        return await operation();
      } finally {
        unlock();
        if (modeTransitionLocks.get(token) === tail) modeTransitionLocks.delete(token);
      }
    }

    function executionAuthority(owner, readiness) {
      var binding = readiness && readiness.binding;
      var concurrency = readiness && readiness.concurrencyAuthority;
      if (!isRecord(binding) || !isRecord(concurrency)
        || concurrency.policyRevision !== binding.policyRevision
        || !Number.isSafeInteger(concurrency.maxConcurrency)
        || concurrency.maxConcurrency < 1 || concurrency.maxConcurrency > 4
        || typeof readiness.expiresAt !== 'string') {
        throw handlerError('SS_ERP_BYOK_WORKBENCH_READINESS_INVALID');
      }
      return {
        ownerToken: providerOwnerToken(owner),
        ownerUserId: binding.ownerUserId,
        deviceSessionId: binding.deviceSessionId,
        policyRevision: concurrency.policyRevision,
        maxConcurrency: concurrency.maxConcurrency,
        expiresAt: readiness.expiresAt,
      };
    }

    function releaseTemporaryResult(id) {
      try { releasePreviewResult(id); } catch (_error) {}
      try { return Boolean(releaseVaultResult(id)); } catch (_error) { return false; }
    }

    async function cleanupEditTab(tabId) {
      var result = null;
      try { result = cleanupEditByTab(tabId); } catch (_error) {}
      if (result && result.cleaned === true && result.externalChargeUnresolved !== true) {
        try { await clearEditEpochByTab(tabId); } catch (_error) {}
      }
      return result;
    }

    function newIngestIdempotencyKey() {
      var bytes = new Uint8Array(24);
      randomValues(bytes);
      return 'wb_ingest_' + Array.from(bytes).map(function (value) {
        return value.toString(16).padStart(2, '0');
      }).join('');
    }

    async function settleIngestFailure(sender, id, idempotencyKey, error) {
      var operationState = null;
      try { operationState = getIngestOperationState(idempotencyKey); } catch (_stateError) {}
      var grantAbsent = Boolean(error
        && error.code === 'SS_ERP_BYOK_INGEST_RECEIPT_NOT_FOUND');
      var retryable = grantAbsent
        || Boolean(error && error.resetGrant === true)
        || Boolean(operationState && operationState.dispatched === false);
      if (retryable) {
        try {
          await resetIngest(sender, id, idempotencyKey);
          try { discardIngestResult(id); } catch (_discardError) {}
          return true;
        } catch (_resetError) {
          return false;
        }
      }
      var terminal = Boolean(error && error.outcome === 'FAILED_FINAL')
        || Boolean(operationState && operationState.status === 'FAILED_FINAL');
      if (!terminal) return false;
      try { await clearResult(sender, id); } catch (_clearError) {}
      try { discardIngestResult(id); } catch (_discardError) {}
      releaseTemporaryResult(id);
      return true;
    }

    async function removeSession(session) {
      if (!session) return false;
      if (typeof session.workbenchDocumentId === 'string' && session.workbenchDocumentId) {
        try {
          cancelProviderOwner(providerOwnerToken({
            tabId: session.workbenchTabId,
            documentId: session.workbenchDocumentId,
          }));
        } catch (_error) {}
      }
      var removed = await takeByTabIfIdle(session.workbenchTabId);
      await cleanupEditTab(session.workbenchTabId);
      var result = removed && removed.result;
      if (result && result.resultId) releaseTemporaryResult(result.resultId);
      return Boolean(removed);
    }

    async function claimLive(sender) {
      var session;
      try {
        session = await claimSession(sender);
      } catch (error) {
        var discardedResultId = error && error.code === 'SS_ERP_BYOK_WORKBENCH_SESSION_SENDER_DENIED'
          && typeof error.discardedResultId === 'string'
          && /^br_[a-f0-9]{48}$/u.test(error.discardedResultId)
          ? error.discardedResultId
          : null;
        if (discardedResultId) releaseTemporaryResult(discardedResultId);
        if (sender && Number.isSafeInteger(sender.tabId) && sender.tabId >= 0) {
          try { cancelProviderOwner(providerOwnerToken(sender)); } catch (_error) {}
          await cleanupEditTab(sender.tabId);
        }
        throw error;
      }
      // Ingest recovery and publishing use the source revision as immutable
      // provenance after the server has advanced the draft. They still require
      // the exact live owner/device authority on every message.
      if (session.result
        && ['INGESTING', 'BOUND'].includes(session.result.deliveryState)
        && isRecord(session.result.ingestAuthority)) {
        try {
          await captureAuthority(session.result.ingestAuthority);
        } catch (error) {
          await removeSession(session).catch(function () {});
          throw error;
        }
        return session;
      }
      var resolved;
      try {
        var decision = await resolveLaunch(launchRequest(
          session.context,
          session.context.skuKey,
          'EXPLICIT',
        ));
        resolved = readyLaunchContext(decision);
      } catch (error) {
        if (error && Number(error.status) === 409) await removeSession(session);
        throw error;
      }
      if (!resolved || !sameContext(session.context, resolved)) {
        await removeSession(session);
        throw handlerError('SS_ERP_BYOK_WORKBENCH_CONTEXT_STALE');
      }
      return session;
    }

    async function readSessionResult(session, sender) {
      if (!session.result) return null;
      if (session.result.deliveryState === 'BOUND' && isRecord(session.result.ingest)) {
        return {
          resultId: session.result.resultId,
          reviewState: 'APPROVED',
          deliveryState: 'BOUND',
          ingest: session.result.ingest,
        };
      }
      if (session.result.deliveryState === 'INGESTING') {
        return {
          resultId: session.result.resultId,
          reviewState: 'APPROVED',
          deliveryState: 'INGESTING',
        };
      }
      var entry;
      try {
        entry = getVaultEntry(session.result.resultId);
      } catch (_error) {
        try { await clearResult(sender, session.result.resultId); } catch (_clearError) {}
        try { releasePreviewResult(session.result.resultId); } catch (_previewError) {}
        return null;
      }
      // Unavailable authority is not evidence that an already generated image
      // disappeared. Deny this read while retaining its recoverable session result.
      await assertCandidateEntryAuthority(entry, session.context);
      return { ...getPublicResult(session.result.resultId), deliveryState: 'NOT_INGESTED' };
    }

    function publishInput(session) {
      var result = session && session.result;
      var ingest = result && result.ingest;
      var context = session && session.context;
      if (!isRecord(context) || !isRecord(ingest)
        || result.reviewState !== 'APPROVED'
        || result.deliveryState !== 'BOUND') {
        throw handlerError('SS_ERP_BYOK_PUBLISH_RESULT_NOT_BOUND');
      }
      return {
        shopId: context.shopId,
        workflowId: context.workflowId,
        sourceDraftRevision: ingest.sourceDraftRevision,
        sourceDraftVersion: ingest.sourceDraftVersion,
        boundDraftRevision: ingest.boundDraftRevision,
        boundDraftVersion: ingest.boundDraftVersion,
        assetId: ingest.assetId,
        provenanceId: ingest.provenanceId,
        normalizedSha256: ingest.normalizedSha256,
        skuKey: ingest.skuKey,
        slotKey: ingest.slotKey,
        assignmentOrdinal: ingest.assignmentOrdinal,
        assignmentSha256: ingest.assignmentSha256,
      };
    }

    function evidenceProjection(value, current, expectedOperation) {
      var operation = expectedOperation || value && value.operation;
      var validRequestMode = operation === OPERATION
        ? value && value.requestMode === REQUEST_MODE
        : EDIT_OPERATIONS.includes(operation)
          && value && value.requestMode === 'multipart';
      if (!isRecord(value) || value.operation !== operation || !validRequestMode) {
        return null;
      }
      var expiresAt = typeof value.expiresAt === 'string' ? Date.parse(value.expiresAt) : NaN;
      var verifiedAt = typeof value.verifiedAt === 'string' ? Date.parse(value.verifiedAt) : NaN;
      if (!Number.isFinite(expiresAt) || !Number.isFinite(verifiedAt) || expiresAt <= current
        || typeof value.policyRevision !== 'string' || !value.policyRevision) {
        return null;
      }
      return Object.freeze({
        operation: operation,
        requestMode: value.requestMode,
        policyRevision: value.policyRevision,
        verifiedAt: new Date(verifiedAt).toISOString(),
        expiresAt: new Date(expiresAt).toISOString(),
      });
    }

    async function publicProfileStates() {
      var profiles = await listProfiles();
      if (!Array.isArray(profiles) || profiles.length > 64) {
        throw handlerError('SS_ERP_BYOK_WORKBENCH_STATE_INVALID');
      }
      var current = currentMillis();
      return Promise.all(profiles.map(async function (candidate) {
        if (!isRecord(candidate)) {
          throw handlerError('SS_ERP_BYOK_WORKBENCH_STATE_INVALID');
        }
        var id = profileId(candidate.id);
        var state = await getProfileState(id);
        var selected = state && state.profile || candidate;
        var permissionState = 'UNAVAILABLE';
        try {
          var permission = await permissionStatus(selected.baseUrl);
          permissionState = permission && permission.granted === true ? 'GRANTED' : 'REQUIRED';
        } catch (_error) {
          permissionState = 'UNAVAILABLE';
        }
        var projectedEvidence = (Array.isArray(state && state.evidence) ? state.evidence : [])
          .map(function (row) { return evidenceProjection(row, current); })
          .filter(Boolean);
        var evidence = projectedEvidence
          .find(function (row) { return row.operation === OPERATION; }) || null;
        return Object.freeze({
          profile: selected,
          hasKey: Boolean(state && state.hasKey),
          permissionState: permissionState,
          textToImageEvidence: evidence,
          capabilityEvidence: Object.freeze(projectedEvidence.filter(function (row) {
            return EDIT_OPERATIONS.includes(row.operation);
          })),
        });
      }));
    }

    async function requireReadyProfile(id, readiness) {
      var selected = await getProfile(id);
      var state = await getProfileState(id);
      if (!selected || !state || !state.profile
        || !Array.isArray(selected.allowedOperations)
        || !selected.allowedOperations.includes(OPERATION)) {
        throw handlerError('SS_ERP_BYOK_READINESS_PROFILE_UNAVAILABLE');
      }
      if (state.hasKey !== true) {
        throw handlerError('SS_ERP_BYOK_PROVIDER_KEY_REQUIRED');
      }
      var permission = await permissionStatus(selected.baseUrl);
      if (!permission || permission.granted !== true
        || permission.origin !== readiness.readinessBinding.providerOrigin) {
        throw handlerError('SS_ERP_BYOK_PROVIDER_PERMISSION_REQUIRED');
      }
      var current = currentMillis();
      var evidence = (Array.isArray(state.evidence) ? state.evidence : [])
        .map(function (row) { return evidenceProjection(row, current, OPERATION); })
        .find(function (row) {
          return row && row.policyRevision === readiness.readinessBinding.policyRevision;
        });
      if (!evidence) {
        throw handlerError('SS_ERP_BYOK_PROVIDER_CAPABILITY_REQUIRED');
      }
      if (selected.model !== readiness.readinessBinding.model) {
        throw handlerError('SS_ERP_BYOK_WORKBENCH_CONTEXT_MISMATCH');
      }
    }

    async function assertEntryAuthority(entry, context) {
      if (!entry || !bindingMatchesContext(entry.binding, context)) {
        throw handlerError('SS_ERP_BYOK_WORKBENCH_CONTEXT_MISMATCH');
      }
      var authority = await captureAuthority(entry.binding);
      if (!matchesVaultAuthority(entry, entry.binding, authority)) {
        throw handlerError('SS_ERP_BYOK_DEVICE_AUTHORITY_STALE');
      }
      return authority;
    }

    async function assertEditEntryAuthority(entry, context) {
      var binding = entry && entry.binding;
      if (!isRecord(binding) || !EDIT_OPERATIONS.includes(binding.operation)
        || CONTEXT_KEYS.some(function (key) { return binding[key] !== context[key]; })) {
        throw handlerError('SS_ERP_BYOK_WORKBENCH_CONTEXT_MISMATCH');
      }
      var authority = await captureAuthority(binding);
      if (!matchesVaultAuthority(entry, binding, authority)) {
        throw handlerError('SS_ERP_BYOK_DEVICE_AUTHORITY_STALE');
      }
      return authority;
    }

    function assertCandidateEntryAuthority(entry, context) {
      return EDIT_OPERATIONS.includes(entry && entry.binding && entry.binding.operation)
        ? assertEditEntryAuthority(entry, context)
        : assertEntryAuthority(entry, context);
    }

    async function withReviewLock(sender, operation) {
      var tab = sender && sender.tabId;
      if (!Number.isSafeInteger(tab) || tab < 0) {
        throw handlerError('SS_ERP_BYOK_WORKBENCH_SESSION_SENDER_DENIED');
      }
      var key = String(tab);
      if (reviewLocks.has(key)) {
        throw handlerError('SS_ERP_BYOK_WORKBENCH_REVIEW_IN_PROGRESS');
      }
      reviewLocks.add(key);
      try {
        return await operation();
      } finally {
        reviewLocks.delete(key);
      }
    }

    async function withPublishLock(sender, operation) {
      var tab = sender && sender.tabId;
      if (!Number.isSafeInteger(tab) || tab < 0) {
        throw handlerError('SS_ERP_BYOK_WORKBENCH_SESSION_SENDER_DENIED');
      }
      var key = String(tab);
      if (publishLocks.has(key)) {
        throw handlerError('SS_ERP_BYOK_PUBLISH_IN_PROGRESS');
      }
      publishLocks.add(key);
      try {
        return await operation();
      } finally {
        publishLocks.delete(key);
      }
    }

    var handlers = {};

    handlers[messageTypes.GET_PUBLIC_STATE] = guarded(async function (handlerContext) {
      if (!exactKeys(handlerContext.payload || {}, [])) {
        throw handlerError('SS_ERP_BYOK_WORKBENCH_INPUT_INVALID');
      }
      var session = await claimLive(handlerContext.sender);
      if (isReviewPublishContext(session.context)) {
        return {
          contractVersion: REVIEW_PUBLIC_STATE_VERSION,
          executionMode: 'BYOK',
          context: session.context,
          publishRequest: reviewPublishRequest(session.context),
        };
      }
      var result = await readSessionResult(session, handlerContext.sender);
      var publish = result && result.deliveryState === 'BOUND'
        ? await getPublishState(publishInput(session))
        : null;
      return {
        contractVersion: PUBLIC_STATE_VERSION,
        executionMode: 'BYOK',
        context: session.context,
        profiles: await publicProfileStates(),
        result: result,
        publish: publish,
        generationOutcome: session.operation ? 'UNKNOWN_OUTCOME' : null,
        deliveryState: result && result.deliveryState === 'BOUND'
          ? 'BOUND'
          : result && result.deliveryState === 'INGESTING'
            ? 'INGESTING'
          : result && result.reviewState === 'APPROVED'
            ? 'NOT_INGESTED'
            : 'NOT_READY',
      };
    });

    handlers[messageTypes.EDIT_MEDIA_PREPARE] = generationGuarded(async function (handlerContext) {
      var input = handlerContext.payload || {};
      if (!exactKeys(input, ['purpose'])
        || !['REFERENCE', 'SOURCE', 'MASK'].includes(input.purpose)) {
        throw handlerError('SS_ERP_BYOK_WORKBENCH_INPUT_INVALID');
      }
      var session = await claimLive(handlerContext.sender);
      var owner = editOwner(handlerContext.sender, session);
      await assertEditEpoch(owner);
      openEdit(owner);
      return prepareEditMedia(owner, input.purpose);
    });

    handlers[messageTypes.EDIT_MEDIA_RELEASE] = generationGuarded(async function (handlerContext) {
      var input = handlerContext.payload || {};
      if (!exactKeys(input, ['mediaHandle', 'purpose'])
        || !['REFERENCE', 'SOURCE', 'MASK'].includes(input.purpose)) {
        throw handlerError('SS_ERP_BYOK_WORKBENCH_INPUT_INVALID');
      }
      var session = await claimSession(handlerContext.sender);
      var owner = editOwner(handlerContext.sender, session);
      return { released: Boolean(releaseEditMedia(owner, input.mediaHandle, input.purpose)) };
    });

    handlers[messageTypes.EDIT_STATE] = generationGuarded(async function (handlerContext) {
      if (!exactKeys(handlerContext.payload || {}, [])) {
        throw handlerError('SS_ERP_BYOK_WORKBENCH_INPUT_INVALID');
      }
      var session = await claimLive(handlerContext.sender);
      var owner = editOwner(handlerContext.sender, session);
      var epoch = await assertEditEpoch(owner);
      if (!epoch || epoch.state === 'EMPTY') openEdit(owner);
      try {
        return getEditSnapshot(owner);
      } catch (error) {
        if (epoch && epoch.state === 'CURRENT') {
          throw handlerError('SS_ERP_BYOK_EDIT_WORKER_RESTARTED');
        }
        throw error;
      }
    });

    handlers[messageTypes.EDIT_REFERENCES] = generationGuarded(async function (handlerContext) {
      var input = handlerContext.payload || {};
      if (!exactKeys(input, ['scope', 'handles'])
        || !['SESSION_GLOBAL', 'SLOT'].includes(input.scope)
        || (input.handles !== null && !Array.isArray(input.handles))) {
        throw handlerError('SS_ERP_BYOK_WORKBENCH_INPUT_INVALID');
      }
      var session = await claimLive(handlerContext.sender);
      var owner = editOwner(handlerContext.sender, session);
      await assertEditEpoch(owner);
      openEdit(owner);
      return setEditReferences(owner, input.scope === 'SLOT'
        ? { scope: 'SLOT', slotKey: session.context.slotKey, handles: input.handles }
        : { scope: 'SESSION_GLOBAL', handles: input.handles });
    });

    handlers[messageTypes.EDIT_START] = generationGuarded(async function (handlerContext) {
      var transition = await withModeTransitionLock(handlerContext.sender, async function () {
        var session = await claimLive(handlerContext.sender);
        if (session.operation || session.result) {
          throw handlerError('SS_ERP_BYOK_WORKBENCH_MODE_CONFLICT');
        }
        var owner = editOwner(handlerContext.sender, session);
        openEdit(owner);
        return { owner: owner, epoch: await beginEditEpoch(owner) };
      });
      try {
        return await startEdit(transition.owner, handlerContext.payload || {});
      } catch (error) {
        if (transition.epoch && transition.epoch.created === true) {
          try { await clearEditEpoch(transition.owner); } catch (_error) {}
        }
        throw error;
      }
    });

    handlers[messageTypes.EDIT_SELECT] = generationGuarded(async function (handlerContext) {
      var input = handlerContext.payload || {};
      if (!exactKeys(input, ['attemptId'])) {
        throw handlerError('SS_ERP_BYOK_WORKBENCH_INPUT_INVALID');
      }
      return withModeTransitionLock(handlerContext.sender, async function () {
        var session = await claimLive(handlerContext.sender);
        if (session.operation || session.result) {
          throw handlerError('SS_ERP_BYOK_WORKBENCH_MODE_CONFLICT');
        }
        var owner = editOwner(handlerContext.sender, session);
        await assertEditEpoch(owner, { requireActive: true });
        openEdit(owner);
        return selectEditAlternative(owner, input);
      });
    });

    handlers[messageTypes.EDIT_REGENERATE] = generationGuarded(async function (handlerContext) {
      return withModeTransitionLock(handlerContext.sender, async function () {
        var session = await claimLive(handlerContext.sender);
        if (session.operation || session.result) {
          throw handlerError('SS_ERP_BYOK_WORKBENCH_MODE_CONFLICT');
        }
        var owner = editOwner(handlerContext.sender, session);
        await assertEditEpoch(owner, { requireActive: true });
        openEdit(owner);
        return regenerateEdit(owner, handlerContext.payload || {});
      });
    });

    handlers[messageTypes.EDIT_PREVIEW] = generationGuarded(async function (handlerContext) {
      var input = handlerContext.payload || {};
      if (!exactKeys(input, ['resultId'])) {
        throw handlerError('SS_ERP_BYOK_WORKBENCH_INPUT_INVALID');
      }
      var id = resultId(input.resultId);
      var session = await claimLive(handlerContext.sender);
      var owner = editOwner(handlerContext.sender, session);
      await assertEditEpoch(owner, { requireActive: true });
      openEdit(owner);
      var snapshot = getEditSnapshot(owner);
      if (!snapshot.alternatives.some(function (candidate) {
        return candidate.candidateId === id && candidate.state === 'CANDIDATE_READY';
      })) {
        throw handlerError('SS_ERP_BYOK_WORKBENCH_RESULT_NOT_FOUND');
      }
      var entry = getVaultEntry(id);
      await assertEditEntryAuthority(entry, session.context);
      return openPreview(entry);
    });

    handlers[messageTypes.EDIT_REVIEW] = generationGuarded(function (handlerContext) {
      return withModeTransitionLock(handlerContext.sender, function () {
        return withReviewLock(handlerContext.sender, async function () {
          var input = handlerContext.payload || {};
          if (!exactKeys(input, ['attemptId', 'expectedSlotRevision'])
            || !Number.isSafeInteger(input.expectedSlotRevision) || input.expectedSlotRevision < 1
            || typeof input.attemptId !== 'string'
            || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/u.test(input.attemptId)) {
            throw handlerError('SS_ERP_BYOK_WORKBENCH_INPUT_INVALID');
          }
          var session = await claimLive(handlerContext.sender);
          if (session.operation) throw handlerError('SS_ERP_BYOK_WORKBENCH_MODE_CONFLICT');
          var owner = editOwner(handlerContext.sender, session);
          var handoff = requiredMethod(editController, 'handoffForReview');
          var attached;
          if (session.result) {
            var receipt = session.result.editReviewHandoff;
            if (!receipt || receipt.attemptId !== input.attemptId
              || receipt.expectedSlotRevision !== input.expectedSlotRevision
              || receipt.resultId !== session.result.resultId
              || session.result.reviewState !== 'CANDIDATE_READY'
              || session.result.deliveryState !== 'NOT_INGESTED') {
              throw handlerError('SS_ERP_BYOK_WORKBENCH_RESULT_PENDING');
            }
            var replayEntry = getVaultEntry(receipt.resultId);
            await assertEditEntryAuthority(replayEntry, session.context);
            if (replayEntry.operation !== receipt.operation
              || replayEntry.reviewState !== 'CANDIDATE_READY') {
              throw handlerError('SS_ERP_BYOK_WORKBENCH_RESULT_REVIEW_INVALID');
            }
            try {
              var editor = getEditSnapshot(owner);
              if (editor.operation === null) cleanupEdit(owner);
              else await handoff(owner, input, async function () { return session; });
            } catch (error) {
              if (!error || error.code !== 'SS_ERP_BYOK_EDIT_OWNER_STALE') throw error;
            }
            attached = session;
          } else {
            await assertEditEpoch(owner, { requireActive: true });
            attached = await handoff(owner, input, async function (selection, assertSelectedCurrent) {
              var entry = assertSelectedCurrent();
              await assertEditEntryAuthority(entry, session.context);
              var currentSession = await claimLive(handlerContext.sender);
              if (!sameContext(currentSession.context, session.context)) {
                throw handlerError('SS_ERP_BYOK_WORKBENCH_CONTEXT_STALE');
              }
              await assertEditEntryAuthority(assertSelectedCurrent(), currentSession.context);
              return requiredMethod(sessionManager, 'attachEditResult')(
                handlerContext.sender, currentSession.context, selection,
              );
            });
          }
          await clearEditEpoch(owner);
          var acceptedEntry = getVaultEntry(attached.result.resultId);
          await assertEditEntryAuthority(acceptedEntry, session.context);
          return { ...getPublicResult(attached.result.resultId), deliveryState: 'NOT_INGESTED' };
        });
      });
    });

    handlers[messageTypes.EDIT_CLEANUP] = generationGuarded(async function (handlerContext) {
      return withModeTransitionLock(handlerContext.sender, async function () {
        var input = handlerContext.payload || {};
        var acknowledgement = exactKeys(input, ['restartAcknowledgement'])
          ? input.restartAcknowledgement
          : null;
        if (!exactKeys(input, []) && !acknowledgement) {
          throw handlerError('SS_ERP_BYOK_WORKBENCH_INPUT_INVALID');
        }
        var session = await claimSession(handlerContext.sender);
        var owner = editOwner(handlerContext.sender, session);
        if (acknowledgement) {
          var reset = await cleanupEditTab(owner.tabId);
          var acknowledged = await acknowledgeEditEpoch(owner, acknowledgement);
          return {
            cleaned: Boolean(reset && reset.cleaned),
            releasedResultCount: reset && reset.releasedResultCount || 0,
            externalChargeUnresolved: Boolean(reset && reset.externalChargeUnresolved),
            restartAcknowledged: true,
            clearedEpochCount: acknowledged.clearedCount,
          };
        }
        var cleaned = cleanupEdit(owner);
        if (cleaned.cleaned === true && cleaned.externalChargeUnresolved !== true) {
          await clearEditEpoch(owner);
        }
        return cleaned;
      });
    });

    handlers[messageTypes.GET_READINESS] = generationGuarded(async function (handlerContext) {
      var input = handlerContext.payload || {};
      if (!exactKeys(input, ['profileId'])) {
        throw handlerError('SS_ERP_BYOK_WORKBENCH_INPUT_INVALID');
      }
      var id = profileId(input.profileId);
      var session = await claimLive(handlerContext.sender);
      var readiness = await getReadiness(readinessRequest(id, session.context));
      if (!isRecord(readiness) || !isRecord(readiness.readinessBinding)
        || !bindingMatchesContext(readiness.readinessBinding, session.context)) {
        throw handlerError('SS_ERP_BYOK_WORKBENCH_CONTEXT_MISMATCH');
      }
      await requireReadyProfile(id, readiness);
      return readiness;
    });

    handlers[messageTypes.EXECUTE_PROVIDER] = generationGuarded(async function (handlerContext) {
      var readiness = handlerContext.authorization && handlerContext.authorization.readiness;
      var transition = await withModeTransitionLock(handlerContext.sender, async function () {
        var session = await claimLive(handlerContext.sender);
        var owner = editOwner(handlerContext.sender, session);
        var epoch = await assertEditEpoch(owner);
        if (epoch && epoch.state !== 'EMPTY') {
          throw handlerError('SS_ERP_BYOK_WORKBENCH_MODE_CONFLICT');
        }
        var binding = readiness && readiness.binding;
        if (!bindingMatchesContext(binding, session.context)) {
          throw handlerError('SS_ERP_BYOK_WORKBENCH_CONTEXT_MISMATCH');
        }
        var input = handlerContext.payload || {};
        if (session.result) {
          var replay = await readSessionResult(session, handlerContext.sender);
          if (replay && replay.idempotencyKey === input.idempotencyKey) {
            return { replay: replay };
          }
          throw handlerError('SS_ERP_BYOK_WORKBENCH_RESULT_PENDING');
        }
        await beginOperation(handlerContext.sender, input.idempotencyKey);
        return { binding: binding, input: input, owner: owner };
      });
      if (transition.replay) return transition.replay;
      var binding = transition.binding;
      var input = transition.input;
      var generated;
      try {
        var providerLease;
        try {
          providerLease = await acquireProviderLease(executionAuthority(
            transition.owner,
            readiness,
          ));
          generated = await generate({ ...input, readinessBinding: binding });
        } finally {
          if (providerLease) providerLease.release();
        }
        var authority = await captureAuthority(binding);
        var committed;
        try {
          committed = await commitResult(
            generated.idempotencyKey,
            generated.requestHash,
            function (currentGenerated) {
              return commitGeneratedResult({
                authority: authority,
                binding: binding,
                generated: currentGenerated,
                vault: vault,
              });
            },
          );
        } finally {
          releaseProviderResult(generated.idempotencyKey, generated.requestHash);
        }
        try {
          await attachResult(handlerContext.sender, {
            resultId: committed.resultId,
            reviewState: 'CANDIDATE_READY',
          }, generated.idempotencyKey);
        } catch (error) {
          releaseTemporaryResult(committed.resultId);
          throw error;
        }
        return committed;
      } catch (error) {
        if (error && error.code === 'SS_ERP_BYOK_PROVIDER_RESULT_RELEASED') {
          try {
            var recoveredOperation = getOperationState(input.idempotencyKey);
            var recovered = getPublicByOperation(input.idempotencyKey);
            var recoveredEntry = getVaultEntry(recovered.resultId);
            var recoveredAuthority = await captureAuthority(binding);
            if (recoveredOperation && recoveredOperation.requestHash === recovered.requestHash
              && matchesVaultAuthority(recoveredEntry, binding, recoveredAuthority)) {
              await attachResult(handlerContext.sender, {
                resultId: recovered.resultId,
                reviewState: recovered.reviewState,
              }, input.idempotencyKey);
              return recovered;
            }
          } catch (_recoveryError) {}
        }
        var failedOperation = null;
        try { failedOperation = getOperationState(input.idempotencyKey); } catch (_stateError) {}
        var outcomeUnresolved = Boolean(
          (error && error.code === 'SS_ERP_BYOK_PROVIDER_UNKNOWN_OUTCOME')
          || (failedOperation && failedOperation.dispatched === true),
        );
        if (!outcomeUnresolved) {
          try { await clearOperation(handlerContext.sender, input.idempotencyKey); } catch (_error) {}
        }
        throw error;
      }
    });

    handlers[messageTypes.OPEN_PREVIEW] = generationGuarded(async function (handlerContext) {
      var input = handlerContext.payload || {};
      if (!exactKeys(input, ['resultId'])) {
        throw handlerError('SS_ERP_BYOK_WORKBENCH_INPUT_INVALID');
      }
      var id = resultId(input.resultId);
      var session = await claimLive(handlerContext.sender);
      if (!session.result || session.result.resultId !== id) {
        throw handlerError('SS_ERP_BYOK_WORKBENCH_RESULT_NOT_FOUND');
      }
      var entry = getVaultEntry(id);
      await assertCandidateEntryAuthority(entry, session.context);
      return openPreview(entry);
    });

    handlers[messageTypes.SOURCE_CATALOG] = generationGuarded(async function (handlerContext) {
      if (!exactKeys(handlerContext.payload || {}, [])) {
        throw handlerError('SS_ERP_BYOK_WORKBENCH_INPUT_INVALID');
      }
      var session = await claimLive(handlerContext.sender);
      return loadSourceCatalog(session.context);
    });

    handlers[messageTypes.SOURCE_PREVIEW] = generationGuarded(async function (handlerContext) {
      var input = handlerContext.payload || {};
      if (!exactKeys(input, ['sourceMediaKey', 'purpose'])
        || !['THUMBNAIL', 'WORKING'].includes(input.purpose)) {
        throw handlerError('SS_ERP_BYOK_WORKBENCH_INPUT_INVALID');
      }
      var session = await claimLive(handlerContext.sender);
      return openSourcePreview(
        session.context,
        text(input.sourceMediaKey, 500, 'SS_ERP_BYOK_WORKBENCH_INPUT_INVALID'),
        input.purpose,
      );
    });

    handlers[messageTypes.REVIEW_RESULT] = generationGuarded(function (handlerContext) {
      return withReviewLock(handlerContext.sender, async function () {
        var input = handlerContext.payload || {};
        if (!exactKeys(input, ['resultId', 'decision'])
          || !['APPROVE', 'REJECT'].includes(input.decision)) {
          throw handlerError('SS_ERP_BYOK_WORKBENCH_INPUT_INVALID');
        }
        var id = resultId(input.resultId);
        var session = await claimLive(handlerContext.sender);
        if (!session.result || session.result.resultId !== id) {
          throw handlerError('SS_ERP_BYOK_WORKBENCH_RESULT_NOT_FOUND');
        }
        if (['INGESTING', 'BOUND'].includes(session.result.deliveryState)) {
          throw handlerError('SS_ERP_BYOK_WORKBENCH_RESULT_REVIEW_INVALID');
        }
        if (!['CANDIDATE_READY', 'APPROVED'].includes(session.result.reviewState)
          || (input.decision === 'APPROVE' && session.result.reviewState !== 'CANDIDATE_READY')) {
          throw handlerError('SS_ERP_BYOK_WORKBENCH_RESULT_REVIEW_INVALID');
        }
        var entry = getVaultEntry(id);
        await assertCandidateEntryAuthority(entry, session.context);
        if (input.decision === 'APPROVE') {
          var approved = approveResult(id, entry.binding);
          await setReviewState(handlerContext.sender, id, 'APPROVED');
          return { ...approved, deliveryState: 'NOT_INGESTED' };
        }
        var rejected = rejectResult(id, entry.binding);
        releasePreviewResult(id);
        await clearResult(handlerContext.sender, id);
        return rejected;
      });
    });

    handlers[messageTypes.INGEST] = generationGuarded(function (handlerContext) {
      return withReviewLock(handlerContext.sender, async function () {
        var input = handlerContext.payload || {};
        if (!exactKeys(input, ['resultId'])) {
          throw handlerError('SS_ERP_BYOK_WORKBENCH_INPUT_INVALID');
        }
        var id = resultId(input.resultId);
        var session = await claimLive(handlerContext.sender);
        if (!session.result || session.result.resultId !== id
          || session.result.reviewState !== 'APPROVED') {
          throw handlerError('SS_ERP_BYOK_WORKBENCH_RESULT_REVIEW_INVALID');
        }
        if (session.result.deliveryState === 'BOUND' && isRecord(session.result.ingest)) {
          return {
            resultId: id,
            reviewState: 'APPROVED',
            deliveryState: 'BOUND',
            ingest: session.result.ingest,
          };
        }
        if (session.result.deliveryState === 'INGESTING') {
          throw handlerError('SS_ERP_BYOK_INGEST_RECOVERY_REQUIRED');
        }
        if (session.result.deliveryState && session.result.deliveryState !== 'NOT_INGESTED') {
          throw handlerError('SS_ERP_BYOK_WORKBENCH_RESULT_REVIEW_INVALID');
        }
        var ingestIdempotencyKey = newIngestIdempotencyKey();
        var approvedEntry = getVaultEntry(id);
        var authority = await assertCandidateEntryAuthority(approvedEntry, session.context);
        var sessionAuthority = ingestAuthorityProjection(authority);
        await beginIngest(handlerContext.sender, id, ingestIdempotencyKey, sessionAuthority);
        var committedSession = null;
        var ingestInput = {
          resultId: id,
          shopId: session.context.shopId,
          workflowId: session.context.workflowId,
          draftRevision: session.context.draftRevision,
          draftVersion: session.context.draftVersion,
          skuKey: session.context.skuKey,
          slotKey: session.context.slotKey,
          assignmentMode: session.context.assignmentMode,
          replaceConfirmed: session.context.assignmentMode === 'REPLACE',
          assignmentOrdinal: session.context.assignmentOrdinal,
          idempotencyKey: ingestIdempotencyKey,
          requestHash: session.result.ingestRequestHash,
        };
        var accepted;
        try {
          accepted = await ingestApprovedResult(ingestInput, authority, async function (receipt) {
            committedSession = await setIngestResult(
              handlerContext.sender,
              id,
              ingestIdempotencyKey,
              sessionAuthority,
              receipt,
            );
          }, async function (requestHash) {
            await setIngestRequestHash(
              handlerContext.sender,
              id,
              ingestIdempotencyKey,
              requestHash,
            );
          });
        } catch (error) {
          await settleIngestFailure(handlerContext.sender, id, ingestIdempotencyKey, error);
          throw error;
        }
        if (!committedSession) {
          committedSession = await setIngestResult(
            handlerContext.sender,
            id,
            ingestIdempotencyKey,
            sessionAuthority,
            accepted,
          );
        }
        releasePreviewResult(id);
        return {
          resultId: id,
          reviewState: 'APPROVED',
          deliveryState: 'BOUND',
          ingest: committedSession.result.ingest,
        };
      });
    });

    handlers[messageTypes.RECOVER_INGEST] = generationGuarded(function (handlerContext) {
      return withReviewLock(handlerContext.sender, async function () {
        var input = handlerContext.payload || {};
        if (!exactKeys(input, ['resultId'])) {
          throw handlerError('SS_ERP_BYOK_WORKBENCH_INPUT_INVALID');
        }
        var id = resultId(input.resultId);
        var session = await claimLive(handlerContext.sender);
        if (!session.result || session.result.resultId !== id
          || session.result.reviewState !== 'APPROVED') {
          throw handlerError('SS_ERP_BYOK_INGEST_RECOVERY_UNAVAILABLE');
        }
        if (session.result.deliveryState === 'BOUND' && isRecord(session.result.ingest)) {
          return {
            resultId: id,
            reviewState: 'APPROVED',
            deliveryState: 'BOUND',
            ingest: session.result.ingest,
          };
        }
        if (session.result.deliveryState !== 'INGESTING'
          || !isRecord(session.result.ingestAuthority)) {
          throw handlerError('SS_ERP_BYOK_INGEST_RECOVERY_UNAVAILABLE');
        }
        var ingestIdempotencyKey = session.result.ingestIdempotencyKey;
        var authority = await captureAuthority(session.result.ingestAuthority);
        var sessionAuthority = ingestAuthorityProjection(authority);
        var committedSession = null;
        var ingestInput = {
          resultId: id,
          shopId: session.context.shopId,
          workflowId: session.context.workflowId,
          draftRevision: session.context.draftRevision,
          draftVersion: session.context.draftVersion,
          skuKey: session.context.skuKey,
          slotKey: session.context.slotKey,
          assignmentMode: session.context.assignmentMode,
          replaceConfirmed: session.context.assignmentMode === 'REPLACE',
          assignmentOrdinal: session.context.assignmentOrdinal,
          idempotencyKey: ingestIdempotencyKey,
          requestHash: session.result.ingestRequestHash,
        };
        var commitRecoveredReceipt = async function (receipt) {
          committedSession = await setIngestResult(
            handlerContext.sender,
            id,
            ingestIdempotencyKey,
            sessionAuthority,
            receipt,
          );
        };
        var accepted;
        try {
          accepted = await recoverIngestResult(
            ingestInput,
            authority,
            commitRecoveredReceipt,
          );
        } catch (error) {
          if (!error || error.code !== 'SS_ERP_BYOK_INGEST_RECEIPT_NOT_COMMITTED') {
            await settleIngestFailure(handlerContext.sender, id, ingestIdempotencyKey, error);
            throw error;
          }
          // The user explicitly requested recovery and the server proved that
          // no receipt exists yet. Reuse the same Blob, grant, and idempotency
          // identity when they are still available in this worker.
          try {
            var retryEntry = getVaultEntry(id);
            await assertCandidateEntryAuthority(retryEntry, session.context);
          } catch (_vaultError) {
            await clearResult(handlerContext.sender, id).catch(function () {});
            releasePreviewResult(id);
            throw handlerError('SS_ERP_BYOK_WORKBENCH_RESULT_NOT_FOUND');
          }
          try {
            accepted = await ingestApprovedResult(
              ingestInput,
              authority,
              commitRecoveredReceipt,
            );
          } catch (retryError) {
            await settleIngestFailure(
              handlerContext.sender,
              id,
              ingestIdempotencyKey,
              retryError,
            );
            throw retryError;
          }
        }
        if (!committedSession) {
          committedSession = await setIngestResult(
            handlerContext.sender,
            id,
            ingestIdempotencyKey,
            sessionAuthority,
            accepted,
          );
        }
        releasePreviewResult(id);
        return {
          resultId: id,
          reviewState: 'APPROVED',
          deliveryState: 'BOUND',
          ingest: committedSession.result.ingest,
        };
      });
    });

    handlers[messageTypes.PUBLISH] = guarded(function (handlerContext) {
      var input = handlerContext.payload || {};
      var action = input.action;
      var workspaceActions = [
        'WORKSPACE_PREVIEW', 'WORKSPACE_STATE', 'WORKSPACE_CONFIRM',
        'WORKSPACE_RECOVER', 'WORKSPACE_ACTIVE',
      ];
      var mutationActions = [
        'CONFIRM', 'RECOVER', 'WORKSPACE_CONFIRM', 'WORKSPACE_RECOVER',
      ];
      var operation = async function () {
        var localSession = await claimSession(handlerContext.sender);
        var reviewOnly = isReviewPublishContext(localSession.context);
        if (reviewOnly && !workspaceActions.includes(action)) {
          throw handlerError('SS_ERP_BYOK_WORKBENCH_REVIEW_ONLY');
        }
        if (workspaceActions.includes(action)) {
          var workspaceKeys = action === 'WORKSPACE_ACTIVE'
            ? ['action']
            : action === 'WORKSPACE_CONFIRM'
              ? ['action', 'request', 'previewHash']
              : ['action', 'request'];
          if (!exactKeys(input, workspaceKeys)
            || (action === 'WORKSPACE_CONFIRM'
              && (typeof input.previewHash !== 'string'
                || !/^[a-f0-9]{64}$/u.test(input.previewHash)))) {
            throw handlerError('SS_ERP_WORKBENCH_PUBLISH_INPUT_INVALID');
          }
          if (reviewOnly && action !== 'WORKSPACE_ACTIVE'
            && !reviewPublishRequestMatches(input.request, localSession.context)) {
            throw handlerError('SS_ERP_WORKBENCH_PUBLISH_CONTEXT_MISMATCH');
          }
          var workspaceSession = reviewOnly
            ? await claimLive(handlerContext.sender)
            : localSession;
          if (action === 'WORKSPACE_ACTIVE') {
            var active = await workspacePublishMethod('getActive')({
              shopId: workspaceSession.context.shopId,
              workflowId: workspaceSession.context.workflowId,
            });
            if (reviewOnly && active !== null
              && (!isRecord(active) || !reviewPublishRequestMatches(
                active.request,
                workspaceSession.context,
              ))) {
              throw handlerError('SS_ERP_WORKBENCH_PUBLISH_CONTEXT_MISMATCH');
            }
            return active;
          }
          var workspaceRequest = input.request;
          if (!isRecord(workspaceRequest)
            || !isRecord(workspaceRequest.binding)
            || workspaceRequest.binding.shopId !== workspaceSession.context.shopId
            || workspaceRequest.binding.workflowId !== workspaceSession.context.workflowId
            || (reviewOnly && !reviewPublishRequestMatches(
              workspaceRequest,
              workspaceSession.context,
            ))) {
            throw handlerError('SS_ERP_WORKBENCH_PUBLISH_CONTEXT_MISMATCH');
          }
          if (action === 'WORKSPACE_PREVIEW') {
            return workspacePublishMethod('preview')(workspaceRequest);
          }
          if (action === 'WORKSPACE_STATE') {
            return workspacePublishMethod('getState')(workspaceRequest);
          }
          if (action === 'WORKSPACE_RECOVER') {
            return workspacePublishMethod('recover')(workspaceRequest);
          }
          return workspacePublishMethod('confirm')({
            ...workspaceRequest,
            previewHash: input.previewHash,
          });
        }
        var expectedKeys = action === 'CONFIRM'
          ? ['action', 'previewHash']
          : ['action'];
        if (!exactKeys(input, expectedKeys)
          || !['PREVIEW', 'CONFIRM', 'RECOVER'].includes(action)
          || (action === 'CONFIRM'
            && (typeof input.previewHash !== 'string'
              || !/^[a-f0-9]{64}$/u.test(input.previewHash)))) {
          throw handlerError('SS_ERP_BYOK_PUBLISH_INPUT_INVALID');
        }
        var session = await claimLive(handlerContext.sender);
        var bound = publishInput(session);
        if (action === 'PREVIEW') return previewPublish(bound);
        if (action === 'RECOVER') return recoverPublish(bound);
        return confirmPublish({ ...bound, previewHash: input.previewHash });
      };
      return mutationActions.includes(action)
        ? withPublishLock(handlerContext.sender, operation)
        : operation();
    });

    async function openFromSource(value) {
      var sender = sourceSender(value && value.sourceSender);
      var sourceSelectionKey = value && value.sourceSelectionKey === null
        ? null
        : text(
          value && value.sourceSelectionKey,
          500,
          'SS_ERP_BYOK_WORKBENCH_LAUNCH_SENDER_DENIED',
        );
      var decision = await resolveLaunch(value && value.request);
      var choice = choiceRequiredLaunch(decision);
      if (choice) {
        var choiceSourceCurrent = await sourceRemainsCurrent({
          sourceSender: sender,
          request: value && value.request,
          sourceSelectionKey: sourceSelectionKey,
        });
        if (!choiceSourceCurrent) return Object.freeze({ state: 'stale' });
        return Object.freeze({
          state: 'choice_required',
          binding: choice.binding,
          skuKeys: choice.skuKeys,
        });
      }
      var context = readyLaunchContext(decision);
      if (!context) throw handlerError('SS_ERP_BYOK_WORKBENCH_LAUNCH_RESPONSE_INVALID');
      var readySourceCurrent = await sourceRemainsCurrent({
        sourceSender: sender,
        request: value && value.request,
        sourceSelectionKey: sourceSelectionKey,
      });
      if (!readySourceCurrent) return Object.freeze({ state: 'stale' });
      return openSession({
        context: context,
        sourceTabId: sender.tabId,
        sourceDocumentId: sender.documentId,
      });
    }

    async function removeTab(value) {
      if (!Number.isSafeInteger(value) || value < 0) return false;
      await cleanupEditTab(value);
      var session = await takeByTabIfIdle(value);
      if (!session) return false;
      if (typeof session.workbenchDocumentId === 'string' && session.workbenchDocumentId) {
        try {
          cancelProviderOwner(providerOwnerToken({
            tabId: session.workbenchTabId,
            documentId: session.workbenchDocumentId,
          }));
        } catch (_error) {}
      }
      if (session.result && session.result.resultId) {
        releaseTemporaryResult(session.result.resultId);
      }
      return true;
    }

    return Object.freeze({
      handlers: Object.freeze(handlers),
      openFromSource: openFromSource,
      removeTab: removeTab,
    });
  }

  global.SS_ERP_BYOK_WORKBENCH_RUNTIME_HANDLER = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    PUBLIC_STATE_VERSION: PUBLIC_STATE_VERSION,
    REVIEW_PUBLIC_STATE_VERSION: REVIEW_PUBLIC_STATE_VERSION,
    createDispatcher: createDispatcher,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
