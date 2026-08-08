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
  preferredSkuKey: null,
  selectionKind: 'HINT',
};
const binding = Object.fromEntries(Object.entries(request).filter(([key]) => (
  key !== 'preferredSkuKey' && key !== 'selectionKind'
)));
const responseContext = {
  contractVersion: api.CONTEXT_VERSION,
  ...binding,
  skuKey: 'sku-1',
  slotKey: 'sku:sku-1:hero',
  assignmentMode: 'APPEND',
  assignmentOrdinal: 2,
};
const readyDecision = {
  contractVersion: api.DECISION_VERSION,
  state: 'READY',
  context: responseContext,
};
const reviewContext = {
  contractVersion: api.REVIEW_CONTEXT_VERSION,
  launchMode: 'REVIEW_PUBLISH_ONLY',
  ...binding,
  skuKey: 'sku-1',
  slotKey: 'sku:sku-1:hero',
  assignmentOrdinal: 1,
  assetId: 'byok_asset-1',
  source: 'GENERATED',
};
const reviewDecision = {
  contractVersion: api.REVIEW_DECISION_VERSION,
  state: 'REVIEW_PUBLISH_ONLY',
  context: reviewContext,
};
const client = api.createClient({
  transport: {
    async post(path, body, options) {
      calls.push({ path, body, options });
      return {
        state: 'response',
        status: 200,
        body: { code: 1, data: readyDecision },
      };
    },
  },
});

const resolved = await client.resolve(request);
assert.deepEqual(JSON.parse(JSON.stringify(resolved)), readyDecision);
assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{
  path: api.LAUNCH_PATH,
  body: {
    contractVersion: api.REQUEST_VERSION,
    ...request,
    supportedLaunchModes: ['GENERATE', 'REVIEW_PUBLISH_ONLY'],
  },
  options: { requiredScope: 'listing:review' },
}]);

const reviewRequest = { ...request, preferredSkuKey: 'sku-1' };
const reviewClient = api.createClient({
  transport: { async post() {
    return { state: 'response', status: 200, body: { code: 1, data: reviewDecision } };
  } },
});
assert.deepEqual(
  JSON.parse(JSON.stringify(await reviewClient.resolve(reviewRequest))),
  reviewDecision,
);

const choiceCalls = [];
const choiceDecision = {
  contractVersion: api.DECISION_VERSION,
  state: 'CHOICE_REQUIRED',
  binding,
  skuKeys: ['sku-1', 'sku-2'],
};
const choiceClient = api.createClient({
  transport: { async post(path, body, options) {
    choiceCalls.push({ path, body, options });
    return { state: 'response', status: 200, body: { code: 1, data: choiceDecision } };
  } },
});
const choiceResolved = await choiceClient.resolve(request);
assert.deepEqual(JSON.parse(JSON.stringify(choiceResolved)), choiceDecision);
assert.equal(Object.isFrozen(choiceResolved), true);
assert.deepEqual(JSON.parse(JSON.stringify(choiceCalls[0])), {
  path: api.LAUNCH_PATH,
  body: {
    contractVersion: api.REQUEST_VERSION,
    ...request,
    supportedLaunchModes: ['GENERATE', 'REVIEW_PUBLISH_ONLY'],
  },
  options: { requiredScope: 'listing:review' },
});

const singleChoiceDecision = { ...choiceDecision, skuKeys: ['sku-1'] };
const singleChoiceClient = api.createClient({
  transport: { async post() {
    return { state: 'response', status: 200, body: { code: 1, data: singleChoiceDecision } };
  } },
});
assert.deepEqual(
  JSON.parse(JSON.stringify(await singleChoiceClient.resolve(request))),
  singleChoiceDecision,
);

for (const invalid of [
  { ...request, skuKey: 'page-selected-sku' },
  { ...request, preferredSkuKey: undefined },
  { ...request, preferredSkuKey: 'sk-' + 'a'.repeat(24) },
  { ...request, selectionKind: 'AUTO' },
  Object.fromEntries(Object.entries(request).filter(([key]) => key !== 'selectionKind')),
  { ...request, sourcePlatform: 'unknown' },
  { ...request, sourceProductId: ' product-1 ' },
  { ...request, draftRevision: 0 },
]) {
  await assert.rejects(client.resolve(invalid), /LAUNCH_INPUT_INVALID/u);
}
assert.equal(calls.length, 1, 'invalid page context must fail before ERP I/O');

