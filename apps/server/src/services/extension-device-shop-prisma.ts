import type { Prisma, PrismaClient } from '@prisma/client';

const OZON_PLATFORM = 'OZON' as const;
const MAX_CONFIG_UPDATE_ATTEMPTS = 3;

type ShopClient = Pick<PrismaClient, 'shop'>;

export interface ExtensionDeviceOzonCdnAuthStatus {
  hasCookie: boolean;
  companyId: string | null;
  updatedAt: string | null;
}

export class ExtensionDeviceShopConfigConflictError extends Error {
  constructor() {
    super('Ozon CDN auth config changed concurrently');
    this.name = 'ExtensionDeviceShopConfigConflictError';
  }
}

function configRecord(config: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> {
  return config && typeof config === 'object' && !Array.isArray(config)
    ? config as Record<string, Prisma.JsonValue>
    : {};
}

function safeIdentifier(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = String(value).trim();
  return normalized && normalized.length <= 200 && !/[\u0000-\u001F\u007F]/u.test(normalized)
    ? normalized
    : null;
}

export function extensionDeviceOzonCdnAuthStatus(
  config: Prisma.JsonValue | null,
): ExtensionDeviceOzonCdnAuthStatus {
  const value = configRecord(config);
  const cookie = typeof value.ozonCdnCookie === 'string' ? value.ozonCdnCookie.trim() : '';
  return {
    hasCookie: Boolean(cookie),
    companyId: safeIdentifier(value.ozonCompanyId),
    updatedAt: typeof value.ozonCdnUpdatedAt === 'string'
      ? value.ozonCdnUpdatedAt.trim() || null
      : null,
  };
}

export function createPrismaExtensionDeviceShopRepository(client: ShopClient) {
  return {
    async listAuthorizedShops(input: { ownerUserId: string; shopIds: string[] }) {
      if (!input.shopIds.length) return [];
      const shops = await client.shop.findMany({
        where: {
          userId: input.ownerUserId,
          id: { in: input.shopIds },
          platform: OZON_PLATFORM,
          status: { not: 'DISABLED' },
        },
        select: {
          id: true,
          platform: true,
          name: true,
          status: true,
          clientId: true,
          config: true,
        },
      });
      return shops.map((shop) => ({
        id: shop.id,
        platform: shop.platform,
        name: shop.name,
        status: shop.status,
        clientId: safeIdentifier(shop.clientId),
        companyId: extensionDeviceOzonCdnAuthStatus(shop.config).companyId,
      }));
    },

    async readOzonCdnAuth(input: { ownerUserId: string; shopId: string }) {
      const shop = await client.shop.findFirst({
        where: {
          id: input.shopId,
          userId: input.ownerUserId,
          platform: OZON_PLATFORM,
          status: { not: 'DISABLED' },
        },
        select: { config: true },
      });
      return shop ? extensionDeviceOzonCdnAuthStatus(shop.config) : null;
    },

    async updateOzonCdnAuth(input: {
      ownerUserId: string;
      shopId: string;
      cookie?: string;
      companyId?: string;
    }) {
      for (let attempt = 0; attempt < MAX_CONFIG_UPDATE_ATTEMPTS; attempt += 1) {
        const shop = await client.shop.findFirst({
          where: {
            id: input.shopId,
            userId: input.ownerUserId,
            platform: OZON_PLATFORM,
            status: { not: 'DISABLED' },
          },
          select: { config: true, updatedAt: true },
        });
        if (!shop) return null;

        const nextRowUpdatedAt = new Date(Math.max(Date.now(), shop.updatedAt.getTime() + 1));
        const updatedAt = nextRowUpdatedAt.toISOString();
        const config = {
          ...configRecord(shop.config),
          ...(input.cookie !== undefined ? { ozonCdnCookie: input.cookie } : {}),
          ...(input.companyId !== undefined ? { ozonCompanyId: input.companyId } : {}),
          ozonCdnUpdatedAt: updatedAt,
        } satisfies Prisma.InputJsonObject;
        const updated = await client.shop.updateMany({
          where: {
            id: input.shopId,
            userId: input.ownerUserId,
            platform: OZON_PLATFORM,
            status: { not: 'DISABLED' },
            updatedAt: shop.updatedAt,
          },
          data: { config, updatedAt: nextRowUpdatedAt },
        });
        if (updated.count === 1) return extensionDeviceOzonCdnAuthStatus(config);
      }
      throw new ExtensionDeviceShopConfigConflictError();
    },
  };
}
