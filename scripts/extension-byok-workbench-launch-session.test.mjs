import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const modulePath = 'extensions/ss-erp/shared/byok/workbench-launch-session.js';
const context = { Array, Boolean, Date, Error, Map, Math, Number, Object, Promise, Set, String };
context.globalThis = context;
vm.runInNewContext(readFileSync(modulePath, 'utf8'), context, { filename: modulePath });
const api = context.SS_ERP_BYOK_WORKBENCH_LAUNCH_SESSION;

function storageArea() {
  const values = {};
  return {
    values,
    async get(keys) {
      const result = {};
      for (const key of keys) if (Object.hasOwn(values, key)) result[key] = values[key];
      return result;
    },
    async set(patch) { Object.assign(values, JSON.parse(JSON.stringify(patch))); },
    async remove(keys) { for (const key of keys) delete values[key]; },
  };
}

const launchContext = {
  contractVersion: 'extension-byok-workbench-launch-context/v1',
  sourcePlatform: '1688', sourceProductId: 'product-1',
  sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
  shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
  skuKey: 'sku-1', slotKey: 'sku:sku-1:hero',
  assignmentMode: 'APPEND', assignmentOrdinal: 0,
};
let now = Date.parse('2026-07-26T09:00:00.000Z');
const storage = storageArea();
const created = [];
const updated = [];
const removed = [];
const manager = api.createManager({
  sessionStorage: storage,
  tabs: {
    async create(value) { created.push(value); return { id: 77 }; },
    async update(id, value) { updated.push({ id, value }); return { id }; },
    async remove(id) { removed.push(id); },
  },
  runtime: { getURL(path) { return `chrome-extension://extension-id/${path}`; } },
  now: () => now,
});

const opened = await manager.open({
  context: launchContext,
  sourceTabId: 12,
  sourceDocumentId: 'source-document-1',
});
assert.deepEqual(JSON.parse(JSON.stringify(opened)), { state: 'workbench_opened', tabId: 77 });
assert.deepEqual(JSON.parse(JSON.stringify(created)), [{
  url: 'chrome-extension://extension-id/pages/ai-image-workbench-launch.html',
  active: true,
}]);
assert.deepEqual(JSON.parse(JSON.stringify(updated)), [{
  id: 77,
  value: { url: 'chrome-extension://extension-id/pages/ai-image-workbench.html', active: true },
}]);
assert.equal(JSON.stringify([...created, ...updated]).includes('product-1'), false);
assert.equal(JSON.stringify([...created, ...updated]).includes('workflow-1'), false);
assert.equal(JSON.stringify([...created, ...updated]).includes('apiKey'), false);

const sender = { tabId: 77, documentId: 'workbench-document-1', frameId: 0 };
const claimed = await manager.claim(sender);
assert.equal(claimed.context.sourceProductId, 'product-1');
assert.equal(claimed.workbenchDocumentId, 'workbench-document-1');
assert.equal(claimed.operation, null);
await assert.rejects(manager.claim({ ...sender, tabId: 78 }), /SESSION_NOT_FOUND/u);
await assert.rejects(manager.claim({ ...sender, frameId: 1 }), /SESSION_SENDER_DENIED/u);

const unresolved = await manager.beginOperation(sender, 'generate-unresolved-1');
assert.deepEqual(JSON.parse(JSON.stringify(unresolved.operation)), {
  idempotencyKey: 'generate-unresolved-1',
  state: 'OUTCOME_UNRESOLVED',
});
const restoredManager = api.createManager({
  sessionStorage: storage,
  tabs: {
    async create(value) { created.push(value); return { id: 77 }; },
    async update(id, value) { updated.push({ id, value }); return { id }; },
    async remove(id) { removed.push(id); },
  },
  runtime: { getURL(path) { return `chrome-extension://extension-id/${path}`; } },
  now: () => now,
});
const restored = await restoredManager.claim(sender);
assert.equal(restored.operation.state, 'OUTCOME_UNRESOLVED');
await assert.rejects(
  restoredManager.beginOperation(sender, 'generate-second-1'),
  /SESSION_OPERATION_CONFLICT/u,
);
await assert.rejects(
  restoredManager.beginOperation(sender, 'generate-unresolved-1'),
  /SESSION_OPERATION_CONFLICT/u,
);
const operationCleared = await restoredManager.clearOperation(sender, 'generate-unresolved-1');
assert.equal(operationCleared.operation, null);

now += api.DEFAULT_TTL_MS - 1;
await restoredManager.beginOperation(sender, 'generate-success-1');
now += 2 * 60 * 1000;
const candidate = await restoredManager.attachResult(sender, {
  resultId: 'br_' + 'a'.repeat(48),
  reviewState: 'CANDIDATE_READY',
}, 'generate-success-1');
assert.equal(candidate.result.reviewState, 'CANDIDATE_READY');
assert.equal(candidate.operation, null);
await assert.rejects(
  restoredManager.attachResult(
    sender,
    { resultId: 'br_' + 'b'.repeat(48), reviewState: 'CANDIDATE_READY' },
    'generate-success-1',
  ),
  /SESSION_RESULT_CONFLICT/u,
);
const approved = await restoredManager.setReviewState(sender, candidate.result.resultId, 'APPROVED');
assert.equal(approved.result.reviewState, 'APPROVED');
const cleared = await restoredManager.clearResult(sender, candidate.result.resultId);
assert.equal(cleared.result, null);

now += api.DEFAULT_TTL_MS + 1;
await assert.rejects(restoredManager.claim(sender), /SESSION_NOT_FOUND/u);
await assert.rejects(
  restoredManager.beginOperation(sender, 'generate-expired-1'),
  /SESSION_NOT_FOUND/u,
  'an expired session cannot be revived by operation renewal',
);

await manager.open({
  context: launchContext,
  sourceTabId: 12,
  sourceDocumentId: 'source-document-1',
});
const postExpirySender = { tabId: 77, documentId: 'post-expiry-document', frameId: 0 };
await manager.claim(postExpirySender);
await manager.beginOperation(postExpirySender, 'generate-before-reload-1');
const beforeReload = await manager.attachResult(postExpirySender, {
  resultId: 'br_' + 'c'.repeat(48), reviewState: 'CANDIDATE_READY',
}, 'generate-before-reload-1');
await assert.rejects(
  manager.claim({ ...postExpirySender, documentId: 'reloaded-document' }),
  (error) => error
    && /SESSION_SENDER_DENIED/u.test(String(error.code))
    && error.discardedResultId === beforeReload.result.resultId,
);
assert.equal(await manager.removeByTab(77), 0, 'document mismatch consumes the stale session');
assert.equal(await manager.removeByTab(77), 0);
assert.equal(removed.length, 0, 'session cleanup does not close a user-owned tab');

await manager.open({
  context: launchContext,
  sourceTabId: 12,
  sourceDocumentId: 'source-document-1',
});
const taken = await manager.takeByTab(77);
assert.equal(taken.context.workflowId, 'workflow-1');
assert.equal(taken.workbenchTabId, 77);
assert.equal(await manager.takeByTab(77), null);

await assert.rejects(
  manager.open({ context: { ...launchContext, slotKey: 'sku:sku-1:detail' }, sourceTabId: 12, sourceDocumentId: 'source-document-1' }),
  /SESSION_CONTEXT_INVALID/u,
);
assert.equal(created.length, 3, 'invalid launch fails before opening a tab');

console.log('extension BYOK workbench launch session tests passed');
