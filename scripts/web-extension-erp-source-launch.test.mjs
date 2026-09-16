import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const file = 'apps/web/src/lib/extension-erp-source-launch.ts';
const TOKEN = 't'.repeat(43);
const now = Date.parse('2026-09-16T14:00:00.000Z');
const plain = value => JSON.parse(JSON.stringify(value));
const scope = changes => ({
  epoch: 1, snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1', shopId: 'shop-1',
  listingWorkflowId: 'draft-1', draftRevision: 2, draftVersion: 3,
  selectedSkuKeys: ['__ss_erp_product_only__'], availableSourceMediaKeys: ['captured-image-key'],
  sourceMediaKey: 'captured-image-key', preferredSkuKey: '__ss_erp_product_only__',
  editorMode: 'FULL_EDIT', ready: true, dirty: false, ...changes,
});
const ticket = changes => ({ code: 1, data: {
  contractVersion: 'extension-erp-source-launch/v1', provenance: 'ERP_SOURCE',
  apiOrigin: 'https://ss-erp.com', launchToken: TOKEN, expiresAt: new Date(now + 120_000).toISOString(),
  ...changes,
} });
const paired = changes => ({ ok: true, data: {
  state: 'paired', sessionId: 'device-session-1', endpoint: 'https://ss-erp.com',
  scopes: ['listing:review', 'media:execute'], ownerUserId: 'untrusted-page-owner', ...changes,
} });
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
async function settle() { for (let i = 0; i < 12; i += 1) await Promise.resolve(); }
function harness(options = {}) {
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const sandbox = { exports: {}, AbortController, AbortSignal, Date, Error, URL,
    setTimeout: options.setTimeout || setTimeout, clearTimeout: options.clearTimeout || clearTimeout };
  vm.runInNewContext(compiled, sandbox, { filename: file });
  const calls = [];
  let currentMode;
  const launcher = sandbox.exports.createErpSourceImageLauncher({
    getApiOrigin: () => 'https://ss-erp.com', now: () => now,
    async sendToExtension(message, timeoutMs) {
      calls.push({ kind: 'bridge', message: plain(message), timeoutMs });
      if (message.type === 'ss-erp:extension-device-status') return options.status ? options.status() : paired();
      return options.openResult || { ok: true, result: {
        provenance: 'ERP_SOURCE', state: currentMode === 'WORKBENCH' ? 'workbench_opened' : 'editor_opened',
        ...(currentMode === 'WORKBENCH' ? { tabId: 9 } : {}),
      } };
    },
    async createGrant(body, requestOptions) {
      currentMode = body.mode;
      calls.push({ kind: 'grant', body: plain(body), options: requestOptions });
      return options.grant ? options.grant() : ticket();
    },
  });
  launcher.updateScope(scope(options.scope));
  return { launcher, calls, api: sandbox.exports };
}

test('forwards only the one-time ticket after device and account-scoped checks', async () => {
  const { launcher, calls } = harness();
  const result = await launcher.open('FULL_EDIT');
  assert.ok(result, 'the normal launch must return an extension-confirmed result');
  assert.deepEqual(plain(result), { state: 'editor_opened' });
  assert.deepEqual(calls.map(call => call.kind), ['bridge', 'grant', 'bridge']);
  assert.deepEqual(calls[0].message, { type: 'ss-erp:extension-device-status', verify: true });
  assert.deepEqual(calls[1].body, {
    deviceSessionId: 'device-session-1', shopId: 'shop-1', listingWorkflowId: 'draft-1',
    draftRevision: 2, draftVersion: 3, mode: 'FULL_EDIT', sourceMediaKeys: ['captured-image-key'],
    preferredSkuKey: '__ss_erp_product_only__',
  });
  assert.equal(calls[1].options.timeoutMs, 15_000);
  assert.ok(calls[1].options.signal instanceof AbortSignal);
  assert.deepEqual(calls[2].message, { type: 'ss-erp:erp-source-image-open', launchToken: TOKEN });
  assert.equal(calls[2].timeoutMs, 30_000);
  assert.equal(JSON.stringify(result).includes(TOKEN), false);
});

test('workbench requires no source image and editor modes use the explicitly selected capture key', async () => {
  for (const mode of ['WORKBENCH', 'IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT']) {
    const run = harness({ scope: { editorMode: mode === 'WORKBENCH' ? 'FULL_EDIT' : mode,
      sourceMediaKey: mode === 'WORKBENCH' ? null : 'captured-image-key' } });
    await run.launcher.open(mode);
    assert.deepEqual(run.calls[1].body.sourceMediaKeys, mode === 'WORKBENCH' ? [] : ['captured-image-key']);
    assert.equal(run.calls[1].body.mode, mode);
  }
});

test('blocks unsaved media/masks, stale drafts and foreign image/SKU selection before IPC', async () => {
  for (const change of [{ dirty: true }, { ready: false }, { sourceMediaKey: 'foreign-key' },
    { preferredSkuKey: 'foreign-sku' }, { sourceMediaKey: null }, { selectedSkuKeys: [] }]) {
    const run = harness({ scope: change });
    await assert.rejects(run.launcher.open('FULL_EDIT'));
    assert.equal(run.calls.length, 0);
  }
});

