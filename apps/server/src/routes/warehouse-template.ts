import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Queue } from 'bullmq';
import { redisDisabled } from '../lib/redis.js';
import { authenticate, requireRole } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { decrypt } from '../lib/crypto.js';
import { OzonClient, OzonApiError } from '../services/ozon-client.js';
import { createNotification } from './notification.js';

const scheduledDispatchQueue: Queue | null = redisDisabled
  ? null
  : new Queue('scheduled-warehouse-dispatch', { connection: { host: '127.0.0.1', port: 6379 } });

const createTemplateSchema = z.object({
  name: z.string().min(1),
  warehouseType: z.enum(['fbs', 'aggregator', 'non_integrated']).default('fbs'),

  // 步骤1：仓库信息（地址 + 电话）
  phone: z.string().min(1),
  countryCode: z.string().default('CN'),
  city: z.string().optional(),
  street: z.string().optional(),
  zipCode: z.string().optional(),
  building: z.string().optional(),
  block: z.string().optional(),
  latitude: z.coerce.number().optional(),
  longitude: z.coerce.number().optional(),

  // 步骤2：仓库参数
  minWorkingDays: z.coerce.number().min(1).max(30).default(5),
  workingDays: z.array(z.string()).default(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']),
  workingHourFrom: z.string().default('09:00'),
  workingHourTo: z.string().default('18:00'),
  holidays: z.array(z.object({
    day: z.string(),
    isWorking: z.boolean().default(false),
    from: z.string().optional(),
    to: z.string().optional(),
  })).optional(),

  // 步骤3：退货
  returnPolicy: z.enum(['destroy', 'send_back']).default('send_back'),
  returnCarrier: z.string().optional(),
  returnAddressSameAsWarehouse: z.boolean().default(true),
  returnPhoneSameAsWarehouse: z.boolean().default(true),
  returnRecipient: z.string().optional(),
  returnMethod: z.enum(['COURIER', 'POST']).optional(),
  returnZipCode: z.string().optional(),

  // 聚合器/Ozon Partners 字段
  firstMileType: z.enum(['DROP_OFF', 'PICK_UP']).default('DROP_OFF'),
  dropOffPointId: z.string().optional(),
  cutInTime: z.coerce.number().default(0),
  timeslotId: z.coerce.number().default(0),
  returnPointId: z.string().optional(),
  isKgt: z.boolean().default(false),
  warehouseOptions: z.object({
    comment: z.string().optional(),
    courier_phones: z.array(z.string()).optional(),
    is_auto_assembly: z.boolean().optional(),
    is_waybill_enabled: z.boolean().optional(),
  }).optional(),
  deliveryMethodPayload: z.record(z.unknown()).optional(),
  isRecommended: z.boolean().default(false),
});

const updateTemplateSchema = createTemplateSchema.partial();

const dispatchCommandSchema = z.object({
  shopIds: z.array(z.string()).min(1),
  templateId: z.string().min(1),
  commandType: z.enum(['create_warehouse', 'update_delivery_method']).default('create_warehouse'),
});

export async function warehouseTemplateRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', requireRole('ADMIN'));

  app.get('/templates', async (_request, reply) => {
    const list = await prisma.warehouseTemplate.findMany({
      orderBy: [{ isRecommended: 'desc' }, { createdAt: 'desc' }],
    });
    return reply.send({ code: 1, msg: 'ok', data: list });
  });

  app.post('/templates', async (request, reply) => {
    const parsed = createTemplateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
    }
    const d = parsed.data;
    const tpl = await prisma.warehouseTemplate.create({
      data: {
        name: d.name,
        warehouseType: d.warehouseType,
        phone: d.phone,
        countryCode: d.countryCode,
        city: d.city,
        street: d.street,
        zipCode: d.zipCode,
        building: d.building,
        block: d.block,
        latitude: d.latitude,
        longitude: d.longitude,
        minWorkingDays: d.minWorkingDays,
        workingDays: d.workingDays as any,
        workingHourFrom: d.workingHourFrom,
        workingHourTo: d.workingHourTo,
        holidays: d.holidays as any,
        returnPolicy: d.returnPolicy,
        returnCarrier: d.returnCarrier,
        returnAddressSameAsWarehouse: d.returnAddressSameAsWarehouse,
        returnPhoneSameAsWarehouse: d.returnPhoneSameAsWarehouse,
        returnRecipient: d.returnRecipient,
        returnMethod: d.returnMethod,
        returnZipCode: d.returnZipCode,
        firstMileType: d.firstMileType,
        dropOffPointId: d.dropOffPointId,
        cutInTime: d.cutInTime,
        timeslotId: d.timeslotId,
        returnPointId: d.returnPointId,
        isKgt: d.isKgt,
        warehouseOptions: d.warehouseOptions as any,
        deliveryMethodPayload: d.deliveryMethodPayload as any,
        isRecommended: d.isRecommended,
      },
    });
    return reply.send({ code: 1, msg: '已创建', data: tpl });
  });

  app.put('/templates/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateTemplateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
    }
    const data: any = { ...parsed.data };
    if (data.workingDays) data.workingDays = data.workingDays as any;
    if (data.warehouseOptions) data.warehouseOptions = data.warehouseOptions as any;
    if (data.deliveryMethodPayload) data.deliveryMethodPayload = data.deliveryMethodPayload as any;
    if (data.holidays) data.holidays = data.holidays as any;
    const tpl = await prisma.warehouseTemplate.update({ where: { id }, data });
    return reply.send({ code: 1, msg: '已更新', data: tpl });
  });

  app.delete('/templates/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const inUse = await prisma.warehouseUpdateCommand.count({
      where: { templateId: id, status: { in: ['pending', 'accepted', 'running'] } },
    });
    if (inUse > 0) {
      return reply.status(400).send({ code: 0, msg: '存在进行中的指令，不能删除模板' });
    }
    await prisma.warehouseTemplate.delete({ where: { id } });
    return reply.send({ code: 1, msg: '已删除' });
  });

  app.get('/commands', async (request, reply) => {
    const { status, shopId } = request.query as { status?: string; shopId?: string };
    const where: any = {};
    if (status) where.status = status;
    if (shopId) where.shopId = shopId;
    const list = await prisma.warehouseUpdateCommand.findMany({
      where,
      include: {
        template: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const shopIds = [...new Set(list.map((c) => c.shopId))];
    const shops = await prisma.shop.findMany({
      where: { id: { in: shopIds } },
      select: { id: true, name: true, userId: true, user: { select: { phone: true, nickname: true } } },
    });
    const shopMap = new Map(shops.map((s) => [s.id, s]));
    return reply.send({
      code: 1,
      msg: 'ok',
      data: list.map((c) => ({ ...c, shop: shopMap.get(c.shopId) || null })),
    });
  });

  app.post('/commands/dispatch', async (request, reply) => {
    const { userId, actorUserId } = (request as any).user;
    const parsed = dispatchCommandSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
    }
    const tpl = await prisma.warehouseTemplate.findUnique({ where: { id: parsed.data.templateId } });
    if (!tpl) return reply.status(404).send({ code: 0, msg: '模板不存在' });

    const shops = await prisma.shop.findMany({
      where: { id: { in: parsed.data.shopIds } },
      select: { id: true, userId: true, name: true },
    });

    const created: string[] = [];
    for (const shop of shops) {
      const cmd = await prisma.warehouseUpdateCommand.create({
        data: {
          shopId: shop.id,
          templateId: tpl.id,
          commandType: parsed.data.commandType,
          status: 'pending',
          createdBy: actorUserId,
        },
      });
      created.push(cmd.id);
      const actionLabel = parsed.data.commandType === 'update_delivery_method' ? '物流方式更新' : '仓库同步';
      await createNotification(shop.userId, {
        type: 'warehouse_update',
        title: `收到${actionLabel}指令`,
        content: `店铺「${shop.name}」收到管理员${actionLabel}指令：${tpl.name}，请前往确认`,
        link: `/warehouse-commands/${cmd.id}`,
      });
    }
    return reply.send({ code: 1, msg: `已下发 ${created.length} 条指令`, data: { ids: created } });
  });

  app.delete('/commands/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const cmd = await prisma.warehouseUpdateCommand.findUnique({ where: { id } });
    if (!cmd) return reply.status(404).send({ code: 0, msg: '指令不存在' });
    if (cmd.status === 'running') {
      return reply.status(400).send({ code: 0, msg: '指令正在执行中，无法撤回' });
    }
    await prisma.warehouseUpdateCommand.delete({ where: { id } });
    return reply.send({ code: 1, msg: '已撤回' });
  });

  app.get('/ozon/warehouses/:shopId', async (request, reply) => {
    const { shopId } = request.params as { shopId: string };
    const shop = await prisma.shop.findUnique({ where: { id: shopId } });
    if (!shop || !shop.clientId) return reply.status(404).send({ code: 0, msg: '店铺不存在或未配置 OZON 凭证' });
    try {
      const client = new OzonClient({ clientId: shop.clientId, apiKey: decrypt(shop.apiKeyEncrypted) });
      const [rfbs, fbo] = await Promise.all([
        client.getWarehouseList().catch(() => []),
        client.listFboWarehouses().catch(() => []),
      ]);
      return reply.send({ code: 1, msg: 'ok', data: { rfbs, fbo } });
    } catch (e) {
      const msg = e instanceof OzonApiError ? e.message : (e as Error).message;
      return reply.status(502).send({ code: 0, msg: `OZON 接口调用失败：${msg}` });
    }
  });

  app.post('/commands/schedule', async (request, reply) => {
    const { userId, actorUserId } = (request as any).user;
    const body = request.body as { shopIds: string[]; templateId: string; scheduledAt: string };
    if (!body?.shopIds?.length || !body.templateId || !body.scheduledAt) {
      return reply.status(400).send({ code: 0, msg: '缺少 shopIds / templateId / scheduledAt' });
    }
    const scheduledTime = new Date(body.scheduledAt);
    const delay = scheduledTime.getTime() - Date.now();
    if (delay < 60_000) {
      return reply.status(400).send({ code: 0, msg: '定时时间必须在 1 分钟以后' });
    }
    const tpl = await prisma.warehouseTemplate.findUnique({ where: { id: body.templateId } });
    if (!tpl) return reply.status(404).send({ code: 0, msg: '模板不存在' });

    if (!scheduledDispatchQueue) {
      return reply.status(503).send({ code: 0, msg: '当前部署模式不支持定时分发（需要 Redis）' });
    }

    await scheduledDispatchQueue.add(
      'dispatch',
      { shopIds: body.shopIds, templateId: body.templateId, createdBy: actorUserId },
      { delay, removeOnComplete: 50, removeOnFail: 20 },
    );

    return reply.send({
      code: 1,
      msg: `已安排定时下发，将于 ${scheduledTime.toLocaleString()} 执行`,
      data: { scheduledAt: body.scheduledAt, shopCount: body.shopIds.length },
    });
  });

  // OZON 接口探测：用任意 shop 的凭证调任意端点，返回原始响应
  app.post('/ozon/probe', async (request, reply) => {
    const body = request.body as {
      shopId: string;
      endpoint: string;
      method?: string;
      payload?: any;
    };
    if (!body?.shopId || !body?.endpoint) {
      return reply.status(400).send({ code: 0, msg: '缺少 shopId / endpoint' });
    }
    const shop = await prisma.shop.findUnique({ where: { id: body.shopId } });
    if (!shop || !shop.clientId) {
      return reply.status(404).send({ code: 0, msg: '店铺不存在或未配置 OZON 凭证' });
    }

    const startedAt = Date.now();
    try {
      const client = new OzonClient({
        clientId: shop.clientId,
        apiKey: decrypt(shop.apiKeyEncrypted),
        maxRetries: 0,
      });
      const result = await client.request(body.endpoint, {
        method: body.method || 'POST',
        body: body.payload ?? {},
        skipRetry: true,
      });
      return reply.send({
        code: 1,
        msg: 'ok',
        data: {
          status: 200,
          ok: true,
          durationMs: Date.now() - startedAt,
          body: result,
        },
      });
    } catch (e: any) {
      const statusCode = e instanceof OzonApiError ? e.status : 0;
      let errorBody: any = null;
      if (e instanceof OzonApiError && typeof e.body === 'string') {
        try { errorBody = JSON.parse(e.body); } catch { errorBody = e.body; }
      }
      return reply.send({
        code: 1,
        msg: 'probe completed (with error)',
        data: {
          status: statusCode,
          ok: false,
          durationMs: Date.now() - startedAt,
          error: e?.message || String(e),
          body: errorBody,
        },
      });
    }
  });
}
