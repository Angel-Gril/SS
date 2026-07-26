import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const modulePath = 'extensions/ss-erp/shared/byok/workbench-runtime-handler.js';
const context = {
  Array, Boolean, Date, Error, Map, Math, Number, Object, Promise, Set, String,
};
context.globalThis = context;
vm.runInNewContext(readFileSync(modulePath, 'utf8'), context, { filename: modulePath });
const api = context.SS_ERP_BYOK_WORKBENCH_RUNTIME_HANDLER;

const MESSAGE_TYPES = {
  GET_PUBLIC_STATE: 'state',
  GET_READINESS: 'readiness',
  EXECUTE_PROVIDER: 'execute',
  OPEN_PREVIEW: 'preview',
  REVIEW_RESULT: 'review',
};
const launchContext = {
  contractVersion: 'extension-byok-workbench-launch-context/v1',
  sourcePlatform: '1688', sourceProductId: 'product-1',
  sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
  shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
  skuKey: 'sku-1', slotKey: 'sku:sku-1:hero', assignmentMode: 'APPEND',
  assignmentOrdinal: 2,
};
const binding = {
  contractVersion: 'extension-byok-readiness-binding/v2',
  ownerUserId: 'owner-1', deviceSessionId: 'session-1',
  ...launchContext,
  contractVersion: 'extension-byok-readiness-binding/v2',
  providerOrigin: 'https://relay.example', model: 'image-model-v1',
  operation: 'TEXT_TO_IMAGE', policyRevision: 'policy-7',
};
const sender = { tabId: 77, documentId: 'document-1', frameId: 0 };
const resultId = 'br_' + 'a'.repeat(48);
const publicResult = {
  contractVersion: 'extension-byok-result-vault/v1', resultId,
  outcome: 'SUCCEEDED', operation: 'TEXT_TO_IMAGE', requestMode: 'json',
  model: 'image-model-v1', policyRevision: 'policy-7',
  idempotencyKey: 'generate-1', requestHash: 'b'.repeat(64), promptHash: 'c'.repeat(64),
  acceptedAt: '2026-07-26T10:00:00.000Z', reviewState: 'CANDIDATE_READY',
  reviewedAt: null, expiresAt: '2026-07-26T10:10:00.000Z',
  image: { mimeType: 'image/png', byteLength: 4, sha256: 'd'.repeat(64) },
};
const entry = {
  ...publicResult,
  binding,
  lifecycleEpoch: 1,
  blob: { opaque: true }, mimeType: 'image/png', byteLength: 4, sha256: 'd'.repeat(64),
};

