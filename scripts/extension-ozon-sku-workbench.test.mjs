import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function loadWorkbench(globals = {}) {
  const source = fs.readFileSync('extensions/ss-erp/shared/ozon/sku-workbench.js', 'utf8');
  const sandbox = { console, ...globals };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: 'sku-workbench.js' });
  return sandbox.SS_ERP_OZON_SKU_WORKBENCH;
}

test('normalizes Ozon seller analytics field aliases into one SKU metrics shape', () => {
  const workbench = loadWorkbench();

  const metrics = workbench.normalizeOzonAnalyticsRow({
    sku: 1502334613,
    gmvSum: '12750.5',
    soldCount: '31',
    pdpToCartConversion: '8.4',
    qtyViewPdp: 42,
    views: 210,
    returnCancelRate: '14.2',
    nullableRedemptionRate: '85.8',
    nullableCreateDate: '2026-06-01T10:00:00Z',
    category1: 'Дом',
    category3: 'Декор',
    minSellerPrice: { cardPrice: { price: '399' } },
    advExpenseShare: '4.69%',
    promoDays: 16,
    promotionDiscount: '18.17',
    promoConversionRate: 0.3563,
    paidPromotionDays: '20',
    productCardViews: 13996,
    productCardToCartRate: '13.57',
    searchCatalogViews: '20898',
    searchCatalogToCartRate: '0.56%',
    showConversionRate: '0.14',
    productClickRate: '3.32',
  });

  assert.equal(metrics.sku, '1502334613');
  assert.equal(metrics.soldSum, 12750.5);
  assert.equal(metrics.soldCount, 31);
  assert.equal(metrics.convToCartPdp, 8.4);
  assert.equal(metrics.clickThroughRate, 20);
  assert.equal(metrics.returnCancelRate, 14.2);
  assert.equal(metrics.nullableRedemptionRate, 85.8);
  assert.equal(metrics.createDate, '2026-06-01T10:00:00Z');
  assert.equal(metrics.categoryPath, 'Дом / Декор');
  assert.equal(metrics.minSellerPrice, 399);
  assert.equal(metrics.adExpenseShare, 4.69);
  assert.equal(metrics.promoDays, 16);
  assert.equal(metrics.promoDiscountPercent, 18.17);
  assert.equal(metrics.promoConversionRate, 35.63);
  assert.equal(metrics.paidPromotionDays, 20);
  assert.equal(metrics.productCardViews, 13996);
  assert.equal(metrics.productCardAddToCartRate, 13.57);
  assert.equal(metrics.searchCatalogViews, 20898);
  assert.equal(metrics.searchCatalogAddToCartRate, 0.56);
  assert.equal(metrics.showConversionRate, 0.14);
  assert.equal(metrics.productClickRate, 3.32);
});

test('derives Ozon return/cancel rate from nullable redemption rate without relabeling redemption as returns', () => {
  const workbench = loadWorkbench();

  const metrics = workbench.normalizeOzonAnalyticsRow({
    sku: '1379499497',
    nullableRedemptionRate: '90.8',
  });

  assert.equal(metrics.nullableRedemptionRate, 90.8);
  assert.equal(metrics.returnCancelRate, 9.2);
});

test('keeps direct return/cancel aliases ahead of derived redemption fallback', () => {
  const workbench = loadWorkbench();

  const metrics = workbench.normalizeOzonAnalyticsRow({
    sku: '4665712699',
    nullableRedemptionRate: '97',
    cancelReturnRate: '12.8',
  });

  assert.equal(metrics.nullableRedemptionRate, 97);
  assert.equal(metrics.returnCancelRate, 12.8);
});

test('keeps fractional add-to-cart rates as percentages without 100x inflation', () => {
  const workbench = loadWorkbench();

  assert.equal(workbench.normalizeRatePercent(0.084), 8.4);
  assert.equal(workbench.normalizeRatePercent('8.4'), 8.4);
  assert.equal(workbench.normalizeRatePercent('8.4%'), 8.4);
});

