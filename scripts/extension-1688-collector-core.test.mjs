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
  assert.equal(result.selectedSku, null);
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

test('1688 core prefers complete page text sale attributes over selected sku fragments', () => {
  const core = loadCore();

  const result = core.extract1688ProductFromSources({
    url: 'https://detail.1688.com/offer/945335480485.html?offerId=945335480485',
    host: 'detail.1688.com',
    pageText: [
      '颜色 隐形肤 性感黑 香槟白 尺码 S 已选 隐形肤 S 商品金额 ¥8.50',
      '商品属性 款式 美背型 颜色 隐形肤,性感黑,香槟白',
      '尺码 S（适合75-95斤32/70AB）,M（适合95-110斤34/75AB）,L（适合110-125斤36/80AB）,XL（适合125-140斤38/85AB）',
      '是否跨境出口专供货源 否 商品详情',
    ].join(' '),
    sources: [{
      offerId: '945335480485',
      subject: '黑色挂脖吊带美背文胸内衣女小胸聚拢交叉u露背粉底液隐形无痕',
      productProps: [
        { name: '颜色', value: '隐形肤、性感黑、香槟白' },
        { name: '尺码', value: 'S' },
      ],
      priceInfo: { price: '8.5' },
      imageList: ['https://cbu01.alicdn.com/img/ibank/O1CN-main.jpg'],
    }],
  });

  assert.equal(result.skuItems.length, 12);
  assert.equal(result.attributes.filter((attr) => attr.name === '尺码').length, 1);
  assert.equal(result.attributes.some((attr) => attr.name === '尺码' && attr.value.includes('XL（适合125-140斤38/85AB）')), true);
  assert.equal(result.skuItems.some((sku) => sku.attrs && sku.attrs['尺码'] === 'S'), false);
  assert.equal(result.skuItems.some((sku) => sku.attrs && String(sku.attrs['尺码']).startsWith('XL')), true);
});

test('1688 core does not merge review text colors into structured 1688 sale attributes', () => {
  const core = loadCore();

  const result = core.extract1688ProductFromSources({
    url: 'https://detail.1688.com/offer/945335480485.html?offerId=945335480485&hotSaleSkuId=6014886287479',
    host: 'detail.1688.com',
    pageText: [
      '买家评价 颜色 真的很多 选了好久都不够看。布料摸起来很舒服 冰冰凉凉的 很好 还有那么多种穿法',
      '特别适合我 这个哺乳期也可以穿的 我现在就是哺乳期 挺好的 穿起来挺舒服的 大家喜欢的话可以下单哦 预览 预览 匿名购买',
      '商品属性 款式 美背型 颜色 隐形肤、性感黑、香槟白 尺码 S（适合75-95斤32/70AB） M（适合95-110斤34/75AB） L（适合110-125斤36/80AB） XL（适合125-140斤38/85AB）',
      '货号 8838 商品详情',
    ].join(' '),
    sources: [{
      offerId: '945335480485',
      subject: '黑色挂脖吊带美背文胸内衣女小胸聚拢交叉u露背粉底液隐形无痕',
      productProps: [
        { name: '颜色', value: '隐形肤、性感黑、香槟白' },
        { name: '尺码', value: 'S' },
      ],
      priceInfo: { price: '8.5' },
      imageList: ['https://cbu01.alicdn.com/img/ibank/O1CN-main.jpg'],
    }],
  });

  assert.equal(result.skuItems.length, 12);
  assert.equal(result.attributes.some((attr) => attr.name === '颜色' && attr.value === '隐形肤、性感黑、香槟白'), true);
  assert.equal(result.attributes.some((attr) => attr.name === '尺码' && attr.value.includes('XL（适合125-140斤38/85AB）')), true);
  assert.equal(result.skuItems.some((sku) => /真的很多|布料摸起来|匿名购买|预览|下单哦/.test(sku.name)), false);
});

