(function exposeByokImageEditProbeMedia(global) {
  'use strict';

  var OPERATIONS = Object.freeze(['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT']);
  var MASK_SEMANTICS = 'WHITE_EDIT_BLACK_PRESERVE_V1';
  var PROBE_SIZE = 64;
  var MAX_PROBE_BYTES = 1024 * 1024;

  function probeError(code, message) {
    var error = new Error(message || code);
    error.name = 'ExtensionByokImageEditProbeMediaError';
    error.code = code;
    return error;
  }

  function createFactory(options) {
    var OffscreenCanvas = options && options.OffscreenCanvas;
    if (typeof OffscreenCanvas !== 'function') throw new TypeError('OffscreenCanvas is required');

    async function encodeCanvas(draw) {
      var canvas = new OffscreenCanvas(PROBE_SIZE, PROBE_SIZE);
      var context = canvas.getContext('2d');
      if (!context || typeof context.fillRect !== 'function'
        || typeof canvas.convertToBlob !== 'function') {
        throw probeError(
          'SS_ERP_BYOK_IMAGE_EDIT_PROBE_MEDIA_UNAVAILABLE',
          'Synthetic Provider probe media is unavailable',
        );
      }
      draw(context);
      var blob;
      try { blob = await canvas.convertToBlob({ type: 'image/png' }); } catch {
        throw probeError(
          'SS_ERP_BYOK_IMAGE_EDIT_PROBE_MEDIA_UNAVAILABLE',
          'Synthetic Provider probe media could not be encoded',
        );
      }
      if (!(blob instanceof Blob) || blob.type !== 'image/png'
        || blob.size < 1 || blob.size > MAX_PROBE_BYTES) {
        throw probeError(
          'SS_ERP_BYOK_IMAGE_EDIT_PROBE_MEDIA_UNAVAILABLE',
          'Synthetic Provider probe media is invalid',
        );
      }
      return blob;
    }

    async function create(operation) {
      if (!OPERATIONS.includes(operation)) throw probeError(
        'SS_ERP_BYOK_IMAGE_EDIT_PROBE_MEDIA_INVALID',
        'Image edit probe operation is invalid',
      );
      var source = await encodeCanvas(function (context) {
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, PROBE_SIZE, PROBE_SIZE);
        context.fillStyle = '#64748b';
        context.fillRect(16, 12, 32, 40);
        context.fillStyle = '#0f172a';
        context.fillRect(24, 20, 16, 24);
      });
      var mask = null;
      if (operation === 'INPAINT') {
        var maskBlob = await encodeCanvas(function (context) {
          context.fillStyle = '#000000';
          context.fillRect(0, 0, PROBE_SIZE, PROBE_SIZE);
          context.fillStyle = '#ffffff';
          context.fillRect(16, 16, 32, 32);
        });
        mask = { blob: maskBlob, maskSemantics: MASK_SEMANTICS };
      }
      return { images: [source], mask: mask };
    }

    return Object.freeze({ create: create });
  }

  global.SS_ERP_BYOK_IMAGE_EDIT_PROBE_MEDIA = Object.freeze({
    MASK_SEMANTICS: MASK_SEMANTICS,
    createFactory: createFactory,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
