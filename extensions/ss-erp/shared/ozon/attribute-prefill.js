// Ozon 官方属性本地预填
//
// 背景：
//   类目确定后，38 个官方字段全是 STRICT_DICTIONARY（品牌/类型/材质/国家/
//   适用人群），必须提交 dictionaryValueIds 而不是自由文本。参考实现里
//   类目定了就立刻预填属性，我们此前一个都不填，用户要手点 20+ 个下拉。
//
// 做法：
//   规则驱动 —— 每条规则知道「哪个字段、查什么词、怎么选结果」。
//   字段名是俄文（Бренд / Тип / Материал），1688 侧是中文，所以规则表
//   同时承担语言桥。字典查询由调用方注入（ERP readDraftDictionary）。
//
// 只填「有确定性依据」的字段，不猜：
//   Страна-изготовитель  1688 货源基本为中国 → 固定查 Китай
//   Тип                  类目唯一类型时直接选（实测该类目只有 1 个选项）
//   Для кого             从标题受众词推（婴儿/儿童/成人/男士/女士）
//   Материал             从 1688 属性「材质」映射俄文
//   Комплектация         FREE_TEXT，从 1688「包装内容」直填
//
// 其余字段（Бренд 品牌、Аннотация 等）没有可靠来源，不预填 —— 留空让用户
// 自己决定，比填错强。

// 1688 材质 → Ozon 俄文材质（查询词）
const MATERIAL_MAP = [
  [/(树脂|滴胶|环氧)/, 'смола'],
  [/(木|实木|松木|橡木|竹)/, 'дерево'],
  [/(陶|瓷)/, 'керамика'],
  [/(玻璃|水晶)/, 'стекло'],
  [/(铁|钢|不锈钢|金属|合金)/, 'металл'],
  [/(塑料|亚克力|PVC|ABS)/i, 'пластик'],
  [/(布|棉|麻|涤纶|绒)/, 'текстиль'],
  [/(纸|卡纸)/, 'бумага'],
  [/(硅胶|橡胶)/, 'силикон'],
  [/(石|大理石|花岗岩)/, 'камень'],
  [/(蜡)/, 'воск'],
];

// 标题受众 → Ozon Для кого / 性别 查询词
// 2026-11：1688 女装标题常用「女装」「男装」而不是「女士/男士」，
// 缺这两个词时「性别」这类必填字段会漏掉（连衣裙实测漏了 9163）。
const AUDIENCE_MAP = [
  [/(婴儿|宝宝|新生儿)/, 'новорожденные'],
  [/(儿童|孩子|小孩|幼儿|学生)/, 'дети'],
  [/(男士|男款|男式|男装|boy|men)/i, 'мужчины'],
  [/(女士|女款|女式|女装|girl|women)/i, 'женщины'],
  [/(中性|情侣|男女同款|unisex)/i, 'унисекс'],
];

// 1688 颜色 → Ozon 俄文颜色（查询词）。
// 服装/鞋类类目把「商品颜色」列为必填，1688 侧一般有「颜色」或「颜色分类」属性。
const COLOR_MAP = [
  [/(黑)/, 'черный'],
  [/(白)/, 'белый'],
  [/(红)/, 'красный'],
  [/(蓝)/, 'синий'],
  [/(绿)/, 'зеленый'],
  [/(黄)/, 'желтый'],
  [/(粉)/, 'розовый'],
  [/(紫)/, 'фиолетовый'],
  [/(灰)/, 'серый'],
  [/(棕|咖|褐)/, 'коричневый'],
  [/(米|杏|卡其|驼)/, 'бежевый'],
  [/(橙|橘)/, 'оранжевый'],
  [/(金)/, 'золотой'],
  [/(银)/, 'серебряный'],
];

const COUNTRY_QUERY = 'Китай';
const COUNTRY_MATCH = /^китай$/i;

