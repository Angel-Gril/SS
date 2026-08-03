import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const registryPath = 'extensions/ss-erp/shared/byok/workbench-batch-registry.js';
const brokerPath = 'extensions/ss-erp/shared/byok/execution-intent-claim-broker.js';
const runtimeHandlerPath =
  'extensions/ss-erp/shared/byok/workbench-batch-runtime-handler.js';
const CANONICAL_BINI_SKU_KEY = 'sku:5777037825166|晚霞肤(1.5cm+4cm胸垫)>M(适合34/75ABC)';
const CANONICAL_BINI_SLOT_KEY = `sku:${CANONICAL_BINI_SKU_KEY}:hero`;

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertSanitizedProjection(value) {
  const forbidden = new Set([
    'batchid', 'binding', 'providerorigin', 'model', 'dispatchref', 'recoveryref',
    'receipt', 'prompt', 'blob', 'binary', 'url',
  ]);
  function inspect(candidate) {
    if (candidate === null || candidate === undefined) return;
    if (typeof candidate === 'string') {
      assert.doesNotMatch(candidate, /^(?:https?|ftp|file|blob|data):/iu);
      return;
    }
    if (typeof candidate !== 'object') return;
    assert.equal(candidate instanceof ArrayBuffer, false);
    for (const [key, nested] of Object.entries(candidate)) {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/gu, '');
      assert.equal(forbidden.has(normalized), false, `forbidden projection key: ${key}`);
      assert.equal(normalized.includes('hash'), false, `hash projection key: ${key}`);
      inspect(nested);
    }
  }
  inspect(value);
}

function owner(overrides = {}) {
  return { tabId: 17, documentId: 'document-1', ...overrides };
}

function sessionContext() {
  return {
    contractVersion: 'extension-byok-workbench-launch-context/v1',
    sourcePlatform: '1688', sourceProductId: 'source-1',
    sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
    shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 7, draftVersion: 11,
    skuKey: 'sku-1', slotKey: 'sku:sku-1:hero', assignmentMode: 'APPEND',
    assignmentOrdinal: 17,
  };
}

function pageSlot(index, overrides = {}) {
  const shared = index === 1;
  return {
    skuKey: 'sku-1',
    slotKey: shared ? 'shared:detail:DETAIL' : 'sku:sku-1:hero',
    operation: 'TEXT_TO_IMAGE',
    providerIdempotencyKey: `provider-attempt-${String(index + 1).padStart(4, '0')}`,
    intentHash: String(index + 1).repeat(64),
    prompt: shared ? 'Show product construction details.' : 'Create a clean product hero image.',
    negativePrompt: null,
    size: '1024x1024',
    ...overrides,
  };
}

function pageStart(overrides = {}) {
  return {
    contractVersion: 'extension-byok-workbench-batch-start-request/v1',
    profileId: 'profile-1',
    requestedConcurrency: 1,
    slots: [pageSlot(0), pageSlot(1)],
    ...overrides,
  };
}

function pageCommand(kind, value = {}) {
  return {
    contractVersion: 'extension-byok-workbench-batch-runtime-command/v1',
    kind,
    commandId: `command-${kind.toLowerCase()}`,
    expectedWorkspaceRevision: 3,
    expectedRuntimeRevision: 1,
    ...value,
  };
}

function binding(slot, ordinal) {
  return {
    contractVersion: 'extension-byok-readiness-binding/v2',
    ownerUserId: 'owner-1', deviceSessionId: 'session-1',
    shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 7, draftVersion: 11,
    sourcePlatform: '1688', sourceProductId: 'source-1',
    sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
    skuKey: slot.skuKey, slotKey: slot.slotKey, assignmentMode: 'APPEND',
    assignmentOrdinal: ordinal, providerOrigin: 'https://provider.example',
    model: 'image-model-1', operation: slot.operation, policyRevision: '23',
  };
}

function emptyProjection() {
  return {
    contractVersion: 'extension-byok-workbench-batch-coordinator/v1',
    executionMode: 'BYOK', revision: 0, batchId: null, binding: null,
    scheduler: null, billing: { erpGenerationChargeCents: 0 }, slots: [], ingest: null,
  };
}

