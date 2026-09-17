(function exposeByokImageInputInspector(global) {
  'use strict';

  var CONTRACT_VERSION = 'extension-byok-image-input-inspector/v1';
  var MIME_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp']);
  var DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
  var DEFAULT_MAX_DIMENSION = 4096;
  var DEFAULT_MAX_PIXELS = DEFAULT_MAX_DIMENSION * DEFAULT_MAX_DIMENSION;
  var INSPECTION_KEYS = Object.freeze([
    'contractVersion', 'mimeType', 'byteLength', 'width', 'height', 'animated',
    'decodeVerified',
  ]);
  var JPEG_START_OF_FRAME_MARKERS = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);

  function ImageInputError(code, message) {
    this.name = 'ExtensionByokImageInputError';
    this.code = code;
    this.message = message || code;
    if (Error.captureStackTrace) Error.captureStackTrace(this, ImageInputError);
  }
  ImageInputError.prototype = Object.create(Error.prototype);
  ImageInputError.prototype.constructor = ImageInputError;

  function fail(code, message) {
    throw new ImageInputError(code, message);
  }

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function positiveInteger(value) {
    return Number.isSafeInteger(value) && value > 0 ? value : 0;
  }

  function boundedLimit(value, fallback, hardMaximum, label) {
    if (value === undefined) return fallback;
    if (!positiveInteger(value) || value > hardMaximum) {
      fail('SS_ERP_BYOK_IMAGE_INSPECTOR_INPUT_INVALID', label + ' is invalid');
    }
    return value;
  }

  function normalizedMime(value) {
    var mimeType = String(value || '').trim().toLowerCase();
    return mimeType === 'image/jpg' ? 'image/jpeg' : mimeType;
  }

  function normalizedAllowedMimeTypes(value) {
    if (value === undefined) return MIME_TYPES.slice();
    if (!Array.isArray(value) || value.length < 1 || value.length > MIME_TYPES.length) {
      fail('SS_ERP_BYOK_IMAGE_INSPECTOR_INPUT_INVALID', 'allowedMimeTypes is invalid');
    }
    var result = value.map(normalizedMime);
    if (new Set(result).size !== result.length
      || result.some(function (mimeType) { return !MIME_TYPES.includes(mimeType); })) {
      fail('SS_ERP_BYOK_IMAGE_INSPECTOR_INPUT_INVALID', 'allowedMimeTypes is invalid');
    }
    return result;
  }

  function bytesEqual(bytes, offset, expected) {
    if (offset < 0 || offset + expected.length > bytes.length) return false;
    for (var index = 0; index < expected.length; index += 1) {
      if (bytes[offset + index] !== expected[index]) return false;
    }
    return true;
  }

  function ascii(bytes, offset, length) {
    if (offset < 0 || offset + length > bytes.length) return '';
    var value = '';
    for (var index = 0; index < length; index += 1) {
      value += String.fromCharCode(bytes[offset + index]);
    }
    return value;
  }

  function uint16be(bytes, offset) {
    if (offset < 0 || offset + 2 > bytes.length) {
      fail('SS_ERP_BYOK_IMAGE_FORMAT_INVALID', 'Image container is truncated');
    }
    return bytes[offset] * 0x100 + bytes[offset + 1];
  }

  function uint32be(bytes, offset) {
    if (offset < 0 || offset + 4 > bytes.length) {
      fail('SS_ERP_BYOK_IMAGE_FORMAT_INVALID', 'Image container is truncated');
    }
    return (
      bytes[offset] * 0x1000000
      + bytes[offset + 1] * 0x10000
      + bytes[offset + 2] * 0x100
      + bytes[offset + 3]
    );
  }

  function uint32le(bytes, offset) {
    if (offset < 0 || offset + 4 > bytes.length) {
      fail('SS_ERP_BYOK_IMAGE_FORMAT_INVALID', 'Image container is truncated');
    }
    return (
      bytes[offset]
      + bytes[offset + 1] * 0x100
      + bytes[offset + 2] * 0x10000
      + bytes[offset + 3] * 0x1000000
    );
  }

  function uint24le(bytes, offset) {
    if (offset < 0 || offset + 3 > bytes.length) {
      fail('SS_ERP_BYOK_IMAGE_FORMAT_INVALID', 'Image container is truncated');
    }
    return bytes[offset] + bytes[offset + 1] * 0x100 + bytes[offset + 2] * 0x10000;
  }

  function parsePng(bytes) {
    var signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (!bytesEqual(bytes, 0, signature)) return null;
    var offset = 8;
    var width = 0;
    var height = 0;
    var animated = false;
    var sawHeader = false;
    var sawImageData = false;
    var sawEnd = false;
    while (offset < bytes.length) {
      if (offset + 12 > bytes.length) {
        fail('SS_ERP_BYOK_IMAGE_FORMAT_INVALID', 'PNG container is truncated');
      }
      var length = uint32be(bytes, offset);
      var type = ascii(bytes, offset + 4, 4);
      var dataStart = offset + 8;
      var dataEnd = dataStart + length;
      var nextOffset = dataEnd + 4;
      if (dataEnd < dataStart || nextOffset > bytes.length) {
        fail('SS_ERP_BYOK_IMAGE_FORMAT_INVALID', 'PNG chunk length is invalid');
      }
      if (!sawHeader) {
        if (type !== 'IHDR' || length !== 13) {
          fail('SS_ERP_BYOK_IMAGE_FORMAT_INVALID', 'PNG IHDR is invalid');
        }
        width = uint32be(bytes, dataStart);
        height = uint32be(bytes, dataStart + 4);
        sawHeader = true;
      } else if (type === 'IHDR') {
        fail('SS_ERP_BYOK_IMAGE_FORMAT_INVALID', 'PNG contains multiple IHDR chunks');
      }
      if (type === 'acTL' || type === 'fcTL' || type === 'fdAT') animated = true;
      if (type === 'IDAT') sawImageData = true;
      if (type === 'IEND') {
        if (length !== 0) fail('SS_ERP_BYOK_IMAGE_FORMAT_INVALID', 'PNG IEND is invalid');
        sawEnd = true;
        offset = nextOffset;
        break;
      }
      offset = nextOffset;
    }
    if (!sawHeader || !sawImageData || !sawEnd) {
      fail('SS_ERP_BYOK_IMAGE_FORMAT_INVALID', 'PNG container is incomplete');
    }
    return { mimeType: 'image/png', width: width, height: height, animated: animated };
  }

  function parseJpeg(bytes) {
    if (!bytesEqual(bytes, 0, [0xff, 0xd8])) return null;
    var offset = 2;
    while (offset < bytes.length) {
      while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
      if (offset >= bytes.length) break;
      var marker = bytes[offset];
      offset += 1;
      if (marker === 0xd9) break;
      if (marker === 0x00 || marker === 0x01
        || (marker >= 0xd0 && marker <= 0xd8)) continue;
      if (offset + 2 > bytes.length) {
        fail('SS_ERP_BYOK_IMAGE_FORMAT_INVALID', 'JPEG segment is truncated');
      }
      var length = uint16be(bytes, offset);
      var segmentEnd = offset + length;
      if (length < 2 || segmentEnd < offset || segmentEnd > bytes.length) {
        fail('SS_ERP_BYOK_IMAGE_FORMAT_INVALID', 'JPEG segment length is invalid');
      }
      if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
        if (length < 8) fail('SS_ERP_BYOK_IMAGE_FORMAT_INVALID', 'JPEG SOF is invalid');
        return {
          mimeType: 'image/jpeg',
          width: uint16be(bytes, offset + 5),
          height: uint16be(bytes, offset + 3),
          animated: false,
        };
      }
      if (marker === 0xda) break;
      offset = segmentEnd;
    }
    fail('SS_ERP_BYOK_IMAGE_FORMAT_INVALID', 'JPEG dimensions were not found');
  }

  function webpDimensions(type, bytes, dataStart, length) {
    if (type === 'VP8X') {
      if (length < 10) fail('SS_ERP_BYOK_IMAGE_FORMAT_INVALID', 'WebP VP8X is invalid');
      return {
        width: uint24le(bytes, dataStart + 4) + 1,
        height: uint24le(bytes, dataStart + 7) + 1,
      };
    }
    if (type === 'VP8 ') {
      if (length < 10 || !bytesEqual(bytes, dataStart + 3, [0x9d, 0x01, 0x2a])) {
        fail('SS_ERP_BYOK_IMAGE_FORMAT_INVALID', 'WebP VP8 frame is invalid');
      }
      return {
        width: uint16be(Uint8Array.from([
          bytes[dataStart + 7] & 0x3f, bytes[dataStart + 6],
        ]), 0),
        height: uint16be(Uint8Array.from([
          bytes[dataStart + 9] & 0x3f, bytes[dataStart + 8],
        ]), 0),
      };
    }
    if (type === 'VP8L') {
      if (length < 5 || bytes[dataStart] !== 0x2f) {
        fail('SS_ERP_BYOK_IMAGE_FORMAT_INVALID', 'WebP VP8L frame is invalid');
      }
      var packed = uint32le(bytes, dataStart + 1);
      return {
        width: (packed & 0x3fff) + 1,
        height: ((packed >>> 14) & 0x3fff) + 1,
      };
    }
    return null;
  }

  function parseWebp(bytes) {
    if (!bytesEqual(bytes, 0, [0x52, 0x49, 0x46, 0x46])
      || !bytesEqual(bytes, 8, [0x57, 0x45, 0x42, 0x50])) return null;
    if (bytes.length < 20) fail('SS_ERP_BYOK_IMAGE_FORMAT_INVALID', 'WebP container is truncated');
    var containerEnd = uint32le(bytes, 4) + 8;
    if (containerEnd !== bytes.length) {
      fail('SS_ERP_BYOK_IMAGE_FORMAT_INVALID', 'WebP RIFF length is invalid');
    }
    var offset = 12;
    var width = 0;
    var height = 0;
    var extendedDimensions = false;
    var animated = false;
    while (offset < containerEnd) {
      if (offset + 8 > containerEnd) {
        fail('SS_ERP_BYOK_IMAGE_FORMAT_INVALID', 'WebP chunk is truncated');
      }
      var type = ascii(bytes, offset, 4);
      var length = uint32le(bytes, offset + 4);
      var dataStart = offset + 8;
      var dataEnd = dataStart + length;
      var nextOffset = dataEnd + (length % 2);
      if (dataEnd < dataStart || nextOffset > containerEnd) {
        fail('SS_ERP_BYOK_IMAGE_FORMAT_INVALID', 'WebP chunk length is invalid');
      }
      if (type === 'ANIM' || type === 'ANMF') animated = true;
      if (type === 'VP8X' && length >= 1 && (bytes[dataStart] & 0x02) !== 0) animated = true;
      var dimensions = webpDimensions(type, bytes, dataStart, length);
      if (dimensions && (type === 'VP8X' || !extendedDimensions)) {
        width = dimensions.width;
        height = dimensions.height;
        if (type === 'VP8X') extendedDimensions = true;
      }
      offset = nextOffset;
    }
    if (!width || !height) {
      fail('SS_ERP_BYOK_IMAGE_FORMAT_INVALID', 'WebP dimensions were not found');
    }
    return { mimeType: 'image/webp', width: width, height: height, animated: animated };
  }

  function parseImage(bytes) {
    var parsed = parsePng(bytes) || parseJpeg(bytes) || parseWebp(bytes);
    if (!parsed) fail('SS_ERP_BYOK_IMAGE_FORMAT_INVALID', 'Image format is invalid');
    return parsed;
  }

  function validDimensions(width, height, maxDimension, maxPixels) {
    var pixels = width * height;
    return positiveInteger(width) && positiveInteger(height)
      && width <= maxDimension && height <= maxDimension
      && Number.isSafeInteger(pixels) && pixels <= maxPixels;
  }

  // Container metadata only; consumers must enforce their own dimension limits and decode.
  // The BYOK inspector below retains its existing, stricter limits.
  function readImageMetadata(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1
      || bytes.byteLength > DEFAULT_MAX_BYTES) {
      fail('SS_ERP_BYOK_IMAGE_BYTES_INVALID', 'Image bytes are invalid');
    }
    return Object.freeze(parseImage(bytes));
  }

  async function verifyDecode(decodeImage, blob, parsed) {
    var decoded;
    try {
      decoded = await decodeImage(blob);
    } catch (_error) {
      fail('SS_ERP_BYOK_IMAGE_DECODE_FAILED', 'Image decode verification failed');
    }
    try {
      if (!isRecord(decoded)
        || !positiveInteger(decoded.width) || !positiveInteger(decoded.height)) {
        fail('SS_ERP_BYOK_IMAGE_DECODE_FAILED', 'Image decoder returned an invalid result');
      }
      if (decoded.width !== parsed.width || decoded.height !== parsed.height) {
        fail(
          'SS_ERP_BYOK_IMAGE_DECODE_DIMENSIONS_MISMATCH',
          'Decoded image dimensions do not match the image header',
        );
      }
    } finally {
      if (decoded && typeof decoded.close === 'function') {
        try { decoded.close(); } catch (_error) {}
      }
    }
  }

  async function inspectImageBlob(input) {
    if (!isRecord(input)
      || typeof global.Blob === 'undefined'
      || !(input.blob instanceof global.Blob)
      || (input.decodeImage !== undefined && typeof input.decodeImage !== 'function')) {
      fail('SS_ERP_BYOK_IMAGE_INSPECTOR_INPUT_INVALID', 'Image inspection input is invalid');
    }
    var maxBytes = boundedLimit(
      input.maxBytes,
      DEFAULT_MAX_BYTES,
      DEFAULT_MAX_BYTES,
      'maxBytes',
    );
    var maxDimension = boundedLimit(
      input.maxDimension,
      DEFAULT_MAX_DIMENSION,
      DEFAULT_MAX_DIMENSION,
      'maxDimension',
    );
    var maxPixels = boundedLimit(
      input.maxPixels,
      DEFAULT_MAX_PIXELS,
      DEFAULT_MAX_PIXELS,
      'maxPixels',
    );
    var allowedMimeTypes = normalizedAllowedMimeTypes(input.allowedMimeTypes);
    var declaredMime = normalizedMime(input.blob.type);
    if (!MIME_TYPES.includes(declaredMime) || !allowedMimeTypes.includes(declaredMime)) {
      fail('SS_ERP_BYOK_IMAGE_MIME_UNSUPPORTED', 'Image MIME type is not allowed');
    }
    if (!positiveInteger(input.blob.size) || input.blob.size > maxBytes) {
      fail('SS_ERP_BYOK_IMAGE_BYTES_INVALID', 'Image bytes exceed the configured limit');
    }
    var buffer;
    try {
      buffer = await input.blob.arrayBuffer();
    } catch (_error) {
      fail('SS_ERP_BYOK_IMAGE_BYTES_INVALID', 'Image bytes could not be read');
    }
    if (!(buffer instanceof ArrayBuffer)
      || buffer.byteLength !== input.blob.size || buffer.byteLength > maxBytes) {
      fail('SS_ERP_BYOK_IMAGE_BYTES_INVALID', 'Image bytes are invalid');
    }
    var parsed = parseImage(new Uint8Array(buffer));
    buffer = null;
    if (parsed.mimeType !== declaredMime) {
      fail('SS_ERP_BYOK_IMAGE_MIME_MISMATCH', 'Image MIME type does not match its bytes');
    }
    if (parsed.animated) {
      fail('SS_ERP_BYOK_IMAGE_ANIMATION_UNSUPPORTED', 'Animated images are not supported');
    }
    if (!validDimensions(parsed.width, parsed.height, maxDimension, maxPixels)) {
      fail('SS_ERP_BYOK_IMAGE_DIMENSIONS_INVALID', 'Image dimensions exceed the configured limit');
    }
    var decodeVerified = false;
    if (input.decodeImage) {
      await verifyDecode(input.decodeImage, input.blob, parsed);
      decodeVerified = true;
    }
    return Object.freeze({
      contractVersion: CONTRACT_VERSION,
      mimeType: parsed.mimeType,
      byteLength: input.blob.size,
      width: parsed.width,
      height: parsed.height,
      animated: false,
      decodeVerified: decodeVerified,
    });
  }

  function validInspection(value) {
    return isRecord(value)
      && Object.keys(value).length === INSPECTION_KEYS.length
      && INSPECTION_KEYS.every(function (key) {
        return Object.prototype.hasOwnProperty.call(value, key);
      })
      && value.contractVersion === CONTRACT_VERSION
      && MIME_TYPES.includes(value.mimeType)
      && positiveInteger(value.byteLength)
      && positiveInteger(value.width)
      && positiveInteger(value.height)
      && value.animated === false
      && typeof value.decodeVerified === 'boolean';
  }

  function assertSameDimensions(source, mask) {
    if (!validInspection(source) || !validInspection(mask)) {
      fail('SS_ERP_BYOK_IMAGE_INSPECTION_INVALID', 'Image inspection record is invalid');
    }
    if (source.width !== mask.width || source.height !== mask.height) {
      fail(
        'SS_ERP_BYOK_IMAGE_DIMENSIONS_MISMATCH',
        'Source and mask dimensions do not match',
      );
    }
    return Object.freeze({ width: source.width, height: source.height });
  }

  global.SS_ERP_BYOK_IMAGE_INPUT_INSPECTOR = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    MIME_TYPES: MIME_TYPES,
    LIMITS: Object.freeze({
      maxBytes: DEFAULT_MAX_BYTES,
      maxDimension: DEFAULT_MAX_DIMENSION,
      maxPixels: DEFAULT_MAX_PIXELS,
    }),
    ImageInputError: ImageInputError,
    readImageMetadata: readImageMetadata,
    inspectImageBlob: inspectImageBlob,
    assertSameDimensions: assertSameDimensions,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
