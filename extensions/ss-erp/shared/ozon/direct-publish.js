// Ozon 直连上架（在 service worker 里跑）
//
// 照抄 tools/real-listing.mjs 的实测流程（那条链之前真的把商品创建出来了）：
//   1. /v2/product/pictures/import   把图片挂到 offer_id 上，拿 task_id
//   2. 等图片处理（实测 20 秒够）
//   3. /v1/product/import            提交完整 item，拿 task_id
//   4. 轮询 /v1/product/import/info  每 5 秒，status ∈ imported|failed|partial_success
//   5. /v3/product/info/list        验证商品真的建出来了
//
// 与 ERP 路径的区别：不经过 operation 状态机，失败就是失败，能立刻看到
// Ozon 返回的 result.errors，不会留一个「未确认」的影子让用户去点 recover。

const PICTURE_IMPORT_PATH = '/v2/product/pictures/import';
const PRODUCT_IMPORT_PATH = '/v1/product/import';
const IMPORT_STATUS_PATH = '/v1/product/import/info';
const PRODUCT_INFO_PATH = '/v3/product/info/list';

const PICTURE_SETTLE_MS = 20000;   // 实测：图片处理需要这么久
const POLL_INTERVAL_MS = 5000;
const POLL_MAX = 24;               // 120 秒

function ozon() {
  const client = globalThis.SSERP_DIRECT_OZON;
  if (!client || typeof client.ozonPost !== 'function') {
    throw new Error('Ozon 直连客户端未加载');
  }
  return client;
}

