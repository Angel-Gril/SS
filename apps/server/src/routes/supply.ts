import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate } from '../lib/auth.js';
import { calculate1688Pricing } from '../lib/1688-pricing.js';
import { normalizeCategoryMappingInput, selectBestCategoryMapping } from '../lib/category-mapping.js';
import { prisma } from '../lib/prisma.js';

const createSchema = z.object({
  title: z.string().min(1).max(500),
  sourceUrl: z.string().url().optional().or(z.literal('')),
  sourcePlatform: z.enum(['1688', 'pinduoduo', 'taobao', 'other']).optional(),
  supplier: z.string().optional(),
  purchasePrice: z.coerce.number().min(0).optional(),
  currency: z.string().default('CNY'),
  sku: z.string().optional(),
  images: z.array(z.string()).optional(),
  mappedProductId: z.string().optional(),
  notes: z.string().optional(),
});

const richTextValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const sourceAttributeSchema = z.object({
  name: z.string(),
  value: richTextValueSchema.optional(),
}).passthrough();
const priceTierSchema = z.object({
  minQuantity: z.union([z.string(), z.number()]).optional().nullable(),
  price: z.union([z.string(), z.number()]).optional().nullable(),
}).passthrough();
const skuAttributesSchema = z.record(z.string(), richTextValueSchema);

const import1688Schema = z.object({
  sourceUrl: z.string().url().optional().or(z.literal('')),
  title: z.string().min(1).max(500),
  sourceProductId: z.string().optional(),
  sourceCategoryId: z.string().optional(),
  sourceCategoryName: z.string().optional(),
  sourceCategoryPath: z.string().optional(),
  supplier: z.string().optional(),
  sku: z.string().optional(),
  images: z.array(z.string()).optional(),
  notes: z.string().optional(),
  purchasePriceCny: z.coerce.number(),
  domesticShippingCny: z.coerce.number().default(0),
  weightG: z.coerce.number().default(0),
  lengthMm: z.coerce.number().optional(),
  widthMm: z.coerce.number().optional(),
  heightMm: z.coerce.number().optional(),
  packageFeeCny: z.coerce.number().default(0),
  commissionPct: z.coerce.number().default(12),
  logisticsFeeCny: z.coerce.number().default(0),
  exchangeRateRubToCny: z.coerce.number(),
  targetMarginPct: z.coerce.number().default(30),
  attributes: z.array(sourceAttributeSchema).max(100).optional(),
  priceTiers: z.array(priceTierSchema).max(50).optional(),
  detailImages: z.array(z.string()).max(100).optional(),
  skuItems: z.array(z.object({
    skuId: z.string().optional(),
    name: z.string().optional(),
    specText: z.string().optional(),
    price: z.union([z.string(), z.number()]).optional().nullable(),
    stock: z.union([z.string(), z.number()]).optional().nullable(),
    imageUrl: z.string().optional(),
    logisticsFeeCny: z.union([z.string(), z.number()]).optional().nullable(),
    grossWeightGrams: z.union([z.string(), z.number()]).optional().nullable(),
    attributes: skuAttributesSchema.optional(),
  }).passthrough()).max(200).optional(),
  metadata: z.object({
    sourceOzonProductId: z.string().trim().optional(),
    ozonSourceContext: z.object({
      productId: z.string().trim().optional(),
      title: z.string().trim().max(500).optional(),
      sourceUrl: z.string().url().optional().or(z.literal('')),
      sourceHost: z.string().trim().optional(),
      imageUrl: z.string().url().optional().or(z.literal('')),
      images: z.array(z.string().url()).max(20).optional(),
      categoryName: z.string().trim().optional(),
      brand: z.string().trim().optional(),
      price: z.union([z.string(), z.number()]).optional(),
      currency: z.string().trim().optional(),
      weightG: z.union([z.string(), z.number()]).optional(),
      lengthMm: z.union([z.string(), z.number()]).optional(),
      widthMm: z.union([z.string(), z.number()]).optional(),
      heightMm: z.union([z.string(), z.number()]).optional(),
      savedAt: z.string().trim().optional(),
    }).optional(),
    sourceDetails: z.unknown().optional(),
  }).optional(),
});

function extract1688ProductId(sourceUrl?: string | null): string | null {
  if (!sourceUrl) return null;
  const match = sourceUrl.match(/\/offer\/(\d+)\.html/i) || sourceUrl.match(/[?&](?:offerId|id)=(\d+)/i);
  return match?.[1] ?? null;
}

async function resolveCategoryMappingFor1688(userId: string, input: {
  sourceCategoryId?: string | null;
  sourceCategoryName?: string | null;
  sourceCategoryPath?: string | null;
}) {
  if (!input.sourceCategoryId && !input.sourceCategoryName && !input.sourceCategoryPath) return null;

  const mappings = await prisma.categoryMapping.findMany({
    where: {
      OR: [{ userId }, { userId: null }],
      sourcePlatform: '1688',
    } as any,
    orderBy: [{ userId: 'desc' }, { updatedAt: 'desc' }],
  });

  return selectBestCategoryMapping(mappings as any, {
    userId,
    sourcePlatform: '1688',
    sourceCategoryId: input.sourceCategoryId,
    sourceCategoryName: input.sourceCategoryName,
    sourceCategoryPath: input.sourceCategoryPath,
  }) as any;
}

