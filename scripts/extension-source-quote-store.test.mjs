import assert from 'node:assert/strict';

const helper = await import('../extensions/ss-erp/shared/source-quotes/source-quote-store.js');
const api = helper.default || helper.SS_ERP_SOURCE_QUOTE_STORE || globalThis.SS_ERP_SOURCE_QUOTE_STORE;

assert.ok(api, 'source quote store should be exported');
assert.equal(typeof api.normalizeQuote, 'function', 'normalizeQuote should be exported');
assert.equal(typeof api.upsertQuote, 'function', 'upsertQuote should be exported');
assert.equal(typeof api.listQuotesForOzon, 'function', 'listQuotesForOzon should be exported');
assert.equal(typeof api.exportQuotesAsCsv, 'function', 'exportQuotesAsCsv should be exported');

const now = '2026-06-11T10:00:00.000Z';
const quote = api.normalizeQuote({
  ozon: {
    productId: '1628675309',
    title: 'Ozon sample product',
    url: 'https://www.ozon.ru/product/sample-1628675309/',
    price: { value: 1299, currency: 'RUB' },
  },
  sourceProduct: {
    sourcePlatform: '1688',
    productId: '733344455566',
    title: '1688 同款货源',
    sourceUrl: 'https://detail.1688.com/offer/733344455566.html',
    priceText: '￥12.80',
    skuItems: [{ skuId: 'red-l', name: '红色 L', price: 12.8, stock: 22 }],
    shopName: '义乌源头厂',
  },
}, null, { now });

assert.equal(quote.status, 'selected_for_costing');
assert.equal(quote.ozon.productId, '1628675309');
assert.equal(quote.ozon.url, 'https://www.ozon.ru/product/sample-1628675309');
assert.equal(quote.source.platform, '1688');
assert.equal(quote.source.productId, '733344455566');
assert.equal(quote.source.sku, 'red-l');
assert.equal(quote.source.price.value, 12.8);
assert.equal(quote.source.price.currency, 'CNY');
assert.equal(quote.costCny, 12.8);
assert.equal(quote.createdAt, now);
assert.equal(quote.updatedAt, now);

let quotes = api.upsertQuote([], quote);
quotes = api.upsertQuote(quotes, api.normalizeQuote({
  ozon: quote.ozon,
  sourceProduct: {
    sourcePlatform: '1688',
    productId: '733344455566',
    sourceUrl: 'https://detail.1688.com/offer/733344455566.html',
    priceText: '13.50元',
    skuItems: [{ skuId: 'red-l', name: '红色 L', price: 13.5 }],
  },
}, quote, { now: '2026-06-11T10:10:00.000Z' }));

assert.equal(quotes.length, 1, 'same Ozon/source/SKU quote should update instead of duplicating');
assert.equal(quotes[0].costCny, 13.5);
assert.equal(quotes[0].createdAt, now);
assert.equal(quotes[0].updatedAt, '2026-06-11T10:10:00.000Z');

const listed = api.listQuotesForOzon(quotes, '1628675309');
assert.equal(listed.length, 1);
assert.equal(listed[0].source.sku, 'red-l');

const csv = api.exportQuotesAsCsv(quotes);
assert.match(csv, /ozonSku,ozonUrl,ozonTitle,ozonCostingInputPriceCny,sourcePlatform,sourceProductId,sourceSku,sourceUrl,sourceTitle,purchaseCostCny,sourceUnitPrice,sourceShippingCny,sourcePriceText,status,createdAt,updatedAt/);
assert.match(csv, /1628675309/);
assert.match(csv, /733344455566/);
assert.match(csv, /13\.5/);

const objectPriceQuote = api.normalizeQuote({
  ozon: quote.ozon,
  sourceProduct: {
    sourcePlatform: 'taobao',
    productId: '99887766',
    sourceUrl: 'https://item.taobao.com/item.htm?id=99887766',
    price: { value: 19.9, currency: 'CNY', text: '¥19.90' },
  },
}, null, { now });

assert.equal(objectPriceQuote.source.price.value, 19.9);
assert.equal(objectPriceQuote.source.price.currency, 'CNY');
assert.equal(objectPriceQuote.costCny, 19.9);

const shippingQuote = api.normalizeQuote({
  ozon: quote.ozon,
  sourceProduct: {
    sourcePlatform: '1688',
    productId: '1032907994887',
    sourceUrl: 'https://detail.1688.com/offer/1032907994887.html',
    priceCny: 98,
    priceText: '¥98',
    shippingCny: 6,
    shippingText: '运费 ¥6 起',
    totalCostCny: 104,
    selectedSku: { skuId: 'large-filter', name: '大号过滤制氧一体', price: 98 },
  },
}, null, { now });

assert.equal(shippingQuote.source.price.value, 98);
assert.equal(shippingQuote.source.shippingFee.value, 6);
assert.equal(shippingQuote.source.totalCostCny, 104);
assert.equal(shippingQuote.source.sku, 'large-filter');
assert.equal(shippingQuote.costCny, 104);

const ozonContextWithFallbackPrice = api.normalizeQuote({
  ozon: {
    productId: '1888000111',
    title: 'Ozon context with fallback seller price',
    url: 'https://www.ozon.ru/product/fallback-1888000111/',
    price: { value: 0, currency: 'RUB' },
    pagePriceValue: 1499,
    pagePriceCurrency: 'RUB',
    currentPriceValue: 1599,
    costingInputPriceCny: 119.92,
  },
  sourceProduct: {
    sourcePlatform: '1688',
    productId: '858352817684',
    sourceUrl: 'https://detail.1688.com/offer/858352817684.html',
    selectedSku: { skuId: '016-white-en', specText: '016白色英文款', price: 13.5 },
    shippingCny: 4.5,
    totalCostCny: 18,
  },
}, null, { now });

assert.equal(ozonContextWithFallbackPrice.ozon.price.value, 119.92);
assert.equal(ozonContextWithFallbackPrice.ozon.price.currency, 'CNY');

const fallbackPriceCsv = api.exportQuotesAsCsv([ozonContextWithFallbackPrice]);
assert.match(
  fallbackPriceCsv,
  /ozonSku,ozonUrl,ozonTitle,ozonCostingInputPriceCny,sourcePlatform,sourceProductId,sourceSku,sourceUrl,sourceTitle,purchaseCostCny,sourceUnitPrice,sourceShippingCny,sourcePriceText,status,createdAt,updatedAt/,
);
assert.match(fallbackPriceCsv, /1888000111/);
assert.match(fallbackPriceCsv, /119\.92/);
assert.match(fallbackPriceCsv, /016-white-en/);
assert.match(fallbackPriceCsv, /18/);

console.log('PASS source quote store');
