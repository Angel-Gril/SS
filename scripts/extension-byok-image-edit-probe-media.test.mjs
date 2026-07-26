import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const modulePath = 'extensions/ss-erp/shared/byok/image-edit-probe-media.js';
const source = fs.existsSync(modulePath) ? fs.readFileSync(modulePath, 'utf8') : '';

function loadApi(options = {}) {
  const canvases = [];
  class FakeCanvas {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.operations = [];
      this.context = {
        fillStyle: '',
        fillRect: (x, y, widthValue, heightValue) => {
          this.operations.push({
            fillStyle: this.context.fillStyle,
            x,
            y,
            width: widthValue,
            height: heightValue,
          });
        },
      };
      canvases.push(this);
    }
    getContext() { return options.noContext ? null : this.context; }
    async convertToBlob() {
      return new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, this.operations.length])], {
        type: options.outputType || 'image/png',
      });
    }
  }
  const context = { Array, Blob, Error, Object, Promise, String, TypeError, Uint8Array };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: modulePath });
  return { api: context.SS_ERP_BYOK_IMAGE_EDIT_PROBE_MEDIA, FakeCanvas, canvases };
}

test('creates bounded synthetic source media for every edit operation', async () => {
  for (const operation of ['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT']) {
    const loaded = loadApi();
    assert.ok(loaded.api, 'probe media module must exist');
    const factory = loaded.api.createFactory({ OffscreenCanvas: loaded.FakeCanvas });
    const result = await factory.create(operation);
    assert.equal(result.images.length, 1);
    assert.equal(result.images[0] instanceof Blob, true);
    assert.equal(result.images[0].type, 'image/png');
    assert.equal(result.images[0].size > 0, true);
    if (operation === 'INPAINT') {
      assert.equal(result.mask.blob instanceof Blob, true);
      assert.equal(result.mask.blob.type, 'image/png');
      assert.equal(result.mask.maskSemantics, 'WHITE_EDIT_BLACK_PRESERVE_V1');
      assert.equal(loaded.canvases.length, 2);
    } else {
      assert.equal(result.mask, null);
      assert.equal(loaded.canvases.length, 1);
    }
  }
});

test('draws an internal partial mask and rejects unavailable browser encoding', async () => {
  const loaded = loadApi();
  const factory = loaded.api.createFactory({ OffscreenCanvas: loaded.FakeCanvas });
  await factory.create('INPAINT');
  assert.deepEqual(loaded.canvases[1].operations, [
    { fillStyle: '#000000', x: 0, y: 0, width: 64, height: 64 },
    { fillStyle: '#ffffff', x: 16, y: 16, width: 32, height: 32 },
  ]);

  assert.throws(
    () => loaded.api.createFactory({}),
    /OffscreenCanvas/u,
  );
  const unavailable = loadApi({ noContext: true });
  await assert.rejects(
    unavailable.api.createFactory({ OffscreenCanvas: unavailable.FakeCanvas }).create('FULL_EDIT'),
    (error) => error && error.code === 'SS_ERP_BYOK_IMAGE_EDIT_PROBE_MEDIA_UNAVAILABLE',
  );
});

test('rejects unsupported operations and non-PNG output', async () => {
  const loaded = loadApi({ outputType: 'image/jpeg' });
  const factory = loaded.api.createFactory({ OffscreenCanvas: loaded.FakeCanvas });
  await assert.rejects(
    factory.create('TEXT_TO_IMAGE'),
    (error) => error && error.code === 'SS_ERP_BYOK_IMAGE_EDIT_PROBE_MEDIA_INVALID',
  );
  await assert.rejects(
    factory.create('FULL_EDIT'),
    (error) => error && error.code === 'SS_ERP_BYOK_IMAGE_EDIT_PROBE_MEDIA_UNAVAILABLE',
  );
});
