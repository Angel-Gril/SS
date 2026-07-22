(function (root) {
  'use strict';

  var NONCE_PATTERN = /^[a-f0-9]{64}$/;
  var ACTIONS = new Set(['REVIEW_APPROVE', 'REVIEW_REJECT', 'APPLY_APPEND']);
  var OPERATIONS = new Set(['IMAGE_TO_IMAGE', 'IMAGE_TRANSLATE', 'FULL_EDIT', 'INPAINT']);
  var PLATFORMS = new Set(['1688', 'pdd', 'taobao', 'tmall']);
  var MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

  function exactText(value, maximum) {
    if (typeof value !== 'string') return '';
    var normalized = value.normalize('NFKC').trim();
    return normalized && normalized === value && normalized.length <= maximum ? normalized : '';
  }

  function positiveInteger(value) {
    return Number.isSafeInteger(value) && value > 0 ? value : 0;
  }

  function previewUrl(value) {
    var raw = exactText(value, 4096);
    if (!raw) return '';
    try {
      var parsed = new URL(raw);
      if (parsed.username || parsed.password || parsed.search || parsed.hash
        || parsed.hostname.endsWith('.')) return '';
      var hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
      var local = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
      if (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && local)) return parsed.href;
    } catch {}
    return '';
  }

  function normalizePreview(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (Object.keys(value).some(function (key) {
      return !['url', 'mimeType', 'width', 'height'].includes(key);
    })) return null;
    var url = previewUrl(value.url);
    var mimeType = exactText(value.mimeType, 100).toLowerCase();
    var width = value.width === null ? null : positiveInteger(value.width);
    var height = value.height === null ? null : positiveInteger(value.height);
    if (!url || !MIME_TYPES.has(mimeType) || width === 0 || height === 0) return null;
    return { url: url, mimeType: mimeType, width: width, height: height };
  }

  function normalizeIntent(value, options) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    var allowed = new Set([
      'nonce', 'platform', 'sourceProductId', 'snapshotId', 'listingWorkflowId', 'shopId',
      'mediaWorkflowId', 'outputAssetId', 'action', 'operation', 'expectedWorkflowRevision',
      'expectedTargetRevision', 'expectedTargetDraftVersion', 'preview', 'sourceTabId',
      'confirmationTabId', 'confirmationDocumentId',
      'createdAt', 'expiresAt', 'completedAt',
    ]);
    if (Object.keys(value).some(function (key) { return !allowed.has(key); })) return null;
    var now = Number.isSafeInteger(options && options.now) ? options.now : Date.now();
    var maximumLifetimeMs = positiveInteger(options && options.maximumLifetimeMs) || 5 * 60 * 1000;
    var nonce = exactText(value.nonce, 64);
    var platform = exactText(value.platform, 20).toLowerCase();
    var sourceProductId = exactText(value.sourceProductId, 200);
    var snapshotId = exactText(value.snapshotId, 200);
    var listingWorkflowId = exactText(value.listingWorkflowId, 200);
    var shopId = exactText(value.shopId, 200);
    var mediaWorkflowId = exactText(value.mediaWorkflowId, 200);
    var outputAssetId = exactText(value.outputAssetId, 200);
    var action = exactText(value.action, 30);
    var operation = exactText(value.operation, 100);
    var expectedWorkflowRevision = positiveInteger(value.expectedWorkflowRevision);
    var expectedTargetRevision = positiveInteger(value.expectedTargetRevision);
    var expectedTargetDraftVersion = positiveInteger(value.expectedTargetDraftVersion);
    var preview = normalizePreview(value.preview);
    var sourceTabId = Number.isSafeInteger(value.sourceTabId) && value.sourceTabId >= 0
      ? value.sourceTabId
      : -1;
    var confirmationTabId = Number.isSafeInteger(value.confirmationTabId) && value.confirmationTabId >= 0
      ? value.confirmationTabId
      : -1;
    var confirmationDocumentId = value.confirmationDocumentId === null
      ? null
      : exactText(value.confirmationDocumentId, 200);
    var createdAt = positiveInteger(value.createdAt);
    var expiresAt = positiveInteger(value.expiresAt);
    var completedAt = value.completedAt === null ? null : positiveInteger(value.completedAt);
    var completed = completedAt !== null;
    if (!NONCE_PATTERN.test(nonce) || !PLATFORMS.has(platform)
      || !sourceProductId || !snapshotId || !listingWorkflowId || !shopId
      || !mediaWorkflowId || !outputAssetId || !ACTIONS.has(action)
      || !OPERATIONS.has(operation) || !expectedWorkflowRevision
      || !expectedTargetRevision || !expectedTargetDraftVersion || !preview
      || sourceTabId < 0 || confirmationTabId < 0
      || (value.confirmationDocumentId !== null && !confirmationDocumentId)
      || !createdAt || createdAt > now + 60 * 1000
      || !expiresAt || expiresAt <= createdAt
      || expiresAt - createdAt > maximumLifetimeMs
      || (!completed && expiresAt <= now)
      || (completed && (!completedAt || completedAt < createdAt
        || completedAt > now + 60 * 1000
        || completedAt <= now - maximumLifetimeMs))) {
      return null;
    }
    return {
      nonce: nonce,
      platform: platform,
      sourceProductId: sourceProductId,
      snapshotId: snapshotId,
      listingWorkflowId: listingWorkflowId,
      shopId: shopId,
      mediaWorkflowId: mediaWorkflowId,
      outputAssetId: outputAssetId,
      action: action,
      operation: operation,
      expectedWorkflowRevision: expectedWorkflowRevision,
      expectedTargetRevision: expectedTargetRevision,
      expectedTargetDraftVersion: expectedTargetDraftVersion,
      preview: preview,
      sourceTabId: sourceTabId,
      confirmationTabId: confirmationTabId,
      confirmationDocumentId: confirmationDocumentId,
      createdAt: createdAt,
      expiresAt: expiresAt,
      completedAt: completedAt,
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

  function publicConfirmation(value) {
    return {
      action: value.action,
      operation: value.operation,
      target: {
        platform: value.platform,
        sourceProductId: value.sourceProductId,
        shopId: value.shopId,
        listingWorkflowId: value.listingWorkflowId,
      },
      preview: { ...value.preview },
      expiresAt: value.expiresAt,
      completed: value.completedAt !== null,
    };
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

  function isBoundTabSender(value, sender) {
    return Boolean(value && sender
      && Number.isSafeInteger(value.confirmationTabId)
      && Number.isSafeInteger(sender.tab && sender.tab.id)
      && sender.tab.id === value.confirmationTabId
      && sender.frameId === 0);
  }

  function bindSender(value, sender) {
    if (!isBoundTabSender(value, sender)) return null;
    var documentId = exactText(sender.documentId, 200);
    if (!documentId
      || (value.confirmationDocumentId !== null
        && value.confirmationDocumentId !== documentId)) return null;
    return { ...value, confirmationDocumentId: documentId };
  }

  function isBoundSender(value, sender) {
    return Boolean(value && value.confirmationDocumentId && bindSender(value, sender));
  }

  root.SS_ERP_SOURCE_MEDIA_CONFIRMATION = {
    createNonce: createNonce,
    isNonce: function (value) { return NONCE_PATTERN.test(String(value || '')); },
    normalizeIntent: normalizeIntent,
    publicConfirmation: publicConfirmation,
    createSerialQueue: createSerialQueue,
    bindSender: bindSender,
    isBoundSender: isBoundSender,
  };
}(typeof globalThis !== 'undefined' ? globalThis : self));