function createHarness(options = {}) {
  const events = [];
  const source = readFileSync(registryPath, 'utf8');
  const context = {
    Array, Boolean, Date, Error, JSON, Map, Math, Number, Object, Promise,
    RegExp, Set, String, TypeError, URL,
  };
  context.globalThis = context;
  vm.runInNewContext(readFileSync(brokerPath, 'utf8'), context, { filename: brokerPath });
  vm.runInNewContext(source, context, { filename: registryPath });
  vm.runInNewContext(
    readFileSync(runtimeHandlerPath, 'utf8'),
    context,
    { filename: runtimeHandlerPath },
  );
  const api = context.SS_ERP_BYOK_WORKBENCH_BATCH_REGISTRY;
  const runtimeApi = context.SS_ERP_BYOK_WORKBENCH_BATCH_RUNTIME_HANDLER;

  let operation = options.initialOperation ? plain(options.initialOperation) : null;
  let clearFailuresRemaining = options.clearFailureOnce ? 1 : 0;
  let clearAppliedFailuresRemaining = options.clearAppliedFailureOnce ? 1 : 0;
  const sessionManager = {
    async claim(sender) {
      events.push(['session-claim', plain(sender)]);
      return {
        context: sessionContext(), workbenchTabId: 17,
        workbenchDocumentId: sender.documentId, operation,
      };
    },
    async beginOperation(sender, key, recovery) {
      events.push(['operation-begin', key, plain(recovery)]);
      if (operation) throw new Error('locked');
      operation = { idempotencyKey: key, state: 'OUTCOME_UNRESOLVED', recovery: plain(recovery) };
      return { context: sessionContext(), workbenchTabId: 17,
        workbenchDocumentId: sender.documentId, operation };
    },
    async updateOperationRecovery(sender, key, recovery) {
      events.push(['operation-recovery', key, plain(recovery)]);
      if (!operation || operation.idempotencyKey !== key) throw new Error('mismatch');
      operation = { ...operation, recovery: plain(recovery) };
      return { context: sessionContext(), workbenchTabId: 17,
        workbenchDocumentId: sender.documentId, operation };
    },
    async clearOperation(_sender, key) {
      events.push(['operation-clear', key]);
      if (clearAppliedFailuresRemaining > 0) {
        clearAppliedFailuresRemaining -= 1;
        operation = null;
        throw new Error('operation clear response lost');
      }
      if (clearFailuresRemaining > 0) {
        clearFailuresRemaining -= 1;
        throw new Error('operation clear temporarily unavailable');
      }
      if (!operation || operation.idempotencyKey !== key) throw new Error('mismatch');
      operation = null;
      return { context: sessionContext(), workbenchTabId: 17,
        workbenchDocumentId: 'document-1', operation: null };
    },
  };

  const batchLaunchClient = options.batchLaunchClient || {
    async resolve(value) {
      events.push(['launch', plain(value)]);
      const bindingValue = { ...value };
      delete bindingValue.preferredSkuKey;
      delete bindingValue.selectionKind;
      return {
        contractVersion: 'extension-byok-workbench-batch-launch-context/v1',
        ...bindingValue,
        anchorSkuKey: 'sku-1', firstAssignmentOrdinal: 17,
        targets: [
          { skuKey: 'sku-1', slotKey: 'sku:sku-1:hero' },
          { skuKey: 'sku-1', slotKey: 'shared:detail:DETAIL' },
        ],
      };
    },
  };

  const readiness = [];
  const readinessClient = {
    async getReadiness(value) {
      events.push(['readiness', value.slotKey]);
      const result = {
        readinessHandle: `rh_${String(readiness.length + 1).repeat(48)}`,
        readinessBinding: binding(value, value.assignmentOrdinal),
        expiresAt: '2026-07-28T04:30:00.000Z',
        concurrencyAuthority: { policyRevision: '23', maxConcurrency: 2 },
      };
      readiness.push(result);
      return result;
    },
  };

  const prepared = [];
  const released = [];
  function preparedClient(name, operationName) {
    return {
      async prepareDispatch(value) {
        events.push(['prepare', name, value.idempotencyKey]);
        if (options.prepareFailureAt === prepared.length) throw new Error('prepare failed');
        const index = prepared.length;
        if (typeof options.beforePrepare === 'function') {
          await options.beforePrepare(index, value);
        }
        const result = {
          contractVersion: 'extension-byok-prepared-provider-request/v1',
          preparedRequestHandle:
            `byok-prepared:${String(index + 1).repeat(8)}-${String(index + 1).repeat(4)}-4${String(index + 1).repeat(3)}-8${String(index + 1).repeat(3)}-${String(index + 1).repeat(12)}`,
          operation: operationName || value.operation || 'TEXT_TO_IMAGE',
          requestMode: operationName === 'TEXT_TO_IMAGE' ? 'json' : 'multipart',
          providerIdempotencyKey: value.idempotencyKey,
          providerRequestHash: String(index + 5).repeat(64),
        };
        prepared.push({ value, result });
        return result;
      },
      releasePrepared(handle) {
        events.push(['release-prepared', name, handle]);
        released.push(handle);
        return { released: true };
      },
    };
  }
  const textClient = preparedClient('text', 'TEXT_TO_IMAGE');
  const editClient = preparedClient('edit', null);

  let serverBatch = options.initialServerBatch ? plain(options.initialServerBatch) : null;
  let serverReservationKey = options.initialReservationKey
    || options.initialOperation?.recovery?.reservationIdempotencyKey
    || null;
  function serverStatus(contractVersion = 'extension-byok-execution-batch-status/v1') {
    if (!serverBatch) throw new Error('missing batch');
    const itemStatus = serverBatch.status === 'OPEN' ? 'ACTIVE'
      : serverBatch.status === 'BOUND' ? 'BOUND' : 'RELEASED';
    return {
      contractVersion,
      batchId: serverBatch.batchId,
      status: serverBatch.status,
      context: {
        ...serverBatch.context,
        sourcePlatform: '1688', sourceProductId: 'source-1',
        sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
      },
      boundDraftRevision: serverBatch.status === 'BOUND' ? 8 : null,
      boundDraftVersion: serverBatch.status === 'BOUND' ? 12 : null,
      items: serverBatch.items.map((item) => ({
        ...plain(item),
        status: itemStatus,
        intent: contractVersion === 'extension-byok-execution-batch-status/v2'
          ? {
            ...plain(item.intent),
            resultSha256: item.intent.outcome === 'SUCCEEDED'
              ? item.intent.resultSha256
              : null,
          }
          : plain(item.intent),
      })),
    };
  }
  const executionBatchClient = {
    async claim(value) {
      events.push(['reserve', plain(value)]);
      if (options.claimFailure) throw new Error('reservation transport uncertain');
      serverReservationKey = value.idempotencyKey;
      serverBatch = {
        contractVersion: 'extension-byok-execution-batch/v1',
        batchId: 'execution-batch-1', status: 'OPEN', replayed: false,
        context: { shopId: 'shop-1', workflowId: 'workflow-1',
          draftRevision: 7, draftVersion: 11 },
        items: value.items.map((item, index) => ({
          batchItemId: `batch-item-${index + 1}`, itemIndex: index,
          skuKey: item.readinessBinding.skuKey, slotKey: item.readinessBinding.slotKey,
          assignmentOrdinal: item.readinessBinding.assignmentOrdinal,
          intent: {
            contractVersion: 'extension-byok-execution-intent/v1',
            intentId: `intent-${index + 1}`, attemptIndex: 0, outcome: 'PENDING',
            providerIdempotencyKey: item.providerIdempotencyKey,
            providerRequestHash: item.providerRequestHash,
          },
        })),
      };
      if (typeof options.beforeClaimResponse === 'function') {
        await options.beforeClaimResponse(value);
      }
      if (options.claimResponseLost) throw new Error('reservation response lost');
      return serverBatch;
    },
    async claimSuccessor(value) {
      events.push(['successor', plain(value)]);
      const response = {
        contractVersion: 'extension-byok-execution-batch-attempt/v1',
        batchId: value.batchId, status: 'OPEN', replayed: false,
        context: serverBatch.context,
        item: {
          batchItemId: `batch-item-${value.itemIndex + 1}`, itemIndex: value.itemIndex,
          skuKey: value.item.readinessBinding.skuKey,
          slotKey: value.item.readinessBinding.slotKey,
          assignmentOrdinal: value.item.readinessBinding.assignmentOrdinal,
          intent: {
            contractVersion: 'extension-byok-execution-intent/v1',
            intentId: `intent-successor-${value.itemIndex + 1}`,
            attemptIndex: 1, outcome: 'PENDING',
            providerIdempotencyKey: value.item.providerIdempotencyKey,
            providerRequestHash: value.item.providerRequestHash,
          },
        },
      };
      serverBatch.items[value.itemIndex] = plain(response.item);
      if (typeof options.beforeSuccessorResponse === 'function') {
        await options.beforeSuccessorResponse(serverBatch, response, value);
      }
      if (options.successorResponseLost) throw new Error('successor response lost');
      if (options.successorResponseMalformed) throw new Error('successor response malformed');
      return response;
    },
    async cancel(value) {
      events.push(['reservation-cancel', plain(value)]);
      if (options.cancelFailure) throw new Error('cancel transport uncertain');
      if (serverBatch && serverBatch.batchId === value.batchId) serverBatch.status = 'CANCELLED';
      return { contractVersion: 'extension-byok-execution-batch-cancel/v1',
        batchId: value.batchId, status: 'CANCELLED', replayed: false };
    },
    async status(value) {
      events.push(['reservation-status', plain(value)]);
      if (options.statusFailure) throw new Error('status unavailable');
      if (options.statusOverride) return plain(options.statusOverride);
      if (!serverBatch || serverBatch.batchId !== value.batchId) throw new Error('missing batch');
      return serverStatus();
    },
    async statusV2(value) {
      events.push(['reservation-status-v2', plain(value)]);
      if (options.statusV2Failure) throw new Error('status v2 unavailable');
      if (options.statusV2Override) return plain(options.statusV2Override);
      if (options.statusOverride) throw new Error('status v2 downgraded');
      if (!serverBatch || serverBatch.batchId !== value.batchId) throw new Error('missing batch');
      return serverStatus('extension-byok-execution-batch-status/v2');
    },
    async statusByIdempotency(value) {
      events.push(['reservation-idempotency-status', plain(value)]);
      if (options.idempotencyStatusFailure) throw new Error('lookup unavailable');
      if (!serverBatch || serverReservationKey !== value.idempotencyKey) return null;
      return serverStatus();
    },
  };

  const fallbackClaims = [];
  const reported = [];
  const realBroker = context.SS_ERP_BYOK_EXECUTION_INTENT_CLAIM_BROKER.createBroker({
    fallback: {
      async claim(value) { fallbackClaims.push(value); throw new Error('fallback denied'); },
      async reportOutcome(value) {
        events.push(['report-outcome', plain(value)]);
        if (options.reportFailure) throw new Error('outcome transport uncertain');
        const serverItem = serverBatch && serverBatch.items.find(
          (item) => item.intent.intentId === value.intentId,
        );
        if (serverItem) serverItem.intent.outcome = value.outcome;
        reported.push(value);
        return { ...value, replayed: false };
      },
    },
  });
  const claimBroker = {
    registerBatch(value) { events.push(['broker-batch', plain(value)]); return realBroker.registerBatch(value); },
    registerAttempt(value) { events.push(['broker-attempt', plain(value)]); return realBroker.registerAttempt(value); },
    releaseBatch(value) { events.push(['broker-release', value]); return realBroker.releaseBatch(value); },
    claim(value) { return realBroker.claim(value); },
    reportOutcome(value) { return realBroker.reportOutcome(value); },
  };

  const authorityGuard = {
    async capture(value) {
      events.push(['authority-capture', value.slotKey]);
      return {
        lifecycleAuthority: { contractVersion: 'extension-byok-device-session-lifecycle/v1', epoch: 9 },
        ownerUserId: value.ownerUserId, deviceSessionId: value.deviceSessionId,
        shopId: value.shopId, workflowId: value.workflowId,
        draftRevision: value.draftRevision, draftVersion: value.draftVersion,
        policyRevision: value.policyRevision,
      };
    },
    async assertCurrent(value) {
      events.push(['authority-current', value.ownerUserId]);
      if (typeof options.beforeAuthorityCurrent === 'function') {
        await options.beforeAuthorityCurrent(value);
      }
      if (options.authorityStale) {
        throw Object.assign(new Error('authority stale'), {
          code: 'SS_ERP_BYOK_DEVICE_AUTHORITY_STALE',
        });
      }
      return value;
    },
  };

  let internalStart = null;
  let projection = emptyProjection();
  let coordinatorHooks = null;
  const createCoordinator = options.createCoordinator || ((value) => {
    coordinatorHooks = value;
    events.push(['coordinator-create']);
    if (options.coordinatorFailure) throw new Error('coordinator failed');
    function buildProjection(start, state = 'QUEUED') {
      return {
        contractVersion: 'extension-byok-workbench-batch-coordinator/v1',
        executionMode: 'BYOK', revision: 1, batchId: start.batchId,
        binding: { shopId: 'shop-1', workflowId: 'workflow-1',
          draftRevision: 7, draftVersion: 11, skuKey: 'sku-1' },
        scheduler: { state: 'RUNNING', activeCount: 0, queuedCount: start.slots.length,
          pauseRequested: false, effectiveConcurrency: 1 },
        billing: { erpGenerationChargeCents: 0 },
        slots: start.slots.map((slot, index) => ({
          slotKey: slot.slotKey, skuKey: slot.skuKey,
          assignmentOrdinal: slot.assignmentOrdinal, operation: slot.operation,
          revision: 1, state, selectedAttemptId: null, selectedResultId: null,
          attempts: [{
            attemptId: `attempt-${index + 1}`, generation: 1,
            operation: slot.operation, intentHash: slot.intentHash, state,
            resultId: null, resultSha256: null, errorCode: null,
            retryOfAttemptId: null, externalChargePossible: false, retryRisk: null,
            chargeWarningVersion: null, automaticRetryAllowed: null,
            recoveryRequirement: null, unknownOutcomeSuperseded: false,
            reviewState: 'NOT_READY',
          }],
        })),
        ingest: { state: 'NOT_STARTED', idempotencyKey: null, replayed: null,
          receiptId: null, requestHash: null, boundDraftRevision: null,
          boundDraftVersion: null, erpGenerationChargeCents: 0,
          rebootstrapRequired: false, receipt: null, assignments: [], errorCode: null },
      };
    }
    return {
      startBatch(value) {
        events.push(['coordinator-start', plain(value)]);
        internalStart = value;
        projection = buildProjection(value);
        return projection;
      },
      restoreBatch(value) {
        events.push(['coordinator-restore', plain(value)]);
        internalStart = value;
        projection = buildProjection({
          batchId: value.batchId,
          slots: value.slots.map((restoredSlot) => ({
            ...restoredSlot,
            intentHash: value.attempts.find(
              (attempt) => attempt.slotKey === restoredSlot.slotKey,
            ).intentHash,
          })),
        }, 'CANDIDATE_READY');
        projection.scheduler = {
          state: 'REVIEW', activeCount: 0, queuedCount: 0,
          pauseRequested: false, effectiveConcurrency: 1,
        };
        projection.slots.forEach((projectedSlot) => {
          projectedSlot.attempts = value.attempts
            .filter((attempt) => attempt.slotKey === projectedSlot.slotKey)
            .map((attempt) => ({
              attemptId: attempt.attemptId, generation: attempt.generation,
              operation: attempt.operation, intentHash: attempt.intentHash,
              state: 'CANDIDATE_READY', resultId: attempt.resultHandle,
              resultSha256: attempt.resultSha256, errorCode: null,
              retryOfAttemptId: null, externalChargePossible: false, retryRisk: null,
              chargeWarningVersion: null, automaticRetryAllowed: null,
              recoveryRequirement: null, unknownOutcomeSuperseded: false,
              reviewState: 'AVAILABLE',
            }));
        });
        return projection;
      },
      getProjection() { return projection; },
      pause() { return projection; },
      continue() { return projection; },
      keepAttempt(slotKey, attemptId) {
        events.push(['coordinator-keep', slotKey, attemptId]);
        const projectedSlot = projection.slots.find((item) => item.slotKey === slotKey);
        projectedSlot.selectedAttemptId = attemptId;
        projectedSlot.selectedResultId = projectedSlot.attempts.find(
          (attempt) => attempt.attemptId === attemptId,
        ).resultId;
        projectedSlot.attempts.forEach((attempt) => {
          attempt.reviewState = attempt.attemptId === attemptId ? 'KEPT' : attempt.reviewState;
        });
        return projection;
      },
      rejectAttempt(slotKey, attemptId) {
        events.push(['coordinator-reject', slotKey, attemptId]);
        const projectedSlot = projection.slots.find((item) => item.slotKey === slotKey);
        projectedSlot.attempts.find(
          (attempt) => attempt.attemptId === attemptId,
        ).reviewState = 'REJECTED';
        return projection;
      },
      cancelQueued(attemptId) {
        events.push(['coordinator-cancel', attemptId]);
        for (const slot of projection.slots) {
          const attempt = slot.attempts.find((item) => item.attemptId === attemptId);
          if (attempt && attempt.state === 'QUEUED') {
            attempt.state = 'CANCELLED';
            projection.scheduler.queuedCount -= 1;
            return { cancelled: true, attemptId, projection };
          }
        }
        return { cancelled: false, attemptId, projection };
      },
      regenerateSlot(_slotKey, value) { events.push(['coordinator-regenerate', plain(value)]); return projection; },
      async retryAttempt(attemptId, value) { events.push(['coordinator-retry', attemptId, plain(value)]); return projection; },
      async resolveUnknownAttempt(attemptId, recoveryRef) {
        events.push(['coordinator-resolve', attemptId, recoveryRef]);
        await coordinatorHooks.resolveRecovery({ purpose: 'RESOLVE', recoveryRef,
          attempt: { attemptId } });
        return projection;
      },
      async ingestSelectedBatch(value) { events.push(['ingest', plain(value)]); return projection; },
      async recoverIngest(value) { events.push(['recover', plain(value)]); return projection; },
      dispose() { events.push(['coordinator-dispose']); },
    };
  });

  const restoredResults = new Map();
  const resultVault = {
    restore(candidate) {
      events.push(['vault-restore', candidate.resultId]);
      const entry = {
        resultId: candidate.resultId,
        reviewState: 'CANDIDATE_READY',
        blob: candidate.result.image.blob,
        mimeType: candidate.result.image.mimeType,
        byteLength: candidate.result.image.byteLength,
        sha256: candidate.result.image.sha256,
      };
      restoredResults.set(entry.resultId, entry);
      return {
        resultId: entry.resultId, outcome: 'SUCCEEDED',
        operation: candidate.result.operation, model: candidate.result.model,
        policyRevision: candidate.result.policyRevision,
        idempotencyKey: candidate.result.idempotencyKey,
        requestHash: candidate.result.requestHash,
        reviewState: entry.reviewState,
        image: { mimeType: entry.mimeType, byteLength: entry.byteLength, sha256: entry.sha256 },
      };
    },
    getForBackground(resultId) {
      return restoredResults.get(resultId) || {
        resultId: 'br_' + 'a'.repeat(48), reviewState: 'CANDIDATE_READY',
        blob: {}, mimeType: 'image/png', byteLength: 4, sha256: '9'.repeat(64),
      };
    },
    release(resultId) {
      events.push(['vault-release', resultId]);
      restoredResults.delete(resultId);
      return true;
    },
  };
  const escrowCandidates = options.escrowRepository || new Map();
  (options.initialEscrowCandidates || []).forEach((candidate) => {
    escrowCandidates.set(candidate.result.executionIntentId, candidate);
  });
  const resultEscrow = {
    async findByExecutionIntentId(executionIntentId, expected) {
      events.push(['escrow-find', executionIntentId, plain(expected)]);
      const candidate = escrowCandidates.get(executionIntentId);
      if (typeof options.beforeEscrowFind === 'function') {
        await options.beforeEscrowFind(executionIntentId, expected);
      }
      if (options.escrowKeyLoss) throw new Error('escrow key unavailable');
      return candidate ? { ...candidate, result: { ...candidate.result,
        image: { ...candidate.result.image } } } : null;
    },
    async delete(resultId) {
      events.push(['escrow-delete', resultId]);
      if (typeof options.beforeEscrowDelete === 'function') {
        await options.beforeEscrowDelete(resultId);
      }
      if (options.escrowDeleteFailure) {
        throw Object.assign(new Error('escrow delete unavailable'), {
          code: 'SS_ERP_BYOK_RESULT_ESCROW_UNAVAILABLE',
          outcome: 'FAILED_FINAL', automaticRetryAllowed: false,
        });
      }
      for (const [intentId, candidate] of escrowCandidates) {
        if (candidate.resultId === resultId) {
          escrowCandidates.delete(intentId);
          return true;
        }
      }
      return false;
    },
    async deleteMany(resultIds) {
      events.push(['escrow-delete-many', plain(resultIds)]);
      if (options.escrowDeleteManyFailure) {
        throw Object.assign(new Error('escrow deleteMany unavailable'), {
          code: 'SS_ERP_BYOK_RESULT_ESCROW_UNAVAILABLE',
          outcome: 'FAILED_FINAL', automaticRetryAllowed: false,
        });
      }
      let deleted = 0;
      for (const resultId of resultIds) {
        for (const [intentId, candidate] of escrowCandidates) {
          if (candidate.resultId === resultId) {
            escrowCandidates.delete(intentId);
            deleted += 1;
            break;
          }
        }
      }
      return deleted;
    },
    async deleteByExecutionIntentIds(value) {
      events.push(['escrow-delete-by-intents', plain(value)]);
      if (options.escrowDeleteByIntentFailure) {
        throw Object.assign(new Error('escrow delete by intents unavailable'), {
          code: 'SS_ERP_BYOK_RESULT_ESCROW_UNAVAILABLE',
          outcome: 'FAILED_FINAL', automaticRetryAllowed: false,
        });
      }
      let deleted = 0;
      for (const intentId of value.executionIntentIds) {
        if (escrowCandidates.delete(intentId)) deleted += 1;
      }
      return deleted;
    },
  };
  const previewBroker = {
    open(value) { events.push(['preview', value.resultId]); return { ticket: 'preview-ticket-1' }; },
    releaseResult(resultId) { events.push(['preview-release', resultId]); return 0; },
  };
  let uuid = 0;
  const registry = api.createRegistry({
    sessionManager, batchLaunchClient, readinessClient, executionBatchClient,
    claimBroker, textClient, editClient, authorityGuard, createCoordinator,
    resolveProviderInput: async (value) => {
      events.push(['provider-input', value.profileId]);
      if (typeof options.beforeResolveProviderInput === 'function') {
        await options.beforeResolveProviderInput(value);
      }
      return {};
    },
    resolveRecovery: async (value) => {
      events.push(['trusted-recovery', value.attempt.attemptId]);
      return { state: 'FAILED_FINAL', candidateId: null, resultHandle: null,
        resultSha256: null, requestHash: null, errorCode: 'LOOKUP_NOT_FOUND',
        evidenceSha256: '8'.repeat(64) };
    },
    resultVault, resultEscrow, previewBroker,
    crypto: { randomUUID() {
      uuid += 1;
      return `00000000-0000-4000-8000-${String(uuid).padStart(12, '0')}`;
    } },
  });
  return {
    api, runtimeApi, registry, events, prepared, released, readiness, reported, fallbackClaims,
    claimBroker, executionBatchClient, sessionManager,
    get operation() { return operation; },
    get serverBatch() { return serverBatch; },
    get serverReservationKey() { return serverReservationKey; },
    get internalStart() { return internalStart; },
    get projection() { return projection; },
    get coordinatorHooks() { return coordinatorHooks; },
    get restoredResults() { return restoredResults; },
    get escrowRepository() { return escrowCandidates; },
  };
}