let session = {
  context: launchContext, sourceTabId: 12, sourceDocumentId: 'source-document-1',
  workbenchTabId: 77, workbenchDocumentId: 'document-1', operation: null, result: null,
};
const calls = [];
let reviewGate = null;
let claimFailure = null;
const sessionManager = {
  async open(value) { calls.push(['open', value]); return { state: 'workbench_opened', tabId: 77 }; },
  async claim(value) {
    calls.push(['claim', value]);
    if (claimFailure) throw claimFailure;
    return session;
  },
  sameContext(left, right) {
    return Object.keys(launchContext).every((key) => left[key] === right[key]);
  },
  async beginOperation(_sender, idempotencyKey) {
    if (session.operation || session.result) throw Object.assign(new Error('conflict'), {
      code: 'SS_ERP_BYOK_WORKBENCH_SESSION_OPERATION_CONFLICT',
    });
    session = { ...session, operation: { idempotencyKey, state: 'OUTCOME_UNRESOLVED' } };
    calls.push(['begin-operation', idempotencyKey]);
    return session;
  },
  async clearOperation(_sender, idempotencyKey) {
    if (!session.operation || session.operation.idempotencyKey !== idempotencyKey) {
      throw Object.assign(new Error('conflict'), {
        code: 'SS_ERP_BYOK_WORKBENCH_SESSION_OPERATION_CONFLICT',
      });
    }
    session = { ...session, operation: null };
    calls.push(['clear-operation', idempotencyKey]);
    return session;
  },
  async attachResult(_sender, result, idempotencyKey) {
    if (!session.operation || session.operation.idempotencyKey !== idempotencyKey) {
      throw Object.assign(new Error('conflict'), {
        code: 'SS_ERP_BYOK_WORKBENCH_SESSION_OPERATION_CONFLICT',
      });
    }
    session = { ...session, operation: null, result };
    calls.push(['attach', result, idempotencyKey]);
    return session;
  },
  async setReviewState(_sender, id, state) {
    if (reviewGate) await reviewGate.promise;
    session = { ...session, result: { resultId: id, reviewState: state } };
    calls.push(['review-state', state]);
    return session;
  },
  async clearResult(_sender, id) {
    calls.push(['clear-result', id]);
    session = { ...session, result: null };
    return session;
  },
  async takeByTab(id) {
    calls.push(['take-tab', id]);
    const previous = session;
    session = null;
    return previous;
  },
};
const launchClient = {
  async resolve(value) {
    calls.push(['resolve', value]);
    return launchContext;
  },
};
const profile = {
  id: 'profile-1', name: 'Relay', baseUrl: 'https://relay.example/v1',
  model: 'image-model-v1', allowedOperations: ['TEXT_TO_IMAGE'], preferences: {},
};
const evidence = {
  contractVersion: 'extension-byok-capability-evidence/v1', operation: 'TEXT_TO_IMAGE',
  requestMode: 'json', policyRevision: 'policy-7',
  verifiedAt: '2026-07-26T09:00:00.000Z', expiresAt: '2026-07-27T09:00:00.000Z',
};
const profileStore = {
  async listPublicProfiles() { return [profile]; },
  async getProfile(id) { return id === profile.id ? profile : null; },
  async getPublicState(id) {
    return id === profile.id ? { profile, hasKey: true, evidence: [evidence] } : null;
  },
};
const permissionBroker = {
  async hasOriginPermission() {
    return { origin: 'https://relay.example', granted: true };
  },
};
const readiness = {
  readinessHandle: 'rh_' + 'e'.repeat(48), readinessBinding: binding,
  expiresAt: '2026-07-26T10:10:00.000Z',
};
const readinessClient = {
  async getReadiness(value) { calls.push(['readiness', value]); return readiness; },
};
let providerFailure = null;
let providerOperationState = null;
let providerGate = null;
const providerClient = {
  async generate(value) {
    calls.push(['generate', value]);
    if (providerGate) await providerGate.promise;
    if (providerFailure) throw providerFailure;
    return { idempotencyKey: value.idempotencyKey, requestHash: 'b'.repeat(64) };
  },
  async commitResult(_key, _hash, commit) { return commit(entry); },
  releaseResult() { calls.push(['release-provider']); },
  getOperationState() { return providerOperationState; },
};
let vaultEntry = entry;
const vault = {
  put() { return publicResult; },
  getForBackground(id) {
    if (!vaultEntry || id !== resultId) throw Object.assign(new Error('missing'), { code: 'RESULT_MISSING' });
    return vaultEntry;
  },
  getPublic(id) { this.getForBackground(id); return { ...publicResult, reviewState: vaultEntry.reviewState }; },
  getPublicByOperation() { return publicResult; },
  approve() {
    vaultEntry = { ...vaultEntry, reviewState: 'APPROVED' };
    return { ...publicResult, reviewState: 'APPROVED', reviewedAt: '2026-07-26T10:01:00.000Z' };
  },
  reject() {
    if (!vaultEntry || vaultEntry.reviewState !== 'CANDIDATE_READY') {
      throw Object.assign(new Error('invalid review'), {
        code: 'SS_ERP_BYOK_RESULT_REVIEW_INVALID',
      });
    }
    vaultEntry = null;
    return { resultId, reviewState: 'REJECTED' };
  },
  release(id) { calls.push(['release-vault', id]); vaultEntry = null; return true; },
};
const authorityGuard = {
  async capture() { return { lifecycleAuthority: { epoch: 1 } }; },
  async commitGeneratedResult({ vault: selectedVault }) { return selectedVault.put(); },
  matchesVaultAuthority(candidate, expectedBinding) {
    return candidate === vaultEntry && expectedBinding === binding;
  },
};
const previewBroker = {
  open(candidate) {
    calls.push(['preview', candidate.resultId]);
    return { contractVersion: 'preview/v1', channelName: 'channel', previewTicket: 'ticket' };
  },
  releaseResult(id) { calls.push(['release-preview', id]); return 1; },
};

