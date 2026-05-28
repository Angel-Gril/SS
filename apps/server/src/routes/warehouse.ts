import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';

const scanInSchema = z.object({
  trackingNumber: z.string().min(1, '快递单号不能为空'),
});

const scanOutSchema = z.object({
  trackingNumber: z.string().min(1, '单号不能为空'),
  shippingFee: z.coerce.number().min(0).optional(),
});

const inspectionSchema = z.object({
  orderId: z.string().min(1),
  status: z.enum(['passed', 'failed']),
  photos: z.array(z.string()).optional(),
  note: z.string().optional(),
});

export async function warehouseRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);
  // 仅放行：ADMIN / STAFF / USER+isTransitProvider（自建仓主）；普通 USER 403
  app.addHook('preHandler', async (request, reply) => {
    const { userId, role } = (request as any).user;
    if (role === 'ADMIN' || role === 'STAFF') return;
    const me = await prisma.user.findUnique({
      where: { id: userId },
      select: { isTransitProvider: true },
    });
    if (!me?.isTransitProvider) {
      return reply.status(403).send({ code: 0, msg: '无仓库端权限' });
    }
  });

  /**
   * 拿到当前用户能扫的 shopIds：
   * - ADMIN/STAFF：全平台所有店铺（中转仓员工要看所有走中转的订单）
   * - USER+isTransitProvider：自己的店铺 + 所有 parentId=自己的下线的店铺
   * - 普通 USER：被前面的 hook 已 403，不会走到这里
   */
  async function getAccessibleShopIds(userId: string, role: string): Promise<string[]> {
    if (role === 'ADMIN' || role === 'STAFF') {
      const shops = await prisma.shop.findMany({ select: { id: true } });
      return shops.map((s) => s.id);
    }
    const downstream = await prisma.user.findMany({
      where: { parentId: userId },
      select: { id: true },
    });
    const ownerIds = [userId, ...downstream.map((u) => u.id)];
    const shops = await prisma.shop.findMany({
      where: { userId: { in: ownerIds } },
      select: { id: true },
    });
    return shops.map((s) => s.id);
  }

  app.post('/scan-in', async (request, reply) => {
    const { userId, role, actorUserId } = (request as any).user;
    const parsed = scanInSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
    }

    const { trackingNumber } = parsed.data;
    const shopIds = await getAccessibleShopIds(userId, role);

    if (shopIds.length === 0) {
      return reply.send({ code: 0, msg: '未找到对应订单' });
    }

    const order = await prisma.order.findFirst({
      where: { shopId: { in: shopIds }, domesticTrackingNumber: trackingNumber },
      include: { shop: { select: { name: true, platform: true } } },
    });

    if (!order) {
      return reply.send({ code: 0, msg: `未找到快递单号 ${trackingNumber} 对应的订单` });
    }

    await prisma.order.update({ where: { id: order.id }, data: { domesticStatus: 'received' } });

    await prisma.warehouseLog.create({
      data: { orderId: order.id, operationType: 'scan_in', operatorId: actorUserId, trackingNumber },
    });

    const serviceTags = await resolveServiceTags(order.serviceTags as string[] | null);

    return reply.send({
      code: 1,
      msg: '入库成功',
      data: {
        id: order.id,
        postingNumber: order.postingNumber,
        platformOrderId: order.platformOrderId,
        domesticTrackingNumber: order.domesticTrackingNumber,
        domesticCarrier: order.domesticCarrier,
        items: order.items,
        buyerInfo: order.buyerInfo,
        shippingInfo: order.shippingInfo,
        shop: order.shop,
        status: order.status,
        serviceTags,
        inspectionStatus: order.inspectionStatus,
        needInspection: serviceTags.some((t) => t.needInspection),
      },
    });
  });

  app.post('/scan-out', async (request, reply) => {
    const { userId, role, actorUserId } = (request as any).user;
    const parsed = scanOutSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
    }

    const { trackingNumber, shippingFee: inputShippingFee } = parsed.data;
    const shopIds = await getAccessibleShopIds(userId, role);

    if (shopIds.length === 0) {
      return reply.send({ code: 0, msg: '未找到对应订单' });
    }

    const order = await prisma.order.findFirst({
      where: {
        shopId: { in: shopIds },
        OR: [
          { internationalTrackingNumber: trackingNumber },
          { postingNumber: trackingNumber },
        ],
      },
      include: { shop: { select: { name: true, platform: true, userId: true } } },
    });

    if (!order) {
      return reply.send({ code: 0, msg: `未找到单号 ${trackingNumber} 对应的订单` });
    }

    if (order.inspectionStatus === 'pending') {
      return reply.send({ code: 0, msg: '该包裹需先完成验视，无法出库' });
    }

    // 费用计算：如果没有手动输入快递费，查找默认 shipping 模板
    let resolvedShippingFee = inputShippingFee ?? null;
    if (resolvedShippingFee === null || resolvedShippingFee === undefined) {
      const defaultShippingTemplate = await prisma.feeTemplate.findFirst({
        where: { type: 'shipping', isDefault: true, isActive: true },
      });
      resolvedShippingFee = defaultShippingTemplate ? Number(defaultShippingTemplate.fee) : 0;
    }

    const serviceFee = Number(order.serviceFee || 0);
    const shippingFee = resolvedShippingFee;
    const totalFee = serviceFee + shippingFee;

    // 扣费逻辑
    const orderOwnerId = order.shop.userId;
    let feeDeducted = false;

    if (totalFee > 0) {
      let account = await prisma.userAccount.findUnique({ where: { userId: orderOwnerId } });
      if (!account) {
        account = await prisma.userAccount.create({
          data: { userId: orderOwnerId, balance: 0, creditLimit: 0, billingMode: 'prepaid', frozenAmount: 0 },
        });
      }

      if (account.billingMode === 'prepaid') {
        // 预充值模式：余额不足则拒绝出库
        if (Number(account.balance) < totalFee) {
          return reply.send({
            code: 0,
            msg: `余额不足，请充值。当前余额: ${account.balance.toString()}元，需扣费: ${totalFee.toFixed(2)}元`,
          });
        }

        // 原子扣款
        await prisma.$transaction(async (tx) => {
          const acc = await tx.userAccount.findUnique({ where: { userId: orderOwnerId } });
          if (!acc || Number(acc.balance) < totalFee) {
            throw new Error('余额不足');
          }

          const newBalance = acc.balance.sub(totalFee);
          await tx.userAccount.update({ where: { id: acc.id }, data: { balance: newBalance } });

          if (serviceFee > 0) {
            await tx.transaction.create({
              data: {
                accountId: acc.id,
                type: 'deduct_service',
                amount: -serviceFee,
                balanceAfter: acc.balance.sub(serviceFee),
                orderId: order.id,
                description: `服务费扣款 - ${order.postingNumber || order.platformOrderId}`,
              },
            });
          }

          if (shippingFee > 0) {
            await tx.transaction.create({
              data: {
                accountId: acc.id,
                type: 'deduct_shipping',
                amount: -shippingFee,
                balanceAfter: newBalance,
                orderId: order.id,
                description: `快递费扣款 - ${order.postingNumber || order.platformOrderId}`,
              },
            });
          }

          await tx.order.update({
            where: { id: order.id },
            data: { shippingFee: shippingFee, feeDeducted: true },
          });
        });

        feeDeducted = true;
      } else {
        // 月结模式：记账但允许负余额（在额度范围内）
        await prisma.$transaction(async (tx) => {
          const acc = await tx.userAccount.findUnique({ where: { userId: orderOwnerId } });
          if (!acc) throw new Error('账户不存在');

          const newBalance = acc.balance.sub(totalFee);
          const minAllowed = acc.creditLimit.mul(-1);

          if (newBalance.lessThan(minAllowed)) {
            throw new Error(`超出月结额度。当前余额: ${acc.balance.toString()}元，额度: ${acc.creditLimit.toString()}元`);
          }

          await tx.userAccount.update({ where: { id: acc.id }, data: { balance: newBalance } });

          if (serviceFee > 0) {
            await tx.transaction.create({
              data: {
                accountId: acc.id,
                type: 'deduct_service',
                amount: -serviceFee,
                balanceAfter: acc.balance.sub(serviceFee),
                orderId: order.id,
                description: `[月结]服务费 - ${order.postingNumber || order.platformOrderId}`,
              },
            });
          }

          if (shippingFee > 0) {
            await tx.transaction.create({
              data: {
                accountId: acc.id,
                type: 'deduct_shipping',
                amount: -shippingFee,
                balanceAfter: newBalance,
                orderId: order.id,
                description: `[月结]快递费 - ${order.postingNumber || order.platformOrderId}`,
              },
            });
          }

          await tx.order.update({
            where: { id: order.id },
            data: { shippingFee: shippingFee, feeDeducted: true },
          });
        });

        feeDeducted = true;
      }
    }

    await prisma.order.update({
      where: { id: order.id },
      data: { internationalStatus: 'shipped', status: 'delivering' },
    });

    await prisma.warehouseLog.create({
      data: { orderId: order.id, operationType: 'scan_out', operatorId: actorUserId, trackingNumber },
    });

    const serviceTags = await resolveServiceTags(order.serviceTags as string[] | null);

    return reply.send({
      code: 1,
      msg: '出库成功',
      data: {
        id: order.id,
        postingNumber: order.postingNumber,
        platformOrderId: order.platformOrderId,
        internationalTrackingNumber: order.internationalTrackingNumber,
        internationalCarrier: order.internationalCarrier,
        items: order.items,
        shop: order.shop,
        status: 'delivering',
        serviceTags,
        serviceFee: serviceFee.toFixed(2),
        shippingFee: shippingFee.toFixed(2),
        totalFee: totalFee.toFixed(2),
        feeDeducted,
        labelUrl: `/api/orders/${order.id}/label`,
      },
    });
  });

  app.post('/inspection', async (request, reply) => {
    const { userId, role, actorUserId } = (request as any).user;
    const parsed = inspectionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
    }

    const { orderId, status, photos, note } = parsed.data;

    const shopIds = await getAccessibleShopIds(userId, role);

    const order = await prisma.order.findFirst({
      where: { id: orderId, shopId: { in: shopIds }, inspectionStatus: 'pending' },
    });

    if (!order) {
      return reply.send({ code: 0, msg: '订单不存在或无需验视' });
    }

    await prisma.order.update({
      where: { id: orderId },
      data: {
        inspectionStatus: status,
        inspectionPhotos: photos || [],
        inspectionNote: note || null,
      },
    });

    await prisma.warehouseLog.create({
      data: {
        orderId,
        operationType: status === 'passed' ? 'inspection_pass' : 'inspection_fail',
        operatorId: actorUserId,
        note,
        photos: photos || [],
      },
    });

    return reply.send({ code: 1, msg: status === 'passed' ? '验视通过' : '验视不通过' });
  });

  app.get('/inspection-queue', async (request, reply) => {
    const { userId, role } = (request as any).user;
    const shopIds = await getAccessibleShopIds(userId, role);

    const orders = await prisma.order.findMany({
      where: { shopId: { in: shopIds }, inspectionStatus: 'pending' },
      orderBy: { updatedAt: 'asc' },
      select: {
        id: true, postingNumber: true, platformOrderId: true,
        domesticTrackingNumber: true, domesticCarrier: true,
        items: true, serviceTags: true, serviceFee: true,
        createdAt: true, updatedAt: true,
        shop: { select: { name: true } },
      },
    });

    return reply.send({ code: 1, msg: 'ok', data: orders });
  });

  app.get('/logs', async (request, reply) => {
    const { userId, role } = (request as any).user;
    const query = request.query as { offset?: string; limit?: string; type?: string; date?: string };
    const offset = parseInt(query.offset || '0', 10);
    const limit = Math.min(parseInt(query.limit || '50', 10), 200);

    const shopIds = await getAccessibleShopIds(userId, role);

    const where: any = { order: { shopId: { in: shopIds } } };
    if (query.type) where.operationType = query.type;
    if (query.date) {
      const d = new Date(query.date);
      const next = new Date(d); next.setDate(next.getDate() + 1);
      where.createdAt = { gte: d, lt: next };
    }

    const [total, rows] = await Promise.all([
      prisma.warehouseLog.count({ where }),
      prisma.warehouseLog.findMany({
        where, skip: offset, take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          order: { select: { postingNumber: true, platformOrderId: true, domesticTrackingNumber: true, internationalTrackingNumber: true } },
        },
      }),
    ]);

    return reply.send({ code: 1, msg: 'ok', data: { total, rows } });
  });

  app.get('/dashboard', async (request, reply) => {
    const { userId, role } = (request as any).user;
    const shopIds = await getAccessibleShopIds(userId, role);

    if (shopIds.length === 0) {
      return reply.send({ code: 1, msg: 'ok', data: { todayIn: 0, todayOut: 0, inStock: 0, pendingInspection: 0, recentOps: [] } });
    }

    const today = new Date(); today.setHours(0, 0, 0, 0);

    const [todayIn, todayOut, inStock, pendingInspection] = await Promise.all([
      prisma.warehouseLog.count({ where: { operationType: 'scan_in', createdAt: { gte: today }, order: { shopId: { in: shopIds } } } }),
      prisma.warehouseLog.count({ where: { operationType: 'scan_out', createdAt: { gte: today }, order: { shopId: { in: shopIds } } } }),
      prisma.order.count({ where: { shopId: { in: shopIds }, domesticStatus: 'received', NOT: { internationalStatus: 'shipped' } } }),
      prisma.order.count({ where: { shopId: { in: shopIds }, inspectionStatus: 'pending' } }),
    ]);

    const recentOps = await prisma.warehouseLog.findMany({
      where: { order: { shopId: { in: shopIds } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { order: { select: { postingNumber: true, domesticTrackingNumber: true, internationalTrackingNumber: true, items: true, shop: { select: { name: true } } } } },
    });

    return reply.send({ code: 1, msg: 'ok', data: { todayIn, todayOut, inStock, pendingInspection, recentOps } });
  });

  app.get('/inventory', async (request, reply) => {
    const { userId, role } = (request as any).user;
    const query = request.query as { offset?: string; limit?: string; search?: string };
    const offset = parseInt(query.offset || '0', 10);
    const limit = Math.min(parseInt(query.limit || '20', 10), 100);

    const shopIds = await getAccessibleShopIds(userId, role);

    if (shopIds.length === 0) {
      return reply.send({ code: 1, msg: 'ok', data: { total: 0, rows: [] } });
    }

    const where: any = { shopId: { in: shopIds }, domesticStatus: 'received', NOT: { internationalStatus: 'shipped' } };
    if (query.search) {
      where.OR = [
        { postingNumber: { contains: query.search, mode: 'insensitive' } },
        { domesticTrackingNumber: { contains: query.search, mode: 'insensitive' } },
        { platformOrderId: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [total, rows] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where, skip: offset, take: limit, orderBy: { updatedAt: 'desc' },
        select: {
          id: true, postingNumber: true, platformOrderId: true,
          domesticTrackingNumber: true, domesticCarrier: true,
          internationalTrackingNumber: true, items: true,
          serviceTags: true, serviceFee: true, inspectionStatus: true,
          status: true, createdAt: true, updatedAt: true,
          shop: { select: { name: true, platform: true } },
        },
      }),
    ]);

    return reply.send({ code: 1, msg: 'ok', data: { total, rows } });
  });
}

async function resolveServiceTags(tagIds: string[] | null) {
  if (!tagIds || tagIds.length === 0) return [];
  const tags = await prisma.serviceTagConfig.findMany({
    where: { id: { in: tagIds } },
    select: { id: true, name: true, color: true, fee: true, needInspection: true },
  });
  return tags.map((t) => ({ ...t, fee: t.fee.toString() }));
}