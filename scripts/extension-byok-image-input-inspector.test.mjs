import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const inspectorPath = 'extensions/ss-erp/shared/byok/image-input-inspector.js';

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function pngFixture(width, height, options = {}) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const chunks = [pngChunk('IHDR', header)];
  if (options.animated) {
    const animation = Buffer.alloc(8);
    animation.writeUInt32BE(1, 0);
    chunks.push(pngChunk('acTL', animation));
  }
  const encodedWidth = options.encodedWidth || width;
  const encodedHeight = options.encodedHeight || height;
  const rows = [];
  for (let y = 0; y < encodedHeight; y += 1) {
    rows.push(Buffer.alloc(1 + encodedWidth * 4));
  }
  chunks.push(pngChunk('IDAT', deflateSync(Buffer.concat(rows))));
  chunks.push(pngChunk('IEND', Buffer.alloc(0)));
  return new Blob([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    ...chunks,
  ], { type: 'image/png' });
}

function jpegFixture(width, height) {
  const sof = Buffer.from([
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >>> 8) & 0xff, height & 0xff,
    (width >>> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
  ]);
  return new Blob([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]),
    sof,
    Buffer.from([0xff, 0xd9]),
  ], { type: 'image/jpeg' });
}

function webpChunk(type, data) {
  const size = Buffer.alloc(4);
  size.writeUInt32LE(data.length);
  return Buffer.concat([
    Buffer.from(type, 'ascii'),
    size,
    data,
    data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0),
  ]);
}

function webpContainer(...chunks) {
  const payload = Buffer.concat([Buffer.from('WEBP', 'ascii'), ...chunks]);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(payload.length);
  return new Blob([Buffer.from('RIFF', 'ascii'), size, payload], { type: 'image/webp' });
}

function uint24le(value) {
  return Buffer.from([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff]);
}

function webpExtendedFixture(width, height, options = {}) {
  const data = Buffer.concat([
    Buffer.from([options.animated ? 0x02 : 0x00, 0x00, 0x00, 0x00]),
    uint24le(width - 1),
    uint24le(height - 1),
  ]);
  return webpContainer(webpChunk('VP8X', data));
}

function webpLossyFixture(width, height) {
  const data = Buffer.from([
    0x00, 0x00, 0x00, 0x9d, 0x01, 0x2a,
    width & 0xff, (width >>> 8) & 0x3f,
    height & 0xff, (height >>> 8) & 0x3f,
  ]);
  return webpContainer(webpChunk('VP8 ', data));
}

function webpLosslessFixture(width, height) {
  const packed = ((height - 1) << 14) | (width - 1);
  const data = Buffer.from([
    0x2f,
    packed & 0xff,
    (packed >>> 8) & 0xff,
    (packed >>> 16) & 0xff,
    (packed >>> 24) & 0xff,
  ]);
  return webpContainer(webpChunk('VP8L', data));
}

function loadInspector() {
  const context = {
    Array, ArrayBuffer, Blob, Boolean, DataView, Error, Math, Number, Object,
    Promise, Set, String, TypeError, Uint8Array,
  };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(inspectorPath, 'utf8'), context, {
    filename: inspectorPath,
  });
  return context.SS_ERP_BYOK_IMAGE_INPUT_INSPECTOR;
}

function expectCode(code) {
  return (error) => error && error.name === 'ExtensionByokImageInputError'
    && error.code === code;
}

test('parses bounded PNG, JPEG, and every common WebP dimension header', async () => {
  const api = loadInspector();
  assert.equal(api.CONTRACT_VERSION, 'extension-byok-image-input-inspector/v1');
  const cases = [
    [pngFixture(4, 3), 'image/png', 4, 3],
    [jpegFixture(7, 5), 'image/jpeg', 7, 5],
    [webpExtendedFixture(11, 9), 'image/webp', 11, 9],
    [webpLossyFixture(13, 6), 'image/webp', 13, 6],
    [webpLosslessFixture(8, 12), 'image/webp', 8, 12],
  ];
  for (const [blob, mimeType, width, height] of cases) {
    const result = await api.inspectImageBlob({ blob });
    assert.deepEqual(plain(result), {
      contractVersion: api.CONTRACT_VERSION,
      mimeType,
      byteLength: blob.size,
      width,
      height,
      animated: false,
      decodeVerified: false,
    });
    assert.equal(Object.isFrozen(result), true);
  }
});

