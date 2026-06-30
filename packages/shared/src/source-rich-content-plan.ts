import { normalizeSourceStandardAttributes } from './source-standard-attributes';

export type SourceRichContentTemplateKey =
  | 'bra'
  | 'shoes_men'
  | 'shoes_women'
  | 'socks'
  | 'apparel_mens'
  | 'apparel_children'
  | 'apparel_underwear'
  | 'apparel_sleepwear'
  | 'apparel_general'
  | 'general_product';

export type SourceSizeChartStatus =
  | 'mapped'
  | 'ready'
  | 'attribute_only'
  | 'universal'
  | 'missing';

export type SourceSizeChartMappingProfile =
  | 'women_apparel'
  | 'men_apparel'
  | 'children_apparel'
  | 'underwear'
  | 'bra'
  | 'men_shoes'
  | 'women_shoes'
  | 'socks'
  | 'none';

export interface SourceSizeChartRow {
  size: string;
  ruSize?: string;
  intSize?: string;
  footLengthCm?: string;
  note?: string;
}

export interface SourceRichContentPlanModule {
  key: string;
  label: string;
  status: 'auto' | 'review' | 'skipped';
  evidence: string;
}

export interface SourceSizeChartPlan {
  status: SourceSizeChartStatus;
  label: string;
  mappingProfile: SourceSizeChartMappingProfile;
  tableColumns: string[];
  tableRows: SourceSizeChartRow[];
  normalizedSizes: string[];
  measurementEvidence: string[];
  richText: string;
  source: string;
  action: string;
}

export interface SourceRichContentPlan {
  templateKey: SourceRichContentTemplateKey;
  templateLabel: string;
  confidence: 'strong' | 'weak';
  sizeChart: SourceSizeChartPlan;
  modules: SourceRichContentPlanModule[];
}

interface SourceItemLike {
  title?: unknown;
  variants?: unknown;
  metadata?: Record<string, unknown> | null;
}

function text(value: unknown): string {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function metadataArray(item: SourceItemLike, key: string): unknown[] {
  const value = item.metadata?.[key];
  return Array.isArray(value) ? value : [];
}

function sourceAttributes(item: SourceItemLike): Array<Record<string, unknown>> {
  const value = item.metadata?.sourceAttributes;
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object' && !Array.isArray(entry))
    : [];
}

function attrName(attr: Record<string, unknown>): string {
  return text(attr.name ?? attr.key ?? attr.attributeName ?? attr.attrName);
}

function attrValue(attr: Record<string, unknown>): string {
  return text(attr.value ?? attr.attrValue ?? attr.text);
}

function contextText(item: SourceItemLike): string {
  return [
    item.title,
    item.metadata?.sourceTitleRaw,
    item.metadata?.categoryName,
    ...metadataArray(item, 'categoryPath'),
    item.metadata?.ozonCategoryName,
    item.metadata?.ozonTypeName,
    item.metadata?.categoryNameZh,
    item.metadata?.typeNameZh,
    item.metadata?.displayPathZh,
  ].map(text).filter(Boolean).join(' ');
}

function templateForItem(item: SourceItemLike): Pick<SourceRichContentPlan, 'templateKey' | 'templateLabel' | 'confidence'> {
  const ctx = contextText(item);
  if (/文胸|胸罩|bra|бюстгальтер/i.test(ctx)) {
    return { templateKey: 'bra', templateLabel: '文胸富内容模板', confidence: 'strong' };
  }
  if (/袜|袜子|丝袜|短袜|长袜|socks?|носк|колгот/i.test(ctx)) {
    return { templateKey: 'socks', templateLabel: '袜子/丝袜富内容模板', confidence: 'strong' };
  }
  if (/男鞋|男士鞋|男款鞋|мужск[а-я\s-]*обув|обув[а-я\s-]*муж/i.test(ctx)) {
    return { templateKey: 'shoes_men', templateLabel: '男鞋富内容模板', confidence: 'strong' };
  }
  if (/女鞋|单鞋|凉鞋|拖鞋|靴|鞋|shoe|обув/i.test(ctx)) {
    return { templateKey: 'shoes_women', templateLabel: '女鞋富内容模板', confidence: 'strong' };
  }
  if (/内衣|内裤|трус/i.test(ctx)) {
    return { templateKey: 'apparel_underwear', templateLabel: '内衣富内容模板', confidence: 'strong' };
  }
  if (/童装|儿童|宝宝|婴儿|男童|女童|детск|реб[её]н/i.test(ctx)) {
    return { templateKey: 'apparel_children', templateLabel: '童装富内容模板', confidence: 'strong' };
  }
  if (/男装|男士|男款|мужск/i.test(ctx)) {
    return { templateKey: 'apparel_mens', templateLabel: '男装富内容模板', confidence: 'strong' };
  }
  if (/睡裙|睡衣|家居服|ночная\s*сорочка|пижам/i.test(ctx)) {
    return { templateKey: 'apparel_sleepwear', templateLabel: '睡衣/睡裙富内容模板', confidence: 'strong' };
  }
  if (/服装|女装|男装|童装|连衣裙|上衣|裤|юбк|плать|одежд/i.test(ctx)) {
    return { templateKey: 'apparel_general', templateLabel: '服装通用富内容模板', confidence: 'weak' };
  }
  return { templateKey: 'general_product', templateLabel: '通用商品富内容模板', confidence: 'weak' };
}

function expandRawSizeTexts(value: string): string[] {
  const raw = text(value);
  if (!raw) return [];
  const parts = raw.split(/[、，;；]+/).map(text).filter(Boolean);
  return parts.length > 1 ? parts : [raw];
}

function collectRawSizeTexts(item: SourceItemLike): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    for (const value of expandRawSizeTexts(raw)) {
      if (!value || seen.has(value)) continue;
      seen.add(value);
      out.push(value);
    }
  };
  for (const attr of sourceAttributes(item)) {
    if (!/尺码|尺寸|规格|size|размер/i.test(attrName(attr))) continue;
    const value = attrValue(attr);
    add(value);
  }
  const variants = Array.isArray(item.variants) ? item.variants : item.metadata?.skuItems;
  if (Array.isArray(variants)) {
    for (const variant of variants) {
      if (!variant || typeof variant !== 'object' || Array.isArray(variant)) continue;
      const attrs = (variant as Record<string, unknown>).attrs;
      if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) continue;
      for (const [name, value] of Object.entries(attrs)) {
        if (!/尺码|尺寸|规格|size|размер/i.test(name)) continue;
        const raw = text(value);
        add(raw);
      }
    }
  }
  return out.slice(0, 12);
}