function completeProviderBatch(harness) {
  const candidates = harness.serverBatch.items.map((item, index) => {
    const resultSha256 = String(index + 7).repeat(64);
    item.intent.outcome = 'SUCCEEDED';
    item.intent.resultSha256 = resultSha256;
    const readinessBinding = harness.readiness[index].readinessBinding;
    return {
      resultId: `br_${String(index + 1).repeat(48)}`,
      expiresAtMillis: Date.now() + 300_000,
      result: {
        outcome: 'SUCCEEDED',
        operation: readinessBinding.operation,
        requestMode: readinessBinding.operation === 'TEXT_TO_IMAGE' ? 'json' : 'multipart',
        profileId: 'profile-1',
        providerOrigin: readinessBinding.providerOrigin,
        model: readinessBinding.model,
        policyRevision: readinessBinding.policyRevision,
        executionIntentId: item.intent.intentId,
        idempotencyKey: item.intent.providerIdempotencyKey,
        requestHash: item.intent.providerRequestHash,
        promptHash: String(index + 3).repeat(64),
        negativePromptHash: null,
        endpointHash: String(index + 4).repeat(64),
        providerRequestIdSha256: null,
        providerTaskIdSha256: null,
        sourceSha256: null,
        referenceSha256s: [],
        maskSha256: null,
        acceptedAt: '2026-08-03T00:00:00.000Z',
        image: {
          blob: {}, mimeType: 'image/png', byteLength: 4, sha256: resultSha256,
        },
      },
      binding: plain(readinessBinding),
      lifecycleAuthority: {
        contractVersion: 'extension-byok-device-session-lifecycle/v1', epoch: 9,
      },
    };
  });
  return candidates;
}

function legacyRecoveryV1(operation) {
  const legacy = plain(operation);
  legacy.recovery.contractVersion = 'extension-byok-workbench-batch-recovery/v1';
  delete legacy.recovery.profileId;
  return legacy;
}

function rejectingBatchLaunchClient({ state, status = null, errorCode = null }) {
  return {
    async resolve() {
      throw Object.assign(new Error('batch launch unavailable'), {
        code: 'SS_ERP_BYOK_WORKBENCH_BATCH_LAUNCH_UNAVAILABLE',
        state,
        status,
        errorCode,
      });
    },
  };
}

test('maps only trusted batch launch transport states and never exposes ERP error codes', async () => {
  const cases = [
    {
      state: 'http_error', status: 409, errorCode: 'server_context_detail',
      expected: 'SS_ERP_BYOK_WORKBENCH_CONTEXT_STALE',
    },
    {
      state: 'http_error', status: 403, errorCode: 'server_scope_detail',
      expected: 'SS_ERP_BYOK_DEVICE_AUTHORITY_STALE',
    },
    {
      state: 'scope_required', errorCode: 'server_scope_detail',
      expected: 'SS_ERP_BYOK_DEVICE_AUTHORITY_STALE',
    },
    {
      state: 'authorization_required', status: 410, errorCode: 'server_revocation_detail',
      expected: 'SS_ERP_BYOK_DEVICE_AUTHORITY_STALE',
    },
    {
      state: 'unpaired', errorCode: 'server_pairing_detail',
      expected: 'SS_ERP_BYOK_DEVICE_AUTHORITY_STALE',
    },
    {
      state: 'http_error', status: 500,
      errorCode: 'SS_ERP_BYOK_PROVIDER_KEY_REQUIRED',
      expected: 'SS_ERP_BYOK_WORKBENCH_BATCH_LAUNCH_UNAVAILABLE',
    },
    {
      state: 'transport_error', status: 409,
      errorCode: 'SS_ERP_BYOK_WORKBENCH_CONTEXT_STALE',
      expected: 'SS_ERP_BYOK_WORKBENCH_BATCH_LAUNCH_UNAVAILABLE',
    },
  ];
  for (const value of cases) {
    const harness = createHarness({
      batchLaunchClient: rejectingBatchLaunchClient(value),
    });
    await assert.rejects(
      harness.registry.start(owner(), pageStart()),
      (error) => error?.code === value.expected
        && error?.code !== value.errorCode
        && !Object.hasOwn(error, 'errorCode'),
    );
    assert.equal(harness.operation, null, `${value.state}/${value.status} releases start lock`);
    assert.equal(harness.events.some((event) => event[0] === 'readiness'), false);
    assert.equal(harness.events.some((event) => event[0] === 'reserve'), false);
  }
});

test('returns stable batch launch recovery semantics through the runtime dispatcher', async () => {
  const messageTypes = Object.freeze({
    BATCH_STATE: 'batch-state',
    BATCH_START: 'batch-start',
    BATCH_COMMAND: 'batch-command',
    BATCH_PREVIEW: 'batch-preview',
    BATCH_INGEST: 'batch-ingest',
    BATCH_RECOVER: 'batch-recover',
    BATCH_CLEAR: 'batch-clear',
  });
  for (const value of [
    {
      state: 'http_error', status: 409, errorCode: 'private_server_context_message',
      expected: 'SS_ERP_BYOK_WORKBENCH_CONTEXT_STALE',
    },
    {
      state: 'scope_required', errorCode: 'private_server_scope_message',
      expected: 'SS_ERP_BYOK_DEVICE_AUTHORITY_STALE',
    },
  ]) {
    const harness = createHarness({
      batchLaunchClient: rejectingBatchLaunchClient(value),
    });
    const dispatcher = harness.runtimeApi.createDispatcher({
      messageTypes,
      registry: harness.registry,
    });
    const response = await dispatcher.handlers[messageTypes.BATCH_START]({
      sender: owner(),
      payload: {
        contractVersion: harness.runtimeApi.REQUEST_VERSION,
        startRequest: {
          ...pageStart(),
          contractVersion: 'extension-byok-workbench-batch-user-start/v1',
        },
      },
    });
    assert.deepEqual(plain(response), {
      ok: false,
      errorCode: value.expected,
      error: 'BYOK batch workbench operation failed',
      outcome: 'FAILED_FINAL',
      automaticRetryAllowed: false,
    });
    assert.equal(JSON.stringify(response).includes(value.errorCode), false);
  }
});

test('prepares every slot, reserves once, expands minimal intents, then starts coordinator', async () => {
  const harness = createHarness();
  const result = await harness.registry.start(owner(), pageStart());
  assert.equal(Object.hasOwn(result, 'batchId'), false);
  assert.equal(Object.hasOwn(result, 'binding'), false);
  assertSanitizedProjection(result);
  assert.equal(harness.prepared.length, 2);
  assert.deepEqual(harness.events.find((event) => event[0] === 'launch')[1], {
    sourcePlatform: '1688', sourceProductId: 'source-1',
    sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
    shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 7, draftVersion: 11,
    preferredSkuKey: 'sku-1',
    selectionKind: 'EXPLICIT',
  });
  assert.equal(harness.events.filter((event) => event[0] === 'reserve').length, 1);
  const operationBegin = harness.events.find((event) => event[0] === 'operation-begin');
  const reservation = harness.events.find((event) => event[0] === 'reserve');
  assert.match(
    operationBegin[2].reservationIdempotencyKey,
    /^byok-reservation:[0-9a-f-]{36}$/u,
  );
  assert.equal(operationBegin[2].reservationIdempotencyKey, reservation[1].idempotencyKey);
  assert.ok(harness.events.indexOf(operationBegin) < harness.events.indexOf(reservation));
  assert.ok(harness.events.findIndex((event) => event[0] === 'reserve')
    > harness.events.findLastIndex((event) => event[0] === 'prepare'));
  assert.ok(harness.events.findIndex((event) => event[0] === 'broker-batch')
    < harness.events.findIndex((event) => event[0] === 'coordinator-start'));
  assert.equal(harness.internalStart.batchId, 'execution-batch-1');
  assert.equal(Object.hasOwn(harness.internalStart, 'profileId'), false);
  assert.equal(harness.internalStart.slots[0].assignmentOrdinal, 17);
  assert.equal(harness.internalStart.slots[1].assignmentOrdinal, 18);
  assert.match(harness.internalStart.slots[0].dispatchRef, /^byok-dispatch:/u);

  const claim = harness.events.find((event) => event[0] === 'reserve')[1].items[0];
  const intent = await harness.claimBroker.claim(claim);
  assert.deepEqual(plain(intent), {
    contractVersion: 'extension-byok-execution-intent/v1',
    intentId: 'intent-1', replayed: false, executionMode: 'BYOK', outcome: 'PENDING',
    providerIdempotencyKey: 'provider-attempt-0001',
    providerRequestHash: '5'.repeat(64),
    context: { shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 7,
      draftVersion: 11, skuKey: 'sku-1', slotKey: 'sku:sku-1:hero' },
  });
  assert.equal(harness.fallbackClaims.length, 0, 'reserved intent never falls back');
  const dispatchInput = await harness.coordinatorHooks.resolveDispatchInput(
    harness.internalStart.slots[0].dispatchRef,
    { attemptId: 'attempt-1', slotKey: 'sku:sku-1:hero', generation: 1,
      operation: 'TEXT_TO_IMAGE', executionMode: 'BYOK', policyRevision: '23',
      idempotencyKey: 'provider-attempt-0001', intentHash: '1'.repeat(64) },
  );
  assert.deepEqual(plain(dispatchInput), {
    preparedRequestHandle: harness.prepared[0].result.preparedRequestHandle,
    executionIntentId: 'intent-1',
    providerRequestHash: '5'.repeat(64),
  });
  await assert.rejects(
    harness.coordinatorHooks.resolveDispatchInput(
      harness.internalStart.slots[0].dispatchRef,
      { attemptId: 'attempt-1', slotKey: 'sku:sku-1:hero', generation: 1,
        operation: 'TEXT_TO_IMAGE', executionMode: 'BYOK', policyRevision: '23',
        idempotencyKey: 'provider-attempt-0001', intentHash: '1'.repeat(64) },
    ),
    (error) => error?.code === 'SS_ERP_BYOK_BATCH_REGISTRY_DISPATCH_UNAVAILABLE'
      && error.outcome === 'UNKNOWN_OUTCOME',
  );
});

test('credential reset fence blocks a queued runner before prepared Provider handoff', async () => {
  let blockRunner = false;
  let runnerEntered;
  let releaseRunner;
  const entered = new Promise((resolve) => { runnerEntered = resolve; });
  const barrier = new Promise((resolve) => { releaseRunner = resolve; });
  const harness = createHarness({
    async beforeAuthorityCurrent() {
      if (!blockRunner) return;
      blockRunner = false;
      runnerEntered();
      await barrier;
    },
  });
  await harness.registry.start(owner(), pageStart());
  blockRunner = true;
  const slot = harness.internalStart.slots[0];
  const pendingResolve = harness.coordinatorHooks.resolveDispatchInput(
    slot.dispatchRef,
    {
      attemptId: 'attempt-1', slotKey: slot.slotKey, generation: 1,
      operation: slot.operation, executionMode: 'BYOK', policyRevision: '23',
      idempotencyKey: slot.idempotencyKey, intentHash: slot.intentHash,
    },
  );
  await entered;

  let finalizeEntered;
  let releaseFinalize;
  const inFinalize = new Promise((resolve) => { finalizeEntered = resolve; });
  const finalizeBarrier = new Promise((resolve) => { releaseFinalize = resolve; });
  const cleanup = harness.registry.clearAll('provider_state_changed', async () => {
    finalizeEntered();
    await finalizeBarrier;
  });
  await inFinalize;
  releaseRunner();
  await assert.rejects(
    pendingResolve,
    (error) => error?.code === 'SS_ERP_BYOK_BATCH_REGISTRY_MUTATION_IN_PROGRESS'
      && error?.outcome === 'FAILED_RETRYABLE',
  );
  assert.equal(
    harness.events.filter((event) => event[0] === 'release-prepared').length,
    2,
    'cleanup must revoke every queued prepared handle before finalize returns',
  );
  releaseFinalize();
  assert.equal(await cleanup, 1);
  assert.equal(harness.operation, null);
});

test('preserves the canonical Unicode SKU hero slot through registry preparation and reservation', async () => {
  const harness = createHarness({
    batchLaunchClient: {
      async resolve(value) {
        const response = { ...value };
        delete response.preferredSkuKey;
        delete response.selectionKind;
        return {
          contractVersion: 'extension-byok-workbench-batch-launch-context/v1',
          ...response,
          anchorSkuKey: 'sku-1',
          firstAssignmentOrdinal: 17,
          targets: [{ skuKey: CANONICAL_BINI_SKU_KEY, slotKey: CANONICAL_BINI_SLOT_KEY }],
        };
      },
    },
  });
  await harness.registry.start(owner(), pageStart({
    slots: [pageSlot(0, {
      skuKey: CANONICAL_BINI_SKU_KEY,
      slotKey: CANONICAL_BINI_SLOT_KEY,
    })],
  }));
  assert.equal(harness.internalStart.slots[0].slotKey, CANONICAL_BINI_SLOT_KEY);
  assert.equal(harness.prepared[0].value.readinessBinding.slotKey, CANONICAL_BINI_SLOT_KEY);
  assert.equal(harness.events.find((event) => event[0] === 'reserve')[1].items[0]
    .readinessBinding.slotKey, CANONICAL_BINI_SLOT_KEY);
});

