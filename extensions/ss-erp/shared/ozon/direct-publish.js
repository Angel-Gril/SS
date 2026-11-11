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
// Ozon 的上架端点是 /v3，不是 /v1。/v1/product/import 会返回 404 page not found
// （实测踩过）。状态查询才是 /v1。
const PRODUCT_IMPORT_PATH = '/v3/product/import';
const IMPORT_STATUS_PATH = '/v1/product/import/info';
const PRODUCT_INFO_PATH = '/v3/product/info/list';
const PRODUCT_ATTRIBUTES_PATH = '/v4/product/info/attributes';

// 2026-11 实测：20 秒常常不够。pictures/import 提交后 Ozon 会先生成 CDN 副本\n// （/v3/product/info/list 的 primary_image 立刻有值），但 images 数组要更久才填。\n// 用 20 秒时多次出现 images:0 且零错误的「成功但无图」商品（product 6919447399）。\nconst PICTURE_SETTLE_MS = 40000;
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

  // 2026-11 实测：Ozon 的尺寸是**顶层平铺**字段，不能嵌套在 dimensions 里。
  // 嵌套写法不会报错，但 Ozon 会回 missing_dimension(width/height/depth)，
  // 商品仍然建出来，只是尺寸为空 —— 这个坑实测踩过（productId 6917728895）。
  // 参考 shared/ozon/ozon-upload-adapter.js 的同一处结论。
  const dimensionUnit = String(input.dimensionUnit || 'mm').slice(0, 4);
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
    height,
    depth,
    width,
    dimension_unit: dimensionUnit,
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
  // 2026-11 实测：Ozon 这个类目的导入常常超过 300 秒甚至 600 秒。
  // 之前返回 'timeout' 会被上层当成失败，而商品其实已经建好了 —— 用户据此
  // 重新提交就会产生重复商品。这里再查一次，仍无结论时返回 'processing'
  // （「还在处理」，不是错误）。
  try {
    const last = await ozon().ozonPost(IMPORT_STATUS_PATH, { task_id: Number(taskId) });
    const lastStatus = String((last && last.result && last.result.status) || '').toLowerCase();
    if (['imported', 'failed', 'partial_success'].includes(lastStatus)) {
      history.push({ attempt: 'final', status: lastStatus });
      return { status: lastStatus, result: last.result, history };
    }
    history.push({ attempt: 'final', status: lastStatus || 'unknown' });
  } catch (_error) {
    history.push({ attempt: 'final', error: String((_error && _error.message) || _error).slice(0, 160) });
  }
  return { status: 'processing', result: null, history };
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

  // 2026-11：导入成功但 images 为空的补救。
  // 实测 product 6919447399 status=imported、errors=[] 但 images:0，
  // 重新 importPictures 一次再等 25 秒，images 才变成 1。
  // 这条补救让「成功但无图」不再需要人工发现。
  try {
    if (waited.status === 'imported' || waited.status === 'partial_success') {
      const snapshot = await verifyProduct(offerId);
      if (snapshot && snapshot.found && Number(snapshot.images) === 0) {
        mark('pictures_missing', { productId: snapshot.productId });
        await importPictures(offerId, item.images);
        mark('pictures_retried');
        await new Promise((r) => setTimeout(r, 25000));
        const after = await verifyProduct(offerId);
        mark('pictures_recheck', { images: after && after.images });
      }
    }
  } catch (_error) {
    mark('pictures_retry_failed');
  }

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

  // processing 不是失败：导入已受理，Ozon 还在处理。调用方应提示「稍后复查」
  // 而不是让用户重新提交（那会产生重复商品）。
  const accepted = waited.status === 'imported' || waited.status === 'partial_success';
  const processing = waited.status === 'processing';
  return {
    ok: accepted,
    processing,
    offerId,
    taskId,
    status: waited.status,
    recheckHint: processing
      ? 'Ozon 已受理导入，仍在处理。请稍后用 /v1/product/import/info 以 task_id 复查，不要重复提交。'
      : null,
    item,
    errors,
    raw: waited.result,
    timeline,
  };
}