/** 把图片挂到 offer_id 上 */
async function importPictures(offerId, imageUrls) {
  const urls = (Array.isArray(imageUrls) ? imageUrls : [])
    .filter((u) => /^https:\/\//.test(String(u)))
    .slice(0, 15);
  if (!urls.length) throw new Error('没有可用的 https 图片地址');
  const response = await ozon().ozonPost(PICTURE_IMPORT_PATH, {
    items: [{ offer_id: String(offerId), images: urls }],
  });
  return { taskId: response && response.task_id, count: urls.length };
}

/**
 * 构造 /v1/product/import 的 item。
 *
 * 字段全部来自 real-listing.mjs 的实测成功载荷。必填项：
 *   offer_id / name / description_category_id / type_id / price /
 *   currency_code / vat / weight / weight_unit / dimensions / images / attributes
 *
 * @param {object} input
 *   offerId, name, description, categoryId, typeId
 *   price, oldPrice, currency ('CNY')
 *   weight (g), dimensions {height, depth, width} (mm)
 *   images [url], primaryImage
 *   attributes [{ id, values:[{value}|{dictionary_value_id}] }]
 */
function buildItem(input) {
  const offerId = String(input.offerId || '').trim();
  if (!offerId) throw new Error('offer_id 不能为空');
  const name = String(input.name || '').trim().slice(0, 500);
  if (name.length < 3) throw new Error('商品标题太短（Ozon 要求至少 3 字符）');

  const categoryId = Number(input.categoryId);
  const typeId = Number(input.typeId);
  if (!Number.isSafeInteger(categoryId) || categoryId <= 0) throw new Error('description_category_id 无效');
  if (!Number.isSafeInteger(typeId) || typeId <= 0) throw new Error('type_id 无效');

  const price = normalizePrice(input.price);
  if (!price) throw new Error('价格无效：必须是大于 0 的数字');
  const oldPrice = normalizePrice(input.oldPrice);

  const images = (Array.isArray(input.images) ? input.images : [])
    .filter((u) => /^https:\/\//.test(String(u))).slice(0, 15);
  if (!images.length) throw new Error('至少需要一张 https 图片');

  const weight = Number(input.weight);
  if (!Number.isFinite(weight) || weight <= 0) throw new Error('重量无效（单位 g）');
  const dims = input.dimensions || {};
  const height = Number(dims.height), depth = Number(dims.depth), width = Number(dims.width);
  if (![height, depth, width].every((n) => Number.isFinite(n) && n > 0)) {
    throw new Error('包装尺寸无效（单位 mm，需 height/depth/width 都大于 0）');
  }

  const attributes = (Array.isArray(input.attributes) ? input.attributes : [])
    .map((a) => {
      const id = Number(a && a.id);
      if (!Number.isSafeInteger(id) || id <= 0) return null;
      const values = (Array.isArray(a.values) ? a.values : []).map((v) => {
        if (v && Number.isSafeInteger(Number(v.dictionary_value_id))) {
          return { dictionary_value_id: Number(v.dictionary_value_id) };
        }
        const value = String((v && (v.value ?? v)) || '').trim().slice(0, 500);
        return value ? { value } : null;
      }).filter(Boolean).slice(0, 20);
      return values.length ? { id, values } : null;
    })
    .filter(Boolean);

  const item = {
    offer_id: offerId,
    name,
    description_category_id: categoryId,
    type_id: typeId,
    price,
    currency_code: String(input.currency || 'CNY').toUpperCase().slice(0, 3),
    vat: String(input.vat == null ? '0' : input.vat).slice(0, 8),
    weight,
    weight_unit: String(input.weightUnit || 'g').slice(0, 4),
    dimensions: { height, depth, width, dimension_unit: String(input.dimensionUnit || 'mm').slice(0, 4) },
    primary_image: images[0],
    images,
    attributes,
  };
  if (oldPrice) item.old_price = oldPrice;
  const description = String(input.description || '').trim();
  if (description) item.description = description.slice(0, 6000);
  return item;
}

function normalizePrice(value) {
  if (value == null || value === '') return '';
  const n = Number(String(value).replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return '';
  return n.toFixed(2);
}

/** 轮询导入结果 */
async function waitImport(taskId, options = {}) {
  const max = Number(options.max) > 0 ? Number(options.max) : POLL_MAX;
  const interval = Number(options.intervalMs) > 0 ? Number(options.intervalMs) : POLL_INTERVAL_MS;
  const onTick = typeof options.onTick === 'function' ? options.onTick : null;
  const history = [];
  for (let i = 0; i < max; i++) {
    await new Promise((r) => setTimeout(r, interval));
    let response;
    try {
      response = await ozon().ozonPost(IMPORT_STATUS_PATH, { task_id: Number(taskId) });
    } catch (error) {
      history.push({ attempt: i + 1, error: String((error && error.message) || error).slice(0, 200) });
      if (onTick) onTick({ attempt: i + 1, status: 'poll_error' });
      continue;
    }
    const result = (response && response.result) || {};
    const status = String(result.status || '').toLowerCase();
    history.push({ attempt: i + 1, status });
    if (onTick) onTick({ attempt: i + 1, status });
    if (['imported', 'failed', 'partial_success'].includes(status)) {
      return { status, result, history };
    }
  }
  return { status: 'timeout', result: null, history };
}

/**
 * 完整上架：图片 → 导入 → 轮询 → 验证。
 *
 * @returns { ok, offerId, taskId, status, item, errors, timeline }
 */
async function publishProduct(input, options = {}) {
  const timeline = [];
  const mark = (step, extra) => timeline.push({ step, at: Date.now(), ...(extra || {}) });

  const item = buildItem(input);
  const offerId = item.offer_id;
  mark('validated', { offerId, attributes: item.attributes.length, images: item.images.length });

  // 1. 图片
  const pictures = await importPictures(offerId, item.images);
  mark('pictures_submitted', { taskId: pictures.taskId, count: pictures.count });
  const settleMs = Number(options.pictureSettleMs) >= 0 ? Number(options.pictureSettleMs) : PICTURE_SETTLE_MS;
  if (settleMs) await new Promise((r) => setTimeout(r, settleMs));
  mark('pictures_settled', { waitedMs: settleMs });

  // 2. 导入
  const imported = await ozon().ozonPost(PRODUCT_IMPORT_PATH, { items: [item] });
  const taskId = imported && imported.result && imported.result.task_id;
  if (!taskId) {
    throw Object.assign(new Error(`Ozon 未返回 task_id：${JSON.stringify(imported).slice(0, 300)}`), {
      phase: 'import', timeline,
    });
  }
  mark('import_submitted', { taskId });

  // 3. 轮询
  const waited = await waitImport(taskId, {
    max: options.maxPolls,
    intervalMs: options.pollIntervalMs,
    onTick: options.onTick,
  });
  mark('import_finished', { status: waited.status });

  const errors = [];
  const items = (waited.result && Array.isArray(waited.result.items)) ? waited.result.items : [];
  for (const one of items) {
    for (const e of (Array.isArray(one && one.errors) ? one.errors : [])) {
      errors.push({
        offerId: String((one && one.offer_id) || offerId),
        code: String((e && e.code) || '').slice(0, 80),
        message: String((e && e.message) || '').slice(0, 300),
        field: String((e && e.field) || '').slice(0, 80),
      });
    }
  }

  return {
    ok: waited.status === 'imported' || waited.status === 'partial_success',
    offerId,
    taskId,
    status: waited.status,
    item,
    errors,
    raw: waited.result,
    timeline,
  };
}

/** 验证商品是否真的创建了 */
async function verifyProduct(offerId) {
  try {
    const response = await ozon().ozonPost(PRODUCT_INFO_PATH, { offer_id: [String(offerId)] });
    const items = (response && Array.isArray(response.items)) ? response.items : [];
    const found = items[0];
    if (!found) return { found: false };
    return {
      found: true,
      productId: found.id || null,
      offerId: found.offer_id || offerId,
      name: String(found.name || '').slice(0, 200),
      price: found.price || null,
      images: Array.isArray(found.images) ? found.images.length : 0,
      status: found.status || null,
      visibility: found.visibility_details || null,
    };
  } catch (error) {
    return { found: false, error: String((error && error.message) || error).slice(0, 240) };
  }
}

globalThis.SSERP_DIRECT_PUBLISH = Object.freeze({
  buildItem,
  importPictures,
  publishProduct,
  waitImport,
  verifyProduct,
  PATHS: Object.freeze({
    PICTURE_IMPORT_PATH, PRODUCT_IMPORT_PATH, IMPORT_STATUS_PATH, PRODUCT_INFO_PATH,
  }),
});