test('1688 core keeps bracketed color names intact when page text has inner spaces', () => {
  const core = loadCore();

  const result = core.extract1688ProductFromSources({
    url: 'https://detail.1688.com/offer/965731536766.html?offerId=965731536766',
    host: 'detail.1688.com',
    pageText: [
      '商品属性 颜色 优雅黑 【超低露背 穿搭隐形】 粉底液肤【超低露背 穿搭隐形】 奶皮白 【超低露背 穿搭隐形】',
      '尺码 S适合70/32ABC M适合75/34ABC L适合80/36ABC XL适合85/38ABC 商品详情',
    ].join(' '),
    sources: [{
      offerId: '965731536766',
      subject: '大u型露美背隐形内衣无痕粉底液小胸聚拢特调肤色细肩带夏季文胸',
      offerProps: [
        { name: '颜色', value: '优雅黑【超低露背 穿搭隐形】、粉底液肤【超低露背 穿搭隐形】、奶皮白【超低露背 穿搭隐形】' },
        { name: '尺码', value: 'S适合70/32ABC、M适合75/34ABC、L适合80/36ABC、XL适合85/38ABC' },
      ],
      priceInfo: { price: '12.33' },
      imageList: ['https://cbu01.alicdn.com/img/ibank/O1CN-main.jpg'],
    }],
  });

  assert.equal(result.skuItems.length, 12);
  assert.equal(result.skuItems.some((sku) => /穿搭隐形】 \/ L适合80/.test(sku.name)), true);
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

test('1688 core does not leak packaging weight headers into sale attribute matrix', () => {
  const core = loadCore();

  const result = core.extract1688ProductFromSources({
    url: 'https://detail.1688.com/offer/940329348845.html?offerId=940329348845',
    host: 'detail.1688.com',
    pageText: [
      '商品属性 颜色 黑色 白色 高级灰 卡其 尺码 L（85-125斤） XL（125-165斤）',
      '包装信息 商品件重尺 颜色 尺码 重量(g) 黑色 L（85-125斤） 120 黑色 XL（125-165斤） 120 白色 L（85-125斤） 120 商品详情',
    ].join(' '),
    sources: [{
      offerId: '940329348845',
      subject: '新款美背内搭背心无痕一片式蕾丝吊带自带胸垫打底外穿大码内衣女',
      priceInfo: { price: '12' },
      imageList: ['https://cbu01.alicdn.com/img/ibank/O1CN-main.jpg'],
    }],
  });

  assert.equal(result.skuItems.length, 8);
  assert.equal(result.skuItems.some((sku) => /重量\(g\)|尺码\s+重量|\b120\b/.test(JSON.stringify(sku.attrs || {}))), false);
  assert.equal(result.skuItems.some((sku) => sku.attrs && sku.attrs['颜色'] === '黑色'), true);
  assert.equal(result.skuItems.some((sku) => sku.attrs && sku.attrs['尺码'] === 'XL（125-165斤）'), true);
});

test('1688 core separates lingerie attribute table fields from sale sizes', () => {
  const core = loadCore();

  const result = core.extract1688ProductFromSources({
    url: 'https://detail.1688.com/offer/1026338058165.html?offerId=1026338058165',
    host: 'detail.1688.com',
    pageText: [
      '商品属性 罩杯型 1/2罩杯 款式 法式风格',
      '功能 聚拢,无痕,透气,上托,美背,调整型,舒适,侧收,收副乳,大胸显小 面料名称 蕾丝',
      '模杯类型 薄模杯 里料成分 聚酯纤维（涤纶） 是否可外穿 不可外穿',
      '模杯面料 棉 材质 尼龙或莱卡 成分 聚酯纤维（涤纶） 季节 夏季,冬季,春季,秋季',
      '钢圈 无钢圈 适用年龄段 青年（18-40周岁） 主面料成分 聚酯纤维（涤纶） 主面料成分的含量 70-80（%）',
      '里料成分含量 70-80（%） 排扣类型 后三排搭扣 肩带类型 固定双肩带 肩带材质 尼龙或莱卡',
      '设计特色 蕾丝边 产地 汕头 是否无缝 否 纱线来源 其它 品牌 其他 货源类别 现货',
      '是否支持贴牌 不支持 是否跨境出口专供货源 是 适合季节 夏季,冬季,春季,秋季',
      '颜色 凝脂白,朝霞蓝,橡灰咖,锦鲤红,苍弯黑 尺码 34-75BC,36-80BC,38-85BC,40-90BC,42-95BC 包装形式 单入装 展开全部 商品详情',
    ].join(' '),
    sources: [{
      offerId: '1026338058165',
      subject: '法式内衣女兔耳朵水晶杯大胸显小薄款聚拢防下垂女士内衣胸罩揭阳',
      priceInfo: { price: '24' },
      imageList: ['https://cbu01.alicdn.com/img/ibank/O1CN-main.jpg'],
    }],
  });

  const attrs = Object.fromEntries(result.attributes.map((attr) => [attr.name, attr.value]));
  assert.equal(result.skuItems.length, 25);
  assert.equal(result.skuItems.some((sku) => /包装形式|展开全部/.test(JSON.stringify(sku.attrs || {}))), false);
  assert.equal(attrs['尺码'], '34-75BC、36-80BC、38-85BC、40-90BC、42-95BC');
  assert.equal(attrs['包装形式'], '单入装');
  assert.equal(attrs['是否可外穿'], '不可外穿');
  assert.equal(attrs['里料成分'], '聚酯纤维（涤纶）');
  assert.equal(attrs['钢圈'], '无钢圈');
  assert.equal(attrs['肩带材质'], '尼龙或莱卡');
  assert.equal(attrs['是否支持贴牌'], '不支持');
  assert.equal(attrs['是否跨境出口专供货源'], '是');
  assert.equal(attrs['适合季节'], '夏季,冬季,春季,秋季');
});

test('1688 core extracts detail images embedded in description html', () => {
  const core = loadCore();

  const result = core.extract1688ProductFromSources({
    url: 'https://detail.1688.com/offer/1026338058165.html?offerId=1026338058165',
    host: 'detail.1688.com',
    pageText: '商品属性 颜色 凝脂白 尺码 34-75BC 商品详情',
    sources: [{
      offerId: '1026338058165',
      subject: '法式内衣女兔耳朵水晶杯大胸显小薄款聚拢防下垂女士内衣胸罩揭阳',
      imageList: ['https://cbu01.alicdn.com/img/ibank/O1CN-main.jpg'],
      detailDescription: '<div><img src="https://cbu01.alicdn.com/img/ibank/O1CN-detail-1.jpg_790x790.jpg"/><img src="//cbu01.alicdn.com/img/ibank/O1CN-detail-2.jpg_790x790.jpg"/></div>',
    }],
  });

  assert.deepEqual(JSON.parse(JSON.stringify(result.sourceDetailImages)), [
    'https://cbu01.alicdn.com/img/ibank/O1CN-detail-1.jpg',
    'https://cbu01.alicdn.com/img/ibank/O1CN-detail-2.jpg',
  ]);
  assert.equal(result.sourceRichContentDraft.blocks.filter((block) => block.type === 'image').length, 2);
});

test('1688 core extracts general package weight from 1688 packaging text', () => {
  const core = loadCore();

  const result = core.extract1688ProductFromSources({
    url: 'https://detail.1688.com/offer/945335480485.html?offerId=945335480485',
    host: 'detail.1688.com',
    pageText: '商品属性 颜色 隐形肤 性感黑 香槟白 尺码 S M L XL 包装信息 商品件重尺 重量(g) 20 商品详情',
    sources: [{
      offerId: '945335480485',
      subject: '黑色挂脖吊带美背文胸内衣女小胸聚拢交叉u露背粉底液隐形无痕',
      productProps: [
        { name: '颜色', value: '隐形肤、性感黑、香槟白' },
        { name: '尺码', value: 'S、M、L、XL' },
      ],
      priceInfo: { price: '8.5' },
      imageList: ['https://cbu01.alicdn.com/img/ibank/O1CN-main.jpg'],
    }],
  });

  assert.equal(result.sourcePackagingRows.length, 0);
  assert.equal(result.weightG, 20);
  assert.equal(result.grossWeightGrams, 20);
});
