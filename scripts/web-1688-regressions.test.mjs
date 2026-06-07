import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function readRepoFile(...parts) {
  return readFileSync(join(root, ...parts), 'utf8');
}

test('1688 collect and listing pages expose saved SKU images for review', () => {
  const packageJson = JSON.parse(readRepoFile('package.json'));
  const collectPage = readRepoFile('apps', 'web', 'src', 'app', '(dashboard)', 'collect', '1688', 'page.tsx');
  const listingPage = readRepoFile('apps', 'web', 'src', 'app', '(dashboard)', 'listing', '1688', 'page.tsx');

  assert.match(packageJson.scripts['test:repo'], /web-1688-regressions\.test\.mjs/);

  for (const source of [collectPage, listingPage]) {
    assert.match(source, /images\?:\s*string\[\]\s*\|\s*null/);
    assert.match(source, /imageUrl\?:\s*string\s*\|\s*null/);
    assert.match(source, /sourceSkuId\?:\s*string\s*\|\s*null/);
    assert.match(source, /ozonSku\?:\s*string\s*\|\s*null/);
    assert.match(source, /imageUrl:\s*parts\[6\]\s*\|\|\s*undefined/);
    assert.match(source, /ozonSku:\s*parts\[7\]\s*\|\|\s*undefined/);
    assert.match(source, /SKU图片URL/);
    assert.match(source, /Ozon SKU/);
    assert.match(source, /variant\.sourceSkuId\s*\?\s*`货源SKU\s*\$\{variant\.sourceSkuId\}`/);
    assert.match(source, /variant\.ozonSku\s*\?\s*`Ozon SKU\s*\$\{variant\.ozonSku\}`/);
    assert.match(source, /function\s+variantImageUrl\(variant:\s*Alibaba1688Variant\)/);
    assert.match(source, /\.\.\.\(variant\.images\s*\|\|\s*\[\]\),\s*variant\.imageUrl\s*\|\|\s*''/);
    assert.match(source, /const\s+image\s*=\s*variantImageUrl\(variant\)/);
    assert.match(source, /src=\{image\}/);
    assert.match(source, /aria-label="SKU 图片"/);
  }
});

test('dashboard and main listing page expose 1688 workflow entry points', () => {
  const dashboardPage = readRepoFile('apps', 'web', 'src', 'app', '(dashboard)', 'page.tsx');
  const listingPage = readRepoFile('apps', 'web', 'src', 'app', '(dashboard)', 'listing', 'page.tsx');

  assert.match(dashboardPage, /href="\/collect\/1688"/);
  assert.match(dashboardPage, /href="\/listing\/1688"/);
  assert.match(listingPage, /router\.push\('\/collect\/1688'\)/);
  assert.match(listingPage, /router\.push\('\/listing\/1688'\)/);
});

test('1688 listing preparation exposes Ozon category mapping fields', () => {
  const listingPage = readRepoFile('apps', 'web', 'src', 'app', '(dashboard)', 'listing', '1688', 'page.tsx');

  assert.match(listingPage, /ozonCategoryId:\s*string/);
  assert.match(listingPage, /ozonTypeId:\s*string/);
  assert.match(listingPage, /missing_ozon_category_id:\s*'待补 Ozon 分类ID'/);
  assert.match(listingPage, /missing_ozon_type_id:\s*'待补 Ozon 类型ID'/);
  assert.match(listingPage, /if\s*\(!item\.ozonCategoryId\.trim\(\)\)\s*issues\.push\('missing_ozon_category_id'\)/);
  assert.match(listingPage, /if\s*\(!item\.ozonTypeId\.trim\(\)\)\s*issues\.push\('missing_ozon_type_id'\)/);
  assert.match(listingPage, /ozonCategoryId:\s*item\.ozonCategoryId/);
  assert.match(listingPage, /ozonTypeId:\s*item\.ozonTypeId/);
  assert.match(listingPage, /Ozon 分类ID/);
  assert.match(listingPage, /Ozon 类型ID/);
});

