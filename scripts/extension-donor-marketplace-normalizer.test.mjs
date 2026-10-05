import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { test } from 'node:test';

function load() {
  const context = { URL, TextEncoder, TextDecoder, crypto: webcrypto };
  for (const file of ['contracts/source-product-capture-v2.js', 'collectors/source-product-core.js', 'collectors/donor-marketplace-normalizer.js']) {
    vm.runInNewContext(readFileSync('extensions/ss-erp/shared/' + file, 'utf8'), context, { filename: file });
  }
  return { api: context.SS_ERP_DONOR_MARKETPLACE_CAPTURE, contract: context.SS_ERP_SOURCE_PRODUCT_CAPTURE_V2 };
}
const observedAt = '2026-10-05T10:00:00.000Z';
const taobaoUrl = 'https://item.taobao.com/item.htm?id=12345678';
function taobao() {
  return { item: { itemId: '12345678', title: '收纳盒', images: ['//img.alicdn.com/main.webp'] }, seller: { shopName: '源头店' },
    skuBase: { props: [{ pid: '1', name: '颜色', values: [{ vid: 'red', name: '红色', picUrl: '//img.alicdn.com/red.jpg' }, { vid: 'blue', name: '蓝色', image: '//img.alicdn.com/blue.jpg' }] },
      { pid: '2', name: '尺寸', values: [{ vid: 'small', name: '小号' }] }],
      skus: [{ skuId: '10001', propPath: '1:red;2:small' }, { skuId: '10002', scId: 'alias-10002', propPath: '1:blue;2:small' }] },
    skuCore: { sku2info: { '0': { price: { priceText: '9.99' }, quantity: 999 },
      '10001': { price: { priceMoney: 1299 }, quantity: 0 }, 'alias-10002': { price: { priceText: '15.5' }, quantity: 6 } } },
    props: [{ name: '材质', value: '塑料' }], detailImages: ['//img.alicdn.com/detail.jpg'],
  };
}
function pdd() {
  return { goodsID: '87654321', goodsName: '双色收纳盒', minGroupPrice: 999,
    topGallery: [{ url: '//img.pddpic.com/main.webp' }], detailGallery: [{ url: '//img.pddpic.com/detail.jpg' }],
    goodsProperty: [{ key: '材质', values: ['塑料'] }, { name: '包装重量', value: '650g' }],
    goodsSkuList: [
      { sku_id: '20001', group_price: 999, stock: 0, specList: [{ spec_key: '颜色', spec_value: '红色' }], hdThumbUrl: '//img.pddpic.com/red.jpg' },
      { skuID: '20002', groupPrice: 1000, specs: { 颜色: '蓝色', 尺寸: '小号' }, quantity: 5, image: '//img.pddpic.com/blue.webp' },
    ], categoryList: [{ id: '1', name: '家居' }, { id: '2', name: '收纳用品' }] };
}
const context = (url, sources) => ({ url, sources, observedAt, extensionVersion: '1.0.421' });
const plain = value => JSON.parse(JSON.stringify(value));

test('Taobao joins real SKU IDs/scIds to prop paths and preserves zero stock and SKU pictures', async () => {
  const { api, contract } = load();
  const result = api.normalizeTaobao(context(taobaoUrl, [{ data: taobao() }]));
  assert.equal(result.productId, '12345678');
  assert.equal(result.shopName, '源头店');
  assert.equal(result.captureV2.provenanceMode, 'native_v2');
  assert.equal(result.captureV2.platform, 'taobao');
  assert.equal(result.captureV2.skus.length, 2, 'product-level sku2info[0] is not a real SKU');
  assert.deepEqual(plain(result.captureV2.skus.map(row => [row.sourceSkuId, row.priceCny, row.stock])), [['10001', 12.99, 0], ['10002', 15.5, 6]]);
  assert.deepEqual(plain(result.variants[0].attrs), { 颜色: '红色', 尺寸: '小号' });
  assert.equal(result.variants[0].images[0], 'https://img.alicdn.com/red.jpg');
  const first = result.captureV2.skus[0];
  assert.equal(first.fieldEvidence.stock.value, 0);
  assert.equal(first.fieldEvidence.stock.missingReason, null);
  assert.ok(first.mediaKeys.length);
  assert.ok(result.captureV2.media.some(media => media.skuKeys.includes(first.key) && media.url === 'https://img.alicdn.com/red.jpg'));
  const submission = await contract.createSourceProductCaptureV2Submission(result.captureV2);
  const validation = contract.validateSourceProductCaptureV2Submission(submission); assert.equal(validation.valid, true, JSON.stringify(validation.errors));
});

