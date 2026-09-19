(function exposeHostedAiImageSuiteCandidatePreviewBridge(global) {
  'use strict';

  var CONTRACT_VERSION = 'extension-hosted-ai-image-suite-candidate-preview-channel/v1';
  var SERVER_CONTRACT_VERSION = 'extension-hosted-ai-image-suite-candidate-preview/v1';
  var TICKET_TTL_MS = 30 * 1000;
  var MAXIMUM_CLOCK_SKEW_MS = 30 * 1000;
  var MAX_IMAGE_BYTES = 20 * 1024 * 1024;
  var MAX_DIMENSION = 4096;
  var MAX_PIXELS = MAX_DIMENSION * MAX_DIMENSION;
  var MAX_PENDING_CHANNELS = 8;
  var BINDING_KEYS = Object.freeze([
    'snapshotId', 'supplyGoodsId', 'shopId', 'listingWorkflowId',
    'draftRevision', 'draftVersion', 'planId', 'planVersionId', 'planRevision',
    'suiteId', 'suiteRevision', 'slotId', 'slotRevision', 'workflowId',
    'workflowRevision', 'outputAssetId',
  ]);
  var INTEGER_BINDING_KEYS = Object.freeze([
    'draftRevision', 'draftVersion', 'planRevision', 'suiteRevision',
    'slotRevision', 'workflowRevision',
  ]);
  var PNG_SIGNATURE = Object.freeze([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  function bridgeError(code) {
    var error = new Error(code);
    error.name = 'ExtensionHostedAiImageSuiteCandidatePreviewBridgeError';
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
    if (typeof value !== 'string') throw bridgeError(code);
    var normalized = value.normalize('NFKC').trim();
    if (!normalized || normalized !== value || normalized.length > maximum
      || hasControlCharacters(normalized)) {
      throw bridgeError(code);
    }
    return normalized;
  }

  function normalizeBinding(value) {
    var code = 'SS_ERP_HOSTED_CANDIDATE_PREVIEW_BINDING_INVALID';
    if (!exactKeys(value, BINDING_KEYS)) throw bridgeError(code);
    var result = {};
    BINDING_KEYS.forEach(function (key) {
      if (INTEGER_BINDING_KEYS.includes(key)) {
        if (!Number.isSafeInteger(value[key]) || value[key] < 1) throw bridgeError(code);
        result[key] = value[key];
      } else {
        result[key] = canonicalText(value[key], 200, code);
      }
    });
    return Object.freeze(result);
  }

  function bindingKey(value) {
    return JSON.stringify(BINDING_KEYS.map(function (key) { return value[key]; }));
  }

  function randomHex(randomValues) {
    var bytes = new Uint8Array(24);
    randomValues(bytes);
    return Array.from(bytes).map(function (byte) {
      return byte.toString(16).padStart(2, '0');
    }).join('');
  }

  function hexadecimal(buffer) {
    return Array.from(new Uint8Array(buffer)).map(function (byte) {
      return byte.toString(16).padStart(2, '0');
    }).join('');
  }

  function responseHeader(response, name) {
    if (!response || !response.headers || typeof response.headers.get !== 'function') return null;
    var value = response.headers.get(name);
    return value === null || value === undefined ? null : String(value);
  }

  function cancelResponseBody(response) {
    try {
      if (response && response.body && typeof response.body.cancel === 'function') {
        var cancelled = response.body.cancel();
        if (cancelled && typeof cancelled.catch === 'function') {
          cancelled.catch(function () {});
        }
      }
    } catch {}
  }

  function createBridge(options) {
    var issuePreview = options && options.issuePreview;
    var consumePreview = options && options.consumePreview;
    var Channel = options && options.BroadcastChannel || global.BroadcastChannel;
    var BlobConstructor = options && options.Blob || global.Blob;
    var AbortControllerConstructor = options && options.AbortController
      || global.AbortController;
    var cryptoImpl = options && options.crypto || global.crypto;
    var now = options && typeof options.now === 'function'
      ? options.now
      : function () { return new Date(); };
    var randomValues = options && options.randomValues
      || function (bytes) { return global.crypto.getRandomValues(bytes); };
    var setTimer = options && options.setTimeout || global.setTimeout;
    var clearTimer = options && options.clearTimeout || global.clearTimeout;
    if (typeof issuePreview !== 'function' || typeof consumePreview !== 'function'
      || typeof Channel !== 'function' || typeof BlobConstructor !== 'function'
      || typeof AbortControllerConstructor !== 'function'
      || !cryptoImpl || !cryptoImpl.subtle || typeof cryptoImpl.subtle.digest !== 'function'
      || typeof randomValues !== 'function' || typeof setTimer !== 'function'
      || typeof clearTimer !== 'function') {
      throw bridgeError('SS_ERP_HOSTED_CANDIDATE_PREVIEW_DEPENDENCY_UNAVAILABLE');
    }

    var rows = new Map();

    function currentMillis() {
      var value = new Date(now()).getTime();
      if (!Number.isFinite(value)) {
        throw bridgeError('SS_ERP_HOSTED_CANDIDATE_PREVIEW_CLOCK_INVALID');
      }
      return value;
    }

    function closeRow(row) {
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
      try { row.abortController.abort(); } catch {}
      row.erpToken = null;
      row.binding = null;
    }

    function cancelRow(row) {
      if (!row || rows.get(row.channelName) !== row) return false;
      rows.delete(row.channelName);
      row.cancelled = true;
      closeRow(row);
      return true;
    }

    function beginConsume(row) {
      if (!row || rows.get(row.channelName) !== row
        || row.state !== 'PENDING' || row.cancelled) return false;
      row.state = 'CONSUMING';
      if (row.channel) row.channel.onmessage = null;
      return true;
    }

    function finishRow(row) {
      if (!row || rows.get(row.channelName) !== row) return false;
      rows.delete(row.channelName);
      closeRow(row);
      return true;
    }

    function normalizeIssue(value, binding, issuedAtMillis) {
      var code = 'SS_ERP_HOSTED_CANDIDATE_PREVIEW_ISSUE_INVALID';
      if (!exactKeys(value, [
        'contractVersion', 'token', 'expiresAt', 'output',
      ]) || value.contractVersion !== SERVER_CONTRACT_VERSION
        || !exactKeys(value.output, [
          'assetId', 'mimeType', 'width', 'height', 'previewAvailable',
        ])) throw bridgeError(code);
      var token = canonicalText(value.token, 64, code);
      var expiresAt = canonicalText(value.expiresAt, 64, code);
      var expiresAtMillis = Date.parse(expiresAt);
      var width = value.output.width;
      var height = value.output.height;
      if (!/^[A-Za-z0-9_-]{43}$/u.test(token)
        || !Number.isFinite(expiresAtMillis)
        || new Date(expiresAtMillis).toISOString() !== expiresAt
        || expiresAtMillis <= issuedAtMillis
        || expiresAtMillis - issuedAtMillis > TICKET_TTL_MS + MAXIMUM_CLOCK_SKEW_MS
        || value.output.assetId !== binding.outputAssetId
        || value.output.mimeType !== 'image/png'
        || value.output.previewAvailable !== true
        || !Number.isSafeInteger(width) || width < 1 || width > MAX_DIMENSION
        || !Number.isSafeInteger(height) || height < 1 || height > MAX_DIMENSION
        || !Number.isSafeInteger(width * height) || width * height > MAX_PIXELS) {
        throw bridgeError(code);
      }
      return Object.freeze({
        token: token,
        expiresAt: expiresAt,
        expiresAtMillis: expiresAtMillis,
      });
    }

    function contentLength(response) {
      var raw = responseHeader(response, 'content-length');
      if (raw === null || !/^[1-9]\d{0,8}$/u.test(raw)) {
        throw bridgeError('SS_ERP_HOSTED_CANDIDATE_PREVIEW_RESPONSE_INVALID');
      }
      var length = Number(raw);
      if (!Number.isSafeInteger(length) || length < PNG_SIGNATURE.length
        || length > MAX_IMAGE_BYTES) {
        cancelResponseBody(response);
        throw bridgeError('SS_ERP_HOSTED_CANDIDATE_PREVIEW_RESPONSE_INVALID');
      }
      return length;
    }

    async function readBoundedBytes(response, declaredLength) {
      var body = response && response.body;
      if (body && typeof body.getReader === 'function') {
        var reader = body.getReader();
        var chunks = [];
        var total = 0;
        try {
          while (true) {
            var part = await reader.read();
            if (!part || part.done) break;
            if (!(part.value instanceof Uint8Array)) {
              try { await reader.cancel(); } catch {}
              throw bridgeError('SS_ERP_HOSTED_CANDIDATE_PREVIEW_RESPONSE_INVALID');
            }
            total += part.value.byteLength;
            if (!Number.isSafeInteger(total) || total > declaredLength
              || total > MAX_IMAGE_BYTES) {
              try { await reader.cancel(); } catch {}
              throw bridgeError('SS_ERP_HOSTED_CANDIDATE_PREVIEW_RESPONSE_INVALID');
            }
            chunks.push(part.value);
          }
        } finally {
          try {
            if (typeof reader.releaseLock === 'function') reader.releaseLock();
          } catch {}
        }
        if (total !== declaredLength) {
          throw bridgeError('SS_ERP_HOSTED_CANDIDATE_PREVIEW_RESPONSE_INVALID');
        }
        var merged = new Uint8Array(total);
        var offset = 0;
        chunks.forEach(function (chunk) {
          merged.set(chunk, offset);
          offset += chunk.byteLength;
        });
        return merged;
      }
      if (!response || typeof response.arrayBuffer !== 'function') {
        throw bridgeError('SS_ERP_HOSTED_CANDIDATE_PREVIEW_RESPONSE_INVALID');
      }
      var buffer = await response.arrayBuffer();
      if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== declaredLength
        || buffer.byteLength > MAX_IMAGE_BYTES) {
        throw bridgeError('SS_ERP_HOSTED_CANDIDATE_PREVIEW_RESPONSE_INVALID');
      }
      return new Uint8Array(buffer);
    }

    async function verifiedPreview(response) {
      if (!response || response.ok !== true || response.status !== 200
        || responseHeader(response, 'content-type') !== 'image/png') {
        cancelResponseBody(response);
        throw bridgeError('SS_ERP_HOSTED_CANDIDATE_PREVIEW_RESPONSE_INVALID');
      }
      var declaredLength = contentLength(response);
      var expectedSha256 = responseHeader(response, 'x-ss-erp-content-sha256');
      if (expectedSha256 !== null && !/^[a-f0-9]{64}$/u.test(expectedSha256)) {
        cancelResponseBody(response);
        throw bridgeError('SS_ERP_HOSTED_CANDIDATE_PREVIEW_RESPONSE_INVALID');
      }
      var bytes = await readBoundedBytes(response, declaredLength);
      if (!PNG_SIGNATURE.every(function (byte, index) { return bytes[index] === byte; })) {
        throw bridgeError('SS_ERP_HOSTED_CANDIDATE_PREVIEW_RESPONSE_INVALID');
      }
      var digestBuffer;
      try {
        digestBuffer = await cryptoImpl.subtle.digest(
          'SHA-256',
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        );
      } catch {
        throw bridgeError('SS_ERP_HOSTED_CANDIDATE_PREVIEW_RESPONSE_INVALID');
      }
      if (!(digestBuffer instanceof ArrayBuffer) || digestBuffer.byteLength !== 32) {
        throw bridgeError('SS_ERP_HOSTED_CANDIDATE_PREVIEW_RESPONSE_INVALID');
      }
      var sha256 = hexadecimal(digestBuffer);
      if (expectedSha256 !== null && sha256 !== expectedSha256) {
        throw bridgeError('SS_ERP_HOSTED_CANDIDATE_PREVIEW_RESPONSE_INVALID');
      }
      var blob = new BlobConstructor([bytes], { type: 'image/png' });
      if (blob.type !== 'image/png' || blob.size !== declaredLength) {
        throw bridgeError('SS_ERP_HOSTED_CANDIDATE_PREVIEW_RESPONSE_INVALID');
      }
      bytes = null;
      return Object.freeze({
        image: blob,
        metadata: Object.freeze({
          mimeType: 'image/png',
          byteLength: declaredLength,
          sha256: sha256,
        }),
      });
    }

    function rejectedMessage(row) {
      return Object.freeze({
        contractVersion: CONTRACT_VERSION,
        type: 'REJECTED',
        previewTicket: row.previewTicket,
        errorCode: 'SS_ERP_HOSTED_CANDIDATE_PREVIEW_REJECTED',
      });
    }

    async function handleReady(row, event) {
      var message = event && event.data;
      if (!exactKeys(message, ['type', 'previewTicket'])
        || message.type !== 'READY'
        || message.previewTicket !== row.previewTicket) {
        cancelRow(row);
        return;
      }
      var readyAt;
      try { readyAt = currentMillis(); } catch { cancelRow(row); return; }
      if (readyAt >= row.expiresAtMillis || !beginConsume(row)) {
        cancelRow(row);
        return;
      }
      var binding = row.binding;
      var token = row.erpToken;
      try {
        var response = await consumePreview(Object.freeze({
          binding: binding,
          token: token,
          maximumBytes: MAX_IMAGE_BYTES,
          signal: row.abortController.signal,
        }));
        if (row.cancelled || rows.get(row.channelName) !== row) {
          cancelResponseBody(response);
          return;
        }
        var preview = await verifiedPreview(response);
        if (row.cancelled || rows.get(row.channelName) !== row
          || currentMillis() >= row.expiresAtMillis) return;
        row.channel.postMessage(Object.freeze({
          contractVersion: CONTRACT_VERSION,
          type: 'PREVIEW',
          previewTicket: row.previewTicket,
          image: preview.image,
          metadata: preview.metadata,
        }));
      } catch {
        var canReject = false;
        try { canReject = currentMillis() < row.expiresAtMillis; } catch {}
        if (!row.cancelled && rows.get(row.channelName) === row
          && row.channel && canReject) {
          try { row.channel.postMessage(rejectedMessage(row)); } catch {}
        }
      } finally {
        finishRow(row);
      }
    }

    async function open(value) {
      var binding = normalizeBinding(value);
      if (rows.size >= MAX_PENDING_CHANNELS) {
        throw bridgeError('SS_ERP_HOSTED_CANDIDATE_PREVIEW_CHANNEL_LIMIT');
      }
      var issued;
      try {
        issued = await issuePreview(Object.freeze({ binding: binding }));
      } catch {
        throw bridgeError('SS_ERP_HOSTED_CANDIDATE_PREVIEW_ISSUE_FAILED');
      }
      var issuedAtMillis = currentMillis();
      var normalizedIssue = normalizeIssue(issued, binding, issuedAtMillis);
      if (rows.size >= MAX_PENDING_CHANNELS) {
        throw bridgeError('SS_ERP_HOSTED_CANDIDATE_PREVIEW_CHANNEL_LIMIT');
      }
      var suffix = randomHex(randomValues);
      var channelName = 'ss-erp:hosted-candidate-preview:' + suffix;
      if (rows.has(channelName)) {
        throw bridgeError('SS_ERP_HOSTED_CANDIDATE_PREVIEW_CHANNEL_COLLISION');
      }
      var previewTicket = 'hp_' + randomHex(randomValues);
      var channel;
      try { channel = new Channel(channelName); } catch {
        throw bridgeError('SS_ERP_HOSTED_CANDIDATE_PREVIEW_DEPENDENCY_UNAVAILABLE');
      }
      var row = {
        channelName: channelName,
        channel: channel,
        previewTicket: previewTicket,
        binding: binding,
        bindingKey: bindingKey(binding),
        erpToken: normalizedIssue.token,
        expiresAtMillis: normalizedIssue.expiresAtMillis,
        abortController: new AbortControllerConstructor(),
        timer: null,
        state: 'PENDING',
        cancelled: false,
      };
      rows.set(channelName, row);
      try {
        row.timer = setTimer(function () { cancelRow(row); }, Math.max(
          1,
          normalizedIssue.expiresAtMillis - issuedAtMillis,
        ));
      } catch {
        cancelRow(row);
        throw bridgeError('SS_ERP_HOSTED_CANDIDATE_PREVIEW_DEPENDENCY_UNAVAILABLE');
      }
      channel.onmessage = function (event) { void handleReady(row, event); };
      return Object.freeze({
        contractVersion: CONTRACT_VERSION,
        channelName: channelName,
        previewTicket: previewTicket,
        expiresAt: normalizedIssue.expiresAt,
        metadata: Object.freeze({
          mimeType: 'image/png',
          byteLength: null,
        }),
      });
    }

    function revoke(value) {
      var normalized = normalizeBinding(value);
      var key = bindingKey(normalized);
      var revoked = 0;
      Array.from(rows.values()).forEach(function (row) {
        if (row.bindingKey === key && cancelRow(row)) revoked += 1;
      });
      return revoked;
    }

    function clear() {
      var cleared = 0;
      Array.from(rows.values()).forEach(function (row) {
        if (cancelRow(row)) cleared += 1;
      });
      return cleared;
    }

    return Object.freeze({
      open: open,
      revoke: revoke,
      clear: clear,
      pendingSize: function () { return rows.size; },
    });
  }

  global.SS_ERP_HOSTED_AI_IMAGE_SUITE_CANDIDATE_PREVIEW_BRIDGE = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    SERVER_CONTRACT_VERSION: SERVER_CONTRACT_VERSION,
    LIMITS: Object.freeze({
      ticketTtlMs: TICKET_TTL_MS,
      maximumClockSkewMs: MAXIMUM_CLOCK_SKEW_MS,
      maxImageBytes: MAX_IMAGE_BYTES,
      maxPendingChannels: MAX_PENDING_CHANNELS,
    }),
    createBridge: createBridge,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
