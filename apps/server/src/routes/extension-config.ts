import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getRuntimeConfig, getRuntimeConfigForStorage } from '../adapters/runtime-config.js';
import { authenticate } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';

const syncCookieSchema = z.object({
  shopId: z.string().min(1),
  cookie: z.string().min(1),
  companyId: z.union([z.string(), z.number()]).optional(),
});

const selectionConditionKeys = [
  'brandContains',
  'hasBrand',
  'minSoldCount',
  'minSoldSum',
  'minPriceRub',
  'maxPriceRub',
  'maxWeightGrams',
  'minSalesDynamics',
  'maxSalesDynamics',
  'maxAdExpenseShare',
  'maxReturnCancelRate',
  'minProfitMarginPct',
  'maxSellerCount',
  'minSearchCatalogViews',
  'minSearchCatalogAddToCartRate',
  'salesSchema',
  'minCreateDays',
  'maxCreateDays',
  'minPromoDays',
  'maxPromoDays',
  'minDiscountPercent',
  'maxDiscountPercent',
  'minPromoRevenueShare',
  'maxPromoRevenueShare',
  'minPaidPromotionDays',
  'maxPaidPromotionDays',
  'minProductCardViews',
  'minProductCardAddToCartRate',
  'minConvViewToOrder',
  'maxFollowMinPriceRub',
  'priority',
] as const;

const productSelectionRuleSchema = z.object({
  id: z.string().trim().min(1).max(100).optional(),
  name: z.string().trim().min(1).max(80),
  tag: z.string().trim().max(24).optional(),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  enabled: z.boolean().optional(),
  autoFavorite: z.union([z.boolean(), z.number(), z.string()]).optional(),
  auto_favorite: z.union([z.boolean(), z.number(), z.string()]).optional(),
  conditions: z.record(z.any()).optional(),
}).passthrough();

const toggleProductSelectionRuleSchema = z.object({
  enabled: z.boolean().optional(),
});

function jsonb(value: unknown) {
  return Prisma.sql`CAST(${JSON.stringify(value ?? {})} AS jsonb)`;
}

function compactRuleConditionValue(value: unknown): unknown {
  if (value == null || value === '') return undefined;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return undefined;
    const lowerText = text.toLowerCase();
    if (lowerText === 'true') return true;
    if (lowerText === 'false') return false;
    if (/^-?\d+(?:[.,]\d+)?$/.test(text)) return Number(text.replace(',', '.'));
    return text.slice(0, 120);
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return value;
  return undefined;
}

function normalizeProductSelectionRuleBoolean(value: unknown): boolean | null {
  if (value === true || value === false) return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (text === 'true' || text === '1' || text === 'yes') return true;
    if (text === 'false' || text === '0' || text === 'no') return false;
  }
  return null;
}

function normalizeProductSelectionRuleInput(input: z.infer<typeof productSelectionRuleSchema>) {
  const conditionsInput = input.conditions && typeof input.conditions === 'object' && !Array.isArray(input.conditions)
    ? input.conditions as Record<string, unknown>
    : {};
  const conditions: Record<string, unknown> = {};
  for (const key of selectionConditionKeys) {
    const value = compactRuleConditionValue(conditionsInput[key] ?? (input as Record<string, unknown>)[key]);
    if (value !== undefined) conditions[key] = value;
  }
  const tag = String(input.tag || input.name).trim().slice(0, 24) || '命中';
  return {
    id: input.id ? String(input.id).trim() : '',
    name: input.name.trim(),
    tag,
    color: input.color || '#2563eb',
    enabled: input.enabled !== false,
    autoFavorite: normalizeProductSelectionRuleBoolean(input.autoFavorite ?? input.auto_favorite) === true,
    conditions,
  };
}

function productSelectionRuleDto(row: Record<string, any>) {
  const conditions = row.conditions && typeof row.conditions === 'object' && !Array.isArray(row.conditions)
    ? row.conditions as Record<string, unknown>
    : {};
  return {
    id: String(row.id || ''),
    name: String(row.name || ''),
    tag: String(row.tag || row.name || ''),
    color: String(row.color || '#2563eb'),
    enabled: row.enabled !== false,
    autoFavorite: normalizeProductSelectionRuleBoolean(row.auto_favorite ?? row.autoFavorite) === true,
    conditions,
    ...conditions,
    createdAt: row.created_at || row.createdAt || null,
    updatedAt: row.updated_at || row.updatedAt || null,
  };
}

