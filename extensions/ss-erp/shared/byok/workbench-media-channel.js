(function exposeByokWorkbenchMediaChannel(global) {
  'use strict';

  var CONTRACT_VERSION = 'extension-byok-workbench-media-channel/v1';
  var DEFAULT_TICKET_TTL_MS = 15 * 1000;
  var MAX_TICKET_TTL_MS = 30 * 1000;
  var MAX_IMAGE_BYTES = 20 * 1024 * 1024;
  var MAX_OWNER_BYTES = 50 * 1024 * 1024;
  var MAX_DIMENSION = 4096;
  var MAX_PIXELS = MAX_DIMENSION * MAX_DIMENSION;
  var MAX_PENDING_CHANNELS = 32;
  var IMAGE_INSPECTION_VERSION = 'extension-byok-image-input-inspector/v1';
  var PURPOSES = Object.freeze(['REFERENCE', 'SOURCE', 'MASK']);
  var IMAGE_MIME_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp']);
  var OWNER_KEYS = Object.freeze(['ownerId', 'tabId', 'documentId']);

  function mediaError(code, message) {
    var error = new Error(message || code);
    error.name = 'ExtensionByokWorkbenchMediaChannelError';
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

  function hasControlCharacters(value) {
    for (var index = 0; index < value.length; index += 1) {
      var code = value.charCodeAt(index);
      if (code <= 0x1f || code === 0x7f) return true;
    }
    return false;
  }

  function canonicalText(value, maximum, code) {
    if (typeof value !== 'string') throw mediaError(code);
    var normalized = value.normalize('NFKC').trim();
    if (!normalized || normalized !== value || normalized.length > maximum
      || hasControlCharacters(normalized)) {
      throw mediaError(code);
    }
    return normalized;
  }

  function normalizeOwner(value) {
    if (!exactKeys(value, OWNER_KEYS)
      || !Number.isSafeInteger(value.tabId) || value.tabId < 0) {
      throw mediaError('SS_ERP_BYOK_WORKBENCH_MEDIA_OWNER_INVALID');
    }
    return Object.freeze({
      ownerId: canonicalText(
        value.ownerId,
        200,
        'SS_ERP_BYOK_WORKBENCH_MEDIA_OWNER_INVALID',
      ),
      tabId: value.tabId,
      documentId: canonicalText(
        value.documentId,
        200,
        'SS_ERP_BYOK_WORKBENCH_MEDIA_OWNER_INVALID',
      ),
    });
  }

  function normalizePurpose(value) {
    if (!PURPOSES.includes(value)) {
      throw mediaError('SS_ERP_BYOK_WORKBENCH_MEDIA_PURPOSE_INVALID');
    }
    return value;
  }

  function ownerKey(value) {
    return value.ownerId;
  }

  function sameOwner(left, right) {
    return left.ownerId === right.ownerId
      && left.tabId === right.tabId
      && left.documentId === right.documentId;
  }

  function randomHex(randomValues) {
    var bytes = new Uint8Array(24);
    randomValues(bytes);
    return Array.from(bytes).map(function (byte) {
      return byte.toString(16).padStart(2, '0');
    }).join('');
  }

  function boundedOption(value, fallback, maximum, code) {
    if (value === undefined) return fallback;
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
      throw mediaError(code);
    }
    return value;
  }

  function safeErrorCode(error) {
    var code = error && typeof error.code === 'string' ? error.code : '';
    return /^[A-Z][A-Z0-9_]{0,99}$/u.test(code)
      ? code
      : 'SS_ERP_BYOK_WORKBENCH_MEDIA_REJECTED';
  }

  function hexadecimal(buffer) {
    return Array.from(new Uint8Array(buffer)).map(function (byte) {
      return byte.toString(16).padStart(2, '0');
    }).join('');
  }

  function createBroker(options) {
    var Channel = options && options.BroadcastChannel || global.BroadcastChannel;
    var imageInspector = options && options.imageInspector;
    var decodeImage = options && options.decodeImage;
    var cryptoImpl = options && options.crypto || global.crypto;
    var now = options && typeof options.now === 'function'
      ? options.now
      : function () { return new Date(); };
    var randomValues = options && options.randomValues
      || function (bytes) { return global.crypto.getRandomValues(bytes); };
    var setTimer = options && options.setTimeout || global.setTimeout;
    var clearTimer = options && options.clearTimeout || global.clearTimeout;
    var ticketTtlMs = boundedOption(
      options && options.ticketTtlMs,
      DEFAULT_TICKET_TTL_MS,
      MAX_TICKET_TTL_MS,
      'SS_ERP_BYOK_WORKBENCH_MEDIA_DEPENDENCY_UNAVAILABLE',
    );
    var maxOwnerBytes = boundedOption(
      options && options.maxOwnerBytes,
      MAX_OWNER_BYTES,
      MAX_OWNER_BYTES,
      'SS_ERP_BYOK_WORKBENCH_MEDIA_DEPENDENCY_UNAVAILABLE',
    );
    if (typeof Channel !== 'function'
      || !imageInspector || typeof imageInspector.inspectImageBlob !== 'function'
      || (decodeImage !== undefined && typeof decodeImage !== 'function')
      || !cryptoImpl || !cryptoImpl.subtle || typeof cryptoImpl.subtle.digest !== 'function'
      || typeof randomValues !== 'function'
      || typeof setTimer !== 'function' || typeof clearTimer !== 'function') {
      throw mediaError('SS_ERP_BYOK_WORKBENCH_MEDIA_DEPENDENCY_UNAVAILABLE');
    }

    var pending = new Map();
    var inFlight = new Map();
    var entries = new Map();
    var ownerTotals = new Map();

    function currentMillis() {
      var value = new Date(now()).getTime();
      if (!Number.isFinite(value)) {
        throw mediaError('SS_ERP_BYOK_WORKBENCH_MEDIA_CLOCK_INVALID');
      }
      return value;
    }

    function closeChannel(row) {
      if (!row) return;
      if (row.timer !== null) {
        try { clearTimer(row.timer); } catch {}
      }
      row.timer = null;
      if (row.channel) {
        row.channel.onmessage = null;
        try { row.channel.close(); } catch {}
      }
      row.channel = null;
    }

    function cancelChannel(row) {
      if (!row) return false;
      pending.delete(row.channelName);
      inFlight.delete(row.channelName);
      row.cancelled = true;
      closeChannel(row);
      return true;
    }

    function beginUpload(row) {
      if (!row || row.consumed || row.cancelled) return false;
      row.consumed = true;
      pending.delete(row.channelName);
      if (row.timer !== null) {
        try { clearTimer(row.timer); } catch {}
      }
      row.timer = null;
      if (row.channel) row.channel.onmessage = null;
      inFlight.set(row.channelName, row);
      return true;
    }

    function finishUpload(row) {
      inFlight.delete(row.channelName);
      closeChannel(row);
    }

    function publicMetadata(value) {
      return Object.freeze({
        mimeType: value.mimeType,
        byteLength: value.byteLength,
        width: value.width,
        height: value.height,
        sha256: value.sha256,
      });
    }

    function normalizeInspection(value, blob, purpose) {
      var keys = [
        'contractVersion', 'mimeType', 'byteLength', 'width', 'height', 'animated',
        'decodeVerified',
      ];
      var allowedMimeTypes = purpose === 'MASK' ? ['image/png'] : IMAGE_MIME_TYPES;
      if (!exactKeys(value, keys)
        || value.contractVersion !== IMAGE_INSPECTION_VERSION
        || !allowedMimeTypes.includes(value.mimeType)
        || value.mimeType !== blob.type
        || value.byteLength !== blob.size
        || !Number.isSafeInteger(value.width) || value.width < 1 || value.width > MAX_DIMENSION
        || !Number.isSafeInteger(value.height) || value.height < 1 || value.height > MAX_DIMENSION
        || !Number.isSafeInteger(value.width * value.height)
        || value.width * value.height > MAX_PIXELS
        || value.animated !== false
        || typeof value.decodeVerified !== 'boolean') {
        throw mediaError('SS_ERP_BYOK_WORKBENCH_MEDIA_INSPECTION_INVALID');
      }
      return {
        mimeType: value.mimeType,
        byteLength: value.byteLength,
        width: value.width,
        height: value.height,
      };
    }

    async function sha256Blob(blob) {
      var buffer;
      try {
        buffer = await blob.arrayBuffer();
      } catch {
        throw mediaError('SS_ERP_BYOK_WORKBENCH_MEDIA_BYTES_INVALID');
      }
      if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== blob.size
        || buffer.byteLength > MAX_IMAGE_BYTES) {
        throw mediaError('SS_ERP_BYOK_WORKBENCH_MEDIA_BYTES_INVALID');
      }
      var digest;
      try {
        digest = await cryptoImpl.subtle.digest('SHA-256', buffer);
      } catch {
        throw mediaError('SS_ERP_BYOK_WORKBENCH_MEDIA_HASH_FAILED');
      } finally {
        buffer = null;
      }
      if (!(digest instanceof ArrayBuffer) || digest.byteLength !== 32) {
        throw mediaError('SS_ERP_BYOK_WORKBENCH_MEDIA_HASH_FAILED');
      }
      return hexadecimal(digest);
    }

    function removeEntry(entry) {
      if (!entry || entries.get(entry.mediaHandle) !== entry) return false;
      entries.delete(entry.mediaHandle);
      var key = ownerKey(entry.owner);
      var next = Math.max(0, (ownerTotals.get(key) || 0) - entry.metadata.byteLength);
      if (next > 0) ownerTotals.set(key, next);
      else ownerTotals.delete(key);
      entry.blob = null;
      return true;
    }

    function assertEntryBinding(entry, input) {
      if (!sameOwner(entry.owner, input.owner) || entry.purpose !== input.purpose) {
        throw mediaError('SS_ERP_BYOK_WORKBENCH_MEDIA_BINDING_MISMATCH');
      }
      return entry;
    }

    function normalizeHandleRequest(value) {
      var keys = OWNER_KEYS.concat(['purpose', 'mediaHandle']);
      if (!exactKeys(value, keys)) {
        throw mediaError('SS_ERP_BYOK_WORKBENCH_MEDIA_HANDLE_INVALID');
      }
      var mediaHandle = canonicalText(
        value.mediaHandle,
        128,
        'SS_ERP_BYOK_WORKBENCH_MEDIA_HANDLE_INVALID',
      );
      if (!/^mh_[a-f0-9]{48}$/u.test(mediaHandle)) {
        throw mediaError('SS_ERP_BYOK_WORKBENCH_MEDIA_HANDLE_INVALID');
      }
      return {
        owner: normalizeOwner({
          ownerId: value.ownerId,
          tabId: value.tabId,
          documentId: value.documentId,
        }),
        purpose: normalizePurpose(value.purpose),
        mediaHandle: mediaHandle,
      };
    }

    function rejectedResponse(row, error) {
      return Object.freeze({
        contractVersion: CONTRACT_VERSION,
        type: 'REJECTED',
        uploadTicket: row.uploadTicket,
        errorCode: safeErrorCode(error),
      });
    }

    async function handleUpload(row, event) {
      if (!beginUpload(row)) return;
      var response;
      var createdEntry = null;
      try {
        var message = event && event.data;
        if (!exactKeys(message, [
          'contractVersion', 'type', 'uploadTicket', 'purpose', 'image',
        ])
          || message.contractVersion !== CONTRACT_VERSION
          || message.type !== 'UPLOAD'
          || message.uploadTicket !== row.uploadTicket
          || message.purpose !== row.purpose) {
          throw mediaError('SS_ERP_BYOK_WORKBENCH_MEDIA_TICKET_MISMATCH');
        }
        if (currentMillis() >= row.expiresAtMillis) {
          throw mediaError('SS_ERP_BYOK_WORKBENCH_MEDIA_TICKET_EXPIRED');
        }
        if (typeof global.Blob !== 'function' || !(message.image instanceof global.Blob)) {
          throw mediaError('SS_ERP_BYOK_WORKBENCH_MEDIA_BLOB_INVALID');
        }
        var blob = message.image;
        var allowedMimeTypes = row.purpose === 'MASK' ? ['image/png'] : IMAGE_MIME_TYPES.slice();
        if (!allowedMimeTypes.includes(blob.type)) {
          throw mediaError('SS_ERP_BYOK_IMAGE_MIME_UNSUPPORTED');
        }
        if (!Number.isSafeInteger(blob.size) || blob.size < 1 || blob.size > MAX_IMAGE_BYTES) {
          throw mediaError('SS_ERP_BYOK_WORKBENCH_MEDIA_BYTES_INVALID');
        }
        var inspection = normalizeInspection(await imageInspector.inspectImageBlob({
          blob: blob,
          allowedMimeTypes: allowedMimeTypes,
          maxBytes: MAX_IMAGE_BYTES,
          maxDimension: MAX_DIMENSION,
          maxPixels: MAX_PIXELS,
          ...(decodeImage ? { decodeImage: decodeImage } : {}),
        }), blob, row.purpose);
        if (row.cancelled) return;
        var sha256 = await sha256Blob(blob);
        if (row.cancelled) return;
        var key = ownerKey(row.owner);
        var retainedBytes = ownerTotals.get(key) || 0;
        if (!Number.isSafeInteger(retainedBytes + blob.size)
          || retainedBytes + blob.size > maxOwnerBytes) {
          throw mediaError('SS_ERP_BYOK_WORKBENCH_MEDIA_OWNER_LIMIT');
        }
        var mediaHandle = 'mh_' + randomHex(randomValues);
        if (entries.has(mediaHandle)) {
          throw mediaError('SS_ERP_BYOK_WORKBENCH_MEDIA_HANDLE_COLLISION');
        }
        var metadata = Object.freeze({ ...inspection, sha256: sha256 });
        var entry = {
          mediaHandle: mediaHandle,
          owner: row.owner,
          purpose: row.purpose,
          metadata: metadata,
          blob: blob,
        };
        entries.set(mediaHandle, entry);
        createdEntry = entry;
        ownerTotals.set(key, retainedBytes + blob.size);
        response = Object.freeze({
          contractVersion: CONTRACT_VERSION,
          type: 'ACCEPTED',
          uploadTicket: row.uploadTicket,
          mediaHandle: mediaHandle,
          purpose: row.purpose,
          metadata: publicMetadata(metadata),
        });
      } catch (error) {
        if (!row.cancelled) response = rejectedResponse(row, error);
      } finally {
        if (!row.cancelled && response && row.channel) {
          try {
            row.channel.postMessage(response);
          } catch {
            if (createdEntry) removeEntry(createdEntry);
          }
        }
        finishUpload(row);
      }
    }

    function prepare(value) {
      if (!isRecord(value) || !exactKeys(value, OWNER_KEYS.concat(['purpose']))) {
        throw mediaError('SS_ERP_BYOK_WORKBENCH_MEDIA_TICKET_INVALID');
      }
      if (pending.size + inFlight.size >= MAX_PENDING_CHANNELS) {
        throw mediaError('SS_ERP_BYOK_WORKBENCH_MEDIA_CHANNEL_LIMIT');
      }
      var owner = normalizeOwner({
        ownerId: value.ownerId,
        tabId: value.tabId,
        documentId: value.documentId,
      });
      var purpose = normalizePurpose(value.purpose);
      var suffix = randomHex(randomValues);
      var channelName = 'ss-erp:byok-media-upload:' + suffix;
      if (pending.has(channelName) || inFlight.has(channelName)) {
        throw mediaError('SS_ERP_BYOK_WORKBENCH_MEDIA_TICKET_COLLISION');
      }
      var uploadTicket = 'ut_' + randomHex(randomValues);
      var expiresAtMillis = currentMillis() + ticketTtlMs;
      var channel = new Channel(channelName);
      var row = {
        channelName: channelName,
        channel: channel,
        uploadTicket: uploadTicket,
        purpose: purpose,
        owner: owner,
        expiresAtMillis: expiresAtMillis,
        timer: null,
        consumed: false,
        cancelled: false,
      };
      pending.set(channelName, row);
      try {
        row.timer = setTimer(function () { cancelChannel(row); }, ticketTtlMs);
      } catch {
        cancelChannel(row);
        throw mediaError('SS_ERP_BYOK_WORKBENCH_MEDIA_DEPENDENCY_UNAVAILABLE');
      }
      channel.onmessage = function (event) { void handleUpload(row, event); };
      return Object.freeze({
        contractVersion: CONTRACT_VERSION,
        channelName: channelName,
        uploadTicket: uploadTicket,
        purpose: purpose,
        expiresAt: new Date(expiresAtMillis).toISOString(),
      });
    }

    function getForBackground(value) {
      var input = normalizeHandleRequest(value);
      var entry = entries.get(input.mediaHandle);
      if (!entry || !entry.blob) {
        throw mediaError('SS_ERP_BYOK_WORKBENCH_MEDIA_HANDLE_NOT_FOUND');
      }
      assertEntryBinding(entry, input);
      return Object.freeze({
        mediaHandle: entry.mediaHandle,
        purpose: entry.purpose,
        blob: entry.blob,
        metadata: publicMetadata(entry.metadata),
      });
    }

    function release(value) {
      var input = normalizeHandleRequest(value);
      var entry = entries.get(input.mediaHandle);
      if (!entry) return false;
      assertEntryBinding(entry, input);
      return removeEntry(entry);
    }

    function releaseOwner(value) {
      var normalized = normalizeOwner(value);
      var cancelledChannels = 0;
      [...pending.values(), ...inFlight.values()].forEach(function (row) {
        if (sameOwner(row.owner, normalized) && cancelChannel(row)) cancelledChannels += 1;
      });
      var releasedCount = 0;
      var releasedBytes = 0;
      [...entries.values()].forEach(function (entry) {
        if (!sameOwner(entry.owner, normalized)) return;
        releasedBytes += entry.metadata.byteLength;
        if (removeEntry(entry)) releasedCount += 1;
      });
      return Object.freeze({
        releasedCount: releasedCount,
        releasedBytes: releasedBytes,
        cancelledChannels: cancelledChannels,
      });
    }

    function ownerBytes(value) {
      return ownerTotals.get(ownerKey(normalizeOwner(value))) || 0;
    }

    function clear() {
      [...pending.values(), ...inFlight.values()].forEach(cancelChannel);
      [...entries.values()].forEach(removeEntry);
    }

    return Object.freeze({
      prepare: prepare,
      getForBackground: getForBackground,
      release: release,
      releaseOwner: releaseOwner,
      ownerBytes: ownerBytes,
      clear: clear,
      size: function () { return entries.size; },
      pendingSize: function () { return pending.size + inFlight.size; },
    });
  }

  global.SS_ERP_BYOK_WORKBENCH_MEDIA_CHANNEL = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    PURPOSES: PURPOSES,
    LIMITS: Object.freeze({
      maxTicketTtlMs: MAX_TICKET_TTL_MS,
      maxImageBytes: MAX_IMAGE_BYTES,
      maxOwnerBytes: MAX_OWNER_BYTES,
      maxDimension: MAX_DIMENSION,
      maxPixels: MAX_PIXELS,
    }),
    createBroker: createBroker,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
