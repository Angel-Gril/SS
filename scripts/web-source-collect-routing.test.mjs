import assert from 'node:assert/strict';
import fs from 'node:fs';

const sidebar = fs.readFileSync('apps/web/src/components/layout/sidebar.tsx', 'utf8');
const pagePath = 'apps/web/src/app/(dashboard)/collect/source/page.tsx';
const page = fs.existsSync(pagePath) ? fs.readFileSync(pagePath, 'utf8') : '';

assert.match(
  sidebar,
  /label:\s*['"]1688商品采集['"][\s\S]*href:\s*['"]\/collect\/source['"]/,
  'sidebar should expose a dedicated 1688 source collection menu entry',
);
assert.match(
  page,
  /api\.get<[\s\S]*\/api\/collect\?/,
  'source collection page should read collected source goods from the collect API',
);
assert.match(
  page,
  /sourceGroup:\s*['"]source['"]|sourceGroup['"]?\s*,\s*['"]source['"]|sourceGroup=source/,
  'source collection page should request only domestic source collect records',
);
for (const label of ['1688', 'PDD', '淘宝', '天猫']) {
  assert.match(page, new RegExp(label), `source collection page should support ${label} filtering`);
}
assert.match(
  page,
  /sourcePlatform/i,
  'source collection page should separate source-platform goods from Ozon SKU collection',
);

const skuCollectPage = fs.readFileSync('apps/web/src/app/(dashboard)/collect/page.tsx', 'utf8');
assert.match(
  skuCollectPage,
  /sourceGroup:\s*['"]ozon['"]|sourceGroup['"]?\s*,\s*['"]ozon['"]|sourceGroup=ozon/,
  'SKU follow collection page should request only Ozon collect records',
);

console.log('PASS web source collect routing');
