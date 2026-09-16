import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildAiMediaSuiteCancelRequest,
  buildAiMediaSuiteClaimRequest,
  buildAiMediaSuiteDispatchRequest,
  buildAiMediaSuitePrepareRequest,
  buildAiMediaSuitePreviewRequest,
  buildAiMediaSuiteRetryRequest,
  buildAiMediaSuiteSlotApplyRequest,
  buildAiMediaSuiteSlotReviewRequest,
  formatAiMediaPlanningGoal,
  formatAiMediaSuiteCost,
  normalizeAiMediaSuite,
  normalizeAiMediaSuitePreview,
  normalizeAiMediaSuiteReadiness,
  resolveAiMediaSuiteActions,
  resolveAiMediaSuiteClaimDecision,
  resolveAiMediaSuitePreparationDecision,
  resolveAiMediaSuiteSlotActions,
  resolveAiMediaSuiteSlotApplyRecovery,
  resolveAiMediaSuiteSlotReviewRecovery,
  shouldRefreshAiMediaSuiteTargetAfterError,
  startAiMediaSuitePolling,
} from '../apps/web/src/lib/ai-media-workflow.ts';

const plan = {
  id: 'plan-1',
  revision: 3,
  latestVersion: 2,
  currentVersionId: 'plan-version-2',
  approvedVersionId: 'plan-version-2',
  reviewStatus: 'APPROVED',
  sourceCaptureSnapshotId: 'snapshot-1',
  staleAt: null,
  staleReasons: [],
  sourceCurrent: true,
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:00.000Z',
};

const readinessPayload = {
  suiteEnabled: true,
  workflowEnabled: true,
  webMediaEnabled: true,
  provider: {
    provider: 'fake',
    model: 'fake-image-suite-v1',
    evidenceLevel: 'local-test',
    ready: true,
  },
  services: {
    references: true,
    prompts: true,
    materialization: true,
    execution: true,
    runtime: true,
    queue: true,
  },
  storage: { ready: true, backend: 'local', publicHttps: true },
  ready: true,
  testOnly: true,
  reasonCode: 'READY',
  reason: 'Ready for local testing',
};

const previewPayload = {
  version: 'ai-image-suite-preview/v1',
  planId: 'plan-1',
  planVersionId: 'plan-version-2',
  planRevision: 3,
  provider: 'fake',
  model: 'fake-image-suite-v1',
  pricingVersion: 'provider-free-zero/v1',
  concurrencyLimit: 2,
  itemCount: 1,
  estimatedCostCents: 0,
  maximumCostCents: 0,
  previewHash: 'a'.repeat(64),
  slots: [{
    ordinal: 0,
    slotKey: 'sku:sku-red:hero',
    goal: 'sku_hero',
    ownership: { level: 'sku', key: 'sku-red' },
    compatibilityGroupKey: null,
    references: [{
      candidateId: 'candidate-1',
      source: {
        width: 900,
        height: 1200,
        mimeType: 'image/png',
        role: 'product_main',
        skuKeys: ['sku-red'],
      },
    }],
    estimatedCostCents: 0,
    maximumCostCents: 0,
  }],
};

