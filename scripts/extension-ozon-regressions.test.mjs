import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function readRepoFile(...parts) {
  return readFileSync(join(root, ...parts), 'utf8');
}

test('Ozon list overlay scans current list widgets and retries transient data failures quickly', () => {
  const source = readRepoFile('extensions', 'ss-erp', 'content', 'ozon-list-overlay.js');

  assert.match(source, /\[data-widget="skuGridSimple"\]\s+\[data-index\]/);
  assert.match(source, /#layoutPage\s+\[data-index\]/);
  assert.match(source, /PREMIUM_FAILURE_TTL_MS\s*=\s*90\s*\*\s*1000/);
  assert.match(source, /PREMIUM_CONCURRENCY\s*=\s*3/);
  assert.match(source, /CARD_SCAN_FAST_MS\s*=\s*500/);
  assert.match(source, /data-ss-erp-overlay-sku/);
});

test('Ozon list overlay attaches only to single-product card targets', () => {
  const source = readRepoFile('extensions', 'ss-erp', 'content', 'ozon-list-overlay.js');

  assert.match(source, /function\s+extractSkuFromHref/);
  assert.match(source, /function\s+collectDistinctProductSkus/);
  assert.match(source, /function\s+resolveProductCardTarget/);
  assert.match(source, /function\s+collectProductCardTargets/);
  assert.match(source, /countDistinctProductSkus\(target\)\s*!==\s*1/);
  assert.match(source, /attachOverlay\(target\)/);
  assert.doesNotMatch(source, /attachOverlay\(card\)/);
  assert.doesNotMatch(source, /io\.observe\(card\)/);
});

test('Ozon list overlay expanded panel uses a body portal to avoid Ozon card clipping', () => {
  const source = readRepoFile('extensions', 'ss-erp', 'content', 'ozon-list-overlay.js');

  assert.match(source, /function\s+createExpandedPortal/);
  assert.match(source, /function\s+positionExpandedPanel/);
  assert.match(source, /function\s+setExpandedPanelOpen/);
  assert.match(source, /document\.body\.appendChild\(expanded\)/);
  assert.match(source, /data-ss-erp-portal/);
  assert.match(source, /ss-erp-overlay-card-expanded/);
  assert.match(source, /position:fixed/);
  assert.match(source, /window\.addEventListener\('scroll'/);
  assert.doesNotMatch(source, /ss-erp-expanded" style=/);
  assert.doesNotMatch(source, /wrap\.querySelector\('\\.ss-erp-expanded'\)/);
  assert.doesNotMatch(source, /position:absolute/);
});

test('Ozon commission sync primes the help center session before document-manager API requests', () => {
  const source = readRepoFile('extensions', 'ss-erp', 'background', 'service-worker.js');

  assert.match(source, /OZON_COMMISSION_BOOTSTRAP_URLS/);
  assert.match(source, /primeOzonCommissionSession/);
  assert.match(source, /fetchCommissionPayloadViaHelpTab/);
  assert.match(source, /isOzonChallengePayload/);
  assert.match(source, /document-manager-api\/global-help\/api\/v3\/document\/public\/by-path/);
  assert.match(source, /credentials:\s*'include'/);
});

test('Ozon seller company id detection falls back to captured x-o3-company-id', () => {
  const source = readRepoFile('extensions', 'ss-erp', 'background', 'collect-background.js');

  assert.match(source, /ss_erp_ozon_company_id/);
  assert.match(source, /getStoredSellerCompanyId/);
  assert.match(source, /refreshSellerCompanyIdFromTab/);
  assert.match(source, /\.ozon\.ru/);
});

test('Ozon collect snapshot queries are scoped to Ozon source records', () => {
  const source = readRepoFile('extensions', 'ss-erp', 'background', 'service-worker.js');

  assert.match(source, /sourcePlatform=ozon/);
  assert.match(source, /JSON\.stringify\(\{\s*skus:\s*skus\.slice\(0,\s*100\),\s*sourcePlatform:\s*'ozon'\s*\}\)/);
});

test('domestic supply extension collect payloads are routed to the dedicated collect endpoint', () => {
  const files = [
    ['extensions', 'ss-erp', 'shared', 'adapters', 'cloud-adapter.js'],
    ['extensions', 'ss-erp', 'shared', 'adapters', 'local-adapter.js'],
    ['extensions', 'ss-erp', 'shared', 'erp-adapter', 'collect-product.js'],
    ['extensions', 'ss-erp', 'background', 'service-worker.js'],
  ];

  for (const parts of files) {
    const source = readRepoFile(...parts);
    assert.match(source, /DOMESTIC_SUPPLY_PLATFORMS/);
    assert.match(source, /1688/);
    assert.match(source, /taobao/);
    assert.match(source, /tmall/);
    assert.match(source, /jd/);
    assert.match(source, /pinduoduo/);
    assert.match(source, /\/api\/collect\/1688/);
    assert.match(source, /sourcePlatform\s*\|\|\s*data\.platform/);
    assert.match(source, /function\s+inferDomesticSupplyPlatform\(payload\)/);
    assert.match(source, /sourcePlatform:\s*inferDomesticSupplyPlatform\(data\)\s*\|\|\s*'1688'/);
    assert.match(source, /function\s+domesticSupplySourceProductId\(data\)\s*\{[\s\S]*?data\.sourceProductId\s*\|\|\s*data\.productId\s*\|\|\s*data\.offerId\s*\|\|\s*data\.sourceOfferId\s*\|\|\s*data\.itemId\s*\|\|\s*data\.item_id\s*\|\|\s*data\.num_iid\s*\|\|\s*data\.numIid\s*\|\|\s*data\.wareId\s*\|\|\s*data\.ware_id\s*\|\|\s*data\.goodsId\s*\|\|\s*data\.goods_id[\s\S]*?\}/);
    assert.match(source, /function\s+normalizeCollectPayload(?:ForEndpoint)?\([^)]*\)\s*\{[\s\S]*?(?:var|const)\s+sourceProductId\s*=\s*domesticSupplySourceProductId\(data\)[\s\S]*?offerId:\s*sourceProductId/);
    assert.match(source, /sourceProductId:\s*sourceProductId/);
    assert.doesNotMatch(source, /return\s+data\.sourceProductId[^\n]*(?:data\.skuId|data\.sourceSkuId|data\.sku)(?:\s|\|\||;)/);
    assert.doesNotMatch(source, /sourceProductId:\s*data\.(?:sku|sourceSkuId|skuId)/);
    assert.match(source, /offerId:\s*sourceProductId/);
    assert.doesNotMatch(source, /sku:\s*sourceProductId/);
    assert.doesNotMatch(source, /sourcePlatform:\s*data\.sourcePlatform\s*\|\|\s*data\.platform\s*\|\|\s*'1688'/);
    assert.doesNotMatch(source, /offerId:\s*data\.offerId\s*\|\|\s*data\.productId\s*\|\|\s*data\.sourceProductId\s*\|\|\s*data\.sku/);
    assert.doesNotMatch(source, /sku:\s*data\.sourceProductId\s*\|\|\s*data\.sku\s*\|\|\s*data\.productId/);
    assert.match(source, /return\s+'taobao'/);
    assert.match(source, /return\s+'tmall'/);
    assert.match(source, /return\s+'jd'/);
    assert.match(source, /return\s+'pinduoduo'/);
    assert.match(source, /supplierLocation/);
    assert.match(source, /minOrderQty/);
    assert.match(source, /shippingInfo/);
    assert.match(source, /customizationInfo/);
    assert.match(source, /priceCheckContext/);
    assert.match(source, /priceCheckContext:\s*data\.priceCheckContext\s*\|\|\s*data\.ozonPriceCheckContext\s*\|\|\s*null/);
    assert.match(source, /lengthMm/);
    assert.match(source, /widthMm/);
    assert.match(source, /heightMm/);
    assert.match(source, /dimensionsText/);
  }
});

test('cloud extension package keeps 1688 search permissions for price checks', () => {
  const buildScript = readRepoFile('scripts', 'build-extension-package.mjs');

  assert.match(buildScript, /'https:\/\/s\.1688\.com\/\*'/);
});

test('Ozon product panel can start a 1688 price check workflow', () => {
  const manifest = JSON.parse(readRepoFile('extensions', 'ss-erp', 'manifest.json'));
  const collectScript = readRepoFile('extensions', 'ss-erp', 'content', 'collect-content-script.js');
  const serviceWorker = readRepoFile('extensions', 'ss-erp', 'background', 'service-worker.js');
  const searchScript = manifest.content_scripts.find((entry) =>
    (entry.matches || []).includes('https://s.1688.com/*')
      && (entry.js || []).includes('content/collect-content-script.js')
  );
  const detailScript = manifest.content_scripts.find((entry) =>
    (entry.matches || []).includes('https://detail.1688.com/*')
      && (entry.js || []).includes('content/collect-content-script.js')
  );

  assert.ok(searchScript, 'collect-content-script must be injected on 1688 search pages');
  assert.ok(detailScript, 'collect-content-script must be injected on 1688 detail pages');
  assert.ok((detailScript.js || []).includes('shared/currency/fx-rates.js'), '1688 price check must load fx rates');
  assert.match(collectScript, /data-role="price-check-1688"/);
  assert.match(collectScript, /1688核价/);
  assert.match(collectScript, /initAlibaba1688PriceCheckSearchPanel/);
  assert.match(collectScript, /ALIBABA_1688_PRICE_CHECK_SEARCH_ID/);
  assert.match(collectScript, /ss-erp:start-1688-price-check/);
  assert.match(collectScript, /OZON_1688_PRICE_CHECK_CONTEXT_KEY/);
  assert.match(collectScript, /const\s+ozonSku\s*=\s*String\(\(payload\s*&&\s*\(payload\.sku\s*\|\|\s*payload\.ozonSku\)\)\s*\|\|\s*""\)\.trim\(\)/);
  assert.doesNotMatch(collectScript, /const\s+ozonSku\s*=\s*String\(\(payload\s*&&\s*\(payload\.sku\s*\|\|\s*payload\.ozonSku\)\)\s*\|\|\s*resolvedProductId/);
  assert.match(collectScript, /ozonProductId:\s*resolvedProductId/);
  assert.match(collectScript, /ozonOfferId:\s*offerId\s*\|\|\s*null/);
  assert.match(collectScript, /buildPriceCheckSummary/);
  assert.match(collectScript, /loadFxSnapshot/);
  assert.match(collectScript, /convertPriceForContext/);
  assert.match(collectScript, /priceToRUB/);
  assert.match(collectScript, /粗差/);
  assert.match(collectScript, /data-role="price-check-clear"/);
  assert.match(collectScript, /clearPriceCheckContext/);
  assert.match(serviceWorker, /ss-erp:start-1688-price-check/);
  assert.match(serviceWorker, /OZON_1688_PRICE_CHECK_CONTEXT_KEY/);
  assert.match(serviceWorker, /sku:\s*toText\(data\.sku\s*\|\|\s*data\.ozonSku\)\.trim\(\)/);
  assert.match(serviceWorker, /ozonSku:\s*toText\(data\.ozonSku\s*\|\|\s*data\.sku\)\.trim\(\)/);
  assert.match(serviceWorker, /offerId:\s*toText\(data\.offerId\s*\|\|\s*data\.offer_id\s*\|\|\s*data\.ozonOfferId\)\.trim\(\)/);
  assert.match(serviceWorker, /ozonOfferId:\s*toText\(data\.ozonOfferId\s*\|\|\s*data\.offerId\s*\|\|\s*data\.offer_id\)\.trim\(\)/);
  assert.match(serviceWorker, /build1688SearchUrlFromOzonContext/);
  assert.match(serviceWorker, /s\.1688\.com\/youyuan\/index\.htm/);
  assert.match(serviceWorker, /chrome\.tabs\.create/);
});

test('domestic supply product pages expose a direct collect-to-ERP action', () => {
  const manifest = JSON.parse(readRepoFile('extensions', 'ss-erp', 'manifest.json'));
  const collectScript = readRepoFile('extensions', 'ss-erp', 'content', 'collect-content-script.js');
  const detailScript = manifest.content_scripts.find((entry) =>
    (entry.matches || []).includes('https://detail.1688.com/*')
      && (entry.matches || []).includes('https://item.jd.com/*')
      && (entry.matches || []).includes('https://item.taobao.com/*')
      && (entry.matches || []).includes('https://detail.tmall.com/*')
      && (entry.matches || []).includes('https://mobile.pinduoduo.com/*')
      && (entry.matches || []).includes('https://mobile.yangkeduo.com/*')
      && (entry.js || []).includes('content/collect-content-script.js')
  );

  assert.ok(detailScript, 'collect-content-script must be injected on domestic supply product pages');
  assert.match(collectScript, /function\s+isDomesticSupplyProductPage\(\)/);
  assert.match(collectScript, /if\s*\(!isDomesticSupplyProductPage\(\)\)\s*\{\s*return;\s*\}/);
  assert.match(collectScript, /initAlibaba1688CollectButton/);
  assert.match(collectScript, /采集到ERP/);
  assert.match(collectScript, /ozon-calc:collect-to-erp/);
  assert.ok(collectScript.includes('detail\\.1688\\.com'));
  assert.ok(collectScript.includes('offer\\/\\d+\\.html'));
  assert.ok(collectScript.includes('item\\.jd\\.com\\/\\d+\\.html'));
  assert.ok(collectScript.includes('item\\.taobao\\.com\\/item\\.htm'));
  assert.ok(collectScript.includes('detail\\.tmall\\.com\\/item\\.htm'));
  assert.ok(collectScript.includes('mobile\\.(?:pinduoduo|yangkeduo)\\.com\\/goods'));
  assert.match(collectScript, /if\s*\(platform === "pinduoduo"\)/);
  assert.match(collectScript, /pinduoduo:\s*extractPinduoduoProduct/);
  assert.match(collectScript, /function\s+extractPinduoduoProduct/);
});

test('domestic supply product page detection covers common mobile and query URL forms', () => {
  const manifest = JSON.parse(readRepoFile('extensions', 'ss-erp', 'manifest.json'));
  const collectScript = readRepoFile('extensions', 'ss-erp', 'content', 'collect-content-script.js');
  const detailScript = manifest.content_scripts.find((entry) =>
    (entry.matches || []).includes('https://h5.m.taobao.com/*')
      && (entry.matches || []).includes('https://item.m.jd.com/*')
      && (entry.matches || []).includes('https://mitem.jd.com/*')
      && (entry.matches || []).includes('https://mobile.pinduoduo.com/*')
      && (entry.js || []).includes('content/collect-content-script.js')
  );

  assert.ok(detailScript, 'collect-content-script must be injected on common mobile supply product pages');
  assert.match(collectScript, /function\s+currentUrlText\(\)/);
  assert.match(collectScript, /if\s*\(platform === "jd"\)\s*return isJdProductPage\(\)/);
  assert.match(collectScript, /if\s*\(platform === "taobao"\)\s*return isTaobaoProductPage\(\)/);
  assert.match(collectScript, /if\s*\(platform === "tmall"\)\s*return isTmallProductPage\(\)/);
  assert.match(collectScript, /if\s*\(platform === "pinduoduo"\)\s*return isPinduoduoProductPage\(\)/);
  assert.match(collectScript, /function\s+isJdProductPage\(\)/);
  assert.ok(collectScript.includes('item\\.m\\.jd\\.com'));
  assert.ok(collectScript.includes('mitem\\.jd\\.com'));
  assert.match(collectScript, /function\s+isTaobaoProductPage\(\)/);
  assert.ok(collectScript.includes('h5\\.m\\.taobao\\.com'));
  assert.match(collectScript, /function\s+isTmallProductPage\(\)/);
  assert.ok(collectScript.includes('detail\\.m\\.tmall\\.com'));
  assert.match(collectScript, /function\s+isPinduoduoProductPage\(\)/);
  assert.match(collectScript, /goods_id\|goodsId/);
});

test('1688 product extraction includes price and category fields for ERP records', () => {
  const collectScript = readRepoFile('extensions', 'ss-erp', 'content', 'collect-content-script.js');
  const pageBridge = readRepoFile('extensions', 'ss-erp', 'content', 'page-bridge.js');

  assert.match(collectScript, /priceSelectors/);
  assert.match(collectScript, /categorySelectors/);
  assert.match(collectScript, /descriptionSelectors/);
  assert.match(collectScript, /function\s+pickPrice/);
  assert.match(collectScript, /function\s+pickCategoryPath/);
  assert.match(collectScript, /function\s+pickDescription/);
  assert.match(collectScript, /collectStringCandidates\(sources,\s*\/\(description\|desc\|productDescription\|detailDesc\|详情\|描述\|说明\)\$\/i,\s*6000\)/);
  assert.match(collectScript, /function\s+collectStringCandidates\(sources,\s*regex,\s*maxLength\s*=\s*300\)/);
  assert.match(collectScript, /function\s+pickSupplierInfo/);
  assert.match(collectScript, /function\s+pickMinOrderQty/);
  assert.match(collectScript, /function\s+pickShippingInfo/);
  assert.match(collectScript, /function\s+pickCustomizationInfo/);
  assert.match(collectScript, /function\s+pickDimensions/);
  assert.match(collectScript, /function\s+collectStructuredDimensionCandidates/);
  assert.match(collectScript, /function\s+classifyDimensionKey/);
  assert.match(collectScript, /function\s+parseDimensionText/);
  assert.match(collectScript, /function\s+convertLengthToMm/);
  assert.match(collectScript, /function\s+guessLengthUnit/);
  assert.match(collectScript, /function\s+parseEmbeddedJsonData/);
  assert.match(collectScript, /allSources\.push\(\.\.\.embeddedJson\)/);
  assert.match(collectScript, /script\[type\*="json"\]/);
  assert.doesNotMatch(collectScript, /productId\|offerId\|itemId\|goodsId\|skuId\|nmId/);
  assert.match(collectScript, /pickStringByKey\(sources,\s*\/\^\(productId\|offerId\|itemId\|item_id\|num_iid\|numIid\|wareId\|ware_id\|goodsId\|goods_id\|nmId\|nmID\)\$\/i\)/);
  assert.doesNotMatch(collectScript, /pickStringByKey\(sources,\s*\/\^\([^)]*(?:sku|skuId|sourceSkuId|ozonSku|ozonProductId|ozonOfferId)[^)]*\)\$\/i\)/i);
  const productIdKeyMatch = collectScript.match(/pickStringByKey\(sources,\s*\/\^\(([^)]+)\)\$\/i\)/);
  assert.ok(productIdKeyMatch, 'product id extractor key list must be visible');
  const productIdKeys = productIdKeyMatch[1].split('|');
  assert.ok(!productIdKeys.includes('id'), 'generic id must not be promoted to sourceProductId');
  for (const forbidden of ['sku', 'skuId', 'sourceSkuId', 'ozonSku', 'ozonProductId', 'ozonOfferId']) {
    assert.ok(!productIdKeys.includes(forbidden), `${forbidden} must not be promoted to sourceProductId`);
  }
  assert.match(collectScript, /function\s+normalizeSkuAttrs/);
  assert.match(collectScript, /function\s+normalizeSkuImages/);
  assert.match(collectScript, /\["image",\s*"imageUrl",\s*"imgUrl",\s*"picUrl",\s*"skuImage",\s*"skuImageUrl",\s*"previewImage",\s*"thumbUrl",\s*"mainImage"\]/);
  assert.match(collectScript, /ozonSku\s*=\s*pickFirstValue\(item,\s*\["ozonSku",\s*"ozon_sku",\s*"targetOzonSku",\s*"target_ozon_sku",\s*"targetSku",\s*"ozonProductSku"\]\)/);
  assert.match(collectScript, /ozonProductId\s*=\s*pickFirstValue\(item,\s*\["ozonProductId",\s*"ozon_product_id",\s*"targetOzonProductId",\s*"target_ozon_product_id"\]\)/);
  assert.match(collectScript, /ozonOfferId\s*=\s*pickFirstValue\(item,\s*\["ozonOfferId",\s*"ozon_offer_id",\s*"targetOzonOfferId",\s*"target_ozon_offer_id"\]\)/);
  assert.match(collectScript, /const\s+sourceSkuId\s*=\s*pickFirstValue\(item,\s*\["sourceSkuId",\s*"source_sku_id",\s*"sourceSku",\s*"source_sku",\s*"skuId",\s*"sku_id",\s*"specId",\s*"nameId"\]\)/);
  const sourceSkuKeyMatch = collectScript.match(/const\s+sourceSkuId\s*=\s*pickFirstValue\(item,\s*\[([^\]]+)\]\)/);
  assert.ok(sourceSkuKeyMatch, 'source SKU extractor key list must be visible');
  const sourceSkuKeys = sourceSkuKeyMatch[1].match(/"([^"]+)"/g).map((value) => value.replace(/"/g, ''));
  assert.ok(sourceSkuKeys.includes('specId'), 'variant specId must be accepted as a source SKU trace');
  assert.ok(sourceSkuKeys.includes('nameId'), 'variant nameId must be accepted as a source SKU trace');
  assert.ok(!sourceSkuKeys.includes('id'), 'generic row id must not be promoted to sourceSkuId');
  assert.ok(!sourceSkuKeys.includes('offerId'), 'product-level offerId must not be promoted to sourceSkuId');
  assert.match(collectScript, /const\s+skuId\s*=\s*sourceSkuId/);
  assert.match(collectScript, /sourceSkuId:\s*sourceSkuId == null \? "" : String\(sourceSkuId\)/);
  assert.match(collectScript, /ozonSku:\s*ozonSku == null \? "" : String\(ozonSku\)/);
  assert.match(collectScript, /ozonProductId:\s*ozonProductId == null \? "" : String\(ozonProductId\)/);
  assert.match(collectScript, /ozonOfferId:\s*ozonOfferId == null \? "" : String\(ozonOfferId\)/);
  assert.match(collectScript, /function\s+pickSkuItemsFromDom/);
  assert.match(collectScript, /pickSkuItemsFromDom\(\)/);
  assert.match(collectScript, /\[data-sku-id\]/);
  assert.doesNotMatch(collectScript, /skuId:\s*skuId\s*\|\|\s*`dom-sku-\$\{items\.length \+ 1\}`/);
  assert.match(collectScript, /const\s+price\s*=\s*parseDecimalNumber\(pickFirstValue\(item,\s*\["price",\s*"salePrice",\s*"finalPrice",\s*"discountPrice",\s*"promotionPrice"\]\)\)/);
  assert.match(collectScript, /priceText:\s*priceInfo\.priceText/);
  assert.match(collectScript, /attributes,\s*description,/);
  assert.match(collectScript, /categoryPath/);
  assert.match(collectScript, /supplierLocation/);
  assert.match(collectScript, /lengthMm:\s*dimensions\.lengthMm/);
  assert.match(collectScript, /widthMm:\s*dimensions\.widthMm/);
  assert.match(collectScript, /heightMm:\s*dimensions\.heightMm/);
  assert.match(collectScript, /dimensionsText:\s*dimensions\.rawText/);
  assert.match(collectScript, /dimensionCandidates/);
  assert.match(collectScript, /minOrderQty/);
  assert.match(collectScript, /logisticsText/);
  assert.match(collectScript, /customizationInfo/);
  assert.match(pageBridge, /__GLOBAL_DATA__/);
  assert.match(pageBridge, /offerDetailData/);
  assert.match(pageBridge, /goodsDetailData/);
  assert.match(pageBridge, /goodsData/);
  assert.match(pageBridge, /mallData/);
  assert.match(pageBridge, /skuData/);
  assert.ok(collectScript.includes('[¥￥]'));
  assert.ok(collectScript.includes('元|CNY|RMB'));
});