test('rejects requested concurrency above one before claiming a device operation', async () => {
  for (const requestedConcurrency of [2, 3, 4]) {
    const harness = createHarness();
    await assert.rejects(
      harness.registry.start(owner(), pageStart({ requestedConcurrency })),
      (error) => error?.code === 'SS_ERP_BYOK_BATCH_REGISTRY_INPUT_INVALID'
        && error?.outcome === 'FAILED_FINAL',
    );
    assert.deepEqual(harness.events, []);
    assert.equal(harness.operation, null);
  }
});

test('rejects credential-shaped persisted operation identities before recovery I/O', async () => {
  const harness = createHarness({
    initialOperation: {
      idempotencyKey: 'sk-' + 'a'.repeat(24),
      state: 'OUTCOME_UNRESOLVED',
      recovery: null,
    },
  });
  await assert.rejects(
    harness.registry.state(owner()),
    (error) => error?.code === 'SS_ERP_BYOK_BATCH_REGISTRY_SESSION_INVALID',
  );
  assert.equal(
    harness.events.some((event) => event[0] === 'reservation-idempotency-status'),
    false,
  );
});

test('a preparation failure releases handles and clears the persistent operation lock', async () => {
  const harness = createHarness({ prepareFailureAt: 1 });
  await assert.rejects(harness.registry.start(owner(), pageStart()));
  assert.equal(harness.released.length, 1);
  assert.equal(harness.events.some((event) => event[0] === 'reserve'), false);
  assert.equal(harness.events.filter((event) => event[0] === 'operation-clear').length, 1);
  assert.equal(harness.operation, null);
});

test('startup rollback terminalizes undispatched intents before cancelling reservation', async () => {
  const harness = createHarness({ coordinatorFailure: true });
  await assert.rejects(harness.registry.start(owner(), pageStart()));
  assert.deepEqual(harness.reported.map((item) => item.outcome), ['FAILED_FINAL', 'FAILED_FINAL']);
  const reportIndex = harness.events.findLastIndex((event) => event[0] === 'report-outcome');
  const cancelIndex = harness.events.findIndex((event) => event[0] === 'reservation-cancel');
  assert.ok(reportIndex < cancelIndex);
  assert.equal(harness.events.filter((event) => event[0] === 'operation-clear').length, 1);
  assert.equal(harness.operation, null);
  assert.equal(harness.released.length, 2);
});

test('uncertain startup cancellation retains the operation lock and recovery entry', async () => {
  const harness = createHarness({ coordinatorFailure: true, cancelFailure: true });
  await assert.rejects(harness.registry.start(owner(), pageStart()));
  assert.ok(harness.operation);
  assert.equal(harness.events.filter((event) => event[0] === 'operation-clear').length, 0);
  await assert.rejects(
    harness.registry.state(owner()),
    (error) => error?.code === 'SS_ERP_BYOK_BATCH_REGISTRY_START_UNRESOLVED'
      && error.outcome === 'UNKNOWN_OUTCOME'
      && error.automaticRetryAllowed === false,
  );
  await assert.rejects(harness.registry.start(owner(), pageStart()));
});

test('credential reset does not deadlock behind a start waiting on provider profile state', async () => {
  let releasePreparation;
  let preparationEntered;
  const entered = new Promise((resolve) => { preparationEntered = resolve; });
  const blocked = new Promise((resolve) => { releasePreparation = resolve; });
  const harness = createHarness({
    async beforeResolveProviderInput() {
      preparationEntered();
      await blocked;
    },
  });
  const pendingStart = harness.registry.start(owner(), pageStart());
  await entered;

  await assert.rejects(
    harness.registry.state(owner()),
    (error) => error?.code === 'SS_ERP_BYOK_BATCH_REGISTRY_START_UNRESOLVED'
      && error.outcome === 'UNKNOWN_OUTCOME'
      && error.automaticRetryAllowed === false,
  );
  assert.equal(harness.events.some((event) => event[0] === 'reserve'), false);

  let finalizeEntered;
  let releaseFinalize;
  const inFinalize = new Promise((resolve) => { finalizeEntered = resolve; });
  const finalizeBarrier = new Promise((resolve) => { releaseFinalize = resolve; });
  const cleanup = harness.registry.clearAll('device_disconnected', async () => {
    finalizeEntered();
    await finalizeBarrier;
  });
  await inFinalize;
  assert.equal(harness.events.some((event) => event[0] === 'prepare'), false,
    'reset must reach finalize without waiting on provider profile resolution');
  await assert.rejects(
    harness.registry.start(owner({ documentId: 'late-start' }), pageStart()),
    (error) => error?.code === 'SS_ERP_BYOK_BATCH_REGISTRY_MUTATION_IN_PROGRESS'
      && error?.outcome === 'FAILED_RETRYABLE',
  );
  assert.ok(harness.operation, 'startup lifecycle cleanup must retain the persisted lock');

  releaseFinalize();
  assert.equal(await cleanup, 0,
    'global cleanup must complete before the profile-blocked start is released');
  releasePreparation();
  await assert.rejects(
    pendingStart,
    (error) => error?.code === 'SS_ERP_BYOK_BATCH_REGISTRY_START_CANCELLED'
      && error.outcome === 'FAILED_FINAL',
  );
  assert.equal(await harness.registry.removeTab(17), 0);
  assert.deepEqual(plain(await harness.registry.clear(owner())), { cleared: false });
  assert.equal(harness.events.some((event) => event[0] === 'reserve'), false);
  assert.equal(harness.events.some((event) => event[0] === 'coordinator-start'), false);
  assert.equal(harness.operation, null);
});

test('tab-close during a lost reservation response rolls back before Provider dispatch', async () => {
  let releaseResponse;
  let reservationAccepted;
  const accepted = new Promise((resolve) => { reservationAccepted = resolve; });
  const blocked = new Promise((resolve) => { releaseResponse = resolve; });
  const harness = createHarness({
    async beforeClaimResponse() {
      reservationAccepted();
      await blocked;
    },
  });
  const pendingStart = harness.registry.start(owner(), pageStart());
  await accepted;
  assert.equal(await harness.registry.removeTab(17), 0,
    'tab cleanup must mark cancellation without waiting on the active reservation call');
  assert.ok(harness.operation);
  releaseResponse();
  await assert.rejects(
    pendingStart,
    (error) => error?.code === 'SS_ERP_BYOK_BATCH_REGISTRY_START_CANCELLED'
      && error.outcome === 'FAILED_FINAL',
  );
  assert.deepEqual(harness.reported.map((item) => item.outcome), ['FAILED_FINAL', 'FAILED_FINAL']);
  assert.equal(harness.events.filter((event) => event[0] === 'reservation-cancel').length, 1);
  assert.equal(harness.events.some((event) => event[0] === 'coordinator-start'), false);
  assert.equal(harness.operation, null);
});

test('a missing PREPARING reservation is proven absent before its lock is cleared', async () => {
  const harness = createHarness({ claimFailure: true });
  await assert.rejects(
    harness.registry.start(owner(), pageStart()),
    (error) => error?.outcome === 'UNKNOWN_OUTCOME',
  );
  assert.equal(harness.operation.recovery.phase, 'PREPARING');
  const projection = await harness.registry.state(owner());
  assert.equal(projection.revision, 0);
  assert.equal(harness.operation, null);
  assert.equal(
    harness.events.filter((event) => event[0] === 'reservation-idempotency-status').length,
    1,
  );
  assert.equal(harness.events.some((event) => event[0] === 'reservation-cancel'), false);
});

test('direct clear handles a proven-absent PREPARING reservation without a TypeError', async () => {
  const harness = createHarness({ claimFailure: true });
  await assert.rejects(harness.registry.start(owner(), pageStart()));
  assert.deepEqual(plain(await harness.registry.clear(owner())), { cleared: true });
  assert.equal(harness.operation, null);
});

test('a lost reservation response is recovered, terminalized, and cancelled without dispatch', async () => {
  const harness = createHarness({ claimResponseLost: true });
  await assert.rejects(
    harness.registry.start(owner(), pageStart()),
    (error) => error?.outcome === 'UNKNOWN_OUTCOME',
  );
  assert.equal(harness.operation.recovery.phase, 'PREPARING');
  assert.equal(
    harness.operation.recovery.reservationIdempotencyKey,
    harness.serverReservationKey,
  );
  const projection = await harness.registry.state(owner());
  assert.equal(projection.revision, 0);
  assert.deepEqual(harness.reported.map((item) => item.outcome), ['FAILED_FINAL', 'FAILED_FINAL']);
  assert.equal(harness.events.filter((event) => event[0] === 'reservation-cancel').length, 1);
  assert.equal(harness.operation, null);
  assert.equal(
    harness.events.some((event) => event[0] === 'coordinator-start'),
    false,
    'recovery must never reopen Provider dispatch',
  );
});

test('an unavailable PREPARING lookup remains absorbing and retains its operation lock', async () => {
  const harness = createHarness({ claimResponseLost: true, idempotencyStatusFailure: true });
  await assert.rejects(harness.registry.start(owner(), pageStart()));
  await assert.rejects(
    harness.registry.state(owner()),
    (error) => error?.code === 'SS_ERP_BYOK_BATCH_REGISTRY_RECONCILIATION_UNAVAILABLE'
      && error.outcome === 'UNKNOWN_OUTCOME',
  );
  assert.equal(harness.operation.recovery.phase, 'PREPARING');
  assert.equal(harness.events.some((event) => event[0] === 'reservation-cancel'), false);
});

test('a fresh Registry reconciles a persisted dispatched batch without reopening generation', async () => {
  const original = createHarness();
  await original.registry.start(owner(), pageStart());
  const restored = createHarness({
    initialOperation: original.operation,
    initialServerBatch: original.serverBatch,
  });

  const projection = await restored.registry.state(owner({ documentId: 'document-reloaded' }));
  assert.equal(projection.revision, 1);
  assert.equal(projection.scheduler.state, 'FAILED');
  assert.equal(projection.ingest.state, 'RECOVERY_REQUIRED');
  assert.equal(projection.slots.length, 2);
  assert.equal(projection.slots[0].attempts[0].state, 'UNKNOWN_OUTCOME');
  assert.equal(projection.slots[0].attempts[0].automaticRetryAllowed, false);
  assert.equal(restored.events.filter((event) => event[0] === 'reservation-status-v2').length, 1);
  assert.ok(restored.operation, 'reconciliation must retain the unresolved operation lock');
  assertSanitizedProjection(projection);

  const refreshed = await restored.registry.command(
    owner({ documentId: 'document-reloaded' }),
    pageCommand('RESOLVE_UNKNOWN', {
      commandId: 'command-reconcile-restart',
      slotKey: projection.slots[0].slotKey,
      attemptId: projection.slots[0].attempts[0].attemptId,
      expectedSlotRevision: 1,
    }),
  );
  assert.equal(refreshed.slots[0].attempts[0].state, 'UNKNOWN_OUTCOME');
  await assert.rejects(
    restored.registry.command(
      owner({ documentId: 'document-reloaded' }),
      pageCommand('RETRY', {
        commandId: 'command-retry-after-restart',
        slotKey: projection.slots[0].slotKey,
        attemptId: projection.slots[0].attempts[0].attemptId,
        expectedSlotRevision: 1,
        unknownOutcomeRecovery: {
          strategy: 'DUPLICATE_CHARGE_CONFIRMATION',
          warningVersion: 'external-provider-duplicate-charge/v1', confirmed: true,
        },
      }),
    ),
    (error) => error?.code === 'SS_ERP_BYOK_BATCH_REGISTRY_RESTART_RETRY_UNAVAILABLE'
      && error.outcome === 'UNKNOWN_OUTCOME',
  );
});

test('a fresh Registry restores exact v2 successful candidates into review without Provider dispatch', async () => {
  const original = createHarness();
  await original.registry.start(owner(), pageStart());
  const candidates = completeProviderBatch(original);
  assert.equal(
    original.operation.recovery.contractVersion,
    'extension-byok-workbench-batch-recovery/v2',
  );
  assert.equal(original.operation.recovery.profileId, 'profile-1');
  const restored = createHarness({
    initialOperation: original.operation,
    initialServerBatch: original.serverBatch,
    initialEscrowCandidates: candidates,
  });

  let projection = await restored.registry.state(owner({ documentId: 'document-reloaded' }));
  assert.equal(projection.scheduler.state, 'REVIEW');
  assert.equal(projection.scheduler.activeCount, 0);
  assert.equal(projection.scheduler.queuedCount, 0);
  assert.ok(projection.slots.every((slotValue) => (
    slotValue.state === 'CANDIDATE_READY'
      && slotValue.attempts.length === 1
      && slotValue.attempts[0].state === 'CANDIDATE_READY'
      && slotValue.attempts[0].resultId
  )));
  assert.equal(restored.events.filter((event) => event[0] === 'reservation-status-v2').length, 1);
  assert.equal(restored.events.filter((event) => event[0] === 'launch').length, 1);
  assert.equal(restored.events.filter((event) => event[0] === 'readiness').length, 2);
  assert.equal(restored.events.filter((event) => event[0] === 'authority-current').length, 2);
  assert.equal(restored.events.filter((event) => event[0] === 'escrow-find').length, 2);
  assert.equal(restored.events.filter((event) => event[0] === 'vault-restore').length, 2);
  assert.equal(restored.events.filter((event) => event[0] === 'coordinator-restore').length, 1);
  assert.equal(restored.events.some((event) => [
    'prepare', 'reserve', 'coordinator-start', 'successor',
  ].includes(event[0])), false);

  const preview = await restored.registry.openPreview(
    owner({ documentId: 'document-reloaded' }),
    {
      slotKey: projection.slots[0].slotKey,
      attemptId: projection.slots[0].attempts[0].attemptId,
    },
  );
  assert.equal(preview.ticket, 'preview-ticket-1');
  projection = await restored.registry.command(
    owner({ documentId: 'document-reloaded' }),
    pageCommand('KEEP', {
      commandId: 'command-restored-keep',
      expectedRuntimeRevision: projection.revision,
      slotKey: projection.slots[0].slotKey,
      attemptId: projection.slots[0].attempts[0].attemptId,
      expectedSlotRevision: projection.slots[0].revision,
    }),
  );
  assert.equal(projection.slots[0].attempts[0].reviewState, 'KEPT');
  await assert.rejects(
    restored.registry.command(
      owner({ documentId: 'document-reloaded' }),
      pageCommand('PAUSE', {
        commandId: 'command-restored-pause',
        expectedRuntimeRevision: projection.revision,
      }),
    ),
    (error) => error?.code === 'SS_ERP_BYOK_BATCH_REGISTRY_REVIEW_ONLY',
  );
  assert.equal(restored.events.some((event) => event[0] === 'coordinator-start'), false);
});