function suitePayload({
  status = 'PLANNED',
  revision = 1,
  planVersionId = 'plan-version-2',
  slotStatuses = ['PLANNED'],
} = {}) {
  const countFor = (slotStatus) => slotStatuses.filter((entry) => entry === slotStatus).length;
  return {
    id: 'suite-1',
    planId: 'plan-1',
    planVersionId,
    status,
    revision,
    provider: 'fake',
    model: 'fake-image-suite-v1',
    pricingVersion: 'provider-free-zero/v1',
    itemCount: slotStatuses.length,
    estimatedCostCents: 0,
    maximumCostCents: 0,
    concurrencyLimit: 2,
    cancelRequestedAt: status === 'CANCEL_REQUESTED' ? '2026-07-20T00:01:00.000Z' : null,
    completedAt: ['PARTIAL_FAILURE', 'FAILED', 'SUCCEEDED', 'CANCELLED'].includes(status)
      ? '2026-07-20T00:02:00.000Z'
      : null,
    counts: {
      planned: countFor('PLANNED'),
      queued: countFor('QUEUED'),
      running: countFor('RUNNING'),
      succeeded: countFor('SUCCEEDED'),
      failed: countFor('FAILED'),
      cancelRequested: countFor('CANCEL_REQUESTED'),
      cancelled: countFor('CANCELLED'),
    },
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:01:00.000Z',
    slots: slotStatuses.map((slotStatus, ordinal) => ({
      id: `slot-${ordinal + 1}`,
      ordinal,
      slotKey: ordinal ? `group:group-1:gallery-${ordinal}` : 'sku:sku-red:hero',
      goal: ordinal ? 'gallery_context' : 'sku_hero',
      ownership: ordinal
        ? { level: 'compatibility_group', key: 'group-1' }
        : { level: 'sku', key: 'sku-red' },
      compatibilityGroupKey: ordinal ? 'group-1' : null,
      status: slotStatus,
      attempt: slotStatus === 'PLANNED' ? 0 : 1,
      revision: revision >= 4 ? 3 : 1,
      childWorkflowId: revision >= 4 ? `workflow-${ordinal + 1}` : null,
      workflowRevision: revision >= 4 ? 2 : null,
      referenceCandidateIds: ['candidate-1'],
      referenceAssets: revision >= 2 ? [{
        candidateId: 'candidate-1',
        id: 'reference-asset-1',
        url: '/api/images/reference-asset-1',
        mimeType: 'image/png',
        width: 900,
        height: 1200,
      }] : [],
      diagnostics: slotStatus === 'FAILED' ? ['PROVIDER_FAILED'] : [],
      estimatedCostCents: 0,
      maximumCostCents: 0,
      errorCode: slotStatus === 'FAILED' ? 'PROVIDER_FAILED' : null,
      reviewStatus: slotStatus === 'SUCCEEDED' ? 'PENDING' : 'NOT_READY',
      selectedOutputAssetId: null,
      reviewedAt: null,
      application: null,
      outputAssets: slotStatus === 'SUCCEEDED' ? [{
        id: `asset-${ordinal + 1}`,
        url: `/api/images/asset-${ordinal + 1}`,
        mimeType: 'image/png',
        width: 900,
        height: 1200,
        storageKey: 'must-not-survive-normalization',
      }] : [],
    })),
  };
}

const readiness = normalizeAiMediaSuiteReadiness(readinessPayload);
const preview = normalizeAiMediaSuitePreview(previewPayload);
assert.ok(readiness);
assert.ok(preview);
assert.equal(preview.currency, 'USD', 'legacy suite quotes retain their historical currency');
assert.equal(normalizeAiMediaSuitePreview({ ...previewPayload, currency: 'CNY' })?.currency, 'CNY');
assert.equal(normalizeAiMediaSuite({ ...suitePayload(), currency: 'CNY' })?.currency, 'CNY');
assert.equal(normalizeAiMediaSuite(suitePayload())?.currency, 'USD');
for (const currency of ['EUR', '', null, 14]) {
  assert.equal(normalizeAiMediaSuitePreview({ ...previewPayload, currency }), null);
  assert.equal(normalizeAiMediaSuite({ ...suitePayload(), currency }), null);
}
assert.equal(formatAiMediaSuiteCost(14, 'CNY'), 'CNY 0.14');
assert.equal(formatAiMediaSuiteCost(14, 'USD'), 'USD 0.14');
assert.equal(formatAiMediaSuiteCost(-1, 'CNY'), '费用不可用');
assert.equal(readiness.testOnly, true);
assert.equal(preview.itemCount, 1);
assert.equal(normalizeAiMediaSuiteReadiness({ ...readinessPayload, storage: undefined }), null);

const blockedReadiness = normalizeAiMediaSuiteReadiness({
  ...readinessPayload,
  provider: { provider: null, model: null, evidenceLevel: null, ready: false },
  ready: false,
  testOnly: false,
  reasonCode: 'AI_MEDIA_SUITE_PROVIDER_NOT_READY',
  reason: 'Provider is not ready',
});
assert.ok(blockedReadiness);
assert.equal(blockedReadiness.provider.provider, null);
assert.equal(normalizeAiMediaSuiteReadiness({
  ...readinessPayload,
  provider: { provider: null, model: null, evidenceLevel: null, ready: true },
}), null);

assert.equal(normalizeAiMediaSuitePreview({ ...previewPayload, previewHash: 'not-a-hash' }), null);
assert.equal(normalizeAiMediaSuitePreview({ ...previewPayload, itemCount: 2 }), null);
assert.equal(normalizeAiMediaSuitePreview({
  ...previewPayload,
  slots: [{ ...previewPayload.slots[0], references: [] }],
}), null);

