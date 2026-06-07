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

test('1688 extension collect payloads are routed to the dedicated collect endpoint', () => {
  const files = [
    ['extensions', 'ss-erp', 'shared', 'adapters', 'cloud-adapter.js'],
    ['extensions', 'ss-erp', 'shared', 'adapters', 'local-adapter.js'],
    ['extensions', 'ss-erp', 'shared', 'erp-adapter', 'collect-product.js'],
    ['extensions', 'ss-erp', 'background', 'service-worker.js'],
  ];

  for (const parts of files) {
    const source = readRepoFile(...parts);
    assert.match(source, /1688/);
    assert.match(source, /\/api\/collect\/1688/);
    assert.match(source, /sourcePlatform\s*\|\|\s*data\.platform/);
    assert.match(source, /supplierLocation/);
    assert.match(source, /minOrderQty/);
    assert.match(source, /shippingInfo/);
    assert.match(source, /customizationInfo/);
    assert.match(source, /priceCheckContext/);
    assert.match(source, /lengthMm/);
    assert.match(source, /widthMm/);
    assert.match(source, /heightMm/);
    assert.match(source, /dimensionsText/);
  }
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
  assert.match(collectScript, /buildPriceCheckSummary/);
  assert.match(collectScript, /loadFxSnapshot/);
  assert.match(collectScript, /convertPriceForContext/);
  assert.match(collectScript, /priceToRUB/);
  assert.match(collectScript, /粗差/);
  assert.match(collectScript, /data-role="price-check-clear"/);
  assert.match(collectScript, /clearPriceCheckContext/);
  assert.match(serviceWorker, /ss-erp:start-1688-price-check/);
  assert.match(serviceWorker, /OZON_1688_PRICE_CHECK_CONTEXT_KEY/);
  assert.match(serviceWorker, /build1688SearchUrlFromOzonContext/);
  assert.match(serviceWorker, /s\.1688\.com\/youyuan\/index\.htm/);
  assert.match(serviceWorker, /chrome\.tabs\.create/);
});

test('1688 product pages expose a direct collect-to-ERP action', () => {
  const manifest = JSON.parse(readRepoFile('extensions', 'ss-erp', 'manifest.json'));
  const collectScript = readRepoFile('extensions', 'ss-erp', 'content', 'collect-content-script.js');
  const detailScript = manifest.content_scripts.find((entry) =>
    (entry.matches || []).includes('https://detail.1688.com/*')
      && (entry.js || []).includes('content/collect-content-script.js')
  );

  assert.ok(detailScript, 'collect-content-script must be injected on 1688 detail pages');
  assert.match(collectScript, /initAlibaba1688CollectButton/);
  assert.match(collectScript, /采集到ERP/);
  assert.match(collectScript, /ozon-calc:collect-to-erp/);
  assert.ok(collectScript.includes('detail\\.1688\\.com'));
  assert.ok(collectScript.includes('offer\\/\\d+\\.html'));
});

test('1688 product extraction includes price and category fields for ERP records', () => {
  const collectScript = readRepoFile('extensions', 'ss-erp', 'content', 'collect-content-script.js');

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
  assert.match(collectScript, /function\s+normalizeSkuAttrs/);
  assert.match(collectScript, /function\s+pickSkuItemsFromDom/);
  assert.match(collectScript, /pickSkuItemsFromDom\(\)/);
  assert.match(collectScript, /\[data-sku-id\]/);
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
  assert.ok(collectScript.includes('[¥￥]'));
  assert.ok(collectScript.includes('元|CNY|RMB'));
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
