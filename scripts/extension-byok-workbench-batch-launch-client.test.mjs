import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const modulePath = 'extensions/ss-erp/shared/byok/workbench-batch-launch-client.js';
const context = { Array, Boolean, Error, Number, Object, Set, String };
context.globalThis = context;
vm.runInNewContext(readFileSync(modulePath, 'utf8'), context, { filename: modulePath });
const api = context.SS_ERP_BYOK_WORKBENCH_BATCH_LAUNCH_CLIENT;

const request = {
  sourcePlatform: '1688', sourceProductId: 'product-1',
  sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
  shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
};
const responseContext = {
  contractVersion: 'extension-byok-workbench-batch-launch-context/v1',
  ...request,
  anchorSkuKey: 'sku-1',
  firstAssignmentOrdinal: 7,
  targets: [
    { skuKey: 'sku-1', slotKey: 'sku:sku-1:hero' },
    { skuKey: 'sku-2', slotKey: 'sku:sku-2:hero' },
    { skuKey: 'sku-1', slotKey: 'shared:detail:DETAIL' },
  ],
};
const calls = [];
const client = api.createClient({
  transport: {
    async post(path, body, options) {
      calls.push({ path, body, options });
      return { state: 'response', status: 200, body: { code: 1, data: responseContext } };
    },
  },
});
assert.deepEqual(JSON.parse(JSON.stringify(await client.resolve(request))), responseContext);
assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{
  path: '/api/extension-device/byok-media/workbench-batch-launch',
  body: { contractVersion: 'extension-byok-workbench-launch-request/v1', ...request },
  options: { requiredScope: 'byok:media:ingest' },
}]);

for (const invalidData of [
  { ...responseContext, firstAssignmentOrdinal: 500 },
  { ...responseContext, anchorSkuKey: 'sku-2' },
  { ...responseContext, targets: responseContext.targets.toReversed() },
  { ...responseContext, targets: [{ skuKey: 'sku-2', slotKey: 'shared:detail:DETAIL' }] },
  { ...responseContext, targets: [...responseContext.targets, responseContext.targets[0]] },
  { ...responseContext, providerOrigin: 'https://provider.example' },
]) {
  const invalidClient = api.createClient({
    transport: { async post() {
      return { state: 'response', status: 200, body: { code: 1, data: invalidData } };
    } },
  });
  await assert.rejects(
    invalidClient.resolve(request),
    (error) => error && error.code === 'SS_ERP_BYOK_WORKBENCH_BATCH_LAUNCH_RESPONSE_INVALID',
  );
}

console.log('extension BYOK workbench batch launch client tests passed');
