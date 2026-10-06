import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import vm from 'node:vm';

const path = 'extensions/ss-erp/pages/precision-workbench.js';
const source = process.argv.includes('--baseline') ? execFileSync('git', ['show', `HEAD:${path}`], { encoding: 'utf8' }) : readFileSync(path, 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture({ draft = null, state = { status: 'IDLE' }, operation = null } = {}) {
  const calls = [];
  let listener;
  const context = {
    selectedShopId: 'shop', lastSave: null,
    session: { needsRecovery: () => false },
    listing: () => draft,
    currentEditorForPublish: () => null,
    ensureCurrentDraft: async () => { calls.push('create'); draft = { id: 'draft' }; },
    loadEditor: async () => { calls.push('editor'); }, attributes: { load: async () => { calls.push('schema'); } },
    preparation: { isRunning: () => false, state: () => state, start: async shops => { calls.push(['flow', ...shops]); },
      continue: async () => { calls.push('continue'); } },
    preparationAnalysis: { current: () => false, state: () => ({ operation }), open: async () => { calls.push('open-candidate'); } },
    render() {}, report(error) { throw error; },
    analysisOpen: { disabled: false, addEventListener(type, callback) { listener = callback; } },
  };
  vm.createContext(context);
  const helper = source.indexOf('async function startProductPreparation(');
  if (helper >= 0) vm.runInContext(source.slice(helper, source.indexOf('async function recoverPreparation(', helper)), context);
  vm.runInContext(source.slice(source.indexOf('async function continuePreparation('), source.indexOf('\n', source.indexOf('async function continuePreparation('))), context);
  vm.runInContext(source.slice(source.indexOf("analysisOpen.addEventListener('click'"), source.indexOf('\n', source.indexOf("analysisOpen.addEventListener('click'"))), context);
  return { calls, click: async () => { listener({ isTrusted: true }); await tick(); } };
}
test('AI entry without a draft starts the same capture/SKU/category preparation flow', async () => {
  const f = fixture(); await f.click();
  assert.deepEqual(f.calls, ['create', ['flow', 'shop']]);
});
test('AI entry resumes the waiting current shop instead of opening an unprepared analysis modal', async () => {
  const f = fixture({ draft: { id: 'draft' }, state: { status: 'WAITING_INPUT', shopId: 'shop' } });
  await f.click(); assert.deepEqual(f.calls, ['editor', 'continue']);
});
test('AI entry with an unresolved analysis only opens the original candidate/recovery view', async () => {
  const f = fixture({ draft: { id: 'draft' }, operation: { operationKey: 'original' } });
  await f.click(); assert.deepEqual(f.calls, ['editor', 'editor', 'schema', 'open-candidate']);
});
