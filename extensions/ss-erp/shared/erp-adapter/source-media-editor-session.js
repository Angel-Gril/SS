(function (root) {
  'use strict';

  var NONCE_PATTERN = /^[a-f0-9]{64}$/;
  var SHA256_PATTERN = /^[a-f0-9]{64}$/;
  var PLATFORMS = new Set(['1688', 'pdd', 'taobao', 'tmall']);
  var OPERATIONS = new Set(['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT']);
  var SOURCE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
  var MASK_SEMANTICS = 'WHITE_EDIT_BLACK_PRESERVE_V1';
  var MAX_MASK_BYTES = 20 * 1024 * 1024;
  var MAX_SOURCE_PIXELS = 12 * 1000 * 1000;
  var MAX_SOURCE_EDGE = 16384;
  var MAX_SOURCE_ASPECT_RATIO = 20;

  function exactText(value, maximum, allowEmpty) {
    if (typeof value !== 'string') return null;
    var normalized = value.normalize('NFKC').trim();
    if (normalized !== value || normalized.length > maximum || (!allowEmpty && !normalized)) return null;
    return normalized;
  }

  function positiveInteger(value) {
    return Number.isSafeInteger(value) && value > 0 ? value : 0;
  }

  function normalizePreparedSource(value) {
    if (value === null) return null;
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some(function (key) {
        return ![
          'sourceMediaKey', 'sourceAssetId', 'mimeType', 'width', 'height',
          'maskSemantics', 'maxMaskBytes',
        ].includes(key);
      })) return undefined;
    var sourceMediaKey = exactText(value.sourceMediaKey, 500, false);
    var sourceAssetId = exactText(value.sourceAssetId, 200, false);
    var mimeType = exactText(value.mimeType, 100, false);
    var width = positiveInteger(value.width);
    var height = positiveInteger(value.height);
    var maxMaskBytes = positiveInteger(value.maxMaskBytes);
    var pixelCount = width * height;
    if (!sourceMediaKey || !sourceAssetId || !mimeType || !SOURCE_MIME_TYPES.has(mimeType)
      || !width || !height || width > MAX_SOURCE_EDGE || height > MAX_SOURCE_EDGE
      || !Number.isSafeInteger(pixelCount) || pixelCount > MAX_SOURCE_PIXELS
      || Math.max(width, height) / Math.min(width, height) > MAX_SOURCE_ASPECT_RATIO
      || value.maskSemantics !== MASK_SEMANTICS
      || !maxMaskBytes || maxMaskBytes > MAX_MASK_BYTES) return undefined;
    return {
      sourceMediaKey: sourceMediaKey,
      sourceAssetId: sourceAssetId,
      mimeType: mimeType,
      width: width,
      height: height,
      maskSemantics: MASK_SEMANTICS,
      maxMaskBytes: maxMaskBytes,
    };
  }

  function normalizeMaskCheckpoint(value) {
    if (value === null) return null;
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some(function (key) {
        return ![
          'maskSha256', 'maskAssetId', 'sourceMediaKey', 'sourceAssetId',
          'sourceWidth', 'sourceHeight',
        ].includes(key);
      })) return undefined;
    var maskSha256 = exactText(value.maskSha256, 64, false);
    var maskAssetId = exactText(value.maskAssetId, 200, false);
    var sourceMediaKey = exactText(value.sourceMediaKey, 500, false);
    var sourceAssetId = exactText(value.sourceAssetId, 200, false);
    var sourceWidth = positiveInteger(value.sourceWidth);
    var sourceHeight = positiveInteger(value.sourceHeight);
    if (!maskSha256 || !SHA256_PATTERN.test(maskSha256) || !maskAssetId
      || !sourceMediaKey || !sourceAssetId || !sourceWidth || !sourceHeight) return undefined;
    return {
      maskSha256: maskSha256,
      maskAssetId: maskAssetId,
      sourceMediaKey: sourceMediaKey,
      sourceAssetId: sourceAssetId,
      sourceWidth: sourceWidth,
      sourceHeight: sourceHeight,
    };
  }

  function normalizeCompletion(value) {
    if (value === null) return null;
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some(function (key) {
        return !['workflowId', 'operation', 'status', 'revision'].includes(key);
      })) return undefined;
    var workflowId = exactText(value.workflowId, 200, false);
    var status = exactText(value.status, 100, false);
    var revision = positiveInteger(value.revision);
    if (!workflowId || !OPERATIONS.has(value.operation) || !status || !revision) return undefined;
    return {
      workflowId: workflowId,
      operation: value.operation,
      status: status,
      revision: revision,
    };
  }

  function normalizeSession(value, options) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    var allowed = new Set([
      'nonce', 'platform', 'sourceProductId', 'snapshotId', 'supplyGoodsId', 'shopId',
      'listingWorkflowId', 'revision', 'draftVersion', 'operation', 'sourceMediaKeys',
      'preparedSource', 'sourceTabId', 'editorTabId', 'editorDocumentId',
      'maskCheckpoint', 'completion', 'createdAt', 'expiresAt', 'submitLeaseExpiresAt',
      'completedAt',
      'erpSourceAuthority',
    ]);
    if (Object.keys(value).some(function (key) { return !allowed.has(key); })) return null;
    var hasErpAuthority = Object.prototype.hasOwnProperty.call(value, 'erpSourceAuthority');
    var erpApi = root.SS_ERP_ERP_SOURCE_IMAGE_LAUNCH;
    var erpSourceAuthority = hasErpAuthority && erpApi && typeof erpApi.normalizeAuthority === 'function'
      ? erpApi.normalizeAuthority(value.erpSourceAuthority) : null;
    if (hasErpAuthority && !erpSourceAuthority) return null;
    var now = Number.isSafeInteger(options && options.now) ? options.now : Date.now();
    var maximumLifetimeMs = positiveInteger(options && options.maximumLifetimeMs);
    var maximumSubmitLeaseMs = positiveInteger(options && options.maximumSubmitLeaseMs);
    var nonce = exactText(value.nonce, 64, false);
    var platform = exactText(value.platform, 20, false);
    var sourceProductId = exactText(value.sourceProductId, 200, false);
    var snapshotId = exactText(value.snapshotId, 200, false);
    var supplyGoodsId = exactText(value.supplyGoodsId, 200, false);
    var shopId = exactText(value.shopId, 200, false);
    var listingWorkflowId = exactText(value.listingWorkflowId, 200, false);
    var revision = positiveInteger(value.revision);
    var draftVersion = positiveInteger(value.draftVersion);
    var operation = OPERATIONS.has(value.operation) ? value.operation : '';
    var maximumSources = operation === 'IMAGE_TO_IMAGE' ? 4 : 1;
    var sourceMediaKeys = Array.isArray(value.sourceMediaKeys)
      ? value.sourceMediaKeys.map(function (item) { return exactText(item, 500, false); })
      : null;
    var preparedSource = normalizePreparedSource(value.preparedSource);
    var sourceTabId = Number.isSafeInteger(value.sourceTabId) && value.sourceTabId >= 0
      ? value.sourceTabId
      : -1;
    var editorTabId = Number.isSafeInteger(value.editorTabId) && value.editorTabId >= 0
      ? value.editorTabId
      : -1;
    var editorDocumentId = value.editorDocumentId === null
      ? null
      : exactText(value.editorDocumentId, 200, false);
    var maskCheckpoint = normalizeMaskCheckpoint(value.maskCheckpoint);
    var completion = normalizeCompletion(value.completion);
    var createdAt = positiveInteger(value.createdAt);
    var expiresAt = positiveInteger(value.expiresAt);
    var submitLeaseExpiresAt = value.submitLeaseExpiresAt === null
      ? null
      : positiveInteger(value.submitLeaseExpiresAt);
    var completedAt = value.completedAt === null ? null : positiveInteger(value.completedAt);
    if (!nonce || !NONCE_PATTERN.test(nonce) || !platform || !PLATFORMS.has(platform)
      || !sourceProductId || !snapshotId || !supplyGoodsId || !shopId
      || !listingWorkflowId || !revision || !draftVersion || !operation
      || !sourceMediaKeys || sourceMediaKeys.length < 1 || sourceMediaKeys.length > maximumSources
      || sourceMediaKeys.some(function (key) { return !key; })
      || new Set(sourceMediaKeys).size !== sourceMediaKeys.length
      || sourceTabId < 0 || editorTabId < 0
      || (value.editorDocumentId !== null && !editorDocumentId)
      || preparedSource === undefined || maskCheckpoint === undefined || completion === undefined
      || (operation === 'INPAINT'
        ? (!preparedSource || preparedSource.sourceMediaKey !== sourceMediaKeys[0])
        : preparedSource !== null)
      || (operation !== 'INPAINT' && maskCheckpoint !== null)
      || (maskCheckpoint !== null && (!preparedSource
        || maskCheckpoint.sourceMediaKey !== preparedSource.sourceMediaKey
        || maskCheckpoint.sourceAssetId !== preparedSource.sourceAssetId
        || maskCheckpoint.sourceWidth !== preparedSource.width
        || maskCheckpoint.sourceHeight !== preparedSource.height))
      || (completion !== null && completion.operation !== operation)
      || !createdAt || createdAt > now + 60 * 1000
      || !maximumLifetimeMs || !expiresAt || expiresAt <= createdAt
      || expiresAt - createdAt > maximumLifetimeMs
      || !maximumSubmitLeaseMs
      || (submitLeaseExpiresAt !== null
        && (submitLeaseExpiresAt <= expiresAt
          || submitLeaseExpiresAt - expiresAt > maximumSubmitLeaseMs))
      || (submitLeaseExpiresAt === null ? expiresAt : submitLeaseExpiresAt) <= now
      || (completedAt === null) !== (completion === null)
      || (completion !== null && submitLeaseExpiresAt === null)
      || (completedAt !== null && (completedAt < createdAt
        || completedAt > submitLeaseExpiresAt || completedAt > now + 60 * 1000))) {
      return null;
    }
    return {
      nonce: nonce,
      platform: platform,
      sourceProductId: sourceProductId,
      snapshotId: snapshotId,
      supplyGoodsId: supplyGoodsId,
      shopId: shopId,
      listingWorkflowId: listingWorkflowId,
      revision: revision,
      draftVersion: draftVersion,
      operation: operation,
      sourceMediaKeys: sourceMediaKeys,
      preparedSource: preparedSource,
      sourceTabId: sourceTabId,
      editorTabId: editorTabId,
      editorDocumentId: editorDocumentId,
      maskCheckpoint: maskCheckpoint,
      completion: completion,
      createdAt: createdAt,
      expiresAt: expiresAt,
      submitLeaseExpiresAt: submitLeaseExpiresAt,
      completedAt: completedAt,
      ...(hasErpAuthority ? { erpSourceAuthority: erpSourceAuthority } : {}),
    };
  }

  function createNonce(cryptoValue) {
    if (!cryptoValue || typeof cryptoValue.getRandomValues !== 'function') {
      throw new Error('secure random source is unavailable');
    }
    var bytes = new Uint8Array(32);
    cryptoValue.getRandomValues(bytes);
    return Array.from(bytes).map(function (byte) {
      return byte.toString(16).padStart(2, '0');
    }).join('');
  }

  function bindSender(value, sender) {
    if (!value || !sender || sender.frameId !== 0
      || !Number.isSafeInteger(sender.tab && sender.tab.id)
      || sender.tab.id !== value.editorTabId) return null;
    var documentId = exactText(sender.documentId, 200, false);
    if (!documentId || (value.editorDocumentId !== null
      && value.editorDocumentId !== documentId)) return null;
    return { ...value, editorDocumentId: documentId };
  }

  function createSerialQueue() {
    var queue = Promise.resolve();
    return {
      run: function (operation) {
        if (typeof operation !== 'function') return Promise.reject(new Error('operation is required'));
        var next = queue.then(operation, operation);
        queue = next.catch(function () {});
        return next;
      },
    };
  }

  root.SS_ERP_SOURCE_MEDIA_EDITOR_SESSION = {
    createNonce: createNonce,
    isNonce: function (value) { return NONCE_PATTERN.test(String(value || '')); },
    normalizeSession: normalizeSession,
    normalizeMaskCheckpoint: normalizeMaskCheckpoint,
    normalizePreparedSource: normalizePreparedSource,
    normalizeCompletion: normalizeCompletion,
    bindSender: bindSender,
    isBoundSender: function (value, sender) {
      return Boolean(value && value.editorDocumentId && bindSender(value, sender));
    },
    createSerialQueue: createSerialQueue,
  };
}(typeof globalThis !== 'undefined' ? globalThis : self));
