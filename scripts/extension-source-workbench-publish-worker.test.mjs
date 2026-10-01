import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const worker = readFileSync('extensions/ss-erp/background/service-worker.js', 'utf8');
const extract = (name) => {
  const result = worker.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`, 'u'));
  assert.ok(result); return result[0];
};
const url = 'https://detail.1688.com/offer/845581683597.html';
const sender = { frameId: 0, documentId: 'source-document', url, tab: { id: 12, url } };
const message = { type: 'ss-erp:source-listing-workbench-publish', platform: '1688', sourceProductId: '845581683597', listingWorkflowId: 'draft', action: 'PREVIEW' };
function setup() {
  const calls = [];
  const status = { state: 'ready', status: { snapshot: { current: true } } };
  const editor = { binding: { shopId: 'server-shop', listingWorkflowId: 'draft', draftRevision: 7, draftVersion: 6 },
    selectedSkuKeys: ['sku'], mediaAssignments: [{ scope: 'PRODUCT', skuKey: null, slotKey: 'product-main', assetId: 'server-asset' }],
    stage: 'READY_TO_PUBLISH', validation: { status: 'VALID' } };
  const context = { URL, Map, sourceWorkbenchPublishControllers: new Map(),
    sourceWorkflowPlatform: (value) => value,
    sourceWorkflowHandoffText: (value) => typeof value === 'string' ? value.trim() : '',
    readPersistedSourceWorkflowHandoff: async () => ({ platform: '1688', sourceProductId: '845581683597', snapshotId: 'snapshot', supplyGoodsId: 'goods' }),
    currentSourceListingContext: () => ({ shopId: 'server-shop', listingWorkflowId: 'draft', revision: 7, draftVersion: 6 }),
    getSourceListingWorkflowClient: () => ({ getStatus: async () => status, readDraftEditor: async (binding) => { calls.push({ binding }); return { state: 'ready', editor }; } }),
    getWorkbenchListingPublishCoordinator: () => ({ preview: async (input) => { calls.push({ input }); return { previewHash: 'a'.repeat(64) }; },
      confirm: async () => { throw new Error('unexpected write'); }, getState: async () => ({ state: 'NOT_COMMITTED' }) }),
  };
  vm.runInNewContext(readFileSync('extensions/ss-erp/shared/publish/source-workbench-publish-controller.js', 'utf8'), context);
  vm.runInNewContext(`${extract('sourceAiWorkbenchSenderIdentity')}\n${extract('executeSourceWorkbenchPublish')}\nglobalThis.execute = executeSourceWorkbenchPublish;`, context);
  return { context, calls, status, editor };
}
test('source publish re-reads server snapshot, shop, revision and ordered bound assets', async () => {
  const fixture = setup();
  await fixture.context.execute(message, sender);
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.calls[0].binding)), { snapshotId: 'snapshot', supplyGoodsId: 'goods', shopId: 'server-shop',
    listingWorkflowId: 'draft', draftRevision: 7, draftVersion: 6 });
  assert.equal(fixture.calls[1].input.selectedMedia[0].assetId, 'server-asset');
  assert.equal(fixture.calls[1].input.executionMode, 'ERP_HOSTED');
});
test('source publish rejects stale captures, subframes, another product and forged write fields', async () => {
  const fixture = setup();
  for (const invalidSender of [{ ...sender, frameId: 2 }, { ...sender, documentId: '' }, { ...sender, url: 'https://detail.1688.com/offer/another.html' }]) {
    await assert.rejects(fixture.context.execute(message, invalidSender), /来源商品页/u);
  }
  await assert.rejects(fixture.context.execute({ ...message, selectedMedia: [{ assetId: 'attacker' }] }, sender), /字段无效/u);
  fixture.status.status.snapshot.current = false;
  await assert.rejects(fixture.context.execute(message, sender), /来源快照已变化/u);
  assert.equal(fixture.calls.length, 0);
});
