import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { authenticate } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';

const syncRunQuerySchema = z.object({
  shopId: z.string().optional(),
  type: z.enum(['PRODUCT_PULL', 'PRODUCT_PUSH', 'ORDER_PULL', 'STOCK_PUSH', 'IMAGE_RESIZE', 'RETURN_PULL']).optional(),
  status: z.enum(['PENDING', 'RUNNING', 'SUCCESS', 'FAILED']).optional(),
  trigger: z.string().optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

const triggerSchema = z.object({
  shopId: z.string().optional(),
  shopIds: z.array(z.string()).min(1).max(20).optional(),
  syncTypes: z.array(z.enum(['PRODUCT_PULL', 'ORDER_PULL'])).min(1).max(2),
  since: z.string().optional(),
}).refine((data) => data.shopId || data.shopIds?.length, '请指定店铺');

type SyncType = 'PRODUCT_PULL' | 'ORDER_PULL';

export async function ozonSyncRoutes(app: FastifyInstance) {
  app.get('/notify/:shopId/:token', async (request, reply) => {
    const { shopId, token } = request.params as { shopId: string; token: string };
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { id: true, platform: true, status: true, config: true },
    });
    const configuredToken = getOzonNotificationToken(shop?.config);
    if (!shop || !configuredToken || configuredToken !== token) {
      return reply.status(401).send({ code: 0, msg: '通知密钥无效' });
    }
    if (shop.platform !== 'OZON') {
      return reply.status(400).send({ code: 0, msg: '仅支持 OZON 店铺通知' });
    }
    return reply.send({
      code: 1,
      msg: 'Ozon 通知地址可用',
      data: { shopId: shop.id, notificationReady: shop.status === 'ACTIVE', status: shop.status },
    });
  });

  app.post('/notify/:shopId/:token', async (request, reply) => {
    const { shopId, token } = request.params as { shopId: string; token: string };
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { id: true, platform: true, status: true, config: true },
    });

    const configuredToken = getOzonNotificationToken(shop?.config);
    if (!shop || !configuredToken || configuredToken !== token) {
      return reply.status(401).send({ code: 0, msg: '通知密钥无效' });
    }
    if (shop.platform !== 'OZON') {
      return reply.status(400).send({ code: 0, msg: '仅支持 OZON 店铺通知' });
    }
    if (shop.status !== 'ACTIVE') {
      return reply.status(409).send({ code: 0, msg: '店铺状态异常，未创建同步任务' });
    }

    const body = request.body ?? {};
    const eventType = detectOzonEventType(body);
    const eventKey = detectOzonEventKey(body);
    const payload = sanitizeWebhookPayload(body);
    const syncTypes = inferSyncTypesFromOzonNotification(eventType, body);
    const queued: Array<{ type: SyncType; jobId: string; syncJobId?: string }> = [];

    for (const type of syncTypes) {
      if (type === 'PRODUCT_PULL') {
        const { addProductSyncJob } = await import('../workers/product-sync.js');
        const job = await addProductSyncJob(shop.id, {
          trigger: 'ozon_notification',
          eventType,
          eventKey,
          payload,
          jobId: eventKey ? `ozon-notify-product:${shop.id}:${eventType}:${eventKey}` : undefined,
        });
        queued.push({ type, jobId: String(job.id || ''), syncJobId: stringOrUndefined((job as any).syncJobId) });
      } else {
        const { addOrderSyncJob } = await import('../workers/order-sync.js');
        const job = await addOrderSyncJob(shop.id, undefined, {
          trigger: 'ozon_notification',
          eventType,
          eventKey,
          payload,
          jobId: eventKey ? `ozon-notify-order:${shop.id}:${eventType}:${eventKey}` : undefined,
        });
        queued.push({ type, jobId: String(job.id || ''), syncJobId: stringOrUndefined((job as any).syncJobId) });
      }
    }

    return reply.status(202).send({
      code: 1,
      msg: '通知已接收，同步任务已创建',
      data: { eventType, eventKey, queued },
    });
  });

  app.get('/runs', { preHandler: authenticate }, async (request) => {
    const { userId } = (request as any).user;
    const query = syncRunQuerySchema.parse(request.query);

    const shops = await prisma.shop.findMany({
      where: { userId, platform: 'OZON' },
      select: { id: true },
    });
    const allowedShopIds = shops.map((shop) => shop.id);
    if (!allowedShopIds.length) {
      return { code: 1, msg: 'ok', data: { total: 0, rows: [] } };
    }

    const where: Record<string, unknown> = {
      shopId: query.shopId && allowedShopIds.includes(query.shopId)
        ? query.shopId
        : { in: allowedShopIds },
    };
    if (query.type) where.type = query.type;
    if (query.status) where.status = query.status;
    if (query.trigger) {
      where.payload = { path: ['trigger'], equals: query.trigger };
    }

    const [total, rows] = await Promise.all([
      prisma.syncJob.count({ where: where as any }),
      prisma.syncJob.findMany({
        where: where as any,
        skip: query.offset,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        include: { shop: { select: { name: true, platform: true } } },
      }),
    ]);

    return {
      code: 1,
      msg: 'ok',
      data: {
        total,
        rows: rows.map((row) => ({
          id: row.id,
          shopId: row.shopId,
          shopName: row.shop.name,
          platform: row.shop.platform,
          type: row.type,
          status: row.status,
          trigger: getPayloadString(row.payload, 'trigger') || 'system',
          eventType: getPayloadString(row.payload, 'eventType'),
          eventKey: getPayloadString(row.payload, 'eventKey'),
          resultSummary: summarizeSyncJobResult(row.type, row.result),
          errorMessage: row.errorMessage,
          startedAt: row.startedAt,
          finishedAt: row.finishedAt,
          createdAt: row.createdAt,
        })),
      },
    };
  });

  app.get('/shops', { preHandler: authenticate }, async (request) => {
    const { userId } = (request as any).user;
    const shops = await prisma.shop.findMany({
      where: { userId, platform: 'OZON' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        platform: true,
        status: true,
        lastSyncAt: true,
        config: true,
      },
    });

    return {
      code: 1,
      msg: 'ok',
      data: {
        rows: shops.map((shop) => {
          const token = getOzonNotificationToken(shop.config);
          return {
            id: shop.id,
            name: shop.name,
            platform: shop.platform,
            status: shop.status,
            lastSyncAt: shop.lastSyncAt,
            notificationEnabled: Boolean(token),
            notifyPath: token ? buildNotifyPath(shop.id, token) : null,
            autoSync: getAutoSyncConfig(shop.config),
          };
        }),
      },
    };
  });

  app.post('/shops/:shopId/notification-token', { preHandler: authenticate }, async (request, reply) => {
    const { userId } = (request as any).user;
    const { shopId } = request.params as { shopId: string };
    const shop = await prisma.shop.findFirst({
      where: { id: shopId, userId },
      select: { id: true, platform: true, status: true, config: true },
    });
    if (!shop) return reply.status(404).send({ code: 0, msg: '店铺不存在' });
    if (shop.platform !== 'OZON') return reply.status(400).send({ code: 0, msg: '仅支持 OZON 店铺' });

    const token = randomBytes(24).toString('hex');
    const config = mergeShopConfig(shop.config, { ozonNotificationToken: token });
    await prisma.shop.update({
      where: { id: shop.id },
      data: { config: config as any },
    });

    return reply.send({
      code: 1,
      msg: '通知地址已生成',
      data: {
        token,
        notifyPath: buildNotifyPath(shop.id, token),
      },
    });
  });

  app.post('/trigger', { preHandler: authenticate }, async (request, reply) => {
    const { userId } = (request as any).user;
    const parsed = triggerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    const requestedShopIds = parsed.data.shopIds?.length ? parsed.data.shopIds : [parsed.data.shopId!];
    const shops = await prisma.shop.findMany({
      where: { id: { in: requestedShopIds }, userId, platform: 'OZON' },
      select: { id: true, name: true, status: true },
    });
    if (!shops.length) {
      return reply.status(404).send({ code: 0, msg: '未找到可同步的 OZON 店铺' });
    }

    const queued: Array<{ shopId: string; shopName: string; type: SyncType; jobId: string; syncJobId?: string }> = [];
    const skipped: Array<{ shopId: string; shopName: string; reason: string }> = [];
    for (const shop of shops) {
      if (shop.status !== 'ACTIVE') {
        skipped.push({ shopId: shop.id, shopName: shop.name, reason: '店铺状态异常' });
        continue;
      }
      for (const type of parsed.data.syncTypes) {
        if (type === 'PRODUCT_PULL') {
          const { addProductSyncJob } = await import('../workers/product-sync.js');
          const job = await addProductSyncJob(shop.id, { trigger: 'manual' });
          queued.push({ shopId: shop.id, shopName: shop.name, type, jobId: String(job.id || ''), syncJobId: stringOrUndefined((job as any).syncJobId) });
        } else {
          const { addOrderSyncJob } = await import('../workers/order-sync.js');
          const job = await addOrderSyncJob(shop.id, parsed.data.since, { trigger: 'manual' });
          queued.push({ shopId: shop.id, shopName: shop.name, type, jobId: String(job.id || ''), syncJobId: stringOrUndefined((job as any).syncJobId) });
        }
      }
    }

    return reply.send({
      code: queued.length ? 1 : 0,
      msg: queued.length ? `已创建 ${queued.length} 个同步任务` : '没有创建同步任务',
      data: { queued, skipped },
    });
  });
}