export async function extensionConfigRoutes(app: FastifyInstance) {
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
    const rows = await prisma.$queryRaw<Array<Record<string, any>>>`
      SELECT "id", "name", "tag", "color", "enabled", "auto_favorite", "conditions", "created_at", "updated_at"
      FROM "product_selection_rules"
      WHERE "user_id" = ${userId}
      ORDER BY "updated_at" DESC, "created_at" DESC
    `;
    return reply.send({ code: 1, data: { rules: rows.map(productSelectionRuleDto) } });
  });

  app.post('/product-selection/rules', { preHandler: [authenticate] }, async (request, reply) => {
    const { userId } = (request as any).user;
    const parsed = productSelectionRuleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    const rule = normalizeProductSelectionRuleInput(parsed.data);
    const id = rule.id || randomUUID();
    const existing = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "product_selection_rules" WHERE "id" = ${id} AND "user_id" = ${userId} LIMIT 1
    `;
    if (existing.length) {
      await prisma.$executeRaw`
        UPDATE "product_selection_rules"
        SET "name" = ${rule.name},
            "tag" = ${rule.tag},
            "color" = ${rule.color},
            "enabled" = ${rule.enabled},
            "auto_favorite" = ${rule.autoFavorite},
            "conditions" = ${jsonb(rule.conditions)},
            "updated_at" = NOW()
        WHERE "id" = ${id} AND "user_id" = ${userId}
      `;
    } else {
      await prisma.$executeRaw`
        INSERT INTO "product_selection_rules" (
          "id", "user_id", "name", "tag", "color", "enabled", "auto_favorite", "conditions", "created_at", "updated_at"
        ) VALUES (
          ${id}, ${userId}, ${rule.name}, ${rule.tag}, ${rule.color}, ${rule.enabled}, ${rule.autoFavorite}, ${jsonb(rule.conditions)}, NOW(), NOW()
        )
      `;
    }

    const rows = await prisma.$queryRaw<Array<Record<string, any>>>`
      SELECT "id", "name", "tag", "color", "enabled", "auto_favorite", "conditions", "created_at", "updated_at"
      FROM "product_selection_rules"
      WHERE "id" = ${id} AND "user_id" = ${userId}
      LIMIT 1
    `;
    return reply.send({ code: 1, data: { rule: productSelectionRuleDto(rows[0] || { ...rule, id, conditions: rule.conditions }) } });
  });

  app.post('/product-selection/rules/:id/toggle', { preHandler: [authenticate] }, async (request, reply) => {
    const { userId } = (request as any).user;
    const id = String((request.params as any).id || '').trim();
    if (!id) return reply.status(400).send({ code: 0, msg: '缺少规则 ID' });
    const parsed = toggleProductSelectionRuleSchema.safeParse(request.body || {});
    if (!parsed.success) return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    const rows = await prisma.$queryRaw<Array<{ enabled: boolean }>>`
      SELECT "enabled" FROM "product_selection_rules" WHERE "id" = ${id} AND "user_id" = ${userId} LIMIT 1
    `;
    const existingRule = rows[0];
    if (!existingRule) return reply.status(404).send({ code: 0, msg: '规则不存在' });
    const enabled = parsed.data.enabled == null ? !existingRule.enabled : parsed.data.enabled;
    await prisma.$executeRaw`
      UPDATE "product_selection_rules"
      SET "enabled" = ${enabled}, "updated_at" = NOW()
      WHERE "id" = ${id} AND "user_id" = ${userId}
    `;
    return reply.send({ code: 1, data: { id, enabled } });
  });

  app.delete('/product-selection/rules/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { userId } = (request as any).user;
    const id = String((request.params as any).id || '').trim();
    if (!id) return reply.status(400).send({ code: 0, msg: '缺少规则 ID' });
    await prisma.$executeRaw`
      DELETE FROM "product_selection_rules"
      WHERE "id" = ${id} AND "user_id" = ${userId}
    `;
    return reply.send({ code: 1, data: { id } });
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
