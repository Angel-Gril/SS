import { normalizeSourceStandardAttributes } from './source-standard-attributes';
import {
  buildBuiltInSizeChartRows,
  getBuiltInSizeChartTemplateByKey,
  matchBuiltInSizeChartTemplate,
  type BuiltInSizeChartMappingProfile,
  type BuiltInSizeChartTemplateKey,
} from './source-size-chart-template-catalog';

export type SourceRichContentTemplateKey =
  | BuiltInSizeChartTemplateKey
  | 'general_product';

export type SourceSizeChartStatus =
  | 'mapped'
  | 'ready'
  | 'attribute_only'
  | 'universal'
  | 'missing';

export type SourceSizeChartMappingProfile =
  | BuiltInSizeChartMappingProfile
  | 'none';

export interface SourceSizeChartRow {
  size: string;
  ruSize?: string;
  intSize?: string;
  footLengthCm?: string;
  note?: string;
  [key: string]: string | undefined;
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
  const matched = matchBuiltInSizeChartTemplate(ctx);
  if (matched) return { templateKey: matched.key, templateLabel: matched.label, confidence: matched.confidence };
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

function buildMappedRows(
  sizes: string[],
  profile: SourceSizeChartMappingProfile,
): { columns: string[]; rows: SourceSizeChartRow[] } {
  if (profile === 'none') return { columns: [], rows: [] };
  return buildBuiltInSizeChartRows(sizes, profile);
}

function mappingProfileForTemplate(templateKey: SourceRichContentTemplateKey): SourceSizeChartMappingProfile {
  if (templateKey === 'general_product') return 'none';
  return getBuiltInSizeChartTemplateByKey(templateKey)?.profile || 'none';
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