function buildNotifyPath(shopId: string, token: string): string {
  return `/api/ozon-sync/notify/${shopId}/${token}`;
}

function mergeShopConfig(config: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  const base = config && typeof config === 'object' && !Array.isArray(config) ? config as Record<string, unknown> : {};
  return { ...base, ...patch };
}

function getOzonNotificationToken(config: unknown): string | null {
  const base = config && typeof config === 'object' && !Array.isArray(config) ? config as Record<string, unknown> : {};
  const token = base.ozonNotificationToken;
  return typeof token === 'string' && token.trim() ? token : null;
}

function getAutoSyncConfig(config: unknown): Record<string, unknown> {
  const base = config && typeof config === 'object' && !Array.isArray(config) ? config as Record<string, unknown> : {};
  const autoSync = base.autoSync;
  return autoSync && typeof autoSync === 'object' && !Array.isArray(autoSync) ? autoSync as Record<string, unknown> : {};
}

function detectOzonEventType(body: unknown): string {
  if (!body || typeof body !== 'object') return 'unknown';
  const source = body as Record<string, unknown>;
  const keys = ['event_type', 'notification_type', 'message_type', 'event', 'type', 'object_type'];
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return 'unknown';
}

function detectOzonEventKey(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const source = body as Record<string, unknown>;
  const directKeys = ['posting_number', 'postingNumber', 'order_id', 'orderId', 'product_id', 'productId', 'offer_id', 'offerId'];
  for (const key of directKeys) {
    const value = source[key];
    if (typeof value === 'string' || typeof value === 'number') {
      const text = String(value).trim();
      if (text) return text;
    }
  }
  return undefined;
}