// 2026-11：不能只按 attributeId 硬编码规则。
// 实测两个类目的必填字段 ID 完全不同：
//   圣诞装饰品 17028733/95421   品牌=85  型号=9048  适用人群=8449
//   连衣裙     200000933/93182  品牌=31  卡片合并=8292  性别=9163
// 唯一稳定的是「名字的意思」。所以每条规则给两组线索：
//   ids   已知的 attributeId（快路径，命中就不用比名字）
//   names 名称正则（兜底，跨类目通用）
// 命中任一即视为该字段。
const FIELD_HINTS = {
  brand: {
    ids: [85, 31],
    names: [/品牌/, /^бренд$/i, /торгов.*марк/i],
  },
  model: {
    // 「型号名称」和「合并至一张卡片」是同一件事在不同类目下的叫法
    ids: [9048, 8292],
    names: [/型号名称/, /合并至一张卡片/, /модель/i],
  },
  audience: {
    ids: [8449, 9163],
    names: [/适用人群/, /^для кого$/i, /^性别$/i, /^пол$/i],
  },
  country: {
    ids: [4389],
    names: [/制造国/, /生产国/, /страна.*изготов/i, /страна.*произв/i],
  },
  type: {
    ids: [8229],
    names: [/^类型$/i, /^тип$/i],
  },
  material: {
    ids: [6383],
    names: [/^材质$/i, /^материал$/i],
  },
  packing: {
    ids: [4384],
    names: [/包装内容/, /комплектац/i],
  },
  color: {
    ids: [10096],
    names: [/商品颜色/, /^颜色$/i, /^цвет$/i],
  },
  size: {
    ids: [4295, 9689, 9695],
    names: [/российский размер/i, /^尺码$/i, /俄罗斯尺码/],
  },
  sizeManufacturer: {
    ids: [9533, 9688],
    names: [/размер производителя/i, /生产商尺码/],
  },
};

// 2026-11：尺码不硬编码映射表。
// 精铺和知了都没有 S→42 的换算表（精铺只在 fill-rules 里列了「尺码/размер/size」
// 关键词，实际把规格原样交给模型；知了只采集 size_name_cn）。硬编码一张表既
// 覆盖不全，又会随类目变化。
// 正确做法：从 SKU 规格里抽出尺码原文（S / M / L / 42 / XL），交给 Ozon 的
// 4295（Российский размер）字典去匹配 —— 官方字典就是权威换算表。
// 同理，颜色用 variant-spec.js 已有的中文→俄文映射。
const SIZE_TOKEN = /\b(?:XXS|XS|S|M|L|XL|XXL|XXXL|XXXXL|\d{2}(?:\/\d{2})?)\b/gi;

/** 从 SKU 规格文本里抽颜色词与尺码词 */
export function parseVariantSpecs(skus) {
  const list = Array.isArray(skus) ? skus : [];
  const colors = [];
  const sizes = [];
  for (const sku of list) {
    const text = String(sku && (sku.label || sku.spec || sku.name) || '');
    if (!text) continue;
    for (const [re, ru] of COLOR_MAP) {
      if (re.test(text) && !colors.includes(ru)) colors.push(ru);
    }
    const tokens = text.match(SIZE_TOKEN) || [];
    for (const t of tokens) {
      const up = String(t).toUpperCase();
      if (!sizes.includes(up)) sizes.push(up);
    }
  }
  return { colors, sizes };
}

/** 按线索在 fields 里找目标字段；找不到返回 null */
function resolveField(fields, hint) {
  if (!hint) return null;
  for (const id of hint.ids) {
    const hit = fields.find((f) => Number(f.attributeId) === Number(id));
    if (hit) return hit;
  }
  for (const re of hint.names) {
    const hit = fields.find((f) => re.test(String(f.name || '')));
    if (hit) return hit;
  }
  return null;
}

function normalize(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().toLowerCase();
}

