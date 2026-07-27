(function exposeByokWorkbenchBatchProviderExecutor(global) {
  'use strict';

  var CONTRACT_VERSION = 'extension-byok-workbench-batch-provider-executor/v1';
  var DISPATCH_VERSION = 'extension-byok-workbench-batch-provider-dispatch/v1';
  var BINDING_VERSION = 'extension-byok-readiness-binding/v2';
  var OPERATIONS = ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'];
  var BINDING_KEYS = [
    'contractVersion', 'ownerUserId', 'deviceSessionId', 'shopId', 'workflowId',
    'draftRevision', 'draftVersion', 'sourcePlatform', 'sourceProductId',
    'sourceCaptureSnapshotId', 'supplyGoodsId', 'skuKey', 'slotKey',
    'assignmentMode', 'assignmentOrdinal', 'providerOrigin', 'model', 'operation',
    'policyRevision',
  ];
  var ATTEMPT_KEYS = [
    'attemptId', 'slotKey', 'generation', 'operation', 'executionMode',
    'policyRevision', 'idempotencyKey', 'intentHash', 'retryOfAttemptId', 'retryRisk',
  ];
  var REQUEST_KEYS = [
    'contractVersion', 'batchId', 'resultBinding', 'attempt', 'dispatchInput', 'markWaiting',
  ];

  function executorError(code, outcome) {
    var error = new Error(code);
    error.name = 'ExtensionByokWorkbenchBatchProviderExecutorError';
    error.code = code;
    error.outcome = outcome || 'FAILED_FINAL';
    error.automaticRetryAllowed = error.outcome === 'FAILED_RETRYABLE';
    return error;
  }

  function invalid() {
    throw executorError('SS_ERP_BYOK_BATCH_PROVIDER_INPUT_INVALID', 'FAILED_FINAL');
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

  function text(value, maximum) {
    if (typeof value !== 'string' || !value || value.length > maximum
      || value !== value.normalize('NFKC').trim()
      || hasControlCharacter(value)) invalid();
    return value;
  }

  function identifier(value, maximum) {
    var result = text(value, maximum || 200);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u.test(result)) invalid();
    return result;
  }

  function sha256(value) {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) invalid();
    return value;
  }

  function providerOrigin(value) {
    var result = text(value, 300);
    var parsed;
    try { parsed = new global.URL(result); } catch { invalid(); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password
      || parsed.search || parsed.hash || parsed.pathname !== '/'
      || parsed.origin !== result) invalid();
    return result;
  }

  function normalizeBinding(value) {
    if (!exactKeys(value, BINDING_KEYS) || value.contractVersion !== BINDING_VERSION
      || !OPERATIONS.includes(value.operation)
      || !['1688', 'pdd', 'taobao', 'tmall'].includes(value.sourcePlatform)
      || value.assignmentMode !== 'APPEND'
      || !Number.isSafeInteger(value.draftRevision) || value.draftRevision < 1
      || !Number.isSafeInteger(value.draftVersion) || value.draftVersion < 1
      || !Number.isSafeInteger(value.assignmentOrdinal)
      || value.assignmentOrdinal < 0 || value.assignmentOrdinal > 499) invalid();
    var result = {};
    BINDING_KEYS.forEach(function (key) { result[key] = value[key]; });
    [
      ['ownerUserId', 200], ['deviceSessionId', 200], ['shopId', 200],
      ['workflowId', 200], ['sourceProductId', 200], ['sourceCaptureSnapshotId', 200],
      ['supplyGoodsId', 200], ['skuKey', 500], ['slotKey', 200], ['model', 200],
      ['policyRevision', 200],
    ].forEach(function (entry) { text(result[entry[0]], entry[1]); });
    result.providerOrigin = providerOrigin(result.providerOrigin);
    if (result.slotKey !== 'sku:' + result.skuKey + ':hero'
      && !['SCENE', 'DETAIL', 'SPEC', 'PACKAGING'].some(function (role) {
        return result.slotKey === 'shared:detail:' + role;
      })) invalid();
    return Object.freeze(result);
  }

  function normalizeAttempt(value, binding) {
    if (!exactKeys(value, ATTEMPT_KEYS) || value.executionMode !== 'BYOK'
      || value.slotKey !== binding.slotKey || value.operation !== binding.operation
      || value.policyRevision !== binding.policyRevision
      || !Number.isSafeInteger(value.generation) || value.generation < 1
      || (value.retryOfAttemptId !== null && typeof value.retryOfAttemptId !== 'string')
      || (value.retryRisk !== null && typeof value.retryRisk !== 'string')) invalid();
    return Object.freeze({
      attemptId: identifier(value.attemptId, 200),
      slotKey: binding.slotKey,
      generation: value.generation,
      operation: binding.operation,
      executionMode: 'BYOK',
      policyRevision: binding.policyRevision,
      idempotencyKey: identifier(value.idempotencyKey, 200),
      intentHash: sha256(value.intentHash),
      retryOfAttemptId: value.retryOfAttemptId === null
        ? null : identifier(value.retryOfAttemptId, 200),
      retryRisk: value.retryRisk === null ? null : text(value.retryRisk, 100),
    });
  }

  function assertDispatchInput(value) {
    if (!exactKeys(value, [
      'preparedRequestHandle', 'executionIntentId', 'providerRequestHash',
    ])
      || typeof value.preparedRequestHandle !== 'string'
      || !/^byok-prepared:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
        .test(value.preparedRequestHandle)) invalid();
    return Object.freeze({
      preparedRequestHandle: value.preparedRequestHandle,
      executionIntentId: identifier(value.executionIntentId, 200),
      providerRequestHash: sha256(value.providerRequestHash),
    });
  }

  function normalizeRequest(value) {
    if (!exactKeys(value, REQUEST_KEYS) || value.contractVersion !== DISPATCH_VERSION
      || typeof value.markWaiting !== 'function') invalid();
    var binding = normalizeBinding(value.resultBinding);
    return {
      batchId: identifier(value.batchId, 200),
      binding: binding,
      attempt: normalizeAttempt(value.attempt, binding),
      dispatchInput: assertDispatchInput(value.dispatchInput),
      markWaiting: value.markWaiting,
    };
  }

  function requiredMethod(value, name) {
    if (!value || typeof value[name] !== 'function') {
      throw executorError('SS_ERP_BYOK_BATCH_PROVIDER_DEPENDENCY_UNAVAILABLE', 'FAILED_FINAL');
    }
    return value[name].bind(value);
  }

  function createExecutor(options) {
    var textClient = options && options.textClient;
    var editClient = options && options.editClient;
    var dispatchText = requiredMethod(textClient, 'dispatchPrepared');
    var releasePreparedText = requiredMethod(textClient, 'releasePrepared');
    var commitText = requiredMethod(textClient, 'commitResult');
    var releaseText = requiredMethod(textClient, 'releaseResult');
    var dispatchEdit = requiredMethod(editClient, 'dispatchPrepared');
    var releasePreparedEdit = requiredMethod(editClient, 'releasePrepared');
    var commitEdit = requiredMethod(editClient, 'commitResult');
    var releaseEdit = requiredMethod(editClient, 'releaseResult');
    var captureAuthority = requiredMethod(options && options.authorityGuard, 'capture');
    var commitGeneratedResult = requiredMethod(
      options && options.authorityGuard,
      'commitGeneratedResult',
    );
    var getPublicResult = requiredMethod(options && options.vault, 'getPublic');
    var acquire = requiredMethod(options && options.providerSemaphore, 'acquire');
    var ownerToken = identifier(options && options.ownerToken, 500);
    var concurrency = options && options.concurrencyAuthority;
    if (!isRecord(concurrency)
      || text(concurrency.ownerUserId, 200) === ''
      || text(concurrency.deviceSessionId, 200) === ''
      || text(concurrency.policyRevision, 200) === ''
      || !Number.isSafeInteger(concurrency.maxConcurrency)
      || concurrency.maxConcurrency < 1 || concurrency.maxConcurrency > 4
      || typeof concurrency.expiresAt !== 'string' || !concurrency.expiresAt) invalid();

    async function execute(value) {
      var input = normalizeRequest(value);
      if (input.binding.ownerUserId !== concurrency.ownerUserId
        || input.binding.deviceSessionId !== concurrency.deviceSessionId
        || input.binding.policyRevision !== concurrency.policyRevision) invalid();
      var lease = null;
      var generated = null;
      var preparedConsumed = false;
      var preparedHandle = input.dispatchInput.preparedRequestHandle;
      var clientDispatch = input.binding.operation === 'TEXT_TO_IMAGE'
        ? dispatchText : dispatchEdit;
      var clientReleasePrepared = input.binding.operation === 'TEXT_TO_IMAGE'
        ? releasePreparedText : releasePreparedEdit;
      var clientCommit = input.binding.operation === 'TEXT_TO_IMAGE' ? commitText : commitEdit;
      var clientRelease = input.binding.operation === 'TEXT_TO_IMAGE' ? releaseText : releaseEdit;
      try {
        lease = await acquire({
          ownerToken: ownerToken,
          ownerUserId: concurrency.ownerUserId,
          deviceSessionId: concurrency.deviceSessionId,
          policyRevision: concurrency.policyRevision,
          maxConcurrency: concurrency.maxConcurrency,
          expiresAt: concurrency.expiresAt,
        });
        var authority = await captureAuthority(input.binding);
        if (input.markWaiting() !== true) {
          throw executorError('SS_ERP_BYOK_BATCH_PROVIDER_ATTEMPT_STALE', 'FAILED_FINAL');
        }
        var dispatchPromise = clientDispatch(preparedHandle);
        preparedConsumed = true;
        generated = await dispatchPromise;
        if (!isRecord(generated) || generated.outcome !== 'SUCCEEDED'
          || generated.operation !== input.binding.operation
          || generated.requestMode !== (input.binding.operation === 'TEXT_TO_IMAGE'
            ? 'json' : 'multipart')
          || generated.providerOrigin !== input.binding.providerOrigin
          || generated.model !== input.binding.model
          || generated.policyRevision !== input.binding.policyRevision
          || generated.executionIntentId !== input.dispatchInput.executionIntentId
          || generated.idempotencyKey !== input.attempt.idempotencyKey
          || generated.requestHash !== input.dispatchInput.providerRequestHash) {
          throw executorError('SS_ERP_BYOK_BATCH_PROVIDER_RESULT_INVALID', 'UNKNOWN_OUTCOME');
        }
        var committed = await clientCommit(
          generated.idempotencyKey,
          generated.requestHash,
          function (currentGenerated) {
            return commitGeneratedResult({
              authority: authority,
              binding: input.binding,
              generated: currentGenerated,
              vault: options.vault,
            });
          },
        );
        var publicResult = getPublicResult(committed && committed.resultId);
        if (!isRecord(committed) || !isRecord(publicResult)
          || committed.resultId !== publicResult.resultId
          || publicResult.operation !== input.binding.operation
          || publicResult.idempotencyKey !== input.attempt.idempotencyKey
          || publicResult.requestHash !== generated.requestHash
          || publicResult.reviewState !== 'CANDIDATE_READY'
          || !isRecord(publicResult.image) || !/^[a-f0-9]{64}$/u.test(publicResult.image.sha256)) {
          throw executorError('SS_ERP_BYOK_BATCH_PROVIDER_RESULT_INVALID', 'UNKNOWN_OUTCOME');
        }
        return Object.freeze({
          outcome: 'SUCCEEDED',
          candidateId: publicResult.resultId,
          resultHandle: publicResult.resultId,
          resultSha256: publicResult.image.sha256,
          requestHash: generated.requestHash,
        });
      } finally {
        if (!preparedConsumed) {
          try { clientReleasePrepared(preparedHandle); } catch {}
        }
        if (generated) {
          try { clientRelease(generated.idempotencyKey, generated.requestHash); } catch {}
        }
        try { if (lease && typeof lease.release === 'function') lease.release(); } catch {}
      }
    }

    return Object.freeze({ execute: execute });
  }

  global.SS_ERP_BYOK_WORKBENCH_BATCH_PROVIDER_EXECUTOR = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    DISPATCH_VERSION: DISPATCH_VERSION,
    createExecutor: createExecutor,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
