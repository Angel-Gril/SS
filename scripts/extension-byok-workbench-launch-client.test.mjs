import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const modulePath = 'extensions/ss-erp/shared/byok/workbench-launch-client.js';
const context = { Array, Boolean, Error, Number, Object, String };
context.globalThis = context;
vm.runInNewContext(readFileSync(modulePath, 'utf8'), context, { filename: modulePath });
const api = context.SS_ERP_BYOK_WORKBENCH_LAUNCH_CLIENT;

const calls = [];
const request = {
  sourcePlatform: '1688',
  sourceProductId: 'product-1',
  sourceCaptureSnapshotId: 'snapshot-1',
  supplyGoodsId: 'goods-1',
  shopId: 'shop-1',
  workflowId: 'workflow-1',
  draftRevision: 3,
  draftVersion: 4,
};
const responseContext = {
  contractVersion: api.CONTEXT_VERSION,
  ...request,
  skuKey: 'sku-1',
  slotKey: 'sku:sku-1:hero',
  assignmentMode: 'APPEND',
  assignmentOrdinal: 2,
};
const client = api.createClient({
  transport: {
    async post(path, body, options) {
      calls.push({ path, body, options });
      return {
        state: 'response',
        status: 200,
        body: { code: 1, data: responseContext },
      };
    },
  },
});

const resolved = await client.resolve(request);
assert.deepEqual(JSON.parse(JSON.stringify(resolved)), responseContext);
assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{
  path: api.LAUNCH_PATH,
  body: { contractVersion: api.REQUEST_VERSION, ...request },
  options: { requiredScope: 'byok:media:ingest' },
}]);

for (const invalid of [
  { ...request, skuKey: 'page-selected-sku' },
  { ...request, sourcePlatform: 'unknown' },
  { ...request, sourceProductId: ' product-1 ' },
  { ...request, draftRevision: 0 },
]) {
  await assert.rejects(client.resolve(invalid), /LAUNCH_INPUT_INVALID/u);
}
assert.equal(calls.length, 1, 'invalid page context must fail before ERP I/O');

const mismatch = api.createClient({
  transport: {
    async post() {
      return {
        state: 'response', status: 200,
        body: { code: 1, data: { ...responseContext, sourceProductId: 'other-product' } },
      };
    },
  },
});
await assert.rejects(mismatch.resolve(request), /LAUNCH_RESPONSE_INVALID/u);

console.log('extension BYOK workbench launch client tests passed');
