(function exposeByokWorkbenchRuntimeHandler(global) {
  'use strict';

  var CONTRACT_VERSION = 'extension-byok-workbench-runtime-handler/v1';
  var PUBLIC_STATE_VERSION = 'extension-byok-workbench-public-state/v1';
  var OPERATION = 'TEXT_TO_IMAGE';
  var REQUEST_MODE = 'json';
  var CONTEXT_KEYS = [
    'sourcePlatform', 'sourceProductId', 'sourceCaptureSnapshotId', 'supplyGoodsId',
    'shopId', 'workflowId', 'draftRevision', 'draftVersion', 'skuKey', 'slotKey',
    'assignmentMode', 'assignmentOrdinal',
  ];

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
    return {
      ok: false,
      errorCode: /^[A-Z][A-Z0-9_]{0,99}$/u.test(candidate)
        ? candidate
        : 'SS_ERP_BYOK_WORKBENCH_OPERATION_FAILED',
      error: 'BYOK workbench operation failed',
    };
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

  function bindingMatchesContext(binding, context) {
    return isRecord(binding) && CONTEXT_KEYS.every(function (key) {
      return binding[key] === context[key];
    }) && binding.operation === OPERATION;
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

  function createDispatcher(options) {
    var config = options || {};
    var messageTypes = config.messageTypes;
    if (!isRecord(messageTypes)) {
      throw handlerError('SS_ERP_BYOK_WORKBENCH_DEPENDENCY_UNAVAILABLE');
    }
    var requiredTypes = [
      'GET_PUBLIC_STATE', 'GET_READINESS', 'EXECUTE_PROVIDER', 'OPEN_PREVIEW',
      'REVIEW_RESULT',
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
    var clearResult = requiredMethod(sessionManager, 'clearResult');
    var takeByTab = requiredMethod(sessionManager, 'takeByTab');
    var sameContext = requiredMethod(sessionManager, 'sameContext');
    var resolveLaunch = requiredMethod(config.launchClient, 'resolve');
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
    var now = typeof config.now === 'function' ? config.now : function () { return new Date(); };
    var reviewLocks = new Set();

    function currentMillis() {
      var value = new Date(now()).getTime();
      if (!Number.isFinite(value)) {
        throw handlerError('SS_ERP_BYOK_WORKBENCH_STATE_INVALID');
      }
      return value;
    }

    function releaseTemporaryResult(id) {
      try { releasePreviewResult(id); } catch (_error) {}
      try { return Boolean(releaseVaultResult(id)); } catch (_error) { return false; }
    }

    async function removeSession(session) {
      if (!session) return false;
      var removed = await takeByTab(session.workbenchTabId);
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
        throw error;
      }
      var resolved;
      try {
        resolved = await resolveLaunch(launchRequest(session.context));
      } catch (error) {
        if (error && Number(error.status) === 409) await removeSession(session);
        throw error;
      }
      if (!sameContext(session.context, resolved)) {
        await removeSession(session);
        throw handlerError('SS_ERP_BYOK_WORKBENCH_CONTEXT_STALE');
      }
      return session;
    }

    async function readSessionResult(session, sender) {
      if (!session.result) return null;
      try {
        return getPublicResult(session.result.resultId);
      } catch (_error) {
        try { await clearResult(sender, session.result.resultId); } catch (_clearError) {}
        try { releasePreviewResult(session.result.resultId); } catch (_previewError) {}
        return null;
      }
    }

    function evidenceProjection(value, current) {
      if (!isRecord(value) || value.operation !== OPERATION || value.requestMode !== REQUEST_MODE) {
        return null;
      }
      var expiresAt = typeof value.expiresAt === 'string' ? Date.parse(value.expiresAt) : NaN;
      var verifiedAt = typeof value.verifiedAt === 'string' ? Date.parse(value.verifiedAt) : NaN;
      if (!Number.isFinite(expiresAt) || !Number.isFinite(verifiedAt) || expiresAt <= current
        || typeof value.policyRevision !== 'string' || !value.policyRevision) {
        return null;
      }
      return Object.freeze({
        operation: OPERATION,
        requestMode: REQUEST_MODE,
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
        var evidence = (Array.isArray(state && state.evidence) ? state.evidence : [])
          .map(function (row) { return evidenceProjection(row, current); })
          .find(Boolean) || null;
        return Object.freeze({
          profile: selected,
          hasKey: Boolean(state && state.hasKey),
          permissionState: permissionState,
          textToImageEvidence: evidence,
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
        .map(function (row) { return evidenceProjection(row, current); })
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

    var handlers = {};

    handlers[messageTypes.GET_PUBLIC_STATE] = guarded(async function (handlerContext) {
      if (!exactKeys(handlerContext.payload || {}, [])) {
        throw handlerError('SS_ERP_BYOK_WORKBENCH_INPUT_INVALID');
      }
      var session = await claimLive(handlerContext.sender);
      var result = await readSessionResult(session, handlerContext.sender);
      return {
        contractVersion: PUBLIC_STATE_VERSION,
        executionMode: 'BYOK',
        context: session.context,
        profiles: await publicProfileStates(),
        result: result,
        generationOutcome: session.operation ? 'UNKNOWN_OUTCOME' : null,
        deliveryState: result && result.reviewState === 'APPROVED'
          ? 'NOT_INGESTED'
          : 'NOT_READY',
      };
    });

    handlers[messageTypes.GET_READINESS] = guarded(async function (handlerContext) {
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

    handlers[messageTypes.EXECUTE_PROVIDER] = guarded(async function (handlerContext) {
      var session = await claimLive(handlerContext.sender);
      var binding = handlerContext.authorization && handlerContext.authorization.readiness
        && handlerContext.authorization.readiness.binding;
      if (!bindingMatchesContext(binding, session.context)) {
        throw handlerError('SS_ERP_BYOK_WORKBENCH_CONTEXT_MISMATCH');
      }
      var input = handlerContext.payload || {};
      if (session.result) {
        var replay = await readSessionResult(session, handlerContext.sender);
        if (replay && replay.idempotencyKey === input.idempotencyKey) return replay;
        throw handlerError('SS_ERP_BYOK_WORKBENCH_RESULT_PENDING');
      }
      await beginOperation(handlerContext.sender, input.idempotencyKey);
      var generated;
      try {
        generated = await generate({ ...input, readinessBinding: binding });
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

    handlers[messageTypes.OPEN_PREVIEW] = guarded(async function (handlerContext) {
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
      await assertEntryAuthority(entry, session.context);
      return openPreview(entry);
    });

    handlers[messageTypes.REVIEW_RESULT] = guarded(function (handlerContext) {
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
        if (session.result.reviewState !== 'CANDIDATE_READY') {
          throw handlerError('SS_ERP_BYOK_WORKBENCH_RESULT_REVIEW_INVALID');
        }
        var entry = getVaultEntry(id);
        await assertEntryAuthority(entry, session.context);
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

    async function openFromSource(value) {
      var sender = sourceSender(value && value.sourceSender);
      var context = await resolveLaunch(value && value.request);
      return openSession({
        context: context,
        sourceTabId: sender.tabId,
        sourceDocumentId: sender.documentId,
      });
    }

    async function removeTab(value) {
      if (!Number.isSafeInteger(value) || value < 0) return false;
      var session = await takeByTab(value);
      if (!session) return false;
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
    createDispatcher: createDispatcher,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
