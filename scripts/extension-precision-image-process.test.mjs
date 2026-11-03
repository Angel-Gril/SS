import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSkuImageRows, buildImageProcess, partitionImageTasks, describeSuite } from '../extensions/ss-erp/pages/donor/sku-image-workspace.js';
import { createImageProcessPoller, createImageProcessContext } from '../extensions/ss-erp/pages/donor/image-process-poller.js';

const task = (id, status = 'SUCCEEDED') => ({ id, contextSkuKey: 'sku', contextSlotKey: 'same-slot', status, reviewStatus: 'PENDING', outputs: status === 'SUCCEEDED' ? [{ id: `${id}-output`, url: `https://images.example/${id}.png` }] : [] });
const billing = status => ({ quote: { previewHash: 'a'.repeat(64), itemCount: 2, currency: 'CNY', maximumCostMinor: 20 },
  suite: { status, slots: [{ slotKey: 'hero', goal: 'sku_hero', status: 'SUCCEEDED', media: { workflowId: 'current', outputAssetId: 'current-output', reviewStatus: 'PENDING' } },
    { slotKey: 'scene', goal: 'scene', status: status === 'SUCCEEDED' ? 'SUCCEEDED' : status === 'PARTIAL_FAILURE' ? 'FAILED' : 'RUNNING' }] } });

test('current draft assignments remain expanded after the frozen plan is no longer actionable', () => {
  const items = [task('hero'), task('scene'), task('old')];
  for (const item of items.slice(0, 2)) { item.reviewStatus = 'APPROVED'; item.selectedOutputAssetId = item.outputs[0].id; item.application = { state: 'APPLIED', targetId: 'draft' }; }
  const context = { draft: { id: 'draft' }, billing: { state: 'ready', quote: null, suite: null }, history: { items } };
  assert.deepEqual(partitionImageTasks(context.history, context.billing).current.map(x => x.id), ['hero', 'scene']);
  const process = buildImageProcess(context);
  assert.equal(process.status, 'APPLIED'); assert.equal(process.completed, 2);
  assert.equal(process.candidates.length, 2); assert.match(process.message, /已应用.*草稿/u);
  assert.doesNotMatch(process.message, /尚未|待审核/u);
  assert.match(describeSuite(context.billing, context.history), /已应用/u);
});
test('finished suite messaging follows review and persisted application instead of always asking for review', () => {
  const current = billing('SUCCEEDED'); const items = [task('current')];
  current.suite.slots[0].media.reviewStatus = 'APPROVED';
  current.suite.slots[1].media = { workflowId: 'scene', outputAssetId: 'scene-output', reviewStatus: 'APPROVED' };
  items[0].reviewStatus = 'APPROVED'; items.push({ ...task('scene'), reviewStatus: 'APPROVED' });
  assert.match(buildImageProcess({ billing: current, history: { items } }).message, /审核通过.*应用/u);
  items.forEach(x => { x.application = { state: 'APPLIED' }; });
  assert.match(buildImageProcess({ billing: current, history: { items } }).message, /已应用/u);
});
test('a state read failure never claims that the existing task has not started', () => {
  for (const state of ['idle', 'loading', 'error']) {
    const process = buildImageProcess({ billing: { state }, history: null });
    assert.notEqual(process.status, 'NOT_STARTED'); assert.doesNotMatch(process.message, /尚未开始/u);
  }
});