/** 从 1688 属性数组里按名称找值 */
function attributeValue(attributes, patterns) {
  if (!Array.isArray(attributes)) return '';
  for (const item of attributes) {
    const name = String(item && item.name || '');
    if (patterns.some((re) => re.test(name))) {
      const v = String(item && item.value || '').trim();
      if (v) return v;
    }
  }
  return '';
}

/**
 * 生成预填计划（不发起请求）。
 *
 * @returns [{attributeId, name, kind, query, pick, reason}]
 *   kind: 'dictionary' | 'text'
 *   pick: 'exact' | 'single' | 'fuzzy' | 'raw'
 */
export function planPrefill(product, fields) {
  const list = Array.isArray(fields) ? fields : [];
  const title = String(product && product.title || '');
  const attributes = Array.isArray(product && product.attributes) ? product.attributes : [];
  const plan = [];

  const byId = new Map(list.map((f) => [Number(f.attributeId), f]));
  const push = (attributeId, spec) => {
    const field = byId.get(attributeId);
    if (!field) return;                             // 该类目没有这个字段
    if (field.editorMode === 'READ_ONLY') return;   // 只读字段不填
    if (field.ownership === 'SYSTEM') return;       // 系统管理字段不填
    plan.push({ attributeId, name: String(field.name || ''), ...spec });
  };
  // 用名称线索解析后直接入 plan（跨类目通用路径）
  const pushResolved = (hintKey, spec) => {
    const field = resolveField(list, FIELD_HINTS[hintKey]);
    if (!field) return;
    push(Number(field.attributeId), spec);
  };

  // 0. 型号 / 合并卡片：必填。Ozon 用它把同款合并成一张商品卡片，
  //    所以必须对同一商品稳定 —— 用 offerId（1688 货号）而不是随机串。
  //    不同类目叫法不同：圣诞装饰品是「型号名称」，服装是「合并至一张卡片」。
  pushResolved('model', {
    kind: 'text', query: '',
    value: (String(product && (product.offerId || product.sourceProductId) || '').trim()
      || String(product && product.title || '').trim().slice(0, 40)
      || 'MODEL').slice(0, 100),
    pick: 'raw', reason: '货号作型号，保证同款合并',
  });

  // 0b. 品牌：必填。1688 白牌商品在 Ozon 侧没有品牌，官方允许「Нет бренда」占位。
  //     这个值不在字典前 100 条（要翻 7 页），且 `value` 搜索参数无效，
  //     所以先用 query 查，查不到就用实测确认过的 id 兜底。
  pushResolved('brand', {
    kind: 'dictionary', query: 'Нет бренда', pick: 'exact', reason: '1688 白牌无品牌',
    fallbackValueId: 126745801, fallbackValue: 'Нет бренда',
  });

  // 1. 制造国：1688 货源基本为中国
  pushResolved('country', { kind: 'dictionary', query: COUNTRY_QUERY, pick: 'exact', reason: '1688 货源默认中国' });

  // 2. 类型：类目唯一选项时直接选；否则不猜
  pushResolved('type', { kind: 'dictionary', query: '', pick: 'single', reason: '类目唯一类型' });

  // 3. 适用人群 / 性别
  const audience = AUDIENCE_MAP.find(([re]) => re.test(title));
  if (audience) {
    pushResolved('audience', { kind: 'dictionary', query: audience[1], pick: 'fuzzy', reason: `标题受众「${audience[1]}」` });
  }

  // 4. 材质：优先 1688 材质属性，其次标题
  const materialText = attributeValue(attributes, [/材质/, /материал/i]) || title;
  const material = MATERIAL_MAP.find(([re]) => re.test(materialText));
  if (material) {
    pushResolved('material', { kind: 'dictionary', query: material[1], pick: 'fuzzy', reason: `材质「${material[1]}」` });
  }

  // 5. 包装内容：FREE_TEXT 直填
  const packing = attributeValue(attributes, [/包装内容/, /配件/, /套装包含/, /комплект/i]);
  if (packing) {
    const field = resolveField(list, FIELD_HINTS.packing);
    if (field && (field.valuePolicy || '') !== 'STRICT_DICTIONARY' && !field.dictionaryId) {
      push(Number(field.attributeId), { kind: 'text', query: '', value: packing.slice(0, 500), pick: 'raw', reason: '1688 包装内容直填' });
    }
  }

  // 6. 颜色 / 尺码：服装鞋类必填，且必须与 SKU 变体一致。
  //    数据来源优先级：SKU 规格文本（"30541-粉色 / S"）> 1688 属性 > 标题。
  //    颜色用本地中文→俄文映射；尺码不映射，直接把 S/M/L/42 交给 4295 字典匹配
  //    —— 官方字典就是权威换算表，硬编码一张表既不全也会随类目失效。
  const variant = parseVariantSpecs(product && product.skus);
  // variant.colors 已经是俄文（parseVariantSpecs 内部走 COLOR_MAP），
  // 不能再用它去匹配中文正则 —— 那会永远落空（实测「商品颜色」就是这么漏的）。
  let colorQuery = variant.colors[0] || '';
  if (!colorQuery) {
    const colorText = attributeValue(attributes, [/^颜色/, /颜色分类/, /^цвет/i]) || title;
    const color = COLOR_MAP.find(([re]) => re.test(colorText));
    if (color) colorQuery = color[1];
  }
  if (colorQuery) {
    pushResolved('color', { kind: 'dictionary', query: colorQuery, pick: 'fuzzy', reason: `颜色「${colorQuery}」` });
  }

  if (variant.sizes.length) {
    // 多尺码时先取第一个（其余由变体表格逐行填），单尺码直接就是它
    pushResolved('size', {
      kind: 'dictionary', query: variant.sizes[0], pick: 'fuzzy',
      reason: `SKU 尺码「${variant.sizes.slice(0, 4).join('/')}」查 4295 字典`,
    });
  }

  return plan;
}

