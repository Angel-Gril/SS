import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function loadCore() {
  const source = fs.readFileSync('extensions/ss-erp/shared/collectors/source-product-core.js', 'utf8');
  const context = { module: { exports: {} } };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: 'source-product-core.js' });
  return context.SS_ERP_SOURCE_PRODUCT_CORE || context.module.exports;
}

test('1688 core normalizes structured sku props, sku map, price model and source assets', () => {
  const core = loadCore();
  assert.equal(typeof core.extract1688ProductFromSources, 'function');

  const colors = [
    { id: '11', name: '黑色-色 夏款', imageUrl: '//cbu01.alicdn.com/img/ibank/O1CN-black.jpg_100x100.jpg' },
    { id: '12', name: '米白-色 夏款', imageUrl: 'https://cbu01.alicdn.com/img/ibank/O1CN-white.jpg_.webp' },
    { id: '13', name: '灰色-色 夏款' },
    { id: '14', name: '卡其-色 夏款' },
    { id: '15', name: '咖色-色 夏款' },
  ];
  const sizes = ['M 80-100斤', 'L 100-110斤', 'XL 110-120斤', '2XL 120-130斤', '3XL 130-145斤', '4XL 145-160斤', '5XL 160-180斤']
    .map((name, index) => ({ id: String(21 + index), name }));
  const skuMap = {};
  for (const color of colors) {
    for (const size of sizes) {
      skuMap[`${color.id}:${size.id}`] = {
        skuId: `${color.id}-${size.id}`,
        price: color.id === '11' ? '18.80' : '19.90',
        stock: 12,
      };
    }
  }

  const result = core.extract1688ProductFromSources({
    url: 'https://detail.1688.com/offer/1025802373364.html?offerId=1025802373364&hotSaleSkuId=11-21',
    host: 'detail.1688.com',
    pageText: '货源类别 现货 裤型 直筒 腰型 中腰 颜色 黑色-色 夏款 米白-色 夏款 尺码 M 80-100斤 L 100-110斤',
    sources: [{
      offerId: '1025802373364',
      subject: '夏季薄款亚麻休闲裤男跨境货源',
      companyName: '义乌市松鼠服饰有限公司',
      skuModel: {
        skuProps: [
          { prop: '颜色', value: colors },
          { prop: '尺码', value: sizes },
        ],
        skuMap,
      },
      priceInfo: {
        price: '18.80-22.50',
        priceRange: [{ beginAmount: 2, price: '22.50' }, { beginAmount: 50, price: '18.80' }],
      },
      imageList: [
        '//cbu01.alicdn.com/img/ibank/O1CN-main.jpg_220x220.jpg',
        'https://cbu01.alicdn.com/img/ibank/icon.svg',
        'https://cbu01.alicdn.com/64x64/img/ibank/O1CN-small.jpg',
      ],
      detailImages: [
        'https://cbu01.alicdn.com/img/ibank/O1CN-detail-1.jpg_790x790.jpg',
      ],
      productProps: [
        { name: '货源类别', value: '现货' },
        { name: '裤型', value: '直筒' },
        { name: '主面料成分', value: '亚麻' },
      ],
      packageInfo: [
        { color: '黑色-色 夏款', size: 'M 80-100斤', length: 30, width: 20, height: 2, unit: 'cm', weight: 300, weightUnit: 'g' },
      ],
    }],
  });

  assert.equal(result.sourcePlatform, '1688');
  assert.equal(result.productId, '1025802373364');
  assert.equal(result.title, '夏季薄款亚麻休闲裤男跨境货源');
  assert.equal(result.shopName, '义乌市松鼠服饰有限公司');
  assert.equal(result.skuItems.length, 35);
  assert.equal(result.skuItems[0].skuId, '11-21');
  assert.deepEqual(JSON.parse(JSON.stringify(result.skuItems[0].attrs)), { '颜色': '黑色-色 夏款', '尺码': 'M 80-100斤' });
  assert.equal(result.skuItems[0].price, 18.8);
  assert.equal(result.skuItems[0].stock, 12);
  assert.equal(result.skuItems[0].images[0], 'https://cbu01.alicdn.com/img/ibank/O1CN-black.jpg');
  assert.equal(result.skuItems.some((sku) => /货源类别|裤型|腰型/.test(sku.name)), false);
  assert.equal(result.price, '18.8');
  assert.equal(result.priceSourceType, 'sku');
  assert.equal(result.priceConfidence, 'high');
  assert.deepEqual(JSON.parse(JSON.stringify(result.ladderPrices)), [
    { minQuantity: 2, price: 22.5 },
    { minQuantity: 50, price: 18.8 },
  ]);
  assert.equal(result.images.includes('https://cbu01.alicdn.com/img/ibank/O1CN-main.jpg'), true);
  assert.equal(result.images.includes('https://cbu01.alicdn.com/img/ibank/O1CN-black.jpg'), true);
  assert.equal(result.images.includes('https://cbu01.alicdn.com/img/ibank/O1CN-white.jpg'), true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.sourceDetailImages)), [
    'https://cbu01.alicdn.com/img/ibank/O1CN-detail-1.jpg',
  ]);
  assert.equal(result.rejectedAssets.some((asset) => asset.reason === 'svg'), true);
  assert.equal(result.rejectedAssets.some((asset) => asset.reason === 'small_image'), true);
  assert.equal(result.sourcePackagingRows[0].lengthMm, 300);
  assert.equal(result.sourceRichContentDraft.blocks[0].url, 'https://cbu01.alicdn.com/img/ibank/O1CN-detail-1.jpg');
  assert.deepEqual(JSON.parse(JSON.stringify(result.extractionDiagnostics)), {
    titleFound: true,
    imageCount: 3,
    detailImageCount: 1,
    rejectedImageCount: 2,
    skuCount: 35,
    skuSource: 'skuMap',
    attributeCount: 3,
    packagingCount: 1,
    descriptionFound: true,
    videoCount: 0,
    priceSourceType: 'sku',
    priceConfidence: 'high',
    missing: [],
  });
});
