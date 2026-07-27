(function exposeByokGeneratedAssetIngestClient(global) {
  'use strict';

  var CONTRACT_VERSION = 'extension-byok-generated-asset-ingest-client/v1';
  var COMMAND_VERSION = 'byok-media-ingest/v1';
  var MANIFEST_VERSION = 'extension-byok-media-ingest-request/v1';
  var workbenchContract = global.SS_ERP_AI_IMAGE_WORKBENCH_CONTRACT;
  var statusContract = workbenchContract && workbenchContract.BYOK_INGEST_STATUS;
  var byokRoutes = workbenchContract && workbenchContract.ROUTES
    && workbenchContract.ROUTES.BYOK;
  if (!statusContract || !statusContract.states || !byokRoutes
    || typeof statusContract.contractVersion !== 'string'
    || typeof statusContract.requestHashPattern !== 'string'
    || typeof byokRoutes.ingest !== 'string'
    || typeof byokRoutes.ingestStatus !== 'string') {
    throw new TypeError('BYOK ingest status contract is unavailable');
  }
  var STATUS_VERSION = statusContract.contractVersion;
  var STATUS_STATES = statusContract.states;
  var REQUEST_HASH_PATTERN = new RegExp(statusContract.requestHashPattern, 'u');
  var COMMAND_GRANT_PATH = '/api/extension-device/command-grants';
  var INGEST_PATH = byokRoutes.ingest;
  var INGEST_STATUS_PATH = byokRoutes.ingestStatus;
  var OPERATION = 'BYOK_MEDIA_INGEST';
  var MAX_OPERATION_COUNT = 100;
  var LIFECYCLE_VERSION = 'extension-byok-device-session-lifecycle/v1';
  var SHARED_DETAIL_ROLES = ['SCENE', 'DETAIL', 'SPEC', 'PACKAGING'];
  var AUTHORITY_KEYS = [
    'lifecycleAuthority', 'ownerUserId', 'deviceSessionId', 'shopId', 'workflowId',
    'draftRevision', 'draftVersion', 'policyRevision',
  ];

  function ingestError(code, outcome, details) {
    var error = new Error(code);
    error.code = code;
    error.outcome = outcome || 'FAILED_RETRYABLE';
    if (details) Object.assign(error, details);
    return error;
  }

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function isCanonicalText(value, minimum, maximum) {
    if (typeof value !== 'string') return false;
    var normalized = value.normalize('NFKC').trim();
    return normalized === value && normalized.length >= minimum && normalized.length <= maximum
      && !/[\u0000-\u001f\u007f]/u.test(normalized);
  }

  function text(value, minimum, maximum) {
    if (!isCanonicalText(value, minimum, maximum)) {
      throw ingestError('SS_ERP_BYOK_INGEST_INPUT_INVALID');
    }
    return value;
  }

  function positiveInteger(value) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw ingestError('SS_ERP_BYOK_INGEST_INPUT_INVALID');
    }
    return value;
  }

  function assignmentOrdinal(value) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 499) {
      throw ingestError('SS_ERP_BYOK_INGEST_INPUT_INVALID');
    }
    return value;
  }

  function isSupportedSlotKey(skuKey, slotKey) {
    return slotKey === 'sku:' + skuKey + ':hero'
      || SHARED_DETAIL_ROLES.some(function (role) {
        return slotKey === 'shared:detail:' + role;
      });
  }

  function exactKeys(value, keys) {
    return isRecord(value)
      && Object.keys(value).length === keys.length
      && Object.keys(value).every(function (key) { return keys.includes(key); });
  }

  function normalizeRuntimeAuthority(value) {
    if (!exactKeys(value, AUTHORITY_KEYS)
      || !exactKeys(value.lifecycleAuthority, ['contractVersion', 'epoch'])
      || value.lifecycleAuthority.contractVersion !== LIFECYCLE_VERSION
      || !Number.isSafeInteger(value.lifecycleAuthority.epoch)
      || value.lifecycleAuthority.epoch < 0) {
      throw ingestError('SS_ERP_BYOK_INGEST_AUTHORITY_INVALID', 'FAILED_FINAL');
    }
    return {
      lifecycleAuthority: {
        contractVersion: LIFECYCLE_VERSION,
        epoch: value.lifecycleAuthority.epoch,
      },
      ownerUserId: text(value.ownerUserId, 1, 200),
      deviceSessionId: text(value.deviceSessionId, 1, 200),
      shopId: text(value.shopId, 1, 200),
      workflowId: text(value.workflowId, 1, 200),
      draftRevision: positiveInteger(value.draftRevision),
      draftVersion: positiveInteger(value.draftVersion),
      policyRevision: text(value.policyRevision, 1, 200),
    };
  }

  function normalizeInput(value) {
    if (!isRecord(value)) throw ingestError('SS_ERP_BYOK_INGEST_INPUT_INVALID');
    var keys = [
      'resultId', 'shopId', 'workflowId', 'draftRevision', 'draftVersion',
      'skuKey', 'slotKey', 'assignmentMode', 'replaceConfirmed', 'assignmentOrdinal',
      'idempotencyKey',
    ];
    var inputKeys = Object.keys(value);
    if ((inputKeys.length !== keys.length && inputKeys.length !== keys.length + 1)
      || inputKeys.some(function (key) { return !keys.includes(key) && key !== 'requestHash'; })
      || (inputKeys.length === keys.length + 1 && !inputKeys.includes('requestHash'))) {
      throw ingestError('SS_ERP_BYOK_INGEST_INPUT_INVALID');
    }
    var requestHash = value.requestHash == null ? null : String(value.requestHash || '');
    if (requestHash !== null && !REQUEST_HASH_PATTERN.test(requestHash)) {
      throw ingestError('SS_ERP_BYOK_INGEST_INPUT_INVALID');
    }
    if (value.assignmentMode !== 'APPEND' || value.replaceConfirmed !== false) {
      throw ingestError('SS_ERP_BYOK_INGEST_INPUT_INVALID');
    }
    var skuKey = text(value.skuKey, 1, 500);
    var slotKey = text(value.slotKey, 1, 200);
    if (!isSupportedSlotKey(skuKey, slotKey)) {
      throw ingestError('SS_ERP_BYOK_INGEST_INPUT_INVALID');
    }
    return {
      resultId: text(value.resultId, 4, 128),
      shopId: text(value.shopId, 1, 200),
      workflowId: text(value.workflowId, 1, 200),
      draftRevision: positiveInteger(value.draftRevision),
      draftVersion: positiveInteger(value.draftVersion),
      skuKey: skuKey,
      slotKey: slotKey,
      assignmentMode: 'APPEND',
      replaceConfirmed: false,
      assignmentOrdinal: assignmentOrdinal(value.assignmentOrdinal),
      idempotencyKey: text(value.idempotencyKey, 16, 200),
      requestHash: requestHash,
    };
  }

  function base64url(value) {
    var bytes = new TextEncoder().encode(JSON.stringify(value));
    var binary = '';
    var chunkSize = 0x8000;
    for (var index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(index, index + chunkSize)));
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
  }

  function identityFingerprint(input, authority) {
    return JSON.stringify({
      resultId: input.resultId,
      shopId: input.shopId,
      workflowId: input.workflowId,
      draftRevision: input.draftRevision,
      draftVersion: input.draftVersion,
      skuKey: input.skuKey,
      slotKey: input.slotKey,
      assignmentMode: input.assignmentMode,
      replaceConfirmed: input.replaceConfirmed,
      assignmentOrdinal: input.assignmentOrdinal,
      lifecycleEpoch: authority.lifecycleAuthority.epoch,
      ownerUserId: authority.ownerUserId,
      deviceSessionId: authority.deviceSessionId,
      policyRevision: authority.policyRevision,
    });
  }

  function fingerprint(input, result, authority) {
    return JSON.stringify({
      identity: identityFingerprint(input, authority),
      resultSha256: result.sha256,
      requestHash: result.requestHash,
    });
  }

  function createClient(options) {
    var transport = options && options.transport;
    var vault = options && options.vault;
    var isAuthorityCurrent = options && options.isAuthorityCurrent;
    if (!transport || typeof transport.post !== 'function' || typeof transport.postBytes !== 'function'
      || !vault || typeof vault.getApprovedForBackground !== 'function'
      || typeof vault.release !== 'function'
      || typeof isAuthorityCurrent !== 'function') {
      throw new TypeError('BYOK ingest client dependencies are unavailable');
    }
    var operations = new Map();

    function purgeOperation(idempotencyKey, entry) {
      if (operations.get(idempotencyKey) !== entry || entry.promise) return false;
      operations.delete(idempotencyKey);
      entry.grantToken = null;
      entry.requestHash = null;
      entry.requestHashCommitted = false;
      entry.result = null;
      entry.resultPublic = null;
      return true;
    }

    function reserveOperationSlot() {
      if (operations.size < MAX_OPERATION_COUNT) return;
      for (const pair of operations.entries()) {
        var entry = pair[1];
        if (!entry.promise && ['SUCCEEDED', 'FAILED_FINAL'].includes(entry.status)) {
          purgeOperation(pair[0], entry);
          if (operations.size < MAX_OPERATION_COUNT) return;
        }
      }
      throw ingestError('SS_ERP_BYOK_INGEST_CAPACITY_EXCEEDED', 'FAILED_RETRYABLE');
    }

    async function assertAuthorityCurrent(authority) {
      var current = false;
      try {
        current = await isAuthorityCurrent(authority.lifecycleAuthority);
      } catch (_error) {
        current = false;
      }
      if (current !== true) {
        throw ingestError('SS_ERP_BYOK_INGEST_AUTHORITY_STALE', 'FAILED_FINAL');
      }
    }

    function resultForInput(input, authority) {
      var result = vault.getApprovedForBackground(input.resultId);
      var binding = result.binding;
      if (!binding
        || result.lifecycleEpoch !== authority.lifecycleAuthority.epoch
        || binding.ownerUserId !== authority.ownerUserId
        || binding.deviceSessionId !== authority.deviceSessionId
        || binding.shopId !== input.shopId
        || binding.shopId !== authority.shopId
        || binding.workflowId !== input.workflowId
        || binding.workflowId !== authority.workflowId
        || binding.draftRevision !== input.draftRevision
        || binding.draftRevision !== authority.draftRevision
        || binding.draftVersion !== input.draftVersion
        || binding.draftVersion !== authority.draftVersion
        || binding.skuKey !== input.skuKey
        || binding.slotKey !== input.slotKey
        || binding.assignmentMode !== input.assignmentMode
        || binding.assignmentOrdinal !== input.assignmentOrdinal
        || binding.policyRevision !== authority.policyRevision
        || binding.operation !== result.operation
        || binding.providerOrigin !== result.providerOrigin
        || binding.model !== result.model
        || binding.policyRevision !== result.policyRevision
        || !['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'].includes(result.operation)
        || (result.operation === 'TEXT_TO_IMAGE'
          ? result.requestMode !== 'json'
          : result.requestMode !== 'multipart')
        || typeof result.executionIntentId !== 'string'
        || !result.executionIntentId
        || result.executionIntentId.length > 200
        || (result.providerRequestIdSha256 !== null
          && !/^[a-f0-9]{64}$/u.test(String(result.providerRequestIdSha256 || '')))
        || typeof Blob === 'undefined'
        || !(result.blob instanceof Blob)) {
        throw ingestError('SS_ERP_BYOK_INGEST_BINDING_MISMATCH', 'STALE_DRAFT');
      }
      return result;
    }

    function buildCommand(input, result) {
      return {
        schemaVersion: COMMAND_VERSION,
        providerOrigin: result.providerOrigin,
        providerOperation: result.operation,
        requestMode: result.requestMode,
        model: result.model,
        executionIntentId: result.executionIntentId,
        providerIdempotencyKey: result.idempotencyKey,
        providerRequestHash: result.requestHash,
        providerRequestIdSha256: result.providerRequestIdSha256,
        promptSha256: result.promptHash,
        negativePromptSha256: result.negativePromptHash,
        draftRevision: input.draftRevision,
        skuKey: input.skuKey,
        slotKey: input.slotKey,
        assignmentMode: input.assignmentMode,
        replaceConfirmed: input.replaceConfirmed,
        assignmentOrdinal: input.assignmentOrdinal,
        resultSha256: result.sha256,
        resultMimeType: result.mimeType,
        resultSizeBytes: result.byteLength,
        sourceSha256: result.sourceSha256,
        referenceSha256s: result.referenceSha256s.slice(),
        maskSha256: result.maskSha256,
      };
    }

    async function issueGrant(entry) {
      var response;
      try {
        response = await transport.post(COMMAND_GRANT_PATH, {
          operation: OPERATION,
          shopId: entry.input.shopId,
          workflowId: entry.input.workflowId,
          draftVersion: entry.input.draftVersion,
          idempotencyKey: entry.input.idempotencyKey,
          command: entry.command,
        }, { requiredScope: 'byok:media:ingest' });
      } catch (_error) {
        throw ingestError('SS_ERP_BYOK_INGEST_GRANT_UNAVAILABLE', 'FAILED_RETRYABLE');
      }
      var data = response && response.body && response.body.data;
      var status = Number(response && response.status) || null;
      if (response && (['scope_required', 'authorization_required', 'unpaired']
        .includes(response.state)
        || (response.state === 'http_error' && status !== 429
          && status !== null && status >= 400 && status < 500))) {
        throw ingestError('SS_ERP_BYOK_INGEST_GRANT_REJECTED', 'FAILED_FINAL', {
          status: status,
          errorCode: response.body && response.body.errorCode || null,
        });
      }
      if (!response || (response.state === 'http_error'
        && (status === 429 || (status !== null && status >= 500)))) {
        throw ingestError('SS_ERP_BYOK_INGEST_GRANT_UNAVAILABLE', 'FAILED_RETRYABLE', {
          status: status,
        });
      }
      if (response.state !== 'response' || response.status !== 201
        || !isRecord(response.body) || response.body.code !== 1 || !isRecord(data)
        || !/^[A-Za-z0-9_-]{43,4096}$/u.test(String(data.grantToken || ''))
        || !REQUEST_HASH_PATTERN.test(String(data.requestHash || ''))) {
        throw ingestError('SS_ERP_BYOK_INGEST_GRANT_RESPONSE_INVALID', 'FAILED_FINAL', {
          status: status,
        });
      }
      if (entry.requestHash !== null && entry.requestHash !== data.requestHash) {
        throw ingestError('SS_ERP_BYOK_INGEST_REQUEST_HASH_MISMATCH', 'FAILED_FINAL');
      }
      entry.grantToken = data.grantToken;
      if (entry.requestHash === null) {
        entry.requestHash = data.requestHash;
        entry.requestHashCommitted = false;
      }
    }

    async function commitRequestHash(entry, commitIngestRequestHash) {
      if (entry.requestHashCommitted === true) return;
      if (!REQUEST_HASH_PATTERN.test(String(entry.requestHash || ''))) {
        throw ingestError('SS_ERP_BYOK_INGEST_REQUEST_HASH_REQUIRED', 'FAILED_FINAL');
      }
      if (typeof commitIngestRequestHash === 'function') {
        try {
          await commitIngestRequestHash(entry.requestHash);
        } catch (_error) {
          throw ingestError(
            'SS_ERP_BYOK_INGEST_REQUEST_HASH_COMMIT_FAILED',
            'FAILED_RETRYABLE',
          );
        }
      }
      entry.requestHashCommitted = true;
    }

    function parseSuccess(response, input) {
      var data = response && response.body && response.body.data;
      if (!response || response.state !== 'response' || response.status !== 200
        || !isRecord(response.body) || response.body.code !== 1 || !isRecord(data)
        || typeof data.replayed !== 'boolean'
        || !isCanonicalText(data.receiptId, 1, 200)
        || !isCanonicalText(data.assetId, 1, 200)
        || !isCanonicalText(data.provenanceId, 1, 200)
        || !/^[a-f0-9]{64}$/u.test(String(data.normalizedSha256 || ''))
        || !['image/png', 'image/jpeg', 'image/webp'].includes(data.mimeType)
        || !Number.isSafeInteger(data.width) || data.width < 1
        || !Number.isSafeInteger(data.height) || data.height < 1
        || data.sourceDraftRevision !== input.draftRevision
        || data.sourceDraftVersion !== input.draftVersion
        || !Number.isSafeInteger(data.boundDraftRevision)
        || data.boundDraftRevision !== data.sourceDraftRevision + 1
        || !Number.isSafeInteger(data.boundDraftVersion)
        || data.boundDraftVersion !== data.sourceDraftVersion + 1
        || data.assignmentOrdinal !== input.assignmentOrdinal
        || !/^[a-f0-9]{64}$/u.test(String(data.assignmentSha256 || ''))
        || data.skuKey !== input.skuKey
        || data.slotKey !== input.slotKey) {
        var state = response && response.state;
        var status = Number(response && response.status) || null;
        var errorCode = response && response.body && response.body.errorCode || null;
        if (['scope_required', 'authorization_required', 'unpaired'].includes(state)) {
          throw ingestError('SS_ERP_BYOK_INGEST_REJECTED', 'FAILED_FINAL', {
            status: status,
            errorCode: errorCode,
          });
        }
        if (state === 'http_error') {
          if (errorCode === 'byok_ingest_receipt_pending'
            || status === 429 || (status !== null && status >= 500)) {
            throw ingestError('SS_ERP_BYOK_INGEST_UNKNOWN_OUTCOME', 'UNKNOWN_OUTCOME', {
              status: status,
              errorCode: errorCode,
            });
          }
          var retryableGrant = (status === 401 && errorCode === 'byok_ingest_grant_required')
            || (status === 404 && errorCode === 'byok_ingest_grant_not_found')
            || (status === 410 && errorCode === 'byok_ingest_grant_expired');
          var rejected = ingestError(
            retryableGrant
              ? 'SS_ERP_BYOK_INGEST_GRANT_UNAVAILABLE'
              : 'SS_ERP_BYOK_INGEST_REJECTED',
            retryableGrant ? 'FAILED_RETRYABLE' : 'FAILED_FINAL',
            { status: status, errorCode: errorCode },
          );
          rejected.resetGrant = retryableGrant;
          throw rejected;
        }
        throw ingestError('SS_ERP_BYOK_INGEST_RESPONSE_INVALID', 'UNKNOWN_OUTCOME');
      }
      return {
        contractVersion: CONTRACT_VERSION,
        replayed: data.replayed === true,
        receiptId: text(data.receiptId, 1, 200),
        assetId: text(data.assetId, 1, 200),
        provenanceId: text(data.provenanceId, 1, 200),
        normalizedSha256: data.normalizedSha256,
        mimeType: data.mimeType,
        width: positiveInteger(data.width),
        height: positiveInteger(data.height),
        sourceDraftRevision: data.sourceDraftRevision,
        sourceDraftVersion: data.sourceDraftVersion,
        boundDraftRevision: data.boundDraftRevision,
        boundDraftVersion: data.boundDraftVersion,
        assignmentOrdinal: data.assignmentOrdinal,
        assignmentSha256: data.assignmentSha256,
        skuKey: data.skuKey,
        slotKey: data.slotKey,
      };
    }

    async function commitAccepted(entry, commitAcceptedResult) {
      if (typeof commitAcceptedResult === 'function') {
        try {
          await commitAcceptedResult(entry.resultPublic);
        } catch (_error) {
          entry.status = 'ACCEPTED_PENDING_COMMIT';
          entry.errorCode = 'SS_ERP_BYOK_INGEST_RECEIPT_COMMIT_FAILED';
          throw ingestError(
            'SS_ERP_BYOK_INGEST_RECEIPT_COMMIT_FAILED',
            'FAILED_RETRYABLE',
          );
        }
      }
      entry.status = 'SUCCEEDED';
      entry.errorCode = null;
      entry.grantToken = null;
      try { vault.release(entry.input.resultId); } catch (_error) {}
      return entry.resultPublic;
    }

    async function dispatch(entry, commitAcceptedResult, commitIngestRequestHash) {
      try {
        await assertAuthorityCurrent(entry.authority);
        if (!entry.grantToken) await issueGrant(entry);
        await commitRequestHash(entry, commitIngestRequestHash);
        await assertAuthorityCurrent(entry.authority);
        var manifest = {
          contractVersion: MANIFEST_VERSION,
          operation: OPERATION,
          shopId: entry.input.shopId,
          workflowId: entry.input.workflowId,
          draftVersion: entry.input.draftVersion,
          idempotencyKey: entry.input.idempotencyKey,
          command: entry.command,
        };
        entry.binaryDispatched = true;
        var response = await transport.postBytes(INGEST_PATH, entry.result.blob, {
          requiredScope: 'byok:media:ingest',
          contentType: entry.result.mimeType,
          manifest: base64url(manifest),
          commandGrant: entry.grantToken,
        });
        var accepted = parseSuccess(response, entry.input);
        entry.status = 'ACCEPTED_PENDING_COMMIT';
        entry.resultPublic = accepted;
        return await commitAccepted(entry, commitAcceptedResult);
      } catch (error) {
        if (entry.status === 'ACCEPTED_PENDING_COMMIT') throw error;
        var safeError = error && error.code
          ? error
          : ingestError(
            'SS_ERP_BYOK_INGEST_UNKNOWN_OUTCOME',
            entry.binaryDispatched ? 'UNKNOWN_OUTCOME' : 'FAILED_RETRYABLE',
          );
        entry.status = safeError.outcome || (entry.binaryDispatched ? 'UNKNOWN_OUTCOME' : 'FAILED_RETRYABLE');
        entry.errorCode = safeError.code;
        if (entry.status === 'FAILED_FINAL' || safeError.resetGrant === true) {
          entry.grantToken = null;
        }
        throw safeError;
      } finally {
        entry.promise = null;
        if (entry.discardRequested) purgeOperation(entry.input.idempotencyKey, entry);
      }
    }

    async function ingest(
      value,
      runtimeAuthorityValue,
      commitAcceptedResult,
      commitIngestRequestHash
    ) {
      var input = normalizeInput(value);
      var authority = normalizeRuntimeAuthority(runtimeAuthorityValue);
      if ((commitAcceptedResult !== undefined && typeof commitAcceptedResult !== 'function')
        || (commitIngestRequestHash !== undefined
          && typeof commitIngestRequestHash !== 'function')) {
        throw ingestError('SS_ERP_BYOK_INGEST_INPUT_INVALID', 'FAILED_FINAL');
      }
      await assertAuthorityCurrent(authority);
      var requestIdentityFingerprint = identityFingerprint(input, authority);
      var existing = operations.get(input.idempotencyKey);
      if (existing) {
        if (existing.identityFingerprint !== requestIdentityFingerprint) {
          throw ingestError('SS_ERP_BYOK_INGEST_IDEMPOTENCY_CONFLICT', 'FAILED_FINAL');
        }
        if (existing.status === 'SUCCEEDED') return existing.resultPublic;
        if (existing.promise) return existing.promise;
        if (existing.status === 'ACCEPTED_PENDING_COMMIT') {
          existing.promise = commitAccepted(existing, commitAcceptedResult)
            .finally(function () { existing.promise = null; });
          return existing.promise;
        }
        if (existing.status === 'FAILED_FINAL') {
          throw ingestError(existing.errorCode || 'SS_ERP_BYOK_INGEST_REJECTED', 'FAILED_FINAL');
        }
        if (input.requestHash !== null && existing.requestHash !== null
          && input.requestHash !== existing.requestHash) {
          throw ingestError('SS_ERP_BYOK_INGEST_IDEMPOTENCY_CONFLICT', 'FAILED_FINAL');
        }
        var replayResult = resultForInput(input, authority);
        var replayFingerprint = fingerprint(input, replayResult, authority);
        if (existing.fingerprint !== null && existing.fingerprint !== replayFingerprint) {
          throw ingestError('SS_ERP_BYOK_INGEST_IDEMPOTENCY_CONFLICT', 'FAILED_FINAL');
        }
        if (existing.result === null) {
          existing.result = replayResult;
          existing.command = buildCommand(input, replayResult);
          existing.fingerprint = replayFingerprint;
        }
        if (existing.requestHash === null && input.requestHash !== null) {
          existing.requestHash = input.requestHash;
          existing.requestHashCommitted = true;
        }
        // A repeated user action is an explicit retry of the idempotent ERP
        // ingest endpoint; it reuses the same grant and never repeats Provider work.
        existing.binaryDispatched = false;
        existing.promise = dispatch(
          existing,
          commitAcceptedResult,
          commitIngestRequestHash,
        );
        return existing.promise;
      }
      var result = resultForInput(input, authority);
      var requestFingerprint = fingerprint(input, result, authority);
      reserveOperationSlot();
      var entry = {
        input: input,
        result: result,
        authority: authority,
        command: buildCommand(input, result),
        identityFingerprint: requestIdentityFingerprint,
        fingerprint: requestFingerprint,
        status: 'PREPARING',
        errorCode: null,
        binaryDispatched: false,
        grantToken: null,
        requestHash: input.requestHash,
        requestHashCommitted: input.requestHash !== null,
        resultPublic: null,
        promise: null,
        discardRequested: false,
      };
      operations.set(input.idempotencyKey, entry);
      entry.promise = dispatch(entry, commitAcceptedResult, commitIngestRequestHash);
      return entry.promise;
    }

    function statusRequest(input) {
      return {
        contractVersion: STATUS_VERSION,
        shopId: input.shopId,
        workflowId: input.workflowId,
        draftRevision: input.draftRevision,
        draftVersion: input.draftVersion,
        skuKey: input.skuKey,
        slotKey: input.slotKey,
        assignmentOrdinal: input.assignmentOrdinal,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
      };
    }

    async function recover(value, runtimeAuthorityValue, commitAcceptedResult) {
      var input = normalizeInput(value);
      var authority = normalizeRuntimeAuthority(runtimeAuthorityValue);
      if (commitAcceptedResult !== undefined && typeof commitAcceptedResult !== 'function') {
        throw ingestError('SS_ERP_BYOK_INGEST_INPUT_INVALID', 'FAILED_FINAL');
      }
      if (input.requestHash === null) {
        throw ingestError('SS_ERP_BYOK_INGEST_REQUEST_HASH_REQUIRED', 'FAILED_FINAL');
      }
      await assertAuthorityCurrent(authority);
      var requestIdentityFingerprint = identityFingerprint(input, authority);
      var entry = operations.get(input.idempotencyKey);
      if (entry && entry.identityFingerprint !== requestIdentityFingerprint) {
        throw ingestError('SS_ERP_BYOK_INGEST_IDEMPOTENCY_CONFLICT', 'FAILED_FINAL');
      }
      if (entry && entry.requestHash !== null && entry.requestHash !== input.requestHash) {
        throw ingestError('SS_ERP_BYOK_INGEST_IDEMPOTENCY_CONFLICT', 'FAILED_FINAL');
      }
      if (entry && entry.promise) return entry.promise;
      if (entry && ['ACCEPTED_PENDING_COMMIT', 'SUCCEEDED'].includes(entry.status)
        && entry.resultPublic) {
        entry.promise = commitAccepted(entry, commitAcceptedResult)
          .finally(function () { entry.promise = null; });
        return entry.promise;
      }
      if (!entry) {
        reserveOperationSlot();
        entry = {
          input: input,
          result: null,
          authority: authority,
          command: null,
          identityFingerprint: requestIdentityFingerprint,
          fingerprint: null,
          status: 'RECOVERING',
          errorCode: null,
          binaryDispatched: true,
          grantToken: null,
          requestHash: input.requestHash,
          requestHashCommitted: true,
          resultPublic: null,
          promise: null,
          discardRequested: false,
        };
        operations.set(input.idempotencyKey, entry);
      } else if (entry.requestHash === null) {
        entry.requestHash = input.requestHash;
        entry.requestHashCommitted = true;
      }
      entry.promise = (async function () {
        try {
          await assertAuthorityCurrent(authority);
          var response = await transport.post(
            INGEST_STATUS_PATH,
            statusRequest(input),
            { requiredScope: 'byok:media:ingest' },
          );
          var statusData = response && response.body && response.body.data;
          if (response && response.state === 'response' && response.status === 202
            && isRecord(response.body) && response.body.code === 1
            && isRecord(statusData)
            && [STATUS_STATES.pending, STATUS_STATES.notCommitted].includes(statusData.state)) {
            var pendingError = ingestError(
              statusData.state === STATUS_STATES.notCommitted
                ? 'SS_ERP_BYOK_INGEST_RECEIPT_NOT_COMMITTED'
                : 'SS_ERP_BYOK_INGEST_RECEIPT_PENDING',
              'UNKNOWN_OUTCOME',
            );
            if (statusData.state === STATUS_STATES.notCommitted) pendingError.resetGrant = true;
            throw pendingError;
          }
          if (response && response.state === 'http_error' && response.status === 404
            && response.body && response.body.errorCode === 'byok_ingest_status_not_found') {
            throw ingestError('SS_ERP_BYOK_INGEST_RECEIPT_NOT_FOUND', 'FAILED_FINAL');
          }
          if (response && response.state === 'http_error' && response.status === 404) {
            throw ingestError('SS_ERP_BYOK_INGEST_RECOVERY_UNAVAILABLE', 'UNKNOWN_OUTCOME');
          }
          if (response && response.state === 'http_error'
            && (response.status === 429 || response.status >= 500)) {
            throw ingestError('SS_ERP_BYOK_INGEST_RECOVERY_UNAVAILABLE', 'UNKNOWN_OUTCOME');
          }
          if (response && response.state === 'http_error'
            && response.body && response.body.errorCode === 'byok_ingest_status_failed') {
            throw ingestError('SS_ERP_BYOK_INGEST_RECEIPT_FAILED', 'FAILED_FINAL', {
              status: response.status || null,
            });
          }
          if (!statusData || statusData.state !== STATUS_STATES.succeeded) {
            if (response && ['http_error', 'scope_required', 'authorization_required', 'unpaired']
              .includes(response.state)) {
              throw ingestError('SS_ERP_BYOK_INGEST_RECOVERY_REJECTED', 'FAILED_FINAL', {
                status: response.status || null,
                errorCode: response.body && response.body.errorCode || null,
              });
            }
            throw ingestError('SS_ERP_BYOK_INGEST_RESPONSE_INVALID', 'UNKNOWN_OUTCOME');
          }
          var accepted = parseSuccess(response, input);
          entry.status = 'ACCEPTED_PENDING_COMMIT';
          entry.errorCode = null;
          entry.resultPublic = accepted;
          return await commitAccepted(entry, commitAcceptedResult);
        } catch (error) {
          if (entry.status === 'ACCEPTED_PENDING_COMMIT') throw error;
          var safeError = error && error.code
            ? error
            : ingestError('SS_ERP_BYOK_INGEST_RECOVERY_UNAVAILABLE', 'UNKNOWN_OUTCOME');
          entry.status = safeError.outcome || 'UNKNOWN_OUTCOME';
          entry.errorCode = safeError.code;
          if (entry.status === 'FAILED_FINAL' || safeError.resetGrant === true) {
            entry.grantToken = null;
          }
          if (safeError.code === 'SS_ERP_BYOK_INGEST_RECEIPT_NOT_FOUND') {
            entry.discardRequested = true;
          }
          throw safeError;
        } finally {
          entry.promise = null;
          if (entry.discardRequested) purgeOperation(entry.input.idempotencyKey, entry);
        }
      }());
      return entry.promise;
    }

    function discardResult(resultIdValue) {
      var normalizedResultId = text(resultIdValue, 4, 128);
      var discarded = 0;
      operations.forEach(function (entry, idempotencyKey) {
        if (entry.input.resultId !== normalizedResultId) return;
        if (entry.promise) {
          entry.discardRequested = true;
          return;
        }
        if (purgeOperation(idempotencyKey, entry)) discarded += 1;
      });
      return discarded;
    }

    function getOperationState(idempotencyKeyValue) {
      var idempotencyKey = text(idempotencyKeyValue, 16, 200);
      var entry = operations.get(idempotencyKey);
      if (!entry) return null;
      return {
        contractVersion: CONTRACT_VERSION,
        idempotencyKey: idempotencyKey,
        resultId: entry.input.resultId,
        status: entry.status,
        errorCode: entry.errorCode,
        hasGrant: Boolean(entry.grantToken),
        dispatched: entry.binaryDispatched === true,
        result: entry.resultPublic,
      };
    }

    return Object.freeze({
      ingest: ingest,
      recover: recover,
      discardResult: discardResult,
      getOperationState: getOperationState,
    });
  }

  global.SS_ERP_BYOK_GENERATED_ASSET_INGEST_CLIENT = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    createClient: createClient,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
