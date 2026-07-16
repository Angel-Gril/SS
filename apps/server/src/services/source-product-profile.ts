import { createHash } from 'crypto';
import type { SourceCaptureEvidence, SourceProductCaptureV2 } from 'shared';

export const SOURCE_PRODUCT_PROFILE_VERSION = 'source-product-profile-v1';

export type SourceProductProfileConfidence = 'low' | 'medium' | 'high';
export type SourcePackagingStatus = 'complete' | 'weight_only' | 'dimensions_only' | 'partial' | 'missing';

export interface SourceProductProfileItem {
  id?: string | null;
  title?: string | null;
  sourcePlatform?: string | null;
  sourceProductId?: string | null;
  metadata?: unknown;
  variants?: unknown;
}

export interface SourcePackagingProfile {
  rowCount: number;
  hasWeight: boolean;
  hasDimensions: boolean;
  status: SourcePackagingStatus;
  reasonCode: string;
  reasonLabel: string;
  evidence: {
    source: string;
    sectionFound: boolean;
    tableLike: boolean;
    rowCount: number;
    hasWeight: boolean;
    hasDimensions: boolean;
    status: string;
    reason: string;
  };
  missing: string[];
  warnings: string[];
  sampleRows: Array<Record<string, unknown>>;
}

export interface SourceTextEvidenceProfile {
  description: string;
  richContentSummary: string;
  detailImageCount: number;
  hasDescription: boolean;
  hasRichText: boolean;
  sourceDescriptionRawLength: number;
}

export interface SourceImageEvidenceProfile {
  mainImageCount: number;
  detailImageCount: number;
  variantImageCount: number;
  hasMainImages: boolean;
  hasDetailImages: boolean;
  hasVariantImages: boolean;
}

export interface SourceVariantEvidenceProfile {
  variantCount: number;
  optionNames: string[];
  optionValues: Record<string, string[]>;
  hasVariantSku: boolean;
  sampleSkus: string[];
}

export interface SourceProductProfile {
  version: string;
  hash: string;
  itemId: string;
  sourcePlatform: string;
  sourceProductId: string;
  sourceTitle: string;
  categoryPath: string[];
  categoryName: string;
  categoryHints: string[];
  productIntentTerms: string[];
  productTypeHints: string[];
  colors: string[];
  sizes: string[];
  materials: string[];
  genderSeasonHints: string[];
  imageEvidence: SourceImageEvidenceProfile;
  variantEvidence: SourceVariantEvidenceProfile;
  packaging: SourcePackagingProfile;
  textEvidence: SourceTextEvidenceProfile;
  quality: {
    confidence: SourceProductProfileConfidence;
    missing: string[];
    warnings: string[];
  };
}

export interface SourceProductCaptureProfile extends SourceProductProfile {
  capture: {
    version: SourceProductCaptureV2['captureVersion'];
    hash: string;
    provenanceMode: SourceProductCaptureV2['provenanceMode'];
    completenessStatus: SourceProductCaptureV2['completeness']['status'];
    hasEstimatedValues: boolean;
    truncationCount: number;
    facts: {
      stock: { known: number; unknown: number; zero: number };
      shippingCny: Pick<SourceCaptureEvidence, 'value' | 'missingReason' | 'sourceType' | 'isEstimated'>;
      packageWeightG: Pick<SourceCaptureEvidence, 'value' | 'missingReason' | 'sourceType' | 'isEstimated'>;
    };
  };
}

const URL_RE = /https?:\/\/\S+|\/\/\S+/gi;
const IMAGE_FILE_RE = /\b[\w.-]+\.(?:jpg|jpeg|png|webp|gif)(?:\?\S*)?/gi;

function cleanText(value: unknown, maxLength = 500): string {
  const text = String(value ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, maxLength) : '';
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function unique(values: string[], maxLength = 40): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values.map((item) => cleanText(item, 160)).filter(Boolean)) {
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= maxLength) break;
  }
  return out;
}

function decodeBasicHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

