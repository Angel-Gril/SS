import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const modulePath = 'extensions/ss-erp/shared/byok/workbench-source-media-library.js';
const context = {
  Array, ArrayBuffer, Blob, Boolean, Error, Map, Math, Number, Object, Promise,
  Set, String, TextEncoder, Uint8Array, crypto: webcrypto,
};
context.globalThis = context;
vm.runInNewContext(readFileSync(modulePath, 'utf8'), context, { filename: modulePath });
const api = context.SS_ERP_BYOK_WORKBENCH_SOURCE_MEDIA_LIBRARY;

const launchContext = Object.freeze({
  contractVersion: 'extension-byok-workbench-launch-context/v1',
  sourcePlatform: '1688',
  sourceProductId: 'product-1',
  sourceCaptureSnapshotId: 'snapshot-1',
  supplyGoodsId: 'goods-1',
  shopId: 'shop-1',
  workflowId: 'workflow-1',
  draftRevision: 3,
  draftVersion: 4,
  skuKey: 'sku-red',
  slotKey: 'sku:sku-red:hero',
  assignmentMode: 'APPEND',
  assignmentOrdinal: 0,
});

const sourceInputs = [
  { sourceMediaKey: 'source-main-1', role: 'product_main', scope: 'PRODUCT', skuKeys: [] },
  { sourceMediaKey: 'source-red-1', role: 'sku', scope: 'SKU', skuKeys: ['sku-red'] },
  { sourceMediaKey: 'source-blue-1', role: 'sku', scope: 'SKU', skuKeys: ['sku-blue'] },
];

const calls = [];
let bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
let tamperSha = false;

function launch() {
  return {
    state: 'ready',
    context: {
      id: launchContext.workflowId,
      snapshotId: launchContext.sourceCaptureSnapshotId,
      supplyGoodsId: launchContext.supplyGoodsId,
      shopId: launchContext.shopId,
      revision: launchContext.draftRevision,
      draftVersion: launchContext.draftVersion,
      sourceInputs,
    },
  };
}

async function sha256(value) {
  const digest = await webcrypto.subtle.digest('SHA-256', value);
  return Buffer.from(digest).toString('hex');
}

const listingClient = {
  async getMediaLaunch(input) {
    calls.push(['launch', input]);
    return launch();
  },
};
const transport = {
  async postRaw(path, body, options) {
    calls.push(['raw', path, body, options]);
    const actualSha = await sha256(bytes);
    const headers = new Map([
      ['content-type', 'image/png'],
      ['content-length', String(bytes.byteLength)],
      ['x-ss-erp-content-sha256', tamperSha ? '0'.repeat(64) : actualSha],
      ['x-ss-erp-image-width', '64'],
      ['x-ss-erp-image-height', '64'],
    ]);
    return {
      state: 'raw_response',
      response: {
        ok: true,
        status: 200,
        headers: { get(name) { return headers.get(String(name).toLowerCase()) || null; } },
        async arrayBuffer() {
          return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        },
      },
    };
  },
};
const previewBroker = {
  open(candidate) {
    calls.push(['preview', candidate]);
    return {
      contractVersion: 'extension-byok-preview-ticket/v1',
      channelName: 'source-preview-channel',
      previewTicket: 'source-preview-ticket',
    };
  },
};

const library = api.createLibrary({
  listingClient,
  transport,
  previewBroker,
  crypto: webcrypto,
  Blob,
});

const catalog = await library.loadCatalog(launchContext);
assert.equal(catalog.contractVersion, 'extension-byok-workbench-source-catalog/v1');
assert.equal(catalog.items.length, 2, 'other-SKU media must not enter the active catalog');
assert.match(catalog.items[0].mediaId, /^sm_[a-f0-9]{48}$/u);
assert.deepEqual(JSON.parse(JSON.stringify(catalog.items.map((item) => item.sourceMediaKey))), [
  'source-main-1', 'source-red-1',
]);

const opened = await library.open(launchContext, 'source-main-1', 'WORKING');
assert.equal(opened.previewTicket, 'source-preview-ticket');
assert.equal(calls.filter((row) => row[0] === 'launch').length, 2,
  'preview must revalidate the live launch instead of trusting a prior catalog');
const rawCall = calls.find((row) => row[0] === 'raw');
assert.equal(rawCall[1], '/api/extension-device/source-workbench/media-preview');
assert.deepEqual(rawCall[4], undefined);
assert.deepEqual(JSON.parse(JSON.stringify(rawCall[3])), {
  requiredScopes: ['listing:review', 'media:execute'],
});
assert.equal(rawCall[2].sourceMediaKey, 'source-main-1');
assert.equal(rawCall[2].purpose, 'WORKING');
const previewCandidate = calls.find((row) => row[0] === 'preview')[1];
assert.equal(previewCandidate.blob.type, 'image/png');
assert.equal(previewCandidate.blob.size, bytes.byteLength);
assert.match(previewCandidate.resultId, /^br_[a-f0-9]{48}$/u);

const rawCount = calls.filter((row) => row[0] === 'raw').length;
await assert.rejects(
  library.open(launchContext, 'source-blue-1', 'THUMBNAIL'),
  (error) => error?.code === 'SS_ERP_SOURCE_MEDIA_LIBRARY_STALE',
);
assert.equal(calls.filter((row) => row[0] === 'raw').length, rawCount,
  'an out-of-scope media key must fail before byte transport');

tamperSha = true;
await assert.rejects(
  library.open(launchContext, 'source-main-1', 'THUMBNAIL'),
  (error) => error?.code === 'SS_ERP_SOURCE_MEDIA_PREVIEW_INVALID',
);
tamperSha = false;

bytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
await assert.rejects(
  library.open(launchContext, 'source-main-1', 'THUMBNAIL'),
  (error) => error?.code === 'SS_ERP_SOURCE_MEDIA_PREVIEW_INVALID',
  'matching hashes cannot make non-image bytes valid',
);

console.log('extension BYOK source media library tests passed');
