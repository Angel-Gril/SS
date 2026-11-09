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

// 标题受众 → Ozon Для кого 查询词
const AUDIENCE_MAP = [
  [/(婴儿|宝宝|新生儿)/, 'новорожденные'],
  [/(儿童|孩子|小孩|幼儿|学生)/, 'дети'],
  [/(男士|男款|男式|boy|men)/i, 'мужчины'],
  [/(女士|女款|女式|girl|women)/i, 'женщины'],
];

const COUNTRY_QUERY = 'Китай';
const COUNTRY_MATCH = /^китай$/i;

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

  // 0. 型号名称（9048）：必填。Ozon 用它把同款合并成一张商品卡片，
  //    所以必须对同一商品稳定 —— 用 offerId（1688 货号）而不是随机串。
  if (byId.has(9048)) {
    const model = String(product && (product.offerId || product.sourceProductId) || '').trim()
      || String(product && product.title || '').trim().slice(0, 40)
      || 'MODEL';
    push(9048, { kind: 'text', query: '', value: model.slice(0, 100), pick: 'raw', reason: '货号作型号，保证同款合并' });
  }

  // 0b. 品牌（85）：必填。
  //     1688 白牌商品在 Ozon 侧没有品牌，官方允许用「Нет бренда」占位。
  //     这个值实测不在字典前 100 条（要翻 7 页），而且 `value` 搜索参数无效，
  //     所以先用 query 查，查不到就用已知 id 兜底。
  if (byId.has(85)) {
    push(85, { kind: 'dictionary', query: 'Нет бренда', pick: 'exact', reason: '1688 白牌无品牌',
      fallbackValueId: 126745801, fallbackValue: 'Нет бренда' });
  }

  // 1. 制造国：1688 货源基本为中国
  if (byId.has(4389)) {
    push(4389, { kind: 'dictionary', query: COUNTRY_QUERY, pick: 'exact', reason: '1688 货源默认中国' });
  }

  // 2. 类型：类目唯一选项时直接选；否则不猜
  if (byId.has(8229)) {
    push(8229, { kind: 'dictionary', query: '', pick: 'single', reason: '类目唯一类型' });
  }

  // 3. 适用人群
  const audience = AUDIENCE_MAP.find(([re]) => re.test(title));
  if (audience && byId.has(8449)) {
    push(8449, { kind: 'dictionary', query: audience[1], pick: 'fuzzy', reason: `标题受众「${audience[1]}」` });
  }

  // 4. 材质：优先 1688 材质属性，其次标题
  const materialText = attributeValue(attributes, [/材质/, /материал/i]) || title;
  const material = MATERIAL_MAP.find(([re]) => re.test(materialText));
  if (material && byId.has(6383)) {
    push(6383, { kind: 'dictionary', query: material[1], pick: 'fuzzy', reason: `材质「${material[1]}」` });
  }

  // 5. 包装内容：FREE_TEXT 直填
  const packing = attributeValue(attributes, [/包装内容/, /配件/, /套装包含/, /комплект/i]);
  if (packing && byId.has(4384)) {
    const field = byId.get(4384);
    if ((field.valuePolicy || '') !== 'STRICT_DICTIONARY' && !field.dictionaryId) {
      push(4384, { kind: 'text', query: '', value: packing.slice(0, 500), pick: 'raw', reason: '1688 包装内容直填' });
    }
  }

  return plan;
}

/** 从字典返回值里挑一个 */
export function pickDictionaryValue(values, pick, query) {
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
export async function runPrefill({ product, fields, schemaRevision, queryDictionary, limit = 8 }) {
  const plan = planPrefill(product, fields);
  const applied = [];
  const skipped = [];

  for (const item of plan) {
    if (item.kind === 'text') {
      applied.push({
        attributeId: item.attributeId,
        skuKey: null,
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
            skuKey: null,
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
        skuKey: null,
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
          skuKey: null,
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
