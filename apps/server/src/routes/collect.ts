import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { getRandomizeConfig, randomOfferIdFrom, jitterDimensionMm, bucketWeightG } from '../lib/randomize.js';
import { randomSuffix, chunkArray } from '../lib/util.js';
import { resolveCollectedPrice } from '../services/collect-pricing.js';
import { normalizeOzonPublishImageUrl, resolveImageUrls } from '../services/ozon-image-resolver.js';
import { convertOzonRawAttrs } from '../services/ozon-attributes.js';
import { enqueueProductSyncAfterPublish } from '../services/post-publish-sync.js';

const CJK_TEXT_RE = /[\u3400-\u9fff]/;

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

const batchDeleteVariantsSchema = z.object({
  skus: z.array(z.string().min(1)).min(1).max(100),
});

export function containsCjkText(value: unknown): boolean {
  return CJK_TEXT_RE.test(String(value || ''));
}

const TITLE_STOP_WORDS = new Set(['для', 'в', 'на', 'и', 'с', 'со', 'по', 'из', 'от', 'к']);

export function hasSuspiciousPublishName(value: unknown): boolean {
  const text = String(value || '').trim();
  if (!text) return false;
  const words = text
    .toLocaleLowerCase('ru-RU')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !TITLE_STOP_WORDS.has(word));

  if (words.length < 2) return false;
  for (let i = 0; i < words.length - 1; i += 1) {
    if (words[i] === words[i + 1]) return true;
  }
  const first = words[0];
  return !!first && words.slice(1, 5).includes(first);
}

export function cleanPublishName(value: unknown): string {
  const text = String(value || '')
    .normalize('NFKC')
    .replace(/[\s,;:|/]+/g, ' ')
    .trim();
  if (!text) return '';

  const words: string[] = [];
  let previousKey = '';
  for (const rawWord of text.split(/\s+/)) {
    const word = rawWord.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (!word) continue;
    const key = word.toLocaleLowerCase('ru-RU').replace(/[^\p{L}\p{N}]+/gu, '');
    if (key && key === previousKey) continue;
    words.push(word);
    previousKey = key || '';
  }
  return words.join(' ').trim();
}

function normalizeVariantTitleParts(variantAttrs?: Record<string, string>, includeColorLabel = false): string {
  if (!variantAttrs || !Object.keys(variantAttrs).length) return '';
  const parts: string[] = [];
  for (const [rawName, rawValue] of Object.entries(variantAttrs)) {
    const value = cleanPublishName(rawValue);
    if (!value) continue;
    if (includeColorLabel && /цвет|color/i.test(rawName)) parts.push(`${value} цвет`);
    else parts.push(value);
  }
  return cleanPublishName(parts.join(' '));
}

function shortenSpammyPublishName(base: string, variantText: string): string {
  const cleanBase = cleanPublishName(base);
  if (/автовизитк/i.test(cleanBase)) {
    return cleanPublishName(`Автовизитка для автомобиля ${variantText}`);
  }

  if (!hasSuspiciousPublishName(cleanBase)) {
    return cleanPublishName(`${cleanBase} ${variantText}`);
  }

  const phrase = String(base || '')
    .split(/[,;|]+/)
    .map((part) => cleanPublishName(part))
    .find((part) => part && !containsCjkText(part) && part.length >= 4);
  const fallback = cleanBase.split(/\s+/).slice(0, 5).join(' ');
  return cleanPublishName(`${phrase || fallback} ${variantText}`);
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
  const cleanBase = cleanPublishName(base);
  const shouldShorten = /автовизитк/i.test(cleanBase) || hasSuspiciousPublishName(cleanBase);
  const attrText = normalizeVariantTitleParts(variantAttrs, shouldShorten);
  return shortenSpammyPublishName(base, attrText).slice(0, 200);
}

export function syncOzonTitleAttribute<T extends { id: number; complex_id?: number; values: any[] }>(
  attributes: T[] | null | undefined,
  title: string,
): Array<T | { id: number; complex_id: number; values: { value: string }[] }> {
  const cleanTitle = cleanPublishName(title).slice(0, 200);
  const attrs = Array.isArray(attributes) ? attributes.filter((attr) => Number(attr.id) !== 4180) : [];
  if (!cleanTitle) return attrs;
  return [
    ...attrs,
    {
      id: 4180,
      complex_id: 0,
      values: [{ value: cleanTitle }],
    },
  ];
}

function metadataRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function normalizePublishImageList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    let image = String(raw || '').trim();
    if (!image) continue;
    if (/^(https?:)?\/\//i.test(image)) {
      try {
        image = normalizeOzonPublishImageUrl(image);
      } catch {
        // Keep the original value so the publish resolver can return the existing validation error.
      }
    }
    if (seen.has(image)) continue;
    seen.add(image);
    out.push(image);
  }
  return out;
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
  if (customOrWatermarked.length) return customOrWatermarked;
  const cloned = normalizePublishImageList(clonedImages);
  if (cloned.length) return cloned;
  return normalizePublishImageList(item.images);
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
  return variantImages.length ? mergePublishImageLists(variantImages, baseImages) : baseImages;
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

export function recordOfferPublishImages(
  offerImageLists: Record<string, string[]>,
  offerImages: Record<string, string>,
  offerId: string,
  images: unknown,
): void {
  const normalizedImages = normalizePublishImageList(images);
  if (!offerId || !normalizedImages.length) return;
  offerImageLists[offerId] = normalizedImages;
  offerImages[offerId] = normalizedImages[0]!;
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
    const normalized = normalizePublishImageList(images);
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
    if (String(item?.status || '').toLowerCase() === 'listed') {
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
  for (const item of items) {
    const variants = Array.isArray(item.variants) ? item.variants as any[] : [];
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

export async function collectRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  // 扩展查询：某 SKU 是否已被当前用户采集（用于 ozon.ru 列表页 overlay）
  app.get('/status', async (request, reply) => {
    const { userId } = (request as any).user;
    const query = request.query as { sku?: string };
    const sku = String(query.sku || '').trim();
    if (!sku) {
      return reply.status(400).send({ code: 0, msg: '缺少 sku 参数' });
    }
    const goods = await prisma.supplyGoods.findFirst({
      where: {
        userId,
        OR: [
          { sku },
          { sourceProductId: sku },
        ],
      },
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
    const body = request.body as { skus: string[] };

    if (!body?.skus?.length) {
      return reply.status(400).send({ code: 0, msg: '缺少 skus 参数' });
    }

    const skus = Array.from(new Set(body.skus.map((sku) => String(sku || '').trim()).filter(Boolean))).slice(0, 100); // 限制最多 100 个
    if (!skus.length) {
      return reply.status(400).send({ code: 0, msg: '缺少 skus 参数' });
    }

    const records = await prisma.supplyGoods.findMany({
      where: {
        userId,
        OR: [
          { sourceProductId: { in: skus } },
          { sku: { in: skus } },
        ],
      },
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
        dimensionJitterMm: cfg.dimensionJitterMm,
        dimensionMinMm: cfg.dimensionMinMm,
        weightBuckets: cfg.weightBuckets.map(([min, max]) => `${min}-${max}`).join(','),
      },
    };
  });

  app.get('/', async (request) => {
    const { userId } = (request as any).user;
    const query = request.query as { status?: string; search?: string; offset?: string; limit?: string };

    const where: Record<string, unknown> = { userId };
    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { sku: { contains: query.search, mode: 'insensitive' } },
        { sourceProductId: { contains: query.search, mode: 'insensitive' } },
      ];
    }

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
        sourcePlatform: d.sourcePlatform || 'ozon',
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
            sourcePlatform: item.sourcePlatform || 'ozon',
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
    if (body.publishTitle !== undefined || body.publishOfferId !== undefined) {
      const meta: Record<string, unknown> = item.metadata && typeof item.metadata === 'object' ? { ...(item.metadata as any) } : {};
      if (body.publishTitle !== undefined) {
        const publishTitle = String(body.publishTitle || '').trim();
        if (publishTitle) meta.publishTitleRu = publishTitle;
        else delete meta.publishTitleRu;
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
      publishOfferId?: string;
      variants?: Array<{ sku: string; price?: string; stock?: number; publishOfferId?: string }>;
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
    if (body.publishOfferId !== undefined) {
      const publishOfferId = String(body.publishOfferId || '').trim();
      if (publishOfferId) meta.publishOfferId = publishOfferId;
      else delete meta.publishOfferId;
    }
    // 历史字段名叫 watermarkedImages；这里实际表示改款表单确认后的商品级发布图片。
    // publish-ozon 会把变体封面排在它前面，避免多 SKU 主图被商品级图片覆盖。
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
        if (!o) return v;
        const next = { ...v };
        if (o.price !== undefined) next.price = o.price;
        if (o.stock !== undefined) next.stock = o.stock;
        if (o.publishOfferId !== undefined) {
          const publishOfferId = String(o.publishOfferId || '').trim();
          if (publishOfferId) next.publishOfferId = publishOfferId;
          else delete next.publishOfferId;
        }
        return next;
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
      source?: 'collect-page' | 'listing-page' | 'batch-collect-page';
      forceRecreate?: boolean;
    };

    if (!body?.ids?.length || !body.shopId) {
      return reply.status(400).send({ code: 0, msg: '请选择商品和目标店铺' });
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
    if (noAttrs.length && body.forceRecreate !== true) {
      const recentFallbackJobs = await prisma.syncJob.findMany({
        where: {
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
    if (noAttrs.length > 0) {
      // 收集 fallback：每个 SupplyGoods 如果有 variants[]，展开为 N 个跟卖 item；否则保持单 SKU
      const fallbackTrace: { offerId: string; sourceItemId: string; sourceVariantSku: string; variantAttrs: any }[] = [];
      const fallbackOfferImages: Record<string, string> = {};
      const fallbackOfferImageLists: Record<string, string[]> = {};
      const fallbackPictureUploads: any[] = [];
      let fallbackPictureUploadError: string | null = null;
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
            const offerId = buildOfferId(item.sku, `f${Date.now().toString(36)}${randomSuffix(4)}`, getItemCustomOfferId(item));
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
              const offerId = buildOfferId(String(v.sku), `f${Date.now().toString(36)}${randomSuffix(4)}`, getVariantCustomOfferId(item, v, idx));
              fallbackTrace.push({
                offerId,
                sourceItemId: item.id,
                sourceVariantSku: String(v.sku),
                variantAttrs: v.attrs || null,
              });
              const rawImages = resolveVariantPublishImages(item, v, baseRawImages);
              recordOfferPublishImages(fallbackOfferImageLists, fallbackOfferImages, offerId, rawImages);
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
                sourceItemIds: noAttrs.map((i) => i.id),
                sourceSkus: noAttrs.map((i) => i.sku).filter(Boolean),
                offerImages: Object.keys(fallbackOfferImages).length ? fallbackOfferImages : null,
                offerImageLists: Object.keys(fallbackOfferImageLists).length ? fallbackOfferImageLists : null,
                pictureUploads: fallbackPictureUploads.length ? fallbackPictureUploads : null,
                pictureUploadFailedCount: fallbackPictureUploads.filter((it) => it.status === 'failed').length,
                pictureUploadStatus: fallbackPictureUploadError
                  ? 'failed'
                  : fallbackPictureUploads.length
                    ? (fallbackPictureUploads.some((it) => it.status === 'failed' || it.status === 'skipped') ? 'failed' : 'success')
                    : 'pending',
                pictureUploadError: fallbackPictureUploadError,
                variantTrace: fallbackTrace.length ? fallbackTrace : null,
              },
            },
          });
          void enqueueProductSyncAfterPublish(body.shopId, 'collect-publish-fallback');
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
    // 区别仅在 offer_id 命名策略：跟卖用 {sku}-{rand}，复制用 {sku}-{rand}（与企鹅店长一致）
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
      const { categoryId, typeId } = resolveItemPublishCategory(item, body.categoryId, body.typeId, preferItemCategory);
      const dims = getItemDimensions(item);
      const baseRawImages = resolveBasePublishImages(item, cloned?.images);
      const baseImages = await resolveImageUrls(baseRawImages, body.shopId, userId);

      const variants = Array.isArray(item.variants) ? (item.variants as any[]) : [];
      // 无 variants：保持原行为（1 个 item）
      if (!variants.length) {
        const itemName = resolvePublishName(item);
        const itemAttrs = cloned?.attributes?.length
          ? syncOzonTitleAttribute(cloned.attributes, itemName)
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
          ...(cloned?.description ? { description: cloned.description } : {}),
          ...(itemAttrs.length ? { attributes: itemAttrs } : {}),
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
        const subImagesRaw = resolveVariantPublishImages(item, v, baseRawImages);
        const subImages = sameStringList(subImagesRaw, baseRawImages)
          ? baseImages
          : await resolveImageUrls(subImagesRaw, body.shopId, userId);
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
        const publishAttrs = finalAttrs.length ? syncOzonTitleAttribute(finalAttrs, subName) : [];

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
          ...(cloned?.description ? { description: cloned.description } : {}),
          ...(publishAttrs.length ? { attributes: publishAttrs } : {}),
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

    // 按每个 payload item 自己的类目补属性，避免批量多类目上架时第一类目污染整批。
    const attrDictCache = new Map<string, { id: number; value: string; info: string; picture: string }[]>();
    const MANUFACTURER_NAMES = /производитель|manufacturer/i;
    const BRAND_NAMES = /бренд|brand/i;
    for (const group of groupPublishItemsByCategory(importItems)) {
      try {
        const categoryAttrs = await client.getDescriptionCategoryAttributes({
          description_category_id: group.categoryId,
          type_id: group.typeId,
          language: 'DEFAULT',
        });
        const allAttrs = categoryAttrs;
        const requiredAttrs = allAttrs.filter((a) => a.is_required);

        const brandAttrDef = allAttrs.find((a) => BRAND_NAMES.test(a.name)) || allAttrs.find((a) => a.id === 85);
        const mfrAttrDef = requiredAttrs.find((a) => MANUFACTURER_NAMES.test(a.name));

        console.log(`[publish-ozon] category attrs ${group.categoryId}/${group.typeId}: total=${allAttrs.length}, required=${requiredAttrs.length}, brand=${brandAttrDef?.id || 'NOT_FOUND'}, manufacturer=${mfrAttrDef?.id || 'NOT_FOUND'}`);

        let noBrandDictId: number | null = null;
        if (brandAttrDef) {
          try {
            const brandValues = await client.getAttributeValues({
              description_category_id: group.categoryId,
              type_id: group.typeId,
              attribute_id: brandAttrDef.id,
            });
            const noBrand = brandValues.find((v) => /без бренда/i.test(v.value));
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

        for (const importItem of group.items) {
          if (!importItem.attributes) importItem.attributes = [];
          // 深拷贝 cloned.attributes，避免多个 sub-SKU 共用同一个数组引用导致互相污染
          importItem.attributes = importItem.attributes.map((a: any) => ({
            ...a,
            values: Array.isArray(a.values) ? a.values.map((v: any) => ({ ...v })) : a.values,
          }));

          const MERGE_ATTR_ID = 8292;
          const mergeValue = importItem._sourceModelId || `model-${importItem._sourceItemId || 'group'}`;
          importItem.attributes = importItem.attributes.filter((a: any) => a.id !== MERGE_ATTR_ID);
          importItem.attributes.push({
            id: MERGE_ATTR_ID,
            complex_id: 0,
            values: [{ value: String(mergeValue), dictionary_value_id: 0 }],
          });

          const COLOR_NAME_ATTR_ID = 10097;
          importItem.attributes = importItem.attributes.filter((a: any) => a.id !== COLOR_NAME_ATTR_ID);
          importItem.attributes.push({
            id: COLOR_NAME_ATTR_ID,
            complex_id: 0,
            values: [{ value: String(importItem.offer_id), dictionary_value_id: 0 }],
          });

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

          const variantAttrs: Record<string, string> = importItem._variantAttrs || {};
          if (importItem._hasOwnAttrs) {
            console.log(`[publish-ozon variant] offer=${importItem.offer_id} already has its own ozonAttributes; skip _variantAttrs dict replace`);
          } else {
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

              let dictValueId = 0;
              let resolvedValue = String(aspectValue);
              if (attrDef.dictionary_id && attrDef.dictionary_id > 0) {
                try {
                  const dictKey = `${group.categoryId}:${group.typeId}:${attrDef.id}`;
                  if (!attrDictCache.has(dictKey)) {
                    const values = await client.getAttributeValues({
                      description_category_id: group.categoryId,
                      type_id: group.typeId,
                      attribute_id: attrDef.id,
                      language: 'DEFAULT',
                      limit: 5000,
                    });
                    attrDictCache.set(dictKey, values);
                  }
                  const dict = attrDictCache.get(dictKey)!;
                  const targetLower = String(aspectValue).toLowerCase().trim();
                  const numMatch = targetLower.match(/^(\d+)/);
                  const numToken = numMatch ? numMatch[1] : null;
                  const hit = dict.find((v) => v.value && v.value.toLowerCase() === targetLower)
                    || (numToken ? dict.find((v) => v.value && v.value === numToken) : null)
                    || dict.find((v) => v.value && v.value.toLowerCase().includes(targetLower))
                    || dict.find((v) => v.value && targetLower.includes(v.value.toLowerCase()) && v.value.length >= 2);
                  if (hit) {
                    dictValueId = hit.id;
                    resolvedValue = hit.value;
                    console.log(`[publish-ozon variant] dict hit: attr#${attrDef.id} "${aspectValue}" -> id=${hit.id} value="${hit.value}" category=${group.categoryId}/${group.typeId}`);
                  } else {
                    console.warn(`[publish-ozon variant] dict miss: attr#${attrDef.id}(${attrDef.name}) value="${aspectValue}" not in ${dict.length} dict entries; keep cloned value`);
                  }
                } catch (e: any) {
                  console.warn(`[publish-ozon variant] failed to query dict for attr#${attrDef.id} category=${group.categoryId}/${group.typeId}:`, e.message?.slice(0, 150));
                }
              }

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
              console.log(`[publish-ozon variant] offer=${importItem.offer_id} attr#${attrDef.id}(${attrDef.name})="${aspectValue}" dict=${attrDef.dictionary_id} dict_value_id=${dictValueId} category=${group.categoryId}/${group.typeId}`);
            }
          }
        }
      } catch (e: any) {
        console.warn(`[publish-ozon] failed to query category attributes ${group.categoryId}/${group.typeId}:`, e.message?.slice(0, 200));
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
      void enqueueProductSyncAfterPublish(body.shopId, 'collect-publish');

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
