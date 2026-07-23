import assert from 'node:assert/strict';
import { createLatestLoadCoordinator, createLatestRequestGuard, createMediaMutationLock, buildSaveSourceImagesRequest, executeLockedMediaMutation, executeWithBusyState } from '../apps/web/src/components/ai-media/source-ai-media-state.ts';
import {
  AI_MEDIA_INTENT_TTL_MS,
  AI_MEDIA_EXECUTION_POLL_INTERVAL_MS,
  AI_MEDIA_REVIEW_POLL_INTERVAL_MS,
  appendAiMediaWorkflowHistoryPage,
  aiMediaWorkflowPollInterval,
  aiMediaWorkflowReviewOutput,
  buildImageTranslationWorkflowRequest,
  clearWorkflowSubmissionIntent,
  describeAiMediaReadiness,
  isAiMediaWorkflowInputCurrent,
  isDefinitiveWorkflowSubmissionFailure,
  listAiMediaReadinessNotices,
  loadWorkflowSubmissionIntent,
  mergeAiMediaWorkflowHistoryHead,
  normalizeAiMediaWorkflowPage,
  normalizeAiMediaWorkflowPriorityPage,
  normalizeImageTranslationTerminologies,
  resolveWorkflowSubmissionIntent,
  saveWorkflowSubmissionIntent,
} from '../apps/web/src/lib/ai-media-workflow.ts';

const historyHead = [{ id: 'workflow-3', status: 'RUNNING' }, { id: 'workflow-2', status: 'SUCCEEDED' }];
const historyCurrent = [{ id: 'workflow-2', status: 'QUEUED' }, { id: 'workflow-1', status: 'SUCCEEDED' }];
assert.deepEqual(
  mergeAiMediaWorkflowHistoryHead(historyCurrent, historyHead).map(({ id, status }) => ({ id, status })),
  [
    { id: 'workflow-3', status: 'RUNNING' },
    { id: 'workflow-2', status: 'SUCCEEDED' },
    { id: 'workflow-1', status: 'SUCCEEDED' },
  ],
);
assert.deepEqual(
  appendAiMediaWorkflowHistoryPage(historyHead, [
    { id: 'workflow-2', status: 'APPROVED' },
    { id: 'workflow-1', status: 'SUCCEEDED' },
  ]).map(({ id, status }) => ({ id, status })),
  [
    { id: 'workflow-3', status: 'RUNNING' },
    { id: 'workflow-2', status: 'APPROVED' },
    { id: 'workflow-1', status: 'SUCCEEDED' },
  ],
);
assert.deepEqual(normalizeAiMediaWorkflowPage({
  items: historyHead,
  priorityItems: [{ id: 'workflow-old-active', status: 'RUNNING' }],
  priorityItemsTruncated: false,
  priorityNextCursor: 'priority_cursor-1',
  nextCursor: 'valid_cursor-1',
}), {
  items: historyHead,
  priorityItems: [{ id: 'workflow-old-active', status: 'RUNNING' }],
  priorityItemsTruncated: false,
  priorityNextCursor: 'priority_cursor-1',
  nextCursor: 'valid_cursor-1',
});
assert.equal(normalizeAiMediaWorkflowPage({ items: historyHead, nextCursor: 'invalid+cursor' }), null);
assert.equal(normalizeAiMediaWorkflowPage({
  items: historyHead, nextCursor: null, priorityNextCursor: 'invalid+cursor',
}), null);
assert.equal(
  Object.hasOwn(normalizeAiMediaWorkflowPage({ items: historyHead, nextCursor: null }), 'priorityNextCursor'),
  false,
  'an old server response must not look like it supports priority continuation',
);
assert.deepEqual(normalizeAiMediaWorkflowPriorityPage({
  items: [{ id: 'workflow-priority-2', status: 'RUNNING' }], nextCursor: 'priority_cursor-2',
}), {
  items: [{ id: 'workflow-priority-2', status: 'RUNNING' }], nextCursor: 'priority_cursor-2',
});
assert.equal(normalizeAiMediaWorkflowPriorityPage({ items: historyHead, nextCursor: 'invalid+cursor' }), null);
assert.equal(aiMediaWorkflowPollInterval([{ status: 'RUNNING', jobs: [] }]), AI_MEDIA_EXECUTION_POLL_INTERVAL_MS);
assert.equal(aiMediaWorkflowPollInterval([{
  status: 'SUCCEEDED', reviewStatus: 'PENDING', jobs: [{ id: 'job-pending', appliedMode: null }],
}]), AI_MEDIA_REVIEW_POLL_INTERVAL_MS);
assert.equal(aiMediaWorkflowPollInterval([{
  status: 'SUCCEEDED', reviewStatus: 'APPROVED', jobs: [{ id: 'job-applied', appliedMode: 'append' }],
}]), null);
assert.equal(aiMediaWorkflowPollInterval([{
  status: 'FAILED', reviewStatus: 'NOT_READY', jobs: [{
    id: 'job-reconciling',
    providerReconciliation: { status: 'MANUAL_REVIEW', revision: 2 },
  }],
}]), AI_MEDIA_REVIEW_POLL_INTERVAL_MS, 'failed jobs awaiting Provider reconciliation must keep polling');
assert.equal(aiMediaWorkflowPollInterval([{
  status: 'FAILED', reviewStatus: 'NOT_READY', jobs: [{
    id: 'job-no-output',
    providerReconciliation: { status: 'NO_OUTPUT', revision: 3 },
  }],
}]), null, 'terminal Provider-result outcomes do not need reconciliation polling');
const selectedOutput = aiMediaWorkflowReviewOutput(
  { selectedOutputAssetId: 'asset-selected' },
  { assets: [{ id: 'asset-first' }, { id: 'asset-selected' }] },
);
assert.equal(selectedOutput.id, 'asset-selected');
assert.equal(aiMediaWorkflowReviewOutput(
  { selectedOutputAssetId: null },
  { assets: [{ id: 'asset-first' }, { id: 'asset-second' }] },
), undefined, 'multiple outputs require an explicit selectedOutputAssetId');