function inferSyncTypesFromOzonNotification(eventType: string, body: unknown): SyncType[] {
  const text = `${eventType} ${JSON.stringify(body ?? {})}`.toLowerCase();
  const types = new Set<SyncType>();
  if (/(posting|order|shipment|delivery|cancel|return)/.test(text)) types.add('ORDER_PULL');
  if (/(product|offer|sku|stock|price|archive|item)/.test(text)) types.add('PRODUCT_PULL');
  if (!types.size) types.add('ORDER_PULL');
  return Array.from(types);
}

function sanitizeWebhookPayload(body: unknown): Record<string, unknown> {
  return sanitizeValue(body, 0) as Record<string, unknown>;
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > 4) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeValue(item, depth + 1));
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if (/(cookie|token|secret|authorization|auth|password|api[-_]?key|client[-_]?secret)/i.test(key)) {
        continue;
      }
      result[key] = sanitizeValue(raw, depth + 1);
    }
    return result;
  }
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}...` : value;
  return value;
}

function getPayloadString(payload: unknown, key: string): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function summarizeSyncJobResult(type: string, result: unknown): string | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  const data = result as Record<string, unknown>;
  if (typeof data.totalSynced === 'number') return `同步 ${data.totalSynced} 件`;
  if (typeof data.totalSynced === 'string') return `同步 ${data.totalSynced} 件`;
  if (typeof data.total === 'number') return `处理 ${data.total} 条`;
  if (typeof data.created === 'number' || typeof data.updated === 'number') {
    return `新增 ${Number(data.created || 0)}，更新 ${Number(data.updated || 0)}`;
  }
  if (type === 'ORDER_PULL' && typeof data.soloFeeTotal === 'number') return `服务费 ${data.soloFeeTotal}`;
  return null;
}

function stringOrUndefined(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return String(value);
}
