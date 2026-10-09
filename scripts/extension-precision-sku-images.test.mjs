import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSkuImageRows, describeImageTask, describeSuite } from '../extensions/ss-erp/pages/donor/sku-image-workspace.js';

const skus = [{ key: 'white', label: '白色/S', imageUrl: 'https://images.example/white.jpg' }, { key: 'black', label: '黑色/M' }];
const media = [
  { key: 'main', url: 'https://images.example/main.jpg', skuKeys: [] },
  { key: 'black', url: 'https://images.example/black.jpg', skuKeys: ['black'] },
  { key: 'white', url: skus[0].imageUrl, skuKeys: ['white'] },
  { key: 'duplicate', url: skus[0].imageUrl, skuKeys: ['white'] },
];
const pending = { id: 'image-task', contextSkuKey: 'white', status: 'SUCCEEDED', reviewStatus: 'PENDING',
  outputs: [{ id: 'output', url: 'https://images.example/generated.jpg' }] };

test('each canonical SKU has its own row, with its image before common sources and no other SKU images', () => {
  const rows = buildSkuImageRows({ skus, media, title: '上衣' });
  assert.deepEqual(rows.map(row => [row.skuRowKey, row.index, row.name]), [['white', 1, '上衣 · 白色/S'], ['black', 2, '上衣 · 黑色/M']]);
  assert.deepEqual(rows[0].images.map(image => image.key), ['white', 'main']);
  assert.deepEqual(rows[1].images.map(image => image.key), ['black', 'main']);
  assert.equal(rows[0].taskStatusLines.length, 0);
  assert.deepEqual(media.map(image => image.key), ['main', 'black', 'white', 'duplicate'], 'projection inputs are not reordered');
});
test('a single selected draft SKU stays one row; the view never restores unselected source SKUs', () => {
  assert.deepEqual(buildSkuImageRows({ skus: skus.slice(0, 1), media }).map(row => row.skuRowKey), ['white']);
});
test('task candidates and review status belong only to their exact SKU or an explicit product scope', () => {
  const rows = buildSkuImageRows({ skus, media, history: { items: [pending, { ...pending, id: 'product-task', contextSkuKey: '' }] } });
  assert.deepEqual(rows[0].taskStatusLines.map(line => line.key), ['image-task']);
  assert.deepEqual(rows[0].historyTaskStatusLines.map(line => line.key), ['product-task']);
  assert.deepEqual(rows[1].taskStatusLines.map(line => line.key), ['product-task']);
  assert.deepEqual(buildSkuImageRows({ skus, media, history: { items: [pending] } })[1].images.map(image => image.kind), ['SOURCE', 'SOURCE']);
});
test('generation success does not present a pending or rejected output as reviewed or applied', () => {
  assert.deepEqual(describeImageTask(pending), { text: '图片已生成 · 待审核', status: 'warning' });
  assert.deepEqual(describeImageTask({ ...pending, reviewStatus: 'REJECTED' }), { text: '已驳回', status: 'error' });
  assert.equal(describeImageTask({ ...pending, reviewStatus: 'APPROVED' }).text, '审核通过 · 待应用');
  assert.equal(describeImageTask({ ...pending, reviewStatus: 'APPROVED', application: { state: 'APPLIED' } }).text, '已应用到草稿');
});
test('shared suite progress is labelled as a whole-suite task instead of fake per-SKU completion', () => {
  const rows = buildSkuImageRows({ skus, media, billing: { suite: { status: 'RUNNING' } } });
  assert.equal(rows[0].taskStatusLines[0].text, '本次套图 · 处理中');
  assert.equal(describeImageTask({ status: 'UNRECOGNIZED' }).text, '状态待核对');
});
test('the suite summary keeps the ERP quote and communicates a Chinese review step', () => {
  const billing = { quote: { itemCount: 2, currency: 'CNY', maximumCostMinor: 28 }, suite: { status: 'SUCCEEDED' } };
  assert.equal(describeSuite(billing), '2 张 · 最高 CNY 0.28 · 生成完成，请审核图片');
  assert.equal(describeSuite({ ...billing, suite: null }), '2 张 · 最高 CNY 0.28 · 待确认生成');
});