test('normalizes Penguin and Maozi Ozon analytics aliases used by richer SKU tables', () => {
  const workbench = loadWorkbench();

  const metrics = workbench.normalizeOzonAnalyticsRow({
    sku: '2515213005',
    sales: '45',
    gmv: '19050',
    convTocartPdp: '7.2',
    convToCartSearch: '4.5',
    convViewToOrder: '2.1',
    nullableRedemptionRate: '89.1',
    drr: '3.8',
    daysWithTrafarets: '12',
    daysInPromo: '9',
    promoRevenueShare: '22.4',
    pCreateDate: '2026-06-02T08:00:00Z',
    sellerCount: '5',
    hasGollowSales: true,
    commission: '12.5%',
    pWeight: '380',
    ptj: 'T2',
  });

  assert.equal(metrics.soldCount, 45);
  assert.equal(metrics.soldSum, 19050);
  assert.equal(metrics.convToCartPdp, 7.2);
  assert.equal(metrics.convToCartSearch, 4.5);
  assert.equal(metrics.convViewToOrder, 2.1);
  assert.equal(metrics.nullableRedemptionRate, 89.1);
  assert.equal(metrics.adExpenseShare, 3.8);
  assert.equal(metrics.daysWithTrafarets, 12);
  assert.equal(metrics.promoDays, 9);
  assert.equal(metrics.promoRevenueShare, 22.4);
  assert.equal(metrics.createDate, '2026-06-02T08:00:00Z');
  assert.equal(metrics.sellerCount, 5);
  assert.equal(metrics.hasFollowSales, true);
  assert.equal(metrics.commissionRate, 12.5);
  assert.equal(metrics.weightGrams, 380);
  assert.equal(metrics.ptj, 'T2');
});

test('normalizes exact what-to-sell analytics fields and derived Ozon workbench metrics', () => {
  const workbench = loadWorkbench();

  const metrics = workbench.normalizeOzonAnalyticsRow({
    sku: '4289134241',
    brand: 'Weigan',
    category1: 'Дом',
    category1Id: 100,
    category2Id: 200,
    category3: 'Декор',
    category3Id: 300,
    soldCount: 181,
    soldSum: 151370,
    salesDynamics: '191.4',
    avgOrdersOnAccDays: '6.03',
    avgGmvOnAccDays: '5045.67',
    drr: '4.2',
    daysInPromo: 28,
    discount: '15.5',
    promoRevenueShare: '80',
    daysWithTrafarets: 28,
    qtyViewPdp: 160740,
    convToCartPdp: '21.87',
    sessionCountSearch: '29880',
    convToCartSearch: '93',
    convViewToOrder: '4.3',
    salesSchema: 'FBO',
    nullableCreateDate: '2026-05-13T00:00:00Z',
    nullableRedemptionRate: '95.7',
    views: 410000,
    variantId: 987654,
  }, { now: '2026-07-04T00:00:00Z' });

  assert.equal(metrics.brand, 'Weigan');
  assert.equal(metrics.categoryPath, 'Дом / Декор');
  assert.equal(metrics.category1Id, 100);
  assert.equal(metrics.category2Id, 200);
  assert.equal(metrics.category3Id, 300);
  assert.equal(metrics.avgOrdersOnAccDays, 6.03);
  assert.equal(metrics.avgGmvOnAccDays, 5045.67);
  assert.equal(metrics.adExpenseShare, 4.2);
  assert.equal(metrics.promoDays, 28);
  assert.equal(metrics.promoDiscountPercent, 15.5);
  assert.equal(metrics.promoRevenueShare, 80);
  assert.equal(metrics.paidPromotionDays, 28);
  assert.equal(metrics.productCardViews, 160740);
  assert.equal(metrics.searchCatalogViews, 29880);
  assert.equal(metrics.showConversionRate, 4.3);
  assert.equal(metrics.productClickRate, 39.2);
  assert.equal(metrics.returnCancelRate, 4.3);
  assert.equal(metrics.createDays, 52);
  assert.equal(metrics.variantId, 987654);
});

