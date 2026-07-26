(function exposeByokWorkbenchEditMediaStore(global) {
  'use strict';

  var CONTRACT_VERSION = 'extension-byok-workbench-edit-media-store/v1';
  var CHANNEL_PURPOSES = Object.freeze(['REFERENCE', 'SOURCE', 'MASK']);
  var PURPOSE_MAP = Object.freeze({
    IMAGE_TO_IMAGE_REFERENCE: 'REFERENCE',
    FULL_EDIT_SOURCE: 'SOURCE',
    INPAINT_SOURCE: 'SOURCE',
    INPAINT_MASK: 'MASK',
  });
  var MIME_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp']);
  var MAX_IMAGE_BYTES = 20 * 1024 * 1024;
  var MAX_DIMENSION = 4096;
  var MAX_PIXELS = MAX_DIMENSION * MAX_DIMENSION;

  function storeError(code) {
    var error = new Error(code);
    error.name = 'ExtensionByokWorkbenchEditMediaStoreError';
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

  function canonicalText(value, maximum, code) {
    if (typeof value !== 'string') throw storeError(code);
    var normalized = value.normalize('NFKC').trim();
    if (!normalized || normalized !== value || normalized.length > maximum
      || /[\u0000-\u001f\u007f]/u.test(normalized)) {
      throw storeError(code);
    }
    return normalized;
  }

  function normalizeOwner(value) {
    var code = 'SS_ERP_BYOK_WORKBENCH_MEDIA_OWNER_INVALID';
    if (!isRecord(value) || !Number.isSafeInteger(value.tabId) || value.tabId < 0) {
      throw storeError(code);
    }
    var documentId = canonicalText(value.documentId, 200, code);
    return Object.freeze({
      ownerId: 'workbench-tab-' + String(value.tabId),
      tabId: value.tabId,
      documentId: documentId,
    });
  }

  function normalizePagePurpose(value) {
    if (!CHANNEL_PURPOSES.includes(value)) {
      throw storeError('SS_ERP_BYOK_WORKBENCH_MEDIA_PURPOSE_INVALID');
    }
    return value;
  }

  function normalizeControllerPurpose(value) {
    if (!Object.prototype.hasOwnProperty.call(PURPOSE_MAP, value)) {
      throw storeError('SS_ERP_BYOK_WORKBENCH_MEDIA_PURPOSE_INVALID');
    }
    return PURPOSE_MAP[value];
  }

  function normalizeHandle(value) {
    var handle = canonicalText(
      value,
      128,
      'SS_ERP_BYOK_WORKBENCH_MEDIA_HANDLE_INVALID',
    );
    if (!/^mh_[a-f0-9]{48}$/u.test(handle)) {
      throw storeError('SS_ERP_BYOK_WORKBENCH_MEDIA_HANDLE_INVALID');
    }
    return handle;
  }

  function request(ownerValue, purpose, mediaHandle) {
    var owner = normalizeOwner(ownerValue);
    return {
      ownerId: owner.ownerId,
      tabId: owner.tabId,
      documentId: owner.documentId,
      purpose: purpose,
      ...(mediaHandle ? { mediaHandle: normalizeHandle(mediaHandle) } : {}),
    };
  }

  function normalizeResolved(value, expectedHandle, expectedPurpose) {
    if (!exactKeys(value, ['mediaHandle', 'purpose', 'blob', 'metadata'])
      || value.mediaHandle !== expectedHandle || value.purpose !== expectedPurpose
      || !exactKeys(value.metadata, ['mimeType', 'byteLength', 'width', 'height', 'sha256'])) {
      throw storeError('SS_ERP_BYOK_EDIT_MEDIA_INVALID');
    }
    var metadata = value.metadata;
    var mimeTypes = expectedPurpose === 'MASK' ? ['image/png'] : MIME_TYPES;
    if (typeof global.Blob !== 'function' || !(value.blob instanceof global.Blob)
      || !mimeTypes.includes(metadata.mimeType) || value.blob.type !== metadata.mimeType
      || !Number.isSafeInteger(metadata.byteLength) || metadata.byteLength !== value.blob.size
      || metadata.byteLength < 1 || metadata.byteLength > MAX_IMAGE_BYTES
      || !Number.isSafeInteger(metadata.width) || metadata.width < 1
      || metadata.width > MAX_DIMENSION
      || !Number.isSafeInteger(metadata.height) || metadata.height < 1
      || metadata.height > MAX_DIMENSION
      || !Number.isSafeInteger(metadata.width * metadata.height)
      || metadata.width * metadata.height > MAX_PIXELS
      || typeof metadata.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(metadata.sha256)) {
      throw storeError('SS_ERP_BYOK_EDIT_MEDIA_INVALID');
    }
    return Object.freeze({
      blob: value.blob,
      mimeType: metadata.mimeType,
      width: metadata.width,
      height: metadata.height,
    });
  }

  function requiredMethod(value, name) {
    if (!value || typeof value[name] !== 'function') {
      throw storeError('SS_ERP_BYOK_WORKBENCH_MEDIA_DEPENDENCY_UNAVAILABLE');
    }
    return value[name].bind(value);
  }

  function createStore(options) {
    var broker = options && options.broker;
    var prepareMedia = requiredMethod(broker, 'prepare');
    var getMedia = requiredMethod(broker, 'getForBackground');
    var releaseMedia = requiredMethod(broker, 'release');
    var releaseOwnerMedia = requiredMethod(broker, 'releaseOwner');
    var clearMedia = requiredMethod(broker, 'clear');

    return Object.freeze({
      prepare: function (ownerValue, purposeValue) {
        return prepareMedia(request(ownerValue, normalizePagePurpose(purposeValue), null));
      },
      release: function (ownerValue, mediaHandleValue, purposeValue) {
        return releaseMedia(request(
          ownerValue,
          normalizePagePurpose(purposeValue),
          mediaHandleValue,
        ));
      },
      getForBackground: function (ownerValue, mediaHandleValue, purposeValue) {
        var purpose = normalizeControllerPurpose(purposeValue);
        var input = request(ownerValue, purpose, mediaHandleValue);
        return normalizeResolved(getMedia(input), input.mediaHandle, purpose);
      },
      releaseOwner: function (ownerValue) {
        return releaseOwnerMedia(normalizeOwner(ownerValue));
      },
      clear: function () {
        return clearMedia();
      },
    });
  }

  global.SS_ERP_BYOK_WORKBENCH_EDIT_MEDIA_STORE = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    CHANNEL_PURPOSES: CHANNEL_PURPOSES,
    CONTROLLER_PURPOSE_MAP: PURPOSE_MAP,
    createStore: createStore,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