test('serializes concurrent restart state and preview into one escrow hydration', async () => {
  const original = createHarness();
  await original.registry.start(owner(), pageStart());
  const candidates = completeProviderBatch(original);
  let releaseFind;
  let findEntered;
  let blocked = true;
  const entered = new Promise((resolve) => { findEntered = resolve; });
  const barrier = new Promise((resolve) => { releaseFind = resolve; });
  const restored = createHarness({
    initialOperation: original.operation,
    initialServerBatch: original.serverBatch,
    initialEscrowCandidates: candidates,
    async beforeEscrowFind() {
      if (!blocked) return;
      blocked = false;
      findEntered();
      await barrier;
    },
  });
  const reloadedOwner = owner({ documentId: 'document-reloaded' });
  const statePromise = restored.registry.state(reloadedOwner);
  await entered;
  const previewPromise = restored.registry.openPreview(reloadedOwner, {
    slotKey: 'sku:sku-1:hero',
    attemptId: 'recovered-attempt-0-0',
  });
  releaseFind();
  const [projection, preview] = await Promise.all([statePromise, previewPromise]);
  assert.equal(projection.scheduler.state, 'REVIEW');
  assert.equal(preview.ticket, 'preview-ticket-1');
  assert.equal(restored.events.filter((event) => event[0] === 'reservation-status-v2').length, 1);
  assert.equal(restored.events.filter((event) => event[0] === 'escrow-find').length, 2);
  assert.equal(restored.events.filter((event) => event[0] === 'vault-restore').length, 2);
  assert.equal(restored.events.filter((event) => event[0] === 'coordinator-restore').length, 1);
  assert.equal(restored.events.some((event) => [
    'prepare', 'reserve', 'coordinator-start', 'successor',
  ].includes(event[0])), false);
});

for (const cleanupCase of [
  {
    name: 'clear',
    run: (registry, reloadedOwner) => registry.clear(reloadedOwner),
    expected: { cleared: true },
  },
  {
    name: 'clearAll',
    run: (registry) => registry.clearAll('device_disconnected'),
    expected: 1,
  },
  {
    name: 'removeTab',
    run: (registry, reloadedOwner) => registry.removeTab(reloadedOwner.tabId),
    expected: 1,
  },
]) {
  test(`${cleanupCase.name} fences and drains deferred escrow recovery before cleanup`, async () => {
    const original = createHarness();
    await original.registry.start(owner(), pageStart());
    const candidates = completeProviderBatch(original);
    let releaseFind;
    let findEntered;
    let blocked = true;
    const entered = new Promise((resolve) => { findEntered = resolve; });
    const barrier = new Promise((resolve) => { releaseFind = resolve; });
    const restored = createHarness({
      initialOperation: original.operation,
      initialServerBatch: original.serverBatch,
      initialEscrowCandidates: candidates,
      async beforeEscrowFind(executionIntentId) {
        if (!blocked || executionIntentId !== 'intent-2') return;
        blocked = false;
        findEntered();
        await barrier;
      },
    });
    const reloadedOwner = owner({ documentId: 'document-reloaded' });
    const statePromise = restored.registry.state(reloadedOwner);
    await entered;

    let cleanupSettled = false;
    const cleanupPromise = cleanupCase.run(restored.registry, reloadedOwner).finally(() => {
      cleanupSettled = true;
    });
    await Promise.resolve();
    assert.equal(cleanupSettled, false, 'cleanup must await the registered recovery barrier');
    await assert.rejects(
      restored.registry.state(reloadedOwner),
      (error) => error?.code === 'SS_ERP_BYOK_BATCH_REGISTRY_MUTATION_IN_PROGRESS'
        && error?.outcome === 'FAILED_RETRYABLE'
        && error?.automaticRetryAllowed === false,
    );
    assert.equal(restored.events.filter((event) => event[0] === 'escrow-find').length, 2,
      'a fenced recovery must fail before escrow I/O');

    releaseFind();
    await assert.rejects(
      statePromise,
      (error) => error?.code === 'SS_ERP_BYOK_BATCH_REGISTRY_MUTATION_IN_PROGRESS'
        && error?.outcome === 'FAILED_RETRYABLE',
    );
    const cleanupResult = await cleanupPromise;
    assert.deepEqual(plain(cleanupResult), cleanupCase.expected);
    assert.equal(restored.operation, null, 'cleanup must release the persisted operation lock');
    assert.equal(restored.escrowRepository.size, 0, 'cleanup must delete durable ciphertext');
    assert.equal(restored.restoredResults.size, 0, 'cleanup must release restored Blob state');

    const firstRestore = restored.events.findIndex((event) => event[0] === 'vault-restore');
    const escrowDelete = restored.events.findIndex((event) => event[0] === 'escrow-delete-many');
    const lastVaultRelease = restored.events.findLastIndex(
      (event) => event[0] === 'vault-release',
    );
    const lockClear = restored.events.findIndex((event) => event[0] === 'operation-clear');
    assert.ok(firstRestore >= 0 && firstRestore < escrowDelete,
      'recovery must finish before scoped escrow cleanup starts');
    assert.ok(escrowDelete < lastVaultRelease && lastVaultRelease < lockClear,
      'ciphertext and Blob cleanup must finish before lock release');
    assert.equal(restored.events.some((event) => [
      'prepare', 'reserve', 'coordinator-start', 'successor',
    ].includes(event[0])), false, 'cleanup recovery must not dispatch Provider work');

    const afterCleanup = await restored.registry.state(reloadedOwner);
    assert.equal(afterCleanup.revision, 0);
    assert.equal(restored.restoredResults.size, 0,
      'no late recovery may restore a Blob after cleanup returns');
  });
}

test('global reset drains pending preview and holds its fence through trusted finalize', async () => {
  const original = createHarness();
  await original.registry.start(owner(), pageStart());
  const candidates = completeProviderBatch(original);
  let blockPreview = false;
  let previewValidationEntered;
  let releasePreviewValidation;
  const previewEntered = new Promise((resolve) => { previewValidationEntered = resolve; });
  const previewBarrier = new Promise((resolve) => { releasePreviewValidation = resolve; });
  const restored = createHarness({
    initialOperation: original.operation,
    initialServerBatch: original.serverBatch,
    initialEscrowCandidates: candidates,
    async beforeAuthorityCurrent() {
      if (!blockPreview) return;
      blockPreview = false;
      previewValidationEntered();
      await previewBarrier;
    },
  });
  const reloadedOwner = owner({ documentId: 'document-reset-preview' });
  await restored.registry.state(reloadedOwner);
  blockPreview = true;
  const pendingPreview = restored.registry.openPreview(reloadedOwner, {
    slotKey: 'sku:sku-1:hero',
    attemptId: 'recovered-attempt-0-0',
  });
  await previewEntered;

  let finalizeEntered;
  let releaseFinalize;
  const inFinalize = new Promise((resolve) => { finalizeEntered = resolve; });
  const finalizeBarrier = new Promise((resolve) => { releaseFinalize = resolve; });
  let finalized = false;
  const cleanup = restored.registry.clearAll('provider_state_changed', async () => {
    finalizeEntered();
    await finalizeBarrier;
    finalized = true;
  });
  await Promise.resolve();
  assert.equal(finalized, false);
  assert.equal(restored.events.some((event) => event[0] === 'preview'), false);
  await assert.rejects(
    restored.registry.state(reloadedOwner),
    (error) => error?.code === 'SS_ERP_BYOK_BATCH_REGISTRY_MUTATION_IN_PROGRESS'
      && error?.outcome === 'FAILED_RETRYABLE',
  );
  await assert.rejects(
    restored.registry.start(owner({ documentId: 'late-global-start' }), pageStart()),
    (error) => error?.code === 'SS_ERP_BYOK_BATCH_REGISTRY_MUTATION_IN_PROGRESS'
      && error?.outcome === 'FAILED_RETRYABLE',
  );

  releasePreviewValidation();
  await assert.rejects(
    pendingPreview,
    (error) => error?.code === 'SS_ERP_BYOK_BATCH_REGISTRY_MUTATION_IN_PROGRESS'
      && error?.outcome === 'FAILED_RETRYABLE',
  );
  await inFinalize;
  assert.equal(restored.events.some((event) => event[0] === 'preview'), false,
    'a pre-reset preview must not create a late ticket');
  assert.equal(restored.escrowRepository.size, 0);
  assert.equal(restored.restoredResults.size, 0);
  const eventCount = restored.events.length;
  await assert.rejects(
    restored.registry.openPreview(reloadedOwner, {
      slotKey: 'sku:sku-1:hero', attemptId: 'recovered-attempt-0-0',
    }),
    (error) => error?.code === 'SS_ERP_BYOK_BATCH_REGISTRY_MUTATION_IN_PROGRESS',
  );
  assert.equal(restored.events.length, eventCount,
    'the fenced finalize window must reject before session, escrow, Blob, or preview I/O');

  releaseFinalize();
  assert.equal(await cleanup, 1);
  assert.equal(finalized, true);
  assert.equal((await restored.registry.state(reloadedOwner)).revision, 0);
  assert.equal(restored.events.some((event) => event[0] === 'preview'), false);
});

test('clearAll rejects an invalid finalize and releases its fence after finalize failure', async () => {
  const harness = createHarness();
  await harness.registry.start(owner(), pageStart());
  await assert.rejects(
    harness.registry.clearAll('provider_state_changed', {}),
    (error) => error?.code === 'SS_ERP_BYOK_BATCH_REGISTRY_FINALIZE_INVALID'
      && error?.outcome === 'FAILED_FINAL',
  );
  assert.equal((await harness.registry.state(owner())).revision, 1,
    'invalid finalize input must fail before cleanup');

  const finalizeFailure = new Error('trusted finalize failed');
  await assert.rejects(
    harness.registry.clearAll('provider_state_changed', async () => {
      await assert.rejects(
        harness.registry.state(owner()),
        (error) => error?.code === 'SS_ERP_BYOK_BATCH_REGISTRY_MUTATION_IN_PROGRESS',
      );
      throw finalizeFailure;
    }),
    (error) => error === finalizeFailure,
  );
  assert.equal((await harness.registry.state(owner())).revision, 0,
    'a throwing finalize must propagate and release the global fence in finally');
});

test('restores on demand for direct review, ingest, and recovery entrypoints', async () => {
  const original = createHarness();
  await original.registry.start(owner(), pageStart());
  const candidates = completeProviderBatch(original);
  const restored = createHarness({
    initialOperation: original.operation,
    initialServerBatch: original.serverBatch,
    initialEscrowCandidates: candidates,
  });
  const reloadedOwner = owner({ documentId: 'document-reloaded' });
  let projection = await restored.registry.command(reloadedOwner, pageCommand('KEEP', {
    commandId: 'command-on-demand-keep-1',
    expectedRuntimeRevision: 1,
    slotKey: 'sku:sku-1:hero',
    attemptId: 'recovered-attempt-0-0',
    expectedSlotRevision: 1,
  }));
  projection = await restored.registry.command(reloadedOwner, pageCommand('KEEP', {
    commandId: 'command-on-demand-keep-2',
    expectedRuntimeRevision: projection.revision,
    slotKey: 'shared:detail:DETAIL',
    attemptId: 'recovered-attempt-1-0',
    expectedSlotRevision: 1,
  }));
  const ingestCommand = {
    contractVersion: 'extension-byok-workbench-batch-ingest/v1',
    idempotencyKey: 'on-demand-ingest-0001',
  };
  await restored.registry.ingest(reloadedOwner, ingestCommand);
  await restored.registry.recover(reloadedOwner, ingestCommand);
  assert.equal(restored.events.filter((event) => event[0] === 'coordinator-restore').length, 1);
  assert.equal(restored.events.filter((event) => event[0] === 'coordinator-keep').length, 2);
  assert.equal(restored.events.filter((event) => event[0] === 'ingest').length, 1);
  assert.equal(restored.events.filter((event) => event[0] === 'recover').length, 1);
  assert.equal(restored.events.some((event) => [
    'prepare', 'reserve', 'coordinator-start', 'successor',
  ].includes(event[0])), false);
});

for (const failure of ['missing', 'tamper', 'key-loss']) {
  test(`worker restart keeps successful Provider evidence local-result-lost when escrow is ${failure}`, async () => {
    const original = createHarness();
    await original.registry.start(owner(), pageStart());
    const candidates = completeProviderBatch(original);
    if (failure === 'missing') candidates.shift();
    if (failure === 'tamper') candidates[0].result.image.sha256 = 'f'.repeat(64);
    const restored = createHarness({
      initialOperation: original.operation,
      initialServerBatch: original.serverBatch,
      initialEscrowCandidates: candidates,
      escrowKeyLoss: failure === 'key-loss',
    });

    const projection = await restored.registry.state(owner({ documentId: 'document-reloaded' }));
    assert.equal(projection.scheduler.state, 'FAILED');
    assert.equal(projection.ingest.state, 'FAILED_FINAL');
    assert.ok(projection.slots.every((slotValue) => (
      slotValue.attempts[0].state === 'FAILED_FINAL'
        && slotValue.attempts[0].errorCode === 'SS_ERP_BYOK_BATCH_LOCAL_RESULT_LOST'
    )));
    assert.equal(restored.events.some((event) => event[0] === 'coordinator-restore'), false);
    assert.equal(restored.events.some((event) => [
      'prepare', 'reserve', 'coordinator-start', 'successor',
    ].includes(event[0])), false);
    assert.equal(restored.restoredResults.size, 0, 'partial vault restoration must roll back');
  });
}

