// 上架的单步执行器（在 service worker 里跑，每次只做一件事）
//
// 为什么要拆开：MV3 的 service worker 有生命周期限制，长时间持有一次消息容易在
// 中间的空档被回收 —— 端口一关，面板那边就永远等不到回调，表现为「点了没反应、
// 也不报错」。把流程拆成毫秒级单步，由面板逐步驱动，既不会被回收，也能显示进度。
//
// 步骤：pictures → import → poll(多次) → products(多次) → price → stock → verify
// 调用方：pages/donor/direct-lane-panel.js

const PICTURE_IMPORT_PATH = '/v2/product/pictures/import';
const PRODUCT_IMPORT_PATH = '/v3/product/import';
const IMPORT_STATUS_PATH = '/v1/product/import/info';
const PRODUCT_INFO_PATH = '/v3/product/info/list';
const PRODUCT_ATTRIBUTES_PATH = '/v4/product/info/attributes';

function ozon() {
  const client = globalThis.SSERP_DIRECT_OZON;
  if (!client || typeof client.ozonPost !== 'function') throw new Error('Ozon 直连客户端未加载');
  return client;
}

const asArray = (value) => (Array.isArray(value) ? value : []);

async function run(payload) {
  const input = payload || {};
  const action = String(input.action || '');
  const offers = asArray(input.offers).map(String);
  switch (action) {
    case 'pictures': {
      const entries = asArray(input.entries).map((one) => ({
        offerId: String((one && one.offerId) || ''),
        imageUrls: asArray(one && one.imageUrls).filter((url) => /^https:\/\//.test(String(url))),
      })).filter((one) => one.offerId && one.imageUrls.length);
      if (!entries.length) throw new Error('没有可提交的图片');
      const response = await ozon().ozonPost(PICTURE_IMPORT_PATH, {
        items: entries.map((one) => ({ offer_id: one.offerId, images: one.imageUrls })),
      });
      return { action, taskId: (response && response.task_id) || null, count: entries.length };
    }
    case 'import': {
      const items = asArray(input.items);
      if (!items.length) throw new Error('没有可导入的 item');
      const response = await ozon().ozonPost(PRODUCT_IMPORT_PATH, { items });
      return { action, taskId: (response && response.result && response.result.task_id) || null, count: items.length };
    }
    case 'poll': {
      const taskId = Number(input.taskId) || 0;
      if (!taskId) throw new Error('缺少 taskId');
      const response = await ozon().ozonPost(IMPORT_STATUS_PATH, { task_id: taskId });
      const rows = asArray(response && response.result && response.result.items);
      const statuses = rows.map((row) => String((row && row.status) || ''));
      const done = rows.length > 0 && statuses.every((status) => ['imported', 'failed', 'partial_success'].includes(status));
      return {
        action, taskId, done,
        items: rows.map((row) => ({
          offerId: String((row && row.offer_id) || ''),
          status: String((row && row.status) || ''),
          errors: asArray(row && row.errors).map((e) => String((e && e.code) || '')).filter(Boolean),
        })),
      };
    }
    case 'products': {
      if (!offers.length) throw new Error('缺少 offers');
      const response = await ozon().ozonPost(PRODUCT_INFO_PATH, { offer_id: offers });
      const rows = asArray((response && (response.items || (response.result && response.result.items))));
      const ready = rows.filter((row) => Number(row && row.id) > 0).map((row) => String(row.offer_id));
      return {
        action,
        ready,
        pending: offers.filter((offer) => !ready.includes(offer)),
        rows: rows.map((row) => ({
          offerId: String(row.offer_id || ''),
          productId: Number(row.id) || 0,
          status: String((row.statuses && row.statuses.status_name) || ''),
          modelCount: Number((row.model_info && row.model_info.count) || 0),
          images: asArray(row.images).length,
        })),
      };
    }
    case 'price': {
      if (!offers.length) throw new Error('缺少 offers');
      const price = String(input.price || '');
      const oldPrice = String(input.oldPrice || '');
      const response = await ozon().ozonPost('/v1/product/import/prices', {
        prices: offers.map((offer_id) => ({
          offer_id, price, old_price: oldPrice, currency_code: String(input.currency || 'CNY'), vat: String(input.vat || '0'),
        })),
      });
      const rows = asArray(response && response.result);
      return {
        action,
        ok: rows.filter((row) => row && row.updated).map((row) => String(row.offer_id)),
        failed: rows.filter((row) => row && !row.updated).map((row) => ({
          offerId: String(row.offer_id || ''),
          codes: asArray(row.errors).map((e) => String((e && e.code) || '')).filter(Boolean),
        })),
      };
    }
    case 'stock': {
      if (!offers.length) throw new Error('缺少 offers');
      const response = await ozon().ozonPost('/v2/products/stocks', {
        stocks: offers.map((offer_id) => ({
          offer_id, stock: Number(input.stock) || 0, warehouse_id: Number(input.warehouseId) || 0,
        })),
      });
      const rows = asArray(response && response.result);
      return {
        action,
        ok: rows.filter((row) => row && row.updated).map((row) => String(row.offer_id)),
        failed: rows.filter((row) => row && !row.updated).map((row) => ({
          offerId: String(row.offer_id || ''),
          codes: asArray(row.errors).map((e) => String((e && e.code) || '')).filter(Boolean),
        })),
      };
    }
    case 'verify': {
      if (!offers.length) throw new Error('缺少 offers');
      const out = [];
      for (const offer of offers) {
        const info = await ozon().ozonPost(PRODUCT_INFO_PATH, { offer_id: [offer] }).catch(() => null);
        const row = asArray(info && (info.items || (info.result && info.result.items)))[0] || {};
        const attrs = await ozon().ozonPost(PRODUCT_ATTRIBUTES_PATH, {
          filter: { offer_id: [offer], visibility: 'ALL' }, limit: 1,
        }).catch(() => null);
        const attrRow = asArray(attrs && attrs.result)[0] || {};
        const filled = asArray(attrRow.attributes).filter((a) => asArray(a && a.values)
          .some((v) => String((v && v.value) || '').trim() || Number(v && v.dictionary_value_id) > 0)).length;
        out.push({
          offerId: offer,
          status: String((row.statuses && row.statuses.status_name) || ''),
          modelCount: Number((row.model_info && row.model_info.count) || 0),
          images: asArray(row.images).length,
          attributesFilled: filled,
        });
      }
      return { action, items: out };
    }
    default:
      throw new Error('未知的单步动作：' + action);
  }
}

globalThis.SSERP_DIRECT_PUBLISH_STEPS = Object.freeze({ run });
