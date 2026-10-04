(function exposeWorkbenchListingPublishCoordinator(global) {
  'use strict';

  var CONTRACT_VERSION = 'extension-workbench-listing-publish/v1';
  var STORAGE_VERSION = 'extension-workbench-listing-publish-operation/v1';
  var PREVIEW_PATH = '/api/extension-device/workbench-publish/preview';
  var PREPARE_PATH = '/api/extension-device/workbench-publish/prepare';
  var STATUS_PATH = '/api/extension-device/workbench-publish/status';
  var COMMAND_GRANT_PATH = '/api/extension-device/command-grants';
  var EXECUTE_PATH = '/api/extension-device/ozon-publish/execute';
  var REQUIRED_SCOPE = 'listing:publish';
  var HASH_PATTERN = /^[a-f0-9]{64}$/u;
  var IDEMPOTENCY_PATTERN = /^wb_publish_v2_[a-f0-9]{48}$/u;
  var GRANT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,4096}$/u;
  var FAILURE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,99}$/u;
  var EXECUTION_MODES = ['ERP_HOSTED', 'BYOK'];
  var MEDIA_SCOPES = ['PRODUCT', 'SKU'];
  var MEDIA_SOURCES = ['SOURCE', 'REVIEWED', 'GENERATED', 'TRANSLATED', 'EDITED'];
  var STATUS_STATES = ['NOT_COMMITTED', 'PENDING', 'SUCCEEDED', 'FAILED'];
  var OPERATION_STATES = [
    'CONFIRMED', 'PREPARING', 'PREPARED', 'DISPATCHING',
    'OUTCOME_UNRESOLVED', 'NOT_COMMITTED', 'PENDING', 'SUCCEEDED', 'FAILED',
  ];
  var INPUT_KEYS = ['executionMode', 'binding', 'selectedMedia'];
  var BINDING_KEYS = ['shopId', 'workflowId', 'draftRevision', 'draftVersion'];
  var SELECTED_MEDIA_KEYS = ['scope', 'skuKey', 'slotKey', 'assetId'];
  var RECORD_KEYS = [
    'contractVersion', 'request', 'previewHash', 'currentDraftRevision',
    'currentDraftVersion', 'selectedSkuKeys', 'idempotencyKey', 'requestHash',
    'envelope', 'state', 'receiptId', 'failureCode', 'createdAt', 'updatedAt',
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
      throw publishError('SS_ERP_WORKBENCH_PUBLISH_INPUT_INVALID', 'FAILED_FINAL');
    }
    return value;
  }

  function positiveInteger(value) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw publishError('SS_ERP_WORKBENCH_PUBLISH_INPUT_INVALID', 'FAILED_FINAL');
    }
    return value;
  }

  function normalizeSelectedMedia(value, response) {
    var code = response
      ? 'SS_ERP_WORKBENCH_PUBLISH_RESPONSE_INVALID'
      : 'SS_ERP_WORKBENCH_PUBLISH_INPUT_INVALID';
    if (!Array.isArray(value) || value.length < 1 || value.length > 500) {
      throw publishError(code, 'FAILED_FINAL');
    }
    var slots = new Set();
    var assets = new Set();
    return value.map(function (row) {
      if (!exactKeys(row, SELECTED_MEDIA_KEYS)
        || !MEDIA_SCOPES.includes(row.scope)
        || (row.scope === 'PRODUCT' && row.skuKey !== null)
        || (row.scope === 'SKU' && !isCanonicalText(row.skuKey, 1, 500))
        || !isCanonicalText(row.slotKey, 1, 200)
        || !isCanonicalText(row.assetId, 1, 500)
        || slots.has(row.slotKey)
        || assets.has(row.assetId)) {
        throw publishError(code, 'FAILED_FINAL');
      }
      slots.add(row.slotKey);
      assets.add(row.assetId);
      return {
        scope: row.scope,
        skuKey: row.scope === 'PRODUCT' ? null : row.skuKey,
        slotKey: row.slotKey,
        assetId: row.assetId,
      };
    });
  }

  function normalizeRequest(value) {
    if (!exactKeys(value, INPUT_KEYS) || !EXECUTION_MODES.includes(value.executionMode)
      || !exactKeys(value.binding, BINDING_KEYS)) {
      throw publishError('SS_ERP_WORKBENCH_PUBLISH_INPUT_INVALID', 'FAILED_FINAL');
    }
    return {
      executionMode: value.executionMode,
      binding: {
        shopId: canonicalText(value.binding.shopId, 200),
        workflowId: canonicalText(value.binding.workflowId, 200),
        draftRevision: positiveInteger(value.binding.draftRevision),
        draftVersion: positiveInteger(value.binding.draftVersion),
      },
      selectedMedia: normalizeSelectedMedia(value.selectedMedia, false),
    };
  }

  function sameSelectedMedia(left, right) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every(function (row, index) {
        var other = right[index];
        return other
          && row.scope === other.scope
          && row.skuKey === other.skuKey
          && row.slotKey === other.slotKey
          && row.assetId === other.assetId;
      });
  }

  function sameStableRequest(left, right) {
    return left.binding.shopId === right.binding.shopId
      && left.binding.workflowId === right.binding.workflowId
      && left.binding.draftVersion === right.binding.draftVersion
      && sameSelectedMedia(left.selectedMedia, right.selectedMedia);
  }

  function sameRequest(left, right) {
    return sameStableRequest(left, right)
      && left.executionMode === right.executionMode
      && left.binding.draftRevision === right.binding.draftRevision
      && left.binding.draftVersion === right.binding.draftVersion;
  }

  function normalizeSelectedSkuKeys(value) {
    if (!Array.isArray(value) || value.length < 1 || value.length > 500) {
      throw publishError('SS_ERP_WORKBENCH_PUBLISH_RESPONSE_INVALID', 'FAILED_FINAL');
    }
    var seen = new Set();
    return value.map(function (item) {
      if (!isCanonicalText(item, 1, 500) || seen.has(item)) {
        throw publishError('SS_ERP_WORKBENCH_PUBLISH_RESPONSE_INVALID', 'FAILED_FINAL');
      }
      seen.add(item);
      return item;
    });
  }

  function normalizeOrderedMedia(value, selectedSkuKeys) {
    if (!Array.isArray(value) || value.length < 1 || value.length > 500) {
      throw publishError('SS_ERP_WORKBENCH_PUBLISH_RESPONSE_INVALID', 'FAILED_FINAL');
    }
    var selected = new Set(selectedSkuKeys);
    var slots = new Set();
    var assets = new Set();
    return value.map(function (item, index) {
      if (!exactKeys(item, ['ordinal', 'scope', 'skuKey', 'slotKey', 'assetId', 'source'])
        || item.ordinal !== index
        || !MEDIA_SCOPES.includes(item.scope)
        || !MEDIA_SOURCES.includes(item.source)
        || !isCanonicalText(item.slotKey, 1, 200)
        || !isCanonicalText(item.assetId, 1, 500)
        || slots.has(item.slotKey)
        || assets.has(item.assetId)
        || (item.scope === 'PRODUCT' && item.skuKey !== null)
        || (item.scope === 'SKU'
          && (!isCanonicalText(item.skuKey, 1, 500) || !selected.has(item.skuKey)))) {
        throw publishError('SS_ERP_WORKBENCH_PUBLISH_RESPONSE_INVALID', 'FAILED_FINAL');
      }
      slots.add(item.slotKey);
      assets.add(item.assetId);
      return {
        ordinal: index,
        scope: item.scope,
        skuKey: item.scope === 'PRODUCT' ? null : item.skuKey,
        slotKey: item.slotKey,
        assetId: item.assetId,
        source: item.source,
      };
    });
  }

  function selectedMediaFromOrdered(orderedMedia, selectedMedia) {
    var slots = new Set(selectedMedia.map(function (row) { return row.slotKey; }));
    return orderedMedia.filter(function (row) { return slots.has(row.slotKey); })
      .map(function (row) {
        return {
          scope: row.scope,
          skuKey: row.skuKey,
          slotKey: row.slotKey,
          assetId: row.assetId,
        };
      });
  }

  function normalizeVideoBindings(values, skuKeys) {
    if (!Array.isArray(values) || values.length > 1002) throw publishError('SS_ERP_WORKBENCH_PUBLISH_RESPONSE_INVALID', 'FAILED_FINAL');
    var seen = new Set();
    return Object.freeze(values.map(function (value) {
      var keys = ['skuKey','role','url','sourceMediaKey','sourceCaptureSnapshotId','sourceCaptureHash','approvedByUserId','approvedAt'];
      var validUrl = false;
      try {
        var url = new URL(value.url);
        validUrl = url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash
          && ((/^(?:cdnvideo\.v\.ozone\.ru|v-\d+\.ozone\.ru)$/u.test(url.hostname) && /^\/vod\/video-\d+\/[A-Z0-9]+\/[^/]+\.mp4$/u.test(url.pathname))
            || (/^cdn\d*\.ozone\.ru$/u.test(url.hostname) && /^\/s3\/sc-temporary\/.+\.mp4$/u.test(url.pathname)));
      } catch {}
      var key = value && JSON.stringify([value.skuKey,value.role]);
      if (!exactKeys(value, keys) || !validUrl || (value.skuKey !== null && !skuKeys.includes(value.skuKey))
        || !['MAIN','RICH_CONTENT'].includes(value.role) || seen.has(key)
        || (value.sourceMediaKey !== null && !canonicalText(value.sourceMediaKey, 500))
        || !canonicalText(value.sourceCaptureSnapshotId, 200) || !HASH_PATTERN.test(value.sourceCaptureHash || '')
        || !canonicalText(value.approvedByUserId, 200) || !Number.isFinite(Date.parse(value.approvedAt))) {
        throw publishError('SS_ERP_WORKBENCH_PUBLISH_RESPONSE_INVALID', 'FAILED_FINAL');
      }
      seen.add(key); return Object.freeze({ ...value });
    }));
  }

  function parsePreviewResponse(response, request) {
    var body = response && response.body;
    var data = body && body.data;
    var keys = [
      'contractVersion', 'executionMode', 'shopId', 'workflowId',
      'basisDraftRevision', 'basisDraftVersion', 'selectedMedia',
      'currentDraftRevision', 'currentDraftVersion', 'previewHash',
      'selectedSkuKeys', 'orderedMedia',
    ];
    if (data && Object.prototype.hasOwnProperty.call(data, 'videoBindings')) keys.push('videoBindings');
    if (!response || response.state !== 'response' || response.status !== 200
      || !exactKeys(body, ['code', 'data']) || body.code !== 1
      || !exactKeys(data, keys)
      || data.contractVersion !== CONTRACT_VERSION
      || data.executionMode !== request.executionMode
      || data.shopId !== request.binding.shopId
      || data.workflowId !== request.binding.workflowId
      || data.basisDraftRevision !== request.binding.draftRevision
      || data.basisDraftVersion !== request.binding.draftVersion
      || !Number.isSafeInteger(data.currentDraftRevision) || data.currentDraftRevision < 1
      || !Number.isSafeInteger(data.currentDraftVersion) || data.currentDraftVersion < 1
      || data.currentDraftRevision < request.binding.draftRevision
      || data.currentDraftVersion < request.binding.draftVersion
      || !HASH_PATTERN.test(String(data.previewHash || ''))) {
      throw publishError('SS_ERP_WORKBENCH_PUBLISH_RESPONSE_INVALID', 'FAILED_FINAL', {
        status: Number(response && response.status) || null,
      });
    }
    var selectedMedia;
    try { selectedMedia = normalizeSelectedMedia(data.selectedMedia, true); } catch (_error) {
      throw publishError('SS_ERP_WORKBENCH_PUBLISH_RESPONSE_INVALID', 'FAILED_FINAL');
    }
    if (!sameSelectedMedia(selectedMedia, request.selectedMedia)) {
      throw publishError('SS_ERP_WORKBENCH_PUBLISH_RESPONSE_INVALID', 'FAILED_FINAL');
    }
    var selectedSkuKeys = normalizeSelectedSkuKeys(data.selectedSkuKeys);
    var orderedMedia = normalizeOrderedMedia(data.orderedMedia, selectedSkuKeys);
    var videoBindings = data.videoBindings === undefined ? undefined : normalizeVideoBindings(data.videoBindings, selectedSkuKeys);
    if (!sameSelectedMedia(
      selectedMediaFromOrdered(orderedMedia, selectedMedia),
      selectedMedia,
    )) {
      throw publishError('SS_ERP_WORKBENCH_PUBLISH_RESPONSE_INVALID', 'FAILED_FINAL');
    }
    return {
      contractVersion: CONTRACT_VERSION,
      executionMode: request.executionMode,
      shopId: request.binding.shopId,
      workflowId: request.binding.workflowId,
      basisDraftRevision: request.binding.draftRevision,
      basisDraftVersion: request.binding.draftVersion,
      selectedMedia: selectedMedia,
      currentDraftRevision: data.currentDraftRevision,
      currentDraftVersion: data.currentDraftVersion,
      previewHash: data.previewHash,
      selectedSkuKeys: selectedSkuKeys,
      orderedMedia: orderedMedia,
      ...(videoBindings === undefined ? {} : { videoBindings: videoBindings }),
    };
  }

  function normalizeEnvelope(value, record) {
    var request = record.request;
    if (!exactKeys(value, [
      'operation', 'shopId', 'workflowId', 'draftVersion', 'idempotencyKey', 'command',
    ]) || value.operation !== 'OZON_PUBLISH'
      || value.shopId !== request.binding.shopId
      || value.workflowId !== request.binding.workflowId
      || value.draftVersion !== record.currentDraftVersion
      || value.idempotencyKey !== record.idempotencyKey
      || !exactKeys(value.command, [
        'schemaVersion', 'draftRevision', 'publishIntentId', 'selectedSkuKeys',
      ])
      || value.command.schemaVersion !== 'ozon-publish-command/v1'
      || value.command.draftRevision !== record.currentDraftRevision + 1
      || !isCanonicalText(value.command.publishIntentId, 1, 200)) {
      throw publishError('SS_ERP_WORKBENCH_PUBLISH_RESPONSE_INVALID', 'FAILED_FINAL');
    }
    var selectedSkuKeys;
    try { selectedSkuKeys = normalizeSelectedSkuKeys(value.command.selectedSkuKeys); } catch (_error) {
      throw publishError('SS_ERP_WORKBENCH_PUBLISH_RESPONSE_INVALID', 'FAILED_FINAL');
    }
    if (selectedSkuKeys.length !== record.selectedSkuKeys.length
      || selectedSkuKeys.some(function (item, index) {
        return item !== record.selectedSkuKeys[index];
      })) {
      throw publishError('SS_ERP_WORKBENCH_PUBLISH_RESPONSE_INVALID', 'FAILED_FINAL');
    }
    return {
      operation: 'OZON_PUBLISH',
      shopId: request.binding.shopId,
      workflowId: request.binding.workflowId,
      draftVersion: record.currentDraftVersion,
      idempotencyKey: record.idempotencyKey,
      command: {
        schemaVersion: 'ozon-publish-command/v1',
        draftRevision: record.currentDraftRevision + 1,
        publishIntentId: value.command.publishIntentId,
        selectedSkuKeys: selectedSkuKeys,
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
      var definitive = response && response.state === 'http_error'
        && status >= 400 && status < 500 && ![408, 429].includes(status);
      throw publishError(
        definitive
          ? 'SS_ERP_WORKBENCH_PUBLISH_PREPARE_REJECTED'
          : 'SS_ERP_WORKBENCH_PUBLISH_UNKNOWN_OUTCOME',
        definitive ? 'FAILED_FINAL' : 'UNKNOWN_OUTCOME',
        { status: status },
      );
    }
    var envelope;
    try { envelope = normalizeEnvelope(data.envelope, record); } catch (_error) {
      throw publishError('SS_ERP_WORKBENCH_PUBLISH_UNKNOWN_OUTCOME', 'UNKNOWN_OUTCOME');
    }
    return { requestHash: data.requestHash, envelope: envelope };
  }

  function normalizeReceipt(receipt) {
    if (!isRecord(receipt)
      || !isCanonicalText(receipt.id, 1, 200)
      || !['PENDING', 'SUCCEEDED', 'FAILED'].includes(receipt.status)
      || (receipt.status === 'FAILED'
        ? !FAILURE_CODE_PATTERN.test(String(receipt.failureCode || ''))
        : receipt.failureCode !== null)) {
      throw publishError('SS_ERP_WORKBENCH_PUBLISH_UNKNOWN_OUTCOME', 'UNKNOWN_OUTCOME');
    }
    return {
      state: receipt.status,
      receiptId: receipt.id,
      failureCode: receipt.status === 'FAILED' ? receipt.failureCode : null,
    };
  }

  function parseExecuteResponse(response) {
    var body = response && response.body;
    if (response && response.state === 'response' && [200, 202].includes(response.status)
      && exactKeys(body, ['code', 'data']) && body.code === 1
      && exactKeys(body.data, ['receipt', 'replay'])
      && typeof body.data.replay === 'boolean') return normalizeReceipt(body.data.receipt);
    if (response && response.state === 'http_error' && response.status === 409
      && exactKeys(body, ['code', 'errorCode', 'msg', 'data'])
      && body.code === 0 && body.errorCode === 'publish_failed'
      && isCanonicalText(body.msg, 1, 500)
      && exactKeys(body.data, ['receipt'])) {
      var failed = normalizeReceipt(body.data.receipt);
      if (failed.state === 'FAILED') return failed;
    }
    throw publishError('SS_ERP_WORKBENCH_PUBLISH_UNKNOWN_OUTCOME', 'UNKNOWN_OUTCOME', {
      status: Number(response && response.status) || null,
    });
  }

  function parseStatusResponse(response) {
    var body = response && response.body;
    var data = body && body.data;
    if (!response || response.state !== 'response' || ![200, 202].includes(response.status)
      || !exactKeys(body, ['code', 'data']) || body.code !== 1
      || !exactKeys(data, ['contractVersion', 'state', 'receiptId', 'failureCode'])
      || data.contractVersion !== CONTRACT_VERSION
      || !STATUS_STATES.includes(data.state)) {
      throw publishError('SS_ERP_WORKBENCH_PUBLISH_UNKNOWN_OUTCOME', 'UNKNOWN_OUTCOME');
    }
    var valid = (data.state === 'NOT_COMMITTED'
        && data.receiptId === null && data.failureCode === null)
      || (['PENDING', 'SUCCEEDED'].includes(data.state)
        && isCanonicalText(data.receiptId, 1, 200) && data.failureCode === null)
      || (data.state === 'FAILED'
        && isCanonicalText(data.receiptId, 1, 200)
        && FAILURE_CODE_PATTERN.test(String(data.failureCode || '')));
    if (!valid) {
      throw publishError('SS_ERP_WORKBENCH_PUBLISH_UNKNOWN_OUTCOME', 'UNKNOWN_OUTCOME');
    }
    return {
      state: data.state,
      receiptId: data.receiptId,
      failureCode: data.failureCode,
    };
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
      throw new TypeError('Workbench listing publish coordinator dependencies are unavailable');
    }
    var previews = new Map();
    var inflight = new Map();

    function timestamp() {
      var value = now();
      if (value instanceof Date) value = value.getTime();
      if (!Number.isSafeInteger(value) || value < 0) {
        throw publishError('SS_ERP_WORKBENCH_PUBLISH_CLOCK_INVALID', 'FAILED_FINAL');
      }
      return value;
    }

    async function operationKey(request) {
      var digest = await cryptoImpl.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify({
          contractVersion: CONTRACT_VERSION,
          shopId: request.binding.shopId,
          workflowId: request.binding.workflowId,
          draftVersion: request.binding.draftVersion,
          selectedMedia: request.selectedMedia,
        })),
      );
      var hexadecimal = Array.from(new Uint8Array(digest))
        .map(function (byte) { return byte.toString(16).padStart(2, '0'); })
        .join('');
      return 'wb_publish_v2_' + hexadecimal.slice(0, 48);
    }

    function publicState(record) {
      return {
        contractVersion: CONTRACT_VERSION,
        request: record.request,
        state: record.state,
        executionMode: record.request.executionMode,
        shopId: record.request.binding.shopId,
        workflowId: record.request.binding.workflowId,
        currentDraftRevision: record.currentDraftRevision,
        currentDraftVersion: record.currentDraftVersion,
        previewHash: record.previewHash,
        receiptId: record.receiptId,
        failureCode: record.failureCode,
      };
    }

    function normalizeStoredRecord(value, key, expectedRequest, strictRequest) {
      if (!exactKeys(value, RECORD_KEYS)
        || value.contractVersion !== STORAGE_VERSION
        || !IDEMPOTENCY_PATTERN.test(String(value.idempotencyKey || ''))
        || value.idempotencyKey !== key
        || !HASH_PATTERN.test(String(value.previewHash || ''))
        || !Number.isSafeInteger(value.currentDraftRevision) || value.currentDraftRevision < 1
        || !Number.isSafeInteger(value.currentDraftVersion) || value.currentDraftVersion < 1
        || !OPERATION_STATES.includes(value.state)
        || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0
        || !Number.isSafeInteger(value.updatedAt) || value.updatedAt < value.createdAt) {
        throw publishError('SS_ERP_WORKBENCH_PUBLISH_STATE_INVALID', 'FAILED_FINAL');
      }
      var request;
      try { request = normalizeRequest(value.request); } catch (_error) {
        throw publishError('SS_ERP_WORKBENCH_PUBLISH_STATE_INVALID', 'FAILED_FINAL');
      }
      if (expectedRequest
        && !(strictRequest ? sameRequest(request, expectedRequest) : sameStableRequest(
          request,
          expectedRequest,
        ))) {
        throw publishError('SS_ERP_WORKBENCH_PUBLISH_IDEMPOTENCY_CONFLICT', 'FAILED_FINAL');
      }
      var selectedSkuKeys;
      try { selectedSkuKeys = normalizeSelectedSkuKeys(value.selectedSkuKeys); } catch (_error) {
        throw publishError('SS_ERP_WORKBENCH_PUBLISH_STATE_INVALID', 'FAILED_FINAL');
      }
      var requestHash = value.requestHash;
      var envelopeValue = value.envelope;
      if ((requestHash === null) !== (envelopeValue === null)
        || (requestHash !== null && !HASH_PATTERN.test(String(requestHash || '')))) {
        throw publishError('SS_ERP_WORKBENCH_PUBLISH_STATE_INVALID', 'FAILED_FINAL');
      }
      var normalized = {
        contractVersion: STORAGE_VERSION,
        request: request,
        previewHash: value.previewHash,
        currentDraftRevision: value.currentDraftRevision,
        currentDraftVersion: value.currentDraftVersion,
        selectedSkuKeys: selectedSkuKeys,
        idempotencyKey: key,
        requestHash: requestHash,
        envelope: null,
        state: value.state,
        receiptId: value.receiptId,
        failureCode: value.failureCode,
        createdAt: value.createdAt,
        updatedAt: value.updatedAt,
      };
      if (envelopeValue !== null) {
        try { normalized.envelope = normalizeEnvelope(envelopeValue, normalized); } catch (_error) {
          throw publishError('SS_ERP_WORKBENCH_PUBLISH_STATE_INVALID', 'FAILED_FINAL');
        }
      }
      if (value.receiptId !== null && !isCanonicalText(value.receiptId, 1, 200)) {
        throw publishError('SS_ERP_WORKBENCH_PUBLISH_STATE_INVALID', 'FAILED_FINAL');
      }
      if (value.failureCode !== null
        && !FAILURE_CODE_PATTERN.test(String(value.failureCode || ''))) {
        throw publishError('SS_ERP_WORKBENCH_PUBLISH_STATE_INVALID', 'FAILED_FINAL');
      }
      if ((value.state === 'NOT_COMMITTED'
          && (value.receiptId !== null || value.failureCode !== null))
        || (['PENDING', 'SUCCEEDED'].includes(value.state)
          && (value.receiptId === null || value.failureCode !== null))
        || (value.state === 'FAILED' && value.failureCode === null)) {
        throw publishError('SS_ERP_WORKBENCH_PUBLISH_STATE_INVALID', 'FAILED_FINAL');
      }
      return normalized;
    }

    async function loadRecord(key, request, strictRequest) {
      var values;
      try { values = await store.get(key); } catch (_error) {
        throw publishError('SS_ERP_WORKBENCH_PUBLISH_PERSISTENCE_UNAVAILABLE');
      }
      if (!isRecord(values) || values[key] === undefined) return null;
      return normalizeStoredRecord(values[key], key, request, strictRequest);
    }

    async function saveRecord(record) {
      record.updatedAt = timestamp();
      try { await store.set({ [record.idempotencyKey]: record }); } catch (_error) {
        throw publishError('SS_ERP_WORKBENCH_PUBLISH_PERSISTENCE_UNAVAILABLE');
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
          ? error.code : 'WORKBENCH_PUBLISH_FAILED';
      } else {
        record.state = 'OUTCOME_UNRESOLVED';
        record.failureCode = null;
      }
      try { await saveRecord(record); } catch (_error) {}
    }

    async function preview(value) {
      var request = normalizeRequest(value);
      var key = await operationKey(request);
      var body = {
        contractVersion: CONTRACT_VERSION,
        executionMode: request.executionMode,
        shopId: request.binding.shopId,
        workflowId: request.binding.workflowId,
        basisDraftRevision: request.binding.draftRevision,
        basisDraftVersion: request.binding.draftVersion,
        selectedMedia: request.selectedMedia,
      };
      var response;
      try { response = await transport.post(PREVIEW_PATH, body, { requiredScope: REQUIRED_SCOPE }); }
      catch (_error) {
        throw publishError('SS_ERP_WORKBENCH_PUBLISH_PREVIEW_UNAVAILABLE');
      }
      if (!response || response.state !== 'response' || response.status !== 200) {
        var errorCode = response && response.body && response.body.errorCode || null;
        throw publishError(errorCode === 'extension_workbench_listing_publish_not_ready'
          ? 'SS_ERP_WORKBENCH_PUBLISH_DRAFT_NOT_READY'
          : 'SS_ERP_WORKBENCH_PUBLISH_PREVIEW_REJECTED', 'FAILED_FINAL', {
          status: Number(response && response.status) || null,
          errorCode: errorCode,
        });
      }
      var normalized = parsePreviewResponse(response, request);
      previews.set(key, normalized);
      return normalized;
    }

    async function prepare(record) {
      record.state = 'PREPARING';
      record.receiptId = null;
      record.failureCode = null;
      await saveRecord(record);
      var request = record.request;
      var response;
      try {
        response = await transport.post(PREPARE_PATH, {
          contractVersion: CONTRACT_VERSION,
          executionMode: request.executionMode,
          shopId: request.binding.shopId,
          workflowId: request.binding.workflowId,
          basisDraftRevision: request.binding.draftRevision,
          basisDraftVersion: request.binding.draftVersion,
          selectedMedia: request.selectedMedia,
          previewHash: record.previewHash,
          idempotencyKey: record.idempotencyKey,
        }, { requiredScope: REQUIRED_SCOPE });
      } catch (_error) {
        throw publishError('SS_ERP_WORKBENCH_PUBLISH_UNKNOWN_OUTCOME', 'UNKNOWN_OUTCOME');
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
        throw publishError('SS_ERP_WORKBENCH_PUBLISH_UNKNOWN_OUTCOME', 'UNKNOWN_OUTCOME');
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
        throw publishError('SS_ERP_WORKBENCH_PUBLISH_UNKNOWN_OUTCOME', 'UNKNOWN_OUTCOME');
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
        envelope: record.envelope,
      };
    }

    async function queryStatus(record) {
      if (!record.requestHash || !record.envelope) {
        throw publishError('SS_ERP_WORKBENCH_PUBLISH_RECOVERY_UNAVAILABLE', 'UNKNOWN_OUTCOME');
      }
      var response;
      try {
        response = await transport.post(
          STATUS_PATH,
          statusEnvelope(record),
          { requiredScope: REQUIRED_SCOPE },
        );
      } catch (_error) {
        throw publishError('SS_ERP_WORKBENCH_PUBLISH_UNKNOWN_OUTCOME', 'UNKNOWN_OUTCOME');
      }
      return parseStatusResponse(response);
    }

    async function refreshStatus(record) {
      return persistState(record, await queryStatus(record));
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
        throw publishError('SS_ERP_WORKBENCH_PUBLISH_UNKNOWN_OUTCOME', 'UNKNOWN_OUTCOME');
      }
      grantToken = null;
      parseExecuteResponse(response);
      return refreshStatus(record);
    }

    async function confirmInternal(request, previewValue, key) {
      var record = await loadRecord(key, request, true);
      if (record) {
        if (record.previewHash !== previewValue.previewHash) {
          throw publishError('SS_ERP_WORKBENCH_PUBLISH_IDEMPOTENCY_CONFLICT', 'FAILED_FINAL');
        }
        if (['SUCCEEDED', 'FAILED'].includes(record.state)) return publicState(record);
        try {
          if (record.requestHash && record.envelope) return await refreshStatus(record);
          await prepare(record);
          return await dispatch(record);
        } catch (error) {
          var safe = error && error.code
            ? error : publishError('SS_ERP_WORKBENCH_PUBLISH_UNKNOWN_OUTCOME', 'UNKNOWN_OUTCOME');
          await markFailure(record, safe);
          throw safe;
        }
      }
      var createdAt = timestamp();
      record = {
        contractVersion: STORAGE_VERSION,
        request: request,
        previewHash: previewValue.previewHash,
        currentDraftRevision: previewValue.currentDraftRevision,
        currentDraftVersion: previewValue.currentDraftVersion,
        selectedSkuKeys: previewValue.selectedSkuKeys,
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
          ? error : publishError('SS_ERP_WORKBENCH_PUBLISH_UNKNOWN_OUTCOME', 'UNKNOWN_OUTCOME');
        await markFailure(record, safeError);
        throw safeError;
      }
    }

    function confirm(value) {
      return (async function () {
        if (!isRecord(value) || !exactKeys(value, INPUT_KEYS.concat(['previewHash']))) {
          throw publishError('SS_ERP_WORKBENCH_PUBLISH_INPUT_INVALID', 'FAILED_FINAL');
        }
        var requestValue = {};
        INPUT_KEYS.forEach(function (key) { requestValue[key] = value[key]; });
        var request = normalizeRequest(requestValue);
        if (!HASH_PATTERN.test(String(value.previewHash || ''))) {
          throw publishError('SS_ERP_WORKBENCH_PUBLISH_INPUT_INVALID', 'FAILED_FINAL');
        }
        var key = await operationKey(request);
        var cached = previews.get(key);
        if (!cached || cached.previewHash !== value.previewHash
          || cached.executionMode !== request.executionMode
          || cached.basisDraftRevision !== request.binding.draftRevision
          || cached.basisDraftVersion !== request.binding.draftVersion
          || !sameSelectedMedia(cached.selectedMedia, request.selectedMedia)) {
          throw publishError('SS_ERP_WORKBENCH_PUBLISH_CONFIRMATION_REQUIRED', 'FAILED_FINAL');
        }
        if (inflight.has(key)) return inflight.get(key);
        var promise = confirmInternal(request, cached, key);
        inflight.set(key, promise);
        try { return await promise; } finally {
          if (inflight.get(key) === promise) inflight.delete(key);
        }
      }());
    }

    async function getState(value) {
      var request = normalizeRequest(value);
      var key = await operationKey(request);
      var record = await loadRecord(key, request, false);
      if (!record) return null;
      if (inflight.has(key) || ['SUCCEEDED', 'FAILED'].includes(record.state)) {
        return publicState(record);
      }
      if (!record.requestHash || !record.envelope) return publicState(record);
      try { return await refreshStatus(record); } catch (error) {
        var safe = error && error.code
          ? error : publishError('SS_ERP_WORKBENCH_PUBLISH_UNKNOWN_OUTCOME', 'UNKNOWN_OUTCOME');
        await markFailure(record, safe);
        return publicState(record);
      }
    }

    function recover(value) {
      return (async function () {
        var request = normalizeRequest(value);
        var key = await operationKey(request);
        if (inflight.has(key)) return inflight.get(key);
        var promise = (async function () {
          var record = await loadRecord(key, request, false);
          if (!record) {
            throw publishError('SS_ERP_WORKBENCH_PUBLISH_OPERATION_NOT_FOUND', 'FAILED_FINAL');
          }
          if (['SUCCEEDED', 'FAILED'].includes(record.state)) return publicState(record);
          try {
            if (!record.requestHash || !record.envelope) {
              await prepare(record);
              return await dispatch(record);
            }
            var current = await queryStatus(record);
            await persistState(record, current);
            if (current.state !== 'NOT_COMMITTED') {
              return publicState(record);
            }
            return await dispatch(record);
          } catch (error) {
            var safe = error && error.code
              ? error : publishError('SS_ERP_WORKBENCH_PUBLISH_UNKNOWN_OUTCOME', 'UNKNOWN_OUTCOME');
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

    async function getActive(value) {
      if (!exactKeys(value, ['shopId', 'workflowId'])) {
        throw publishError('SS_ERP_WORKBENCH_PUBLISH_INPUT_INVALID', 'FAILED_FINAL');
      }
      var shopId = canonicalText(value.shopId, 200);
      var workflowId = canonicalText(value.workflowId, 200);
      var all;
      try { all = await store.get(null); } catch (_error) {
        throw publishError('SS_ERP_WORKBENCH_PUBLISH_PERSISTENCE_UNAVAILABLE');
      }
      if (!isRecord(all)) {
        throw publishError('SS_ERP_WORKBENCH_PUBLISH_STATE_INVALID', 'FAILED_FINAL');
      }
      var records = Object.keys(all).filter(function (key) {
        return IDEMPOTENCY_PATTERN.test(key);
      }).map(function (key) {
        return normalizeStoredRecord(all[key], key, null, false);
      }).filter(function (record) {
        return record.request.binding.shopId === shopId
          && record.request.binding.workflowId === workflowId
          && !['SUCCEEDED', 'FAILED'].includes(record.state);
      });
      if (records.length > 1) {
        throw publishError('SS_ERP_WORKBENCH_PUBLISH_STATE_INVALID', 'FAILED_FINAL');
      }
      if (!records.length) return null;
      var record = records[0];
      if (!record.requestHash || !record.envelope) return publicState(record);
      try { return await refreshStatus(record); } catch (_error) {
        record.state = 'OUTCOME_UNRESOLVED';
        record.failureCode = null;
        await saveRecord(record);
        return publicState(record);
      }
    }

    async function clear(value) {
      if (value == null) {
        if (inflight.size) {
          throw publishError('SS_ERP_WORKBENCH_PUBLISH_CLEAR_UNSAFE', 'FAILED_FINAL');
        }
        var all;
        try { all = await store.get(null); } catch (_error) {
          throw publishError('SS_ERP_WORKBENCH_PUBLISH_PERSISTENCE_UNAVAILABLE');
        }
        if (!isRecord(all)) {
          throw publishError('SS_ERP_WORKBENCH_PUBLISH_STATE_INVALID', 'FAILED_FINAL');
        }
        var keys = Object.keys(all).filter(function (key) {
          return IDEMPOTENCY_PATTERN.test(key);
        });
        if (keys.length) {
          try { await store.remove(keys); } catch (_error) {
            throw publishError('SS_ERP_WORKBENCH_PUBLISH_PERSISTENCE_UNAVAILABLE');
          }
        }
        previews.clear();
        return keys.length;
      }
      var request = normalizeRequest(value);
      var key = await operationKey(request);
      if (inflight.has(key)) {
        throw publishError('SS_ERP_WORKBENCH_PUBLISH_CLEAR_UNSAFE', 'FAILED_FINAL');
      }
      var record = await loadRecord(key, request, false);
      if (!record) {
        previews.delete(key);
        return false;
      }
      if (!['NOT_COMMITTED', 'SUCCEEDED', 'FAILED'].includes(record.state)) {
        throw publishError('SS_ERP_WORKBENCH_PUBLISH_CLEAR_UNSAFE', 'FAILED_FINAL');
      }
      try { await store.remove(key); } catch (_error) {
        throw publishError('SS_ERP_WORKBENCH_PUBLISH_PERSISTENCE_UNAVAILABLE');
      }
      previews.delete(key);
      return true;
    }

    return Object.freeze({
      preview: preview,
      confirm: confirm,
      recover: recover,
      getState: getState,
      getActive: getActive,
      clear: clear,
    });
  }

  global.SS_ERP_WORKBENCH_LISTING_PUBLISH_COORDINATOR = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    createCoordinator: createCoordinator,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
