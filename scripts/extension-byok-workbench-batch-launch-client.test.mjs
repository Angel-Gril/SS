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
  preferredSkuKey: 'sku-1',
  selectionKind: 'EXPLICIT',
};
const binding = Object.fromEntries(Object.entries(request).filter(([key]) => (
  key !== 'preferredSkuKey' && key !== 'selectionKind'
)));
const responseContext = {
  contractVersion: 'extension-byok-workbench-batch-launch-context/v1',
  ...binding,
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
  body: { contractVersion: 'extension-byok-workbench-launch-request/v2', ...request },
  options: { requiredScope: 'listing:review' },
}]);

for (const invalidRequest of [
  { ...request, preferredSkuKey: null },
  { ...request, preferredSkuKey: 'sk-' + 'a'.repeat(24) },
  Object.fromEntries(Object.entries(request).filter(([key]) => key !== 'preferredSkuKey')),
  { ...request, selectionKind: 'HINT' },
  { ...request, selectionKind: 'AUTO' },
  Object.fromEntries(Object.entries(request).filter(([key]) => key !== 'selectionKind')),
  { ...request, unexpected: true },
]) {
  await assert.rejects(
    client.resolve(invalidRequest),
    (error) => error?.code === 'SS_ERP_BYOK_WORKBENCH_BATCH_LAUNCH_INPUT_INVALID',
  );
}
assert.equal(calls.length, 1, 'invalid batch launch input must fail before ERP I/O');

for (const invalidData of [
  { ...responseContext, firstAssignmentOrdinal: 500 },
  { ...responseContext, anchorSkuKey: 'sku-2' },
  {
    ...responseContext,
    targets: [responseContext.targets[1], responseContext.targets[0], responseContext.targets[2]],
  },
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

const forbiddenClient = api.createClient({
  transport: { async post() {
    return {
      state: 'http_error',
      status: 403,
      body: { code: 0, errorCode: 'device_scope_denied' },
    };
  } },
});
await assert.rejects(
  forbiddenClient.resolve(request),
  (error) => error?.code === 'SS_ERP_BYOK_WORKBENCH_BATCH_LAUNCH_UNAVAILABLE'
    && error.state === 'http_error'
    && error.status === 403
    && error.errorCode === 'device_scope_denied',
);

const conflictCause = Object.assign(new Error('transport conflict'), {
  state: 'http_error',
  status: 409,
  errorCode: 'draft_revision_conflict',
});
const conflictClient = api.createClient({
  transport: { async post() { throw conflictCause; } },
});
await assert.rejects(
  conflictClient.resolve(request),
  (error) => error?.code === 'SS_ERP_BYOK_WORKBENCH_BATCH_LAUNCH_UNAVAILABLE'
    && error.state === 'http_error'
    && error.status === 409
    && error.errorCode === 'draft_revision_conflict',
);

console.log('extension BYOK workbench batch launch client tests passed');
