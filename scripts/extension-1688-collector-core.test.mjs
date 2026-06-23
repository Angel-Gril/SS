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

test('1688 core rejects merchant metrics and product attributes as sku rows', () => {
  const core = loadCore();

  const result = core.extract1688ProductFromSources({
    url: 'https://detail.1688.com/offer/1037213576946.html?offerId=1037213576946',
    host: 'detail.1688.com',
    pageText: '店铺回头率 店铺服务分 入驻1年 颜色 植香肤 尺码 M 800-100斤 L 100-110斤',
    sources: [{
      offerId: '1037213576946',
      subject: '100%纯亚麻裤子男春秋薄款九分裤宽松显瘦休闲哈伦裤',
      selectedOrderSummary: {
        price: '67.20',
        skuText: '上海娅坚悦贸易有限公司 / M 800-100斤',
      },
      saleInfos: [
        { name: '入驻1年', price: '67.2' },
        { name: '店铺回头率', price: '67.2' },
        { name: '35', price: '67.2' },
        { name: '店铺服务分', price: '67.2' },
      ],
      productProps: [
        { name: '材质', value: '亚麻' },
        { name: '风格', value: '休闲' },
      ],
      imageList: ['https://cbu01.alicdn.com/img/ibank/O1CN-main.jpg'],
    }],
  });

  assert.equal(result.skuItems.length, 0);
  assert.equal(result.skuItems.some((sku) => /入驻|店铺|回头率|服务分|上海娅坚/.test(sku.name)), false);
  assert.equal(result.priceSourceType, 'display');
});

test('1688 core does not promote product specification blobs to sale props', () => {
  const core = loadCore();

  const result = core.extract1688ProductFromSources({
    url: 'https://detail.1688.com/offer/1025802373364.html?offerId=1025802373364',
    host: 'detail.1688.com',
    sources: [{
      offerId: '1025802373364',
      subject: '夏季无痕聚拢上托新款冰丝内衣女无钢圈',
      specifications: [
        {
          name: '款式',
          values: [
            { name: '舒适 主面料成分 锦纶 面料名称 锦纶 模杯面料 棉 罩杯型 全罩杯 里料成分 氨纶 品牌 其他 适用年龄段 青年' },
            { name: '无痕' },
            { name: '透气' },
            { name: '上托' },
            { name: '防走光' },
          ],
        },
        {
          name: '尺码',
          values: [
            { name: 'M【建议80-100斤】' },
            { name: 'L【建议100-120斤】' },
          ],
        },
      ],
      imageList: ['https://cbu01.alicdn.com/img/ibank/O1CN-main.jpg'],
      priceInfo: { price: '29' },
    }],
  });

  const skuProps = result.rawSourceProduct.skuProps;
  assert.equal(skuProps.some((prop) => prop.name === '款式'), false);
  assert.equal(JSON.stringify(skuProps).includes('主面料成分'), false);
  assert.equal(JSON.stringify(skuProps).includes('店铺'), false);
});

test('1688 core splits product attribute blobs into named attributes', () => {
  const core = loadCore();

  const result = core.extract1688ProductFromSources({
    url: 'https://detail.1688.com/offer/1025802373364.html?offerId=1025802373364',
    host: 'detail.1688.com',
    sources: [{
      offerId: '1025802373364',
      subject: '夏季无痕聚拢上托新款冰丝内衣女无钢圈',
      productProps: [
        {
          name: '款式',
          value: '背心式 功能 聚拢、无痕、透气、上托、防走光、舒适 主面料成分 锦纶 面料名称 锦纶 模杯面料 棉 罩杯型 全罩杯 里料成分 氨纶 品牌 其他 适用年龄段 青年（18-40周岁） 颜色 植香肤 尺码 M【建议80-100斤】、L【建议100-120斤】 货号 3183#',
        },
      ],
      imageList: ['https://cbu01.alicdn.com/img/ibank/O1CN-main.jpg'],
    }],
  });

  const attrs = Object.fromEntries(result.attributes.map((attr) => [attr.name, attr.value]));
  assert.equal(attrs['款式'], '背心式');
  assert.equal(attrs['功能'], '聚拢、无痕、透气、上托、防走光、舒适');
  assert.equal(attrs['主面料成分'], '锦纶');
  assert.equal(attrs['面料名称'], '锦纶');
  assert.equal(attrs['模杯面料'], '棉');
  assert.equal(attrs['罩杯型'], '全罩杯');
  assert.equal(attrs['里料成分'], '氨纶');
  assert.equal(attrs['品牌'], '其他');
  assert.equal(attrs['适用年龄段'], '青年（18-40周岁）');
  assert.equal(attrs['颜色'], '植香肤');
  assert.equal(attrs['尺码'], 'M【建议80-100斤】、L【建议100-120斤】');
  assert.equal(attrs['货号'], '3183#');
  assert.equal(result.attributes.some((attr) => attr.name === '款式' && attr.value.includes('主面料成分')), false);
});

