(function exposeByokWorkbenchEditController(global) {
  'use strict';

  var CONTRACT_VERSION = 'extension-byok-workbench-edit-controller/v1';
  var CONTEXT_VERSION = 'extension-byok-workbench-launch-context/v1';
  var BINDING_VERSION = 'extension-byok-readiness-binding/v2';
  var INTERNAL_MASK_SEMANTICS = 'WHITE_EDIT_BLACK_PRESERVE_V1';
  var OPERATIONS = Object.freeze(['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT']);
  var MIME_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp']);
  var MEDIA_PURPOSES = Object.freeze({
    IMAGE_TO_IMAGE_REFERENCE: 'IMAGE_TO_IMAGE_REFERENCE',
    FULL_EDIT_SOURCE: 'FULL_EDIT_SOURCE',
    INPAINT_SOURCE: 'INPAINT_SOURCE',
    INPAINT_MASK: 'INPAINT_MASK',
  });
  var CONTEXT_KEYS = [
    'contractVersion', 'sourcePlatform', 'sourceProductId', 'sourceCaptureSnapshotId',
    'supplyGoodsId', 'shopId', 'workflowId', 'draftRevision', 'draftVersion', 'skuKey',
    'slotKey', 'assignmentMode', 'assignmentOrdinal',
  ];
  var BINDING_KEYS = [
    'contractVersion', 'ownerUserId', 'deviceSessionId', 'shopId', 'workflowId',
    'draftRevision', 'draftVersion', 'sourcePlatform', 'sourceProductId',
    'sourceCaptureSnapshotId', 'supplyGoodsId', 'skuKey', 'slotKey',
    'assignmentMode', 'assignmentOrdinal', 'providerOrigin', 'model', 'operation',
    'policyRevision',
  ];
  var COMMAND_KEYS = [
    'profileId', 'operation', 'prompt', 'negativePrompt', 'size', 'sourceHandle',
    'maskHandle',
  ];
  var MAX_DIMENSION = 4096;
  var MAX_PIXELS = MAX_DIMENSION * MAX_DIMENSION;

  function controllerError(code, outcome) {
    var error = new Error(code);
    error.name = 'ExtensionByokWorkbenchEditControllerError';
    error.code = code;
    if (outcome) error.outcome = outcome;
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

  function hasControlCharacters(value) {
    for (var index = 0; index < value.length; index += 1) {
      var code = value.charCodeAt(index);
      if (code <= 31 || code === 127) return true;
    }
    return false;
  }

  function canonicalText(value, maximum, code) {
    if (typeof value !== 'string' || !value || value.length > maximum
      || value !== value.normalize('NFKC').trim()
      || hasControlCharacters(value)) {
      throw controllerError(code || 'SS_ERP_BYOK_EDIT_INPUT_INVALID', 'FAILED_RETRYABLE');
    }
    return value;
  }

  function boundedId(value, code) {
    var normalized = canonicalText(value, 200, code);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/u.test(normalized)) {
      throw controllerError(code || 'SS_ERP_BYOK_EDIT_INPUT_INVALID', 'FAILED_RETRYABLE');
    }
    return normalized;
  }

  function positiveInteger(value, code) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw controllerError(code || 'SS_ERP_BYOK_EDIT_INPUT_INVALID', 'FAILED_RETRYABLE');
    }
    return value;
  }

  function normalizeContext(value) {
    var code = 'SS_ERP_BYOK_EDIT_OWNER_INVALID';
    if (!exactKeys(value, CONTEXT_KEYS) || value.contractVersion !== CONTEXT_VERSION) {
      throw controllerError(code, 'FAILED_FINAL');
    }
    var sourcePlatform = canonicalText(value.sourcePlatform, 16, code);
    var skuKey = canonicalText(value.skuKey, 500, code);
    var slotKey = canonicalText(value.slotKey, 200, code);
    if (!['1688', 'pdd', 'taobao', 'tmall'].includes(sourcePlatform)
      || value.assignmentMode !== 'APPEND'
      || slotKey !== 'sku:' + skuKey + ':hero'
      || !Number.isSafeInteger(value.assignmentOrdinal)
      || value.assignmentOrdinal < 0 || value.assignmentOrdinal > 499) {
      throw controllerError(code, 'FAILED_FINAL');
    }
    return Object.freeze({
      contractVersion: CONTEXT_VERSION,
      sourcePlatform: sourcePlatform,
      sourceProductId: canonicalText(value.sourceProductId, 200, code),
      sourceCaptureSnapshotId: canonicalText(value.sourceCaptureSnapshotId, 200, code),
      supplyGoodsId: canonicalText(value.supplyGoodsId, 200, code),
      shopId: canonicalText(value.shopId, 200, code),
      workflowId: canonicalText(value.workflowId, 200, code),
      draftRevision: positiveInteger(value.draftRevision, code),
      draftVersion: positiveInteger(value.draftVersion, code),
      skuKey: skuKey,
      slotKey: slotKey,
      assignmentMode: 'APPEND',
      assignmentOrdinal: value.assignmentOrdinal,
    });
  }

  function normalizeOwner(value) {
    var code = 'SS_ERP_BYOK_EDIT_OWNER_INVALID';
    if (!exactKeys(value, ['tabId', 'documentId', 'context'])
      || !Number.isSafeInteger(value.tabId) || value.tabId < 0) {
      throw controllerError(code, 'FAILED_FINAL');
    }
    var normalized = {
      tabId: value.tabId,
      documentId: canonicalText(value.documentId, 200, code),
      context: normalizeContext(value.context),
    };
    Object.defineProperty(normalized, 'fingerprint', {
      value: JSON.stringify(normalized),
      enumerable: false,
      configurable: false,
      writable: false,
    });
    return Object.freeze(normalized);
  }

  function normalizeHandle(value) {
    return boundedId(value, 'SS_ERP_BYOK_EDIT_MEDIA_HANDLE_INVALID');
  }

  function normalizeHandles(value) {
    if (!Array.isArray(value) || value.length > 4) {
      throw controllerError('SS_ERP_BYOK_EDIT_REFERENCE_COUNT_INVALID', 'FAILED_RETRYABLE');
    }
    var seen = new Set();
    return Object.freeze(value.map(function (item) {
      var handle = normalizeHandle(item);
      if (seen.has(handle)) {
        throw controllerError('SS_ERP_BYOK_EDIT_REFERENCE_COUNT_INVALID', 'FAILED_RETRYABLE');
      }
      seen.add(handle);
      return handle;
    }));
  }

  function promptText(value, maximum, nullable) {
    if (nullable && value === null) return null;
    if (typeof value !== 'string' || value !== value.normalize('NFKC').trim()
      || (!nullable && !value) || value.length > maximum
      || hasControlCharacters(value)) {
      throw controllerError('SS_ERP_BYOK_EDIT_INPUT_INVALID', 'FAILED_RETRYABLE');
    }
    return value || null;
  }

  function normalizeSize(value) {
    if (typeof value !== 'string' || !/^\d{1,4}x\d{1,4}$/u.test(value)) {
      throw controllerError('SS_ERP_BYOK_EDIT_INPUT_INVALID', 'FAILED_RETRYABLE');
    }
    var parts = value.split('x').map(Number);
    if (parts.some(function (part) {
      return !Number.isSafeInteger(part) || part < 1 || part > MAX_DIMENSION;
    }) || parts[0] * parts[1] > MAX_PIXELS) {
      throw controllerError('SS_ERP_BYOK_EDIT_INPUT_INVALID', 'FAILED_RETRYABLE');
    }
    return value;
  }

  function normalizeCommand(value) {
    if (!exactKeys(value, COMMAND_KEYS) || !OPERATIONS.includes(value.operation)) {
      throw controllerError('SS_ERP_BYOK_EDIT_INPUT_INVALID', 'FAILED_RETRYABLE');
    }
    var sourceHandle = value.sourceHandle === null ? null : normalizeHandle(value.sourceHandle);
    var maskHandle = value.maskHandle === null ? null : normalizeHandle(value.maskHandle);
    if ((value.operation === 'IMAGE_TO_IMAGE' && (sourceHandle !== null || maskHandle !== null))
      || (value.operation === 'FULL_EDIT' && (sourceHandle === null || maskHandle !== null))
      || (value.operation === 'INPAINT' && (sourceHandle === null || maskHandle === null))) {
      throw controllerError('SS_ERP_BYOK_EDIT_INPUT_INVALID', 'FAILED_RETRYABLE');
    }
    return Object.freeze({
      profileId: boundedId(value.profileId, 'SS_ERP_BYOK_EDIT_INPUT_INVALID'),
      operation: value.operation,
      prompt: promptText(value.prompt, 8000, false),
      negativePrompt: promptText(value.negativePrompt, 4000, true),
      size: normalizeSize(value.size),
      sourceHandle: sourceHandle,
      maskHandle: maskHandle,
    });
  }

  function normalizeRegeneration(value) {
    var keys = COMMAND_KEYS.concat(['expectedSlotRevision', 'chargeAcknowledgement']);
    if (!exactKeys(value, keys) || !Number.isSafeInteger(value.expectedSlotRevision)
      || value.expectedSlotRevision < 1 || !isRecord(value.chargeAcknowledgement)) {
      throw controllerError('SS_ERP_BYOK_EDIT_INPUT_INVALID', 'FAILED_RETRYABLE');
    }
    var commandValue = {};
    COMMAND_KEYS.forEach(function (key) { commandValue[key] = value[key]; });
    return {
      command: normalizeCommand(commandValue),
      expectedSlotRevision: value.expectedSlotRevision,
      chargeAcknowledgement: value.chargeAcknowledgement,
    };
  }

  function requiredMethod(value, name) {
    if (!value || typeof value[name] !== 'function') {
      throw controllerError('SS_ERP_BYOK_EDIT_DEPENDENCY_UNAVAILABLE', 'FAILED_FINAL');
    }
    return value[name].bind(value);
  }

  function safeDependencyFailure(error, fallbackCode) {
    if (error && typeof error.outcome === 'string') return error;
    var candidate = error && typeof error.code === 'string' ? error.code : '';
    var code = /^[A-Z][A-Z0-9_]{0,99}$/u.test(candidate) ? candidate : fallbackCode;
    return controllerError(code, 'FAILED_RETRYABLE');
  }

  function hex(bytes) {
    return Array.from(bytes).map(function (byte) {
      return byte.toString(16).padStart(2, '0');
    }).join('');
  }

  function createController(options) {
    var config = options || {};
    var engineApi = config.mediaJobEngine;
    if (!engineApi || typeof engineApi.createEngine !== 'function'
      || typeof engineApi.EXTERNAL_CHARGE_WARNING_VERSION !== 'string') {
      throw controllerError('SS_ERP_BYOK_EDIT_DEPENDENCY_UNAVAILABLE', 'FAILED_FINAL');
    }
    var getReadiness = requiredMethod(config.readinessClient, 'getReadiness');
    var editImage = requiredMethod(config.imageEditClient, 'edit');
    var commitEditResult = requiredMethod(config.imageEditClient, 'commitResult');
    var releaseEditResult = requiredMethod(config.imageEditClient, 'releaseResult');
    var vault = config.generatedResultVault;
    var getVaultResult = requiredMethod(vault, 'getForBackground');
    var pinSelection = requiredMethod(vault, 'pinSelection');
    var unpinSelection = requiredMethod(vault, 'unpinSelection');
    var releaseVaultResult = requiredMethod(vault, 'release');
    var captureAuthority = requiredMethod(config.authorityGuard, 'capture');
    var commitGeneratedResult = requiredMethod(config.authorityGuard, 'commitGeneratedResult');
    var getMedia = requiredMethod(config.mediaStore, 'getForBackground');
    var releaseOwnerMedia = requiredMethod(config.mediaStore, 'releaseOwner');
    var acquireProviderLease = requiredMethod(config.providerSemaphore, 'acquire');
    var cancelProviderOwner = requiredMethod(config.providerSemaphore, 'cancelOwner');
    var cryptoImpl = config.crypto || global.crypto;
    var randomValues = typeof config.randomValues === 'function'
      ? config.randomValues
      : cryptoImpl && typeof cryptoImpl.getRandomValues === 'function'
        ? cryptoImpl.getRandomValues.bind(cryptoImpl)
        : null;
    var now = typeof config.now === 'function' ? config.now : function () { return new Date(); };
    if (!cryptoImpl || !cryptoImpl.subtle || typeof cryptoImpl.subtle.digest !== 'function'
      || typeof global.TextEncoder !== 'function' || !randomValues) {
      throw controllerError('SS_ERP_BYOK_EDIT_DEPENDENCY_UNAVAILABLE', 'FAILED_FINAL');
    }

    var sessions = new Map();
    var issuedTokens = new Set();

    function providerOwnerToken(owner) {
      return 'workbench-tab:' + owner.tabId + ':document:' + owner.documentId;
    }

    function currentMillis() {
      var value = new Date(now()).getTime();
      if (!Number.isFinite(value)) {
        throw controllerError('SS_ERP_BYOK_EDIT_STATE_INVALID', 'FAILED_FINAL');
      }
      return value;
    }

    function token(prefix) {
      for (var attempt = 0; attempt < 4; attempt += 1) {
        var bytes = new Uint8Array(24);
        randomValues(bytes);
        var value = prefix + hex(bytes);
        if (!issuedTokens.has(value)) {
          issuedTokens.add(value);
          return value;
        }
      }
      throw controllerError('SS_ERP_BYOK_EDIT_RANDOM_COLLISION', 'FAILED_RETRYABLE');
    }

    async function hashIntent(command, references) {
      var manifest = JSON.stringify({
        profileId: command.profileId,
        operation: command.operation,
        prompt: command.prompt,
        negativePrompt: command.negativePrompt,
        size: command.size,
        sourceHandle: command.sourceHandle,
        maskHandle: command.maskHandle,
        referenceHandles: references,
      });
      var digest = await cryptoImpl.subtle.digest(
        'SHA-256',
        new global.TextEncoder().encode(manifest),
      );
      return hex(new Uint8Array(digest));
    }

    function sameOwner(session, candidate) {
      return session.owner.fingerprint === candidate.fingerprint;
    }

    function assertCurrent(session) {
      if (session.closed || sessions.get(String(session.owner.tabId)) !== session) {
        throw controllerError('SS_ERP_BYOK_EDIT_OWNER_STALE', 'FAILED_FINAL');
      }
      return session;
    }

    function claim(ownerValue) {
      var normalized = normalizeOwner(ownerValue);
      var session = sessions.get(String(normalized.tabId));
      if (!session || !sameOwner(session, normalized)) {
        throw controllerError('SS_ERP_BYOK_EDIT_OWNER_STALE', 'FAILED_FINAL');
      }
      return assertCurrent(session);
    }

    function effectiveReferences(session) {
      return (session.slotReferences === null
        ? session.globalReferences
        : session.slotReferences).slice();
    }

    function readinessRequest(session, profileId, operation) {
      var context = session.owner.context;
      return {
        profileId: profileId,
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
        operation: operation,
      };
    }

    function validateReadiness(session, value, operation) {
      var code = 'SS_ERP_BYOK_EDIT_READINESS_INVALID';
      if (!isRecord(value) || !isRecord(value.readinessBinding)
        || !exactKeys(value.readinessBinding, BINDING_KEYS)) {
        throw controllerError(code, 'FAILED_RETRYABLE');
      }
      var binding = value.readinessBinding;
      var context = session.owner.context;
      if (binding.contractVersion !== BINDING_VERSION
        || binding.shopId !== context.shopId
        || binding.workflowId !== context.workflowId
        || binding.draftRevision !== context.draftRevision
        || binding.draftVersion !== context.draftVersion
        || binding.sourcePlatform !== context.sourcePlatform
        || binding.sourceProductId !== context.sourceProductId
        || binding.sourceCaptureSnapshotId !== context.sourceCaptureSnapshotId
        || binding.supplyGoodsId !== context.supplyGoodsId
        || binding.skuKey !== context.skuKey
        || binding.slotKey !== context.slotKey
        || binding.assignmentMode !== context.assignmentMode
        || binding.assignmentOrdinal !== context.assignmentOrdinal
        || binding.operation !== operation) {
        throw controllerError('SS_ERP_BYOK_EDIT_CONTEXT_MISMATCH', 'FAILED_FINAL');
      }
      var expiresAt = Date.parse(value.expiresAt);
      if (!Number.isFinite(expiresAt) || expiresAt <= currentMillis()) {
        throw controllerError('SS_ERP_BYOK_EDIT_READINESS_EXPIRED', 'FAILED_RETRYABLE');
      }
      var concurrency = value.concurrencyAuthority;
      if (!exactKeys(concurrency, ['policyRevision', 'maxConcurrency'])
        || concurrency.policyRevision !== binding.policyRevision
        || !/^(?:0|[1-9][0-9]*)$/u.test(concurrency.policyRevision)
        || !Number.isSafeInteger(concurrency.maxConcurrency)
        || concurrency.maxConcurrency < 1 || concurrency.maxConcurrency > 4) {
        throw controllerError(code, 'FAILED_RETRYABLE');
      }
      return {
        value: value,
        binding: binding,
        expiresAt: expiresAt,
        concurrencyAuthority: Object.freeze({
          policyRevision: concurrency.policyRevision,
          maxConcurrency: concurrency.maxConcurrency,
        }),
      };
    }

    async function fetchReadiness(session, profileId, operation) {
      var result;
      try {
        result = await getReadiness(readinessRequest(session, profileId, operation));
      } catch (error) {
        throw safeDependencyFailure(error, 'SS_ERP_BYOK_EDIT_READINESS_UNAVAILABLE');
      }
      assertCurrent(session);
      return validateReadiness(session, result, operation);
    }

    function normalizeMedia(value, mask) {
      var mimeType = isRecord(value) ? value.mimeType : null;
      var blob = isRecord(value) ? value.blob : null;
      var width = isRecord(value) ? value.width : null;
      var height = isRecord(value) ? value.height : null;
      if (!(blob instanceof global.Blob) || !MIME_TYPES.includes(mimeType)
        || blob.type !== mimeType || blob.size < 1
        || !Number.isSafeInteger(width) || width < 1 || width > MAX_DIMENSION
        || !Number.isSafeInteger(height) || height < 1 || height > MAX_DIMENSION
        || width * height > MAX_PIXELS || (mask && mimeType !== 'image/png')) {
        throw controllerError('SS_ERP_BYOK_EDIT_MEDIA_INVALID', 'FAILED_RETRYABLE');
      }
      return { blob: blob, mimeType: mimeType, width: width, height: height };
    }

    async function resolveMedia(session, handle, purpose, mask) {
      var resolved;
      try {
        resolved = await getMedia(session.owner, handle, purpose);
      } catch (error) {
        throw safeDependencyFailure(error, 'SS_ERP_BYOK_EDIT_MEDIA_UNAVAILABLE');
      }
      assertCurrent(session);
      return normalizeMedia(resolved, mask);
    }

    async function resolveCommandMedia(session, record) {
      var command = record.command;
      if (command.operation === 'IMAGE_TO_IMAGE') {
        if (record.referenceHandles.length < 1 || record.referenceHandles.length > 4) {
          throw controllerError('SS_ERP_BYOK_EDIT_REFERENCE_COUNT_INVALID', 'FAILED_RETRYABLE');
        }
        var references = [];
        for (var index = 0; index < record.referenceHandles.length; index += 1) {
          references.push(await resolveMedia(
            session,
            record.referenceHandles[index],
            MEDIA_PURPOSES.IMAGE_TO_IMAGE_REFERENCE,
            false,
          ));
        }
        return { images: references.map(function (item) { return item.blob; }), mask: null };
      }
      var source = await resolveMedia(
        session,
        command.sourceHandle,
        command.operation === 'FULL_EDIT'
          ? MEDIA_PURPOSES.FULL_EDIT_SOURCE
          : MEDIA_PURPOSES.INPAINT_SOURCE,
        false,
      );
      if (command.operation === 'FULL_EDIT') {
        return { images: [source.blob], mask: null };
      }
      var mask = await resolveMedia(
        session,
        command.maskHandle,
        MEDIA_PURPOSES.INPAINT_MASK,
        true,
      );
      if (source.width !== mask.width || source.height !== mask.height) {
        throw controllerError(
          'SS_ERP_BYOK_EDIT_MASK_DIMENSIONS_MISMATCH',
          'FAILED_RETRYABLE',
        );
      }
      return {
        images: [source.blob],
        mask: { blob: mask.blob, maskSemantics: INTERNAL_MASK_SEMANTICS },
      };
    }

    function matchingDispatchRecord(session, engineInput) {
      var record = engineInput && engineInput.dispatchInput;
      if (!isRecord(record) || record.session !== session
        || record.slotKey !== session.owner.context.slotKey
        || record.operation !== engineInput.operation
        || record.idempotencyKey !== engineInput.idempotencyKey
        || record.intentHash !== engineInput.intentHash) {
        throw controllerError('SS_ERP_BYOK_EDIT_DISPATCH_INVALID', 'FAILED_FINAL');
      }
      return record;
    }

    function vaultFailure(error) {
      if (error && error.code === 'SS_ERP_BYOK_RESULT_VAULT_FULL') {
        if (!Object.isExtensible(error)) {
          return controllerError('SS_ERP_BYOK_RESULT_VAULT_FULL', 'FAILED_FINAL');
        }
        error.outcome = 'FAILED_FINAL';
      }
      return error;
    }

    async function dispatch(session, engineInput) {
      assertCurrent(session);
      var record = matchingDispatchRecord(session, engineInput);
      var readiness = record.bootstrapReadiness;
      record.bootstrapReadiness = null;
      if (readiness) {
        readiness = validateReadiness(session, readiness, record.operation);
      } else {
        readiness = await fetchReadiness(session, record.profileId, record.operation);
        if (readiness.concurrencyAuthority.policyRevision
            !== session.concurrencyAuthority.policyRevision
          || readiness.concurrencyAuthority.maxConcurrency
            !== session.concurrencyAuthority.maxConcurrency) {
          throw controllerError('SS_ERP_BYOK_EDIT_READINESS_CHANGED', 'FAILED_RETRYABLE');
        }
      }
      var media = await resolveCommandMedia(session, record);
      assertCurrent(session);
      readiness = validateReadiness(session, readiness.value, record.operation);
      var generated = null;
      var committed = null;
      var failure = null;
      try {
        var providerLease;
        try {
          providerLease = await acquireProviderLease({
            ownerToken: providerOwnerToken(session.owner),
            ownerUserId: readiness.binding.ownerUserId,
            deviceSessionId: readiness.binding.deviceSessionId,
            policyRevision: readiness.concurrencyAuthority.policyRevision,
            maxConcurrency: readiness.concurrencyAuthority.maxConcurrency,
            expiresAt: new Date(readiness.expiresAt).toISOString(),
          });
          assertCurrent(session);
          generated = await editImage({
            profileId: record.profileId,
            operation: record.operation,
            prompt: record.command.prompt,
            negativePrompt: record.command.negativePrompt,
            size: record.command.size,
            idempotencyKey: record.idempotencyKey,
            readinessBinding: readiness.binding,
            images: media.images,
            mask: media.mask,
          });
        } finally {
          if (providerLease) providerLease.release();
        }
        assertCurrent(session);
        var authority = await captureAuthority(readiness.binding);
        assertCurrent(session);
        committed = await commitEditResult(
          generated.idempotencyKey,
          generated.requestHash,
          function (currentGenerated) {
            assertCurrent(session);
            return commitGeneratedResult({
              authority: authority,
              binding: readiness.binding,
              generated: currentGenerated,
              vault: vault,
            });
          },
        );
      } catch (error) {
        failure = vaultFailure(error);
        if (generated && (!failure || failure.outcome !== 'FAILED_FINAL')) {
          failure = controllerError(
            failure && /^[A-Z][A-Z0-9_]{0,99}$/u.test(String(failure.code || ''))
              ? failure.code
              : 'SS_ERP_BYOK_EDIT_COMMIT_FAILED',
            'FAILED_FINAL',
          );
        }
      }
      if (generated) {
        try {
          releaseEditResult(generated.idempotencyKey, generated.requestHash);
        } catch (error) {
          if (!failure) {
            failure = controllerError(
              error && /^[A-Z][A-Z0-9_]{0,99}$/u.test(String(error.code || ''))
                ? error.code
                : 'SS_ERP_BYOK_EDIT_RESULT_RELEASE_FAILED',
              'FAILED_FINAL',
            );
          }
        }
      }
      media.images = [];
      media.mask = null;
      if (failure) {
        if (committed && committed.resultId) {
          try { releaseVaultResult(committed.resultId); } catch {}
        }
        throw failure;
      }
      if (!isRecord(committed) || typeof committed.resultId !== 'string'
        || !isRecord(committed.image)
        || typeof committed.image.sha256 !== 'string'
        || !/^[a-f0-9]{64}$/u.test(committed.image.sha256)
        || !generated || typeof generated.requestHash !== 'string'
        || !/^[a-f0-9]{64}$/u.test(generated.requestHash)) {
        if (committed && committed.resultId) {
          try { releaseVaultResult(committed.resultId); } catch {}
        }
        throw controllerError('SS_ERP_BYOK_EDIT_COMMIT_INVALID', 'FAILED_FINAL');
      }
      try { assertCurrent(session); } catch (error) {
        try { releaseVaultResult(committed.resultId); } catch {}
        throw error;
      }
      return Object.freeze({
        outcome: 'SUCCEEDED',
        candidateId: committed.resultId,
        resultHandle: committed.resultId,
        resultSha256: committed.image.sha256,
        requestHash: generated.requestHash,
      });
    }

    function createEngine(session, concurrencyAuthority) {
      session.concurrencyAuthority = concurrencyAuthority;
      return engineApi.createEngine({
        executionMode: 'BYOK',
        requestedConcurrency: 1,
        concurrencyAuthority: concurrencyAuthority,
        runnerMaxConcurrency: 1,
        resultRetention: {
          pin: function (resultId) { return pinSelection(resultId); },
          unpin: function (resultId) { return unpinSelection(resultId); },
        },
        dispatch: function (input) { return dispatch(session, input); },
        resolveDispatchInput: function (dispatchRef) {
          assertCurrent(session);
          var record = session.dispatchRecords.get(dispatchRef);
          if (!record) return undefined;
          session.dispatchRecords.delete(dispatchRef);
          return record;
        },
        resolveRecovery: async function () {
          throw controllerError('SS_ERP_BYOK_EDIT_UNKNOWN_RECOVERY_UNAVAILABLE', 'FAILED_FINAL');
        },
      });
    }

    function publicSnapshot(session) {
      assertCurrent(session);
      var raw = session.engine ? session.engine.getSnapshot() : null;
      var rawSlot = raw && raw.slots.find(function (item) {
        return item.slotKey === session.owner.context.slotKey;
      });
      var retainedAttempts = new Set();
      if (raw) raw.attempts.forEach(function (attempt) {
        if (attempt.state !== 'CANDIDATE_READY' || !attempt.resultHandle) return;
        try {
          getVaultResult(attempt.resultHandle);
          retainedAttempts.add(attempt.attemptId);
        } catch {}
      });
      var selectedAttemptId = rawSlot
        && retainedAttempts.has(rawSlot.selectedAttemptId)
        ? rawSlot.selectedAttemptId
        : null;
      var references = effectiveReferences(session);
      var alternatives = raw ? raw.attempts.map(function (attempt) {
        var expired = attempt.state === 'CANDIDATE_READY'
          && !retainedAttempts.has(attempt.attemptId);
        return Object.freeze({
          attemptId: attempt.attemptId,
          generation: attempt.generation,
          operation: attempt.operation,
          state: expired ? 'EXPIRED' : attempt.state,
          candidateId: expired ? null : attempt.candidateId,
          errorCode: expired ? 'SS_ERP_BYOK_EDIT_RESULT_EXPIRED' : attempt.errorCode,
          selected: !expired && attempt.attemptId === selectedAttemptId,
          externalChargePossible: attempt.externalChargePossible,
          retryRisk: attempt.retryRisk,
        });
      }) : [];
      var availability = Object.freeze(OPERATIONS.map(function (operation) {
        var enabled = operation !== 'IMAGE_TO_IMAGE'
          || (references.length >= 1 && references.length <= 4);
        return Object.freeze({
          operation: operation,
          enabled: enabled,
          disabledReason: enabled ? null : 'SELECT_1_TO_4_REFERENCES',
        });
      }));
      return Object.freeze({
        contractVersion: CONTRACT_VERSION,
        executionMode: 'BYOK',
        slotKey: session.owner.context.slotKey,
        profileId: session.profileId,
        operation: session.operation,
        references: Object.freeze({
          sessionGlobalCount: session.globalReferences.length,
          slotOverrideActive: session.slotReferences !== null,
          slotOverrideCount: session.slotReferences === null ? null : session.slotReferences.length,
          effectiveCount: references.length,
        }),
        operationAvailability: availability,
        scheduler: Object.freeze({
          state: raw ? raw.schedulerState : 'READY',
          activeCount: raw ? raw.activeCount : 0,
          queuedCount: raw ? raw.queuedCount : 0,
          pauseRequested: raw ? raw.pauseRequested : false,
          effectiveConcurrency: raw ? raw.effectiveConcurrency : null,
        }),
        slot: Object.freeze({
          revision: rawSlot ? rawSlot.revision : 0,
          attemptIds: Object.freeze(rawSlot ? rawSlot.attemptIds.slice() : []),
          selectedAttemptId: selectedAttemptId,
          selectedCandidateId: selectedAttemptId && rawSlot
            ? rawSlot.selectedCandidateId
            : null,
        }),
        alternatives: Object.freeze(alternatives),
      });
    }

    function releaseSession(session) {
      if (session.closed) {
        return Object.freeze({ releasedResultCount: 0, externalChargeUnresolved: false });
      }
      session.closed = true;
      try { cancelProviderOwner(providerOwnerToken(session.owner)); } catch {}
      var released = 0;
      var externalChargeUnresolved = false;
      if (session.engine) {
        var raw = session.engine.getSnapshot();
        externalChargeUnresolved = raw.attempts.some(function (attempt) {
          return ['SUBMITTING', 'WAITING', 'UNKNOWN_OUTCOME'].includes(attempt.state);
        });
        raw.attempts.forEach(function (attempt) {
          if (attempt.state === 'QUEUED') {
            try { session.engine.cancelQueued(attempt.attemptId); } catch {}
          }
        });
        var ids = new Set(raw.attempts.map(function (attempt) {
          return attempt.resultHandle;
        }).filter(Boolean));
        ids.forEach(function (resultId) {
          try { if (releaseVaultResult(resultId)) released += 1; } catch {}
        });
      }
      session.dispatchRecords.clear();
      session.globalReferences = [];
      session.slotReferences = null;
      try { releaseOwnerMedia(session.owner); } catch {}
      return Object.freeze({
        releasedResultCount: released,
        externalChargeUnresolved: externalChargeUnresolved,
      });
    }

    function open(ownerValue) {
      var normalized = normalizeOwner(ownerValue);
      var key = String(normalized.tabId);
      var existing = sessions.get(key);
      if (existing && sameOwner(existing, normalized)) return publicSnapshot(existing);
      if (existing) {
        releaseSession(existing);
        sessions.delete(key);
      }
      var session = {
        owner: normalized,
        closed: false,
        globalReferences: [],
        slotReferences: null,
        profileId: null,
        operation: null,
        concurrencyAuthority: null,
        engine: null,
        dispatchRecords: new Map(),
        commandInProgress: false,
      };
      sessions.set(key, session);
      return publicSnapshot(session);
    }

    function setReferences(ownerValue, value) {
      var session = claim(ownerValue);
      if (!isRecord(value) || !['SESSION_GLOBAL', 'SLOT'].includes(value.scope)) {
        throw controllerError('SS_ERP_BYOK_EDIT_INPUT_INVALID', 'FAILED_RETRYABLE');
      }
      if (value.scope === 'SESSION_GLOBAL') {
        if (!exactKeys(value, ['scope', 'handles'])) {
          throw controllerError('SS_ERP_BYOK_EDIT_INPUT_INVALID', 'FAILED_RETRYABLE');
        }
        session.globalReferences = normalizeHandles(value.handles).slice();
      } else {
        if (!exactKeys(value, ['scope', 'slotKey', 'handles'])
          || value.slotKey !== session.owner.context.slotKey) {
          throw controllerError('SS_ERP_BYOK_EDIT_INPUT_INVALID', 'FAILED_RETRYABLE');
        }
        session.slotReferences = value.handles === null
          ? null
          : normalizeHandles(value.handles).slice();
      }
      return publicSnapshot(session);
    }

    function createRecord(session, command, readiness) {
      var references = command.operation === 'IMAGE_TO_IMAGE' ? effectiveReferences(session) : [];
      if (command.operation === 'IMAGE_TO_IMAGE'
        && (references.length < 1 || references.length > 4)) {
        throw controllerError('SS_ERP_BYOK_EDIT_REFERENCE_COUNT_INVALID', 'FAILED_RETRYABLE');
      }
      return hashIntent(command, references).then(function (intentHash) {
        assertCurrent(session);
        return {
          session: session,
          slotKey: session.owner.context.slotKey,
          profileId: command.profileId,
          operation: command.operation,
          command: command,
          referenceHandles: Object.freeze(references.slice()),
          idempotencyKey: token('edit_'),
          dispatchRef: token('dispatch_'),
          intentHash: intentHash,
          bootstrapReadiness: readiness ? readiness.value : null,
        };
      });
    }

    async function start(ownerValue, value) {
      var session = claim(ownerValue);
      var command = normalizeCommand(value);
      if (session.commandInProgress || session.engine) {
        throw controllerError('SS_ERP_BYOK_EDIT_SLOT_ALREADY_STARTED', 'FAILED_RETRYABLE');
      }
      if (command.operation === 'IMAGE_TO_IMAGE') {
        var references = effectiveReferences(session);
        if (references.length < 1 || references.length > 4) {
          throw controllerError('SS_ERP_BYOK_EDIT_REFERENCE_COUNT_INVALID', 'FAILED_RETRYABLE');
        }
      }
      session.commandInProgress = true;
      try {
        var ready = await fetchReadiness(session, command.profileId, command.operation);
        var record = await createRecord(session, command, ready);
        session.profileId = command.profileId;
        session.operation = command.operation;
        session.engine = createEngine(session, ready.concurrencyAuthority);
        session.dispatchRecords.set(record.dispatchRef, record);
        try {
          session.engine.enqueue({
            slotKey: record.slotKey,
            operation: record.operation,
            idempotencyKey: record.idempotencyKey,
            intentHash: record.intentHash,
            dispatchRef: record.dispatchRef,
          });
        } catch (error) {
          session.dispatchRecords.delete(record.dispatchRef);
          session.engine = null;
          session.profileId = null;
          session.operation = null;
          session.concurrencyAuthority = null;
          throw error;
        }
        return publicSnapshot(session);
      } finally {
        session.commandInProgress = false;
      }
    }

    async function regenerate(ownerValue, value) {
      var session = claim(ownerValue);
      var normalized = normalizeRegeneration(value);
      if (!session.engine || session.commandInProgress) {
        throw controllerError('SS_ERP_BYOK_EDIT_SLOT_NOT_READY', 'FAILED_RETRYABLE');
      }
      if (normalized.command.profileId !== session.profileId
        || normalized.command.operation !== session.operation) {
        throw controllerError('SS_ERP_BYOK_EDIT_OPERATION_MISMATCH', 'FAILED_FINAL');
      }
      session.commandInProgress = true;
      try {
        var record = await createRecord(session, normalized.command, null);
        session.dispatchRecords.set(record.dispatchRef, record);
        try {
          session.engine.regenerate(session.owner.context.slotKey, {
            slotKey: record.slotKey,
            operation: record.operation,
            idempotencyKey: record.idempotencyKey,
            intentHash: record.intentHash,
            dispatchRef: record.dispatchRef,
            commandId: token('regenerate_'),
            expectedSlotRevision: normalized.expectedSlotRevision,
            chargeAcknowledgement: normalized.chargeAcknowledgement,
          });
        } catch (error) {
          session.dispatchRecords.delete(record.dispatchRef);
          throw error;
        }
        return publicSnapshot(session);
      } finally {
        session.commandInProgress = false;
      }
    }

    function selectAlternative(ownerValue, value) {
      var session = claim(ownerValue);
      if (!session.engine || !exactKeys(value, ['attemptId'])) {
        throw controllerError('SS_ERP_BYOK_EDIT_INPUT_INVALID', 'FAILED_RETRYABLE');
      }
      var attemptId = boundedId(value.attemptId, 'SS_ERP_BYOK_EDIT_INPUT_INVALID');
      var attempt = session.engine.getAttempt(attemptId);
      if (attempt && attempt.state === 'CANDIDATE_READY' && attempt.resultHandle) {
        try { getVaultResult(attempt.resultHandle); } catch {
          throw controllerError('SS_ERP_BYOK_EDIT_RESULT_EXPIRED', 'FAILED_FINAL');
        }
      }
      session.engine.selectCandidate(
        session.owner.context.slotKey,
        attemptId,
      );
      return publicSnapshot(session);
    }

    async function whenSettled(ownerValue) {
      var session = claim(ownerValue);
      if (session.engine) await session.engine.whenSettled();
      assertCurrent(session);
      return publicSnapshot(session);
    }

    function getSnapshot(ownerValue) {
      return publicSnapshot(claim(ownerValue));
    }

    function cleanup(ownerValue) {
      var normalized = normalizeOwner(ownerValue);
      var key = String(normalized.tabId);
      var session = sessions.get(key);
      if (!session || !sameOwner(session, normalized)) {
        return Object.freeze({
          cleaned: false,
          releasedResultCount: 0,
          externalChargeUnresolved: false,
        });
      }
      sessions.delete(key);
      return Object.freeze({ cleaned: true, ...releaseSession(session) });
    }

    function cleanupByTab(value) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw controllerError('SS_ERP_BYOK_EDIT_OWNER_INVALID', 'FAILED_FINAL');
      }
      var key = String(value);
      var session = sessions.get(key);
      if (!session) {
        return Object.freeze({
          cleaned: false,
          releasedResultCount: 0,
          externalChargeUnresolved: false,
        });
      }
      sessions.delete(key);
      return Object.freeze({ cleaned: true, ...releaseSession(session) });
    }

    function clear() {
      var current = Array.from(sessions.values());
      var releasedResultCount = 0;
      var unresolvedSessionCount = 0;
      current.forEach(function (session) {
        var released = releaseSession(session);
        releasedResultCount += released.releasedResultCount;
        if (released.externalChargeUnresolved) unresolvedSessionCount += 1;
      });
      sessions.clear();
      issuedTokens.clear();
      return Object.freeze({
        clearedSessionCount: current.length,
        releasedResultCount: releasedResultCount,
        unresolvedSessionCount: unresolvedSessionCount,
      });
    }

    return Object.freeze({
      open: open,
      setReferences: setReferences,
      start: start,
      regenerate: regenerate,
      selectAlternative: selectAlternative,
      whenSettled: whenSettled,
      getSnapshot: getSnapshot,
      cleanup: cleanup,
      cleanupByTab: cleanupByTab,
      clear: clear,
    });
  }

  global.SS_ERP_BYOK_WORKBENCH_EDIT_CONTROLLER = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    OPERATIONS: OPERATIONS,
    INTERNAL_MASK_SEMANTICS: INTERNAL_MASK_SEMANTICS,
    MEDIA_PURPOSES: MEDIA_PURPOSES,
    EXTERNAL_CHARGE_WARNING_VERSION: 'external-provider-charge/v1',
    createController: createController,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
