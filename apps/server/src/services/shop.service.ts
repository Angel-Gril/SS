import { prisma } from '../lib/prisma.js';
import type { Shop, ShopStatus } from '@prisma/client';

/**
 * 店铺服务层
 * 封装店铺相关的业务逻辑，供 route 层调用
 */

export interface CreateShopInput {
  userId: string;
  platform: string;
  name: string;
  clientId?: string;
  apiKeyEncrypted: string;
  apiSecretEncrypted?: string;
  config?: any;
}

export interface UpdateShopInput {
  name?: string;
  status?: ShopStatus;
  config?: any;
  errorMessage?: string;
}

/**
 * 获取用户的所有店铺
 */
export async function getUserShops(userId: string): Promise<Shop[]> {
  return prisma.shop.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * 根据 ID 获取店铺（包含权限检查）
 */
export async function getShopById(shopId: string, userId: string): Promise<Shop | null> {
  return prisma.shop.findFirst({
    where: { id: shopId, userId },
  });
}

/**
 * 创建店铺
 */
export async function createShop(input: CreateShopInput): Promise<Shop> {
  return prisma.shop.create({
    data: {
      userId: input.userId,
      platform: input.platform as any,
      name: input.name,
      clientId: input.clientId,
      apiKeyEncrypted: input.apiKeyEncrypted,
      apiSecretEncrypted: input.apiSecretEncrypted,
      config: input.config,
      status: 'ACTIVE',
    },
  });
}

/**
 * 更新店铺
 */
export async function updateShop(shopId: string, userId: string, input: UpdateShopInput): Promise<Shop> {
  // 权限检查
  const existing = await getShopById(shopId, userId);
  if (!existing) {
    throw new Error('店铺不存在或无权限');
  }

  return prisma.shop.update({
    where: { id: shopId },
    data: input,
  });
}

/**
 * 删除店铺
 */
export async function deleteShop(shopId: string, userId: string): Promise<void> {
  // 权限检查
  const existing = await getShopById(shopId, userId);
  if (!existing) {
    throw new Error('店铺不存在或无权限');
  }

  await prisma.shop.delete({ where: { id: shopId } });
}

/**
 * 更新店铺同步时间
 */
export async function updateShopSyncTime(shopId: string): Promise<void> {
  await prisma.shop.update({
    where: { id: shopId },
    data: { lastSyncAt: new Date() },
  });
}

/**
 * 标记店铺错误
 */
export async function markShopError(shopId: string, errorMessage: string): Promise<void> {
  await prisma.shop.update({
    where: { id: shopId },
    data: {
      status: 'ERROR',
      errorMessage,
    },
  });
}

/**
 * 清除店铺错误
 */
export async function clearShopError(shopId: string): Promise<void> {
  await prisma.shop.update({
    where: { id: shopId },
    data: {
      status: 'ACTIVE',
      errorMessage: null,
    },
  });
}
