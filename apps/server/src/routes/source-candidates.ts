import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { authenticate } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { transferSourceProductImages } from '../services/source-image-transfer.js';

type JsonRecord = Record<string, any>;

const syncSchema = z.object({
  ozon: z.record(z.any()).optional(),
  ozonProduct: z.record(z.any()).optional(),
  sourceProduct: z.record(z.any()).optional(),
  source: z.record(z.any()).optional(),
  product: z.record(z.any()).optional(),
  quote: z.record(z.any()).optional(),
  costCny: z.any().optional(),
  status: z.string().optional(),
  key: z.string().optional(),
});

function toText(value: unknown): string {
  return value == null ? '' : String(value);
}

function normalizeUrl(value: unknown): string {
  let text = toText(value).trim();
  if (!text) return '';
  if (text.startsWith('//')) text = 'https:' + text;
  return text.split('#')[0]!.replace(/\/+$/, '');
}

function parseMoney(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 100) / 100;
  const text = toText(value).replace(/[\u00a0\u202f\s']/g, '');
  const match = text.match(/[-+]?\d[\d.,]*/);
  if (!match) return 0;
  let cleaned = match[0]!;
  const comma = cleaned.lastIndexOf(',');
  const dot = cleaned.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    cleaned = comma > dot ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned.replace(/,/g, '');
  } else if (comma >= 0) {
    const decimals = cleaned.length - comma - 1;
    cleaned = decimals > 0 && decimals <= 2 ? cleaned.replace(',', '.') : cleaned.replace(/,/g, '');
  } else if (dot >= 0) {
    const decimals = cleaned.length - dot - 1;
    if (!(decimals > 0 && decimals <= 2)) cleaned = cleaned.replace(/\./g, '');
  }
  const number = Number(cleaned);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

function optionalMoney(value: unknown): number | null {
  const amount = parseMoney(value);
  return amount || value === 0 || value === '0' ? amount : null;
}

function uniqueUrls(value: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const append = (entry: unknown) => {
    if (Array.isArray(entry)) {
      entry.forEach(append);
      return;
    }
    const url = normalizeUrl(entry);
    if (!/^https?:\/\//i.test(url) || seen.has(url)) return;
    seen.add(url);
    out.push(url);
  };
  append(value);
  return out.slice(0, 100);
}

function normalizeCurrency(value: unknown, fallback: string): string {
  const text = toText(value || fallback).trim().toUpperCase();
  if (['RMB', '￥', '¥', '元', '人民币'].includes(text)) return 'CNY';
  if (['RUR', 'РУБ', '₽', '卢布'].includes(text)) return 'RUB';
  return text || fallback;
}

function parseOzonProductId(value: unknown): string {
  const text = toText(value).trim();
  if (/^[0-9]{6,}$/.test(text)) return text;
  const path = text.split(/[?#]/)[0] || '';
  const match = path.match(/(?:-|\/)([0-9]{6,})\/?$/i);
  return match ? match[1]! : '';
}

function normalizeOzonProduct(input: unknown) {
  const product = input && typeof input === 'object' ? input as JsonRecord : {};
  const price = product.price && typeof product.price === 'object' ? product.price as JsonRecord : {};
  const url = normalizeUrl(product.url || product.sourceUrl || product.tabUrl);
  const productId = toText(product.productId || product.sku || parseOzonProductId(url)).trim();
  const costingInputPriceCny = optionalMoney(product.costingInputPriceCny ?? product.priceRMB ?? product.priceCny ?? product.pagePriceCny);
  const priceValue = costingInputPriceCny ?? parseMoney(product.pagePriceValue ?? product.currentPriceValue ?? price.value ?? product.price);
  const currency = costingInputPriceCny != null ? 'CNY' : normalizeCurrency(product.pagePriceCurrency || price.currency || product.currency, 'RUB');
  return {
    productId,
    url,
    title: toText(product.title || product.sourceTitleRaw || product.name).trim(),
    priceValue,
    currency,
    raw: product,
  };
}

function normalizePlatform(input: unknown): string {
  const text = toText(input).trim().toLowerCase();
  if (text === 'pdd' || text.includes('pinduoduo') || text.includes('yangkeduo') || text.includes('拼多多')) return 'pinduoduo';
  if (text.includes('1688')) return '1688';
  if (text.includes('taobao') || text.includes('淘宝')) return 'taobao';
  if (text.includes('tmall') || text.includes('天猫')) return 'tmall';
  return text || 'source';
}

function inferSourceProductId(product: JsonRecord, url: string): string {
  const explicit = toText(product.sourceProductId || product.productId || product.goodsId || product.offerId || product.itemId).trim();
  if (explicit) return explicit;
  const match = url.match(/[?&](?:goods_id|id|itemId|item_id|offerId|offer_id)=(\d+)/i)
    || url.match(/\/(?:offer|goods|item)\/?(\d+)/i)
    || url.match(/\/(\d+)\.html/i);
  return match ? match[1]! : '';
}

function inferSelectedSku(product: JsonRecord): JsonRecord {
  const selected = product.selectedSku && typeof product.selectedSku === 'object' ? product.selectedSku as JsonRecord : {};
  const skuItems = Array.isArray(product.skuItems) ? product.skuItems as JsonRecord[] : [];
  return Object.keys(selected).length ? selected : (skuItems[0] || {});
}

function inferSourceSku(product: JsonRecord): string {
  const selected = inferSelectedSku(product);
  return toText(
    selected.skuId
    || selected.sku
    || selected.id
    || selected.name
    || selected.specText
    || product.sourceSku
    || product.sku
    || product.skuId
    || product.selectedSkuId,
  ).trim();
}

function inferSkuAttributes(product: JsonRecord): JsonRecord {
  const selected = inferSelectedSku(product);
  if (selected.attrs && typeof selected.attrs === 'object' && !Array.isArray(selected.attrs)) return { ...selected.attrs };
  const selectedText = toText(selected.name || selected.specText || selected.spec).trim();
  if (selectedText) return { spec: selectedText };
  const attrs = product.selectedSkuAttributes || product.skuAttributes;
  if (attrs && typeof attrs === 'object' && !Array.isArray(attrs)) return { ...(attrs as JsonRecord) };
  return {};
}

function normalizeSourceProduct(input: unknown) {
  const product = input && typeof input === 'object' ? input as JsonRecord : {};
  const url = normalizeUrl(product.sourceUrl || product.url || product.tabUrl);
  const host = (() => {
    try { return new URL(url).hostname; } catch { return ''; }
  })();
  const platform = normalizePlatform(product.sourcePlatform || product.platform || product.sourceHost || host);
  const selectedSku = inferSelectedSku(product);
  const productId = inferSourceProductId(product, url);
  const sku = inferSourceSku(product);
  const selectedPrice = selectedSku.price ?? selectedSku.priceCny;
  const unitPriceCny = parseMoney(product.priceCny ?? product.unitPriceCny ?? selectedPrice ?? product.price ?? product.priceText);
  const shippingCny = optionalMoney(product.shippingCny ?? product.freightCny ?? product.shippingFee ?? product.freightFee) ?? 0;
  const explicitTotal = optionalMoney(product.totalCostCny ?? product.purchaseCostCny ?? product.landedCostCny);
  const totalCostCny = explicitTotal ?? Math.round((unitPriceCny + shippingCny) * 100) / 100;
  const skuItems = Array.isArray(product.skuItems) ? product.skuItems.slice(0, 100) : [];
  return {
    platform,
    productId,
    sku,
    skuAttributes: inferSkuAttributes(product),
    selectedSku,
    url,
    title: toText(product.title || product.sourceTitleRaw || product.publishTitle || product.name).trim(),
    shopName: toText(product.shopName || product.supplier || product.shop).trim(),
    unitPriceCny,
    shippingCny,
    totalCostCny,
    priceText: toText(product.priceText || selectedSku.priceText || (unitPriceCny ? `¥${unitPriceCny}` : '')).trim(),
    priceSourceType: toText(product.priceSourceType).trim(),
    currency: normalizeCurrency(product.currency || product.priceCurrency, 'CNY'),
    images: uniqueUrls(product.images || product.imageUrls || product.image || product.mainImage),
    skuItems,
    grossWeightGrams: Number(product.grossWeightGrams || product.weightG) || null,
    lengthMm: Number(product.lengthMm) || null,
    widthMm: Number(product.widthMm) || null,
    heightMm: Number(product.heightMm) || null,
    raw: product,
  };
}

function normalizeQuote(input: unknown, source: ReturnType<typeof normalizeSourceProduct>) {
  const quote = input && typeof input === 'object' ? input as JsonRecord : {};
  const result = quote.result && typeof quote.result === 'object' ? quote.result as JsonRecord : {};
  return {
    status: toText(quote.status || 'selected_for_costing').trim() || 'selected_for_costing',
    costCny: parseMoney(quote.costCny ?? source.totalCostCny ?? source.unitPriceCny),
    profitCny: optionalMoney(quote.profitCny ?? result.profitCny ?? result.profit),
    marginPct: optionalMoney(quote.marginPct ?? result.marginPct),
    payload: quote,
  };
}

function buildCandidateKey(ozon: ReturnType<typeof normalizeOzonProduct>, source: ReturnType<typeof normalizeSourceProduct>, explicit?: unknown): string {
  const provided = toText(explicit).trim();
  if (provided) return provided;
  const ozonPart = ozon.productId || (ozon.url ? `url:${encodeURIComponent(ozon.url)}` : 'unknown-ozon');
  const sourcePart = source.productId || (source.url ? `url:${encodeURIComponent(source.url)}` : 'manual-source');
  return [ozonPart, source.platform || 'source', sourcePart, source.sku || 'default'].join('|');
}

export function normalizeSourceCandidateSyncPayload(input: unknown) {
  const payload = input && typeof input === 'object' ? input as JsonRecord : {};
  const quotePayload = payload.quote && typeof payload.quote === 'object' ? payload.quote as JsonRecord : {};
  const ozon = normalizeOzonProduct(payload.ozon || payload.ozonProduct || quotePayload.ozon);
  const source = normalizeSourceProduct(payload.sourceProduct || payload.source || payload.product || quotePayload.source);
  const quote = normalizeQuote({ ...quotePayload, costCny: payload.costCny ?? quotePayload.costCny, status: payload.status ?? quotePayload.status }, source);
  const key = buildCandidateKey(ozon, source, payload.key || quotePayload.key);
  return {
    ozon,
    source,
    quote,
    candidate: {
      key,
      metadata: {
        selectedSku: source.selectedSku,
        skuAttributes: source.skuAttributes,
        skuItems: source.skuItems,
        rawSourceProduct: source.raw,
        rawOzonProduct: ozon.raw,
      },
    },
  };
}

function csvEscape(value: unknown): string {
  const text = value instanceof Date ? value.toISOString() : toText(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function exportSourceQuotesCsv(rowsInput: unknown[]): string {
  const rows = Array.isArray(rowsInput) ? rowsInput as JsonRecord[] : [];
  const header = [
    'ozonSku',
    'ozonUrl',
    'ozonTitle',
    'ozonCostingInputPriceCny',
    'sourcePlatform',
    'sourceProductId',
    'sourceSku',
    'sourceUrl',
    'sourceTitle',
    'purchaseCostCny',
    'sourceUnitPrice',
    'sourceShippingCny',
    'status',
    'createdAt',
    'updatedAt',
  ];
  return [
    header.join(','),
    ...rows.map((row) => [
      row.ozonProductId ?? row.ozon_product_id,
      row.ozonUrl ?? row.ozon_url,
      row.ozonTitle ?? row.ozon_title,
      row.ozonPrice ?? row.ozon_price,
      row.sourcePlatform ?? row.source_platform,
      row.sourceProductId ?? row.source_product_id,
      row.sourceSku ?? row.source_sku,
      row.sourceUrl ?? row.source_url,
      row.sourceTitle ?? row.source_title,
      row.costCny ?? row.cost_cny,
      row.sourceUnitPrice ?? row.source_unit_price,
      row.sourceShippingCny ?? row.source_shipping_cny,
      row.status,
      row.createdAt ?? row.created_at,
      row.updatedAt ?? row.updated_at,
    ].map(csvEscape).join(',')),
  ].join('\n');
}

function jsonb(value: unknown) {
  return Prisma.sql`CAST(${JSON.stringify(value ?? {})} AS jsonb)`;
}

async function upsertSupplyGoods(userId: string, source: ReturnType<typeof normalizeSourceProduct>) {
  let existing: { id: string } | null = null;
  if (source.productId && source.sku) {
    existing = await prisma.supplyGoods.findFirst({
      where: {
        userId,
        sourcePlatform: source.platform,
        sourceProductId: source.productId,
        sku: source.sku,
      },
      select: { id: true },
    });
  }
  if (!existing) {
    const lookupOr: Record<string, unknown>[] = [];
    if (!source.sku && source.productId) lookupOr.push({ sourceProductId: source.productId });
    if (!source.productId && source.sku) lookupOr.push({ sku: source.sku });
    if (!source.productId && !source.sku && source.url) lookupOr.push({ sourceUrl: source.url });
    existing = lookupOr.length
      ? await prisma.supplyGoods.findFirst({
          where: {
            userId,
            sourcePlatform: source.platform,
            OR: lookupOr as any,
          },
          select: { id: true },
        })
      : null;
  }
  const imageTransfer = await transferSourceProductImages({ images: source.images, sourcePlatform: source.platform, userId });
  const metadata: Record<string, unknown> = {
    sourceCandidateSynced: true,
    selectedSku: source.selectedSku,
    skuAttributes: source.skuAttributes,
    skuItems: source.skuItems,
    shippingCny: source.shippingCny,
    totalCostCny: source.totalCostCny,
    priceSourceType: source.priceSourceType,
    grossWeightGrams: source.grossWeightGrams,
    lengthMm: source.lengthMm,
    widthMm: source.widthMm,
    heightMm: source.heightMm,
    rawSourceProduct: source.raw,
  };
  if (imageTransfer.diagnostic) metadata.sourceImageTransfer = imageTransfer.diagnostic;
  const data = {
    title: source.title || '未命名货源',
    sourceUrl: source.url || null,
    sourcePlatform: source.platform,
    sourceProductId: source.productId || null,
    supplier: source.shopName || null,
    purchasePrice: source.totalCostCny || source.unitPriceCny || null,
    currency: 'CNY',
    originalPrice: source.unitPriceCny || null,
    originalCurrency: source.currency || 'CNY',
    exchangeRateUsed: 1,
    priceNeedsReview: false,
    sku: source.sku || source.productId || null,
    images: imageTransfer.images.length ? imageTransfer.images as any : undefined,
    variants: source.skuItems.length ? source.skuItems as any : undefined,
    metadata: metadata as any,
    status: 'collected',
  };
  if (existing) {
    return prisma.supplyGoods.update({
      where: { id: existing.id },
      data,
      select: { id: true },
    });
  }
  return prisma.supplyGoods.create({
    data: {
      ...data,
      user: { connect: { id: userId } },
    },
    select: { id: true },
  });
}

export async function sourceCandidateRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.post('/sync', { bodyLimit: 10 * 1024 * 1024 }, async (request, reply) => {
    const { userId } = (request as any).user;
    const parsed = syncSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message || '参数错误' });
    const normalized = normalizeSourceCandidateSyncPayload(parsed.data);
    if (!normalized.ozon.productId && !normalized.ozon.url) return reply.status(400).send({ code: 0, msg: '缺少 Ozon 商品信息' });
    if (!normalized.source.productId && !normalized.source.url) return reply.status(400).send({ code: 0, msg: '缺少货源商品信息' });

    const supplyGoods = await upsertSupplyGoods(userId, normalized.source);
    const candidateId = randomUUID();
    const quoteId = randomUUID();
    const metadata = normalized.candidate.metadata;
    const quotePayload = {
      ...normalized.quote.payload,
      normalized: {
        ozon: normalized.ozon,
        source: normalized.source,
        quote: normalized.quote,
      },
    };

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO "source_candidates" (
          "id", "user_id", "key", "ozon_product_id", "ozon_url", "ozon_title", "ozon_price", "ozon_currency",
          "supply_goods_id", "source_platform", "source_product_id", "source_sku", "source_url", "source_title",
          "source_shop_name", "source_price", "source_shipping", "source_total_cost", "metadata", "created_at", "updated_at"
        ) VALUES (
          ${candidateId}, ${userId}, ${normalized.candidate.key}, ${normalized.ozon.productId || null}, ${normalized.ozon.url || null},
          ${normalized.ozon.title || null}, ${normalized.ozon.priceValue || null}, ${normalized.ozon.currency},
          ${supplyGoods.id}, ${normalized.source.platform}, ${normalized.source.productId || null}, ${normalized.source.sku || null},
          ${normalized.source.url || null}, ${normalized.source.title || null}, ${normalized.source.shopName || null},
          ${normalized.source.unitPriceCny || null}, ${normalized.source.shippingCny}, ${normalized.source.totalCostCny || null},
          ${jsonb(metadata)}, NOW(), NOW()
        )
        ON CONFLICT ("user_id", "key") DO UPDATE SET
          "ozon_product_id" = EXCLUDED."ozon_product_id",
          "ozon_url" = EXCLUDED."ozon_url",
          "ozon_title" = EXCLUDED."ozon_title",
          "ozon_price" = EXCLUDED."ozon_price",
          "ozon_currency" = EXCLUDED."ozon_currency",
          "supply_goods_id" = EXCLUDED."supply_goods_id",
          "source_platform" = EXCLUDED."source_platform",
          "source_product_id" = EXCLUDED."source_product_id",
          "source_sku" = EXCLUDED."source_sku",
          "source_url" = EXCLUDED."source_url",
          "source_title" = EXCLUDED."source_title",
          "source_shop_name" = EXCLUDED."source_shop_name",
          "source_price" = EXCLUDED."source_price",
          "source_shipping" = EXCLUDED."source_shipping",
          "source_total_cost" = EXCLUDED."source_total_cost",
          "metadata" = EXCLUDED."metadata",
          "updated_at" = NOW()
      `;
      const candidateRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "source_candidates" WHERE "user_id" = ${userId} AND "key" = ${normalized.candidate.key} LIMIT 1
      `;
      const persistedCandidateId = candidateRows[0]?.id || candidateId;
      await tx.$executeRaw`
        INSERT INTO "source_quotes" (
          "id", "user_id", "candidate_id", "supply_goods_id", "key", "status",
          "ozon_product_id", "ozon_url", "ozon_title", "ozon_price", "ozon_currency",
          "source_platform", "source_product_id", "source_sku", "source_url", "source_title",
          "cost_cny", "source_unit_price", "source_shipping_cny", "profit_cny", "margin_pct",
          "quote_payload", "created_at", "updated_at"
        ) VALUES (
          ${quoteId}, ${userId}, ${persistedCandidateId}, ${supplyGoods.id}, ${normalized.candidate.key}, ${normalized.quote.status},
          ${normalized.ozon.productId || null}, ${normalized.ozon.url || null}, ${normalized.ozon.title || null},
          ${normalized.ozon.priceValue || null}, ${normalized.ozon.currency},
          ${normalized.source.platform}, ${normalized.source.productId || null}, ${normalized.source.sku || null},
          ${normalized.source.url || null}, ${normalized.source.title || null},
          ${normalized.quote.costCny || null}, ${normalized.source.unitPriceCny || null}, ${normalized.source.shippingCny},
          ${normalized.quote.profitCny}, ${normalized.quote.marginPct}, ${jsonb(quotePayload)}, NOW(), NOW()
        )
        ON CONFLICT ("user_id", "key") DO UPDATE SET
          "candidate_id" = EXCLUDED."candidate_id",
          "supply_goods_id" = EXCLUDED."supply_goods_id",
          "status" = EXCLUDED."status",
          "ozon_product_id" = EXCLUDED."ozon_product_id",
          "ozon_url" = EXCLUDED."ozon_url",
          "ozon_title" = EXCLUDED."ozon_title",
          "ozon_price" = EXCLUDED."ozon_price",
          "ozon_currency" = EXCLUDED."ozon_currency",
          "source_platform" = EXCLUDED."source_platform",
          "source_product_id" = EXCLUDED."source_product_id",
          "source_sku" = EXCLUDED."source_sku",
          "source_url" = EXCLUDED."source_url",
          "source_title" = EXCLUDED."source_title",
          "cost_cny" = EXCLUDED."cost_cny",
          "source_unit_price" = EXCLUDED."source_unit_price",
          "source_shipping_cny" = EXCLUDED."source_shipping_cny",
          "profit_cny" = EXCLUDED."profit_cny",
          "margin_pct" = EXCLUDED."margin_pct",
          "quote_payload" = EXCLUDED."quote_payload",
          "updated_at" = NOW()
      `;
    });

    return reply.send({
      code: 1,
      msg: '货源候选和核价记录已同步到 ERP',
      data: {
        supplyGoodsId: supplyGoods.id,
        key: normalized.candidate.key,
      },
    });
  });

  app.get('/quotes/export', async (request) => {
    const { userId } = (request as any).user;
    const rows = await prisma.$queryRaw<JsonRecord[]>`
      SELECT
        "ozon_product_id", "ozon_url", "ozon_title", "ozon_price",
        "source_platform", "source_product_id", "source_sku", "source_url", "source_title",
        "cost_cny", "source_unit_price", "source_shipping_cny", "status", "created_at", "updated_at"
      FROM "source_quotes"
      WHERE "user_id" = ${userId}
      ORDER BY "updated_at" DESC
      LIMIT 500
    `;
    return {
      code: 1,
      msg: 'ok',
      data: {
        filename: 'ss-erp-source-quotes.csv',
        mimeType: 'text/csv;charset=utf-8',
        count: rows.length,
        content: exportSourceQuotesCsv(rows),
      },
    };
  });
}