const prepared = normalizeAiMediaSuite(suitePayload({ revision: 4 }));
const runningAfterPrepare = normalizeAiMediaSuite(suitePayload({
  status: 'RUNNING', revision: 5, slotStatuses: ['RUNNING'],
}));
const terminalAfterPrepare = normalizeAiMediaSuite(suitePayload({
  status: 'SUCCEEDED', revision: 6, slotStatuses: ['SUCCEEDED'],
}));
const failed = normalizeAiMediaSuite(suitePayload({
  status: 'PARTIAL_FAILURE', revision: 8, slotStatuses: ['FAILED', 'SUCCEEDED'],
}));
assert.ok(prepared);
assert.ok(runningAfterPrepare);
assert.ok(terminalAfterPrepare);
assert.ok(failed);
assert.equal(prepared.provider, 'fake');
assert.equal(prepared.model, 'fake-image-suite-v1');
assert.equal(prepared.pricingVersion, 'provider-free-zero/v1');
assert.equal(failed.slots[1].outputAssets[0].url, '/api/images/asset-2');
assert.equal(failed.slots[1].referenceAssets[0].candidateId, 'candidate-1');
assert.equal('storageKey' in failed.slots[1].outputAssets[0], false);
assert.equal(normalizeAiMediaSuite({
  ...suitePayload(),
  counts: { ...suitePayload().counts, succeeded: 1 },
}), null);
assert.equal(normalizeAiMediaSuite({
  ...suitePayload(),
  slots: [{ ...suitePayload().slots[0], outputAssets: [{ id: 'asset-1' }] }],
}), null);
const missingFrozenReference = suitePayload({ revision: 4 });
missingFrozenReference.slots[0].referenceAssets = [];
assert.equal(normalizeAiMediaSuite(missingFrozenReference), null);
assert.equal(normalizeAiMediaSuite({
  ...suitePayload({ status: 'SUCCEEDED', revision: 5, slotStatuses: ['SUCCEEDED'] }),
  slots: [{
    ...suitePayload({ status: 'SUCCEEDED', revision: 5, slotStatuses: ['SUCCEEDED'] }).slots[0],
    reviewStatus: 'APPROVED',
    selectedOutputAssetId: 'other-asset',
    reviewedAt: '2026-07-20T00:03:00.000Z',
  }],
}), null);
const succeededWithTwoOutputs = suitePayload({
  status: 'SUCCEEDED', revision: 5, slotStatuses: ['SUCCEEDED'],
});
succeededWithTwoOutputs.slots[0].outputAssets.push({
  id: 'asset-2', url: '/api/images/asset-2', mimeType: 'image/png', width: 900, height: 1200,
});
assert.equal(normalizeAiMediaSuite(succeededWithTwoOutputs), null);

const emptyActions = resolveAiMediaSuiteActions({ plan, readiness, preview, suite: null });
assert.equal(emptyActions.canPreview, true);
assert.equal(emptyActions.canClaim, true);
assert.equal(emptyActions.suiteCurrent, false);

const wrongVersionPreview = { ...preview, planVersionId: 'plan-version-1' };
assert.equal(resolveAiMediaSuiteActions({
  plan, readiness, preview: wrongVersionPreview, suite: null,
}).canClaim, false);
assert.throws(() => buildAiMediaSuiteClaimRequest({
  plan, preview: wrongVersionPreview, idempotencyKey: 'suite-claim-123',
}), /预览已失效/u);
assert.equal(resolveAiMediaSuiteActions({
  plan: { ...plan, sourceCurrent: null }, readiness, preview, suite: null,
}).canPreview, false);

const claimed = normalizeAiMediaSuite(suitePayload());
const claimedWithNullReview = suitePayload();
claimedWithNullReview.slots[0].reviewStatus = null;
assert.ok(normalizeAiMediaSuite(claimedWithNullReview));
const exactClaimed = normalizeAiMediaSuite({
  ...suitePayload(), previewHash: preview.previewHash,
});
assert.ok(claimed);
assert.ok(exactClaimed);
const claimedActions = resolveAiMediaSuiteActions({ plan, readiness, preview: null, suite: claimed });
assert.equal(claimedActions.canPrepare, true);
assert.equal(claimedActions.canDispatch, false);

