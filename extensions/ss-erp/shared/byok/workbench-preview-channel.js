(function exposeByokWorkbenchPreviewChannel(global) {
  'use strict';

  var CONTRACT_VERSION = 'extension-byok-workbench-preview-channel/v1';
  var DEFAULT_TTL_MS = 15 * 1000;
  var MAX_TTL_MS = 30 * 1000;
  var MAX_CHANNELS = 8;
  var MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

  function previewError(code) {
    var error = new Error(code);
    error.code = code;
    return error;
  }

  function exactText(value, maximum) {
    if (typeof value !== 'string' || !value || value.length > maximum
      || value !== value.normalize('NFKC').trim()
      || /[\u0000-\u001f\u007f]/u.test(value)) {
      throw previewError('SS_ERP_BYOK_WORKBENCH_PREVIEW_INVALID');
    }
    return value;
  }

  function randomHex(randomValues) {
    var bytes = new Uint8Array(24);
    randomValues(bytes);
    return Array.from(bytes).map(function (byte) {
      return byte.toString(16).padStart(2, '0');
    }).join('');
  }

  function normalizeEntry(value) {
    if (!value || typeof value !== 'object'
      || !['CANDIDATE_READY', 'APPROVED'].includes(value.reviewState)
      || typeof Blob === 'undefined' || !(value.blob instanceof Blob)) {
      throw previewError('SS_ERP_BYOK_WORKBENCH_PREVIEW_INVALID');
    }
    var resultId = exactText(value.resultId, 128);
    var mimeType = exactText(value.mimeType, 32).toLowerCase();
    var sha256 = exactText(value.sha256, 64);
    if (!/^br_[a-f0-9]{48}$/u.test(resultId)
      || !MIME_TYPES.includes(mimeType)
      || !/^[a-f0-9]{64}$/u.test(sha256)
      || !Number.isSafeInteger(value.byteLength)
      || value.byteLength < 1 || value.byteLength > 20 * 1024 * 1024
      || value.blob.type !== mimeType || value.blob.size !== value.byteLength) {
      throw previewError('SS_ERP_BYOK_WORKBENCH_PREVIEW_INVALID');
    }
    return {
      resultId: resultId,
      blob: value.blob,
      mimeType: mimeType,
      byteLength: value.byteLength,
      sha256: sha256,
    };
  }

  function createBroker(options) {
    var Channel = options && options.BroadcastChannel || global.BroadcastChannel;
    var now = options && typeof options.now === 'function' ? options.now : function () { return new Date(); };
    var randomValues = options && options.randomValues
      || function (bytes) { return global.crypto.getRandomValues(bytes); };
    var setTimer = options && options.setTimeout || global.setTimeout;
    var clearTimer = options && options.clearTimeout || global.clearTimeout;
    var ttlMs = Number(options && options.ttlMs) || DEFAULT_TTL_MS;
    if (typeof Channel !== 'function' || typeof randomValues !== 'function'
      || typeof setTimer !== 'function' || typeof clearTimer !== 'function'
      || !Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > MAX_TTL_MS) {
      throw previewError('SS_ERP_BYOK_WORKBENCH_PREVIEW_UNAVAILABLE');
    }
    var channels = new Map();

    function currentMillis() {
      var value = new Date(now()).getTime();
      if (!Number.isFinite(value)) throw previewError('SS_ERP_BYOK_WORKBENCH_PREVIEW_INVALID');
      return value;
    }

    function finish(channelName) {
      var row = channels.get(channelName);
      if (!row) return false;
      channels.delete(channelName);
      clearTimer(row.timer);
      try { row.channel.close(); } catch (_error) {}
      row.entry.blob = null;
      return true;
    }

    function open(value) {
      var entry = normalizeEntry(value);
      while (channels.size >= MAX_CHANNELS) finish(channels.keys().next().value);
      var suffix = randomHex(randomValues);
      var channelName = 'ss-erp:byok-preview:' + suffix;
      if (channels.has(channelName)) {
        throw previewError('SS_ERP_BYOK_WORKBENCH_PREVIEW_COLLISION');
      }
      var previewTicket = 'pt_' + randomHex(randomValues);
      var channel = new Channel(channelName);
      var expiresAtMillis = currentMillis() + ttlMs;
      var row = {
        channel: channel,
        entry: entry,
        previewTicket: previewTicket,
        timer: null,
      };
      channels.set(channelName, row);
      row.timer = setTimer(function () { finish(channelName); }, ttlMs);
      channel.onmessage = function (event) {
        var message = event && event.data;
        if (!message || typeof message !== 'object' || Array.isArray(message)
          || Object.keys(message).length !== 2
          || message.type !== 'READY'
          || message.previewTicket !== previewTicket) {
          finish(channelName);
          return;
        }
        try {
          channel.postMessage({
            contractVersion: CONTRACT_VERSION,
            type: 'PREVIEW',
            previewTicket: previewTicket,
            image: entry.blob,
            metadata: {
              mimeType: entry.mimeType,
              byteLength: entry.byteLength,
              sha256: entry.sha256,
            },
          });
        } finally {
          finish(channelName);
        }
      };
      return Object.freeze({
        contractVersion: CONTRACT_VERSION,
        channelName: channelName,
        previewTicket: previewTicket,
        expiresAt: new Date(expiresAtMillis).toISOString(),
        metadata: Object.freeze({
          mimeType: entry.mimeType,
          byteLength: entry.byteLength,
          sha256: entry.sha256,
        }),
      });
    }

    function clear() {
      Array.from(channels.keys()).forEach(finish);
    }

    function releaseResult(resultIdValue) {
      var resultId = exactText(resultIdValue, 128);
      if (!/^br_[a-f0-9]{48}$/u.test(resultId)) {
        throw previewError('SS_ERP_BYOK_WORKBENCH_PREVIEW_INVALID');
      }
      var released = 0;
      Array.from(channels.entries()).forEach(function (pair) {
        if (pair[1].entry.resultId === resultId && finish(pair[0])) released += 1;
      });
      return released;
    }

    return Object.freeze({
      open: open,
      releaseResult: releaseResult,
      clear: clear,
      size: function () { return channels.size; },
    });
  }

  global.SS_ERP_BYOK_WORKBENCH_PREVIEW_CHANNEL = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    DEFAULT_TTL_MS: DEFAULT_TTL_MS,
    createBroker: createBroker,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
