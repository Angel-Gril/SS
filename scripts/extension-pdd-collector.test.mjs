import assert from 'node:assert/strict';

const helper = await import('../extensions/ss-erp/shared/collectors/pdd-product.js');
const api = helper.default || helper.SS_ERP_PDD_PRODUCT_COLLECTOR || globalThis.SS_ERP_PDD_PRODUCT_COLLECTOR;

assert.ok(api, 'PDD collector helper should be exported');
assert.equal(typeof api.extractPddProduct, 'function', 'extractPddProduct should be exported');

const rawData = {
  goods: {
    goodsID: '123456789',
    goodsName: '便携折叠收纳箱',
    minGroupPrice: 1299,
    topGallery: [
      { url: 'https://img.pddpic.com/product/main-800x800.jpeg' },
      { url: 'https://img.pddpic.com/product/video-cover-800x800.jpeg' },
      { url: 'https://img.pddpic.com/product/detail-800x800.webp' },
    ],
    mallName: '松鼠百货源头店',
    shipWeight: 650,
    catId: 987,
    categoryName: '居家日用 > 收纳用品',
    detailDescription: '加厚牛津布，适合跨境发货的折叠收纳箱。',
    goodsProperty: [
      { name: '材质', value: '牛津布' },
      { name: '适用场景', value: '衣柜收纳' },
    ],
    skus: [
      {
        skuId: 'sku-red-l',
        specs: [
          { specKey: '颜色', specValue: '红色' },
          { specKey: '规格', specValue: '大号' },
        ],
        normalPrice: 1399,
        quantity: 12,
        thumbUrl: 'https://img.pddpic.com/product/red-l.jpeg',
      },
      {
        sku_id: 'sku-blue-s',
        specText: '颜色:蓝色;规格:小号',
        group_price: 1199,
        quantity: 3,
        image: 'https://img.pddpic.com/product/blue-s.jpeg',
      },
    ],
  },
};

const result = api.extractPddProduct({
  platform: 'pdd',
  sources: [rawData],
  pageState: { knownGlobals: { rawData } },
  pageText: '重量 650g 尺寸 30×20×10cm',
  url: 'https://mobile.yangkeduo.com/goods.html?goods_id=123456789',
  host: 'mobile.yangkeduo.com',
});

assert.equal(result.platform, 'pdd');
assert.equal(result.sourcePlatform, 'pinduoduo');
assert.equal(result.extractor, 'ss-erp-pdd');
assert.equal(result.productId, '123456789');
assert.equal(result.sourceProductId, '123456789');
assert.equal(result.title, '便携折叠收纳箱');
assert.equal(result.sourceTitleRaw, '便携折叠收纳箱');
assert.equal(result.shopName, '松鼠百货源头店');
assert.equal(result.price, '12.99');
assert.equal(result.priceText, '¥12.99');
assert.equal(result.currency, 'CNY');
assert.equal(result.shippingCny, 0);
assert.equal(result.totalCostCny, 12.99);
assert.equal(result.grossWeightGrams, 650);
assert.equal(result.weightG, 650);
assert.equal(result.lengthMm, 300);
assert.equal(result.widthMm, 200);
assert.equal(result.heightMm, 100);
assert.equal(result.categoryName, '居家日用 > 收纳用品');
assert.equal(result.description, '加厚牛津布，适合跨境发货的折叠收纳箱。');
assert.deepEqual(result.attributes, [
  { name: '材质', value: '牛津布' },
  { name: '适用场景', value: '衣柜收纳' },
]);
assert.deepEqual(result.images, [
  'https://img.pddpic.com/product/main-800x800.jpeg',
  'https://img.pddpic.com/product/detail-800x800.webp',
]);
assert.equal(result.skuCount, 2);
assert.deepEqual(result.skuItems, [
  {
    skuId: 'sku-red-l',
    name: '红色 / 大号',
    specText: '颜色: 红色 / 规格: 大号',
    price: 13.99,
    stock: 12,
    grossWeightGrams: null,
    imageUrl: 'https://img.pddpic.com/product/red-l.jpeg',
  },
  {
    skuId: 'sku-blue-s',
    name: '蓝色 / 小号',
    specText: '颜色: 蓝色 / 规格: 小号',
    price: 11.99,
    stock: 3,
    grossWeightGrams: null,
    imageUrl: 'https://img.pddpic.com/product/blue-s.jpeg',
  },
]);
assert.deepEqual(result.variants, [
  {
    sku: 'sku-red-l',
    attrs: { '颜色': '红色', '规格': '大号' },
    price: '13.99',
    priceCurrency: 'CNY',
    priceText: '¥13.99',
    stock: 12,
    images: ['https://img.pddpic.com/product/red-l.jpeg'],
  },
  {
    sku: 'sku-blue-s',
    attrs: { '颜色': '蓝色', '规格': '小号' },
    price: '11.99',
    priceCurrency: 'CNY',
    priceText: '¥11.99',
    stock: 3,
    images: ['https://img.pddpic.com/product/blue-s.jpeg'],
  },
]);
assert.equal(result.debug.rawSources[0].keys.includes('goods'), true);
assert.equal(result.extractionDiagnostics.titleFound, true);
assert.equal(result.extractionDiagnostics.imageCount, 2);
assert.equal(result.extractionDiagnostics.skuCount, 2);
assert.equal(result.extractionDiagnostics.attributeCount, 2);
assert.equal(result.extractionDiagnostics.descriptionFound, true);
assert.equal(result.extractionDiagnostics.videoCount, 0);
assert.equal(result.extractionDiagnostics.fieldConfidence.title, 'strong');
assert.equal(result.extractionDiagnostics.fieldConfidence.images, 'strong');