const currentRevision = [{
  id: 'workflow-race', status: 'APPROVED', revision: 4,
  createdAt: '2026-07-20T08:00:00.000Z', updatedAt: '2026-07-20T08:04:00.000Z',
}];
const staleRevision = [{
  id: 'workflow-race', status: 'RUNNING', revision: 3,
  createdAt: '2026-07-20T08:00:00.000Z', updatedAt: '2026-07-20T08:03:00.000Z',
}];
assert.equal(
  mergeAiMediaWorkflowHistoryHead(currentRevision, staleRevision)[0].status,
  'APPROVED',
  'a late head response must not replace a newer workflow revision',
);
assert.equal(
  appendAiMediaWorkflowHistoryPage(currentRevision, staleRevision)[0].status,
  'APPROVED',
  'a late history or priority page must not replace a newer workflow revision',
);
const appliedCurrent = [{
  id: 'workflow-applied', status: 'SUCCEEDED', reviewStatus: 'APPROVED', revision: 5,
  createdAt: '2026-07-20T08:00:00.000Z', updatedAt: '2026-07-20T08:05:00.000Z',
  jobs: [{ id: 'job-applied', appliedMode: 'append', costStatus: 'SETTLED' }],
}];
const staleJobProjection = [{
  id: 'workflow-applied', status: 'SUCCEEDED', reviewStatus: 'APPROVED', revision: 5,
  createdAt: '2026-07-20T08:00:00.000Z', updatedAt: '2026-07-20T08:05:00.000Z',
  jobs: [{ id: 'job-applied', appliedMode: null, costStatus: 'RESERVED' }],
}];
const mergedApplied = mergeAiMediaWorkflowHistoryHead(appliedCurrent, staleJobProjection)[0];
assert.equal(mergedApplied.jobs[0].appliedMode, 'append', 'appliedMode must be monotonic within one workflow revision');
assert.equal(mergedApplied.jobs[0].costStatus, 'SETTLED', 'a final cost state must not regress to RESERVED');
const currentProviderReconciliation = [{
  id: 'workflow-provider-reconciliation', status: 'FAILED', reviewStatus: 'NOT_READY', revision: 5,
  createdAt: '2026-07-20T08:00:00.000Z', updatedAt: '2026-07-20T08:05:00.000Z',
  jobs: [{
    id: 'job-provider-reconciliation', retryAllowed: true,
    providerReconciliation: { status: 'NO_OUTPUT', revision: 4 },
  }],
}];
const staleProviderReconciliation = [{
  ...currentProviderReconciliation[0],
  updatedAt: '2026-07-20T08:06:00.000Z',
  jobs: [{
    id: 'job-provider-reconciliation', retryAllowed: false,
    providerReconciliation: { status: 'MANUAL_REVIEW', revision: 3 },
  }],
}];
const mergedProviderReconciliation = mergeAiMediaWorkflowHistoryHead(
  currentProviderReconciliation,
  staleProviderReconciliation,
)[0].jobs[0];
assert.equal(mergedProviderReconciliation.providerReconciliation.status, 'NO_OUTPUT');
assert.equal(mergedProviderReconciliation.providerReconciliation.revision, 4);
assert.equal(
  mergedProviderReconciliation.retryAllowed,
  true,
  'retryAllowed must stay paired with the preserved Provider reconciliation revision',
);
const staleCostProjection = [{
  ...currentProviderReconciliation[0],
  updatedAt: '2026-07-20T08:06:30.000Z',
  jobs: [{
    id: 'job-provider-reconciliation', costStatus: 'RESERVED', retryAllowed: false,
    providerReconciliation: { status: 'NO_OUTPUT', revision: 4 },
  }],
}];
currentProviderReconciliation[0].jobs[0].costStatus = 'RELEASED';
const mergedStaleCostProjection = mergeAiMediaWorkflowHistoryHead(
  currentProviderReconciliation,
  staleCostProjection,
)[0].jobs[0];
assert.equal(mergedStaleCostProjection.costStatus, 'RELEASED');
assert.equal(
  mergedStaleCostProjection.retryAllowed,
  true,
  'retryAllowed must stay paired with the preserved cost state at the same reconciliation revision',
);
const newerProviderReconciliation = [{
  ...currentProviderReconciliation[0],
  updatedAt: '2026-07-20T08:07:00.000Z',
  jobs: [{
    id: 'job-provider-reconciliation', retryAllowed: false,
    providerReconciliation: { status: 'RECOVERED', revision: 5 },
  }],
}];
const mergedNewerProviderReconciliation = mergeAiMediaWorkflowHistoryHead(
  currentProviderReconciliation,
  newerProviderReconciliation,
)[0].jobs[0];
assert.equal(mergedNewerProviderReconciliation.providerReconciliation.revision, 5);
assert.equal(mergedNewerProviderReconciliation.retryAllowed, false);
const rolledBackProjection = [{
  ...appliedCurrent[0],
  application: {
    id: 'application-1', revision: 2, state: 'ROLLED_BACK', mode: 'append',
    workflowId: 'workflow-applied', jobId: 'job-applied', outputAssetId: 'asset-1',
    targetType: 'collect', targetId: 'goods-1', contextSkuKey: null, contextSlotKey: null,
    appliedAt: '2026-07-20T08:05:00.000Z', rolledBackAt: '2026-07-20T08:06:00.000Z',
    targetUpdatedAt: '2026-07-20T08:06:00.000Z', legacy: false,
  },
}];
const lateAppliedProjection = [{
  ...appliedCurrent[0],
  application: {
    ...rolledBackProjection[0].application,
    revision: 1, state: 'APPLIED', rolledBackAt: null,
    targetUpdatedAt: '2026-07-20T08:05:00.000Z',
  },
}];
assert.equal(
  mergeAiMediaWorkflowHistoryHead(rolledBackProjection, lateAppliedProjection)[0].application.state,
  'ROLLED_BACK',
  'a late workflow response must not regress an application from ROLLED_BACK to APPLIED',
);

