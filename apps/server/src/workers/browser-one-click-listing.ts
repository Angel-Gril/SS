import { Queue, Worker } from 'bullmq';
import { redisDisabled } from '../lib/redis.js';
import { connection } from '../lib/bullmq-connection.js';
import { registerWorker } from '../lib/worker-registry.js';
import { prisma } from '../lib/prisma.js';
import { signToken, storeSession } from '../lib/auth.js';
import { resolveCollectedPrice } from '../services/collect-pricing.js';
import { processWatermarkItemsWithConcurrency } from '../routes/collect.js';

const QUEUE_NAME = 'browser-one-click-listing';
const EPHEMERAL_LISTING_TTL_MS = 5 * 60 * 1000;

export const browserOneClickListingQueue: Queue | null = redisDisabled ? null : new Queue(QUEUE_NAME, { connection });

function objectRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
}

function positiveNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function finiteNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function firstFiniteNumber(row: Record<string, any>, keys: string[]): number | null {
  for (const key of keys) {
    const num = finiteNumber(row[key]);
    if (num != null) return num;
  }
  return null;
}

function rowImageList(row: Record<string, any>): string[] {
  const images = Array.isArray(row.images) ? row.images : [row.image, row.img, row.picture];
  return images.map((image) => String(image || '').trim()).filter(Boolean).slice(0, 15);
}

function rowTitle(row: Record<string, any>, sku: string): string {
  const title = String(row.title || row.name || '').replace(/\s+/g, ' ').trim();
  return title ? title.slice(0, 500) : `Ozon SKU ${sku}`;
}

function rowPriceInput(row: Record<string, any>, sku: string, publish: Record<string, any>): {
  price: string | undefined;
  currency: string | undefined;
} {
  const costs = objectRecord(publish.costs);
  const explicitCost = positiveNumber(costs[sku]) ?? positiveNumber(row.costCny) ?? positiveNumber(row.priceCny);
  if (explicitCost) return { price: String(explicitCost), currency: 'CNY' };
  const price = positiveNumber(row.pagePrice) ?? positiveNumber(row.priceRub) ?? positiveNumber(row.price);
  const currency = String(row.pagePriceCurrency || row.priceCurrency || row.currency || 'RUB').trim() || 'RUB';
  return { price: price ? String(price) : undefined, currency };
}

function assignIfPresent(target: Record<string, any>, key: string, value: unknown) {
  if (value === undefined || value === null || value === '') return;
  target[key] = value;
}

function buildBrowserOneClickOzonMetadata(row: Record<string, any>, jobId: string, payload: Record<string, any>, expiresAt: Date): Record<string, any> {
  const metadata: Record<string, any> = {
    ephemeralListing: true,
    ephemeralListingSource: String(payload.entry || 'browser-one-click-listing').slice(0, 120),
    ephemeralListingExpiresAt: expiresAt.toISOString(),
    browserOneClickJobId: jobId,
    sourceRow: row,
    pagePrice: row.pagePrice ?? row.priceRub ?? row.price ?? null,
    pagePriceCurrency: row.pagePriceCurrency || row.priceCurrency || row.currency || null,
    ozonMetrics: objectRecord(row.metrics),
  };
  assignIfPresent(metadata, 'ozonAttributes', Array.isArray(row.ozonAttributes) && row.ozonAttributes.length ? row.ozonAttributes : undefined);
  assignIfPresent(metadata, 'descriptionCategoryId', firstFiniteNumber(row, ['descriptionCategoryId', 'description_category_id', 'categoryId', 'category3Id']));
  assignIfPresent(metadata, 'typeId', firstFiniteNumber(row, ['typeId', 'descriptionTypeId', 'description_type_id']));
  assignIfPresent(metadata, 'weightG', firstFiniteNumber(row, ['weightG', 'weightGrams', 'grossWeightGrams', 'weight']));
  assignIfPresent(metadata, 'lengthMm', firstFiniteNumber(row, ['lengthMm', 'depth', 'length']));
  assignIfPresent(metadata, 'widthMm', firstFiniteNumber(row, ['widthMm', 'width']));
  assignIfPresent(metadata, 'heightMm', firstFiniteNumber(row, ['heightMm', 'height']));
  assignIfPresent(metadata, 'manufacturerName', row.manufacturerName || row.manufacturer);
  assignIfPresent(metadata, 'brandName', row.brandName || row.brand);
  assignIfPresent(metadata, 'sourceRichDescriptionJson', row.sourceRichDescriptionJson || row.richDescriptionJson);
  assignIfPresent(metadata, 'sourceDescriptionRu', row.sourceDescriptionRu || row.description);
  assignIfPresent(metadata, 'publishDescriptionRu', row.publishDescriptionRu);
  assignIfPresent(metadata, 'sourceVideos', Array.isArray(row.sourceVideos) && row.sourceVideos.length ? row.sourceVideos : undefined);
  assignIfPresent(metadata, 'widgetStatesDump', row.widgetStatesDump);
  assignIfPresent(metadata, 'selectedSku', row.selectedSku);
  return metadata;
}

