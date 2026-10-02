import assert from 'node:assert/strict';
import fs from 'node:fs';

const overlay = fs.readFileSync('extensions/ss-erp/content/ozon-list-overlay.js', 'utf8');
const collector = fs.readFileSync('extensions/ss-erp/content/collect-content-script.js', 'utf8');
const background = fs.readFileSync('extensions/ss-erp/background/collect-background.js', 'utf8');

for (const retired of [
  'openListSkuWorkbench', 'publishListWorkbenchSelectedRows', 'showOzonSkuWorkbench',
  'quick-open-workbench', 'quick-open-erp', 'fetch-ozon-workbench-rows',
  'publish-ozon-workbench-rows', '采集此商品', '一键上架选中商品',
]) {
  assert.equal(overlay.includes(retired), false, `Ozon list overlay retains retired ${retired}`);
  assert.equal(collector.includes(retired), false, `Ozon product collector retains retired ${retired}`);
}
assert.match(overlay, /function\s+ensureListQuickActions/u);
assert.match(overlay, /quick-selection-settings/u);
assert.match(overlay, /sync-current-ozon-cookie/u);
assert.match(overlay, /selection-rules/u);
assert.match(collector, /function\s+collectCurrentPage/u);
assert.match(collector, /collect-product/u);
assert.match(background, /sourceErrors/u);
assert.match(background, /aggregate-product-insights/u);
console.log('PASS Ozon list overlay keeps analytics/selection tools and removes legacy collect/publish UI');
