import assert from 'node:assert/strict';
import { createLatestLoadCoordinator, createLatestRequestGuard, createMediaMutationLock, buildSaveSourceImagesRequest, executeLockedMediaMutation, executeWithBusyState } from '../apps/web/src/components/ai-media/source-ai-media-state.ts';

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

console.log('PASS AI media frontend behavior contract');
