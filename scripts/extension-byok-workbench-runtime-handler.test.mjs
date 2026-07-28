import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const modulePath = 'extensions/ss-erp/shared/byok/workbench-runtime-handler.js';
const serviceWorkerSource = readFileSync('extensions/ss-erp/background/service-worker.js', 'utf8');
assert.match(
  serviceWorkerSource,
  /ingestClient:\s*getByokGeneratedAssetIngestClient\(\)/u,
  'the workbench dispatcher must own ingest session orchestration',
);
assert.match(
  serviceWorkerSource,
  /publishCoordinator:\s*getByokListingPublishCoordinator\(\)/u,
  'the workbench dispatcher must own the server-side publish bridge',
);
assert.match(
  serviceWorkerSource,
  /workbenchPublishCoordinator:\s*getWorkbenchListingPublishCoordinator\(\)/u,
  'the workbench dispatcher must own the unified hosted/BYOK publish bridge',
);
assert.doesNotMatch(
  serviceWorkerSource,
  /const ingestHandler\s*=|WORKBENCH\.INGEST\]:\s*ingestHandler/u,
  'a standalone ingest handler must not bypass the live workbench session',
);
let randomByte = 1;
const context = {
  Array, Boolean, Date, Error, Map, Math, Number, Object, Promise, Set, String, Uint8Array,
  crypto: {
    getRandomValues(bytes) { bytes.fill(randomByte); randomByte += 1; return bytes; },
  },
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
  INGEST: 'ingest',
  RECOVER_INGEST: 'recover-ingest',
  PUBLISH: 'publish',
  EDIT_MEDIA_PREPARE: 'edit-media-prepare',
  EDIT_MEDIA_RELEASE: 'edit-media-release',
  EDIT_STATE: 'edit-state',
  EDIT_REFERENCES: 'edit-references',
  EDIT_START: 'edit-start',
  EDIT_SELECT: 'edit-select',
  EDIT_REGENERATE: 'edit-regenerate',
  EDIT_PREVIEW: 'edit-preview',
  EDIT_CLEANUP: 'edit-cleanup',
};
const launchContext = {
  contractVersion: 'extension-byok-workbench-launch-context/v1',
  sourcePlatform: '1688', sourceProductId: 'product-1',
  sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
  shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
  skuKey: 'sku-1', slotKey: 'sku:sku-1:hero', assignmentMode: 'APPEND',
  assignmentOrdinal: 2,
};
const launchBinding = Object.freeze({
  sourcePlatform: launchContext.sourcePlatform,
  sourceProductId: launchContext.sourceProductId,
  sourceCaptureSnapshotId: launchContext.sourceCaptureSnapshotId,
  supplyGoodsId: launchContext.supplyGoodsId,
  shopId: launchContext.shopId,
  workflowId: launchContext.workflowId,
  draftRevision: launchContext.draftRevision,
  draftVersion: launchContext.draftVersion,
});
function readyLaunchDecision(contextValue = launchContext) {
  return {
    contractVersion: 'extension-byok-workbench-launch-decision/v2',
    state: 'READY',
    context: contextValue,
  };
}
function choiceLaunchDecision() {
  return {
    contractVersion: 'extension-byok-workbench-launch-decision/v2',
    state: 'CHOICE_REQUIRED',
    binding: launchBinding,
    skuKeys: ['sku-1', 'sku-2'],
  };
}
const binding = {
  ownerUserId: 'owner-1', deviceSessionId: 'session-1',
  ...launchContext,
  contractVersion: 'extension-byok-readiness-binding/v2',
  providerOrigin: 'https://relay.example', model: 'image-model-v1',
  operation: 'TEXT_TO_IMAGE', policyRevision: 'policy-7',
};
function authorizationFor(bindingValue = binding) {
  const readiness = {
    binding: bindingValue,
    expiresAt: '2026-07-26T10:10:00.000Z',
  };
  Object.defineProperty(readiness, 'concurrencyAuthority', {
    value: Object.freeze({ policyRevision: bindingValue.policyRevision, maxConcurrency: 1 }),
    enumerable: false,
  });
  return { readiness };
}
const sender = { tabId: 77, documentId: 'document-1', frameId: 0 };
const resultId = 'br_' + 'a'.repeat(48);
const ingestRequestHash = '1'.repeat(64);
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
const ingestReceipt = {
  contractVersion: 'extension-byok-generated-asset-ingest-client/v1', replayed: false,
  receiptId: 'receipt-1', assetId: 'asset-1', provenanceId: 'provenance-1',
  normalizedSha256: 'e'.repeat(64), mimeType: 'image/png', width: 1024, height: 1024,
  sourceDraftRevision: 3, sourceDraftVersion: 4,
  boundDraftRevision: 4, boundDraftVersion: 5,
  assignmentOrdinal: 2, assignmentSha256: 'f'.repeat(64),
  skuKey: 'sku-1', slotKey: 'sku:sku-1:hero',
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
    session = {
      ...session,
      operation: null,
      result: {
        ...result,
        deliveryState: 'NOT_INGESTED',
        ingestIdempotencyKey: null,
        ingestRequestHash: null,
        ingestAuthority: null,
        ingest: null,
      },
    };
    calls.push(['attach', result, idempotencyKey]);
    return session;
  },
  async setReviewState(_sender, id, state) {
    if (reviewGate) await reviewGate.promise;
    session = { ...session, result: { ...session.result, resultId: id, reviewState: state } };
    calls.push(['review-state', state]);
    return session;
  },
  async beginIngest(_sender, id, idempotencyKey, authority) {
    assert.equal('lifecycleAuthority' in authority, false);
    if (!session.result || session.result.resultId !== id
      || session.result.reviewState !== 'APPROVED') {
      throw Object.assign(new Error('conflict'), {
        code: 'SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_CONFLICT',
      });
    }
    session = {
      ...session,
      result: {
        ...session.result,
        deliveryState: 'INGESTING',
        ingestIdempotencyKey: idempotencyKey,
        ingestRequestHash: null,
        ingestAuthority: authority,
        ingest: null,
      },
    };
    calls.push(['ingest-begin', id, idempotencyKey, authority]);
    return session;
  },
  async setIngestRequestHash(_sender, id, idempotencyKey, requestHash) {
    if (!session.result || session.result.resultId !== id
      || session.result.deliveryState !== 'INGESTING'
      || session.result.ingestIdempotencyKey !== idempotencyKey) throw new Error('conflict');
    session = {
      ...session,
      result: { ...session.result, ingestRequestHash: requestHash },
    };
    calls.push(['ingest-request-hash', id, idempotencyKey, requestHash]);
    return session;
  },
  async resetIngest(_sender, id, idempotencyKey) {
    if (!session.result || session.result.resultId !== id
      || session.result.ingestIdempotencyKey !== idempotencyKey) throw new Error('conflict');
    session = {
      ...session,
      result: {
        resultId: id, reviewState: 'APPROVED', deliveryState: 'NOT_INGESTED',
        ingestIdempotencyKey: null, ingestRequestHash: null, ingestAuthority: null, ingest: null,
      },
    };
    return session;
  },
  async setIngestResult(_sender, id, idempotencyKey, authority, ingest) {
    assert.equal('lifecycleAuthority' in authority, false);
    if (!session.result || session.result.resultId !== id
      || session.result.reviewState !== 'APPROVED'
      || !/^[a-f0-9]{64}$/u.test(String(session.result.ingestRequestHash || ''))) {
      throw Object.assign(new Error('conflict'), {
        code: 'SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_CONFLICT',
      });
    }
    if (session.result.deliveryState === 'BOUND') {
      if (session.result.ingestIdempotencyKey !== idempotencyKey) {
        throw Object.assign(new Error('conflict'), {
          code: 'SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_CONFLICT',
        });
      }
      return session;
    }
    session = {
      ...session,
      result: {
        ...session.result,
        deliveryState: 'BOUND',
        ingestIdempotencyKey: idempotencyKey,
        ingestAuthority: authority,
        ingest,
      },
    };
    calls.push(['ingest-state', id, idempotencyKey, ingest]);
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
  async takeByTabIfIdle(id) {
    calls.push(['take-tab-if-idle', id]);
    if (session?.operation
      || (session?.result && ['INGESTING', 'BOUND'].includes(session.result.deliveryState))) {
      return null;
    }
    const previous = session;
    session = null;
    return previous;
  },
};
let resolvedLaunchDecision = readyLaunchDecision();
let sourceCurrentFailure = null;
let liveSourceSelectionKey = null;
const launchClient = {
  async resolve(value) {
    calls.push(['resolve', value]);
    return resolvedLaunchDecision;
  },
};
async function assertSourceCurrent(value) {
  calls.push(['source-current', value]);
  if (sourceCurrentFailure) throw sourceCurrentFailure;
  if (value.sourceSelectionKey !== liveSourceSelectionKey) {
    throw Object.assign(new Error('source SKU changed'), {
      code: 'SS_ERP_BYOK_WORKBENCH_SOURCE_STALE',
      status: 409,
    });
  }
}
const profile = {
  id: 'profile-1', name: 'Relay', baseUrl: 'https://relay.example/v1',
  model: 'image-model-v1',
  allowedOperations: ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'],
  preferences: {},
};
const evidence = {
  contractVersion: 'extension-byok-capability-evidence/v1', operation: 'TEXT_TO_IMAGE',
  requestMode: 'json', policyRevision: 'policy-7',
  verifiedAt: '2026-07-26T09:00:00.000Z', expiresAt: '2026-07-27T09:00:00.000Z',
};
const editEvidence = {
  contractVersion: 'extension-byok-capability-evidence/v1', operation: 'IMAGE_TO_IMAGE',
  requestMode: 'multipart', policyRevision: 'policy-7',
  verifiedAt: '2026-07-26T09:00:00.000Z', expiresAt: '2026-07-27T09:00:00.000Z',
};
const asyncEvidence = {
  ...editEvidence,
  operation: 'FULL_EDIT',
  requestMode: 'async',
};
const profileStore = {
  async listPublicProfiles() { return [profile]; },
  async getProfile(id) { return id === profile.id ? profile : null; },
  async getPublicState(id) {
    return id === profile.id
      ? { profile, hasKey: true, evidence: [evidence, editEvidence, asyncEvidence] }
      : null;
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
    if (!vaultEntry || !['CANDIDATE_READY', 'APPROVED'].includes(vaultEntry.reviewState)) {
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
  async capture(candidate = binding) {
    return {
      lifecycleAuthority: { epoch: 1 },
      ownerUserId: candidate.ownerUserId,
      deviceSessionId: candidate.deviceSessionId,
      shopId: candidate.shopId,
      workflowId: candidate.workflowId,
      draftRevision: candidate.draftRevision,
      draftVersion: candidate.draftVersion,
      policyRevision: candidate.policyRevision,
    };
  },
  async commitGeneratedResult({ vault: selectedVault }) { return selectedVault.put(); },
  matchesVaultAuthority(candidate, expectedBinding) {
    return candidate === vaultEntry && expectedBinding === candidate.binding;
  },
};
const previewBroker = {
  open(candidate) {
    calls.push(['preview', candidate.resultId]);
    return { contractVersion: 'preview/v1', channelName: 'channel', previewTicket: 'ticket' };
  },
  releaseResult(id) { calls.push(['release-preview', id]); return 1; },
};
let ingestGate = null;
let ingestFailure = null;
let ingestRecoveryFailure = null;
let ingestOperationState = { dispatched: true, status: 'UNKNOWN_OUTCOME' };
const ingestClient = {
  async ingest(input, authority, commitAccepted, commitRequestHash) {
    calls.push(['ingest', input, authority]);
    if (commitRequestHash) await commitRequestHash(ingestRequestHash);
    if (ingestGate) await ingestGate.promise;
    if (ingestFailure) throw ingestFailure;
    if (commitAccepted) await commitAccepted(ingestReceipt);
    calls.push(['release-vault', input.resultId]);
    vaultEntry = null;
    return ingestReceipt;
  },
  async recover(input, authority, commitAccepted) {
    calls.push(['ingest-recover', input, authority]);
    assert.equal(input.requestHash, ingestRequestHash);
    if (ingestRecoveryFailure) throw ingestRecoveryFailure;
    if (commitAccepted) await commitAccepted({ ...ingestReceipt, replayed: true });
    return { ...ingestReceipt, replayed: true };
  },
  discardResult(id) { calls.push(['discard-ingest', id]); return 1; },
  getOperationState() { return ingestOperationState; },
};
const publishPreview = {
  contractVersion: 'extension-byok-listing-publish-preview/v1',
  previewHash: '9'.repeat(64),
  shop: { id: 'shop-1', name: 'Ozon Primary' },
  draft: { workflowId: 'workflow-1', revision: 4, draftVersion: 5 },
  selectedSkuKeys: ['sku-1'],
  media: [{
    ordinal: 0, scope: 'SKU', skuKey: 'sku-1', slotKey: 'sku:sku-1:hero',
    assetId: 'asset-1', source: 'GENERATED',
  }],
};
let publishState = null;
const publishCoordinator = {
  async preview(input) { calls.push(['publish-preview', input]); return publishPreview; },
  async confirm(input) {
    calls.push(['publish-confirm', input]);
    publishState = { state: 'SUCCEEDED', receiptId: 'publish-receipt-1', replayed: false };
    return publishState;
  },
  async recover(input) {
    calls.push(['publish-recover', input]);
    return { ...publishState, replayed: true };
  },
  async getState(input) { calls.push(['publish-state', input]); return publishState; },
};
const workbenchPublishState = {
  contractVersion: 'extension-workbench-listing-publish/v1',
  request: {
    executionMode: 'ERP_HOSTED',
    binding: {
      shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 4, draftVersion: 5,
    },
    selectedMedia: [{
      scope: 'SKU', skuKey: 'sku-1', slotKey: 'sku:sku-1:hero', assetId: 'asset-1',
    }],
  },
  state: 'SUCCEEDED', executionMode: 'ERP_HOSTED', shopId: 'shop-1',
  workflowId: 'workflow-1', currentDraftRevision: 4, currentDraftVersion: 5,
  previewHash: '8'.repeat(64), receiptId: 'workbench-receipt-1', failureCode: null,
};
const workbenchPublishPreview = {
  contractVersion: 'extension-workbench-listing-publish/v1',
  executionMode: 'ERP_HOSTED', shopId: 'shop-1', workflowId: 'workflow-1',
  basisDraftRevision: 4, basisDraftVersion: 5,
  currentDraftRevision: 4, currentDraftVersion: 5,
  previewHash: '8'.repeat(64), selectedSkuKeys: ['sku-1'],
  selectedMedia: [{
    scope: 'SKU', skuKey: 'sku-1', slotKey: 'sku:sku-1:hero', assetId: 'asset-1',
  }],
  orderedMedia: [],
};
const workbenchPublishCoordinator = {
  async preview(input) { calls.push(['workbench-publish-preview', input]); return workbenchPublishPreview; },
  async confirm(input) { calls.push(['workbench-publish-confirm', input]); return workbenchPublishState; },
  async recover(input) { calls.push(['workbench-publish-recover', input]); return workbenchPublishState; },
  async getState(input) { calls.push(['workbench-publish-state', input]); return null; },
  async getActive(input) { calls.push(['workbench-publish-active', input]); return null; },
};

const emptyEditSnapshot = {
  contractVersion: 'extension-byok-workbench-edit-controller/v1',
  executionMode: 'BYOK', slotKey: launchContext.slotKey, profileId: null, operation: null,
  references: {
    sessionGlobalCount: 0, slotOverrideActive: false,
    slotOverrideCount: null, effectiveCount: 0,
  },
  operationAvailability: [],
  scheduler: {
    state: 'READY', activeCount: 0, queuedCount: 0,
    pauseRequested: false, effectiveConcurrency: null,
  },
  slot: { revision: 0, attemptIds: [], selectedAttemptId: null, selectedCandidateId: null },
  alternatives: [],
};
let editSnapshot = emptyEditSnapshot;
let editCleanupUnresolved = false;
let editControllerPresent = false;
const editController = {
  open(owner) { calls.push(['edit-open', owner]); editControllerPresent = true; return editSnapshot; },
  setReferences(owner, input) { calls.push(['edit-references', owner, input]); return editSnapshot; },
  async start(owner, input) { calls.push(['edit-start', owner, input]); return editSnapshot; },
  async regenerate(owner, input) { calls.push(['edit-regenerate', owner, input]); return editSnapshot; },
  selectAlternative(owner, input) { calls.push(['edit-select', owner, input]); return editSnapshot; },
  getSnapshot(owner) {
    calls.push(['edit-state', owner]);
    if (!editControllerPresent) {
      throw Object.assign(new Error('stale edit owner'), { code: 'SS_ERP_BYOK_EDIT_OWNER_STALE' });
    }
    return editSnapshot;
  },
  cleanup(owner) {
    calls.push(['edit-cleanup', owner]);
    editSnapshot = emptyEditSnapshot;
    editControllerPresent = false;
    return {
      cleaned: true,
      releasedResultCount: 0,
      externalChargeUnresolved: editCleanupUnresolved,
    };
  },
  cleanupByTab(tabId) {
    calls.push(['edit-cleanup-tab', tabId]);
    editSnapshot = emptyEditSnapshot;
    const cleaned = editControllerPresent;
    editControllerPresent = false;
    return {
      cleaned,
      releasedResultCount: 0,
      externalChargeUnresolved: editCleanupUnresolved,
    };
  },
};
const editMediaStore = {
  prepare(owner, purpose) {
    calls.push(['edit-media-prepare', owner, purpose]);
    return { contractVersion: 'media/v1', channelName: 'upload', uploadTicket: 'ticket' };
  },
  release(owner, mediaHandle, purpose) {
    calls.push(['edit-media-release', owner, mediaHandle, purpose]);
    return true;
  },
};
let editEpochActive = false;
const editEpochGuard = {
  async assertCurrent(_owner, options) {
    calls.push(['edit-epoch-assert', Boolean(options && options.requireActive)]);
    if (options && options.requireActive && !editEpochActive) {
      throw Object.assign(new Error('missing'), { code: 'SS_ERP_BYOK_EDIT_EPOCH_REQUIRED' });
    }
    return { state: editEpochActive ? 'CURRENT' : 'EMPTY' };
  },
  async begin() {
    if (editEpochActive) {
      throw Object.assign(new Error('restart acknowledgement required'), {
        code: 'SS_ERP_BYOK_EDIT_WORKER_RESTARTED', outcome: 'UNKNOWN_OUTCOME',
      });
    }
    const created = true;
    editEpochActive = true;
    calls.push(['edit-epoch-begin', created]);
    return { state: 'CURRENT', created };
  },
  async clear() { calls.push(['edit-epoch-clear']); editEpochActive = false; return true; },
  async clearByTab(tabId) {
    calls.push(['edit-epoch-clear-tab', tabId]);
    editEpochActive = false;
    return true;
  },
  async acknowledge(_owner, acknowledgement) {
    calls.push(['edit-epoch-acknowledge', acknowledgement]);
    editEpochActive = false;
    return { clearedCount: 1 };
  },
};
const providerSemaphore = {
  async acquire(value) {
    calls.push(['provider-semaphore-acquire', value]);
    let released = false;
    return Object.freeze({
      release() {
        if (released) return false;
        released = true;
        calls.push(['provider-semaphore-release', value.ownerToken]);
        return true;
      },
    });
  },
  cancelOwner(ownerToken) {
    calls.push(['provider-semaphore-cancel', ownerToken]);
    return 0;
  },
};

const dispatcherOptions = {
  messageTypes: MESSAGE_TYPES,
  sessionManager, launchClient, profileStore, permissionBroker, readinessClient,
  providerClient, vault, authorityGuard, previewBroker, ingestClient, publishCoordinator,
  workbenchPublishCoordinator,
  editController, editMediaStore, editEpochGuard,
  providerSemaphore,
  now: () => new Date('2026-07-26T10:00:00.000Z'),
};
assert.throws(
  () => api.createDispatcher(dispatcherOptions),
  (error) => error?.code === 'SS_ERP_BYOK_WORKBENCH_DEPENDENCY_UNAVAILABLE',
  'source currency validation must be a fail-closed runtime dependency',
);
const dispatcher = api.createDispatcher({ ...dispatcherOptions, assertSourceCurrent });

resolvedLaunchDecision = choiceLaunchDecision();
const choiceRequired = await dispatcher.openFromSource({
  request: {
    sourcePlatform: '1688', sourceProductId: 'product-1',
    sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
    shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
    preferredSkuKey: null,
    selectionKind: 'HINT',
  },
  sourceSender: { tabId: 12, documentId: 'source-document-1', frameId: 0 },
  sourceSelectionKey: null,
});
assert.deepEqual(JSON.parse(JSON.stringify(choiceRequired)), {
  state: 'choice_required', binding: launchBinding, skuKeys: ['sku-1', 'sku-2'],
});
assert.equal(calls.filter((row) => row[0] === 'open').length, 0,
  'ambiguous context must never open a workbench session');

resolvedLaunchDecision = readyLaunchDecision();
liveSourceSelectionKey = 'sku-2';
const opensBeforeStaleSource = calls.filter((row) => row[0] === 'open').length;
const staleSource = await dispatcher.openFromSource({
  request: { ...launchBinding, preferredSkuKey: 'sku-1', selectionKind: 'HINT' },
  sourceSender: { tabId: 12, documentId: 'source-document-1', frameId: 0 },
  sourceSelectionKey: 'sku-1',
});
assert.deepEqual(JSON.parse(JSON.stringify(staleSource)), { state: 'stale' });
assert.equal(
  calls.filter((row) => row[0] === 'open').length,
  opensBeforeStaleSource,
  'a same-URL source SKU switch must never open a workbench session',
);
liveSourceSelectionKey = 'sku-1';
const opened = await dispatcher.openFromSource({
  request: { ...launchBinding, preferredSkuKey: 'sku-1', selectionKind: 'HINT' },
  sourceSender: { tabId: 12, documentId: 'source-document-1', frameId: 0 },
  sourceSelectionKey: 'sku-1',
});
assert.deepEqual(JSON.parse(JSON.stringify(opened)), { state: 'workbench_opened', tabId: 77 });

const stateResponse = await dispatcher.handlers[MESSAGE_TYPES.GET_PUBLIC_STATE]({ payload: {}, sender });
assert.equal(stateResponse.ok, true);
assert.deepEqual(JSON.parse(JSON.stringify(
  calls.filter((row) => row[0] === 'resolve').at(-1)[1],
)), {
  ...launchBinding,
  preferredSkuKey: 'sku-1',
  selectionKind: 'EXPLICIT',
});
assert.equal(stateResponse.data.executionMode, 'BYOK');
assert.equal(stateResponse.data.generationOutcome, null);
assert.equal(stateResponse.data.profiles[0].hasKey, true);
assert.equal(stateResponse.data.profiles[0].permissionState, 'GRANTED');
assert.deepEqual(JSON.parse(JSON.stringify(stateResponse.data.profiles[0].capabilityEvidence)), [
  {
    operation: 'IMAGE_TO_IMAGE', requestMode: 'multipart', policyRevision: 'policy-7',
    verifiedAt: '2026-07-26T09:00:00.000Z', expiresAt: '2026-07-27T09:00:00.000Z',
  },
]);
assert.equal(JSON.stringify(stateResponse).includes('apiKey'), false);

const editOwnerProjection = {
  tabId: 77,
  documentId: 'document-1',
  context: launchContext,
};
const stateEdit = await dispatcher.handlers[MESSAGE_TYPES.EDIT_STATE]({ payload: {}, sender });
assert.equal(stateEdit.ok, true);
assert.deepEqual(JSON.parse(JSON.stringify(calls.find((row) => row[0] === 'edit-open')[1])),
  editOwnerProjection);
const preparedEditMedia = await dispatcher.handlers[MESSAGE_TYPES.EDIT_MEDIA_PREPARE]({
  payload: { purpose: 'REFERENCE' }, sender,
});
assert.equal(preparedEditMedia.ok, true);
assert.equal(calls.some((row) => row[0] === 'edit-media-prepare'
  && row[2] === 'REFERENCE'), true);
const mediaHandle = `mh_${'7'.repeat(48)}`;
const releasedEditMedia = await dispatcher.handlers[MESSAGE_TYPES.EDIT_MEDIA_RELEASE]({
  payload: { mediaHandle, purpose: 'REFERENCE' }, sender,
});
assert.deepEqual(JSON.parse(JSON.stringify(releasedEditMedia.data)), { released: true });
const referencesEdit = await dispatcher.handlers[MESSAGE_TYPES.EDIT_REFERENCES]({
  payload: { scope: 'SLOT', handles: [mediaHandle] }, sender,
});
assert.equal(referencesEdit.ok, true);
assert.deepEqual(JSON.parse(JSON.stringify(calls.find((row) => row[0] === 'edit-references')[2])), {
  scope: 'SLOT', slotKey: launchContext.slotKey, handles: [mediaHandle],
});

editCleanupUnresolved = true;
editSnapshot = {
  ...emptyEditSnapshot,
  profileId: 'profile-1',
  operation: 'FULL_EDIT',
  scheduler: { ...emptyEditSnapshot.scheduler, state: 'RUNNING', activeCount: 1 },
  slot: { ...emptyEditSnapshot.slot, revision: 1, attemptIds: ['attempt-000001'] },
  alternatives: [{
    attemptId: 'attempt-000001', generation: 1, operation: 'FULL_EDIT',
    state: 'SUBMITTING', candidateId: null, errorCode: null, selected: false,
    externalChargePossible: false, retryRisk: null,
  }],
};
const editCommand = {
  profileId: 'profile-1', operation: 'FULL_EDIT', prompt: 'Improve composition',
  negativePrompt: null, size: '1024x1024', sourceHandle: mediaHandle, maskHandle: null,
};
assert.equal((await dispatcher.handlers[MESSAGE_TYPES.EDIT_START]({
  payload: editCommand, sender,
})).ok, true);
const generatedBeforeEditConflict = calls.filter((row) => row[0] === 'generate').length;
const textWhileEditActive = await dispatcher.handlers[MESSAGE_TYPES.EXECUTE_PROVIDER]({
  payload: {
    profileId: 'profile-1', prompt: 'Must not overlap an active edit',
    negativePrompt: null, size: '1024x1024', idempotencyKey: 'generate-edit-conflict',
  },
  sender,
  authorization: authorizationFor(),
});
assert.equal(textWhileEditActive.ok, false);
assert.equal(textWhileEditActive.errorCode, 'SS_ERP_BYOK_WORKBENCH_MODE_CONFLICT');
assert.equal(calls.filter((row) => row[0] === 'generate').length, generatedBeforeEditConflict);
const epochClearCount = calls.filter((row) => row[0] === 'edit-epoch-clear').length;
const unresolvedCleanup = await dispatcher.handlers[MESSAGE_TYPES.EDIT_CLEANUP]({
  payload: {}, sender,
});
assert.equal(unresolvedCleanup.data.externalChargeUnresolved, true);
assert.equal(calls.filter((row) => row[0] === 'edit-epoch-clear').length, epochClearCount,
  'active Provider work must retain its epoch marker on page cleanup');
assert.equal(editEpochActive, true);
const retainedState = await dispatcher.handlers[MESSAGE_TYPES.EDIT_STATE]({ payload: {}, sender });
assert.equal(retainedState.ok, false);
assert.equal(retainedState.errorCode, 'SS_ERP_BYOK_EDIT_WORKER_RESTARTED');
const editStartsBeforeRetainedMarker = calls.filter((row) => row[0] === 'edit-start').length;
const sameDocumentRestart = await dispatcher.handlers[MESSAGE_TYPES.EDIT_START]({
  payload: editCommand, sender,
});
assert.equal(sameDocumentRestart.ok, false);
assert.equal(sameDocumentRestart.errorCode, 'SS_ERP_BYOK_EDIT_WORKER_RESTARTED');
assert.equal(calls.filter((row) => row[0] === 'edit-start').length, editStartsBeforeRetainedMarker);
const acknowledgedRestart = await dispatcher.handlers[MESSAGE_TYPES.EDIT_CLEANUP]({
  payload: {
    restartAcknowledgement: {
      warningVersion: 'external-provider-charge/v1', confirmed: true,
    },
  },
  sender,
});
assert.equal(acknowledgedRestart.ok, true);
assert.equal(acknowledgedRestart.data.restartAcknowledged, true);
assert.equal(editEpochActive, false);

editCleanupUnresolved = false;
editSnapshot = {
  ...emptyEditSnapshot,
  profileId: 'profile-1',
  operation: 'IMAGE_TO_IMAGE',
  scheduler: { ...emptyEditSnapshot.scheduler, state: 'REVIEW', effectiveConcurrency: 1 },
  slot: {
    revision: 3, attemptIds: ['attempt-000002'], selectedAttemptId: null,
    selectedCandidateId: null,
  },
  alternatives: [{
    attemptId: 'attempt-000002', generation: 1, operation: 'IMAGE_TO_IMAGE',
    state: 'CANDIDATE_READY', candidateId: resultId, errorCode: null, selected: false,
    externalChargePossible: false, retryRisk: null,
  }],
};
assert.equal((await dispatcher.handlers[MESSAGE_TYPES.EDIT_START]({
  payload: { ...editCommand, operation: 'IMAGE_TO_IMAGE', sourceHandle: null }, sender,
})).ok, true);
assert.equal((await dispatcher.handlers[MESSAGE_TYPES.EDIT_SELECT]({
  payload: { attemptId: 'attempt-000002' }, sender,
})).ok, true);
assert.equal((await dispatcher.handlers[MESSAGE_TYPES.EDIT_REGENERATE]({
  payload: {
    ...editCommand,
    operation: 'IMAGE_TO_IMAGE',
    sourceHandle: null,
    expectedSlotRevision: 3,
    chargeAcknowledgement: {
      warningVersion: 'external-provider-charge/v1', confirmed: true,
    },
  },
  sender,
})).ok, true);
const textVaultEntry = entry;
vaultEntry = {
  ...entry,
  binding: { ...binding, operation: 'IMAGE_TO_IMAGE' },
};
const editPreview = await dispatcher.handlers[MESSAGE_TYPES.EDIT_PREVIEW]({
  payload: { resultId }, sender,
});
assert.equal(editPreview.ok, true);
assert.equal(editPreview.data.channelName, 'channel');
vaultEntry = textVaultEntry;
const settledCleanup = await dispatcher.handlers[MESSAGE_TYPES.EDIT_CLEANUP]({
  payload: {}, sender,
});
assert.equal(settledCleanup.data.externalChargeUnresolved, false);
assert.equal(editEpochActive, false);

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
  authorization: authorizationFor(),
});
assert.equal(executeResponse.ok, true);
assert.equal(executeResponse.data.resultId, resultId);
assert.deepEqual(JSON.parse(JSON.stringify(session.result)), {
  resultId, reviewState: 'CANDIDATE_READY', deliveryState: 'NOT_INGESTED',
  ingestIdempotencyKey: null, ingestRequestHash: null, ingestAuthority: null, ingest: null,
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
const ingested = await dispatcher.handlers[MESSAGE_TYPES.INGEST]({
  payload: { resultId }, sender,
});
assert.equal(ingested.ok, true);
assert.equal(ingested.data.deliveryState, 'BOUND');
assert.equal(ingested.data.ingest.receiptId, 'receipt-1');
assert.equal(session.result.deliveryState, 'BOUND');
assert.equal(session.result.ingestRequestHash, ingestRequestHash);
assert.equal(session.result.ingest.boundDraftVersion, 5);
assert.equal(session.result.ingestAuthority.deviceSessionId, 'session-1');
assert.equal(vaultEntry, null, 'session receipt must commit before successful Blob release');
assert.equal(calls.some((row) => row[0] === 'release-preview' && row[1] === resultId), true);
const ingestCall = calls.find((row) => row[0] === 'ingest');
const initialIngestIdempotencyKey = ingestCall[1].idempotencyKey;
assert.match(initialIngestIdempotencyKey, /^wb_ingest_[a-f0-9]{48}$/u);
assert.deepEqual(JSON.parse(JSON.stringify(ingestCall[1])), {
  resultId, shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
  skuKey: 'sku-1', slotKey: 'sku:sku-1:hero', assignmentMode: 'APPEND',
  replaceConfirmed: false, assignmentOrdinal: 2,
  idempotencyKey: initialIngestIdempotencyKey,
  requestHash: null,
});
const ingestReplay = await dispatcher.handlers[MESSAGE_TYPES.INGEST]({
  payload: { resultId }, sender,
});
assert.deepEqual(JSON.parse(JSON.stringify(ingestReplay.data)), JSON.parse(JSON.stringify(ingested.data)));
assert.equal(calls.filter((row) => row[0] === 'ingest').length, 1);
const recoverBound = await dispatcher.handlers[MESSAGE_TYPES.RECOVER_INGEST]({
  payload: { resultId }, sender,
});
assert.deepEqual(
  JSON.parse(JSON.stringify(recoverBound.data)),
  JSON.parse(JSON.stringify(ingested.data)),
  'BOUND recovery must replay the exact persisted receipt without another status request',
);
assert.equal(calls.filter((row) => row[0] === 'ingest-recover').length, 0);
resolvedLaunchDecision = readyLaunchDecision({
  ...launchContext,
  draftRevision: 4,
  draftVersion: 5,
  assignmentOrdinal: 3,
});
const boundState = await dispatcher.handlers[MESSAGE_TYPES.GET_PUBLIC_STATE]({ payload: {}, sender });
assert.equal(boundState.data.deliveryState, 'BOUND');
assert.equal(boundState.data.result.ingest.assetId, 'asset-1');
assert.equal(boundState.data.publish, null);
const previewedPublish = await dispatcher.handlers[MESSAGE_TYPES.PUBLISH]({
  payload: { action: 'PREVIEW' }, sender,
});
assert.equal(previewedPublish.ok, true);
assert.equal(previewedPublish.data.previewHash, '9'.repeat(64));
const publishBinding = {
  shopId: 'shop-1', workflowId: 'workflow-1',
  sourceDraftRevision: 3, sourceDraftVersion: 4,
  boundDraftRevision: 4, boundDraftVersion: 5,
  assetId: 'asset-1', provenanceId: 'provenance-1', normalizedSha256: 'e'.repeat(64),
  skuKey: 'sku-1', slotKey: 'sku:sku-1:hero', assignmentOrdinal: 2,
  assignmentSha256: 'f'.repeat(64),
};
assert.deepEqual(
  JSON.parse(JSON.stringify(calls.find((row) => row[0] === 'publish-preview')[1])),
  publishBinding,
);
const confirmedPublish = await dispatcher.handlers[MESSAGE_TYPES.PUBLISH]({
  payload: { action: 'CONFIRM', previewHash: '9'.repeat(64) }, sender,
});
assert.equal(confirmedPublish.ok, true);
assert.equal(confirmedPublish.data.receiptId, 'publish-receipt-1');
assert.deepEqual(
  JSON.parse(JSON.stringify(calls.find((row) => row[0] === 'publish-confirm')[1])),
  { ...publishBinding, previewHash: '9'.repeat(64) },
);
const recoveredPublish = await dispatcher.handlers[MESSAGE_TYPES.PUBLISH]({
  payload: { action: 'RECOVER' }, sender,
});
assert.equal(recoveredPublish.ok, true);
assert.equal(recoveredPublish.data.replayed, true);
const unifiedRequest = {
  executionMode: 'ERP_HOSTED',
  binding: {
    shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 4, draftVersion: 5,
  },
  selectedMedia: [{
    scope: 'SKU', skuKey: 'sku-1', slotKey: 'sku:sku-1:hero', assetId: 'asset-1',
  }],
};
const unifiedPreview = await dispatcher.handlers[MESSAGE_TYPES.PUBLISH]({
  payload: { action: 'WORKSPACE_PREVIEW', request: unifiedRequest }, sender,
});
assert.equal(unifiedPreview.ok, true);
assert.equal(unifiedPreview.data.previewHash, '8'.repeat(64));
const unifiedState = await dispatcher.handlers[MESSAGE_TYPES.PUBLISH]({
  payload: { action: 'WORKSPACE_STATE', request: unifiedRequest }, sender,
});
assert.equal(unifiedState.ok, true);
assert.equal(unifiedState.data, null);
const unifiedConfirmed = await dispatcher.handlers[MESSAGE_TYPES.PUBLISH]({
  payload: {
    action: 'WORKSPACE_CONFIRM', request: unifiedRequest, previewHash: '8'.repeat(64),
  },
  sender,
});
assert.equal(unifiedConfirmed.data.receiptId, 'workbench-receipt-1');
const unifiedRecovered = await dispatcher.handlers[MESSAGE_TYPES.PUBLISH]({
  payload: { action: 'WORKSPACE_RECOVER', request: unifiedRequest }, sender,
});
assert.equal(unifiedRecovered.data.receiptId, 'workbench-receipt-1');
const unifiedActive = await dispatcher.handlers[MESSAGE_TYPES.PUBLISH]({
  payload: { action: 'WORKSPACE_ACTIVE' }, sender,
});
assert.equal(unifiedActive.data, null);
assert.deepEqual(
  JSON.parse(JSON.stringify(calls.find((row) => row[0] === 'workbench-publish-active')[1])),
  { shopId: 'shop-1', workflowId: 'workflow-1' },
);
const forgedUnified = await dispatcher.handlers[MESSAGE_TYPES.PUBLISH]({
  payload: {
    action: 'WORKSPACE_PREVIEW',
    request: {
      ...unifiedRequest,
      binding: { ...unifiedRequest.binding, workflowId: 'workflow-forged' },
    },
  },
  sender,
});
assert.equal(forgedUnified.ok, false);
assert.equal(forgedUnified.errorCode, 'SS_ERP_WORKBENCH_PUBLISH_CONTEXT_MISMATCH');
const publishedState = await dispatcher.handlers[MESSAGE_TYPES.GET_PUBLIC_STATE]({
  payload: {}, sender,
});
assert.equal(publishedState.data.publish.receiptId, 'publish-receipt-1');
resolvedLaunchDecision = readyLaunchDecision();

session = {
  ...session,
  result: {
    resultId, reviewState: 'APPROVED', deliveryState: 'INGESTING',
    ingestIdempotencyKey: initialIngestIdempotencyKey,
    ingestRequestHash,
    ingestAuthority: {
      ownerUserId: 'owner-1', deviceSessionId: 'session-1',
      shopId: 'shop-1', workflowId: 'workflow-1',
      draftRevision: 3, draftVersion: 4, policyRevision: 'policy-7',
    },
    ingest: null,
  },
};
resolvedLaunchDecision = readyLaunchDecision({
  ...launchContext, draftRevision: 4, draftVersion: 5,
});
const resolvesBeforeRecovery = calls.filter((row) => row[0] === 'resolve').length;
const recoveredIngest = await dispatcher.handlers[MESSAGE_TYPES.RECOVER_INGEST]({
  payload: { resultId }, sender,
});
assert.equal(recoveredIngest.ok, true);
assert.equal(recoveredIngest.data.deliveryState, 'BOUND');
assert.equal(recoveredIngest.data.ingest.replayed, true);
assert.equal(session.result.deliveryState, 'BOUND');
assert.equal(
  calls.filter((row) => row[0] === 'resolve').length,
  resolvesBeforeRecovery,
  'receipt recovery must not reject the immutable source context after the draft advanced',
);
assert.equal(calls.filter((row) => row[0] === 'ingest-recover').length, 1);
resolvedLaunchDecision = readyLaunchDecision();

session = {
  ...session,
  result: {
    resultId, reviewState: 'APPROVED', deliveryState: 'INGESTING',
    ingestIdempotencyKey: initialIngestIdempotencyKey,
    ingestRequestHash,
    ingestAuthority: {
      ownerUserId: 'owner-1', deviceSessionId: 'session-1',
      shopId: 'shop-1', workflowId: 'workflow-1',
      draftRevision: 3, draftVersion: 4, policyRevision: 'policy-7',
    },
    ingest: null,
  },
};
vaultEntry = { ...entry, reviewState: 'APPROVED' };
ingestRecoveryFailure = Object.assign(new Error('not committed'), {
  code: 'SS_ERP_BYOK_INGEST_RECEIPT_NOT_COMMITTED',
});
const uploadsBeforeNotCommittedRecovery = calls.filter((row) => row[0] === 'ingest').length;
const resumedIngest = await dispatcher.handlers[MESSAGE_TYPES.RECOVER_INGEST]({
  payload: { resultId }, sender,
});
assert.equal(resumedIngest.ok, true);
assert.equal(session.result.deliveryState, 'BOUND');
assert.equal(
  calls.filter((row) => row[0] === 'ingest').length,
  uploadsBeforeNotCommittedRecovery + 1,
  'a user recovery action may resend the same Blob only after NOT_COMMITTED is authoritative',
);
ingestRecoveryFailure = null;

session = {
  ...session,
  result: {
    resultId, reviewState: 'APPROVED', deliveryState: 'INGESTING',
    ingestIdempotencyKey: initialIngestIdempotencyKey,
    ingestRequestHash,
    ingestAuthority: {
      ownerUserId: 'owner-1', deviceSessionId: 'session-1',
      shopId: 'shop-1', workflowId: 'workflow-1',
      draftRevision: 3, draftVersion: 4, policyRevision: 'policy-7',
    },
    ingest: null,
  },
};
vaultEntry = { ...entry, reviewState: 'APPROVED' };
ingestRecoveryFailure = Object.assign(new Error('no authenticated grant exists'), {
  code: 'SS_ERP_BYOK_INGEST_RECEIPT_NOT_FOUND',
  outcome: 'FAILED_FINAL',
});
ingestOperationState = null;
const discardsBeforeAbsentReceipt = calls.filter((row) => row[0] === 'discard-ingest').length;
const absentReceipt = await dispatcher.handlers[MESSAGE_TYPES.RECOVER_INGEST]({
  payload: { resultId }, sender,
});
assert.equal(absentReceipt.ok, false);
assert.equal(absentReceipt.errorCode, 'SS_ERP_BYOK_INGEST_RECEIPT_NOT_FOUND');
assert.equal(session.result.deliveryState, 'NOT_INGESTED');
assert.equal(
  calls.filter((row) => row[0] === 'discard-ingest').length,
  discardsBeforeAbsentReceipt + 1,
  'a resettable terminal recovery must purge its retired client operation',
);
ingestRecoveryFailure = null;
const retryAfterAbsentReceipt = await dispatcher.handlers[MESSAGE_TYPES.INGEST]({
  payload: { resultId }, sender,
});
assert.equal(retryAfterAbsentReceipt.ok, true);
const retriedIngestCall = calls.filter((row) => row[0] === 'ingest').at(-1);
assert.match(retriedIngestCall[1].idempotencyKey, /^wb_ingest_[a-f0-9]{48}$/u);
assert.notEqual(
  retriedIngestCall[1].idempotencyKey,
  initialIngestIdempotencyKey,
  'a proven absent grant must retry with a fresh idempotency identity',
);

session = {
  ...session,
  result: {
    resultId, reviewState: 'APPROVED', deliveryState: 'INGESTING',
    ingestIdempotencyKey: initialIngestIdempotencyKey,
    ingestRequestHash,
    ingestAuthority: {
      ownerUserId: 'owner-1', deviceSessionId: 'session-1',
      shopId: 'shop-1', workflowId: 'workflow-1',
      draftRevision: 3, draftVersion: 4, policyRevision: 'policy-7',
    },
    ingest: null,
  },
};
vaultEntry = { ...entry, reviewState: 'APPROVED' };
ingestRecoveryFailure = Object.assign(new Error('failed'), {
  code: 'SS_ERP_BYOK_INGEST_RECEIPT_FAILED',
  outcome: 'FAILED_FINAL',
});
ingestOperationState = { dispatched: true, status: 'FAILED_FINAL' };
const terminalRecovery = await dispatcher.handlers[MESSAGE_TYPES.RECOVER_INGEST]({
  payload: { resultId }, sender,
});
assert.equal(terminalRecovery.ok, false);
assert.equal(terminalRecovery.errorCode, 'SS_ERP_BYOK_INGEST_RECEIPT_FAILED');
assert.equal(session.result, null, 'an immutable FAILED receipt must remove the candidate');
assert.equal(vaultEntry, null, 'an immutable FAILED receipt must release temporary bytes');
assert.equal(
  calls.some((row) => row[0] === 'discard-ingest' && row[1] === resultId),
  true,
  'terminal candidate cleanup must also purge the ingest operation',
);

session = {
  ...session,
  result: {
    resultId, reviewState: 'APPROVED', deliveryState: 'INGESTING',
    ingestIdempotencyKey: initialIngestIdempotencyKey,
    ingestRequestHash,
    ingestAuthority: {
      ownerUserId: 'owner-1', deviceSessionId: 'session-1',
      shopId: 'shop-1', workflowId: 'workflow-1',
      draftRevision: 3, draftVersion: 4, policyRevision: 'policy-7',
    },
    ingest: null,
  },
};
vaultEntry = null;
ingestRecoveryFailure = Object.assign(new Error('not committed'), {
  code: 'SS_ERP_BYOK_INGEST_RECEIPT_NOT_COMMITTED',
  outcome: 'UNKNOWN_OUTCOME',
});
ingestOperationState = { dispatched: true, status: 'UNKNOWN_OUTCOME' };
const uploadsBeforeEmptyVaultRecovery = calls.filter((row) => row[0] === 'ingest').length;
const emptyVaultRecovery = await dispatcher.handlers[MESSAGE_TYPES.RECOVER_INGEST]({
  payload: { resultId }, sender,
});
assert.equal(emptyVaultRecovery.ok, false);
assert.equal(session.result, null, 'restart recovery without Blob bytes must exit to a clear state');
assert.equal(calls.filter((row) => row[0] === 'ingest').length, uploadsBeforeEmptyVaultRecovery);
ingestRecoveryFailure = null;
ingestOperationState = { dispatched: true, status: 'UNKNOWN_OUTCOME' };

session = {
  context: launchContext, sourceTabId: 12, sourceDocumentId: 'source-document-1',
  workbenchTabId: 77, workbenchDocumentId: 'document-1', operation: null,
  result: {
    resultId, reviewState: 'APPROVED', deliveryState: 'NOT_INGESTED',
    ingestIdempotencyKey: null, ingestRequestHash: null, ingestAuthority: null, ingest: null,
  },
};
vaultEntry = { ...entry, reviewState: 'APPROVED' };
ingestFailure = Object.assign(new Error('grant disappeared before upload'), {
  code: 'SS_ERP_BYOK_INGEST_GRANT_UNAVAILABLE',
  outcome: 'FAILED_RETRYABLE',
  resetGrant: true,
});
ingestOperationState = { dispatched: true, status: 'FAILED_RETRYABLE' };
const discardsBeforeAbsentGrant = calls.filter((row) => row[0] === 'discard-ingest').length;
const absentGrant = await dispatcher.handlers[MESSAGE_TYPES.INGEST]({
  payload: { resultId }, sender,
});
assert.equal(absentGrant.ok, false);
assert.equal(session.result.deliveryState, 'NOT_INGESTED');
assert.notEqual(vaultEntry, null, 'a retryable grant failure must preserve the approved candidate');
assert.equal(
  calls.filter((row) => row[0] === 'discard-ingest').length,
  discardsBeforeAbsentGrant + 1,
  'resetting a retryable grant failure must purge its old client operation',
);
const absentGrantKey = calls.filter((row) => row[0] === 'ingest').at(-1)[1].idempotencyKey;

ingestFailure = Object.assign(new Error('grant was rejected before binary dispatch'), {
  code: 'SS_ERP_BYOK_INGEST_GRANT_REJECTED',
  outcome: 'FAILED_FINAL',
});
ingestOperationState = { dispatched: false, status: 'FAILED_FINAL' };
const discardsBeforePreBinaryFinal = calls.filter((row) => row[0] === 'discard-ingest').length;
const preBinaryFinal = await dispatcher.handlers[MESSAGE_TYPES.INGEST]({
  payload: { resultId }, sender,
});
assert.equal(preBinaryFinal.ok, false);
assert.equal(session.result.deliveryState, 'NOT_INGESTED');
assert.notEqual(vaultEntry, null, 'pre-binary terminal denial must preserve the approved candidate');
assert.equal(
  calls.filter((row) => row[0] === 'discard-ingest').length,
  discardsBeforePreBinaryFinal + 1,
);
const preBinaryFinalKey = calls.filter((row) => row[0] === 'ingest').at(-1)[1].idempotencyKey;
assert.notEqual(preBinaryFinalKey, absentGrantKey);

ingestFailure = null;
ingestOperationState = { dispatched: true, status: 'UNKNOWN_OUTCOME' };
const retriedPreBinary = await dispatcher.handlers[MESSAGE_TYPES.INGEST]({
  payload: { resultId }, sender,
});
assert.equal(retriedPreBinary.ok, true);
const retriedPreBinaryKey = calls.filter((row) => row[0] === 'ingest').at(-1)[1].idempotencyKey;
assert.notEqual(
  retriedPreBinaryKey,
  preBinaryFinalKey,
  'a reset pre-binary terminal failure must retry with a fresh idempotency identity',
);

session = {
  context: launchContext, sourceTabId: 12, sourceDocumentId: 'source-document-1',
  workbenchTabId: 77, workbenchDocumentId: 'document-1', operation: null,
  result: {
    resultId, reviewState: 'APPROVED', deliveryState: 'NOT_INGESTED',
    ingestIdempotencyKey: null, ingestRequestHash: null, ingestAuthority: null, ingest: null,
  },
};
vaultEntry = { ...entry, reviewState: 'APPROVED' };
const rejectApproved = await dispatcher.handlers[MESSAGE_TYPES.REVIEW_RESULT]({
  payload: { resultId, decision: 'REJECT' }, sender,
});
assert.equal(rejectApproved.ok, true);
assert.equal(rejectApproved.data.reviewState, 'REJECTED');
assert.equal(session.result, null);
assert.equal(vaultEntry, null);

session = {
  ...session,
  operation: { idempotencyKey: 'byok_batch_unresolved_1', state: 'OUTCOME_UNRESOLVED' },
};
resolvedLaunchDecision = choiceLaunchDecision();
const staleBatchSession = await dispatcher.handlers[MESSAGE_TYPES.GET_PUBLIC_STATE]({
  payload: {}, sender,
});
assert.equal(staleBatchSession.ok, false);
assert.equal(staleBatchSession.errorCode, 'SS_ERP_BYOK_WORKBENCH_CONTEXT_STALE');
assert.equal(
  session.operation.state,
  'OUTCOME_UNRESOLVED',
  'legacy context cleanup must retain a possibly charged batch operation',
);
resolvedLaunchDecision = readyLaunchDecision();
const blockedRemoval = await dispatcher.removeTab(77);
assert.equal(blockedRemoval, false);
assert.equal(session.operation.state, 'OUTCOME_UNRESOLVED');
session = { ...session, operation: null };
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
  authorization: authorizationFor(rejectedBinding),
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
  authorization: authorizationFor(),
});
  await new Promise((resolve) => setImmediate(resolve));