const waiters = new Map();
const applied = [];
const quietModes = [];
const interactiveModes = [];
let loadingStates = [];
const coordinator = createLatestLoadCoordinator({
  onLoadingChange: (loading) => loadingStates.push(loading),
  execute: async (request, isCurrent) => {
    quietModes.push(request.quiet);
    interactiveModes.push(request.interactive);
    await new Promise((resolve) => waiters.set(request.targetId, resolve));
    if (isCurrent()) applied.push(request.targetId);
  },
});
async function release(targetId) {
  while (!waiters.has(targetId)) await Promise.resolve();
  const waiter = waiters.get(targetId);
  waiters.delete(targetId);
  waiter();
}

coordinator.setTarget('collect-a');
const first = coordinator.load();
coordinator.setTarget('collect-b');
const second = coordinator.load();
const staleActionRefresh = coordinator.load(true);
await release('collect-a');
await release('collect-b');
await Promise.all([first, second, staleActionRefresh]);
assert.deepEqual(applied, ['collect-b']);
assert.deepEqual(quietModes, [false, false]);
assert.deepEqual(interactiveModes, [false, false]);
assert.deepEqual(loadingStates, [true, false]);

coordinator.setTarget('collect-c');
const interactiveRefresh = coordinator.load(true, true);
await release('collect-c');
await interactiveRefresh;
assert.deepEqual(applied, ['collect-b', 'collect-c']);
assert.deepEqual(quietModes, [false, false, true]);
assert.deepEqual(interactiveModes, [false, false, true]);
assert.deepEqual(loadingStates, [true, false]);

