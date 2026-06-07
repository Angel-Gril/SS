import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { getRandomizeConfig, randomOfferIdFrom, jitterDimensionMm, bucketWeightG } from '../lib/randomize.js';
import { randomSuffix, chunkArray } from '../lib/util.js';
import { resolveCollectedPrice } from '../services/collect-pricing.js';
import { resolveImageUrls } from '../services/ozon-image-resolver.js';
import { convertOzonRawAttrs } from '../services/ozon-attributes.js';

const CJK_TEXT_RE = /[\u3400-\u9fff]/;
const ALIBABA_1688_DESCRIPTION_LIMIT = 6000;
export const DOMESTIC_SUPPLY_SOURCE_PLATFORMS = new Set(['1688', 'taobao', 'tmall', 'jd', 'pinduoduo', 'pdd']);
export const DOMESTIC_SUPPLY_SOURCE_PLATFORMS_LIST = Array.from(DOMESTIC_SUPPLY_SOURCE_PLATFORMS);

type OzonPriceCheckContext = {
  title?: string | null;
  productId?: string | null;
  sku?: string | null;
  ozonSku?: string | null;
  offerId?: string | null;
  sourceUrl?: string | null;
  price?: string | null;
  currency?: string | null;
} | null;

const collectSchema = z.object({
  title: z.string().min(1),
  publishTitle: z.string().optional(),
  sourceTitleRaw: z.string().optional(),
  sourceLocale: z.string().optional(),
  sourceUrl: z.string().optional(),
  sourcePlatform: z.string().optional(),
  images: z.array(z.string()).optional(),
  price: z.string().optional(),
  priceText: z.string().optional(),
  currency: z.string().optional(),
  categoryId: z.number().optional(),
  categoryName: z.string().optional(),
  attributes: z.array(z.object({ id: z.number().optional(), name: z.string(), value: z.string() })).optional(),
  description: z.string().optional(),
  weight: z.number().optional(),
  weightG: z.number().optional(),
  sku: z.string().optional(),
  sourceProductId: z.string().optional(),
});

const alibaba1688CollectSchema = z.object({
  title: z.string().min(1),
  sourcePlatform: z.string().optional(),
  sourceUrl: z.string().optional(),
  offerId: z.string().optional(),
  sku: z.string().optional(),
  images: z.array(z.string()).optional(),
  imageText: z.string().optional(),
  price: z.union([z.string(), z.number()]).optional(),
  priceText: z.string().optional(),
  currency: z.string().optional(),
  categoryPath: z.string().optional(),
  shopName: z.string().optional(),
  supplierName: z.string().optional(),
  supplierLocation: z.string().optional(),
  supplierYears: z.union([z.string(), z.number()]).optional(),
  monthlySales: z.union([z.string(), z.number()]).optional(),
  grossWeightGrams: z.union([z.string(), z.number()]).optional(),
  lengthMm: z.union([z.string(), z.number()]).optional(),
  widthMm: z.union([z.string(), z.number()]).optional(),
  heightMm: z.union([z.string(), z.number()]).optional(),
  dimensionsText: z.string().optional(),
  minOrderQty: z.union([z.string(), z.number()]).optional(),
  shippingInfo: z.unknown().optional(),
  logisticsText: z.string().optional(),
  customizationInfo: z.unknown().optional(),
  attributes: z.record(z.string()).optional(),
  attributesText: z.string().optional(),
  skuItems: z.array(z.record(z.unknown())).optional(),
  variants: z.array(z.record(z.unknown())).optional(),
  description: z.string().optional(),
  notes: z.string().optional(),
  raw: z.unknown().optional(),
});

export function containsCjkText(value: unknown): boolean {
  return CJK_TEXT_RE.test(String(value || ''));
}