let explicitNullCalls = 0;
const explicitNullClient = api.createClient({
  transport: { async post() {
    explicitNullCalls += 1;
    return { state: 'response', status: 200, body: { code: 1, data: readyDecision } };
  } },
});
await assert.rejects(
  explicitNullClient.resolve({ ...request, selectionKind: 'EXPLICIT' }),
  (error) => error?.code === 'SS_ERP_BYOK_WORKBENCH_LAUNCH_INPUT_INVALID',
);
assert.equal(
  explicitNullCalls,
  0,
  'an explicit selection without a preferred SKU must fail before ERP I/O',
);

const mismatch = api.createClient({
  transport: {
    async post() {
      return {
        state: 'response', status: 200,
        body: {
          code: 1,
          data: {
            ...readyDecision,
            context: { ...responseContext, sourceProductId: 'other-product' },
          },
        },
      };
    },
  },
});
await assert.rejects(mismatch.resolve(request), /LAUNCH_RESPONSE_INVALID/u);

for (const invalidDecision of [
  { ...readyDecision, providerOrigin: 'https://provider.example' },
  { ...readyDecision, context: { ...responseContext, skuKey: 'sk-' + 'b'.repeat(24) } },
  { ...choiceDecision, skuKeys: ['sku-1', 'sku-1'] },
  { ...choiceDecision, binding: { ...binding, workflowId: 'other-workflow' } },
  { ...choiceDecision, apiKey: 'secret' },
]) {
  const invalidClient = api.createClient({
    transport: { async post() {
      return { state: 'response', status: 200, body: { code: 1, data: invalidDecision } };
    } },
  });
  await assert.rejects(invalidClient.resolve(request), /LAUNCH_RESPONSE_INVALID/u);
}

await assert.rejects(reviewClient.resolve(request), /LAUNCH_RESPONSE_INVALID/u);
for (const invalidReviewDecision of [
  { ...reviewDecision, context: { ...reviewContext, assetId: 'sk-' + 'c'.repeat(24) } },
  { ...reviewDecision, context: { ...reviewContext, source: 'SOURCE' } },
  { ...reviewDecision, context: { ...reviewContext, launchMode: 'GENERATE' } },
  { ...reviewDecision, context: { ...reviewContext, assignmentMode: 'APPEND' } },
  { ...reviewDecision, contractVersion: api.DECISION_VERSION },
]) {
  const invalidReviewClient = api.createClient({
    transport: { async post() {
      return { state: 'response', status: 200, body: { code: 1, data: invalidReviewDecision } };
    } },
  });
  await assert.rejects(
    invalidReviewClient.resolve(reviewRequest),
    /LAUNCH_RESPONSE_INVALID/u,
  );
}

const preferredRequest = {
  ...request,
  preferredSkuKey: 'sku-2',
  selectionKind: 'EXPLICIT',
};
const preferredMismatchClient = api.createClient({
  transport: { async post() {
    return { state: 'response', status: 200, body: { code: 1, data: readyDecision } };
  } },
});
await assert.rejects(preferredMismatchClient.resolve(preferredRequest), /LAUNCH_RESPONSE_INVALID/u);
await assert.rejects(choiceClient.resolve(preferredRequest), /LAUNCH_RESPONSE_INVALID/u);

const transportCause = Object.assign(new Error('transport conflict'), {
  state: 'http_error',
  status: 409,
  errorCode: 'draft_revision_conflict',
});
const throwingClient = api.createClient({
  transport: { async post() { throw transportCause; } },
});
await assert.rejects(
  throwingClient.resolve(request),
  (error) => error !== transportCause
    && error?.code === 'SS_ERP_BYOK_WORKBENCH_LAUNCH_UNAVAILABLE'
    && error.state === 'http_error'
    && error.status === 409
    && error.errorCode === 'draft_revision_conflict',
);

console.log('extension BYOK workbench launch client tests passed');
