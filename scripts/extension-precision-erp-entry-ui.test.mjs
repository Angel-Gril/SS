import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';

const modulePath = 'extensions/ss-erp/pages/donor/erp-entry.js';
const source = existsSync(modulePath) ? readFileSync(modulePath, 'utf8').replace('export function', 'function') : '';
function harness({ busy = false, loading = false } = {}) {
  const scope = {}, calls = [], projection = { busy: loading };
  vm.runInNewContext(source + '\nthis.create = typeof createPrecisionErpEntry === "function" ? createPrecisionErpEntry : undefined;', scope);
  assert.equal(typeof scope.create, 'function', 'the actual precision entry consumer is required');
  const handler = scope.create({ getProjection: () => projection, isBusy: () => busy,
    session: { pinDraft(context) { calls.push(['pin', context.workflowId]); if (context.workflowId !== 'target') throw Error('ERP 草稿变化'); return { id: 'target' }; } },
    applySelection: context => { calls.push(['select', context.shopId, context.skuKey]); },
    acknowledge: fields => { calls.push(['ack', fields.accepted]); return Promise.resolve(); },
    report: error => { calls.push(['error', error.message]); },
  });
  return { handler, calls, projection };
}
const entry = { requestId: 'erp-entry-1', context: { contractVersion: 'extension-byok-workbench-launch-context/v1',
  workflowId: 'target', shopId: 'shop', skuKey: 'sku', draftRevision: 3, draftVersion: 2 } };

test('ERP precision UI pins the exact workflow and selects its shop/SKU before acknowledging', async () => {
  const state = harness();
  await state.handler.accept(entry);
  assert.deepEqual(state.calls, [['pin', 'target'], ['select', 'shop', 'sku'], ['ack', true]]);
});
test('a refresh of the same entry does not reset unsaved editor state or repin an old revision', async () => {
  const state = harness();
  await state.handler.accept(entry);
  await state.handler.accept({ ...entry, context: { ...entry.context, draftRevision: 4 } });
  assert.equal(state.calls.length, 3);
});
test('a fresh iframe consumer can reclaim the same entry from the current projection', async () => {
  const state = harness();
  await state.handler.accept({ ...entry, context: { ...entry.context, draftRevision: 4 } });
  assert.equal(state.calls.at(-1)[1], true);
});
test('ERP entry refuses to replace unsaved or unresolved work without pinning a different draft', async () => {
  const state = harness({ busy: true });
  await state.handler.accept(entry);
  assert.equal(state.calls.some(call => call[0] === 'pin' || call[0] === 'select'), false);
  assert.deepEqual(state.calls.at(-1), ['ack', false]);
});
test('loading projection waits for its readback instead of declining or acknowledging early', async () => {
  const state = harness({ loading: true });
  await state.handler.accept(entry);
  assert.equal(state.calls.length, 0);
  state.projection.busy = false;
  await state.handler.accept(entry);
  assert.deepEqual(state.calls.at(-1), ['ack', true]);
});
test('a changed draft readback returns a negative acknowledgement without selecting another draft', async () => {
  const state = harness();
  await state.handler.accept({ ...entry, context: { ...entry.context, workflowId: 'other' } });
  assert.equal(state.calls.some(call => call[0] === 'select'), false);
  assert.deepEqual(state.calls.at(-1), ['ack', false]);
});
