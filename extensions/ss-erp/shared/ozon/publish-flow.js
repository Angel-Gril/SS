// 上架流水线的通用原语（与具体商品/类目无关）
//
// 2026-11 实测出来的 5 条规律，任何商品、任何类目都成立，所以放在共享层，
// 由面板（SW 内）和 Node 脚本共用同一份实现：
//
//   1. import 返回 imported 只是「受理」，商品创建/审核是最终一致的：
//      创建没完成前设库存会回 PRODUCT_IS_NOT_CREATED。
//      → waitForProducts()：按 offer 轮询到 id>0，再进入价格/库存阶段。
//   2. 库存接口有频控（TOO_MANY_REQUESTS），必须退避重试而不是猛敲。
//      → setStocks() 自带指数退避 + 逐条结果。
//   3. 部分变体创建失败是正常的（同一合并键也不保证原子）。
//      → retryImport() 只重发失败的那几条（import 对同 offer 幂等）。
//   4. 库存只能进「正常仓」；rets（退货仓）会回 PRODUCT_HAS_NOT_BEEN_TAGGED_YET。
//      → pickUsableWarehouse()。
//   5. 图片/价格按「变体身份」而不是按 SKU 数：同组内除变体轴外的取值相同的 offer
//      用同一套图。→ groupKeyFor() 与 groupOffers()。
//
// 这里不 import 任何浏览器 API：调用方传入 post(path, body) 即可（SW 里是
// ozonPost，Node 里是 fetch 包装）。

const RETURNS_WAREHOUSE_RE = /rets|возврат|return|возвратный/i;

/** 过滤出可以收库存的仓库：排除退货仓与未启用（status≠created）的仓 */
export function pickUsableWarehouse(warehouses) {
  const list = Array.isArray(warehouses) ? warehouses : [];
  const usable = list.filter((one) => {
    const name = String((one && one.name) || '');
    if (RETURNS_WAREHOUSE_RE.test(name)) return false;
    const status = String((one && one.status) || '').toLowerCase();
    return !status || status === 'created';
  });
  return {
    warehouse: usable[0] || null,
    usable,
    rejected: list.filter((one) => !usable.includes(one)),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 等商品真正创建出来（id>0）。Ozon 侧创建是最终一致的，import 的 imported
 * 不代表商品已存在。
 * @returns {{ ready: string[], pending: string[], rounds: number }}
 */
export async function waitForProducts({ post, offers, timeoutMs = 180000, intervalMs = 8000, onTick = null }) {
  const list = (Array.isArray(offers) ? offers : []).map(String);
  const ready = new Set();
  const startedAt = Date.now();
  let rounds = 0;
  while (Date.now() - startedAt < timeoutMs) {
    rounds += 1;
    const info = await post('/v3/product/info/list', { offer_id: list.slice() }).catch(() => null);
    const rows = (info && (info.items || (info.result && info.result.items))) || [];
    for (const row of rows) {
      if (row && Number(row.id) > 0 && row.offer_id) ready.add(String(row.offer_id));
    }
    if (onTick) onTick({ rounds, ready: ready.size, total: list.length });
    if (ready.size >= list.length) break;
    await sleep(intervalMs);
  }
  return {
    ready: list.filter((offer) => ready.has(offer)),
    pending: list.filter((offer) => !ready.has(offer)),
    rounds,
  };
}

/** 推价格；返回逐条结果，方便调用方决定重试 */
export async function setPrices({ post, offers, price, oldPrice, currency = 'CNY', vat = '0' }) {
  const list = (Array.isArray(offers) ? offers : []).map(String);
  if (!list.length) return { ok: [], failed: [] };
  const result = await post('/v1/product/import/prices', {
    prices: list.map((offer_id) => ({ offer_id, price: String(price), old_price: String(oldPrice || ''), currency_code: currency, vat })),
  }).catch(() => null);
  const rows = (result && result.result) || [];
  const ok = rows.filter((row) => row && row.updated).map((row) => String(row.offer_id));
  const failed = rows.filter((row) => row && !row.updated).map((row) => ({
    offerId: String(row.offer_id),
    codes: ((row.errors || []).map((e) => String(e && e.code))).filter(Boolean),
  }));
  return { ok, failed };
}

/**
 * 设库存，带指数退避。
 * 只对「可重试」的错误重试：PRODUCT_IS_NOT_CREATED / TOO_MANY_REQUESTS / NOT_PASS_MODERATION。
 * 其它错误（例如仓库不对）直接返回，避免掩盖真正的问题。
 */
export async function setStocks({ post, offers, stock, warehouseId, attempts = 5, baseDelayMs = 6000, onTick = null }) {
  const RETRYABLE = new Set(['PRODUCT_IS_NOT_CREATED', 'TOO_MANY_REQUESTS', 'NOT_PASS_MODERATION']);
  let pending = (Array.isArray(offers) ? offers : []).map(String);
  const ok = [];
  const failed = [];
  for (let attempt = 1; attempt <= attempts && pending.length; attempt += 1) {
    const result = await post('/v2/products/stocks', {
      stocks: pending.map((offer_id) => ({ offer_id, stock: Number(stock) || 0, warehouse_id: Number(warehouseId) })),
    }).catch(() => null);
    const rows = (result && result.result) || [];
    const next = [];
    for (const row of rows) {
      const offerId = String(row && row.offer_id);
      const codes = ((row && row.errors) || []).map((e) => String(e && e.code)).filter(Boolean);
      if (row && row.updated) ok.push(offerId);
      else if (codes.length && codes.every((code) => RETRYABLE.has(code))) next.push(offerId);
      else failed.push({ offerId, codes });
    }
    if (onTick) onTick({ attempt, pending: next.length, ok: ok.length });
    pending = next;
    if (pending.length) await sleep(baseDelayMs * attempt);
  }
  for (const offerId of pending) failed.push({ offerId, codes: ['RETRY_EXHAUSTED'] });
  return { ok, failed };
}

/** 只重发失败的那些（import 对同 offer 幂等） */
export async function retryImport({ post, items }) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return { taskId: null, submitted: 0 };
  const result = await post('/v3/product/import', { items: list }).catch(() => null);
  return { taskId: (result && result.result && result.result.task_id) || null, submitted: list.length };
}

/**
 * 变体分组键：同组 = 除变体轴（尺码）之外的取值完全相同。
 * 这样「同色 8 码」自然落在一组，不同颜色各自一组——与类目无关。
 */
export function groupKeyFor({ offerBase, axisValues, variantAxis }) {
  const parts = Object.entries(axisValues || {})
    .filter(([key]) => key !== variantAxis)
    .map(([key, value]) => `${key}=${String(value)}`)
    .sort();
  return parts.length ? `${offerBase}[${parts.join('&')}]` : offerBase;
}

/** 把 offer 描述按分组键归拢，供批量上架/重发使用 */
export function groupOffers(rows) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = String((row && row.groupKey) || '');
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return [...map.entries()].map(([groupKey, list]) => ({ groupKey, offers: list }));
}