test('a stale escrow lifecycle epoch cannot enter the in-memory vault after restart', async () => {
  const original = createHarness();
  await original.registry.start(owner(), pageStart());
  const candidates = completeProviderBatch(original);
  candidates[0].lifecycleAuthority.epoch = 8;
  const restored = createHarness({
    initialOperation: original.operation,
    initialServerBatch: original.serverBatch,
    initialEscrowCandidates: candidates,
  });
  const projection = await restored.registry.state(owner({ documentId: 'document-reloaded' }));
  assert.equal(projection.scheduler.state, 'FAILED');
  assert.ok(projection.slots.every((slotValue) => (
    slotValue.attempts[0].errorCode === 'SS_ERP_BYOK_BATCH_LOCAL_RESULT_LOST'
  )));
  assert.equal(restored.events.some((event) => event[0] === 'vault-restore'), false);
  assert.equal(restored.events.some((event) => event[0] === 'coordinator-restore'), false);
  assert.equal(restored.events.some((event) => [
    'prepare', 'reserve', 'coordinator-start', 'successor',
  ].includes(event[0])), false);
});

test('worker restart rejects stale current authority before escrow or coordinator restoration', async () => {
  const original = createHarness();
  await original.registry.start(owner(), pageStart());
  const candidates = completeProviderBatch(original);
  const restored = createHarness({
    initialOperation: original.operation,
    initialServerBatch: original.serverBatch,
    initialEscrowCandidates: candidates,
    authorityStale: true,
  });
  await assert.rejects(
    restored.registry.state(owner({ documentId: 'document-reloaded' })),
    (error) => error?.code === 'SS_ERP_BYOK_DEVICE_AUTHORITY_STALE',
  );
  assert.equal(restored.events.some((event) => event[0] === 'escrow-find'), false);
  assert.equal(restored.events.some((event) => event[0] === 'coordinator-restore'), false);
  assert.equal(restored.events.some((event) => [
    'prepare', 'reserve', 'coordinator-start', 'successor',
  ].includes(event[0])), false);
});

test('status v1 downgrade and legacy recovery v1 preserve LOCAL_RESULT_LOST behavior byte-for-byte', async () => {
  const original = createHarness();
  await original.registry.start(owner(), pageStart());
  const candidates = completeProviderBatch(original);
  const oldestLegacy = legacyRecoveryV1(original.operation);
  delete oldestLegacy.recovery.successorRecovery;
  const cases = [
    { operation: original.operation, statusV2Failure: true },
    { operation: legacyRecoveryV1(original.operation), statusV2Failure: false },
    { operation: oldestLegacy, statusV2Failure: false },
  ];
  for (const [index, value] of cases.entries()) {
    const before = plain(value.operation);
    const restored = createHarness({
      initialOperation: value.operation,
      initialServerBatch: original.serverBatch,
      initialEscrowCandidates: candidates,
      statusV2Failure: value.statusV2Failure,
    });
    const projection = await restored.registry.state(owner({
      documentId: `document-v1-${index}`,
    }));
    assert.equal(projection.scheduler.state, 'FAILED');
    assert.ok(projection.slots.every((slotValue) => (
      slotValue.attempts[0].errorCode === 'SS_ERP_BYOK_BATCH_LOCAL_RESULT_LOST'
    )));
    assert.equal(restored.events.some((event) => event[0] === 'escrow-find'), false);
    assert.equal(restored.events.some((event) => event[0] === 'coordinator-restore'), false);
    assert.deepEqual(plain(restored.operation), before);
  }
});

test('rejects an unknown recovery v2 field before status, escrow, or coordinator work', async () => {
  const original = createHarness();
  await original.registry.start(owner(), pageStart());
  completeProviderBatch(original);
  const operation = plain(original.operation);
  operation.recovery.unexpected = true;
  const restored = createHarness({
    initialOperation: operation,
    initialServerBatch: original.serverBatch,
  });
  await assert.rejects(
    restored.registry.state(owner({ documentId: 'document-reloaded' })),
    (error) => error?.code === 'SS_ERP_BYOK_BATCH_REGISTRY_SESSION_INVALID',
  );
  assert.equal(restored.events.some((event) => event[0].startsWith('reservation-status')), false);
  assert.equal(restored.events.some((event) => event[0] === 'escrow-find'), false);
  assert.equal(restored.events.some((event) => event[0] === 'coordinator-create'), false);
});

test('awaits escrow deletion on reject and a later worker cannot resurrect the candidate', async () => {
  const original = createHarness();
  await original.registry.start(owner(), pageStart());
  const candidates = completeProviderBatch(original);
  const first = createHarness({
    initialOperation: original.operation,
    initialServerBatch: original.serverBatch,
    initialEscrowCandidates: candidates,
  });
  const projection = await first.registry.state(owner({ documentId: 'document-reloaded' }));
  const rejected = projection.slots[0].attempts[0];
  await first.registry.command(
    owner({ documentId: 'document-reloaded' }),
    pageCommand('REJECT', {
      commandId: 'command-restored-reject',
      expectedRuntimeRevision: projection.revision,
      slotKey: projection.slots[0].slotKey,
      attemptId: rejected.attemptId,
      expectedSlotRevision: projection.slots[0].revision,
    }),
  );
  assert.equal(first.events.filter((event) => event[0] === 'escrow-delete').length, 1);
  assert.equal(first.escrowRepository.size, 1);

  const restarted = createHarness({
    initialOperation: original.operation,
    initialServerBatch: original.serverBatch,
    escrowRepository: first.escrowRepository,
  });
  const afterRestart = await restarted.registry.state(owner({ documentId: 'document-reloaded' }));
  assert.equal(afterRestart.scheduler.state, 'FAILED');
  assert.equal(afterRestart.slots[0].attempts[0].errorCode, 'SS_ERP_BYOK_BATCH_LOCAL_RESULT_LOST');
  assert.equal(restarted.events.some((event) => event[0] === 'coordinator-restore'), false);
});

test('fails REJECT before coordinator mutation when durable escrow deletion fails', async () => {
  const original = createHarness();
  await original.registry.start(owner(), pageStart());
  const candidates = completeProviderBatch(original);
  const restored = createHarness({
    initialOperation: original.operation,
    initialServerBatch: original.serverBatch,
    initialEscrowCandidates: candidates,
    escrowDeleteFailure: true,
  });
  const projection = await restored.registry.state(owner({ documentId: 'document-reloaded' }));
  await assert.rejects(
    restored.registry.command(
      owner({ documentId: 'document-reloaded' }),
      pageCommand('REJECT', {
        commandId: 'command-restored-reject-delete-failed',
        expectedRuntimeRevision: projection.revision,
        slotKey: projection.slots[0].slotKey,
        attemptId: projection.slots[0].attempts[0].attemptId,
        expectedSlotRevision: projection.slots[0].revision,
      }),
    ),
    (error) => error?.code === 'SS_ERP_BYOK_RESULT_ESCROW_UNAVAILABLE'
      && error?.outcome === 'FAILED_FINAL'
      && error?.automaticRetryAllowed === false,
  );
  assert.equal(restored.events.some((event) => event[0] === 'coordinator-reject'), false);
  const afterFailure = await restored.registry.state(owner({ documentId: 'document-reloaded' }));
  assert.equal(afterFailure.slots[0].attempts[0].reviewState, 'AVAILABLE');
  assert.equal(restored.escrowRepository.size, 2);
  assert.equal(restored.restoredResults.size, 2);
  assert.equal(restored.events.some((event) => [
    'prepare', 'reserve', 'coordinator-start', 'successor',
  ].includes(event[0])), false);
});

test('locks ingest, clear, and command IDs while REJECT awaits durable deletion', async () => {
  const original = createHarness();
  await original.registry.start(owner(), pageStart());
  const candidates = completeProviderBatch(original);
  let deleteEntered;
  let releaseDelete;
  const entered = new Promise((resolve) => { deleteEntered = resolve; });
  const barrier = new Promise((resolve) => { releaseDelete = resolve; });
  const restored = createHarness({
    initialOperation: original.operation,
    initialServerBatch: original.serverBatch,
    initialEscrowCandidates: candidates,
    async beforeEscrowDelete() {
      deleteEntered();
      await barrier;
    },
  });
  const reloadedOwner = owner({ documentId: 'document-reloaded' });
  const projection = await restored.registry.state(reloadedOwner);
  const rejectPromise = restored.registry.command(
    reloadedOwner,
    pageCommand('REJECT', {
      commandId: 'command-race-reject',
      expectedRuntimeRevision: projection.revision,
      slotKey: projection.slots[0].slotKey,
      attemptId: projection.slots[0].attempts[0].attemptId,
      expectedSlotRevision: projection.slots[0].revision,
    }),
  );
  await entered;
  await assert.rejects(
    restored.registry.ingest(reloadedOwner, {
      contractVersion: 'extension-byok-workbench-batch-ingest/v1',
      idempotencyKey: 'race-ingest-idempotency-0001',
    }),
    (error) => error?.code === 'SS_ERP_BYOK_BATCH_REGISTRY_MUTATION_IN_PROGRESS',
  );
  const keepCommand = pageCommand('KEEP', {
    commandId: 'command-race-keep',
    expectedRuntimeRevision: projection.revision,
    slotKey: projection.slots[1].slotKey,
    attemptId: projection.slots[1].attempts[0].attemptId,
    expectedSlotRevision: projection.slots[1].revision,
  });
  await assert.rejects(
    restored.registry.command(reloadedOwner, keepCommand),
    (error) => error?.code === 'SS_ERP_BYOK_BATCH_REGISTRY_MUTATION_IN_PROGRESS',
  );
  await assert.rejects(
    restored.registry.clear(reloadedOwner),
    (error) => error?.code === 'SS_ERP_BYOK_BATCH_REGISTRY_MUTATION_IN_PROGRESS',
  );
  assert.equal(restored.events.some((event) => event[0] === 'ingest'), false);
  assert.equal(restored.events.some((event) => event[0] === 'escrow-delete-many'), false);
  assert.equal(restored.events.some((event) => event[0] === 'reservation-cancel'), false);
  assert.equal(restored.events.some((event) => event[0] === 'coordinator-dispose'), false);
  assert.equal(restored.events.some((event) => event[0] === 'operation-clear'), false);
  releaseDelete();
  await rejectPromise;
  assert.equal(restored.events.filter((event) => event[0] === 'coordinator-reject').length, 1);
  const kept = await restored.registry.command(reloadedOwner, keepCommand);
  assert.equal(kept.slots[1].attempts[0].reviewState, 'KEPT');
  assert.equal(restored.events.filter((event) => event[0] === 'coordinator-keep').length, 1);
  assert.equal(restored.events.some((event) => [
    'prepare', 'reserve', 'coordinator-start', 'successor',
  ].includes(event[0])), false);
});

test('awaits one scoped escrow deleteMany before clearing a restored review-only batch', async () => {
  const original = createHarness();
  await original.registry.start(owner(), pageStart());
  const candidates = completeProviderBatch(original);
  const restored = createHarness({
    initialOperation: original.operation,
    initialServerBatch: original.serverBatch,
    initialEscrowCandidates: candidates,
  });
  await restored.registry.state(owner({ documentId: 'document-reloaded' }));
  assert.deepEqual(
    plain(await restored.registry.clear(owner({ documentId: 'document-reloaded' }))),
    { cleared: true },
  );
  const deleteEvents = restored.events.filter((event) => event[0] === 'escrow-delete-many');
  assert.equal(deleteEvents.length, 1);
  assert.deepEqual(new Set(deleteEvents[0][1]), new Set(candidates.map((item) => item.resultId)));
  assert.equal(restored.escrowRepository.size, 0);
  assert.equal(restored.operation, null);
  assert.ok(
    restored.events.findIndex((event) => event[0] === 'escrow-delete-many')
      < restored.events.findIndex((event) => event[0] === 'operation-clear'),
  );
});

test('fails CLEAR before reservation or coordinator cleanup when escrow deleteMany fails', async () => {
  const original = createHarness();
  await original.registry.start(owner(), pageStart());
  const candidates = completeProviderBatch(original);
  const restored = createHarness({
    initialOperation: original.operation,
    initialServerBatch: original.serverBatch,
    initialEscrowCandidates: candidates,
    escrowDeleteManyFailure: true,
  });
  await restored.registry.state(owner({ documentId: 'document-reloaded' }));
  await assert.rejects(
    restored.registry.clear(owner({ documentId: 'document-reloaded' })),
    (error) => error?.code === 'SS_ERP_BYOK_RESULT_ESCROW_UNAVAILABLE'
      && error?.outcome === 'FAILED_FINAL',
  );
  assert.equal(restored.events.some((event) => event[0] === 'reservation-cancel'), false);
  assert.equal(restored.events.some((event) => event[0] === 'coordinator-dispose'), false);
  assert.equal(restored.events.some((event) => event[0] === 'operation-clear'), false);
  assert.equal(restored.escrowRepository.size, 2);
  assert.ok(restored.operation);
});

