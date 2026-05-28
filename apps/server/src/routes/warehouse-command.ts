import type { FastifyInstance } from 'fastify';
import { authenticate } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { decrypt } from '../lib/crypto.js';
import { OzonClient, OzonApiError } from '../services/ozon-client.js';
import type { OzonAggregatorWarehousePayload } from '../services/ozon-client.js';
import { createNotification } from './notification.js';

export async function warehouseCommandRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/', async (request, reply) => {
    const { userId, role } = (request as any).user;
    const { status } = request.query as { status?: string };

    const where: any = {};
    if (status) where.status = status;
    if (role !== 'ADMIN') {
      const userShops = await prisma.shop.findMany({
        where: { userId },
        select: { id: true },
      });
      where.shopId = { in: userShops.map((s) => s.id) };
    }

    const list = await prisma.warehouseUpdateCommand.findMany({
      where,
      include: { template: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return reply.send({ code: 1, msg: 'ok', data: list });
  });

  app.get('/:id', async (request, reply) => {
    const { userId, role } = (request as any).user;
    const { id } = request.params as { id: string };

    const cmd = await prisma.warehouseUpdateCommand.findUnique({
      where: { id },
      include: { template: true },
    });
    if (!cmd) return reply.status(404).send({ code: 0, msg: '指令不存在' });

    if (role !== 'ADMIN') {
      const shop = await prisma.shop.findUnique({ where: { id: cmd.shopId } });
      if (!shop || shop.userId !== userId) {
        return reply.status(403).send({ code: 0, msg: '无权访问' });
      }
    }

    return reply.send({ code: 1, msg: 'ok', data: cmd });
  });

  app.post('/:id/accept', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };

    const cmd = await prisma.warehouseUpdateCommand.findUnique({
      where: { id },
      include: { template: true },
    });
    if (!cmd) return reply.status(404).send({ code: 0, msg: '指令不存在' });
    if (cmd.status !== 'pending') {
      return reply.status(400).send({ code: 0, msg: `指令状态为 ${cmd.status}，无法接受` });
    }

    const shop = await prisma.shop.findUnique({ where: { id: cmd.shopId } });
    if (!shop || shop.userId !== userId) {
      return reply.status(403).send({ code: 0, msg: '无权操作' });
    }
    if (!shop.clientId) {
      return reply.status(400).send({ code: 0, msg: '店铺未配置 OZON 凭证' });
    }

    const client = new OzonClient({
      clientId: shop.clientId,
      apiKey: decrypt(shop.apiKeyEncrypted),
    });

    const tpl = cmd.template;

    try {
      let result: { operation_id: string };

      if (cmd.commandType === 'update_delivery_method') {
        // 更新已有仓库的物流方式
        const dmPayload = tpl.deliveryMethodPayload as any;
        if (!dmPayload?.warehouse_id) {
          return reply.status(400).send({ code: 0, msg: '模板缺少 warehouse_id，无法更新物流方式' });
        }
        if (tpl.warehouseType === 'non_integrated') {
          result = await client.updateNonIntegratedDeliveryMethod({
            warehouse_id: dmPayload.warehouse_id,
            delivery_method: dmPayload.delivery_method ?? dmPayload,
          });
        } else {
          result = await client.updateAggregatorDeliveryMethod({
            warehouse_id: dmPayload.warehouse_id,
            delivery_method: dmPayload.delivery_method ?? dmPayload,
          });
        }
      } else {
        // 创建仓库
        if (tpl.warehouseType === 'non_integrated') {
          const payload = tpl.deliveryMethodPayload as any;
          result = await client.createWarehouseNonIntegrated({
            name: tpl.name,
            phone: tpl.phone,
            address_coordinates: { latitude: tpl.latitude ?? 0, longitude: tpl.longitude ?? 0 },
            delivery_method: payload?.delivery_method ?? {
              courier_cutoff: 5,
              cut_in: 15,
              name: tpl.name,
            },
            timetable_warehouse: {
              working_days: (tpl.workingDays as string[]).map((day) => ({
                day,
                from: '09:00',
                to: '18:00',
              })),
            },
          });
        } else {
          // 聚合器模式（DROP_OFF 到 OZON 代收点）
          const options = tpl.warehouseOptions as any;
          const payload: OzonAggregatorWarehousePayload = {
            name: tpl.name,
            phone: tpl.phone,
            address_coordinates: { latitude: tpl.latitude ?? 0, longitude: tpl.longitude ?? 0 },
            first_mile_type: (tpl.firstMileType as 'DROP_OFF' | 'PICK_UP') || 'DROP_OFF',
            drop_off_point_id: tpl.dropOffPointId ? Number(tpl.dropOffPointId) : undefined,
            cut_in_time: tpl.cutInTime,
            timeslot_id: tpl.timeslotId,
            return_point_id: tpl.returnPointId ? Number(tpl.returnPointId) : undefined,
            is_kgt: tpl.isKgt,
            working_days: tpl.workingDays as string[],
            options: options || undefined,
          };
          result = await client.createWarehouseAggregator(payload);
        }
      }

      await prisma.warehouseUpdateCommand.update({
        where: { id },
        data: {
          status: 'running',
          operationId: result.operation_id,
          acceptedAt: new Date(),
        },
      });

      return reply.send({
        code: 1,
        msg: '指令已提交 OZON，等待异步执行结果',
        data: { operationId: result.operation_id },
      });
    } catch (err) {
      const msg = err instanceof OzonApiError ? err.message : err instanceof Error ? err.message : '未知错误';
      await prisma.warehouseUpdateCommand.update({
        where: { id },
        data: { status: 'failed', errorMessage: msg, finishedAt: new Date() },
      });
      await createNotification(userId, {
        type: 'warehouse_update',
        title: '仓库更新失败',
        content: `调用 OZON 接口失败：${msg}`,
        link: `/warehouse-commands/${id}`,
      });
      return reply.status(502).send({ code: 0, msg: `OZON 接口调用失败：${msg}` });
    }
  });

  app.post('/:id/reject', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };

    const cmd = await prisma.warehouseUpdateCommand.findUnique({ where: { id } });
    if (!cmd) return reply.status(404).send({ code: 0, msg: '指令不存在' });
    if (cmd.status !== 'pending') {
      return reply.status(400).send({ code: 0, msg: `指令状态为 ${cmd.status}，无法拒绝` });
    }

    const shop = await prisma.shop.findUnique({ where: { id: cmd.shopId } });
    if (!shop || shop.userId !== userId) {
      return reply.status(403).send({ code: 0, msg: '无权操作' });
    }

    await prisma.warehouseUpdateCommand.update({
      where: { id },
      data: { status: 'rejected', finishedAt: new Date() },
    });

    return reply.send({ code: 1, msg: '已拒绝指令' });
  });

  app.get('/ozon/warehouses', async (request, reply) => {
    const { userId } = (request as any).user;
    const { shopId } = request.query as { shopId?: string };
    if (!shopId) return reply.status(400).send({ code: 0, msg: '缺少 shopId' });

    const shop = await prisma.shop.findUnique({ where: { id: shopId } });
    if (!shop || shop.userId !== userId) {
      return reply.status(403).send({ code: 0, msg: '无权访问' });
    }
    if (!shop.clientId) {
      return reply.status(400).send({ code: 0, msg: '店铺未配置 OZON 凭证' });
    }

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

  app.get('/ozon/delivery-methods', async (request, reply) => {
    const { userId } = (request as any).user;
    const { shopId, warehouseId } = request.query as { shopId?: string; warehouseId?: string };
    if (!shopId) return reply.status(400).send({ code: 0, msg: '缺少 shopId' });

    const shop = await prisma.shop.findUnique({ where: { id: shopId } });
    if (!shop || shop.userId !== userId) {
      return reply.status(403).send({ code: 0, msg: '无权访问' });
    }
    if (!shop.clientId) {
      return reply.status(400).send({ code: 0, msg: '店铺未配置 OZON 凭证' });
    }

    try {
      const client = new OzonClient({ clientId: shop.clientId, apiKey: decrypt(shop.apiKeyEncrypted) });
      const list = await client.listDeliveryMethods({
        filter: warehouseId ? { warehouse_id: Number(warehouseId) } : {},
      });
      return reply.send({ code: 1, msg: 'ok', data: list });
    } catch (e) {
      const msg = e instanceof OzonApiError ? e.message : (e as Error).message;
      return reply.status(502).send({ code: 0, msg: `OZON 接口调用失败：${msg}` });
    }
  });

  app.get('/compare/:shopId', async (request, reply) => {
    const { userId, role } = (request as any).user;
    const { shopId } = request.params as { shopId: string };

    const shop = await prisma.shop.findUnique({ where: { id: shopId } });
    if (!shop) return reply.status(404).send({ code: 0, msg: '店铺不存在' });
    if (role !== 'ADMIN' && shop.userId !== userId) {
      return reply.status(403).send({ code: 0, msg: '无权访问' });
    }
    if (!shop.clientId) {
      return reply.status(400).send({ code: 0, msg: '店铺未配置 OZON 凭证' });
    }

    const templates = await prisma.warehouseTemplate.findMany({
      where: { isRecommended: true },
      take: 5,
    });

    try {
      const client = new OzonClient({ clientId: shop.clientId, apiKey: decrypt(shop.apiKeyEncrypted) });
      const ozonWarehouses = await client.getWarehouseList();

      const comparison = templates.map((tpl) => {
        const match = ozonWarehouses.find((w) => w.name === tpl.name);
        return {
          template: { id: tpl.id, name: tpl.name, phone: tpl.phone, lat: tpl.latitude, lon: tpl.longitude },
          ozonMatch: match || null,
          synced: !!match,
          diff: match ? [] : ['仓库不存在于 OZON，需要创建'],
        };
      });

      return reply.send({
        code: 1,
        msg: 'ok',
        data: {
          ozonWarehouses,
          templates: comparison,
          unmatchedOzon: ozonWarehouses.filter((w) => !templates.some((t) => t.name === w.name)),
        },
      });
    } catch (e) {
      const msg = e instanceof OzonApiError ? e.message : (e as Error).message;
      return reply.status(502).send({ code: 0, msg: `OZON 接口调用失败：${msg}` });
    }
  });
}
