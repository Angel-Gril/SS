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
const creativeDraft = api.buildPromptDraft({
  source: { platform: '1688', sourceProductId: 'goods-1', title: 'Storage organizer' },
  skus: [{ key: 'sku-green', label: 'Green / Large' }],
  media: [{ key: 'main', role: 'product_main' }],
}, {
  selectedSkuKeys: ['sku-green'], selectedMediaKeys: ['main'],
  visualDescription: { subject: 'forged product', background: '浅灰厨房台面', lighting: '柔和自然光', composition: '居中' },
});
assert.match(creativeDraft.prompt, /浅灰厨房台面/);
assert.match(creativeDraft.prompt, /柔和自然光/);
assert.equal(creativeDraft.visualDescription.subject, 'Storage organizer');
assert.doesNotMatch(creativeDraft.prompt, /forged product/);
assert.throws(() => api.buildPromptDraft({ source: { title: 'x' }, skus: [], media: [] }, {
  selectedSkuKeys: ['forged'], selectedMediaKeys: [],
}));

assert.equal(api.compileCreativeBrief({ prompt: '  ', negativePrompt: '' }), undefined,
  'empty directions keep the existing service rules');
assert.deepEqual(JSON.parse(JSON.stringify(api.compileCreativeBrief({
  prompt: '  浅灰背景，柔和自然光  ', negativePrompt: '  不要装饰文字  ',
}))), { prompt: '浅灰背景，柔和自然光', negativePrompt: '不要装饰文字' });
assert.deepEqual(JSON.parse(JSON.stringify(api.compileCreativeBrief({ prompt: '居中构图' }))),
  { prompt: '居中构图' });
assert.equal(api.compileCreativeBrief({ prompt: '😀'.repeat(300) }).prompt, '😀'.repeat(300),
  'the bound counts Unicode characters without truncating surrogate pairs');
assert.equal(api.compileCreativeBrief({ prompt: '场景', negativePrompt: '😀'.repeat(150) }).negativePrompt,
  '😀'.repeat(150));
assert.throws(() => api.compileCreativeBrief({ prompt: '😀'.repeat(301) }), /300/);
assert.throws(() => api.compileCreativeBrief({ prompt: '场景', negativePrompt: '😀'.repeat(151) }), /150/);
assert.throws(() => api.compileCreativeBrief({ prompt: '场景', skuKey: 'forged' }), /字段/);
assert.throws(() => api.compileCreativeBrief({ prompt: 123 }), /文字/);
assert.throws(() => api.compileCreativeBrief({ prompt: '', negativePrompt: '排除文字' }), /方向/);
for (const unsafe of ['访问 https://example.com', 'www.example.com', 'data:image/png;base64,xyz',
  'file:example', 'blob:example', 'ftp:example', 'javascript:example', 'ws:example',
  'custom://example', 'apiKey=secret', 'api_key=secret', 'Authorization secret',
  'Bearer secret', 'sk-secret123', '光线\u0000', '光线\u0085']) {
  assert.throws(() => api.compileCreativeBrief({ prompt: unsafe }), /链接|密钥|控制字符/);
  assert.throws(() => api.compileCreativeBrief({ prompt: '场景', negativePrompt: unsafe }), /链接|密钥|控制字符/);
}
for (const prefix of ['rk-', 'xai-', 'gsk_', 'hf_', 'r8_', 'ghp_', 'github_pat_', 'AIza', 'AKIA', 'ASIA']) {
  assert.throws(() => api.compileCreativeBrief({ prompt: prefix + 'secret-example' }), /密钥/);
  assert.throws(() => api.compileCreativeBrief({ prompt: '场景', negativePrompt: prefix + 'secret-example' }), /密钥/);
}
assert.equal(api.compileCreativeBrief({ prompt: '第一行\n第二行' }).prompt, '第一行\n第二行');
assert.equal(api.compileCreativeBrief({ prompt: 'ＡＢＣ' }).prompt, 'ＡＢＣ', 'do not rewrite creative directions with NFKC');
const visualBrief = api.compileVisualCreativeBrief({
  subject: 'forged product', material: 'forged fact', skuLabels: ['forged SKU'],
  composition: '居中', background: '浅灰厨房台面', lighting: '柔和自然光', style: '写实',
});
assert.equal(visualBrief.prompt, '构图：居中；背景：浅灰厨房台面；光线：柔和自然光；风格：写实');
assert.doesNotMatch(visualBrief.prompt, /forged/);
assert.equal(api.compileVisualCreativeBrief({ background: ' ' }), undefined);
assert.throws(() => api.compileVisualCreativeBrief({ background: 12 }), /文字/);
assert.throws(() => api.compileVisualCreativeBrief({ background: '长'.repeat(301) }), /300/);
assert.throws(() => api.compileVisualCreativeBrief({ composition: '长'.repeat(180), background: '长'.repeat(180) }), /300/);
assert.throws(() => api.compileVisualCreativeBrief({ background: 'https://example.com' }), /链接/);

console.log('PASS extension donor prompt adapter contract');
