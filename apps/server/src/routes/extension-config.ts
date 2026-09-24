import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getRuntimeConfig, getRuntimeConfigForStorage } from '../adapters/runtime-config.js';
import { authenticate } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import {
  createPrismaProductSelectionRuleRepository,
  productSelectionRuleSchema,
  toggleProductSelectionRuleSchema,
} from '../services/product-selection-rule.js';

const syncCookieSchema = z.object({
  shopId: z.string().min(1),
  cookie: z.string().min(1),
  companyId: z.union([z.string(), z.number()]).optional(),
});

const productSelectionPoolItemSchema = z.object({
  platform: z.string().trim().max(40).optional(),
  sku: z.union([z.string(), z.number()]),
  productId: z.union([z.string(), z.number()]).optional(),
  product_id: z.union([z.string(), z.number()]).optional(),
  title: z.string().trim().max(500).optional(),
  url: z.string().trim().max(1000).optional(),
  image: z.string().trim().max(1000).optional(),
  priceRub: z.union([z.string(), z.number()]).optional(),
  price_rub: z.union([z.string(), z.number()]).optional(),
  currency: z.string().trim().max(12).optional(),
  source: z.string().trim().max(80).optional(),
  ruleIds: z.array(z.union([z.string(), z.number()])).optional(),
  rule_ids: z.array(z.union([z.string(), z.number()])).optional(),
  tags: z.array(z.string()).optional(),
  metrics: z.record(z.any()).optional(),
  note: z.string().trim().max(1000).optional(),
}).passthrough();

const productSelectionPoolStatusSchema = z.object({
  platform: z.string().trim().max(40).optional(),
  skus: z.array(z.union([z.string(), z.number()])).max(500),
});

const productSelectionPoolListQuerySchema = z.object({
  platform: z.string().trim().max(40).optional(),
  q: z.string().trim().max(120).optional(),
  tag: z.string().trim().max(80).optional(),
  ruleId: z.string().trim().max(100).optional(),
  status: z.string().trim().max(40).optional(),
  source: z.string().trim().max(80).optional(),
  page: z.union([z.string(), z.number()]).optional(),
  pageSize: z.union([z.string(), z.number()]).optional(),
}).passthrough();

function jsonb(value: unknown) {
  return Prisma.sql`CAST(${JSON.stringify(value ?? {})} AS jsonb)`;
}

function jsonbArray(value: unknown) {
  return Prisma.sql`CAST(${JSON.stringify(Array.isArray(value) ? value : [])} AS jsonb)`;
}

function normalizeProductSelectionPoolText(value: unknown, maxLength: number): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeProductSelectionPoolPlatform(value: unknown): string {
  return normalizeProductSelectionPoolText(value || 'ozon', 40).toLowerCase() || 'ozon';
}

function normalizeProductSelectionPoolSku(value: unknown): string {
  return normalizeProductSelectionPoolText(value, 80);
}

function normalizeProductSelectionPoolNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'string' ? Number(value.replace(/[^\d.,-]/g, '').replace(',', '.')) : Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeProductSelectionPoolStringArray(value: unknown, maxItems = 20): string[] {
  const input = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  return input
    .map((item) => normalizeProductSelectionPoolText(item, 80))
    .filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    })
    .slice(0, maxItems);
}

function compactProductSelectionPoolMetric(value: unknown): unknown {
  if (value == null || value === '') return undefined;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return undefined;
    const lower = text.toLowerCase();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
    if (/^-?\d+(?:[.,]\d+)?$/.test(text)) return Number(text.replace(',', '.'));
    return text.slice(0, 120);
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  return typeof value === 'boolean' ? value : undefined;
}

