import assert from 'node:assert/strict';

const helper = await import('../extensions/ss-erp/shared/collectors/marketplace-product.js');
const api = helper.default || helper.SS_ERP_MARKETPLACE_PRODUCT_COLLECTOR || globalThis.SS_ERP_MARKETPLACE_PRODUCT_COLLECTOR;

assert.ok(api, 'marketplace collector helper should be exported');
assert.equal(typeof api.extractTaobaoProduct, 'function', 'extractTaobaoProduct should be exported');
assert.equal(typeof api.extractTmallProduct, 'function', 'extractTmallProduct should be exported');
assert.equal(typeof api.extractXianyuProduct, 'function', 'extractXianyuProduct should be exported');

const taobaoResult = api.extractTaobaoProduct({
  platform: 'taobao',
  sources: [{
    item: {
      itemId: '99887766',
      title: '淘宝女士纯棉内裤三条装',
      price: { priceText: '￥39.90' },
      images: [
        '//img.alicdn.com/imgextra/i1/123/O1CN-main.jpg',
        'https://img.alicdn.com/imgextra/i2/123/O1CN-size.png',
      ],
      seller: { shopName: '杭州棉品店' },
      skuProps: [
        { propName: '颜色', values: [{ name: '黑色' }, { name: '肤色' }] },
        { propName: '尺码', values: [{ name: 'M' }, { name: 'L' }] },
      ],
      skuMap: {
        ';黑色;M;': { skuId: 'tb-black-m', price: '3990', stock: 12 },
        ';肤色;L;': { skuId: 'tb-skin-l', price: '4290', stock: 6 },
      },
      props: [
        { name: '材质成分', value: '棉95%' },
        { name: '适用性别', value: '女' },
      ],
      desc: '三条装纯棉内裤，日常舒适穿着。',
      category: ['女装/女士精品', '女士内裤'],
    },
  }],
  pageText: '淘宝女士纯棉内裤三条装 ￥39.90 重量 120g 尺寸 20x15x3cm',
  url: 'https://item.taobao.com/item.htm?id=99887766',
  host: 'item.taobao.com',
});

assert.equal(taobaoResult.platform, 'taobao');
assert.equal(taobaoResult.sourcePlatform, 'taobao');
assert.equal(taobaoResult.extractor, 'ss-erp-taobao');
assert.equal(taobaoResult.productId, '99887766');
assert.equal(taobaoResult.title, '淘宝女士纯棉内裤三条装');
assert.equal(taobaoResult.price, '39.9');
assert.equal(taobaoResult.priceText, '¥39.9');
assert.equal(taobaoResult.shopName, '杭州棉品店');
assert.equal(taobaoResult.weightG, 120);
assert.equal(taobaoResult.lengthMm, 200);
assert.equal(taobaoResult.widthMm, 150);
assert.equal(taobaoResult.heightMm, 30);
assert.equal(taobaoResult.skuItems.length, 2);
assert.equal(taobaoResult.variants[0].attrs['颜色'], '黑色');
assert.equal(taobaoResult.variants[1].price, '42.9');
assert.equal(taobaoResult.attributes[0].name, '材质成分');
assert.equal(taobaoResult.description, '三条装纯棉内裤，日常舒适穿着。');
assert.equal(taobaoResult.extractionDiagnostics.fieldConfidence.sku, 'strong');

const tmallResult = api.extractTmallProduct({
  platform: 'tmall',
  sources: [{
    itemDO: {
      itemId: '11223344',
      title: '天猫儿童保温杯',
      reservePrice: '69.00',
      auctionImages: ['//img.alicdn.com/imgextra/i1/456/O1CN-tmall.jpg'],
      shopName: '旗舰店',
      props: [{ name: '容量', value: '500ml' }],
      desc: '儿童上学使用的保温杯。',
    },
  }],
  pageText: '天猫儿童保温杯 ￥69.00 重量 350g 尺寸 8×8×22cm',
  url: 'https://detail.tmall.com/item.htm?id=11223344',
  host: 'detail.tmall.com',
});

assert.equal(tmallResult.platform, 'tmall');
assert.equal(tmallResult.sourcePlatform, 'tmall');
assert.equal(tmallResult.extractor, 'ss-erp-tmall');
assert.equal(tmallResult.price, '69');
assert.equal(tmallResult.attributes[0].value, '500ml');
assert.equal(tmallResult.extractionDiagnostics.fieldConfidence.title, 'strong');

const xianyuResult = api.extractXianyuProduct({
  platform: 'xianyu',
  sources: [{
    idleItem: {
      id: 'xy123456',
      title: '闲鱼二手展示架',
      price: '88.00',
      imageInfos: [
        { url: '//img.alicdn.com/bao/uploaded/i1/789/O1CN-xianyu.jpg' },
      ],
      seller: { nick: '上海闲置卖家' },
      desc: '店铺撤柜闲置展示架，成色如图。',
    },
  }],
  pageText: '闲鱼二手展示架 ￥88 店铺撤柜闲置展示架，成色如图。',
  url: 'https://www.goofish.com/item?id=xy123456',
  host: 'www.goofish.com',
});

assert.equal(xianyuResult.platform, 'xianyu');
assert.equal(xianyuResult.sourcePlatform, 'xianyu');
assert.equal(xianyuResult.extractor, 'ss-erp-xianyu');
assert.equal(xianyuResult.productId, 'xy123456');
assert.equal(xianyuResult.title, '闲鱼二手展示架');
assert.equal(xianyuResult.price, '88');
assert.equal(xianyuResult.shopName, '上海闲置卖家');
assert.equal(xianyuResult.description, '店铺撤柜闲置展示架，成色如图。');
assert.equal(xianyuResult.images[0], 'https://img.alicdn.com/bao/uploaded/i1/789/O1CN-xianyu.jpg');
assert.equal(xianyuResult.skuItems.length, 0);
assert.equal(xianyuResult.extractionDiagnostics.fieldConfidence.sku, 'missing');

console.log('PASS marketplace extension collector');