const dispatcher = api.createDispatcher({
  messageTypes: MESSAGE_TYPES,
  sessionManager, launchClient, profileStore, permissionBroker, readinessClient,
  providerClient, vault, authorityGuard, previewBroker,
  now: () => new Date('2026-07-26T10:00:00.000Z'),
});

const opened = await dispatcher.openFromSource({
  request: {
    sourcePlatform: '1688', sourceProductId: 'product-1',
    sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
    shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
  },
  sourceSender: { tabId: 12, documentId: 'source-document-1', frameId: 0 },
});
assert.deepEqual(JSON.parse(JSON.stringify(opened)), { state: 'workbench_opened', tabId: 77 });

const stateResponse = await dispatcher.handlers[MESSAGE_TYPES.GET_PUBLIC_STATE]({ payload: {}, sender });
assert.equal(stateResponse.ok, true);
assert.equal(stateResponse.data.executionMode, 'BYOK');
assert.equal(stateResponse.data.generationOutcome, null);
assert.equal(stateResponse.data.profiles[0].hasKey, true);
assert.equal(stateResponse.data.profiles[0].permissionState, 'GRANTED');
assert.equal(JSON.stringify(stateResponse).includes('apiKey'), false);

const readinessResponse = await dispatcher.handlers[MESSAGE_TYPES.GET_READINESS]({
  payload: { profileId: 'profile-1' }, sender,
});
assert.equal(readinessResponse.ok, true);
assert.deepEqual(JSON.parse(JSON.stringify(readinessResponse.data)), readiness);
const readinessCall = calls.find((row) => row[0] === 'readiness')[1];
assert.deepEqual(JSON.parse(JSON.stringify(readinessCall)), {
  profileId: 'profile-1', shopId: 'shop-1', workflowId: 'workflow-1',
  draftRevision: 3, draftVersion: 4, sourcePlatform: '1688',
  sourceProductId: 'product-1', sourceCaptureSnapshotId: 'snapshot-1',
  supplyGoodsId: 'goods-1', skuKey: 'sku-1', slotKey: 'sku:sku-1:hero',
  assignmentMode: 'APPEND', assignmentOrdinal: 2, operation: 'TEXT_TO_IMAGE',
});

const executeResponse = await dispatcher.handlers[MESSAGE_TYPES.EXECUTE_PROVIDER]({
  payload: {
    profileId: 'profile-1', prompt: 'Create a neutral catalog hero image',
    negativePrompt: null, size: '1024x1024', idempotencyKey: 'generate-1',
  },
  sender,
  authorization: { readiness: { binding } },
});
assert.equal(executeResponse.ok, true);
assert.equal(executeResponse.data.resultId, resultId);
assert.deepEqual(JSON.parse(JSON.stringify(session.result)), {
  resultId, reviewState: 'CANDIDATE_READY',
});
assert.equal(session.operation, null);

const previewResponse = await dispatcher.handlers[MESSAGE_TYPES.OPEN_PREVIEW]({
  payload: { resultId }, sender,
});
assert.equal(previewResponse.ok, true);
assert.equal(previewResponse.data.channelName, 'channel');