export function cleanSourceProfileText(value: unknown, maxLength = 1200): string {
  let text = String(value || '').normalize('NFKC');
  if (!text) return '';
  text = text
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<img\b[^>]*\balt=["']?([^"'>\s][^"'>]*)["']?[^>]*>/gi, ' $1 ')
    .replace(/<img\b[^>]*>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>|<\/div>|<\/li>|<\/tr>|<\/h[1-6]>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(URL_RE, ' ')
    .replace(IMAGE_FILE_RE, ' ');
  text = cleanText(decodeBasicHtmlEntities(text), maxLength);
  return text.slice(0, maxLength);
}

function splitValueList(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => splitValueList(item));
  const text = cleanText(value, 1000);
  if (!text) return [];
  return text.split(/[,，、;；|]+|\s{2,}/)
    .map((part) => cleanText(part, 120))
    .filter(Boolean);
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return unique(value.map((item) => cleanText(item, 160)).filter(Boolean));
}

function attributeValues(meta: Record<string, unknown>, nameRe: RegExp): string[] {
  const attrs = Array.isArray(meta.sourceAttributes)
    ? meta.sourceAttributes
    : Array.isArray(meta.attributes)
      ? meta.attributes
      : [];
  const out: string[] = [];
  for (const item of attrs) {
    const row = metadataRecord(item);
    const name = cleanText(row.name ?? row.key ?? row.attrName ?? row.title, 160);
    if (!name || !nameRe.test(name)) continue;
    out.push(...splitValueList(row.value ?? row.attrValue ?? row.text ?? row.content));
  }
  return unique(out);
}

function categoryPathFromMeta(meta: Record<string, unknown>): string[] {
  const value = meta.categoryPath;
  if (Array.isArray(value)) return unique(value.map((item) => cleanText(item, 160)).filter(Boolean), 8);
  if (typeof value === 'string') {
    return unique(value.split(/>|\/|»|›|,/).map((part) => cleanText(part, 160)).filter(Boolean), 8);
  }
  return [];
}

function sourceStandard(meta: Record<string, unknown>): Record<string, unknown> {
  return metadataRecord(meta.sourceStandardAttributes ?? meta.standardAttributes);
}

function profileCategoryHints(meta: Record<string, unknown>, categoryPath: string[], categoryName: string): string[] {
  const standard = sourceStandard(meta);
  return unique([
    ...categoryPath,
    categoryName,
    ...readStringArray(standard.categoryHints),
  ].filter(Boolean), 20);
}

function buildProductIntent(input: {
  sourceTitle: string;
  categoryPath: string[];
  categoryName: string;
  categoryHints: string[];
}): { productIntentTerms: string[]; productTypeHints: string[] } {
  const haystack = [
    input.sourceTitle,
    input.categoryName,
    ...input.categoryPath,
    ...input.categoryHints,
  ].join(' ').toLocaleLowerCase();

  const hasExplicitBra = /(文胸|胸罩|抹胸|бра|бюстгальтер|bralette|bra\b)/i.test(haystack);
  const hasUnderwear = hasExplicitBra || /(女士内衣|内衣|内裤|бел[ьея]|нижнее\s+белье|lingerie|underwear)/i.test(haystack);
  const hasSleepwear = /(睡衣|睡裙|睡袍|睡裤|家居服|ночн|сорочк|пижам|халат|nightdress|nightgown|sleepwear|pajama)/i.test(haystack);
  const hasBedding = /(床上用品|床单|被套|被罩|床笠|постельн|простын|наматрасник|bedding|bedsheet)/i.test(haystack);
  const hasAdultGoods = /(成人用品|情趣用品|性玩具|товары\s+для\s+взросл|секс\s+игруш|adult\s+goods|sex\s+toy)/i.test(haystack);
  const hasApparel = hasUnderwear || hasSleepwear || /(服饰|服装|女装|男装|одежд|apparel|clothing)/i.test(haystack);

  const terms: string[] = [];
  const hints: string[] = [];
  if (hasExplicitBra && !hasSleepwear) {
    terms.push('bra', 'underwear', 'apparel');
    hints.push('bra');
  } else if (hasExplicitBra) {
    terms.push('bra');
    hints.push('bra');
  }
  if (hasUnderwear && !terms.includes('underwear')) {
    terms.push('underwear');
    hints.push('underwear');
  }
  if (hasSleepwear) {
    terms.push('sleepwear');
    hints.push('sleepwear');
    if (/(睡裙|сорочк|nightdress|nightgown)/i.test(haystack)) {
      terms.push('nightdress');
      hints.push('nightdress');
    }
  }
  if (hasBedding) {
    terms.push('bedding', 'home_textile');
    hints.push('bedding');
  }
  if (hasAdultGoods) {
    terms.push('adult_goods');
    hints.push('adult_goods');
  }
  if (hasApparel && !terms.includes('apparel')) terms.push('apparel');
  return {
    productIntentTerms: unique(terms, 20),
    productTypeHints: unique(hints, 20),
  };
}