async function mergeBrowserOneClickJobPayload(jobId: string, patch: Record<string, any>, status?: 'RUNNING' | 'SUCCESS' | 'FAILED', errorMessage?: string | null) {
  const current = await prisma.syncJob.findUnique({
    where: { id: jobId },
    select: { payload: true },
  });
  const payload = {
    ...objectRecord(current?.payload),
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await prisma.syncJob.update({
    where: { id: jobId },
    data: {
      ...(status ? { status } : {}),
      payload,
      ...(errorMessage !== undefined ? { errorMessage } : {}),
      ...(status === 'SUCCESS' || status === 'FAILED' ? { finishedAt: new Date() } : {}),
    },
  });
  return payload;
}

async function ensureBrowserOneClickSupplyGoods(job: any): Promise<string[]> {
  const payload = objectRecord(job.payload);
  const existingIds = stringList(payload.supplyGoodsIds).length
    ? stringList(payload.supplyGoodsIds)
    : stringList(payload.sourceItemIds);
  if (existingIds.length) {
    const existing = await prisma.supplyGoods.findMany({
      where: { id: { in: existingIds }, userId: job.shop.userId },
      select: { id: true },
    });
    if (existing.length === existingIds.length) return existingIds;
  }

  const sourceSkus = stringList(payload.sourceSkus);
  const productUrls = stringList(payload.productUrls);
  const rows: Record<string, any>[] = Array.isArray(payload.rows) ? payload.rows.map(objectRecord) : [];
  const publish = objectRecord(payload.publish);
  const rowEntries: Array<[string, Record<string, any>]> = [];
  for (const row of rows) {
    const sku = String(row.sku || row.productId || '').trim();
    if (sku) rowEntries.push([sku, row]);
  }
  const rowBySku = new Map<string, Record<string, any>>(rowEntries);
  const expiresAt = new Date(Date.now() + EPHEMERAL_LISTING_TTL_MS);
  const ids: string[] = [];

  await mergeBrowserOneClickJobPayload(job.id, { stage: 'collecting', itemCount: sourceSkus.length }, 'RUNNING', null);

  for (let index = 0; index < sourceSkus.length; index += 1) {
    const sku = sourceSkus[index]!;
    const row: Record<string, any> = rowBySku.get(sku) || {};
    const { price, currency } = rowPriceInput(row, sku, publish);
    const priceInfo = await resolveCollectedPrice(price, currency, productUrls[index] || row.sourceUrl);
    const images = rowImageList(row);
    const metadata = buildBrowserOneClickOzonMetadata(row, job.id, payload, expiresAt);
    const variants = Array.isArray(row.variants) && row.variants.length ? row.variants : undefined;
    const item = await prisma.supplyGoods.create({
      data: {
        user: { connect: { id: job.shop.userId } },
        title: rowTitle(row, sku),
        sourceUrl: String(row.sourceUrl || productUrls[index] || `https://www.ozon.ru/product/${sku}/`).trim(),
        sourcePlatform: 'ozon',
        sourceProductId: sku,
        sku,
        images: images.length ? images : undefined,
        purchasePrice: priceInfo.purchasePriceCny,
        currency: 'CNY',
        originalPrice: priceInfo.originalPrice,
        originalCurrency: priceInfo.originalCurrency,
        exchangeRateUsed: priceInfo.exchangeRateUsed,
        priceNeedsReview: priceInfo.needsReview,
        notes: String(row.description || row.categoryPath || row.salesSchema || '').slice(0, 500) || null,
        metadata: metadata as any,
        variants: variants as any,
        modelId: row.modelId ? String(row.modelId) : null,
        status: 'collected',
      },
    });
    ids.push(item.id);
  }

  await mergeBrowserOneClickJobPayload(job.id, { stage: 'collected', supplyGoodsIds: ids, collected: ids.length }, 'RUNNING', null);
  return ids;
}

async function applyBrowserOneClickWatermark(jobId: string, userId: string, ids: string[], watermark: Record<string, any>) {
  if (!ids.length || !watermark || !Object.keys(watermark).length) return null;
  await mergeBrowserOneClickJobPayload(jobId, { stage: 'watermarking', itemCount: ids.length }, 'RUNNING', null);
  const items = await prisma.supplyGoods.findMany({ where: { id: { in: ids }, userId } });
  const { processItemWatermarks } = await import('../services/watermark.js');
  const result = await processWatermarkItemsWithConcurrency(items, {
    type: watermark.type || 'text',
    text: watermark.text || 'SS ERP',
    imageUrl: watermark.imageUrl,
    position: watermark.position || 'bottom-right',
    opacity: watermark.opacity ?? 50,
    fontSize: watermark.fontSize,
    fontColor: watermark.fontColor,
    scale: watermark.scale,
  }, processItemWatermarks);
  if (result.failed > 0) {
    throw new Error(`水印处理失败（${result.failed} 张失败，已中断上架）`);
  }
  await mergeBrowserOneClickJobPayload(jobId, { stage: 'watermarked', watermark: result }, 'RUNNING', null);
  return result;
}

async function createInternalAuthToken(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });
  if (!user) throw new Error('任务所属用户不存在');
  const token = signToken({ userId: user.id, role: user.role }, '2h');
  await storeSession(user.id, token, 2 * 3600);
  return token;
}

