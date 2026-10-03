import assert from 'node:assert/strict';
import test from 'node:test';
import { createTranslationFlow } from '../extensions/ss-erp/pages/donor/translation-flow.js';

const receipt = key => ({ data: { state: 'completed', result: { workflowId: 'translation-' + key, operation: 'IMAGE_TRANSLATE', status: 'QUEUED' } } });
function fixture(submit = fields => receipt(fields.sourceMediaKey)) {
  let context = { snapshotId: 'snapshot-1', shopId: 'doth', listingWorkflowId: 'draft-1', draftRevision: 1, draftVersion: 1 };
  let selected = [{ key: 'image-1' }, { key: 'image-7' }];
  const calls = [];
  const flow = createTranslationFlow({ getContext: () => context, getSelectedMedia: () => selected,
    submit: fields => { calls.push(fields); return submit(fields); } });
  return { flow, calls, setContext: value => { context = value; }, setSelected: value => { selected = value; } };
}

test('translation sends only selected media and does not resubmit accepted images', async () => {
  const f = fixture();
  assert.equal((await f.flow.start()).queuedCount, 2);
  await f.flow.start();
  assert.deepEqual(f.calls, [{ listingWorkflowId: 'draft-1', sourceMediaKey: 'image-1' }, { listingWorkflowId: 'draft-1', sourceMediaKey: 'image-7' }]);
});

test('unknown or malformed submission stops the batch and blocks blind retry', async () => {
  for (const response of [null, { data: { state: 'completed' } }, { data: { state: 'completed', result: { workflowId: 'failed', status: 'FAILED' } } }]) {
    const f = fixture(() => response);
    await assert.rejects(f.flow.start(), /回执待核对/u);
    assert.equal(f.flow.state().unknown, true);
    await assert.rejects(f.flow.start(), /待核对/u);
    assert.equal(f.calls.length, 1);
  }
});

test('a definite unsubmitted second image can be retried without repeating the accepted first image', async () => {
  let refused = false;
  const f = fixture(fields => {
    if (fields.sourceMediaKey === 'image-7' && !refused) {
      refused = true; throw Object.assign(new Error('尚未提交'), { outcome: 'NOT_SUBMITTED' });
    }
    return receipt(fields.sourceMediaKey);
  });
  await assert.rejects(f.flow.start(), /尚未提交/u);
  assert.equal(f.flow.state().unknown, false);
  assert.equal((await f.flow.start()).queuedCount, 2);
  assert.deepEqual(f.calls.map(fields => fields.sourceMediaKey), ['image-1', 'image-7', 'image-7']);
});

test('changing the draft while the first request is pending stops the remaining selection', async () => {
  let complete;
  const f = fixture(() => new Promise(resolve => { complete = resolve; }));
  const pending = f.flow.start();
  f.setContext({ snapshotId: 'snapshot-2', shopId: 'other-shop', listingWorkflowId: 'draft-2', draftRevision: 1, draftVersion: 1 });
  complete(receipt('image-1'));
  await assert.rejects(pending, /商品或草稿已变化/u);
  assert.equal(f.calls.length, 1);
});

test('a second click during submission never starts another request', async () => {
  let complete;
  const f = fixture(() => new Promise(resolve => { complete = resolve; }));
  f.setSelected([{ key: 'image-1' }]);
  const pending = f.flow.start();
  assert.equal((await f.flow.start()).busy, true);
  complete(receipt('image-1'));
  await pending;
  assert.equal(f.calls.length, 1);
});

test('empty, duplicated or excessive selections do not submit', async () => {
  for (const selected of [[], [{ key: 'image-1' }, { key: 'image-1' }], Array.from({ length: 6 }, (_, index) => ({ key: 'image-' + index }))]) {
    const f = fixture(); f.setSelected(selected);
    await assert.rejects(f.flow.start());
    assert.deepEqual(f.calls, []);
  }
});
