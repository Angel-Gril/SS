// 生图提示词：纯规则生成，零模型
//
// 依据（实跑精铺 v20260803 得到）：
//   modules/image-generation/direct-prompt-plan.js
//     export function buildDirectImagePromptPlan({ rawData })    ← 只吃采集数据
//   modules/image-generation/direct-prompt-text.js
//     DIRECT_FORBIDDEN_ITEMS   ← 14 条硬编码负面清单
//   modules/image-generation/prompt-plan-schema.js
//     SHARED_SLOT_BLUEPRINTS   ← 7 个槽位（scene/detail/function/fitment/spec/package/poster）
//
// 关键结论：提示词不需要视觉模型。精铺的 vision 失败时 run-workflow 直接
// `.catch(() => ({}))` 然后照常进入 IMAGE 阶段，说明生图不依赖视觉理解。
// 结构化输入（标题 + 1688 属性 + 索引选的参考图）已经足够。

import {
  SELECTED_REFERENCE_LIMIT,
  selectReferences,
  evenSample,
} from './reference-selector.js';

export const DIRECT_PROMPT_VERSION = 'direct-prompt-v1';

// 槽位蓝图（与精铺 SHARED_SLOT_BLUEPRINTS 对齐，含俄文卖点）
export const SLOT_BLUEPRINTS = Object.freeze([
  { slotId: 'shared_gallery_1', sortOrder: 1, goalType: 'scene_image',    brief: '使用场景 / 安装场景图，说明商品用在哪里', sellingPoint: 'Сценарий применения' },
  { slotId: 'shared_gallery_2', sortOrder: 2, goalType: 'detail_image',   brief: '材质与细节特写，只聚焦一个纹理/边缘/工艺点', sellingPoint: 'Материал и фактура' },
  { slotId: 'shared_gallery_3', sortOrder: 3, goalType: 'function_image', brief: '功能图，只讲一个核心功能，不与其他图重复', sellingPoint: 'Ключевая функция' },
  { slotId: 'shared_gallery_4', sortOrder: 4, goalType: 'fitment_image',  brief: '适配或安装说明图，只能基于来源证据', sellingPoint: 'Совместимость и посадка' },
  { slotId: 'shared_gallery_5', sortOrder: 5, goalType: 'spec_board',     brief: '规格或清单图，用非数字的结构/材质/功能/包装标签；具体尺寸在生成之外处理', sellingPoint: 'Характеристики без лишних цифр' },
  { slotId: 'shared_gallery_6', sortOrder: 6, goalType: 'package_image',  brief: '包装或随附物品图，基于可见来源证据', sellingPoint: 'Комплектация' },
  { slotId: 'shared_gallery_7', sortOrder: 7, goalType: 'poster_image',   brief: '综合卖点海报，一个独特卖点 + 同一视觉系统', sellingPoint: 'Главное преимущество' },
]);

// 负面清单：逐条对应 Ozon 图片驳回原因（照抄精铺 DIRECT_FORBIDDEN_ITEMS）
export const FORBIDDEN_ITEMS = Object.freeze([
  'no source-language marketplace copy outside preserved product artwork',
  'no pure white empty background or plain white cutout',
  'no OEM/original/certification/warranty claims without evidence',
  'no performance or safety improvement claims without evidence',
  'no scratch-proof, crash-proof, permanent, best, strongest, 100% claims',
  'no factory, workshop, production line, workers, machinery, QC table, warehouse, factory-direct copy',
  'no watermark, QR code, phone number, price, discount badge, marketplace UI',
  'no tiny unreadable typography, low contrast text, or long paragraphs',
  'no redesigned product, changed product shape, changed color, changed structure, or changed proportions',
  'no altered retail package artwork or translated product-surface text',
  'no invented accessory, omitted accessory, wrong SKU bundle, or wrong parts count',
  'no measurement lines, dimension labels, numeric cm/mm labels, or invented dimensions',
  'no wrong capacity unit, wrong SKU capacity, invented load capacity, or converted capacity/weight claims',
  'no generic benefit badge, standalone slogan badge, duplicated feature labels, or plain photo without Russian title',
]);

// 无意义的属性值（照抄精铺 isMeaninglessSkuFeature 的判定思路）
const MEANINGLESS = new Set([
  'default', 'none', 'null', 'undefined', 'unknown', 'object', 'reference_only',
  'sku_default', 'no', 'n/a', 'na', '-', '--', '无', '否', '默认', '其他', '其它',
]);

// 1688 属性名 → 提示词里用的语义槽
const FACT_KEYS = [
  { key: 'material', patterns: [/材质/, /材料/, /материал/i] },
  { key: 'color', patterns: [/颜色/, /色彩/, /色/, /цвет/i, /color/i] },
  { key: 'size', patterns: [/尺寸/, /规格/, /大小/, /размер/i, /size/i] },
  { key: 'capacity', patterns: [/容量/, /净含量/, /объ[её]м/i] },
  { key: 'style', patterns: [/风格/, /款式/, /стиль/i, /style/i] },
  { key: 'model', patterns: [/型号/, /model/i] },
  { key: 'craft', patterns: [/工艺/, /技法/, /craft/i] },
  { key: 'package', patterns: [/包装/, /包装内容/, /комплект/i] },
];