test('matches commission from category rules when seller analytics has no direct commission rate', () => {
  const workbench = loadWorkbench();

  const row = workbench.buildSkuWorkbenchRow({
    sku: '4289134241',
    pagePrice: 1200,
    fxRate: 0.08,
    metrics: {
      category1: 'Дом',
      category3: 'Декор',
      salesSchema: 'FBO',
    },
    commissionSnapshot: {
      rules: [
        {
          category: 'Декор',
          group: 'Дом',
          aliases: ['Дом', 'Декор'],
          bands: [{ minRUB: 0, maxRUB: 1500, rfbs: 9.5, fbp: 11.5 }],
        },
      ],
    },
  });

  assert.equal(row.commissionRate, 11.5);
  assert.equal(row.rfbsCommission, 9.5);
  assert.equal(row.fbpCommission, 11.5);
  assert.equal(row.commissionSource, 'official');
  assert.equal(row.commissionCny, 11.04);
});

test('uses rFBS commission as preferred rate for seller FBS schema', () => {
  const workbench = loadWorkbench();

  const row = workbench.buildSkuWorkbenchRow({
    sku: '3740401288',
    pagePrice: 1000,
    fxRate: 0.08,
    metrics: {
      category1: 'Дом и сад',
      salesSchema: 'FBS',
    },
    commissionSnapshot: {
      rules: [
        {
          category: '家居与花园',
          aliases: ['Дом и сад'],
          bands: [{ minRUB: 0, maxRUB: 1500, rfbs: 12, fbp: 15 }],
        },
      ],
    },
  });

  assert.equal(row.commissionRate, 12);
  assert.equal(row.rfbsCommission, 12);
  assert.equal(row.fbpCommission, 15);
});

test('uses shared Ozon commission matcher fallback when category text rules do not match', () => {
  const calls = [];
  const workbench = loadWorkbench({
    OZON_CALC_COMMISSION_RATES: {
    matchCommissionRate(snapshot, options) {
      calls.push(options.scheme);
      assert.equal(snapshot.source, 'official-docs');
      assert.equal(options.priceRUB, 1200);
      assert.equal(Array.from(options.categoryIds || []).join(','), '17028718,200000933,300001');
      assert.ok(options.categoryHints.includes('Дом и сад'));
      return {
        ratePct: options.scheme === 'fbp' ? 15 : 12,
        source: 'official',
        category: '未知类目最高档参考',
        scheme: options.scheme,
        priceBand: { minRUB: 0, maxRUB: 1500 },
      };
    },
    },
  });

  const row = workbench.buildSkuWorkbenchRow({
    sku: '4460205906',
    pagePrice: 1200,
    fxRate: 0.08,
    metrics: {
      category1: 'Дом и сад',
      category3: 'Тряпки',
      category1Id: 17028718,
      category2Id: 200000933,
      category3Id: 300001,
      salesSchema: 'FBO',
    },
    commissionSnapshot: {
      source: 'official-docs',
      rules: [
        {
          category: '完全不匹配类目',
          bands: [{ minRUB: 0, maxRUB: 1500, rfbs: 9, fbp: 10 }],
        },
      ],
    },
  });

  assert.equal(row.commissionRate, 15);
  assert.equal(row.rfbsCommission, 12);
  assert.equal(row.fbpCommission, 15);
  assert.equal(row.commissionSource, 'official');
  assert.equal(row.commissionMatch.category, '未知类目最高档参考');
  assert.deepEqual(calls, ['rfbs', 'fbp']);
});