function localApiBaseUrl(): string {
  const host = process.env.SERVER_HOST && process.env.SERVER_HOST !== '0.0.0.0'
    ? process.env.SERVER_HOST
    : '127.0.0.1';
  const port = Number(process.env.SERVER_PORT) || 3001;
  return process.env.INTERNAL_API_BASE_URL || `http://${host}:${port}`;
}

async function callPublishOzon(job: any, ids: string[]) {
  const payload = objectRecord(job.payload);
  const publish = objectRecord(payload.publish);
  await mergeBrowserOneClickJobPayload(job.id, { stage: 'publishing', itemCount: ids.length }, 'RUNNING', null);
  const token = await createInternalAuthToken(job.shop.userId);
  const response = await fetch(`${localApiBaseUrl()}/api/collect/publish-ozon`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=utf-8',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      ids,
      shopId: job.shopId,
      jobId: job.id,
      mode: publish.publishMode === 'clone' ? 'clone' : 'follow',
      followBrand: publish.followBrand === true,
      markupPct: Number(publish.markupPct) || 0,
      randomOfferId: publish.randomOfferId !== false,
      source: payload.entry === 'ozon-product-detail' ? 'ozon-product-detail-workbench' : 'batch-collect-page',
      ...(publish.categoryId ? { categoryId: Number(publish.categoryId) } : {}),
      ...(publish.typeId ? { typeId: Number(publish.typeId) } : {}),
    }),
  });
  const text = await response.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  if (!response.ok || !parsed || parsed.code === 0) {
    throw new Error(parsed?.msg || `ERP 上架失败: HTTP ${response.status} ${text.slice(0, 200)}`);
  }
  await mergeBrowserOneClickJobPayload(job.id, {
    stage: 'published',
    taskId: parsed.data?.taskId,
    publishResult: parsed.data || parsed,
  }, 'RUNNING', null);
  return parsed;
}

