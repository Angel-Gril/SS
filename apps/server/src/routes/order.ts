import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { decrypt } from '../lib/crypto.js';
import { OzonClient } from '../services/ozon-client.js';
import { fetchLabelAsync } from '../services/ozon-label.js';
import { createOrderStockReadyService, type StockReadyResult } from '../services/order-stock-ready.js';
import { buildOrderListScope } from '../services/order-list-scope.js';
import { syncOrdersDirect, DirectSyncError, humanizeSyncError } from '../services/order-sync-direct.js';
import {
  matchesOrderFulfillmentFilter,
  isOrderFulfillmentFilterCompatible,
  ORDER_FULFILLMENT_STAGE_FILTER_KEYS,
  ORDER_FULFILLMENT_STATUS_KEYS,
  resolveOrderFulfillmentStage,
  resolveOrderFulfillmentStatus,
  type FulfillmentStageKey,
  type OrderFulfillmentStatus,
  type OrderFulfillmentStageInput,
} from 'shared/order-fulfillment-stage';

const fulfillmentStageKeys = ORDER_FULFILLMENT_STAGE_FILTER_KEYS;

function replyStockReady(reply: FastifyReply, result: StockReadyResult) {
  if (result.kind === 'not_found') return reply.status(404).send({ code: 0, msg: '订单不存在' });
  if (result.kind === 'immutable') return reply.status(409).send({ code: 0, msg: '订单当前状态不可确认已备货' });
  if (result.kind === 'rejected') return reply.status(409).send({ code: 0, msg: result.message });
  if (result.kind === 'pending') return reply.status(202).send({ code: 1, msg: result.message, data: { id: result.id, pending: true, fulfillmentStage: result.stage, fulfillmentStatus: result.status } });
  return reply.send({ code: 1, msg: result.replayed ? '已备货状态已存在' : '已确认备货', data: { id: result.id, stockPreparedAt: result.stockPreparedAt, fulfillmentStage: result.stage, fulfillmentStatus: result.status } });
}

type OrderStageFilterInput = OrderFulfillmentStageInput & {
  id: string;
};

type WarehouseStageLogInput = {
  orderId: string;
  operationType: string;
  createdAt: Date;
};

const orderQuerySchema = z.object({
  shopId: z.string().optional(),
  platform: z.enum(['OZON', 'YANDEX', 'KASPI', 'WILDBERRIES']).optional(),
  status: z.string().optional(),
  subStatus: z.string().trim().min(1).max(120).optional(),
  fulfillmentStage: z.enum(fulfillmentStageKeys).optional(),
  fulfillmentStatus: z.enum(ORDER_FULFILLMENT_STATUS_KEYS).optional(),
  search: z.string().optional(),
  searchField: z.enum(['all', 'posting', 'tracking', 'sku', 'product', 'purchase']).optional(),
  serviceTagId: z.string().optional(),
  userColorTagId: z.string().optional(),
  shipmentUrgency: z.enum(['overdue', 'today', 'tomorrow', 'within3d']).optional(),
  hasTracking: z.enum(['yes', 'no']).optional(),
  purchaseState: z.enum(['linked', 'unlinked']).optional(),
  shippingMethod: z.string().trim().min(1).max(120).optional(),
  sort: z.enum([
    'created_desc', 'created_asc', 'shipment_asc', 'shipment_desc',
    'amount_desc', 'amount_asc',
  ]).default('created_desc'),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(20),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional(),
}).superRefine((value, context) => {
  const parse = (date: string) => {
    const result = new Date(`${date}T00:00:00.000Z`);
    return Number.isFinite(result.getTime()) && result.toISOString().slice(0, 10) === date ? result : null;
  };
  const start = value.startDate ? parse(value.startDate) : null;
  const end = value.endDate ? parse(value.endDate) : null;
  if (value.startDate && !start) context.addIssue({ code: z.ZodIssueCode.custom, path: ['startDate'], message: '日期参数无效' });
  if (value.endDate && !end) context.addIssue({ code: z.ZodIssueCode.custom, path: ['endDate'], message: '日期参数无效' });
  if (start && end && start > end) context.addIssue({ code: z.ZodIssueCode.custom, path: ['endDate'], message: '结束日期不能早于开始日期' });
});

const labelPrintLogsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const userColorTagsBodySchema = z.object({
  tagIds: z.array(z.string()),
});

const batchUserColorTagsBodySchema = z.object({
  orderIds: z.array(z.string()).min(1, '请提供订单ID'),
  tagIds: z.array(z.string()),
});

export { buildOrderCreatedAtRange, filterOrderIdsByShipmentUrgency } from '../services/order-list-scope.js';

export function filterOrderIdsByFulfillmentStage(
  orders: OrderStageFilterInput[],
  warehouseLogs: WarehouseStageLogInput[],
  fulfillmentStage: FulfillmentStageKey | undefined,
  _now: Date = new Date(),
  fulfillmentStatus?: OrderFulfillmentStatus,
): string[] {
  const latestWarehouseLogByOrder = buildLatestWarehouseLogMap(warehouseLogs);

  return orders
    .filter((order) => {
      const logs = latestWarehouseLogByOrder.get(order.id);
      const stageInput = {
        ...order,
        warehouseScanInAt: logs?.scanInAt ?? null,
        warehouseScanOutAt: logs?.scanOutAt ?? null,
        labelPrintedAt: logs?.labelPrintedAt ?? null,
        stockPreparedAt: logs?.stockPreparedAt ?? null,
      };
      return matchesOrderFulfillmentFilter(stageInput, fulfillmentStage, fulfillmentStatus);
    })
    .map((order) => order.id);
}