/**
 * SKU 级变体预填计划。
 *
 * 类目级预填只能给「默认值」（第一个颜色、第一个尺码）。服装鞋类的
 * Цвет товара(lle) / Российский размер 是**变体属性**，Ozon 要求每个 SKU
 * 各自一行，否则整批商品不可售（实测 error_attribute_values_empty）。
 *
 * 这里为每个 SKU 单独生成一条计划，带上 skuKey —— runPrefill 会把它写进
 * applied[].skuKey，属性编辑器按 skuKey 落行。
 *
 * @returns [{skuKey, attributeId, name, kind, query, pick, reason}]
 */
export function planVariantPrefill(product, fields) {
  const list = Array.isArray(fields) ? fields : [];
  const skus = Array.isArray(product && product.skus) ? product.skus : [];
  if (!skus.length) return [];

  const colorField = resolveField(list, FIELD_HINTS.color);
  const sizeField = resolveField(list, FIELD_HINTS.size);
  if (!colorField && !sizeField) return [];

  const out = [];
  for (const sku of skus) {
    const key = String(sku && (sku.key || sku.skuKey) || '').trim();
    if (!key) continue;
    const parsed = parseVariantSpecs([sku]);
    if (colorField && parsed.colors.length) {
      out.push({
        skuKey: key,
        attributeId: Number(colorField.attributeId),
        name: String(colorField.name || ''),
        kind: 'dictionary', query: parsed.colors[0], pick: 'fuzzy',
        reason: `SKU 颜色「${parsed.colors[0]}」`,
      });
    }
    if (sizeField && parsed.sizes.length) {
      out.push({
        skuKey: key,
        attributeId: Number(sizeField.attributeId),
        name: String(sizeField.name || ''),
        kind: 'dictionary', query: parsed.sizes[0], pick: 'fuzzy',
        reason: `SKU 尺码「${parsed.sizes[0]}」`,
      });
    }
  }
  return out;
}