export async function runBrowserOneClickListingJob(syncJobId: string) {
  const job = await prisma.syncJob.findUnique({
    where: { id: syncJobId },
    include: { shop: { include: { user: { select: { id: true, role: true } } } } },
  });
  if (!job) throw new Error(`Browser one-click listing job ${syncJobId} not found`);
  const payload = objectRecord(job.payload);
  if (payload.source !== 'browser-one-click-listing' && payload.browserOneClickJob !== true) {
    return { skipped: true, reason: 'not-browser-one-click' };
  }
  if (job.status === 'SUCCESS' || job.status === 'FAILED' || payload.taskId) {
    return { skipped: true, status: job.status, taskId: payload.taskId };
  }

  try {
    const ids = await ensureBrowserOneClickSupplyGoods(job);
    if (!ids.length) throw new Error('没有可上架的 SKU 数据');
    const currentStage = String(payload.stage || '').trim();
    if (!['watermarked', 'publishing'].includes(currentStage) && !payload.publishSource) {
      await applyBrowserOneClickWatermark(job.id, job.shop.userId, ids, objectRecord(payload.watermark));
    }
    const published = await callPublishOzon(job, ids);
    return { ok: true, jobId: job.id, data: published.data };
  } catch (error: any) {
    const message = error?.message ? String(error.message) : String(error);
    const latest = await prisma.syncJob.findUnique({ where: { id: job.id }, select: { payload: true } });
    const failedStage = String(objectRecord(latest?.payload).stage || 'failed');
    await mergeBrowserOneClickJobPayload(job.id, {
      stage: failedStage === 'watermarking' ? 'watermark_failed' : failedStage === 'publishing' ? 'publish_failed' : 'collect_failed',
    }, 'FAILED', message);
    throw error;
  }
}

export async function addBrowserOneClickListingJob(syncJobId: string) {
  const id = String(syncJobId || '').trim();
  if (!id) throw new Error('缺少一键上架任务 ID');
  if (redisDisabled) {
    setTimeout(() => {
      runBrowserOneClickListingJob(id).catch((error) => {
        console.error(`[browser-one-click-listing inline] ${id} failed:`, error?.message || error);
      });
    }, 0).unref();
    return { id: `inline-${Date.now()}`, syncJobId: id };
  }
  const job = await browserOneClickListingQueue!.add('publish', { syncJobId: id }, {
    jobId: id,
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 50,
    removeOnFail: 20,
  });
  return { id: job.id, syncJobId: id };
}

export function startBrowserOneClickListingWorker() {
  if (redisDisabled) {
    console.log('[browser-one-click-listing] REDIS_DISABLED=1, worker queue disabled; jobs run inline from API');
    return null;
  }
  const worker = new Worker(QUEUE_NAME, async (job) => {
    return await runBrowserOneClickListingJob(String(job.data?.syncJobId || ''));
  }, {
    connection,
    concurrency: Math.max(1, Number(process.env.BROWSER_ONE_CLICK_LISTING_CONCURRENCY) || 2),
  });
  worker.on('failed', (job, error) => {
    console.error(`[browser-one-click-listing] job ${job?.id || 'unknown'} failed:`, error?.message || error);
  });
  registerWorker(worker);
  console.log('[browser-one-click-listing] worker started');
  return worker;
}