function buildLatestWarehouseLogMap(
  warehouseLogs: WarehouseStageLogInput[],
): Map<string, { scanInAt?: Date; scanOutAt?: Date; labelPrintedAt?: Date; stockPreparedAt?: Date }> {
  const latestWarehouseLogByOrder = new Map<string, { scanInAt?: Date; scanOutAt?: Date; labelPrintedAt?: Date; stockPreparedAt?: Date }>();
  for (const log of warehouseLogs) {
    const current = latestWarehouseLogByOrder.get(log.orderId) || {};
    if (log.operationType === 'scan_in' && !current.scanInAt) {
      current.scanInAt = log.createdAt;
    }
    if (log.operationType === 'scan_out' && !current.scanOutAt) {
      current.scanOutAt = log.createdAt;
    }
    if (log.operationType === 'label_print' && !current.labelPrintedAt) {
      current.labelPrintedAt = log.createdAt;
    }
    if (log.operationType === 'stock_ready' && !current.stockPreparedAt) {
      current.stockPreparedAt = log.createdAt;
    }
    latestWarehouseLogByOrder.set(log.orderId, current);
  }
  return latestWarehouseLogByOrder;
}

function orderSort(sort: z.infer<typeof orderQuerySchema>['sort']) {
  switch (sort) {
    case 'created_asc': return [{ createdAt: 'asc' as const }];
    case 'shipment_asc': return [{ shipmentDate: 'asc' as const }, { createdAt: 'desc' as const }];
    case 'shipment_desc': return [{ shipmentDate: 'desc' as const }, { createdAt: 'desc' as const }];
    case 'amount_desc': return [{ totalAmount: 'desc' as const }, { createdAt: 'desc' as const }];
    case 'amount_asc': return [{ totalAmount: 'asc' as const }, { createdAt: 'desc' as const }];
    default: return [{ createdAt: 'desc' as const }];
  }
}

/** Restrict an existing id filter instead of replacing it. */
function restrictOrderIds(where: Record<string, unknown>, ids: string[]): void {
  const current = where.id;
  if (current && typeof current === 'object' && !Array.isArray(current)) {
    const currentIn = (current as { in?: unknown }).in;
    if (Array.isArray(currentIn)) {
      const allowed = new Set(ids);
      where.id = { in: currentIn.map(String).filter((id) => allowed.has(id)) };
      return;
    }
  }
  where.id = { in: ids };
}

