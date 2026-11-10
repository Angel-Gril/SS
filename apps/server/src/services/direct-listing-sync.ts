import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';

// 扩展直连上架完成后的“最终数据同步”唯一 owner。
// 扩展独立完成采集/生图/上架，只在最后把结果（货号、Ozon 商品号、最终图片、标题、类目）
// 记到 ERP 的货源商品记录上，供 ERP 侧查看与后续精修。这里不触发任何 Ozon 写入。

const httpsUrl = z.string().trim().max(2000).regex(/^https:\/\/[^\s]+$/u);

const directListingItemSchema = z.object({
  offerId: z.string().trim().min(1).max(200),
  skuKey: z.string().trim().min(1).max(500).optional(),
  productId: z.union([z.string().trim().min(1).max(40), z.number().int().safe().positive().transform(String)]).optional(),
  price: z.string().trim().min(1).max(40).optional(),
  oldPrice: z.string().trim().min(1).max(40).optional(),
  currency: z.string().trim().min(3).max(8).optional(),
  status: z.string().trim().min(1).max(60).optional(),
  images: z.array(httpsUrl).max(15).default([]),
}).strict();

export const directListingSyncSchema = z.object({
  shopId: z.string().trim().min(1).max(200).optional(),
  sourcePlatform: z.string().trim().toLowerCase().min(1).max(40),
  sourceProductId: z.string().trim().min(1).max(200),
  sourceUrl: httpsUrl.optional(),
  title: z.string().trim().min(1).max(500),
  categoryId: z.number().int().safe().positive().optional(),
  typeId: z.number().int().safe().positive().optional(),
  items: z.array(directListingItemSchema).min(1).max(100),
}).strict();

export type DirectListingSyncPayload = z.infer<typeof directListingSyncSchema>;

export interface DirectListingRepository {
  findBySource(input: {
    ownerUserId: string;
    sourcePlatform: string;
    sourceProductId: string;
  }): Promise<{ id: string; metadata: unknown } | null>;
  update(input: { id: string; ownerUserId: string; metadata: Record<string, unknown> }): Promise<void>;
  create(input: {
    ownerUserId: string;
    sourcePlatform: string;
    sourceProductId: string;
    sourceUrl: string | null;
    title: string;
    images: string[];
    metadata: Record<string, unknown>;
  }): Promise<{ id: string }>;
}

export interface DirectListingSyncResult {
  supplyGoodsId: string;
  created: boolean;
  itemCount: number;
}

function plainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

export function createDirectListingSync(options: { repository: DirectListingRepository; now?: () => Date }) {
  const now = options.now || (() => new Date());
  return async function syncDirectListing(input: {
    ownerUserId: string;
    payload: DirectListingSyncPayload;
  }): Promise<DirectListingSyncResult> {
    const { ownerUserId, payload } = input;
    const directListing = {
      syncedAt: now().toISOString(),
      shopId: payload.shopId ?? null,
      title: payload.title,
      categoryId: payload.categoryId ?? null,
      typeId: payload.typeId ?? null,
      items: payload.items,
    };
    const existing = await options.repository.findBySource({
      ownerUserId,
      sourcePlatform: payload.sourcePlatform,
      sourceProductId: payload.sourceProductId,
    });
    if (existing) {
      await options.repository.update({
        id: existing.id,
        ownerUserId,
        metadata: { ...plainObject(existing.metadata), directListing },
      });
      return { supplyGoodsId: existing.id, created: false, itemCount: payload.items.length };
    }
    const images = [...new Set(payload.items.flatMap((item) => item.images))].slice(0, 30);
    const created = await options.repository.create({
      ownerUserId,
      sourcePlatform: payload.sourcePlatform,
      sourceProductId: payload.sourceProductId,
      sourceUrl: payload.sourceUrl ?? null,
      title: payload.title,
      images,
      metadata: { directListing },
    });
    return { supplyGoodsId: created.id, created: true, itemCount: payload.items.length };
  };
}

export function createPrismaDirectListingRepository(prisma: PrismaClient): DirectListingRepository {
  return {
    async findBySource({ ownerUserId, sourcePlatform, sourceProductId }) {
      return prisma.supplyGoods.findFirst({
        where: { userId: ownerUserId, sourcePlatform, sourceProductId },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, metadata: true },
      });
    },
    async update({ id, ownerUserId, metadata }) {
      // updateMany 带 userId 条件：即使 id 被猜中也无法改到别的租户的记录。
      await prisma.supplyGoods.updateMany({ where: { id, userId: ownerUserId }, data: { metadata: metadata as any } });
    },
    async create({ ownerUserId, sourcePlatform, sourceProductId, sourceUrl, title, images, metadata }) {
      return prisma.supplyGoods.create({
        data: {
          user: { connect: { id: ownerUserId } },
          title,
          sourceUrl,
          sourcePlatform,
          sourceProductId,
          sku: sourceProductId,
          images: images.length ? images : undefined,
          metadata: metadata as any,
          status: 'collected',
        },
        select: { id: true },
      });
    },
  };
}