test('PDD handles donor goods aliases, property arrays/object specs, real IDs and cents below 1000', async () => {
  const { api, contract } = load();
  const result = api.normalizePdd(context('https://mobile.yangkeduo.com/goods.html?goods_id=87654321', [{ store: { initDataObj: { goods: pdd() } } }]));
  assert.equal(result.captureV2.platform, 'pdd');
  assert.deepEqual(plain(result.captureV2.skus.map(row => [row.sourceSkuId, row.priceCny, row.stock])), [['20001', 9.99, 0], ['20002', 10, 5]]);
  assert.deepEqual(plain(result.variants[1].attrs), { 颜色: '蓝色', 尺寸: '小号' });
  assert.equal(result.sourceMainImages[0], 'https://img.pddpic.com/main.webp', 'valid WebP extension is preserved');
  assert.equal(result.sourceDetailImages[0], 'https://img.pddpic.com/detail.jpg');
  assert.equal(result.captureV2.facts.packageWeightG, 650);
  assert.equal(result.captureV2.facts.packageLengthMm, null, 'no 300×200×100 default package');
  assert.equal(result.captureV2.facts.shippingCny, null, 'unknown shipping is not free shipping');
  assert.equal(result.captureV2.facts.totalCostCny, null);
  assert.deepEqual(plain(result.attributes[0]), { name: '材质', value: '塑料' });
  const submission = await contract.createSourceProductCaptureV2Submission(result.captureV2);
  const validation = contract.validateSourceProductCaptureV2Submission(submission); assert.equal(validation.valid, true, JSON.stringify(validation.errors));
});

test('exact product IDs beat the first cached recommendation for Taobao and PDD', () => {
  const { api } = load();
  const foreign = taobao(); foreign.item.itemId = '11111111'; foreign.item.title = '推荐商品';
  const good = taobao();
  assert.equal(api.normalizeTaobao(context(taobaoUrl, [{ data: foreign }, { data: good }])).title, '收纳盒');
  const wrong = pdd(); wrong.goodsID = '11111111'; wrong.goodsName = '推荐商品';
  assert.equal(api.normalizePdd(context('https://pifa.pinduoduo.com/goods/detail?goods_id=87654321', [{ goods: wrong }, { goods: pdd() }])).title, '双色收纳盒');
  assert.equal(api.normalizePdd(context('https://pifa.pinduoduo.com/goods/detail?goods_id=87654321', [{ goods: wrong }])), null);
  assert.equal(api.normalizeTaobao(context(taobaoUrl, [{ data: foreign }])), null);
});

test('the source-state parser reads bounded JSONP, assigned JSON and nested JSON strings without execution', () => {
  const { api } = load();
  const tb = taobao(); tb.item.title = '含括号 } 和转义 " 标题';
  const fromJsonp = api.normalizeTaobao({ ...context(taobaoUrl, []), scriptTexts: [`callback(${JSON.stringify({ data: tb })});`] });
  assert.equal(fromJsonp.title, tb.item.title);
  assert.equal(fromJsonp.captureV2.skus[0].rowEvidence.sourceType, 'script');
  const fromAssignment = api.normalizePdd({ ...context('https://mobile.yangkeduo.com/goods.html?goods_id=87654321', []),
    scriptTexts: [`window.rawData = ${JSON.stringify({ goods: pdd() })}; window.shouldNeverRun = true;`] });
  assert.equal(fromAssignment.title, '双色收纳盒');
  assert.equal(globalThis.shouldNeverRun, undefined);
  const nested = api.normalizeTaobao(context(taobaoUrl, [{ data: { apiStack: [{ value: JSON.stringify({ data: tb }) }] } }]));
  assert.equal(nested.captureV2.skus.length, 2);
});

