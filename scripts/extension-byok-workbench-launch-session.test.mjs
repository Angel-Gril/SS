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
const batchRecoveryPreparing = {
  contractVersion: 'extension-byok-workbench-batch-recovery/v1',
  phase: 'PREPARING',
  reservationIdempotencyKey: 'byok-reservation:00000000-0000-4000-8000-000000000001',
  executionBatchId: null,
  context: {
    shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
  },
  slots: [
    { skuKey: 'sku-1', slotKey: 'sku:sku-1:hero', operation: 'TEXT_TO_IMAGE' },
    { skuKey: 'sku-1', slotKey: 'shared:detail:DETAIL', operation: 'FULL_EDIT' },
  ],
};
const batchRecoveryPreparingV2 = {
  ...batchRecoveryPreparing,
  contractVersion: 'extension-byok-workbench-batch-recovery/v2',
  successorRecovery: null,
  profileId: 'profile-1',
};
const successorRecovery = {
  contractVersion: 'extension-byok-workbench-successor-recovery/v1',
  state: 'CLAIMING',
  itemIndex: 0,
  assignmentOrdinal: 0,
  predecessorIntentId: 'intent-1',
  predecessorGeneration: 1,
  requestMode: 'json',
  providerIdempotencyKey: 'byok-provider:00000000-0000-4000-8000-000000000002',
  providerRequestHash: 'a'.repeat(64),
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
  recovery: null,
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
await assert.rejects(
  restoredManager.beginOperation(sender, 'sk-' + 'a'.repeat(24)),
  /SESSION_OPERATION_INVALID/u,
  'a credential-shaped operation identity is rejected before persistence',
);

const batchUnresolved = await restoredManager.beginOperation(
  sender,
  'byok_batch_recovery_1',
  batchRecoveryPreparing,
);
assert.equal(batchUnresolved.operation.recovery.phase, 'PREPARING');
assert.equal(batchUnresolved.operation.recovery.executionBatchId, null);
assert.equal(JSON.stringify(batchUnresolved.operation).includes('prompt'), false);
assert.equal(JSON.stringify(batchUnresolved.operation).includes('apiKey'), false);
const batchReloadSender = { ...sender, documentId: 'workbench-document-batch-reload' };
const reboundBatch = await restoredManager.claim(batchReloadSender);
assert.equal(reboundBatch.workbenchDocumentId, batchReloadSender.documentId);
assert.equal(reboundBatch.operation.recovery.phase, 'PREPARING');
assert.deepEqual(
  Object.keys(storage.values[api.STORAGE_KEY]['77'].operation).sort(),
  ['idempotencyKey', 'state'],
  'the legacy v1 session record must remain readable by the previous extension version',
);
assert.equal(
  storage.values[api.STORAGE_KEY]['77'].workbenchDocumentId,
  null,
  'the previous package may bind its new reload document without consuming the unresolved lock',
);
assert.equal(
  storage.values[api.STORAGE_KEY]['77'].expiresAt,
  now + api.DEFAULT_TTL_MS,
  'the rollback-readable base record receives a current legacy lease',
);
assert.equal(
  storage.values[api.BATCH_RECOVERY_STORAGE_KEY]['77'].recovery.phase,
  'PREPARING',
  'new recovery state must live outside the rollback-compatible v1 session record',
);
await assert.rejects(
  restoredManager.claim(sender),
  /SESSION_SENDER_DENIED/u,
  'a retired document cannot reclaim a protected operation',
);
await assert.rejects(
  restoredManager.clearOperation(sender, 'byok_batch_recovery_1'),
  /SESSION_SENDER_DENIED/u,
  'a retired document cannot clear the protected operation',
);
await assert.rejects(
  restoredManager.updateOperationRecovery(sender, 'byok_batch_recovery_1', {
    ...batchRecoveryPreparing,
    phase: 'RESERVED',
    executionBatchId: 'execution-batch-retired',
  }),
  /SESSION_SENDER_DENIED/u,
  'a retired document cannot update the protected recovery descriptor',
);
now += api.DEFAULT_TTL_MS + 1;
assert.equal(
  (await restoredManager.claim(batchReloadSender)).operation.recovery.phase,
  'PREPARING',
  'an unresolved operation survives the normal session TTL',
);
const reservedRecovery = {
  ...batchRecoveryPreparing,
  phase: 'RESERVED',
  executionBatchId: 'execution-batch-1',
};
const batchReserved = await restoredManager.updateOperationRecovery(
  batchReloadSender,
  'byok_batch_recovery_1',
  reservedRecovery,
);
assert.equal(batchReserved.operation.recovery.executionBatchId, 'execution-batch-1');
const batchDispatching = await restoredManager.updateOperationRecovery(
  batchReloadSender,
  'byok_batch_recovery_1',
  { ...reservedRecovery, phase: 'DISPATCHING' },
);
assert.equal(batchDispatching.operation.recovery.phase, 'DISPATCHING');
const batchSuccessorClaiming = await restoredManager.updateOperationRecovery(
  batchReloadSender,
  'byok_batch_recovery_1',
  { ...reservedRecovery, phase: 'DISPATCHING', successorRecovery },
);
assert.deepEqual(
  JSON.parse(JSON.stringify(batchSuccessorClaiming.operation.recovery.successorRecovery)),
  successorRecovery,
);
assert.deepEqual(
  JSON.parse(JSON.stringify(
    storage.values[api.BATCH_RECOVERY_STORAGE_KEY]['77'].recovery.successorRecovery,
  )),
  successorRecovery,
  'the non-secret successor recovery evidence survives session persistence',
);
const persistedSuccessorEvidence = JSON.stringify(
  storage.values[api.BATCH_RECOVERY_STORAGE_KEY]['77'].recovery.successorRecovery,
);
for (const forbidden of ['https', 'providerOrigin', 'model', 'prompt', 'apiKey']) {
  assert.equal(persistedSuccessorEvidence.includes(forbidden), false);
}
await assert.rejects(
  restoredManager.updateOperationRecovery(batchReloadSender, 'byok_batch_recovery_1', {
    ...reservedRecovery,
    phase: 'DISPATCHING',
    successorRecovery: { ...successorRecovery, predecessorIntentId: 'intent-other' },
  }),
  /SESSION_OPERATION_CONFLICT/u,
  'an in-flight successor sidecar cannot be replaced with different evidence',
);
await assert.rejects(
  restoredManager.updateOperationRecovery(batchReloadSender, 'byok_batch_recovery_1', {
    ...reservedRecovery,
    phase: 'DISPATCHING',
    successorRecovery: {
      ...successorRecovery,
      providerIdempotencyKey: 'sk-' + 'c'.repeat(24),
    },
  }),
  /SESSION_OPERATION_INVALID/u,
  'credential-shaped successor evidence is rejected before persistence',
);
const batchSuccessorHandoff = await restoredManager.updateOperationRecovery(
  batchReloadSender,
  'byok_batch_recovery_1',
  {
    ...reservedRecovery,
    phase: 'DISPATCHING',
    successorRecovery: { ...successorRecovery, state: 'HANDOFF_STARTED' },
  },
);
assert.equal(batchSuccessorHandoff.operation.recovery.successorRecovery.state, 'HANDOFF_STARTED');
const batchSuccessorResolved = await restoredManager.updateOperationRecovery(
  batchReloadSender,
  'byok_batch_recovery_1',
  { ...reservedRecovery, phase: 'DISPATCHING', successorRecovery: null },
);
assert.equal(batchSuccessorResolved.operation.recovery.successorRecovery, null);
await assert.rejects(
  restoredManager.updateOperationRecovery(batchReloadSender, 'byok_batch_recovery_1', {
    ...reservedRecovery, phase: 'DISPATCHING',
    executionBatchId: 'execution-batch-other',
  }),
  /SESSION_OPERATION_CONFLICT/u,
);
await assert.rejects(
  restoredManager.updateOperationRecovery(batchReloadSender, 'byok_batch_recovery_1', {
    ...reservedRecovery,
    phase: 'DISPATCHING',
    executionBatchId: 'sk-' + 'b'.repeat(24),
  }),
  /SESSION_OPERATION_INVALID/u,
  'a credential-shaped server batch identity is rejected before persistence',
);
assert.equal(
  await restoredManager.takeByTabIfIdle(77),
  null,
  'tab cleanup must not delete a persisted batch whose Provider outcome may be unresolved',
);
assert.equal(
  (await restoredManager.claim(batchReloadSender)).operation.recovery.phase,
  'DISPATCHING',
);
await restoredManager.clearOperation(batchReloadSender, 'byok_batch_recovery_1');
assert.equal(
  Object.hasOwn(storage.values[api.BATCH_RECOVERY_STORAGE_KEY], '77'),
  false,
  'clearing the operation also clears its separate recovery descriptor',
);

await assert.rejects(
  restoredManager.beginOperation(batchReloadSender, 'byok_batch_recovery_invalid_v2', {
    ...batchRecoveryPreparingV2,
    profileId: undefined,
  }),
  /SESSION_OPERATION_INVALID/u,
  'recovery v2 requires one canonical non-secret profile identity',
);
const batchV2 = await restoredManager.beginOperation(
  batchReloadSender,
  'byok_batch_recovery_v2',
  batchRecoveryPreparingV2,
);
assert.equal(batchV2.operation.recovery.contractVersion, api.BATCH_RECOVERY_VERSION);
assert.equal(batchV2.operation.recovery.profileId, 'profile-1');
assert.equal(
  storage.values[api.BATCH_RECOVERY_STORAGE_KEY]['77'].recovery.profileId,
  'profile-1',
  'recovery v2 retains the non-secret profile ID only in its sidecar',
);
await assert.rejects(
  restoredManager.updateOperationRecovery(batchReloadSender, 'byok_batch_recovery_v2', {
    ...batchRecoveryPreparingV2,
    phase: 'RESERVED',
    executionBatchId: 'execution-batch-v2',
    profileId: 'profile-other',
  }),
  /SESSION_OPERATION_CONFLICT/u,
  'an active recovery cannot switch its profile identity',
);
await restoredManager.clearOperation(batchReloadSender, 'byok_batch_recovery_v2');

await restoredManager.beginOperation(batchReloadSender, 'replacement-operation');
storage.values[api.BATCH_RECOVERY_STORAGE_KEY]['77'] = {
  operationIdempotencyKey: 'byok_batch_recovery_1',
  recovery: batchRecoveryPreparing,
};
const staleRecoveryManager = api.createManager({
  sessionStorage: storage,
  tabs: {
    async create(value) { created.push(value); return { id: 77 }; },
    async update(id, value) { updated.push({ id, value }); return { id }; },
    async remove(id) { removed.push(id); },
  },
  runtime: { getURL(path) { return `chrome-extension://extension-id/${path}`; } },
  now: () => now,
});
assert.equal(
  (await staleRecoveryManager.claim(batchReloadSender)).operation.recovery,
  null,
  'a stale sidecar cannot attach another operation\'s batch recovery identity',
);
await staleRecoveryManager.clearOperation(batchReloadSender, 'replacement-operation');

now += api.DEFAULT_TTL_MS - 1;
await restoredManager.beginOperation(batchReloadSender, 'generate-success-1');
now += 2 * 60 * 1000;
const candidate = await restoredManager.attachResult(batchReloadSender, {
  resultId: 'br_' + 'a'.repeat(48),
  reviewState: 'CANDIDATE_READY',
}, 'generate-success-1');
assert.equal(candidate.result.reviewState, 'CANDIDATE_READY');
assert.equal(candidate.operation, null);
await assert.rejects(
  restoredManager.attachResult(
    batchReloadSender,
    { resultId: 'br_' + 'b'.repeat(48), reviewState: 'CANDIDATE_READY' },
    'generate-success-1',
  ),
  /SESSION_RESULT_CONFLICT/u,
);
const approved = await restoredManager.setReviewState(
  batchReloadSender,
  candidate.result.resultId,
  'APPROVED',
);
assert.equal(approved.result.reviewState, 'APPROVED');
const ingestAuthority = {
  ownerUserId: 'owner-1', deviceSessionId: 'session-1',
  shopId: 'shop-1', workflowId: 'workflow-1',
  draftRevision: 3, draftVersion: 4, policyRevision: 'policy-7',
};
const ingestRequestHash = '3'.repeat(64);
const ingesting = await restoredManager.beginIngest(
  batchReloadSender,
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
  batchReloadSender,
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
  batchReloadSender,
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
    batchReloadSender,
    candidate.result.resultId,
    'wb_ingest_' + 'a'.repeat(48),
    ingestAuthority,
    ingestReceipt,
  ))),
  JSON.parse(JSON.stringify(bound)),
  'the exact bound receipt must replay without changing session state',
);
await assert.rejects(
  restoredManager.clearResult(batchReloadSender, candidate.result.resultId),
  /SESSION_SENDER_DENIED/u,
  'a retired document cannot delete a bound result owned by the current document',
);
assert.equal(
  (await restoredManager.claim(reloadedDeliverySender)).result.deliveryState,
  'BOUND',
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
assert.equal(cleanedRecords['92'].operation.state, 'OUTCOME_UNRESOLVED');
assert.deepEqual(
  Object.keys(cleanedRecords['92'].operation).sort(),
  ['idempotencyKey', 'state'],
);
assert.equal(cleanedRecords['93'].result.deliveryState, 'INGESTING');
assert.equal(cleanedRecords['94'].result.deliveryState, 'BOUND');
assert.deepEqual(cleanupDiscarded, [candidateResultId]);

const capacityStorage = storageArea();
const capacityKey = api.STORAGE_KEY;
const expiredCreatedAt = now - api.DEFAULT_TTL_MS - 1;
const expiredExpiresAt = now - 1;
capacityStorage.values[capacityKey] = {
  101: {
    ...persistedSession(101, null, {
      idempotencyKey: 'protected-operation', state: 'OUTCOME_UNRESOLVED',
    }),
    createdAt: expiredCreatedAt,
    expiresAt: expiredExpiresAt,
  },
  102: {
    ...persistedSession(102, {
      resultId: ingestingResultId,
      reviewState: 'APPROVED', deliveryState: 'INGESTING',
      ingestIdempotencyKey: 'wb_ingest_' + '7'.repeat(48),
      ingestRequestHash, ingestAuthority, ingest: null,
    }),
    createdAt: expiredCreatedAt,
    expiresAt: expiredExpiresAt,
  },
  103: {
    ...persistedSession(103, {
      resultId: boundResultId,
      reviewState: 'APPROVED', deliveryState: 'BOUND',
      ingestIdempotencyKey: 'wb_ingest_' + '8'.repeat(48),
      ingestRequestHash, ingestAuthority, ingest: ingestReceipt,
    }),
    createdAt: expiredCreatedAt,
    expiresAt: expiredExpiresAt,
  },
};
const capacityRemoved = [];
const capacityManager = api.createManager({
  sessionStorage: capacityStorage,
  tabs: {
    async create() { return { id: 104 }; },
    async update() { throw new Error('capacity rejection must happen before navigation'); },
    async remove(id) { capacityRemoved.push(id); },
  },
  runtime: { getURL(path) { return `chrome-extension://extension-id/${path}`; } },
  now: () => now,
  limit: 3,
});
await assert.rejects(
  capacityManager.open({
    context: launchContext,
    sourceTabId: 12,
    sourceDocumentId: 'capacity-source-document',
  }),
  /SESSION_CAPACITY_EXCEEDED/u,
  'capacity pressure must never evict unresolved, ingesting, or bound state',
);
assert.deepEqual(Object.keys(capacityStorage.values[capacityKey]).sort(), ['101', '102', '103']);
assert.deepEqual(capacityRemoved, [104]);

function reusableTabs(firstTabId) {
  let nextTabId = firstTabId;
  const live = new Map();
  const createdTabs = [];
  const readTabs = [];
  const updatedTabs = [];
  return {
    createdTabs,
    readTabs,
    updatedTabs,
    close(tabId) { live.delete(tabId); },
    navigate(tabId, url) {
      const tab = live.get(tabId);
      if (!tab) throw new Error('test tab is not live');
      live.set(tabId, { ...tab, url });
    },
    api: {
      async create(value) {
        const id = nextTabId++;
        createdTabs.push({ id, value });
        live.set(id, { id, url: value.url });
        return { id, url: value.url };
      },
      async get(id) {
        readTabs.push(id);
        const tab = live.get(id);
        if (!tab) throw new Error('No tab with id: ' + id);
        return { ...tab };
      },
      async update(id, value) {
        const tab = live.get(id);
        if (!tab) throw new Error('No tab with id: ' + id);
        updatedTabs.push({ id, value });
        const updated = { ...tab, ...value, id };
        live.set(id, updated);
        return { ...updated };
      },
      async remove(id) { live.delete(id); },
    },
  };
}

const reuseStorage = storageArea();
const reuseTabs = reusableTabs(201);
const reuseManager = api.createManager({
  sessionStorage: reuseStorage,
  tabs: reuseTabs.api,
  runtime: { getURL(path) { return `chrome-extension://extension-id/${path}`; } },
  now: () => now,
});
const exactLaunch = {
  context: launchContext,
  sourceTabId: 12,
  sourceDocumentId: 'source-document-reuse',
};
const concurrentOpen = await Promise.all([
  reuseManager.open(exactLaunch),
  reuseManager.open(exactLaunch),
]);
assert.deepEqual(
  concurrentOpen.map((value) => JSON.parse(JSON.stringify(value))),
  [
    { state: 'workbench_opened', tabId: 201 },
    { state: 'workbench_focused', tabId: 201 },
  ],
  'concurrent exact-context opens reuse one workbench tab',
);
assert.equal(reuseTabs.createdTabs.length, 1, 'a double click creates one workbench tab');
assert.equal(
  reuseTabs.updatedTabs.filter((entry) => Object.hasOwn(entry.value, 'url')).length,
  1,
  'an exact-context reuse focuses without navigating the workbench again',
);

const reuseSender = { tabId: 201, documentId: 'workbench-document-reuse', frameId: 0 };
await reuseManager.claim(reuseSender);
await reuseManager.beginOperation(reuseSender, 'pending-reuse-operation');
await reuseManager.open(exactLaunch);
assert.equal(reuseTabs.createdTabs.length, 1, 'an unresolved operation reopens by focusing');
assert.equal(
  (await reuseManager.claim(reuseSender)).operation.idempotencyKey,
  'pending-reuse-operation',
  'focusing an existing tab preserves its unresolved operation',
);
const pendingReuseResult = await reuseManager.attachResult(reuseSender, {
  resultId: 'br_' + '9'.repeat(48),
  reviewState: 'CANDIDATE_READY',
}, 'pending-reuse-operation');
await reuseManager.open(exactLaunch);
assert.equal(reuseTabs.createdTabs.length, 1, 'a pending result reopens by focusing');
assert.equal(
  (await reuseManager.claim(reuseSender)).result.resultId,
  pendingReuseResult.result.resultId,
  'focusing an existing tab preserves its pending result',
);

const changedContexts = [
  { ...launchContext, draftRevision: launchContext.draftRevision + 1 },
  { ...launchContext, draftVersion: launchContext.draftVersion + 1 },
  {
    ...launchContext,
    skuKey: 'sku-2',
    slotKey: 'sku:sku-2:hero',
  },
];
for (const changedContext of changedContexts) {
  await reuseManager.open({ ...exactLaunch, context: changedContext });
}
await reuseManager.open({ ...exactLaunch, sourceTabId: exactLaunch.sourceTabId + 1 });
await reuseManager.open({ ...exactLaunch, sourceDocumentId: 'source-document-reuse-other' });
assert.equal(
  reuseTabs.createdTabs.length,
  6,
  'draft, SKU, source tab, and source document changes require distinct workbench sessions',
);

const replacementStorage = storageArea();
const replacementTabs = reusableTabs(301);
const replacementManager = api.createManager({
  sessionStorage: replacementStorage,
  tabs: replacementTabs.api,
  runtime: { getURL(path) { return `chrome-extension://extension-id/${path}`; } },
  now: () => now,
});
const replacementLaunch = {
  context: launchContext,
  sourceTabId: 44,
  sourceDocumentId: 'source-document-replacement',
};
const originalReplacement = await replacementManager.open(replacementLaunch);
const originalReplacementSender = {
  tabId: originalReplacement.tabId,
  documentId: 'workbench-document-replacement-original',
  frameId: 0,
};
await replacementManager.claim(originalReplacementSender);
await replacementManager.beginOperation(originalReplacementSender, 'replacement-operation');
replacementTabs.close(originalReplacement.tabId);
const replacedMissing = await replacementManager.open(replacementLaunch);
assert.equal(replacedMissing.tabId, 302, 'a missing workbench tab is replaced');
assert.deepEqual(
  Object.keys(replacementStorage.values[api.STORAGE_KEY]),
  ['302'],
  'the missing tab session key is replaced atomically',
);
const replacementSender = {
  tabId: replacedMissing.tabId,
  documentId: 'workbench-document-replacement-new',
  frameId: 0,
};
assert.equal(
  (await replacementManager.claim(replacementSender)).operation.idempotencyKey,
  'replacement-operation',
  'replacing a missing tab preserves unresolved recovery state',
);
await replacementManager.clearOperation(replacementSender, 'replacement-operation');
await replacementManager.beginOperation(replacementSender, 'replacement-result-operation');
const replacementResult = await replacementManager.attachResult(replacementSender, {
  resultId: 'br_' + 'd'.repeat(48),
  reviewState: 'CANDIDATE_READY',
}, 'replacement-result-operation');
replacementTabs.navigate(replacedMissing.tabId, 'https://example.invalid/not-the-workbench');
const replacedInvalid = await replacementManager.open(replacementLaunch);
assert.equal(replacedInvalid.tabId, 303, 'a navigated-away workbench tab is replaced');
assert.deepEqual(Object.keys(replacementStorage.values[api.STORAGE_KEY]), ['303']);
assert.equal(
  (await replacementManager.claim({
    tabId: replacedInvalid.tabId,
    documentId: 'workbench-document-replacement-final',
    frameId: 0,
  })).result.resultId,
  replacementResult.result.resultId,
  'replacing an invalid tab preserves its pending result',
);

for (const entry of [
  ...reuseTabs.createdTabs.map((item) => item.value),
  ...reuseTabs.updatedTabs.map((item) => item.value),
  ...replacementTabs.createdTabs.map((item) => item.value),
  ...replacementTabs.updatedTabs.map((item) => item.value),
]) {
  if (!entry.url) continue;
  const parsed = new URL(entry.url);
  assert.equal(parsed.search, '', 'workbench URLs never carry launch context in a query');
  assert.equal(parsed.hash, '', 'workbench URLs never carry launch context in a fragment');
}

console.log('extension BYOK workbench launch session tests passed');
