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
    assert.match(source, /ozonProductId\?:\s*string\s*\|\s*null/);
    assert.match(source, /ozonOfferId\?:\s*string\s*\|\s*null/);
    assert.match(source, /imageUrl:\s*parts\[6\]\s*\|\|\s*undefined/);
    assert.match(source, /ozonSku:\s*parts\[7\]\s*\|\|\s*undefined/);
    assert.match(source, /ozonProductId:\s*sourceTrace\.ozonProductId/);
    assert.match(source, /ozonOfferId:\s*sourceTrace\.ozonOfferId/);
    assert.match(source, /sourcePlatform:\s*sourceTrace\.sourcePlatform/);
    assert.match(source, /SKU图片URL/);
    assert.match(source, /Ozon SKU/);
    assert.match(source, /Ozon Product ID/);
    assert.match(source, /Ozon Offer ID/);
    assert.match(source, /货源平台/);
    assert.match(source, /function\s+sourceSkuLabel\(variant:\s*Alibaba1688Variant\)/);
    assert.match(source, /variant\.sourcePlatform\s*\?\s*`\$\{sourcePlatformLabel\(variant\.sourcePlatform\)\}\s+SKU`\s*:\s*'货源 SKU'/);
    assert.doesNotMatch(source, /variant\.sourcePlatform\s*\?\s*`\$\{variant\.sourcePlatform\}\s+SKU`/);
    assert.match(source, /variant\.sourceSkuId\s*\?\s*`\$\{sourceSkuLabel\(variant\)\}\s+\$\{variant\.sourceSkuId\}`/);
    assert.match(source, /variant\.ozonSku\s*\?\s*`Ozon SKU\s*\$\{variant\.ozonSku\}`/);
    assert.match(source, /variant\.ozonProductId\s*\?\s*`Ozon Product ID\s*\$\{variant\.ozonProductId\}`/);
    assert.match(source, /variant\.ozonOfferId\s*\?\s*`Ozon Offer ID\s*\$\{variant\.ozonOfferId\}`/);
    assert.match(source, /function\s+variantImageUrl\(variant:\s*Alibaba1688Variant\)/);
    assert.match(source, /\.\.\.\(variant\.images\s*\|\|\s*\[\]\),\s*variant\.imageUrl\s*\|\|\s*''/);
    assert.match(source, /const\s+image\s*=\s*variantImageUrl\(variant\)/);
    assert.match(source, /src=\{image\}/);
    assert.match(source, /aria-label="SKU 图片"/);
  }
});

