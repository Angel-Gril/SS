import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireRole } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { decrypt } from '../lib/crypto.js';
import { OzonClient, OzonApiError } from '../services/ozon-client.js';
import { createNotification } from './notification.js';

const createAddressSchema = z.object({
  name: z.string().min(1),
  recipient: z.string().min(1),
  phone: z.string().min(1),
  province: z.string().min(1),
  city: z.string().min(1),
  district: z.string().min(1),
  address: z.string().min(1),
  zipCode: z.string().optional(),
  isDefault: z.boolean().default(false),
});

const createNonIntegratedSchema = z.object({
  shopId: z.string().min(1),
  name: z.string().min(1),
  phone: z.string().min(1),
  latitude: z.coerce.number(),
  longitude: z.coerce.number(),
  deliveryMethodName: z.string().default('自送物流'),
  courierCutoff: z.coerce.number().default(18),
  cutIn: z.coerce.number().default(24),
});

export async function ozonLogisticsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  // 查询 OZON 在俄罗斯境内的 FBO 仓（卖家在俄落地自送场景）。
  // 注意：本接口不是查"中国境内 OZON 揽收点"——那个走 /api/ozon-pickup-points。
  app.get('/fbo-nearby', async (request, reply) => {
    const { userId } = (request as any).user;
    const { shopId, city } = request.query as { shopId?: string; city?: string };
    if (!shopId) return reply.status(400).send({ code: 0, msg: '缺少 shopId' });

    const shop = await prisma.shop.findUnique({ where: { id: shopId } });
    if (!shop || shop.userId !== userId) return reply.status(403).send({ code: 0, msg: '无权访问' });
    if (!shop.clientId) return reply.status(400).send({ code: 0, msg: '店铺未配置 OZON 凭证' });

    try {
      const client = new OzonClient({ clientId: shop.clientId, apiKey: decrypt(shop.apiKeyEncrypted) });
      const fboList = await client.listFboWarehouses();

      // OZON 的 /v1/warehouse/fbo/list 不返回坐标，只能按 address 字符串做城市命中
      let sorted = fboList;
      if (city) {
        const cityLc = city.trim().toLowerCase();
        const hit = fboList.filter((w) => (w.address || '').toLowerCase().includes(cityLc));
        const miss = fboList.filter((w) => !(w.address || '').toLowerCase().includes(cityLc));
        sorted = [...hit, ...miss];
      }

      return reply.send({ code: 1, msg: 'ok', data: sorted });
    } catch (e) {
      const msg = e instanceof OzonApiError ? e.message : (e as Error).message;
      return reply.status(502).send({ code: 0, msg: `OZON 接口调用失败：${msg}` });
    }
  });

  app.post('/create-non-integrated', async (request, reply) => {
    const { userId } = (request as any).user;
    const parsed = createNonIntegratedSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });

    const shop = await prisma.shop.findUnique({ where: { id: parsed.data.shopId } });
    if (!shop || shop.userId !== userId) return reply.status(403).send({ code: 0, msg: '无权操作' });
    if (!shop.clientId) return reply.status(400).send({ code: 0, msg: '店铺未配置 OZON 凭证' });

    try {
      const client = new OzonClient({ clientId: shop.clientId, apiKey: decrypt(shop.apiKeyEncrypted) });
      const result = await client.createWarehouseNonIntegrated({
        name: parsed.data.name,
        phone: parsed.data.phone,
        address_coordinates: { latitude: parsed.data.latitude, longitude: parsed.data.longitude },
        delivery_method: {
          courier_cutoff: parsed.data.courierCutoff,
          cut_in: parsed.data.cutIn,
          name: parsed.data.deliveryMethodName,
        },
        timetable_warehouse: {
          working_days: [
            { day: 'MONDAY', from: '09:00', to: '18:00' },
            { day: 'TUESDAY', from: '09:00', to: '18:00' },
            { day: 'WEDNESDAY', from: '09:00', to: '18:00' },
            { day: 'THURSDAY', from: '09:00', to: '18:00' },
            { day: 'FRIDAY', from: '09:00', to: '18:00' },
          ],
        },
      });
      return reply.send({ code: 1, msg: '仓库创建已提交', data: { operationId: result.operation_id } });
    } catch (e) {
      const msg = e instanceof OzonApiError ? e.message : (e as Error).message;
      return reply.status(502).send({ code: 0, msg: `OZON 接口调用失败：${msg}` });
    }
  });
}

