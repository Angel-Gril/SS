import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const root = 'extensions/ss-erp';
const contractContext = {};
vm.runInNewContext(readFileSync(`${root}/shared/donor-workbench/workspace-contract.js`, 'utf8'), contractContext);
const contract = contractContext.SS_ERP_DONOR_WORKBENCH_CONTRACT;
const rawKey = 'media:image|product_main|0|https://cbu01.alicdn.com/img/ibank/example.jpg';
const expectedAlias = 'media-key-sha256:' + createHash('sha256').update(rawKey).digest('hex');
const helperPath = `${root}/pages/donor/hosted-reference-selection.js`;
const helper = existsSync(helperPath) ? await import('../' + helperPath) : {};

function producer(options = {}) {
  const source = readFileSync(`${root}/pages/precision-workbench.js`, 'utf8');
  const begin = source.indexOf('async function suiteCommand(');
  const end = source.indexOf("trusted('precision-assign'", begin);
  assert.ok(begin >= 0 && end > begin);
  const commands = [];
  const context = { Set, Map, Array, Error, crypto: webcrypto,
    compileHostedReferenceSelection: options.compile || helper.compileHostedReferenceSelection,
    listing: () => ({ id: 'draft' }), promptLockState: () => null,
    currentEditorBinding: options.binding || (() => ({ snapshotId: 'snapshot', shopId: 'shop', listingWorkflowId: 'draft', draftRevision: 1, draftVersion: 1 })),
    promptText: { value: '浅灰背景，柔和自然光' }, negativeText: { value: '' },
    Prompt: { compileCreativeBrief: ({ prompt }) => ({ prompt }) },
    eligibleReferenceMedia: () => [{ key: rawKey }], referenceKeys: new Set([rawKey]),
    visualJsonError: '', imageMode: options.imageMode || 'ai-suite', planSubmissionBusy: false, promptPlanLocks: new Map(), pollingAttempts: 0,
    render() {}, log() {}, renderPromptState() {}, refreshConfirmedMedia: async () => {},
    command: async (type, fields) => {
      const parsed = contract.parseFrameCommand({ contractVersion: contract.CONTRACT_VERSION, requestId: 'test-plan', type, ...fields });
      commands.push(parsed);
    },
  };
  vm.runInNewContext(source.slice(begin, end), context);
  return { context, commands };
}

test('the shipped precision plan producer sends captured references through the closed bridge as opaque IDs', async () => {
  const { context, commands } = producer();
  await context.suiteCommand('CREATE_AND_REVIEW_PLAN');
  assert.equal(commands.length, 1);
  assert.deepEqual([...commands[0].candidateMediaKeys], [expectedAlias]);
  assert.equal([...context.referenceKeys][0], rawKey, 'display/translation source identity stays intact');
});
test('combined image mode passes explicit hero-only intent through the shipped producer and closed frame contract', async () => {
  const { context, commands } = producer({ imageMode: 'ai-main-translate' });
  await context.suiteCommand('CREATE_AND_REVIEW_PLAN');
  assert.deepEqual([...commands[0].galleryGoals], []);
  assert.deepEqual([...commands[0].candidateMediaKeys], [expectedAlias]);
});

test('pending reference compilation prevents a second plan submission', async () => {
  let release, entered = 0;
  const wait = new Promise(resolve => { release = resolve; });
  const { context, commands } = producer({ compile: async (...args) => { entered++; await wait; return helper.compileHostedReferenceSelection(...args); } });
  const first = context.suiteCommand('CREATE_AND_REVIEW_PLAN');
  const second = context.suiteCommand('CREATE_AND_REVIEW_PLAN');
  const settled = Promise.allSettled([first, second]);
  const observed = entered; release();
  const results = await settled;
  assert.equal(observed, 1);
  assert.equal(commands.length, 1);
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected');
});

test('a changed binding during compilation submits no plan and clears the local lock', async () => {
  let release, revision = 1;
  const wait = new Promise(resolve => { release = resolve; });
  const { context, commands } = producer({ binding: () => ({ snapshotId: 'snapshot', shopId: 'shop', listingWorkflowId: 'draft', draftRevision: revision, draftVersion: revision }),
    compile: async (...args) => { await wait; return helper.compileHostedReferenceSelection(...args); },
  });
  const submitted = context.suiteCommand('CREATE_AND_REVIEW_PLAN');
  revision = 2; release();
  await assert.rejects(submitted, error => error.outcome === 'NOT_SUBMITTED');
  assert.equal(commands.length, 0); assert.equal(context.planSubmissionBusy, false); assert.equal(context.promptPlanLocks.size, 0);
});

test('reference selection preserves safe IDs and rejects unbound, direct URL, duplicate and ambiguous selections', async () => {
  const compile = helper.compileHostedReferenceSelection;
  assert.deepEqual([...await compile(['media-1'], [{ key: 'media-1' }])], ['media-1']);
  await assert.rejects(compile(['other'], [{ key: rawKey }]));
  await assert.rejects(compile(['https://cdn.example/image.jpg'], [{ key: 'https://cdn.example/image.jpg' }]));
  await assert.rejects(compile([rawKey, rawKey], [{ key: rawKey }]));
  await assert.rejects(compile([rawKey, expectedAlias], [{ key: rawKey }, { key: expectedAlias }]));
  await assert.rejects(compile(Array.from({ length: 6 }, (_, i) => 'media-' + i), Array.from({ length: 6 }, (_, i) => ({ key: 'media-' + i }))));
});

test('invalid hosted commands fail before dispatch instead of waiting for an unknown outcome', async () => {
  const source = readFileSync(`${root}/pages/precision-workbench.js`, 'utf8');
  const begin = source.indexOf('function command('), end = source.indexOf('const session = Workflow.createSession(', begin);
  assert.ok(begin >= 0 && end > begin);
  let posts = 0, timers = 0;
  const context = { crypto: webcrypto, Contract: contract, parentOrigin: 'https://detail.1688.com',
    parent: { postMessage() { posts++; } }, pending: new Map(),
    setTimeout() { timers++; }, clearTimeout() {}, Error, Promise, Object,
  };
  vm.runInNewContext(source.slice(begin, end), context);
  await assert.rejects(context.command('EXECUTE_HOSTED_SUITE', {
    listingWorkflowId: 'draft', action: 'CREATE_AND_REVIEW_PLAN', slotKey: null, decision: null,
    costConfirmed: false, candidateMediaKeys: [rawKey],
  }), error => error.outcome === 'NOT_SUBMITTED');
  assert.equal(posts, 0); assert.equal(timers, 0); assert.equal(context.pending.size, 0);
});
