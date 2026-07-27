(function exposeByokGeneratedAssetBatchIngestClient(global) {
  'use strict';

  var CONTRACT_VERSION = 'extension-byok-generated-asset-batch-ingest-client/v1';
  var COMMAND_VERSION = 'byok-media-ingest-batch/v1';
  var COMMAND_ITEM_VERSION = 'byok-media-ingest/v1';
  var MANIFEST_VERSION = 'extension-byok-media-batch-ingest-manifest/v1';
  var RECEIPT_VERSION = 'extension-byok-media-batch-ingest-receipt/v1';
  var STATUS_VERSION = 'extension-byok-media-batch-ingest-status/v1';
  var GRANT_PATH = '/api/extension-device/command-grants';
  var INGEST_PATH = '/api/extension-device/byok-media/batch-ingest';
  var STATUS_PATH = '/api/extension-device/byok-media/batch-ingest-status';
  var OPERATION = 'BYOK_MEDIA_INGEST';
  var REQUIRED_SCOPE = 'byok:media:ingest';
  var LIFECYCLE_VERSION = 'extension-byok-device-session-lifecycle/v1';
  var READINESS_BINDING_VERSION = 'extension-byok-readiness-binding/v2';
  var MAX_BATCH_SIZE = 4;
  var MAX_RESULT_BYTES = 20 * 1024 * 1024;
  var MAX_BATCH_BYTES = 50 * 1024 * 1024;
  var MAX_OPERATION_COUNT = 100;
  var HASH_PATTERN = /^[a-f0-9]{64}$/u;
  var MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
  var OPERATIONS = ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'];
  var SOURCE_PLATFORMS = ['1688', 'pdd', 'taobao', 'tmall'];
  var SHARED_DETAIL_ROLES = ['SCENE', 'DETAIL', 'SPEC', 'PACKAGING'];
  var INPUT_KEYS = [
    'executionBatchId', 'resultIds', 'shopId', 'workflowId', 'draftRevision', 'draftVersion',
    'idempotencyKey',
  ];
  var AUTHORITY_KEYS = [
    'lifecycleAuthority', 'ownerUserId', 'deviceSessionId', 'shopId', 'workflowId',
    'draftRevision', 'draftVersion', 'policyRevision',
  ];
  var BINDING_KEYS = [
    'contractVersion', 'ownerUserId', 'deviceSessionId', 'shopId', 'workflowId',
    'draftRevision', 'draftVersion', 'sourcePlatform', 'sourceProductId',
    'sourceCaptureSnapshotId', 'supplyGoodsId', 'skuKey', 'slotKey',
    'assignmentMode', 'assignmentOrdinal', 'providerOrigin', 'model', 'operation',
    'policyRevision',
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

  function batchError(code, outcome, details) {
    var error = new Error(code);
    error.code = code;
    error.outcome = outcome || 'FAILED_FINAL';
    error.automaticRetryAllowed = error.outcome === 'FAILED_RETRYABLE';
    if (details) Object.assign(error, details);
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

  function hasControlCharacter(value) {
    return Array.from(value).some(function (character) {
      var codePoint = character.codePointAt(0) || 0;
      return codePoint <= 31 || codePoint === 127;
    });
  }

  function canonicalText(value, minimum, maximum) {
    if (typeof value !== 'string') {
      throw batchError('SS_ERP_BYOK_BATCH_INGEST_INPUT_INVALID');
    }
    var normalized = value.normalize('NFKC').trim();
    if (normalized !== value || normalized.length < minimum || normalized.length > maximum
      || hasControlCharacter(normalized)) {
      throw batchError('SS_ERP_BYOK_BATCH_INGEST_INPUT_INVALID');
    }
    return normalized;
  }

  function positiveInteger(value) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw batchError('SS_ERP_BYOK_BATCH_INGEST_INPUT_INVALID');
    }
    return value;
  }

  function assignmentOrdinal(value) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 499) {
      throw batchError('SS_ERP_BYOK_BATCH_INGEST_BINDING_MISMATCH', 'STALE_DRAFT');
    }
    return value;
  }

  function sha256(value) {
    if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
      throw batchError('SS_ERP_BYOK_BATCH_INGEST_BINDING_MISMATCH', 'STALE_DRAFT');
    }
    return value;
  }

  function nullableSha256(value) {
    return value === null ? null : sha256(value);
  }

  function isSupportedSlotKey(skuKey, slotKey) {
    return slotKey === 'sku:' + skuKey + ':hero'
      || SHARED_DETAIL_ROLES.some(function (role) {
        return slotKey === 'shared:detail:' + role;
      });
  }

  function providerOrigin(value) {
    var canonical;
    try {
      canonical = canonicalText(value, 1, 300);
    } catch {
      throw batchError('SS_ERP_BYOK_BATCH_INGEST_BINDING_MISMATCH', 'STALE_DRAFT');
    }
    var parsed;
    try {
      parsed = new URL(canonical);
    } catch {
      throw batchError('SS_ERP_BYOK_BATCH_INGEST_BINDING_MISMATCH', 'STALE_DRAFT');
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password
      || parsed.search || parsed.hash || parsed.pathname !== '/'
      || parsed.origin !== canonical) {
      throw batchError('SS_ERP_BYOK_BATCH_INGEST_BINDING_MISMATCH', 'STALE_DRAFT');
    }
    return canonical;
  }

  function normalizeInput(value) {
    if (!exactKeys(value, INPUT_KEYS) || !Array.isArray(value.resultIds)
      || value.resultIds.length < 1 || value.resultIds.length > MAX_BATCH_SIZE) {
      throw batchError('SS_ERP_BYOK_BATCH_INGEST_INPUT_INVALID');
    }
    var resultIds = value.resultIds.map(function (resultId) {
      return canonicalText(resultId, 4, 128);
    });
    if (new Set(resultIds).size !== resultIds.length) {
      throw batchError('SS_ERP_BYOK_BATCH_INGEST_INPUT_INVALID');
    }
    return Object.freeze({
      executionBatchId: canonicalText(value.executionBatchId, 1, 200),
      resultIds: Object.freeze(resultIds),
      shopId: canonicalText(value.shopId, 1, 200),
      workflowId: canonicalText(value.workflowId, 1, 200),
      draftRevision: positiveInteger(value.draftRevision),
      draftVersion: positiveInteger(value.draftVersion),
      idempotencyKey: canonicalText(value.idempotencyKey, 16, 200),
    });
  }

  function normalizeAuthority(value, input) {
    if (!exactKeys(value, AUTHORITY_KEYS)
      || !exactKeys(value.lifecycleAuthority, ['contractVersion', 'epoch'])
      || value.lifecycleAuthority.contractVersion !== LIFECYCLE_VERSION
      || !Number.isSafeInteger(value.lifecycleAuthority.epoch)
      || value.lifecycleAuthority.epoch < 0) {
      throw batchError('SS_ERP_BYOK_BATCH_INGEST_AUTHORITY_INVALID', 'FAILED_FINAL');
    }
    var normalized;
    try {
      normalized = Object.freeze({
        lifecycleAuthority: Object.freeze({
          contractVersion: LIFECYCLE_VERSION,
          epoch: value.lifecycleAuthority.epoch,
        }),
        ownerUserId: canonicalText(value.ownerUserId, 1, 200),
        deviceSessionId: canonicalText(value.deviceSessionId, 1, 200),
        shopId: canonicalText(value.shopId, 1, 200),
        workflowId: canonicalText(value.workflowId, 1, 200),
        draftRevision: positiveInteger(value.draftRevision),
        draftVersion: positiveInteger(value.draftVersion),
        policyRevision: canonicalText(value.policyRevision, 1, 200),
      });
    } catch {
      throw batchError('SS_ERP_BYOK_BATCH_INGEST_AUTHORITY_INVALID', 'FAILED_FINAL');
    }
    if (normalized.shopId !== input.shopId
      || normalized.workflowId !== input.workflowId
      || normalized.draftRevision !== input.draftRevision
      || normalized.draftVersion !== input.draftVersion) {
      throw batchError('SS_ERP_BYOK_BATCH_INGEST_AUTHORITY_INVALID', 'FAILED_FINAL');
    }
    return normalized;
  }

  function bindingText(value, maximum) {
    try {
      return canonicalText(value, 1, maximum);
    } catch {
      throw batchError('SS_ERP_BYOK_BATCH_INGEST_BINDING_MISMATCH', 'STALE_DRAFT');
    }
  }

  function bindingPositiveInteger(value) {
    try {
      return positiveInteger(value);
    } catch {
      throw batchError('SS_ERP_BYOK_BATCH_INGEST_BINDING_MISMATCH', 'STALE_DRAFT');
    }
  }

  function validateProvenance(result) {
    var operation = result.operation;
    var requestMode = result.requestMode;
    if (!OPERATIONS.includes(operation)
      || requestMode !== (operation === 'TEXT_TO_IMAGE' ? 'json' : 'multipart')) {
      throw batchError('SS_ERP_BYOK_BATCH_INGEST_BINDING_MISMATCH', 'STALE_DRAFT');
    }
    var sourceSha256 = nullableSha256(result.sourceSha256);
    var maskSha256 = nullableSha256(result.maskSha256);
    if (!Array.isArray(result.referenceSha256s) || result.referenceSha256s.length > 4) {
      throw batchError('SS_ERP_BYOK_BATCH_INGEST_BINDING_MISMATCH', 'STALE_DRAFT');
    }
    var referenceSha256s = result.referenceSha256s.map(sha256);
    if (new Set(referenceSha256s).size !== referenceSha256s.length
      || (operation === 'TEXT_TO_IMAGE'
        && (sourceSha256 !== null || referenceSha256s.length !== 0 || maskSha256 !== null))
      || (operation === 'IMAGE_TO_IMAGE'
        && (sourceSha256 !== null || referenceSha256s.length < 1 || maskSha256 !== null))
      || (operation === 'FULL_EDIT'
        && (sourceSha256 === null || referenceSha256s.length !== 0 || maskSha256 !== null))
      || (operation === 'INPAINT'
        && (sourceSha256 === null || referenceSha256s.length !== 0 || maskSha256 === null))) {
      throw batchError('SS_ERP_BYOK_BATCH_INGEST_BINDING_MISMATCH', 'STALE_DRAFT');
    }
    return {
      operation: operation,
      requestMode: requestMode,
      sourceSha256: sourceSha256,
      referenceSha256s: referenceSha256s,
      maskSha256: maskSha256,
    };
  }

  function resolveResult(resultId, result, input, authority) {
    var binding = result && result.binding;
    if (!isRecord(result) || result.resultId !== resultId
      || result.reviewState !== 'APPROVED' || typeof result.reviewedAt !== 'string'
      || !exactKeys(binding, BINDING_KEYS)
      || binding.contractVersion !== READINESS_BINDING_VERSION
      || result.lifecycleEpoch !== authority.lifecycleAuthority.epoch
      || binding.ownerUserId !== authority.ownerUserId
      || binding.deviceSessionId !== authority.deviceSessionId
      || binding.shopId !== input.shopId || binding.shopId !== authority.shopId
      || binding.workflowId !== input.workflowId || binding.workflowId !== authority.workflowId
      || binding.draftRevision !== input.draftRevision
      || binding.draftRevision !== authority.draftRevision
      || binding.draftVersion !== input.draftVersion
      || binding.draftVersion !== authority.draftVersion
      || binding.policyRevision !== authority.policyRevision
      || binding.assignmentMode !== 'APPEND'
      || binding.operation !== result.operation
      || binding.providerOrigin !== result.providerOrigin
      || binding.model !== result.model
      || binding.policyRevision !== result.policyRevision) {
      throw batchError('SS_ERP_BYOK_BATCH_INGEST_BINDING_MISMATCH', 'STALE_DRAFT');
    }
    if (!SOURCE_PLATFORMS.includes(binding.sourcePlatform)) {
      throw batchError('SS_ERP_BYOK_BATCH_INGEST_BINDING_MISMATCH', 'STALE_DRAFT');
    }
    var skuKey = bindingText(binding.skuKey, 500);
    var slotKey = bindingText(binding.slotKey, 200);
    if (!isSupportedSlotKey(skuKey, slotKey)) {
      throw batchError('SS_ERP_BYOK_BATCH_INGEST_BINDING_MISMATCH', 'STALE_DRAFT');
    }
    var provenance = validateProvenance(result);
    var mimeType = bindingText(result.mimeType, 32).toLowerCase();
    if (!MIME_TYPES.includes(mimeType)
      || !Number.isSafeInteger(result.byteLength) || result.byteLength < 1
      || result.byteLength > MAX_RESULT_BYTES
      || typeof global.Blob !== 'function' || !(result.blob instanceof global.Blob)
      || result.blob.type !== mimeType || result.blob.size !== result.byteLength) {
      throw batchError('SS_ERP_BYOK_BATCH_INGEST_BINDING_MISMATCH', 'STALE_DRAFT');
    }
    var command = Object.freeze({
      schemaVersion: COMMAND_ITEM_VERSION,
      providerOrigin: providerOrigin(result.providerOrigin),
      providerOperation: provenance.operation,
      requestMode: provenance.requestMode,
      model: bindingText(result.model, 200),
      executionIntentId: bindingText(result.executionIntentId, 200),
      providerIdempotencyKey: bindingText(result.idempotencyKey, 200),
      providerRequestHash: sha256(result.requestHash),
      providerRequestIdSha256: nullableSha256(result.providerRequestIdSha256),
      promptSha256: sha256(result.promptHash),
      negativePromptSha256: nullableSha256(result.negativePromptHash),
      draftRevision: bindingPositiveInteger(binding.draftRevision),
      skuKey: skuKey,
      slotKey: slotKey,
      assignmentMode: 'APPEND',
      replaceConfirmed: false,
      assignmentOrdinal: assignmentOrdinal(binding.assignmentOrdinal),
      resultSha256: sha256(result.sha256),
      resultMimeType: mimeType,
      resultSizeBytes: result.byteLength,
      sourceSha256: provenance.sourceSha256,
      referenceSha256s: Object.freeze(provenance.referenceSha256s.slice()),
      maskSha256: provenance.maskSha256,
    });
    if (command.providerIdempotencyKey.length < 16) {
      throw batchError('SS_ERP_BYOK_BATCH_INGEST_BINDING_MISMATCH', 'STALE_DRAFT');
    }
    return {
      resultId: resultId,
      blob: result.blob,
      command: command,
      sourceIdentity: Object.freeze({
        sourcePlatform: binding.sourcePlatform,
        sourceProductId: bindingText(binding.sourceProductId, 200),
        sourceCaptureSnapshotId: bindingText(binding.sourceCaptureSnapshotId, 200),
        supplyGoodsId: bindingText(binding.supplyGoodsId, 200),
      }),
    };
  }

  function sameSourceIdentity(left, right) {
    return Object.keys(left).every(function (key) { return left[key] === right[key]; });
  }

  function unique(items, selector) {
    return new Set(items.map(selector)).size === items.length;
  }

  function resolveBatch(input, authority, vault) {
    var resolved = input.resultIds.map(function (resultId) {
      var result;
      try {
        result = vault.getApprovedForBackground(resultId);
      } catch {
        throw batchError('SS_ERP_BYOK_BATCH_INGEST_BINDING_MISMATCH', 'STALE_DRAFT');
      }
      return resolveResult(resultId, result, input, authority);
    });
    var first = resolved[0];
    if (!resolved.every(function (item, index) {
      return sameSourceIdentity(item.sourceIdentity, first.sourceIdentity)
        && item.command.assignmentOrdinal === first.command.assignmentOrdinal + index;
    })
      || resolved.reduce(function (total, item) {
        return total + item.command.resultSizeBytes;
      }, 0) > MAX_BATCH_BYTES
      || !unique(resolved, function (item) { return item.resultId; })
      || !unique(resolved, function (item) { return item.command.executionIntentId; })
      || !unique(resolved, function (item) { return item.command.slotKey; })
      || !unique(resolved, function (item) { return item.command.resultSha256; })
      || !unique(resolved, function (item) { return item.command.providerIdempotencyKey; })
      || !unique(resolved, function (item) { return item.command.providerRequestHash; })) {
      throw batchError('SS_ERP_BYOK_BATCH_INGEST_BINDING_MISMATCH', 'STALE_DRAFT');
    }
    return resolved;
  }

  function createClient(options) {
    var transport = options && options.transport;
    var vault = options && options.vault;
    var isAuthorityCurrent = options && options.isAuthorityCurrent;
    if (!transport || typeof transport.post !== 'function'
      || typeof transport.postMultipart !== 'function'
      || !vault || typeof vault.getApprovedForBackground !== 'function'
      || typeof vault.release !== 'function'
      || typeof isAuthorityCurrent !== 'function'
      || typeof global.FormData !== 'function'
      || typeof global.Blob !== 'function') {
      throw new TypeError('BYOK batch ingest client dependencies are unavailable');
    }
    var operations = new Map();

    function reserveOperation() {
      if (operations.size < MAX_OPERATION_COUNT) return;
      for (const pair of operations.entries()) {
        if (['SUCCEEDED', 'FAILED_FINAL'].includes(pair[1].status)) {
          operations.delete(pair[0]);
          if (operations.size < MAX_OPERATION_COUNT) return;
        }
      }
      throw batchError(
        'SS_ERP_BYOK_BATCH_INGEST_CAPACITY_EXCEEDED',
        'FAILED_RETRYABLE',
      );
    }

    async function assertAuthorityCurrent(authority) {
      var current = false;
      try {
        current = await isAuthorityCurrent(authority.lifecycleAuthority);
      } catch {
        current = false;
      }
      if (current !== true) {
        throw batchError('SS_ERP_BYOK_BATCH_INGEST_AUTHORITY_STALE', 'FAILED_FINAL');
      }
    }

    async function issueGrant(entry) {
      var response;
      try {
        response = await transport.post(GRANT_PATH, {
          operation: OPERATION,
          shopId: entry.input.shopId,
          workflowId: entry.input.workflowId,
          draftVersion: entry.input.draftVersion,
          idempotencyKey: entry.input.idempotencyKey,
          command: entry.command,
        }, { requiredScope: REQUIRED_SCOPE });
      } catch {
        throw batchError(
          'SS_ERP_BYOK_BATCH_INGEST_GRANT_UNAVAILABLE',
          'FAILED_RETRYABLE',
        );
      }
      var status = Number(response && response.status) || null;
      var state = response && response.state;
      if (['scope_required', 'authorization_required', 'unpaired'].includes(state)
        || (state === 'http_error' && status !== null && status >= 400
          && status < 500 && status !== 429)) {
        throw batchError('SS_ERP_BYOK_BATCH_INGEST_GRANT_REJECTED', 'FAILED_FINAL', {
          status: status,
        });
      }
      if (!response || state === 'http_error') {
        throw batchError(
          'SS_ERP_BYOK_BATCH_INGEST_GRANT_UNAVAILABLE',
          'FAILED_RETRYABLE',
          { status: status },
        );
      }
      var data = response.body && response.body.data;
      if (state !== 'response' || status !== 201
        || !isRecord(response.body) || response.body.code !== 1 || !isRecord(data)
        || !/^[A-Za-z0-9_-]{43,4096}$/u.test(String(data.grantToken || ''))
        || !HASH_PATTERN.test(String(data.requestHash || ''))) {
        throw batchError(
          'SS_ERP_BYOK_BATCH_INGEST_GRANT_RESPONSE_INVALID',
          'FAILED_FINAL',
          { status: status },
        );
      }
      entry.grantToken = data.grantToken;
      entry.requestHash = data.requestHash;
    }

    function normalizedAssignment(value, receiptItem, expected) {
      var shared = expected.slotKey.startsWith('shared:detail:');
      var expectedKeys = shared
        ? ['scope', 'slotKey', 'assetId', 'source']
        : ['scope', 'skuKey', 'slotKey', 'assetId', 'source'];
      var expectedSource = ['FULL_EDIT', 'INPAINT'].includes(expected.providerOperation)
        ? 'EDITED' : 'GENERATED';
      if (!exactKeys(value, expectedKeys)
        || value.scope !== (shared ? 'PRODUCT' : 'SKU')
        || (!shared && value.skuKey !== expected.skuKey)
        || value.slotKey !== expected.slotKey
        || value.assetId !== receiptItem.assetId
        || value.source !== expectedSource) {
        throw batchError(
          'SS_ERP_BYOK_BATCH_INGEST_RESPONSE_INVALID',
          'UNKNOWN_OUTCOME',
        );
      }
      return Object.freeze(shared ? {
        scope: 'PRODUCT',
        slotKey: value.slotKey,
        assetId: value.assetId,
        source: value.source,
      } : {
        scope: 'SKU',
        skuKey: value.skuKey,
        slotKey: value.slotKey,
        assetId: value.assetId,
        source: value.source,
      });
    }

    function normalizedReceiptItem(value, expected, policyRevision) {
      if (!exactKeys(value, RECEIPT_ITEM_KEYS)
        || !HASH_PATTERN.test(String(value.normalizedSha256 || ''))
        || !HASH_PATTERN.test(String(value.assignmentSha256 || ''))
        || !MIME_TYPES.includes(value.mimeType)
        || !Number.isSafeInteger(value.width) || value.width < 1
        || !Number.isSafeInteger(value.height) || value.height < 1
        || value.executionIntentId !== expected.executionIntentId
        || value.providerRequestHash !== expected.providerRequestHash
        || value.providerResultSha256 !== expected.resultSha256
        || value.assignmentOrdinal !== expected.assignmentOrdinal
        || value.skuKey !== expected.skuKey
        || value.slotKey !== expected.slotKey
        || !Number.isSafeInteger(value.policyRevision) || value.policyRevision < 1
        || String(value.policyRevision) !== policyRevision) {
        throw batchError(
          'SS_ERP_BYOK_BATCH_INGEST_RESPONSE_INVALID',
          'UNKNOWN_OUTCOME',
        );
      }
      var item;
      try {
        item = {
          assetId: canonicalText(value.assetId, 1, 200),
          provenanceId: canonicalText(value.provenanceId, 1, 200),
          executionIntentId: canonicalText(value.executionIntentId, 1, 200),
          providerRequestHash: value.providerRequestHash,
          providerResultSha256: value.providerResultSha256,
          normalizedSha256: value.normalizedSha256,
          mimeType: value.mimeType,
          width: value.width,
          height: value.height,
          assignmentOrdinal: value.assignmentOrdinal,
          assignmentSha256: value.assignmentSha256,
          skuKey: canonicalText(value.skuKey, 1, 500),
          slotKey: canonicalText(value.slotKey, 1, 200),
          assignment: normalizedAssignment(value.assignment, value, expected),
          policyRevision: String(value.policyRevision),
        };
      } catch {
        throw batchError(
          'SS_ERP_BYOK_BATCH_INGEST_RESPONSE_INVALID',
          'UNKNOWN_OUTCOME',
        );
      }
      return Object.freeze(item);
    }

    function responseText(value, maximum) {
      try {
        return canonicalText(value, 1, maximum);
      } catch {
        throw batchError(
          'SS_ERP_BYOK_BATCH_INGEST_RESPONSE_INVALID',
          'UNKNOWN_OUTCOME',
        );
      }
    }

    function parseReceipt(response, entry) {
      var data = response && response.body && response.body.data;
      if (!response || response.state !== 'response' || response.status !== 200
        || !exactKeys(response.body, ['code', 'data']) || response.body.code !== 1
        || !exactKeys(data, RECEIPT_KEYS)
        || data.contractVersion !== RECEIPT_VERSION
        || data.executionBatchId !== entry.input.executionBatchId
        || typeof data.replayed !== 'boolean'
        || data.requestHash !== entry.requestHash
        || data.sourceDraftRevision !== entry.input.draftRevision
        || data.sourceDraftVersion !== entry.input.draftVersion
        || data.boundDraftRevision !== data.sourceDraftRevision + 1
        || data.boundDraftVersion !== data.sourceDraftVersion + 1
        || data.erpAiChargeCents !== 0
        || !Array.isArray(data.items)
        || data.items.length !== entry.command.items.length) {
        throw batchError(
          'SS_ERP_BYOK_BATCH_INGEST_RESPONSE_INVALID',
          'UNKNOWN_OUTCOME',
        );
      }
      var items = data.items.map(function (item, index) {
        return normalizedReceiptItem(
          item,
          entry.command.items[index],
          entry.authority.policyRevision,
        );
      });
      for (const key of [
        'assetId', 'provenanceId', 'executionIntentId', 'providerRequestHash',
        'providerResultSha256', 'assignmentSha256',
      ]) {
        if (new Set(items.map(function (item) { return item[key]; })).size !== items.length) {
          throw batchError(
            'SS_ERP_BYOK_BATCH_INGEST_RESPONSE_INVALID',
            'UNKNOWN_OUTCOME',
          );
        }
      }
      return Object.freeze({
        contractVersion: RECEIPT_VERSION,
        executionBatchId: entry.input.executionBatchId,
        replayed: data.replayed,
        receiptId: responseText(data.receiptId, 200),
        requestHash: data.requestHash,
        sourceDraftRevision: data.sourceDraftRevision,
        sourceDraftVersion: data.sourceDraftVersion,
        boundDraftRevision: data.boundDraftRevision,
        boundDraftVersion: data.boundDraftVersion,
        erpAiChargeCents: 0,
        items: Object.freeze(items),
      });
    }

    function classifyPostResponse(response) {
      var status = Number(response && response.status) || null;
      var state = response && response.state;
      if (['scope_required', 'authorization_required', 'unpaired'].includes(state)
        || (state === 'http_error' && status !== null && status >= 400
          && status < 500 && status !== 429)) {
        throw batchError('SS_ERP_BYOK_BATCH_INGEST_REJECTED', 'FAILED_FINAL', {
          status: status,
        });
      }
    }

    async function dispatch(entry) {
      try {
        await assertAuthorityCurrent(entry.authority);
        var resolved = resolveBatch(entry.input, entry.authority, vault);
        var command = Object.freeze({
          schemaVersion: COMMAND_VERSION,
          executionBatchId: entry.input.executionBatchId,
          items: Object.freeze(resolved.map(function (item) { return item.command; })),
        });
        var resultFingerprint = JSON.stringify({
          resultIds: entry.input.resultIds,
          command: command,
        });
        if (entry.resultFingerprint !== null && entry.resultFingerprint !== resultFingerprint) {
          throw batchError('SS_ERP_BYOK_BATCH_INGEST_IDEMPOTENCY_CONFLICT', 'FAILED_FINAL');
        }
        entry.resultFingerprint = resultFingerprint;
        entry.command = command;
        entry.resolved = resolved;
        await issueGrant(entry);
        await assertAuthorityCurrent(entry.authority);
        var manifest = {
          contractVersion: MANIFEST_VERSION,
          operation: OPERATION,
          shopId: entry.input.shopId,
          workflowId: entry.input.workflowId,
          draftVersion: entry.input.draftVersion,
          idempotencyKey: entry.input.idempotencyKey,
          executionBatchId: entry.input.executionBatchId,
          command: entry.command,
        };
        var form = new global.FormData();
        form.append('manifest', JSON.stringify(manifest));
        entry.resolved.forEach(function (item, index) {
          var extension = item.command.resultMimeType === 'image/jpeg'
            ? 'jpg'
            : item.command.resultMimeType.split('/')[1];
          form.append('image-' + index, item.blob, 'image-' + index + '.' + extension);
        });
        entry.multipartDispatched = true;
        var response;
        try {
          response = await transport.postMultipart(INGEST_PATH, form, {
            requiredScope: REQUIRED_SCOPE,
            commandGrant: entry.grantToken,
          });
        } catch {
          throw batchError(
            'SS_ERP_BYOK_BATCH_INGEST_UNKNOWN_OUTCOME',
            'UNKNOWN_OUTCOME',
          );
        }
        classifyPostResponse(response);
        var accepted = parseReceipt(response, entry);
        entry.status = 'SUCCEEDED';
        entry.receipt = accepted;
        entry.grantToken = null;
        entry.input.resultIds.forEach(function (resultId) {
          try { vault.release(resultId); } catch {}
        });
        return accepted;
      } catch (error) {
        var safeError = error && error.code
          ? error
          : batchError(
            entry.multipartDispatched
              ? 'SS_ERP_BYOK_BATCH_INGEST_UNKNOWN_OUTCOME'
              : 'SS_ERP_BYOK_BATCH_INGEST_UNAVAILABLE',
            entry.multipartDispatched ? 'UNKNOWN_OUTCOME' : 'FAILED_RETRYABLE',
          );
        entry.status = safeError.outcome || (entry.multipartDispatched
          ? 'UNKNOWN_OUTCOME'
          : 'FAILED_RETRYABLE');
        entry.errorCode = safeError.code;
        if (entry.status !== 'FAILED_RETRYABLE') entry.grantToken = null;
        throw safeError;
      } finally {
        entry.resolved = null;
        entry.promise = null;
      }
    }

    function statusRequest(entry) {
      if (!entry.command || !Array.isArray(entry.command.items)
        || !HASH_PATTERN.test(String(entry.requestHash || ''))) {
        throw batchError(
          'SS_ERP_BYOK_BATCH_INGEST_RECOVERY_IDENTITY_INVALID',
          'FAILED_FINAL',
        );
      }
      return Object.freeze({
        contractVersion: STATUS_VERSION,
        executionBatchId: entry.input.executionBatchId,
        shopId: entry.input.shopId,
        workflowId: entry.input.workflowId,
        draftRevision: entry.input.draftRevision,
        draftVersion: entry.input.draftVersion,
        idempotencyKey: entry.input.idempotencyKey,
        requestHash: entry.requestHash,
        items: Object.freeze(entry.command.items.map(function (item) {
          return Object.freeze({
            executionIntentId: item.executionIntentId,
            providerRequestHash: item.providerRequestHash,
            providerResultSha256: item.resultSha256,
            skuKey: item.skuKey,
            slotKey: item.slotKey,
            assignmentOrdinal: item.assignmentOrdinal,
          });
        })),
      });
    }

    async function recoverOperation(entry) {
      try {
        await assertAuthorityCurrent(entry.authority);
        var response;
        try {
          response = await transport.post(
            STATUS_PATH,
            statusRequest(entry),
            { requiredScope: REQUIRED_SCOPE },
          );
        } catch {
          throw batchError(
            'SS_ERP_BYOK_BATCH_INGEST_RECOVERY_UNAVAILABLE',
            'UNKNOWN_OUTCOME',
          );
        }
        if (response && response.state === 'response' && response.status === 200) {
          var accepted = parseReceipt(response, entry);
          entry.status = 'SUCCEEDED';
          entry.receipt = accepted;
          entry.errorCode = null;
          entry.input.resultIds.forEach(function (resultId) {
            try { vault.release(resultId); } catch {}
          });
          return accepted;
        }
        var pending = response && response.state === 'response' && response.status === 202
          ? response.body && response.body.data
          : null;
        if (exactKeys(pending, ['state'])
          && ['PENDING', 'NOT_COMMITTED'].includes(pending.state)) {
          throw batchError(
            pending.state === 'PENDING'
              ? 'SS_ERP_BYOK_BATCH_INGEST_RECOVERY_PENDING'
              : 'SS_ERP_BYOK_BATCH_INGEST_NOT_COMMITTED',
            pending.state === 'PENDING' ? 'UNKNOWN_OUTCOME' : 'FAILED_FINAL',
          );
        }
        var failureCode = response && response.body && response.body.errorCode;
        if (response && response.state === 'http_error' && response.status === 409
          && failureCode === 'byok_batch_ingest_status_failed') {
          throw batchError('SS_ERP_BYOK_BATCH_INGEST_FAILED', 'FAILED_FINAL');
        }
        throw batchError(
          'SS_ERP_BYOK_BATCH_INGEST_RECOVERY_UNAVAILABLE',
          'UNKNOWN_OUTCOME',
        );
      } catch (error) {
        var safeError = error && error.code
          ? error
          : batchError(
            'SS_ERP_BYOK_BATCH_INGEST_RECOVERY_UNAVAILABLE',
            'UNKNOWN_OUTCOME',
          );
        entry.status = safeError.outcome === 'FAILED_FINAL'
          ? 'FAILED_FINAL' : 'UNKNOWN_OUTCOME';
        entry.errorCode = safeError.code;
        throw safeError;
      } finally {
        entry.promise = null;
      }
    }

    async function ingest(value, runtimeAuthorityValue) {
      var input = normalizeInput(value);
      var authority = normalizeAuthority(runtimeAuthorityValue, input);
      var identityFingerprint = JSON.stringify({ input: input, authority: authority });
      var existing = operations.get(input.idempotencyKey);
      if (existing) {
        if (existing.identityFingerprint !== identityFingerprint) {
          throw batchError('SS_ERP_BYOK_BATCH_INGEST_IDEMPOTENCY_CONFLICT', 'FAILED_FINAL');
        }
        if (existing.status === 'SUCCEEDED') return existing.receipt;
        if (existing.promise) return existing.promise;
        if (existing.status === 'UNKNOWN_OUTCOME') {
          throw batchError(
            existing.errorCode || 'SS_ERP_BYOK_BATCH_INGEST_UNKNOWN_OUTCOME',
            'UNKNOWN_OUTCOME',
          );
        }
        if (existing.status === 'FAILED_FINAL') {
          throw batchError(
            existing.errorCode || 'SS_ERP_BYOK_BATCH_INGEST_REJECTED',
            'FAILED_FINAL',
          );
        }
        existing.multipartDispatched = false;
        existing.promise = dispatch(existing);
        return existing.promise;
      }
      reserveOperation();
      var entry = {
        input: input,
        authority: authority,
        identityFingerprint: identityFingerprint,
        resultFingerprint: null,
        command: null,
        resolved: null,
        grantToken: null,
        requestHash: null,
        multipartDispatched: false,
        status: 'PREPARING',
        errorCode: null,
        receipt: null,
        promise: null,
      };
      operations.set(input.idempotencyKey, entry);
      entry.promise = dispatch(entry);
      return entry.promise;
    }

    async function recover(value, runtimeAuthorityValue) {
      var input = normalizeInput(value);
      var authority = normalizeAuthority(runtimeAuthorityValue, input);
      var identityFingerprint = JSON.stringify({ input: input, authority: authority });
      var entry = operations.get(input.idempotencyKey);
      if (!entry || entry.identityFingerprint !== identityFingerprint) {
        throw batchError(
          entry ? 'SS_ERP_BYOK_BATCH_INGEST_IDEMPOTENCY_CONFLICT'
            : 'SS_ERP_BYOK_BATCH_INGEST_RECOVERY_IDENTITY_INVALID',
          'FAILED_FINAL',
        );
      }
      if (entry.status === 'SUCCEEDED') return entry.receipt;
      if (entry.status !== 'UNKNOWN_OUTCOME') {
        throw batchError(
          entry.errorCode || 'SS_ERP_BYOK_BATCH_INGEST_RECOVERY_IDENTITY_INVALID',
          entry.status === 'FAILED_FINAL' ? 'FAILED_FINAL' : 'UNKNOWN_OUTCOME',
        );
      }
      if (entry.promise) return entry.promise;
      entry.promise = recoverOperation(entry);
      return entry.promise;
    }

    return Object.freeze({ ingest: ingest, recover: recover });
  }

  global.SS_ERP_BYOK_GENERATED_ASSET_BATCH_INGEST_CLIENT = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    COMMAND_VERSION: COMMAND_VERSION,
    COMMAND_ITEM_VERSION: COMMAND_ITEM_VERSION,
    MANIFEST_VERSION: MANIFEST_VERSION,
    RECEIPT_VERSION: RECEIPT_VERSION,
    STATUS_VERSION: STATUS_VERSION,
    GRANT_PATH: GRANT_PATH,
    INGEST_PATH: INGEST_PATH,
    STATUS_PATH: STATUS_PATH,
    MAX_BATCH_BYTES: MAX_BATCH_BYTES,
    createClient: createClient,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