const approved = await dispatcher.handlers[MESSAGE_TYPES.REVIEW_RESULT]({
  payload: { resultId, decision: 'APPROVE' }, sender,
});
assert.equal(approved.ok, true);
assert.equal(approved.data.reviewState, 'APPROVED');
assert.equal(approved.data.deliveryState, 'NOT_INGESTED');
const rejectApproved = await dispatcher.handlers[MESSAGE_TYPES.REVIEW_RESULT]({
  payload: { resultId, decision: 'REJECT' }, sender,
});
assert.equal(rejectApproved.ok, false);
assert.equal(rejectApproved.errorCode, 'SS_ERP_BYOK_WORKBENCH_RESULT_REVIEW_INVALID');
assert.equal(session.result.reviewState, 'APPROVED');
assert.equal(vaultEntry.reviewState, 'APPROVED');

const removed = await dispatcher.removeTab(77);
assert.equal(removed, true);
assert.equal(calls.some((row) => row[0] === 'release-vault' && row[1] === resultId), true);
assert.equal(calls.some((row) => row[0] === 'release-preview' && row[1] === resultId), true);

session = {
  context: launchContext, sourceTabId: 12, sourceDocumentId: 'source-document-1',
  workbenchTabId: 77, workbenchDocumentId: 'document-1', operation: null, result: null,
};
vaultEntry = entry;
const rejectedBinding = { ...binding, skuKey: 'other', slotKey: 'sku:other:hero' };
const denied = await dispatcher.handlers[MESSAGE_TYPES.EXECUTE_PROVIDER]({
  payload: {
    profileId: 'profile-1', prompt: 'Do not dispatch', negativePrompt: null,
    size: '1024x1024', idempotencyKey: 'generate-2',
  },
  sender,
  authorization: { readiness: { binding: rejectedBinding } },
});
assert.equal(denied.ok, false);
assert.equal(denied.errorCode, 'SS_ERP_BYOK_WORKBENCH_CONTEXT_MISMATCH');
assert.equal(calls.filter((row) => row[0] === 'generate').length, 1);

let releaseProviderGate;
providerGate = {
  promise: new Promise((resolve) => { releaseProviderGate = resolve; }),
};
const firstConcurrent = dispatcher.handlers[MESSAGE_TYPES.EXECUTE_PROVIDER]({
  payload: {
    profileId: 'profile-1', prompt: 'The request that owns the session lock',
    negativePrompt: null, size: '1024x1024', idempotencyKey: 'generate-concurrent-1',
  },
  sender,
  authorization: { readiness: { binding } },
});
await new Promise((resolve) => setImmediate(resolve));
const conflictingConcurrent = await dispatcher.handlers[MESSAGE_TYPES.EXECUTE_PROVIDER]({
  payload: {
    profileId: 'profile-1', prompt: 'Different payload with the same key',
    negativePrompt: null, size: '1024x1024', idempotencyKey: 'generate-concurrent-1',
  },
  sender,
  authorization: { readiness: { binding } },
});
assert.equal(conflictingConcurrent.ok, false);
assert.equal(
  conflictingConcurrent.errorCode,
  'SS_ERP_BYOK_WORKBENCH_SESSION_OPERATION_CONFLICT',
);
assert.equal(calls.filter((row) => row[0] === 'generate').length, 2);
releaseProviderGate();
providerGate = null;
const completedConcurrent = await firstConcurrent;
assert.equal(completedConcurrent.ok, true);
assert.equal(session.operation, null);
assert.equal(session.result.resultId, resultId);

