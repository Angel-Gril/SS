(function exposeByokWorkbenchSourceMediaLibrary(global) {
  'use strict';

  var CATALOG_VERSION = 'extension-byok-workbench-source-catalog/v1';
  var PREVIEW_PATH = '/api/extension-device/source-workbench/media-preview';
  var MAX_PREVIEW_BYTES = 10 * 1024 * 1024;
  var CONTEXT_KEYS = [
    'contractVersion', 'sourcePlatform', 'sourceProductId', 'sourceCaptureSnapshotId',
    'supplyGoodsId', 'shopId', 'workflowId', 'draftRevision', 'draftVersion',
    'skuKey', 'slotKey', 'assignmentMode', 'assignmentOrdinal',
  ];

  function libraryError(code) {
    var error = new Error(code);
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

  function text(value, maximum) {
    if (typeof value !== 'string' || !value || value.length > maximum
      || value !== value.normalize('NFKC').trim()
      || Array.from(value).some(function (character) { var code = character.charCodeAt(0); return code < 32 || code === 127; })) {
      throw libraryError('SS_ERP_SOURCE_MEDIA_LIBRARY_INVALID');
    }
    return value;
  }

  function context(value) {
    if (!exactKeys(value, CONTEXT_KEYS)
      || value.contractVersion !== 'extension-byok-workbench-launch-context/v1'
      || value.assignmentMode !== 'APPEND'
      || !Number.isSafeInteger(value.draftRevision) || value.draftRevision < 1
      || !Number.isSafeInteger(value.draftVersion) || value.draftVersion < 1
      || !Number.isSafeInteger(value.assignmentOrdinal) || value.assignmentOrdinal < 0) {
      throw libraryError('SS_ERP_SOURCE_MEDIA_LIBRARY_INVALID');
    }
    return {
      sourceCaptureSnapshotId: text(value.sourceCaptureSnapshotId, 200),
      supplyGoodsId: text(value.supplyGoodsId, 200),
      shopId: text(value.shopId, 200),
      workflowId: text(value.workflowId, 200),
      draftRevision: value.draftRevision,
      draftVersion: value.draftVersion,
      skuKey: text(value.skuKey, 500),
    };
  }

  function responseHeader(response, name) {
    return response && response.headers && typeof response.headers.get === 'function'
      ? response.headers.get(name) : null;
  }

  function bytesHex(buffer) {
    return Array.from(new Uint8Array(buffer)).map(function (byte) {
      return byte.toString(16).padStart(2, '0');
    }).join('');
  }

  function imageMagicValid(bytes, mimeType) {
    if (mimeType === 'image/png') {
      return bytes.length >= 8
        && [137, 80, 78, 71, 13, 10, 26, 10].every(function (byte, index) {
          return bytes[index] === byte;
        });
    }
    return mimeType === 'image/jpeg' && bytes.length >= 3
      && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  }

  async function boundedImageBytes(response, declaredLength) {
    if (!response.body || typeof response.body.getReader !== 'function') return response.arrayBuffer();
    var reader = response.body.getReader(), chunks = [], total = 0;
    try {
      while (true) {
        var next = await reader.read();
        if (next.done) break;
        if (!(next.value instanceof Uint8Array) || (total += next.value.byteLength) > declaredLength || total > MAX_PREVIEW_BYTES) {
          try { await reader.cancel(); } catch {}
          throw libraryError('SS_ERP_SOURCE_MEDIA_PREVIEW_INVALID');
        }
        chunks.push(next.value);
      }
    } finally { reader.releaseLock(); }
    var bytes = new Uint8Array(total), offset = 0;
    chunks.forEach(function (chunk) { bytes.set(chunk, offset); offset += chunk.byteLength; });
    return bytes.buffer;
  }

  function roleLabel(role) {
    return ({
      product_main: '商品主图',
      product_detail: '商品详情图',
      sku: 'SKU 图片',
      video_cover: '视频封面',
      unknown: '商品图片',
    })[role] || '商品图片';
  }

  function createLibrary(options) {
    var listingClient = options && options.listingClient;
    var transport = options && options.transport;
    var previewBroker = options && options.previewBroker;
    var cryptoImpl = options && options.crypto || global.crypto;
    var BlobConstructor = options && options.Blob || global.Blob;
    if (!listingClient || typeof listingClient.getMediaLaunch !== 'function'
      || !transport || typeof transport.postRaw !== 'function'
      || !previewBroker || typeof previewBroker.open !== 'function'
      || !cryptoImpl || !cryptoImpl.subtle || typeof cryptoImpl.subtle.digest !== 'function'
      || typeof BlobConstructor !== 'function') {
      throw libraryError('SS_ERP_SOURCE_MEDIA_LIBRARY_UNAVAILABLE');
    }

    async function sha256(value) {
      var bytes = typeof value === 'string'
        ? new TextEncoder().encode(value) : value;
      var input = bytes instanceof Uint8Array
        ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
        : bytes;
      return bytesHex(await cryptoImpl.subtle.digest('SHA-256', input));
    }

    async function loadCatalog(contextValue) {
      var binding = context(contextValue);
      var launch = await listingClient.getMediaLaunch({
        snapshotId: binding.sourceCaptureSnapshotId,
        supplyGoodsId: binding.supplyGoodsId,
        shopId: binding.shopId,
        listingWorkflowId: binding.workflowId,
        revision: binding.draftRevision,
        draftVersion: binding.draftVersion,
      });
      if (!launch || launch.state !== 'ready' || !launch.context
        || launch.context.snapshotId !== binding.sourceCaptureSnapshotId
        || launch.context.supplyGoodsId !== binding.supplyGoodsId
        || launch.context.shopId !== binding.shopId
        || launch.context.id !== binding.workflowId
        || launch.context.revision !== binding.draftRevision
        || launch.context.draftVersion !== binding.draftVersion
        || !Array.isArray(launch.context.sourceInputs)) {
        throw libraryError('SS_ERP_SOURCE_MEDIA_LIBRARY_STALE');
      }
      var eligible = launch.context.sourceInputs.filter(function (item) {
        return exactKeys(item, ['sourceMediaKey', 'role', 'scope', 'skuKeys'])
          && text(item.sourceMediaKey, 500)
          && text(item.role, 100)
          && ['PRODUCT', 'SKU'].includes(item.scope)
          && Array.isArray(item.skuKeys)
          && item.skuKeys.length <= 500
          && item.skuKeys.every(function (skuKey) { return text(skuKey, 500); })
          && (item.scope === 'PRODUCT'
            ? item.skuKeys.length === 0 : item.skuKeys.includes(binding.skuKey));
      }).slice(0, 50);
      var items = await Promise.all(eligible.map(async function (item, index) {
        var mediaId = 'sm_' + (await sha256([
          binding.sourceCaptureSnapshotId,
          binding.workflowId,
          String(binding.draftRevision),
          String(binding.draftVersion),
          item.sourceMediaKey,
        ].join('\0'))).slice(0, 48);
        return Object.freeze({
          mediaId: mediaId,
          sourceMediaKey: item.sourceMediaKey,
          role: item.role,
          scope: item.scope,
          skuKeys: Object.freeze(item.skuKeys.slice()),
          label: roleLabel(item.role) + ' ' + String(index + 1),
        });
      }));
      return Object.freeze({
        contractVersion: CATALOG_VERSION,
        items: Object.freeze(items),
      });
    }

    async function readForBackground(contextValue, sourceMediaKeyValue, purposeValue) {
      var binding = context(contextValue);
      var sourceMediaKey = text(sourceMediaKeyValue, 500);
      var purpose = purposeValue;
      if (!['THUMBNAIL', 'WORKING'].includes(purpose)) {
        throw libraryError('SS_ERP_SOURCE_MEDIA_LIBRARY_INVALID');
      }
      var catalog = await loadCatalog(contextValue);
      var matches = await Promise.all(catalog.items.map(async function (item) {
        if (item.sourceMediaKey === sourceMediaKey) return item.sourceMediaKey;
        // Match the server's existing URL-free public alias; never resolve an
        // arbitrary URL or a key from a different source/SKU catalog.
        if (/^media-key-sha256:[a-f0-9]{64}$/u.test(sourceMediaKey)
          && /^media:[A-Za-z0-9_-]+\|[A-Za-z0-9_-]+\|\d+\|https:\/\/[^\s|]+$/u.test(item.sourceMediaKey)
          && 'media-key-sha256:' + await sha256(item.sourceMediaKey) === sourceMediaKey) return item.sourceMediaKey;
        return null;
      }));
      matches = matches.filter(function (item) { return item !== null; });
      if (matches.length !== 1) {
        throw libraryError('SS_ERP_SOURCE_MEDIA_LIBRARY_STALE');
      }
      sourceMediaKey = matches[0];
      var result = await transport.postRaw(PREVIEW_PATH, {
        snapshotId: binding.sourceCaptureSnapshotId,
        supplyGoodsId: binding.supplyGoodsId,
        shopId: binding.shopId,
        listingWorkflowId: binding.workflowId,
        revision: binding.draftRevision,
        draftVersion: binding.draftVersion,
        skuKey: binding.skuKey,
        sourceMediaKey: sourceMediaKey,
        purpose: purpose,
      }, { requiredScopes: ['listing:review', 'media:execute'] });
      if (!result || result.state !== 'raw_response' || !result.response
        || result.response.ok !== true || result.response.status !== 200) {
        throw libraryError('SS_ERP_SOURCE_MEDIA_PREVIEW_UNAVAILABLE');
      }
      var response = result.response;
      var mimeType = responseHeader(response, 'content-type');
      var rawLength = responseHeader(response, 'content-length');
      var expectedSha256 = responseHeader(response, 'x-ss-erp-content-sha256');
      var width = Number(responseHeader(response, 'x-ss-erp-image-width'));
      var height = Number(responseHeader(response, 'x-ss-erp-image-height'));
      if (!['image/jpeg', 'image/png'].includes(mimeType)
        || !/^[1-9]\d{0,8}$/u.test(String(rawLength || ''))
        || !/^[a-f0-9]{64}$/u.test(String(expectedSha256 || ''))
        || !Number.isSafeInteger(width) || width < 1 || width > 2048
        || !Number.isSafeInteger(height) || height < 1 || height > 2048) {
        throw libraryError('SS_ERP_SOURCE_MEDIA_PREVIEW_INVALID');
      }
      var declaredLength = Number(rawLength);
      if (declaredLength > MAX_PREVIEW_BYTES) {
        try { await response.body?.cancel(); } catch {}
        throw libraryError('SS_ERP_SOURCE_MEDIA_PREVIEW_INVALID');
      }
      var buffer = await boundedImageBytes(response, declaredLength);
      if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== declaredLength
        || buffer.byteLength < 1 || buffer.byteLength > MAX_PREVIEW_BYTES) {
        throw libraryError('SS_ERP_SOURCE_MEDIA_PREVIEW_INVALID');
      }
      var bytes = new Uint8Array(buffer);
      var actualSha256 = await sha256(bytes);
      if (actualSha256 !== expectedSha256 || !imageMagicValid(bytes, mimeType)) {
        throw libraryError('SS_ERP_SOURCE_MEDIA_PREVIEW_INVALID');
      }
      var blob = new BlobConstructor([bytes], { type: mimeType });
      if (blob.size !== declaredLength || blob.type !== mimeType) {
        throw libraryError('SS_ERP_SOURCE_MEDIA_PREVIEW_INVALID');
      }
      return Object.freeze({ blob: blob, mimeType: mimeType, byteLength: declaredLength,
        sha256: actualSha256, width: width, height: height });
    }

    async function open(contextValue, sourceMediaKeyValue, purposeValue) {
      var image = await readForBackground(contextValue, sourceMediaKeyValue, purposeValue);
      return previewBroker.open({
        resultId: 'br_' + image.sha256.slice(0, 48),
        reviewState: 'CANDIDATE_READY',
        blob: image.blob,
        mimeType: image.mimeType,
        byteLength: image.byteLength,
        sha256: image.sha256,
      });
    }

    return Object.freeze({ loadCatalog: loadCatalog, open: open, readForBackground: readForBackground });
  }

  global.SS_ERP_BYOK_WORKBENCH_SOURCE_MEDIA_LIBRARY = Object.freeze({
    CATALOG_VERSION: CATALOG_VERSION,
    createLibrary: createLibrary,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
