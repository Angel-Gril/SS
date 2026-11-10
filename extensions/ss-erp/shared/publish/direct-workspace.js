// 直连上架在没有 ERP 草稿时需要的两样东西（唯一 owner）：
//   1. 本机记住的 Ozon 类目（按来源商品分键）；
//   2. 直接向 Ozon 读取官方属性 + 本地规则预填得到的属性工作区；
// 以及上架完成后发给 ERP 的最终同步载荷。
//
// 见 dev-docs/extension-direction.md：ERP 不可用时扩展仍可完成采集/生图/上架。
// 本模块不碰 DOM 与 chrome.*；存储与消息通道由调用方注入。
import { runPrefill } from '../ozon/attribute-prefill.js';

export const DIRECT_CATEGORY_STORE_PREFIX = 'ss-erp:direct-category:v1:';

function positiveId(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

/** 类目选择落在本机：选完类目不再要求先有 ERP 草稿。 */
export function createDirectCategoryStore({ storage, sourceKey }) {
  const key = DIRECT_CATEGORY_STORE_PREFIX + String(sourceKey || 'unknown');
  return {
    key,
    async load() {
      const stored = await storage.get(key);
      const value = stored && stored[key];
      const categoryId = positiveId(value && value.categoryId), typeId = positiveId(value && value.typeId);
      return categoryId && typeId ? { categoryId, typeId, typeName: String(value.typeName || '') } : null;
    },
    async save(category) {
      const categoryId = positiveId(category && category.categoryId), typeId = positiveId(category && category.typeId);
      if (!categoryId || !typeId) throw new Error('类目无效，无法保存');
      await storage.set({ [key]: { categoryId, typeId, typeName: String((category && category.typeName) || '').slice(0, 200) } });
    },
  };
}

/**
 * 不经过 ERP 的属性工作区：官方字段来自 Ozon，取值来自本地确定性规则
 *（货号作型号、白牌品牌、制造国、SKU 颜色尺码等）。形状与 ERP editor/attributes 一致，
 * 可直接交给 planDirectItems。
 *
 * @param send (type, payload) => Promise  直连消息通道
 */
export async function buildDirectWorkspace({ category, product, send }) {
  const categoryId = positiveId(category && category.categoryId), typeId = positiveId(category && category.typeId);
  if (!categoryId || !typeId) throw new Error('请先选择 Ozon 类目');
  const schema = await send('ss-erp:direct-ozon-attributes', { categoryId, typeId });
  const fields = Array.isArray(schema && schema.fields) ? schema.fields : [];
  if (!fields.length) throw new Error('Ozon 没有返回该类目的官方属性');
  const result = await runPrefill({
    product: { ...product, typeId },
    fields,
    schemaRevision: 'direct',
    queryDictionary: (input) => send('ss-erp:direct-ozon-attribute-values', {
      categoryId, typeId, attributeId: input.attributeId, query: input.query, limit: input.limit,
    }),
  });
  return {
    source: 'OZON_DIRECT',
    schemaRevision: 'direct',
    fields,
    values: result.applied.map((row) => ({
      attributeId: Number(row.attributeId),
      skuKey: row.skuKey === undefined ? null : row.skuKey,
      value: row.value,
      dictionaryValueIds: Array.isArray(row.dictionaryValueIds) ? row.dictionaryValueIds : [],
    })),
    skipped: result.skipped,
  };
}

function httpsUrls(list) {
  return (Array.isArray(list) ? list : []).map(url => String(url || '').trim())
    .filter(url => /^https:\/\/\S+$/u.test(url) && url.length <= 2000).slice(0, 15);
}

/**
 * 上架完成后的最终同步载荷（对应 ERP POST /api/extension-device/direct-listings）。
 * 只带 ERP 会接受的字段；来源或条目缺失时返回 null，由调用方提示“未同步”。
 */
export function buildDirectListingSyncPayload({ source, shopId, category, items, result }) {
  const sourcePlatform = String((source && source.platform) || '').trim().toLowerCase();
  const sourceProductId = String((source && source.sourceProductId) || '').trim();
  const list = Array.isArray(items) ? items.filter(item => item && String(item.offerId || '').trim()) : [];
  if (!sourcePlatform || !sourceProductId || !list.length) return null;
  const outcomes = new Map((Array.isArray(result && result.items) ? result.items : [])
    .map(one => [String(one && one.offerId || ''), one]));
  const overallStatus = String((result && result.status) || '').trim();
  const title = String((list.find(item => String(item.name || '').trim()) || {}).name || '').trim().slice(0, 500);
  if (!title) return null;
  const sourceUrl = httpsUrls([source && source.canonicalUrl])[0];
  const categoryId = positiveId(category && category.categoryId), typeId = positiveId(category && category.typeId);
  return {
    ...(shopId ? { shopId: String(shopId) } : {}),
    sourcePlatform,
    sourceProductId,
    ...(sourceUrl ? { sourceUrl } : {}),
    title,
    ...(categoryId ? { categoryId } : {}),
    ...(typeId ? { typeId } : {}),
    items: list.slice(0, 100).map((item) => {
      const outcome = outcomes.get(String(item.offerId)) || {};
      const productId = positiveId(outcome.productId);
      const status = String(outcome.status || overallStatus || '').trim().slice(0, 60);
      const price = String(item.price || '').trim(), oldPrice = String(item.oldPrice || '').trim();
      const currency = String(item.currency || '').trim().toUpperCase();
      return {
        offerId: String(item.offerId).trim().slice(0, 200),
        ...(item.skuKey ? { skuKey: String(item.skuKey).slice(0, 500) } : {}),
        ...(productId ? { productId: String(productId) } : {}),
        ...(price ? { price: price.slice(0, 40) } : {}),
        ...(oldPrice ? { oldPrice: oldPrice.slice(0, 40) } : {}),
        ...(currency.length >= 3 ? { currency: currency.slice(0, 8) } : {}),
        ...(status ? { status } : {}),
        images: httpsUrls(item.images),
      };
    }),
  };
}
