(function exposeHostedAiImageSuiteCandidatePreviewConsumer(global) {
  'use strict';

  var CONTRACT_VERSION = 'extension-hosted-ai-image-suite-candidate-preview-channel/v1';
  var TICKET_TTL_MS = 30 * 1000;
  var MAX_IMAGE_BYTES = 20 * 1024 * 1024;
  var PNG_SIGNATURE = Object.freeze([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  function consumerError(code) {
    var error = new Error(code);
    error.name = 'ExtensionHostedAiImageSuiteCandidatePreviewConsumerError';
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

  function hexadecimal(buffer) {
    return Array.from(new Uint8Array(buffer)).map(function (byte) {
      return byte.toString(16).padStart(2, '0');
    }).join('');
  }

  function createConsumer(options) {
    var Channel = options && options.BroadcastChannel || global.BroadcastChannel;
    var BlobConstructor = options && options.Blob || global.Blob;
    var cryptoImpl = options && options.crypto || global.crypto;
    var urlApi = options && options.URL || global.URL;
    var eventTarget = options && options.eventTarget || global;
    var now = options && typeof options.now === 'function'
      ? options.now
      : function () { return new Date(); };
    var setTimer = options && options.setTimeout || global.setTimeout;
    var clearTimer = options && options.clearTimeout || global.clearTimeout;

    if (typeof Channel !== 'function'
      || typeof BlobConstructor !== 'function'
      || !cryptoImpl || !cryptoImpl.subtle || typeof cryptoImpl.subtle.digest !== 'function'
      || !urlApi || typeof urlApi.createObjectURL !== 'function'
      || typeof urlApi.revokeObjectURL !== 'function'
      || !eventTarget || typeof eventTarget.addEventListener !== 'function'
      || typeof eventTarget.removeEventListener !== 'function'
      || typeof setTimer !== 'function'
      || typeof clearTimer !== 'function') {
      throw consumerError('SS_ERP_HOSTED_CANDIDATE_PREVIEW_DEPENDENCY_UNAVAILABLE');
    }

    var rows = new Set();
    var resources = new Set();
    var disposed = false;

    function currentMillis(code) {
      var value = new Date(now()).getTime();
      if (!Number.isFinite(value)) throw consumerError(code);
      return value;
    }

    function normalizeTicket(value) {
      var code = 'SS_ERP_HOSTED_CANDIDATE_PREVIEW_TICKET_INVALID';
      if (!exactKeys(value, [
        'contractVersion', 'channelName', 'previewTicket', 'expiresAt', 'metadata',
      ])
        || value.contractVersion !== CONTRACT_VERSION
        || !/^ss-erp:hosted-candidate-preview:[a-f0-9]{48}$/u.test(value.channelName)
        || !/^hp_[a-f0-9]{48}$/u.test(value.previewTicket)
        || typeof value.expiresAt !== 'string'
        || !exactKeys(value.metadata, ['mimeType', 'byteLength'])
        || value.metadata.mimeType !== 'image/png'
        || value.metadata.byteLength !== null) {
        throw consumerError(code);
      }
      var expiresAtMillis = Date.parse(value.expiresAt);
      var issuedAtMillis = currentMillis(code);
      if (!Number.isFinite(expiresAtMillis)
        || new Date(expiresAtMillis).toISOString() !== value.expiresAt
        || expiresAtMillis <= issuedAtMillis
        || expiresAtMillis - issuedAtMillis > TICKET_TTL_MS) {
        throw consumerError(code);
      }
      return Object.freeze({
        channelName: value.channelName,
        previewTicket: value.previewTicket,
        expiresAtMillis: expiresAtMillis,
      });
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
      rows.delete(row);
    }

    function rejectRow(row, error) {
      if (!row || row.settled) return false;
      row.settled = true;
      closeRow(row);
      row.reject(error);
      return true;
    }

    function resolveRow(row, value) {
      if (!row || row.settled) return false;
      row.settled = true;
      closeRow(row);
      row.resolve(value);
      return true;
    }

    function revokeResource(resource) {
      if (!resource || resource.revoked) return false;
      resource.revoked = true;
      resources.delete(resource);
      try { urlApi.revokeObjectURL(resource.objectUrl); } catch {}
      return true;
    }

    function invalidMessage() {
      return consumerError('SS_ERP_HOSTED_CANDIDATE_PREVIEW_MESSAGE_INVALID');
    }

    function normalizePreviewMessage(message, row) {
      if (!exactKeys(message, [
        'contractVersion', 'type', 'previewTicket', 'image', 'metadata',
      ])
        || message.contractVersion !== CONTRACT_VERSION
        || message.type !== 'PREVIEW'
        || message.previewTicket !== row.previewTicket
        || !exactKeys(message.metadata, ['mimeType', 'byteLength', 'sha256'])
        || message.metadata.mimeType !== 'image/png'
        || !Number.isSafeInteger(message.metadata.byteLength)
        || message.metadata.byteLength < PNG_SIGNATURE.length
        || message.metadata.byteLength > MAX_IMAGE_BYTES
        || typeof message.metadata.sha256 !== 'string'
        || !/^[a-f0-9]{64}$/u.test(message.metadata.sha256)
        || !(message.image instanceof BlobConstructor)
        || message.image.type !== 'image/png'
        || message.image.size !== message.metadata.byteLength
        || typeof message.image.arrayBuffer !== 'function') {
        throw invalidMessage();
      }
      return Object.freeze({
        image: message.image,
        metadata: Object.freeze({
          mimeType: 'image/png',
          byteLength: message.metadata.byteLength,
          sha256: message.metadata.sha256,
        }),
      });
    }

    function rejectedError(message, row) {
      if (!exactKeys(message, [
        'contractVersion', 'type', 'previewTicket', 'errorCode',
      ])
        || message.contractVersion !== CONTRACT_VERSION
        || message.type !== 'REJECTED'
        || message.previewTicket !== row.previewTicket
        || message.errorCode !== 'SS_ERP_HOSTED_CANDIDATE_PREVIEW_REJECTED') {
        throw invalidMessage();
      }
      return consumerError(message.errorCode);
    }

    async function verifyPreview(preview) {
      var buffer;
      try { buffer = await preview.image.arrayBuffer(); } catch { throw invalidMessage(); }
      if (!(buffer instanceof ArrayBuffer)
        || buffer.byteLength !== preview.metadata.byteLength
        || !PNG_SIGNATURE.every(function (byte, index) {
          return new Uint8Array(buffer, 0, PNG_SIGNATURE.length)[index] === byte;
        })) {
        throw invalidMessage();
      }
      var digest;
      try { digest = await cryptoImpl.subtle.digest('SHA-256', buffer); } catch {
        throw invalidMessage();
      }
      if (!(digest instanceof ArrayBuffer)
        || digest.byteLength !== 32
        || hexadecimal(digest) !== preview.metadata.sha256) {
        throw invalidMessage();
      }
      return preview;
    }

    async function handleMessage(row, event) {
      if (!row || row.settled || row.receiving) return;
      row.receiving = true;
      if (row.channel) row.channel.onmessage = null;
      try {
        if (currentMillis('SS_ERP_HOSTED_CANDIDATE_PREVIEW_MESSAGE_INVALID')
          >= row.expiresAtMillis) {
          rejectRow(row, consumerError('SS_ERP_HOSTED_CANDIDATE_PREVIEW_TIMEOUT'));
          return;
        }
        var message = event && event.data;
        if (isRecord(message) && message.type === 'REJECTED') {
          rejectRow(row, rejectedError(message, row));
          return;
        }
        var preview = normalizePreviewMessage(message, row);
        await verifyPreview(preview);
        if (row.settled) return;
        if (currentMillis('SS_ERP_HOSTED_CANDIDATE_PREVIEW_MESSAGE_INVALID')
          >= row.expiresAtMillis) {
          rejectRow(row, consumerError('SS_ERP_HOSTED_CANDIDATE_PREVIEW_TIMEOUT'));
          return;
        }
        var objectUrl;
        try { objectUrl = urlApi.createObjectURL(preview.image); } catch {
          throw invalidMessage();
        }
        if (typeof objectUrl !== 'string' || !objectUrl.startsWith('blob:')) {
          try { urlApi.revokeObjectURL(objectUrl); } catch {}
          throw invalidMessage();
        }
        var resource = {
          objectUrl: objectUrl,
          revoked: false,
        };
        resources.add(resource);
        resolveRow(row, Object.freeze({
          objectUrl: objectUrl,
          metadata: preview.metadata,
          revoke: function () { revokeResource(resource); },
        }));
      } catch (error) {
        if (!row.settled) {
          rejectRow(
            row,
            error && error.name === 'ExtensionHostedAiImageSuiteCandidatePreviewConsumerError'
              ? error
              : invalidMessage(),
          );
        }
      }
    }

    function consume(value) {
      if (disposed) {
        return Promise.reject(
          consumerError('SS_ERP_HOSTED_CANDIDATE_PREVIEW_CONSUMER_CLOSED'),
        );
      }
      var ticket;
      try { ticket = normalizeTicket(value); } catch (error) { return Promise.reject(error); }
      return new Promise(function (resolve, reject) {
        var channel;
        try { channel = new Channel(ticket.channelName); } catch {
          reject(consumerError('SS_ERP_HOSTED_CANDIDATE_PREVIEW_DEPENDENCY_UNAVAILABLE'));
          return;
        }
        var row = {
          channel: channel,
          previewTicket: ticket.previewTicket,
          expiresAtMillis: ticket.expiresAtMillis,
          timer: null,
          receiving: false,
          settled: false,
          resolve: resolve,
          reject: reject,
        };
        rows.add(row);
        channel.onmessage = function (event) { void handleMessage(row, event); };
        try {
          row.timer = setTimer(function () {
            rejectRow(row, consumerError('SS_ERP_HOSTED_CANDIDATE_PREVIEW_TIMEOUT'));
          }, Math.max(1, ticket.expiresAtMillis - currentMillis(
            'SS_ERP_HOSTED_CANDIDATE_PREVIEW_TICKET_INVALID',
          )));
          channel.postMessage(Object.freeze({
            type: 'READY',
            previewTicket: ticket.previewTicket,
          }));
        } catch {
          rejectRow(
            row,
            consumerError('SS_ERP_HOSTED_CANDIDATE_PREVIEW_DEPENDENCY_UNAVAILABLE'),
          );
        }
      });
    }

    function dispose() {
      if (disposed) return false;
      disposed = true;
      try { eventTarget.removeEventListener('pagehide', dispose); } catch {}
      Array.from(rows).forEach(function (row) {
        rejectRow(row, consumerError('SS_ERP_HOSTED_CANDIDATE_PREVIEW_CONSUMER_CLOSED'));
      });
      Array.from(resources).forEach(revokeResource);
      return true;
    }

    try { eventTarget.addEventListener('pagehide', dispose); } catch {
      throw consumerError('SS_ERP_HOSTED_CANDIDATE_PREVIEW_DEPENDENCY_UNAVAILABLE');
    }

    return Object.freeze({
      consume: consume,
      dispose: dispose,
      pendingSize: function () { return rows.size; },
    });
  }

  global.SS_ERP_HOSTED_AI_IMAGE_SUITE_CANDIDATE_PREVIEW_CONSUMER = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    LIMITS: Object.freeze({
      ticketTtlMs: TICKET_TTL_MS,
      maxImageBytes: MAX_IMAGE_BYTES,
    }),
    createConsumer: createConsumer,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