const yuanPriceResult = api.extractPddProduct({
  platform: 'pdd',
  sources: [{
    goods: {
      goodsID: '987654321',
      goodsName: '整箱采购商品',
      price: 108,
      topGallery: [{ url: 'https://img.pddpic.com/product/main-800x800.jpeg' }],
    },
  }],
  pageText: '整箱采购商品 ¥108 运费 ¥5',
  url: 'https://pifa.pinduoduo.com/goods/detail?goods_id=987654321',
  host: 'pifa.pinduoduo.com',
});

assert.equal(yuanPriceResult.price, '108', 'PDD yuan integer prices should not be treated as cents');
assert.equal(yuanPriceResult.priceText, '¥108');
assert.equal(yuanPriceResult.priceCny, 108);
assert.equal(yuanPriceResult.shippingCny, 5);
assert.equal(yuanPriceResult.totalCostCny, 113);

const wholesaleResult = api.extractPddProduct({
  platform: 'pdd',
  sources: [{
    goodsDetail: {
      goodsIdStr: '777888999',
      goodsName: '拼多多批发整箱打包杯',
      minGroupPrice: 5600,
      skuList: [
        {
          skuID: 'box-white-24',
          properties: [
            { name: '颜色', value: '白色' },
            { name: '装箱数', value: '24只装' },
          ],
          priceInCent: 5800,
          stockNum: 88,
          skuThumbUrl: 'https://img.pddpic.com/product/white-box-800x800.jpeg',
        },
      ],
      gallery: [
        'https://img.pddpic.com/product/cup-main-800x800.jpeg',
        'https://img.pddpic.com/product/shop-logo-800x800.jpeg',
      ],
      dimension: '40*30*12cm',
      goodsProperty: [
        { name: '材质', value: 'PP' },
        { name: '包装', value: '整箱' },
      ],
      goodsDesc: '适合批发采购的整箱打包杯，页面含 SKU 和包装尺寸。',
    },
  }],
  pageText: '拼多多批发整箱打包杯 重量 1.2kg 尺寸 40*30*12cm',
  url: 'https://pifa.pinduoduo.com/goods/detail?goods_id=777888999',
  host: 'pifa.pinduoduo.com',
});

assert.equal(wholesaleResult.productId, '777888999');
assert.equal(wholesaleResult.title, '拼多多批发整箱打包杯');
assert.equal(wholesaleResult.price, '56');
assert.equal(wholesaleResult.weightG, 1200);
assert.equal(wholesaleResult.lengthMm, 400);
assert.equal(wholesaleResult.widthMm, 300);
assert.equal(wholesaleResult.heightMm, 120);
assert.deepEqual(wholesaleResult.images, ['https://img.pddpic.com/product/cup-main-800x800.jpeg']);
assert.equal(wholesaleResult.skuItems[0].skuId, 'box-white-24');
assert.equal(wholesaleResult.skuItems[0].price, 58);
assert.equal(wholesaleResult.variants[0].attrs['装箱数'], '24只装');
assert.equal(wholesaleResult.extractionDiagnostics.fieldConfidence.title, 'strong');
assert.equal(wholesaleResult.extractionDiagnostics.fieldConfidence.price, 'strong');
assert.equal(wholesaleResult.extractionDiagnostics.fieldConfidence.sku, 'strong');
assert.equal(wholesaleResult.extractionDiagnostics.fieldConfidence.package, 'strong');

const domFallbackResult = api.extractPddProduct({
  platform: 'pdd',
  sources: [],
  pageText: [
    '拼多多批发 - 拼多多官方采购批发平台，多多批发',
    '新款通勤鲨鱼发夹森系大号珍珠夹子女盘发发抓发卡后脑勺轻奢头饰',
    '批发价 ¥7.75 - 15.59',
    '10.5厘米【珍珠】 ¥11.67 库存 945个',
    '8厘米【珍珠】 ¥9.71 库存 1200个',
    '已选择 共1件 ￥11.67 商品金额 ￥11.67',
  ].join(' '),
  domImages: [
    'https://img.pddpic.com/product/hair-claw-main-800x800.jpeg',
  ],
  documentTitle: '拼多多批发 - 拼多多官方采购批发平台，多多批发',
  url: 'https://pifa.pinduoduo.com/goods/detail?goods_id=1053841893222',
  host: 'pifa.pinduoduo.com',
});

assert.equal(domFallbackResult.productId, '1053841893222');
assert.equal(domFallbackResult.title, '新款通勤鲨鱼发夹森系大号珍珠夹子女盘发发抓发卡后脑勺轻奢头饰');
assert.equal(domFallbackResult.price, '11.67');
assert.equal(domFallbackResult.priceText, '¥11.67');
assert.equal(domFallbackResult.priceCny, 11.67);
assert.deepEqual(domFallbackResult.images, ['https://img.pddpic.com/product/hair-claw-main-800x800.jpeg']);
assert.equal(domFallbackResult.skuItems.length, 2);
assert.equal(domFallbackResult.skuItems[0].price, 11.67);
assert.equal(domFallbackResult.extractionDiagnostics.fieldConfidence.title, 'strong');
assert.equal(domFallbackResult.extractionDiagnostics.fieldConfidence.price, 'strong');
assert.equal(domFallbackResult.extractionDiagnostics.fieldConfidence.images, 'strong');

console.log('PASS PDD extension collector');
