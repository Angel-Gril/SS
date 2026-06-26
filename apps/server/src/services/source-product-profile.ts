import { createHash } from 'crypto';

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
  packaging: SourcePackagingProfile;
  textEvidence: SourceTextEvidenceProfile;
  quality: {
    confidence: SourceProductProfileConfidence;
    missing: string[];
    warnings: string[];
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

function buildPackagingProfile(meta: Record<string, unknown>): SourcePackagingProfile {
  const standard = sourceStandard(meta);
  const rows = normalizePackagingRows(meta.sourcePackagingRows);
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

  return {
    rowCount: rows.length,
    hasWeight,
    hasDimensions,
    status,
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
    packaging,
    textEvidence,
    quality: buildQuality({ sourceTitle, categoryPath, colors, sizes, materials, packaging, textEvidence }),
  };
  return { ...base, hash: profileHash(base) };
}
