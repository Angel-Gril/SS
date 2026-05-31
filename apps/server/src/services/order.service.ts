import { prisma } from '../lib/prisma.js';
import type { Order, Prisma } from '@prisma/client';

/**
 * 订单服务层
 * 封装订单相关的业务逻辑
 */

export interface GetOrdersOptions {
  shopId?: string;
  userId?: string;
  status?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
  startDate?: Date;
  endDate?: Date;
}

export interface OrderListResult {
  orders: Order[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * 获取订单列表（支持分页、筛选）
 */
export async function getOrders(options: GetOrdersOptions): Promise<OrderListResult> {
  const {
    shopId,
    userId,
    status,
    keyword,
    page = 1,
    pageSize = 50,
    startDate,
    endDate,
  } = options;

  const where: Prisma.OrderWhereInput = {};

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
      { postingNumber: { contains: keyword } },
      { domesticTrackingNumber: { contains: keyword } },
      { internationalTrackingNumber: { contains: keyword } },
    ];
  }

  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = startDate;
    if (endDate) where.createdAt.lte = endDate;
  }

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.order.count({ where }),
  ]);

  return { orders, total, page, pageSize };
}

/**
 * 根据 ID 获取订单
 */
export async function getOrderById(orderId: string): Promise<Order | null> {
  return prisma.order.findUnique({ where: { id: orderId } });
}

/**
 * 根据 posting number 获取订单
 */
export async function getOrderByPostingNumber(shopId: string, postingNumber: string): Promise<Order | null> {
  return prisma.order.findFirst({
    where: { shopId, postingNumber },
  });
}

/**
 * 更新订单物流信息
 */
export async function updateOrderTracking(
  orderId: string,
  data: {
    domesticTrackingNumber?: string;
    domesticCarrier?: string;
    domesticStatus?: string;
    internationalTrackingNumber?: string;
    internationalCarrier?: string;
    internationalStatus?: string;
  }
): Promise<Order> {
  return prisma.order.update({
    where: { id: orderId },
    data,
  });
}

/**
 * 批量更新订单状态
 */
export async function batchUpdateOrderStatus(orderIds: string[], status: string): Promise<number> {
  const result = await prisma.order.updateMany({
    where: { id: { in: orderIds } },
    data: { status },
  });
  return result.count;
}

/**
 * 获取订单统计
 */
export async function getOrderStats(shopId: string, startDate: Date, endDate: Date) {
  const orders = await prisma.order.findMany({
    where: {
      shopId,
      createdAt: { gte: startDate, lte: endDate },
    },
    select: {
      status: true,
      totalAmount: true,
      currency: true,
    },
  });

  const stats = {
    total: orders.length,
    byStatus: {} as Record<string, number>,
    totalAmount: 0,
  };

  for (const order of orders) {
    stats.byStatus[order.status] = (stats.byStatus[order.status] || 0) + 1;
    if (order.totalAmount) {
      stats.totalAmount += Number(order.totalAmount);
    }
  }

  return stats;
}

/**
 * 检查订单是否属于用户
 */
export async function checkOrderOwnership(orderId: string, userId: string): Promise<boolean> {
  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      shop: { userId },
    },
  });
  return !!order;
}
