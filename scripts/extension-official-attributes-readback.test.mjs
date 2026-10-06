import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync('extensions/ss-erp/pages/donor/official-attribute-editor.js', 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  let binding = { listingWorkflowId: 'draft', draftRevision: 1, draftVersion: 1 };
  let category = { categoryId: 1, typeId: 2, catalogRevision: 'catalog' };
  const calls = [], pending = [];
  const context = { workspace: null, loadedToken: '', requestedToken: '', loading: false, loadTask: null,
    edits: new Map(), getEditor: () => ({ binding, category }),
    getBinding: () => binding, getBusy: () => false, renderState() {}, onChanged() {}, onReset() {}, status() {},
    send: (type, input) => { calls.push({ type, input }); return new Promise(resolve => pending.push(resolve)); } };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  const token ='), source.indexOf('  const bar ='))
    + source.slice(source.indexOf('  async function load('), source.indexOf('  function renderState(')), context);
  return { context, calls, pending, nextBinding(value) { binding = { ...binding, ...value }; }, nextCategory(value) { category = value; },
    resolve() { pending.shift()({ data: { state: 'ready', workspace: { fields: [], values: [], schemaRevision: 'a'.repeat(64) } } }); } };
}
test('a forced analysis schema read waits for the already-running attribute request', async () => {
  const f = fixture(); const first = f.context.load(); await tick();
  let finished = false; const analysisRead = f.context.load(true).then(() => { finished = true; });
  await tick(); assert.equal(finished, false); assert.equal(f.calls.length, 1);
  f.resolve(); await Promise.all([first, analysisRead]);
  assert.equal(f.context.workspace.schemaRevision, 'a'.repeat(64));
});

test('a superseded attribute response does not fail the waiting new-revision analysis read', async () => {
  const f = fixture(); const prior = f.context.load(); await tick();
  f.nextBinding({ draftRevision: 2, draftVersion: 2 });
  const next = f.context.load(true);
  const results = Promise.allSettled([prior, next]);
  f.resolve(); await tick();
  assert.equal(f.calls.length, 2, 'read the current revision after the superseded request completes');
  f.resolve();
  assert.deepEqual((await results).map(result => result.status), ['fulfilled', 'fulfilled']);
  assert.equal(f.context.loadedToken, vm.runInContext('token()', f.context));
});

test('equivalent category DTO property order does not invalidate official fields', async () => {
  const f = fixture(); const prior = f.context.load(); await tick();
  f.nextCategory({ catalogRevision: 'catalog', typeId: 2, categoryId: 1 });
  f.resolve(); await prior;
  assert.equal(f.context.loadedToken, vm.runInContext('token()', f.context));
  assert.ok(f.context.workspace);
});
test('shared failed attribute read rejects both callers and explicit refresh can recover', async () => {
  const f = fixture(); const first = f.context.load(); await tick();
  const next = f.context.load(true);
  f.pending.shift()({ data: { state: 'unavailable' } });
  const results = await Promise.allSettled([first, next]);
  assert.deepEqual(results.map(result => result.status), ['rejected', 'rejected']);
  const recovered = f.context.load(true); await tick(); f.resolve(); await recovered;
  assert.equal(f.calls.length, 2); assert.equal(f.context.loading, false);
});
