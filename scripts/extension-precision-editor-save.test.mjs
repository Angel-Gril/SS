import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

function fixture({ failure, refreshFailure, recovery = false, draftRecovery = false } = {}) {
  const source = readFileSync('extensions/ss-erp/pages/precision-workbench.js', 'utf8');
  const body = source.slice(source.indexOf('async function saveEditor('), source.indexOf('function resumeAfterConfirmedStep('));
  const binding = { snapshotId: 'snapshot', supplyGoodsId: 'goods', shopId: 'shop', listingWorkflowId: 'draft', draftRevision: 1, draftVersion: 1 };
  const messages = [], resumes = [], restores = [];
  const context = {
    editor: { binding }, saveBusy: false, lastSave: recovery ? { binding, listingWorkflowId: 'draft', action: 'ATTRIBUTES', value: {}, operationKey: 'original' } : null,
    crypto: { randomUUID: () => 'key' }, replaySave: {}, render() {}, currentEditorBinding: () => binding,
    currentEditorForPublish: () => ({}), command: async () => { if (failure) throw failure; return { data: { editor: { binding } } }; },
    acceptEditor() {}, attributes: { afterSave: async () => { if (refreshFailure) throw Error('read failed'); } },
    attributeSuggestionContext: () => 'current', copyEditor: { afterSave() {} }, editorState: {},
    status: (message, kind) => messages.push({ message, kind }), log() {}, report() {},
    session: { needsRecovery: () => draftRecovery },
    preparation: { state: () => ({ status: recovery || draftRecovery ? 'RECOVERY_REQUIRED' : 'WAITING_INPUT', shopId: 'shop', stepId: 'attributes' }), markRecovered: () => restores.push(true) },
    resumeAfterConfirmedStep: action => resumes.push(action),
  };
  vm.createContext(context);
  vm.runInContext(body + ';globalThis.save=saveEditor;', context);
  return { context, messages, resumes, restores };
}

test('a rejected mutation cannot advance the preparation queue', async () => {
  const f = fixture({ failure: Object.assign(Error('rejected'), { outcome: 'NOT_SUBMITTED' }) });
  await assert.rejects(f.context.save('ATTRIBUTES', {}), /rejected/);
  assert.deepEqual(f.resumes, []);
  assert.equal(f.context.lastSave, null);
});
test('acknowledged attribute save keeps a failed readback warning without inventing an unknown mutation', async () => {
  const f = fixture({ refreshFailure: true });
  await f.context.save('ATTRIBUTES', {});
  assert.equal(f.context.lastSave, null);
  assert.equal(f.messages.at(-1).kind, 'warn');
  assert.match(f.messages.at(-1).message, /已保存.*刷新/);
  assert.deepEqual(f.resumes, ['ATTRIBUTES']);
});
test('an unrelated save cannot clear unresolved draft creation recovery', async () => {
  const f = fixture({ draftRecovery: true });
  await f.context.save('ATTRIBUTES', {});
  assert.deepEqual(f.restores, []);
});
test('only an acknowledged original save replay clears its preparation recovery', async () => {
  const f = fixture({ recovery: true });
  await f.context.save('ATTRIBUTES', {}, true);
  assert.deepEqual(f.restores, [true]);
  assert.deepEqual(f.resumes, ['ATTRIBUTES']);
});