test('observed main-world and network payloads retain their actual evidence type', () => {
  const { api } = load();
  const raw = api.normalizeTaobao({ ...context(taobaoUrl, []), pageState: { knownGlobals: { __INITIAL_STATE__: { data: taobao() } } } });
  assert.equal(raw.captureV2.skus[0].rowEvidence.sourceType, 'main_world');
  const network = api.normalizePdd({ ...context('https://mobile.yangkeduo.com/goods.html?goods_id=87654321', []),
    capturedData: [{ payload: { goods: pdd() }, sourceType: 'network' }] });
  assert.equal(network.captureV2.skus[0].rowEvidence.sourceType, 'network');
  assert.equal(network.captureV2.fieldEvidence.title.sourceType, 'network');
});

test('missing or invalid stock/prices never become 999, free or fallback SKU inventory', () => {
  const { api } = load();
  const goods = pdd(); delete goods.goodsSkuList[0].stock; goods.goodsSkuList[1].quantity = '5+';
  delete goods.goodsSkuList[0].group_price; goods.goodsSkuList[1].groupPrice = -1000;
  const result = api.normalizePdd(context('https://mobile.yangkeduo.com/goods.html?goods_id=87654321', [{ goods }]));
  assert.deepEqual(plain(result.captureV2.skus.map(row => [row.stock, row.priceCny])), [[null, null], [null, null]]);
  assert.equal(result.captureV2.skus.length, 2, 'missing price does not erase the observed row');
});

test('same-spec identical-price PDD rows with different real SKU IDs are not deduplicated', () => {
  const { api } = load();
  const goods = pdd(); goods.goodsSkuList[1] = { ...goods.goodsSkuList[0], sku_id: '20002' };
  const result = api.normalizePdd(context('https://mobile.yangkeduo.com/goods.html?goods_id=87654321', [{ goods }]));
  assert.deepEqual(plain(result.captureV2.skus.map(row => row.sourceSkuId)), ['20001', '20002']);
});

test('missing ID stays null, source sku IDs are not generated and no unknown spec facts are invented', () => {
  const { api } = load();
  const goods = pdd(); goods.goodsSkuList = [{ group_price: 999, stock: 0 }];
  const result = api.normalizePdd(context('https://mobile.yangkeduo.com/goods.html?goods_id=87654321', [{ goods }]));
  assert.equal(result.captureV2.skus[0].sourceSkuId, null);
  assert.equal(result.captureV2.skus[0].specText, null);
  assert.equal(result.captureV2.skus[0].attributes.length, 0);
});

test('rejects non-product, deceptive-host and unsafe source URLs rather than trusting payload IDs', () => {
  const { api } = load();
  for (const url of ['https://item.taobao.com.evil.test/item.htm?id=12345678', 'https://item.taobao.com/login?id=12345678',
    'http://item.taobao.com/item.htm?id=12345678', 'https://user:pass@item.taobao.com/item.htm?id=12345678']) {
    assert.throws(() => api.normalizeTaobao(context(url, [{ data: taobao() }])));
  }
  assert.throws(() => api.normalizePdd(context('https://mobile.yangkeduo.com.evil.test/goods.html?goods_id=87654321', [{ goods: pdd() }])));
});

