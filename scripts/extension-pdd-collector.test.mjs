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
assert.equal(result.grossWeightGrams, 650);
assert.equal(result.weightG, 650);
assert.equal(result.lengthMm, 300);
assert.equal(result.widthMm, 200);
assert.equal(result.heightMm, 100);
assert.equal(result.categoryName, '居家日用 > 收纳用品');
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

console.log('PASS PDD extension collector');
