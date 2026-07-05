import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('apps/web/src/app/(dashboard)/collect/batch/page.tsx', 'utf8');

assert.match(
  source,
  /selectedCollectedIds/,
  'batch collect page should track selected collected rows for SKU-level publishing',
);
assert.match(
  source,
  /setSelectedCollectedIds\(new Set\(refreshed\.map\(\(item\) => item\.id\)\)\)/,
  'batch collect page should select all refreshed rows after collection',
);
assert.match(
  source,
  /const selectedCollected = collected\.filter\(\(item\) => selectedCollectedIds\.has\(item\.id\)\)/,
  'batch collect page should derive the publish payload from selected rows',
);
assert.match(
  source,
  /ids:\s*selectedCollected\.map\(\(c\) => c\.id\)/,
  'batch collect publish should submit selected IDs only',
);

for (const label of [
  'SKU 工作台',
  '选中',
  '跟卖最低价',
  '跟卖最高价',
  '30天销量',
  '30天销售额',
  '广告费占比',
  '促销天数',
  '搜索浏览',
  '搜索加购',
  '商品点击率',
  '退货取消率',
  '加购率',
  '源分类',
]) {
  assert.match(source, new RegExp(label), `batch collect table should show ${label}`);
}

assert.match(
  source,
  /item\.metadata\?\.ozonInsights/,
  'batch collect table should surface persisted Ozon insight metadata',
);
assert.match(
  source,
  /asRecord/,
  'batch collect page should guard malformed ozonInsights metadata before rendering',
);
assert.match(
  source,
  /function deriveReturnCancelRate/,
  'batch collect page should derive return/cancel rate instead of displaying redemption rate directly',
);
assert.match(
  source,
  /100 - redemption/,
  'batch collect page should convert Ozon redemption rate into return/cancel rate',
);
assert.doesNotMatch(
  source,
  /\['returnCancelRate', 'nullableRedemptionRate', 'redemptionRate'\]/,
  'batch collect page should not fall back from return/cancel rate to redemption rate as the same metric',
);
assert.match(
  source,
  /type="checkbox"/,
  'batch collect workbench should render checkbox selection controls',
);

console.log('PASS web collect batch SKU workbench source checks');