const preparedActions = resolveAiMediaSuiteActions({ plan, readiness, preview: null, suite: prepared });
assert.equal(preparedActions.canDispatch, true);
assert.equal(preparedActions.canCancel, true);
assert.equal(resolveAiMediaSuitePreparationDecision({ plan, suite: prepared }), 'dispatch');
assert.equal(resolveAiMediaSuitePreparationDecision({ plan, suite: runningAfterPrepare }), 'reconcile');
assert.equal(resolveAiMediaSuitePreparationDecision({ plan, suite: terminalAfterPrepare }), 'reconcile');
assert.equal(resolveAiMediaSuitePreparationDecision({ plan, suite: claimed }), 'incomplete');
assert.equal(resolveAiMediaSuitePreparationDecision({
  plan, suite: { ...prepared, planVersionId: 'plan-version-1' },
}), 'invalid');
assert.equal(formatAiMediaPlanningGoal('sku_hero'), 'SKU 主图');
assert.equal(formatAiMediaPlanningGoal('scene'), '场景图');
assert.equal(formatAiMediaPlanningGoal('custom_goal'), 'custom_goal');

const failedActions = resolveAiMediaSuiteActions({ plan, readiness, preview: null, suite: failed });
assert.deepEqual(failedActions.retryableSlotIds, ['slot-1']);
assert.equal(failedActions.retryableSlotIds.includes('slot-2'), false);
assert.equal(failedActions.terminal, true);

const oldRunning = normalizeAiMediaSuite(suitePayload({
  status: 'RUNNING', revision: 6, planVersionId: 'plan-version-1', slotStatuses: ['RUNNING'],
}));
assert.ok(oldRunning);
const oldActions = resolveAiMediaSuiteActions({ plan, readiness, preview, suite: oldRunning });
assert.equal(oldActions.suiteBelongsToPlan, true);
assert.equal(oldActions.suiteCurrent, false);
assert.equal(oldActions.canPreview, true);
assert.equal(oldActions.canClaim, true);
assert.equal(oldActions.canPrepare, false);
assert.equal(oldActions.canDispatch, false);
assert.equal(oldActions.canCancel, true);
assert.equal(oldActions.shouldPoll, true);

const blockedByOldActive = resolveAiMediaSuiteActions({
  plan, readiness, preview, suite: null, activeSuite: oldRunning,
});
assert.equal(blockedByOldActive.blockedByActiveSuite, true);
assert.equal(blockedByOldActive.canPreview, false);
assert.equal(blockedByOldActive.canClaim, false);

const abandonedPreparation = normalizeAiMediaSuite(suitePayload({ planVersionId: 'plan-version-1' }));
assert.ok(abandonedPreparation);
const notBlockedByAbandonedPreparation = resolveAiMediaSuiteActions({
  plan, readiness, preview, suite: null, activeSuite: abandonedPreparation,
});
assert.equal(notBlockedByAbandonedPreparation.blockedByActiveSuite, false);
assert.equal(notBlockedByAbandonedPreparation.canPreview, true);
assert.equal(notBlockedByAbandonedPreparation.canClaim, true);

const darkOldActions = resolveAiMediaSuiteActions({ plan, readiness: blockedReadiness, preview, suite: oldRunning });
assert.equal(darkOldActions.canClaim, false);
assert.equal(darkOldActions.canCancel, true);

const pendingReviewSuite = normalizeAiMediaSuite(suitePayload({
  status: 'SUCCEEDED', revision: 6, slotStatuses: ['SUCCEEDED'],
}));
assert.ok(pendingReviewSuite);
const approvedReviewPayload = suitePayload({
  status: 'SUCCEEDED', revision: 7, slotStatuses: ['SUCCEEDED'],
});
approvedReviewPayload.slots[0] = {
  ...approvedReviewPayload.slots[0],
  workflowRevision: 3,
  reviewStatus: 'APPROVED',
  selectedOutputAssetId: 'asset-1',
  reviewedAt: '2026-07-20T00:03:00.000Z',
};
const approvedReviewSuite = normalizeAiMediaSuite(approvedReviewPayload);
assert.ok(approvedReviewSuite);
const appliedPayload = structuredClone(approvedReviewPayload);
appliedPayload.slots[0].workflowRevision = 4;
appliedPayload.slots[0].application = {
  id: 'application-1', revision: 1, state: 'APPLIED', legacy: false,
  jobId: 'job-1', outputAssetId: 'asset-1', mode: 'append',
  appliedAt: '2026-07-20T00:04:00.000Z', rolledBackAt: null,
  targetUpdatedAt: '2026-07-20T00:04:00.001Z',
};
const appliedSuite = normalizeAiMediaSuite(appliedPayload);
assert.ok(appliedSuite);
const rolledBackPayload = structuredClone(appliedPayload);
rolledBackPayload.slots[0].workflowRevision = 5;
rolledBackPayload.slots[0].application = {
  ...rolledBackPayload.slots[0].application,
  revision: 2,
  state: 'ROLLED_BACK',
  rolledBackAt: '2026-07-20T00:05:00.000Z',
  targetUpdatedAt: '2026-07-20T00:05:00.001Z',
};
const rolledBackSuite = normalizeAiMediaSuite(rolledBackPayload);
assert.ok(rolledBackSuite);