test('enforces declared MIME, byte, dimension, and pixel bounds before decode', async () => {
  const api = loadInspector();
  const decodeCalls = [];
  const decodeImage = async (blob) => {
    decodeCalls.push(blob);
    return { width: 1, height: 1, close() {} };
  };
  const cases = [
    [{ blob: new Blob([await pngFixture(1, 1).arrayBuffer()], { type: 'image/jpeg' }), decodeImage }, 'SS_ERP_BYOK_IMAGE_MIME_MISMATCH'],
    [{ blob: new Blob([Buffer.from('GIF89a')], { type: 'image/gif' }), decodeImage }, 'SS_ERP_BYOK_IMAGE_MIME_UNSUPPORTED'],
    [{ blob: pngFixture(2, 2), maxBytes: 8, decodeImage }, 'SS_ERP_BYOK_IMAGE_BYTES_INVALID'],
    [{ blob: pngFixture(0, 2, { encodedWidth: 1 }), decodeImage }, 'SS_ERP_BYOK_IMAGE_DIMENSIONS_INVALID'],
    [{ blob: pngFixture(4097, 1), decodeImage }, 'SS_ERP_BYOK_IMAGE_DIMENSIONS_INVALID'],
    [{ blob: pngFixture(4000, 4000, { encodedWidth: 1, encodedHeight: 1 }), maxPixels: 12_000_000, decodeImage }, 'SS_ERP_BYOK_IMAGE_DIMENSIONS_INVALID'],
    [{ blob: pngFixture(2, 2), allowedMimeTypes: ['image/jpeg'], decodeImage }, 'SS_ERP_BYOK_IMAGE_MIME_UNSUPPORTED'],
  ];
  for (const [input, code] of cases) {
    await assert.rejects(api.inspectImageBlob(input), expectCode(code));
  }
  assert.equal(decodeCalls.length, 0);
});

test('rejects malformed containers and animated PNG or WebP before decode', async () => {
  const api = loadInspector();
  let decodeCalls = 0;
  const decodeImage = async () => {
    decodeCalls += 1;
    return { width: 1, height: 1 };
  };
  await assert.rejects(api.inspectImageBlob({
    blob: new Blob([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')], { type: 'image/png' }),
    decodeImage,
  }), expectCode('SS_ERP_BYOK_IMAGE_FORMAT_INVALID'));
  await assert.rejects(api.inspectImageBlob({
    blob: pngFixture(2, 2, { animated: true }), decodeImage,
  }), expectCode('SS_ERP_BYOK_IMAGE_ANIMATION_UNSUPPORTED'));
  await assert.rejects(api.inspectImageBlob({
    blob: webpExtendedFixture(2, 2, { animated: true }), decodeImage,
  }), expectCode('SS_ERP_BYOK_IMAGE_ANIMATION_UNSUPPORTED'));
  assert.equal(decodeCalls, 0);
});

test('optionally verifies decode dimensions and always closes the decoded image', async () => {
  const api = loadInspector();
  let closeCalls = 0;
  const verified = await api.inspectImageBlob({
    blob: pngFixture(4, 3),
    decodeImage: async () => ({
      width: 4,
      height: 3,
      close() { closeCalls += 1; },
    }),
  });
  assert.equal(verified.decodeVerified, true);
  assert.equal(closeCalls, 1);

  await assert.rejects(api.inspectImageBlob({
    blob: pngFixture(4, 3),
    decodeImage: async () => ({
      width: 3,
      height: 4,
      close() { closeCalls += 1; },
    }),
  }), expectCode('SS_ERP_BYOK_IMAGE_DECODE_DIMENSIONS_MISMATCH'));
  assert.equal(closeCalls, 2);

  await assert.rejects(api.inspectImageBlob({
    blob: pngFixture(4, 3),
    decodeImage: async () => { throw new Error('decoder details must not escape'); },
  }), (error) => expectCode('SS_ERP_BYOK_IMAGE_DECODE_FAILED')(error)
    && !String(error.message).includes('decoder details'));
});

test('asserts exact source and mask dimensions without accepting malformed records', async () => {
  const api = loadInspector();
  const source = await api.inspectImageBlob({ blob: pngFixture(4, 3) });
  const sameMask = await api.inspectImageBlob({
    blob: pngFixture(4, 3), allowedMimeTypes: ['image/png'],
  });
  const otherMask = await api.inspectImageBlob({
    blob: pngFixture(3, 4), allowedMimeTypes: ['image/png'],
  });
  assert.deepEqual(plain(api.assertSameDimensions(source, sameMask)), {
    width: 4,
    height: 3,
  });
  await assert.rejects(
    async () => api.assertSameDimensions(source, otherMask),
    expectCode('SS_ERP_BYOK_IMAGE_DIMENSIONS_MISMATCH'),
  );
  await assert.rejects(
    async () => api.assertSameDimensions({ width: 4, height: 3 }, sameMask),
    expectCode('SS_ERP_BYOK_IMAGE_INSPECTION_INVALID'),
  );
});
