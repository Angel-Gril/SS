import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const path = 'extensions/ss-erp/shared/donor-workbench/prompt-adapter.js';
const source = fs.readFileSync(path, 'utf8');
const context = {
  Array, Boolean, Date, Error, JSON, Map, Math, Number, Object, Set, String, TypeError, URL,
};
context.globalThis = context;
vm.runInNewContext(source, context, { filename: path });
const api = context.SS_ERP_DONOR_PROMPT_ADAPTER;
assert.ok(api, 'donor prompt adapter must expose a closed API');
assert.equal(api.CONTRACT_VERSION, 'ss-erp-donor-prompt-adapter/v1');

const draft = api.buildPromptDraft({
  source: {
    platform: '1688',
    sourceProductId: 'goods-1',
    title: 'Storage organizer',
    categoryName: 'Home storage',
  },
  skus: [
    { key: 'sku-white', label: 'White / Small', imageUrl: '' },
    { key: 'sku-green', label: 'Green / Large', imageUrl: '' },
  ],
  media: [
    { key: 'main', role: 'product_main', url: 'https://img.example/main.jpg', skuKeys: [] },
    { key: 'detail', role: 'product_detail', url: 'https://img.example/detail.jpg', skuKeys: [] },
  ],
}, { selectedSkuKeys: ['sku-green'], selectedMediaKeys: ['main', 'detail'] });

assert.equal(draft.contractVersion, api.CONTRACT_VERSION);
assert.equal(draft.sourceProductId, 'goods-1');
assert.deepEqual(JSON.parse(JSON.stringify(draft.selectedSkuKeys)), ['sku-green']);
assert.deepEqual(JSON.parse(JSON.stringify(draft.referenceMediaKeys)), ['main', 'detail']);
assert.match(draft.prompt, /Storage organizer/u);
assert.match(draft.prompt, /Green \/ Large/u);
assert.match(draft.prompt, /reference images/u);
assert.match(draft.negativePrompt, /Chinese/u);
assert.match(draft.negativePrompt, /watermark/u);
assert.ok(draft.prompt.length <= 8_000);
assert.ok(draft.negativePrompt.length <= 4_000);
assert.equal(JSON.stringify(draft).includes('apiKey'), false);
assert.equal(JSON.stringify(draft).includes('Authorization'), false);

assert.throws(() => api.buildPromptDraft(null));
assert.throws(() => api.buildPromptDraft({ source: { title: 'x' }, skus: [], media: [] }, {
  selectedSkuKeys: ['forged'], selectedMediaKeys: [],
}));

console.log('PASS extension donor prompt adapter contract');
