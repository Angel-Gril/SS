import assert from 'node:assert/strict';
import fs from 'node:fs';

const sidebar = fs.readFileSync('apps/web/src/components/layout/sidebar.tsx', 'utf8');
const pagePath = 'apps/web/src/app/(dashboard)/selection-pool/page.tsx';
const page = fs.existsSync(pagePath) ? fs.readFileSync(pagePath, 'utf8') : '';
const collectPage = fs.readFileSync('apps/web/src/app/(dashboard)/collect/page.tsx', 'utf8');

assert.match(
  sidebar,
  /label:\s*['"]选品池['"][\s\S]*href:\s*['"]\/selection-pool['"]/,
  'sidebar should expose ERP selection pool under the listing workflow',
);
assert.match(
  page,
  /\/api\/extension-config\/product-selection\/pool\/items/,
  'selection pool page should load the ERP-backed pool endpoint',
);
for (const queryParam of ['q', 'tag', 'ruleId', 'status', 'page', 'pageSize']) {
  assert.match(page, new RegExp(queryParam), `selection pool page should wire ${queryParam} filtering`);
}
for (const label of ['SKU', '商品', '价格', '标签', '命中规则/指标', '入池时间', '操作']) {
  assert.match(page, new RegExp(label), `selection pool table should expose ${label} column`);
}
for (const action of ['导出Excel', '移出选品池', '打开Ozon', '去采集上架']) {
  assert.match(page, new RegExp(action), `selection pool page should expose ${action} action`);
}
assert.match(
  page,
  /api\.download\(/,
  'selection pool export should download a spreadsheet file instead of copying to clipboard',
);
assert.match(
  page,
  /api\.delete\([\s\S]*\/api\/extension-config\/product-selection\/pool\/items\/\$\{encodeURIComponent\(sku\)\}/,
  'selection pool page should remove selected SKUs through the pool delete endpoint',
);
assert.match(
  page,
  /router\.push\(`\/collect\?poolSkus=/,
  'selection pool handoff should send selected SKUs to the collect/listing workflow',
);
assert.match(
  collectPage,
  /useSearchParams/,
  'SKU collect page should read selection-pool handoff params',
);
assert.match(
  collectPage,
  /poolSkus/,
  'SKU collect page should recognize poolSkus from ERP selection pool',
);
assert.match(
  collectPage,
  /setOzonFetchInput\(normalized\)[\s\S]*setShowOzonFetch\(true\)/,
  'SKU collect page should open the Ozon fetch modal prefilled with selection-pool SKUs',
);

console.log('PASS web selection pool page');