test('a fresh Registry safely cancels a persisted reservation that never reached dispatch', async () => {
  const original = createHarness();
  await original.registry.start(owner(), pageStart());
  const reservedOperation = plain(original.operation);
  reservedOperation.recovery.phase = 'RESERVED';
  const restored = createHarness({
    initialOperation: reservedOperation,
    initialServerBatch: original.serverBatch,
  });

  const projection = await restored.registry.state(owner({ documentId: 'reserved-reload' }));
  assert.equal(projection.revision, 0);
  assert.equal(restored.reported.length, 2);
  assert.equal(restored.reported.every((item) => item.outcome === 'FAILED_FINAL'), true);
  assert.equal(restored.events.filter((event) => event[0] === 'reservation-cancel').length, 1);
  assert.equal(restored.operation, null);
});

test('a fresh RESERVED rollback does not terminalize or cancel before durable intent cleanup', async () => {
  const original = createHarness();
  await original.registry.start(owner(), pageStart());
  const reservedOperation = plain(original.operation);
  reservedOperation.recovery.phase = 'RESERVED';
  const restored = createHarness({
    initialOperation: reservedOperation,
    initialServerBatch: original.serverBatch,
    escrowDeleteByIntentFailure: true,
  });

  await assert.rejects(
    restored.registry.state(owner({ documentId: 'reserved-delete-failed' })),
    (error) => error?.code === 'SS_ERP_BYOK_RESULT_ESCROW_UNAVAILABLE'
      && error?.outcome === 'FAILED_FINAL',
  );
  assert.equal(restored.reported.length, 0);
  assert.equal(restored.events.some((event) => event[0] === 'reservation-cancel'), false);
  assert.equal(restored.events.some((event) => event[0] === 'operation-clear'), false);
  assert.ok(restored.operation);
});

test('a fresh Registry converts a bound batch into one authoritative draft reload', async () => {
  const original = createHarness();
  await original.registry.start(owner(), pageStart());
  const candidates = completeProviderBatch(original);
  const status = {
    contractVersion: 'extension-byok-execution-batch-status/v1',
    batchId: original.serverBatch.batchId,
    status: 'BOUND',
    context: {
      ...original.serverBatch.context,
      sourcePlatform: '1688', sourceProductId: 'source-1',
      sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
    },
    boundDraftRevision: 8,
    boundDraftVersion: 12,
    items: original.serverBatch.items.map((item) => ({
      ...plain(item), status: 'BOUND', intent: { ...plain(item.intent), outcome: 'SUCCEEDED' },
    })),
  };
  const restored = createHarness({
    initialOperation: original.operation,
    initialServerBatch: original.serverBatch,
    initialEscrowCandidates: candidates,
    statusOverride: status,
  });

  const projection = await restored.registry.state(owner({ documentId: 'bound-reload' }));
  assert.equal(projection.ingest.state, 'SUCCEEDED');
  assert.equal(projection.ingest.rebootstrapRequired, true);
  assert.equal(projection.ingest.boundDraftRevision, 8);
  assert.equal(projection.ingest.boundDraftVersion, 12);
  assert.equal(restored.operation, null);
  assert.equal(restored.escrowRepository.size, 0);
  assert.ok(
    restored.events.findIndex((event) => event[0] === 'escrow-delete-by-intents')
      < restored.events.findIndex((event) => event[0] === 'operation-clear'),
  );
  assertSanitizedProjection(projection);
  const empty = await restored.registry.state(owner({ documentId: 'bound-reload' }));
  assert.equal(empty.revision, 0);
});

test('a fresh Registry durably deletes CANCELLED ciphertext before releasing its operation lock', async () => {
  const original = createHarness();
  await original.registry.start(owner(), pageStart());
  const candidates = completeProviderBatch(original);
  const cancelledBatch = plain(original.serverBatch);
  cancelledBatch.status = 'CANCELLED';
  const restored = createHarness({
    initialOperation: original.operation,
    initialServerBatch: cancelledBatch,
    initialEscrowCandidates: candidates,
  });

  const projection = await restored.registry.state(owner({ documentId: 'cancelled-reload' }));
  assert.equal(projection.revision, 0);
  assert.equal(restored.escrowRepository.size, 0);
  assert.equal(restored.operation, null);
  assert.ok(
    restored.events.findIndex((event) => event[0] === 'escrow-delete-by-intents')
      < restored.events.findIndex((event) => event[0] === 'operation-clear'),
  );
  assert.equal(restored.events.some((event) => [
    'prepare', 'reserve', 'coordinator-start', 'successor',
  ].includes(event[0])), false);
});

test('fresh BOUND and CANCELLED clear paths durably delete ciphertext before lock release', async () => {
  for (const terminalStatus of ['BOUND', 'CANCELLED']) {
    const original = createHarness();
    await original.registry.start(owner(), pageStart());
    const candidates = completeProviderBatch(original);
    const terminalBatch = plain(original.serverBatch);
    terminalBatch.status = terminalStatus;
    const restored = createHarness({
      initialOperation: original.operation,
      initialServerBatch: terminalBatch,
      initialEscrowCandidates: candidates,
    });

    assert.deepEqual(
      plain(await restored.registry.clear(owner({
        documentId: `${terminalStatus.toLowerCase()}-direct-clear`,
      }))),
      { cleared: true },
    );
    assert.equal(restored.escrowRepository.size, 0);
    assert.equal(restored.operation, null);
    assert.ok(
      restored.events.findIndex((event) => event[0] === 'escrow-delete-by-intents')
        < restored.events.findIndex((event) => event[0] === 'operation-clear'),
    );
  }
});

test('a fresh terminal OPEN clear durably deletes ciphertext before cancel and lock release', async () => {
  const original = createHarness();
  await original.registry.start(owner(), pageStart());
  const candidates = completeProviderBatch(original);
  const restored = createHarness({
    initialOperation: original.operation,
    initialServerBatch: original.serverBatch,
    initialEscrowCandidates: candidates,
  });

  assert.deepEqual(
    plain(await restored.registry.clear(owner({ documentId: 'terminal-open-clear' }))),
    { cleared: true },
  );
  const deleteIndex = restored.events.findIndex(
    (event) => event[0] === 'escrow-delete-by-intents',
  );
  const cancelIndex = restored.events.findIndex((event) => event[0] === 'reservation-cancel');
  const clearIndex = restored.events.findIndex((event) => event[0] === 'operation-clear');
  assert.ok(deleteIndex >= 0 && deleteIndex < cancelIndex && cancelIndex < clearIndex);
  assert.equal(restored.escrowRepository.size, 0);
  assert.equal(restored.operation, null);
  assert.equal(restored.events.some((event) => [
    'escrow-find', 'vault-restore', 'coordinator-restore', 'prepare', 'reserve',
    'coordinator-start', 'successor',
  ].includes(event[0])), false);
});

for (const terminalStatus of ['BOUND', 'CANCELLED']) {
  for (const entrypoint of ['state', 'clear']) {
    test(`fresh ${terminalStatus} ${entrypoint} retains ciphertext and lock when durable deletion fails`, async () => {
    const original = createHarness();
    await original.registry.start(owner(), pageStart());
    const candidates = completeProviderBatch(original);
    const terminalBatch = plain(original.serverBatch);
    terminalBatch.status = terminalStatus;
    const restored = createHarness({
      initialOperation: original.operation,
      initialServerBatch: terminalBatch,
      initialEscrowCandidates: candidates,
      escrowDeleteByIntentFailure: true,
    });

    await assert.rejects(
      restored.registry[entrypoint](owner({
        documentId: `${terminalStatus.toLowerCase()}-${entrypoint}-failed-delete`,
      })),
      (error) => error?.code === 'SS_ERP_BYOK_RESULT_ESCROW_UNAVAILABLE'
        && error?.outcome === 'FAILED_FINAL'
        && error?.automaticRetryAllowed === false,
    );
    assert.equal(restored.escrowRepository.size, candidates.length);
    assert.ok(restored.operation);
    assert.equal(restored.events.some((event) => event[0] === 'reservation-cancel'), false);
    assert.equal(restored.events.some((event) => event[0] === 'operation-clear'), false);
    });
  }
}

test('fresh terminal OPEN clear keeps ciphertext and lock when durable deletion fails', async () => {
  const original = createHarness();
  await original.registry.start(owner(), pageStart());
  const candidates = completeProviderBatch(original);
  const restored = createHarness({
    initialOperation: original.operation,
    initialServerBatch: original.serverBatch,
    initialEscrowCandidates: candidates,
    escrowDeleteByIntentFailure: true,
  });

  await assert.rejects(
    restored.registry.clear(owner({ documentId: 'terminal-open-failed-delete' })),
    (error) => error?.code === 'SS_ERP_BYOK_RESULT_ESCROW_UNAVAILABLE'
      && error?.outcome === 'FAILED_FINAL'
      && error?.automaticRetryAllowed === false,
  );
  assert.equal(restored.escrowRepository.size, candidates.length);
  assert.ok(restored.operation);
  assert.equal(restored.events.some((event) => event[0] === 'reservation-cancel'), false);
  assert.equal(restored.events.some((event) => event[0] === 'operation-clear'), false);
});

test('safe queued cancellation reports the exact reserved intent terminal', async () => {
  const harness = createHarness();
  await harness.registry.start(owner(), pageStart());
  const result = await harness.registry.command(owner(), pageCommand('CANCEL_QUEUED', {
    slotKey: 'sku:sku-1:hero', attemptId: 'attempt-1',
    commandId: 'command-cancel-1', expectedSlotRevision: 1,
  }));
  assert.equal(result.cancelled, true);
  assertSanitizedProjection(result);
  assert.equal(harness.reported.length, 1);
  assert.equal(harness.reported[0].intentId, 'intent-1');
  assert.equal(harness.reported[0].outcome, 'FAILED_FINAL');
  assert.equal(harness.reported[0].providerRequestIdSha256, null);
  assert.equal(harness.reported[0].resultSha256, null);
});

test('successor regeneration prepares, claims with charge confirmation, registers, then enqueues', async () => {
  const harness = createHarness();
  await harness.registry.start(owner(), pageStart());
  harness.projection.slots[0].attempts[0].state = 'CANDIDATE_READY';
  harness.projection.slots[0].state = 'CANDIDATE_READY';
  harness.projection.scheduler.queuedCount = 1;
  await harness.registry.command(owner(), pageCommand('REGENERATE', {
    slotKey: 'sku:sku-1:hero', commandId: 'command-regenerate-1',
    expectedSlotRevision: 1,
    chargeAcknowledgement: { warningVersion: 'external-provider-charge/v1', confirmed: true },
  }));
  const successor = harness.events.find((event) => event[0] === 'successor');
  assert.equal(successor[1].currentIntentId, 'intent-1');
  assert.equal(successor[1].providerChargeConfirmed, true);
  const successorPrepare = harness.events.findLast((event) => event[0] === 'prepare');
  assert.match(successorPrepare[2], /^byok-provider:/u);
  assert.equal(successor[1].item.providerIdempotencyKey, successorPrepare[2]);
  assert.equal(successor[1].item.providerRequestHash, '7'.repeat(64));
  assert.ok(harness.events.findLastIndex((event) => event[0] === 'prepare')
    < harness.events.findIndex(
    (event) => event[0] === 'successor',
  ));
  assert.ok(harness.events.findIndex((event) => event[0] === 'broker-attempt')
    < harness.events.findIndex((event) => event[0] === 'coordinator-regenerate'));
  assert.equal(harness.events.find((event) => event[0] === 'broker-attempt')[1]
    .intent.executionMode, 'BYOK');
});

test('credential reset does not deadlock behind REGENERATE waiting on provider profile state', async () => {
  let blockProviderInput = false;
  let providerInputEntered;
  let releaseProviderInput;
  const entered = new Promise((resolve) => { providerInputEntered = resolve; });
  const barrier = new Promise((resolve) => { releaseProviderInput = resolve; });
  const harness = createHarness({
    async beforeResolveProviderInput() {
      if (!blockProviderInput) return;
      blockProviderInput = false;
      providerInputEntered();
      await barrier;
      throw Object.assign(new Error('provider profile authority was reset'), {
        code: 'SS_ERP_BYOK_PROVIDER_PROFILE_NOT_FOUND',
      });
    },
  });
  await harness.registry.start(owner(), pageStart());
  harness.projection.slots[0].attempts[0].state = 'CANDIDATE_READY';
  harness.projection.slots[0].state = 'CANDIDATE_READY';
  harness.projection.scheduler.queuedCount = 1;
  blockProviderInput = true;
  const pendingRegenerate = harness.registry.command(owner(), pageCommand('REGENERATE', {
    slotKey: 'sku:sku-1:hero', commandId: 'command-reset-lock-order-regenerate',
    expectedSlotRevision: 1,
    chargeAcknowledgement: { warningVersion: 'external-provider-charge/v1', confirmed: true },
  }));
  await entered;

  let finalizeEntered;
  let releaseFinalize;
  const inFinalize = new Promise((resolve) => { finalizeEntered = resolve; });
  const finalizeBarrier = new Promise((resolve) => { releaseFinalize = resolve; });
  const cleanup = harness.registry.clearAll('provider_state_changed', async () => {
    finalizeEntered();
    await finalizeBarrier;
  });
  await inFinalize;
  await assert.rejects(
    harness.registry.command(owner(), pageCommand('PAUSE', {
      commandId: 'command-reset-fenced-pause',
    })),
    (error) => error?.code === 'SS_ERP_BYOK_BATCH_REGISTRY_MUTATION_IN_PROGRESS'
      && error?.outcome === 'FAILED_RETRYABLE',
  );
  releaseFinalize();
  assert.equal(await cleanup, 0,
    'reset must complete without waiting for the profile-blocked mutation');

  releaseProviderInput();
  await assert.rejects(
    pendingRegenerate,
    (error) => error?.code === 'SS_ERP_BYOK_PROVIDER_PROFILE_NOT_FOUND',
  );
  assert.equal(harness.events.some((event) => event[0] === 'successor'), false);
  assert.equal(harness.events.some((event) => event[0] === 'broker-attempt'), false);
  assert.equal(harness.events.some((event) => event[0] === 'coordinator-regenerate'), false,
    'the stale mutation must never reach Provider dispatch');
});

