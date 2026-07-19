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
let loadingStates = [];
const coordinator = createLatestLoadCoordinator({
  onLoadingChange: (loading) => loadingStates.push(loading),
  execute: async (request, isCurrent) => {
    await new Promise((resolve) => waiters.set(request.targetId, resolve));
    if (isCurrent()) applied.push(request.targetId);
  },
});
async function release(targetId) {
  while (!waiters.has(targetId)) await Promise.resolve();
  waiters.get(targetId)();
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
assert.deepEqual(loadingStates, [true, false]);

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