assert.deepEqual(resolveAiMediaSuiteSlotActions({
  plan, readiness: { ready: true }, suite: pendingReviewSuite, slot: pendingReviewSuite.slots[0], targetUpdatedAt: '2026-07-20T00:05:00.000Z',
}), {
  candidateCurrent: true, canReview: true, canApply: false, applied: false,
  viewOnlyReason: null,
});
assert.equal(resolveAiMediaSuiteSlotActions({
  plan, readiness: { ready: true }, suite: approvedReviewSuite, slot: approvedReviewSuite.slots[0], targetUpdatedAt: '2026-07-20T00:05:00.000Z',
}).canApply, true);
assert.equal(resolveAiMediaSuiteSlotActions({
  plan, readiness: { ready: true }, suite: approvedReviewSuite, slot: approvedReviewSuite.slots[0], targetUpdatedAt: null,
}).canApply, false);
assert.equal(resolveAiMediaSuiteSlotActions({
  plan, readiness: { ready: true }, suite: appliedSuite, slot: appliedSuite.slots[0], targetUpdatedAt: '2026-07-20T00:05:00.000Z',
}).applied, true);
assert.equal(resolveAiMediaSuiteSlotActions({
  plan, readiness: { ready: true }, suite: rolledBackSuite, slot: rolledBackSuite.slots[0], targetUpdatedAt: '2026-07-20T00:06:00.000Z',
}).canApply, false, 'a rolled-back suite candidate remains ever-applied and cannot be submitted twice');
assert.equal(resolveAiMediaSuiteSlotActions({
  plan: { ...plan, sourceCurrent: false }, readiness: { ready: true }, suite: pendingReviewSuite,
  slot: pendingReviewSuite.slots[0], targetUpdatedAt: '2026-07-20T00:05:00.000Z',
}).viewOnlyReason, 'SOURCE_CHANGED');
assert.equal(resolveAiMediaSuiteSlotActions({
  plan, readiness: { ready: true }, suite: { ...pendingReviewSuite, planVersionId: 'old-version' },
  slot: pendingReviewSuite.slots[0], targetUpdatedAt: '2026-07-20T00:05:00.000Z',
}).viewOnlyReason, 'HISTORICAL_VERSION');
assert.equal(resolveAiMediaSuiteSlotActions({
  plan, readiness: { ready: false }, suite: pendingReviewSuite,
  slot: pendingReviewSuite.slots[0], targetUpdatedAt: '2026-07-20T00:05:00.000Z',
}).canReview, false);

assert.deepEqual(buildAiMediaSuiteSlotReviewRequest({
  slot: pendingReviewSuite.slots[0], outputAssetId: 'asset-1', decision: 'APPROVE',
  note: '  商品主体一致  ', operationKey: 'suite-review-123',
}), {
  expectedWorkflowRevision: 2,
  operationKey: 'suite-review-123',
  outputAssetId: 'asset-1',
  decision: 'APPROVE',
  note: '商品主体一致',
});
assert.deepEqual(buildAiMediaSuiteSlotApplyRequest({
  slot: approvedReviewSuite.slots[0], operationKey: 'suite-apply-123',
  expectedTargetUpdatedAt: '2026-07-20T00:05:00.000Z',
}), {
  expectedWorkflowRevision: 3,
  operationKey: 'suite-apply-123',
  expectedTargetUpdatedAt: '2026-07-20T00:05:00.000Z',
});
assert.equal('mode' in buildAiMediaSuiteSlotApplyRequest({
  slot: approvedReviewSuite.slots[0], operationKey: 'suite-apply-123',
  expectedTargetUpdatedAt: '2026-07-20T00:05:00.000Z',
}), false, 'the suite apply endpoint is append-only and accepts no client-selected mode');
assert.throws(() => buildAiMediaSuiteSlotReviewRequest({
  slot: approvedReviewSuite.slots[0], outputAssetId: 'asset-1', decision: 'REJECT',
  note: '', operationKey: 'suite-review-123',
}), /不能审核/u);
assert.throws(() => buildAiMediaSuiteSlotApplyRequest({
  slot: appliedSuite.slots[0], operationKey: 'suite-apply-123',
  expectedTargetUpdatedAt: '2026-07-20T00:05:00.000Z',
}), /已经应用过/u);