export async function orderRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);
  const stockReady = createOrderStockReadyService(prisma as never);

  // Explicit operator confirmation. The log is the durable owner of this marker;
  // no client supplied actor or shop id is trusted.
  app.put('/:id/stock-ready', async (request, reply) => {
    const { userId } = (request as any).user;
    const actorUserId = (request as any).user.actorUserId ?? userId;
    const { id } = request.params as { id: string };
    const body = request.body as { prepared?: unknown };
    if (body?.prepared !== true || Object.keys(body || {}).some((key) => key !== 'prepared')) return reply.status(400).send({ code: 0, msg: '仅允许 prepared=true' });

    const result = await stockReady.mark({ orderId: id, ownerUserId: userId, actorUserId });
    return replyStockReady(reply, result);
  });

  // GET /api/orders/service-tags — 获取可用标签列表
  app.get('/service-tags', async (_request, reply) => {
    const tags = await prisma.serviceTagConfig.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true, color: true, description: true, fee: true, needInspection: true },
    });

    return reply.send({
      code: 1,
      msg: 'ok',
      data: tags.map((t) => ({ ...t, fee: t.fee.toString() })),
    });
  });

  // PUT /api/orders/:id/service-tags — 给订单打标签
  app.put('/:id/service-tags', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };
    const body = request.body as { tagIds: string[] };

    if (!body?.tagIds || !Array.isArray(body.tagIds)) {
      return reply.status(400).send({ code: 0, msg: '请提供标签ID列表' });
    }

    const order = await prisma.order.findUnique({
      where: { id },
      include: { shop: { select: { userId: true, status: true } } },
    });

    if (!order || order.shop.userId !== userId || order.shop.status === 'DISABLED') {
      return reply.status(404).send({ code: 0, msg: '订单不存在' });
    }

    // 查询选中的标签
    const tags = await prisma.serviceTagConfig.findMany({
      where: { id: { in: body.tagIds }, isActive: true },
    });

    // 计算总费用
    const totalFee = tags.reduce((sum, t) => sum + Number(t.fee), 0);
    // 判断是否需要验视
    const needInspection = tags.some((t) => t.needInspection);

    await prisma.order.update({
      where: { id },
      data: {
        serviceTags: body.tagIds,
        serviceFee: totalFee,
        inspectionStatus: needInspection ? 'pending' : null,
      },
    });

    return reply.send({
      code: 1,
      msg: '标签设置成功',
      data: { serviceTags: body.tagIds, serviceFee: totalFee.toString(), inspectionStatus: needInspection ? 'pending' : null },
    });
  });

  // POST /api/orders/batch-service-tags — 批量打标签
  app.post('/batch-service-tags', async (request, reply) => {
    const { userId } = (request as any).user;
    const body = request.body as { orderIds: string[]; tagIds: string[] };

    if (!body?.orderIds?.length || !body?.tagIds?.length) {
      return reply.status(400).send({ code: 0, msg: '请提供订单ID和标签ID' });
    }

    const userShops = await prisma.shop.findMany({
      where: { userId, status: { not: 'DISABLED' } },
      select: { id: true },
    });
    const shopIds = userShops.map((s) => s.id);

    const orders = await prisma.order.findMany({
      where: { id: { in: body.orderIds }, shopId: { in: shopIds } },
      select: { id: true },
    });
    const validIds = orders.map((o) => o.id);

    const tags = await prisma.serviceTagConfig.findMany({
      where: { id: { in: body.tagIds }, isActive: true },
    });
    const totalFee = tags.reduce((sum, t) => sum + Number(t.fee), 0);
    const needInspection = tags.some((t) => t.needInspection);

    await prisma.order.updateMany({
      where: { id: { in: validIds } },
      data: {
        serviceTags: body.tagIds,
        serviceFee: totalFee,
        inspectionStatus: needInspection ? 'pending' : null,
      },
    });

    return reply.send({
      code: 1,
      msg: `批量打标签完成: ${validIds.length} 个订单已更新`,
      data: { updated: validIds.length },
    });
  });

  // PUT /api/orders/:id/user-color-tags — 用户个人订单颜色标签，仅自己可见
  app.put('/:id/user-color-tags', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };
    const parsed = userColorTagsBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
    }

    const tagIds = Array.from(new Set(parsed.data.tagIds.filter(Boolean)));
    const order = await prisma.order.findUnique({
      where: { id },
      include: { shop: { select: { userId: true, status: true } } },
    });
    if (!order || order.shop.userId !== userId || order.shop.status === 'DISABLED') {
      return reply.status(404).send({ code: 0, msg: '订单不存在' });
    }

    if (tagIds.length > 0) {
      const owned = await prisma.userServiceTag.count({
        where: { id: { in: tagIds }, userId },
      });
      if (owned !== tagIds.length) {
        return reply.status(400).send({ code: 0, msg: '存在非法标签 ID' });
      }
    }

    const updated = await prisma.order.update({
      where: { id },
      data: { userColorTags: tagIds },
      select: { id: true, userColorTags: true },
    });

    return reply.send({ code: 1, msg: '已保存', data: updated });
  });

  // POST /api/orders/batch-user-color-tags — 批量设置用户个人订单颜色标签
  app.post('/batch-user-color-tags', async (request, reply) => {
    const { userId } = (request as any).user;
    const parsed = batchUserColorTagsBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
    }

    const orderIds = Array.from(new Set(parsed.data.orderIds.filter(Boolean)));
    const tagIds = Array.from(new Set(parsed.data.tagIds.filter(Boolean)));
    if (orderIds.length === 0) {
      return reply.status(400).send({ code: 0, msg: '请提供订单ID' });
    }

    if (tagIds.length > 0) {
      const owned = await prisma.userServiceTag.count({
        where: { id: { in: tagIds }, userId },
      });
      if (owned !== tagIds.length) {
        return reply.status(400).send({ code: 0, msg: '存在非法标签 ID' });
      }
    }

    const userShops = await prisma.shop.findMany({
      where: { userId, status: { not: 'DISABLED' } },
      select: { id: true },
    });
    const shopIds = userShops.map((s) => s.id);
    const orders = await prisma.order.findMany({
      where: { id: { in: orderIds }, shopId: { in: shopIds } },
      select: { id: true },
    });
    const validIds = orders.map((order) => order.id);
    if (validIds.length === 0) {
      return reply.send({ code: 1, msg: '没有可更新的订单', data: { updated: 0 } });
    }

    const result = await prisma.order.updateMany({
      where: { id: { in: validIds } },
      data: { userColorTags: tagIds },
    });

    return reply.send({
      code: 1,
      msg: `批量颜色标签完成: ${result.count} 个订单已更新`,
      data: { updated: result.count },
    });
  });

  app.get('/', async (request, reply) => {
    const { userId } = (request as any).user;
    const parsedQuery = orderQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) return reply.status(400).send({ code: 0, msg: parsedQuery.error.errors[0]?.message ?? '参数错误' });
    const query = parsedQuery.data;

    const userShops = await prisma.shop.findMany({
      where: { userId, status: { not: 'DISABLED' } },
      select: { id: true },
    });
    let shopIds = userShops.map((s) => s.id);
    if (query.platform && shopIds.length > 0) {
      const platformShops = await prisma.shop.findMany({
        where: { id: { in: shopIds }, platform: query.platform },
        select: { id: true },
      });
      shopIds = platformShops.map((shop) => shop.id);
    }

    if (shopIds.length === 0) {
      return { code: 1, msg: 'ok', data: { total: 0, rows: [] } };
    }

    let where: Record<string, unknown>;
    try {
      where = await buildOrderListScope(prisma as never, shopIds, query);
    } catch (error) {
      return reply.status(400).send({ code: 0, msg: error instanceof Error ? error.message : '参数错误' });
    }

    if (query.fulfillmentStage || query.fulfillmentStatus) {
      if (!isOrderFulfillmentFilterCompatible(query.fulfillmentStage, query.fulfillmentStatus)) {
        return reply.status(400).send({ code: 0, msg: '履约阶段与二级状态不匹配' });
      }
      const candidateOrders = await prisma.order.findMany({
        where: where as any,
        select: {
          id: true,
          status: true,
          subStatus: true,
          domesticTrackingNumber: true,
          domesticStatus: true,
          internationalTrackingNumber: true,
          internationalStatus: true,
          trackingNumber: true,
          inProcessAt: true,
          shipmentDate: true,
          deliveringDate: true,
          deliveredAt: true,
          inspectionStatus: true,
          shop: { select: { platform: true } },
        },
      });
      const candidateOrderIds = candidateOrders.map((order) => order.id);
      const warehouseLogs = candidateOrderIds.length > 0
        ? await prisma.warehouseLog.findMany({
            where: { orderId: { in: candidateOrderIds }, operationType: { in: ['scan_in', 'scan_out', 'label_print', 'stock_ready'] } },
            orderBy: { createdAt: 'desc' },
            select: { orderId: true, operationType: true, createdAt: true },
          })
        : [];
      const matchingOrderIds = filterOrderIdsByFulfillmentStage(
        candidateOrders,
        warehouseLogs,
        query.fulfillmentStage,
        new Date(),
        query.fulfillmentStatus,
      );
      restrictOrderIds(where, matchingOrderIds);
    }

    const [total, rows] = await Promise.all([
      prisma.order.count({ where: where as any }),
      prisma.order.findMany({
        where: where as any,
        skip: query.offset,
        take: query.limit,
        orderBy: orderSort(query.sort),
        select: {
          id: true,
          shopId: true,
          platformOrderId: true,
          postingNumber: true,
          status: true,
          subStatus: true,
          totalAmount: true,
          currency: true,
          items: true,
          trackingNumber: true,
          shippingMethod: true,
          inProcessAt: true,
          shipmentDate: true,
          deliveringDate: true,
          deliveredAt: true,
          createdAt: true,
          domesticTrackingNumber: true,
          domesticCarrier: true,
          domesticStatus: true,
          internationalTrackingNumber: true,
          internationalCarrier: true,
          internationalStatus: true,
          purchaseOrderId: true,
          purchasePlatform: true,
          serviceTags: true,
          userColorTags: true,
          serviceFee: true,
          inspectionStatus: true,
          shop: { select: { name: true, platform: true } },
        },
      }),
    ]);

    const orderIds = rows.map((row) => row.id);
    const warehouseLogs = orderIds.length > 0
      ? await prisma.warehouseLog.findMany({
          where: { orderId: { in: orderIds }, operationType: { in: ['scan_in', 'scan_out', 'label_print', 'stock_ready'] } },
          orderBy: { createdAt: 'desc' },
          select: { orderId: true, operationType: true, createdAt: true },
        })
      : [];
    const latestWarehouseLogByOrder = buildLatestWarehouseLogMap(warehouseLogs);

    return {
      code: 1,
      msg: 'ok',
      data: {
        total,
        rows: rows.map((r) => ({
          ...r,
          totalAmount: r.totalAmount?.toString() ?? '0',
          warehouseScanInAt: latestWarehouseLogByOrder.get(r.id)?.scanInAt ?? null,
          warehouseScanOutAt: latestWarehouseLogByOrder.get(r.id)?.scanOutAt ?? null,
          labelPrintedAt: latestWarehouseLogByOrder.get(r.id)?.labelPrintedAt ?? null,
          stockPreparedAt: latestWarehouseLogByOrder.get(r.id)?.stockPreparedAt ?? null,
          fulfillmentStage: resolveOrderFulfillmentStage({ ...r, warehouseScanInAt: latestWarehouseLogByOrder.get(r.id)?.scanInAt ?? null, warehouseScanOutAt: latestWarehouseLogByOrder.get(r.id)?.scanOutAt ?? null, stockPreparedAt: latestWarehouseLogByOrder.get(r.id)?.stockPreparedAt ?? null }).key,
          fulfillmentStatus: resolveOrderFulfillmentStatus({ ...r, warehouseScanInAt: latestWarehouseLogByOrder.get(r.id)?.scanInAt ?? null, warehouseScanOutAt: latestWarehouseLogByOrder.get(r.id)?.scanOutAt ?? null, stockPreparedAt: latestWarehouseLogByOrder.get(r.id)?.stockPreparedAt ?? null }),
        })),
      },
    };
  });

  app.get('/label-print-logs', async (request, reply) => {
    const { userId } = (request as any).user;
    const query = labelPrintLogsQuerySchema.parse(request.query);

    const userShops = await prisma.shop.findMany({
      where: { userId, status: { not: 'DISABLED' } },
      select: { id: true },
    });
    const shopIds = userShops.map((shop) => shop.id);
    if (shopIds.length === 0) {
      return reply.send({ code: 1, msg: 'ok', data: { rows: [] } });
    }

    const rows = await prisma.warehouseLog.findMany({
      where: {
        operationType: 'label_print',
        order: { shopId: { in: shopIds } },
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      select: {
        id: true,
        orderId: true,
        trackingNumber: true,
        createdAt: true,
        order: {
          select: {
            postingNumber: true,
            platformOrderId: true,
            status: true,
            shop: { select: { name: true, platform: true } },
          },
        },
      },
    });

    return reply.send({
      code: 1,
      msg: 'ok',
      data: {
        rows: rows.map((row) => ({
          id: row.id,
          orderId: row.orderId,
          postingNumber: row.order.postingNumber || row.order.platformOrderId,
          trackingNumber: row.trackingNumber,
          printedAt: row.createdAt,
          status: row.order.status,
          shop: row.order.shop,
        })),
      },
    });
  });

  app.get('/:id', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };

    const order = await prisma.order.findUnique({
      where: { id },
      include: { shop: { select: { id: true, name: true, platform: true, userId: true, status: true } } },
    });

    if (!order || order.shop.userId !== userId || order.shop.status === 'DISABLED') {
      return reply.status(404).send({ code: 0, msg: '订单不存在' });
    }

    const warehouseLogs = await prisma.warehouseLog.findMany({
      where: { orderId: id, operationType: { in: ['scan_in', 'scan_out', 'label_print', 'stock_ready'] } },
      orderBy: { createdAt: 'desc' },
      select: { operationType: true, createdAt: true },
    });
    const warehouseScanInAt = warehouseLogs.find((log) => log.operationType === 'scan_in')?.createdAt ?? null;
    const warehouseScanOutAt = warehouseLogs.find((log) => log.operationType === 'scan_out')?.createdAt ?? null;
    const labelPrintedAt = warehouseLogs.find((log) => log.operationType === 'label_print')?.createdAt ?? null;
    const stockPreparedAt = warehouseLogs.find((log) => log.operationType === 'stock_ready')?.createdAt ?? null;

    return {
      code: 1,
      msg: 'ok',
      data: {
        ...order,
        totalAmount: order.totalAmount?.toString() ?? '0',
        warehouseScanInAt,
        warehouseScanOutAt,
        labelPrintedAt,
        stockPreparedAt,
        fulfillmentStage: resolveOrderFulfillmentStage({ ...order, warehouseScanInAt, warehouseScanOutAt, labelPrintedAt, stockPreparedAt }).key,
        fulfillmentStatus: resolveOrderFulfillmentStatus({ ...order, warehouseScanInAt, warehouseScanOutAt, labelPrintedAt, stockPreparedAt }),
      },
    };
  });

  // GET /api/orders/:id/tracking — 物流时间线
  app.get('/:id/tracking', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };

    const order = await prisma.order.findUnique({
      where: { id },
      include: { shop: { select: { userId: true, status: true } } },
    });
    if (!order || order.shop.userId !== userId || order.shop.status === 'DISABLED') {
      return reply.status(404).send({ code: 0, msg: '订单不存在' });
    }

    const events = await prisma.orderTrackingEvent.findMany({
      where: { orderId: id },
      orderBy: { occurredAt: 'desc' },
    });

    return reply.send({
      code: 1,
      msg: 'ok',
      data: {
        postingNumber: order.postingNumber,
        trackingNumber: order.trackingNumber,
        internationalTrackingNumber: order.internationalTrackingNumber,
        currentStatus: order.subStatus,
        events,
      },
    });
  });

  app.post('/sync', async (request, reply) => {
    const { userId } = (request as any).user;
    const body = request.body as { shopId?: string; since?: string };

    if (!body.shopId) {
      return reply.status(400).send({ code: 0, msg: '请指定店铺' });
    }

    try {
      const { created, updated } = await syncOrdersDirect(body.shopId, userId, body.since);
      return reply.send({
        code: 1,
        msg: `同步完成：新增 ${created} 单，更新 ${updated} 单`,
        data: { created, updated, total: created + updated },
      });
    } catch (e: any) {
      if (e instanceof DirectSyncError) {
        return reply.send({
          code: 0,
          msg: `同步失败: ${humanizeSyncError(e.message)}`,
          data: e.partial,
        });
      }
      const msg = e.message || '未知错误';
      const code = msg === '店铺不存在' ? 404 : msg === '店铺状态异常，请先测试连接' ? 200 : 500;
      return reply.status(code).send({ code: 0, msg });
    }
  });

  // 批量发货
  app.post('/batch-ship', async (request, reply) => {
    const { userId } = (request as any).user;
    const body = request.body as { orderIds: string[]; trackingNumbers?: Record<string, string> };

    if (!Array.isArray(body?.orderIds) || !body.orderIds.length || body.orderIds.length > 100 || body.orderIds.some(id => typeof id !== 'string' || !id)) {
      return reply.status(400).send({ code: 0, msg: '请选择订单' });
    }

    const userShops = await prisma.shop.findMany({
      where: { userId, status: { not: 'DISABLED' } },
      select: { id: true, clientId: true, apiKeyEncrypted: true, platform: true },
    });
    const shopMap = new Map(userShops.map((s) => [s.id, s]));

    const orders = await prisma.order.findMany({
      where: {
        id: { in: body.orderIds },
        shopId: { in: userShops.map((s) => s.id) },
        status: { in: ['awaiting_packaging', 'awaiting_deliver'] },
      },
    });

    const results: { orderId: string; success: boolean; msg: string; pending?: boolean; fulfillmentStage?: string }[] = [];

    for (const order of orders) {
      const shop = shopMap.get(order.shopId);
      if (!shop) {
        results.push({ orderId: order.id, success: false, msg: '店铺不存在' });
        continue;
      }

      if (shop.platform === 'YANDEX') {
        results.push({ orderId: order.id, success: false, msg: 'Yandex 订单当前仅支持同步读取；发货需先完成 Yandex/LAAS 履约写入接线' });
        continue;
      }

      try {
        if (shop.platform === 'OZON') {
          const result = await stockReady.mark({ orderId: order.id, ownerUserId: userId, actorUserId: (request as any).user.actorUserId ?? userId });
          results.push({ orderId: order.id, success: result.kind === 'marked',
            pending: result.kind === 'pending', fulfillmentStage: 'stage' in result ? result.stage : undefined,
            msg: result.kind === 'marked' ? 'Ozon 已确认备货' : result.kind === 'pending' || result.kind === 'rejected' ? result.message : '订单当前状态不可备货' });
          continue;
        }

        const trackingNumber = body.trackingNumbers?.[order.id] || order.trackingNumber;
        await prisma.order.update({
          where: { id: order.id },
          data: { status: 'delivering', trackingNumber, shipmentDate: new Date() },
        });
        results.push({ orderId: order.id, success: true, msg: '发货成功' });
      } catch (e: any) {
        results.push({ orderId: order.id, success: false, msg: e.message });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    return reply.send({
      code: 1,
      msg: `批量处理完成: ${successCount}/${orders.length} 成功`,
      data: { results },
    });
  });

  app.post('/:id/ship', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };
    const body = request.body as {
      trackingNumber?: string;
      packages?: { products: { product_id: number; quantity: number }[] }[];
    };

    const order = await prisma.order.findUnique({
      where: { id },
      include: { shop: { select: { id: true, userId: true, clientId: true, apiKeyEncrypted: true, platform: true, status: true } } },
    });

    if (!order || order.shop.userId !== userId || order.shop.status === 'DISABLED') {
      return reply.status(404).send({ code: 0, msg: '订单不存在' });
    }

    if (order.shop.platform === 'OZON') {
      if (body?.packages !== undefined) return reply.status(400).send({ code: 0, msg: 'Ozon 确认备货使用完整订单商品，请通过平台处理拆包后同步订单' });
      return replyStockReady(reply, await stockReady.mark({ orderId: id, ownerUserId: userId, actorUserId: (request as any).user.actorUserId ?? userId }));
    }

    if (order.shop.platform === 'YANDEX') {
      return reply.status(409).send({ code: 0, msg: 'Yandex 订单当前仅支持同步读取；发货需先完成 Yandex/LAAS 履约写入接线' });
    }

    if (order.status !== 'awaiting_packaging' && order.status !== 'awaiting_deliver') {
      return reply.send({ code: 0, msg: `当前状态 ${order.status} 不允许发货` });
    }

    await prisma.order.update({
      where: { id },
      data: {
        status: 'delivering',
        trackingNumber: body.trackingNumber || order.trackingNumber,
        shipmentDate: new Date(),
      },
    });

    return reply.send({ code: 1, msg: '发货成功' });
  });

  app.post('/:id/cancel', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };
    const body = request.body as { reasonId: number; message?: string };

    if (!body?.reasonId) {
      return reply.status(400).send({ code: 0, msg: '请提供取消原因' });
    }

    const order = await prisma.order.findUnique({
      where: { id },
      include: { shop: { select: { id: true, userId: true, clientId: true, apiKeyEncrypted: true, platform: true, status: true } } },
    });

    if (!order || order.shop.userId !== userId || order.shop.status === 'DISABLED') {
      return reply.status(404).send({ code: 0, msg: '订单不存在' });
    }

    if (order.status === 'delivered' || order.status === 'cancelled') {
      return reply.send({ code: 0, msg: `当前状态 ${order.status} 不允许取消` });
    }

    if (order.shop.platform === 'OZON' && order.postingNumber) {
      const client = new OzonClient({
        clientId: order.shop.clientId!,
        apiKey: decrypt(order.shop.apiKeyEncrypted),
      });

      try {
        await client.cancelPosting({
          posting_number: order.postingNumber,
          cancel_reason_id: Number(body.reasonId),
          cancel_reason_message: body.message,
        });
      } catch (e: any) {
        return reply.send({ code: 0, msg: `OZON 取消失败: ${e.message}` });
      }
    }

    if (order.shop.platform === 'YANDEX') {
      return reply.status(409).send({ code: 0, msg: 'Yandex 订单当前仅支持同步读取；取消需先完成 Yandex/LAAS 履约写入接线' });
    }

    await prisma.order.update({
      where: { id },
      data: { status: 'cancelled', subStatus: 'cancelled_by_seller' },
    });

    return reply.send({ code: 1, msg: '订单已取消' });
  });

  app.get('/:id/label', async (request, reply) => {
    const { userId } = (request as any).user;
    const actorUserId = (request as any).user.actorUserId ?? userId;
    const { id } = request.params as { id: string };
    const query = request.query as { format?: string };

    const order = await prisma.order.findUnique({
      where: { id },
      include: { shop: { select: { userId: true, clientId: true, apiKeyEncrypted: true, platform: true, status: true } } },
    });

    if (!order || order.shop.userId !== userId || order.shop.status === 'DISABLED') {
      return reply.status(404).send({ code: 0, msg: '订单不存在' });
    }

    if (order.shop.platform !== 'OZON' || !order.postingNumber) {
      return reply.send({ code: 0, msg: '当前订单不支持面单下载' });
    }

    const client = new OzonClient({
      clientId: order.shop.clientId!,
      apiKey: decrypt(order.shop.apiKeyEncrypted),
    });

    let realStatus: string | undefined;
    try {
      const posting = await client.getPostingByNumber(order.postingNumber);
      realStatus = posting?.status;
      if (realStatus && realStatus !== order.status) {
        await prisma.order.update({ where: { id }, data: { status: realStatus } });
      }
    } catch {}

    const labelStatuses = ['awaiting_deliver', 'delivering', 'driver_pickup', 'sent_by_seller'];
    const effectiveStatus = realStatus || order.status;
    if (!labelStatuses.includes(effectiveStatus)) {
      const statusMap: Record<string, string> = {
        awaiting_packaging: '待打包 — 请先在 OZON 后台或本系统执行"确认打包"操作',
        delivered: '已送达 — 面单已过期',
        cancelled: '已取消',
      };
      const hint = statusMap[effectiveStatus] || effectiveStatus;
      return reply.send({
        code: 0,
        msg: `OZON 实际状态: ${hint}。面单仅在"待发货/配送中"状态可用。`,
      });
    }

    let buffer: Buffer;
    let contentType: string;

    try {
      const result = await fetchLabelAsync(client, order.postingNumber);
      buffer = result.buffer;
      contentType = result.contentType;
    } catch (error: any) {
      return reply.send({ code: 0, msg: `面单下载失败: ${error.message}` });
    }

    try {
      await prisma.warehouseLog.create({
        data: {
          orderId: order.id,
          operationType: 'label_print',
          operatorId: actorUserId,
          trackingNumber: order.trackingNumber || order.internationalTrackingNumber || order.postingNumber,
        },
      });
    } catch (e: any) {
      console.warn(`[OrderLabel] label_print log failed for ${order.id}: ${e.message}`);
    }

    if (query.format === 'base64') {
      return reply.send({
        code: 1,
        msg: 'ok',
        data: {
          base64: buffer.toString('base64'),
          contentType,
          filename: `label-${order.postingNumber}.pdf`,
        },
      });
    }

    reply.header('Content-Type', contentType);
    reply.header('Content-Disposition', `attachment; filename="label-${order.postingNumber}.pdf"`);
    return reply.send(buffer);
  });

  app.post('/labels', async (request, reply) => {
    const { userId } = (request as any).user;
    const actorUserId = (request as any).user.actorUserId ?? userId;
    const body = request.body as { orderIds: string[] };

    if (!body?.orderIds?.length) {
      return reply.status(400).send({ code: 0, msg: '请选择订单' });
    }

    const orders = await prisma.order.findMany({
      where: { id: { in: body.orderIds } },
      include: { shop: { select: { userId: true, clientId: true, apiKeyEncrypted: true, platform: true, status: true } } },
    });

    const valid = orders.filter(
      (o) => o.shop.userId === userId && o.shop.status !== 'DISABLED' && o.shop.platform === 'OZON' && o.postingNumber,
    );

    if (valid.length === 0) {
      return reply.send({ code: 0, msg: '没有可下载面单的订单' });
    }

    const byShop = new Map<string, typeof valid>();
    for (const o of valid) {
      const key = `${o.shop.clientId}:${o.shop.apiKeyEncrypted}`;
      const arr = byShop.get(key) || [];
      arr.push(o);
      byShop.set(key, arr);
    }

    if (byShop.size > 1) {
      return reply.send({ code: 0, msg: '请按店铺分批下载面单' });
    }

    const [first] = valid;
    if (!first) {
      return reply.send({ code: 0, msg: '没有可下载面单的订单' });
    }
    const client = new OzonClient({
      clientId: first.shop.clientId!,
      apiKey: decrypt(first.shop.apiKeyEncrypted),
    });

    try {
      const postingNumbers = valid.map((o) => o.postingNumber!);
      const { buffer, contentType } = await fetchLabelAsync(client, postingNumbers);
      try {
        await prisma.warehouseLog.createMany({
          data: valid.map((order) => ({
            orderId: order.id,
            operationType: 'label_print',
            operatorId: actorUserId,
            trackingNumber: order.trackingNumber || order.internationalTrackingNumber || order.postingNumber,
          })),
        });
      } catch (logError: any) {
        console.warn(`[OrderLabel] batch label_print log failed: ${logError.message}`);
      }
      reply.header('Content-Type', contentType);
      reply.header('Content-Disposition', `attachment; filename="labels-${valid.length}.pdf"`);
      return reply.send(buffer);
    } catch (e: any) {
      return reply.send({ code: 0, msg: `面单下载失败: ${e.message}` });
    }
  });

  // ========== 物流绑定 API ==========

  const domesticTrackingSchema = z.object({
    domesticTrackingNumber: z.string().min(1, '国内快递单号不能为空'),
    domesticCarrier: z.enum(['顺丰', '圆通', '中通', '韵达', '极兔', '申通', '百世', 'EMS', '邮政', '其他']),
    purchaseOrderId: z.string().optional(),
    purchasePlatform: z.enum(['1688', 'taobao', 'pinduoduo', 'other']).optional(),
    purchaseAmount: z.number().positive().optional(),
  });

  const internationalTrackingSchema = z.object({
    internationalTrackingNumber: z.string().min(1, '国际物流单号不能为空'),
    internationalCarrier: z.string().min(1, '国际物流公司不能为空'),
  });

  // 绑定国内快递单号
  app.put('/:id/domestic-tracking', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };

    const parsed = domesticTrackingSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
    }

    const order = await prisma.order.findUnique({
      where: { id },
      include: { shop: { select: { userId: true, status: true } } },
    });

    if (!order || order.shop.userId !== userId || order.shop.status === 'DISABLED') {
      return reply.status(404).send({ code: 0, msg: '订单不存在' });
    }

    const { domesticTrackingNumber, domesticCarrier, purchaseOrderId, purchasePlatform, purchaseAmount } = parsed.data;

    await prisma.order.update({
      where: { id },
      data: {
        domesticTrackingNumber,
        domesticCarrier,
        domesticStatus: 'shipped',
        ...(purchaseOrderId && { purchaseOrderId }),
        ...(purchasePlatform && { purchasePlatform }),
        ...(purchaseAmount && { purchaseAmount }),
      },
    });

    return reply.send({ code: 1, msg: '国内快递单号绑定成功' });
  });

  // 绑定国际物流单号
  app.put('/:id/international-tracking', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };

    const parsed = internationalTrackingSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
    }

    const order = await prisma.order.findUnique({
      where: { id },
      include: { shop: { select: { userId: true, status: true } } },
    });

    if (!order || order.shop.userId !== userId || order.shop.status === 'DISABLED') {
      return reply.status(404).send({ code: 0, msg: '订单不存在' });
    }

    const { internationalTrackingNumber, internationalCarrier } = parsed.data;

    await prisma.order.update({
      where: { id },
      data: {
        internationalTrackingNumber,
        internationalCarrier,
        internationalStatus: 'pending',
      },
    });

    return reply.send({ code: 1, msg: '国际物流单号绑定成功' });
  });

  // 批量绑定国内快递单号
  const batchDomesticSchema = z.object({
    items: z.array(z.object({
      orderId: z.string(),
      domesticTrackingNumber: z.string().min(1),
      domesticCarrier: z.enum(['顺丰', '圆通', '中通', '韵达', '极兔', '申通', '百世', 'EMS', '邮政', '其他']),
      purchaseOrderId: z.string().optional(),
      purchasePlatform: z.enum(['1688', 'taobao', 'pinduoduo', 'other']).optional(),
      purchaseAmount: z.number().positive().optional(),
    })).min(1, '至少提供一条记录'),
  });

  app.post('/batch-domestic-tracking', async (request, reply) => {
    const { userId } = (request as any).user;

    const parsed = batchDomesticSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
    }

    const userShops = await prisma.shop.findMany({
      where: { userId, status: { not: 'DISABLED' } },
      select: { id: true },
    });
    const shopIds = userShops.map((s) => s.id);

    const orderIds = parsed.data.items.map((item) => item.orderId);
    const orders = await prisma.order.findMany({
      where: { id: { in: orderIds }, shopId: { in: shopIds } },
      select: { id: true },
    });
    const validIds = new Set(orders.map((o) => o.id));

    const results: { orderId: string; success: boolean; msg: string }[] = [];

    for (const item of parsed.data.items) {
      if (!validIds.has(item.orderId)) {
        results.push({ orderId: item.orderId, success: false, msg: '订单不存在或无权限' });
        continue;
      }

      try {
        await prisma.order.update({
          where: { id: item.orderId },
          data: {
            domesticTrackingNumber: item.domesticTrackingNumber,
            domesticCarrier: item.domesticCarrier,
            domesticStatus: 'shipped',
            ...(item.purchaseOrderId && { purchaseOrderId: item.purchaseOrderId }),
            ...(item.purchasePlatform && { purchasePlatform: item.purchasePlatform }),
            ...(item.purchaseAmount && { purchaseAmount: item.purchaseAmount }),
          },
        });
        results.push({ orderId: item.orderId, success: true, msg: '绑定成功' });
      } catch (e: any) {
        results.push({ orderId: item.orderId, success: false, msg: e.message });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    return reply.send({
      code: 1,
      msg: `批量绑定完成: ${successCount}/${parsed.data.items.length} 成功`,
      data: { results },
    });
  });

  // 获取订单完整物流信息
  app.get('/:id/logistics', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };

    const order = await prisma.order.findUnique({
      where: { id },
      include: { shop: { select: { userId: true, name: true, platform: true, status: true } } },
    });

    if (!order || order.shop.userId !== userId || order.shop.status === 'DISABLED') {
      return reply.status(404).send({ code: 0, msg: '订单不存在' });
    }

    const warehouseLogs = await prisma.warehouseLog.findMany({
      where: { orderId: id, operationType: { in: ['scan_in', 'scan_out', 'label_print'] } },
      orderBy: { createdAt: 'desc' },
      select: { operationType: true, createdAt: true },
    });
    const warehouseScanInAt = warehouseLogs.find((log) => log.operationType === 'scan_in')?.createdAt ?? null;
    const warehouseScanOutAt = warehouseLogs.find((log) => log.operationType === 'scan_out')?.createdAt ?? null;
    const labelPrintedAt = warehouseLogs.find((log) => log.operationType === 'label_print')?.createdAt ?? null;

    return reply.send({
      code: 1,
      msg: 'ok',
      data: {
        orderId: order.id,
        postingNumber: order.postingNumber,
        platformOrderId: order.platformOrderId,
        status: order.status,
        subStatus: order.subStatus,
        trackingNumber: order.trackingNumber,
        inProcessAt: order.inProcessAt,
        shipmentDate: order.shipmentDate,
        deliveringDate: order.deliveringDate,
        deliveredAt: order.deliveredAt,
        domesticTrackingNumber: order.domesticTrackingNumber,
        domesticStatus: order.domesticStatus,
        internationalTrackingNumber: order.internationalTrackingNumber,
        internationalStatus: order.internationalStatus,
        inspectionStatus: order.inspectionStatus,
        warehouseScanInAt,
        warehouseScanOutAt,
        labelPrintedAt,
        // 采购信息
        purchase: {
          orderId: order.purchaseOrderId,
          platform: order.purchasePlatform,
          amount: order.purchaseAmount?.toString() ?? null,
        },
        // 国内物流
        domestic: {
          trackingNumber: order.domesticTrackingNumber,
          carrier: order.domesticCarrier,
          status: order.domesticStatus,
        },
        // 国际物流
        international: {
          trackingNumber: order.internationalTrackingNumber,
          carrier: order.internationalCarrier,
          status: order.internationalStatus,
        },
        // OZON 平台物流
        platform: {
          trackingNumber: order.trackingNumber,
          shippingMethod: order.shippingMethod,
        },
      },
    });
  });

}
