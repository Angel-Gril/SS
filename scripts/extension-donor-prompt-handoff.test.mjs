import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const path = 'extensions/ss-erp/shared/donor-workbench/prompt-handoff.js';
const context = { Array, Boolean, Date, Error, JSON, Map, Math, Number, Object, Promise, Set, String, TypeError };
context.globalThis = context;
vm.runInNewContext(fs.readFileSync(path, 'utf8'), context, { filename: path });
const api = context.SS_ERP_DONOR_PROMPT_HANDOFF;
assert.ok(api);

const values = {};
const storage = {
  async get(keys) {
    return Object.fromEntries(keys.filter((key) => Object.hasOwn(values, key)).map((key) => [key, values[key]]));
  },
  async set(input) { Object.assign(values, input); },
  async remove(keys) { keys.forEach((key) => delete values[key]); },
};
let now = 1_800_000_000_000;
const store = api.createStore({ storage, now: () => now, ttlMs: 60_000 });
const binding = {
  sourcePlatform: '1688', sourceProductId: 'goods-1', sourceCaptureSnapshotId: 'snapshot-1',
  supplyGoodsId: 'supply-1', shopId: 'shop-1', workflowId: 'draft-1',
  draftRevision: 2, draftVersion: 3, skuKey: 'sku-green',
};

await store.stage({
  tabId: 17,
  binding,
  draft: {
    contractVersion: api.DRAFT_VERSION,
    prompt: 'Create a clean Ozon hero image.\nKeep the green SKU unchanged.',
    negativePrompt: 'watermark, QR code, changed color',
  },
});
const consumed = await store.consume({ tabId: 17, binding });
assert.equal(consumed.state, 'ready');
assert.equal(consumed.prompt.includes('green SKU'), true);
assert.equal((await store.consume({ tabId: 17, binding })).state, 'empty');

await store.stage({
  tabId: 18, binding,
  draft: { contractVersion: api.DRAFT_VERSION, prompt: 'Prompt', negativePrompt: '' },
});
assert.equal((await store.consume({ tabId: 18, binding: { ...binding, draftRevision: 3 } })).state, 'empty');

await store.stage({
  tabId: 19, binding,
  draft: { contractVersion: api.DRAFT_VERSION, prompt: 'Prompt', negativePrompt: '' },
});
now += 60_001;
assert.equal((await store.consume({ tabId: 19, binding })).state, 'empty');

await assert.rejects(
  store.stage({
    tabId: 20, binding,
    draft: { contractVersion: api.DRAFT_VERSION, prompt: 'Bearer secret-token-value', negativePrompt: '' },
  }),
);

console.log('PASS extension donor prompt handoff contract');