test('1688 prepared listing drafts use a dedicated backend endpoint', () => {
  const collectRoute = readRepoFile('apps', 'server', 'src', 'routes', 'collect.ts');
  const listingPage = readRepoFile('apps', 'web', 'src', 'app', '(dashboard)', 'listing', '1688', 'page.tsx');
  const listingRoute = readRepoFile('apps', 'server', 'src', 'routes', 'listing.ts');
  const listingJobList = readRepoFile('apps', 'web', 'src', 'components', 'listing-job-list.tsx');
  const listingJobDetail = readRepoFile('apps', 'web', 'src', 'components', 'listing-job-detail-dialog.tsx');

  assert.match(collectRoute, /app\.post\('\/1688\/listing-drafts'/);
  assert.match(collectRoute, /buildAlibaba1688OzonListingDraftItems\(item\)/);
  assert.match(collectRoute, /sourcePlatform:\s*'1688'/);
  assert.match(collectRoute, /1688 采集记录仅保存货源商品信息，不能走当前 Ozon 跟卖\/复制接口/);
  assert.match(listingPage, /Alibaba1688OzonListingDraftItem/);
  assert.match(listingPage, /\/api\/collect\/1688\/listing-drafts/);
  assert.match(listingPage, /生成上架草稿/);
  assert.match(listingPage, /请先保存修改，再生成上架草稿/);
  assert.match(listingPage, /interface\s+Shop\s*\{\s*id:\s*string;\s*name:\s*string;\s*platform:\s*string;\s*status\?:\s*string/);
  assert.match(listingPage, /api\.get<Shop\[\]>\('\/api\/shops'\)/);
  assert.match(listingPage, /const\s+\[shopId,\s*setShopId\]\s*=\s*useState\(''\)/);
  assert.match(listingPage, /\/api\/listing\/batch/);
  assert.match(listingPage, /source:\s*'1688-listing'/);
  assert.match(listingPage, /<ListingJobList\s+entryFilter="1688-listing"/);
  assert.match(listingPage, /1688 上架记录/);
  assert.match(listingPage, /请选择目标店铺/);
  assert.match(listingPage, /提交到 Ozon/);
  assert.match(listingRoute, /source:\s*z\.enum\(\['1688-listing',\s*'manual-batch'\]\)\.optional\(\)/);
  assert.match(listingRoute, /const\s+listingTaskEntrySchema\s*=\s*z\.enum\(\['1688-listing',\s*'listing-page',\s*'collect-page',\s*'manual-batch'\]\)/);
  assert.match(listingRoute, /sourceTrace:\s*z\.record\(z\.unknown\(\)\)\.optional\(\)/);
  assert.match(listingRoute, /const\s+listingSources\s*=\s*items\.flatMap\(\(item\)\s*=>\s*\(/);
  assert.match(listingRoute, /\.\.\.\(item\.sourceTrace\s+as\s+Record<string,\s*unknown>\),\s*offerId:\s*item\.offerId/);
  assert.match(listingRoute, /entry:\s*source/);
  assert.match(listingRoute, /mode:\s*source\s*===\s*'1688-listing'\s*\?\s*'1688'\s*:\s*'batch'/);
  assert.match(listingRoute, /const\s+sourceSkus\s*=\s*traceValues\('sourceSkuId'\)/);
  assert.match(listingRoute, /const\s+sourcePlatforms\s*=\s*traceValues\('sourcePlatform'\)/);
  assert.match(listingRoute, /const\s+ozonSkus\s*=\s*traceValues\('ozonSku'\)/);
  assert.match(listingRoute, /const\s+ozonProductIds\s*=\s*traceValues\('ozonProductId'\)/);
  assert.match(listingRoute, /const\s+ozonOfferIds\s*=\s*traceValues\('ozonOfferId'\)/);
  assert.match(listingRoute, /where\.payload\s*=\s*\{\s*path:\s*\['entry'\],\s*equals:\s*entry\.data\s*\}/);
  assert.match(listingRoute, /sourceSkus,/);
  assert.match(listingRoute, /sourcePlatforms,/);
  assert.match(listingRoute, /ozonSkus,/);
  assert.match(listingRoute, /ozonProductIds,/);
  assert.match(listingRoute, /ozonOfferIds,/);
  assert.match(listingRoute, /const\s+offerIds\s*=\s*items\.map\(\(item\)\s*=>\s*item\.offerId\)/);
  assert.match(listingRoute, /offerImages/);
  assert.match(listingRoute, /listingSources,/);
  assert.match(listingJobList, /entryFilter\?:\s*'collect-page'\s*\|\s*'listing-page'\s*\|\s*'1688-listing'/);
  assert.match(listingJobList, /mode\?:\s*'follow'\s*\|\s*'clone'\s*\|\s*'follow-by-sku'\s*\|\s*'1688'\s*\|\s*'batch'/);
  assert.match(listingJobList, /sourcePlatforms\?:\s*string\[\]/);
  assert.match(listingJobList, /ozonSkus\?:\s*string\[\]/);
  assert.match(listingJobList, /ozonProductIds\?:\s*string\[\]/);
  assert.match(listingJobList, /ozonOfferIds\?:\s*string\[\]/);
  assert.match(listingJobList, /listingSources\?:\s*Array<Record<string,\s*unknown>>/);
  assert.match(listingJobList, /new\s+URLSearchParams\(\{\s*limit:\s*String\(limit\)\s*\}\)/);
  assert.match(listingJobList, /entryFilter\s*&&\s*entryFilter\s*!==\s*'collect-page'/);
  assert.match(listingJobList, /params\.set\('entry',\s*entryFilter\)/);
  assert.match(listingJobList, /if\s*\(entryFilter\s*===\s*'1688-listing'\)\s*return\s*e\s*===\s*'1688-listing'/);
  assert.match(listingJobList, /text:\s*'1688 上架'/);
  assert.match(listingJobList, /货源 SKU/);
  assert.match(listingJobList, /Ozon SKU/);
  assert.match(listingJobDetail, /货源平台/);
  assert.match(listingJobDetail, /货源 SKU/);
  assert.match(listingJobDetail, /Ozon SKU/);
  assert.match(listingJobDetail, /Ozon Product ID/);
  assert.match(listingJobDetail, /Ozon Offer ID/);
  assert.match(listingJobDetail, /function\s+listingSourceFor\(offerId:\s*string,\s*index:\s*number\)/);
  assert.match(listingJobDetail, /sourceValue\(source,\s*'offerId'\)\s*===\s*offerId/);
  assert.match(listingJobDetail, /来源追踪/);
  assert.match(listingJobDetail, /货源\s*\{sourceValue\(source,\s*'sourceSkuId'\)\}/);
  assert.match(listingJobDetail, /PID\s*\{sourceValue\(source,\s*'ozonProductId'\)\}/);
});