for (const responseFailure of ['successorResponseLost', 'successorResponseMalformed']) {
  test(`an ambiguous successor ${responseFailure} adopts only the exact server attempt before dispatch`, async () => {
    const harness = createHarness({ [responseFailure]: true });
    await harness.registry.start(owner(), pageStart());
    harness.projection.slots[0].attempts[0].state = 'CANDIDATE_READY';
    harness.projection.slots[0].state = 'CANDIDATE_READY';
    harness.projection.scheduler.queuedCount = 1;

    await harness.registry.command(owner(), pageCommand('REGENERATE', {
      slotKey: 'sku:sku-1:hero', commandId: `command-${responseFailure}`,
      expectedSlotRevision: 1,
      chargeAcknowledgement: { warningVersion: 'external-provider-charge/v1', confirmed: true },
    }));

    const successor = harness.events.find((event) => event[0] === 'successor')[1];
    const statusIndex = harness.events.findIndex((event) => event[0] === 'reservation-status');
    const brokerIndex = harness.events.findLastIndex((event) => event[0] === 'broker-attempt');
    const enqueueIndex = harness.events.findIndex((event) => event[0] === 'coordinator-regenerate');
    assert.ok(statusIndex > harness.events.findIndex((event) => event[0] === 'successor'));
    assert.ok(statusIndex < brokerIndex && brokerIndex < enqueueIndex);
    assert.equal(harness.serverBatch.items[0].intent.providerIdempotencyKey,
      successor.item.providerIdempotencyKey);
    assert.equal(harness.serverBatch.items[0].intent.providerRequestHash,
      successor.item.providerRequestHash);
    assert.equal(harness.operation.recovery.successorRecovery, null);
    assert.equal(harness.released.includes(harness.prepared.at(-1).result.preparedRequestHandle), false);
  });
}

test('ambiguous successor claim persists exact recovery and safely terminalizes after worker restart', async () => {
  const first = createHarness({ successorResponseLost: true, statusFailure: true });
  await first.registry.start(owner(), pageStart());
  first.projection.slots[0].attempts[0].state = 'CANDIDATE_READY';
  first.projection.slots[0].state = 'CANDIDATE_READY';
  first.projection.scheduler.queuedCount = 1;
  await assert.rejects(
    first.registry.command(owner(), pageCommand('REGENERATE', {
      slotKey: 'sku:sku-1:hero', commandId: 'command-ambiguous-successor-restart',
      expectedSlotRevision: 1,
      chargeAcknowledgement: { warningVersion: 'external-provider-charge/v1', confirmed: true },
    })),
    (error) => error?.code === 'SS_ERP_BYOK_BATCH_REGISTRY_SUCCESSOR_RECOVERY_REQUIRED'
      && error?.outcome === 'UNKNOWN_OUTCOME'
      && error?.automaticRetryAllowed === false,
  );
  const sidecar = first.operation.recovery.successorRecovery;
  assert.equal(sidecar.contractVersion, 'extension-byok-workbench-successor-recovery/v1');
  assert.equal(sidecar.state, 'CLAIMING');
  assert.equal(sidecar.itemIndex, 0);
  assert.equal(sidecar.predecessorIntentId, 'intent-1');
  assert.equal(sidecar.predecessorGeneration, 1);
  assert.equal(sidecar.providerIdempotencyKey,
    first.serverBatch.items[0].intent.providerIdempotencyKey);
  assert.equal(sidecar.providerRequestHash,
    first.serverBatch.items[0].intent.providerRequestHash);
  assert.equal(sidecar.assignmentOrdinal, 17);
  const persistedEvidence = JSON.stringify(sidecar);
  for (const forbidden of ['https', 'providerOrigin', 'model', 'prompt', 'apiKey']) {
    assert.equal(persistedEvidence.includes(forbidden), false);
  }
  assert.equal(first.released.includes(first.prepared.at(-1).result.preparedRequestHandle), false);
  assert.equal(first.events.some((event) => event[0] === 'coordinator-regenerate'), false);
  first.serverBatch.items[1].intent.outcome = 'FAILED_FINAL';

  const restarted = createHarness({
    initialOperation: first.operation,
    initialServerBatch: first.serverBatch,
  });
  const projection = await restarted.registry.state(owner());
  assert.equal(projection.ingest.state, 'FAILED_FINAL');
  assert.equal(restarted.reported.length, 1);
  assert.equal(restarted.reported[0].intentId, first.serverBatch.items[0].intent.intentId);
  assert.equal(restarted.reported[0].outcome, 'FAILED_FINAL');
  assert.equal(restarted.operation.recovery.successorRecovery, null);
  assert.ok(restarted.events.filter((event) => event[0] === 'reservation-status-v2').length >= 2);
  assert.equal(restarted.events.some((event) => event[0] === 'coordinator-create'), false);
  assert.deepEqual(plain(await restarted.registry.clear(owner())), { cleared: true });
  assert.equal(restarted.operation, null);
  assert.equal(restarted.serverBatch.status, 'CANCELLED');
});

test('worker restart never terminalizes a successor whose Provider handoff may have started', async () => {
  const first = createHarness({ successorResponseLost: true, statusFailure: true });
  await first.registry.start(owner(), pageStart());
  first.projection.slots[0].attempts[0].state = 'CANDIDATE_READY';
  first.projection.slots[0].state = 'CANDIDATE_READY';
  first.projection.scheduler.queuedCount = 1;
  await assert.rejects(first.registry.command(owner(), pageCommand('REGENERATE', {
    slotKey: 'sku:sku-1:hero', commandId: 'command-handoff-restart',
    expectedSlotRevision: 1,
    chargeAcknowledgement: { warningVersion: 'external-provider-charge/v1', confirmed: true },
  })));
  const operation = plain(first.operation);
  operation.recovery.successorRecovery.state = 'HANDOFF_STARTED';
  first.serverBatch.items[1].intent.outcome = 'FAILED_FINAL';

  const restarted = createHarness({
    initialOperation: operation,
    initialServerBatch: first.serverBatch,
  });
  const projection = await restarted.registry.state(owner());
  assert.equal(projection.ingest.state, 'RECOVERY_REQUIRED');
  assert.equal(restarted.reported.length, 0);
  assert.equal(restarted.operation.recovery.successorRecovery.state, 'HANDOFF_STARTED');
  assert.equal(projection.slots[0].attempts[0].automaticRetryAllowed, false);
});

test('ambiguous successor response never adopts a status with mismatched exact evidence', async () => {
  const harness = createHarness({
    successorResponseLost: true,
    beforeSuccessorResponse(serverBatch) {
      serverBatch.items[0].intent.providerRequestHash = 'f'.repeat(64);
    },
  });
  await harness.registry.start(owner(), pageStart());
  harness.projection.slots[0].attempts[0].state = 'CANDIDATE_READY';
  harness.projection.slots[0].state = 'CANDIDATE_READY';
  harness.projection.scheduler.queuedCount = 1;
  await assert.rejects(
    harness.registry.command(owner(), pageCommand('REGENERATE', {
      slotKey: 'sku:sku-1:hero', commandId: 'command-mismatched-successor',
      expectedSlotRevision: 1,
      chargeAcknowledgement: { warningVersion: 'external-provider-charge/v1', confirmed: true },
    })),
    (error) => error?.code === 'SS_ERP_BYOK_BATCH_REGISTRY_SUCCESSOR_RECOVERY_REQUIRED'
      && error?.outcome === 'UNKNOWN_OUTCOME',
  );
  assert.ok(harness.operation.recovery.successorRecovery);
  assert.equal(harness.events.some((event) => event[0] === 'broker-attempt'), false);
  assert.equal(harness.events.some((event) => event[0] === 'coordinator-regenerate'), false);
  assert.equal(harness.released.includes(harness.prepared.at(-1).result.preparedRequestHandle), false);
});

test('unknown retry requires duplicate-charge confirmation and reserves a fresh exact intent', async () => {
  const harness = createHarness();
  await harness.registry.start(owner(), pageStart());
  harness.projection.slots[0].attempts[0].state = 'UNKNOWN_OUTCOME';
  harness.projection.slots[0].state = 'UNKNOWN_OUTCOME';
  harness.projection.scheduler.queuedCount = 1;
  await assert.rejects(
    harness.registry.command(owner(), pageCommand('RETRY', {
      slotKey: 'sku:sku-1:hero', attemptId: 'attempt-1',
      commandId: 'command-wrong-unknown-retry', expectedSlotRevision: 1,
      chargeAcknowledgement: { warningVersion: 'external-provider-charge/v1', confirmed: true },
    })),
    (error) => error?.code === 'SS_ERP_BYOK_BATCH_REGISTRY_RETRY_INVALID',
  );
  assert.equal(harness.events.filter((event) => event[0] === 'successor').length, 0);

  await harness.registry.command(owner(), pageCommand('RETRY', {
    slotKey: 'sku:sku-1:hero', attemptId: 'attempt-1',
    commandId: 'command-confirmed-unknown-retry', expectedSlotRevision: 1,
    unknownOutcomeRecovery: {
      strategy: 'DUPLICATE_CHARGE_CONFIRMATION',
      warningVersion: 'external-provider-duplicate-charge/v1', confirmed: true,
    },
  }));
  const successor = harness.events.find((event) => event[0] === 'successor');
  const retry = harness.events.find((event) => event[0] === 'coordinator-retry');
  assert.match(successor[1].item.providerIdempotencyKey, /^byok-provider:/u);
  assert.equal(retry[2].intentHash, '1'.repeat(64));
  assert.deepEqual(retry[2].unknownOutcomeRecovery, {
    strategy: 'DUPLICATE_CHARGE_CONFIRMATION',
    warningVersion: 'external-provider-duplicate-charge/v1', confirmed: true,
  });
  assert.ok(harness.events.findIndex((event) => event[0] === 'broker-attempt')
    < harness.events.findIndex((event) => event[0] === 'coordinator-retry'));
});

test('stale runtime revision is rejected before successor preparation or reservation', async () => {
  const harness = createHarness();
  await harness.registry.start(owner(), pageStart());
  const preparedBefore = harness.prepared.length;
  await assert.rejects(
    harness.registry.command(owner(), pageCommand('REGENERATE', {
      slotKey: 'sku:sku-1:hero', commandId: 'command-stale-runtime',
      expectedRuntimeRevision: 999, expectedSlotRevision: 1,
      chargeAcknowledgement: { warningVersion: 'external-provider-charge/v1', confirmed: true },
    })),
    (error) => error?.code === 'SS_ERP_BYOK_BATCH_REGISTRY_RUNTIME_STALE',
  );
  assert.equal(harness.prepared.length, preparedBefore);
  assert.equal(harness.events.filter((event) => event[0] === 'successor').length, 0);
});

test('UNKNOWN state blocks clear and recover uses only the coordinator status path', async () => {
  const harness = createHarness();
  await harness.registry.start(owner(), pageStart());
  harness.projection.slots[0].attempts[0].state = 'UNKNOWN_OUTCOME';
  harness.projection.slots[0].state = 'UNKNOWN_OUTCOME';
  harness.projection.scheduler.queuedCount = 0;
  harness.projection.ingest.state = 'UNKNOWN_OUTCOME';
  await assert.rejects(harness.registry.clear(owner()));
  assert.ok(harness.operation);
  await harness.registry.recover(owner(), {
    contractVersion: 'extension-byok-workbench-batch-ingest/v1',
    idempotencyKey: 'batch-ingest-0001',
  });
  assert.equal(harness.events.filter((event) => event[0] === 'recover').length, 1);
  assert.equal(harness.events.filter((event) => event[0] === 'ingest').length, 0);
});

test('registry isolates exact documents and exposes lifecycle cleanup methods', async () => {
  const harness = createHarness();
  await harness.registry.start(owner(), pageStart());
  const isolated = await harness.registry.state(owner({ documentId: 'document-2' }));
  assert.equal(isolated.revision, 1);
  assert.equal(isolated.slots.every((slot) => slot.state === 'UNKNOWN_OUTCOME'), true);
  assert.equal(isolated.slots.every((slot) => (
    slot.attempts[0].automaticRetryAllowed === false
  )), true);
  assertSanitizedProjection(isolated);
  assert.equal(typeof harness.registry.clearAll, 'function');
  assert.equal(typeof harness.registry.removeTab, 'function');
  assert.equal(await harness.registry.removeTab(999), 0);
  assert.equal(await harness.registry.clearAll('device_disconnected'), 1,
    'definitely queued work is terminalized and safely released');
  assert.equal(harness.operation, null);
});

test('cleanup retains the operation lock until a transient lock-clear failure is retried', async () => {
  const harness = createHarness({ clearFailureOnce: true });
  await harness.registry.start(owner(), pageStart());
  await assert.rejects(
    harness.registry.clear(owner()),
    (error) => error?.code === 'SS_ERP_BYOK_BATCH_REGISTRY_CLEAR_UNSAFE'
      && error.outcome === 'UNKNOWN_OUTCOME',
  );
  assert.ok(harness.operation);
  assert.deepEqual(plain(await harness.registry.clear(owner())), { cleared: true });
  assert.equal(harness.operation, null);
  assert.equal(harness.events.filter((event) => event[0] === 'reservation-cancel').length, 1);
});

test('cleanup verifies a lost operation-clear response before deleting local ownership', async () => {
  const harness = createHarness({ clearAppliedFailureOnce: true });
  await harness.registry.start(owner(), pageStart());
  assert.deepEqual(plain(await harness.registry.clear(owner())), { cleared: true });
  assert.equal(harness.operation, null);
  const clearIndex = harness.events.findIndex((event) => event[0] === 'operation-clear');
  assert.equal(harness.events[clearIndex + 1][0], 'session-claim');
});
