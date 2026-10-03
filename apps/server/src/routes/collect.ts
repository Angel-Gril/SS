import { createHash } from 'crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate } from '../lib/auth.js';
import {
  assertLegacySourceOzonPublishAllowed,
  sourceWorkflowFeatureFlags,
  SourceWorkflowLegacyPublishError,
  type SourceCaptureRolloutStage,
  type SourceWorkflowFeatureDecision,
  type SourceWorkflowFeatureFlagEvaluator,
} from '../services/source-workflow-feature-flags.js';
import {
  getDefaultLegacySourceListingWorkflowAdapter,
  resolveLegacySourceListingCompatibility,
  sourceListingCompatibilityMetadata,
  type LegacySourceListingDraftPointer,
  type LegacySourceListingWorkflowAdapter,
} from './source-listing-workflow-compat.js';
import {
  assertSourceListingDraftIdentity,
  normalizeSourceListingDraftIdentityRefs,
  SourceListingDraftIdentityError,
} from '../services/source-listing-draft-identity.js';
import { findBrowserOneClickReviewProtectedSupplyGoodsIds } from '../services/browser-one-click-review-handoff.js';
import { prisma } from '../lib/prisma.js';
import { getRandomizeConfig, randomOfferIdFrom, jitterDimensionMm, bucketWeightG } from '../lib/randomize.js';
import { randomSuffix, chunkArray } from '../lib/util.js';
import { resolveCollectedPrice } from '../services/collect-pricing.js';
import { normalizeOzonPublishImageUrl, resolveImageUrls } from '../services/ozon-image-resolver.js';
import { isLikelyNonImageMediaUrl } from '../services/ozon-image-sanitizer.js';
import { convertOzonRawAttrs, isOzonVideoMediaAttributeId, shouldSkipOzonPublishAttr } from '../services/ozon-attributes.js';
import {
  createPrismaOzonAttributeDictionaryCacheStore,
  getCachedOzonAttributeValues,
} from '../services/ozon-attribute-dictionary-cache.js';
import {
  createPrismaOzonAttributeDefinitionCacheStore,
  getCachedOzonAttributeDefinitions,
  OzonAttributeDefinitionsRequiredError,
  type OzonAttributeDefinition,
} from '../services/ozon-attribute-definition-cache.js';
import {
  applyOzonCategoryCatalogLocalTranslations,
  buildOzonCategoryCatalog,
  buildMergedOzonCategoryCatalog,
  createPrismaOzonCategoryCatalogStore,
  deriveOzonCategoryCatalogRevision,
  enrichMissingOzonCategoryCatalogTranslations,
  searchOrRefreshOzonCategoryCatalogForShop,
  translateOzonCategoryText as translateOzonCategoryCatalogText,
  type OzonCategoryCatalogEntry,
  type OzonCategoryCatalogStore,
  type OzonCategoryTranslationStatus,
} from '../services/ozon-category-catalog.js';
import {
  deriveSourceOzonCategoryIdentity,
  SourceOzonCategoryMappingError,
  type CanonicalSourceOzonCategoryInput,
  type OfficialOzonCategoryTarget,
  type SourceOzonCategoryMappingRecord,
} from '../services/source-ozon-category-mapping.js';
import { SourceOzonCategoryContextError } from '../services/source-ozon-category-context.js';
import {
  createSourceWorkflowOzonClient,
  findSourceWorkflowOzonCredentialsUnavailableError,
} from '../services/source-workflow-ozon-client.js';
import { categoryTextScore, sourceCategorySearchTerms } from '../services/source-ozon-category-recommendation.js';
import {
  appendOzonRichContentAttribute,
  appendOzonSizeChartAttribute,
  buildOzonRichContentAttribute,
  buildOzonSizeChartAttribute,
  buildOzonVideoMediaAttributesFromSourceVideos,
  planCollectedVideoPublish,
  resolveOzonRichContentAttributeDef,
  resolveOzonSizeChartAttributeDef,
  transferRichContentImage,
  uploadGeneratedSizeChartImage,
} from '../services/ozon-rich-content.js';
import { enqueueProductSyncAfterPublish } from '../services/post-publish-sync.js';
import { getConfig } from '../config/system-config-schema.js';
import { generateAiText } from '../services/ai-text.js';
import { createPrismaAiTranslationCacheStore, getCachedAiTranslation } from '../services/ai-translation-cache.js';
import {
  createPrismaAiUsageStore,
  isUnknownAiOutcome,
  recordAiUsageEvent,
  reserveAiDailyLimit,
} from '../services/ai-usage.js';
import { generateProductContentDraft, type ProductContentField } from '../services/product-content-ai.js';
import { buildSourceProductProfile, type SourceProductProfile } from '../services/source-product-profile.js';
import { transferSourceProductImages } from '../services/source-image-transfer.js';
import { transferSourceProductVideos } from '../services/source-video-transfer.js';
import { parseCollectWatermarkInput } from '../services/image-processing-input.js';
import { formatOzonErrorMessage } from 'shared/ozon-error-hints';
import { normalizeSourceStandardAttributes, sanitizeSourceStandardSizeValues } from 'shared/source-standard-attributes';
import { buildSourceRichContentPlan } from 'shared/source-rich-content-plan';
import {
  cleanPublishName,
  containsCjkText,
  containsCyrillicText,
  containsRussianText,
  hasSuspiciousPublishName,
  lowercaseCyrillicVariantPart,
  normalizeProductId,
  resolveCollectedDisplayTitle,
  TITLE_STOP_WORDS,
  variantWordCount,
} from '../services/collect-title-normalizer.js';
export {
  cleanPublishName,
  containsCjkText,
  hasSuspiciousPublishName,
  resolveCollectedDisplayTitle,
} from '../services/collect-title-normalizer.js';

const DESCRIPTION_MAX_LENGTH = 5000;
const OZON_MAX_PUBLISH_IMAGES = 30;
const OZON_ORIGIN_COUNTRY_ATTR_ID = 4389;
const OZON_MARKING_CODE_REQUIRED_ATTR_ID = 23536;
const EPHEMERAL_LISTING_TTL_MS = 5 * 60 * 1000;
const WATERMARK_ITEM_CONCURRENCY = 3;
const OZON_MARKETING_WORD_RE = /(^|[^\p{L}\p{N}])(?:100%\s*оригинал\p{L}*|проверен\p{L}*|оригинал\p{L}*|original|verified|authentic)(?=$|[^\p{L}\p{N}])/giu;
const OZON_COLOR_TOKEN_RE = /^(?:бел|черн|красн|син|голуб|зел[её]н|желт|розов|фиолет|сер|беж|корич|хаки|бирюз|салатов|графит|серебрист|серебр|золот|оранж|бордов|молочн|крем|оливк|сиренев|лилов|изумруд|лаванд|мятн|пудров|коралл|терракот|персиков|бронз|сапфир|верблюд)\p{L}*$/iu;
const OZON_COLOR_PREFIX_RE = /^(?:светло|темно|тёмно|ярко|нежно|бледно|пастельно|дымчато)$/iu;
const OZON_COMPOUND_COLOR_PREFIX_RE = /^(?:бело|черно|чёрно|красно|сине|голубо|зелено|зелёно|желто|жёлто|розово|фиолетово|серо|бежево|коричнево|бирюзово|салатово|графитово|серебристо|золотисто|оранжево|бордово|молочно|кремово|оливково|сиренево|лилово|изумрудно|лавандово|мятно|пудрово|кораллово|терракотово|персиково|бронзово|винно)$/iu;
const OZON_COLOR_TAIL_RE = /^(?:сапфир|матов\p{L}*|глянцев\p{L}*|жемчуж\p{L}*|перламутр\p{L}*|металлик\p{L}*|металлическ\p{L}*|мрамор\p{L}*|меланж\p{L}*|карбон\p{L}*|неон\p{L}*|хамелеон\p{L}*)$/iu;
const OZON_COLOR_NOISE_RE = /^(?:хлопок|лен|лён|шерсть|кожа|замша|шелк|шёлк|сатин|атлас|полиэстер|вискоза|кашемир|акрил|для|на|с|со|и|по|из|от|к)$/iu;
const SOURCE_COLOR_TO_OZON: Array<[RegExp, string]> = [
  [/酒红|枣红|葡萄红/i, 'бордовый'],
  [/浅蓝|天蓝|湖蓝/i, 'голубой'],
  [/深蓝|藏青|宝蓝/i, 'синий'],
  [/米白|乳白|奶白|象牙白/i, 'молочный'],
  [/咖啡|棕|褐|驼/i, 'коричневый'],
  [/卡其/i, 'хаки'],
  [/米色|杏色|裸色|肤色/i, 'бежевый'],
  [/灰/i, 'серый'],
  [/白/i, 'белый'],
  [/黑/i, 'черный'],
  [/红/i, 'красный'],
  [/绿/i, 'зеленый'],
  [/蓝/i, 'синий'],
  [/黄/i, 'желтый'],
  [/粉/i, 'розовый'],
  [/紫/i, 'фиолетовый'],
  [/橙/i, 'оранжевый'],
];

const collectSchema = z.object({
  title: z.string().min(1),
  publishTitle: z.string().optional(),
  sourceTitleRaw: z.string().optional(),
  sourceLocale: z.string().optional(),
  sourceUrl: z.string().optional(),
  sourcePlatform: z.string().optional(),
  images: z.array(z.string()).optional(),
  sourceMainImages: z.array(z.string()).optional(),
  sourceDetailImages: z.array(z.string()).optional(),
  sourcePackagingRows: z.array(z.any()).optional(),
  sourceRichContentDraft: z.any().optional(),
  price: z.union([z.string(), z.number()]).optional(),
  priceText: z.string().optional(),
  unitPriceText: z.string().optional(),
  displayPrice: z.string().optional(),
  ladderPrices: z.array(z.any()).optional(),
  currency: z.string().optional(),
  categoryId: z.number().optional(),
  categoryName: z.string().optional(),
  categoryPath: z.array(z.string()).optional(),
  attributes: z.array(z.object({ id: z.number().optional(), name: z.string(), value: z.string() })).optional(),
  description: z.string().optional(),
  richDescriptionJson: z.string().optional(),
  sourceVideos: z.array(z.any()).optional(),
  descriptionFetchDiagnostics: z.any().optional(),
  descriptionFetchTrace: z.any().optional(),
  weight: z.number().optional(),
  weightG: z.number().optional(),
  lengthMm: z.number().optional(),
  widthMm: z.number().optional(),
  heightMm: z.number().optional(),
  shippingCny: z.number().optional(),
  totalCostCny: z.number().optional(),
  priceSourceType: z.string().optional(),
  priceConfidence: z.string().optional(),
  selectedSku: z.any().optional(),
  skuItems: z.array(z.any()).optional(),
  variants: z.array(z.any()).optional(),
  modelId: z.string().optional(),
  rawSourceProduct: z.any().optional(),
  rejectedAssets: z.array(z.any()).optional(),
  extractionDiagnostics: z.any().optional(),
  sku: z.string().optional(),
  sourceProductId: z.string().optional(),
  extensionVersion: z.string().optional(),
});

const batchDeleteVariantsSchema = z.object({
  skus: z.array(z.string().min(1)).min(1).max(100),
});

const productContentDraftSchema = z.object({
  fields: z.array(z.enum(['title', 'description'])).min(1).max(2).default(['title', 'description']),
  applyToPublish: z.boolean().optional().default(true),
});

function hasVolumeInTitle(value: string): boolean {
  return /(^|[^\p{L}\p{N}])\d{1,5}(?:[,.]\d+)?\s*(?:мл|ml)($|[^\p{L}])/iu.test(value);
}

function isRedundantVolumeVariantTitlePart(base: string, rawName: string, rawValue: string): boolean {
  if (!/(об[ъь]?е?м|volume|мл|ml)/iu.test(rawName)) return false;
  if (!hasVolumeInTitle(base)) return false;
  return /^\s*\d{1,5}(?:[,.]\d+)?\s*$/u.test(String(rawValue || ''));
}

function isColorLikeVariantName(name: unknown): boolean {
  return /цвет|color|colour/i.test(String(name || ''));
}

function isStrictColorVariantName(name: unknown): boolean {
  const normalized = normalizeOzonDictionaryText(name);
  return normalized === 'цвет' || normalized === 'color' || normalized === 'colour';
}

function isColorNameVariantName(name: unknown): boolean {
  const normalized = normalizeOzonDictionaryText(name);
  return normalized === 'название цвета'
    || normalized === 'color name'
    || normalized === 'colour name';
}

function stripOzonMarketingWords(value: unknown): string {
  return String(value || '')
    .normalize('NFKC')
    .replace(OZON_MARKETING_WORD_RE, '$1');
}

function sanitizeOzonAttrText(value: unknown): string {
  return stripOzonMarketingWords(value)
    .replace(/[ \t\f\v\r]+/g, ' ')
    .replace(/\s*\/\s*/g, ' / ')
    .replace(/\s*([,;])\s*/g, '$1 ')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,;])/g, '$1')
    .replace(/([,;]){2,}/g, '$1')
    .replace(/[,;]\s*$/g, '')
    .trim();
}

function sanitizeOzonDescriptionText(value: unknown): string {
  return stripOzonMarketingWords(value)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeColorToken(value: string): string {
  return value
    .replace(/^[^\p{L}\p{N}]+/gu, '')
    .replace(/[^\p{L}\p{N}-]+$/gu, '')
    .trim();
}

function isColorToken(value: string): boolean {
  if (OZON_COLOR_TOKEN_RE.test(value)) return true;
  const parts = value.split('-').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return false;
  if (OZON_COLOR_PREFIX_RE.test(parts[0] || '')) {
    const tail = parts.slice(1).join('-');
    if (tail && isColorToken(tail)) return true;
  }
  return parts.every((part, index) => (
    OZON_COLOR_TOKEN_RE.test(part)
    || (index < parts.length - 1 && OZON_COMPOUND_COLOR_PREFIX_RE.test(part))
  ));
}

function isAllowedColorTail(value: string): boolean {
  if (!value || /\d/u.test(value)) return false;
  if (OZON_COLOR_NOISE_RE.test(value)) return false;
  return OZON_COLOR_TAIL_RE.test(value) || /^[\p{L}-]{3,}$/u.test(value);
}

function colorFamilyKey(value: unknown): string {
  const tokens = sanitizeOzonAttrText(value)
    .split(/[\s-]+/u)
    .map((part) => normalizeColorToken(part))
    .filter(Boolean);
  for (const token of tokens) {
    if (OZON_COLOR_PREFIX_RE.test(token) || OZON_COMPOUND_COLOR_PREFIX_RE.test(token)) continue;
    if (OZON_COLOR_TOKEN_RE.test(token)) return normalizeOzonDictionaryText(token);
  }
  return '';
}

function colorSpecificity(value: unknown): number {
  const text = sanitizeOzonAttrText(value);
  if (!text) return 0;
  const tokens = text
    .split(/[\s-]+/u)
    .map((part) => normalizeColorToken(part))
    .filter(Boolean);
  const family = colorFamilyKey(text);
  if (!family) return 0;
  const meaningful = tokens.filter((token) => !OZON_COLOR_PREFIX_RE.test(token) && !OZON_COMPOUND_COLOR_PREFIX_RE.test(token));
  if (meaningful.length > 1) return 2;
  return /[\s-]/u.test(text) ? 2 : 1;
}

function compactColorSegments(segments: string[]): string[] {
  const rows = segments.map((segment) => ({
    segment,
    family: colorFamilyKey(segment),
    specificity: colorSpecificity(segment),
  }));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const key = normalizeOzonDictionaryText(row.segment);
    if (!key || seen.has(key)) continue;
    if (row.family && rows.some((other) => (
      other !== row
      && other.family === row.family
      && other.specificity > row.specificity
    ))) {
      continue;
    }
    seen.add(key);
    out.push(row.segment);
  }
  return out;
}

function colorNameRepeatsColorFamily(colorValue: unknown, colorNameValue: unknown): boolean {
  const colorNameFamily = colorFamilyKey(colorNameValue);
  if (!colorNameFamily) return false;
  return splitOzonCompositeDictionaryValue(sanitizeOzonAttrText(colorValue))
    .some((part) => colorFamilyKey(part) === colorNameFamily);
}

function extractSafeColorSegment(value: string): string {
  const text = sanitizeOzonAttrText(value);
  if (!text || containsCjkText(text) || isLikelyDescriptiveColorVariantValue(text)) return '';

  const tokens = text
    .split(/\s+/)
    .map((part) => normalizeColorToken(part))
    .filter(Boolean);
  if (!tokens.length) return '';

  const firstColorIndex = tokens.findIndex((token) => isColorToken(token));
  if (firstColorIndex < 0) return '';

  if (firstColorIndex === 1 && OZON_COLOR_PREFIX_RE.test(tokens[0] || '')) {
    return `${tokens[0]} ${tokens[1]}`;
  }

  if (firstColorIndex === 1 && OZON_COMPOUND_COLOR_PREFIX_RE.test(tokens[0] || '')) {
    return `${tokens[0]}-${tokens[1]}`;
  }

  if (firstColorIndex === 0) {
    if (tokens.length >= 2 && OZON_COMPOUND_COLOR_PREFIX_RE.test(tokens[0] || '') && isColorToken(tokens[1] || '')) {
      return `${tokens[0]}-${tokens[1]}`;
    }
    if (tokens.length >= 2 && isAllowedColorTail(tokens[1] || '')) {
      return `${tokens[0]} ${tokens[1]}`;
    }
    return tokens[0] || '';
  }

  return tokens[firstColorIndex] || '';
}

function extractSafeColorValue(value: unknown): string {
  const colors = splitOzonCompositeDictionaryValue(sanitizeOzonAttrText(value))
    .map((part) => extractSafeColorSegment(part))
    .filter(Boolean);
  return compactColorSegments(colors).join(', ');
}

function isAllowedStrictOzonColorTail(value: string): boolean {
  if (!value || /\d/u.test(value)) return false;
  if (OZON_COLOR_NOISE_RE.test(value)) return false;
  return OZON_COLOR_TAIL_RE.test(value);
}

function extractStrictOzonColorSegment(value: string): string {
  const text = sanitizeOzonAttrText(value);
  if (!text || containsCjkText(text) || isLikelyDescriptiveColorVariantValue(text)) return '';

  const tokens = text
    .split(/\s+/)
    .map((part) => normalizeColorToken(part))
    .filter(Boolean);
  if (!tokens.length) return '';

  const firstColorIndex = tokens.findIndex((token) => isColorToken(token));
  if (firstColorIndex < 0) return '';

  if (firstColorIndex === 1 && OZON_COLOR_PREFIX_RE.test(tokens[0] || '')) {
    return `${tokens[0]} ${tokens[1]}`;
  }

  if (firstColorIndex === 1 && OZON_COMPOUND_COLOR_PREFIX_RE.test(tokens[0] || '')) {
    return `${tokens[0]}-${tokens[1]}`;
  }

  if (firstColorIndex === 0) {
    if (tokens.length >= 2 && OZON_COMPOUND_COLOR_PREFIX_RE.test(tokens[0] || '') && isColorToken(tokens[1] || '')) {
      return `${tokens[0]}-${tokens[1]}`;
    }
    if (tokens.length >= 2 && isAllowedStrictOzonColorTail(tokens[1] || '')) {
      return `${tokens[0]} ${tokens[1]}`;
    }
    return tokens[0] || '';
  }

  return tokens[firstColorIndex] || '';
}

function extractStrictOzonColorValue(value: unknown): string {
  const colors = splitOzonCompositeDictionaryValue(sanitizeOzonAttrText(value))
    .map((part) => extractStrictOzonColorSegment(part))
    .filter(Boolean);
  return compactColorSegments(colors).join(', ');
}

function isLikelyDescriptiveColorVariantValue(value: unknown): boolean {
  const text = sanitizeOzonAttrText(value);
  if (!text || containsCjkText(text)) return false;
  if (/(?:\d+\s*[xх*]\s*\d+|\d+(?:[,.]\d+)?\s*(?:см|mm|мм))/iu.test(text)) return true;
  if (/(?:аксессуар|фото|держател|инструмент|мойк|раковин|кухн|набор|кукла|толщин|покрыти|монтажн)/iu.test(text)) return true;
  const words = variantWordCount(text);
  if (words >= 5) return true;
  if (text.length >= 36 && words >= 4) return true;
  return false;
}

function normalizeCodeLikeVariantLabel(value: unknown): string {
  const text = sanitizeOzonAttrText(value);
  if (!text || containsCjkText(text)) return '';
  if (/https?:\/\/|www\.|@/iu.test(text)) return '';
  if (isLikelyDescriptiveColorVariantValue(text)) return '';
  const compact = text.replace(/\s+/g, '');
  const match = compact.match(/^([a-z]{1,6})[-_](\d{1,4}[a-z]?)$/iu);
  if (!match?.[1] || !match[2]) return '';
  return `${match[1].toLocaleUpperCase('ru-RU')}-${match[2].toLocaleUpperCase('ru-RU')}`;
}

function sanitizeSupplementalVariantAttrValue(value: unknown): string {
  const text = sanitizeOzonAttrText(value);
  if (!text || containsCjkText(text)) return '';
  if (/https?:\/\/|www\.|@/iu.test(text)) return '';
  const words = variantWordCount(text);
  if (words >= 5) return '';
  if (text.length > 40) return '';
  return text;
}

type VariantPublishSanitizeOptions = { variantIndex?: number };

function normalizeStructuredSupplementalVariantValue(value: unknown): string {
  const text = sanitizeOzonAttrText(value);
  if (!text || containsCjkText(text)) return '';
  if (/https?:\/\/|www\.|@/iu.test(text)) return '';

  const exactColor = extractSafeColorValue(text);
  if (exactColor && normalizeOzonDictionaryText(exactColor) === normalizeOzonDictionaryText(text)) {
    return exactColor;
  }

  const dimension = text.match(/^(\d{1,4}(?:[,.]\d+)?)\s*[xх*×]\s*(\d{1,4}(?:[,.]\d+)?)\s*(см|cm)?$/iu);
  if (dimension?.[1] && dimension[2]) {
    const first = dimension[1].replace(',', '.');
    const second = dimension[2].replace(',', '.');
    const unit = dimension[3] ? ' см' : '';
    return `${first}x${second}${unit}`;
  }

  const type = text.match(/^(?:тип|type|вариант|variant|style|стиль|модель)\s*[-#№]?\s*([a-zа-я]?\d{1,3}|[a-zа-я])$/iu);
  if (type?.[1]) return `Тип ${type[1].toLocaleUpperCase('ru-RU')}`;

  return '';
}

function neutralSupplementalVariantLabel(options?: VariantPublishSanitizeOptions): string {
  const index = Number(options?.variantIndex);
  const suffix = Number.isInteger(index) && index >= 0 ? index + 1 : 1;
  return `Тип ${suffix}`;
}

function sanitizeSupplementalVariantTitleValue(value: unknown): string {
  return normalizeStructuredSupplementalVariantValue(value);
}

function sanitizeSupplementalVariantAttrValueForOzonPublish(value: unknown, options?: VariantPublishSanitizeOptions): string {
  const structured = normalizeStructuredSupplementalVariantValue(value);
  if (structured) return structured;
  const codeLike = normalizeCodeLikeVariantLabel(value);
  if (codeLike) return codeLike;
  const text = sanitizeSupplementalVariantAttrValue(value);
  return text ? neutralSupplementalVariantLabel(options) : '';
}

function sanitizeVariantAttrValueForPublish(name: unknown, value: unknown): string {
  if (isStrictColorVariantName(name)) return extractSafeColorValue(value) || normalizeCodeLikeVariantLabel(value);
  if (isColorNameVariantName(name)) return sanitizeSupplementalVariantAttrValue(value);
  if (isColorLikeVariantName(name)) return extractSafeColorValue(value);
  return sanitizeOzonAttrText(value);
}

function sanitizeVariantAttrValueForOzonPublish(
  name: unknown,
  value: unknown,
  options?: VariantPublishSanitizeOptions,
): string {
  if (isStrictColorVariantName(name)) return extractStrictOzonColorValue(value);
  if (isColorNameVariantName(name)) return sanitizeSupplementalVariantAttrValueForOzonPublish(value, options);
  if (isColorLikeVariantName(name)) return extractStrictOzonColorValue(value);
  return sanitizeOzonAttrText(value);
}

function sourceVariantAttrKind(name: unknown): 'color' | 'size' | null {
  const text = String(name || '').normalize('NFKC').trim();
  if (/颜色|色号|颜色分类/i.test(text)) return 'color';
  if (/尺码|尺寸|规格/i.test(text)) return 'size';
  return null;
}

function translateSourceColorSegmentToOzon(value: unknown): string {
  const text = sanitizeOzonAttrText(value);
  if (!text) return '';
  if (!containsCjkText(text)) return extractStrictOzonColorValue(text) || extractSafeColorValue(text);
  for (const [pattern, color] of SOURCE_COLOR_TO_OZON) {
    if (pattern.test(text)) return color;
  }
  return '';
}

function translateSourceColorValueToOzon(value: unknown): string {
  const text = sanitizeOzonAttrText(value);
  if (!text) return '';
  if (!containsCjkText(text)) return extractStrictOzonColorValue(text) || extractSafeColorValue(text);
  const parts = text.split(/[,\uFF0C、;；/|\s]+/u).map((part) => part.trim()).filter(Boolean);
  const colors = compactColorSegments(parts.map(translateSourceColorSegmentToOzon).filter(Boolean));
  return colors.join(', ');
}

const SOURCE_MATERIAL_TO_OZON: Array<[RegExp, string]> = [
  [/色丁|satin/i, 'Сатин'],
  [/乳胶|latex|латекс/i, 'Латекс'],
  [/聚酯纤维|涤纶|полиэстер|polyester/i, 'Полиэстер'],
  [/棉|хлопок|cotton/i, 'Хлопок'],
  [/锦纶|尼龙|nylon|полиамид/i, 'Полиамид'],
  [/氨纶|spandex|эластан/i, 'Эластан'],
  [/蕾丝|lace|кружев/i, 'Кружево'],
  [/真丝|桑蚕丝|silk|шелк|шёлк/i, 'Шелк'],
  [/粘纤|粘胶|viscose|вискоз/i, 'Вискоза'],
];

function translateSourceMaterialValueToOzon(value: unknown): string {
  const text = sanitizeOzonAttrText(value);
  if (!text) return '';
  for (const [pattern, material] of SOURCE_MATERIAL_TO_OZON) {
    if (pattern.test(text)) return material;
  }
  return text;
}

function extractSourceApparelSizeToken(value: unknown): string {
  const text = String(value || '').normalize('NFKC').trim();
  const match = text.match(/^(\d+\s*XL|XXXXL|XXXL|XXL|XL|XS|L|M|S|均码)(?=\s|\d|[-_/、,，()[\]【】]|斤|公斤|kg|кг|$)/i)
    || text.match(/^(\d{2,3})$/i);
  if (!match?.[1]) return '';
  return match[1].replace(/\s+/g, '').toUpperCase();
}

function sanitizeSourceSizeVariantValue(value: unknown): string {
  for (const candidate of sanitizeSourceStandardSizeValues([value])) {
    const sizeToken = extractSourceApparelSizeToken(candidate);
    if (sizeToken) return sizeToken === '均码' ? 'Универсальный' : sizeToken;
    const text = sanitizeOzonAttrText(candidate);
    if (text && !containsCjkText(text)) return text;
  }
  return '';
}

function sourceInternationalSizeToRussianSize(value: unknown): string {
  const text = sanitizeSourceSizeVariantValue(value);
  if (/^(?:均码|one\s*size|one-size|universal|универсальн\p{L}*|os)$/iu.test(text)) return 'Универсальный';
  const upperText = text.toUpperCase();
  const normalized = upperText.replace(/\s+/g, '');
  const map: Record<string, string> = {
    XS: '44',
    S: '46',
    M: '48',
    L: '50',
    XL: '52',
    XXL: '54',
    '2XL': '54',
    XXXL: '56',
    '3XL': '56',
    XXXXL: '58',
    '4XL': '58',
  };
  return map[normalized] || text;
}

function sanitizeVariantAttrValueForTitle(name: unknown, value: unknown): string {
  if (isStrictColorVariantName(name)) {
    const color = extractSafeColorValue(value);
    return splitOzonCompositeDictionaryValue(color).length > 3 ? '' : color;
  }
  if (isColorNameVariantName(name)) return sanitizeSupplementalVariantTitleValue(value);
  if (isColorLikeVariantName(name)) return extractSafeColorValue(value);
  return sanitizeVariantAttrValueForPublish(name, value);
}

function normalizeVariantTitleParts(variantAttrs?: Record<string, string>, includeColorLabel = false, base = ''): string[] {
  if (!variantAttrs || !Object.keys(variantAttrs).length) return [];
  const parts: string[] = [];
  const seen = new Set<string>();
  const colorValue = Object.entries(variantAttrs)
    .filter(([name]) => isStrictColorVariantName(name))
    .map(([, value]) => sanitizeVariantAttrValueForTitle('Цвет', value))
    .filter(Boolean)
    .join(', ');
  for (const [rawName, rawValue] of Object.entries(variantAttrs)) {
    if (isRedundantVolumeVariantTitlePart(base, rawName, rawValue)) continue;
    if (isColorNameVariantName(rawName) && colorNameRepeatsColorFamily(colorValue, rawValue)) continue;
    const value = sanitizeVariantAttrValueForTitle(rawName, rawValue);
    if (isStrictColorVariantName(rawName) && isLikelyDescriptiveColorVariantValue(rawValue) && !value) continue;
    if (!value) continue;
    if (containsCjkText(value)) continue;
    const part = includeColorLabel && isStrictColorVariantName(rawName)
      ? cleanPublishName(`${value} цвет`)
      : lowercaseCyrillicVariantPart(value);
    const key = part.toLocaleLowerCase('ru-RU').replace(/[^\p{L}\p{N}]+/gu, '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    parts.push(part);
  }
  return parts.slice(0, 4);
}

export function sanitizeVariantAttrsForPublish(variantAttrs?: Record<string, string>): Record<string, string> {
  if (!variantAttrs || typeof variantAttrs !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(variantAttrs)) {
    const name = String(rawName || '').trim();
    const value = sanitizeVariantAttrValueForPublish(name, rawValue);
    if (!name || !value) continue;
    if (containsCjkText(name) || containsCjkText(value)) continue;
    out[name] = value;
  }
  return out;
}

export function sanitizeVariantAttrsForOzonPublish(
  variantAttrs?: Record<string, string>,
  options?: VariantPublishSanitizeOptions,
): Record<string, string> {
  if (!variantAttrs || typeof variantAttrs !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(variantAttrs)) {
    const name = String(rawName || '').trim();
    const sourceKind = sourceVariantAttrKind(name);
    if (sourceKind === 'color' || (isStrictColorVariantName(name) && containsCjkText(rawValue))) {
      const value = translateSourceColorValueToOzon(rawValue);
      if (value) {
        out['Цвет'] = value;
      }
      continue;
    }
    if (sourceKind === 'size') {
      const value = sanitizeSourceSizeVariantValue(rawValue);
      if (value) {
        out['Российский размер'] = sourceInternationalSizeToRussianSize(value);
        out['Размер производителя'] = value;
      }
      continue;
    }
    const value = sanitizeVariantAttrValueForOzonPublish(name, rawValue, options);
    if (!value && isStrictColorVariantName(name)) {
      const codeLike = normalizeCodeLikeVariantLabel(rawValue);
      if (codeLike) {
        out['Название цвета'] = codeLike;
        continue;
      }
      if (sanitizeSupplementalVariantAttrValue(rawValue)) {
        out['Название цвета'] = sanitizeSupplementalVariantAttrValueForOzonPublish(rawValue, options);
        continue;
      }
    }
    if (!name || !value) continue;
    if (containsCjkText(name) || containsCjkText(value)) continue;
    out[name] = value;
  }
  return out;
}

export function sanitizeVariantAttrSetsForOzonPublish(
  variantAttrSets?: Array<Record<string, string> | null | undefined>,
): Record<string, string>[] {
  const inputs = Array.isArray(variantAttrSets) ? variantAttrSets : [];
  const sanitized = inputs.map((attrs, index) => sanitizeVariantAttrsForOzonPublish(
    attrs && typeof attrs === 'object' ? attrs : undefined,
    { variantIndex: index },
  ));

  for (let index = 0; index < sanitized.length; index += 1) {
    const attrs = sanitized[index]!;
    if (Object.keys(attrs).some((name) => isColorNameVariantName(name))) continue;
    const rawAttrs = inputs[index];
    if (!rawAttrs || typeof rawAttrs !== 'object') continue;
    const rawColorEntry = Object.entries(rawAttrs).find(([name]) => isStrictColorVariantName(name));
    const safeColorEntry = Object.entries(attrs).find(([name]) => isStrictColorVariantName(name));
    if (!rawColorEntry || !safeColorEntry) continue;
    const rawColorKey = normalizeOzonDictionaryText(rawColorEntry[1]);
    const safeColorKey = normalizeOzonDictionaryText(safeColorEntry[1]);
    const translatedSourceColorKey = containsCjkText(rawColorEntry[1])
      ? normalizeOzonDictionaryText(translateSourceColorValueToOzon(rawColorEntry[1]))
      : '';
    if (translatedSourceColorKey && translatedSourceColorKey === safeColorKey) continue;
    if (rawColorKey && safeColorKey && rawColorKey !== safeColorKey) {
      attrs['Название цвета'] = neutralSupplementalVariantLabel({ variantIndex: index });
    }
  }

  const occupiedColorNames = new Set<string>();
  const needsNeutralColorName: Array<{ index: number; name: string }> = [];

  function nextNeutralColorName(): string {
    let suffix = 1;
    let label = `Тип ${suffix}`;
    while (occupiedColorNames.has(normalizeOzonDictionaryText(label))) {
      suffix += 1;
      label = `Тип ${suffix}`;
    }
    occupiedColorNames.add(normalizeOzonDictionaryText(label));
    return label;
  }

  for (let index = 0; index < sanitized.length; index += 1) {
    const attrs = sanitized[index]!;
    const colorNameEntry = Object.entries(attrs).find(([name]) => isColorNameVariantName(name));
    if (!colorNameEntry) continue;
    const colorEntry = Object.entries(attrs).find(([name]) => isStrictColorVariantName(name));
    if (colorEntry && colorNameRepeatsColorFamily(colorEntry[1], colorNameEntry[1])) {
      needsNeutralColorName.push({ index, name: colorNameEntry[0] });
      continue;
    }
    const rawAttrs = inputs[index];
    const rawColorNameEntry = rawAttrs && typeof rawAttrs === 'object'
      ? Object.entries(rawAttrs).find(([name]) => isColorNameVariantName(name))
      : null;
    const rawStructured = normalizeStructuredSupplementalVariantValue(rawColorNameEntry?.[1])
      || normalizeCodeLikeVariantLabel(rawColorNameEntry?.[1])
      || normalizeCodeLikeVariantLabel(colorNameEntry[1]);
    const key = normalizeOzonDictionaryText(colorNameEntry[1]);
    if (!key) continue;
    if (rawStructured) {
      occupiedColorNames.add(key);
    } else {
      needsNeutralColorName.push({ index, name: colorNameEntry[0] });
    }
  }

  for (const entry of needsNeutralColorName) {
    sanitized[entry.index]![entry.name] = nextNeutralColorName();
  }

  const duplicateSignatureGroups = new Map<string, number[]>();
  for (let index = 0; index < sanitized.length; index += 1) {
    const attrs = sanitized[index]!;
    if (Object.keys(attrs).some((name) => isColorNameVariantName(name))) continue;
    if (!Object.keys(attrs).some((name) => isStrictColorVariantName(name))) continue;
    const signature = Object.entries(attrs)
      .map(([name, value]) => [cleanPublishName(name), cleanPublishName(value)] as const)
      .filter(([name, value]) => name && value)
      .sort(([a], [b]) => a.localeCompare(b, 'ru-RU'))
      .map(([name, value]) => `${normalizeVariantConflictValue(name)}=${normalizeVariantConflictValue(value)}`)
      .join('|');
    if (!signature) continue;
    const group = duplicateSignatureGroups.get(signature) || [];
    group.push(index);
    duplicateSignatureGroups.set(signature, group);
  }

  for (const indexes of duplicateSignatureGroups.values()) {
    if (indexes.length < 2) continue;
    for (const index of indexes) {
      sanitized[index]!['Название цвета'] = nextNeutralColorName();
    }
  }

  return sanitized;
}

export function sanitizeOzonVariantPublishAttributes<T extends { id: number; complex_id?: number; values: any[] }>(
  attributes: T[] | null | undefined,
  options?: VariantPublishSanitizeOptions,
): T[] {
  if (!Array.isArray(attributes)) return [];
  return attributes
    .map((attr) => {
      const name = OZON_VARIANT_ATTR_NAME_BY_ID[Number(attr.id)] || '';
      if (!name || (!isStrictColorVariantName(name) && !isColorNameVariantName(name))) return attr;
      if (isStrictColorVariantName(name)) {
        const strictValues = Array.isArray(attr.values)
          ? attr.values
            .map((raw) => {
              const value = sanitizeVariantAttrValueForOzonPublish(name, raw?.value, options);
              const dictId = Number(raw?.dictionary_value_id);
              if (!value || !Number.isFinite(dictId) || dictId <= 0) return null;
              return { value, dictionary_value_id: dictId };
            })
            .filter((value): value is { value: string; dictionary_value_id: number } => !!value)
          : [];
        if (strictValues.length) {
          return {
            ...attr,
            values: strictValues,
          } as T;
        }
        return null;
      }
      const rawValue = Array.isArray(attr.values)
        ? attr.values.map((value) => value?.value).filter(Boolean).join(', ')
        : '';
      const value = sanitizeVariantAttrValueForOzonPublish(name, rawValue, options);
      if (!value) return null;
      const originalValue = Array.isArray(attr.values) && attr.values.length === 1
        ? String(attr.values[0]?.value || '').trim()
        : '';
      const nextValue: { value: string; dictionary_value_id?: number } = { value };
      if (normalizeOzonDictionaryText(value) === normalizeOzonDictionaryText(originalValue)) {
        const dictId = Number(attr.values[0]?.dictionary_value_id);
        if (Number.isFinite(dictId) && dictId > 0) nextValue.dictionary_value_id = dictId;
      } else {
        nextValue.dictionary_value_id = 0;
      }
      return {
        ...attr,
        values: [nextValue],
      } as T;
    })
    .filter((attr): attr is T => !!attr);
}

export function sanitizeOzonVariantPublishAttributeSets<T extends { id: number; complex_id?: number; values: any[] }>(
  attributeSets?: Array<T[] | null | undefined>,
): T[][] {
  const inputs = Array.isArray(attributeSets) ? attributeSets : [];
  const sanitized = inputs.map((attributes, index) => sanitizeOzonVariantPublishAttributes(attributes, { variantIndex: index }));
  const occupiedColorNames = new Set<string>();
  const needsNeutralColorName: Array<{ index: number; attrIndex: number }> = [];

  for (let index = 0; index < sanitized.length; index += 1) {
    const attrs = sanitized[index] || [];
    for (let attrIndex = 0; attrIndex < attrs.length; attrIndex += 1) {
      const attr = attrs[attrIndex];
      if (!attr) continue;
      const name = OZON_VARIANT_ATTR_NAME_BY_ID[Number(attr.id)] || '';
      if (!isColorNameVariantName(name)) continue;
      const value = Array.isArray(attr.values) && attr.values.length === 1 ? String(attr.values[0]?.value || '') : '';
      const key = normalizeOzonDictionaryText(value);
      if (!key) continue;
      const rawAttr = Array.isArray(inputs[index]) ? inputs[index]![attrIndex] : null;
      const rawValue = rawAttr && Array.isArray(rawAttr.values)
        ? rawAttr.values.map((item) => item?.value).filter(Boolean).join(', ')
        : '';
      if (normalizeStructuredSupplementalVariantValue(rawValue)) {
        occupiedColorNames.add(key);
      } else {
        needsNeutralColorName.push({ index, attrIndex });
      }
    }
  }

  for (const entry of needsNeutralColorName) {
    let suffix = 1;
    let label = `Тип ${suffix}`;
    while (occupiedColorNames.has(normalizeOzonDictionaryText(label))) {
      suffix += 1;
      label = `Тип ${suffix}`;
    }
    const attr = sanitized[entry.index]?.[entry.attrIndex];
    if (!attr) continue;
    attr.values = [{ value: label, dictionary_value_id: 0 }];
    occupiedColorNames.add(normalizeOzonDictionaryText(label));
  }

  return sanitized;
}

function wordKeys(value: string): string[] {
  return cleanPublishName(value)
    .split(/\s+/)
    .map((word) => word.toLocaleLowerCase('ru-RU').replace(/[^\p{L}\p{N}]+/gu, ''))
    .filter(Boolean);
}

function compactRepeatedPublishBase(base: string): string {
  const words = cleanPublishName(base).split(/\s+/).filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const word of words) {
    const key = word.toLocaleLowerCase('ru-RU').replace(/[^\p{L}\p{N}]+/gu, '');
    if (key.length > 2 && !TITLE_STOP_WORDS.has(key) && seen.has(key) && out.length >= 3) break;
    out.push(word);
    if (key.length > 2 && !TITLE_STOP_WORDS.has(key)) seen.add(key);
    if (out.length >= 9) break;
  }
  return cleanPublishName(out.join(' '));
}

function normalizeKnownPublishBaseName(value: string): string {
  const text = cleanPublishName(value);
  if (/^скатерт\p{L}*-дорожк\p{L}*\s+на\s+стол\s+дорожк\p{L}*\s+сервировочн\p{L}*$/iu.test(text)) {
    return 'Дорожка на стол сервировочная';
  }
  const tableRunner = text.match(/^(?:(?<brand>.+?)\s+)?скатерт\p{L}*-дорожк\p{L}*\s+на\s+стол(?:\s+(?<size>\d{1,4}(?:[,.]\d+)?\s*[xх*×]\s*\d{1,4}(?:[,.]\d+)?\s*(?:см|cm)?))?(?:,?\s+(?:кухонн\p{L}*\s+)?дорожк\p{L}*\s+сервировочн\p{L}*)$/iu);
  if (tableRunner?.groups) {
    const brand = cleanPublishName(tableRunner.groups.brand || '');
    const size = cleanPublishName(tableRunner.groups.size || '').replace(/\s*[xх*×]\s*/iu, 'x');
    return cleanPublishName(`Скатерть-дорожка на стол${brand ? ` ${brand}` : ''}${size ? `, ${size}` : ''}`);
  }
  return text;
}

function compactPublishBaseName(base: string): string {
  const cleanBase = normalizeKnownPublishBaseName(base);
  if (!cleanBase) return '';
  if (!hasSuspiciousPublishName(cleanBase) && cleanBase.length <= 90) return cleanBase;

  const segment = String(base || '')
    .split(/[,;|]+/)
    .map((part) => compactRepeatedPublishBase(part))
    .find((part) => part && !containsCjkText(part) && part.length >= 4);
  return segment || compactRepeatedPublishBase(cleanBase);
}

function removeLeadingVariantOverlap(base: string, part: string): string {
  const baseKeys = wordKeys(base);
  const tokens = cleanPublishName(part).split(/\s+/).filter(Boolean);
  while (tokens.length && baseKeys.length) {
    const tokenKey = tokens[0]!.toLocaleLowerCase('ru-RU').replace(/[^\p{L}\p{N}]+/gu, '');
    const lastBaseKey = baseKeys[baseKeys.length - 1];
    if (!tokenKey || tokenKey !== lastBaseKey) break;
    tokens.shift();
    baseKeys.pop();
  }
  return cleanPublishName(tokens.join(' '));
}

function appendVariantTitleParts(base: string, parts: string[]): string {
  const cleanBase = compactPublishBaseName(base);
  if (!parts.length) return cleanBase;
  const nextParts = parts
    .map((part) => removeLeadingVariantOverlap(cleanBase, part))
    .filter(Boolean);
  if (!nextParts.length) return cleanBase;
  const usePunctuation = nextParts.length > 1
    || nextParts.some((part) => /[,.]/.test(part) || (/\s/.test(part) && !/\sцвет$/i.test(part)))
    || cleanBase.length > 70;
  return cleanPublishName(`${cleanBase}${usePunctuation ? ', ' : ' '}${nextParts.join(', ')}`);
}

function shortenSpammyPublishName(base: string, variantParts: string[]): string {
  const cleanBase = cleanPublishName(base);
  if (/автовизитк/i.test(cleanBase)) {
    return appendVariantTitleParts('Автовизитка для автомобиля', variantParts);
  }

  if (!hasSuspiciousPublishName(cleanBase)) {
    return appendVariantTitleParts(cleanBase, variantParts);
  }

  const phrase = String(base || '')
    .split(/[,;|]+/)
    .map((part) => cleanPublishName(part))
    .find((part) => part && !containsCjkText(part) && part.length >= 4);
  const fallback = compactRepeatedPublishBase(cleanBase);
  return appendVariantTitleParts(phrase || fallback, variantParts);
}

export function sanitizePublishDescription(value: unknown, maxLength = DESCRIPTION_MAX_LENGTH): string {
  let text = String(value || '').normalize('NFKC');
  if (!text.trim()) return '';
  text = text
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  text = sanitizeOzonDescriptionText(text)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.slice(0, maxLength).trim();
}

function sanitizeNotesPublishDescription(value: unknown): string {
  const text = sanitizePublishDescription(value);
  if (!text) return '';
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^重量[:：]/.test(line) && !/^(offer_id|sku|category_id|type_id)\s*:/i.test(line))
    .join('\n')
    .trim();
}

export function resolvePublishDescription(
  item: { notes?: string | null; metadata?: unknown },
  clonedDescription?: unknown,
): string {
  const meta = item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
    ? item.metadata as Record<string, any>
    : {};
  const candidates = [
    meta.publishDescriptionRu,
    meta.sourceDescriptionRu,
    clonedDescription,
  ];
  for (const candidate of candidates) {
    const description = sanitizePublishDescription(candidate);
    if (description && containsRussianText(description)) return description;
  }
  return sanitizeNotesPublishDescription(item.notes);
}

function draftRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function russianDraftText(value: unknown, maxLength: number): string {
  const text = maxLength === 200 ? cleanPublishName(value).slice(0, maxLength) : sanitizePublishDescription(value, maxLength);
  return text && containsRussianText(text) ? text : '';
}

function collectAiDraftSearchTags(drafts: Record<string, unknown>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const draft of [draftRecord(drafts.title), draftRecord(drafts.description)]) {
    const structured = draftRecord(draft.structured);
    const tags = Array.isArray(structured.searchTags) ? structured.searchTags : [];
    for (const raw of tags) {
      const tag = cleanPublishName(raw).slice(0, 80);
      if (!tag || !containsRussianText(tag) || seen.has(tag)) continue;
      seen.add(tag);
      out.push(tag);
      if (out.length >= 12) return out;
    }
  }
  return out;
}

function collectAiRichContentTextBlocks(descriptionDraft: Record<string, any>): string[] {
  const structured = draftRecord(descriptionDraft.structured);
  const rawBlocks = Array.isArray(structured.richContentBlocks)
    ? structured.richContentBlocks
    : Array.isArray(structured.bulletPoints)
      ? structured.bulletPoints
      : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of rawBlocks) {
    const text = sanitizePublishDescription(raw, 600);
    if (!text || !containsRussianText(text) || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= 8) break;
  }
  if (!out.length) {
    const fallback = russianDraftText(descriptionDraft.text, 900);
    if (fallback) out.push(fallback);
  }
  return out;
}

function buildAiRichContentDraft(meta: Record<string, unknown>, descriptionDraft: Record<string, any>): Record<string, unknown> | null {
  const textBlocks = collectAiRichContentTextBlocks(descriptionDraft);
  if (!textBlocks.length) return null;
  const blocks: Array<Record<string, string>> = textBlocks.map((text) => ({ type: 'text', text }));
  for (const url of normalizePublishImageList(meta.sourceDetailImages).slice(0, 12)) {
    blocks.push({ type: 'image', url });
  }
  return {
    status: 'ai_generated_reviewable',
    source: 'ai_product_content',
    locale: 'ru',
    plan: buildSourceRichContentPlan({ title: meta.sourceTitleRaw || meta.publishTitleRu || meta.title, metadata: meta, variants: meta.skuItems }),
    blocks,
  };
}

function isPublishableSourceRichContentDraft(value: unknown): boolean {
  const draft = metadataRecord(value);
  if (!draft || !Object.keys(draft).length) return false;
  const status = String(draft.status || '').trim();
  const source = String(draft.source || '').trim();
  const locale = String(draft.locale || '').trim().toLowerCase();
  const blocks = Array.isArray(draft.blocks) ? draft.blocks : [];
  if (status !== 'ai_generated_reviewable' && source !== 'ai_product_content' && locale !== 'ru') return false;
  return blocks.some((block) => {
    const row = metadataRecord(block);
    return String(row.type || '') === 'text' && containsRussianText(row.text);
  });
}

function publishableSourceRichContentPayload(value: unknown): string {
  const draft = metadataRecord(value);
  if (!isPublishableSourceRichContentDraft(draft)) return '';
  const blocks = Array.isArray(draft.blocks) ? [...draft.blocks] : [];
  const sizeChartBlock = buildPublishableSizeChartBlock(draft.plan);
  if (sizeChartBlock) {
    const firstImageIndex = blocks.findIndex((block) => metadataRecord(block).type === 'image');
    if (firstImageIndex >= 0) blocks.splice(firstImageIndex, 0, sizeChartBlock);
    else blocks.push(sizeChartBlock);
  }
  return JSON.stringify({ blocks });
}

function publishableSizeChartTitle(plan: Record<string, unknown>, sizeChart: Record<string, unknown>): string {
  const tableTitle = cleanPublishName(sizeChart.tableTitle).slice(0, 120);
  if (tableTitle) return tableTitle;
  const templateKey = String(plan.templateKey || '').toLowerCase();
  const templateLabel = String(plan.templateLabel || '').toLowerCase();
  const profile = String(sizeChart.mappingProfile || '').toLowerCase();
  const context = `${templateKey} ${templateLabel} ${profile}`;
  if (/men_apparel|apparel_mens|муж|男装|男士/.test(context)) return 'Таблица размеров мужской одежды';
  if (/children_apparel|apparel_children|童装|детск/.test(context)) return 'Таблица размеров детской одежды';
  if (/women_shoes|shoes_women|女鞋/.test(context)) return 'Таблица размеров женской обуви';
  if (/men_shoes|shoes_men|男鞋/.test(context)) return 'Таблица размеров мужской обуви';
  if (/bra|文胸|胸罩/.test(context)) return 'Таблица размеров бюстгальтеров';
  if (/underwear|apparel_underwear|内衣|内裤|трус/.test(context)) return 'Таблица размеров нижнего белья';
  if (/women_apparel|apparel_sleepwear|女装|睡衣|睡裙/.test(context)) return 'Таблица размеров женской одежды';
  return 'Таблица размеров';
}

function buildPublishableSizeChartBlock(planInput: unknown): Record<string, unknown> | null {
  const plan = metadataRecord(planInput);
  const sizeChart = metadataRecord(plan.sizeChart);
  const tableRows = Array.isArray(sizeChart.tableRows)
    ? sizeChart.tableRows
      .map((row) => metadataRecord(row))
      .filter((row) => Object.values(row).some((value) => String(value || '').trim()))
      .slice(0, 12)
    : [];
  if (!tableRows.length) return null;
  const columns = Array.isArray(sizeChart.tableColumns)
    ? sizeChart.tableColumns.map((value) => cleanPublishName(value).slice(0, 60)).filter(Boolean).slice(0, 6)
    : [];
  return {
    type: 'size_chart',
    title: publishableSizeChartTitle(plan, sizeChart),
    columns: columns.length ? columns : ['尺码', '俄罗斯尺码'],
    rows: tableRows,
  };
}

export function applyAiContentDraftsToPublishMetadata(input: unknown): { metadata: Record<string, unknown>; applied: string[] } {
  const metadata = metadataRecord(input);
  const drafts = metadataRecord(metadata.aiContentDrafts);
  const titleDraft = draftRecord(drafts.title);
  const descriptionDraft = draftRecord(drafts.description);
  const applied: string[] = [];
  const appliedFlags = metadataRecord(metadata.aiContentPublishApplied);

  if (!String(metadata.publishTitleRu || '').trim()) {
    const title = russianDraftText(titleDraft.text, 200);
    if (title) {
      metadata.publishTitleRu = title;
      delete metadata.titleNeedsReview;
      applied.push('publishTitleRu');
      appliedFlags.title = true;
    }
  }

  if (!String(metadata.publishDescriptionRu || '').trim()) {
    const description = russianDraftText(descriptionDraft.text, DESCRIPTION_MAX_LENGTH);
    if (description) {
      metadata.publishDescriptionRu = description;
      applied.push('publishDescriptionRu');
      appliedFlags.description = true;
    }
  }

  if (!Array.isArray(metadata.sourceSearchTagsRu) || !metadata.sourceSearchTagsRu.length) {
    const tags = collectAiDraftSearchTags(drafts);
    if (tags.length) {
      metadata.sourceSearchTagsRu = tags;
      applied.push('sourceSearchTagsRu');
      appliedFlags.searchTags = true;
    }
  }

  if (!String(metadata.sourceRichDescriptionJson || '').trim() && !isPublishableSourceRichContentDraft(metadata.sourceRichContentDraft)) {
    const richContentDraft = buildAiRichContentDraft(metadata, descriptionDraft);
    if (richContentDraft) {
      metadata.sourceRichContentDraft = richContentDraft;
      applied.push('sourceRichContentDraft');
      appliedFlags.richContent = true;
    }
  }

  if (Object.keys(appliedFlags).length) metadata.aiContentPublishApplied = appliedFlags;
  return { metadata, applied };
}

export function normalizeCollectedSourceVideos(value: unknown): { url: string; coverUrl?: string; title?: string }[] {
  if (!Array.isArray(value)) return [];
  const out: { url: string; coverUrl?: string; title?: string }[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const url = String(row.url || row.videoUrl || row.src || row.link || '').trim();
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    const coverUrl = String(row.coverUrl || row.cover || row.poster || row.preview || row.thumbnail || '').trim();
    const title = cleanPublishName(row.title || row.name || row.caption || '').slice(0, 200);
    const next: { url: string; coverUrl?: string; title?: string } = { url };
    if (/^https?:\/\//i.test(coverUrl)) next.coverUrl = coverUrl;
    if (title) next.title = title;
    out.push(next);
    if (out.length >= 10) break;
  }
  return out;
}

function finiteMetadataNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanMetadataText(value: unknown, maxLength = 500): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, maxLength) : '';
}

function cleanRawSourceText(value: unknown, maxLength = DESCRIPTION_MAX_LENGTH): string {
  const text = String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text ? text.slice(0, maxLength).trim() : '';
}

function normalizeCollectedCategoryPath(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => cleanMetadataText(
        item && typeof item === 'object'
          ? (item as Record<string, unknown>).name
            ?? (item as Record<string, unknown>).title
            ?? (item as Record<string, unknown>).text
            ?? (item as Record<string, unknown>).value
          : item,
        120,
      ))
      .filter(Boolean)
      .slice(0, 8);
  }
  if (typeof value === 'string') {
    return value.split(/>|\/|»|›|,/)
      .map((part) => cleanMetadataText(part, 120))
      .filter(Boolean)
      .slice(0, 8);
  }
  return [];
}

function normalizeCollectedSourceAttributes(value: unknown): { id?: number; name: string; value: string }[] {
  if (!Array.isArray(value)) return [];
  const out: { id?: number; name: string; value: string }[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const name = cleanMetadataText(row.name ?? row.key ?? row.attrName ?? row.title, 160);
    const attrValue = cleanMetadataText(row.value ?? row.attrValue ?? row.text ?? row.content, 500);
    if (!name || !attrValue) continue;
    const key = `${name}\u0000${attrValue}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const next: { id?: number; name: string; value: string } = { name, value: attrValue };
    const id = finiteMetadataNumber(row.id);
    if (id != null) next.id = id;
    out.push(next);
    if (out.length >= 100) break;
  }
  return out;
}

function normalizeCollectedSourceImageList(value: unknown, maxLength = 100): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const text = String(item || '').trim();
    if (!/^https?:\/\//i.test(text) || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= maxLength) break;
  }
  return out;
}

function normalizeCollectedPackagingRows(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  const rows: unknown[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    const color = cleanMetadataText(row.color ?? row.colour ?? row['颜色'], 120);
    const size = cleanMetadataText(row.size ?? row.spec ?? row.specText ?? row['尺码'] ?? row['规格'], 120);
    if (color) next.color = color;
    if (size) next.size = size;
    for (const key of ['lengthMm', 'widthMm', 'heightMm', 'volumeCm3', 'weightG'] as const) {
      const number = finiteMetadataNumber(row[key]);
      if (number != null && number > 0) next[key] = number;
    }
    const encoded = JSON.stringify(next);
    if (encoded === '{}' || seen.has(encoded)) continue;
    seen.add(encoded);
    rows.push(next);
    if (rows.length >= 200) break;
  }
  return rows;
}

function cloneMetadataJson(value: unknown, maxArrayLength = 100): unknown {
  if (Array.isArray(value)) {
    return value.slice(0, maxArrayLength).map((item) => cloneMetadataJson(item, maxArrayLength));
  }
  if (!value || typeof value !== 'object') return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return undefined;
  }
}

export function buildCollectedGoodsMetadata(input: {
  title?: unknown;
  publishTitle?: unknown;
  sourceTitleRaw?: unknown;
  sourceLocale?: unknown;
  description?: unknown;
  richDescriptionJson?: unknown;
  sourceVideos?: unknown;
  descriptionFetchDiagnostics?: unknown;
  descriptionFetchTrace?: unknown;
  [key: string]: unknown;
}): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  const publishTitle = String(input.publishTitle || '').trim();
  const titleNeedsReview = containsCjkText(input.title) || containsCjkText(input.sourceTitleRaw) || containsCjkText(publishTitle);
  if (publishTitle && !containsCjkText(publishTitle)) metadata.publishTitleRu = publishTitle;
  if (input.sourceTitleRaw) metadata.sourceTitleRaw = String(input.sourceTitleRaw);
  if (input.sourceLocale) metadata.sourceLocale = String(input.sourceLocale);
  if (input.sourcePlatform) metadata.sourcePlatform = String(input.sourcePlatform);
  if (input.extensionVersion) metadata.extensionVersion = String(input.extensionVersion).slice(0, 40);
  const sourceDescription = sanitizePublishDescription(input.description);
  const sourceDescriptionRaw = cleanRawSourceText(input.description);
  if (sourceDescriptionRaw) metadata.sourceDescriptionRaw = sourceDescriptionRaw;
  if (sourceDescription && containsRussianText(sourceDescription)) metadata.sourceDescriptionRu = sourceDescription;
  if (input.richDescriptionJson) metadata.sourceRichDescriptionJson = String(input.richDescriptionJson);
  const sourceMainImages = normalizeCollectedSourceImageList(input.sourceMainImages);
  if (sourceMainImages.length) metadata.sourceMainImages = sourceMainImages;
  const sourceDetailImages = normalizeCollectedSourceImageList(input.sourceDetailImages);
  if (sourceDetailImages.length) metadata.sourceDetailImages = sourceDetailImages;
  const sourcePackagingRows = normalizeCollectedPackagingRows(input.sourcePackagingRows);
  if (sourcePackagingRows.length) metadata.sourcePackagingRows = sourcePackagingRows;
  const sourceRichContentDraft = cloneMetadataJson(input.sourceRichContentDraft);
  if (sourceRichContentDraft && typeof sourceRichContentDraft === 'object') metadata.sourceRichContentDraft = sourceRichContentDraft;
  const sourceVideos = normalizeCollectedSourceVideos(input.sourceVideos);
  if (sourceVideos.length) metadata.sourceVideos = sourceVideos;
  const categoryPath = normalizeCollectedCategoryPath(input.categoryPath);
  if (categoryPath.length) metadata.categoryPath = categoryPath;
  const categoryName = cleanMetadataText(input.categoryName || categoryPath[categoryPath.length - 1], 160);
  if (categoryName) metadata.categoryName = categoryName;
  const sourceAttributes = normalizeCollectedSourceAttributes(input.attributes);
  if (sourceAttributes.length) metadata.sourceAttributes = sourceAttributes;
  const sourceStandardVariants = [
    input.selectedSku,
    ...(Array.isArray(input.skuItems) ? input.skuItems : []),
    ...(Array.isArray(input.variants) ? input.variants : []),
  ].filter((entry) => !!entry && typeof entry === 'object' && !Array.isArray(entry));
  const sourceStandardAttributes = normalizeSourceStandardAttributes({
    title: input.sourceTitleRaw ?? input.title,
    variants: sourceStandardVariants,
    metadata: {
      sourceAttributes,
      sourcePackagingRows,
      categoryPath,
      categoryName,
      weightG: finiteMetadataNumber(input.weightG),
      lengthMm: finiteMetadataNumber(input.lengthMm),
      widthMm: finiteMetadataNumber(input.widthMm),
      heightMm: finiteMetadataNumber(input.heightMm),
    },
  });
  metadata.sourceStandardAttributes = cloneMetadataJson(sourceStandardAttributes);
  const priceText = cleanMetadataText(input.priceText, 200);
  if (priceText) metadata.priceText = priceText;
  const unitPriceText = cleanMetadataText(input.unitPriceText, 200);
  if (unitPriceText) metadata.unitPriceText = unitPriceText;
  const displayPrice = cleanMetadataText(input.displayPrice, 200);
  if (displayPrice) metadata.displayPrice = displayPrice;
  const ladderPrices = cloneMetadataJson(input.ladderPrices);
  if (Array.isArray(ladderPrices) && ladderPrices.length) metadata.ladderPrices = ladderPrices;
  const priceSourceType = cleanMetadataText(input.priceSourceType, 120);
  if (priceSourceType) metadata.priceSourceType = priceSourceType;
  const priceConfidence = cleanMetadataText(input.priceConfidence, 80);
  if (priceConfidence) metadata.priceConfidence = priceConfidence;
  for (const key of ['weightG', 'lengthMm', 'widthMm', 'heightMm', 'shippingCny', 'totalCostCny'] as const) {
    const number = finiteMetadataNumber(input[key]);
    if (number != null) metadata[key] = number;
  }
  const selectedSku = cloneMetadataJson(input.selectedSku);
  if (selectedSku && typeof selectedSku === 'object') metadata.selectedSku = selectedSku;
  const skuItems = cloneMetadataJson(input.skuItems);
  if (Array.isArray(skuItems) && skuItems.length) metadata.skuItems = skuItems;
  if (input.ozonInsights) metadata.ozonInsights = cloneMetadataJson(input.ozonInsights);
  const rawSourceProduct = cloneMetadataJson(input.rawSourceProduct);
  if (rawSourceProduct && typeof rawSourceProduct === 'object') metadata.rawSourceProduct = rawSourceProduct;
  const rejectedAssets = cloneMetadataJson(input.rejectedAssets);
  if (Array.isArray(rejectedAssets) && rejectedAssets.length) metadata.rejectedAssets = rejectedAssets;
  const extractionDiagnostics = cloneMetadataJson(input.extractionDiagnostics);
  if (extractionDiagnostics && typeof extractionDiagnostics === 'object') metadata.extractionDiagnostics = extractionDiagnostics;
  if (input.descriptionFetchDiagnostics && typeof input.descriptionFetchDiagnostics === 'object') {
    metadata.descriptionFetchDiagnostics = input.descriptionFetchDiagnostics;
  }
  if (input.descriptionFetchTrace && typeof input.descriptionFetchTrace === 'object') {
    metadata.descriptionFetchTrace = input.descriptionFetchTrace;
  }
  if (isDomesticCollectedSource(metadata.sourcePlatform ?? input.sourcePlatform)) {
    const sourceProductProfile = buildSourceProductProfile({
      title: String(input.sourceTitleRaw ?? input.title ?? ''),
      sourcePlatform: String(metadata.sourcePlatform ?? input.sourcePlatform ?? ''),
      sourceProductId: String(input.sourceProductId ?? ''),
      metadata,
      variants: sourceStandardVariants,
    });
    metadata.sourceProductProfile = cloneMetadataJson(sourceProductProfile, 200);
  }
  if (titleNeedsReview) metadata.titleNeedsReview = true;
  return metadata;
}

function rewriteSourceRichContentDraftImages(value: unknown, replacements: Map<string, string>): unknown {
  if (!replacements.size) return value;
  if (typeof value === 'string') return replacements.get(value) || value;
  if (Array.isArray(value)) return value.map((item) => rewriteSourceRichContentDraftImages(item, replacements));
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = rewriteSourceRichContentDraftImages(entry, replacements);
  }
  return out;
}

function isDomesticCollectedSource(value: unknown): boolean {
  return ['1688', 'pdd', 'pinduoduo', 'taobao', 'tmall', 'xianyu', 'goofish'].includes(String(value || '').trim().toLowerCase());
}

function parsePositiveSourceMoney(value: unknown): number | null {
  if (value == null || value === '') return null;
  const raw = String(value).replace(/,/g, '').match(/([0-9]+(?:\.[0-9]+)?)/)?.[1];
  if (!raw) return null;
  const number = Number(raw);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function isGenericDomesticSourceTitle(value: unknown, platform: unknown): boolean {
  const title = String(value || '').trim();
  const source = String(platform || '').trim().toLowerCase();
  if (!title) return true;
  if (source === 'pdd' || source === 'pinduoduo') {
    return /拼多多批发\s*-\s*拼多多官方采购批发平台|拼多多官方采购批发平台|多多批发首页|^PDD\s*商品$/i.test(title);
  }
  if (source === 'taobao') return /淘宝网首页|网页无障碍|^淘宝商品$/i.test(title);
  if (source === 'tmall') return /天猫tmall|天猫首页|^天猫商品$/i.test(title);
  if (source === 'xianyu' || source === 'goofish') return /闲鱼首页|^闲鱼商品$/i.test(title);
  return false;
}

function validateDomesticCollectPayload(input: Record<string, unknown>): string | null {
  if (!isDomesticCollectedSource(input.sourcePlatform)) return null;
  const platform = input.sourcePlatform;
  const title = input.sourceTitleRaw || input.title;
  if (isGenericDomesticSourceTitle(title, platform)) {
    return '采集结果不完整：当前只读到了平台页标题，没有读到商品标题。请等页面商品信息加载完成后重新采集。';
  }

  const images = [
    ...(Array.isArray(input.images) ? input.images : []),
    ...(Array.isArray(input.sourceMainImages) ? input.sourceMainImages : []),
  ].filter(Boolean);
  const skuCount = [
    ...(Array.isArray(input.skuItems) ? input.skuItems : []),
    ...(Array.isArray(input.variants) ? input.variants : []),
  ].filter(Boolean).length;
  const attributes = Array.isArray(input.attributes) ? input.attributes.filter(Boolean).length : 0;
  const positivePrice = parsePositiveSourceMoney(input.priceText)
    ?? parsePositiveSourceMoney(input.price)
    ?? parsePositiveSourceMoney(input.totalCostCny);
  const description = String(input.description || '').trim();

  if (!images.length && !skuCount && !positivePrice && !attributes && description.length < 20) {
    return '采集结果不完整：标题、价格、SKU、图片和详情都没有形成有效命中，已阻止保存空壳商品。';
  }
  return null;
}

async function prepareCollectedSourceImageMetadata(input: {
  images?: unknown;
  sourceMainImages?: unknown;
  sourceDetailImages?: unknown;
  sourceVideos?: unknown;
  sourcePlatform?: unknown;
  sourceRichContentDraft?: unknown;
}, userId: string): Promise<{
  images: string[];
  metadataPatch: Record<string, unknown>;
}> {
  const isSource = isDomesticCollectedSource(input.sourcePlatform);
  const sourceMainFromImages = normalizeCollectedSourceImageList(input.images);
  const sourceMainFromField = normalizeCollectedSourceImageList(input.sourceMainImages);
  const mainRaw = isSource
    ? (sourceMainFromImages.length ? sourceMainFromImages : sourceMainFromField)
    : (Array.isArray(input.images) ? input.images : []);
  const detailRaw = isSource ? normalizeCollectedSourceImageList(input.sourceDetailImages) : [];

  const mainTransfer = await transferSourceProductImages({ images: mainRaw, sourcePlatform: input.sourcePlatform, userId });
  const metadataPatch: Record<string, unknown> = {};
  if (isSource && mainTransfer.images.length) metadataPatch.sourceMainImages = mainTransfer.images;
  if (mainTransfer.diagnostic) metadataPatch.sourceImageTransfer = mainTransfer.diagnostic;

  let detailImages: string[] = [];
  if (detailRaw.length) {
    const detailTransfer = await transferSourceProductImages({ images: detailRaw, sourcePlatform: input.sourcePlatform, userId });
    detailImages = detailTransfer.images;
    if (isSource && detailImages.length) metadataPatch.sourceDetailImages = detailImages;
    if (detailTransfer.diagnostic) metadataPatch.sourceDetailImageTransfer = detailTransfer.diagnostic;
  }

  if (input.sourceRichContentDraft && detailRaw.length && detailImages.length) {
    const replacements = new Map<string, string>();
    detailRaw.forEach((url, index) => {
      if (detailImages[index]) replacements.set(url, detailImages[index]!);
    });
    metadataPatch.sourceRichContentDraft = rewriteSourceRichContentDraftImages(input.sourceRichContentDraft, replacements);
  }

  if (isSource) {
    const sourceVideos = normalizeCollectedSourceVideos(input.sourceVideos);
    if (sourceVideos.length) metadataPatch.sourceVideos = sourceVideos;
  }

  return { images: mainTransfer.images, metadataPatch };
}

export function calcPublishPrice(baseCny: number, markupPct = 0, markupAmount = 0): number {
  const base = Number.isFinite(baseCny) && baseCny > 0 ? baseCny : 100;
  const pct = Number.isFinite(markupPct) ? markupPct : 0;
  const fixed = Number.isFinite(markupAmount) ? markupAmount : 0;
  return Math.max(1, Math.ceil(base * (1 + pct / 100) + fixed));
}

export function getVariantOverridePrice(
  overrides: Record<string | number, unknown> | undefined,
  variant: { sku?: unknown },
  index: number,
): number | null {
  if (!overrides) return null;
  const raw = (variant.sku != null ? overrides[String(variant.sku)] : undefined)
    ?? overrides[index]
    ?? overrides[String(index)];
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.ceil(value) : null;
}

export function resolveVariantPublishPriceCny(input: {
  itemOverrides?: Record<string | number, unknown>;
  variant: { sku?: unknown; price?: unknown };
  index: number;
  groupBasePriceCny: number;
  markupPct?: number;
  markupAmount?: number;
  fxRate?: number | null;
}): number {
  const overridePrice = getVariantOverridePrice(input.itemOverrides, input.variant, input.index);
  if (overridePrice != null) {
    return calcPublishPrice(overridePrice, input.markupPct, input.markupAmount);
  }

  const variantPriceRaw = input.variant.price != null && input.variant.price !== ''
    ? Number(input.variant.price)
    : null;
  const fxRate = Number.isFinite(Number(input.fxRate)) && Number(input.fxRate) > 0 ? Number(input.fxRate) : null;
  const variantBaseCny = variantPriceRaw != null && Number.isFinite(variantPriceRaw) && variantPriceRaw > 0
    ? (fxRate ? variantPriceRaw * fxRate : variantPriceRaw)
    : null;

  return calcPublishPrice(
    variantBaseCny != null ? variantBaseCny : input.groupBasePriceCny,
    input.markupPct,
    input.markupAmount,
  );
}

const OZON_CELL_ATTR_NAME = 'Количество ячеек, шт';
const OZON_PACK_ATTR_NAME = 'Количество в упаковке, шт';

export function parseOzonVariantSpecFromText(value: unknown): { cells: string; pack: string } | null {
  let text = String(value || '');
  try {
    text = decodeURIComponent(text);
  } catch {
    // Keep the raw value if it is not valid URI-encoded text.
  }
  if (!text) return null;

  const slugMatch = text.match(/(?:^|[-/_\s])(\d{1,5})[-_\s]*(?:yach|iach|яч)[-_\s]*(\d{1,4})[-_\s]*(?:sht|шт)(?:[-/_\s?&]|$)/i);
  if (slugMatch?.[1] && slugMatch[2]) return { cells: slugMatch[1], pack: slugMatch[2] };

  const ruMatch = text.match(/(?:^|[^\d])(\d{1,5})\s*(?:яч|ячеек|ячейки|ячейк)[^\d]{0,20}(\d{1,4})\s*(?:шт|штук)(?:[^\d]|$)/i);
  if (ruMatch?.[1] && ruMatch[2]) return { cells: ruMatch[1], pack: ruMatch[2] };

  return null;
}

function parseOzonVariantSpecFromVariant(variant: { link?: unknown; url?: unknown; title?: unknown; name?: unknown }): { cells: string; pack: string } | null {
  return parseOzonVariantSpecFromText(variant.link)
    || parseOzonVariantSpecFromText(variant.url)
    || parseOzonVariantSpecFromText(variant.title)
    || parseOzonVariantSpecFromText(variant.name);
}

export function enrichOzonVariantAttrsFromLink(
  attrs: unknown,
  variant: { link?: unknown; url?: unknown; title?: unknown; name?: unknown },
): Record<string, string> {
  const next: Record<string, string> = attrs && typeof attrs === 'object' && !Array.isArray(attrs)
    ? { ...(attrs as Record<string, string>) }
    : {};
  const spec = parseOzonVariantSpecFromVariant(variant);
  if (!spec) return next;

  if (spec.cells && !String(next[OZON_CELL_ATTR_NAME] || '').trim()) next[OZON_CELL_ATTR_NAME] = spec.cells;
  if (spec.pack && !String(next[OZON_PACK_ATTR_NAME] || '').trim()) next[OZON_PACK_ATTR_NAME] = spec.pack;
  return next;
}

export function enrichOzonVariantSpecs<T extends { attrs?: unknown; link?: unknown; url?: unknown; title?: unknown; name?: unknown }>(variants: T[]): T[] {
  return variants.map((variant) => ({
    ...variant,
    attrs: enrichOzonVariantAttrsFromLink(variant.attrs, variant),
  }));
}

export function resolvePublishName(item: { title?: string | null; metadata?: unknown }, variantAttrs?: Record<string, string>): string {
  const meta = (item.metadata && typeof item.metadata === 'object' ? item.metadata : {}) as Record<string, any>;
  const base = String(meta.publishTitleRu || meta.sourceTitleRu || item.title || '').trim();
  const cleanBase = cleanPublishName(base);
  const attrParts = normalizeVariantTitleParts(variantAttrs, /автовизитк/i.test(cleanBase), cleanBase);
  return shortenSpammyPublishName(base, attrParts).slice(0, 200);
}

export function suggestNeutralOzonPublishTitle(item: { title?: string | null; metadata?: unknown }): { suggestedTitle: string; reasons: string[] } | null {
  const meta = metadataRecord(item.metadata);
  if (String(meta.publishTitleRu || '').trim()) return null;

  const sourceTitle = String(meta.sourceTitleRu || item.title || '').trim();
  const cleanTitle = cleanPublishName(sourceTitle);
  if (!cleanTitle || containsCjkText(cleanTitle)) return null;

  const lower = cleanTitle.toLocaleLowerCase('ru-RU');
  const hasFigurine = /(^|[^\p{L}])(фигурк\p{L}*|статуэтк\p{L}*)($|[^\p{L}])/iu.test(lower);
  const hasRiskyTerms = /(^|[^\p{L}])(девочк\p{L}*|девушк\p{L}*|прозрачн\p{L}*|лисиц\p{L}*|аниме|манг\p{L}*)($|[^\p{L}])/iu.test(lower);
  if (hasFigurine && hasRiskyTerms) {
    const height = cleanTitle.match(/(^|[^\p{L}\p{N}])(\d{1,3})\s*(?:см|cm)($|[^\p{L}])/iu)?.[2];
    return {
      suggestedTitle: cleanPublishName(`Коллекционная декоративная фигурка${height ? `, ${height} см` : ''}`),
      reasons: ['标题含可能触发 Ozon 审核的敏感/营销词，建议改成中性商品名'],
    };
  }

  const hasBodyHairMist = /(^|[^\p{L}])мист($|[^\p{L}])/iu.test(lower)
    && /(^|[^\p{L}])тел[ао]($|[^\p{L}])/iu.test(lower)
    && /(^|[^\p{L}])волос($|[^\p{L}])/iu.test(lower);
  if (hasBodyHairMist) {
    const volume = cleanTitle.match(/(^|[^\p{L}\p{N}])(\d{1,5}(?:[,.]\d+)?)\s*(?:мл|ml)($|[^\p{L}])/iu)?.[2];
    return {
      suggestedTitle: cleanPublishName(`Парфюмированный мист для тела и волос${volume ? `, ${volume} мл` : ''}`),
      reasons: ['标题含品牌/变体后缀或疑似堆词，建议改成中性商品名'],
    };
  }

  return null;
}

export function syncOzonTitleAttribute<T extends { id: number; complex_id?: number; values: any[] }>(
  attributes: T[] | null | undefined,
  title: string,
): Array<T | { id: number; complex_id: number; values: { value: string }[] }> {
  return syncOzonCoreTextAttributes(attributes, title);
}

export function syncOzonCoreTextAttributes<T extends { id: number; complex_id?: number; values: any[] }>(
  attributes: T[] | null | undefined,
  title: string,
  description?: unknown,
): Array<T | { id: number; complex_id: number; values: { value: string }[] }> {
  const cleanTitle = cleanPublishName(title).slice(0, 200);
  const cleanDescription = sanitizePublishDescription(description);
  const attrs = Array.isArray(attributes)
    ? attributes.filter((attr) => Number(attr.id) !== 4180 && (cleanDescription ? Number(attr.id) !== 4191 : true))
    : [];
  const next: Array<T | { id: number; complex_id: number; values: { value: string }[] }> = [...attrs];
  if (cleanTitle) {
    next.push({
      id: 4180,
      complex_id: 0,
      values: [{ value: cleanTitle }],
    });
  }
  if (cleanDescription) {
    next.push({
      id: 4191,
      complex_id: 0,
      values: [{ value: cleanDescription }],
    });
  }
  return next;
}

export function syncOzonVariantGroupingAttributes<T extends { id: number; complex_id?: number; values: any[] }>(
  attributes: T[] | null | undefined,
  importItem: { offer_id?: unknown; _sourceModelId?: unknown; _sourceItemId?: unknown },
): Array<T | { id: number; complex_id: number; values: { value: string; dictionary_value_id: number }[] }> {
  const MERGE_ATTR_ID = 8292;
  const mergeValue = importItem._sourceModelId || `model-${importItem._sourceItemId || 'group'}`;
  const attrs = Array.isArray(attributes)
    ? attributes.filter((attr) => Number(attr.id) !== MERGE_ATTR_ID)
    : [];
  return [
    ...attrs,
    {
      id: MERGE_ATTR_ID,
      complex_id: 0,
      values: [{ value: String(mergeValue), dictionary_value_id: 0 }],
    },
  ];
}

const OZON_VARIANT_ATTR_NAME_BY_ID: Record<number, string> = {
  10096: 'Цвет',
  10097: 'Название цвета',
  4295: 'Российский размер',
  9533: 'Размер производителя',
  9688: 'Размер производителя',
  9689: 'Российский размер',
  9695: 'Российский размер',
};

function getOzonVariantAttrKind(value: { id?: number | null; name?: string | null } | string | number | null | undefined): string {
  if (typeof value === 'number') {
    const known = OZON_VARIANT_ATTR_NAME_BY_ID[value];
    return known ? getOzonVariantAttrKind(known) : '';
  }
  if (typeof value === 'string') {
    const text = value.toLocaleLowerCase('ru-RU');
    if (/цвет|color|colour/i.test(text)) return 'color';
    if (/размер|size/i.test(text)) return 'size';
    if (/об[ъь]е?м|volume|мл|ml/i.test(text)) return 'volume';
    if (/аромат|запах|scent|fragrance/i.test(text)) return 'scent';
    if (/модель|model/i.test(text)) return 'model';
    if (/ячеек|ячеек|ячейки|яч/i.test(text)) return 'cells';
    if (/упаковк|pack/i.test(text)) return 'pack';
    return '';
  }
  if (value && typeof value === 'object') {
    return getOzonVariantAttrKind(
      value.name
      || (value.id != null ? OZON_VARIANT_ATTR_NAME_BY_ID[Number(value.id)] : '')
      || (value.id != null ? Number(value.id) : ''),
    );
  }
  return '';
}

export function shouldApplyCollectedVariantAttrOverride(
  attributes: Array<{ id: number; complex_id?: number; values?: any[] }> | null | undefined,
  attrId: number,
): boolean {
  const targetKind = getOzonVariantAttrKind(Number(attrId));
  if (!targetKind) return true;
  const attrs = Array.isArray(attributes) ? attributes : [];
  return !attrs.some((attr) => {
    if (!Array.isArray(attr?.values) || !attr.values.length) return false;
    return getOzonVariantAttrKind({
      id: Number(attr?.id),
      name: OZON_VARIANT_ATTR_NAME_BY_ID[Number(attr?.id)] || null,
    }) === targetKind;
  });
}

type OzonDictionaryEntry = { id: number; value?: string | null };
type OzonResolvedAttributeValue = { value: string; dictionary_value_id: number };
type OzonDictionaryResolveOptions = {
  allowTextFallback?: boolean;
  allowPartialDictionaryValues?: boolean;
};

export function resolveOzonDictionaryAttributeValues(
  rawValue: unknown,
  dict: OzonDictionaryEntry[],
  options?: OzonDictionaryResolveOptions,
): { values: OzonResolvedAttributeValue[]; matched: boolean; matchType: 'exact' | 'split' | 'partial' | 'text-fallback' | 'empty' } {
  const text = sanitizeOzonAttrText(rawValue);
  if (!text) return { values: [], matched: false, matchType: 'empty' };
  const allowTextFallback = options?.allowTextFallback !== false;
  const allowPartialDictionaryValues = options?.allowPartialDictionaryValues === true;
  const entries = Array.isArray(dict) ? dict.filter((entry) => Number.isFinite(Number(entry.id)) && String(entry.value || '').trim()) : [];
  const uniqueResolvedValues = (values: Array<OzonDictionaryEntry | null | undefined>) => {
    const seen = new Set<number>();
    return values
      .filter((entry): entry is OzonDictionaryEntry => !!entry)
      .map(toOzonResolvedAttributeValue)
      .filter((value) => {
        if (seen.has(value.dictionary_value_id)) return false;
        seen.add(value.dictionary_value_id);
        return true;
      });
  };

  if (isLikelyDescriptiveColorVariantValue(text)) {
    const extractedColor = extractSafeColorValue(text);
    if (!extractedColor) return { values: [], matched: false, matchType: 'empty' };
    const extractedParts = splitOzonCompositeDictionaryValue(extractedColor);
    const resolvedExtracted = extractedParts.map((part) => findOzonDictionaryEntry(entries, part, true));
    if (resolvedExtracted.every(Boolean)) {
      return {
        values: uniqueResolvedValues(resolvedExtracted),
        matched: true,
        matchType: 'split',
      };
    }
    if (allowPartialDictionaryValues) {
      const partialValues = uniqueResolvedValues(resolvedExtracted);
      if (partialValues.length) return { values: partialValues, matched: true, matchType: 'partial' };
    }
    return { values: [], matched: false, matchType: 'empty' };
  }

  const exact = findOzonDictionaryEntry(entries, text, false);
  if (exact) {
    return { values: [toOzonResolvedAttributeValue(exact)], matched: true, matchType: 'exact' };
  }

  const parts = splitOzonCompositeDictionaryValue(text);
  if (parts.length > 1) {
    const resolvedParts = parts.map((part) => findOzonDictionaryEntry(entries, part, true));
    if (resolvedParts.every(Boolean)) {
      const values = uniqueResolvedValues(resolvedParts);
      return { values, matched: true, matchType: 'split' };
    }

    const strictColor = extractStrictOzonColorValue(text);
    if (strictColor) {
      const strictParts = splitOzonCompositeDictionaryValue(strictColor);
      const resolvedStrictParts = strictParts.map((part) => findOzonDictionaryEntry(entries, part, true));
      if (strictParts.length === parts.length && resolvedStrictParts.length && resolvedStrictParts.every(Boolean)) {
        return { values: uniqueResolvedValues(resolvedStrictParts), matched: true, matchType: 'split' };
      }
      if (allowPartialDictionaryValues) {
        const partialValues = uniqueResolvedValues(resolvedStrictParts);
        if (partialValues.length) return { values: partialValues, matched: true, matchType: 'partial' };
      }
    }

    if (!allowTextFallback) return { values: [], matched: false, matchType: 'empty' };
    return { values: [{ value: text, dictionary_value_id: 0 }], matched: false, matchType: 'text-fallback' };
  }

  const extractedColor = extractSafeColorValue(text);
  if (extractedColor && normalizeOzonDictionaryText(extractedColor) !== normalizeOzonDictionaryText(text)) {
    const extractedParts = splitOzonCompositeDictionaryValue(extractedColor);
    const resolvedExtracted = extractedParts.map((part) => findOzonDictionaryEntry(entries, part, true));
    if (resolvedExtracted.every(Boolean)) {
      return {
        values: uniqueResolvedValues(resolvedExtracted),
        matched: true,
        matchType: 'split',
      };
    }
    if (allowPartialDictionaryValues) {
      const partialValues = uniqueResolvedValues(resolvedExtracted);
      if (partialValues.length) return { values: partialValues, matched: true, matchType: 'partial' };
    }
  }

  const partial = isSafeLooseDictionaryMatch(text)
    ? findOzonDictionaryEntry(entries, text, true)
    : null;
  if (partial) {
    return { values: [toOzonResolvedAttributeValue(partial)], matched: true, matchType: 'partial' };
  }

  if (!allowTextFallback) return { values: [], matched: false, matchType: 'empty' };
  return { values: [{ value: text, dictionary_value_id: 0 }], matched: false, matchType: 'text-fallback' };
}

function isSafeLooseDictionaryMatch(value: string): boolean {
  const text = normalizeOzonDictionaryText(value);
  if (!text) return false;
  if (/\s/.test(text)) return false;
  if (/[-/]/.test(text)) return false;
  if (/[a-zа-я]+\d|\d+[a-zа-я]/iu.test(text)) return false;
  return true;
}

function toOzonResolvedAttributeValue(entry: OzonDictionaryEntry): OzonResolvedAttributeValue {
  return {
    value: String(entry.value || '').trim(),
    dictionary_value_id: Number(entry.id),
  };
}

function resolveUnisexAdultGenderDictionaryValues(dict: OzonDictionaryEntry[]): OzonResolvedAttributeValue[] {
  const entries = Array.isArray(dict) ? dict.filter((entry) => Number.isFinite(Number(entry.id)) && String(entry.value || '').trim()) : [];
  const findExact = (aliases: string[]) => aliases
    .map((alias) => entries.find((entry) => normalizeOzonDictionaryText(entry.value) === normalizeOzonDictionaryText(alias)))
    .find((entry): entry is OzonDictionaryEntry => !!entry) || null;

  const male = findExact(['Мужской', 'Для мужчин', 'Мужчины', 'Male']);
  const female = findExact(['Женский', 'Для женщин', 'Женщины', 'Female']);
  if (!male || !female) return [];

  const seen = new Set<number>();
  return [male, female]
    .map(toOzonResolvedAttributeValue)
    .filter((value) => {
      if (seen.has(value.dictionary_value_id)) return false;
      seen.add(value.dictionary_value_id);
      return true;
    });
}

function normalizeOzonDictionaryText(value: unknown): string {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeVariantConflictValue(value: unknown): string {
  return cleanPublishName(value)
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function findVariantAttributeConflicts(
  variantsInput: unknown,
): Array<{ skus: string[]; attrs: Record<string, string> }> {
  const variants = Array.isArray(variantsInput) ? variantsInput as any[] : [];
  const bySignature = new Map<string, { skus: string[]; attrs: Record<string, string> }>();
  const sanitizedAttrSets = sanitizeVariantAttrSetsForOzonPublish(variants.map((variant) => (
    variant?.attrs && typeof variant.attrs === 'object'
      ? variant.attrs as Record<string, string>
      : undefined
  )));

  for (let index = 0; index < variants.length; index += 1) {
    const variant = variants[index];
    const sku = String(variant?.sku || '').trim();
    if (!sku) continue;
    const attrs = sanitizedAttrSets[index] || {};
    const entries = Object.entries(attrs)
      .map(([name, value]) => [cleanPublishName(name), cleanPublishName(value)] as const)
      .filter(([name, value]) => name && value)
      .sort(([a], [b]) => a.localeCompare(b, 'ru-RU'));
    if (!entries.length) continue;
    const signature = entries
      .map(([name, value]) => `${normalizeVariantConflictValue(name)}=${normalizeVariantConflictValue(value)}`)
      .join('|');
    if (!signature) continue;
    const existing = bySignature.get(signature);
    if (existing) {
      existing.skus.push(sku);
      continue;
    }
    bySignature.set(signature, {
      skus: [sku],
      attrs: Object.fromEntries(entries),
    });
  }

  return Array.from(bySignature.values())
    .filter((entry) => entry.skus.length > 1);
}

function splitOzonCompositeDictionaryValue(value: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const rawPart of value.split(/\s*(?:,|;|\+|，|、|；|&)\s*/u)) {
    const part = rawPart.trim();
    const key = normalizeOzonDictionaryText(part);
    if (!part || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(part);
  }
  return out;
}

function findOzonDictionaryEntry(
  dict: OzonDictionaryEntry[],
  rawTarget: string,
  allowLooseMatch: boolean,
): OzonDictionaryEntry | null {
  const target = normalizeOzonDictionaryText(rawTarget);
  if (!target) return null;

  const exact = dict.find((entry) => normalizeOzonDictionaryText(entry.value) === target);
  if (exact) return exact;

  const numToken = target.match(/^(\d+)/)?.[1];
  if (numToken) {
    const numeric = dict.find((entry) => normalizeOzonDictionaryText(entry.value) === numToken);
    if (numeric) return numeric;
  }

  if (!allowLooseMatch) return null;
  return dict.find((entry) => {
    const value = normalizeOzonDictionaryText(entry.value);
    return value && value.includes(target);
  }) || dict.find((entry) => {
    const value = normalizeOzonDictionaryText(entry.value);
    return value.length >= 2 && target.includes(value);
  }) || null;
}

function findOzonOriginChinaEntry(dict: OzonDictionaryEntry[]): OzonDictionaryEntry | null {
  return findOzonDictionaryEntry(dict, 'Китай', true)
    || findOzonDictionaryEntry(dict, 'China', true)
    || findOzonDictionaryEntry(dict, '中国', true)
    || null;
}

function isOzonOriginRussiaValue(value: unknown, dict: OzonDictionaryEntry[]): boolean {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const dictionaryId = Number(row.dictionary_value_id);
  if (Number.isFinite(dictionaryId) && dictionaryId > 0) {
    const dictEntry = dict.find((entry) => Number(entry.id) === dictionaryId);
    if (dictEntry && isOzonOriginRussiaText(dictEntry.value)) return true;
  }
  return isOzonOriginRussiaText(row.value);
}

function isOzonOriginRussiaText(value: unknown): boolean {
  const text = normalizeOzonDictionaryText(value);
  return text === 'россия'
    || text === 'russia'
    || text === 'ru'
    || text === 'российская федерация'
    || text.includes('российск')
    || text.includes('russian federation');
}

export function normalizeOzonOriginCountryForChinaSeller<T extends { id: number; complex_id?: number; values: any[] }>(
  attributes: T[] | null | undefined,
  originCountryDict: OzonDictionaryEntry[] = [],
): Array<T | { id: number; complex_id?: number; values: { value: string; dictionary_value_id: number }[] }> {
  const attrs = Array.isArray(attributes) ? attributes : [];
  const china = findOzonOriginChinaEntry(originCountryDict);
  const chinaValue = String(china?.value || 'Китай').trim();
  const chinaDictionaryId = Number(china?.id) || 0;
  const hasOriginCountryAttr = attrs.some((attr) => Number(attr.id) === OZON_ORIGIN_COUNTRY_ATTR_ID);
  const normalized: Array<T | { id: number; complex_id?: number; values: { value: string; dictionary_value_id: number }[] }> = attrs.map((attr) => {
    if (Number(attr.id) !== OZON_ORIGIN_COUNTRY_ATTR_ID) return attr;
    const values = Array.isArray(attr.values) ? attr.values : [];
    if (!values.some((value) => isOzonOriginRussiaValue(value, originCountryDict))) return attr;
    return {
      ...attr,
      values: [{ value: chinaValue, dictionary_value_id: chinaDictionaryId }],
    };
  });
  if (!hasOriginCountryAttr && chinaDictionaryId > 0) {
    normalized.push({
      id: OZON_ORIGIN_COUNTRY_ATTR_ID,
      complex_id: 0,
      values: [{ value: chinaValue, dictionary_value_id: chinaDictionaryId }],
    });
  }
  return normalized;
}

export function normalizeOzonMarkingCodeRequirementForChinaSeller<T extends { id: number; complex_id?: number; values: any[] }>(
  attributes: T[] | null | undefined,
  categoryAttrs: Array<{ id?: unknown; name?: unknown }> | null | undefined = [],
): Array<T | { id: number; complex_id: number; values: { value: string; dictionary_value_id: number }[] }> {
  const attrs = Array.isArray(attributes) ? attributes : [];
  const hasExistingMarkingAttr = attrs.some((attr) => Number(attr.id) === OZON_MARKING_CODE_REQUIRED_ATTR_ID);
  const categorySupportsMarkingAttr = Array.isArray(categoryAttrs)
    && categoryAttrs.some((attr) => Number(attr?.id) === OZON_MARKING_CODE_REQUIRED_ATTR_ID);
  if (!hasExistingMarkingAttr && !categorySupportsMarkingAttr) return attrs;

  return [
    ...attrs.filter((attr) => Number(attr.id) !== OZON_MARKING_CODE_REQUIRED_ATTR_ID),
    {
      id: OZON_MARKING_CODE_REQUIRED_ATTR_ID,
      complex_id: 0,
      values: [{ value: 'false', dictionary_value_id: 0 }],
    },
  ];
}

type SourceStandardOzonAttributeKey = 'brand' | 'colors' | 'sizes' | 'materials' | 'gender' | 'seasons';

type SourceStandardOzonAttributeDef = {
  id: number;
  name: string;
  is_required?: boolean;
  dictionary_id?: number | null;
};

type SourceStandardOzonAttributePlanCandidate = {
  standardKey: SourceStandardOzonAttributeKey;
  attributeId: number;
  attributeName: string;
  required: boolean;
  dictionaryId: number | null;
  needsDictionaryResolution: boolean;
  values: string[];
};

type SourceStandardOzonAttributePlanGap = {
  attributeId: number;
  attributeName: string;
  standardKey: SourceStandardOzonAttributeKey | 'unknown';
  reason: 'no_source_standard_value';
};

function sourceStandardOzonAttributeKey(attr: { id?: unknown; name?: unknown }): SourceStandardOzonAttributeKey | null {
  const name = normalizeOzonDictionaryText(attr.name);
  if (Number(attr.id) === 85 || /^(бренд|brand)$/.test(name)) return 'brand';
  if (/название цвета|color name|colour name/.test(name)) return null;
  if (/цвет|color|colour/.test(name)) return 'colors';
  if (name === 'российский размер' || Number(attr.id) === 4295 || Number(attr.id) === 9689 || Number(attr.id) === 9695) return 'sizes';
  if (/материал|состав|material|composition|ткань|fabric/.test(name)) return 'materials';
  if (/^(пол|gender)$/.test(name) || /для кого|кому подходит/.test(name)) return 'gender';
  if (/сезон|season/.test(name)) return 'seasons';
  return null;
}

function sourceStandardOzonValues(standard: Record<string, any>, key: SourceStandardOzonAttributeKey): string[] {
  if (key === 'brand') {
    const value = String(standard.brand?.value || '').trim();
    if (value) return [value];
    return standard.brand?.isBrandless ? ['Без бренда'] : [];
  }
  if (key === 'colors') {
    if (!Array.isArray(standard.colors)) return [];
    const colors = standard.colors.map((value) => translateSourceColorValueToOzon(value) || String(value || '').trim()).filter(Boolean);
    return colors.length > 5 ? ['Разноцветный'] : colors;
  }
  if (key === 'sizes') return Array.isArray(standard.sizes) ? sanitizeSourceStandardSizeValues(standard.sizes).map(sourceInternationalSizeToRussianSize).filter(Boolean) : [];
  if (key === 'materials') return Array.isArray(standard.materials) ? standard.materials.map(translateSourceMaterialValueToOzon).filter(Boolean) : [];
  if (key === 'gender') {
    const value = String(standard.gender?.value || '').trim();
    if (value === 'female') return ['Женский'];
    if (value === 'male') return ['Мужской'];
    if (value === 'unisex') return ['Унисекс'];
    return value ? [value] : [];
  }
  if (key === 'seasons') {
    const labels: Record<string, string> = {
      'all-season': 'Всесезонный',
      spring: 'Весна',
      summer: 'Лето',
      autumn: 'Осень',
      winter: 'Зима',
    };
    return Array.isArray(standard.seasons) ? standard.seasons.map((value) => labels[String(value)] || String(value || '').trim()).filter(Boolean) : [];
  }
  return [];
}

export function buildSourceStandardOzonAttributePlan(
  standard: Record<string, any>,
  categoryAttrs: SourceStandardOzonAttributeDef[] | null | undefined,
  existingAttributes: Array<{ id?: unknown; values?: unknown }> | null | undefined = [],
): { candidates: SourceStandardOzonAttributePlanCandidate[]; missingRequired: SourceStandardOzonAttributePlanGap[] } {
  const existingIds = new Set((Array.isArray(existingAttributes) ? existingAttributes : [])
    .map((attr) => Number(attr?.id))
    .filter((id) => Number.isFinite(id) && id > 0));
  const candidates: SourceStandardOzonAttributePlanCandidate[] = [];
  const missingRequired: SourceStandardOzonAttributePlanGap[] = [];
  for (const attr of Array.isArray(categoryAttrs) ? categoryAttrs : []) {
    const attributeId = Number(attr.id);
    if (!Number.isFinite(attributeId) || attributeId <= 0 || existingIds.has(attributeId)) continue;
    const standardKey = sourceStandardOzonAttributeKey(attr);
    if (!standardKey) continue;
    const values = sourceStandardOzonValues(standard || {}, standardKey);
    if (values.length) {
      const dictionaryId = Number(attr.dictionary_id);
      candidates.push({
        standardKey,
        attributeId,
        attributeName: String(attr.name || ''),
        required: attr.is_required === true,
        dictionaryId: Number.isFinite(dictionaryId) && dictionaryId > 0 ? dictionaryId : null,
        needsDictionaryResolution: Number.isFinite(dictionaryId) && dictionaryId > 0,
        values,
      });
    } else if (attr.is_required === true) {
      missingRequired.push({
        attributeId,
        attributeName: String(attr.name || ''),
        standardKey,
        reason: 'no_source_standard_value',
      });
    }
  }
  return { candidates, missingRequired };
}

type SourceStandardOzonPublishAttributeInput = {
  standard: Record<string, any>;
  categoryAttrs: SourceStandardOzonAttributeDef[] | null | undefined;
  existingAttributes?: Array<{ id: number; complex_id?: number; values?: any[] }> | null | undefined;
  getAttributeDictValues?: (attributeId: number, candidate: SourceStandardOzonAttributePlanCandidate) => Promise<OzonDictionaryEntry[]> | OzonDictionaryEntry[];
};

type SourceStandardOzonPublishAttributeApplied = {
  standardKey: SourceStandardOzonAttributeKey;
  attributeId: number;
  attributeName: string;
  matchType: 'exact' | 'split' | 'partial' | 'text-fallback' | 'empty';
  valueCount: number;
};

export async function buildSourceStandardOzonPublishAttributes(input: SourceStandardOzonPublishAttributeInput): Promise<{
  attributes: Array<{ id: number; complex_id: number; values: OzonResolvedAttributeValue[] }>;
  applied: SourceStandardOzonPublishAttributeApplied[];
  missingRequired: SourceStandardOzonAttributePlanGap[];
}> {
  const existingAttributes = Array.isArray(input.existingAttributes) ? input.existingAttributes : [];
  const plan = buildSourceStandardOzonAttributePlan(input.standard || {}, input.categoryAttrs, existingAttributes);
  const attributes: Array<{ id: number; complex_id: number; values: OzonResolvedAttributeValue[] }> = [];
  const applied: SourceStandardOzonPublishAttributeApplied[] = [];

  for (const candidate of plan.candidates) {
    const dictionaryId = Number(candidate.dictionaryId);
    let resolvedValues: OzonResolvedAttributeValue[] = [];
    let matchType: SourceStandardOzonPublishAttributeApplied['matchType'] = 'text-fallback';

    if (Number.isFinite(dictionaryId) && dictionaryId > 0 && input.getAttributeDictValues) {
      const dict = await input.getAttributeDictValues(candidate.attributeId, candidate);
      const allowTextFallback = false;
      const allowPartialDictionaryValues = candidate.standardKey === 'colors';
      const collected: OzonResolvedAttributeValue[] = [];
      for (const value of candidate.values) {
        const resolved = resolveOzonDictionaryAttributeValues(value, dict, {
          allowTextFallback,
          allowPartialDictionaryValues,
        });
        matchType = resolved.matchType;
        for (const item of resolved.values) {
          if (!collected.some((existing) => existing.dictionary_value_id === item.dictionary_value_id)) collected.push(item);
        }
      }
      if (!collected.length && candidate.standardKey === 'gender' && candidate.values.some((value) => normalizeOzonDictionaryText(value) === 'унисекс')) {
        collected.push(...resolveUnisexAdultGenderDictionaryValues(dict));
        if (collected.length) matchType = 'exact';
      }
      resolvedValues = collected;
    } else if (!Number.isFinite(dictionaryId) || dictionaryId <= 0) {
      resolvedValues = candidate.values
        .map((value) => sanitizeOzonAttrText(value))
        .filter((value) => value && !containsCjkText(value))
        .map((value) => ({ value, dictionary_value_id: 0 }));
    }

    if (!resolvedValues.length) continue;
    attributes.push({
      id: candidate.attributeId,
      complex_id: 0,
      values: resolvedValues,
    });
    applied.push({
      standardKey: candidate.standardKey,
      attributeId: candidate.attributeId,
      attributeName: candidate.attributeName,
      matchType,
      valueCount: resolvedValues.length,
    });
  }

  return { attributes, applied, missingRequired: plan.missingRequired };
}

function normalizeSourceCategoryToken(value: unknown): string {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function sourceCategorySignature(item: { sourcePlatform?: unknown; metadata?: unknown }): string {
  const meta = metadataRecord(item.metadata);
  const platform = normalizeSourceCategoryToken(item.sourcePlatform || meta.sourcePlatform || 'source');
  const path = Array.isArray(meta.categoryPath) ? meta.categoryPath : [];
  const parts = path.map(normalizeSourceCategoryToken).filter(Boolean);
  const categoryName = normalizeSourceCategoryToken(meta.categoryName);
  if (categoryName && !parts.includes(categoryName)) parts.push(categoryName);
  return platform + '|' + parts.join('>');
}

export function sourceOzonLegacyConfirmedMappingWhere(userId: string, signature: string) {
  return {
    userId: String(userId || '').trim(),
    metadata: {
      path: ['sourceOzonCategoryConfirmed', 'signature'],
      equals: String(signature || '').trim(),
    },
  };
}

type SourceOzonConfirmedMapping = {
  signature: string;
  categoryId: number;
  typeId: number;
  categoryName?: string | null;
  typeName?: string | null;
  confirmations?: number;
  mappingId?: string | null;
  transitionVersion?: number;
};

type SourceOzonCategoryTreeNode = {
  description_category_id?: number;
  category_name?: string;
  type_id?: number;
  type_name?: string;
  children?: SourceOzonCategoryTreeNode[];
};

type SourceOzonCategoryCandidate = {
  categoryId: number;
  typeId: number;
  categoryName: string;
  typeName: string;
  categoryNameZh: string;
  typeNameZh: string;
  displayPathZh: string;
  displayPathRu: string;
  translationStatus: OzonCategoryTranslationStatus;
  untranslatedTerms: string[];
  score: number;
  label: 'recommended' | 'optional' | 'risky';
  selected: boolean;
  source: 'shared_history' | 'tree_match';
  confirmationCount: number;
  mappingId: string | null;
  transitionVersion: number;
  reasons: string[];
  attributePlan: ReturnType<typeof buildSourceStandardOzonAttributePlan>;
};

function translateOzonCategoryText(value: unknown): string {
  const translated = translateOzonCategoryCatalogText(value);
  return containsCjkText(translated) && !containsCyrillicText(translated) ? translated : '';
}

function sourceOzonCategoryKey(categoryId: number, typeId: number): string {
  return String(categoryId) + ':' + String(typeId);
}

function uniqueCleanStrings(values: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function fallbackOzonCategoryTranslationAudit(parts: Array<{ raw: string; zh: string }>): {
  translationStatus: OzonCategoryTranslationStatus;
  untranslatedTerms: string[];
} {
  const meaningful = parts.filter((part) => String(part.raw || '').trim());
  const untranslatedTerms = uniqueCleanStrings(meaningful
    .filter((part) => !part.zh && !containsCjkText(part.raw))
    .map((part) => part.raw));
  if (untranslatedTerms.length === 0) return { translationStatus: 'complete', untranslatedTerms };
  const translatedCount = meaningful.filter((part) => !!part.zh).length;
  return {
    translationStatus: translatedCount > 0 ? 'partial' : 'missing',
    untranslatedTerms,
  };
}

function flattenOzonCategoryTree(nodes: SourceOzonCategoryTreeNode[] | null | undefined): Array<{ categoryId: number; typeId: number; categoryName: string; typeName: string }> {
  const out: Array<{ categoryId: number; typeId: number; categoryName: string; typeName: string }> = [];
  const walk = (rows: SourceOzonCategoryTreeNode[], parentCategory?: { id: number; name: string }) => {
    for (const row of rows) {
      const categoryId = Number(row.description_category_id);
      const typeId = Number(row.type_id);
      const currentCategory = Number.isFinite(categoryId) && categoryId > 0
        ? { id: categoryId, name: String(row.category_name || parentCategory?.name || '') }
        : parentCategory;
      if (currentCategory && Number.isFinite(typeId) && typeId > 0) {
        out.push({
          categoryId: currentCategory.id,
          typeId,
          categoryName: currentCategory.name,
          typeName: String(row.type_name || ''),
        });
      }
      if (Array.isArray(row.children)) walk(row.children, currentCategory);
    }
  };
  walk(Array.isArray(nodes) ? nodes : []);
  return out;
}


function isAdultSourceCategoryTerms(sourceTerms: string[]): boolean {
  const text = sourceTerms.join(' ');
  return /成人用品|情趣| секс|adult|интим|эротич|анальн|вагинальн|эрекц/i.test(text);
}

function isAdultOzonCategoryCandidate(candidate: { categoryName?: string | null; typeName?: string | null }): boolean {
  const text = normalizeSourceCategoryToken(String(candidate.categoryName || '') + ' ' + String(candidate.typeName || ''));
  return /товары для взрослых|секс|интим|эротич|анальн|вагинальн|эрекц|adult|成人用品|情趣/.test(text);
}

function isGenericSourceCategorySignature(signature: string): boolean {
  const rawParts = String(signature || '').split('|')[1] || '';
  const parts = rawParts.split('>').map(normalizeSourceCategoryToken).filter(Boolean);
  if (parts.length === 0) return true;
  const unique = Array.from(new Set(parts));
  return unique.every((part) => /^(服装|服饰|服饰内衣|衣服|clothing|одежда)$/.test(part));
}


export function buildSourceOzonCategoryCandidates(input: {
  item: { sourcePlatform?: unknown; metadata?: unknown; title?: unknown; variants?: unknown };
  sourceSignature?: string;
  sourceProfile?: SourceProductProfile;
  categoryTree?: SourceOzonCategoryTreeNode[] | null;
  categoryCatalog?: OzonCategoryCatalogEntry[] | null;
  attributesByCategory?: Record<string, SourceStandardOzonAttributeDef[]>;
  confirmedMappings?: SourceOzonConfirmedMapping[];
}): SourceOzonCategoryCandidate[] {
  const signature = String(input.sourceSignature || '').trim() || sourceCategorySignature(input.item);
  const meta = metadataRecord(input.item.metadata);
  const standard = getCollectedSourceStandardAttributes(input.item) || metadataRecord(meta.sourceStandardAttributes);
  const sourceProfile = input.sourceProfile || buildSourceProductProfile({
    title: input.item.title == null ? null : String(input.item.title),
    sourcePlatform: input.item.sourcePlatform == null ? null : String(input.item.sourcePlatform),
    metadata: input.item.metadata,
  });
  const sourceTerms = [
    ...(Array.isArray(meta.categoryPath) ? meta.categoryPath : []),
    meta.categoryName,
    input.item.title,
    sourceProfile.sourceTitle,
    sourceProfile.categoryName,
    ...sourceProfile.categoryPath,
    ...sourceProfile.categoryHints,
    ...sourceProfile.productIntentTerms,
    ...sourceProfile.productTypeHints,
    ...sourceProfile.genderSeasonHints,
  ].flatMap(sourceCategorySearchTerms).filter(Boolean);
  const byKey = new Map<string, SourceOzonCategoryCandidate>();
  const allCatalogRows = Array.isArray(input.categoryCatalog) ? input.categoryCatalog : [];
  const disabledCatalogKeys = new Set(allCatalogRows
    .filter((entry) => entry.disabled === true || entry.selectable === false)
    .map((entry) => sourceOzonCategoryKey(entry.descriptionCategoryId, entry.typeId)));
  const catalogRows = allCatalogRows.filter((entry) => (
    entry.disabled !== true && entry.selectable !== false
  ));
  const catalogByKey = new Map(catalogRows.map((entry) => [sourceOzonCategoryKey(entry.descriptionCategoryId, entry.typeId), entry]));
  const treeRowsByKey = new Map<string, { categoryId: number; typeId: number; categoryName: string; typeName: string }>();
  for (const row of flattenOzonCategoryTree(input.categoryTree)) {
    const key = sourceOzonCategoryKey(row.categoryId, row.typeId);
    if (!disabledCatalogKeys.has(key)) treeRowsByKey.set(key, row);
  }
  for (const entry of catalogRows) {
    const key = sourceOzonCategoryKey(entry.descriptionCategoryId, entry.typeId);
    if (!treeRowsByKey.has(key)) {
      treeRowsByKey.set(key, {
        categoryId: entry.descriptionCategoryId,
        typeId: entry.typeId,
        categoryName: entry.categoryNameRu,
        typeName: entry.typeNameRu,
      });
    }
  }
  const treeRows = Array.from(treeRowsByKey.values());
  const treeByKey = new Map(treeRows.map((row) => [String(row.categoryId) + ':' + String(row.typeId), row]));
  const addCandidate = (row: { categoryId: number; typeId: number; categoryName?: string | null; typeName?: string | null }, baseScore: number, source: 'shared_history' | 'tree_match', reasons: string[], confirmationCount = 0) => {
    const key = sourceOzonCategoryKey(row.categoryId, row.typeId);
    if (disabledCatalogKeys.has(key)) return;
    const tree = treeByKey.get(key);
    const catalog = catalogByKey.get(key);
    const attrs = input.attributesByCategory?.[key] || [];
    const attributePlan = buildSourceStandardOzonAttributePlan(standard, attrs, []);
    const coverageScore = attributePlan.candidates.length * 6 - attributePlan.missingRequired.length * 10;
    const existing = byKey.get(key);
    const score = baseScore + coverageScore;
    const categoryName = String(row.categoryName || catalog?.categoryNameRu || tree?.categoryName || '');
    const typeName = String(row.typeName || catalog?.typeNameRu || tree?.typeName || '');
    const categoryNameZh = catalog ? catalog.categoryNameZh : translateOzonCategoryText(categoryName);
    const typeNameZh = catalog ? catalog.typeNameZh : translateOzonCategoryText(typeName);
    const fallbackAudit = fallbackOzonCategoryTranslationAudit([
      { raw: categoryName, zh: categoryNameZh },
      { raw: typeName, zh: typeNameZh },
    ]);
    const candidate: SourceOzonCategoryCandidate = {
      categoryId: row.categoryId,
      typeId: row.typeId,
      categoryName,
      typeName,
      categoryNameZh,
      typeNameZh,
      displayPathZh: catalog?.displayPathZh || '',
      displayPathRu: catalog?.displayPathRu || '',
      translationStatus: catalog?.translationStatus || fallbackAudit.translationStatus,
      untranslatedTerms: catalog?.untranslatedTerms || fallbackAudit.untranslatedTerms,
      score,
      label: 'risky',
      selected: false,
      source: existing?.source === 'shared_history' ? 'shared_history' : source,
      confirmationCount: Math.max(existing?.confirmationCount || 0, confirmationCount),
      mappingId: existing?.mappingId || null,
      transitionVersion: existing?.transitionVersion || 0,
      reasons: Array.from(new Set([...(existing?.reasons || []), ...reasons])),
      attributePlan,
    };
    if (!existing || candidate.score > existing.score) byKey.set(key, candidate);
  };

  const genericSignature = isGenericSourceCategorySignature(signature);
  for (const mapping of input.confirmedMappings || []) {
    if (mapping.signature !== signature) continue;
    const confirmations = Math.max(1, Number(mapping.confirmations) || 1);
    const tree = treeRowsByKey.get(sourceOzonCategoryKey(mapping.categoryId, mapping.typeId));
    const catalog = catalogByKey.get(sourceOzonCategoryKey(mapping.categoryId, mapping.typeId));
    const historyTextScore = categoryTextScore(sourceTerms, {
      categoryName: String(mapping.categoryName || catalog?.categoryNameRu || tree?.categoryName || ''),
      typeName: String(mapping.typeName || catalog?.typeNameRu || tree?.typeName || ''),
      typeNameZh: catalog?.typeNameZh,
    }, catalog ? [catalog.displayPathZh, catalog.searchText, ...catalog.keywords].join(' ') : '');
    if (genericSignature && historyTextScore <= 0) continue;
    const baseScore = genericSignature
      ? 45 + historyTextScore + confirmations * 4
      : 80 + confirmations * 8;
    addCandidate(mapping, baseScore, 'shared_history', ['全局历史确认', '确认 ' + confirmations + ' 次'], confirmations);
    const candidate = byKey.get(sourceOzonCategoryKey(mapping.categoryId, mapping.typeId));
    if (candidate) {
      candidate.mappingId = mapping.mappingId || null;
      candidate.transitionVersion = Math.max(0, Number(mapping.transitionVersion) || 0);
    }
  }

  const sourceIsAdult = isAdultSourceCategoryTerms(sourceTerms);
  for (const row of treeRows) {
    const catalog = catalogByKey.get(sourceOzonCategoryKey(row.categoryId, row.typeId));
    const textScore = categoryTextScore(sourceTerms, { ...row, typeNameZh: catalog?.typeNameZh }, catalog ? [catalog.displayPathZh, catalog.searchText, ...catalog.keywords].join(' ') : '');
    if (!sourceIsAdult && isAdultOzonCategoryCandidate(row)) continue;
    if (textScore <= 0) continue;
    addCandidate(row, 30 + textScore, 'tree_match', ['类目名称相似', '源商品画像'], 0);
  }

  const sorted = Array.from(byKey.values())
    .filter((candidate) => (
      candidate.source === 'shared_history'
      || candidate.reasons.some((reason) => reason === '类目名称相似')
    ))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  sorted.forEach((candidate, index) => {
    candidate.selected = index === 0;
    candidate.label = candidate.score >= 80 ? 'recommended' : candidate.score >= 45 ? 'optional' : 'risky';
    candidate.displayPathRu = candidate.displayPathRu || [candidate.categoryName, candidate.typeName].filter(Boolean).join(' / ');
    candidate.displayPathZh = candidate.displayPathZh || [
      candidate.categoryNameZh || '待翻译类目',
      candidate.typeNameZh || '待翻译类型',
    ].filter(Boolean).join(' / ');
  });
  return sorted;
}

function categoryCatalogTranslationFingerprint(catalog: OzonCategoryCatalogEntry[]): string {
  return catalog.map((entry) => [
    entry.descriptionCategoryId,
    entry.typeId,
    entry.displayPathZh,
    entry.translationStatus,
    entry.untranslatedTerms.join('|'),
  ].join(':')).join('\n');
}

function hasOzonCategoryCatalogTranslationGaps(catalog: OzonCategoryCatalogEntry[]): boolean {
  return catalog.some((entry) => entry.translationStatus !== 'complete' || entry.untranslatedTerms.length > 0);
}

export async function loadSourceOzonCategoryCatalogForCandidates(input: {
  shopId: string;
  language?: string;
  store: OzonCategoryCatalogStore;
  fetchTree(): Promise<SourceOzonCategoryTreeNode[]>;
  enrichMissingTranslations?(entries: OzonCategoryCatalogEntry[]): Promise<OzonCategoryCatalogEntry[]>;
  allowAiEnrichment?: boolean;
  forceRefresh?: boolean;
  now?: () => Date;
}): Promise<{
  categoryTree: SourceOzonCategoryTreeNode[];
  categoryCatalog: OzonCategoryCatalogEntry[];
  refreshed: boolean;
  persisted: boolean;
}> {
  const language = String(input.language || 'DEFAULT').trim() || 'DEFAULT';
  let categoryTree: SourceOzonCategoryTreeNode[] = [];
  let categoryCatalog = input.forceRefresh ? [] : await input.store.list(input.shopId, language);
  let refreshed = false;

  if (input.forceRefresh || categoryCatalog.length === 0) {
    categoryTree = await input.fetchTree();
    categoryCatalog = buildOzonCategoryCatalog(categoryTree);
    refreshed = true;
  }

  let before = categoryCatalogTranslationFingerprint(categoryCatalog);
  categoryCatalog = applyOzonCategoryCatalogLocalTranslations(categoryCatalog);
  let changed = categoryCatalogTranslationFingerprint(categoryCatalog) !== before;

  if (input.allowAiEnrichment && input.enrichMissingTranslations && hasOzonCategoryCatalogTranslationGaps(categoryCatalog)) {
    before = categoryCatalogTranslationFingerprint(categoryCatalog);
    categoryCatalog = await input.enrichMissingTranslations(categoryCatalog);
    changed = changed || categoryCatalogTranslationFingerprint(categoryCatalog) !== before;
  }

  const persisted = refreshed || changed;
  if (persisted) {
    await input.store.replace(input.shopId, language, categoryCatalog, input.now?.() || new Date());
  }

  return { categoryTree, categoryCatalog, refreshed, persisted };
}
const MAX_CATEGORY_TRANSLATION_TERMS_PER_REQUEST = 20;

async function createAiOzonCategoryTranslationEnricher(
  actorUserId: string,
): Promise<undefined | ((entries: OzonCategoryCatalogEntry[]) => Promise<OzonCategoryCatalogEntry[]>)> {
  const enabled = await getConfig('ai_category_translation_enabled');
  if (!enabled) return undefined;

  const provider = await getConfig('ai_provider');
  const baseUrl = String(await getConfig('ai_base_url') || '').trim();
  const apiKey = String(await getConfig('ai_api_key') || '').trim();
  const model = String(await getConfig('ai_model') || '').trim();
  const providerLabel = String(await getConfig('ai_provider_label') || '').trim();
  const timeoutMs = Number(await getConfig('ai_timeout_ms')) || 30000;
  const prompt = String(await getConfig('ai_category_translation_prompt') || '').trim();
  const dailyLimit = Number(await getConfig('ai_user_daily_category_translation_limit')) || 0;
  if (provider !== 'custom' || !baseUrl || !apiKey || !model || !prompt) return undefined;

  const cacheStore = createPrismaAiTranslationCacheStore(prisma);
  const usageStore = createPrismaAiUsageStore(prisma);
  const promptHash = createHash('sha256').update(prompt).digest('hex');

  return (entries: OzonCategoryCatalogEntry[]) => enrichMissingOzonCategoryCatalogTranslations(entries, {
    maxTerms: MAX_CATEGORY_TRANSLATION_TERMS_PER_REQUEST,
    translateTerm: async (term) => {
      const result = await getCachedAiTranslation({
        namespace: 'category_term',
        sourceLang: 'ru',
        targetLang: 'zh-CN',
        inputText: term,
        promptHash,
        provider,
        model,
        store: cacheStore,
        translate: async () => {
          const reservation = await reserveAiDailyLimit({
            store: usageStore,
            namespace: 'category_term',
            actorUserId,
            limit: dailyLimit,
          });
          if (!reservation.allowed) throw new Error('AI category translation daily limit reached');
          let reservationOpen = true;
          const releaseReservation = async () => {
            if (!reservationOpen || !usageStore.releaseDailyReservation) return;
            await usageStore.releaseDailyReservation({ namespace: 'category_term', actorUserId });
            reservationOpen = false;
          };
          try {
            const ai = await generateAiText({
              config: { provider, baseUrl, apiKey, model, providerLabel, timeoutMs },
              messages: [
                { role: 'system', content: prompt },
                { role: 'user', content: term },
              ],
              temperature: 0,
              maxTokens: 80,
            });
            if (!ai.ok) {
              if (isUnknownAiOutcome(ai)) reservationOpen = false;
              throw new Error(ai.error);
            }
            await recordAiUsageEvent(usageStore, {
              namespace: 'category_term',
              provider: ai.provider,
              model: ai.model,
              actorUserId,
              kind: 'request',
              reserved: true,
              usage: ai.usage ? { ...ai.usage } : null,
            });
            reservationOpen = false;
            return {
              outputText: ai.text,
              usage: ai.usage ? { ...ai.usage } : null,
              provider: ai.provider,
              model: ai.model,
            };
          } catch (error) {
            await releaseReservation();
            throw error;
          }
        },
      });
      return { outputText: result.outputText, source: result.source };
    },
  });
}
function metadataRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

async function upsertPublishOzonSyncJob(input: {
  jobId?: string | null;
  shopId: string;
  payload: Record<string, any>;
  status?: 'RUNNING' | 'SUCCESS' | 'FAILED';
  errorMessage?: string | null;
  finishedAt?: Date | null;
}): Promise<{ id: string }> {
  const status = input.status || 'RUNNING';
  if (input.jobId) {
    return await prisma.syncJob.update({
      where: { id: input.jobId },
      data: {
        status,
        payload: input.payload,
        errorMessage: input.errorMessage ?? null,
        ...(input.finishedAt !== undefined ? { finishedAt: input.finishedAt } : {}),
      },
      select: { id: true },
    });
  }

  return await prisma.syncJob.create({
    data: {
      shopId: input.shopId,
      type: 'PRODUCT_PUSH',
      status,
      startedAt: new Date(),
      payload: input.payload,
      errorMessage: input.errorMessage ?? null,
      ...(input.finishedAt !== undefined ? { finishedAt: input.finishedAt } : {}),
    },
    select: { id: true },
  });
}

function isEphemeralListingMetadata(value: unknown): boolean {
  return metadataRecord(value).ephemeralListing === true;
}

function ephemeralListingMetadataWhere(): Record<string, unknown> {
  return {
    metadata: { path: ['ephemeralListing'], equals: true } as any,
  };
}

const DOMESTIC_SOURCE_PLATFORMS = ['1688', 'pdd', 'taobao', 'tmall', 'xianyu', 'goofish'];

function escapePostgresLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function visibleSupplyGoodsWhereSql(input: {
  userId: string;
  status?: string;
  sourceGroup?: string;
  search?: string;
}): Prisma.Sql {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`user_id = ${input.userId}`,
    Prisma.sql`coalesce((metadata->>'ephemeralListing')::boolean, false) is not true`,
  ];
  if (input.status) {
    conditions.push(Prisma.sql`status = ${input.status}`);
  }
  if (input.sourceGroup === 'source') {
    conditions.push(Prisma.sql`source_platform in (${Prisma.join(DOMESTIC_SOURCE_PLATFORMS)})`);
  } else if (input.sourceGroup === 'ozon') {
    conditions.push(Prisma.sql`source_platform = ${'ozon'}`);
  }
  if (input.search) {
    const pattern = `%${escapePostgresLike(input.search)}%`;
    conditions.push(Prisma.sql`(
      title ilike ${pattern} escape '\\'
      or sku ilike ${pattern} escape '\\'
      or source_product_id ilike ${pattern} escape '\\'
    )`);
  }
  return Prisma.join(conditions, ' AND ');
}

async function findVisibleSupplyGoodsPage(input: {
  userId: string;
  status?: string;
  sourceGroup?: string;
  search?: string;
  offset: number;
  limit: number;
}): Promise<{ total: number; rows: any[] }> {
  const whereSql = visibleSupplyGoodsWhereSql(input);
  const [countRows, idRows] = await Promise.all([
    prisma.$queryRaw<Array<{ count: number | bigint | string }>>(Prisma.sql`
      select count(*)::int as count
      from supply_goods
      where ${whereSql}
    `),
    prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      select id
      from supply_goods
      where ${whereSql}
      order by updated_at desc
      offset ${input.offset}
      limit ${input.limit}
    `),
  ]);
  const total = Number(countRows[0]?.count || 0);
  const ids = idRows.map((row) => String(row.id)).filter(Boolean);
  if (!ids.length) return { total, rows: [] };

  const rows = await prisma.supplyGoods.findMany({
    where: {
      userId: input.userId,
      id: { in: ids },
    },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  return {
    total,
    rows: ids.map((id) => byId.get(id)).filter(Boolean),
  };
}

function visibleSupplyGoodsSkuWhereSql(userId: string, skus: string[]): Prisma.Sql {
  return Prisma.sql`
    user_id = ${userId}
    and coalesce((metadata->>'ephemeralListing')::boolean, false) is not true
    and (source_product_id in (${Prisma.join(skus)}) or sku in (${Prisma.join(skus)}))
  `;
}

async function findVisibleSupplyGoodsIdsBySku(userId: string, skus: string[], limit?: number): Promise<string[]> {
  if (!skus.length) return [];
  const whereSql = visibleSupplyGoodsSkuWhereSql(userId, skus);
  const rows = limit
    ? await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      select id
      from supply_goods
      where ${whereSql}
      order by updated_at desc
      limit ${limit}
    `)
    : await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      select id
      from supply_goods
      where ${whereSql}
      order by updated_at desc
    `);
  return rows.map((row) => String(row.id)).filter(Boolean);
}

function scheduleEphemeralListingCleanup(items: Array<{ id: string; metadata?: unknown }>, userId: string, delayMs = EPHEMERAL_LISTING_TTL_MS): void {
  const ids = Array.from(new Set((Array.isArray(items) ? items : [])
    .filter((item) => item && item.id && isEphemeralListingMetadata(item.metadata))
    .map((item) => item.id)));
  if (!ids.length) return;

  const timeout = setTimeout(() => {
    prisma.supplyGoods.deleteMany({
      where: {
        id: { in: ids },
        userId,
        ...ephemeralListingMetadataWhere(),
      } as any,
    }).catch((error) => {
      console.warn('[ephemeral-listing] cleanup failed:', error?.message || error);
    });
  }, Math.max(0, delayMs));
  timeout.unref?.();
}

function purgeExpiredEphemeralListingRecords(userId: string): Promise<unknown> {
  return prisma.supplyGoods.deleteMany({
    where: {
      userId,
      updatedAt: { lt: new Date(Date.now() - EPHEMERAL_LISTING_TTL_MS) },
      ...ephemeralListingMetadataWhere(),
    } as any,
  }).catch((error) => {
    console.warn('[ephemeral-listing] purge failed:', error?.message || error);
    return null;
  });
}

export function getCollectedRichDescriptionJson(item: { metadata?: unknown }): string {
  const meta = metadataRecord(item.metadata);
  const richDescriptionJson = meta.sourceRichDescriptionJson;
  if (typeof richDescriptionJson === 'string' && richDescriptionJson.trim()) return richDescriptionJson.trim();
  if (richDescriptionJson && typeof richDescriptionJson === 'object') return JSON.stringify(richDescriptionJson);
  const richContentDraft = meta.sourceRichContentDraft;
  if (isDomesticCollectedSource(meta.sourcePlatform) && !isPublishableSourceRichContentDraft(richContentDraft)) return '';
  const publishablePayload = publishableSourceRichContentPayload(richContentDraft);
  if (publishablePayload) return publishablePayload;
  if (typeof richContentDraft === 'string' && richContentDraft.trim()) return richContentDraft.trim();
  if (richContentDraft && typeof richContentDraft === 'object') return JSON.stringify(richContentDraft);
  return '';
}

function getCollectedSourceVideos(item: { metadata?: unknown }): unknown[] {
  const meta = metadataRecord(item.metadata);
  return Array.isArray(meta.sourceVideos) ? meta.sourceVideos : [];
}

function collectItemResponse(row: any): any {
  return {
    ...row,
    purchasePrice: row?.purchasePrice?.toString?.() ?? row?.purchasePrice ?? null,
    originalPrice: row?.originalPrice?.toString?.() ?? row?.originalPrice ?? null,
    exchangeRateUsed: row?.exchangeRateUsed?.toString?.() ?? row?.exchangeRateUsed ?? null,
  };
}

function sourceVideoRetryKey(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const row = value as Record<string, unknown>;
  return String(row.originalUrl || row.url || row.videoUrl || row.src || row.link || '').trim();
}

function sourceVideosNeedingRetransfer(value: unknown[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const status = String(row.transferStatus || row.status || '').trim();
    const reason = String(row.transferReason || row.reason || '').trim();
    if (status === 'uploaded' || status === 'ozon_cdn_ready' || reason === 'ozon_cdn_ready') continue;
    const url = sourceVideoRetryKey(row);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const retry: Record<string, unknown> = { url };
    const coverUrl = String(row.coverUrl || row.cover || row.poster || row.preview || row.thumbnail || '').trim();
    const title = String(row.title || row.name || row.caption || '').trim();
    if (coverUrl) retry.coverUrl = coverUrl;
    if (title) retry.title = title;
    out.push(retry);
  }
  return out;
}

function mergeRetransferredSourceVideos(original: unknown[], retryVideos: Array<Record<string, unknown>>, transferredVideos: unknown[]): unknown[] {
  const replacementByKey = new Map<string, unknown>();
  retryVideos.forEach((retryVideo, index) => {
    const key = sourceVideoRetryKey(retryVideo);
    const replacement = transferredVideos[index];
    if (key && replacement) replacementByKey.set(key, replacement);
  });
  return original.map((item) => {
    const key = sourceVideoRetryKey(item);
    return key && replacementByKey.has(key) ? replacementByKey.get(key) : item;
  });
}

function mergeSourceStandardAttributes(
  existing: Record<string, any>,
  inferred: Record<string, any>,
): Record<string, any> {
  const out: Record<string, any> = { ...inferred, ...existing };
  for (const key of ['colors', 'sizes', 'materials', 'seasons', 'categoryHints'] as const) {
    if (!Array.isArray(existing[key]) || existing[key].length === 0) out[key] = inferred[key];
  }
  if (!existing.gender?.value && inferred.gender?.value) out.gender = inferred.gender;
  if (!existing.brand?.value && !existing.brand?.isBrandless && inferred.brand) out.brand = inferred.brand;
  const existingPackageWeight = Number(existing.packageWeightG);
  const existingHasPackageDimensions = !!existing.packageDimensionsMm;
  if (
    inferred.packageWeightG
    && (!existing.packageWeightG || (Number.isFinite(existingPackageWeight) && existingPackageWeight <= 5 && !existingHasPackageDimensions))
  ) {
    out.packageWeightG = inferred.packageWeightG;
  }
  if (!existing.packageDimensionsMm && inferred.packageDimensionsMm) out.packageDimensionsMm = inferred.packageDimensionsMm;
  return out;
}

export function getCollectedSourceStandardAttributes(item: {
  title?: unknown;
  variants?: unknown;
  sourcePlatform?: unknown;
  metadata?: unknown;
}): Record<string, any> | null {
  const meta = metadataRecord(item.metadata);
  const standard = meta.sourceStandardAttributes;
  const existing = standard && typeof standard === 'object' && !Array.isArray(standard) ? standard as Record<string, any> : {};
  if (!isDomesticCollectedSource(item.sourcePlatform ?? meta.sourcePlatform)) {
    return Object.keys(existing).length ? existing : null;
  }
  const inferred = normalizeSourceStandardAttributes({
    title: item.title ?? meta.sourceTitleRaw,
    variants: Array.isArray(item.variants) ? item.variants : meta.skuItems,
    metadata: {
      sourceAttributes: Array.isArray(meta.sourceAttributes) ? meta.sourceAttributes : [],
      sourcePackagingRows: Array.isArray(meta.sourcePackagingRows) ? meta.sourcePackagingRows : [],
      categoryPath: Array.isArray(meta.categoryPath) ? meta.categoryPath : [],
      categoryName: meta.categoryName,
      weightG: finiteMetadataNumber(meta.weightG),
      lengthMm: finiteMetadataNumber(meta.lengthMm),
      widthMm: finiteMetadataNumber(meta.widthMm),
      heightMm: finiteMetadataNumber(meta.heightMm),
    },
  });
  return mergeSourceStandardAttributes(existing, inferred as any);
}

function normalizePublishImageList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    let image = String(raw || '').trim();
    if (!image) continue;
    if (isLikelyNonImageMediaUrl(image)) continue;
    if (/^(https?:)?\/\//i.test(image)) {
      try {
        image = normalizeOzonPublishImageUrl(image);
      } catch {
        // Keep the original value so the publish resolver can return the existing validation error.
      }
    }
    if (isLikelyNonImageMediaUrl(image)) continue;
    if (isKnownLowResolutionSourceThumbnail(image)) continue;
    if (seen.has(image)) continue;
    seen.add(image);
    out.push(image);
  }
  return out;
}

function isKnownLowResolutionSourceThumbnail(raw: string): boolean {
  try {
    const url = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
    const path = decodeURIComponent(url.pathname).toLowerCase();
    return /\.(?:220x220|310x310|search|summ)\.(?:jpe?g|png|webp)(?:$|[?#])/i.test(path);
  } catch {
    return /\.(?:220x220|310x310|search|summ)\.(?:jpe?g|png|webp)(?:$|[?#])/i.test(String(raw || '').toLowerCase());
  }
}

function mergePublishImageLists(...lists: unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const image of normalizePublishImageList(list)) {
      if (seen.has(image)) continue;
      seen.add(image);
      out.push(image);
    }
  }
  return out;
}

function limitOzonPublishImages(images: string[]): string[] {
  return images.slice(0, OZON_MAX_PUBLISH_IMAGES);
}

function sameStringList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function normalizeWatermarkOutputPaths(paths: string[]): string[] {
  return paths.map((p) => {
    if (p.startsWith('/watermarked/') || p.startsWith('/uploads/')) return p;
    // 兼容历史数据：剥离 http://localhost:port 前缀
    const m = p.match(/^https?:\/\/localhost(?::\d+)?(\/.*)$/);
    if (m) return m[1]!;
    return p;
  });
}

function positiveInt(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

export function resolveItemPublishCategory(
  item: { metadata?: unknown },
  fallbackCategoryId?: unknown,
  fallbackTypeId?: unknown,
  preferItemCategory = true,
): { categoryId: number; typeId: number } {
  const meta = metadataRecord(item.metadata);
  const itemCategoryId = positiveInt(meta.descriptionCategoryId);
  const itemTypeId = positiveInt(meta.typeId);
  const fallbackCategory = positiveInt(fallbackCategoryId);
  const fallbackType = positiveInt(fallbackTypeId);
  return {
    categoryId: (preferItemCategory ? itemCategoryId : fallbackCategory) ?? itemCategoryId ?? fallbackCategory ?? 0,
    typeId: (preferItemCategory ? itemTypeId : fallbackType) ?? itemTypeId ?? fallbackType ?? 0,
  };
}

export function hasOwnPublishCategory(item: { metadata?: unknown }): boolean {
  const meta = metadataRecord(item.metadata);
  return !!positiveInt(meta.descriptionCategoryId) && !!positiveInt(meta.typeId);
}

export function shouldUseProductImportForPublishItem(
  item: { metadata?: unknown; sourcePlatform?: unknown; sourceProductId?: unknown; sku?: unknown },
  source?: unknown,
): boolean {
  const meta = metadataRecord(item.metadata);
  if (Array.isArray(meta.ozonAttributes) && meta.ozonAttributes.length > 0) return true;
  if (source !== 'source-publish-page') return false;
  const platform = String(item.sourcePlatform || meta.sourcePlatform || '').trim().toLowerCase();
  const sourceProductId = String(item.sourceProductId || meta.sourceProductId || '').trim();
  const hasSourceIdentity = Boolean(
    sourceProductId
      || (platform && platform !== 'ozon')
      || meta.sourceProductProfile
      || meta.sourceStandardAttributes,
  );
  return hasSourceIdentity && hasOwnPublishCategory(item);
}

export function groupPublishItemsByCategory<T extends { description_category_id?: unknown; type_id?: unknown }>(
  items: T[],
): Array<{ categoryId: number; typeId: number; items: T[] }> {
  const groups = new Map<string, { categoryId: number; typeId: number; items: T[] }>();
  for (const item of items) {
    const categoryId = positiveInt(item.description_category_id) ?? 0;
    const typeId = positiveInt(item.type_id) ?? 0;
    const key = `${categoryId}:${typeId}`;
    const group = groups.get(key);
    if (group) group.items.push(item);
    else groups.set(key, { categoryId, typeId, items: [item] });
  }
  return Array.from(groups.values());
}

export function resolveBasePublishImages(
  item: { images?: unknown; metadata?: unknown },
  clonedImages?: unknown,
): string[] {
  const meta = metadataRecord(item.metadata);
  const customOrWatermarked = normalizePublishImageList(meta.watermarkedImages);
  if (customOrWatermarked.length) return limitOzonPublishImages(customOrWatermarked);
  const cloned = normalizePublishImageList(clonedImages);
  if (cloned.length) return limitOzonPublishImages(cloned);
  return limitOzonPublishImages(normalizePublishImageList(item.images));
}

export function resolveVariantPublishImages(
  item: { images?: unknown; metadata?: unknown },
  variant: { images?: unknown; watermarkedImages?: unknown },
  baseImages: string[],
): string[] {
  const variantWatermarkedImages = normalizePublishImageList(variant.watermarkedImages);
  const variantImages = variantWatermarkedImages.length
    ? variantWatermarkedImages
    : normalizePublishImageList(variant.images);
  return limitOzonPublishImages(variantImages.length ? mergePublishImageLists(variantImages, baseImages) : baseImages);
}

function isLocalPublishUploadImage(raw: unknown): boolean {
  const image = String(raw || '').trim();
  if (image.startsWith('/watermarked/') || image.startsWith('/uploads/')) return true;
  return /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/(?:watermarked|uploads)\//i.test(image);
}

export function resolveOriginalBasePublishImages(
  item: { images?: unknown; metadata?: unknown },
  clonedImages?: unknown,
): string[] {
  const cloned = normalizePublishImageList(clonedImages);
  if (cloned.length) return limitOzonPublishImages(cloned);
  return limitOzonPublishImages(normalizePublishImageList(item.images));
}

function resolveOriginalVariantPublishImages(
  item: { images?: unknown; metadata?: unknown },
  variant: { images?: unknown; watermarkedImages?: unknown },
  baseOriginalImages: string[],
): string[] {
  const variantImages = normalizePublishImageList(variant.images);
  return limitOzonPublishImages(variantImages.length ? mergePublishImageLists(variantImages, baseOriginalImages) : baseOriginalImages);
}

export function shouldFallbackToOriginalPublishImages(rawImagesInput: unknown, fallbackImagesInput: unknown, error: unknown): boolean {
  const rawImages = normalizePublishImageList(rawImagesInput);
  const fallbackImages = normalizePublishImageList(fallbackImagesInput).filter((image) => !isLocalPublishUploadImage(image));
  if (!rawImages.some(isLocalPublishUploadImage) || !fallbackImages.length) return false;
  const message = error && typeof error === 'object' && 'message' in error
    ? String((error as { message?: unknown }).message || '')
    : String(error || '');
  return /OZON CDN|水印图|cookie|company_id|鉴权|未同步|上传连接失败|握手阶段失败|公网暂不可读|OZON 可能下载失败|error=timeout|readiness/i.test(message);
}

async function resolvePublishImageUrls(
  rawImages: string[],
  fallbackImages: string[],
  shopId: string,
  userId: string,
): Promise<string[]> {
  try {
    return await resolveImageUrls(rawImages, shopId, userId);
  } catch (error) {
    if (!shouldFallbackToOriginalPublishImages(rawImages, fallbackImages, error)) throw error;
    const safeFallbackImages = normalizePublishImageList(fallbackImages).filter((image) => !isLocalPublishUploadImage(image));
    console.warn(`[publish-ozon] watermarked image upload failed, falling back to original images: ${(error as any)?.message || error}`);
    return await resolveImageUrls(safeFallbackImages, shopId, userId);
  }
}

export function setVariantWatermarkedImages(
  variantsInput: unknown,
  watermarkedBySku: Record<string, unknown>,
): any[] {
  const variants = Array.isArray(variantsInput) ? variantsInput as any[] : [];
  return variants.map((variant) => {
    const sku = String(variant?.sku || '').trim();
    const watermarkedImages = sku ? normalizePublishImageList(watermarkedBySku[sku]) : [];
    if (!watermarkedImages.length) return variant;
    return {
      ...variant,
      watermarkedImages,
      watermarkApplied: true,
    };
  });
}

type WatermarkProcessor = (
  images: string[],
  itemId: string,
  config: any,
) => Promise<{ watermarkedImages: string[]; failed: number }>;

export async function processWatermarkItemsWithConcurrency(
  items: any[],
  config: any,
  processItemWatermarks: WatermarkProcessor,
): Promise<{ processed: number; failed: number }> {
  let processed = 0;
  let failed = 0;
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(WATERMARK_ITEM_CONCURRENCY, items.length));

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index]!;
      const images = Array.isArray(item.images) ? (item.images as string[]) : [];
      const variants = Array.isArray(item.variants) ? item.variants as any[] : [];
      const existingMeta = (item.metadata as any) || {};
      const updateData: any = {};
      let itemProcessed = false;

      if (images.length) {
        const result = await processItemWatermarks(images, item.id, config);
        failed += result.failed;

        // 存相对路径 /watermarked/xxx.jpg。发布时由 resolveImageUrls 上传到存储后端转为公网 URL。
        // 不要存 http://localhost:3001/... — OZON 拉不到本地服务。
        const relPaths = normalizeWatermarkOutputPaths(result.watermarkedImages);
        updateData.metadata = { ...existingMeta, watermarkedImages: relPaths, watermarkApplied: true };
        itemProcessed = true;
      }

      const variantWatermarkedBySku: Record<string, string[]> = {};
      for (let idx = 0; idx < variants.length; idx += 1) {
        const variant = variants[idx]!;
        const sku = String(variant?.sku || '').trim();
        const variantImages = Array.isArray(variant?.images) ? variant.images as string[] : [];
        if (!sku || !variantImages.length) continue;

        const result = await processItemWatermarks(variantImages, `${item.id}_v${idx}`, config);
        failed += result.failed;
        variantWatermarkedBySku[sku] = normalizeWatermarkOutputPaths(result.watermarkedImages);
        itemProcessed = true;
      }

      if (!itemProcessed) {
        failed++;
        continue;
      }

      if (Object.keys(variantWatermarkedBySku).length) {
        updateData.variants = setVariantWatermarkedImages(variants, variantWatermarkedBySku) as any;
      }

      await prisma.supplyGoods.update({
        where: { id: item.id },
        data: updateData,
      });
      processed++;
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return { processed, failed };
}

export function recordOfferPublishImages(
  offerImageLists: Record<string, string[]>,
  offerImages: Record<string, string>,
  offerId: string,
  images: unknown,
): void {
  const normalizedImages = limitOzonPublishImages(normalizePublishImageList(images));
  if (!offerId || !normalizedImages.length) return;
  offerImageLists[offerId] = normalizedImages;
  offerImages[offerId] = normalizedImages[0]!;
}

export function hasOzonVideoMediaAttributes(attributes: unknown): boolean {
  return Array.isArray(attributes)
    && attributes.some((attr: any) => isOzonVideoMediaAttributeId(attr?.id ?? attr?.attribute_id));
}

export function appendCollectedOzonVideoMediaAttributes<T extends { id: number; complex_id?: number; values: any[] }>(
  attributes: T[] | null | undefined,
  sourceVideos: unknown,
): { attributes: Array<T | ReturnType<typeof buildOzonVideoMediaAttributesFromSourceVideos>[number]>; generatedCount: number } {
  const baseAttributes = Array.isArray(attributes) ? attributes : [];
  if (hasOzonVideoMediaAttributes(baseAttributes)) {
    return { attributes: baseAttributes, generatedCount: 0 };
  }
  const generated = buildOzonVideoMediaAttributesFromSourceVideos(sourceVideos);
  if (!generated.length) return { attributes: baseAttributes, generatedCount: 0 };
  return {
    attributes: [...baseAttributes, ...generated],
    generatedCount: generated.length,
  };
}

export function recordPictureUploadDiagnostic(
  diagnostics: any[],
  entry: {
    offerId: unknown;
    productId?: unknown;
    status: 'uploaded' | 'failed' | 'skipped';
    rawImages?: unknown;
    resolvedImages?: unknown;
    error?: unknown;
    message?: unknown;
  },
): void {
  const offerId = String(entry.offerId || '').trim();
  if (!offerId) return;
  const rawImages = normalizePublishImageList(entry.rawImages);
  const resolvedImages = normalizePublishImageList(entry.resolvedImages);
  const productId = positiveInt(entry.productId);
  const error = entry.error as any;
  const message = String(
    entry.message
    || (error?.message ? error.message : '')
    || (typeof entry.error === 'string' ? entry.error : ''),
  ).trim();
  diagnostics.push({
    offerId,
    productId,
    status: entry.status,
    imageCount: rawImages.length,
    resolvedCount: resolvedImages.length,
    ...(rawImages[0] ? { firstImage: rawImages[0] } : {}),
    ...(message ? { message: message.slice(0, 300) } : {}),
  });
}

function recordVideoPublishDiagnostic(
  diagnostics: any[],
  entry: {
    offerId: unknown;
    productId?: unknown;
    status: 'uploaded' | 'failed' | 'pending' | 'skipped';
    videoUrl?: unknown;
    name?: unknown;
    sourceVideos?: unknown;
    error?: unknown;
    message?: unknown;
    reason?: unknown;
  },
): void {
  const offerId = String(entry.offerId || '').trim();
  if (!offerId) return;
  const productId = positiveInt(entry.productId);
  const sourceVideos = Array.isArray(entry.sourceVideos) ? entry.sourceVideos : [];
  const videoUrl = String(entry.videoUrl || '').trim();
  const name = String(entry.name || '').trim();
  const error = entry.error as any;
  const message = String(
    entry.message
    || (error?.message ? error.message : '')
    || (typeof entry.error === 'string' ? entry.error : ''),
  ).trim();
  const reason = String(entry.reason || '').trim();
  diagnostics.push({
    offerId,
    productId,
    status: entry.status,
    videoCount: sourceVideos.length || (videoUrl ? 1 : 0),
    ...(videoUrl ? { videoUrl } : {}),
    ...(name ? { name: name.slice(0, 200) } : {}),
    ...(reason ? { reason: reason.slice(0, 120) } : {}),
    ...(message ? { message: message.slice(0, 300) } : {}),
  });
}

export function sourceVideoTransferFailureTraceKey(importItem: { offer_id?: unknown; _sourceItemId?: unknown }, message?: unknown): string {
  const sourceItemId = String(importItem?._sourceItemId || '').trim();
  const offerId = String(importItem?.offer_id || '').trim();
  const errorKey = String(message || '').trim().slice(0, 180);
  return `source-video-transfer-failed:${sourceItemId || offerId}:${errorKey}`;
}

export function sourceVideoTransferFailureMessage(message?: unknown): string {
  const detail = String(message || 'Ozon CDN video upload failed').trim();
  return `源视频未自动附加到 Ozon 商品，不影响商品主体上架：${detail}`;
}

export function planFallbackPictureUploads(
  payloadInput: unknown,
  importItemsInput: unknown,
  sourceItemsInput: unknown,
): {
  operations: { offerId: string; productId: number; rawImages: string[] }[];
  skipped: { offerId: string; productId: number; rawImages: string[]; message: string }[];
  pendingCount: number;
  offerImageLists: Record<string, string[]>;
} {
  const payload = metadataRecord(payloadInput);
  const importItems = Array.isArray(importItemsInput) ? importItemsInput as any[] : [];
  const sourceItems = Array.isArray(sourceItemsInput) ? sourceItemsInput as any[] : [];
  const sourceById = new Map<string, any>();
  for (const item of sourceItems) {
    const id = String(item?.id || '').trim();
    if (id) sourceById.set(id, item);
  }
  const offerImageLists: Record<string, string[]> = {};

  const explicitLists = metadataRecord(payload.offerImageLists);
  for (const [offerId, images] of Object.entries(explicitLists)) {
    const normalized = limitOzonPublishImages(normalizePublishImageList(images));
    if (offerId && normalized.length) offerImageLists[offerId] = normalized;
  }

  const traces = Array.isArray(payload.variantTrace) ? payload.variantTrace as any[] : [];
  for (const trace of traces) {
    const offerId = String(trace?.offerId || '').trim();
    if (!offerId || offerImageLists[offerId]?.length) continue;
    const sourceItem = sourceById.get(String(trace?.sourceItemId || '').trim());
    if (!sourceItem) continue;
    const baseImages = resolveBasePublishImages(sourceItem);
    const variants = Array.isArray(sourceItem.variants) ? sourceItem.variants as any[] : [];
    const sourceVariantSku = String(trace?.sourceVariantSku || '').trim();
    const variant = sourceVariantSku
      ? variants.find((v) => String(v?.sku || '').trim() === sourceVariantSku)
      : null;
    const rawImages = variant
      ? resolveVariantPublishImages(sourceItem, variant, baseImages)
      : baseImages;
    if (rawImages.length) offerImageLists[offerId] = rawImages;
  }

  const firstImages = metadataRecord(payload.offerImages);
  for (const [offerId, image] of Object.entries(firstImages)) {
    if (offerImageLists[offerId]?.length) continue;
    const normalized = normalizePublishImageList([image]);
    if (offerId && normalized.length) offerImageLists[offerId] = normalized;
  }

  const uploadedOffers = new Set(
    (Array.isArray(payload.pictureUploads) ? payload.pictureUploads as any[] : [])
      .filter((entry) => String(entry?.status || '') === 'uploaded')
      .map((entry) => String(entry?.offerId || '').trim())
      .filter(Boolean),
  );

  const operations: { offerId: string; productId: number; rawImages: string[] }[] = [];
  const skipped: { offerId: string; productId: number; rawImages: string[]; message: string }[] = [];
  let pendingCount = 0;

  for (const item of importItems) {
    const offerId = String(item?.offer_id || item?.offerId || '').trim();
    if (!offerId || uploadedOffers.has(offerId)) continue;
    const productId = positiveInt(item?.product_id ?? item?.productId);
    const status = String(item?.status || '').toLowerCase();
    if (!productId) {
      if (!status || status === 'pending') pendingCount += 1;
      continue;
    }
    if (status === 'pending') {
      pendingCount += 1;
      continue;
    }
    if (status === 'failed') continue;
    const blockingErrors = Array.isArray(item?.errors)
      ? item.errors.filter((error: any) => {
        const level = String(error?.level || '').toLowerCase();
        const state = String(error?.state || '').toLowerCase();
        return level === 'error' || state === 'declined';
      })
      : [];
    if (blockingErrors.length) {
      skipped.push({
        offerId,
        productId,
        rawImages: offerImageLists[offerId] || [],
        message: `商品卡被 Ozon 拒绝，已跳过图片补传：${blockingErrors.map((error: any) => formatOzonErrorMessage(error)).join('； ')}`.slice(0, 300),
      });
      continue;
    }

    const rawImages = offerImageLists[offerId] || [];
    if (!rawImages.length) {
      skipped.push({
        offerId,
        productId,
        rawImages,
        message: '该 offer 没有可上传图片，可能采集阶段没有拿到图片',
      });
      continue;
    }
    operations.push({ offerId, productId, rawImages });
  }

  return { operations, skipped, pendingCount, offerImageLists };
}

export type FallbackRecreateConflict = {
  itemId: string;
  sku: string;
  reason: 'listed' | 'existing_job';
  jobId?: string;
  taskId?: number;
};

function collectFallbackSourceSkus(item: { sku?: unknown; variants?: unknown }): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (value: unknown) => {
    const sku = String(value || '').trim();
    if (!sku || seen.has(sku)) return;
    seen.add(sku);
    out.push(sku);
  };
  push(item.sku);
  const variants = Array.isArray(item.variants) ? item.variants as any[] : [];
  for (const variant of variants) push(variant?.sku);
  return out;
}

export function findFallbackRecreateConflicts(
  itemsInput: unknown,
  jobsInput: unknown = [],
): FallbackRecreateConflict[] {
  const items = Array.isArray(itemsInput) ? itemsInput as any[] : [];
  const jobs = Array.isArray(jobsInput) ? jobsInput as any[] : [];
  const jobBySourceSku = new Map<string, { jobId?: string; taskId?: number }>();
  const jobBySourceItemId = new Map<string, { jobId?: string; taskId?: number }>();

  for (const job of jobs) {
    const status = String(job?.status || '').toUpperCase();
    if (status && status !== 'SUCCESS' && status !== 'RUNNING') continue;
    const payload = metadataRecord(job?.payload);
    if (payload.source === 'browser-one-click-listing' || payload.browserOneClickJob === true) continue;
    if (payload.source !== 'collect-publish-fallback' && payload.mode !== 'follow-by-sku') continue;
    const jobRef = {
      ...(job?.id ? { jobId: String(job.id) } : {}),
      ...(positiveInt(payload.taskId) ? { taskId: positiveInt(payload.taskId)! } : {}),
    };
    for (const sku of normalizePublishImageList(payload.sourceSkus)) {
      if (!jobBySourceSku.has(sku)) jobBySourceSku.set(sku, jobRef);
    }
    for (const itemId of normalizePublishImageList(payload.sourceItemIds)) {
      if (!jobBySourceItemId.has(itemId)) jobBySourceItemId.set(itemId, jobRef);
    }
    const traces = Array.isArray(payload.variantTrace) ? payload.variantTrace as any[] : [];
    for (const trace of traces) {
      const sourceItemId = String(trace?.sourceItemId || '').trim();
      const sourceVariantSku = String(trace?.sourceVariantSku || '').trim();
      if (sourceItemId && !jobBySourceItemId.has(sourceItemId)) jobBySourceItemId.set(sourceItemId, jobRef);
      if (sourceVariantSku && !jobBySourceSku.has(sourceVariantSku)) jobBySourceSku.set(sourceVariantSku, jobRef);
    }
  }

  const conflicts: FallbackRecreateConflict[] = [];
  for (const item of items) {
    const itemId = String(item?.id || '').trim();
    if (!itemId) continue;
    const skus = collectFallbackSourceSkus(item);
    const displaySku = skus[0] || itemId;
    const itemStatus = String(item?.status || '').toLowerCase();
    if (itemStatus === 'listed' || itemStatus === 'listing_pending') {
      conflicts.push({ itemId, sku: displaySku, reason: 'listed' });
      continue;
    }
    const sourceItemJob = jobBySourceItemId.get(itemId);
    if (sourceItemJob) {
      conflicts.push({ itemId, sku: displaySku, reason: 'existing_job', ...sourceItemJob });
      continue;
    }
    const sourceSkuJob = skus.map((sku) => jobBySourceSku.get(sku)).find(Boolean);
    if (sourceSkuJob) {
      conflicts.push({ itemId, sku: displaySku, reason: 'existing_job', ...sourceSkuJob });
    }
  }
  return conflicts;
}

export function resolvePublishOfferId(input: {
  sourceSku?: unknown;
  fallback: string;
  customOfferId?: unknown;
  randomizeEnabled: boolean;
  randomOfferIdEnabled: boolean;
  userRandomOfferId?: boolean;
  suffixFactory?: () => string;
}): string {
  const custom = String(input.customOfferId || '').trim();
  if (custom) return custom;

  const sourceSku = String(input.sourceSku || '').trim();
  if (
    sourceSku &&
    input.randomizeEnabled &&
    input.randomOfferIdEnabled &&
    input.userRandomOfferId !== false
  ) {
    return randomOfferIdFrom(sourceSku);
  }

  if (sourceSku) {
    const suffix = input.suffixFactory ? input.suffixFactory() : randomSuffix(4);
    return `${sourceSku}-${suffix}`;
  }
  return input.fallback;
}

export function removeVariantsBySkus(variantsInput: unknown, skusInput: unknown[]): {
  variants: any[];
  removed: number;
  missingSkus: string[];
} {
  const variants = Array.isArray(variantsInput) ? variantsInput as any[] : [];
  const skus = Array.from(new Set(
    skusInput.map((sku) => String(sku || '').trim()).filter(Boolean),
  ));
  const skuSet = new Set(skus);
  const found = new Set<string>();
  const next = variants.filter((variant) => {
    const sku = String(variant?.sku || '').trim();
    if (!sku || !skuSet.has(sku)) return true;
    found.add(sku);
    return false;
  });
  return {
    variants: next,
    removed: variants.length - next.length,
    missingSkus: skus.filter((sku) => !found.has(sku)),
  };
}

function assertPublishNamesAreSafe(items: { id: string; sku?: string | null; title?: string | null; metadata?: unknown; variants?: unknown }[]) {
  const unsafe: string[] = [];
  const suspicious: string[] = [];
  const variantConflicts: string[] = [];
  for (const item of items) {
    const variants = Array.isArray(item.variants) ? item.variants as any[] : [];
    if (variants.length) {
      const conflicts = findVariantAttributeConflicts(variants);
      for (const conflict of conflicts.slice(0, 3)) {
        variantConflicts.push(`${item.sku || item.id}: ${conflict.skus.join('/') } -> ${Object.entries(conflict.attrs).map(([k, v]) => `${k}=${v}`).join(', ')}`);
      }
    }
    if (!variants.length) {
      const name = resolvePublishName(item);
      if (!name || containsCjkText(name)) unsafe.push(`${item.sku || item.id}: ${name || '空标题'}`);
      else if (hasSuspiciousPublishName(name)) suspicious.push(`${item.sku || item.id}: ${name}`);
      continue;
    }
    for (const v of variants) {
      const attrs = v?.attrs && typeof v.attrs === 'object' ? v.attrs as Record<string, string> : undefined;
      const name = resolvePublishName(item, attrs);
      if (!name || containsCjkText(name)) unsafe.push(`${v?.sku || item.sku || item.id}: ${name || '空标题'}`);
      else if (hasSuspiciousPublishName(name)) suspicious.push(`${v?.sku || item.sku || item.id}: ${name}`);
    }
  }
  if (unsafe.length) {
    const sample = unsafe.slice(0, 3).join('；');
    throw new Error(`上架标题包含中文或为空，OZON 可能无法识别。请先补采俄文标题或编辑上架标题：${sample}`);
  }
  if (suspicious.length) {
    const sample = suspicious.slice(0, 3).join('；');
    throw new Error(`上架标题疑似重复堆词，OZON 可能会判定“名称中有无意义文本或语法错误”。请先在采集改款里精简标题：${sample}`);
  }
  if (variantConflicts.length) {
    const sample = variantConflicts.slice(0, 3).join('；');
    console.warn(`[publish-ozon] variant attribute conflicts: ${sample}`);
    throw new Error(buildVariantAttributeConflictMessage(variantConflicts.length));
  }
}

export function buildVariantAttributeConflictMessage(conflictCount: number): string {
  const count = Number(conflictCount) || 0;
  return `变体属性重复，无法合并上架${count > 0 ? `（${count} 组）` : ''}。已避免提交到 Ozon；请保留单个同属性变体，或补齐颜色、尺码、型号等差异后再上架。`;
}

function getOzonPublishErrorMessage(e: any): string {
  if (e?.name === 'OzonApiError' && typeof e.publicMessage === 'string' && e.publicMessage.trim()) {
    return e.publicMessage.slice(0, 500);
  }
  return (e?.message ? String(e.message) : '未知错误').slice(0, 500);
}

function getOzonPublishErrorLogContext(e: any): Record<string, unknown> {
  if (e?.name === 'OzonApiError' && typeof e.toLogContext === 'function') {
    return e.toLogContext();
  }
  return {
    name: e?.name || 'Error',
    message: (e?.message ? String(e.message) : '未知错误').slice(0, 500),
  };
}

export function getSupplyGoodsLookupId(item: { sourceProductId?: string | null; sku?: string | null }): string | null {
  return normalizeProductId(item.sourceProductId) || normalizeProductId(item.sku);
}

export function buildCollectSnapshot(item: {
  id: string;
  title: string;
  sourceProductId?: string | null;
  sku?: string | null;
  sourceUrl?: string | null;
  status: string;
  createdAt: Date;
  updatedAt?: Date;
  purchasePrice?: { toString(): string } | null;
  images?: unknown;
  metadata?: unknown;
}) {
  const meta = (item.metadata && typeof item.metadata === 'object' ? item.metadata : {}) as Record<string, any>;
  return {
    collected: true,
    collectId: item.id,
    title: item.title,
    sourceProductId: item.sourceProductId || null,
    sku: item.sku || null,
    sourceUrl: item.sourceUrl || null,
    status: item.status,
    lastCollectedAt: (item.updatedAt || item.createdAt).toISOString(),
    price: item.purchasePrice?.toString() || null,
    imageCount: Array.isArray(item.images) ? item.images.length : 0,
    listed: item.status === 'listed',
    lastError: meta.lastError || null,
  };
}

function isNonEmptyObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function mergeCollectedMetadata(
  existing: unknown,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const current = isNonEmptyObject(existing) ? { ...(existing as Record<string, unknown>) } : {};
  const next = { ...current, ...incoming };

  if (current.publishTitleRu) next.publishTitleRu = current.publishTitleRu;
  if (current.publishDescriptionRu) next.publishDescriptionRu = current.publishDescriptionRu;
  if (current.publishOfferId) next.publishOfferId = current.publishOfferId;
  if (current.watermarkedImages) next.watermarkedImages = current.watermarkedImages;
  if (current.watermarkApplied !== undefined) next.watermarkApplied = current.watermarkApplied;

  return next;
}

async function ensureSourceProductProfileForListRow<T extends {
  id: string;
  title?: string | null;
  sourcePlatform?: string | null;
  sourceProductId?: string | null;
  sku?: string | null;
  metadata?: unknown;
  variants?: unknown;
}>(row: T): Promise<T> {
  const meta = metadataRecord(row.metadata);
  if (!isDomesticCollectedSource(row.sourcePlatform ?? meta.sourcePlatform)) return row;
  if (isNonEmptyObject(meta.sourceProductProfile)) return row;

  const sourceProductProfile = buildSourceProductProfile({
    id: row.id,
    title: String(meta.sourceTitleRaw ?? row.title ?? ''),
    sourcePlatform: String(row.sourcePlatform ?? meta.sourcePlatform ?? ''),
    sourceProductId: String(row.sourceProductId ?? row.sku ?? meta.sourceProductId ?? ''),
    metadata: meta,
    variants: row.variants,
  });
  const metadata = {
    ...meta,
    sourceProductProfile: cloneMetadataJson(sourceProductProfile, 200),
  };
  try {
    await prisma.supplyGoods.update({
      where: { id: row.id },
      data: { metadata: metadata as any },
    });
  } catch {
    // Best-effort backfill: the list response already carries the generated profile.
  }
  return { ...row, metadata };
}

async function findExistingCollectedOzonGoods(userId: string, item: {
  sourcePlatform?: unknown;
  sourceProductId?: unknown;
  sku?: unknown;
}) {
  const sourcePlatform = String(item.sourcePlatform || 'ozon').trim().toLowerCase();
  if (sourcePlatform !== 'ozon') return null;

  const lookupId = normalizeProductId(item.sourceProductId || item.sku);
  if (!lookupId) return null;

  return prisma.supplyGoods.findFirst({
    where: {
      userId,
      sourcePlatform: 'ozon',
      OR: [
        { sourceProductId: lookupId },
        { sku: lookupId },
      ],
    },
    orderBy: { updatedAt: 'desc' },
  });
}

export interface SourceOzonCategoryCanonicalContext {
  source: CanonicalSourceOzonCategoryInput;
  profile: SourceProductProfile;
}

export interface AuthoritativeOzonCategoryCatalogSnapshot {
  entries: OzonCategoryCatalogEntry[];
  categoryTree: SourceOzonCategoryTreeNode[];
  catalogRevision: string;
}

export interface SourceOzonCategoryMappingRouteService {
  listVisibleMappings(input: {
    ownerUserId: string;
    source: CanonicalSourceOzonCategoryInput;
  }): Promise<SourceOzonCategoryMappingRecord[]>;
  confirmTenantMapping(input: {
    ownerUserId: string;
    actorUserId: string;
    expectedTransitionVersion: number;
    source: CanonicalSourceOzonCategoryInput;
    target: OfficialOzonCategoryTarget;
  }): Promise<{ mapping: SourceOzonCategoryMappingRecord; idempotent: boolean }>;
}

type LoadAuthoritativeOzonCategoryCatalog = (input: {
  shopId: string;
  fetchTree(language: 'DEFAULT' | 'ZH_HANS'): Promise<SourceOzonCategoryTreeNode[]>;
}) => Promise<AuthoritativeOzonCategoryCatalogSnapshot>;

export interface CollectRoutesOptions {
  featureFlags?: SourceWorkflowFeatureFlagEvaluator;
  sourceListingWorkflowAdapter?: LegacySourceListingWorkflowAdapter;
  findBrowserOneClickReviewProtectedGoods?(input: {
    ownerUserId: string;
    shopId: string;
    supplyGoodsIds: string[];
  }): Promise<string[]>;
  publisherParityObserver?: {
    observe(input: {
      ownerUserId: string;
      shopId: string;
      rolloutRevision: string;
      entrypoint: 'COLLECT_PUBLISH_OZON' | 'BROWSER_ONE_CLICK';
      legacy: {
        endpoint: '/v3/product/import' | '/v1/product/import-by-sku';
        payload: { items: unknown[] };
        itemTrace?: Array<{
          ordinal: number;
          supplyGoodsId: string;
          sourceSkuAlias?: string | null;
        }>;
      };
      drafts: LegacySourceListingDraftPointer[];
    }): Promise<Record<string, unknown>>;
  };
  publisherParityTimeoutMs?: number;
  sourceCaptureService?: {
    ensureLegacyProjection(input: {
      trusted: {
        ownerUserId: string;
        actorUserId: string;
        rolloutRevision: string;
        rolloutStage: Exclude<SourceCaptureRolloutStage, 'off'>;
        ingestChannel: 'LEGACY_ADAPTER';
      };
      item: Record<string, unknown>;
    }): Promise<{ supplyGoodsId: string }>;
    ingestLegacy(input: {
      trusted: {
        ownerUserId: string;
        actorUserId: string;
        rolloutRevision: string;
        rolloutStage: Exclude<SourceCaptureRolloutStage, 'off'>;
        ingestChannel: 'LEGACY_ADAPTER';
      };
      item: Record<string, unknown>;
      supplyGoodsId: string;
    }): Promise<unknown>;
  };
  sourceOzonCategoryMappingService?: SourceOzonCategoryMappingRouteService;
  loadCanonicalSourceOzonCategoryContext?(input: {
    ownerUserId: string;
    supplyGoodsId: string;
  }): Promise<SourceOzonCategoryCanonicalContext | null>;
  loadAuthoritativeOzonCategoryCatalog?: LoadAuthoritativeOzonCategoryCatalog;
}

export interface CollectBatchRequestBody {
  items: any[];
  collectPhase?: string;
  ephemeralListing?: boolean;
  ephemeralListingSource?: string;
}

export interface CollectBatchDependencies {
  featureFlags?: SourceWorkflowFeatureFlagEvaluator;
  sourceCaptureService?: CollectRoutesOptions['sourceCaptureService'];
}

export interface CollectBatchResult {
  statusCode: number;
  body: Record<string, unknown>;
}

/**
 * Persists a browser-collected batch for an already authenticated owner.
 * Both account-token and scoped device routes use this function so the
 * authorization transport cannot change the ownership and validation rules.
 */
export async function collectBatchForOwner(input: {
  ownerUserId: string;
  body: CollectBatchRequestBody;
  dependencies?: CollectBatchDependencies;
  log?: { warn: (metadata: unknown, message: string) => void };
}): Promise<CollectBatchResult> {
  const userId = String(input.ownerUserId || '').trim();
  const body = input.body;
  if (!userId) return { statusCode: 401, body: { code: 0, errorCode: 'invalid_owner', msg: '无效的 ERP 账号' } };
  if (!Array.isArray(body?.items) || !body.items.length) {
    return { statusCode: 400, body: { code: 0, msg: '请提供商品数据' } };
  }
  if (body.items.length > 50) {
    return {
      statusCode: 413,
      body: {
        code: 0,
        errorCode: 'source_collect_batch_limit_exceeded',
        msg: '单次最多提交 50 件商品，请分批重试',
        data: { observedCount: body.items.length, limit: 50, recoverable: true },
      },
    };
  }

  const featureFlags = input.dependencies?.featureFlags || sourceWorkflowFeatureFlags;
  const sourceCaptureService = input.dependencies?.sourceCaptureService || null;
  const captureRollouts = new Map<string, SourceWorkflowFeatureDecision>();
  if (sourceCaptureService) {
    const platforms = [...new Set(body.items.map((item) => (
      String(item?.sourcePlatform || '').trim().toLowerCase()
    )).filter((platform) => platform === '1688'))];
    for (const platform of platforms) {
      let decision: SourceWorkflowFeatureDecision;
      try {
        decision = await featureFlags.evaluate('SOURCE_CAPTURE_V2', { ownerUserId: userId, platform });
      } catch {
        return { statusCode: 503, body: { code: 0, errorCode: 'source_workflow_rollout_unavailable', msg: '来源商品采集策略暂不可用' } };
      }
      captureRollouts.set(platform, decision);
      if (!decision.legacyAllowed) {
        return {
          statusCode: decision.enabled ? 409 : 503,
          body: {
            code: 0,
            errorCode: decision.enabled ? 'source_capture_v2_required' : 'source_workflow_rollout_unavailable',
            msg: decision.enabled ? '该来源商品已启用采集 V2，请升级扩展后重试' : '来源商品采集策略暂不可用',
            rolloutRevision: decision.revision,
          },
        };
      }
    }
  }

  const collectPhase = String(body.collectPhase || 'collect').trim().toLowerCase();
  const shouldUpdateExisting = collectPhase === 'enrichment';
  let saved = 0;
  const errors: { sku?: string; sourceProductId?: string; title?: string; error: string }[] = [];
  for (const item of body.items) {
    try {
      const validationError = validateDomesticCollectPayload(item as Record<string, unknown>);
      if (validationError) throw new Error(validationError);
      const sourceProductId = normalizeProductId(item.sourceProductId || item.sku);
      const sourcePlatform = String(item.sourcePlatform || '').trim().toLowerCase();
      const captureRollout = captureRollouts.get(sourcePlatform) as SourceWorkflowFeatureDecision | null;
      const legacyCaptureTrusted = sourceCaptureService
        && captureRollout?.enabled
        && (captureRollout.captureStage === 'shadow_write' || captureRollout.captureStage === 'dual_read')
        ? {
          ownerUserId: userId,
          actorUserId: userId,
          rolloutRevision: captureRollout.revision,
          rolloutStage: captureRollout.captureStage,
          ingestChannel: 'LEGACY_ADAPTER' as const,
        }
        : null;
      const imageState = await prepareCollectedSourceImageMetadata(item, userId);
      const metadata: Record<string, unknown> = {
        ...buildCollectedGoodsMetadata({ ...item, ...imageState.metadataPatch }),
        ...imageState.metadataPatch,
      };
      if (item.ozonAttributes) metadata.ozonAttributes = item.ozonAttributes;
      if (item.descriptionCategoryId) metadata.descriptionCategoryId = item.descriptionCategoryId;
      if (item.typeId) metadata.typeId = item.typeId;
      if (item.weightG) metadata.weightG = item.weightG;
      if (item.lengthMm) metadata.lengthMm = item.lengthMm;
      if (item.widthMm) metadata.widthMm = item.widthMm;
      if (item.heightMm) metadata.heightMm = item.heightMm;
      if (item.manufacturerName) metadata.manufacturerName = item.manufacturerName;
      if (item.brandName) metadata.brandName = item.brandName;
      if (item.priceText) metadata.priceText = String(item.priceText);
      if (item.unitPriceText) metadata.unitPriceText = String(item.unitPriceText);
      if (item.shippingCny !== undefined) metadata.shippingCny = item.shippingCny;
      if (item.totalCostCny !== undefined) metadata.totalCostCny = item.totalCostCny;
      if (item.priceSourceType) metadata.priceSourceType = String(item.priceSourceType);
      if (item.selectedSku) metadata.selectedSku = item.selectedSku;
      if (item.skuItems) metadata.skuItems = Array.isArray(item.skuItems) ? item.skuItems.slice(0, 100) : item.skuItems;
      if (item.rawSourceProduct) metadata.rawSourceProduct = item.rawSourceProduct;
      if (item.widgetStatesDump) metadata.widgetStatesDump = item.widgetStatesDump;
      const ephemeralListing = body.ephemeralListing === true || item.ephemeralListing === true;
      if (ephemeralListing) {
        metadata.ephemeralListing = true;
        metadata.ephemeralListingSource = String(item.ephemeralListingSource || body.ephemeralListingSource || 'browser-one-click-listing').slice(0, 120);
        metadata.ephemeralListingExpiresAt = new Date(Date.now() + EPHEMERAL_LISTING_TTL_MS).toISOString();
      }
      const hasVariants = Array.isArray(item.variants) && item.variants.length > 0;
      const sourceDescription = sanitizePublishDescription(item.description);
      const priceInfo = await resolveCollectedPrice(item.priceText || item.price, item.currency, item.sourceUrl);
      const displayTitle = resolveCollectedDisplayTitle({
        title: item.title,
        publishTitle: item.publishTitle,
        sourceTitleRaw: item.sourceTitleRaw,
        sourceUrl: item.sourceUrl,
        sourceProductId,
        sku: item.sku,
        sourcePlatform: item.sourcePlatform,
      });
      const ensuredProjection = sourceCaptureService && legacyCaptureTrusted
        ? await sourceCaptureService.ensureLegacyProjection({ trusted: legacyCaptureTrusted, item })
        : null;
      const existing = ensuredProjection
        ? await prisma.supplyGoods.findFirst({ where: { id: ensuredProjection.supplyGoodsId, userId } })
        : shouldUpdateExisting
          ? await findExistingCollectedOzonGoods(userId, { sourcePlatform: item.sourcePlatform, sourceProductId, sku: item.sku })
          : null;
      if (ensuredProjection && !existing) throw new Error('稳定采集投影不存在，请重试');
      const data = {
        title: displayTitle,
        sourceUrl: item.sourceUrl || null,
        sourcePlatform: item.sourcePlatform || 'ozon',
        sourceProductId,
        sku: item.sku || sourceProductId,
        images: imageState.images.length ? imageState.images : undefined,
        purchasePrice: priceInfo.purchasePriceCny,
        currency: 'CNY',
        originalPrice: priceInfo.originalPrice,
        originalCurrency: priceInfo.originalCurrency,
        exchangeRateUsed: priceInfo.exchangeRateUsed,
        priceNeedsReview: priceInfo.needsReview,
        notes: sourceDescription.slice(0, 500) || null,
        metadata: Object.keys(metadata).length ? (metadata as any) : undefined,
        variants: hasVariants ? (item.variants as any) : undefined,
        modelId: item.modelId ? String(item.modelId) : null,
        status: 'collected',
      };
      const persisted = existing
        ? await prisma.supplyGoods.update({ where: { id: existing.id }, data: { ...data, metadata: mergeCollectedMetadata(existing.metadata, metadata) as any } })
        : await prisma.supplyGoods.create({ data: { user: { connect: { id: userId } }, ...data } });
      if (sourceCaptureService && legacyCaptureTrusted) {
        try {
          await sourceCaptureService.ingestLegacy({ trusted: legacyCaptureTrusted, item, supplyGoodsId: persisted.id });
        } catch (caught) {
          input.log?.warn({ err: caught, sourcePlatform, sourceProductId }, 'source capture V2 shadow write failed');
        }
      }
      saved++;
    } catch (e: any) {
      const errMsg = (e?.message ? String(e.message) : '未知错误').slice(0, 300);
      errors.push({
        sku: item.sku ? String(item.sku) : undefined,
        sourceProductId: item.sourceProductId ? String(item.sourceProductId) : undefined,
        title: item.title ? String(item.title).slice(0, 100) : undefined,
        error: errMsg,
      });
    }
  }
  return {
    statusCode: 200,
    body: {
      code: saved > 0 ? 1 : 0,
      msg: saved > 0
        ? (errors.length ? `成功采集 ${saved} 件商品，${errors.length} 件失败` : `成功采集 ${saved} 件商品`)
        : (errors.length ? `采集失败：${errors[0]!.error}` : '采集失败'),
      data: { saved, errors },
    },
  };
}


class SourceOzonCategoryRouteError extends Error {
  constructor(
    readonly errorCode: string,
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'SourceOzonCategoryRouteError';
  }
}

const sourceOzonCategoryConfirmationSchema = z.object({
  shopId: z.string().trim().min(1).max(200),
  categoryId: z.number().int().positive(),
  typeId: z.number().int().positive(),
  expectedCatalogRevision: z.string().trim().min(1).max(200),
  expectedTransitionVersion: z.number().int().nonnegative(),
});

async function loadLiveAuthoritativeOzonCategoryCatalog(input: {
  shopId: string;
  fetchTree(language: 'DEFAULT' | 'ZH_HANS'): Promise<SourceOzonCategoryTreeNode[]>;
}): Promise<AuthoritativeOzonCategoryCatalogSnapshot> {
  const [defaultTree, zhHansTree] = await Promise.all([
    input.fetchTree('DEFAULT'),
    input.fetchTree('ZH_HANS'),
  ]);
  const entries = buildMergedOzonCategoryCatalog(defaultTree, zhHansTree);
  return {
    entries,
    categoryTree: defaultTree,
    catalogRevision: deriveOzonCategoryCatalogRevision(entries),
  };
}

function selectableOfficialOzonCategoryTarget(
  snapshot: AuthoritativeOzonCategoryCatalogSnapshot,
  categoryId: number,
  typeId: number,
): OfficialOzonCategoryTarget | null {
  const entry = snapshot.entries.find((candidate) => (
    candidate.descriptionCategoryId === categoryId
    && candidate.typeId === typeId
    && candidate.disabled !== true
    && candidate.selectable !== false
  ));
  if (!entry) return null;
  const categoryName = String(entry.categoryNameRu || '').trim();
  const typeName = String(entry.typeNameRu || '').trim();
  if (!categoryName || !typeName) return null;
  return {
    categoryId,
    typeId,
    categoryName,
    typeName,
    catalogRevision: snapshot.catalogRevision,
  };
}

const SOURCE_OZON_CATEGORY_CONFIRMATION_V2 = 'source-ozon-category-confirmed/v2';
const SOURCE_OZON_CATEGORY_CONFIRMATION_LEGACY_V1 = 'source-ozon-category-confirmed/legacy-v1';

function sourcePublishCategoryItemLabel(item: { id: string; sku?: unknown; title?: unknown }): string {
  return String(item.sku || item.title || item.id).trim() || item.id;
}

function sourcePublishCategoryGateError(
  errorCode: 'source_ozon_category_confirmation_required'
    | 'source_ozon_category_confirmation_mismatch'
    | 'source_ozon_category_confirmation_stale',
  statusCode: 409 | 422,
  item: { id: string; sku?: unknown; title?: unknown },
  message: string,
): SourceOzonCategoryRouteError {
  return new SourceOzonCategoryRouteError(
    errorCode,
    statusCode,
    `${sourcePublishCategoryItemLabel(item)}: ${message}`,
  );
}

async function assertSourcePublishCategoryConfirmations(input: {
  ownerUserId: string;
  items: Array<{
    id: string;
    sku?: unknown;
    title?: unknown;
    sourcePlatform?: unknown;
    metadata?: unknown;
  }>;
  fallbackCategoryId?: unknown;
  fallbackTypeId?: unknown;
  preferItemCategory: boolean;
  catalogSnapshot: AuthoritativeOzonCategoryCatalogSnapshot;
  mappingService?: SourceOzonCategoryMappingRouteService;
  loadCanonicalContext?(input: {
    ownerUserId: string;
    supplyGoodsId: string;
  }): Promise<SourceOzonCategoryCanonicalContext | null>;
}): Promise<void> {
  for (const item of input.items) {
    const effective = resolveItemPublishCategory(
      item,
      input.fallbackCategoryId,
      input.fallbackTypeId,
      input.preferItemCategory,
    );
    if (!selectableOfficialOzonCategoryTarget(
      input.catalogSnapshot,
      effective.categoryId,
      effective.typeId,
    )) {
      throw sourcePublishCategoryGateError(
        'source_ozon_category_confirmation_mismatch',
        422,
        item,
        `Ozon 类目/type ${effective.categoryId}/${effective.typeId} 不在当前可用官方目录中`,
      );
    }

    const confirmed = metadataRecord(metadataRecord(item.metadata).sourceOzonCategoryConfirmed);
    const version = String(confirmed.version || '').trim();
    if (!version) {
      throw sourcePublishCategoryGateError(
        'source_ozon_category_confirmation_required',
        409,
        item,
        '发布前必须先确认 Ozon 类目',
      );
    }
    if (positiveInt(confirmed.categoryId) !== effective.categoryId
      || positiveInt(confirmed.typeId) !== effective.typeId) {
      throw sourcePublishCategoryGateError(
        'source_ozon_category_confirmation_mismatch',
        422,
        item,
        '已确认类目与当前发布类目不一致，请重新确认',
      );
    }
    if (String(confirmed.catalogRevision || '').trim() !== input.catalogSnapshot.catalogRevision) {
      throw sourcePublishCategoryGateError(
        'source_ozon_category_confirmation_stale',
        409,
        item,
        'Ozon 类目目录已更新，请刷新候选并重新确认',
      );
    }

    if (version === SOURCE_OZON_CATEGORY_CONFIRMATION_LEGACY_V1) {
      if (String(confirmed.signature || '').trim() !== sourceCategorySignature(item)) {
        throw sourcePublishCategoryGateError(
          'source_ozon_category_confirmation_stale',
          409,
          item,
          '来源商品分类已变化，请重新确认 Ozon 类目',
        );
      }
      continue;
    }
    if (version !== SOURCE_OZON_CATEGORY_CONFIRMATION_V2) {
      throw sourcePublishCategoryGateError(
        'source_ozon_category_confirmation_required',
        409,
        item,
        '类目确认版本无效，请重新确认 Ozon 类目',
      );
    }
    if (!input.mappingService || !input.loadCanonicalContext) {
      throw sourcePublishCategoryGateError(
        'source_ozon_category_confirmation_stale',
        409,
        item,
        '无法验证当前类目确认，请刷新后重试',
      );
    }

    let canonicalContext: SourceOzonCategoryCanonicalContext | null;
    try {
      canonicalContext = await input.loadCanonicalContext({
        ownerUserId: input.ownerUserId,
        supplyGoodsId: item.id,
      });
    } catch {
      canonicalContext = null;
    }
    if (!canonicalContext) {
      throw sourcePublishCategoryGateError(
        'source_ozon_category_confirmation_stale',
        409,
        item,
        '来源采集快照已失效，请重新采集并确认类目',
      );
    }

    const identity = deriveSourceOzonCategoryIdentity(canonicalContext.source);
    const confirmedTransitionVersion = Number(confirmed.transitionVersion);
    const canonicalProjectionMatches = String(confirmed.signature || '').trim() === identity.sourceSignature
      && String(confirmed.sourceSnapshotId || '').trim() === identity.snapshotId
      && String(confirmed.sourceProfileHash || '').trim() === identity.profileHash
      && Number.isSafeInteger(confirmedTransitionVersion)
      && confirmedTransitionVersion > 0;
    if (!canonicalProjectionMatches) {
      throw sourcePublishCategoryGateError(
        'source_ozon_category_confirmation_stale',
        409,
        item,
        '来源商品证据已变化，请重新确认 Ozon 类目',
      );
    }

    let visibleMappings: SourceOzonCategoryMappingRecord[];
    try {
      visibleMappings = await input.mappingService.listVisibleMappings({
        ownerUserId: input.ownerUserId,
        source: canonicalContext.source,
      });
    } catch {
      visibleMappings = [];
    }
    const mappingId = String(confirmed.mappingId || '').trim();
    const currentMapping = visibleMappings.find((mapping) => mapping.id === mappingId);
    const mappingMatches = !!currentMapping
      && currentMapping.status === 'ACTIVE'
      && currentMapping.sourceSignature === identity.sourceSignature
      && currentMapping.sourceSnapshotId === identity.snapshotId
      && currentMapping.sourceProfileHash === identity.profileHash
      && currentMapping.targetCategoryId === effective.categoryId
      && currentMapping.targetTypeId === effective.typeId
      && currentMapping.catalogRevision === input.catalogSnapshot.catalogRevision
      && currentMapping.transitionVersion === confirmedTransitionVersion
      && (
        (currentMapping.scope === 'TENANT'
          && currentMapping.scopeKey === `tenant:${input.ownerUserId}`
          && currentMapping.ownerUserId === input.ownerUserId)
        || (currentMapping.scope === 'GLOBAL'
          && currentMapping.scopeKey === 'global'
          && currentMapping.ownerUserId === null
          && !!currentMapping.reviewedByUserId
          && !!currentMapping.reviewedAt)
      );
    if (!mappingMatches) {
      throw sourcePublishCategoryGateError(
        'source_ozon_category_confirmation_stale',
        409,
        item,
        '类目映射已变化，请刷新候选并重新确认',
      );
    }
  }
}

function mappingRouteError(reply: FastifyReply, caught: unknown) {
  const credentialError = findSourceWorkflowOzonCredentialsUnavailableError(caught);
  if (credentialError) {
    return reply.status(credentialError.statusCode).send({
      code: 0,
      errorCode: credentialError.code,
      msg: credentialError.message,
    });
  }
  if (caught instanceof SourceOzonCategoryRouteError) {
    return reply.status(caught.statusCode).send({
      code: 0,
      errorCode: caught.errorCode,
      msg: caught.message,
    });
  }
  if (caught instanceof SourceOzonCategoryContextError) {
    return reply.status(caught.statusCode).send({
      code: 0,
      errorCode: 'source_capture_v2_required',
      msg: caught.message,
    });
  }
  if (caught instanceof SourceOzonCategoryMappingError) {
    return reply.status(caught.statusCode).send({
      code: 0,
      errorCode: caught.code,
      msg: caught.message,
    });
  }
  if (caught instanceof OzonAttributeDefinitionsRequiredError) {
    return reply.status(caught.statusCode).send({
      code: 0,
      errorCode: caught.code,
      msg: caught.message,
    });
  }
  throw caught;
}

function toOzonCategoryAttributeDefinition(definition: OzonAttributeDefinition) {
  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    type: definition.type,
    is_collection: definition.isCollection,
    is_required: definition.isRequired,
    ...(definition.dictionaryId ? { dictionary_id: definition.dictionaryId } : {}),
  };
}

async function mergeSourceOzonCategoryMetadata(input: {
  ownerUserId: string;
  supplyGoodsId: string;
  metadataPatch: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const rows = await prisma.$queryRaw<Array<{ metadata: unknown }>>(Prisma.sql`
    UPDATE "supply_goods"
    SET "metadata" = COALESCE("metadata", '{}'::jsonb)
          || CAST(${JSON.stringify(input.metadataPatch)} AS jsonb),
        "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${input.supplyGoodsId}
      AND "user_id" = ${input.ownerUserId}
    RETURNING "metadata"
  `);
  const metadata = rows[0]?.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new SourceOzonCategoryRouteError(
      'source_ozon_category_projection_failed',
      500,
      'Ozon 类目确认已记录，但兼容投影失败，请重试',
    );
  }
  return metadata as Record<string, unknown>;
}

function sendSourceWorkflowLegacyPublishError(reply: FastifyReply, caught: unknown) {
  if (!(caught instanceof SourceWorkflowLegacyPublishError)) throw caught;
  return reply.status(caught.statusCode).send({
    code: 0,
    errorCode: caught.code,
    msg: caught.message,
    rolloutRevision: caught.decision.revision,
  });
}

export async function collectRoutes(app: FastifyInstance, options: CollectRoutesOptions = {}) {
  const featureFlags = options.featureFlags || sourceWorkflowFeatureFlags;
  const sourceListingWorkflowAdapter = options.sourceListingWorkflowAdapter
    || getDefaultLegacySourceListingWorkflowAdapter();
  const findBrowserOneClickReviewProtectedGoods = options.findBrowserOneClickReviewProtectedGoods
    || ((input) => findBrowserOneClickReviewProtectedSupplyGoodsIds(prisma, input));
  const publisherParityObserver = options.publisherParityObserver;
  const publisherParityTimeoutMs = Number.isFinite(options.publisherParityTimeoutMs)
    ? Math.max(10, Math.min(5_000, Number(options.publisherParityTimeoutMs)))
    : 2_000;
  const sourceCaptureService = options.sourceCaptureService;
  const sourceOzonCategoryMappingService = options.sourceOzonCategoryMappingService;
  const loadCanonicalSourceOzonCategoryContext = options.loadCanonicalSourceOzonCategoryContext;
  const loadAuthoritativeOzonCategoryCatalog = options.loadAuthoritativeOzonCategoryCatalog
    || loadLiveAuthoritativeOzonCategoryCatalog;
  app.addHook('preHandler', authenticate);

  // 扩展查询：某 SKU 是否已被当前用户采集（用于 ozon.ru 列表页 overlay）
  app.get('/status', async (request, reply) => {
    const { userId } = (request as any).user;
    const query = request.query as { sku?: string };
    const sku = String(query.sku || '').trim();
    if (!sku) {
      return reply.status(400).send({ code: 0, msg: '缺少 sku 参数' });
    }
    const ids = await findVisibleSupplyGoodsIdsBySku(userId, [sku], 1);
    const goods = ids[0]
      ? await prisma.supplyGoods.findFirst({
        where: { id: ids[0], userId },
        select: { id: true, title: true, status: true },
      })
      : null;
    return reply.send({
      code: 1,
      data: {
        collected: !!goods,
        shopName: goods?.title?.slice(0, 30) || null,
        status: goods?.status || null,
      },
    });
  });

  // 批量快照：扩展列表页用，返回多个 SKU 的采集状态
  app.post('/batch-snapshot', async (request, reply) => {
    const { userId } = (request as any).user;
    const body = request.body as { skus: string[] };

    if (!body?.skus?.length) {
      return reply.status(400).send({ code: 0, msg: '缺少 skus 参数' });
    }

    const skus = Array.from(new Set(body.skus.map((sku) => String(sku || '').trim()).filter(Boolean))).slice(0, 100); // 限制最多 100 个
    if (!skus.length) {
      return reply.status(400).send({ code: 0, msg: '缺少 skus 参数' });
    }

    const ids = await findVisibleSupplyGoodsIdsBySku(userId, skus);
    const rawRecords = ids.length
      ? await prisma.supplyGoods.findMany({
        where: {
          userId,
          id: { in: ids },
        },
        select: {
          id: true,
          sourceProductId: true,
          sku: true,
          title: true,
          sourceUrl: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          purchasePrice: true,
          images: true,
          metadata: true,
        },
      })
      : [];
    const byId = new Map(rawRecords.map((record) => [record.id, record]));
    const records = ids
      .map((id) => byId.get(id))
      .filter((record): record is (typeof rawRecords)[number] => Boolean(record));

    const result: Record<string, any> = {};
    for (const r of records) {
      const key = getSupplyGoodsLookupId(r);
      if (!key || result[key]) continue;
      result[key] = buildCollectSnapshot(r);
    }

    return reply.send({ code: 1, data: result });
  });

  app.get('/randomize-config', async () => {
    const cfg = await getRandomizeConfig();
    return {
      code: 1,
      msg: 'ok',
      data: {
        enabled: cfg.enabled,
        randomOfferId: cfg.randomOfferId,
        dimensionJitterMm: cfg.dimensionJitterMm,
        dimensionMinMm: cfg.dimensionMinMm,
        weightBuckets: cfg.weightBuckets.map(([min, max]) => `${min}-${max}`).join(','),
      },
    };
  });

  app.get('/', async (request) => {
    const { userId } = (request as any).user;
    const query = request.query as { status?: string; search?: string; offset?: string; limit?: string; sourceGroup?: string; includeEphemeral?: string };
    void purgeExpiredEphemeralListingRecords(userId);

    const where: Record<string, unknown> = { userId };
    if (query.status) where.status = query.status;
    const sourceGroup = String(query.sourceGroup || '').trim().toLowerCase();
    if (sourceGroup === 'source') {
      where.sourcePlatform = { in: ['1688', 'pdd', 'taobao', 'tmall', 'xianyu', 'goofish'] };
    } else if (sourceGroup === 'ozon') {
      where.sourcePlatform = 'ozon';
    }
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { sku: { contains: query.search, mode: 'insensitive' } },
        { sourceProductId: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const offset = Math.max(0, Number(query.offset) || 0);
    const limit = Math.min(50, Math.max(1, Number(query.limit) || 20));
    const { total, rows } = query.includeEphemeral === '1'
      ? {
        total: await prisma.supplyGoods.count({ where: where as any }),
        rows: await prisma.supplyGoods.findMany({
          where: where as any,
          skip: offset,
          take: limit,
          orderBy: { updatedAt: 'desc' },
        }),
      }
      : await findVisibleSupplyGoodsPage({
        userId,
        status: query.status,
        sourceGroup,
        search: query.search,
        offset,
        limit,
      });

    const hydratedRows = await Promise.all(rows.map((row) => ensureSourceProductProfileForListRow(row)));

    return {
      code: 1,
      msg: 'ok',
      data: {
        total,
        rows: hydratedRows.map((r) => ({
          ...r,
          purchasePrice: r.purchasePrice?.toString() ?? null,
          originalPrice: r.originalPrice?.toString() ?? null,
          exchangeRateUsed: r.exchangeRateUsed?.toString() ?? null,
          titleSuggestion: suggestNeutralOzonPublishTitle(r),
        })),
      },
    };
  });

  app.post('/', async (request, reply) => {
    const { userId } = (request as any).user;
    const parsed = collectSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    const d = parsed.data;
    const validationError = validateDomesticCollectPayload(d as Record<string, unknown>);
    if (validationError) {
      return reply.status(400).send({ code: 0, msg: validationError });
    }
    const sourceProductId = normalizeProductId(d.sourceProductId || d.sku);
    const weightNote = d.weightG ? `重量: ${d.weightG}g` : (d.weight ? `重量: ${d.weight}g` : '');
    const sourceDescription = sanitizePublishDescription(d.description);
    const notes = [weightNote, sourceDescription.slice(0, 500)].filter(Boolean).join('\n') || null;
    const imageState = await prepareCollectedSourceImageMetadata(d, userId);
    const metadata: Record<string, unknown> = {
      ...buildCollectedGoodsMetadata({ ...d, ...imageState.metadataPatch }),
      ...imageState.metadataPatch,
    };
    const collectedVariants = Array.isArray(d.variants) && d.variants.length
      ? d.variants
      : (Array.isArray(d.skuItems) && d.skuItems.length ? d.skuItems : undefined);
    const displayTitle = resolveCollectedDisplayTitle({
      title: d.title,
      publishTitle: d.publishTitle,
      sourceTitleRaw: d.sourceTitleRaw,
      sourceUrl: d.sourceUrl,
      sourceProductId,
      sku: d.sku,
      sourcePlatform: d.sourcePlatform,
    });

    const priceInfo = await resolveCollectedPrice(d.priceText || (d.price != null ? String(d.price) : undefined), d.currency, d.sourceUrl);
    const item = await prisma.supplyGoods.create({
      data: {
        user: { connect: { id: userId } },
        title: displayTitle,
        sourceUrl: d.sourceUrl || null,
        sourcePlatform: d.sourcePlatform || 'ozon',
        sourceProductId,
        sku: d.sku || sourceProductId,
        images: imageState.images.length ? imageState.images : undefined,
        purchasePrice: priceInfo.purchasePriceCny,
        currency: 'CNY',
        originalPrice: priceInfo.originalPrice,
        originalCurrency: priceInfo.originalCurrency,
        exchangeRateUsed: priceInfo.exchangeRateUsed,
        priceNeedsReview: priceInfo.needsReview,
        notes,
        metadata: Object.keys(metadata).length ? (metadata as any) : undefined,
        variants: collectedVariants as any,
        modelId: d.modelId || null,
        status: 'collected',
      },
    });

    return reply.send({ code: 1, msg: '采集成功', data: { id: item.id } });
  });

  app.post('/batch', { bodyLimit: 10 * 1024 * 1024 }, async (request, reply) => {
    const { userId } = (request as any).user;
    const body = request.body as {
      items: any[];
      collectPhase?: string;
      ephemeralListing?: boolean;
      ephemeralListingSource?: string;
    };

    const result = await collectBatchForOwner({
      ownerUserId: userId,
      body,
      dependencies: {
        featureFlags,
        sourceCaptureService,
      },
      log: request.log,
    });
    return reply.status(result.statusCode).send(result.body);

  });

  app.post('/:id/videos/retransfer', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as { shopId?: string };
    const shopId = String(body.shopId || '').trim();
    const item = await prisma.supplyGoods.findFirst({ where: { id, userId } });
    if (!item) return reply.status(404).send({ code: 0, msg: '商品不存在' });
    if (shopId) {
      const shop = await prisma.shop.findFirst({ where: { id: shopId, userId, platform: 'OZON' } });
      if (!shop) return reply.status(400).send({ code: 0, msg: '请选择有效的 OZON 店铺' });
    }
    const meta = metadataRecord(item.metadata);
    const sourcePlatform = item.sourcePlatform || meta.sourcePlatform;
    if (!isDomesticCollectedSource(sourcePlatform)) {
      return reply.status(400).send({ code: 0, msg: '只有 1688/PDD/淘宝/闲鱼货源商品支持视频重新转存' });
    }
    const sourceVideos = getCollectedSourceVideos(item);
    const retryVideos = sourceVideosNeedingRetransfer(sourceVideos);
    if (!retryVideos.length) {
      return reply.send({
        code: 1,
        msg: '没有需要重新转存的视频',
        data: { item: collectItemResponse(item) },
      });
    }

    const videoTransfer = await transferSourceProductVideos({
      sourceVideos: retryVideos,
      sourcePlatform,
      userId,
      ...(shopId ? { shopId } : {}),
    });
    meta.sourceVideos = mergeRetransferredSourceVideos(sourceVideos, retryVideos, videoTransfer.videos);
    if (videoTransfer.diagnostic) {
      meta.sourceVideoTransfer = {
        ...videoTransfer.diagnostic,
        manualRetry: true,
        retriedAt: new Date().toISOString(),
      };
    }
    const updated = await prisma.supplyGoods.update({
      where: { id },
      data: { metadata: meta as any },
    });
    const diagnostic = videoTransfer.diagnostic;
    const attempted = Number(diagnostic?.attempted || 0);
    const transferred = Number(diagnostic?.transferred || 0);
    const failed = Array.isArray(diagnostic?.errors) ? diagnostic.errors.length : 0;
    if (attempted > 0 && transferred === 0 && failed > 0) {
      const firstError = String(diagnostic?.errors?.[0]?.error || '').trim();
      return reply.send({
        code: 0,
        msg: firstError ? `视频重新转存失败: ${firstError}` : '视频重新转存失败',
        data: { item: collectItemResponse(updated) },
      });
    }
    return reply.send({
      code: 1,
      msg: failed > 0 ? `视频重新转存部分完成，失败 ${failed} 个` : '视频重新转存完成',
      data: { item: collectItemResponse(updated) },
    });
  });

  app.post('/:id/list', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };

    const item = await prisma.supplyGoods.findFirst({ where: { id, userId } });
    if (!item) return reply.status(404).send({ code: 0, msg: '商品不存在' });

    await prisma.supplyGoods.update({ where: { id }, data: { status: 'listed' } });
    return reply.send({ code: 1, msg: '已标记为上架', data: { id } });
  });

  app.put('/:id', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;

    const item = await prisma.supplyGoods.findFirst({ where: { id, userId } });
    if (!item) return reply.status(404).send({ code: 0, msg: '商品不存在' });

    const data: Record<string, unknown> = {};
    if (body.title !== undefined) data.title = String(body.title);
    if (body.purchasePrice !== undefined) data.purchasePrice = body.purchasePrice ? parseFloat(String(body.purchasePrice)) : null;
    if (body.currency !== undefined) data.currency = String(body.currency);
    if (body.sku !== undefined) data.sku = String(body.sku);
    if (body.notes !== undefined) data.notes = body.notes ? String(body.notes).slice(0, 2000) : null;
    if (body.status !== undefined) data.status = String(body.status);
    if (body.images !== undefined) data.images = Array.isArray(body.images) ? body.images : null;
    if (body.sourceUrl !== undefined) data.sourceUrl = body.sourceUrl ? String(body.sourceUrl) : null;
    if (body.publishTitle !== undefined || body.publishOfferId !== undefined) {
      const meta: Record<string, unknown> = item.metadata && typeof item.metadata === 'object' ? { ...(item.metadata as any) } : {};
      if (body.publishTitle !== undefined) {
        const publishTitle = String(body.publishTitle || '').trim();
        if (publishTitle) {
          meta.publishTitleRu = publishTitle;
          if (containsRussianText(publishTitle)) delete meta.titleNeedsReview;
        } else delete meta.publishTitleRu;
      }
      if (body.publishOfferId !== undefined) {
        const publishOfferId = String(body.publishOfferId || '').trim();
        if (publishOfferId) meta.publishOfferId = publishOfferId;
        else delete meta.publishOfferId;
      }
      data.metadata = meta as any;
    }

    await prisma.supplyGoods.update({ where: { id }, data: data as any });
    return reply.send({ code: 1, msg: '已更新' });
  });

  app.post('/:id/ai-content-draft', async (request, reply) => {
    const { userId, actorUserId } = (request as any).user;
    const { id } = request.params as { id: string };
    const parsed = productContentDraftSchema.safeParse(request.body || {});
    if (!parsed.success) return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message || '参数错误' });

    const item = await prisma.supplyGoods.findFirst({ where: { id, userId } });
    if (!item) return reply.status(404).send({ code: 0, msg: '商品不存在' });

    const enabled = await getConfig('ai_product_generation_enabled');
    const provider = await getConfig('ai_provider');
    const baseUrl = String(await getConfig('ai_base_url') || '').trim();
    const apiKey = String(await getConfig('ai_api_key') || '').trim();
    const model = String(await getConfig('ai_model') || '').trim();
    const titleModel = String(await getConfig('ai_product_title_model') || '').trim();
    const descriptionModel = String(await getConfig('ai_product_description_model') || '').trim();
    const providerLabel = String(await getConfig('ai_provider_label') || '').trim();
    const timeoutMs = Number(await getConfig('ai_timeout_ms')) || 30000;
    const titlePrompt = String(await getConfig('ai_product_title_prompt') || '').trim();
    const descriptionPrompt = String(await getConfig('ai_product_description_prompt') || '').trim();
    const userDailyProductGenerationLimit = Number(await getConfig('ai_user_daily_product_generation_limit')) || 0;

    const result = await generateProductContentDraft({
      item,
      actorUserId: String(actorUserId || userId),
      fields: parsed.data.fields as ProductContentField[],
      config: {
        enabled,
        provider,
        baseUrl,
        apiKey,
        model,
        titleModel,
        descriptionModel,
        providerLabel,
        timeoutMs,
        titlePrompt,
        descriptionPrompt,
        userDailyProductGenerationLimit,
      },
      cacheStore: createPrismaAiTranslationCacheStore(prisma),
      usageStore: createPrismaAiUsageStore(prisma),
      generateText: generateAiText,
    });

    if (!result.ok) {
      return reply.status(400).send({ code: 0, msg: result.error, data: { drafts: result.drafts, limit: result.limit } });
    }

    const meta = metadataRecord(item.metadata);
    const aiContentDrafts = metadataRecord(meta.aiContentDrafts);
    for (const [field, draft] of Object.entries(result.drafts)) {
      aiContentDrafts[field] = draft;
    }
    meta.aiContentDrafts = aiContentDrafts;
    const applyResult = parsed.data.applyToPublish
      ? applyAiContentDraftsToPublishMetadata(meta)
      : { metadata: meta, applied: [] };
    const updated = await prisma.supplyGoods.update({
      where: { id },
      data: { metadata: applyResult.metadata as any },
    });

    return reply.send({
      code: 1,
      msg: 'AI 商品内容草稿已生成',
      data: {
        item: {
          ...updated,
          purchasePrice: updated.purchasePrice?.toString() ?? null,
          originalPrice: updated.originalPrice?.toString() ?? null,
          exchangeRateUsed: updated.exchangeRateUsed?.toString() ?? null,
        },
        drafts: result.drafts,
        applied: applyResult.applied,
        limit: result.limit,
      },
    });
  });

  app.post('/:id/variants/batch-delete', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };
    const parsed = batchDeleteVariantsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    const item = await prisma.supplyGoods.findFirst({ where: { id, userId } });
    if (!item) return reply.status(404).send({ code: 0, msg: '商品不存在' });

    const result = removeVariantsBySkus(item.variants, parsed.data.skus);
    if (!result.removed) {
      return reply.status(404).send({ code: 0, msg: '未找到要删除的变体 SKU', data: { missingSkus: result.missingSkus } });
    }

    await prisma.supplyGoods.update({
      where: { id },
      data: { variants: result.variants.length ? (result.variants as any) : null as any },
    });

    return reply.send({
      code: 1,
      msg: `已删除 ${result.removed} 个变体`,
      data: { count: result.variants.length, removed: result.removed, missingSkus: result.missingSkus },
    });
  });

  app.delete('/:id/variants/:sku', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id, sku } = request.params as { id: string; sku: string };

    const item = await prisma.supplyGoods.findFirst({ where: { id, userId } });
    if (!item) return reply.status(404).send({ code: 0, msg: '商品不存在' });

    const result = removeVariantsBySkus(item.variants, [sku]);
    if (!result.removed) {
      return reply.status(404).send({ code: 0, msg: '未找到该变体 SKU' });
    }

    await prisma.supplyGoods.update({
      where: { id },
      data: { variants: result.variants.length ? (result.variants as any) : null as any },
    });

    return reply.send({ code: 1, msg: '已删除变体', data: { count: result.variants.length } });
  });

  app.post('/batch-price', async (request, reply) => {
    const { userId } = (request as any).user;
    const body = request.body as { items: { id: string; price: number }[]; markupPct?: number };

    if (!body?.items?.length && !body?.markupPct) {
      return reply.status(400).send({ code: 0, msg: '请提供价格数据' });
    }

    if (body.markupPct && body.items?.length) {
      let updated = 0;
      for (const { id, price } of body.items) {
        const item = await prisma.supplyGoods.findFirst({ where: { id, userId } });
        if (!item) continue;
        const newPrice = Math.round(price * (1 + body.markupPct / 100) * 100) / 100;
        await prisma.supplyGoods.update({ where: { id }, data: { purchasePrice: newPrice } });
        updated++;
      }
      return reply.send({ code: 1, msg: `已更新 ${updated} 件商品价格（加价 ${body.markupPct}%）` });
    }

    if (body.items?.length) {
      let updated = 0;
      for (const { id, price } of body.items) {
        const item = await prisma.supplyGoods.findFirst({ where: { id, userId } });
        if (!item) continue;
        await prisma.supplyGoods.update({ where: { id }, data: { purchasePrice: price } });
        updated++;
      }
      return reply.send({ code: 1, msg: `已更新 ${updated} 件商品价格` });
    }

    return reply.send({ code: 0, msg: '无有效数据' });
  });

  app.post('/batch-import', async (request, reply) => {
    const { userId } = (request as any).user;
    const body = request.body as { skuData: string; markupPct?: number };

    if (!body?.skuData?.trim()) {
      return reply.status(400).send({ code: 0, msg: '请输入SKU数据（每行格式: SKU,价格）' });
    }

    const lines = body.skuData.trim().split('\n').filter(Boolean);
    let saved = 0;
    for (const line of lines.slice(0, 200)) {
      const parts = line.split(',').map((s) => s.trim());
      const sku = parts[0];
      let price = parseFloat(parts[1] || '0');
      if (!sku) continue;
      if (body.markupPct && price > 0) {
        price = Math.round(price * (1 + body.markupPct / 100) * 100) / 100;
      }
      const existing = await prisma.supplyGoods.findFirst({ where: { userId, sku } });
      if (existing) {
        await prisma.supplyGoods.update({
          where: { id: existing.id },
          data: { purchasePrice: price > 0 ? price : undefined },
        });
      } else {
        await prisma.supplyGoods.create({
          data: {
            user: { connect: { id: userId } },
            title: `SKU: ${sku}`,
            sku,
            purchasePrice: price > 0 ? price : null,
            currency: 'CNY',
            sourcePlatform: 'ozon',
            status: 'collected',
          },
        });
      }
      saved++;
    }

    return reply.send({ code: 1, msg: `已导入 ${saved} 条SKU数据`, data: { saved } });
  });

  // 改款表单预填：按 supplyGoods ids 拉源数据 + 推断分类/类型/属性
  app.post('/clone-prefill', async (request, reply) => {
    const { userId } = (request as any).user;
    const body = request.body as { ids: string[] };
    if (!body?.ids?.length) return reply.status(400).send({ code: 0, msg: '缺少 ids' });

    const items = await prisma.supplyGoods.findMany({
      where: { id: { in: body.ids }, userId },
    });

    const data = items.map((it) => {
      const meta = (it.metadata as any) || {};
      const variants = enrichOzonVariantSpecs(Array.isArray(it.variants) ? (it.variants as any[]) : []);
      const sourceImages = meta.watermarkedImages?.length
        ? meta.watermarkedImages
        : Array.isArray(it.images) ? (it.images as string[]) : [];
      return {
        id: it.id,
        updatedAt: it.updatedAt,
        title: it.title,
        description: resolvePublishDescription(it),
        sku: it.sku,
        sourceUrl: it.sourceUrl,
        purchasePrice: it.purchasePrice ? String(it.purchasePrice) : null,
        currency: it.currency,
        images: sourceImages,
        variants: variants.map((v) => ({
          sku: v.sku,
          attrs: v.attrs || {},
          price: v.price || null,
          stock: v.stock || 0,
          images: v.images || [],
        })),
        publishTitle: meta.publishTitleRu || null,
        titleNeedsReview: containsRussianText(meta.publishTitleRu) ? false : (!!meta.titleNeedsReview || containsCjkText(resolvePublishName(it))),
        modelId: it.modelId,
        categoryId: meta.descriptionCategoryId || null,
        typeId: meta.typeId || null,
        weightG: meta.weightG || 500,
        lengthMm: meta.lengthMm || 100,
        widthMm: meta.widthMm || 100,
        heightMm: meta.heightMm || 100,
        publishOfferId: meta.publishOfferId || null,
        hasOzonAttributes: Array.isArray(meta.ozonAttributes) && meta.ozonAttributes.length > 0,
      };
    });

    return reply.send({ code: 1, msg: 'ok', data });
  });

  // 保存用户在改款表单里改的字段（标题/描述/图片/尺寸/分类），写回 supplyGoods，让后续 publish-ozon 能读到
  app.post('/save-customization', async (request, reply) => {
    const { userId } = (request as any).user;
    const body = request.body as {
      id: string;
      expectedUpdatedAt?: string;
      title?: string;
      description?: string;
      images?: string[];
      sourceMainImages?: string[];
      sourceDetailImages?: string[];
      weightG?: number;
      lengthMm?: number;
      widthMm?: number;
      heightMm?: number;
      categoryId?: number;
      typeId?: number;
      publishTitle?: string;
      publishOfferId?: string;
      variants?: Array<{
        sku: string;
        price?: string;
        stock?: number;
        publishOfferId?: string;
        weightG?: number;
        lengthMm?: number;
        widthMm?: number;
        heightMm?: number;
      }>;
    };
    if (!body?.id) return reply.status(400).send({ code: 0, msg: '缺少 id' });
    if (Array.isArray(body.images) && body.images.length === 0) {
      return reply.status(400).send({ code: 'EMPTY_PUBLISH_IMAGES', msg: '至少保留一张发布图片' });
    }
    const expectedUpdatedAt = body.expectedUpdatedAt ? new Date(body.expectedUpdatedAt) : null;
    if (body.expectedUpdatedAt && Number.isNaN(expectedUpdatedAt?.getTime())) {
      return reply.status(400).send({ code: 'INVALID_TARGET_VERSION', msg: '商品版本时间无效' });
    }
    if (!expectedUpdatedAt) {
      return reply.status(400).send({ code: 'TARGET_VERSION_REQUIRED', msg: '保存商品时必须携带当前版本' });
    }

    const it = await prisma.supplyGoods.findFirst({ where: { id: body.id, userId } });
    if (!it) return reply.status(404).send({ code: 0, msg: '商品不存在或无权限' });

    const meta: any = it.metadata && typeof it.metadata === 'object' && !Array.isArray(it.metadata)
      ? { ...(it.metadata as Record<string, unknown>) }
      : {};
    if (body.weightG !== undefined) meta.weightG = body.weightG;
    if (body.lengthMm !== undefined) meta.lengthMm = body.lengthMm;
    if (body.widthMm !== undefined) meta.widthMm = body.widthMm;
    if (body.heightMm !== undefined) meta.heightMm = body.heightMm;
    if (body.categoryId !== undefined && body.categoryId > 0) meta.descriptionCategoryId = body.categoryId;
    if (body.typeId !== undefined && body.typeId > 0) meta.typeId = body.typeId;
    if (body.publishTitle !== undefined) {
      const publishTitle = String(body.publishTitle || '').trim();
      if (publishTitle) {
        meta.publishTitleRu = publishTitle;
        if (containsRussianText(publishTitle)) delete meta.titleNeedsReview;
      } else delete meta.publishTitleRu;
    }
    if (body.publishOfferId !== undefined) {
      const publishOfferId = String(body.publishOfferId || '').trim();
      if (publishOfferId) meta.publishOfferId = publishOfferId;
      else delete meta.publishOfferId;
    }
    if (body.description !== undefined) {
      const publishDescription = sanitizePublishDescription(body.description);
      if (publishDescription) meta.publishDescriptionRu = publishDescription;
      else delete meta.publishDescriptionRu;
    }
    // 历史字段名叫 watermarkedImages；这里实际表示改款表单确认后的商品级发布图片。
    // publish-ozon 会把变体封面排在它前面，避免多 SKU 主图被商品级图片覆盖。
    if (Array.isArray(body.images)) meta.watermarkedImages = body.images;
    if (Array.isArray(body.sourceMainImages)) meta.sourceMainImages = body.sourceMainImages;
    if (Array.isArray(body.sourceDetailImages)) meta.sourceDetailImages = body.sourceDetailImages;

    const updateData: any = { metadata: meta };
    if (body.title) updateData.title = body.title;
    if (body.description !== undefined) updateData.notes = sanitizePublishDescription(body.description);

    // 变体价格/库存覆盖（保留原 attrs/sku）
    if (body.variants?.length) {
      const oldVariants = Array.isArray(it.variants) ? (it.variants as any[]) : [];
      const overrideMap = new Map<string, NonNullable<typeof body.variants>[number]>();
      for (const variantOverride of body.variants) {
        const key = String(variantOverride.sku || '').trim();
        if (key) overrideMap.set(key, variantOverride);
      }
      updateData.variants = oldVariants.map((v) => {
        const variantKey = String(v.sku || v.skuId || v.id || '').trim();
        const o = overrideMap.get(variantKey);
        if (!o) return v;
        const next = { ...v };
        if (o.price !== undefined) next.price = o.price;
        if (o.stock !== undefined) next.stock = o.stock;
        if (typeof o.weightG === 'number' && Number.isFinite(o.weightG) && o.weightG > 0) next.weight = Math.round(o.weightG);
        if (typeof o.lengthMm === 'number' && Number.isFinite(o.lengthMm) && o.lengthMm > 0) next.depth = Math.round(o.lengthMm);
        if (typeof o.widthMm === 'number' && Number.isFinite(o.widthMm) && o.widthMm > 0) next.width = Math.round(o.widthMm);
        if (typeof o.heightMm === 'number' && Number.isFinite(o.heightMm) && o.heightMm > 0) next.height = Math.round(o.heightMm);
        if (o.publishOfferId !== undefined) {
          const publishOfferId = String(o.publishOfferId || '').trim();
          if (publishOfferId) next.publishOfferId = publishOfferId;
          else delete next.publishOfferId;
        }
        return next;
      });
    }

    const updatedAt = new Date();
    updateData.updatedAt = updatedAt;
    const updated = await prisma.supplyGoods.updateMany({
      where: {
        id: body.id,
        userId,
        updatedAt: expectedUpdatedAt,
      },
      data: updateData,
    });
    if (updated.count !== 1) {
      const current = await prisma.supplyGoods.findFirst({
        where: { id: body.id, userId },
        select: { updatedAt: true, images: true, metadata: true },
      });
      return reply.status(409).send({
        code: 'TARGET_CONFLICT',
        msg: '商品图片已被其他操作更新',
        data: current,
      });
    }
    return reply.send({
      code: 1,
      msg: '已保存',
      data: {
        updatedAt,
        images: Array.isArray(body.images) ? body.images : (it.images || []),
        metadata: updateData.metadata,
      },
    });
  });

  app.post('/publish-ozon', { bodyLimit: 10 * 1024 * 1024 }, async (request, reply) => {
    const { userId } = (request as any).user;
    const body = request.body as {
      ids: string[];
      shopId: string;
      categoryId?: number;
      typeId?: number;
      price?: string;
      stock?: number;
      weight?: number;
      height?: number;
      depth?: number;
      width?: number;
      markupPct?: number;
      markupAmount?: number;
      currencyRate?: number;
      mode?: 'follow' | 'clone';
      followBrand?: boolean;
      randomOfferId?: boolean;
      useItemCategory?: boolean;
      warehouseId?: number;
      priceOverrides?: Record<string, Record<string | number, number>>;
      offerIds?: Record<string, string>;
      variantOfferIds?: Record<string, Record<string | number, string>>;
      source?: 'collect-page' | 'listing-page' | 'batch-collect-page' | 'source-publish-page' | 'ozon-product-detail-workbench';
      forceRecreate?: boolean;
      jobId?: string;
      legacyWorkflowFallback?: boolean;
      draftRefs?: unknown;
    };

    if (!body?.ids?.length || !body.shopId) {
      return reply.status(400).send({ code: 0, msg: '请选择商品和目标店铺' });
    }

    const shop = await prisma.shop.findFirst({ where: { id: body.shopId, userId } });
    if (!shop || !shop.clientId || !shop.apiKeyEncrypted) {
      return reply.status(400).send({ code: 0, msg: '店铺配置不完整' });
    }
    const publishActor = (request as any).user || {};
    const actorUserId = String(publishActor.actorUserId || publishActor.userId || '');
    if (!publishActor.userId
      || actorUserId !== String(publishActor.userId)
      || publishActor.isSubAccount === true
      || publishActor.role === 'STAFF') {
      return reply.status(403).send({
        code: 0,
        errorCode: 'source_publish_owner_required',
        msg: '仅店铺所有者可提交 Ozon 发布任务',
      });
    }
    const assertCurrentLegacyPublish = () => assertLegacySourceOzonPublishAllowed(featureFlags, {
      ownerUserId: userId,
      shopId: shop.id,
      platform: String(shop.platform || ''),
    });
    try {
      await assertCurrentLegacyPublish();
    } catch (caught) {
      return sendSourceWorkflowLegacyPublishError(reply, caught);
    }

    const existingPublishJob = body.jobId ? await prisma.syncJob.findFirst({
      where: { id: body.jobId, type: 'PRODUCT_PUSH', shopId: body.shopId },
      include: { shop: { select: { userId: true } } },
    }) : null;
    if (body.jobId && (!existingPublishJob || existingPublishJob.shop.userId !== userId)) {
      return reply.status(404).send({ code: 0, msg: '上架任务不存在' });
    }
    const existingPublishPayload = metadataRecord(existingPublishJob?.payload);
    const isBrowserOneClickPublishJob = existingPublishPayload.source === 'browser-one-click-listing'
      || existingPublishPayload.browserOneClickJob === true;
    if (isBrowserOneClickPublishJob) {
      return reply.status(409).send({
        code: 0,
        errorCode: 'browser_one_click_review_required',
        terminal: true,
        msg: '浏览器一键上架必须先在 ERP 草稿工作台完成审核，兼容发布入口不会直接发布该任务',
      });
    }

    let items = await prisma.supplyGoods.findMany({
      where: { id: { in: body.ids }, userId },
    });

    if (!items.length) {
      return reply.send({ code: 0, msg: '未找到有效商品' });
    }

    let reviewProtectedGoods: string[];
    try {
      reviewProtectedGoods = await findBrowserOneClickReviewProtectedGoods({
        ownerUserId: userId,
        shopId: shop.id,
        supplyGoodsIds: items.map((item) => item.id),
      });
    } catch (error) {
      app.log.error({ err: error }, 'Failed to verify browser one-click review authority');
      return reply.status(503).send({
        code: 0,
        errorCode: 'source_listing_review_authority_unavailable',
        terminal: false,
        msg: '无法确认来源草稿发布权限，旧发布入口已失败关闭',
      });
    }
    if (reviewProtectedGoods.length) {
      return reply.status(409).send({
        code: 0,
        errorCode: 'source_listing_v2_publisher_required',
        terminal: true,
        msg: '浏览器一键上架草稿已进入 ERP 审核流程，只能通过不可变 V2 发布器提交',
      });
    }

    const sourceListingCompatibility = await resolveLegacySourceListingCompatibility({
      featureFlags,
      adapter: sourceListingWorkflowAdapter,
      ownerUserId: userId,
      actorUserId,
      shopId: shop.id,
      platform: String(shop.platform || ''),
      supplyGoodsIds: items.map((item) => item.id),
      legacyFallback: body.legacyWorkflowFallback,
    });
    if (['dual_read', 'v2_only'].includes(sourceListingCompatibility.stage)
      || body.draftRefs !== undefined) {
      try {
        const draftRefs = normalizeSourceListingDraftIdentityRefs(body.draftRefs);
        assertSourceListingDraftIdentity({
          refs: draftRefs,
          prepared: sourceListingCompatibility.drafts.map((draft) => ({
            supplyGoodsId: draft.supplyGoodsId,
            draftId: draft.draftId,
            draftVersion: draft.draftVersion,
            revision: draft.revision,
            selectedSkuKeys: draft.selectedSkuKeys || [],
          })),
        });
      } catch (caught) {
        if (caught instanceof SourceListingDraftIdentityError) {
          return reply.status(caught.statusCode).send({
            code: 0,
            errorCode: caught.code,
            msg: caught.message,
            rolloutRevision: sourceListingCompatibility.rolloutRevision,
          });
        }
        throw caught;
      }
      return reply.status(409).send({
        code: 0,
        errorCode: 'source_listing_v2_publisher_required',
        terminal: true,
        msg: '已审核来源草稿只能通过不可变 V2 发布器提交；当前兼容入口不会从可变商品投影发布',
        rolloutRevision: sourceListingCompatibility.rolloutRevision,
      });
    }
    if (existingPublishJob) {
      await prisma.syncJob.update({
        where: { id: existingPublishJob.id },
        data: {
          payload: {
            ...existingPublishPayload,
            sourceListingWorkflow: sourceListingCompatibilityMetadata(sourceListingCompatibility),
          } as unknown as Prisma.InputJsonValue,
        },
      });
    }

    const { OzonClient } = await import('../services/ozon-client.js');
    const { decrypt } = await import('../lib/crypto.js');
    const client = new OzonClient({ clientId: shop.clientId, apiKey: decrypt(shop.apiKeyEncrypted) });

    const observePublisherParity = async (input: {
      endpoint: '/v3/product/import' | '/v1/product/import-by-sku';
      items: unknown[];
      supplyGoodsIds: string[];
      itemTrace: Array<{
        ordinal: number;
        supplyGoodsId: string;
        sourceSkuAlias?: string | null;
      }>;
    }): Promise<Record<string, unknown> | null> => {
      if (!publisherParityObserver || sourceListingCompatibility.stage === 'off') return null;
      try {
        const branchSupplyGoodsIds = new Set(input.supplyGoodsIds);
        const branchDrafts = sourceListingCompatibility.drafts.filter((draft) => (
          branchSupplyGoodsIds.has(draft.supplyGoodsId)
        ));
        const preparedSupplyGoodsIds = new Set(branchDrafts.map((draft) => draft.supplyGoodsId));
        const branchPreparationFailed = sourceListingCompatibility.failures.some((failure) => (
          branchSupplyGoodsIds.has(failure.supplyGoodsId)
        ));
        const branchCoverageComplete = branchSupplyGoodsIds.size > 0
          && preparedSupplyGoodsIds.size === branchSupplyGoodsIds.size
          && branchDrafts.length === branchSupplyGoodsIds.size
          && !branchPreparationFailed;
        const observation = publisherParityObserver.observe({
          ownerUserId: userId,
          shopId: shop.id,
          rolloutRevision: sourceListingCompatibility.rolloutRevision,
          entrypoint: isBrowserOneClickPublishJob
            ? 'BROWSER_ONE_CLICK'
            : 'COLLECT_PUBLISH_OZON',
          legacy: {
            endpoint: input.endpoint,
            payload: { items: input.items },
            itemTrace: input.itemTrace,
          },
          drafts: branchCoverageComplete ? branchDrafts : [],
        });
        let timeout: ReturnType<typeof setTimeout> | null = null;
        const report = await Promise.race([
          observation,
          new Promise<null>((resolve) => {
            timeout = setTimeout(() => resolve(null), publisherParityTimeoutMs);
            timeout.unref?.();
          }),
        ]).finally(() => {
          if (timeout) clearTimeout(timeout);
        });
        if (!report) {
          app.log.warn('Ozon publisher parity shadow observation timed out; legacy publish remains authoritative');
          return null;
        }
        return report && typeof report === 'object' && !Array.isArray(report) ? report : null;
      } catch {
        app.log.warn('Ozon publisher parity shadow observation failed; legacy publish remains authoritative');
        return null;
      }
    };
    const assertObservedLegacyPublish = async () => {
      const decision = await assertCurrentLegacyPublish();
      if (decision.revision !== sourceListingCompatibility.rolloutRevision) {
        throw new SourceWorkflowLegacyPublishError({
          ...decision,
          enabled: false,
          legacyAllowed: false,
          reason: 'policy_revision_changed',
        });
      }
      return decision;
    };

    // 货币校验：上架价格统一按 CNY 处理（店铺合同货币 CNY；后端不做汇率换算）
    // 防御历史 bug：曾出现 RUB 价被当 CNY 直接 markup，OZON 后台再按汇率显示成 ¥2612 的错位
    const wrongCurrency = items.filter((it) => it.currency && it.currency !== 'CNY' && it.purchasePrice != null);
    if (wrongCurrency.length) {
      const sample = wrongCurrency.slice(0, 3).map((it) => `${it.sku || it.id}(${it.currency} ${it.purchasePrice})`).join('、');
      return reply.status(400).send({
        code: 0,
        msg: `${wrongCurrency.length} 件商品采购价货币不是 CNY（${sample}），请先在采集列表把价格改成人民币再上架。当前不支持自动汇率换算，避免按汇率上架价格错位。`,
      });
    }

    try {
      assertPublishNamesAreSafe(items);
    } catch (e: any) {
      return reply.status(400).send({ code: 0, msg: e?.message || '上架标题校验失败' });
    }

    // 分流：Ozon SKU 跟卖 fallback 只适用于真实 Ozon product_id；源商品上架走 product/import 创建新卡片。
    const withAttrs = items.filter((it) => shouldUseProductImportForPublishItem(it, body.source));
    const noAttrs = items.filter((it) => !shouldUseProductImportForPublishItem(it, body.source));

    const markupPct = Number.isFinite(body.markupPct) ? body.markupPct : 0;
    const markupAmount = Number(body.markupAmount) || 0;
    const mode = body.mode === 'clone' ? 'clone' : 'follow';
    const followBrand = body.followBrand !== false;
    const preferItemCategory = body.useItemCategory === true || body.source === 'listing-page';
    if (withAttrs.length) {
      const missingCategoryItems = withAttrs.filter((item) => {
        if (preferItemCategory) return !hasOwnPublishCategory(item);
        const category = resolveItemPublishCategory(item, body.categoryId, body.typeId, preferItemCategory);
        return !category.categoryId || !category.typeId;
      });
      if (missingCategoryItems.length) {
        const sample = missingCategoryItems.slice(0, 3).map((item) => item.sku || item.title || item.id).join('、');
        return reply.status(400).send({
          code: 0,
          msg: `${missingCategoryItems.length} 件商品缺少独立 OZON 分类/类型 ID（${sample}）。请先点击“从源商品继承分类/重量/尺寸”，或手动补齐后再上架。`,
        });
      }
    }
    let publishCatalogSnapshot: AuthoritativeOzonCategoryCatalogSnapshot | null = null;
    if (body.source === 'source-publish-page') {
      try {
        publishCatalogSnapshot = await loadAuthoritativeOzonCategoryCatalog({
          shopId: body.shopId,
          fetchTree: async (language) => client.getDescriptionCategoryTree({ language }),
        });
      } catch {
        return reply.status(503).send({
          code: 0,
          errorCode: 'ozon_category_catalog_unavailable',
          msg: '当前 Ozon 官方类目目录不可用，请稍后重试',
        });
      }
      if (!publishCatalogSnapshot.catalogRevision || !Array.isArray(publishCatalogSnapshot.entries)) {
        return reply.status(503).send({
          code: 0,
          errorCode: 'ozon_category_catalog_invalid',
          msg: '当前 Ozon 官方类目目录无效，请稍后重试',
        });
      }
      try {
        await assertSourcePublishCategoryConfirmations({
          ownerUserId: userId,
          items,
          fallbackCategoryId: body.categoryId,
          fallbackTypeId: body.typeId,
          preferItemCategory,
          catalogSnapshot: publishCatalogSnapshot,
          mappingService: sourceOzonCategoryMappingService,
          loadCanonicalContext: loadCanonicalSourceOzonCategoryContext,
        });
      } catch (caught) {
        return mappingRouteError(reply, caught);
      }
    }
    if (noAttrs.length && body.forceRecreate !== true) {
      const recentFallbackJobs = await prisma.syncJob.findMany({
        where: {
          ...(body.jobId ? { id: { not: body.jobId } } : {}),
          shopId: body.shopId,
          type: 'PRODUCT_PUSH',
          status: { in: ['RUNNING', 'SUCCESS'] },
        },
        select: { id: true, status: true, payload: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      const recreateConflicts = findFallbackRecreateConflicts(noAttrs, recentFallbackJobs);
      if (recreateConflicts.length) {
        const sample = recreateConflicts
          .slice(0, 5)
          .map((conflict) => conflict.taskId ? `${conflict.sku}(任务 ${conflict.taskId})` : conflict.sku)
          .join('、');
        return reply.status(409).send({
          code: 0,
          msg: `${recreateConflicts.length} 件跟卖商品已上架/已提交过（${sample}）。Ozon 会拒绝同一源 SKU 再用新货号重复创建，这不是图片采集问题；如果只是图片没补完，请到“上架日志”打开上一次成功任务并刷新补传图片。`,
          data: {
            code: 'FALLBACK_RECREATE_BLOCKED',
            conflicts: recreateConflicts,
          },
        });
      }
    }
    const randomizeCfg = await getRandomizeConfig();
    const userPrefersRandomOfferId = body.randomOfferId !== false;

    function getItemCustomOfferId(item: any): unknown {
      const meta = item.metadata as any;
      return body.offerIds?.[item.id] ?? meta?.publishOfferId;
    }

    function getVariantCustomOfferId(item: any, variant: any, index: number): unknown {
      const variantMap = body.variantOfferIds?.[item.id] || {};
      const sku = variant?.sku != null ? String(variant.sku) : '';
      return (sku ? variantMap[sku] : undefined)
        ?? variantMap[index]
        ?? variantMap[String(index)]
        ?? variant?.publishOfferId;
    }

    function buildOfferId(sourceSku: string | null | undefined, fallback: string, customOfferId?: unknown): string {
      return resolvePublishOfferId({
        sourceSku,
        fallback,
        customOfferId,
        randomizeEnabled: randomizeCfg.enabled,
        randomOfferIdEnabled: randomizeCfg.randomOfferId,
        userRandomOfferId: userPrefersRandomOfferId,
      });
    }

    // ====== Fallback: 没属性的商品走 import-by-sku（继承源卡片）======
    let fallbackTaskId: number | null = null;
    let fallbackCount = 0;
    let fallbackError: string | null = null;
    let fallbackJobId: string | null = null;
    let fallbackPublisherParityForSharedJob: Record<string, unknown> | null = null;
    let mainPublisherParityReport: Record<string, unknown> | null = null;
    if (noAttrs.length > 0) {
      // 收集 fallback：每个 SupplyGoods 如果有 variants[]，展开为 N 个跟卖 item；否则保持单 SKU
      const fallbackTrace: { offerId: string; sourceItemId: string; sourceVariantSku: string; variantAttrs: any }[] = [];
      const fallbackOfferImages: Record<string, string> = {};
      const fallbackOfferImageLists: Record<string, string[]> = {};
      const fallbackPictureUploads: any[] = [];
      const fallbackEmittedSourceItemIds = new Set<string>();
      const fallbackParityIdentityByOfferId = new Map<string, {
        supplyGoodsId: string;
        sourceSkuAlias: string;
      }>();
      let fallbackPictureUploadError: string | null = null;
      const fallbackSourceItemIds = noAttrs.map((item) => item.id);
      const fallbackSourceSkus = noAttrs.map((item) => item.sku).filter(Boolean);
      const previousFallbackStatuses = new Map(noAttrs.map((item) => [item.id, item.status || 'collected']));
      const fallbackItems = noAttrs
        .flatMap((item) => {
          const basePriceCny = parseFloat(body.price || item.purchasePrice?.toString() || '100');
          const priceWithMarkup = calcPublishPrice(basePriceCny, markupPct, markupAmount);
          const variants = enrichOzonVariantSpecs(Array.isArray(item.variants) ? (item.variants as any[]) : []);
          const itemOverrides = body.priceOverrides?.[item.id] || {};
          // variants[].price 是采集时的原币价（如 RUB），需要按采集时存的汇率换算 CNY
          const fxRate = item.originalCurrency && item.originalCurrency !== 'CNY' && item.exchangeRateUsed
            ? Number(item.exchangeRateUsed)
            : null;

          // 无 variants：保持原行为（1 条）
          if (!variants.length) {
            const sourceSku = item.sku && /^\d+$/.test(item.sku) ? Number(item.sku) : null;
            if (!sourceSku) return [];
            fallbackEmittedSourceItemIds.add(item.id);
            const offerId = buildOfferId(item.sku, `f${Date.now().toString(36)}${randomSuffix(4)}`, getItemCustomOfferId(item));
            fallbackParityIdentityByOfferId.set(offerId, {
              supplyGoodsId: item.id,
              sourceSkuAlias: String(item.sku),
            });
            const rawImages = resolveBasePublishImages(item);
            recordOfferPublishImages(fallbackOfferImageLists, fallbackOfferImages, offerId, rawImages);
            return [{
              sku: sourceSku,
              name: resolvePublishName(item),
              offer_id: offerId,
              price: String(priceWithMarkup),
              old_price: String(Math.ceil(priceWithMarkup * 1.2)),
              currency_code: 'CNY',
              vat: '0',
            }];
          }

          // 有 variants：每个 sub-SKU 一条跟卖（每个变体本身就是独立的 OZON product_id）
          const baseRawImages = resolveBasePublishImages(item);
          return variants
            .map((v, idx) => {
              const subSourceSku = v.sku && /^\d+$/.test(String(v.sku)) ? Number(v.sku) : null;
              if (!subSourceSku) return null;
              fallbackEmittedSourceItemIds.add(item.id);
              const subPrice = resolveVariantPublishPriceCny({
                itemOverrides,
                variant: v,
                index: idx,
                groupBasePriceCny: basePriceCny,
                markupPct,
                markupAmount,
                fxRate,
              });
              const offerId = buildOfferId(String(v.sku), `f${Date.now().toString(36)}${randomSuffix(4)}`, getVariantCustomOfferId(item, v, idx));
              fallbackParityIdentityByOfferId.set(offerId, {
                supplyGoodsId: item.id,
                sourceSkuAlias: String(v.sku),
              });
              fallbackTrace.push({
                offerId,
                sourceItemId: item.id,
                sourceVariantSku: String(v.sku),
                variantAttrs: v.attrs || null,
              });
              const rawImages = resolveVariantPublishImages(item, v, baseRawImages);
              recordOfferPublishImages(fallbackOfferImageLists, fallbackOfferImages, offerId, rawImages);
              const subAttrs = sanitizeVariantAttrsForPublish(v.attrs && typeof v.attrs === 'object' ? v.attrs as Record<string, string> : undefined);
              const subTitle = resolvePublishName(item, subAttrs);
              return {
                sku: subSourceSku,
                name: subTitle,
                offer_id: offerId,
                price: String(subPrice),
                old_price: String(Math.ceil(subPrice * 1.2)),
                currency_code: 'CNY',
                vat: '0',
              };
            })
            .filter((x): x is NonNullable<typeof x> => x !== null);
        });

      console.log(`[publish-ozon fallback] expanded ${noAttrs.length} SupplyGoods to ${fallbackItems.length} fallback items (variants展开)`);
      if (fallbackItems.length) {
        const fallbackPublisherParity = await observePublisherParity({
          endpoint: '/v1/product/import-by-sku',
          items: fallbackItems,
          supplyGoodsIds: [...fallbackEmittedSourceItemIds],
          itemTrace: fallbackItems.flatMap((item, ordinal) => {
            const identity = fallbackParityIdentityByOfferId.get(item.offer_id);
            return identity ? [{ ordinal, ...identity }] : [];
          }),
        });
        fallbackPublisherParityForSharedJob = fallbackPublisherParity;
        const fallbackBasePayload = {
          itemCount: fallbackItems.length,
          sourceItemCount: noAttrs.length,
          source: isBrowserOneClickPublishJob ? 'browser-one-click-listing' : 'collect-publish-fallback',
          ...(isBrowserOneClickPublishJob ? {
            browserOneClickJob: true,
            publishSource: 'collect-publish-fallback',
            stage: 'publishing',
            submittedAt: existingPublishPayload.submittedAt || null,
            publish: existingPublishPayload.publish || null,
          } : {}),
          entry: body.source || 'collect-page',
          sourceListingWorkflow: sourceListingCompatibilityMetadata(sourceListingCompatibility),
          ...(fallbackPublisherParity ? { publisherEntrypointParity: fallbackPublisherParity } : {}),
          mode: 'follow-by-sku',
          followBrand,
          warehouseId: body.warehouseId ?? null,
          offerIds: fallbackItems.map((i) => i.offer_id),
          sourceItemIds: fallbackSourceItemIds,
          sourceSkus: fallbackSourceSkus,
          offerImages: Object.keys(fallbackOfferImages).length ? fallbackOfferImages : null,
          offerImageLists: Object.keys(fallbackOfferImageLists).length ? fallbackOfferImageLists : null,
          pictureUploads: null,
          pictureUploadFailedCount: 0,
          pictureUploadSkippedCount: 0,
          pictureUploadPendingCount: fallbackItems.length,
          pictureUploadStatus: 'pending',
          pictureUploadError: null,
          variantTrace: fallbackTrace.length ? fallbackTrace : null,
        };
        try {
          await assertObservedLegacyPublish();
        } catch (caught) {
          return sendSourceWorkflowLegacyPublishError(reply, caught);
        }
        const locked = await prisma.supplyGoods.updateMany({
          where: {
            id: { in: fallbackSourceItemIds },
            userId,
            status: { notIn: ['listed', 'listing_pending'] },
          },
          data: { status: 'listing_pending' },
        });
        if (locked.count !== fallbackSourceItemIds.length) {
          return reply.status(409).send({
            code: 0,
            msg: '这些商品正在上架中或已经提交过，请到“上架日志”查看上一条任务并刷新状态，不要重复点击上架。',
            data: { code: 'FALLBACK_RECREATE_BLOCKED' },
          });
        }
        const fallbackJob = await upsertPublishOzonSyncJob({
          jobId: body.jobId,
          shopId: body.shopId,
          status: 'RUNNING',
          payload: fallbackBasePayload,
        });
        fallbackJobId = fallbackJob.id;

        try {
          try {
            await assertObservedLegacyPublish();
          } catch (caught) {
            if (!(caught instanceof SourceWorkflowLegacyPublishError)) throw caught;
            await Promise.all(noAttrs.map((item) => prisma.supplyGoods.update({
              where: { id: item.id },
              data: { status: previousFallbackStatuses.get(item.id) || 'collected' },
            }).catch(() => null)));
            await upsertPublishOzonSyncJob({
              jobId: fallbackJobId,
              shopId: body.shopId,
              status: 'FAILED',
              finishedAt: new Date(),
              payload: {
                ...fallbackBasePayload,
                stage: 'rollout_blocked',
              },
              errorMessage: caught.message,
            }).catch(() => null);
            return sendSourceWorkflowLegacyPublishError(reply, caught);
          }
          const fbResult = await client.importBySku(fallbackItems);
          fallbackTaskId = fbResult.result.task_id;
          fallbackCount = fallbackItems.length;
          const unmatched = fbResult.result.unmatched_sku_list || [];
          console.log(`[publish-ozon fallback] import-by-sku task_id=${fallbackTaskId}, count=${fallbackItems.length}, unmatched=${unmatched.length}`);
          if (unmatched.length) {
            fallbackError = `${unmatched.length} 件商品被源卖家禁止跟卖`;
          }

          let fallbackImportItems: any[] = [];
          // 轮询拿 product_id，然后上传采集的图片
          if (!unmatched.length) {
            await new Promise((r) => setTimeout(r, 3000));
            try {
              const info = await client.getImportInfo(fallbackTaskId);
              fallbackImportItems = Array.isArray(info.items) ? info.items : [];
              for (const it of info.items || []) {
                if (it.product_id && it.status === 'imported') {
                  const offerId = String(it.offer_id || '');
                  const rawImages = offerId ? fallbackOfferImageLists[offerId] || [] : [];
                  if (!rawImages.length) {
                    recordPictureUploadDiagnostic(fallbackPictureUploads, {
                      offerId,
                      productId: it.product_id,
                      status: 'skipped',
                      rawImages,
                      message: '该 offer 没有可上传图片，可能采集阶段没有拿到图片',
                    });
                    continue;
                  }
                  try {
                    const resolvedImages = await resolveImageUrls(rawImages, body.shopId, userId);
                    await client.importProductPictures({ product_id: it.product_id, images: resolvedImages });
                    recordPictureUploadDiagnostic(fallbackPictureUploads, {
                      offerId,
                      productId: it.product_id,
                      status: 'uploaded',
                      rawImages,
                      resolvedImages,
                    });
                    console.log(`[publish-ozon fallback] uploaded ${resolvedImages.length} images for product_id=${it.product_id}`);
                  } catch (e: any) {
                    recordPictureUploadDiagnostic(fallbackPictureUploads, {
                      offerId,
                      productId: it.product_id,
                      status: 'failed',
                      rawImages,
                      error: e,
                    });
                    console.warn(`[publish-ozon fallback] pictures upload failed for offer=${offerId}:`, e.message?.slice(0, 150));
                  }
                }
              }
            } catch (e: any) {
              fallbackPictureUploadError = e.message?.slice(0, 300) || '图片补传状态读取失败';
              console.warn(`[publish-ozon fallback] pictures upload status failed:`, fallbackPictureUploadError);
            }
          }

          for (const item of noAttrs) {
            await prisma.supplyGoods.update({ where: { id: item.id }, data: { status: 'listed' } });
          }
          scheduleEphemeralListingCleanup(noAttrs, userId, 5 * 60 * 1000);

          const uploadedOfferIds = new Set(
            fallbackPictureUploads
              .filter((it) => it.status === 'uploaded')
              .map((it) => String(it.offerId || '').trim())
              .filter(Boolean),
          );
          const blockedOfferIds = new Set(
            fallbackPictureUploads
              .filter((it) => it.status === 'failed' || it.status === 'skipped')
              .map((it) => String(it.offerId || '').trim())
              .filter(Boolean),
          );
          const fallbackPendingCount = fallbackImportItems.filter((it: any) => {
            const offerId = String(it?.offer_id || '').trim();
            if (!offerId || uploadedOfferIds.has(offerId) || blockedOfferIds.has(offerId)) return false;
            const productId = positiveInt(it?.product_id);
            const status = String(it?.status || '').toLowerCase();
            return !productId || status === 'pending';
          }).length;
          const blockedCount = fallbackPictureUploads.filter((it) => it.status === 'failed' || it.status === 'skipped').length;
          const pictureUploadStatus = fallbackPictureUploadError
            ? 'failed'
            : fallbackPendingCount > 0
              ? (blockedCount > 0 ? 'partial_pending' : 'pending')
              : fallbackPictureUploads.length
                ? (blockedCount > 0 ? 'partial_failed' : 'success')
                : 'pending';
          await upsertPublishOzonSyncJob({
            jobId: fallbackJobId,
            shopId: body.shopId,
            status: fallbackError ? 'FAILED' : 'RUNNING',
            finishedAt: fallbackError ? new Date() : null,
            payload: {
              ...fallbackBasePayload,
              taskId: fallbackTaskId,
              pictureUploads: fallbackPictureUploads.length ? fallbackPictureUploads : null,
              pictureUploadFailedCount: fallbackPictureUploads.filter((it) => it.status === 'failed').length,
              pictureUploadSkippedCount: fallbackPictureUploads.filter((it) => it.status === 'skipped').length,
              pictureUploadPendingCount: fallbackPendingCount,
              pictureUploadStatus,
              pictureUploadError: fallbackPictureUploadError,
            },
            errorMessage: fallbackError,
          });
          if (!fallbackError) void enqueueProductSyncAfterPublish(body.shopId, 'collect-publish-fallback');
        } catch (e: any) {
          const detailMsg = getOzonPublishErrorMessage(e);
          fallbackError = detailMsg;
          await Promise.all(noAttrs.map((item) => prisma.supplyGoods.update({
            where: { id: item.id },
            data: { status: previousFallbackStatuses.get(item.id) || 'collected' },
          }).catch(() => null)));
          if (fallbackJobId) {
            await upsertPublishOzonSyncJob({
              jobId: fallbackJobId,
              shopId: body.shopId,
              status: 'FAILED',
              finishedAt: new Date(),
              payload: {
                ...fallbackBasePayload,
                taskId: fallbackTaskId,
                pictureUploads: fallbackPictureUploads.length ? fallbackPictureUploads : null,
                pictureUploadFailedCount: fallbackPictureUploads.filter((it) => it.status === 'failed').length,
                pictureUploadSkippedCount: fallbackPictureUploads.filter((it) => it.status === 'skipped').length,
                pictureUploadStatus: fallbackPictureUploadError ? 'failed' : 'pending',
                pictureUploadError: fallbackPictureUploadError,
              },
              errorMessage: detailMsg,
            }).catch(() => null);
          }
          console.error(`[publish-ozon fallback] import-by-sku failed:`, getOzonPublishErrorLogContext(e));
        }
      }
    }

    // 如果全部商品都没属性，直接返回 fallback 结果
    if (!withAttrs.length) {
      if (fallbackTaskId) {
        const sourceCount = noAttrs.length;
        const expandedNote = fallbackCount > sourceCount ? `（${sourceCount} 件源商品展开为 ${fallbackCount} 个变体 SKU）` : '';
        return reply.send({
          code: fallbackError ? 0 : 1,
          msg: fallbackError
            ? `import-by-sku 上架失败：${fallbackError}`
            : `已通过 import-by-sku 提交 ${fallbackCount} 件商品${expandedNote}（继承源卡片），任务ID: ${fallbackTaskId}`,
          data: { taskId: fallbackTaskId, jobId: fallbackJobId, count: fallbackCount, sourceCount, mode: 'follow-by-sku' },
        });
      }
      return reply.send({ code: 0, msg: '所有商品均缺少属性且无有效 SKU' });
    }

    // ====== 主路径：有属性的商品走 /v3/product/import ======
    items = withAttrs;

    // 跟卖和复制都走 /v3/product/import：创建新卡片但属性/图片继承源商品
    // 区别仅在 offer_id 命名策略，避免不同发布任务之间互相覆盖。
    function getItemDimensions(item: any) {
      const meta = item.metadata as any;
      const baseWeight = meta?.weightG || body.weight || 500;
      const baseHeight = meta?.heightMm || body.height || 100;
      const baseDepth = meta?.lengthMm || body.depth || 100;
      const baseWidth = meta?.widthMm || body.width || 100;
      if (!randomizeCfg.enabled) {
        return { weight: baseWeight, height: baseHeight, depth: baseDepth, width: baseWidth };
      }
      return {
        weight: bucketWeightG(baseWeight, randomizeCfg.weightBuckets) ?? baseWeight,
        height: jitterDimensionMm(baseHeight, randomizeCfg.dimensionJitterMm, randomizeCfg.dimensionMinMm) ?? baseHeight,
        depth: jitterDimensionMm(baseDepth, randomizeCfg.dimensionJitterMm, randomizeCfg.dimensionMinMm) ?? baseDepth,
        width: jitterDimensionMm(baseWidth, randomizeCfg.dimensionJitterMm, randomizeCfg.dimensionMinMm) ?? baseWidth,
      };
    }
    const cloneAttrsByProductId = new Map<number, { description: string; attributes: { id: number; complex_id?: number; values: { value: string; dictionary_value_id?: number }[] }[]; images: string[] }>();
    {
      // 优先从本地 metadata 读取 ozonAttributes（扩展采集时已存储）
      for (const item of items) {
        const pid = item.sku && /^\d+$/.test(item.sku) ? Number(item.sku) : null;
        if (!pid) continue;
        const meta = item.metadata as any;
        if (meta?.ozonAttributes?.length) {
          const attributes = convertOzonRawAttrs(meta.ozonAttributes, followBrand);
          if (attributes.length > 0) {
            cloneAttrsByProductId.set(pid, {
              description: resolvePublishDescription(item),
              attributes,
              images: Array.isArray(item.images) ? (item.images as string[]) : [],
            });
          }
        }
      }

      // 本地没有的，回退 Seller API（仅自家商品能查到）
      const missingIds = items
        .map((it) => it.sku)
        .filter((s): s is string => !!s && /^\d+$/.test(s))
        .map(Number)
        .filter((id) => !cloneAttrsByProductId.has(id));

      if (missingIds.length) {
        try {
          const chunks: number[][] = [];
          for (let i = 0; i < missingIds.length; i += 100) chunks.push(missingIds.slice(i, i + 100));

          const descriptionMap = new Map<number, string>();
          for (const chunk of chunks) {
            const infos = await client.getProductInfoList(chunk);
            for (const info of infos) {
              if (info.description) descriptionMap.set(info.id, info.description);
            }
          }

          for (const chunk of chunks) {
            const attrs = await client.getProductInfoAttributes({
              product_id: chunk.map(String),
              limit: chunk.length,
            });
            for (const a of attrs) {
              const description = descriptionMap.get(a.id) || (a.attributes?.find((x) => x.id === 4191)?.values?.[0]?.value) || '';
              const attributes = (a.attributes || [])
                .filter((x) => !shouldSkipOzonPublishAttr(x))
                .filter((x) => followBrand || x.id !== 85)
                .map((x) => ({
                  id: x.id,
                  values: x.values.map((v: any) => ({
                    value: v.value,
                    // 保留字典 ID，否则 OZON 会报"请检查数值，从列表选择"
                    ...(v.dictionary_value_id != null ? { dictionary_value_id: v.dictionary_value_id } : {}),
                  })),
                }));
              cloneAttrsByProductId.set(a.id, { description, attributes, images: a.images || [] });
            }
          }
        } catch (e: any) {
          console.warn(`[publish-ozon clone] seller API fallback failed: ${e.message?.slice(0, 200)}`);
        }
      }
    }

    let importItems: any[];
    try {
      const nested = await Promise.all(items.map(async (item) => {
      const basePriceCny = parseFloat(body.price || item.purchasePrice?.toString() || '100');
      const priceWithMarkup = calcPublishPrice(basePriceCny, markupPct, markupAmount);
      const sourceProductId = item.sku && /^\d+$/.test(item.sku) ? Number(item.sku) : null;
      const cloned = sourceProductId ? cloneAttrsByProductId.get(sourceProductId) : undefined;
      const { categoryId, typeId } = resolveItemPublishCategory(item, body.categoryId, body.typeId, preferItemCategory);
      const dims = getItemDimensions(item);
      const baseRawImages = resolveBasePublishImages(item, cloned?.images);
      const baseOriginalRawImages = resolveOriginalBasePublishImages(item, cloned?.images);
      const baseImages = await resolvePublishImageUrls(baseRawImages, baseOriginalRawImages, body.shopId, userId);
      const itemDescription = resolvePublishDescription(item, cloned?.description);
      const sourceRichDescriptionJson = getCollectedRichDescriptionJson(item);
      let sourceVideos = getCollectedSourceVideos(item);
      let sourceVideoTransferDiagnostic: any = null;
      const sourcePlatform = item.sourcePlatform || metadataRecord(item.metadata).sourcePlatform;
      if (sourceVideos.length && isDomesticCollectedSource(sourcePlatform)) {
        const videoTransfer = await transferSourceProductVideos({
          sourceVideos,
          sourcePlatform,
          userId,
          shopId: body.shopId,
        });
        sourceVideos = videoTransfer.videos;
        sourceVideoTransferDiagnostic = videoTransfer.diagnostic;
      }
      const sourceStandardAttributes = getCollectedSourceStandardAttributes(item);

      const variants = enrichOzonVariantSpecs(Array.isArray(item.variants) ? (item.variants as any[]) : []);
      // 无 variants：保持原行为（1 个 item）
      if (!variants.length) {
        const itemName = resolvePublishName(item);
        const itemAttrs = cloned?.attributes?.length
          ? sanitizeOzonVariantPublishAttributes(syncOzonCoreTextAttributes(cloned.attributes, itemName, itemDescription))
          : [];
        return [{
          name: itemName,
          offer_id: buildOfferId(item.sku, `import-${item.id}`, getItemCustomOfferId(item)),
          description_category_id: categoryId,
          type_id: typeId,
          price: String(priceWithMarkup),
          old_price: String(Math.ceil(priceWithMarkup * 1.2)),
          vat: '0',
          currency_code: 'CNY',
          dimension_unit: 'mm',
          weight_unit: 'g',
          weight: dims.weight,
          height: dims.height,
          depth: dims.depth,
          width: dims.width,
          images: baseImages,
          ...(itemDescription ? { description: itemDescription } : {}),
          ...(itemAttrs.length ? { attributes: itemAttrs } : {}),
          _sourceItemId: item.id,
          _sourceVariantSku: item.sku || null,
          _sourceModelId: item.modelId || null,
          _sourceRichDescriptionJson: sourceRichDescriptionJson || null,
          _sourceVideos: sourceVideos,
          _sourceVideoTransferDiagnostic: sourceVideoTransferDiagnostic,
          _sourceStandardAttributes: sourceStandardAttributes,
        }];
      }

      // 有 variants：每个 sub-SKU 展开为一条 import item
      // model_id 字段不主动声明，依赖 OZON 后端按源 model 自动归组（待实测验证）
      console.log(`[publish-ozon variants] item=${item.id} model=${item.modelId || 'none'} expand to ${variants.length} sub-SKUs`);
      const itemOverrides = body.priceOverrides?.[item.id] || {};
      const rawVariantAttrsList = variants.map((variant) => (
        variant?.attrs && typeof variant.attrs === 'object'
          ? variant.attrs as Record<string, string>
          : undefined
      ));
      const publishVariantAttrsList = sanitizeVariantAttrSetsForOzonPublish(rawVariantAttrsList);
      const rawVariantOzonAttrSets = variants.map((variant) => (
        Array.isArray(variant?.ozonAttributes) && variant.ozonAttributes.length
          ? convertOzonRawAttrs(variant.ozonAttributes, followBrand)
          : null
      ));
      const publishVariantOzonAttrSets = sanitizeOzonVariantPublishAttributeSets(rawVariantOzonAttrSets);
      const subItems = await Promise.all(variants.map(async (v: any, idx: number) => {
        // 价格优先级：前端单独覆盖（CNY 最终价） > 变体自身价格按汇率转 CNY 后加价 > 整组价格。
        const fxRate = item.originalCurrency && item.originalCurrency !== 'CNY' && item.exchangeRateUsed
          ? Number(item.exchangeRateUsed)
          : null;
        const subPrice = resolveVariantPublishPriceCny({
          itemOverrides,
          variant: v,
          index: idx,
          groupBasePriceCny: basePriceCny,
          markupPct,
          markupAmount,
          fxRate,
        });
        const subSku = v.sku ? String(v.sku) : `${item.sku || item.id}-v${idx}`;
        const subImagesRaw = resolveVariantPublishImages(item, v, baseRawImages);
        const subFallbackRawImages = resolveOriginalVariantPublishImages(item, v, baseOriginalRawImages);
        const subImages = sameStringList(subImagesRaw, baseRawImages)
          ? baseImages
          : await resolvePublishImageUrls(subImagesRaw, subFallbackRawImages, body.shopId, userId);
        const subAttrs = publishVariantAttrsList[idx] || {};
        const subName = resolvePublishName(item, subAttrs);

        // === 优先用每个变体自己的 ozonAttributes（扩展端 Step 2 抓的）===
        // 没有时退化用 cloned（来自源 SKU 的共用属性）
        const variantAttrs = publishVariantOzonAttrSets[idx]?.length
          ? publishVariantOzonAttrSets[idx]
          : null;
        const finalAttrs = variantAttrs && variantAttrs.length
          ? variantAttrs
          : (cloned?.attributes || []);
        const publishAttrs = finalAttrs.length
          ? sanitizeOzonVariantPublishAttributes(syncOzonCoreTextAttributes(finalAttrs, subName, itemDescription), { variantIndex: idx })
          : [];

        // 维度：每个变体自己的 > 整组 dims
        const subWeight = (typeof v.weight === 'number' && v.weight > 0) ? v.weight : dims.weight;
        const subHeight = (typeof v.height === 'number' && v.height > 0) ? v.height : dims.height;
        const subDepth = (typeof v.depth === 'number' && v.depth > 0) ? v.depth : dims.depth;
        const subWidth = (typeof v.width === 'number' && v.width > 0) ? v.width : dims.width;

        return {
          name: subName,
          offer_id: buildOfferId(subSku, `${subSku}-${randomSuffix(4)}`, getVariantCustomOfferId(item, v, idx)),
          description_category_id: categoryId,
          type_id: typeId,
          price: String(subPrice),
          old_price: String(Math.ceil(subPrice * 1.2)),
          vat: '0',
          currency_code: 'CNY',
          dimension_unit: 'mm',
          weight_unit: 'g',
          weight: subWeight,
          height: subHeight,
          depth: subDepth,
          width: subWidth,
          images: subImages,
          ...(itemDescription ? { description: itemDescription } : {}),
          ...(publishAttrs.length ? { attributes: publishAttrs } : {}),
          // 自定义字段：变体属性（颜色/尺码等），等真实数据回流后映射成 OZON 真实 attribute_id
          _variantAttrs: subAttrs,
          _sourceVariantSku: subSku,
          _sourceItemId: item.id,
          _sourceModelId: item.modelId || null,
          _hasOwnAttrs: !!variantAttrs,
          _sourceRichDescriptionJson: sourceRichDescriptionJson || null,
          _sourceVideos: sourceVideos,
          _sourceVideoTransferDiagnostic: sourceVideoTransferDiagnostic,
          _sourceStandardAttributes: sourceStandardAttributes,
          _isVariantItem: true,
        };
      }));
      return subItems;
    }));
    importItems = nested.flat();
    } catch (e: any) {
      return reply.send({ code: 0, msg: `图片处理失败: ${e.message?.slice(0, 400) || '未知错误'}` });
    }

    if (!publishCatalogSnapshot) {
      try {
        publishCatalogSnapshot = await loadAuthoritativeOzonCategoryCatalog({
          shopId: body.shopId,
          fetchTree: async (language) => client.getDescriptionCategoryTree({ language }),
        });
      } catch {
        return reply.status(503).send({
          code: 0,
          errorCode: 'ozon_category_catalog_unavailable',
          msg: '当前 Ozon 官方类目目录不可用，请稍后重试',
        });
      }
    }
    if (!publishCatalogSnapshot.catalogRevision || !Array.isArray(publishCatalogSnapshot.entries)) {
      return reply.status(503).send({
        code: 0,
        errorCode: 'ozon_category_catalog_invalid',
        msg: '当前 Ozon 官方类目目录无效，请稍后重试',
      });
    }
    for (const group of groupPublishItemsByCategory(importItems)) {
      if (!selectableOfficialOzonCategoryTarget(publishCatalogSnapshot, group.categoryId, group.typeId)) {
        return reply.status(422).send({
          code: 0,
          errorCode: 'ozon_category_target_invalid',
          msg: `Ozon 类目/type ${group.categoryId}/${group.typeId} 不在当前可用官方目录中`,
        });
      }
    }

    // 按每个 payload item 自己的类目补属性，避免批量多类目上架时第一类目污染整批。
    const attrDictCache = new Map<string, { id: number; value?: string | null }[]>();
    const persistentAttrDictStore = createPrismaOzonAttributeDictionaryCacheStore(prisma as any);
    const persistentAttrDefinitionStore = createPrismaOzonAttributeDefinitionCacheStore(prisma as any);
    const getAttributeDictValues = async (categoryId: number, typeId: number, attributeId: number, language = 'DEFAULT') => {
      const dictKey = `${categoryId}:${typeId}:${attributeId}:${language}:${publishCatalogSnapshot.catalogRevision}`;
      if (attrDictCache.has(dictKey)) return attrDictCache.get(dictKey)!;
      const result = await getCachedOzonAttributeValues({
        description_category_id: categoryId,
        type_id: typeId,
        attribute_id: attributeId,
        language,
        catalogRevision: publishCatalogSnapshot.catalogRevision,
      }, {
        store: persistentAttrDictStore,
        fetchPage: (params) => client.getAttributeValuesPage({
          description_category_id: params.description_category_id,
          type_id: params.type_id,
          attribute_id: params.attribute_id,
          language: params.language,
          last_value_id: params.last_value_id,
          limit: params.limit,
        }),
      });
      attrDictCache.set(dictKey, result.values);
      if (result.source !== 'ozon_api') {
        console.log(`[publish-ozon dict-cache] ${result.source}: attr#${attributeId} category=${categoryId}/${typeId} values=${result.values.length}${result.warning ? ` warning=${result.warning.slice(0, 150)}` : ''}`);
      }
      return result.values;
    };
    const richContentTrace: any[] = [];
    const richContentTraceSeen = new Set<string>();
    const richContentAttrCache = new Map<string, Promise<{ status: string; attribute: any | null; error?: string }>>();
    const sizeChartTrace: any[] = [];
    const sizeChartTraceSeen = new Set<string>();
    const sizeChartAttrCache = new Map<string, Promise<{ status: string; attribute: any | null; error?: string }>>();
    const videoTrace: any[] = [];
    const videoTraceSeen = new Set<string>();
    const sourceStandardAttributeTrace: any[] = [];
    const sourceStandardAttributeTraceSeen = new Set<string>();
    const MANUFACTURER_NAMES = /производитель|manufacturer/i;
    const BRAND_NAMES = /бренд|brand/i;
    for (const group of groupPublishItemsByCategory(importItems)) {
      try {
        const categoryDefinitionResult = await getCachedOzonAttributeDefinitions({
          shopId: body.shopId,
          descriptionCategoryId: group.categoryId,
          typeId: group.typeId,
          language: 'DEFAULT',
          catalogRevision: publishCatalogSnapshot.catalogRevision,
        }, {
          store: persistentAttrDefinitionStore,
          fetchDefinitions: () => client.getDescriptionCategoryAttributes({
            description_category_id: group.categoryId,
            type_id: group.typeId,
            language: 'DEFAULT',
          }),
        });
        const allAttrs = categoryDefinitionResult.definitions.map(toOzonCategoryAttributeDefinition);
        const requiredAttrs = allAttrs.filter((a) => a.is_required);

        const brandAttrDef = allAttrs.find((a) => BRAND_NAMES.test(a.name)) || allAttrs.find((a) => a.id === 85);
        const mfrAttrDef = requiredAttrs.find((a) => MANUFACTURER_NAMES.test(a.name));
        const originCountryAttrDef = allAttrs.find((a) => a.id === OZON_ORIGIN_COUNTRY_ATTR_ID);
        const markingCodeAttrDef = allAttrs.find((a) => a.id === OZON_MARKING_CODE_REQUIRED_ATTR_ID);
        const richContentAttrDef = resolveOzonRichContentAttributeDef(allAttrs);
        const sizeChartAttrDef = resolveOzonSizeChartAttributeDef(allAttrs);

        console.log(`[publish-ozon] category attrs ${group.categoryId}/${group.typeId}: total=${allAttrs.length}, required=${requiredAttrs.length}, brand=${brandAttrDef?.id || 'NOT_FOUND'}, manufacturer=${mfrAttrDef?.id || 'NOT_FOUND'}, rich=${richContentAttrDef?.id || 'NOT_FOUND'}, sizeChart=${sizeChartAttrDef?.id || 'NOT_FOUND'}`);

        let noBrandDictId: number | null = null;
        if (brandAttrDef) {
          try {
            const brandValues = await getAttributeDictValues(group.categoryId, group.typeId, brandAttrDef.id);
            const noBrand = brandValues.find((v) => /без бренда/i.test(String(v.value || '')));
            if (noBrand) {
              noBrandDictId = noBrand.id;
              console.log(`[publish-ozon] found "Без бренда" dict_id=${noBrandDictId} for attr ${brandAttrDef.id} category=${group.categoryId}/${group.typeId}`);
            } else {
              console.warn(`[publish-ozon] "Без бренда" not found in brand dictionary (${brandValues.length} values) category=${group.categoryId}/${group.typeId}`);
            }
          } catch (e: any) {
            console.warn(`[publish-ozon] failed to query brand dictionary category=${group.categoryId}/${group.typeId}:`, e.message?.slice(0, 150));
          }
        }

        let originCountryValues: { id: number; value: string; info: string; picture: string }[] = [];
        if (originCountryAttrDef) {
          try {
            originCountryValues = await getAttributeDictValues(group.categoryId, group.typeId, OZON_ORIGIN_COUNTRY_ATTR_ID) as any;
          } catch (e: any) {
            console.warn(`[publish-ozon] failed to query origin country dictionary category=${group.categoryId}/${group.typeId}:`, e.message?.slice(0, 150));
          }
        }

        for (const importItem of group.items) {
          if (!importItem.attributes) importItem.attributes = [];
          // 深拷贝 cloned.attributes，避免多个 sub-SKU 共用同一个数组引用导致互相污染
          importItem.attributes = importItem.attributes.map((a: any) => ({
            ...a,
            values: Array.isArray(a.values) ? a.values.map((v: any) => ({ ...v })) : a.values,
          }));
          importItem.attributes = normalizeOzonOriginCountryForChinaSeller(importItem.attributes, originCountryValues);
          if (markingCodeAttrDef || importItem.attributes.some((attr: any) => Number(attr.id) === OZON_MARKING_CODE_REQUIRED_ATTR_ID)) {
            importItem.attributes = normalizeOzonMarkingCodeRequirementForChinaSeller(importItem.attributes, allAttrs);
          }

          importItem.attributes = syncOzonVariantGroupingAttributes(importItem.attributes, importItem);

          const richSource = String(importItem._sourceRichDescriptionJson || '').trim();
          if (richSource) {
            const sourceKey = String(importItem._sourceItemId || importItem.offer_id || 'unknown');
            const traceKey = `${group.categoryId}:${group.typeId}:${sourceKey}`;
            let hasDedicatedSizeChartAttribute = false;
            if (sizeChartAttrDef) {
              if (!sizeChartAttrCache.has(traceKey)) {
                sizeChartAttrCache.set(traceKey, Promise.resolve().then(() => {
                  try {
                    const attribute = buildOzonSizeChartAttribute(richSource, {
                      attributeId: Number(sizeChartAttrDef.id),
                    });
                    return { status: attribute ? 'generated' : 'empty', attribute };
                  } catch (e: any) {
                    return { status: 'failed', attribute: null, error: e?.message ? String(e.message).slice(0, 300) : 'unknown error' };
                  }
                }));
              }
              const sizeChartResult = await sizeChartAttrCache.get(traceKey)!;
              if (!sizeChartTraceSeen.has(traceKey)) {
                sizeChartTraceSeen.add(traceKey);
                sizeChartTrace.push({
                  sourceItemId: importItem._sourceItemId || null,
                  offerId: importItem.offer_id,
                  categoryId: group.categoryId,
                  typeId: group.typeId,
                  status: sizeChartResult.status,
                  attributeId: sizeChartResult.attribute?.id || null,
                  error: sizeChartResult.error || null,
                });
              }
              if (sizeChartResult.attribute) {
                hasDedicatedSizeChartAttribute = true;
                importItem.attributes = appendOzonSizeChartAttribute(importItem.attributes, sizeChartResult.attribute);
              }
            }
            if (!richContentAttrDef) {
              if (!richContentTraceSeen.has(traceKey)) {
                richContentTraceSeen.add(traceKey);
                richContentTrace.push({
                  sourceItemId: importItem._sourceItemId || null,
                  offerId: importItem.offer_id,
                  categoryId: group.categoryId,
                  typeId: group.typeId,
                  status: 'skipped',
                  reason: 'category_missing_rich_content_attr',
                });
              }
            } else {
              if (!richContentAttrCache.has(traceKey)) {
                richContentAttrCache.set(traceKey, (async () => {
                  try {
                    const attribute = await buildOzonRichContentAttribute(richSource, {
                      attributeId: Number(richContentAttrDef.id),
                      imageMapper: (url) => transferRichContentImage(url, body.shopId, userId),
                      sizeChartImageMapper: (chart) => uploadGeneratedSizeChartImage(chart, body.shopId, userId),
                      includeNativeSizeChart: !hasDedicatedSizeChartAttribute,
                    });
                    return { status: attribute ? 'generated' : 'empty', attribute };
                  } catch (e: any) {
                    return { status: 'failed', attribute: null, error: e?.message ? String(e.message).slice(0, 300) : 'unknown error' };
                  }
                })());
              }
              const result = await richContentAttrCache.get(traceKey)!;
              if (!richContentTraceSeen.has(traceKey)) {
                richContentTraceSeen.add(traceKey);
                richContentTrace.push({
                  sourceItemId: importItem._sourceItemId || null,
                  offerId: importItem.offer_id,
                  categoryId: group.categoryId,
                  typeId: group.typeId,
                  status: result.status,
                  attributeId: result.attribute?.id || null,
                  error: result.error || null,
                });
              }
              if (result.attribute) {
                importItem.attributes = appendOzonRichContentAttribute(importItem.attributes, result.attribute);
              }
            }
          }

          const videoTransferDiagnostic = metadataRecord(importItem._sourceVideoTransferDiagnostic);
          const videoTransferErrors = Array.isArray(videoTransferDiagnostic.errors) ? videoTransferDiagnostic.errors : [];
          const videoTransferAttempted = Number(videoTransferDiagnostic.attempted || 0);
          const videoTransferTransferred = Number(videoTransferDiagnostic.transferred || 0);
          const videoAttrsResult = appendCollectedOzonVideoMediaAttributes(importItem.attributes, importItem._sourceVideos);
          if (videoAttrsResult.generatedCount > 0) {
            importItem.attributes = videoAttrsResult.attributes;
            if (!videoTraceSeen.has(importItem.offer_id)) {
              videoTraceSeen.add(importItem.offer_id);
              videoTrace.push({
                offerId: importItem.offer_id,
                status: 'pending',
                reason: 'ozon_video_media_attributes_generated',
                message: 'Generated Ozon video media attributes from collected Ozon CDN sourceVideos; Ozon will process them with the product import task.',
                sourceVideos: Array.isArray(importItem._sourceVideos) ? importItem._sourceVideos : [],
              });
            }
          } else if (videoTransferAttempted > 0 && videoTransferTransferred === 0 && videoTransferErrors.length > 0) {
            const message = String(videoTransferErrors[0]?.error || 'Ozon CDN video upload failed');
            const traceKey = sourceVideoTransferFailureTraceKey(importItem, message);
            if (!videoTraceSeen.has(traceKey)) {
              videoTraceSeen.add(traceKey);
              videoTrace.push({
                offerId: importItem.offer_id,
                status: 'failed',
                reason: 'ozon_cdn_upload_failed',
                message: sourceVideoTransferFailureMessage(message),
                sourceVideos: Array.isArray(importItem._sourceVideos) ? importItem._sourceVideos : [],
              });
            }
          } else {
            const videoPlan = hasOzonVideoMediaAttributes(importItem.attributes)
              ? null
              : planCollectedVideoPublish(importItem._sourceVideos, importItem.offer_id);
            if (videoPlan && !videoTraceSeen.has(videoPlan.offerId)) {
              videoTraceSeen.add(videoPlan.offerId);
              videoTrace.push(videoPlan);
            }
          }

          const existingIds = new Set(importItem.attributes.map((a: any) => a.id));

          if (brandAttrDef && !existingIds.has(brandAttrDef.id) && noBrandDictId) {
            importItem.attributes.push({ id: brandAttrDef.id, complex_id: 0, values: [{ value: 'Без бренда', dictionary_value_id: noBrandDictId }] });
            console.log(`[publish-ozon] injected "Без бренда" (dict_id=${noBrandDictId}) for attr ${brandAttrDef.id} category=${group.categoryId}/${group.typeId}`);
          }

          if (mfrAttrDef && !existingIds.has(mfrAttrDef.id)) {
            const placeholder = `manufacturer-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`;
            importItem.attributes.push({ id: mfrAttrDef.id, complex_id: 0, values: [{ value: placeholder, dictionary_value_id: 0 }] });
            console.log(`[publish-ozon] injected manufacturer placeholder for attr ${mfrAttrDef.id} (${mfrAttrDef.name}) category=${group.categoryId}/${group.typeId}`);
          }

          if (importItem._sourceStandardAttributes) {
            const traceKey = String(group.categoryId) + ':' + String(group.typeId) + ':' + String(importItem.offer_id || '');
            const plan = buildSourceStandardOzonAttributePlan(importItem._sourceStandardAttributes, allAttrs, importItem.attributes);
            if (!sourceStandardAttributeTraceSeen.has(traceKey)) {
              sourceStandardAttributeTraceSeen.add(traceKey);
              if (plan.candidates.length || plan.missingRequired.length) {
                sourceStandardAttributeTrace.push({
                  offerId: importItem.offer_id,
                  sourceItemId: importItem._sourceItemId || null,
                  sourceVariantSku: importItem._sourceVariantSku || null,
                  categoryId: group.categoryId,
                  typeId: group.typeId,
                  status: 'source_standard_ozon_attribute_plan',
                  candidates: plan.candidates,
                  missingRequired: plan.missingRequired,
                });
              }
            }
            const standardAttrs = await buildSourceStandardOzonPublishAttributes({
              standard: importItem._sourceStandardAttributes,
              categoryAttrs: allAttrs,
              existingAttributes: importItem.attributes,
              getAttributeDictValues: (attributeId) => getAttributeDictValues(group.categoryId, group.typeId, attributeId),
            });
            if (standardAttrs.attributes.length) {
              importItem.attributes.push(...standardAttrs.attributes);
              console.log(`[publish-ozon source-standard] offer=${importItem.offer_id} injected attrs=${standardAttrs.applied.map((entry) => `${entry.attributeId}:${entry.standardKey}:${entry.matchType}`).join(',')} category=${group.categoryId}/${group.typeId}`);
            }
          }

          const variantAttrs: Record<string, string> = importItem._variantAttrs || {};
          if (importItem._hasOwnAttrs && Object.keys(variantAttrs).length) {
            console.log(`[publish-ozon variant] offer=${importItem.offer_id} has own ozonAttributes; override variable aspects from collected webAspects`);
          }
          for (const [aspectName, aspectValue] of Object.entries(variantAttrs)) {
            if (!aspectValue) continue;
            const aspectLower = aspectName.toLowerCase();
            const attrDef = allAttrs.find((a) => a.name && a.name.toLowerCase() === aspectLower)
              || allAttrs.find((a) => a.name && a.name.toLowerCase().includes(aspectLower))
              || allAttrs.find((a) => a.name && aspectLower.includes(a.name.toLowerCase()));
            if (!attrDef) {
              console.warn(`[publish-ozon variant] aspect "${aspectName}" not found in category attrs ${group.categoryId}/${group.typeId} (offer ${importItem.offer_id})`);
              continue;
            }
            if (importItem._hasOwnAttrs && !shouldApplyCollectedVariantAttrOverride(importItem.attributes, attrDef.id)) {
              console.log(`[publish-ozon variant] keep official attr#${attrDef.id}(${attrDef.name}) for offer=${importItem.offer_id}; skip collected web aspect "${aspectName}"`);
              continue;
            }

            const strictColorDictionaryAttr = Boolean(attrDef.dictionary_id && attrDef.dictionary_id > 0 && isStrictColorVariantName(aspectName));
            let resolvedValues: { value: string; dictionary_value_id: number }[] = strictColorDictionaryAttr
              ? []
              : [{
                value: String(aspectValue),
                dictionary_value_id: 0,
              }];
            let matchLabel = 'text';
            if (attrDef.dictionary_id && attrDef.dictionary_id > 0) {
              try {
                const dict = await getAttributeDictValues(group.categoryId, group.typeId, attrDef.id);
                const resolved = resolveOzonDictionaryAttributeValues(aspectValue, dict, {
                  allowTextFallback: !strictColorDictionaryAttr,
                  allowPartialDictionaryValues: strictColorDictionaryAttr,
                });
                if (resolved.values.length) resolvedValues = resolved.values;
                matchLabel = resolved.matchType;
                if (resolved.matched) {
                  console.log(`[publish-ozon variant] dict ${resolved.matchType}: attr#${attrDef.id} "${aspectValue}" -> ${resolvedValues.map((value) => `${value.dictionary_value_id}:${value.value}`).join(', ')} category=${group.categoryId}/${group.typeId}`);
                } else if (strictColorDictionaryAttr) {
                  console.warn(`[publish-ozon variant] strict color dict miss: attr#${attrDef.id}(${attrDef.name}) value="${aspectValue}" not matched in ${dict.length} entries; omit invalid text fallback`);
                } else {
                  console.warn(`[publish-ozon variant] dict miss: attr#${attrDef.id}(${attrDef.name}) value="${aspectValue}" not fully matched in ${dict.length} entries; send collected text instead of cloned value`);
                }
              } catch (e: any) {
                console.warn(`[publish-ozon variant] failed to query dict for attr#${attrDef.id} category=${group.categoryId}/${group.typeId}:`, e.message?.slice(0, 150));
              }
            }

            importItem.attributes = importItem.attributes.filter((a: any) => a.id !== attrDef.id);
            if (!resolvedValues.length) {
              console.warn(`[publish-ozon variant] offer=${importItem.offer_id} attr#${attrDef.id}(${attrDef.name})="${aspectValue}" skipped because no valid dictionary value was resolved`);
              continue;
            }
            importItem.attributes.push({
              id: attrDef.id,
              complex_id: 0,
              values: resolvedValues,
            });
            console.log(`[publish-ozon variant] offer=${importItem.offer_id} attr#${attrDef.id}(${attrDef.name})="${aspectValue}" dict=${attrDef.dictionary_id} match=${matchLabel} values=${resolvedValues.length} category=${group.categoryId}/${group.typeId}`);
          }
        }
      } catch (e: any) {
        if (e instanceof OzonAttributeDefinitionsRequiredError) {
          return reply.status(e.statusCode).send({
            code: 0,
            errorCode: e.code,
            msg: e.message,
          });
        }
        return reply.status(503).send({
          code: 0,
          errorCode: 'ozon_attribute_definitions_unavailable',
          msg: `无法取得 Ozon 类目属性定义 ${group.categoryId}/${group.typeId}，请稍后重试`,
        });
      }
    }

    const firstItem = importItems[0];
    console.log('=== [publish-ozon] DIAGNOSTIC ===');
    console.log('description_category_id:', firstItem?.description_category_id);
    console.log('type_id:', firstItem?.type_id);
    console.log('dimensions:', { weight: firstItem?.weight, height: firstItem?.height, depth: firstItem?.depth, width: firstItem?.width });
    console.log('attributes count:', firstItem?.attributes?.length || 0);
    const brandAttr = firstItem?.attributes?.find((a: any) => a.id === 85);
    console.log('brand(85):', brandAttr ? JSON.stringify(brandAttr) : 'MISSING (followBrand=' + followBrand + ')');
    if (firstItem?.attributes?.length) {
      console.log('first 3 attributes:', JSON.stringify(firstItem.attributes.slice(0, 3), null, 2));
    } else {
      console.log('WARNING: NO ATTRIBUTES! metadata was:', JSON.stringify(items[0]?.metadata));
    }
    console.log('=================================');

    try {
      await assertObservedLegacyPublish();
    } catch (caught) {
      return sendSourceWorkflowLegacyPublishError(reply, caught);
    }

    try {
      // 把诊断字段（_variantAttrs/_sourceItemId/_sourceModelId）抽出来留给 SyncJob，发给 OZON 的 payload 必须干净
      const variantTrace = importItems
        .filter((i) => i._isVariantItem || i._variantAttrs)
        .map((i) => ({
          offerId: i.offer_id,
          sourceItemId: i._sourceItemId || null,
          sourceVariantSku: i._sourceVariantSku || null,
          sourceModelId: i._sourceModelId || null,
          variantAttrs: i._variantAttrs || null,
        }));
      const mainPublisherParityItemTrace = importItems.flatMap((item, ordinal) => {
        const supplyGoodsId = String(item._sourceItemId || '').trim();
        if (!supplyGoodsId) return [];
        const sourceSkuAlias = String(item._sourceVariantSku || '').trim();
        return [{
          ordinal,
          supplyGoodsId,
          ...(sourceSkuAlias ? { sourceSkuAlias } : {}),
        }];
      });
      const cleanItems = importItems.map((i) => {
        const {
          _variantAttrs,
          _sourceVariantSku,
          _sourceItemId,
          _sourceModelId,
          _hasOwnAttrs,
          _sourceRichDescriptionJson,
          _sourceVideos,
          _sourceVideoTransferDiagnostic,
          _sourceStandardAttributes,
          _isVariantItem,
          ...rest
        } = i;
        return rest;
      });

      mainPublisherParityReport = await observePublisherParity({
        endpoint: '/v3/product/import',
        items: cleanItems,
        supplyGoodsIds: items.map((item) => item.id),
        itemTrace: mainPublisherParityItemTrace,
      });
      try {
        await assertObservedLegacyPublish();
      } catch (caught) {
        if (body.jobId && caught instanceof SourceWorkflowLegacyPublishError) {
          await upsertPublishOzonSyncJob({
            jobId: body.jobId,
            shopId: body.shopId,
            status: 'FAILED',
            finishedAt: new Date(),
            payload: {
              ...metadataRecord(existingPublishJob?.payload),
              source: 'browser-one-click-listing',
              stage: 'rollout_blocked',
              sourceListingWorkflow: sourceListingCompatibilityMetadata(sourceListingCompatibility),
              ...(mainPublisherParityReport
                ? { publisherEntrypointParity: mainPublisherParityReport }
                : {}),
              ...(fallbackPublisherParityForSharedJob
                ? { fallbackPublisherEntrypointParity: fallbackPublisherParityForSharedJob }
                : {}),
              ...(fallbackTaskId !== null
                ? {
                    fallbackPublish: {
                      taskId: fallbackTaskId,
                      itemCount: fallbackCount,
                      error: fallbackError,
                    },
                  }
                : {}),
              entry: body.source || 'collect-page',
              mode,
              sourceSkus: items.map((item) => item.sku).filter(Boolean),
            },
            errorMessage: caught.message,
          }).catch(() => null);
        }
        return sendSourceWorkflowLegacyPublishError(reply, caught);
      }
      const result = await client.importProducts(cleanItems);
      const taskId = result.result.task_id;

      let finalVideoTrace = videoTrace;
      let videoPublishStatus: 'not_applicable' | 'success' | 'partial_failed' | 'failed' | 'pending' | 'partial_pending' | 'manual_required' | 'partial_manual_required' = videoTrace.length ? 'manual_required' : 'not_applicable';
      if (videoTrace.length) {
        finalVideoTrace = [];
        for (const plan of videoTrace) {
          if (plan.status === 'pending') {
            recordVideoPublishDiagnostic(finalVideoTrace, {
              offerId: plan.offerId,
              status: 'pending',
              sourceVideos: plan.sourceVideos,
              reason: plan.reason,
              message: plan.message,
            });
          } else if (plan.status === 'failed') {
            recordVideoPublishDiagnostic(finalVideoTrace, {
              offerId: plan.offerId,
              status: 'failed',
              sourceVideos: plan.sourceVideos,
              reason: plan.reason,
              message: plan.message,
            });
          } else {
            recordVideoPublishDiagnostic(finalVideoTrace, {
              offerId: plan.offerId,
              status: 'skipped',
              sourceVideos: plan.sourceVideos,
              reason: plan.reason,
              message: plan.message,
            });
          }
        }
        if (finalVideoTrace.some((entry) => entry.status === 'skipped')) {
          console.warn('[publish-ozon video] skipped collected videos: Ozon documents only describe Seller media tab, XLS template, or Ozon Seller app upload; no documented Seller API endpoint is configured');
        }
        const videoFailedCount = finalVideoTrace.filter((entry) => entry.status === 'failed').length;
        const videoSkippedCount = finalVideoTrace.filter((entry) => entry.status === 'skipped').length;
        const videoPendingCount = finalVideoTrace.filter((entry) => entry.status === 'pending').length;
        const videoUploadedCount = finalVideoTrace.filter((entry) => entry.status === 'uploaded').length;
        const videoBlockedCount = videoFailedCount + videoSkippedCount;
        videoPublishStatus = videoPendingCount > 0
          ? (videoUploadedCount > 0 || videoBlockedCount > 0 ? 'partial_pending' : 'pending')
          : videoFailedCount > 0
            ? (videoUploadedCount > 0 || videoSkippedCount > 0 ? 'partial_failed' : 'failed')
            : videoSkippedCount > 0
              ? (videoUploadedCount > 0 ? 'partial_manual_required' : 'manual_required')
              : 'success';
      }

      const mainOfferImages: Record<string, string> = {};
      const mainOfferImageLists: Record<string, string[]> = {};
      for (const it of cleanItems) {
        recordOfferPublishImages(mainOfferImageLists, mainOfferImages, it.offer_id, it.images);
      }

      const mainJobPayload = {
        taskId,
        itemCount: cleanItems.length,
        sourceItemCount: items.length,
        source: isBrowserOneClickPublishJob ? 'browser-one-click-listing' : 'collect-publish',
        ...(isBrowserOneClickPublishJob ? {
          browserOneClickJob: true,
          publishSource: 'collect-publish',
          stage: 'publishing',
          submittedAt: existingPublishPayload.submittedAt || null,
          publish: existingPublishPayload.publish || null,
        } : {}),
        entry: body.source || 'collect-page',
        sourceListingWorkflow: sourceListingCompatibilityMetadata(sourceListingCompatibility),
        ...(mainPublisherParityReport
          ? { publisherEntrypointParity: mainPublisherParityReport }
          : {}),
        ...(body.jobId && fallbackPublisherParityForSharedJob
          ? { fallbackPublisherEntrypointParity: fallbackPublisherParityForSharedJob }
          : {}),
        ...(body.jobId && fallbackTaskId !== null
          ? {
              fallbackPublish: {
                taskId: fallbackTaskId,
                itemCount: fallbackCount,
                error: fallbackError,
              },
            }
          : {}),
        mode,
        followBrand,
        warehouseId: body.warehouseId ?? null,
        offerIds: cleanItems.map((i) => i.offer_id),
        sourceSkus: items.map((i) => i.sku).filter(Boolean),
        offerImages: Object.keys(mainOfferImages).length ? mainOfferImages : null,
        offerImageLists: Object.keys(mainOfferImageLists).length ? mainOfferImageLists : null,
        variantTrace: variantTrace.length ? variantTrace : null,
        richContentTrace: richContentTrace.length ? richContentTrace : null,
        sizeChartTrace: sizeChartTrace.length ? sizeChartTrace : null,
        videoTrace: finalVideoTrace.length ? finalVideoTrace : null,
        sourceStandardAttributeTrace: sourceStandardAttributeTrace.length ? sourceStandardAttributeTrace : null,
        videoPublishStatus,
        videoPublishedCount: finalVideoTrace.filter((entry) => entry.status === 'uploaded').length,
        videoPublishFailedCount: finalVideoTrace.filter((entry) => entry.status === 'failed').length,
        videoPublishSkippedCount: finalVideoTrace.filter((entry) => entry.status === 'skipped').length,
        videoPublishPendingCount: finalVideoTrace.filter((entry) => entry.status === 'pending').length,
      };
      const mainJob = await upsertPublishOzonSyncJob({
        jobId: body.jobId,
        shopId: body.shopId,
        status: 'RUNNING',
        payload: mainJobPayload,
      });
      void enqueueProductSyncAfterPublish(body.shopId, 'collect-publish');

      for (const item of items) {
        await prisma.supplyGoods.update({ where: { id: item.id }, data: { status: 'listed' } });
      }
      scheduleEphemeralListingCleanup(items, userId, 5 * 60 * 1000);

      const variantNote = variantTrace.length ? `（含 ${variantTrace.length} 个子 SKU 展开）` : '';
      return reply.send({
        code: 1,
        msg: `已提交 ${cleanItems.length} 件商品${variantNote}（${mode === 'clone' ? '复制' : '跟卖'}）到 OZON，任务ID: ${taskId}`,
        data: { taskId, jobId: mainJob.id, count: cleanItems.length, sourceCount: items.length, mode, followBrand, variantCount: variantTrace.length },
      });
    } catch (e: any) {
      const detailMsg = getOzonPublishErrorMessage(e);
      console.error(`[publish-ozon] /v3/product/import failed:`, getOzonPublishErrorLogContext(e));
      if (body.jobId) {
        await upsertPublishOzonSyncJob({
          jobId: body.jobId,
          shopId: body.shopId,
          status: 'FAILED',
          finishedAt: new Date(),
          payload: {
            ...metadataRecord(existingPublishJob?.payload),
            source: 'browser-one-click-listing',
            stage: 'publish_failed',
            sourceListingWorkflow: sourceListingCompatibilityMetadata(sourceListingCompatibility),
            ...(mainPublisherParityReport
              ? { publisherEntrypointParity: mainPublisherParityReport }
              : {}),
            ...(fallbackPublisherParityForSharedJob
              ? { fallbackPublisherEntrypointParity: fallbackPublisherParityForSharedJob }
              : {}),
            ...(fallbackTaskId !== null
              ? {
                  fallbackPublish: {
                    taskId: fallbackTaskId,
                    itemCount: fallbackCount,
                    error: fallbackError,
                  },
                }
              : {}),
            entry: body.source || 'collect-page',
            mode,
            sourceSkus: items.map((i) => i.sku).filter(Boolean),
          },
          errorMessage: detailMsg,
        }).catch(() => null);
      }
      return reply.send({ code: 0, msg: `上架失败: ${detailMsg}` });
    }
  });

  // 诊断端点：查看商品 metadata
  app.get('/debug-metadata/:id', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };
    const item = await prisma.supplyGoods.findFirst({
      where: { id, user: { id: userId } },
      select: { id: true, title: true, sku: true, metadata: true },
    });
    if (!item) return reply.status(404).send({ code: 0, msg: 'not found' });
    return reply.send({ code: 1, data: item });
  });

  // OZON 商品采集 - 通过链接/SKU/product_id/offer_id 获取商品数据
  app.post('/ozon-fetch', async (request, reply) => {
    const { userId } = (request as any).user;
    const body = request.body as {
      shopId: string;
      input: string;
      saveToCollect?: boolean;
    };

    if (!body?.shopId || !body?.input?.trim()) {
      return reply.status(400).send({ code: 0, msg: '请提供店铺ID和商品链接/SKU' });
    }

    const shop = await prisma.shop.findFirst({ where: { id: body.shopId, userId } });
    if (!shop || !shop.clientId || !shop.apiKeyEncrypted) {
      return reply.status(400).send({ code: 0, msg: '店铺配置不完整，请先配置API凭证' });
    }

    const { OzonClient } = await import('../services/ozon-client.js');
    const { decrypt } = await import('../lib/crypto.js');
    const client = new OzonClient({ clientId: shop.clientId, apiKey: decrypt(shop.apiKeyEncrypted) });

    // 解析输入：支持多行，每行一个链接/SKU/product_id/offer_id
    const inputs = body.input.trim().split('\n').map((s) => s.trim()).filter(Boolean);
    const productIds: number[] = [];
    const offerIds: string[] = [];

    for (const raw of inputs) {
      const parsed = parseOzonInput(raw);
      if (parsed.type === 'product_id') {
        productIds.push(parsed.value as number);
      } else if (parsed.type === 'offer_id') {
        offerIds.push(parsed.value as string);
      }
    }

    if (!productIds.length && !offerIds.length) {
      return reply.status(400).send({ code: 0, msg: '无法解析有效的商品ID，请检查输入格式' });
    }

    try {
      let products: any[] = [];

      if (productIds.length) {
        const items = await client.getProductInfoList(productIds);
        products.push(...items);
      }
      if (offerIds.length) {
        const items = await client.getProductInfoByOfferId(offerIds);
        products.push(...items);
      }

      if (!products.length) {
        return reply.send({ code: 0, msg: '未找到商品数据，请确认ID是否正确' });
      }

      // 保存到采集列表
      let savedCount = 0;
      if (body.saveToCollect !== false) {
        for (const p of products) {
          const existing = await prisma.supplyGoods.findFirst({
            where: { userId, sku: String(p.id) },
          });
          if (existing) {
            // 更新已有记录
            await prisma.supplyGoods.update({
              where: { id: existing.id },
              data: {
                title: p.name,
                sourceProductId: String(p.id),
                images: p.images?.length ? p.images : (p.primary_image ? [p.primary_image] : undefined),
                purchasePrice: p.price ? parseFloat(p.price) : undefined,
                currency: p.currency_code || 'CNY',
                sourceUrl: `https://www.ozon.ru/product/${p.id}`,
              },
            });
          } else {
            await prisma.supplyGoods.create({
              data: {
                user: { connect: { id: userId } },
                title: p.name,
                sourceProductId: String(p.id),
                sku: String(p.id),
                sourceUrl: `https://www.ozon.ru/product/${p.id}`,
                sourcePlatform: 'ozon',
                images: p.images?.length ? p.images : (p.primary_image ? [p.primary_image] : []),
                purchasePrice: p.price ? parseFloat(p.price) : null,
                currency: p.currency_code || 'CNY',
                notes: `offer_id: ${p.offer_id}\nsku: ${p.sku}`,
                status: 'collected',
              },
            });
          }
          savedCount++;
        }
      }

      return reply.send({
        code: 1,
        msg: `成功采集 ${products.length} 件商品`,
        data: {
          products: products.map((p) => ({
            id: p.id,
            name: p.name,
            offer_id: p.offer_id,
            images: p.images || (p.primary_image ? [p.primary_image] : []),
            price: p.price,
            old_price: p.old_price,
            currency_code: p.currency_code,
            sku: p.sku,
            is_archived: p.is_archived,
            statuses: p.statuses,
          })),
          saved: savedCount,
        },
      });
    } catch (e: any) {
      return reply.send({ code: 0, msg: `采集失败: ${e.message?.slice(0, 300) || '未知错误'}` });
    }
  });

  // OZON 批量采集 - 通过 product_id 数组或 offer_id 数组
  app.post('/ozon-batch-fetch', async (request, reply) => {
    const { userId } = (request as any).user;
    const body = request.body as {
      shopId: string;
      productIds?: number[];
      offerIds?: string[];
      saveToCollect?: boolean;
    };

    if (!body?.shopId) {
      return reply.status(400).send({ code: 0, msg: '请提供店铺ID' });
    }
    if (!body.productIds?.length && !body.offerIds?.length) {
      return reply.status(400).send({ code: 0, msg: '请提供 productIds 或 offerIds' });
    }

    const shop = await prisma.shop.findFirst({ where: { id: body.shopId, userId } });
    if (!shop || !shop.clientId || !shop.apiKeyEncrypted) {
      return reply.status(400).send({ code: 0, msg: '店铺配置不完整' });
    }

    const { OzonClient } = await import('../services/ozon-client.js');
    const { decrypt } = await import('../lib/crypto.js');
    const client = new OzonClient({ clientId: shop.clientId, apiKey: decrypt(shop.apiKeyEncrypted) });

    try {
      let products: any[] = [];

      // OZON API 限制每次最多 1000 个
      if (body.productIds?.length) {
        const chunks = chunkArray(body.productIds, 100);
        for (const chunk of chunks) {
          const items = await client.getProductInfoList(chunk);
          products.push(...items);
        }
      }
      if (body.offerIds?.length) {
        const chunks = chunkArray(body.offerIds, 100);
        for (const chunk of chunks) {
          const items = await client.getProductInfoByOfferId(chunk);
          products.push(...items);
        }
      }

      let savedCount = 0;
      if (body.saveToCollect !== false) {
        for (const p of products) {
          const existing = await prisma.supplyGoods.findFirst({
            where: { userId, sku: String(p.id) },
          });
          if (existing) {
            await prisma.supplyGoods.update({
              where: { id: existing.id },
              data: {
                sourceProductId: String(p.id),
                title: p.name,
                images: p.images?.length ? p.images : (p.primary_image ? [p.primary_image] : undefined),
                purchasePrice: p.price ? parseFloat(p.price) : undefined,
                currency: p.currency_code || 'CNY',
                sourceUrl: `https://www.ozon.ru/product/${p.id}`,
              },
            });
          } else {
            await prisma.supplyGoods.create({
              data: {
                user: { connect: { id: userId } },
                title: p.name,
                sourceProductId: String(p.id),
                sku: String(p.id),
                sourceUrl: `https://www.ozon.ru/product/${p.id}`,
                sourcePlatform: 'ozon',
                images: p.images?.length ? p.images : (p.primary_image ? [p.primary_image] : []),
                purchasePrice: p.price ? parseFloat(p.price) : null,
                currency: p.currency_code || 'CNY',
                notes: `offer_id: ${p.offer_id}\nsku: ${p.sku}`,
                status: 'collected',
              },
            });
          }
          savedCount++;
        }
      }

      return reply.send({
        code: 1,
        msg: `成功采集 ${products.length} 件商品`,
        data: {
          products: products.map((p) => ({
            id: p.id,
            name: p.name,
            offer_id: p.offer_id,
            images: p.images || (p.primary_image ? [p.primary_image] : []),
            price: p.price,
            old_price: p.old_price,
            currency_code: p.currency_code,
            sku: p.sku,
            is_archived: p.is_archived,
            statuses: p.statuses,
          })),
          saved: savedCount,
        },
      });
    } catch (e: any) {
      return reply.send({ code: 0, msg: `批量采集失败: ${e.message?.slice(0, 300) || '未知错误'}` });
    }
  });

  app.post('/enrich', async (request, reply) => {
    const { userId } = (request as any).user;
    const body = request.body as { ids: string[]; shopId: string };

    if (!body?.ids?.length || !body?.shopId) {
      return reply.status(400).send({ code: 0, msg: '请选择商品和店铺' });
    }

    const shop = await prisma.shop.findFirst({ where: { id: body.shopId, userId } });
    if (!shop || !shop.clientId || !shop.apiKeyEncrypted) {
      return reply.status(400).send({ code: 0, msg: '店铺配置不完整' });
    }

    const items = await prisma.supplyGoods.findMany({
      where: { id: { in: body.ids }, userId },
    });
    if (!items.length) return reply.send({ code: 0, msg: '未找到商品' });

    const numericIds = items
      .map((it) => it.sku)
      .filter((s): s is string => !!s && /^\d+$/.test(s))
      .map(Number);

    const offerIds = items
      .map((it) => it.sku)
      .filter((s): s is string => !!s && !/^\d+$/.test(s));

    if (!numericIds.length && !offerIds.length) {
      return reply.send({ code: 0, msg: '所选商品无有效 SKU' });
    }

    const { OzonClient } = await import('../services/ozon-client.js');
    const { decrypt } = await import('../lib/crypto.js');
    const client = new OzonClient({ clientId: shop.clientId, apiKey: decrypt(shop.apiKeyEncrypted) });

    try {
      const chunks = chunkArray(numericIds, 100);
      let products: any[] = [];
      for (const chunk of chunks) {
        const fetched = await client.getProductInfoList(chunk);
        products.push(...fetched);
      }
      if (offerIds.length) {
        const offerChunks = chunkArray(offerIds, 100);
        for (const chunk of offerChunks) {
          const fetched = await client.getProductInfoByOfferId(chunk);
          products.push(...fetched);
        }
      }

      const productMapById = new Map<string, any>();
      const productMapByOffer = new Map<string, any>();
      for (const p of products) {
        productMapById.set(String(p.id), p);
        if (p.offer_id) productMapByOffer.set(p.offer_id, p);
      }

      let enriched = 0;
      for (const item of items) {
        const p = productMapById.get(item.sku || '') || productMapByOffer.get(item.sku || '');
        if (!p) continue;
        const images = p.images?.length ? p.images : (p.primary_image ? [p.primary_image] : undefined);
        await prisma.supplyGoods.update({
          where: { id: item.id },
          data: {
            title: p.name || item.title,
            images: images || undefined,
            purchasePrice: p.price ? parseFloat(p.price) : undefined,
            currency: p.currency_code || undefined,
            sourceUrl: `https://www.ozon.ru/product/${p.id}`,
            notes: `offer_id: ${p.offer_id}\nsku: ${p.sku}\ncategory_id: ${p.description_category_id}\ntype_id: ${p.type_id}`,
          },
        });
        enriched++;
      }

      return reply.send({ code: 1, msg: `已补全 ${enriched} 件商品信息`, data: { enriched } });
    } catch (e: any) {
      return reply.send({ code: 0, msg: `补全失败: ${e.message?.slice(0, 200) || '未知'}` });
    }
  });

  app.post('/resolve-attributes', async (request, reply) => {
    const { userId } = (request as any).user;
    const body = request.body as { ids: string[]; shopId: string };

    if (!body?.ids?.length || !body?.shopId) {
      return reply.status(400).send({ code: 0, msg: '请提供商品ID和店铺' });
    }

    const shop = await prisma.shop.findFirst({ where: { id: body.shopId, userId } });
    if (!shop || !shop.clientId || !shop.apiKeyEncrypted) {
      return reply.status(400).send({ code: 0, msg: '店铺配置不完整' });
    }

    const items = await prisma.supplyGoods.findMany({
      where: { id: { in: body.ids }, userId },
    });
    if (!items.length) return reply.send({ code: 0, msg: '未找到商品' });

    const productIds = items
      .map((it) => it.sku)
      .filter((s): s is string => !!s && /^\d+$/.test(s));

    if (!productIds.length) {
      return reply.send({
        code: 1,
        msg: 'no source product',
        data: { attributes: null, items: [] },
      });
    }

    const { OzonClient } = await import('../services/ozon-client.js');
    const { decrypt } = await import('../lib/crypto.js');
    const client = new OzonClient({ clientId: shop.clientId, apiKey: decrypt(shop.apiKeyEncrypted) });

    try {
      const attrs = await client.getProductInfoAttributes({
        product_id: productIds,
        limit: Math.min(productIds.length, 100),
      });

      if (!attrs.length) {
        return reply.send({ code: 1, msg: 'no attributes', data: { attributes: null, items: [] } });
      }

      const sample = attrs[0]!;
      const dimensionUnit = sample.dimension_unit || 'mm';
      const weightUnit = sample.weight_unit || 'g';
      const toMm = (v: number) => {
        if (dimensionUnit === 'cm') return Math.round(v * 10);
        if (dimensionUnit === 'm') return Math.round(v * 1000);
        return Math.round(v);
      };
      const toG = (v: number) => {
        if (weightUnit === 'kg') return Math.round(v * 1000);
        return Math.round(v);
      };

      return reply.send({
        code: 1,
        msg: 'ok',
        data: {
          attributes: {
            categoryId: sample.description_category_id,
            typeId: sample.type_id,
            weight: toG(sample.weight) || 500,
            height: toMm(sample.height) || 100,
            depth: toMm(sample.depth) || 100,
            width: toMm(sample.width) || 100,
          },
          items: attrs.map((a) => ({
            productId: String(a.id),
            offerId: a.offer_id,
            categoryId: a.description_category_id,
            typeId: a.type_id,
            weight: toG(a.weight),
            height: toMm(a.height),
            depth: toMm(a.depth),
            width: toMm(a.width),
            images: a.images || [],
          })),
        },
      });
    } catch (e: any) {
      return reply.send({ code: 0, msg: `获取源商品属性失败: ${e.message?.slice(0, 200) || '未知'}` });
    }
  });

  app.get('/ozon-category-catalog/search', async (request, reply) => {
    const { userId } = (request as any).user;
    const query = request.query as { shopId?: string; q?: string; limit?: string; refresh?: string; language?: string };
    const shopId = String(query.shopId || '').trim();
    if (!shopId) return reply.status(400).send({ code: 0, msg: '请选择 OZON 店铺' });

    const shop = await prisma.shop.findFirst({ where: { id: shopId, userId, platform: 'OZON' } });
    if (!shop || !shop.clientId || !shop.apiKeyEncrypted) return reply.status(400).send({ code: 0, msg: '店铺配置不完整' });

    const limitRaw = Number(query.limit || 20);
    const limit = Math.min(50, Math.max(1, Number.isFinite(limitRaw) ? Math.trunc(limitRaw) : 20));
    const language = String(query.language || 'DEFAULT').trim() || 'DEFAULT';
    const refresh = ['1', 'true', 'yes'].includes(String(query.refresh || '').toLowerCase());
    const store = createPrismaOzonCategoryCatalogStore(prisma);

    try {
      const enrichMissingTranslations = await createAiOzonCategoryTranslationEnricher(userId);
      const result = await searchOrRefreshOzonCategoryCatalogForShop({
        shopId,
        query: query.q || '',
        language,
        limit,
        refresh,
      }, {
        store,
        ...(enrichMissingTranslations ? { enrichMissingTranslations } : {}),
        fetchTree: async () => {
          const { OzonClient } = await import('../services/ozon-client.js');
          const { decrypt } = await import('../lib/crypto.js');
          const client = new OzonClient({ clientId: shop.clientId!, apiKey: decrypt(shop.apiKeyEncrypted) });
          return client.getDescriptionCategoryTree({ language });
        },
      });

      return reply.send({
        code: 1,
        msg: 'ok',
        data: {
          entries: result.entries,
          total: result.total,
          refreshed: result.refreshed,
          language,
        },
      });
    } catch (e: any) {
      return reply.send({ code: 0, msg: `搜索 Ozon 类目目录失败: ${e.message?.slice(0, 200) || '未知'}` });
    }
  });
  app.get('/:id/ozon-category-candidates', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };
    const query = request.query as { shopId?: string };
    const shopId = String(query.shopId || '').trim();
    if (!shopId) return reply.status(400).send({ code: 0, msg: '请选择 OZON 店铺' });

    const shop = await prisma.shop.findFirst({ where: { id: shopId, userId, platform: 'OZON' } });
    if (!shop || !shop.clientId || !shop.apiKeyEncrypted) return reply.status(400).send({ code: 0, msg: '店铺配置不完整' });
    const item = await prisma.supplyGoods.findFirst({ where: { id, userId } });
    if (!item) return reply.status(404).send({ code: 0, msg: '商品不存在' });
    const shopCredentials = {
      clientId: shop.clientId,
      apiKeyEncrypted: shop.apiKeyEncrypted,
    };

    let client: ReturnType<typeof createSourceWorkflowOzonClient> | null = null;
    const loadClient = () => {
      client ||= createSourceWorkflowOzonClient(shopCredentials);
      return client;
    };
    try {
      const readDecision = await featureFlags.evaluate('SOURCE_OZON_MAPPING_V2_READ', {
        ownerUserId: userId,
        shopId,
        platform: 'OZON',
      });
      if (!readDecision.enabled && !readDecision.legacyAllowed) {
        throw new SourceOzonCategoryRouteError(
          'source_workflow_rollout_unavailable',
          503,
          'Ozon 类目映射读取策略暂不可用',
        );
      }

      let catalogSnapshot: AuthoritativeOzonCategoryCatalogSnapshot;
      try {
        catalogSnapshot = await loadAuthoritativeOzonCategoryCatalog({
          shopId,
          fetchTree: async (language) => loadClient().getDescriptionCategoryTree({ language }),
        });
      } catch (error) {
        const credentialError = findSourceWorkflowOzonCredentialsUnavailableError(error);
        if (credentialError) throw credentialError;
        throw new SourceOzonCategoryRouteError(
          'ozon_category_catalog_unavailable',
          503,
          '当前 Ozon 官方类目目录不可用，请稍后重试',
        );
      }
      if (!catalogSnapshot.catalogRevision || !Array.isArray(catalogSnapshot.entries)) {
        throw new SourceOzonCategoryRouteError(
          'ozon_category_catalog_invalid',
          503,
          '当前 Ozon 官方类目目录无效，请稍后重试',
        );
      }

      let signature: string;
      let canonicalContext: SourceOzonCategoryCanonicalContext | null = null;
      let historyMode: 'v2' | 'legacy_tenant';
      let confirmedMappings: SourceOzonConfirmedMapping[];
      if (readDecision.enabled) {
        if (!sourceOzonCategoryMappingService || !loadCanonicalSourceOzonCategoryContext) {
          throw new SourceOzonCategoryRouteError(
            'source_ozon_mapping_v2_unavailable',
            503,
            'Ozon 类目映射 V2 服务不可用',
          );
        }
        canonicalContext = await loadCanonicalSourceOzonCategoryContext({
          ownerUserId: userId,
          supplyGoodsId: id,
        });
        if (!canonicalContext) {
          throw new SourceOzonCategoryRouteError(
            'source_capture_v2_required',
            409,
            '该商品缺少可验证的采集快照，请重新采集',
          );
        }
        signature = deriveSourceOzonCategoryIdentity(canonicalContext.source).sourceSignature;
        const visibleMappings = await sourceOzonCategoryMappingService.listVisibleMappings({
          ownerUserId: userId,
          source: canonicalContext.source,
        });
        const catalogByKey = new Map(catalogSnapshot.entries
          .filter((entry) => entry.disabled !== true && entry.selectable !== false)
          .map((entry) => [sourceOzonCategoryKey(entry.descriptionCategoryId, entry.typeId), entry]));
        confirmedMappings = visibleMappings
          .filter((mapping) => (
            mapping.status === 'ACTIVE'
            && mapping.sourceSignature === signature
            && (
              (mapping.scope === 'TENANT'
                && mapping.scopeKey === `tenant:${userId}`
                && mapping.ownerUserId === userId)
              || (mapping.scope === 'GLOBAL'
                && mapping.scopeKey === 'global'
                && mapping.ownerUserId === null
                && !!mapping.reviewedByUserId
                && !!mapping.reviewedAt)
            )
          ))
          .flatMap((mapping) => {
            const catalog = catalogByKey.get(sourceOzonCategoryKey(mapping.targetCategoryId, mapping.targetTypeId));
            return catalog ? [{
              signature,
              categoryId: mapping.targetCategoryId,
              typeId: mapping.targetTypeId,
              categoryName: catalog.categoryNameRu,
              typeName: catalog.typeNameRu,
              confirmations: mapping.confirmCount,
              mappingId: mapping.id,
              transitionVersion: mapping.transitionVersion,
            }] : [];
          });
        historyMode = 'v2';
      } else {
        signature = sourceCategorySignature(item);
        const confirmedRows = await prisma.supplyGoods.findMany({
          where: sourceOzonLegacyConfirmedMappingWhere(userId, signature) as any,
          select: { metadata: true },
          take: 200,
          orderBy: { updatedAt: 'desc' },
        });
        const confirmedMap = new Map<string, SourceOzonConfirmedMapping>();
        for (const row of confirmedRows) {
          const confirmed = metadataRecord(row.metadata).sourceOzonCategoryConfirmed;
          if (!confirmed || typeof confirmed !== 'object' || Array.isArray(confirmed)) continue;
          const categoryId = Number(confirmed.categoryId);
          const typeId = Number(confirmed.typeId);
          const target = selectableOfficialOzonCategoryTarget(catalogSnapshot, categoryId, typeId);
          if (!target) continue;
          const key = sourceOzonCategoryKey(categoryId, typeId);
          const existing = confirmedMap.get(key);
          confirmedMap.set(key, {
            signature,
            categoryId,
            typeId,
            categoryName: target.categoryName,
            typeName: target.typeName,
            confirmations: (existing?.confirmations || 0) + 1,
            mappingId: null,
            transitionVersion: 0,
          });
        }
        confirmedMappings = Array.from(confirmedMap.values());
        historyMode = 'legacy_tenant';
      }

      const preliminary = buildSourceOzonCategoryCandidates({
        item,
        sourceSignature: signature,
        ...(canonicalContext ? { sourceProfile: canonicalContext.profile } : {}),
        categoryTree: catalogSnapshot.categoryTree,
        categoryCatalog: catalogSnapshot.entries,
        confirmedMappings,
      });
      const attributesByCategory: Record<string, SourceStandardOzonAttributeDef[]> = {};
      const attributeDefinitionStore = createPrismaOzonAttributeDefinitionCacheStore(prisma as any);
      for (const candidate of preliminary) {
        const key = String(candidate.categoryId) + ':' + String(candidate.typeId);
        try {
          const result = await getCachedOzonAttributeDefinitions({
            shopId,
            descriptionCategoryId: candidate.categoryId,
            typeId: candidate.typeId,
            language: 'DEFAULT',
            catalogRevision: catalogSnapshot.catalogRevision,
          }, {
            store: attributeDefinitionStore,
            fetchDefinitions: () => loadClient().getDescriptionCategoryAttributes({
              description_category_id: candidate.categoryId,
              type_id: candidate.typeId,
              language: 'DEFAULT',
            }),
          });
          attributesByCategory[key] = result.definitions.map(toOzonCategoryAttributeDefinition);
        } catch (error) {
          if (error instanceof OzonAttributeDefinitionsRequiredError) throw error;
          const credentialError = findSourceWorkflowOzonCredentialsUnavailableError(error);
          if (credentialError) throw credentialError;
          throw new SourceOzonCategoryRouteError(
            'ozon_attribute_definitions_unavailable',
            503,
            `无法取得 Ozon 类目属性定义 ${candidate.categoryId}/${candidate.typeId}，请稍后重试`,
          );
        }
      }
      const candidates = buildSourceOzonCategoryCandidates({
        item,
        sourceSignature: signature,
        ...(canonicalContext ? { sourceProfile: canonicalContext.profile } : {}),
        categoryTree: catalogSnapshot.categoryTree,
        categoryCatalog: catalogSnapshot.entries,
        confirmedMappings,
        attributesByCategory,
      });
      const mappingByKey = new Map(confirmedMappings.map((mapping) => [
        sourceOzonCategoryKey(mapping.categoryId, mapping.typeId),
        mapping,
      ]));
      for (const candidate of candidates) {
        const mapping = mappingByKey.get(sourceOzonCategoryKey(candidate.categoryId, candidate.typeId));
        candidate.mappingId = mapping?.mappingId || null;
        candidate.transitionVersion = Math.max(0, Number(mapping?.transitionVersion) || 0);
      }
      return reply.send({
        code: 1,
        msg: 'ok',
        data: {
          signature,
          sourceSnapshotId: canonicalContext?.source.snapshotId || null,
          sourceProfileHash: canonicalContext?.source.profileHash || null,
          catalogRevision: catalogSnapshot.catalogRevision,
          historyMode,
          candidates,
        },
      });
    } catch (caught) {
      return mappingRouteError(reply, caught);
    }
  });

  app.post('/:id/ozon-category-confirm', async (request, reply) => {
    const auth = (request as any).user;
    const userId = String(auth.userId || '').trim();
    const actorUserId = String(auth.actorUserId || auth.userId || '').trim();
    const { id } = request.params as { id: string };
    const parsed = sourceOzonCategoryConfirmationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message || '确认参数无效' });
    }
    const body = parsed.data;
    const shop = await prisma.shop.findFirst({
      where: { id: body.shopId, userId, platform: 'OZON' },
    });
    if (!shop || !shop.clientId || !shop.apiKeyEncrypted) {
      return reply.status(400).send({ code: 0, msg: '店铺配置不完整' });
    }
    const item = await prisma.supplyGoods.findFirst({ where: { id, userId } });
    if (!item) return reply.status(404).send({ code: 0, msg: '商品不存在' });
    const shopCredentials = {
      clientId: shop.clientId,
      apiKeyEncrypted: shop.apiKeyEncrypted,
    };

    let client: ReturnType<typeof createSourceWorkflowOzonClient> | null = null;
    const loadClient = () => {
      client ||= createSourceWorkflowOzonClient(shopCredentials);
      return client;
    };
    try {
      const writeDecision = await featureFlags.evaluate('SOURCE_OZON_MAPPING_V2_WRITE', {
        ownerUserId: userId,
        shopId: body.shopId,
        platform: 'OZON',
      });
      if (!writeDecision.enabled && !writeDecision.legacyAllowed) {
        throw new SourceOzonCategoryRouteError(
          'source_workflow_rollout_unavailable',
          503,
          'Ozon 类目映射写入策略暂不可用',
        );
      }

      let catalogSnapshot: AuthoritativeOzonCategoryCatalogSnapshot;
      try {
        catalogSnapshot = await loadAuthoritativeOzonCategoryCatalog({
          shopId: body.shopId,
          fetchTree: async (language) => loadClient().getDescriptionCategoryTree({ language }),
        });
      } catch (error) {
        const credentialError = findSourceWorkflowOzonCredentialsUnavailableError(error);
        if (credentialError) throw credentialError;
        throw new SourceOzonCategoryRouteError(
          'ozon_category_catalog_unavailable',
          503,
          '当前 Ozon 官方类目目录不可用，请稍后重试',
        );
      }
      if (catalogSnapshot.catalogRevision !== body.expectedCatalogRevision) {
        throw new SourceOzonCategoryRouteError(
          'ozon_category_catalog_stale',
          409,
          'Ozon 类目目录已更新，请刷新候选后重试',
        );
      }
      const target = selectableOfficialOzonCategoryTarget(
        catalogSnapshot,
        body.categoryId,
        body.typeId,
      );
      if (!target) {
        throw new SourceOzonCategoryRouteError(
          'ozon_category_target_invalid',
          422,
          '所选 Ozon 类目/type 不在当前可用官方目录中',
        );
      }

      let signature: string;
      let sourceSnapshotId: string | null = null;
      let sourceProfileHash: string | null = null;
      let mappingId: string | null = null;
      let transitionVersion = 0;
      let confirmedAt = new Date().toISOString();
      let idempotent = false;
      if (writeDecision.enabled) {
        if (!sourceOzonCategoryMappingService || !loadCanonicalSourceOzonCategoryContext) {
          throw new SourceOzonCategoryRouteError(
            'source_ozon_mapping_v2_unavailable',
            503,
            'Ozon 类目映射 V2 服务不可用',
          );
        }
        const canonicalContext = await loadCanonicalSourceOzonCategoryContext({
          ownerUserId: userId,
          supplyGoodsId: id,
        });
        if (!canonicalContext) {
          throw new SourceOzonCategoryRouteError(
            'source_capture_v2_required',
            409,
            '该商品缺少可验证的采集快照，请重新采集',
          );
        }
        const result = await sourceOzonCategoryMappingService.confirmTenantMapping({
          ownerUserId: userId,
          actorUserId,
          expectedTransitionVersion: body.expectedTransitionVersion,
          source: canonicalContext.source,
          target,
        });
        signature = result.mapping.sourceSignature;
        sourceSnapshotId = result.mapping.sourceSnapshotId;
        sourceProfileHash = result.mapping.sourceProfileHash;
        mappingId = result.mapping.id;
        transitionVersion = result.mapping.transitionVersion;
        confirmedAt = result.mapping.lastConfirmedAt || result.mapping.updatedAt;
        idempotent = result.idempotent;
      } else {
        signature = sourceCategorySignature(item);
      }

      const metadataPatch = {
        descriptionCategoryId: target.categoryId,
        typeId: target.typeId,
        sourceOzonCategoryConfirmed: {
          version: writeDecision.enabled
            ? 'source-ozon-category-confirmed/v2'
            : 'source-ozon-category-confirmed/legacy-v1',
          mappingId,
          signature,
          sourceSnapshotId,
          sourceProfileHash,
          categoryId: target.categoryId,
          typeId: target.typeId,
          categoryName: target.categoryName,
          typeName: target.typeName,
          catalogRevision: target.catalogRevision,
          transitionVersion,
          actorUserId,
          confirmedAt,
        },
      };
      await mergeSourceOzonCategoryMetadata({
        ownerUserId: userId,
        supplyGoodsId: id,
        metadataPatch,
      });
      return reply.send({
        code: 1,
        msg: '已确认 Ozon 类目',
        data: {
          id,
          signature,
          sourceSnapshotId,
          sourceProfileHash,
          categoryId: target.categoryId,
          typeId: target.typeId,
          categoryName: target.categoryName,
          typeName: target.typeName,
          catalogRevision: target.catalogRevision,
          mappingId,
          transitionVersion,
          confirmedAt,
          idempotent,
          metadataPatch,
        },
      });
    } catch (caught) {
      return mappingRouteError(reply, caught);
    }
  });

  app.post('/resolve-type-id', async (request, reply) => {
    const { userId } = (request as any).user;
    const body = request.body as { shopId: string; descriptionCategoryId: number };

    if (!body?.shopId || !body?.descriptionCategoryId) {
      return reply.status(400).send({ code: 0, msg: '请提供 shopId 和 descriptionCategoryId' });
    }

    const shop = await prisma.shop.findFirst({ where: { id: body.shopId, userId } });
    if (!shop || !shop.clientId || !shop.apiKeyEncrypted) {
      return reply.status(400).send({ code: 0, msg: '店铺配置不完整' });
    }

    const { OzonClient } = await import('../services/ozon-client.js');
    const { decrypt } = await import('../lib/crypto.js');
    const client = new OzonClient({ clientId: shop.clientId, apiKey: decrypt(shop.apiKeyEncrypted) });

    try {
      const tree = await client.getDescriptionCategoryTree();
      await createPrismaOzonCategoryCatalogStore(prisma)
        .replace(body.shopId, 'DEFAULT', buildOzonCategoryCatalog(tree), new Date())
        .catch(() => undefined);
      const targetId = body.descriptionCategoryId;
      const types: { typeId: number; typeName: string }[] = [];

      function searchTree(nodes: any[]) {
        for (const node of nodes) {
          if (node.description_category_id === targetId && node.type_id) {
            types.push({ typeId: node.type_id, typeName: node.type_name || '' });
          }
          if (Array.isArray(node.children)) {
            searchTree(node.children);
          }
        }
      }
      searchTree(tree);

      if (!types.length) {
        return reply.send({ code: 1, msg: '未找到该分类下的类型', data: { types: [], autoTypeId: null } });
      }

      return reply.send({
        code: 1,
        msg: 'ok',
        data: {
          types,
          autoTypeId: types.length === 1 ? types[0]!.typeId : null,
        },
      });
    } catch (e: any) {
      return reply.send({ code: 0, msg: `查询分类树失败: ${e.message?.slice(0, 200) || '未知'}` });
    }
  });

  app.delete('/:id', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };

    const item = await prisma.supplyGoods.findFirst({ where: { id, userId } });
    if (!item) return reply.status(404).send({ code: 0, msg: '商品不存在' });

    await prisma.supplyGoods.delete({ where: { id } });
    return reply.send({ code: 1, msg: '已删除' });
  });

  // ====== 水印处理 ======
  app.post('/watermark', async (request, reply) => {
    const { userId } = (request as any).user;
    let parsed;
    try {
      parsed = parseCollectWatermarkInput(request.body);
    } catch (error: any) {
      return reply.status(400).send({ code: 0, msg: error.issues?.[0]?.message || '参数错误' });
    }

    const { processItemWatermarks } = await import('../services/watermark.js');
    const { ids, config } = parsed;

    const items = await prisma.supplyGoods.findMany({
      where: { id: { in: ids }, userId },
    });

    const { processed, failed } = await processWatermarkItemsWithConcurrency(items, config, processItemWatermarks);

    return reply.send({
      code: 1,
      msg: `已处理 ${processed} 件商品的图片水印${failed ? `（${failed} 张失败）` : ''}`,
      data: { processed, failed },
    });
  });
}

/** 解析 OZON 输入：链接、product_id、offer_id */
function parseOzonInput(input: string): { type: 'product_id' | 'offer_id'; value: number | string } {
  const trimmed = input.trim();

  // OZON 商品链接格式: https://www.ozon.ru/product/xxx-123456 或 https://ozon.ru/t/xxx
  const urlMatch = trimmed.match(/ozon\.ru\/product\/.*?-(\d+)\/?/);
  if (urlMatch && urlMatch[1]) {
    return { type: 'product_id', value: parseInt(urlMatch[1], 10) };
  }

  // 短链接格式: https://ozon.ru/product/123456
  const shortUrlMatch = trimmed.match(/ozon\.ru\/product\/(\d+)\/?/);
  if (shortUrlMatch && shortUrlMatch[1]) {
    return { type: 'product_id', value: parseInt(shortUrlMatch[1], 10) };
  }

  // 纯数字 -> 当作 product_id
  if (/^\d+$/.test(trimmed)) {
    return { type: 'product_id', value: parseInt(trimmed, 10) };
  }

  // 其他情况当作 offer_id
  return { type: 'offer_id', value: trimmed };
}
