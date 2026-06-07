import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';

const SUPPLY_SOURCE_PLATFORMS = ['1688', 'pinduoduo', 'pdd', 'taobao', 'tmall', 'jd', 'other'] as const;
const SUPPLY_SOURCE_PLATFORM_SET = new Set<string>(SUPPLY_SOURCE_PLATFORMS);

export function normalizeSupplySourcePlatform(value: unknown): string | null {
  const text = value == null ? '' : String(value).trim();
  if (!text) return null;
  const normalized = text.toLowerCase();
  return SUPPLY_SOURCE_PLATFORM_SET.has(normalized) ? normalized : null;
}

const sourcePlatformSchema = z.preprocess((value) => {
  if (value == null || String(value).trim() === '') return null;
  return normalizeSupplySourcePlatform(value) || String(value).trim().toLowerCase();
}, z.enum(SUPPLY_SOURCE_PLATFORMS).nullable().optional());

const createSchema = z.object({
  title: z.string().min(1).max(500),
  sourceUrl: z.string().url().optional().or(z.literal('')),
  sourcePlatform: sourcePlatformSchema,
  supplier: z.string().optional(),
  purchasePrice: z.coerce.number().min(0).optional(),
  currency: z.string().default('CNY'),
  sku: z.string().optional(),
  images: z.array(z.string()).optional(),
  mappedProductId: z.string().optional(),
  notes: z.string().optional(),
});

const updateSchema = createSchema.extend({
  status: z.string().optional(),
}).partial();

export function parseSupplyCreateInput(input: unknown) {
  return createSchema.parse(input);
}

export function parseSupplyUpdateInput(input: unknown) {
  return updateSchema.parse(input);
}

export async function supplyRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/', async (request) => {
    const { userId } = (request as any).user;
    const query = request.query as { search?: string; status?: string; offset?: string; limit?: string };

    const where: Record<string, unknown> = { userId };
    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { supplier: { contains: query.search, mode: 'insensitive' } },
        { sku: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const offset = Math.max(0, Number(query.offset) || 0);
    const limit = Math.min(50, Math.max(1, Number(query.limit) || 20));

    const [total, rows] = await Promise.all([
      prisma.supplyGoods.count({ where: where as any }),
      prisma.supplyGoods.findMany({
        where: where as any,
        skip: offset,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      code: 1,
      msg: 'ok',
      data: {
        total,
        rows: rows.map((r) => ({ ...r, purchasePrice: r.purchasePrice?.toString() ?? null })),
      },
    };
  });

  app.post('/', async (request, reply) => {
    const { userId } = (request as any).user;
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });

    const data = {
      user: { connect: { id: userId } },
      title: parsed.data.title,
      sourceUrl: parsed.data.sourceUrl || null,
      sourcePlatform: parsed.data.sourcePlatform || null,
      supplier: parsed.data.supplier || null,
      purchasePrice: parsed.data.purchasePrice ?? null,
      currency: parsed.data.currency,
      sku: parsed.data.sku || null,
      images: parsed.data.images || undefined,
      mappedProductId: parsed.data.mappedProductId || null,
      notes: parsed.data.notes || null,
    };

    const item = await prisma.supplyGoods.create({ data });
    return reply.send({ code: 1, msg: '货源已添加', data: item });
  });

  app.put('/:id', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };

    const existing = await prisma.supplyGoods.findFirst({ where: { id, userId } });
    if (!existing) return reply.status(404).send({ code: 0, msg: '货源不存在' });

    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });

    const body = parsed.data as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    if (body.title !== undefined) data.title = body.title;
    if (body.sourceUrl !== undefined) data.sourceUrl = body.sourceUrl || null;
    if (body.sourcePlatform !== undefined) data.sourcePlatform = body.sourcePlatform || null;
    if (body.supplier !== undefined) data.supplier = body.supplier || null;
    if (body.purchasePrice !== undefined) data.purchasePrice = body.purchasePrice ?? null;
    if (body.sku !== undefined) data.sku = body.sku || null;
    if (body.mappedProductId !== undefined) data.mappedProductId = body.mappedProductId || null;
    if (body.notes !== undefined) data.notes = body.notes || null;
    if (body.status !== undefined) data.status = body.status;

    const updated = await prisma.supplyGoods.update({ where: { id }, data });
    return reply.send({ code: 1, msg: '已更新', data: updated });
  });

  app.delete('/:id', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };

    const existing = await prisma.supplyGoods.findFirst({ where: { id, userId } });
    if (!existing) return reply.status(404).send({ code: 0, msg: '货源不存在' });

    await prisma.supplyGoods.delete({ where: { id } });
    return reply.send({ code: 1, msg: '已删除' });
  });
}