function normalizeSizeForRichContent(value: string): string {
  const raw = text(value);
  if (/均码|一码|free\s*size|one\s*size|универс/i.test(raw)) return 'Универсальный';
  const bra = raw.match(/\b(?:6[5-9]|[789]\d|10[0-5])\s*[A-ZА-Я]{1,3}\b/i)?.[0];
  if (bra) return text(bra).replace(/\s+/g, '').toUpperCase();
  const alphaPrefix = raw.match(/^(?:\d+\s*XL|XXXXL|XXXL|XXL|XL|XS|L|M|S)/i)?.[0];
  if (alphaPrefix) return text(alphaPrefix).replace(/^(\d+)\s+XL$/i, '$1XL').toUpperCase();
  const height = raw.match(/\b(7\d|8\d|9\d|1[0-6]\d)\s*(?:CM|cm|厘米|公分)\b/);
  if (height?.[1]) return height[1];
  const range = raw.match(/\b(\d{2,3})\s*(?:-|~|至|到)\s*(\d{2,3})\b/);
  if (range && !/斤|kg|公斤|千克/i.test(raw) && (/\d\s*(?:码|鞋码|欧码)|size|размер/i.test(raw) || /^\d{2}\s*(?:-|~|至|到)\s*\d{2}$/.test(raw))) {
    const from = range[1];
    const to = range[2];
    if (from && to) return `${from}-${to}`;
  }
  const prefix = raw.match(/^(?:\d+\s*XL|XXXXL|XXXL|XXL|XL|XS|L|M|S|\d{2,3}(?:[.,]\d+)?[A-ZА-Я]*)/i)?.[0];
  return text(prefix || raw).replace(/^(\d+)\s+XL$/i, '$1XL').toUpperCase();
}

