import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const priceCurrencyScript = fs.readFileSync('extensions/ss-erp/shared/currency/price-currency.js', 'utf8');
const sourceProductCoreScript = fs.readFileSync('extensions/ss-erp/shared/collectors/source-product-core.js', 'utf8');
const collectScript = fs.readFileSync('extensions/ss-erp/content/collect-content-script.js', 'utf8');

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeMockElement({ text = '', className = '', attrs = {}, value = '', children = [] }) {
  return {
    textContent: text,
    innerText: text,
    className,
    value,
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
assert.ok(aliCompleteSourceResponse.data.images.includes('https://img.example.com/main.jpg'));
assert.ok(aliCompleteSourceResponse.data.images.includes('https://img.example.com/detail-1.jpg'));
assert.deepEqual(plain(aliCompleteSourceResponse.data.attributes), [
  { name: '材质', value: '316不锈钢' },
  { name: '容量', value: '500ml' },
]);
assert.equal(aliCompleteSourceResponse.data.skuItems[0].skuId, 'red-500');
assert.deepEqual(plain(aliCompleteSourceResponse.data.skuItems[0].attrs), { 颜色: '红色', 容量: '500ml' });
assert.deepEqual(plain(aliCompleteSourceResponse.data.skuItems[0].images), ['https://img.example.com/red.jpg']);

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
assert.equal(selectedOrderSummaryResponse.data.shippingCny, 4.5);
assert.equal(selectedOrderSummaryResponse.data.totalCostCny, 18);

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
