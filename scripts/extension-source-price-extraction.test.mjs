import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const priceCurrencyScript = fs.readFileSync('extensions/ss-erp/shared/currency/price-currency.js', 'utf8');
const sourceProductCoreScript = fs.readFileSync('extensions/ss-erp/shared/collectors/source-product-core.js', 'utf8');
const collectScript = fs.readFileSync('extensions/ss-erp/content/collect-content-script.js', 'utf8');
const pageBridgeScript = fs.readFileSync('extensions/ss-erp/content/page-bridge.js', 'utf8');

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeMockElement({ text = '', className = '', attrs = {}, value = '', children = [], src = '' }) {
  return {
    textContent: text,
    innerText: text,
    className,
    value,
    src,
    currentSrc: src,
    children,
    classList: {
      contains(name) {
        return String(className || '').split(/\s+/).includes(name);
      },
    },
    getAttribute(name) {
      if (name === 'class') return className;
      if (name === 'value') return value;
      return attrs[name] || '';
    },
    hasAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name);
    },
    querySelectorAll(selector) {
      if (/input|button|\[role/.test(selector)) return children;
      return [];
    },
    closest() {
      return this;
    },
  };
}

assert.match(pageBridgeScript, /offerDetailData/, 'page bridge should expose 1688 offer detail globals to the collector');
assert.match(pageBridgeScript, /readLikelyProductGlobals/, 'page bridge should scan likely 1688 product globals when exact names change');

