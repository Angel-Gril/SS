// 变体键识别（Ozon 的 model 成组规则）
//
// 背景（2026-11 实测，两次对照）：
//   连衣裙 200000933/93182，2 个 SKU 差在尺码 44/46
//     → import 后 status 走 offer_validated → moderated → price_sent
//     → model_info.count = 2，状态「Продается」，库存 API 接受
//   圣诞装饰 17028733/95421，2 个 SKU 差在商品颜色（白色/透明）
//     → 永远停在 variant_wait，model_info.count = 1/0
//     → 库存 API 回 PRODUCT_HAS_NOT_BEEN_TAGGED_YET（下游症状）
//
// 结论：不是载荷格式问题（同一套 Node 载荷在连衣裙上成功），而是**类目是否支持
// 多变体成组**。服装类是「尺码 × 颜色」双集合适配变体；装饰类只有颜色集合，Ozon
// 不把它当成变体维度，于是每张卡都在等一个永远不会出现的组。
//
// 因此发布前必须先判定：这个类目能不能把 N 个 SKU 合成一张卡。
//   - 能   → 正常发，靠 size/colour 成组
//   - 不能 → 要么只发 1 个 SKU（单品卡），要么阻断并说明原因
// 判定错一次的代价是一张永远不销售的坏卡（T7/T9/TA 就是这么来的）。

const SIZE_RE = /размер|尺码|尺寸/i;
const COLOUR_RE = /цвет|颜色/i;

function isCollectionField(field) {
  const ownership = String((field && field.ownership) || '').toUpperCase();
  return ownership === 'SKU' || Boolean(field && (field.isCollection || field.is_collection));
}

function fieldName(field) {
  return String((field && (field.name || field.label)) || '');
}

/**
 * @param {object} input { fields: 类目 schema 字段数组, skuCount: SKU 数 }
 * @returns {{
 *   supported: boolean,        // 该类目是否支持多变体成组
 *   variantFields: string[],   // 参与成组的集合属性名
 *   colourField: string, sizeField: string,
 *   reason: string,
 * }}
 */
export function detectVariantSupport({ fields, skuCount }) {
  const list = Array.isArray(fields) ? fields : [];
  const collections = list.filter(isCollectionField);
  const colour = collections.find((field) => COLOUR_RE.test(fieldName(field))) || null;
  const size = collections.find((field) => SIZE_RE.test(fieldName(field))) || null;

  // 服装类：尺码 + 颜色同时在集合属性里，Ozon 才按变体成组。
  // 只有颜色、没有尺码的类目（装饰品/家居）走单品卡，多 SKU 会被卡在 variant_wait。
  const supported = Boolean(size) && Boolean(colour);
  const variantFields = [size, colour].filter(Boolean).map(fieldName);

  let reason = '';
  if (supported) reason = `该类型支持多变体：成组维度 ${variantFields.join(' × ')}`;
  else if (skuCount > 1) {
    reason = colour
      ? '该类目只有颜色集合属性、没有尺码维度，Ozon 不会把多个 SKU 合成一张卡（会一直 variant_wait）'
      : '该类目没有尺码/颜色集合属性，多 SKU 无法成组';
  } else reason = '单个 SKU：不需要成组';

  return {
    supported,
    variantFields,
    colourField: colour ? fieldName(colour) : '',
    sizeField: size ? fieldName(size) : '',
    reason,
  };
}

/**
 * 发布前判定：把「能不能成组」翻译成 blocker。
 * 单个 SKU 不拦（单品卡是合法路径，只是本仓库还没单独实现）。
 */
export function variantBlockers({ fields, skuCount }) {
  const info = detectVariantSupport({ fields, skuCount });
  if (skuCount > 1 && !info.supported) {
    return {
      info,
      blockers: [{ scope: 'all', code: 'VARIANT_UNSUPPORTED', detail: info.reason }],
    };
  }
  return { info, blockers: [] };
}