test('parses Ozon other-offers widget states into seller count and minimum price', () => {
  const workbench = loadWorkbench();
  const result = workbench.parseOzonSellerOffers({
    widgetStates: {
      'webSellerList-123-default-1': JSON.stringify({
        offers: [
          { seller: { name: 'A' }, price: { cardPrice: { price: '499 ₽' } } },
          { sellerName: 'B', price: '529 ₽' },
        ],
      }),
    },
  });

  assert.equal(result.sellerCount, 2);
  assert.equal(result.minPrice, 499);
  assert.equal(result.minPriceText, '499 ₽');
  assert.equal(result.maxPrice, 529);
  assert.deepEqual(result.sellerNames, ['A', 'B']);
  assert.equal(result.offers.length, 2);
});

test('builds a square-table SKU row with editable price, cost and profit data', () => {
  const workbench = loadWorkbench();
  const row = workbench.buildSkuWorkbenchRow({
    sku: '1502334613',
    title: 'Товар',
    image: 'https://cdn.example.com/a.jpg',
    pagePrice: 1200,
    costCny: 35,
    fxRate: 0.08,
    commissionRate: 15,
    logisticsFeeCny: 18,
    metrics: { soldCount: 31, soldSum: 12750, convToCartPdp: 8.4 },
    offers: { sellerCount: 2, minPrice: 499, maxPrice: 529, minPriceText: '499 ₽', sellerNames: ['A', 'B'] },
    specs: { weightGrams: 450, lengthMm: 120, widthMm: 80, heightMm: 40 },
  });

  assert.equal(row.sku, '1502334613');
  assert.equal(row.priceRub, 1200);
  assert.equal(row.priceCny, 96);
  assert.equal(row.costCny, 35);
  assert.equal(row.commissionCny, 14.4);
  assert.equal(row.profitCny, 28.6);
  assert.equal(row.profitMarginPct, 29.79);
  assert.equal(row.sellerCount, 2);
  assert.equal(row.minFollowPriceRub, 499);
  assert.equal(row.maxFollowPriceRub, 529);
  assert.equal(row.sellerListText, 'A 等2个卖家');
  assert.equal(row.weightGrams, 450);
  assert.equal(row.dimensionsText, '120 x 80 x 40 mm');
});

test('keeps translated CNY page prices as CNY instead of treating them as RUB', () => {
  const workbench = loadWorkbench();
  const row = workbench.buildSkuWorkbenchRow({
    sku: '111222333',
    pagePrice: 111.68,
    pagePriceCurrency: 'CNY',
    fxRate: 0.08,
    commissionRate: 10,
    metrics: {},
    offers: {},
    specs: {},
  });

  assert.equal(row.priceCurrency, 'CNY');
  assert.equal(row.priceCny, 111.68);
  assert.equal(row.priceRub, 1396);
  assert.equal(row.commissionCny, 11.17);
});

test('builds SKU rows with analytics-only seller count, commission and extended metrics', () => {
  const workbench = loadWorkbench();
  const row = workbench.buildSkuWorkbenchRow({
    sku: '2515213005',
    pagePrice: 900,
    fxRate: 0.08,
    metrics: {
      sellerCount: 4,
      commission: '11%',
      convToCartSearch: 3.4,
      convViewToOrder: 1.8,
      daysWithTrafarets: 6,
      promoRevenueShare: 18.5,
      pWeight: 520,
      ptj: 'T3',
    },
    offers: {},
    specs: {},
  });

  assert.equal(row.sellerCount, 4);
  assert.equal(row.commissionRate, 11);
  assert.equal(row.convToCartSearch, 3.4);
  assert.equal(row.convViewToOrder, 1.8);
  assert.equal(row.daysWithTrafarets, 6);
  assert.equal(row.promoRevenueShare, 18.5);
  assert.equal(row.weightGrams, 520);
  assert.equal(row.ptj, 'T3');
});

test('does not turn unknown commission into a fake 0 percent rate', () => {
  const workbench = loadWorkbench();
  const row = workbench.buildSkuWorkbenchRow({
    sku: '4285652992',
    pagePrice: 850,
    fxRate: 0.08,
    metrics: {},
    offers: {},
    specs: {},
  });

  assert.equal(row.commissionRate, null);
  assert.equal(row.commissionCny, 0);
});