/**
 * 批量上架：一次 import 提交多条 item（多变体必须这样发，单独发会被判成不同商品）。
 *
 * 与 publishProduct 的差别：
 *   - 图片只提交一次（所有 offer 一起），只等一次 settle
 *   - 一次 /v3/product/import 带上全部 items，拿一个 task_id
 *   - 导入成功后按 offer_id 分别 verify，并把 model_id / 变体数带回来
 *
 * @returns { ok, taskId, status, items:[{offerId, productId, sku, modelId, variantCount, errors, images}], errors, timeline }
 */
async function publishProducts(inputs, options = {}) {
  const timeline = [];
  const mark = (step, extra) => timeline.push({ step, at: Date.now(), ...(extra || {}) });
  const list = (Array.isArray(inputs) ? inputs : []).map((input) => buildItem(input));
  if (!list.length) throw new Error('没有可上架的 item');
  const offers = list.map((item) => item.offer_id);
  mark('validated', { count: list.length, offers });

  // 1. 图片：一次提交所有 offer
  await importPicturesBatch(list.map((item) => ({ offerId: item.offer_id, imageUrls: item.images })));
  mark('pictures_submitted', { count: list.length });
  const settleMs = Number(options.pictureSettleMs) >= 0 ? Number(options.pictureSettleMs) : PICTURE_SETTLE_MS;
  if (settleMs) await new Promise((r) => setTimeout(r, settleMs));
  mark('pictures_settled', { waitedMs: settleMs });

  // 2. 一次导入
  const imported = await ozon().ozonPost(PRODUCT_IMPORT_PATH, { items: list });
  const taskId = imported && imported.result && imported.result.task_id;
  if (!taskId) {
    throw Object.assign(new Error(`Ozon 未返回 task_id：${JSON.stringify(imported).slice(0, 300)}`), {
      phase: 'import', timeline,
    });
  }
  mark('import_submitted', { taskId });

  // 3. 轮询
  const waited = await waitImport(taskId, {
    max: options.maxPolls, intervalMs: options.pollIntervalMs, onTick: options.onTick,
  });
  mark('import_finished', { status: waited.status });

  const rawItems = (waited.result && Array.isArray(waited.result.items)) ? waited.result.items : [];
  const byOffer = new Map(rawItems.map((one) => [String(one && one.offer_id || ''), one]));

  // 4. 逐条验证（补图 + model_info）
  const items = [];
  for (const item of list) {
    const one = byOffer.get(item.offer_id) || {};
    const errors = (Array.isArray(one.errors) ? one.errors : []).map((e) => ({
      code: String((e && e.code) || '').slice(0, 80),
      message: String((e && e.message) || '').slice(0, 300),
      field: String((e && e.field) || '').slice(0, 80),
    }));
    let snapshot = { found: false };
    try { snapshot = await verifyProduct(item.offer_id); } catch (_e) { /* 保留 found:false */ }
    if (snapshot.found && Number(snapshot.images) === 0) {
      try {
        await importPicturesBatch([{ offerId: item.offer_id, imageUrls: item.images }]);
        await new Promise((r) => setTimeout(r, 25000));
        snapshot = await verifyProduct(item.offer_id);
        mark('pictures_retried', { offerId: item.offer_id });
      } catch (_e) { mark('pictures_retry_failed', { offerId: item.offer_id }); }
    }

    // 5. 属性复查 + 只补发空的那条（import 对同 offer 幂等，实测重发即可修复）
    let attributeState = { found: false, filled: 0, total: 0 };
    try { attributeState = await verifyAttributes(item.offer_id); } catch (_e) { /* 忽略 */ }
    if (attributeState.found && attributeState.filled === 0) {
      try {
        await ozon().ozonPost(PRODUCT_IMPORT_PATH, { items: [item] });
        await new Promise((r) => setTimeout(r, 25000));
        const after = await verifyAttributes(item.offer_id);
        mark('attributes_repaired', { offerId: item.offer_id, before: 0, after: after.filled });
        attributeState = after;
        try { snapshot = await verifyProduct(item.offer_id); } catch (_e) { /* 保留旧快照 */ }
      } catch (_e) {
        mark('attributes_repair_failed', { offerId: item.offer_id });
      }
    }
    items.push({
      offerId: item.offer_id,
      productId: one.product_id || snapshot.productId || null,
      sku: snapshot.sku || null,
      modelId: snapshot.modelId || null,
      variantCount: snapshot.variantCount || null,
      images: snapshot.images != null ? snapshot.images : 0,
      attributesFilled: attributeState.filled || 0,
      attributesTotal: attributeState.total || 0,
      status: snapshot.status || null,
      errors,
    });
  }

  const accepted = waited.status === 'imported' || waited.status === 'partial_success';
  const processing = waited.status === 'processing';
  return {
    ok: accepted,
    processing,
    taskId,
    status: waited.status,
    items,
    errors: items.flatMap((one) => one.errors.map((e) => ({ offerId: one.offerId, ...e }))),
    recheckHint: processing
      ? 'Ozon 已受理导入，仍在处理。请稍后用 /v1/product/import/info 以 task_id 复查，不要重复提交。'
      : null,
    timeline,
  };
}