test('domestic supply extraction scans object SKU maps from page globals', () => {
  const collectScript = readRepoFile('extensions', 'ss-erp', 'content', 'collect-content-script.js');
  const pageBridge = readRepoFile('extensions', 'ss-erp', 'content', 'page-bridge.js');

  for (const globalName of ['skuMap', 'skuInfoMap', 'skuCore', 'skuBase', 'skuProps', 'priceInfo']) {
    assert.match(pageBridge, new RegExp(`"${globalName}"`));
  }

  assert.match(collectScript, /function\s+collectSkuMapCandidates\(sources\)/);
  assert.match(collectScript, /function\s+normalizeSkuMapItems\(mapValue,\s*pathText\)/);
  assert.match(collectScript, /function\s+looksLikeSkuMap\(value,\s*pathText\)/);
  assert.match(collectScript, /const\s+skuMaps\s*=\s*\[\]/);
  assert.match(collectScript, /const\s+mapItems\s*=\s*normalizeSkuMapItems\(value,\s*pathText\)/);
  assert.match(collectScript, /skuMap|skuInfoMap|skuInfo|skuCore|skuBase|skuProps|priceInfo|priceMap|skuPriceMap/);
  assert.match(collectScript, /sourceSkuId:\s*skuKey/);
  assert.match(collectScript, /skuId:\s*skuKey/);
  assert.match(collectScript, /normalizeSkuItem\(item\)/);
  assert.doesNotMatch(collectScript, /sourceSkuId:\s*item\.id\s*\|\|\s*skuKey/);
  assert.doesNotMatch(collectScript, /sourceSkuId:\s*item\.offerId\s*\|\|\s*skuKey/);
});

