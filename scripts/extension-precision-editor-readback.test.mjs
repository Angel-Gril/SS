import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync('extensions/ss-erp/pages/precision-workbench.js', 'utf8');
const binding = { snapshotId: 'snapshot', supplyGoodsId: 'goods', shopId: 'shop', listingWorkflowId: 'draft', draftRevision: 1, draftVersion: 1 };
const details = current => ({ contractVersion: 'extension-listing-editor/v1', binding: { ...current }, selectedSkuKeys: ['sku'] });
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(run) {
  let current = { ...binding };
  const calls = [], errors = [], statuses = [];
  const context = {
    editor: details(current), editorLoadKey: '', editorReadFailureKey: '', editorLoading: false, editorReadTask: null,
    saveBusy: false, lastSave: null, projection: { busy: false, handoff: current },
    session: { isActive: () => false, needsRecovery: () => false },
    listing: () => ({ id: current.listingWorkflowId, shopId: current.shopId, revision: current.draftRevision, draftVersion: current.draftVersion }),
    currentEditorBinding: () => ({ ...current }), currentEditorForPublish: () => ({}),
    editorIdentity: data => JSON.stringify(['snapshotId', 'supplyGoodsId', 'shopId', 'listingWorkflowId'].map(key => data?.binding?.[key])),
    unsavedListingFields: new Set(), fieldSavedByAction: () => false, currency: {}, editorState: {}, replaySave: {},
    report: error => errors.push(error), status: (message, kind) => statuses.push({ message, kind }), log() {},
    crypto: { randomUUID: () => 'operation' }, attributes: { afterSave: async () => {} }, copyEditor: { afterSave() {} },
    resumeAfterConfirmedStep() {}, preparation: null, imageMode: 'ai-suite',
    refreshMediaState: async () => {}, readTranslationAvailability: async () => {}, recoverPreparation: async () => {},
    render() {}, command: async (type, payload) => { calls.push({ type, payload }); return run(type, payload, f); },
  };
  vm.createContext(context);
  const start = source.includes('function editorBindingKey(') ? source.indexOf('function editorBindingKey(') : source.indexOf('function acceptEditor(');
  vm.runInContext(source.slice(start, source.indexOf('function resumeAfterConfirmedStep(')), context);
  const renderStart = source.indexOf('function render() {');
  const bindingStart = source.indexOf('  const binding = ', renderStart);
  const bindingEnd = source.indexOf('\n', bindingStart);
  const autoStart = source.indexOf('  if (binding && binding !== editorLoadKey', renderStart);
  const autoEnd = source.indexOf('  const registrationContext', autoStart);
  const auto = `const draft=listing();${source.slice(bindingStart, bindingEnd)}\n${source.slice(autoStart, autoEnd)}`;
  const refreshStart = source.indexOf("trusted('erp-refresh-btn', async () => {");
  const refreshEnd = source.indexOf('\n});', refreshStart);
  context.trusted = (id, action) => { context.refreshEditor = action; };
  vm.runInContext(source.slice(refreshStart, refreshEnd + 4), context);
  const f = { context, calls, errors, statuses,
    setBinding(value) { current = { ...value }; context.projection.handoff = current; },
    current: () => current,
    auto() { vm.runInContext(`{${auto}}`, context); },
  };
  return f;
}

test('confirmed save advances its authoritative revision while the projection still has the prior version', async () => {
  const f = fixture(async type => ({ data: { editor: details({ ...binding, draftRevision: type === 'EDITOR_SAVE' ? 2 : 1, draftVersion: type === 'EDITOR_SAVE' ? 2 : 1 }) } }));
  await f.context.saveEditor('PRICING', {});
  assert.equal(f.context.editor.binding.draftRevision, 2);
  assert.equal(f.context.lastSave, null);
  assert.equal(f.calls.filter(call => call.type === 'EDITOR_SAVE').length, 1);
});

test('late read cannot replace current revision or selected SKU projection', async () => {
  const f = fixture(async () => ({ data: { editor: details(binding) } }));
  f.setBinding({ ...binding, draftRevision: 2, draftVersion: 2 });
  const before = f.context.editor;
  await assert.rejects(f.context.loadEditor(), /草稿详情/);
  assert.equal(f.context.editor, before);
});

test('failed read and its final projection renders make exactly one automatic attempt', async () => {
  const f = fixture(async () => { setImmediate(() => f.auto()); throw Object.assign(Error('device denied'), { outcome: 'NOT_SUBMITTED' }); });
  f.auto(); await tick(); await tick();
  for (let index = 0; index < 8; index++) { f.auto(); await tick(); }
  assert.equal(f.calls.length, 1);
  assert.equal(f.errors.length, 1);
});