test('1688 core builds sku matrix from explicit color and size attributes when sku map is missing', () => {
  const core = loadCore();

  const result = core.extract1688ProductFromSources({
    url: 'https://detail.1688.com/offer/945335480485.html?offerId=945335480485',
    host: 'detail.1688.com',
    sources: [{
      offerId: '945335480485',
      subject: '黑色挂脖吊带美背文胸内衣女小胸聚拢交叉u露背粉底液隐形无痕',
      productProps: [
        { name: '颜色', value: '隐形肤、性感黑、香槟白' },
        { name: '尺码', value: 'S（适合75-95斤32/70AB）、M（适合95-110斤34/75AB）、L（适合110-125斤36/80AB）' },
      ],
      priceInfo: { price: '8.5' },
      imageList: ['https://cbu01.alicdn.com/img/ibank/O1CN-main.jpg'],
    }],
  });

  assert.equal(result.skuItems.length, 9);
  assert.deepEqual(JSON.parse(JSON.stringify(result.skuItems[0].attrs)), {
    '颜色': '隐形肤',
    '尺码': 'S（适合75-95斤32/70AB）',
  });
  assert.equal(result.skuItems.every((sku) => sku.price === 8.5), true);
  assert.equal(result.skuItems.some((sku) => /店铺|入驻|主面料成分|功能/.test(sku.name)), false);
});

test('1688 core builds sku matrix from explicit page text color and size sections', () => {
  const core = loadCore();

  const result = core.extract1688ProductFromSources({
    url: 'https://detail.1688.com/offer/945335480485.html?offerId=945335480485',
    host: 'detail.1688.com',
    pageText: '商品属性 颜色 隐形肤 性感黑 香槟白 尺码 S（适合75-95斤32/70AB） M（适合95-110斤34/75AB） L（适合110-125斤36/80AB） 货号 8838 商品详情',
    sources: [{
      offerId: '945335480485',
      subject: '黑色挂脖吊带美背文胸内衣女小胸聚拢交叉u露背粉底液隐形无痕',
      priceInfo: { price: '11' },
      imageList: ['https://cbu01.alicdn.com/img/ibank/O1CN-main.jpg'],
    }],
  });

  assert.equal(result.skuItems.length, 9);
  assert.equal(result.attributes.some((attr) => attr.name === '颜色' && attr.value === '隐形肤、性感黑、香槟白'), true);
  assert.equal(result.attributes.some((attr) => attr.name === '尺码' && attr.value.includes('M（适合95-110斤34/75AB）')), true);
  assert.equal(result.skuItems.some((sku) => /商品属性|商品详情|货号|店铺/.test(sku.name)), false);
});

test('1688 core extracts packaging rows from explicit page text table', () => {
  const core = loadCore();

  const result = core.extract1688ProductFromSources({
    url: 'https://detail.1688.com/offer/945335480485.html?offerId=945335480485',
    host: 'detail.1688.com',
    pageText: '商品属性 颜色 隐形肤 性感黑 尺码 S M 包装信息 商品件重尺 颜色 尺码 长(cm) 宽(cm) 高(cm) 重量(g) 隐形肤 S 30 20 2 120 性感黑 M 31 21 2 125 商品详情',
    sources: [{
      offerId: '945335480485',
      subject: '黑色挂脖吊带美背文胸内衣女小胸聚拢交叉u露背粉底液隐形无痕',
      priceInfo: { price: '11' },
      imageList: ['https://cbu01.alicdn.com/img/ibank/O1CN-main.jpg'],
    }],
  });

  assert.equal(result.sourcePackagingRows.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(result.sourcePackagingRows[0])), {
    color: '隐形肤',
    size: 'S',
    lengthMm: 300,
    widthMm: 200,
    heightMm: 20,
    weightG: 120,
  });
});
