import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync('extensions/ss-erp/pages/donor/official-attribute-editor.js', 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  let binding = { listingWorkflowId: 'draft', draftRevision: 1, draftVersion: 1 };
  const calls = [], pending = [];
  const context = { workspace: null, loadedToken: '', requestedToken: '', loading: false, loadTask: null,
    edits: new Map(), getEditor: () => ({ binding, category: { catalogRevision: 'catalog' } }),
    getBinding: () => binding, getBusy: () => false, renderState() {}, onChanged() {}, onReset() {}, status() {},
    send: (type, input) => { calls.push({ type, input }); return new Promise(resolve => pending.push(resolve)); } };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  const token ='), source.indexOf('  const bar ='))
    + source.slice(source.indexOf('  async function load('), source.indexOf('  function renderState(')), context);
  return { context, calls, pending, nextBinding(value) { binding = { ...binding, ...value }; },
    resolve() { pending.shift()({ data: { state: 'ready', workspace: { fields: [], values: [], schemaRevision: 'a'.repeat(64) } } }); } };
}
test('a forced analysis schema read waits for the already-running attribute request', async () => {
  const f = fixture(); const first = f.context.load(); await tick();
  let finished = false; const analysisRead = f.context.load(true).then(() => { finished = true; });
  await tick(); assert.equal(finished, false); assert.equal(f.calls.length, 1);
  f.resolve(); await Promise.all([first, analysisRead]);
  assert.equal(f.context.workspace.schemaRevision, 'a'.repeat(64));
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