assert.equal(resolveAiMediaSuiteSlotReviewRecovery({
  slot: approvedReviewSuite.slots[0], outputAssetId: 'asset-1', decision: 'APPROVE',
}), 'confirmed');
assert.equal(resolveAiMediaSuiteSlotReviewRecovery({
  slot: pendingReviewSuite.slots[0], outputAssetId: 'asset-1', decision: 'APPROVE',
}), 'retry');
assert.equal(resolveAiMediaSuiteSlotReviewRecovery({
  slot: { ...approvedReviewSuite.slots[0], reviewStatus: 'REJECTED' },
  outputAssetId: 'asset-1', decision: 'APPROVE',
}), 'conflict');
assert.equal(resolveAiMediaSuiteSlotApplyRecovery({
  slot: appliedSuite.slots[0], outputAssetId: 'asset-1',
}), 'confirmed');
assert.equal(resolveAiMediaSuiteSlotApplyRecovery({
  slot: rolledBackSuite.slots[0], outputAssetId: 'asset-1',
}), 'conflict', 'rolled back is terminal for the original suite apply intent');
assert.equal(resolveAiMediaSuiteSlotApplyRecovery({
  slot: approvedReviewSuite.slots[0], outputAssetId: 'asset-1',
}), 'retry');

const acceptedClaimDecision = resolveAiMediaSuiteClaimDecision({
  outcome: 'accepted', plan, preview, claimedSuite: exactClaimed,
});
assert.equal(acceptedClaimDecision.kind, 'proceed');
assert.equal(acceptedClaimDecision.suite, exactClaimed);
assert.equal(resolveAiMediaSuiteClaimDecision({
  outcome: 'accepted', plan, preview, claimedSuite: claimed,
}).kind, 'uncertain');
assert.equal(resolveAiMediaSuiteClaimDecision({
  outcome: 'accepted',
  plan: { ...plan, revision: plan.revision + 1 },
  preview,
  claimedSuite: exactClaimed,
}).kind, 'uncertain');
assert.equal(resolveAiMediaSuiteClaimDecision({
  outcome: 'rejected', plan, preview, recoveredSuite: claimed,
}).kind, 'manual-continue');
assert.equal(resolveAiMediaSuiteClaimDecision({
  outcome: 'unknown', plan, preview, recoveredSuite: claimed,
}).kind, 'manual-continue');
assert.equal(resolveAiMediaSuiteClaimDecision({
  outcome: 'rejected', plan, preview, recoveredSuite: oldRunning,
}).kind, 'rejected');
assert.equal(resolveAiMediaSuiteClaimDecision({
  outcome: 'unknown', plan, preview, recoveredSuite: oldRunning,
}).kind, 'uncertain');

assert.deepEqual(buildAiMediaSuitePreviewRequest(' plan-1 '), { planId: 'plan-1' });
assert.deepEqual(buildAiMediaSuiteClaimRequest({ plan, preview, idempotencyKey: 'suite-claim-123' }), {
  planId: 'plan-1',
  expectedPlanRevision: 3,
  expectedPreviewHash: 'a'.repeat(64),
  idempotencyKey: 'suite-claim-123',
});
assert.deepEqual(buildAiMediaSuitePrepareRequest('suite-prepare-123'), { operationKey: 'suite-prepare-123' });
assert.deepEqual(buildAiMediaSuiteDispatchRequest(prepared, 'suite-dispatch-123'), {
  expectedRevision: 4,
  operationKey: 'suite-dispatch-123',
});
assert.deepEqual(buildAiMediaSuiteCancelRequest(oldRunning, 'suite-cancel-123'), {
  expectedRevision: 6,
  operationKey: 'suite-cancel-123',
});
assert.deepEqual(buildAiMediaSuiteRetryRequest(failed.slots[0], 'suite-retry-123'), {
  expectedSlotRevision: 3,
  operationKey: 'suite-retry-123',
});
assert.throws(() => buildAiMediaSuiteClaimRequest({
  plan,
  preview: { ...preview, planVersionId: 'old-version' },
  idempotencyKey: 'suite-claim-123',
}), /预览已失效/u);
assert.throws(() => buildAiMediaSuiteRetryRequest(failed.slots[1], 'suite-retry-123'), /仅失败/u);

function createDeferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

