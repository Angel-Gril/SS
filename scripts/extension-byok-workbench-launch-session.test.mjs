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
const discardedResults = [];
const manager = api.createManager({
  sessionStorage: storage,
  tabs: {
    async create(value) { created.push(value); return { id: 77 }; },
    async update(id, value) { updated.push({ id, value }); return { id }; },
    async remove(id) { removed.push(id); },
  },
  runtime: { getURL(path) { return `chrome-extension://extension-id/${path}`; } },
  now: () => now,
  onDiscardedResult(resultId) { discardedResults.push(resultId); },
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
  onDiscardedResult(resultId) { discardedResults.push(resultId); },
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
const ingestAuthority = {
  ownerUserId: 'owner-1', deviceSessionId: 'session-1',
  shopId: 'shop-1', workflowId: 'workflow-1',
  draftRevision: 3, draftVersion: 4, policyRevision: 'policy-7',
};
const ingestRequestHash = '3'.repeat(64);
const ingesting = await restoredManager.beginIngest(
  sender,
  candidate.result.resultId,
  'wb_ingest_' + 'a'.repeat(48),
  ingestAuthority,
);
assert.equal(ingesting.result.deliveryState, 'INGESTING');
assert.equal(ingesting.result.ingestRequestHash, null);
assert.deepEqual(JSON.parse(JSON.stringify(ingesting.result.ingestAuthority)), ingestAuthority);
const ingestReceipt = {
  contractVersion: 'extension-byok-generated-asset-ingest-client/v1',
  replayed: false,
  receiptId: 'receipt-1', assetId: 'asset-1', provenanceId: 'provenance-1',
  normalizedSha256: 'd'.repeat(64), mimeType: 'image/png', width: 1024, height: 1024,
  sourceDraftRevision: 3, sourceDraftVersion: 4,
  boundDraftRevision: 4, boundDraftVersion: 5,
  assignmentOrdinal: 0, assignmentSha256: 'e'.repeat(64),
  skuKey: 'sku-1', slotKey: 'sku:sku-1:hero',
};
await assert.rejects(
  restoredManager.setIngestResult(
    sender,
    candidate.result.resultId,
    'wb_ingest_' + 'a'.repeat(48),
    ingestAuthority,
    ingestReceipt,
  ),
  /SESSION_RESULT_CONFLICT/u,
  'a BOUND receipt requires the exact pre-binary request hash',
);
const reloadedDeliverySender = { ...sender, documentId: 'reloaded-delivery-document' };
const reboundIngesting = await restoredManager.claim(reloadedDeliverySender);
assert.equal(reboundIngesting.workbenchDocumentId, 'reloaded-delivery-document');
const hashedIngesting = await restoredManager.setIngestRequestHash(
  sender,
  candidate.result.resultId,
  'wb_ingest_' + 'a'.repeat(48),
  ingestRequestHash,
);
assert.equal(hashedIngesting.result.ingestRequestHash, ingestRequestHash);
assert.equal(
  hashedIngesting.workbenchDocumentId,
  'reloaded-delivery-document',
  'a late old-document commit must not rebind the session back to the old document',
);
const bound = await restoredManager.setIngestResult(
  sender,
  candidate.result.resultId,
  'wb_ingest_' + 'a'.repeat(48),
  ingestAuthority,
  ingestReceipt,
);
assert.equal(bound.result.deliveryState, 'BOUND');
assert.equal(bound.result.ingestRequestHash, ingestRequestHash);
assert.equal(bound.workbenchDocumentId, 'reloaded-delivery-document');
assert.equal(bound.result.ingestIdempotencyKey, 'wb_ingest_' + 'a'.repeat(48));
assert.equal(bound.result.ingest.receiptId, 'receipt-1');
assert.equal(bound.result.ingest.boundDraftVersion, 5);
assert.deepEqual(
  JSON.parse(JSON.stringify(await restoredManager.setIngestResult(
    sender,
    candidate.result.resultId,
    'wb_ingest_' + 'a'.repeat(48),
    ingestAuthority,
    ingestReceipt,
  ))),
  JSON.parse(JSON.stringify(bound)),
  'the exact bound receipt must replay without changing session state',
);
const reboundSender = { ...sender, documentId: 'reloaded-bound-document' };
const rebound = await restoredManager.claim(reboundSender);
assert.equal(rebound.result.deliveryState, 'BOUND');
assert.equal(rebound.workbenchDocumentId, 'reloaded-bound-document');
const cleared = await restoredManager.clearResult(
  reboundSender,
  candidate.result.resultId,
);
assert.equal(cleared.result, null);

await restoredManager.beginOperation(reboundSender, 'generate-expiring-1');
const expiring = await restoredManager.attachResult(reboundSender, {
  resultId: 'br_' + 'f'.repeat(48),
  reviewState: 'CANDIDATE_READY',
}, 'generate-expiring-1');

now += api.DEFAULT_TTL_MS + 1;
await assert.rejects(restoredManager.claim(reboundSender), /SESSION_NOT_FOUND/u);
assert.ok(
  discardedResults.includes(expiring.result.resultId),
  'session expiry must notify the runtime so its Blob and preview can be released',
);
await assert.rejects(
  restoredManager.beginOperation(reboundSender, 'generate-expired-1'),
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

const cleanupStorage = storageArea();
const sessionStorageKey = 'ss-erp:byok:workbench-launch-sessions:v1';
const cleanupCreatedAt = now;
const cleanupExpiresAt = now + api.DEFAULT_TTL_MS;
function persistedSession(tabId, result, operation = null) {
  return {
    contractVersion: 'extension-byok-workbench-launch-session/v1',
    context: launchContext,
    sourceTabId: 12,
    sourceDocumentId: 'source-document-1',
    workbenchTabId: tabId,
    workbenchDocumentId: 'cleanup-document-' + tabId,
    operation,
    result,
    createdAt: cleanupCreatedAt,
    expiresAt: cleanupExpiresAt,
  };
}
const candidateResultId = 'br_' + '6'.repeat(48);
const ingestingResultId = 'br_' + '7'.repeat(48);
const boundResultId = 'br_' + '8'.repeat(48);
cleanupStorage.values[sessionStorageKey] = {
  91: persistedSession(91, { resultId: candidateResultId, reviewState: 'CANDIDATE_READY' }),
  92: persistedSession(92, null, {
    idempotencyKey: 'provider-cleanup-operation', state: 'OUTCOME_UNRESOLVED',
  }),
  93: persistedSession(93, {
    resultId: ingestingResultId,
    reviewState: 'APPROVED',
    deliveryState: 'INGESTING',
    ingestIdempotencyKey: 'wb_ingest_' + '7'.repeat(48),
    ingestRequestHash,
    ingestAuthority,
    ingest: null,
  }),
  94: persistedSession(94, {
    resultId: boundResultId,
    reviewState: 'APPROVED',
    deliveryState: 'BOUND',
    ingestIdempotencyKey: 'wb_ingest_' + '8'.repeat(48),
    ingestRequestHash,
    ingestAuthority,
    ingest: ingestReceipt,
  }),
};
const cleanupDiscarded = [];
const cleanupManager = api.createManager({
  sessionStorage: cleanupStorage,
  tabs: { async create() {}, async update() {}, async remove() {} },
  runtime: { getURL(path) { return `chrome-extension://extension-id/${path}`; } },
  now: () => now,
  onDiscardedResult(resultId) { cleanupDiscarded.push(resultId); },
});
const providerCleanup = await cleanupManager.clearProviderState();
assert.deepEqual(
  [...providerCleanup.preservedResultIds].sort(),
  [boundResultId, ingestingResultId].sort(),
);
const cleanedRecords = cleanupStorage.values[sessionStorageKey];
assert.equal(cleanedRecords['91'].result, null);
assert.equal(cleanedRecords['92'].operation, null);
assert.equal(cleanedRecords['93'].result.deliveryState, 'INGESTING');
assert.equal(cleanedRecords['94'].result.deliveryState, 'BOUND');
assert.deepEqual(cleanupDiscarded, [candidateResultId]);

console.log('extension BYOK workbench launch session tests passed');