test('rejects unpaired, wrong-endpoint and underscoped devices without issuing a ticket', async () => {
  for (const status of [paired({ state: 'unpaired' }), paired({ endpoint: 'https://app.ss-erp.com' }),
    paired({ scopes: ['listing:review'] }), paired({ sessionId: '' }), { ok: false }]) {
    const run = harness({ status: () => status });
    await assert.rejects(run.launcher.open('FULL_EDIT'));
    assert.equal(run.calls.filter(call => call.kind === 'grant').length, 0);
    assert.equal(run.calls.length, 1);
  }
});

test('rejects malformed, expired or foreign tickets before forwarding', async () => {
  for (const value of [ticket({ provenance: 'OTHER' }), ticket({ contractVersion: 'other/v1' }),
    ticket({ launchToken: 'wrong' }), ticket({ apiOrigin: 'https://ss-erp.cn' }),
    ticket({ expiresAt: new Date(now - 1).toISOString() }), { code: 0, msg: TOKEN }]) {
    const run = harness({ grant: () => value });
    await assert.rejects(run.launcher.open('FULL_EDIT'));
    assert.equal(run.calls.length, 2);
  }
});

test('draft A to B to A cancels an old device response or ticket', async () => {
  for (const phase of ['status', 'grant']) {
    const pending = deferred();
    const run = harness({ [phase]: () => pending.promise });
    const attempt = run.launcher.open('FULL_EDIT');
    const rejected = assert.rejects(attempt, { code: 'ERP_SOURCE_IMAGE_CANCELLED' });
    await settle();
    run.launcher.updateScope(scope({ epoch: 2, listingWorkflowId: 'draft-2' }));
    run.launcher.updateScope(scope({ epoch: 3 }));
    await rejected;
    pending.resolve(phase === 'status' ? paired() : ticket());
    await settle();
    assert.equal(run.calls.some(call => call.message?.launchToken), false);
    assert.equal(run.calls.length, phase === 'status' ? 1 : 2);
  }
});

test('double click shares no second device read, ticket or launch', async () => {
  const pending = deferred();
  const run = harness({ status: () => pending.promise });
  const first = run.launcher.open('FULL_EDIT');
  await assert.rejects(run.launcher.open('FULL_EDIT'), { code: 'ERP_SOURCE_IMAGE_BUSY' });
  assert.equal(run.calls.length, 1);
  pending.resolve(paired());
  await first;
  assert.equal(run.calls.filter(call => call.kind === 'grant').length, 1);
  assert.equal(run.calls.filter(call => call.message?.launchToken).length, 1);
});

test('unmount clears and aborts an outstanding grant; late resolution never opens', async () => {
  const pending = deferred();
  const run = harness({ grant: () => pending.promise });
  const attempt = run.launcher.open('FULL_EDIT');
  const rejected = assert.rejects(attempt, { code: 'ERP_SOURCE_IMAGE_CANCELLED' });
  await settle();
  run.launcher.clear();
  await rejected;
  assert.equal(run.calls[1].options.signal.aborted, true);
  pending.resolve(ticket());
  await settle();
  assert.equal(run.calls.length, 2);
  await assert.rejects(run.launcher.open('FULL_EDIT'));
});

test('grant timeout aborts even an uncooperative transport and never retries', async () => {
  const pending = deferred(), timers = [];
  const run = harness({ grant: () => pending.promise,
    setTimeout(fn, ms) { const timer = { fn, ms, cleared: false }; timers.push(timer); return timer; },
    clearTimeout(timer) { timer.cleared = true; },
  });
  const attempt = run.launcher.open('FULL_EDIT');
  const rejected = assert.rejects(attempt, { code: 'ERP_SOURCE_IMAGE_TIMEOUT' });
  await settle();
  const timer = timers.find(value => value.ms === 15_000 && !value.cleared);
  assert.ok(timer);
  timer.fn();
  await rejected;
  assert.equal(run.calls[1].options.signal.aborted, true);
  pending.resolve(ticket());
  await settle();
  assert.equal(run.calls.length, 2);
  assert.equal(run.launcher.isBusy(), false);
});

test('accepts workbench choice without a tab but never treats a missing editor result as success', async () => {
  const choice = harness({ openResult: { ok: true, result: { provenance: 'ERP_SOURCE', state: 'choice_required' } } });
  assert.deepEqual(plain(await choice.launcher.open('WORKBENCH')), { state: 'choice_required' });
  for (const result of [{ ok: true }, { ok: true, data: { state: 'editor_opened' } },
    { ok: true, result: { provenance: 'ERP_SOURCE', state: 'workbench_opened' } }]) {
    const run = harness({ openResult: result });
    await assert.rejects(run.launcher.open('FULL_EDIT'), { code: 'ERP_SOURCE_IMAGE_OPEN_UNCONFIRMED' });
  }
});

test('sanitizes transport errors without returning a ticket or arbitrary message', async () => {
  const run = harness({ grant: () => { throw new Error(TOKEN); } });
  await assert.rejects(run.launcher.open('FULL_EDIT'), error => !error.message.includes(TOKEN));
});
