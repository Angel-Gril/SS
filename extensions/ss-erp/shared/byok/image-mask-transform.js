(function exposeByokImageMaskTransform(global) {
  'use strict';

  var INTERNAL_MASK_SEMANTICS = 'WHITE_EDIT_BLACK_PRESERVE_V1';
  var OPENAI_MASK_SEMANTICS = 'TRANSPARENT_EDIT_OPAQUE_PRESERVE_V1';
  var MAX_DIMENSION = 4096;
  var MAX_PIXELS = MAX_DIMENSION * MAX_DIMENSION;
  var MAX_MASK_BYTES = 20 * 1024 * 1024;
  var YIELD_INTERVAL = 256 * 1024;

  function transformError(code, message) {
    var error = new Error(message || code);
    error.name = 'ExtensionByokImageMaskTransformError';
    error.code = code;
    return error;
  }

  function positiveDimension(value) {
    return Number.isSafeInteger(value) && value > 0 && value <= MAX_DIMENSION ? value : 0;
  }

  function createTransformer(options) {
    var createImageBitmap = options && options.createImageBitmap;
    var OffscreenCanvas = options && options.OffscreenCanvas;
    if (typeof createImageBitmap !== 'function') {
      throw new TypeError('createImageBitmap is required');
    }
    if (typeof OffscreenCanvas !== 'function') {
      throw new TypeError('OffscreenCanvas is required');
    }

    async function toOpenAiMask(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input)
        || Object.keys(input).some(function (key) {
          return !['blob', 'width', 'height', 'maskSemantics'].includes(key);
        })) {
        throw transformError('SS_ERP_BYOK_PROVIDER_MASK_INVALID', 'Mask input is invalid');
      }
      if (!(input.blob instanceof Blob) || input.blob.type !== 'image/png'
        || input.blob.size < 1 || input.blob.size > MAX_MASK_BYTES) {
        throw transformError('SS_ERP_BYOK_PROVIDER_MASK_INVALID', 'Mask must be a bounded PNG Blob');
      }
      if (input.maskSemantics !== INTERNAL_MASK_SEMANTICS) {
        throw transformError(
          'SS_ERP_BYOK_PROVIDER_MASK_SEMANTICS_INVALID',
          'Mask semantics are not supported by the OpenAI edit adapter',
        );
      }
      var width = positiveDimension(input.width);
      var height = positiveDimension(input.height);
      if (!width || !height || !Number.isSafeInteger(width * height)
        || width * height > MAX_PIXELS) {
        throw transformError('SS_ERP_BYOK_PROVIDER_MASK_INVALID', 'Mask dimensions are invalid');
      }

      var bitmap;
      try {
        bitmap = await createImageBitmap(input.blob);
      } catch {
        throw transformError('SS_ERP_BYOK_PROVIDER_MASK_DECODE_FAILED', 'Mask PNG could not be decoded');
      }
      try {
        if (!bitmap || bitmap.width !== width || bitmap.height !== height) {
          throw transformError(
            'SS_ERP_BYOK_PROVIDER_SOURCE_MASK_DIMENSIONS_MISMATCH',
            'Mask dimensions do not match the source image',
          );
        }
        var canvas = new OffscreenCanvas(width, height);
        var context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context || typeof context.drawImage !== 'function'
          || typeof context.getImageData !== 'function'
          || typeof context.putImageData !== 'function'
          || typeof canvas.convertToBlob !== 'function') {
          throw transformError(
            'SS_ERP_BYOK_PROVIDER_MASK_ENCODE_FAILED',
            'Browser mask conversion is unavailable',
          );
        }
        context.drawImage(bitmap, 0, 0);
        var imageData = context.getImageData(0, 0, width, height);
        if (!imageData || !(imageData.data instanceof Uint8ClampedArray)
          || imageData.data.length !== width * height * 4) {
          throw transformError(
            'SS_ERP_BYOK_PROVIDER_MASK_DECODE_FAILED',
            'Mask pixel data is invalid',
          );
        }
        for (var pixel = 0; pixel < width * height; pixel += 1) {
          var offset = pixel * 4;
          var editWeight = imageData.data[offset];
          imageData.data[offset] = 255;
          imageData.data[offset + 1] = 255;
          imageData.data[offset + 2] = 255;
          imageData.data[offset + 3] = 255 - editWeight;
          if ((pixel + 1) % YIELD_INTERVAL === 0) await Promise.resolve();
        }
        context.putImageData(imageData, 0, 0);
        var encoded;
        try {
          encoded = await canvas.convertToBlob({ type: 'image/png' });
        } catch {
          throw transformError(
            'SS_ERP_BYOK_PROVIDER_MASK_ENCODE_FAILED',
            'OpenAI mask PNG could not be encoded',
          );
        }
        if (!(encoded instanceof Blob) || encoded.type !== 'image/png'
          || encoded.size < 1 || encoded.size > MAX_MASK_BYTES) {
          throw transformError(
            'SS_ERP_BYOK_PROVIDER_MASK_ENCODE_FAILED',
            'OpenAI mask PNG is invalid',
          );
        }
        return {
          blob: encoded,
          width: width,
          height: height,
          maskSemantics: OPENAI_MASK_SEMANTICS,
        };
      } finally {
        if (bitmap && typeof bitmap.close === 'function') bitmap.close();
      }
    }

    return Object.freeze({ toOpenAiMask: toOpenAiMask });
  }

  global.SS_ERP_BYOK_IMAGE_MASK_TRANSFORM = Object.freeze({
    INTERNAL_MASK_SEMANTICS: INTERNAL_MASK_SEMANTICS,
    OPENAI_MASK_SEMANTICS: OPENAI_MASK_SEMANTICS,
    createTransformer: createTransformer,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