test('media preserves valid formats and ignores credentials, scripts, private hosts and decorative images', () => {
  const { api } = load();
  const goods = pdd(); goods.topGallery.push(...['javascript:alert(1)', 'https://key:secret@cdn.test/image.jpg', 'http://cdn.test/image.jpg',
    'https://127.0.0.1/image.jpg', 'https://cdn.test/avatar.jpg', 'https://cdn.test/qrcode.png', '//img.pddpic.com/preserved.webp'].map(url => ({ url })));
  const result = api.normalizePdd(context('https://mobile.yangkeduo.com/goods.html?goods_id=87654321', [{ goods }]));
  assert.deepEqual(plain(result.sourceMainImages), ['https://img.pddpic.com/main.webp', 'https://img.pddpic.com/preserved.webp']);
});

test('bounded search ignores getters, cycles, overdeep objects and oversized script text', () => {
  const { api } = load(); let touched = false;
  const data = { goods: pdd() }; Object.defineProperty(data, 'credential', { enumerable: true, get() { touched = true; throw Error('Never invoke getters'); } });
  data.circular = data;
  const result = api.normalizePdd(context('https://mobile.yangkeduo.com/goods.html?goods_id=87654321', [data]));
  assert.equal(result.title, '双色收纳盒'); assert.equal(touched, false);
  const source = { goods: pdd() }; let deep = source; for (let i = 0; i < 20; i++) deep = { nested: deep };
  assert.equal(api.normalizePdd(context('https://mobile.yangkeduo.com/goods.html?goods_id=87654321', [deep])), null);
  assert.equal(api.normalizeTaobao({ ...context(taobaoUrl, []), scriptTexts: [' '.repeat(2 * 1024 * 1024) + JSON.stringify({ data: taobao() })] }), null);
  assert.ok(!JSON.stringify(result).includes('credential'));
});

test('Tmall remains its own native capture platform and collector namespace', async () => {
  const { api, contract } = load();
  const result = api.normalizeTaobao(context('https://detail.tmall.com/item.htm?id=12345678', [{ data: taobao() }]));
  assert.equal(result.platform, 'tmall'); assert.equal(result.captureV2.platform, 'tmall');
  assert.equal(result.captureV2.collector.name, 'ss-erp-donor-tmall');
  const submission = await contract.createSourceProductCaptureV2Submission(result.captureV2);
  assert.equal(contract.validateSourceProductCaptureV2Submission(submission).valid, true);
});

test('actual marketplace/PDD entrypoints consume native donor data while unsupported old Taobao structures retain fallback', () => {
  const c = { URL, TextEncoder, TextDecoder, crypto: webcrypto };
  for (const file of ['contracts/source-product-capture-v2.js', 'collectors/source-product-core.js', 'collectors/donor-marketplace-normalizer.js', 'collectors/marketplace-product.js', 'collectors/pdd-product.js']) {
    vm.runInNewContext(readFileSync('extensions/ss-erp/shared/' + file, 'utf8'), c, { filename: file });
  }
  assert.equal(c.SS_ERP_MARKETPLACE_PRODUCT_COLLECTOR.extractTaobaoProduct(context(taobaoUrl, [{ data: taobao() }])).captureV2.provenanceMode, 'native_v2');
  assert.equal(c.SS_ERP_PDD_PRODUCT_COLLECTOR.extractPddProduct(context('https://mobile.yangkeduo.com/goods.html?goods_id=87654321', [{ goods: pdd() }])).captureV2.provenanceMode, 'native_v2');
  const old = taobao(); delete old.skuBase.skus;
  const result = c.SS_ERP_MARKETPLACE_PRODUCT_COLLECTOR.extractTaobaoProduct(context(taobaoUrl, [{ data: old }]));
  assert.equal(result.captureV2, undefined);
  assert.equal(result.productId, '12345678');
});

