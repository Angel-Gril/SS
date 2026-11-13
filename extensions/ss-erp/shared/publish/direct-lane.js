// 直连车道（Lane A）的载荷组装器
//
// 背景：ERP 的 /editor/save 是单点写通道，一次超时就把整个工作台卡住；而
// 把商品发到 Ozon 本身只需要 offer_id + 属性 + 价格 + 尺寸 + 图片，不依赖 ERP。
// 所以把「组装 item」这件事做成纯函数，两边共用：
//   - 工作台点「直连上架」时用它拼载荷
//   - 命令行 dry-run 用它体检（不联网、不写 ERP）
//
// 关键约定（实测踩过）：
//   1. 每个 SKU 一条 item（offer_id 各自独立）。把三个尺码塞进同一条 item 的
//      变体属性里，Ozon 侧会互相覆盖。
//   2. 属性分两层：产品级（skuKey=null）+ SKU 级（颜色/尺码），SKU 级只取本 SKU 的行。
//   3. 字典字段提交 dictionary_value_id，自由文本提交 value —— 二者不能混在同一条。
//   4. 尺寸必须平铺到顶层（height/depth/width/dimension_unit），嵌套会被静默丢弃。

const READ_ONLY_OWNERSHIPS = new Set(['SYSTEM', 'MEDIA']);