test('domestic supply extractors keep price category and description selectors', () => {
  const collectScript = readRepoFile('extensions', 'ss-erp', 'content', 'collect-content-script.js');
  const extractorNames = [
    'extractJdProduct',
    'extractTaobaoProduct',
    'extractTmallProduct',
    'extractPinduoduoProduct',
  ];

  for (const extractorName of extractorNames) {
    const source = collectScript.match(new RegExp(`function\\s+${extractorName}\\(context\\)\\s*\\{[\\s\\S]*?\\n\\s*\\}\\n`));
    assert.ok(source, `${extractorName} must exist`);
    assert.match(source[0], /priceSelectors:\s*\[/, `${extractorName} must read visible purchase prices`);
    assert.match(source[0], /categorySelectors:\s*\[/, `${extractorName} must read source category paths for later mapping`);
    assert.match(source[0], /descriptionSelectors:\s*\[/, `${extractorName} must read source descriptions for later translation/listing`);
  }
});

test('Ozon shop analytics sync falls back from charts table to what-to-sell data', () => {
  const source = readRepoFile('extensions', 'ss-erp', 'background', 'collect-background.js');

  assert.match(source, /syncShopAnalyticsWithFallback/);
  assert.match(source, /fetchShopAnalyticsFromChartsV3/);
  assert.match(source, /fetchShopAnalyticsFromWhatToSell/);
  assert.match(source, /mapChartsV3AnalyticsItem/);
  assert.match(source, /mapWhatToSellAnalyticsItem/);
  assert.match(source, /OZON_ENDPOINTS\.chartsV3TableBySku/);
  assert.match(source, /OZON_ENDPOINTS\.analytics/);
  assert.match(source, /analyticsSource/);
  assert.doesNotMatch(source, /不再依赖\s+what_to_sell\/data\/v3/);
});

test('production sources and extension package do not contain competitor brand markers', () => {
  const files = [
    ['extensions', 'ss-erp', 'content', 'ozon-list-overlay.js'],
    ['extensions', 'ss-erp', 'background', 'service-worker.js'],
    ['apps', 'server', 'src', 'routes', 'collect.ts'],
  ];
  const blocked = new RegExp(['企' + '鹅', '店' + '长', 'qe' + 'help', 'hq' + 'ozon'].join('|'), 'i');

  for (const parts of files) {
    assert.doesNotMatch(readRepoFile(...parts), blocked, parts.join('/'));
  }
});