export function calcPublishPrice(baseCny: number, markupPct = 200, markupAmount = 0): number {
  const base = Number.isFinite(baseCny) && baseCny > 0 ? baseCny : 100;
  const pct = Number.isFinite(markupPct) ? markupPct : 200;
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

export function resolvePublishName(item: { title?: string | null; metadata?: unknown }, variantAttrs?: Record<string, string>): string {
  const meta = (item.metadata && typeof item.metadata === 'object' ? item.metadata : {}) as Record<string, any>;
  const base = String(meta.publishTitleRu || meta.sourceTitleRu || item.title || '').trim();
  const attrText = variantAttrs && Object.keys(variantAttrs).length ? Object.values(variantAttrs).filter(Boolean).join(' ') : '';
  return attrText ? `${base} ${attrText}`.slice(0, 200) : base.slice(0, 200);
}

function assertPublishNamesAreSafe(items: { id: string; sku?: string | null; title?: string | null; metadata?: unknown; variants?: unknown }[]) {
  const bad: string[] = [];
  for (const item of items) {
    const variants = Array.isArray(item.variants) ? item.variants as any[] : [];
    if (!variants.length) {
      const name = resolvePublishName(item);
      if (!name || containsCjkText(name)) bad.push(`${item.sku || item.id}: ${name || '空标题'}`);
      continue;
    }
    for (const v of variants) {
      const attrs = v?.attrs && typeof v.attrs === 'object' ? v.attrs as Record<string, string> : undefined;
      const name = resolvePublishName(item, attrs);
      if (!name || containsCjkText(name)) bad.push(`${v?.sku || item.sku || item.id}: ${name || '空标题'}`);
    }
  }
  if (bad.length) {
    const sample = bad.slice(0, 3).join('；');
    throw new Error(`上架标题包含中文或为空，OZON 可能无法识别。请先补采俄文标题或编辑上架标题：${sample}`);
  }
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

function normalizeProductId(value: unknown): string | null {
  const text = value == null ? '' : String(value).trim();
  return text || null;
}

function normalizeSourcePlatform(value: unknown): string | null {
  return normalizeProductId(value)?.toLowerCase() || null;
}

export function normalizeCollectSourcePlatform(value: unknown): string {
  return normalizeSourcePlatform(value) || 'ozon';
}

export function getSupplyGoodsLookupId(item: { sourceProductId?: string | null; sku?: string | null }): string | null {
  return normalizeProductId(item.sourceProductId) || normalizeProductId(item.sku);
}

export function isDomesticSupplySourcePlatform(value: unknown): boolean {
  const sourcePlatform = normalizeSourcePlatform(value);
  return !!sourcePlatform && DOMESTIC_SUPPLY_SOURCE_PLATFORMS.has(sourcePlatform);
}

function normalizeDomesticSupplySourcePlatform(value: unknown, fallback: string | null = '1688'): string | null {
  const sourcePlatform = normalizeSourcePlatform(value);
  return sourcePlatform && DOMESTIC_SUPPLY_SOURCE_PLATFORMS.has(sourcePlatform)
    ? sourcePlatform
    : fallback;
}

export function buildCollectSnapshotWhere(userId: string, skus: string[], sourcePlatform?: unknown) {
  const sourcePlatformValue = normalizeSourcePlatform(sourcePlatform) || 'ozon';
  const lookupSkus = Array.from(new Set(skus.map((sku) => normalizeProductId(sku)).filter((sku): sku is string => !!sku)));
  return {
    userId,
    sourcePlatform: sourcePlatformValue,
    OR: [
      { sourceProductId: { in: lookupSkus } },
      { sku: { in: lookupSkus } },
    ],
  };
}

export function buildCollectListWhere(userId: string, query: { status?: string; search?: string; sourcePlatform?: string }) {
  const where: Record<string, unknown> = { userId };
  if (query.status) where.status = query.status;
  const sourcePlatform = normalizeSourcePlatform(query.sourcePlatform);
  if (sourcePlatform === 'domestic-supply') {
    where.sourcePlatform = { in: DOMESTIC_SUPPLY_SOURCE_PLATFORMS_LIST };
  } else if (sourcePlatform) {
    where.sourcePlatform = sourcePlatform;
  }
  if (query.search) {
    where.OR = [
      { title: { contains: query.search, mode: 'insensitive' } },
      { sku: { contains: query.search, mode: 'insensitive' } },
      { sourceProductId: { contains: query.search, mode: 'insensitive' } },
    ];
  }
  return where;
}

export function buildCollectSnapshot(item: {
  id: string;
  title: string;
  sourceProductId?: string | null;
  sku?: string | null;
  sourceUrl?: string | null;
  status: string;
  createdAt: Date;
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
    lastCollectedAt: item.createdAt.toISOString(),
    price: item.purchasePrice?.toString() || null,
    imageCount: Array.isArray(item.images) ? item.images.length : 0,
    listed: item.status === 'listed',
    lastError: meta.lastError || null,
  };
}

function compactString(value: unknown): string | null {
  const text = value == null ? '' : String(value).trim();
  return text || null;
}

function parseUrlLike(value: unknown): URL | null {
  const text = compactString(value);
  if (!text) return null;
  try {
    return new URL(text);
  } catch {
    try {
      return new URL(`https://${text}`);
    } catch {
      return null;
    }
  }
}

function inferDomesticSupplySourcePlatformFromUrl(sourceUrl: unknown): string | null {
  const url = parseUrlLike(sourceUrl);
  const host = url?.hostname.toLowerCase() || '';
  if (!host) return null;
  if (host.includes('1688.com')) return '1688';
  if (host.includes('taobao.com')) return 'taobao';
  if (host.includes('tmall.com')) return 'tmall';
  if (host.includes('jd.com')) return 'jd';
  if (host.includes('yangkeduo.com') || host.includes('pinduoduo.com')) return 'pinduoduo';
  return null;
}

function extractDomesticSupplyProductIdFromUrl(sourceUrl: unknown, sourcePlatform?: unknown): string | null {
  const text = compactString(sourceUrl);
  if (!text) return null;
  const url = parseUrlLike(text);
  const queryKeys = ['offerId', 'offer_id', 'id', 'item_id', 'itemId', 'num_iid', 'sku', 'skuId', 'wareId', 'goods_id', 'goodsId'];
  if (url) {
    for (const key of queryKeys) {
      const value = compactString(url.searchParams.get(key));
      if (value) return value;
    }
    const pathMatch = url.pathname.match(/(?:^|\/)(\d{5,})(?:\.html)?$/i);
    if (pathMatch?.[1]) return pathMatch[1];
  }
  const platform = normalizeSourcePlatform(sourcePlatform);
  if (platform === '1688' || /\.1688\.com/i.test(text)) {
    const offerMatch = text.match(/\/offer\/(\d{5,})(?:\.html)?/i);
    if (offerMatch?.[1]) return offerMatch[1];
  }
  const queryMatch = text.match(/[?&](?:offerId|offer_id|id|item_id|itemId|num_iid|sku|skuId|wareId|goods_id|goodsId)=([^&#]+)/i);
  return queryMatch?.[1] ? decodeURIComponent(queryMatch[1]) : null;
}

const ALIBABA_1688_ACTIVE_LISTING_STATUSES = new Set(['submitted', 'pending', 'imported']);

export function getAlibaba1688ListingStatus(item: { status?: string | null; metadata?: unknown }): string {
  const meta = item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
    ? item.metadata as Record<string, any>
    : {};
  const metadataStatus = compactString(meta.lastListingResultStatus) || compactString(meta.listingStatus);
  if (metadataStatus) return metadataStatus;
  if (item.status === 'listing_failed') return 'failed';
  if (item.status === 'listed') return 'submitted';
  return '';
}

export function canCreateAlibaba1688ListingDraft(item: { status?: string | null; metadata?: unknown }): boolean {
  return !ALIBABA_1688_ACTIVE_LISTING_STATUSES.has(getAlibaba1688ListingStatus(item));
}

function getAlibaba1688ListingBlockedIssue(item: { status?: string | null; metadata?: unknown }): string | null {
  const listingStatus = getAlibaba1688ListingStatus(item);
  return ALIBABA_1688_ACTIVE_LISTING_STATUSES.has(listingStatus)
    ? `listing_already_${listingStatus}`
    : null;
}

function compactHttpUrl(value: unknown): string | null {
  const text = compactString(value);
  if (!text || !/^https?:\/\//i.test(text)) return null;
  return text;
}

function normalizeImageUrl(value: unknown): string | null {
  const text = compactString(value);
  if (!text) return null;
  if (text.startsWith('//')) return `https:${text}`;
  if (/^https?:\/\//i.test(text)) return text;
  return null;
}

function extractOzonPriceCheckContext(metadata: unknown): OzonPriceCheckContext {
  const meta = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata as Record<string, any>
    : {};
  const raw = meta.raw && typeof meta.raw === 'object' && !Array.isArray(meta.raw)
    ? meta.raw as Record<string, any>
    : {};
  const source = meta.ozonPriceCheckContext || raw.priceCheckContext;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;

  const title = compactString(source.title);
  const productId = compactString(source.productId);
  const sku = compactString(source.sku ?? source.ozonSku ?? source.targetSku ?? source.productSku);
  const offerId = compactString(source.offerId ?? source.offer_id ?? source.ozonOfferId);
  const sourceUrl = compactHttpUrl(source.sourceUrl);
  if (!title && !productId && !sku && !offerId && !sourceUrl) return null;

  return {
    title,
    productId,
    sku,
    ozonSku: sku || productId,
    offerId,
    sourceUrl,
    price: source.price != null && source.price !== '' ? String(source.price) : null,
    currency: compactString(source.currency) || 'RUB',
  };
}

function numericValue(value: unknown): number | null {
  const text = String(value == null ? '' : value).replace(/[\s,¥￥₽]/g, '').trim();
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) ? number : null;
}

function positiveIntegerValue(value: unknown): number | null {
  const number = numericValue(value);
  if (!(number != null && Number.isFinite(number) && number > 0)) return null;
  return Math.trunc(number);
}

function buildPriceCheckEstimate(
  context: OzonPriceCheckContext,
  purchasePrice: unknown,
  purchaseCurrency: unknown,
) {
  if (!context) return null;
  const ozonPrice = numericValue(context.price);
  const purchase = numericValue(purchasePrice);
  const ozonCurrency = String(context.currency || 'RUB').toUpperCase();
  const sourceCurrency = String(purchaseCurrency || 'CNY').toUpperCase();
  const cnyPerRub = 0.08;
  if (!(ozonPrice != null && ozonPrice > 0 && purchase != null && purchase > 0)) return null;
  if (ozonCurrency !== 'RUB' || sourceCurrency !== 'CNY') return null;

  const purchaseRub = Math.round((purchase / cnyPerRub) * 100) / 100;
  const roughSpreadRub = Math.round((ozonPrice - purchaseRub) * 100) / 100;
  return {
    ozonPriceRub: ozonPrice,
    purchasePriceCny: purchase,
    purchasePriceRub: purchaseRub,
    roughSpreadRub,
    cnyPerRub,
    note: 'rough_source_price_only',
  };
}

export function buildAlibaba1688PriceSuggestion(
  context: OzonPriceCheckContext,
  purchasePrice: unknown,
  purchaseCurrency: unknown,
) {
  const purchase = numericValue(purchasePrice);
  const sourceCurrency = String(purchaseCurrency || 'CNY').toUpperCase();
  const cnyPerRub = 0.08;
  const purchasePriceCny = sourceCurrency === 'CNY' && purchase != null && purchase > 0 ? purchase : null;
  const costPlusTargetCny = purchasePriceCny != null ? calcPublishPrice(purchasePriceCny, 200, 0) : null;

  const ozonPrice = numericValue(context?.price);
  const ozonCurrency = String(context?.currency || 'RUB').toUpperCase();
  const ozonPriceRub = ozonCurrency === 'RUB' && ozonPrice != null && ozonPrice > 0 ? ozonPrice : null;
  const ozonPriceCny = ozonPriceRub != null ? Math.round(ozonPriceRub * cnyPerRub * 100) / 100 : null;

  const recommendedTargetPriceCny = ozonPriceCny ?? costPlusTargetCny;
  const recommendationSource = ozonPriceCny != null
    ? 'ozon_price_check'
    : costPlusTargetCny != null ? 'cost_plus_200pct' : 'none';

  return {
    purchasePriceCny,
    costPlusTargetCny,
    ozonPriceRub,
    ozonPriceCny,
    cnyPerRub,
    recommendedTargetPriceCny,
    recommendationSource,
    note: 'rough_suggestion_only',
  };
}

export function exposeSupplyGoodsMetadata(
  metadata: unknown,
  source?: {
    sourcePlatform?: string | null;
    images?: unknown;
    purchasePrice?: unknown;
    purchaseCurrency?: unknown;
    variants?: unknown;
  },
) {
  const isMetadataObject = !!metadata && typeof metadata === 'object' && !Array.isArray(metadata);
  if (!isMetadataObject && !isDomesticSupplySourcePlatform(source?.sourcePlatform)) return null;
  const meta = isMetadataObject ? { ...(metadata as Record<string, any>) } : {};
  const purchasePrice = source?.purchasePrice;
  const purchaseCurrency = source?.purchaseCurrency;
  const ozonPriceCheckContext = extractOzonPriceCheckContext(meta);
  if (ozonPriceCheckContext) meta.ozonPriceCheckContext = ozonPriceCheckContext;
  const priceCheckEstimate = buildPriceCheckEstimate(ozonPriceCheckContext, purchasePrice, purchaseCurrency);
  if (priceCheckEstimate) meta.priceCheckEstimate = priceCheckEstimate;
  if (isDomesticSupplySourcePlatform(source?.sourcePlatform) && !Array.isArray(meta.sourceDataIssues)) {
    const attributes = meta.attributes && typeof meta.attributes === 'object' && !Array.isArray(meta.attributes)
      ? meta.attributes as Record<string, unknown>
      : {};
    meta.sourceKind = meta.sourceKind || 'alibaba1688';
    meta.sourceDataIssues = getAlibaba1688SourceDataIssues({
      images: Array.isArray(source?.images) ? source.images : [],
      priceText: purchasePrice,
      skuItems: Array.isArray(source?.variants) ? source.variants : [],
      description: meta.description,
      attributes,
    });
  }
  return meta;
}

function parseImageList(images?: string[], imageText?: string): string[] {
  const values = [
    ...(Array.isArray(images) ? images : []),
    ...(imageText ? imageText.split(/[\n,]/) : []),
  ];
  return Array.from(new Set(values
    .map((item) => normalizeImageUrl(item))
    .filter((item): item is string => !!item)))
    .slice(0, 30);
}

export function normalizeAlibaba1688PreparationImages(inputImages?: unknown, fallbackImages?: unknown): string[] {
  if (inputImages === undefined) {
    return Array.isArray(fallbackImages)
      ? parseImageList(fallbackImages.map((item) => String(item || '')))
      : [];
  }

  if (!Array.isArray(inputImages)) {
    return [];
  }

  return parseImageList(inputImages.map((item) => String(item || '')));
}

export function parseAttributeText(text?: string): Record<string, string> {
  const output: Record<string, string> = {};
  for (const line of String(text || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/[:：]/);
    if (parts.length < 2) continue;
    const key = parts.shift()!.trim();
    const value = parts.join(':').trim();
    if (key && value) output[key] = value;
  }
  return output;
}

function formatAttributeText(attrs: Record<string, unknown>): string {
  return Object.entries(attrs)
    .map(([key, value]) => [String(key).trim(), String(value || '').trim()])
    .filter(([key, value]) => key && value)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
}

export function getAlibaba1688SourceDataIssues(input: {
  images?: unknown[];
  priceText?: unknown;
  skuItems?: unknown[];
  description?: unknown;
  attributes?: Record<string, unknown>;
}): string[] {
  const issues: string[] = [];
  if (!Array.isArray(input.images) || input.images.length === 0) issues.push('missing_source_images');
  if (!(numericValue(input.priceText) != null && numericValue(input.priceText)! > 0)) issues.push('missing_purchase_price');
  if (!Array.isArray(input.skuItems) || input.skuItems.length === 0) issues.push('missing_sku_items');
  if (!String(input.description || '').trim()) issues.push('missing_description');
  if (!input.attributes || Object.keys(input.attributes).length === 0) issues.push('missing_attributes');
  return issues;
}

export function refreshAlibaba1688SourceDataIssues(
  metadata: unknown,
  source: {
    images?: unknown;
    purchasePrice?: unknown;
    variants?: unknown;
  },
): Record<string, any> {
  const meta: Record<string, any> = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? { ...(metadata as Record<string, any>) }
    : {};
  const attributes = meta.attributes && typeof meta.attributes === 'object' && !Array.isArray(meta.attributes)
    ? meta.attributes as Record<string, unknown>
    : {};
  meta.sourceDataIssues = getAlibaba1688SourceDataIssues({
    images: Array.isArray(source.images) ? source.images : [],
    priceText: source.purchasePrice,
    skuItems: Array.isArray(source.variants) ? source.variants : [],
    description: meta.description,
    attributes,
  });
  return meta;
}

function normalize1688SkuItems(
  items?: Array<Record<string, unknown>>,
  options: {
    sourcePlatform?: string;
    ozonPriceCheckContext?: OzonPriceCheckContext;
  } = {},
) {
  if (!Array.isArray(items)) return [];
  const defaultSourcePlatform = normalizeDomesticSupplySourcePlatform(options.sourcePlatform) || '1688';
  const context = options.ozonPriceCheckContext;
  const defaultOzonSku = compactString(context?.sku ?? context?.ozonSku ?? context?.productId);
  const defaultOzonProductId = compactString(context?.productId);
  const defaultOzonOfferId = compactString(context?.offerId);
  return items.slice(0, 200).map((item, index) => {
    const sourcePlatform = normalizeDomesticSupplySourcePlatform(item.sourcePlatform ?? item.platform, defaultSourcePlatform) || defaultSourcePlatform;
    const fallbackSku = `${sanitizeOfferIdSegment(sourcePlatform, 'source').toLowerCase()}-${index + 1}`;
    const explicitSourceSku = compactString(item.sourceSkuId ?? item.source_sku_id ?? item.sourceSku ?? item.source_sku);
    const rawSku = compactString(item.skuId ?? item.sku_id ?? item.sku ?? item.specId ?? item.id);
    const sku = explicitSourceSku || rawSku || fallbackSku;
    const sourceSkuId = explicitSourceSku || rawSku || sku;
    const ozonSku = compactString(
      item.ozonSku
        ?? item.ozon_sku
        ?? item.targetOzonSku
        ?? item.target_ozon_sku
        ?? item.targetSku
        ?? item.ozonProductSku,
    ) || defaultOzonSku;
    const ozonProductId = compactString(
      item.ozonProductId
        ?? item.ozon_product_id
        ?? item.targetOzonProductId
        ?? item.target_ozon_product_id,
    ) || defaultOzonProductId;
    const ozonOfferId = compactString(
      item.ozonOfferId
        ?? item.ozon_offer_id
        ?? item.targetOzonOfferId
        ?? item.target_ozon_offer_id,
    ) || defaultOzonOfferId;
    const attrs = item.attrs && typeof item.attrs === 'object' && !Array.isArray(item.attrs)
      ? item.attrs as Record<string, unknown>
      : {};
    const specText = compactString(item.specText ?? item.specName ?? item.name);
    const attrRecord = Object.keys(attrs).length
      ? Object.fromEntries(Object.entries(attrs).map(([key, value]) => [key, String(value || '')]).filter(([, value]) => value))
      : specText ? { 规格: specText } : {};
    const images = normalize1688SkuImages(item);
    return {
      sku,
      attrs: attrRecord,
      price: compactString(item.price ?? item.salePrice ?? item.finalPrice),
      stock: Number.isFinite(Number(item.stock)) ? Number(item.stock) : null,
      minOrderQty: Number.isFinite(Number(item.minOrderQty)) ? Number(item.minOrderQty) : null,
      grossWeightGrams: Number.isFinite(Number(item.grossWeightGrams)) ? Number(item.grossWeightGrams) : null,
      ...(images.length ? { images } : {}),
      sourceSkuId,
      sourcePlatform,
      ...(ozonSku ? { ozonSku } : {}),
      ...(ozonProductId ? { ozonProductId } : {}),
      ...(ozonOfferId ? { ozonOfferId } : {}),
    };
  });
}

function normalize1688SkuImages(item: Record<string, unknown>): string[] {
  const arrayValues = [
    ...(Array.isArray(item.images) ? item.images : []),
    ...(Array.isArray(item.imageUrls) ? item.imageUrls : []),
    ...(Array.isArray(item.skuImages) ? item.skuImages : []),
    ...(Array.isArray(item.picUrls) ? item.picUrls : []),
  ];
  const directValues = [
    item.imageUrl,
    item.imgUrl,
    item.picUrl,
    item.skuImage,
    item.skuImageUrl,
    item.previewImage,
    item.thumbUrl,
    item.mainImage,
  ];
  const urls = [...arrayValues, ...directValues]
    .map((value) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const record = value as Record<string, unknown>;
        return normalizeImageUrl(record.url ?? record.src ?? record.imageUrl ?? record.imgUrl ?? record.picUrl);
      }
      return normalizeImageUrl(value);
    })
    .filter((value): value is string => !!value);
  return Array.from(new Set(urls)).slice(0, 8);
}

export function normalizeAlibaba1688PreparationVariants(
  inputVariants?: unknown,
  fallbackVariants?: unknown,
  options: { sourcePlatform?: string | null } = {},
) {
  if (inputVariants === undefined) {
    return Array.isArray(fallbackVariants) ? fallbackVariants as any[] : [];
  }
  if (!Array.isArray(inputVariants)) return [];
  const sourcePlatform = normalizeDomesticSupplySourcePlatform(options.sourcePlatform) || '1688';
  const fallbackBySku = new Map<string, any>();
  if (Array.isArray(fallbackVariants)) {
    for (const variant of fallbackVariants as any[]) {
      const sku = compactString(variant?.sku ?? variant?.sourceSkuId);
      if (sku) fallbackBySku.set(sku, variant);
    }
  }
  return normalize1688SkuItems(inputVariants as Array<Record<string, unknown>>, { sourcePlatform }).map((variant, index) => {
    const rawInput = (inputVariants as Array<Record<string, unknown>>)[index] || {};
    const hasExplicitSourcePlatform = !!compactString(rawInput.sourcePlatform ?? rawInput.platform);
    const fallback = fallbackBySku.get(variant.sku);
    const fallbackSourcePlatform = normalizeDomesticSupplySourcePlatform(fallback?.sourcePlatform, null);
    const inherited = {
      ...(fallbackSourcePlatform && !hasExplicitSourcePlatform ? { sourcePlatform: fallbackSourcePlatform } : {}),
      ...(fallback?.ozonSku && !(variant as any).ozonSku ? { ozonSku: fallback.ozonSku } : {}),
      ...(fallback?.ozonProductId && !(variant as any).ozonProductId ? { ozonProductId: fallback.ozonProductId } : {}),
      ...(fallback?.ozonOfferId && !(variant as any).ozonOfferId ? { ozonOfferId: fallback.ozonOfferId } : {}),
    };
    const nextVariant = Object.keys(inherited).length ? { ...variant, ...inherited } : variant;
    if (Array.isArray((nextVariant as any).images) && (nextVariant as any).images.length) {
      return nextVariant;
    }
    const fallbackImages = Array.isArray(fallback?.images)
      ? parseImageList(fallback.images.map((item: unknown) => String(item || '')))
      : [];
    return fallbackImages.length ? { ...nextVariant, images: fallbackImages } : nextVariant;
  });
}

function formatAlibaba1688VariantText(variants: any[]): string {
  return variants.map((variant) => {
    const attrs = variant?.attrs && typeof variant.attrs === 'object' && !Array.isArray(variant.attrs)
      ? variant.attrs as Record<string, unknown>
      : {};
    const specText = Object.values(attrs).map((value) => String(value || '').trim()).filter(Boolean).join(' / ');
    const imageUrl = Array.isArray(variant?.images)
      ? normalizeImageUrl(variant.images[0]) || ''
      : '';
    const sourcePlatform = compactString(variant?.sourcePlatform);
    const ozonProductId = compactString(variant?.ozonProductId);
    const ozonOfferId = compactString(variant?.ozonOfferId);
    const values = [
      variant?.sourceSkuId || variant?.sku || '',
      specText,
      variant?.price ?? '',
      variant?.stock ?? '',
      variant?.minOrderQty ?? '',
      variant?.grossWeightGrams ?? '',
      imageUrl,
      variant?.ozonSku ?? '',
    ];
    if (ozonProductId || ozonOfferId || (sourcePlatform && sourcePlatform !== '1688')) {
      values.push(ozonProductId || '', ozonOfferId || '');
    }
    if (sourcePlatform && sourcePlatform !== '1688') values.push(sourcePlatform);
    return values.map((value) => String(value || '')).join(' | ');
  }).join('\n');
}

export function buildAlibaba1688CollectRecord(input: z.infer<typeof alibaba1688CollectSchema>) {
  const submittedSourcePlatform = normalizeSourcePlatform(input.sourcePlatform);
  const inferredSourcePlatform = inferDomesticSupplySourcePlatformFromUrl(input.sourceUrl);
  const sourcePlatform = (
    submittedSourcePlatform && isDomesticSupplySourcePlatform(submittedSourcePlatform)
      ? submittedSourcePlatform
      : inferredSourcePlatform
  ) || '1688';
  const offerIdFromUrl = extractDomesticSupplyProductIdFromUrl(input.sourceUrl, sourcePlatform);
  const offerId = compactString(input.offerId) || offerIdFromUrl || compactString(input.sku);
  const images = parseImageList(input.images, input.imageText);
  const attributes = {
    ...parseAttributeText(input.attributesText),
    ...(input.attributes || {}),
  };
  const ozonPriceCheckContext = extractOzonPriceCheckContext({ raw: input.raw ?? null });
  const skuItems = normalize1688SkuItems(
    input.skuItems?.length ? input.skuItems : input.variants,
    { sourcePlatform, ozonPriceCheckContext },
  );
  const priceText = compactString(input.priceText ?? input.price);
  const supplierName = compactString(input.supplierName) || compactString(input.shopName);
  const weight = Number(input.grossWeightGrams);
  const lengthMm = Number(input.lengthMm);
  const widthMm = Number(input.widthMm);
  const heightMm = Number(input.heightMm);
  const supplierYears = Number(input.supplierYears);
  const minOrderQty = Number(input.minOrderQty);
  const description = compactString(input.description)?.slice(0, ALIBABA_1688_DESCRIPTION_LIMIT) || null;
  const sourceDataIssues = getAlibaba1688SourceDataIssues({
    images,
    priceText,
    skuItems,
    description,
    attributes,
  });
  const notes = [
    description ? description.slice(0, 500) : '',
    input.notes ? String(input.notes).slice(0, 500) : '',
  ].filter(Boolean).join('\n') || null;

  return {
    title: input.title.trim(),
    sourceUrl: compactString(input.sourceUrl),
    sourcePlatform,
    sourceProductId: offerId,
    sku: offerId,
    images,
    priceText,
    currency: compactString(input.currency) || 'CNY',
    notes,
    variants: skuItems,
    metadata: {
      sourceKind: 'alibaba1688',
      offerId,
      description,
      categoryPath: compactString(input.categoryPath),
      supplierName,
      supplierLocation: compactString(input.supplierLocation),
      supplierYears: Number.isFinite(supplierYears) && supplierYears > 0 ? supplierYears : null,
      monthlySales: input.monthlySales ?? null,
      grossWeightGrams: Number.isFinite(weight) ? weight : null,
      lengthMm: Number.isFinite(lengthMm) && lengthMm > 0 ? Math.round(lengthMm) : null,
      widthMm: Number.isFinite(widthMm) && widthMm > 0 ? Math.round(widthMm) : null,
      heightMm: Number.isFinite(heightMm) && heightMm > 0 ? Math.round(heightMm) : null,
      dimensionsText: compactString(input.dimensionsText),
      minOrderQty: Number.isFinite(minOrderQty) && minOrderQty > 0 ? minOrderQty : null,
      shippingInfo: input.shippingInfo ?? null,
      logisticsText: compactString(input.logisticsText),
      customizationInfo: input.customizationInfo ?? null,
      attributes,
      skuCount: skuItems.length,
      sourceDataIssues,
      categoryMappingStatus: 'deferred_until_listing',
      listingPreparationStatus: 'collected_only',
      ...(ozonPriceCheckContext ? { ozonPriceCheckContext } : {}),
      raw: input.raw ?? null,
    },
  };
}

export function buildAlibaba1688ListingPrefill(item: {
  id: string;
  title: string;
  status?: string | null;
  sourceUrl?: string | null;
  sourcePlatform?: string | null;
  sourceProductId?: string | null;
  purchasePrice?: { toString(): string } | null;
  currency?: string | null;
  images?: unknown;
  variants?: unknown;
  notes?: string | null;
  metadata?: unknown;
  createdAt: Date;
}) {
  const meta = (item.metadata && typeof item.metadata === 'object' ? item.metadata : {}) as Record<string, any>;
  const itemSourcePlatform = normalizeDomesticSupplySourcePlatform(item.sourcePlatform) || '1688';
  const variants = Array.isArray(item.variants)
    ? (item.variants as any[]).map((variant) => {
      if (!variant || typeof variant !== 'object' || Array.isArray(variant)) return variant;
      return { ...variant, sourcePlatform: normalizeDomesticSupplySourcePlatform(variant.sourcePlatform, itemSourcePlatform) || itemSourcePlatform };
    })
    : [];
  const images = Array.isArray(item.images) ? item.images : [];
  const purchasePrice = item.purchasePrice?.toString() ?? null;
  const attributes = meta.attributes && typeof meta.attributes === 'object' && !Array.isArray(meta.attributes)
    ? meta.attributes as Record<string, unknown>
    : {};
  const sourceDataIssues = Array.isArray(meta.sourceDataIssues)
    ? meta.sourceDataIssues
    : getAlibaba1688SourceDataIssues({
      images,
      priceText: purchasePrice,
      skuItems: variants,
      description: meta.description,
      attributes,
    });
  const ozonPriceCheckContext = extractOzonPriceCheckContext(meta);
  const priceCheckEstimate = buildPriceCheckEstimate(
    ozonPriceCheckContext,
    purchasePrice,
    item.currency || 'CNY',
  );
  const priceSuggestion = buildAlibaba1688PriceSuggestion(
    ozonPriceCheckContext,
    purchasePrice,
    item.currency || 'CNY',
  );
  const listingStatus = getAlibaba1688ListingStatus(item);
  return {
    id: item.id,
    title: item.title,
    sourceUrl: item.sourceUrl || null,
    sourcePlatform: itemSourcePlatform,
    sourceProductId: item.sourceProductId || null,
    purchasePrice,
    currency: item.currency || 'CNY',
    images,
    variants,
    skuText: formatAlibaba1688VariantText(variants),
    notes: item.notes || '',
    description: meta.description || '',
    supplierName: meta.supplierName || null,
    supplierLocation: meta.supplierLocation || null,
    supplierYears: Number.isFinite(Number(meta.supplierYears)) ? Number(meta.supplierYears) : null,
    monthlySales: meta.monthlySales ?? null,
    categoryPath: meta.categoryPath || null,
    grossWeightGrams: Number.isFinite(Number(meta.grossWeightGrams)) ? Number(meta.grossWeightGrams) : null,
    lengthMm: Number.isFinite(Number(meta.lengthMm)) ? Number(meta.lengthMm) : null,
    widthMm: Number.isFinite(Number(meta.widthMm)) ? Number(meta.widthMm) : null,
    heightMm: Number.isFinite(Number(meta.heightMm)) ? Number(meta.heightMm) : null,
    dimensionsText: meta.dimensionsText || '',
    minOrderQty: Number.isFinite(Number(meta.minOrderQty)) ? Number(meta.minOrderQty) : null,
    logisticsText: meta.logisticsText || '',
    attributes,
    attributesText: formatAttributeText(attributes),
    skuCount: Number.isFinite(Number(meta.skuCount)) ? Number(meta.skuCount) : variants.length,
    sourceDataIssues,
    categoryMappingStatus: meta.categoryMappingStatus || 'deferred_until_listing',
    listingPreparationStatus: meta.listingPreparationStatus || 'collected_only',
    listingPreparationIssues: Array.isArray(meta.listingPreparationIssues) ? meta.listingPreparationIssues : [],
    listingStatus: listingStatus || null,
    canCreateListingDraft: canCreateAlibaba1688ListingDraft(item),
    preparedTitleRu: meta.preparedTitleRu || '',
    targetPriceCny: meta.targetPriceCny || '',
    ozonCategoryId: meta.ozonCategoryId != null ? String(meta.ozonCategoryId) : '',
    ozonTypeId: meta.ozonTypeId != null ? String(meta.ozonTypeId) : '',
    listingNotes: meta.listingNotes || '',
    ozonPriceCheckContext,
    priceCheckEstimate,
    priceSuggestion,
    createdAt: item.createdAt.toISOString(),
  };
}

export function getAlibaba1688PreparationIssues(row: {
  preparedTitleRu?: string | null;
  targetPriceCny?: string | number | null;
  ozonCategoryId?: string | number | null;
  ozonTypeId?: string | number | null;
}, source?: {
  hasImages?: boolean;
}) {
  const title = String(row.preparedTitleRu || '').trim();
  const targetPrice = Number(row.targetPriceCny);
  const ozonCategoryId = positiveIntegerValue(row.ozonCategoryId);
  const ozonTypeId = positiveIntegerValue(row.ozonTypeId);
  const issues: string[] = [];

  if (!title) {
    issues.push('missing_prepared_title_ru');
  } else if (containsCjkText(title)) {
    issues.push('prepared_title_contains_cjk');
  }

  if (!(Number.isFinite(targetPrice) && targetPrice > 0)) {
    issues.push('missing_target_price_cny');
  }
  if (!ozonCategoryId) {
    issues.push('missing_ozon_category_id');
  }
  if (!ozonTypeId) {
    issues.push('missing_ozon_type_id');
  }
  if (source && !source.hasImages) {
    issues.push('missing_source_images');
  }

  return issues;
}

export function buildAlibaba1688PreparationMetadata(
  metadata: unknown,
  row: {
    preparedTitleRu?: string | null;
    targetPriceCny?: string | number | null;
    ozonCategoryId?: string | number | null;
    ozonTypeId?: string | number | null;
    listingNotes?: string | null;
    description?: string | null;
    attributes?: Record<string, unknown> | null;
    attributesText?: string | null;
  },
  source?: {
    hasImages?: boolean;
  },
) {
  const meta: Record<string, any> = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? { ...(metadata as Record<string, any>) }
    : {};
  const title = String(row.preparedTitleRu || '').trim();
  const notes = String(row.listingNotes || '').trim();
  const targetPrice = Number(row.targetPriceCny);
  const ozonCategoryId = positiveIntegerValue(row.ozonCategoryId);
  const ozonTypeId = positiveIntegerValue(row.ozonTypeId);

  if (title) meta.preparedTitleRu = title;
  else delete meta.preparedTitleRu;
  if (Number.isFinite(targetPrice) && targetPrice > 0) meta.targetPriceCny = String(targetPrice);
  else delete meta.targetPriceCny;
  if (ozonCategoryId) meta.ozonCategoryId = ozonCategoryId;
  else delete meta.ozonCategoryId;
  if (ozonTypeId) meta.ozonTypeId = ozonTypeId;
  else delete meta.ozonTypeId;
  if (notes) meta.listingNotes = notes;
  else delete meta.listingNotes;
  if (row.description !== undefined) {
    const description = compactString(row.description)?.slice(0, ALIBABA_1688_DESCRIPTION_LIMIT);
    if (description) meta.description = description;
    else delete meta.description;
  }
  if (row.attributesText !== undefined || row.attributes !== undefined) {
    const attributes = {
      ...parseAttributeText(row.attributesText || ''),
      ...(row.attributes && typeof row.attributes === 'object' && !Array.isArray(row.attributes) ? row.attributes : {}),
    };
    const normalized = Object.fromEntries(
      Object.entries(attributes)
        .map(([key, value]) => [String(key).trim(), String(value || '').trim()])
        .filter(([key, value]) => key && value),
    );
    if (Object.keys(normalized).length) meta.attributes = normalized;
    else delete meta.attributes;
  }

  const issues = getAlibaba1688PreparationIssues(row, source);
  meta.listingPreparationStatus = issues.length ? 'draft' : 'ready';
  if (issues.length) meta.listingPreparationIssues = issues;
  else delete meta.listingPreparationIssues;
  meta.categoryMappingStatus = ozonCategoryId && ozonTypeId ? 'manual_ready' : 'deferred_until_listing';

  return meta;
}

function nonNegativeIntegerValue(value: unknown): number | null {
  const number = numericValue(value);
  if (!(number != null && Number.isFinite(number) && number >= 0)) return null;
  return Math.trunc(number);
}

function sanitizeOfferIdSegment(value: unknown, fallback: string): string {
  const text = compactString(value)
    ?.replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return text || fallback;
}

function sourcePlatformOfferPrefix(sourcePlatform: unknown): string {
  const platformPart = sanitizeOfferIdSegment(sourcePlatform, 'source').toLowerCase().slice(0, 16);
  return platformPart === '1688' ? 'ss1688' : `ss${platformPart || 'source'}`;
}

function buildAlibaba1688DraftOfferId(
  sourcePlatform: unknown,
  sourceProductId: unknown,
  sourceSkuId: unknown,
  index: number,
): string {
  const prefix = sourcePlatformOfferPrefix(sourcePlatform);
  const productPart = sanitizeOfferIdSegment(sourceProductId, `item-${index + 1}`);
  const skuPart = sanitizeOfferIdSegment(sourceSkuId, `sku-${index + 1}`);
  return `${prefix}-${productPart}-${skuPart}`.slice(0, 100);
}

function appendOfferIdSuffix(offerId: string, suffixNumber: number): string {
  const suffix = `-${suffixNumber}`;
  return `${offerId.slice(0, Math.max(1, 100 - suffix.length))}${suffix}`;
}

function buildUniqueAlibaba1688DraftOfferIds(entries: Array<{
  sourcePlatform: unknown;
  sourceProductId: unknown;
  sourceSkuId: unknown;
  index: number;
}>) {
  const used = new Set<string>();
  const baseCounts = new Map<string, number>();
  return entries.map((entry) => {
    const base = buildAlibaba1688DraftOfferId(entry.sourcePlatform, entry.sourceProductId, entry.sourceSkuId, entry.index);
    let count = (baseCounts.get(base) || 0) + 1;
    let candidate = count === 1 ? base : appendOfferIdSuffix(base, count);
    while (used.has(candidate)) {
      count += 1;
      candidate = appendOfferIdSuffix(base, count);
    }
    baseCounts.set(base, count);
    used.add(candidate);
    return candidate;
  });
}

function getAlibaba1688FailedRetryKeys(metadata: Record<string, any>, listingStatus: string) {
  if (listingStatus !== 'partial_failed') return null;
  const resultItems = Array.isArray(metadata.lastListingResultItems) ? metadata.lastListingResultItems : [];
  const failedItems = resultItems.filter((item: any) => (
    String(item?.status || '').toLowerCase() === 'failed'
    || (Array.isArray(item?.errors) && item.errors.length > 0)
  ));
  if (!failedItems.length) return null;
  return {
    offerIds: new Set(failedItems.map((item: any) => compactString(item?.offerId)).filter(Boolean) as string[]),
    sourceSkuIds: new Set(failedItems
      .filter((item: any) => !compactString(item?.offerId))
      .map((item: any) => compactString(item?.sourceSkuId))
      .filter(Boolean) as string[]),
  };
}

export function buildAlibaba1688OzonListingDraftItems(item: {
  id: string;
  title: string;
  status?: string | null;
  sourceUrl?: string | null;
  sourcePlatform?: string | null;
  sourceProductId?: string | null;
  purchasePrice?: { toString(): string } | null;
  currency?: string | null;
  images?: unknown;
  variants?: unknown;
  notes?: string | null;
  metadata?: unknown;
  createdAt: Date;
}) {
  const prefill = buildAlibaba1688ListingPrefill(item);
  const listingStatus = getAlibaba1688ListingStatus(item);
  const blockedIssue = getAlibaba1688ListingBlockedIssue(item);
  if (blockedIssue) {
    return { items: [], issues: [blockedIssue], listingStatus };
  }

  const baseImages = parseImageList(
    (Array.isArray(prefill.images) ? prefill.images : []).map((image) => String(image || '')),
  );
  const issues = getAlibaba1688PreparationIssues({
    preparedTitleRu: prefill.preparedTitleRu,
    targetPriceCny: prefill.targetPriceCny,
    ozonCategoryId: prefill.ozonCategoryId,
    ozonTypeId: prefill.ozonTypeId,
  }, { hasImages: baseImages.length > 0 });

  if (issues.length) {
    return { items: [], issues, listingStatus };
  }

  const meta = (item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata))
    ? item.metadata as Record<string, any>
    : {};
  const retryKeys = getAlibaba1688FailedRetryKeys(meta, listingStatus);
  const title = String(prefill.preparedTitleRu || '').trim();
  const categoryId = positiveIntegerValue(prefill.ozonCategoryId)!;
  const typeId = positiveIntegerValue(prefill.ozonTypeId)!;
  const price = numericValue(prefill.targetPriceCny)!;
  const weight = positiveIntegerValue(meta.grossWeightGrams) || 500;
  const height = positiveIntegerValue(meta.heightMm) || 100;
  const depth = positiveIntegerValue(meta.lengthMm) || 100;
  const width = positiveIntegerValue(meta.widthMm) || 100;
  const allVariants = Array.isArray(prefill.variants) && prefill.variants.length
    ? prefill.variants as Array<Record<string, any>>
    : [null];
  const itemSourcePlatform = normalizeDomesticSupplySourcePlatform(prefill.sourcePlatform) || '1688';
  const variantEntries = allVariants.map((variant, index) => ({
    variant,
    index,
    sourcePlatform: normalizeDomesticSupplySourcePlatform(variant?.sourcePlatform, itemSourcePlatform) || itemSourcePlatform,
    sourceSkuId: compactString(variant?.sourceSkuId ?? variant?.sku) || compactString(prefill.sourceProductId) || `sku-${index + 1}`,
  }));
  const offerIds = buildUniqueAlibaba1688DraftOfferIds(variantEntries.map((entry) => ({
    sourcePlatform: entry.sourcePlatform,
    sourceProductId: prefill.sourceProductId || item.id,
    sourceSkuId: entry.sourceSkuId,
    index: entry.index,
  })));
  const variantEntriesWithOfferIds = variantEntries.map((entry, index) => ({
    ...entry,
    offerId: offerIds[index]!,
  }));
  const variants = retryKeys
    ? variantEntriesWithOfferIds.filter((entry) => {
      return retryKeys.offerIds.has(entry.offerId) || retryKeys.sourceSkuIds.has(entry.sourceSkuId);
    })
    : variantEntriesWithOfferIds;

  if (retryKeys && variants.length === 0) {
    return { items: [], issues: ['listing_retry_failed_items_not_found'], listingStatus };
  }

  const items = variants.map(({ variant, sourceSkuId, offerId }) => {
    const variantImages = parseImageList([
      ...(Array.isArray(variant?.images) ? variant.images : []),
      variant?.imageUrl,
      ...baseImages,
    ].map((image) => String(image || '')));
    const stock = nonNegativeIntegerValue(variant?.stock) ?? 0;
    const sourceTrace: Record<string, unknown> = {
      supplyGoodsId: item.id,
      sourcePlatform: normalizeDomesticSupplySourcePlatform(variant?.sourcePlatform, itemSourcePlatform) || itemSourcePlatform,
      sourceProductId: prefill.sourceProductId || null,
      sourceSkuId,
    };
    const ozonSku = compactString(variant?.ozonSku);
    const ozonProductId = compactString(variant?.ozonProductId);
    const ozonOfferId = compactString(variant?.ozonOfferId);
    if (ozonSku) sourceTrace.ozonSku = ozonSku;
    if (ozonProductId) sourceTrace.ozonProductId = ozonProductId;
    if (ozonOfferId) sourceTrace.ozonOfferId = ozonOfferId;

    return {
      offerId,
      title,
      description: compactString(meta.description) || '',
      categoryId,
      typeId,
      price,
      oldPrice: Math.ceil(price * 1.2),
      currency: 'CNY',
      stock,
      images: variantImages,
      weight,
      height,
      depth,
      width,
      sourceTrace,
    };
  });

  return { items, issues: [], listingStatus };
}

export async function collectRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  // 扩展查询：某 SKU 是否已被当前用户采集（用于 ozon.ru 列表页 overlay）
  app.get('/status', async (request, reply) => {
    const { userId } = (request as any).user;
    const query = request.query as { sku?: string; sourcePlatform?: string };
    const sku = String(query.sku || '').trim();
    if (!sku) {
      return reply.status(400).send({ code: 0, msg: '缺少 sku 参数' });
    }
    const goods = await prisma.supplyGoods.findFirst({
      where: buildCollectSnapshotWhere(userId, [sku], query.sourcePlatform),
      select: { id: true, title: true, status: true },
    });
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
    const body = request.body as { skus: string[]; sourcePlatform?: string };

    if (!body?.skus?.length) {
      return reply.status(400).send({ code: 0, msg: '缺少 skus 参数' });
    }

    const skus = Array.from(new Set(body.skus.map((sku) => String(sku || '').trim()).filter(Boolean))).slice(0, 100); // 限制最多 100 个
    if (!skus.length) {
      return reply.status(400).send({ code: 0, msg: '缺少 skus 参数' });
    }

    const records = await prisma.supplyGoods.findMany({
      where: buildCollectSnapshotWhere(userId, skus, body.sourcePlatform),
      select: {
        id: true,
        sourceProductId: true,
        sku: true,
        title: true,
        sourceUrl: true,
        status: true,
        createdAt: true,
        purchasePrice: true,
        images: true,
        metadata: true,
      },
    });

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
      },
    };
  });

  app.get('/', async (request) => {
    const { userId } = (request as any).user;
    const query = request.query as { status?: string; search?: string; sourcePlatform?: string; offset?: string; limit?: string };

    const where = buildCollectListWhere(userId, query);

    const offset = Math.max(0, Number(query.offset) || 0);
    const limit = Math.min(50, Math.max(1, Number(query.limit) || 20));

    const [total, rows] = await Promise.all([
      prisma.supplyGoods.count({ where: where as any }),
      prisma.supplyGoods.findMany({
        where: where as any,
        skip: offset,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      code: 1,
      msg: 'ok',
      data: {
        total,
        rows: rows.map((r) => ({
          ...r,
          purchasePrice: r.purchasePrice?.toString() ?? null,
          originalPrice: r.originalPrice?.toString() ?? null,
          exchangeRateUsed: r.exchangeRateUsed?.toString() ?? null,
          metadata: exposeSupplyGoodsMetadata(r.metadata, {
            sourcePlatform: r.sourcePlatform,
            images: r.images,
            purchasePrice: r.purchasePrice?.toString(),
            purchaseCurrency: r.currency,
            variants: r.variants,
          }),
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
    const sourceProductId = normalizeProductId(d.sourceProductId || d.sku);
    const weightNote = d.weightG ? `重量: ${d.weightG}g` : (d.weight ? `重量: ${d.weight}g` : '');
    const notes = [weightNote, d.description?.slice(0, 500)].filter(Boolean).join('\n') || null;
    const metadata: Record<string, unknown> = {};
    if (d.publishTitle) metadata.publishTitleRu = d.publishTitle;
    if (d.sourceTitleRaw) metadata.sourceTitleRaw = d.sourceTitleRaw;
    if (d.sourceLocale) metadata.sourceLocale = d.sourceLocale;
    if (d.title && containsCjkText(d.title) && !d.publishTitle) metadata.titleNeedsReview = true;

    const priceInfo = await resolveCollectedPrice(d.priceText || d.price, d.currency, d.sourceUrl);
    const item = await prisma.supplyGoods.create({
      data: {
        user: { connect: { id: userId } },
        title: d.title,
        sourceUrl: d.sourceUrl || null,
        sourcePlatform: normalizeCollectSourcePlatform(d.sourcePlatform),
        sourceProductId,
        sku: d.sku || sourceProductId,
        images: d.images || undefined,
        purchasePrice: priceInfo.purchasePriceCny,
        currency: 'CNY',
        originalPrice: priceInfo.originalPrice,
        originalCurrency: priceInfo.originalCurrency,
        exchangeRateUsed: priceInfo.exchangeRateUsed,
        priceNeedsReview: priceInfo.needsReview,
        notes,
        metadata: Object.keys(metadata).length ? (metadata as any) : undefined,
        status: 'collected',
      },
    });

    return reply.send({ code: 1, msg: '采集成功', data: { id: item.id } });
  });

  app.post('/1688', { bodyLimit: 5 * 1024 * 1024 }, async (request, reply) => {
    const { userId } = (request as any).user;
    const parsed = alibaba1688CollectSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    const normalized = buildAlibaba1688CollectRecord(parsed.data);
    const priceInfo = await resolveCollectedPrice(normalized.priceText || undefined, normalized.currency, normalized.sourceUrl || undefined);
    const metadata = {
      ...normalized.metadata,
      priceText: normalized.priceText,
      originalCurrency: priceInfo.originalCurrency,
      exchangeRateUsed: priceInfo.exchangeRateUsed,
      titleNeedsReview: true,
    };

    const item = await prisma.supplyGoods.create({
      data: {
        user: { connect: { id: userId } },
        title: normalized.title,
        sourceUrl: normalized.sourceUrl,
        sourcePlatform: normalized.sourcePlatform,
        sourceProductId: normalized.sourceProductId,
        sku: normalized.sku,
        images: normalized.images.length ? normalized.images : undefined,
        purchasePrice: priceInfo.purchasePriceCny,
        currency: 'CNY',
        originalPrice: priceInfo.originalPrice,
        originalCurrency: priceInfo.originalCurrency,
        exchangeRateUsed: priceInfo.exchangeRateUsed,
        priceNeedsReview: priceInfo.needsReview,
        notes: normalized.notes,
        metadata: metadata as any,
        variants: normalized.variants.length ? (normalized.variants as any) : undefined,
        status: 'collected',
      },
    });

    return reply.send({
      code: 1,
      msg: '货源商品已保存到采集记录，类目映射将在上架时处理',
      data: { id: item.id },
    });
  });

  app.post('/1688/prefill', async (request, reply) => {
    const { userId } = (request as any).user;
    const body = request.body as { ids?: string[] };
    const ids = Array.from(new Set((body?.ids || []).map((id) => String(id || '').trim()).filter(Boolean))).slice(0, 100);
    if (!ids.length) {
      const items = await prisma.supplyGoods.findMany({
        where: { userId, sourcePlatform: { in: DOMESTIC_SUPPLY_SOURCE_PLATFORMS_LIST } },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });

      return reply.send({
        code: 1,
        msg: 'ok',
        data: items.map((item) => buildAlibaba1688ListingPrefill(item)),
      });
    }

    const items = await prisma.supplyGoods.findMany({
      where: { id: { in: ids }, userId },
    });
    if (items.length !== ids.length) {
      return reply.status(404).send({ code: 0, msg: '部分采集记录不存在或无权限' });
    }
    const invalid = items.filter((it) => !isDomesticSupplySourcePlatform(it.sourcePlatform));
    if (invalid.length) {
      return reply.status(400).send({ code: 0, msg: '只能选择货源采集记录进入货源上架准备' });
    }

    const byId = new Map(items.map((it) => [it.id, it]));
    return reply.send({
      code: 1,
      msg: 'ok',
      data: ids.map((id) => buildAlibaba1688ListingPrefill(byId.get(id)!)),
    });
  });

  app.post('/1688/save-preparation', async (request, reply) => {
    const { userId } = (request as any).user;
    const body = request.body as {
      items?: Array<{
        id?: string;
        preparedTitleRu?: string;
        targetPriceCny?: string | number | null;
        ozonCategoryId?: string | number | null;
        ozonTypeId?: string | number | null;
        listingNotes?: string;
        images?: string[];
        purchasePrice?: string | number | null;
        description?: string | null;
        attributes?: Record<string, unknown> | null;
        attributesText?: string | null;
        variants?: Array<Record<string, unknown>> | null;
      }>;
    };
    const rows = (body?.items || []).filter((item) => item?.id).slice(0, 100);
    if (!rows.length) return reply.status(400).send({ code: 0, msg: '缺少要保存的商品' });

    const ids = Array.from(new Set(rows.map((row) => String(row.id))));
    const items = await prisma.supplyGoods.findMany({
      where: { id: { in: ids }, userId },
    });
    if (items.length !== ids.length) {
      return reply.status(404).send({ code: 0, msg: '部分采集记录不存在或无权限' });
    }
    if (items.some((item) => !isDomesticSupplySourcePlatform(item.sourcePlatform))) {
      return reply.status(400).send({ code: 0, msg: '只能保存货源采集记录的上架准备草稿' });
    }

    const byId = new Map(items.map((item) => [item.id, item]));
    let saved = 0;
    let ready = 0;
    let draft = 0;
    const updatedItems: ReturnType<typeof buildAlibaba1688ListingPrefill>[] = [];
    for (const row of rows) {
      const item = byId.get(String(row.id))!;
      const nextImages = normalizeAlibaba1688PreparationImages(row.images, item.images);
      const nextVariants = normalizeAlibaba1688PreparationVariants(row.variants, item.variants, {
        sourcePlatform: item.sourcePlatform,
      });
      const nextPurchasePriceRaw = row.purchasePrice !== undefined
        ? row.purchasePrice
        : item.purchasePrice?.toString();
      const nextPurchasePriceNumber = numericValue(nextPurchasePriceRaw);
      const nextPurchasePrice = nextPurchasePriceNumber != null && nextPurchasePriceNumber > 0
        ? Math.round(nextPurchasePriceNumber * 100) / 100
        : null;
      const preparationMeta = buildAlibaba1688PreparationMetadata(item.metadata, row, {
        hasImages: nextImages.length > 0,
      });
      const meta = refreshAlibaba1688SourceDataIssues(preparationMeta, {
        images: nextImages,
        purchasePrice: nextPurchasePrice,
        variants: nextVariants,
      });

      await prisma.supplyGoods.update({
        where: { id: item.id },
        data: {
          metadata: meta as any,
          images: nextImages.length ? nextImages as any : null as any,
          purchasePrice: nextPurchasePrice,
          variants: nextVariants.length ? nextVariants as any : null as any,
        },
      });
      saved++;
      if (meta.listingPreparationStatus === 'ready') ready++;
      else draft++;
      updatedItems.push(buildAlibaba1688ListingPrefill({
        ...item,
        images: nextImages,
        variants: nextVariants,
        purchasePrice: nextPurchasePrice == null ? null : { toString: () => String(nextPurchasePrice) },
        metadata: meta,
      }));
    }

    return reply.send({
      code: 1,
      msg: `已保存 ${saved} 条货源上架准备，${ready} 条准备完成，${draft} 条仍为草稿`,
      data: { saved, ready, draft, items: updatedItems },
    });
  });

  app.post('/1688/listing-drafts', async (request, reply) => {
    const { userId } = (request as any).user;
    const body = request.body as { ids?: string[] };
    const ids = Array.from(new Set((body?.ids || []).map((id) => String(id || '').trim()).filter(Boolean))).slice(0, 100);
    if (!ids.length) return reply.status(400).send({ code: 0, msg: '缺少要生成上架草稿的货源采集记录' });

    const items = await prisma.supplyGoods.findMany({
      where: { id: { in: ids }, userId, sourcePlatform: { in: DOMESTIC_SUPPLY_SOURCE_PLATFORMS_LIST } },
    });
    if (items.length !== ids.length) {
      return reply.status(404).send({ code: 0, msg: '部分采集记录不存在、无权限或不是货源采集记录' });
    }

    const byId = new Map(items.map((item) => [item.id, item]));
    const draftItems: any[] = [];
    const blocked: Array<{ id: string; title: string; issues: string[] }> = [];

    for (const id of ids) {
      const item = byId.get(id)!;
      const result = buildAlibaba1688OzonListingDraftItems(item);
      if (result.issues.length) {
        blocked.push({ id: item.id, title: item.title, issues: result.issues });
      } else {
        draftItems.push(...result.items);
      }
    }

    if (blocked.length) {
      const hasActiveListing = blocked.some((item) => item.issues.some((issue) => issue.startsWith('listing_already_')));
      return reply.status(400).send({
        code: 0,
        msg: hasActiveListing
          ? `${blocked.length} 条货源采集记录已提交、导入中或已上架成功，不能重复生成草稿`
          : `${blocked.length} 条货源采集记录尚未完成上架准备`,
        data: { items: draftItems, blocked },
      });
    }

    return reply.send({
      code: 1,
      msg: `已生成 ${draftItems.length} 条货源 Ozon 上架草稿`,
      data: { items: draftItems },
    });
  });

  app.post('/batch', { bodyLimit: 10 * 1024 * 1024 }, async (request, reply) => {
    const { userId } = (request as any).user;
    const body = request.body as { items: any[] };

    if (!body?.items?.length) {
      return reply.status(400).send({ code: 0, msg: '请提供商品数据' });
    }

    let saved = 0;
    const errors: { sku?: string; sourceProductId?: string; title?: string; error: string }[] = [];
    for (const item of body.items.slice(0, 50)) {
      try {
        const sourceProductId = normalizeProductId(item.sourceProductId || item.sku);
        const metadata: Record<string, unknown> = {};
        if (item.publishTitle) metadata.publishTitleRu = String(item.publishTitle);
        if (item.sourceTitleRaw) metadata.sourceTitleRaw = String(item.sourceTitleRaw);
        if (item.sourceLocale) metadata.sourceLocale = String(item.sourceLocale);
        if (item.title && containsCjkText(item.title) && !item.publishTitle) metadata.titleNeedsReview = true;
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
        // 调试用：未识别的 widget 全量 dump（扩展占位阶段使用）
        if (item.widgetStatesDump) metadata.widgetStatesDump = item.widgetStatesDump;

        const hasVariants = Array.isArray(item.variants) && item.variants.length > 0;
        console.log(`[batch-collect] SKU=${item.sku} | modelId=${item.modelId || 'none'} | variants=${hasVariants ? item.variants.length : 0} | ozonAttributes=${Array.isArray(item.ozonAttributes) ? item.ozonAttributes.length : 'NONE'}`);

        const priceInfo = await resolveCollectedPrice(item.priceText || item.price, item.currency, item.sourceUrl);

        await prisma.supplyGoods.create({
          data: {
            user: { connect: { id: userId } },
            title: item.title || '未命名商品',
            sourceUrl: item.sourceUrl || null,
            sourcePlatform: normalizeCollectSourcePlatform(item.sourcePlatform),
            sourceProductId,
            sku: item.sku || sourceProductId,
            images: item.images || undefined,
            purchasePrice: priceInfo.purchasePriceCny,
            currency: 'CNY',
            originalPrice: priceInfo.originalPrice,
            originalCurrency: priceInfo.originalCurrency,
            exchangeRateUsed: priceInfo.exchangeRateUsed,
            priceNeedsReview: priceInfo.needsReview,
            notes: item.description?.slice(0, 500) || null,
            metadata: Object.keys(metadata).length ? (metadata as any) : undefined,
            variants: hasVariants ? (item.variants as any) : undefined,
            modelId: item.modelId ? String(item.modelId) : null,
            status: 'collected',
          },
        });
        saved++;
      } catch (e: any) {
        const errMsg = (e?.message ? String(e.message) : '未知错误').slice(0, 300);
        console.error(`[batch-collect] failed sku=${item.sku || item.sourceProductId}:`, errMsg);
        errors.push({
          sku: item.sku ? String(item.sku) : undefined,
          sourceProductId: item.sourceProductId ? String(item.sourceProductId) : undefined,
          title: item.title ? String(item.title).slice(0, 100) : undefined,
          error: errMsg,
        });
      }
    }

    return reply.send({
      code: saved > 0 ? 1 : 0,
      msg: saved > 0
        ? (errors.length ? `成功采集 ${saved} 件商品，${errors.length} 件失败` : `成功采集 ${saved} 件商品`)
        : (errors.length ? `采集失败：${errors[0]!.error}` : '采集失败'),
      data: { saved, errors },
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
    if (body.publishTitle !== undefined) {
      const meta: Record<string, unknown> = item.metadata && typeof item.metadata === 'object' ? { ...(item.metadata as any) } : {};
      const publishTitle = String(body.publishTitle || '').trim();
      if (publishTitle) meta.publishTitleRu = publishTitle;
      else delete meta.publishTitleRu;
      data.metadata = meta as any;
    }

    await prisma.supplyGoods.update({ where: { id }, data: data as any });
    return reply.send({ code: 1, msg: '已更新' });
  });

  app.delete('/:id/variants/:sku', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id, sku } = request.params as { id: string; sku: string };

    const item = await prisma.supplyGoods.findFirst({ where: { id, userId } });
    if (!item) return reply.status(404).send({ code: 0, msg: '商品不存在' });

    const variants = Array.isArray(item.variants) ? (item.variants as any[]) : [];
    const before = variants.length;
    const next = variants.filter((v) => String(v?.sku || '') !== String(sku));
    if (next.length === before) {
      return reply.status(404).send({ code: 0, msg: '未找到该变体 SKU' });
    }

    await prisma.supplyGoods.update({
      where: { id },
      data: { variants: next.length ? (next as any) : null as any },
    });

    return reply.send({ code: 1, msg: '已删除变体', data: { count: next.length } });
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
      const variants = Array.isArray(it.variants) ? (it.variants as any[]) : [];
      const sourceImages = meta.watermarkedImages?.length
        ? meta.watermarkedImages
        : Array.isArray(it.images) ? (it.images as string[]) : [];
      return {
        id: it.id,
        title: it.title,
        description: it.notes || '',
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
        titleNeedsReview: !!meta.titleNeedsReview || containsCjkText(resolvePublishName(it)),
        modelId: it.modelId,
        categoryId: meta.descriptionCategoryId || null,
        typeId: meta.typeId || null,
        weightG: meta.weightG || 500,
        lengthMm: meta.lengthMm || 100,
        widthMm: meta.widthMm || 100,
        heightMm: meta.heightMm || 100,
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
      title?: string;
      description?: string;
      images?: string[];
      weightG?: number;
      lengthMm?: number;
      widthMm?: number;
      heightMm?: number;
      categoryId?: number;
      typeId?: number;
      publishTitle?: string;
      variants?: Array<{ sku: string; price?: string; stock?: number }>;
    };
    if (!body?.id) return reply.status(400).send({ code: 0, msg: '缺少 id' });

    const it = await prisma.supplyGoods.findFirst({ where: { id: body.id, userId } });
    if (!it) return reply.status(404).send({ code: 0, msg: '商品不存在或无权限' });

    const meta: any = (it.metadata as any) || {};
    if (body.weightG !== undefined) meta.weightG = body.weightG;
    if (body.lengthMm !== undefined) meta.lengthMm = body.lengthMm;
    if (body.widthMm !== undefined) meta.widthMm = body.widthMm;
    if (body.heightMm !== undefined) meta.heightMm = body.heightMm;
    if (body.categoryId !== undefined && body.categoryId > 0) meta.descriptionCategoryId = body.categoryId;
    if (body.typeId !== undefined && body.typeId > 0) meta.typeId = body.typeId;
    if (body.publishTitle !== undefined) {
      const publishTitle = String(body.publishTitle || '').trim();
      if (publishTitle) meta.publishTitleRu = publishTitle;
      else delete meta.publishTitleRu;
    }
    // images 优先级最高路径：写到 watermarkedImages，让 publish-ozon 用这个版本
    if (body.images?.length) meta.watermarkedImages = body.images;

    const updateData: any = { metadata: meta };
    if (body.title) updateData.title = body.title;
    if (body.description !== undefined) updateData.notes = body.description;

    // 变体价格/库存覆盖（保留原 attrs/sku）
    if (body.variants?.length) {
      const oldVariants = Array.isArray(it.variants) ? (it.variants as any[]) : [];
      const overrideMap = new Map(body.variants.map((v) => [v.sku, v]));
      updateData.variants = oldVariants.map((v) => {
        const o = overrideMap.get(v.sku);
        return o ? { ...v, ...(o.price !== undefined ? { price: o.price } : {}), ...(o.stock !== undefined ? { stock: o.stock } : {}) } : v;
      });
    }

    await prisma.supplyGoods.update({ where: { id: body.id }, data: updateData });
    return reply.send({ code: 1, msg: '已保存' });
  });

  app.post('/publish-ozon', { bodyLimit: 10 * 1024 * 1024 }, async (request, reply) => {
    const { userId } = (request as any).user;
    const body = request.body as {
      ids: string[];
      shopId: string;
      categoryId: number;
      typeId: number;
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
      warehouseId?: number;
      priceOverrides?: Record<string, Record<string | number, number>>;
      source?: 'collect-page' | 'listing-page';
    };

    if (!body?.ids?.length || !body.shopId) {
      return reply.status(400).send({ code: 0, msg: '请选择商品和目标店铺' });
    }
    if (!body.categoryId) {
      return reply.status(400).send({ code: 0, msg: '请选择商品分类（categoryId 必填）' });
    }
    if (!body.typeId) {
      return reply.status(400).send({ code: 0, msg: '请选择商品类型（typeId 必填）' });
    }

    const shop = await prisma.shop.findFirst({ where: { id: body.shopId, userId } });
    if (!shop || !shop.clientId || !shop.apiKeyEncrypted) {
      return reply.status(400).send({ code: 0, msg: '店铺配置不完整' });
    }

    const { OzonClient } = await import('../services/ozon-client.js');
    const { decrypt } = await import('../lib/crypto.js');
    const client = new OzonClient({ clientId: shop.clientId, apiKey: decrypt(shop.apiKeyEncrypted) });

    let items = await prisma.supplyGoods.findMany({
      where: { id: { in: body.ids }, userId },
    });

    if (!items.length) {
      return reply.send({ code: 0, msg: '未找到有效商品' });
    }

    const alibabaItems = items.filter((it) => isDomesticSupplySourcePlatform(it.sourcePlatform));
    if (alibabaItems.length) {
      const sample = alibabaItems.slice(0, 3).map((it) => it.title).join('、');
      return reply.status(400).send({
        code: 0,
        msg: `货源采集记录仅保存货源商品信息，不能走当前 Ozon 跟卖/复制接口。请先进入货源上架准备流程完成翻译、类目映射和属性生成：${sample}`,
      });
    }

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

    // 分流：有属性的走 /v3/product/import，没属性的走 /v1/product/import-by-sku (fallback)
    const withAttrs = items.filter((it) => {
      const meta = it.metadata as any;
      return meta?.ozonAttributes?.length;
    });
    const noAttrs = items.filter((it) => {
      const meta = it.metadata as any;
      return !meta?.ozonAttributes?.length;
    });

    const markupPct = body.markupPct ?? 200;
    const markupAmount = Number(body.markupAmount) || 0;
    const mode = body.mode === 'clone' ? 'clone' : 'follow';
    const followBrand = body.followBrand !== false;

    // ====== Fallback: 没属性的商品走 import-by-sku（继承源卡片）======
    let fallbackTaskId: number | null = null;
    let fallbackCount = 0;
    let fallbackError: string | null = null;
    if (noAttrs.length > 0) {
      // 收集 fallback：每个 SupplyGoods 如果有 variants[]，展开为 N 个跟卖 item；否则保持单 SKU
      const fallbackTrace: { offerId: string; sourceItemId: string; sourceVariantSku: string; variantAttrs: any }[] = [];
      const fallbackOfferImages: Record<string, string> = {};
      const fallbackItems = noAttrs
        .flatMap((item) => {
          const basePriceCny = parseFloat(body.price || item.purchasePrice?.toString() || '100');
          const priceWithMarkup = calcPublishPrice(basePriceCny, markupPct, markupAmount);
          const variants = Array.isArray(item.variants) ? (item.variants as any[]) : [];
          const itemOverrides = body.priceOverrides?.[item.id] || {};
          // variants[].price 是采集时的原币价（如 RUB），需要按采集时存的汇率换算 CNY
          const fxRate = item.originalCurrency && item.originalCurrency !== 'CNY' && item.exchangeRateUsed
            ? Number(item.exchangeRateUsed)
            : null;

          // 无 variants：保持原行为（1 条）
          if (!variants.length) {
            const sourceSku = item.sku && /^\d+$/.test(item.sku) ? Number(item.sku) : null;
            if (!sourceSku) return [];
            const offerId = `f${Date.now().toString(36)}${randomSuffix(4)}`;
            const firstImg = Array.isArray(item.images) && item.images.length ? String(item.images[0]) : '';
            if (firstImg) fallbackOfferImages[offerId] = firstImg;
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
          return variants
            .map((v, idx) => {
              const subSourceSku = v.sku && /^\d+$/.test(String(v.sku)) ? Number(v.sku) : null;
              if (!subSourceSku) return null;
              const overridePrice = getVariantOverridePrice(itemOverrides, v, idx);
              let subPrice: number;
              if (overridePrice != null) {
                subPrice = overridePrice;
              } else {
                const subPriceRaw = v.price != null && v.price !== '' ? parseFloat(String(v.price)) : null;
                // v.price 是原币（RUB），用采集汇率转成 CNY 后再 markup
                const subBaseCny = subPriceRaw && Number.isFinite(subPriceRaw)
                  ? (fxRate ? subPriceRaw * fxRate : subPriceRaw)
                  : null;
                subPrice = subBaseCny != null
                  ? calcPublishPrice(subBaseCny, markupPct, markupAmount)
                  : priceWithMarkup;
              }
              const offerId = `f${Date.now().toString(36)}${randomSuffix(4)}`;
              fallbackTrace.push({
                offerId,
                sourceItemId: item.id,
                sourceVariantSku: String(v.sku),
                variantAttrs: v.attrs || null,
              });
              const variantImg = Array.isArray(v.images) && v.images.length ? String(v.images[0]) : '';
              const itemImg = Array.isArray(item.images) && item.images.length ? String(item.images[0]) : '';
              const firstImg = variantImg || itemImg;
              if (firstImg) fallbackOfferImages[offerId] = firstImg;
              const subAttrs = v.attrs && typeof v.attrs === 'object' ? v.attrs as Record<string, string> : undefined;
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
        try {
          const fbResult = await client.importBySku(fallbackItems);
          fallbackTaskId = fbResult.result.task_id;
          fallbackCount = fallbackItems.length;
          const unmatched = fbResult.result.unmatched_sku_list || [];
          console.log(`[publish-ozon fallback] import-by-sku task_id=${fallbackTaskId}, count=${fallbackItems.length}, unmatched=${unmatched.length}`);
          if (unmatched.length) {
            fallbackError = `${unmatched.length} 件商品被源卖家禁止跟卖`;
          }

          // 轮询拿 product_id，然后上传采集的图片
          if (!unmatched.length) {
            await new Promise((r) => setTimeout(r, 3000));
            try {
              const info = await client.getImportInfo(fallbackTaskId);
              for (const it of info.items || []) {
                if (it.product_id && it.status === 'imported') {
                  const matchedItem = noAttrs.find((ni) => fallbackItems.some((fi) => fi && fi.offer_id === it.offer_id));
                  const matchedMeta = matchedItem ? (matchedItem.metadata as any) : null;
                  const rawImages = matchedMeta?.watermarkedImages?.length
                    ? matchedMeta.watermarkedImages
                    : matchedItem && Array.isArray(matchedItem.images) ? (matchedItem.images as string[]) : [];
                  if (rawImages.length) {
                    const resolvedImages = await resolveImageUrls(rawImages, body.shopId, userId);
                    await client.importProductPictures({ product_id: it.product_id, images: resolvedImages });
                    console.log(`[publish-ozon fallback] uploaded ${resolvedImages.length} images for product_id=${it.product_id}`);
                  }
                }
              }
            } catch (e: any) {
              console.warn(`[publish-ozon fallback] pictures upload failed:`, e.message?.slice(0, 150));
            }
          }

          for (const item of noAttrs) {
            await prisma.supplyGoods.update({ where: { id: item.id }, data: { status: 'listed' } });
          }

          // fallback 路径也写 SyncJob，便于后续追踪 6 个变体是否归到同一个商品卡片
          await prisma.syncJob.create({
            data: {
              shopId: body.shopId,
              type: 'PRODUCT_PUSH',
              status: 'RUNNING',
              startedAt: new Date(),
              payload: {
                taskId: fallbackTaskId,
                itemCount: fallbackItems.length,
                sourceItemCount: noAttrs.length,
                source: 'collect-publish-fallback',
                entry: body.source || 'collect-page',
                mode: 'follow-by-sku',
                followBrand,
                warehouseId: body.warehouseId ?? null,
                offerIds: fallbackItems.map((i) => i.offer_id),
                sourceSkus: noAttrs.map((i) => i.sku).filter(Boolean),
                offerImages: Object.keys(fallbackOfferImages).length ? fallbackOfferImages : null,
                variantTrace: fallbackTrace.length ? fallbackTrace : null,
              },
            },
          });
        } catch (e: any) {
          const detailMsg = getOzonPublishErrorMessage(e);
          fallbackError = detailMsg;
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
          data: { taskId: fallbackTaskId, count: fallbackCount, sourceCount, mode: 'follow-by-sku' },
        });
      }
      return reply.send({ code: 0, msg: '所有商品均缺少属性且无有效 SKU' });
    }

    // ====== 主路径：有属性的商品走 /v3/product/import ======
    items = withAttrs;

    // 跟卖和复制都走 /v3/product/import：创建新卡片但属性/图片继承源商品
    // 区别仅在 offer_id 命名策略：跟卖和复制都使用 {sku}-{rand}，避免重复冲突。
    const randomizeCfg = await getRandomizeConfig();
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
    function buildOfferId(sourceSku: string | null | undefined, fallback: string): string {
      const userPrefersRandom = body.randomOfferId !== false;
      if (randomizeCfg.enabled && randomizeCfg.randomOfferId && userPrefersRandom && sourceSku) {
        return randomOfferIdFrom(sourceSku);
      }
      return sourceSku ? `${sourceSku}-${randomSuffix(4)}` : fallback;
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
              description: item.notes || '',
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
              const description = descriptionMap.get(a.id) || (a.attributes?.find((x) => x.id === 4180)?.values?.[0]?.value) || '';
              const attributes = (a.attributes || [])
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
      const meta = item.metadata as any;
      const categoryId = body.categoryId || meta?.descriptionCategoryId;
      const typeId = body.typeId || meta?.typeId;
      const dims = getItemDimensions(item);
      const baseRawImages: string[] = meta?.watermarkedImages?.length
        ? meta.watermarkedImages
        : cloned?.images?.length ? cloned.images : (Array.isArray(item.images) ? (item.images as string[]) : []);
      const baseImages = await resolveImageUrls(baseRawImages, body.shopId, userId);
      // 已加水印时，变体不能再走自己的源图（变体 images 是 OZON 缩略图，没水印）
      const watermarkApplied = !!meta?.watermarkedImages?.length;

      const variants = Array.isArray(item.variants) ? (item.variants as any[]) : [];
      // 无 variants：保持原行为（1 个 item）
      if (!variants.length) {
        return [{
          name: resolvePublishName(item),
          offer_id: buildOfferId(item.sku, `import-${item.id}`),
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
          ...(cloned?.description ? { description: cloned.description } : {}),
          ...(cloned?.attributes?.length ? { attributes: cloned.attributes } : {}),
        }];
      }

      // 有 variants：每个 sub-SKU 展开为一条 import item
      // model_id 字段不主动声明，依赖 OZON 后端按源 model 自动归组（待实测验证）
      console.log(`[publish-ozon variants] item=${item.id} model=${item.modelId || 'none'} expand to ${variants.length} sub-SKUs`);
      const itemOverrides = body.priceOverrides?.[item.id] || {};
      const subItems = await Promise.all(variants.map(async (v: any, idx: number) => {
        // 价格优先级：前端单独覆盖（CNY） > 整组 priceWithMarkup（CNY）
        // v.price 是采集自源平台的原始币种（RUB），不能直接 ×markup 上架
        const overridePrice = getVariantOverridePrice(itemOverrides, v, idx);
        const subPrice = overridePrice ?? priceWithMarkup;
        const subSku = v.sku ? String(v.sku) : `${item.sku || item.id}-v${idx}`;
        const subImagesRaw: string[] = watermarkApplied
          ? baseRawImages
          : (Array.isArray(v.images) && v.images.length ? v.images : baseRawImages);
        const subImages = subImagesRaw === baseRawImages ? baseImages : await resolveImageUrls(subImagesRaw, body.shopId, userId);
        const subAttrs = v.attrs && typeof v.attrs === 'object' ? v.attrs as Record<string, string> : {};
        const subName = resolvePublishName(item, subAttrs);

        // === 优先用每个变体自己的 ozonAttributes（扩展端 Step 2 抓的）===
        // 没有时退化用 cloned（来自源 SKU 的共用属性）
        const variantAttrs = Array.isArray(v.ozonAttributes) && v.ozonAttributes.length
          ? convertOzonRawAttrs(v.ozonAttributes, followBrand)
          : null;
        const finalAttrs = variantAttrs && variantAttrs.length
          ? variantAttrs
          : (cloned?.attributes || []);

        // 维度：每个变体自己的 > 整组 dims
        const subWeight = (typeof v.weight === 'number' && v.weight > 0) ? v.weight : dims.weight;
        const subHeight = (typeof v.height === 'number' && v.height > 0) ? v.height : dims.height;
        const subDepth = (typeof v.depth === 'number' && v.depth > 0) ? v.depth : dims.depth;
        const subWidth = (typeof v.width === 'number' && v.width > 0) ? v.width : dims.width;

        return {
          name: subName,
          offer_id: buildOfferId(subSku, `${subSku}-${randomSuffix(4)}`),
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
          ...(cloned?.description ? { description: cloned.description } : {}),
          ...(finalAttrs.length ? { attributes: finalAttrs } : {}),
          // 自定义字段：变体属性（颜色/尺码等），等真实数据回流后映射成 OZON 真实 attribute_id
          _variantAttrs: subAttrs,
          _sourceItemId: item.id,
          _sourceModelId: item.modelId || null,
          _hasOwnAttrs: !!variantAttrs,
        };
      }));
      return subItems;
    }));
    importItems = nested.flat();
    } catch (e: any) {
      return reply.send({ code: 0, msg: `图片处理失败: ${e.message?.slice(0, 400) || '未知错误'}` });
    }

    // 查询目标分类的必填属性，补全缺失的制造商/品牌
    try {
      const categoryAttrs = await client.getDescriptionCategoryAttributes({
        description_category_id: body.categoryId,
        type_id: body.typeId,
        language: 'DEFAULT',
      });
      const allAttrs = categoryAttrs;
      const requiredAttrs = allAttrs.filter((a) => a.is_required);
      // 字典缓存：一次上品任务里同分类同属性只查一次（每个字典可能上千条值）
      const attrDictCache = new Map<string, { id: number; value: string; info: string; picture: string }[]>();
      const MANUFACTURER_NAMES = /производитель|manufacturer/i;
      const BRAND_NAMES = /бренд|brand/i;

      // 找品牌属性（不管是否 required，Ozon 实际都强制要求）
      const brandAttrDef = allAttrs.find((a) => BRAND_NAMES.test(a.name)) || allAttrs.find((a) => a.id === 85);
      const mfrAttrDef = requiredAttrs.find((a) => MANUFACTURER_NAMES.test(a.name));

      console.log(`[publish-ozon] category attrs: total=${allAttrs.length}, required=${requiredAttrs.length}, brand=${brandAttrDef?.id || 'NOT_FOUND'}, manufacturer=${mfrAttrDef?.id || 'NOT_FOUND'}`);

      // 预查品牌字典，找到 "Без бренда" 的真实 dictionary_value_id
      let noBrandDictId: number | null = null;
      if (brandAttrDef) {
        try {
          const brandValues = await client.getAttributeValues({
            description_category_id: body.categoryId,
            type_id: body.typeId,
            attribute_id: brandAttrDef.id,
          });
          const noBrand = brandValues.find((v) => /без бренда/i.test(v.value));
          if (noBrand) {
            noBrandDictId = noBrand.id;
            console.log(`[publish-ozon] found "Без бренда" dict_id=${noBrandDictId} for attr ${brandAttrDef.id}`);
          } else {
            console.warn(`[publish-ozon] "Без бренда" not found in brand dictionary (${brandValues.length} values)`);
          }
        } catch (e: any) {
          console.warn('[publish-ozon] failed to query brand dictionary:', e.message?.slice(0, 150));
        }
      }

      for (const importItem of importItems) {
        if (!importItem.attributes) importItem.attributes = [];
        // 深拷贝 cloned.attributes，避免多个 sub-SKU 共用同一个数组引用导致互相污染
        importItem.attributes = importItem.attributes.map((a: any) => ({
          ...a,
          values: Array.isArray(a.values) ? a.values.map((v: any) => ({ ...v })) : a.values,
        }));

        // === 关键：合并/区分逻辑（OZON 同卡片合并要求 颜色/尺码/颜色名称 至少一个不同）===
        // 1) attr 8292 "合并至一张卡片"：同 model 共用，让 OZON 把 sub-SKU 合并到一张卡片
        const MERGE_ATTR_ID = 8292;
        const mergeValue = importItem._sourceModelId || `model-${importItem._sourceItemId || 'group'}`;
        importItem.attributes = importItem.attributes.filter((a: any) => a.id !== MERGE_ATTR_ID);
        importItem.attributes.push({
          id: MERGE_ATTR_ID,
          complex_id: 0,
          values: [{ value: String(mergeValue), dictionary_value_id: 0 }],
        });
        // 2) attr 10097 "颜色名称"：每个 sub-SKU 唯一，作为变体合并的"区分锚"
        // 即使商品颜色（10096）相同 + 俄罗斯尺码（4295）相同，颜色名称不同 OZON 也允许合并
        const COLOR_NAME_ATTR_ID = 10097;
        importItem.attributes = importItem.attributes.filter((a: any) => a.id !== COLOR_NAME_ATTR_ID);
        importItem.attributes.push({
          id: COLOR_NAME_ATTR_ID,
          complex_id: 0,
          values: [{ value: String(importItem.offer_id), dictionary_value_id: 0 }],
        });

        const existingIds = new Set(importItem.attributes.map((a: any) => a.id));

        // 品牌：不管 is_required，只要缺失就注入
        if (brandAttrDef && !existingIds.has(brandAttrDef.id) && noBrandDictId) {
          importItem.attributes.push({ id: brandAttrDef.id, complex_id: 0, values: [{ value: 'Без бренда', dictionary_value_id: noBrandDictId }] });
          console.log(`[publish-ozon] injected "Без бренда" (dict_id=${noBrandDictId}) for attr ${brandAttrDef.id}`);
        }

        // 制造商：仅 required 时注入
        if (mfrAttrDef && !existingIds.has(mfrAttrDef.id)) {
          const placeholder = `manufacturer-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`;
          importItem.attributes.push({ id: mfrAttrDef.id, complex_id: 0, values: [{ value: placeholder, dictionary_value_id: 0 }] });
          console.log(`[publish-ozon] injected manufacturer placeholder for attr ${mfrAttrDef.id} (${mfrAttrDef.name})`);
        }

        // 变体属性：把 _variantAttrs (例如 {Цвет: "42687"}) 注入到对应 attribute_id 上
        // 这一步是为了让 OZON 把同 model 下的多个 sub-SKU 合并成一个商品卡片
        // 如果该变体已经有自己的 ozonAttributes（_hasOwnAttrs），则跳过此处稀疏字典替换，避免覆盖 OZON 直接返回的正确值
        const variantAttrs: Record<string, string> = importItem._variantAttrs || {};
        if (importItem._hasOwnAttrs) {
          console.log(`[publish-ozon variant] offer=${importItem.offer_id} already has its own ozonAttributes; skip _variantAttrs dict replace`);
        } else {
        for (const [aspectName, aspectValue] of Object.entries(variantAttrs)) {
          if (!aspectValue) continue;
          // 模糊匹配 aspectName → categoryAttr.name（OZON 可能写 "Цвет" 也可能写 "Цвет товара"）
          const aspectLower = aspectName.toLowerCase();
          const attrDef = allAttrs.find((a) => a.name && a.name.toLowerCase() === aspectLower)
            || allAttrs.find((a) => a.name && a.name.toLowerCase().includes(aspectLower))
            || allAttrs.find((a) => a.name && aspectLower.includes(a.name.toLowerCase()));
          if (!attrDef) {
            console.warn(`[publish-ozon variant] aspect "${aspectName}" not found in category attrs (offer ${importItem.offer_id})`);
            continue;
          }

          // 字典型属性：必须传正确的 dictionary_value_id（传 0 + value 文本会被 OZON 拒绝
          // "Проверьте значение. В личном кабинете выберите вариант из списка"）
          let dictValueId = 0;
          let resolvedValue = String(aspectValue); // 字典命中时改用字典里的标准值
          if (attrDef.dictionary_id && attrDef.dictionary_id > 0) {
            try {
              const dictKey = `${body.categoryId}:${body.typeId}:${attrDef.id}`;
              if (!attrDictCache.has(dictKey)) {
                const values = await client.getAttributeValues({
                  description_category_id: body.categoryId,
                  type_id: body.typeId,
                  attribute_id: attrDef.id,
                  language: 'DEFAULT',
                  limit: 5000,
                });
                attrDictCache.set(dictKey, values);
              }
              const dict = attrDictCache.get(dictKey)!;
              const targetLower = String(aspectValue).toLowerCase().trim();
              // 提取开头数字（"56 RU / 3XL" → "56"），用于尺码类字段精确匹配
              const numMatch = targetLower.match(/^(\d+)/);
              const numToken = numMatch ? numMatch[1] : null;
              // 优先级：精确匹配 > 数字精确匹配 > 字典值是 target 子串（短的优先匹配长的）> 倒包含
              const hit = dict.find((v) => v.value && v.value.toLowerCase() === targetLower)
                || (numToken ? dict.find((v) => v.value && v.value === numToken) : null)
                || dict.find((v) => v.value && v.value.toLowerCase().includes(targetLower))
                || dict.find((v) => v.value && targetLower.includes(v.value.toLowerCase()) && v.value.length >= 2); // 至少 2 字符避免误中"5"
              if (hit) {
                dictValueId = hit.id;
                resolvedValue = hit.value;
                console.log(`[publish-ozon variant] dict hit: attr#${attrDef.id} "${aspectValue}" → id=${hit.id} value="${hit.value}"`);
              } else {
                console.warn(`[publish-ozon variant] dict miss: attr#${attrDef.id}(${attrDef.name}) value="${aspectValue}" not in ${dict.length} dict entries — keep cloned value`);
              }
            } catch (e: any) {
              console.warn(`[publish-ozon variant] failed to query dict for attr#${attrDef.id}:`, e.message?.slice(0, 150));
            }
          }

          // 字典查询失败（dictValueId=0）时保留 cloned 值，避免替换为空字典 ID 触发 OZON 拒绝
          if (attrDef.dictionary_id && attrDef.dictionary_id > 0 && dictValueId === 0) {
            console.warn(`[publish-ozon variant] skip replace attr#${attrDef.id}(${attrDef.name}) value="${aspectValue}" because dict miss; keep cloned value`);
            continue;
          }
          importItem.attributes = importItem.attributes.filter((a: any) => a.id !== attrDef.id);
          importItem.attributes.push({
            id: attrDef.id,
            complex_id: 0,
            values: [{ value: resolvedValue, dictionary_value_id: dictValueId }],
          });
          console.log(`[publish-ozon variant] offer=${importItem.offer_id} attr#${attrDef.id}(${attrDef.name})="${aspectValue}" dict=${attrDef.dictionary_id} dict_value_id=${dictValueId}`);
        }
        } // 关闭 if(_hasOwnAttrs) ... else
      }
    } catch (e: any) {
      console.warn('[publish-ozon] failed to query category attributes:', e.message?.slice(0, 200));
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
      // 把诊断字段（_variantAttrs/_sourceItemId/_sourceModelId）抽出来留给 SyncJob，发给 OZON 的 payload 必须干净
      const variantTrace = importItems
        .filter((i) => i._sourceItemId || i._variantAttrs)
        .map((i) => ({
          offerId: i.offer_id,
          sourceItemId: i._sourceItemId || null,
          sourceModelId: i._sourceModelId || null,
          variantAttrs: i._variantAttrs || null,
        }));
      const cleanItems = importItems.map((i) => {
        const { _variantAttrs, _sourceItemId, _sourceModelId, _hasOwnAttrs, ...rest } = i;
        return rest;
      });

      const result = await client.importProducts(cleanItems);
      const taskId = result.result.task_id;

      const mainOfferImages: Record<string, string> = {};
      for (const it of cleanItems) {
        const firstImg = Array.isArray(it.images) && it.images.length ? String(it.images[0]) : '';
        if (firstImg) mainOfferImages[it.offer_id] = firstImg;
      }

      await prisma.syncJob.create({
        data: {
          shopId: body.shopId,
          type: 'PRODUCT_PUSH',
          status: 'RUNNING',
          startedAt: new Date(),
          payload: {
            taskId,
            itemCount: cleanItems.length,
            sourceItemCount: items.length,
            source: 'collect-publish',
            entry: body.source || 'collect-page',
            mode,
            followBrand,
            warehouseId: body.warehouseId ?? null,
            offerIds: cleanItems.map((i) => i.offer_id),
            sourceSkus: items.map((i) => i.sku).filter(Boolean),
            offerImages: Object.keys(mainOfferImages).length ? mainOfferImages : null,
            variantTrace: variantTrace.length ? variantTrace : null,
          },
        },
      });

      for (const item of items) {
        await prisma.supplyGoods.update({ where: { id: item.id }, data: { status: 'listed' } });
      }

      const variantNote = variantTrace.length ? `（含 ${variantTrace.length} 个子 SKU 展开）` : '';
      return reply.send({
        code: 1,
        msg: `已提交 ${cleanItems.length} 件商品${variantNote}（${mode === 'clone' ? '复制' : '跟卖'}）到 OZON，任务ID: ${taskId}`,
        data: { taskId, count: cleanItems.length, sourceCount: items.length, mode, followBrand, variantCount: variantTrace.length },
      });
    } catch (e: any) {
      const detailMsg = getOzonPublishErrorMessage(e);
      console.error(`[publish-ozon] /v3/product/import failed:`, getOzonPublishErrorLogContext(e));
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
    const body = request.body as {
      ids: string[];
      type: 'text' | 'image';
      text?: string;
      imageUrl?: string;
      position?: string;
      opacity?: number;
      fontSize?: number;
      fontColor?: string;
      scale?: number;
    };

    if (!body?.ids?.length) {
      return reply.status(400).send({ code: 0, msg: '请选择商品' });
    }

    const { processItemWatermarks } = await import('../services/watermark.js');
    const config: any = {
      type: body.type || 'text',
      text: body.text || 'SS ERP',
      imageUrl: body.imageUrl,
      position: body.position || 'bottom-right',
      opacity: body.opacity ?? 50,
      fontSize: body.fontSize,
      fontColor: body.fontColor,
      scale: body.scale,
    };

    const items = await prisma.supplyGoods.findMany({
      where: { id: { in: body.ids }, userId },
    });

    let processed = 0;
    let failed = 0;

    for (const item of items) {
      const images = Array.isArray(item.images) ? (item.images as string[]) : [];
      if (!images.length) {
        failed++;
        continue;
      }

      const result = await processItemWatermarks(images, item.id, config);
      failed += result.failed;

      // 存相对路径 /watermarked/xxx.jpg。发布时由 resolveImageUrls 上传到存储后端转为公网 URL。
      // 不要存 http://localhost:3001/... — OZON 拉不到本地服务。
      const relPaths = result.watermarkedImages.map((p) => {
        if (p.startsWith('/watermarked/') || p.startsWith('/uploads/')) return p;
        // 兼容历史数据：剥离 http://localhost:port 前缀
        const m = p.match(/^https?:\/\/localhost(?::\d+)?(\/.*)$/);
        if (m) return m[1]!;
        return p;
      });

      const existingMeta = (item.metadata as any) || {};
      await prisma.supplyGoods.update({
        where: { id: item.id },
        data: {
          metadata: { ...existingMeta, watermarkedImages: relPaths, watermarkApplied: true },
        },
      });
      processed++;
    }

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