/** 从字典返回值里挑一个 */export function pickDictionaryValue(values, pick, query) {
  const list = Array.isArray(values) ? values.filter((v) => v && Number.isSafeInteger(v.id)) : [];
  if (!list.length) return null;
  if (pick === 'exact') {
    // exact 按传入的 query 精确比对；没给 query 时退回制造国的固定词表。
    const want = normalize(query || '');
    if (want) {
      const hit = list.find((v) => normalize(v.value) === want);
      if (hit) return hit;
      // 字典可能返回带前缀/括号的变体，做一次「包含」兜底
      return list.find((v) => normalize(v.value).includes(want)) || null;
    }
    return list.find((v) => COUNTRY_MATCH.test(normalize(v.value))) || null;
  }
  if (pick === 'single') return list.length === 1 ? list[0] : null;
  // fuzzy：优先最短值（通常是通用词而不是细分变体）
  return list.slice().sort((a, b) => String(a.value || '').length - String(b.value || '').length)[0] || null;
}

/**
 * 执行预填。queryDictionary 由调用方注入（走 ERP readDraftDictionary）。
 *
 * @returns {applied: [...changes], skipped: [...]}
 */
export async function runPrefill({ product, fields, schemaRevision, queryDictionary, limit = 8, includeVariants = true }) {
  // 类目级默认值 + 每个 SKU 的变体值，扁平拼在一起。
  // 类目级先跑，SKU 级后跑 —— 后者会覆盖同一字段在同一 skuKey 上的值。
  const basePlan = planPrefill(product, fields);
  const variantPlan = includeVariants ? planVariantPrefill(product, fields) : [];
  const plan = basePlan.concat(variantPlan);
  const applied = [];
  const skipped = [];

  for (const item of plan) {
    if (item.kind === 'text') {
      applied.push({
        attributeId: item.attributeId,
        skuKey: item.skuKey || null,
        value: item.value,
        dictionaryValueIds: [],
        reviewed: false,
        source: `本地预填 · ${item.reason}`,
      });
      continue;
    }
    try {
      const response = await queryDictionary({
        schemaRevision,
        attributeId: item.attributeId,
        query: item.query,
        limit,
      });
      const values = response?.dictionary?.values || response?.values || [];
      const chosen = pickDictionaryValue(values, item.pick, item.query);
      if (!chosen) {
        // 兜底：某些字典值（例如「Нет бренда」）不在前 N 条，且 `value` 搜索
        // 参数对它们无效。这类值如果已经实测确认过 id，就直接用。
        if (item.fallbackValueId) {
          applied.push({
            attributeId: item.attributeId,
            skuKey: item.skuKey || null,
            value: String(item.fallbackValue || ''),
            dictionaryValueIds: [item.fallbackValueId],
            reviewed: false,
            source: `本地预填 · ${item.reason} → ${item.fallbackValue}（兜底 id）`,
          });
          continue;
        }
        skipped.push({ attributeId: item.attributeId, name: item.name, reason: `字典无匹配（query=${item.query || '空'}，候选 ${values.length} 个）` });
        continue;
      }
      applied.push({
        attributeId: item.attributeId,
        skuKey: item.skuKey || null,
        value: String(chosen.value || ''),
        dictionaryValueIds: [chosen.id],
        reviewed: false,
        source: `本地预填 · ${item.reason} → ${chosen.value}`,
      });
    } catch (error) {
      // 查询本身失败时同样允许兜底，否则一次网络抖动就丢掉必填字段
      if (item.fallbackValueId) {
        applied.push({
          attributeId: item.attributeId,
          skuKey: item.skuKey || null,
          value: String(item.fallbackValue || ''),
          dictionaryValueIds: [item.fallbackValueId],
          reviewed: false,
          source: `本地预填 · ${item.reason} → ${item.fallbackValue}（兜底 id）`,
        });
        continue;
      }
      skipped.push({ attributeId: item.attributeId, name: item.name, reason: String(error && error.message || error).slice(0, 120) });
    }
  }

  return { applied, skipped, planned: plan.length };
}
