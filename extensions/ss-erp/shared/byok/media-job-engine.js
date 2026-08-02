(function exposeByokMediaJobEngine(global) {
  'use strict';

  var workbench = global.SS_ERP_AI_IMAGE_WORKBENCH_CONTRACT;
  if (!workbench || !workbench.LIMITS || typeof workbench.parseExecutionMode !== 'function') {
    throw new Error('SS_ERP_AI_IMAGE_WORKBENCH_CONTRACT is required');
  }

  var CONTRACT_VERSION = 'extension-byok-media-job-engine/v1';
  var EXTERNAL_CHARGE_WARNING_VERSION = 'external-provider-charge/v1';
  var DUPLICATE_CHARGE_WARNING_VERSION = 'external-provider-duplicate-charge/v1';
  var UNKNOWN_RECOVERY_REQUIREMENT =
    'PROVIDER_LOOKUP_OR_STABLE_IDEMPOTENCY_OR_EXPLICIT_DUPLICATE_CHARGE_CONFIRMATION';
  var OPERATIONS = Object.freeze([
    'TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT',
  ]);
  var ATTEMPT_STATES = Object.freeze([
    'QUEUED', 'SUBMITTING', 'WAITING', 'CANDIDATE_READY', 'FAILED_RETRYABLE',
    'FAILED_FINAL', 'UNKNOWN_OUTCOME', 'CANCELLED',
  ]);
  var MAX_ATTEMPTS = 500;
  var MAX_BATCH_SIZE = 100;

  function engineError(code, message) {
    var error = new Error(message || code);
    error.name = 'ExtensionByokMediaJobEngineError';
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

  function boundedId(value, label) {
    if (typeof value !== 'string') throw engineError(
      'SS_ERP_MEDIA_JOB_INPUT_INVALID', label + ' is invalid',
    );
    var normalized = value.normalize('NFKC').trim();
    if (normalized !== value
      || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/u.test(normalized)) {
      throw engineError('SS_ERP_MEDIA_JOB_INPUT_INVALID', label + ' is invalid');
    }
    return normalized;
  }

  function boundedSlotKey(value, label) {
    if (typeof value !== 'string') throw engineError(
      'SS_ERP_MEDIA_JOB_INPUT_INVALID', label + ' is invalid',
    );
    var normalized = value.normalize('NFKC').trim();
    if (normalized !== value || !normalized || normalized.length > 200
      // eslint-disable-next-line no-control-regex
      || /[\u0000-\u001f\u007f]/u.test(normalized)) {
      throw engineError('SS_ERP_MEDIA_JOB_INPUT_INVALID', label + ' is invalid');
    }
    if (/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/u.test(normalized)) return normalized;
    if (!normalized.startsWith('sku:') || !normalized.endsWith(':hero')) {
      throw engineError('SS_ERP_MEDIA_JOB_INPUT_INVALID', label + ' is invalid');
    }
    var skuKey = normalized.slice(4, -5);
    if (!skuKey || skuKey !== skuKey.normalize('NFKC').trim()
      // eslint-disable-next-line no-control-regex
      || /[\u0000-\u001f\u007f]/u.test(skuKey)) {
      throw engineError('SS_ERP_MEDIA_JOB_INPUT_INVALID', label + ' is invalid');
    }
    return normalized;
  }

  function sha256(value, label) {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
      throw engineError('SS_ERP_MEDIA_JOB_INPUT_INVALID', label + ' is invalid');
    }
    return value;
  }

  function safeSha256(value) {
    return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value) ? value : null;
  }

  function positiveConcurrency(value, label) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 1000) {
      throw engineError('SS_ERP_MEDIA_JOB_INPUT_INVALID', label + ' is invalid');
    }
    return value;
  }

  function normalizedConcurrencyAuthority(value) {
    if (!exactKeys(value, ['policyRevision', 'maxConcurrency'])) {
      throw engineError(
        'SS_ERP_MEDIA_JOB_INPUT_INVALID', 'concurrencyAuthority is invalid',
      );
    }
    var policyRevision = boundedId(value.policyRevision, 'policyRevision');
    if (!/^(?:0|[1-9][0-9]*)$/u.test(policyRevision)
      || !Number.isSafeInteger(Number(policyRevision))) {
      throw engineError('SS_ERP_MEDIA_JOB_INPUT_INVALID', 'policyRevision is invalid');
    }
    var maxConcurrency = positiveConcurrency(value.maxConcurrency, 'maxConcurrency');
    if (maxConcurrency > workbench.LIMITS.maxConcurrency) {
      throw engineError('SS_ERP_MEDIA_JOB_INPUT_INVALID', 'maxConcurrency is invalid');
    }
    return Object.freeze({
      policyRevision: policyRevision,
      maxConcurrency: maxConcurrency,
    });
  }

  function operation(value) {
    if (!OPERATIONS.includes(value)) throw engineError(
      'SS_ERP_MEDIA_JOB_INPUT_INVALID', 'operation is invalid',
    );
    return value;
  }

  function normalizedInitialJob(value) {
    if (!exactKeys(value, [
      'slotKey', 'operation', 'idempotencyKey', 'intentHash', 'dispatchRef',
    ])) {
      throw engineError('SS_ERP_MEDIA_JOB_INPUT_INVALID', 'media job input is invalid');
    }
    return {
      slotKey: boundedSlotKey(value.slotKey, 'slotKey'),
      operation: operation(value.operation),
      idempotencyKey: boundedId(value.idempotencyKey, 'idempotencyKey'),
      intentHash: sha256(value.intentHash, 'intentHash'),
      dispatchRef: boundedId(value.dispatchRef, 'dispatchRef'),
    };
  }

  function normalizedChargeAcknowledgement(value) {
    if (!exactKeys(value, ['warningVersion', 'confirmed'])
      || value.warningVersion !== EXTERNAL_CHARGE_WARNING_VERSION
      || value.confirmed !== true) {
      throw engineError(
        'SS_ERP_MEDIA_JOB_CHARGE_ACK_REQUIRED',
        'External Provider charge acknowledgement is required',
      );
    }
    return value.warningVersion;
  }

  function normalizedRegenerate(value, expectedSlotKey) {
    if (!exactKeys(value, [
      'slotKey', 'operation', 'idempotencyKey', 'intentHash', 'dispatchRef',
      'commandId', 'expectedSlotRevision', 'chargeAcknowledgement',
    ])) {
      throw engineError(
        'SS_ERP_MEDIA_JOB_CHARGE_ACK_REQUIRED',
        'External Provider charge acknowledgement is required',
      );
    }
    var normalized = normalizedInitialJob({
      slotKey: value.slotKey,
      operation: value.operation,
      idempotencyKey: value.idempotencyKey,
      intentHash: value.intentHash,
      dispatchRef: value.dispatchRef,
    });
    if (normalized.slotKey !== expectedSlotKey) throw engineError(
      'SS_ERP_MEDIA_JOB_INPUT_INVALID', 'regeneration slot does not match',
    );
    normalizedChargeAcknowledgement(value.chargeAcknowledgement);
    normalized.commandId = boundedId(value.commandId, 'commandId');
    if (!Number.isSafeInteger(value.expectedSlotRevision) || value.expectedSlotRevision < 1) {
      throw engineError('SS_ERP_MEDIA_JOB_INPUT_INVALID', 'expectedSlotRevision is invalid');
    }
    normalized.expectedSlotRevision = value.expectedSlotRevision;
    return normalized;
  }

  function normalizedUnknownRecovery(value) {
    if (!isRecord(value) || typeof value.strategy !== 'string') throw engineError(
      'SS_ERP_MEDIA_JOB_UNKNOWN_RECOVERY_REQUIRED',
      'Unknown Provider outcome requires explicit recovery authority',
    );
    if (value.strategy === 'TRUSTED_RECOVERY_REF') {
      if (!exactKeys(value, ['strategy', 'recoveryRef'])) throw engineError(
        'SS_ERP_MEDIA_JOB_UNKNOWN_RECOVERY_REQUIRED',
        'Unknown Provider outcome recovery reference is invalid',
      );
      return {
        strategy: value.strategy,
        recoveryRef: boundedId(value.recoveryRef, 'recoveryRef'),
      };
    }
    if (value.strategy === 'DUPLICATE_CHARGE_CONFIRMATION') {
      if (!exactKeys(value, ['strategy', 'warningVersion', 'confirmed'])
        || value.warningVersion !== DUPLICATE_CHARGE_WARNING_VERSION
        || value.confirmed !== true) throw engineError(
        'SS_ERP_MEDIA_JOB_UNKNOWN_RECOVERY_REQUIRED',
        'Duplicate Provider charge confirmation is required',
      );
      return {
        strategy: value.strategy,
        retryRisk: 'DUPLICATE_CHARGE_ACCEPTED',
        recoveryRef: null,
      };
    }
    throw engineError(
      'SS_ERP_MEDIA_JOB_UNKNOWN_RECOVERY_REQUIRED',
      'Unknown Provider outcome recovery strategy is unsupported',
    );
  }

  function normalizedRetry(value, priorState) {
    if (!isRecord(value)) throw engineError(
      'SS_ERP_MEDIA_JOB_INPUT_INVALID', 'retry input is invalid',
    );
    var common = [
      'idempotencyKey', 'intentHash', 'dispatchRef', 'commandId', 'expectedSlotRevision',
    ];
    var retryRisk = 'NEW_PROVIDER_CHARGE_ACCEPTED';
    var unknownOutcomeRecovery = null;
    if (priorState === 'UNKNOWN_OUTCOME') {
      if (!exactKeys(value, common.concat(['unknownOutcomeRecovery']))) throw engineError(
        'SS_ERP_MEDIA_JOB_UNKNOWN_RECOVERY_REQUIRED',
        'Unknown Provider outcome requires explicit recovery authority',
      );
      unknownOutcomeRecovery = normalizedUnknownRecovery(value.unknownOutcomeRecovery);
      retryRisk = unknownOutcomeRecovery.retryRisk || null;
    } else {
      if (!exactKeys(value, common.concat(['chargeAcknowledgement']))) throw engineError(
        'SS_ERP_MEDIA_JOB_CHARGE_ACK_REQUIRED',
        'External Provider charge acknowledgement is required',
      );
      normalizedChargeAcknowledgement(value.chargeAcknowledgement);
    }
    if (!Number.isSafeInteger(value.expectedSlotRevision) || value.expectedSlotRevision < 1) {
      throw engineError('SS_ERP_MEDIA_JOB_INPUT_INVALID', 'expectedSlotRevision is invalid');
    }
    return {
      idempotencyKey: boundedId(value.idempotencyKey, 'idempotencyKey'),
      intentHash: sha256(value.intentHash, 'intentHash'),
      dispatchRef: boundedId(value.dispatchRef, 'dispatchRef'),
      commandId: boundedId(value.commandId, 'commandId'),
      expectedSlotRevision: value.expectedSlotRevision,
      retryRisk: retryRisk,
      unknownOutcomeRecovery: unknownOutcomeRecovery,
    };
  }

  function safeErrorCode(value, fallback) {
    if (typeof value !== 'string') return fallback;
    var normalized = value.trim();
    return /^[A-Z][A-Z0-9_.:-]{0,99}$/u.test(normalized) ? normalized : fallback;
  }

  function normalizedDispatchResult(value) {
    if (!exactKeys(value, [
      'outcome', 'candidateId', 'resultHandle', 'resultSha256', 'requestHash',
    ])
      || value.outcome !== 'SUCCEEDED') {
      throw engineError('SS_ERP_MEDIA_JOB_RESULT_INVALID', 'Provider job result is invalid');
    }
    return {
      candidateId: boundedId(value.candidateId, 'candidateId'),
      resultHandle: boundedId(value.resultHandle, 'resultHandle'),
      resultSha256: sha256(value.resultSha256, 'resultSha256'),
      requestHash: sha256(value.requestHash, 'requestHash'),
    };
  }

  function normalizedTrustedRetryAuthority(value) {
    if (!exactKeys(value, ['kind', 'strategy', 'evidenceSha256'])
      || value.kind !== 'RETRY_AUTHORITY'
      || !['PROVIDER_LOOKUP_NOT_ACCEPTED', 'STABLE_IDEMPOTENCY'].includes(value.strategy)) {
      throw engineError(
        'SS_ERP_MEDIA_JOB_UNKNOWN_RECOVERY_REQUIRED',
        'Trusted unknown-outcome retry authority is invalid',
      );
    }
    return {
      strategy: value.strategy,
      evidenceSha256: sha256(value.evidenceSha256, 'evidenceSha256'),
      retryRisk: 'SAFE_RECOVERY_EVIDENCE',
    };
  }

  function normalizedUnknownResolution(value) {
    if (!isRecord(value) || value.kind !== 'LOOKUP_RESOLUTION'
      || typeof value.state !== 'string') throw engineError(
      'SS_ERP_MEDIA_JOB_UNKNOWN_RESOLUTION_INVALID',
      'Unknown Provider outcome resolution is invalid',
    );
    if (value.state === 'CANDIDATE_READY') {
      if (!exactKeys(value, [
        'kind', 'state', 'evidenceSha256', 'candidateId', 'resultHandle',
        'resultSha256', 'requestHash',
      ])) throw engineError(
        'SS_ERP_MEDIA_JOB_UNKNOWN_RESOLUTION_INVALID',
        'Unknown Provider success resolution is invalid',
      );
      return {
        state: value.state,
        evidenceSha256: sha256(value.evidenceSha256, 'evidenceSha256'),
        candidateId: boundedId(value.candidateId, 'candidateId'),
        resultHandle: boundedId(value.resultHandle, 'resultHandle'),
        resultSha256: sha256(value.resultSha256, 'resultSha256'),
        requestHash: sha256(value.requestHash, 'requestHash'),
        errorCode: null,
      };
    }
    if (value.state === 'FAILED_RETRYABLE' || value.state === 'FAILED_FINAL') {
      if (!exactKeys(value, [
        'kind', 'state', 'evidenceSha256', 'requestHash', 'errorCode',
      ])) throw engineError(
        'SS_ERP_MEDIA_JOB_UNKNOWN_RESOLUTION_INVALID',
        'Unknown Provider failure resolution is invalid',
      );
      return {
        state: value.state,
        evidenceSha256: sha256(value.evidenceSha256, 'evidenceSha256'),
        candidateId: null,
        resultHandle: null,
        resultSha256: null,
        requestHash: sha256(value.requestHash, 'requestHash'),
        errorCode: safeErrorCode(value.errorCode, 'SS_ERP_MEDIA_JOB_LOOKUP_FAILED'),
      };
    }
    throw engineError(
      'SS_ERP_MEDIA_JOB_UNKNOWN_RESOLUTION_INVALID',
      'Unknown Provider outcome resolution state is unsupported',
    );
  }

  function frozenAttempt(attempt) {
    return Object.freeze({
      attemptId: attempt.attemptId,
      slotKey: attempt.slotKey,
      generation: attempt.generation,
      operation: attempt.operation,
      executionMode: attempt.executionMode,
      policyRevision: attempt.policyRevision,
      idempotencyKey: attempt.idempotencyKey,
      intentHash: attempt.intentHash,
      providerRequestHash: attempt.providerRequestHash,
      state: attempt.state,
      candidateId: attempt.candidateId,
      resultHandle: attempt.resultHandle,
      resultSha256: attempt.resultSha256,
      errorCode: attempt.errorCode,
      automaticRetryAllowed: attempt.automaticRetryAllowed,
      recoveryRequirement: attempt.recoveryRequirement,
      retryOfAttemptId: attempt.retryOfAttemptId,
      externalChargePossible: attempt.externalChargePossible,
      retryRisk: attempt.retryRisk,
      unknownRecoveryStrategy: attempt.recoveryStrategy,
      recoveryEvidenceSha256: attempt.recoveryEvidenceSha256,
    });
  }

  function createEngine(options) {
    if (!exactKeys(options, [
      'executionMode', 'requestedConcurrency', 'concurrencyAuthority',
      'runnerMaxConcurrency', 'resultRetention', 'dispatch', 'resolveDispatchInput',
      'resolveRecovery',
    ]) || typeof options.dispatch !== 'function'
      || typeof options.resolveDispatchInput !== 'function'
      || typeof options.resolveRecovery !== 'function'
      || !exactKeys(options.resultRetention, ['pin', 'unpin'])
      || typeof options.resultRetention.pin !== 'function'
      || typeof options.resultRetention.unpin !== 'function') {
      throw engineError('SS_ERP_MEDIA_JOB_INPUT_INVALID', 'media job engine options are invalid');
    }
    var executionMode;
    try { executionMode = workbench.parseExecutionMode(options.executionMode); } catch {
      throw engineError('SS_ERP_MEDIA_JOB_INPUT_INVALID', 'executionMode is invalid');
    }
    var requestedConcurrency = positiveConcurrency(
      options.requestedConcurrency,
      'requestedConcurrency',
    );
    var concurrencyAuthority = normalizedConcurrencyAuthority(options.concurrencyAuthority);
    var runnerMaxConcurrency = positiveConcurrency(
      options.runnerMaxConcurrency,
      'runnerMaxConcurrency',
    );
    var effectiveConcurrency = Math.min(
      requestedConcurrency,
      concurrencyAuthority.maxConcurrency,
      runnerMaxConcurrency,
      workbench.LIMITS.maxConcurrency,
    );
    var policyRevision = concurrencyAuthority.policyRevision;
    var dispatch = options.dispatch;
    var resolveDispatchInput = options.resolveDispatchInput;
    var resolveRecovery = options.resolveRecovery;
    var resultRetention = options.resultRetention;
    var attempts = new Map();
    var attemptOrder = [];
    var slots = new Map();
    var slotOrder = [];
    var identityIndex = new Map();
    var commandIndex = new Map();
    var queue = [];
    var activeCount = 0;
    var activeSlots = new Set();
    var unknownRecoveryInFlight = new Set();
    var nextAttemptNumber = 1;
    var pauseRequested = false;
    var waiters = [];
    var listeners = new Set();

    function schedulerState() {
      if (pauseRequested && (activeCount > 0 || queue.length > 0)) {
        return activeCount > 0 ? 'PAUSING' : 'PAUSED';
      }
      if (activeCount > 0 || queue.length > 0) return 'RUNNING';
      if (!attemptOrder.length) return 'READY';
      var states = attemptOrder.map(function (attemptId) { return attempts.get(attemptId).state; });
      if (states.some(function (state) { return state === 'CANDIDATE_READY'; })) return 'REVIEW';
      if (states.every(function (state) { return state === 'CANCELLED'; })) return 'CANCELLED';
      return 'FAILED';
    }

    function publicSlot(slot) {
      var selected = slot.selectedAttemptId && attempts.get(slot.selectedAttemptId);
      return Object.freeze({
        slotKey: slot.slotKey,
        revision: slot.revision,
        attemptIds: Object.freeze(slot.attemptIds.slice()),
        selectedAttemptId: slot.selectedAttemptId,
        selectedCandidateId: selected && selected.candidateId || null,
      });
    }

    function getSnapshot() {
      return Object.freeze({
        contractVersion: CONTRACT_VERSION,
        executionMode: executionMode,
        policyRevision: policyRevision,
        policyMaxConcurrency: concurrencyAuthority.maxConcurrency,
        runnerMaxConcurrency: runnerMaxConcurrency,
        effectiveConcurrency: effectiveConcurrency,
        schedulerState: schedulerState(),
        activeCount: activeCount,
        queuedCount: queue.length,
        pauseRequested: pauseRequested,
        attempts: Object.freeze(attemptOrder.map(function (attemptId) {
          return frozenAttempt(attempts.get(attemptId));
        })),
        slots: Object.freeze(slotOrder.map(function (slotKey) {
          return publicSlot(slots.get(slotKey));
        })),
      });
    }

    function isSettled() {
      return activeCount === 0 && (queue.length === 0 || pauseRequested);
    }

    function resolveWaiters() {
      if (!isSettled() || !waiters.length) return;
      var current = waiters;
      waiters = [];
      var snapshot = getSnapshot();
      current.forEach(function (resolve) { resolve(snapshot); });
    }

    function emitSnapshot() {
      if (!listeners.size) return;
      var snapshot = getSnapshot();
      listeners.forEach(function (listener) {
        try { listener(snapshot); } catch {}
      });
    }

    function ensureIdentityAvailable(input) {
      if (identityIndex.has(input.idempotencyKey)) throw engineError(
        'SS_ERP_MEDIA_JOB_IDEMPOTENCY_CONFLICT',
        'Media job idempotency key is already retained',
      );
    }

    function ensureCapacity(count) {
      if (!Number.isSafeInteger(count) || count < 1
        || attemptOrder.length + count > MAX_ATTEMPTS) throw engineError(
        'SS_ERP_MEDIA_JOB_LIMIT_REACHED', 'Media job attempt limit was reached',
      );
    }

    function beginUnknownRecovery(attemptId) {
      if (unknownRecoveryInFlight.has(attemptId)) throw engineError(
        'SS_ERP_MEDIA_JOB_UNKNOWN_RECOVERY_IN_PROGRESS',
        'Unknown Provider outcome recovery is already in progress',
      );
      unknownRecoveryInFlight.add(attemptId);
    }

    function ensureSlot(slotKey) {
      var slot = slots.get(slotKey);
      if (!slot) {
        slot = { slotKey: slotKey, revision: 0, attemptIds: [], selectedAttemptId: null };
        slots.set(slotKey, slot);
        slotOrder.push(slotKey);
      }
      return slot;
    }

    function createAttempt(input, metadata) {
      ensureCapacity(1);
      if (!(metadata && metadata.allowIdentityReplay)) ensureIdentityAvailable(input);
      var slot = ensureSlot(input.slotKey);
      if (metadata && metadata.commandId) {
        if (commandIndex.has(metadata.commandId)) throw engineError(
          'SS_ERP_MEDIA_JOB_COMMAND_CONFLICT', 'Media job command was already consumed',
        );
        if (metadata.expectedSlotRevision !== slot.revision) throw engineError(
          'SS_ERP_MEDIA_JOB_SLOT_REVISION_STALE', 'Media slot revision changed',
        );
        if (slot.attemptIds.some(function (attemptId) {
          return ['QUEUED', 'SUBMITTING', 'WAITING'].includes(attempts.get(attemptId).state);
        })) throw engineError(
          'SS_ERP_MEDIA_JOB_SLOT_ACTIVE', 'Media slot already has active work',
        );
      } else if (slot.attemptIds.length > 0) {
        throw engineError(
          'SS_ERP_MEDIA_JOB_SLOT_EXISTS',
          'Existing media slots require retry or regenerate commands',
        );
      }
      var attemptId = 'attempt-' + String(nextAttemptNumber).padStart(6, '0');
      nextAttemptNumber += 1;
      var attempt = {
        attemptId: attemptId,
        slotKey: input.slotKey,
        generation: slot.attemptIds.length + 1,
        operation: input.operation,
        executionMode: executionMode,
        policyRevision: policyRevision,
        idempotencyKey: input.idempotencyKey,
        intentHash: input.intentHash,
        dispatchRef: input.dispatchRef,
        providerRequestHash: null,
        state: 'QUEUED',
        candidateId: null,
        resultHandle: null,
        resultSha256: null,
        errorCode: null,
        automaticRetryAllowed: null,
        recoveryRequirement: null,
        retryOfAttemptId: metadata && metadata.retryOfAttemptId || null,
        externalChargePossible: Boolean(metadata && metadata.externalChargePossible),
        retryRisk: metadata && metadata.retryRisk || null,
        recoveryStrategy: metadata && metadata.recoveryStrategy || null,
        recoveryEvidenceSha256: metadata && metadata.recoveryEvidenceSha256 || null,
      };
      attempts.set(attemptId, attempt);
      attemptOrder.push(attemptId);
      if (!identityIndex.has(input.idempotencyKey)) identityIndex.set(input.idempotencyKey, attemptId);
      if (metadata && metadata.commandId) commandIndex.set(metadata.commandId, attemptId);
      slot.attemptIds.push(attemptId);
      slot.revision += 1;
      queue.push(attemptId);
      return attempt;
    }

    function recordFailure(attempt, error) {
      attempt.providerRequestHash = safeSha256(error && error.requestHash);
      var outcome = error && error.outcome;
      var providerAccepted = attempt.state === 'WAITING';
      if (!providerAccepted && outcome === 'FAILED_RETRYABLE') {
        attempt.state = 'FAILED_RETRYABLE';
        attempt.errorCode = safeErrorCode(error.code, 'SS_ERP_MEDIA_JOB_FAILED_RETRYABLE');
        return;
      }
      if (!providerAccepted && outcome === 'FAILED_FINAL') {
        attempt.state = 'FAILED_FINAL';
        attempt.errorCode = safeErrorCode(error.code, 'SS_ERP_MEDIA_JOB_FAILED_FINAL');
        return;
      }
      attempt.state = 'UNKNOWN_OUTCOME';
      attempt.errorCode = safeErrorCode(error && error.code, 'SS_ERP_MEDIA_JOB_OUTCOME_UNKNOWN');
      attempt.automaticRetryAllowed = false;
      attempt.recoveryRequirement = UNKNOWN_RECOVERY_REQUIREMENT;
    }

    function startAttempt(attempt) {
      attempt.state = 'SUBMITTING';
      activeCount += 1;
      activeSlots.add(attempt.slotKey);
      slots.get(attempt.slotKey).revision += 1;
      (async function runAttempt() {
        var dispatchInput;
        try {
          try {
            dispatchInput = await resolveDispatchInput(
              attempt.dispatchRef,
              Object.freeze({
                contractVersion: CONTRACT_VERSION,
                attemptId: attempt.attemptId,
                slotKey: attempt.slotKey,
                generation: attempt.generation,
                operation: attempt.operation,
                executionMode: executionMode,
                policyRevision: policyRevision,
                idempotencyKey: attempt.idempotencyKey,
                intentHash: attempt.intentHash,
              }),
            );
            if (dispatchInput === undefined) throw new Error('dispatch input is unavailable');
          } catch {
            var resolutionError = engineError(
              'SS_ERP_MEDIA_JOB_DISPATCH_REF_UNAVAILABLE',
              'Media job dispatch reference is unavailable',
            );
            resolutionError.outcome = 'FAILED_RETRYABLE';
            throw resolutionError;
          }
          var result = normalizedDispatchResult(await dispatch(Object.freeze({
            contractVersion: CONTRACT_VERSION,
            attemptId: attempt.attemptId,
            slotKey: attempt.slotKey,
            generation: attempt.generation,
            operation: attempt.operation,
            executionMode: executionMode,
            policyRevision: policyRevision,
            idempotencyKey: attempt.idempotencyKey,
            intentHash: attempt.intentHash,
            dispatchInput: dispatchInput,
            retryOfAttemptId: attempt.retryOfAttemptId,
            retryRisk: attempt.retryRisk,
            markWaiting: function markWaiting() {
              if (attempt.state !== 'SUBMITTING') return false;
              attempt.state = 'WAITING';
              slots.get(attempt.slotKey).revision += 1;
              emitSnapshot();
              return true;
            },
          })));
          attempt.state = 'CANDIDATE_READY';
          attempt.candidateId = result.candidateId;
          attempt.resultHandle = result.resultHandle;
          attempt.resultSha256 = result.resultSha256;
          attempt.providerRequestHash = result.requestHash;
        } catch (error) {
          if (error && error.code === 'SS_ERP_BYOK_RESULT_VAULT_FULL') {
            pauseRequested = true;
          }
          recordFailure(attempt, error);
        } finally {
          dispatchInput = null;
          activeCount -= 1;
          activeSlots.delete(attempt.slotKey);
          slots.get(attempt.slotKey).revision += 1;
          schedule();
        }
      }());
    }

    function schedule() {
      if (!pauseRequested) {
        while (activeCount < effectiveConcurrency && queue.length > 0) {
          var eligibleIndex = queue.findIndex(function (attemptId) {
            var queuedAttempt = attempts.get(attemptId);
            return queuedAttempt && queuedAttempt.state === 'QUEUED'
              && !activeSlots.has(queuedAttempt.slotKey);
          });
          if (eligibleIndex < 0) break;
          var attemptId = queue.splice(eligibleIndex, 1)[0];
          var attempt = attempts.get(attemptId);
          if (attempt && attempt.state === 'QUEUED') startAttempt(attempt);
        }
      }
      emitSnapshot();
      resolveWaiters();
    }

    function enqueueBatch(values) {
      if (!Array.isArray(values) || values.length < 1 || values.length > MAX_BATCH_SIZE) {
        throw engineError('SS_ERP_MEDIA_JOB_INPUT_INVALID', 'media job batch is invalid');
      }
      ensureCapacity(values.length);
      var normalized = values.map(normalizedInitialJob);
      var pendingIds = new Set();
      var pendingSlots = new Set();
      normalized.forEach(function (input) {
        ensureIdentityAvailable(input);
        if (pendingIds.has(input.idempotencyKey)) throw engineError(
          'SS_ERP_MEDIA_JOB_IDEMPOTENCY_CONFLICT',
          'Media job batch contains a duplicate idempotency key',
        );
        pendingIds.add(input.idempotencyKey);
        if (slots.has(input.slotKey) || pendingSlots.has(input.slotKey)) throw engineError(
          'SS_ERP_MEDIA_JOB_SLOT_EXISTS',
          'Media job batch must contain one initial attempt per slot',
        );
        pendingSlots.add(input.slotKey);
      });
      var created = normalized.map(function (input) { return createAttempt(input, null); });
      schedule();
      return Object.freeze(created.map(frozenAttempt));
    }

    function enqueue(value) {
      return enqueueBatch([value])[0];
    }

    function pause() {
      pauseRequested = true;
      emitSnapshot();
      resolveWaiters();
      return getSnapshot();
    }

    function continueScheduling() {
      pauseRequested = false;
      schedule();
      return getSnapshot();
    }

    function cancelQueued(attemptIdValue) {
      var attemptId = boundedId(attemptIdValue, 'attemptId');
      var attempt = attempts.get(attemptId);
      if (!attempt || attempt.state !== 'QUEUED') {
        return Object.freeze({ cancelled: false, attemptId: attemptId });
      }
      attempt.state = 'CANCELLED';
      attempt.dispatchRef = null;
      queue = queue.filter(function (candidate) { return candidate !== attemptId; });
      slots.get(attempt.slotKey).revision += 1;
      emitSnapshot();
      resolveWaiters();
      return Object.freeze({ cancelled: true, attemptId: attemptId });
    }

    function selectCandidate(slotKeyValue, attemptIdValue) {
      var slotKey = boundedSlotKey(slotKeyValue, 'slotKey');
      var attemptId = boundedId(attemptIdValue, 'attemptId');
      var slot = slots.get(slotKey);
      var attempt = attempts.get(attemptId);
      if (!slot || !attempt || attempt.slotKey !== slotKey
        || attempt.state !== 'CANDIDATE_READY' || !attempt.candidateId) {
        throw engineError(
          'SS_ERP_MEDIA_JOB_SELECTION_INVALID', 'Candidate selection is invalid',
        );
      }
      if (slot.selectedAttemptId === attemptId) return publicSlot(slot);
      var prior = slot.selectedAttemptId && attempts.get(slot.selectedAttemptId);
      try {
        if (resultRetention.pin(attempt.resultHandle) !== true) throw new Error('pin failed');
      } catch {
        throw engineError(
          'SS_ERP_MEDIA_JOB_RESULT_RETENTION_FAILED',
          'Candidate bytes could not be retained',
        );
      }
      if (prior && prior.resultHandle) {
        try {
          resultRetention.unpin(prior.resultHandle);
        } catch {
          try { resultRetention.unpin(attempt.resultHandle); } catch {}
          throw engineError(
            'SS_ERP_MEDIA_JOB_RESULT_RETENTION_FAILED',
            'Prior candidate retention could not be released',
          );
        }
      }
      slot.selectedAttemptId = attemptId;
      slot.revision += 1;
      emitSnapshot();
      return publicSlot(slot);
    }

    function regenerate(slotKeyValue, value) {
      var slotKey = boundedSlotKey(slotKeyValue, 'slotKey');
      if (!slots.has(slotKey)) throw engineError(
        'SS_ERP_MEDIA_JOB_SLOT_NOT_FOUND', 'Media slot is not found',
      );
      ensureCapacity(1);
      var input = normalizedRegenerate(value, slotKey);
      var attempt = createAttempt(input, {
        externalChargePossible: true,
        retryRisk: 'NEW_PROVIDER_CHARGE_ACCEPTED',
        commandId: input.commandId,
        expectedSlotRevision: input.expectedSlotRevision,
      });
      schedule();
      return frozenAttempt(attempt);
    }

    async function retryAttempt(attemptIdValue, value) {
      var attemptId = boundedId(attemptIdValue, 'attemptId');
      var prior = attempts.get(attemptId);
      if (!prior || !['FAILED_RETRYABLE', 'UNKNOWN_OUTCOME'].includes(prior.state)) {
        throw engineError('SS_ERP_MEDIA_JOB_RETRY_NOT_ALLOWED', 'Media job retry is not allowed');
      }
      ensureCapacity(1);
      var retry = normalizedRetry(value, prior.state);
      if (retry.intentHash !== prior.intentHash) throw engineError(
        'SS_ERP_MEDIA_JOB_RETRY_REQUEST_MISMATCH',
        'Media job retry must preserve the original intent hash',
      );
      var recoveryStrategy = null;
      var recoveryEvidenceSha256 = null;
      var retryRisk = retry.retryRisk;
      var allowIdentityReplay = false;
      if (prior.state === 'UNKNOWN_OUTCOME'
        && unknownRecoveryInFlight.has(prior.attemptId)) {
        throw engineError(
          'SS_ERP_MEDIA_JOB_UNKNOWN_RECOVERY_IN_PROGRESS',
          'Unknown Provider outcome recovery is already in progress',
        );
      }
      if (prior.state === 'UNKNOWN_OUTCOME'
        && retry.unknownOutcomeRecovery.strategy === 'TRUSTED_RECOVERY_REF') {
        var trusted;
        beginUnknownRecovery(prior.attemptId);
        try {
          try {
            trusted = normalizedTrustedRetryAuthority(await resolveRecovery(Object.freeze({
              purpose: 'RETRY',
              recoveryRef: retry.unknownOutcomeRecovery.recoveryRef,
              attempt: frozenAttempt(prior),
            })));
          } catch (error) {
            if (error && error.name === 'ExtensionByokMediaJobEngineError') throw error;
            throw engineError(
              'SS_ERP_MEDIA_JOB_UNKNOWN_RECOVERY_REQUIRED',
              'Trusted unknown-outcome retry authority is unavailable',
            );
          }
        } finally {
          unknownRecoveryInFlight.delete(prior.attemptId);
        }
        recoveryStrategy = trusted.strategy;
        recoveryEvidenceSha256 = trusted.evidenceSha256;
        retryRisk = trusted.retryRisk;
        if (trusted.strategy === 'STABLE_IDEMPOTENCY') {
          if (retry.idempotencyKey !== prior.idempotencyKey) throw engineError(
            'SS_ERP_MEDIA_JOB_STABLE_IDEMPOTENCY_MISMATCH',
            'Stable idempotency recovery must reuse the original key',
          );
          allowIdentityReplay = true;
        } else if (retry.idempotencyKey === prior.idempotencyKey) {
          throw engineError(
            'SS_ERP_MEDIA_JOB_IDEMPOTENCY_CONFLICT',
            'Lookup-confirmed retry requires a new idempotency key',
          );
        }
      } else if (prior.state === 'UNKNOWN_OUTCOME') {
        recoveryStrategy = 'DUPLICATE_CHARGE_CONFIRMATION';
      }
      var created = createAttempt({
        slotKey: prior.slotKey,
        operation: prior.operation,
        idempotencyKey: retry.idempotencyKey,
        intentHash: retry.intentHash,
        dispatchRef: retry.dispatchRef,
      }, {
        retryOfAttemptId: prior.attemptId,
        externalChargePossible: true,
        retryRisk: retryRisk,
        recoveryStrategy: recoveryStrategy,
        recoveryEvidenceSha256: recoveryEvidenceSha256,
        commandId: retry.commandId,
        expectedSlotRevision: retry.expectedSlotRevision,
        allowIdentityReplay: allowIdentityReplay,
      });
      schedule();
      return frozenAttempt(created);
    }

    async function resolveUnknownAttempt(attemptIdValue, recoveryRefValue) {
      var attemptId = boundedId(attemptIdValue, 'attemptId');
      var attempt = attempts.get(attemptId);
      if (!attempt || attempt.state !== 'UNKNOWN_OUTCOME') throw engineError(
        'SS_ERP_MEDIA_JOB_UNKNOWN_RESOLUTION_INVALID',
        'Only an unknown Provider outcome can be resolved',
      );
      var recoveryRef = boundedId(recoveryRefValue, 'recoveryRef');
      beginUnknownRecovery(attempt.attemptId);
      try {
        var resolution;
        try {
          resolution = normalizedUnknownResolution(await resolveRecovery(Object.freeze({
            purpose: 'RESOLVE',
            recoveryRef: recoveryRef,
            attempt: frozenAttempt(attempt),
          })));
        } catch (error) {
          if (error && error.name === 'ExtensionByokMediaJobEngineError') throw error;
          throw engineError(
            'SS_ERP_MEDIA_JOB_UNKNOWN_RESOLUTION_INVALID',
            'Trusted Provider lookup resolution is unavailable',
          );
        }
        attempt.state = resolution.state;
        attempt.candidateId = resolution.candidateId;
        attempt.resultHandle = resolution.resultHandle;
        attempt.resultSha256 = resolution.resultSha256;
        attempt.providerRequestHash = resolution.requestHash;
        attempt.errorCode = resolution.errorCode;
        attempt.automaticRetryAllowed = null;
        attempt.recoveryRequirement = null;
        attempt.recoveryStrategy = 'PROVIDER_LOOKUP';
        attempt.recoveryEvidenceSha256 = resolution.evidenceSha256;
        slots.get(attempt.slotKey).revision += 1;
        emitSnapshot();
        resolveWaiters();
        return frozenAttempt(attempt);
      } finally {
        unknownRecoveryInFlight.delete(attempt.attemptId);
      }
    }

    function getAttempt(attemptIdValue) {
      var attemptId = boundedId(attemptIdValue, 'attemptId');
      var attempt = attempts.get(attemptId);
      return attempt ? frozenAttempt(attempt) : null;
    }

    function whenSettled() {
      if (isSettled()) return Promise.resolve(getSnapshot());
      return new Promise(function (resolve) { waiters.push(resolve); });
    }

    function subscribe(listener) {
      if (typeof listener !== 'function') throw engineError(
        'SS_ERP_MEDIA_JOB_INPUT_INVALID', 'media job listener is invalid',
      );
      listeners.add(listener);
      try { listener(getSnapshot()); } catch {}
      var active = true;
      return function unsubscribe() {
        if (!active) return false;
        active = false;
        return listeners.delete(listener);
      };
    }

    return Object.freeze({
      enqueue: enqueue,
      enqueueBatch: enqueueBatch,
      pause: pause,
      continue: continueScheduling,
      cancelQueued: cancelQueued,
      selectCandidate: selectCandidate,
      regenerate: regenerate,
      retryAttempt: retryAttempt,
      resolveUnknownAttempt: resolveUnknownAttempt,
      getAttempt: getAttempt,
      getSnapshot: getSnapshot,
      whenSettled: whenSettled,
      subscribe: subscribe,
    });
  }

  global.SS_ERP_BYOK_MEDIA_JOB_ENGINE = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    OPERATIONS: OPERATIONS,
    ATTEMPT_STATES: ATTEMPT_STATES,
    EXTERNAL_CHARGE_WARNING_VERSION: EXTERNAL_CHARGE_WARNING_VERSION,
    DUPLICATE_CHARGE_WARNING_VERSION: DUPLICATE_CHARGE_WARNING_VERSION,
    UNKNOWN_RECOVERY_REQUIREMENT: UNKNOWN_RECOVERY_REQUIREMENT,
    createEngine: createEngine,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