function normalizePackagingRows(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  const rows: Array<Record<string, unknown>> = [];
  for (const item of value) {
    const row = metadataRecord(item);
    if (!Object.keys(row).length) continue;
    const next: Record<string, unknown> = {};
    for (const key of ['color', 'size', 'spec', 'specText'] as const) {
      const text = cleanText(row[key], 120);
      if (text) next[key] = text;
    }
    for (const key of ['weightG', 'lengthMm', 'widthMm', 'heightMm', 'volumeCm3'] as const) {
      const number = finiteNumber(row[key]);
      if (number != null) next[key] = number;
    }
    if (Object.keys(next).length) rows.push(next);
    if (rows.length >= 50) break;
  }
  return rows;
}

function packageDimensionsFromStandard(standard: Record<string, unknown>, meta: Record<string, unknown>): boolean {
  const dims = metadataRecord(standard.packageDimensionsMm);
  if (finiteNumber(dims.length) && finiteNumber(dims.width) && finiteNumber(dims.height)) return true;
  return !!(finiteNumber(meta.lengthMm) && finiteNumber(meta.widthMm) && finiteNumber(meta.heightMm));
}

function boolValue(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function packagingReason(input: {
  status: SourcePackagingStatus;
  diagnostics: Record<string, unknown>;
  rows: Array<Record<string, unknown>>;
  hasWeight: boolean;
  hasDimensions: boolean;
}): { reasonCode: string; reasonLabel: string } {
  const diagnosticStatus = cleanText(input.diagnostics.status, 80);
  const diagnosticReason = cleanText(input.diagnostics.reason, 120);
  const diagnosticMessage = cleanText(input.diagnostics.message, 160);
  if (!input.rows.length && (diagnosticStatus === 'no_section' || diagnosticReason === 'page_no_packaging_table')) {
    return { reasonCode: 'no_packaging_table', reasonLabel: diagnosticMessage || '页面没有包装表' };
  }
  if (!input.rows.length && (diagnosticStatus === 'parse_failed' || diagnosticReason === 'table_parse_failed')) {
    return { reasonCode: 'packaging_table_parse_failed', reasonLabel: diagnosticMessage || '有包装表但未解析出件重尺' };
  }
  if (input.status === 'complete') return { reasonCode: 'complete_rows', reasonLabel: '已采到包装重量和尺寸' };
  if (input.status === 'weight_only') return { reasonCode: 'weight_only', reasonLabel: '只采到重量，缺包装尺寸' };
  if (input.status === 'dimensions_only') return { reasonCode: 'dimensions_only', reasonLabel: '只采到包装尺寸，缺重量' };
  if (!input.rows.length) return { reasonCode: 'no_packaging_rows', reasonLabel: '未采集到包装信息' };
  return { reasonCode: 'partial_packaging', reasonLabel: '包装信息不完整' };
}

function buildPackagingProfile(meta: Record<string, unknown>): SourcePackagingProfile {
  const standard = sourceStandard(meta);
  const rows = normalizePackagingRows(meta.sourcePackagingRows);
  const diagnostics = metadataRecord(meta.extractionDiagnostics);
  const packagingDiagnostics = metadataRecord(diagnostics.packaging);
  const rowHasWeight = rows.some((row) => finiteNumber(row.weightG));
  const rowHasDimensions = rows.some((row) => (
    finiteNumber(row.lengthMm) && finiteNumber(row.widthMm) && finiteNumber(row.heightMm)
  ));
  const hasWeight = rowHasWeight || !!finiteNumber(standard.packageWeightG) || !!finiteNumber(meta.weightG);
  const hasDimensions = rowHasDimensions || packageDimensionsFromStandard(standard, meta);
  const missing: string[] = [];
  const warnings: string[] = [];
  if (!hasWeight) missing.push('package_weight');
  if (!hasDimensions) missing.push('package_dimensions');
  if (!rows.length) warnings.push('No source packaging rows were collected');
  if (rows.length && hasWeight && !hasDimensions) warnings.push('Source packaging rows contain weight but no package dimensions');
  if (rows.length && !hasWeight && hasDimensions) warnings.push('Source packaging rows contain dimensions but no weight');

  let status: SourcePackagingStatus = 'partial';
  if (hasWeight && hasDimensions) status = 'complete';
  else if (hasWeight && !hasDimensions) status = 'weight_only';
  else if (!hasWeight && hasDimensions) status = 'dimensions_only';
  else if (!rows.length) status = 'missing';
  const reason = packagingReason({ status, diagnostics: packagingDiagnostics, rows, hasWeight, hasDimensions });
  if (status !== 'complete' && reason.reasonLabel) warnings.push(reason.reasonLabel);

  return {
    rowCount: rows.length,
    hasWeight,
    hasDimensions,
    status,
    reasonCode: reason.reasonCode,
    reasonLabel: reason.reasonLabel,
    evidence: {
      source: Object.keys(packagingDiagnostics).length ? 'extraction_diagnostics' : rows.length ? 'source_packaging_rows' : 'source_metadata',
      sectionFound: boolValue(packagingDiagnostics.sectionFound),
      tableLike: boolValue(packagingDiagnostics.tableLike),
      rowCount: Number(packagingDiagnostics.rowCount ?? rows.length) || rows.length,
      hasWeight: boolValue(packagingDiagnostics.hasWeight) || hasWeight,
      hasDimensions: boolValue(packagingDiagnostics.hasDimensions) || hasDimensions,
      status: cleanText(packagingDiagnostics.status, 80),
      reason: cleanText(packagingDiagnostics.reason, 120),
    },
    missing,
    warnings,
    sampleRows: rows.slice(0, 5),
  };
}

function collectRichTextParts(value: unknown, out: string[], seen: Set<string>): void {
  if (out.join(' ').length >= 1200) return;
  if (typeof value === 'string' || typeof value === 'number') {
    const text = cleanSourceProfileText(value, 400);
    if (text && !seen.has(text)) {
      seen.add(text);
      out.push(text);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectRichTextParts(item, out, seen);
    return;
  }
  const record = metadataRecord(value);
  if (!Object.keys(record).length) return;
  for (const key of ['text', 'content', 'description', 'title', 'value'] as const) {
    if (record[key]) collectRichTextParts(record[key], out, seen);
  }
  for (const key of ['blocks', 'children', 'items', 'nodes'] as const) {
    if (record[key]) collectRichTextParts(record[key], out, seen);
  }
}

export function summarizeSourceRichContentDraft(value: unknown, maxLength = 1200): string {
  const parts: string[] = [];
  collectRichTextParts(value, parts, new Set<string>());
  return parts.join(' ').slice(0, maxLength);
}

function buildTextEvidence(meta: Record<string, unknown>): SourceTextEvidenceProfile {
  const rawDescription = String(meta.description ?? meta.sourceDescription ?? meta.sourceDescriptionRaw ?? '');
  const description = cleanSourceProfileText(rawDescription);
  const richContentSummary = summarizeSourceRichContentDraft(meta.sourceRichContentDraft)
    || cleanSourceProfileText(meta.sourceRichContentDraftSummary);
  const diagnostics = metadataRecord(meta.extractionDiagnostics);
  const detailImageCount = Array.isArray(meta.sourceDetailImages)
    ? meta.sourceDetailImages.length
    : Number(diagnostics.detailImageCount || diagnostics.detailImages || 0) || 0;
  return {
    description,
    richContentSummary,
    detailImageCount,
    hasDescription: !!description,
    hasRichText: !!richContentSummary,
    sourceDescriptionRawLength: rawDescription.length,
  };
}

function normalizeImageEvidenceList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return unique(value.map((item) => cleanText(item, 500)).filter((item) => /^https?:\/\//i.test(item)), 100);
}

function variantRows(item: SourceProductProfileItem, meta: Record<string, unknown>): Array<Record<string, unknown>> {
  const source = Array.isArray(item.variants)
    ? item.variants
    : Array.isArray(meta.variants)
      ? meta.variants
      : Array.isArray(meta.skuItems)
        ? meta.skuItems
        : [];
  return source.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object' && !Array.isArray(entry));
}

function buildImageEvidence(item: SourceProductProfileItem, meta: Record<string, unknown>): SourceImageEvidenceProfile {
  const variants = variantRows(item, meta);
  const mainImageCount = normalizeImageEvidenceList(meta.sourceMainImages ?? meta.images).length;
  const detailImageCount = normalizeImageEvidenceList(meta.sourceDetailImages).length;
  const variantImageCount = variants.reduce((count, variant) => {
    const images = normalizeImageEvidenceList(variant.images ?? variant.imageUrls ?? variant.pictures);
    return count + images.length;
  }, 0);
  return {
    mainImageCount,
    detailImageCount,
    variantImageCount,
    hasMainImages: mainImageCount > 0,
    hasDetailImages: detailImageCount > 0,
    hasVariantImages: variantImageCount > 0,
  };
}

function variantAttrs(row: Record<string, unknown>): Record<string, unknown> {
  const attrs = metadataRecord(row.attrs ?? row.attributes ?? row.properties);
  if (Object.keys(attrs).length) return attrs;
  const out: Record<string, unknown> = {};
  for (const key of ['color', '颜色', 'colour', 'size', '尺码', 'spec', '规格'] as const) {
    if (row[key] != null) out[key] = row[key];
  }
  return out;
}

function buildVariantEvidence(item: SourceProductProfileItem, meta: Record<string, unknown>): SourceVariantEvidenceProfile {
  const rows = variantRows(item, meta);
  const optionValues: Record<string, string[]> = {};
  const optionNames: string[] = [];
  const sampleSkus: string[] = [];
  let hasVariantSku = false;

  for (const row of rows) {
    const sku = cleanText(row.sku ?? row.skuId ?? row.offerId, 120);
    if (sku) {
      hasVariantSku = true;
      if (sampleSkus.length < 8 && !sampleSkus.includes(sku)) sampleSkus.push(sku);
    }
    for (const [rawName, rawValue] of Object.entries(variantAttrs(row))) {
      const name = cleanText(rawName, 80);
      const values = splitValueList(rawValue);
      if (!name || !values.length) continue;
      if (!optionNames.includes(name)) optionNames.push(name);
      optionValues[name] = unique([...(optionValues[name] || []), ...values], 20);
    }
  }

  return {
    variantCount: rows.length,
    optionNames: optionNames.slice(0, 20),
    optionValues,
    hasVariantSku,
    sampleSkus,
  };
}

function buildGenderSeasonHints(standard: Record<string, unknown>, meta: Record<string, unknown>): string[] {
  const hints: string[] = [];
  const gender = metadataRecord(standard.gender);
  const genderValue = cleanText(gender.value ?? gender.raw);
  if (genderValue) hints.push(genderValue);
  hints.push(...readStringArray(standard.seasons));
  if (!hints.length) {
    hints.push(...attributeValues(meta, /性别|gender/i));
    hints.push(...attributeValues(meta, /季节|season/i));
  }
  return unique(hints, 20);
}

function buildQuality(input: {
  sourceTitle: string;
  categoryPath: string[];
  colors: string[];
  sizes: string[];
  materials: string[];
  packaging: SourcePackagingProfile;
  textEvidence: SourceTextEvidenceProfile;
}): SourceProductProfile['quality'] {
  const missing = [...input.packaging.missing];
  const warnings = [...input.packaging.warnings];
  if (!input.sourceTitle) missing.push('source_title');
  if (!input.categoryPath.length) missing.push('source_category');
  if (!input.colors.length) missing.push('colors');
  if (!input.sizes.length) missing.push('sizes');
  if (!input.materials.length) missing.push('materials');
  if (!input.textEvidence.hasDescription && !input.textEvidence.hasRichText) {
    missing.push('source_description');
    warnings.push('No source description or rich text evidence was collected');
  }

  let score = 0;
  if (input.sourceTitle) score += 1;
  if (input.categoryPath.length) score += 1;
  if (input.colors.length && input.sizes.length && input.materials.length) score += 1;
  if (input.packaging.hasWeight && input.packaging.hasDimensions) score += 2;
  else if (input.packaging.hasWeight || input.packaging.hasDimensions) score += 1;
  if (input.textEvidence.hasDescription || input.textEvidence.hasRichText) score += 1;

  const confidence: SourceProductProfileConfidence = score >= 5 ? 'high' : score >= 2 ? 'medium' : 'low';
  return { confidence, missing: unique(missing, 40), warnings: unique(warnings, 40) };
}

function profileHash(value: Omit<SourceProductProfile, 'hash'>): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function buildSourceProductProfile(item: SourceProductProfileItem): SourceProductProfile {
  const meta = metadataRecord(item.metadata);
  const standard = sourceStandard(meta);
  const sourceTitle = cleanText(meta.sourceTitleRaw || item.title, 300);
  const categoryPath = categoryPathFromMeta(meta);
  const categoryName = cleanText(meta.categoryName || categoryPath[categoryPath.length - 1], 160);
  const categoryHints = profileCategoryHints(meta, categoryPath, categoryName);
  const intent = buildProductIntent({ sourceTitle, categoryPath, categoryName, categoryHints });
  const colors = readStringArray(standard.colors).length
    ? readStringArray(standard.colors)
    : attributeValues(meta, /颜色|色号|color|colour/i);
  const sizes = readStringArray(standard.sizes).length
    ? readStringArray(standard.sizes)
    : attributeValues(meta, /尺码|尺寸|size/i);
  const materials = readStringArray(standard.materials).length
    ? readStringArray(standard.materials)
    : attributeValues(meta, /面料|材质|成分|material|fabric|composition/i);
  const genderSeasonHints = buildGenderSeasonHints(standard, meta);
  const imageEvidence = buildImageEvidence(item, meta);
  const variantEvidence = buildVariantEvidence(item, meta);
  const packaging = buildPackagingProfile(meta);
  const textEvidence = buildTextEvidence(meta);
  const base: Omit<SourceProductProfile, 'hash'> = {
    version: SOURCE_PRODUCT_PROFILE_VERSION,
    itemId: cleanText(item.id, 80),
    sourcePlatform: cleanText(meta.sourcePlatform || item.sourcePlatform, 40),
    sourceProductId: cleanText(item.sourceProductId || meta.sourceProductId, 80),
    sourceTitle,
    categoryPath,
    categoryName,
    categoryHints,
    productIntentTerms: intent.productIntentTerms,
    productTypeHints: intent.productTypeHints,
    colors,
    sizes,
    materials,
    genderSeasonHints,
    imageEvidence,
    variantEvidence,
    packaging,
    textEvidence,
    quality: buildQuality({ sourceTitle, categoryPath, colors, sizes, materials, packaging, textEvidence }),
  };
  return { ...base, hash: profileHash(base) };
}

function valuesForCaptureAttributes(
  capture: SourceProductCaptureV2,
  pattern: RegExp,
): string[] {
  return unique(capture.attributes
    .filter((attribute) => pattern.test(attribute.name))
    .flatMap((attribute) => splitValueList(attribute.value)), 40);
}

function captureEvidenceSummary(evidence: SourceCaptureEvidence) {
  return {
    value: evidence.value,
    missingReason: evidence.missingReason,
    sourceType: evidence.sourceType,
    isEstimated: evidence.isEstimated,
  };
}

export function buildSourceProductProfileFromCapture(
  capture: SourceProductCaptureV2,
  options: { itemId?: string | null; captureHash: string },
): SourceProductCaptureProfile {
  const mainImages = capture.media
    .filter((media) => media.kind === 'image'
      && media.disposition === 'accepted'
      && media.role === 'product_main'
      && media.url)
    .map((media) => media.url as string);
  const detailImages = capture.media
    .filter((media) => media.kind === 'image'
      && media.disposition === 'accepted'
      && media.role === 'product_detail'
      && media.url)
    .map((media) => media.url as string);
  const colors = valuesForCaptureAttributes(capture, /颜色|色号|color|colour/i);
  const sizes = valuesForCaptureAttributes(capture, /尺码|尺寸|size/i);
  const materials = valuesForCaptureAttributes(capture, /面料|材质|成分|material|fabric|composition/i);
  const packagingRows = capture.packaging.map((row) => ({
    key: row.key,
    scope: row.scope,
    skuKeys: row.skuKeys,
    weightG: row.weightG,
    lengthMm: row.lengthMm,
    widthMm: row.widthMm,
    heightMm: row.heightMm,
  }));
  const base = buildSourceProductProfile({
    id: options.itemId,
    title: capture.facts.title,
    sourcePlatform: capture.platform,
    sourceProductId: capture.sourceIdentity.productId,
    metadata: {
      sourceTitleRaw: capture.facts.title,
      sourcePlatform: capture.platform,
      sourceProductId: capture.sourceIdentity.productId,
      categoryPath: capture.sourceCategory.path.map((node) => node.name),
      categoryName: capture.sourceCategory.name,
      sourceAttributes: capture.attributes.map((attribute) => ({
        name: attribute.name,
        value: attribute.value,
      })),
      sourceStandardAttributes: {
        colors,
        sizes,
        materials,
        categoryHints: capture.sourceCategory.path.map((node) => node.name),
        packageWeightG: capture.facts.packageWeightG,
        packageDimensionsMm: capture.facts.packageLengthMm != null
          && capture.facts.packageWidthMm != null
          && capture.facts.packageHeightMm != null
          ? {
            length: capture.facts.packageLengthMm,
            width: capture.facts.packageWidthMm,
            height: capture.facts.packageHeightMm,
          }
          : null,
      },
      sourcePackagingRows: packagingRows,
      sourceDescriptionRaw: capture.facts.description,
      sourceMainImages: mainImages,
      sourceDetailImages: detailImages,
      extractionDiagnostics: {
        packagingCount: packagingRows.length,
        descriptionFound: Boolean(capture.facts.description),
        captureVersion: capture.captureVersion,
        completeness: capture.completeness,
      },
    },
    variants: capture.skus.map((sku) => ({
      sku: sku.sourceSkuId || sku.key,
      attrs: Object.fromEntries(sku.attributes.map((attribute) => [attribute.name, attribute.value])),
      price: sku.priceCny,
      stock: sku.stock,
      images: capture.media
        .filter((media) => sku.mediaKeys.includes(media.key) && media.url)
        .map((media) => media.url),
    })),
  });
  const stock = capture.skus.reduce((summary, sku) => {
    if (sku.stock == null) summary.unknown += 1;
    else {
      summary.known += 1;
      if (sku.stock === 0) summary.zero += 1;
    }
    return summary;
  }, { known: 0, unknown: 0, zero: 0 });
  const captureProfile: SourceProductCaptureProfile['capture'] = {
    version: capture.captureVersion,
    hash: options.captureHash,
    provenanceMode: capture.provenanceMode,
    completenessStatus: capture.completeness.status,
    hasEstimatedValues: capture.completeness.hasEstimatedValues,
    truncationCount: capture.truncations.length,
    facts: {
      stock,
      shippingCny: captureEvidenceSummary(capture.fieldEvidence.shippingCny),
      packageWeightG: captureEvidenceSummary(capture.fieldEvidence.packageWeightG),
    },
  };
  const { hash: _legacyHash, ...withoutHash } = base;
  const value = { ...withoutHash, capture: captureProfile };
  return {
    ...value,
    hash: createHash('sha256').update(JSON.stringify(value)).digest('hex'),
  };
}