/** SKU 规格里抽一个稳定的后缀（S / M / L / 2XL / 42），抽不到就用序号 */
export function offerSuffix(label, index) {
  const text = String(label || '');
  const token = text.match(/\b(?:XXS|XS|S|M|L|XL|XXL|XXXL|XXXXL|\d{2,3}(?:\/\d{2})?)\b/i);
  if (token) return String(token[0]).toUpperCase().replace(/\//g, '-');
  const tail = text.split(/[\/|]/).pop().trim();
  // Ozon 的 offer_id 只接受 ASCII：中文规格名（例如「发光诞生场景壁饰」）必须落成数字，
  // 否则导入会被拒（precheck 不校验这一点）。
  const ascii = tail.replace(/[^A-Za-z0-9_-]+/g, '').slice(0, 12);
  if (ascii) return ascii.toUpperCase();
  const latinToken = (text.match(/[A-Za-z0-9]{1,12}/g) || []).map((one) => one.replace(/[^A-Za-z0-9]/g, '')).filter(Boolean);
  if (latinToken.length) return latinToken[latinToken.length - 1].toUpperCase();
  return String(index + 1);
}

/** offer_id：基础货号 + 规格后缀（S/M/L/2XL…），任何地方都用同一套 */
export function offerIdFor(offerBase, label, index) {
  const base = String(offerBase || '').trim();
  return base ? base + '-' + offerSuffix(label, index) : '';
}

function valuesOfRow(row) {
  const ids = Array.isArray(row && row.dictionaryValueIds)
    ? row.dictionaryValueIds.filter((id) => Number.isSafeInteger(id) && id > 0)
    : [];
  if (ids.length) return ids.map((id) => ({ dictionary_value_id: id }));
  const raw = row && row.value;
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .filter((v) => v !== null && v !== undefined && v !== '')
    .map((v) => ({ value: String(v).slice(0, 500) }));
}

function attributeMapFor(workspaceValues, skuKey) {
  const byId = new Map();
  for (const row of workspaceValues) {
    const owner = row.skuKey === null || row.skuKey === undefined ? null : String(row.skuKey);
    if (owner !== null && owner !== String(skuKey)) continue;   // 别的 SKU 的行
    const id = Number(row.attributeId);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    const values = valuesOfRow(row);
    if (!values.length) continue;
    if (!byId.has(id)) byId.set(id, []);
    for (const value of values) {
      const duplicate = byId.get(id).some((existing) => JSON.stringify(existing) === JSON.stringify(value));
      if (!duplicate) byId.get(id).push(value);
    }
  }
  return [...byId.entries()].map(([id, values]) => ({ id, values }));
}

/** 按 skuKey 取一条记录（定价/包装都可能是 {skuKey,...} 或 [{skuKey,...}]） */
function pickBySku(list, skuKey) {
  const rows = Array.isArray(list) ? list : (list && Array.isArray(list.items) ? list.items : []);
  return rows.find((row) => row && String(row.skuKey) === String(skuKey)) || null;
}

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * @param {object} input
 *   editor   ERP editor/read 的 data（category / pricing / packaging / copy / selectedSkuKeys / mediaAssignments）
 *   workspace ERP editor/attributes 的 data（schemaRevision / fields / values）
 *   offerBase 基础货号（1688 货号）
 *   images   [{ scope:'PRODUCT'|'SKU', skuKey, url }] —— 只收 https URL
 *   defaults { currency, vat, weight, dimensions }
 * @returns { items, blockers, ready, notes }
 */
export function planDirectItems(input) {
  const editor = (input && input.editor) || {};
  const workspace = (input && input.workspace) || {};
  const values = Array.isArray(workspace.values) ? workspace.values : [];
  const fields = Array.isArray(workspace.fields) ? workspace.fields : [];
  const category = editor.category || {};
  const skuKeys = Array.isArray(editor.selectedSkuKeys) && editor.selectedSkuKeys.length
    ? editor.selectedSkuKeys.map(String)
    : [...new Set(values.map((row) => row.skuKey).filter((key) => key !== null && key !== undefined).map(String))];
  // 货号必须唯一：suffix 只取尺码，多颜色的同一尺码会撞号，Ozon 回 400
  // "not allowed to specify several items with the same offer_id"。撞号时追加 -2/-3。
  const usedOfferIds = new Map();
  const offerBase = String((input && input.offerBase) || '').trim();
  const defaults = (input && input.defaults) || {};
  const images = Array.isArray(input && input.images) ? input.images.filter((img) => img && /^https:\/\//.test(String(img.url || ''))) : [];

  const notes = [];
  const blockers = [];
  const items = [];

  if (!offerBase) blockers.push({ scope: 'all', code: 'OFFER_BASE_MISSING', detail: '缺少基础货号（1688 货号）' });
  if (!Number.isSafeInteger(Number(category.categoryId))) blockers.push({ scope: 'all', code: 'CATEGORY_MISSING', detail: '草稿还没有官方类目' });
  if (!skuKeys.length) blockers.push({ scope: 'all', code: 'SKU_MISSING', detail: '草稿没有选中的 SKU' });

  const requiredFields = fields.filter((field) => field && field.required
    && !READ_ONLY_OWNERSHIPS.has(String(field.ownership))
    && !['READ_ONLY', 'MEDIA_WORKBENCH'].includes(String(field.editorMode)));

  const productImages = images.filter((img) => img.scope === 'PRODUCT').map((img) => img.url);

  // 可变特性去重：颜色+尺码完全相同的两个 SKU，Ozon 拒绝并入同一张卡
  // （「无法与其他商品合并…至少更改一个可变特性」），还会留下一张单独的卡。
  // 1688 常见情形：「XXXL」和「加大XXXL」都被解析成 XXXL。保留先出现的，其余记 note。
  const variantSignatureOf = (skuKey) => {
    const parts = [];
    for (const row of values) {
      if (row.skuKey != null && String(row.skuKey) !== String(skuKey)) continue;
      const field = fields.find((f) => Number(f.attributeId || f.id) === Number(row.attributeId));
      if (!field || String(field.ownership || "").toUpperCase() !== "SKU") continue;
      const value = (Array.isArray(row.dictionaryValueIds) && row.dictionaryValueIds[0]) || row.value || "";
      if (String(value).trim()) parts.push(String(row.attributeId) + "=" + String(value).trim());
    }
    return parts.sort().join("|");
  };
  const seenVariant = new Map();
  const keptSkuKeys = [];
  for (const skuKey of skuKeys) {
    const signature = variantSignatureOf(skuKey);
    if (signature && seenVariant.has(signature)) {
      notes.push({ scope: String(skuKey), code: "DUPLICATE_VARIANT",
        detail: "与 " + seenVariant.get(signature) + " 的颜色/尺码完全相同，已跳过" });
      continue;
    }
    if (signature) seenVariant.set(signature, String(skuKey));
    keptSkuKeys.push(skuKey);
  }
  const effectiveSkuKeys = keptSkuKeys.length ? keptSkuKeys : skuKeys;
  effectiveSkuKeys.forEach((skuKey, index) => {
    const suffix = offerSuffix(skuKey, index);
  let offerId = offerBase ? offerBase + '-' + suffix : '';
  if (offerId) {
    const seenCount = (usedOfferIds.get(offerId) || 0) + 1;
    usedOfferIds.set(offerId, seenCount);
    if (seenCount > 1) offerId = offerId + '-' + seenCount;
  }
    const attributes = attributeMapFor(values, skuKey);
    const have = new Set(attributes.map((attribute) => attribute.id));

    const pricing = pickBySku(editor.pricing, skuKey) || {};
    const packaging = pickBySku(editor.packaging, skuKey) || {};
    const copy = editor.copy || {};
    const skuImages = images.filter((img) => img.scope === 'SKU' && String(img.skuKey) === String(skuKey)).map((img) => img.url);
    const allImages = [...skuImages, ...productImages].slice(0, 15);

    const price = numberOrZero(pricing.price) || numberOrZero(defaults.price);
    const oldPrice = numberOrZero(pricing.oldPrice) || numberOrZero(defaults.oldPrice);
    const weight = numberOrZero(packaging.weightG) || numberOrZero(packaging.weight) || numberOrZero(defaults.weight);
    const width = numberOrZero(packaging.widthMm) || numberOrZero(defaults.width);
    const height = numberOrZero(packaging.heightMm) || numberOrZero(defaults.height);
    const depth = numberOrZero(packaging.depthMm) || numberOrZero(defaults.depth);

    const missingRequired = requiredFields
      .filter((field) => !have.has(Number(field.attributeId)))
      .map((field) => ({ id: Number(field.attributeId), name: String(field.name || '') }));

    const itemBlockers = [];
    if (!offerId) itemBlockers.push('OFFER_ID');
    if (String(copy.titleRu || '').trim().length < 3) itemBlockers.push('TITLE_RU');
    if (!price) itemBlockers.push('PRICE');
    if (!weight) itemBlockers.push('WEIGHT');
    if (!width || !height || !depth) itemBlockers.push('DIMENSIONS');
    if (!allImages.length) itemBlockers.push('IMAGES');
    if (missingRequired.length) itemBlockers.push('REQUIRED_ATTRIBUTES');

    items.push({
      offerId,
      skuKey,
      suffix,
      categoryId: Number(category.categoryId) || null,
      typeId: Number(category.typeId) || null,
      attributes,
      attributeCount: attributes.length,
      price: price ? price.toFixed(2) : null,
      oldPrice: oldPrice ? oldPrice.toFixed(2) : null,
      currency: String(pricing.currencyCode || defaults.currency || 'CNY').toUpperCase(),
      vat: String(pricing.vat || defaults.vat || '0'),
      weight: weight || null,
      dimensions: { height: height || null, depth: depth || null, width: width || null },
      images: allImages,
      name: String(copy.titleRu || '').trim(),
      description: String(copy.descriptionRu || '').trim(),
      missingRequired,
      blockers: itemBlockers,
    });

    for (const code of itemBlockers) {
      blockers.push({ scope: offerId || 'sku#' + (index + 1), code, detail: code === 'REQUIRED_ATTRIBUTES'
        ? missingRequired.map((field) => field.name || field.id).join(' / ')
        : '' });
    }
  });

  if (!images.length) notes.push('没有 https 图片：直连上架至少要一张（AI 出图结果或已转存的 CDN 地址）');
  if (!editor.pricing) notes.push('定价为空：需要先填每个 SKU 的售价/折扣前价');
  if (!Array.isArray(editor.packaging) || !editor.packaging.length) notes.push('包装参数为空：重量与长宽高是 Ozon 必填');
  if (!editor.copy || (!editor.copy.titleRu && !editor.copy.descriptionRu)) notes.push('俄文标题/描述为空');

  return {
    offerBase,
    category: { categoryId: Number(category.categoryId) || null, typeId: Number(category.typeId) || null },
    skuCount: effectiveSkuKeys.length,
    requiredFieldCount: requiredFields.length,
    items,
    blockers,
    notes,
    ready: blockers.length === 0 && items.length > 0,
  };
}

/** 单个 item 的最终体检：交给 direct-publish.buildItem 之前跑一遍，错误信息更具体 */
export function preflightItem(item, buildItem) {
  try {
    const built = buildItem({
      offerId: item.offerId,
      name: item.name,
      description: item.description,
      categoryId: item.categoryId,
      typeId: item.typeId,
      price: item.price,
      oldPrice: item.oldPrice,
      currency: item.currency,
      vat: item.vat,
      weight: item.weight,
      dimensions: item.dimensions,
      images: item.images,
      attributes: item.attributes,
    });
    return { ok: true, built };
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) };
  }
}
