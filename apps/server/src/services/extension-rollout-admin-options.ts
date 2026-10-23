import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { SOURCE_WORKFLOW_FEATURES } from './source-workflow-feature-flags.js';

const selectedOwnersSchema = z.string().max(10_049).transform((raw) => raw.split(',').map((id) => id.trim()))
  .pipe(z.array(z.string().min(1).max(200)).min(1).max(50))
  .transform((ids) => [...new Set(ids)]);
const querySchema = z.object({
  search: z.string().trim().max(100).optional(),
  ownerUserIds: selectedOwnersSchema.optional(),
  platform: z.enum(['OZON', 'YANDEX', 'KASPI', 'WILDBERRIES']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
}).strict();

const ownerSelect = { id: true, nickname: true, accountCode: true, status: true } as const;

export interface ExtensionRolloutAdminOptions {
  owners: Array<{ id: string; nickname: string | null; accountCode: string | null; status: string }>;
  shops: Array<{ id: string; name: string; platform: string; status: string; ownerUserId: string }>;
  devices: Array<{ id: string; ownerUserId: string; status: string; shopIds: string[]; scopes: string[] }>;
  features: typeof SOURCE_WORKFLOW_FEATURES;
  unavailableOwnerUserIds: string[];
  hasMore: { owners: boolean; shops: boolean; devices: boolean };
}

export function createExtensionRolloutAdminOptionsService(
  database: Pick<PrismaClient, 'user' | 'shop' | 'extensionDeviceSession'>,
  now: () => Date = () => new Date(),
) {
  return {
    async list(query: unknown): Promise<ExtensionRolloutAdminOptions> {
      const { search, ownerUserIds = [], platform, limit } = querySchema.parse(query);
      const ownerRows = await database.user.findMany({
        where: {
          parentId: null,
          status: 'ACTIVE',
          ...(search ? { OR: [
            { id: { contains: search, mode: 'insensitive' as const } },
            { nickname: { contains: search, mode: 'insensitive' as const } },
            { accountCode: { contains: search, mode: 'insensitive' as const } },
          ] } : {}),
        },
        select: ownerSelect,
        orderBy: { id: 'asc' },
        take: limit + 1,
      });
      const selectedOwners = ownerUserIds.length ? await database.user.findMany({
        where: { id: { in: ownerUserIds }, parentId: null, status: 'ACTIVE' },
        select: { id: true },
        take: 50,
      }) : [];
      const eligibleOwnerIds = selectedOwners.map(({ id }) => id);
      const result: ExtensionRolloutAdminOptions = {
        owners: ownerRows.slice(0, limit).map(({ id, nickname, accountCode, status }) => ({ id, nickname, accountCode, status })),
        shops: [],
        devices: [],
        features: SOURCE_WORKFLOW_FEATURES,
        unavailableOwnerUserIds: ownerUserIds.filter((id) => !eligibleOwnerIds.includes(id)),
        hasMore: { owners: ownerRows.length > limit, shops: false, devices: false },
      };
      if (!eligibleOwnerIds.length) return result;

      const [shops, devices] = await Promise.all([
        database.shop.findMany({
          where: { userId: { in: eligibleOwnerIds }, status: 'ACTIVE', ...(platform ? { platform } : {}) },
          select: { id: true, name: true, platform: true, status: true, userId: true },
          orderBy: { id: 'asc' },
          take: limit + 1,
        }),
        database.extensionDeviceSession.findMany({
          where: { ownerUserId: { in: eligibleOwnerIds }, status: 'ACTIVE', expiresAt: { gt: now() } },
          select: {
            id: true, ownerUserId: true, status: true, scopes: true,
            shopGrants: {
              where: { status: 'ACTIVE', shop: { userId: { in: eligibleOwnerIds }, status: 'ACTIVE', ...(platform ? { platform } : {}) } },
              select: { shopId: true },
              orderBy: { shopId: 'asc' },
              take: 50,
            },
          },
          orderBy: { id: 'asc' },
          take: limit + 1,
        }),
      ]);
      result.shops = shops.slice(0, limit).map(({ id, name, platform: shopPlatform, status, userId }) => ({ id, name, platform: shopPlatform, status, ownerUserId: userId }));
      result.devices = devices.slice(0, limit).map(({ id, ownerUserId, status, scopes, shopGrants }) => ({ id, ownerUserId, status, scopes, shopIds: shopGrants.map(({ shopId }) => shopId) }));
      result.hasMore.shops = shops.length > limit;
      result.hasMore.devices = devices.length > limit;
      return result;
    },
  };
}
