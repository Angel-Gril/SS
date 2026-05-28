import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';

const createItemSchema = z.object({
  sku: z.string().min(1).max(100),
  productName: z.string().min(1).max(200),
  quantity: z.coerce.number().int().min(0).default(0),
  costPrice: z.coerce.number().min(0).optional(),
  location: z.string().max(100).optional(),
  remark: z.string().max(500).optional(),
});

const recordSchema = z.object({
  sku: z.string().min(1),
  type: z.enum(['IN', 'OUT', 'ADJUST']),
  quantity: z.coerce.number().int().min(1),
  costPrice: z.coerce.number().min(0).optional(),
  reason: z.string().max(200).optional(),
});

export async function inventoryRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/', async (request) => {
    const { userId } = (request as any).user;
    const query = request.query as { offset?: string; limit?: string; search?: string };

    const offset = Math.max(0, Number(query.offset) || 0);
    const limit = Math.min(200, Math.max(1, Number(query.limit) || 20));
    const search = query.search?.trim();

    const where: Record<string, unknown> = { userId };
    if (search) {
      where.OR = [
        { sku: { contains: search, mode: 'insensitive' } },
        { productName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [total, rows] = await Promise.all([
      prisma.inventoryItem.count({ where: where as any }),
      prisma.inventoryItem.findMany({
        where: where as any,
        skip: offset,
        take: limit,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          sku: true,
          productName: true,
          quantity: true,
          costPrice: true,
          location: true,
          remark: true,
          updatedAt: true,
        },
      }),
    ]);

    return {
      code: 1,
      msg: 'ok',
      data: {
        total,
        rows: rows.map((r) => ({ ...r, costPrice: r.costPrice?.toString() ?? null })),
      },
    };
  });

  app.post('/', async (request, reply) => {
    const { userId } = (request as any).user;
    const parsed = createItemSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    const { sku, productName, quantity, costPrice, location, remark } = parsed.data;

    const existing = await prisma.inventoryItem.findUnique({
      where: { userId_sku: { userId, sku } },
    });
    if (existing) {
      return reply.status(409).send({ code: 0, msg: `SKU ${sku} 已存在` });
    }

    const item = await prisma.inventoryItem.create({
      data: { userId, sku, productName, quantity, costPrice, location, remark },
    });

    if (quantity > 0) {
      await prisma.inventoryRecord.create({
        data: { itemId: item.id, type: 'IN', quantity, costPrice, reason: '初始入库' },
      });
    }

    return reply.status(201).send({ code: 1, msg: '创建成功', data: { id: item.id } });
  });

  app.post('/record', async (request, reply) => {
    const { userId } = (request as any).user;
    const parsed = recordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    const { sku, type, quantity, costPrice, reason } = parsed.data;

    const item = await prisma.inventoryItem.findUnique({
      where: { userId_sku: { userId, sku } },
    });
    if (!item) {
      return reply.status(404).send({ code: 0, msg: `SKU ${sku} 不存在` });
    }

    if (type === 'OUT' && item.quantity < quantity) {
      return reply.send({ code: 0, msg: `库存不足，当前库存 ${item.quantity}` });
    }

    const delta = type === 'OUT' ? -quantity : quantity;

    await prisma.$transaction([
      prisma.inventoryItem.update({
        where: { id: item.id },
        data: { quantity: { increment: delta }, costPrice: costPrice ?? item.costPrice },
      }),
      prisma.inventoryRecord.create({
        data: { itemId: item.id, type, quantity, costPrice, reason },
      }),
    ]);

    return reply.send({ code: 1, msg: `${type === 'IN' ? '入库' : type === 'OUT' ? '出库' : '调整'}成功` });
  });

  app.get('/records', async (request) => {
    const { userId } = (request as any).user;
    const query = request.query as { offset?: string; limit?: string; sku?: string; type?: string };

    const offset = Math.max(0, Number(query.offset) || 0);
    const limit = Math.min(200, Math.max(1, Number(query.limit) || 20));

    const where: Record<string, unknown> = { item: { userId } };
    if (query.sku) where.item = { userId, sku: query.sku };
    if (query.type) where.type = query.type;

    const [total, rows] = await Promise.all([
      prisma.inventoryRecord.count({ where: where as any }),
      prisma.inventoryRecord.findMany({
        where: where as any,
        skip: offset,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { item: { select: { sku: true, productName: true } } },
      }),
    ]);

    return {
      code: 1,
      msg: 'ok',
      data: {
        total,
        rows: rows.map((r) => ({
          id: r.id,
          sku: r.item.sku,
          productName: r.item.productName,
          type: r.type,
          quantity: r.quantity,
          costPrice: r.costPrice?.toString() ?? null,
          reason: r.reason,
          operator: r.operator,
          createdAt: r.createdAt,
        })),
      },
    };
  });

  app.delete('/:id', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };

    const item = await prisma.inventoryItem.findFirst({ where: { id, userId } });
    if (!item) {
      return reply.status(404).send({ code: 0, msg: '库存项不存在' });
    }

    await prisma.inventoryItem.delete({ where: { id } });
    return reply.send({ code: 1, msg: '删除成功' });
  });
}
