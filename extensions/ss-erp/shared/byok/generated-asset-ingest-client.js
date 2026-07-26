(function exposeByokGeneratedAssetIngestClient(global) {
  'use strict';

  var CONTRACT_VERSION = 'extension-byok-generated-asset-ingest-client/v1';
  var COMMAND_VERSION = 'byok-media-ingest/v1';
  var MANIFEST_VERSION = 'extension-byok-media-ingest-request/v1';
  var COMMAND_GRANT_PATH = '/api/extension-device/command-grants';
  var INGEST_PATH = '/api/extension-device/byok-media/ingest';
  var OPERATION = 'BYOK_MEDIA_INGEST';
  var LIFECYCLE_VERSION = 'extension-byok-device-session-lifecycle/v1';
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
    if (Object.keys(value).length !== keys.length
      || Object.keys(value).some(function (key) { return !keys.includes(key); })) {
      throw ingestError('SS_ERP_BYOK_INGEST_INPUT_INVALID');
    }
    if (!['APPEND', 'REPLACE'].includes(value.assignmentMode)
      || typeof value.replaceConfirmed !== 'boolean'
      || value.replaceConfirmed !== (value.assignmentMode === 'REPLACE')) {
      throw ingestError('SS_ERP_BYOK_INGEST_INPUT_INVALID');
    }
    var skuKey = text(value.skuKey, 1, 500);
    var slotKey = text(value.slotKey, 1, 200);
    if (!slotKey.startsWith('sku:' + skuKey + ':')
      || slotKey.length <= ('sku:' + skuKey + ':').length) {
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
      assignmentMode: value.assignmentMode,
      replaceConfirmed: value.replaceConfirmed,
      assignmentOrdinal: assignmentOrdinal(value.assignmentOrdinal),
      idempotencyKey: text(value.idempotencyKey, 16, 200),
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

  function fingerprint(input, result, authority) {
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
      resultSha256: result.sha256,
      requestHash: result.requestHash,
      lifecycleEpoch: authority.lifecycleAuthority.epoch,
      ownerUserId: authority.ownerUserId,
      deviceSessionId: authority.deviceSessionId,
      policyRevision: authority.policyRevision,
    });
  }

  function createClient(options) {
    var transport = options && options.transport;
    var vault = options && options.vault;
    var isAuthorityCurrent = options && options.isAuthorityCurrent;
    if (!transport || typeof transport.post !== 'function' || typeof transport.postBytes !== 'function'
      || !vault || typeof vault.getForBackground !== 'function' || typeof vault.release !== 'function'
      || typeof isAuthorityCurrent !== 'function') {
      throw new TypeError('BYOK ingest client dependencies are unavailable');
    }
    var operations = new Map();

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
      var result = vault.getForBackground(input.resultId);
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
        || binding.policyRevision !== authority.policyRevision
        || binding.operation !== result.operation
        || binding.providerOrigin !== result.providerOrigin
        || binding.model !== result.model
        || binding.policyRevision !== result.policyRevision
        || result.operation !== 'TEXT_TO_IMAGE'
        || result.requestMode !== 'json'
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
        sourceSha256: null,
        referenceSha256s: [],
        maskSha256: null,
      };
    }

    async function issueGrant(entry) {
      var response = await transport.post(COMMAND_GRANT_PATH, {
        operation: OPERATION,
        shopId: entry.input.shopId,
        workflowId: entry.input.workflowId,
        draftVersion: entry.input.draftVersion,
        idempotencyKey: entry.input.idempotencyKey,
        command: entry.command,
      }, { requiredScope: 'byok:media:ingest' });
      var data = response && response.body && response.body.data;
      if (!response || response.state !== 'response' || response.status !== 201
        || !isRecord(response.body) || response.body.code !== 1 || !isRecord(data)
        || !/^[A-Za-z0-9_-]{43,4096}$/u.test(String(data.grantToken || ''))) {
        throw ingestError('SS_ERP_BYOK_INGEST_GRANT_UNAVAILABLE', 'FAILED_RETRYABLE', {
          status: response && response.status || null,
        });
      }
      entry.grantToken = data.grantToken;
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
        if (response && ['http_error', 'scope_required', 'authorization_required'].includes(response.state)) {
          throw ingestError('SS_ERP_BYOK_INGEST_REJECTED', 'FAILED_FINAL', {
            status: response.status || null,
            errorCode: response.body && response.body.errorCode || null,
          });
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

    async function dispatch(entry) {
      try {
        await assertAuthorityCurrent(entry.authority);
        if (!entry.grantToken) await issueGrant(entry);
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
        entry.status = 'SUCCEEDED';
        entry.resultPublic = accepted;
        entry.grantToken = null;
        vault.release(entry.input.resultId);
        return accepted;
      } catch (error) {
        var safeError = error && error.code
          ? error
          : ingestError(
            'SS_ERP_BYOK_INGEST_UNKNOWN_OUTCOME',
            entry.binaryDispatched ? 'UNKNOWN_OUTCOME' : 'FAILED_RETRYABLE',
          );
        entry.status = safeError.outcome || (entry.binaryDispatched ? 'UNKNOWN_OUTCOME' : 'FAILED_RETRYABLE');
        entry.errorCode = safeError.code;
        if (entry.status === 'FAILED_FINAL') entry.grantToken = null;
        throw safeError;
      } finally {
        entry.promise = null;
      }
    }

    async function ingest(value, runtimeAuthorityValue) {
      var input = normalizeInput(value);
      var authority = normalizeRuntimeAuthority(runtimeAuthorityValue);
      await assertAuthorityCurrent(authority);
      var result = resultForInput(input, authority);
      var requestFingerprint = fingerprint(input, result, authority);
      var existing = operations.get(input.idempotencyKey);
      if (existing) {
        if (existing.fingerprint !== requestFingerprint) {
          throw ingestError('SS_ERP_BYOK_INGEST_IDEMPOTENCY_CONFLICT', 'FAILED_FINAL');
        }
        if (existing.status === 'SUCCEEDED') return existing.resultPublic;
        if (existing.promise) return existing.promise;
        // A repeated user action is an explicit retry of the idempotent ERP
        // ingest endpoint; it reuses the same grant and never repeats Provider work.
        existing.binaryDispatched = false;
        existing.promise = dispatch(existing);
        return existing.promise;
      }
      var entry = {
        input: input,
        result: result,
        authority: authority,
        command: buildCommand(input, result),
        fingerprint: requestFingerprint,
        status: 'PREPARING',
        errorCode: null,
        binaryDispatched: false,
        grantToken: null,
        resultPublic: null,
        promise: null,
      };
      operations.set(input.idempotencyKey, entry);
      entry.promise = dispatch(entry);
      return entry.promise;
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
        result: entry.resultPublic,
      };
    }

    return Object.freeze({ ingest: ingest, getOperationState: getOperationState });
  }

  global.SS_ERP_BYOK_GENERATED_ASSET_INGEST_CLIENT = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    createClient: createClient,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