let releaseReviewGate;
reviewGate = { promise: new Promise((resolve) => { releaseReviewGate = resolve; }) };
const concurrentApproval = dispatcher.handlers[MESSAGE_TYPES.REVIEW_RESULT]({
  payload: { resultId, decision: 'APPROVE' }, sender,
});
await new Promise((resolve) => setImmediate(resolve));
const concurrentRejection = await dispatcher.handlers[MESSAGE_TYPES.REVIEW_RESULT]({
  payload: { resultId, decision: 'REJECT' }, sender,
});
assert.equal(concurrentRejection.ok, false);
assert.equal(concurrentRejection.errorCode, 'SS_ERP_BYOK_WORKBENCH_REVIEW_IN_PROGRESS');
releaseReviewGate();
reviewGate = null;
const completedApproval = await concurrentApproval;
assert.equal(completedApproval.ok, true);
assert.equal(session.result.reviewState, 'APPROVED');
assert.equal(vaultEntry.reviewState, 'APPROVED');

session = {
  context: launchContext, sourceTabId: 12, sourceDocumentId: 'source-document-1',
  workbenchTabId: 77, workbenchDocumentId: 'document-1', operation: null, result: null,
};
vaultEntry = entry;

providerFailure = Object.assign(new Error('timeout'), {
  code: 'SS_ERP_BYOK_PROVIDER_UNKNOWN_OUTCOME',
});
providerOperationState = null;
const unknown = await dispatcher.handlers[MESSAGE_TYPES.EXECUTE_PROVIDER]({
  payload: {
    profileId: 'profile-1', prompt: 'Do not repeat this request', negativePrompt: null,
    size: '1024x1024', idempotencyKey: 'generate-3',
  },
  sender,
  authorization: { readiness: { binding } },
});
assert.equal(unknown.ok, false);
assert.equal(unknown.errorCode, 'SS_ERP_BYOK_PROVIDER_UNKNOWN_OUTCOME');
assert.equal(session.operation.state, 'OUTCOME_UNRESOLVED');
const unknownState = await dispatcher.handlers[MESSAGE_TYPES.GET_PUBLIC_STATE]({ payload: {}, sender });
assert.equal(unknownState.data.generationOutcome, 'UNKNOWN_OUTCOME');
assert.equal(JSON.stringify(unknownState).includes('generate-3'), false);
const blockedRetry = await dispatcher.handlers[MESSAGE_TYPES.EXECUTE_PROVIDER]({
  payload: {
    profileId: 'profile-1', prompt: 'A second charge must be blocked', negativePrompt: null,
    size: '1024x1024', idempotencyKey: 'generate-4',
  },
  sender,
  authorization: { readiness: { binding } },
});
assert.equal(blockedRetry.ok, false);
assert.equal(blockedRetry.errorCode, 'SS_ERP_BYOK_WORKBENCH_SESSION_OPERATION_CONFLICT');
assert.equal(calls.filter((row) => row[0] === 'generate').length, 3);

session = {
  context: launchContext, sourceTabId: 12, sourceDocumentId: 'source-document-1',
  workbenchTabId: 77, workbenchDocumentId: 'old-document', operation: null,
  result: { resultId, reviewState: 'CANDIDATE_READY' },
};
vaultEntry = entry;
claimFailure = Object.assign(new Error('reloaded document'), {
  code: 'SS_ERP_BYOK_WORKBENCH_SESSION_SENDER_DENIED',
  discardedResultId: resultId,
});
const vaultReleasesBeforeReload = calls.filter((row) => row[0] === 'release-vault').length;
const previewReleasesBeforeReload = calls.filter((row) => row[0] === 'release-preview').length;
const reloaded = await dispatcher.handlers[MESSAGE_TYPES.GET_PUBLIC_STATE]({
  payload: {}, sender: { ...sender, documentId: 'new-document' },
});
assert.equal(reloaded.ok, false);
assert.equal(reloaded.errorCode, 'SS_ERP_BYOK_WORKBENCH_SESSION_SENDER_DENIED');
assert.equal(
  calls.filter((row) => row[0] === 'release-vault').length,
  vaultReleasesBeforeReload + 1,
);
assert.equal(
  calls.filter((row) => row[0] === 'release-preview').length,
  previewReleasesBeforeReload + 1,
);
assert.equal(JSON.stringify(reloaded).includes(resultId), false);

console.log('extension BYOK workbench runtime handler tests passed');