coordinator.setTarget('collect-d');
const activeSameTarget = coordinator.load(true);
coordinator.setTarget('collect-e');
const queuedInteractive = coordinator.load(true, true);
const queuedPoll = coordinator.load(true);
await release('collect-d');
await release('collect-e');
await Promise.all([activeSameTarget, queuedInteractive, queuedPoll]);
assert.equal(interactiveModes.at(-1), true, 'a same-target poll must preserve a queued interactive refresh');
assert.deepEqual(applied, ['collect-b', 'collect-c', 'collect-e']);

coordinator.setTarget('collect-f');
const activeOldTarget = coordinator.load(true);
coordinator.setTarget('collect-g');
const supersededInteractive = coordinator.load(true, true);
coordinator.setTarget('collect-h');
const replacementPoll = coordinator.load(true);
await release('collect-f');
await release('collect-h');
await Promise.all([activeOldTarget, supersededInteractive, replacementPoll]);
assert.equal(interactiveModes.at(-1), false, 'interactive intent must not cross target changes');
assert.deepEqual(applied, ['collect-b', 'collect-c', 'collect-e', 'collect-h']);

coordinator.setTarget('collect-i');
const activeInteractiveRefresh = coordinator.load(true, true);
while (!waiters.has('collect-i')) await Promise.resolve();
const supersedingSameTargetPoll = coordinator.load(true);
await release('collect-i');
await release('collect-i');
await Promise.all([activeInteractiveRefresh, supersedingSameTargetPoll]);
assert.deepEqual(
  interactiveModes.slice(-2),
  [true, true],
  'a same-target poll that supersedes an active interactive refresh must inherit its prompt authority',
);
assert.deepEqual(applied, ['collect-b', 'collect-c', 'collect-e', 'collect-h', 'collect-i']);

coordinator.setTarget('collect-j');
const invalidatedLoad = coordinator.load(true, true);
while (!waiters.has('collect-j')) await Promise.resolve();
coordinator.invalidate();
coordinator.setTarget('collect-k');
const replacementAfterInvalidation = coordinator.load(true);
await release('collect-j');
await release('collect-k');
await Promise.all([invalidatedLoad, replacementAfterInvalidation]);
assert.deepEqual(
  applied,
  ['collect-b', 'collect-c', 'collect-e', 'collect-h', 'collect-i', 'collect-k'],
  'invalidating an active load must suppress its result while leaving the coordinator reusable',
);

const lock = createMediaMutationLock();
const busy = [];
let rejectAction;
const failed = executeLockedMediaMutation(lock, (value) => busy.push(value), () => new Promise((_, reject) => { rejectAction = reject; }));
assert.equal(lock.isLocked(), true);
assert.equal((await executeLockedMediaMutation(lock, (value) => busy.push(value), async () => 'blocked')).started, false);
rejectAction(new Error('network'));
await assert.rejects(failed, /network/u);
assert.equal(lock.isLocked(), false);
assert.deepEqual(busy, [true, false]);

const saving = [];
await assert.rejects(
  executeWithBusyState((value) => saving.push(value), async () => { throw new Error('save rejected'); }),
  /save rejected/u,
);
assert.deepEqual(saving, [true, false]);

const requestGuard = createLatestRequestGuard();
const firstRequestIsCurrent = requestGuard.begin();
const secondRequestIsCurrent = requestGuard.begin();
assert.equal(firstRequestIsCurrent(), false);
assert.equal(secondRequestIsCurrent(), true);

assert.throws(() => buildSaveSourceImagesRequest({ id: 'collect-a', images: [], sourceDetailImages: [], expectedUpdatedAt: 'v1' }), /至少保留一张/u);
assert.deepEqual(buildSaveSourceImagesRequest({ id: 'collect-a', images: ['a'], sourceDetailImages: [], expectedUpdatedAt: 'v1' }), {
  id: 'collect-a', images: ['a'], sourceDetailImages: [], expectedUpdatedAt: 'v1',
});