test('dashboard and main listing page expose domestic supply workflow entry points', () => {
  const dashboardPage = readRepoFile('apps', 'web', 'src', 'app', '(dashboard)', 'page.tsx');
  const listingPage = readRepoFile('apps', 'web', 'src', 'app', '(dashboard)', 'listing', 'page.tsx');
  const sidebar = readRepoFile('apps', 'web', 'src', 'components', 'layout', 'sidebar.tsx');

  assert.match(dashboardPage, /href="\/collect\/1688"/);
  assert.match(dashboardPage, /href="\/listing\/1688"/);
  assert.match(dashboardPage, /货源采集上品/);
  assert.match(dashboardPage, /货源上架准备/);
  assert.doesNotMatch(dashboardPage, /1688采集上品|1688上架准备/);
  assert.match(listingPage, /router\.push\('\/collect\/1688'\)/);
  assert.match(listingPage, /router\.push\('\/listing\/1688'\)/);
  assert.match(listingPage, /货源采集上品/);
  assert.match(listingPage, /货源上架准备/);
  assert.doesNotMatch(listingPage, /1688 采集上品|1688 上架准备/);
  assert.match(sidebar, /label:\s*'货源采集上品'/);
  assert.match(sidebar, /label:\s*'货源上架准备'/);
  assert.doesNotMatch(sidebar, /1688采集上品|1688上架准备/);
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
  const collectPage = readRepoFile('apps', 'web', 'src', 'app', '(dashboard)', 'collect', '1688', 'page.tsx');
  const listingPage = readRepoFile('apps', 'web', 'src', 'app', '(dashboard)', 'listing', '1688', 'page.tsx');
  const listingRoute = readRepoFile('apps', 'server', 'src', 'routes', 'listing.ts');
  const listingJobList = readRepoFile('apps', 'web', 'src', 'components', 'listing-job-list.tsx');
  const listingJobDetail = readRepoFile('apps', 'web', 'src', 'components', 'listing-job-detail-dialog.tsx');

  assert.match(collectRoute, /app\.post\('\/1688\/listing-drafts'/);
  assert.match(collectRoute, /buildAlibaba1688OzonListingDraftItems\(item\)/);
  assert.match(collectRoute, /normalizeAlibaba1688PreparationVariants\(row\.variants,\s*item\.variants,\s*\{\s*sourcePlatform:\s*item\.sourcePlatform,\s*\}\)/);
  assert.match(collectRoute, /货源采集记录仅保存货源商品信息，不能走当前 Ozon 跟卖\/复制接口/);
  assert.match(listingPage, /Alibaba1688OzonListingDraftItem/);
  assert.match(listingPage, /\/api\/collect\/1688\/listing-drafts/);
  assert.match(listingPage, /生成上架草稿/);
  assert.match(listingPage, /请先保存修改，再生成上架草稿/);
  assert.match(listingPage, /interface\s+Shop\s*\{\s*id:\s*string;\s*name:\s*string;\s*platform:\s*string;\s*status\?:\s*string/);
  assert.match(listingPage, /api\.get<Shop\[\]>\('\/api\/shops'\)/);
  assert.match(listingPage, /const\s+\[shopId,\s*setShopId\]\s*=\s*useState\(''\)/);
  assert.match(listingPage, /const\s+\[listingJobsRefreshToken,\s*setListingJobsRefreshToken\]\s*=\s*useState\(0\)/);
  assert.match(listingPage, /listingStatus:\s*string\s*\|\s*null/);
  assert.match(listingPage, /canCreateListingDraft:\s*boolean/);
  assert.match(listingPage, /function\s+canCreateListingDraft\(item:\s*Alibaba1688ListingItem\)/);
  assert.match(listingPage, /status\s*!==\s*'submitted'\s*&&\s*status\s*!==\s*'pending'\s*&&\s*status\s*!==\s*'imported'/);
  assert.match(listingPage, /currentPreparationStatus\(item\)\s*===\s*'ready'\s*&&\s*canCreateListingDraft\(item\)/);
  assert.match(listingPage, /不可重复提交/);
  assert.match(listingPage, /function\s+submittedSupplyGoodsIds\(draftItems:\s*Alibaba1688OzonListingDraftItem\[\]\)/);
  assert.match(listingPage, /function\s+markSubmittedListingItems\(draftItems:\s*Alibaba1688OzonListingDraftItem\[\]\)/);
  assert.match(listingPage, /listingStatus:\s*'submitted'/);
  assert.match(listingPage, /canCreateListingDraft:\s*false/);
  assert.match(listingPage, /const\s+submittableReadyItemIds\s*=\s*useMemo/);
  assert.match(listingPage, /disabled=\{drafting\s*\|\|\s*saving\s*\|\|\s*submittableReadyItemIds\.length\s*===\s*0\}/);
  assert.match(listingPage, /disabled=\{submitting\s*\|\|\s*drafting\s*\|\|\s*saving\s*\|\|\s*submittableReadyItemIds\.length\s*===\s*0\}/);
  assert.match(listingPage, /\/api\/listing\/batch/);
  assert.match(listingPage, /source:\s*'1688-listing'/);
  assert.match(listingPage, /setListingJobsRefreshToken\(\(value\)\s*=>\s*value\s*\+\s*1\)/);
  assert.match(listingPage, /<ListingJobList\s+entryFilter="1688-listing"[\s\S]*refreshToken=\{listingJobsRefreshToken\}/);
  assert.match(listingPage, /货源上架记录/);
  assert.match(listingPage, /请选择目标店铺/);
  assert.match(listingPage, /提交到 Ozon/);
  assert.match(listingRoute, /source:\s*z\.enum\(\['1688-listing',\s*'manual-batch'\]\)\.optional\(\)/);
  assert.match(listingRoute, /const\s+listingTaskEntrySchema\s*=\s*z\.enum\(\['1688-listing',\s*'listing-page',\s*'collect-page',\s*'manual-batch'\]\)/);
  assert.match(listingRoute, /function\s+appendListingTaskHistory/);
  assert.match(listingRoute, /sourceTrace:\s*z\.record\(z\.unknown\(\)\)\.optional\(\)/);
  assert.match(listingRoute, /function\s+traceSourcePlatform\(source:\s*Record<string,\s*unknown>\)/);
  assert.match(listingRoute, /const\s+listingSources\s*=\s*items\.flatMap\(\(item\)\s*=>\s*\(/);
  assert.match(listingRoute, /\.\.\.\(item\.sourceTrace\s+as\s+Record<string,\s*unknown>\),\s*offerId:\s*item\.offerId/);
  assert.match(listingRoute, /entry:\s*source/);
  assert.match(listingRoute, /mode:\s*source\s*===\s*'1688-listing'\s*\?\s*'1688'\s*:\s*'batch'/);
  assert.match(listingRoute, /const\s+sourceSkus\s*=\s*traceValues\('sourceSkuId'\)/);
  assert.match(listingRoute, /const\s+sourcePlatforms\s*=\s*traceValues\('sourcePlatform'\)/);
  assert.match(listingRoute, /key\s*===\s*'sourcePlatform'\s*\?\s*traceSourcePlatform\(source\)\s*:\s*traceText\(source,\s*key\)/);
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
  assert.match(listingRoute, /if\s*\(source\s*===\s*'1688-listing'\)/);
  assert.match(listingRoute, /sourcesBySupplyGoodsId/);
  assert.match(listingRoute, /where:\s*\{\s*id:\s*\{\s*in:\s*supplyGoodsIds\s*\},\s*userId\s*\}/);
  assert.doesNotMatch(listingRoute, /id:\s*\{\s*in:\s*supplyGoodsIds\s*\},\s*userId,\s*sourcePlatform:\s*'1688'/);
  assert.match(listingRoute, /status:\s*'listed'/);
  assert.match(listingRoute, /lastListingTaskId:\s*task\.taskId/);
  assert.match(listingRoute, /lastListingOfferIds:\s*task\.offerIds/);
  assert.match(listingRoute, /listingTasks:\s*\[task,\s*\.\.\.history\]\.slice\(0,\s*10\)/);
  assert.match(listingRoute, /export\s+function\s+buildAlibaba1688ListingResultUpdates/);
  assert.match(listingRoute, /export\s+function\s+applyAlibaba1688ListingResultMetadata/);
  assert.match(listingRoute, /getListingResultStatus\(info\.items\)/);
  assert.match(listingRoute, /if\s*\(\(job\.payload\s+as\s+any\)\?\.entry\s*===\s*'1688-listing'\)/);
  assert.match(listingRoute, /status:\s*resultUpdate\.resultStatus\s*===\s*'failed'\s*\?\s*'listing_failed'\s*:\s*'listed'/);
  assert.match(collectPage, /status:\s*string/);
  assert.match(collectPage, /function\s+listingStatusText\(item:\s*Collected1688Item\)/);
  assert.match(collectPage, /function\s+listingResultStatus\(item:\s*Collected1688Item\)/);
  assert.match(collectPage, /function\s+canSelectForListing\(item:\s*Collected1688Item\)/);
  assert.match(collectPage, /status\s*!==\s*'submitted'\s*&&\s*status\s*!==\s*'pending'\s*&&\s*status\s*!==\s*'imported'/);
  assert.match(collectPage, /const\s+selectableItems\s*=\s*filteredItems\.filter\(canSelectForListing\)/);
  assert.match(collectPage, /preparationStatus\(item\)\s*===\s*'ready'\s*&&\s*canSelectForListing\(item\)/);
  assert.match(collectPage, /disabled=\{!canSelectForListing\(item\)\}/);
  assert.match(collectPage, /selectableFilteredItems\.length\s*>\s*0\s*&&\s*selectableFilteredItems\.every/);
  assert.match(collectPage, /item\.status\s*===\s*'listing_failed'/);
  assert.match(collectPage, /上架成功/);
  assert.match(collectPage, /部分失败/);
  assert.match(collectPage, /上架失败/);
  assert.match(collectPage, /导入中/);
  assert.match(collectPage, /已提交上架/);
  assert.match(collectPage, /lastListingRefreshedAt/);
  assert.match(collectPage, /lastListingResultStatus/);
  assert.match(collectPage, /lastListingResultItems\?:\s*Array<\{/);
  assert.match(collectPage, /function\s+listingResultFailureItems\(metadata\?:\s*Collected1688Item\['metadata'\]\)/);
  assert.match(collectPage, /function\s+listingResultItemErrorText\(item:\s*ListingResultItem\)/);
  assert.match(collectPage, /function\s+resultSourceSkuLabel\(item:\s*ListingResultItem\)/);
  assert.match(collectPage, /item\.sourcePlatform\s*\?\s*`\$\{sourcePlatformLabel\(item\.sourcePlatform\)\}\s+SKU`\s*:\s*'货源 SKU'/);
  assert.doesNotMatch(collectPage, /item\.sourcePlatform\s*\?\s*`\$\{item\.sourcePlatform\}\s+SKU`/);
  assert.match(collectPage, /item\.metadata\?\.lastListingResultItems/);
  assert.match(collectPage, /失败明细/);
  assert.match(collectPage, /resultSourceSkuLabel\(resultItem\)/);
  assert.match(collectPage, /Ozon SKU/);
  assert.match(collectPage, /Ozon 结果:/);
  assert.match(collectPage, /lastListingTaskId/);
  assert.match(collectPage, /最近上架:\s*Task/);
  assert.match(listingJobList, /entryFilter\?:\s*'collect-page'\s*\|\s*'listing-page'\s*\|\s*'1688-listing'/);
  assert.match(listingJobList, /mode\?:\s*'follow'\s*\|\s*'clone'\s*\|\s*'follow-by-sku'\s*\|\s*'1688'\s*\|\s*'batch'/);
  assert.match(listingJobList, /refreshToken\?:\s*number\s*\|\s*string/);
  assert.match(listingJobList, /refreshToken\s*=\s*0/);
  assert.match(listingJobList, /\[entryFilter,\s*modeFilter,\s*limit,\s*refreshToken\]/);
  assert.match(listingJobList, /sourcePlatforms\?:\s*string\[\]/);
  assert.match(listingJobList, /ozonSkus\?:\s*string\[\]/);
  assert.match(listingJobList, /ozonProductIds\?:\s*string\[\]/);
  assert.match(listingJobList, /ozonOfferIds\?:\s*string\[\]/);
  assert.match(listingJobList, /importedCount\?:\s*number/);
  assert.match(listingJobList, /pendingCount\?:\s*number/);
  assert.match(listingJobList, /lastRefreshedAt\?:\s*string/);
  assert.match(listingJobList, /listingSources\?:\s*Array<Record<string,\s*unknown>>/);
  assert.match(listingJobList, /row\.payload\?\.importedCount/);
  assert.match(listingJobList, /row\.payload\?\.pendingCount/);
  assert.match(listingJobList, /刷新\s*\{new\s+Date\(row\.payload\.lastRefreshedAt\)/);
  assert.match(listingJobList, /new\s+URLSearchParams\(\{\s*limit:\s*String\(limit\)\s*\}\)/);
  assert.match(listingJobList, /entryFilter\s*&&\s*entryFilter\s*!==\s*'collect-page'/);
  assert.match(listingJobList, /params\.set\('entry',\s*entryFilter\)/);
  assert.match(listingJobList, /if\s*\(entryFilter\s*===\s*'1688-listing'\)\s*return\s*e\s*===\s*'1688-listing'/);
  assert.match(listingJobList, /text:\s*'货源上架'/);
  assert.match(listingJobList, /const\s+sourcePlatforms\s*=\s*row\.payload\?\.sourcePlatforms\s*\|\|\s*\[\]/);
  assert.match(listingJobList, /货源平台/);
  assert.match(listingJobList, /货源 SKU/);
  assert.match(listingJobList, /Ozon SKU/);
  assert.match(listingJobDetail, /货源平台/);
  assert.match(listingJobDetail, /货源 SKU/);
  assert.match(listingJobDetail, /Ozon SKU/);
  assert.match(listingJobDetail, /Ozon Product ID/);
  assert.match(listingJobDetail, /Ozon Offer ID/);
  assert.match(listingJobDetail, /const\s+canRefresh\s*=\s*!!data\s*&&\s*\(data\.payload\?\.entry\s*===\s*'1688-listing'/);
  assert.match(listingJobDetail, /disabled=\{refreshing\s*\|\|\s*!canRefresh\}/);
  assert.match(listingJobDetail, /重新拉取 Ozon 结果/);
  assert.match(listingJobDetail, /error\.message\s*\|\|\s*error\.description\s*\|\|\s*error\.code\s*\|\|\s*error\.field/);
  assert.match(listingJobDetail, /成功数/);
  assert.match(listingJobDetail, /处理中/);
  assert.match(listingJobDetail, /刷新时间/);
  assert.match(listingJobDetail, /function\s+listingSourceFor\(offerId:\s*string,\s*index:\s*number\)/);
  assert.match(listingJobDetail, /sourceValue\(source,\s*'offerId'\)\s*===\s*offerId/);
  assert.match(listingJobDetail, /来源追踪/);
  assert.match(listingJobDetail, /const\s+sourceSkuLabel\s*=\s*sourcePlatform\s*\?\s*`\$\{sourcePlatformLabel\(sourcePlatform\)\}\s+SKU`\s*:\s*'货源 SKU'/);
  assert.match(listingJobDetail, /\{sourceSkuLabel\}\s*\{sourceValue\(source,\s*'sourceSkuId'\)\}/);
  assert.match(listingJobDetail, /PID\s*\{sourceValue\(source,\s*'ozonProductId'\)\}/);
});

test('1688 listing preparation routes accept domestic supply source platforms', () => {
  const collectRoute = readRepoFile('apps', 'server', 'src', 'routes', 'collect.ts');

  assert.match(collectRoute, /DOMESTIC_SUPPLY_SOURCE_PLATFORMS/);
  assert.match(collectRoute, /function\s+isDomesticSupplySourcePlatform\(value:\s*unknown\)/);
  assert.match(collectRoute, /where:\s*\{\s*userId,\s*sourcePlatform:\s*\{\s*in:\s*DOMESTIC_SUPPLY_SOURCE_PLATFORMS_LIST\s*\}\s*\}/);
  assert.match(collectRoute, /sourcePlatform:\s*\{\s*in:\s*DOMESTIC_SUPPLY_SOURCE_PLATFORMS_LIST\s*\}/);
  assert.match(collectRoute, /!isDomesticSupplySourcePlatform\(it\.sourcePlatform\)/);
  assert.match(collectRoute, /!isDomesticSupplySourcePlatform\(item\.sourcePlatform\)/);
  assert.match(collectRoute, /货源采集记录/);
  assert.match(collectRoute, /进入货源上架准备/);
  assert.match(collectRoute, /请先进入货源上架准备流程/);
  assert.doesNotMatch(collectRoute, /进入 1688 上架准备|进入 1688 上架准备流程/);
  assert.doesNotMatch(collectRoute, /item\.sourcePlatform\s*!==\s*'1688'/);
  assert.doesNotMatch(collectRoute, /it\.sourcePlatform\s*!==\s*'1688'/);
  assert.doesNotMatch(collectRoute, /where:\s*\{\s*id:\s*\{\s*in:\s*ids\s*\},\s*userId,\s*sourcePlatform:\s*'1688'\s*\}/);
});

test('collect page gates listing actions by domestic supply platforms instead of 1688 only', () => {
  const collectPage = readRepoFile('apps', 'web', 'src', 'app', '(dashboard)', 'collect', 'page.tsx');

  assert.match(collectPage, /DOMESTIC_SUPPLY_SOURCE_PLATFORMS/);
  assert.match(collectPage, /import\s+\{\s*sourcePlatformLabel\s*\}\s+from\s+'@\/lib\/source-platforms'/);
  assert.match(collectPage, /function\s+isDomesticSupplySourcePlatform\(sourcePlatform\?:\s*string\s*\|\s*null\)/);
  assert.match(collectPage, /sourcePlatformLabel\(item\.sourcePlatform\)/);
  assert.match(collectPage, /selectedHasDomesticSupply/);
  assert.match(collectPage, /selectedAllDomesticSupply/);
  assert.match(collectPage, /selectedItems\.some\(\(i\)\s*=>\s*isDomesticSupplySourcePlatform\(i\.sourcePlatform\)\)/);
  assert.match(collectPage, /selectedItems\.every\(\(i\)\s*=>\s*isDomesticSupplySourcePlatform\(i\.sourcePlatform\)\)/);
  assert.match(collectPage, /货源记录需要先走货源上架准备流程/);
  assert.match(collectPage, /货源记录仅保存货源信息/);
  assert.doesNotMatch(collectPage, /selectedHasAlibaba1688/);
  assert.doesNotMatch(collectPage, /selectedAllAlibaba1688/);
  assert.doesNotMatch(collectPage, /sourcePlatform\s*===\s*'1688'/);
  assert.doesNotMatch(collectPage, /\{item\.sourcePlatform\}<\/Badge>/);
});

test('supply goods management accepts all domestic supply platform labels', () => {
  const supplyRoute = readRepoFile('apps', 'server', 'src', 'routes', 'supply.ts');
  const supplyPage = readRepoFile('apps', 'web', 'src', 'app', '(dashboard)', 'supply', 'goods', 'page.tsx');
  const sourcePlatformsLib = readRepoFile('apps', 'web', 'src', 'lib', 'source-platforms.ts');

  for (const platform of ['1688', 'pinduoduo', 'pdd', 'taobao', 'tmall', 'jd', 'other']) {
    assert.match(supplyRoute, new RegExp(`'${platform}'`));
    assert.match(supplyPage, new RegExp(`<option value="${platform}">`));
    assert.match(sourcePlatformsLib, new RegExp(`${platform}:|'${platform}'`));
  }

  assert.match(sourcePlatformsLib, /tmall:\s*'天猫'/);
  assert.match(sourcePlatformsLib, /jd:\s*'京东'/);
  assert.match(sourcePlatformsLib, /pdd:\s*'拼多多'/);
  assert.match(supplyPage, /import\s+\{\s*sourcePlatformLabel\s*\}\s+from\s+'@\/lib\/source-platforms'/);
  assert.match(supplyPage, /sourcePlatformLabel\(item\.sourcePlatform\)/);
  assert.match(supplyPage, /placeholder="https:\/\/detail\.1688\.com\/offer\/\.\.\. \/ 淘宝 \/ 天猫 \/ 京东 \/ 拼多多商品链接"/);
});

test('supply and listing history views render source platform labels', () => {
  const domesticSupplyPage = readRepoFile('apps', 'web', 'src', 'app', '(dashboard)', 'supply', 'domestic', 'page.tsx');
  const listingJobList = readRepoFile('apps', 'web', 'src', 'components', 'listing-job-list.tsx');
  const listingJobDetail = readRepoFile('apps', 'web', 'src', 'components', 'listing-job-detail-dialog.tsx');

  for (const source of [domesticSupplyPage, listingJobList, listingJobDetail]) {
    assert.match(source, /sourcePlatformLabel/);
  }

  assert.match(domesticSupplyPage, /sourcePlatformLabel\(item\.sourcePlatform\)/);
  assert.match(listingJobList, /sourcePlatforms\.map\(sourcePlatformLabel\)\.join\(' \/ '\)/);
  assert.doesNotMatch(listingJobList, /sourcePlatforms\.join\(' \/ '\)/);
  assert.match(listingJobDetail, /renderCodes\(sourcePlatforms,\s*sourcePlatformLabel\)/);
  assert.match(listingJobDetail, /sourcePlatformLabel\(sourcePlatform\)/);
});

test('source platform normalization rejects Ozon trace ids in editable SKU rows', () => {
  const sourcePlatformsLib = readRepoFile('apps', 'web', 'src', 'lib', 'source-platforms.ts');
  const collect1688Page = readRepoFile('apps', 'web', 'src', 'app', '(dashboard)', 'collect', '1688', 'page.tsx');
  const listingPage = readRepoFile('apps', 'web', 'src', 'app', '(dashboard)', 'listing', '1688', 'page.tsx');

  assert.match(sourcePlatformsLib, /return\s+normalized\s+&&\s+SOURCE_PLATFORM_VALUES\.has\(normalized\)\s+\?\s+normalized\s+:\s+undefined/);
  for (const source of [collect1688Page, listingPage]) {
    assert.match(source, /const\s+legacyPlatform\s*=\s*normalizeSourcePlatform\(parts\[8\]\)/);
    assert.match(source, /ozonProductId:\s*isLegacyPlatformColumn\s*\?\s*undefined\s*:\s*parts\[8\]\s*\|\|\s*undefined/);
    assert.match(source, /sourcePlatform:\s*isLegacyPlatformColumn\s*\?\s*legacyPlatform\s*:\s*normalizeSourcePlatform\(parts\[10\]\)/);
  }
});

test('1688 collect page lists domestic supply records with real source platforms', () => {
  const collect1688Page = readRepoFile('apps', 'web', 'src', 'app', '(dashboard)', 'collect', '1688', 'page.tsx');

  assert.match(collect1688Page, /sourcePlatform:\s*string\s*\|\s*null/);
  assert.match(collect1688Page, /import\s+\{\s*normalizeSourcePlatform,\s*sourcePlatformLabel\s*\}\s+from\s+'@\/lib\/source-platforms'/);
  assert.match(collect1688Page, /new\s+URLSearchParams\(\{\s*sourcePlatform:\s*'domestic-supply'/);
  assert.match(collect1688Page, /加载货源采集记录失败/);
  assert.match(collect1688Page, /请先选择货源采集记录/);
  assert.match(collect1688Page, /货源采集上品/);
  assert.match(collect1688Page, /货源商品标题/);
  assert.match(collect1688Page, /货源类目路径/);
  assert.match(collect1688Page, /更多结果请查看货源上架记录详情/);
  assert.match(collect1688Page, /最近货源采集记录/);
  assert.match(collect1688Page, /暂无货源采集记录/);
  assert.match(collect1688Page, /sourcePlatformLabel\(item\.sourcePlatform\)/);
  assert.match(collect1688Page, /货源ID:\s*\{item\.sourceProductId\s*\|\|\s*'-'\}/);
  assert.doesNotMatch(collect1688Page, /new\s+URLSearchParams\(\{\s*sourcePlatform:\s*'1688'/);
  assert.doesNotMatch(collect1688Page, /<Badge variant="outline">1688<\/Badge>/);
  assert.doesNotMatch(collect1688Page, /1688 Offer:/);
  assert.doesNotMatch(collect1688Page, />1688 采集上品</);
  assert.doesNotMatch(collect1688Page, /1688 商品标题/);
  assert.doesNotMatch(collect1688Page, /1688 类目路径/);
});

test('1688 collect page can create records for selected domestic source platforms', () => {
  const collect1688Page = readRepoFile('apps', 'web', 'src', 'app', '(dashboard)', 'collect', '1688', 'page.tsx');

  assert.match(collect1688Page, /sourcePlatform:\s*string;/);
  assert.match(collect1688Page, /sourcePlatform:\s*'1688'/);
  assert.match(collect1688Page, /sourcePlatform:\s*form\.sourcePlatform/);
  assert.match(collect1688Page, /<Label className="text-xs">货源平台<\/Label>/);
  for (const platform of ['1688', 'taobao', 'tmall', 'jd', 'pinduoduo', 'pdd']) {
    assert.match(collect1688Page, new RegExp(`<option value="${platform}">`));
  }
  assert.match(collect1688Page, /<Label className="text-xs">货源商品链接<\/Label>/);
  assert.match(collect1688Page, /placeholder="https:\/\/detail\.1688\.com\/offer\/\.\.\. \/ 淘宝 \/ 天猫 \/ 京东 \/ 拼多多商品链接"/);
});

test('1688 listing preparation page shows real domestic source platforms', () => {
  const listingPage = readRepoFile('apps', 'web', 'src', 'app', '(dashboard)', 'listing', '1688', 'page.tsx');

  assert.match(listingPage, /sourcePlatform:\s*string\s*\|\s*null/);
  assert.match(listingPage, /import\s+\{\s*normalizeSourcePlatform,\s*sourcePlatformLabel\s*\}\s+from\s+'@\/lib\/source-platforms'/);
  assert.match(listingPage, /sourcePlatformLabel\(item\.sourcePlatform\)/);
  assert.match(listingPage, /货源上架准备/);
  assert.match(listingPage, /返回货源采集上品/);
  assert.match(listingPage, /货源上架记录/);
  assert.match(listingPage, /货源ID:\s*\{item\.sourceProductId\s*\|\|\s*'-'\}/);
  assert.match(listingPage, /加载货源上架准备数据失败/);
  assert.match(listingPage, /已保存货源上架准备草稿/);
  assert.match(listingPage, /暂无可准备的货源采集记录/);
  assert.match(listingPage, /最近 \$\{items\.length\} 条货源采集记录/);
  assert.match(listingPage, /当前筛选下暂无货源上架准备记录/);
  assert.doesNotMatch(listingPage, /<Badge variant="outline">1688<\/Badge>/);
  assert.doesNotMatch(listingPage, /1688 Offer:/);
  assert.doesNotMatch(listingPage, />1688 上架准备</);
  assert.doesNotMatch(listingPage, /返回 1688 采集上品/);
  assert.doesNotMatch(listingPage, /1688 上架记录/);
});
