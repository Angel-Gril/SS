import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const modulePath = 'extensions/ss-erp/shared/byok/image-mask-transform.js';
const source = fs.existsSync(modulePath) ? fs.readFileSync(modulePath, 'utf8') : '';

function loadApi(options = {}) {
  let encodedPixels = null;
  const bitmap = {
    width: options.bitmapWidth || 2,
    height: options.bitmapHeight || 1,
    pixels: new Uint8ClampedArray(options.pixels || [
      255, 255, 255, 255,
      0, 0, 0, 255,
    ]),
    close() {},
  };
  class FakeOffscreenCanvas {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.context = {
        pixels: null,
        drawImage(value) { this.pixels = new Uint8ClampedArray(value.pixels); },
        getImageData() { return { data: new Uint8ClampedArray(this.pixels) }; },
        putImageData(value) { encodedPixels = new Uint8ClampedArray(value.data); },
      };
    }
    getContext() { return this.context; }
    async convertToBlob() {
      return new Blob([encodedPixels || new Uint8Array()], { type: options.outputType || 'image/png' });
    }
  }
  const context = {
    Array, Blob, Boolean, Date, Error, Math, Number, Object, Promise, String,
    TypeError, Uint8Array, Uint8ClampedArray,
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: modulePath });
  return {
    api: context.SS_ERP_BYOK_IMAGE_MASK_TRANSFORM,
    createImageBitmap: async () => bitmap,
    OffscreenCanvas: FakeOffscreenCanvas,
    encodedPixels: () => encodedPixels,
  };
}

test('maps the internal white-edit mask to OpenAI alpha semantics', async () => {
  const loaded = loadApi({
    bitmapWidth: 3,
    pixels: [
      255, 255, 255, 255,
      0, 0, 0, 255,
      128, 20, 10, 255,
    ],
  });
  assert.ok(loaded.api, 'image mask transform module must exist');
  const transform = loaded.api.createTransformer({
    createImageBitmap: loaded.createImageBitmap,
    OffscreenCanvas: loaded.OffscreenCanvas,
  });
  const result = await transform.toOpenAiMask({
    blob: new Blob(['mask'], { type: 'image/png' }),
    width: 3,
    height: 1,
    maskSemantics: 'WHITE_EDIT_BLACK_PRESERVE_V1',
  });
  assert.equal(result.blob.type, 'image/png');
  assert.equal(result.width, 3);
  assert.equal(result.height, 1);
  assert.equal(result.maskSemantics, 'TRANSPARENT_EDIT_OPAQUE_PRESERVE_V1');
  assert.deepEqual(Array.from(loaded.encodedPixels()), [
    255, 255, 255, 0,
    255, 255, 255, 255,
    255, 255, 255, 127,
  ]);
});

test('rejects stale dimensions and unsupported semantics before encoding', async () => {
  const loaded = loadApi();
  const transform = loaded.api.createTransformer({
    createImageBitmap: loaded.createImageBitmap,
    OffscreenCanvas: loaded.OffscreenCanvas,
  });
  await assert.rejects(
    transform.toOpenAiMask({
      blob: new Blob(['mask'], { type: 'image/png' }),
      width: 1,
      height: 1,
      maskSemantics: 'WHITE_EDIT_BLACK_PRESERVE_V1',
    }),
    (error) => error && error.code === 'SS_ERP_BYOK_PROVIDER_SOURCE_MASK_DIMENSIONS_MISMATCH',
  );
  await assert.rejects(
    transform.toOpenAiMask({
      blob: new Blob(['mask'], { type: 'image/png' }),
      width: 2,
      height: 1,
      maskSemantics: 'OPAQUE_EDIT',
    }),
    (error) => error && error.code === 'SS_ERP_BYOK_PROVIDER_MASK_SEMANTICS_INVALID',
  );
});

test('fails closed when browser decoding or PNG encoding is unavailable', async () => {
  const loaded = loadApi({ outputType: 'image/jpeg' });
  assert.throws(
    () => loaded.api.createTransformer({ createImageBitmap: loaded.createImageBitmap }),
    /OffscreenCanvas/u,
  );
  const transform = loaded.api.createTransformer({
    createImageBitmap: loaded.createImageBitmap,
    OffscreenCanvas: loaded.OffscreenCanvas,
  });
  await assert.rejects(
    transform.toOpenAiMask({
      blob: new Blob(['mask'], { type: 'image/png' }),
      width: 2,
      height: 1,
      maskSemantics: 'WHITE_EDIT_BLACK_PRESERVE_V1',
    }),
    (error) => error && error.code === 'SS_ERP_BYOK_PROVIDER_MASK_ENCODE_FAILED',
  );
});