test('explicit refresh recovers the same binding after a failed read and awaits the editor before success', async () => {
  let denied = true;
  const f = fixture(async type => {
    if (type === 'REFRESH') { denied = false; return { ok: true }; }
    if (denied) throw Object.assign(Error('device denied'), { outcome: 'NOT_SUBMITTED' });
    return { data: { editor: details(binding) } };
  });
  f.auto(); await tick();
  await f.context.refreshEditor();
  assert.equal(f.context.editorReadFailureKey, '');
  assert.deepEqual(f.calls.map(call => call.type), ['EDITOR_READ', 'REFRESH', 'EDITOR_READ']);
  assert.equal(f.statuses.at(-1).kind, 'ok');
});

test('only the structured context error refreshes the original identity and permits a newer revision read', async () => {
  const f = fixture(async (type, payload) => {
    if (type === 'REFRESH') { f.setBinding({ ...binding, draftRevision: 2, draftVersion: 2 }); return { ok: true }; }
    if (payload.binding.draftRevision === 1) throw Object.assign(Error('context stale'), { code: 'EDITOR_CONTEXT_REFRESH_REQUIRED', outcome: 'NOT_SUBMITTED' });
    return { data: { editor: details(payload.binding) } };
  });
  await f.context.loadEditor();
  assert.deepEqual(f.calls.map(call => call.type), ['EDITOR_READ', 'REFRESH', 'EDITOR_READ']);
  assert.equal(f.calls.at(-1).payload.binding.draftRevision, 2);
  assert.equal(f.context.editor.binding.draftRevision, 2);
});

test('translated message text cannot authorize a refresh or a second read', async () => {
  const f = fixture(async () => { throw Object.assign(Error('编辑上下文暂不可用'), { code: 'DEVICE_DENIED', outcome: 'NOT_SUBMITTED' }); });
  await assert.rejects(f.context.loadEditor(), /编辑上下文/);
  assert.deepEqual(f.calls.map(call => call.type), ['EDITOR_READ']);
});

test('failed refreshed read suppresses subsequent renders of the last attempted revision', async () => {
  const f = fixture(async type => {
    if (type === 'REFRESH') { f.setBinding({ ...binding, draftRevision: 2, draftVersion: 2 }); return { ok: true }; }
    throw Object.assign(Error('stale'), { code: 'EDITOR_CONTEXT_REFRESH_REQUIRED', outcome: 'NOT_SUBMITTED' });
  });
  await assert.rejects(f.context.loadEditor(), /stale/);
  for (let index = 0; index < 4; index++) { f.auto(); await tick(); }
  assert.deepEqual(f.calls.map(call => call.type), ['EDITOR_READ', 'REFRESH', 'EDITOR_READ']);
  assert.deepEqual(JSON.parse(f.context.editorReadFailureKey), Object.values(f.current()));
});

test('refresh never rebinds the original read to another draft or source', async () => {
  for (const field of ['snapshotId', 'supplyGoodsId', 'shopId', 'listingWorkflowId']) {
    const f = fixture(async type => {
      if (type === 'REFRESH') { f.setBinding({ ...binding, [field]: 'other' }); return { ok: true }; }
      throw Object.assign(Error('stale'), { code: 'EDITOR_CONTEXT_REFRESH_REQUIRED', outcome: 'NOT_SUBMITTED' });
    });
    await assert.rejects(f.context.loadEditor(), /stale/);
    assert.deepEqual(f.calls.map(call => call.type), ['EDITOR_READ', 'REFRESH'], field);
  }
});

test('failed attempt key includes all six binding fields and lets a new source identity read once', async () => {
  const f = fixture(async () => { throw Error('unavailable'); });
  f.auto(); await tick();
  assert.deepEqual(JSON.parse(f.context.editorReadFailureKey), Object.values(binding));
  f.setBinding({ ...binding, snapshotId: 'new-snapshot' });
  f.auto(); await tick(); f.auto(); await tick();
  assert.equal(f.calls.length, 2);
  assert.deepEqual(JSON.parse(f.context.editorReadFailureKey), Object.values(f.current()));
});

test('unknown mutation keeps its exact original operation and never refreshes or retries it', async () => {
  const f = fixture(async () => { throw Object.assign(Error('lost ack'), { outcome: 'UNKNOWN_OUTCOME' }); });
  await assert.rejects(f.context.saveEditor('PRICING', {}), /lost ack/);
  assert.equal(f.context.lastSave.operationKey, 'precision-editor:operation');
  assert.deepEqual(f.calls.map(call => call.type), ['EDITOR_SAVE']);
  await assert.rejects(f.context.saveEditor('PRICING', {}), /尚待核对/);
  assert.equal(f.calls.length, 1);
});
