import assert from 'node:assert/strict';

const helper = await import('../extensions/ss-erp/shared/source-candidates/source-candidate-store.js');
const api = helper.default || helper.SS_ERP_SOURCE_CANDIDATE_STORE || globalThis.SS_ERP_SOURCE_CANDIDATE_STORE;

assert.ok(api, 'source candidate store should be exported');
assert.equal(typeof api.upsertCandidateSet, 'function', 'upsertCandidateSet should be exported');
assert.equal(typeof api.listCandidatesForOzon, 'function', 'listCandidatesForOzon should be exported');

const now = '2026-06-11T08:00:00.000Z';
const ozonProduct = {
  productId: '1628675309',
  title: 'Ozon sample product',
  url: 'https://www.ozon.ru/product/sample-1628675309/',
  images: ['https://cdn.ozon.ru/main.jpg'],
};

const sourceProduct = {
  sourcePlatform: 'pinduoduo',
  productId: '99887766',
  title: '源头工厂同款',
  sourceUrl: 'https://mobile.yangkeduo.com/goods.html?goods_id=99887766',
  price: '12.99',
  currency: 'CNY',
  images: ['https://img.pddpic.com/main.jpg'],
  shopName: '松鼠源头店',
  skuItems: [{ skuId: 'red-l', price: 13.99, stock: 8 }],
};

let sets = api.upsertCandidateSet([], ozonProduct, sourceProduct, { now });
assert.equal(sets.length, 1);
assert.equal(sets[0].key, 'ozon:product:1628675309');
assert.equal(sets[0].ozon.productId, '1628675309');
assert.equal(sets[0].ozon.title, 'Ozon sample product');
assert.equal(sets[0].candidates.length, 1);
assert.equal(sets[0].candidates[0].platform, 'pinduoduo');
assert.equal(sets[0].candidates[0].sourceProductId, '99887766');
assert.equal(sets[0].candidates[0].title, '源头工厂同款');
assert.equal(sets[0].candidates[0].price.value, 12.99);
assert.equal(sets[0].candidates[0].price.currency, 'CNY');
assert.equal(sets[0].candidates[0].shopName, '松鼠源头店');
assert.equal(sets[0].candidates[0].skuCount, 1);
assert.deepEqual(sets[0].candidates[0].images, ['https://img.pddpic.com/main.jpg']);

sets = api.upsertCandidateSet(sets, ozonProduct, {
  ...sourceProduct,
  title: '源头工厂同款-更新',
  price: '11.50',
}, { now: '2026-06-11T08:10:00.000Z' });

assert.equal(sets.length, 1);
assert.equal(sets[0].candidates.length, 1, 'same source product should update instead of duplicating');
assert.equal(sets[0].candidates[0].title, '源头工厂同款-更新');
assert.equal(sets[0].candidates[0].price.value, 11.5);
assert.equal(sets[0].candidates[0].createdAt, now);
assert.equal(sets[0].candidates[0].updatedAt, '2026-06-11T08:10:00.000Z');

const listed = api.listCandidatesForOzon(sets, '1628675309');
assert.equal(listed.length, 1);
assert.equal(listed[0].key, 'ozon:product:1628675309');

console.log('PASS source candidate store');