function hasMeasurementEvidence(value: string): boolean {
  return /(?:\d{2,3}\s*[-~至]\s*\d{2,3}\s*斤|\d{2,3}\s*(?:\/|-)\s*\d{2,3}\s*[A-Z]{1,3}|\d{2,3}\s*[A-Z]{1,3}|胸围|腰围|臀围|杯|cm|厘米)/i.test(value);
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = text(raw);
    const key = value.toLocaleLowerCase('ru-RU');
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

const WOMEN_APPAREL_RU: Record<string, string> = {
  XS: '40',
  S: '42',
  M: '44',
  L: '46',
  XL: '48',
  XXL: '50',
  '2XL': '50',
  XXXL: '52',
  '3XL': '52',
};

const MEN_APPAREL_RU: Record<string, string> = {
  XS: '42',
  S: '44',
  M: '46',
  L: '48',
  XL: '50',
  XXL: '52',
  '2XL': '52',
  XXXL: '54',
  '3XL': '54',
  XXXXL: '56',
  '4XL': '56',
  XXXXXL: '58',
  '5XL': '58',
};

const UNDERWEAR_RU: Record<string, string> = {
  XS: '40',
  S: '42',
  M: '44',
  L: '46',
  XL: '48',
  XXL: '50',
  '2XL': '50',
  XXXL: '52',
  '3XL': '52',
};

const CHILDREN_HEIGHT_RU = new Set([
  '70', '74', '80', '86', '90', '92', '98', '100', '104', '110', '116', '120', '122',
  '128', '130', '134', '140', '146', '150', '152', '158', '160', '164',
]);

const WOMEN_SHOE_FOOT_LENGTH: Record<string, string> = {
  '34': '22',
  '35': '22.5',
  '36': '23',
  '37': '23.5',
  '38': '24',
  '39': '24.5',
  '40': '25',
  '41': '25.5',
  '42': '26',
};

const MEN_SHOE_FOOT_LENGTH: Record<string, string> = {
  '39': '24.5',
  '40': '25',
  '41': '25.5',
  '42': '26',
  '43': '26.5',
  '44': '27',
  '45': '27.5',
  '46': '28',
  '47': '28.5',
};

function sizeKey(value: string): string {
  return value.replace(/^(\d)\s*XL$/i, '$1XL').toUpperCase();
}

function buildMappedRows(
  sizes: string[],
  profile: SourceSizeChartMappingProfile,
): { columns: string[]; rows: SourceSizeChartRow[] } {
  const rows: SourceSizeChartRow[] = [];
  if (profile === 'women_shoes' || profile === 'men_shoes') {
    const footLengthTable = profile === 'men_shoes' ? MEN_SHOE_FOOT_LENGTH : WOMEN_SHOE_FOOT_LENGTH;
    for (const size of sizes) {
      const numeric = size.replace(',', '.').match(/\d{2}(?:\.\d)?/)?.[0] || '';
      if (!numeric) continue;
      rows.push({
        size: numeric,
        ruSize: numeric,
        footLengthCm: footLengthTable[numeric] || '',
      });
    }
    return {
      columns: ['尺码', '俄罗斯尺码', '脚长(cm)'],
      rows,
    };
  }

  if (profile === 'children_apparel') {
    for (const size of sizes) {
      const height = size.match(/\d{2,3}/)?.[0] || '';
      if (!height || !CHILDREN_HEIGHT_RU.has(height)) continue;
      rows.push({ size: height, ruSize: height, note: '童装身高尺码' });
    }
    return {
      columns: ['尺码', '俄罗斯尺码', '说明'],
      rows,
    };
  }

  if (profile === 'socks') {
    for (const size of sizes) {
      const range = size.match(/^(\d{2})-(\d{2})$/);
      if (!range) continue;
      const value = `${range[1]}-${range[2]}`;
      rows.push({ size: value, ruSize: value, note: '按鞋码范围选择' });
    }
    return {
      columns: ['尺码', '俄罗斯尺码', '说明'],
      rows,
    };
  }

  if (profile === 'bra') {
    for (const size of sizes) {
      if (!/^\d{2,3}[A-ZА-Я]{1,3}$/i.test(size)) continue;
      rows.push({ size, ruSize: size, note: '保留文胸围度/杯型体系' });
    }
    return {
      columns: ['尺码', '俄罗斯尺码', '说明'],
      rows,
    };
  }

  const table = profile === 'underwear'
    ? UNDERWEAR_RU
    : profile === 'men_apparel'
      ? MEN_APPAREL_RU
      : WOMEN_APPAREL_RU;
  for (const size of sizes) {
    const key = sizeKey(size);
    const ruSize = table[key];
    if (!ruSize) continue;
    rows.push({ size: key, ruSize, intSize: key });
  }
  return {
    columns: ['尺码', '俄罗斯尺码', '国际尺码'],
    rows,
  };
}

function mappingProfileForTemplate(templateKey: SourceRichContentTemplateKey): SourceSizeChartMappingProfile {
  if (templateKey === 'shoes_men') return 'men_shoes';
  if (templateKey === 'shoes_women') return 'women_shoes';
  if (templateKey === 'bra') return 'bra';
  if (templateKey === 'socks') return 'socks';
  if (templateKey === 'apparel_mens') return 'men_apparel';
  if (templateKey === 'apparel_children') return 'children_apparel';
  if (templateKey === 'apparel_underwear') return 'underwear';
  if (templateKey === 'apparel_sleepwear' || templateKey === 'apparel_general') return 'women_apparel';
  return 'none';
}

function buildSizeChartPlan(item: SourceItemLike): SourceSizeChartPlan {
  const template = templateForItem(item);
  const mappingProfile = mappingProfileForTemplate(template.templateKey);
  const standard = normalizeSourceStandardAttributes(item);
  const rawSizeTexts = collectRawSizeTexts(item);
  const normalizedSizes = unique((standard.sizes.length ? standard.sizes : rawSizeTexts).map(normalizeSizeForRichContent));
  const measurementEvidence = rawSizeTexts.filter(hasMeasurementEvidence).slice(0, 8);
  const hasUniversal = normalizedSizes.some((size) => size === 'Универсальный');
  const mapped = mappingProfile === 'none'
    ? { columns: [], rows: [] }
    : buildMappedRows(normalizedSizes, mappingProfile);

  if (hasUniversal) {
    return {
      status: 'universal',
      label: '均码/通用尺码',
      mappingProfile: 'none',
      tableColumns: ['尺码', '说明'],
      tableRows: [{ size: 'Универсальный', note: '均码/通用尺码' }],
      normalizedSizes: ['Универсальный'],
      measurementEvidence,
      richText: measurementEvidence.length
        ? `Универсальный размер. Ориентир поставщика: ${measurementEvidence.join('; ')}.`
        : 'Универсальный размер. Подходит для моделей без отдельной размерной сетки.',
      source: rawSizeTexts.length ? '源尺码属性/SKU' : '标准属性',
      action: '发布属性使用 Универсальный；不换算成具体俄罗斯尺码',
    };
  }

  if (mapped.rows.length) {
    return {
      status: 'mapped',
      label: measurementEvidence.length ? '源尺码证据 + 内置映射表' : '内置映射表',
      mappingProfile,
      tableColumns: mapped.columns,
      tableRows: mapped.rows,
      normalizedSizes,
      measurementEvidence,
      richText: measurementEvidence.length
        ? `Размеры: ${measurementEvidence.join('; ')}. Таблица размеров создана по встроенному соответствию.`
        : `Таблица размеров создана по встроенному соответствию: ${mapped.rows.map((row) => `${row.size} - ${row.ruSize || row.footLengthCm || row.note}`).join('; ')}.`,
      source: measurementEvidence.length ? '源尺码属性/SKU + 内置映射表' : '内置映射表',
      action: '发布时会自动生成尺码表图片，建议发布前快速复核',
    };
  }

  if (measurementEvidence.length) {
    return {
      status: 'ready',
      label: '可生成尺码说明',
      mappingProfile: 'none',
      tableColumns: ['尺码说明'],
      tableRows: measurementEvidence.map((value) => ({ size: value })),
      normalizedSizes,
      measurementEvidence,
      richText: `Размеры: ${measurementEvidence.join('; ')}.`,
      source: '源尺码属性/SKU',
      action: '可自动加入富内容尺码说明，发布前建议快速复核',
    };
  }

  if (normalizedSizes.length) {
    return {
      status: 'attribute_only',
      label: '只有尺码属性',
      mappingProfile: 'none',
      tableColumns: [],
      tableRows: [],
      normalizedSizes,
      measurementEvidence: [],
      richText: `Доступные размеры: ${normalizedSizes.join(', ')}.`,
      source: rawSizeTexts.length ? '源尺码属性/SKU' : '标准属性',
      action: '发布属性可用；缺少胸围/腰围/衣长等测量值，不生成详细尺码表',
    };
  }

  return {
    status: 'missing',
    label: '未识别尺码',
    mappingProfile: 'none',
    tableColumns: [],
    tableRows: [],
    normalizedSizes: [],
    measurementEvidence: [],
    richText: '',
    source: '缺失',
    action: '补充尺码或确认该类目是否允许无尺码发布',
  };
}

function buildModules(item: SourceItemLike, sizeChart: SourceSizeChartPlan): SourceRichContentPlanModule[] {
  const standard = normalizeSourceStandardAttributes(item);
  const detailImageCount = metadataArray(item, 'sourceDetailImages').length;
  return [
    {
      key: 'overview',
      label: '商品简介',
      status: 'auto',
      evidence: '使用 AI 俄语描述和商品画像生成',
    },
    {
      key: 'material',
      label: '材质/成分',
      status: standard.materials.length ? 'auto' : 'review',
      evidence: standard.materials.length ? standard.materials.join(' / ') : '源属性未识别材质',
    },
    {
      key: 'size_note',
      label: '尺码说明',
      status: sizeChart.status === 'missing' ? 'skipped' : (sizeChart.status === 'ready' ? 'review' : 'auto'),
      evidence: sizeChart.label,
    },
    {
      key: 'detail_images',
      label: '详情图',
      status: detailImageCount ? 'auto' : 'skipped',
      evidence: detailImageCount ? `采集详情图 ${detailImageCount} 张` : '未采集详情图',
    },
  ];
}

export function buildSourceRichContentPlan(item: SourceItemLike): SourceRichContentPlan {
  const template = templateForItem(item);
  const sizeChart = buildSizeChartPlan(item);
  return {
    ...template,
    sizeChart,
    modules: buildModules(item, sizeChart),
  };
}