test('final collector fallback rejects foreign recommendations instead of assigning their data to the current URL', () => {
  const c = { URL, TextEncoder, TextDecoder, crypto: webcrypto };
  for (const file of ['contracts/source-product-capture-v2.js', 'collectors/source-product-core.js', 'collectors/donor-marketplace-normalizer.js', 'collectors/marketplace-product.js', 'collectors/pdd-product.js']) {
    vm.runInNewContext(readFileSync('extensions/ss-erp/shared/' + file, 'utf8'), c);
  }
  const tb = taobao(); tb.item.itemId = '99999999';
  assert.throws(() => c.SS_ERP_MARKETPLACE_PRODUCT_COLLECTOR.extractTaobaoProduct(context(taobaoUrl, [{ data: tb }])), /商品|变化|不匹配/);
  const goods = pdd(); goods.goodsID = '99999999';
  assert.throws(() => c.SS_ERP_PDD_PRODUCT_COLLECTOR.extractPddProduct(context('https://mobile.yangkeduo.com/goods.html?goods_id=87654321', [{ goods }])), /商品|变化|不匹配/);
});

test('package kg is converted to grams and ordinary product weight is not invented as packaged weight', () => {
  const { api } = load();
  const goods = pdd(); goods.goodsProperty = [{ name: '包装重量', value: '0.65kg' }];
  const result = api.normalizePdd(context('https://mobile.yangkeduo.com/goods.html?goods_id=87654321', [{ goods }]));
  assert.equal(result.captureV2.facts.packageWeightG, 650);
  goods.goodsProperty = [{ name: '净重', value: '600g' }, { name: '重量', value: '600g' }];
  assert.equal(api.normalizePdd(context('https://mobile.yangkeduo.com/goods.html?goods_id=87654321', [{ goods }])).captureV2.facts.packageWeightG, null);
});

test('native source keeps explicit yuan prices at 1000+ and cent prices below 1000 without magnitude guessing', () => {
  const { api } = load();
  const goods = pdd(); goods.goodsSkuList = [{ skuId: 'low-cent', groupPrice: 99, stock: 0 }, { skuId: 'yuan', priceText: '1200', stock: 2 }];
  const result = api.normalizePdd(context('https://mobile.yangkeduo.com/goods.html?goods_id=87654321', [{ goods }]));
  assert.deepEqual(plain(result.captureV2.skus.map(item => item.priceCny)), [0.99, 1200]);
  const tb = taobao(); tb.skuCore.sku2info['10001'].price = { priceText: '1200' };
  assert.equal(api.normalizeTaobao(context(taobaoUrl, [{ data: tb }])).captureV2.skus[0].priceCny, 1200);
});

test('matched main-world payload retains its provenance when unrelated network data is also present', () => {
  const { api } = load();
  const tb = taobao(); const foreign = taobao(); foreign.item.itemId = '99999999';
  const result = api.normalizeTaobao({ ...context(taobaoUrl, [{ data: tb }]), capturedData: [{ payload: { data: foreign } }] });
  assert.equal(result.captureV2.fieldEvidence.title.sourceType, 'main_world');
  assert.equal(result.captureV2.skus[0].rowEvidence.sourceType, 'main_world');
});

test('direct observed payload getters cannot execute while extracting sale specs or SKU images', () => {
  const { api } = load(); let touched = false;
  const goods = pdd();
  Object.defineProperty(goods.goodsSkuList[0], 'specs', { enumerable: true, get() { touched = true; throw Error('Getter must not run'); } });
  const result = api.normalizePdd(context('https://mobile.yangkeduo.com/goods.html?goods_id=87654321', [{ goods }]));
  assert.equal(touched, false);
  assert.equal(result.captureV2.skus[0].sourceSkuId, '20001');
});

test('script roots enforce one combined byte budget rather than parsing sixty independent multi-MiB scripts', () => {
  const { api } = load();
  const irrelevant = JSON.stringify({ padding: 'x'.repeat(2 * 1024 * 1024 - 40) });
  const result = api.normalizeTaobao({ ...context(taobaoUrl, []), scriptTexts: [...Array(5).fill(irrelevant), JSON.stringify({ data: taobao() })] });
  assert.equal(result, null, 'no hidden parse beyond the combined eight-MiB source budget');
});