test('the current suite owns the visible tasks; matching old slot names do not replace current workflow identity', () => {
  const history = { items: [task('old-1'), task('old-2'), task('current'), task('other-sku')] };
  history.items.at(-1).contextSkuKey = 'another';
  const selected = partitionImageTasks(history, billing('RUNNING'));
  assert.deepEqual(selected.current.map(item => item.id), ['current']);
  assert.deepEqual(selected.history.map(item => item.id), ['old-1', 'old-2', 'other-sku']);
  const row = buildSkuImageRows({ skus: [{ key: 'sku', label: '颜色' }], media: [], history, billing: billing('RUNNING') })[0];
  assert.deepEqual(row.taskStatusLines.map(line => line.key), ['suite', 'current']);
  assert.deepEqual(row.historyTaskStatusLines.map(line => line.key), ['old-1', 'old-2']);
});
test('without a suite only the newest task is expanded and older tasks stay available', () => {
  const history = { items: [task('new'), ...Array.from({ length: 12 }, (_, i) => task(`old-${i}`))] };
  const row = buildSkuImageRows({ skus: [{ key: 'sku' }], media: [], history })[0];
  assert.deepEqual(row.taskStatusLines.map(item => item.key), ['new']);
  assert.equal(row.historyTaskStatusLines.length, 12);
});
test('the image process reports actual queued/running/partial/success and only current outputs', () => {
  for (const status of ['QUEUED', 'RUNNING', 'PARTIAL_FAILURE', 'SUCCEEDED']) {
    const current = billing(status), process = buildImageProcess({ billing: current, history: { items: [task('old'), task('current')] } });
    assert.equal(process.status, status); assert.equal(process.total, 2);
    assert.deepEqual(process.slots.map(slot => slot.status), current.suite.slots.map(slot => slot.status));
    assert.deepEqual(process.candidates.map(output => output.id), ['current-output']);
    assert.equal(process.completed, status === 'SUCCEEDED' ? 2 : 1);
    assert.match(process.message, status === 'PARTIAL_FAILURE' ? /部分.*失败/u : status === 'SUCCEEDED' ? /审核/u : /排队|处理/u);
  }
});
test('temporary loading keeps the same polling binding and display while failed or changed context drops it', () => {
  const context = createImageProcessContext(), active = { draft: { id: 'draft' }, billing: billing('RUNNING'), history: { items: [task('current')] } };
  const first = context.read('snapshot:shop:draft:v1', active, 'ready');
  const loading = context.read('snapshot:shop:draft:v1', { draft: active.draft, billing: null, history: null }, 'loading');
  assert.equal(loading.key, first.key); assert.equal(loading.status, 'RUNNING'); assert.equal(loading.presentation.billing, active.billing);
  assert.equal(context.read('snapshot:shop:another:v1', { draft: { id: 'another' }, billing: null, history: null }, 'loading').key, '');
  context.read('snapshot:shop:draft:v1', active, 'ready');
  assert.equal(context.read('snapshot:shop:draft:v1', { draft: active.draft, billing: null }, 'error').key, '');
});
test('a late retired quote cannot replace the current image process in the same draft presentation', () => {
  const owner = createImageProcessContext(), first = { draft: { id: 'draft' }, billing: billing('RUNNING') };
  const old = owner.read('snapshot:shop:draft:v1', first, 'ready');
  const second = { ...first, billing: { ...billing('QUEUED'), quote: { ...billing('QUEUED').quote, previewHash: 'b'.repeat(64) } } };
  const current = owner.read('snapshot:shop:draft:v1', second, 'ready');
  assert.notEqual(old.key, current.key);
  assert.equal(owner.read('snapshot:shop:draft:v1', first, 'ready'), current);
  assert.equal(owner.read('snapshot:shop:other:v1', first, 'ready').status, 'RUNNING', 'a separate context retains its own server state');
});

function pollingFixture(maxAttempts = 3) {
  let context = { key: 'draft:plan', status: 'RUNNING' }, reads = 0, exhausted = 0;
  const timers = new Map(); let nextId = 0, error;
  const controller = createImageProcessPoller({ getContext: () => context,
    read: async () => { reads += 1; }, onError: value => { error = value; }, onExhausted: () => { exhausted += 1; },
    maxAttempts, setTimer: fn => { timers.set(++nextId, fn); return nextId; }, clearTimer: id => timers.delete(id) });
  return { controller, timers, setContext: value => { context = value; }, reads: () => reads, exhausted: () => exhausted,
    error: () => error, tick: async () => { const [id, callback] = timers.entries().next().value; timers.delete(id); await callback(); } };
}
test('single read-only polling is bounded, never resets on the same running projection, and stops at terminal status', async () => {
  const fixture = pollingFixture(); fixture.controller.sync(); fixture.controller.sync(); assert.equal(fixture.timers.size, 1);
  await fixture.tick(); fixture.controller.sync(); await fixture.tick(); await fixture.tick();
  assert.equal(fixture.reads(), 3); assert.equal(fixture.timers.size, 0); assert.equal(fixture.exhausted(), 1);
  fixture.controller.sync(); assert.equal(fixture.timers.size, 0);
  fixture.setContext({ key: 'draft:next-plan', status: 'QUEUED' }); fixture.controller.sync(); assert.equal(fixture.timers.size, 1);
  fixture.setContext({ key: 'draft:next-plan', status: 'SUCCEEDED' }); fixture.controller.sync(); assert.equal(fixture.timers.size, 0);
});
test('an old read finishing after context switch does not signal an error or replace the next current task', async () => {
  let context = { key: 'old', status: 'RUNNING' }, release, errors = 0; const callbacks = [];
  const controller = createImageProcessPoller({ getContext: () => context, read: () => new Promise((_resolve, reject) => { release = reject; }),
    onError: () => { errors += 1; }, setTimer: fn => { callbacks.push(fn); return callbacks.length; }, clearTimer: () => {} });
  controller.sync(); const read = callbacks.shift()();
  context = { key: 'new', status: 'RUNNING' }; controller.sync(); release(new Error('late old failure')); await read;
  assert.equal(errors, 0); assert.equal(controller.state().key, 'new'); assert.equal(controller.state().attempts, 0);
  controller.dispose(); assert.equal(controller.state().disposed, true);
});