function normalizeProductSelectionPoolMetrics(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const metrics: Record<string, unknown> = {};
  for (const [key, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = normalizeProductSelectionPoolText(key, 80);
    const compacted = compactProductSelectionPoolMetric(rawValue);
    if (normalizedKey && compacted !== undefined) metrics[normalizedKey] = compacted;
  }
  return metrics;
}

function normalizeProductSelectionPoolItemInput(input: z.infer<typeof productSelectionPoolItemSchema>) {
  const sku = normalizeProductSelectionPoolSku(input.sku);
  const productId = normalizeProductSelectionPoolText(input.productId ?? input.product_id ?? sku, 80);
  const title = normalizeProductSelectionPoolText(input.title || `Ozon SKU ${sku}`, 500);
  return {
    platform: normalizeProductSelectionPoolPlatform(input.platform),
    sku,
    productId: productId || sku,
    title: title || `Ozon SKU ${sku}`,
    url: normalizeProductSelectionPoolText(input.url, 1000) || null,
    image: normalizeProductSelectionPoolText(input.image, 1000) || null,
    priceRub: normalizeProductSelectionPoolNumber(input.priceRub ?? input.price_rub),
    currency: normalizeProductSelectionPoolText(input.currency || 'RUB', 12).toUpperCase() || 'RUB',
    source: normalizeProductSelectionPoolText(input.source || 'extension', 80) || 'extension',
    ruleIds: normalizeProductSelectionPoolStringArray(input.ruleIds ?? input.rule_ids),
    tags: normalizeProductSelectionPoolStringArray(input.tags),
    metrics: normalizeProductSelectionPoolMetrics(input.metrics),
    note: normalizeProductSelectionPoolText(input.note, 1000) || null,
  };
}

function productSelectionPoolItemDto(row: Record<string, any>) {
  const priceRub = row.price_rub ?? row.priceRub;
  return {
    id: String(row.id || ''),
    platform: String(row.platform || 'ozon'),
    sku: String(row.sku || ''),
    productId: row.product_id || row.productId || null,
    title: String(row.title || ''),
    url: row.url || null,
    image: row.image || null,
    priceRub: priceRub == null ? null : Number(priceRub),
    currency: String(row.currency || 'RUB'),
    source: String(row.source || 'extension'),
    ruleIds: Array.isArray(row.rule_ids) ? row.rule_ids : [],
    tags: Array.isArray(row.tags) ? row.tags : [],
    metrics: row.metrics && typeof row.metrics === 'object' && !Array.isArray(row.metrics) ? row.metrics : {},
    note: row.note || null,
    status: String(row.status || 'active'),
    firstMatchedAt: row.first_matched_at || row.firstMatchedAt || null,
    lastMatchedAt: row.last_matched_at || row.lastMatchedAt || null,
    createdAt: row.created_at || row.createdAt || null,
    updatedAt: row.updated_at || row.updatedAt || null,
  };
}

function normalizeProductSelectionPoolStatus(value: unknown): string {
  const status = normalizeProductSelectionPoolText(value || 'active', 40).toLowerCase();
  if (status === 'all') return 'all';
  if (status === 'removed') return 'removed';
  return 'active';
}

function normalizeProductSelectionPoolPage(value: unknown, fallback: number, max: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

function normalizeProductSelectionPoolListQuery(input: z.infer<typeof productSelectionPoolListQuerySchema>) {
  return {
    platform: normalizeProductSelectionPoolPlatform(input.platform),
    q: normalizeProductSelectionPoolText(input.q, 120),
    tag: normalizeProductSelectionPoolText(input.tag, 80),
    ruleId: normalizeProductSelectionPoolText(input.ruleId, 100),
    status: normalizeProductSelectionPoolStatus(input.status),
    source: normalizeProductSelectionPoolText(input.source, 80),
    page: normalizeProductSelectionPoolPage(input.page, 1, 100000),
    pageSize: normalizeProductSelectionPoolPage(input.pageSize, 20, 200),
  };
}

function buildProductSelectionPoolWhere(userId: string, query: ReturnType<typeof normalizeProductSelectionPoolListQuery>) {
  const filters: Prisma.Sql[] = [
    Prisma.sql`"user_id" = ${userId}`,
    Prisma.sql`"platform" = ${query.platform}`,
  ];
  if (query.status !== 'all') filters.push(Prisma.sql`"status" = ${query.status}`);
  if (query.q) {
    const q = `%${query.q}%`;
    filters.push(Prisma.sql`("sku" ILIKE ${q} OR "title" ILIKE ${q} OR COALESCE("product_id", '') ILIKE ${q})`);
  }
  if (query.tag) {
    const tag = query.tag;
    filters.push(Prisma.sql`"tags" ? ${tag}`);
  }
  if (query.ruleId) {
    const ruleId = query.ruleId;
    filters.push(Prisma.sql`"rule_ids" ? ${ruleId}`);
  }
  if (query.source) filters.push(Prisma.sql`"source" = ${query.source}`);
  return Prisma.sql`WHERE ${Prisma.join(filters, ' AND ')}`;
}

function productSelectionPoolSummaryDto(row: Record<string, any>, tagRows: Array<Record<string, any>>) {
  return {
    allCount: Number(row.allCount ?? row.all_count ?? 0),
    activeCount: Number(row.activeCount ?? row.active_count ?? 0),
    removedCount: Number(row.removedCount ?? row.removed_count ?? 0),
    matched24hCount: Number(row.matched24hCount ?? row.matched_24h_count ?? 0),
    tags: tagRows.map((item) => ({
      tag: String(item.tag || ''),
      count: Number(item.count || 0),
    })).filter((item) => item.tag),
  };
}

function escapeProductSelectionPoolExcelCell(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function productSelectionPoolMetricSummary(metrics: unknown): string {
  if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) return '';
  const input = metrics as Record<string, unknown>;
  const entries = [
    ['月销量', input.soldCount],
    ['月销售额', input.soldSum],
    ['跟卖数', input.sellerCount],
    ['跟卖最低', input.minFollowPriceRub],
    ['广告费占比', input.adExpenseShare],
    ['退货取消率', input.returnCancelRate],
    ['利润率', input.profitMarginPct],
    ['重量g', input.weightGrams],
    ['品牌', input.brand],
    ['发货模式', input.salesSchema],
  ].filter(([, value]) => value != null && value !== '');
  return entries.map(([label, value]) => `${label}: ${value}`).join('；');
}

function productSelectionPoolExcelTable(items: Array<Record<string, any>>): string {
  const header = ['SKU', '商品', '价格', '币种', '标签', '命中规则', '指标', '来源', '状态', 'Ozon链接', '入池时间'];
  const rows = items.map((raw) => {
    const item = productSelectionPoolItemDto(raw);
    return [
      item.sku,
      item.title,
      item.priceRub ?? '',
      item.currency,
      item.tags.join(' / '),
      item.ruleIds.join(' / '),
      productSelectionPoolMetricSummary(item.metrics),
      item.source,
      item.status,
      item.url || '',
      item.lastMatchedAt || item.createdAt || '',
    ];
  });
  const tr = [header, ...rows]
    .map((cells) => `<tr>${cells.map((cell) => `<td>${escapeProductSelectionPoolExcelCell(cell)}</td>`).join('')}</tr>`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"></head><body><table>${tr}</table></body></html>`;
}

export async function extensionConfigRoutes(app: FastifyInstance) {
  const productSelectionRules = createPrismaProductSelectionRuleRepository(prisma);
  // 扩展启动时调用，获取当前运行模式和能力
  app.get('/runtime', { preHandler: [authenticate] }, async (_request, reply) => {
    const config = await getRuntimeConfigForStorage();
    return reply.send({
      code: 1,
      data: {
        mode: config.mode,
        source: config.source,
        capabilities: {
          imageUpload: config.imageStorage,
          sync: config.extensionSync,
          ozonCdnDirect: config.mode === 'local',
          serverSideUpload: config.mode === 'cloud',
          queuedTasks: config.extensionSync === 'queue',
        },
      },
    });
  });

  app.get('/product-selection/rules', { preHandler: [authenticate] }, async (request, reply) => {
    const { userId } = (request as any).user;
    return reply.send({ code: 1, data: { rules: await productSelectionRules.listRules(userId) } });
  });

  app.post('/product-selection/rules', { preHandler: [authenticate] }, async (request, reply) => {
    const { userId } = (request as any).user;
    const parsed = productSelectionRuleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    return reply.send({ code: 1, data: { rule: await productSelectionRules.saveRule(userId, parsed.data) } });
  });

  app.post('/product-selection/rules/:id/toggle', { preHandler: [authenticate] }, async (request, reply) => {
    const { userId } = (request as any).user;
    const id = String((request.params as any).id || '').trim();
    if (!id) return reply.status(400).send({ code: 0, msg: '缺少规则 ID' });
    const parsed = toggleProductSelectionRuleSchema.safeParse(request.body || {});
    if (!parsed.success) return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    const result = await productSelectionRules.toggleRule(userId, id, parsed.data.enabled);
    if (!result) return reply.status(404).send({ code: 0, msg: '规则不存在' });
    return reply.send({ code: 1, data: result });
  });

  app.delete('/product-selection/rules/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { userId } = (request as any).user;
    const id = String((request.params as any).id || '').trim();
    if (!id) return reply.status(400).send({ code: 0, msg: '缺少规则 ID' });
    await productSelectionRules.deleteRule(userId, id);
    return reply.send({ code: 1, data: { id } });
  });

  app.get('/product-selection/pool/items', { preHandler: [authenticate] }, async (request, reply) => {
    const { userId } = (request as any).user;
    const parsed = productSelectionPoolListQuerySchema.safeParse(request.query || {});
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }
    const query = normalizeProductSelectionPoolListQuery(parsed.data);
    const where = buildProductSelectionPoolWhere(userId, query);
    const offset = (query.page - 1) * query.pageSize;

    const [rows, countRows, summaryRows, tagRows] = await Promise.all([
      prisma.$queryRaw<Array<Record<string, any>>>`
        SELECT "id", "platform", "sku", "product_id", "title", "url", "image", "price_rub",
          "currency", "source", "rule_ids", "tags", "metrics", "note", "status",
          "first_matched_at", "last_matched_at", "created_at", "updated_at"
        FROM "product_selection_pool_items"
        ${where}
        ORDER BY "last_matched_at" DESC, "updated_at" DESC
        LIMIT ${query.pageSize} OFFSET ${offset}
      `,
      prisma.$queryRaw<Array<{ total: number }>>`
        SELECT COUNT(*)::int AS "total"
        FROM "product_selection_pool_items"
        ${where}
      `,
      prisma.$queryRaw<Array<Record<string, any>>>`
        SELECT
          COUNT(*)::int AS "allCount",
          COUNT(*) FILTER (WHERE "status" = 'active')::int AS "activeCount",
          COUNT(*) FILTER (WHERE "status" = 'removed')::int AS "removedCount",
          COUNT(*) FILTER (WHERE "status" = 'active' AND "last_matched_at" >= NOW() - INTERVAL '24 hours')::int AS "matched24hCount"
        FROM "product_selection_pool_items"
        WHERE "user_id" = ${userId} AND "platform" = ${query.platform}
      `,
      prisma.$queryRaw<Array<Record<string, any>>>`
        SELECT tag, COUNT(*)::int AS "count"
        FROM "product_selection_pool_items",
          jsonb_array_elements_text(COALESCE("tags", '[]'::jsonb)) AS tag
        WHERE "user_id" = ${userId} AND "platform" = ${query.platform} AND "status" = 'active'
        GROUP BY tag
        ORDER BY "count" DESC, tag ASC
        LIMIT 30
      `,
    ]);

    return reply.send({
      code: 1,
      data: {
        items: rows.map(productSelectionPoolItemDto),
        total: Number(countRows[0]?.total || 0),
        page: query.page,
        pageSize: query.pageSize,
        summary: productSelectionPoolSummaryDto(summaryRows[0] || {}, tagRows),
      },
    });
  });

  app.get('/product-selection/pool/items/export', { preHandler: [authenticate] }, async (request, reply) => {
    const { userId } = (request as any).user;
    const parsed = productSelectionPoolListQuerySchema.safeParse(request.query || {});
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }
    const query = normalizeProductSelectionPoolListQuery({ ...parsed.data, page: 1, pageSize: 5000 });
    const where = buildProductSelectionPoolWhere(userId, query);
    const rows = await prisma.$queryRaw<Array<Record<string, any>>>`
      SELECT "id", "platform", "sku", "product_id", "title", "url", "image", "price_rub",
        "currency", "source", "rule_ids", "tags", "metrics", "note", "status",
        "first_matched_at", "last_matched_at", "created_at", "updated_at"
      FROM "product_selection_pool_items"
      ${where}
      ORDER BY "last_matched_at" DESC, "updated_at" DESC
      LIMIT 5000
    `;
    const filename = `selection_pool_${new Date().toISOString().slice(0, 10)}.xls`;
    reply.header('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    return reply.send(productSelectionPoolExcelTable(rows));
  });

  app.post('/product-selection/pool/items', { preHandler: [authenticate] }, async (request, reply) => {
    const { userId } = (request as any).user;
    const parsed = productSelectionPoolItemSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    const item = normalizeProductSelectionPoolItemInput(parsed.data);
    if (!item.sku) return reply.status(400).send({ code: 0, msg: '缺少 SKU' });
    const id = randomUUID();
    const rows = await prisma.$queryRaw<Array<Record<string, any>>>`
      INSERT INTO "product_selection_pool_items" (
        "id", "user_id", "platform", "sku", "product_id", "title", "url", "image",
        "price_rub", "currency", "source", "rule_ids", "tags", "metrics", "note",
        "status", "first_matched_at", "last_matched_at", "created_at", "updated_at"
      ) VALUES (
        ${id}, ${userId}, ${item.platform}, ${item.sku}, ${item.productId}, ${item.title}, ${item.url}, ${item.image},
        ${item.priceRub}, ${item.currency}, ${item.source}, ${jsonbArray(item.ruleIds)}, ${jsonbArray(item.tags)}, ${jsonb(item.metrics)}, ${item.note},
        'active', NOW(), NOW(), NOW(), NOW()
      )
      ON CONFLICT ("user_id", "platform", "sku") DO UPDATE
      SET "product_id" = EXCLUDED."product_id",
          "title" = EXCLUDED."title",
          "url" = COALESCE(EXCLUDED."url", "product_selection_pool_items"."url"),
          "image" = COALESCE(EXCLUDED."image", "product_selection_pool_items"."image"),
          "price_rub" = COALESCE(EXCLUDED."price_rub", "product_selection_pool_items"."price_rub"),
          "currency" = EXCLUDED."currency",
          "source" = EXCLUDED."source",
          "rule_ids" = EXCLUDED."rule_ids",
          "tags" = EXCLUDED."tags",
          "metrics" = EXCLUDED."metrics",
          "note" = COALESCE(EXCLUDED."note", "product_selection_pool_items"."note"),
          "status" = 'active',
          "last_matched_at" = NOW(),
          "updated_at" = NOW()
      RETURNING "id", "platform", "sku", "product_id", "title", "url", "image", "price_rub",
        "currency", "source", "rule_ids", "tags", "metrics", "note", "status",
        "first_matched_at", "last_matched_at", "created_at", "updated_at"
    `;
    return reply.send({ code: 1, data: { item: productSelectionPoolItemDto(rows[0] || {}) } });
  });

  app.post('/product-selection/pool/status', { preHandler: [authenticate] }, async (request, reply) => {
    const { userId } = (request as any).user;
    const parsed = productSelectionPoolStatusSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }
    const platform = normalizeProductSelectionPoolPlatform(parsed.data.platform);
    const seen = new Set<string>();
    const skus = parsed.data.skus
      .map((sku) => normalizeProductSelectionPoolSku(sku))
      .filter((sku) => {
        if (!sku || seen.has(sku)) return false;
        seen.add(sku);
        return true;
      });
    if (!skus.length) return reply.send({ code: 1, data: { skus: [], items: [], itemsBySku: {} } });

    const rows = await prisma.$queryRaw<Array<Record<string, any>>>`
      SELECT "id", "platform", "sku", "product_id", "title", "url", "image", "price_rub",
        "currency", "source", "rule_ids", "tags", "metrics", "note", "status",
        "first_matched_at", "last_matched_at", "created_at", "updated_at"
      FROM "product_selection_pool_items"
      WHERE "user_id" = ${userId}
        AND "platform" = ${platform}
        AND "status" = 'active'
        AND "sku" IN (${Prisma.join(skus)})
    `;
    const items = rows.map(productSelectionPoolItemDto);
    const itemsBySku = Object.fromEntries(items.map((item) => [item.sku, item]));
    return reply.send({ code: 1, data: { skus: items.map((item) => item.sku), items, itemsBySku } });
  });

  app.delete('/product-selection/pool/items/:sku', { preHandler: [authenticate] }, async (request, reply) => {
    const { userId } = (request as any).user;
    const sku = normalizeProductSelectionPoolSku((request.params as any).sku);
    const platform = normalizeProductSelectionPoolPlatform((request.query as any).platform);
    if (!sku) return reply.status(400).send({ code: 0, msg: '缺少 SKU' });
    await prisma.$executeRaw`
      UPDATE "product_selection_pool_items"
      SET "status" = 'removed', "updated_at" = NOW()
      WHERE "user_id" = ${userId} AND "platform" = ${platform} AND "sku" = ${sku}
    `;
    return reply.send({ code: 1, data: { sku, platform, status: 'removed' } });
  });

  // 扩展上报本地 cookie（仅 local 模式接受）
  app.post('/sync-cookie', { preHandler: [authenticate] }, async (request, reply) => {
    const config = getRuntimeConfig();
    if (config.mode === 'cloud') {
      return reply.status(400).send({
        code: 0,
        msg: '云端模式不接受本地 cookie 同步，请使用 API token',
      });
    }

    const parsed = syncCookieSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    const { shopId, cookie, companyId } = parsed.data;
    const { userId } = (request as any).user;

    // 本地模式：只允许同步当前账号名下店铺，存到现有 OZON CDN 配置字段。
    const shop = await prisma.shop.findFirst({ where: { id: shopId, userId }, select: { config: true } });
    if (!shop) {
      return reply.status(404).send({ code: 0, msg: '店铺不存在' });
    }
    const existingConfig = (shop?.config as Record<string, unknown>) || {};
    const updatedAt = new Date().toISOString();
    const newConfig = {
      ...existingConfig,
      ozonCdnCookie: cookie,
      ...(companyId != null ? { ozonCompanyId: String(companyId) } : {}),
      ozonCdnUpdatedAt: updatedAt,
    };
    await prisma.shop.update({
      where: { id: shopId },
      data: { config: newConfig },
    });

    return reply.send({
      code: 1,
      msg: 'cookie 已同步',
      data: {
        hasCookie: true,
        companyId: newConfig.ozonCompanyId || null,
        updatedAt,
      },
    });
  });
}