/** 从属性数组里提取有意义的 facts */
export function extractFacts(attributes) {
  const list = Array.isArray(attributes) ? attributes : [];
  const facts = {};
  for (const item of list) {
    const name = String((item && item.name) || '');
    const value = String((item && item.value) || '').trim();
    if (!value || MEANINGLESS.has(value.toLowerCase())) continue;
    if (value.length > 120) continue;
    const hit = FACT_KEYS.find((f) => f.patterns.some((re) => re.test(name)));
    if (!hit) continue;
    if (!facts[hit.key]) facts[hit.key] = value;
  }
  return facts;
}

/** 负面提示词组 */
export function buildNegativePrompt() {
  return FORBIDDEN_ITEMS.join(', ');
}

/**
 * 生成一张图的提示词。
 *
 * @param {object} input
 *   product  { title, categoryName?, attributes?[] }
 *   slot     SLOT_BLUEPRINTS 中的一项
 *   refs     selectReferences() 的结果
 *   variant  { label?, facts? }  SKU 变体
 */
export function buildSlotPrompt({ product, slot, refs, variant }) {
  const facts = variant && variant.facts ? variant.facts : extractFacts(product && product.attributes);
  const title = clean(product && product.title, 180);
  const category = clean(product && product.categoryName, 80);

  const factLine = Object.entries(facts)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join('; ');

  const refLines = (refs || []).map((r) => `- ${r.visualRole}: ${r.reason}`).join('\n');

  const parts = [
    `Task: create one Ozon marketplace product image, aspect ratio 3:4.`,
    `Goal type: ${slot.goalType}. ${slot.brief}`,
    category ? `Ozon category: ${category}.` : '',
    variant && variant.label ? `SKU variant: ${clean(variant.label, 120)}.` : '',
    title
      // 源标题只作为隐藏身份元数据，不允许被渲染成可见文字
      ? `Hidden product identity (do not render, transliterate or copy these words): ${title}.`
      : '',
    factLine ? `Grounded product facts (use as visual truth, never as invented numbers): ${factLine}.` : '',
    refLines ? `Reference images and their roles:\n${refLines}` : '',
    `Russian headline required: ${slot.sellingPoint}`,
    `Negative: ${buildNegativePrompt()}.`,
  ];

  return parts.filter(Boolean).join('\n');
}

/**
 * 生成整个计划：7 个共享槽位 + 每个 SKU 一张英雄图。
 *
 * @param {object} input
 *   product    { title, categoryName?, attributes?[] }
 *   media      projection.media
 *   skus       [{ key, label, facts? }]
 *   perSkuCount 每 SKU 图数（精铺默认 8）
 */
export function buildDirectPromptPlan({ product, media, skus, perSkuCount = 8 } = {}) {
  const refs = selectReferences(media, SELECTED_REFERENCE_LIMIT);
  const variants = normalizeSkus(skus, product);

  const sharedSlots = SLOT_BLUEPRINTS.slice(0, 7).map((slot) => ({
    ...slot,
    scope: 'shared',
    inputImageUrls: refs.map((r) => r.url).slice(0, SELECTED_REFERENCE_LIMIT),
    prompt: buildSlotPrompt({ product, slot, refs }),
  }));

  const perSku = variants.map((variant) => {
    const hero = {
      slotId: `sku_hero_${variant.key}`,
      sortOrder: 0,
      goalType: 'hero_image',
      brief: '主图：完整套装占画面 68%~78%，干净商业布景，顶部或左上留白给标题',
      sellingPoint: 'Главное изображение товара',
    };
    const urls = uniqueUrls([
      variant.sourceImageUrl,
      ...refs.map((r) => r.url),
    ]).slice(0, 9);
    return {
      variantKey: variant.key,
      variantLabel: variant.label,
      imageCount: perSkuCount,
      slots: [{
        ...hero,
        scope: 'sku',
        inputImageUrls: urls,
        prompt: buildSlotPrompt({ product, slot: hero, refs, variant }),
      }],
    };
  });

  return {
    version: DIRECT_PROMPT_VERSION,
    aspectRatio: '3:4',
    referenceIds: refs.map((r) => r.refId),
    sharedGallery: sharedSlots,
    perSku,
    negativePrompt: buildNegativePrompt(),
    // 明确记录：本计划不依赖任何视觉模型输出
    requiresVision: false,
    usesVisionReport: false,
  };
}

function normalizeSkus(skus, product) {
  const list = Array.isArray(skus) ? skus : [];
  const out = [];
  for (const item of list) {
    const key = String((item && item.key) || '');
    if (!key) continue;
    out.push({
      key,
      label: clean(item.label, 120),
      sourceImageUrl: String((item && item.imageUrl) || ''),
      facts: extractFacts(product && product.attributes),
    });
  }
  if (out.length) return out;
  return [{ key: 'default', label: '产品级', sourceImageUrl: '', facts: extractFacts(product && product.attributes) }];
}

function uniqueUrls(list) {
  const seen = new Set();
  const out = [];
  for (const value of list) {
    const v = String(value == null ? '' : value).trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function clean(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

export function directPromptInfo() {
  return Object.freeze({
    version: DIRECT_PROMPT_VERSION,
    slots: SLOT_BLUEPRINTS.length,
    forbiddenItems: FORBIDDEN_ITEMS.length,
    requiresVision: false,
  });
}
