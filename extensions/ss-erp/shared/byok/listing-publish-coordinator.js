(function exposeByokListingPublishCoordinator(global) {
  'use strict';

  var CONTRACT_VERSION = 'extension-byok-listing-publish/v1';
  var STORAGE_VERSION = 'extension-byok-listing-publish-operation/v1';
  var PREVIEW_PATH = '/api/extension-device/byok-publish/preview';
  var PREPARE_PATH = '/api/extension-device/byok-publish/prepare';
  var STATUS_PATH = '/api/extension-device/byok-publish/status';
  var COMMAND_GRANT_PATH = '/api/extension-device/command-grants';
  var EXECUTE_PATH = '/api/extension-device/ozon-publish/execute';
  var REQUIRED_SCOPE = 'listing:publish';
  var INPUT_KEYS = [
    'shopId', 'workflowId', 'sourceDraftRevision', 'sourceDraftVersion',
    'boundDraftRevision', 'boundDraftVersion', 'assetId', 'provenanceId',
    'normalizedSha256', 'skuKey', 'slotKey', 'assignmentOrdinal',
    'assignmentSha256',
  ];
  var HASH_PATTERN = /^[a-f0-9]{64}$/u;
  var IDEMPOTENCY_PATTERN = /^wb_publish_[a-f0-9]{48}$/u;
  var GRANT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,4096}$/u;
  var FAILURE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,99}$/u;
  var MEDIA_SCOPES = ['PRODUCT', 'SKU'];
  var MEDIA_SOURCES = ['SOURCE', 'REVIEWED', 'GENERATED', 'TRANSLATED', 'EDITED'];
  var STATUS_STATES = ['NOT_COMMITTED', 'PENDING', 'SUCCEEDED', 'FAILED'];
  var OPERATION_STATES = [
    'CONFIRMED', 'PREPARING', 'PREPARED', 'DISPATCHING',
    'OUTCOME_UNRESOLVED', 'NOT_COMMITTED', 'PENDING', 'SUCCEEDED', 'FAILED',
  ];
  var RECORD_KEYS = [
    'contractVersion', 'binding', 'previewHash', 'selectedSkuKeys',
    'idempotencyKey', 'requestHash', 'envelope', 'state', 'receiptId',
    'failureCode', 'createdAt', 'updatedAt',
  ];

  function publishError(code, outcome, details) {
    var error = new Error(code);
    error.code = code;
    error.outcome = outcome || 'FAILED_RETRYABLE';
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

  function isCanonicalText(value, minimum, maximum) {
    if (typeof value !== 'string') return false;
    var normalized = value.normalize('NFKC').trim();
    return normalized === value
      && normalized.length >= minimum
      && normalized.length <= maximum
      && !/[\u0000-\u001f\u007f]/u.test(normalized);
  }

  function canonicalText(value, maximum) {
    if (!isCanonicalText(value, 1, maximum)) {
      throw publishError('SS_ERP_BYOK_PUBLISH_INPUT_INVALID', 'FAILED_FINAL');
    }
    return value;
  }

  function positiveInteger(value) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw publishError('SS_ERP_BYOK_PUBLISH_INPUT_INVALID', 'FAILED_FINAL');
    }
    return value;
  }

  function assignmentOrdinal(value) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 499) {
      throw publishError('SS_ERP_BYOK_PUBLISH_INPUT_INVALID', 'FAILED_FINAL');
    }
    return value;
  }

  function hash(value) {
    if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
      throw publishError('SS_ERP_BYOK_PUBLISH_INPUT_INVALID', 'FAILED_FINAL');
    }
    return value;
  }

  function normalizeBinding(value) {
    if (!exactKeys(value, INPUT_KEYS)) {
      throw publishError('SS_ERP_BYOK_PUBLISH_INPUT_INVALID', 'FAILED_FINAL');
    }
    var skuKey = canonicalText(value.skuKey, 500);
    var slotKey = canonicalText(value.slotKey, 200);
    if (!slotKey.startsWith('sku:' + skuKey + ':')) {
      throw publishError('SS_ERP_BYOK_PUBLISH_INPUT_INVALID', 'FAILED_FINAL');
    }
    var normalized = {
      shopId: canonicalText(value.shopId, 200),
      workflowId: canonicalText(value.workflowId, 200),
      sourceDraftRevision: positiveInteger(value.sourceDraftRevision),
      sourceDraftVersion: positiveInteger(value.sourceDraftVersion),
      boundDraftRevision: positiveInteger(value.boundDraftRevision),
      boundDraftVersion: positiveInteger(value.boundDraftVersion),
      assetId: canonicalText(value.assetId, 500),
      provenanceId: canonicalText(value.provenanceId, 200),
      normalizedSha256: hash(value.normalizedSha256),
      skuKey: skuKey,
      slotKey: slotKey,
      assignmentOrdinal: assignmentOrdinal(value.assignmentOrdinal),
      assignmentSha256: hash(value.assignmentSha256),
    };
    if (normalized.boundDraftRevision !== normalized.sourceDraftRevision + 1
      || normalized.boundDraftVersion !== normalized.sourceDraftVersion + 1) {
      throw publishError('SS_ERP_BYOK_PUBLISH_INPUT_INVALID', 'FAILED_FINAL');
    }
    return normalized;
  }

  function normalizeConfirmation(value) {
    if (!isRecord(value)
      || !exactKeys(value, INPUT_KEYS.concat(['previewHash']))) {
      throw publishError('SS_ERP_BYOK_PUBLISH_INPUT_INVALID', 'FAILED_FINAL');
    }
    var binding = {};
    INPUT_KEYS.forEach(function (key) { binding[key] = value[key]; });
    return { binding: normalizeBinding(binding), previewHash: hash(value.previewHash) };
  }

  function sameBinding(left, right) {
    return INPUT_KEYS.every(function (key) { return left[key] === right[key]; });
  }

  function sameArray(left, right) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every(function (value, index) { return value === right[index]; });
  }

  function normalizeSelectedSkuKeys(value) {
    if (!Array.isArray(value) || value.length < 1 || value.length > 500) {
      throw publishError('SS_ERP_BYOK_PUBLISH_RESPONSE_INVALID', 'FAILED_FINAL');
    }
    var seen = new Set();
    return value.map(function (item) {
      if (!isCanonicalText(item, 1, 500) || seen.has(item)) {
        throw publishError('SS_ERP_BYOK_PUBLISH_RESPONSE_INVALID', 'FAILED_FINAL');
      }
      seen.add(item);
      return item;
    });
  }

  function normalizeOrderedMedia(value, selectedSkuKeys, binding) {
    if (!Array.isArray(value) || value.length < 1 || value.length > 500
      || binding.assignmentOrdinal >= value.length) {
      throw publishError('SS_ERP_BYOK_PUBLISH_RESPONSE_INVALID', 'FAILED_FINAL');
    }
    var selected = new Set(selectedSkuKeys);
    var slots = new Set();
    var assets = new Set();
    var ordered = value.map(function (item, index) {
      if (!exactKeys(item, ['ordinal', 'scope', 'skuKey', 'slotKey', 'assetId', 'source'])
        || item.ordinal !== index
        || !MEDIA_SCOPES.includes(item.scope)
        || !MEDIA_SOURCES.includes(item.source)
        || !isCanonicalText(item.slotKey, 1, 200)
        || !isCanonicalText(item.assetId, 1, 500)
        || slots.has(item.slotKey)
        || assets.has(item.assetId)) {
        throw publishError('SS_ERP_BYOK_PUBLISH_RESPONSE_INVALID', 'FAILED_FINAL');
      }
      if ((item.scope === 'PRODUCT' && item.skuKey !== null)
        || (item.scope === 'SKU'
          && (!isCanonicalText(item.skuKey, 1, 500) || !selected.has(item.skuKey)))) {
        throw publishError('SS_ERP_BYOK_PUBLISH_RESPONSE_INVALID', 'FAILED_FINAL');
      }
      slots.add(item.slotKey);
      assets.add(item.assetId);
      return {
        ordinal: index,
        scope: item.scope,
        skuKey: item.skuKey,
        slotKey: item.slotKey,
        assetId: item.assetId,
        source: item.source,
      };
    });
    var target = ordered[binding.assignmentOrdinal];
    if (target.scope !== 'SKU'
      || target.skuKey !== binding.skuKey
      || target.slotKey !== binding.slotKey
      || target.assetId !== binding.assetId
      || target.source !== 'GENERATED') {
      throw publishError('SS_ERP_BYOK_PUBLISH_RESPONSE_INVALID', 'FAILED_FINAL');
    }
    return ordered;
  }

  function parsePreviewResponse(response, binding) {
    var body = response && response.body;
    var data = body && body.data;
    var expectedDataKeys = [
      'contractVersion', 'previewHash', ...INPUT_KEYS, 'selectedSkuKeys', 'orderedMedia',
    ];
    if (!response || response.state !== 'response' || response.status !== 200
      || !exactKeys(body, ['code', 'data']) || body.code !== 1
      || !exactKeys(data, expectedDataKeys)) {
      throw publishError('SS_ERP_BYOK_PUBLISH_RESPONSE_INVALID', 'FAILED_FINAL', {
        status: Number(response && response.status) || null,
      });
    }
    var responseBinding = {};
    INPUT_KEYS.forEach(function (key) { responseBinding[key] = data[key]; });
    var normalizedBinding;
    try { normalizedBinding = normalizeBinding(responseBinding); } catch (_error) {
      throw publishError('SS_ERP_BYOK_PUBLISH_RESPONSE_INVALID', 'FAILED_FINAL');
    }
    if (data.contractVersion !== CONTRACT_VERSION || !sameBinding(binding, normalizedBinding)
      || !HASH_PATTERN.test(String(data.previewHash || ''))) {
      throw publishError('SS_ERP_BYOK_PUBLISH_RESPONSE_INVALID', 'FAILED_FINAL');
    }
    var selectedSkuKeys = normalizeSelectedSkuKeys(data.selectedSkuKeys);
    if (!selectedSkuKeys.includes(binding.skuKey)) {
      throw publishError('SS_ERP_BYOK_PUBLISH_RESPONSE_INVALID', 'FAILED_FINAL');
    }
    var orderedMedia = normalizeOrderedMedia(data.orderedMedia, selectedSkuKeys, binding);
    return {
      contractVersion: CONTRACT_VERSION,
      previewHash: data.previewHash,
      ...normalizedBinding,
      selectedSkuKeys: selectedSkuKeys,
      orderedMedia: orderedMedia,
    };
  }

  function normalizeEnvelope(value, binding, idempotencyKey, selectedSkuKeys) {
    if (!exactKeys(value, [
      'operation', 'shopId', 'workflowId', 'draftVersion', 'idempotencyKey', 'command',
    ]) || value.operation !== 'OZON_PUBLISH'
      || value.shopId !== binding.shopId
      || value.workflowId !== binding.workflowId
      || value.draftVersion !== binding.boundDraftVersion
      || value.idempotencyKey !== idempotencyKey
      || !exactKeys(value.command, [
        'schemaVersion', 'draftRevision', 'publishIntentId', 'selectedSkuKeys',
      ])
      || value.command.schemaVersion !== 'ozon-publish-command/v1'
      || value.command.draftRevision !== binding.boundDraftRevision + 1
      || !isCanonicalText(value.command.publishIntentId, 1, 200)) {
      throw publishError('SS_ERP_BYOK_PUBLISH_RESPONSE_INVALID', 'FAILED_FINAL');
    }
    var commandSkuKeys;
    try { commandSkuKeys = normalizeSelectedSkuKeys(value.command.selectedSkuKeys); } catch (_error) {
      throw publishError('SS_ERP_BYOK_PUBLISH_RESPONSE_INVALID', 'FAILED_FINAL');
    }
    if (!sameArray(commandSkuKeys, selectedSkuKeys)) {
      throw publishError('SS_ERP_BYOK_PUBLISH_RESPONSE_INVALID', 'FAILED_FINAL');
    }
    return {
      operation: 'OZON_PUBLISH',
      shopId: binding.shopId,
      workflowId: binding.workflowId,
      draftVersion: binding.boundDraftVersion,
      idempotencyKey: idempotencyKey,
      command: {
        schemaVersion: 'ozon-publish-command/v1',
        draftRevision: binding.boundDraftRevision + 1,
        publishIntentId: value.command.publishIntentId,
        selectedSkuKeys: commandSkuKeys,
      },
    };
  }

  function parsePrepareResponse(response, record) {
    var body = response && response.body;
    var data = body && body.data;
    if (!response || response.state !== 'response' || ![200, 201].includes(response.status)
      || !exactKeys(body, ['code', 'data']) || body.code !== 1
      || !exactKeys(data, [
        'contractVersion', 'previewHash', 'requestHash', 'replayed', 'envelope',
      ])
      || data.contractVersion !== CONTRACT_VERSION
      || data.previewHash !== record.previewHash
      || !HASH_PATTERN.test(String(data.requestHash || ''))
      || typeof data.replayed !== 'boolean') {
      var status = Number(response && response.status) || null;
      var definitiveRejection = response && response.state === 'http_error'
        && status >= 400 && status < 500 && ![408, 429].includes(status);
      throw publishError(
        definitiveRejection
          ? 'SS_ERP_BYOK_PUBLISH_PREPARE_REJECTED'
          : 'SS_ERP_BYOK_PUBLISH_UNKNOWN_OUTCOME',
        definitiveRejection ? 'FAILED_FINAL' : 'UNKNOWN_OUTCOME',
        { status: status },
      );
    }
    var normalizedEnvelope;
    try {
      normalizedEnvelope = normalizeEnvelope(
        data.envelope,
        record.binding,
        record.idempotencyKey,
        record.selectedSkuKeys,
      );
    } catch (_error) {
      throw publishError('SS_ERP_BYOK_PUBLISH_UNKNOWN_OUTCOME', 'UNKNOWN_OUTCOME', {
        status: Number(response && response.status) || null,
      });
    }
    return { requestHash: data.requestHash, envelope: normalizedEnvelope };
  }

  function normalizeReceiptProjection(receipt) {
    if (!isRecord(receipt)
      || !isCanonicalText(receipt.id, 1, 200)
      || !['PENDING', 'SUCCEEDED', 'FAILED'].includes(receipt.status)
      || (receipt.status === 'FAILED'
        ? !FAILURE_CODE_PATTERN.test(String(receipt.failureCode || ''))
        : receipt.failureCode !== null)) {
      throw publishError('SS_ERP_BYOK_PUBLISH_UNKNOWN_OUTCOME', 'UNKNOWN_OUTCOME');
    }
    return {
      receiptId: receipt.id,
      state: receipt.status,
      failureCode: receipt.status === 'FAILED' ? receipt.failureCode : null,
    };
  }

  function parseExecuteResponse(response) {
    var body = response && response.body;
    if (response && response.state === 'response' && [200, 202].includes(response.status)
      && exactKeys(body, ['code', 'data']) && body.code === 1
      && exactKeys(body.data, ['receipt', 'replay'])
      && typeof body.data.replay === 'boolean') {
      return normalizeReceiptProjection(body.data.receipt);
    }
    if (response && response.state === 'http_error' && response.status === 409
      && exactKeys(body, ['code', 'errorCode', 'msg', 'data'])
      && body.code === 0 && body.errorCode === 'publish_failed'
      && isCanonicalText(body.msg, 1, 500)
      && exactKeys(body.data, ['receipt'])) {
      var failed = normalizeReceiptProjection(body.data.receipt);
      if (failed.state !== 'FAILED') {
        throw publishError('SS_ERP_BYOK_PUBLISH_UNKNOWN_OUTCOME', 'UNKNOWN_OUTCOME');
      }
      return failed;
    }
    throw publishError('SS_ERP_BYOK_PUBLISH_UNKNOWN_OUTCOME', 'UNKNOWN_OUTCOME', {
      status: Number(response && response.status) || null,
      errorCode: response && response.body && response.body.errorCode || null,
    });
  }

  function parseStatusResponse(response) {
    var body = response && response.body;
    var data = body && body.data;
    if (!response || response.state !== 'response' || ![200, 202].includes(response.status)
      || !exactKeys(body, ['code', 'data']) || body.code !== 1
      || !exactKeys(data, [
        'contractVersion', 'state', 'receiptId', 'failureCode',
      ])
      || data.contractVersion !== CONTRACT_VERSION
      || !STATUS_STATES.includes(data.state)) {
      throw publishError('SS_ERP_BYOK_PUBLISH_UNKNOWN_OUTCOME', 'UNKNOWN_OUTCOME', {
        status: Number(response && response.status) || null,
        errorCode: response && response.body && response.body.errorCode || null,
      });
    }
    var receiptId = data.receiptId;
    var failureCode = data.failureCode;
    var valid = (data.state === 'NOT_COMMITTED' && receiptId === null && failureCode === null)
      || (['PENDING', 'SUCCEEDED'].includes(data.state)
        && isCanonicalText(receiptId, 1, 200) && failureCode === null)
      || (data.state === 'FAILED'
        && isCanonicalText(receiptId, 1, 200)
        && FAILURE_CODE_PATTERN.test(String(failureCode || '')));
    if (!valid) {
      throw publishError('SS_ERP_BYOK_PUBLISH_UNKNOWN_OUTCOME', 'UNKNOWN_OUTCOME');
    }
    return { state: data.state, receiptId: receiptId, failureCode: failureCode };
  }

  function createCoordinator(options) {
    var transport = options && options.transport;
    var store = options && options.store;
    var cryptoImpl = options && options.crypto;
    var now = options && options.now;
    if (!transport || typeof transport.post !== 'function'
      || !store || typeof store.get !== 'function'
      || typeof store.set !== 'function' || typeof store.remove !== 'function'
      || !cryptoImpl || !cryptoImpl.subtle || typeof cryptoImpl.subtle.digest !== 'function'
      || typeof now !== 'function') {
      throw new TypeError('BYOK listing publish coordinator dependencies are unavailable');
    }
    var previews = new Map();
    var inflight = new Map();

    function timestamp() {
      var value = now();
      if (value instanceof Date) value = value.getTime();
      if (!Number.isSafeInteger(value) || value < 0) {
        throw publishError('SS_ERP_BYOK_PUBLISH_CLOCK_INVALID', 'FAILED_FINAL');
      }
      return value;
    }

    async function operationKey(binding) {
      var digest = await cryptoImpl.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify({
          contractVersion: CONTRACT_VERSION,
          binding: binding,
        })),
      );
      var hexadecimal = Array.from(new Uint8Array(digest))
        .map(function (byte) { return byte.toString(16).padStart(2, '0'); })
        .join('');
      return 'wb_publish_' + hexadecimal.slice(0, 48);
    }

    function publicState(record) {
      return {
        contractVersion: CONTRACT_VERSION,
        state: record.state,
        shopId: record.binding.shopId,
        workflowId: record.binding.workflowId,
        boundDraftRevision: record.binding.boundDraftRevision,
        boundDraftVersion: record.binding.boundDraftVersion,
        previewHash: record.previewHash,
        receiptId: record.receiptId,
        failureCode: record.failureCode,
      };
    }

    function normalizeStoredRecord(value, key, expectedBinding) {
      if (!exactKeys(value, RECORD_KEYS)
        || value.contractVersion !== STORAGE_VERSION
        || !IDEMPOTENCY_PATTERN.test(String(value.idempotencyKey || ''))
        || value.idempotencyKey !== key
        || !HASH_PATTERN.test(String(value.previewHash || ''))
        || !OPERATION_STATES.includes(value.state)
        || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0
        || !Number.isSafeInteger(value.updatedAt) || value.updatedAt < value.createdAt) {
        throw publishError('SS_ERP_BYOK_PUBLISH_STATE_INVALID', 'FAILED_FINAL');
      }
      var binding;
      try { binding = normalizeBinding(value.binding); } catch (_error) {
        throw publishError('SS_ERP_BYOK_PUBLISH_STATE_INVALID', 'FAILED_FINAL');
      }
      if (!sameBinding(binding, expectedBinding)) {
        throw publishError('SS_ERP_BYOK_PUBLISH_IDEMPOTENCY_CONFLICT', 'FAILED_FINAL');
      }
      var selectedSkuKeys;
      try { selectedSkuKeys = normalizeSelectedSkuKeys(value.selectedSkuKeys); } catch (_error) {
        throw publishError('SS_ERP_BYOK_PUBLISH_STATE_INVALID', 'FAILED_FINAL');
      }
      var requestHash = value.requestHash;
      var envelopeValue = value.envelope;
      if ((requestHash === null) !== (envelopeValue === null)
        || (requestHash !== null && !HASH_PATTERN.test(String(requestHash || '')))) {
        throw publishError('SS_ERP_BYOK_PUBLISH_STATE_INVALID', 'FAILED_FINAL');
      }
      var envelopeValueNormalized = null;
      if (envelopeValue !== null) {
        try {
          envelopeValueNormalized = normalizeEnvelope(
            envelopeValue,
            binding,
            key,
            selectedSkuKeys,
          );
        } catch (_error) {
          throw publishError('SS_ERP_BYOK_PUBLISH_STATE_INVALID', 'FAILED_FINAL');
        }
      }
      if (value.receiptId !== null && !isCanonicalText(value.receiptId, 1, 200)) {
        throw publishError('SS_ERP_BYOK_PUBLISH_STATE_INVALID', 'FAILED_FINAL');
      }
      if (value.failureCode !== null
        && !FAILURE_CODE_PATTERN.test(String(value.failureCode || ''))) {
        throw publishError('SS_ERP_BYOK_PUBLISH_STATE_INVALID', 'FAILED_FINAL');
      }
      if ((value.state === 'NOT_COMMITTED'
        && (value.receiptId !== null || value.failureCode !== null))
        || (['PENDING', 'SUCCEEDED'].includes(value.state)
          && (value.receiptId === null || value.failureCode !== null))
        || (value.state === 'FAILED' && value.failureCode === null)) {
        throw publishError('SS_ERP_BYOK_PUBLISH_STATE_INVALID', 'FAILED_FINAL');
      }
      return {
        contractVersion: STORAGE_VERSION,
        binding: binding,
        previewHash: value.previewHash,
        selectedSkuKeys: selectedSkuKeys,
        idempotencyKey: key,
        requestHash: requestHash,
        envelope: envelopeValueNormalized,
        state: value.state,
        receiptId: value.receiptId,
        failureCode: value.failureCode,
        createdAt: value.createdAt,
        updatedAt: value.updatedAt,
      };
    }

    async function loadRecord(key, binding) {
      var values;
      try { values = await store.get(key); } catch (_error) {
        throw publishError('SS_ERP_BYOK_PUBLISH_PERSISTENCE_UNAVAILABLE');
      }
      if (!isRecord(values) || values[key] === undefined) return null;
      return normalizeStoredRecord(values[key], key, binding);
    }

    async function saveRecord(record) {
      record.updatedAt = timestamp();
      try { await store.set({ [record.idempotencyKey]: record }); } catch (_error) {
        throw publishError('SS_ERP_BYOK_PUBLISH_PERSISTENCE_UNAVAILABLE');
      }
      return record;
    }

    async function persistState(record, status) {
      record.state = status.state;
      record.receiptId = status.receiptId;
      record.failureCode = status.failureCode;
      await saveRecord(record);
      return publicState(record);
    }

    async function markFailure(record, error) {
      if (!record) return;
      if (error && error.outcome === 'FAILED_FINAL') {
        record.state = 'FAILED';
        record.receiptId = null;
        record.failureCode = FAILURE_CODE_PATTERN.test(String(error.code || ''))
          ? error.code
          : 'BYOK_PUBLISH_FAILED';
      } else {
        record.state = 'OUTCOME_UNRESOLVED';
        record.failureCode = null;
      }
      try { await saveRecord(record); } catch (_error) {}
    }

    async function preview(value) {
      var binding = normalizeBinding(value);
      var key = await operationKey(binding);
      var request = { contractVersion: CONTRACT_VERSION, ...binding };
      var response;
      try {
        response = await transport.post(PREVIEW_PATH, request, { requiredScope: REQUIRED_SCOPE });
      } catch (_error) {
        throw publishError('SS_ERP_BYOK_PUBLISH_PREVIEW_UNAVAILABLE');
      }
      if (!response || response.state !== 'response' || response.status !== 200) {
        throw publishError('SS_ERP_BYOK_PUBLISH_PREVIEW_REJECTED', 'FAILED_FINAL', {
          status: Number(response && response.status) || null,
          errorCode: response && response.body && response.body.errorCode || null,
        });
      }
      var normalized = parsePreviewResponse(response, binding);
      previews.set(key, normalized);
      return normalized;
    }

    async function prepare(record) {
      record.state = 'PREPARING';
      record.receiptId = null;
      record.failureCode = null;
      await saveRecord(record);
      var response;
      try {
        response = await transport.post(PREPARE_PATH, {
          contractVersion: CONTRACT_VERSION,
          ...record.binding,
          previewHash: record.previewHash,
          idempotencyKey: record.idempotencyKey,
        }, { requiredScope: REQUIRED_SCOPE });
      } catch (_error) {
        throw publishError('SS_ERP_BYOK_PUBLISH_UNKNOWN_OUTCOME', 'UNKNOWN_OUTCOME');
      }
      var prepared = parsePrepareResponse(response, record);
      record.requestHash = prepared.requestHash;
      record.envelope = prepared.envelope;
      record.state = 'PREPARED';
      await saveRecord(record);
      return record;
    }

    async function issueGrant(record) {
      var response;
      try {
        response = await transport.post(
          COMMAND_GRANT_PATH,
          record.envelope,
          { requiredScope: REQUIRED_SCOPE },
        );
      } catch (_error) {
        throw publishError('SS_ERP_BYOK_PUBLISH_UNKNOWN_OUTCOME', 'UNKNOWN_OUTCOME');
      }
      var body = response && response.body;
      var data = body && body.data;
      if (!response || response.state !== 'response' || response.status !== 201
        || !exactKeys(body, ['code', 'msg', 'data']) || body.code !== 1
        || !isCanonicalText(body.msg, 1, 500)
        || !exactKeys(data, ['grantId', 'grantToken', 'expiresAt'])
        || !isCanonicalText(data.grantId, 1, 200)
        || !GRANT_TOKEN_PATTERN.test(String(data.grantToken || ''))
        || !isCanonicalText(data.expiresAt, 1, 100)
        || !Number.isFinite(Date.parse(data.expiresAt))) {
        throw publishError('SS_ERP_BYOK_PUBLISH_UNKNOWN_OUTCOME', 'UNKNOWN_OUTCOME', {
          status: Number(response && response.status) || null,
          errorCode: response && response.body && response.body.errorCode || null,
        });
      }
      return data.grantToken;
    }

    function executeEnvelope(envelope) {
      return {
        shopId: envelope.shopId,
        workflowId: envelope.workflowId,
        draftVersion: envelope.draftVersion,
        idempotencyKey: envelope.idempotencyKey,
        command: envelope.command,
      };
    }

    function statusEnvelope(record) {
      return {
        contractVersion: CONTRACT_VERSION,
        previewHash: record.previewHash,
        requestHash: record.requestHash,
        provenanceId: record.binding.provenanceId,
        envelope: record.envelope,
      };
    }

    async function queryStatus(record) {
      if (!record.requestHash || !record.envelope) {
        throw publishError('SS_ERP_BYOK_PUBLISH_RECOVERY_UNAVAILABLE', 'UNKNOWN_OUTCOME');
      }
      var response;
      try {
        response = await transport.post(
          STATUS_PATH,
          statusEnvelope(record),
          { requiredScope: REQUIRED_SCOPE },
        );
      } catch (_error) {
        throw publishError('SS_ERP_BYOK_PUBLISH_UNKNOWN_OUTCOME', 'UNKNOWN_OUTCOME');
      }
      return parseStatusResponse(response);
    }

    async function refreshStatus(record) {
      var status = await queryStatus(record);
      return persistState(record, status);
    }

    async function dispatch(record) {
      var grantToken = await issueGrant(record);
      record.state = 'DISPATCHING';
      record.receiptId = null;
      record.failureCode = null;
      await saveRecord(record);
      var response;
      try {
        response = await transport.post(
          EXECUTE_PATH,
          executeEnvelope(record.envelope),
          { requiredScope: REQUIRED_SCOPE, commandGrant: grantToken },
        );
      } catch (_error) {
        grantToken = null;
        throw publishError('SS_ERP_BYOK_PUBLISH_UNKNOWN_OUTCOME', 'UNKNOWN_OUTCOME');
      }
      grantToken = null;
      parseExecuteResponse(response);
      return refreshStatus(record);
    }

    async function confirmInternal(confirmation, key, cachedPreview) {
      var record = await loadRecord(key, confirmation.binding);
      if (record) {
        if (record.previewHash !== confirmation.previewHash) {
          throw publishError('SS_ERP_BYOK_PUBLISH_IDEMPOTENCY_CONFLICT', 'FAILED_FINAL');
        }
        if (['SUCCEEDED', 'FAILED'].includes(record.state)) return publicState(record);
        try {
          if (record.requestHash && record.envelope) return await refreshStatus(record);
          await prepare(record);
          return await dispatch(record);
        } catch (error) {
          var safe = error && error.code
            ? error
            : publishError('SS_ERP_BYOK_PUBLISH_UNKNOWN_OUTCOME', 'UNKNOWN_OUTCOME');
          await markFailure(record, safe);
          throw safe;
        }
      }
      var createdAt = timestamp();
      record = {
        contractVersion: STORAGE_VERSION,
        binding: confirmation.binding,
        previewHash: confirmation.previewHash,
        selectedSkuKeys: cachedPreview.selectedSkuKeys,
        idempotencyKey: key,
        requestHash: null,
        envelope: null,
        state: 'CONFIRMED',
        receiptId: null,
        failureCode: null,
        createdAt: createdAt,
        updatedAt: createdAt,
      };
      await saveRecord(record);
      try {
        await prepare(record);
        return await dispatch(record);
      } catch (error) {
        var safeError = error && error.code
          ? error
          : publishError('SS_ERP_BYOK_PUBLISH_UNKNOWN_OUTCOME', 'UNKNOWN_OUTCOME');
        await markFailure(record, safeError);
        throw safeError;
      }
    }

    function confirm(value) {
      var operationPromise = (async function () {
        var confirmation = normalizeConfirmation(value);
        var key = await operationKey(confirmation.binding);
        var cachedPreview = previews.get(key);
        if (!cachedPreview
          || cachedPreview.previewHash !== confirmation.previewHash
          || !sameBinding(cachedPreview, confirmation.binding)) {
          throw publishError('SS_ERP_BYOK_PUBLISH_CONFIRMATION_REQUIRED', 'FAILED_FINAL');
        }
        if (inflight.has(key)) return inflight.get(key);
        var promise = confirmInternal(confirmation, key, cachedPreview);
        inflight.set(key, promise);
        try { return await promise; } finally {
          if (inflight.get(key) === promise) inflight.delete(key);
        }
      }());
      return operationPromise;
    }

    async function getState(value) {
      var binding = normalizeBinding(value);
      var key = await operationKey(binding);
      var record = await loadRecord(key, binding);
      if (!record) return null;
      if (inflight.has(key) || ['SUCCEEDED', 'FAILED'].includes(record.state)) {
        return publicState(record);
      }
      if (!record.requestHash || !record.envelope) return publicState(record);
      try { return await refreshStatus(record); } catch (error) {
        var safe = error && error.code
          ? error
          : publishError('SS_ERP_BYOK_PUBLISH_UNKNOWN_OUTCOME', 'UNKNOWN_OUTCOME');
        await markFailure(record, safe);
        return publicState(record);
      }
    }

    function recover(value) {
      return (async function () {
        var binding = normalizeBinding(value);
        var key = await operationKey(binding);
        if (inflight.has(key)) return inflight.get(key);
        var promise = (async function () {
          var record = await loadRecord(key, binding);
          if (!record) {
            throw publishError('SS_ERP_BYOK_PUBLISH_OPERATION_NOT_FOUND', 'FAILED_FINAL');
          }
          if (['SUCCEEDED', 'FAILED'].includes(record.state)) return publicState(record);
          try {
            if (!record.requestHash || !record.envelope) {
              await prepare(record);
              return await dispatch(record);
            }
            var current = await queryStatus(record);
            await persistState(record, current);
            if (!['NOT_COMMITTED', 'PENDING'].includes(current.state)) {
              return publicState(record);
            }
            return await dispatch(record);
          } catch (error) {
            var safe = error && error.code
              ? error
              : publishError('SS_ERP_BYOK_PUBLISH_UNKNOWN_OUTCOME', 'UNKNOWN_OUTCOME');
            await markFailure(record, safe);
            throw safe;
          }
        }());
        inflight.set(key, promise);
        try { return await promise; } finally {
          if (inflight.get(key) === promise) inflight.delete(key);
        }
      }());
    }

    async function clear(value) {
      if (value == null) {
        if (inflight.size) {
          throw publishError('SS_ERP_BYOK_PUBLISH_CLEAR_UNSAFE', 'FAILED_FINAL');
        }
        var all;
        try { all = await store.get(null); } catch (_error) {
          throw publishError('SS_ERP_BYOK_PUBLISH_PERSISTENCE_UNAVAILABLE');
        }
        if (!isRecord(all)) {
          throw publishError('SS_ERP_BYOK_PUBLISH_STATE_INVALID', 'FAILED_FINAL');
        }
        var keys = Object.keys(all).filter(function (key) {
          return IDEMPOTENCY_PATTERN.test(key);
        });
        if (keys.length) {
          try { await store.remove(keys); } catch (_error) {
            throw publishError('SS_ERP_BYOK_PUBLISH_PERSISTENCE_UNAVAILABLE');
          }
        }
        previews.clear();
        return keys.length;
      }
      var binding = normalizeBinding(value);
      var key = await operationKey(binding);
      if (inflight.has(key)) {
        throw publishError('SS_ERP_BYOK_PUBLISH_CLEAR_UNSAFE', 'FAILED_FINAL');
      }
      var record = await loadRecord(key, binding);
      if (!record) {
        previews.delete(key);
        return false;
      }
      if (!['NOT_COMMITTED', 'SUCCEEDED', 'FAILED'].includes(record.state)) {
        throw publishError('SS_ERP_BYOK_PUBLISH_CLEAR_UNSAFE', 'FAILED_FINAL');
      }
      try { await store.remove(key); } catch (_error) {
        throw publishError('SS_ERP_BYOK_PUBLISH_PERSISTENCE_UNAVAILABLE');
      }
      previews.delete(key);
      return true;
    }

    return Object.freeze({
      preview: preview,
      confirm: confirm,
      recover: recover,
      getState: getState,
      clear: clear,
    });
  }

  global.SS_ERP_BYOK_LISTING_PUBLISH_COORDINATOR = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    createCoordinator: createCoordinator,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
