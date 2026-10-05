import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
const context = { URL, URLSearchParams };
for (const path of ['shared/erp-adapter/listing-workflow-client.js', 'shared/donor-workbench/workspace-contract.js', 'shared/message-security/runtime-message-policy.js']) {
  vm.runInNewContext(readFileSync('extensions/ss-erp/' + path, 'utf8'), context);
}
const binding = { snapshotId: 'snapshot', supplyGoodsId: 'goods', shopId: 'shop', listingWorkflowId: 'draft', draftRevision: 1, draftVersion: 1 };
const description = { composition: '商品居中', background: '浅灰背景', lighting: '柔和自然光', style: '写实商品摄影',
  observations: { colors: ['白色'], shapes: ['方形'], visibleComponents: ['提手'], visibleText: [] } };
const request = { binding, skuKey: 'sku', sourceMediaKeys: ['image-1'], operationKey: 'vision-operation-1' };
test('visual analysis transports only source keys and receives an editable bound description', async () => {
  const calls = [];
  const client = context.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({ transport: { get: async () => {}, post: async (path, body, options) => {
    calls.push({ path, body, options });
    return { state: 'response', body: { code: 1, data: path.endsWith('capability')
      ? { available: true, reasonCode: 'READY', providerFeeNotice: '看图分析可能产生模型费用。' }
      : { ...request, visualDescription: description, replayed: false } } };
  } } });
  assert.equal((await client.readProductVisionCapability(binding)).capability.available, true);
  const result = await client.analyzeProductVision(request);
  assert.deepEqual(JSON.parse(JSON.stringify(result.analysis.visualDescription)), description);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1].body)), request);
  assert.equal(calls[1].path, '/api/extension-device/source-workbench/vision/analyze');
  assert.equal(calls[1].options.requiredScope, 'media:execute');
  const frame = { ...request, contractVersion: context.SS_ERP_DONOR_WORKBENCH_CONTRACT.CONTRACT_VERSION,
    type: 'VISION_ANALYZE', listingWorkflowId: 'draft', requestId: 'vision-1' };
  assert.equal(context.SS_ERP_DONOR_WORKBENCH_CONTRACT.parseFrameCommand(frame).type, 'VISION_ANALYZE');
  assert.throws(() => context.SS_ERP_DONOR_WORKBENCH_CONTRACT.parseFrameCommand({ ...frame, url: 'https://private.example/' }));
});
test('malformed vision requests fail before transport and ambiguous results are never retried', async () => {
  let count = 0;
  let body = { ...request, visualDescription: description, replayed: false };
  const client = context.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({ transport: { get: async () => {}, post: async () => {
    count++; return { state: 'response', body: { code: 1, data: body } };
  } } });
  for (const extra of [{ sourceMediaKeys: [] }, { sourceMediaKeys: ['image-1', 'image-1'] },
    { sourceMediaKeys: Array.from({ length: 6 }, (_, i) => 'image-' + i) }, { operationKey: 'short' },
    { apiKey: 'forged' }, { sourceUrls: ['http://localhost/'] }]) await assert.rejects(client.analyzeProductVision({ ...request, ...extra }));
  assert.equal(count, 0);
  body = { ...body, visualDescription: { ...description, verifiedFacts: { stock: 999 } } };
  await assert.rejects(client.analyzeProductVision(request), error => error.outcome === 'UNKNOWN_OUTCOME');
  assert.equal(count, 1);
});
test('only exact source-page documents can invoke hosted vision runtime commands', () => {
  const id = 'abcdefghijklmnopabcdefghijklmnop';
  const sender = { id, frameId: 0, documentId: 'source-doc', url: 'https://detail.1688.com/offer/123.html',
    tab: { id: 7, url: 'https://detail.1688.com/offer/123.html' } };
  for (const type of ['ss-erp:source-workbench-vision-capability', 'ss-erp:source-workbench-vision-analyze']) {
    assert.equal(context.SS_ERP_RUNTIME_MESSAGE_POLICY.isAllowedRuntimeMessageSender(type, sender, id), true);
    assert.equal(context.SS_ERP_RUNTIME_MESSAGE_POLICY.isAllowedRuntimeMessageSender(type, { id, url: `chrome-extension://${id}/pages/popup.html` }, id), false);
    assert.equal(context.SS_ERP_RUNTIME_MESSAGE_POLICY.isAllowedRuntimeMessageSender(type, { ...sender, frameId: 3 }, id), false);
  }
});
