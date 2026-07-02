import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireRole } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { fetchOzonSellerDropoffPoints, toOzonPickupPointData } from '../services/ozon-seller-dropoff-points.js';

const createSchema = z.object({
  city: z.string().min(1),
  province: z.string().optional(),
  type: z.enum(['collect', 'dispatch']),
  name: z.string().min(1),
  address: z.string().min(1),
  contact: z.string().optional(),
  phone: z.string().optional(),
  workingHours: z.string().optional(),
  note: z.string().optional(),
  isActive: z.boolean().default(true),
  sortOrder: z.coerce.number().int().default(0),
});

const updateSchema = createSchema.partial();

export async function ozonPickupPointRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  // 用户列表：所有登录用户均可查看；可按 city / type / isActive 过滤
  app.get('/', async (request, reply) => {
    const { city, q, type, includeInactive } = request.query as {
      city?: string; q?: string; type?: string; includeInactive?: string;
    };
    const keyword = String(q || city || '').trim();
    const where: any = {};
    if (!includeInactive) where.isActive = true;
    if (type) where.type = type;
    if (keyword) {
      where.OR = [
        { city: { contains: keyword, mode: 'insensitive' } },
        { province: { contains: keyword, mode: 'insensitive' } },
        { name: { contains: keyword, mode: 'insensitive' } },
        { address: { contains: keyword, mode: 'insensitive' } },
        { contact: { contains: keyword, mode: 'insensitive' } },
        { phone: { contains: keyword, mode: 'insensitive' } },
        { providerName: { contains: keyword, mode: 'insensitive' } },
        { externalId: { contains: keyword, mode: 'insensitive' } },
      ];
    }

    const list = await prisma.ozonPickupPoint.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { city: 'asc' }, { providerId: 'asc' }, { createdAt: 'desc' }],
    });
    return reply.send({ code: 1, msg: 'ok', data: list });
  });

  // 以下仅超管可操作
  app.register(async (admin) => {
    admin.addHook('preHandler', requireRole('ADMIN'));

    admin.post('/sync-ozon-dropoffs', async (request, reply) => {
      const body = request.body as { shopId?: string };
      if (!body?.shopId) return reply.status(400).send({ code: 0, msg: '缺少店铺 ID' });

      const shop = await prisma.shop.findFirst({ where: { id: body.shopId, platform: 'OZON' } });
      if (!shop) return reply.status(404).send({ code: 0, msg: 'Ozon 店铺不存在' });
      const config = (shop.config as any) || {};
      const cookie = String(config.ozonCdnCookie || '').trim();
      const companyId = String(config.ozonCompanyId || '').trim();
      if (!cookie || !companyId) {
        return reply.status(400).send({ code: 0, msg: '该店铺未同步 Ozon seller cookie/company_id，请先通过扩展或店铺页同步登录态' });
      }

      const result = await fetchOzonSellerDropoffPoints({ cookie, companyId });
      let created = 0;
      let updated = 0;

      for (const point of result.points) {
        const data = toOzonPickupPointData(point, shop.id);
        const existing = await prisma.ozonPickupPoint.findFirst({
          where: {
            source: 'ozon_seller',
            externalId: data.externalId,
            providerId: data.providerId,
            shopId: shop.id,
          },
        });
        if (existing) {
          await prisma.ozonPickupPoint.update({ where: { id: existing.id }, data });
          updated += 1;
        } else {
          await prisma.ozonPickupPoint.create({ data });
          created += 1;
        }
      }

      return reply.send({
        code: 1,
        msg: `已同步 ${result.points.length} 个 Ozon 发运点`,
        data: {
          created,
          updated,
          totalPoints: result.points.length,
          providerCount: result.providers.length,
          methodCount: result.methods.length,
          providerErrors: result.providerErrors,
        },
      });
    });

    admin.post('/', async (request, reply) => {
      const parsed = createSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
      }
      const item = await prisma.ozonPickupPoint.create({ data: parsed.data });
      return reply.send({ code: 1, msg: '已创建', data: item });
    });

    admin.put('/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = updateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
      }
      const item = await prisma.ozonPickupPoint.update({ where: { id }, data: parsed.data });
      return reply.send({ code: 1, msg: '已更新', data: item });
    });

    admin.delete('/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      await prisma.ozonPickupPoint.delete({ where: { id } });
      return reply.send({ code: 1, msg: '已删除' });
    });
  });
}