const editStartsBeforeTextConflict = calls.filter((row) => row[0] === 'edit-start').length;
const editWhileTextActive = await dispatcher.handlers[MESSAGE_TYPES.EDIT_START]({
  payload: editCommand,
  sender,
});
assert.equal(editWhileTextActive.ok, false);
assert.equal(editWhileTextActive.errorCode, 'SS_ERP_BYOK_WORKBENCH_MODE_CONFLICT');
assert.equal(calls.filter((row) => row[0] === 'edit-start').length, editStartsBeforeTextConflict);
const conflictingConcurrent = await dispatcher.handlers[MESSAGE_TYPES.EXECUTE_PROVIDER]({
  payload: {
    profileId: 'profile-1', prompt: 'Different payload with the same key',
    negativePrompt: null, size: '1024x1024', idempotencyKey: 'generate-concurrent-1',
  },
  sender,
  authorization: authorizationFor(),
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

let releaseIngestGate;
ingestGate = { promise: new Promise((resolve) => { releaseIngestGate = resolve; }) };
const ingestCallsBeforeConcurrency = calls.filter((row) => row[0] === 'ingest').length;
const firstConcurrentIngest = dispatcher.handlers[MESSAGE_TYPES.INGEST]({
  payload: { resultId }, sender,
  authorization: authorizationFor(),
});
await new Promise((resolve) => setImmediate(resolve));
const secondConcurrentIngest = await dispatcher.handlers[MESSAGE_TYPES.INGEST]({
  payload: { resultId }, sender,
  authorization: authorizationFor(),
});
assert.equal(secondConcurrentIngest.ok, false);
assert.equal(secondConcurrentIngest.errorCode, 'SS_ERP_BYOK_WORKBENCH_REVIEW_IN_PROGRESS');
assert.equal(
  calls.filter((row) => row[0] === 'ingest').length,
  ingestCallsBeforeConcurrency + 1,
  'the shared result lock must allow only one binary ingest',
);
releaseIngestGate();
ingestGate = null;
assert.equal((await firstConcurrentIngest).data.deliveryState, 'BOUND');

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
  authorization: authorizationFor(),
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
  authorization: authorizationFor(),
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