async function collectWithPage({ url, title, bodyText, selectors, queryAll, pageState }) {
  let messageListener = null;
  const windowListeners = {};
  const document = {
    title,
    body: { innerText: bodyText || '' },
    head: { appendChild() {} },
    documentElement: { appendChild() {} },
    getElementById() { return null; },
    createElement() {
      return {
        set id(_value) {},
        set src(_value) {},
        set async(_value) {},
      };
    },
    querySelector(selector) {
      const value = selectors && selectors[selector];
      return value ? { textContent: value } : null;
    },
    querySelectorAll(selector) {
      if (typeof queryAll === 'function') return queryAll(selector);
      if (queryAll && queryAll[selector]) return queryAll[selector];
      return [];
    },
    addEventListener() {},
  };
  const locationUrl = new URL(url);
  const chrome = {
    runtime: {
      getURL(value) { return value; },
      onMessage: {
        addListener(fn) {
          messageListener = fn;
        },
      },
    },
  };
  const sandbox = {
    console,
    document,
    location: {
      href: locationUrl.href,
      hostname: locationUrl.hostname,
    },
    chrome,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
  sandbox.window = {
    location: sandbox.location,
    addEventListener(type, fn) {
      windowListeners[type] = fn;
    },
    removeEventListener(type) {
      delete windowListeners[type];
    },
    postMessage(payload) {
      if (payload && payload.direction === 'spb-self-hosted:content' && windowListeners.message) {
        setTimeout(() => {
          windowListeners.message({
            source: sandbox.window,
            data: {
              direction: 'spb-self-hosted:bridge',
              requestId: payload.requestId,
              ok: true,
              payload: pageState || {},
            },
          });
        }, 0);
      }
    },
  };
  sandbox.globalThis = sandbox;
  sandbox.window.window = sandbox.window;
  sandbox.window.document = document;
  sandbox.window.chrome = chrome;
  sandbox.window.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(priceCurrencyScript, sandbox, { filename: 'price-currency.js' });
  vm.runInContext(sourceProductCoreScript, sandbox, { filename: 'source-product-core.js' });
  vm.runInContext(collectScript, sandbox, { filename: 'collect-content-script.js' });

  assert.equal(typeof messageListener, 'function', 'collect script should register a runtime message listener');
  return await new Promise((resolve) => {
    messageListener({ type: 'spb-self-hosted:collect-product' }, {}, resolve);
  });
}

const aliResponse = await collectWithPage({
  url: 'https://detail.1688.com/offer/733344455566.html',
  title: '1688 detail',
  bodyText: '起批价 ¥12.80 近30天成交 1200 运费 ¥6 起',
  selectors: {
    h1: '1688 同款货源',
    '.price': '¥12.80 - ¥15.50',
  },
  pageState: {
    knownGlobals: {
      offer: {
        offerId: '733344455566',
        subject: '1688 同款货源',
        priceRange: '12.80-15.50',
      },
    },
  },
});

assert.equal(aliResponse.ok, true);
assert.equal(aliResponse.data.priceCny, 15.5);
assert.equal(aliResponse.data.priceText, '¥12.80 - ¥15.50');
assert.equal(aliResponse.data.priceSourceType, 'rangeHigh');
assert.equal(aliResponse.data.shippingCny, 6);
assert.equal(aliResponse.data.totalCostCny, 21.5);
assert.equal(aliResponse.data.currency, 'CNY');

const aliTitlePriorityResponse = await collectWithPage({
  url: 'https://detail.1688.com/offer/811122233344.html',
  title: '1688 company title priority',
  bodyText: '智能保温杯 ¥18.80 近30天成交 3200',
  selectors: {
    '.price': '¥18.80',
  },
  pageState: {
    knownGlobals: {
      offer: {
        offerId: '811122233344',
        companyName: '揭阳市玖点服装有限公司',
        subject: '智能保温杯批发',
      },
    },
  },
});

assert.equal(aliTitlePriorityResponse.ok, true);
assert.equal(aliTitlePriorityResponse.data.title, '智能保温杯批发');
assert.equal(aliTitlePriorityResponse.data.shopName, '揭阳市玖点服装有限公司');

const aliStructuredPantsResponse = await collectWithPage({
  url: 'https://detail.1688.com/offer/953122376708.html?offerId=953122376708&hotSaleSkuId=6036311658769',
  title: '揭阳市揭东区新亨镇小树树服装店',
  bodyText: '¥16.00 1条起批 已售800+条 藏青色 L ¥16 库存19999917条 - 1 + 已选1款1条 商品金额： ¥16 另需运费（预估）： ¥3.5',
  selectors: {
    h1: '揭阳市揭东区新亨镇小树树服装店',
    '.company-name': '揭阳市揭东区新亨镇小树树服装店',
  },
  pageState: {
    knownGlobals: {
      offerDetailData: {
        offerId: '953122376708',
        companyName: '揭阳市揭东区新亨镇小树树服装店',
        subject: '棉麻九分裤男士直筒宽松夏季薄款松紧腰白色中国风亚麻休闲裤子男',
        imageList: [
          'https://img.alicdn.com/imgextra/i4/O1CN01DqZtmR1MFXa1N8MmN_!!6000000001405-55-tps-15-14.svg',
          'https://cbu01.alicdn.com/img/ibank/O1CN01D0D3Sx1KjeLthDyvr_!!2207621481200-0-cib.jpg_.webp',
          'https://img.alicdn.com/imgextra/i1/6000000006798/O1CN01e9cj0y205XaaPZPXW_!!6000000006798-2-gg_dtc.png',
          'https://img.alicdn.com/imgextra/i2/O1CN01mOEB1b1FYamKsqhTz_!!4611686018427382835-0-rate.jpg_b.jpg',
        ],
        skuProps: [
          {
            prop: '颜色',
            value: [
              { name: '深灰色', imageUrl: 'https://cbu01.alicdn.com/img/ibank/O1CN01CuK49n1KjeLvOq5wF_!!2207621481200-0-cib.jpg_sum.jpg' },
              { name: '藏青色', imageUrl: 'https://cbu01.alicdn.com/img/ibank/O1CN01J1suz31KjeLuRvyjf_!!2207621481200-0-cib.jpg_.webp' },
            ],
          },
          { prop: '尺码', value: [{ name: 'M' }, { name: 'L' }, { name: 'XL' }] },
        ],
        skuMap: {
          '藏青色>L': {
            skuId: '6036311658769',
            price: '16',
            stock: 19999917,
          },
        },
        props: [
          { name: '主面料成分', value: '亚麻' },
          { name: '面料名称', value: '麻布' },
          { name: '厚薄', value: '薄款' },
        ],
      },
    },
  },
});

assert.equal(aliStructuredPantsResponse.ok, true);
assert.equal(aliStructuredPantsResponse.data.title, '棉麻九分裤男士直筒宽松夏季薄款松紧腰白色中国风亚麻休闲裤子男');
assert.equal(aliStructuredPantsResponse.data.shopName, '揭阳市揭东区新亨镇小树树服装店');
assert.ok(aliStructuredPantsResponse.data.images.length >= 2);
assert.ok(aliStructuredPantsResponse.data.images.every((url) => !/-tps-|gg_dtc|rate|\\.svg/i.test(url)), '1688 product images should exclude platform art and review images');
assert.ok(aliStructuredPantsResponse.data.images.every((url) => !/_sum\\.jpg|_\\.webp/i.test(url)), '1688 product images should be normalized away from thumbnail suffixes');
assert.equal(aliStructuredPantsResponse.data.skuItems[0].skuId, '6036311658769');
assert.deepEqual(plain(aliStructuredPantsResponse.data.skuItems[0].attrs), { 颜色: '藏青色', 尺码: 'L' });
assert.equal(aliStructuredPantsResponse.data.skuItems[0].stock, 19999917);
assert.ok(aliStructuredPantsResponse.data.skuItems.every((item) => !/已选|商品金额|运费/.test(item.name || item.specText || '')));

const aliBraTextMatrixResponse = await collectWithPage({
  url: 'https://detail.1688.com/offer/965731536766.html?offerId=965731536766&hotSaleSkuId=5905150268481',
  title: '大u型露美背隐形内衣无痕粉底液小胸聚拢特调肤色细肩带夏季文胸',
  bodyText: [
    '商品属性 款式 大露背 面料名称 锦纶 功能 聚拢、透气、上托、舒适',
    '颜色 优雅黑【超低露背 穿搭隐形】 粉底液肤【超低露背 穿搭隐形】 奶皮白【超低露背 穿搭隐形】',
    '尺码 S适合70/32ABC M适合75/34ABC L适合80/36ABC XL适合85/38ABC',
    '优雅黑 【超低露背 穿搭隐形】 粉底液肤【超低露背 穿搭隐形】 奶皮白 【超低露背 穿搭隐形】 S适合70/32ABC M适合75/34ABC L适合80/36ABC XL适合85/38ABC ¥12.33 库存999',
  ].join(' '),
  selectors: {
    h1: '大u型露美背隐形内衣无痕粉底液小胸聚拢特调肤色细肩带夏季文胸',
  },
  queryAll(selector) {
    if (!String(selector).includes('sku')) return [];
    return [
      makeMockElement({
        text: '优雅黑 【超低露背 穿搭隐形】 粉底液肤【超低露背 穿搭隐形】 奶皮白 【超低露背 穿搭隐形】 S适合70/32ABC M适合75/34ABC L适合80/36ABC XL适合85/38ABC ¥12.33 库存999',
        className: 'sku-list',
      }),
    ];
  },
  pageState: {
    knownGlobals: {
      offerDetailData: {
        offerId: '965731536766',
        subject: '大u型露美背隐形内衣无痕粉底液小胸聚拢特调肤色细肩带夏季文胸',
        offerProps: [
          { name: '里料成分', value: '锦纶/尼龙' },
          { name: '产地', value: '汕头' },
          { name: '货号', value: '8838#AA' },
          { name: '颜色', value: '优雅黑【超低露背 穿搭隐形】、粉底液肤【超低露背 穿搭隐形】、奶皮白【超低露背 穿搭隐形】' },
          { name: '尺码', value: 'S适合70/32ABC、M适合75/34ABC、L适合80/36ABC、XL适合85/38ABC' },
          { name: '上市时间', value: '2025夏季' },
          { name: '罩杯型', value: '3/4罩杯' },
          { name: '排扣类型', value: '后单排搭扣' },
          { name: '肩带类型', value: '可拆卸双肩带' },
          { name: '主面料成分含量', value: '50%（含）-70%（不含）' },
          { name: '风格', value: '辣妹' },
        ],
      },
    },
  },
});

assert.equal(aliBraTextMatrixResponse.ok, true);
assert.equal(aliBraTextMatrixResponse.data.skuItems.length, 12);
assert.ok(aliBraTextMatrixResponse.data.skuItems.every((item) => item.attrs?.颜色 && item.attrs?.尺码), '1688 text matrix variants should carry color and size attrs');
assert.ok(aliBraTextMatrixResponse.data.skuItems.some((item) => item.attrs.颜色 === '优雅黑【超低露背 穿搭隐形】' && item.attrs.尺码 === 'L适合80/36ABC'));
assert.ok(aliBraTextMatrixResponse.data.skuItems.every((item) => !/^(里料成分|产地|货号|颜色|尺码|上市时间|罩杯型|排扣类型|肩带类型|主面料成分含量|风格)$/.test(item.name || '')));
assert.ok(aliBraTextMatrixResponse.data.skuItems.every((item) => !/粉底液肤.*奶皮白.*S适合.*M适合.*L适合/s.test(item.name || item.specText || '')));
assert.ok(aliBraTextMatrixResponse.data.skuItems.every((item) => Array.isArray(item.images) && item.images.length === 0), 'do not attach the same product image to every text-inferred variant');

const aliBraFunctionNoiseMatrixResponse = await collectWithPage({
  url: 'https://detail.1688.com/offer/1025802373364.html?offerId=1025802373364&hotSaleSkuId=6200788978652',
  title: '夏季无痕聚拢上托新款冰丝内衣女无钢圈国风浮雕提花前扣文胸背心',
  bodyText: [
    '商品属性 款式 背心式 功能 聚拢、无痕、透气、上托、防走光、舒适 主面料成分 锦纶 面料名称 锦纶 模杯面料 棉 罩杯型 全罩杯 里料成分 氨纶 品牌 其他',
    '适用年龄段 青年（18-40周岁） 颜色 檀香肤、丁香紫、胭脂红、柳茶绿、檀木咖、水墨黑',
    '尺码 M【建议80-100斤】、L【建议100-120斤】、XL【建议120-140斤】、2XL【建议140-160斤】、3XL【建议160-180斤】',
    '包装信息 商品件重尺 颜色 尺码 长(cm) 宽(cm) 高(cm) 体积(cm³) 重量(g)',
  ].join(' '),
  selectors: {
    h1: '夏季无痕聚拢上托新款冰丝内衣女无钢圈国风浮雕提花前扣文胸背心',
  },
  pageState: {
    knownGlobals: {
      offerDetailData: {
        offerId: '1025802373364',
        subject: '夏季无痕聚拢上托新款冰丝内衣女无钢圈国风浮雕提花前扣文胸背心',
        offerProps: [
          {
            name: '款式',
            value: '背心式 功能 聚拢、无痕、透气、上托、防走光、舒适 主面料成分 锦纶 面料名称 锦纶 模杯面料 棉 罩杯型 全罩杯 里料成分 氨纶 品牌 其他',
          },
          { name: '品牌', value: '其他' },
          { name: '材质', value: '锦纶' },
          { name: '成分', value: '锦纶' },
          { name: '面料', value: '棉' },
          { name: '季节', value: '夏季、四季通用' },
          { name: '风格', value: '奢华高贵' },
          { name: '颜色', value: '檀香肤、丁香紫、胭脂红、柳茶绿、檀木咖、水墨黑' },
          { name: '尺码', value: 'M【建议80-100斤】、L【建议100-120斤】、XL【建议120-140斤】、2XL【建议140-160斤】、3XL【建议160-180斤】' },
          { name: '货号', value: '3183#' },
        ],
      },
    },
  },
});

assert.equal(aliBraFunctionNoiseMatrixResponse.ok, true);
assert.equal(aliBraFunctionNoiseMatrixResponse.data.skuItems.length, 30);
assert.ok(aliBraFunctionNoiseMatrixResponse.data.skuItems.every((item) => item.attrs?.颜色 && item.attrs?.尺码), '1688 bra variants should only carry color and size attrs');
assert.ok(aliBraFunctionNoiseMatrixResponse.data.skuItems.some((item) => item.attrs.颜色 === '檀香肤' && item.attrs.尺码 === 'M【建议80-100斤】'));
assert.ok(aliBraFunctionNoiseMatrixResponse.data.skuItems.some((item) => item.attrs.颜色 === '水墨黑' && item.attrs.尺码 === '3XL【建议160-180斤】'));
assert.ok(aliBraFunctionNoiseMatrixResponse.data.skuItems.every((item) => !/无痕 \/ 透气|上托 \/ 防走光|舒适 主面料|主面料成分|罩杯型|适用年龄段/.test(item.name || item.specText || '')));

const aliPantsWeightSizeMatrixResponse = await collectWithPage({
  url: 'https://detail.1688.com/offer/1037213576946.html?offerId=1037213576946&hotSaleSkuId=6217325499120',
  title: '100%纯亚麻裤子男春秋薄款九分裤宽松显瘦休闲哈伦裤大码直筒裤男',
  bodyText: [
    '商品属性 货源类别 现货 淘货类别 时尚都市 裤型 哈伦裤 裤长 九分裤 腰型 中腰 是否有腰带 无腰带',
    '颜色 亚麻-色 夏款 灰-色 夏款 藏青-色 夏款 黑-色 夏款 绿-色 夏款',
    '尺码 M 80-100斤 L 100-110斤 XL 110-120斤 2XL 120-130斤 3XL 130-145斤 4XL 145-160斤 5XL 160-180斤',
    '亚麻-色 夏款 灰-色 夏款 藏青-色 夏款 黑-色 夏款 绿-色 夏款 L 100-110斤 1条 M 80-100斤 1条 XL 110-120斤 1条',
  ].join(' '),
  selectors: {
    h1: '100%纯亚麻裤子男春秋薄款九分裤宽松显瘦休闲哈伦裤大码直筒裤男',
  },
  queryAll(selector) {
    if (!String(selector).includes('sku')) return [];
    return [
      makeMockElement({
        text: '亚麻-色 夏款 灰-色 夏款 藏青-色 夏款 黑-色 夏款 绿-色 夏款 L 100-110斤 1条 M 80-100斤 1条 XL 110-120斤 1条',
        className: 'sku-list',
      }),
    ];
  },
  pageState: {
    knownGlobals: {
      offerDetailData: {
        offerId: '1037213576946',
        subject: '100%纯亚麻裤子男春秋薄款九分裤宽松显瘦休闲哈伦裤大码直筒裤男',
        offerProps: [
          { name: '货源类别', value: '现货' },
          { name: '淘货类别', value: '时尚都市' },
          { name: '裤型', value: '哈伦裤' },
          { name: '裤长', value: '九分裤' },
          { name: '腰型', value: '中腰' },
          { name: '是否有腰带', value: '无腰带' },
          { name: '裤门襟', value: '系带闭襟' },
          { name: '图案', value: '纯色' },
          { name: '误差范围', value: '1-3cm' },
          { name: '适合季节', value: '夏季' },
          { name: '颜色', value: '亚麻-色 夏款、灰-色 夏款、藏青-色 夏款、黑-色 夏款、绿-色 夏款' },
          { name: '尺码', value: 'M 80-100斤、L 100-110斤、XL 110-120斤、2XL 120-130斤、3XL 130-145斤、4XL 145-160斤、5XL 160-180斤' },
        ],
      },
    },
  },
});

assert.equal(aliPantsWeightSizeMatrixResponse.ok, true);
assert.equal(aliPantsWeightSizeMatrixResponse.data.skuItems.length, 35);
assert.ok(aliPantsWeightSizeMatrixResponse.data.skuItems.every((item) => item.attrs?.颜色 && item.attrs?.尺码), '1688 pants variants should carry color and size attrs');
assert.ok(aliPantsWeightSizeMatrixResponse.data.skuItems.some((item) => item.attrs.颜色 === '亚麻-色 夏款' && item.attrs.尺码 === 'M 80-100斤'));
assert.ok(aliPantsWeightSizeMatrixResponse.data.skuItems.some((item) => item.attrs.颜色 === '绿-色 夏款' && item.attrs.尺码 === '5XL 160-180斤'));
assert.ok(aliPantsWeightSizeMatrixResponse.data.skuItems.every((item) => !/^(货源类别|淘货类别|裤型|裤长|腰型|是否有腰带|裤门襟|图案|误差范围|适合季节)$/.test(item.name || '')));
assert.ok(aliPantsWeightSizeMatrixResponse.data.skuItems.every((item) => !/斤\s*条.*斤\s*条/s.test(item.name || item.specText || '')));

const aliGenericSalePropMatrixResponse = await collectWithPage({
  url: 'https://detail.1688.com/offer/104444555666.html?offerId=104444555666',
  title: '厨房食品收纳罐密封罐透明塑料五谷杂粮储物罐批发',
  bodyText: [
    '商品属性 品牌 无 材质 PET 产地 浙江 是否进口 否',
    '规格 基础款 升级款 加厚款',
    '容量 500ml、1000ml',
    '基础款 500ml ¥3.2 库存999件 升级款 1000ml ¥5.8 库存888件',
  ].join(' '),
  selectors: {
    h1: '厨房食品收纳罐密封罐透明塑料五谷杂粮储物罐批发',
  },
  pageState: {
    knownGlobals: {
      offerDetailData: {
        offerId: '104444555666',
        subject: '厨房食品收纳罐密封罐透明塑料五谷杂粮储物罐批发',
        offerProps: [
          { name: '品牌', value: '无' },
          { name: '材质', value: 'PET' },
          { name: '产地', value: '浙江' },
          { name: '是否进口', value: '否' },
          { name: '规格', value: '基础款 升级款 加厚款' },
          { name: '容量', value: '500ml、1000ml' },
        ],
      },
    },
  },
});

assert.equal(aliGenericSalePropMatrixResponse.ok, true);
assert.equal(aliGenericSalePropMatrixResponse.data.skuItems.length, 6);
assert.ok(aliGenericSalePropMatrixResponse.data.skuItems.every((item) => item.attrs?.规格 && item.attrs?.容量), '1688 generic sale props should become variant attrs');
assert.ok(aliGenericSalePropMatrixResponse.data.skuItems.some((item) => item.attrs.规格 === '基础款' && item.attrs.容量 === '500ml'));
assert.ok(aliGenericSalePropMatrixResponse.data.skuItems.some((item) => item.attrs.规格 === '加厚款' && item.attrs.容量 === '1000ml'));
assert.ok(aliGenericSalePropMatrixResponse.data.skuItems.every((item) => !/^(品牌|材质|产地|是否进口|规格|容量)$/.test(item.name || '')));

const aliShopNameTitleFallbackResponse = await collectWithPage({
  url: 'https://detail.1688.com/offer/953122376708.html',
  title: '揭阳市揭东区新亨镇小树树服装店',
  bodyText: '¥16.00 近30天成交 120 藏青色 3XL ¥16 库存20件 - 1 + 已选1款1件 商品金额： ¥16 另需运费（预估）： ¥3.5',
  selectors: {
    h1: '揭阳市揭东区新亨镇小树树服装店',
    '.company-name': '揭阳市揭东区新亨镇小树树服装店',
  },
  pageState: {
    knownGlobals: {
      offer: {
        offerId: '953122376708',
        companyName: '揭阳市揭东区新亨镇小树树服装店',
      },
    },
  },
});

assert.equal(aliShopNameTitleFallbackResponse.ok, true);
assert.equal(aliShopNameTitleFallbackResponse.data.title, '1688 商品 953122376708');
assert.notEqual(aliShopNameTitleFallbackResponse.data.title, '揭阳市揭东区新亨镇小树树服装店');

const aliOzonContextFallbackResponse = await collectWithPage({
  url: 'https://detail.1688.com/offer/811122233344.html',
  title: 'Ozon SKU 1580539717 跟卖核价',
  bodyText: '起批价 ¥18.80 近30天成交 3200',
  selectors: {
    '.price': '¥18.80',
  },
  pageState: {
    knownGlobals: {
      searchContext: {
        ozon: {
          productId: '1580539717',
          title: 'Ozon SKU 1580539717 跟卖商品',
          url: 'https://www.ozon.ru/product/example-1580539717/',
        },
      },
      offer: {
        offerId: '811122233344',
      },
    },
  },
});

assert.equal(aliOzonContextFallbackResponse.ok, true);
assert.equal(aliOzonContextFallbackResponse.data.title, '1688 商品 811122233344');
assert.doesNotMatch(aliOzonContextFallbackResponse.data.title, /Ozon|1580539717/i);

const aliCompleteSourceResponse = await collectWithPage({
  url: 'https://detail.1688.com/offer/744455566677.html',
  title: '1688 complete source detail',
  bodyText: '智能保温杯 ¥18.80 ~ ¥22.50 近30天成交 3200 运费 ¥5 重量 350g 尺寸 8x8x22cm',
  selectors: {
    h1: '智能保温杯批发',
    '.price': '¥18.80 ~ ¥22.50',
  },
  pageState: {
    knownGlobals: {
      offer: {
        offerId: '744455566677',
        subject: '智能保温杯批发',
        categoryPath: ['日用百货', '杯具', '保温杯'],
        properties: [
          { name: '材质', value: '316不锈钢' },
          { attrName: '容量', attrValue: '500ml' },
        ],
        detailDescription: '双层真空保温，适合跨境上架。',
        detailImages: ['https://img.example.com/detail-1.jpg'],
        mainImage: 'https://img.example.com/main.jpg',
        videos: [{ url: 'https://video.example.com/a.mp4', coverUrl: 'https://img.example.com/video.jpg', title: '展示视频' }],
        packageSize: { length: 80, width: 80, height: 220, unit: 'mm' },
        packagingInfo: [
          {
            color: '红色',
            size: '500ml',
            length: 8,
            width: 8,
            height: 22,
            unit: 'cm',
            volumeCm3: 1408,
            weight: 350,
            weightUnit: 'g',
          },
        ],
        skuProps: [
          {
            skuId: 'red-500',
            specText: '红色 500ml',
            price: '18.80',
            stock: 88,
            image: 'https://img.example.com/red.jpg',
            attributes: { 颜色: '红色', 容量: '500ml' },
          },
        ],
      },
    },
  },
});

assert.equal(aliCompleteSourceResponse.ok, true);
assert.deepEqual(plain(aliCompleteSourceResponse.data.categoryPath), ['日用百货', '杯具', '保温杯']);
assert.equal(aliCompleteSourceResponse.data.categoryName, '保温杯');
assert.deepEqual(plain(aliCompleteSourceResponse.data.dimensionsMm), { lengthMm: 80, widthMm: 80, heightMm: 220 });
assert.equal(aliCompleteSourceResponse.data.lengthMm, 80);
assert.equal(aliCompleteSourceResponse.data.widthMm, 80);
assert.equal(aliCompleteSourceResponse.data.heightMm, 220);
assert.equal(aliCompleteSourceResponse.data.description, '双层真空保温，适合跨境上架。');
assert.deepEqual(plain(aliCompleteSourceResponse.data.sourceVideos), [{ url: 'https://video.example.com/a.mp4', coverUrl: 'https://img.example.com/video.jpg', title: '展示视频' }]);
assert.deepEqual(plain(aliCompleteSourceResponse.data.images), ['https://img.example.com/main.jpg', 'https://img.example.com/red.jpg']);
assert.deepEqual(plain(aliCompleteSourceResponse.data.sourceMainImages), ['https://img.example.com/main.jpg', 'https://img.example.com/red.jpg']);
assert.deepEqual(plain(aliCompleteSourceResponse.data.sourceDetailImages), ['https://img.example.com/detail-1.jpg']);
assert.equal(aliCompleteSourceResponse.data.richDescriptionJson || null, null);
assert.deepEqual(plain(aliCompleteSourceResponse.data.sourceRichContentDraft), {
  status: 'raw_source_requires_processing',
  source: '1688',
  locale: 'zh-CN',
  blocks: [
    { type: 'image', url: 'https://img.example.com/detail-1.jpg' },
    { type: 'text', text: '双层真空保温，适合跨境上架。' },
  ],
});
assert.deepEqual(plain(aliCompleteSourceResponse.data.sourcePackagingRows), [{
  color: '红色',
  size: '500ml',
  lengthMm: 80,
  widthMm: 80,
  heightMm: 220,
  volumeCm3: 1408,
  weightG: 350,
}]);
assert.deepEqual(plain(aliCompleteSourceResponse.data.attributes), [
  { name: '材质', value: '316不锈钢' },
  { name: '容量', value: '500ml' },
]);
assert.equal(aliCompleteSourceResponse.data.skuItems[0].skuId, 'red-500');
assert.deepEqual(plain(aliCompleteSourceResponse.data.skuItems[0].attrs), { 颜色: '红色', 容量: '500ml' });
assert.deepEqual(plain(aliCompleteSourceResponse.data.skuItems[0].images), ['https://img.example.com/red.jpg']);

const aliGeneralPackageWeightResponse = await collectWithPage({
  url: 'https://detail.1688.com/offer/945335480485.html',
  title: '1688 package weight source detail',
  bodyText: [
    '商品属性 颜色 隐形肤 性感黑 香槟白 尺码 S M L XL',
    '包装信息 商品件重尺 重量(g) 20 商品详情',
  ].join(' '),
  selectors: {},
  pageState: {
    knownGlobals: {
      offerDetailData: {
        offerId: '945335480485',
        subject: '黑色挂脖吊带美背文胸内衣女小胸聚拢交叉u露背粉底液隐形无痕',
        productProps: [
          { name: '颜色', value: '隐形肤、性感黑、香槟白' },
          { name: '尺码', value: 'S、M、L、XL' },
        ],
        priceInfo: { price: '8.5' },
        imageList: ['https://cbu01.alicdn.com/img/ibank/O1CN-main.jpg'],
      },
    },
  },
});

assert.equal(aliGeneralPackageWeightResponse.ok, true);
assert.equal(aliGeneralPackageWeightResponse.data.weightG, 20);
assert.equal(aliGeneralPackageWeightResponse.data.grossWeightGrams, 20);
assert.deepEqual(plain(aliGeneralPackageWeightResponse.data.sourcePackagingRows), []);

const aliDomWeightOnlyPackagingResponse = await collectWithPage({
  url: 'https://detail.1688.com/offer/6095051852380.html',
  title: '1688 dom weight-only packaging table',
  bodyText: '儿童小医生玩具套装 包装信息 商品件重尺 重量(g) 800 商品详情',
  selectors: {
    h1: '儿童小医生玩具套装女孩过家家医疗箱看病宝宝3-6岁礼物',
    '.price': '¥8.00',
  },
  queryAll(selector) {
    if (selector === 'table') {
      const makeCell = (text) => ({ innerText: text, textContent: text });
      const makeRow = (cells) => ({
        querySelectorAll(cellSelector) {
          return cellSelector === 'th,td' ? cells.map(makeCell) : [];
        },
      });
      return [{
        innerText: '包装信息 商品件重尺 重量(g) 800',
        textContent: '包装信息 商品件重尺 重量(g) 800',
        querySelectorAll(rowSelector) {
          return rowSelector === 'tr'
            ? [makeRow(['重量(g)']), makeRow(['800'])]
            : [];
        },
      }];
    }
    return [];
  },
  pageState: {
    knownGlobals: {
      offer: {
        offerId: '6095051852380',
        subject: '儿童小医生玩具套装女孩过家家医疗箱看病宝宝3-6岁礼物',
      },
    },
  },
});

assert.equal(aliDomWeightOnlyPackagingResponse.ok, true);
assert.equal(aliDomWeightOnlyPackagingResponse.data.grossWeightGrams, 800);
assert.deepEqual(plain(aliDomWeightOnlyPackagingResponse.data.sourcePackagingRows), [{ weightG: 800 }]);

const aliCleanStructuredAttributesResponse = await collectWithPage({
  url: 'https://detail.1688.com/offer/945335480485.html',
  title: '1688 clean attributes source detail',
  bodyText: [
    '商品属性 颜色 隐形肤 性感黑 香槟白 尺码 S (适合75-95斤32/70AB) M (适合95-110斤34/75AB) L (适合110-125斤36/80AB) XL (适合125-140斤38/85AB) 已选 隐形肤 S',
    '款式 美背型 面料名称 锦纶 功能 上托 主面料成分 锦纶 模杯面料 聚酰胺纤维(锦纶) 模杯类型 厚模杯 里料成分 聚酯纤维（涤纶） 适用年龄段 青年（18-40周岁）',
    '材质 、功效、功能等多维度要素具有高度的相似性 成分 锦纶 面料 名称 风格 简约休闲 货号 8838',
  ].join(' '),
  selectors: {},
  queryAll(selector) {
    if (/(attr|Attr|prop|Prop|param|Param|spec|Spec|属性|参数)/.test(selector)) {
      return [
        makeMockElement({ text: '款式 美背型 面料名称 锦纶 功能 上托 主面料成分 锦纶 模杯面料 聚酰胺纤维(锦纶) 模杯类型 厚模杯 里料成分 聚酯纤维（涤纶） 适用年龄段 青年（18-40周岁）' }),
        makeMockElement({ text: '材质 、功效、功能等多维度要素具有高度的相似性' }),
        makeMockElement({ text: '面料 名称' }),
        makeMockElement({ text: '尺码 S' }),
      ];
    }
    return [];
  },
  pageState: {
    knownGlobals: {
      offerDetailData: {
        offerId: '945335480485',
        subject: '黑色挂脖吊带美背文胸内衣女小胸聚拢交叉u露背粉底液隐形无痕',
        productProps: [
          { name: '颜色', value: '隐形肤、性感黑、香槟白' },
          { name: '尺码', value: 'S (适合75-95斤32/70AB)、M (适合95-110斤34/75AB)、L (适合110-125斤36/80AB)、XL (适合125-140斤38/85AB)' },
          {
            name: '款式',
            value: '美背型 面料名称 锦纶 功能 上托 主面料成分 锦纶 模杯面料 聚酰胺纤维(锦纶) 模杯类型 厚模杯 里料成分 聚酯纤维（涤纶） 适用年龄段 青年（18-40周岁）',
          },
          { name: '品牌', value: '其他' },
          { name: '货号', value: '8838' },
        ],
        priceInfo: { price: '8.5' },
        imageList: ['https://cbu01.alicdn.com/img/ibank/O1CN-main.jpg'],
      },
    },
  },
});

assert.equal(aliCleanStructuredAttributesResponse.ok, true);
{
  const attrs = Object.fromEntries(aliCleanStructuredAttributesResponse.data.attributes.map((attr) => [attr.name, attr.value]));
  assert.equal(attrs['颜色'], '隐形肤、性感黑、香槟白');
  assert.equal(attrs['尺码'].includes('XL'), true);
  assert.equal(attrs['款式'], '美背型');
  assert.equal(attrs['面料名称'], '锦纶');
  assert.equal(attrs['功能'], '上托');
  assert.equal(attrs['主面料成分'], '锦纶');
  assert.equal(attrs['模杯面料'], '聚酰胺纤维(锦纶)');
  assert.equal(attrs['模杯类型'], '厚模杯');
  assert.equal(attrs['里料成分'], '聚酯纤维（涤纶）');
  assert.equal(attrs['适用年龄段'], '青年（18-40周岁）');
  assert.equal(aliCleanStructuredAttributesResponse.data.attributes.filter((attr) => attr.name === '尺码').length, 1);
  assert.equal(JSON.stringify(aliCleanStructuredAttributesResponse.data.attributes).includes('相似性'), false);
  assert.equal(JSON.stringify(aliCleanStructuredAttributesResponse.data.attributes).includes('面料","value":"名称'), false);
  assert.equal(aliCleanStructuredAttributesResponse.data.attributes.some((attr) => attr.name === '款式' && attr.value.includes('面料名称')), false);
}

const aliDomFallbackSourceResponse = await collectWithPage({
  url: 'https://detail.1688.com/offer/955566677788.html',
  title: '1688 dom source detail',
  bodyText: '女装连衣裙跨境货源 ¥16.00 运费 ¥3.5 重量 350g 尺寸 30x20x3cm',
  selectors: {
    h1: '女装连衣裙跨境货源',
    '.price': '¥16.00',
  },
  queryAll(selector) {
    if (selector === 'img') {
      return [
        makeMockElement({ src: 'https://img.alicdn.com/imgextra/i4/O1CN01demo.svg' }),
        makeMockElement({ src: 'https://gw.alicdn.com/imgextra/i4/O1CN01logo-160-160.png' }),
        makeMockElement({ src: 'https://cbu01.alicdn.com/img/ibank/O1CN01main_!!2200-0-cib.jpg_.webp' }),
        makeMockElement({ src: 'https://cbu01.alicdn.com/img/ibank/O1CN01detail_!!2200-0-cib.jpg_.webp' }),
      ];
    }
    if (/(attr|Attr|prop|Prop|param|Param|属性|参数)/.test(selector)) {
      return [
        makeMockElement({ text: '材质 聚酯纤维' }),
        makeMockElement({ text: '成分 95%聚酯纤维' }),
        makeMockElement({ text: '适用性别 女' }),
      ];
    }
    if (/(description|Description|desc|Desc|detail|Detail|详情|描述)/.test(selector)) {
      return [makeMockElement({ text: '适合跨境上架的夏季女装连衣裙，轻薄透气。' })];
    }
    return [];
  },
  pageState: {
    knownGlobals: {
      offer: {
        offerId: '955566677788',
      },
    },
  },
});

assert.equal(aliDomFallbackSourceResponse.ok, true);
assert.deepEqual(plain(aliDomFallbackSourceResponse.data.attributes), [
  { name: '材质', value: '聚酯纤维' },
  { name: '成分', value: '95%聚酯纤维' },
  { name: '适用性别', value: '女' },
]);
assert.equal(aliDomFallbackSourceResponse.data.description, '适合跨境上架的夏季女装连衣裙，轻薄透气。');
assert.deepEqual(plain(aliDomFallbackSourceResponse.data.images), [
  'https://cbu01.alicdn.com/img/ibank/O1CN01main_!!2200-0-cib.jpg',
  'https://cbu01.alicdn.com/img/ibank/O1CN01detail_!!2200-0-cib.jpg',
]);
assert.deepEqual(plain(aliDomFallbackSourceResponse.data.extractionDiagnostics), {
  titleFound: true,
  imageCount: 2,
  skuCount: 0,
  attributeCount: 3,
  descriptionFound: true,
  videoCount: 0,
});

const selectedSkuResponse = await collectWithPage({
  url: 'https://detail.1688.com/offer/1032907994887.html',
  title: '1688 selected sku detail',
  bodyText: '¥98.00 ~ ¥134.10 1个起批 运费 ¥0 起',
  selectors: {
    h1: '鱼缸过滤制氧一体机',
    '.price': '¥98.00 ~ ¥134.10',
  },
  queryAll(selector) {
    if (!/(sku|Sku|spec|Spec|\bli\b|\btr\b|role="row")/.test(selector)) return [];
    return [
      makeMockElement({ text: '颜色 大号过滤制氧一体 ¥98 库存413个', className: 'sku-row selected' }),
      makeMockElement({ text: '颜色 特大号过滤制氧一体 ¥134.10 库存254个', className: 'sku-row' }),
    ];
  },
  pageState: {
    knownGlobals: {
      offer: {
        offerId: '1032907994887',
        subject: '鱼缸过滤制氧一体机',
      },
    },
  },
});

assert.equal(selectedSkuResponse.ok, true);
assert.equal(selectedSkuResponse.data.priceCny, 98);
assert.equal(selectedSkuResponse.data.priceText, '¥98');
assert.equal(selectedSkuResponse.data.priceSourceType, 'selectedSku');
assert.equal(selectedSkuResponse.data.selectedSku.price, 98);
assert.equal(selectedSkuResponse.data.shippingCny, 0);
assert.equal(selectedSkuResponse.data.totalCostCny, 98);

const selectedOrderSummaryResponse = await collectWithPage({
  url: 'https://detail.1688.com/offer/858352817684.html',
  title: '1688 selected order summary detail',
  bodyText: '¥10.80 ~ ¥14.50 2个起批 运费 ¥4.5 起 016白色英文款 ¥13.5 库存99965个 - 1 + 已选1款1个 商品金额： ¥13.50 另需运费（预估）： ¥4.5 48小时发货',
  selectors: {
    h1: '扫地机器人批发智能家用吸拖扫地机器人充电吸尘器',
    '.price': '¥10.80 ~ ¥14.50',
  },
  pageState: {
    knownGlobals: {
      offer: {
        offerId: '858352817684',
        subject: '扫地机器人批发智能家用吸拖扫地机器人充电吸尘器',
        priceRange: '10.80-14.50',
      },
    },
  },
});

assert.equal(selectedOrderSummaryResponse.ok, true);
assert.equal(selectedOrderSummaryResponse.data.priceCny, 13.5);
assert.equal(selectedOrderSummaryResponse.data.priceText, '¥13.5');
assert.equal(selectedOrderSummaryResponse.data.priceSourceType, 'selectedOrderSummary');
assert.equal(selectedOrderSummaryResponse.data.selectedSku.price, 13.5);
assert.equal(selectedOrderSummaryResponse.data.selectedSku.quantity, 1);
assert.match(selectedOrderSummaryResponse.data.selectedSku.name, /白色英文款/);
assert.ok(selectedOrderSummaryResponse.data.skuItems.length >= 1);
assert.ok(selectedOrderSummaryResponse.data.skuItems.some((item) => /白色英文款/.test(item.name)));
assert.equal(selectedOrderSummaryResponse.data.shippingCny, 4.5);
assert.equal(selectedOrderSummaryResponse.data.totalCostCny, 18);

const noisySkuTextResponse = await collectWithPage({
  url: 'https://detail.1688.com/offer/909011382013.html',
  title: '1688 noisy sku text detail',
  bodyText: [
    '白色 藏青色 灰色 杏色 浅紫色 卡其色 天蓝色 M 套 L 套 XL 套 XXL 套 XXXL 套 XXXXL 套 ¥79',
    '已售 万+件 ¥35 已售 +件 ¥18',
    '休闲宽松外套跨境防晒两件套男 商品复购率 % +人已加购 套起批 已售 +套 先采后付 元下单',
    '湖北 送至 福建厦门 运费 起 退货包运费 天天理由退货 晚发必赔 极速退款 支持跨境贴标 支持贴箱唛 白色 藏青色 灰色 杏色 浅紫色 卡其色 天蓝色 M ¥8',
    '商品评价 商品属性 包装信息 商品详情 热门推荐 全部好评 差评 有内容',
    '颜色 天蓝色 M 套 L 套 XL 套 XXL 套 XXXL 套 XXXXL 套 已选 款 套 商品金额： ¥79',
  ].join(' '),
  selectors: {
    h1: '广州泰昌隆贸易有限公司',
  },
  pageState: {
    knownGlobals: {
      offer: {
        offerId: '909011382013',
        subject: '男士防晒外套两件套',
      },
    },
  },
});

assert.equal(noisySkuTextResponse.ok, true);
assert.ok(noisySkuTextResponse.data.skuItems.length <= 2, 'marketing and page chrome text should not become SKU rows');
assert.ok(noisySkuTextResponse.data.skuItems.every((item) => !/退货|退款|跨境|商品评价|商品属性|包装信息|商品详情|已加购/.test(item.name || item.specText || '')));

const aliVisibleRangeGuardResponse = await collectWithPage({
  url: 'https://detail.1688.com/offer/700797177324.html',
  title: '1688 oxygen concentrator detail',
  bodyText: '舒坦福制氧机家用氧气机老人吸氧机 ¥298.00 ~ ¥678.00 1台起批 包邮 高配款 ¥430 库存7590台 标准款 ¥350 库存9803台 基础款 ¥298 库存4545台',
  selectors: {
    h1: '舒坦福制氧机家用氧气机老人吸氧机',
    '.price': '¥3580',
  },
  pageState: {
    knownGlobals: {
      offer: {
        offerId: '700797177324',
        subject: '舒坦福制氧机家用氧气机老人吸氧机',
        skuPrice: 3580,
        price: 3580,
      },
    },
  },
});

assert.equal(aliVisibleRangeGuardResponse.ok, true);
assert.equal(aliVisibleRangeGuardResponse.data.priceCny, 678);
assert.notEqual(aliVisibleRangeGuardResponse.data.priceCny, 3580);
assert.equal(aliVisibleRangeGuardResponse.data.priceSourceType, 'visibleRangeHigh');
assert.equal(aliVisibleRangeGuardResponse.data.totalCostCny, 678);

const aliVisibleRangeGuardDomResponse = await collectWithPage({
  url: 'https://detail.1688.com/offer/700797177324.html',
  title: '1688 oxygen concentrator sku row detail',
  bodyText: '舒坦福制氧机家用氧气机老人吸氧机 ¥298.00 ~ ¥678.00 1台起批 包邮 高配款 ¥430 库存7590台 标准款 ¥350 库存9803台 基础款 ¥298 库存4545台',
  selectors: {
    h1: '舒坦福制氧机家用氧气机老人吸氧机',
  },
  queryAll(selector) {
    if (!/(sku|Sku|spec|Spec|\bli\b|\btr\b|role="row")/.test(selector)) return [];
    return [
      makeMockElement({ text: '颜色 内部异常价格 ¥3580 库存7590台', className: 'sku-row selected' }),
      makeMockElement({ text: '颜色 标准款 ¥350 库存9803台', className: 'sku-row' }),
    ];
  },
  pageState: {
    knownGlobals: {
      offer: {
        offerId: '700797177324',
        subject: '舒坦福制氧机家用氧气机老人吸氧机',
      },
    },
  },
});

assert.equal(aliVisibleRangeGuardDomResponse.ok, true);
assert.equal(aliVisibleRangeGuardDomResponse.data.priceCny, 678);
assert.notEqual(aliVisibleRangeGuardDomResponse.data.priceCny, 3580);
assert.equal(aliVisibleRangeGuardDomResponse.data.priceSourceType, 'visibleRangeHigh');
assert.equal(aliVisibleRangeGuardDomResponse.data.totalCostCny, 678);

const aliSelectedTwoPiecesResponse = await collectWithPage({
  url: 'https://detail.1688.com/offer/1030901231971.html',
  title: '1688 oxygen generator selected quantity detail',
  bodyText: '负离子家用氧吧插电款老人吸氧机高原氧气机 ¥440.00 ~ ¥490.00 2件起批 包邮 DF-010-1标准款 ¥440 库存141件 - 0 + DF-010-1升级款 ¥490 库存56件 - 2 + 已选1款2件 商品金额： ¥980.00 包邮 24小时发货',
  selectors: {
    h1: '负离子家用氧吧插电款老人吸氧机高原氧气机',
  },
  queryAll(selector) {
    if (!/(sku|Sku|spec|Spec|\bli\b|\btr\b|role="row")/.test(selector)) return [];
    return [
      makeMockElement({ text: '颜色 DF-010-1标准款 ¥440 库存141件', className: 'sku-row', children: [makeMockElement({ value: '0' })] }),
      makeMockElement({ text: '颜色 DF-010-1升级款 ¥490 库存56件', className: 'sku-row', children: [makeMockElement({ value: '2' })] }),
    ];
  },
  pageState: {
    knownGlobals: {
      offer: {
        offerId: '1030901231971',
        subject: '负离子家用氧吧插电款老人吸氧机高原氧气机',
        price: 10,
        shippingFee: 1,
      },
    },
  },
});

assert.equal(aliSelectedTwoPiecesResponse.ok, true);
assert.equal(aliSelectedTwoPiecesResponse.data.priceCny, 490);
assert.equal(aliSelectedTwoPiecesResponse.data.priceText, '¥490');
assert.equal(aliSelectedTwoPiecesResponse.data.priceSourceType, 'selectedOrderSummary');
assert.equal(aliSelectedTwoPiecesResponse.data.selectedSku.quantity, 2);
assert.equal(aliSelectedTwoPiecesResponse.data.selectedSku.productAmount, 980);
assert.equal(aliSelectedTwoPiecesResponse.data.shippingCny, 0);
assert.equal(aliSelectedTwoPiecesResponse.data.totalCostCny, 490);

const aliSelectedSkuStepperResponse = await collectWithPage({
  url: 'https://detail.1688.com/offer/1030901231971.html',
  title: '1688 oxygen generator selected stepper detail',
  bodyText: '负离子家用氧吧插电款老人吸氧机高原氧气机 DF-010-1标准款 ¥440 库存141件 - 0 + DF-010-1升级款 ¥490 库存56件 - 1 + 包邮',
  selectors: {
    h1: '负离子家用氧吧插电款老人吸氧机高原氧气机',
  },
  queryAll(selector) {
    if (!/(sku|Sku|spec|Spec|\bli\b|\btr\b|role="row")/.test(selector)) return [];
    return [
      makeMockElement({ text: '颜色 DF-010-1标准款 ¥440 库存141件 - 0 +', className: 'sku-row' }),
      makeMockElement({ text: '颜色 DF-010-1升级款 ¥490 库存56件 - 1 +', className: 'sku-row' }),
    ];
  },
  pageState: {
    knownGlobals: {
      offer: {
        offerId: '1030901231971',
        subject: '负离子家用氧吧插电款老人吸氧机高原氧气机',
        price: 10,
        shippingFee: 1,
      },
    },
  },
});

assert.equal(aliSelectedSkuStepperResponse.ok, true);
assert.equal(aliSelectedSkuStepperResponse.data.priceCny, 490);
assert.equal(aliSelectedSkuStepperResponse.data.priceText, '¥490');
assert.equal(aliSelectedSkuStepperResponse.data.priceSourceType, 'selectedSku');
assert.equal(aliSelectedSkuStepperResponse.data.selectedSku.quantity, 1);
assert.equal(aliSelectedSkuStepperResponse.data.shippingCny, 0);
assert.equal(aliSelectedSkuStepperResponse.data.totalCostCny, 490);

const taobaoResponse = await collectWithPage({
  url: 'https://item.taobao.com/item.htm?id=99887766',
  title: 'Taobao detail',
  bodyText: '券后价 ￥89.90 月销量 300',
  selectors: {
    h1: '淘宝同款货源',
    '.Price--priceText': '￥89.90',
  },
  pageState: {
    knownGlobals: {
      item: {
        itemId: '99887766',
        title: '淘宝同款货源',
        promotionPrice: '89.90',
      },
    },
  },
});

assert.equal(taobaoResponse.ok, true);
assert.equal(taobaoResponse.data.priceCny, 89.9);
assert.equal(taobaoResponse.data.priceText, '￥89.90');
assert.equal(taobaoResponse.data.currency, 'CNY');

console.log('PASS source price extraction');
