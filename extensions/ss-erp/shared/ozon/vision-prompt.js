// 视觉分析提示词 —— 移植自精铺快照（_extract/jp20260803/ui/modules/prompts.js）
//
// 精铺的形态很关键：视觉只跑**一次**，产出一份结构化报告，然后同时喂给
//   ① 标题/描述/搜索标签   ② 属性观察   ③ 生图提示词计划
// 而不是像我们之前那样「点一次按钮、只喂标题」。
//
// 这里保留它的输出契约（中文键名），只把入参适配成本扩展的采集结构：
//   rawData  ≈ { sku_matrix: [{ rowIndex, skuLabel, specs:{color_name_cn,size_name_cn} }] }
//   aiSchema ≈ { categoryTitle, fields:[{label,description,options[]}] }
//
// 上游：pages/donor/direct-lane-panel.js 的「视觉描述」
// 下游：标题（title-ai.js）、属性观察（回填）、生图提示词（待接）

// 与精铺 fill-rules.js 对齐：28 个标签、每个 ≤28 字符、取前 20 个作为搜索词
const REQUIRED_TAG_COUNT = 28;
const SEARCH_TAG_COUNT = 20;
const TAG_MAX_LENGTH = 28;

/** 只保留前 N 个字段，避免把 53 个官方字段整份塞进提示词 */
function summarizeFields(fields) {
  return (Array.isArray(fields) ? fields : []).slice(0, 10).map((field) => {
    const result = { label: String(field.label || field.name || '') };
    const description = String(field.description || '');
    if (description) result.desc = description.length > 80 ? description.slice(0, 80) + '...' : description;
    const options = (Array.isArray(field.options) ? field.options : []).slice(0, 3)
      .map((option) => String((option && option.value) || option || '')).filter(Boolean);
    if (options.length) result.sample_options = options;
    return result;
  }).filter((one) => one.label);
}

/**
 * @param {object} input
 *   product  { title, skus:[{ label, color, size }] }
 *   fields   官方属性字段（{name,description,options}）
 *   categoryTitle
 * @returns {string} 提示词
 */
export function buildVisionPrompt({ product, fields, categoryTitle }) {
  const skus = Array.isArray(product && product.skus) ? product.skus : [];
  const totalCount = skus.length;
  const lines = skus.map((sku, index) => (
    `[SKU Row ${index + 1}] ${sku.label || '-'} | color=${sku.color || '-'} | size=${sku.size || '-'}`
  )).join('\n');

  const schemaFields = summarizeFields(fields);
  const schemaSection = schemaFields.length
    ? [
      '',
      '【需观察属性】',
      `类目：${categoryTitle || ''}`,
      '以下字段需要根据图片判断；无法判断时直接留空。',
      JSON.stringify(schemaFields, null, 2),
      '请把观察结果输出到 JSON 的 "属性观察" 中。',
    ].join('\n')
    : '';

  const outputTemplate = {
    视觉总结: '概括商品外观、用途、材质、颜色、包装和使用场景',
    核心卖点: [],
    材质判断: '',
    工艺判断: '',
    包装内容判断: [],
    SKU差异: '说明各 SKU 的视觉差异，不要自行重命名规格',
    尺寸标注: '如图片出现数值或尺寸表，原样记录',
    文字备注: '记录图片中可见文字信息',
    ...(schemaFields.length ? { 属性观察: {} } : {}),
  };

  return [
    '你是跨境电商商品图片分析助手。',
    '请根据图片生成可用于商品标题、简介、属性填充和搜索标签的视觉判断。',
    '所有结论必须来自图片可见信息，不要臆测无法直接查看的内容。',
    '',
    `主题标签要求：生成 ${REQUIRED_TAG_COUNT} 个俄文搜索标签，最终可截取前 ${SEARCH_TAG_COUNT} 个；每个标签不超过 ${TAG_MAX_LENGTH} 个字符。`,
    '重点分析：商品外观与用途、材质和工艺、颜色和形状、包装内容、目标对象、使用场景。',
    'SKU 差异、尺寸标注、颜色判断必须绑定 [SKU Row] 的原始规格名；不要用 1 号/2 号、大号/小号重新编号。',
    '',
    '【输出结构】',
    JSON.stringify(outputTemplate, null, 2),
    schemaSection,
    '',
    `【SKU 表】共 ${totalCount} 个：`,
    lines,
  ].join('\n');
}

/** 视觉报告的字段约定，供调用方读取（与提示词的输出结构一一对应） */
export const VISION_REPORT_KEYS = Object.freeze([
  '视觉总结', '核心卖点', '材质判断', '工艺判断', '包装内容判断',
  'SKU差异', '尺寸标注', '文字备注', '属性观察',
]);

/** 宽松解析：模型可能带 ```json 包裹或解释文字 */
export function parseVisionReport(raw) {
  const text = String(raw || "");
  // 接受三种形状：
  //   1) 对象 {视觉总结: "...", 属性观察: {...}}
  //   2) 数组 [{name:"视觉总结", value:"..."}, ...]
  //   3) 包在 md 围栏里、带尾逗号的上面两种（模型常态）
  const arrayStart = text.indexOf("[");
  const objectStart = text.indexOf("{");
  const start = arrayStart >= 0 && (objectStart < 0 || arrayStart < objectStart) ? arrayStart : objectStart;
  const isArray = start === arrayStart && arrayStart >= 0;
  const end = text.lastIndexOf(isArray ? "]" : "}");
  if (start < 0 || end <= start) return null;
  const body = text.slice(start, end + 1);
  const attempts = [body, body.replace(/,\s*([}\]])/g, "$1")];
  let value = null;
  for (const candidate of attempts) {
    try { value = JSON.parse(candidate); break; } catch (_e) { value = null; }
  }
  if (value === null) return null;
  if (Array.isArray(value)) {
    const obj = {};
    for (const row of value) {
      if (row && typeof row === "object" && row.name) obj[String(row.name)] = row.value;
    }
    return Object.keys(obj).length ? obj : null;
  }
  return value && typeof value === "object" ? value : null;
}

/** 报告 → 标题生成用的属性对（优先用属性观察，其次视觉判断） */
export function visionReportToPairs(report) {
  const pairs = [];
  const push = (name, value) => {
    const text = String(value == null ? '' : value).trim();
    if (text) pairs.push({ name, value: text });
  };
  if (!report) return pairs;
  const observed = report['属性观察'] && typeof report['属性观察'] === 'object' ? report['属性观察'] : {};
  for (const [key, value] of Object.entries(observed)) push(key, Array.isArray(value) ? value.join(', ') : value);
  push('视觉总结', report['视觉总结']);
  push('材质', report['材质判断']);
  push('工艺', report['工艺判断']);
  if (Array.isArray(report['核心卖点']) && report['核心卖点'].length) {
    push('核心卖点', report['核心卖点'].slice(0, 4).join('; '));
  }
  const packing = Array.isArray(report['包装内容判断']) ? report['包装内容判断'].join(', ') : report['包装内容判断'];
  push('包装内容', packing);
  return pairs;
}