function buildMappedCategoryMetadata(mapping: any) {
  if (!mapping) return null;
  return {
    mappingId: mapping.id,
    targetPlatform: mapping.targetPlatform,
    targetCategoryId: mapping.targetCategoryId,
    targetTypeId: mapping.targetTypeId,
    targetCategoryName: mapping.targetCategoryName,
    targetCategoryPath: mapping.targetCategoryPath,
    defaultWeightG: mapping.defaultWeightG,
    defaultLengthMm: mapping.defaultLengthMm,
    defaultWidthMm: mapping.defaultWidthMm,
    defaultHeightMm: mapping.defaultHeightMm,
  };
}

function buildOzonSourceMetadata(input: z.infer<typeof import1688Schema>) {
  const metadata = input.metadata || {};
  const context = metadata.ozonSourceContext;
  if (!metadata.sourceOzonProductId && !context) return {};
  const productId = metadata.sourceOzonProductId || context?.productId || null;
  return {
    sourceOzonProductId: productId,
    ozonSourceContext: context
      ? {
          ...context,
          productId: context.productId || productId || undefined,
        }
      : null,
  };
}

function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== '')
  ) as Partial<T>;
}

function build1688SourceDetailsMetadata(input: z.infer<typeof import1688Schema>) {
  const dimensions = compactObject({
    lengthMm: input.lengthMm,
    widthMm: input.widthMm,
    heightMm: input.heightMm,
  });
  const providedDetails = input.metadata?.sourceDetails && typeof input.metadata.sourceDetails === 'object' && !Array.isArray(input.metadata.sourceDetails)
    ? input.metadata.sourceDetails as Record<string, unknown>
    : {};
  const details = compactObject({
    ...providedDetails,
    attributes: input.attributes && input.attributes.length ? input.attributes : undefined,
    priceTiers: input.priceTiers && input.priceTiers.length ? input.priceTiers : undefined,
    detailImages: input.detailImages && input.detailImages.length ? input.detailImages : undefined,
    dimensions: Object.keys(dimensions).length ? dimensions : undefined,
    skuItems: input.skuItems && input.skuItems.length ? input.skuItems : undefined,
  });
  return Object.keys(details).length ? details : null;
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function findExisting1688SupplyGood(userId: string, sourceProductId: string | null) {
  if (!sourceProductId) return null;
  return prisma.supplyGoods.findFirst({
    where: {
      userId,
      sourcePlatform: '1688',
      sourceProductId,
    },
  });
}

export async function supplyRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/category-mappings', async (request, reply) => {
    const { userId } = (request as any).user;
    const query = request.query as { sourcePlatform?: string; search?: string };
    const where: Record<string, unknown> = {
      OR: [{ userId }, { userId: null }],
    };

    if (query.sourcePlatform) where.sourcePlatform = query.sourcePlatform;
    if (query.search) {
      where.AND = [
        {
          OR: [
            { sourceCategoryId: { contains: query.search, mode: 'insensitive' } },
            { sourceCategoryName: { contains: query.search, mode: 'insensitive' } },
            { sourceCategoryPath: { contains: query.search, mode: 'insensitive' } },
            { targetCategoryName: { contains: query.search, mode: 'insensitive' } },
            { targetCategoryPath: { contains: query.search, mode: 'insensitive' } },
          ],
        },
      ];
    }

    const rows = await prisma.categoryMapping.findMany({
      where: where as any,
      orderBy: [{ userId: 'desc' }, { updatedAt: 'desc' }],
    });

    return reply.send({ code: 1, msg: 'ok', data: rows });
  });

  app.get('/category-mappings/lookup', async (request, reply) => {
    const { userId } = (request as any).user;
    const query = request.query as {
      sourcePlatform?: string;
      sourceCategoryId?: string;
      sourceCategoryName?: string;
      sourceCategoryPath?: string;
    };
    const sourcePlatform = query.sourcePlatform || '1688';

    const rows = await prisma.categoryMapping.findMany({
      where: {
        OR: [{ userId }, { userId: null }],
        sourcePlatform,
      } as any,
      orderBy: [{ userId: 'desc' }, { updatedAt: 'desc' }],
    });
    const mapping = selectBestCategoryMapping(rows as any, {
      userId,
      sourcePlatform,
      sourceCategoryId: query.sourceCategoryId,
      sourceCategoryName: query.sourceCategoryName,
      sourceCategoryPath: query.sourceCategoryPath,
    });

    return reply.send({ code: 1, msg: 'ok', data: mapping });
  });

  app.post('/category-mappings', async (request, reply) => {
    const { userId } = (request as any).user;
    const parsed = normalizeCategoryMappingInput(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    const mapping = await prisma.categoryMapping.create({
      data: {
        userId,
        ...parsed.data,
      },
    });

    return reply.send({ code: 1, msg: '类目映射已创建', data: mapping });
  });

  app.put('/category-mappings/:id', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };
    const parsed = normalizeCategoryMappingInput(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    const existing = await prisma.categoryMapping.findFirst({ where: { id, userId } });
    if (!existing) return reply.status(404).send({ code: 0, msg: '类目映射不存在' });

    const updated = await prisma.categoryMapping.update({
      where: { id },
      data: parsed.data,
    });

    return reply.send({ code: 1, msg: '已更新', data: updated });
  });

  app.delete('/category-mappings/:id', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };

    const existing = await prisma.categoryMapping.findFirst({ where: { id, userId } });
    if (!existing) return reply.status(404).send({ code: 0, msg: '类目映射不存在' });

    await prisma.categoryMapping.delete({ where: { id } });
    return reply.send({ code: 1, msg: '已删除' });
  });

  app.post('/1688/preview', async (request, reply) => {
    const { userId } = (request as any).user;
    const parsed = import1688Schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    const pricing = calculate1688Pricing(parsed.data);
    if (!pricing.ok) {
      return reply.status(400).send({ code: 0, msg: pricing.errors[0] ?? '核价参数错误', data: { pricing } });
    }

    const mapping = await resolveCategoryMappingFor1688(userId, parsed.data);
    const sourceProductId = parsed.data.sourceProductId || extract1688ProductId(parsed.data.sourceUrl);
    const existing = await findExisting1688SupplyGood(userId, sourceProductId);
    return reply.send({
      code: 1,
      msg: 'ok',
      data: {
        sourceProductId,
        saveMode: existing ? 'update' : 'create',
        existingSupplyGood: existing
          ? {
              id: existing.id,
              title: existing.title,
              sourceProductId: existing.sourceProductId,
              updatedAt: existing.updatedAt,
            }
          : null,
        pricing,
        mapping,
      },
    });
  });

  app.post('/1688/import', async (request, reply) => {
    const { userId } = (request as any).user;
    const parsed = import1688Schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    const pricing = calculate1688Pricing(parsed.data);
    if (!pricing.ok) {
      return reply.status(400).send({ code: 0, msg: pricing.errors[0] ?? '核价参数错误', data: { pricing } });
    }

    const mapping = await resolveCategoryMappingFor1688(userId, parsed.data);
    const sourceProductId = parsed.data.sourceProductId || extract1688ProductId(parsed.data.sourceUrl);
    const mappedCategory = buildMappedCategoryMetadata(mapping);
    const ozonSourceMetadata = buildOzonSourceMetadata(parsed.data);
    const sourceDetails = build1688SourceDetailsMetadata(parsed.data);
    const metadata: Prisma.InputJsonObject = {
      sourceCategoryId: parsed.data.sourceCategoryId || null,
      sourceCategoryName: parsed.data.sourceCategoryName || null,
      sourceCategoryPath: parsed.data.sourceCategoryPath || null,
      ...(toPrismaJson(ozonSourceMetadata) as Prisma.InputJsonObject),
      mappedCategory: mappedCategory ? toPrismaJson(mappedCategory) : null,
      sourceDetails: sourceDetails ? toPrismaJson(sourceDetails) : null,
      pricingInput: toPrismaJson(parsed.data),
      pricing: toPrismaJson(pricing),
    };
    const data = {
      title: parsed.data.title,
      sourceUrl: parsed.data.sourceUrl || null,
      sourcePlatform: '1688',
      sourceProductId,
      supplier: parsed.data.supplier || null,
      purchasePrice: parsed.data.purchasePriceCny,
      currency: 'CNY',
      sku: parsed.data.sku || sourceProductId,
      images: parsed.data.images || undefined,
      notes: parsed.data.notes || null,
      metadata,
    };

    const existing = await findExisting1688SupplyGood(userId, sourceProductId);

    if (existing) {
      const item = await prisma.supplyGoods.update({
        where: { id: existing.id },
        data,
      });
      return reply.send({ code: 1, msg: '1688货源已更新', data: item });
    }

    const item = await prisma.supplyGoods.create({
      data: {
        user: { connect: { id: userId } },
        ...data,
      },
    });

    return reply.send({ code: 1, msg: '1688货源已保存', data: item });
  });

  app.get('/', async (request) => {
    const { userId } = (request as any).user;
    const query = request.query as { id?: string; search?: string; status?: string; sourcePlatform?: string; offset?: string; limit?: string; sort?: string };

    const where: Record<string, unknown> = { userId };
    if (query.id) where.id = query.id;
    if (query.status) where.status = query.status;
    if (query.sourcePlatform) where.sourcePlatform = query.sourcePlatform;
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { supplier: { contains: query.search, mode: 'insensitive' } },
        { sku: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const offset = Math.max(0, Number(query.offset) || 0);
    const limit = Math.min(50, Math.max(1, Number(query.limit) || 20));

    const orderBy = query.sort === 'updatedAt' ? { updatedAt: 'desc' as const } : { createdAt: 'desc' as const };

    const [total, rows] = await Promise.all([
      prisma.supplyGoods.count({ where: where as any }),
      prisma.supplyGoods.findMany({
        where: where as any,
        skip: offset,
        take: limit,
        orderBy,
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

    const body = request.body as Record<string, unknown>;
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
