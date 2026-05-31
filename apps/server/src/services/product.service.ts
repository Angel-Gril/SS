import { prisma } from '../lib/prisma.js';
import type { Product, Prisma } from '@prisma/client';

/**
 * 商品服务层
 * 封装商品相关的业务逻辑
 */

export interface GetProductsOptions {
  shopId?: string;
  userId?: string;
  status?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export interface ProductListResult {
  products: Product[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * 获取商品列表（支持分页、筛选）
 */
export async function getProducts(options: GetProductsOptions): Promise<ProductListResult> {
  const {
    shopId,
    userId,
    status,
    keyword,
    page = 1,
    pageSize = 50,
  } = options;

  const where: Prisma.ProductWhereInput = {};

  if (shopId) {
    where.shopId = shopId;
  }

  if (userId) {
    where.shop = { userId };
  }

  if (status) {
    where.status = status;
  }

  if (keyword) {
    where.OR = [
      { title: { contains: keyword } },
      { sku: { contains: keyword } },
      { offerId: { contains: keyword } },
    ];
  }

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.product.count({ where }),
  ]);

  return { products, total, page, pageSize };
}

/**
 * 根据 ID 获取商品
 */
export async function getProductById(productId: string): Promise<Product | null> {
  return prisma.product.findUnique({ where: { id: productId } });
}

/**
 * 根据 offer_id 获取商品
 */
export async function getProductByOfferId(shopId: string, offerId: string): Promise<Product | null> {
  return prisma.product.findUnique({
    where: { shopId_offerId: { shopId, offerId } },
  });
}

/**
 * 创建或更新商品（upsert）
 */
export async function upsertProduct(
  shopId: string,
  platformProductId: string,
  data: Omit<Prisma.ProductCreateInput, 'shop'> & { title: string }
): Promise<Product> {
  const updateData: Prisma.ProductUpdateInput = { ...data };

  return prisma.product.upsert({
    where: { shopId_platformProductId: { shopId, platformProductId } },
    create: {
      shop: { connect: { id: shopId } },
      platformProductId,
      ...data,
    },
    update: updateData,
  });
}

/**
 * 批量更新商品状态
 */
export async function batchUpdateProductStatus(productIds: string[], status: string): Promise<number> {
  const result = await prisma.product.updateMany({
    where: { id: { in: productIds } },
    data: { status },
  });
  return result.count;
}

/**
 * 批量更新商品库存
 */
export async function batchUpdateProductStock(updates: Array<{ id: string; stock: number }>): Promise<void> {
  await prisma.$transaction(
    updates.map((u) =>
      prisma.product.update({
        where: { id: u.id },
        data: { stock: u.stock },
      })
    )
  );
}

/**
 * 删除商品
 */
export async function deleteProduct(productId: string): Promise<void> {
  await prisma.product.delete({ where: { id: productId } });
}

/**
 * 获取商品统计
 */
export async function getProductStats(shopId: string) {
  const products = await prisma.product.findMany({
    where: { shopId },
    select: { status: true, stock: true },
  });

  const stats = {
    total: products.length,
    byStatus: {} as Record<string, number>,
    totalStock: 0,
    outOfStock: 0,
  };

  for (const product of products) {
    if (product.status) {
      stats.byStatus[product.status] = (stats.byStatus[product.status] || 0) + 1;
    }
    stats.totalStock += product.stock;
    if (product.stock === 0) {
      stats.outOfStock++;
    }
  }

  return stats;
}

/**
 * 检查商品是否属于用户
 */
export async function checkProductOwnership(productId: string, userId: string): Promise<boolean> {
  const product = await prisma.product.findFirst({
    where: {
      id: productId,
      shop: { userId },
    },
  });
  return !!product;
}
