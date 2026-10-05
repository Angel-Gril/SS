import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

class Element {
  constructor(tag) {
    this.tag = tag; this.children = []; this.listeners = new Map(); this.dataset = {};
    this.hidden = false; this.disabled = false; this.textContent = '';
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute() {}
  addEventListener(type, handler) { this.listeners.set(type, handler); }
  querySelectorAll(selector) {
    assert.equal(selector, 'input:checked');
    return walk(this).filter((node) => node.tag === 'input' && node.checked);
  }
  click() { this.listeners.get('click')?.({ isTrusted: true }); }
}
function walk(element) { return [element, ...element.children.flatMap(walk)]; }
const originalBinding = { snapshotId: 'snapshot', supplyGoodsId: 'goods', shopId: 'shop',
  listingWorkflowId: 'draft', draftRevision: 1, draftVersion: 1 };
function fixture() {
  const context = { document: { createElement: (tag) => new Element(tag) } };
  vm.createContext(context);
  const source = readFileSync('extensions/ss-erp/pages/donor/attribute-suggestions.js', 'utf8');
  vm.runInContext(source.replace('export function', 'function') + ';globalThis.create=createAttributeSuggestions;', context);
  const root = new Element('root'), requests = [], errors = [], applications = [], saves = [], manual = [];
  let binding = { ...originalBinding }, dirty = false, busy = false, applyHandler = async () => {};
  const ui = context.create({ root, command: (...args) => new Promise((resolve, reject) => requests.push({ args, resolve, reject })),
    getBinding: () => binding, getBusy: () => busy, hasUnsavedAttributes: () => dirty, getSkuLabel: (key) => key,
    onApply: async (value) => { applications.push(value); await applyHandler(); }, onSaved: () => saves.push(binding),
    onManual: () => manual.push(binding),
    report: (error) => errors.push(error.message),
  });
  const byId = (id) => walk(root).find((node) => node.id === id);
  return { ui, requests, errors, applications, saves, manual, root, byId,
    setBinding(value) { binding = value; }, setDirty(value) { dirty = value; }, setBusy(value) { busy = value; },
    setApply(handler) { applyHandler = handler; }, headings: () => walk(root).filter((node) => node.tag === 'strong').map((node) => node.textContent),
  };
}
function response(label) {
  return { data: { suggestions: { state: 'ready', workspace: { schemaRevision: 'a'.repeat(64) }, suggestions: [{
    attributeId: 20, attributeName: label, candidateId: label, candidateHash: 'b'.repeat(64), schemaRevision: 'a'.repeat(64),
    rows: [{ skuKey: null, value: 'Красный', sourceValue: '红色', source: 'SOURCE', reviewed: false,
      unresolvedValues: [], evidence: [{ path: 'capture.skus.0.color', value: '红色', source: 'SOURCE_STANDARD' }] }],
  }], blockedSuggestions: [] } } };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
async function ready(fixture, label = 'current') {
  const opening = fixture.ui.open(); fixture.requests.at(-1).resolve(response(label)); await opening;
}

test('late source/shop candidate responses cannot append to the new dialog or clear its loading state', async () => {
  const f = fixture();
  const older = f.ui.open();
  f.setBinding({ ...originalBinding, shopId: 'other-shop', listingWorkflowId: 'other-draft' });
  const latest = f.ui.open();
  f.requests[0].resolve(response('older')); await older;
  assert.equal(f.byId('precision-attribute-suggestions-apply').disabled, true);
  assert.deepEqual(f.headings(), []);
  f.requests[1].resolve(response('latest')); await latest;
  assert.deepEqual(f.headings(), ['latest']);
  assert.equal(f.byId('precision-attribute-suggestions-apply').disabled, false);
  assert.deepEqual(f.errors, []);
});

test('an older failure cannot replace a newer candidate preview', async () => {
  const f = fixture();
  const older = f.ui.open();
  f.setBinding({ ...originalBinding, snapshotId: 'new-snapshot' });
  const latest = f.ui.open(); f.requests[1].resolve(response('latest')); await latest;
  f.requests[0].reject(new Error('old-network-error')); await older;
  assert.deepEqual(f.headings(), ['latest']);
  assert.match(f.byId('precision-attribute-suggestions-state').textContent, /已匹配/);
  assert.deepEqual(f.errors, []);
});

test('a source or draft change closes the old candidates and refuses its late reply', async () => {
  const f = fixture(); const opening = f.ui.open();
  f.setBinding({ ...originalBinding, draftVersion: 2, draftRevision: 2 }); f.ui.sync();
  assert.equal(f.byId('precision-attribute-suggestions-modal').hidden, true);
  assert.match(f.errors[0], /已变化/);
  f.requests[0].resolve(response('old')); await opening;
  assert.deepEqual(f.headings(), []);
  assert.equal(f.applications.length, 0);
});

test('unconfirmed manual attribute edits block opening and application without being cleared', async () => {
  const f = fixture(); f.setDirty(true);
  const opening = f.ui.open();
  if (f.requests.length) f.requests[0].resolve(response('must-not-read'));
  await assert.rejects(opening, /属性.*保存/);
  assert.equal(f.requests.length, 0);
  f.setDirty(false); await ready(f); f.setDirty(true); f.ui.sync();
  assert.equal(f.byId('precision-attribute-suggestions-apply').disabled, true);
  f.byId('precision-attribute-suggestions-apply').click(); await flush();
  assert.equal(f.applications.length, 0); assert.equal(f.saves.length, 0);
});

test('application rechecks manual edits and exact binding at the dispatch boundary', async () => {
  for (const change of ['dirty', 'binding']) {
    const f = fixture(); await ready(f);
    f.byId('precision-attribute-suggestions-apply').click();
    if (change === 'dirty') f.setDirty(true);
    else f.setBinding({ ...originalBinding, draftRevision: 2, draftVersion: 2 });
    await flush();
    assert.equal(f.applications.length, 0, change); assert.equal(f.saves.length, 0, change);
  }
});

test('an acknowledged apply accepts its own new revision and invokes the completion callback once', async () => {
  const f = fixture(); await ready(f);
  f.setApply(async () => { f.setBinding({ ...originalBinding, draftRevision: 2, draftVersion: 2 }); f.ui.sync(); });
  f.byId('precision-attribute-suggestions-apply').click(); await flush();
  assert.equal(f.applications.length, 1); assert.equal(f.saves.length, 1);
  assert.equal(f.byId('precision-attribute-suggestions-modal').hidden, true);
  assert.deepEqual(f.errors, []);
  assert.deepEqual(Object.keys(f.applications[0].candidates[0]).sort(), ['attributeId', 'candidateHash', 'candidateId', 'schemaRevision']);
});

test('a pending apply that finishes after switching drafts never marks the new draft reviewed', async () => {
  const f = fixture(); await ready(f);
  let complete;
  f.setApply(() => new Promise((resolve) => { complete = resolve; }));
  f.byId('precision-attribute-suggestions-apply').click(); await flush();
  f.setBinding({ ...originalBinding, shopId: 'other-shop', listingWorkflowId: 'other-draft' }); f.ui.sync();
  complete(); await flush();
  assert.equal(f.applications.length, 1); assert.equal(f.saves.length, 0);
  assert.equal(f.byId('precision-attribute-suggestions-modal').hidden, true);
});

test('an unknown apply retains candidate context and does not acknowledge or automatically resubmit', async () => {
  const f = fixture(); await ready(f);
  f.setApply(async () => { throw new Error('核对原请求'); });
  f.byId('precision-attribute-suggestions-apply').click(); await flush();
  assert.equal(f.applications.length, 1); assert.equal(f.saves.length, 0);
  assert.match(f.byId('precision-attribute-suggestions-state').textContent, /核对原请求/);
  assert.equal(f.byId('precision-attribute-suggestions-modal').hidden, false);
});

test('closing an in-flight preview prevents that response from reopening or rendering candidates', async () => {
  const f = fixture(); const opening = f.ui.open();
  f.byId('precision-attribute-suggestions-close').click();
  f.requests[0].resolve(response('closed')); await opening;
  assert.equal(f.byId('precision-attribute-suggestions-modal').hidden, true);
  assert.deepEqual(f.headings(), []);
});

test('empty candidates allow explicit manual continuation without a mutation or fake approval', async () => {
  const f = fixture(), opening = f.ui.open();
  const empty = response('unused'); empty.data.suggestions.suggestions = [];
  f.requests[0].resolve(empty); await opening;
  const button = f.byId('precision-attribute-suggestions-manual');
  assert.ok(button); assert.equal(button.disabled, false);
  button.click(); await flush();
  assert.equal(f.manual.length, 1); assert.equal(f.applications.length, 0); assert.equal(f.saves.length, 0);
  assert.equal(f.byId('precision-attribute-suggestions-modal').hidden, true);
});

test('manual continuation never acknowledges stale candidates or unsaved edits', async () => {
  const f = fixture(); await ready(f);
  const button = f.byId('precision-attribute-suggestions-manual');
  assert.ok(button);
  f.setDirty(true); button.click(); assert.equal(f.manual.length, 0);
  f.setDirty(false); f.setBinding({ ...originalBinding, shopId: 'other' }); button.click();
  assert.equal(f.manual.length, 0);
});
