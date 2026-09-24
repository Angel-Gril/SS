import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';

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

export const productSelectionRuleSchema = z.object({
  id: z.string().trim().min(1).max(100).optional(),
  name: z.string().trim().min(1).max(80),
  tag: z.string().trim().max(24).optional(),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  enabled: z.boolean().optional(),
  autoFavorite: z.union([z.boolean(), z.number(), z.string()]).optional(),
  auto_favorite: z.union([z.boolean(), z.number(), z.string()]).optional(),
  conditions: z.record(z.any()).optional(),
}).passthrough();

export const toggleProductSelectionRuleSchema = z.object({
  enabled: z.boolean().optional(),
});

export type ProductSelectionRuleInput = z.infer<typeof productSelectionRuleSchema>;

export interface ProductSelectionRuleDto {
  id: string;
  name: string;
  tag: string;
  color: string;
  enabled: boolean;
  autoFavorite: boolean;
  conditions: Record<string, unknown>;
  createdAt: unknown;
  updatedAt: unknown;
  [key: string]: unknown;
}

export interface ProductSelectionRuleRepository {
  listRules(ownerUserId: string): Promise<ProductSelectionRuleDto[]>;
  saveRule(ownerUserId: string, input: ProductSelectionRuleInput): Promise<ProductSelectionRuleDto>;
  toggleRule(ownerUserId: string, ruleId: string, enabled?: boolean): Promise<{ id: string; enabled: boolean } | null>;
  deleteRule(ownerUserId: string, ruleId: string): Promise<boolean>;
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

export function normalizeProductSelectionRuleBoolean(value: unknown): boolean | null {
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

export function normalizeProductSelectionRuleInput(input: ProductSelectionRuleInput) {
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

export function productSelectionRuleDto(row: Record<string, any>): ProductSelectionRuleDto {
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

type ProductSelectionRulePrisma = Pick<PrismaClient, '$queryRaw' | '$executeRaw'>;

function jsonb(value: unknown) {
  return Prisma.sql`CAST(${JSON.stringify(value ?? {})} AS jsonb)`;
}

export function createPrismaProductSelectionRuleRepository(
  client: ProductSelectionRulePrisma,
): ProductSelectionRuleRepository {
  return {
    async listRules(ownerUserId) {
      const rows = await client.$queryRaw<Array<Record<string, any>>>`
        SELECT "id", "name", "tag", "color", "enabled", "auto_favorite", "conditions", "created_at", "updated_at"
        FROM "product_selection_rules"
        WHERE "user_id" = ${ownerUserId}
        ORDER BY "updated_at" DESC, "created_at" DESC
      `;
      return rows.map(productSelectionRuleDto);
    },

    async saveRule(ownerUserId, input) {
      const rule = normalizeProductSelectionRuleInput(input);
      const id = rule.id || randomUUID();
      const existing = await client.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "product_selection_rules"
        WHERE "id" = ${id} AND "user_id" = ${ownerUserId}
        LIMIT 1
      `;
      if (existing.length) {
        await client.$executeRaw`
          UPDATE "product_selection_rules"
          SET "name" = ${rule.name}, "tag" = ${rule.tag}, "color" = ${rule.color},
            "enabled" = ${rule.enabled}, "auto_favorite" = ${rule.autoFavorite},
            "conditions" = ${jsonb(rule.conditions)}, "updated_at" = NOW()
          WHERE "id" = ${id} AND "user_id" = ${ownerUserId}
        `;
      } else {
        await client.$executeRaw`
          INSERT INTO "product_selection_rules" (
            "id", "user_id", "name", "tag", "color", "enabled", "auto_favorite", "conditions", "created_at", "updated_at"
          ) VALUES (
            ${id}, ${ownerUserId}, ${rule.name}, ${rule.tag}, ${rule.color}, ${rule.enabled},
            ${rule.autoFavorite}, ${jsonb(rule.conditions)}, NOW(), NOW()
          )
        `;
      }
      const rows = await client.$queryRaw<Array<Record<string, any>>>`
        SELECT "id", "name", "tag", "color", "enabled", "auto_favorite", "conditions", "created_at", "updated_at"
        FROM "product_selection_rules"
        WHERE "id" = ${id} AND "user_id" = ${ownerUserId}
        LIMIT 1
      `;
      return productSelectionRuleDto(rows[0] || { ...rule, id, conditions: rule.conditions });
    },

    async toggleRule(ownerUserId, ruleId, requestedEnabled) {
      const rows = await client.$queryRaw<Array<{ enabled: boolean }>>`
        SELECT "enabled" FROM "product_selection_rules"
        WHERE "id" = ${ruleId} AND "user_id" = ${ownerUserId}
        LIMIT 1
      `;
      if (!rows[0]) return null;
      const enabled = requestedEnabled == null ? !rows[0].enabled : requestedEnabled;
      await client.$executeRaw`
        UPDATE "product_selection_rules"
        SET "enabled" = ${enabled}, "updated_at" = NOW()
        WHERE "id" = ${ruleId} AND "user_id" = ${ownerUserId}
      `;
      return { id: ruleId, enabled };
    },

    async deleteRule(ownerUserId, ruleId) {
      const changed = await client.$executeRaw`
        DELETE FROM "product_selection_rules"
        WHERE "id" = ${ruleId} AND "user_id" = ${ownerUserId}
      `;
      return Number(changed) > 0;
    },
  };
}