const terms = normalizeImageTranslationTerminologies([
  { src: ' Brand ', tgt: 'Бренд' },
  { src: '', tgt: '' },
]);
assert.deepEqual(terms, [{ src: 'Brand', tgt: 'Бренд' }]);
const intent = resolveWorkflowSubmissionIntent(
  null,
  'translation-fingerprint',
  () => 'translation-idempotency-1',
  { now: 1_000 },
);
assert.equal(
  resolveWorkflowSubmissionIntent(intent, 'translation-fingerprint', () => 'different', { now: 1_001 }).idempotencyKey,
  'translation-idempotency-1',
);
assert.equal(
  resolveWorkflowSubmissionIntent(
    intent,
    'translation-fingerprint',
    () => 'translation-idempotency-2',
    { now: 1_000 + AI_MEDIA_INTENT_TTL_MS + 1 },
  ).idempotencyKey,
  'translation-idempotency-2',
);

const storageValues = new Map();
const storage = {
  getItem: (key) => storageValues.get(key) || null,
  setItem: (key, value) => storageValues.set(key, value),
  removeItem: (key) => storageValues.delete(key),
};
saveWorkflowSubmissionIntent(storage, 'translation', intent);
assert.deepEqual(loadWorkflowSubmissionIntent(storage, 'translation', { now: 1_001 }), intent);
assert.equal(
  loadWorkflowSubmissionIntent(storage, 'translation', { now: 1_000 + AI_MEDIA_INTENT_TTL_MS + 1 }),
  null,
);
assert.equal(storageValues.has('translation'), false);
saveWorkflowSubmissionIntent(storage, 'translation', intent);
clearWorkflowSubmissionIntent(storage, 'translation');
assert.equal(storageValues.has('translation'), false);
assert.equal(isDefinitiveWorkflowSubmissionFailure('PROVIDER_NOT_READY'), true);
assert.equal(isDefinitiveWorkflowSubmissionFailure(0), false);
assert.equal(describeAiMediaReadiness('IMAGE_TO_IMAGE', {
  enabled: true, ready: true, testOnly: true, reasonCode: 'READY', reason: 'ready',
}), '当前使用本地测试 Provider，结果不代表真实 AI 效果。');
assert.equal(describeAiMediaReadiness('IMAGE_TRANSLATE', {
  enabled: true, ready: false, reasonCode: 'PROVIDER_NOT_READY', reason: 'provider unavailable',
}), '图片翻译 Provider 尚未完成生产验证。');
assert.equal(describeAiMediaReadiness('IMAGE_TRANSLATE', {
  enabled: true, ready: false, reasonCode: 'STORAGE_NOT_READY', reason: 'storage unavailable',
}), '图片翻译需要可用的对象存储；付费 Provider 必须使用公网 HTTPS 的自有 OSS，当前配置不兼容。');
assert.deepEqual(listAiMediaReadinessNotices({
  disabled: true,
  capabilities: {
    workflowEnabled: false,
    workflowReason: 'master_off',
    workflowRevision: 0,
    webMediaEnabled: false,
    webMediaReason: 'pilot_miss',
    webMediaRevision: 'policy-7',
    operations: {
      IMAGE_TO_IMAGE: {
        enabled: false, ready: false, reasonCode: 'SOURCE_LISTING_WEB_MEDIA_DISABLED', reason: 'web disabled',
      },
      FULL_EDIT: {
        enabled: true, ready: false, reasonCode: 'PROVIDER_NOT_READY', reason: 'provider pending',
      },
    },
  },
}), [
  {
    id: 'workflow',
    label: 'AI 媒体工作流',
    message: '全局主开关未开启。',
    revision: 0,
  },
  {
    id: 'web-media',
    label: 'Web 媒体工作台',
    message: '当前账号、店铺或设备不在入口灰度范围内。',
    revision: 'policy-7',
  },
  {
    id: 'FULL_EDIT',
    label: '全图编辑',
    message: 'AI 全图编辑 Provider 尚未完成生产验证。',
  },
]);
assert.deepEqual(listAiMediaReadinessNotices({
  disabled: true,
  capabilities: {
    workflowEnabled: false,
    workflowReason: 'tenant_not_allowed',
    workflowRevision: 12,
    webMediaEnabled: false,
    webMediaReason: 'policy_invalid',
    webMediaRevision: 'invalid-3',
    operations: {},
  },
}), [
  {
    id: 'workflow',
    label: 'AI 媒体工作流',
    message: '当前账号不在媒体工作流灰度名单中。',
    revision: 12,
  },
  {
    id: 'web-media',
    label: 'Web 媒体工作台',
    message: '来源工作流发布策略无效，请由管理员修复。',
    revision: 'invalid-3',
  },
]);
assert.match(listAiMediaReadinessNotices({
  disabled: true,
  capabilities: {
    workflowEnabled: false,
    workflowReason: 'invalid_policy',
    workflowRevision: 13,
    webMediaEnabled: false,
    webMediaReason: 'config_unavailable',
    webMediaRevision: 'unavailable-1',
    operations: {},
  },
})[0].message, /租户策略无效/u);
assert.match(listAiMediaReadinessNotices({
  disabled: true,
  capabilities: {
    workflowEnabled: false,
    workflowReason: 'invalid_policy',
    workflowRevision: 13,
    webMediaEnabled: false,
    webMediaReason: 'config_unavailable',
    webMediaRevision: 'unavailable-1',
    operations: {},
  },
})[1].message, /发布配置暂时不可读取/u);
assert.deepEqual(buildImageTranslationWorkflowRequest({
  sourceAssetId: 'asset-1', sourceLanguage: 'zh', targetLanguage: 'ru',
  domainHint: 'Translate visible copy', terminologies: terms,
  idempotencyKey: intent.idempotencyKey, contextId: 'collect-a',
}), {
  operation: 'IMAGE_TRANSLATE', sourceAssetId: 'asset-1', sourceLanguage: 'zh', targetLanguage: 'ru',
  domainHint: 'Translate visible copy', terminologies: terms,
  idempotencyKey: 'translation-idempotency-1', context: { type: 'collect', id: 'collect-a' },
});
assert.equal(isAiMediaWorkflowInputCurrent(
  { inputs: [{ assetId: 'asset-1', url: '/source.png' }] },
  [{ sourceMediaKey: 'main', role: 'main', sourceUrl: '/source.png', assetId: 'asset-1', assetUrl: '/source.png', mimeType: 'image/png', width: null, height: null }],
), true);
assert.equal(isAiMediaWorkflowInputCurrent(
  { inputs: [{ assetId: 'old-asset', url: '/old.png' }] },
  [{ sourceMediaKey: 'main', role: 'main', sourceUrl: '/source.png', assetId: 'asset-1', assetUrl: '/source.png', mimeType: 'image/png', width: null, height: null }],
), false);
const listingContext = {
  target: {
    type: 'listing-draft', id: 'draft-1', label: 'Draft',
    revision: 4, draftVersion: 2, skuKey: 'sku-red', slotKey: 'sku-hero',
    assignedAssetId: 'asset-1',
  },
};
const listingWorkflow = {
  contextType: 'listing-draft', contextId: 'draft-1',
  contextDraftRevision: 4, contextDraftVersion: 2,
  contextSkuKey: 'sku-red', contextSlotKey: 'sku-hero',
  inputs: [{ assetId: 'asset-1', url: '/source.png' }],
};
assert.equal(isAiMediaWorkflowInputCurrent(
  listingWorkflow,
  [{ sourceMediaKey: 'main', role: 'main', sourceUrl: '/source.png', assetId: 'asset-1', assetUrl: '/source.png', mimeType: 'image/png', width: null, height: null }],
  'snapshot-1',
  listingContext,
), true);
assert.equal(isAiMediaWorkflowInputCurrent(
  { ...listingWorkflow, contextDraftVersion: 1 },
  [{ sourceMediaKey: 'main', role: 'main', sourceUrl: '/source.png', assetId: 'asset-1', assetUrl: '/source.png', mimeType: 'image/png', width: null, height: null }],
  'snapshot-1',
  listingContext,
), false, 'a listing-draft version change must stale a workflow even when the source asset is unchanged');
assert.equal(isAiMediaWorkflowInputCurrent(
  { ...listingWorkflow, contextSlotKey: 'gallery-1' },
  [{ sourceMediaKey: 'main', role: 'main', sourceUrl: '/source.png', assetId: 'asset-1', assetUrl: '/source.png', mimeType: 'image/png', width: null, height: null }],
  'snapshot-1',
  listingContext,
), false, 'a listing-draft slot change must stale a workflow');

console.log('PASS AI media frontend behavior contract');