export async function domesticAddressRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  // 列表：按身份返回可见的地址集合
  //   ADMIN：全部
  //   仓主（canPublishAddress=true）：平台地址 + 自家发布
  //   普通用户：平台地址 + 上级仓主（parentId）发布
  app.get('/', async (request, reply) => {
    const { userId, role } = (request as any).user;
    let where: any;
    if (role === 'ADMIN') {
      where = {};
    } else {
      const me = await prisma.user.findUnique({
        where: { id: userId },
        select: { canPublishAddress: true, parentId: true },
      });
      // Prisma 的 { in: [null, ...] } 不会匹配 SQL NULL，所以用 OR 把"平台地址(hostUserId=null)"
      // 和"具体仓主 id"分开拼
      const orClauses: any[] = [{ hostUserId: null }];
      const userIds: string[] = [];
      if (me?.canPublishAddress) userIds.push(userId);
      if (me?.parentId) userIds.push(me.parentId);
      if (userIds.length) orClauses.push({ hostUserId: { in: userIds } });
      where = { OR: orClauses };
    }
    const list = await prisma.domesticAddressTemplate.findMany({
      where,
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    return reply.send({ code: 1, msg: 'ok', data: list });
  });

  // 创建：ADMIN 下发平台地址（hostUserId=null）；canPublishAddress 仓主下发自家地址（hostUserId=自己）
  app.post('/', async (request, reply) => {
    const { userId, role } = (request as any).user;
    let hostUserId: string | null;
    if (role === 'ADMIN') {
      hostUserId = null;
    } else {
      const me = await prisma.user.findUnique({
        where: { id: userId },
        select: { canPublishAddress: true },
      });
      if (!me?.canPublishAddress) {
        return reply.status(403).send({ code: 0, msg: '无地址下发权限' });
      }
      hostUserId = userId;
    }
    const parsed = createAddressSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });

    // 默认地址：以 (hostUserId 维度) 为单位互斥
    if (parsed.data.isDefault) {
      await prisma.domesticAddressTemplate.updateMany({
        where: { hostUserId },
        data: { isDefault: false },
      });
    }
    const addr = await prisma.domesticAddressTemplate.create({
      data: { ...parsed.data, hostUserId },
    });

    // 通知该地址应通知的用户
    let notifyUsers: { id: string }[] = [];
    if (hostUserId === null) {
      // 平台地址 → 通知所有 transit 类型 active 用户
      notifyUsers = await prisma.user.findMany({
        where: { tenantType: 'transit', status: 'ACTIVE' },
        select: { id: true },
      });
    } else {
      // 仓主地址 → 通知该仓主的下线
      notifyUsers = await prisma.user.findMany({
        where: { parentId: hostUserId, status: 'ACTIVE' },
        select: { id: true },
      });
    }
    for (const u of notifyUsers) {
      await createNotification(u.id, {
        type: 'address_update',
        title: '中转仓地址已更新',
        content: `新地址：${parsed.data.province}${parsed.data.city}${parsed.data.district} ${parsed.data.address}`,
        link: '/domestic-addresses',
      });
    }

    return reply.send({ code: 1, msg: '已创建', data: addr });
  });

  app.put('/:id', async (request, reply) => {
    const { userId, role } = (request as any).user;
    const { id } = request.params as { id: string };
    const existing = await prisma.domesticAddressTemplate.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ code: 0, msg: '地址不存在' });
    if (!canMutateAddress(existing.hostUserId, userId, role)) {
      return reply.status(403).send({ code: 0, msg: '无权操作此地址' });
    }
    const parsed = createAddressSchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });

    if (parsed.data.isDefault) {
      await prisma.domesticAddressTemplate.updateMany({
        where: { hostUserId: existing.hostUserId },
        data: { isDefault: false },
      });
    }
    const addr = await prisma.domesticAddressTemplate.update({ where: { id }, data: parsed.data });

    // 仅在涉及地址内容字段变更时才通知
    const contentChanged = ['province', 'city', 'district', 'address', 'recipient', 'phone'].some(
      (k) => (parsed.data as any)[k] !== undefined
    );
    if (contentChanged) {
      let notifyUsers: { id: string }[] = [];
      if (existing.hostUserId === null) {
        notifyUsers = await prisma.user.findMany({
          where: { tenantType: 'transit', status: 'ACTIVE' },
          select: { id: true },
        });
      } else {
        notifyUsers = await prisma.user.findMany({
          where: { parentId: existing.hostUserId, status: 'ACTIVE' },
          select: { id: true },
        });
      }
      for (const u of notifyUsers) {
        await createNotification(u.id, {
          type: 'address_update',
          title: '中转仓地址已变更',
          content: `请更新您的发货地址，新地址：${addr.province}${addr.city}${addr.district} ${addr.address}`,
          link: '/domestic-addresses',
        });
      }
    }

    return reply.send({ code: 1, msg: '已更新', data: addr });
  });

  app.delete('/:id', async (request, reply) => {
    const { userId, role } = (request as any).user;
    const { id } = request.params as { id: string };
    const existing = await prisma.domesticAddressTemplate.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ code: 0, msg: '地址不存在' });
    if (!canMutateAddress(existing.hostUserId, userId, role)) {
      return reply.status(403).send({ code: 0, msg: '无权操作此地址' });
    }
    await prisma.domesticAddressTemplate.delete({ where: { id } });
    return reply.send({ code: 1, msg: '已删除' });
  });

  // 复制默认：返回当前用户视图下的默认地址（优先上级仓主默认 → 平台默认）
  app.post('/copy-default', async (request, reply) => {
    const { userId, role } = (request as any).user;
    let addr = null as Awaited<ReturnType<typeof prisma.domesticAddressTemplate.findFirst>> | null;

    if (role !== 'ADMIN') {
      const me = await prisma.user.findUnique({
        where: { id: userId },
        select: { parentId: true },
      });
      if (me?.parentId) {
        addr = await prisma.domesticAddressTemplate.findFirst({
          where: { hostUserId: me.parentId, isDefault: true },
        });
      }
    }
    if (!addr) {
      addr = await prisma.domesticAddressTemplate.findFirst({
        where: { hostUserId: null, isDefault: true },
      });
    }
    if (!addr) return reply.status(404).send({ code: 0, msg: '暂无默认地址模板' });
    return reply.send({
      code: 1,
      msg: 'ok',
      data: {
        text: `${addr.recipient}\n${addr.phone}\n${addr.province}${addr.city}${addr.district}\n${addr.address}${addr.zipCode ? '\n' + addr.zipCode : ''}`,
        address: addr,
      },
    });
  });
}

// 改写权限：ADMIN 改一切；非 ADMIN 仅能改自己作为 host 发布的（hostUserId === self）
function canMutateAddress(addrHostUserId: string | null, currentUserId: string, role: string) {
  if (role === 'ADMIN') return true;
  return addrHostUserId !== null && addrHostUserId === currentUserId;
}