const flushAsyncWork = () => new Promise((resolve) => setImmediate(resolve));
const scheduledTimers = new Map();
const cancelledTimers = [];
let nextTimer = 1;
const scheduleTimer = (callback, delayMs) => {
  assert.equal(delayMs, 2_000);
  const handle = nextTimer;
  nextTimer += 1;
  scheduledTimers.set(handle, callback);
  return handle;
};
const cancelTimer = (handle) => {
  cancelledTimers.push(handle);
  scheduledTimers.delete(handle);
};
const fireOnlyTimer = () => {
  assert.equal(scheduledTimers.size, 1);
  const [handle, callback] = scheduledTimers.entries().next().value;
  scheduledTimers.delete(handle);
  callback();
};

let mutationBusy = false;
let activePolls = 0;
let maximumActivePolls = 0;
let pollCount = 0;
const pollGates = [];
const stopPolling = startAiMediaSuitePolling({
  delayMs: 2_000,
  schedule: scheduleTimer,
  cancel: cancelTimer,
  canPoll: () => !mutationBusy,
  poll: async () => {
    pollCount += 1;
    activePolls += 1;
    maximumActivePolls = Math.max(maximumActivePolls, activePolls);
    const gate = createDeferred();
    pollGates.push(gate);
    await gate.promise;
    activePolls -= 1;
  },
});
assert.equal(scheduledTimers.size, 1);
fireOnlyTimer();
await flushAsyncWork();
assert.equal(pollCount, 1);
assert.equal(activePolls, 1);
assert.equal(scheduledTimers.size, 0, 'a new timer must wait for the active poll');
pollGates[0].resolve();
await flushAsyncWork();
assert.equal(scheduledTimers.size, 1);

mutationBusy = true;
fireOnlyTimer();
await flushAsyncWork();
assert.equal(pollCount, 1, 'mutations must suppress the read without stopping polling');
assert.equal(scheduledTimers.size, 1);

mutationBusy = false;
fireOnlyTimer();
await flushAsyncWork();
assert.equal(pollCount, 2);
assert.equal(activePolls, 1);
assert.equal(scheduledTimers.size, 0);
stopPolling();
pollGates[1].resolve();
await flushAsyncWork();
assert.equal(scheduledTimers.size, 0, 'stopping an in-flight poll must prevent rescheduling');
assert.equal(maximumActivePolls, 1);

const stopBeforeFirstPoll = startAiMediaSuitePolling({
  delayMs: 2_000,
  schedule: scheduleTimer,
  cancel: cancelTimer,
  canPoll: () => true,
  poll: () => { throw new Error('cancelled timer ran'); },
});
const pendingTimer = scheduledTimers.keys().next().value;
stopBeforeFirstPoll();
assert.equal(scheduledTimers.size, 0);
assert.ok(cancelledTimers.includes(pendingTimer));
assert.throws(() => startAiMediaSuitePolling({
  delayMs: -1,
  schedule: scheduleTimer,
  cancel: cancelTimer,
  canPoll: () => true,
  poll: () => undefined,
}), /轮询间隔无效/u);

for (const code of [
  'AI_MEDIA_SUITE_CANDIDATE_TARGET_CONFLICT',
  'AI_MEDIA_SUITE_CANDIDATE_STALE',
  'TARGET_CONFLICT',
  'STALE_MEDIA_WORKFLOW',
]) {
  assert.equal(
    shouldRefreshAiMediaSuiteTargetAfterError(code),
    true,
    `${code} must refresh the exact collect target before another apply attempt`,
  );
}
assert.equal(shouldRefreshAiMediaSuiteTargetAfterError('WORKFLOW_CONFLICT'), false);

const panel = fs.readFileSync('apps/web/src/components/ai-media/source-ai-media-suite-panel.tsx', 'utf8');
const planningPanel = fs.readFileSync('apps/web/src/components/ai-media/source-ai-media-planning-panel.tsx', 'utf8');
const mediaPanel = fs.readFileSync('apps/web/src/components/ai-media/source-ai-media-panel.tsx', 'utf8');
const workflow = fs.readFileSync('apps/web/src/lib/ai-media-workflow.ts', 'utf8');

