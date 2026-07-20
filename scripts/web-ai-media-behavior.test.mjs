import assert from 'node:assert/strict';
import { createLatestLoadCoordinator, createLatestRequestGuard, createMediaMutationLock, buildSaveSourceImagesRequest, executeLockedMediaMutation, executeWithBusyState } from '../apps/web/src/components/ai-media/source-ai-media-state.ts';
import {
  AI_MEDIA_INTENT_TTL_MS,
  buildImageTranslationWorkflowRequest,
  clearWorkflowSubmissionIntent,
  describeAiMediaReadiness,
  isAiMediaWorkflowInputCurrent,
  isDefinitiveWorkflowSubmissionFailure,
  loadWorkflowSubmissionIntent,
  normalizeImageTranslationTerminologies,
  resolveWorkflowSubmissionIntent,
  saveWorkflowSubmissionIntent,
} from '../apps/web/src/lib/ai-media-workflow.ts';

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
}), '图片翻译需要可用的 OSS 或本地存储，当前存储配置不兼容。');
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

console.log('PASS AI media frontend behavior contract');
