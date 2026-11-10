import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildDirectListingSyncPayload,
  buildDirectWorkspace,
  createDirectCategoryStore,
} from '../extensions/ss-erp/shared/publish/direct-workspace.js';

function memoryStorage() {
  const data = new Map();
  return {
    async get(key) { return data.has(key) ? { [key]: data.get(key) } : {}; },
    async set(value) { for (const [key, entry] of Object.entries(value)) data.set(key, structuredClone(entry)); },
  };
}

test('remembers the chosen category per source product and rejects invalid ids', async () => {
  const storage = memoryStorage();
  const store = createDirectCategoryStore({ storage, sourceKey: '1688:715' });
  assert.equal(await store.load(), null);
  await store.save({ categoryId: 17028922, typeId: 93080, typeName: '连衣裙' });
  assert.deepEqual(await store.load(), { categoryId: 17028922, typeId: 93080, typeName: '连衣裙' });
  assert.equal(await createDirectCategoryStore({ storage, sourceKey: '1688:999' }).load(), null);
  await assert.rejects(() => store.save({ categoryId: 0, typeId: 93080 }), /类目/u);
});

test('builds the attribute workspace straight from Ozon, without an ERP draft', async () => {
  const calls = [];
  const send = async (type, payload) => {
    calls.push({ type, payload });
    if (type === 'ss-erp:direct-ozon-attributes') {
      return { fields: [
        { attributeId: 9048, name: 'Название модели', required: true, dictionaryId: 0, valuePolicy: 'FREE_TEXT', editorMode: 'TEXT', ownership: 'SKU' },
        { attributeId: 4389, name: 'Страна-изготовитель', required: false, dictionaryId: 1935, valuePolicy: 'STRICT_DICTIONARY', editorMode: 'DROPDOWN', ownership: 'SKU' },
      ] };
    }
    if (type === 'ss-erp:direct-ozon-attribute-values') {
      return { values: [{ id: 90296, value: 'Китай' }], hasNext: false };
    }
    throw new Error('unexpected ' + type);
  };

  const workspace = await buildDirectWorkspace({
    category: { categoryId: 17028922, typeId: 93080 },
    product: { title: '夏季连衣裙', sourceProductId: '715234567890', skus: [{ key: 'sku-a', label: '粉色 / M' }] },
    send,
  });

  assert.equal(workspace.source, 'OZON_DIRECT');
  assert.equal(workspace.fields.length, 2);
  assert.deepEqual(calls[0], { type: 'ss-erp:direct-ozon-attributes', payload: { categoryId: 17028922, typeId: 93080 } });
  // 型号名称用稳定的来源货号（同款合并依赖它），字典字段带官方 id
  const model = workspace.values.find(row => row.attributeId === 9048);
  assert.equal(model.value, '715234567890');
  const country = workspace.values.find(row => row.attributeId === 4389);
  assert.deepEqual(country.dictionaryValueIds, [90296]);
  assert.ok(calls.some(call => call.type === 'ss-erp:direct-ozon-attribute-values'
    && call.payload.categoryId === 17028922 && call.payload.typeId === 93080 && call.payload.attributeId === 4389));
});

test('refuses to build a workspace without a category', async () => {
  await assert.rejects(() => buildDirectWorkspace({ category: null, product: {}, send: async () => ({}) }), /先选择 Ozon 类目/u);
});

test('builds the ERP sync payload from the publish result and drops what ERP would reject', () => {
  const payload = buildDirectListingSyncPayload({
    source: { platform: '1688', sourceProductId: '715234567890', canonicalUrl: 'https://detail.1688.com/offer/715234567890.html' },
    shopId: 'shop-1',
    category: { categoryId: 17028922, typeId: 93080 },
    items: [
      { offerId: '715234567890-M', skuKey: 'sku-a', name: 'Платье миди', price: '2999.00', oldPrice: '4499.00', currency: 'CNY',
        images: ['https://cdn.example.test/a.png', 'http://insecure.example.test/b.png'] },
      { offerId: '715234567890-L', skuKey: 'sku-b', name: 'Платье миди', price: '2999.00', oldPrice: null, currency: 'CNY', images: [] },
    ],
    result: { status: 'imported', items: [
      { offerId: '715234567890-M', productId: 6919447399, status: 'imported' },
      { offerId: '715234567890-L', productId: null, status: null },
    ] },
  });

  assert.equal(payload.sourcePlatform, '1688');
  assert.equal(payload.title, 'Платье миди');
  assert.equal(payload.shopId, 'shop-1');
  assert.equal(payload.categoryId, 17028922);
  assert.deepEqual(payload.items[0], {
    offerId: '715234567890-M', skuKey: 'sku-a', productId: '6919447399', price: '2999.00', oldPrice: '4499.00',
    currency: 'CNY', status: 'imported', images: ['https://cdn.example.test/a.png'],
  });
  assert.deepEqual(payload.items[1], {
    offerId: '715234567890-L', skuKey: 'sku-b', price: '2999.00', currency: 'CNY', status: 'imported', images: [],
  });
});

test('returns no sync payload when the source or the items are missing', () => {
  assert.equal(buildDirectListingSyncPayload({ source: { platform: '1688', sourceProductId: '' }, items: [{ offerId: 'a' }], result: {} }), null);
  assert.equal(buildDirectListingSyncPayload({ source: { platform: '1688', sourceProductId: '1' }, items: [], result: {} }), null);
});