assert.match(planningPanel, /SourceAiMediaSuitePanel/u);
assert.match(planningPanel, /plan=\{bundle\.plan\}/u);
assert.match(planningPanel, /targetUpdatedAt=\{targetUpdatedAt\}/u);
assert.match(planningPanel, /runMediaMutation=\{runMediaMutation\}/u);
assert.match(planningPanel, /mediaDraftDirty=\{mediaDraftDirty \|\| slotDraftDirty\}/u);
assert.match(planningPanel, /onConflictRefresh=\{onConflictRefresh\}/u);
assert.match(mediaPanel, /<SourceAiMediaPlanningPanel[\s\S]*?enabled[\s\S]*?planningEnabled=/u);
assert.match(mediaPanel, /<SourceAiMediaPlanningPanel[\s\S]*?targetUpdatedAt=\{target\.updatedAt\}/u);
assert.match(mediaPanel, /<SourceAiMediaPlanningPanel[\s\S]*?onApplied=\{onApplied\}/u);
assert.doesNotMatch(mediaPanel, /<SourceAiMediaPlanningPanel[\s\S]*?enabled=\{!disabled\}/u);
assert.match(planningPanel, /if \(!planningEnabled \|\| !bundle/u);
assert.match(planningPanel, /planningEnabled && REVIEWABLE\.has\(bundle\.plan\.reviewStatus\)/u);
assert.match(panel, /suites\/readiness/u);
assert.match(panel, /suites\/current\?planId=/u);
assert.match(panel, /suites\/active\?planId=/u);
assert.match(panel, /suites\/preview/u);
assert.match(panel, /suites\/claim/u);
assert.match(panel, /\/prepare/u);
assert.match(panel, /\/dispatch/u);
assert.match(panel, /\/cancel/u);
assert.match(panel, /\/slots\/\$\{encodeURIComponent\(slot\.id\)\}\/retry/u);
assert.match(panel, /startAiMediaSuitePolling<number>/u);
assert.match(panel, /canPoll: \(\) => pendingActionsRef\.current\.size === 0/u);
assert.doesNotMatch(panel, /setInterval\(/u);
assert.match(panel, /resolveWorkflowSubmissionIntent/u);
assert.match(panel, /loadWorkflowSubmissionIntent/u);
assert.match(panel, /resolveAiMediaSuiteClaimDecision/u);
assert.match(panel, /resolveAiMediaSuitePreparationDecision/u);
assert.match(panel, /decision === 'reconcile'[\s\S]*?setSuite\(current\)[\s\S]*?loadCurrentSuite\(true\)/u);
assert.doesNotMatch(panel, /matchesClaimedVersion/u);
assert.match(panel, /无法证明它属于本次确认/u);
assert.match(panel, /已冻结：\{suite\.provider\} \/ \{suite\.model\} · 定价 \{suite\.pricingVersion\}/u);
assert.match(panel, /readinessRequestVersion/u);
assert.match(panel, /request !== readinessRequestVersion\.current/u);
assert.match(panel, /历史版本/u);
assert.match(panel, /旧版本活动任务/u);
assert.match(panel, /!actions\.suiteCurrent/u);
assert.match(panel, /slot\.outputAssets\[0\]/u);
assert.match(panel, /测试输出/u);
assert.match(panel, /onError=\{\(\) => setState\('error'\)\}/u);
assert.match(panel, /actions\.retryableSlotIds\.includes\(slot\.id\)/u);
assert.match(panel, /slots\/\$\{encodeURIComponent\(slot\.id\)\}\/review/u);
assert.match(panel, /slots\/\$\{encodeURIComponent\(slot\.id\)\}\/apply/u);
assert.match(panel, /审核套图候选/u);
assert.match(panel, /追加到商品/u);
assert.match(panel, /resolveAiMediaSuiteSlotReviewRecovery/u);
assert.match(panel, /resolveAiMediaSuiteSlotApplyRecovery/u);
assert.match(panel, /projectAiMediaApplicationImageUrls/u);
assert.match(panel, /mediaDraftDirty/u);
assert.match(panel, /已回滚/u);
assert.match(panel, /recovered === undefined[\s\S]*保留本次操作/u);
assert.match(panel, /shouldRefreshAiMediaSuiteTargetAfterError[\s\S]*onConflictRefresh/u);
assert.match(panel, /enqueuePending/u);
assert.match(panel, /isCurrentIdentity\(identity, context\)\) endAction/u);
assert.ok([...panel.matchAll(/isCurrentIdentity\(identity, context\)\) endAction/gu)].length >= 5);
assert.match(workflow, /suite\?\.planVersionId === plan\.currentVersionId/u);
assert.match(workflow, /preview\.planVersionId === plan\.currentVersionId/u);
assert.match(workflow, /plan\.sourceCurrent === true/u);
assert.match(workflow, /canCancel: suiteBelongsToPlan/u);
assert.doesNotMatch(panel, /ownerUserId|actorUserId|providerConfigHash|resolvedPrompt/u);

console.log('PASS Web AI media suite execution workbench contract');