/** 多条 item 一次性挂图 */
async function importPicturesBatch(entries) {
  const items = (Array.isArray(entries) ? entries : []).map((entry) => ({
    offer_id: String(entry.offerId),
    images: (Array.isArray(entry.imageUrls) ? entry.imageUrls : []).filter((u) => /^https:\/\//.test(String(u))).slice(0, 15),
  })).filter((entry) => entry.images.length);
  if (!items.length) throw new Error('没有可用的 https 图片地址');
  const response = await ozon().ozonPost(PICTURE_IMPORT_PATH, { items });
  return { taskId: response && response.task_id, count: items.length };
}

/** 验证商品是否真的创建了 */
/**
 * 属性落地情况：Ozon 偶尔会把某条 offer 的属性存成「有字段、无值」（实测 T5-S），
 * 表现为字段存在但 values 为空 —— 这时 model 建不出来，商品不进销售。
 * 返回 filled = 有值的属性个数，调用方据此决定是否补发。
 */
async function verifyAttributes(offerId) {
  try {
    const response = await ozon().ozonPost(PRODUCT_ATTRIBUTES_PATH, {
      filter: { offer_id: [String(offerId)], visibility: 'ALL' },
      limit: 1,
    });
    const rows = (response && Array.isArray(response.result)) ? response.result : [];
    const first = rows[0];
    if (!first) return { found: false, filled: 0, total: 0 };
    const list = Array.isArray(first.attributes) ? first.attributes : [];
    const filled = list.filter((attribute) => Array.isArray(attribute.values) && attribute.values.length > 0).length;
    return { found: true, filled, total: list.length };
  } catch (error) {
    return { found: false, filled: 0, total: 0, error: String((error && error.message) || error).slice(0, 200) };
  }
}

async function verifyProduct(offerId) {  try {
    const response = await ozon().ozonPost(PRODUCT_INFO_PATH, { offer_id: [String(offerId)] });
    const items = (response && Array.isArray(response.items)) ? response.items : [];
    const found = items[0];
    if (!found) return { found: false };
    return {
      found: true,
      productId: found.id || null,
      offerId: found.offer_id || offerId,
      sku: found.sku || null,
      // 2026-11：多变体合并的证据在这里 —— 同一 model_id 下的变体共用一个卡片
      modelId: (found.model_info && found.model_info.model_id) || null,
      variantCount: (found.model_info && found.model_info.count) || null,
      name: String(found.name || '').slice(0, 200),
      price: found.price || null,
      images: Array.isArray(found.images) ? found.images.length : 0,
      primaryImage: found.primary_image ? String(found.primary_image).slice(-60) : '',
      status: (found.statuses && found.statuses.status_name) || found.status || null,
      visibility: found.visibility_details || null,
    };
  } catch (error) {
    return { found: false, error: String((error && error.message) || error).slice(0, 240) };
  }
}

globalThis.SSERP_DIRECT_PUBLISH = Object.freeze({
  buildItem,
  importPictures,
  importPicturesBatch,
  publishProduct,
  publishProducts,
  waitImport,
  verifyProduct,
  verifyAttributes,
  PATHS: Object.freeze({
    PICTURE_IMPORT_PATH, PRODUCT_IMPORT_PATH, IMPORT_STATUS_PATH, PRODUCT_INFO_PATH,
  }),
});
